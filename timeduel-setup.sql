-- =====================================================================
--  TIME DUEL — database setup
--  Run this ONCE in Supabase → SQL Editor. Safe to run again.
--
--  Everything about coins lives behind SECURITY DEFINER functions.
--  The tables themselves are RLS-locked and NOT granted to anon, so a
--  player holding the publishable key cannot write their own balance:
--  the only way a coin ever moves is through one of the td_* functions
--  below, and every one of them re-checks the account password first.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 0. Tables
-- ---------------------------------------------------------------------

-- One wallet + stat line per account. Time Duel only: the coin balances
-- the other games keep in localStorage are untouched by this file.
create table if not exists public.td_player (
  name                  text primary key references public.players(name) on delete cascade,
  coins                 bigint      not null default 100 check (coins >= 0),
  matches_played        integer     not null default 0,
  matches_won           integer     not null default 0,
  dots                  integer     not null default 0,
  best_diff_ms          integer,                         -- lower is better; null = no rounds yet
  practice_day          date,
  practice_earned_today bigint      not null default 0,
  last_practice_at      timestamptz,
  created_at            timestamptz not null default now()
);

-- A practice round is ARMED on the server before it is played, so the reward
-- is paid against a target and a start time the database chose to remember,
-- not against two numbers the client made up. Without this,
-- td_practice(300, 300) in a loop is a coin printer.
alter table public.td_player add column if not exists practice_target_ms integer;
alter table public.td_player add column if not exists practice_armed_at  timestamptz;

