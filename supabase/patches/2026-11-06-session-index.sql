-- Session index (local-first, Phase 3). Study data lives on the student's
-- devices and in their Google Drive; the server keeps only this small list
-- per account: which sessions exist, their titles, and when reviews are next
-- due and how many (for reminder emails). No page text, chat or files.
--
-- Safe to run more than once.

create table if not exists public.session_index (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid not null,
  title text not null default '',
  kind text not null default 'study' check (kind in ('study', 'paper', 'exam')),
  files integer not null default 0 check (files >= 0),
  updated_at timestamptz not null default now(),
  next_review_at timestamptz,
  reviews_due integer not null default 0 check (reviews_due >= 0),
  device text,
  primary key (user_id, session_id),
  constraint session_index_title_len check (char_length(title) <= 300),
  constraint session_index_device_len check (char_length(device) <= 64)
);

create index if not exists session_index_review_idx on public.session_index (next_review_at) where next_review_at is not null;

alter table public.session_index enable row level security;

drop policy if exists "session_index: own rows" on public.session_index;
create policy "session_index: own rows" on public.session_index
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.session_index from anon, public;
grant select, insert, update, delete on public.session_index to authenticated;

-- Reminders count on-device reviews too. (The return type changed, so the
-- old function goes first.)
drop function if exists public.reminder_batch();
-- Who gets a review reminder: students with reviews waiting on the server
-- (the signed-in app), or whose on-device sessions report reviews due in
-- the session index (local = true: the link goes to /app).
CREATE OR REPLACE FUNCTION public.reminder_batch() RETURNS TABLE(user_id uuid, email text, name text, due integer, email_ok boolean, push_ok boolean, local boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select u.id, u.email::text, p.full_name, d.due::int, p.email_reminders, p.push_reminders, d.local
  from (
    select r.user_id, count(*) as due, max(r.last_reviewed_at) as last_review, false as local
    from public.review_items r
    where not r.suspended and r.due_at <= now()
    group by r.user_id
    having count(*) >= 3
    union all
    select i.user_id, sum(i.reviews_due) as due, max(i.updated_at) as last_review, true as local
    from public.session_index i
    where i.next_review_at <= now()
      and not exists (select 1 from public.review_items r where r.user_id = i.user_id and not r.suspended and r.due_at <= now())
    group by i.user_id
    having sum(i.reviews_due) >= 3
  ) d
  join auth.users u on u.id = d.user_id
  join public.profiles p on p.id = d.user_id
  where (p.email_reminders or p.push_reminders)
    and (d.last_review is null or d.last_review < now() - interval '36 hours')
    and not exists (select 1 from public.notification_log l where l.user_id = d.user_id and l.kind = 'reminder' and l.sent_at > now() - interval '3 days');
$$;
revoke all on function public.reminder_batch() from public, anon, authenticated;
grant execute on function public.reminder_batch() to service_role;

notify pgrst, 'reload schema';
