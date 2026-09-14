# Time Duel — test build

Not linked from the arcade home page and not in `sw.js`. It is reachable only
by URL, the same way `cricket-test/` and `catch-test/` are.

## 1. Install the database (once)

Supabase → **SQL Editor** → paste all of `timeduel-setup.sql` → **Run**.

It should print `Time Duel: database ready`.

It only creates `td_*` objects. It never writes to `players`, `leaderboard` or
anything else the arcade already uses, and it is safe to run again — re-running
upgrades an older install in place.

If it errors, send me the message verbatim; the line number alone is enough.

## 2. Serve it locally

```
cd /Users/rads/ilan-games-timeduel
python3 -m http.server 8911 --bind 127.0.0.1
```

- this laptop: <http://127.0.0.1:8911/timeduel/>
- a phone on the same wifi: <http://192.168.1.11:8911/timeduel/>

Phones on other networks cannot reach it. That is what "local only" costs; the
moment it is worth hosting, one commit puts it on GitHub Pages.

## 3. Play a real two-player round

Multiplayer needs two accounts, not two tabs of one account — the wallet is
per account. Easiest:

1. Normal window: sign in as yourself, **Multiplayer → Classic → Bronze →
   Create Room**. Note the 4-letter code.
2. Private window: sign up as anyone, **Join Room**, type the code.
3. Host taps **Start Round**.

Supabase realtime is a live remote service, so two windows on one laptop is a
genuine network test, not a simulation.

## 4. What to look at

**The round itself**
- 3 → 2 → 1 → START appears at the same moment in both windows.
- Classic shows a running timer; Blind shows `· · ·` and nothing that ticks.
- Stopping before START does nothing except say "wait for START".
- Closest player wins; an exact hit says **DOT! PERFECT**.

**The money** — the part worth being fussy about
- Coins drop by the entry fee the moment you sit down, not when the round starts.
- Winner ends up net +entry, loser net −entry. Nothing else moves.
- **Leave room** in a lobby refunds you immediately.
- Host leaving refunds everyone.
- Close the tab in a lobby: the fee comes back (there is a beacon for this).
- Refresh mid-round: you should land back in the room, not outside it.

**The awkward paths**
- Turn wifi off mid-round. It should say "Reconnecting…", then recover — not hang.
- Let a round time out without tapping: it should tell you how long until the
  other player forfeits, then settle. Never freeze.
- Host taps **Play again**: the other player must see **Take your seat**, not
  "Waiting for the host" forever.

**Practice** — targets from 0.3 s to 8.0 s, rewards 50 / 20 / 10 / 5 / 2 by
accuracy, capped at 500 coins a day.

## 5. Known limitation, by design

The target is shown before the round and your tap is timed on your own device —
both required, and together they mean **a determined person with browser
devtools can submit a perfect answer every round**. No server check can tell
that apart from a player with genuinely perfect timing; it is the same message.

What the server does do: refuse physically impossible claims, never hand the
target or a rival's time to anyone not sitting in the room, and keep the coin
accounting exact.

If that trade is not acceptable, the fix is a design change — hide the target
until the round ends, or have the server time the round (which costs the
"latency never decides the winner" guarantee). Worth deciding before this goes
anywhere public.

## 6. Cleaning up afterwards

The integration suite creates accounts `tdtest1`…`tdtest8`. To remove them:

```sql
delete from public.td_history where name ~ '^tdtest[1-8]$';
delete from public.players    where name ~ '^tdtest[1-8]$';
```

`td_player`, `td_room` and `td_seat` cascade from `players`, so deleting the
account clears those. `td_history` deliberately does **not** — a player's
record of past rounds should survive, so it has no foreign key and has to be
cleared explicitly, as above.

To remove the game entirely:

```sql
drop table if exists public.td_history, public.td_seat,
                     public.td_room, public.td_player cascade;
```
