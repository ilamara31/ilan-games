# Stack Tower — iOS

Standalone native iOS game — Stack Tower, rewritten in Swift and SpriteKit. No
web view, no bundled HTML: the tower, physics, audio and menus are all native.
It is fully offline and makes no network calls.

## What's here

```
App/Sources/
  GameScene.swift       the game: tower, slicing, combos, camera, debris
  GameViewController.swift  hosts the scene and the menu card
  MenuOverlayView.swift  title / game-over card (UIKit, SF Symbols)
  CoachBubble.swift      the tutorial's speech bubble
  ToneGenerator.swift    AVAudioEngine blips — the old WebAudio tones, natively
  Haptics.swift          drop / perfect / topple feedback
  Scores.swift           best score + tutorial flag in UserDefaults
  Palette.swift          shared colours and layout constants
UITests/                 drives real taps and asserts a run plays through
App/Assets.xcassets/     1024px app icon + launch colour
App/Info.plist           portrait-only, full-screen, status bar hidden
project.yml              XcodeGen spec — regenerate with `xcodegen generate`
tools/make-icon.js       regenerates the app icon
tools/verify-build.sh    simulator build check — no Apple account needed
tools/archive.sh         signed archive + .ipa export for App Store Connect
```

Bundle id `com.ilangames.stacktower`, version 1.0 (build 1), iOS 15+.

## How it differs from the web version

Same game, same numbers — block height, speeds, the 7pt perfect tolerance, the
combo widening rule and the camera easing are all carried over unchanged.

- Rendered by SpriteKit rather than a canvas, so there is no web view at all.
- Sound is synthesised with `AVAudioEngine` instead of WebAudio, on the `.ambient`
  session so it never interrupts the player's music.
- Best score lives in `UserDefaults`, so it survives updates and is backed up.
- The site's login / leaderboard / all-games buttons are gone — they needed the
  Supabase backend, and a dead button is a review rejection.
- SF Symbols replace the emoji in the UI, so no glyph can go missing.
- Native haptics on each landed block, on a perfect stack, and on game over.
- HUD and tower clear the Dynamic Island and home indicator via safe-area insets.
- The score is exposed to VoiceOver.

## Build

Requires **Xcode 26.3** — install with `xcodes install 26.3`. Not 26.4 or newer:
those need macOS 26.2, and this Mac is on 15.7.7. The App Store copy of Xcode is
26.6, so it will not install here either.

```
tools/verify-build.sh      # compiles for the simulator, no signing needed
open StackTower.xcodeproj
```

`xcodegen generate` regenerates the project after editing `project.yml`; the
scripts do it for you.

In Xcode: select the StackTower target → Signing & Capabilities → check
*Automatically manage signing* → pick your Team. Then Product → Run on a simulator
or device.

## Publish

1. **Apple Developer Program** — enroll at developer.apple.com ($99/yr). ID
   verification takes 24–48h. Nothing below works until this is active.
2. **App Store Connect** → My Apps → **+** → New App.
   - Platform iOS, Name `Stack Tower` (must be globally unique — see
     `store-metadata.md` for fallbacks), Primary language English,
     Bundle ID `com.ilangames.stacktower`, SKU `stacktower-ios`.
3. **Upload the build**: either
   ```
   TEAM_ID=XXXXXXXXXX tools/archive.sh
   ```
   which archives, signs and exports an `.ipa`, or in Xcode set the destination to
   *Any iOS Device (arm64)* → Product → Archive → Distribute App → App Store Connect.
   Processing takes 15–60 min before the build is selectable in App Store Connect.
4. **Fill the listing** using `store-metadata.md`: description, keywords, support
   URL, screenshots, age rating, and App Privacy (answer **Data Not Collected** —
   the app collects nothing).
5. **Screenshots** — required: 6.9" iPhone. Run in the iPhone 16 Pro Max simulator,
   ⌘S to save each shot. Grab the menu, mid-run with a combo, and the game-over screen.
6. Submit for review. First review is typically 1–3 days.

## Worth knowing before you submit

Guideline **4.2 Minimum Functionality** is the residual risk for any small
single-mode game, but the usual trigger — a repackaged website in a web view — does
not apply here: this is a native SpriteKit game with no web content of any kind.
If it is still rejected, the fix is more depth (game modes, Game Center
leaderboards, unlockables) rather than an appeal.

## Tests

```
xcodebuild test -project StackTower.xcodeproj -scheme StackTowerUITests \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max,OS=latest'
```

The UI test plays a real run — clears the tutorial, starts from the title card and
stacks until the tower topples — and attaches screenshots at each stage. Extract
them with `xcrun xcresulttool export attachments --path <.xcresult> --output-path <dir>`;
they double as App Store screenshot sources.
