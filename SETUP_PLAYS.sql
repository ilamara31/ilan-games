-- ============================================================
-- Ilan Games — 🔥 Trending + total play counts   (run ONCE in Supabase)
-- Supabase dashboard  →  SQL Editor  →  New query  →  paste  →  Run
-- Safe to re-run; it only creates things if they don't exist and never
-- resets counts.
--
-- NOTE: the home page already shows REAL "people played" numbers from the
-- leaderboard even before you run this. Running this upgrades it to a true
-- play counter that ticks up on every play (bigger, Poki-style numbers).
-- ============================================================

-- 1) the counter: one row per game
create table if not exists public.game_plays (
  game  text primary key,
  plays integer not null default 0
);

-- 2) anyone can READ the counts (to show them on the home page)
alter table public.game_plays enable row level security;
drop policy if exists "plays read" on public.game_plays;
create policy "plays read" on public.game_plays for select using (true);

-- 3) count a play: +1 for the game, returns the new total
create or replace function public.bump_play(p_game text)
returns integer
language plpgsql security definer set search_path = public
as $$
declare n integer;
begin
  insert into public.game_plays(game, plays) values (p_game, 1)
  on conflict (game) do update set plays = public.game_plays.plays + 1
  returning plays into n;
  return n;
end;
$$;
grant execute on function public.bump_play(text) to anon, authenticated;

-- 4) one-time starting numbers from real past activity
--    (distinct players per game on the leaderboard so far)
insert into public.game_plays(game, plays) values
  ('catch',16),('try',13),('stack',12),('obby',9),('tennis',9),
  ('fruit-arena',8),('f1',8),('cricket',8),('pptour',7),('puzzles',7),
  ('anime-tycoon',6),('archer',5),('karate',5),('paper',5),('rescue',4),
  ('football',4),('thisorthat',0)
on conflict (game) do nothing;
