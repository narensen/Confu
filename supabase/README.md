# Database

`schema.sql` is the whole Confu database. One file, 8,780 lines.

Run it once on an empty Supabase project. It creates:

- Every table, index, constraint, and trigger in `public`
- The functions the app calls: search, plans, reviews, friends, spaces, moderation, insights, reminders, and account deletion
- Row level security, and the grants for the roles `anon`, `authenticated`, and `service_role`
- The profile row created when someone signs up (`on_auth_user_created` on `auth.users`)
- The private `documents` storage bucket (50 MB; PDF, JPEG, and PNG) and the four policies that keep each account's files in its own folder
- The 33 subject spaces
- The Semantic Scholar rate-limit row (`rate_slots`)
- `notifications` added to the `supabase_realtime` publication, when that publication exists

`pgcrypto` is created in `public` when the project does not already have it. Supabase usually has it already, and this file leaves the existing one where it is.

## Fresh project

1. Create a Supabase project.
2. Open the SQL editor, paste `schema.sql`, and run it once.

Or, with the connection string from **Project Settings → Database**:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
```

The project must not already contain Confu tables. Supabase provides `auth.users`, `auth.uid()`, the `storage` schema, and the roles `anon`, `authenticated`, and `service_role`. This file uses those. It does not create them.

Then make yourself the owner, as the setup section of the main README describes.

The HTML files in `email-templates/` are for **Authentication → Emails**. They are separate from this schema.

## A database that already runs Confu

Do not run `schema.sql` on it. The script creates every object from scratch, and the first table that already exists stops it. It will not upgrade an older database, and it is not safe to treat as a migration.

The numbered files that used to live in `supabase/migrations/`, and the two paste files `community-paste.sql` and `section-loop-paste.sql`, were folded into this file and removed. This file is the result of applying those migrations in order on an empty database and keeping the final shape: tables, functions, policies, grants, the sign-up trigger, the storage bucket, and the subject-space rows.

Migrations 0023 and 0024 were never in this repository, so study packs and class-rep Pro are not created here. Functions that look for a `packs` table check for it and return without writing when it is absent.
