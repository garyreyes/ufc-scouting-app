# Decisions

Why real forks were resolved the way they were. One entry per decision
where a different answer was genuinely plausible — not routine choices.
Newest at the bottom.

Decisions made before this file existed (2026-09-12) live in
[ARCHITECTURE.md](ARCHITECTURE.md)'s numbered Forks (1–11) and the
per-phase notes in [ROADMAP.md](ROADMAP.md). They are not copied here.

---

## 2026-09-12 — L3-age: birth dates come from Sherdog, not API-Sports

**Decision.** `fighters.birth_date` is filled from Sherdog's fighter page
(`<span itemprop="birthDate">`, already parsed by `parseBio()`), through the
existing `bioFillPayload` never-overwrite path.

**Why.** The roadmap assumed API-Sports. Checked live: its `/fighters`
response has `birth_date` and `age` keys, but both were `null` on 18/18 real
fighters (3 champions + 15 production-enriched roster fighters). Sherdog
carried a date on 6/6 live pages checked, including two fighters API-Sports
returned `null` for.

**Alternatives considered.**

- API-Sports — the field is present but empty; building on it ships a
  permanently null column.
- Wikipedia infoboxes — not parsed per fighter today; a new scraper for data
  Sherdog already hands us.

**Consequence.** Age is only knowable for Sherdog-linked fighters (132 of 816
at the time). Everyone else gets no age signal (0), same as a missing reach.

---

## 2026-09-12 — L3-age: store `birth_date`, compute age at the card's date

**Decision.** Store the raw `birth_date date`; derive whole-year age in code,
measured on the fight card's date — never a stored `age` column, never "today."

**Why.** A stored age goes stale on every birthday. Measuring at the card's
date keeps a pick's inputs reproducible, which G3 calibration depends on.

**Alternatives considered.** A stored `age smallint` refreshed by a job —
rejected, it's a second value to keep in sync for no gain.

---

## 2026-09-12 — L3-age: a peak-age curve, not "younger wins"

**Decision.** `ageAdjustment.ts` scores each fighter by distance from a peak
window of **27–32**. Years below 27 count **half** (young fighters are still
improving); years above 32 count in full. The shift toward whoever sits closer
to peak is capped at **±0.04**, reached at an **8-year** weighted gap.
Examples: 29 vs 38 → +0.03 toward the 29-year-old; 23 vs 30 → +0.01 toward
the 30-year-old. Missing age on either side → 0.

**Why.** Age isn't monotonic the way reach is — a flat "younger is better"
rule is backwards for a green 22-year-old against a prime 29-year-old. The cap
is the weakest of the four intern signals (size is 0.06), because the window
edges and the half-weight are themselves unmeasured assumptions. It sits
inside the existing `MAX_TOTAL_ADJUSTMENT = 0.25` shared ceiling, unchanged.

**Alternatives considered.**

- Simple younger-favored signal (mirrors `sizeAdjustment.ts`) — simpler, but
  directionally wrong at the young end.
- Display-only, like stance (`L3-stance`) — the honest choice given no
  own-data measurement exists; the owner chose to ship a signal now instead.

**First dials to turn** if G3 calibration shows age-flagged picks
miscalibrated: the cap (0.04), then the window edges, then the youth weight.

---

## 2026-09-13 — L5: a 4th `FINISH` outcome, shared with the human pick form

**Decision.** `picks.predicted_method` gains a 4th value, `FINISH` ("ends
early, KO or submission, unclear which"), alongside `DECISION` / `KO_TKO` /
`SUBMISSION` (`0043_predicted_method_finish.sql`). It's reachable from both
the intern (`predictInternMethod.ts`) and the human pick form (`BetRow.tsx`,
which iterates `FIGHT_METHODS` and needed no code change).

**Why.** The user's own framing: "Decision, TKO/KO, Submission, finish (tko/
ko/submission) so finish for fighters that can actually finish in every
possible scenario." A fighter with a genuinely even KO/submission mix (or two
sides pointing in different directions) doesn't have an honest single-method
answer — forcing KO_TKO or SUBMISSION there is a coin flip dressed up as a
prediction. Making it a shared enum value (not intern-only) keeps both
authors comparable once method scoring is built (PRD Could-have).

**Alternatives considered.**

- Keep it 3-valued and force the closer of KO/SUB — rejected by the user;
  loses real information when the record genuinely doesn't favour a side.
- Intern-only value, not on the human form — rejected: a future method-
  scoring pass would need to treat the two authors differently for no real
  gain.

---

## 2026-09-13 — L5: method-of-victory driven by real Sherdog finish records

**Decision.** `predictInternMethod.ts` now uses the picked fighter's own
Sherdog win split and the opponent's own loss split — when BOTH sides have
one — to decide DECISION vs KO_TKO vs SUBMISSION vs FINISH, instead of
weight class alone. When either side lacks a Sherdog record, the original
weight-class-only rule applies unchanged (never produces FINISH).

