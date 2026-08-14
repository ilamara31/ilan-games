-- ============================================================================
--  ILAN GAMES — UNIQUE DISPLAY NAMES   (run ONCE in Supabase → SQL Editor)
--
--  No two players may share a name — guests included. Whoever holds a name
--  keeps it; anyone else typing it is told "That name is already taken."
--
--  Read the NOTICE messages this script prints when it finishes: the seeding
--  step reports how many existing names it protected.
-- ============================================================================

-- Same slug the client uses (friends.js nameKey): lowercase, runs of anything
-- that isn't a letter/digit become "_", trimmed, max 40 chars. "DA GOAT",
-- "da  goat" and "Da-Goat" are therefore the SAME name and cannot coexist.
create or replace function public.ig_name_key(p text)
returns text language sql immutable as $ig_name_key$
  select left(
           regexp_replace(
             regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '_', 'g'),
           '^_|_$', '', 'g'),
         40);
$ig_name_key$;

create table if not exists public.ig_name (
  name_key text primary key,               -- ig_name_key(name)
  name     text not null,                  -- as typed, for display
  token    text,                           -- owning device; NULL = seeded, unclaimed
  is_guest boolean not null default true,
  created  timestamptz not null default now(),
  seen     timestamptz not null default now()
);

alter table public.ig_name enable row level security;
-- Nobody reads this table directly — the tokens live here. All access is through
-- the security-definer functions below, which never return a token.
revoke all on public.ig_name from anon, authenticated;

-- A guest name nobody has used for this long stops blocking the name.
create or replace function public.ig_name_stale()
returns interval language sql immutable as $ig_name_stale$ select interval '90 days' $ig_name_stale$;

-- ---------------------------------------------------------------------------
--  Is this name available?
--    free | yours | guest | account | unclaimed_guest | unclaimed_account | invalid
--  "guest"   — another player is using it right now as a guest
--  "account" — it belongs to a registered account (its owner can still log in
--              with the password, from any device)
--  "unclaimed_*" — a name already in use before this system existed. It blocks
--              newcomers; the device that already answers to it adopts it on sight.
-- ---------------------------------------------------------------------------
create or replace function public.ig_name_status(p_name text, p_token text default null)
returns text language plpgsql security definer as $ig_name_status$
declare k text; r public.ig_name%rowtype;
begin
  k := public.ig_name_key(p_name);
  if k = '' then return 'invalid'; end if;
  select * into r from public.ig_name where name_key = k;
  if not found then return 'free'; end if;
  if coalesce(p_token, '') <> '' and r.token = p_token then return 'yours'; end if;
  -- a guest name nobody has used in a long time frees itself up again
  if r.is_guest and r.seen < now() - public.ig_name_stale() then return 'free'; end if;
  if r.token is null then
    return case when r.is_guest then 'unclaimed_guest' else 'unclaimed_account' end;
  end if;
  if r.is_guest then return 'guest'; end if;
  return 'account';
end $ig_name_status$;

-- ---------------------------------------------------------------------------
--  Guest claim.  p_existing = true only when the device is re-claiming the name
--  it already had saved locally (so it may adopt an "unclaimed" seeded row);
--  false when the player has just typed the name, which must never take over
--  a name somebody else is already using.
--  Returns: ok | taken | invalid
-- ---------------------------------------------------------------------------
create or replace function public.ig_name_claim_guest(p_name text, p_token text, p_existing boolean default false)
returns text language plpgsql security definer as $ig_name_claim_guest$
declare k text; r public.ig_name%rowtype;
begin
  k := public.ig_name_key(p_name);
  if k = '' or coalesce(p_token, '') = '' then return 'invalid'; end if;

  insert into public.ig_name(name_key, name, token, is_guest)
  values (k, p_name, p_token, true)
  on conflict (name_key) do nothing;

  -- FOR UPDATE serialises two devices racing for the same free name
  select * into r from public.ig_name where name_key = k for update;
  if not found then return 'invalid'; end if;

  if r.token = p_token then                                    -- already ours
    update public.ig_name set name = p_name, seen = now() where name_key = k;
    return 'ok';
  end if;

  -- Adopt our own legacy name — but only a GUEST row: a registered account's
  -- name is never handed over on a claim that carries no password.
  if r.token is null and coalesce(p_existing, false) and r.is_guest then
    update public.ig_name set token = p_token, name = p_name, seen = now() where name_key = k;
    return 'ok';
  end if;

  if r.is_guest and r.seen < now() - public.ig_name_stale() then
    update public.ig_name set token = p_token, name = p_name, seen = now() where name_key = k;
    return 'ok';                                                -- abandoned, taken over
  end if;

  return 'taken';
end $ig_name_claim_guest$;

-- ---------------------------------------------------------------------------
--  Account claim. The password is verified through the existing account_auth(),
--  so only the real owner can bind a registered name — and they can do it from
--  any device. Returns: ok | wrong | taken | invalid
-- ---------------------------------------------------------------------------
create or replace function public.ig_name_claim_account(p_name text, p_password text, p_token text)
returns text language plpgsql security definer as $ig_name_claim_account$
declare k text; r public.ig_name%rowtype; v_auth text;
begin
  k := public.ig_name_key(p_name);
  if k = '' or coalesce(p_token, '') = '' then return 'invalid'; end if;

  v_auth := public.account_auth(p_name, p_password, null);
  if v_auth not in ('ok', 'created') then return 'wrong'; end if;

  insert into public.ig_name(name_key, name, token, is_guest)
  values (k, p_name, p_token, false)
  on conflict (name_key) do nothing;

  select * into r from public.ig_name where name_key = k for update;
  if not found then return 'invalid'; end if;

  -- A guest sitting on the name does NOT lose it to a brand-new account…
  if r.is_guest and r.token is not null and r.token <> p_token
     and r.seen >= now() - public.ig_name_stale()
     and v_auth = 'created' then
    return 'taken';                      -- a live guest keeps it against a brand-new account
  end if;

  -- …but the verified owner of an existing account always gets their name back.
  update public.ig_name
     set token = p_token, name = p_name, is_guest = false, seen = now()
   where name_key = k;
  return 'ok';
