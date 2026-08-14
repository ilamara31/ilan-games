-- =====================================================================
--  Ilan Games — STRICT ACCOUNTS  (username + password, no recovery)
--
--  Run this ONCE:  Supabase dashboard → SQL Editor → New query → paste → Run.
--  Run accounts-preflight.sql FIRST and read what it prints — it checks the
--  three things this file cannot fix by itself.
--
--  Safe to run again. It does not delete any player or any score, and every
--  existing account keeps working with the password it already has.
--
--  What the game gets:
--    account_signup(name, password)  -> 'ok' | 'taken' | 'invalid'
--    account_login (name, password)  -> 'ok' | 'wrong' | 'nouser' | 'invalid'
--    account_info  (name, password)  -> json {name, created_at, last_login}
--    account_auth  (name, password, recovery) -> same as account_login
--
--  The important change: signing in NEVER creates an account any more, and a
--  wrong password is always rejected. Before this, account_auth() created the
--  account whenever the name was unknown, so a typo silently made a new one.
--  There is no password reset — that is deliberate; the game shows each player
--  their own password in 👤 My Profile so they can't lose it.
--
--  Until this file is run the site falls back to the old account_auth RPC and
--  keeps working (just without the strict checks).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- the account table (created only if this is a brand-new project) ------------
create table if not exists public.players (
  name          text primary key,
  created_at    timestamptz not null default now()
);
alter table public.players add column if not exists created_at timestamptz not null default now();
alter table public.players add column if not exists last_login timestamptz;
alter table public.players enable row level security;   -- reachable only through the functions below


-- ---------------------------------------------------------------------------
-- 1. Keep a working copy of the OLD account_auth before replacing it.
--    It is the last-resort password checker: if a stored password was hashed
--    in some scheme the verifier below doesn't recognise, we ask the old
--    function instead, so nobody can be locked out of an account that used to
--    work. It is NEVER exposed to the API — it would still create accounts.
-- ---------------------------------------------------------------------------
do $mig$
declare def text; newdef text; r record;
begin
  if to_regprocedure('public.account_auth_legacy(text,text,text)') is null then
    select pg_get_functiondef(p.oid) into def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'account_auth' and p.prokind = 'f'
       and pg_get_function_identity_arguments(p.oid) = 'text, text, text'
       and pg_get_functiondef(p.oid) not like '%ig_check%'   -- don't copy OUR version (would recurse)
     limit 1;
    if def is not null then
      newdef := regexp_replace(def, 'FUNCTION\s+public\.account_auth\s*\(', 'FUNCTION public.account_auth_legacy(');
      if newdef = def then
        raise exception 'accounts-setup: could not rename the old account_auth. Send Claude this: %', left(def, 300);
      end if;
      execute newdef;
    end if;
  end if;

  -- lock the legacy copy away from the public API
  for r in select p.oid::regprocedure::text as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'account_auth_legacy'
  loop
    execute 'revoke all on function ' || r.sig || ' from public';
    begin execute 'revoke all on function ' || r.sig || ' from anon, authenticated';
    exception when undefined_object then null; end;
  end loop;
end
$mig$;


-- ---------------------------------------------------------------------------
-- 2. Remove EVERY old account_auth overload.
--    An older build of the site called account_auth(name, password) with two
--    arguments. Leaving that 2-argument version in place would keep the old
--    "signing in creates the account" behaviour reachable from the API — and
--    would also make 2-argument calls ambiguous once the new one has a
--    default. Both problems go away by dropping them all and creating exactly
--    one function below; old 2-argument callers then reach the strict version.
-- ---------------------------------------------------------------------------
do $drop$
declare r record;
begin
  for r in select p.oid::regprocedure::text as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'account_auth'
  loop execute 'drop function ' || r.sig; end loop;
end
$drop$;


