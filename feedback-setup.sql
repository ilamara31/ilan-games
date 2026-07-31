-- ============================================================
--  ILAN GAMES — FEEDBACK   (run ONCE in Supabase → SQL Editor)
-- ============================================================
--  • Players tap the 💬 Feedback button on the home page and send
--    a star rating (half stars allowed: 0.5, 1, 1.5 … 5) plus an
--    optional message, optionally about one specific game.
--  • Anyone can INSERT feedback, but there is NO select policy —
--    the public/anon key CANNOT read what other players wrote.
--  • Only the owner can read or delete: the two functions below
--    check the real account password via account_auth() and only
--    answer for the account named "ilan". feedback.html uses them.
-- ============================================================

create table if not exists public.ig_feedback (
  id         bigint generated always as identity primary key,
  user_key   text not null default 'guest',
  user_name  text not null default 'Guest',
  is_guest   boolean not null default false,
  game       text,                          -- which game it is about (null = whole website)
  rating     numeric(2,1) not null
             check (rating >= 0.5 and rating <= 5 and (rating * 2) = round(rating * 2)),
  message    text not null default '' check (char_length(message) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists ig_feedback_created_idx on public.ig_feedback (created_at desc);

alter table public.ig_feedback enable row level security;

-- players can only ADD feedback…
drop policy if exists ig_feedback_insert on public.ig_feedback;
create policy ig_feedback_insert on public.ig_feedback
  for insert to anon, authenticated with check (true);
-- …and there is intentionally NO select/update/delete policy.

grant insert on public.ig_feedback to anon, authenticated;

-- ---------- owner-only reading ----------
create or replace function public.feedback_admin_list(p_name text, p_password text)
returns setof public.ig_feedback
language plpgsql security definer set search_path = public as $$
begin
  if lower(trim(coalesce(p_name,''))) <> 'ilan'
     or public.account_auth(p_name, p_password, null) <> 'ok' then
    raise exception 'not allowed';
  end if;
  return query select * from public.ig_feedback order by created_at desc;
end $$;

-- ---------- owner-only delete ----------
create or replace function public.feedback_admin_delete(p_name text, p_password text, p_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if lower(trim(coalesce(p_name,''))) <> 'ilan'
     or public.account_auth(p_name, p_password, null) <> 'ok' then
    raise exception 'not allowed';
  end if;
  delete from public.ig_feedback where id = p_id;
end $$;

grant execute on function public.feedback_admin_list(text, text) to anon, authenticated;
grant execute on function public.feedback_admin_delete(text, text, bigint) to anon, authenticated;
