# Roadmap v2 — conflict-queue correctness

`ROADMAP.md` (2,012 lines, Phases A–O) is the historical record and stays
frozen as-is. Everything from Phase P onward is planned and tracked here.
When in doubt about anything before Phase P, read `ROADMAP.md`; for
anything current, read this file.

---

## Phase P — the conflict queue is mostly noise

### The trigger

2026-09-20, live on production: `/conflicts` showed **21 open conflicts**,
and UFC 331's Patrício Pitbull vs Choi Doo-ho bout was stuck unpriced and
unsettleable. The screen was unusable — nearly every row offered "Patrício
Pitbull vs Choi Doo-ho" as a candidate match at **4%**, **8%**, even **0%**
confidence.

### What the 21 actually are — measured, not assumed

Queried live against `vrwlfcywyfzfczajpdoh`, 2026-09-20:

| Kind | Open | Verdict |
|---|---|---|
| `low_confidence_odds_match` | 19 | **1 real, 18 noise** |
| `disputed_opponent` | 2 | **1 real, 1 a duplicate-fighter bug** |
| `low_confidence_sherdog_match` | 0 | — |

**Exactly two of the 21 deserve a human.** The rest are a cascade from a
single root cause.

### Root cause — one missing character class in `normalizeName`

`fighters` holds two rows for the same person:

| id | name | `sherdog_id` | `external_id` | source |
|---|---|---|---|---|
| `47009323` | Choi Doo-ho | 56689 | null | Wikipedia |
| `1e57b95c` | Dooho Choi | null | 690 | API-Sports |

`namesLikelySamePerson` should have folded these automatically — its
name-order-swap rule exists for exactly this shape. It fails on one
character. `normalizeName` folds diacritics, case and whitespace but
**leaves hyphens untouched**, so the token-swap comparison is:

```
["choi", "doo-ho"]  sorted -> "choi doo-ho"
["dooho", "choi"]   sorted -> "choi dooho"     <- not equal, only the hyphen
```

Strip the hyphen and the existing rule folds them correctly with no new
matching logic at all.

### The cascade, in order

1. The fold fails → `upsertFight` opens a **`disputed_opponent`** on the
   Pitbull bout rather than inserting a second row (correct behaviour,
   wrong premise).
2. An open `disputed_opponent` excludes the fight **from both boards** —
   so it never gets priced, and therefore never leaves
   `fetchEligibleUnpricedFights`' candidate set. It is now a permanent
   candidate.
3. Every other UFC 331 bout priced correctly and dropped out of that set.
   The stuck fight became the **only** eligible candidate in the ±36h
   window.
4. `decideMatch` (`matchFights.ts:141`) has **no lower bound**. Any odds
   event with at least one candidate in the date window files a
   `low_confidence_odds_match` — including a 0.000 score. So every already-
   priced UFC 331 event, plus unrelated Polish regional (KSW) bouts sharing
   the date window, scored garbage against the one stuck fight and filed a
   conflict.

Real confidence distribution of the 19:

- **0.816** — `Patricio Pitbull vs Dooho Choi`. The genuine odds event for
  the stuck fight, sitting just under `AUTO_MATCH_THRESHOLD` (0.85) —
  depressed by the very same hyphen/order gap.
- **0.231 and below** — the other 18. Top noise score is 0.231; there is a
  **0.585-wide empty gap** between the real match and the best fake one.

12 of the 19 point at the stuck Pitbull fight. The other 7 point at five
UFC 331 fights that have **since been priced correctly** (`snaps = 1`) —
their conflicts were simply never closed.

### The four defects

| # | Defect | Evidence |
|---|---|---|
| **D1** | `normalizeName` doesn't fold punctuation, so `namesLikelySamePerson`'s existing swap rule misses hyphenated Korean/compound names | Choi Doo-ho / Dooho Choi, live |
| **D2** | `decideMatch` has no minimum-confidence floor — "no plausible candidate" is indistinguishable from "ambiguous candidate" | 18 rows ≤0.231, one at 0.000 |
| **D3** | A `low_confidence_odds_match` is never auto-closed when its fight later gets priced | 5 stale rows, all `snaps = 1` |
| **D4** | Odds-conflict dedup keys on raw `oddsEvent.id`, so a feed re-emitting the same bout under a new id double-files | `Łukasz Charzewski` and `Lukasz Charzewski` both queued |

