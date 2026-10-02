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
| Reading now widget | `widget/ReadingNowWidget.kt` |
| Dark mode and Material You colours | `Theme.Material3.DynamicColors.DayNight`, widget colours in `values-v31` |
| Simple view as the start screen: last read hero, Continue reading, library grid, switch to the full version | `pages/SimpleHomePage.tsx` in the web UI, `lib/simpleView.ts` |
| Two pages on tablets and unfolded foldables | `MainActivity.layoutJson`, `useNativeLayout` in the web UI |

Page-turn buttons only act while a chapter is open (the WebView URL starts with `/read/`). The
arrow keys are left to the web reader, which knows the reading direction. Everything else is mapped
to "next" and "previous", and the app never needs to know which way the book reads.

## How it fits together

**One login.** The WebView's cookie jar holds the session. Background work reads the same cookie and
echoes the antiforgery token as a header, so there is no second sign-in and no key to create. If the
session expires, downloads fail with "Signed out" until you open the app and sign in again.

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

## Limits

- Starting with no network needs the app to have been opened online once, so the web app's files are saved.
- Saved chapters are tied to one server. Changing the server address clears them.
- No emulator image was available when this was written, so the app has been compiled and its logic
  unit tested, but not driven on a device.
