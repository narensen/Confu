-- Notifications, and moderation for threads. Safe to re-run.
-- Needs 0026 (friends), 0027 and 0038 (threads and spaces).
--
-- Notifications: a row per thing that happened to you (a friend request, an
-- accepted request, a room invite, a reply to your question, your reply
-- chosen as the answer, a correction to your post). Written by triggers, so
-- every path that changes those tables notifies, and read live over Realtime.
--
-- Moderation: every post is checked once by the server (lib/moderation.ts).
-- Jev, a decision model, scores how likely it is to be wrong, how well
-- reasoned it is, and whether it's spam or abuse. Above the threshold (0.5),
-- a language model confirms the mistake and writes a correction: a reply is
-- shown corrected (labelled, with the original one click away); a question
-- gets a note on the mistaken premise. Harmful posts are hidden for review.
-- Anyone can report a post; three spam or abuse reports hide it.

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null,
  actor_id   uuid references auth.users (id) on delete set null,
  title      text not null,
  body       text not null default '',
  url        text not null default '',
  data       jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
alter table public.notifications drop constraint if exists notifications_kind;
alter table public.notifications add constraint notifications_kind check (
  kind in ('friend_request', 'friend_accepted', 'room_invite', 'thread_reply', 'reply_accepted', 'post_corrected', 'post_hidden')
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon, authenticated;
-- Read-only, own rows: lets Realtime deliver new rows to their owner.
grant select on public.notifications to authenticated;
drop policy if exists "own notifications" on public.notifications;
create policy "own notifications" on public.notifications for select to authenticated
  using ((select auth.uid()) = user_id);

-- Live delivery (Supabase Realtime), when the publication exists.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

create or replace function public._notify(
  p_user uuid, p_kind text, p_actor uuid, p_title text, p_body text, p_url text, p_data jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user is null or p_user is not distinct from p_actor then
    return;
  end if;
  insert into public.notifications (user_id, kind, actor_id, title, body, url, data)
  values (p_user, p_kind, p_actor, left(p_title, 200), left(coalesce(p_body, ''), 300), left(coalesce(p_url, ''), 300), coalesce(p_data, '{}'::jsonb));
  -- Old, read ones go.
  delete from public.notifications
  where user_id = p_user and read_at is not null and created_at < now() - interval '60 days';
end;
$$;

-- One line of a post, for a notification's body.
create or replace function public._snippet(p_text text, p_max int default 140)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when char_length(t) > p_max then left(t, p_max - 1) || '…'
    else t
  end
  from (select btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')) as t) s;
$$;

-- Friend requests: asked, accepted, withdrawn or declined.
create or replace function public._friendship_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public._notify(
      new.addressee_id, 'friend_request', new.requester_id,
      coalesce(public.first_name_of(new.requester_id), 'Someone') || ' sent you a friend request',
      'Accept to see when they''re studying, and invite each other into private rooms.',
      '/friends', jsonb_build_object('friendship_id', new.id)
    );
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    perform public._notify(
      new.requester_id, 'friend_accepted', new.addressee_id,
      coalesce(public.first_name_of(new.addressee_id), 'Someone') || ' accepted your friend request',
      'You''re friends now. Invite them into a room from the room''s page.',
      '/friends', jsonb_build_object('friendship_id', new.id)
    );
    update public.notifications set read_at = coalesce(read_at, now())
    where kind = 'friend_request' and data ->> 'friendship_id' = new.id::text;
  elsif tg_op = 'DELETE' and old.status = 'pending' then
    -- Withdrawn or declined: the request card has nothing left to do.
    delete from public.notifications
    where kind = 'friend_request' and data ->> 'friendship_id' = old.id::text and read_at is null;
  end if;
  return null;
end;
$$;

drop trigger if exists friendships_notify on public.friendships;
create trigger friendships_notify after insert or update of status or delete on public.friendships
  for each row execute function public._friendship_notify();

-- Room invites: one card per room, refreshed when invited again.
create or replace function public._room_invite_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.notifications
    where user_id = old.to_id and kind = 'room_invite' and data ->> 'room_slug' = old.room_slug and read_at is null;
    return null;
  end if;
  delete from public.notifications
  where user_id = new.to_id and kind = 'room_invite' and data ->> 'room_slug' = new.room_slug and read_at is null;
  perform public._notify(
    new.to_id, 'room_invite', new.from_id,
    coalesce(public.first_name_of(new.from_id), 'Someone') || ' invited you to ' || new.room_name,
    'A private study room with a shared timer and voice.',
    '/rooms/' || new.room_slug, jsonb_build_object('room_slug', new.room_slug, 'room_name', new.room_name, 'invite_id', new.id)
  );
  return null;
end;
$$;

drop trigger if exists room_invites_notify on public.room_friend_invites;
create trigger room_invites_notify after insert or update or delete on public.room_friend_invites
  for each row execute function public._room_invite_notify();

-- Replies: the asker hears about them, several unread ones as one card.
create or replace function public._reply_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  asker uuid;
  question text;
  existing uuid;
  n int;
begin
  select p.author_id, p.title into asker, question from public.posts p where p.id = new.parent_id;
  if asker is null or asker = new.author_id then
    return null;
  end if;
  select x.id, coalesce((x.data ->> 'count')::int, 1) into existing, n
  from public.notifications x
  where x.user_id = asker and x.kind = 'thread_reply' and x.data ->> 'thread_id' = new.parent_id::text and x.read_at is null
  order by x.created_at desc
  limit 1;
  if existing is not null then
    update public.notifications
    set title = (n + 1) || ' new replies to “' || public._snippet(question, 80) || '”',
        body = public._snippet(new.body),
        actor_id = new.author_id,
        data = data || jsonb_build_object('count', n + 1, 'reply_id', new.id),
        created_at = now()
    where id = existing;
  else
    perform public._notify(
      asker, 'thread_reply', new.author_id,
      coalesce(public.first_name_of(new.author_id), 'Someone') || ' replied to “' || public._snippet(question, 80) || '”',
      public._snippet(new.body),
      '/threads/' || new.parent_id, jsonb_build_object('thread_id', new.parent_id, 'reply_id', new.id, 'count', 1)
    );
  end if;
  return null;
end;
$$;

drop trigger if exists posts_reply_notify on public.posts;
create trigger posts_reply_notify after insert on public.posts
  for each row when (new.parent_id is not null) execute function public._reply_notify();

-- An accepted answer: its author hears about it.
create or replace function public._accept_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  replier uuid;
begin
  select r.author_id into replier from public.posts r where r.id = new.accepted_id;
  perform public._notify(
    replier, 'reply_accepted', new.author_id,
    coalesce(public.first_name_of(new.author_id), 'Someone') || ' marked your reply as the answer',
    '“' || public._snippet(new.title, 100) || '”',
    '/threads/' || new.id, jsonb_build_object('thread_id', new.id, 'reply_id', new.accepted_id)
  );
  return null;
end;
$$;

drop trigger if exists posts_accept_notify on public.posts;
create trigger posts_accept_notify after update of accepted_id on public.posts
  for each row when (new.accepted_id is not null and new.accepted_id is distinct from old.accepted_id)
  execute function public._accept_notify();

create or replace function public.my_notifications(p_limit int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  lim int := least(greatest(coalesce(p_limit, 30), 1), 100);
  rows jsonb;
begin
  select coalesce(jsonb_agg(obj order by created_at desc), '[]'::jsonb) into rows
  from (
    select n.created_at,
      jsonb_build_object(
        'id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'url', n.url, 'data', n.data,
        'actor', case when n.actor_id is null then null else public.first_name_of(n.actor_id) end,
        'read', n.read_at is not null, 'created_at', n.created_at
      ) as obj
    from public.notifications n
    where n.user_id = me
    order by n.created_at desc
    limit lim
  ) listed;
  return jsonb_build_object(
    'notifications', rows,
    'unread', (select count(*)::int from public.notifications n where n.user_id = me and n.read_at is null)
  );
end;
$$;

-- Mark some (or, with null, all) of yours as read.
create or replace function public.read_notifications(p_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
begin
  update public.notifications set read_at = now()
  where user_id = me and read_at is null and (p_ids is null or id = any (p_ids));
  return jsonb_build_object('unread', (select count(*)::int from public.notifications n where n.user_id = me and n.read_at is null));
end;
$$;

-- ---------------------------------------------------------------------------
-- Moderation: the check on each post, and reports
-- ---------------------------------------------------------------------------

alter table public.posts add column if not exists check_status text not null default 'pending';
alter table public.posts add column if not exists incorrect_p real;
alter table public.posts add column if not exists rational_p real;
alter table public.posts add column if not exists harmful_p real;
alter table public.posts add column if not exists check_note text;
alter table public.posts add column if not exists check_fix text;
alter table public.posts add column if not exists check_model text;
alter table public.posts add column if not exists checked_at timestamptz;
alter table public.posts add column if not exists check_attempts int not null default 0;
alter table public.posts drop constraint if exists posts_check_status;
alter table public.posts add constraint posts_check_status check (
  check_status in ('pending', 'checking', 'ok', 'flagged', 'corrected', 'hidden', 'error')
);
create index if not exists posts_check_pending_idx on public.posts (created_at) where check_status in ('pending', 'error');

create table if not exists public.post_reports (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  reason     text not null check (reason in ('wrong', 'spam', 'abuse', 'other')),
  note       text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.post_reports enable row level security;
revoke all on public.post_reports from public, anon, authenticated;

-- Who sees a post: everyone who can read its space, unless it's hidden.
-- A hidden post is still shown to its author (with why) and to the owner.
create or replace function public._post_visible(p_status text, p_author uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_status <> 'hidden' or p_author = p_user or public.is_owner();
$$;

-- What a reader is told about a post's check. Nothing while it's fine or
-- not yet checked (apart from "pending", so a page can ask for the check).
create or replace function public._check_json(p public.posts)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p.check_status in ('pending', 'error') then jsonb_build_object('status', 'pending')
    when p.check_status in ('flagged', 'corrected', 'hidden') then jsonb_build_object(
      'status', p.check_status,
      'note', p.check_note,
      'fix', p.check_fix,
      'incorrect', p.incorrect_p,
      'rational', p.rational_p
    )
    else null
  end;
$$;

-- The server's checker (service role only) claims a post before checking
-- it, so two requests never check the same post. Returns what the check
-- needs: the post, its question, its subject.
create or replace function public._claim_post_check(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.posts;
  q public.posts;
  subject text;
begin
  update public.posts
  set check_status = 'checking', check_attempts = check_attempts + 1, checked_at = now()
  where id = p_id
    and check_attempts < 3
    and (check_status in ('pending', 'error') or (check_status = 'checking' and checked_at < now() - interval '5 minutes'))
  returning * into p;
  if not found then
    return null;
  end if;
  if p.parent_id is not null then
    select * into q from public.posts where id = p.parent_id;
  end if;
  select s.name into subject from public.spaces s where s.id = p.space_id and s.visibility = 'public';
  return jsonb_build_object(
    'id', p.id,
    'kind', case when p.parent_id is null then 'question' else 'reply' end,
    'author_id', p.author_id,
    'thread_id', coalesce(p.parent_id, p.id),
    'title', p.title,
    'body', p.body,
    'question_title', q.title,
    'question_body', q.body,
    'subject', subject
  );
end;
$$;

-- The checker's result, and a notification when it changed the post.
create or replace function public._save_post_check(
  p_id uuid, p_status text, p_incorrect real, p_rational real, p_harmful real, p_note text, p_fix text, p_model text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.posts;
  thread_id uuid;
  question text;
begin
  update public.posts
  set check_status = p_status,
      incorrect_p = p_incorrect,
      rational_p = p_rational,
      harmful_p = p_harmful,
      check_note = left(p_note, 4000),
      check_fix = left(p_fix, 8000),
      check_model = left(p_model, 120),
      checked_at = now()
  where id = p_id and check_status = 'checking'
  returning * into p;
  if not found then
    return;
  end if;
  thread_id := coalesce(p.parent_id, p.id);
  select t.title into question from public.posts t where t.id = thread_id;
  if p_status = 'corrected' then
    perform public._notify(
      p.author_id, 'post_corrected', null,
      'Confu added a correction to your reply',
      'On “' || public._snippet(question, 80) || '”. Your original is kept; edit your reply if you disagree.',
      '/threads/' || thread_id, jsonb_build_object('thread_id', thread_id, 'post_id', p.id)
    );
  elsif p_status = 'flagged' and p.parent_id is null then
    perform public._notify(
      p.author_id, 'post_corrected', null,
      'Confu added a note to your question',
      '“' || public._snippet(question, 80) || '” may rest on a mistake. The note explains it.',
      '/threads/' || thread_id, jsonb_build_object('thread_id', thread_id, 'post_id', p.id)
    );
  elsif p_status = 'hidden' then
    perform public._notify(
      p.author_id, 'post_hidden', null,
      'One of your posts is hidden for review',
      'It looked like spam or abuse. If that''s a mistake, edit it and it''s checked again.',
      '/threads/' || thread_id, jsonb_build_object('thread_id', thread_id, 'post_id', p.id)
    );
  end if;
end;
$$;

-- A report from a reader. "Wrong" asks for the check again; three spam or
-- abuse reports hide the post until the owner looks at it.
create or replace function public.report_post(p_id uuid, p_reason text, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  p public.posts;
  reason text := lower(btrim(coalesce(p_reason, '')));
  hidden boolean := false;
  recheck boolean := false;
begin
  if reason not in ('wrong', 'spam', 'abuse', 'other') then
    return jsonb_build_object('error', 'Pick a reason.');
  end if;
  select * into p from public.posts where id = p_id;
  if not found then
    return jsonb_build_object('error', 'That post is gone.');
  end if;
  if not public._space_open(p.space_id, me) then
    return jsonb_build_object('error', 'Join the space first.');
  end if;
  if p.author_id = me then
    return jsonb_build_object('error', 'You can''t report your own post. Edit or delete it instead.');
  end if;
  insert into public.post_reports (post_id, user_id, reason, note)
  values (p_id, me, reason, left(btrim(coalesce(p_note, '')), 500))
  on conflict (post_id, user_id) do update set reason = excluded.reason, note = excluded.note, created_at = now();

  if reason = 'wrong' and p.check_status in ('ok', 'error') and p.check_attempts < 3 then
    update public.posts set check_status = 'pending' where id = p_id;
    recheck := true;
  end if;
  if p.check_status <> 'hidden'
     and (select count(*) from public.post_reports r where r.post_id = p_id and r.reason in ('spam', 'abuse')) >= 3 then
    update public.posts set check_status = 'hidden', check_note = 'Hidden after several reports of spam or abuse.' where id = p_id;
    hidden := true;
  end if;
  return jsonb_build_object('ok', true, 'recheck', recheck, 'hidden', hidden);
end;
$$;

-- The owner's review queue: hidden and corrected posts, and anything reported.
create or replace function public.moderation_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rows jsonb;
begin
  if not public.is_owner() then
    raise exception 'Owners only.';
  end if;
  select coalesce(jsonb_agg(obj order by sort_at desc), '[]'::jsonb) into rows
  from (
    select greatest(p.checked_at, (select max(r.created_at) from public.post_reports r where r.post_id = p.id), p.created_at) as sort_at,
      jsonb_build_object(
        'id', p.id,
        'kind', case when p.parent_id is null then 'question' else 'reply' end,
        'thread_id', coalesce(p.parent_id, p.id),
        'thread_title', coalesce(p.title, (select t.title from public.posts t where t.id = p.parent_id)),
        'author', public.first_name_of(p.author_id),
        'body', p.body,
        'status', p.check_status,
        'incorrect', p.incorrect_p,
        'rational', p.rational_p,
        'harmful', p.harmful_p,
        'note', p.check_note,
        'fix', p.check_fix,
        'created_at', p.created_at,
        'reports', (
          select coalesce(jsonb_agg(jsonb_build_object('reason', r.reason, 'note', r.note) order by r.created_at desc), '[]'::jsonb)
          from public.post_reports r where r.post_id = p.id
        )
      ) as obj
    from public.posts p
    where p.check_status in ('hidden', 'corrected', 'flagged')
       or exists (select 1 from public.post_reports r where r.post_id = p.id)
    order by 1 desc
    limit 100
  ) listed;
  return jsonb_build_object('items', rows);
end;
$$;

-- approve: it's fine, drop the correction · hide · delete · recheck
create or replace function public.moderate_post(p_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Owners only.';
  end if;
  if p_action = 'approve' then
    update public.posts set check_status = 'ok', check_note = null, check_fix = null where id = p_id;
    delete from public.post_reports where post_id = p_id;
  elsif p_action = 'hide' then
    update public.posts set check_status = 'hidden', check_note = coalesce(check_note, 'Hidden by a moderator.') where id = p_id;
  elsif p_action = 'delete' then
    delete from public.posts where id = p_id;
  elsif p_action = 'recheck' then
    update public.posts set check_status = 'pending', check_attempts = 0, check_note = null, check_fix = null where id = p_id;
  else
    return jsonb_build_object('error', 'Unknown action.');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Threads, again (0038): hidden posts left out, and each post's check
-- ---------------------------------------------------------------------------

create or replace function public.browse_threads(
  p_space  text default null,
  p_sort   text default 'active',
  p_query  text default null,
  p_limit  int default 30,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  sid uuid;
  v_sort text := lower(btrim(coalesce(p_sort, 'active')));
  q text := nullif(btrim(coalesce(p_query, '')), '');
  pattern text;
  lim int := least(greatest(coalesce(p_limit, 30), 1), 60);
  off int := least(greatest(coalesce(p_offset, 0), 0), 5000);
  rows jsonb;
  total int;
begin
  if v_sort not in ('active', 'new', 'top', 'unanswered', 'mine') then
    v_sort := 'active';
  end if;
  if p_space is not null then
    select s.id into sid from public.spaces s where s.slug = lower(btrim(p_space));
    if not found then
      return jsonb_build_object('error', 'No space with that link.');
    end if;
    if not public._space_open(sid, me) then
      return jsonb_build_object('error', 'Join this space to see its questions.');
    end if;
  end if;
  if q is not null then
    pattern := '%' || replace(replace(replace(left(q, 120), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with listed as (
    select p.id, p.author_id, p.space_id, p.title, p.body, p.created_at, p.activity_at, p.accepted_id, p.check_status,
      (select count(*)::int from public.posts r where r.parent_id = p.id and r.check_status <> 'hidden') as reply_count,
      (select count(*)::int from public.post_votes v where v.post_id = p.id) as vote_count
    from public.posts p
    left join public.spaces s on s.id = p.space_id
    where p.parent_id is null
      and public._post_visible(p.check_status, p.author_id, me)
      and case
        when sid is not null then p.space_id = sid
        else p.space_id is null
          or s.visibility = 'public'
          or (v_sort = 'mine' and public._in_space(p.space_id, me))
      end
      and (v_sort <> 'mine' or p.author_id = me)
      and (pattern is null or p.title ilike pattern or p.body ilike pattern)
  ),
  filtered as (
    select * from listed where v_sort <> 'unanswered' or (reply_count = 0 and accepted_id is null)
  ),
  page as (
    select f.*, count(*) over () as full_count
    from filtered f
    order by
      case when v_sort = 'top' then f.vote_count end desc nulls last,
      case when v_sort in ('new', 'unanswered') then f.created_at end desc nulls last,
      f.activity_at desc,
      f.id
    limit lim offset off
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', page.id,
        'title', page.title,
        'body', case when char_length(page.body) > 280 then left(page.body, 280) || '…' else page.body end,
        'author', public.first_name_of(page.author_id),
        'mine', page.author_id = me,
        'replies', page.reply_count,
        'votes', page.vote_count,
        'voted', exists (select 1 from public.post_votes v where v.post_id = page.id and v.user_id = me),
        'solved', page.accepted_id is not null,
        'flagged', page.check_status = 'flagged',
        'hidden', page.check_status = 'hidden',
        'created_at', page.created_at,
        'activity_at', page.activity_at,
        'space', case when page.space_id is null then null else public._space_json(page.space_id) end
      )
      order by
        case when v_sort = 'top' then page.vote_count end desc nulls last,
        case when v_sort in ('new', 'unanswered') then page.created_at end desc nulls last,
        page.activity_at desc,
        page.id
    ), '[]'::jsonb),
    coalesce(max(page.full_count), 0)::int
  into rows, total
  from page;

  return jsonb_build_object('threads', rows, 'total', total);
end;
$$;

create or replace function public.get_thread(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  t public.posts;
  space jsonb;
  joined boolean := false;
  replies jsonb;
begin
  select * into t from public.posts p where p.id = p_id and p.parent_id is null;
  if not found or not public._post_visible(t.check_status, t.author_id, me) then
    return jsonb_build_object('error', 'That question is gone.');
  end if;
  if not public._space_open(t.space_id, me) then
    return jsonb_build_object('error', 'Join the space to read this.');
  end if;
  if t.space_id is not null then
    space := public._space_json(t.space_id);
    joined := public._in_space(t.space_id, me);
  end if;

  select coalesce(jsonb_agg(obj order by created_at), '[]'::jsonb) into replies
  from (
    select r.created_at,
      jsonb_build_object(
        'id', r.id,
        'body', r.body,
        'author', public.first_name_of(r.author_id),
        'mine', r.author_id = me,
        'created_at', r.created_at,
        'edited', r.updated_at > r.created_at + interval '1 minute',
        'votes', (select count(*)::int from public.post_votes v where v.post_id = r.id),
        'voted', exists (select 1 from public.post_votes v where v.post_id = r.id and v.user_id = me),
        'accepted', r.id = t.accepted_id,
        'reported', exists (select 1 from public.post_reports x where x.post_id = r.id and x.user_id = me),
        'check', public._check_json(r)
      ) as obj
    from public.posts r
    where r.parent_id = t.id and public._post_visible(r.check_status, r.author_id, me)
    order by r.created_at
    limit 300
  ) listed;

  return jsonb_build_object(
    'thread', jsonb_build_object(
      'id', t.id,
      'title', t.title,
      'body', t.body,
      'author', public.first_name_of(t.author_id),
      'mine', t.author_id = me,
      'created_at', t.created_at,
      'activity_at', t.activity_at,
      'edited', t.updated_at > t.created_at + interval '1 minute',
      'votes', (select count(*)::int from public.post_votes v where v.post_id = t.id),
      'voted', exists (select 1 from public.post_votes v where v.post_id = t.id and v.user_id = me),
      'solved', t.accepted_id is not null,
      'reported', exists (select 1 from public.post_reports x where x.post_id = t.id and x.user_id = me),
      'check', public._check_json(t),
      'space', space,
      'joined', joined,
      'space_slug', space ->> 'slug',
      'space_name', space ->> 'name'
    ),
    'replies', replies
  );
end;
$$;

-- Editing starts the check again (and lifts a correction the edit may have fixed).
create or replace function public.edit_post(p_id uuid, p_title text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._signed_in();
  author uuid;
  parent uuid;
  clean_title text := btrim(coalesce(p_title, ''));
  clean_body text := btrim(coalesce(p_body, ''));
begin
  select p.author_id, p.parent_id into author, parent from public.posts p where p.id = p_id;
  if not found then
    return jsonb_build_object('error', 'That post is gone.');
  end if;
  if author <> me then
    return jsonb_build_object('error', 'You can only edit your own posts.');
  end if;
  if char_length(clean_body) < 1 or char_length(clean_body) > 8000 then
    raise exception 'Keep it between 1 and 8,000 characters.';
  end if;
  if parent is null and (char_length(clean_title) < 3 or char_length(clean_title) > 160) then
    raise exception 'Ask it in one sentence, under 160 characters.';
  end if;
  update public.posts
  set title = case when parent is null then clean_title else null end,
      body = clean_body,
      check_status = 'pending',
      check_attempts = 0,
      check_note = null,
      check_fix = null,
      incorrect_p = null,
      rational_p = null,
      harmful_p = null
  where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public._notify(uuid, text, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public._snippet(text, int) from public, anon, authenticated;
revoke all on function public._friendship_notify() from public, anon, authenticated;
revoke all on function public._room_invite_notify() from public, anon, authenticated;
revoke all on function public._reply_notify() from public, anon, authenticated;
revoke all on function public._accept_notify() from public, anon, authenticated;
revoke all on function public._post_visible(text, uuid, uuid) from public, anon, authenticated;
revoke all on function public._check_json(public.posts) from public, anon, authenticated;
revoke all on function public._claim_post_check(uuid) from public, anon, authenticated;
revoke all on function public._save_post_check(uuid, text, real, real, real, text, text, text) from public, anon, authenticated;
grant execute on function public._claim_post_check(uuid) to service_role;
grant execute on function public._save_post_check(uuid, text, real, real, real, text, text, text) to service_role;

revoke all on function public.my_notifications(int) from public, anon;
revoke all on function public.read_notifications(uuid[]) from public, anon;
revoke all on function public.report_post(uuid, text, text) from public, anon;
revoke all on function public.moderation_queue() from public, anon;
revoke all on function public.moderate_post(uuid, text) from public, anon;
revoke all on function public.browse_threads(text, text, text, int, int) from public, anon;
revoke all on function public.get_thread(uuid) from public, anon;
revoke all on function public.edit_post(uuid, text, text) from public, anon;

grant execute on function public.my_notifications(int) to authenticated;
grant execute on function public.read_notifications(uuid[]) to authenticated;
grant execute on function public.report_post(uuid, text, text) to authenticated;
grant execute on function public.moderation_queue() to authenticated;
grant execute on function public.moderate_post(uuid, text) to authenticated;
grant execute on function public.browse_threads(text, text, text, int, int) to authenticated;
grant execute on function public.get_thread(uuid) to authenticated;
grant execute on function public.edit_post(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
