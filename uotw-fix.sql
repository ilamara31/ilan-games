-- ============================================================================
--  USER OF THE WEEK — bug-fix migration
--  Run this ONCE in the Supabase SQL editor (safe to re-run).
--
--  What it fixes:
--   1. plays can now be banked and flushed in batches, so a bump is never
--      silently dropped by the client's rate limit.
--   2. the week is decided SERVER-side, so players in different timezones
--      can no longer land in different week buckets.
--   3. a player who renames keeps their plays (ownership-token merge).
--
--  The old 3-argument public.ig_play_bump(text,text,int) is deliberately LEFT
--  IN PLACE — browsers with an old cached friends.js still call it, and it
--  keeps working exactly as before.
-- ============================================================================

-- Ownership token: proves a device owns a user_key, so a rename can move that
-- key's plays without letting a stranger hijack (or wipe) someone else's row.
alter table public.ig_weekly add column if not exists owner_token text;

-- The table is world-readable (the leaderboard needs it), but the token must NOT
-- be — anyone who could read it could claim someone else's plays. Column-level
-- grants hide it; the security-definer functions below still see it fine.
revoke select on public.ig_weekly from anon, authenticated;
grant select (user_key, user_name, week, plays, updated) on public.ig_weekly to anon, authenticated;

-- ---------------------------------------------------------------------------
--  Which timezone decides when the week rolls over (Thursday night → Friday)?
--  Change the one string below to move the rollover, e.g. 'Asia/Kolkata'.
-- ---------------------------------------------------------------------------
create or replace function public.ig_week_tz()
returns text language sql immutable as $$ select 'UTC'::text $$;

-- The week's id = the day-index of the Friday that started it.
create or replace function public.ig_week_index(p_ts timestamptz default now())
returns int language sql stable as $$
  select (
      (extract(epoch from date_trunc('day', p_ts at time zone public.ig_week_tz()))::bigint / 86400)::int
    - ((extract(dow from (p_ts at time zone public.ig_week_tz()))::int - 5 + 7) % 7)
  );
$$;

-- Clients ask the server which week it is instead of guessing locally.
create or replace function public.ig_week_now()
returns int language sql stable as $$ select public.ig_week_index(now()) $$;

-- ---------------------------------------------------------------------------
--  Batched, server-timed play credit. Returns the player's new weekly total.
-- ---------------------------------------------------------------------------
create or replace function public.ig_play_bump_n(p_name text, p_key text, p_n int, p_token text default null)
returns int language plpgsql security definer as $$
declare v_week int; v_n int; v_total int;
begin
  if p_key is null or p_key = '' then return 0; end if;
  -- never trust a client-supplied count: one call can add at most 60 plays
  v_n := least(greatest(coalesce(p_n, 0), 0), 60);
  if v_n = 0 then return 0; end if;
  v_week := public.ig_week_index(now());

  insert into public.ig_weekly(user_key, user_name, week, plays, owner_token)
  values (p_key, coalesce(nullif(p_name, ''), p_key), v_week, v_n, nullif(p_token, ''))
  on conflict (user_key, week) do update
    set plays       = public.ig_weekly.plays + v_n,
        user_name   = excluded.user_name,
        -- first device to play under this name claims it; later ones don't steal it
        owner_token = coalesce(public.ig_weekly.owner_token, excluded.owner_token),
        updated     = now()
  returning plays into v_total;

  return v_total;
end $$;

-- ---------------------------------------------------------------------------
--  Rename rescue: move every week's plays from an old name-key to the new one.
--  Only succeeds for rows this device actually owns (matching owner_token), so
--  it can't be used to steal or wipe another player's plays.
-- ---------------------------------------------------------------------------
create or replace function public.ig_play_merge(p_old text, p_new text, p_name text, p_token text)
returns int language plpgsql security definer as $$
declare v_moved int := 0;
begin
  if coalesce(p_old, '') = '' or coalesce(p_new, '') = '' or p_old = p_new
     or coalesce(p_token, '') = '' then
    return 0;
  end if;

  insert into public.ig_weekly(user_key, user_name, week, plays, owner_token)
    select p_new, coalesce(nullif(p_name, ''), p_new), w.week, w.plays, p_token
      from public.ig_weekly w
     where w.user_key = p_old and w.owner_token = p_token
  on conflict (user_key, week) do update
    set plays       = public.ig_weekly.plays + excluded.plays,
        user_name   = excluded.user_name,
        owner_token = coalesce(public.ig_weekly.owner_token, excluded.owner_token),
        updated     = now();

  delete from public.ig_weekly where user_key = p_old and owner_token = p_token;
  get diagnostics v_moved = row_count;
  return v_moved;
end $$;

grant execute on function public.ig_week_tz()                              to anon, authenticated;
grant execute on function public.ig_week_index(timestamptz)                to anon, authenticated;
grant execute on function public.ig_week_now()                             to anon, authenticated;
grant execute on function public.ig_play_bump_n(text, text, int, text)     to anon, authenticated;
grant execute on function public.ig_play_merge(text, text, text, text)     to anon, authenticated;

-- Leaderboard reads order by plays, then by who got there first — no more
-- random winner when two players tie.
create index if not exists ig_weekly_rank on public.ig_weekly (week, plays desc, updated asc);
