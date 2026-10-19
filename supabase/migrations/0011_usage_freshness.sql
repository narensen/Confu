-- Keep the usage meter honest:
--  * last_success_at: a successful request after a daily-limit hit means the
--    limit has freed up, so "limit reached" can be cleared.
--  * daily_used_at_hit: what Groq said was used when the limit was hit
--    (includes usage outside Confu).
-- Usage is now tracked per actual key (key_ref = 'key:<groq_keys.id>' or
-- 'server:<fingerprint>'), so replacing a key starts a clean record; rows under
-- the old 'account' / 'session:…' refs are simply history. Safe to re-run.

alter table public.ai_quota
  add column if not exists last_success_at   timestamptz,
  add column if not exists daily_used_at_hit int;

notify pgrst, 'reload schema';
