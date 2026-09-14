#!/bin/bash
# Archives a signed build and exports an .ipa ready for App Store Connect.
# Needs an active Apple Developer Program membership and a TEAM_ID.
#
#   TEAM_ID=XXXXXXXXXX tools/archive.sh
#
# Your TEAM_ID is the 10-character code at
# developer.apple.com → Membership Details → Team ID.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${TEAM_ID:?Set TEAM_ID first — see the comment at the top of this script}"

ARCHIVE="build/StackTower.xcarchive"
EXPORT_DIR="build/export"

command -v xcodegen >/dev/null && xcodegen generate >/dev/null

cat > build/ExportOptions.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>${TEAM_ID}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>destination</key><string>export</string>
</dict>
</plist>
PLIST

echo "Archiving…"
xcodebuild archive \
  -project StackTower.xcodeproj \
  -scheme StackTower \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  -allowProvisioningUpdates | tail -20

echo "Exporting .ipa…"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist build/ExportOptions.plist \
  -exportPath "$EXPORT_DIR" \
  -allowProvisioningUpdates | tail -20

echo
echo "Done: $(find "$EXPORT_DIR" -name '*.ipa' | head -1)"
echo "Upload it with:  xcrun altool --upload-app -f <ipa> -t ios -u <apple-id> -p <app-specific-password>"
echo "or open Xcode → Window → Organizer → Distribute App."
