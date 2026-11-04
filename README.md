<p align="center">
  <img src="apps/web/public/icons/icon-512.png" width="88" alt="Confu" />
</p>

<h1 align="center">Confu</h1>

<p align="center">
  A free, open-source AI tutor that works from your own notes, textbooks and papers.<br />
  It plans what to learn, answers the line you highlight, and remembers your progress.
</p>

<p align="center">
  <a href="https://confu.lol"><img src="apps/web/public/readme/open.png" height="44" alt="Open Confu" /></a>
  &nbsp;&nbsp;
  <a href="#see-it"><img src="apps/web/public/readme/watch.png" height="44" alt="Watch the demo" /></a>
  &nbsp;&nbsp;
  <a href="LICENSE"><img src="apps/web/public/readme/license.png" height="44" alt="MIT License" /></a>
</p>

<p align="center">
  <sub>Anyone may use it, change it, and share it, including to run it for a class or a campus. <code>private</code> in <code>package.json</code> only keeps this app off the npm registry. The fonts in <code>public/fonts</code> stay under the SIL Open Font License (<code>public/fonts/OFL.txt</code>).</sub>
</p>

## See it

The real workspace, then the three short films from the site. Click a still to play.

<p align="center">
  <a href="apps/web/public/demo/confu-demo.mp4">
    <img src="apps/web/public/demo/confu-demo-poster.jpg" width="820" alt="Confu workspace: a highlighted passage on the right, and a tutor answer on the left that cites page 2." />
  </a>
</p>

<p align="center"><sub>Highlight a line. Ask. The answer cites the page, and the page opens.</sub></p>

<table>
  <tr>
    <td align="center" width="33%">
      <a href="apps/web/public/reels/stop-highlighting.mp4"><img src="apps/web/public/reels/stop-highlighting.jpg" width="220" alt="Stop highlighting your notes." /></a>
      <br /><b>Stop highlighting</b>
      <br /><sub>Asking beats rereading.</sub>
    </td>
    <td align="center" width="33%">
      <a href="apps/web/public/reels/start.mp4"><img src="apps/web/public/reels/start.jpg" width="220" alt="You just opened a 700-page textbook." /></a>
      <br /><b>Know where to start</b>
      <br /><sub>A goal becomes a plan.</sub>
    </td>
    <td align="center" width="33%">
      <a href="apps/web/public/reels/forget.mp4"><img src="apps/web/public/reels/forget.jpg" width="220" alt="By next week you'll forget most of what you studied today." /></a>
      <br /><b>Forget less</b>
      <br /><sub>Finished topics come back.</sub>
    </td>
  </tr>
</table>

<p align="center">
  <a href="https://github.com/narensen/ConfuAI/actions/workflows/ci.yml"><img src="https://github.com/narensen/ConfuAI/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
</p>

## Setup

1. `bun install` (at the repository root)
2. Copy `apps/web/.env.example` to `apps/web/.env.local` and fill it in.
3. In the Supabase SQL editor, run [`supabase/schema.sql`](supabase/schema.sql) once, on an empty project. That file is the whole database: tables, row level security, functions, the private `documents` bucket, and the subject spaces. [`supabase/README.md`](supabase/README.md) explains it. Do not run it on a database that already has Confu tables.
4. In Supabase, go to **Authentication → URL Configuration**. Set the Site URL to `http://localhost:3000` and add `http://localhost:3000/auth/confirm` to Redirect URLs (and the same for your production domain).
5. For real users, set up custom SMTP in **Authentication → Emails**. Supabase's built-in sender is heavily rate-limited, and sign-up confirmation, password reset and email change all send mail.
6. `bun dev`, then open http://localhost:3000

## Bring your own AI

Confu is free and open source, with no plans or payments. Each account brings its own AI, in **Settings → Your AI** (or the panel a session shows when nothing is connected):

- **Connect OpenRouter**: one click. The student approves Confu on openrouter.ai (OAuth with PKCE) and Confu receives a key of their own, billed to their OpenRouter credits.
- **An API key** from Groq, OpenAI, Anthropic, Google Gemini, OpenRouter, or any OpenAI-compatible server (Ollama, LM Studio, vLLM, DeepSeek, Mistral…). Keys are checked with the provider, then encrypted with `KEY_ENCRYPTION_SECRET` (AES-256-GCM) before they're stored.

Confu picks a model for each job from the provider's live model list (tutor, progress notes, figures and scans); students can change them. A session can have its own key that overrides the account's.

Anthropic goes through the official Anthropic SDK (Messages API); every other provider goes through its OpenAI-compatible chat API. Both sit behind one client, so the rest of the code doesn't know which provider it's talking to (`packages/ai`).

### The server's own keys (optional)

`GROQ_API_KEYS` are used for two things only:

| Who | What runs on the server's keys |
| --- | --- |
| The owner (`profiles.role = 'admin'`) | Their own AI, if they connected one, runs first. These keys answer when that provider can't (rate limit, no credit, a missing model, or it is down). With no key of their own, everything runs here. The admin dashboard is theirs either way. |
| Everyone else | 10 free prompts (and 20 scanned pages), once, so they can try Confu before connecting anything. The counts live on the profile. |

