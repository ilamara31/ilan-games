-- =====================================================================
--  FUN CHESS — database setup  (profile stats, puzzles, Elo, leaderboard)
--
--  Run this ONCE:  Supabase dashboard → SQL Editor → New query → paste → Run.
--  Safe to run again: it only creates what is missing and replaces the
--  chess_* functions with this version. It never deletes a rating, a stat
--  or a solved puzzle, and it does not touch any other game's tables.
--  Needs accounts-setup.sql (public.players + ig_check) to have been run.
--
--  Every table is RLS-locked and NOT granted to anon, so a player holding
--  the publishable key cannot write their own rating. The only door in is
--  the SECURITY DEFINER functions below, and every one of them (except the
--  read-only leaderboard) checks the account password first.
--
--  What the game gets (call with sb.rpc(name, args)):
--    chess_profile    (p_name, p_password)                        -> json
--    chess_record     (p_name, p_password, p_kind, p_result, p_color, p_detail) -> json profile
--    chess_puzzle     (p_name, p_password, p_puzzle_id)           -> int puzzles_solved
--    chess_game_open  (p_name, p_password, p_code, p_kind, p_tc, p_seats) -> uuid
--    chess_game_join  (p_name, p_password, p_game)                -> boolean
--    chess_game_report(p_name, p_password, p_game, p_places, p_reason) -> json
--    chess_top        (p_kind, p_limit)                           -> table(name, elo, games, wins)
--
--  Elo: everyone starts at 500 (2-player) and 500 (4-player, separate).
--  Only online games between real accounts that ALL joined change Elo.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Tables
-- ---------------------------------------------------------------------

-- One stat line per account.
create table if not exists public.chess_player (
  name            text primary key references public.players(name) on delete cascade,
  created_at      timestamptz not null default now()
);
-- Columns are added one by one so a later version of this file can add more
-- without breaking a database that already ran an earlier one.
alter table public.chess_player add column if not exists elo            integer not null default 500;
alter table public.chess_player add column if not exists elo_peak       integer not null default 500;
alter table public.chess_player add column if not exists elo4           integer not null default 500;
alter table public.chess_player add column if not exists elo4_peak      integer not null default 500;
alter table public.chess_player add column if not exists games          integer not null default 0;  -- all 2-player games (bot + same device + online)
alter table public.chess_player add column if not exists wins           integer not null default 0;
alter table public.chess_player add column if not exists losses         integer not null default 0;
alter table public.chess_player add column if not exists draws          integer not null default 0;
alter table public.chess_player add column if not exists wins_white     integer not null default 0;
alter table public.chess_player add column if not exists wins_black     integer not null default 0;
alter table public.chess_player add column if not exists online_games   integer not null default 0;  -- rated online games, 2p + 4p
alter table public.chess_player add column if not exists online_wins    integer not null default 0;
alter table public.chess_player add column if not exists bot_games      integer not null default 0;  -- 2-player games vs the bot
alter table public.chess_player add column if not exists bot_wins       integer not null default 0;
alter table public.chess_player add column if not exists local_games    integer not null default 0;  -- 2 players on one device
alter table public.chess_player add column if not exists games4         integer not null default 0;  -- all 4-player games (bots + online)
alter table public.chess_player add column if not exists wins4          integer not null default 0;  -- 1st place
alter table public.chess_player add column if not exists puzzles_solved integer not null default 0;
alter table public.chess_player add column if not exists rated_games    integer not null default 0;
alter table public.chess_player add column if not exists rated_games4   integer not null default 0;
alter table public.chess_player add column if not exists last_record_at timestamptz;   -- chess_record rate limit
alter table public.chess_player add column if not exists last_open_at   timestamptz;   -- chess_game_open rate limit
alter table public.chess_player add column if not exists puzzle_day     date;
alter table public.chess_player add column if not exists puzzle_day_count integer not null default 0;