-- A room is one table of players playing one round at a time.
create table if not exists public.td_room (
  code        text primary key,
  host        text        not null references public.players(name) on delete cascade,
  mode        text        not null check (mode in ('classic','blind')),
  arena       text        not null,
  entry       integer     not null check (entry >= 0),
  capacity    integer     not null check (capacity between 2 and 8),
  status      text        not null default 'lobby'
                          check (status in ('lobby','playing','done','aborted')),
  round_no    integer     not null default 0,
  target_ms   integer,
  started_at  timestamptz,                                -- the instant the timer starts
  pot         bigint      not null default 0,
  winner      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- td_sweep filters on updated_at, so that is what the index must carry.
drop index if exists public.td_room_open_idx;
create index if not exists td_room_stale_idx on public.td_room (status, updated_at);

-- A seat is one player's stake and one player's answer for this round.
create table if not exists public.td_seat (
  code         text        not null references public.td_room(code) on delete cascade,
  name         text        not null references public.players(name) on delete cascade,
  stake        integer     not null default 0,            -- coins escrowed in the pot
  stop_ms      integer,                                   -- null = hasn't stopped yet
  diff_ms      integer,
  submitted_at timestamptz,
  seen_at      timestamptz not null default now(),
  joined_at    timestamptz not null default now(),
  primary key (code, name)
);
create index if not exists td_seat_name_idx on public.td_seat (name);

create table if not exists public.td_history (
  id         bigserial primary key,
  name       text        not null,
  code       text,
  mode       text        not null,
  arena      text,
  entry      integer     not null default 0,
  players    integer     not null default 1,
  target_ms  integer,
  stop_ms    integer,
  diff_ms    integer,
  place      integer,
  won        boolean     not null default false,
  delta      bigint      not null default 0,              -- net coin change, entry included
  created_at timestamptz not null default now()
);
create index if not exists td_history_name_idx on public.td_history (name, created_at desc);

alter table public.td_player  enable row level security;
alter table public.td_room    enable row level security;
alter table public.td_seat    enable row level security;
alter table public.td_history enable row level security;

-- No policies and no grants on purpose. PostgREST can see nothing here;
-- the SECURITY DEFINER functions below are the only door in.
revoke all on public.td_player, public.td_room, public.td_seat, public.td_history
  from anon, authenticated;

-- Signatures changed in this revision; drop the old shapes so re-running does
-- not leave a second, weaker overload still callable from the browser.
drop function if exists public.td_room_json(text);
drop function if exists public.td_state(text);
drop function if exists public.td_tick(text);
drop function if exists public.td_stop(text, text, text, integer);
drop function if exists public.td_practice(text, text, integer, integer);
drop function if exists public.td_sweep();


-- ---------------------------------------------------------------------
-- 1. Shared guts
-- ---------------------------------------------------------------------

-- The arena price list lives in the database, not the client, so a
-- tampered page cannot buy a Master seat for 10 coins.
create or replace function public.td_entry_for(p_arena text)
returns integer
language sql immutable
as $$
  select case lower(coalesce(p_arena,''))
           when 'bronze'  then 10
           when 'silver'  then 50
           when 'gold'    then 200
           when 'diamond' then 1000
           when 'master'  then 5000
           else -1
         end;
$$;

-- Password in, canonical username out. NULL means "not you".
-- ig_check is revoked from anon; we can still call it because these
-- functions run as the owner.
create or replace function public.td_who(p_name text, p_password text)
returns text
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
declare canon text;
begin
  if public.ig_check(p_name, p_password) <> 'ok' then return null; end if;
  select name into canon from public.players where name = btrim(p_name) limit 1;
  return canon;
end;
$$;

-- Make sure the wallet row exists. New players start with 100 coins —
-- ten Bronze entries, enough to find out whether they like the game.
create or replace function public.td_wallet(p_canon text)
returns public.td_player
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
declare w public.td_player;
begin
  insert into public.td_player (name) values (p_canon)
    on conflict (name) do nothing;
  select * into w from public.td_player where name = p_canon;
  return w;
end;
$$;

create or replace function public.td_profile_json(p_canon text)
returns json
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
declare w public.td_player; joined timestamptz;
begin
  w := public.td_wallet(p_canon);
  select created_at into joined from public.players where name = p_canon;
  return json_build_object(
    'ok', true,
    'name', w.name,
    'coins', w.coins,
    'played', w.matches_played,
    'won', w.matches_won,
    'dots', w.dots,
    'best_diff_ms', w.best_diff_ms,
    'joined', coalesce(joined, w.created_at)
  );
end;
$$;

-- Everything a client needs to draw a room. No password: a room code is
-- already the secret, and this leaks nothing but usernames and times.
/* What a client is allowed to see.
 *
 * p_viewer is the canonical name of whoever asked, or NULL. A caller who is
 * not seated in the room gets the shape of the room and nothing that would
 * help them cheat. Previously td_state was anon-callable and returned
 * target_ms plus every seat's live stop_ms and diff_ms mid-round, which
 * handed any passer-by the answer AND let a blind-mode player solve the
 * target from one rival's answer (target = stop_ms +/- diff_ms). */
create or replace function public.td_room_json(p_code text, p_viewer text default null)
returns json
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
declare r public.td_room; seated boolean; reveal boolean;
begin
  select * into r from public.td_room where code = p_code;
  if not found then return json_build_object('ok', false, 'error', 'no_room'); end if;

  seated := p_viewer is not null and exists (
    select 1 from public.td_seat s where s.code = r.code and s.name = p_viewer);
  reveal := (r.status = 'done');   -- rival times go public only once it is paid

  return json_build_object(
    'ok', true,
    'code', r.code, 'host', r.host, 'mode', r.mode, 'arena', r.arena,
    'entry', r.entry, 'capacity', r.capacity, 'status', r.status,
    'round', r.round_no, 'pot', r.pot, 'winner', r.winner, 'seated', seated,
    'target_ms', case when seated and r.status in ('playing','done')
                      then r.target_ms else null end,
    'started_at', case when seated then r.started_at else null end,
    'now', now(),
    'seats', coalesce((
      select json_agg(json_build_object(
               'name', s.name,
               'done', s.stop_ms is not null,
               'stop_ms', case when reveal or s.name = p_viewer then s.stop_ms else null end,
               'diff_ms', case when reveal or s.name = p_viewer then s.diff_ms else null end,
               'joined', s.joined_at
             ) order by s.joined_at)
        from public.td_seat s where s.code = r.code), '[]'::json)
  );
end;
$$;

/* Lock every room this player could touch, IN CODE ORDER, before anything
 * else. Two players swapping rooms at the same instant used to deadlock:
 * each held their own room's lock (taken while refunding themselves out of
 * it) and then reached for the other's. A consistent global order removes
 * the cycle. Postgres applies FOR UPDATE after ORDER BY, so the rows really
 * are locked in sorted order. */
create or replace function public.td_lock_rooms(p_canon text, p_extra text)
returns void
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
begin
  perform 1 from public.td_room r
   where r.code in (
       select st.code from public.td_seat st where st.name = p_canon
       union
       select p_extra where p_extra is not null)
   order by r.code
     for update;
end;
$$;

-- Rooms that were abandoned in the lobby give every coin back. Called
-- opportunistically by clients; cheap, and keeps the list clean.
/* Give back the entry fees of rooms nobody came back to.
 *
 * Requires an account, because the unauthenticated version was a full scan
 * of td_room that anyone holding the publishable key could fire in a loop.
 * Rooms are taken in CODE order, the same order td_lock_rooms uses, so a
 * sweep can never deadlock against a player joining or leaving. */
create or replace function public.td_sweep(p_name text, p_password text)
returns integer
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
declare canon text; r record; n integer := 0;
begin
  canon := public.td_who(p_name, p_password);
  if canon is null then return 0; end if;

  for r in
    select code from public.td_room
     where status in ('lobby','playing')
       and updated_at < now() - interval '30 minutes'
     order by code
     limit 25
  loop
    perform public.td_refund_room(r.code, 'aborted');
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Hand every stake back and close the room. Used for aborts and for the
-- case where a round ends with nobody having answered at all.
create or replace function public.td_refund_room(p_code text, p_status text)
returns void
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
declare r public.td_room; s record;
begin
  select * into r from public.td_room where code = p_code for update;
  if not found or r.status in ('done','aborted') then return; end if;

  -- The room lock above already means only one refund can run for this room.
  -- FOR UPDATE re-checks stake > 0 after taking each seat row, so a stake that
  -- was zeroed by a settle in between is skipped rather than paid again. Name
  -- order keeps player-row locking deterministic across concurrent refunds.
  for s in
    select name, stake from public.td_seat
     where code = p_code and stake > 0
     order by name
       for update
  loop
    update public.td_player set coins = coins + s.stake where name = s.name;
    update public.td_seat set stake = 0 where code = p_code and name = s.name;
  end loop;

  update public.td_room
     set status = p_status, pot = 0, winner = null, updated_at = now()
   where code = p_code;
end;
$$;


-- ---------------------------------------------------------------------
-- 2. Lobby: create / join / leave
-- ---------------------------------------------------------------------

create or replace function public.td_create(
  p_name text, p_password text, p_mode text, p_arena text, p_capacity integer)
returns json
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
declare canon text; fee integer; v_code text; tries integer := 0; w public.td_player;
begin
  canon := public.td_who(p_name, p_password);
  if canon is null then return json_build_object('ok', false, 'error', 'auth'); end if;

  if p_mode not in ('classic','blind') then
    return json_build_object('ok', false, 'error', 'bad_mode');
  end if;
  if p_capacity is null or p_capacity < 2 or p_capacity > 8 then
    return json_build_object('ok', false, 'error', 'bad_size');
  end if;

  fee := public.td_entry_for(p_arena);
  if fee < 0 then return json_build_object('ok', false, 'error', 'bad_arena'); end if;

  -- Take every room lock up front, in code order (see td_lock_rooms), then
  -- give back any stale lobby seat BEFORE checking the balance -- otherwise a
  -- player whose coins are escrowed in a room they already left is wrongly
  -- told they are broke.
  --
  -- LOCK ORDER, and it matters: rooms first, player rows only ever underneath
  -- them. An earlier version grabbed the player row FIRST to stop one player
  -- staking two rooms at once, which inverted the order against td_settle and
  -- td_refund_room (both of which hold a room lock and then credit players)
  -- and deadlocked outright. Two simultaneous joins can now leave a player
  -- seated in two rooms, which is untidy but costs nothing: both stakes are
  -- real coins, correctly debited, and both are settled or refunded normally.
  perform public.td_lock_rooms(canon, null);
  perform public.td_quit_open_rooms(canon);

  w := public.td_wallet(canon);
  if w.coins < fee then
    return json_build_object('ok', false, 'error', 'broke',
                             'coins', w.coins, 'need', fee);
  end if;

  loop
    tries := tries + 1;
    if tries > 40 then return json_build_object('ok', false, 'error', 'no_code'); end if;
    -- No 0/O/1/I — these get read aloud and typed in by kids.
    v_code := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                                      1 + floor(random() * 32)::int, 1), '')
               from generate_series(1, 4));
    exit when not exists (select 1 from public.td_room where code = v_code);
  end loop;

  update public.td_player set coins = coins - fee where name = canon and coins >= fee;
  if not found then return json_build_object('ok', false, 'error', 'broke'); end if;

  insert into public.td_room (code, host, mode, arena, entry, capacity, pot)
  values (v_code, canon, p_mode, lower(p_arena), fee, p_capacity, fee);

  insert into public.td_seat (code, name, stake) values (v_code, canon, fee);

  return public.td_room_json(v_code, canon);
