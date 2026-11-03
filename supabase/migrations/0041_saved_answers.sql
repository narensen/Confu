-- Tutor answers the student keeps. They show under Highlights, and every
-- question in the session sends them to the tutor, so they stay in play for
-- the whole session.
--
-- A copy, not a link to the message: clearing the chat removes the words of
-- the conversation (the message rows keep only their dates, so study days
-- stay on the streak), and a saved answer must outlive that.

create table if not exists public.saved_answers (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id   uuid not null references public.study_sessions (id) on delete cascade,
  question     text check (question is null or char_length(question) <= 2000),
  answer       text not null check (char_length(answer) between 1 and 12000),
  page_number  int,
  document_id  uuid references public.documents (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists saved_answers_session_idx on public.saved_answers (session_id, created_at);

alter table public.saved_answers enable row level security;

drop policy if exists "read own saved answers" on public.saved_answers;
create policy "read own saved answers" on public.saved_answers
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "save to own session" on public.saved_answers;
create policy "save to own session" on public.saved_answers
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.study_sessions s
      where s.id = session_id and s.user_id = (select auth.uid())
    )
  );

drop policy if exists "remove own saved answers" on public.saved_answers;
create policy "remove own saved answers" on public.saved_answers
  for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.saved_answers from anon;
revoke insert, update, delete on public.saved_answers from authenticated;
grant select, delete on public.saved_answers to authenticated;
grant insert (session_id, question, answer, page_number, document_id) on public.saved_answers to authenticated;