create index if not exists chess_player_elo_idx  on public.chess_player (elo desc)  where rated_games  > 0;
create index if not exists chess_player_elo4_idx on public.chess_player (elo4 desc) where rated_games4 > 0;

-- One online game that MAY become rated.
create table if not exists public.chess_game (
  id          uuid primary key default gen_random_uuid(),
  code        text        not null,
  kind        text        not null check (kind in ('2p','4p')),
  tc          text        not null,
  seats       text[]      not null,                  -- human names by seat, null = bot
  joined      text[]      not null default '{}',     -- humans who confirmed they are playing
  host        text        not null references public.players(name) on delete cascade,
  status      text        not null default 'open' check (status in ('open','applied','expired')),
  created_at  timestamptz not null default now(),
  reports     jsonb       not null default '{}',     -- {name: {p: [places], d: draw?, r: reason, at: time}}
  reported_at timestamptz,                           -- time of the FIRST report
  applied_at  timestamptz,
  places      text[],                                -- the result that was applied
  draw        boolean     not null default false,
  deltas      jsonb                                  -- {name: elo change}
);
-- The lazy sweep only ever looks at open games, by these two times.
create index if not exists chess_game_open_reported_idx on public.chess_game (reported_at) where status = 'open';
create index if not exists chess_game_open_created_idx  on public.chess_game (created_at)  where status = 'open';
create index if not exists chess_game_host_idx          on public.chess_game (host, created_at desc);

-- Which puzzles each player has solved (distinct ids).
create table if not exists public.chess_puzzle_done (
  name       text        not null references public.players(name) on delete cascade,
  puzzle_id  text        not null,
  solved_at  timestamptz not null default now(),
  primary key (name, puzzle_id)
);

alter table public.chess_player      enable row level security;
alter table public.chess_game        enable row level security;
alter table public.chess_puzzle_done enable row level security;

-- No policies and no grants on purpose: PostgREST sees nothing here.
revoke all on public.chess_player, public.chess_game, public.chess_puzzle_done
  from anon, authenticated;

-- If an older version of this file left a function with a different argument
-- list, drop it, so no weaker overload stays callable from the browser.
do $drop$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname in ('chess_who','chess_ensure','chess_profile_json','chess_sweep','chess_apply',
                         'chess_report_json','chess_profile','chess_record','chess_puzzle',
                         'chess_game_open','chess_game_join','chess_game_report','chess_top')
       and (p.proname, pg_get_function_identity_arguments(p.oid)) not in (values
         ('chess_who',          'p_name text, p_password text'),
         ('chess_ensure',       'p_canon text'),
         ('chess_profile_json', 'p_canon text'),
         ('chess_sweep',        ''),
         ('chess_apply',        'p_game uuid, p_places text[], p_draw boolean'),
         ('chess_report_json',  'p_game uuid, p_canon text'),
         ('chess_profile',      'p_name text, p_password text'),
         ('chess_record',       'p_name text, p_password text, p_kind text, p_result text, p_color text, p_detail text'),
         ('chess_puzzle',       'p_name text, p_password text, p_puzzle_id text'),
         ('chess_game_open',    'p_name text, p_password text, p_code text, p_kind text, p_tc text, p_seats text[]'),
         ('chess_game_join',    'p_name text, p_password text, p_game uuid'),
         ('chess_game_report',  'p_name text, p_password text, p_game uuid, p_places text[], p_reason text'),
         ('chess_top',          'p_kind text, p_limit integer'))
  loop
    execute 'drop function ' || r.sig;
  end loop;
end
$drop$;


-- ---------------------------------------------------------------------
-- 1. Internal helpers (revoked from the API at the bottom)
-- ---------------------------------------------------------------------

