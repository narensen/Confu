# Confu

A free, open-source AI tutor that works from your own material. Study toward a goal with a phased plan, prepare for an exam with practice questions written from your notes, or read research papers in three passes. It's grounded in your PDFs and remembers your progress.

## Setup

1. `bun install`
2. Copy `.env.example` to `.env.local` and fill it in.
3. In the Supabase SQL editor, run every file in [`supabase/migrations/`](supabase/migrations/) in order (`0001`, `0002`, `0003`, …). Together they create the tables, RLS policies, search functions and the private `documents` storage bucket.
4. In Supabase, go to **Authentication → URL Configuration**. Set the Site URL to `http://localhost:3000` and add `http://localhost:3000/auth/confirm` to Redirect URLs (and the same for your production domain).
5. For real users, set up custom SMTP in **Authentication → Emails**. Supabase's built-in sender is heavily rate-limited, and sign-up confirmation, password reset and email change all send mail.
6. `bun dev`

## Bring your own AI

Confu is free and open source, with no plans or payments. Each account brings its own AI, in **Settings → Your AI** (or the panel a session shows when nothing is connected):

- **Connect OpenRouter**: one click. The student approves Confu on openrouter.ai (OAuth with PKCE) and Confu receives a key of their own, billed to their OpenRouter credits.
- **An API key** from Groq, OpenAI, Anthropic, Google Gemini, OpenRouter, or any OpenAI-compatible server (Ollama, LM Studio, vLLM, DeepSeek, Mistral…). Keys are checked with the provider, then encrypted with `KEY_ENCRYPTION_SECRET` (AES-256-GCM) before they're stored.

Confu picks a model for each job from the provider's live model list (tutor, progress notes, figures and scans); students can change them. A session can have its own key that overrides the account's.

Anthropic goes through the official Anthropic SDK (Messages API); every other provider goes through its OpenAI-compatible chat API. Both sit behind one client, so the rest of the code doesn't know which provider it's talking to (`lib/ai/`).

### The server's own keys (optional)

`GROQ_API_KEYS` are used for two things only:

| Who | What runs on the server's keys |
| --- | --- |
| The owner (`profiles.role = 'admin'`) | Everything, until they connect an AI of their own. Also the admin dashboard. |
| Everyone else | 10 free prompts (and 20 scanned pages), once, so they can try Confu before connecting anything (migration 0014). |

Leave `GROQ_API_KEYS` empty to turn both off: then everyone, the owner included, connects their own AI. Make yourself the owner once, in the SQL editor:

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

### Running it yourself with a local model

Point "Other (OpenAI-compatible)" at your model server, e.g. `http://localhost:11434/v1` for Ollama. A server on your own network is blocked by default, so a shared deployment can't be made to fetch internal addresses. Set `ALLOW_PRIVATE_AI_URLS=1` on a server only you use.

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
| Your AI: providers, models, the request adapters, OpenRouter connect | `lib/ai/`, `lib/ai-access.ts`, `lib/ai-keys.ts`, `app/api/ai/openrouter`, `components/keys` |
| The server's keys (owner, free prompts), with failover across keys | `lib/groq-pool.ts` |
| Usage meter: tokens per key and model, rate limits where reported, freshness | `lib/usage.ts`, `lib/usage-summary.ts`, `lib/usage-probe.ts` |
| Settings: profile, security, your AI, usage, export, delete account | `app/settings`, `components/settings`, `app/api/export` |

Models on the server's keys (Groq): `openai/gpt-oss-120b` (tutor, planner, marking), `openai/gpt-oss-20b` (memory), `qwen/qwen3.8-27b` (vision). Override them with the `GROQ_*_MODEL` env vars; they're also the defaults for students' Groq keys.
