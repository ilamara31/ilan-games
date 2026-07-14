-- ============================================================================
--  ILAN GAMES — Friends 2.1  (group chats + WhatsApp-style reply)
--
--  RUN ONCE (after friends2-setup.sql): Supabase → SQL Editor → paste → Run.
--  Safe to re-run. The "Potential issue detected" warning is only because of the
--  harmless `drop policy if exists` lines — no tables or data are deleted.
-- ============================================================================

-- 1) GROUPS — a named group with an avatar, owned/admined by its creator
create table if not exists public.ig_group (
  id           bigint generated always as identity primary key,
  name         text not null,
  avatar_emoji text not null default '',
  avatar_url   text not null default '',
  owner_key    text not null,
  owner_name   text not null,
  created_at   timestamptz default now()
);

-- 2) GROUP MEMBERS — who's in each group (+ their last-read time for unread counts)
create table if not exists public.ig_group_member (
  group_id     bigint not null,
  user_key     text not null,
  name         text not null,
  role         text not null default 'member',   -- 'owner' | 'member'
  joined_at    timestamptz default now(),
  last_read_at timestamptz default now(),
  primary key (group_id, user_key)
);
create index if not exists ig_gm_user_idx on public.ig_group_member (user_key);

-- 3) GROUP MESSAGES (with optional reply-to)
create table if not exists public.ig_group_msg (
  id         bigint generated always as identity primary key,
  group_id   bigint not null,
  from_key   text not null,
  from_name  text not null,
  body       text not null,
  reply_to   bigint,
  reply_name text,
  reply_body text,
  created_at timestamptz default now()
);
create index if not exists ig_gmsg_idx on public.ig_group_msg (group_id, created_at);

-- 4) WhatsApp-style reply columns on the 1:1 chat table
alter table public.ig_chat add column if not exists reply_to   bigint;
alter table public.ig_chat add column if not exists reply_name text;
alter table public.ig_chat add column if not exists reply_body text;

-- ---- Row-level security: OPEN (same low-stakes model as the rest of the arcade) ----
alter table public.ig_group        enable row level security;
alter table public.ig_group_member enable row level security;
alter table public.ig_group_msg    enable row level security;

drop policy if exists ig_group_all on public.ig_group;
drop policy if exists ig_gm_all    on public.ig_group_member;
drop policy if exists ig_gmsg_all  on public.ig_group_msg;
create policy ig_group_all on public.ig_group        for all to anon, authenticated using (true) with check (true);
create policy ig_gm_all    on public.ig_group_member for all to anon, authenticated using (true) with check (true);
create policy ig_gmsg_all  on public.ig_group_msg    for all to anon, authenticated using (true) with check (true);

grant all on public.ig_group        to anon, authenticated;
grant all on public.ig_group_member to anon, authenticated;
grant all on public.ig_group_msg    to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- 5) Realtime — instant group messages + membership changes
do $$ begin
  begin alter publication supabase_realtime add table public.ig_group_msg;    exception when others then null; end;
  begin alter publication supabase_realtime add table public.ig_group_member; exception when others then null; end;
end $$;

-- Done. Group chats + reply go live on reload.