end;
$$;

create or replace function public.td_join(p_name text, p_password text, p_code text)
returns json
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
declare canon text; r public.td_room; taken integer; w public.td_player; v_code text;
begin
  canon := public.td_who(p_name, p_password);
  if canon is null then return json_build_object('ok', false, 'error', 'auth'); end if;

  v_code := upper(btrim(coalesce(p_code, '')));

  -- Rooms first, in code order, and never a player row above them. See the
  -- lock-order note in td_create.
  perform public.td_lock_rooms(canon, v_code);

  select * into r from public.td_room where td_room.code = v_code;
  if not found then return json_build_object('ok', false, 'error', 'no_room'); end if;

  -- Already sitting here: hand the room back. A refresh, not a second buy.
  if exists (select 1 from public.td_seat s where s.code = v_code and s.name = canon) then
    update public.td_seat set seen_at = now() where td_seat.code = v_code and name = canon;
    return public.td_room_json(v_code, canon);
  end if;

  if r.status <> 'lobby' then return json_build_object('ok', false, 'error', 'started'); end if;

  perform public.td_quit_open_rooms(canon);
  -- quit may have aborted this very room (if they were its host); re-read.
  select * into r from public.td_room where td_room.code = v_code;
  if not found or r.status <> 'lobby' then
    return json_build_object('ok', false, 'error', 'started');
  end if;

  select count(*) into taken from public.td_seat s where s.code = v_code;
  if taken >= r.capacity then return json_build_object('ok', false, 'error', 'full'); end if;

  w := public.td_wallet(canon);
  if w.coins < r.entry then
    return json_build_object('ok', false, 'error', 'broke',
                             'coins', w.coins, 'need', r.entry);
  end if;

  update public.td_player set coins = coins - r.entry
   where name = canon and coins >= r.entry;
  if not found then return json_build_object('ok', false, 'error', 'broke'); end if;

  insert into public.td_seat (code, name, stake) values (v_code, canon, r.entry);
  update public.td_room set pot = pot + r.entry, updated_at = now()
   where td_room.code = v_code;

  return public.td_room_json(v_code, canon);
