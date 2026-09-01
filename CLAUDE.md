# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Status

**Shipped and live**, at <https://ufc-scouting-app-2jtj.vercel.app/> — Phases
1–14 complete. Auth, fighter/event data, and the twice-daily sync job all run
in production.

**The project has been re-scoped to v2** (see `docs/PRD.md`): a solo tool for
one user. The v1 group features — clans, invites, shared scouting reports —
are **frozen, not deleted**: their code and tables stay, their routes stay
reachable, and no further development happens on them. Do not extend them,
and do not start the `scouting_reports`/`fighter_scouting_reports` table merge
described in `HANDOFF.md` — it is cancelled permanently.

## Read these first, in this order

| File | What it owns |
|---|---|
| `docs/PRD.md` | **Product truth.** What and why. Wins any disagreement |
| `ARCHITECTURE.md` | **The stack**, entities, schema decisions, layer boundaries |
| `PROJECT_FACTS.md` | Durable decisions that shouldn't be re-litigated |
| `CHANGES.md` | Dated log of what actually shipped, phase by phase |
| `HANDOFF.md` | v1-era status. **Partly superseded** — the PRD wins |

## Stop and ask — never proceed carefully

These are halts, not judgment calls.

1. **Never hand-roll authentication, sessions, or cryptography** — including
   password hashing, JWT signing/verification, token generation, or
   password-reset flows. Use Supabase Auth and its documented configuration.
2. **Never hand-build raw payment or OAuth requests.** Use the official SDK,
   never a manual `fetch` with hand-assembled headers, signatures, redirect
   params, or state/nonce handling.
3. **Every third-party SDK gets exactly one wrapper module** in `lib/`.
   Feature code imports the wrapper, never the SDK or raw API directly. This
   applies to Supabase, The Odds API, Reddit, and Gemini alike.

## Requires explicit confirmation before acting

- **Running any database migration.** Since 2026-09-01, Claude applies
  migrations directly via `supabase db push --linked` (reconciled with
  `migration repair` after the CLI's tracking table was found out of sync
  — see `PROJECT_FACTS.md`). The user has multiple Supabase projects — the
  dashboard-screenshot check that caught Phase 11's mistake no longer
  applies automatically, so before every push: re-run `supabase migration
  list --linked` or check `supabase/.temp/project-ref`, and state the
  target project ref out loud (must read `vrwlfcywyfzfczajpdoh`, never
  `mbytqdkgwpzaensnphwd` — "GAMBLING TRACKER," still on the account). This
  confirmation is not optional just because it's automated now.
- **Pushing to `main`.** Vercel auto-deploys from it — a push is a production
  deploy, not a save.
- **Any destructive data operation** — deleting or merging rows, dropping
  tables, editing live data. Phase 7's duplicate cleanup was done only after
  explicit confirmation, and that remains the standard.
- **Never edit an already-applied migration.** New numbered file in
  `supabase/migrations/`, always.

## Gates

`npm run lint`, `npm run test`, `npm run build` (build includes the TypeScript
check). CI runs all three on every push and PR as the job **`gates`**, which
branch protection requires **by name** — renaming the job silently disables
protection, because a required check that never posts blocks merges forever
instead of failing loudly.

Docs-only changes get markdown lint instead of the full suite. `.github/**`,
`package.json`, and the lockfile deliberately count as code.

## Before calling any Supabase-backed feature done

- RLS enabled on the table
- Default posture deny-all, with explicit allow-policies matching the intended
  rules
- **Table GRANTs match the policies for every role that needs access,
  including `service_role`** — RLS bypass and GRANTs are independent. Phases 2
  and 5 both lost time to this
- No endpoint trusts a client-supplied user ID — identity comes from the
  session
- Only the anon key appears in frontend code; the service-role key never goes
  client-side and never enters git

**When RLS blocks something that looks like it should obviously be allowed**,
test with a simulated session directly in SQL (`set local role authenticated;
set local "request.jwt.claims" = '...'`) *before* chasing infrastructure
explanations. Phase 10 burned real time on a JWT-signing theory before SQL
testing revealed a genuine policy-logic bug. Phase 11 hit the same class of
bug and caught it fast with this technique.

## Layer boundaries — enforced as file layout, not discipline

- **UI components** render and handle interaction. No business logic, no
  external calls, ever.
- **Services** (`api.ts` / `actions.ts` / `lib/`) hold business logic and own
  every outbound call — Supabase, Reddit, odds, Gemini.
- **Route handlers** stay thin: parse, call a service, return.

If a feature needs something from another feature, it belongs in `shared/` or
the boundary is drawn wrong. Revisit rather than reach across.

Actual structure (`lib/supabase/` holds the clients — there is no `db.ts` or
`auth-config.ts`):

```text
src/
  features/   fighters/ fights/ auth/ + [FROZEN] scouting-reports/ clans/
  shared/     components/, utils/
  lib/        supabase/, ufc-data-sync/
  app/        routing/pages — thin
  proxy.ts    middleware (Next 16 renamed middleware.ts to proxy.ts)
```

## Test-first, for correctness-critical work only

Money math, auth/permission checks, counting, and ID resolution get a
**failing test written before the implementation**, and "done" means the test
was run and observed passing — never "this should pass now." `ARCHITECTURE.md`
lists the eight items this covers for v2.

Layout, copy, styling, and animation get no tests — there is no single correct
output to assert.

## Working style

Structure and security take priority over speed. Don't take structural
shortcuts to move faster without flagging the tradeoff first. The user is a
non-technical "vibe coder" deliberately building architecture and security
judgment through this project — **surface real technical forks as questions
rather than deciding silently.**

**Do not trust third-party docs over what the API actually does.** Phase 5
found two undocumented API-Sports free-tier limits (a ~3-day date window, a 10
req/min cap) only by triggering the errors. During v2 planning, UFCStats.com
was rejected after a live check found every page behind a JavaScript
proof-of-work wall. Verify external behaviour empirically before designing
around it.

**Before writing Next.js code, check `node_modules/next/dist/docs/`** for this
version's real conventions rather than relying on training data.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
