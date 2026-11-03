-- Paper sessions can require every tutor paragraph to cite a retrieved page.
-- Existing rows stay off. New paper inserts set the column in the app.
-- Safe to re-run.

alter table public.study_sessions
  add column if not exists cite_mode boolean not null default false;

notify pgrst, 'reload schema';
