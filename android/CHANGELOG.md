# Android app versions

Every push bumps `version.properties` (versionCode by one, versionName patch by one, or minor for a feature) and adds a line here.
`serverVersion` is the server build the push produces, one number past the last `fok.N` the hook reported.
The footer of the mobile view shows the installed version.

## 0.5.30 (58)
- No app change. Chalk dust in the air after the shelf collapses now falls with gravity instead of drifting.

## 0.5.29 (57)
- No app change. After the shelf collapses, chalk dust and the banner paper fall instead of resting on the missing plank.

## 0.5.28 (56)
- No app change. The loosened shelf now tips down at its heavy end, and the books and props slide off it.

## 0.5.27 (55)
- No app change. After the shelf shudders over 100 times in one page load (10 on the dev server), its heavier end comes off the wall and the plank hangs from the other.

## 0.5.26 (54)
- No app change. Tape strips are checked along their whole length and width against the frame, so none sits under the wood, including strips following the paper.

## 0.5.25 (53)
- No app change. Torn and folded banner paper no longer shades itself, which left black shards along its edges.

## 0.5.24 (52)
- No app change. Tape stuck over the frame lies on top of it: if any of the strip is over the frame, the whole strip is drawn on the frame's face.

## 0.5.23 (51)
- No app change. The banner's paper is jolted by page scrolling like the books are. The board's wooden frame is solid to it, and tape stuck onto the frame lies on its face instead of sinking into it.

## 0.5.22 (50)
- No app change. The chalkboard banner's tape fails 5% of the time, up from 2%.

## 0.5.21 (49)
- No app change. When the banner's tape fails, which corners let go is random: one, two or three of the four, in any order, a few seconds apart. At least one always holds.

## 0.5.20 (48)
- No app change. Picking up a strip of tape takes only the paper still joined to it; paper that has torn away stays put.

## 0.5.19 (47)
- No app change. Letting go of the paper no longer flings it: the speed built up while it was held is taken out.

## 0.5.18 (46)
- No app change. The chalk duster and the sticks of chalk are solid to the failing banner's paper and push it along. Space presses back the strip of tape that came away with the paper, nearest the held spot, instead of making a new one.

## 0.5.17 (45)
- No app change. The failing banner's paper can be picked up at any point, not only the corners, and Space tapes it up wherever it is held. The hand moves at a pace the paper can follow, so a twitch no longer shreds it.

## 0.5.16 (44)
- No app change. Paper tears along a ragged line, not in squares: finer mesh, tears remove single triangles, each thread has its own strength, and a tear weakens the threads beside it so the crack keeps going.

## 0.5.15 (43)
- No app change. The failing banner's paper cannot be stretched: pulled too hard it tears along the strain. A corner held in the hand can no longer be pushed through a book.

## 0.5.14 (42)
- No app change. The failing banner's corners can be picked up with the pointer and stuck back up by pressing Space while holding. A strip of tape now holds only the corner under it, so the paper hinges about it, and the paper is stiffer.

## 0.5.13 (41)
- No app change. The failing banner's paper is much stiffer, and books, props and the plank are now solid boxes it cannot pass through from any side.

## 0.5.12 (40)
- No app change. The failing banner's paper is a little stiffer: it resists folding, more firmly down its height than along its length.

## 0.5.11 (39)
- No app change. The failing banner is now simulated as floppy paper: a grid of weights joined by threads that only resist stretching, held by its tape and released corner by corner, falling under gravity and draping over whatever is beneath.

## 0.5.10 (38)
- No app change. The failing banner now curls from its own weight, falls like a pendulum from the corner that holds, and lands on books, props or the plank instead of passing through them.

## 0.5.9 (37)
- No app change. When the chalkboard banner's tape fails it is now a 3D sheet that slowly peels off the board, curls, and hangs from the tape that held, with a small sway.

## 0.5.8 (36)
- No app change. Two percent of the time the chalkboard banner's tape fails on one side and it hangs, tipped, from the other.

## 0.5.7 (35)
- No app change. Chalkboard banner is 40 to 60% of the board wide and can sit anywhere along the top. The series page's side title stops where the tabs start.

## 0.5.6 (34)
- No app change. The chalkboard banner is now 60% of the board's width.

## 0.5.5 (33)
- No app change. The Home chalkboard sometimes (one load in five) has a banner of a random library series taped to a top corner, from AniList or Kitsu.

## 0.5.4 (32)
- No app change. Bookshelf: books that join the shelf later (for example when the content rating slider is raised) now drop in from above over a gap and land, instead of appearing inside other books.

## 0.5.3 (31)
- No app change. The content rating slider now also filters Home's Recently added, Continue from the anime and Downloading now.

## 0.5.2 (30)
- No app change. Content rating (spice) button in the desktop header and the mobile view: a slider from a leaf to three chillies that narrows what this device shows.

## 0.5.1 (29)
- No app change. A downloaded preview can be deleted from its Discover card.

## 0.5.0 (28)
- When the server has a newer app, the warning bar has a Download button: the app fetches the APK from your server (using the session it already has) and hands it to the installer. First time, it asks you to allow installing from Fōkurōru.

## 0.4.1 (27)
- No app change. The server's reported version now comes from a VERSION file inside the source it was built from, so it can no longer claim a newer version than its code.

## 0.4.0 (26)
- Pull to refresh: drag down from the top of a page to reload it. Off in the reader, in dialogs and while dragging on the tap zone editor, and while the page is scrolled.

## 0.3.8 (25)
- No app change. Desktop Home has a Previews rail of series whose first-chapter preview is downloaded (needs the matching server build).

## 0.3.7 (24)
- No app change. Mobile view library hides series with no chapters on the server.

## 0.3.6 (23)
- QR pairing on a server behind a sign-in page (tinyauth and similar): the app keeps the code, shows that page, and signs in as the account from the QR code as soon as the gateway sign-in is done (within five minutes), instead of ending at the login screen.

## 0.3.5 (22)
- No app change. Server image builds faster: Chromium install and NuGet restore are cached across code changes.

## 0.3.4 (21)
- No app change. Mobile view: one Continue reading rail above the library, in the desktop shelf's order (most recently read first) with the first book as the hero.

## 0.3.3 (20)
- No app change. The pairing QR code now draws (it was collapsing to a thin bar) and lives under Settings, Users & security, Pair the Android app.

## 0.3.2 (19)
- No app change. Settings, Reader, has an Edit tap zones button for the app's own layout.

## 0.3.1 (18)
- No app change. Server fix: a partly read chapter whose file was deleted no longer sits in Continue reading; the series moves to Up next.

## 0.3.0 (17)
- Add a server without typing: Find servers on this network (scans the local subnet for Fōkurōru), and Scan QR code, which adds the server and signs in as the account that showed the code (Settings, Android app, Pair the Android app, in the web interface). Needs the matching server build.

## 0.2.7 (16)
- Fix: a fresh install crashed on launch because the web layer was built before any server was set. The setup screen now opens first and returns to the app when done.

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
