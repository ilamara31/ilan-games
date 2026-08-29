#!/bin/bash
# Compiles the app for the simulator. No signing, no Apple account needed —
# this just proves the project and Swift sources are sound.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v xcodegen >/dev/null && xcodegen generate >/dev/null

DEST='platform=iOS Simulator,name=iPhone 16 Pro,OS=latest'
echo "Building StackTower for the simulator…"
xcodebuild \
  -project StackTower.xcodeproj \
  -scheme StackTower \
  -configuration Debug \
  -destination "$DEST" \
  -derivedDataPath build/DerivedData \
  CODE_SIGNING_ALLOWED=NO \
  build | tail -30

echo
echo "Build succeeded. App bundle:"
find build/DerivedData -name 'StackTower.app' -maxdepth 6 | head -1
