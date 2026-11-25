local DataStorage = require("datastorage")
local DocSettings = require("docsettings")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local LuaSettings = require("luasettings")
local logger = require("logger")
local Menu = require("ui/widget/menu")
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
    self.state.selected = self.state.selected or {} -- series id (string) -> title; nothing downloads until chosen
    if not self.state.dir or self.state.dir == "/mnt/us/documents/Fokuroru" then
        self.state.dir = "/mnt/us/Books"
    end
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
    socketutil:set_timeout(8, 20)
    local _ok, code = http_for(url).request{ url = url, method = method or "GET", sink = ltn12.sink.table(chunks) }
    socketutil:reset_timeout()
    return code, table.concat(chunks)
end

local function post_json(url, body)
    local chunks = {}
    socketutil:set_timeout(8, 20)
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

function Fokuroru:remember(flush)
    local id = self:chapterIdOfOpenDocument()
    if not id or not self.ui.view then return end
    local page = self.ui.view.state and self.ui.view.state.page
    if not page then return end
    self.state.queue[tostring(id)] = { page = page - 1, count = self.ui.document:getPageCount() }
    if flush then self:save() end
end

function Fokuroru:onPageUpdate() self:remember(false) end
function Fokuroru:onCloseDocument() self:remember(true) end
function Fokuroru:onSuspend() self:remember(true) end

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
-- Chapters download one at a time in a background subprocess that is polled from the UI loop, so
-- the screen stays fully usable. "Stop sync" in the menu cancels.

local POLL_DOWNLOAD_SECONDS = 2

local NAME = "Fōkurōru"

-- Every pop-up says where it came from.
local function toast(text, timeout)
    UIManager:show(InfoMessage:new{ text = NAME .. ": " .. text, timeout = timeout or 4 })
end

-- Runs in the subprocess: fetch url to dest through a .part file.
local function download_to(url, dest, block_timeout, total_timeout)
    local out = io.open(dest .. ".part", "wb")
    if not out then return end
    socketutil:set_timeout(block_timeout, total_timeout)
    local ok, code = http_for(url).request{ url = url, sink = socketutil.file_sink(out) }
    socketutil:reset_timeout()
    if ok and code == 200 then os.rename(dest .. ".part", dest) else os.remove(dest .. ".part") end
end

-- Gives a chapter file its series, title, author and cover as KOReader's own custom book data,
-- so the shelf shows the real names and the series cover. Returns the cover job for the subprocess.
function Fokuroru:dress(path, series, chapter, index)
    local sidecar = DocSettings:getSidecarDir(path)
    util.makePath(sidecar)
    local meta = sidecar .. "/custom_metadata.lua"
    if lfs.attributes(meta, "mode") ~= "file" then
        local settings = LuaSettings:open(meta)
        settings:saveSetting("custom_props", {
            title = series.title .. " - " .. chapter.chapter,
            series = series.title,
            series_index = tonumber(chapter.number) or index,
            authors = series.authors,
            description = series.description,
            keywords = series.genres,
        })
        settings:flush()
    end
    local cover = sidecar .. "/cover.jpg"
    if lfs.attributes(cover, "mode") ~= "file" then
        return { url = self:endpoint("/cover/" .. series.seriesId), path = cover }
    end
end

function Fokuroru:refreshBookInfo(path)
    local ok, manager = pcall(require, "plugins/coverbrowser.koplugin/bookinfomanager")
    if ok and type(manager) == "table" and manager.deleteBookInfo then
        pcall(manager.deleteBookInfo, manager, path)
    end
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