end;
$$;

-- Stand up from any lobby this player is still sitting in, refunding the
-- stake. Never touches a room that is already playing — you cannot walk
-- out of a round you might be losing and take your coins with you.
/* Stand up from any lobby this player is still sitting in, refunding the
 * stake. Never touches a room that is already playing -- you cannot walk out
 * of a round you might be losing and take your coins with you.
 *
 * The caller MUST have run td_lock_rooms first. The refund amount comes from
 * DELETE ... RETURNING, so the coins credited are exactly the coins removed.
 * The old version read stake from an unlocked snapshot and then credited it,
 * so two simultaneous leaves could each refund the same 10 coins -- money
 * created out of nothing. */
create or replace function public.td_quit_open_rooms(p_canon text)
returns void
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
declare s record; v_stake integer; was_host boolean;
begin
  for s in
    select st.code
      from public.td_seat st
      join public.td_room rm on rm.code = st.code
     where st.name = p_canon and rm.status = 'lobby'
  loop
    select (host = p_canon) into was_host from public.td_room where code = s.code;

    delete from public.td_seat
     where code = s.code and name = p_canon
     returning stake into v_stake;
    if not found then continue; end if;        -- somebody else got there first

    if v_stake > 0 then
      update public.td_player set coins = coins + v_stake where name = p_canon;
    end if;
    update public.td_room set pot = greatest(pot - v_stake, 0), updated_at = now()
     where code = s.code;

    if was_host then
      perform public.td_refund_room(s.code, 'aborted');
    elsif not exists (select 1 from public.td_seat where code = s.code) then
      update public.td_room set status = 'aborted', pot = 0, updated_at = now()
       where code = s.code;
    end if;
  end loop;
end;
$$;

create or replace function public.td_leave(p_name text, p_password text, p_code text)
returns json
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
declare canon text;
begin
  canon := public.td_who(p_name, p_password);
  if canon is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  perform public.td_lock_rooms(canon, null);
  perform public.td_quit_open_rooms(canon);
  return json_build_object('ok', true);
end;
$$;


-- ---------------------------------------------------------------------
-- 3. The round
-- ---------------------------------------------------------------------

-- Host arms the round. The target is rolled HERE, in the database, so the
-- host cannot deal themselves a number they have practised.
create or replace function public.td_start(p_name text, p_password text, p_code text)
returns json
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
declare canon text; r public.td_room; seated integer; v_code text;
begin
  canon := public.td_who(p_name, p_password);
  if canon is null then return json_build_object('ok', false, 'error', 'auth'); end if;

  v_code := upper(btrim(coalesce(p_code, '')));
  select * into r from public.td_room where td_room.code = v_code for update;
  if not found then return json_build_object('ok', false, 'error', 'no_room'); end if;
  if r.host <> canon then return json_build_object('ok', false, 'error', 'not_host'); end if;

  -- Already armed by an earlier click (double tap, retried request).
  if r.status = 'playing' then return public.td_room_json(v_code, canon); end if;
  if r.status <> 'lobby' then return json_build_object('ok', false, 'error', 'started'); end if;

  select count(*) into seated from public.td_seat s where s.code = v_code;
  if seated < 2 then return json_build_object('ok', false, 'error', 'need_two'); end if;

  update public.td_room
     set status     = 'playing',
         round_no   = round_no + 1,
         -- 0.300 s … 8.000 s, never the same fixed number twice.
         target_ms  = 300 + floor(random() * 7701)::int,
         -- The timer starts three seconds from now: that is the 3-2-1.
         started_at = now() + interval '3 seconds',
         winner     = null,
         updated_at = now()
   where td_room.code = v_code;

  update public.td_seat
     set stop_ms = null, diff_ms = null, submitted_at = null
   where td_seat.code = v_code;

  return public.td_room_json(v_code, canon);
