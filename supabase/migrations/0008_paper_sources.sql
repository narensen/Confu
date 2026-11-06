-- Papers can be added by arXiv ID, DOI or URL instead of uploading a PDF.
-- When an open-access PDF exists it's fetched and stored as usual; otherwise
-- the paper is kept as metadata + abstract (storage_path NULL). Safe to re-run.

alter table public.documents
  alter column storage_path drop not null,
  add column if not exists source_url text,                    -- landing page (arXiv abs, doi.org, …)
  add column if not exists meta jsonb not null default '{}';   -- { authors, year, venue, doi, arxiv_id, abstract, pdf_url }

notify pgrst, 'reload schema';
