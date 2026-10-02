#!/bin/sh
# Builds the Android app and puts it where the server offers it to people on Android: <config dir>/android/fokuroru.apk.
# Usage: scripts/android/publish-apk.sh [config dir]
# With no argument it goes to the maki-test server: over the SMB mount when mounted, else over SSH to zimaboard2.
# A plain path is copied into as given.
set -eu
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root/android"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
./gradlew -q assembleDebug
apk=app/build/outputs/apk/debug/app-debug.apk
name="$(grep versionName version.properties)"

if [ $# -ge 1 ]; then
  mkdir -p "$1/android"
  cp "$apk" "$1/android/fokuroru.apk"
  echo "Published $name to $1/android/fokuroru.apk"
elif [ -d /Volumes/SSD-256/AppData/maki-test/maki-config ]; then
  # The container owns its config folder, so the SMB mount (which writes as its owner) is the dependable route.
  dest=/Volumes/SSD-256/AppData/maki-test/maki-config/android
  mkdir -p "$dest"
  cp "$apk" "$dest/fokuroru.apk"
  echo "Published $name to $dest/fokuroru.apk"
else
  dest=/media/SSD-256/AppData/maki-test/maki-config/android
  ssh zimaboard2 "mkdir -p '$dest'"
  scp -q "$apk" "zimaboard2:$dest/fokuroru.apk"
  echo "Published $name to zimaboard2:$dest/fokuroru.apk"
fi