end;
$$;

-- A player's answer. stop_ms is measured on their own device, from their
-- own START frame — that is deliberate, because it means a laggy
-- connection can never cost somebody the round. What the server checks is
-- only that the claim is physically possible: you cannot report 7.9 s
-- when the round started 1.2 s ago.
/* A player's answer.
 *
 * stop_ms is measured on their own device, from their own START frame --
 * deliberately, so a laggy connection can never cost somebody the round. The
 * server checks only that the claim is physically possible. p_round pins the
 * answer to the round it was played in, so a retry from the previous round
 * can never be scored against the current one. */
create or replace function public.td_stop(
  p_name text, p_password text, p_code text, p_stop_ms integer,
  p_round integer default null)
returns json
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
declare canon text; r public.td_room; st public.td_seat; elapsed_ms numeric; v_code text;
begin
  canon := public.td_who(p_name, p_password);
  if canon is null then return json_build_object('ok', false, 'error', 'auth'); end if;

  v_code := upper(btrim(coalesce(p_code, '')));
  select * into r from public.td_room where td_room.code = v_code for update;
  if not found then return json_build_object('ok', false, 'error', 'no_room'); end if;
  if r.status <> 'playing' then return json_build_object('ok', false, 'error', 'not_playing'); end if;
  if p_round is not null and p_round <> r.round_no then
    return json_build_object('ok', false, 'error', 'stale_round');
  end if;

  select * into st from public.td_seat
   where td_seat.code = v_code and name = canon for update;
  if not found then return json_build_object('ok', false, 'error', 'not_seated'); end if;
  if st.stop_ms is not null then return public.td_room_json(v_code, canon); end if;

  if p_stop_ms is null or p_stop_ms < 0 or p_stop_ms > 20000 then
    return json_build_object('ok', false, 'error', 'bad_time');
  end if;

  elapsed_ms := extract(epoch from (now() - r.started_at)) * 1000;
  -- Lower bound: you cannot have watched more time pass than actually has.
  -- 1200ms of slack covers clock-sync error and a phone painting the START
  -- frame late. It used to be 2500ms, which was wider than many targets and
  -- made the check vacuous for anything under 2.5 seconds.
  if elapsed_ms < p_stop_ms - 1200 then
    return json_build_object('ok', false, 'error', 'impossible');
  end if;
  -- Upper bound: an answer arriving 20s after the moment it claims is a
  -- replay, not a tap. Generous, because the client legitimately retries a
  -- lost submission for up to 14s.
  if elapsed_ms > p_stop_ms + 20000 then
    return json_build_object('ok', false, 'error', 'impossible');
  end if;

  update public.td_seat
     set stop_ms = p_stop_ms, diff_ms = abs(p_stop_ms - r.target_ms),
         submitted_at = now(), seen_at = now()
   where td_seat.code = v_code and name = canon;

  update public.td_room set updated_at = now() where td_room.code = v_code;

  if not exists (select 1 from public.td_seat where code = v_code and stop_ms is null) then
    perform public.td_settle(v_code);
  end if;

  return public.td_room_json(v_code, canon);
end;
$$;

-- Pay out. Safe to call from every client at once and safe to call twice:
-- the FOR UPDATE + status check means exactly one caller does the work.
/* Pay out. Safe to call from every client at once and safe to call twice:
 * the FOR UPDATE + status check means exactly one caller does the work. */
create or replace function public.td_settle(p_code text)
returns json
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
declare
  r public.td_room; s record; v_code text;
  answered integer; seated integer;
  best integer; champ text; share bigint; extra bigint; winners integer;
