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
