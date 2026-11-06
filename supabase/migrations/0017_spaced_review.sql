-- Spaced review: what a student has learned comes back on a schedule
-- (1, 3, 7, 16, 35, 80 days), sooner when they get it wrong. Safe to re-run.
--
-- Items are created automatically:
--   topic          a plan topic marked done       (trigger on plan_topics)
--   highlight      a passage saved with Highlight  (trigger on highlights)
--   asked          a passage the student asked about (inserted by the chat route,
--                  with their question and the tutor's explanation)
--   misconception  a wrong belief the tutor noted  (trigger on learner_memory)
--   mistake        an exam-prep question missed    (inserted by the app, with its model answer)

create table if not exists public.review_items (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id        uuid not null references public.study_sessions (id) on delete cascade,
  document_id       uuid references public.documents (id) on delete set null,
  page_number       int,
  source            text not null,
  source_key        text not null,              -- one item per source thing
  prompt            text not null,              -- the cue: topic title, passage, belief or question
  question          text not null default '',   -- what the student asked about it (asked items)
  answer            text not null default '',   -- what to compare against, shown after answering
  step              int  not null default 0,    -- successful reviews in a row
  due_at            timestamptz not null default now() + interval '1 day',
  last_reviewed_at  timestamptz,
  reviews           int  not null default 0,
  lapses            int  not null default 0,
  suspended         boolean not null default false,
  created_at        timestamptz not null default now(),
  unique (user_id, source, source_key)
);

-- Added after the first version of this file: safe whether or not it ran before.
alter table public.review_items add column if not exists question text not null default '';
alter table public.review_items drop constraint if exists review_items_source_check;
alter table public.review_items add constraint review_items_source_check
  check (source in ('topic', 'highlight', 'asked', 'misconception', 'mistake'));

create index if not exists review_items_due_idx on public.review_items (user_id, due_at) where not suspended;

alter table public.review_items enable row level security;

drop policy if exists "own rows" on public.review_items;
create policy "own rows" on public.review_items
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and public.owns_session(session_id));

-- Days until the next review after `step` successful reviews in a row.
create or replace function public.review_interval_days(step int)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
    when step <= 0 then 1
    when step = 1 then 3
    when step = 2 then 7
    when step = 3 then 16
    when step = 4 then 35
    when step = 5 then 80
    else least(365, 80 * power(2, step - 5)::int)
  end;
$$;

-- Record a review. rating: 'again' (missed), 'hard' (shaky), 'good' (got it).
-- Returns when the item is next due.
create or replace function public.review_answer(p_item uuid, p_rating text)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cur int;
  nxt timestamptz;
begin
  if p_rating not in ('again', 'hard', 'good') then
    raise exception 'rating must be again, hard or good';
  end if;
  select step into cur from public.review_items where id = p_item and user_id = (select auth.uid()) for update;
  if not found then
    raise exception 'review item not found';
  end if;
  if p_rating = 'good' then
    cur := cur + 1;
    nxt := now() + make_interval(days => public.review_interval_days(cur));
  elsif p_rating = 'hard' then
    nxt := now() + make_interval(days => greatest(1, public.review_interval_days(cur) / 2));
  else
    cur := 0;
    nxt := now() + interval '1 day';
  end if;
  update public.review_items
     set step = cur,
         due_at = nxt,
         last_reviewed_at = now(),
         reviews = reviews + 1,
         lapses = lapses + (p_rating = 'again')::int
   where id = p_item;
  return nxt;
end;
$$;

revoke all on function public.review_answer(uuid, text) from public;
grant execute on function public.review_answer(uuid, text) to authenticated;

-- A topic marked done.
create or replace function public.review_from_topic()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sess uuid;
begin
  if new.status <> 'completed' or (tg_op = 'UPDATE' and old.status = 'completed') then
    return new;
  end if;
  select session_id into sess from public.study_plans where id = new.plan_id;
  if sess is null then
    return new;
  end if;
  insert into public.review_items (user_id, session_id, document_id, page_number, source, source_key, prompt, answer)
  values (
    new.user_id, sess, new.document_id, new.page_start, 'topic', new.id::text, new.title,
    trim(both from
      coalesce((select string_agg('- ' || o, E'\n') from unnest(new.objectives) o), '')
      || case when cardinality(new.key_concepts) > 0 then E'\n\nKey ideas: ' || array_to_string(new.key_concepts, ', ') else '' end)
  )
  on conflict (user_id, source, source_key) do update set suspended = false;
  return new;
end;
$$;

drop trigger if exists review_from_topic on public.plan_topics;
create trigger review_from_topic after insert or update of status on public.plan_topics
  for each row execute function public.review_from_topic();

-- A passage saved with Highlight (long enough to be worth recalling).
create or replace function public.review_from_highlight()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sess uuid;
  txt text := trim(both from coalesce(new.selected_text, ''));
begin
  if new.kind <> 'text' or length(txt) < 25 then
    return new;
  end if;
  select session_id into sess from public.documents where id = new.document_id;
  if sess is null then
    return new;
  end if;
  insert into public.review_items (user_id, session_id, document_id, page_number, source, source_key, prompt)
  values (new.user_id, sess, new.document_id, new.page_number, 'highlight', new.id::text, left(txt, 900))
  on conflict (user_id, source, source_key) do nothing;
  return new;
end;
$$;

drop trigger if exists review_from_highlight on public.highlights;
create trigger review_from_highlight after insert on public.highlights
  for each row execute function public.review_from_highlight();

-- New misconceptions the tutor recorded in learner memory (one row per session).
create or replace function public.review_from_memory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m text;
begin
  foreach m in array new.misconceptions loop
    if (tg_op = 'INSERT' or not (m = any (old.misconceptions))) and length(trim(both from m)) >= 8 then
      insert into public.review_items (user_id, session_id, source, source_key, prompt)
      values (new.user_id, new.session_id, 'misconception', md5(new.session_id::text || lower(trim(both from m))), left(trim(both from m), 600))
      on conflict (user_id, source, source_key) do nothing;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists review_from_memory on public.learner_memory;
create trigger review_from_memory after insert or update of misconceptions on public.learner_memory
  for each row execute function public.review_from_memory();

-- Topics already finished before this migration start their schedule now.
insert into public.review_items (user_id, session_id, document_id, page_number, source, source_key, prompt, answer)
select t.user_id, p.session_id, t.document_id, t.page_start, 'topic', t.id::text, t.title,
       coalesce((select string_agg('- ' || o, E'\n') from unnest(t.objectives) o), '')
from public.plan_topics t
join public.study_plans p on p.id = t.plan_id
where t.status = 'completed'
on conflict (user_id, source, source_key) do nothing;

notify pgrst, 'reload schema';