-- Password in, the stored spelling of the name out. Raises 'bad login'.
-- Works whether ig_check answers 'ok' (accounts-setup.sql) or true.
create or replace function public.chess_who(p_name text, p_password text)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare canon text; res text;
begin
  if p_name is null or p_password is null or p_password = '' then
    raise exception 'bad login';
  end if;
  select name into canon from public.players where name = btrim(p_name) limit 1;
  if canon is null then raise exception 'bad login'; end if;

  if to_regprocedure('public.ig_check(text,text)') is null then
    raise exception 'bad login';
  end if;
  execute 'select public.ig_check($1,$2)::text' into res using p_name, p_password;
  if res is null or res not in ('ok', 'true') then raise exception 'bad login'; end if;
  return canon;
end;
$$;

-- Make sure a stat row exists.
create or replace function public.chess_ensure(p_canon text)
returns void
language sql security definer
set search_path = public, pg_temp
as $$
  insert into public.chess_player (name) values (p_canon) on conflict (name) do nothing;
$$;

create or replace function public.chess_profile_json(p_canon text)
returns json
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare w public.chess_player;
begin
  perform public.chess_ensure(p_canon);
  select * into w from public.chess_player where name = p_canon;
  return json_build_object(
    'name', w.name,
    'elo', w.elo, 'elo_peak', w.elo_peak, 'elo4', w.elo4, 'elo4_peak', w.elo4_peak,
    'games', w.games, 'wins', w.wins, 'losses', w.losses, 'draws', w.draws,
    'wins_white', w.wins_white, 'wins_black', w.wins_black,
    'online_games', w.online_games, 'online_wins', w.online_wins,
    'bot_games', w.bot_games, 'bot_wins', w.bot_wins, 'local_games', w.local_games,
    'games4', w.games4, 'wins4', w.wins4,
    'puzzles_solved', w.puzzles_solved,
    'rated_games', w.rated_games, 'rated_games4', w.rated_games4
  );
end;
$$;

/* Apply a result to a game that the CALLER HAS ALREADY LOCKED (for update)
 * and whose status is 'open'. p_places = human names 1st..last (validated by
 * the caller). Uses everyone's rating from BEFORE this game. */
create or replace function public.chess_apply(p_game uuid, p_places text[], p_draw boolean)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  g      public.chess_game;
  n      integer := array_length(p_places, 1);
  r      numeric[] := '{}';
  rg     integer[] := '{}';
  d      integer[] := '{}';
  i      integer; j integer;
  k      numeric; s numeric; e numeric; acc numeric;
  oldr   integer; newr integer;
  won    boolean;
  result jsonb := '{}';
