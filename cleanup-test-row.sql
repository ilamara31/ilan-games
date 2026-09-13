-- Removes a throwaway account left behind by the first (failed) verification
-- run. I generated its password from a timestamp and no longer have it, so the
-- app's own delete path can't remove it — hence doing it directly.
delete from public.scores  where name = 'zz_del_test_01';
delete from public.players where name = 'zz_del_test_01';
