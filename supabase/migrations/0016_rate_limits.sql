-- One shared queue for Semantic Scholar, whose API key allows one request per
-- second across ALL of Confu's servers. Every server reserves the next free
-- slot here before calling it, so two users searching at once just wait about
-- a second each instead of being refused. Safe to re-run.

create table if not exists public.rate_slots (
  name    text primary key,
  next_at timestamptz not null default now()
);

-- No policies: only take_s2_slot() below touches this table.
alter table public.rate_slots enable row level security;

insert into public.rate_slots (name) values ('semantic_scholar') on conflict do nothing;

-- Reserve the next slot. Returns how many milliseconds to wait before calling
-- Semantic Scholar, or -1 when the queue is over 15 seconds long (the caller
-- uses another source instead of making someone wait that long).
create or replace function public.take_s2_slot()
returns int
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.take_s2_slot() from public;
grant execute on function public.take_s2_slot() to anon, authenticated;

notify pgrst, 'reload schema';
