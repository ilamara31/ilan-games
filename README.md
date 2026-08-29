# Stack Tower — iOS

Standalone native iOS app for the Stack Tower game from `ilan-games`. The game runs
fully offline inside a `WKWebView`; nothing is fetched at runtime.

## What's here

```
App/Sources/           Swift app shell (3 files)
App/www/index.html     the game, bundled — no network, no site dependencies
App/Assets.xcassets/   1024px app icon + launch colour
App/Info.plist         portrait-only, full-screen, status bar hidden
project.yml            XcodeGen spec — regenerate with `xcodegen generate`
tools/make-icon.js     regenerates the app icon
tools/verify-build.sh  simulator build check — no Apple account needed
tools/archive.sh       signed archive + .ipa export for App Store Connect
```

Bundle id `com.ilangames.stacktower`, version 1.0 (build 1), iOS 15+.

## How it differs from the web version

- The site-wide scripts (`auth.js`, `friends.js`, `analytics.js`, `supabase-config.js`,
  `announce.js`, `rec.js`) are stripped — the app makes no network calls at all.
- Log in / Leaderboard / All Games buttons removed; a button that does nothing is a
  review rejection. Tutorial and local best score stay.
- Native haptics on each landed block, on a perfect stack, and on game over.
- HUD and tower respect the notch and home indicator via safe-area insets.
- Served over a `stacktower://` scheme rather than `file://`, so `localStorage`
  (the best score) persists — it is unreliable on file origins in WKWebView.

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

Guideline **4.2 Minimum Functionality** is the realistic rejection risk for a small
single-mode game. It is aimed at repackaged websites, and this build is deliberately
not that: fully offline, no browser chrome, native haptics, a tutorial. It is a real
game, which is the main thing reviewers look for. If it is rejected anyway, the usual
fix is more depth — game modes, Game Center leaderboards, unlockables — rather than
an appeal.
