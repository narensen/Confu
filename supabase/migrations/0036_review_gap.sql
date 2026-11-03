-- Explain-back gaps join the review schedule. Do not edit 0017 in place.
-- Safe to re-run: drop the check, then add it back with 'gap' included.
--
-- A gap row stores the feedback already kept (sliced to 500) as prompt,
-- the page, and an empty answer. It does not store speech. Shared RPCs
-- must not select review_items or explain_backs.gap.

alter table public.review_items drop constraint if exists review_items_source_check;
alter table public.review_items add constraint review_items_source_check
  check (source in ('topic', 'highlight', 'asked', 'misconception', 'mistake', 'gap'));

notify pgrst, 'reload schema';
