-- ============================================================================
--  DRAW RUSH — Community Gallery backend
--  RUN ONCE: Supabase -> SQL Editor -> paste -> Run.  Safe to re-run.
--
--  No auth: identity is a per-device key (text), same low-stakes model as the
--  Friends system, so policies are open (anon + authenticated). Drawing images
--  are uploaded to the existing public "avatars" storage bucket under a "dr/"
--  prefix. Like/View counts are maintained by SECURITY DEFINER RPCs so a like
--  is one-per-device and a view can't be refresh-spammed.
-- ============================================================================

-- fast ILIKE search on title / creator name
create extension if not exists pg_trgm;

-- ---- profiles -------------------------------------------------------------
create table if not exists public.dr_profiles (
  user_key   text primary key,
  name       text not null,
  created_at timestamptz default now(),
  hidden     boolean not null default false   -- moderation (future reporting); hidden profiles are filtered client-side
);

-- ---- drawings -------------------------------------------------------------
create table if not exists public.dr_drawings (
  id           bigint generated always as identity primary key,
  user_key     text not null,
  creator_name text not null,
  title        text not null,
  category     text not null default 'random',
  image_url    text,
  strokes      jsonb,                          -- optional vector copy (not required for display)
  likes        int  not null default 0,
  views        int  not null default 0,
  hidden       boolean not null default false, -- moderation flag; hidden drawings are filtered out
  created_at   timestamptz default now()
);
create index if not exists dr_draw_created on public.dr_drawings (created_at desc);
create index if not exists dr_draw_likes   on public.dr_drawings (likes desc);
create index if not exists dr_draw_views   on public.dr_drawings (views desc);
create index if not exists dr_draw_cat     on public.dr_drawings (category);
create index if not exists dr_draw_user    on public.dr_drawings (user_key);
create index if not exists dr_draw_title_trgm on public.dr_drawings using gin (title gin_trgm_ops);
create index if not exists dr_draw_name_trgm  on public.dr_drawings using gin (creator_name gin_trgm_ops);

-- ---- likes (one per device) ----------------------------------------------
create table if not exists public.dr_likes (
  drawing_id bigint not null,
  user_key   text not null,
  created_at timestamptz default now(),
  primary key (drawing_id, user_key)
);
create index if not exists dr_likes_user on public.dr_likes (user_key);

-- ---- views (dedup per device) --------------------------------------------
create table if not exists public.dr_views (
  drawing_id bigint not null,
  user_key   text not null,
  created_at timestamptz default now(),
  primary key (drawing_id, user_key)
);

-- ---- followers ------------------------------------------------------------
create table if not exists public.dr_followers (
  follower_key text not null,
  creator_key  text not null,
  created_at   timestamptz default now(),
  primary key (follower_key, creator_key)
);
create index if not exists dr_foll_creator  on public.dr_followers (creator_key);
create index if not exists dr_foll_follower on public.dr_followers (follower_key);

-- ---- RLS: open (low-stakes, no auth) -------------------------------------
alter table public.dr_profiles  enable row level security;
alter table public.dr_drawings  enable row level security;
alter table public.dr_likes     enable row level security;
alter table public.dr_views     enable row level security;
alter table public.dr_followers enable row level security;

drop policy if exists dr_profiles_all  on public.dr_profiles;
drop policy if exists dr_drawings_all   on public.dr_drawings;
drop policy if exists dr_likes_all      on public.dr_likes;
drop policy if exists dr_views_all      on public.dr_views;
drop policy if exists dr_followers_all  on public.dr_followers;
create policy dr_profiles_all  on public.dr_profiles  for all to anon, authenticated using (true) with check (true);
create policy dr_drawings_all  on public.dr_drawings  for all to anon, authenticated using (true) with check (true);
create policy dr_likes_all     on public.dr_likes     for all to anon, authenticated using (true) with check (true);
create policy dr_views_all     on public.dr_views     for all to anon, authenticated using (true) with check (true);
create policy dr_followers_all on public.dr_followers for all to anon, authenticated using (true) with check (true);

