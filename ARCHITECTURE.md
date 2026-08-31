# Architecture — UFC Scouting App

**Scope:** v2 (solo Fight IQ tool). Supersedes the v1 group-tool architecture.
**Product truth:** [docs/PRD.md](docs/PRD.md) — where this file and the PRD
disagree, the PRD wins and this file gets corrected.
**This file is the single place the tech stack is recorded.**

---

## What this app does

A personal tool for one user. Before a UFC card it surfaces what r/MMA and
MMA socials are saying about each bout (weight cuts, injuries, camp changes)
with corroboration counts and source links. You record **picks** (who wins)
and, where the price is wrong, **bets** (units at a frozen price). An
"intern" — a market-anchored, rumour-adjusted automated picker — does both
against you. Afterwards a scoreboard settles **you vs. the intern vs. chalk**
on two separate lines — units and accuracy — so you find out whether your
reads are actually worth anything.

The v1 group features (clans, invites, shared-report visibility) are
**frozen, not deleted** — see §Frozen surface.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 16.3.0**, App Router | Shipped. Middleware is `src/proxy.ts` — Next 16 renamed it; building from memory silently breaks it |
| UI | **React 19.2.8** | Server Components by default |
| Language | **TypeScript 5**, strict | Single runtime — see Fork 2 |
| Styling | **CSS Modules** + CSS custom properties | No Tailwind. Dark mode via `ThemeToggle` |
| Database | **Supabase Postgres** | Bundles Postgres + Auth + RLS, so access rules live in the DB |
| Migrations | **Raw numbered SQL**, append-only | No ORM. Chosen for control, and because RLS policies are SQL anyway. Never edit an applied migration |
| Authorization | **Postgres Row Level Security** | One auditable place, not scattered app checks |
| Auth | **Supabase Auth** — Google + GitHub OAuth | No passwords |
| Fighter/event data | **API-Sports MMA** (free) + **Wikipedia** | API-Sports has no lookahead; Wikipedia has the schedule |
| Results | **Wikipedia + API-Sports, cross-checked** | Two independent licensed sources — see Fork 1 |
| Odds | **The Odds API**, free tier — **1xBet** (`onexbet`, EU region), **decimal** | One snapshot per card at T-12h. Decimal is the API default, so no odds-format conversion exists anywhere in the codebase |
| Social source | **Reddit API** (r/MMA), free tier | Needs a registered OAuth app |
| LLM | **Gemini Flash**, free tier, behind `lib/llm.ts` | Large context means a whole card's posts in one call; the free tier caps *requests*, so fewer and bigger calls is the right shape |
| Fuzzy matching | TS string-similarity, human-backstopped | Feeds a review queue, not a silent best guess |
| Testing | **Vitest** | Required before any correctness-critical work |
| Hosting | **Vercel** free tier | Auto-deploy on push to `main` |
| Batch jobs | **GitHub Actions** cron | `sync.yml` today; intern and odds jobs join it |
| CI | **GitHub Actions** `ci.yml`, job `gates` | `npm ci` + lint + test + build, path-scoped; docs-only PRs get markdown lint instead. Required by branch protection **by job name** |

**Hard constraint: $0/month.** Free tiers only.

**Standing rule:** do not trust a provider's documented limits over what the
API actually does. Phase 5 found two undocumented API-Sports limits only by
triggering the errors — and see Fork 1, where the same rule killed a decision
mid-flight.

---

## Resolved forks

### Fork 1 — results source: **Wikipedia + API-Sports cross-check**

UFCStats.com was proposed as a third source and **rejected on evidence.**
Checked live on 2026-08-29: every page (`/statistics/events/completed`,
`/statistics/fighters`) returns an identical 2,998-byte JavaScript
proof-of-work challenge — "Checking your browser…" — instead of content, and
port 443 refuses connections entirely, so any scrape would run over plaintext
HTTP. Reaching it would mean running a headless browser to defeat a deliberate
anti-bot gate on a source v1 had already flagged as unlicensed. Not worth it,
and not built.

