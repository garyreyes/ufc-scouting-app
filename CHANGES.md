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

## Phase 5 — Sync job implemented, free-tier limits discovered (2026-08-09)

**Changed:**
- `src/lib/ufc-data-sync/client.ts` — shared fetch wrapper for API-Sports,
  now with built-in request throttling (see below)
- `fetchFighter.ts` — fetches one fighter, converts height/reach strings
  (`"6' 0'"`, `"66'"`) to cm
- `fetchFightHistory.ts` — fetches fights for a date, filters to UFC by
  matching the event `slug` against `"UFC"` (no promotion filter exists)
- `syncJob.ts` — walks a rolling window of dates, upserts events → fighters
  → fights in that order (fights need the other two's generated ids)
- `npm run sync` script (`dotenv-cli` + `tsx`) to run it standalone
- `supabase/migrations/0003_service_role_grants.sql` — `service_role`
  needed explicit table GRANTs too, same root cause as 0002 (raw SQL
  migrations skip Supabase's dashboard-triggered default grants; RLS
  bypass and table-level GRANTs are independent things)

**Discovered the hard way (undocumented, found by triggering the errors):**
- The free plan's `date` param isn't just "no ranges" — it only accepts a
  narrow rolling window (~3 days) ending near today. Older AND future
  dates are both rejected. There is no way to reach upcoming fight cards
  or deep history on the free plan.
- That window's exact boundary doesn't line up cleanly with UTC "today"
  (likely a timezone difference on the API's side) — so `syncJob.ts`
  doesn't try to compute the exact valid range; it just tries a slightly
  wider window and skips + warns on any date the API rejects.
- Free plan also caps at **10 requests/minute** (separate from the 100/day
  cap). `client.ts` now serializes every call through a shared queue with
  a 6.5s minimum gap between requests.
- No `method`/`round` fields exist anywhere in the API's fight data, even
  for finished fights — only a winner boolean per fighter. Those two
  columns on `fights` will stay null until/unless a richer source is
  added.

**Status:** ran successfully end-to-end against the live project: 1 event,
22 fighters, 11 fights written and confirmed readable back via the public
anon key, including PostgREST FK-embedding (`fighter1:fighter1_id(name)`).
Some fighters have null height/reach/stance — the API itself doesn't have
that data for them, not a parsing bug.

**Important open problem:** because the free plan can't reach future
dates, the sync job **cannot populate upcoming/announced fights** — only
whatever falls in the last ~2-3 days. This directly limits the "scouting
report on an upcoming fight" use case. Not yet resolved — options are:
upgrade the API plan, find a secondary source just for the schedule, or
scope the MVP to already-happened fights only. Needs a decision before
building the scouting-reports feature.

**Next:** decide how to handle the upcoming-fights gap above, then build
fighter search/profile (read-only) as the first end-to-end UI feature.

## Phase 6 — Wikipedia schedule source, resolving the upcoming-fights gap (2026-08-09)

**Changed:**
- `src/lib/ufc-data-sync/fetchSchedule.ts` — lists upcoming UFC events via
  Wikipedia's `Category:Scheduled mixed martial arts events` and parses
  each event's `{{MMAevent bout}}` wikitext template (weight class, both
  fighters, and — bonus — method/round/time when already finished, which
  API-Sports never provides at all)
- `src/lib/ufc-data-sync/syncSchedule.ts` — new sync entry point
  (`npm run sync:schedule`) that writes Wikipedia's schedule into
  events/fighters/fights
- `src/lib/ufc-data-sync/supabaseAdmin.ts` — extracted the admin client
  builder (now shared by `syncJob.ts` and `syncSchedule.ts`)
- `src/lib/ufc-data-sync/upsertFighter.ts` / `upsertEvent.ts` — shared
  find-or-create-or-update helpers so a fighter/event created by one
  source (e.g. a Wikipedia placeholder with no `external_id`) gets updated
  in place by the other source later instead of duplicated. `upsertEvent`
  falls back to a punctuation/case-normalized name match (API-Sports says
  `"...vs Salkilld"`, Wikipedia says `"...vs. Salkilld"` — same event,
  different string). `syncJob.ts` refactored to use both.
- `npm run sync` now runs `sync:recent` (API-Sports) then `sync:schedule`
  (Wikipedia) in sequence.

**Why:** Phase 5 found the API-Sports free tier has zero lookahead — not
even tomorrow is reachable. That breaks the core "scout an upcoming fight"
use case. Wikipedia's event pages are free, unauthenticated, and already
list fight cards weeks in advance in a template structured enough to
parse reliably.

**Status:** verified live. `listUpcomingUfcEventTitles()` found 12 UFC
events; `sync:schedule` wrote 8 events (4 filtered out for missing
date/bouts) spanning `2026-08-08` to `2026-10-17` and 71 fights. The
predicted event-name mismatch happened on the very first run — merged
manually via a one-off cleanup (repoint fights, delete the duplicate row)
after explicit user confirmation, since it was a destructive DB write.
`upsertEvent` now prevents new instances of this going forward.

**Known limitation, not solved:** events and fighters merge across the
two sources; individual **fights do not**. The merged event above still
has 23 fight rows for ~11-12 actual bouts (one set from API-Sports, one
from Wikipedia, same fighters via name-matching but unlinked as fights).
Matching fights across sources needs to key off "same event + same
fighter pair," not attempted yet. Will need addressing before the fighter
profile / fight history UI is built, or fight cards will show duplicates.

**Next:** decide how to de-duplicate fight rows across sources (or filter
in the query layer for now), then build fighter search/profile as the
first end-to-end UI feature.

## Phase 7 — Fight-level dedup across sources (2026-08-09)

**Changed:**
- `src/lib/ufc-data-sync/upsertFight.ts` — new shared helper, same pattern
  as `upsertFighter`/`upsertEvent`: matches by `external_id` first, falls
  back to (event, unordered fighter-pair) match, so a bout described by
  both sources merges into one row
- `src/lib/ufc-data-sync/stripNullish.ts` — new small helper, used by
  `upsertFight` and (retrofitted) `upsertFighter`: drops null/undefined
  keys before any `.update()` call, so a partial write from one source
  (e.g. API-Sports never has `method`/`round`) can't blank out a field
  only the other source knows
- `syncJob.ts` / `syncSchedule.ts` refactored to call `upsertFight`
  instead of building bulk-upsert arrays / hand-rolled find-or-insert

**Discovered while planning the cleanup — not just a formatting problem:**
pulled every fight row for the one event with both sources' data and
found the two sources sometimes disagree on **facts**, not just naming.
For that card: 8 of 12 Wikipedia bouts matched an API-Sports bout by
identical fighter-id pair; 1 pair was a fighter-identity miss ("Diego
Ferreira" vs "Carlos Diego Ferreira" — same person, two fighter rows,
confirmed and merged); 2 pairs had **genuinely different reported
opponents** for the same fighter (Louie Sutherland vs. "Henrique da Silva
Lopes" per API-Sports, vs. "José Luiz" per Wikipedia; Miles Johns vs.
"Jessie Rosas" per API-Sports, vs. "Gianni Vázquez" — with a confirmed
result — per Wikipedia), almost certainly a late opponent replacement one
source hasn't caught up on. Decided, with the user, not to auto-merge
those two: no reliable way to know which source is stale.

**Cleanup performed (destructive, done only after explicit user
confirmation):** merged the "Carlos Diego Ferreira" fighter duplicate into
"Diego Ferreira" (repointed its fights, deleted the row); merged the one
duplicate pair that had real data to preserve (winner/method/round) onto
the API-Sports row; deleted 8 other now-fully-redundant Wikipedia rows.
Net: 23 → 14 fight rows for that event (11 original + 3 legitimately
distinct: the two disputed-opponent bouts, left alone on purpose, plus one
bout API-Sports never had at all).

**Still open:** the conflicting-opponent case has no general fix — it's a
real-world data disagreement, not a bug. If it recurs, the UI will need to
either show both or pick a "preferred source" policy; not designed yet.
