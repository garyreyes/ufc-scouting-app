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

## Phase 8 — First UI: events/fighters pages, YouTube-style shell (2026-08-09)

**Changed:**

- App shell (`src/shared/components/`): collapsible icon-rail sidebar
  (Upcoming Events / Past Events / Fighters), top bar with fighter-name
  search + multi-select weight-class filter synced to the URL, dark-by-
  default theme with a manual toggle (localStorage + a blocking init
  script to avoid a flash of the wrong theme on load)
- Pages, all reading live Supabase data: `/events/upcoming`, `/events/past`,
  `/events/[id]` (full card, winners highlighted), `/fighters`
  (searchable/filterable grid), `/fighters/[id]` (bio + fight history with
  a real W-L record derived from `fights.winner_id`, not the unpopulated
  `fighters.wins`/`losses` columns). Root route redirects to
  `/events/upcoming`.
- `getFighters()`/fighter profile: fall back to the weight class of a
  fighter's most recent fight when their own record doesn't have one yet
  (affects Wikipedia-only placeholder fighters). Initially only added to
  the profile page; the user caught that the grid still showed "unknown"
  for the same fighters, so extended to `getFighters()` too via one
  batched query (not per-fighter, to avoid N+1).

**Bug found by the user, fixed same session:** the weight-class filter
matched `fighters.weight_class` directly, but ~128 of ~144 fighters have
that column null (only resolvable via the fights-fallback above) — so
filtering by e.g. Flyweight+Bantamweight returned nothing despite
Flyweight fighters clearly visible on screen. Fixed by filtering against
the resolved value instead of the raw column.

**Status:** verified live via curl against the dev server (real event/
fighter names render, filter returns correct fighters after the fix).
Interactive behavior (hamburger collapse, filter popover, theme toggle)
only checked by the user in-browser, not automatable from here.

**Next:** wire up Supabase Auth so clans/scouting-reports — the actual
point of the app — can get built on top of what's here.

## Phase 9 — Supabase Auth wired up (Google + GitHub OAuth) (2026-08-09)

**Changed:**

- Installed `@supabase/ssr`; added `src/lib/supabase/client.ts` (browser,
  cookie-based session) and `server.ts` (Server Components/Route
  Handlers, async `cookies()`) alongside the existing plain client in
  `lib/db.ts` (kept as-is for public reads that don't need to know who's
  logged in)
