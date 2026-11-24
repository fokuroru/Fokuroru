# Fōkurōru for KOReader (Kindle)

A KOReader plugin that keeps the next unread chapters of what you are reading on the device and
syncs progress back. Needs a server with the `device.cbz`, `shelf.json` and `progress` OPDS routes.

## Install

1. Copy `fokuroru.koplugin` to KOReader's `plugins` folder on the Kindle (`/mnt/us/koreader/plugins/`).
2. Restart KOReader.
3. Top menu, Tools, Fokuroru, Quick connect. The Kindle shows a code.
4. In the Fōkurōru web UI open Settings, OPDS, and tap Approve next to that code. The Kindle connects and syncs by itself.

Quick connect tries the addresses in `defaults.lua` (edit it if your server is somewhere else). Each Kindle gets its own key, so connecting one never changes the feed URL other apps use, and you can revoke it from your account's API keys.

Nothing downloads until you choose titles: Tools, Fokuroru, Choose titles to sync, then tick the series you want.
Quick connect opens that list for you the first time.

Chapters land in `/mnt/us/Books/<series>/`, one folder per series.

## What it does

- Downloads the next N unread chapters of each title you chose, already cut for the screen (webtoon strips are
  split at gutters by the server).
- Remembers the page while you read and sends it on the next sync, so reading offline is fine.
- Deletes chapters you have read, keeping the most recent one.
- Optionally syncs when Wi-Fi connects, at most every 10 minutes.
