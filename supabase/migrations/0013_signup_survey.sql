-- What new users tell us at sign-up: how they found Confu, who they are, and
-- what they want it for. Saved on their profile (users can read it, not edit
-- it). Safe to re-run.
--
-- See the answers:
--   select u.email, p.heard_from, p.occupation, p.purpose, p.purpose_detail, p.created_at
--   from public.profiles p join auth.users u on u.id = p.id
--   order by p.created_at desc;

alter table public.profiles
  add column if not exists heard_from     text,
  add column if not exists occupation     text,
  add column if not exists purpose        text,
  add column if not exists purpose_detail text;

-- Copy the answers from the sign-up metadata into the profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

notify pgrst, 'reload schema';
