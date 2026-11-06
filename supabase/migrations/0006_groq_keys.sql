-- Users' own Groq API keys, encrypted by the server (AES-256-GCM) before they
-- reach the database. Plaintext keys are never stored, and the browser only
-- ever sees the last four characters.
--
--   session_id IS NULL  -> the account's default key (used in every session)
--   session_id = <id>   -> an override for one study session
--
-- Safe to re-run.

create table if not exists public.groq_keys (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id  uuid references public.study_sessions (id) on delete cascade,
  ciphertext  text not null,
  iv          text not null,
  auth_tag    text not null,
  last4       text not null check (char_length(last4) = 4),
  created_at  timestamptz not null default now()
);

-- One account key and at most one key per session for each user.
create unique index if not exists groq_keys_account_idx on public.groq_keys (user_id) where session_id is null;
create unique index if not exists groq_keys_session_idx on public.groq_keys (user_id, session_id) where session_id is not null;

alter table public.groq_keys enable row level security;

drop policy if exists "own keys" on public.groq_keys;
create policy "own keys" on public.groq_keys
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (session_id is null or public.owns_session(session_id))
  );

notify pgrst, 'reload schema';
