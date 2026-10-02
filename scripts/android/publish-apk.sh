#!/bin/sh
# Builds the Android app and puts it where the server offers it to people on Android:
# <config dir>/android/fokuroru.apk. Usage: scripts/android/publish-apk.sh /path/to/config
set -eu
config="${1:?usage: publish-apk.sh <server config dir>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root/android"
./gradlew -q assembleDebug
mkdir -p "$config/android"
cp app/build/outputs/apk/debug/app-debug.apk "$config/android/fokuroru.apk"
echo "Published $(grep versionName version.properties) to $config/android/fokuroru.apk"
