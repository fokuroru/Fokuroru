# Android app versions

Every push bumps `version.properties` (versionCode by one, versionName patch by one, or minor for a feature) and adds a line here.
`serverVersion` is the server build the push produces, one number past the last `fok.N` the hook reported.
The footer of the mobile view shows the installed version.

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
