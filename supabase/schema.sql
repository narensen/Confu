-- Confu database. The whole schema, in one file.
--
-- Run this once, on an empty Supabase project (SQL editor, or psql -v ON_ERROR_STOP=1 -f supabase/schema.sql).
-- It creates the tables, functions, row level security, grants, the sign-up
-- profile trigger, the private documents bucket, the subject spaces, and the
-- Semantic Scholar rate-limit row.
--
-- Do not run it on a database that already has Confu tables. It is not an
-- upgrade. supabase/README.md explains what is in here and what was left out
-- on purpose (study packs were never in this repository).
--
-- Supabase already provides auth.users, auth.uid(), the storage schema, and
-- the roles anon, authenticated, and service_role.

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

create extension if not exists pgcrypto with schema public;





-- Name: _accept_notify(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._accept_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: _are_friends(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._are_friends(a uuid, b uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester_id = a and addressee_id = b) or (requester_id = b and addressee_id = a))
  )
$$;


-- Name: _can_see_room(text, boolean, uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._can_see_room(p_slug text, p_private boolean, p_friend uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := auth.uid();
begin
  if me is null or p_slug is null then
    return false;
  end if;
  if not p_private then
    return true;
  end if;
  if exists (
    select 1 from public.room_friend_invites
    where room_slug = p_slug and (
      (to_id = me and from_id = p_friend) or (from_id = me and to_id = p_friend)
    )
  ) then
    return true;
  end if;
  return public._in_room(public._room_snapshot(p_slug));
end;
$$;


SET default_table_access_method = heap;

-- Name: posts; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    author_id uuid NOT NULL,
    space_id uuid,
    parent_id uuid,
    title text,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    activity_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_id uuid,
    check_status text DEFAULT 'pending'::text NOT NULL,
    incorrect_p real,
    rational_p real,
    harmful_p real,
    check_note text,
    check_fix text,
    check_model text,
    checked_at timestamp with time zone,
    check_attempts integer DEFAULT 0 NOT NULL,
    CONSTRAINT posts_body CHECK (((char_length(btrim(body)) >= 1) AND (char_length(btrim(body)) <= 8000))),
    CONSTRAINT posts_check_status CHECK ((check_status = ANY (ARRAY['pending'::text, 'checking'::text, 'ok'::text, 'flagged'::text, 'corrected'::text, 'hidden'::text, 'error'::text]))),
    CONSTRAINT posts_shape CHECK ((((parent_id IS NULL) AND (title IS NOT NULL) AND ((char_length(btrim(title)) >= 3) AND (char_length(btrim(title)) <= 160))) OR ((parent_id IS NOT NULL) AND (title IS NULL))))
);


-- Name: _check_json(public.posts); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._check_json(p public.posts) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: _claim_post_check(uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._claim_post_check(p_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: _community_hit(uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._community_hit(p_user uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  hits bigint;
begin
  select count(*) into hits
  from public.community_hits
  where user_id = p_user and created_at > now() - interval '1 day';
  if hits >= 40 then
    raise exception 'You''ve posted a lot today. Try again tomorrow.';
  end if;
  insert into public.community_hits (user_id) values (p_user);
end;
$$;


-- Name: _ensure_friend_code(uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._ensure_friend_code(p_user uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  existing text;
  code text;
  alphabet text := 'abcdefghjkmnpqrstuvwxyz23456789';
  n int;
  i int;
begin
  select friend_code into existing from public.profiles where id = p_user;
  if existing is not null then
    return existing;
  end if;
  for n in 1..8 loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    begin
      update public.profiles set friend_code = code
      where id = p_user and friend_code is null;
      if found then
        return code;
      end if;
    exception when unique_violation then
      null;
    end;
    select friend_code into existing from public.profiles where id = p_user;
    if existing is not null then
      return existing;
    end if;
  end loop;
  raise exception 'Could not make a friend code. Try again.';
end;
$$;


-- Name: _ensure_pack_columns(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._ensure_pack_columns() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: _friendship_notify(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._friendship_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: _in_room(jsonb); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._in_room(state jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select state is not null and (
    coalesce((state->>'mine')::boolean, false)
    or exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(state->'members') = 'array' then state->'members' else '[]'::jsonb end
      ) m
      where coalesce((m->>'me')::boolean, false)
    )
  )
$$;


-- Name: _in_space(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._in_space(p_space uuid, p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1 from public.space_members where space_id = p_space and user_id = p_user
  );
$$;


-- Name: _notify(uuid, text, uuid, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._notify(p_user uuid, p_kind text, p_actor uuid, p_title text, p_body text, p_url text, p_data jsonb DEFAULT '{}'::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: _packs_ready(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._packs_ready() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: _pin_shares(uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._pin_shares(p_session uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
$_$;


-- Name: _post_visible(text, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._post_visible(p_status text, p_author uuid, p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select p_status <> 'hidden' or p_author = p_user or public.is_owner();
$$;


-- Name: _private_room_for_member(text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._private_room_for_member(p_slug text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  state jsonb;
begin
  if p_slug is null or length(p_slug) > 80 or p_slug !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'No such room';
  end if;
  if to_regprocedure('public.room_state(text)') is null then
    raise exception 'Study rooms need migration 0025 to be run.';
  end if;
  state := public._room_snapshot(p_slug);
  if state is null then
    raise exception 'That room doesn''t exist any more.';
  end if;
  if coalesce((state->>'is_public')::boolean, true) then
    raise exception 'Friend invites are for private rooms.';
  end if;
  if not public._in_room(state) then
    raise exception 'Join the room before inviting someone.';
  end if;
  return state;
end;
$_$;


-- Name: _reply_notify(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._reply_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: _room_invite_notify(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._room_invite_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: _room_snapshot(text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._room_snapshot(p_slug text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  state jsonb;
begin
  if p_slug is null or p_slug = '' or to_regprocedure('public.room_state(text)') is null then
    return null;
  end if;
  execute 'select to_jsonb(public.room_state($1))' into state using p_slug;
  if state is null or state = 'null'::jsonb or jsonb_typeof(state) <> 'object' then
    return null;
  end if;
  return state;
exception when others then
  return null;
end;
$_$;


-- Name: _save_post_check(uuid, text, real, real, real, text, text, text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._save_post_check(p_id uuid, p_status text, p_incorrect real, p_rational real, p_harmful real, p_note text, p_fix text, p_model text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: _section_public(jsonb); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._section_public(p_questions jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
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


-- Name: _section_slug(uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._section_slug(p_session uuid) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
$_$;


-- Name: _session_pack_slug(uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._session_pack_slug(p_session uuid) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: _signed_in(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._signed_in() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  return me;
end;
$$;


-- Name: _snippet(text, integer); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._snippet(p_text text, p_max integer DEFAULT 140) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select case
    when char_length(t) > p_max then left(t, p_max - 1) || '…'
    else t
  end
  from (select btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')) as t) s;
$$;


-- Name: _space_json(uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._space_json(p_space uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select jsonb_build_object('slug', s.slug, 'name', s.name, 'icon', s.icon, 'visibility', s.visibility)
  from public.spaces s
  where s.id = p_space;
$$;


-- Name: _space_open(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._space_open(p_space uuid, p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select p_space is null
    or exists (select 1 from public.spaces s where s.id = p_space and s.visibility = 'public')
    or public._in_space(p_space, p_user);
$$;


-- Name: _space_slug_ok(text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public._space_slug_ok(p_slug text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $_$
  select p_slug is not null and (p_slug ~ '^s-[a-z0-9]{10}$' or p_slug ~ '^[a-z][a-z0-9-]{1,38}[a-z0-9]$');
$_$;


-- Name: accept_reply(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.accept_reply(p_thread uuid, p_reply uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := public._signed_in();
  author uuid;
  current_id uuid;
begin
  select p.author_id, p.accepted_id into author, current_id
  from public.posts p
  where p.id = p_thread and p.parent_id is null;
  if not found then
    return jsonb_build_object('error', 'That question is gone.');
  end if;
  if author <> me then
    return jsonb_build_object('error', 'Only the person who asked can choose the answer.');
  end if;
  if p_reply is not null and not exists (select 1 from public.posts r where r.id = p_reply and r.parent_id = p_thread) then
    return jsonb_build_object('error', 'That reply isn''t on this question.');
  end if;
  update public.posts
  set accepted_id = case when p_reply is null or current_id = p_reply then null else p_reply end
  where id = p_thread;
  return jsonb_build_object('accepted', case when p_reply is null or current_id = p_reply then null else p_reply end);
end;
$$;


-- Name: add_page_time(uuid, jsonb, text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.add_page_time(p_document uuid, p_pages jsonb, p_tz text DEFAULT 'UTC'::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  uid uuid := auth.uid();
  tz text := case when exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz) then p_tz else 'UTC' end;
  e jsonb;
  secs int;
  total int := 0;
begin
  if uid is null or jsonb_typeof(p_pages) is distinct from 'array' then
    return;
  end if;
  if not exists (select 1 from public.documents where id = p_document and user_id = uid) then
    return;
  end if;
  for e in select value from jsonb_array_elements(p_pages) limit 100 loop
    continue when (e ->> 'page') !~ '^[0-9]{1,5}$';
    secs := least(greatest(coalesce((e ->> 'seconds')::int, 0), 0), 600);
    total := total + secs;
    insert into public.page_time (user_id, document_id, page_number, seconds, visits)
    values (uid, p_document, (e ->> 'page')::int, secs, least(greatest(coalesce((e ->> 'visits')::int, 0), 0), 20))
    on conflict (user_id, document_id, page_number) do update
      set seconds = public.page_time.seconds + excluded.seconds,
          visits = public.page_time.visits + excluded.visits,
          updated_at = now();
  end loop;
  if total > 0 then
    insert into public.study_days (user_id, day, seconds)
    values (uid, (now() at time zone tz)::date, least(total, 1800))
    on conflict (user_id, day) do update set seconds = public.study_days.seconds + excluded.seconds;
  end if;
end;
$_$;


-- Name: admin_answer_feedback(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.admin_answer_feedback() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: admin_insights(integer); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.admin_insights(p_days integer DEFAULT 30) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  days int := greatest(1, least(coalesce(p_days, 30), 365));
  since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  out jsonb;
begin
  if not public.is_owner() then
    raise exception 'Owner only';
  end if;

  -- "activity": one row per (user, day) on which they did something.
  with activity as materialized (
    select distinct user_id, d from (
      select user_id, created_at::date as d from public.messages where role = 'user' and created_at > now() - interval '150 days'
      union all select user_id, created_at::date from public.events where user_id is not null and created_at > now() - interval '150 days'
      union all select user_id, last_reviewed_at::date from public.review_items where last_reviewed_at > now() - interval '150 days'
      union all select user_id, created_at::date from public.exam_attempts where created_at > now() - interval '150 days'
      union all select user_id, created_at::date from public.highlights where created_at > now() - interval '150 days'
      union all select user_id, created_at::date from public.documents where created_at > now() - interval '150 days'
      union all select user_id, created_at::date from public.study_sessions where created_at > now() - interval '150 days'
      union all select user_id, updated_at::date from public.paper_reviews where updated_at > now() - interval '150 days'
    ) a
    where user_id is not null
  )
  select jsonb_build_object(
    'generated_at', now(),
    'days', days,

    'users', jsonb_build_object(
      'total', (select count(*) from auth.users),
      'new', (select count(*) from auth.users where created_at > since),
      'pro', (select count(*) from public.profiles where role = 'pro'),
      'dau', (select count(distinct user_id) from activity where d = current_date),
      'wau', (select count(distinct user_id) from activity where d > current_date - 7),
      'mau', (select count(distinct user_id) from activity where d > current_date - 30)
    ),

    -- Sign-ups and active people per day.
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', g.day,
        'signups', (select count(*) from auth.users u where u.created_at::date = g.day),
        'active', (select count(distinct a.user_id) from activity a where a.d = g.day)
      ) order by g.day), '[]'::jsonb)
      from (select generate_series(current_date - (days - 1), current_date, interval '1 day')::date as day) g
    ),

    -- Of the people who signed up in the window, how far each got.
    'funnel', (
      with cohort as (select id from auth.users where created_at > since)
      select jsonb_build_array(
        jsonb_build_object('step', 'Signed up', 'users', (select count(*) from cohort)),
        jsonb_build_object('step', 'Created a session', 'users', (select count(*) from cohort c where exists (select 1 from public.study_sessions s where s.user_id = c.id))),
        jsonb_build_object('step', 'Added material', 'users', (select count(*) from cohort c where exists (select 1 from public.documents d where d.user_id = c.id))),
        jsonb_build_object('step', 'Planned or practised', 'users', (select count(*) from cohort c where
            exists (select 1 from public.study_plans p where p.user_id = c.id)
            or exists (select 1 from public.exam_attempts x where x.user_id = c.id)
            or exists (select 1 from public.paper_reviews r where r.user_id = c.id and r.passes_done > 0))),
        jsonb_build_object('step', 'Asked the tutor', 'users', (select count(*) from cohort c where exists (select 1 from public.messages m where m.user_id = c.id and m.role = 'user'))),
        jsonb_build_object('step', 'Came back another day', 'users', (select count(*) from cohort c where (select count(distinct d) from activity a where a.user_id = c.id) >= 2)),
        jsonb_build_object('step', 'Did a review', 'users', (select count(*) from cohort c where exists (select 1 from public.review_items r where r.user_id = c.id and r.reviews > 0)))
      )
    ),

    -- What people actually used in the window (uses and distinct people).
    'features', (
      select coalesce(jsonb_agg(f order by (f ->> 'users')::int desc, (f ->> 'uses')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('feature', 'Tutor: ' || m.action, 'uses', count(*), 'users', count(distinct m.user_id)) as f
        from public.messages m where m.role = 'user' and m.created_at > since group by m.action
        union all
        select jsonb_build_object('feature', case h.kind when 'region' then 'Captured a figure' else 'Saved a highlight' end, 'uses', count(*), 'users', count(distinct h.user_id))
        from public.highlights h where h.created_at > since group by h.kind
        union all
        select jsonb_build_object('feature', 'Answered exam questions', 'uses', count(*), 'users', count(distinct x.user_id))
        from public.exam_attempts x where x.created_at > since having count(*) > 0
        union all
        select jsonb_build_object('feature', 'Reviewed (spaced review)', 'uses', count(*), 'users', count(distinct r.user_id))
        from public.review_items r where r.last_reviewed_at > since having count(*) > 0
        union all
        select jsonb_build_object('feature', 'Built a plan', 'uses', count(*), 'users', count(distinct p.user_id))
        from public.study_plans p where p.created_at > since having count(*) > 0
        union all
        select jsonb_build_object('feature', 'Worked on a paper pass', 'uses', count(*), 'users', count(distinct r.user_id))
        from public.paper_reviews r where r.updated_at > since and r.passes_done > 0 having count(*) > 0
        union all
        select jsonb_build_object('feature', 'Added a PDF', 'uses', count(*), 'users', count(distinct d.user_id))
        from public.documents d where d.created_at > since and d.storage_path is not null having count(*) > 0
        union all
        select jsonb_build_object('feature', 'Added a paper by ID/DOI', 'uses', count(*), 'users', count(distinct d.user_id))
        from public.documents d where d.created_at > since and d.source_url is not null having count(*) > 0
        union all
        select jsonb_build_object('feature', 'UI: ' || e.name, 'uses', count(*), 'users', count(distinct coalesce(e.user_id::text, e.anon_id)))
        from public.events e where e.created_at > since and e.name !~ '^(page|vitals)\.' group by e.name
      ) s
    ),

    -- Session types people create.
    'session_kinds', (
      select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb)
      from (select kind, count(*) as n from public.study_sessions where created_at > since group by kind) k
    ),

    -- Most visited pages, and unique visitors.
    'pages', (
      select coalesce(jsonb_agg(jsonb_build_object('path', path, 'views', views, 'visitors', visitors) order by views desc), '[]'::jsonb)
      from (
        select path, count(*) as views, count(distinct coalesce(user_id::text, anon_id)) as visitors
        from public.events where name = 'page.view' and created_at > since and path is not null
        group by path order by count(*) desc limit 15
      ) p
    ),

    -- Landing page visitors who weren't signed in, against sign-ups.
    'landing', jsonb_build_object(
      'visitors', (select count(distinct anon_id) from public.events where name = 'page.view' and path = '/' and user_id is null and created_at > since),
      'signups', (select count(*) from auth.users where created_at > since)
    ),

    -- Page speed: 75th percentile per metric, and how often it was poor.
    'vitals', (
      select coalesce(jsonb_agg(jsonb_build_object('metric', upper(substr(name, 8)), 'p75', p75, 'samples', n, 'poor', poor) order by name), '[]'::jsonb)
      from (
        select name,
               round((percentile_cont(0.75) within group (order by (props ->> 'value')::float8))::numeric, 3) as p75,
               count(*) as n,
               count(*) filter (where props ->> 'rating' = 'poor') as poor
        from public.events
        where name like 'vitals.%' and created_at > since and (props ->> 'value') ~ '^[0-9.]+$'
        group by name
      ) v
    ),

    -- Slowest interactions by page (INP), to find buttons like a slow Delete.
    'slow_pages', (
      select coalesce(jsonb_agg(jsonb_build_object('path', path, 'p75', p75, 'samples', n) order by p75 desc), '[]'::jsonb)
      from (
        select path, round((percentile_cont(0.75) within group (order by (props ->> 'value')::float8))::numeric) as p75, count(*) as n
        from public.events
        where name = 'vitals.inp' and created_at > since and (props ->> 'value') ~ '^[0-9.]+$' and path is not null
        group by path having count(*) >= 3 order by 2 desc limit 8
      ) s
    ),

    -- The specific things that were slow to click (tag + class names, never text).
    'slow_targets', (
      select coalesce(jsonb_agg(jsonb_build_object('target', target, 'path', path, 'p75', p75, 'samples', n) order by p75 desc), '[]'::jsonb)
      from (
        select props ->> 'target' as target,
               (array_agg(path order by created_at desc))[1] as path,
               round((percentile_cont(0.75) within group (order by (props ->> 'value')::float8))::numeric) as p75,
               count(*) as n
        from public.events
        where name = 'vitals.inp' and created_at > since and props ->> 'target' is not null and (props ->> 'value') ~ '^[0-9.]+$'
        group by props ->> 'target'
        having max((props ->> 'value')::float8) > 200
        order by 3 desc limit 8
      ) t
    ),

    -- AI usage: on Confu's keys (Pro pool, free trial, server) vs people's own keys.
    'ai', jsonb_build_object(
      'confu_tokens', (select coalesce(sum(total_tokens), 0) from public.ai_usage where created_at > since and key_ref in ('pro', 'trial', 'server')),
      'own_tokens', (select coalesce(sum(total_tokens), 0) from public.ai_usage where created_at > since and key_ref not in ('pro', 'trial', 'server')),
      'requests', (select count(*) from public.ai_usage where created_at > since),
      'by_feature', (
        select coalesce(jsonb_agg(jsonb_build_object('feature', feature, 'requests', n, 'tokens', t) order by t desc), '[]'::jsonb)
        from (select feature, count(*) as n, sum(total_tokens) as t from public.ai_usage where created_at > since group by feature) f
      ),
      'top_users', (
        select coalesce(jsonb_agg(jsonb_build_object('email', email, 'tokens', t) order by t desc), '[]'::jsonb)
        from (
          select u.email::text as email, sum(a.total_tokens) as t
          from public.ai_usage a join auth.users u on u.id = a.user_id
          where a.created_at > since and a.key_ref in ('pro', 'trial', 'server')
          group by u.email order by 2 desc limit 8
        ) t
      )
    ),

    -- What people told us at sign-up (everyone, all time).
    'survey', jsonb_build_object(
      'heard_from', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select coalesce(heard_from, 'not answered') as k, count(*) as n from public.profiles group by 1) s),
      'occupation', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select coalesce(occupation, 'not answered') as k, count(*) as n from public.profiles group by 1) s),
      'purpose', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select coalesce(purpose, 'not answered') as k, count(*) as n from public.profiles group by 1) s)
    ),

    -- Weekly cohorts: of those who joined in a week, the share active 1-4 weeks later.
    'retention', (
      with cohorts as (
        select id, date_trunc('week', created_at)::date as wk from auth.users where created_at > now() - interval '9 weeks'
      ), cells as (
        select c.wk, k, count(*) as size,
               count(*) filter (where exists (
                 select 1 from activity a where a.user_id = c.id and a.d >= c.wk + 7 * k and a.d < c.wk + 7 * (k + 1)
               )) as active
        from cohorts c cross join generate_series(1, 4) k
        group by c.wk, k
      )
      select coalesce(jsonb_agg(jsonb_build_object('week', wk, 'size', size, 'weeks', weeks) order by wk), '[]'::jsonb)
      from (
        select wk, max(size) as size,
               jsonb_agg(case when wk + 7 * k > current_date then null else round(100.0 * active / greatest(size, 1)) end order by k) as weeks
        from cells group by wk
      ) r
    ),

    -- Newest people, with how much they've done.
    'recent_users', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'email', u.email, 'joined', u.created_at, 'plan', coalesce(p.role, 'free'),
        'occupation', p.occupation, 'heard_from', p.heard_from,
        'sessions', (select count(*) from public.study_sessions s where s.user_id = u.id),
        'active_days', (select count(*) from activity a where a.user_id = u.id),
        'last_active', (select max(d) from activity a where a.user_id = u.id)
      ) order by u.created_at desc), '[]'::jsonb)
      from (select * from auth.users order by created_at desc limit 40) u
      left join public.profiles p on p.id = u.id
    ),

    'feedback', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', f.id, 'kind', f.kind, 'message', f.message, 'path', f.path, 'status', f.status,
        'created_at', f.created_at, 'email', u.email
      ) order by (f.status = 'new') desc, f.created_at desc), '[]'::jsonb)
      from (select * from public.feedback order by created_at desc limit 100) f
      left join auth.users u on u.id = f.user_id
    ),

    'errors', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'fingerprint', fingerprint, 'source', source, 'message', message, 'path', path,
        'count', n, 'people', people, 'last_seen', last_seen
      ) order by n desc), '[]'::jsonb)
      from (
        select fingerprint, min(source) as source, count(*) as n, count(distinct user_id) as people, max(created_at) as last_seen,
               (array_agg(message order by created_at desc))[1] as message,
               (array_agg(path order by created_at desc))[1] as path
        from public.app_errors where created_at > since
        group by fingerprint order by count(*) desc limit 30
      ) e
    )
  ) into out;

  return out;
end;
$_$;


-- Name: browse_spaces(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.browse_spaces() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := public._signed_in();
  rows jsonb;
begin
  select coalesce(jsonb_agg(obj order by sort, name), '[]'::jsonb) into rows
  from (
    select s.sort, s.name,
      jsonb_build_object(
        'id', s.id,
        'slug', s.slug,
        'name', s.name,
        'about', s.about,
        'icon', s.icon,
        'category', s.category,
        'visibility', s.visibility,
        'official', s.owner_id is null,
        'mine', false,
        'joined', public._in_space(s.id, me),
        'members', (select count(*)::int from public.space_members m where m.space_id = s.id),
        'questions', (select count(*)::int from public.posts p where p.space_id = s.id and p.parent_id is null),
        'this_week', (select count(*)::int from public.posts p where p.space_id = s.id and p.created_at > now() - interval '7 days')
      ) as obj
    from public.spaces s
    where s.visibility = 'public'
  ) listed;
  return jsonb_build_object('spaces', rows);
end;
$$;


-- Name: browse_threads(text, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.browse_threads(p_space text DEFAULT NULL::text, p_sort text DEFAULT 'active'::text, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: bump_course_request(text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.bump_course_request(p_code text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
$_$;


-- Name: calendar_feed(text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.calendar_feed(p_token text) RETURNS TABLE(topic_id uuid, title text, due_date date, est_minutes integer, page_start integer, page_end integer, session_id uuid, session_title text, status text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
  select t.id, t.title, t.due_date, t.est_minutes, t.page_start, t.page_end, s.id, s.title, t.status
  from public.profiles p
  join public.study_plans sp on sp.user_id = p.id
  join public.study_sessions s on s.id = sp.session_id and s.archived_at is null
  join public.plan_topics t on t.plan_id = sp.id
  where p_token ~ '^[0-9a-f]{32}$' and p.calendar_token = p_token
  order by t.due_date, t.position
  limit 1000;
$_$;


-- Name: cancel_friend_request(uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.cancel_friend_request(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := public._signed_in();
  n int;
begin
  delete from public.friendships
  where id = p_id and requester_id = me and status = 'pending';
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'That request is no longer pending.';
  end if;
end;
$$;


-- Name: confu_schema_version(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.confu_schema_version() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 12 $$;


-- Name: course_of(text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.course_of(p_slug text) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
$_$;


-- Name: course_of_session(uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.course_of_session(p_session uuid) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
$_$;


-- Name: course_requests_recent(text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.course_requests_recent(p_slug text) RETURNS integer
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
$_$;


-- Name: create_library_hour(uuid, timestamp with time zone, timestamp with time zone, text, text, text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.create_library_hour(p_session uuid, p_starts timestamp with time zone, p_ends timestamp with time zone, p_place text, p_topic text, p_room text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
$_$;


-- Name: create_noticeboard(text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.create_noticeboard(p_title text, p_kind text, p_items jsonb) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: create_space(text, text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.create_space(p_name text, p_about text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := public._signed_in();
  clean_name text := btrim(coalesce(p_name, ''));
  clean_about text := btrim(coalesce(p_about, ''));
  alphabet text := 'abcdefghjkmnpqrstuvwxyz23456789';
  made_slug text;
  sid uuid;
  n int;
  i int;
begin
  if char_length(clean_name) < 2 or char_length(clean_name) > 80 then
    raise exception 'Give the space a short name.';
  end if;
  if char_length(clean_about) > 500 then
    raise exception 'Keep the description under 500 characters.';
  end if;
  perform public._community_hit(me);
  for n in 1..5 loop
    made_slug := 's-';
    for i in 1..10 loop
      made_slug := made_slug || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    begin
      insert into public.spaces (owner_id, slug, name, about)
      values (me, made_slug, clean_name, clean_about)
      returning spaces.id into sid;
      exit;
    exception when unique_violation then
      sid := null;
    end;
  end loop;
  if sid is null then
    return jsonb_build_object('error', 'Couldn''t make a link. Try again.');
  end if;
  insert into public.space_members (space_id, user_id) values (sid, me);
  return jsonb_build_object('slug', made_slug, 'name', clean_name);
end;
$$;


-- Name: create_thread(text, text, uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.create_thread(p_title text, p_body text, p_space uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := public._signed_in();
  clean_title text := btrim(coalesce(p_title, ''));
  clean_body text := btrim(coalesce(p_body, ''));
  vis text;
  new_id uuid;
begin
  if char_length(clean_title) < 3 or char_length(clean_title) > 160 then
    raise exception 'Ask it in one sentence, under 160 characters.';
  end if;
  if char_length(clean_body) < 1 or char_length(clean_body) > 8000 then
    raise exception 'Add the question underneath, up to 8,000 characters.';
  end if;
  if p_space is not null then
    select s.visibility into vis from public.spaces s where s.id = p_space;
    if not found then
      return jsonb_build_object('error', 'That space is gone.');
    end if;
    if vis = 'public' then
      insert into public.space_members (space_id, user_id) values (p_space, me) on conflict do nothing;
    elsif not public._in_space(p_space, me) then
      return jsonb_build_object('error', 'Join this space before asking in it.');
    end if;
  end if;
  perform public._community_hit(me);
  insert into public.posts (author_id, space_id, title, body)
  values (me, p_space, clean_title, clean_body)
  returning posts.id into new_id;
  if p_space is not null then
    update public.spaces set updated_at = now() where spaces.id = p_space;
  end if;
  return jsonb_build_object('id', new_id);
end;
$$;


-- Name: delete_my_account(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.delete_my_account() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;


-- Name: delete_post(uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.delete_post(p_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := public._signed_in();
  author uuid;
begin
  select p.author_id into author from public.posts p where p.id = p_id;
  if not found then
    return jsonb_build_object('error', 'That post is already gone.');
  end if;
  if author <> me then
    return jsonb_build_object('error', 'You can only remove your own posts.');
  end if;
  delete from public.posts where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;


-- Name: delete_space(text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.delete_space(p_slug text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := public._signed_in();
  sid uuid;
  owner uuid;
begin
  if not public._space_slug_ok(p_slug) then
    return jsonb_build_object('error', 'No space with that link.');
  end if;
  select s.id, s.owner_id into sid, owner from public.spaces s where s.slug = p_slug;
  if not found then
    return jsonb_build_object('error', 'No space with that link.');
  end if;
  -- A subject space has no owner: no one can delete it from the app.
  if owner is null or owner <> me then
    return jsonb_build_object('error', 'Only the person who started the space can delete it.');
  end if;
  delete from public.spaces where id = sid;
  return jsonb_build_object('ok', true);
end;
$$;


-- Name: digest_batch(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.digest_batch() RETURNS TABLE(user_id uuid, email text, name text, minutes integer, active_days integer, topics_done integer, reviews integer, due integer, sessions jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select u.id, u.email::text, p.full_name,
    coalesce((select sum(seconds) from public.study_days sd where sd.user_id = u.id and sd.day > current_date - 7), 0)::int / 60,
    (select count(distinct x.d) from (
       select created_at::date as d from public.messages m where m.user_id = u.id and m.role = 'user' and m.created_at > now() - interval '7 days'
       union select day from public.study_days sd where sd.user_id = u.id and sd.day > current_date - 7 and sd.seconds >= 60
       union select last_reviewed_at::date from public.review_items r where r.user_id = u.id and r.last_reviewed_at > now() - interval '7 days'
     ) x)::int,
    (select count(*) from public.plan_topics t where t.user_id = u.id and t.completed_at > now() - interval '7 days')::int,
    (select count(*) from public.review_items r where r.user_id = u.id and r.last_reviewed_at > now() - interval '7 days')::int,
    (select count(*) from public.review_items r where r.user_id = u.id and not r.suspended and r.due_at <= now() + interval '1 day')::int,
    (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title) order by s.updated_at desc), '[]'::jsonb)
       from (select id, title, updated_at from public.study_sessions s where s.user_id = u.id order by updated_at desc limit 3) s)
  from auth.users u
  join public.profiles p on p.id = u.id
  where p.email_digest
    and u.email_confirmed_at is not null
    and exists (select 1 from public.study_sessions s where s.user_id = u.id and s.updated_at > now() - interval '30 days')
    and not exists (select 1 from public.notification_log l where l.user_id = u.id and l.kind = 'digest' and l.sent_at > now() - interval '6 days');
$$;


-- Name: dismiss_room_invite(uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.dismiss_room_invite(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := public._signed_in();
begin
  delete from public.room_friend_invites where id = p_id and to_id = me;
end;
$$;


-- Name: edit_post(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.edit_post(p_id uuid, p_title text, p_body text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: first_name_of(uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.first_name_of(p_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(nullif(split_part(btrim(coalesce(full_name, '')), ' ', 1), ''), 'Someone')
  from public.profiles
  where id = p_id
$$;


-- Name: friend_notices(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.friend_notices() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    return jsonb_build_object('incoming', 0, 'invites', 0);
  end if;
  return jsonb_build_object(
    'incoming', (select count(*) from public.friendships where addressee_id = me and status = 'pending'),
    'invites', (select count(*) from public.room_friend_invites where to_id = me)
  );
end;
$$;


-- Name: get_crib(text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.get_crib(p_token text) RETURNS TABLE(token text, course_code text, objectives jsonb, concepts jsonb, pages jsonb, openstax boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
  select c.token, c.course_code, c.objectives, c.concepts, c.pages, c.openstax
  from public.cribs c
  where c.token = p_token and p_token ~ '^[0-9a-f]{32}$';
$_$;


-- Name: get_library_hour(text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.get_library_hour(p_token text) RETURNS TABLE(token text, topic text, place text, starts_at timestamp with time zone, ends_at timestamp with time zone, course_code text, pack_slug text, room_slug text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
  select h.token, h.topic, h.place, h.starts_at, h.ends_at, h.course_code, h.pack_slug, h.room_slug
  from public.library_hours h
  where h.token = p_token and p_token ~ '^[0-9a-f]{32}$';
$_$;


-- Name: get_miss_map(text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.get_miss_map(p_token text) RETURNS TABLE(token text, users integer, topics jsonb, band text, revise jsonb, exam_date date)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
  select m.token, m.users, m.topics, m.band, m.revise, m.exam_date
  from public.miss_maps m
  where m.token = p_token and p_token ~ '^[0-9a-f]{32}$';
$_$;


-- Name: get_noticeboard(text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.get_noticeboard(p_code text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
$_$;


-- Name: get_section_paper(uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.get_section_paper(p_session uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: get_section_wrapped(text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.get_section_wrapped(p_token text) RETURNS TABLE(token text, handins integer, copies integer, hours integer, topics jsonb, closed jsonb, course_code text, exam_date date)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
  select w.token, w.handins, w.copies, w.hours, w.topics, w.closed, w.course_code, w.exam_date
  from public.section_wrapped w
  where w.token = p_token and p_token ~ '^[0-9a-f]{32}$';
$_$;


-- Name: get_sitting(text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.get_sitting(p_token text) RETURNS TABLE(title text, score numeric, out_of integer, minutes integer, topics text[], band text, display_name text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
  select s.title, s.score, s.out_of, s.minutes, s.topics, s.band, s.display_name
  from public.sitting_shares s
  where s.token = p_token and p_token ~ '^[0-9a-f]{32}$';
$_$;


-- Name: get_thread(uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.get_thread(p_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: hand_in_section_paper(uuid, integer[], integer); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.hand_in_section_paper(p_session uuid, p_choices integer[], p_minutes integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  insert into public.profiles (id, full_name, heard_from, occupation, purpose, purpose_detail)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    left(new.raw_user_meta_data ->> 'heard_from', 100),
    left(new.raw_user_meta_data ->> 'occupation', 100),
    left(new.raw_user_meta_data ->> 'purpose', 100),
    left(new.raw_user_meta_data ->> 'purpose_detail', 500)
  );
  return new;
end;
$$;


-- Name: invite_friend_to_room(text, uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.invite_friend_to_room(p_slug text, p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := public._signed_in();
  state jsonb;
  room_name text;
  n int;
begin
  if p_user_id is null or p_user_id = me then
    raise exception 'Pick a friend to invite.';
  end if;
  if not public._are_friends(me, p_user_id) then
    raise exception 'You can only invite friends.';
  end if;
  state := public._private_room_for_member(p_slug);
  room_name := left(coalesce(nullif(btrim(state->>'name'), ''), 'Study room'), 80);

  select count(*) into n from public.room_friend_invites where room_slug = p_slug;
  if n >= 40 and not exists (
    select 1 from public.room_friend_invites where room_slug = p_slug and to_id = p_user_id
  ) then
    raise exception 'This room already has 40 invites.';
  end if;

  insert into public.room_friend_invites (room_slug, room_name, from_id, to_id)
  values (p_slug, room_name, me, p_user_id)
  on conflict on constraint room_friend_invites_once do update set
    from_id = excluded.from_id,
    room_name = excluded.room_name,
    created_at = now();
end;
$$;


-- Name: is_owner(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.is_owner() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;


-- Name: join_space(text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.join_space(p_slug text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := public._signed_in();
  sid uuid;
begin
  if not public._space_slug_ok(p_slug) then
    return jsonb_build_object('error', 'No space with that link.');
  end if;
  select s.id into sid from public.spaces s where s.slug = p_slug;
  if not found then
    return jsonb_build_object('error', 'No space with that link.');
  end if;
  insert into public.space_members (space_id, user_id) values (sid, me)
  on conflict do nothing;
  return public.space_state(p_slug);
end;
$$;


-- Name: leave_space(text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.leave_space(p_slug text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := public._signed_in();
  sid uuid;
  owner uuid;
begin
  if not public._space_slug_ok(p_slug) then
    return jsonb_build_object('error', 'No space with that link.');
  end if;
  select s.id, s.owner_id into sid, owner from public.spaces s where s.slug = p_slug;
  if not found then
    return jsonb_build_object('error', 'No space with that link.');
  end if;
  if owner is not null and owner = me then
    return jsonb_build_object('error', 'You started this space. Delete it if you want it gone.');
  end if;
  delete from public.space_members where space_id = sid and user_id = me;
  return jsonb_build_object('ok', true);
end;
$$;


-- Name: list_page_pins(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.list_page_pins(p_session uuid, p_document uuid) RETURNS TABLE(id uuid, page_number integer, quote text, question text, answer text, mine boolean, author_name text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: list_threads(uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.list_threads(p_space uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := public._signed_in();
  rows jsonb;
begin
  if p_space is not null and not public._in_space(p_space, me) then
    return jsonb_build_object('error', 'Join this space to see its questions.');
  end if;
  select coalesce(jsonb_agg(obj order by created_at desc), '[]'::jsonb) into rows
  from (
    select p.created_at,
      jsonb_build_object(
        'id', p.id,
        'title', p.title,
        'body', case when char_length(p.body) > 280 then left(p.body, 280) || '…' else p.body end,
        'author', public.first_name_of(p.author_id),
        'mine', p.author_id = me,
        'replies', (select count(*)::int from public.posts r where r.parent_id = p.id),
        'created_at', p.created_at
      ) as obj
    from public.posts p
    where p.parent_id is null
      and p.space_id is not distinct from p_space
    order by p.created_at desc
    limit 40
  ) s;
  return jsonb_build_object('threads', rows);
end;
$$;


-- Name: lookup_course(text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.lookup_course(p_code text) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
$_$;


-- Name: moderate_post(uuid, text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.moderate_post(p_id uuid, p_action text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: moderation_queue(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.moderation_queue() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: my_friends(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.my_friends() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := public._signed_in();
  code text := public._ensure_friend_code(me);
  incoming jsonb;
  outgoing jsonb;
  invites jsonb;
  friends jsonb := '[]'::jsonb;
  rec record;
  seen timestamptz;
  slug text;
  rname text;
  rprivate boolean;
  voice boolean;
  online boolean;
  visible boolean;
  hidden boolean;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'name', coalesce(public.first_name_of(f.requester_id), 'Someone'),
    'created_at', f.created_at
  ) order by f.created_at desc), '[]'::jsonb)
  into incoming
  from public.friendships f
  where f.addressee_id = me and f.status = 'pending';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'name', coalesce(public.first_name_of(f.addressee_id), 'Someone'),
    'created_at', f.created_at
  ) order by f.created_at desc), '[]'::jsonb)
  into outgoing
  from public.friendships f
  where f.requester_id = me and f.status = 'pending';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'room_slug', i.room_slug,
    'room_name', i.room_name,
    'from_name', coalesce(public.first_name_of(i.from_id), 'Someone'),
    'created_at', i.created_at
  ) order by i.created_at desc), '[]'::jsonb)
  into invites
  from public.room_friend_invites i
  where i.to_id = me;

  for rec in
    select case when f.requester_id = me then f.addressee_id else f.requester_id end as other_id
    from public.friendships f
    where f.status = 'accepted' and (f.requester_id = me or f.addressee_id = me)
    limit 200
  loop
    seen := null;
    slug := null;
    rname := null;
    rprivate := false;
    voice := false;
    select updated_at, room_slug, room_name, room_private, in_voice
      into seen, slug, rname, rprivate, voice
    from public.friend_presence
    where user_id = rec.other_id;
    online := seen is not null and seen > now() - interval '90 seconds';
    visible := online and slug is not null and public._can_see_room(slug, coalesce(rprivate, false), rec.other_id);
    hidden := online and slug is not null and not visible;
    friends := friends || jsonb_build_array(jsonb_build_object(
      'user_id', rec.other_id,
      'name', coalesce(public.first_name_of(rec.other_id), 'Someone'),
      'online', online,
      'in_voice', online and coalesce(voice, false),
      'room_hidden', hidden,
      'room_slug', case when visible then slug else null end,
      'room_name', case when visible then rname else null end
    ));
  end loop;

  return jsonb_build_object(
    'code', code,
    'incoming', incoming,
    'outgoing', outgoing,
    'invites', invites,
    'friends', friends
  );
end;
$$;


-- Name: my_notifications(integer); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.my_notifications(p_limit integer DEFAULT 30) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: my_spaces(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.my_spaces() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := public._signed_in();
  rows jsonb;
begin
  select coalesce(jsonb_agg(obj order by updated_at desc), '[]'::jsonb) into rows
  from (
    select s.updated_at,
      jsonb_build_object(
        'id', s.id,
        'slug', s.slug,
        'name', s.name,
        'about', s.about,
        'icon', s.icon,
        'category', s.category,
        'visibility', s.visibility,
        'official', s.owner_id is null,
        'mine', coalesce(s.owner_id = me, false),
        'joined', true,
        'members', (select count(*)::int from public.space_members m where m.space_id = s.id),
        'questions', (select count(*)::int from public.posts p where p.space_id = s.id and p.parent_id is null)
      ) as obj
    from public.spaces s
    join public.space_members mem on mem.space_id = s.id and mem.user_id = me
    order by s.updated_at desc
    limit 80
  ) listed;
  return jsonb_build_object('spaces', rows);
end;
$$;


-- Name: my_study_days(integer, text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.my_study_days(p_days integer DEFAULT 140, p_tz text DEFAULT 'UTC'::text) RETURNS TABLE(day date, seconds integer, actions integer)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  with tz as (
    select case when exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz) then p_tz else 'UTC' end as name
  ), since as (
    select now() - make_interval(days => least(greatest(p_days, 7), 400)) as at
  ), acts as (
    select (created_at at time zone (select name from tz))::date as d from public.messages where role = 'user' and created_at > (select at from since)
    union all select (created_at at time zone (select name from tz))::date from public.highlights where created_at > (select at from since)
    union all select (created_at at time zone (select name from tz))::date from public.exam_attempts where created_at > (select at from since)
    union all select (last_reviewed_at at time zone (select name from tz))::date from public.review_items where last_reviewed_at > (select at from since)
  ), days as (
    select d, count(*)::int as n from acts group by d
  )
  select coalesce(s.day, a.d) as day, coalesce(s.seconds, 0) as seconds, coalesce(a.n, 0) as actions
  from (select day, seconds from public.study_days where day > ((select at from since) at time zone (select name from tz))::date) s
  full join days a on a.d = s.day
  order by 1;
$$;


-- Name: note_pack_lineage(uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.note_pack_lineage(p_session uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
$_$;


-- Name: owns_session(uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.owns_session(p_session uuid) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select exists (
    select 1 from public.study_sessions s
    where s.id = p_session and s.user_id = (select auth.uid())
  );
$$;


-- Name: page_snippets(uuid, integer); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.page_snippets(p_document_id uuid, p_chars integer DEFAULT 160) RETURNS TABLE(page_number integer, snippet text)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select p.page_number, left(regexp_replace(p.content, '\s+', ' ', 'g'), greatest(20, least(p_chars, 600)))
  from public.document_pages p
  where p.document_id = p_document_id
  order by p.page_number;
$$;


-- Name: pin_to_answer(uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.pin_to_answer(p_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: public_roadmaps(integer); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.public_roadmaps(p_limit integer) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  lim int := least(greatest(coalesce(p_limit, 24), 1), 60);
  rows jsonb;
begin
  if to_regclass('public.packs') is null then
    return jsonb_build_object('error', 'Roadmaps share a study pack. Run migration 0024, then 0027.');
  end if;
  execute $q$
    select coalesce(jsonb_agg(obj order by updated_at desc), '[]'::jsonb)
    from (
      select updated_at,
        jsonb_build_object(
          'slug', slug,
          'kind', kind,
          'title', title,
          'description', description,
          'author_name', author_name,
          'sources', coalesce(jsonb_array_length(content->'sources'), 0),
          'topics', coalesce(jsonb_array_length(content->'topics'), 0),
          'copies', copies,
          'days', case when (content->'plan'->>'days') ~ '^[0-9]+$' then (content->'plan'->>'days')::int else null end,
          'minutes', case when (content->'plan'->>'minutes_per_day') ~ '^[0-9]+$' then (content->'plan'->>'minutes_per_day')::int else null end,
          'goal', content->'plan'->>'goal_title'
        ) as obj
      from public.packs
      where visibility = 'public'
        and content->>'roadmap' = 'true'
        and jsonb_typeof(content->'plan') = 'object'
      order by updated_at desc nulls last
      limit $1
    ) listed
  $q$ using lim into rows;
  return rows;
exception
  when undefined_table or undefined_column then
    return jsonb_build_object('error', 'Roadmaps share a study pack. Run migration 0024, then 0027.');
end;
$_$;


-- Name: read_notifications(uuid[]); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.read_notifications(p_ids uuid[] DEFAULT NULL::uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := public._signed_in();
begin
  update public.notifications set read_at = now()
  where user_id = me and read_at is null and (p_ids is null or id = any (p_ids));
  return jsonb_build_object('unread', (select count(*)::int from public.notifications n where n.user_id = me and n.read_at is null));
end;
$$;


-- Name: reminder_batch(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.reminder_batch() RETURNS TABLE(user_id uuid, email text, name text, due integer, email_ok boolean, push_ok boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select u.id, u.email::text, p.full_name, d.due::int, p.email_reminders, p.push_reminders
  from (
    select r.user_id, count(*) as due, max(r.last_reviewed_at) as last_review
    from public.review_items r
    where not r.suspended and r.due_at <= now()
    group by r.user_id
    having count(*) >= 3
  ) d
  join auth.users u on u.id = d.user_id
  join public.profiles p on p.id = d.user_id
  where (p.email_reminders or p.push_reminders)
    and (d.last_review is null or d.last_review < now() - interval '36 hours')
    and not exists (select 1 from public.notification_log l where l.user_id = d.user_id and l.kind = 'reminder' and l.sent_at > now() - interval '3 days');
$$;


-- Name: remove_friend(uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.remove_friend(p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := public._signed_in();
  n int;
begin
  if p_user_id is null or p_user_id = me then
    raise exception 'No such friend.';
  end if;
  delete from public.friendships
  where status = 'accepted'
    and ((requester_id = me and addressee_id = p_user_id) or (requester_id = p_user_id and addressee_id = me));
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'No such friend.';
  end if;
  delete from public.room_friend_invites
  where (from_id = me and to_id = p_user_id) or (from_id = p_user_id and to_id = me);
end;
$$;


-- Name: reply_thread(uuid, text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.reply_thread(p_id uuid, p_body text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := public._signed_in();
  clean_body text := btrim(coalesce(p_body, ''));
  sid uuid;
  parent uuid;
  vis text;
  new_id uuid;
begin
  if char_length(clean_body) < 1 or char_length(clean_body) > 8000 then
    raise exception 'Write a reply, up to 8,000 characters.';
  end if;
  select p.id, p.space_id into parent, sid
  from public.posts p
  where p.id = p_id and p.parent_id is null;
  if not found then
    return jsonb_build_object('error', 'That question is gone.');
  end if;
  if sid is not null then
    select s.visibility into vis from public.spaces s where s.id = sid;
    if vis = 'public' then
      insert into public.space_members (space_id, user_id) values (sid, me) on conflict do nothing;
    elsif not public._in_space(sid, me) then
      return jsonb_build_object('error', 'Join the space before replying.');
    end if;
  end if;
  perform public._community_hit(me);
  insert into public.posts (author_id, space_id, parent_id, title, body)
  values (me, sid, parent, null, clean_body)
  returning posts.id into new_id;
  update public.posts set activity_at = now() where id = parent;
  return jsonb_build_object('id', new_id);
end;
$$;


-- Name: report_error(text, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.report_error(p_source text, p_message text, p_stack text DEFAULT NULL::text, p_path text DEFAULT NULL::text, p_digest text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  msg text := left(trim(both from coalesce(p_message, '')), 1000);
  fp text;
begin
  if p_source not in ('client', 'server') or msg = '' then
    return;
  end if;
  -- Group by message with ids and numbers blanked out.
  fp := md5(p_source || ':' || regexp_replace(left(msg, 300), '[0-9a-f]{8}-[0-9a-f-]{27}|[0-9]+', '#', 'gi'));
  -- Throttle: 20 copies of one error a minute, 1,000 errors in 10 minutes overall.
  if (select count(*) from public.app_errors where fingerprint = fp and created_at > now() - interval '1 minute') >= 20
     or (select count(*) from public.app_errors where created_at > now() - interval '10 minutes') >= 1000 then
    return;
  end if;
  insert into public.app_errors (user_id, source, fingerprint, message, stack, path, digest, user_agent)
  values (auth.uid(), p_source, fp, msg, left(p_stack, 4000), left(p_path, 300), left(p_digest, 100), left(p_user_agent, 300));
end;
$$;


-- Name: report_post(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.report_post(p_id uuid, p_reason text, p_note text DEFAULT ''::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: request_friend(text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.request_friend(p_query text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := public._signed_in();
  q text := lower(btrim(coalesce(p_query, '')));
  them uuid;
  rec public.friendships;
  hits bigint;
begin
  if length(q) = 0 or length(q) > 200 then
    raise exception 'Enter a friend code or an email.';
  end if;

  delete from public.friend_request_hits
  where user_id = me and created_at < now() - interval '2 days';

  select count(*) into hits
  from public.friend_request_hits
  where user_id = me and created_at > now() - interval '1 day';
  if hits >= 30 then
    raise exception 'Too many friend requests today. Try again tomorrow.';
  end if;
  insert into public.friend_request_hits (user_id) values (me);

  if position('@' in q) > 0 then
    select id into them from auth.users where lower(email) = q limit 1;
  else
    q := regexp_replace(q, '[^a-z0-9]', '', 'g');
    if length(q) < 6 then
      -- Returned, not raised, so the attempt above is kept and counts toward the daily cap.
      return jsonb_build_object('error', 'Enter a friend code or an email.');
    end if;
    select id into them from public.profiles where friend_code = q;
  end if;

  -- These are ordinary answers, not errors: raising would undo the attempt we just stored,
  -- and then a code or email could be tried without limit.
  if them is null then
    return jsonb_build_object('error', 'No one found with that code or email.');
  end if;
  if them = me then
    return jsonb_build_object('error', 'That''s you.');
  end if;

  perform pg_advisory_xact_lock(hashtext(least(me::text, them::text)), hashtext(greatest(me::text, them::text)));

  select * into rec from public.friendships
  where (requester_id = me and addressee_id = them)
     or (requester_id = them and addressee_id = me);

  if found then
    if rec.status = 'accepted' then
      return jsonb_build_object('error', 'You''re already friends.');
    end if;
    if rec.requester_id = them then
      update public.friendships set status = 'accepted' where id = rec.id;
      return jsonb_build_object('name', coalesce(public.first_name_of(them), 'Someone'), 'status', 'accepted');
    end if;
    return jsonb_build_object('error', 'Request already sent.');
  end if;

  insert into public.friendships (requester_id, addressee_id, status)
  values (me, them, 'pending');
  return jsonb_build_object('name', coalesce(public.first_name_of(them), 'Someone'), 'status', 'pending');
end;
$$;


-- Name: respond_friend(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.respond_friend(p_id uuid, p_accept boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := public._signed_in();
  rec public.friendships;
begin
  select * into rec from public.friendships
  where id = p_id and addressee_id = me and status = 'pending';
  if not found then
    raise exception 'That request isn''t waiting on you.';
  end if;
  if p_accept then
    update public.friendships set status = 'accepted' where id = rec.id;
  else
    delete from public.friendships where id = rec.id;
  end if;
end;
$$;


-- Name: review_answer(uuid, text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.review_answer(p_item uuid, p_rating text) RETURNS timestamp with time zone
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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


-- Name: review_from_highlight(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.review_from_highlight() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: review_from_memory(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.review_from_memory() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: review_from_topic(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.review_from_topic() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: review_interval_days(integer); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.review_interval_days(step integer) RETURNS integer
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
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


-- Name: revoke_room_invite(text, uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.revoke_room_invite(p_slug text, p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := public._signed_in();
begin
  perform public._private_room_for_member(p_slug);
  delete from public.room_friend_invites where room_slug = p_slug and to_id = p_user_id;
end;
$$;


-- Name: roll_miss_map(uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.roll_miss_map(p_session uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
$_$;


-- Name: roll_section_crib(uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.roll_section_crib(p_session uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
$_$;


-- Name: roll_section_wrapped(uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.roll_section_wrapped(p_session uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
$_$;


-- Name: room_friends(text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.room_friends(p_slug text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := public._signed_in();
  friends jsonb := '[]'::jsonb;
  rec record;
  seen timestamptz;
  voice boolean;
begin
  perform public._private_room_for_member(p_slug);
  for rec in
    select case when f.requester_id = me then f.addressee_id else f.requester_id end as other_id
    from public.friendships f
    where f.status = 'accepted' and (f.requester_id = me or f.addressee_id = me)
    order by public.first_name_of(case when f.requester_id = me then f.addressee_id else f.requester_id end)
    limit 200
  loop
    seen := null;
    voice := false;
    select updated_at, in_voice into seen, voice
    from public.friend_presence
    where user_id = rec.other_id;
    friends := friends || jsonb_build_array(jsonb_build_object(
      'user_id', rec.other_id,
      'name', coalesce(public.first_name_of(rec.other_id), 'Someone'),
      'online', seen is not null and seen > now() - interval '90 seconds',
      'in_voice', seen is not null and seen > now() - interval '90 seconds' and coalesce(voice, false),
      'invited', exists (
        select 1 from public.room_friend_invites where room_slug = p_slug and to_id = rec.other_id
      )
    ));
  end loop;
  return jsonb_build_object('friends', friends);
end;
$$;


-- Name: rotate_calendar_token(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.rotate_calendar_token() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  t text := md5(gen_random_uuid()::text || clock_timestamp()::text);
begin
  update public.profiles set calendar_token = t where id = auth.uid();
  return t;
end;
$$;


-- Name: save_page_pin(uuid, uuid, integer, text, text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.save_page_pin(p_session uuid, p_document uuid, p_page integer, p_quote text, p_question text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: save_section_lines(uuid, text[]); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.save_section_lines(p_session uuid, p_lines text[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: save_sitting(uuid, numeric, integer, integer, text[], boolean); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.save_sitting(p_session uuid, p_score numeric, p_out_of integer, p_minutes integer, p_topics text[], p_show_name boolean) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: search_pages(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.search_pages(p_document_id uuid, p_query text, p_limit integer DEFAULT 4) RETURNS TABLE(page_number integer, content text, rank real)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
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


-- Name: search_session_pages(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.search_session_pages(p_session_id uuid, p_query text, p_limit integer DEFAULT 5) RETURNS TABLE(document_id uuid, page_number integer, content text, rank real)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
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


-- Name: section_scope(text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.section_scope(p_slug text) RETURNS text[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: set_course_code(uuid, text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.set_course_code(p_session uuid, p_code text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
$_$;


-- Name: set_feedback_status(bigint, text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.set_feedback_status(p_id bigint, p_status text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can triage feedback';
  end if;
  if p_status not in ('new', 'seen', 'done') then
    raise exception 'Unknown status';
  end if;
  update public.feedback set status = p_status where id = p_id;
end;
$$;


-- Name: set_friend_presence(text, boolean); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.set_friend_presence(p_slug text, p_voice boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  me uuid := public._signed_in();
  slug text := nullif(btrim(coalesce(p_slug, '')), '');
  state jsonb;
  room_name text;
  room_private boolean := false;
  voice boolean := false;
begin
  if slug is not null and length(slug) <= 80 and slug ~ '^[A-Za-z0-9_-]+$' then
    state := public._room_snapshot(slug);
    if public._in_room(state) then
      room_name := left(coalesce(nullif(btrim(state->>'name'), ''), 'Study room'), 80);
      room_private := coalesce((state->>'is_public')::boolean, true) = false;
      voice := coalesce(p_voice, false) and room_private;
    else
      slug := null;
    end if;
  else
    slug := null;
  end if;

  insert into public.friend_presence (user_id, room_slug, room_name, room_private, in_voice, updated_at)
  values (me, slug, room_name, room_private, voice, now())
  on conflict (user_id) do update set
    room_slug = excluded.room_slug,
    room_name = excluded.room_name,
    room_private = excluded.room_private,
    in_voice = excluded.in_voice,
    updated_at = now();
end;
$_$;


-- Name: set_noticeboard_plan(text, jsonb); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.set_noticeboard_plan(p_code text, p_plan jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: set_pin_answer(uuid, text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.set_pin_answer(p_id uuid, p_answer text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- Name: space_state(text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.space_state(p_slug text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := public._signed_in();
  s public.spaces;
  joined boolean;
  threads jsonb := '[]'::jsonb;
begin
  if not public._space_slug_ok(p_slug) then
    return jsonb_build_object('error', 'No space with that link.');
  end if;
  select * into s from public.spaces sp where sp.slug = p_slug;
  if not found then
    return jsonb_build_object('error', 'No space with that link.');
  end if;
  joined := public._in_space(s.id, me);
  if joined then
    threads := coalesce(public.list_threads(s.id) -> 'threads', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'id', s.id,
    'slug', s.slug,
    'name', s.name,
    'about', s.about,
    'icon', s.icon,
    'category', s.category,
    'visibility', s.visibility,
    'official', s.owner_id is null,
    'mine', coalesce(s.owner_id = me, false),
    'joined', joined,
    'members', (select count(*)::int from public.space_members m where m.space_id = s.id),
    'questions', (select count(*)::int from public.posts p where p.space_id = s.id and p.parent_id is null),
    'threads', threads
  );
end;
$$;


-- Name: store_section_paper(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.store_section_paper(p_session uuid, p_questions jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: take_s2_slot(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.take_s2_slot() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  slot timestamptz;
  wait_ms int;
begin
  select greatest(next_at, clock_timestamp()) into slot
  from public.rate_slots where name = 'semantic_scholar'
  for update;
  if slot is null then
    return 0;
  end if;
  wait_ms := ceil(extract(epoch from (slot - clock_timestamp())) * 1000);
  if wait_ms > 15000 then
    return -1;
  end if;
  update public.rate_slots set next_at = slot + interval '1100 milliseconds' where name = 'semantic_scholar';
  return greatest(wait_ms, 0);
end;
$$;


-- Name: toggle_vote(uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.toggle_vote(p_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  me uuid := public._signed_in();
  author uuid;
  sid uuid;
  on_now boolean;
begin
  select p.author_id, p.space_id into author, sid from public.posts p where p.id = p_id;
  if not found then
    return jsonb_build_object('error', 'That post is gone.');
  end if;
  if not public._space_open(sid, me) then
    return jsonb_build_object('error', 'Join the space first.');
  end if;
  if author = me then
    return jsonb_build_object('error', 'You can''t vote on your own post.');
  end if;
  delete from public.post_votes where post_id = p_id and user_id = me;
  if found then
    on_now := false;
  else
    insert into public.post_votes (post_id, user_id) values (p_id, me);
    on_now := true;
  end if;
  return jsonb_build_object(
    'voted', on_now,
    'votes', (select count(*)::int from public.post_votes v where v.post_id = p_id)
  );
end;
$$;


-- Name: touch_session(); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.touch_session() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  update public.study_sessions set updated_at = now() where id = new.session_id;
  return new;
end;
$$;


-- Name: track_events(jsonb, text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.track_events(p_events jsonb, p_anon text DEFAULT NULL::text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  uid uuid := auth.uid();
  anon text := case when p_anon ~ '^[A-Za-z0-9_-]{8,64}$' then p_anon end;
  recent int;
  e jsonb;
  kept int := 0;
begin
  if jsonb_typeof(p_events) is distinct from 'array' or (uid is null and anon is null) then
    return 0;
  end if;
  -- At most 600 events per person per 10 minutes.
  select count(*) into recent from public.events
  where created_at > now() - interval '10 minutes'
    and (case when uid is not null then user_id = uid else anon_id = anon end);
  if recent > 600 then
    return 0;
  end if;
  for e in select value from jsonb_array_elements(p_events) limit 50 loop
    continue when coalesce(e ->> 'name', '') !~ '^[a-z0-9_.]{2,48}$';
    continue when uid is null and (e ->> 'name') !~ '^(page|vitals|landing|auth)\.';
    insert into public.events (user_id, anon_id, name, path, props)
    values (
      uid, anon, e ->> 'name', left(e ->> 'path', 300),
      case when jsonb_typeof(e -> 'props') = 'object' and length((e -> 'props')::text) <= 2000 then e -> 'props' else '{}'::jsonb end
    );
    kept := kept + 1;
  end loop;
  return kept;
end;
$_$;


-- Name: use_trial(text); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.use_trial(kind text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  ok boolean;
begin
  if auth.uid() is null then
    return false;
  end if;
  if kind = 'page' then
    update public.profiles set trial_pages_used = trial_pages_used + 1
    where id = auth.uid() and role is null and trial_pages_used < 20
    returning true into ok;
  else
    update public.profiles set trial_prompts_used = trial_prompts_used + 1
    where id = auth.uid() and role is null and trial_prompts_used < 10
    returning true into ok;
  end if;
  return coalesce(ok, false);
end;
$$;


-- Name: withdraw_section_paper(uuid); Type: FUNCTION; Schema: public; Owner: -

CREATE FUNCTION public.withdraw_section_paper(p_session uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


-- Name: ai_keys; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.ai_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    session_id uuid,
    ciphertext text NOT NULL,
    iv text NOT NULL,
    auth_tag text NOT NULL,
    last4 text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    provider text DEFAULT 'groq'::text NOT NULL,
    base_url text,
    chat_model text,
    fast_model text,
    vision_model text,
    via text DEFAULT 'key'::text NOT NULL,
    CONSTRAINT ai_keys_base_url_check CHECK (((base_url IS NULL) OR ((provider = 'custom'::text) AND (char_length(base_url) <= 300)))),
    CONSTRAINT ai_keys_last4_check CHECK ((char_length(last4) <= 4)),
    CONSTRAINT ai_keys_models_check CHECK (((COALESCE(char_length(chat_model), 0) <= 200) AND (COALESCE(char_length(fast_model), 0) <= 200) AND (COALESCE(char_length(vision_model), 0) <= 200))),
    CONSTRAINT ai_keys_provider_check CHECK ((provider = ANY (ARRAY['groq'::text, 'openai'::text, 'anthropic'::text, 'gemini'::text, 'openrouter'::text, 'custom'::text]))),
    CONSTRAINT ai_keys_via_check CHECK ((via = ANY (ARRAY['key'::text, 'oauth'::text])))
);


-- Name: TABLE ai_keys; Type: COMMENT; Schema: public; Owner: -

COMMENT ON TABLE public.ai_keys IS 'Each account''s own AI: an API key for a provider, or an OpenRouter connection, encrypted by the server (AES-256-GCM). session_id NULL is the account key; otherwise an override for one session.';


-- Name: ai_quota; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.ai_quota (
    user_id uuid DEFAULT auth.uid() NOT NULL,
    key_ref text NOT NULL,
    model text NOT NULL,
    requests_limit integer,
    requests_remaining integer,
    requests_reset_at timestamp with time zone,
    tokens_limit integer,
    tokens_remaining integer,
    daily_tokens_limit integer,
    daily_limit_hit_at timestamp with time zone,
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    last_success_at timestamp with time zone,
    daily_used_at_hit integer
);


-- Name: ai_usage; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.ai_usage (
    id bigint NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    session_id uuid,
    key_ref text NOT NULL,
    model text NOT NULL,
    feature text NOT NULL,
    prompt_tokens integer DEFAULT 0 NOT NULL,
    completion_tokens integer DEFAULT 0 NOT NULL,
    total_tokens integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


-- Name: ai_usage_id_seq; Type: SEQUENCE; Schema: public; Owner: -

ALTER TABLE public.ai_usage ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ai_usage_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


-- Name: answer_feedback; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.answer_feedback (
    id bigint NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    session_id uuid,
    rating text,
    comment text,
    correction text,
    answer text NOT NULL,
    path text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT answer_feedback_answer_check CHECK (((char_length(answer) >= 1) AND (char_length(answer) <= 8000))),
    CONSTRAINT answer_feedback_comment_check CHECK (((comment IS NULL) OR ((char_length(comment) >= 1) AND (char_length(comment) <= 2000)))),
    CONSTRAINT answer_feedback_correction_check CHECK (((correction IS NULL) OR ((char_length(correction) >= 1) AND (char_length(correction) <= 4000)))),
    CONSTRAINT answer_feedback_has_signal CHECK (((rating IS NOT NULL) OR (comment IS NOT NULL) OR (correction IS NOT NULL))),
    CONSTRAINT answer_feedback_path_check CHECK (((path IS NULL) OR (char_length(path) <= 300))),
    CONSTRAINT answer_feedback_rating_check CHECK ((rating = ANY (ARRAY['up'::text, 'down'::text])))
);


-- Name: answer_feedback_id_seq; Type: SEQUENCE; Schema: public; Owner: -

ALTER TABLE public.answer_feedback ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.answer_feedback_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


-- Name: app_errors; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.app_errors (
    id bigint NOT NULL,
    user_id uuid,
    source text NOT NULL,
    fingerprint text NOT NULL,
    message text NOT NULL,
    stack text,
    path text,
    digest text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_errors_source_check CHECK ((source = ANY (ARRAY['client'::text, 'server'::text])))
);


-- Name: app_errors_id_seq; Type: SEQUENCE; Schema: public; Owner: -

ALTER TABLE public.app_errors ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.app_errors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


-- Name: community_hits; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.community_hits (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


-- Name: community_hits_id_seq; Type: SEQUENCE; Schema: public; Owner: -

ALTER TABLE public.community_hits ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.community_hits_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


-- Name: course_requests; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.course_requests (
    code text NOT NULL,
    day date NOT NULL,
    requests integer DEFAULT 0 NOT NULL,
    CONSTRAINT course_requests_code CHECK ((code ~ '^[a-z0-9]{4,10}$'::text)),
    CONSTRAINT course_requests_count CHECK (((requests >= 0) AND (requests <= 400)))
);


-- Name: cribs; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.cribs (
    token text NOT NULL,
    map_token text NOT NULL,
    pack_slug text NOT NULL,
    owner_id uuid NOT NULL,
    course_code text,
    objectives jsonb DEFAULT '[]'::jsonb NOT NULL,
    concepts jsonb DEFAULT '[]'::jsonb NOT NULL,
    pages jsonb DEFAULT '[]'::jsonb NOT NULL,
    openstax boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cribs_token CHECK ((token ~ '^[0-9a-f]{32}$'::text))
);


-- Name: document_pages; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.document_pages (
    document_id uuid NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    page_number integer NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    fts tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, content)) STORED,
    CONSTRAINT document_pages_page_number_check CHECK ((page_number > 0))
);


-- Name: documents; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    title text NOT NULL,
    storage_path text,
    page_count integer DEFAULT 0 NOT NULL,
    outline jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'processing'::text NOT NULL,
    last_page integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    session_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    source_url text,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT documents_status_check CHECK ((status = ANY (ARRAY['processing'::text, 'ready'::text, 'failed'::text])))
);


-- Name: events; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.events (
    id bigint NOT NULL,
    user_id uuid,
    anon_id text,
    name text NOT NULL,
    path text,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT events_name_check CHECK ((name ~ '^[a-z0-9_.]{2,48}$'::text))
);


-- Name: events_id_seq; Type: SEQUENCE; Schema: public; Owner: -

ALTER TABLE public.events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


-- Name: exam_attempts; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.exam_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    session_id uuid NOT NULL,
    document_id uuid,
    page_number integer,
    topic text NOT NULL,
    question text NOT NULL,
    kind text NOT NULL,
    score real NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT exam_attempts_kind_check CHECK ((kind = ANY (ARRAY['mcq'::text, 'short'::text]))),
    CONSTRAINT exam_attempts_score_check CHECK (((score >= (0)::double precision) AND (score <= (1)::double precision)))
);


-- Name: explain_backs; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.explain_backs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    session_id uuid NOT NULL,
    document_id uuid,
    page_number integer,
    topic text DEFAULT ''::text NOT NULL,
    score numeric NOT NULL,
    gap text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT explain_backs_gap CHECK (((char_length(gap) >= 1) AND (char_length(gap) <= 500))),
    CONSTRAINT explain_backs_score CHECK ((score = ANY (ARRAY[(0)::numeric, 0.5, (1)::numeric]))),
    CONSTRAINT explain_backs_topic CHECK ((char_length(topic) <= 200))
);


-- Name: feedback; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.feedback (
    id bigint NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    kind text NOT NULL,
    message text NOT NULL,
    path text,
    user_agent text,
    status text DEFAULT 'new'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT feedback_kind_check CHECK ((kind = ANY (ARRAY['bug'::text, 'idea'::text, 'confusing'::text, 'love'::text]))),
    CONSTRAINT feedback_message_check CHECK (((char_length(message) >= 1) AND (char_length(message) <= 4000))),
    CONSTRAINT feedback_path_check CHECK ((char_length(path) <= 300)),
    CONSTRAINT feedback_status_check CHECK ((status = ANY (ARRAY['new'::text, 'seen'::text, 'done'::text]))),
    CONSTRAINT feedback_user_agent_check CHECK ((char_length(user_agent) <= 300))
);


-- Name: feedback_id_seq; Type: SEQUENCE; Schema: public; Owner: -

ALTER TABLE public.feedback ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.feedback_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


-- Name: friend_presence; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.friend_presence (
    user_id uuid NOT NULL,
    room_slug text,
    room_name text,
    room_private boolean DEFAULT false NOT NULL,
    in_voice boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


-- Name: friend_request_hits; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.friend_request_hits (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


-- Name: friend_request_hits_id_seq; Type: SEQUENCE; Schema: public; Owner: -

ALTER TABLE public.friend_request_hits ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.friend_request_hits_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


-- Name: friendships; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.friendships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    requester_id uuid NOT NULL,
    addressee_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT friendships_distinct CHECK ((requester_id <> addressee_id)),
    CONSTRAINT friendships_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text])))
);


-- Name: highlights; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.highlights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    document_id uuid NOT NULL,
    kind text NOT NULL,
    page_number integer NOT NULL,
    color text DEFAULT 'yellow'::text NOT NULL,
    selected_text text,
    rects jsonb DEFAULT '[]'::jsonb NOT NULL,
    image_path text,
    vlm_description text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT highlights_kind_check CHECK ((kind = ANY (ARRAY['text'::text, 'region'::text])))
);


-- Name: learner_memory; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.learner_memory (
    user_id uuid DEFAULT auth.uid() NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    understood text[] DEFAULT '{}'::text[] NOT NULL,
    struggling text[] DEFAULT '{}'::text[] NOT NULL,
    misconceptions text[] DEFAULT '{}'::text[] NOT NULL,
    open_questions text[] DEFAULT '{}'::text[] NOT NULL,
    explained text[] DEFAULT '{}'::text[] NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    session_id uuid NOT NULL
);


-- Name: library_hours; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.library_hours (
    token text NOT NULL,
    owner_id uuid NOT NULL,
    pack_slug text,
    course_code text,
    room_slug text,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    place text NOT NULL,
    topic text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT library_hours_room CHECK (((room_slug IS NULL) OR ((char_length(room_slug) >= 1) AND (char_length(room_slug) <= 80)))),
    CONSTRAINT library_hours_span CHECK (((ends_at > starts_at) AND (ends_at < (starts_at + '04:00:00'::interval)))),
    CONSTRAINT library_hours_text CHECK ((((char_length(btrim(place)) >= 1) AND (char_length(btrim(place)) <= 80)) AND ((char_length(btrim(topic)) >= 1) AND (char_length(btrim(topic)) <= 80)))),
    CONSTRAINT library_hours_token CHECK ((token ~ '^[0-9a-f]{32}$'::text))
);


-- Name: messages; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    document_id uuid,
    topic_id uuid,
    highlight_id uuid,
    role text NOT NULL,
    action text DEFAULT 'chat'::text NOT NULL,
    content text NOT NULL,
    page_number integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    session_id uuid NOT NULL,
    CONSTRAINT messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
);


-- Name: miss_maps; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.miss_maps (
    token text NOT NULL,
    pack_slug text NOT NULL,
    owner_id uuid NOT NULL,
    exam_date date,
    users integer NOT NULL,
    topics jsonb NOT NULL,
    band text,
    revise jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT miss_maps_token CHECK ((token ~ '^[0-9a-f]{32}$'::text)),
    CONSTRAINT miss_maps_users CHECK ((users >= 8))
);


-- Name: noticeboards; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.noticeboards (
    code text NOT NULL,
    owner_id uuid NOT NULL,
    title text NOT NULL,
    kind text NOT NULL,
    items jsonb NOT NULL,
    plan jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT noticeboards_code CHECK ((code ~ '^[a-z0-9]{4,10}$'::text)),
    CONSTRAINT noticeboards_items CHECK (((jsonb_typeof(items) = 'array'::text) AND ((jsonb_array_length(items) >= 1) AND (jsonb_array_length(items) <= 12)))),
    CONSTRAINT noticeboards_kind CHECK ((kind = ANY (ARRAY['study'::text, 'exam'::text, 'paper'::text]))),
    CONSTRAINT noticeboards_title CHECK (((char_length(title) >= 1) AND (char_length(title) <= 120)))
);


-- Name: notification_log; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.notification_log (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL
);


-- Name: notification_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -

ALTER TABLE public.notification_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.notification_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


-- Name: notifications; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    actor_id uuid,
    title text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    url text DEFAULT ''::text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notifications_kind CHECK ((kind = ANY (ARRAY['friend_request'::text, 'friend_accepted'::text, 'room_invite'::text, 'thread_reply'::text, 'reply_accepted'::text, 'post_corrected'::text, 'post_hidden'::text])))
);


-- Name: pack_lineage; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.pack_lineage (
    child_slug text NOT NULL,
    parent_slug text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pack_lineage_slugs CHECK ((((char_length(child_slug) >= 1) AND (char_length(child_slug) <= 120)) AND ((char_length(parent_slug) >= 1) AND (char_length(parent_slug) <= 120)) AND (child_slug <> parent_slug)))
);


-- Name: page_pins; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.page_pins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    session_id uuid NOT NULL,
    document_id uuid NOT NULL,
    page_number integer NOT NULL,
    quote text DEFAULT ''::text NOT NULL,
    question text DEFAULT ''::text NOT NULL,
    answer text,
    pack_slug text,
    doc_index integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT page_pins_has CHECK (((char_length(btrim(quote)) > 0) OR (char_length(btrim(question)) > 0))),
    CONSTRAINT page_pins_page CHECK (((page_number >= 1) AND (page_number <= 5000))),
    CONSTRAINT page_pins_text CHECK (((char_length(quote) <= 500) AND (char_length(question) <= 300) AND ((answer IS NULL) OR (char_length(answer) <= 2000))))
);


-- Name: page_time; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.page_time (
    user_id uuid DEFAULT auth.uid() NOT NULL,
    document_id uuid NOT NULL,
    page_number integer NOT NULL,
    seconds integer DEFAULT 0 NOT NULL,
    visits integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT page_time_page_number_check CHECK ((page_number > 0))
);


-- Name: paper_reviews; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.paper_reviews (
    document_id uuid NOT NULL,
    session_id uuid NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    target_pass integer DEFAULT 1 NOT NULL,
    passes_done integer DEFAULT 0 NOT NULL,
    triage_reason text DEFAULT ''::text NOT NULL,
    pass1 jsonb DEFAULT '{}'::jsonb NOT NULL,
    pass2 jsonb DEFAULT '{}'::jsonb NOT NULL,
    pass3 jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT paper_reviews_passes_done_check CHECK (((passes_done >= 0) AND (passes_done <= 3))),
    CONSTRAINT paper_reviews_target_pass_check CHECK (((target_pass >= 1) AND (target_pass <= 3)))
);


-- Name: plan_topics; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.plan_topics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_id uuid NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    "position" integer NOT NULL,
    title text NOT NULL,
    objectives text[] DEFAULT '{}'::text[] NOT NULL,
    key_concepts text[] DEFAULT '{}'::text[] NOT NULL,
    page_start integer,
    page_end integer,
    est_minutes integer DEFAULT 30 NOT NULL,
    due_date date NOT NULL,
    status text DEFAULT 'not_started'::text NOT NULL,
    mastery real DEFAULT 0 NOT NULL,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    phase integer DEFAULT 0 NOT NULL,
    source text DEFAULT 'pdf'::text NOT NULL,
    resources jsonb DEFAULT '[]'::jsonb NOT NULL,
    document_id uuid,
    CONSTRAINT plan_topics_check CHECK ((page_end >= page_start)),
    CONSTRAINT plan_topics_mastery_check CHECK (((mastery >= (0)::double precision) AND (mastery <= (1)::double precision))),
    CONSTRAINT plan_topics_pdf_pages CHECK (((source = 'external'::text) OR ((page_start IS NOT NULL) AND (page_end IS NOT NULL)))),
    CONSTRAINT plan_topics_source_check CHECK ((source = ANY (ARRAY['pdf'::text, 'external'::text]))),
    CONSTRAINT plan_topics_status_check CHECK ((status = ANY (ARRAY['not_started'::text, 'in_progress'::text, 'completed'::text])))
);


-- Name: post_reports; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.post_reports (
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    reason text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT post_reports_note_check CHECK ((char_length(note) <= 500)),
    CONSTRAINT post_reports_reason_check CHECK ((reason = ANY (ARRAY['wrong'::text, 'spam'::text, 'abuse'::text, 'other'::text])))
);


-- Name: post_votes; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.post_votes (
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


-- Name: profiles; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    role text,
    onboarded_at timestamp with time zone,
    pro_requested_at timestamp with time zone,
    heard_from text,
    occupation text,
    purpose text,
    purpose_detail text,
    trial_prompts_used integer DEFAULT 0 NOT NULL,
    trial_pages_used integer DEFAULT 0 NOT NULL,
    timezone text,
    email_digest boolean DEFAULT true NOT NULL,
    email_reminders boolean DEFAULT true NOT NULL,
    push_reminders boolean DEFAULT true NOT NULL,
    calendar_token text DEFAULT md5(((gen_random_uuid())::text || (clock_timestamp())::text)),
    friend_code text,
    CONSTRAINT profiles_role_check CHECK ((role = 'admin'::text))
);


-- Name: COLUMN profiles.role; Type: COMMENT; Schema: public; Owner: -

COMMENT ON COLUMN public.profiles.role IS 'NULL = everyone (their own AI); ''admin'' = the owner (admin dashboard, and the server''s keys when they have none of their own). Set manually.';


-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.push_subscriptions (
    id bigint NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT push_subscriptions_endpoint_check CHECK ((endpoint ~ '^https://'::text))
);


-- Name: push_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -

ALTER TABLE public.push_subscriptions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.push_subscriptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


-- Name: rate_slots; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.rate_slots (
    name text NOT NULL,
    next_at timestamp with time zone DEFAULT now() NOT NULL
);


-- Name: review_items; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.review_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    session_id uuid NOT NULL,
    document_id uuid,
    page_number integer,
    source text NOT NULL,
    source_key text NOT NULL,
    prompt text NOT NULL,
    question text DEFAULT ''::text NOT NULL,
    answer text DEFAULT ''::text NOT NULL,
    step integer DEFAULT 0 NOT NULL,
    due_at timestamp with time zone DEFAULT (now() + '1 day'::interval) NOT NULL,
    last_reviewed_at timestamp with time zone,
    reviews integer DEFAULT 0 NOT NULL,
    lapses integer DEFAULT 0 NOT NULL,
    suspended boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_items_source_check CHECK ((source = ANY (ARRAY['topic'::text, 'highlight'::text, 'asked'::text, 'misconception'::text, 'mistake'::text, 'gap'::text])))
);


-- Name: room_friend_invites; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.room_friend_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_slug text NOT NULL,
    room_name text NOT NULL,
    from_id uuid NOT NULL,
    to_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT room_friend_invites_distinct CHECK ((from_id <> to_id))
);


-- Name: saved_answers; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.saved_answers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    session_id uuid NOT NULL,
    question text,
    answer text NOT NULL,
    page_number integer,
    document_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT saved_answers_answer_check CHECK (((char_length(answer) >= 1) AND (char_length(answer) <= 12000))),
    CONSTRAINT saved_answers_question_check CHECK (((question IS NULL) OR (char_length(question) <= 2000)))
);


-- Name: section_handins; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.section_handins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    paper_id uuid NOT NULL,
    user_id uuid NOT NULL,
    session_id uuid NOT NULL,
    score integer NOT NULL,
    out_of integer DEFAULT 10 NOT NULL,
    minutes integer NOT NULL,
    topics text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT section_handins_minutes CHECK (((minutes >= 0) AND (minutes <= 30))),
    CONSTRAINT section_handins_score CHECK (((score >= 0) AND (score <= out_of) AND (out_of = 10)))
);


-- Name: section_papers; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.section_papers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    session_id uuid NOT NULL,
    pack_slug text NOT NULL,
    lines text[] DEFAULT '{}'::text[] NOT NULL,
    questions jsonb,
    withdrawn_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT section_papers_lines CHECK ((cardinality(lines) <= 8)),
    CONSTRAINT section_papers_slug CHECK (((char_length(pack_slug) >= 1) AND (char_length(pack_slug) <= 120)))
);


-- Name: section_wrapped; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.section_wrapped (
    token text NOT NULL,
    pack_slug text,
    owner_id uuid NOT NULL,
    exam_date date,
    handins integer NOT NULL,
    copies integer,
    hours integer DEFAULT 0 NOT NULL,
    topics jsonb DEFAULT '[]'::jsonb NOT NULL,
    closed jsonb DEFAULT '[]'::jsonb NOT NULL,
    course_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT section_wrapped_counts CHECK (((handins >= 0) AND (hours >= 0) AND ((copies IS NULL) OR (copies >= 0)))),
    CONSTRAINT section_wrapped_token CHECK ((token ~ '^[0-9a-f]{32}$'::text))
);


-- Name: sitting_shares; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.sitting_shares (
    token text NOT NULL,
    user_id uuid NOT NULL,
    session_id uuid NOT NULL,
    title text NOT NULL,
    score numeric NOT NULL,
    out_of integer NOT NULL,
    minutes integer NOT NULL,
    topics text[] DEFAULT '{}'::text[] NOT NULL,
    band text,
    display_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sitting_shares_range CHECK ((((out_of >= 1) AND (out_of <= 10)) AND (score >= (0)::numeric) AND (score <= (out_of)::numeric) AND ((minutes >= 0) AND (minutes <= 180)))),
    CONSTRAINT sitting_shares_token CHECK ((token ~ '^[0-9a-f]{32}$'::text))
);


-- Name: space_members; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.space_members (
    space_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


-- Name: spaces; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.spaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid,
    slug text NOT NULL,
    name text NOT NULL,
    about text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    visibility text DEFAULT 'private'::text NOT NULL,
    icon text DEFAULT ''::text NOT NULL,
    category text DEFAULT ''::text NOT NULL,
    sort integer DEFAULT 1000 NOT NULL,
    CONSTRAINT spaces_about CHECK ((char_length(about) <= 500)),
    CONSTRAINT spaces_category CHECK ((char_length(category) <= 40)),
    CONSTRAINT spaces_icon CHECK ((char_length(icon) <= 8)),
    CONSTRAINT spaces_name CHECK (((char_length(btrim(name)) >= 2) AND (char_length(btrim(name)) <= 80))),
    CONSTRAINT spaces_owner CHECK (((owner_id IS NOT NULL) OR (visibility = 'public'::text))),
    CONSTRAINT spaces_slug CHECK (((slug ~ '^s-[a-z0-9]{10}$'::text) OR (slug ~ '^[a-z][a-z0-9-]{1,38}[a-z0-9]$'::text))),
    CONSTRAINT spaces_visibility CHECK ((visibility = ANY (ARRAY['private'::text, 'public'::text])))
);


-- Name: study_days; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.study_days (
    user_id uuid DEFAULT auth.uid() NOT NULL,
    day date NOT NULL,
    seconds integer DEFAULT 0 NOT NULL
);


-- Name: study_plans; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.study_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    goal text NOT NULL,
    level text DEFAULT 'intermediate'::text NOT NULL,
    start_date date DEFAULT CURRENT_DATE NOT NULL,
    deadline date NOT NULL,
    minutes_per_day integer DEFAULT 45 NOT NULL,
    overview text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    goal_title text DEFAULT ''::text NOT NULL,
    goal_summary text DEFAULT ''::text NOT NULL,
    materials text DEFAULT ''::text NOT NULL,
    phases jsonb DEFAULT '[]'::jsonb NOT NULL,
    session_id uuid NOT NULL,
    CONSTRAINT study_plans_check CHECK ((deadline >= start_date)),
    CONSTRAINT study_plans_level_check CHECK ((level = ANY (ARRAY['beginner'::text, 'intermediate'::text, 'advanced'::text]))),
    CONSTRAINT study_plans_minutes_per_day_check CHECK (((minutes_per_day >= 5) AND (minutes_per_day <= 600)))
);


-- Name: study_sessions; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.study_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    title text DEFAULT 'Untitled session'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    kind text DEFAULT 'study'::text NOT NULL,
    research_goal text DEFAULT ''::text NOT NULL,
    exam_date date,
    archived_at timestamp with time zone,
    cite_mode boolean DEFAULT false NOT NULL,
    CONSTRAINT study_sessions_kind_check CHECK ((kind = ANY (ARRAY['study'::text, 'paper'::text, 'exam'::text]))),
    CONSTRAINT study_sessions_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 200)))
);


-- Name: ai_keys ai_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.ai_keys
    ADD CONSTRAINT ai_keys_pkey PRIMARY KEY (id);


-- Name: ai_quota ai_quota_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.ai_quota
    ADD CONSTRAINT ai_quota_pkey PRIMARY KEY (user_id, key_ref, model);


-- Name: ai_usage ai_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_pkey PRIMARY KEY (id);


-- Name: answer_feedback answer_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.answer_feedback
    ADD CONSTRAINT answer_feedback_pkey PRIMARY KEY (id);


-- Name: app_errors app_errors_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.app_errors
    ADD CONSTRAINT app_errors_pkey PRIMARY KEY (id);


-- Name: community_hits community_hits_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.community_hits
    ADD CONSTRAINT community_hits_pkey PRIMARY KEY (id);


-- Name: course_requests course_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.course_requests
    ADD CONSTRAINT course_requests_pkey PRIMARY KEY (code, day);


-- Name: cribs cribs_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.cribs
    ADD CONSTRAINT cribs_pkey PRIMARY KEY (token);


-- Name: document_pages document_pages_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.document_pages
    ADD CONSTRAINT document_pages_pkey PRIMARY KEY (document_id, page_number);


-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


-- Name: exam_attempts exam_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.exam_attempts
    ADD CONSTRAINT exam_attempts_pkey PRIMARY KEY (id);


-- Name: explain_backs explain_backs_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.explain_backs
    ADD CONSTRAINT explain_backs_pkey PRIMARY KEY (id);


-- Name: feedback feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_pkey PRIMARY KEY (id);


-- Name: friend_presence friend_presence_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.friend_presence
    ADD CONSTRAINT friend_presence_pkey PRIMARY KEY (user_id);


-- Name: friend_request_hits friend_request_hits_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.friend_request_hits
    ADD CONSTRAINT friend_request_hits_pkey PRIMARY KEY (id);


-- Name: friendships friendships_pair; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT friendships_pair UNIQUE (requester_id, addressee_id);


-- Name: friendships friendships_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT friendships_pkey PRIMARY KEY (id);


-- Name: highlights highlights_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.highlights
    ADD CONSTRAINT highlights_pkey PRIMARY KEY (id);


-- Name: learner_memory learner_memory_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.learner_memory
    ADD CONSTRAINT learner_memory_pkey PRIMARY KEY (session_id);


-- Name: library_hours library_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.library_hours
    ADD CONSTRAINT library_hours_pkey PRIMARY KEY (token);


-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


-- Name: miss_maps miss_maps_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.miss_maps
    ADD CONSTRAINT miss_maps_pkey PRIMARY KEY (token);


-- Name: noticeboards noticeboards_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.noticeboards
    ADD CONSTRAINT noticeboards_pkey PRIMARY KEY (code);


-- Name: notification_log notification_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.notification_log
    ADD CONSTRAINT notification_log_pkey PRIMARY KEY (id);


-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


-- Name: pack_lineage pack_lineage_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.pack_lineage
    ADD CONSTRAINT pack_lineage_pkey PRIMARY KEY (child_slug);


-- Name: page_pins page_pins_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.page_pins
    ADD CONSTRAINT page_pins_pkey PRIMARY KEY (id);


-- Name: page_time page_time_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.page_time
    ADD CONSTRAINT page_time_pkey PRIMARY KEY (user_id, document_id, page_number);


-- Name: paper_reviews paper_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.paper_reviews
    ADD CONSTRAINT paper_reviews_pkey PRIMARY KEY (document_id);


-- Name: plan_topics plan_topics_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.plan_topics
    ADD CONSTRAINT plan_topics_pkey PRIMARY KEY (id);


-- Name: plan_topics plan_topics_plan_id_position_key; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.plan_topics
    ADD CONSTRAINT plan_topics_plan_id_position_key UNIQUE (plan_id, "position");


-- Name: post_reports post_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.post_reports
    ADD CONSTRAINT post_reports_pkey PRIMARY KEY (post_id, user_id);


-- Name: post_votes post_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.post_votes
    ADD CONSTRAINT post_votes_pkey PRIMARY KEY (post_id, user_id);


-- Name: posts posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);


-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


-- Name: rate_slots rate_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.rate_slots
    ADD CONSTRAINT rate_slots_pkey PRIMARY KEY (name);


-- Name: review_items review_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.review_items
    ADD CONSTRAINT review_items_pkey PRIMARY KEY (id);


-- Name: review_items review_items_user_id_source_source_key_key; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.review_items
    ADD CONSTRAINT review_items_user_id_source_source_key_key UNIQUE (user_id, source, source_key);


-- Name: room_friend_invites room_friend_invites_once; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.room_friend_invites
    ADD CONSTRAINT room_friend_invites_once UNIQUE (room_slug, to_id);


-- Name: room_friend_invites room_friend_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.room_friend_invites
    ADD CONSTRAINT room_friend_invites_pkey PRIMARY KEY (id);


-- Name: saved_answers saved_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.saved_answers
    ADD CONSTRAINT saved_answers_pkey PRIMARY KEY (id);


-- Name: section_handins section_handins_paper_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.section_handins
    ADD CONSTRAINT section_handins_paper_id_user_id_key UNIQUE (paper_id, user_id);


-- Name: section_handins section_handins_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.section_handins
    ADD CONSTRAINT section_handins_pkey PRIMARY KEY (id);


-- Name: section_papers section_papers_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.section_papers
    ADD CONSTRAINT section_papers_pkey PRIMARY KEY (id);


-- Name: section_wrapped section_wrapped_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.section_wrapped
    ADD CONSTRAINT section_wrapped_pkey PRIMARY KEY (token);


-- Name: sitting_shares sitting_shares_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.sitting_shares
    ADD CONSTRAINT sitting_shares_pkey PRIMARY KEY (token);


-- Name: space_members space_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.space_members
    ADD CONSTRAINT space_members_pkey PRIMARY KEY (space_id, user_id);


-- Name: spaces spaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.spaces
    ADD CONSTRAINT spaces_pkey PRIMARY KEY (id);


-- Name: spaces spaces_slug_key; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.spaces
    ADD CONSTRAINT spaces_slug_key UNIQUE (slug);


-- Name: study_days study_days_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.study_days
    ADD CONSTRAINT study_days_pkey PRIMARY KEY (user_id, day);


-- Name: study_plans study_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.study_plans
    ADD CONSTRAINT study_plans_pkey PRIMARY KEY (id);


-- Name: study_plans study_plans_session_unique; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.study_plans
    ADD CONSTRAINT study_plans_session_unique UNIQUE (session_id);


-- Name: study_sessions study_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.study_sessions
    ADD CONSTRAINT study_sessions_pkey PRIMARY KEY (id);


-- Name: ai_keys_account_idx; Type: INDEX; Schema: public; Owner: -

CREATE UNIQUE INDEX ai_keys_account_idx ON public.ai_keys USING btree (user_id) WHERE (session_id IS NULL);


-- Name: ai_keys_session_idx; Type: INDEX; Schema: public; Owner: -

CREATE UNIQUE INDEX ai_keys_session_idx ON public.ai_keys USING btree (user_id, session_id) WHERE (session_id IS NOT NULL);


-- Name: ai_usage_user_time_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX ai_usage_user_time_idx ON public.ai_usage USING btree (user_id, created_at DESC);


-- Name: answer_feedback_time_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX answer_feedback_time_idx ON public.answer_feedback USING btree (created_at DESC);


-- Name: app_errors_fp_time_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX app_errors_fp_time_idx ON public.app_errors USING btree (fingerprint, created_at DESC);


-- Name: app_errors_time_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX app_errors_time_idx ON public.app_errors USING btree (created_at DESC);


-- Name: community_hits_user_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX community_hits_user_idx ON public.community_hits USING btree (user_id, created_at DESC);


-- Name: document_pages_fts_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX document_pages_fts_idx ON public.document_pages USING gin (fts);


-- Name: documents_session_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX documents_session_idx ON public.documents USING btree (session_id, "position");


-- Name: documents_user_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX documents_user_idx ON public.documents USING btree (user_id, created_at DESC);


-- Name: events_anon_time_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX events_anon_time_idx ON public.events USING btree (anon_id, created_at DESC);


-- Name: events_name_time_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX events_name_time_idx ON public.events USING btree (name, created_at DESC);


-- Name: events_time_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX events_time_idx ON public.events USING btree (created_at DESC);


-- Name: events_user_time_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX events_user_time_idx ON public.events USING btree (user_id, created_at DESC);


-- Name: exam_attempts_session_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX exam_attempts_session_idx ON public.exam_attempts USING btree (session_id, created_at DESC);


-- Name: explain_backs_user_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX explain_backs_user_idx ON public.explain_backs USING btree (user_id, created_at DESC);


-- Name: feedback_time_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX feedback_time_idx ON public.feedback USING btree (created_at DESC);


-- Name: friend_request_hits_user_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX friend_request_hits_user_idx ON public.friend_request_hits USING btree (user_id, created_at DESC);


-- Name: friendships_addressee_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX friendships_addressee_idx ON public.friendships USING btree (addressee_id);


-- Name: friendships_one_pair; Type: INDEX; Schema: public; Owner: -

CREATE UNIQUE INDEX friendships_one_pair ON public.friendships USING btree (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));


-- Name: friendships_requester_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX friendships_requester_idx ON public.friendships USING btree (requester_id);


-- Name: highlights_doc_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX highlights_doc_idx ON public.highlights USING btree (document_id, page_number);


-- Name: messages_doc_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX messages_doc_idx ON public.messages USING btree (document_id, created_at);


-- Name: messages_session_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX messages_session_idx ON public.messages USING btree (session_id, created_at);


-- Name: notification_log_user_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX notification_log_user_idx ON public.notification_log USING btree (user_id, kind, sent_at DESC);


-- Name: notifications_unread_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX notifications_unread_idx ON public.notifications USING btree (user_id) WHERE (read_at IS NULL);


-- Name: notifications_user_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX notifications_user_idx ON public.notifications USING btree (user_id, created_at DESC);


-- Name: page_pins_doc_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX page_pins_doc_idx ON public.page_pins USING btree (document_id, page_number);


-- Name: page_pins_pack_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX page_pins_pack_idx ON public.page_pins USING btree (pack_slug, doc_index, page_number) WHERE (pack_slug IS NOT NULL);


-- Name: paper_reviews_session_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX paper_reviews_session_idx ON public.paper_reviews USING btree (session_id);


-- Name: plan_topics_plan_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX plan_topics_plan_idx ON public.plan_topics USING btree (plan_id, "position");


-- Name: post_votes_user_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX post_votes_user_idx ON public.post_votes USING btree (user_id);


-- Name: posts_activity_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX posts_activity_idx ON public.posts USING btree (activity_at DESC) WHERE (parent_id IS NULL);


-- Name: posts_check_pending_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX posts_check_pending_idx ON public.posts USING btree (created_at) WHERE (check_status = ANY (ARRAY['pending'::text, 'error'::text]));


-- Name: posts_feed_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX posts_feed_idx ON public.posts USING btree (created_at DESC) WHERE ((parent_id IS NULL) AND (space_id IS NULL));


-- Name: posts_parent_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX posts_parent_idx ON public.posts USING btree (parent_id, created_at);


-- Name: posts_space_activity_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX posts_space_activity_idx ON public.posts USING btree (space_id, activity_at DESC) WHERE (parent_id IS NULL);


-- Name: posts_space_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX posts_space_idx ON public.posts USING btree (space_id, created_at DESC) WHERE (parent_id IS NULL);


-- Name: profiles_calendar_token_idx; Type: INDEX; Schema: public; Owner: -

CREATE UNIQUE INDEX profiles_calendar_token_idx ON public.profiles USING btree (calendar_token);


-- Name: profiles_friend_code_idx; Type: INDEX; Schema: public; Owner: -

CREATE UNIQUE INDEX profiles_friend_code_idx ON public.profiles USING btree (friend_code);


-- Name: review_items_due_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX review_items_due_idx ON public.review_items USING btree (user_id, due_at) WHERE (NOT suspended);


-- Name: room_friend_invites_to_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX room_friend_invites_to_idx ON public.room_friend_invites USING btree (to_id);


-- Name: saved_answers_session_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX saved_answers_session_idx ON public.saved_answers USING btree (session_id, created_at);


-- Name: section_papers_one_active; Type: INDEX; Schema: public; Owner: -

CREATE UNIQUE INDEX section_papers_one_active ON public.section_papers USING btree (pack_slug) WHERE ((questions IS NOT NULL) AND (withdrawn_at IS NULL));


-- Name: section_wrapped_one; Type: INDEX; Schema: public; Owner: -

CREATE UNIQUE INDEX section_wrapped_one ON public.section_wrapped USING btree (owner_id, pack_slug);


-- Name: space_members_user_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX space_members_user_idx ON public.space_members USING btree (user_id);


-- Name: spaces_public_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX spaces_public_idx ON public.spaces USING btree (sort, name) WHERE (visibility = 'public'::text);


-- Name: study_sessions_user_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX study_sessions_user_idx ON public.study_sessions USING btree (user_id, updated_at DESC);


-- Name: documents documents_updated_at; Type: TRIGGER; Schema: public; Owner: -

CREATE TRIGGER documents_updated_at BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- Name: friendships friendships_notify; Type: TRIGGER; Schema: public; Owner: -

CREATE TRIGGER friendships_notify AFTER INSERT OR DELETE OR UPDATE OF status ON public.friendships FOR EACH ROW EXECUTE FUNCTION public._friendship_notify();


-- Name: friendships friendships_updated_at; Type: TRIGGER; Schema: public; Owner: -

CREATE TRIGGER friendships_updated_at BEFORE UPDATE ON public.friendships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- Name: learner_memory learner_memory_updated_at; Type: TRIGGER; Schema: public; Owner: -

CREATE TRIGGER learner_memory_updated_at BEFORE UPDATE ON public.learner_memory FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- Name: messages messages_touch_session; Type: TRIGGER; Schema: public; Owner: -

CREATE TRIGGER messages_touch_session AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.touch_session();


-- Name: paper_reviews paper_reviews_updated_at; Type: TRIGGER; Schema: public; Owner: -

CREATE TRIGGER paper_reviews_updated_at BEFORE UPDATE ON public.paper_reviews FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- Name: plan_topics plan_topics_updated_at; Type: TRIGGER; Schema: public; Owner: -

CREATE TRIGGER plan_topics_updated_at BEFORE UPDATE ON public.plan_topics FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- Name: posts posts_accept_notify; Type: TRIGGER; Schema: public; Owner: -

CREATE TRIGGER posts_accept_notify AFTER UPDATE OF accepted_id ON public.posts FOR EACH ROW WHEN (((new.accepted_id IS NOT NULL) AND (new.accepted_id IS DISTINCT FROM old.accepted_id))) EXECUTE FUNCTION public._accept_notify();


-- Name: posts posts_reply_notify; Type: TRIGGER; Schema: public; Owner: -

CREATE TRIGGER posts_reply_notify AFTER INSERT ON public.posts FOR EACH ROW WHEN ((new.parent_id IS NOT NULL)) EXECUTE FUNCTION public._reply_notify();


-- Name: posts posts_updated_at; Type: TRIGGER; Schema: public; Owner: -

CREATE TRIGGER posts_updated_at BEFORE UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- Name: profiles profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- Name: highlights review_from_highlight; Type: TRIGGER; Schema: public; Owner: -

CREATE TRIGGER review_from_highlight AFTER INSERT ON public.highlights FOR EACH ROW EXECUTE FUNCTION public.review_from_highlight();


-- Name: learner_memory review_from_memory; Type: TRIGGER; Schema: public; Owner: -

CREATE TRIGGER review_from_memory AFTER INSERT OR UPDATE OF misconceptions ON public.learner_memory FOR EACH ROW EXECUTE FUNCTION public.review_from_memory();


-- Name: plan_topics review_from_topic; Type: TRIGGER; Schema: public; Owner: -

CREATE TRIGGER review_from_topic AFTER INSERT OR UPDATE OF status ON public.plan_topics FOR EACH ROW EXECUTE FUNCTION public.review_from_topic();


-- Name: room_friend_invites room_invites_notify; Type: TRIGGER; Schema: public; Owner: -

CREATE TRIGGER room_invites_notify AFTER INSERT OR DELETE OR UPDATE ON public.room_friend_invites FOR EACH ROW EXECUTE FUNCTION public._room_invite_notify();


-- Name: spaces spaces_updated_at; Type: TRIGGER; Schema: public; Owner: -

CREATE TRIGGER spaces_updated_at BEFORE UPDATE ON public.spaces FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- Name: study_plans study_plans_updated_at; Type: TRIGGER; Schema: public; Owner: -

CREATE TRIGGER study_plans_updated_at BEFORE UPDATE ON public.study_plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- Name: study_sessions study_sessions_updated_at; Type: TRIGGER; Schema: public; Owner: -

CREATE TRIGGER study_sessions_updated_at BEFORE UPDATE ON public.study_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- Name: ai_keys ai_keys_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.ai_keys
    ADD CONSTRAINT ai_keys_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.study_sessions(id) ON DELETE CASCADE;


-- Name: ai_keys ai_keys_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.ai_keys
    ADD CONSTRAINT ai_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: ai_quota ai_quota_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.ai_quota
    ADD CONSTRAINT ai_quota_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: ai_usage ai_usage_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.study_sessions(id) ON DELETE SET NULL;


-- Name: ai_usage ai_usage_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: answer_feedback answer_feedback_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.answer_feedback
    ADD CONSTRAINT answer_feedback_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.study_sessions(id) ON DELETE SET NULL;


-- Name: answer_feedback answer_feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.answer_feedback
    ADD CONSTRAINT answer_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: app_errors app_errors_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.app_errors
    ADD CONSTRAINT app_errors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


-- Name: community_hits community_hits_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.community_hits
    ADD CONSTRAINT community_hits_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: cribs cribs_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.cribs
    ADD CONSTRAINT cribs_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: document_pages document_pages_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.document_pages
    ADD CONSTRAINT document_pages_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


-- Name: document_pages document_pages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.document_pages
    ADD CONSTRAINT document_pages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: documents documents_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.study_sessions(id) ON DELETE CASCADE;


-- Name: documents documents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: events events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: exam_attempts exam_attempts_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.exam_attempts
    ADD CONSTRAINT exam_attempts_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE SET NULL;


-- Name: exam_attempts exam_attempts_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.exam_attempts
    ADD CONSTRAINT exam_attempts_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.study_sessions(id) ON DELETE CASCADE;


-- Name: exam_attempts exam_attempts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.exam_attempts
    ADD CONSTRAINT exam_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: explain_backs explain_backs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.explain_backs
    ADD CONSTRAINT explain_backs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: feedback feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: friend_presence friend_presence_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.friend_presence
    ADD CONSTRAINT friend_presence_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: friend_request_hits friend_request_hits_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.friend_request_hits
    ADD CONSTRAINT friend_request_hits_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: friendships friendships_addressee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT friendships_addressee_id_fkey FOREIGN KEY (addressee_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: friendships friendships_requester_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.friendships
    ADD CONSTRAINT friendships_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: highlights highlights_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.highlights
    ADD CONSTRAINT highlights_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


-- Name: highlights highlights_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.highlights
    ADD CONSTRAINT highlights_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: learner_memory learner_memory_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.learner_memory
    ADD CONSTRAINT learner_memory_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.study_sessions(id) ON DELETE CASCADE;


-- Name: learner_memory learner_memory_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.learner_memory
    ADD CONSTRAINT learner_memory_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: library_hours library_hours_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.library_hours
    ADD CONSTRAINT library_hours_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: messages messages_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE SET NULL;


-- Name: messages messages_highlight_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_highlight_id_fkey FOREIGN KEY (highlight_id) REFERENCES public.highlights(id) ON DELETE SET NULL;


-- Name: messages messages_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.study_sessions(id) ON DELETE CASCADE;


-- Name: messages messages_topic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.plan_topics(id) ON DELETE SET NULL;


-- Name: messages messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: miss_maps miss_maps_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.miss_maps
    ADD CONSTRAINT miss_maps_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: noticeboards noticeboards_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.noticeboards
    ADD CONSTRAINT noticeboards_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: notification_log notification_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.notification_log
    ADD CONSTRAINT notification_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: notifications notifications_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;


-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: page_pins page_pins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.page_pins
    ADD CONSTRAINT page_pins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: page_time page_time_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.page_time
    ADD CONSTRAINT page_time_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


-- Name: page_time page_time_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.page_time
    ADD CONSTRAINT page_time_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: paper_reviews paper_reviews_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.paper_reviews
    ADD CONSTRAINT paper_reviews_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


-- Name: paper_reviews paper_reviews_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.paper_reviews
    ADD CONSTRAINT paper_reviews_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.study_sessions(id) ON DELETE CASCADE;


-- Name: paper_reviews paper_reviews_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.paper_reviews
    ADD CONSTRAINT paper_reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: plan_topics plan_topics_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.plan_topics
    ADD CONSTRAINT plan_topics_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE SET NULL;


-- Name: plan_topics plan_topics_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.plan_topics
    ADD CONSTRAINT plan_topics_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.study_plans(id) ON DELETE CASCADE;


-- Name: plan_topics plan_topics_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.plan_topics
    ADD CONSTRAINT plan_topics_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: post_reports post_reports_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.post_reports
    ADD CONSTRAINT post_reports_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


-- Name: post_reports post_reports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.post_reports
    ADD CONSTRAINT post_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: post_votes post_votes_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.post_votes
    ADD CONSTRAINT post_votes_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


-- Name: post_votes post_votes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.post_votes
    ADD CONSTRAINT post_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: posts posts_accepted_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_accepted_id_fkey FOREIGN KEY (accepted_id) REFERENCES public.posts(id) ON DELETE SET NULL;


-- Name: posts posts_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: posts posts_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.posts(id) ON DELETE CASCADE;


-- Name: posts posts_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE CASCADE;


-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: review_items review_items_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.review_items
    ADD CONSTRAINT review_items_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE SET NULL;


-- Name: review_items review_items_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.review_items
    ADD CONSTRAINT review_items_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.study_sessions(id) ON DELETE CASCADE;


-- Name: review_items review_items_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.review_items
    ADD CONSTRAINT review_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: room_friend_invites room_friend_invites_from_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.room_friend_invites
    ADD CONSTRAINT room_friend_invites_from_id_fkey FOREIGN KEY (from_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: room_friend_invites room_friend_invites_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.room_friend_invites
    ADD CONSTRAINT room_friend_invites_to_id_fkey FOREIGN KEY (to_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: saved_answers saved_answers_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.saved_answers
    ADD CONSTRAINT saved_answers_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE SET NULL;


-- Name: saved_answers saved_answers_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.saved_answers
    ADD CONSTRAINT saved_answers_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.study_sessions(id) ON DELETE CASCADE;


-- Name: saved_answers saved_answers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.saved_answers
    ADD CONSTRAINT saved_answers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: section_handins section_handins_paper_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.section_handins
    ADD CONSTRAINT section_handins_paper_id_fkey FOREIGN KEY (paper_id) REFERENCES public.section_papers(id) ON DELETE CASCADE;


-- Name: section_handins section_handins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.section_handins
    ADD CONSTRAINT section_handins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: section_papers section_papers_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.section_papers
    ADD CONSTRAINT section_papers_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: section_wrapped section_wrapped_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.section_wrapped
    ADD CONSTRAINT section_wrapped_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: sitting_shares sitting_shares_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.sitting_shares
    ADD CONSTRAINT sitting_shares_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: space_members space_members_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.space_members
    ADD CONSTRAINT space_members_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE CASCADE;


-- Name: space_members space_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.space_members
    ADD CONSTRAINT space_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: spaces spaces_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.spaces
    ADD CONSTRAINT spaces_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: study_days study_days_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.study_days
    ADD CONSTRAINT study_days_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: study_plans study_plans_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.study_plans
    ADD CONSTRAINT study_plans_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.study_sessions(id) ON DELETE CASCADE;


-- Name: study_plans study_plans_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.study_plans
    ADD CONSTRAINT study_plans_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: study_sessions study_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.study_sessions
    ADD CONSTRAINT study_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- Name: ai_keys; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.ai_keys ENABLE ROW LEVEL SECURITY;

-- Name: ai_quota; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.ai_quota ENABLE ROW LEVEL SECURITY;

-- Name: ai_usage; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

-- Name: answer_feedback; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.answer_feedback ENABLE ROW LEVEL SECURITY;

-- Name: app_errors; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.app_errors ENABLE ROW LEVEL SECURITY;

-- Name: community_hits; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.community_hits ENABLE ROW LEVEL SECURITY;

-- Name: course_requests; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.course_requests ENABLE ROW LEVEL SECURITY;

-- Name: cribs; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.cribs ENABLE ROW LEVEL SECURITY;

-- Name: document_pages; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.document_pages ENABLE ROW LEVEL SECURITY;

-- Name: documents; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Name: events; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Name: exam_attempts; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.exam_attempts ENABLE ROW LEVEL SECURITY;

-- Name: explain_backs; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.explain_backs ENABLE ROW LEVEL SECURITY;

-- Name: feedback; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Name: friend_presence; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.friend_presence ENABLE ROW LEVEL SECURITY;

-- Name: friend_request_hits; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.friend_request_hits ENABLE ROW LEVEL SECURITY;

-- Name: friendships; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

-- Name: highlights; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.highlights ENABLE ROW LEVEL SECURITY;

-- Name: learner_memory; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.learner_memory ENABLE ROW LEVEL SECURITY;

-- Name: library_hours; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.library_hours ENABLE ROW LEVEL SECURITY;

-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Name: miss_maps; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.miss_maps ENABLE ROW LEVEL SECURITY;

-- Name: noticeboards; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.noticeboards ENABLE ROW LEVEL SECURITY;

-- Name: notification_log; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Name: ai_keys own keys; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "own keys" ON public.ai_keys TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND ((session_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.study_sessions s
  WHERE ((s.id = ai_keys.session_id) AND (s.user_id = ( SELECT auth.uid() AS uid))))))));


-- Name: notifications own notifications; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "own notifications" ON public.notifications FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


-- Name: ai_quota own rows; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "own rows" ON public.ai_quota TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


-- Name: ai_usage own rows; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "own rows" ON public.ai_usage TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


-- Name: document_pages own rows; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "own rows" ON public.document_pages TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


-- Name: documents own rows; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "own rows" ON public.documents TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND public.owns_session(session_id)));


-- Name: exam_attempts own rows; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "own rows" ON public.exam_attempts TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND public.owns_session(session_id)));


-- Name: explain_backs own rows; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "own rows" ON public.explain_backs TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND public.owns_session(session_id)));


-- Name: highlights own rows; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "own rows" ON public.highlights TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


-- Name: learner_memory own rows; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "own rows" ON public.learner_memory TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND public.owns_session(session_id)));


-- Name: messages own rows; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "own rows" ON public.messages TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND public.owns_session(session_id)));


-- Name: page_time own rows; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "own rows" ON public.page_time FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


-- Name: paper_reviews own rows; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "own rows" ON public.paper_reviews TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND public.owns_session(session_id)));


-- Name: plan_topics own rows; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "own rows" ON public.plan_topics TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


-- Name: push_subscriptions own rows; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "own rows" ON public.push_subscriptions TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


-- Name: review_items own rows; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "own rows" ON public.review_items TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND public.owns_session(session_id)));


-- Name: study_days own rows; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "own rows" ON public.study_days FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


-- Name: study_plans own rows; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "own rows" ON public.study_plans TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND public.owns_session(session_id)));


-- Name: study_sessions own rows; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "own rows" ON public.study_sessions TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


-- Name: pack_lineage; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.pack_lineage ENABLE ROW LEVEL SECURITY;

-- Name: page_pins; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.page_pins ENABLE ROW LEVEL SECURITY;

-- Name: page_time; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.page_time ENABLE ROW LEVEL SECURITY;

-- Name: paper_reviews; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.paper_reviews ENABLE ROW LEVEL SECURITY;

-- Name: plan_topics; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.plan_topics ENABLE ROW LEVEL SECURITY;

-- Name: post_reports; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.post_reports ENABLE ROW LEVEL SECURITY;

-- Name: post_votes; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.post_votes ENABLE ROW LEVEL SECURITY;

-- Name: posts; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Name: rate_slots; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.rate_slots ENABLE ROW LEVEL SECURITY;

-- Name: answer_feedback read own answer feedback; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "read own answer feedback" ON public.answer_feedback FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


-- Name: events read own events; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "read own events" ON public.events FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


-- Name: feedback read own feedback; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "read own feedback" ON public.feedback FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


-- Name: profiles read own profile; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "read own profile" ON public.profiles FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = id));


-- Name: saved_answers read own saved answers; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "read own saved answers" ON public.saved_answers FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


-- Name: saved_answers remove own saved answers; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "remove own saved answers" ON public.saved_answers FOR DELETE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


-- Name: review_items; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.review_items ENABLE ROW LEVEL SECURITY;

-- Name: room_friend_invites; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.room_friend_invites ENABLE ROW LEVEL SECURITY;

-- Name: saved_answers save to own session; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "save to own session" ON public.saved_answers FOR INSERT TO authenticated WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND (EXISTS ( SELECT 1
   FROM public.study_sessions s
  WHERE ((s.id = saved_answers.session_id) AND (s.user_id = ( SELECT auth.uid() AS uid)))))));


-- Name: saved_answers; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.saved_answers ENABLE ROW LEVEL SECURITY;

-- Name: section_handins; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.section_handins ENABLE ROW LEVEL SECURITY;

-- Name: section_papers; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.section_papers ENABLE ROW LEVEL SECURITY;

-- Name: section_wrapped; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.section_wrapped ENABLE ROW LEVEL SECURITY;

-- Name: answer_feedback send own answer feedback; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "send own answer feedback" ON public.answer_feedback FOR INSERT TO authenticated WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND ((session_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.study_sessions s
  WHERE ((s.id = answer_feedback.session_id) AND (s.user_id = ( SELECT auth.uid() AS uid))))))));


-- Name: feedback send own feedback; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "send own feedback" ON public.feedback FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


-- Name: sitting_shares; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.sitting_shares ENABLE ROW LEVEL SECURITY;

-- Name: space_members; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.space_members ENABLE ROW LEVEL SECURITY;

-- Name: spaces; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.spaces ENABLE ROW LEVEL SECURITY;

-- Name: study_days; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.study_days ENABLE ROW LEVEL SECURITY;

-- Name: study_plans; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.study_plans ENABLE ROW LEVEL SECURITY;

-- Name: study_sessions; Type: ROW SECURITY; Schema: public; Owner: -

ALTER TABLE public.study_sessions ENABLE ROW LEVEL SECURITY;

-- Name: profiles update own name; Type: POLICY; Schema: public; Owner: -

CREATE POLICY "update own name" ON public.profiles FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = id)) WITH CHECK ((( SELECT auth.uid() AS uid) = id));


-- Name: FUNCTION _accept_notify(); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._accept_notify() FROM PUBLIC;


-- Name: FUNCTION _are_friends(a uuid, b uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._are_friends(a uuid, b uuid) FROM PUBLIC;


-- Name: FUNCTION _can_see_room(p_slug text, p_private boolean, p_friend uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._can_see_room(p_slug text, p_private boolean, p_friend uuid) FROM PUBLIC;


-- Name: FUNCTION _check_json(p public.posts); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._check_json(p public.posts) FROM PUBLIC;


-- Name: FUNCTION _claim_post_check(p_id uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._claim_post_check(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public._claim_post_check(p_id uuid) TO service_role;


-- Name: FUNCTION _community_hit(p_user uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._community_hit(p_user uuid) FROM PUBLIC;


-- Name: FUNCTION _ensure_friend_code(p_user uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._ensure_friend_code(p_user uuid) FROM PUBLIC;


-- Name: FUNCTION _ensure_pack_columns(); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._ensure_pack_columns() FROM PUBLIC;


-- Name: FUNCTION _friendship_notify(); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._friendship_notify() FROM PUBLIC;


-- Name: FUNCTION _in_room(state jsonb); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._in_room(state jsonb) FROM PUBLIC;


-- Name: FUNCTION _in_space(p_space uuid, p_user uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._in_space(p_space uuid, p_user uuid) FROM PUBLIC;


-- Name: FUNCTION _notify(p_user uuid, p_kind text, p_actor uuid, p_title text, p_body text, p_url text, p_data jsonb); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._notify(p_user uuid, p_kind text, p_actor uuid, p_title text, p_body text, p_url text, p_data jsonb) FROM PUBLIC;


-- Name: FUNCTION _packs_ready(); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._packs_ready() FROM PUBLIC;


-- Name: FUNCTION _pin_shares(p_session uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._pin_shares(p_session uuid) FROM PUBLIC;


-- Name: FUNCTION _post_visible(p_status text, p_author uuid, p_user uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._post_visible(p_status text, p_author uuid, p_user uuid) FROM PUBLIC;


-- Name: FUNCTION _private_room_for_member(p_slug text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._private_room_for_member(p_slug text) FROM PUBLIC;


-- Name: FUNCTION _reply_notify(); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._reply_notify() FROM PUBLIC;


-- Name: FUNCTION _room_invite_notify(); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._room_invite_notify() FROM PUBLIC;


-- Name: FUNCTION _room_snapshot(p_slug text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._room_snapshot(p_slug text) FROM PUBLIC;


-- Name: FUNCTION _save_post_check(p_id uuid, p_status text, p_incorrect real, p_rational real, p_harmful real, p_note text, p_fix text, p_model text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._save_post_check(p_id uuid, p_status text, p_incorrect real, p_rational real, p_harmful real, p_note text, p_fix text, p_model text) FROM PUBLIC;
GRANT ALL ON FUNCTION public._save_post_check(p_id uuid, p_status text, p_incorrect real, p_rational real, p_harmful real, p_note text, p_fix text, p_model text) TO service_role;


-- Name: FUNCTION _section_public(p_questions jsonb); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._section_public(p_questions jsonb) FROM PUBLIC;


-- Name: FUNCTION _section_slug(p_session uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._section_slug(p_session uuid) FROM PUBLIC;


-- Name: FUNCTION _session_pack_slug(p_session uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._session_pack_slug(p_session uuid) FROM PUBLIC;


-- Name: FUNCTION _signed_in(); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._signed_in() FROM PUBLIC;


-- Name: FUNCTION _snippet(p_text text, p_max integer); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._snippet(p_text text, p_max integer) FROM PUBLIC;


-- Name: FUNCTION _space_json(p_space uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._space_json(p_space uuid) FROM PUBLIC;


-- Name: FUNCTION _space_open(p_space uuid, p_user uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._space_open(p_space uuid, p_user uuid) FROM PUBLIC;


-- Name: FUNCTION _space_slug_ok(p_slug text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public._space_slug_ok(p_slug text) FROM PUBLIC;


-- Name: FUNCTION accept_reply(p_thread uuid, p_reply uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.accept_reply(p_thread uuid, p_reply uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.accept_reply(p_thread uuid, p_reply uuid) TO authenticated;


-- Name: FUNCTION add_page_time(p_document uuid, p_pages jsonb, p_tz text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.add_page_time(p_document uuid, p_pages jsonb, p_tz text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.add_page_time(p_document uuid, p_pages jsonb, p_tz text) TO authenticated;


-- Name: FUNCTION admin_answer_feedback(); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.admin_answer_feedback() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_answer_feedback() TO authenticated;


-- Name: FUNCTION admin_insights(p_days integer); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.admin_insights(p_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_insights(p_days integer) TO authenticated;


-- Name: FUNCTION browse_spaces(); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.browse_spaces() FROM PUBLIC;
GRANT ALL ON FUNCTION public.browse_spaces() TO authenticated;


-- Name: FUNCTION browse_threads(p_space text, p_sort text, p_query text, p_limit integer, p_offset integer); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.browse_threads(p_space text, p_sort text, p_query text, p_limit integer, p_offset integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.browse_threads(p_space text, p_sort text, p_query text, p_limit integer, p_offset integer) TO authenticated;


-- Name: FUNCTION bump_course_request(p_code text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.bump_course_request(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.bump_course_request(p_code text) TO anon;
GRANT ALL ON FUNCTION public.bump_course_request(p_code text) TO authenticated;


-- Name: FUNCTION calendar_feed(p_token text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.calendar_feed(p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.calendar_feed(p_token text) TO anon;
GRANT ALL ON FUNCTION public.calendar_feed(p_token text) TO authenticated;


-- Name: FUNCTION cancel_friend_request(p_id uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.cancel_friend_request(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_friend_request(p_id uuid) TO authenticated;


-- Name: FUNCTION confu_schema_version(); Type: ACL; Schema: public; Owner: -

GRANT ALL ON FUNCTION public.confu_schema_version() TO authenticated;


-- Name: FUNCTION course_of(p_slug text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.course_of(p_slug text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.course_of(p_slug text) TO anon;
GRANT ALL ON FUNCTION public.course_of(p_slug text) TO authenticated;


-- Name: FUNCTION course_of_session(p_session uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.course_of_session(p_session uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.course_of_session(p_session uuid) TO authenticated;


-- Name: FUNCTION course_requests_recent(p_slug text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.course_requests_recent(p_slug text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.course_requests_recent(p_slug text) TO authenticated;


-- Name: FUNCTION create_library_hour(p_session uuid, p_starts timestamp with time zone, p_ends timestamp with time zone, p_place text, p_topic text, p_room text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.create_library_hour(p_session uuid, p_starts timestamp with time zone, p_ends timestamp with time zone, p_place text, p_topic text, p_room text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_library_hour(p_session uuid, p_starts timestamp with time zone, p_ends timestamp with time zone, p_place text, p_topic text, p_room text) TO authenticated;


-- Name: FUNCTION create_noticeboard(p_title text, p_kind text, p_items jsonb); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.create_noticeboard(p_title text, p_kind text, p_items jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_noticeboard(p_title text, p_kind text, p_items jsonb) TO authenticated;


-- Name: FUNCTION create_space(p_name text, p_about text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.create_space(p_name text, p_about text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_space(p_name text, p_about text) TO authenticated;


-- Name: FUNCTION create_thread(p_title text, p_body text, p_space uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.create_thread(p_title text, p_body text, p_space uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_thread(p_title text, p_body text, p_space uuid) TO authenticated;


-- Name: FUNCTION delete_my_account(); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_my_account() TO authenticated;


-- Name: FUNCTION delete_post(p_id uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.delete_post(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_post(p_id uuid) TO authenticated;


-- Name: FUNCTION delete_space(p_slug text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.delete_space(p_slug text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_space(p_slug text) TO authenticated;


-- Name: FUNCTION digest_batch(); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.digest_batch() FROM PUBLIC;
GRANT ALL ON FUNCTION public.digest_batch() TO service_role;


-- Name: FUNCTION dismiss_room_invite(p_id uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.dismiss_room_invite(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.dismiss_room_invite(p_id uuid) TO authenticated;


-- Name: FUNCTION edit_post(p_id uuid, p_title text, p_body text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.edit_post(p_id uuid, p_title text, p_body text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.edit_post(p_id uuid, p_title text, p_body text) TO authenticated;


-- Name: FUNCTION first_name_of(p_id uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.first_name_of(p_id uuid) FROM PUBLIC;


-- Name: FUNCTION friend_notices(); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.friend_notices() FROM PUBLIC;
GRANT ALL ON FUNCTION public.friend_notices() TO authenticated;


-- Name: FUNCTION get_crib(p_token text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.get_crib(p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_crib(p_token text) TO anon;
GRANT ALL ON FUNCTION public.get_crib(p_token text) TO authenticated;


-- Name: FUNCTION get_library_hour(p_token text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.get_library_hour(p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_library_hour(p_token text) TO anon;
GRANT ALL ON FUNCTION public.get_library_hour(p_token text) TO authenticated;


-- Name: FUNCTION get_miss_map(p_token text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.get_miss_map(p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_miss_map(p_token text) TO anon;
GRANT ALL ON FUNCTION public.get_miss_map(p_token text) TO authenticated;


-- Name: FUNCTION get_noticeboard(p_code text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.get_noticeboard(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_noticeboard(p_code text) TO anon;
GRANT ALL ON FUNCTION public.get_noticeboard(p_code text) TO authenticated;


-- Name: FUNCTION get_section_paper(p_session uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.get_section_paper(p_session uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_section_paper(p_session uuid) TO authenticated;


-- Name: FUNCTION get_section_wrapped(p_token text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.get_section_wrapped(p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_section_wrapped(p_token text) TO anon;
GRANT ALL ON FUNCTION public.get_section_wrapped(p_token text) TO authenticated;


-- Name: FUNCTION get_sitting(p_token text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.get_sitting(p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_sitting(p_token text) TO anon;
GRANT ALL ON FUNCTION public.get_sitting(p_token text) TO authenticated;


-- Name: FUNCTION get_thread(p_id uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.get_thread(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_thread(p_id uuid) TO authenticated;


-- Name: FUNCTION hand_in_section_paper(p_session uuid, p_choices integer[], p_minutes integer); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.hand_in_section_paper(p_session uuid, p_choices integer[], p_minutes integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.hand_in_section_paper(p_session uuid, p_choices integer[], p_minutes integer) TO authenticated;


-- Name: FUNCTION invite_friend_to_room(p_slug text, p_user_id uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.invite_friend_to_room(p_slug text, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.invite_friend_to_room(p_slug text, p_user_id uuid) TO authenticated;


-- Name: FUNCTION is_owner(); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.is_owner() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_owner() TO authenticated;


-- Name: FUNCTION join_space(p_slug text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.join_space(p_slug text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.join_space(p_slug text) TO authenticated;


-- Name: FUNCTION leave_space(p_slug text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.leave_space(p_slug text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.leave_space(p_slug text) TO authenticated;


-- Name: FUNCTION list_page_pins(p_session uuid, p_document uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.list_page_pins(p_session uuid, p_document uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_page_pins(p_session uuid, p_document uuid) TO authenticated;


-- Name: FUNCTION list_threads(p_space uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.list_threads(p_space uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_threads(p_space uuid) TO authenticated;


-- Name: FUNCTION lookup_course(p_code text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.lookup_course(p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lookup_course(p_code text) TO anon;
GRANT ALL ON FUNCTION public.lookup_course(p_code text) TO authenticated;


-- Name: FUNCTION moderate_post(p_id uuid, p_action text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.moderate_post(p_id uuid, p_action text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.moderate_post(p_id uuid, p_action text) TO authenticated;


-- Name: FUNCTION moderation_queue(); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.moderation_queue() FROM PUBLIC;
GRANT ALL ON FUNCTION public.moderation_queue() TO authenticated;


-- Name: FUNCTION my_friends(); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.my_friends() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_friends() TO authenticated;


-- Name: FUNCTION my_notifications(p_limit integer); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.my_notifications(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_notifications(p_limit integer) TO authenticated;


-- Name: FUNCTION my_spaces(); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.my_spaces() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_spaces() TO authenticated;


-- Name: FUNCTION my_study_days(p_days integer, p_tz text); Type: ACL; Schema: public; Owner: -

GRANT ALL ON FUNCTION public.my_study_days(p_days integer, p_tz text) TO authenticated;


-- Name: FUNCTION note_pack_lineage(p_session uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.note_pack_lineage(p_session uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.note_pack_lineage(p_session uuid) TO authenticated;


-- Name: FUNCTION pin_to_answer(p_id uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.pin_to_answer(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pin_to_answer(p_id uuid) TO authenticated;


-- Name: FUNCTION public_roadmaps(p_limit integer); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.public_roadmaps(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.public_roadmaps(p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.public_roadmaps(p_limit integer) TO authenticated;


-- Name: FUNCTION read_notifications(p_ids uuid[]); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.read_notifications(p_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.read_notifications(p_ids uuid[]) TO authenticated;


-- Name: FUNCTION reminder_batch(); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.reminder_batch() FROM PUBLIC;
GRANT ALL ON FUNCTION public.reminder_batch() TO service_role;


-- Name: FUNCTION remove_friend(p_user_id uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.remove_friend(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.remove_friend(p_user_id uuid) TO authenticated;


-- Name: FUNCTION reply_thread(p_id uuid, p_body text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.reply_thread(p_id uuid, p_body text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reply_thread(p_id uuid, p_body text) TO authenticated;


-- Name: FUNCTION report_error(p_source text, p_message text, p_stack text, p_path text, p_digest text, p_user_agent text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.report_error(p_source text, p_message text, p_stack text, p_path text, p_digest text, p_user_agent text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.report_error(p_source text, p_message text, p_stack text, p_path text, p_digest text, p_user_agent text) TO anon;
GRANT ALL ON FUNCTION public.report_error(p_source text, p_message text, p_stack text, p_path text, p_digest text, p_user_agent text) TO authenticated;


-- Name: FUNCTION report_post(p_id uuid, p_reason text, p_note text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.report_post(p_id uuid, p_reason text, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.report_post(p_id uuid, p_reason text, p_note text) TO authenticated;


-- Name: FUNCTION request_friend(p_query text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.request_friend(p_query text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_friend(p_query text) TO authenticated;


-- Name: FUNCTION respond_friend(p_id uuid, p_accept boolean); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.respond_friend(p_id uuid, p_accept boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.respond_friend(p_id uuid, p_accept boolean) TO authenticated;


-- Name: FUNCTION review_answer(p_item uuid, p_rating text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.review_answer(p_item uuid, p_rating text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.review_answer(p_item uuid, p_rating text) TO authenticated;


-- Name: FUNCTION revoke_room_invite(p_slug text, p_user_id uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.revoke_room_invite(p_slug text, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.revoke_room_invite(p_slug text, p_user_id uuid) TO authenticated;


-- Name: FUNCTION roll_miss_map(p_session uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.roll_miss_map(p_session uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.roll_miss_map(p_session uuid) TO authenticated;


-- Name: FUNCTION roll_section_crib(p_session uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.roll_section_crib(p_session uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.roll_section_crib(p_session uuid) TO authenticated;


-- Name: FUNCTION roll_section_wrapped(p_session uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.roll_section_wrapped(p_session uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.roll_section_wrapped(p_session uuid) TO authenticated;


-- Name: FUNCTION room_friends(p_slug text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.room_friends(p_slug text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.room_friends(p_slug text) TO authenticated;


-- Name: FUNCTION rotate_calendar_token(); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.rotate_calendar_token() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rotate_calendar_token() TO authenticated;


-- Name: FUNCTION save_page_pin(p_session uuid, p_document uuid, p_page integer, p_quote text, p_question text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.save_page_pin(p_session uuid, p_document uuid, p_page integer, p_quote text, p_question text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_page_pin(p_session uuid, p_document uuid, p_page integer, p_quote text, p_question text) TO authenticated;


-- Name: FUNCTION save_section_lines(p_session uuid, p_lines text[]); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.save_section_lines(p_session uuid, p_lines text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_section_lines(p_session uuid, p_lines text[]) TO authenticated;


-- Name: FUNCTION save_sitting(p_session uuid, p_score numeric, p_out_of integer, p_minutes integer, p_topics text[], p_show_name boolean); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.save_sitting(p_session uuid, p_score numeric, p_out_of integer, p_minutes integer, p_topics text[], p_show_name boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_sitting(p_session uuid, p_score numeric, p_out_of integer, p_minutes integer, p_topics text[], p_show_name boolean) TO authenticated;


-- Name: FUNCTION section_scope(p_slug text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.section_scope(p_slug text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.section_scope(p_slug text) TO anon;
GRANT ALL ON FUNCTION public.section_scope(p_slug text) TO authenticated;


-- Name: FUNCTION set_course_code(p_session uuid, p_code text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.set_course_code(p_session uuid, p_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_course_code(p_session uuid, p_code text) TO authenticated;


-- Name: FUNCTION set_feedback_status(p_id bigint, p_status text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.set_feedback_status(p_id bigint, p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_feedback_status(p_id bigint, p_status text) TO authenticated;


-- Name: FUNCTION set_friend_presence(p_slug text, p_voice boolean); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.set_friend_presence(p_slug text, p_voice boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_friend_presence(p_slug text, p_voice boolean) TO authenticated;


-- Name: FUNCTION set_noticeboard_plan(p_code text, p_plan jsonb); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.set_noticeboard_plan(p_code text, p_plan jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_noticeboard_plan(p_code text, p_plan jsonb) TO authenticated;


-- Name: FUNCTION set_pin_answer(p_id uuid, p_answer text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.set_pin_answer(p_id uuid, p_answer text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_pin_answer(p_id uuid, p_answer text) TO authenticated;


-- Name: FUNCTION space_state(p_slug text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.space_state(p_slug text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.space_state(p_slug text) TO authenticated;


-- Name: FUNCTION store_section_paper(p_session uuid, p_questions jsonb); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.store_section_paper(p_session uuid, p_questions jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.store_section_paper(p_session uuid, p_questions jsonb) TO authenticated;


-- Name: FUNCTION take_s2_slot(); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.take_s2_slot() FROM PUBLIC;
GRANT ALL ON FUNCTION public.take_s2_slot() TO anon;
GRANT ALL ON FUNCTION public.take_s2_slot() TO authenticated;


-- Name: FUNCTION toggle_vote(p_id uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.toggle_vote(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.toggle_vote(p_id uuid) TO authenticated;


-- Name: FUNCTION track_events(p_events jsonb, p_anon text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.track_events(p_events jsonb, p_anon text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.track_events(p_events jsonb, p_anon text) TO anon;
GRANT ALL ON FUNCTION public.track_events(p_events jsonb, p_anon text) TO authenticated;


-- Name: FUNCTION use_trial(kind text); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.use_trial(kind text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.use_trial(kind text) TO authenticated;


-- Name: FUNCTION withdraw_section_paper(p_session uuid); Type: ACL; Schema: public; Owner: -

REVOKE ALL ON FUNCTION public.withdraw_section_paper(p_session uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.withdraw_section_paper(p_session uuid) TO authenticated;


-- Name: TABLE ai_keys; Type: ACL; Schema: public; Owner: -

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ai_keys TO authenticated;


-- Name: TABLE answer_feedback; Type: ACL; Schema: public; Owner: -

GRANT SELECT ON TABLE public.answer_feedback TO authenticated;


-- Name: COLUMN answer_feedback.session_id; Type: ACL; Schema: public; Owner: -

GRANT INSERT(session_id) ON TABLE public.answer_feedback TO authenticated;


-- Name: COLUMN answer_feedback.rating; Type: ACL; Schema: public; Owner: -

GRANT INSERT(rating) ON TABLE public.answer_feedback TO authenticated;


-- Name: COLUMN answer_feedback.comment; Type: ACL; Schema: public; Owner: -

GRANT INSERT(comment) ON TABLE public.answer_feedback TO authenticated;


-- Name: COLUMN answer_feedback.correction; Type: ACL; Schema: public; Owner: -

GRANT INSERT(correction) ON TABLE public.answer_feedback TO authenticated;


-- Name: COLUMN answer_feedback.answer; Type: ACL; Schema: public; Owner: -

GRANT INSERT(answer) ON TABLE public.answer_feedback TO authenticated;


-- Name: COLUMN answer_feedback.path; Type: ACL; Schema: public; Owner: -

GRANT INSERT(path) ON TABLE public.answer_feedback TO authenticated;


-- Name: TABLE feedback; Type: ACL; Schema: public; Owner: -

GRANT SELECT ON TABLE public.feedback TO authenticated;


-- Name: COLUMN feedback.kind; Type: ACL; Schema: public; Owner: -

GRANT INSERT(kind) ON TABLE public.feedback TO authenticated;


-- Name: COLUMN feedback.message; Type: ACL; Schema: public; Owner: -

GRANT INSERT(message) ON TABLE public.feedback TO authenticated;


-- Name: COLUMN feedback.path; Type: ACL; Schema: public; Owner: -

GRANT INSERT(path) ON TABLE public.feedback TO authenticated;


-- Name: COLUMN feedback.user_agent; Type: ACL; Schema: public; Owner: -

GRANT INSERT(user_agent) ON TABLE public.feedback TO authenticated;


-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -

GRANT SELECT ON TABLE public.notifications TO authenticated;


-- Name: COLUMN profiles.full_name; Type: ACL; Schema: public; Owner: -

GRANT UPDATE(full_name) ON TABLE public.profiles TO authenticated;


-- Name: COLUMN profiles.onboarded_at; Type: ACL; Schema: public; Owner: -

GRANT UPDATE(onboarded_at) ON TABLE public.profiles TO authenticated;


-- Name: COLUMN profiles.heard_from; Type: ACL; Schema: public; Owner: -

GRANT UPDATE(heard_from) ON TABLE public.profiles TO authenticated;


-- Name: COLUMN profiles.occupation; Type: ACL; Schema: public; Owner: -

GRANT UPDATE(occupation) ON TABLE public.profiles TO authenticated;


-- Name: COLUMN profiles.purpose; Type: ACL; Schema: public; Owner: -

GRANT UPDATE(purpose) ON TABLE public.profiles TO authenticated;


-- Name: COLUMN profiles.purpose_detail; Type: ACL; Schema: public; Owner: -

GRANT UPDATE(purpose_detail) ON TABLE public.profiles TO authenticated;


-- Name: COLUMN profiles.timezone; Type: ACL; Schema: public; Owner: -

GRANT UPDATE(timezone) ON TABLE public.profiles TO authenticated;


-- Name: COLUMN profiles.email_digest; Type: ACL; Schema: public; Owner: -

GRANT UPDATE(email_digest) ON TABLE public.profiles TO authenticated;


-- Name: COLUMN profiles.email_reminders; Type: ACL; Schema: public; Owner: -

GRANT UPDATE(email_reminders) ON TABLE public.profiles TO authenticated;


-- Name: COLUMN profiles.push_reminders; Type: ACL; Schema: public; Owner: -

GRANT UPDATE(push_reminders) ON TABLE public.profiles TO authenticated;


-- Name: TABLE saved_answers; Type: ACL; Schema: public; Owner: -

GRANT SELECT,DELETE ON TABLE public.saved_answers TO authenticated;


-- Name: COLUMN saved_answers.session_id; Type: ACL; Schema: public; Owner: -

GRANT INSERT(session_id) ON TABLE public.saved_answers TO authenticated;


-- Name: COLUMN saved_answers.question; Type: ACL; Schema: public; Owner: -

GRANT INSERT(question) ON TABLE public.saved_answers TO authenticated;


-- Name: COLUMN saved_answers.answer; Type: ACL; Schema: public; Owner: -

GRANT INSERT(answer) ON TABLE public.saved_answers TO authenticated;


-- Name: COLUMN saved_answers.page_number; Type: ACL; Schema: public; Owner: -

GRANT INSERT(page_number) ON TABLE public.saved_answers TO authenticated;


-- Name: COLUMN saved_answers.document_id; Type: ACL; Schema: public; Owner: -

GRANT INSERT(document_id) ON TABLE public.saved_answers TO authenticated;





-- ---------------------------------------------------------------------------
-- Sign-up creates the profile row. auth.users already exists on Supabase.
-- ---------------------------------------------------------------------------

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

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

alter table storage.objects enable row level security;

-- Live notifications, when Supabase Realtime is installed.
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

-- ---------------------------------------------------------------------------
-- Subject spaces. Running this again updates names and order only.
-- ---------------------------------------------------------------------------

insert into public.spaces (owner_id, slug, name, about, visibility, icon, category, sort)
values
  -- Science & Maths
  (null, 'mathematics', 'Mathematics', 'Calculus, linear algebra, proofs, discrete maths and everything between.', 'public', '📐', 'Science & Maths', 10),
  (null, 'statistics', 'Statistics & Probability', 'Distributions, inference, hypothesis tests, regression and Bayesian thinking.', 'public', '🎲', 'Science & Maths', 11),
  (null, 'physics', 'Physics', 'Mechanics, electromagnetism, thermodynamics, quantum and relativity, from intuition to derivation.', 'public', '⚛️', 'Science & Maths', 12),
  (null, 'chemistry', 'Chemistry', 'Organic, inorganic and physical chemistry: mechanisms, bonding, equilibria and lab work.', 'public', '🧪', 'Science & Maths', 13),
  (null, 'biology', 'Biology', 'Cells, genetics, evolution, physiology and ecology.', 'public', '🧬', 'Science & Maths', 14),
  (null, 'earth-science', 'Earth & Environmental Science', 'Geology, climate, oceans, ecosystems and sustainability.', 'public', '🌍', 'Science & Maths', 15),
  (null, 'astronomy', 'Astronomy & Space', 'Stars, galaxies, cosmology, planetary science and spaceflight.', 'public', '🔭', 'Science & Maths', 16),
  -- Engineering & Tech
  (null, 'computer-science', 'Computer Science', 'Algorithms, data structures, theory of computation, operating systems and networks.', 'public', '💻', 'Engineering & Tech', 20),
  (null, 'machine-learning', 'AI & Machine Learning', 'Models, training, deep learning, transformers, and reading ML papers.', 'public', '🤖', 'Engineering & Tech', 21),
  (null, 'data-science', 'Data Science & Analytics', 'SQL, pandas, visualisation, experiments and turning data into decisions.', 'public', '📊', 'Engineering & Tech', 22),
  (null, 'software-engineering', 'Programming & Software', 'Languages, debugging, web and app development, design patterns and interviews.', 'public', '🛠️', 'Engineering & Tech', 23),
  (null, 'electrical-engineering', 'Electrical & Electronics', 'Circuits, signals, control, embedded systems and power.', 'public', '⚡', 'Engineering & Tech', 24),
  (null, 'mechanical-engineering', 'Mechanical Engineering', 'Statics, dynamics, fluids, thermodynamics, materials and design.', 'public', '⚙️', 'Engineering & Tech', 25),
  (null, 'civil-engineering', 'Civil Engineering', 'Structures, geotechnics, transport, water and construction.', 'public', '🏗️', 'Engineering & Tech', 26),
  -- Health & Medicine
  (null, 'medicine', 'Medicine', 'Anatomy, physiology, pathology, pharmacology and clinical reasoning. Not medical advice.', 'public', '🩺', 'Health & Medicine', 30),
  (null, 'psychology', 'Psychology & Neuroscience', 'Cognition, behaviour, the brain, research methods and mental health science.', 'public', '🧠', 'Health & Medicine', 31),
  (null, 'public-health', 'Nursing & Public Health', 'Nursing practice, epidemiology, health policy and global health.', 'public', '🏥', 'Health & Medicine', 32),
  -- Business & Society
  (null, 'economics', 'Economics', 'Micro, macro, econometrics, development and game theory.', 'public', '📈', 'Business & Society', 40),
  (null, 'finance', 'Finance & Accounting', 'Corporate finance, markets, valuation, accounting and personal finance.', 'public', '💰', 'Business & Society', 41),
  (null, 'business', 'Business & Management', 'Strategy, marketing, operations, entrepreneurship and case studies.', 'public', '💼', 'Business & Society', 42),
  (null, 'law', 'Law', 'Constitutional, contract, criminal and international law, cases and legal writing. Not legal advice.', 'public', '⚖️', 'Business & Society', 43),
  (null, 'politics', 'Politics & International Relations', 'Political theory, governments, policy and world affairs.', 'public', '🏛️', 'Business & Society', 44),
  (null, 'sociology', 'Sociology & Anthropology', 'Societies, cultures, inequality, and how people live together.', 'public', '👥', 'Business & Society', 45),
  -- Humanities
  (null, 'history', 'History', 'Periods, sources, historiography and how to argue about the past.', 'public', '📜', 'Humanities', 50),
  (null, 'philosophy', 'Philosophy', 'Ethics, logic, epistemology, metaphysics and the history of ideas.', 'public', '🦉', 'Humanities', 51),
  (null, 'literature', 'Literature & Writing', 'Close reading, criticism, essays and creative writing.', 'public', '📚', 'Humanities', 52),
  (null, 'languages', 'Languages & Linguistics', 'Learning languages, grammar, phonetics and how language works.', 'public', '🗣️', 'Humanities', 53),
  -- Arts & Design
  (null, 'design', 'Design & Architecture', 'Visual, product and UX design, architecture and design history.', 'public', '🎨', 'Arts & Design', 60),
  (null, 'music', 'Music', 'Theory, harmony, composition, performance and music history.', 'public', '🎵', 'Arts & Design', 61),
  -- Exams & Skills
  (null, 'exam-prep', 'Entrance & Competitive Exams', 'JEE, NEET, UPSC, CAT, GATE, GRE, GMAT, SAT and the rest: strategy and doubts.', 'public', '🎯', 'Exams & Skills', 70),
  (null, 'research', 'Research & Academic Writing', 'Reading papers, methods, theses, citations and getting published.', 'public', '🔬', 'Exams & Skills', 71),
  (null, 'study-skills', 'Study Skills & Productivity', 'How to learn, remember, plan and stay focused.', 'public', '📝', 'Exams & Skills', 72),
  (null, 'careers', 'Careers & Interviews', 'Internships, applications, CVs, interviews and choosing a path.', 'public', '🧭', 'Exams & Skills', 73)
on conflict (slug) do update set
  name = excluded.name,
  about = excluded.about,
  visibility = 'public',
  icon = excluded.icon,
  category = excluded.category,
  sort = excluded.sort;

-- One shared Semantic Scholar slot. take_s2_slot() reads this row.
insert into public.rate_slots (name) values ('semantic_scholar') on conflict do nothing;

notify pgrst, 'reload schema';