Instead, the two sources already shipped and licensed are cross-checked
against each other. `bout_order` — a PRD Must-have — turned out to be
**free**: [fetchSchedule.ts](src/lib/ufc-data-sync/fetchSchedule.ts) already
walks Wikipedia's `{{MMAevent bout}}` templates in document order (main card
first, then prelims) and then discards the ordering. It only needs persisting
as the array index.

### Fork 2 — scraping runtime: **TypeScript only**

The v2 spec assumed Python (BeautifulSoup + rapidfuzz). With UFCStats out
there is **no HTML scraping left** — Reddit and The Odds API are JSON REST,
Wikipedia is already TypeScript. BeautifulSoup had no remaining job, and the
fuzzy matcher is backstopped by a human review queue, making it a threshold
heuristic rather than a precision-critical algorithm. A second runtime would
have cost a second dependency manager, a second Supabase client, and no reuse
of the existing `lib/ufc-data-sync/` helpers, in exchange for nothing.

### Fork 3 — where the intern runs: **GitHub Actions cron**

Same pattern as the existing twice-daily `sync.yml`. Free, and the 6-hour job
limit means LLM calls and rate-limit pacing are unconstrained. Vercel Cron was
rejected: the free tier's function timeout is far too short for a job that
pages through Reddit, calls an LLM, and waits on rate limits.

### Fork 4 — unified reports table: **cancelled, permanently**

The `scouting_reports` + `fighter_scouting_reports` merge described in
`HANDOFF.md` was deferred pending real multi-user activity, which the solo
pivot means is never coming. Do not start it, and do not let a future session
inherit it silently.

### Fork 5 — disputed opponents (the Phase 7 problem): **detect, hold, self-resolve**

The two sources sometimes report different opponents for the same fighter on
the same card. **These are not two bouts — they are one bout the sources
disagree about**, almost always a late replacement one source hasn't caught:

| | API-Sports | Wikipedia |
|---|---|---|
| Louie Sutherland vs | Henrique da Silva Lopes | José Luiz |
| Miles Johns vs | Jessie Rosas | **Gianni Vázquez** (result confirmed) |

**A preferred-source rule cannot work**, and Phase 7 already disproved it:
Wikipedia was stale for Sutherland, API-Sports was stale for Johns. Any static
precedence would have been wrong on one of the two cases.

1. **Detect** — [upsertFight.ts](src/lib/ufc-data-sync/upsertFight.ts) already
   loads every fight in the event and attempts an unordered-pair match. When
   that fails it falls straight through to `INSERT`, **which is where the
   duplicate rows are created.** Before inserting, check whether a candidate
   shares *exactly one* fighter; if so it is a disputed bout, not a new one.
   Open a `DataConflict`. Never auto-merge on a guess.
2. **Hold** — a fight with an open conflict is **excluded from both boards**,
   handled exactly like `unpriced`. This mirrors real sportsbook practice: an
   opponent change voids bets on the bout, because the price was for a
   specific matchup. Backing Johns vs Rosas is not the same wager as Johns vs
   Vázquez. Picks are blocked too — unlike `unpriced`, where the bout is real
   and merely has no price, a disputed bout **may not exist as described**, and
   scoring a pick against a bout that never happened corrupts the accuracy
   line the same way a phantom stake corrupts units.
3. **Resolve**, mostly without intervention:
   - **Convergence** (the common path) — sync runs twice daily; the stale
     source catches up, both agree, the conflict closes and the phantom row is
     retired. Most late replacements settle days before the card, so most
     disputes never reach the T-12h snapshot.
   - **By result** — the row with a confirmed result is the one that happened.
     This is exactly how the Johns case was knowable. Ambiguity surviving to
     fight night resolves itself at the bell.
   - **Manually**, from the queue, whenever you want it sooner.

**One queue, not two.** `DataConflict` covers both low-confidence odds↔fight
matches and disputed opponents — both are "the machine isn't sure, a human
should look." One place to check, one habit.

**Enforcement:** bettable-ness is a single predicate — *no open conflict* —
evaluated in the pick-lock trigger that is already required. Same trigger, one
more condition, no new enforcement surface.

### Fork 6 — settlement policy

- **Both sources agree** → settle.
- **Sources disagree** → never auto-settle. Queue for manual resolution.
- **Only one source has reported after 24h** → settle on it, and record
  `settled_from` so single-source settlements stay visible on the scoreboard.

