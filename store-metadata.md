# App Store listing — Stack Tower

Copy these into App Store Connect. Character limits are Apple's.

## Name (30 max)
```
Ilan Stack Tower
```
`Stack Tower` on its own was already taken. This keeps the searchable phrase
intact with the brand in front. 16 characters.

The name under the home screen icon is a separate thing — `CFBundleDisplayName`
in Info.plist — and stays **Stack Tower**. That is deliberate: the store listing
needs to be globally unique, the icon does not.

## Subtitle (30 max)
```
Time your drop. Build it high.
```

## Promotional text (170 max, editable without a new build)
```
How high can you get? Line up each falling block, keep the overhang off, and chain perfect drops for a combo. One tap to play.
```

## Description (4000 max)
```
Ilan Stack Tower is a one-tap game about timing.

A block slides back and forth above your tower. Tap to drop it. Land it clean and the tower grows. Land it off-centre and the overhang is sliced away — your next block is narrower, and the one after that narrower still.

Line a block up perfectly and you keep the full width, plus a combo. String enough perfect drops together and the tower actually widens back out, pulling you back from the brink.

Blocks speed up the higher you climb. There is no timer and no lives. One miss ends the run.

• One tap to play — no tutorial needed, though there's a short one if you want it
• Perfect-drop combos that widen the tower and reward precision
• Your best score is kept on device
• Play offline with no account at all — nothing is sent
• Optional account puts you on a leaderboard shared with the web version
• No ads, no tracking

Sign in with the same username you use on the Ilan Games website and your scores
sit on one shared leaderboard across web and iPhone.

Short runs, quick restarts. Beat your best.
```

## Keywords (100 max, comma separated, no spaces after commas)
```
blocks,tap,arcade,casual,offline,timing,reflex,builder,skill,highscore,drop,balance,tall,stacking
```
(96 characters.)

`stack` and `tower` are deliberately **absent**: Apple indexes the app name, the
subtitle and the keyword field together, so repeating words already in the name
wastes characters. Dropping them freed room for `drop`, `balance`, `tall` and
`stacking`.

## What's New (first version)
```
First release.
```

## URLs
- **Support URL** (required): `https://ilamara31.github.io/ilan-games/`
- **Privacy Policy URL** (required): `https://ilamara31.github.io/ilan-games/privacy.html`
- **Marketing URL** (optional): `https://ilamara31.github.io/ilan-games/stack/`

All must resolve before submitting. The privacy page is written
(`privacy.html` in the ilan-games repo) but still has a placeholder email and
has not been pushed — do both, then confirm the URL loads.

## Category
- Primary: **Games** → Arcade
- Secondary: Games → Casual

## Age rating
All questionnaire answers are **None**. No violence, no user content, no web access,
no gambling. Result: **4+**.

## App Privacy
**This changed when accounts were added — it is no longer "Data Not Collected".**

Declare, under *Data Linked to You*:

| Category | Type | Purpose |
|---|---|---|
| Identifiers | User ID (the username) | App Functionality |
| User Content | Other (game scores) | App Functionality |

Answer **No** to tracking — nothing is shared with third parties, there is no
analytics and no advertising. The only network calls are to your own Supabase
project, for signing in, posting a score, and reading the leaderboard.

Playing without an account still sends nothing at all; the account is optional.

## Account deletion — required
Guideline 5.1.1(v) requires in-app account deletion. The UI is built, but the
`account_delete` function does not exist on the backend yet. See
`SUPABASE-SETUP.md`. **This must be working before you submit.**

## Pricing
Free, all territories. No in-app purchases.

## Export compliance
Already answered in Info.plist (`ITSAppUsesNonExemptEncryption = false`), so Apple
will not ask on upload.

## Screenshots
Required: **6.9" iPhone** (1320 × 2868). Everything else is optional — Apple scales
the 6.9" set down for smaller devices.

Capture in the iPhone 16 Pro Max simulator with ⌘S. Three good ones:
1. The title screen with the STACK button.
2. Mid-run, a tall tower with `PERFECT x3` showing.
3. The TOPPLED game-over screen with a score.

If you also list iPad, you need 13" iPad shots (2064 × 2752).