begin
  select * into g from public.chess_game where id = p_game;
  if not found or g.status <> 'open' then return; end if;

  -- Someone deleted their account since the game started: nothing to rate.
  if (select count(*) from public.players where name = any(p_places)) < n then
    update public.chess_game set status = 'expired' where id = p_game;
    return;
  end if;

  insert into public.chess_player (name) select unnest(p_places) on conflict (name) do nothing;
  -- Lock the stat rows in name order (same order everywhere → no deadlock).
  perform 1 from public.chess_player where name = any(p_places) order by name for update;

  for i in 1..n loop
    if g.kind = '2p' then
      select elo, rated_games into oldr, j from public.chess_player where name = p_places[i];
    else
      select elo4, rated_games4 into oldr, j from public.chess_player where name = p_places[i];
    end if;
    r[i] := oldr; rg[i] := j;
  end loop;

  if g.kind = '2p' then
    for i in 1..2 loop
      j := 3 - i;
      s := case when p_draw then 0.5 when i = 1 then 1 else 0 end;
      e := 1 / (1 + power(10::numeric, (r[j] - r[i]) / 400));
      k := case when rg[i] < 20 then 40 else 24 end;
      d[i] := round(k * (s - e));
    end loop;
  else
    k := 24.0 / (n - 1);
    for i in 1..n loop
      acc := 0;
      for j in 1..n loop
        if i <> j then
          s := case when i < j then 1 else 0 end;      -- earlier in the list = better place
          e := 1 / (1 + power(10::numeric, (r[j] - r[i]) / 400));
          acc := acc + k * (s - e);
        end if;
      end loop;
      d[i] := round(acc);
    end loop;
  end if;

  for i in 1..n loop
    oldr := r[i];
    newr := greatest(100, oldr + d[i]);               -- floor 100
    won  := (i = 1 and not p_draw);
    result := result || jsonb_build_object(p_places[i], newr - oldr);
    if g.kind = '2p' then
      update public.chess_player set
        elo          = newr,
        elo_peak     = greatest(elo_peak, newr),
        games        = games + 1,
        rated_games  = rated_games + 1,
        online_games = online_games + 1,
        online_wins  = online_wins + (case when won then 1 else 0 end),
        wins         = wins   + (case when won then 1 else 0 end),
        losses       = losses + (case when not p_draw and i = 2 then 1 else 0 end),
        draws        = draws  + (case when p_draw then 1 else 0 end),
        wins_white   = wins_white + (case when won and p_places[i] = g.seats[1] then 1 else 0 end),
        wins_black   = wins_black + (case when won and p_places[i] = g.seats[2] then 1 else 0 end)
      where name = p_places[i];
    else
      update public.chess_player set
        elo4         = newr,
        elo4_peak    = greatest(elo4_peak, newr),
        games4       = games4 + 1,
        rated_games4 = rated_games4 + 1,
        wins4        = wins4 + (case when won then 1 else 0 end),
        online_games = online_games + 1,
        online_wins  = online_wins + (case when won then 1 else 0 end)
      where name = p_places[i];
    end if;
  end loop;

  update public.chess_game set
    status = 'applied', applied_at = now(), places = p_places, draw = p_draw, deltas = result
  where id = p_game;
end;
$$;

/* The lazy sweep. Runs at the start of every chess_* call; touches at most a
 * few rows through partial indexes, and skips rows another call is holding.
 *  - a game whose reports all agree (e.g. only the winner reported) and whose
 *    first report is over 90 s old is applied, if every human joined;
 *  - an open game older than 6 h expires (never rated). */
create or replace function public.chess_sweep()
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare g public.chess_game; humans text[]; v jsonb;
begin
  for g in
    select * from public.chess_game
     where status = 'open' and reported_at < now() - interval '90 seconds'
     order by reported_at
     limit 20
       for update skip locked
  loop
    humans := array(select s from unnest(g.seats) s where s is not null);
    if not (humans <@ g.joined) then continue; end if;
    -- exactly one distinct result among all reports
    if (select count(distinct jsonb_build_object('p', x.value->'p', 'd', x.value->'d'))
          from jsonb_each(g.reports) x) <> 1 then continue; end if;
    select x.value into v from jsonb_each(g.reports) x limit 1;
    perform public.chess_apply(g.id,
      array(select jsonb_array_elements_text(v->'p')),
      coalesce((v->>'d')::boolean, false));
  end loop;

  update public.chess_game set status = 'expired'
   where id in (select id from public.chess_game
                 where status = 'open' and created_at < now() - interval '6 hours'
                 order by created_at
                 limit 100
                   for update skip locked);
end;
$$;

create or replace function public.chess_report_json(p_game uuid, p_canon text)
returns json
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare g public.chess_game; my integer;
begin
  select * into g from public.chess_game where id = p_game;
  perform public.chess_ensure(p_canon);
  select case when g.kind = '4p' then elo4 else elo end into my
    from public.chess_player where name = p_canon;
  return json_build_object(
    'applied', g.status = 'applied',
    'status',  g.status,                                   -- 'open' | 'applied' | 'expired'
    'deltas',  coalesce(g.deltas, '{}'::jsonb),
    'elo',     my
  );
end;
$$;


-- ---------------------------------------------------------------------
-- 2. The API
-- ---------------------------------------------------------------------

