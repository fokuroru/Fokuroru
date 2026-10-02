# Android app versions

Every push bumps `version.properties` (versionCode by one, versionName patch by one, or minor for a feature) and adds a line here.
`serverVersion` is the server build the push produces, one number past the last `fok.N` the hook reported.
The footer of the mobile view shows the installed version.

## 0.2.6 (15)
- No app change. `publish-apk.sh` uses the SMB mount first, since the server's container owns the config folder.

## 0.2.5 (14)
- No app change. The web interface also recognises an Android tablet that asks for the desktop site.

## 0.2.4 (13)
- No app change. `publish-apk.sh` now publishes to the maki-test server by default.

## 0.2.3 (12)
- No app change. The web interface offers this app to browsers on Android once the server has the APK (`scripts/android/publish-apk.sh`).

## 0.2.2 (11)
- Launcher icon is the Fōkurōru icon from the web app (the same artwork as the PWA icon), with a matching themed-icon silhouette.

## 0.2.1 (10)
- Controller screen: the "press a button" box now receives the controller's buttons (a dialog takes key events away from the screen behind it).

## 0.2.0 (9)
- Controller buttons: map each button on a game controller (tested target: Abxylute M4) to a reader action, add any other button by pressing it, and see what the app receives. Needs a server with the matching web build for chapter, menu, bookmark, zoom and leave actions; page turns work everywhere.

## 0.1.7 (8)
- The app's version verdict replaces the mobile view footer's "up to date" line, so an older server's web build cannot claim a match.

## 0.1.6 (7)
- System bars are transparent and take the page's own colour, so the app reads as full screen instead of showing a blue status bar.

## 0.1.5 (6)
- The server reports the newest app version in `/initialize.json`, and the app warns when it is behind.

## 0.1.4 (5)
- Shorter version warning: "Version mismatch. Please update server to X."

## 0.1.3 (4)
- The app itself warns when the server is older than it needs, so an old server's web build cannot hide the problem.

## 0.1.2 (3)
- The footer says when the server is older than the version this app was built for (`serverVersion` in `version.properties`).

## 0.1.1 (2)
- Mobile view opens a book at the chapter being read, else the first wanted one, with a download splash when it is not on the server.
- Reader: Auto layout, Mobile and Desktop view names, status footer.

## 0.1.0 (1)
- First tracked version: reader shell, offline chapters, profiles, tap zones, widgets.
