# Handoff — UFC Fighter Catalog / Scouting Reports

## Status
Next.js app scaffolded, feature-based folders in place, Supabase project
created, full schema + RLS migrated and verified working. Two data
sources feeding the DB (API-Sports + Wikipedia, deduped against each
other), a working read-only UI (events/fighters, YouTube-style shell,
dark mode), and Supabase Auth (Google + GitHub OAuth) wired up and
verified end-to-end. Full history: see [CHANGES.md](CHANGES.md). Full
architecture/decisions: see [ARCHITECTURE.md](ARCHITECTURE.md).

**Known limitation, unresolved (not a bug, a real-world data conflict):**
the two data sources occasionally report a different opponent for the
same fighter on the same card (CHANGES.md Phase 7). Left as separate rows
on purpose. No policy decided yet for how the UI should handle it if it
recurs.

## What's NOT done yet (next steps, in order)

1. **Build clans + scouting-reports UI** on top of auth, using the
   visibility-model RLS policies already in place since Phase 2 — this is
   the actual point of the app, everything so far has been groundwork
2. **Schedule both sync jobs to run automatically** (daily/weekly, per
   ARCHITECTURE.md) — currently only run manually via `npm run sync`

## Working style for this project (context for Claude, not just the user)

The user is a non-technical "vibe coder" deliberately building up
architecture/security judgment through this project, not just trying to
ship fast. Practical implications:

- Surface real technical forks as questions before deciding (data source
  choices, permission models, etc.) rather than picking silently
- Before calling any Supabase-backed feature "done," explicitly confirm RLS
  is enabled, default-deny, and — as learned the hard way in Phases 2 and
  5 — that table-level GRANTs actually match the policies for *every* role
  that needs access, including `service_role` (RLS bypass and table
  GRANTs are independent; see CHANGES.md Phase 2 and Phase 5)
- Don't trust third-party API docs/marketing over what the API actually
  does — Phase 5 found two undocumented free-tier limits (a ~3-day date
  window, a 10 req/min rate limit) only by triggering the errors. Verify
  external API behavior empirically before designing around it.
- Structure and security take priority over speed of delivery — don't take
  structural shortcuts to move faster without flagging the tradeoff first
- The `app-architect` skill (global, in `~/.claude/skills/`) encodes the
  planning process used to produce ARCHITECTURE.md — reuse it if scope
  expands significantly or a new major feature needs its own mini-planning
  pass
- New migrations go in `supabase/migrations/` as new numbered files — never
  edit an already-applied migration
- Before writing Next.js code, check `node_modules/next/dist/docs/` for this
  version's actual conventions rather than relying on training data — this
  version renamed `middleware.ts` to `proxy.ts` (Next 16), which would have
  silently not run if built from memory instead of checking first