### Structural finding — the identity spine is 18% deployed

**150 of 845 fighters have a `sherdog_id`; only 151 have ever been
checked.** `fighters.sherdog_id` is `unique`, so had both Choi rows been
resolved, the second would have collided on 56689 and proven them the same
person *structurally* — no string matching involved. Name matching is
currently carrying load that a real identity key already exists to carry.
This is the durable fix behind the tactical ones.

---

## The goal is a standing guarantee, not a cleanup

The Choi case is a *symptom*. Fixing it and closing 21 rows leaves the
project in exactly the state it was in the day before — correct right now,
with nothing checking that it stays correct. The next hyphen, the next
romanisation, the next feed rename lands on a future card and reproduces
the whole cascade, and we find out the same way we found out this time:
by looking at a broken screen.

So Phase P is structured in three tiers, and **only Tier 3 is the actual
deliverable.** Tiers 1 and 2 are prerequisites for it being worth anything.

| Tier | Question it answers | One-time or standing |
|---|---|---|
| **1 — Repair** | Is the data correct *today*? | one-time |
| **2 — Prevent** | Will the *next* fighter ingest cleanly? | standing, at ingestion |
| **3 — Verify** | How would we find out if it didn't? | **standing, recurring** |

Tier 3 exists because every defect in this phase shares one property:
**nothing failed.** No job errored, no test broke, no build went red. 19
bad rows and a stuck fight accumulated silently across days of green CI.
Lint, types and tests cannot see this class of problem — only an assertion
about the data itself can.

### What Tier 3 asserts, on a schedule

A new daily integrity sweep — pure database reads, no external API cost, so
it can run as often as we like. Each invariant is a thing that is *supposed*
to be true; a violation opens exactly one conflict/alert, deduped, rather
than accreting:

| # | Invariant | Would it have caught this? |
|---|---|---|
| I1 | No two `fighters` rows fold to the same person under the structural rules | **Yes — Choi Doo-ho / Dooho Choi, at ingestion** |
| I2 | No fighter on an upcoming card lacks `sherdog_checked_at` | Yes — Dooho Choi was never checked |
| I3 | No fight inside its T-12h window is unpriced *and* unconflicted | Yes — the Pitbull bout, days early |
| I4 | No open `low_confidence_odds_match` whose candidate fight is already priced | Yes — the 5 stale rows |
| I5 | No open conflict older than 7 days | Yes — a queue nobody drains is as bad as no queue |
| I6 | No two open conflicts describing the same bout | Yes — the double-filed Charzewski |

`PROJECT_FACTS.md:146` already records that duplicate detection **only ever
runs on a live write and has never swept the existing table**. I1 is that
missing sweep, and it is the single highest-value invariant here.

### Card readiness — the number to look at before every card

A rollup over the next upcoming card, surfaced where the existing "Odds job
degraded" banner already lives (`features/job-health/`, which today tracks
only 2 jobs and one metric):

```
UFC 332 — 2026-10-03 · T-6d
  fights priced          11 / 13   ⚠ 2 pending (normal before T-12h)
  fighters Sherdog-linked 24 / 26  ⚠ 2 unresolved
  open conflicts           0
```

This is what turns "the data is accurate" from a hope into something that
can be read in three seconds before a card, and alerted on when it drifts.

---

## Sub-phases

Each is one `feature-planner` pass, shipped as its own PR off `main`.

