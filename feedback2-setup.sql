-- ============================================================
--  ILAN GAMES — FEEDBACK part 2: REPLIES + REACTIONS
--  (run ONCE in Supabase → SQL Editor, AFTER feedback-setup.sql)
-- ============================================================
--  • The owner can reply to a feedback and/or react to it
--    (👍 ❤️ 👏 🔥 🎉) from feedback.html — both go through an
--    owner-only function that checks the real account password.
--  • Players see the reply/reaction on their OWN feedback only,
--    inside the 💬 Feedback popup ("My feedback"), via
--    feedback_my() which filters by their user_key.
-- ============================================================

alter table public.ig_feedback add column if not exists reply    text;
alter table public.ig_feedback add column if not exists reply_at timestamptz;
alter table public.ig_feedback add column if not exists reaction text;

-- ---------- owner-only reply / reaction ----------
create or replace function public.feedback_admin_respond(
  p_name text, p_password text, p_id bigint, p_reply text, p_reaction text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if lower(trim(coalesce(p_name,''))) <> 'ilan'
     or public.account_auth(p_name, p_password, null) <> 'ok' then
    raise exception 'not allowed';
  end if;
  update public.ig_feedback set
    reply    = nullif(trim(left(coalesce(p_reply,''), 2000)), ''),
    reply_at = case when nullif(trim(coalesce(p_reply,'')), '') is null then null
                    else coalesce(reply_at, now()) end,
    reaction = nullif(trim(left(coalesce(p_reaction,''), 16)), '')
  where id = p_id;
end $$;

-- ---------- players read replies on their own feedback ----------
create or replace function public.feedback_my(p_key text)
returns table(id bigint, game text, rating numeric, message text,
              reply text, reply_at timestamptz, reaction text, created_at timestamptz)
language sql security definer set search_path = public as $$
  select id, game, rating, message, reply, reply_at, reaction, created_at
  from public.ig_feedback
  where user_key = p_key
  order by created_at desc
  limit 20
$$;

grant execute on function public.feedback_admin_respond(text, text, bigint, text, text) to anon, authenticated;
grant execute on function public.feedback_my(text) to anon, authenticated;
