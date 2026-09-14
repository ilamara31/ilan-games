-- account_delete — required by App Store Guideline 5.1.1(v): an app that lets
-- people create an account must let them delete it from inside the app.
--
-- Password verification mirrors account_auth exactly: bcrypt via pgcrypto,
-- checked with `h = crypt(p_password, h)`. This is the only thing standing
-- between a player and someone else deleting their account, so it must not be
-- relaxed.
--
-- Safe to re-run.

create or replace function public.account_delete(p_name text, p_password text)
returns boolean
language plpgsql
security definer
-- Pin the search_path: a SECURITY DEFINER function without this can be hijacked
-- by a caller who puts their own `players` or `crypt` earlier in their path.
-- `extensions` must be on it — Supabase installs pgcrypto there, not in public,
-- so pinning to public alone makes crypt() vanish and every call error out.
set search_path = public, extensions, pg_temp
as $$
declare
  h text;
  n text;
begin
  n := trim(p_name);
  if n = '' or coalesce(p_password, '') = '' then
    return false;
  end if;

  select pin_hash into h from players where name = n;
  if h is null then
    return false;                      -- no such account
  end if;
  if h <> crypt(p_password, h) then
    return false;                      -- wrong password
  end if;

  -- Remove the player's scores wherever they live. to_regclass returns null for
  -- a name that does not exist, so each block is skipped rather than erroring.
  -- On this project there is no public.scores and `leaderboard` is a real table,
  -- so the second block is the one that does the work. The first is kept in case
  -- the schema is ever split.
  if to_regclass('public.scores') is not null then
    execute 'delete from public.scores where name = $1' using n;
  end if;

  if to_regclass('public.leaderboard') is not null
     and (select relkind from pg_class where oid = to_regclass('public.leaderboard')) = 'r' then
    execute 'delete from public.leaderboard where name = $1' using n;
  end if;

  delete from players where name = n;
  return true;
end;
$$;

grant execute on function public.account_delete(text, text) to anon;
