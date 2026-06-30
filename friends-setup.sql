-- ============================================================================
--  Ilan's Arcade — Friends backend (run ONCE in Supabase → SQL Editor → Run)
--  Creates two tables so friend requests persist and reach players whenever
--  they next come online. Names are public/low-stakes, so policies are open.
-- ============================================================================

create table if not exists public.ig_friend_req (
  from_key   text not null,
  from_name  text not null,
  to_key     text not null,
  to_name    text not null,
  created_at timestamptz default now(),
  primary key (from_key, to_key)
);

create table if not exists public.ig_friend (
  akey       text not null,
  aname      text not null,
  bkey       text not null,
  bname      text not null,
  created_at timestamptz default now(),
  primary key (akey, bkey)
);

alter table public.ig_friend_req enable row level security;
alter table public.ig_friend     enable row level security;

drop policy if exists ig_req_all    on public.ig_friend_req;
drop policy if exists ig_friend_all on public.ig_friend;
create policy ig_req_all    on public.ig_friend_req for all to anon, authenticated using (true) with check (true);
create policy ig_friend_all on public.ig_friend     for all to anon, authenticated using (true) with check (true);

grant all on public.ig_friend_req to anon, authenticated;
grant all on public.ig_friend     to anon, authenticated;

-- Optional but recommended: instant request delivery while a player is online.
-- (Safe to run even if it errors saying "already member".)
do $$ begin
  begin alter publication supabase_realtime add table public.ig_friend_req; exception when others then null; end;
  begin alter publication supabase_realtime add table public.ig_friend;     exception when others then null; end;
end $$;
