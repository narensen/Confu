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