| # | Sub-phase | Correctness class | Status |
|---|---|---|---|
| **P0** | **Immediate unblock, no code.** Resolve the Pitbull `disputed_opponent` via `/conflicts`' existing "Same fighter, different name → Merge identities" action. `merge_fighters()` is confirmed live in production (2 args). **Must keep `sherdog_id` 56689** — the keeper-selection rule prefers `external_id`, which would pick the row that *lacks* it (`PROJECT_FACTS.md:206`). Verify the id survives before and after. | Manual, verified read-back | **done 2026-09-20** — merged live (`sherdog_id` 56689 kept, `external_id` 690 acquired), conflict `e12cef25` resolved with `resolution='merged_fighters'`, fight `8233dc55` confirmed open-conflict-free |
| **P1** | **D1 — punctuation fold.** `normalizeName` strips/folds `-`, `'`, `.` before the existing comparisons. Deliberately no new rule, no edit distance — this only lets the *existing* structural rules see through punctuation. Correctness-critical: it widens an unattended auto-merge, where a false positive welds two careers together (I2b). Failing test first, mutation-verified, plus a dry-run sweep over all 845 fighters reporting every *new* pair it would fold, reviewed before anything merges. | **Correctness-critical — test first** | **done 2026-09-20** — dry-run swept all 355,746 pairs among 844 fighters, 0 newly-flipped pairs (the one real case, Choi Doo-ho, was already merged in P0); harness sanity-checked directly against the fixed source before trusting the zero |
| **P2** | **D2 — review floor.** New `MIN_REVIEW_THRESHOLD` in `matchFights.ts`; below it `decideMatch` returns `no_candidates`, not `low_confidence`. Real data supports a wide-margin choice: genuine match 0.816, best noise 0.231. Proposed **0.50**, roughly mid-gap and far from both. Kills 18 of the 19 rows. | Correctness-critical — test first | **done 2026-09-20** — shipped together with P0 in PR #89 (`phase-p-conflict-queue-p0-p2`); `MIN_REVIEW_THRESHOLD = 0.5` live in `matchFights.ts`, `decideMatch` returns `no_candidates` below it, covered by `matchFights.test.ts` (confirmed 2026-09-21; this row was previously mismarked "not started") |
| **P3** | **D3 — auto-close stale rows.** When a fight gains an `odds_snapshots` row, or an odds event matches confidently, resolve any open `low_confidence_odds_match` pointing at it. Closes rows on the next job run rather than leaving them to accrete. | Correctness-critical — test first | **done 2026-09-20** — `matchAndSnapshot.ts` now closes any open row whose `candidateFightId` already has an `odds_snapshots` row, `resolution='fight_priced_elsewhere'`; runs live on the next scheduled job, no bulk mutation needed (the one remaining open row is still genuinely unpriced) |
| **P4** | **D4 — dedup on the bout, not the feed id.** Key the already-queued check on normalized `(home, away, commence date)` instead of `oddsEvent.id`, so a re-emitted event under a new id doesn't double-file. | Correctness-critical — test first | **done 2026-09-20** — `buildOddsEventDedupeKey` (sorted `normalizeName`d home/away + commence date) replaces the raw `oddsEvent.id` dedup key |
| **P5** | **One-time cleanup of the existing queue.** After P1–P4 are live, close the rows the new logic would never have filed. Dry-run first, per the bulk-mutation rule. | Dry-run mandatory | **done 2026-09-21** — added `selectNoiseLowConfidenceConflictIds` (pure, tested, mirrors `selectStaleLowConfidenceConflictIds`), then ran a read-only dry-run against production (`vrwlfcywyfzfczajpdoh`): of 80 historical `low_confidence_odds_match` rows, only 1 is still open (the genuine Pitbull/Choi match, 0.816, correctly above the floor) — P3's auto-close, live since P3 shipped, had already drained every noise row as its candidate fight got priced. **Zero rows needed closing**, so no mutation was run; the one-off dry-run script was deleted after use, not committed |

#### Tier 2 — prevention at ingestion (standing)

| # | Sub-phase | Correctness class | Status |
|---|---|---|---|
| **P6** | **`sherdog_id` collision becomes a duplicate *finding*, not a job failure.** Today a fighter resolving to an already-taken `sherdog_id` throws, gets caught at `resolveSherdogIdentityJob.ts:221`, and is counted as `failed` — the single strongest duplicate signal the schema can produce is currently discarded as an error. It should open a merge proposal instead. This is the structural replacement for string matching: **two rows proven to be one person by a unique integer, no name comparison involved.** | **Correctness-critical — test first** | **done 2026-09-20** — new `sherdog_id_collision` conflict kind (migration 0062, applied to `vrwlfcywyfzfczajpdoh`); `attemptSherdogWrite` predicts a collision via a read first (so `dryRun` can report it with no write attempted) and falls back to catching the real unique violation for the rare TOCTOU race; owner resolves via `/conflicts` with "merge" (reuses `checkMergeGuard`/`mergeFighters`) or "not same person" |
| **P7** | **Resolve identity on ingestion, not on tomorrow's cron.** The job already scopes correctly to upcoming cards (`event_date >= today`), but runs once daily at 03:00 UTC — so a fighter created by `sync.yml` at 00:00 stays name-only for 3 hours, and the odds job (every 2h) can act on them first. Chain identity resolution directly after the sync step so a new fighter is Sherdog-linked in the same cycle that creates them. No new API budget — same calls, earlier. | Sequencing | **done 2026-09-20** — `sync.yml` now runs `runResolveSherdogIdentityJob.ts` right after its two syncs and the same-card name-variant resolution; `sherdog.yml`'s own 03:00 UTC run is unchanged (still drives history import/refresh/proposals, and its own identity step is now a fast idempotent safety net) |