begin
  v_code := upper(btrim(coalesce(p_code, '')));
  select * into r from public.td_room where td_room.code = v_code for update;
  if not found then return json_build_object('ok', false, 'error', 'no_room'); end if;
  if r.status <> 'playing' then return public.td_room_json(v_code, null); end if;

  select count(*), count(stop_ms) into seated, answered
    from public.td_seat where td_seat.code = v_code;

  if answered < seated
     and now() < r.started_at + (r.target_ms || ' milliseconds')::interval
                              + interval '15 seconds' then
    return public.td_room_json(v_code, null);
  end if;

  -- Nobody answered at all: no winner, every entry fee back. Still write a
  -- history row each, so a void round is not a silent gap in the record.
  if answered = 0 then
    insert into public.td_history
      (name, code, mode, arena, entry, players, target_ms, stop_ms, diff_ms, place, won, delta)
    select st.name, v_code, r.mode, r.arena, r.entry, seated, r.target_ms,
           null, null, null, false, 0
      from public.td_seat st where st.code = v_code;
    perform public.td_refund_room(v_code, 'done');
    return public.td_room_json(v_code, null);
  end if;

  select min(diff_ms) into best from public.td_seat
   where td_seat.code = v_code and diff_ms is not null;
  select count(*) into winners from public.td_seat
   where td_seat.code = v_code and diff_ms = best;

  share := r.pot / winners;
  extra := r.pot - (share * winners);

  -- The odd coins of a split go to the alphabetically first winner, NOT to
  -- whoever's packet arrived first. submitted_at is pure network latency, and
  -- this game's whole promise is that latency decides nothing.
  select name into champ from public.td_seat
   where td_seat.code = v_code and diff_ms = best
   order by name asc limit 1;

  for s in
    select st.*,
           rank() over (order by (st.diff_ms is null), st.diff_ms asc) as place_r
      from public.td_seat st
     where st.code = v_code
     -- Name order, NOT placing order: this loop locks a player row per
     -- iteration, and two rooms settling at once that share players would
     -- deadlock if they took those rows in different orders. place_r is
     -- already computed by the window function, so ordering is free here.
     order by st.name
  loop
    declare
      gain bigint := 0;
      is_win boolean := (s.diff_ms is not null and s.diff_ms = best);
    begin
      if is_win then
        gain := share + case when s.name = champ then extra else 0 end;
        update public.td_player set coins = coins + gain where name = s.name;
      end if;

      update public.td_player
         set matches_played = matches_played + 1,
             matches_won    = matches_won + case when is_win then 1 else 0 end,
             dots           = dots + case when s.diff_ms = 0 then 1 else 0 end,
             best_diff_ms   = case
                                when s.diff_ms is null then best_diff_ms
                                when best_diff_ms is null then s.diff_ms
                                else least(best_diff_ms, s.diff_ms)
                              end
       where name = s.name;

      insert into public.td_history
        (name, code, mode, arena, entry, players, target_ms, stop_ms, diff_ms, place, won, delta)
      values
        (s.name, v_code, r.mode, r.arena, r.entry, seated, r.target_ms,
         s.stop_ms, s.diff_ms, s.place_r, is_win, gain - s.stake);
    end;
  end loop;

  -- The stakes are zeroed, which is what actually prevents a second payout or
  -- a stray refund: every credit path reads stake, and td_refund_room only
  -- acts on a room that is not already done. `pot` is deliberately KEPT so the
  -- result screen can show what the round was worth. Any future code path that
  -- moves a room back to 'playing' MUST reset pot first, exactly as
  -- td_rematch does.
  update public.td_room
     set status = 'done', winner = champ, updated_at = now()
   where td_room.code = v_code;
  update public.td_seat set stake = 0 where td_seat.code = v_code;

  return public.td_room_json(v_code, null);
end;
$$;

-- Host sends everyone back to the lobby for another round. Each player
-- pays a fresh entry fee; anyone who cannot afford it is left behind
-- rather than being put into debt.
create or replace function public.td_rematch(p_name text, p_password text, p_code text)
returns json
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
declare canon text; r public.td_room; v_code text; w public.td_player;
begin
  canon := public.td_who(p_name, p_password);
  if canon is null then return json_build_object('ok', false, 'error', 'auth'); end if;

  v_code := upper(btrim(coalesce(p_code, '')));
  select * into r from public.td_room where td_room.code = v_code for update;
  if not found then return json_build_object('ok', false, 'error', 'no_room'); end if;
  if r.host <> canon then return json_build_object('ok', false, 'error', 'not_host'); end if;
  if r.status = 'lobby' then return public.td_room_json(v_code, canon); end if;
  if r.status <> 'done' then return json_build_object('ok', false, 'error', 'busy'); end if;

  w := public.td_wallet(canon);
  if w.coins < r.entry then
    return json_build_object('ok', false, 'error', 'broke',
                             'coins', w.coins, 'need', r.entry);
  end if;

  -- The table is cleared and the host buys back in. Everyone else re-joins
  -- by choice through td_join: nobody is re-staked behind their back just
  -- because they left the tab open.
  delete from public.td_seat where td_seat.code = v_code;

  update public.td_player set coins = coins - r.entry
   where name = canon and coins >= r.entry;
  if not found then return json_build_object('ok', false, 'error', 'broke'); end if;

  insert into public.td_seat (code, name, stake) values (v_code, canon, r.entry);

  update public.td_room
     set status = 'lobby', target_ms = null, started_at = null,
         winner = null, pot = r.entry, updated_at = now()
   where td_room.code = v_code;

  return public.td_room_json(v_code, canon);
