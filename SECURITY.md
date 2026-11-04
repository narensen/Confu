# Security

## Reporting a vulnerability

Email **confuedu.ai@gmail.com** with "Security" in the subject. Please don't open a public issue.

Include what you found, how to reproduce it, and what it affects. You'll get a reply within a few days. Once it's fixed, you'll be credited in the changelog if you'd like.

## What matters most

- **AI keys.** Students' API keys are encrypted with AES-256-GCM (`apps/web/lib/crypto.ts`), bound to their account, and must never appear in logs, responses, exports or error messages.
- **Server-side requests.** Confu fetches URLs on a student's behalf (web imports, papers, custom model servers). Those must not reach private networks (`apps/web/lib/import/safe-fetch.ts`, `packages/ai/src/net.ts`, `packages/ai/src/openai-compat.ts`) unless the operator opts in with `ALLOW_PRIVATE_AI_URLS=1`.
- **Row level security.** Every table in `supabase/schema.sql` is protected by RLS. Anything that lets one account read or change another's data is in scope.
- **Rendered model output.** Tutor answers render Markdown, KaTeX, Mermaid and SVG. Script injection through any of them is in scope (`packages/core/src/tutor/diagram.ts`).

## Supported versions

Only the latest `main` is supported. Self-hosted deployments should update to it.
