# Handoff — UFC Fighter Catalog / Scouting Reports

## Status: Architecture complete. No code written yet.

This file exists so a fresh Claude Code session (e.g. after pushing to
GitHub and reopening this repo) has full context without the user needing
to re-explain everything from scratch.

## What's been decided (full detail in ARCHITECTURE.md)

- **Entities**: Fighter, Event, Fight, User, Clan, ClanMember,
  ScoutingReport, ReportClanShare
- **Data source**: fighter/fight data pulled from an external source (not
  manual entry), via a sync layer — the UI/app never calls the external
  source live
- **Multi-user, shared via Clans** (friend groups), not solo
- **Scouting report visibility**: PRIVATE / SPECIFIC_CLANS / ALL_MY_CLANS,
  no fully-public tier (deliberate, to preserve anonymity outside one's
  clans)
- **Backend**: Supabase (Postgres + Auth + Row Level Security), chosen
  specifically so visibility rules are enforced as DB policies, not
  scattered app-code checks
- **Auth**: Supabase Auth, Google + GitHub OAuth only (no email/password)
- **Frontend stack**: Next.js + TypeScript (decided — folder-based routing
  maps naturally onto the feature-based structure below; TypeScript catches
  data-shape bugs early and documents entity shapes)
- **Folder structure**: feature-based (`features/fighters`,
  `features/fights`, `features/scouting-reports`, `features/clans`,
  `features/auth`, plus `shared/`, `lib/`, `app/`) — see ARCHITECTURE.md for
  the full layout and the reasoning for each boundary
- **Standing priority**: structure and security take priority over speed of
  delivery for this project. Don't take structural shortcuts to move faster
  without flagging the tradeoff first.

## What's NOT done yet (the actual next steps, in order)

1. **Scaffold the project** — `npx create-next-app@latest` (TypeScript,
   App Router), then reshape the generated skeleton into the
   `features/`/`shared/`/`lib/` structure from ARCHITECTURE.md
2. **Run `/init`** in this repo to generate a proper `CLAUDE.md`, and add a
   `## Priorities` section stating structure/security > speed, feature-based
   folders are mandatory, and RLS must be verified before any
   Supabase-backed feature is considered done
3. **Set up the Supabase project** — create it on supabase.com, get API
   keys, put them in `.env.local` (never commit this file), create the
   actual database tables for each entity
4. **Write RLS policies** for each table — turn the visibility model above
   into real Postgres row-level-security policies, default-deny first
5. **Pick and wire up the external fighter-data source** — still an open
   decision, not yet chosen (see "Open questions" in ARCHITECTURE.md)
6. **Build one feature end-to-end first** — recommended: fighter search +
   profile view (read-only, no auth needed yet) — to prove the stack works
   before building scouting reports/clans on top of it. Don't build
   everything from ARCHITECTURE.md at once.

## Working style for this project (context for Claude, not just the user)

The user is a non-technical "vibe coder" deliberately building up
architecture/security judgment through this project, not just trying to
ship fast. Practical implications:

- Surface real technical forks as questions before deciding (data source
  choices, permission models, etc.) rather than picking silently — this was
  explicitly requested and worked well during the architecture phase
- Before calling any Supabase-backed feature "done," explicitly confirm RLS
  is enabled and default-deny
- The `app-architect` skill (global, in `~/.claude/skills/`) encodes the
  planning process used to produce ARCHITECTURE.md — reuse it if scope
  expands significantly or a new major feature needs its own mini-planning
  pass

## Files in this repo so far

- `ARCHITECTURE.md` — the full plan (entities, data flow, security
  baseline, folder structure)
- `HANDOFF.md` — this file
- (nothing else yet — no code, no `package.json`)
