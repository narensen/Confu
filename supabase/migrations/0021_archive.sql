-- Archive: hide a finished session without deleting it. Deleting a session
-- removes its messages, highlights and practice, and with them the days they
-- counted toward the study streak; archiving keeps all of that. Safe to re-run.

alter table public.study_sessions
  add column if not exists archived_at timestamptz;

-- Archived sessions drop out of the calendar feed.
create or replace function public.calendar_feed(p_token text)
returns table (topic_id uuid, title text, due_date date, est_minutes int, page_start int, page_end int, session_id uuid, session_title text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.title, t.due_date, t.est_minutes, t.page_start, t.page_end, s.id, s.title, t.status
  from public.profiles p
  join public.study_plans sp on sp.user_id = p.id
  join public.study_sessions s on s.id = sp.session_id and s.archived_at is null
  join public.plan_topics t on t.plan_id = sp.id
  where p_token ~ '^[0-9a-f]{32}$' and p.calendar_token = p_token
  order by t.due_date, t.position
  limit 1000;
$$;
revoke all on function public.calendar_feed(text) from public;
grant execute on function public.calendar_feed(text) to anon, authenticated;

notify pgrst, 'reload schema';
