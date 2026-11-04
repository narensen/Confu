# Contributing

Thanks for helping. Bug fixes, features, docs and translations are all welcome.

## Setup

You need [Bun](https://bun.sh) and a free [Supabase](https://supabase.com) project.

```bash
bun install
cp apps/web/.env.example apps/web/.env.local   # Supabase URL and key, KEY_ENCRYPTION_SECRET
bun dev
```

Run `supabase/schema.sql` once in your project's SQL editor (see [`supabase/README.md`](supabase/README.md)). For AI, connect any provider in **Settings → Your AI**. Groq's free tier is enough to develop with.

## Before you open a pull request

```bash
bun run typecheck
bun run lint
bun run test
```

CI runs these, plus a production build and a secret scan, on every pull request.

- **Bun only.** Don't commit a `package-lock.json` or `yarn.lock`.
- **Keep diffs focused.** There's no formatter config, so don't run Prettier over whole files; match the style around your change.
- **Add a test** for logic you change. Each workspace keeps its tests in its own `tests/` folder; `bun run test` runs them all.
- **UI changes** need a screenshot in the pull request, in light and dark mode if colours change.
- **Students see the words you write.** Error messages, buttons and help text should be plain and specific. Changes students would notice get a line in `apps/web/lib/changelog.ts`.

## Where things are

The README's [How it works](README.md#how-it-works) table maps each feature to its code. In short:

| Area | Code |
| --- | --- |
| Tutor logic: prompts, citations, math, diagrams | `packages/core` |
| Retrieval, memory, plans, marking (they still read the database) | `apps/web/lib/tutor/` |
| AI providers and the request adapters | `packages/ai`, `apps/web/lib/ai-access.ts` |
| Pages and API routes | `apps/web/app/` |
| Components | `apps/web/components/` |
| Database | `supabase/schema.sql` |

This project uses Next.js 16, which differs from older versions. Check `apps/web/node_modules/next/dist/docs/` before relying on an API you remember.

## Reporting bugs and ideas

Open an [issue](https://github.com/narensen/ConfuAI/issues/new/choose). For anything security-related, follow [SECURITY.md](SECURITY.md) instead.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
