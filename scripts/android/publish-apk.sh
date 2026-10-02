#!/bin/sh
# Builds the Android app and puts it where the server offers it to people on Android: <config dir>/android/fokuroru.apk.
# Usage: scripts/android/publish-apk.sh [config dir]
# With no argument it goes to the maki-test server: over SSH to zimaboard2 when it answers, else over the SMB mount.
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
elif ssh -o BatchMode=yes -o ConnectTimeout=5 zimaboard2 true 2>/dev/null; then
  dest=/media/SSD-256/AppData/maki-test/maki-config/android
  ssh zimaboard2 "mkdir -p '$dest' && chmod 755 '$dest'"
  scp -q "$apk" "zimaboard2:$dest/fokuroru.apk"
  ssh zimaboard2 "chmod 644 '$dest/fokuroru.apk'"
  echo "Published $name to zimaboard2:$dest/fokuroru.apk"
else
  dest=/Volumes/SSD-256/AppData/maki-test/maki-config/android
  mkdir -p "$dest"
  cp "$apk" "$dest/fokuroru.apk"
  echo "Published $name to $dest/fokuroru.apk"
fi
