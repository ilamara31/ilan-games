-- ============================================================
-- Ilan Games — "NEW GAME" hanging sign: count different players per game
-- (run ONCE in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.)
--
-- The wooden sign for a new game stays up for at least 36 hours, and after
-- that until 4 DIFFERENT players have played it. This table remembers who has
-- played each game (one row per player per game, nothing else).
-- Player names are never readable from the browser — only the count is.
-- ============================================================
create table if not exists public.game_players (
  game     text not null,
  player   text not null,
  first_at timestamptz not null default now(),
  primary key (game, player)
);
alter table public.game_players enable row level security;   -- no direct read/write from the browser

create or replace function public.mark_player(p_game text, p_player text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_game is null or p_player is null or length(p_game) > 40 or length(p_player) > 80 then return; end if;
  insert into public.game_players(game, player) values (p_game, p_player) on conflict do nothing;
end; $$;
grant execute on function public.mark_player(text, text) to anon, authenticated;

create or replace function public.game_player_counts(p_games text[])
returns table(game text, players integer) language sql security definer set search_path = public stable as $$
  select g.game, count(*)::int from public.game_players g where g.game = any(p_games) group by g.game;
$$;
grant execute on function public.game_player_counts(text[]) to anon, authenticated;
