# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

No code has been written yet. This repo currently contains only planning docs:
`ARCHITECTURE.md` (full architecture) and `HANDOFF.md` (decisions made + next
steps in order). Read both before doing anything — `HANDOFF.md` in particular
lists the exact next steps in sequence (scaffold Next.js, reshape into
feature folders, set up Supabase, write RLS policies, pick external data
source, build fighter search/profile as the first end-to-end feature).
Once code exists, update this section and remove the pointer to HANDOFF.md's
step list as steps are completed.

## Priorities

Structure and security take priority over speed of delivery. Do not take
structural shortcuts to move faster without flagging the tradeoff first. The
user is deliberately building up architecture/security judgment through this
project (non-technical "vibe coder" learning by doing) — surface real
technical forks (data source choices, permission models, etc.) as questions
rather than deciding silently.

Before calling any Supabase-backed feature "done," explicitly verify:
- RLS is enabled on the table
- Default posture is deny-all with explicit allow-policies matching the
  intended visibility rules
- No endpoint trusts a client-supplied user ID — identity comes from the
  authenticated session only
- Only the Supabase anon/public key is used in frontend code; the
  service-role key never appears client-side or in git

## Architecture (see ARCHITECTURE.md for full detail)

**Stack**: Next.js + TypeScript (App Router), Supabase (Postgres + Auth +
Row Level Security). Auth is Google + GitHub OAuth only, no email/password.

**Entities**: Fighter, Event, Fight, User, Clan, ClanMember,
ScoutingReport, ReportClanShare.
```
Fighter 1---* Fight
Event   1---* Fight
Clan    1---* ClanMember *---1 User
Fight   1---* ScoutingReport *---1 User
ScoutingReport 1---* ReportClanShare *---1 Clan   (only if SPECIFIC_CLANS)
```

**Data source strategy**: fighter/fight data comes from an external source
via a separate sync layer (`lib/ufc-data-sync/`), never called live from the
UI/API. This keeps the app usable even if the external source is down. The
actual external source is not yet chosen (see "Open questions" in
ARCHITECTURE.md).

**Scouting report visibility** — three levels, chosen by the report's
author, enforced via Supabase RLS policies (not app-code checks):
- `PRIVATE` — only the author
- `SPECIFIC_CLANS` — members of clans explicitly attached via
  `ReportClanShare`
- `ALL_MY_CLANS` — anyone sharing any clan with the author
- No fully-public tier — deliberately excluded to preserve anonymity outside
  one's own clans.

**Folder structure** (feature-based; mandatory, not optional):
```
src/
  features/
    fighters/          components/, api.ts, types.ts
    fights/             components/, api.ts, types.ts
    scouting-reports/   components/, api.ts, types.ts
    clans/               components/, api.ts, types.ts
    auth/                components/, api.ts
  shared/                components/, utils/
  lib/
    db.ts
    ufc-data-sync/
    auth-config.ts
  app/                   routing/pages
```
Rule of thumb: if a feature's code needs something from another feature,
that's a signal it either belongs in `shared/`, or the feature boundary is
drawn wrong — revisit before adding to it.

## Reuse the app-architect skill

The global `app-architect` skill (in `~/.claude/skills/`) encodes the
planning process used to produce ARCHITECTURE.md. Reuse it if scope expands
significantly or a new major feature needs its own mini-planning pass before
implementation.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