#### Tier 3 — standing verification (the actual deliverable)

| # | Sub-phase | Correctness class | Status |
|---|---|---|---|
| **P8** | **The integrity sweep.** New daily job asserting I1–I6 above. Pure DB reads, no external quota. Each violation opens one deduped conflict/alert. **I1 is the sweep this project has never had** (`PROJECT_FACTS.md:146`) — it walks the whole `fighters` table for structural duplicates instead of only checking on live write. Every invariant gets a test that proves it fires on a seeded violation and stays silent on clean data. | **Correctness-critical — test first** | **done 2026-09-20** — I1 opens a `data_conflicts` row (`structural_duplicate_fighters`, merge UI matching P6's `sherdog_id_collision`); I4/I6 auto-remediate directly, no row left behind; I2/I3/I5 open/self-close a new `integrity_alerts` row (migration `0063`), visibility-only, surfacing deferred to P9 (`DECISIONS.md`, 2026-09-20). New `.github/workflows/integrity.yml`, own daily cron + concurrency group, `job_runs: "integrity_sweep"`. `reviewer` pass caught a real bug before ship (I1's dedupe guard only checked open rows, so an owner's `not_same_person` verdict would silently reopen on the next sweep — fixed, regression test added). 1150/1150 tests passing, lint clean, `tsc --noEmit` clean, production build clean. Migration `0063` confirmed applied to production (`vrwlfcywyfzfczajpdoh`) 2026-09-21 via `supabase migration list --linked` and `db push --linked --dry-run` (`upToDate: true`). |
| **P9** | **Card readiness rollup.** The pre-card number: priced / Sherdog-linked / open conflicts for the next card, on the existing job-health surface. Extends `TRACKED_JOB_NAMES` (2 jobs today) into a real data-integrity panel rather than a second parallel system. | Judgment/presentation | **done 2026-09-21** — `buildCardReadiness` (pure, tested) + `getCardReadiness` (`features/job-health/api.ts`, reuses `fetchNearestUpcomingEventId`/`fetchPricedFightIds`/I2's `sherdog_checked_at` definition/the two conflict lookups in `conflicts/api.ts`) + `CardReadinessPanel` component. Placed on `/events/upcoming`, not global `AppShell` chrome like `JobHealthBanner` — that banner is degraded-only and disappears on a healthy day, this panel is meant to be checked every time. Verified live against the dev server against production data: `UFC Fight Night: Rosas Jr. vs. Barcelos · T-6d`, `fights priced 0/11 ⚠ 11 pending (normal before T-12h)`. 1159/1159 tests, lint clean, build+typecheck clean |
| **P10** | **Backfill the historical spine.** 694 fighters have never been Sherdog-checked. Deliberately **last and lowest priority** — they are overwhelmingly *not* on upcoming cards, so they do not threaten the accuracy of future picks. Throttled at the existing 1.5s, resumable via `sherdog_checked_at`, many runs. | Throughput | **shipped 2026-09-21, running** — `resolveHistoricalSherdogBacklog` (`resolveSherdogIdentityJob.ts`, shares its per-fighter resolution loop with the upcoming-card job via a new `resolveSherdogIdsForQueue` extraction) queries the whole `fighters` table for `sherdog_id`/`sherdog_checked_at` both null, ordered by `id`, batch-limited. Verified with a live dry-run against production: 10/10 auto-matched, 0 failed. Wired as `sherdog.yml`'s new step 7, `--batch=50`/day (smallest batch, lowest priority, sized to fit whatever time budget steps 1–6 leave) — expected to take ~14 daily runs to clear all 694. `job_runs: "sherdog_backlog"`. 1159/1159 tests, lint clean, build clean |

### Sequencing

**P0 first** — unblocks the stuck fight today, no deploy. Then **P2**
(lowest risk, kills 18 rows), then **P1** (the root cause, but the riskiest
change in the set since it widens an unattended auto-merge). **P3/P4**
independent, either order. **P5** closes out the repair tier.

Then the part that actually matters: **P6 → P7 → P8 → P9**. P6 and P7 are
small and make P8's invariants mostly *pass by construction* rather than
firing constantly. **P8 is the deliverable** — it is the only thing in this
phase that answers "how would we find out next time," and every tier-1 fix
is disposable without it.

**P10 whenever.** It improves historical depth, not forward accuracy.

### Explicit non-goals

- **Not removing a data source.** Each of the four sources is the only
  source for its job, and the Wikipedia/API-Sports results cross-check has
  caught real staleness in *both* directions (`PROJECT_FACTS.md:98`).
  Conflict volume is a name-matching problem, not a too-many-sources
  problem.
- **Not loosening `AUTO_MATCH_THRESHOLD` (0.85).** P1 raises the real
  match's score at the source; the threshold itself stays where it is. A
  wrong auto-match silently corrupts every downstream number.
- **Not auto-resolving `disputed_opponent`.** The Junior Tafa / Chris
  Barnett / Sean Sharaf row is a genuine booking change and exactly what
  the queue is for. The queue working correctly means a *small* queue, not
  an empty one.

---

## Phase Q — the betting journal

### The trigger

The app answers *"is this one moneyline price wrong?"* The owner bets a
portfolio of slips per card: singles, accumulators, method-of-victory and
double-chance, stakes from ₱74 to ₱500. `picks` cannot express any of it
— `unique (fight_id, author)` forbids a second bet on a fight, and
`check_pick_constraints()` requires `bet_fighter_id` to be one of *that
fight's two fighters*, so no accumulator and no method market is even
representable.

### What 16 real tickets changed about the design

Shapes here came from the owner's actual bet slips (2026-08-23 →
2026-09-13), not from a guess at what a bet looks like:

| Finding | Consequence |
|---|---|
| His book prices `Double Chance`, `Method Of Victory. Decision W1`, `W1 By KO/TKO/DQ`, `How The Bout Will Be Won` — all markets The Odds API does **not** serve (`h2h_3_way` → `422`, double-chance already rejected per `PROJECT_FACTS.md`) | Method bets run on **his entered price**. Phase R demoted to optional reference data. |
| One accumulator parlays a **US Open tennis set** with a UFC moneyline; another is a **Road to UFC** bout | `bet_legs.fight_id` is **nullable**, with `external_description` as the fallback |
| `How The Bout Will Be Won` names no fighter; `W1 By KO/TKO` does | `METHOD_FIGHT` and `METHOD_FIGHTER` are separate markets |
| Every ticket carries a bookmaker number | `bookmaker_bet_id unique` — the backfill's idempotency key |
| One ticket displays combined odds `4.475` but paid `447.55` on ₱100 — the full-precision product of `1.68 × 2.664` | Payout is computed from **leg prices**, never from displayed combined odds |
| 158 settled production fights have `method = null` (API-Sports never reports one) | A method leg on those returns `undetermined`, never a guess |

### Sub-phases

| # | Sub-phase | Correctness class | Status |
|---|---|---|---|
| **Q1** | Schema: `bankroll_ledger`, `bet_slips`, `bet_legs`. RLS mirroring `picks`; `won/lost/void` gated to `service_role` while `cashed_out` stays owner-writable (only the person who took it knows it happened); an explicit DELETE policy, which `picks` deliberately lacks. `pnl_php`/`pnl_units` are **generated columns**, so payout and P&L cannot drift apart. | Correctness-critical | **done 2026-09-21** — migration `0064` applied to `vrwlfcywyfzfczajpdoh`, verified by read-back |
| **Q2** | Settlement engine: `normalizeFightMethod` (free-text Wikipedia prose → a settleable method), `settleLeg` (5 markets), `settleSlip` (roll-up, void-leg repricing). | **Correctness-critical — test first** | **done 2026-09-21** — 63 tests, red before green; all 16 real tickets reproduce their printed payout |
| **Q3** | Backfill the 16 tickets, keyed on `bookmaker_bet_id`. Three legs were cut off in the screenshots — their prices are derived from the product rule (2.15 Sola, 1.23 Martinez, 2.17 Elliott) but **market and selection need owner confirmation** before writing. | Bulk mutation — **dry-run mandatory** | not started |
| **Q4** | UI: record a slip (archetype, legs, taken prices, stake, book), list open slips, settle / cash-out. | Judgment | not started |
| **Q5** | Per-archetype units/ROI line + bankroll curve, and the INTERN-vs-owner head-to-head the tickets already support — Elliott, Bukauskas, Hooker and Rahiki all overlap fights INTERN priced. | Judgment | not started |

### Baseline the journal starts from

16 slips, **9W–7L**, ₱3,378.49 staked, ₱7,175.21 returned, **+₱3,796.72
net (ROI +112%)**. Caveat stated up front: **₱2,095 of that is a single
slip.** Sixteen tickets settle nothing — the point of Q5 is to find out
which archetypes actually earn, not to celebrate this number.

### Explicit non-goals

- **Not touching `picks`.** It is the calibration/scoreboard backbone and
  its INTERN/chalk unit series must stay continuous.
- **Not changing `decideInternBet`'s 0.5–3u ramp.** Kelly staking (Phase
  S) applies to slips only; re-staking INTERN mid-series would break the
  measured comparison it exists to provide.
