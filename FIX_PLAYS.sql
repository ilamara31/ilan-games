-- ============================================================
-- Ilan Games — one-time cleanup of inflated play counts
-- Supabase dashboard  →  SQL Editor  →  New query  →  paste  →  Run
--
-- Why: from Jul 5–18 the play counter counted a play the INSTANT a game
-- page opened (no 25s rule). Basket Scoop launched Jul 16 with a pulsing
-- NEW badge + home banner, so every curious tap-in-tap-out counted — its
-- number inflated (~110) without real plays. The client was fixed on
-- Jul 18 (25s of active, visible playtime required), but the database
-- still holds the inflated totals.
--
-- This resets Scoop to a provable number: distinct players who actually
-- posted a score to its leaderboard. Adjust or repeat for other games
-- if any look wrong.
-- ============================================================

update public.game_plays
set plays = (
  select count(distinct lower(name))
  from public.leaderboard
  where game = 'scoop'
)
where game = 'scoop';

-- check the result:
select * from public.game_plays order by plays desc;