create or replace function public.chess_profile(p_name text, p_password text)
returns json
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare canon text;
begin
  canon := public.chess_who(p_name, p_password);
  perform public.chess_sweep();
  return public.chess_profile_json(canon);
end;
$$;

/* Unrated games: vs bot ('bot'), two players on one device ('local'),
 * 4-player vs bots ('bot4'). Never changes Elo. Max 1 call per 5 s. */
create or replace function public.chess_record(p_name text, p_password text, p_kind text,
                                               p_result text, p_color text, p_detail text)
returns json
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare canon text; w public.chess_player; won int; lost int; drew int; wh int; bl int;
begin
  canon := public.chess_who(p_name, p_password);
  perform public.chess_sweep();

  if p_kind is null or p_kind not in ('bot','local','bot4') then raise exception 'bad kind'; end if;
  if p_result is null or p_result not in ('win','loss','draw') then raise exception 'bad result'; end if;
  if p_color is not null and p_color not in ('w','b') then raise exception 'bad color'; end if;
  if p_detail is not null and char_length(p_detail) > 200 then raise exception 'bad detail'; end if;

  perform public.chess_ensure(canon);
  select * into w from public.chess_player where name = canon for update;
  if w.last_record_at is not null and w.last_record_at > now() - interval '5 seconds' then
    raise exception 'too fast';
  end if;

  won  := case when p_result = 'win'  then 1 else 0 end;
  lost := case when p_result = 'loss' then 1 else 0 end;
  drew := case when p_result = 'draw' then 1 else 0 end;
  wh   := case when won = 1 and p_color = 'w' then 1 else 0 end;
  bl   := case when won = 1 and p_color = 'b' then 1 else 0 end;

  if p_kind = 'bot4' then
    update public.chess_player set
      games4 = games4 + 1, wins4 = wins4 + won, last_record_at = now()
    where name = canon;
  else
    update public.chess_player set
      games       = games + 1,
      wins        = wins + won, losses = losses + lost, draws = draws + drew,
      wins_white  = wins_white + wh, wins_black = wins_black + bl,
      bot_games   = bot_games   + (case when p_kind = 'bot'   then 1 else 0 end),
      bot_wins    = bot_wins    + (case when p_kind = 'bot'   then won else 0 end),
      local_games = local_games + (case when p_kind = 'local' then 1 else 0 end),
      last_record_at = now()
    where name = canon;
  end if;

  return public.chess_profile_json(canon);
end;
$$;

/* Mark a puzzle solved. Returns how many DIFFERENT puzzles this player has
 * solved. At most 500 new puzzles per day are counted. */
create or replace function public.chess_puzzle(p_name text, p_password text, p_puzzle_id text)
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare canon text; w public.chess_player; pid text := btrim(coalesce(p_puzzle_id, '')); added int;
begin
  canon := public.chess_who(p_name, p_password);
  perform public.chess_sweep();
  if pid !~ '^[A-Za-z0-9_.:-]{1,40}$' then raise exception 'bad puzzle id'; end if;

  perform public.chess_ensure(canon);
  select * into w from public.chess_player where name = canon for update;

  if w.puzzle_day is distinct from current_date then
    update public.chess_player set puzzle_day = current_date, puzzle_day_count = 0 where name = canon;
    w.puzzle_day_count := 0;
  end if;

  if w.puzzle_day_count < 500 then
    insert into public.chess_puzzle_done (name, puzzle_id) values (canon, pid)
      on conflict (name, puzzle_id) do nothing;
    get diagnostics added = row_count;
    if added > 0 then
      update public.chess_player set
        puzzles_solved   = puzzles_solved + 1,
        puzzle_day_count = puzzle_day_count + 1
      where name = canon;
    end if;
  end if;

  return (select puzzles_solved from public.chess_player where name = canon);
end;
$$;

/* Called by the HOST when an online game starts. p_seats = human names in
 * seat order: 2p [white, black]; 4p [red, blue, yellow, green] with null for
 * bots. The host is joined automatically; everyone else calls chess_game_join.
 * Max 1 call per 10 s per host. */
