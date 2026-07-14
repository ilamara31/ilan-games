-- ============================================================================
--  ILAN GAMES — Friends 2.0 backend  (profiles · requests · friendships · chat · avatars)
--
--  RUN ONCE:  Supabase Dashboard → SQL Editor → New query → paste ALL of this → Run.
--  Safe to re-run (everything is "if not exists" / "on conflict do nothing").
--  This is the ONLY manual step — after it runs, Friends/Profiles/Chat all go live.
-- ============================================================================

-- 1) PROFILES — one per player (keyed by the same lowercase name-key the arcade uses)
create table if not exists public.ig_profile (
  user_key     text primary key,
  name         text not null,
  bio          text    not null default '',
  avatar_emoji text    not null default '',   -- emoji avatar, if the player picked one
  avatar_url   text    not null default '',   -- uploaded image URL, if they uploaded one
  chat_strikes int     not null default 0,    -- moderation strikes (bad words sent)
  chat_muted   boolean not null default false,-- chat disabled after too many strikes
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- 2) FRIEND REQUESTS — persist so a request reaches the other player whenever they next come online
create table if not exists public.ig_friend_req (
  from_key   text not null,
  from_name  text not null,
  to_key     text not null,
  to_name    text not null,
  created_at timestamptz default now(),
  primary key (from_key, to_key)
);

-- 3) FRIENDSHIPS — stored both directions so each side can list its own friends
create table if not exists public.ig_friend (
  akey       text not null,
  aname      text not null,
  bkey       text not null,
  bname      text not null,
  created_at timestamptz default now(),
  primary key (akey, bkey)
);

-- 4) CHAT — one row per message between two friends
create table if not exists public.ig_chat (
  id         bigint generated always as identity primary key,
  pair_key   text not null,               -- sorted "keyA__keyB" so both sides query the same thread
  from_key   text not null,
  from_name  text not null,
  to_key     text not null,
  body       text not null,
  created_at timestamptz default now(),
  read_at    timestamptz                  -- null = the recipient hasn't read it yet (drives the bell badge)
);
create index if not exists ig_chat_pair_idx  on public.ig_chat (pair_key, created_at);
create index if not exists ig_chat_inbox_idx on public.ig_chat (to_key, read_at);

-- ---- Row-level security: OPEN (usernames are public / low-stakes, like the rest of the arcade) ----
alter table public.ig_profile    enable row level security;
alter table public.ig_friend_req enable row level security;
alter table public.ig_friend     enable row level security;
alter table public.ig_chat       enable row level security;

drop policy if exists ig_profile_all on public.ig_profile;
drop policy if exists ig_req_all     on public.ig_friend_req;
drop policy if exists ig_friend_all  on public.ig_friend;
drop policy if exists ig_chat_all    on public.ig_chat;
create policy ig_profile_all on public.ig_profile    for all to anon, authenticated using (true) with check (true);
create policy ig_req_all     on public.ig_friend_req for all to anon, authenticated using (true) with check (true);
create policy ig_friend_all  on public.ig_friend     for all to anon, authenticated using (true) with check (true);
create policy ig_chat_all    on public.ig_chat       for all to anon, authenticated using (true) with check (true);

grant all on public.ig_profile    to anon, authenticated;
grant all on public.ig_friend_req to anon, authenticated;
grant all on public.ig_friend     to anon, authenticated;
grant all on public.ig_chat       to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- 5) Atomic moderation strike counter — bumps strikes, mutes chat once the limit is hit
create or replace function public.ig_chat_strike(p_key text, p_name text, p_add int, p_limit int)
returns json language plpgsql security definer set search_path = public as $$
declare s int; m boolean;
begin
  insert into public.ig_profile(user_key, name, chat_strikes)
  values (p_key, p_name, greatest(p_add, 0))
  on conflict (user_key) do update
    set chat_strikes = public.ig_profile.chat_strikes + greatest(p_add, 0),
        name = excluded.name,
        updated_at = now()
  returning chat_strikes into s;
  m := s >= p_limit;
  if m then update public.ig_profile set chat_muted = true where user_key = p_key; end if;
  return json_build_object('strikes', s, 'muted', m);
end $$;
grant execute on function public.ig_chat_strike(text, text, int, int) to anon, authenticated;

-- 6) Realtime delivery — instant requests + chat while a player is online
do $$ begin
  begin alter publication supabase_realtime add table public.ig_friend_req; exception when others then null; end;
  begin alter publication supabase_realtime add table public.ig_friend;     exception when others then null; end;
  begin alter publication supabase_realtime add table public.ig_chat;       exception when others then null; end;
  begin alter publication supabase_realtime add table public.ig_profile;    exception when others then null; end;
end $$;

-- 7) Avatar image uploads — a public storage bucket + permissive policies (browser upload)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists ig_avatars_read   on storage.objects;
drop policy if exists ig_avatars_write  on storage.objects;
drop policy if exists ig_avatars_update on storage.objects;
create policy ig_avatars_read   on storage.objects for select to anon, authenticated using (bucket_id = 'avatars');
create policy ig_avatars_write  on storage.objects for insert to anon, authenticated with check (bucket_id = 'avatars');
create policy ig_avatars_update on storage.objects for update to anon, authenticated using (bucket_id = 'avatars') with check (bucket_id = 'avatars');

-- Done. Reload the arcade — Friends, Profiles, Chat, the bell and search are all live.
