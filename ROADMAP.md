# Roadmap — v2

**Written:** 2026-08-29, after `app-architect`, `harness-setup`, and
`user-flow-mapper`.

**Sources:** [docs/PRD.md](docs/PRD.md) (product truth, MoSCoW),
[ARCHITECTURE.md](ARCHITECTURE.md) (10 resolved forks as of G1, 9
correctness-critical items as of F2, item #4 extended in G1), [docs/user-flows.md](docs/user-flows.md)
(screens and ordering constraints).

**How to use this file.** One sub-phase is one `feature-planner` pass. Kick
one off by naming it. When `feature-planner` logs a completed feature to
`CHANGES.md`, mark the matching row **done** here — the two files track the
same progress from opposite ends and must not drift apart.

**Status legend:** `not started` · `in progress` · `done`

⚠️ marks **correctness-critical** work: the failing test gets written *before*
the implementation, and "done" means the test was run and observed passing —
never "this should pass now."

---

## Ordering constraints these phases obey

Not preferences. Each comes from `docs/user-flows.md` or a verified fact.

1. **`events.starts_at` and `fights.bout_order` precede every screen** — the
   card view cannot order bouts and the pick lock cannot exist without them.
2. **`starts_at` comes from the odds feed, not the fight feed.** Verified
   2026-08-29: Wikipedia's UFC infobox carries `{{start date|Y|M|D}}` with
   **no time**, so neither existing source can populate a `timestamptz`. The
   Odds API's `commence_time` can. This is why A adds the column and B fills
   it, and why the Phase C pick lock genuinely depends on Phase B.
3. **The allowlist precedes any write surface** — shipping pick controls first
   leaves a window where strangers can write.
4. **Conflict detection precedes picking** — otherwise the earliest cards can
   take real stakes on phantom bouts, the exact corruption the policy exists
   to prevent.
5. **The odds snapshot precedes the expanded bet row**, which is built around
   implied probability and live edge.
6. **Settlement precedes the scoreboard** — both boards are empty without it.
7. **The rumour engine (F) is independent.** UC-1 has standalone value with no
   odds and no picks, so F may move earlier if scouting matters more than the
   scoreboard.

---

## Phase A — Foundations and data integrity

| # | Sub-phase | Status |
|---|---|---|
| A1 | Add `events.starts_at` (nullable), `fights.bout_order`, and the missing FK indexes; populate `bout_order` from the Wikipedia sync | **done** (2026-09-01, migration applied live) |
| A2 | ⚠️ Disputed-opponent detection in `upsertFight` (the `data_conflicts` table itself was created in B3, ahead of schedule — B3 needed it too. A2 is now just the detection logic, writing into a table that already exists) | **done** (2026-09-01) |
| A3 | ⚠️ Owner allowlist — `lib/auth.ts` wrapper, enforced in RLS and not only in the UI | **done** (2026-09-01) — applied and verified live, `All RLS checks passed.` |

**A1 note.** `bout_order` is nearly free — `fetchSchedule.ts` already walks
Wikipedia's `{{MMAevent bout}}` templates in document order and discards the
ordering. `starts_at` is added nullable here and stays empty until B4.

**A3 note.** A UI-only allowlist is the "never trust the client" failure — a
stranger could still write via a direct request. The check belongs in the
`picks` policies, not just the page.

**A2 result.** The decision logic (`sharesExactlyOneFighter.ts`) was
extracted as a pure, separately-tested function rather than inlined into
`upsertFight.ts` — 5 tests, including the real Phase 7 case, mutation-
verified. `upsertFight`'s return type changed to a discriminated union
(`upserted` / `conflict`) since a conflict produces no new fight row; safe,
since neither `syncJob.ts` nor `syncSchedule.ts` used the returned id. A
repeat sync finding the same ongoing dispute reuses the existing open
`data_conflicts` row instead of piling up duplicates on every twice-daily
run. The second half of correctness item #7 — the pick-lock trigger
actually rejecting a fight with an open conflict — is C1's job.

**A3 result.** One `as restrictive` RLS policy per writable v1 table
(`clans`, `clan_members`, `clan_invites`, `scouting_reports`,
`report_clan_shares`, `fighter_scouting_reports`,
`fighter_report_clan_shares`), rather than rewriting the many existing
permissive ones — restrictive policies AND on top instead of needing to
touch anything already there. `accept_clan_invite` needed a second,
different fix: it's `SECURITY DEFINER`, so the restrictive policy doesn't
reach its internal insert (same class of gap as `odds_snapshots`'
original immutability mistake) — fixed with an explicit `is_owner()`
guard inside the function. `lib/auth.ts` (`isOwner()`) is UX only; the
real boundary is `is_owner()` in Postgres. See `ARCHITECTURE.md` Fork 8.

**Applied and verified live, 2026-09-01 (Phases 24–25)**, via the new CLI
workflow — owner id substituted locally, pushed, reverted before commit,
never in git. Check 3 in `rls.sql` (a pre-A3 multi-user visibility test)
retired — categorically unreachable now, not a regression. Check 14 had a
real, narrow bug in its own shape (a `DO`-wrapped INSERT, run right after
check 13's caught exception, failed intermittently through `db query -f`)
— fixed by dropping the unnecessary `DO` block, not by giving up on the
tool. The complete file — `supabase db query --linked -f
supabase/tests/rls.sql` — then returned `All RLS checks passed.` for
real, checks 1–16. Full diagnostic trail in `PROJECT_FACTS.md`.

---

## Phase B — Odds spine

The heaviest phase, and unavoidable: everything downstream prices against it,
and it now also owns `starts_at`.

| # | Sub-phase | Status |
|---|---|---|
| B1 | Verification spike — does 1xBet actually return MMA, real free-tier limits, `commence_time` shape, and a named fallback bookmaker | **done** (2026-09-01) |
| B2 | ⚠️ `odds_snapshots` table, immutable via a trigger (not absent policy — corrected, see below) | **done** (2026-09-01) |
| B3 | ⚠️ Odds client + fuzzy fight matcher, scoped to a window around the known card date; low-confidence matches open a `data_conflicts` row instead of guessing; client keeps the two fighter outcomes and discards `Draw` | **done** (2026-09-01) |
| B4 | Daily discovery pull populating `events.starts_at` from `commence_time` | **done** (2026-09-01) |
| B5 | T-12h snapshot job (GitHub Actions) + `job_runs` + loud degraded banner | **done** (2026-09-01) |
| B6 | `/conflicts` screen — resolves both conflict types, so blockers can be cleared before picking begins | **done** (2026-09-01) |

**B1 result:** 1xBet returns real MMA prices — confirmed against a live
response matching a real UFC 331 pairing, cross-checked against the
independently-sourced Wikipedia date. No fallback bookmaker needed. One
correction came out of it: MMA `h2h` on 1xBet is **three-outcome** (Fighter A,
Fighter B, `Draw`), not two as first assumed — see `PROJECT_FACTS.md` and
`ARCHITECTURE.md` Fork 7. B3 carries the resulting parsing requirement and a
new note: the odds feed lists rumoured future matchups (the same fighter
against different opponents on one date), so matching must be scoped to a
window around a known card rather than a blind name search.

**B2 result.** ARCHITECTURE.md originally specified immutability via absent
UPDATE/DELETE policy — checked before implementing and found insufficient:
`service_role` bypasses RLS and is granted UPDATE/DELETE on every table by
default, so an absent policy protects against nothing once the sync job
itself runs. Corrected to a trigger (same mechanism as the pick lock),
verified live: `service_role` UPDATE/DELETE both rejected by the trigger
specifically, a second insert for an already-snapshotted fight rejected by
the unique constraint (`supabase/tests/rls.sql` checks 7–12). Also found:
the Supabase CLI's migration tracking is unsynced with the live database —
`db push` is unsafe until deliberately reconciled — so this and every prior
migration went in through the Dashboard SQL Editor by hand. See
`PROJECT_FACTS.md`.

**B3 result.** Built `lib/odds/{client,similarity,parseOutcomes,matchFights,
matchAndSnapshot}.ts`, 30 Vitest tests, all correctness-critical pieces
test-first. The `data_conflicts` table (originally A2's job) was created
here instead, since B3 needed it too and Fork 5 already fully specified its
shape — A2's remaining scope is just the `upsertFight.ts` detection logic.
`matchAndSnapshot.ts` (the write-glue) exists and is reviewable but has
**not** been run against production — deliberately, since a premature write
against the wrong fights can't be undone given `odds_snapshots`'
immutability. Its first real run belongs to B5 or an explicit confirmed
dry-run. Also moved `getSupabaseAdmin` from `lib/ufc-data-sync/
supabaseAdmin.ts` to `lib/supabase/admin.ts` — it was never sync-specific,
and `lib/odds/` needed the same client rather than a second copy.

**Bookmaker switched, 2026-09-01 (Phase 20), after B3 shipped.** A user
question about adding DWCS ("Dana White's Contender Series") prompted a
proper live check rather than an assumption. The first DWCS check (wrong
week, wrong bookmaker only) found nothing; rechecked properly, DWCS is
priced by several bookmakers — just not 1xBet. `betonlineag` covers 89% of
the feed (vs 1xBet's 54%) and is the only book checked that prices both
UFC and DWCS. `client.ts`/`parseOutcomes.ts` updated; test fixtures rebuilt
from real BetOnline.ag payloads; the Draw-discard mutation test re-verified
against the new bookmaker key. See `ARCHITECTURE.md` Fork 7,
`PROJECT_FACTS.md`.

**DWCS ingestion itself is still an open, unscoped question** — the odds
half is resolved, but Wikipedia's DWCS pages are structured completely
differently from UFC event pages (one page per season, plain-text dates,
not category-tracked), and that cost is unchanged by the bookmaker switch.
Not added to this roadmap as a sub-phase yet; would need its own scoping
pass if pursued.

**B4 result.** Reused B3's matching rather than inventing new logic:
`matchFights.ts` gained `scoreOddsEventMatch` — the inverse direction of
B3's `scoreFightMatch` (given one fight, find its best odds event, rather
than given one odds event, find its best fight) — sharing the same
name-similarity scoring via an extracted `fightNameSimilarity` helper, a
pure refactor that left every existing test passing unchanged. New pure
function `earliestConfirmedStartTime` (`discoverStartTimes.ts`) picks the
earliest **confidently-matched** fight's `commence_time` per card — not
the main event's own time, since prelims start hours earlier and that's
what "the card has started" means for the pick lock. Confidence-threshold
filtering mutation-tested: removing it broke exactly the two tests built
to catch that. Unlike `odds_snapshots`, this **overwrites on every run**
rather than write-once — cheap to correct if wrong, and needed for the
PRD's postponement-recompute case. Runnable via `npm run
odds:discover-start-times` (`runDiscoverStartTimes.ts`, matching the
existing `sync:*` script convention) — not yet wired to a schedule, that's
B5.

**Run live, with explicit confirmation first** (a different category of
action from the migrations already approved — real application code
against production, not schema DDL): found a real bug on the very first
invocation. `client.ts`'s `fetchMmaOdds()` had never actually been called
end-to-end before this moment — B1's verification was raw `curl`, B3's
tests only covered the pure matching logic. `new URL(path, base)` treats
a leading `/` in `path` as absolute-from-origin, silently dropping
`BASE_URL`'s own `/v4` instead of appending to it — every real request
was 404ing. Fixed with a single-argument `new URL(fullString)`, which has
no base to resolve against and so nothing to drop; added `buildOddsUrl`
as a pure, tested function precisely because this class of bug hides
until the untested boundary is actually exercised. Mutation-verified:
reverting to the broken form failed exactly the new test built to catch
it.

**Real result, verified by querying the actual data, not trusting the
summary line:** 6 real upcoming events updated, 3 left `null` (further
out, no confident odds match yet — expected). UFC 331 shows
`2026-09-20T00:00:00Z`, earlier than its own main event's
`2026-09-20T04:00:00Z` — confirmation on real data that this correctly
picks up the card's earliest confident fight, not the main event's own
time.

**B5 note.** A missed snapshot silently voids a whole card's scoreboard, which
the PRD calls the single highest-impact failure in the system. It must alert
loudly and offer a manual late pull at the worse price.

**B5 result.** Cadence: every 2h (user-confirmed choice, over 1h/4h
alternatives), one shared `fetchMmaOdds()` call per run feeding both
tracked jobs rather than two separate fetches — ~360 credits/month against
the documented ~500/month budget, a real constraint the original "one pull
per card" framing hadn't accounted for once this became a poll loop rather
than a single precise trigger.

New pieces:
- `lib/odds/snapshotWindow.ts`'s `isPastSnapshotWindow` — the T-12h gate
  `matchAndSnapshot` was missing since B3 (item #5 above). Test-first,
  mutation-verified at the boundary and the null-`starts_at` guard.
- `lib/odds/eligibleUnpricedFights.ts` — extracted from `matchAndSnapshot`
  so the same "unpriced and past T-12h" query backs both the write path
  and the banner's missed-snapshot count, rather than two definitions of
  the same thing drifting apart.
- `lib/jobs/runWithTracking.ts` — generic `job_runs` bookkeeping, written
  once for reuse by Phase F's rumour engine later, not just this phase.
- `0018_job_runs.sql` — public-read, service-role-write-only, same
  posture as `odds_snapshots`.
- `lib/odds/runOddsJobsOnce.ts` — the actual shared logic, called by
  **both** the cron script and the owner's manual retry action, so a
  manual "late pull" is never a second, divergent code path from the
  scheduled one.
- `features/job-health/` — `evaluateJobHealth` (test-first, mutation-
  verified: the staleness boundary and the missed-snapshot signal being
  independent of job-execution status are both real branches a mutation
  broke), the `JobHealthBanner` + `RetryButton` components, and
  `retryOddsJobAction`.

**The manual "late pull" needed its own security boundary, not just RLS.**
`odds_snapshots` and `job_runs` have no client write grant at all — the
service-role admin client is the only way in — so `retryOddsJobAction`'s
own `isOwner()` check, run server-side against the real session, **is**
the actual boundary for this one action, unlike every other `isOwner()`
use so far, which is UX-only backed by real RLS. Added a test for
`isOwner()` itself (`src/lib/auth.test.ts`) precisely because of this
second role — mutation-verified.

**A real regression found and fixed before merge, not after:** the first
version of `JobHealthBanner` checked ownership via `cookies()`-based auth
directly in its own server render. `next build`'s route table showed the
actual cost — `/`, `/events/past`, and `/events/upcoming` silently flipped
from static+revalidated to server-rendered on every request, a page-wide
cost for one small piece of chrome. Fixed by moving the ownership check
into a client-triggered server action (`checkCanRetryAction`) that
`RetryButton` calls after mount instead — confirmed by re-running the
build and seeing the same three routes back to static. See
`PROJECT_FACTS.md` for the general lesson.

**`matchAndSnapshot.ts` ran live for the first time**, with explicit
confirmation, alongside `discoverStartTimes`. Safe by construction: no
known card was within 12h of starting (nearest is UFC 331, 2026-09-20,
19 days out from this run), so the new T-12h gate correctly excluded
every candidate — 0 matched, 0 low-confidence, 63 odds events all
reporting `no_candidates` since the candidate list was empty from the
start. **Verified by querying the actual tables afterward, not trusting
the console summary:** `odds_snapshots` stayed at 0 rows; `job_runs` shows
both jobs' real rows, `status: success`, summaries matching the console
output exactly.

**B6 result.** Found a real bug orienting on this phase, before writing any
UI: `matchAndSnapshot.ts` was writing `fight_id` for `low_confidence_odds_
match` conflicts instead of `null`, contradicting the migration's own
documented design and — once C1's pick-lock trigger exists — would have
wrongly blocked **picking** a fight over a mere pricing ambiguity, not just
blocked pricing it. Confirmed harmless in practice (both B5 live runs:
`lowConfidence: 0`) and fixed before any real row could exist with the wrong
shape. See ARCHITECTURE.md Fork 5 for the full reasoning.

Built two pure resolution builders (`resolveDisputedOpponent.ts`,
`resolveLowConfidence.ts`), mutation-tested, reusing `stripNullish` and
`parseFighterPrices` exactly as their automatic counterparts do. The low-
confidence picker (`rankFightMatches`) deliberately shows every in-window
candidate fight, not just the algorithm's own best guess — user-confirmed
choice over the simpler "single suggestion" alternative, so the owner can
correct the algorithm rather than only ever rubber-stamping it.

**A second, unrelated bug found by the live check done before writing any
of this**: `data_conflicts` (migration 0014) didn't actually exist in
production, despite the CLI's migration tracking claiming it was applied.
Root-caused and fixed (`db query -f` against the live database, applying
0014 for real) — see `PROJECT_FACTS.md` for the full incident and the
standing lesson about not trusting a repaired tracking table as proof the
schema matches.

**Verification note, stated plainly:** the read path
(`getOpenConflicts`/`getOpenConflictCount`) ran live against production,
safely (read-only), and is what caught the missing-table bug above. The
write path (the two resolve actions) has **not** been exercised live — no
real conflict exists yet to resolve, and the actions' `cookies()`-based
owner check can't run outside a real Next.js request, so there's no
lightweight way to invoke them standalone the way `runOddsJobsOnce` was.
Mitigated instead with a direct cross-check of every column name the write
path uses against `information_schema.columns` for `fights`,
`odds_snapshots`, and `data_conflicts` — all match exactly. First real
exercise happens the first time an actual conflict occurs and gets
resolved.

Also fixed, found orienting on this phase: **Vitest never resolved
`tsconfig.json`'s `@/*` alias** — latent since day one, surfaced by this
phase's first test file to transitively import a `@/`-using module. Added
`vitest.config.mts`. See `PROJECT_FACTS.md`.

---

## Phase C — Picks and bets

First point where the app is genuinely usable: a card you can work end to end.

| # | Sub-phase | Status |
|---|---|---|
| C1 | ⚠️ `picks` table + pick-lock trigger + the check that each fighter belongs to that fight | **done** (2026-09-01) |
| C2 | ⚠️ `lib/scoring` — implied probability, edge, unit P&L. Pure functions, no I/O | **done** (2026-09-01) |
| C3 | Card view: bouts in `bout_order`, odds, conflict holds, quick pick (collapsed row) | **done** (2026-09-01) |
| C4 | Expanded bet row: stake, estimated probability anchored to implied, live edge | **done** (2026-09-01) |

**C2 note.** No American-odds conversion exists anywhere — decimal is the API
default and prices are stored as returned. `implied = 1 / decimal_odds`;
`edge = (estimated_probability × decimal_odds) − 1`.

**C4 is a UX floor requirement, not polish.** Asking for a probability cold
fails the no-learning-curve bar on the most important field in the system. The
row must show implied probability as the anchor and compute edge live, so the
judgment being made is "is the market too high or low, and by how much."
Without it `estimated_probability` is noise and the calibration check in G3 is
meaningless.

**C1 result.** Getting oriented surfaced a real gap: `ARCHITECTURE.md`'s own
schema-decisions text never named three fields docs/PRD.md's UC-3/§9 both
list for every pick -- `confidence`, `predicted_method`, `reasoning`. Asked
before building rather than guessing: `confidence` is a separate 1-5
gut-check, distinct from `estimated_probability`'s precise number
(user-confirmed); `reasoning` is optional, not required on every pick
(user-confirmed -- required free text on every pick fails the
no-learning-curve UX floor); and `picks` itself is **owner-only, not
public** -- the user's own words, "for now just me until I prove the picks
are actually reliable," a real product decision recorded as a fact, not a
permanent one.

Test-first, matching the established SQL-test convention
(`supabase/tests/rls.sql`, not a new pattern): checks 17-25 were written
*before* `0019_picks.sql` existed, then run live against production with
real sessions (`db query -f`, the same trusted mechanism established in
A3). Two real bugs came out of actually running them, not just reading the
migration:

1. **A test-fixture bug of this phase's own making** -- checks 18/19/21/
   22/23 were accidentally written against the same *locked* fixture fight
   built for check 24, so the lock check fired first and shadowed the one
   actually being tested. Fixed with a third, dedicated unlocked fixture.
2. **A real production bug**: `check_pick_constraints()`'s open-conflict
   read of `data_conflicts` hit `permission denied` the moment an
   `authenticated` session actually triggered it -- that table has no
   grant for `authenticated` at all (0014). Same fix as `accept_clan_
   invite` (0017): `SECURITY DEFINER`. Since `0019` was already applied
   live by the time this was found, the fix is a new migration (`0020`),
   not an edit -- same discipline that fixed the `data_conflicts`
   incident in B6.

All 25 checks (16 pre-existing + 9 new) pass live: `All RLS checks
passed.` Confirmed via `information_schema` (not just the migration
tracker) that `picks` has the exact columns designed.

**Scope note:** C1 is schema + trigger only, no application code -- no
`features/picks/` yet. That's C3 (card view) and C4 (bet row)'s job.

**C2 result.** Four pure functions, `lib/scoring/`: `impliedProbability`,
`edge`, `scorePickCorrect`, `scoreBetPnl`, plus a `FightOutcome` type
(`decided` | `void`) that pins the scope -- *deciding* whether a fight is
ready to be scored (source agreement, the 24h timeout) is Phase D's
orchestration job, not this pure-math layer's. No I/O, no database
access; this phase touched no migration and nothing live.

Test-first throughout, every branch mutation-verified against a real
regression, not just written and trusted:
- `impliedProbability`/`edge` tested against the PRD's own -6000-
  favourite example (decimal 1.0167 -> 98.4% implied).
- `scoreBetPnl` tested against known moneyline examples (a 1.20
  favourite, a 3.5 underdog), the void/no-bet distinction (`0` vs
  `null`), and a defensive case the DB's own check constraint makes
  unreachable in practice but the pure function still fails safe against
  (only one of `bet_fighter_id`/`stake_units` set).
- **Item #3's own test-case wording doesn't literally parse** for a
  two-fighter fight ("prediction right... the other fighter's bet wins"
  can't both hold when only one fighter wins at all). Rather than guess
  which direction was meant, `dualSettlement.test.ts` covers both:
  prediction wrong + bet on the winner, and prediction right + bet on the
  loser -- strictly more coverage than picking one, and a mutation-
  verified regression guard confirms `scoreBetPnl` settles against
  `bet_fighter_id`, never `predicted_fighter_id`, either way.
- **Void semantics clarified against the PRD's exact words**, not
  assumed: `pick_correct` is `null` (no correct answer to score) but
  `pnl_units` is `0`, not `null` -- "voided and returned, not counted as
  a loss" is a real, known net-zero outcome, distinct from `null`'s "no
  bet was ever placed." See `PROJECT_FACTS.md`.

**C3 result.** Extended the existing `/events/[id]` route rather than a
new one -- `docs/user-flows.md` is explicit that the card view, not the
fight page, is where a whole card gets worked in one pass. `getCardView`
(`features/fights/api.ts`) replaces the old `getEventWithFights`, adding
`bout_order` sort (nulls last), and merges `odds_snapshots` in rather
than embedding the reverse FK, matching B3's own established pattern.
New `features/picks/` (`QuickPick`, `api.ts`, `actions.ts`,
`quickPickBands.ts`) and a small extension to `features/conflicts/api.ts`
(`getOpenDisputedFightIds`) for the hold state.

**A real gap surfaced before any code, not after:** the flow doc's "one
tap picks a winner" can't satisfy `estimated_probability`'s `NOT NULL`
constraint (0019) without faking a number or asking for something real.
Asked rather than guessed: tapping a fighter expands the row in place to
5 preset probability bands, deliberately not anchored to the fight's own
implied probability (a pick is opinion, independent of price -- that
anchoring is C4's job for the bet row). `confidence` defaults silently to
3 since, unlike probability, it feeds no P&L/edge math.

Auth branching collapses two of Flow 1's states into one: logged-out and
logged-in-but-not-owner render the same read-only card, matching the
auth-gate table treating "sign-in prompt" and "not available" as the same
underlying "no pick controls" state. Conflict holds and the owner's own
picks are fetched only on the confirmed-owner path -- Flow 1's own
diagram never branches either onto the read-only leaf.

**Verification, stated honestly:** `getCardView` and
`getOpenDisputedFightIds` both ran live against UFC 331's real card --
`bout_order` sorts main-event-first as expected, every fight correctly
shows unpriced 19 days before T-12h. `saveQuickPickAction` was **not**
exercised live -- same `cookies()`-outside-a-real-request limitation as
B5/B6, and unlike those, faking a real pick would create fake opinion
data under the owner's own name, not harmless log rows. Mitigated with a
column-name cross-check against the real schema; the actual enforcement
is C1's already-live-tested trigger, which this action does not
re-implement.

**C4 result.** Two real forks asked and resolved before building: the
anchored-probability control is C3's own one-tap band interaction,
reframed relative to implied ("well below market" .. "well above
market") rather than a slider/stepper, and stake is a free numeric field
rather than preset chips, since sizing itself is the signal E1's board
measures. Also closed a gap C3 left open in its own code comments:
`confidence`, `predicted_method`, and `reasoning` -- all three named by
`docs/PRD.md` UC-2 but never exposed in the UI -- become editable here,
since nothing else in this roadmap claims that scope.

Three new pure functions in `lib/scoring/`, all correctness-critical
(money math) and mutation-verified: `probabilityForFighter` (a bet may
back a fighter other than the pick -- PRD's own example -- so live edge
needs `1 - estimated_probability` when the two diverge, never the stored
number verbatim), `priceForFighter` (the wrong side's decimal price
silently flips edge's sign), and `applyProbabilityDelta` (turns a band's
relative delta into the stored value, clamped inside 0019_picks.sql's
strict `(0, 1)` check -- the PRD's own -6000 example would overflow past
1 unclamped).

**A real data-merging bug caught before it could happen, not after:**
C3's `saveQuickPickAction` sent a partial upsert payload
(`{predicted_fighter_id, estimated_probability, confidence}` only).
Relying on Supabase's `resolution=merge-duplicates` upsert to leave
untouched columns alone on conflict is exactly the kind of behaviour
this project's own working style says not to trust from third-party docs
without checking -- so rather than assume it's safe, both save actions
were rebuilt around an explicit read-merge-write (`mergePickFields.ts`,
a data-merging rule, test-first and mutation-verified) that always
writes a complete row. This also fixed a second issue the naive design
would have had: a fast quick-pick retap after already setting a real
`confidence` via the expanded row must not silently revert it to the
neutral default -- `saveQuickPickAction` now only applies that default
when no row exists yet.

The bet row only appears once a fight is priced (ordering constraint #5)
**and** a quick pick already exists -- UC-2's own framing is "log a
pick, and *separately* decide whether to bet it," so betting never
creates a pick from nothing; `saveBetAction` enforces this server-side
too, not just in the UI. `getMyPicksForFights` widened from C3's
`predictedFighterId`-only slice to the full row (`MyQuickPick` renamed
`MyPick`) so reopening the bet row prefills what was last saved instead
of asking the owner to re-derive it -- recognition over recall.

**Verified live, safely:** the expanded `getMyPicksForFights` column list
(the four new fields) was checked directly against the real `picks`
table via a throwaway read-only script (admin client, real fight ids, 0
rows back -- expected, since no real pick has ever been written), then
deleted before commit. `saveBetAction`/the rebuilt `saveQuickPickAction`
were **not** exercised live -- same reasoning as C3: this session's
`cookies()`-based auth can't run outside a real request, and faking a
real bet would be fabricating opinion/money data under the owner's own
name. The real enforcement remains C1's already-live-tested trigger and
RLS policies, which neither action re-implements.

---

## Phase D — Settlement

| # | Sub-phase | Status |
|---|---|---|
| D1 | ⚠️ Cross-check settle job — agreement settles, 24h single-source timeout settles and flags, disagreement queues | **done** (2026-09-01) |
| D2 | ⚠️ Dual settlement — `pick_correct` and `pnl_units` settle independently; draw/NC/cancelled voids **both** lines | **done** (2026-09-01) |

**D2 note.** The case that must be explicitly tested: prediction right, bet on
the other fighter, bet wins. Both lines must record the truth rather than one
overwriting the other. With no winner there is no correct answer, so scoring a
pick as wrong on a draw would be a bug, not a harsh call.

**D1 result.** Getting oriented found the real blocker before writing
anything: `fights.winner_id`/`method`/`round` were last-write-wins between
the two sync jobs, so Fork 6's policy had no independent per-source state
to actually compare -- whichever job ran most recently silently overwrote
the other's report. Two forks asked and resolved: per-source columns
directly on `fights` (over a separate reports table -- matches this
project's repeated one-table preference), and a Wikipedia draw/NC settles
immediately rather than waiting the usual 24h, since API-Sports
structurally has no way to ever report "no winner" and so can never
corroborate one -- verified live first (a real UFC 214 No Contest page),
not assumed.

A third case surfaced while writing the decision function's tests, not
asked or guessed: if API-Sports has *actively* reported a winner while
Wikipedia says draw/NC, that's a real disagreement, not the "nothing to
wait for" case -- it queues like any other disagreement instead of
settling immediately. Found by enumerating every real source-state
combination before any implementation existed.

Two new pure, mutation-verified functions: `evaluateFightSettlement.ts`
(the whole policy, one decision per fight) and
`buildSourceReportUpdate.ts` (routes each source's report into its own
columns, critically preserving the *original* `reported_at` on every
repeat report -- refreshing it would mean the 24h timeout never actually
fires, since the sync runs twice daily). `upsertFight.ts` no longer
writes the shared `winner_id`/`method`/`round` at all; both sync jobs now
declare `source: "wikipedia" | "api_sports"` instead. `data_conflicts`
gained a third kind, `disputed_result` -- read-only for now
(`DisputedResultCard`), since most disputes are expected to self-resolve
the same way `disputed_opponent` ones already do; a manual override is a
well-scoped later add, not a gap. `ConflictCard`'s dispatch is now an
exhaustiveness-checked `switch` so a future fourth kind fails the build
instead of silently mis-rendering.

**Verified live.** Migration cross-checked against `information_schema`/
`pg_constraint`, not just the tracking table. Ran the real twice-daily
sync end-to-end against production for the first time since
`upsertFight.ts` changed (Wikipedia's half; `syncJob.ts` skipped locally
for lack of a local API key). Zero results reported, independently
confirmed correct rather than assumed: all 8 synced events' own
`event_date` are still in the future. Then ran the settle job itself
live: `0 settled, 0 disputed, 152 still waiting` -- the correct,
provably-safe no-op, confirmed via a real `job_runs` row, not just the
console line. Full reasoning and every constraint added in
`ARCHITECTURE.md` Fork 6.

**D2 result.** Orienting on D2 found a real gap in D1's own settle job,
fixed before writing anything new: it never checked for an open
`disputed_opponent` conflict before settling a fight's winner, which
could have let a real result settle for a bout still in question. Fixed
in `settleFights.ts` directly -- a code fix, not a migration.

`picks.settled_at` (new) is the only reliable "has this pick been
processed" signal -- `pick_correct`/`pnl_units` alone can't tell a
genuinely unsettled pick apart from a settled *void* pick with no bet,
since both stay null/null forever. Deliberately not paired with
`pick_correct` the way `fights.settled_at`/`settled_from` are: that
pairing would be actively wrong here, since a legitimately settled void
pick keeps `pick_correct = null` on purpose.

**A real access-control bug caught live, before this was called done --
not assumed correct from reading the code.** The trigger's door-opening
for D2 needed to tell the settlement job (`service_role`) apart from
every other caller; the first version checked `current_user =
'service_role'`. Live-testing this properly (a real owner session, then
a real service_role session, against a throwaway pick -- `set local
role` + `request.jwt.claims`, the exact technique `CLAUDE.md` already
documents for RLS testing, deleted after each run) caught a serious bug
before merge: the owner was correctly rejected, but so was the
**settlement job itself** -- D2 could never have written anything at
all. Root cause: the function is `SECURITY DEFINER` (required since
0020, to read `data_conflicts`), which swaps `current_user` to the
function's *owner* inside its own execution, regardless of the actual
caller -- confirmed directly with a throwaway test function. Fixed with
`current_setting('role', true)` instead, a plain GUC read the elevation
doesn't touch -- verified the same live way, both directions, before
shipping the fix as a new migration (0023, since 0022 was already
applied). Full narrative in `ARCHITECTURE.md` Fork 6 and the general
lesson in `PROJECT_FACTS.md`.

The pick lock is also exempted for `service_role` -- without it, D2
could never write anything either, since settlement always happens
after the card has already started.

**Verified live, end to end.** Both migrations cross-checked against
`information_schema`/`pg_proc`. Ran the real `settlement:run-jobs`
script (D1 + D2 chained) against production: `0 settled, 0 disputed,
152 still waiting` / `0 picks settled across 0 fights` -- correct, since
no fight has settled yet -- confirmed via two real `job_runs` rows, not
just the console output.

---

## Phase E — Scoreboard

| # | Sub-phase | Status |
|---|---|---|
| E1 | Two boards — units and accuracy — three lines each, chalk computed not stored | **done** (2026-09-02) |
| E2 | Filterable pick table with the PRD's breakdowns (weight class, stance matchup, favourite vs underdog, flag present) | **done** (2026-09-02) |

**E1 note.** Both boards always show all three lines. A line that disappears
when it has no data reads as a bug and hides the control you most need. Below
10 cards, the boards must be explicitly marked a small sample rather than
reading as a verdict.

**E1 result.** `docs/user-flows.md` had already answered nearly every real
UX question before this phase started -- the exact empty-state copy ("No
settled picks yet -- the chalk line appears after the first card"), the
10-card small-sample threshold, and the unpriced-picks rule ("counted in
accuracy, excluded from units, and said so on screen") all came straight
from Flow 3 and its state tables, not decided fresh here. What was left
to design was the actual computation.

Three new pure, mutation-verified functions in `lib/scoring/`:
`determineFavorite` (lower decimal price wins; a genuine tie breaks
toward `fighter1`, deterministic and rare enough not to matter),
`aggregateUnitsLine`, `aggregateAccuracyLine` -- the last two shared by
all three lines on each board (me, intern, chalk alike ultimately reduce
to the same shape: a list of bet results, or a list of `pick_correct`
values). Chalk itself is not a stored strategy -- it's a live simulation,
for every settled+priced fight, of a flat 1-unit bet on whichever fighter
`determineFavorite` names, scored through the exact same
`scoreBetPnl`/`scorePickCorrect` a real bet uses. One definition of
"correct" and "P&L" in the whole codebase, never a second one built for
reporting.

**A real design question resolved by re-reading the PRD closely, not
guessed:** does "me" need its own head-to-head-vs-full-card split the way
the intern does? No -- my own picks are already exactly the fights I chose
to judge, so my one accuracy number already is the fair comparison point.
It's the intern's number that needs restricting to fights I *also* picked
(`headToHead`), since once Phase G ships the intern is designed to pick
every fight -- its unrestricted full-card number would otherwise be
diluted by fights I never had an opinion on. Built the full
`InternAccuracyLine` shape now, correctly, even though it's trivially
empty until G ships real intern picks -- avoids a UI rework later, and
"always show all three lines, even with no data" already requires the
Intern row to render a real, honest empty state today regardless.

**A real gap caught reviewing my own first draft**, before it shipped:
`AccuracyBoard`'s "no data" row would have silently dropped the intern's
full-card context whenever head-to-head had zero overlap but full-card
already had real data (the exact state the app sits in for a while after
Phase G ships, before the intern and the owner happen to pick the same
fight). Fixed so a genuine "nothing at all" state and a "no overlap yet,
but here's what the intern's done full-card" state render differently
instead of collapsing into the same blank line.

**Verified live, safely:** `getScoreboardData`'s exact query shapes
(table and column names across `fights`, `picks`, `odds_snapshots`) ran
against production via a throwaway read-only script, confirming they
resolve without error -- `0` settled fights, `0` settled picks, matching
D1/D2's own live runs exactly. The page's own empty-state branch
(`accuracy.me.total === 0`) is therefore what a real visit renders right
now, which is the correct, honest state -- deleted the script before
commit.

**E2 result.** Lives on `/scoreboard` itself, under the two boards --
`docs/user-flows.md` had already ruled out a separate route ("pick
history... not its own route"), so this extended the existing page and
`getScoreboardData` rather than adding new surfaces. USER picks only:
"pick history" reads naturally as the owner's own log, and the intern
has no rows regardless until Phase G.

One new pure, mutation-verified function: `describeStanceMatchup`
(`lib/scoring/`) -- canonicalizes a stance pairing by sorting, so
"Orthodox vs Southpaw" and "Southpaw vs Orthodox" are always the same
bucket rather than silently fragmenting into two depending on which
fighter happened to sync as fighter1. Verified live that this matters in
practice, not just in theory: a real production sample of fighters came
back with `stance: null` on all three checked, confirming the "Unknown"
fallback is a real, common case, not defensive code for an edge case
that never happens.

Favourite/underdog reuses E1's `determineFavorite` directly against each
pick's own `predicted_fighter_id` -- one definition of "favourite,"
matching chalk's own. `flag_present` ships as a real, visible filter
control now, disabled with "Arrives with the rumour engine (Phase F)"
rather than omitted -- the same "state the control, don't hide it"
principle the Intern line and the small-sample banner already apply,
extended to a filter for the first time. Filtering itself is client-side
(the whole pick history is realistically a few hundred rows at most, so
a live re-fetch per filter would only add latency); the summary line
above the table reuses `aggregateAccuracyLine`/`aggregateUnitsLine`
directly on the filtered subset, the identical reduction the boards
themselves use, rather than a second one built for filtering.

**Verified live, safely:** the two new queries E2 needed beyond what the
boards already fetched (`events` for names/dates, `fighters` for
names/stance) ran against production -- both resolve, and the real
sampled stance data is what caught the null-stance case above before it
could surprise a future reader.

**`/impeccable audit` run on the full surface**, per this file's own
"Design cadence" section calling out E1/E2 as the checkpoint. The
mechanical detector found nothing both before and after; a manual pass
over the 5 dimensions caught two real, if minor, accessibility gaps the
detector doesn't check for -- a `title` attribute (unreliable for screen
readers and touch) explaining the disabled "Flag present" filter,
replaced with visible text plus `aria-describedby`; and the pick table
missing a `<caption>`, added, reporting the filtered/total count.
18/20 (Excellent) after the fixes -- full token system already inherited
correctly, no custom widgets (native `<select>`s throughout, so no
hand-rolled keyboard/ARIA risk), horizontal table scroll on narrow
viewports by design, not a bug.

---

## Phase F — Rumour engine

Independent of A–E. Can move earlier — UC-1 works with no odds and no picks.

| # | Sub-phase | Status |
|---|---|---|
| F1 | Verification spike + `lib/llm.ts` (Gemini Flash) and social client wrapper | **done** (2026-09-02) |
| F2 | Clustering → `rumour_flags` + `rumour_sources`, with a degrade-loudly fallback | **done** (2026-09-02) |
| F3 | Flags on card rows + full sources with links on `/fights/[id]` | **done** (2026-09-02) |
| F4 | Rumour outcome marking on settled cards (UC-5) | **done** (2026-09-02) |

**F2 note.** An exhausted LLM tier returning zero flags is indistinguishable
from "nothing to report" and is the worst failure shape in the system. The
heuristic fallback must announce itself, never fail silently. Corroboration
counts **independent claims**, not raw post volume.

**F4 note.** This is what makes the PRD's rumour precision metric measurable
at all. Without it that metric cannot be reported.

**F2 result.** `rumour_flags`/`rumour_sources` schema (`0024`, corrected by
`0025` — see `ARCHITECTURE.md`'s Schema decisions for the real bug found
live and fixed same-day), plus the full pipeline: `lib/rumours/` searches
Bluesky per fighter on the nearest upcoming card, clusters via Gemini
(`buildClusterPrompt.ts` + `parseClusterResponse.ts`, which never trusts
the model's output at face value — fighter attribution, category, and
every source uri are all independently validated), falls back to a
keyword + fuzzy-name heuristic (`heuristicCluster.ts`) on any LLM
failure, and upserts by `(fight, fighter, category)` so corroboration
accumulates across runs instead of resetting. One user decision needed:
confirmed adding an `'other'` category bucket alongside the PRD's four
named types, so a real concern that doesn't fit the four named shapes
still surfaces rather than being dropped.

Test-first, mutation-verified: `heuristicCluster.ts`,
`collapseNearDuplicates.ts` (the actual "corroboration counts independent
claims, not raw volume" rule), `matchFighterMention.ts`, and
`parseClusterResponse.ts` (the LLM-output validator — hallucinated source
uris, hallucinated fighter names, and invalid categories are all
independently caught and mutation-confirmed).

Run live against production three times in a row (2026-09-02, real
upcoming card — UFC Fight Night: Hooker vs. Parnasse): 11 real fights,
real Bluesky search, real Gemini clustering. First run wrote a flag with
**zero** attached sources — the bug behind `0025` above, found only
because this ran for real rather than being assumed correct from the
unit tests. Fixed and re-verified: the second and third runs confirmed
the fix (every flag carries real sources) and confirmed the actual
degrade-loudly path fires for real too — one fight genuinely fell back to
heuristic clustering mid-run (a live LLM hiccup, not simulated), and
`job_runs` recorded it correctly. A third immediate re-run confirmed
idempotency: one flag's corroboration grew from 1 to 3 sources as new
posts appeared, with zero duplicate `(flag_id, post_uri)` rows — checked
directly against the table, not assumed from the code.

One live prompt-quality gap found and fixed the same pass:
`buildClusterPrompt.ts` was pulling in past-fight result recaps ("secured
a first-round knockout victory...") as if they were pre-fight concerns.
Added an explicit rule excluding anything that isn't a live risk to the
*upcoming* bout.

**Scope note, stated rather than silently skipped:** PRD UC-1 wants
sourcing to distinguish a named journalist, the camp, or the fighter.
Only the first is built — there's no stored mapping from a fighter to
their own or their camp's Bluesky handle anywhere in this schema, so that
part of UC-1 is honestly out of scope for now rather than faked.

Not built in F2, deliberately: no UI reads this data yet — that's F3.

**F3 result.** A rumour-flag badge on each fighter in `/events/[id]`'s
bout rows (collapsed, one tap through to the full detail — progressive
disclosure, matching the card view's own convention), a full rumour
section grouped by fighter with every source and a real clickable link
on `/fights/[id]`, and a page-scoped "Flags unavailable, last scraped X" /
"Rumours last scraped X" notice on `/events/[id]` — the third state
`docs/user-flows.md`'s table names, distinct from the healthy-but-aging
"Bluesky stale" state (flags still shown, just stamped with their age).
Deliberately a **separate, page-scoped notice**, not folded into
`features/job-health`'s existing global `JobHealthBanner`: that banner is
app-shell chrome with odds-specific wording, but rumour flags only ever
appear on two routes, so a site-wide banner would be irrelevant chrome
everywhere else. `evaluateJobHealth` (the pure health-decision function)
moved from `features/job-health/` to `shared/utils/` so both features
reuse the same logic instead of one feature importing from another —
`CLAUDE.md`'s layer-boundary rule, applied the moment a second feature
actually needed it.

One test-first addition: `postUriToWebUrl.ts`, converting the stored
AT-URI into a real, clickable `bsky.app` link — an ID/redirect-resolution
concern (`CLAUDE.md`'s test-first list names this class explicitly), since
a wrong extraction is a silently dead or wrong link, worse than showing
no link. Mutation-verified.

Verified live against the real F2 data (not just types checked by the
build): a throwaway script exercised `getRumourFlagSummaries`,
`getRumourFlagsForFight`, and `getRumourScanHealth` against production,
confirming real flags, real grouped sources, real named-source detection,
and a real "healthy" job status all render correctly end-to-end. That
live check caught one more real gap: Bloody Elbow posts under **both** a
`.web.brid.gy` bridge account and a separate native `bloodyelbow.com`
handle, and only the bridge one was recognised as a named source.
`lib/rumours/isNamedSource.ts`'s allowlist now includes the real,
confirmed handle, and the two already-written production rows under that
handle were corrected (an `UPDATE`, not a delete — no evidence lost).

Lightweight `/impeccable audit` run per the design cadence: the mechanical
detector found nothing; manual review found two real responsive gaps
(`RumourSection.module.css` was the only sibling stylesheet in this
feature area with no narrow-viewport handling) and fixed both before
shipping. Accessibility, theming, and performance all came back clean —
this is server-rendered read content with no new client JS, and every
colour already comes from the existing token set.

**F4 result.** `rumour_flags.outcome`/`outcome_marked_at`
(`0026_rumour_flag_outcomes.sql`) plus a shared `markRumourOutcomeAction` —
one write path, rendered in two places: inline on `/events/[id]`'s bout
row (Flow 2's "beside the flag, on the card you already have open," no
click-through required) and on `/fights/[id]`'s full rumour section,
since a viewer already reading the sourcing there is just as natural a
moment to mark it. Both reuse the identical `RumourOutcomeMarking`
component. A plain read-only `RumourOutcomeTag` shows the marked state to
every visitor once set — outcomes are public, matching the rest of
rumour data's posture; only the marking buttons are owner-gated.

Settled-only, owner-only, enforced server-side against real `fights.
settled_at` (never trusted from the caller), the same `requireOwner`
pattern `features/conflicts/actions.ts` already established for a table
with no client write grant at all. Deliberately an in-action check, not a
cross-table DB trigger — see `ARCHITECTURE.md`'s Schema decisions for the
proportionality reasoning.

Verified live: rather than fabricate a fake settled fight or a fake flag
row on production to exercise the happy path (real data, not something
to corrupt for a test), the settled-check logic itself was run against a
real, currently-unsettled flag from F2's own data via the admin client
directly — confirmed it correctly identifies the fight as unsettled and
would reject the mark, and confirmed the new `outcome`/`outcome_marked_at`
columns exist and read as `null` on a real row. The happy path (marking
succeeds once a fight has actually settled) isn't independently live-
verified yet — nothing in this app has settled since F2 shipped — so
this is worth a first real check once a card the intern is watching
actually finishes.

Lightweight `/impeccable audit`: mechanical detector clean; manual review
found no new issues — the toggle buttons reuse `QuickPick`'s exact
button styling and `useTransition` shape, add `aria-pressed` for the
toggle state, and introduce no new colour hue (the ✓/✗/? symbols and
words already distinguish the three outcomes without one).

Phase F is now fully done — F1 through F4 all shipped.

**F1 result.** Started as a verification spike for the originally-planned
source (Reddit) and ended up re-deciding the social source entirely —
`ARCHITECTURE.md` Fork 9 has the full reasoning; this is the build-log
version.

**X was checked and ruled out on hard fact:** its free tier was
discontinued in February 2026 — reading a single post now costs real
money, a direct violation of the `$0/month, hard` constraint at any
volume.

**Reddit was checked live, not assumed changed from a stale headline.**
A real attempt to register a script OAuth app at `reddit.com/prefs/apps`
hit a genuine dead end, not a form bug — extensive back-and-forth
troubleshooting (a network-security block on the user's own connection,
ruled out via incognito; CAPTCHA staleness, ruled out by resubmitting
immediately) eventually surfaced the real cause: Reddit's "Responsible
Builder Policy" (dated June 5, 2026) closed self-service registration.
Every new OAuth client now needs manual, opaque approval with reported
multi-week queues and no published criteria — corroborated independently
by both the user's own research and a live web search before accepting
it as the real explanation, not a guess from one source.

**Bluesky was verified live and chosen.** Free, no approval queue (an
account plus a self-service app password), and a real content check
found genuine signal: established MMA outlets (Bloody Elbow, MMA
Fighting, MMA Mania) bridge their coverage onto it, turning up real,
current, named-source posts — "Patchy Mix misses weight by over six
pounds", "Chidi Njokuani rips commission for weight cut controversy at
UFC 330" — a genuinely good fit for UC-1's corroboration/sourcing
requirements, not a fallback settled for after Reddit and X both failed.

Two real technical findings from the live verification, neither
assumed: `public.api.bsky.app` (documented as the public,
unauthenticated read mirror) blocks `searchPosts` specifically — ruled
out a broad network block first (a trivial `getProfile` call against the
same host succeeded unauthenticated) before finding the fix is routing
search through the authenticated session's own PDS host (`bsky.social`)
instead. And a real share of the best content arrives via "bridge"
accounts with an **empty** `record.text` -- the actual content lives in
`record.embed.external` instead, found by inspecting one real bridged
post's full JSON. `lib/bluesky.ts`'s `searchMmaPosts` falls back to the
embed's title+description; a live test of the real function (not raw
fetch calls) confirmed zero posts came back empty after the fallback,
out of a real 7-post sample.

**Gemini verified live too, model choice changed from the original
plan.** `docs/PRD.md` named "Gemini Flash or Groq," `ARCHITECTURE.md`
had already narrowed this to Gemini Flash specifically — F1 checked the
account's own real rate limits (Google's own docs refuse to publish a
fixed number, pointing to the per-account AI Studio dashboard instead)
and found every full "Flash" model checked (2.5/3/3.5/3.6/3.7) caps at
20 requests/day, while `gemini-2.5-flash-lite`/`gemini-3.1-flash-lite`
share a **500** RPD budget. A live side-by-side test of the identical
realistic clustering prompt against both tiers returned matching
quality — same correct deduplication of two independent posts into one
concern, same correct exclusion of a joke/troll post, even the same
attribution miss on a deliberately ambiguous case (confirming that miss
is a prompt-design gap for F2 to solve, not a Lite-specific capability
gap) — while Lite ran faster and spent zero tokens on internal
"thinking" (782 thinking tokens on the full model vs. none on Lite).
`gemini-2.5-flash-lite` itself is confirmed dead: calling it live
returned a 404 telling new callers to use `gemini-3.5-flash-lite`
instead, which is what `lib/llm.ts` targets.

`lib/llm.ts` also uses Gemini's native `responseMimeType:
"application/json"` rather than a prose "return only JSON" instruction
— verified live that the prose approach wraps output in ` ```json `
markdown fences (a real parsing footgun), while the native mode returns
clean, directly `JSON.parse`-able text every time tested.

**Both wrapper modules verified live end-to-end** (not just via raw
throwaway fetch scripts): `generateJson` and `searchMmaPosts` themselves
were imported and called for real, confirming the actual shipped code
works, not just the underlying API calls it's built on.

---

## Phase G — The intern

| # | Sub-phase | Status |
|---|---|---|
| G1 | Intern picks every fight with an `estimated_probability`, market-anchored and rumour-adjusted | **done** (2026-09-02) |
| G2 | Edge-gated betting — threshold plus confidence sizing, and **free to decline entirely** | not started |
| G3 | Intern lines on both boards + a calibration check | not started |

**G2 note.** Silence on an unbackable favourite is the intern working, not
failing. A -6000 shot is 98.4% implied; it needs better than that to have any
edge at all.

**G3 note.** Because `estimated_probability` is stored, calibration is
directly checkable: of the fights called 70%, did roughly 70% happen? Expect
chalk to win early while calibration is bad. That is an informative result,
not a failure — the PRD says so explicitly.

**G1 result.** `lib/intern/`: `decideInternPick.ts` is the whole opinion as
one pure, deterministic function — de-vigged market anchor (raw implied
probabilities always sum to more than 1, the overround, so using them
directly would hand the intern phantom edge on nearly every fight) plus a
capped, corroboration-scaled penalty per flagged fighter
(`flagPenalty.ts`). `generateInternPicks.ts` is the I/O glue: every
upcoming fight, priced or not, gets a pick, held fights are skipped, and a
write only happens when the decision actually changed — `updated_at` stays
a real signal of when the intern last changed its mind now that revision
is allowed. See `ARCHITECTURE.md`'s Fork 10 for the three confirmed
decisions this rule embodies (deterministic over LLM, picks unpriced
fights anchored at 50%, revises until the card locks).

**A real security gap found and closed before any intern code ran live**
— see correctness-critical item #4: the pick-lock trigger's settlement
bypass keyed on the writer's role alone, so the intern's own
`service_role` cron would have been able to write past a started or
finished card. Fixed same-day (`0027_narrow_settlement_bypass.sql`),
live-tested in a rolled-back transaction against real data: a late
`service_role` INSERT and a late revision are both correctly rejected,
the real settlement UPDATE still works.

Test-first, mutation-verified: `flagPenalty.ts` and `decideInternPick.ts`
(19 tests) — the market-anchor de-vig and the rumour-adjustment direction
are the two things easiest to get silently backwards, and both mutations
were caught.

Run live against production (81 real upcoming fights, every future
event): 81 picks written, 0 failures. Spot-checked three real flagged
fights against the function's own logic by hand — the symmetric
adjustment, the 50/50 anchor for unpriced fights, and the per-fighter cap
all matched exactly. Re-ran immediately after: 0 written, 81 unchanged,
confirmed directly against `updated_at` (every value still from the first
run) — idempotency verified against real timestamps, not just the
summary counts.

**Not built in G1, deliberately:** nothing yet surfaces the intern's pick
on the card view row (Flow 1's diagram shows one) — G3 covers "intern
lines on both boards" for the scoreboard specifically, but the card-view
row display doesn't clearly belong to any lettered sub-phase as written.
Worth deciding explicitly before G3, not assumed into either.

---

## Phase H — Cleanup

| # | Sub-phase | Status |
|---|---|---|
| H1 | Remove Clans from nav and hide the frozen surface (routes stay reachable) | not started |
| H2 | Full-app accessibility and responsive audit | not started |

---

## Design cadence

The visual world was decided in v1 and is already shipped (CSS Modules, custom
properties, dark mode via `ThemeToggle`, sidebar + top bar shell). New screens
inherit it, so there is **no design-direction step** here — that step exists
for before any component exists, and components exist.

**No re-polish risk:** no phase in this roadmap defines or changes core visual
tokens, so nothing built early gets judged later against a look that moved
underneath it.

The two genuinely new dense surfaces are **C3/C4** (the card working view) and
**E1/E2** (the two boards). Those are where a per-phase audit earns its place;
H2 closes with a full-app pass.
