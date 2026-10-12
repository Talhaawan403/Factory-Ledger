#!/usr/bin/env bash

# Verifies the reproducible release path without installing or deploying anything.
# Requires: JDK 21+, Android SDK build-tools (apksigner), a release keystore, and
# google-services.json only when Firebase/Google Sign-In is intended for this build.
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

java_version_output="$(java -version 2>&1 | head -n 1)"
java_major="$(printf '%s' "$java_version_output" | sed -nE 's/.*version "([0-9]+).*/\1/p')"
if [[ -z "$java_major" || "$java_major" -lt 21 ]]; then
  echo "Release verification requires JDK 21 or newer. Found: $java_version_output" >&2
  exit 1
fi

if [[ ! -f android/keystore.properties ]]; then
  echo "Missing android/keystore.properties. A signed production APK cannot be verified." >&2
  exit 1
fi

if ! command -v apksigner >/dev/null 2>&1; then
  candidate_apksigner="$(find "${ANDROID_HOME:-$HOME/Android/Sdk}"/build-tools -name apksigner 2>/dev/null | sort -V | tail -n 1 || true)"
  if [[ -n "$candidate_apksigner" && -x "$candidate_apksigner" ]]; then
    export PATH="$(dirname "$candidate_apksigner"):$PATH"
  fi
fi

if ! command -v apksigner >/dev/null 2>&1; then
  echo "apksigner is required. Add your Android SDK build-tools directory to PATH." >&2
  exit 1
fi

npm run lint
npm run typecheck:tests
npm run test
npm run build
npx cap sync android
./android/gradlew -p android assembleRelease

apk_path="android/app/build/outputs/apk/release/app-release.apk"
if [[ ! -f "$apk_path" ]]; then
  echo "Expected signed APK was not produced: $apk_path" >&2
  exit 1
fi

apksigner verify --verbose --print-certs "$apk_path"
echo "Release verification passed: $apk_path"
