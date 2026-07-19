-- =====================================================================
-- PUZZLE CREATOR — remove QA/test data (run ONCE in the SQL Editor)
-- Deletes the "QA ..." test puzzles left by automated testing and any test
-- ratings/follows, then recomputes rating aggregates so real puzzles stay exact.
-- Your real puzzles (e.g. "first") are untouched.
-- =====================================================================

-- 1) delete the automated test puzzles (cascades to their ratings & bookmarks)
delete from public.pc_puzzles where title like 'QA %' or title = 'Test Doubler';

-- 2) delete test ratings made under throwaway QA user ids
delete from public.pc_ratings where user_id like 'qa_%';

-- 3) delete test follows aimed at the local-only sample creators
delete from public.pc_follows where target_id in ('s_ada','s_max','s_rio');

-- 4) recompute every puzzle's rating_sum / rating_count from the surviving ratings
update public.pc_puzzles p set
  rating_sum   = coalesce((select sum(stars)  from public.pc_ratings r where r.puzzle_id = p.id), 0),
  rating_count = coalesce((select count(*)     from public.pc_ratings r where r.puzzle_id = p.id), 0);

-- Done. Reload Puzzle Creator — only your real puzzles remain.