- **Not an LLM portfolio assembler.** Assembling a slate under exposure
  and correlation constraints has a right answer — it is a deterministic
  reduce, for the same reason `decideInternPick` is deterministic.

---

## Phase R — market data beyond the moneyline

### R1 — verification spike (done 2026-09-21)

**Question:** can the app ingest method-of-victory odds (by KO/TKO, by
submission, by decision) so INTERN can price the markets the owner
actually bets?

**Answer: no, and it is not a coverage gap.** Every method market key
returns `422 INVALID_MARKET` from The Odds API — `method_of_victory`,
`fight_method`, `to_win_by_ko`, `to_win_by_submission`,
`to_win_by_decision`, `go_the_distance`, `round_betting`, `total_rounds`.
Those keys do not exist in the provider's schema for MMA. **Method prices
stay manual entry**, which is what `bet_legs.price` was built for.

**But the spike found something free that is not being used:** `totals` —
over/under ROUNDS — is live, with 3 books (`betonlineag`, `betus`,
`bovada`). It is the closest legitimate proxy to method betting available
at zero cost: under 1.5 ≈ a finish, over 2.5 ≈ goes the distance. And
`predictInternMethod` already produces exactly the read needed to price it.

Two methodology notes worth keeping, both in `PROJECT_FACTS.md`: additional
markets are served **only** by the per-event endpoint, and a
"market returns no books" result is meaningless without an `h2h` control on
the same event — the first event probed returned zero books for `totals`
and would have been wrongly written off. Cost: **5 credits** (373 → 368).

