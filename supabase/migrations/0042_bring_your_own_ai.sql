  -- Confu is open source: no Pro plan. Every account brings its own AI.
  --
  -- 1. groq_keys becomes ai_keys: a key (or an OpenRouter connection) for any
  --    provider, with the models picked for it. Existing rows are Groq keys
  --    and keep working as they are.
  -- 2. Pro is gone: 'pro' accounts go back to the default (role NULL), and
  --    only 'admin' (the owner) remains. The Pro-only functions are dropped.
  --    Billing and invite history (subscriptions, referrals, paid_until,
  --    pro_until) is left in place untouched; nothing reads it any more.
  --
  -- Run it right before deploying the code that uses ai_keys. Safe to re-run.

  -- 1. Keys for any provider -------------------------------------------------

  do $$
  begin
    if to_regclass('public.ai_keys') is null and to_regclass('public.groq_keys') is not null then
      alter table public.groq_keys rename to ai_keys;
      alter index if exists public.groq_keys_pkey rename to ai_keys_pkey;
      alter index if exists public.groq_keys_account_idx rename to ai_keys_account_idx;
      alter index if exists public.groq_keys_session_idx rename to ai_keys_session_idx;
    end if;
  end $$;

  -- A database that never had groq_keys (migration 0006) gets the table here.
  create table if not exists public.ai_keys (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
    session_id  uuid references public.study_sessions (id) on delete cascade,
    ciphertext  text not null,
    iv          text not null,
    auth_tag    text not null,
    last4       text not null,
    created_at  timestamptz not null default now()
  );

  -- One account key and at most one key per session for each user.
  create unique index if not exists ai_keys_account_idx on public.ai_keys (user_id) where session_id is null;
  create unique index if not exists ai_keys_session_idx on public.ai_keys (user_id, session_id) where session_id is not null;

  alter table public.ai_keys enable row level security;

  drop policy if exists "own keys" on public.ai_keys;
  create policy "own keys" on public.ai_keys
    for all to authenticated
    using ((select auth.uid()) = user_id)
    with check (
      (select auth.uid()) = user_id
      and (
        session_id is null
        or exists (select 1 from public.study_sessions s where s.id = session_id and s.user_id = (select auth.uid()))
      )
    );

  grant select, insert, update, delete on public.ai_keys to authenticated;
  revoke all on public.ai_keys from anon;

  alter table public.ai_keys add column if not exists provider text not null default 'groq';
  alter table public.ai_keys add column if not exists base_url text;
  alter table public.ai_keys add column if not exists chat_model text;
  alter table public.ai_keys add column if not exists fast_model text;
  alter table public.ai_keys add column if not exists vision_model text;
  -- 'key': pasted by the student. 'oauth': made by "Connect OpenRouter".
  alter table public.ai_keys add column if not exists via text not null default 'key';

  alter table public.ai_keys drop constraint if exists ai_keys_provider_check;
  alter table public.ai_keys add constraint ai_keys_provider_check
    check (provider in ('groq', 'openai', 'anthropic', 'gemini', 'openrouter', 'custom'));
  alter table public.ai_keys drop constraint if exists ai_keys_via_check;
  alter table public.ai_keys add constraint ai_keys_via_check check (via in ('key', 'oauth'));
  alter table public.ai_keys drop constraint if exists ai_keys_base_url_check;
  alter table public.ai_keys add constraint ai_keys_base_url_check
    check (base_url is null or (provider = 'custom' and char_length(base_url) <= 300));
  alter table public.ai_keys drop constraint if exists ai_keys_models_check;
  alter table public.ai_keys add constraint ai_keys_models_check check (
    coalesce(char_length(chat_model), 0) <= 200
    and coalesce(char_length(fast_model), 0) <= 200
    and coalesce(char_length(vision_model), 0) <= 200
  );
  -- A local model server may need no key at all, so last4 can be empty.
  alter table public.ai_keys drop constraint if exists groq_keys_last4_check;
  alter table public.ai_keys drop constraint if exists ai_keys_last4_check;
  alter table public.ai_keys add constraint ai_keys_last4_check check (char_length(last4) <= 4);

  comment on table public.ai_keys is
    'Each account''s own AI: an API key for a provider, or an OpenRouter connection, encrypted by the server (AES-256-GCM). session_id NULL is the account key; otherwise an override for one session.';

  -- 2. No Pro ----------------------------------------------------------------

  update public.profiles set role = null where role = 'pro';

  alter table public.profiles drop constraint if exists profiles_role_check;
  alter table public.profiles add constraint profiles_role_check check (role in ('admin'));
  comment on column public.profiles.role is
    'NULL = everyone (their own AI); ''admin'' = the owner (admin dashboard, and the server''s keys when they have none of their own). Set manually.';

  drop function if exists public.request_pro();
  drop function if exists public.pro_members();
  drop function if exists public.set_pro(text, boolean);
  drop function if exists public.billing_summary();
  drop function if exists public.grant_class_rep(text);
  drop function if exists public.settle_referrals();

  notify pgrst, 'reload schema';
