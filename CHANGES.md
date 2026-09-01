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