create or replace function public.chess_game_open(p_name text, p_password text, p_code text,
                                                  p_kind text, p_tc text, p_seats text[])
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare canon text; w public.chess_player; v_code text; humans text[]; n int; gid uuid;
begin
  canon := public.chess_who(p_name, p_password);
  perform public.chess_sweep();

  v_code := upper(btrim(coalesce(p_code, '')));
  if v_code !~ '^[A-Z0-9]{2,12}$' then raise exception 'bad code'; end if;
  if p_kind is null or p_kind not in ('2p','4p') then raise exception 'bad kind'; end if;
  if p_tc is null or char_length(btrim(p_tc)) not between 1 and 20 then raise exception 'bad tc'; end if;
  if p_seats is null or array_ndims(p_seats) is distinct from 1
     or array_length(p_seats, 1) <> (case when p_kind = '2p' then 2 else 4 end) then
    raise exception 'bad seats';
  end if;

  humans := array(select s from unnest(p_seats) s where s is not null);
  n := coalesce(array_length(humans, 1), 0);
  if n < 2 or (p_kind = '2p' and n <> 2) then raise exception 'bad seats'; end if;
  if (select count(distinct s) from unnest(humans) s) <> n then raise exception 'bad seats'; end if;
  if (select count(*) from public.players where name = any(humans)) <> n then
    raise exception 'unknown player';
  end if;
  if not (canon = any(humans)) then raise exception 'host must be seated'; end if;

  perform public.chess_ensure(canon);
  select * into w from public.chess_player where name = canon for update;
  if w.last_open_at is not null and w.last_open_at > now() - interval '10 seconds' then
    raise exception 'too fast';
  end if;
  update public.chess_player set last_open_at = now() where name = canon;

  insert into public.chess_game (code, kind, tc, seats, joined, host)
  values (v_code, p_kind, btrim(p_tc), p_seats, array[canon], canon)
  returning id into gid;
  return gid;
end;
$$;

/* Every human calls this when the game starts. true = you are in; false =
 * no such game, you have no seat in it, or it is already finished/expired. */
create or replace function public.chess_game_join(p_name text, p_password text, p_game uuid)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare canon text; g public.chess_game;
begin
  canon := public.chess_who(p_name, p_password);
  perform public.chess_sweep();
  if p_game is null then return false; end if;

  select * into g from public.chess_game where id = p_game for update;
  if not found or g.status <> 'open' or g.created_at < now() - interval '6 hours' then return false; end if;
  if not (canon = any(g.seats)) then return false; end if;
  if not (canon = any(g.joined)) then
    update public.chess_game set joined = array_append(joined, canon) where id = p_game;
  end if;
  return true;
end;
$$;

/* Report the result. p_places = human names 1st..last (bots left out).
 * 2p draw: both names, p_reason = 'draw'.
 * Applied at once when (a) another human already sent the same result, or
 * (b) the reporter admits a result that is bad for them (they are not 1st and
 * it is not a draw) and nobody sent a different result. Otherwise it waits:
 * a result nobody contradicts is applied 90 s after the first report.
 * Never applied unless every human in the game joined. Applied once only. */
create or replace function public.chess_game_report(p_name text, p_password text, p_game uuid,
                                                    p_places text[], p_reason text)
returns json
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  canon text; g public.chess_game; humans text[]; n int; places text[];
  is_draw boolean; mine jsonb; agree boolean; conflict boolean; self_loss boolean;
