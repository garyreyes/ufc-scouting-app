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
