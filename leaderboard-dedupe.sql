-- Merges duplicate leaderboard rows — STACK TOWER ONLY.
--
-- Cause: public.leaderboard holds a separate row per (name, game, is_guest), so
-- every player who played as a guest AND signed in has two rows for the same
-- game and appears twice on the board.
--
-- Scoped to game = 'stack' deliberately. The same pattern affects every other
-- game (62 duplicate pairs across all of them), but fixing one board first means
-- a mistake costs one game's history rather than all of them. Once this is
-- confirmed good, the same statements with the game filter removed will do the
-- rest.
--
-- Note: `leaderboard` is a real table here, not a view — there is no
-- public.scores on this project.
--
-- Run these one at a time, in order.

-- ---------------------------------------------------------------- 1. PREVIEW
-- What would be deleted, and what would be kept in its place.
select s.name,
       s.score    as losing_score,  s.is_guest as losing_is_guest,
       t.score    as kept_score,    t.is_guest as kept_is_guest
  from public.leaderboard s
  join public.leaderboard t
    on s.name = t.name
   and s.game = t.game
   and s.ctid <> t.ctid
 where s.game = 'stack'
   and (s.score < t.score
        or (s.score = t.score and s.ctid > t.ctid))
 order by s.name;

-- ---------------------------------------------------------------- 2. DELETE
-- Keeps the higher score of each pair. Matches on the EXACT name, so it only
-- ever merges rows already belonging to the same account — 'Ilan' and 'ilan'
-- are separate accounts and are left alone. ctid is the physical row id, used
-- as the tie-break so two identical scores still leave exactly one row.
delete from public.leaderboard s
 using public.leaderboard t
 where s.name = t.name
   and s.game = t.game
   and s.ctid <> t.ctid
   and s.game = 'stack'
   and (s.score < t.score
        or (s.score = t.score and s.ctid > t.ctid));

-- ---------------------------------------------------------------- 3. VERIFY
-- Must return no rows.
select name, count(*) as rows_remaining
  from public.leaderboard
 where game = 'stack'
 group by name
having count(*) > 1;

-- ---------------------------------------------------------------- 4. REVIEW
-- Accounts on the stack board that differ only by capitalisation. These are
-- DIFFERENT accounts with different passwords — possibly different people — so
-- nothing above touches them. Listed for a human decision.
select lower(name) as folded,
       array_agg(name order by score desc) as variants,
       array_agg(score order by score desc) as scores
  from public.leaderboard
 where game = 'stack'
 group by lower(name)
having count(distinct name) > 1;

-- ------------------------------------------------- 5. CASE VARIANTS, EQUAL SCORES
-- Accounts differing only by capitalisation are genuinely separate accounts with
-- separate passwords, so merging them is normally unsafe. The exception is when
-- every variant holds the SAME score: nothing can be lost by collapsing them,
-- because whichever row survives carries the identical number.
--
-- Today that is only 'Mags'/'mags' (both 117). 'mitran'/'Mitran' (203 vs 70) and
-- 'cr7'/'CR7' (68 vs 59) differ and are deliberately untouched — those could be
-- two different people, and deleting the lower one would destroy a real score.
--
-- Keeps the physically oldest row of each equal-score group.

-- Preview
select lower(s.name) as folded, s.name as would_delete, t.name as would_keep, s.score
  from public.leaderboard s
  join public.leaderboard t
    on lower(s.name) = lower(t.name)
   and s.game = t.game
   and s.name <> t.name
   and s.score = t.score
   and s.ctid > t.ctid
 where s.game = 'stack';

-- Delete
delete from public.leaderboard s
 using public.leaderboard t
 where lower(s.name) = lower(t.name)
   and s.game = t.game
   and s.name <> t.name
   and s.score = t.score          -- only when nothing can be lost
   and s.ctid > t.ctid
   and s.game = 'stack';

-- Verify: no folded name should appear more than once on the stack board,
-- EXCEPT mitran/Mitran and cr7/CR7, which are intentionally left.
select lower(name) as folded, array_agg(name), array_agg(score)
  from public.leaderboard
 where game = 'stack'
 group by lower(name)
having count(*) > 1;