begin
  canon := public.chess_who(p_name, p_password);
  perform public.chess_sweep();
  if p_game is null then raise exception 'no such game'; end if;

  select * into g from public.chess_game where id = p_game for update;
  if not found then raise exception 'no such game'; end if;
  if not (canon = any(g.seats)) then raise exception 'not in this game'; end if;
  if g.status <> 'open' then return public.chess_report_json(p_game, canon); end if;

  humans := array(select s from unnest(g.seats) s where s is not null);
  n := array_length(humans, 1);
  if p_places is null or array_ndims(p_places) is distinct from 1
     or array_length(p_places, 1) <> n
     or array_position(p_places, null) is not null
     or (select count(distinct s) from unnest(p_places) s) <> n
     or not (p_places <@ humans) then
    raise exception 'bad places';
  end if;
  if p_reason is not null and char_length(p_reason) > 30 then raise exception 'bad reason'; end if;

  is_draw := g.kind = '2p' and lower(btrim(coalesce(p_reason, ''))) = 'draw';
  places  := case when is_draw then array(select s from unnest(p_places) s order by s) else p_places end;
  mine    := jsonb_build_object('p', to_jsonb(places), 'd', is_draw);

  select coalesce(bool_or(x.key <> canon and x.value->'p' = mine->'p' and x.value->'d' = mine->'d'), false),
         coalesce(bool_or(x.key <> canon and (x.value->'p' <> mine->'p' or x.value->'d' <> mine->'d')), false)
    into agree, conflict
    from jsonb_each(g.reports) x;
  self_loss := not is_draw and places[1] <> canon;

  update public.chess_game set
    reports     = reports || jsonb_build_object(canon,
                    mine || jsonb_build_object('r', p_reason, 'at', now())),
    reported_at = coalesce(reported_at, now())
  where id = p_game;

  if humans <@ g.joined and (agree or (self_loss and not conflict)) then
    perform public.chess_apply(p_game, places, is_draw);
  end if;

  return public.chess_report_json(p_game, canon);
end;
$$;

/* Leaderboard. No password. Only players with at least one rated game of
 * that kind; auto-made guest names (guest123, guest_4567 …) are left out. */
create or replace function public.chess_top(p_kind text, p_limit integer)
returns table (name text, elo integer, games integer, wins integer)
language plpgsql security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare lim int := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  perform public.chess_sweep();
  if p_kind = '4p' then
    return query
      select c.name, c.elo4, c.games4, c.wins4
        from public.chess_player c
       where c.rated_games4 > 0 and c.name !~* '^guest[-_ ]?[0-9]{3,}$'
       order by c.elo4 desc, c.rated_games4 desc, c.name
       limit lim;
  elsif p_kind = '2p' then
    return query
      select c.name, c.elo, c.games, c.wins
        from public.chess_player c
       where c.rated_games > 0 and c.name !~* '^guest[-_ ]?[0-9]{3,}$'
       order by c.elo desc, c.rated_games desc, c.name
       limit lim;
  else
    raise exception 'bad kind';
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. Who may call what
-- ---------------------------------------------------------------------

-- Internals stay shut: they skip the password check.
revoke all on function public.chess_who(text, text)                  from public, anon, authenticated;
revoke all on function public.chess_ensure(text)                     from public, anon, authenticated;
revoke all on function public.chess_profile_json(text)               from public, anon, authenticated;
revoke all on function public.chess_apply(uuid, text[], boolean)     from public, anon, authenticated;
revoke all on function public.chess_sweep()                          from public, anon, authenticated;
revoke all on function public.chess_report_json(uuid, text)          from public, anon, authenticated;

grant execute on function public.chess_profile(text, text)                               to anon, authenticated;
grant execute on function public.chess_record(text, text, text, text, text, text)        to anon, authenticated;
grant execute on function public.chess_puzzle(text, text, text)                          to anon, authenticated;
grant execute on function public.chess_game_open(text, text, text, text, text, text[])   to anon, authenticated;
grant execute on function public.chess_game_join(text, text, uuid)                       to anon, authenticated;
grant execute on function public.chess_game_report(text, text, uuid, text[], text)       to anon, authenticated;
grant execute on function public.chess_top(text, integer)                                to anon, authenticated;

notify pgrst, 'reload schema';

select 'Fun Chess: database ready' as result;