grant all on public.dr_profiles  to anon, authenticated;
grant all on public.dr_drawings  to anon, authenticated;
grant all on public.dr_likes     to anon, authenticated;
grant all on public.dr_views     to anon, authenticated;
grant all on public.dr_followers to anon, authenticated;
-- dr_drawings uses an identity column; anon needs usage on its sequence for inserts
grant usage, select on all sequences in schema public to anon, authenticated;

-- ---- atomic like toggle (one like per device) -----------------------------
create or replace function public.dr_like_toggle(p_drawing bigint, p_user text)
returns json language plpgsql security definer set search_path = public as $$
declare v_count int; v_liked boolean;
begin
  if exists (select 1 from public.dr_likes where drawing_id = p_drawing and user_key = p_user) then
    delete from public.dr_likes where drawing_id = p_drawing and user_key = p_user;
    update public.dr_drawings set likes = greatest(0, likes - 1) where id = p_drawing returning likes into v_count;
    v_liked := false;
  else
    insert into public.dr_likes (drawing_id, user_key) values (p_drawing, p_user) on conflict do nothing;
    update public.dr_drawings set likes = likes + 1 where id = p_drawing returning likes into v_count;
    v_liked := true;
  end if;
  return json_build_object('likes', coalesce(v_count, 0), 'liked', v_liked);
end $$;

-- ---- view counter (dedup per device; no refresh-spam) --------------------
create or replace function public.dr_add_view(p_drawing bigint, p_user text)
returns int language plpgsql security definer set search_path = public as $$
declare v_inserted int; v_count int;
begin
  insert into public.dr_views (drawing_id, user_key) values (p_drawing, p_user) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted > 0 then
    update public.dr_drawings set views = views + 1 where id = p_drawing;
  end if;
  select views into v_count from public.dr_drawings where id = p_drawing;
  return coalesce(v_count, 0);
end $$;

-- ---- profile totals in one round-trip -------------------------------------
create or replace function public.dr_profile_stats(p_user text)
returns json language sql security definer set search_path = public as $$
  select json_build_object(
    'drawings',  (select count(*)                from public.dr_drawings   where user_key = p_user and hidden = false),
    'likes',     (select coalesce(sum(likes),0)  from public.dr_drawings   where user_key = p_user and hidden = false),
    'views',     (select coalesce(sum(views),0)  from public.dr_drawings   where user_key = p_user and hidden = false),
    'followers', (select count(*)                from public.dr_followers  where creator_key = p_user),
    'following', (select count(*)                from public.dr_followers  where follower_key = p_user)
  );
$$;

grant execute on function public.dr_like_toggle(bigint, text)  to anon, authenticated;
grant execute on function public.dr_add_view(bigint, text)     to anon, authenticated;
grant execute on function public.dr_profile_stats(text)        to anon, authenticated;

-- ---- storage: reuse the public "avatars" bucket for drawing PNGs ----------
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;
update storage.buckets set allowed_mime_types = null, file_size_limit = null where id = 'avatars';

-- Ensure anon can READ + WRITE objects in the "avatars" bucket. `public=true` only
-- affects reads; uploads need an INSERT policy on storage.objects. These are ADDITIVE
-- (RLS policies OR together) so they won't restrict anything the Friends system relies on.
-- Wrapped so the script never fails if the SQL editor role can't manage storage.objects
-- (in that case the bucket's existing anon-write policy, already used by voice/photo, applies).
do $$
begin
  begin execute 'create policy dr_avatars_read   on storage.objects for select to anon, authenticated using (bucket_id = ''avatars'')'; exception when others then null; end;
  begin execute 'create policy dr_avatars_write  on storage.objects for insert to anon, authenticated with check (bucket_id = ''avatars'')'; exception when others then null; end;
  begin execute 'create policy dr_avatars_modify on storage.objects for update to anon, authenticated using (bucket_id = ''avatars'') with check (bucket_id = ''avatars'')'; exception when others then null; end;
end $$;

-- Done. Draw Rush → Gallery now persists.
-- NOTE: if saving a drawing ever says "Save failed", open Supabase → Storage → avatars →
-- Policies and allow anon INSERT (this is the only manual step, and only if the block above
-- couldn't create the policy on your project).
