-- Sessions: one learning goal, many PDFs.
--
--   study_sessions ─┬─ documents (many PDFs, ordered by position)
--                   ├─ study_plans (one per session; topics point at a document)
--                   ├─ learner_memory (one per session)
--                   └─ messages
--
-- Backfill: every existing document becomes its own session with the SAME id,
-- so existing plans, memory, chat and old /doc/<id> links carry over.
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------

create table if not exists public.study_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null default 'Untitled session' check (char_length(title) between 1 and 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists study_sessions_user_idx on public.study_sessions (user_id, updated_at desc);

drop trigger if exists study_sessions_updated_at on public.study_sessions;
create trigger study_sessions_updated_at before update on public.study_sessions
  for each row execute function public.set_updated_at();

alter table public.study_sessions enable row level security;

drop policy if exists "own rows" on public.study_sessions;
create policy "own rows" on public.study_sessions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- True when the signed-in user owns the session. Used so rows can only be
-- attached to your own sessions.
create or replace function public.owns_session(p_session uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.study_sessions s
    where s.id = p_session and s.user_id = (select auth.uid())
  );
$$;

insert into public.study_sessions (id, user_id, title, created_at, updated_at)
select d.id, d.user_id, left(d.title, 200), d.created_at, d.updated_at
from public.documents d
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Documents belong to a session
-- ---------------------------------------------------------------------------

alter table public.documents
  add column if not exists session_id uuid references public.study_sessions (id) on delete cascade,
  add column if not exists position   int  not null default 0;

update public.documents set session_id = id where session_id is null;

alter table public.documents alter column session_id set not null;

create index if not exists documents_session_idx on public.documents (session_id, position);

-- ---------------------------------------------------------------------------
-- Plans move from document to session; topics point at a document
-- ---------------------------------------------------------------------------

alter table public.study_plans
  add column if not exists session_id uuid references public.study_sessions (id) on delete cascade;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'study_plans' and column_name = 'document_id') then
    update public.study_plans p set session_id = d.session_id
    from public.documents d
    where d.id = p.document_id and p.session_id is null;
  end if;
end;
$$;

alter table public.study_plans alter column session_id set not null;
alter table public.study_plans drop column if exists document_id;
alter table public.study_plans
  drop constraint if exists study_plans_session_unique,
  add constraint study_plans_session_unique unique (session_id);

alter table public.plan_topics
  add column if not exists document_id uuid references public.documents (id) on delete set null;

update public.plan_topics t set document_id = d.id
from public.study_plans p
join public.documents d on d.session_id = p.session_id
where p.id = t.plan_id and t.source = 'pdf' and t.document_id is null;

-- ---------------------------------------------------------------------------
-- Memory is per session
-- ---------------------------------------------------------------------------

alter table public.learner_memory
  add column if not exists session_id uuid references public.study_sessions (id) on delete cascade;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'learner_memory' and column_name = 'document_id') then
    update public.learner_memory m set session_id = d.session_id
    from public.documents d
    where d.id = m.document_id and m.session_id is null;
  end if;
end;
$$;

alter table public.learner_memory drop constraint if exists learner_memory_pkey;
alter table public.learner_memory drop column if exists document_id;
alter table public.learner_memory alter column session_id set not null;
alter table public.learner_memory add primary key (session_id);

-- ---------------------------------------------------------------------------
-- Messages are per session; document_id records which PDF was open
-- ---------------------------------------------------------------------------

alter table public.messages
  add column if not exists session_id uuid references public.study_sessions (id) on delete cascade;

update public.messages m set session_id = d.session_id
from public.documents d
where d.id = m.document_id and m.session_id is null;

alter table public.messages alter column session_id set not null;
alter table public.messages alter column document_id drop not null;
alter table public.messages drop constraint if exists messages_document_id_fkey;
alter table public.messages
  add constraint messages_document_id_fkey
  foreign key (document_id) references public.documents (id) on delete set null;

create index if not exists messages_session_idx on public.messages (session_id, created_at);

-- Keep "recently studied" ordering on the dashboard meaningful.
create or replace function public.touch_session()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.study_sessions set updated_at = now() where id = new.session_id;
  return new;
end;
$$;

drop trigger if exists messages_touch_session on public.messages;
create trigger messages_touch_session after insert on public.messages
  for each row execute function public.touch_session();

-- ---------------------------------------------------------------------------
-- Only attach rows to sessions you own
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['documents', 'study_plans', 'learner_memory', 'messages']
  loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using ((select auth.uid()) = user_id)
         with check ((select auth.uid()) = user_id and public.owns_session(session_id))',
      t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retrieval across every PDF in a session
-- ---------------------------------------------------------------------------

create or replace function public.search_session_pages(
  p_session_id uuid,
  p_query      text,
  p_limit      int default 5
)
returns table (document_id uuid, page_number int, content text, rank real)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select nullif(replace(plainto_tsquery('english', p_query)::text, '&', '|'), '')::tsquery as query
  )
  select p.document_id, p.page_number, p.content, ts_rank_cd(p.fts, q.query) as rank
  from public.document_pages p
  join public.documents d on d.id = p.document_id
  cross join q
  where d.session_id = p_session_id
    and q.query is not null
    and p.fts @@ q.query
  order by rank desc
  limit greatest(1, least(p_limit, 12));
$$;

notify pgrst, 'reload schema';
