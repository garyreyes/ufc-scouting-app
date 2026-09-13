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
