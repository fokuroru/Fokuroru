# Fokuroru Previews for MangaBaka

A Firefox extension. On `mangabaka.org` it adds a **Preview** button to each series page, and to covers in lists
on hover. Pressing it asks your Fokuroru server to download chapter 1, the same as Preview first chapter on a
Fokuroru series card. It shows up under Preview requests on the Requests page, and is retried daily if it fails.

## Install for testing

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on** and pick `manifest.json` in this folder. It lasts until Firefox restarts.

For a permanent install, sign it as an unlisted add-on on addons.mozilla.org, or use Firefox Developer
Edition or Nightly with `xpinstall.signatures.required` set to false.

## Set up

Click the toolbar icon, enter your Fokuroru address (for example `http://192.168.1.50:8990`) and an API key,
and press **Test connection**. Firefox asks once to let the extension reach that address.

## What it sends

Only `POST /api/v1/preview/{MangaBaka id}` and a `DELETE` on the same path, with your key in `X-Api-Key`.
Novels are skipped, since Fokuroru does not preview them.
