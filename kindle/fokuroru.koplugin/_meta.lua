local _ = require("gettext")
return {
    name = "fokuroru",
    version = 1, -- bump on every plugin change; the server compares this to update devices
    fullname = _("Fōkurōru"),
    description = _([[Downloads the chapters you are reading from your Fokuroru server and syncs progress.]]),
}