### Fork 7 — odds source and format: **1xBet, decimal, 2-way `h2h`**

Verified against The Odds API's own documentation on 2026-08-29:

- **1xBet is supported**, bookmaker key `onexbet`, in the **EU** region.
- **Decimal is the API default** (`oddsFormat=decimal`). Prices are stored
  exactly as returned. There is no American-odds conversion anywhere in the
  codebase, and none should be added — a conversion is a correctness risk that
  buys nothing here.
- **Credits cost 1 per region per market for the whole request**, not per
  event. One card's snapshot is 1 credit against roughly 500/month, so the
  budget is not a real constraint. The PRD's "could have" second pull at T-24h
  is comfortably affordable.

**Primary market: `h2h` (2-way win).** In MMA this is the standard market, and
**a draw voids the bet and returns the stake** — which is already the
settlement rule in the PRD. The draw is therefore handled for free by the
market's own rules, not by hedging.

**Still to verify empirically, and blocking:** The Odds API's docs warn that
"some bookmakers may not list for less popular sports." That 1xBet is
supported as a bookmaker does **not** establish that it returns MMA prices.
This must be checked against a live response before any code depends on it,
and the design needs a documented fallback bookmaker if it doesn't.

**Double chance / 1X2: rejected.** Raised and then dropped on 2026-08-29
after discussion. Double chance exists because in football a draw is a third,
likely outcome that *loses* the bet. None of that holds here:

- The 2-way `h2h` market **already returns the stake on a draw**, so there is
  no draw exposure to hedge in the first place.
- MMA is not normally offered three-way; `h2h_3_way` is a soccer market.
- Even where a 1X2 MMA market exists, hedging shortens the price on **every**
  bet to insure a sub-1% event whose unhedged outcome is "stake returned,"
  not "loss."
- It would also corrupt the measurement: hedged prices make the units board
  partly a record of hedging discipline rather than of reads, which is the
  thing the board exists to measure.

Do not reintroduce it without evidence that 1xBet actually lists a three-way
MMA market.

---

## Entities

### Existing (v1, unchanged)

```text
Fighter 1---* Fight          Event 1---* Fight
Clan 1---* ClanMember *---1 User             [FROZEN]
Fight 1---* ScoutingReport *---1 User        [FROZEN]
```

### New in v2

```text
Fight  1---*  Pick             (author: USER | INTERN; opinion + optional bet)
Fight  1---1  OddsSnapshot     (one per fight, written once, never updated)
Fight  1---*  RumourFlag       (one per distinct concern per fighter)
RumourFlag 1---* RumourSource  (the posts backing it)
DataConflict                   (anything the machine isn't sure of — one queue)
JobRun                         (job health — what makes loud failure possible)
```

**The chalk line is computed, never stored.** It is derivable from odds plus
results; storing it would create a second copy that can drift from the inputs
it claims to summarise.

### Schema decisions

**Two columns the Must-haves cannot work without, and which do not exist
yet:**

- `fights.bout_order smallint` — from the Wikipedia array index.
- `events.starts_at timestamptz` — `events.event_date` is a bare `date` with
  no time, and `fights` carries no time at all. Both the **T-12h odds
  snapshot** and the **pick lock** are defined in terms of a clock, so neither
  is implementable against today's schema.

**Pick lock is enforced at the card, not the bout.** Per-fight start times are
not reliably available from either source, so picks lock at
`events.starts_at`. This is *stricter* than the PRD's per-fight rule — you
cannot pick the main event once prelims begin — which is the safe direction to
err, because it cannot be used to cheat the scoreboard. Enforced as a **BEFORE
INSERT/UPDATE trigger** that raises, not as an application-code check.

**A pick and a bet are different judgments, and the schema separates them.**
A pick says who wins. A bet says the price is wrong. They come apart at both
extremes: a -6000 favourite (decimal 1.0167, **98.4% implied**) is near-certain
to win and worthless to back, while an underdog you think loses can still be
the correct bet if it is priced below your estimate. So:

- `predicted_fighter_id` — always set. The opinion.
- `bet_fighter_id` — nullable, and **may differ from the prediction**. The money.
- `stake_units` — nullable, present exactly when `bet_fighter_id` is.
- `estimated_probability` — always set. Without it a losing bet cannot be
  diagnosed: you cannot tell a bad probability estimate from bad sizing.

Implied probability is **computed from the snapshot price, never stored** —
storing both invites them to disagree. Edge is
`(estimated_probability × decimal_odds) − 1`; the intern bets only above a
threshold and sizes by edge, which is what stops it dumping units on
unbackable favourites.

**A row therefore settles twice, independently.** `pick_correct` scores the
opinion; `pnl_units` scores the money. Being right and losing money is a
real, meaningful outcome and the scoreboard must be able to show it.

**One table for both authors, with an `author` enum** — not two tables. Same
columns, same settlement logic, same queries; two tables would make every
scoreboard read a UNION and every settlement bug a two-place fix. This project
is still carrying exactly that debt from
`scouting_reports`/`fighter_scouting_reports`.

Constraints: `author = 'USER'` requires `user_id` and `author = 'INTERN'`
requires it null; `bet_fighter_id` and `stake_units` are both null or both
set; `stake_units > 0` when present; `unique (fight_id, author)` gives one row
per fight per author. **`predicted_fighter_id` and `bet_fighter_id` must each
be one of that fight's two fighters** — a plain FK to `fighters` cannot express
this, so it goes in the same trigger as the pick lock.

**`odds_snapshots` is immutable structurally, not by convention.**
`unique (fight_id)` allows one row per fight, and the table gets **no UPDATE
and no DELETE policy at all** — immutability by absence of permission, so
"never re-read after the snapshot" becomes something the database enforces
rather than a rule the code has to remember.

**`rumour_sources.excerpt` snapshots post text at scrape time**, so the
evidence survives the post being deleted.

**Keys:** `uuid` primary keys with `gen_random_uuid()`, matching the existing
schema — not guessable, and they do not leak row counts.

**Indexes** (Postgres does **not** auto-index foreign keys):
`picks(fight_id)`, `picks(status)`, `rumour_flags(fight_id)`,
`rumour_sources(flag_id)`, `odds_snapshots(fight_id)`.
Pre-existing gap worth closing at the same time: `fights.event_id`,
`fights.fighter1_id`, and `fights.fighter2_id` are all unindexed today and are
joined on constantly.

---

## Security baseline (v2)

Carried forward from v1, all still binding:

- [ ] RLS enabled on every table, default deny-all
- [ ] Only the anon key appears in frontend code; the service-role key never
      leaves the server and never enters git
- [ ] No endpoint trusts a client-supplied user ID — identity comes from the
      session
- [ ] Secrets in environment variables only
- [ ] **Table GRANTs match the policies for every role that needs access,
      including `service_role`** — RLS bypass and GRANTs are independent, the
      lesson from Phases 2 and 5

New for v2:

- [ ] `ODDS_API_KEY`, `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`, and
      `GEMINI_API_KEY` are **server-only** — never `NEXT_PUBLIC_`, stored as
      GitHub Actions secrets and Vercel env vars
- [ ] The browser never calls The Odds API, Reddit, or Gemini directly. All
      three are reached only from `lib/` inside a batch job (BFF pattern)
- [ ] Each of those three gets **exactly one wrapper module**; feature code
      imports the wrapper, never the SDK or a raw `fetch`
- [ ] `odds_snapshots` and the `rumour_*` tables have **no client write
      policies** — they are service-role-written only
- [ ] Pick lock is a database trigger, not an app-layer check
- [ ] Frozen clan tables keep their existing RLS untouched

**Fail loudly, never silently.** A missed T-12h snapshot silently voids a
whole card's scoreboard, and an exhausted LLM tier returning zero flags is
indistinguishable from "nothing to report." Those are the two worst failure
shapes in the system. `job_runs` exists so the UI can surface a stale or
failed job as a visible banner, and so a missed snapshot can be manually
re-pulled at a worse price rather than losing the card entirely.

---

## Folder structure

