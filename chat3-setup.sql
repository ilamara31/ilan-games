-- ============================================================================
--  ILAN GAMES — Chat 3.0  (voice + photo messages)
--
--  RUN ONCE: Supabase → SQL Editor → paste → Run.  Safe to re-run.
--  Voice notes upload as audio/webm (or audio/mp4 on iOS) into the existing
--  "avatars" bucket. If that bucket was created with a MIME whitelist or a size
--  cap, audio uploads get rejected ("records but won't send"). This clears both.
-- ============================================================================

update storage.buckets
   set allowed_mime_types = null,   -- no MIME restriction (was blocking audio/*)
       file_size_limit    = null    -- no per-file size cap
 where id = 'avatars';

-- Make sure the bucket exists + is public (no-op if it already does).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- Done. Voice messages send on reload.
