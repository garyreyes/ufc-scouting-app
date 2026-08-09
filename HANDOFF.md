# Handoff — UFC Fighter Catalog / Scouting Reports

## Status
Next.js app scaffolded, feature-based folders in place, Supabase project
created, full schema + RLS migrated and verified working. Two data
sources feeding the DB (API-Sports + Wikipedia, deduped against each
other), a working read-only UI (events/fighters, YouTube-style shell,
dark mode), Supabase Auth (Google + GitHub OAuth), and clans + scouting
reports (both matchup-level and, as of Phase 11, per-fighter notes) —
the actual point of the app — built, with editing added on top. Invite
links and RLS visibility (SPECIFIC_CLANS correctly hidden from non-members)
both verified end-to-end with a real second account. The sync job runs
automatically twice a day via GitHub Actions
(`.github/workflows/sync.yml`). The app is deployed to Vercel and live.
Full history: see
[CHANGES.md](CHANGES.md). Full architecture/decisions: see
[ARCHITECTURE.md](ARCHITECTURE.md).

**Known limitation, unresolved (not a bug, a real-world data conflict):**
the two data sources occasionally report a different opponent for the
same fighter on the same card (CHANGES.md Phase 7). Left as separate rows
on purpose. No policy decided yet for how the UI should handle it if it
recurs.

## What's NOT done yet (next steps, in order)

The app is deployed and live at https://ufc-scouting-app-2jtj.vercel.app/ —
auth (Google + GitHub), fighters/events data, clans + invites, and
scouting reports all verified working there. Sync job runs automatically
twice daily via GitHub Actions. Nothing is currently blocking day-to-day
use.

A full security review (Phase 14) found and fixed one real gap
(`report_clan_shares`/`fighter_report_clan_shares` allowed sharing into
a clan you're not a member of — fixed in
`0010_fix_report_share_clan_membership.sql`), added a manual RLS test
suite (`supabase/tests/rls.sql`) to catch this class of bug before it
reaches real data, and added a CI workflow (`.github/workflows/ci.yml`)
that runs `npm ci` + lint + build on every push.

**Decided:** clan invite links stay as-is — no expiry, unlimited reuse,
revoke manually if needed (works like a Discord invite link). Deliberate
choice, not an oversight — fine for a small trusted friend group where
you control distribution of the link.

Not yet done, lower priority:
- Custom domain (currently on the free `*.vercel.app` subdomain — fine as
  is, only worth it if wanted)
- Inviting friends and actually using it together for a real fight card
- Consolidating `scouting_reports`/`fighter_scouting_reports` into one
  table with a nullable `fight_id`/`fighter_id` instead of two
  near-duplicate schemas (RETROSPECTIVE.md item #3) — real but riskier
  cleanup since it means migrating live data; talk through it before
  starting

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
- When RLS blocks something that looks like it should obviously be
  allowed, test with a simulated session directly in SQL (`set local role
  authenticated; set local "request.jwt.claims" = '...'`) *before*
  chasing infrastructure explanations. Phase 10 burned real time on a
  JWT-signing-key theory (checked Supabase dashboard settings, restarted
  the project) before testing at the SQL level revealed it was a genuine
  policy-logic bug (RLS chicken-and-egg on `RETURNING` / a subquery
  through another table's SELECT policy) — nothing to do with JWTs at all.
  Phase 11 hit the same class of bug again (two policies referencing each
  other directly = recursion) and this time caught it fast with the same
  technique.
- The user has multiple Supabase projects on their account. Before
  running any migration, confirm the project name shown in the dashboard
  matches `ufc-scouting-app` (URL should be
  `vrwlfcywyfzfczajpdoh.supabase.co`, per `.env.local`) — Phase 11 had a
  migration run against an unrelated project by mistake, caught quickly
  by the resulting error but easy to miss if not checking
