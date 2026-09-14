-- account_name_taken — is a username already taken, ignoring capitalisation?
--
-- The app cannot answer this on its own: RLS correctly hides `players` from the
-- public key, so the client can only see people who already hold a score. An
-- account created but never played is invisible, which is why case-variant names
-- kept slipping through the warning.
--
-- Returns the EXISTING spelling, or null if the name is free. An exact match is
-- returned in preference to a differently-cased one, so the app can tell "you
-- are signing in" from "you are about to create a near-duplicate".
--
-- This reveals whether a username exists — but `account_auth` already does
-- ("wrong" for an existing name vs "created" for a free one), so it exposes
-- nothing new.
--
-- Safe to re-run. Creates one function; deletes nothing.

create or replace function public.account_name_taken(p_name text)
returns text
language sql
stable
security definer
-- extensions must be on the path; Supabase installs pgcrypto there and a pinned
-- path without it is what broke account_delete on its first outing.
set search_path = public, extensions, pg_temp
as $$
  select p.name
    from public.players p
   where lower(p.name) = lower(trim(p_name))
   order by (p.name = trim(p_name)) desc   -- exact match wins
   limit 1;
$$;

grant execute on function public.account_name_taken(text) to anon;
