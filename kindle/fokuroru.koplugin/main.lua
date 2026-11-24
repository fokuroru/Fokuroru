local DataStorage = require("datastorage")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local LuaSettings = require("luasettings")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local util = require("util")
local Device = require("device")
local ffiutil = require("ffi/util")
local json = require("json")
local lfs = require("libs/libkoreader-lfs")
local ltn12 = require("ltn12")
local socketutil = require("socketutil")
local _ = require("gettext")

local Fokuroru = WidgetContainer:extend{
    name = "fokuroru",
    is_doc_only = false,
}

local MIN_SYNC_GAP = 600 -- seconds between automatic syncs

function Fokuroru:init()
    self.settings = LuaSettings:open(DataStorage:getSettingsDir() .. "/fokuroru.lua")
    self.state = self.settings.data
    self.state.keep = self.state.keep or 3
    self.state.files = self.state.files or {} -- path -> chapter id
    self.state.queue = self.state.queue or {} -- chapter id (string) -> {page, count}
    self.state.dir = self.state.dir or "/mnt/us/documents/Fokuroru"
    self.ui.menu:registerToMainMenu(self)
end

function Fokuroru:save()
    self.settings:flush()
end

-- Server access

local function http_for(url)
    return url:match("^https") and require("ssl.https") or require("socket.http")
end

local function fetch(url, method)
    local chunks = {}
    socketutil:set_timeout(15, 60)
    local _ok, code = http_for(url).request{ url = url, method = method or "GET", sink = ltn12.sink.table(chunks) }
    socketutil:reset_timeout()
    return code, table.concat(chunks)
end

