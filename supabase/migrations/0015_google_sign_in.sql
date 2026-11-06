-- Google sign-in skips the sign-up form, so those users answer the sign-up
-- questions on /welcome afterwards: let people fill in their own answers.
-- (Their role and trial counters stay locked.) Safe to re-run.

grant update (full_name, onboarded_at, heard_from, occupation, purpose, purpose_detail) on public.profiles to authenticated;

notify pgrst, 'reload schema';
