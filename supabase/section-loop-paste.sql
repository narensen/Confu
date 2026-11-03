-- Confu section loop. Paste this whole file into the Supabase SQL editor and run it once.
-- Order is 0028, then 0029 through 0037. Each block is idempotent.
-- This file is not a migration. The numbered files in supabase/migrations stay the source.
-- 0023 (pro_until) and 0024 (packs, pack_copies) are not in this repo. If those are still
-- missing, class-rep Pro and pack copy stay dark. These blocks no-op or raise a clear
-- error inside the function when a pack table is missing. They do not invent 0023 or 0024.


-- =============================================================================
-- supabase/migrations/0028_study_loop.sql
-- =============================================================================

-- Course links, class-rep Pro, timed-paper cards, shared page pins,
-- and explain-back scores. Safe to re-run.
--
-- Does not create packs (0024) or pro_until (0023). Course codes and the
-- class-rep grant wait until packs exist. Pins, sittings and explain-back
-- scores do not need packs.
--
-- A course link (/c/<code>) only looks up a pack. Reading the plan is not an
-- AI call. An account still starts when someone copies, highlights or asks.
--
-- A sitting card stores the score, the time, weak topics and an optional
-- reading. Not the questions or the answers.
--
-- A page pin can be seen by a classmate only when both of you share progress
-- on the same pack, and only the passage, the question and one stored answer.
-- Not a tutor thread.
--
-- Explain-back stores the score and the gap. There is no column for audio
-- or for what was said.

-- ---------------------------------------------------------------------------
-- Timed paper cards
-- ---------------------------------------------------------------------------

create table if not exists public.sitting_shares (
  token        text primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  session_id   uuid not null,
  title        text not null,
  score        numeric not null,
  out_of       int not null,
  minutes      int not null,
  topics       text[] not null default '{}',
  band         text,
  display_name text,
  created_at   timestamptz not null default now(),
  constraint sitting_shares_token check (token ~ '^[0-9a-f]{32}$'),
  constraint sitting_shares_range check (out_of between 1 and 10 and score >= 0 and score <= out_of and minutes between 0 and 180)
);

alter table public.sitting_shares enable row level security;
revoke all on public.sitting_shares from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Page pins. Answered once: the answer column is written a single time.
-- ---------------------------------------------------------------------------

create table if not exists public.page_pins (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  session_id   uuid not null,
  document_id  uuid not null,
  page_number  int not null,
  quote        text not null default '',
  question     text not null default '',
  answer       text,
  pack_slug    text,
  doc_index    int,
  created_at   timestamptz not null default now(),
  constraint page_pins_page check (page_number between 1 and 5000),
  constraint page_pins_text check (char_length(quote) <= 500 and char_length(question) <= 300 and (answer is null or char_length(answer) <= 2000)),
  constraint page_pins_has check (char_length(btrim(quote)) > 0 or char_length(btrim(question)) > 0)
);

create index if not exists page_pins_doc_idx on public.page_pins (document_id, page_number);
create index if not exists page_pins_pack_idx on public.page_pins (pack_slug, doc_index, page_number) where pack_slug is not null;

alter table public.page_pins enable row level security;
revoke all on public.page_pins from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Explain-back: score and gap only. Own rows, like review items.
-- ---------------------------------------------------------------------------

create table if not exists public.explain_backs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id   uuid not null,
  document_id  uuid,
  page_number  int,
  topic        text not null default '',
  score        numeric not null,
  gap          text not null,
  created_at   timestamptz not null default now(),
  constraint explain_backs_score check (score in (0, 0.5, 1)),
  constraint explain_backs_gap check (char_length(gap) between 1 and 500),
  constraint explain_backs_topic check (char_length(topic) <= 200)
);

create index if not exists explain_backs_user_idx on public.explain_backs (user_id, created_at desc);

alter table public.explain_backs enable row level security;

drop policy if exists "own rows" on public.explain_backs;
create policy "own rows" on public.explain_backs
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and public.owns_session(session_id));

-- ---------------------------------------------------------------------------
-- Course code on a pack, when packs exist. Late 0024 still works: the
-- functions below add the columns if packs shows up after this file.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.packs') is not null then
    alter table public.packs add column if not exists course_code text;
    alter table public.packs add column if not exists class_rep_granted boolean not null default false;
    create unique index if not exists packs_course_code_idx on public.packs (course_code) where course_code is not null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers (not granted)
-- ---------------------------------------------------------------------------

-- True when this copied session shares progress with the pack's author.
-- False when pack_copies isn't there, or doesn't have the columns the app uses.
create or replace function public._pin_shares(p_session uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ok boolean;
begin
  if to_regclass('public.pack_copies') is null then
    return false;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pack_copies' and column_name = 'share_progress'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pack_copies' and column_name = 'session_id'
  ) then
    return false;
  end if;
  execute 'select coalesce(bool_or(share_progress), false) from public.pack_copies where session_id = $1'
    into ok using p_session;
  return coalesce(ok, false);
exception
  when undefined_table or undefined_column then
    return false;
end;
$$;

