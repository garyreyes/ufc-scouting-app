# Handoff — UFC Fighter Catalog / Scouting Reports

## Status
Next.js app scaffolded, feature-based folders in place, Supabase project
created, full schema + RLS migrated and verified working. Two data
sources feeding the DB: API-Sports (recent/confirmed results, `npm run
sync:recent`) and Wikipedia (upcoming schedule up to ~2 months out, `npm
run sync:schedule`); `npm run sync` runs both. 8 events / dozens of
fighters / ~90 fights live in the DB, spanning already-happened through
mid-October. No app UI/features built yet. Full history: see
[CHANGES.md](CHANGES.md). Full architecture/decisions: see
[ARCHITECTURE.md](ARCHITECTURE.md).

Events, fighters, and fights are now deduplicated across the two sources
(`upsertEvent`/`upsertFighter`/`upsertFight`, all in
`src/lib/ufc-data-sync/`). One real edge case remains open, see below.

**Known limitation, unresolved (not a bug, a real-world data conflict):**
the two sources occasionally report a different opponent for the same
fighter on the same card (found and documented in CHANGES.md Phase 7 —
almost certainly a late replacement one source hasn't caught up on). These
are deliberately left as separate rows rather than guessed at. No policy
decided yet for how the UI should handle this if/when it shows up again
(show both? prefer one source?).

## What's NOT done yet (next steps, in order)

1. **Build one feature end-to-end first** — recommended: fighter search +
   profile view (read-only, no auth needed — real data is already synced)
   — to prove the UI layer works before building scouting reports/clans
2. **Wire up Supabase Auth** (Google + GitHub OAuth) once a feature needs a
   logged-in user (scouting reports, clans)
3. **Schedule both sync jobs to run automatically** (daily/weekly, per
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