- `src/proxy.ts` — refreshes the session cookie on every request. Built as
  `proxy.ts`, not `middleware.ts`: Next.js 16 renamed the convention
  (confirmed in this version's bundled docs before writing it — the two
  aren't interchangeable, `middleware.ts` would silently not run)
- `src/app/auth/callback/route.ts` — exchanges the OAuth code for a
  session, redirects back into the app
- `src/features/auth/api.ts` (`signInWithOAuth`, `signOut`) and
  `components/AuthButton.tsx` — self-contained client component managing
  its own auth state via `onAuthStateChange`, wired into `TopBar`
- `src/lib/requireEnv.ts` — small helper so the "missing env var" checks
  type-check correctly inside functions (TypeScript doesn't carry a
  module-level null-check's narrowing into a function defined below it);
  retrofitted into `lib/db.ts` too for consistency

**External setup (user did this, not scriptable):** created a Google
Cloud OAuth client and a GitHub OAuth App, both with their authorization
callback URL pointed at Supabase's own callback
(`https://<project-ref>.supabase.co/auth/v1/callback`), then entered both
providers' client ID/secret into Supabase's Authentication → Providers.

**Status:** verified end-to-end — signed in via both providers, confirmed
a `profiles` row was created automatically (via the `handle_new_user`
trigger from Phase 2's migration) with the real display name from OAuth.
Full chain works: OAuth login → `auth.users` insert → trigger →
`profiles` row → readable back out.

**Next:** build clans + scouting-reports UI on top of auth, using the
visibility-model RLS policies already in place since Phase 2.

## Phase 10 — Clans + scouting reports UI, three real RLS bugs found and fixed (2026-08-09)

**Changed:**

- `supabase/migrations/0004_clan_invites.sql` — invite-link system for
  adding clan members (the original "owner adds members" policy from
  0001 could only add someone whose id you already had, with no way to
  look one up). Adds a `clan_invites` table plus `accept_clan_invite()`
  and `get_invite_clan_name()`, both `security definer` so acceptance
  doesn't need to relax `clan_members`' direct-insert policy at all
- `src/app/fights/[id]/` — fight detail page (bout info + scouting
  reports thread + compose form), linked from `BoutRow`'s new "Scouting
  reports →" link
- `src/app/clans/`, `src/app/invite/[token]/` — clan list/detail pages,
  invite-link management (create/copy/revoke), invite acceptance page
- `src/features/clans/`, `src/features/scouting-reports/` — `api.ts`
  (reads, via the session-aware server client so RLS naturally scopes
  results to "what this user can see") and `actions.ts` (`"use server"`
  mutations: create/leave clan, create/revoke invite, accept invite,
  create/delete report)
- `src/lib/isInvalidIdError.ts` — malformed id in a URL (typo, stale
  link) now reads as a normal 404 instead of crashing the page (Postgres
  error `22P02`, caught in every `getById`-style query)
- `signInWithOAuth` now accepts an optional `next` path, threaded through
  from wherever `AuthButton` is clicked (via `usePathname`) — needed so
  the invite-acceptance flow returns the user to the same invite page
  after signing in, not just always to `/events/upcoming`

**Three real bugs found through live debugging, not written correctly the
first time:**

1. **Missing `service_role` grants on a new table (a third time).** Same
   root cause as Phase 2/5 (`0002`, `0003`): a `GRANT ... ON ALL TABLES`
   only covers tables that exist *at that moment*, not ones created
   later, and `clan_invites` was created after those migrations ran.
   Fixed properly this time instead of patching again: `0005_service_
   role_default_privileges.sql` uses `ALTER DEFAULT PRIVILEGES` so
   `service_role` automatically gets full access to every future table.
   (`anon`/`authenticated` stay deliberately manual per table — that's
   the actual security boundary; `service_role` never needed to be.)

2. **PostgREST embedding needs a real foreign key.** `profiles:user_id(
   display_name)` queries on `scouting_reports` and `clan_members` failed
   with `PGRST200` — both columns referenced `auth.users(id)`, not
   `profiles(id)`, and PostgREST can't infer an embed through a shared-
   but-indirect reference. `0006_fk_to_profiles.sql` repoints those FKs
   (and `clans.created_by`, `clan_invites.created_by` for consistency) at
   `profiles(id)` instead — still exactly as valid a reference, since
   `profiles.id` already equals `auth.users.id` 1:1 via `handle_new_user`.

3. **RLS chicken-and-egg on `clans` creation, two layers deep.** Spent a
   long detour on this one — first hypothesis was a Supabase JWT-signing-
   key propagation issue (the project uses the newer ES256 asymmetric
   keys), tested via the dashboard and a project restart, neither
   resolved it. The actual cause, found by testing directly in the SQL
   editor with a simulated session (`set local role authenticated`) to
   isolate the HTTP layer entirely: **(a)** `createClan`'s
   `.insert().select("id")` requested the row back, but Postgres RLS
   requires a just-inserted row to also pass the table's SELECT policy
   before `RETURNING` can return it — and `clans`' SELECT policy is
   `is_clan_member(id)`, false for the creator until the *next* insert
   (into `clan_members`) runs. Fixed by generating the id client-side
   (`randomUUID()`) so the insert never needs `RETURNING` at all.
   **(b)** Once that surfaced, the `clan_members` insert failed too, for
   the same underlying reason one level deeper: its own policy checks
   `exists (select 1 from clans where created_by = auth.uid())`, and that
   subquery is *also* subject to `clans`' SELECT policy — so a clan's
   brand-new creator could never pass it either, for any clan, ever.
   `0007_fix_clan_owner_chicken_egg.sql` adds an `is_clan_owner()`
   security-definer helper (same pattern as `is_clan_member()` from 0001)
   so this ownership check bypasses `clans`' RLS, and applies it to both
   `clan_members`' and `clan_invites`' policies.

**Lesson for next time:** when RLS blocks something that looks like it
should obviously be allowed, test with a simulated session directly in
SQL (`set local role authenticated; set local "request.jwt.claims" =
...`) *before* chasing infrastructure explanations (JWT keys, caching,
propagation) — it isolates app/network/auth-layer causes from actual
policy-logic bugs in one query, far faster than dashboard exploration.

**Status:** verified end-to-end live — created a clan ("mma"), confirmed
both the `clans` row and the creator's `clan_members` row exist. Invite
link generation/acceptance and scouting report create/visibility not yet
independently verified beyond code review (session paused here).

**Next:** verify invite links and scouting-report visibility rules
(PRIVATE / SPECIFIC_CLANS / ALL_MY_CLANS) actually work end-to-end with a
second account; schedule both sync jobs to run automatically.

## Phase 11 — Finished verifying Phase 10, added individual fighter reports (2026-08-09)

**Changed:**

- Two more crashes found via live testing, both the same class as prior
  fixes: `InviteManager` referenced `window.location.origin` during
  render, which doesn't exist during server rendering (client components
  still render server-side first) — fixed by keeping the displayed text a
  relative path and only touching `window` inside the click handler.
  `/clans/[id]` queried `clans` unconditionally, but that table has no
  `anon` grant at all by design — logged-out visitor guard added, same
  fix as the fight detail page in Phase 10.
- **New feature, requested mid-session after seeing the matchup report
  UI:** individual fighter reports — notes attached to a fighter directly
  (e.g. "good wrestling"), not to one specific bout, so the same note
  shows on every fight page that fighter appears in and on their profile.
  `supabase/migrations/0009_fighter_scouting_reports.sql` — new
  `fighter_scouting_reports` + `fighter_report_clan_shares` tables, same
  visibility model and RLS pattern as matchup reports. Fight page now
  shows two columns (one per fighter) above the existing matchup thread;
  fighter profile pages get their own reports section.
- **Real bug found immediately after building the above:**
  `scouting_reports`' SELECT policy and `report_clan_shares`' SELECT
  policy queried each other directly — a genuine circular dependency
  between the two policies. Postgres rejects this outright with
  "infinite recursion detected in policy" as soon as `scouting_reports`
  is touched at all, not just for `SPECIFIC_CLANS` rows — the cycle is in
  the policy *definitions*, independent of any row's data. Spent a real
  detour chasing a JWT-signing-key theory first (checked the Supabase
  dashboard's JWT Keys page, restarted the project) before isolating the
  actual cause by simulating a session directly in SQL (`set local role
  authenticated; set local "request.jwt.claims" = '...'`) — confirming
  the lesson written down at the end of Phase 10 about testing that way
  first. `0008_fix_scouting_reports_recursion.sql` fixes it with a
  security-definer helper, same pattern as `is_clan_member()`. Applied
  the same pattern preemptively to the new fighter-report tables in 0009,
  so they don't hit the identical trap.
- **Feature request:** reports weren't editable, only create/delete —
  the RLS "author updates" policies already supported it (present since
  the original 0001/0009 migrations), just no UI existed. Added a shared
  `ReportCard` component with an edit/display toggle, used by both report
  kinds. Bound Server Actions (`updateReport.bind(null, id, fightId)`)
  are passed as props rather than plain closures, since only bound
  Server Actions — not arbitrary functions — can cross the Server→Client
  Component boundary in this framework.
- `FightHistoryRow` (on a fighter's profile) now links to the specific
  fight (`/fights/[id]`) instead of the event page, so there's an actual
  path from a fighter's profile into one of their bouts' scouting reports.

**Also found and fixed along the way:** wrong Supabase *project* — the
user accidentally ran a migration against an unrelated project
("GAMBLING TRACKER") instead of `ufc-scouting-app`, caught immediately by
the error (`report_clan_shares` doesn't exist there) and the project name
visible in the dashboard screenshot. Not a code bug, but worth noting:
always confirm the active project in the dashboard before running SQL,
especially if multiple Supabase projects exist on the same account.

**Status:** invite acceptance verified end-to-end with a second real
Google account — `clan_members` confirmed to have both users after
accepting an invite link. Matchup + individual fighter reports verified
working (create, and the RLS recursion bug caught before real use).
Edit capability built but not yet independently re-verified live.
Visibility filtering (does a SPECIFIC_CLANS report actually stay hidden
from a non-member?) still not explicitly re-tested after the 0008 fix.

**Next:** verify report editing and visibility filtering live with the
second account; schedule both sync jobs to run automatically.

## Phase 12 — Verified visibility filtering, automated the sync job

- **Verified live** with the second account: a `SPECIFIC_CLANS` report
  stays correctly hidden from a user who isn't a member of the shared
  clan. Closes the last open item from Phase 11.
- **Sync automation.** Discussed where the app will be hosted (decided:
  Vercel) and, separately, how to schedule `npm run sync`. Vercel Cron
  hitting an API route was considered but rejected: API-Sports is
  deliberately throttled to 1 request/6.5s client-side to stay under its
  undocumented 10 req/min free-tier limit (Phase 5), and a sync run
  (multiple date lookups + one fighter lookup per unique fighter) can
  easily exceed Vercel's serverless function duration cap (60s on
  Hobby). Went with a GitHub Actions cron workflow instead
  (`.github/workflows/sync.yml`) — runs `syncJob.ts` (API-Sports) then
  `syncSchedule.ts` (Wikipedia) daily at 00:00 UTC (08:00 PHT), on
  GitHub-hosted runners with no comparable timeout. Matches actual usage
  too: cards are mostly weekend, next card is usually known by Monday,
  so once a day is enough — no need for anything more aggressive.
  Requires `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
  `UFC_API_SPORTS_KEY` to be added as GitHub repo Actions secrets before
  it can run (not yet done — see HANDOFF.md).

**Status:** both items from Phase 11's "not done yet" list are now
closed. The app itself is not yet deployed to Vercel.

**Next:** add the sync secrets to the GitHub repo so the new workflow can
actually run; deploy to Vercel.

## Phase 13 — Deployed to Vercel

- Deployed via Vercel's GitHub integration (auto-deploys on push to
  `main`). Live at <https://ufc-scouting-app-2jtj.vercel.app/>
- Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` were
  needed as Vercel env vars (set for Production and Preview) — confirmed
  by grepping `src/` outside `ufc-data-sync/` that nothing else touches
  `process.env`. The service-role key and API-Sports key stay
  GitHub-Actions-only, never reach Vercel.
- Added the deployed domain's `/auth/callback` path to Supabase's
  Redirect URLs allowlist (Site URL alone isn't enough — the app
  explicitly builds `redirectTo` from `window.location.origin`, which
  must be allow-listed exactly). No code changes needed since that
  origin derivation was already dynamic, not hardcoded to localhost.
- Verified live: Google + GitHub sign-in, fighters/events data loading,
  clan creation + invite link, and writing a scouting report.

**Status:** app is fully deployed and functional end-to-end. Everything
from the original HANDOFF.md roadmap is done.

**Next:** no blocking work left — remaining items (custom domain,
onboarding friends) are optional/user-driven, not build tasks.

## Phase 14 — Security review + RLS test suite

Ran a full security review before inviting friends to use real accounts
(and given the app's gambling-adjacent use case). Checked: RLS coverage
and correctness on every table, IDOR risk on every mutating Server
Action, the security-definer RPCs (`accept_clan_invite`,
`get_invite_clan_name`, membership helpers) for privilege-escalation
paths, GRANT/RLS consistency, invite token strength, secrets hygiene
(service-role key never leaves `ufc-data-sync/`, `.env.local` never
committed), stored-XSS exposure, and whether `proxy.ts`/page components
ever trust a client-supplied user id anywhere instead of the session.

**Found and fixed:** `report_clan_shares`/`fighter_report_clan_shares`'
INSERT policies checked that the caller authored the report being
shared, but never checked the caller is actually a member of the
`clan_id` they're sharing it into. An authenticated user could share
their own report into any clan whose UUID they could observe (e.g. one
they'd left, or seen referenced elsewhere) — bounded impact (only their
own content, not a read of someone else's data) but a real break of the
stated visibility invariant. Fixed in
`0010_fix_report_share_clan_membership.sql` by adding
`is_clan_member(clan_id)` to both `with check` clauses, plus
defense-in-depth in the Server Actions themselves
(`keepOnlyOwnClans()` in `src/features/scouting-reports/actions.ts`
filters `clanIds` against the caller's actual memberships before the
insert, so a tampered request is silently dropped rather than reaching
the DB as a rejected write).

**Also added**, low-risk hygiene, not security findings: a 2000-char
cap on report bodies and 60-char cap on clan names
(`0011_length_limits.sql` + matching `maxLength` on the relevant forms)
— nothing currently stops an unbounded paste, and there's no XSS risk
either way (confirmed no `dangerouslySetInnerHTML` touches user data
anywhere; React auto-escapes).

**Everything else came back clean**: RLS enabled + default-deny on
every table, every mutating Server Action double-checks `user_id =
auth.uid()` beyond what RLS already enforces, no security-definer RPC
allows spoofing another user's identity or joining a clan without a
valid unrevoked token, grants match policies with no gaps in either
direction, and secrets never leave their intended execution context.

**Added `supabase/tests/rls.sql`** — a manual regression test: creates
temporary fixtures inside a transaction that rolls back at the end,
simulates two different logged-in users via `set local role
authenticated` + `request.jwt.claims` (the same technique learned the
hard way in Phase 10/11), and asserts the full visibility matrix
(PRIVATE/ALL_MY_CLANS/SPECIFIC_CLANS, both directions), an IDOR check on
UPDATE, the exact clan-membership bug just fixed above, and that `anon`
still can't read scouting reports at all. Run it after any future
migration that touches RLS, before trusting the change with real data.

**Open product decision, not yet resolved:** clan invite links never
expire and have unlimited reuse — `accept_clan_invite` only checks `not
revoked`. Not a bug, but worth deciding deliberately rather than as a
side effect, given the friend-group/gambling-adjacent context (see
HANDOFF.md).

**Status:** app-level security posture verified sound aside from the one
fix above (already shipped). RLS test suite in place for future
migrations. CI (Phase 14 also includes this from RETROSPECTIVE.md
item #1) now runs `npm ci` + lint + build on every push, catching the
class of bug (lockfile drift) that broke Phase 12's sync workflow.

**Next:** decide on invite link expiry/reuse limits; consider
consolidating the two near-duplicate scouting-report schemas
(RETROSPECTIVE.md item #3) if touching that area again.

## Phase 15 — v2 re-architecture + real gates (2026-08-29)

**Planned:** `docs/PRD.md` re-scoped the app to a solo tool. This phase ran
`app-architect` over that PRD, then `harness-setup` over the result. No
feature code was written.

**Decided (ARCHITECTURE.md rewritten):**

- **UFCStats.com rejected on evidence.** Checked live: every page returns a
  2,998-byte JavaScript proof-of-work challenge instead of content, and port
  443 refuses connections. The project's own "verify empirically" rule caught
  this mid-decision — it had already been chosen before the check ran.
- **Results come from Wikipedia + API-Sports cross-checked.** API-Sports'
  known limitation is no *lookahead*, which doesn't apply to settlement.
- **`bout_order` turned out to be free** — `fetchSchedule.ts` already parses
  Wikipedia bouts in document order and discards it.
- **TypeScript-only runtime.** The Python case died with UFCStats: nothing
  left in the plan is HTML scraping.
- Intern runs on GitHub Actions cron; Gemini Flash behind `lib/llm.ts`.
- **Picks and bets split into two judgments** (user-originated). A pick says
  who wins; a bet says the price is wrong. They may back different fighters,
  so a row settles twice — `pick_correct` and `pnl_units` independently.
  Scoreboard becomes two boards, each with its own chalk control.
- **Phase 7's disputed-opponent problem decided:** detect at the `upsertFight`
  insert path, hold the fight out of both boards, self-resolve on source
  convergence or a confirmed result. No preferred-source rule — Phase 7's own
  data showed each source stale in a different case.

**Changed (harness):**

- **Vitest installed** — there was no test runner at all, and the v2
  correctness-critical work is defined as test-first. First test covers
  `stripNullish`, which guards a live data-loss path.
- `ci.yml` job renamed `build` → **`gates`** and made path-scoped: the job
  always runs so the required check always posts, but heavy steps are
  conditional. Docs-only PRs get markdown lint instead. `.github/**`,
  `package.json`, and the lockfile deliberately count as code.
- **Branch protection enabled on `main`**: `gates` required, 0 approvals, no
  direct pushes, admins included. Verified by attempting a direct push and
  watching it be rejected. This matters because **Vercel deploys on push
  regardless of CI** — before this, a red build still shipped to production.
- `.githooks/pre-push` runs lint + test locally (`git config core.hooksPath
  .githooks`).
- **`CLAUDE.md` rewritten.** It still claimed no code had been written yet,
  for a 14-phase app live in production, and pointed at `lib/db.ts` and
  `auth-config.ts`, neither of which exists.
- **`PROJECT_FACTS.md` created** — durable decisions that shouldn't be
  re-litigated.

**Found the hard way:** installing Vitest on Windows silently pruned
`@emnapi/core` and `@emnapi/runtime` from `package-lock.json`. They're regular
dependencies of `@img/sharp-wasm32`, which is optional and `cpu: wasm32`, and
npm never resolves into a platform-gated optional package — but Linux CI still
needs them. The first `gates` run failed on exactly this, which is the drift
class the `npm ci` step exists to catch. Diffing against the last CI-green
lockfile isolated the damage precisely (60 added, 0 version changes, 2
removed) and both entries were restored verbatim. Note esbuild's platform
variants survive, because those are declared as `optionalDependencies`.

**Status:** planning docs and gates are in place. No v2 feature code exists
yet. `PROJECT_FACTS.md` and `docs/PRD.md` are the sources of truth;
`HANDOFF.md` is partly superseded.

**Next:** `user-flow-mapper` → `docs/user-flows.md`, then `roadmap-planner`
→ `ROADMAP.md`, then the `feature-planner` build loop starting with Phase A
(`events.starts_at`, `fights.bout_order`, and the missing FK indexes).

## Phase 16 — B1: verified 1xBet MMA odds live, corrected an assumption (2026-09-01)

**Verified live**, with a real Odds API key, against `mma_mixed_martial_arts`
odds filtered to `bookmakers=onexbet`:

- **1xBet returns real MMA prices.** `bookmakers` was non-empty for genuine
  near-term UFC cards with real fighters and correct pairings — Joshua Van vs
  Alexandre Pantoja, `commence_time` `2026-09-20T04:00:00Z`, which is the
  evening of Sept 19 in Los Angeles and matches the Wikipedia-sourced UFC 331
  date independently. No fallback bookmaker is needed.
- **Credits cost 1 per successful request**, confirmed via
  `x-requests-remaining` dropping 500 → 499 → 498 across two calls. A request
  for an unsupported market (`h2h_3_way`) returned `422` and cost 0 —
  validation happens before billing.
- **`commence_time` is a real ISO timestamp on every event.** This is what
  B4 will use to populate `events.starts_at`.

**Correction, found in the same response:** the previous session (Phase 15,
recorded during the odds-source decision) claimed MMA `h2h` was a clean 2-way
market and that MMA isn't normally offered three-way. That was asserted, not
checked. The live payload contradicts it — every 1xBet MMA `h2h` response
returns **three outcomes**: Fighter A, Fighter B, and `Draw` (~33–34.0
decimal, ~3% implied). Querying `h2h_3_way` as a separate market returns
`422 INVALID_MARKET`; there is no distinct three-way key for this sport.

The double-chance rejection from Phase 15 still stands, but not for the
reason first given. Double chance is a wrapper bet that shortens every price
to buy protection against an outcome you were never betting on; what the
payload actually contains is a plain three-way price, not a combined bet.
Fix is mechanical: the odds client keeps the two outcomes matching the
fight's fighters and discards `Draw`. The settlement policy (a draw voids and
returns the stake) was always a product decision this app makes, independent
of whether the market technically prices a draw.

**New design note for B3**, found while reading the live response: several
far-future events list the same fighter against different opponents on the
same date (e.g. Gaethje vs both Tsarukyan and Topuria, dated 2026-12-31) —
rumoured pairings the market prices before matchmaking is final. B3's fuzzy
matcher must scope to a window around a known card date rather than search
by name across the full event list, or risk a false match against a listing
that never becomes a real fight.

**Changed:** `ARCHITECTURE.md` Fork 7 rewritten with the live findings and
the correction; `docs/PRD.md` §6 and §10 updated; `PROJECT_FACTS.md` odds
section rewritten; `ROADMAP.md` B1 marked done, B3 carries the new
requirements. `.env.local` now holds `ODDS_API_KEY` (Starter free tier, 500
credits/month) — gitignored, never committed.

**Status:** B1 is done. B2 (immutable `odds_snapshots`) is next and can now
proceed on a verified foundation instead of an assumed one.

## Phase 17 — B2: odds_snapshots table, immutable by trigger (2026-09-01)

**Added:** `supabase/migrations/0013_odds_snapshots.sql` — one frozen decimal
price per fight (`fighter1_price`, `fighter2_price`, both `> 1` checked),
`bookmaker` defaulting to `'onexbet'`, `odds_event_id` and `raw_response
jsonb` for audit, `unique (fight_id)`, `fight_id references fights(id) on
delete restrict` (a priced snapshot must never disappear as a side effect of
cleaning up an unrelated fight row). RLS enabled, public `SELECT` for
`anon`/`authenticated` matching the existing fighters/events/fights pattern,
no write grant for either.

**Corrected before implementing, not after:** ARCHITECTURE.md's stated
mechanism — "immutable via absent UPDATE/DELETE policy" — doesn't survive
contact with how `service_role` actually works in this project.
`0003_service_role_grants.sql`'s own comment says service_role bypasses RLS
entirely, and `0005_service_role_default_privileges.sql` grants it UPDATE/
DELETE on every table, including future ones, forever. An absent policy
stops `anon`/`authenticated`; it stops nothing once the sync job itself
(which runs as service_role) is the one making the request. Replaced with a
`BEFORE UPDATE`/`BEFORE DELETE` trigger that unconditionally raises — the
same mechanism this project already uses for the pick lock, since triggers
fire for every role regardless of RLS bypass.

**Test-first, run for real:** extended `supabase/tests/rls.sql` (checks
7–12) rather than adding a Vitest suite, since RLS/trigger behaviour can
only be verified against real Postgres — matches this project's own
established pattern. Checks cover: anon can read; anon/authenticated writes
rejected by grants; `service_role` UPDATE and DELETE rejected **specifically
by the immutability trigger** (the test inspects the error message so a pass
can't be masking an unrelated rejection); a second insert for an
already-snapshotted fight rejected by the unique constraint. Run live
against `ufc-scouting-app` via the Dashboard SQL Editor — printed `All RLS
checks passed.`

**Found while preparing to apply the migration, not from the migration
itself:** the Supabase CLI's migration tracking is out of sync with reality.
`supabase migration list --linked` showed every migration `0001`–`0013`
with an empty `remote` column, and `db push --dry-run` confirmed it would
try to re-apply all thirteen, including `0001`'s `create table fighters`
against a table that already exists live. All prior migrations went in by
hand through the Dashboard SQL Editor, which never writes to the CLI's
tracking table — so this one did too, for consistency and safety, rather
than risk a first-time `db push` reconciliation mid-task. Also reconfirmed
while checking project refs: the "GAMBLING TRACKER" project from the Phase
11 incident is still on the account. Both recorded in `PROJECT_FACTS.md`.

**Status:** B2 done. `ARCHITECTURE.md`'s schema-decisions section and Fork 7
both updated with the trigger correction. B3 (odds client + fuzzy matcher)
is next, and now carries three requirements found along the way: discard the
`Draw` outcome, scope matching to a window around a known card date, and
build against a verified 1xBet response rather than an assumed one.

## Phase 18 — B3: odds client + fuzzy fight matcher (2026-09-01)

**Added** `src/lib/odds/`: `similarity.ts` (hand-rolled Dice-coefficient
name similarity, chosen over an external library since this is the
correctness-critical core of matching and a small fully-tested
implementation is a smaller risk surface than an unverified dependency),
`parseOutcomes.ts` (extracts fighter prices, discards `Draw`),
`matchFights.ts` (date-window scoping + confidence threshold),
`client.ts` (thin fetch wrapper), `matchAndSnapshot.ts` (the write-glue
tying all four together against real Supabase tables). 30 Vitest tests,
all written before their implementations existed.

**Pulled forward from A2:** `supabase/migrations/0014_data_conflicts.sql`
— B3 needed somewhere to write low-confidence matches, and Fork 5 already
fully specified the shared queue's shape, so the table didn't need A2's
detection logic to exist first. Two kinds in one table (`disputed_opponent`,
`low_confidence_odds_match`); `fight_id` is populated only for the former,
since an unmatched odds event doesn't identify a fight confidently enough
to block anything. RLS enabled with no policy for `anon`/`authenticated`
at all — fails closed until A3's allowlist exists to gate it deliberately.

**Real gate finding, not hypothetical:** the "never returns the Draw price"
test originally used realistic fighter names (Manon Fiorot vs Alexa
Grasso) and passed even after deleting the actual Draw-discard filter —
name-similarity matching happened to reject "Draw" anyway for real names,
so the test proved nothing about the filter it claimed to guard.
Replaced with an adversarial case (a synthetic "fighter" named `Draw`,
guaranteed to win the name-match if the filter is absent). Confirmed by
mutation: the weak version stayed green with the bug present; the
adversarial version failed correctly (`fighter2Price: 33` — the actual
Draw price), then passed once the filter was restored.

**Reused, not duplicated:** `getSupabaseAdmin` moved from
`lib/ufc-data-sync/supabaseAdmin.ts` to `lib/supabase/admin.ts` — it was
never sync-specific, `lib/odds/` needed the same service-role client, and
the security-baseline rule is exactly one wrapper module per SDK, not one
per feature. `syncJob.ts`/`syncSchedule.ts` updated to the new import
path; lint and build both clean afterward.

**Deliberately not done:** `matchAndSnapshot.ts` has not been executed
against production. `odds_snapshots` is immutable by trigger
(Phase 17), so a premature write against the wrong fights is effectively
permanent — its first real run belongs to B5's T-12h schedule, or an
explicit confirmed dry-run, not an ad hoc verification step here.

**Status:** B3 done. A2's remaining scope is now just the `upsertFight.ts`
disputed-opponent detection logic, writing into a table that already
exists. Next: A1 (`events.starts_at`, `fights.bout_order`, FK indexes) or
B4 (daily discovery pull populating `starts_at` from `commence_time`) —
both still open, neither depends on B3.

## Phase 19 — A1: bout_order, starts_at, missing FK indexes (2026-09-01)

**Added** `supabase/migrations/0015_bout_order_and_starts_at.sql`:
`events.starts_at` (nullable timestamptz — not yet populated, that's B4's
job from The Odds API's `commence_time`), `fights.bout_order` (nullable
smallint — only ever known for Wikipedia-sourced fights), and indexes on
`fights.event_id`/`fighter1_id`/`fighter2_id`, all three previously
unindexed despite being joined on every event/fighter page.

`syncSchedule.ts` was already iterating `event.bouts.entries()` and using
the array index for `external_id` — this was genuinely the "nearly free"
column ARCHITECTURE.md described: the index now also gets passed as
`bout_order` to `upsertFight`. `FightWrite`'s new field relies on
`stripNullish` preserving `0` (the main event) correctly on updates,
already covered by `stripNullish.test.ts`'s falsy-value case from Phase 15
— no new test needed for a display-ordering field, per the project's own
test-first scope (money/auth/counting, not layout).

**Status:** code merged and gated. **Migration not yet applied** — per the
established pattern (`PROJECT_FACTS.md`: `db push` is unsafe until
deliberately reconciled), it needs a manual run in the Dashboard SQL
Editor before `bout_order` actually starts populating on the next sync.

## Phase 20 — Corrected DWCS check; switched bookmaker to BetOnline.ag (2026-09-01)

**Started from a user question:** "include DWCS and UFC." Investigated
before building anything, per the project's standing rule.

**First check was wrong, on two counts.** Searched the odds feed for
fighters from DWCS season 10 Weeks 1–2, only against `onexbet` (1xBet),
and found nothing — concluded DWCS had zero odds coverage. Both premises
were flawed: Weeks 1–2 had already **concluded** by the check date (odds
boards don't carry settled fights), and the search never looked past
1xBet. The user pushed back, correctly, having seen DWCS odds in the
1xBet app directly.

**Rechecked properly**, live: the actual current week (Week 4, the day
of the check) against every bookmaker in the feed. DWCS **is** priced —
by Pinnacle, FanDuel, Unibet, BetOnline.ag, and others. `onexbet`
specifically has zero DWCS coverage, which is what the first check
happened to find, for the wrong reason.

**Comparing bookmakers led to a broader finding than the DWCS question
itself.** Across the full 63-event feed: `betonlineag` covers 56 (89%),
`onexbet` covers 34 (54%), `pinnacle` covers 18 but is *absent* from UFC
331. `betonlineag` is the only bookmaker checked that cleanly prices
both UFC and DWCS, and beats 1xBet's coverage even for UFC alone. Its
MMA `h2h` is a clean 2-way market (no `Draw`), confirmed on both a UFC
and a DWCS fight. Region is empirically irrelevant once `bookmakers=` is
explicit — identical results across `us`/`eu`/`uk`/`au`.

**Switched the app's bookmaker to BetOnline.ag:**

- `client.ts`: `BOOKMAKER` → `"betonlineag"`, `REGION` → `"us"`
- `parseOutcomes.ts`: bookmaker-key check updated; the Draw-discard filter
  is **kept** as a no-op safeguard rather than removed, since it's
  proven-correct by mutation testing and a future bookmaker change could
  reintroduce a three-way shape
- `parseOutcomes.test.ts`: fixtures rebuilt from real BetOnline.ag
  payloads (UFC 331, and a DWCS Week 4 fight); the adversarial
  Draw-discard test re-verified by mutation against the new hardcoded
  key — failed correctly with the bug present, passed once fixed
- `supabase/migrations/0016_odds_snapshots_bookmaker_default.sql` — a new
  migration, since `0013` is already applied live and is never edited
  retroactively. No data to migrate: `matchAndSnapshot.ts` has still
  never run against production.

**DWCS odds coverage is resolved. DWCS ingestion is not — deliberately
left open.** Investigated Wikipedia's actual DWCS structure: one page
per *season* (not per event), each week as a section inside it using a
plain-text date (`|date=August 11, 2026`) instead of the `{{start date}}`
template every parser in this codebase expects, and not tracked by the
category `fetchSchedule.ts` already polls. That cost is unrelated to
which bookmaker prices the fights and is unchanged by this phase. Not
scoped into the roadmap — a real decision for later, not decided here.

**Status:** all 4 test files, 31 tests, pass; lint and build clean.
`ARCHITECTURE.md` Fork 7, `docs/PRD.md`, `PROJECT_FACTS.md`, `ROADMAP.md`
all updated — historical verification records for 1xBet kept intact and
clearly dated, not rewritten.

## Phase 21 — A2: disputed-opponent detection in upsertFight (2026-09-01)

**Added** `src/lib/ufc-data-sync/sharesExactlyOneFighter.ts` — the core
decision rule from ARCHITECTURE.md Fork 5, extracted as a pure function
rather than inlined, matching `lib/scoring`'s and `lib/odds`'s existing
separation of decision logic from I/O. Test-first: wrote
`sharesExactlyOneFighter.test.ts` (5 cases, including the real Phase 7
example — Louie Sutherland's disputed opponent) and confirmed it failed
with no implementation before writing one. Confirmed by mutation:
`shared >= 1` instead of `=== 1` — the most plausible version of this
exact bug — correctly failed the two "same fight, not a dispute" cases
while the disputed-opponent cases stayed green.

**Wired into `upsertFight.ts`**, right before the `INSERT` fallback that
Fork 5 identified as where duplicate rows got created. A candidate
sharing exactly one fighter now opens a `data_conflicts` row instead of
inserting a second fight. A repeat sync run (twice daily) finding the
same ongoing dispute reuses the existing open row rather than piling up
duplicates for one unresolved dispute.

**`upsertFight`'s return type changed** from a bare fight id to a
discriminated union (`{status:"upserted",fightId}` /
`{status:"conflict",conflictId}`), since a disputed match produces no new
fight row to return an id for. Confirmed safe by reading both call sites
first: neither `syncJob.ts` nor `syncSchedule.ts` uses the returned
value for anything.

**Status:** A2 done — first half of correctness item #7. The second
half (a fight with an open conflict must be rejected by the pick-lock
trigger) is C1's job, not yet built. `data_conflicts`' RLS already grants
`service_role` full access via `0005`'s `ALTER DEFAULT PRIVILEGES`, so no
new grants migration was needed.

## Phase 22 — A3: owner allowlist (2026-09-01)

**Closes a real gap** found during `user-flow-mapper` (2026-08-29): the
app is publicly deployed with open Google/GitHub signup, so any stranger
could sign in and write real rows to the frozen v1 tables — clans,
scouting reports — consuming quota on data never meant to be
multi-tenant. RLS already kept a stranger's rows separate from the
owner's, so this was never a breach, but it was an unintended door.

**Added** `supabase/migrations/0017_owner_allowlist.sql`: an `is_owner()`
function, and one **restrictive** RLS policy per writable table (`clans`,
`clan_members`, `clan_invites`, `scouting_reports`, `report_clan_shares`,
`fighter_scouting_reports`, `fighter_report_clan_shares`) rather than
rewriting the many existing permissive ones. Postgres RLS policies for
the same command are permissive by default and OR'd together — a new
permissive policy can only widen access, never narrow it. Restrictive
policies AND on top of whatever the permissive ones already allow, so one
`as restrictive for all using (is_owner())` per table does the whole job
without touching a single existing policy.

**Found a second, different gap while writing this:** `accept_clan_invite`
(from `0004`) is `SECURITY DEFINER`, so its internal `insert into
clan_members` runs with the function owner's privileges — the restrictive
policy on `clan_members` never reaches inside it. Same class of mistake
as `odds_snapshots`' original "absent policy" immutability plan (Phase
17): RLS doesn't govern elevated-privilege code paths. Fixed with an
explicit `if not is_owner() then raise exception` guard inside the
function itself, redefined via `create or replace function` in the new
migration rather than editing `0004`.

**Added** `src/lib/auth.ts` (`isOwner()`) — the one wrapper module per
CLAUDE.md's hard-halts. Carries no security weight of its own: it exists
to decide what the UI shows, while `is_owner()` in Postgres is the actual,
independent boundary.

**Test-first**, extending `supabase/tests/rls.sql` (checks 13–16) rather
than Vitest, matching this project's established pattern for RLS behaviour
that can only be verified against real Postgres:

- a non-owner cannot create a clan under their own authorship (previously
  allowed by the permissive policy alone)
- the owner's own access is unregressed
- a non-owner cannot create a scouting report under their own authorship
- a non-owner is rejected from `accept_clan_invite` **specifically by the
  `is_owner()` guard** — checked via the error message containing "Not
  available," not just any rejection, so a pass can't mask an unrelated
  failure

The test file's header now requires label `'a'` to be the same account as
the migration's hardcoded owner id, since checks 13–16 only mean anything
if it is.

**Status:** code merged. **Migration not yet applied** — needs the
placeholder UUID replaced with the real owner id before running in the
Dashboard SQL Editor, then `rls.sql` run to verify live, matching the B2
workflow. `ARCHITECTURE.md` Fork 8, `PROJECT_FACTS.md`, `ROADMAP.md`, and
`docs/user-flows.md`'s security checklist all updated.

## Phase 23 — Migration workflow: reconciled the CLI, now runs migrations directly (2026-09-01)

**Asked and answered explicitly**, not decided silently: whether Claude
should run Supabase migrations directly via the CLI instead of handing
SQL to the user for the Dashboard SQL Editor. User approved reconciling
the CLI once and automating from there, having weighed it against the
alternative (a raw Postgres connection string — explicitly declined,
too much blast radius for the convenience gained) and against staying
fully manual.

**Reconciled**, after re-verifying the linked project ref
(`vrwlfcywyfzfczajpdoh`) via `supabase/.temp/project-ref`: `supabase
migration repair --status applied 0001 0002 ... 0016 --linked` — pure
bookkeeping, nothing re-run. Verified via `migration list --linked`
(all sixteen now show `remote` matching `local`) and `db push --dry-run`
(correctly isolates only the genuinely new `0017` as pending — the exact
problem from Phase 17/22 is fixed).

**Going forward:** `supabase db push --linked` applies migrations
directly; `supabase db query --linked -f <file>` runs ad-hoc SQL files
(discovered while checking what was actually possible — this also covers
running `supabase/tests/rls.sql`, not just tracked migrations).

**What this costs, stated plainly:** the dashboard-visible-project-name
checkpoint that caught the real Phase 11 mistake (a migration run against
the wrong project, "GAMBLING TRACKER") is gone. Replaced with a text-based
substitute — re-verify and state the project ref before every push — which
is a real, weaker safety property than seeing it on screen, not a
like-for-like swap. Recorded as a standing requirement in `CLAUDE.md`, not
just this entry.

**Status:** workflow live. `0017` (A3's owner allowlist) is still pending
— needs `OWNER_USER_ID` added to the user's local `.env.local` before it
can be pushed with the real value substituted for the placeholder.

## Phase 24 — A3 migration applied live; retired an obsolete RLS check; found a `db query -f` limitation (2026-09-01)

**`0017_owner_allowlist.sql` applied for real**, via the new CLI workflow:
project ref re-verified immediately before the push, the placeholder
substituted locally with the real owner id (found by querying
`auth.users`, confirmed against the user directly since guessing wrong
would have locked them out of their own app), pushed via `db push
--linked`, then the local file reverted to the placeholder before
anything else — the real value was never committed. `migration list
--linked` confirms all 17 migrations now show applied.

**Found while verifying live, not a bug in the migration:** check 3 in
`supabase/tests/rls.sql` — "a clanmate should see 2 reports via
ALL_MY_CLANS + SPECIFIC_CLANS" — fails permanently now, because the new
restrictive owner-only policy blocks a non-owner from `scouting_reports`
entirely, before that visibility logic is ever reached. Not a regression;
the intended effect of A3. Retired with a comment explaining why, rather
than left red — checks 1, 2, 4, 5, 6 are unaffected (none of them depend
on a non-owner seeing anything).

**Found a real limitation in the new tooling while chasing what first
looked like a second bug:** running the full `rls.sql` via `supabase db
query --linked -f` produced an apparent failure — even the *owner*
rejected by the restrictive policy on `clans`. Diagnosed properly rather
than assumed: `is_owner()` and the policy were proven correct via direct
calls with explicit arguments, and several short, isolated reproductions
of the exact "role-switch, set `request.jwt.claims`, insert" pattern all
passed. But the same pattern wrapped in a `DO` block, run immediately
after an earlier role-switch-and-reset, failed inconsistently on details
that shouldn't matter. Root cause not identified — plausibly something in
how the Management API executes a multi-statement file, not a real
Postgres RLS bug, since the underlying logic checked out clean every time
it was isolated. Recorded in `CLAUDE.md` and `PROJECT_FACTS.md`: `db
push` is trusted for plain DDL; `db query -f` is not, for anything shaped
like `rls.sql` (role switches, `DO` blocks, expected-exception checks) —
run that class of script through the Dashboard SQL Editor instead, until
this is actually understood rather than worked around silently.

**Status:** A3 is live. The full `rls.sql` (checks 1, 2, 4–16; 3 retired)
still needs a real pass/fail run through the Dashboard SQL Editor — the
one channel proven reliable for this file — before A3 is called verified,
not just applied.

## Phase 25 — A3 actually verified live; found and fixed the real db query -f trigger (2026-09-01)

**Prompted by a direct, fair question**: "so the solution is to just
stick with copy-pasting in supabase sql editor yourself?" Phase 24 had
concluded that with a `db query -f` limitation, without finishing the
diagnosis. Rather than confirm that conclusion, re-opened it — and it
was wrong to stop where it did.

**Re-ran the corrected file (check 3 retired) a second time** — it had
never actually been re-run after that fix, only fragments had been
tested. Failed identically and deterministically at check 14, which
ruled out "transient/flaky" and meant the failure was actually
diagnosable.

**Bisected properly, twelve isolated queries:** `is_owner()` and the
restrictive policy proven correct via direct calls with explicit
arguments. Two consecutive `DO` blocks with no role switch: passes. A
role-switch-and-reset cycle with the same user before and after: passes.
Switching to a different user with no insert attempt: passes. A
*simplified* version of check 13 (no unreachable `raise exception` line,
no subquery) followed by check 14: passes. Only the **exact** structure —
check 13's `DO` block genuinely *catching* an `insufficient_privilege`
exception, immediately followed by check 14's success path *also* wrapped
in its own `DO` block — reproduced the failure, every time.

**The fix: check 14 didn't need a `DO` block at all.** Its only job was
confirming an INSERT succeeds; a plain top-level `INSERT` that runs
without error already proves that, no PL/pgSQL exception handling
required. Rewritten that way and the **complete file — checks 1–16 — was
run for real and printed `All RLS checks passed.`** Checks 15 and 16 had
never been independently isolated before this; they passed as part of
the real run.

**Every doc that had understated this (Phase 24's entries, `CLAUDE.md`,
`PROJECT_FACTS.md`, `ARCHITECTURE.md` Fork 8, `ROADMAP.md`) corrected** —
`db query -f` is not a tool to route around for this file; the actual,
narrow, now-documented rule is: a check that only needs to prove success
should be a plain top-level statement, not a habitual `DO` block. Only
checks that need to *catch* something need one.

**Status:** A3 is done — applied and verified live, not just applied.
No further action needed on it. `PROJECT_FACTS.md` carries the rule for
future checks added to `rls.sql`.

## Phase 26 — B4: discover events.starts_at from commence_time; fixed a real live bug (2026-09-01)

**Added** `src/lib/odds/discoverStartTimes.ts` (`earliestConfirmedStartTime`,
a pure function, plus the DB-glue `discoverStartTimes`) and
`runDiscoverStartTimes.ts` (a runnable script, `npm run
odds:discover-start-times`, matching the existing `sync:*` convention).
`matchFights.ts` gained `scoreOddsEventMatch` — B3's `scoreFightMatch` in
reverse (fight seeks odds event, not odds event seeks fight) — sharing
its scoring via an extracted `fightNameSimilarity` helper. Pure refactor,
confirmed by running the existing 36 tests unchanged before writing
anything new.

**`starts_at` is the card's *earliest* confidently-matched fight**, not
the main event's own time — a card's prelims start hours before the main
card, and that earlier moment is what "the card has started" means for
the pick lock. Confidence-gated at the same `AUTO_MATCH_THRESHOLD` as
B3's pricing, mutation-verified: removing the threshold check broke
exactly the two tests built to catch it. Unlike `odds_snapshots`, this
column is **overwritten on every run**, not write-once — the PRD's "card
postponed → picks carry to the new date, locks recompute" needs it to
track the freshest odds data.

**Asked before running it live**, since executing real TypeScript
against production is a different category of action from the schema
migrations already approved. Confirmed, then run — and the very first
live invocation surfaced a real bug that had shipped in B3 undetected:
`fetchMmaOdds()`'s `new URL(path, base)` treats a leading `/` in `path`
as absolute-from-origin, silently dropping `BASE_URL`'s own `/v4` instead
of appending to it. Every real request had been 404ing. Neither B1's
`curl` checks (used the full URL directly) nor B3's Vitest coverage
(only the pure logic downstream of the fetch) ever exercised this exact
code path — recorded in `PROJECT_FACTS.md` as a general lesson, not just
this one bug. Fixed with `buildOddsUrl`, a pure exported function using
single-argument `new URL(fullString)` (nothing to silently drop), with
its own test — mutation-verified, reverting to the broken form fails it.

**Re-ran live after the fix, verified against the actual data, not the
summary line:** 6 real upcoming events updated, 3 left `null` (further
out, no confident match yet — expected, not a bug). UFC 331 shows
`2026-09-20T00:00:00Z`, earlier than its own main event's
`2026-09-20T04:00:00Z` — confirms on real production data that this
correctly finds the card's earliest fight, not the main event's time.

**Status:** B4 done, verified live with real data, not just passing
tests. Not yet wired to a schedule — that's B5, alongside the T-12h
snapshot job and `job_runs`.

## Phase 27 — B5: T-12h snapshot job, `job_runs`, and the loud degraded banner (2026-09-01)

Built the piece B3/B4 both deferred: deciding *when* the odds jobs run,
tracking every run, and surfacing a broken or stale run loudly instead of
silently. `.github/workflows/odds.yml` runs every 2 hours (user-confirmed
cadence, weighed against The Odds API's ~500 credit/month budget — one
shared `fetchMmaOdds()` call per run feeds both jobs rather than fetching
twice).

Found and fixed the real gap `matchAndSnapshot` had carried since B3:
`odds_snapshots`' immutability trigger stops a second write, but nothing
stopped a too-early *first* write. `lib/odds/snapshotWindow.ts`'s
`isPastSnapshotWindow` — the T-12h gate — closes that, test-first,
mutation-verified.

`lib/odds/runOddsJobsOnce.ts` is the one real implementation of "run both
jobs," called identically by the scheduled cron and by the owner's manual
"retry now" button, so a manual late-pull (accepting the current, worse
price) is never a second code path that could drift from the scheduled
one. That button needed a real security decision: `odds_snapshots` and
`job_runs` have no client write grant at all, so `retryOddsJobAction`'s
own `isOwner()` check — run server-side against the real session — is the
actual boundary here, not RLS. Added a test for `isOwner()` itself for
exactly that reason.

Caught a real regression before it shipped: the first version of the
banner checked ownership via `cookies()`-based auth directly in its
server render, and `next build`'s route table showed `/`, `/events/past`,
and `/events/upcoming` had silently flipped from static+revalidated to
server-rendered on every request. Fixed by moving that check into a
client-triggered server action instead — confirmed by re-running the
build and seeing the same three routes back to static.

**`matchAndSnapshot.ts` ran live for the first time**, alongside
`discoverStartTimes`, with explicit confirmation. Safe by construction —
no known card was within 12h of starting — and verified afterward by
querying the actual tables, not trusting the console output:
`odds_snapshots` stayed at 0 rows, `job_runs` recorded both jobs'
real success rows.

**Status:** B5 done. Next: B6, the `/conflicts` screen.

## Phase 28 — B6: the /conflicts screen, and two real bugs found orienting on it (2026-09-01)

Built the resolution screen for both `data_conflicts` kinds -- disputed
opponents and low-confidence odds matches -- so blockers can be cleared
before Phase C's pick lock exists. Two pure builders
(`resolveDisputedOpponent.ts`, `resolveLowConfidence.ts`), mutation-tested,
reuse `stripNullish` and `parseFighterPrices` so a manual resolution
produces exactly what the automatic path would have. The low-confidence
picker (`rankFightMatches`) shows every in-window candidate, not just the
algorithm's own guess (user-confirmed choice) -- the owner can correct a
wrong guess instead of only confirming or rejecting it.

Found and fixed a real bug before writing any of it: `matchAndSnapshot.ts`
was setting `fight_id` on `low_confidence_odds_match` conflicts instead of
leaving it `null` as the migration's own comment specified. Left as-is,
once C1's pick-lock trigger existed it would have wrongly blocked
*picking* a fight over a mere pricing ambiguity, not just pricing it.
Confirmed harmless in practice -- zero rows with the wrong shape ever
existed -- and fixed with explicit user confirmation first.

**Found a second, more serious issue via a deliberately safe, read-only
live check:** `data_conflicts` (migration 0014) didn't actually exist in
production, despite the CLI's migration tracking claiming it was applied.
Root cause: an earlier `migration repair --status applied` reconciliation
assumed every migration file had genuinely been hand-applied before it
ran; apparently not true for this one. Every conflict-detection write
path would have thrown the first time it actually tried to use this
table, with no obvious connection to a B3-era migration. Fixed by running
0014 directly against the live database with explicit confirmation;
verified via `information_schema` that this was an isolated gap, not a
wider problem, and that grants came out correct (service_role/postgres
only).

Also fixed: Vitest never resolved `tsconfig.json`'s `@/*` alias (no
`vitest.config.ts` had ever existed) -- latent since the project's first
commit, surfaced only when this phase's first test transitively imported
a `@/`-using module. Added `vitest.config.mts`.

The write path (the two resolve actions) has not been exercised live --
no real conflict exists yet, and their `cookies()`-based owner check
can't run outside a real Next.js request. Mitigated with a direct
cross-check of every column name used against the live schema, all
matching exactly; honestly documented as the one thing still unverified
by actual execution.

**Status:** B6 done. Phase B complete. Next: Phase C (picks and bets),
starting with C1's pick-lock trigger -- the second half of item #7 this
phase's own bug fix was protecting.

## Phase 29 — C1: the picks table and its pick-lock trigger (2026-09-01)

Built `picks` -- one row per (fight, author), the entity the whole v2
pivot is built around. One table for both USER and INTERN authors, not
two, per ARCHITECTURE.md's Entities section. Orienting on this surfaced a
real documentation gap: docs/PRD.md lists three pick fields
(`confidence`, `predicted_method`, `reasoning`) that ARCHITECTURE.md's own
schema-decisions text never named. Asked before guessing: `confidence` is
a separate 1-5 gut-check distinct from `estimated_probability`;
`reasoning` is optional, not required (required free text on every pick
fails the no-learning-curve UX floor); and `picks` itself is owner-only,
not public -- "for now just me until I prove the picks are actually
reliable," a real product decision now recorded in PROJECT_FACTS.md.

Test-first, using the established SQL-test convention
(supabase/tests/rls.sql) rather than inventing a new pattern: checks
17-25 were written before the migration existed, then run live against
production with real sessions. Running them for real -- not just reading
the migration -- caught two real bugs:

1. A test-fixture mistake of this phase's own making: five checks were
   accidentally written against the same *locked* fixture fight built
   for the pick-lock check, so the lock fired first and shadowed the
   check actually being tested. Fixed with a dedicated unlocked fixture.
2. A real bug: check_pick_constraints()'s open-conflict read of
   data_conflicts hit "permission denied" the moment an authenticated
   session actually triggered it -- that table has no grant for
   authenticated at all. Same fix, same underlying reason, as
   accept_clan_invite in A3: SECURITY DEFINER. Since the original
   migration (0019) was already applied live by the time this was found,
   the fix is a new migration (0020), not an edit -- the same discipline
   that fixed the data_conflicts incident in B6.

All 25 checks (16 pre-existing + 9 new) pass live: "All RLS checks
passed." Verified via information_schema, not just the migration
tracker, that `picks` has the exact columns designed -- the same
discipline B6's missing-table incident established.

C1 is schema and trigger only, no application code -- no features/picks/
yet. That's C3 (card view) and C4 (bet row)'s job.

**Status:** C1 done. Next: C2 (lib/scoring -- implied probability, edge,
unit P&L, pure functions).

## Phase 30 — C2: lib/scoring, the pure P&L/edge/settlement math (2026-09-01)

Built the four pure functions everything visual downstream (C3's card
view, C4's bet row, Phase E's scoreboard) will render against:
impliedProbability, edge, scorePickCorrect, scoreBetPnl. No I/O, no
database access -- this phase touched no migration and nothing live, a
deliberate contrast with every phase since B4.

Test-first, every branch mutation-verified: impliedProbability/edge
against the PRD's own -6000-favourite example; scoreBetPnl against known
moneyline examples (a 1.20 favourite, a 3.5 underdog) plus the void/no-bet
distinction.

ARCHITECTURE.md item #3 names an exact test case ("prediction right, bet
on the other fighter, bet wins") that doesn't actually parse for a
two-fighter fight -- only one fighter can win, so those three clauses
can't all hold at once. Rather than guess which direction was meant,
dualSettlement.test.ts covers both: prediction wrong + bet on the winner,
and prediction right + bet on the loser. A mutation-verified regression
guard confirms scoreBetPnl settles against bet_fighter_id, never
predicted_fighter_id, which is the actual bug class this item exists to
catch either way.

Clarified, not assumed, against the PRD's exact wording: a void's
pnl_units is 0 (a real, known net-zero outcome -- "voided and returned,
not counted as a loss") while pick_correct is null (no correct answer to
score) -- two different null-vs-zero conventions for the same event,
recorded in PROJECT_FACTS.md so Phase D's settlement job doesn't collapse
them.

**Status:** C2 done. Phase C now has its schema (C1) and its math (C2).
Next: C3, the card view.

## Phase 31 — C3: the card view now writes picks, not just displays fights (2026-09-01)

Extended the existing `/events/[id]` route (not a new one -- docs/user-
flows.md is explicit that a whole card gets worked in one pass, not a
per-bout page) to add bout_order sorting, odds display, conflict holds,
and the actual quick-pick interaction. New `features/picks/` (QuickPick,
api.ts, actions.ts, quickPickBands.ts) and a small addition to
features/conflicts/api.ts (getOpenDisputedFightIds).

A real gap surfaced orienting on this before any code was written: the
flow doc's "one tap picks a winner" can't satisfy estimated_probability's
NOT NULL constraint without faking a number or asking for something
real. Asked rather than guessed: tapping a fighter expands the row in
place to 5 preset probability bands, deliberately independent of this
fight's own price (a pick is opinion, not a bet -- that anchoring is
C4's job). confidence defaults silently to 3 since it feeds no P&L/edge
math, unlike probability.

Auth branching collapses two states into one: logged-out and
logged-in-but-not-owner both render the same read-only card, and
conflict holds/the owner's own picks are only fetched on the confirmed-
owner path, matching the flow diagram exactly rather than guessing at a
simpler shape.

Verified honestly: getCardView and getOpenDisputedFightIds both ran live
against UFC 331's real card (bout_order sorts main-event-first, odds
correctly show unpriced 19 days out). saveQuickPickAction was not
exercised live -- its cookies()-based session can't run outside a real
request, and unlike prior read-only live checks, faking a real pick
would create fake opinion data under the owner's own name. Mitigated
with a column-name cross-check against the real schema; the actual
enforcement is C1's already-live-tested trigger.

**Status:** C3 done. Next: C4, the expanded bet row (stake, estimated
probability anchored to implied, live edge).

## Phase 32 — C4: the expanded bet row, and the fields C3 left un-exposed (2026-09-01)

Two forks asked and resolved before building: the anchored-probability
control reuses C3's own band interaction, reframed relative to implied
("well below market" .. "well above market") rather than a slider;
stake is a free numeric field, not preset chips, since sizing itself is
the signal E1's units board measures. Also closed a gap C3's own code
comments flagged: `confidence`, `predicted_method`, `reasoning` -- named
by docs/PRD.md UC-2, present in the schema since C1, never exposed in
any UI until now.

Three new pure, mutation-verified functions in `lib/scoring/`:
`probabilityForFighter` (a bet may back a fighter other than the pick,
so live edge needs `1 - estimated_probability` when they diverge, never
the stored number verbatim), `priceForFighter` (the wrong side's price
flips edge's sign), `applyProbabilityDelta` (turns a band's delta into
the stored value, clamped inside the schema's strict `(0, 1)` check).

A real data-merging bug caught before it could happen: C3's
`saveQuickPickAction` sent a *partial* upsert payload, relying on
Supabase's merge-duplicates behaviour to leave other columns alone --
untested third-party behaviour this project's own working style says
not to trust blind. Rebuilt both save actions around an explicit
read-merge-write (`mergePickFields.ts`, test-first, mutation-verified)
that always writes the complete row -- also fixes a retap of the quick
pick from silently reverting an already-set `confidence` back to its
default.

The bet row requires a priced fight and an existing pick (UC-2: "log a
pick, and *separately* decide whether to bet it") -- `saveBetAction`
enforces this server-side, not just in the UI. `getMyPicksForFights`
widened to the full row (`MyQuickPick` renamed `MyPick`) so reopening
the bet row prefills what was last saved.

Verified live, safely: the expanded column list checked against the
real `picks` table via a throwaway read-only script, then deleted.
Neither save action was exercised live -- same reasoning as C3,
fabricating a real bet would be fabricating money/opinion data under
the owner's own name. The real enforcement remains C1's trigger and RLS.

**Status:** C4 done. Phase C (picks and bets) is complete. Next: Phase D
(settlement).

## Phase 33 — D1: the cross-check settle job (2026-09-01)

Found the real blocker before writing anything: `fights.winner_id`/
`method`/`round` were last-write-wins between the two sync jobs, so
there was no independent per-source state to compare -- Fork 6's
agree/disagree policy literally couldn't be evaluated. Two forks asked
and resolved: new per-source columns directly on `fights` (over a
separate reports table, matching this project's one-table preference),
and a Wikipedia draw/NC settles immediately rather than waiting 24h,
since API-Sports structurally can never report "no winner" and so can
never corroborate one -- verified live against a real UFC 214 No
Contest page, not assumed.

A third case found while writing the decision function's tests, not
guessed: API-Sports actively reporting a winner while Wikipedia says
draw/NC is a real disagreement, not the "nothing to wait for" case --
it queues instead of settling.

New: `lib/settlement/evaluateFightSettlement.ts` (pure, mutation-
verified, the whole policy) and `lib/ufc-data-sync/
buildSourceReportUpdate.ts` (routes each source's report into its own
columns, preserving the original `reported_at` so the 24h clock only
ever starts once). `upsertFight.ts` no longer writes the shared result
columns directly. `data_conflicts` gained a third kind,
`disputed_result`, with a read-only card (`ConflictCard`'s dispatch is
now an exhaustiveness-checked `switch`).

Verified live: migration cross-checked against `information_schema`,
not just the tracking table. Ran the real twice-daily sync end-to-end
against production for the first time since `upsertFight.ts` changed;
zero results reported, independently confirmed correct (all 8 synced
events are still in the future). Ran the settle job itself live: `0
settled, 0 disputed, 152 still waiting`, confirmed via a real `job_runs`
row.

**Status:** D1 done. Next: D2, dual settlement (writing `pick_correct`/
`pnl_units` onto every pick once its fight settles).

## Phase 34 — D2: dual settlement, and a real access-control bug caught live (2026-09-01)

Found and fixed a real gap in D1's own settle job before writing
anything new: it never checked for an open `disputed_opponent` conflict
before settling a fight's winner. Fixed in `settleFights.ts` directly.

New: `lib/settlement/settlePicks.ts`, and `picks.settled_at`
(`0022_dual_settlement.sql`) -- the only reliable "has this pick been
processed" signal, since `pick_correct`/`pnl_units` alone can't tell an
unsettled pick apart from a settled void pick with no bet (both stay
null/null forever). Deliberately not paired with `pick_correct` the way
`fights.settled_at`/`settled_from` are -- that pairing would be wrong
here, since a legitimate void keeps `pick_correct = null` on purpose.

**A serious access-control bug caught live, before this was called
done.** The trigger's door-opening for D2 needed to distinguish the
settlement job (`service_role`) from every other caller. The first
version checked `current_user = 'service_role'` -- reasonable-looking,
wrong in practice. Live-testing it properly (a real owner session, then
a real service_role session, against a throwaway pick, using the exact
`set local role` + `request.jwt.claims` technique `CLAUDE.md` already
documents) caught the bug before merge: the owner was correctly
rejected, but so was the **settlement job itself** -- D2 could never
have written anything. Root cause: the function is `SECURITY DEFINER`
(needed since 0020 to read `data_conflicts`), which swaps `current_user`
to the function's owner for its whole execution, regardless of caller.
Fixed with `current_setting('role', true)` instead (a new migration,
0023, since 0022 was already applied) -- verified the same live way,
both directions, before shipping.

Ran the real `settlement:run-jobs` script (D1 + D2 chained) against
production: `0 settled, 0 disputed, 152 still waiting` / `0 picks
settled across 0 fights` -- correct, confirmed via two real `job_runs`
rows.

**Status:** D2 done. Phase D (settlement) is complete. Next: Phase E
(the scoreboard).

## Phase 35 — E1: the two-board scoreboard (2026-09-02)

`docs/user-flows.md` had already answered nearly every real UX question
before this phase started -- the exact empty-state copy, the 10-card
small-sample threshold, and the unpriced-picks rule all came straight
from Flow 3. What was left to design was the computation itself.

Three new pure, mutation-verified functions in `lib/scoring/`:
`determineFavorite` (lower decimal price wins the market's favour; a
genuine tie breaks toward `fighter1`, deterministic), and
`aggregateUnitsLine`/`aggregateAccuracyLine`, shared by all three lines
on each board. Chalk isn't stored -- it's a live simulation, for every
settled+priced fight, of a flat 1-unit bet on the favourite, scored
through the exact same `scoreBetPnl`/`scorePickCorrect` a real bet uses.

A real design question resolved by re-reading the PRD closely: only the
intern needs a head-to-head-vs-full-card split, not "me" -- my own picks
are already exactly the fights I chose to judge, so my one number is
already the fair comparison point. Built the full `InternAccuracyLine`
shape now, correctly, even though it's trivially empty until Phase G
ships real intern picks.

A real gap caught reviewing my own first draft, before it shipped: the
accuracy board's "no data" row would have silently dropped the intern's
full-card context whenever head-to-head had zero overlap but full-card
already had real data. Fixed so those two states render differently.

New route `/scoreboard`, owner-gated (mirrors `/conflicts`), added to
the sidebar. Verified live, safely: the real query shapes ran against
production via a throwaway read-only script -- `0` settled fights, `0`
settled picks, matching D1/D2's own live runs. The page's empty state
is genuinely what a real visit renders right now.

**Status:** E1 done. Next: E2, the filterable pick table with the PRD's
breakdowns (weight class, stance matchup, favourite vs underdog, flag
present).

## Phase 36 — E2: the filterable pick table (2026-09-02)

Lives on `/scoreboard` itself, under the two boards -- `docs/user-flows.md`
had already ruled out a separate route ("pick history... not its own
route"). USER picks only: "pick history" reads as the owner's own log,
and the intern has no rows regardless until Phase G.

One new pure, mutation-verified function: `describeStanceMatchup`
(`lib/scoring/`) -- canonicalizes a stance pairing by sorting, so
"Orthodox vs Southpaw" and "Southpaw vs Orthodox" are always the same
bucket. Verified live that this matters in practice: a real production
sample of fighters came back with `stance: null` on all three checked,
confirming the "Unknown" fallback is a real, common case.

Favourite/underdog reuses E1's `determineFavorite` directly. `flag
present` ships as a real, visible filter control, disabled with a stated
reason ("arrives with the rumour engine, Phase F") rather than omitted --
the same "state the control, don't hide it" principle the Intern line
already applies, extended to a filter for the first time. Filtering is
client-side; the summary line above the table reuses
`aggregateAccuracyLine`/`aggregateUnitsLine` on the filtered subset, the
identical reduction the boards themselves use.

`/impeccable audit` run on the full E1/E2 surface, per ROADMAP.md's own
design cadence. Mechanical detector clean both before and after; a
manual pass caught two real accessibility gaps -- a `title` attribute
(unreliable for screen readers/touch) replaced with visible text plus
`aria-describedby`, and a missing `<caption>` on the pick table, added.
18/20 (Excellent) after the fixes.

Verified live, safely: the two new queries (`events`, `fighters`) ran
against production -- both resolve, and the real sampled stance data is
what caught the null-stance case above before it could surprise anyone.

**Status:** E2 done. Phase E (the scoreboard) is complete. Next: Phase F
(the rumour engine) or Phase G (the intern) -- both are independent of
what's shipped so far; worth confirming which one to take next.

## Phase 37 — F1: verification spike, and a real social-source pivot (2026-09-02)

Started as a verification spike for the plan's original source (Reddit)
and ended up re-deciding the social source entirely. X was ruled out on
hard fact: its free tier was discontinued in February 2026, directly
violating the project's $0/month constraint. Reddit was checked live,
not assumed changed from a stale headline -- extensive real
troubleshooting (a network-security block on the user's own connection,
CAPTCHA staleness) eventually surfaced the real cause: Reddit's
"Responsible Builder Policy" (June 5, 2026) closed self-service app
registration, replacing it with a manual, opaque approval process with
no guaranteed outcome.

Bluesky was verified live and chosen instead -- free, no approval queue,
and a real content check found genuine signal: established MMA outlets
bridge their coverage onto it, turning up real, current, named-source
posts. Two real technical findings, neither assumed: Bluesky's own
"public" API host blocks search specifically (fixed by routing through
the authenticated session's own host instead), and a meaningful share of
the best content arrives via bridge accounts with empty post text, the
real content living in a link-embed field instead (`lib/bluesky.ts`
falls back to it).

Gemini was verified too, with a real model-selection finding: every full
"Flash" model checked caps at 20 free requests/day, while the
Flash-Lite tier gets 500 -- confirmed via the account's own real
dashboard, since Google's docs refuse to publish a fixed number. A live
side-by-side test found Lite matches full Flash's output quality on a
realistic clustering prompt exactly, so `lib/llm.ts` targets
`gemini-3.5-flash-lite`.

Both wrapper modules (`lib/llm.ts`, `lib/bluesky.ts`) were verified live
end-to-end as the actual shipped code, not just via raw throwaway fetch
calls to the underlying APIs.

**Status:** F1 done. Next: F2, clustering into `rumour_flags` +
`rumour_sources`, with a degrade-loudly fallback.

## Phase 38 — F2: the clustering job, and a real bug found by running it live (2026-09-02)

`rumour_flags` + `rumour_sources` (`0024_rumour_flags_and_sources.sql`),
public-read, service-role-write-only like `odds_snapshots`/`job_runs`.
One user decision confirmed first: adding an `'other'` category bucket
alongside the PRD's four named concern types (weight cut, injury, camp
change, short-notice replacement), so a real corroborated concern that
doesn't fit those four still gets surfaced instead of dropped.

`lib/rumours/` is the full pipeline: search Bluesky per fighter on the
nearest upcoming card, cluster via Gemini (with a keyword + fuzzy-name
heuristic fallback on any LLM failure), upsert by `(fight, fighter,
category)` so corroboration accumulates across job runs. The LLM's raw
output is never trusted at face value — `parseClusterResponse.ts`
independently re-validates every fighter attribution, category, and
source uri, dropping anything hallucinated or ambiguous rather than
guessing. Corroboration count is never a stored column, matching the
scoreboard's chalk-line rule: it's `count(*)` on `rumour_sources` at read
time.

Test-first and mutation-verified: the heuristic fallback, the
near-duplicate collapse (the actual "corroboration counts independent
claims, not raw post volume" rule), the fighter-mention matcher, and the
LLM-response validator.

**Run live against production three times in a row, real upcoming card
(UFC Fight Night: Hooker vs. Parnasse, 11 fights) — and it found a real
bug the unit tests couldn't.** The first run wrote a flag with **zero**
attached sources: the original schema's `unique(post_uri)` was global,
so when the same real post supported two different flags about the same
fighter (a short-notice-replacement announcement that also mentioned a
past weight miss), the second flag's source insert silently lost the
constraint race. Fixed same-day (`0025_rumour_sources_unique_per_flag.sql`
— scoped to `unique(flag_id, post_uri)` instead) and re-verified live:
every flag now carries real sources, and a third immediate re-run
confirmed real accumulation (one flag's corroboration grew from 1 to 3
sources as new posts appeared) with zero duplicate rows, checked directly
against the table.

The same live run also caught the degrade-loudly path firing for real,
not simulated: one of the 11 fights genuinely hit an LLM failure mid-run
and fell back to heuristic clustering, correctly recorded in `job_runs`.
And it caught a real prompt gap — early output included past-fight
result recaps ("secured a first-round knockout victory...") as if they
were pre-fight concerns; `buildClusterPrompt.ts` now explicitly excludes
anything that isn't a live risk to the *upcoming* bout.

**Scope note:** PRD UC-1 wants sourcing to distinguish a named
journalist, the camp, or the fighter. Only named-outlet detection is
built (`.web.brid.gy` bridge accounts, F1's finding) — there's no stored
mapping from a fighter to their own or their camp's Bluesky handle
anywhere in this schema, so that part is honestly out of scope for now
rather than faked.

`.github/workflows/rumours.yml` runs every 6 hours; `GEMINI_API_KEY` and
both `BLUESKY_*` secrets added to GitHub Actions (piped from `.env.local`,
never displayed) alongside the existing `ODDS_API_KEY`.

**Status:** F2 done. No UI reads this data yet — that's F3: flags on
card rows + full sources with links on `/fights/[id]`.

## Phase 39 — F3: flags on card rows, full sources on the fight page (2026-09-02)

`features/rumours/` UI: a terse rumour-flag badge per fighter on
`/events/[id]`'s bout rows (one tap through to full detail), a grouped
full rumour section with every source and a real clickable link on
`/fights/[id]`, and a page-scoped "last scraped X" / "Flags unavailable"
notice covering both states `docs/user-flows.md` names for the card view.
Kept deliberately separate from the existing global `JobHealthBanner`
(odds-specific app-shell chrome) rather than folded into it, since
rumour flags only ever appear on two routes.

Moved `evaluateJobHealth` from `features/job-health/` to `shared/utils/`
the moment `features/rumours` needed the same logic too, per the
layer-boundary rule -- a small, mechanical relocation, not a rewrite.

Test-first: `postUriToWebUrl.ts`, resolving the stored AT-URI into a
real, clickable `bsky.app` link -- an ID/redirect-resolution concern
(CLAUDE.md's test-first list), mutation-verified.

**Verified live against real F2 production data, not just type-checked.**
A throwaway script exercised the actual API functions the pages call and
caught one more real gap: Bloody Elbow posts under both a `.web.brid.gy`
bridge account and a separate native `bloodyelbow.com` handle, and only
the bridge one was recognised as a named source. Fixed the allowlist and
corrected the two already-written production rows (an update, not a
delete).

Lightweight `/impeccable audit` per the design cadence: mechanical
detector clean; manual review found and fixed two real responsive gaps
(one new stylesheet was missing the narrow-viewport handling its
siblings all have). Accessibility, theming, and performance all clean.

**Status:** F3 done. Next: F4, rumour outcome marking on settled cards
(UC-5) -- what makes the PRD's rumour precision metric measurable.

## Phase 40 — F4: rumour outcome marking, Phase F complete (2026-09-02)

`rumour_flags.outcome`/`outcome_marked_at` (`0026`), null-means-pending
like `data_conflicts.resolved_at`. One `markRumourOutcomeAction`
(owner-only, settled-fight-only, both re-checked server-side against the
real session and the real `fights.settled_at` -- never trusted from the
caller) rendered in two places: inline on `/events/[id]`'s bout row (no
click-through needed, matching docs/user-flows.md's "beside the flag, on
the card you already have open") and on `/fights/[id]`'s full rumour
section. A read-only outcome tag shows the marked state to every
visitor once set; only the marking buttons are owner-gated.

Caught two real bugs in my own draft before they shipped: the outcome-
marking wrapper div rendered an empty bordered box on every settled fight
with zero flags (missing a `rumourFlags.length > 0` gate), and a leftover
CSS-module reference (`styles[outcome]`) pointed at classes that no
longer existed after deciding not to color-code the three outcomes.

Deliberately no DB trigger enforcing the settled-only rule -- an
in-action check is proportionate here, matching `resolveLowConfidenceAction`'s
own precedent, not the heavier trigger machinery reserved for money-
adjacent guarantees.

Verified live against real production data without fabricating fake
settled/flag rows to do it: exercised the settled-check logic directly
via the admin client against a real, still-unsettled F2 flag, confirming
it correctly identifies the fight as unsettled and that the new columns
read as `null`. The happy path isn't independently live-verified yet --
nothing has settled since F2 shipped -- worth a first real check once a
watched card actually finishes.

Lightweight `/impeccable audit`: clean, no fixes needed.

**Phase F (the rumour engine) is now fully done, F1 through F4.**

**Status:** F4 done. Next: Phase G, the intern -- market-anchored,
rumour-adjusted picks on every fight.

## Phase 41 — G1: the intern picks every fight, and a real security hole closed first (2026-09-02)

Found before writing any intern code, not after: the pick-lock trigger's
settlement bypass keyed on the WRITER's role alone, so the intern's own
service_role cron would have been able to write a pick past a started or
finished card, silently invalidating the entire you-vs-intern comparison.
Fixed same-day (0027_narrow_settlement_bypass.sql -- the bypass now also
requires the write to touch only the three real settlement columns) and
live-tested in a rolled-back transaction: a late service_role INSERT and
a late revision are both correctly rejected, the real settlement update
still works, nothing leaked into production.

Three real decisions confirmed before building: a deterministic pick
rule instead of an LLM call (reproducible, free, and what makes a future
calibration check mean anything); the intern still picks an unpriced
fight, anchored at an even 50%; and it revises its pick until the card
locks rather than committing once.

lib/intern/: decideInternPick.ts is the whole opinion as one pure
function -- a de-vigged market anchor (raw implied probabilities sum to
more than 1, the overround; using them directly would hand the intern
phantom edge on nearly every fight) shifted by a capped,
corroboration-scaled penalty per flagged fighter. Test-first,
mutation-verified: the de-vig and the adjustment direction are the two
things easiest to get silently backwards, and both mutations were
caught by the test suite.

Run live against production: 81 real upcoming fights, 81 picks written,
0 failures. Spot-checked three real flagged fights by hand against the
function's own logic -- matched exactly. Re-ran immediately after: 0
written, 81 unchanged, confirmed against real updated_at timestamps, not
just the summary counts.

**Status:** G1 done. Not yet decided: whether the intern's pick shows on
the card view row (Flow 1 shows one) as part of G1/G3 or its own step.
Next: G2, edge-gated betting.

## Phase 42 — Production outage: OWNER_USER_ID never set on Vercel (2026-09-02)

`/events/[id]` and `/scoreboard` both hard-crashed in production the
first time the real owner (signed in as `gary_reyes@dlsu.edu.ph`) opened
them. Root cause: `OWNER_USER_ID` was never configured on Vercel --
present on GitHub Actions (for the batch jobs) but nobody had added the
app's own separate copy. `isOwner()` short-circuits to `false` for a
logged-out visitor before ever touching the env var (which is why every
page loaded fine logged out, and why this hid from every check this
session ran), but a genuinely logged-in owner hit `requireEnv`'s hard
throw with no explanation beyond a generic Vercel error digest.

Confirmed the real fix has two independent parts, live against
production: `OWNER_USER_ID=80ae2af8-4f13-42fc-b9b3-3e07d13e762b`
(`gary_reyes@dlsu.edu.ph` -- confirmed with the user directly; the other
real account on this app, `garyludelq@gmail.com`, is not the owner) added
on Vercel, and `SUPABASE_SERVICE_ROLE_KEY` confirmed present. Also fixed
a second, separate drift found while confirming `is_owner()`'s live
value: `0017_owner_allowlist.sql` in git still contains the literal
`'REPLACE_WITH_OWNER_USER_ID'` placeholder its own comment told the
original author to substitute by hand -- the live database has been
correct this whole time (verified directly via `pg_get_functiondef`),
but a from-scratch rebuild from migrations alone would produce a
completely broken `is_owner()`. Fixed with a new no-op migration
(`0028_is_owner_real_id.sql`) rather than editing the applied one,
confirmed byte-for-byte identical against the live function body, and
re-verified live in a rolled-back transaction that the real owner id
still resolves `is_owner() = true` and the other real account resolves
`false`.

**A deliberate hardening decision, confirmed with the user rather than
just shipped:** a missing `OWNER_USER_ID` or `SUPABASE_SERVICE_ROLE_KEY`
now degrades every owner-gated page to its existing read-only/"Not
available" view instead of crashing, plus a specific on-page notice
(`OwnerConfigNotice`) naming exactly what's missing -- loud, but no
longer a blank page. `describeOwnerConfigError.ts` narrowly recognizes
only these two known failure messages and rethrows anything else
unrecognized, so a real, unrelated bug can never get silently
reclassified as "just a config gap" -- test-first, mutation-verified
against exactly that risk. Reproduced the real incident directly (env
var deliberately unset, the actual owner's real user id, the actual
production code path) and confirmed it now degrades correctly instead
of throwing, for both the `OWNER_USER_ID` and `SUPABASE_SERVICE_ROLE_KEY`
cases independently.

**Lesson for next time, recorded in `.env.local.example`:** `.env.local`
only reaches the local machine. A value filled in there does nothing for
the deployed site -- Vercel needs its own separate copy in its own
dashboard, and this is exactly the mistake that caused the outage.

## Phase 43 — G1b: Elo ratings, after ruling out every external source (2026-09-02)

The user's real ask: the intern should weigh who a fighter has actually
beaten. Investigated properly before writing any code, and almost
everything hoped for turned out unbuildable: pre-UFC/regional history
(KSW, LFA, Cage Fury, CFFC) isn't reachable at all -- the API-Sports
free tier this app already uses flatly refuses any season before 2022
(a real, previously undocumented limit, found live), and even inside
the allowed window a real fighter's history came back UFC-only.
Tapology and Sherdog were both ruled out on explicit policy, not a
technical wall -- Tapology's own robots.txt disallows Claude's crawlers
by name, Sherdog's Terms of Use prohibit scraping outright. Reading MMA
YouTubers'/TikTokers' own predictions was investigated too and mostly
ruled out the same way. Full trail in ARCHITECTURE.md Fork 11.

**What shipped instead answers the same real question with data this
app already owns.** An Elo rating (lib/elo/), derived purely from UFC
win/loss/method history. Two decisions confirmed with the user: one
global rating per fighter, not per weight class (too few UFC fights per
fighter for a per-division number to settle); full history snapshotted
per fight, not current-value-only (a future calibration check needs to
know what the intern knew AT THE TIME of a pick, not today).

Integrates the same way rumour flags already do -- one more bounded,
signed adjustment on the market anchor, never a second prediction
blended in. Confidence is now also capped when either fighter has a thin
rated-fight sample, directly answering the debutant question raised
mid-conversation: a debutant matchup no longer reads as confidently as a
veteran one at the same raw probability.

A real distinction the schema can't make on its own: winner_id = null
means either a draw or a No Contest, and Elo has to treat them
completely differently. method text is the only signal that
disambiguates them, and when it's null too, excluded entirely rather
than guessed.

Test-first, mutation-verified across eloMath.ts, computeEloHistory.ts,
and eloAdjustment.ts (31 tests) -- the rating-update direction, the
chronological sort, the NC-exclusion guard, and the adjustment cap were
each independently confirmed load-bearing.

Verified live against production: the settlement chain (now including
Elo recompute) correctly produced a provable no-op against the real,
currently-empty settled-fight set. Re-ran the intern job immediately
after: all 81 real upcoming picks correctly rewrote with the new Elo
line and correctly-capped confidence, spot-checked directly against a
real row.

**Status:** G1b done. Next: G2, edge-gated betting.

## Phase 44 — G2: edge-gated betting (2026-09-02)

decideInternBet.ts -- the second judgment, deliberately its own pure
function separate from decideInternPick.ts, per UC-2's own rule that a
pick and a bet "must not be collapsed." Combined only at the I/O layer
into picks' single reasoning column.

Checks edge on both fighters, not just the predicted one --
probabilityForFighter.ts (C4) exists precisely because a bet may back a
different fighter than the pick.

One real decision confirmed with the user: stake sizing scales with edge
AND confidence together, not edge alone -- the first real place G1b's
confidence cap does more than change a displayed number. Two bets with
identical edge now get different stakes if one rests on a near-debutant
matchup.

Test-first, mutation-verified (11 tests) -- the edge-threshold gate and
the both-fighters comparison were each independently confirmed
load-bearing. The threshold mutation was caught by PRD UC-3's own
headline example (a -6000 favourite, ~0 edge) coded directly as a test
case.

Verified live against real production data twice: the actual scheduled
job ran against all 81 real upcoming fights (all unpriced, all correctly
declined, confirmed idempotent on a second pass). Separately, since
odds_snapshots is immutable by trigger even for service_role, the
positive-edge path was verified by calling the real functions directly
against a real production fight with a synthetic price and a real Elo
gap: correctly flipped the bet, computed a real edge, and correctly
sized the stake down for low confidence.

**Status:** G2 done. Next: G3, intern lines on both boards + a
calibration check.

## Phase 45 — G3: calibration check + the intern's pick on the card view (2026-09-03)

Getting oriented found half of G3 already done: E1/E2 had already built
the Intern line on both boards correctly, before any real intern data
existed, so nothing needed reworking now that it does. Confirmed live --
getScoreboardData ran unchanged against production.

What was actually missing: the calibration check itself, and the gap G1
left open -- the intern's pick never showed on the card view row.

computeCalibrationBuckets.ts (lib/scoring/) answers "of the fights called
70%, did roughly 70% happen" with six bands (50-60% up to 90-100%, plus a
defensive "Under 50%" catch-all), computed for both "me" and "intern"
against each line's own full settled population, not the accuracy
board's head-to-head restriction. No chalk column -- chalk has no
independent probability estimate to be right or wrong about. Test-first,
mutation-verified: the band boundary and the void-exclusion rule (a
draw/NC/cancelled pick has no correct answer to check) were each
independently confirmed load-bearing.

The card-view gap closed via a fact already on record: C1 established
picks as owner-only, not public, which answers whether a read-only
visitor should see the intern's pick (no, same as the owner's own pick).
getInternPicksForFights (features/picks/api.ts), fetched in the same
owner-gated branch of /events/[id], and BoutRow now shows "Intern:
[fighter] (NN%, confidence N/5)" above the pick controls.

Verified live, safely: getInternPicksForFights matched three real
production INTERN picks exactly, field for field. getScoreboardData's
widened query and the new calibration block both ran end-to-end against
production with no error -- 0 settled fights, all six bands empty on
both lines, the correct honest state given nothing has settled yet.

**Status:** G3 done. Phase G (the intern) is now fully done -- G1, G1b,
G2, G3 all shipped. Next: Phase H, cleanup (remove Clans from nav, a
full-app accessibility/responsive audit).

## Phase 46 — H1 + H2: nav cleanup + full-app audit, v2 feature-complete (2026-09-03)

H1: Sidebar.tsx's NAV_ITEMS no longer lists /clans -- the PRD's own
"Should have" item names two options ("retire or clearly hide... from
navigation"), already scoped to the hide option. /clans, /clans/[id],
/invite/[token] all still build and resolve; nothing else in the app
linked to /clans.

H2: mechanical detector run across the whole in-scope tree plus a manual
pass over every surface not already covered by a per-phase audit (app
shell, search, weight filter, auth dropdown, grids, /conflicts). Three
real findings, fixed:

- WeightClassFilter and AuthButton are both hand-built disclosure widgets
  that closed on outside click but never on Escape, and never returned
  focus to the trigger -- a real repeated keyboard-nav gap, not a
  one-off. Extracted into a shared useDismissableOpen.ts (shared/utils/)
  the moment a second component needed the identical fix. AuthButton was
  also missing aria-expanded entirely.
- The fighter-search input had no accessible name (placeholder alone
  isn't reliable) -- added aria-label.
- The search input's focus indicator was thin and asymmetric (1px
  border-color only, no border at all on one edge by design) -- added a
  box-shadow ring.

One finding reported, not fixed: the sidebar's collapse-toggle animates
margin-left/width (real layout-thrash properties). A like-for-like fix
means redesigning the sidebar as an overlay, a real UX change, not a bug
fix -- and the actual cost is one 150ms reflow on a manual toggle click.
Left as a named P3. One finding reported as a false positive, verified:
the detector's overused-font rule flagged Arial, the plain system-font
fallback stack shipped since v1, not one of the rule's own named
AI-slop faces.

Full gate chain green after every fix. Audit Health Score: 18/20
(Excellent).

**Status:** H1 + H2 done. v2 is now feature-complete -- Phases A through
H are all done.

## Phase 47 — Bout identity keyed on fighters, not card position (2026-09-03)

Found from a user report that Mario Pinto vs Ryan Spann (a heavyweight
bout) displayed as "Welterweight".

Root cause: a Wikipedia bout's external_id was `wiki:<title>:<index in
the wikitext>` -- a fight's identity was its POSITION on the card. When
Wikipedia added two bouts higher up the card, everything below shifted,
so index 3 stopped meaning "Pinto vs Spann" and started meaning
"Donchenko vs Soriano". upsertFight matched the OLD row by that id and
wrote the NEW bout's weight_class onto it (the update payload carries
weight_class/bout_order, never the fighters), then returned "upserted" --
so the incoming bout was never inserted either.

Three symptoms, one bug: 4 of 11 stored bouts carried another fight's
weight class; 3 of the card's 14 bouts were missing from the app
entirely (never picked by the intern, never rendered); and E2's
weight-class breakdown was silently grouping on corrupt data.

Fixed with buildWikiFightExternalId.ts -- keyed on the sorted fighter
pair, the one attribute of a bout that doesn't move when the card is
reshuffled. Test-first, mutation-verified (dropping the sort, and
dropping the second fighter from the key, each broke exactly the test
built to catch it). upsertFight now also adopts the incoming external_id
when it matches by fighter pair, so rows carrying the old positional key
migrate themselves on the next sync.

Ran the schedule sync live against production with confirmation, then
verified by re-querying rather than trusting the summary: 0 wrong weight
classes (was 4), 14 of 14 Wikipedia bouts present (was 11), every row on
the stable key. Pinto vs Spann now reads Heavyweight.

One self-correction worth recording: I first reported that the missing
Wood vs Andrusca bout had failed to open a disputed-opponent conflict.
That was wrong -- my throwaway diagnostic selected a non-existent column
(`created_at`; the real one is `detected_at`) and, because it
destructured only `data` and never checked `error`, the failed query
printed as "0 conflicts". The app had behaved correctly all along and
opened the conflict. Checked afterward: no real code in src/ makes that
mistake -- every actual Supabase query checks its error.

**Status:** Bug fixed and live data repaired. Phase I (fighter
enrichment + history backfill) is planned and confirmed, not started.

## Phase 48 — I1: Elo rates fights that happened, in the order they happened (2026-09-03)

Elo read `settled_at IS NOT NULL`, ordered by settled_at. Both halves
were wrong. Production had 57 fights with a recorded winner and ZERO
settled fights, so the rebuild ran over an empty set -- Elo has been
computing nothing this whole time. And settlement order is not
chronological order (a disputed bout settles days after later fights
already did), so even once fights settled they would have been rated in
the wrong sequence -- silently, because Elo is sequential.

isResolvedForElo.ts (pure, mutation-verified) is the new eligibility
rule: a fight belongs in the rebuild if it has a recorded outcome,
whether or not THIS app's settlement pipeline was what recorded it.
Ordering moved to the event's own date. 0030_elo_occurred_at.sql renames
fight_settled_at -> fight_occurred_at to match what the column now holds.

Applied live to vrwlfcywyfzfczajpdoh with confirmation, then ran the
settlement chain: 57 resolved fights processed, 94 rating snapshots
written, up from 0.

Surfaced a real data-integrity problem while doing it: only 47 of the 57
were actually rated. computeEloHistory's defensive guard -- written in
G1b as a "this should never happen" check -- caught 10 fights whose
winner_id matches NEITHER of the bout's own two fighters. All 10 are
still on the old positional external_id, and the pattern is clear: UFC
330:7 (Luque vs Gore) records Donte Johnson as winner, who is the fighter
at UFC 330:6. Same position-collision bug as Phase 47, but from before
D1, when upsertFight wrote winner_id directly. Nothing is mis-scored
today (no picks have settled against them), but the rows are factually
wrong. Tracked as I1b; the honest repair is I4's past-event backfill
re-deriving the real winners.

**Status:** I1 done. I1b (repair the 10 impossible winners) and I2-I5 not
started.

## Phase 49 — I1b: cleared 10 fabricated results, and made the state impossible (2026-09-03)

Listing the 10 bad rows in full before touching them caught something
that would have made the repair worse than the disease: method and round
were populated too ("KO (punches)", round 1), stamped from the same
collided write and describing a different bout's finish. Clearing
winner_id alone would have left the method behind -- and isResolvedForElo
returns true on a method alone, while computeEloHistory reads
winner-null-plus-non-NC-method as a REAL DRAW. The 10 rows would have
gone from "excluded" to "fabricated draws that move ratings". All three
fields cleared together instead.

Verified against the real table rather than the write's return value: 0
rows still holding any result value, 0 impossible winners anywhere, 47
fights still carrying a valid recorded winner. Re-ran the Elo rebuild:
47 processed, 94 snapshots -- identical to before the repair, proving
the cleared rows contributed nothing and no rating moved.

0031_winner_must_be_in_the_bout.sql then makes the state unrepresentable
rather than merely absent: a CHECK that a winner is one of the bout's own
two fighters, matching what 0019_picks.sql already enforces for a pick's
predicted fighter. Live-tested in a rolled-back transaction -- an
outsider is rejected, a real participant still accepted.

Ten past fights now correctly show no result, because the app genuinely
does not know it. I4's past-event backfill is what re-derives the real
winners.

**Status:** I1 and I1b done. I2-I5 not started.

## Phase 50 — I2: fighter matching + enrichment (2026-09-03)

Matches name-only fighters against API-Sports, mirroring
lib/odds/matchFights.ts's auto-match/review-queue shape. nameSimilarity
moved from lib/odds/ to a neutral lib/text/ once a third feature needed
it (lib/rumours/ already imported across from lib/odds/ before this
move even started).

decideFighterMatch.ts (mutation-tested): >=0.85 confidence auto-applies
the candidate's full record; below it opens a new
low_confidence_fighter_match data_conflicts row with the FULL ranked
candidate list, not just the top guess, so the owner's /conflicts review
can correct the algorithm. No candidates at all is not a conflict -- a
real debutant or recent signee simply hasn't reached API-Sports yet.

enrichFighters.ts is self-throttling and resumable with no new queue
table -- external_id is null and enrichment_checked_at is null IS the
queue. 0032_fighter_enrichment.sql adds weight_kg/nickname/team/
enrichment_checked_at plus the 4th data_conflicts kind.
LowConfidenceFighterMatchCard wired into ConflictCard's exhaustive
switch. Once-daily scheduled job at 06:00 UTC, between sync.yml's two
runs, DEFAULT_BATCH_SIZE=40.

Verified live against production TWICE, at the real batch size, not a
token sample. First run: 40 attempted, 28 matched, 0 queued, 3 absent,
9 failed -- every one on the identical error, a real previously-
undocumented API-Sports limit: /fighters?search= rejects diacritics,
hyphens, apostrophes, and trailing periods. Fixed same-day with
sanitizeSearchQuery.ts (folds diacritics via a new foldDiacritics.ts,
extracted from nameSimilarity's own internal fold), the 9 real failures
kept as regression fixtures. Re-ran live: 40 attempted, 26 matched, 0
queued, 13 not found, 1 failed -- down from 9.

The one remaining failure is a real, separate finding, not an I2 bug: a
unique-constraint rejection because two DIFFERENT fighters rows already
existed for the same real person ("Andre Lima" already enriched,
"André Lima" a Wikipedia-only placeholder) -- upsertFighter.ts's
name-matching fallback never folds diacritics, so the two were never
recognized as one fighter. Predates I2, reaches beyond it into the core
sync path, and deserves its own test-first pass rather than a rushed fix
here -- tracked as I2b.

Combined: 80 fighters attempted, 54 matched, 0 queued for review (the
review-queue UI itself is unit/mutation-tested but not yet live-
exercised -- no real attempt landed below threshold with a candidate),
16 confirmed absent, 1 known diagnosed failure. 152 fighters now enriched
(98 pre-existing + 54 new), 105 remaining in queue -- clears over the
next ~3 daily runs.

**Status:** I2 done. I2b (fix upsertFighter.ts's diacritic-blind
matching) tracked, not started. I3-I5 not started.

## Phase 51 — I2b: fighter identity across sync sources, plus a bigger finding (2026-09-03)

namesMatchExactly.ts (lib/text/, mutation-verified) -- deliberately an
EXACT match after folding case/diacritics/whitespace, never fuzzy: this
backs an automatic, unattended write, unlike nameSimilarity's fuzzy
score which only ever feeds a human review queue. normalizeName.ts
extracted from nameSimilarity's own internal fold, the third consumer
for the identical transform.

upsertFighter.ts's existing ilike exact-match stays first (cheap, one
row); only when that finds nothing does it fetch every fighter's name
and check namesMatchExactly -- paid only on the path already about to
insert a new row or (as here) miss a real duplicate.

Live investigation surfaced something bigger than expected, not fixed
in this pass: the orphan "André Lima" row wasn't dead data -- it's
referenced by a real fights row. A SECOND, separate fight row exists for
the exact same real bout (Andre Lima vs Namsrai Batbayar, UFC Fight
Night: Nurmagomedov vs. Song), one written by each sync source, because
the two Limas never resolved to one fighter. This should have been
caught by A2's own disputed-opponent detection and was not -- confirmed
directly, zero data_conflicts rows exist for either fight. Why the
existing safety net missed it is not yet understood; tracked as I2c
rather than guessed at. The live duplicate fights/fighters rows are not
merged in this pass -- that's a genuinely destructive multi-table
repair, brought back as an explicit question rather than done
unilaterally.

**Status:** I2b done (the code fix, prevents future occurrences). I2c
(why A2 missed the live duplicate) and the live data repair itself are
both open, pending a decision. I3-I5 not started.

## Phase 52 — I2c: retroactively applying A2 to data that predates it (2026-09-03)

A2's disputed-opponent detection was never broken -- replayed directly
against the real Lima/Batbayar duplicate and it fires correctly, both
directions. It only ever runs on a live write, and never retroactively
checked fights already in the table before it shipped 2026-09-01. This
event is dated 2026-08-29; once a past event's sync window closes,
nothing calls upsertFight for it again, so a duplicate from before A2
existed stays permanently invisible to it.

Swept the whole table, not assumed one-off: clusterFightsBySharedFighter.ts
(pure, mutation-verified -- union-find over A2's own relation) found 10
real clusters across 158 fights, not 13 isolated pairs. Two were genuine
3-fight chains (Gauge Young implicated across three rows; Ce Liu/Junior
Tafa/Levi Rodrigues Jr. similarly) that a naive pairwise sweep would
have double-resolved. Caught a real gap in the test suite along the
way: the first mutation test run passed against a mutation that only
checked array-adjacent pairs, because every fixture happened to place
connected fights next to each other -- closed with a fixture placing
them apart before trusting the suite.

Of the 10 clusters, only 2 were the diacritic case I2b fixes (André/Andre
Lima, Márcio/Marcio Barbosa). The other 6 span nickname forms, name-order
swaps, and missing spaces in transliterated names -- none catchable by
I2b's exact-after-fold match, several genuinely different-looking names
an automatic merge should never attempt.

sweepLatentDisputedOpponents.ts resolves the 8 clean 2-fight clusters
through the EXISTING disputed-opponent conflict machinery, unmodified --
zero new UI. Deletes the candidate's own row as part of opening the
conflict (unlike the live path, where a candidate never has a row of its
own) -- confirmed zero downstream references on all 22 involved rows
first.

Live run failed on the first attempt, caught by the database, not
assumed safe in advance: fighter_elo_history has an FK on fight_id, and
several duplicates carry a real result I1's recompute had already
rated. Confirmed nothing partially wrote before fixing it, then cleared
each candidate's own Elo rows before deleting it and ran one full
recomputeEloRatings() after the sweep.

Verified live against the real tables: 150 fights (158 - 8), 9 open
conflicts (8 new + the 1 pre-existing) with correct kept/candidate
pairings, the 6 untouched three-way-cluster fights still present, Elo
at 82 rows -- exactly 94 minus the 12 cleared.

The 2 three-way clusters are deliberately untouched -- the existing
conflict shape is one-kept-vs-one-candidate, not N-way. Tracked as I2d.

**Status:** I2b, I2c done. I2d (resolve the 2 three-way clusters) and
I3-I5 not started.

## Phase 53 — Resolved 8 of the 9 open conflicts (2026-09-03)

Data operation, no code change. Each conflict was judged against
Wikipedia (the app's own parser, not eyeballing the page) rather than
guessed at, then applied using the SAME buildDisputedOpponentResolution
pure function the /conflicts buttons use -- the action itself is
cookies()-gated and can't run outside a request, but its logic lives
entirely in that pure function, so nothing diverged from what clicking
through would have done. Each write was guarded by a sanity check that
the kept row still matched what had been analysed.

Two were genuinely wrong data, confirmed against Wikipedia:

- Nathaniel Wood's opponent was Mairon Santos in the DB; Wikipedia's
  live page says Pavel Andrusca. Santos was the replaced opponent, and
  this is on the upcoming 2026-09-05 card.
- Miles Johns was recorded against "Jessie Rosas"; Wikipedia says
  "Miles Johns def. Gianni Vázquez (TKO punches, R1)" -- exact match for
  the candidate.

Six were the same real bout recorded twice under name variants
(diacritics, nicknames, name-order swaps, missing spaces). Resolved
toward whichever side carried ENRICHED fighter identities plus a
recorded winner, since that is what feeds Elo and the intern; method
text is cosmetic and the settlement job can refill it.

A prediction of mine turned out wrong, in a good way: I expected
choosing "candidate" to lose the richer Wikipedia method text.
buildDisputedOpponentResolution runs stripNullish, so a null method on
the candidate never overwrites a real one on the kept row -- Barbosa and
Johns kept both the enriched fighter AND their method.

One left open deliberately: Louie Sutherland. Wikipedia now says "José
Montanha def. Louie Sutherland", which matches NEITHER stored name
("Henrique da Silva Lopes" from API-Sports, "José Luiz" from an older
Wikipedia scrape -- the page was edited between our sync and now). All
three could be the same Brazilian fighter under different name
conventions and a nickname, or not. Not guessed at.

Verified against the real tables: 1 open conflict remaining, 8 resolved
with the correct resolution strings, every changed bout showing the
expected fighters/winner. Elo rebuilt afterward since several
resolutions added recorded winners -- 45 fights processed, 90 snapshots
(up from 41/82), because four bouts gained a real result. Re-ran the
intern job: 1 pick written, 0 held by a conflict (down from 1).

**Status:** 1 conflict open (Sutherland, needs a human call). I2d and
I3-I5 not started.

## Phase 54 — I2d: the two 3-fight duplicate clusters (2026-09-03)

Both turned out to be the identical real-world shape as the earlier
conflict fixes: an originally-announced opponent got replaced, and the
sync had independently captured both the before and after. Wikipedia's
current page settled both definitively -- "Stanley Dorsainvil def.
Gauge Young" and "Liu Ce def. Levi Rodrigues Jr." -- neither mentioning
the third name in either cluster (Kody Steele; Junior Tafa) at all.

Handled as a direct manual repair, not routed through data_conflicts --
unlike Louie Sutherland, there was no genuine ambiguity left; Wikipedia
had already settled it. For each cluster: filled in the real
method/round (and, for Cluster B, the weight class it was missing
entirely) on the row matching Wikipedia, deleted the two stale rows,
deleted one resulting fully-orphaned unenriched fighter row ("Liu Ce").
Kody Steele and Junior Tafa's own fighter records untouched -- both
real, just not on these cards after the replacement.

A concrete correctness bug closed, not just tidiness: Gauge
Young/Dorsainvil's result had been counted TWICE by Elo. Confirmed by
the recompute's own numbers: 45 fights processed -> 44, 90 snapshots ->
88, exactly matching the one duplicate that had been contributing.

Verified live: 0 of 4 deleted fights still present, both survivors show
the exact filled-in data, the orphan fighter gone, Kody Steele/Junior
Tafa untouched, 146 total fights (150 - 4).

**Status:** All open conflicts and known latent duplicates resolved,
except the one genuinely-ambiguous case (Louie Sutherland) that needs a
real person identified. I3-I5 not started.

## Phase 55 — I3: fight-history backfill 2022-2024 (2026-09-03)

fetchFighterSeasonHistory hits the same /fights resource the existing
recent-results sync already uses, scoped by fighter+season instead of
date, sharing its UFC-only filter. processFightHistoryEntries.ts
extracted the event/fighter/fight upsert sequence out of syncJob.ts once
this became the second caller needing it -- syncJob.ts unchanged in
behaviour, no longer duplicating the logic.

backfillFightHistory.ts is self-throttling and resumable with no new
queue table, same shape as I2's enrichment_checked_at: the query is
external_id is not null and history_backfilled_at is null. A discovered
opponent gets its own rows so Elo can rate them, but its own history
isn't chased recursively in the same run -- unbounded otherwise; if they
later become independently enriched, they reach the front of this same
queue on their own.

Once-daily at 18:00 UTC -- 6h clear of both sync.yml runs and
fighter-enrichment.yml, evenly spacing the four jobs now sharing
API-Sports' 100/day budget.

Verified live, and the result was itself informative: the first real run
hit the day's quota already exhausted (every other job had already spent
it). All 5 fighters in the batch failed identically, exactly the case
the design exists to handle gracefully -- caught per fighter, none
marked history_backfilled_at, zero partial writes, job itself still
completed and logged a real job_runs row (status: success, failed: 5 in
the summary -- the same shape I2's own failed field already uses).

Stated honestly: the happy path -- a real fighter's history actually
being fetched and written -- has not yet been observed live, only the
graceful-degradation path. The next scheduled run, once quota resets, is
the first real proof.

**Status:** I3 done, happy path unverified pending quota reset. I4-I5
not started.

## Phase 56 — the rumour scan job's createSession retry storm (2026-09-03)

Every scheduled Rumour scan run had failed since the job shipped
(2026-09-02) -- 6 for 6, all `429 RateLimitExceeded` on
`com.atproto.server.createSession`. Not a credentials problem: the job
was rate-limiting its own Bluesky account and never letting it recover.

**Root cause.** `com.atproto.server.createSession` is rate-limited to
**30 per 5 minutes and 300 per day, per account** (verified against
docs.bsky.app -- a separate, far stricter limiter than the 3000/5min
global cap F1 already documented). `bluesky.ts`'s session cache only
helped once it was warm: `scanFightForRumours` runs
`Promise.all([search(f1), search(f2)])` per fight, so on a cold cache
both calls raced into their own `createSession`, and once that 429'd the
cache never populated -- so all ~14 fights retried it. ~28 attempts per
run, 4 runs/day, plus F1-F4's own dev testing on 2026-09-02: comfortably
past 300/day, and every subsequent run's 28 attempts kept it there.

**Fix, in `bluesky.ts`:**

- **Single-flight** -- concurrent cold-cache callers await one in-flight
  `createSession` (`pendingAuth`), not one each.
- **Failure cooldown** -- after any auth failure, every caller fails fast
  with no network call for 5 minutes (one full rate-limit window). One
  job run now makes at most one `createSession` attempt, success or
  failure.
- `decideAuthAction()` extracted as a pure, tested helper so the
  precedence (valid cache > cooldown > join in-flight > authenticate) is
  asserted, not implied.
- New `BlueskyAuthError`; a 200 response with no `accessJwt` now throws
  instead of caching a dead session for the full 30-minute TTL.

**Fix, in `runRumourScanJob.ts`:** a `BlueskyAuthError` from any fight
aborts the card immediately (re-thrown, not swallowed like a per-fight
network blip) -- one clear job_runs error instead of 14 identical stack
traces, and zero further `createSession` attempts that run.

Test-first (`bluesky.test.ts`, 12 cases): the regression *is* a
call-count bug, so the tests stub `fetch` and assert `createSession` is
hit exactly once across 10 concurrent searches whether auth succeeds or
429s, and not again inside the cooldown. `npm run lint`, `npm run test`
(350 pass), `npm run build` all green.

**Honest caveat:** if the account is still inside its 300/day cap, the
next scheduled run will still 429 -- but once, cleanly, then stop, so the
limit ages out and a later run goes green. Watch `job_runs` for
`rumour_scan` / the Actions tab to confirm.

**Status:** fix merged, live recovery pending a clean scheduled run.
I4-I5 not started.

## Phase 57 — I4: Wikipedia past-event fight-history backfill (2026-09-03)

**The spike passed.** Wikipedia uses the identical `{{MMAevent bout}}`
template for finished cards as for upcoming ones -- `fetchEventSchedule`
reads a past event's results table with no changes (UFC 311: 13 bouts,
all with winner/method/round). Discovery works the same way
`listUpcomingUfcEventTitles` already does: `Category:2025 in UFC` /
`Category:2026 in UFC` (~46 event pages each). One live finding:
Wikipedia's API 429s after ~6 rapid requests, so the job spaces every
call 1.5s.

**New:** `0034_wikipedia_history_backfill.sql` adds
`events.wikipedia_backfilled_at` (the resumable queue marker, mirror of
I3's `fighters.history_backfilled_at`). `selectBackfillEvents.ts`
(test-first, 11 cases) is the date-window + done-set queue filter.
`fetchSchedule.ts` gains `listUfcEventTitlesInCategoryYear` +
`isUfcMmaEventTitle` (test, 4 cases). `processScheduleEvent.ts` extracted
from `syncSchedule.ts` (I3-style, once `backfillWikipediaHistory.ts`
became a second caller -- `syncSchedule` behaviour unchanged).
`.github/workflows/wikipedia-history-backfill.yml`, daily 21:00 UTC,
spends zero API-Sports budget (Wikipedia has no key).

**Live result: ~65 gap events (Jan 2025 -> Aug 2026) backfilled clean.**
fights 146 -> ~970, fighters 273 -> ~786, every bout with real
winner/method/round. `upsertFighter`'s I2b fold held up -- only ~3-4
duplicate identities, all the known name-order/diacritic hard cases.

**A real mistake, caught live and recovered.** The first run used the
"all past events" scope (the confirmed fork pick) and reprocessed 3
events that were already synced and hand-curated in Phases 52-54
(Hernandez vs. Rodrigues, Nurmagomedov vs. Song, and the duplicate
"UFC 330"). Feeding Wikipedia's version of already-settled bouts through
`upsertFight` fired its `sharesExactlyOneFighter` guard and opened ~9
spurious `disputed_opponent` conflicts, partly undoing Phase 53.

Recovery: `backfillWikipediaHistory` narrowed permanently to **gap-only**
-- it now skips any event that already carries fights (synced by another
path). The 2 contaminated non-330 events were reverted exactly to their
pre-I4 state: 8 conflicts deleted, `wikipedia_*` cleared on the 18
adopted rows (zero fight rows were inserted on them, so no deletes),
markers unset. Verified against the real tables: both back to 13 rows,
0 wiki columns; 44 authoritative winners unchanged so no Elo recompute
needed; the ~65 gap events untouched.

**Not done here, tracked as I4b:** the duplicate "UFC 330" (2026-08-15)
vs "UFC 330: Makhachev vs. Machado Garry" (2026-08-16) event merge, and
with it the 10 I1b fights and their 1 remaining open conflict. Also I5
(derive W/L/D, tale-of-the-tape UI). Settlement + Elo propagate the new
graph depth on the normal schedule over the next 24-48h.

**Status:** I4 shipped (gap-only). I4b (UFC 330 dedup) and I5 not started.

## Phase 58 — I4b: the UFC 330 duplicate-event reconciliation (2026-09-04)

Two `events` rows for one real card: "UFC 330" (2026-08-15, from
Wikipedia via I4) and "UFC 330: Makhachev vs. Machado Garry" (2026-08-16,
from API-Sports). Investigation showed they weren't identical -- they
genuinely disagreed:

- Wikipedia had the **complete 12-bout card** with method + round;
  API-Sports had 11 bouts, no methods.
- Njokuani's opponent: Wikipedia **Joel Álvarez**, API-Sports **Geoff
  Neal** (the original booking -- same late-replacement pattern as I2d).
- API-Sports listed **Blanchfield vs. Jasudavicius** on this card;
  that bout is actually on UFC Fight Night: Buckley vs. Malott (Oct
  2026) -- a misdated row.
- `Eric McConico` (API-Sports, id 2770) vs `Eric McConico Jr.`
  (Wikipedia) -- same person, and `Kauê Fernandes` vs `KauÃª Fernandes`
  (an API-Sports latin1/utf8 mojibake).

**Wikipedia's "UFC 330" was made authoritative** (user-confirmed). Done
as a direct repair, not routed through `data_conflicts` -- Wikipedia,
one of the app's two trusted sources, settled it, same call as I2d.

- Merged `KauÃª Fernandes` (kept id 2632 + height/reach/stance) into
  `Kauê Fernandes`; deleted the orphan `Eric McConico Jr.`
- Resolved the one open `disputed_opponent` on the Donte Johnson bout
  (a `McConico`/`McConico Jr.` name-variant artifact) by applying the
  candidate's data to the kept row.
- **Settled all 12 UFC 330 bouts** from their Wikipedia winner/method/
  round -- a deliberate one-off (`settled_from='wikipedia_only_24h'`),
  bypassing the 24h single-source wait because API-Sports' free tier
  can *never* report a 2026 event, so waiting buys nothing.
- Deleted "UFC 330: Makhachev vs. Machado Garry" -- its 18
  `fighter_elo_history` rows, 11 fights, then the event row (0 picks /
  odds / rumours referenced it).
- Renamed "UFC 330" -> "UFC 330: Makhachev vs. Machado Garry"
  (`external_id` stays "UFC 330"); deleted the 2 now-orphan fighters.
- **Elo recomputed: 44 -> 57 fights, 106 snapshots.**

Verified live: one UFC 330 event, 12 fights all settled with winner +
method, 0 dangling FK refs, the McConico/Kauê variants gone. The 5
remaining open conflicts are unrelated (4 from a concurrent API-Sports
sync on Hooker vs. Parnasse, 1 pre-existing).

**Status:** I4 + I4b done. I5 (derive W/L/D, tale-of-the-tape UI) not
started. All open conflicts are now non-I4.

## Phase 59 — I5: derived fighter records + tale-of-the-tape (2026-09-05)

**The payoff of Phase I, with one correction to the phase's own premise.**
`ROADMAP.md` justified I5 as lifting the intern off 1-2/5 confidence.
The code says otherwise: `InternFighter` is `{id, name, eloRating,
ratedFightCount}` and `decideInternPick.ts` tempers confidence by
`minRatedFightCount` — **the intern has never read a W/L record.** That
cap was already lifting on its own from I1-I4b, which took rated fights
from 57 into the hundreds. I5's payoff is for the human reading the
page, and it is still worth having (`docs/PRD.md` should-have,
"Tale-of-the-tape differentials on the fight page") — but it is not the
intern fix the roadmap described.

**No migration.** `fighters.wins/losses/draws` have existed since
`0001_init_schema.sql`, were already selected in
`features/fighters/api.ts` and already in the `Fighter` type — and were
always `0`, displayed nowhere, while the fighter page computed a
*different* number on read. That was the real defect underneath I5.

**Changed — the counting layer (correctness-critical, test-first):**

- `lib/elo/isNoContestOrAmbiguous.ts` (+ test) — extracted verbatim from
  `computeEloHistory.ts` once records became its second caller. A
  fighter's rating and their record are two readings of one graph; two
  copies of this regex would eventually disagree about the same row,
  silently, and a fight Elo discarded as an NC would surface as a draw
  on the record.
- `lib/records/deriveFighterRecords.ts` (+ 11 tests, written and
  observed failing first) — pure W-L-D counting. Every exclusion rule is
  shared with Elo, not re-decided: an NC counts as nothing, a null
  winner with a null method is ambiguous and skipped rather than guessed
  (the I1b lesson), a `winner_id` matching neither of the bout's own
  fighters is dropped, and a self-fight (an `upsertFighter` name-fold
  artifact) is guarded. A fighter with no countable outcome is **absent**
  from the map rather than present at 0-0-0.
- `lib/records/recomputeFighterRecords.ts` — the I/O half, shaped like
  `recomputeEloRatings.ts`. Full recount every run, never an incremental
  patch. **Writes are column-scoped by hard requirement, not style:**
  `fighters` rows are concurrently written by the enrichment job and both
  sync runs, so a whole-row upsert built from this function's own read
  would silently undo their height/reach/stance/external_id. Only
  changed fighters are written, grouped by identical W-L-D so the roster
  goes out in a handful of requests.
- `runSettlementJobsOnce.ts` gains a fourth tracked step,
  `recompute_records`, after the Elo rebuild — a new result changes a
  record at exactly the moment it changes a rating. Runs last: nothing
  downstream needs its output, so a failure costs the chain nothing.

**Changed — a latent bug found while building it:**

- `lib/supabase/selectAllPages.ts` — PostgREST can cap a response
  (`db-max-rows`) and returns a **short list with no error**, so a
  whole-table `.select()` truncates invisibly.
  **`recomputeEloRatings.ts` was carrying exactly this exposure** on both
  its `fights` and `events` scans, and `fights` passed ~950 rows during
  the I4 backfill — within one event of rebuilding every rating from a
  partial graph while looking completely normal. Both it and the new
  record job now page. Orders by primary key (PostgREST guarantees no
  stable order otherwise, so unordered ranges can overlap or skip) and
  advances by rows *returned*, never by the size *requested*.

**Changed — the display (judgment/presentation, no tests):**

- `features/fights/components/TaleOfTheTape.tsx` — record, height, reach,
  stance, and Elo (`1523 · 8 rated`, the same pairing the intern's own
  reasoning line quotes). The accent marks which side holds the edge and
  carries the `+5 cm` differential. A row where **both** sides are
  unknown is dropped rather than rendered "Unknown vs Unknown" — the
  common case on an upcoming card full of Wikipedia-only placeholders.
- `shared/utils/formatRecord.ts` (+ test) — in `shared/` because both
  features need it. Encodes one real rule: **a 0-0-0 total is not a
  record**, it reads "No tracked fights," since rendering it literally
  would say "fought and never won" about someone the app simply has no
  completed fights for.
- The fighter page now reads the stored columns instead of counting
  inline — the inline count silently re-decided all three exclusion
  rules. Both surfaces carry a caveat that the record covers only
  tracked fights (2022 onward, thinner before 2025), never a career
  total.
- `lib/elo/fetchLatestEloRatings.ts` — moved out of
  `lib/intern/generateInternPicks.ts`, unchanged, now that the fight page
  is a second caller.

**Changed — the intern's reasoning is now visible (user request):**

- `BoutRow.tsx` shows the intern's reasoning sentence under its
  confidence line. The data was always there — `picks.reasoning` is
  written on every intern pick — but `InternPickSummary` had
  deliberately dropped it as "too much for a collapsed row." Reversed:
  a confidence of 1/5 with nothing to explain it is a number taken on
  faith, and auditing the intern against your own read is the entire
  point of the scoreboard.

**Status:** `npm run lint`, `npm run test` (386 passing, up from 365),
and `npm run build` all green.

**Sequencing note, stated plainly:** the fighter page previously derived
its record on read, so it showed a real number. It now reads the stored
columns, which are `0` for everyone until `recompute_records` has
actually run — so between deploy and the first run, every fighter reads
"No tracked fights." Run `npm run settlement:run-jobs` right after merge
to close that window; no new script was needed, since that existing
command is the same chain the scheduled job runs and now carries the
record step as its fourth stage.

## Phase 59 addendum — reviewer findings and fixes (2026-09-05)

A `reviewer` pass on Phase 59 before opening its PR found one severe gap
and several smaller real ones. All fixed in the same branch, before merge.

**HIGH, fixed — `computeEloHistory.ts` had no self-fight guard, and I5's
own claim that it shares every exclusion rule with `deriveFighterRecords`
was false because of it.** A self-fight (`fighter1_id === fighter2_id`,
an `upsertFighter` name-fold artifact — nothing in the schema forbids it,
`0031`'s CHECK constrains only `winner_id`) left `computeEloHistory`
computing two *different* ratings for one fighter/fight pair and pushing
both into `snapshots`. `fighter_elo_history`'s own
`unique(fighter_id, fight_id)` then rejects the second insert — **after**
`recomputeEloRatings` has already deleted the whole table, so one bad row
would wipe every rating in production. `deriveFighterRecords.ts` already
guarded this case; `computeEloHistory.ts` now does too, test-first
(failing test added and observed failing before the one-line fix).

**MEDIUM, fixed — `selectAllPages.ts`'s first cut used offset
(`.range()`) pagination, which does not actually deliver the guarantee
its own docstring claimed.** An offset is positional: a concurrent
insert or delete (the enrichment job and both daily syncs write to these
same tables while a scan is in flight) shifts every later page, silently
skipping or double-reading a row — with `count: "exact"` still landing
on a number that looks correct. Rewritten to keyset pagination
(`id > <last id read>`, ordered by `id`, no count query needed —
termination is a short page). Given its own test file for the first
time: 6 cases, including one that simulates a row being deleted between
two page fetches and asserts nothing after the cursor is skipped — the
exact failure mode the rewrite exists to close.

**MEDIUM, fixed — the tale-of-the-tape's own doc/behaviour mismatch.**
Its comment claimed a row with both sides unknown is dropped, but
Record and Elo always produce a string ("No tracked fights", "Unrated")
so the drop-filter (`left !== null`) never fired for them — two total
UFC debutants on the same card would have rendered "No tracked fights
vs No tracked fights." Added an explicit `leftInformative`/
`rightInformative` per row, decoupled from the display string, so the
row-visibility check and the rendered text can disagree on purpose. One
side alone being uninformative is still shown (a real debutant next to
a real 12-3 is a genuine contrast); both together is now actually
dropped, matching what the comment always claimed.

**MEDIUM, fixed — the Elo row on a settled fight's page showed today's
rating framed as if it described that fight.** For an upcoming fight,
"current rating" is exactly right — it's the same number the intern's
reasoning already uses. For a fight from 2023, presenting 2026's rating
next to it (with a `+37`-style advantage marker) asserts an edge that
may have run the other way at the time. Relabeled the row "Elo
(current)" and extended the footnote to say plainly that Elo reflects
today, not the fight's date. A true "rating as of this fight" view is
possible later — `fighter_elo_history` keeps full history for exactly
this reason (`0029`'s own comment) — but is a separate piece of work,
not folded into this fix.

**LOW, fixed — the record recompute's own summary numbers.**
`fightersUpdated` counted ids *sent* to `.update()`, not rows actually
matched; a fighter deleted between the read and the write would have
been over-reported as updated. Now reads the real count off
`.update(...).select("id")`. The console log line was also renamed
from "fights counted" to "fights read," since it sits directly beside
Elo's post-filter "fights processed" and the two numbers measuring
different populations was reading like a bug.

**Flagged, not fixed — pre-existing and out of this phase's scope:**
`upsertFighter.ts`'s diacritic fold-match and `features/fighters/api.ts`'s
`getFighters` both still do a bare unpaged `.select()` over `fighters`.
Neither was touched by I5, and fixing the fold-match in particular
touches sync correctness broadly enough to deserve its own review pass
rather than riding in on this one. `selectAllPages.ts`'s own docstring
now names itself as the fix for both, for whenever that pass happens.

**Status:** all fixes re-verified — `npm run lint`, `npm run test` (393
passing, up from 386), `npm run build` all green.

## Phase 60 — scoreboard 500 hotfix + a note on the conflict flood (2026-09-05)

**The `/scoreboard` page was returning a hard 500 in production.** Not
an I5 regression — the scoreboard's code was untouched — but the I3/I4
backfill, settled by the scheduled runs over the past day, took
`fights.settled_at is not null` from ~50 rows to 832, and
`getScoreboardData` had an `.in("fight_id", [...every settled fight])`
on `odds_snapshots`. At 832 UUIDs that query string is ~30KB and the
PostgREST edge rejects it (URI too long), throwing straight through to
a 500 on the whole page.

Fixed by switching the three whole-table reads (`fights`, `picks`,
`odds_snapshots`) to `selectAllPages` (the keyset-paged helper added in
Phase 59) and filtering `settled_at is not null` in JS — the same
"read broadly, decide in code" split the Elo eligibility check already
uses. `odds_snapshots` is one immutable row per ever-priced fight (~15),
so it's read whole and matched in memory rather than with an `.in()` at
all. `buildPickHistory`'s own `.in("id", [...every settled fighter])`
was the same bug one `mePicks.length === 0` early-return away from being
live — it now scopes to just the fights the owner actually picked.

Verified against production data: the page now assembles cleanly and
renders its "no settled picks yet" empty state (there are 0 settled
*user* picks, and none of the 832 settled fights was priced at
settlement time — the backfilled history predates odds collection, so
the chalk line has nothing yet either. Both correct.)

**The `/conflicts` count jumped to 42** — 5 pre-existing
`disputed_opponent` rows plus **37 new `low_confidence_odds_match`**,
all dated 2026-09-05, all for tonight's card, all at ~8% confidence.
This is the odds matcher (`matchAndSnapshot.ts`, Phase B3) failing to
place tonight's incoming odds against DB fights and queuing each miss
for review. The ~3x-larger fighter table from the I2/I3/I4 enrichment
is the likely cause — more rows to disambiguate against drags every
candidate score down. Not corrupting anything, but the matcher's
confidence threshold or candidate selection wants re-tuning against the
bigger roster. Left as a flagged follow-up, not fixed here.

## Phase 61 — the intern's bets are now visible (2026-09-05)

Two gaps the user hit while looking at the card and the scoreboard.

**The card view showed the intern's pick but never whether it bet.** A
pick ("who wins", free) and a bet (edge-gated, real units, declined on
most picks — UC-2) are two different calls, and the row only surfaced
the first. `InternPickSummary` and `getInternPicksForFights` now carry
`betFighterId`/`stakeUnits`; `BoutRow` renders a red `BET 1.6u` badge on
the backed fighter and an accent border on the intern block, so a card
scans for "where did the intern put money" without reading every
reasoning line. All 7 of the intern's current bets are on tonight's
Hooker vs. Parnasse card.

**The scoreboard was hidden entirely.** `app/scoreboard/page.tsx` gated
the whole page on `data.accuracy.me.total === 0` — so with zero settled
*owner* picks, the intern's computed units and accuracy lines never
rendered. The gate is now "neither side has a settled pick"; the intern
picks far more fights than the owner will and settles first, so its
line should show the moment it has one.

**Added a "riding on upcoming fights" summary above the boards.** Before
the first card of a window settles there is nothing on the boards, but
the intern already has a full slate committed — `summarizePendingPicks`
(pure, test-first, 6 cases) counts open picks/bets/units-at-risk per
side, and `PendingSummary` shows it. Right now: intern 91 picks / 7 bets
/ 6.7u at risk, owner 10 picks / 0 bets.

**Flipped the intern's accuracy headline** from head-to-head (fights the
owner also picked) to full-card. With ~10 owner picks the head-to-head
number stays too thin to headline for months; it moves to the secondary
line as context. The PRD still calls head-to-head the like-for-like
comparison — it is, it's just not the number worth showing biggest this
early. User-confirmed.

**Fixed a latent units bug found on the way.** `toBetResult` cast
`stake_units`/`pnl_units` `as number`, but they are `numeric` columns
and PostgREST serialises those as strings — `netUnits += "1.56"`
concatenates. Dormant only because nothing has settled; now coerced with
`Number()`, matching what the calibration path already did.

**Status:** `npm run lint` / `npm run test` (399, +6) / `npm run build`
all green. Scoreboard data verified against production.

## Phase 62 — intern method prediction + the "Intern's read" card panel (2026-09-05)

Both came out of a user question about *why* the intern bets underdogs
so often (answer: `edge = prob × odds − 1`, and a small probability
disagreement times a 3–4x underdog price clears the +5% bar that the
same disagreement times a 1.3x favourite price never would — plus
rumour flags only push probability *down*, so a flagged favourite
inflates its opponent's edge).

**The intern now predicts method of victory** —
`predictInternMethod.ts` (pure, test-first): UFC base rates (~48%
decision / 33% KO-TKO / 17% submission), shifted toward a finish by how
lopsided the matchup is (`|estimatedProbability − 0.5|` — a mismatch
ends early) and toward KO by a weight-class keyword bucket (heavier →
KO, lighter → decision/sub). argmax of the three. **There is no
finish-rate data in this app**, so this is base rates plus the two
signals it has — a stated assumption, gradeable once method scoring
exists (still a PRD Could-have, not built here). Wired into
`generateInternPicks` as a third judgment beside the pick and bet;
`predicted_method` joins the `isUnchanged` check.

**`predicted_method` is now a 3-value enum** (`DECISION` / `KO_TKO` /
`SUBMISSION`) — `0035` adds the CHECK constraint (all 102 existing rows
are null, nothing to migrate), `lib/scoring/fightMethod.ts` owns the
type + labels, and the human pick form's free-text method `<input>`
became a 3-chip control matching the "Back"/confidence chips already in
`BetRow`. `upsertPick` re-checks the value server-side.

**New "Intern's read" panel on `/events/[id]`** (owner-only, collapsed
by default) — every fight the intern has an opinion on in one table:
pick, method, bet + stake, de-vigged market %, the intern's %, and the
edge, with the bet rows accent-marked. `buildInternCardReadRows` is
pure and tested — the column values describe the *bet* fighter when
there's a bet (the intern often bets the opposite fighter from its
pick), not the picked one, which is the `probabilityForFighter` hazard
worth a test.

**`devigTwoWay.ts`** — extracted from `decideInternPick`'s inline anchor
math into `lib/scoring/` so the panel and the intern quote the same
market number, the same way `edge` / `impliedProbability` are each their
own file.

**Status:** `npm run lint` / `npm run test` (418, +19) / `npm run build`
all green. `0035` committed but **not yet applied** — must go on after
merge (the current free-text form could otherwise write a violating
value in between).

## Phase 62 addendum — reviewer caught a dead branch in the method heuristic (2026-09-05)

A `reviewer` pass brute-forced `predictInternMethod` over the whole
input space and found two bugs with one root cause: **`SUBMISSION` was
mathematically unreachable** (it started 0.16 below `KO_TKO` and every
adjustment widened the gap), and **every heavyweight fight predicted
`KO_TKO` regardless of matchup** (the weight tilt was a larger swing
than the base decision→KO gap, so KO won even at 50/50). The docstring
described behaviour the constants couldn't produce, and the tests missed
it because the lopsided case only asserted `.not.toBe("DECISION")`.

Restructured: **lopsidedness is now the master dial** (finish vs
decision), and **weight class only splits the finish pool between KO and
submission** (`KO_SHARE` per bucket — heavy 0.85, mid 0.62, light 0.40).
So a close fight at any weight is a decision, a lopsided heavyweight is a
KO, a lopsided flyweight is a submission, and a competitive heavyweight
can still be a decision. A brute-force reachability test over the input
grid now guards against any future tuning re-creating a dead branch.

Also from the review: the panel's edge accent no longer fires on a
fight the intern hasn't actually bet (a pick made while unpriced could
show a >5% edge against fresh odds before the next cron places the bet,
which read as a bug); and `fetchExistingPickFields` now drops a
non-enum `predicted_method` rather than carrying it into a save that
`upsertPick`'s guard would then reject.

## Phase 63 — a "Your card" read panel next to the intern's (2026-09-06)

The card page's owner-only "Intern's read" panel (Phase 62) now has a
twin: **"Your card"**, the same collapsed table for the owner's own
picks and bets — pick, confidence, called method, bet + stake, and the
owner's entered probability vs the de-vigged market with the resulting
edge. Both panels render above the fight list; the owner reads their
whole card against the machine's at a glance.

One builder, one component. `MyPick` and `InternPickSummary` are the
same shape by `0019_picks.sql`, so `internCardRead.ts` →
`cardRead.ts` (`buildCardReadRows`) and `InternCardRead.tsx` →
`CardRead.tsx` with a `perspective="you"|"intern"` prop that changes
only the words. Added a **Conf** column to both — the owner sets
confidence deliberately and it was invisible on the card view until now.

**Numeric-as-string fix (db-read-safety, inline).**
`picks.estimated_probability` and `stake_units` are `numeric` columns;
PostgREST serialises `numeric` as a JSON **string**. `getMyPicksForFights`,
`getInternPicksForFights`, and `fetchExistingPickFields` all did
`row.x as number` — an assertion, not a conversion. The intern panel
rendered correctly only because JS coerces strings inside `*` and `-`.
Now converted with `Number(...)` at each read boundary. A `reviewer`
pass confirmed the write-back path (`mergePickFields` → `upsertPick`) is
unaffected and found no other consumer that depended on the string.

**Status:** `npm run lint` / `npm run test` (421) / `npm run build` all
green. Reviewer pass: clean, Low/nits only (both applied — `you`
footnote now explains the edge accent, redundant `Number()` dropped).

**Known, separate, not in this change:** the `reviewer` also confirmed
the scoreboard's *pick-history* path (`buildPickHistory` →
`aggregateUnitsLine`) has the same `numeric`-as-string bug and is not
yet fixed — dormant only because nothing has settled. It goes live the
moment the first real bet settles. Tracked for its own change.

## Phase 64 — scoreboard pick-history P&L: numeric-as-string, before it settles (2026-09-06)

A `reviewer` pass on Phase 63 confirmed the scoreboard's **pick-history**
path still had the `numeric`-as-string bug that Phase 60 fixed for the
boards themselves. `buildPickHistory` returned `stake_units` / `pnl_units`
straight from PostgREST — strings. `PickHistoryTable` then re-aggregates
them client-side: `netUnits += "0.75"` concatenates (`"00.75-1.00"`), the
win/loss/void split misreads, and `formatUnits(netUnits)` calls
`.toFixed` on a string — a hard crash of the table.

Dormant only because nothing had settled. Last window's card settles
tonight, so this went in first.

- `buildPickHistory` now converts both columns at the read boundary,
  same as `toBetResult` / `toCalibrationEntry` 150 lines up in the same
  file. Exported, with `buildPickHistory.test.ts` — a fake client feeds
  it the stringified rows PostgREST really sends and asserts the output
  is numeric and sums correctly (test written failing first).
- `PickHistoryTable`'s `as number` casts replaced with a real narrowing
  filter — after the fix the values genuinely are numbers.
- `settlePicks.ts` converts `stake_units` before `scoreBetPnl` too. No
  behaviour change there (the arithmetic already coerced correctly), but
  the value now matches the `number` it's typed as.

**Status:** `npm run lint` / `npm run test` (423, +3) / `npm run build`
all green. With Phase 63 (the `features/picks/` read sites) this closes
every known `numeric`-as-string read of `picks` in the app.

## Phase 65 (J1–J3b) — Sherdog as the fighter identity spine (2026-09-07)

A user question about paying for a Tapology feed turned into a data-source
comparison (`ROADMAP.md` Phase J, `PROJECT_FACTS.md` "Data sources"). The
paid option breaks the hard $0 constraint and is an unofficial scrape
reseller anyway; API-Sports Pro still serves no record field and is still
name-keyed. Sherdog — no API key, `robots.txt` `Allow: /`, full career
history back to a fighter's debut — was verified with a live spike and
chosen as a third source.

**Why it matters.** Every duplicate-fighter conflict this app has hit
(the 10 clusters in I2c, the André/Andre split) exists because identity
was a *name string*. Sherdog gives every fighter a stable integer id.

Shipped in this PR (J1–J3b of Phase J; J4–J6 to follow):

- **`0036`**: `fighters.sherdog_id integer unique` + `sherdog_checked_at`
  queue marker. **`0037`**: 5th `data_conflicts` kind
  `low_confidence_sherdog_match`. Both applied to `vrwlfcywyfzfczajpdoh`.
- **`lib/sherdog/`**: the one fetch wrapper (integer-id validation, 1.5s
  throttle, retry-once on 5xx), the page-name guard (a wrong id returns
  HTTP 200 for a *different* real fighter — verified), pure parsers for
  the fighter page / fight history / search results pinned against 6
  saved real fixtures, and the identity job.
- **Identity job** (`npm run sherdog:resolve-identity`, `--dry-run`):
  resolves `sherdog_id` for fighters on upcoming cards. Auto-matches only
  when one candidate clears 0.85 name similarity AND the fetched page's
  name passes the guard; two+ name-tied candidates run a fight-count
  tie-break (a 2-bout regional namesake is not on a UFC card) before
  falling back to the review queue.
- **`/conflicts`**: a card + owner-gated action to resolve a
  `low_confidence_sherdog_match` by picking the right Sherdog fighter,
  writing the integer id. `sherdog_id` unique constraint is the race net.
- Ran live across the 146-fighter upcoming-card roster: **128 got a
  verified `sherdog_id`**, 13 opened conflicts, 5 aren't on Sherdog.
  0 duplicates, 0 failures.

**Status:** `npm run lint` / `npm run test` (521) / `npm run build` all
green. `reviewer` pass on J1–J3b: one HIGH (exact homonyms would
auto-match to whichever Sherdog listed first) plus 6 lower — all fixed
(the homonym fix is the tie-break above). See `ROADMAP.md` Phase J for
the full findings list.

**Not in this PR:** J4 (import the fight history / events), J5 (Sherdog's
headline W-L-D becomes the record for a linked fighter, replacing the
graph-derived count), J6 (narrow API-Sports enrichment to reach/stance,
put the identity job on a schedule).

## Phase 66 (J4–J5) — Sherdog fight history + full-career records (2026-09-09)

Follows Phase 65. J4 imports a Sherdog-linked fighter's full career into
a read-only sidecar; J5 makes that career the fighter's record.

**J4 — the sidecar (PR #57).**

- `0038`: `fighter_sherdog_bouts` (opponent + event by Sherdog id + name
  text, no foreign keys; public-read like the rest of the catalog) + 6
  `sherdog_*_by_*` finish-breakdown columns + `sherdog_history_imported_at`
  on `fighters`. **Deliberately not merged into `fights`/`events`/Elo**
  (fork decided with the user) — a fighter's ~30-55 bouts against regional
  opponents don't belong in the app's own graph, and the record comes from
  Sherdog's headline anyway.
- `lib/sherdog/`: `parseSherdogDate` (real leap-year check),
  `buildSherdogBoutRows` (refuses a page that doesn't reconcile against
  its own headline record), `importSherdogHistoryJob` (upsert +
  delete-stale-tail, `--dry-run` / `--refresh` / `--sherdog-id`).
- `parseFighterPage` fix: the headline record class suffix is `draws`
  (later `draws?` for both) not `draw` — the dry-run caught this, 20
  fighters with a real draw were being skipped.
- `/fighters/[id]`: a "Full Career (Sherdog)" section with the finish
  split.
- Ran live: **2,545 bouts across 128 fighters**, 0 skipped, 0 failed.

**J5 — the record switch (this PR).**

- For a Sherdog-linked fighter with imported bouts, `fighters.wins/
  losses/draws` now come from counting `fighter_sherdog_bouts`, not the
  app's 2022-onward fight graph. `deriveSherdogRecords` +
  `applySherdogRecordOverride`, pure and test-first. A linked fighter
  whose Sherdog page is still an empty stub keeps the graph count.
- **Elo is untouched** — it runs earlier in the settlement chain, on the
  graph; Sherdog bouts never feed it.
- `recomputeFighterRecords` reads the bouts + the linked flag and applies
  the override before its existing column-scoped, change-only write.
  `npm run records:recompute` added as a standalone runner.
- Ran live: 128 fighters switched to full-career records — Alexandre
  Pantoja 1-1 → 30-6, Deiveson Figueiredo 1-3 → 25-7-1, Marlon Vera
  0-2 → 23-12-1.

**Known interim state:** until J6 puts `sherdog:import-history` on a
schedule, a linked fighter's record does not move when they fight again
until someone runs `sherdog:import-history --refresh` + `records:recompute`.

**Status:** `npm run lint` / `npm run test` (559) / `npm run build` all
green. `reviewer` pass on each — J4: one MEDIUM (`--refresh` write path
could zero a fighter's bouts on a mid-write failure, fixed with upsert +
marker-clear); J5: no HIGH/MEDIUM, one LOW fixed (stub-page fighter
keeps the graph count). Full findings in `ROADMAP.md` Phase J.

**Not in this PR:** J6 (narrow API-Sports enrichment to reach/stance,
schedule the jobs), J7 (Sherdog as a third settlement source — the phase
that would speed up settlement / the scoreboard / `disputed_result`).

## Phase 67 (J6) — Sherdog height/weight + the daily schedule (2026-09-09)

Closes out Phase J's automation.

- **`importSherdogHistoryJob` also fills `fighters.height_cm` /
  `weight_kg`** from Sherdog's bio, where they're null — `bioFillPayload`
  (pure, tested) never overwrites a value API-Sports already set.
  Sherdog has no reach and no stance, so API-Sports enrichment is
  unchanged.
- **`enrichFighters.ts` was NOT narrowed** — a Sherdog-linked fighter
  still needs an API-Sports `external_id` for the results sync to match
  their fights, and that same lookup returns reach + stance, so there
  was nothing to remove.
- **`.github/workflows/sherdog.yml`, daily at 03:00 UTC** — between
  `sync.yml`'s 00:00 run and `fighter-enrichment.yml`'s 06:00. Four
  sequential steps: resolve-identity → import-history (new) →
  import-history `--refresh --batch=30` (cycles the ~128-fighter linked
  roster every ~4-5 days so a fighter who just fought gets fresh bouts)
  → records:recompute. Sherdog is unmetered, so no quota scheduling
  around it.
- `PROJECT_FACTS.md` gains a "Sherdog integration — where it stands"
  section (sidecar not merged into the graph; record source rules; field
  ownership; the ~4-5 day record lag; J7 is the settlement piece).

**Interim note carried from Phase 66 is now bounded:** a linked
fighter's record lags a fresh fight by at most the `--refresh` cycle
(~4-5 days), not "until someone runs it manually."

**Status:** `npm run lint` / `npm run test` (563) / `npm run build` all
green. `bioFillPayload` test-first (4 cases).

**Phase J is J1–J6 complete.** J7 (Sherdog as a third source in
`settleFights` / `evaluateFightSettlement`, so `disputed_result`
resolves on a 2-of-3 majority and a fight settles when Sherdog has the
result and Wikipedia/API-Sports lag) is scoped in `ROADMAP.md` and not
built.

## Phase 68 (K1) — Duplicate same-date events consolidate themselves (2026-09-10)

The root-cause fix for a bug found live three times: one real card ends
up as two `events` rows because `upsertEvent.ts` only dedups on
(`event_date`, punctuation-folded name). I4b was "UFC 330" vs "UFC 330:
Makhachev vs. Machado Garry"; the 2026-09-09 data-fix was "UFC Fight
Night: Paris" vs "... Hooker vs. Parnasse"; 2026-09-12 is Wikipedia
**renaming** the article from "Rodríguez vs. Silva" to "Silva vs.
Delgado" after the main event changed. Each was cleaned by hand and
recurred on the next sync, because nothing recorded that the two rows
are the same event.

- **`0039_event_merged_into.sql`** — `events.merged_into uuid references
  events(id) on delete set null`, plus a partial index on the common
  "not merged" lookup.
- **`planEventMerges.ts`** (pure, **test-first**, 15 cases) — given
  same-date events + their fights, decides which rows are one card
  (share ≥1 exact fighter pairing — the app tracks one UFC card per
  day), which survives (most `bout_order`-set fights → most fights →
  smallest id, the same "Wikipedia curation wins" call as I4b), and
  which fights get removed. **Skips the whole cluster and reports it,
  never guesses,** when a loser event has more fights than the keeper,
  or any loser fight is settled or FK-referenced by a
  pick/odds/conflict/rumour row.
- **`mergeDuplicateSameDateEvents.ts`** — applies the plan (clear loser
  fights + their `fighter_elo_history`, point `merged_into` at the
  survivor, rebuild Elo once if a rated fight was removed). Runs at the
  tail of every `syncSchedule.ts` run; also `npm run
  events:merge-duplicates`. Idempotent.
- **`upsertEvent.ts`** follows `merged_into` (a source still reporting
  the old external_id resolves to the survivor) and skips merged rows
  when name-matching candidates.
- **`merged_into is null`** filter added to every date-range events
  query: `getUpcomingEvents` / `getPastEvents`, the intern queue, the
  rumour-scan target, odds start-time discovery, and the Wikipedia
  history backfill's gap detection.

**The 2026-09-12 duplicate did not auto-merge** — the stale event's 9
fights had all accreted INTERN picks + rumour flags (the intern/rumour
jobs had been running against it), so K1 correctly skipped it. Cleaned
by `supabase/data-fixes/2026-09-12_merge-rodriguez-silva-duplicate-event.sql`;
the new `merged_into` filters stop future duplicates from accreting
those rows in the first place.

**`reviewer` pass — fixes applied:**

- **HIGH** — the orchestrator read `fights` and `events` with a bare
  `.select()`. PostgREST truncates a large response silently; a
  truncated `fights` read would drop ~half of every event's bouts
  (random-UUID ids) and could delete the visible half of a loser event
  while orphaning the rest. Now `selectAllPages` for both, and for the
  four blocking-ref table reads (`odds_snapshots` especially — one
  immutable row per fight per poll).
- **MED** — no transaction wraps the per-plan writes. Reordered so
  `merged_into` is set *first*: a failure in a later step now leaves the
  loser hidden and out of the next run's clustering (worst case: a
  hidden event with unreferenced orphan fights), not a visible empty
  card or a re-merge loop.
- **LOW** — `winner_id != null` added to the "already has a result"
  skip guard; `getCardView` 404s a merged event instead of rendering an
  empty card; a pair-order-independence test (the core cross-source
  case) added.

**Deliberately not done:** a fake-Supabase test for the I/O orchestrator
(`sweepLatentDisputedOpponents.ts`, which also deletes fights, has none
either — the decision logic is fully covered in `planEventMerges`, and
the orchestrator was verified end-to-end against the live DB). Skipped
clusters surface only in the sync log for now (`merged_into` filters
make a skip rare) — a `job_runs`/conflict-queue signal is a K-follow-up.

**Status:** `npm run lint` / `npm run test` (578, +15) / `npm run build`
all green (`0039` applied to the live DB; the 2026-09-12 data-fix run).

## Phase 69 (J7) — Sherdog as a third settlement source (2026-09-10)

Closes Phase J. Sherdog now feeds `settleFights` alongside Wikipedia and
API-Sports — the piece J1–J6 deliberately left out (the sidecar was
read-only).

**The reframe that shaped the design:** checked live 2026-09-10, every
one of ~860 settled fights carries a *single-source* `settled_from`
(`wikipedia_only_24h` 821, `api_sports_only_24h` 28, `wikipedia_draw_or_nc`
11). `both_agree` and `disputed_result` have fired **zero** times —
API-Sports free (2022+, 100/day) almost never reports the same bout
Wikipedia does. So Wikipedia is effectively the lone settlement source
and the 24h wait is pure delay. J7's real value is making Sherdog the
*second* source that actually shows up: **Wikipedia + Sherdog agree →
settle now, no 24h wait**, and a Sherdog disagreement turns a silent
wrong Wikipedia result into a reviewable `disputed_result`.

- **`0040_sherdog_settlement_source.sql`** — `fights.sherdog_winner_id` /
  `sherdog_method` / `sherdog_round` / `sherdog_reported_at` /
  `sherdog_bilateral`; `settled_from` widened with `majority_2_of_3` and
  `sherdog_only_12h`.
- **`matchSherdogFightResult.ts`** (pure, **test-first**, 14 cases) —
  fight + both fighters' `fighter_sherdog_bouts` → `matched` /
  `ambiguous` / `no_data`. Match key is `opponent_sherdog_id` (a real id,
  not a name) + an event-date window. `bilateral` = both fighters' pages
  listed the bout and agree. Conservative: rematch, page disagreement, or
  an unknown result → `ambiguous`, never a guess.
- **`evaluateFightSettlement.ts`** rewritten around a vote tally (19
  cases): 2+ agree → `both_agree`; 2 of 3 agree → `majority_2_of_3`;
  split with no majority → `conflict`; one source past timeout → solo
  settle (Wikipedia/API 24h, **Sherdog 12h and only when bilateral** — a
  one-sided scrape never settles a fight alone). Wikipedia stays the
  method/round authority; Sherdog fills it in where Wikipedia is silent
  (notably on `api_sports_only` settles, which had none).
- **`applySherdogResults.ts`** — reads the sidecar into the `fights`
  columns for near-term unsettled fights (`selectAllPages`; sets
  `sherdog_reported_at` once, refreshes winner/bilateral each run).
- **`reimportSherdogForPendingFights.ts`** — the sidecar refreshes on a
  ~4–5 day cycle, too slow to break a fresh dispute, so this re-fetches
  (capped 12/run) the Sherdog pages of fighters in fights that have
  *happened* but not settled and lack a bilateral answer.
- Both new steps run first in `runSettlementJobsOnce`, wrapped so a
  Sherdog outage records a `job_runs` failure but **does not block**
  settlement on Wikipedia + API-Sports.
- **`settleFights.ts`** — reads the new columns; closes an open
  `disputed_result` row when a majority now settles that fight.
- `npm run sherdog:verify-results` (read-only) ran live: **25/25 settled
  fights with both fighters Sherdog-linked matched, 25/25 agreed with the
  app's `winner_id`, 0 ambiguous** — the matching rule is sound.

**`reviewer` pass — fixes applied:**

- **MED** — a firm Sherdog opinion was never retracted when a later
  sidecar correction made the match `ambiguous`/`no_data`, so a stale
  `sherdog_bilateral` winner could later solo-settle
  (`sherdog_only_12h`). `applySherdogResults` now clears all `sherdog_*`
  columns on that regression.
- **MED** — `majority_2_of_3` didn't require the deciding Sherdog vote to
  be bilateral, so a one-sided scrape + API-Sports could outvote
  Wikipedia. A non-bilateral Sherdog vote is now dropped before the
  tie-break entirely (it still corroborates a unanimous agreement).
- **MED** — the `fights_sherdog_report_columns_together` CHECK would
  reject a legitimate bilateral Sherdog draw with a null method/round
  (common on old cards) and wedge the whole apply pass. Dropped the
  CHECK. (Also: the first apply of `0040` failed — a too-clever `DO`
  block matched the wrong `settled_from` constraint. The editor rolled
  it back cleanly; `0040` is now plain idempotent `if [not] exists`
  statements.)
- **LOW** — `applySherdogResults` now catches per-fight write errors
  (one bad row no longer starves the rest of the pass) and bounds its
  fight scope to a trailing 120-day window (bounds the `.in()` list).

**Not done:** UI provenance badge (backend only; `settled_from` carries
the record). No fake-Supabase test for the two I/O orchestrators
(`sweepLatentDisputedOpponents` precedent) — the correctness cores are
test-first and `sherdog:verify-results` checks the matcher against every
live settled fight (25/25, 0 disagreements, re-run after the fixes).

**Status:** `npm run lint` / `npm run test` (606, +28) / `npm run build`
all green. `0040` pending on `vrwlfcywyfzfczajpdoh`.

**Phase J is complete (J1–J7).**

## Phase 70 (K2) — cross-date duplicate events + two fighter-identity conflicts (2026-09-10)

- **K2: `planEventMerges` now clusters events within ±1 day**, not just
  the exact same date. Found live: "UFC Fight Night: Gamrot vs Salkilld"
  (API-Sports, 2026-08-09) and "... vs. Salkilld" (Wikipedia,
  2026-08-08) — one card, split across a timezone/broadcast date
  boundary, invisible to K1's exact-date grouping. The shared-exact-pair
  requirement is the safety (two real cards a day apart never carry the
  identical unordered fighter pair). `MAX_EVENT_DATE_SKEW_DAYS = 1`;
  +4 test cases.
- **`mergeDuplicateSameDateEvents` restructured to two passes** — K1's
  same-date pre-filter for the FK-ref check no longer works when any pair
  of events can cluster, so: pass 1 plans with all `hasBlockingRefs`
  false to find the at-risk fights, check FK refs on just those, pass 2
  plans for real. Keeps the whole `.in()` bounded to fights a merge would
  actually delete. **`mergeDuplicateSameDateEvents.test.ts` added**
  (fake-Supabase, 3 cases) — the first test for either K1/K2 orchestrator,
  locking the "pass-1 at-risk set ⊇ pass-2 deletions" invariant the
  `reviewer` flagged as subtle.
- Live: the Gamrot pair surfaced as a **reported skip** (its Aug-9 loser
  carried stale winners), then resolved by
  **`2026-09-10_merge-gamrot-salkilld-date-split.sql`** — user confirmed
  Louie Sutherland fought **José Montanha** (Wikipedia), not Henrique da
  Silva Lopes (API-Sports). The Aug-8 Wikipedia row (fully settled,
  `bout_order`) is the keeper; the 12 stale Aug-9 fights + **24
  double-counted `fighter_elo_history` rows** deleted, the last open
  `disputed_opponent` resolved. `recompute_elo` re-run — 904 fights /
  1800 snapshots (was double-counting this card).
- **`2026-09-10_merge-benardo-sopaj-duplicate-fighter.sql`** (run) —
  "Benardo Sopaj" was a stub duplicate of "Bernardo Sopaj" (a missing
  'r', which `upsertFighter`'s accent-only fold-match misses). Repointed
  the one UFC 332 fight, deleted the stub, resolved its
  `disputed_opponent`.
- **`data_conflicts` open count: `disputed_opponent` 2 → 0**,
  `low_confidence_odds_match` 37 → 0 (PR #61). Only the 13
  `low_confidence_sherdog_match` remain (owner picks).

**Status:** `npm run lint` / `npm run test` (612, +6) / `npm run build`
all green.

## Phase 71 (L1) — Intern picks scoped to the upcoming card only (2026-09-10)

**Why:** the scheduled intern job wrote a pick for every fight on every
future card (127 last run). A card weeks out has no odds (nothing prices
before ~T-12h), no rumour scan (that job was already nearest-card-only),
and an unsettled roster, so those picks were a flat 50% market anchor
nudged only by Elo — noise on every later card's view. User decided the
intern should form an opinion only once a card is actually next up.

**Changed:**

- **`src/lib/events/nearestUpcomingEvent.ts`** — new shared helper
  `fetchNearestUpcomingEventId`: the soonest `event_date >= today`,
  `merged_into is null` event, or `null`. One definition, +3 tests
  (fake-Supabase, same pattern as `mergeDuplicateSameDateEvents.test.ts`).
- **`generateInternPicks.ts`** — was "all upcoming events", now calls the
  helper for the single nearest card. Downstream unchanged; `fightIds` is
  ~13 instead of 127 (strictly safer for the `.in()` calls). Doc comment
  rewritten with the rationale.
- **`runRumourScanJob.ts`** — refactored `fetchNearestUpcomingEventFights`
  onto the same helper. No behaviour change — it already did exactly this
  query inline; this just removes the duplicate.
- **`runCleanupNonUpcomingInternPicks.ts`** + `npm run
  intern:cleanup-future-picks` — one-time cleanup, dry-run by default,
  `--commit` to delete, refuses to commit if any target pick carries a
  bet or is settled. Uses `selectAllPages` for the `fights`/`picks` scans.

**Ran live (with confirmation):** dry-run then `--commit` against
production — **58 INTERN picks deleted** across 8 non-nearest upcoming
cards (UFC 331 → Bonfim vs. Brady), 0 bets, 0 settled. Verified by
re-query: Silva vs. Delgado (09-12, next up) keeps its 14 intern picks,
every later card now reads `intern = 0`. The intern regenerates each
card's picks when it becomes next up.

**Not in scope:** the owner's own manual picks (unchanged, any card);
L2 (settlement gap); L3 (intern criteria).

**Status:** `npm run lint` / `npm run test` (615, +3) / `npm run build`
all green, route table unchanged.

## Phase 72 (L2 / L2b) — recently-finished cards get their Wikipedia results (2026-09-10)

**Why:** 22 fights on two August cards (Nurmagomedov vs. Song 08-29,
Hernandez vs. Rodrigues 08-22) plus 3 on Hooker vs. Parnasse (09-05) had
never settled. Root cause: `syncSchedule` only covers
`Category:Scheduled`, which drops a card ~when it finishes, and the I4
backfill is gap-only — so a card synced while upcoming never gets its
`wikipedia_*` per-source result columns and settles single-source on
API-Sports' ~3-day window at best.

**L2 — the fix:**

- **`src/lib/ufc-data-sync/selectEventsNeedingResultRefresh.ts`** (pure,
  +10 tests) — the queue: an event that is past + inside a 30-day
  window + not merged + has a Wikipedia-title external_id + still has a
  fight with no `wikipedia_reported_at`.
- **`refreshRecentEventResults.ts`** — re-runs `processScheduleEvent` for
  each such card (`upsertFight` matches the existing row and writes its
  per-source columns; never inserts a duplicate). Per-event try/catch.
- **`syncSchedule.ts`** calls it at the tail of every run, right before
  `sync.yml`'s settlement step.
- **`runRefreshRecentEventResults.ts`** + `npm run
  sync:refresh-recent-results` — standalone, dry-run by default.

**L2b — fighter dedup exposed by L2's first run:** re-fetching the two
August cards surfaced 8 `disputed_opponent` conflicts, each a genuine
API-Sports-enriched / Wikipedia-placeholder duplicate fighter pair
(missing space, name-order swap, diacritic, nickname).

- **`src/lib/text/namesLikelySamePerson.ts`** (+11 tests) — widens
  `upsertFighter`'s automatic fold-match to also catch missing internal
  spaces and name-order swaps (not nicknames — still a human call).
  `upsertFighter` now also prefers the `external_id` row when several
  names fold together.
- **`supabase/data-fixes/2026-09-10_merge-8-name-variant-duplicate-fighters.sql`**
  — repoints the 8 placeholders' fights + Elo onto the identity row,
  adopts the Wikipedia display name, drops the placeholders, resolves the
  8 conflicts. All six `fights` id columns repointed in one statement (a
  per-column sequence transiently violates `0031`'s winner-in-bout
  CHECK). Verified rollback-first, then applied.

**Ran live (with confirmation):** refresh → merge data-fix → refresh again
→ `settlement:run-jobs`. All 40 fights across the 3 cards now have
Wikipedia results, 0 open `disputed_opponent` conflicts, and every one
settles `wikipedia_only_24h` on the next sync (~24h after the result was
written). Records recompute changed 6 fighters (the merges).

**Status:** `npm run lint` / `npm run test` (635, +20) / `npm run build`
all green, route table unchanged.

**`reviewer` pass, fixes applied same-day:**

- `upsertFighter`'s fold-match tie-break wasn't fully deterministic when
  zero or 2+ folded rows carried an `external_id` (only the "exactly one"
  case was). Now sorts by `id` within each group before picking, so a
  repeat sync can't rewrite a different row's name each time.
- `refreshRecentEventResults`'s call in `syncSchedule.ts` is now wrapped
  in try/catch — a failure in its own reads must not skip the unrelated
  duplicate-event merge that runs after it.
- The data-fix's claim that renaming the KEEP row "prevents recurrence"
  was only true for 6 of the 8 pairs — corrected in the file: the two
  nickname pairs (Wes/Wesley, Stan/Stanley) can still recur, since
  `upsertFighter`'s external_id branch overwrites `name` unconditionally
  on every API-Sports write. That's the intended safe fallback (routes
  back to `/conflicts`), not a bug, but the comment overclaimed.
  `PROJECT_FACTS.md` updated with this and two informational notes (the
  name-order-swap rule's accepted latent risk; check `sherdog_id`
  specifically on any future fighter merge).
- Added the one missing test branch (`selectEventsNeedingResultRefresh`'s
  title dedup) and fixed a mislabeled test in `namesLikelySamePerson.test.ts`.
- Not changed: the name-order-swap heuristic itself (accepted risk, no
  observed collision, narrowing it is only worth doing if one occurs).

`npm run lint` / `npm run test` (637, +2) / `npm run build` re-verified
green after the fixes.

## Phase 73 (L3) — a size (reach/height) signal for the intern (2026-09-12)

**Why:** user direction — the intern's picks were Elo + rumours off a
mostly-unpriced market; reach/height are real, already-synced fighter
data the intern never read. Narrowed from an original four-signal ask
(age, reach, height, stance) after four forks: reach and height combine
into ONE signal (avoids double-counting a correlated advantage); stance
deferred (no app-measured directional effect exists yet -- folklore, not
data); age split into its own follow-up (needs a new column +
`fetchFighter.ts` change + a backfill for ~150 already-enriched
fighters -- real scope beyond a pure function); and a combined cap added
across every signal (previously unbounded when they agree).

**Changed:**

- **`src/lib/intern/sizeAdjustment.ts`** (pure, +8 tests, test-first) —
  reach gap when both fighters have it; falls back to height only when
  both have that instead; `0` for any other missing-data combination
  (never mixes one fighter's reach with the other's height). Capped at
  `MAX_SIZE_ADJUSTMENT = 0.06` (smaller than rumours' 0.12 and Elo's
  0.15 — the weakest-evidence signal here, first dial to turn), reached
  at a 15cm gap.
- **`decideInternPick.ts`** — adds the size delta into the existing sum,
  then clamps the WHOLE combined delta (`MAX_TOTAL_ADJUSTMENT = 0.25`)
  before it reaches the market anchor, so rumours + Elo + size all
  agreeing on one fight still can't overwhelm the market's own read.
  Reasoning string gains a size line. +9 tests, including an exact-value
  test that a fight where all three signals agree (unclamped sum 0.33)
  lands at exactly 0.75 (anchor 0.5 + the 0.25 cap), not 0.83.
- **`InternFighter`** gains `reachCm`/`heightCm`; `generateInternPicks.ts`'s
  existing embedded fighter select gains the two columns (no new query).

**Ran live:** the scheduled intern job re-ran against the real next card
(Silva vs. Delgado, 14 fights) — 10/14 had usable size data (correctly
small nudges, 0.8%–2.0%), 4/14 correctly showed "No usable size data."
No errors.

**Not in scope:** `predictInternMethod.ts` (method-of-victory, unchanged);
`describeStanceMatchup.ts` (stays scoreboard-only); age (own follow-up,
`ROADMAP.md` L3-age).

**Status:** `npm run lint` / `npm run test` (652, +15) / `npm run build`
all green, route table unchanged.

## Phase 74 (L4) — author-aware pick lock (2026-09-12)

Owner direction (2026-09-10): the intern should be able to react to a late
rumour (a Friday pick flipping after bad news breaks) but lock well ahead
of the card, while the owner's own picks stay open almost to the last
minute. Confirmed after a real conflict was found and resolved in
planning: the intern's first-requested T-12h lock would collide with
`odds_snapshots`' own write-once T-12h price window, meaning the intern's
final pick could never see a real price — **intern locks T-6h, owner
locks T-1h**, both before `events.starts_at`.

**Changed:**

- **`supabase/migrations/0041_author_aware_pick_lock.sql`** —
  `check_pick_constraints()`'s lock predicate keyed off `new.author`
  instead of one shared `now() >= starts_at` for everyone. Every other
  check in the trigger (fighter membership, disputed-opponent block,
  settlement-field guard, the 0027 settlement bypass) untouched.
- **`src/lib/picks/pickLockOffsets.ts`** (pure, +7 tests, test-first) —
  the TS mirror of the SQL trigger's two offsets (`INTERN_LOCK_OFFSET_HOURS
  = 6`, `USER_LOCK_OFFSET_HOURS = 1`) and `isPickLocked(startsAt, author,
  now)`. A trigger can't import a TS module, so the two files carry the
  numbers by hand — comments in both point at the other.
- **`supabase/tests/rls.sql`** — checks 26/27: a card 3h from start
  rejects an INTERN insert (inside its 6h window) but accepts a USER
  insert at the same instant (outside its 1h window) — the one pair of
  checks that actually proves the two authors get different thresholds,
  not just "still enforced" (checks 17–25 predate this and never tested
  that).
- **`events/[id]/page.tsx`** — the owner-facing `locked` boolean (gates
  `QuickPick`/`BetRow`) switched from raw `starts_at` to
  `isPickLocked(..., "USER", ...)`, so the UI can't offer a pick the DB
  would then reject.
- **`InternLockStatus.tsx`** (new) — owner-only caption on the event page:
  "Intern picks lock in Xh." / "Intern picks: locked." Confirmed with the
  user rather than assumed, since otherwise there was no on-page way to
  tell whether the intern could still react to a late rumour on the card
  being viewed.
- **`QuickPick.tsx`** — locked copy corrected from "the card has started"
  to "locks 1 hour before the card starts" (no longer the same instant).

**Reviewer pass:** caught one real bug same-day — `InternLockStatus`'s
"Xh until lock" caption computed hours until *card start*, not until the
intern's actual T-6h lock instant, overstating the remaining window by
exactly 6 hours every time (`locked` itself was correct; only the
not-yet-locked caption text was wrong). Fixed: `formatTimeUntil` now takes
the real lock instant (`startsAt - INTERN_LOCK_OFFSET_HOURS`), not raw
`startsAt`. Re-verified clean (lint/build) after the fix. No other
findings — the SQL diff against 0027, the SQL/TS boundary agreement, and
every other reader of `events.starts_at` in `src/` were all checked and
came back clean.

**Ran live:** migration pushed to the linked project
(`vrwlfcywyfzfczajpdoh`); full `supabase/tests/rls.sql` suite (27 checks)
run via a scratch copy with real user ids substituted (never committed) —
"All RLS checks passed." Real scheduled intern job re-run against the
actual next card (Silva vs. Delgado, ~16h out at the time): 14/14
unchanged, 0 failed, 0 locked — correct, since the card was outside both
authors' windows.

**Not in scope:** L3-age, L3-stance (both already logged, unstarted).

**Status:** `npm run lint` / `npm run test` (659, +7) / `npm run build`
all green, route table unchanged.

## Phase 75 (L3-age) — a peak-age signal for the intern (2026-09-13)

**What.** The intern's pick now takes each fighter's age into account,
using a peak-age curve: 27–32 costs nothing, each year under 27 costs
half, each year over 32 costs one, and the gap is scaled to a ±0.04 cap at
8 weighted years. It is the weakest of the four signals, and the existing
0.25 combined ceiling is unchanged. Reasoning for every choice is in the
new `DECISIONS.md`.

**Why the source changed.** The roadmap planned API-Sports. A live check
found its `birth_date`/`age` fields null on 18/18 fighters (3 champions by
search, 15 enriched roster fighters from production), so the old
`PROJECT_FACTS.md` claim was wrong and is corrected. Sherdog's bio already
carried a birth date (`parseBio` parsed it; nothing saved it), confirmed
on every live page checked.

- `0042_fighter_birth_date.sql` — nullable `fighters.birth_date date`. Age
  is never stored; it's computed on the card's date.
- `parseSherdogBirthDate` (`parseSherdogDate.ts`, sharing the existing
  month/leap-year check) — "Dec 4, 2002" → `2002-12-04`, built from the
  text, not `Date` (a UTC+8 local-midnight `Date` lands a day early).
- `shared/utils/ageOnDate.ts` — birthday-aware whole years by string
  comparison.
- `parseBio` now also reads the age Sherdog prints beside the date;
  `birthDateFill.ts` writes a date only when it agrees with that printed
  age, never overwrites, and reports fill / keep / missing / mismatch.
- `lib/intern/ageAdjustment.ts`; `decideInternPick.ts` adds the shift and
  an "Age:" reasoning line; `generateInternPicks.ts` reads `birth_date`
  and the card's `event_date`.
- `importSherdogHistoryJob.ts` fills `birth_date` through the existing
  `--refresh` path and counts filled / missing / mismatch in its summary.
  No new backfill script.

**Tests:** written first; all failed for the right reason before any code
existed. 8 deliberate breaks tried: 7 caught; the 8th (`>` → `>=` at the
32 edge) is an equivalent change — distance-from-peak is 0 either way.

**Reviewer pass:** no high or medium findings. Two low:
`importSherdogHistory` (already over the 50-line limit) grew ~15 lines —
split left as cleanup; the mismatch check uses the UTC date — kept, since
Sherdog's printed age comes from a US-time server, and a mismatch only
ever withholds a write.

**Ran live:** 0042 pushed (ref checked: `vrwlfcywyfzfczajpdoh`, the only
pending migration) and read back. Dry run: 132 attempted, 132 would fill,
0 missing, 0 mismatches. Live: 132 birth dates written, 2,600 bouts
refreshed, 0 failed. Read-back: 132 with a date, 0 linked fighters missing
one, Marlon Vera `1992-12-02` and Jessie Rosas `2002-12-04` match Sherdog.
Intern job run on Silva vs. Delgado: every fight was already past the
intern's T-6h lock, so nothing was written (the new `birth_date` /
`event_date` reads ran without error). A read-only preview of that card:
9/14 fights carry an age edge (e.g. Bahamondes 29 vs Salikhov 42 → 4.00%,
the cap). The first stored "Age:" line lands on the next card.

**Found along the way:** locked intern picks are counted as `failed` (a
PostgREST error isn't an `Error`, so `isLockedError` never sees the
message). Log-only — no banner reads the count. Logged as `ROADMAP.md`
L4-fix and in `PROJECT_FACTS.md`; not fixed here.

**Not in scope:** showing age on the fighter page / tale-of-the-tape
(later); L3-stance (still deferred).

## Phase 76 (L5) — method-of-victory from real Sherdog finish records, plus a FINISH outcome (2026-09-13)

**What.** `predictInternMethod.ts` now uses the picked fighter's own
Sherdog win split and the opponent's own loss split — when BOTH sides
have one — instead of weight class alone. A new `FINISH` outcome
("ends early, KO or submission, unclear which") joins DECISION / KO_TKO /
SUBMISSION, shared with the human pick form, not intern-only. When either
side lacks a Sherdog record, the original weight-class-only rule applies
unchanged and never produces FINISH.

**Why.** Live finding (previous checkpoint): the old rule called Fiorot
vs Grasso a Fiorot submission (women's flyweight → assumed 60% of
finishes are subs) despite Fiorot's real record being 7 KO / 0 SUB /
6 DEC. Separately, UFC 331's real intern probabilities (0.53–0.65) made
the old rule call DECISION for 12 of 13 fights, regardless of who was
fighting.

- `0043_predicted_method_finish.sql` — widens `picks_predicted_method_check`
  to allow `FINISH`.
- `lib/scoring/fightMethod.ts` — `FIGHT_METHODS` gains `FINISH`; `BetRow.tsx`
  needed no change, since it already maps the list dynamically.
- `predictInternMethod.ts` — the two sides' finish rates are combined with
  a **geometric mean** (going the distance needs only one side to resist
  a finish), applied as a **capped** nudge (`MAX_RECORD_FINISH_SHIFT`) on
  the same finish-pool-vs-decision test the old rule already used, and
  the KO-vs-submission share is a **weighted blend**
  (`WEIGHT_CLASS_VOTE = 0.35`) of the weight-class prior and the two
  records, not fully record-driven.
- `methodBacktest.ts` / `runMethodBacktest.ts` (`npm run
  intern:method-backtest`, read-only) — replays every Sherdog-linked
  fighter's own decidable wins with a leakage-free pre-fight record.
- `generateInternPicks.ts` reads the six finish columns for both fighters
  and passes picked/opponent splits keyed off which fighter was picked.

**Tests:** written first, exact-value fixtures hand-computed from real
Sherdog records (Despaigne/Tuivasa, Jourdain/Vera, Fiorot/Grasso) before
the implementation existed.

**Reviewer pass, first round — one high finding, fixed.** A straight
50/50 blend of the weight-class KO share with the fighters' own record
made `SUBMISSION` mathematically **unreachable** in the heavy bucket
(`KO_SHARE.heavy = 0.85` floors the blend above the FINISH threshold
regardless of input) — the same class of dead-branch bug
`RETROSPECTIVE.md` already recorded once (Phase 62). Fixed by weighting
the blend 35/65 toward the records instead of 50/50 (`WEIGHT_CLASS_VOTE`);
a new brute-force test now checks both KO_TKO and SUBMISSION reachability
in every bucket, not just a few hand-picked cases. Two documentation gaps
also found and fixed: `PROJECT_FACTS.md` still described a 3-value enum
after this diff widened it to 4, and `DECISIONS.md` was cited by comments
that pointed nowhere.

**Ran live:** 0043 pushed (ref checked: `vrwlfcywyfzfczajpdoh`) and read
back — `picks_predicted_method_check` confirmed to allow `FINISH`.
`npm run intern:method-backtest` against 68 real fights where both sides
had a Sherdog record: 74.1% exact-call accuracy vs the old rule's 69.1%
on the same population; FINISH called 20.6% of the time, right 64.3% of
those (vs a 29.4% real base rate for "was it a finish at all"). A
read-only preview of the next card (UFC 331, 13 intern picks): 4 fights
changed from the old rule's call, all to a named finish or FINISH backed
by a real record edge, no unexpected FINISH pile-up (1 of 13).

**Not in scope:** method scoring (PRD Could-have); L4-fix; round
prediction.

**Status:** `npx vitest run` (699, +40) / `npx tsc --noEmit` / `eslint` /
`npm run build` all green, route table unchanged.

## Phase 77 (M1) — Fix unpaged reads before they cause silent data loss (2026-09-14)

**What.** `fights` had crossed PostgREST's row cap live (1,044 rows > 1,000):
`fetchUnpricedFights` (`lib/odds/eligibleUnpricedFights.ts`) was silently
returning ~998 fights instead of the true 1,047 unpriced ones, with no error
anywhere in the chain. Switched every whole-table or unbounded-filter read in
the odds/settlement/fighters-identity paths to page through
`lib/supabase/selectAllPages.ts`, and added `lib/supabase/selectAllPagesByIds.ts`
(pages *and* chunks an `.in()` id list) so neither failure mode — a truncated
response or an oversized request URL — can recur through one shared path.

- `lib/odds/eligibleUnpricedFights.ts` — the live bug; both reads paged.
- `lib/ufc-data-sync/upsertFighter.ts` — fold-match scan paged (822 rows,
  growing). Also fixed a second, independent bug found in the same function:
  the exact-name lookup used `.maybeSingle()`, which throws on a
  case-insensitive collision instead of resolving it. Extracted the existing
  tie-break (prefer the row with an `external_id`, else lowest `id`) into
  `lib/ufc-data-sync/pickCanonicalFighter.ts`, used by both branches.
- `lib/settlement/settlePicks.ts` — unsettled-picks read paged; fights/odds
  lookups chunked via `selectAllPagesByIds`.
- `features/fighters/api.ts` — `getFighters` paged; the weight-class-fill
  `.or()` list chunked. `getFighters` now takes an optional injected
  Supabase client (default: the singleton) so it's actually testable — it
  previously threw at import time in any test, singleton env vars or not.
- `lib/ufc-data-sync/sweepLatentDisputedOpponents.ts` — paged pre-emptively
  (a one-time backfill script, kept correct in case it's ever re-run).
- `lib/sherdog/resolveSherdogIdentityJob.ts` — its local `chunk()`/`ID_CHUNK`
  extracted to shared `lib/supabase/chunk.ts`; `lib/sherdog/applySherdogResults.ts`
  and `lib/sherdog/reimportSherdogForPendingFights.ts`'s fighter `.in()`
  lookups switched to `selectAllPagesByIds`.
- `CLAUDE.md` gained a db-read-safety section (the five rules, previously
  only in `RETROSPECTIVE.md`).
- `vitest.config.mts` sets dummy `NEXT_PUBLIC_SUPABASE_*` env vars for the
  whole test run — `lib/db.ts`'s singleton throws at *import* time otherwise,
  which blocked testing `features/fighters/api.ts` at all.

**Why.** First sub-phase of Phase M, prompted by the user asking about
github.com/ehan03/Tapology-Scraper as a possible fix for slow settlement,
lingering cancelled bouts, and recurring conflicts. That repo was rejected
(no result/method/stats fields, abandoned, evades anti-bot defenses — see
`DECISIONS.md`); investigating the real pipeline surfaced this live,
already-active data-loss bug before any of the other four sub-phases, so it
went first.

**Tests:** written first for every fix, failing for the right reason before
any implementation existed — `eligibleUnpricedFights.test.ts` reproduces the
exact production shape (1,050 fights, 3 priced, asserts exactly 1,047 back,
including one specifically past row 1,000); `upsertFighter.test.ts` covers
both the row-cap fold-match miss and the `.maybeSingle()` collision crash;
`settlePicks.test.ts` covers the row-cap read and asserts the fights/odds
`.in()` calls actually split into multiple chunks, none oversized;
`features/fighters/api.test.ts` mirrors both; `chunk.test.ts` and
`selectAllPagesByIds.test.ts` and `pickCanonicalFighter.test.ts` cover the
new shared helpers directly (including their own edge cases: empty input,
exact multiples, remainders, all-tie, no-external_id-anywhere).

**Ran live:** read-only. SQL ground truth:
`count(fights) - count(odds_snapshots) = 1044 - 27 = 1017`. A scratch run of
the fixed `fetchUnpricedFights` against production (deleted after use, never
committed) returned exactly 1,017.

**Not in scope:** M2–M5 (cancellation reconciliation, remembered dispute
answers/fighter merge, settlement cadence, Sherdog auto-disambiguation) —
each is its own sub-phase, `ROADMAP.md` Phase M.

**Reviewer pass:** one real finding, fixed before shipping — `getFighters`
silently lost its `.order("name")` sort. `selectAllPages` orders by `id` (a
random uuid) for its keyset pagination and has no way to layer a caller's
own `.order()` on top, so the `/fighters` grid would have rendered in
effectively random order instead of alphabetically. Fixed with a client-side
`localeCompare` sort once every page is in hand; confirmed the regression
test actually catches the bug (failed with the sort removed, passed with it
restored) before counting it as done. Everything else in the diff — the
`selectAllPagesByIds` chunk+page composition, `upsertFighter`'s non-collision
case, `settlePicks`'s exact-match preservation, the Sherdog jobs' refactor,
the dummy test env vars — checked out with no changes needed.

**Status:** `npx vitest run` (722, +25) / `npx tsc --noEmit` (via
`npm run build`) / `eslint` / `npm run build` all green, route table
unchanged.

## Phase 78 (M4) — settlement cadence (2026-09-17)

**What.** New `.github/workflows/settle.yml`: hourly, Saturday through
Monday UTC, running only `runSettlementJobs.ts` (no API-Sports or
Wikipedia calls, so no quota cost) so a 24h single-source settlement
timeout no longer has to wait for `sync.yml`'s next twice-daily run to
actually fire. `runSettlementJobs.ts` gains a `--sherdog-reimport-cap=<n>`
flag; `settle.yml` passes `30` (vs. the default 12) since it has no sync
step competing for its time budget.

**Verified live before building anything:** `gh run list --workflow=sync.yml`
on real recent runs showed the 00:00/12:00 UTC cron actually landing
02:55–03:11 and 15:32–17:34 UTC — 3–5.5h late, GitHub Actions' own
schedule-queuing delay, not a hypothetical. Stacked on the up-to-12h gap
between runs, a fight settling only on the 24h single-source timeout
could previously sit stale for well over 24h before `sync.yml` next
checked it. The 24h rule itself is unchanged.

**Reordering fix.** `reimportSherdogForPendingFights.ts`'s per-run cap
previously applied to a `Set` built from an unordered DB fetch — an
effectively arbitrary subset, which could leave the newest card (the one
most likely still waiting on a Sherdog answer) uncovered while
re-fetching an older one instead. Extracted the ordering rule into a new
pure function, `orderSherdogIdsForReimport.ts` (test-first, 5 tests,
mutation-verified — reversing the sort direction failed 3 of the 5): sort
pending fights newest-event-first, dedupe fighters in that order, map to
sherdog ids, then cap. `reimportSherdogForPendingFights.ts` now calls it
instead of building the Set inline — merged cleanly alongside M1's own
`selectAllPagesByIds` change to the same function; both fixes now apply
together.

**Concurrency guard.** `sync.yml`, `sherdog.yml`, and the new `settle.yml`
all write overlapping tables (`fighters`, `fights`, `picks`,
`fighter_elo_history`) and previously had no protection against running
at the same time — a real, not hypothetical, risk once an hourly job
exists alongside two scheduled ones. Added a shared `concurrency: {group:
ufc-data-write, cancel-in-progress: false}` block to all three — queues
an overlapping run rather than cancelling one mid-write.

**Status:** `npx vitest run` (704, +5) / `npx tsc --noEmit` / `eslint` /
`npm run build` all green, route table unchanged. Branched fresh off
`origin/main` per Phase M's own convention — independent PR, no
merge-order dependency on M1/M2/M3.

## Phase 79 (M5) — Sherdog auto-disambiguation via history corroboration (2026-09-17)

**What.** New `historyCorroborates.ts` (pure, test-first, mutation-verified):
does a Sherdog candidate's own pro fight history contain a bout against
one of our fighter's KNOWN opponents (from our own `fights` table) within
±10 days of the date we already have for that matchup? A strictly
stronger identity signal than name similarity — it doesn't care what a
candidate's name looks like, only whether the same career actually
happened.

Wired into two places:

1. **`resolveSherdogIdentityJob.ts`** (new fighters): before either
   existing fallback (queue, or the old pro-fight-count ambiguous
   tie-break), tries history corroboration across every returned
   candidate (capped at 20 — Sherdog's own search-results ceiling, and
   the exact count on the real David Martínez conflict below). Auto-
   matches only when exactly one candidate corroborates.
2. **New `resolveOpenSherdogConflictsJob.ts`**: re-examines every OPEN
   `low_confidence_sherdog_match` conflict already sitting in
   `data_conflicts` against its own already-snapshotted candidate list —
   no new Sherdog search needed. Wired into `sherdog.yml` right after
   identity resolution. Skips `guard_mismatch` conflicts deliberately —
   a different, riskier question ("is this one already-rejected candidate
   secretly right") this feature doesn't try to answer.

**Verified live before building anything, and again after:** inspected
the real open conflicts via a throwaway read-only script (deleted before
commit) — 10 open `low_confidence_sherdog_match` conflicts in production,
matching the roadmap's own claim (common names: David Martínez, 20 tied
candidates; nickname-only storage: "Renato Moicano" → Sherdog's "Renato
Carneiro", "Patrício Pitbull" → Sherdog's "Patricio Freire"). Fetched the
real Sherdog page for "Patricio Freire" (id 9960) and confirmed its real
history lists bouts against Aaron Pico (2026-04-11), Dan Ige
(2025-07-19), and Yair Rodríguez (2025-04-12) — all matching our own
`fights` rows for "Patrício Pitbull" almost to the day, even though
Freire's own name similarity to "Patrício Pitbull" (0.55) is LOWER than
the wrong namesake candidate's (0.59, "Patricio Lima") — the concrete
case that motivated building this rather than tightening the name
threshold.

After building both pieces, ran the new sweep job's `--dry-run` against
production for real: **10 checked, 10 auto-resolved, 0 failed** — every
open conflict, including the 20-candidate David Martínez case,
corroborates to exactly one candidate. Not yet run for real; needs the
user's explicit go-ahead first, same discipline as every other Phase M
data-mutating job.

**A real bug caught while writing this, not by the reviewer:** the sweep
job's own dry-run initially printed "would auto-resolve" for all 10 while
its summary line reported `0 auto-resolved` — the counter increment was
placed after the dry-run `continue`, so dry-run mode never actually
counted what it just logged. Fixed by counting before the dry-run
short-circuit and only after a real write succeeds otherwise, matching
`resolveSherdogIdentityJob.ts`'s own established shape for the same
dry-run/live split.

**Status:** `npx vitest run` (709, +10 across `historyCorroborates.test.ts`
and `resolveOpenSherdogConflictsJob.test.ts`) / `npx tsc --noEmit` /
`eslint` / `npm run build` all green, route table unchanged. Branched
fresh off `origin/main` per Phase M's own convention.

**Reviewer found no correctness bugs in the matching logic** (date
parsing, name matching, corroboration threshold, control flow), but
flagged two real operational issues, both fixed before merge:

1. `sherdog.yml`'s sweep step (`resolveOpenSherdogConflictsJob.ts`) ran
   right after identity resolution — guaranteed, not hypothetical, that
   any fighter newly queued that same run had its full candidate set
   fetched twice back-to-back (once by the identity job's own history-
   corroboration attempt, once by the sweep re-examining the conflict it
   just opened). Fixed by reordering: the sweep now runs FIRST, so it
   only ever touches conflicts at least one run old.
2. The sweep's final `data_conflicts` update had no `resolved_at IS NULL`
   re-check, unlike the manual action it's patterned after — a real gap
   given its loop does up to 20 rate-limited Sherdog fetches between the
   initial select and that final write (the manual action's own window
   is instant, no I/O in between). Fixed by adding the re-check: a
   concurrent manual `/conflicts` resolution now wins instead of being
   silently overwritten.

## Phase 80 (M2) — Cancelled-bout reconciliation (2026-09-14)

**What.** A bout removed from its Wikipedia card page had no way to be
marked cancelled: `processScheduleEvent.ts` only ever upserted bouts it
found on the page, never noticed one that disappeared. Found live on UFC
Fight Night: Silva vs. Delgado -- Jimenez vs. Vera (pulled for a visa
issue) stayed on the card, the intern picked it, and it was the sole cause
of all 24 open `low_confidence_odds_match` conflicts (the only unpriced
fight left on the card, so every later odds event "matched" it).

- **`0044_cancelled_fights.sql`**: adds `fights.wikipedia_missing_since`
  and widens `fights_settled_from_check` with `'cancelled'`. **Not yet
  applied to production** -- see "Ran live" below.
- **`planCardReconciliation.ts`** (new, pure, 12 tests): given an event's
  existing unsettled Wikipedia bouts and which fight ids the current sync
  actually found present, decides markMissing / cancel (after a 6h grace
  window past the first miss) / clearMissing per fight. Ignores anything
  already settled or belonging to a different event/source.
- **`applyCardReconciliation.ts`** (new, 8 tests): the I/O wrapper --
  reads the event's existing wiki fights, decides whether this run's
  parse is trustworthy enough to act on at all (skips entirely, no writes,
  when the parse dropped a malformed bout, found zero bouts, or found
  under half the card's existing wiki bout count -- a partial page render,
  not a real cancellation wave), then applies each action. A cancel never
  writes `method`/`round` -- a fake method string would leak into Elo
  (`isResolvedForElo.ts`) and records (`isNoContestOrAmbiguous.ts`) as a
  rated draw, since both key off method text rather than `settled_from`.
- **`upsertFight.ts`**: the `"conflict"` result now also carries the
  disputed fight's own `fightId`, not just the conflict row's id (4 new
  tests) -- reconciliation must always count a disputed bout as "present"
  (the sources merely disagree about the opponent; it plainly still
  exists), never mistake it for one that vanished from the card.
- **`fetchSchedule.ts`**: reports `skippedBoutCount` (2 new tests) -- a
  malformed `{{MMAevent bout}}` block used to be silently dropped,
  indistinguishable from a page with genuinely fewer bouts.
- **`processScheduleEvent.ts`**: collects every fight id actually found
  present this run (upserted or disputed) and calls
  `applyCardReconciliation` after the upsert loop.
- **Cancelled fights excluded from**: intern picks
  (`generateInternPicks.ts`), odds candidates (`eligibleUnpricedFights.ts`,
  2 new tests -- this was the direct cause of the 24 odds conflicts), the
  rumour scan (`runRumourScanJob.ts`), the scoreboard chalk line
  (`features/scoreboard/api.ts` -- a cancelled fight has no real favourite
  to bet chalk on), and the 30-day result-refresh queue
  (`refreshRecentEventResults.ts` -- generalized to "already settled by
  any means," not cancellation-specific, so a cancelled bout's card
  doesn't stay queued for the full window).
- **Card UI**: a cancelled bout stays on the card (owner's confirmed
  choice -- a pick shouldn't just silently vanish), greyed
  (`BoutRow.module.css`'s new `.cancelledRow`), reading "Cancelled — pick
  voided, stake returned" in place of the result line and in place of the
  quick-pick controls (`QuickPick.tsx`'s new `cancelled` branch, checked
  before `disputed`/`locked` since cancellation is a final state, not a
  hold). `CardBout.cancelled` is derived from `settled_from` in
  `getCardView`, matching how `disputed` is already passed down as a
  derived flag rather than a raw row.
- **Odds noise**: `matchAndSnapshot.ts`'s `low_confidence_odds_match`
  dedup widened from open-only to open-or-resolved conflicts (2 new
  tests) -- a resolved one already has an answer and re-queuing it just
  re-asks a question someone answered. **Considered and rejected**: an
  absolute confidence floor below which a match is `no_candidates` instead
  of `low_confidence` -- the pinned `matchFights.test.ts` collision test
  (Gaethje/Topuria vs. the real Gaethje/Tsarukyan fight) scores at 0.54,
  and that is exactly the kind of genuine one-shared-fighter ambiguity the
  conflict queue exists to surface, not noise to suppress. The actual root
  cause (a cancelled fight becoming the sole remaining "candidate") is
  already fixed by the `eligibleUnpricedFights.ts` exclusion above.

**Why.** Second sub-phase of Phase M (`ROADMAP.md`), continuing directly
from M1's live pipeline investigation prompted by the user's Tapology
question.

**Tests:** written first throughout -- every new pure function and I/O
wrapper had its test file created and confirmed failing (module missing,
or the exact reported bug reproduced) before the implementation existed.
34 new tests total.

**Reviewer pass:** one real design gap, fixed before shipping. This
function is also reached from `refreshRecentEventResults.ts` (re-pulls
results for cards up to 30 days finished) and
`backfillWikipediaHistory.ts` (any historical card), not only
`syncSchedule.ts`'s still-upcoming loop -- a path the whole grace-window
design never considered. On a PAST card, a bout can drop out of the live
`{{MMAevent bout}}` wikitext for reasons that have nothing to do with
cancellation (editors folding results into prose, trimming prelims long
after the event), while still being genuinely unsettled for an unrelated
reason (an open `disputed_opponent` conflict, permanently disagreeing
sources) -- exactly the "missing twice, 6h+ apart" shape reconciliation
was built to catch, wrongly. **Fixed:** `applyCardReconciliation` now
takes the event's date and skips entirely (`event_in_past`) for any
`eventDate` strictly before today, before any other check -- the same
`>= today` boundary `syncSchedule.ts`'s own upcoming loop and
`selectEventsNeedingResultRefresh.ts`'s past-window already use. 2 new
tests (an already-happened card with a bout missing well past grace is
untouched; an event happening today still proceeds normally).

Also noted, not fixed (Low severity, opposite direction from the PR's
concern -- a false NEGATIVE, not money-affecting): if Wikipedia renames an
event page between two syncs, a bout that was already missing before the
rename keeps its old-titled `external_id` forever and can never be
reconciled again, since the prefix filter uses the event's *current*
title. Rare (mid-lifecycle page rename) and safe to leave for a later
pass if it's ever actually observed.

Everything else in the reviewer's checklist -- the boundary at exactly
half-parsed, event-id scoping, `presentFightIds` correctness including
the disputed-opponent case, partial-run-failure safety, the cancel
write's CHECK-constraint compatibility, and exclusion completeness across
every other fight-reading query in the codebase -- checked out with no
changes needed.

**Ran live:** **not yet -- migration 0044 has NOT been applied to
production, and no sync run has executed this code against real data.**
Cancelling a fight voids real picks; per the project's own bulk-mutation
rule this needs an explicit dry-run and the owner's go-ahead before
anything writes, not just before code review. The Silva vs. Delgado card
was checked read-only (SQL, 2026-09-13/14) to confirm Jimenez vs. Vera is
still the only stuck unsettled bout on that card, matching the scenario
every test above is built from.

**Not in scope:** M3–M5 (remembered dispute answers/fighter merge,
settlement cadence, Sherdog auto-disambiguation) -- each its own
sub-phase, `ROADMAP.md` Phase M. The one-time cleanup of the 24 already-
open odds conflicts (a data-fix, not a code change) is also deferred to
the live-run step, since most of them should self-resolve once
`eligibleUnpricedFights.ts`'s exclusion is live and a sync actually
cancels Vera.

**Status:** `npx vitest run` (731, +36) / `npx tsc --noEmit` (via
`npm run build`) / `eslint` / `npm run build` all green, route table
unchanged.

## Phase 81 (M3) — Remembered dispute answers, aliases, fighter merge (2026-09-14)

**What.** "Keep existing" on a `disputed_opponent` conflict recorded
nothing, so a same-card name variant ("Jose Delgado" → "Jose Miguel
Delgado", "Sean King" → "Sean King III") reopened the identical dispute on
the very next sync -- found live, twice, 2026-09-13. There was also no
real way to merge two duplicate fighter rows other than one-off, hand-run
SQL under `supabase/data-fixes/`.

- **`0045_fighter_aliases_and_merge.sql`** (**NOT YET APPLIED to
  production** -- see "Ran live" below): new `fighter_aliases` table
  (stores the raw dropped name, not pre-normalized -- see the migration's
  own comment on why that departs from the plan's original
  `alias_normalized unique` shape) and a real `merge_fighters(keep, drop)`
  function, ported from `2026-09-10_merge-8-name-variant-duplicate-fighters.sql`.
  **Two real gaps found and fixed while writing it, before it ever ran
  anywhere:**
  - `fighter_sherdog_bouts` and `fighter_scouting_reports` are both
    `on delete cascade` on `fighter_id` -- deleting the dropped row
    without repointing them first would silently DESTROY the dropped
    fighter's real Sherdog bout history (and any scouting notes), not
    just re-file it. Traced against the actual production shape this
    feature exists for: Jose Delgado (Sherdog-linked) / Jose Miguel
    Delgado (API-Sports-linked) -- `checkMergeGuard` prefers `external_id`
    for the keeper, so the Sherdog-linked identity is exactly the one
    likely to be DROPPED, taking its real bout history down with it.
  - Copying `sherdog_id` onto the keeper without also copying
    `sherdog_history_imported_at` and the six finish-breakdown columns
    would leave the newly-repointed bout rows unrecognized --
    `recomputeFighterRecords.ts` keys its Sherdog-record override on that
    timestamp, not on the bout rows existing.
  - The pick-lock trigger (`check_pick_constraints()`) gets one more
    condition, same shape as 0027's settlement bypass: a transaction-local
    `app.merging_fighters` setting (never a session-level one -- would
    leak across a pooled connection) skips the pick-lock timing, the
    open-disputed_opponent check, and the settlement-columns check for
    exactly the one transaction `merge_fighters()` runs. The
    fighter-membership check is deliberately NOT bypassed -- it passes on
    its own because `fights` is always repointed before `picks`.
  - `merge_fighters` is `security definer` (needs to write across five
    tables regardless of the caller's own grants) but is explicitly
    `revoke`d from `public` and only `grant`ed to `service_role` -- a
    `security definer` function's EXECUTE privilege defaults to PUBLIC in
    Postgres, which would otherwise expose it at
    `/rest/v1/rpc/merge_fighters` to any authenticated (or anon) client.
    Direct application of CLAUDE.md's own "GRANTs are independent of RLS"
    rule to a function, not just a table.
- **`isSameCardNameVariant.ts`** (pure, 7 tests): whether two names could
  be the same fighter, given they're already known to be the two
  candidates for one shared-opponent slot on one card. Deliberately MORE
  permissive than the global `namesLikelySamePerson` (a bare suffix
  difference like "Dan Hooker" / "Dan Hooker Jr" matches here, though
  `namesLikelySamePerson`'s own pinned test correctly keeps that pair
  apart globally) -- the same-card, same-opponent context is what makes
  the looser rule safe. Never a bare nickname (only one token shared).
- **`identifyDifferingFighters.ts`** (pure, 4 tests) +
  **`decideSameCardMerge.ts`** (pure, 9 tests): given a disputed fight's
  kept vs. candidate pairing, finds the two actually-in-question fighters
  and decides keep/drop (prefers `external_id`, tie-break on `id` -- same
  rule `upsertFighter.ts`'s own fold-match already uses) plus one hard,
  non-overridable guard: two fighters with DIFFERENT confirmed Sherdog
  ids are never merged, manual or automatic.
- **`resolveSameCardNameVariants.ts`** (5 tests) + its runner
  (`npm run fighters:resolve-same-card-variants -- --dry-run`): sweeps
  every open `disputed_opponent` conflict, auto-merges the ones
  `decideAutoMerge` clears, resolves the conflict as `auto_alias`. Wired
  into `sync.yml` right after the schedule sync, while conflicts are
  still fresh.
- **`upsertFighter.ts`**: checks `fighter_aliases` after `external_id`
  and before the plain name match (3 tests) -- a merged-away name now
  resolves straight to the keeper instead of recreating the duplicate the
  merge existed to fix.
- **`upsertFight.ts`**: the disputed branch now also checks every
  RESOLVED conflict on that fight for a `confirmed_existing` resolution
  matching the exact incoming `candidate_external_id` (4 tests) -- the
  owner's "keep current" answer is now actually remembered, not just
  logged and forgotten. A different candidate, or a resolution that
  actually changed the row (`used_candidate`), still opens normally.
- **`/conflicts`**: `DisputedOpponentChoice` gains `"merge"` (2 tests for
  the pure resolution shape). The Server Action runs the real merge
  (`checkMergeGuard` + `mergeFighters()`) BEFORE resolving the conflict
  row, and refuses with a clear message if the two fighters carry
  different confirmed Sherdog identities -- the one guard that applies to
  a manual owner override exactly as it does to the automatic sweep.
  `DisputedOpponentCard.tsx` gets a third button, "Same fighter, different
  name."

**Why.** Third sub-phase of Phase M (`ROADMAP.md`), continuing from M1/M2's
live pipeline investigation prompted by the user's Tapology question.

**Tests:** written first throughout, 34 new (7 + 4 + 9 + 5 + 3 + 4 + 2).
The two real migration gaps above (Sherdog-history cascade-delete,
missing derived-column copy) were found by tracing the actual production
Delgado/Delgado shape while writing the SQL, before it was ever applied
anywhere -- not caught by a test, since a SQL function's own logic isn't
vitest-testable in this project (no local Postgres); verified by reading
the migration against the schema instead, the same way 0027/0041's own
trigger changes were.

**Reviewer pass:** pending -- see next entry once it runs.

**Ran live:** **not yet -- migration 0045 has NOT been applied to
production, and no job has executed this code against real data.**
Merging two fighters is effectively irreversible (a deleted row, a
recomputed Elo history) and repoints picks -- per the project's own
bulk-mutation rule this needs a dry run
(`npm run fighters:resolve-same-card-variants -- --dry-run`) and the
owner's go-ahead before anything writes, same as M2's cancellation code.

**Not in scope:** M4–M5 (settlement cadence, Sherdog auto-disambiguation)
-- each its own sub-phase, `ROADMAP.md` Phase M. Also not done: copying
physical measurements (height/reach/stance/birth_date) from the dropped
fighter onto a keeper that lacks them -- the ported 2026-09-10 script
didn't do this either, and it's a reasonable later enhancement, not a
gap this phase needs to close.

**Status:** `npx vitest run` (732, +34) / `npx tsc --noEmit` (via
`npm run build`) / `eslint` / `npm run build` all green, route table
unchanged.

## Phase 82 (M3-fix) — merge_fighters() could never move an identity link (2026-09-18)

**What.** New migration `0046_merge_fighters_unique_collision.sql`,
replacing `merge_fighters()` (0045). Step 5 previously copied the dropped
fighter's `sherdog_id` and `external_id` onto the keeper while the drop
row still held those same values — the drop row is not deleted until step
7, several statements later. Both columns are `unique` (0001/0036), and
Postgres enforces a non-deferrable unique constraint as each row version
is written into the index, not at commit, so the keeper's new index entry
collided with the drop row's still-live one and the entire merge aborted.
Fixed by clearing the drop row's column first, then writing the keeper —
a move, not a copy. Everything else in the function is unchanged.

**Found live, not by review.** The first real run of
`npm run fighters:resolve-same-card-variants` (2026-09-18, immediately
after 0044/0045 were applied) failed on its very first merge:

```text
23505 duplicate key value violates unique constraint "fighters_sherdog_id_key"
Key (sherdog_id)=(307733) already exists.
```

That is the Jose Delgado / Jose Miguel Delgado pair — the exact
production shape 0045's own step-3a comment cites as the motivating
example for this whole feature, and the most common merge shape there is
(the Sherdog-linked row is usually *not* the keeper, since
`checkMergeGuard` prefers `external_id`). So this path had never once
worked. The dry run did not catch it because `--dry-run` stops before the
RPC call; nothing between it and a real write exercised the SQL.

**No data was written.** Postgres aborts the whole transaction on error,
so the failed merge rolled back cleanly — verified after the fact that
both pairs were still separate rows and `fighter_aliases` was still
empty. M2 and M5 ran in the same batch and both succeeded (M5: 10/10
conflicts auto-resolved; M2: 8 events / 62 fights, one unrelated
pre-existing duplicate-event pair correctly skipped for manual review).

**Deliberately not fixed by making the constraints `deferrable initially
deferred`** — the other obvious option. That would relax uniqueness
enforcement for every other writer of those columns (the API-Sports sync,
the Sherdog resolver) to catch violations only at commit, in order to fix
one function's statement ordering. Also worth stating because it's the
intuitive wrong answer: folding both writes into a single `update`
touching both rows does **not** help either, for the same reason
`update t set id = id + 1` fails on a unique `id` — a single statement
gets no reprieve. Ordering is the only thing that fixes it.

**Tests:** none added — a SQL function's own logic still isn't
vitest-testable in this project (no local Postgres), the same constraint
0045's own entry recorded. Verified by reading the migration against the
real schema, and `%type` declarations are used throughout the new
variable block so the finish columns being `smallint` (0038) rather than
`integer` (0036's `sherdog_id`) can't silently drift. The real test is
the live re-run of M3.

**Ran live:** migration not yet applied at time of writing — needs the
owner's go-ahead per `CLAUDE.md`, same as every other migration.

## Phase 83 (N1-N2) — llm/ map-reduce harness; strong-tier design dropped after a live spike (2026-09-18)

**What prompted this.** A request to apply a map-reduce pattern (many
cheap calls, one stronger call for the final decision, ground-truth
verification against hallucination) to AI-assisted work in the app.
Exploration found picks are deliberately deterministic, not LLM-driven
(`ARCHITECTURE.md` Fork 10), and the only existing LLM call is the
rumour-clustering path (`lib/llm.ts`) — so the pattern was redirected onto
three real surfaces instead: rumours (retraction, N3), the `data_conflicts`
queue (advisory proposals, N4), and a shadow-only scouting layer measured
against the deterministic rule on Brier score (N5-N9), never assumed to
replace it. Full plan and reasoning in `DECISIONS.md`'s N1 entry.

**N1 — verification spike, live, before any code.** Re-measured Gemini's
free tier 16 days after the original F1 measurement. The two-tier design
(a cheap "map" model, a stronger "reduce" model) was dropped entirely: 4
of 6 full-Flash calls returned `503 UNAVAILABLE`, latency was 9.7–19.3s
vs ~0.9s for Flash Lite, and two trap-laden card-level consolidation
tasks showed no reproducible quality gap between tiers. **Every call now
goes to `gemini-3.5-flash-lite`.**

The dashboard check that followed moved the real constraint: RPD sat at
56/500 (11%), but **RPM was 14/15 (93%)** — production was already
nearing the limit the strong tier's removal made irrelevant. The cause is
structural (`runRumourScanJob.ts` issues one call per fight, serially,
~1s apart, over a ~14-fight card) and pre-existing, not introduced by this
work. Also confirmed live: `temperature: 0` + `topK: 1` give
byte-identical repeats without breaking JSON parsing (every call before
this ran at the default temperature of 1.0); no dated/pinnable model id
exists, so a silent model swap can't be prevented, only made auditable via
the response's own version field; RPD resets at midnight Pacific.

**N2 — the harness.** `lib/llm.ts` split into `lib/llm/`: one wrapper
(`geminiClient.ts`, the only file that knows the base URL/API key/model
id), a generic `runMapReduce` orchestrator built to serve rumours,
conflicts, and scouting from the same code with zero network/Supabase
dependency of its own, a generalized claim verifier (`verifyClaims.ts`,
generalizing what `parseClusterResponse.ts` already hand-rolled), and a
Postgres-backed budget allocator.

New migration `0047_llm_call_log.sql`: `llm_call_log` table plus
`try_reserve_llm_call()`, a `security definer` function that atomically
counts-and-inserts so two concurrent job runs can't both pass the daily
cap or both fire inside the 4.2s minimum interval — advisory-locked per
model id, since the RPM guard is global across every surface, matching how
the provider itself enforces it. A cheap non-atomic per-surface soft
ceiling is checked in TypeScript first, so one runaway surface can't eat
another's budget even before the atomic check runs.

`generateJson` preserved byte-for-byte — `scanFightForRumours.ts`'s
`import { generateJson } from "../llm"` resolves unchanged to the new
`llm/index.ts` (`moduleResolution: "bundler"`), verified with a real
`npx tsx src/lib/rumours/runScheduledRumourJob.ts` run against production:
13/13 fights via LLM, 0 heuristic fallback, 0 failed.

65 new tests. Budget-policy cap exclusivity and `runMapReduce`'s
budget-denied counting mutation-verified (reverting each fix reproduces
exactly one failing test, confirmed, then restored). Full suite:
892/892 passing, lint clean, build clean.

**Migration applied 2026-09-18**, target ref confirmed as
`vrwlfcywyfzfczajpdoh` before pushing (dry-run showed only `0047`
pending). Verified live, not by the tracker alone: `llm_call_log` selects
cleanly (0 rows, expected — nothing has used it yet); `try_reserve_llm_call`
called with `p_cap=0` returned `null` (its denial branch, proven to run)
while writing zero rows, the same "prove it runs via a guaranteed
no-write guard clause" verification pattern Phase 79's `merge_fighters()`
check used.

**Next:** N3 — rumour flag retraction, the harness's first real caller
and a genuine bug fix (nothing in `lib/rumours/` currently expires a
flag once its rumour is retracted; a weight-cut concern from a week ago
still feeds `flagPenalty()` at full strength today).

## Phase 84 (N3) — Rumour flag retraction: the harness's first real caller, and a real bug fix (2026-09-18)

**What.** Fixed a genuine pre-existing bug found while planning Phase N,
not introduced by it: nothing in `lib/rumours/` has ever expired a flag
once its rumour is retracted or resolved. `rumour_flags` only ever
upserted on `(fight_id, fighter_id, category)` and bumped
`last_corroborated_at`, so a weight-cut concern from a week ago kept
feeding `flagPenalty()` at full strength into `estimated_probability`
indefinitely.

**New card-level retraction pass**, `proposeCardRetractions.ts`, wired
into `runRumourScanJob.ts` right after the per-fight clustering loop.
One `runMapReduce` call (Flash Lite) reviews every currently-open flag
against every post collected across the whole card this run, and
proposes `{flagId, action, supersededByUri, rationale}` per flag.
Deliberately skipped entirely (spends nothing) when there are no open
flags or no posts collected this run.

**Ground-truth checks, none trusting the model's own framing**
(`retractionChecks.ts`, test-first, 12 tests, mutation-verified): the
flag is a real, still-open id; the superseding post is a real post from
this run, never an invented uri; the post is **strictly newer** than
every existing source already backing that flag — the exact-value case
this whole feature exists for; and the post's own text actually names
the flagged fighter (`findFighterMentionInText`, the same two-candidate-
scoped matcher the clustering path already uses), independent of
anything the model claims — the claim schema doesn't even carry a
fighter field, on purpose.

New migration `0048_rumour_flag_retraction.sql`: `retracted_at`,
`retraction_reason`, `superseded_by_post_uri` on `rumour_flags`, plus a
check constraint that all three are set together or none are. Nothing
deleted — a wrong retraction is reversible by nulling three columns.
`fetchFlagsForFights.ts` (the intern's read path) now excludes retracted
flags — **correctness-critical**, test-first: the failing test first
reproduced the real bug (a retracted flag still counted toward
corroboration) against the *unpatched* code, then passed once the
`.is("retracted_at", null)` filter was added.

**Deliberately deferred, stated rather than silently dropped**: the
plan's stretch goal of refactoring `parseClusterResponse.ts`'s hand-rolled
checks into `ClaimCheck`s (matching `retractionChecks.ts`'s shape) was
skipped. It's a working, already-tested, already-in-production path —
the refactor would have been pure consistency, no new capability, and
`retractionChecks.ts` already proves the harness's pattern generalizes
for N4's conflict proposals. Revisit only if a real reason (a bug, a
second caller that needs the same checks) comes up.

**Verified, not assumed:**

- `retractionChecks.ts`'s load-bearing "strictly newer" check mutation-
  verified: reverting `>` to a version that ignores the comparison
  reproduced exactly 2 failing tests (the two testing that logic),
  restored to green.
- `fetchFlagsForFights.ts`'s fix mutation-verified the honest way — the
  test was written and run **against the unpatched code first**, and it
  failed exactly as the real bug predicts (2 flags returned instead of
  1), before the `.is()` filter was added.
- Full suite: 892 → 916 passing (24 new), lint clean, build clean.
- Migration `0048` applied to production (`vrwlfcywyfzfczajpdoh`,
  confirmed before pushing; dry-run showed only `0048` pending). Verified
  live: new columns readable; 84 pre-existing open flags unaffected; the
  consistency constraint genuinely rejects an inconsistent write (tried
  setting `retraction_reason` alone on a real row, got a real rejection,
  confirmed the row was unchanged afterward).
- **Ran the real job against production** (`npx tsx
  runScheduledRumourJob.ts`): 13/13 fights clustered via LLM as before
  (unchanged behaviour), then the new retraction pass made exactly one
  real call (confirmed via `llm_call_log`, `status: ok`), proposing 0
  retractions — correct, since nothing in this run's freshly-scraped
  posts contradicted an existing flag. Real prompt size measured:
  165,143 characters in one call (recorded in `PROJECT_FACTS.md` — this
  prompt scales with card size × posts/fight, unlike the bounded
  per-fight clustering prompt, so an unusually large card is worth
  watching).

**Next:** N4 — conflict proposals for the `/conflicts` queue, propose-only,
never auto-apply.

## Phase 85 (N4) — Advisory LLM proposals for Sherdog-match conflicts (2026-09-18)

**What.** `/conflicts` cards for `low_confidence_sherdog_match` now show a
pre-selected suggestion and a plain-language rationale, labeled "advisory
only, not applied." The owner still has to click Confirm — the LLM never
writes `fighters.sherdog_id` itself, the *existing* `resolveSherdogMatchAction`
does, unchanged.

**Scope note, written into `DECISIONS.md`.** The approved plan's own
worked example (Renato Moicano = Sherdog's "Renato Carneiro") is about
Sherdog identity *matching* — linking one fighter row to an external id.
Its literal checks section named `checkMergeGuard`/`decideSameCardMerge`,
which govern a different, higher-stakes action: *merging* two existing
fighter rows via `merge_fighters()`, the exact function Phase M's own
`0045`/`0046` migrations found subtly broken, live, before it ever ran
safely. N4 built only the matching surface. `disputed_opponent`'s merge
path stays manual-only, deliberately, not silently dropped.

**Map — one Lite call per open conflict** (`buildSherdogProposalPrompt.ts`),
genuinely decomposable unlike N3's card-level retraction pass, so this is
`runMapReduce`'s real per-unit shape: each conflict's stored name, why it
was queued, and its ranked Sherdog candidate list (already snapshotted at
detection — no new fetch, no new Sherdog request). **Reduce — a pure
function** (`reconcileSherdogProposals.ts`, test-first, mutation-verified):
`fighters.sherdog_id` is unique, so if two different conflicts propose the
same id, only the first is kept; the LLM never adjudicates this, code
does, cheaply and deterministically.

**Ground-truth checks** (`sherdogProposalChecks.ts`, test-first,
mutation-verified): a cited candidate id must be real for *that specific
conflict's own* candidate list, never merely present somewhere in the
batch — checked and tested explicitly, since two conflicts commonly share
overlapping candidate pools.

**`runMapReduce.ts` gained real per-decision traceability**: `MappedUnit`
now carries `callLogId` (the exact `llm_call_log` row a claim came from,
null on a fallback), threaded through from the reservation. N2's own
tests updated to match — a small, backward-compatible addition to
already-shipped code, not a new file.

New migration `0049_conflict_resolution_proposals.sql`
(`conflict_id`/`proposed_action`/`rationale`/`llm_call_id`, one active
proposal per conflict, same no-client-grant posture as `data_conflicts`
itself). Runs as the **last step** of the existing `sherdog.yml` job —
after `resolveOpenSherdogConflictsJob.ts`'s heuristic sweep — so it only
ever spends a call on the real residual, not a conflict about to be
auto-resolved moments later in the same run. No new cron schedule.

**Deliberately deferred**: `low_confidence_fighter_match` (the
API-Sports analogue of the same candidate-list shape) — same
architecture would extend to it directly, skipped only to keep this pass
to one clearly-verified surface.

**Verified, not assumed:**

- `reconcileSherdogProposals.ts`'s collision check mutation-verified:
  removing it reproduced exactly 3 of 7 failing tests (the ones
  exercising collisions), restored to green.
- `sherdogProposalChecks.ts`'s candidate-reality check mutation-verified:
  weakening it to always pass reproduced exactly 2 of 5 failing tests,
  restored to green.
- Full suite: 916 → 936 passing (20 new), lint clean, build clean.
- Workflow YAML parsed with `js-yaml` to confirm validity and step order
  (the new step genuinely last) before relying on GitHub's own parser to
  catch a mistake.
- Migration `0049` applied to production (`vrwlfcywyfzfczajpdoh`,
  confirmed before pushing; dry-run showed only `0049` pending).
- **Real end-to-end pipeline proof**: with zero real open
  `low_confidence_sherdog_match` conflicts existing right now (M5's own
  sweep already cleared the residual close to zero), a synthetic test
  conflict was inserted, run through the real orchestrator (real
  reservation, real Gemini call, real write) — the model correctly chose
  the exact-name-match candidate over a deliberately-planted decoy,
  `llm_call_id` populated correctly, `reduceMode: "pure"` as designed —
  then the synthetic conflict and its proposal were deleted and
  confirmed gone, zero residue left in production.

**Next:** N5 — a pure refactor exposing `decideInternPick`'s per-signal
breakdown, the prerequisite for N8's shadow-pick comparison being
interpretable at all.

## Phase 86 (N5) — Per-signal breakdown on picks, a pure refactor (2026-09-18)

**What.** `decideInternPick` already computed rumour/Elo/size/age deltas
at its `rawDelta` line; they were only ever concatenated into the
`reasoning` prose column. Now every INTERN pick also stores them
structured in a new `signals jsonb` column
(`0050_pick_signals.sql`) — the raw signed delta each signal contributed
toward fighter1, the pre-clamp raw sum, and the post-`MAX_TOTAL_ADJUSTMENT`
clamped sum. Prerequisite for N8: today there is no way to query "how
much did Elo move this pick," only read a sentence.

**Correctness-critical gate, per `ARCHITECTURE.md` item #2**: a fixture
corpus of 14 cases (every signal alone, every signal in combination, the
combined-cap clamp firing and not firing) snapshotted on the fields the
refactor must not touch — `predictedFighterId`, `estimatedProbability`,
`confidence`, `reasoning`, `marketAnchored` — captured *before* the
refactor, then re-run unmodified *after* it. All 14 stayed bit-identical.
`signals` was deliberately excluded from the snapshot: it's the field
being added, not preserved.

**Live-verified.** Migration `0050` applied to production
(`vrwlfcywyfzfczajpdoh`), read-back confirmed the column exists and
every pre-existing INTERN pick reads `signals: null`. Ran the real
`npm run intern:scheduled-job`: 12/12 fights written, `signals` populated
with real per-signal deltas on production rows (e.g. one pick showing
`elo: 0.15, rumours: 0.02, age: 0.0125`, summed and unclamped at
`rawDelta === clampedDelta === 0.1825`).

`generateInternPicks.ts`'s `isUnchanged` check now also compares
`signals` (treating a pre-migration `null` as "changed," so a re-run
backfills every existing pick exactly once, same as any other genuinely
new value).

## Phase 87 (N6) — Brier scoring, wired into /scoreboard; the promotion rule pre-registered (2026-09-18)

**What.** A new pure `src/lib/scoring/computeBrierScore.ts` — there was
no proper scoring rule anywhere in the repo before this, only accuracy
(right/wrong) and `computeCalibrationBuckets` (banded). Brier score is
what tells apart a pick that called a fight 51% and won from one that
called it 95% and won — accuracy alone can't, and telling those two
apart is the entire point of comparing the deterministic rule against an
LLM-assisted one later (N8). `CalibrationTable.tsx` now shows both
lines' scores (`me`/`intern`) under its title, right above the existing
bucket table — reusing the same scored population and the same
`correct === null` void-filter `computeCalibrationBuckets` already uses,
so there is one definition of "which picks count," not two.

**Test-first, mutation-verified**: 8 tests written and confirmed failing
before the implementation existed (module-not-found), then all passing
against the real implementation. Mutation: inverting the
correct-vs-actual mapping (`e.correct ? 0 : 1` instead of `e.correct ? 1
: 0`) reproduced exactly 4 of 8 failures, confirming the tests actually
exercise the formula's direction and not just its shape.

**The pre-registered promotion rule, written into `DECISIONS.md` now —
before N8 exists — per the plan's own requirement.** Two parts:

1. **Promotion**: `LLM_ASSISTED` and `LLM_ONLY` (N8) are each judged
   independently against the deterministic line. Minimum 10 settled
   cards (reusing the existing `SMALL_SAMPLE_THRESHOLD` from
   `app/scoreboard/page.tsx`, not a second invented threshold) before
   either arm's score is even looked at; the challenger's Brier score
   must then be at least 0.02 lower than deterministic's own, over the
   same scored population. A stated judgment call, not a derived number.
   Any tie, sub-threshold margin, or worse score resolves to
   "deterministic stays" — the rule never has to justify staying, only
   a challenger has to justify replacing it. Promotion itself stays a
   human decision made by reading `/scoreboard`; nothing auto-promotes.
2. **Never backtest the LLM scout over settled historical fights** —
   unlike `predictInternMethod` (leakage-free by construction, a pure
   function that cannot know the future), an LLM asked about a named
   past fight likely has the real result in training data, and a
   historical backtest would return a confident, entirely fake accuracy
   number nothing in lint/tests/build could catch. Forward shadow only.

**Verified.** Typecheck clean, lint clean, full suite 950 → 958 passing
(8 new). Production build (`next build`) compiles the changed page and
component with no new errors. Dev server started and `/scoreboard`
smoke-tested unauthenticated: HTTP 200, correctly hit the existing
sign-in gate, zero server errors in the compile/request log — confirms
the change doesn't crash the route, but this did **not** visually
confirm the actual rendered Brier line behind owner auth (no browser
automation or login credentials available in this environment to get
past the auth gate) — stated honestly rather than claimed.

**Next:** N7 — scouting dossiers (the map step), content-addressed per
fighter.

## Phase 88 (N7) — Scouting dossiers, content-addressed per fighter; a real cross-surface pacing bug found and fixed (2026-09-18)

**What.** One Lite call per fighter on the nearest upcoming card, writing
`fighter_scouting_dossiers` (migration `0051`): `formTrajectory`,
`stylisticProfile`, `durability`, `layoff`, each grounded in a real bundle
(Elo, reach/height, birth date, Sherdog win/loss split by method, last 5
`fighter_sherdog_bouts`, open non-retracted flags) and citing real bout/flag
ids as evidence. N8 (not built) is this table's only planned reader — no UI
yet, same no-client-grant posture as `conflict_resolution_proposals`.

**Content-addressed, the way the whole phase's budget math depends on**:
`computeScoutingInputHash.ts` hashes the ENTIRE `ScoutingFighterBundle`
object canonically, not a hand-picked subset of its fields — this is what
forecloses the plan's own named risk ("cache key omits a field the prompt
uses → stale dossiers served forever, invisibly") *structurally*, not just
by test coverage: `buildScoutingDossierPrompt.ts` can only ever read from
a bundle, and the hash already covers every field of it. Verified anyway
with a mutation test (dropping the `birthDate` line from the rendered
prompt correctly failed the parity check) and an exhaustive per-field
mutation table (14 fields, each proven to change both the hash and the
prompt). `unique (fighter_id, input_hash)` means a genuinely unchanged
fighter costs 0 calls on a re-run — confirmed live, see below.

**Ground-truth checks** (`scoutingDossierChecks.ts`, test-first,
mutation-verified): every cited bout/flag id must be real for *that
specific fighter's own* bundle, never merely present in another fighter's
— drops the whole claim on a fabricated citation (not narrowed), since a
fake citation means the prose reasoning around it may already be
fabricated too.

**A real bug, found live, not in a test.** The first production run wrote
only 4 of 24 needed dossiers — `Degraded: 20 unit(s) denied budget on
map`. Investigation found `runMapReduce.ts` (shipped in N2) had **no
pacing at all**, despite the architecture doc's own stated design
("Minimum 4s between calls, enforced so no caller can forget it") — only
the atomic SQL reservation's interval *denial* existed
(`0047_llm_call_log.sql`), with nothing ever waiting and retrying. N2's
own verification gate said exactly this needed checking at scale ("a
pacer that is wrong is invisible until a card-sized run hits 429s") but
N2/N3/N4's real unit counts (1, 1, ≤10) never fanned out fast enough to
trigger it — N7 (24 units) was the first real stress test this harness
ever got. Fixed in the shared file, not worked around locally: added a
`sleep` dependency to `MapReduceDeps` (real `setTimeout` in
`createMapReduceDeps.ts`, instant in tests), and every reservation
attempt after the first (map or reduce) now waits `MIN_CALL_INTERVAL_MS`
first. Also benefits N3/N4 and any future surface, retroactively, without
their own code changing.

**Verified, not assumed:**

- 4 new test files (35 tests): `parseScoutingDossierResponse`,
  `scoutingDossierChecks` (mutation-verified — weakening the bout-citation
  check to always pass reproduced exactly 2 of 6 failures), and
  `computeScoutingInputHash`'s cache-key/prompt-parity suite (mutation-
  verified as described above).
- `runMapReduce.ts`'s new pacing logic: 4 new tests, mutation-verified
  (forcing `pace()` to never sleep reproduced exactly 3 of 15 failures in
  that file).
- Migration `0051` applied to production (`vrwlfcywyfzfczajpdoh`,
  confirmed before pushing).
- **Real end-to-end proof, twice.** First run (pre-fix): 24 fighters
  needed dossiers, 4 written, 20 correctly fell back and left no partial/
  corrupt row. Second run (post-fix): all 20 remaining written, ~2m55s
  wall time — matching the plan's own "~28-unit pass takes ~2 minutes
  paced" estimate almost exactly, zero degradation. Third run: 0 fighters
  needed a dossier, 0 calls — the cache working exactly as designed.
  Sampled two real written rows: coherent, evidence-grounded prose citing
  real bout/flag ids that passed the ground-truth checks.
- Full suite: 958 → 997 passing (39 new — 35 scouting + 4 pacing), lint
  clean, typecheck clean.
- New GitHub Actions workflow `scouting.yml`, 6-hour cadence matching
  `rumours.yml`'s reasoning (content-addressed, so most runs cost ~0
  calls once a card's roster has current dossiers).

**Scope note.** N7 is the map step only — no "serve a stale dossier on
budget denial" fallback was built, since N8 (the only planned reader) has
no code yet; a fighter with no fresh dossier this run simply keeps
whatever dossier it already had (or none), the same "no evidence, no
write" posture N4 already established. `mapFallback` returns `[]`, matching
N4's own `() => []` for the identical reason.

**Next:** N8 — shadow picks, the reduce step: one call per card (only
when ≥1 dossier changed), emitting bounded signed deltas per named signal
(never a direct probability) plus the model's own unconstrained read —
two shadow lines, `LLM_ASSISTED` and `LLM_ONLY`, from one call.

## Phase 89 (N8) — Shadow picks, the reduce step: two comparison lines from one call, zero new probability math (2026-09-18)

**What.** One Lite call per card, only when ≥1 fighter's N7 dossier
changed since the last run (`fetchShadowPickCard.ts`'s `needsRun` gate).
The model never emits a probability for the assisted line — it proposes
four bounded signed deltas (rumours/elo/size/age, same caps as
`decideInternPick.ts`'s own signals) plus a *separate*, unconstrained
`freeProbabilityFighter1`. `applyShadowPickClaims.ts` is pure code, not a
second model call: it runs the verified deltas through the exact same
`applyProbabilityDelta`/`MAX_TOTAL_ADJUSTMENT` clamp and `confidenceFor`
banding real picks use (the latter newly exported from
`decideInternPick.ts`), so the comparison is over identical math, never a
second invented scale. One claim produces two rows: `LLM_ASSISTED`
(bounded, market-anchored) and `LLM_ONLY` (the model's raw read, clamped
only to strict (0,1)). Written to a new, fully separate `shadow_picks`
table (migration `0052`) — never a third `picks.author` value, which
would have broken the existing check constraint and leaked into
`/scoreboard`'s live boards.

**The map/reduce harness bent to fit, not the other way round.**
`runMapReduce.ts` always calls the model once per map unit; N8 needed the
opposite ratio (one call total, not one per fight). Solved by treating
**the whole card as a single map unit** — `units: [{ eventId }]` — so the
one map-step call covers every fight on the card in one prompt (and gets
the plan's own stated bonus for free: cross-fight consistency reasoning a
per-fight call structurally can't see). `reduceViaLlm: false` then routes
straight to `applyShadowPickClaims` as a pure pass-through, the same
posture N7's own dossier writer already uses for the opposite reason.

**Ground-truth checks** (`shadowPickClaimChecks.ts`, test-first,
mutation-verified): unknown `fightId`; every restated numeric (Elo,
reach, height, age, record, market price) must match the DB exactly, a
hard drop on any mismatch — the cheapest, highest-value check in the
phase, since it catches a model reasoning fluently from a number it
misread; fabricated bout/flag citations; each delta over its own
per-signal cap; the sum over `MAX_TOTAL_ADJUSTMENT`; `freeProbability`
not strictly inside (0,1). `applyShadowPickClaims.ts` re-clamps the delta
sum independently anyway, defense-in-depth, never trusting the verifier
alone.

**Two forks resolved, both logged to `DECISIONS.md`:** the job runs on
its **own cron** (`shadow-picks.yml`, offset from `scouting.yml`),
decoupled on purpose — a scouting failure shouldn't block a
measurement-only surface, and a few hours of dossier staleness changes
nothing about what's being measured. And shadow picks **revise until
card lock, append-only** (mirroring Fork 10's real-pick behavior, not a
one-shot guess) — a later reader (N9) must select the latest row per
`(fight_id, line)` strictly before that fight's lock time, never the
latest row unconditionally, which would leak post-lock information into
what's supposed to be a forward-only measurement.

**Verified, not assumed:**

- 2 new test files (25 tests): `shadowPickClaimChecks` (16 tests,
  mutation-verified — collapsing the sum-over-cap check to always pass
  reproduced exactly the 2 tests that exercise it) and
  `applyShadowPickClaims` (9 tests, mutation-verified — removing the
  delta-sum clamp reproduced exactly the 2 clamp-boundary tests).
- Independent `reviewer` pass (fresh eyes, re-derived the numeric test
  expectations by hand rather than trusting the test file's own
  comments): no findings.
- Migration `0052` applied to production (`vrwlfcywyfzfczajpdoh`, ref
  confirmed before pushing). Read-back note, stated honestly: this
  session's `supabase db query --linked` failed with a stale management-
  API token (401) and a direct `--db-url` connection failed SASL auth —
  both environment/tooling limits, not migration doubt. Verified instead
  via `supabase migration list --linked` (separate command, run after the
  push, independently showing remote `0052` now applied) and
  `supabase db push --linked --dry-run` (connects directly to the
  database, reported "Remote database is up to date" with zero pending
  migrations).
- Full suite: 997 → 1022 passing (25 new), lint clean, typecheck clean,
  production build clean.
- New GitHub Actions workflow `shadow-picks.yml`, cron `"45 */6 * * *"`.
- Module resolution confirmed under `tsx` (ran the real entrypoint; it
  got past every import and failed only on the expected missing-env-var
  error, not a resolution error).

**Scope note, stated honestly.** Unlike N7, this pass did **not** get a
real production run against live data before merge — no local Supabase
service-role credentials were available in this environment to run
`generateShadowPicks` end-to-end, and this session deliberately did not
trigger the new cron job's `workflow_dispatch` unprompted, since that
spends real quota and writes real rows in production. The next session
that has a live upcoming card with N7 dossiers already on it should
trigger `shadow-picks.yml` once via `workflow_dispatch` and read back a
real written row before trusting this surface the way N7 was trusted
after its own first live run.

**Next:** N9 — replay tooling (`npm run llm:replay -- --call-id=`) and
`/scoreboard`'s three-line comparison readout (deterministic,
`LLM_ASSISTED`, `LLM_ONLY`), which is also the first real reader of the
"latest row before lock" selection rule N8's `DECISIONS.md` entries
require.

## Phase 90 (N8 follow-up) — First live `shadow-picks.yml` run finds and fixes a 100% verifier-rejection bug (2026-09-18)

**What.** Triggered `shadow-picks.yml` once via `workflow_dispatch`
against the real nearest-upcoming card (12 eligible fights, all with N7
dossiers) — the live check Phase 89 explicitly deferred. `job_runs`
recorded the run as `ran: true` but `shadowPicksWritten: 0`, with
`degradation.dropReasons: { numeric_mismatch: 12 }` — every single
proposed claim was dropped by `shadowPickClaimChecks.ts`'s numeric-
restatement check, not a partial miss.

**Root cause, confirmed from the stored `llm_call_log.raw_output` for
that call.** `buildShadowPicksPrompt.ts` rendered reach/height as
`${f.reachCm ?? "unknown"}cm` — the unit glued directly onto the number
with no separator — then instructed the model to restate every numeric
fact "EXACTLY as given." The model complied literally and returned
`"193cm"` (and `"unknowncm"` for a null fighter) as JSON string values.
`parseShadowPicksResponse.ts`'s `nullableNumber()` correctly refuses to
coerce a non-number string and returns `null`, which then fails the
verifier's strict `null !== 193` equality check against the real fact.
Since nearly every card has at least one fighter with a known reach or
height, this was a ~100%-reproducible failure mode, not a flaky model
miss — confirmed by inspecting the real prompt/response pair, not
assumed from the drop-reason label alone.

**Fix.** `buildShadowPicksPrompt.ts`: moved the unit into the field
label (`Reach (cm): 193`) instead of suffixing the value, and added an
explicit rule that restated numerics must be bare, unquoted numbers,
with "unknown" restated as JSON `null` rather than the word itself.
Existing 25-test `shadowPicks` suite still green (the bug was in prompt
text, not in `parseShadowPicksResponse.ts`/`shadowPickClaimChecks.ts`
themselves, so no test needed to change) — lint and `tsc --noEmit`
clean.

**Verified live, not just re-read.** Re-triggered `shadow-picks.yml`
against this fix's own branch (`gh workflow run --ref`, so the checkout
ran the fixed prompt, not `main`'s buggy one) before merging. Read back
the real rows with an ad-hoc service-role script (not just the Actions
log line): `job_runs.summary` showed `dropReasons: {}`,
`mapClaimsKept: 12/12`, `shadowPicksWritten: 24`; `shadow_picks` itself
had 24 real rows — one `LLM_ASSISTED` (with a populated `confidence`)
and one `LLM_ONLY` (confidence `null`, as designed) per fight, every
`probability` a sane value strictly inside (0, 1). This is N8's actual
N7-equivalent first live fan-out check, one phase later than planned —
Phase 89 named the gap honestly instead of glossing over it, which is
exactly what let this session close it.

**Lesson for future prompt work in this codebase:** a prompt that asks
a model to restate a human-readable fact "exactly as given" must give
that fact in a form that IS the exact value wanted back — any
formatting glued onto the value (units, punctuation) for readability
will get echoed back verbatim and silently break a strict-equality
verifier downstream. Put units/labels on the field name, never on the
value, in any prompt whose response gets checked by exact restatement.

## Phase 91 — 27 stale `/conflicts` rows traced to one never-cancelled orphan fight; corrected with a guarded data-only migration (2026-09-18)

**What.** The owner flagged the `/conflicts` page: all 27 open
`low_confidence_odds_match` rows were showing the exact same wrong
candidate ("Ramiro Jimenez vs Rodrigo Vera") regardless of which real
odds event each row was for, at wildly different match percentages.

**Root cause.** `features/conflicts/api.ts`'s `resolveLowConfidenceDisplays`
re-ranks each conflict's candidates LIVE against the current unpriced-
fights pool (`fetchUnpricedFights`) every time the page loads — not
against the pool as it existed when the conflict was originally
detected. Fight `4103205b-193a-480b-8e92-f48026a78617` (Ramiro Jimenez
vs Rodrigo Vera, on "UFC Fight Night: Silva vs. Delgado," 2026-09-12)
was the only fight on its 14-fight card still unsettled — every other
bout on the same `event_id` had a real `settled_at` between 2026-09-13
and 2026-09-18. Read back live: `wikipedia_missing_since` was still
null on it, meaning the automatic cancellation pipeline
(`applyCardReconciliation.ts`) never caught it before the event date
passed, and that pipeline refuses by design to touch a past event
afterward (a later Wikipedia page edit trimming an old card's bouts must
never be read as a cancellation). Left permanently "unpriced," it kept
winning as the best-available (still wrong) candidate for every
unrelated low-confidence odds event ranked against it.

This is not a new bug — `0044_cancelled_fights.sql`'s own header
already documents this exact fight and root cause from 2026-09-13's
first occurrence ("Jimenez vs. Vera pulled for a visa issue... the sole
cause of 24 open low_confidence_odds_match conflicts"). That pass fixed
the *general* case in code (excluding settled fights from the candidate
pool); it never corrected *this specific row's* data, so it silently
kept poisoning the pool for five more days until it recurred as a fresh
batch of 27.

**Fix.** `supabase/migrations/0053_cancel_orphaned_jimenez_vera.sql` — a
one-off, data-only migration, not a schema change. Writes the exact
shape `applyCardReconciliation.ts`'s own "cancel" branch already uses
(`settled_at = now()`, `settled_from = 'cancelled'`, `winner_id = null`),
guarded by `where settled_at is null` so it's a no-op if the row somehow
settled through another path first. `fightOutcomeFromSettledFight.ts`
already treats a null winner on a settled fight as void, so the one real
pick sitting on this fight (`d72e22e5-c578-4fc9-aa6b-e4c83657b6ac`)
settles as void, not wrong, on the next `settlePicks` run — no code
change needed for that part.

**Verified live.** Migration applied via `supabase db push --linked`
(project ref `vrwlfcywyfzfczajpdoh`, confirmed against `PROJECT_FACTS.md`
before pushing). Read back: the fight now shows
`settled_at`/`settled_from: 'cancelled'`/`winner_id: null` as written.
`supabase migration list --linked` shows `0053` reconciled
local/remote; `supabase db push --linked --dry-run` reports "Remote
database is up to date." Confirmed the unpriced-fight count dropped by
exactly one (92 → 91), and that zero remaining unpriced fights fall
within ±36h of the stale card's date window — so the 27 conflicts will
now correctly show "no candidate fights" instead of silently offering a
wrong match, the same honest-refusal behavior the rest of this codebase
already commits to elsewhere.

**Open, deliberately not done this pass.** The 27 stale conflicts
themselves are still open rows in `data_conflicts` — there is no
"dismiss, no correct match exists" action anywhere in the conflicts UI,
only "confirm this match," so forcing any of them closed would mean
writing a fabricated price onto the wrong fight. Whether to add a
dismiss action, or an auto-expiry for a low-confidence conflict whose
candidate pool has gone empty, is a real product decision, not something
to invent unilaterally under a bug-fix pass — flagged for the owner
rather than built silently.

## Phase 92 — `low_confidence_odds_match` dismiss action, closing the gap Phase 91 flagged (2026-09-18)

**What.** `resolveLowConfidenceAction`/`buildLowConfidenceResolution`
now accept `chosenFightId: string | null` — `null` means "no candidate
here is actually this odds event," writes only
`{resolved_at, resolution: "no_match"}`, and never touches
`odds_snapshots`. `LowConfidenceCard.tsx` gets a
"No matching fight — dismiss" option in its candidate dropdown, plus (new
UI, no existing sibling to copy) a dismiss button in the
zero-candidates branch, which previously showed only static unresolvable
text with no way to close the row at all.

Mostly not new territory: `resolveFighterMatchAction`/
`resolveSherdogMatchAction` already had this exact "reject every
candidate, still resolve, write `resolution: 'no_match'`" shape for
their own conflict kinds — this change brings the third,
`low_confidence_odds_match`, up to the same pattern rather than
inventing a new one. `DECISIONS.md` records the two forks resolved while
planning it (bulk-cleanup approach for the 27 existing rows; reusing
`"no_match"` rather than a new distinguishing string).

**Verified.** `resolveLowConfidence.test.ts` gets a new case for the
dismiss path. `reviewer` pass (fresh eyes, traced every path by hand):
confirmed a null `chosenFightId` never reaches the fight lookup or the
`odds_snapshots` insert in `actions.ts`, confirmed the sentinel-value
handling is correct in both `LowConfidenceCard.tsx` branches with no
stale-state risk, hand-re-derived the existing tests' price-swap
expectations rather than trusting their comments. Zero findings. Full
suite 1022 → 1023 passing, lint clean, `tsc --noEmit` clean, production
build clean.

**Next:** a guarded, dry-run-first bulk script to dismiss the 27 stale
rows Phase 91 left open (per `DECISIONS.md`'s Fork 1) — its own separate
confirm point before running against production.

## Phase 93 — Bulk-dismissed the 24 stale `low_confidence_odds_match` rows Phase 91/92 left open (2026-09-19)

**What.** `0054_dismiss_stale_odds_conflicts.sql` — data-only, no schema
change. Ran the dry-run Phase 92 deferred: re-ranked all 24 (not 27 —
a few had resolved on their own since Phase 91) still-open
`low_confidence_odds_match` rows live against the current
unpriced-fights pool, confirmed all 24 have zero live candidates, then
resolved exactly that id list with `resolved_at`/`resolution: 'no_match'`
— the same write `resolveLowConfidenceAction`'s new dismiss path takes,
applied in bulk since clicking through 24 identical judgment-free rows
one at a time would be pure toil.

**Correction to Phase 91's own framing.** The dry-run's actual names
showed Phase 91's "regional/other-promotion fighters we don't track"
explanation was only partly right. Most of these 24 are real UFC roster
fighters who WERE on that exact card (Fiorot vs Grasso, Moreno vs
Morales, Cortes-Acosta vs Blaydes, Dan Ige, ...) — their odds-provider
names just had diacritics stripped or fighter order flipped ("Zhu Rong"
vs "Rong Zhu"), which kept them under `AUTO_MATCH_THRESHOLD`, and by the
time anyone would have manually confirmed them, every one of those real
fights had already settled and dropped out of the unpriced pool
(`eligibleUnpricedFights.ts` already treats a settled fight as no
longer needing an odds match, by design). The outcome is identical
either way — no fight to write a price onto — but the migration's own
comment records both real reasons rather than repeating the
incomplete one.

**Verified.** Read back live: `data_conflicts` open-row count dropped
from 29 to 5, and a `kind`-scoped count confirms zero remaining open
`low_confidence_odds_match` rows.

**What's left.** `/conflicts` is not at 0 — 5 `disputed_opponent`
conflicts remain, two detected as recently as 2026-09-18. This is a
genuinely different conflict kind (two data sources disagree about which
bout a fight actually was) requiring the owner's own judgment per row,
not something this pass touched or should auto-resolve.

## Phase 94 — N9: replay + comparison readout, closing Phase N (2026-09-19)

**What.** Two new correctness-critical pure functions, test-first:
`selectLatestBeforeLock.ts` selects the latest `shadow_picks` row per
`(fight_id, line)` created strictly before that fight's INTERN lock
instant (`starts_at - INTERN_LOCK_OFFSET_HOURS`), never leaking
post-lock information into a forward-only measurement; `scoreShadowLines.ts`
scores the selected rows against real settled outcomes — accuracy, Brier,
and (`LLM_ASSISTED` only) units computed through the exact same
`decideInternBet`/`scoreBetPnl`/`priceForFighter` functions real INTERN
picks settle through, never a synthetic flat bet. `LLM_ONLY` gets `units:
null`, not zero — it has no `confidence` for `decideInternBet` to size a
stake from.

`getScoreboardData` (`features/scoreboard/api.ts`) gained
`buildShadowComparison`: excludes cancelled fights and any fight whose
card never got a confirmed `starts_at`, then restricts the deterministic
INTERN line's own accuracy/Brier/units to the EXACT SAME fight population
the two shadow lines were scored over — not the intern's whole settled
history, which would not be apples-to-apples with a comparison that only
exists for fights that ever got a shadow pick at all. New
`ShadowComparisonTable` renders a three-row table (Deterministic /
LLM-assisted / LLM-only) below `PickHistoryTable` on `/scoreboard`, with
a null state and a small-sample notice (reusing the same 10-fight
threshold N6's promotion rule uses).

`buildFightFacts.ts` was extracted from `fetchShadowPickCard.ts`'s own
private fact-building helpers, generalized to take explicit `fightIds` +
a `cardDate` instead of only the nearest-upcoming-card scope —
`fetchShadowPickCard.ts` itself now calls this instead of duplicating the
logic, the exact "one rule, two implementations, only one kept current"
shape `RETROSPECTIVE.md`'s entry #9 warns about, avoided here by
construction rather than by discipline.

New replay CLI (`npm run llm:replay -- --call-id=<uuid>`,
`runLlmReplay.ts` + `replayLlmCall.ts`): re-runs the exact
parse→verify→apply pipeline a live shadow-picks run uses
(`parseShadowPicksResponse` → `verifyClaims`/`shadowPickClaimChecks` →
`applyShadowPickClaims`) over a stored `llm_call_log.raw_output`, with
zero network. Locates the call's fights from the raw output itself
(`extractFightIdsFromRawOutput`, lenient JSON parsing) rather than from
`shadow_picks` rows — the planning audit's own finding that the one call
most worth replaying (a dropped-every-claim run) wrote zero rows there —
with an `--event-id=` fallback for when even that fails. Rebuilds the
original prompt and compares its hash against the stored `prompt_hash`,
reporting a mismatch as "facts (or fight order) drifted," never as proof
of a parser regression on its own.

**Verified.** 1051 tests (135 files, up from 1023) passing, lint clean,
`tsc --noEmit` clean, production build clean. `reviewer` pass (fresh
eyes, ran the real lint/typecheck/test commands, traced every path by
hand): confirmed `selectLatestBeforeLock`'s strict-`<` lock boundary,
confirmed `LLM_ONLY`'s `units: null` is structurally enforced (not just
skipped opportunistically) even inside the shared scoring helper,
confirmed `buildShadowComparison`'s same-population restriction is real
(re-derived from the code, not just the comments), confirmed the
`fetchShadowPickCard.ts` refactor preserved the `needsRun` dossier-
freshness gate exactly. Found and fixed one real bug before shipping: the
replay CLI's `--event-id` fallback could silently override a correctly-
extracted event id when both were present (rather than only firing when
extraction found nothing), which would have paired the real call's fight
ids with a mismatched event's `cardDate` and silently baked wrong ages
into the rebuilt prompt.

**Closes Phase N** (N1-N9, all sub-phases done) — see `ROADMAP.md`.

## Phase 95 — Resolved the three outstanding deferred/not-started items (2026-09-19)

**What.** Three `Explore` agents independently investigated ROADMAP.md's
remaining L3-stance, K1-followup, and L4-fix items to answer: still
needed, or moot? Two got real fixes, one stays deferred with its
investigation recorded so it doesn't need re-deriving next time.

**L4-fix (real, live bug — fixed).** `generateInternPicks.ts`'s
`isLockedError` only checked `err instanceof Error`, but this codebase
never calls `.throwOnError()` on a Supabase query, so a failed
`.upsert()` throws PostgREST's own plain `{message, code, details,
hint}` object, never a real `Error` — confirmed by reading the installed
`@supabase/postgrest-js` source. Every upsert failure, locked or not,
was therefore miscounted as `failed` instead of `skippedLocked`. Fixed
to read `.message` off any object that has one. Also moved
`summary.betsPlaced++` to after a confirmed successful write — it
previously incremented unconditionally right after `decideInternBet`,
over-reporting bets on a run that failed or hit the lock. New
`generateInternPicks.test.ts` (there was none before) exercises the real
plain-object failure shape.

**K1-followup (split verdict).** Confirmed the original K1 skip
condition (a duplicate-event cluster blocked by FK-referencing rows) has
fired exactly once, ever, before the `merged_into` filter existed, and
never since — the `/conflicts`-queue UI surfacing the original note
gestured at stays shelved, no evidence it's needed. But the
investigation found `runScheduleSync` (`syncSchedule.ts`) was the one
scheduled job never wrapped in `runWithTracking` — it wrote zero
`job_runs` rows at all, skip or no skip, unlike every other scheduled
job (odds, rumours, intern). Fixed cheaply, no schema: `runScheduleSync`
now takes `supabase` and returns a `ScheduleSyncSummary` (including full
`mergeSkipped` detail), with a `main()` wrapping it in
`runWithTracking(supabase, "sync_schedule", ...)` — the same shape every
other scheduled job already uses.

**L3-stance (still deferred, correctly).** Real settled-pick volume is
still nowhere near enough to check for a real stance-matchup direction —
since the intern was scoped to nearest-card-only (Phase L1), only one
card has settled (~14 picks), an order of magnitude below the app's own
`SMALL_SAMPLE_THRESHOLD = 10` cards. No code change.
`describeStanceMatchup.ts` stays display-only. Recorded in
`PROJECT_FACTS.md`/`ROADMAP.md` exactly how to build the breakdown
cheaply (reusing `computeCalibrationBuckets.ts`'s bucket pattern) once
≥10 cards have settled, so the next session doesn't re-derive this.

**Verified.** 1056 tests (136 files, up from 1051) passing, lint clean,
`tsc --noEmit` clean, production build clean.

## Phase 96 — Fixed HTML entities leaking into fighter names at the ingestion boundary (2026-09-20)

**What.** A user spotted "Casey O&#x27;Neill" rendered literally on
`/scoreboard`'s intern-picks table (`RETROSPECTIVE.md` entry #9 had
already named this bug class the day before, but no code fix had landed
for it yet — only three known rows were hand-fixed live). Root cause:
three separate hand-rolled Sherdog HTML-decoders
(`parseFighterPage.ts`, `parseFightHistory.ts`, `parseSearch.ts`) each
only matched the DECIMAL numeric-entity form of an apostrophe
(`&#39;`/`&#039;`), never the HEX form (`&#x27;`) Sherdog also emits.

New shared `decodeHtmlEntities.ts` (`src/lib/text/`) — a single-regex-
pass decoder (numeric decimal, numeric hex, and the 6 basic named
entities), safe against double-decoding an already-escaped entity and
against throwing on a lone UTF-16 surrogate code point. Wired into
`upsertFighter.ts`'s single choke point: `fighter.name` is decoded once,
before every read (the exact-match query, the alias fold-match, the
`namesLikelySamePerson` fold scan) and write (insert/update) in that
function, not just before the final insert. All three Sherdog parsers
now delegate to it instead of their own incomplete regex.

New guarded one-time backfill, `npm run fighters:fix-name-entities`
(`--dry-run` by default, matching this project's own bulk-mutation
convention): `planFighterNameEntityFixes.ts` (pure) flags any fighter
whose name decodes to something different, and separately flags a
collision when renaming would produce a duplicate of another existing
row's name — that pair is reported for a manual `merge_fighters()`
review, never silently renamed. Ran live: 837 fighters read, exactly the
one known-polluted row found, 0 collisions, renamed.

**Verified.** `reviewer` pass on the backfill script caught a real gap
before it shipped: the collision check compared a candidate's decoded
name against every OTHER row's *raw* name, which would miss two
still-polluted duplicates that decode to the same name via different
encodings (hex vs. decimal apostrophe for the same person) — fixed to
compare decoded-vs-decoded throughout, with a regression test for that
exact shape. 1076 tests (138 files, up from 1056) passing, lint clean,
`tsc --noEmit` clean, production build clean. Dry-run re-confirmed
0 polluted names remain after the live write.

## Phase 97 (Multi-free-LLM plan, Phase 2 / Track A) — Groq second opinion on Sherdog-identity proposals, advisory only (2026-09-20)

**What.** N4 (Phase 85) already proposes a Sherdog-identity match for
every open `low_confidence_sherdog_match` conflict via Gemini, advisory
only. This adds an independent second read from Groq on the same
evidence, for any conflict that already has a live primary proposal —
never ahead of it (`DECISIONS.md`, 2026-09-20) — and shows a human
reviewer on `/conflicts` whether the two agree or disagree, alongside
the second model's own rationale. Nothing is auto-applied; Confirm still
requires the owner's click, unchanged.

New `compareProposalAgreement.ts` (pure, test-first: 5/5 exact-value
cases covering the full reachable space of two nullable ids compared for
equality). New `fetchSherdogConflictsWithPrimaryProposal.ts` (inner-join
filtered to conflicts with a live, unaccepted/unrejected primary
proposal) and `proposeSherdogMatchesSecondOpinion.ts`, reusing N4's
existing prompt/parser/ground-truth-checks unchanged — only the model
backend (Groq via `createGroqMapReduceDeps`) differs. Its reduce step is
a plain pass-through, not `reconcileSherdogProposals.ts`'s uniqueness
check: a second opinion never writes `fighters.sherdog_id`, so there's
no cross-claim collision to resolve. New migration `0060_conflict_
resolution_second_opinion.sql` extends `conflict_resolution_proposals`
with `second_opinion_action`/`second_opinion_rationale`/
`second_opinion_llm_call_id` — not yet applied to production.

Scheduled as a new step in `sherdog.yml`, immediately after N4's own
step, and a new `npm run conflicts:propose-sherdog-matches-second-
opinion` script for local runs.

**Verified.** `reviewer` pass confirmed the Supabase inner-join/filter
syntax is correct and can't fan out into duplicate rows
(`conflict_resolution_proposals.conflict_id` is unique), the `.update()`
write is safe given the fetch step's own guarantee, and all five
reachable input combinations to `compareProposalAgreement` are tested.
One pre-existing, non-blocking race noted (shared with N4, not new
here): the write doesn't re-check `accepted_at`/`rejected_at` immediately
before writing, so a proposal accepted mid-job could get a wasted second
opinion written onto it — invisible to the reviewer, since the display
query already filters resolved proposals out. 1094/1094 tests passing,
lint clean, `tsc --noEmit` clean, production build clean.

**Follow-up, same day:** migration `0060` applied to production
(`vrwlfcywyfzfczajpdoh`, verified via `supabase migration list --linked`)
and `GROQ_API_KEY` added as a GitHub Actions secret — the new
`sherdog.yml` step can now run for real. `.env.local.example` still
doesn't document `GROQ_API_KEY`/`OPENROUTER_API_KEY` (Phase 1's original
gap, still open).

## Phase 98 (Multi-free-LLM plan, Phase O3 / Track B) — Groq shadow-pick ensemble, one call per fight (2026-09-20)

**What.** N8 (Phases 89-90) already runs Gemini's shadow-picks pipeline —
one whole-card call producing forward-only, measurement-only
`LLM_ASSISTED`/`LLM_ONLY` predictions that never touch a real bet. This
adds Groq as a second, independent provider. A live spike
(`PROJECT_FACTS.md`, 2026-09-20) confirmed Groq's 8000 TPM free tier
can't fit a whole-card prompt but easily fits a single-fight one (~2100
tokens measured, ~4x headroom), so Groq runs one call PER FIGHT
(~11-14/card), reusing `buildShadowPicksPrompt.ts` unchanged with a
length-1 array — its response shape already tolerates any length.

New `generateShadowPicksGroq.ts` + `runScheduledShadowPicksGroqJob.ts`
(`job_runs: "shadow_picks_groq"`), a separate job from Gemini's on
purpose (`DECISIONS.md`, 2026-09-20), added as a second step in
`shadow-picks.yml`. New migration `0061_shadow_picks_provider.sql` adds
`shadow_picks.provider` — not yet applied to production.

**Found and fixed while planning, not yet in production:** N9's
`selectLatestBeforeLock.ts` deduped shadow-pick rows by `fightId:line`
only. Once a second provider writes rows, two providers' rows for the
same fight/line would collide and one would silently vanish from
scoring, with no error. Fixed test-first — a new test proving two
providers' rows for the same fight/line no longer collide, confirmed to
fail against the old two-field key before the fix. `fetchShadowPickCard`'s
rerun gate is now also provider-scoped (each provider's own last write,
never another provider's), and `applyShadowPickClaims` takes an explicit
`provider` argument rather than inferring it.

`/scoreboard`'s `ShadowComparisonTable` now shows a row pair per
provider present (`features/scoreboard/api.ts` calls `scoreShadowLines`
once per provider rather than reshaping it — each provider's rows are
already at most one-per-fight-per-line coming out of the fixed dedup
function, so no internal change to `scoreShadowLines` was needed).

**Verified.** `reviewer` pass confirmed the dedup-bug diagnosis and fix
are correct, found no other place in the codebase with the same latent
`(fightId, line)`-only assumption, confirmed the per-fight map spec's
failure isolation is real and intentional (one fight's map failure drops
only that fight for Groq, vs. the whole card for Gemini's single-unit
spec), and confirmed migration 0061's DDL is correct. One non-blocking
nuance noted and documented inline: `scoredFightCount` on the scoreboard
is a union across providers, not per-provider — a display detail, not a
correctness issue, since each provider's own accuracy/brier stays scoped
correctly. 1097/1097 tests passing, lint clean, `tsc --noEmit` clean,
production build clean.

**Follow-up, same day:** migration `0061` applied to production
(`vrwlfcywyfzfczajpdoh`, verified via `supabase migration list --linked`).
`llm:replay` stays deliberately Gemini-scoped this pass (a `--provider`
flag is a clean, small later add).

## Phase 99 (ROADMAP_V2.md P8) — the daily integrity sweep (2026-09-20)

**What.** Phase P's Tier 1/2 fixes (P0-P7) repaired the existing conflict
queue and prevented the next fighter from ingesting the same way broken —
but left nothing checking that either stays true, the exact gap that let
19 bad conflict rows and a stuck fight accumulate silently across days of
green CI in the first place. P8 is a new daily job asserting six
invariants (I1-I6, `ROADMAP_V2.md`), in three shapes rather than one
(`DECISIONS.md`, 2026-09-20):

- **I1** (two fighter rows fold to the same person under the existing
  structural rules, `namesLikelySamePerson.ts`, walked over the WHOLE
  `fighters` table for the first time) opens a real `data_conflicts` row
  — new kind `structural_duplicate_fighters`, review card, merge action,
  same pattern P6's `sherdog_id_collision` established.
- **I4** (a `low_confidence_odds_match` whose candidate fight is already
  priced) and **I6** (two open conflicts pointing at the same bout) are
  auto-remediated directly — no row, no owner action. I4 reuses the
  existing `selectStaleLowConfidenceConflictIds` as a safety net for
  `matchAndSnapshot.ts`'s own instance of the same check.
- **I2** (fighter on an upcoming card missing a Sherdog check), **I3**
  (fight past its T-12h window, unpriced, and not already covered by any
  open conflict), and **I5** (conflict open >7 days) open/self-close a
  new, visibility-only `integrity_alerts` row (migration `0063`, RLS
  enabled, no policies, partial unique index on `(invariant, dedupe_key)
  where resolved_at is null`) — nothing to resolve, so no action UI.
  Surfacing these is deferred to P9's job-health panel.

New `src/lib/integrity/` folder: one pure detection function per
invariant (each with a seeded-violation + clean-data test pair), an
orchestrator (`runIntegritySweepJob.ts`) wiring them against real reads
(`selectAllPages`/`selectAllPagesByIds` throughout — no raw `.select()`),
and a `runWithTracking`-wrapped entry point (`job_runs: "integrity_sweep"`).
New `.github/workflows/integrity.yml`, its own daily cron and its own
concurrency group (not the shared `ufc-data-write` one — this job never
touches `fighters`/`fights`/`events`).

**Real bug caught by the mandatory `reviewer` pass, fixed before ship:**
I1's dedupe guard only checked for an *open* row before deciding whether
to insert a new conflict. Since I1 re-scans the whole `fighters` table
every run, an owner resolving a pair as `not_same_person` would see it
reopen on the very next sweep — the original test suite only covered
"doesn't stack while still open," not "stays resolved after resolution."
Fixed by widening the guard to check for any existing row for the pair,
open or resolved; regression test added. The same pass also moved
`diffAlerts`'s own read of `integrity_alerts` onto `selectAllPages` (was
a raw `.select()`, low risk at today's row count but the same shape of
bug M1 found once already) and added the workflow's concurrency group
(a manual `workflow_dispatch` overlapping the scheduled run could
otherwise crash the job on the new unique index).

**Verified.** 1150/1150 tests passing (25 new), lint clean, `tsc --noEmit`
clean, production build clean, route table unchanged. Migration `0063`
not yet applied to production.

## Phase 100 — the underdog floor: at least one underdog pick/bet per card segment (2026-09-21)

**What.** User-observed pattern, checked against real cards: a full
favourites sweep essentially never happens — nearly every card has at
least one underdog win in the main card and at least one in the
prelims. `decideInternPick.ts` picks purely per-fight with no view of
the rest of the card, so nothing stopped it from doing exactly that.

Two new pure, tested modules in `src/lib/intern/`:

- **`segmentCard.ts`** — splits a card into `main` (the 5 fights with the
  lowest `bout_order`, 0 being the main event) and `prelims` (everything
  else, including fights with no `bout_order` at all — they sort last
  and land in prelims rather than being excluded).
- **`applyUnderdogFloor.ts`** — runs on the whole card's picks/bets after
  `decideInternPick`/`decideInternBet` have already formed their honest,
  per-fight opinions. Per segment, independently: if every pick favours
  the market favourite, flips the one with the biggest underdog price
  (most plus-money) to the underdog; separately, if every *bet* INTERN
  already placed in that segment backs the favourite, redirects the one
  with the biggest underdog price onto the underdog, keeping the same
  stake. Never invents a bet where INTERN saw no edge at all — only
  redirects one it was already placing. "Favourite"/"underdog" is a
  market concept (`determineFavorite.ts`'s own definition), not the
  model's probability.

`decideInternPick.ts`/`decideInternBet.ts` are untouched — the floor is
a distinct, visible override layer applied afterward in
`generateInternPicks.ts`, which changed from a single decide-and-write
loop per fight to two phases: decide every fight first (nothing
written), apply the floor across the full card, then write the final
(possibly overridden) pick/bet, with `predictInternMethod` recomputed
against the FINAL picked fighter and a "Card-sweep rule: ..." sentence
appended to `reasoning` whenever either floor fires. See DECISIONS.md
(2026-09-21) for why this sits outside the otherwise-honest model layer.

**Verified.** 1174/1174 tests passing (15 new, table-driven), including
`decideInternPick.characterization.test.ts`'s snapshot unchanged —
confirming the model's own output was genuinely never touched. Lint
clean, `tsc --noEmit` clean, production build clean.

## Phase 101 (ROADMAP_V2.md Phase Q / Q1+Q2) — the betting journal: slips, legs, bankroll, and settlement (2026-09-21)

**What.** The app modelled a bet as one optional moneyline wager welded to
one pick on one fight, capped at 3u. The owner actually bets a portfolio of
slips per card — singles, accumulators, method-of-victory, double-chance,
₱74 to ₱500 a ticket. `picks` cannot express that and was left untouched.

**Q1, migration `0064`:** `bankroll_ledger` (signed movements; balance is
always derived by summing, never stored), `bet_slips` (one row per ticket,
`bookmaker_bet_id unique` as an idempotency key, `pnl_php`/`pnl_units` as
**generated columns** so payout and P&L cannot drift apart), and `bet_legs`
(one row per leg — a single is just a one-leg slip, so nothing downstream
needs a special case). RLS mirrors `picks`, with two deliberate departures:
a DELETE policy exists (a mis-typed slip must be removable, which `picks`
has no path for), and there is **no pick-lock** (a slip records a wager
already placed; backfilling history is the point).

**Q2, the settlement engine:** `normalizeFightMethod` (free-text Wikipedia
prose → a settleable method), `settleLeg` (moneyline, double-chance, and
both method shapes), `settleSlip` (roll-up, dead-on-first-loss, void-leg
repricing).

**Six things the owner's 16 real tickets forced, that a guess would have
got wrong:**

- His book prices markets The Odds API does not serve, so method bets run
  on **his entered price** — Phase R demoted to optional reference data.
- A leg is not always a UFC fight: one accumulator parlays a **US Open
  tennis set** with a UFC moneyline. `fight_id` is nullable.
- `How The Bout Will Be Won` names no fighter while `W1 By KO/TKO` does —
  two distinct markets, not one enum value.
- A ticket showing combined odds `4.475` paid **₱447.55** on ₱100, the
  full-precision `1.68 × 2.664`. Payouts come from leg prices, never from
  the displayed combined odds.
- **158 settled fights carry `method = null`** (API-Sports reports none),
  so a method leg on those returns `undetermined` rather than a guess.
- Draws and no-contests must be told apart: `"Draw (majority)"` *pays* a
  Double Chance leg, `"NC (accidental eye poke)"` voids it. The parser
  matches the leading token only, since `"Decision (majority)"` shares the
  word "majority".

**Verified.** 1237/1237 tests passing (63 new), written test-first and
confirmed RED (`Cannot find module`) before any implementation existed.
**All 16 real tickets reproduce their printed payout to the centavo**, and
the portfolio reconciles to ₱3,378.49 staked / ₱7,175.21 returned /
**+₱3,796.72 net**. Lint clean, `tsc --noEmit` clean. Migration `0064`
applied to `vrwlfcywyfzfczajpdoh` and verified by read-back (3 tables, RLS
on all, generated columns confirmed `ALWAYS` with the expected
expressions), `migration list --linked` reconciled to `0064` local+remote.

**Not yet done:** Q3 (backfill) needs owner confirmation on three legs cut
off in the screenshots — their prices are derivable from the product rule
(2.15 Sola, 1.23 Martinez, 2.17 Elliott) but market and selection are not.

## Phase 102 (ROADMAP_V2.md Phase Q / Q3) — backfilled the 16 real tickets; fixed a recurring role-check bug (2026-09-21)

**What.** The 16 real bet slips are now recorded as `bet_slips`/`bet_legs`
rows: 16 slips, 25 legs. Every fighter was resolved by NAME against a live
query of the three real events, never by position — one ticket
("Marquel Mederos vs Mason Jones", backing W1) stores its two fighters in
the OPPOSITE order from the database's `fighter1`/`fighter2`, which a
positional mapping would have silently gotten backwards.

Three legs, cut off mid-screenshot, are recorded as `market = 'OTHER'`
with a derived price and an honest "not legible" description rather than
a guessed selection — each sits on a slip whose money outcome is already
fully determined by its other legs (one already won with its payout
already a fact; two already lost), so nothing about the bankroll numbers
depends on knowing them.

**User-confirmed scope change:** these 16 tickets are reference material
for the archetype/INTERN comparison, not live bankroll history — they
predate the journal existing. Slips and legs are written with their
printed status/payout so `settleSlip`'s own math stays checkable against
them, but **no `bankroll_ledger` row is written per slip**. The bankroll
starts at a flat ₱10,000 opening deposit and will only move from bets
recorded going forward.

**A real bug, caught before it could write anything wrong.** `0064`'s two
new trigger functions gated settlement writes with
`current_user = 'service_role'` — copied from `0022_dual_settlement.sql`'s
ORIGINAL text. That check can never be true:
`current_user` inside a `SECURITY DEFINER` function reflects the function
OWNER (`postgres`), not the caller. `0023_fix_settlement_role_check.sql`
already discovered and fixed this exact bug, live, for `picks` — using
`current_setting('role', true)` instead. Reading `0022`'s file directly
rather than the live, corrected function reintroduced the bug it already
fixed. Caught by a throwaway `SECURITY DEFINER` RPC (created, called via
the real service-role client, dropped) that reproduced the failure
directly before the real backfill wrote anything; `0065` reapplies `0023`'s
fix to the two new trigger functions. Re-verified post-fix the same way.
See `DECISIONS.md` for the generalized lesson (an early migration's
comments describe that migration's state, not necessarily the current
one).

**Verified.** 1237/1237 tests still passing, lint clean, `tsc --noEmit`
clean. Post-backfill read-back against production: 16 slips, 25 legs,
exactly 1 `bankroll_ledger` row (the ₱10,000 opening deposit, balance
confirmed `10000.00`), and `bet_slips.pnl_php`'s generated columns
independently sum to +₱3,796.72 on ₱3,378.49 staked — matching the
backfill script's own reconciliation, computed by Postgres rather than
trusted from the script. `migration list --linked` reconciled through
`0065` local+remote.
