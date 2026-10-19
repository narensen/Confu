-- First-login tutorial. NULL = hasn't seen the guide yet, so it opens
-- automatically; set when they finish or skip it. Safe to re-run.

alter table public.profiles
  add column if not exists onboarded_at timestamptz;

-- 0004 limited profile updates to full_name; users may also mark the guide done.
-- (role stays read-only for users.)
grant update (full_name, onboarded_at) on public.profiles to authenticated;

notify pgrst, 'reload schema';
