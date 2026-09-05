# Roadmap — v2

**Written:** 2026-08-29, after `app-architect`, `harness-setup`, and
`user-flow-mapper`.

**Sources:** [docs/PRD.md](docs/PRD.md) (product truth, MoSCoW),
[ARCHITECTURE.md](ARCHITECTURE.md) (10 resolved forks as of G1, 9
correctness-critical items as of G2, item #4 extended in G1), [docs/user-flows.md](docs/user-flows.md)
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

**F reliability fix (Phase 56, 2026-09-03).** The scheduled Rumour scan
job had failed every run since it shipped (2026-09-02) — `429` on
Bluesky's `com.atproto.server.createSession`, which is capped at 30/5min
and 300/day per account. The job re-authenticated per cold-cache call
(~28 `createSession` attempts per run across ~14 fights × 2 concurrent
searches), rate-limited its own account, and never recovered.
`bluesky.ts` now single-flights the auth and adds a 5-minute
post-failure cooldown — one attempt per run, whatever the outcome — and
`runRumourScanJob` aborts the card on a `BlueskyAuthError` instead of
retrying it per fight. See `CHANGES.md` Phase 56 and `PROJECT_FACTS.md`.
Live recovery still pending a clean scheduled run once the daily cap
ages out.

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
| G1b | Elo rating as a third, bounded adjustment — opponent quality, using only data this app already owns | **done** (2026-09-02) |
| G2 | Edge-gated betting — threshold plus confidence sizing, and **free to decline entirely** | **done** (2026-09-02) |
| G3 | Intern lines on both boards + a calibration check | **done** (2026-09-03) |
| G4 | The intern predicts method of victory too (DECISION / KO_TKO / SUBMISSION), and a card-level "Intern's read" panel on `/events/[id]` | **done** (2026-09-05) — not in the original roadmap; added after a user question about the intern's pick-vs-bet logic |

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

**G4 result.** `predictInternMethod.ts` (test-first) is a third pure
judgment alongside pick and bet: UFC base rates (~48/33/17 dec/KO/sub),
shifted toward a finish by matchup lopsidedness (a mismatch ends early)
and toward KO by a weight-class keyword bucket. **There is no
finish-rate data anywhere in this app**, so this is base rates plus the
two signals it does have — a stated assumption, gradeable once method
scoring exists (still a PRD Could-have, deliberately not built here).
`0035` makes `predicted_method` a 3-value enum; the human pick form's
free-text field became a 3-chip control to match.

The `InternCardRead` panel (`features/picks/`) is the whole card in one
collapsible table — pick, method, bet+stake, de-vigged market %, intern
%, edge — owner-only, above the fight list. `devigTwoWay.ts` was
extracted from `decideInternPick`'s inline anchor math so the panel and
the intern quote one market number. The fighter-mapping in
`buildInternCardReadRows` (the columns describe the *bet* fighter when
there's a bet, not the pick) is the tested bit — same
`probabilityForFighter` hazard G1 already had.

Run live against production (81 real upcoming fights, every future
event): 81 picks written, 0 failures. Spot-checked three real flagged
fights against the function's own logic by hand — the symmetric
adjustment, the 50/50 anchor for unpriced fights, and the per-fighter cap
all matched exactly. Re-ran immediately after: 0 written, 81 unchanged,
confirmed directly against `updated_at` (every value still from the first
run) — idempotency verified against real timestamps, not just the
summary counts.

**Not built in G1, deliberately at the time:** nothing yet surfaced the
intern's pick on the card view row (Flow 1's diagram shows one) — this
didn't clearly belong to any lettered sub-phase as written. Closed in G3,
alongside the calibration check, rather than left open any longer — see
G3's own result below.

**G1b result.** The user's real ask -- weigh who a fighter has actually
beaten -- turned into a real investigation before any code: pre-UFC/
regional history (KSW, LFA, Cage Fury, CFFC) is not reachable at all
(the API-Sports free tier this app already uses flatly refuses any
season before 2022, a real limit found live, and even inside the
allowed window a real fighter's history came back UFC-only); Tapology
and Sherdog were both ruled out on explicit policy (Tapology's own
`robots.txt` disallows Claude's crawlers by name; Sherdog's Terms of Use
prohibit scraping outright) rather than a technical wall; reading MMA
YouTubers'/TikTokers' own predictions was investigated too and mostly
ruled out the same way (TikTok: no free API, ToS prohibits scraping;
YouTube: transcripts need the video owner's own OAuth consent, and
title+description alone was judged too thin to bother with). Full trail
in `ARCHITECTURE.md` Fork 11.

**What shipped instead answers the same real question — "did this
fighter beat good people" — using only data this app already owns.** An
Elo rating (`lib/elo/`), the same math behind chess ratings, derived
purely from UFC win/loss/method history. Two decisions confirmed with
the user before building: one global rating per fighter, not per weight
class (most fighters have too few UFC fights for a per-division number
to ever settle); full history, snapshotted per fight, not
current-value-only (so a future G3 calibration check can ask what the
intern knew AT THE TIME of a past pick, not what it knows today).

Integrates the same way rumour flags already do — one more bounded,
signed adjustment on the market anchor (`eloAdjustment.ts`, capped at
±0.15), never a second prediction blended in. Confidence is now also
capped when either fighter has a thin rated-fight sample, directly
answering the debutant question raised while discussing this: the
intern's read of a debutant is close to a guess, and the confidence
number now says so instead of reading as confidently as a 10-fight
veteran matchup at the same raw probability.

A genuinely correctness-relevant distinction the schema itself can't
make on its own: `winner_id = null` means either a real draw or a No
Contest, and Elo has to treat them completely differently (a draw is a
real result, an NC must never move a rating at all). `method` text is
the only signal that disambiguates the two, and when it's null too,
excluded entirely rather than guessed — same "ambiguous, don't guess"
rule already applied to rumour-flag attribution.

Test-first, mutation-verified across `eloMath.ts`, `computeEloHistory.ts`,
and `eloAdjustment.ts` (31 tests) — the rating-update direction, the
chronological sort, the NC-exclusion guard, and the adjustment cap were
each independently confirmed load-bearing, plus the new confidence-cap
logic in `decideInternPick.ts` itself.

Verified live against production: the full settlement chain (now
including the Elo recompute step) ran against real data and correctly
produced a provable no-op — 0 settled fights exist in this app yet, and
it processed 0, wrote 0, matching reality exactly. Re-ran the intern job
immediately after: all 81 real upcoming picks correctly rewrote with the
new Elo line in their reasoning (everyone defaulting to the standard
1500 seed rating, since no history exists yet) and the new,
correctly-capped confidence — spot-checked directly against a real row.

**G2 result.** `decideInternBet.ts` — the second judgment, deliberately
its own pure function separate from `decideInternPick.ts`, per UC-2's
own rule that a pick and a bet "must not be collapsed." Combined only at
the I/O layer (`generateInternPicks.ts`) into `picks`' single
`reasoning` column, since the schema itself has no separate bet-reasoning
field.

Checks edge on **both** fighters, not just the predicted one —
`probabilityForFighter.ts` (C4) exists precisely because a bet may back
a different fighter than the pick, reused directly here rather than
assuming the predicted side always carries the better price.

One real decision confirmed with the user: **stake sizing scales with
edge AND confidence together**, not edge alone — the first real place
G1b's confidence cap (thin rated-fight sample → lower confidence) does
more than just change a displayed number. Two bets with identical edge
now get different stakes if one rests on a near-debutant matchup.

Test-first, mutation-verified (`decideInternBet.ts`, 11 tests) — the
edge-threshold gate and the both-fighters comparison were each
independently confirmed load-bearing. The threshold mutation was caught
by PRD UC-3's own headline example (a -6000 favourite, ~0 edge) coded
directly as a test case, not a synthetic number.

Verified live against real production data twice: the actual scheduled
job ran against all 81 real upcoming fights (all currently unpriced, so
every one correctly declined with "No price yet — can't bet," and the
run was confirmed idempotent on a second pass — 0 written, 81
unchanged). Separately, since `odds_snapshots` is immutable by trigger
even for `service_role` (no way to insert and later clean up a
fabricated price), the actual positive-edge path was verified by calling
the real functions directly against a real production fight (Dan Hooker
vs. Salahdine Parnasse) with a synthetic price and a real Elo gap: the
intern correctly flipped its bet to the side the market didn't favour,
computed a real 35% edge, and correctly sized the stake down for the
resulting low confidence (1.2u, nowhere near the 3u cap) — the
edge-and-confidence interaction confirmed working together against real
fighter IDs, not just in isolation.

**G3 result.** Getting oriented found the first half of this sub-phase
already done, as a side effect of how carefully E1/E2 were built: both
boards already query `picks` filtered by `author = "INTERN"` and already
render a real Intern line — `AccuracyBoard`'s head-to-head/full-card split
and `UnitsBoard`'s three-line shape were built correctly the first time,
before any real intern data existed, specifically so nothing would need
reworking once it did. Confirmed live: `getScoreboardData` ran end-to-end
against production with no changes needed to that part.

**What was actually still missing:** the calibration check itself, and
the still-open gap G1 named in its own result — the intern's pick never
showed on the card view row Flow 1's diagram specifies. Both closed here.

`computeCalibrationBuckets.ts` (`lib/scoring/`) answers "of the fights
called 70%, did roughly 70% happen" with six reliability-diagram bands
(50-60% up to 90-100%, plus a defensive "Under 50%" catch-all — nothing
in `0019_picks.sql`'s schema actually requires an estimate to favour the
fighter it names). Computed for **"me" and "intern" both**, each against
its own full settled population, not the accuracy board's head-to-head
restriction — calibration is asking whether a line's own stated numbers
meant what they said, a question every one of that line's own estimates
can answer regardless of whether the other line picked the same fight.
No chalk column: chalk has no independent probability estimate of its
own to be right or wrong about, only a fixed always-the-favourite
strategy. Rendered as a new `CalibrationTable` between the two boards and
the pick history table on `/scoreboard`.

Test-first, mutation-verified: the band boundary (a value landing on
exactly 60% must fall in 60-70%, not 50-60%) and the void-exclusion rule
(a draw/NC/cancelled pick has no correct answer to check its estimate
against, the same rule the accuracy boards already apply) were each
independently confirmed load-bearing.

The card-view gap closed via a fact already on record, not a new
decision: C1 established `picks` as owner-only, not public ("for now just
me until I prove the picks are actually reliable"), which resolved what
could otherwise have looked like an open question (should a read-only
visitor see the intern's pick?) — no, the same way they don't see the
owner's own pick, since the underlying rows aren't public regardless of
whose pick they are. `getInternPicksForFights` (`features/picks/api.ts`)
is a narrower sibling of `getMyPicksForFights`, fetched in the same
owner-gated branch of `/events/[id]`, and `BoutRow` now renders a small
"Intern: [fighter] (NN%, confidence N/5)" line above the owner's own
pick controls.

**Verified live, safely — real data, not fabricated:**
`getInternPicksForFights` was called directly against three real INTERN
picks already sitting in production (from G1/G1b/G2's own live runs) and
its output matched the raw table rows exactly, field for field.
`getScoreboardData`'s widened query (added `estimated_probability` to the
picks select) and the new calibration block both ran end-to-end against
production with no error — `settledCardCount: 0` and all six bands empty
on both lines, the correct, honest state given nothing has settled yet in
this app.

---

## Phase H — Cleanup

| # | Sub-phase | Status |
|---|---|---|
| H1 | Remove Clans from nav and hide the frozen surface (routes stay reachable) | **done** (2026-09-03) |
| H2 | Full-app accessibility and responsive audit | **done** (2026-09-03) |

**H1 result.** One-line change: `Sidebar.tsx`'s `NAV_ITEMS` no longer lists
`/clans` — the PRD's own "Should have" item names two options ("retire or
clearly hide... from navigation"), and this roadmap had already picked
the hide option when H1 was first scoped. `/clans`, `/clans/[id]`, and
`/invite/[token]` all still build and resolve, confirmed via `next
build`'s own route table. No other nav surface referenced `/clans`
(checked directly, not assumed) — the internal clan-sharing controls
inside the frozen `scouting-reports` feature stay untouched, since that's
the feature working as designed, not a nav link to hide.

**H2 result.** Mechanical detector (`detect.mjs`) run across the whole
in-scope tree (`src/app`, `src/features` excluding the frozen `clans`/
`scouting-reports`, `src/shared`) plus a manual pass over the app shell
and every remaining unaudited surface (`TopBar`, `WeightClassFilter`,
`AuthButton`, the fighters/events grids, `/conflicts`) — C3/C4, E1/E2,
and Phase F's own surfaces were already covered by their per-phase
audits and not re-walked here.

Three real, verified findings, fixed in this pass:

- **A repeated pattern, not a one-off**: `WeightClassFilter` and
  `AuthButton` are both hand-built trigger+panel disclosure widgets that
  closed on outside click but never on Escape, and never returned focus
  to the trigger — a real keyboard-navigation gap in both, found by
  reading each rather than assumed from the other. Extracted into one
  shared `useDismissableOpen.ts` (`shared/utils/`) the moment a second
  component needed the identical fix, per `CLAUDE.md`'s layer-boundary
  rule — fixes both at once and closes the door on a third copy later.
  `AuthButton`'s trigger was also missing `aria-expanded` entirely
  (`WeightClassFilter`'s already had it); added.
- **The fighter-search input had no accessible name** — a placeholder
  alone doesn't reliably stand in for a label. Added `aria-label="Search
  fighters"` directly, matching the icon-only buttons right beside it in
  the same component, which already used the same pattern.
- **The search input's focus indicator was thin and asymmetric** — a 1px
  border-color change only, and the input's right edge carries no border
  at all by design (it visually merges with the search button), so focus
  showed on three sides at most. Added a `box-shadow` ring, which follows
  the pill's own `border-radius` and covers all four sides without
  changing the shape.

One finding reported, deliberately not fixed: `AppShell`'s and
`Sidebar`'s collapse-toggle transitions animate `margin-left`/`width`
(real layout-thrash properties, flagged by the detector). A like-for-like
fix would mean redesigning the sidebar as an overlay rather than a
push-layout — a real UX pattern change, not a bug fix — and the actual
cost is one 150ms reflow on a two-node tree, triggered only by a manual
toggle click, not a scroll- or route-linked animation. Left as a P3,
named rather than silently dropped.

One finding reported as a false positive, verified before dismissing:
the detector's `overused-font` rule flagged `body`'s `font-family: Arial,
Helvetica, sans-serif` in `globals.css` — this is the plain system-font
fallback stack shipped since v1, not one of the rule's own named
AI-slop faces (Inter, Roboto, Fraunces, Geist, Plus Jakarta Sans, Space
Grotesk), and the visual world itself was decided in v1 and is out of
this audit's scope regardless (see Design cadence below).

Full gate chain green after every fix (lint, 265/265 tests, clean build,
route table unchanged), and the detector re-run afterward returned the
same 3 findings — no regressions introduced, the two remaining ones
exactly the two deliberately left as-is above.

**Audit Health Score: 18/20 (Excellent)** — Accessibility 3/4 (real gaps
found and fixed this pass), Performance 3/4 (the two known, low-impact
transition items), Theming 4/4 (full token system, no hard-coded colours
found anywhere in scope), Responsive 4/4 (fluid grids, deliberate
horizontal-scroll tables, no fixed-width overflow risk found),
Implementation Integrity 4/4 (coherent, product-specific throughout —
every `onClick` in the entire in-scope tree is on a real `<button>`,
confirmed by a direct search, never a hand-rolled clickable `div`).

v2 is now feature-complete per this roadmap — Phases A through H are all
done.

---

## Phase I — What the intern actually knows about a fighter

Added 2026-09-03, after a user question ("how can we make it increase
confidence?") turned into a real investigation. Confirmed with the user
before writing any of it.

**The finding that motivated this phase.** The intern's confidence sits
at 1–2/5 on every fight, and the cap is not the problem — the knowledge
base is. Verified live against production:

- **0 of 273 fighters have a win/loss record.** The `wins`/`losses`/
  `draws` columns have never been populated by anything, and
  `fetchFighter.ts` does not even request them.
- **146 of 146 fighters on upcoming cards have no `external_id`** — the
  API-Sports enrichment has never run for them. They are name-only rows
  created by the Wikipedia schedule sync. A current champion reads as
  `0-0-0` with no height, reach, or stance.
- **57 real results already sit in `fights` that Elo cannot see**,
  because Elo reads `settled_at IS NOT NULL` and those were never run
  through this app's settlement pipeline. Backfilling them alone would
  change nothing for the current card, though — **checked, and zero of
  the 146 upcoming-card fighters appear in those 57 fights.**

**Verification spike run first** (2026-09-03, via a temporary Actions
workflow since the API key is not in `.env.local`), and it changed the
plan:

- **API-Sports returns no W/L record at all.** The full fighter payload
  is `id, name, nickname, photo, gender, birth_date, age, height,
  weight, reach, stance, category, team, last_update`. A record must be
  DERIVED by counting fight history, never fetched. (`team` — the
  fighter's camp — `nickname` and `photo` are available and unused.)
- **Name matching works**: `search=Hooker` → one exact hit, `search=
  Pantoja` → one exact hit. Small sample, so low-confidence matches
  should route to `data_conflicts` like the odds matcher already does.
- **The free tier serves seasons 2022–2024 only.** 2025 and 2026 are
  both refused outright. It is September 2026, so API-Sports history is
  ~20 months stale — it can lift the confidence cap honestly for
  veterans, but is blind to all recent form.

| # | Sub-phase | Status |
|---|---|---|
| I1 | ⚠️ Elo reads *happened-and-has-a-winner*, ordered by **event date**, not `settled_at`. Unlocks the 57 existing results; every later sub-phase depends on it | **done** (2026-09-03) |
| I2 | ⚠️ Fighter matching + enrichment — resolve the 146 orphans to API-Sports ids, low-confidence → `data_conflicts`; populate external_id, height/reach/stance, weight, nickname, team | **done** (2026-09-03) |
| I3 | Fight-history backfill 2022–2024 — resumable and quota-aware, creating opponent rows so Elo can propagate opponent quality | **done** (2026-09-03) |

**I3 result.** `fetchFighterSeasonHistory` (`fetchFightHistory.ts`) hits
the same `/fights` resource the existing recent-results sync already
uses, just scoped by `fighter`+`season` instead of `date`, sharing its
UFC-only filter and entry parsing. `processFightHistoryEntries.ts`
extracted the event/fighter/fight upsert sequence straight out of
`syncJob.ts` once this became the second caller needing it — `syncJob.ts`
itself is unchanged in behaviour, no longer duplicating the logic.

`backfillFightHistory.ts` is self-throttling and resumable with **no new
queue table**, same shape as I2's `enrichment_checked_at`: the query is
`external_id is not null and history_backfilled_at is null` — "already
enriched, not yet checked" is the queue. A discovered opponent gets its
own `fighters`/`fights` rows (so Elo can rate them as a real graph node)
but its *own* history is deliberately not chased recursively in the
same run — unbounded otherwise. If that opponent later becomes
independently enriched, they reach the front of this same queue on
their own turn, no special-casing needed.

Once-daily schedule at 18:00 UTC — 6h clear of both `sync.yml` runs and
`fighter-enrichment.yml`, evenly spacing the four jobs now sharing
API-Sports' 100/day free-tier budget across the day.

**Verified live against production, and the result was itself
informative.** The first real run hit the day's quota already exhausted
— every one of the day's other jobs (two sync runs, the enrichment job,
plus this session's own testing) had already spent it. All 5 fighters in
the batch failed identically (`"You have reached the request limit for
the day"`), and that's exactly the case the design exists to handle
gracefully: caught per fighter, none marked `history_backfilled_at` (so
all 5 retry cleanly on the next run), zero partial writes, and the job
itself still completed and logged a real `job_runs` row — confirmed
directly: `status: "success"`, `failed: 5` in the summary. A batch job
completing with every individual item failing is the correct shape
(same as I2's own `failed` field), not a bug to paper over — a systemic,
permanent failure would show the identical pattern forever, so if `job_runs`
ever shows `fight_history_backfill` failing every attempt for several
days running, that's the signal to look, not something a health banner
currently surfaces automatically (none was added, matching I2's own
precedent).

**Stated honestly:** the happy path — a real fighter's history actually
being fetched and written — has *not yet* been observed live, only the
graceful-degradation path. The very next scheduled run (once today's
quota resets) is that first real proof; check `job_runs` for
`fight_history_backfill` to see it.
| I4 | Verification spike + Wikipedia backfill for the 2025–mid-2026 hole (only if the spike shows the existing parser can read a past event's results table) | **done, gap-only** (2026-09-03) |
| I4b | Merge the duplicate "UFC 330" (2026-08-15) / "UFC 330: Makhachev vs. Machado Garry" (2026-08-16) events; this also settles the 10 I1b fights and the 1 open conflict on them | **done** (2026-09-04) |
| I5 | Derive `wins`/`losses`/`draws` from the fight graph; surface record + tale-of-the-tape in the UI | **done** (2026-09-05) |

**I4 result.** The spike passed — Wikipedia's `{{MMAevent bout}}` template
is identical for finished and upcoming cards, so `fetchEventSchedule`
reads a past event's results with no changes. `0034` adds
`events.wikipedia_backfilled_at`; `selectBackfillEvents.ts` (test-first)
is the queue filter; `processScheduleEvent.ts` was extracted from
`syncSchedule.ts` (I3-style) for the shared one-event pipeline;
`backfillWikipediaHistory.ts` + `wikipedia-history-backfill.yml` (daily
21:00 UTC, zero API-Sports budget) work the queue 15 events/run at 1.5s
spacing.

**~65 gap events (Jan 2025 → Aug 2026) backfilled clean** — fights
146 → ~970, fighters 273 → ~786, every bout with real winner/method/round;
`upsertFighter`'s I2b fold held (only ~3-4 duplicate identities, all
known name-order/diacritic cases).

**The scope pick (Option A, "all past events") was wrong and was
recovered live.** Reprocessing 3 already-curated events (Phases 52-54)
opened ~9 spurious `disputed_opponent` conflicts. The job is now
**gap-only permanently** — it skips any event that already has fights.
The 2 contaminated non-330 events were reverted to their exact pre-I4
state (8 conflicts deleted, `wikipedia_*` cleared on 18 adopted rows, no
fight rows were inserted so none deleted). Settlement + Elo propagate the
new depth on the normal schedule.

**I5 result.** No migration — `fighters.wins/losses/draws` have existed
since `0001` and were already selected and typed; they were simply always
`0`, displayed nowhere, while the fighter page rendered a *different*
number counted on read. `deriveFighterRecords.ts` (pure, test-first, 11
tests) does the counting; `recomputeFighterRecords.ts` does the I/O and
rides the settlement chain as a fourth tracked step, `recompute_records`.
Every exclusion rule is shared with Elo via the extracted
`isNoContestOrAmbiguous.ts` rather than re-decided, so a record and a
rating can never describe the same fight differently. The tape
(`TaleOfTheTape.tsx`) shows record / height / reach / stance / Elo with
differentials, and both surfaces state that the record covers tracked
fights only, never a career total.

**Correcting this phase's own premise, on the record.** Phase I was
justified by "the intern's confidence is capped because no fighter has a
record." That is not what the code does — `InternFighter` is `{id, name,
eloRating, ratedFightCount}`, and `decideInternPick.ts` tempers
confidence by `minRatedFightCount`. **The intern has never read a W/L
record.** The cap was already lifting from I1–I4b's Elo depth. I5 is a
human-facing feature (`docs/PRD.md` should-have), not the intern fix
this phase advertised.

**A latent Elo bug was found while building I5 and fixed in the same
pass.** `recomputeEloRatings.ts` scanned `fights` and `events` with bare
`.select()` calls. PostgREST can cap a response (`db-max-rows`) and
returns a **short list with no error** — and `fights` passed ~950 rows
during the I4 backfill. Elo was within roughly one event of rebuilding
every rating from a silently partial graph. `lib/supabase/selectAllPages.ts`
now pages both scans (and the record job's): ordered by primary key,
because PostgREST guarantees no stable order otherwise and unordered
ranges can overlap or skip rows, and advancing by rows *returned* rather
than the size *requested*.

**I1 is also a correctness fix, not just an unlock.** Ordering Elo by
settlement timestamp rather than by when the fight actually happened is
wrong on its own terms — settlement order is not chronological order,
which is the very reason `recomputeEloRatings` does a full rebuild.

**Rate limits shape I2/I3.** 146 searches plus 146 × 3 seasons ≈ 580
requests against a 100/day free-tier cap, shared with the twice-daily
sync. This cannot be a one-shot script — it needs a resumable job that
works a queue over several days and tracks its own progress.

**I2 result.** `decideFighterMatch.ts` mirrors `lib/odds/matchFights.ts`'s
auto-match/review-queue shape exactly — same 0.85 threshold reasoning,
own constant so the two are free to diverge. `nameSimilarity` moved from
`lib/odds/` to a neutral `lib/text/` the moment a third feature needed
it — `lib/rumours/` was already importing across from `lib/odds/` before
this move even started, so the move was overdue, not premature.

`enrichFighters.ts` is self-throttling and resumable with **no new queue
table**: the query is `external_id is null and enrichment_checked_at is
null` — "not yet enriched, not yet even attempted" IS the queue, the
same one-table preference D1 already established. Checked on every
attempt regardless of outcome, so a fighter is only ever searched once.
A low-confidence best guess opens a fourth `data_conflicts` kind
(`low_confidence_fighter_match`) with the **full ranked candidate list**
snapshotted, not just the top guess — same reasoning `rankFightMatches`
already serves B6's queue — wired into `/conflicts` via a new
`LowConfidenceFighterMatchCard`, `ConflictCard`'s exhaustive switch
extended to match.

Test-first, mutation-verified throughout: `matchFighterCandidate.ts` (the
threshold gate), `resolveFighterMatch.ts` (the owner's manual
resolution — refusing an external id that isn't one of the conflict's own
snapshotted candidates, rather than silently treating it as "no match").

**Verified live against production, twice, at the real scheduled batch
size (40) — not a token sample.** First run: 40 attempted, 28 matched, 0
queued, 3 genuinely absent from API-Sports, **9 failed**. Every failure
was the identical error: `"The Search field may only contain
alpha-numeric characters and spaces."` — a real, previously-undocumented
API-Sports limit (found live, the same way Phase 5's date-window and
rate-limit cutoffs were), rejecting diacritics (Maurício, José, Álvarez),
hyphens (Doo-ho, Joo-sang), an apostrophe (O'Neill), and a trailing
period (Aswell Jr.).

Fixed same-day with `sanitizeSearchQuery.ts` (folds diacritics via a new
`foldDiacritics.ts` — itself extracted from `nameSimilarity`'s own
internal fold once a second consumer needed it — then replaces any
remaining disallowed character with a space, never a delete, so
"Doo-ho" becomes "Doo ho" rather than the harder-to-match "Dooho").
Applied only to the outgoing query; the actual match comparison still
uses the real name, diacritics and all. All 9 real failures became
regression fixtures. Re-ran live immediately after: **40 attempted, 26
matched, 0 queued, 13 not found, 1 failed** — down from 9.

**The one remaining failure is a real, separate finding, not an I2
bug.** `fighters_external_id_key` rejected the write because that
external_id was already claimed — by a **second row for the same real
person**: Wikipedia's sync had written "André Lima" (accented, no
`external_id`) while an earlier API-Sports sync had already written
"Andre Lima" (unaccented, already enriched) as a separate row.
`upsertFighter.ts`'s name-matching fallback is a plain case-insensitive
exact match that never folds diacritics, so the two were never
recognized as the same fighter. This predates I2 and reaches beyond it
— `syncJob.ts`/`syncSchedule.ts`'s core matching, not just enrichment —
so it is not patched inside this pass. Tracked as **I2b** below rather
than rushed: fixing `upsertFighter.ts`'s own matching is a higher-blast-
radius change than a review queue, and deserves its own test-first pass
rather than a late addition to this one. In the meantime this specific
row retries (and fails identically) once per scheduled run — one wasted
request/day, small and bounded, not a reason to delay I2b.

Combined across both live runs: 80 fighters attempted, 54 matched, 0
queued for review, 16 confirmed absent from API-Sports, 1 known,
diagnosed, tracked failure. Queried directly afterward, not the summary
lines: 152 fighters now hold an `external_id` (98 pre-existing + 54 new),
16 checked with no API-Sports match, 105 remaining in the queue — will
clear over the next ~3 daily runs at the real batch size.

**Stated honestly:** the `low_confidence_fighter_match` conflict path
(the review queue itself) has **not** been exercised live — zero of the
80 real attempts landed below the 0.85 threshold with at least one real
candidate. Unit- and mutation-tested, not yet proven against a real
queued row; worth a first live check once one actually occurs.

| # | Follow-up | Status |
|---|---|---|
| I2b | `upsertFighter.ts`'s name-fallback doesn't fold diacritics, producing duplicate rows across sync sources for accented names (found live: "André Lima" / "Andre Lima", external_id 2679) | **done** (2026-09-03) |

**I2b result.** `namesMatchExactly.ts` (`lib/text/`, mutation-verified)
is a NEW, separate kind of match from `nameSimilarity.ts`'s fuzzy score
on purpose: exact after folding case/diacritics/whitespace, nothing
looser, because this backs an automatic, unattended write —
`nameSimilarity`'s fuzzy score is for review queues a human looks at,
never for a silent merge. `normalizeName.ts` extracted out of
`nameSimilarity.ts`'s own internal fold along the way, the third
consumer for the identical transform. Mutation-verified: swapping the
exact match for a substring check broke the one test built specifically
to catch a false-positive merge (`"Dan Hooker"` must never match
`"Dan Hooker Jr"`).

`upsertFighter.ts`'s existing `ilike` exact-match fallback stays first
(cheap, handles the common case with one row fetched); only when that
finds nothing does it fetch every fighter's name and check
`namesMatchExactly` — paid only on the path that was already about to
either insert a new row or (as here) miss a real duplicate, not on every
call.

**Live investigation surfaced something bigger than the original
finding, not fixed in this pass.** The orphan "André Lima" row wasn't
dead data — it's referenced by a real `fights` row (fighter2 in "André
Lima vs. Namsrai Batbayar," UFC Fight Night: Nurmagomedov vs. Song,
2026-08-29). A **second, separate** fight row exists for the exact same
real bout — Wikipedia's sync wrote one (orphan Lima as fighter2, no
result), API-Sports' sync wrote the other (the enriched Lima as
fighter1, with a winner). Two fight rows, one real bout, because the two
sources' Lima never resolved to one fighter id.

**This should have been caught by A2's own disputed-opponent detection
(Fork 5) and was not** — `sharesExactlyOneFighter` should fire on this
exact shape (Batbayar shared, the two Limas differing), and confirmed
directly: zero `data_conflicts` rows exist for either fight id. Why the
existing safety net missed this specific case is not yet understood and
is a real open question, tracked separately (**I2c** below) rather than
guessed at. The code fix here (I2b) prevents the fighter-identity split
that caused it from happening again; it does not merge the two already-
duplicated fight rows already live in production — that is a genuinely
destructive, multi-table repair (reassign a fighter id on one fight row,
reconcile which source's result is authoritative, retire the orphan
fighter row) and is being brought back as an explicit question rather
than done unilaterally.

| # | Follow-up | Status |
|---|---|---|
| I2c | Why did A2's disputed-opponent detection not catch the live André/Andre Lima fight duplication? Investigate before assuming the fix is only the diacritic fold above | **done** (2026-09-03) |

**I2c result.** The code was never broken — replayed `sharesExactlyOneFighter`
directly against the real Lima/Batbayar rows and it returns `true` in
both directions, today. The real explanation: **A2's detection only
runs when `upsertFight` is called on a write.** It has no mechanism that
retroactively checks fights already sitting in the table before it
shipped (2026-09-01). This event is dated 2026-08-29; once a past
event's sync window closes, nothing ever calls `upsertFight` for it
again, so a duplicate from before A2 existed is permanently invisible to
it — no bug required, just a gap between "protects every future write"
and "was ever applied to what already existed."

**Swept the whole table for the same shape, not assumed to be one-off.**
`clusterFightsBySharedFighter.ts` (pure, mutation-verified — union-find
over the exact same `sharesExactlyOneFighter` relation A2's live path
already uses) found **10 real clusters** across 158 fights, not 13
isolated pairs: two of the "13 pairwise matches" first found were edges
within two genuine **3-fight chains** ("Gauge Young" implicated across
three rows; "Ce Liu"/"Junior Tafa"/"Levi Rodrigues Jr." similarly),
where a naive pairwise sweep would have double-resolved the same fighter
across two independent conflicts and left a dangling reference. Caught
by a mutation test built specifically to require checking every pair,
not just array-adjacent ones — a real gap in the first version of the
test suite, closed before it could hide anything.

Of the 10 clusters, **8 were clean 2-fight pairs and are not name-
matching bugs alone** — only 2 were the diacritic case I2b already
fixes going forward (André/Andre Lima, Márcio/Marcio Barbosa). The other
6 span nickname forms (Wesley/Wes Schultz, Stan/Stanley Dorsainvil),
name-order swaps (Liu Ce/Ce Liu), and missing spaces in transliterated
names (Aori Qileng/Aoriqileng) — none of which I2b's exact-after-fold
match would ever catch, and several of which are genuinely different-
looking names an automatic merge should never attempt at all.

`sweepLatentDisputedOpponents.ts` resolves the 8 clean pairs by reusing
the **existing** disputed-opponent conflict machinery unmodified — zero
new UI. The one real difference from the live path: there, a candidate
only ever exists as JSON inside `details` because `upsertFight`'s
conflict branch runs *instead of* an insert; here, both sides of every
pair already exist as real rows, so the candidate's row is deleted as
part of opening the conflict (its full data snapshotted into `details`
first) — otherwise resolving through the existing action would silently
leave an orphan duplicate no matter which side the owner picked.
Confirmed live before anything ran: zero `odds_snapshots`/`picks`/
`rumour_flags`/`data_conflicts` referenced any of the 22 rows involved.

**A real finding from the live run itself, not assumed safe in
advance:** the first attempt failed outright — `fighter_elo_history` has
an FK on `fight_id`, and several of these pre-A2 duplicates carry a
genuine recorded result that I1's Elo recompute had already rated.
Confirmed the failure left nothing partially written (0 conflicts opened,
158 fights still present) before fixing it: each candidate's own
`fighter_elo_history` rows are cleared explicitly before its `fights`
row is deleted, then one full `recomputeEloRatings()` runs after the
whole sweep — simpler and more obviously correct than hand-patching
individual ratings, and a no-op when nothing rated was actually removed.

The 2 three-way clusters are **not** resolved automatically — the
existing conflict shape is exactly one "kept" vs one "candidate", and
force-fitting a real three-way chain into it risked losing information
rather than surfacing it. Reported, left as real rows, for a human (or
a proper N-way extension, if this pattern recurs) to look at directly.

**Verified live afterward, against the real tables, not the summary
line:** 150 fights remaining (158 − 8), exactly 9 open `disputed_opponent`
conflicts (8 new + the 1 pre-existing Wood/Andrusca), every new
conflict's kept/candidate pairing resolves to the correct real fighter
names, all 6 fights in the two skipped clusters still present and
untouched, `fighter_elo_history` at 82 rows (down from 94 — exactly
94 − 12 cleared, confirming the math, not just trusting it).

| # | Follow-up | Status |
|---|---|---|
| I2d | Resolve the 2 real 3-fight clusters `sweepLatentDisputedOpponents.ts` deliberately left untouched (Gauge Young; Ce Liu/Tafa/Rodrigues Jr.) — needs either a manual one-off look or a genuine N-way extension of the conflict shape if this pattern recurs | **done** (2026-09-03) |

**I2d result.** Both clusters turned out to be the identical real-world
shape: an originally-announced opponent got replaced, and the sync had
independently captured both the before and after as separate rows —
the same story as the Wood/Andrusca and Johns/Rosas fixes in the
conflict-resolution pass, just with a third stale row involved instead
of two clean ones. Wikipedia's current page gave a definitive, sourced
answer for both (not a guess): "Stanley Dorsainvil def. Gauge Young"
and "Liu Ce def. Levi Rodrigues Jr." — neither mentioning the third
name in either cluster (Kody Steele; Junior Tafa) at all.

Handled as a direct, manual repair rather than routed through
`data_conflicts` — unlike Louie Sutherland, there was no genuine
ambiguity left for an owner to judge; Wikipedia, one of this app's own
two trusted sources, had already settled it. For each cluster: filled
in the real method/round (and, for Cluster B, the weight class — the
surviving row was missing it entirely) on the one row matching
Wikipedia exactly, deleted the two stale rows, and deleted one
resulting fully-orphaned unenriched fighter row ("Liu Ce," 0 fights, 0
external_id). Kody Steele and Junior Tafa's own fighter records were
left untouched — both real, enriched fighters simply not on these
particular cards after the replacement.

A concrete correctness bug this closed, not just tidiness: Gauge
Young/Dorsainvil's result had been counted TWICE by Elo (two separate
fight rows, each with a real winner, both feeding the rebuild) —
confirmed by the recompute's own numbers before and after (45 fights
processed → 44, 90 snapshots → 88, exactly matching the one duplicate
that had been contributing).

Verified live against the real tables: 0 of the 4 deleted fights still
present, both surviving rows show exactly the filled-in Wikipedia data,
the orphan fighter row gone, Kody Steele's and Junior Tafa's own rows
untouched, 146 total fights (150 − 4).

**All open conflicts and known latent duplicates are now resolved**,
except the one still-open, genuinely-ambiguous case (Louie Sutherland)
that needs a real person identified, not inferred.

**I1 result.** `isResolvedForElo.ts` (pure, mutation-verified) replaces
`settled_at IS NOT NULL` as the eligibility rule, and ordering moved to
the event's own date. Both halves were wrong before: production had 57
fights with a recorded winner and **zero** settled fights, so the rebuild
ran over an empty set; and settlement order is not chronological order,
so even once fights did settle they would have been rated in the wrong
sequence — silently, since Elo is sequential. `0030_elo_occurred_at.sql`
renames `fight_settled_at` → `fight_occurred_at`, since the column now
holds an event date and the old name would mislead the next reader.
Applied live to `vrwlfcywyfzfczajpdoh` with confirmation.

Ran the settlement chain live afterward: **57 resolved fights processed,
94 rating snapshots written**, up from 0. Real ratings now exist.

**A real data-integrity problem surfaced by doing this, worth its own
entry.** 57 fights went in but only 47 were rated. The 10 skipped were
caught by `computeEloHistory`'s defensive guard — written in G1b as a
"this should never happen" check — for having a `winner_id` matching
**neither of the bout's own two fighters**. All 10 are still on the old
positional `external_id`, and the pattern is unmistakable: `UFC 330:7`
(Luque vs Gore) records **Donte Johnson** as winner, who is the fighter
at `UFC 330:6`; `UFC 330:8` records **Tresean Gore**, who is at `:7`.
This is the same position-collision bug fixed in Phase 47, but from
before D1 — back then `upsertFight` wrote `winner_id` directly, so a
shifted card stamped the wrong bout's winner onto the row. Those 10 rows
therefore record a factually impossible result. Not yet repaired: no
picks have settled against them so nothing is mis-scored today, but I5
(deriving records from the fight graph) must not read them, and the
honest repair is I4's past-event Wikipedia backfill re-deriving the true
winners. Tracked as **I1b** below.

| # | Follow-up | Status |
|---|---|---|
| I1b | Repair the 10 fights whose `winner_id` matches neither fighter — clear the impossible values, then let I4's past-event backfill re-derive the real ones | **done** (2026-09-03) |

**I1b result.** Listing the rows in full before touching them caught
something that would have made the repair worse than the disease:
`method` and `round` were populated too ("KO (punches)", round 1, and
so on), stamped from the same collided write, describing a different
bout's finish. Clearing `winner_id` alone would have left a method
behind — and `isResolvedForElo` returns true on a method alone, while
`computeEloHistory` reads winner-null-plus-non-NC-method as a **real
draw**. The 10 rows would have been promoted from "excluded" to
"fabricated draws that move ratings". All three fields were cleared
together.

Verified against the real table afterward, not the write's return value:
0 rows still holding any result value, 0 impossible winners remaining
anywhere, 47 fights still carrying a valid recorded winner. Re-ran the
Elo rebuild: **47 processed, 94 snapshots** — byte-identical to before
the repair, which is the proof that the cleared rows were contributing
nothing and no rating moved.

`0031_winner_must_be_in_the_bout.sql` then makes the state
unrepresentable rather than merely absent: a CHECK that a winner is one
of the bout's own two fighters, matching what `0019_picks.sql` already
enforces for a pick's predicted fighter. Elo's app-level guard stays as
defence in depth — it is what caught this in the first place, and it
protects the ordering logic that a column constraint cannot see.
Live-tested in a rolled-back transaction: an outsider is rejected, a
real participant still accepted.

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
