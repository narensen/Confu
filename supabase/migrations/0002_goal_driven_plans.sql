-- Goal-driven plans: the goal is the source of truth and the PDF is the
-- primary material, not the boundary. Plans are grouped into phases and can
-- include topics the PDF doesn't cover, with suggested outside resources.

alter table public.study_plans
  add column if not exists goal_title   text  not null default '',  -- short display title derived from the goal
  add column if not exists goal_summary text  not null default '',  -- 1–2 sentences: what success looks like
  add column if not exists materials    text  not null default '',  -- other lectures / courses the student uses
  add column if not exists phases       jsonb not null default '[]'; -- [{ "title": text, "description": text }]

alter table public.plan_topics
  add column if not exists phase     int   not null default 0,      -- index into study_plans.phases
  add column if not exists source    text  not null default 'pdf'
    check (source in ('pdf', 'external')),                          -- external = beyond the PDF
  add column if not exists resources jsonb not null default '[]',   -- [{ "type", "title", "search" }]
  alter column page_start drop not null,
  alter column page_end   drop not null;

alter table public.plan_topics
  drop constraint if exists plan_topics_pdf_pages,
  add constraint plan_topics_pdf_pages
    check (source = 'external' or (page_start is not null and page_end is not null));

notify pgrst, 'reload schema';
