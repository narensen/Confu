# Confu

An AI tutor that works from your own material. Study toward a goal with a phased plan, prepare for an exam with practice questions written from your notes, or read research papers in three passes. It's grounded in your PDFs and remembers your progress.

## Setup

1. `bun install`
2. Copy `.env.example` to `.env.local` and fill it in.
3. In the Supabase SQL editor, run every file in [`supabase/migrations/`](supabase/migrations/) in order (`0001`, `0002`, `0003`, …). Together they create the tables, RLS policies, search functions and the private `documents` storage bucket.
4. In Supabase, go to **Authentication → URL Configuration**. Set the Site URL to `http://localhost:3000` and add `http://localhost:3000/auth/confirm` to Redirect URLs (and the same for your production domain).
5. For real users, set up custom SMTP in **Authentication → Emails**. Supabase's built-in sender is heavily rate-limited, and sign-up confirmation, password reset and email change all send mail.
6. `bun dev`

## Plans and roles

`profiles.role` decides how a user's AI requests are paid for. Users can never change their own role.

| Role | Plan | AI runs on |
| --- | --- | --- |
| `NULL` | Free | 10 free prompts on Confu's keys (migration 0014), then the user's own Groq key, saved encrypted in Settings (or per session) |
| `'pro'` | Pro | Confu's keys (`GROQ_API_KEYS`), up to `PRO_DAILY_TOKENS` per rolling 24 hours |
| `'admin'` | Owner | Confu's keys with no allowance, plus Settings → Pro members |

Make yourself the owner once, in the SQL editor:

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

After that, users request Pro from **Settings → Plan**, and you approve them (or give Pro to any email) in **Settings → Pro members**.

## How it works

| Piece | Where |
| --- | --- |
| Auth: email/password, confirmation, password reset | `app/(auth)`, `app/auth/confirm`, `proxy.ts`, `lib/dal.ts` |
| Library and new sessions (study, exam prep, papers; you always name them) | `app/dashboard`, `components/dashboard` |
| Sessions: one goal, many PDFs (tabs D1, D2, …), editable title | `app/session/[id]`, `components/workspace/DocTabs.tsx`, `SessionTitle.tsx` |
| Upload: text and outline extracted in the browser, indexed per page | `lib/pdf/upload.ts`, `lib/pdf/extract.ts` |
| Plan: goal + deadline → phased topics across all PDFs and beyond them | `app/api/plan`, `lib/tutor/plan.ts`, `lib/schedule.ts` |
| Tutor: retrieval (Postgres full-text) + goal + plan + memory → streamed answer | `app/api/chat`, `lib/tutor/context.ts`, `lib/tutor/prompts.ts` |
| Memory: updated after each exchange, feeds every prompt and topic mastery | `lib/tutor/memory.ts` |
| Figures: captured region → vision model notes → stored as context | `app/api/figure`, `components/pdf/PdfViewer.tsx` |
| Exam prep: questions from your notes, strict marking, weak topics | `app/api/exam`, `lib/tutor/exam-ai.ts`, `components/exam` |
| Papers: arXiv/DOI lookup, triage, Keshav's three passes, literature search | `app/api/paper`, `lib/scholar.ts`, `lib/tutor/paper-*.ts`, `components/paper` |
| Plans and keys: Free (own key) vs Pro (key pool with failover) | `lib/plans.ts`, `lib/ai-access.ts`, `lib/groq-pool.ts`, `lib/groq-keys.ts` |
| Usage meter: tokens per key and model, Groq's limits, freshness | `lib/usage.ts`, `lib/usage-summary.ts`, `lib/usage-probe.ts` |
| Settings: profile, security, plan, key, usage, export, delete account | `app/settings`, `components/settings`, `app/api/export` |

Models (Groq): `openai/gpt-oss-120b` (tutor, planner, marking), `openai/gpt-oss-20b` (memory), `qwen/qwen3.8-27b` (vision). Override them with the `GROQ_*_MODEL` env vars.
