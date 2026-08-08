# Changes

Append-only log, one entry per phase of work. Entries are never edited after
being written — if something turns out wrong, a later entry corrects it.
Read this first in a new session to catch up fast; see HANDOFF.md for
current status/next steps and ARCHITECTURE.md for the design.

## Phase 1 — Next.js scaffold + feature folders (2026-08-09)

**Changed:**
- Scaffolded with `create-next-app` (TypeScript, App Router, ESLint, no
  Tailwind), `src/` layout
- Reshaped into the feature-based structure from ARCHITECTURE.md:
  `src/features/{fighters,fights,scouting-reports,clans,auth}/`
  (`api.ts`, `types.ts`, `components/`), `src/shared/`, `src/lib/`
  (`db.ts`, `auth-config.ts`, `ufc-data-sync/`) — all placeholder/empty,
  no logic yet
- Installed `@supabase/supabase-js`; `src/lib/db.ts` reads
  `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` and throws
  if missing
- Added `CLAUDE.md` for future sessions
- `.gitignore` carries an exception (`!.env*.example`) so example env files
  can be committed while real `.env*` files stay ignored

**Status:** `npm run build` passes. No Supabase project existed yet at this
point, so `src/lib/db.ts` was unverified.

**Next:** create the Supabase project, wire up real env values.

## Phase 2 — Supabase schema + RLS (2026-08-09)

**Changed:**
- Supabase project created (region: Asia-Pacific), "Automatically expose
  new tables" deliberately left unchecked, "Enable automatic RLS" left on
- `.env.local` filled with the project's URL + publishable key
- `supabase/migrations/0001_init_schema.sql` — all 8 tables from
  ARCHITECTURE.md, RLS enabled on every table, visibility model implemented
  as policies (`fighters`/`events`/`fights` public-read; `clans`/
  `scouting_reports`/etc. gated by membership or authorship), two
  `security definer` helper functions (`is_clan_member`,
  `shares_clan_with`) to avoid RLS self-recursion on `clan_members`, plus a
  trigger to create a `profiles` row on new `auth.users` signup
- `supabase/migrations/0002_grants.sql` — follow-up migration granting
  table-level privileges to `anon`/`authenticated`

**Why the second migration was needed:** RLS policies only take effect once
a Postgres role already has table-level GRANTs. The dashboard normally
auto-grants these when "Automatically expose new tables" is on, but that
was deliberately left off (see above), and raw SQL migrations don't get
that auto-grant either way — so after 0001 alone, every table returned
`401 permission denied` for every role, policies notwithstanding. 0002
grants exactly the operations each table's policies allow, no more.

**Status:** verified via direct REST calls against the live project.
`fighters`/`events`/`fights` return `200 []` with the anon key (public,
empty — no data seeded yet). `clans`/`clan_members`/`scouting_reports`/
`report_clan_shares`/`profiles` return `401` with the anon key, as expected
since those are `authenticated`-only — not yet tested with a real logged-in
user since auth isn't wired up yet.

**Next:** pick the external fighter-data source, then build fighter
search/profile (read-only, no auth needed) as the first end-to-end feature.

## Phase 3 — External data source decision (2026-08-09)

**Changed:**
- ARCHITECTURE.md's "Open questions" resolved: external data source is
  **API-Sports MMA API** (api-sports.io), chosen over scraping
  UFCStats.com (unlicensed/fragile) and Wikidata (too thin on fight
  stats). Free tier is 100 requests/day, judged sufficient for a
  daily/weekly batch sync if done via paginated pulls.

**Status:** decision only — `src/lib/ufc-data-sync/` is still empty
placeholder files. Depth of available stats (strikes, takedowns, etc.) not
yet confirmed against the live API.

**Next:** get an API-Sports account + key, confirm actual endpoint/stat
coverage, then implement `fetchFighter.ts` / `fetchFightHistory.ts` /
`syncJob.ts`.

## Phase 4 — API-Sports key wired up + verified (2026-08-09)

**Changed:**
- API-Sports account created, MMA API key added to `.env.local` as
  `UFC_API_SPORTS_KEY` (server-only, no `NEXT_PUBLIC_` prefix)
- `.env.local.example` updated with a placeholder for it
- Verified live: `/fighters?search=` returns name/height/weight/reach/
  stance; `/fights?date=` returns date, weight class, both fighters, and a
  `slug` naming the event card (e.g. `"UFC Fight Night: Gamrot vs
  Salkilld"`). No dedicated promotion/org filter endpoint exists —
  `/leagues`, `/promotions`, `/events` all 404. UFC-scoping will need to
  match on `slug` containing `"UFC"`.
- ARCHITECTURE.md's data source section updated with these confirmed
  fields/constraints

**Status:** API key confirmed working end-to-end (real 200 responses with
real fighter/fight data). Depth of granular per-fight stats (strikes
landed, takedown %) still unconfirmed — not needed until scouting reports
reference specific fight stats.

**Next:** implement `src/lib/ufc-data-sync/` (`fetchFighter.ts`,
`fetchFightHistory.ts`, `syncJob.ts`), then build the fighter search/
profile feature as the first end-to-end vertical slice.