**Why.** Live finding: the old rule called Fiorot vs Grasso a Fiorot
submission (women's flyweight → assumed 60% of finishes are subs) despite
Fiorot's real record being 7 KO / 0 SUB / 6 DEC. The data
(`sherdog_wins_by_ko/sub/dec`, `sherdog_losses_by_*`) has existed since J4
but was never wired in.

**Design, and why it isn't a straight replacement.** The two sides' finish
rates are combined with a **geometric mean**, not an average — going the
distance only needs ONE side to resist a finish (an opponent never finished
drags the fight toward decision even against a heavy finisher), so a low
share on either side should pull the combined number down harder than an
average would. That combined number becomes a **capped** nudge
(`MAX_RECORD_FINISH_SHIFT = 0.15`) on the same finish-pool-vs-decision test
the old rule already used — not a full replacement of it — and the KO-vs-
submission share is a **weighted blend** of the weight-class prior and the
two records (`WEIGHT_CLASS_VOTE = 0.35`), not fully record-driven. Both caps
exist because an uncapped first version, checked live against real history,
badly over-called finishes: 52.9% of a 68-fight both-sides backtest
population got a named-finish-or-FINISH call against a real finish rate of
only 29.4%, with FINISH calls right only 25% of the time (worse than
chance). A reviewer pass also found a straight 50/50 KO-share blend made
SUBMISSION mathematically unreachable in the heavy bucket (KO_SHARE.heavy =
0.85 floors the blend above the FINISH threshold) — the same class of dead-
branch bug RETROSPECTIVE.md already recorded once (Phase 62). `0.35` was
chosen as the largest weight-class vote that still leaves every bucket's
blend able to cross both the KO_TKO and SUBMISSION thresholds; a brute-force
per-bucket reachability test (`predictInternMethod.test.ts`) now guards it.

**Verified, not assumed.** `methodBacktest.ts` + `runMethodBacktest.ts`
(`npm run intern:method-backtest`, read-only) replay every Sherdog-linked
fighter's own decidable wins with a leakage-free pre-fight record (only
bouts strictly before the one being tested). Final numbers, 68-fight
both-sides population: new rule 74.1% exact-call accuracy vs the old rule's
69.1% on the same cases; FINISH called 20.6% of the time, right 64.3% of
those (well above the 29.4% real base rate for "was it a finish at all").

**Alternatives considered.**

- Require both sides to have data for the finish-record signal to apply at
  all, otherwise fall back — **confirmed as the design**, not an
  alternative: partial data (one side linked) uses the old rule, never a
  half-informed blend.
- A straight average instead of a geometric mean for combining the two
  sides' finish rates — rejected: it let a heavy finisher's own rate
  outweigh a genuinely finish-proof opponent, which the geometric mean's
  "either side can veto" behaviour fixed (verified on the Jourdain/Vera
  fixture, where Vera has never been finished in 12 losses).
- An uncapped, fully record-driven version — rejected after the backtest
  showed it over-calling finishes; see above.

**First dials to turn** if the backtest shows drift once more both-sides
data accumulates: `KO_VS_SUB_THRESHOLD` (0.65), then `MAX_RECORD_FINISH_SHIFT`
(0.15), then `WEIGHT_CLASS_VOTE` (0.35), then `SHRINKAGE_K` (8). Re-run
`npm run intern:method-backtest` after changing any of them — the 68-case
both-sides population is small, so treat a single run's numbers as
directional, not exact.

---

## 2026-09-13 — Tapology-Scraper rejected as a data source (Phase M)

**Decision.** github.com/ehan03/Tapology-Scraper will not be adopted, and
Tapology will not be scraped by any other means, to address the user's three
standing complaints (slow settlement, cancelled bouts lingering, recurring
conflicts).

**Why.** Checked the repo directly rather than taking the suggestion on
faith: its `items.py` collects event/bout/fighter identity fields only — no
winner, method, round, or stats field exists anywhere in its schema, so it
cannot address any of the three complaints even in principle. It only reads
Tapology's *results* pages, never upcoming cards, so it structurally can't
catch a cancellation either. It has 5 commits, all from December 2023, and
the author states "I will not be updating this repository." It also turns
off robots.txt compliance and rotates fake user agents to get around
Tapology's anti-bot defences; Tapology's own robots.txt blocks
`ClaudeBot`/`Claude-Web`/`anthropic-ai` by name. `PROJECT_FACTS.md` (G1b,
2026-09-02) had already ruled out Tapology for the same reason.

**Real root causes, found instead by reading this project's own pipeline**
(all measured live, 2026-09-13): `processScheduleEvent.ts` never reconciles
a bout removed from its Wikipedia source page (→ M2); resolving a
`disputed_opponent` conflict as "keep existing" records nothing, so a
same-card name variant reopens on the next sync (→ M3); `sync.yml`'s cron
runs ~3h late live, compounding the existing 24h single-source wait (→ M4);
9 Sherdog identity conflicts are common-name or nickname-only cases a
history cross-check could resolve (→ M5). See `ROADMAP.md` Phase M.

**Alternatives considered.**

- Building a fresh Tapology scraper from scratch — rejected for the same
  ToS/anti-bot reason as the existing one, independent of code quality.