```text
src/
  features/
    fighters/          components/, api.ts, types.ts
    fights/            components/, api.ts, types.ts
    picks/             components/, api.ts, actions.ts, types.ts   [NEW]
    scoreboard/        components/, api.ts, types.ts               [NEW]
    rumours/           components/, api.ts, types.ts               [NEW]
    scouting-reports/  components/, api.ts, types.ts            [FROZEN]
    clans/             components/, api.ts, types.ts            [FROZEN]
    auth/              components/, api.ts
  shared/              components/, utils/
  lib/
    supabase/          browser + server clients
    ufc-data-sync/     API-Sports + Wikipedia ingestion (existing)
    llm.ts             single Gemini wrapper — swappable in one file  [NEW]
    odds/              The Odds API client + fuzzy fight matcher      [NEW]
    reddit/            Reddit OAuth client                           [NEW]
    intern/            clustering + pick generation (batch)          [NEW]
    scoring/           unit P&L math — pure functions, no I/O        [NEW]
  app/                 routing/pages — thin
```

**`lib/scoring/` holds no I/O on purpose.** Unit P&L, void handling, and
underdog/favourite returns are the correctness-critical core, and pure
functions with no database access are the only version of that code that is
cheap to test exhaustively.

### Layer boundaries — enforced as file layout, not as discipline

- **UI components** render and handle interaction. No business rules, no
  external calls, ever.
- **Services** (`api.ts` / `actions.ts` / `lib/`) hold business logic and own
  every outbound call — Supabase, Reddit, odds, Gemini.
- **Route handlers** stay thin: parse, call a service, return.

Rule of thumb: if a feature needs something from another feature, it belongs
in `shared/`, or the boundary is drawn wrong. Revisit rather than reach across.

---

## Correctness-critical work — test-first, no exceptions

Per the project's working rules these get a **failing test written before the
implementation**, and "done" means the test was run and observed passing —
never "this should pass now."

1. **Unit P&L math** — underdog returns, favourite returns, and void handling,
   against known moneyline examples
2. **Edge and implied-probability math** — `implied = 1 / decimal_odds` and
   `edge = (estimated_probability × decimal_odds) − 1`. This is what decides
   whether the intern bets at all, so an error here doesn't produce a wrong
   number, it produces a silently wrong *strategy*. No American-odds
   conversion: prices are stored exactly as the API returns them
3. **Dual settlement** — `pick_correct` and `pnl_units` settle independently.
   The case that must be explicitly tested: prediction right, bet on the other
   fighter, bet wins. Both lines must record the truth rather than one
   overwriting the other
4. **Pick lock** — a pick cannot be created or edited after `events.starts_at`
5. **Odds snapshot immutability** — a later sync must not overwrite a price
   that is already pending or settled
6. **Odds ↔ fight matching** — a wrong match silently corrupts every
   downstream number, so low-confidence matches must reach the review queue
   rather than being guessed
7. **Disputed-opponent detection** — a candidate sharing *exactly one* fighter
   must open a conflict, never insert a second row; and a fight with an open
   conflict must be rejected by the pick-lock trigger. Both halves need a test,
   because a miss here puts real units on a bout that never happened
8. **Settlement** — void, draw, and no-contest return the stake **and void
   both lines**: with no winner, "who wins" has no correct answer, so scoring
   the pick as wrong would be a bug, not a harsh call. Disagreement between
   sources settles neither line

Layout, copy, and styling work gets no tests — there is no single correct
output for a machine to assert.

---

## Frozen surface

Clans, clan invites, clan membership, shared scouting reports, and the
`PRIVATE` / `SPECIFIC_CLANS` / `ALL_MY_CLANS` visibility model: **code and
tables stay, routes stay reachable, no further development.** They should be
hidden from navigation (PRD Should-have), not deleted. If the group idea ever
returns, the work is intact.

---

## Known unresolved

- **The Odds API and Reddit free-tier limits are unverified.** Per the standing
  rule, verify empirically before designing around the documented numbers.
- **Gemini Flash's free tier is unverified** for the actual clustering job —
  same rule applies before `lib/llm.ts` is built against it.

*(The Phase 7 duplicate-opponent problem, previously listed here, is resolved
by Fork 5.)*
