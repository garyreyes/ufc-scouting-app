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
