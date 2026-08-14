-- ============================================================================
--  SUPER OVER CRICKET — CHALLENGE HUB
--  RUN ONCE: Supabase -> SQL Editor -> paste -> Run.  Safe to re-run.
--
--  A player bats an innings, publishes the score as a target, and everybody
--  else tries to chase it. Two tables and four functions, nothing else.
--
--  SECURITY MODEL: RLS is on with NO policies and NO table grants, so the
--  tables are unreachable from the browser key. Every read and write goes
--  through the SECURITY DEFINER functions below — which means attempts and
--  success rates cannot be edited from devtools, only earned.
--
--  IDEMPOTENCY: publish and attempt both carry a client-generated token with
--  a unique index. A retry after a dropped connection replays the same token
--  and is swallowed, so a flaky phone can never double-count a chase or post
--  the same challenge twice.
-- ============================================================================

-- ---- challenges -----------------------------------------------------------
create table if not exists public.cric_challenges (
  id         bigint generated always as identity primary key,
  token      text not null,                   -- client-generated, dedupes retries
  user_key   text not null,                   -- the setter's username (case-sensitive)
  username   text not null,                   -- display name, frozen at publish time
  target     int  not null check (target  between 1 and 2000),
  overs      int  not null check (overs   between 1 and 50),
  wkts       int  not null default 0 check (wkts between 0 and 10),
  attempts   int  not null default 0,         -- completed chases, won or lost
  wins       int  not null default 0,         -- successful chases
  hidden     boolean not null default false,  -- moderation
  created_at timestamptz not null default now(),
  -- derived, never written by hand: wins ÷ attempts × 100
  success_rate numeric(5,1) generated always as
    (case when attempts > 0 then round(wins * 100.0 / attempts, 1) else 0 end) stored
);

create unique index if not exists cric_ch_token   on public.cric_challenges (token);
create index if not exists cric_ch_created on public.cric_challenges (created_at desc) where hidden = false;
create index if not exists cric_ch_rate    on public.cric_challenges (success_rate asc) where hidden = false;
create index if not exists cric_ch_user    on public.cric_challenges (user_key);

-- ---- attempts -------------------------------------------------------------
create table if not exists public.cric_attempts (
  id           bigint generated always as identity primary key,
  token        text not null,                 -- client-generated, dedupes retries
  challenge_id bigint not null references public.cric_challenges(id) on delete cascade,
  user_key     text not null,
  username     text not null,
  score        int  not null default 0,
  wkts         int  not null default 0,
  balls_used   int  not null default 0,
  won          boolean not null default false,
  created_at   timestamptz not null default now()
);

create unique index if not exists cric_at_token on public.cric_attempts (token);
-- the index that makes the Trending tab cheap
create index if not exists cric_at_recent on public.cric_attempts (challenge_id, created_at desc);
create index if not exists cric_at_user   on public.cric_attempts (user_key);

-- ---- locked down: functions are the only door -----------------------------
alter table public.cric_challenges enable row level security;
alter table public.cric_attempts   enable row level security;
revoke all on public.cric_challenges from anon, authenticated;
revoke all on public.cric_attempts   from anon, authenticated;

-- ---------------------------------------------------------------- publish --
create or replace function public.cric_publish(
  p_token text, p_key text, p_name text, p_target int, p_overs int, p_wkts int)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_tok  text := nullif(trim(coalesce(p_token, '')), '');
  v_key  text := nullif(trim(coalesce(p_key,   '')), '');
  v_name text := left(coalesce(nullif(trim(coalesce(p_name, '')), ''), 'Player'), 30);
  v_id   bigint;
begin
  if v_tok is null or v_key is null then
    return json_build_object('ok', false, 'err', 'no-user');
  end if;
  if p_target is null or p_target < 10 or p_target > 2000 then
    return json_build_object('ok', false, 'err', 'bad-target');
  end if;
  if p_overs is null or p_overs < 1 or p_overs > 50 then
    return json_build_object('ok', false, 'err', 'bad-overs');
  end if;

  -- a retry after a dropped connection replays the same token: hand back the
  -- row that already landed instead of publishing a second copy
  select id into v_id from public.cric_challenges where token = left(v_tok, 60);
  if v_id is not null then
    return json_build_object('ok', true, 'id', v_id, 'dup', true);
  end if;

  insert into public.cric_challenges (token, user_key, username, target, overs, wkts)
  values (left(v_tok, 60), left(v_key, 40), v_name, p_target, p_overs,
          greatest(0, least(coalesce(p_wkts, 0), 10)))
  on conflict (token) do nothing
  returning id into v_id;

  -- lost the race against our own retry — the other one won, reuse it
  if v_id is null then
    select id into v_id from public.cric_challenges where token = left(v_tok, 60);
    return json_build_object('ok', true, 'id', v_id, 'dup', true);
  end if;

  return json_build_object('ok', true, 'id', v_id, 'dup', false);
