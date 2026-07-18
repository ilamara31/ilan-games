-- ============================================================================
--  MEME STUDIO — backend (part of ILAN Games)
--
--  RUN ONCE: Supabase → SQL Editor → paste → Run.  Safe to re-run.
--  Stores meme "recipes" (background + caption + effect + audio) — NO video files.
--  Images + voice clips live in the existing public "avatars" storage bucket
--  under the meme/ prefix (already world-readable + writable by anon).
-- ============================================================================

-- 1) MEMES — one row per saved meme scene. `scene` is the full recipe (jsonb).
create table if not exists public.ms_meme (
  id           bigint generated always as identity primary key,
  creator_key  text not null,
  creator_name text not null,
  title        text not null,
  category     text not null default 'random',
  scene        jsonb not null,          -- { bg, cap, fx, audio, dur }
  likes        int  not null default 0,
  views        int  not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists ms_meme_created_idx  on public.ms_meme (created_at desc);
create index if not exists ms_meme_likes_idx     on public.ms_meme (likes desc);
create index if not exists ms_meme_views_idx      on public.ms_meme (views desc);
create index if not exists ms_meme_creator_idx    on public.ms_meme (creator_key);
create index if not exists ms_meme_category_idx    on public.ms_meme (category);

-- 2) LIKES — one row per (meme, user). PK prevents duplicate likes.
create table if not exists public.ms_like (
  meme_id    bigint not null,
  user_key   text  not null,
  created_at timestamptz not null default now(),
  primary key (meme_id, user_key)
);
create index if not exists ms_like_user_idx on public.ms_like (user_key);

-- 3) PROFILES — join date per creator (name/likes/views are derived from ms_meme).
create table if not exists public.ms_profile (
  user_key  text primary key,
  name      text not null,
  joined_at timestamptz not null default now()
);

-- ---- Row-level security: OPEN (same low-stakes model as the rest of the arcade) ----
alter table public.ms_meme    enable row level security;
alter table public.ms_like    enable row level security;
alter table public.ms_profile enable row level security;
drop policy if exists ms_meme_all    on public.ms_meme;
drop policy if exists ms_like_all     on public.ms_like;
drop policy if exists ms_profile_all  on public.ms_profile;
create policy ms_meme_all    on public.ms_meme    for all to anon, authenticated using (true) with check (true);
create policy ms_like_all    on public.ms_like    for all to anon, authenticated using (true) with check (true);
create policy ms_profile_all on public.ms_profile for all to anon, authenticated using (true) with check (true);
grant all on public.ms_meme, public.ms_like, public.ms_profile to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- 4) ATOMIC like TOGGLE (prevents duplicate likes; one like per user). Returns {liked, likes}.
create or replace function public.ms_like_toggle(p_meme bigint, p_user text)
returns json language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  -- toggle: delete-first tells us the prior state; the counter only changes when a
  -- row actually changed, so concurrent toggles can't drift the count (race-safe).
  delete from ms_like where meme_id = p_meme and user_key = p_user;
  if found then
    update ms_meme set likes = greatest(0, likes - 1) where id = p_meme returning likes into v_count;
    return json_build_object('liked', false, 'likes', coalesce(v_count,0));
  else
    insert into ms_like(meme_id, user_key) values (p_meme, p_user) on conflict do nothing;
    if found then
      update ms_meme set likes = likes + 1 where id = p_meme returning likes into v_count;
    else
      select likes into v_count from ms_meme where id = p_meme;   -- lost the race; just report current
    end if;
    return json_build_object('liked', true, 'likes', coalesce(v_count,0));
  end if;
end $$;

-- 5) ATOMIC view increment. Returns the new view count.
create or replace function public.ms_view(p_meme bigint)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  update ms_meme set views = views + 1 where id = p_meme returning views into v_count;
  return coalesce(v_count, 0);
end $$;

grant execute on function public.ms_like_toggle(bigint, text) to anon, authenticated;
grant execute on function public.ms_view(bigint) to anon, authenticated;

-- Done. Meme Studio goes live on reload.