end $ig_name_claim_account$;

-- Give a name back (guest changing their name). Only the holder can.
create or replace function public.ig_name_release(p_name text, p_token text)
returns void language plpgsql security definer as $ig_name_release$
begin
  delete from public.ig_name
   where name_key = public.ig_name_key(p_name) and token = p_token and is_guest;
end $ig_name_release$;

grant execute on function public.ig_name_key(text)                             to anon, authenticated;
grant execute on function public.ig_name_stale()                               to anon, authenticated;
grant execute on function public.ig_name_status(text, text)                    to anon, authenticated;
grant execute on function public.ig_name_claim_guest(text, text, boolean)      to anon, authenticated;
grant execute on function public.ig_name_claim_account(text, text, text)       to anon, authenticated;
grant execute on function public.ig_name_release(text, text)                   to anon, authenticated;

-- ============================================================================
--  SEED: protect every name that is ALREADY in use, so nobody can take one.
--  Seeded rows have token = NULL ("unclaimed") — the device that already uses
--  the name adopts it on its next visit; nobody else can type their way into it.
--
--  This block works out BOTH the accounts table and its name column by itself.
--  If it cannot, it stops with a clear message rather than quietly leaving
--  existing names unprotected.
-- ============================================================================
do $seed$
declare
  v_tbl   text;
  v_col   text;
  v_src   text;
  v_accts int := 0;
  v_lb    int := 0;
  v_wk    int := 0;
  v_tot   int := 0;
begin
  ------------------------------------------------------------------
  -- 1. Registered accounts: find the table account_auth() really uses
  ------------------------------------------------------------------
  select p.prosrc into v_src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'account_auth'
   limit 1;

  if v_src is null then
    raise exception
      'account_auth() was not found, so registered names cannot be protected. Tell me your accounts table name and I will adjust this script.';
  end if;

  -- try every table the function body mentions; keep the first real one
  select q.t into v_tbl
    from (
      select (regexp_matches(v_src, '(?:from|into|update)\s+(?:public\.)?([a-z_][a-z0-9_]*)', 'gi'))[1] as t
    ) q
   where to_regclass('public.' || q.t) is not null
     and q.t not in ('ig_name', 'ig_weekly', 'leaderboard')
   limit 1;

  if v_tbl is null then
    raise exception
      'Could not work out which table account_auth() stores accounts in. Tell me the table name and I will adjust this script.';
  end if;

  -- and which column on it holds the display name
  select c.column_name into v_col
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = v_tbl
     and c.column_name in ('name', 'username', 'user_name', 'player', 'player_name', 'display_name')
   order by array_position(
     array['name', 'username', 'user_name', 'player_name', 'display_name', 'player'],
     c.column_name)
   limit 1;

  if v_col is null then
    raise exception
      'Found the accounts table public.% but not its name column. Tell me the column name and I will adjust this script.', v_tbl;
  end if;

  -- built with quote_ident concatenation so the body contains no dollar signs
  execute
       'insert into public.ig_name (name_key, name, token, is_guest, seen) '
    || 'select distinct on (public.ig_name_key(t.' || quote_ident(v_col) || ')) '
    ||        'public.ig_name_key(t.' || quote_ident(v_col) || '), t.' || quote_ident(v_col) || ', null, false, now() '
    || 'from public.' || quote_ident(v_tbl) || ' t '
    || 'where coalesce(t.' || quote_ident(v_col) || ', '''') <> '''' '
    || 'and public.ig_name_key(t.' || quote_ident(v_col) || ') <> '''' '
    || 'order by public.ig_name_key(t.' || quote_ident(v_col) || ') '
    || 'on conflict (name_key) do update set is_guest = false';
  get diagnostics v_accts = row_count;
  raise notice 'Protected % registered account name(s), from public.% column %', v_accts, v_tbl, v_col;

  ------------------------------------------------------------------
  -- 2. Anyone who has ever posted a score
  ------------------------------------------------------------------
  if to_regclass('public.leaderboard') is not null then
    insert into public.ig_name (name_key, name, token, is_guest, seen)
      select distinct on (public.ig_name_key(l.name))
             public.ig_name_key(l.name), l.name, null, true, now()
        from public.leaderboard l
       where coalesce(l.name, '') <> ''
         and public.ig_name_key(l.name) <> ''
       order by public.ig_name_key(l.name)
    on conflict (name_key) do nothing;
    get diagnostics v_lb = row_count;
    raise notice 'Protected % more name(s) seen on the leaderboard', v_lb;
  end if;

  ------------------------------------------------------------------
  -- 3. Anyone who has ever earned a play
  ------------------------------------------------------------------
  if to_regclass('public.ig_weekly') is not null then
    insert into public.ig_name (name_key, name, token, is_guest, seen)
      select distinct on (w.user_key)
             w.user_key, coalesce(nullif(w.user_name, ''), w.user_key), null, true, now()
        from public.ig_weekly w
       where coalesce(w.user_key, '') <> ''
       order by w.user_key, w.updated desc
    on conflict (name_key) do nothing;
    get diagnostics v_wk = row_count;
    raise notice 'Protected % more name(s) from User-of-the-Week history', v_wk;
  end if;

  select count(*) into v_tot from public.ig_name;
  raise notice 'Done — % name(s) are now reserved.', v_tot;
end;
$seed$;