**Paid alternatives priced and rejected.** Odds-API.io starts at **$65/mo
≈ ₱3,700**; the owner's 16 recorded tickets netted +₱3,796.72 over three
weeks, so the cheapest tier would consume ~97% of the profit from that
period — and its 2 bookmakers still would not include the PH-facing book
actually bet into.

### Sub-phases

| # | Sub-phase | Correctness class | Status |
|---|---|---|---|
| **R1** | Verification spike: which markets does the provider actually serve? | Spike | **done 2026-09-21** |
| **R2** | `round_totals` ingestion: new table (not `odds_snapshots`, whose `unique (fight_id)` and immutability triggers cannot hold a second market), fetched **once per card** — never the 2h cadence, which would blow the 500-credit tier. | Correctness-critical | not started |
| **R3** | Price the totals line against `predictInternMethod`'s existing finish-vs-decision read, and surface an edge where one exists. | Correctness-critical — test first | not started |

### Explicit non-goals

- **Not buying a method-odds feed.** Rejected on arithmetic, not taste —
  see above. Revisit only if the bankroll changes by an order of magnitude.
- **Not treating provider prices as bettable.** The owner bets a PH-facing
  book with different lines and richer markets. Everything ingested here is
  a **reference line for finding edges**, never the price actually struck.
