# UFC Scouting App

**Live app:** <https://ufc-scouting-app-2jtj.vercel.app/>

A personal MMA handicapping tool. It watches for fight-week news you'd
otherwise miss, logs your picks and bets, runs an automated tipster
against you, and keeps an honest scoreboard of whether your reads
actually beat just taking the favourite.

Single user by design — it has a login so the data isn't world-writable,
not because anyone else is meant to sign in.

## Why it exists

Two things consistently cost money when picking fights:

1. **Finding out too late.** A bad weight cut, a camp injury, a coaching
   split — public days before a card, buried under shitposting, read
   about *after* the fight explains the result.
2. **No evidence you're any good.** Picks live in group chats and betting
   apps that never tell you whether your *reasoning* beats chalk.

Neither problem needs a model that predicts winners. Both are scouting
labour and record-keeping — tedious enough that a human skips it and a
machine won't.

> **v1 → v2 pivot.** This shipped first as a *group* tool (clans, invite
> links, shared scouting notes). Nobody used it that way. On 2026-08-29
> it was deliberately re-scoped to a single-user tool. The group features
> are **frozen, not deleted** — routes still work, tables still exist, no
> further development. See `docs/PRD.md` for the full record.

## What it does

**Data spine** — real UFC fighters, events, and cards from API-Sports and
Wikipedia, merged and reconciled automatically. ~960 fights and ~790
fighters, with two independent sources cross-checking each result before
anything is treated as settled.

**Odds** — a frozen moneyline snapshot ~12h before each card, so every
pick is measured against the price that was actually available.

**Picks and bets — two separate judgments.** A *pick* says who wins (free,
no money). A *bet* says the price is wrong, and carries units. You can
pick one fighter and bet the other.

**The intern** — a deterministic automated tipster that opines on every
fight. It anchors on the de-vigged market, then deviates for rumour flags
and Elo, and it is **free to decline a bet entirely** (it usually does —
it only bets above a +5% edge). It also predicts the method of victory.
Everything it does is a pure function, so its calibration is checkable
rather than vibes.

**Rumour engine** — scans Bluesky for injury / weight-cut / camp-change
chatter per fighter, scores corroboration across independent posts, and
docks the affected fighter's win probability.

**Elo ratings** — computed from the app's own fight graph, rebuilt from
scratch on every settlement so a late correction ripples forward
correctly.

**Two scoreboards** — units (did I find mispriced fights?) and accuracy
(did I read the fights right?), each with a **chalk line**: flat 1u on
every favourite. If you can't beat chalk, the tool says so.

**Conflict queue** — when the two data sources disagree about a result, or
a bout's opponents don't match, nothing is silently guessed. It opens a
row for a human call.

## Running it

```bash
npm install
npm run dev
```

Copy `.env.local.example` to `.env.local` and fill in your own Supabase,
API-Sports, Odds API, and Bluesky values.

```bash
npm run lint     # eslint
npm run test     # vitest — 420 tests
npm run build    # production build (includes the TypeScript check)
```

All three are the CI gate, run on every push and PR as a job named
`gates` that branch protection requires by name.

## Background jobs

Everything runs on GitHub Actions cron — no server, no queue.

| Job | Schedule (UTC) | What it does |
|---|---|---|
| `sync.yml` | `0 0,12 * * *` | Fighter/event/result sync, then settlement + Elo + records |
| `odds.yml` | `0 */2 * * *` | Discovers start times, snapshots odds at T-12h |
| `intern.yml` | `30 */2 * * *` | Regenerates the intern's picks and bets |
| `rumours.yml` | `0 */6 * * *` | Bluesky rumour scan |
| `fighter-enrichment.yml` | `0 6 * * *` | Resolves fighters to API-Sports profiles |
| `fight-history-backfill.yml` | `0 18 * * *` | 2022–2024 history (API-Sports) |
| `wikipedia-history-backfill.yml` | `0 21 * * *` | 2025+ gap fill (Wikipedia) |

Each writes a `job_runs` row so a silent failure is visible rather than
inferred.

## How it's built

Next.js 16 (App Router, RSC) · Supabase (Postgres + Auth + RLS) ·
TypeScript · CSS Modules · Vitest · Vercel.

Two structural rules the codebase actually holds to:

- **Pure logic is separated from I/O.** Every scoring, rating, and
  decision rule is a pure function in `lib/` with its own tests;
  a sibling module owns fetching and writing. `computeEloHistory` /
  `recomputeEloRatings` is the template.
- **Layer boundaries are file layout, not discipline.** UI components
  render; `api.ts` / `actions.ts` / `lib/` own business logic and every
  outbound call; route handlers stay thin.

## Documentation map

| File | What it owns |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | **Product truth.** What and why. Wins any disagreement |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Stack, entities, schema decisions, the numbered "forks" |
| [`PROJECT_FACTS.md`](PROJECT_FACTS.md) | Durable decisions that shouldn't be re-litigated |
| [`ROADMAP.md`](ROADMAP.md) | Phase/sub-phase plan and status |
| [`CHANGES.md`](CHANGES.md) | Dated log of what actually shipped, phase by phase |
| [`CLAUDE.md`](CLAUDE.md) | Rules for AI coding sessions in this repo |
| [`RETROSPECTIVE.md`](RETROSPECTIVE.md) | Lessons learned, and what to change next project |
| [`TECH.md`](TECH.md) | Plain-English walkthrough of how specific problems are solved |
| [`docs/user-flows.md`](docs/user-flows.md) | Screens, transitions, auth gates, empty/error states |
| [`HANDOFF.md`](HANDOFF.md) | v1-era status. **Partly superseded** — the PRD wins |
