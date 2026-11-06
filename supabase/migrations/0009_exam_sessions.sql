-- Exam sessions: upload college material, practise exam-style questions,
-- see weak topics. Deliberately simple: no plan, no passes. Safe to re-run.

alter table public.study_sessions
  drop constraint if exists study_sessions_kind_check,
  add constraint study_sessions_kind_check check (kind in ('study', 'paper', 'exam')),
  add column if not exists exam_date date;

-- One row per practice answer; weak topics are computed from these.
create table if not exists public.exam_attempts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id   uuid not null references public.study_sessions (id) on delete cascade,
  document_id  uuid references public.documents (id) on delete set null,
  page_number  int,
  topic        text not null,
  question     text not null,
  kind         text not null check (kind in ('mcq', 'short')),
  score        real not null check (score between 0 and 1),  -- 1 = correct, 0.5 = partly, 0 = wrong
  created_at   timestamptz not null default now()
);

create index if not exists exam_attempts_session_idx on public.exam_attempts (session_id, created_at desc);

alter table public.exam_attempts enable row level security;

drop policy if exists "own rows" on public.exam_attempts;
create policy "own rows" on public.exam_attempts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and public.owns_session(session_id));

notify pgrst, 'reload schema';
