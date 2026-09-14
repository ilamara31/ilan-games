-- Merges the duplicate leaderboard rows.
--
-- Cause: public.leaderboard holds a separate row per (name, game, is_guest), so every
-- player who played as a guest AND signed in has two rows for the same game and
-- appears twice on the board. 62 such pairs exist today.
--
-- This keeps the HIGHER score of each pair and deletes the other. It matches on
-- the EXACT name, so it only ever merges rows that already belong to the same
-- account — it will not touch 'Ilan' vs 'ilan', which are genuinely separate
-- accounts (auth is case-sensitive). Those are listed by the query at the bottom
-- for you to decide on.
--
-- Note: `leaderboard` is a real table here, not a view over a `scores` table —
-- there is no public.scores on this project.
--
-- Run the SELECT first to see what would go; the DELETE second.

-- 1. Preview: what will be removed.
select s.name, s.game, s.score as losing_score, s.is_guest as losing_is_guest,
       t.score as kept_score, t.is_guest as kept_is_guest
  from public.leaderboard s
  join public.leaderboard t
    on s.name = t.name
   and s.game = t.game
   and s.ctid <> t.ctid
 where s.score < t.score
    or (s.score = t.score and s.ctid > t.ctid)
 order by s.name, s.game;

-- 2. The delete itself. ctid is the physical row id — used as the tie-break so
--    that two rows with an identical score still leave exactly one behind.
delete from public.leaderboard s
 using public.leaderboard t
 where s.name = t.name
   and s.game = t.game
   and s.ctid <> t.ctid
   and (s.score < t.score
        or (s.score = t.score and s.ctid > t.ctid));

-- 3. Verify: this must return no rows afterwards.
select name, game, count(*)
  from public.leaderboard
 group by name, game
having count(*) > 1;

-- 4. Separate question — accounts that differ only by capitalisation.
--    These are DIFFERENT accounts with different passwords, so merging them
--    would merge two people. Nothing here does that; review and decide.
select lower(name) as folded, array_agg(distinct name) as variants
  from public.players
 group by lower(name)
having count(distinct name) > 1;
