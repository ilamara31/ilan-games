-- =====================================================================
--  Ilan Games — PRE-FLIGHT CHECK  (read-only, changes nothing)
--
--  Run this in Supabase → SQL Editor BEFORE accounts-setup.sql, and read the
--  five results. It only looks; it does not touch a single row.
--
--  What to look for is written above each query. If anything looks wrong,
--  paste the output to Claude before running accounts-setup.sql.
-- =====================================================================

-- 1. THE ACCOUNT TABLE ------------------------------------------------------
-- Expect one row per column of public.players. Check:
--   • which column holds the password (accounts-setup.sql must find this one)
--   • nothing except `name` is "NOT NULL with no default" — a required column
--     with no default would make every new sign-up fail.
select column_name,
       data_type,
       is_nullable,
       column_default,
       case when is_nullable = 'NO' and column_default is null and column_name <> 'name'
            then '⚠️ would break sign-up' else '' end as warning
  from information_schema.columns
 where table_schema = 'public' and table_name = 'players'
 order by ordinal_position;


-- 2. WHO OWNS THE TABLE, AND IS RLS ON? -------------------------------------
-- `tableowner` should be the role you are running as (normally `postgres`).
-- If it is not, accounts-setup.sql cannot alter the table.
select tablename, tableowner, rowsecurity as rls_on
  from pg_tables
 where schemaname = 'public' and tablename = 'players';


-- 3. EXISTING ACCOUNT FUNCTIONS ---------------------------------------------
-- Expect to see account_auth. Note how many versions there are and what
-- arguments each takes — an older build of the site called it with only two
-- (name, password), and accounts-setup.sql has to replace every version.
select p.oid::regprocedure                        as signature,
       pg_get_function_identity_arguments(p.oid)  as arguments,
       t.typname                                  as returns,
       p.prosecdef                                as security_definer,
       pg_get_userbyid(p.proowner)                as owner
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_type t on t.oid = p.prorettype
 where n.nspname = 'public'
   and p.proname in ('account_auth', 'account_auth_legacy', 'account_signup',
                     'account_login', 'account_info', 'post_score')
 order by p.proname;


-- 4. HOW post_score CHECKS THE PASSWORD -------------------------------------
-- This is the one thing accounts-setup.sql cannot see for itself.
-- ✅ GOOD  — the body mentions account_auth (or ig_check): it will keep working.
-- ⚠️ CHECK — it does its own password comparison (md5/crypt/digest/= p_password):
--            brand-new accounts use a different hash, so their scores would
--            silently never reach the leaderboard. Send the body to Claude.
select case
         when prosrc ilike '%account_auth%' or prosrc ilike '%ig_check%'
           then '✅ delegates the password check — nothing to do'
         when prosrc ilike '%crypt%' or prosrc ilike '%md5%' or prosrc ilike '%digest%'
           then '⚠️ checks the password itself — send the body below to Claude'
         else '⚠️ unclear — send the body below to Claude'
       end as verdict,
       prosrc as body
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'post_score';


-- 5. DUPLICATE NAMES THAT DIFFER ONLY BY CAPITALISATION ---------------------
-- The old code created an account whenever a name was unknown, so "bob" and
-- "Bob" may both exist as separate accounts. Expect NO ROWS. If any come back,
-- tell Claude — those two players need merging before the strict rules go in.
select lower(name) as same_name_lowercased,
       count(*)    as how_many,
       string_agg(name, ' | ') as spellings
  from public.players
 group by lower(name)
having count(*) > 1;