end;
$$;


-- ---------------------------------------------------------------------
-- 4. Practice
-- ---------------------------------------------------------------------

-- The reward tier is decided here, from the two times. The client never
-- says how many coins it earned. A one-second cooldown and a daily cap
-- keep a scripted caller from farming the Master arena out of practice.
/* Arm a practice round. The server records the target and the start instant,
 * so the reward is paid against something it chose to remember rather than
 * two numbers the client invents. */
create or replace function public.td_practice_arm(
  p_name text, p_password text, p_target_ms integer)
returns json
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
declare canon text;
begin
  canon := public.td_who(p_name, p_password);
  if canon is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  if p_target_ms is null or p_target_ms < 300 or p_target_ms > 8000 then
    return json_build_object('ok', false, 'error', 'bad_time');
  end if;

  perform public.td_wallet(canon);
  -- Lock the wallet the same way td_practice does. Without it two tabs arming
  -- at once interleave, and whichever UPDATE lands last decides the target for
  -- BOTH rounds -- so one player is scored against a target they never saw.
  perform 1 from public.td_player where name = canon for update;
  update public.td_player
     set practice_target_ms = p_target_ms,
         practice_armed_at  = now() + interval '3 seconds'
   where name = canon;

  return json_build_object('ok', true, 'target_ms', p_target_ms,
                           'starts_at', now() + interval '3 seconds', 'now', now());
end;
$$;

/* Score an armed practice round.
 *
 * The wallet row is LOCKED first. An earlier version read the daily cap from
 * an unlocked snapshot and wrote back earned + granted from that stale value,
 * so fifty concurrent calls each added 50 coins while the counter stayed at 50
 * -- an unbounded printer, and the client picked both the target and the stop
 * time, so every call was a free DOT.
 *
 * Rate limiting is now structural rather than a timer: a reward needs an arm,
 * an arm is spent by the first answer whether it scores or not, and the answer
 * must be consistent with the time actually elapsed since that arm. The 500
 * coins/day cap is the backstop. (last_practice_at is still recorded, but it
 * is history now, not a cooldown.) */
create or replace function public.td_practice(
  p_name text, p_password text, p_stop_ms integer)
returns json
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
declare
  canon text; w public.td_player; d integer; reward integer;
  today date := (now() at time zone 'utc')::date;
  cap constant bigint := 500; earned bigint; granted integer;
  elapsed_ms numeric; tgt integer;
begin
  canon := public.td_who(p_name, p_password);
  if canon is null then return json_build_object('ok', false, 'error', 'auth'); end if;

  perform public.td_wallet(canon);
  select * into w from public.td_player where name = canon for update;

  tgt := w.practice_target_ms;
  if tgt is null or w.practice_armed_at is null then
    return json_build_object('ok', false, 'error', 'not_armed');
  end if;
  -- A rejected answer still SPENDS the arm. Leaving it live let a caller
  -- resubmit different stop times against one armed round until one landed
  -- inside the window, which is exactly the farming this flow exists to stop.
  if p_stop_ms is null or p_stop_ms < 0 or p_stop_ms > 20000 then
    update public.td_player set practice_target_ms = null, practice_armed_at = null
     where name = canon;
    return json_build_object('ok', false, 'error', 'bad_time');
  end if;

  elapsed_ms := extract(epoch from (now() - w.practice_armed_at)) * 1000;
  if elapsed_ms < p_stop_ms - 1200 or elapsed_ms > p_stop_ms + 20000 then
    update public.td_player set practice_target_ms = null, practice_armed_at = null
     where name = canon;
    return json_build_object('ok', false, 'error', 'impossible');
  end if;

  d := abs(p_stop_ms - tgt);
  reward := case
              when d = 0    then 50      -- DOT
              when d <= 10  then 20
              when d <= 50  then 10
              when d <= 100 then 5
              when d <= 200 then 2
              else 0
            end;

  earned := case when w.practice_day = today then w.practice_earned_today else 0 end;
  granted := least(reward, greatest(cap - earned, 0))::int;

  update public.td_player
     set coins                 = coins + granted,
         dots                  = dots + case when d = 0 then 1 else 0 end,
         best_diff_ms          = case when best_diff_ms is null then d
                                      else least(best_diff_ms, d) end,
         practice_day          = today,
         practice_earned_today = earned + granted,
         last_practice_at      = now(),
         practice_target_ms    = null,      -- one reward per arm
         practice_armed_at     = null
   where name = canon;

  insert into public.td_history
    (name, mode, entry, players, target_ms, stop_ms, diff_ms, won, delta)
  values (canon, 'practice', 0, 1, tgt, p_stop_ms, d, d = 0, granted);

  return json_build_object(
    'ok', true, 'diff_ms', d, 'dot', d = 0, 'target_ms', tgt,
    'reward', granted, 'earned_full', reward, 'capped', granted < reward,
    'coins', (select coins from public.td_player where name = canon));
