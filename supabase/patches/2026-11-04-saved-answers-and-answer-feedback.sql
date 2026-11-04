  -- For a database created before saved answers and answer feedback existed.
  -- Adds the two tables, their row level security and grants, and the owner's
  -- feedback inbox function, exactly as supabase/schema.sql defines them.
  -- Safe to run more than once. A fresh project gets all of this from
  -- schema.sql and doesn't need it.
  --
  --   saved_answers    the Save button under a tutor answer
  --   answer_feedback  thumbs up/down, comments and corrections on an answer

  -- Saved answers -------------------------------------------------------------

  create table if not exists public.saved_answers (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
    session_id  uuid not null references public.study_sessions (id) on delete cascade,
    question    text check (question is null or char_length(question) <= 2000),
    answer      text not null check (char_length(answer) between 1 and 12000),
    page_number int,
    document_id uuid references public.documents (id) on delete set null,
    created_at  timestamptz not null default now()
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
      and exists (select 1 from public.study_sessions s where s.id = session_id and s.user_id = (select auth.uid()))
    );

  drop policy if exists "remove own saved answers" on public.saved_answers;
  create policy "remove own saved answers" on public.saved_answers
    for delete to authenticated
    using ((select auth.uid()) = user_id);

  revoke all on public.saved_answers from anon, authenticated;
  grant select, delete on public.saved_answers to authenticated;
  grant insert (session_id, question, answer, page_number, document_id) on public.saved_answers to authenticated;

  -- Answer feedback -----------------------------------------------------------

  create table if not exists public.answer_feedback (
    id          bigint generated always as identity primary key,
    user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
    session_id  uuid references public.study_sessions (id) on delete set null,
    rating      text check (rating in ('up', 'down')),
    comment     text check (comment is null or char_length(comment) between 1 and 2000),
    correction  text check (correction is null or char_length(correction) between 1 and 4000),
    answer      text not null check (char_length(answer) between 1 and 8000),
    path        text check (path is null or char_length(path) <= 300),
    created_at  timestamptz not null default now(),
    constraint answer_feedback_has_signal check (rating is not null or comment is not null or correction is not null)
  );

  create index if not exists answer_feedback_time_idx on public.answer_feedback (created_at desc);

  alter table public.answer_feedback enable row level security;

  drop policy if exists "read own answer feedback" on public.answer_feedback;
  create policy "read own answer feedback" on public.answer_feedback
    for select to authenticated
    using ((select auth.uid()) = user_id);

  drop policy if exists "send own answer feedback" on public.answer_feedback;
  create policy "send own answer feedback" on public.answer_feedback
    for insert to authenticated
    with check (
      (select auth.uid()) = user_id
      and (session_id is null or exists (select 1 from public.study_sessions s where s.id = session_id and s.user_id = (select auth.uid())))
    );

  revoke all on public.answer_feedback from anon, authenticated;
  grant select on public.answer_feedback to authenticated;
  grant insert (session_id, rating, comment, correction, answer, path) on public.answer_feedback to authenticated;

  -- The owner's inbox in the admin dashboard.
  create or replace function public.admin_answer_feedback() returns jsonb
    language plpgsql stable security definer
    set search_path to ''
  as $$
  declare
    out jsonb;
  begin
    if not public.is_owner() then
      raise exception 'Owner only';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id,
      'rating', f.rating,
      'comment', f.comment,
      'correction', f.correction,
      'answer', f.answer,
      'path', f.path,
      'created_at', f.created_at,
      'email', u.email
    ) order by f.created_at desc), '[]'::jsonb)
    into out
    from (select * from public.answer_feedback order by created_at desc limit 100) f
    left join auth.users u on u.id = f.user_id;
    return out;
  end;
  $$;

  revoke all on function public.admin_answer_feedback() from public, anon;
  grant execute on function public.admin_answer_feedback() to authenticated;

  notify pgrst, 'reload schema';
