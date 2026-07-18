-- ============================================================
-- Ilan Games — ⚠️ Per-user warnings   (run ONCE in Supabase)
-- Supabase dashboard  →  SQL Editor  →  New query  →  paste  →  Run
--
-- Lets you warn ONE specific account (e.g. a spammer) without shipping any
-- code. announce.js reads this table for the current player and shows a banner.
-- To warn someone later you ONLY paste an INSERT (see the bottom of this file).
-- ============================================================

-- 1) the table: one row per warning
create table if not exists public.ig_warnings (
  id        bigint generated always as identity primary key,
  user_key  text        not null,                 -- lowercase name, symbols -> "_"
  title     text        not null default '⚠️ Warning',
  body      text        not null default '',
  level     text        not null default 'warning', -- info | success | warning
  created   timestamptz not null default now()
);
create index if not exists ig_warnings_user_idx on public.ig_warnings (user_key);

-- 2) players may READ their warning (client filters by their own user_key).
--    There is NO insert/update/delete policy, so the public/anon key CANNOT
--    create or fake warnings — only YOU can, from this SQL Editor.
alter table public.ig_warnings enable row level security;
drop policy if exists ig_warnings_read on public.ig_warnings;
create policy ig_warnings_read on public.ig_warnings for select to anon, authenticated using (true);
grant select on public.ig_warnings to anon, authenticated;

-- ============================================================
-- HOW TO WARN A PLAYER  (copy the two statements below, edit, run)
--
-- The user_key is the display name lowercased with any run of non-letters/
-- digits turned into "_", e.g.  "DA GOAT" -> da_goat ,  "dagoat" -> dagoat .
-- ============================================================

-- (a) reset this spammer's User-of-the-Week plays to zero (every week)
update public.ig_weekly
   set plays = 0
 where user_key = 'dagoat';

-- (b) send the warning banner to that account
insert into public.ig_warnings (user_key, title, body, level) values
  ('dagoat',
   '⚠️ Warning — stop spamming',
   'Opening and closing games to farm plays has been detected. Your User-of-the-Week score was reset to 0. From now on a play only counts after 25 seconds in a game. Keep it fair and have fun! 🎮',
   'warning');