-- Returns true when a background run was started.
function Fokuroru:doSync()
    if not self.state.url or self.state.url == "" then
        self:quickConnect()
        return false
    end
    self:seedSelection()
    local ids = {}
    for id in pairs(self.state.selected) do ids[#ids + 1] = id end
    if #ids == 0 then
        toast(_("No titles chosen yet. Pick the ones to keep on this Kindle."))
        UIManager:scheduleIn(0.5, function() self:chooseTitles() end)
        return false
    end
    local sent = self:flushQueue()
    local code, body = fetch(self:endpoint("/shelf.json?ids=" .. table.concat(ids, ",")))
    if code ~= 200 then
        toast(_("Could not reach the server."))
        return false
    end
    local ok, shelf = pcall(json.decode, body)
    if not ok or type(shelf) ~= "table" then
        toast(_("Unexpected reply from the server."))
        return false
    end

    local jobs = {}
    for _i, series in ipairs(shelf) do
        local dir = ("%s/%s"):format(self.state.dir, safe(series.title))
        util.makePath(dir)
        local fetched = 0
        for index, chapter in ipairs(series.chapters) do
            if not chapter.read and fetched < self.state.keep then
                fetched = fetched + 1
                local path = ("%s/%04d - %s - %d.cbz"):format(dir, index, safe(chapter.chapter), chapter.chapterId)
                local cover = self:dress(path, series, chapter, index)
                local present = lfs.attributes(path, "mode") == "file"
                if present then self.state.files[path] = chapter.chapterId end
                if cover or not present then
                    jobs[#jobs + 1] = {
                        path = path, tmp = path .. ".part", id = chapter.chapterId, cover = cover,
                        url = not present and self:endpoint("/chapter/" .. chapter.chapterId .. "/device.cbz") or nil,
                    }
                end
            end
        end
        self:pruneRead(series.chapters)
    end

    self.run = { jobs = jobs, i = 0, got = 0, failed = 0, sent = sent }
    if #jobs > 0 then
        toast(_("Syncing in the background. Stop it from the Fōkurōru menu."))
    end
    self:nextJob()
    return true
end

function Fokuroru:nextJob()
    local run = self.run
    if not run then return end
    run.i = run.i + 1
    local job = run.jobs[run.i]
    if not job then return self:finishSync() end

    local pid = ffiutil.runInSubProcess(function()
        if job.cover then download_to(job.cover.url, job.cover.path, 15, 60) end
        if job.url then download_to(job.url, job.path, 30, 600) end
    end)
    if not pid then
        run.failed = run.failed + 1
        return UIManager:scheduleIn(0, function() self:nextJob() end)
    end

    run.pid = pid
    local function poll()
        if self.run ~= run then return end
        if ffiutil.isSubProcessDone(pid) then
            run.pid = nil
            if lfs.attributes(job.path, "mode") == "file" then
                self.state.files[job.path] = job.id
                if job.url then run.got = run.got + 1 end
                self:refreshBookInfo(job.path)
                self:save()
            elseif job.url then
                os.remove(job.tmp)
                run.failed = run.failed + 1
            end
            return self:nextJob()
        end
        UIManager:scheduleIn(POLL_DOWNLOAD_SECONDS, poll)
    end
    UIManager:scheduleIn(POLL_DOWNLOAD_SECONDS, poll)
end

function Fokuroru:finishSync()
    local run = self.run
    self.run = nil
    self.syncing = false
    self.state.last_sync = os.time()
    self:save()
    toast((_("Synced. %1 new chapters, %2 progress updates sent, %3 failed.")
        :gsub("%%1", run.got):gsub("%%2", run.sent):gsub("%%3", run.failed)), 6)
end

function Fokuroru:stopSync()
    local run = self.run
    if not run then return end
    self.run = nil
    self.syncing = false
    if run.pid then
        ffiutil.terminateSubProcess(run.pid)
        local pid = run.pid
        UIManager:scheduleIn(1, function() ffiutil.isSubProcessDone(pid) end)
        local job = run.jobs[run.i]
        if job then os.remove(job.tmp) end
    end
    self:save()
    toast(_("Sync stopped."))
end

-- First run: assume the three series read most recently on the server.
function Fokuroru:seedSelection()
    if self.state.seeded or next(self.state.selected) then
        self.state.seeded = true
        return
    end
    local code, body = fetch(self:endpoint("/shelf.json"))
    local ok, shelf = pcall(json.decode, body)
    if code ~= 200 or not ok or type(shelf) ~= "table" then return end
    for i = 1, math.min(3, #shelf) do
        self.state.selected[tostring(shelf[i].seriesId)] = shelf[i].title
    end
    self.state.seeded = true
    self:save()
end

function Fokuroru:sync()
    if self.syncing then
        return toast(_("Already syncing."))
    end
    self.syncing = true
    local ok, started = xpcall(function() return self:doSync() end, debug.traceback)
    if not ok then
        self.run = nil
        logger.warn("fokuroru sync failed:", started)
        toast(_("Sync failed: ") .. tostring(started):match("^[^\n]*"))
    end
    if not ok or not started then
        self.syncing = false
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
    toast(_("Could not reach the server."))
end

function Fokuroru:waitForApproval(server, started)
    local pairing = { server = server, deadline = os.time() + (started.expiresIn or 600) }
    self.pairing = pairing
    local message = InfoMessage:new{
        text = NAME .. "\n\n" .. _("Open Fōkurōru on your phone or computer, go to Settings, and approve this code:\n\n") .. started.code
            .. _("\n\nTap here to cancel."),
        dismiss_callback = function() self:cancelPairing() end,
    }
    UIManager:show(message)

    pairing.tick = function()
        if self.pairing ~= pairing then return end
        if os.time() > pairing.deadline then
            UIManager:close(message)
            self:cancelPairing()
            return toast(_("The code expired. Try again."))
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
                toast(_("Connected."), 3)
                return UIManager:scheduleIn(1, function() self:chooseTitles() end)
            end
        elseif code == 404 then
            UIManager:close(message)
            self:cancelPairing()
            return toast(_("The code expired. Try again."))
        end
        UIManager:scheduleIn(POLL_SECONDS, pairing.tick)
    end
    UIManager:scheduleIn(POLL_SECONDS, pairing.tick)
end

-- Title chooser

function Fokuroru:chooseTitles()
    if not self.state.url or self.state.url == "" then return self:quickConnect() end
    NetworkMgr:runWhenOnline(function()
        local code, body = fetch(self:endpoint("/titles.json"))
        local ok, titles = pcall(json.decode, body)
        if code ~= 200 or not ok or type(titles) ~= "table" then
            return toast(_("Could not load the library."))
        end

        self:seedSelection()
        local menu
        local items = {}
        local function build()
            local mode = self.state.sort or "title"
            local field = mode == "read" and "lastRead" or mode == "added" and "added" or nil
            -- Chosen titles stay on top; the sort orders within each group. Dates run newest first, titles A-Z.
            table.sort(titles, function(a, b)
                local sa, sb = self.state.selected[tostring(a.seriesId)] ~= nil, self.state.selected[tostring(b.seriesId)] ~= nil
                if sa ~= sb then return sa end
                if self.state.sort_reverse then a, b = b, a end
                if field and (a[field] or 0) ~= (b[field] or 0) then return (a[field] or 0) > (b[field] or 0) end
                return a.title:lower() < b.title:lower()
            end)
            for i = #items, 1, -1 do items[i] = nil end
            for _i, title in ipairs(titles) do
                local key = tostring(title.seriesId)
                local item = { text = title.title }
                local function mark() item.mandatory = self.state.selected[key] and "[x]" or "[ ]" end
                mark()
                item.callback = function()
                    if self.state.selected[key] then
                        self.state.selected[key] = nil
                    else
                        self.state.selected[key] = title.title
                    end
                    mark()
                    self:save()
                    menu:updateItems(nil, true)
                end
                items[#items + 1] = item
            end
        end
        build()

        local SORTS = { title = _("Title"), read = _("Last read"), added = _("Recently added") }
        local function resort()
            build()
            menu:switchItemTable(nil, items)
        end
        local function setSort(mode)
            if (self.state.sort or "title") == mode then
                self.state.sort_reverse = not self.state.sort_reverse -- same choice again flips the order
            else
                self.state.sort = mode
                self.state.sort_reverse = false
            end
            self:save()
            resort()
        end

        menu = Menu:new{
            title = _("Titles to keep on this Kindle"),
            item_table = items,
            title_bar_left_icon = "appbar.menu",
            onLeftButtonTap = function()
                local dialog
                local buttons = {}
                for _i, mode in ipairs({ "title", "read", "added" }) do
                    buttons[#buttons + 1] = {{
                        text = SORTS[mode] .. ((self.state.sort or "title") == mode and (self.state.sort_reverse and "  ↑" or "  ↓") or ""),
                        callback = function() UIManager:close(dialog); setSort(mode) end,
                    }}
                end
                dialog = require("ui/widget/buttondialog"):new{ title = _("Sort by (tap again to reverse)"), buttons = buttons }
                UIManager:show(dialog)
            end,
            is_borderless = true,
            is_popout = false,
            covers_fullscreen = true,
        }
        UIManager:show(menu)
    end)
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
        text = NAME,
        sorting_hint = "tools",
        sub_item_table = {
            { text = _("Quick connect"), callback = function() self:quickConnect() end },
            { text = _("Choose titles to sync"), callback = function() self:chooseTitles() end },
            { text = _("Stop sync"), enabled_func = function() return self.run ~= nil end,
              callback = function() self:stopSync() end },
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
