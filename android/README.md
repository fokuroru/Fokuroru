# Fōkurōru for Android

A native shell around the Fōkurōru web UI. It loads your server's own pages in a WebView and adds
the things a browser tab can't do: hardware page-turn buttons, offline chapters and background sync.

The server needs no changes. The web UI feature-detects the app (`window.MakiNative`) and shows the
extra buttons only inside it.

## Build

Needs JDK 17 and the Android SDK (API 34 platform and build tools).

```bash
cd android
export JAVA_HOME=/path/to/jdk17 ANDROID_HOME=$HOME/Library/Android/sdk
./gradlew :app:assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:testDebugUnitTest    # JVM tests for the pure logic
```

Install the APK, open the app and enter your server address (for example `http://192.168.1.20:8990`).
Sign in on the normal login page. Plain HTTP on a LAN is allowed, since that is how most people run it.

## What it does

| Feature | Where |
| --- | --- |
| Volume keys turn pages, with invert and swap | `MainActivity.dispatchKeyEvent`, `input/PageTurn.kt` |
| Bluetooth clickers, headset buttons | same map, plus a silent `MediaSession` in `device/Remote.kt` |
| Stylus buttons | `MainActivity.dispatchTouchEvent` |
| Keep screen on, brightness, rotation lock, hidden system bars, cutout | `MainActivity.applyChrome`, `ui/ReaderTools.kt` |
| Save chapters to the device | `work/DownloadWorker.kt`, `data/Store.kt` |
| Offline reading | `web/Offline.kt` |
| Offline progress queue | `data/Store.kt`, `work/ProgressSync.kt` |
| Delete read chapters, keep the last one | `data/AutoDelete.kt` |
| Background sync, new chapter notices | `work/SyncWorker.kt` |
| Shortcuts: Continue reading, Latest chapter | `res/xml/shortcuts.xml`, `MainActivity.start` |
| Reading now widget, in compact, standard and large sizes | `widget/ReadingNowWidget.kt`, `widget/WidgetViews.kt` |
| Reading shelf widget: a grid of covers for what you are reading and what is next | `widget/ShelfWidget.kt` |
| Dark mode and Material You colours | `Theme.Material3.DynamicColors.DayNight`, widget colours in `values-v31` |
| Mobile view as the start screen: last read hero, Continue reading, library grid, switch to the desktop view | `pages/SimpleHomePage.tsx` in the web UI, `lib/simpleView.ts` |
| Several servers and accounts, switched from one screen | `ui/ServersActivity.kt`, `data/Profiles.kt` |
| Two pages on tablets and unfolded foldables | `ui/Layouts.kt` (`dual`), `MainActivity.layoutJson`, `useNativeLayout` in the web UI |

Page-turn buttons only act while a chapter is open (the WebView URL starts with `/read/`). The
arrow keys are left to the web reader, which knows the reading direction. Everything else is mapped
to "next" and "previous", and the app never needs to know which way the book reads.

## How it fits together

**One login.** The WebView's cookie jar holds the session. Background work reads the same cookie and
echoes the antiforgery token as a header, so there is no second sign-in and no key to create. If the
session expires, downloads fail with "Signed out" until you open the app and sign in again.

**Servers and accounts.** A profile is one server plus one account on it. Each has its own folder
under `profiles/<id>` for saved chapters, unsent progress and cached files, so nothing leaks between
them. Switching saves the live sign-in cookies into the profile being left and puts the target's
back, which is all a sign-in is here. A second account on the same server is just another profile
with the same address: switch to it, sign in on the normal page, and its name shows in the list the
next time it is read. Deleting a profile removes its sign-in and files from the phone only.

**Servers behind a sign-in gateway.** A forward-auth gateway (tinyauth, Authelia, Authentik) answers an
unauthenticated request with a redirect to its own login page or a 401, not with Fōkurōru's JSON.
`net/Gateway.kt` tells that apart from "no connection": a redirect to another host, a 401 or 403 on
the anonymous `/initialize.json`, or HTML where JSON should be. The app then
- accepts such a server when you add it, and lets the WebView show the gateway's own sign-in page, with
  navigation staying in the WebView so a provider the gateway sends you to still works;
- shows a "Your server asks you to sign in again" bar when the gateway session expires, whose button
  loads the server so the gateway page comes up, while saved chapters and queued progress stay usable;
- treats the gateway as a pause for background work: queued progress is kept, downloads fail as
  "Signed out", and a notice (at most daily) asks you to open the app.

**Offline reading without touching the reader.** `shouldInterceptRequest` answers page requests from
disk when the chapter is saved. The reader manifest is answered from the saved copy only when the
server can't be reached, with the resume page taken from local progress. A short list of small reads
(`/initialize.json`, `/api/v1/auth/me`, reading profiles, bookmarks, series progress) goes through the
app's own connection and the last good answer is kept, so the reader can start with no network. The
page shell itself comes from the web app's service worker, so open the app once online first.

**Progress.** When a progress write fails with a network error, the web UI hands it to
`MakiNative.queueProgress` instead of dropping it. Writes are merged per chapter (latest page, summed
time, completion kept) and sent when a connection returns. Reading time per send is capped at
15 minutes, the same cap the server applies.

**Downloads.** WorkManager, one unique job per chapter, Wi-Fi only and charging-only options. Pages
are fetched through the same endpoint the reader uses, so a chapter that is a slice of a larger
archive is saved correctly. Resumable: pages already on disk are skipped.

**Auto delete.** After each sync, read chapters are removed from the device. With "keep the last
chapter read" on, the most recently read chapter of each series is held back, the same rule the
server's setting uses. A chapter with progress still waiting to sync is never deleted.

## Widgets

Two widgets, both resizable. The layout follows the size the launcher gives each one, so a widget moved
to a tablet or stretched across a home screen uses the room:

- **Reading now**: compact (a thumbnail and the title), standard (cover, title, chapter, progress, and an
  arrow to step through what you are reading), and large (a big cover, a Resume button and a row of up to
  six other covers). The large cover and title scale with the widget on Android 12 and later.
- **Reading shelf**: a grid of covers, two to six across and one or two rows, for what you are reading
  and what is up next. Tapping a cover opens that chapter.

Both read the saved list the background sync keeps (`reading.json`, per profile), so they show the active
server and account, and are redrawn when a sync finishes, when you leave a chapter, and when you switch
profile. A signed-out profile shows "Open Fōkurōru to sign in".

Debug builds include `WidgetPreviewActivity`, which draws every layout at ten sizes with sample covers
and needs no launcher: `adb shell am start -n dev.fokuroru.reader/.WidgetPreviewActivity`.

## Screen sizes

Sizes are read from the window, not the device, so split-screen and resizable windows follow the same
rules. Spreads need both sides tablet-sized (600dp), and then either a very wide window (840dp) or one
close to square, so a phone on its side and a tablet held upright both stay single-page while a tablet on
its side and an opened fold get two. Settings, the lists and the forms stop at 640dp and centre on
anything wider. The simple view stops at 1120dp, drops the wordmark below 360dp, and steps up cover and
type sizes from 700dp. `Layouts` has the rules and its tests.

## Limits

- Starting with no network needs the app to have been opened online once, so the web app's files are saved.
- Saved chapters belong to one profile. Background sync and downloads only run for the profile in use; a download in flight when you switch is queued again when you come back.
- No emulator image was available when this was written, so the app has been compiled and its logic
  unit tested, but not driven on a device.