local function post_json(url, body)
    local chunks = {}
    socketutil:set_timeout(10, 30)
    local _ok, code = http_for(url).request{
        url = url,
        method = "POST",
        headers = { ["Content-Type"] = "application/json", ["Content-Length"] = tostring(#body) },
        source = ltn12.source.string(body),
        sink = ltn12.sink.table(chunks),
    }
    socketutil:reset_timeout()
    return code, table.concat(chunks)
end

function Fokuroru:endpoint(path)
    return (self.state.url or ""):gsub("/+$", "") .. path
end

local function safe(name)
    return (name:gsub('[\\/:*?"<>|%c]', "_"):gsub("^%s+", ""):gsub("%s+$", ""))
end

-- Progress

function Fokuroru:chapterIdOfOpenDocument()
    local doc = self.ui.document
    return doc and self.state.files[doc.file]
end

function Fokuroru:remember()
    local id = self:chapterIdOfOpenDocument()
    if not id or not self.ui.view then return end
    local page = self.ui.view.state and self.ui.view.state.page
    if not page then return end
    self.state.queue[tostring(id)] = { page = page - 1, count = self.ui.document:getPageCount() }
    self:save()
end

function Fokuroru:onPageUpdate() self:remember() end
function Fokuroru:onCloseDocument() self:remember() end
function Fokuroru:onSuspend() self:remember() end

function Fokuroru:flushQueue()
    local sent = 0
    for id, entry in pairs(self.state.queue) do
        local code = fetch(self:endpoint(("/chapter/%s/progress?page=%d&count=%d"):format(id, entry.page, entry.count)), "POST")
        if code == 204 or code == 200 then
            self.state.queue[id] = nil
            sent = sent + 1
        elseif code == 404 then
            self.state.queue[id] = nil -- chapter or token gone, retrying cannot help
        end
    end
    self:save()
    return sent
end

-- Downloads

-- Returns "have" (already on disk), "new", or nil on failure.
function Fokuroru:download(chapter, index, series_dir)
    local path = ("%s/%04d - %s - %d.cbz"):format(series_dir, index, safe(chapter.chapter), chapter.chapterId)
    if lfs.attributes(path, "mode") == "file" then
        self.state.files[path] = chapter.chapterId
        return "have"
    end
    local tmp = path .. ".part"
    local out = io.open(tmp, "wb")
    if not out then return nil end
    local url = self:endpoint("/chapter/" .. chapter.chapterId .. "/device.cbz")
    socketutil:set_timeout(30, 900)
    local ok, code = http_for(url).request{ url = url, sink = socketutil.file_sink(out) }
    socketutil:reset_timeout()
    if ok and code == 200 and os.rename(tmp, path) then
        self.state.files[path] = chapter.chapterId
        return "new"
    end
    os.remove(tmp)
    return nil
end

function Fokuroru:pruneRead(chapters)
    local last_read
    for i, c in ipairs(chapters) do
        if c.read then last_read = i end
    end
    local open = self.ui.document and self.ui.document.file
    for i, c in ipairs(chapters) do
        if c.read and i ~= last_read then
            for path, id in pairs(self.state.files) do
                if id == c.chapterId and path ~= open then
                    os.remove(path)
                    local sdr = path:gsub("%.cbz$", ".sdr")
                    if lfs.attributes(sdr, "mode") == "directory" then ffiutil.purgeDir(sdr) end
                    self.state.files[path] = nil
                end
            end
        end
    end
end

function Fokuroru:doSync()
    if not self.state.url or self.state.url == "" then
        return self:quickConnect()
    end
    local sent = self:flushQueue()
    local code, body = fetch(self:endpoint("/shelf.json"))
    if code ~= 200 then
        return UIManager:show(InfoMessage:new{ text = _("Could not reach the server.") })
    end
    local ok, shelf = pcall(json.decode, body)
    if not ok or type(shelf) ~= "table" then
        return UIManager:show(InfoMessage:new{ text = _("Unexpected reply from the server.") })
    end

    local got, failed = 0, 0
    for _i, series in ipairs(shelf) do
        local dir = ("%s/%s"):format(self.state.dir, safe(series.title))
        util.makePath(dir)
        local fetched = 0
        for index, chapter in ipairs(series.chapters) do
            if not chapter.read and fetched < self.state.keep then
                fetched = fetched + 1
                local result = self:download(chapter, index, dir)
                if result == "new" then got = got + 1 elseif not result then failed = failed + 1 end
            end
        end
        self:pruneRead(series.chapters)
    end
    self.state.last_sync = os.time()
    self:save()
    UIManager:show(InfoMessage:new{
        text = (_("Synced. %1 new chapters, %2 progress updates sent, %3 failed.")
            :gsub("%%1", got):gsub("%%2", sent):gsub("%%3", failed)),
    })
end

function Fokuroru:sync()
    local ok, err = pcall(self.doSync, self)
    if not ok then
        UIManager:show(InfoMessage:new{ text = _("Sync failed: ") .. tostring(err) })
    end
end

function Fokuroru:syncWhenOnline()
    NetworkMgr:runWhenOnline(function() self:sync() end)
end

function Fokuroru:onNetworkConnected()
    if self.state.auto and (os.time() - (self.state.last_sync or 0)) > MIN_SYNC_GAP then
        UIManager:scheduleIn(2, function() self:sync() end)
    end
end

-- Quick connect: show a code, the person approves it in the web UI, the plugin collects the token.

local POLL_SECONDS = 3

function Fokuroru:cancelPairing()
    if self.pairing and self.pairing.tick then UIManager:unschedule(self.pairing.tick) end
    self.pairing = nil
end

function Fokuroru:quickConnect()
    NetworkMgr:runWhenOnline(function() self:startPairing() end)
end

function Fokuroru:startPairing()
    self:cancelPairing()
    local defaults = {}
    local ok, loaded = pcall(dofile, ffiutil.dirname(debug.getinfo(1, "S").source:sub(2)) .. "/defaults.lua")
    if ok and type(loaded) == "table" then defaults = loaded end
    local servers = self.state.server and { self.state.server } or defaults.servers or {}

    for _i, server in ipairs(servers) do
        server = server:gsub("/+$", "")
        local code, body = post_json(server .. "/api/v1/opds/pair/start", json.encode({ name = Device.model or "KOReader" }))
        local parsed = code == 200 and select(2, pcall(json.decode, body)) or nil
        if type(parsed) == "table" and parsed.secret then
            return self:waitForApproval(server, parsed)
        end
    end
    UIManager:show(InfoMessage:new{ text = _("Could not reach the server.") })
end

function Fokuroru:waitForApproval(server, started)
    local pairing = { server = server, deadline = os.time() + (started.expiresIn or 600) }
    self.pairing = pairing
    local message = InfoMessage:new{
        text = _("Open Fokuroru on your phone or computer, go to Settings, and approve this code:\n\n") .. started.code
            .. _("\n\nTap here to cancel."),
        dismiss_callback = function() self:cancelPairing() end,
    }
    UIManager:show(message)

    pairing.tick = function()
        if self.pairing ~= pairing then return end
        if os.time() > pairing.deadline then
            UIManager:close(message)
            self:cancelPairing()
            return UIManager:show(InfoMessage:new{ text = _("The code expired. Try again.") })
        end
        local code, body = fetch(server .. "/api/v1/opds/pair/poll?secret=" .. started.secret)
        if code == 200 then
            local decoded, parsed = pcall(json.decode, body)
            if decoded and type(parsed) == "table" and parsed.path then
                self.state.url = server .. parsed.path
                self.state.server = server
                self:save()
                UIManager:close(message)
                self.pairing = nil
                UIManager:show(InfoMessage:new{ text = _("Connected."), timeout = 3 })
                return UIManager:scheduleIn(1, function() self:sync() end)
            end
        elseif code == 404 then
            UIManager:close(message)
            self:cancelPairing()
            return UIManager:show(InfoMessage:new{ text = _("The code expired. Try again.") })
        end
        UIManager:scheduleIn(POLL_SECONDS, pairing.tick)
    end
    UIManager:scheduleIn(POLL_SECONDS, pairing.tick)
end

-- Menu

function Fokuroru:ask(title, key, numeric)
    local dialog
    dialog = InputDialog:new{
        title = title,
        input = tostring(self.state[key] or ""),
        buttons = {{
            { text = _("Cancel"), callback = function() UIManager:close(dialog) end },
            { text = _("Save"), is_enter_default = true, callback = function()
                local value = dialog:getInputText()
                self.state[key] = numeric and (tonumber(value) or self.state[key]) or value
                self:save()
                UIManager:close(dialog)
            end },
        }},
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function Fokuroru:addToMainMenu(menu_items)
    menu_items.fokuroru = {
        text = _("Fokuroru"),
        sorting_hint = "tools",
        sub_item_table = {
            { text = _("Quick connect"), callback = function() self:quickConnect() end },
            { text = _("Sync now"), callback = function() self:syncWhenOnline() end },
            { text = _("Server address (with OPDS token)"), keep_menu_open = true,
              callback = function() self:ask(_("OPDS URL"), "url") end },
            { text = _("Chapters to keep ahead"), keep_menu_open = true,
              callback = function() self:ask(_("Chapters per series"), "keep", true) end },
            { text = _("Sync when Wi-Fi connects"), checked_func = function() return self.state.auto end,
              callback = function() self.state.auto = not self.state.auto; self:save() end },
        },
    }
end

return Fokuroru
