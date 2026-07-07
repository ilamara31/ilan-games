# Ilan's Arcade 🎮

Games made by Ilan!

🌐 **Play online:** https://ilamara31.github.io/ilan-games/

## Games
- 🏏 **Super Over Cricket** — `cricket/` — timing-based IPL cricket, chase the target and win the cup.
- 🧺 **Basket Catch** — `catch/` — move the basket and catch the falling things.
- 🍔 **Basket Catch 2** — `catch2/` — catch fruit & dodge junk food; junk fills a one-way 🤢 Tummy meter, 5 lives, plus 🎉 Cheat Day / 🌪️ Junk Storm events.
- 🏎️ **Indian Grand Prix** — `f1/` — pseudo-3D F1 racer, beat the grid over 3 laps for the podium.
- ⚽ **Penalty Kings** — `football/` — penalty shootout knockout tournament.
- 🌈 **Rainbow Obby** — `obby/` — 3D obstacle course (Three.js): 50 stages across 5 worlds, coins, checkpoints, and a shop of skins, trails, auras &amp; power coils.
- 🏓 **Ping Pong Tour** — `pptour/` — first-person table tennis: tutorial, tournament ladder (Quarter-Final → World Championship), coins, and a shop of racket designs.
- 🍉 **Fruit Arena** — `fruit-arena/` — slice fruit, dodge bombs, chain power-ups, spam the giant fruit; coach-guided tutorial, progressive missions, and a shop of blades & effects.
- 🟩 **Paper Territory** — `paper/` — claim land with your trail, dodge rivals, own the most territory; global leaderboard.
- 🏗️ **Stack Tower** — `stack/` — tap to drop & align blocks, build as high as you can with perfect-stack combos; global leaderboard.
- 🏹 **Archer Duel** — `archer/` — aim, power & arc your arrows to KO tougher rivals each round; global leaderboard.

## How to play locally
Open `index.html` in any web browser. No installation needed — they're plain HTML5 games.

## Live website
Published with GitHub Pages: **https://ilamara31.github.io/ilan-games/**

## Adding a new game
Put the game in its own folder (e.g. `tennis/index.html`) and add these two
lines just before `</body>`:

```html
<script src="../analytics.js" defer></script>
<script src="../announce.js" defer></script>
```

That single include gives the new game, for free:
- a **🏠 Home button** (auto-injected only if the game doesn't already have its
  own home/exit — a `#homeBtn`, a link to `../`, or an onclick going to `../`),
- analytics (Clarity recordings + `game_open` events), and
- in-app announcements.

Then add a card for it on the home page (`index.html`) and, if you want it to
work offline, list its files in `sw.js` and bump the cache version.

## Analytics & player messages (Phase 1)
Two shared scripts load on every page: `analytics.js` and `announce.js`.
The home page is marked with `<body data-arcade-home>`; every other page is
treated as a game automatically (no hard-coded game list to maintain).

**See who plays what (Microsoft Clarity):**
1. Create a free project at https://clarity.microsoft.com
2. Copy the **Project ID** and paste it into `CLARITY_PROJECT_ID` near the top of `analytics.js`.
3. Commit & push. You get session recordings, heatmaps, and rage/dead-click reports,
   tagged by `game` (and `player` name if set). Custom events already fire:
   `game_card_click`, `game_open`, `announcement_*`. Add more anywhere with
   `window.track('game_over', { score: 42 })`.

**Send a message to players (no backend):** edit `messages.json`, commit, push.
- `target: "all"` → everyone. `target: "obby"` or `["obby","cricket"]` → only players
  on that game now or who've played it before on their device.
- Optional `cta` button, `start`/`end` dates, and `level` (info/success/warning).
- Give each message a unique `id`; players can dismiss it and won't see it again.

## Working on a different laptop
1. Install Git and the GitHub CLI (`gh`).
2. `gh auth login` and sign in as Ilan.
3. `git clone https://github.com/<username>/ilan-games.git`
4. Edit the games, then `git add .`, `git commit -m "..."`, `git push`.
