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

The exact SQL depends on your table names, which aren't visible from the client.
Check what `account_auth` does (Supabase dashboard → Database → Functions) and
mirror its table and password-hashing scheme. The shape is:

```sql
create or replace function public.account_delete(p_name text, p_password text)
returns boolean
language plpgsql
security definer
as $$
declare
  ok boolean;
begin
  -- Verify the password exactly the way account_auth does — same table,
  -- same hashing. Do not weaken this: it is the only thing stopping
  -- someone deleting another player's account.
  select true into ok
    from accounts                      -- ← your real accounts table
   where name = p_name
     and password_hash = crypt(p_password, password_hash);   -- ← your real scheme

  if not found then
    return false;
  end if;

  delete from scores  where name = p_name;   -- ← whatever feeds `leaderboard`
  delete from accounts where name = p_name;
  return true;
end;
$$;

grant execute on function public.account_delete(text, text) to anon;
```

Verify before shipping:

```bash
curl -s -X POST "https://xanrofecdpoljnerpsow.supabase.co/rest/v1/rpc/account_delete" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"p_name":"<test account>","p_password":"<wrong>"}'      # must be false
```

Make a throwaway account and delete it for real before you submit — a reviewer will
press that button.

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
