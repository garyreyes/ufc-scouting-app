# Roadmap — v2

**Written:** 2026-08-29, after `app-architect`, `harness-setup`, and
`user-flow-mapper`.

**Sources:** [docs/PRD.md](docs/PRD.md) (product truth, MoSCoW),
[ARCHITECTURE.md](ARCHITECTURE.md) (7 resolved forks, 8 correctness-critical
items), [docs/user-flows.md](docs/user-flows.md) (screens and ordering
constraints).

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
| A1 | Add `events.starts_at` (nullable), `fights.bout_order`, and the missing FK indexes; populate `bout_order` from the Wikipedia sync | not started |
| A2 | ⚠️ Disputed-opponent detection in `upsertFight` + the `data_conflicts` table | not started |
| A3 | ⚠️ Owner allowlist — `lib/auth.ts` wrapper, enforced in RLS and not only in the UI | not started |

**A1 note.** `bout_order` is nearly free — `fetchSchedule.ts` already walks
Wikipedia's `{{MMAevent bout}}` templates in document order and discards the
ordering. `starts_at` is added nullable here and stays empty until B4.

**A3 note.** A UI-only allowlist is the "never trust the client" failure — a
stranger could still write via a direct request. The check belongs in the
`picks` policies, not just the page.

---

## Phase B — Odds spine

The heaviest phase, and unavoidable: everything downstream prices against it,
and it now also owns `starts_at`.

| # | Sub-phase | Status |
|---|---|---|
| B1 | Verification spike — does 1xBet actually return MMA, real free-tier limits, `commence_time` shape, and a named fallback bookmaker | not started |
| B2 | ⚠️ `odds_snapshots` table, immutable via absent UPDATE/DELETE policy | not started |
| B3 | ⚠️ Odds client + fuzzy fight matcher; low-confidence matches open a `data_conflicts` row instead of guessing | not started |
| B4 | Daily discovery pull populating `events.starts_at` from `commence_time` | not started |
| B5 | T-12h snapshot job (GitHub Actions) + `job_runs` + loud degraded banner | not started |
| B6 | `/conflicts` screen — resolves both conflict types, so blockers can be cleared before picking begins | not started |

**B1 is blocking and must come first.** The Odds API's docs warn that some
bookmakers don't list less popular sports; 1xBet being a *supported bookmaker*
does not establish that it returns *MMA* prices. Do not build B2–B5 against an
unverified assumption — this project has been bitten twice by exactly that.

**B5 note.** A missed snapshot silently voids a whole card's scoreboard, which
the PRD calls the single highest-impact failure in the system. It must alert
loudly and offer a manual late pull at the worse price.

---

## Phase C — Picks and bets

First point where the app is genuinely usable: a card you can work end to end.

| # | Sub-phase | Status |
|---|---|---|
| C1 | ⚠️ `picks` table + pick-lock trigger + the check that each fighter belongs to that fight | not started |
| C2 | ⚠️ `lib/scoring` — implied probability, edge, unit P&L. Pure functions, no I/O | not started |
| C3 | Card view: bouts in `bout_order`, odds, conflict holds, quick pick (collapsed row) | not started |
| C4 | Expanded bet row: stake, estimated probability anchored to implied, live edge | not started |

**C2 note.** No American-odds conversion exists anywhere — decimal is the API
default and prices are stored as returned. `implied = 1 / decimal_odds`;
`edge = (estimated_probability × decimal_odds) − 1`.

**C4 is a UX floor requirement, not polish.** Asking for a probability cold
fails the no-learning-curve bar on the most important field in the system. The
row must show implied probability as the anchor and compute edge live, so the
judgment being made is "is the market too high or low, and by how much."
Without it `estimated_probability` is noise and the calibration check in G3 is
meaningless.

---

## Phase D — Settlement

| # | Sub-phase | Status |
|---|---|---|
| D1 | ⚠️ Cross-check settle job — agreement settles, 24h single-source timeout settles and flags, disagreement queues | not started |
| D2 | ⚠️ Dual settlement — `pick_correct` and `pnl_units` settle independently; draw/NC/cancelled voids **both** lines | not started |

**D2 note.** The case that must be explicitly tested: prediction right, bet on
the other fighter, bet wins. Both lines must record the truth rather than one
overwriting the other. With no winner there is no correct answer, so scoring a
pick as wrong on a draw would be a bug, not a harsh call.

---

## Phase E — Scoreboard

| # | Sub-phase | Status |
|---|---|---|
| E1 | Two boards — units and accuracy — three lines each, chalk computed not stored | not started |
| E2 | Filterable pick table with the PRD's breakdowns (weight class, stance matchup, favourite vs underdog, flag present) | not started |

**E1 note.** Both boards always show all three lines. A line that disappears
when it has no data reads as a bug and hides the control you most need. Below
10 cards, the boards must be explicitly marked a small sample rather than
reading as a verdict.

---

## Phase F — Rumour engine

Independent of A–E. Can move earlier — UC-1 works with no odds and no picks.

| # | Sub-phase | Status |
|---|---|---|
| F1 | Verification spike + `lib/llm.ts` (Gemini Flash) and Reddit client wrappers | not started |
| F2 | Clustering → `rumour_flags` + `rumour_sources`, with a degrade-loudly fallback | not started |
| F3 | Flags on card rows + full sources with links on `/fights/[id]` | not started |
| F4 | Rumour outcome marking on settled cards (UC-5) | not started |

**F2 note.** An exhausted LLM tier returning zero flags is indistinguishable
from "nothing to report" and is the worst failure shape in the system. The
heuristic fallback must announce itself, never fail silently. Corroboration
counts **independent claims**, not raw post volume.

**F4 note.** This is what makes the PRD's rumour precision metric measurable
at all. Without it that metric cannot be reported.

---

## Phase G — The intern

| # | Sub-phase | Status |
|---|---|---|
| G1 | Intern picks every fight with an `estimated_probability`, market-anchored and rumour-adjusted | not started |
| G2 | Edge-gated betting — threshold plus confidence sizing, and **free to decline entirely** | not started |
| G3 | Intern lines on both boards + a calibration check | not started |

**G2 note.** Silence on an unbackable favourite is the intern working, not
failing. A -6000 shot is 98.4% implied; it needs better than that to have any
edge at all.

**G3 note.** Because `estimated_probability` is stored, calibration is
directly checkable: of the fights called 70%, did roughly 70% happen? Expect
chalk to win early while calibration is bad. That is an informative result,
not a failure — the PRD says so explicitly.

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
