  -- AI usage and Groq quota, so people can see how much of their key they've
  -- used and how much is left. Safe to re-run.
  --
  -- key_ref identifies which Groq key a request ran on:
  --   'server'            the server key (admins)
  --   'account'           the user's account key
  --   'session:<uuid>'    a session-specific key

  -- One row per Groq request.
  create table if not exists public.ai_usage (
    id                 bigint generated always as identity primary key,
    user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
    session_id         uuid references public.study_sessions (id) on delete set null,
    key_ref            text not null,
    model              text not null,
    feature            text not null,  -- chat, plan, figure, quiz, grade, triage, pass1
    prompt_tokens      int  not null default 0,
    completion_tokens  int  not null default 0,
    total_tokens       int  not null default 0,
    created_at         timestamptz not null default now()
  );

  create index if not exists ai_usage_user_time_idx on public.ai_usage (user_id, created_at desc);

  -- Latest limits Groq reported for a key and model (from response headers, and
  -- the daily token limit from rate-limit errors).
  create table if not exists public.ai_quota (
    user_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
    key_ref             text not null,
    model               text not null,
    requests_limit      int,          -- per day
    requests_remaining  int,
    requests_reset_at   timestamptz,
    tokens_limit        int,          -- per minute
    tokens_remaining    int,
    daily_tokens_limit  int,          -- learned from a "tokens per day" rate-limit error
    daily_limit_hit_at  timestamptz,
    observed_at         timestamptz not null default now(),
    primary key (user_id, key_ref, model)
  );

  alter table public.ai_usage enable row level security;
  alter table public.ai_quota enable row level security;

  drop policy if exists "own rows" on public.ai_usage;
  create policy "own rows" on public.ai_usage
    for all to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

  drop policy if exists "own rows" on public.ai_quota;
  create policy "own rows" on public.ai_quota
    for all to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

  notify pgrst, 'reload schema';
