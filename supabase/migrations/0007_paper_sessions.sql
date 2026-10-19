-- Paper sessions: read research papers with Keshav's three-pass method
-- ("How to Read a Paper", 2007). Each paper gets a target pass (1-3) and
-- structured notes for every pass. Safe to re-run.

alter table public.study_sessions
  add column if not exists kind text not null default 'study' check (kind in ('study', 'paper')),
  add column if not exists research_goal text not null default '';

create table if not exists public.paper_reviews (
  document_id    uuid primary key references public.documents (id) on delete cascade,
  session_id     uuid not null references public.study_sessions (id) on delete cascade,
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  target_pass    int  not null default 1 check (target_pass between 1 and 3),  -- how deep this paper deserves
  passes_done    int  not null default 0 check (passes_done between 0 and 3),  -- passes completed so far
  triage_reason  text not null default '',                                     -- why triage chose the target
  pass1          jsonb not null default '{}',  -- the five Cs
  pass2          jsonb not null default '{}',  -- main idea, evidence, figures, references to read
  pass3          jsonb not null default '{}',  -- re-derivation, assumptions, gaps, weaknesses, ideas
  updated_at     timestamptz not null default now()
);

create index if not exists paper_reviews_session_idx on public.paper_reviews (session_id);

drop trigger if exists paper_reviews_updated_at on public.paper_reviews;
create trigger paper_reviews_updated_at before update on public.paper_reviews
  for each row execute function public.set_updated_at();

alter table public.paper_reviews enable row level security;

drop policy if exists "own rows" on public.paper_reviews;
create policy "own rows" on public.paper_reviews
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and public.owns_session(session_id));

notify pgrst, 'reload schema';