end;
$$;


-- ---------------------------------------------------------------------
-- 5. Read-only helpers for the menus
-- ---------------------------------------------------------------------

create or replace function public.td_me(p_name text, p_password text)
returns json
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
declare canon text;
begin
  canon := public.td_who(p_name, p_password);
  if canon is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  return public.td_profile_json(canon);
end;
$$;

-- Reading a room now requires an account AND a seat, so the target and the
-- rival times are never handed to a stranger who guessed a 4-letter code.
create or replace function public.td_state(p_name text, p_password text, p_code text)
returns json
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
declare canon text;
begin
  canon := public.td_who(p_name, p_password);
  if canon is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  return public.td_room_json(upper(btrim(coalesce(p_code, ''))), canon);
end;
$$;

-- Poll + settle in one call. Clients hit this on a timer, so a round
-- still finishes even if every realtime message is lost.
/* Poll + settle in one call. Clients hit this on a timer, so a round still
 * finishes even if every realtime message is lost. */
create or replace function public.td_tick(p_name text, p_password text, p_code text)
returns json
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
declare canon text; r public.td_room; v_code text;
begin
  canon := public.td_who(p_name, p_password);
  if canon is null then return json_build_object('ok', false, 'error', 'auth'); end if;

  v_code := upper(btrim(coalesce(p_code, '')));
  select * into r from public.td_room where td_room.code = v_code;
  if not found then return json_build_object('ok', false, 'error', 'no_room'); end if;
  if r.status = 'playing' then perform public.td_settle(v_code); end if;
  return public.td_room_json(v_code, canon);
end;
$$;

create or replace function public.td_history_for(p_name text, p_password text, p_limit integer)
returns json
language plpgsql security definer
set search_path = extensions, public, pg_temp
as $$
declare canon text;
begin
  canon := public.td_who(p_name, p_password);
  if canon is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  return json_build_object('ok', true, 'rows', coalesce((
    select json_agg(row_to_json(h) order by h.created_at desc) from (
      select mode, arena, entry, players, target_ms, stop_ms, diff_ms, place, won, delta, created_at
        from public.td_history where name = canon
       order by created_at desc
       limit greatest(1, least(coalesce(p_limit, 20), 50))
    ) h), '[]'::json));
end;
$$;


-- ---------------------------------------------------------------------
-- 6. Who may call what
-- ---------------------------------------------------------------------

-- Internals stay shut: these move coins without asking for a password and
-- must never be reachable from the browser.
revoke all on function public.td_who(text, text)                 from public, anon, authenticated;
revoke all on function public.td_wallet(text)                    from public, anon, authenticated;
revoke all on function public.td_profile_json(text)              from public, anon, authenticated;
revoke all on function public.td_room_json(text, text)           from public, anon, authenticated;
revoke all on function public.td_refund_room(text, text)         from public, anon, authenticated;
revoke all on function public.td_quit_open_rooms(text)           from public, anon, authenticated;
revoke all on function public.td_lock_rooms(text, text)          from public, anon, authenticated;
-- Internal only. It is reached through td_stop and td_tick, which both check a
-- password; exposed directly it handed any anonymous caller every seat's time
-- in any finished room they could name.
revoke all on function public.td_settle(text)                    from public, anon, authenticated;

grant execute on function public.td_entry_for(text)                           to anon, authenticated;
grant execute on function public.td_me(text, text)                            to anon, authenticated;
grant execute on function public.td_state(text, text, text)                   to anon, authenticated;
grant execute on function public.td_tick(text, text, text)                    to anon, authenticated;
grant execute on function public.td_create(text, text, text, text, integer)   to anon, authenticated;
grant execute on function public.td_join(text, text, text)                    to anon, authenticated;
grant execute on function public.td_leave(text, text, text)                   to anon, authenticated;
grant execute on function public.td_start(text, text, text)                   to anon, authenticated;
grant execute on function public.td_stop(text, text, text, integer, integer)  to anon, authenticated;
grant execute on function public.td_rematch(text, text, text)                 to anon, authenticated;
grant execute on function public.td_practice_arm(text, text, integer)         to anon, authenticated;
grant execute on function public.td_practice(text, text, integer)             to anon, authenticated;
grant execute on function public.td_history_for(text, text, integer)          to anon, authenticated;
-- Now password-gated, so it is no longer a free anonymous table scan.
grant execute on function public.td_sweep(text, text)                        to anon, authenticated;

select 'Time Duel: database ready' as result;