-- ---------------------------------------------------------------------------
-- 3. Work out which column already holds the passwords and wrap it, so the
--    rest of this file doesn't need to know what it's called.
-- ---------------------------------------------------------------------------
do $cols$
declare col text; blockers text;
begin
  select column_name into col
    from information_schema.columns
   where table_schema = 'public' and table_name = 'players'
     and column_name not in ('name', 'recovery_hash', 'created_at', 'last_login')
     and udt_name in ('text', 'varchar', 'bpchar')                       -- must be a text column
     and (column_name ilike '%pass%' or column_name ilike '%pw%' or column_name ilike '%hash%'
          or column_name ilike '%secret%' or column_name ilike '%code%' or column_name ilike '%pin%'
          or column_name ilike '%key%')
   order by (column_name ilike '%pass%') desc, (column_name ilike '%pw%') desc,
            (column_name ilike '%hash%') desc, column_name               -- deterministic on a re-run
   limit 1;

  if col is null then
    if exists (select 1 from public.players) then
      raise exception 'accounts-setup: cannot tell which column of public.players holds the password. Run accounts-preflight.sql and send Claude the column list.';
    end if;
    alter table public.players add column if not exists pass_hash text;   -- brand-new project
    col := 'pass_hash';
  end if;

  -- Creating an account writes only (name, <password column>). Any OTHER
  -- required column without a default would make every signup fail at runtime,
  -- so refuse now rather than break sign-ups later.
  select string_agg(column_name, ', ') into blockers
    from information_schema.columns
   where table_schema = 'public' and table_name = 'players'
     and is_nullable = 'NO' and column_default is null
     and column_name not in ('name', col);
  if blockers is not null then
    raise exception 'accounts-setup: public.players has required column(s) with no default: %. Make them nullable (or give them a default) and run this file again.', blockers;
  end if;

  -- Read the stored hash. Prefers an exact-case name match, then is stable, so
  -- an old case-variant duplicate ("bob" vs "Bob") can never pick at random.
  execute format($f$
    create or replace function public.ig_pw_read(p_name text) returns text
    language sql security definer set search_path = extensions, public, pg_temp as $b$
      select %I from public.players
       where lower(name) = lower(btrim(p_name))
       order by (name = btrim(p_name)) desc, name
       limit 1;
    $b$;
  $f$, col);

  execute format($f$
    create or replace function public.ig_pw_create(p_name text, p_hash text) returns boolean
    language plpgsql security definer set search_path = extensions, public, pg_temp as $b$
    begin
      insert into public.players(name, %I) values (btrim(p_name), p_hash);
      return true;
    exception when unique_violation then
      return false;
    end;
    $b$;
  $f$, col);
end
$cols$;


-- ---------------------------------------------------------------------------
-- 4. Password check. Understands the schemes this project could have used
--    (bcrypt/crypt, sha256, md5 — salted with the name or not). Anything it
--    does NOT recognise returns false and is handed to account_auth_legacy,
--    which knows the real scheme. crypt() raises on salt formats it doesn't
--    implement, so that call is trapped: a raise here must never turn into a
--    500 that skips the legacy fallback.
-- ---------------------------------------------------------------------------
create or replace function public.ig_verify(p_name text, p_hash text, p_pw text)
returns boolean
language plpgsql
set search_path = extensions, public, pg_temp
as $$
declare nm text := lower(btrim(coalesce(p_name, '')));
begin
  if p_hash is null or p_hash = '' or p_pw is null or p_pw = '' then return false; end if;

  if left(p_hash, 1) = '$' then
    begin
      return crypt(p_pw, p_hash) = p_hash;
    exception when others then return false;            -- unknown salt format → let legacy decide
    end;
  end if;

  if p_hash ~ '^[0-9a-f]{64}$' then
    return encode(digest(p_pw, 'sha256'), 'hex') = p_hash
        or encode(digest(nm || p_pw, 'sha256'), 'hex') = p_hash
        or encode(digest(p_pw || nm, 'sha256'), 'hex') = p_hash;
  end if;

  if p_hash ~ '^[0-9a-f]{32}$' then
    return md5(p_pw) = p_hash or md5(nm || p_pw) = p_hash or md5(p_pw || nm) = p_hash;
  end if;

  return false;   -- deliberately NOT "p_hash = p_pw": never accept a plain match
end;
$$;

-- the same username rules the game enforces in the browser (new names only)
create or replace function public.ig_name_ok(p_name text)
returns boolean
language sql immutable
as $$
  select p_name is not null
     and char_length(btrim(p_name)) between 3 and 16
     and btrim(p_name) ~ '^[A-Za-z0-9 _-]+$'
     and btrim(p_name) ~ '[A-Za-z0-9]'
     and btrim(p_name) !~* '^guest[-_ ]?[0-9]{3,}$';
$$;


