-- Optional hardening, not required for App Store review.
--
-- Your SECURITY DEFINER functions run with the owner's privileges but inherit
-- the CALLER's search_path. A caller who creates their own `players` table or
-- `crypt` function in a schema earlier on that path can make a definer function
-- operate on their objects instead of yours — while still running as the owner.
--
-- Pinning the path closes that. `extensions` must be included because Supabase
-- installs pgcrypto there; omitting it is what broke account_delete first time.
--
-- These are ALTERs, so no function body is rewritten and no data is touched.
-- Safe to re-run. Drop any line whose function does not exist on your project.

alter function public.account_auth(text, text, text)
  set search_path = public, extensions, pg_temp;

alter function public.post_score(text, text, text, integer, boolean)
  set search_path = public, extensions, pg_temp;

-- account_delete already has it.
