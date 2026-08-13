-- ============================================================
--  ILAN GAMES — FEEDBACK part 3: ANTI-SPAM (max 3 per player)
--  (run ONCE in Supabase → SQL Editor, AFTER feedback2-setup.sql)
-- ============================================================
--  • One player can leave at most 3 feedbacks. Ever.
--  • The limit is enforced on the SERVER, not in the browser —
--    the direct INSERT policy is removed, so the ONLY way in is
--    feedback_submit(), which counts first and refuses #4.
--    Editing the page in devtools can no longer beat it.
--  • Deleting a feedback in feedback.html (admin) gives that
--    player a slot back, which is exactly what we want.
--
--  ORDER MATTERS: deploy the new index.html FIRST, then run this.
--  (This drops the old direct-insert path the old page used.)
-- ============================================================

-- ---------- the one legal way to add feedback ----------
create or replace function public.feedback_submit(
  p_key text, p_name text, p_guest boolean,
  p_game text, p_rating numeric, p_message text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_key    text    := nullif(trim(coalesce(p_key, '')), '');
  v_rating numeric;
  v_used   int;
begin
  if v_key is null then
    return 'bad';
  end if;

  select count(*) into v_used from public.ig_feedback where user_key = v_key;
  if v_used >= 3 then
    return 'limit';
  end if;

  -- clamp to the half-star steps the table allows (0.5 … 5)
  v_rating := round(least(5, greatest(0.5, coalesce(p_rating, 0))) * 2) / 2;

  insert into public.ig_feedback (user_key, user_name, is_guest, game, rating, message)
  values (left(v_key, 60),
          left(coalesce(nullif(trim(coalesce(p_name, '')), ''), 'Guest'), 40),
          coalesce(p_guest, false),
          nullif(trim(coalesce(p_game, '')), ''),
          v_rating,
          left(coalesce(p_message, ''), 2000));

  return 'ok';
end $$;

-- ---------- how many slots are left (for the popup) ----------
create or replace function public.feedback_used(p_key text)
returns int
language sql security definer set search_path = public as $$
  select count(*)::int from public.ig_feedback
  where user_key = nullif(trim(coalesce(p_key, '')), '')
$$;

-- ---------- close the old unlimited door ----------
drop policy if exists ig_feedback_insert on public.ig_feedback;
revoke insert on public.ig_feedback from anon, authenticated;

grant execute on function public.feedback_submit(text, text, boolean, text, numeric, text) to anon, authenticated;
grant execute on function public.feedback_used(text) to anon, authenticated;