-- ---------------------------------------------------------------------------
-- 5. Credential check — the single place a password is judged.
--    NOT declared stable: the legacy fallback is someone else's function and
--    may write (e.g. touch a last-seen column), which a stable function is
--    forbidden to do.
-- ---------------------------------------------------------------------------
create or replace function public.ig_check(p_name text, p_password text)
returns text
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
declare h text; ok boolean := false;
begin
  if p_name is null or btrim(p_name) = '' or p_password is null or p_password = '' then return 'invalid'; end if;
  if not exists (select 1 from public.players where lower(name) = lower(btrim(p_name))) then return 'nouser'; end if;

  h := public.ig_pw_read(p_name);
  begin
    ok := public.ig_verify(p_name, h, p_password);
  exception when others then ok := false;
  end;

  -- Last resort for a hash scheme we don't recognise: ask the old function.
  -- Pass the name exactly as stored, so it can only answer 'ok' or 'wrong' —
  -- it must never be handed a spelling it would treat as a new account.
  if not ok and to_regprocedure('public.account_auth_legacy(text,text,text)') is not null then
    begin
      ok := (public.account_auth_legacy(
               (select name from public.players
                 where lower(name) = lower(btrim(p_name))
                 order by (name = btrim(p_name)) desc, name limit 1),
               p_password, null) = 'ok');
    exception when others then ok := false;
    end;
  end if;

  return case when ok then 'ok' else 'wrong' end;
end;
$$;

-- Create a NEW account. Never touches an existing one.
create or replace function public.account_signup(p_name text, p_password text)
returns text
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
declare made boolean;
begin
  if not public.ig_name_ok(p_name) then return 'invalid'; end if;
  if p_password is null or char_length(p_password) < 4 or char_length(p_password) > 64 then return 'invalid'; end if;
  if exists (select 1 from public.players where lower(name) = lower(btrim(p_name))) then return 'taken'; end if;

  made := public.ig_pw_create(btrim(p_name), crypt(p_password, gen_salt('bf')));
  if not made then return 'taken'; end if;

  update public.players set last_login = now() where name = btrim(p_name);
  return 'ok';
end;
$$;

-- Sign in to an EXISTING account. Never creates one; a wrong password fails.
-- On success it answers 'ok:<name as stored>'. The game keeps each account's
-- saves apart by name, and two accounts left over from the old code can differ
-- only in capitalisation ("Bob" / "bob") — so it must use the spelling the
-- database holds, never the one that happened to be typed in.
create or replace function public.account_login(p_name text, p_password text)
returns text
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
declare res text; canon text;
begin
  res := public.ig_check(p_name, p_password);
  if res <> 'ok' then return res; end if;
  select name into canon from public.players
   where lower(name) = lower(btrim(p_name))
   order by (name = btrim(p_name)) desc, name limit 1;
  update public.players set last_login = now() where name = canon;
  return 'ok:' || canon;
end;
$$;

-- Account details for 👤 My Profile. Password required — you only see your own.
create or replace function public.account_info(p_name text, p_password text)
returns json
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
declare r record;
begin
  if public.ig_check(p_name, p_password) <> 'ok' then return null; end if;
  select name, created_at, last_login into r
    from public.players
   where lower(name) = lower(btrim(p_name))
   order by (name = btrim(p_name)) desc, name
   limit 1;
  return json_build_object('name', r.name, 'created_at', r.created_at, 'last_login', r.last_login);
end;
$$;

-- Kept for the older callers (feedback-setup.sql / feedback2-setup.sql check
-- credentials with this, and so may a cached copy of the game). Now STRICT:
-- it verifies, it never creates an account.
create function public.account_auth(p_name text, p_password text, p_recovery text default null)
returns text
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
begin
  return public.ig_check(p_name, p_password);
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. Who may call what. The helpers stay private to the database.
-- ---------------------------------------------------------------------------
revoke all on function public.ig_pw_read(text)            from public, anon, authenticated;
revoke all on function public.ig_pw_create(text, text)     from public, anon, authenticated;
revoke all on function public.ig_verify(text, text, text)  from public, anon, authenticated;
revoke all on function public.ig_check(text, text)         from public, anon, authenticated;

grant execute on function public.account_signup(text, text)      to anon, authenticated;
grant execute on function public.account_login(text, text)       to anon, authenticated;
grant execute on function public.account_info(text, text)        to anon, authenticated;
grant execute on function public.account_auth(text, text, text)  to anon, authenticated;
grant execute on function public.ig_name_ok(text)                to anon, authenticated;

notify pgrst, 'reload schema';