- Wikidata's P2818 ("Sherdog fighter ID") property — not rejected, kept as
  an optional M5b spike. Different profile entirely: CC0-licensed structured
  data via SPARQL, no scraping, no ToS conflict. Verified live (4,797
  fighters; resolved 3 of the session's 9 open Sherdog ambiguities by label)
  before being added to the plan at all, per `verification-spike`.

## 2026-09-14 — M2: cancelled-bout UX, and when to trust "it's gone"

**Decision (confirmed with the owner).** A cancelled bout stays visible on
the card, greyed, reading "Cancelled — pick voided, stake returned" — never
silently removed. Same-card fighter name variants ("Jose Delgado" →
"Jose Miguel Delgado") get auto-merged and logged, not just asked about
forever (that's M3). The existing 24h single-source settlement wait is
unchanged.

**Why.** A removed row with no explanation is indistinguishable from a bug
to the owner — "why did my pick vanish?" A visible, labelled cancellation
answers that question on sight, at the cost of one more row on the card.

**The harder fork, resolved without asking (a reasonable default, not a
user decision): how long a bout must be missing before it's trusted as
cancelled, and what makes a parse untrustworthy in the first place.**
`upsertFight.ts`'s own header comment already documents a real incident
where treating a single sync's snapshot as ground truth corrupted a card
(a reordered Wikipedia page made one bout's identity collide with
another's). Applying that same naivety to "this bout is missing" would
risk cancelling a real, still-scheduled fight and voiding a real pick over
a transient page edit or parse hiccup — a worse failure than the one this
sub-phase fixes.

Landed on: `wikipedia_missing_since` set on the FIRST miss, cancelled only
once that has held **6 hours** (roughly the gap to `sync.yml`'s next run in
practice) — never cancelled on a bout's very first absence. Reconciliation
is skipped entirely (no writes, not even `markMissing`) when the fresh
parse dropped any malformed `{{MMAevent bout}}` block, found zero bouts, or
found fewer than half the card's existing bout count — each a sign the
parse itself is unreliable, not evidence of a real cancellation.

**Alternatives considered.**

- Cancel on the first miss — rejected: indistinguishable from a transient
  parse failure or a mid-edit Wikipedia page, and a wrongly-cancelled fight
  voids a real pick with no easy undo path once picks have settled around
  it.
- A longer grace window (24h, matching the single-source settlement
  timeout) — rejected as unnecessarily slow for a genuine cancellation,
  which is a removal the source has already committed to, not a pending
  result still resolving.
- No skip guards at all, trusting `markMissing`/grace-window timing alone
  — rejected: a parse that drops half a card's bouts (malformed markup, a
  botched page edit) would otherwise look identical to a real wave of
  cancellations and cancel real fights.

**First dial to turn** if a real cancellation is ever caught later than
expected, or a real fight is ever wrongly flagged missing: the 6-hour grace
window (`DEFAULT_GRACE_HOURS`, `planCardReconciliation.ts`).

**Addendum (reviewer pass, PR #68):** all of the above reasoning silently
assumed a still-upcoming card. `applyCardReconciliation` is also reached
from `refreshRecentEventResults.ts` (past cards, up to 30 days) and
`backfillWikipediaHistory.ts` (any historical card) -- neither of which
this decision considered when it was written. On a past card, editors
routinely trim or fold bout entries out of the live wikitext long after
the event for reasons unrelated to cancellation, so the same "missing
twice, 6h+ apart" signal would misfire. Fixed by skipping reconciliation
outright for any event dated before today, checked first, ahead of every
other guard -- see `applyCardReconciliation.ts`'s own comment.

## 2026-09-14 — M3: fighter aliases stay raw text; one hard merge guard, no exceptions

**Decision.** `fighter_aliases.alias` stores the dropped fighter's raw
display name, not a pre-normalized form -- the plan going in called for
`alias_normalized unique`. `upsertFighter.ts` reads the whole (small)
table and compares with the existing `normalizeName()` in JS, the same
"fetch broadly, decide in tested TypeScript" pattern the fold-match branch
right below it already uses.

Separately: `checkMergeGuard` refuses ANY merge -- automatic sweep or a
human clicking "same fighter" at `/conflicts` -- between two fighters
carrying two DIFFERENT confirmed Sherdog ids. No override path, for either
trigger.

**Why.** Every other "are these the same name" rule in this codebase
(`normalizeName`, `namesMatchExactly`, `namesLikelySamePerson`,
`nameSimilarity`, the new `isSameCardNameVariant`) already lives in
TypeScript. A `alias_normalized` column would mean reimplementing fold/
case/whitespace normalization in SQL and keeping two definitions of
"normalized" in sync forever, for a table that will only ever hold a few
hundred rows.

The Sherdog guard has no override because it isn't a judgment call -- it's
a fact already established by an earlier, separate confirmation (the
Sherdog identity job's own auto-match threshold and guard, J3). A human
clicking "merge" is real evidence two fighters are the same person, but
it does not outrank two independently-confirmed different Sherdog
records; if a human genuinely believes one of those Sherdog links is
wrong, the fix is to correct that link first (at the Sherdog identity
layer), not to force a fighter merge through it.

**Alternatives considered.**

- Normalize in SQL via a stored generated column or the `unaccent`
  extension (not currently installed) -- rejected: a second
  implementation of name-folding to keep aligned with the TS one, for no
  real gain at this table's size.
- Let a manual merge override the Sherdog guard with an explicit
  confirmation step -- rejected: the guard exists precisely because a
  Sherdog link is itself already a confirmed fact, not a guess; if it's
  wrong, fixing it is the correct place to intervene, not bypassing the
  guard downstream.

**Consequence, found while implementing, not anticipated in the plan:**
`fighter_sherdog_bouts` and `fighter_scouting_reports` are both
`on delete cascade` on `fighter_id`. `merge_fighters()` must repoint both
onto the keeper before deleting the dropped row, or the merge would
silently destroy the dropped fighter's real Sherdog bout history (and any
scouting notes) instead of just re-filing it under a different id. Traced
against the real production shape (Jose Delgado / Jose Miguel Delgado):
the keeper-selection rule prefers `external_id`, so the Sherdog-linked
identity is not reliably the side that survives.

---

## 2026-09-18 — N1: one model tier (Flash Lite), no strong-tier reducer

**Decision.** Phase N's map-reduce harness runs **every call on Flash Lite**.
There is no "strong tier" for the reduce step. The tiered design the phase
was planned around — cheap models for map, a stronger model for the final
decision — is dropped before it is built.

**Why.** The N1 spike measured the strong tier live and it failed on both
counts it was chosen for:

- **Availability**: 4 of 6 full-Flash calls returned `503 UNAVAILABLE`
  ("high demand"). `gemini-3.8-flash` and `gemini-3.7-flash` failed every
  attempt; `gemini-flash-latest` succeeded once in three. Every Flash Lite
  call in the same session succeeded.
- **Quality**: no reproducible gap. Across two card-level consolidation
  tasks with recency, attribution and relevance traps, Flash Lite scored
  6/7 graded items and was 4/4 stable over three repeats on the harder
  task. The strong tier completed only the 3-item task (3/3) and 503'd out
  of the harder one. A one-item difference on a single task is not
  evidence.
- **Latency**: 9.7–19.3s vs ~0.9s for Lite.

A reducer that is unavailable two-thirds of the time is not a reducer —
the fallback would be the real code path.

**Alternatives considered.**

- **Strong tier as best-effort with Lite fallback.** Rejected: at a ~67%
  failure rate most runs would be Lite anyway, so the shadow comparison
  would silently mix two models' output across rows.
- **Keep the planned two-tier design.** Rejected: it spends the phase's
  hardest engineering — per-surface reservations, an RPM guard, an atomic
  daily-cap reservation function — defending a 20/day ceiling that no
  longer binds anything.

**Consequence — simplification on the daily axis only.** The 20 RPD ceiling
stops being the binding constraint; typical load is ~100 Lite calls/day
against a 500/day budget, so per-surface daily reservations are no longer
needed and the daily allocator collapses to a single counter.
`llm_call_log` stays — it is what makes spend observable and replay
possible, and Gemini exposes no `ratelimit-*` headers to read instead.

**Amended same day, before any code was written.** The dashboard check that
cleared the RPD gate also showed `gemini-3.5-flash-lite` peaking at
**14/15 RPM** in production. **RPM, not RPD, is the real constraint**, and
Flash Lite's 15 RPM is 3x the strong tier's 5 — which reinforces this
decision rather than undermining it. But the "no RPM guard" clause above is
wrong: **pacing is still required**, just against a different limit than
the one originally designed for. See the N1 block in `PROJECT_FACTS.md`.

**Revisit if** the real scouting prompt (N7/N8) is measured — with that
prompt, not assumed — to need more than Lite delivers. The tier split can
be reintroduced behind `models.ts` without touching feature code.

---

## 2026-09-18 — N4: conflict proposals scoped to Sherdog matching, not fighter merging

**Decision.** N4's advisory LLM proposals target only `low_confidence_sherdog_match`
conflicts. `disputed_opponent`'s optional merge path (`merge_fighters()`,
`checkMergeGuard`) is deliberately out of scope, not just deferred.

**Why.** The approved plan's own justification for N4 conflated two
different mechanisms. Its worked example (Renato Moicano = Sherdog's
"Renato Carneiro") and its "10/10 already auto-resolved by the heuristic"
framing are both about `low_confidence_sherdog_match` — linking ONE
existing fighter row to an external Sherdog id via
`resolveSherdogMatchAction`. But the plan's literal checks section named
`checkMergeGuard`/`decideSameCardMerge`, which govern a structurally
different, higher-stakes action: merging TWO existing fighter rows into
one via `merge_fighters()`, used by `disputed_opponent`'s same-card-variant
resolution. A Sherdog match proposal's worst case is a fighter staying
unmatched a while longer; a wrong merge proposal's worst case is
irreversible data loss on the dropped row — exactly the failure mode
Phase M's own `0045`/`0046` migrations found and fixed live, twice, before
`merge_fighters()` ever ran safely.

**Consequence.** `reconcileSherdogProposals.ts`'s pure reduce step is a
uniqueness check on `fighters.sherdog_id` (real and schema-enforced), not
the plan's more general "a fighter is both keeper and dropped" graph
check — there is no keeper/dropped pair in this scope, only one fighter
per conflict choosing among external candidates.

**Alternatives considered.**

- Building both kinds in N4 as originally read. Rejected: would have
  meant designing a merge-proposal flow under real time pressure, on the
  exact path Phase M's own history shows is easy to get subtly wrong.
- `low_confidence_fighter_match` (the API-Sports analogue of the same
  candidate-list shape). Deferred, not rejected — the same architecture
  extends to it directly; skipped only to keep N4 to one clearly-verified
  surface rather than two half-verified ones in the same pass.

**Revisit if** `disputed_opponent` proposals are wanted later — that
would be a new sub-phase with its own checks (verifying a proposed merge
against `checkMergeGuard` for real, plus a graph check across the batch),
not a trivial extension of this one.

---

## 2026-09-18 — N6: the LLM-shadow promotion rule, pre-registered before N8 exists

**Decision.** Two rules, written now — before N8 writes its first shadow
pick — because deciding a promotion threshold after seeing the numbers
means picking whichever one agrees with what's already hoped.

**1. Promotion rule.** `LLM_ASSISTED` and `LLM_ONLY` (N8) are each judged
independently against the deterministic line, never against each other:

- **Minimum sample: 10 settled cards** with at least one scored shadow
  pick each, before either arm's Brier score is even looked at as a
  promotion signal. This reuses `SMALL_SAMPLE_THRESHOLD`
  (`app/scoreboard/page.tsx`) rather than inventing a second "enough
  data" number — the same threshold already governs when the real boards
  stop being a small sample, and there is no principled reason a shadow
  line needs a different bar.
- **Winning margin: the challenger's Brier score must be at least 0.02
  lower than the deterministic line's, over the same scored population.**
  0.02 is a judgment call, not a derived number — stated honestly. It is
  chosen to be small enough to be reachable (the useful range of a Brier
  score on this kind of binary forecast, 0 to 0.25, is not wide) but
  large enough that a margin this size is very unlikely to be sampling
  noise on a ~10-card, ~15-fights/card population. If real data later
  shows this bar is miscalibrated (too easy, too hard) that is itself
  something to record here, not silently retune.
- **No clear winner → the deterministic rule stays live.** Ties, a
  margin under 0.02, or either arm's Brier score being *worse* than
  deterministic's all resolve to "deterministic wins" — the rule never
  needs to justify staying, only a challenger needs to justify replacing
  it.
- Promotion is a **human decision** made by reading `/scoreboard`'s three
  lines once the sample gate clears — nothing in N8/N9 auto-promotes a
  shadow line into `picks.author`. This rule defines when the evidence
  supports asking, not an automated switch.

**2. Never backtest the LLM scout over settled historical fights.**
`methodBacktest.ts` (L5) is leakage-free because `predictInternMethod` is
a pure function reasoning only from data that existed before the fight —
it structurally cannot know the future. An LLM has no such guarantee: an
LLM asked to scout a named 2024 fight very likely has that fight's real
result somewhere in its training data, and nothing in the prompt can
prove it doesn't. A historical backtest would return a confident,
plausible-looking, and **entirely fake** accuracy number — the exact
"silently wrong, nothing in lint/tests/build can see it" failure mode
this project's own conventions exist to catch. **Forward shadow only**:
every `LLM_ASSISTED`/`LLM_ONLY` pick is scored only against a fight that
had not been fought yet at prediction time.

**Why now, not at N8.** Both rules constrain N8's own design (what
`shadow_picks` must record to make the promotion rule checkable later)
and N9's readout (`/scoreboard`'s three-line comparison) — writing them
after either exists risks quietly shaping the rule around what the code
already produces.

