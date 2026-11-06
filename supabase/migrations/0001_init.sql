-- Confu: schema for PDF-grounded, goal-driven tutoring.
-- Run once in the Supabase SQL editor (or `supabase db push`).
--
-- Model:
--   documents ── document_pages        (per-page text + full-text index = retrieval context)
--       │
--       ├── study_plans ── plan_topics  (goal + deadline -> ordered topics with page ranges & due dates)
--       ├── learner_memory             (rolling model of what the student understands / struggles with)
--       ├── highlights                 (text highlights and region/figure captures with VLM notes)
--       └── messages                   (tutor conversation)
--
-- Every row carries user_id and is protected by RLS: a user can only see their own data.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users, created automatically on sign-up)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------

create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title         text not null,
  storage_path  text not null,                -- '<user_id>/<document_id>.pdf' in the documents bucket
  page_count    int  not null default 0,
  outline       jsonb not null default '[]',  -- [{ "title": text, "page": int, "level": int }]
  status        text not null default 'processing'
                  check (status in ('processing', 'ready', 'failed')),
  last_page     int  not null default 1,      -- resume where the student left off
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index documents_user_idx on public.documents (user_id, created_at desc);

create trigger documents_updated_at before update on public.documents
  for each row execute function public.set_updated_at();

-- One row per PDF page. Pages are the retrieval unit; the generated tsvector
-- powers keyword retrieval so every answer is grounded in the document.
create table public.document_pages (
  document_id  uuid not null references public.documents (id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  page_number  int  not null check (page_number > 0),
  content      text not null default '',
  fts          tsvector generated always as (to_tsvector('english', content)) stored,
  primary key (document_id, page_number)
);

create index document_pages_fts_idx on public.document_pages using gin (fts);

-- ---------------------------------------------------------------------------
-- Study plan: the goal + timeline that keeps the tutor on track
-- ---------------------------------------------------------------------------

create table public.study_plans (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  document_id      uuid not null unique references public.documents (id) on delete cascade,
  goal             text not null,
  level            text not null default 'intermediate'
                     check (level in ('beginner', 'intermediate', 'advanced')),
  start_date       date not null default current_date,
  deadline         date not null,
  minutes_per_day  int  not null default 45 check (minutes_per_day between 5 and 600),
  overview         text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (deadline >= start_date)
);

create trigger study_plans_updated_at before update on public.study_plans
  for each row execute function public.set_updated_at();

create table public.plan_topics (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references public.study_plans (id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  position      int  not null,
  title         text not null,
  objectives    text[] not null default '{}',
  key_concepts  text[] not null default '{}',
  page_start    int  not null,
  page_end      int  not null,
  est_minutes   int  not null default 30,
  due_date      date not null,
  status        text not null default 'not_started'
                  check (status in ('not_started', 'in_progress', 'completed')),
  mastery       real not null default 0 check (mastery between 0 and 1),
  completed_at  timestamptz,
  updated_at    timestamptz not null default now(),
  unique (plan_id, position),
  check (page_end >= page_start)
);

create index plan_topics_plan_idx on public.plan_topics (plan_id, position);

create trigger plan_topics_updated_at before update on public.plan_topics
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Learner memory: what the tutor knows about this student for this document.
-- Updated after every exchange; fed back into every prompt.
-- ---------------------------------------------------------------------------

create table public.learner_memory (
  document_id     uuid primary key references public.documents (id) on delete cascade,
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  summary         text   not null default '',
  understood      text[] not null default '{}',  -- concepts the student has demonstrated
  struggling      text[] not null default '{}',  -- concepts still shaky
  misconceptions  text[] not null default '{}',  -- specific wrong beliefs to correct
  open_questions  text[] not null default '{}',  -- questions raised but not resolved
  explained       text[] not null default '{}',  -- concepts already explained (don't repeat)
  updated_at      timestamptz not null default now()
);

create trigger learner_memory_updated_at before update on public.learner_memory
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Highlights
--   kind = 'text'   : selected text; rects are the selection boxes
--   kind = 'region' : a dragged rectangle (figure/table/equation) captured as an
--                     image, described by a vision model, and kept as context
-- rects are normalised to the page: [{ "x":0..1, "y":0..1, "w":0..1, "h":0..1 }]
-- ---------------------------------------------------------------------------

create table public.highlights (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  document_id      uuid not null references public.documents (id) on delete cascade,
  kind             text not null check (kind in ('text', 'region')),
  page_number      int  not null,
  color            text not null default 'yellow',
  selected_text    text,
  rects            jsonb not null default '[]',
  image_path       text,          -- storage path of the captured region image
  vlm_description  text,          -- vision-model description used as tutor context
  note             text,
  created_at       timestamptz not null default now()
);

create index highlights_doc_idx on public.highlights (document_id, page_number);

-- ---------------------------------------------------------------------------
-- Conversation
-- ---------------------------------------------------------------------------

create table public.messages (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  document_id   uuid not null references public.documents (id) on delete cascade,
  topic_id      uuid references public.plan_topics (id) on delete set null,
  highlight_id  uuid references public.highlights (id) on delete set null,
  role          text not null check (role in ('user', 'assistant')),
  action        text not null default 'chat',  -- chat | ask | summarize | context | simplify | figure | quiz | teach
  content       text not null,
  page_number   int,
  created_at    timestamptz not null default now()
);

create index messages_doc_idx on public.messages (document_id, created_at);

-- ---------------------------------------------------------------------------
-- Retrieval: OR-matched full-text search over a document's pages.
-- plainto_tsquery ANDs terms, which rarely matches a natural-language
-- question, so its '&' operators are swapped for '|'.
-- security invoker => RLS on document_pages still applies.
-- ---------------------------------------------------------------------------

create or replace function public.search_pages(
  p_document_id uuid,
  p_query       text,
  p_limit       int default 4
)
returns table (page_number int, content text, rank real)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select nullif(replace(plainto_tsquery('english', p_query)::text, '&', '|'), '')::tsquery as query
  )
  select p.page_number, p.content, ts_rank_cd(p.fts, q.query) as rank
  from public.document_pages p, q
  where p.document_id = p_document_id
    and q.query is not null
    and p.fts @@ q.query
  order by rank desc
  limit greatest(1, least(p_limit, 12));
$$;

-- First few characters of every page (headings usually sit at the top), used
-- to give the planner a compact map of the whole document.
create or replace function public.page_snippets(
  p_document_id uuid,
  p_chars       int default 160
)
returns table (page_number int, snippet text)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.page_number, left(regexp_replace(p.content, '\s+', ' ', 'g'), greatest(20, least(p_chars, 600)))
  from public.document_pages p
  where p.document_id = p_document_id
  order by p.page_number;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles       enable row level security;
alter table public.documents      enable row level security;
alter table public.document_pages enable row level security;
alter table public.study_plans    enable row level security;
alter table public.plan_topics    enable row level security;
alter table public.learner_memory enable row level security;
alter table public.highlights     enable row level security;
alter table public.messages       enable row level security;

create policy "own profile" on public.profiles
  for all to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

do $$
declare
  t text;
begin
  foreach t in array array[
    'documents', 'document_pages', 'study_plans', 'plan_topics',
    'learner_memory', 'highlights', 'messages'
  ]
  loop
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using ((select auth.uid()) = user_id)
         with check ((select auth.uid()) = user_id)',
      t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage: private bucket, files namespaced by user id
--   documents/<user_id>/<document_id>.pdf
--   documents/<user_id>/highlights/<highlight_id>.jpg
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 52428800, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "read own files" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "upload own files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "update own files" on storage.objects
  for update to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "delete own files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