end $$;

-- ---------------------------------------------------------------- attempt --
create or replace function public.cric_attempt(
  p_token text, p_challenge bigint, p_key text, p_name text,
  p_score int, p_wkts int, p_balls int, p_won boolean)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_tok text := nullif(trim(coalesce(p_token, '')), '');
  v_key text := nullif(trim(coalesce(p_key,   '')), '');
  v_ins int;
  v_a   int;
  v_w   int;
  v_r   numeric;
begin
  if v_tok is null or v_key is null then
    return json_build_object('ok', false, 'err', 'no-user');
  end if;
  if not exists (select 1 from public.cric_challenges where id = p_challenge) then
    return json_build_object('ok', false, 'err', 'gone');
  end if;

  insert into public.cric_attempts
    (token, challenge_id, user_key, username, score, wkts, balls_used, won)
  values (left(v_tok, 60), p_challenge, left(v_key, 40),
          left(coalesce(nullif(trim(coalesce(p_name, '')), ''), 'Player'), 30),
          greatest(0, coalesce(p_score, 0)),
          greatest(0, least(coalesce(p_wkts, 0), 10)),
          greatest(0, coalesce(p_balls, 0)),
          coalesce(p_won, false))
  on conflict (token) do nothing;

  get diagnostics v_ins = row_count;

  -- only a genuinely new attempt moves the counters; a replayed token does not
  if v_ins > 0 then
    update public.cric_challenges
       set attempts = attempts + 1,
           wins     = wins + case when coalesce(p_won, false) then 1 else 0 end
     where id = p_challenge;
  end if;

  select attempts, wins, success_rate into v_a, v_w, v_r
    from public.cric_challenges where id = p_challenge;

  return json_build_object('ok', true, 'attempts', coalesce(v_a, 0),
                           'wins', coalesce(v_w, 0), 'rate', coalesce(v_r, 0));
end $$;

-- ----------------------------------------------------------------- browse --
--  p_tab: 'trending' (most chased this week) | 'newest' | 'hardest'
--  Paged — the client never asks for the whole table.
create or replace function public.cric_browse(p_tab text, p_limit int, p_offset int)
returns table (
  id bigint, username text, target int, overs int, wkts int,
  attempts int, wins int, rate numeric, created_at timestamptz)
language sql security definer set search_path = public as $$
  select c.id, c.username, c.target, c.overs, c.wkts,
         c.attempts, c.wins, c.success_rate, c.created_at
  from public.cric_challenges c
  where c.hidden = false
  order by
    -- trending: chased the most in the last 7 days
    case when p_tab = 'trending' then
      (select count(*) from public.cric_attempts a
        where a.challenge_id = c.id and a.created_at > now() - interval '7 days')
    end desc nulls last,
    -- hardest: lowest success rate, but untried targets sink to the bottom
    -- (0 attempts is not the same thing as "nobody can do it")
    case when p_tab = 'hardest' then (c.attempts = 0)::int end asc nulls last,
    case when p_tab = 'hardest' then c.success_rate end asc nulls last,
    case when p_tab = 'hardest' then -c.target end asc nulls last,
    c.created_at desc
  limit  greatest(1, least(coalesce(p_limit, 10), 50))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- -------------------------------------------------------------- my targets --
create or replace function public.cric_mine(p_key text, p_limit int)
returns table (
  id bigint, username text, target int, overs int, wkts int,
  attempts int, wins int, rate numeric, created_at timestamptz)
language sql security definer set search_path = public as $$
  select c.id, c.username, c.target, c.overs, c.wkts,
         c.attempts, c.wins, c.success_rate, c.created_at
  from public.cric_challenges c
  where c.hidden = false and c.user_key = nullif(trim(coalesce(p_key, '')), '')
  order by c.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

grant execute on function public.cric_publish(text, text, text, int, int, int)              to anon, authenticated;
grant execute on function public.cric_attempt(text, bigint, text, text, int, int, int, boolean) to anon, authenticated;
grant execute on function public.cric_browse(text, int, int)                                to anon, authenticated;
grant execute on function public.cric_mine(text, int)                                       to anon, authenticated;

-- Done. Super Over Cricket → 🎯 CHALLENGE HUB now persists.
