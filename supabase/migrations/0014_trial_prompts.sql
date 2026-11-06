-- Free trial: a Free account with no Groq key of its own can make 10 AI
-- prompts on Confu's keys (and have 20 scanned pages read), once. Counted
-- here, not in the app, so it can't be reset from the browser. Safe to re-run.
--
-- Change the allowance by editing the two numbers in use_trial() below
-- (and TRIAL_PROMPTS / TRIAL_PAGES in lib/ai-access.ts, which only display them).

alter table public.profiles
  add column if not exists trial_prompts_used int not null default 0,
  add column if not exists trial_pages_used   int not null default 0;

-- Use one trial prompt ('prompt') or scanned page ('page') if any are left.
-- Returns true when the request may run on Confu's keys.
create or replace function public.use_trial(kind text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.use_trial(text) from public, anon;
grant execute on function public.use_trial(text) to authenticated;

notify pgrst, 'reload schema';