---

## 2026-09-18 — N7: client-side sleep, not retry-on-denial, for RPM pacing

**Decision.** `runMapReduce.ts`'s per-unit loop now unconditionally
`await`s a fixed `MIN_CALL_INTERVAL_MS` sleep before every reservation
attempt after the first (map or reduce), regardless of whether the
previous attempt was granted, denied, or errored. It does **not** retry a
denied reservation.

**Why this was a real bug, not a hypothetical one.** N2's architecture
doc said pacing would be "enforced in `geminiClient.ts` so no caller can
forget it," but the shipped code only built the atomic SQL reservation's
interval *denial* (`try_reserve_llm_call()`, `0047_llm_call_log.sql`) —
nothing ever waited and retried on that denial, and nothing paced calls
before attempting them. N2's own verification gate named exactly this
risk ("a pacer that is wrong is invisible until a card-sized run hits
429s") but N2/N3/N4's real unit counts (1, 1, ≤10) never fanned out fast
enough to trigger it. N7's real production run (24 fighters) was the
first genuine stress test this harness ever received, and it failed
exactly as predicted: 20 of 24 units denied on the first real run.

**Why a fixed sleep, not retry-on-`rate_limited`.**
`reserveLlmCall.ts` deliberately collapses every denial reason (daily
cap, RPM guard) into a uniform "budget denied" outcome — documented in
its own header as intentional, since callers degrade the same way
either way, and telling them apart server-side needs a second read of
rows the SQL function already scanned. Retrying selectively would have
required un-collapsing that distinction first, widening a boundary that
was deliberately kept narrow for a reason unrelated to this bug. A flat
sleep before every attempt (after the first) needs no new information
from the reservation layer at all, and its cost is bounded and known in
advance: an N-unit surface takes `(N-1) * 4.2s`, matching the ~2-minute
estimate the original architecture doc already gave for a 28-unit pass —
confirmed live (20 units, ~2m55s).

**Consequence.** Every surface (rumours, conflicts, scouting) now gets
this pacing for free from the shared file, without any surface-specific
code change — N3/N4 were exposed to the same latent gap, just never at a
unit count large enough to hit it.

**Revisit if** a future surface's real fan-out is large enough that a
flat `(N-1) * 4.2s` wait becomes the dominant cost of a job (e.g. N8's
per-card reduce alongside a large scouting map in the same run) — at
that point, un-collapsing `rate_limited` from `daily_cap` to allow
skipping the wait on a soft-cap/daily-cap denial (which retrying can't
fix) becomes worth the added surface area.

---

## 2026-09-18 — N8: shadow-picks job runs on its own cron, decoupled from scouting.yml

**Decision.** `shadow-picks.yml` is a separate scheduled workflow
(`"45 */6 * * *"`, offset from `scouting.yml`'s `"15 */6 * * *"` and
`rumours.yml`'s `"0 */6 * * *"`), not chained after scouting's job via a
`workflow_run` trigger or a second step in the same workflow.

**Alternatives considered.** Chaining would guarantee the reduce call
always reads this cycle's freshest dossiers, with no staleness window.
Rejected because it couples the two jobs' failure domains — a
scouting.yml failure (budget denial, a thrown error) would block shadow
picks entirely for that cycle, even though shadow picks could still
usefully reduce over whatever dossiers already exist from a prior run.
Chaining also adds real CI complexity (`workflow_run`'s own trigger
quirks, or a multi-step single workflow) for a surface with zero
user-facing consequence.

**Why the decoupled cost is acceptable.** N8 is explicitly a
measurement-only shadow line — nothing downstream reads it except future
`/scoreboard` comparison (N9) and a human promotion decision
(`DECISIONS.md`, 2026-09-18, "N6: promotion rule"). A few hours of
dossier staleness on an occasional run changes nothing about what's
being measured; independent failure domains and simpler CI outweigh it.

---

## 2026-09-18 — N8: shadow picks revise until card lock, append-only, latest-before-lock scores

**Decision.** `shadow_picks` has no uniqueness constraint forcing one row
per fight — a new reduce call before a card's lock time
(`starts_at - 6h`, the same lock Fork 10 uses for real picks) inserts a
new row rather than overwriting. For Brier scoring (N6, N9), only the
**latest row per `(fight_id, line)` recorded before that fight's lock
time** counts; earlier rows stay as history, matching N7's own
append-only precedent for `fighter_scouting_dossiers`.

**Why not one-shot.** A shadow pick that never revises doesn't test what
production behavior would actually look like — a real pick (Fork 10)
updates as new information (a late-breaking flag, a line move) arrives
before lock, and the honest comparison is against that same behavior, not
against a single first guess frozen in time.

**Why not overwrite-in-place.** Overwriting would destroy the audit
trail N9's replay tooling depends on (`npm run llm:replay --call-id=`)
and would make it impossible to later ask "did the model's read change
when a new dossier landed" — a question this measurement surface exists
to answer. Append-only costs nothing extra: the table is already
service-role-only with no row-count-sensitive UI reading it directly.

**Consequence for N8's scoring logic.** Any code computing Brier score or
accuracy over `shadow_picks` must first select, per fight and line, the
row with the latest `created_at` strictly before that fight's card lock
time — never the latest row unconditionally, which would leak
post-lock/post-fight information into a supposedly-forward-only
measurement (the same leakage this project's "never backtest" rule
exists to prevent). This lands as N9's responsibility since N9 owns the
readout, but is recorded now per this project's standing rule of writing
down a scoring/selection rule before the data it will be applied to
exists.

## 2026-09-18 — Conflicts dismiss action: bulk cleanup, and one shared "no_match" resolution string

Two forks resolved while planning the `low_confidence_odds_match`
dismiss action (`resolveLowConfidence.ts`/`actions.ts`/
`LowConfidenceCard.tsx`), both via `AskUserQuestion`.

**Fork 1 — clearing the 27 existing stale conflicts.** Chose a guarded
one-off bulk script over clicking through each row manually in the UI.
Same read-back-verified, idempotent pattern as the `0053` migration that
fixed their root cause (the orphaned Jimenez vs Vera fight) — a dry-run
prints exact scope before anything writes, matching `feature-planner`'s
own 5b requirement for any bulk write against existing rows.

**Fork 2 — resolution string.** Chose to reuse the exact `"no_match"`
string `buildFighterMatchResolution.ts`/`buildSherdogMatchResolution.ts`
already write for their own "owner rejected every candidate" case,
rather than inventing a second string (e.g. `"no_candidates"`) to
distinguish "the pool was empty" from "candidates existed but none were
right." Both are genuinely the same fact from a querying standpoint —
"this conflict was never resolved to a real match" — and the sibling
kinds already don't distinguish them either, so a new distinction here
would be a one-off inconsistency across all three conflict kinds for no
present analytics need. If a real need for the finer distinction shows
up later, it's a small additive change (a new resolution string plus a
migration of existing `"no_match"` rows), not a blocker to adding now.

---

## 2026-09-19 — Multi-free-LLM plan: Groq is per-item only, OpenRouter is best-effort only

**Decision.** Of the two candidate second providers approved for the
multi-free-LLM task-mapping plan (data-quality second opinions +
shadow-pick ensembling), Groq is scoped to **single-item prompts only**
(one fighter, one fight) — never the existing whole-card shadow-picks
prompt as-is. OpenRouter free models are scoped to **optional,
best-effort signals with a fallback**, never a required dependency.

**Why.** The Phase 0 spike (`PROJECT_FACTS.md`, "Groq and OpenRouter free
tiers, measured live 2026-09-19") measured both live, same methodology as
N1:

- **Groq's real free-tier limit is 8000 tokens/minute per model** (read
  off its own `x-ratelimit-*` headers, which Gemini doesn't expose at
  all). That's far below Gemini's 250K TPM. A full-card shadow-picks
  prompt bundles every fighter's Elo/reach/height/age/record/dossier/
  rumour-flags for an entire ~14-fight card in one call — it will not fit
  in 8000 tokens. Reliability was otherwise perfect (10/10 calls across
  two models, valid JSON, correct fact restatement every time), so the
  constraint is capacity, not availability.
- **OpenRouter's free models draw from a pool shared across all of
  OpenRouter's free-tier users, not a per-key quota** — `google/gemma-4-
  31b-it:free` failed 5/5 with a 429 explicitly citing the shared pool;
  `nvidia/nemotron-3-super-120b-a12b:free` did better (4/5) but still hit
  one live 503. This is the same failure shape N1 found for Gemini's
  strong tier: not broken, just not dependable enough to be a required
  step in any pipeline.

**Consequence for the plan's Phase 3 (shadow pick ensemble).** Running
Groq through the *existing* `buildShadowPicksPrompt.ts` card-level prompt
is not viable as designed. Either (a) give Groq a per-fight variant of the
prompt (more calls, each small enough to fit 8000 TPM, paced against its
1000-request-per-period budget), or (b) don't include Groq in Track B and
keep it to Track A's naturally single-item conflict second-opinion check.
Re-measure with the real per-fight prompt size before committing to (a).

**Consequence for Phase 2 (data-quality second opinion).** No change —
`conflictProposals`' second-opinion check is already single-conflict,
single-call, well inside Groq's token budget.

**Revisit if** Groq's published free-tier limits change, or if a future
session needs OpenRouter to be load-bearing rather than optional — at
that point, re-spike rather than assuming today's numbers still hold
(matching N1's own "revisit if measured, not assumed" clause).

---

## 2026-09-20 — Phase 2 (Track A): Groq second opinion only runs where Gemini already proposed

**Decision.** `proposeSherdogMatchesSecondOpinion.ts` only evaluates
`low_confidence_sherdog_match` conflicts that already have a live
`conflict_resolution_proposals` row from N4's Gemini pass. It never runs
independently on a conflict Gemini hasn't reached yet.

**Why.** "Agreement" as a concept requires two real opinions to compare —
running Groq independently would leave the agree/disagree badge undefined
until both jobs happened to have run, and would race N4's own scheduled
job for a conflict neither has looked at yet, with no benefit over just
waiting one cycle. Scoping to "Gemini already proposed" keeps the
comparison always meaningful the moment it appears.

**Alternative considered.** Run Groq on every open conflict on its own
schedule, independent of whether Gemini has weighed in. Rejected: adds a
race condition for new conflicts and a permanent "second opinion pending"
UI state for no real gain, since both jobs run on the same `sherdog.yml`
schedule anyway.

---

## 2026-09-20 — O3 (Track B): per-fight Groq prompt confirmed viable; Groq shadow picks are a separate job

**Decision 1 — per-fight prompt.** `buildShadowPicksPrompt.ts` is reused
unchanged, called with a single-fight array, as the Groq map unit's
prompt. Not a new prompt file.

**Why.** A live spike (`PROJECT_FACTS.md`, 2026-09-20) against a real
11-fight card measured ~2100 tokens total (prompt + output) for the
richest fight tested — roughly 4x headroom under Groq's 8000 TPM cap.
The 2026-09-19 entry's option (a) (a per-fight prompt variant) is
confirmed, not option (b) (dropping Groq from Track B).

**Decision 2 — separate job.** Groq's shadow-pick generation is a new
`generateShadowPicksGroq.ts` + `runScheduledShadowPicksGroqJob.ts`
(`job_runs: "shadow_picks_groq"`), not folded into the existing
`generateShadowPicks.ts`. Both reuse `fetchShadowPickCard`,
`applyShadowPickClaims`, and `shadowPickClaimChecks` unchanged; only the
map spec's `units`/`buildMapPrompt`/deps differ (whole-card single call
vs. per-fight fan-out, ~11-14 calls per card).

**Why.** Matches this project's own established pattern (O2 mirrored N4
the same way for conflict proposals) and keeps two providers with very
different call shapes and budgets independently schedulable, testable,
and gated in `job_runs`, rather than coupling their failure/retry
behavior into one script.

**Alternative considered.** One combined job looping over both
providers. Rejected: fewer files, but couples Gemini's 1-call-per-run
shape with Groq's ~11-14-call fan-out into a single script's error
handling, and a Groq-specific budget/pacing issue would then also risk
the Gemini line's own run in the same invocation.

**Real bug found while planning, not yet in production**:
`selectLatestBeforeLock.ts` dedupes shadow-pick rows by `` `${fightId}:${line}` ``
only. Once a second provider writes `LLM_ASSISTED`/`LLM_ONLY` rows for
the same fight, two different providers' rows for the same fight/line
would collide in that map and one would silently disappear from scoring.
The dedup key must become `` `${fightId}:${line}:${provider}` `` as part
of this phase, not deferred — this is what actually forces `provider`
to be a real column on `shadow_picks`, not just a label.

## 2026-09-20 — P8 (ROADMAP_V2.md Tier 3): three shapes for six invariants, not one

**Decision.** The integrity sweep's six invariants (I1-I6) don't all get
the same treatment. I1 (structural duplicate fighters) is a real owner
judgment call — full `data_conflicts` treatment: new kind, review card,
merge action, same pattern P6's `sherdog_id_collision` already
established. I4 (stale `low_confidence_odds_match`) and I6 (duplicate
open conflicts for the same bout) are purely mechanical — the sweep
auto-remediates them directly, no conflict row, no owner action. I2
(missing Sherdog check), I3 (unpriced+unconflicted near T-12h), and I5
(conflict open >7 days) aren't disputes to resolve at all — a new
lightweight `integrity_alerts` table, visibility-only, self-healing, no
resolve action. Surfacing I2/I3/I5 nicely is explicitly P9's job, not
P8's.

**Why.** `ROADMAP_V2.md`'s own text ("Each violation opens exactly one
deduped conflict/alert") is compatible with all three shapes, and
literally treating every invariant as a `data_conflicts` row would mean
building five more conflict-card UI variants for kinds where there is
often nothing for an owner to actually decide — the `/conflicts` queue
would fill with rows nobody can resolve, undermining the queue's own
purpose (a small queue of genuine ambiguity, not a growing list of
process noise).

**Alternatives considered.** (a) Every invariant becomes a
`data_conflicts` row — rejected for the reason above. (b) Route
everything through job-health/`job_runs` summaries instead, including
I1 — rejected because I1 needs a genuine merge UI a summary line can't
provide; someone would have to fix a real duplicate-fighter finding by
hand outside the app.

**Real bug found during implementation, fixed before shipping (not a
design change):** the initial I1 dedupe guard in
`runIntegritySweepJob.ts`'s `openStructuralDuplicateConflict` only
checked for an *open* `structural_duplicate_fighters` row for a given
pair before deciding whether to insert a new one. Since I1 re-scans the
WHOLE `fighters` table every run (not just new rows), an owner resolving
a pair as `not_same_person` would see the identical pair reopen on the
very next sweep — the guard saw no open row and inserted a fresh one,
silently undoing the resolution forever. Caught by the mandatory
`reviewer` pass, not by the original test suite (which only tested
"doesn't stack while still open"). Fixed by widening the guard to check
for ANY existing row for the pair, open or resolved — a merge
resolution doesn't need separate handling, since merging removes one
side of the pair from `fighters` entirely, so the pair stops being
generated on future runs regardless. A regression test for the
`not_same_person` case was added alongside the fix.

---

## 2026-09-21 — the underdog floor overrides INTERN's pick/bet, not its model

**Decision.** `decideInternPick.ts` and `decideInternBet.ts` stay exactly
as they were: an honest, deterministic, market-anchored read of each
fight in isolation — this is explicitly what makes G3's calibration
check meaningful (`decideInternPick.ts`'s own docstring). The new "at
least one underdog per segment" rule is built as a separate,
post-processing override layer (`applyUnderdogFloor.ts`), applied in
`generateInternPicks.ts` AFTER every fight's honest pick and bet have
already been decided, never inside the two decision functions
themselves.

**Why.** User-observed, checked against real cards: a full favourites
sweep essentially never happens on a real UFC card — every card checked
had at least one underdog win in the main card and at least one in the
prelims (the Pantoja/Van 2 card's prelims underdog cited as the concrete
example). Nothing in the existing per-fight, card-blind design could
ever reflect that. Baking the rule into `decideInternPick` itself would
have corrupted the one property the project depends on for calibration
tracking — that `estimated_probability` is the model's genuine belief,
not a belief plus a card-level fudge. Keeping it as a separate, visibly
labelled layer (a "Card-sweep rule: ..." sentence appended to
`reasoning` whenever it fires) means the model's own honest read stays
inspectable and its calibration metrics stay uncorrupted, while the
floor's own cost is separately auditable.

**Scope, all user-confirmed 2026-09-21:**
- The pick floor and bet floor are independent. Forcing an underdog pick
  never forces a bet on it.
- The bet floor only redirects a bet INTERN was already going to place
  (its own edge gate said yes) onto the underdog instead of the
  favourite — it never invents a bet where INTERN saw no edge at all.
- When a segment needs a forced flip, the fight chosen is the one with
  the BIGGEST underdog price (most plus-money/"live"), not the one
  closest to a toss-up — a deliberate choice over minimizing the
  override's cost to the model's own read.
- Main card = the 5 fights with the lowest `bout_order`; everything
  else, including fights with no `bout_order` at all, is prelims. No
  fight is excluded from either segment.
- "Favourite"/"underdog" is a market concept (decimal price via the
  existing `determineFavorite.ts`), not the model's own probability —
  matches how the pattern was described (a sportsbook "underdog win").

**Alternatives considered.** Baking the rule directly into
`decideInternPick`'s own probability (rejected — corrupts calibration,
see above). Forcing the bet whenever the pick is forced (rejected,
user-confirmed — would mean INTERN knowingly stakes simulated money
against its own edge read on a fight it never priced as +EV). Flipping
the closest-to-toss-up favourite instead of the biggest underdog price
(considered, user chose the latter).

**Consequence.** `estimated_probability` on a floor-forced pick is
recorded as the underdog's own true (sub-0.5) model probability, not
massaged toward 0.5 — this is intentional and already fully supported by
the existing schema (`0019_picks.sql`'s only constraint is `0 <
estimated_probability < 1`) and by `computeCalibrationBuckets.ts`, whose
"Under 50%" bucket and comment ("nothing in the schema requires a pick's
estimate to favour the fighter it names") anticipated exactly this case
before this decision existed.