-- The pack this session was copied from, if my_pack_copy (0024) exists.
create or replace function public._session_pack_slug(p_session uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text;
begin
  if to_regprocedure('public.my_pack_copy(uuid)') is null then
    return null;
  end if;
  select t.slug into v from public.my_pack_copy(p_session) as t limit 1;
  return nullif(v, '');
exception
  when undefined_function or undefined_column or undefined_table then
    return null;
end;
$$;

create or replace function public._ensure_pack_columns()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if to_regclass('public.packs') is null then
    return;
  end if;
  execute 'alter table public.packs add column if not exists course_code text';
  execute 'alter table public.packs add column if not exists class_rep_granted boolean not null default false';
  execute 'create unique index if not exists packs_course_code_idx on public.packs (course_code) where course_code is not null';
exception
  when undefined_table or insufficient_privilege then
    return;
end;
$$;

-- ---------------------------------------------------------------------------
-- Course links
-- ---------------------------------------------------------------------------

create or replace function public.course_of(p_slug text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text;
begin
  if to_regclass('public.packs') is null or p_slug is null or char_length(p_slug) > 120 then
    return null;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'packs' and column_name = 'course_code'
  ) then
    return null;
  end if;
  execute 'select course_code from public.packs where slug = $1' into v using p_slug;
  return v;
exception
  when undefined_table or undefined_column then
    return null;
end;
$$;

create or replace function public.course_of_session(p_session uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text;
begin
  if to_regclass('public.packs') is null or (select auth.uid()) is null then
    return null;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'packs' and column_name = 'course_code'
  ) then
    return null;
  end if;
  execute $q$
    select k.course_code
    from public.packs k
    join public.study_sessions s on s.id = k.session_id
    where k.session_id = $1 and s.user_id = $2
  $q$ into v using p_session, (select auth.uid());
  return v;
exception
  when undefined_table or undefined_column then
    return null;
end;
$$;

-- Anyone with the code, signed in or not. Returns the pack slug, or null.
create or replace function public.lookup_course(p_code text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text;
  code text := lower(regexp_replace(coalesce(p_code, ''), '[^a-z0-9]', '', 'g'));
begin
  if to_regclass('public.packs') is null or code !~ '^[a-z0-9]{4,10}$' then
    return null;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'packs' and column_name = 'course_code'
  ) then
    return null;
  end if;
  execute 'select slug from public.packs where course_code = $1' into v using code;
  return v;
exception
  when undefined_table or undefined_column then
    return null;
end;
$$;

-- Empty code: Confu picks one. The caller must own the session, and a pack
-- must already be published.
create or replace function public.set_course_code(p_session uuid, p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  wanted text := lower(regexp_replace(coalesce(p_code, ''), '[^a-z0-9]', '', 'g'));
  chosen text;
  n int;
  i int;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  if not exists (select 1 from public.study_sessions s where s.id = p_session and s.user_id = me) then
    raise exception 'That session isn''t yours.';
  end if;
  perform public._ensure_pack_columns();
  if to_regclass('public.packs') is null then
    raise exception 'Study packs need migration 0024 to be run.';
  end if;
  if wanted <> '' and wanted !~ '^[a-z0-9]{4,10}$' then
    raise exception 'Use 4 to 10 letters or numbers.';
  end if;
  for i in 1..5 loop
    chosen := case when wanted <> '' then wanted else substr(md5(gen_random_uuid()::text), 1, 6) end;
    begin
      execute 'update public.packs set course_code = $1 where session_id = $2' using chosen, p_session;
      get diagnostics n = row_count;
      if n = 0 then
        raise exception 'Publish the pack first.';
      end if;
      return chosen;
    exception
      when unique_violation then
        if wanted <> '' then
          raise exception 'That course link is taken. Try another.';
        end if;
    end;
  end loop;
  raise exception 'Couldn''t make a course link. Try again.';
end;
$$;

-- Once 30 people have copied a class pack, the author's Pro runs 120 days
-- from the later of now and whatever Pro they already have. Once only.
-- No-op when packs or pro_until aren't there.
create or replace function public.grant_class_rep(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  owner uuid;
  copies int := 0;
  extra int := 0;
  class_mode boolean := false;
  already boolean := false;
  has_pro boolean;
begin
  if me is null or p_slug is null or to_regclass('public.packs') is null then
    return jsonb_build_object('granted', false);
  end if;
  perform public._ensure_pack_columns();
  execute $q$
    select s.user_id, k.copies, k.class_mode, coalesce(k.class_rep_granted, false)
    from public.packs k
    join public.study_sessions s on s.id = k.session_id
    where k.slug = $1
  $q$ into owner, copies, class_mode, already;
  if owner is null or not class_mode or already then
    return jsonb_build_object('granted', false);
  end if;
  if to_regclass('public.pack_copies') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'pack_copies' and column_name = 'pack_id'
     ) then
    execute 'select count(*) from public.pack_copies c join public.packs k on k.id = c.pack_id where k.slug = $1'
      into extra using p_slug;
  end if;
  if greatest(coalesce(copies, 0), coalesce(extra, 0)) < 30 then
    return jsonb_build_object('granted', false);
  end if;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'pro_until'
  ) into has_pro;
  if not has_pro then
    return jsonb_build_object('granted', false);
  end if;
  execute $u$
    update public.profiles
    set pro_until = greatest(coalesce(pro_until, now()), now()) + interval '120 days'
    where id = $1
  $u$ using owner;
  execute 'update public.packs set class_rep_granted = true where slug = $1 and class_rep_granted = false' using p_slug;
  return jsonb_build_object('granted', true);
exception
  when undefined_table or undefined_column then
    return jsonb_build_object('granted', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Sittings
-- ---------------------------------------------------------------------------

create or replace function public.save_sitting(
  p_session uuid,
  p_score numeric,
  p_out_of int,
  p_minutes int,
  p_topics text[],
  p_show_name boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_title text;
  v_exam date;
  v_days int;
  v_pct numeric;
  v_band text;
  v_name text;
  v_topics text[];
  v_token text;
  v_minutes int := least(180, greatest(0, coalesce(p_minutes, 0)));
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  if p_out_of is null or p_out_of < 1 or p_out_of > 10 or p_score is null or p_score < 0 or p_score > p_out_of then
    raise exception 'That score doesn''t fit the paper.';
  end if;
  select left(s.title, 200), s.exam_date into v_title, v_exam
  from public.study_sessions s
  where s.id = p_session and s.user_id = me;
  if v_title is null then
    raise exception 'That session isn''t yours.';
  end if;
  if v_exam is not null then
    v_days := v_exam - current_date;
  end if;
  v_pct := p_score / p_out_of;
  if v_days between 7 and 14 then
    v_band := case
      when v_pct >= 0.85 then 'About ten days out, this sitting reads like a top band. Keep the misses fresh.'
      when v_pct >= 0.7 then 'About ten days out, this sitting reads close to a top band. The misses are what would move it.'
      when v_pct >= 0.5 then 'About ten days out, this sitting reads around the middle. The misses are the gap.'
      else 'About ten days out, this sitting reads short of the middle. The misses are where those days go.'
    end;
  end if;
  select coalesce(array_agg(x), '{}') into v_topics from (
    select left(btrim(t), 80) as x
    from unnest(coalesce(p_topics, array[]::text[])) as t
    where btrim(t) <> ''
    limit 8
  ) s;
  if coalesce(p_show_name, false) then
    select nullif(split_part(btrim(coalesce(full_name, '')), ' ', 1), '') into v_name
    from public.profiles where id = me;
  end if;
  v_token := md5(gen_random_uuid()::text || clock_timestamp()::text);
  insert into public.sitting_shares (token, user_id, session_id, title, score, out_of, minutes, topics, band, display_name)
  values (v_token, me, p_session, v_title, p_score, p_out_of, v_minutes, v_topics, v_band, v_name);
  return v_token;
end;
$$;

create or replace function public.get_sitting(p_token text)
returns table (
  title text,
  score numeric,
  out_of int,
  minutes int,
  topics text[],
  band text,
  display_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.title, s.score, s.out_of, s.minutes, s.topics, s.band, s.display_name
  from public.sitting_shares s
  where s.token = p_token and p_token ~ '^[0-9a-f]{32}$';
$$;

-- ---------------------------------------------------------------------------
-- Pins
-- ---------------------------------------------------------------------------

create or replace function public.list_page_pins(p_session uuid, p_document uuid)
returns table (
  id uuid,
  page_number int,
  quote text,
  question text,
  answer text,
  mine boolean,
  author_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_slug text;
  v_idx int;
begin
  if me is null then
    return;
  end if;
  if not exists (
    select 1 from public.documents d
    join public.study_sessions s on s.id = d.session_id
    where d.id = p_document and d.session_id = p_session and s.user_id = me
  ) then
    return;
  end if;
  return query
    select p.id, p.page_number, p.quote, p.question, p.answer, true, 'You'::text
    from public.page_pins p
    where p.user_id = me and p.document_id = p_document and p.session_id = p_session
    order by p.page_number, p.created_at
    limit 40;

  v_slug := public._session_pack_slug(p_session);
  select d.position into v_idx from public.documents d where d.id = p_document;
  if v_slug is null or v_idx is null or not public._pin_shares(p_session) then
    return;
  end if;
  return query
    select p.id, p.page_number, p.quote, p.question, p.answer, false,
      coalesce(nullif(split_part(btrim(coalesce(pr.full_name, '')), ' ', 1), ''), 'Someone')
    from public.page_pins p
    left join public.profiles pr on pr.id = p.user_id
    where p.pack_slug = v_slug
      and p.doc_index = v_idx
      and p.user_id <> me
      and public._pin_shares(p.session_id)
    order by p.page_number, p.created_at
    limit 40;
end;
$$;

create or replace function public.save_page_pin(
  p_session uuid,
  p_document uuid,
  p_page int,
  p_quote text,
  p_question text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_quote text := left(btrim(coalesce(p_quote, '')), 500);
  v_question text := left(btrim(coalesce(p_question, '')), 300);
  v_slug text;
  v_idx int;
  v_answer text;
  v_id uuid;
  n int;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  if not exists (
    select 1 from public.documents d
    join public.study_sessions s on s.id = d.session_id
    where d.id = p_document and d.session_id = p_session and s.user_id = me
  ) then
    raise exception 'That page isn''t in your session.';
  end if;
  if p_page is null or p_page < 1 or p_page > 5000 then
    raise exception 'That isn''t a page.';
  end if;
  if v_quote = '' and v_question = '' then
    raise exception 'Pin a passage or a question.';
  end if;
  select count(*) into n from public.page_pins where user_id = me and document_id = p_document;
  if n >= 40 then
    raise exception 'This file already has 40 pins.';
  end if;
  v_slug := public._session_pack_slug(p_session);
  select d.position into v_idx from public.documents d where d.id = p_document;
  -- A classmate already paid for this question: keep their answer, don't ask again.
  if v_slug is not null and v_idx is not null and v_question <> '' and public._pin_shares(p_session) then
    select p.answer into v_answer
    from public.page_pins p
    where p.pack_slug = v_slug
      and p.doc_index = v_idx
      and p.page_number = p_page
      and lower(btrim(p.question)) = lower(v_question)
      and p.answer is not null
      and public._pin_shares(p.session_id)
    limit 1;
  end if;
  insert into public.page_pins (user_id, session_id, document_id, page_number, quote, question, answer, pack_slug, doc_index)
  values (me, p_session, p_document, p_page, v_quote, v_question, v_answer, v_slug, v_idx)
  returning id into v_id;
  return jsonb_build_object(
    'id', v_id,
    'page_number', p_page,
    'quote', v_quote,
    'question', v_question,
    'answer', v_answer,
    'mine', true,
    'author_name', 'You'
  );
end;
$$;

create or replace function public.pin_to_answer(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v jsonb;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  select jsonb_build_object(
    'id', p.id,
    'session_id', p.session_id,
    'document_id', p.document_id,
    'page_number', p.page_number,
    'quote', p.quote,
    'question', p.question,
    'answer', p.answer
  ) into v
  from public.page_pins p
  where p.id = p_id and p.user_id = me;
  if v is null then
    raise exception 'That pin isn''t yours.';
  end if;
  return v;
end;
$$;

-- Writes the answer only while it's empty, so a second call can't replace it.
create or replace function public.set_pin_answer(p_id uuid, p_answer text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v text := left(btrim(coalesce(p_answer, '')), 2000);
  stored text;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  if v = '' then
    raise exception 'The answer was empty.';
  end if;
  update public.page_pins
  set answer = v
  where id = p_id and user_id = me and answer is null
  returning answer into stored;
  if stored is null then
    select answer into stored from public.page_pins where id = p_id and user_id = me;
  end if;
  if stored is null then
    raise exception 'That pin isn''t yours.';
  end if;
  return stored;
end;
$$;

revoke all on function public._pin_shares(uuid) from public, anon, authenticated;
revoke all on function public._session_pack_slug(uuid) from public, anon, authenticated;
revoke all on function public._ensure_pack_columns() from public, anon, authenticated;

revoke all on function public.course_of(text) from public;
revoke all on function public.course_of_session(uuid) from public, anon;
revoke all on function public.lookup_course(text) from public;
revoke all on function public.set_course_code(uuid, text) from public, anon;
revoke all on function public.grant_class_rep(text) from public, anon;
revoke all on function public.save_sitting(uuid, numeric, int, int, text[], boolean) from public, anon;
revoke all on function public.get_sitting(text) from public;
revoke all on function public.list_page_pins(uuid, uuid) from public, anon;
revoke all on function public.save_page_pin(uuid, uuid, int, text, text) from public, anon;
revoke all on function public.pin_to_answer(uuid) from public, anon;
revoke all on function public.set_pin_answer(uuid, text) from public, anon;

grant execute on function public.course_of(text) to anon, authenticated;
grant execute on function public.course_of_session(uuid) to authenticated;
grant execute on function public.lookup_course(text) to anon, authenticated;
grant execute on function public.set_course_code(uuid, text) to authenticated;
grant execute on function public.grant_class_rep(text) to authenticated;
grant execute on function public.save_sitting(uuid, numeric, int, int, text[], boolean) to authenticated;
grant execute on function public.get_sitting(text) to anon, authenticated;
grant execute on function public.list_page_pins(uuid, uuid) to authenticated;
grant execute on function public.save_page_pin(uuid, uuid, int, text, text) to authenticated;
grant execute on function public.pin_to_answer(uuid) to authenticated;
grant execute on function public.set_pin_answer(uuid, text) to authenticated;

notify pgrst, 'reload schema';


-- =============================================================================
-- supabase/migrations/0029_course_requests.sql
-- =============================================================================

-- Course-link requests (not people) and pack lineage. Safe to re-run.
--
-- A request is one GET of /c/<code> that is not a link-preview bot.
-- It is not a person, not an account, and not the pilot denominator.
-- No IP, no anon id, and no user-agent is stored. The cap is 400 a day.
--
-- lookup_course is migration 0028. If it is missing, the bump does nothing
-- and the redirect still works. my_pack_copy is migration 0024, which is not
-- in this repo. Lineage is skipped when that function is missing.

create table if not exists public.course_requests (
  code     text not null,
  day      date not null,
  requests int not null default 0,
  primary key (code, day),
  constraint course_requests_code check (code ~ '^[a-z0-9]{4,10}$'),
  constraint course_requests_count check (requests between 0 and 400)
);

alter table public.course_requests enable row level security;
revoke all on public.course_requests from public, anon, authenticated;

create table if not exists public.pack_lineage (
  child_slug  text primary key,
  parent_slug text not null,
  created_at  timestamptz not null default now(),
  constraint pack_lineage_slugs check (
    char_length(child_slug) between 1 and 120
    and char_length(parent_slug) between 1 and 120
    and child_slug <> parent_slug
  )
);

alter table public.pack_lineage enable row level security;
revoke all on public.pack_lineage from public, anon, authenticated;

-- Returns nothing. An unknown code and a known code look the same.
create or replace function public.bump_course_request(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_ua text;
  v_slug text;
begin
  if to_regprocedure('public.lookup_course(text)') is null then
    return;
  end if;
  if v_code !~ '^[a-z0-9]{4,10}$' then
    return;
  end if;
  v_ua := coalesce(current_setting('request.headers', true)::json->>'user-agent', '');
  if v_ua ~* 'WhatsApp|facebookexternalhit|Twitterbot|Slackbot|TelegramBot|Discordbot|LinkedInBot' then
    return;
  end if;
  execute 'select public.lookup_course($1)' into v_slug using v_code;
  if v_slug is null or btrim(v_slug) = '' then
    return;
  end if;
  insert into public.course_requests (code, day, requests)
  values (v_code, current_date, 1)
  on conflict (code, day) do update
    set requests = public.course_requests.requests + 1
    where public.course_requests.requests < 400;
end;
$$;

-- Last 14 days, for the pack's owner. Null when there is nothing to show.
create or replace function public.course_requests_recent(p_slug text)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_code text;
  n int;
begin
  if me is null or to_regclass('public.packs') is null then
    return null;
  end if;
  begin
    execute
      'select p.course_code
         from public.packs p
         join public.study_sessions s on s.id = p.session_id
        where p.slug = $1 and s.user_id = $2'
      into v_code
      using left(coalesce(p_slug, ''), 120), me;
  exception when undefined_column or undefined_table then
    return null;
  end;
  if v_code is null then
    return null;
  end if;
  select coalesce(sum(r.requests), 0)::int into n
  from public.course_requests r
  where r.code = v_code and r.day >= (current_date - 13);
  return n;
end;
$$;

-- Write child → parent when this session was itself a copy. Skip otherwise.
create or replace function public.note_pack_lineage(p_session uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_child text;
  v_parent text;
begin
  if me is null then
    return;
  end if;
  if to_regprocedure('public.my_pack_copy(uuid)') is null or to_regclass('public.packs') is null then
    return;
  end if;
  if not exists (select 1 from public.study_sessions s where s.id = p_session and s.user_id = me) then
    return;
  end if;
  begin
    execute 'select slug from public.packs where session_id = $1' into v_child using p_session;
    execute 'select public.my_pack_copy($1)::text' into v_parent using p_session;
  exception when others then
    return;
  end;
  if v_child is null or v_parent is null or btrim(v_parent) = '' or v_parent = v_child then
    return;
  end if;
  insert into public.pack_lineage (child_slug, parent_slug)
  values (left(v_child, 120), left(v_parent, 120))
  on conflict (child_slug) do update set parent_slug = excluded.parent_slug;
end;
$$;

revoke all on function public.bump_course_request(text) from public;
revoke all on function public.course_requests_recent(text) from public, anon;
revoke all on function public.note_pack_lineage(uuid) from public, anon;

grant execute on function public.bump_course_request(text) to anon, authenticated;
grant execute on function public.course_requests_recent(text) to authenticated;
grant execute on function public.note_pack_lineage(uuid) to authenticated;

notify pgrst, 'reload schema';


-- =============================================================================
-- supabase/migrations/0030_section_paper.sql
-- =============================================================================

-- One MCQ paper for a section, generated once. The key stays in this table.
-- Safe to re-run. No foreign key to packs (0024 is not in this repo).
--
-- If packs is missing, every RPC raises 'Packs are not in this database.'
-- and writes nothing. A classmate sees the paper only when my_pack_copy
-- says their session came from that pack. Hand-in does not call save_sitting.
-- The first hand-in is the only time private exam_attempts and review_items
-- are written. document_id is the question's documentId only when that
-- document belongs to the sitter's session.

create table if not exists public.section_papers (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users (id) on delete cascade,
  session_id   uuid not null,
  pack_slug    text not null,
  lines        text[] not null default '{}',
  questions    jsonb,
  withdrawn_at timestamptz,
  created_at   timestamptz not null default now(),
  constraint section_papers_lines check (cardinality(lines) <= 8),
  constraint section_papers_slug check (char_length(pack_slug) between 1 and 120)
);

create unique index if not exists section_papers_one_active
  on public.section_papers (pack_slug)
  where questions is not null and withdrawn_at is null;

alter table public.section_papers enable row level security;
revoke all on public.section_papers from public, anon, authenticated;

create table if not exists public.section_handins (
  id         uuid primary key default gen_random_uuid(),
  paper_id   uuid not null references public.section_papers (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null,
  score      int not null,
  out_of     int not null default 10,
  minutes    int not null,
  topics     text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (paper_id, user_id),
  constraint section_handins_score check (score >= 0 and score <= out_of and out_of = 10),
  constraint section_handins_minutes check (minutes between 0 and 30)
);

alter table public.section_handins enable row level security;
revoke all on public.section_handins from public, anon, authenticated;

-- The pack this session may sit. Raises; does not guess.
create or replace function public._section_slug(p_session uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_slug text;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  if to_regclass('public.packs') is null then
    raise exception 'Packs are not in this database.';
  end if;
  if not exists (select 1 from public.study_sessions s where s.id = p_session and s.user_id = me) then
    raise exception 'That session isn''t yours.';
  end if;
  begin
    execute 'select slug from public.packs where session_id = $1' into v_slug using p_session;
  exception when undefined_table or undefined_column then
    raise exception 'Packs are not in this database.';
  end;
  if v_slug is not null and btrim(v_slug) <> '' then
    return v_slug;
  end if;
  if to_regprocedure('public.my_pack_copy(uuid)') is null then
    raise exception 'Pack copies are not in this database.';
  end if;
  begin
    execute 'select public.my_pack_copy($1)::text' into v_slug using p_session;
  exception when others then
    raise exception 'Pack copies are not in this database.';
  end;
  if v_slug is null or btrim(v_slug) = '' then
    raise exception 'Publish the pack first.';
  end if;
  return v_slug;
end;
$$;

create or replace function public._section_public(p_questions jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q->>'id',
    'question', q->>'question',
    'options', q->'options',
    'topic', q->>'topic',
    'sourceTitle', q->>'sourceTitle',
    'page', (q->>'page')::int
  )), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb)) q;
$$;

create or replace function public.save_section_lines(p_session uuid, p_lines text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_slug text;
  v_line text;
  v_clean text[] := '{}';
  v_id uuid;
begin
  v_slug := public._section_slug(p_session);
  if exists (
    select 1 from public.section_papers
    where pack_slug = v_slug and questions is not null and withdrawn_at is null
  ) then
    raise exception 'Withdraw the paper before changing the lines.';
  end if;
  foreach v_line in array coalesce(p_lines, '{}'::text[]) loop
    v_line := btrim(v_line);
    if v_line = '' then
      continue;
    end if;
    if char_length(v_line) > 80 then
      raise exception 'Each line has to be 80 characters or fewer.';
    end if;
    v_clean := v_clean || v_line;
  end loop;
  if cardinality(v_clean) > 8 then
    raise exception 'Eight lines is the paper.';
  end if;
  if cardinality(v_clean) < 1 then
    raise exception 'Add a line for what the paper covers.';
  end if;
  select id into v_id
  from public.section_papers
  where pack_slug = v_slug and owner_id = me and questions is null and withdrawn_at is null
  order by created_at desc
  limit 1;
  if v_id is null then
    insert into public.section_papers (owner_id, session_id, pack_slug, lines)
    values (me, p_session, v_slug, v_clean)
    returning id into v_id;
  else
    update public.section_papers set lines = v_clean where id = v_id;
  end if;
  return jsonb_build_object('lines', v_clean);
end;
$$;

create or replace function public.store_section_paper(p_session uuid, p_questions jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_slug text;
  v_id uuid;
  q jsonb;
  n int;
  v_correct int;
  v_page int;
begin
  v_slug := public._section_slug(p_session);
  -- Only the published session stores the key. A copier does not.
  if not exists (
    select 1 from public.packs k
    join public.study_sessions s on s.id = k.session_id
    where k.slug = v_slug and s.user_id = me and s.id = p_session
  ) then
    raise exception 'Publish the pack first.';
  end if;
  if exists (
    select 1 from public.section_papers
    where pack_slug = v_slug and questions is not null and withdrawn_at is null
  ) then
    raise exception 'There''s already a section paper. Withdraw it first.';
  end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) <> 10 then
    raise exception 'Couldn''t make questions this time. Try again.';
  end if;
  for q in select value from jsonb_array_elements(p_questions) loop
    n := coalesce(jsonb_array_length(q->'options'), 0);
    v_correct := (q->>'correct')::int;
    v_page := (q->>'page')::int;
    if coalesce(q->>'kind', '') <> 'mcq'
      or n <> 4
      or v_correct is null or v_correct < 0 or v_correct > 3
      or char_length(btrim(coalesce(q->>'topic', ''))) > 80
      or btrim(coalesce(q->>'topic', '')) = ''
      or btrim(coalesce(q->>'explanation', '')) = ''
      or btrim(coalesce(q->>'sourceTitle', '')) = ''
      or v_page is null or v_page < 1 or v_page > 5000
      or btrim(coalesce(q->>'question', '')) = '' then
      raise exception 'Couldn''t make questions this time. Try again.';
    end if;
  end loop;
  select id into v_id
  from public.section_papers
  where pack_slug = v_slug and owner_id = me and questions is null and withdrawn_at is null
  order by created_at desc
  limit 1;
  if v_id is null then
    insert into public.section_papers (owner_id, session_id, pack_slug, lines, questions)
    values (me, p_session, v_slug, '{}', p_questions)
    returning id into v_id;
  else
    update public.section_papers set questions = p_questions where id = v_id;
  end if;
  return jsonb_build_object('questions', public._section_public(p_questions));
end;
$$;

create or replace function public.withdraw_section_paper(p_session uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_slug text;
begin
  v_slug := public._section_slug(p_session);
  if not exists (
    select 1 from public.study_sessions s
    join public.packs k on k.session_id = s.id
    where s.id = p_session and s.user_id = me and k.slug = v_slug
  ) then
    raise exception 'Only the person who published the pack can withdraw the paper.';
  end if;
  update public.section_papers
  set withdrawn_at = now()
  where pack_slug = v_slug and questions is not null and withdrawn_at is null and owner_id = me;
end;
$$;

create or replace function public.get_section_paper(p_session uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_slug text;
  v_owner boolean := false;
  v_lines text[] := '{}';
  v_questions jsonb;
  v_paper uuid;
  v_score int;
  v_topics text[];
  v_minutes int;
begin
  v_slug := public._section_slug(p_session);
  v_owner := exists (
    select 1 from public.study_sessions s
    join public.packs k on k.session_id = s.id
    where s.id = p_session and s.user_id = me and k.slug = v_slug
  );
  select p.id, p.lines, p.questions
    into v_paper, v_lines, v_questions
  from public.section_papers p
  where p.pack_slug = v_slug and p.questions is not null and p.withdrawn_at is null
  order by p.created_at desc
  limit 1;
  if v_paper is null then
    select p.lines into v_lines
    from public.section_papers p
    where p.pack_slug = v_slug and p.withdrawn_at is null
    order by p.created_at desc
    limit 1;
  end if;
  if v_paper is not null then
    select h.score, h.topics, h.minutes into v_score, v_topics, v_minutes
    from public.section_handins h
    where h.paper_id = v_paper and h.user_id = me;
  end if;
  return jsonb_build_object(
    'owner', v_owner,
    'lines', coalesce(v_lines, '{}'),
    'questions', case when v_questions is null then null else public._section_public(v_questions) end,
    'handin', case when v_score is null then null else jsonb_build_object(
      'score', v_score, 'outOf', 10, 'topics', coalesce(v_topics, '{}'), 'minutes', v_minutes
    ) end
  );
end;
$$;

create or replace function public.hand_in_section_paper(p_session uuid, p_choices int[], p_minutes int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_slug text;
  v_paper uuid;
  v_questions jsonb;
  q jsonb;
  i int := 0;
  v_choice int;
  v_correct int;
  v_score int := 0;
  v_topics text[] := '{}';
  v_explain jsonb := '[]'::jsonb;
  v_minutes int := least(30, greatest(0, coalesce(p_minutes, 0)));
  v_new uuid;
  v_doc uuid;
  v_raw text;
  v_answer text;
  v_page int;
  v_stored_topics text[];
  v_stored_score int;
  v_stored_minutes int;
begin
  v_slug := public._section_slug(p_session);
  select p.id, p.questions into v_paper, v_questions
  from public.section_papers p
  where p.pack_slug = v_slug and p.questions is not null and p.withdrawn_at is null
  order by p.created_at desc
  limit 1;
  if v_paper is null then
    raise exception 'There isn''t a section paper yet.';
  end if;

  select h.score, h.topics, h.minutes into v_stored_score, v_stored_topics, v_stored_minutes
  from public.section_handins h
  where h.paper_id = v_paper and h.user_id = me;
  if v_stored_score is not null then
    for q in select value from jsonb_array_elements(v_questions) loop
      if (q->>'topic') = any (v_stored_topics) then
        v_explain := v_explain || jsonb_build_array(jsonb_build_object(
          'topic', q->>'topic',
          'explanation', q->>'explanation',
          'sourceTitle', q->>'sourceTitle',
          'page', (q->>'page')::int
        ));
      end if;
    end loop;
    return jsonb_build_object(
      'score', v_stored_score,
      'outOf', 10,
      'minutes', v_stored_minutes,
      'topics', coalesce(v_stored_topics, '{}'),
      'explanations', v_explain,
      'already', true
    );
  end if;

  for q in select value from jsonb_array_elements(v_questions) loop
    v_choice := p_choices[i + 1];
    v_correct := (q->>'correct')::int;
    if v_choice is not null and v_choice = v_correct then
      v_score := v_score + 1;
    else
      v_topics := v_topics || left(btrim(q->>'topic'), 80);
      v_explain := v_explain || jsonb_build_array(jsonb_build_object(
        'topic', q->>'topic',
        'explanation', q->>'explanation',
        'sourceTitle', q->>'sourceTitle',
        'page', (q->>'page')::int
      ));
    end if;
    i := i + 1;
  end loop;

  insert into public.section_handins (paper_id, user_id, session_id, score, out_of, minutes, topics)
  values (v_paper, me, p_session, v_score, 10, v_minutes, v_topics)
  on conflict (paper_id, user_id) do nothing
  returning id into v_new;

  if v_new is null then
    select h.score, h.topics, h.minutes into v_stored_score, v_stored_topics, v_stored_minutes
    from public.section_handins h
    where h.paper_id = v_paper and h.user_id = me;
    return jsonb_build_object(
      'score', v_stored_score,
      'outOf', 10,
      'minutes', v_stored_minutes,
      'topics', coalesce(v_stored_topics, '{}'),
      'explanations', '[]'::jsonb,
      'already', true
    );
  end if;

  i := 0;
  for q in select value from jsonb_array_elements(v_questions) loop
    v_choice := p_choices[i + 1];
    v_correct := (q->>'correct')::int;
    v_page := (q->>'page')::int;
    v_doc := null;
    v_raw := nullif(q->>'documentId', '');
    if v_raw is not null then
      begin
        select d.id into v_doc
        from public.documents d
        where d.id = v_raw::uuid and d.session_id = p_session;
      exception when invalid_text_representation then
        v_doc := null;
      end;
    end if;
    v_answer := left(
      coalesce(q->'options'->>v_correct, '') || E'\n\n' || coalesce(q->>'explanation', '') || E'\n\n' || coalesce(q->>'sourceTitle', ''),
      4000
    );
    insert into public.exam_attempts (user_id, session_id, document_id, page_number, topic, question, kind, score)
    values (
      me, p_session, v_doc, v_page,
      left(btrim(q->>'topic'), 80),
      left(q->>'question', 2000),
      'mcq',
      case when v_choice is not null and v_choice = v_correct then 1 else 0 end
    );
    if v_choice is null or v_choice <> v_correct then
      insert into public.review_items (user_id, session_id, document_id, page_number, source, source_key, prompt, question, answer)
      values (
        me, p_session, v_doc, v_page, 'mistake',
        left(coalesce(nullif(q->>'id', ''), q->>'question'), 200),
        left(q->>'question', 2000),
        '',
        v_answer
      )
      on conflict (user_id, source, source_key) do nothing;
    end if;
    i := i + 1;
  end loop;

  return jsonb_build_object(
    'score', v_score,
    'outOf', 10,
    'minutes', v_minutes,
    'topics', v_topics,
    'explanations', v_explain,
    'already', false
  );
end;
$$;

-- Lines only. Never the questions. For the public course page.
create or replace function public.section_scope(p_slug text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select p.lines from public.section_papers p
      where p.pack_slug = left(coalesce(p_slug, ''), 120)
        and p.questions is not null and p.withdrawn_at is null
      order by p.created_at desc
      limit 1
    ),
    (
      select p.lines from public.section_papers p
      where p.pack_slug = left(coalesce(p_slug, ''), 120) and p.withdrawn_at is null
      order by p.created_at desc
      limit 1
    ),
    '{}'::text[]
  );
$$;

revoke all on function public._section_slug(uuid) from public, anon, authenticated;
revoke all on function public._section_public(jsonb) from public, anon, authenticated;
revoke all on function public.save_section_lines(uuid, text[]) from public, anon;
revoke all on function public.store_section_paper(uuid, jsonb) from public, anon;
revoke all on function public.withdraw_section_paper(uuid) from public, anon;
revoke all on function public.get_section_paper(uuid) from public, anon;
revoke all on function public.hand_in_section_paper(uuid, int[], int) from public, anon;
revoke all on function public.section_scope(text) from public;

grant execute on function public.save_section_lines(uuid, text[]) to authenticated;
grant execute on function public.store_section_paper(uuid, jsonb) to authenticated;
grant execute on function public.withdraw_section_paper(uuid) to authenticated;
grant execute on function public.get_section_paper(uuid) to authenticated;
grant execute on function public.hand_in_section_paper(uuid, int[], int) to authenticated;
grant execute on function public.section_scope(text) to anon, authenticated;

notify pgrst, 'reload schema';


-- =============================================================================
-- supabase/migrations/0031_library_hour.sql
-- =============================================================================

-- One library hour: a calendar event, not a room. Safe to re-run.
-- Does not write calendar_blocks and does not reference rooms.
-- room_slug is a label the rep typed. At most one upcoming hour per pack,
-- checked in the function (now() cannot sit in an index predicate).

create table if not exists public.library_hours (
  token       text primary key,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  pack_slug   text,
  course_code text,
  room_slug   text,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  place       text not null,
  topic       text not null,
  created_at  timestamptz not null default now(),
  constraint library_hours_token check (token ~ '^[0-9a-f]{32}$'),
  constraint library_hours_span check (ends_at > starts_at and ends_at < starts_at + interval '4 hours'),
  constraint library_hours_text check (char_length(btrim(place)) between 1 and 80 and char_length(btrim(topic)) between 1 and 80),
  constraint library_hours_room check (room_slug is null or char_length(room_slug) between 1 and 80)
);

alter table public.library_hours enable row level security;
revoke all on public.library_hours from public, anon, authenticated;

create or replace function public.create_library_hour(
  p_session uuid,
  p_starts timestamptz,
  p_ends timestamptz,
  p_place text,
  p_topic text,
  p_room text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_slug text;
  v_code text;
  v_place text := left(btrim(coalesce(p_place, '')), 80);
  v_topic text := left(btrim(coalesce(p_topic, '')), 80);
  v_room text := nullif(left(btrim(coalesce(p_room, '')), 80), '');
  v_token text;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  if not exists (select 1 from public.study_sessions s where s.id = p_session and s.user_id = me) then
    raise exception 'That session isn''t yours.';
  end if;
  if to_regclass('public.packs') is null then
    raise exception 'Publish the pack first.';
  end if;
  begin
    execute 'select slug from public.packs where session_id = $1' into v_slug using p_session;
  exception when undefined_table or undefined_column then
    raise exception 'Publish the pack first.';
  end;
  if v_slug is null then
    raise exception 'Publish the pack first.';
  end if;
  if v_place = '' or v_topic = '' then
    raise exception 'A library hour needs a place and a topic.';
  end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts or p_ends >= p_starts + interval '4 hours' then
    raise exception 'A library hour has to be shorter than 4 hours.';
  end if;
  if exists (
    select 1 from public.library_hours h
    where h.pack_slug = v_slug and h.ends_at > now()
  ) then
    raise exception 'This pack already has an upcoming library hour.';
  end if;
  begin
    execute 'select course_code from public.packs where session_id = $1' into v_code using p_session;
  exception when undefined_column then
    v_code := null;
  end;
  v_token := md5(gen_random_uuid()::text || clock_timestamp()::text);
  insert into public.library_hours (token, owner_id, pack_slug, course_code, room_slug, starts_at, ends_at, place, topic)
  values (v_token, me, v_slug, v_code, v_room, p_starts, p_ends, v_place, v_topic);
  return v_token;
end;
$$;

create or replace function public.get_library_hour(p_token text)
returns table (
  token text,
  topic text,
  place text,
  starts_at timestamptz,
  ends_at timestamptz,
  course_code text,
  pack_slug text,
  room_slug text
)
language sql
stable
security definer
set search_path = ''
as $$
  select h.token, h.topic, h.place, h.starts_at, h.ends_at, h.course_code, h.pack_slug, h.room_slug
  from public.library_hours h
  where h.token = p_token and p_token ~ '^[0-9a-f]{32}$';
$$;

revoke all on function public.create_library_hour(uuid, timestamptz, timestamptz, text, text, text) from public, anon;
revoke all on function public.get_library_hour(text) from public;

grant execute on function public.create_library_hour(uuid, timestamptz, timestamptz, text, text, text) to authenticated;
grant execute on function public.get_library_hour(text) to anon, authenticated;

notify pgrst, 'reload schema';


-- =============================================================================
-- supabase/migrations/0032_miss_map.sql
-- =============================================================================

-- A section miss map from distinct sharing hand-ins. Safe to re-run.
-- Does not read sitting_shares, exam_attempts, or review_items.
-- If packs, pack_copies, or section_handins are missing, or the pack
-- columns are not the ones the app uses, the roll raises and writes nothing.

create table if not exists public.miss_maps (
  token      text primary key,
  pack_slug  text not null,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  exam_date  date,
  users      int not null,
  topics     jsonb not null,
  band       text,
  revise     jsonb not null default '[]',
  created_at timestamptz not null default now(),
  constraint miss_maps_token check (token ~ '^[0-9a-f]{32}$'),
  constraint miss_maps_users check (users >= 8)
);

alter table public.miss_maps enable row level security;
revoke all on public.miss_maps from public, anon, authenticated;

create or replace function public._packs_ready()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if to_regclass('public.packs') is null
    or to_regclass('public.pack_copies') is null
    or to_regclass('public.section_handins') is null then
    return false;
  end if;
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'packs'
      and column_name in ('id', 'slug', 'session_id')
  ) < 3 then
    return false;
  end if;
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'pack_copies'
      and column_name in ('session_id', 'share_progress', 'pack_id')
  ) < 3 then
    return false;
  end if;
  return true;
end;
$$;

create or replace function public.roll_miss_map(p_session uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_slug text;
  v_users int;
  v_exam date;
  v_days int;
  v_band text;
  v_topics jsonb := '[]'::jsonb;
  v_revise jsonb := '[]'::jsonb;
  v_content jsonb;
  v_token text;
  v_topic text;
  v_missed int;
  v_of int;
  v_plan jsonb;
  v_src text;
  v_page int;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  if not public._packs_ready() then
    raise exception 'Packs are not in this database.';
  end if;
  if not exists (select 1 from public.study_sessions s where s.id = p_session and s.user_id = me) then
    raise exception 'That session isn''t yours.';
  end if;
  select k.slug into v_slug from public.packs k where k.session_id = p_session;
  if v_slug is null then
    raise exception 'Publish the pack first.';
  end if;

  with copiers as (
    select distinct s.user_id
    from public.pack_copies c
    join public.packs k on k.id = c.pack_id
    join public.study_sessions s on s.id = c.session_id
    where k.slug = v_slug
      and c.share_progress is true
  ),
  hands as (
    select h.user_id, h.topics
    from public.section_handins h
    join public.section_papers p on p.id = h.paper_id
    where p.pack_slug = v_slug
      and p.withdrawn_at is null
      and p.questions is not null
      and h.user_id in (select user_id from copiers)
  )
  select count(distinct user_id) into v_users from hands;

  if coalesce(v_users, 0) < 8 then
    raise exception 'Need 8 hand-ins from people who share progress before a miss map.';
  end if;

  v_of := v_users;
  for v_topic, v_missed in
    with copiers as (
      select distinct s.user_id
      from public.pack_copies c
      join public.packs k on k.id = c.pack_id
      join public.study_sessions s on s.id = c.session_id
      where k.slug = v_slug and c.share_progress is true
    ),
    hands as (
      select h.user_id, h.topics
      from public.section_handins h
      join public.section_papers p on p.id = h.paper_id
      where p.pack_slug = v_slug
        and p.withdrawn_at is null
        and p.questions is not null
        and h.user_id in (select user_id from copiers)
    )
    select topic, count(distinct user_id)::int
    from hands, unnest(topics) as topic
    where btrim(topic) <> ''
    group by topic
    having count(distinct user_id) >= 5
    order by count(distinct user_id) desc, topic
    limit 8
  loop
    v_topics := v_topics || jsonb_build_array(jsonb_build_object(
      'topic', left(v_topic, 80),
      'missed', v_missed,
      'of', v_of
    ));
  end loop;

  if jsonb_array_length(v_topics) = 0 then
    raise exception 'No topic was missed by 5 people yet.';
  end if;

  select s.exam_date into v_exam
  from public.packs k
  join public.study_sessions s on s.id = k.session_id
  where k.slug = v_slug;
  if v_exam is not null then
    v_days := v_exam - current_date;
  end if;
  if v_days between 7 and 14 then
    v_band := 'About ten days out, the section is missing these.';
  end if;

  begin
    execute 'select content from public.packs where slug = $1' into v_content using v_slug;
  exception when undefined_column then
    v_content := null;
  end;
  if v_content is not null then
    for v_topic in select value->>'topic' from jsonb_array_elements(v_topics) loop
      exit when jsonb_array_length(v_revise) >= 3;
      v_plan := null;
      v_src := null;
      v_page := null;
      select t into v_plan
      from jsonb_array_elements(coalesce(v_content->'topics', '[]'::jsonb)) t
      where lower(t->>'title') = lower(v_topic)
      limit 1;
      if v_plan is not null and v_plan->>'doc' ~ '^[0-9]+$' then
        v_src := v_content->'sources'->(v_plan->>'doc')::int->>'title';
        if v_plan->>'page_start' ~ '^[0-9]+$' then
          v_page := (v_plan->>'page_start')::int;
        end if;
      end if;
      v_revise := v_revise || jsonb_build_array(jsonb_build_object(
        'topic', v_topic,
        'sourceTitle', v_src,
        'page', v_page
      ));
    end loop;
  end if;

  v_token := md5(gen_random_uuid()::text || clock_timestamp()::text);
  insert into public.miss_maps (token, pack_slug, owner_id, exam_date, users, topics, band, revise)
  values (v_token, v_slug, me, v_exam, v_users, v_topics, v_band, v_revise);
  return v_token;
end;
$$;

create or replace function public.get_miss_map(p_token text)
returns table (
  token text,
  users int,
  topics jsonb,
  band text,
  revise jsonb,
  exam_date date
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.token, m.users, m.topics, m.band, m.revise, m.exam_date
  from public.miss_maps m
  where m.token = p_token and p_token ~ '^[0-9a-f]{32}$';
$$;

revoke all on function public._packs_ready() from public, anon, authenticated;
revoke all on function public.roll_miss_map(uuid) from public, anon;
revoke all on function public.get_miss_map(text) from public;

grant execute on function public.roll_miss_map(uuid) to authenticated;
grant execute on function public.get_miss_map(text) to anon, authenticated;

notify pgrst, 'reload schema';


-- =============================================================================
-- supabase/migrations/0033_crib.sql
-- =============================================================================

-- A one-page section crib: objectives, concepts, and page numbers.
-- No excerpt column. Safe to re-run. Reads the latest miss map.

create table if not exists public.cribs (
  token       text primary key,
  map_token   text not null,
  pack_slug   text not null,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  course_code text,
  objectives  jsonb not null default '[]',
  concepts    jsonb not null default '[]',
  pages       jsonb not null default '[]',
  openstax    boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint cribs_token check (token ~ '^[0-9a-f]{32}$')
);

alter table public.cribs enable row level security;
revoke all on public.cribs from public, anon, authenticated;

create or replace function public.roll_section_crib(p_session uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_slug text;
  v_map text;
  v_topics jsonb;
  v_content jsonb;
  v_objectives jsonb := '[]'::jsonb;
  v_concepts jsonb := '[]'::jsonb;
  v_pages jsonb := '[]'::jsonb;
  v_code text;
  v_open boolean := false;
  v_token text;
  v_topic text;
  v_plan jsonb;
  v_obj jsonb;
  v_con jsonb;
  v_src text;
  v_page int;
  v_text text;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  if to_regclass('public.packs') is null or to_regclass('public.miss_maps') is null then
    raise exception 'Roll a miss map first.';
  end if;
  if not exists (select 1 from public.study_sessions s where s.id = p_session and s.user_id = me) then
    raise exception 'That session isn''t yours.';
  end if;
  select k.slug into v_slug from public.packs k where k.session_id = p_session;
  if v_slug is null then
    raise exception 'Publish the pack first.';
  end if;
  select m.token, m.topics into v_map, v_topics
  from public.miss_maps m
  where m.pack_slug = v_slug
  order by m.created_at desc
  limit 1;
  if v_map is null then
    raise exception 'Roll a miss map first.';
  end if;

  begin
    execute 'select content from public.packs where slug = $1' into v_content using v_slug;
  exception when undefined_column then
    v_content := null;
  end;
  begin
    execute 'select course_code from public.packs where slug = $1' into v_code using v_slug;
  exception when undefined_column then
    v_code := null;
  end;

  if v_content is not null then
    select exists (
      select 1 from jsonb_array_elements(coalesce(v_content->'sources', '[]'::jsonb)) s
      where coalesce(s->>'url', '') ilike '%openstax.org%'
    ) into v_open;
    for v_topic in select value->>'topic' from jsonb_array_elements(coalesce(v_topics, '[]'::jsonb)) loop
      select t into v_plan
      from jsonb_array_elements(coalesce(v_content->'topics', '[]'::jsonb)) t
      where lower(t->>'title') = lower(v_topic)
      limit 1;
      if v_plan is null then
        continue;
      end if;
      for v_obj in select value from jsonb_array_elements(coalesce(v_plan->'objectives', '[]'::jsonb)) loop
        v_text := left(btrim(v_obj #>> '{}'), 300);
        if v_text <> '' and jsonb_array_length(v_objectives) < 6
          and not v_objectives @> jsonb_build_array(v_text) then
          v_objectives := v_objectives || jsonb_build_array(v_text);
        end if;
      end loop;
      for v_con in select value from jsonb_array_elements(coalesce(v_plan->'key_concepts', '[]'::jsonb)) loop
        v_text := left(btrim(v_con #>> '{}'), 80);
        if v_text <> '' and jsonb_array_length(v_concepts) < 12
          and not v_concepts @> jsonb_build_array(v_text) then
          v_concepts := v_concepts || jsonb_build_array(v_text);
        end if;
      end loop;
      if jsonb_array_length(v_pages) < 8 then
        v_src := null;
        v_page := null;
        if v_plan->>'doc' ~ '^[0-9]+$' then
          v_src := v_content->'sources'->(v_plan->>'doc')::int->>'title';
        end if;
        if v_plan->>'page_start' ~ '^[0-9]+$' then
          v_page := (v_plan->>'page_start')::int;
        end if;
        v_pages := v_pages || jsonb_build_array(jsonb_build_object(
          'topic', v_topic,
          'sourceTitle', v_src,
          'page', v_page
        ));
      end if;
    end loop;
  end if;

  v_token := md5(gen_random_uuid()::text || clock_timestamp()::text);
  insert into public.cribs (token, map_token, pack_slug, owner_id, course_code, objectives, concepts, pages, openstax)
  values (v_token, v_map, v_slug, me, v_code, v_objectives, v_concepts, v_pages, coalesce(v_open, false));
  return v_token;
end;
$$;

create or replace function public.get_crib(p_token text)
returns table (
  token text,
  course_code text,
  objectives jsonb,
  concepts jsonb,
  pages jsonb,
  openstax boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.token, c.course_code, c.objectives, c.concepts, c.pages, c.openstax
  from public.cribs c
  where c.token = p_token and p_token ~ '^[0-9a-f]{32}$';
$$;

revoke all on function public.roll_section_crib(uuid) from public, anon;
revoke all on function public.get_crib(text) from public;

grant execute on function public.roll_section_crib(uuid) to authenticated;
grant execute on function public.get_crib(text) to anon, authenticated;

notify pgrst, 'reload schema';


-- =============================================================================
-- supabase/migrations/0034_noticeboard.sql
-- =============================================================================

-- A door card: a reading list, not a pack. Safe to re-run.
-- Does not need the packs table. file and web_course are rejected.
-- license "link" is stored and is not fetched by this function.

create table if not exists public.noticeboards (
  code       text primary key,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  title      text not null,
  kind       text not null,
  items      jsonb not null,
  plan       jsonb,
  created_at timestamptz not null default now(),
  constraint noticeboards_code check (code ~ '^[a-z0-9]{4,10}$'),
  constraint noticeboards_title check (char_length(title) between 1 and 120),
  constraint noticeboards_kind check (kind in ('study', 'exam', 'paper')),
  constraint noticeboards_items check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 12)
);

alter table public.noticeboards enable row level security;
revoke all on public.noticeboards from public, anon, authenticated;

create or replace function public.create_noticeboard(p_title text, p_kind text, p_items jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_title text := left(btrim(coalesce(p_title, '')), 120);
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  item jsonb;
  v_items jsonb := '[]'::jsonb;
  v_kind_item text;
  v_license text;
  v_url text;
  v_item_title text;
  v_code text;
  n int := 0;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  if v_title = '' then
    raise exception 'Give the card a title.';
  end if;
  if v_kind not in ('study', 'exam', 'paper') then
    raise exception 'Pick study, exam, or paper.';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 12 then
    raise exception 'A door card holds 1 to 12 links.';
  end if;
  for item in select value from jsonb_array_elements(p_items) loop
    v_kind_item := lower(btrim(coalesce(item->>'kind', '')));
    v_license := lower(btrim(coalesce(item->>'license', '')));
    v_item_title := left(btrim(coalesce(item->>'title', '')), 200);
    v_url := left(btrim(coalesce(item->>'url', '')), 2000);
    if v_kind_item = 'file' then
      raise exception 'A door card can''t hold a file. Paste a link.';
    end if;
    if v_kind_item = 'web_course' then
      raise exception 'A door card can''t hold a whole course. Paste one page.';
    end if;
    if v_kind_item not in ('paper', 'web', 'youtube', 'sample') then
      raise exception 'Each item is a paper, a web page, a lecture, or a sample.';
    end if;
    if v_license not in ('cc', 'open', 'link') then
      raise exception 'Mark each link cc, open, or link.';
    end if;
    if v_item_title = '' or v_url = '' then
      raise exception 'Each item needs a title and a link.';
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'title', v_item_title,
      'url', v_url,
      'kind', v_kind_item,
      'license', v_license
    ));
  end loop;
  loop
    n := n + 1;
    if n > 8 then
      raise exception 'Couldn''t make a code. Try again.';
    end if;
    v_code := substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 6);
    begin
      insert into public.noticeboards (code, owner_id, title, kind, items)
      values (v_code, me, v_title, v_kind, v_items);
      return v_code;
    exception when unique_violation then
      -- try another code
    end;
  end loop;
end;
$$;

create or replace function public.set_noticeboard_plan(p_code text, p_plan jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' then
    raise exception 'That plan didn''t check out.';
  end if;
  update public.noticeboards
  set plan = p_plan
  where code = lower(btrim(coalesce(p_code, ''))) and owner_id = me;
  if not found then
    raise exception 'That card isn''t yours.';
  end if;
end;
$$;

create or replace function public.get_noticeboard(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'code', n.code,
    'title', n.title,
    'kind', n.kind,
    'items', n.items,
    'plan', n.plan
  )
  from public.noticeboards n
  where n.code = lower(btrim(coalesce(p_code, '')))
    and p_code ~ '^[a-z0-9]{4,10}$';
$$;

revoke all on function public.create_noticeboard(text, text, jsonb) from public, anon;
revoke all on function public.set_noticeboard_plan(text, jsonb) from public, anon;
revoke all on function public.get_noticeboard(text) from public;

grant execute on function public.create_noticeboard(text, text, jsonb) to authenticated;
grant execute on function public.set_noticeboard_plan(text, jsonb) to authenticated;
grant execute on function public.get_noticeboard(text) to anon, authenticated;

notify pgrst, 'reload schema';


-- =============================================================================
-- supabase/migrations/0035_cite_mode.sql
-- =============================================================================

-- Paper sessions can require every tutor paragraph to cite a retrieved page.
-- Existing rows stay off. New paper inserts set the column in the app.
-- Safe to re-run.

alter table public.study_sessions
  add column if not exists cite_mode boolean not null default false;

notify pgrst, 'reload schema';


-- =============================================================================
-- supabase/migrations/0036_review_gap.sql
-- =============================================================================

-- Explain-back gaps join the review schedule. Do not edit 0017 in place.
-- Safe to re-run: drop the check, then add it back with 'gap' included.
--
-- A gap row stores the feedback already kept (sliced to 500) as prompt,
-- the page, and an empty answer. It does not store speech. Shared RPCs
-- must not select review_items or explain_backs.gap.

alter table public.review_items drop constraint if exists review_items_source_check;
alter table public.review_items add constraint review_items_source_check
  check (source in ('topic', 'highlight', 'asked', 'misconception', 'mistake', 'gap'));

notify pgrst, 'reload schema';


-- =============================================================================
-- supabase/migrations/0037_section_wrapped.sql
-- =============================================================================

-- January counts for a section. No names, no scores, no ranking.
-- Safe to re-run. Does not raise when packs.copies is missing: the
-- hand-in counts do not need migration 0024. copies stays null then.
-- Does not query pack_copies.

create table if not exists public.section_wrapped (
  token       text primary key,
  pack_slug   text,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  exam_date   date,
  handins     int not null,
  copies      int,
  hours       int not null default 0,
  topics      jsonb not null default '[]',
  closed      jsonb not null default '[]',
  course_code text,
  created_at  timestamptz not null default now(),
  constraint section_wrapped_token check (token ~ '^[0-9a-f]{32}$'),
  constraint section_wrapped_counts check (handins >= 0 and hours >= 0 and (copies is null or copies >= 0))
);

create unique index if not exists section_wrapped_one
  on public.section_wrapped (owner_id, pack_slug);

alter table public.section_wrapped enable row level security;
revoke all on public.section_wrapped from public, anon, authenticated;

create or replace function public.roll_section_wrapped(p_session uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_exam date;
  v_slug text;
  v_token text;
  v_handins int := 0;
  v_copies int;
  v_hours int := 0;
  v_code text;
  v_topics jsonb := '[]'::jsonb;
  v_closed jsonb := '[]'::jsonb;
  v_last jsonb;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  select s.exam_date into v_exam
  from public.study_sessions s
  where s.id = p_session and s.user_id = me and s.kind = 'exam';
  if v_exam is null or v_exam >= current_date then
    raise exception 'This page is for after the paper.';
  end if;

  if to_regclass('public.packs') is not null then
    begin
      execute 'select slug from public.packs where session_id = $1' into v_slug using p_session;
    exception when undefined_column or undefined_table then
      v_slug := null;
    end;
  end if;

  select w.token into v_token
  from public.section_wrapped w
  where w.owner_id = me and w.pack_slug is not distinct from v_slug
  limit 1;
  if v_token is not null then
    return v_token;
  end if;

  if to_regclass('public.section_handins') is not null and to_regclass('public.section_papers') is not null then
    if v_slug is not null then
      select count(distinct h.user_id) into v_handins
      from public.section_handins h
      join public.section_papers p on p.id = h.paper_id
      where p.pack_slug = v_slug;
    else
      select count(distinct h.user_id) into v_handins
      from public.section_handins h
      join public.section_papers p on p.id = h.paper_id
      where p.session_id = p_session and p.owner_id = me;
    end if;
  end if;

  v_copies := null;
  if to_regclass('public.packs') is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'packs' and column_name = 'copies'
  ) then
    begin
      execute 'select copies from public.packs where session_id = $1' into v_copies using p_session;
    exception when others then
      v_copies := null;
    end;
  end if;

  if v_slug is not null and to_regclass('public.library_hours') is not null then
    select count(*) into v_hours
    from public.library_hours h
    where h.pack_slug = v_slug and h.ends_at <= now();
  end if;

  if v_slug is not null and to_regclass('public.miss_maps') is not null then
    select m.topics into v_last
    from public.miss_maps m
    where m.pack_slug = v_slug
    order by m.created_at desc
    limit 1;
    select coalesce(jsonb_agg(t->>'topic'), '[]'::jsonb) into v_topics
    from jsonb_array_elements(coalesce(v_last, '[]'::jsonb)) t;
    select coalesce(jsonb_agg(distinct name), '[]'::jsonb) into v_closed
    from (
      select e->>'topic' as name
      from public.miss_maps m
      cross join lateral jsonb_array_elements(m.topics) e
      where m.pack_slug = v_slug
        and m.created_at < (
          select max(created_at) from public.miss_maps where pack_slug = v_slug
        )
    ) earlier
    where name is not null
      and not exists (
        select 1 from jsonb_array_elements(coalesce(v_last, '[]'::jsonb)) last
        where last->>'topic' = name
      );
  end if;

  if v_slug is not null and to_regclass('public.packs') is not null then
    begin
      execute 'select course_code from public.packs where session_id = $1' into v_code using p_session;
    exception when undefined_column then
      v_code := null;
    end;
  end if;

  v_token := md5(gen_random_uuid()::text || clock_timestamp()::text);
  insert into public.section_wrapped (token, pack_slug, owner_id, exam_date, handins, copies, hours, topics, closed, course_code)
  values (v_token, v_slug, me, v_exam, coalesce(v_handins, 0), v_copies, coalesce(v_hours, 0), coalesce(v_topics, '[]'::jsonb), coalesce(v_closed, '[]'::jsonb), v_code);
  return v_token;
end;
$$;

create or replace function public.get_section_wrapped(p_token text)
returns table (
  token text,
  handins int,
  copies int,
  hours int,
  topics jsonb,
  closed jsonb,
  course_code text,
  exam_date date
)
language sql
stable
security definer
set search_path = ''
as $$
  select w.token, w.handins, w.copies, w.hours, w.topics, w.closed, w.course_code, w.exam_date
  from public.section_wrapped w
  where w.token = p_token and p_token ~ '^[0-9a-f]{32}$';
$$;

revoke all on function public.roll_section_wrapped(uuid) from public, anon;
revoke all on function public.get_section_wrapped(text) from public;

grant execute on function public.roll_section_wrapped(uuid) to authenticated;
grant execute on function public.get_section_wrapped(text) to anon, authenticated;

notify pgrst, 'reload schema';