Leave `GROQ_API_KEYS` empty to turn both off: then everyone, the owner included, connects their own AI. Make yourself the owner once, in the SQL editor:

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

### Running it yourself with a local model

Point "Other (OpenAI-compatible)" at your model server, e.g. `http://localhost:11434/v1` for Ollama. A server on your own network is blocked by default, so a shared deployment can't be made to fetch internal addresses. Set `ALLOW_PRIVATE_AI_URLS=1` on a server only you use.

## Repository layout

| Workspace | What it is |
| --- | --- |
| `apps/web` | The Next.js app: pages, API routes, components |
| `packages/core` | The tutor's logic: prompts, citations, math repair, diagrams, schedule. Plain TypeScript, no database or network. |
| `packages/ai` | Bring-your-own-AI: one client over Groq, OpenAI, Anthropic, Gemini, OpenRouter and OpenAI-compatible servers. Runs on the server and in the browser. |
| `packages/storage` | The on-device database: SQLite (WebAssembly, stored in the browser's private file system), full-text page search, sealed secrets, and a change log for sync |
| `packages/client` | Confu on the device: the library (sessions, PDFs, chat), the student's keys, a metered AI client straight to their provider, the tutor's answer flow, and OpenRouter sign-in without a server |
| `packages/ui` | Shared React pieces: the answer renderer (Markdown, math, diagrams) and the class recipes |
| `packages/app` | The on-device app: library, PDF reader and tutor, with no account and no server. The web app serves it at `/app`; it works offline after one visit. |
| `supabase` | The database schema and email templates |

Bun workspaces and [Turborepo](https://turborepo.dev): `bun run typecheck`, `bun run test`, `bun run lint` and `bun run build` cover every workspace from the root.

## How it works

| Piece | Where |
| --- | --- |
| Auth: email/password, confirmation, password reset | `apps/web/app/(auth)`, `apps/web/app/auth/confirm`, `apps/web/proxy.ts`, `apps/web/lib/dal.ts` |
| Library and new sessions (study, exam prep, papers; you always name them) | `apps/web/app/(app)/dashboard`, `apps/web/components/dashboard` |
| Sessions: one goal, many PDFs (tabs D1, D2, …), editable title | `apps/web/app/session/[id]`, `apps/web/components/workspace/DocTabs.tsx`, `SessionTitle.tsx` |
| Upload: text and outline extracted in the browser, indexed per page | `apps/web/lib/pdf/upload.ts`, `packages/app/src/pdf.ts` |
| Plan: goal + deadline → phased topics across all PDFs and beyond them | `apps/web/app/api/plan`, `apps/web/lib/tutor/plan.ts`, `packages/core/src/schedule.ts` |
| Tutor: retrieval (Postgres full-text) + goal + plan + memory → streamed answer | `apps/web/app/api/chat`, `apps/web/lib/tutor/context.ts`, `packages/core/src/tutor/prompts.ts` |
| Memory: updated after each exchange, feeds every prompt and topic mastery | `apps/web/lib/tutor/memory.ts` |
| Figures: captured region → vision model notes → stored as context | `apps/web/app/api/figure`, `apps/web/components/pdf/PdfViewer.tsx` |
| Exam prep: questions from your notes, strict marking, weak topics | `apps/web/app/api/exam`, `apps/web/lib/tutor/exam-ai.ts`, `apps/web/components/exam` |
| Papers: arXiv/DOI lookup, triage, Keshav's three passes, literature search | `apps/web/app/api/paper`, `apps/web/lib/scholar.ts`, `apps/web/lib/tutor/paper-*.ts`, `packages/core/src/tutor/paper-prompts.ts`, `apps/web/components/paper` |
| Your AI: providers, models, the request adapters, OpenRouter connect | `packages/ai`, `apps/web/lib/ai-access.ts`, `apps/web/lib/ai-keys.ts`, `apps/web/app/api/ai/openrouter`, `apps/web/components/keys` |
| The server's keys (owner, free prompts), with failover across keys | `apps/web/lib/groq-pool.ts` |
| Usage meter: tokens per key and model, rate limits where reported, freshness | `apps/web/lib/usage.ts`, `apps/web/lib/usage-summary.ts`, `apps/web/lib/usage-probe.ts` |
| Settings: profile, security, your AI, usage, export, delete account | `apps/web/app/(app)/settings`, `apps/web/components/settings`, `apps/web/app/api/export` |

Models on the server's keys (Groq): `openai/gpt-oss-120b` (tutor, planner, marking), `openai/gpt-oss-20b` (memory), `qwen/qwen3.8-27b` (vision). Override them with the `GROQ_*_MODEL` env vars; they're also the defaults for students' Groq keys.

## Contributing

Bug reports, ideas and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately, as [SECURITY.md](SECURITY.md) describes. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

If Confu helps you, you can [sponsor its development](https://github.com/sponsors/narensen).
