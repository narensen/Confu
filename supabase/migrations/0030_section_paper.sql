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
