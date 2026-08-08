# Handoff — UFC Fighter Catalog / Scouting Reports

## Status
Next.js app scaffolded, feature-based folders in place, Supabase project
created, full schema + RLS migrated and verified working. No app UI/features
built yet. Full history of what's been done: see [CHANGES.md](CHANGES.md).
Full architecture/decisions: see [ARCHITECTURE.md](ARCHITECTURE.md).

## What's NOT done yet (next steps, in order)

1. **Pick and wire up the external fighter-data source** — still an open
   decision (see "Open questions" in ARCHITECTURE.md)
2. **Build one feature end-to-end first** — recommended: fighter search +
   profile view (read-only, no auth needed — `fighters`/`events`/`fights`
   are already publicly readable) — to prove the stack works before
   building scouting reports/clans on top of it
3. **Wire up Supabase Auth** (Google + GitHub OAuth) once a feature needs a
   logged-in user (scouting reports, clans)
4. **Seed real data** via the sync layer (`src/lib/ufc-data-sync/`) once the
   external source is chosen

## Working style for this project (context for Claude, not just the user)

The user is a non-technical "vibe coder" deliberately building up
architecture/security judgment through this project, not just trying to
ship fast. Practical implications:

- Surface real technical forks as questions before deciding (data source
  choices, permission models, etc.) rather than picking silently
- Before calling any Supabase-backed feature "done," explicitly confirm RLS
  is enabled, default-deny, and — as learned the hard way in Phase 2 — that
  table-level GRANTs actually match the policies (RLS policies do nothing
  without them; see CHANGES.md Phase 2)
- Structure and security take priority over speed of delivery — don't take
  structural shortcuts to move faster without flagging the tradeoff first
- The `app-architect` skill (global, in `~/.claude/skills/`) encodes the
  planning process used to produce ARCHITECTURE.md — reuse it if scope
  expands significantly or a new major feature needs its own mini-planning
  pass
- New migrations go in `supabase/migrations/` as new numbered files — never
  edit an already-applied migration
