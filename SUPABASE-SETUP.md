# Backend work needed before submitting

The app talks to the existing Supabase project (`xanrofecdpoljnerpsow`) and reuses
the website's accounts, so web and iOS share one leaderboard. Two things need
attention on the server side.

## 1. `account_delete` — required by Apple, does not exist yet

Guideline **5.1.1(v)**: any app that lets people create an account must also let
them delete it *from inside the app*. Offering only "sign out", or telling people
to email you, is a rejection.

The app already ships the UI for this — Sign in → Delete account — and calls:

```
POST /rest/v1/rpc/account_delete   { "p_name": ..., "p_password": ... }
```

That function does not exist on your backend yet, so the button will currently
fail with "the server didn't complete the request". It needs adding.

Your accounts live in `players(name, pin_hash, recovery_hash)`, with bcrypt
hashes via pgcrypto — `crypt(password, gen_salt('bf'))`, verified as
`h = crypt(password, h)`. `account_delete` mirrors that check exactly.

**The SQL is written and ready: `account-delete.sql`.** It parses clean against
the real PostgreSQL parser. Run it in Supabase → SQL Editor. It is safe to
re-run.

Two things worth knowing about how it is written:

- It pins `search_path`. A `SECURITY DEFINER` function without that can be
  hijacked by a caller who puts their own `players` or `crypt` earlier in the
  path. Your `account_auth` does not pin it — worth fixing there too.
- It deletes the player's scores using `to_regclass` guards rather than assuming
  a table name, because the `leaderboard` view's base table is not visible from
  the client. If your scores table is not called `scores`, the account will be
  removed but its rows may survive. I can verify this empirically once the
  function exists — see below.

Verify before shipping:

Once it is installed, I can verify the whole path end to end without touching a
real account: create a throwaway player, post a score as them, confirm it shows
on the board, delete the account, then confirm both the player and the score are
gone. That also settles the scores-table question above. Just say when it is in.

## 2. Password rules are weak

The website allows 4-character passwords, and the app matches it so the same
accounts work in both places. That is a genuine weakness — these passwords guard a
public leaderboard, not anything sensitive, but 4 characters is trivially
brute-forced and the RPC has no rate limiting visible from the client.

Not a blocker for review. Worth raising the minimum on both web and app at some
point, and adding rate limiting to `account_auth`.

## What the app sends

| When | Call |
|---|---|
| Sign in / create account | `account_auth(p_name, p_password, p_recovery: null)` |
| After a run ends | `post_score(p_name, p_password, p_game: "stack", p_score, p_guest: false)` |
| Opening the leaderboard | `GET /rest/v1/leaderboard?game=eq.stack&order=score.desc` |
| Delete account | `account_delete(p_name, p_password)` — **needs creating** |

`account_signup`, `account_login` and `account_info` are referenced by the
website's `auth.js` but do **not** exist on this project; the site silently falls
back to `account_auth`. The app calls `account_auth` directly.

The password is stored in the iOS **Keychain** (not UserDefaults), because
`post_score` re-authenticates on every submit.
