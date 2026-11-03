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
