# Reply to App Review — Guideline 2.1, Information Needed

Paste the text below into **Reply to App Review**, and also into the **Notes**
field of App Review Information (Apple asks for both, and Notes carries forward
to future submissions).

Item 1 is a screen recording — see the shot list at the bottom.

---

## 2. Purpose and target audience

Ilan Stack Tower is a single-player arcade game. A block slides horizontally
above a tower and the player taps once to drop it. A clean drop grows the tower;
an inaccurate one has its overhang sliced away, so the next block is narrower and
the game gets harder. Dropping a block perfectly aligned keeps full width and
starts a combo, which widens the tower back out.

It is aimed at casual players of any age who want a game that can be learned in
one tap and played in thirty-second sessions — waiting for a bus, queuing, a
break between tasks. There is no timer, no lives and no penalty for stopping. It
is rated 4+ and contains no violence, advertising, tracking or purchases.

The web version has been publicly playable for some time at
https://ilamara31.github.io/ilan-games/stack/ — this app is a native rewrite of
that game in Swift and SpriteKit, sharing its leaderboard.

## 3. Setting up and accessing the main features

**No account is required.** The game is fully playable offline from first
launch; on first run it opens a short three-drop tutorial, then the title screen.

**Demo account (already created, ready to use):**

    Username: AppReview
    Password: Review2026

This account already has a score of 28 on the leaderboard.

- **Play:** tap STACK on the title screen, then tap anywhere to drop each block.
- **Leaderboard:** tap Leaderboard on the title screen. Visible without signing in.
- **Sign in:** tap Sign in on the title screen and enter the credentials above.
  Any unused username (3-16 characters) with a password of 4 or more characters
  will create a new account immediately — there is no email step and no
  verification.
- **Account deletion** (required under 5.1.1(v)): sign in, tap the account button
  on the title screen (it shows the signed-in username), then **Delete account**
  and confirm. This permanently removes the account and all of its scores from
  the leaderboard; the username becomes available again. It can be verified by
  reopening the Leaderboard afterwards — the entry is gone.

## 4. External services used

| Service | Used for |
|---|---|
| Supabase (supabase.com) — hosted PostgreSQL with a REST API | The optional account system and the shared leaderboard. Requests go only to our own project, over HTTPS. Passwords are stored only as bcrypt hashes. |

That is the complete list. The app contains **no** analytics SDK, no advertising
network, no crash reporting, no payment processing, no AI or machine-learning
service, and no third-party data provider. If the player does not sign in, the
app makes no network requests at all.

## 5. Regional differences

There are none. The app behaves identically in every region: the same game, the
same single leaderboard shared worldwide, no geographically restricted content or
features, and no region-specific pricing (the app is free everywhere). The
interface is English only.

## 6. Regulated industry / third-party material

Not applicable. The app is an original arcade game in no regulated industry. All
material is our own: the game code, the artwork and app icon, and the sound
effects, which are synthesised at runtime with AVAudioEngine rather than being
audio files. It contains no licensed music, video, imagery, trademarks or other
third-party protected material.

---

## 1. Screen recording — shot list

Record on the iPhone itself (Settings > Control Centre > add Screen Recording,
then swipe down and tap the record button). One continuous take, roughly 90
seconds, no editing needed. AirDrop it to the Mac afterwards.

Apple asks that it starts from launch and shows the typical flow:

1. Start the recording on the home screen, then tap the Stack Tower icon —
   they want to see the launch itself.
2. Let the tutorial play; drop the three blocks it asks for.
3. On the title screen, tap STACK and play a normal run until the tower topples.
   Show the game-over card.
4. Tap Leaderboard. Let it load so the shared scores are visible. Close it.
5. Tap Sign in. Enter AppReview / Review2026. Show that it signs in and the
   button now shows the username.
6. Open the Leaderboard again so the signed-in account is visible on it.
7. Tap the account button, then **Delete account**, and confirm.
8. Open the Leaderboard once more to show the entry is gone.
9. Stop the recording.

Step 7 and 8 are the ones Apple specifically asked for — account deletion has to
be demonstrated, not just described.

Note that deleting the demo account in step 7 removes it. Either create it again
afterwards, or sign up a fresh username during the recording and delete that
instead, leaving AppReview intact for the reviewer.
