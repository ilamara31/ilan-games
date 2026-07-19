-- =====================================================================
-- PUZZLE CREATOR — Supabase setup (run ONCE in the SQL Editor)
-- Isolated: every object is prefixed pc_ and touches nothing else in your project.
-- After this runs, Puzzle Creator auto-detects the tables and goes community-wide
-- (shared puzzles, real ratings/bookmarks/follows across all devices).
-- The app uses only the public "anon"/publishable key, so all writes go through
-- SECURITY DEFINER functions below — clients can never tamper with counts directly.
-- =====================================================================

-- ---------- tables ----------
create table if not exists public.pc_puzzles (
  id            text primary key,
  type          text not null,
  title         text not null,
  category      text,
  difficulty    text,
  data          jsonb not null,
  creator_id    text not null,
  creator_name  text not null,
  plays         integer not null default 0,
  solves        integer not null default 0,
  rating_sum    integer not null default 0,
  rating_count  integer not null default 0,
  featured      boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists pc_puzzles_created_idx on public.pc_puzzles (created_at desc);
create index if not exists pc_puzzles_creator_idx on public.pc_puzzles (creator_id);
create index if not exists pc_puzzles_type_idx    on public.pc_puzzles (type);

create table if not exists public.pc_ratings (
  puzzle_id   text not null references public.pc_puzzles(id) on delete cascade,
  user_id     text not null,
  user_name   text,
  stars       integer not null check (stars between 1 and 5),
  feedback    text,
  created_at  timestamptz not null default now(),
  primary key (puzzle_id, user_id)   -- one rating per user per puzzle (dedup)
);

create table if not exists public.pc_bookmarks (
  user_id     text not null,
  puzzle_id   text not null references public.pc_puzzles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, puzzle_id)
);

create table if not exists public.pc_follows (
  follower_id text not null,
  target_id   text not null,
  created_at  timestamptz not null default now(),
  primary key (follower_id, target_id)
);

-- ---------- row level security: public READ, writes only via the functions below ----------
alter table public.pc_puzzles   enable row level security;
alter table public.pc_ratings   enable row level security;
alter table public.pc_bookmarks enable row level security;
alter table public.pc_follows   enable row level security;

drop policy if exists pc_puzzles_read   on public.pc_puzzles;   create policy pc_puzzles_read   on public.pc_puzzles   for select using (true);
drop policy if exists pc_ratings_read   on public.pc_ratings;   create policy pc_ratings_read   on public.pc_ratings   for select using (true);
drop policy if exists pc_bookmarks_read on public.pc_bookmarks; create policy pc_bookmarks_read on public.pc_bookmarks for select using (true);
drop policy if exists pc_follows_read   on public.pc_follows;   create policy pc_follows_read   on public.pc_follows   for select using (true);
-- (no INSERT/UPDATE/DELETE policies → direct writes are denied; only the SECURITY DEFINER RPCs below can write)

-- ---------- RPCs (anti-spam + integrity live here) ----------

-- publish a puzzle. Rejects empties and obvious duplicate spam (same creator + same title within 10s).
create or replace function public.pc_publish(p jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_id text := coalesce(p->>'id','');
begin
  if v_id = '' or coalesce(p->>'title','') = '' or coalesce(p->>'type','') = '' or (p->'data') is null then
    raise exception 'empty puzzle';
  end if;
  -- duplicate-spam guard: same creator posting the same title in quick succession
  if exists (select 1 from public.pc_puzzles
             where creator_id = p->>'creator_id' and title = p->>'title'
               and created_at > now() - interval '10 seconds') then
    raise exception 'duplicate';
  end if;
  insert into public.pc_puzzles (id,type,title,category,difficulty,data,creator_id,creator_name)
  values (v_id, p->>'type', left(p->>'title',80), p->>'category', p->>'difficulty',
          p->'data', p->>'creator_id', left(p->>'creator_name',20))
  on conflict (id) do nothing;
end $$;

create or replace function public.pc_bump_play(pid text)
returns void language sql security definer set search_path=public as $$
  update public.pc_puzzles set plays = plays + 1 where id = pid;
$$;

create or replace function public.pc_bump_solve(pid text)
returns void language sql security definer set search_path=public as $$
  update public.pc_puzzles set solves = solves + 1 where id = pid;
$$;

-- rate: upsert one rating per (puzzle,user); keep rating_sum/rating_count exact.
create or replace function public.pc_rate(pid text, uid text, stars int, fb text)
returns void language plpgsql security definer set search_path=public as $$
declare prev int;
begin
  if stars < 1 or stars > 5 then raise exception 'bad stars'; end if;
  select r.stars into prev from public.pc_ratings r where r.puzzle_id=pid and r.user_id=uid;
  insert into public.pc_ratings (puzzle_id,user_id,stars,feedback)
  values (pid, uid, stars, left(coalesce(fb,''),300))
  on conflict (puzzle_id,user_id) do update set stars=excluded.stars, feedback=excluded.feedback, created_at=now();
  if prev is null then
    update public.pc_puzzles set rating_sum = rating_sum + stars, rating_count = rating_count + 1 where id = pid;
  else
    update public.pc_puzzles set rating_sum = rating_sum - prev + stars where id = pid;
  end if;
end $$;

create or replace function public.pc_bookmark(pid text, uid text, on_ boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if on_ then insert into public.pc_bookmarks (user_id,puzzle_id) values (uid,pid) on conflict do nothing;
  else delete from public.pc_bookmarks where user_id=uid and puzzle_id=pid; end if;
end $$;

create or replace function public.pc_follow(uid text, target text, on_ boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if uid = target then return; end if;
  if on_ then insert into public.pc_follows (follower_id,target_id) values (uid,target) on conflict do nothing;
  else delete from public.pc_follows where follower_id=uid and target_id=target; end if;
end $$;

-- let the anon/publishable key call the functions (reads are already covered by RLS policies)
grant execute on function public.pc_publish(jsonb)                 to anon, authenticated;
grant execute on function public.pc_bump_play(text)               to anon, authenticated;
grant execute on function public.pc_bump_solve(text)              to anon, authenticated;
grant execute on function public.pc_rate(text,text,int,text)      to anon, authenticated;
grant execute on function public.pc_bookmark(text,text,boolean)   to anon, authenticated;
grant execute on function public.pc_follow(text,text,boolean)     to anon, authenticated;

-- =====================================================================
-- Done. Reload Puzzle Creator — the header should switch to "☁️ Connected".
-- To feature a puzzle: update public.pc_puzzles set featured=true where id='...';
-- =====================================================================
