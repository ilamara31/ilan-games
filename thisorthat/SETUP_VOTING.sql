-- ============================================================
-- This or That — REAL crowd voting   (run ONCE in Supabase)
-- Supabase dashboard  →  SQL Editor  →  New query  →  paste  →  Run
-- Safe to re-run; it only creates things if they don't exist.
-- ============================================================

-- 1) table that holds the live vote tally for each question
create table if not exists public.tot_votes (
  qid text primary key,
  a   integer not null default 0,   -- votes for the left option
  b   integer not null default 0    -- votes for the right option
);

-- 2) let anyone READ the tallies (so the % can be shown)
alter table public.tot_votes enable row level security;
drop policy if exists "tot read" on public.tot_votes;
create policy "tot read" on public.tot_votes for select using (true);

-- 3) atomic "cast a vote" function — increments the chosen side and
--    returns the new totals. SECURITY DEFINER lets anonymous players
--    write safely without opening the table up to arbitrary writes.
create or replace function public.tot_vote(p_qid text, p_side text)
returns table(a integer, b integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tot_votes(qid, a, b)
    values (p_qid,
            case when p_side = 'a' then 1 else 0 end,
            case when p_side = 'b' then 1 else 0 end)
  on conflict (qid) do update
    set a = public.tot_votes.a + (case when p_side = 'a' then 1 else 0 end),
        b = public.tot_votes.b + (case when p_side = 'b' then 1 else 0 end);
  return query select t.a, t.b from public.tot_votes t where t.qid = p_qid;
end;
$$;

-- 4) allow players (anonymous + logged in) to call the vote function
grant execute on function public.tot_vote(text, text) to anon, authenticated;
