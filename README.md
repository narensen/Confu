# Confu

Upload a PDF, set a goal and a deadline, and learn it with a tutor that is grounded in the document and remembers your progress.

## Setup

1. `bun install`
2. Copy `.env.example` to `.env.local` and fill it in.
3. In the Supabase SQL editor, run every file in [`supabase/migrations/`](supabase/migrations/) in order (`0001`, `0002`, `0003`, …). Together they create the tables, RLS policies, search functions and the private `documents` storage bucket.
4. In Supabase, go to **Authentication → URL Configuration**. Set the Site URL to `http://localhost:3000` and add `http://localhost:3000/auth/confirm` to Redirect URLs (and the same for your production domain).
5. `bun dev`

## How it works

| Piece | Where |
| --- | --- |
| Auth: email/password, confirmation, password reset | `app/(auth)`, `app/auth/confirm`, `proxy.ts`, `lib/dal.ts` |
| Sessions: one goal, many PDFs (tabs D1, D2, …), editable title | `app/session/[id]`, `components/workspace/DocTabs.tsx`, `SessionTitle.tsx` |
| Upload: text and outline extracted in the browser, indexed per page | `lib/pdf/upload.ts`, `lib/pdf/extract.ts` |
| Plan: goal + deadline → phased topics across all PDFs and beyond them | `app/api/plan`, `lib/tutor/plan.ts`, `lib/schedule.ts` |
| Tutor: retrieval (Postgres full-text) + goal + plan + memory → streamed answer | `app/api/chat`, `lib/tutor/context.ts`, `lib/tutor/prompts.ts` |
| Memory: updated after each exchange, feeds every prompt and topic mastery | `lib/tutor/memory.ts` |
| Figures: captured region → vision model notes → stored as context | `app/api/figure`, `components/pdf/PdfViewer.tsx` |

Models (Groq): `openai/gpt-oss-120b` (tutor and planner), `openai/gpt-oss-20b` (memory), `qwen/qwen3.8-27b` (vision). Override them with the `GROQ_*_MODEL` env vars.
