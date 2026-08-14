-- =====================================================================
--  Ilan Games — PRE-FLIGHT CHECK   (read-only: it looks, it changes nothing)
--
--  Run this in Supabase → SQL Editor BEFORE accounts-setup.sql.
--  It is ONE query on purpose — the SQL Editor only shows the last result,
--  so everything comes back in a single table of (section, detail) rows.
--
--  Reading the result:
--    A  every column of public.players. "WOULD BREAK SIGN-UP" means a required
--       column with no default. It is EXPECTED on the password column itself
--       (`pin_hash` here) — creating an account fills that one in. On any other
--       column it is a real problem and the setup script refuses to run.
--    B  who owns the table (should be the role you're running as) and RLS.
--    C  the account functions that already exist, and their arguments. An
--       older build called account_auth with only 2 arguments, so there may
--       be more than one version.
--    D  how post_score checks the password. "GOOD" = it delegates and will
--       keep working. "CHECK"/"UNCLEAR" = send the text to Claude, because
--       new accounts' scores could silently never reach the leaderboard.
--    E  accounts whose names differ only by capitalisation ("bob"/"Bob").
--       NO "E." ROW AT ALL IS THE GOOD RESULT.
-- =====================================================================

select 'A. players column' as section,
       column_name || '  |  ' || data_type || '  |  '
         || (case when is_nullable = 'NO' then 'required' else 'optional' end)
         || (case when is_nullable = 'NO' and column_default is null and column_name <> 'name'
                  then '   <-- WOULD BREAK SIGN-UP' else '' end) as detail
  from information_schema.columns
 where table_schema = 'public' and table_name = 'players'

union all
select 'B. owner / security',
       tableowner || '  |  row level security ' || (case when rowsecurity then 'ON' else 'OFF' end)
  from pg_tables
 where schemaname = 'public' and tablename = 'players'

union all
select 'C. existing function',
       p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')  ->  ' || t.typname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_type t on t.oid = p.prorettype
 where n.nspname = 'public'
   and p.proname in ('account_auth', 'account_auth_legacy', 'account_signup',
                     'account_login', 'account_info', 'post_score')

union all
select 'D. post_score password check',
       case when prosrc ilike '%account_auth%' or prosrc ilike '%ig_check%'
              then 'GOOD — it delegates the password check, nothing to do'
            when prosrc ilike '%crypt%' or prosrc ilike '%md5%' or prosrc ilike '%digest%'
              then 'CHECK — it checks the password itself: ' || left(regexp_replace(prosrc, '\s+', ' ', 'g'), 400)
            else 'UNCLEAR — send this to Claude: ' || left(regexp_replace(prosrc, '\s+', ' ', 'g'), 400) end
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'post_score'

union all
select 'E. duplicate name (BAD)',
       lower(name) || '  x' || count(*) || '   (' || string_agg(name, '  |  ') || ')'
  from public.players
 group by lower(name)
having count(*) > 1

order by 1;
