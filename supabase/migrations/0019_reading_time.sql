-- Reading time per page, for "Where it got hard": how long a student spent on
-- each page and how often they came back to it. Counted only while the tab is
-- visible and they're active. Safe to re-run.

create table if not exists public.page_time (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  document_id  uuid not null references public.documents (id) on delete cascade,
  page_number  int  not null check (page_number > 0),
  seconds      int  not null default 0,
  visits       int  not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (user_id, document_id, page_number)
);

alter table public.page_time enable row level security;

drop policy if exists "own rows" on public.page_time;
create policy "own rows" on public.page_time
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Add time from the reader: [{ "page": 12, "seconds": 30, "visits": 1 }, …].
-- Each report is capped (10 minutes a page) so a tab left open can't inflate it.
create or replace function public.add_page_time(p_document uuid, p_pages jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  e jsonb;
begin
  if uid is null or jsonb_typeof(p_pages) is distinct from 'array' then
    return;
  end if;
  -- Only your own documents.
  if not exists (select 1 from public.documents where id = p_document and user_id = uid) then
    return;
  end if;
  for e in select value from jsonb_array_elements(p_pages) limit 100 loop
    continue when (e ->> 'page') !~ '^[0-9]{1,5}$';
    insert into public.page_time (user_id, document_id, page_number, seconds, visits)
    values (
      uid, p_document, (e ->> 'page')::int,
      least(greatest(coalesce((e ->> 'seconds')::int, 0), 0), 600),
      least(greatest(coalesce((e ->> 'visits')::int, 0), 0), 20)
    )
    on conflict (user_id, document_id, page_number) do update
      set seconds = public.page_time.seconds + excluded.seconds,
          visits = public.page_time.visits + excluded.visits,
          updated_at = now();
  end loop;
end;
$$;

revoke all on function public.add_page_time(uuid, jsonb) from public, anon;
grant execute on function public.add_page_time(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
