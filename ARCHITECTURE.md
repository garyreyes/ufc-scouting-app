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
| Odds | **The Odds API**, free tier — **BetOnline.ag** (`betonlineag`, region `us`), **decimal** | One snapshot per card at T-12h. 89% feed coverage, the only book checked that also prices DWCS. Decimal is the API default, so no odds-format conversion exists anywhere in the codebase |
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

1. **Detect — done in A2.** [upsertFight.ts](src/lib/ufc-data-sync/upsertFight.ts)
   already loaded every fight in the event and attempted an unordered-pair
   match; when that failed it fell straight through to `INSERT`, which was
   where the duplicate rows got created. Before inserting, it now checks
   whether a candidate shares *exactly one* fighter via
   [sharesExactlyOneFighter.ts](src/lib/ufc-data-sync/sharesExactlyOneFighter.ts)
   — extracted as a pure, test-first function (5 tests, including the real
   Phase 7 case) rather than inlined, matching `lib/scoring`'s and
   `lib/odds`'s existing separation of decision logic from I/O. Confirmed by
   mutation: `shared >= 1` instead of `=== 1` — the most plausible version
   of this exact bug — correctly failed the two "same fight, not a dispute"
   tests. If a candidate matches, it opens a `data_conflicts` row instead of
   inserting; a repeat sync run finding the same ongoing dispute reuses the
   existing open row rather than piling up duplicates. Never auto-merge on a
   guess. `upsertFight`'s return type is now a discriminated union
   (`upserted` / `conflict`) rather than a bare id, since a conflict
   produces no new fight row — safe, since neither caller used the returned
   id for anything.
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
more condition, no new enforcement surface. This is about **betting**
specifically, not picking — see the B6 correction below for why the two
conflict kinds diverge on that.

**B6 result (the `/conflicts` screen).** Building the resolution UI surfaced
a real bug in the B3 code that writes `low_confidence_odds_match` rows:
`matchAndSnapshot.ts` was setting `fight_id` to the algorithm's own best
guess, not `null` as this migration's own comment already specified. The
practical effect: once C1's pick-lock trigger exists, it would have found an
"open conflict" for that fight_id and wrongly blocked **picking** it too, not
just pricing it — collapsing the intentional distinction above (a low-
confidence odds match means "we don't know the price yet," the same kind of
gap `unpriced` already handles; a disputed opponent means "this bout may not
be the real one," which is what actually needs to block picking). Fixed:
`fight_id` is `null` again, with the algorithm's guess moved into
`details.candidateFightId` — a starting point for the resolution screen, not
a verdict. Confirmed harmless in practice: both B5 live runs report
`lowConfidence: 0`, so no row with the wrong shape ever existed.

Resolution itself needed two new pure builders (`resolveDisputedOpponent.ts`,
`resolveLowConfidence.ts`, mutation-tested), reusing `stripNullish` and
`parseFighterPrices` exactly as their respective automatic paths do, so a
manual resolution produces the identical shape an automatic match would
have. The low-confidence picker (`rankFightMatches`, `matchFights.ts`)
deliberately shows every in-window candidate, not just the algorithm's top
guess — the owner can correct a wrong guess, not just confirm or reject it.

**A second, unrelated finding from the same session:** `data_conflicts`
(this migration, 0014) didn't actually exist in production, despite the
CLI's migration tracking claiming it was applied — found by a deliberately
safe, read-only live check before building on top of it. See
`PROJECT_FACTS.md` for the root cause and the general lesson.

### Fork 6 — settlement policy

- **Both sources agree** → settle.
- **Sources disagree** → never auto-settle. Queue for manual resolution.
- **Only one source has reported after 24h** → settle on it, and record
  `settled_from` so single-source settlements stay visible on the scoreboard.

**D1 result — the cross-check settle job.** Getting oriented surfaced the
gap the schema-decisions entry above already names: `winner_id`/`method`/
`round` were last-write-wins, so there was no way to evaluate this policy
at all against a value either sync job could have already clobbered.
Two forks asked and resolved before building:

1. **Where each source's own report lives** — new columns directly on
   `fights` (user-confirmed, over a separate `fight_result_reports`
   table), matching this project's repeated preference for one table over
   a second one a settlement bug or scoreboard read would need to
   UNION/join against (same reasoning as picks+bets, one conflicts
   queue).
2. **Draw/NC timing** — verified live first, not assumed: Wikipedia's own
   `{{MMAevent bout}}` template already reports "the bout is over, no
   winner" for free (confirmed against UFC 214's real No Contest —
   separator `"vs."`, method `"NC (overturned)"`, no winner), while
   API-Sports' only signal is a clear win (`fighters.first.winner`/
   `.second.winner` booleans — confirmed against `fetchFightHistory.ts`'s
   real response shape), so it can never itself report a draw/NC or
   corroborate one either. User-confirmed: settle a Wikipedia draw/NC
   immediately rather than wait the usual 24h, since the wait cannot buy
   any real confidence when the second source structurally has no
   opinion to contribute.

**A third case found while writing the decision logic out, not asked or
guessed:** the immediate-settle policy above only holds when API-Sports
is silent. If it has *actively* reported a winner while Wikipedia says
draw/NC, that is a genuine disagreement between sources — not the
"nothing to wait for" case — so it queues like any other disagreement
instead of settling. Caught by enumerating every real combination of
source states while writing `evaluateFightSettlement.ts`'s tests, before
any implementation existed.

Two new pure, mutation-verified functions: `evaluateFightSettlement.ts`
(`lib/settlement/`) — the entire policy above, one decision per fight,
I/O-free like `lib/scoring/`'s own convention — and
`buildSourceReportUpdate.ts` (`lib/ufc-data-sync/`) — turns one source's
incoming report into that source's own columns, critically preserving
the *original* `reported_at` on every repeat report rather than
refreshing it (the sync runs twice daily; refreshing the clock on every
re-report would mean the 24h timeout never actually fires). This exact
guarantee is what every mutation test on that function targets. A later
correction to an already-reported result (e.g. an appeal overturning a
decision) still updates the winner/method/round, just never resets the
clock — retroactively re-examining an *already-settled* fight is an
explicit, documented non-goal of this phase, not an oversight: the
settle job simply never revisits a fight once `settled_at` is set.

Two defensive DB constraints added alongside the columns, matching
`picks`' own paired-nullability checks:
`(settled_at is null) = (settled_from is null)` and
`(wikipedia_reported_at is null) = (wikipedia_method is null)` — the
second exists because a mutation test surfaced that
`evaluateFightSettlement.ts`'s explicit `null` (rather than trusting
`wikipediaMethod`) for `api_sports_only_24h`'s method/round was only
*provably* safe once the schema itself guarantees the pairing, not
merely because every real caller happens to uphold it today.

`upsertFight.ts` no longer writes `winner_id`/`method`/`round` directly
— both sync jobs now declare a `source: "wikipedia" | "api_sports"` and
route through `buildSourceReportUpdate`. The `disputed_opponent`
conflict's own `details` payload (candidate winner/method/round, shown
on the resolution card) is unaffected — it now reads those fields
directly off the incoming `FightWrite` rather than an intermediate
"optional fields" object, same values as before.

`data_conflicts` gained a third kind, `disputed_result`, for the queue
case above — same "one queue, not two" reasoning as the original two
(Fork 5). Given real scope: read-only for now (`DisputedResultCard`),
not a full manual-resolution picker like `disputed_opponent`'s. Most
result disputes are expected to self-resolve the same way — the next
twice-daily sync finds the sources now agree, and the settle job settles
it on its own — so a manual override is a well-scoped later add if it
turns out to be genuinely needed, not a gap in this pass.
`ConflictCard`'s dispatch is now a `switch` with a `never`-typed
exhaustiveness guard rather than an `if`/fallthrough, specifically so a
future fourth kind is a compile error if its UI branch is forgotten,
not a silent mis-render.

**Verified live, 2026-09-01.** Migration applied and cross-checked
against `information_schema`/`pg_constraint`, not just the tracking
table: all 8 new columns and both new constraints match exactly. Ran
the real twice-daily sync (`npm run sync`) end-to-end against
production for the first time since `upsertFight.ts` changed — this is
application code, not schema DDL, the same category B5 asked about
before its first live `matchAndSnapshot` run. Wikipedia's half exercised
for real (75 fights across 8 events); `syncJob.ts` (API-Sports) skipped
locally for lack of a local API key, exercised only by the existing
scheduled workflow. Zero fights reported a result, and this was
independently confirmed correct rather than assumed: every one of the 8
synced events' own `event_date` is still in the future (2026-09-05
through 2026-11-07), so none could possibly have a real result yet. Then
ran the settle job itself live (`npm run settlement:settle-fights`):
`0 settled, 0 disputed, 152 still waiting` — the correct, provably-safe
no-op, since `wikipedia_reported_at`/`api_sports_reported_at` are new
columns and every existing fight predates them. Confirmed via a real
`job_runs` row (`status: success`, summary matching the console output
exactly), not just the console line. `settle_fights` is deliberately not
added to `TRACKED_JOB_NAMES` (the odds pipeline's own degraded-banner
list) — out of D1's scope, and a `job_runs` row already gives basic
auditability without it.

### Fork 7 — odds source and format: **BetOnline.ag, decimal, `h2h`**

**Current bookmaker: `betonlineag` (BetOnline.ag), region `us`.** Changed
2026-09-01 from the original choice, 1xBet — see the dated update after the
bullets below for why. The verification history that follows (1xBet's
original selection, and the `h2h` three-outcome correction) is kept as the
record of what was actually checked and when; the bookmaker name in it is
historical, not current.

Verified two ways: against The Odds API's documentation on 2026-08-29, then
**against a live response with a real key on 2026-09-01** — B1's spike, done
early because the key arrived. Live verification changed one conclusion below;
see the correction.

- **1xBet is supported**, bookmaker key `onexbet`, in the **EU** region, and
  **it does return real MMA prices** — confirmed live. `bookmakers` was
  non-empty for genuine near-term UFC cards, including real fighters and
  correct pairings (Joshua Van vs Alexandre Pantoja, `commence_time`
  `2026-09-20T04:00:00Z`, which is the evening of Sept 19 in Los Angeles —
  matching the Wikipedia-sourced UFC 331 date independently). The blocking
  unknown from the first pass is resolved; no fallback bookmaker is needed.
- **Decimal is the API default** (`oddsFormat=decimal`). Prices are stored
  exactly as returned. There is no American-odds conversion anywhere in the
  codebase, and none should be added.
- **Credits cost 1 per successful request**, confirmed via the
  `x-requests-remaining` header dropping 500 → 499 → 498 across two calls. A
  request for an unsupported market (see below) returned `422` and cost **0**
  — billing happens after validation, not on receipt.
- **`commence_time` is a real ISO timestamp on every event**, confirmed live.
  This is what B4 uses to populate `events.starts_at`.

**Correction to the first pass — `h2h` for MMA is not 2-way.** The prior
version of this section claimed MMA doesn't normally offer a three-way market
and that `h2h` was a clean 2-way price. That was asserted, not checked. The
live response contradicts it: **every 1xBet MMA `h2h` payload returns three
outcomes** — Fighter A, Fighter B, and `Draw` (priced around 33–34.0 decimal,
roughly 3% implied). Querying `h2h_3_way` as a separate market key returns
`422 INVALID_MARKET` — there is no separate three-way key for this sport; the
third outcome is simply how `h2h` is shaped here.

**This does not reopen double chance, for a different reason than first
argued.** Double chance is a *wrapper bet* — "Fighter A wins OR it's a draw"
— that shortens the price on every wager to buy protection against an outcome
you were never going to bet on anyway. What the payload actually contains is
a plain three-way *price*, not a combined bet type. The fix is mechanical:
**the odds client keeps only the two outcomes matching the fight's two
fighters and discards `Draw`.** The settlement policy — a draw voids the
stake and returns it — was always a product decision this app makes, not a
behaviour the market was performing on its own; it holds unchanged. Nothing
about the double-chance rejection's actual reasoning (it insures a sub-1%
event and would corrupt the units board into partly measuring hedging
discipline) depended on the wrong "not offered three-way" claim, so that
conclusion still stands — just not for the reason first given.

**Bookmaker switched to BetOnline.ag, 2026-09-01 (CHANGES.md Phase 20).**
Prompted by a real user question — "why not include DWCS?" — that led to a
proper live check rather than an assumption. The first DWCS check (searching
for fighters from already-*concluded* weeks, and only against `onexbet`)
found nothing and was wrong on both counts: re-checked against the correct
current week and every bookmaker in the feed, DWCS fights **are** priced —
just not by 1xBet. Comparing bookmakers across the full 63-event feed:

| Bookmaker | Coverage | UFC 331 | DWCS |
|---|---|---|---|
| `onexbet` (1xBet) | 34/63 (54%) | ✅ | ❌ zero |
| `pinnacle` | 18/63 | ❌ absent from UFC 331 | ✅ |
| `betonlineag` (BetOnline.ag) | **56/63 (89%)** | ✅ | ✅ |

BetOnline.ag is the only bookmaker checked that cleanly prices **both**
promotions, and covers more of the feed than 1xBet did even for UFC alone.
Its MMA `h2h` market is a **clean 2-way** — confirmed live on both a UFC and
a DWCS fight, no `Draw` entry — which simplifies nothing structurally (the
Draw-discard code is kept, since it is a proven-correct no-op against a
2-way market, and a future bookmaker change could reintroduce a three-way
shape) but removes the one edge case this bookmaker could have hit.

Region is empirically irrelevant once `bookmakers=` is explicit: identical
coverage was confirmed for BetOnline.ag across `us`/`eu`/`uk`/`au`. `us` is
used for readability, not because it changes what comes back.

**This resolves the odds half of "should DWCS be supported" — it does not
resolve the other half.** Wikipedia's DWCS coverage is structurally
different from UFC event pages regardless of bookmaker: one page per
*season*, each week as a section inside it, plain-text dates
(`|date=August 11, 2026`) instead of the `{{start date}}` template every
parser in this codebase expects, and not tracked by the category
`fetchSchedule.ts` already polls. Actually ingesting DWCS still needs its
own discovery/parsing path — a real, separate decision, not yet made.

**New design note for B3 (fuzzy fight matching), found while reading the live
response.** Several far-future events show the same fighter listed against
different opponents on the same date — e.g. Gaethje appearing against both
Tsarukyan and Topuria, Ciryl Gane against both Aspinall and Hokit, all dated
2026-12-31. These are rumoured pairings the market prices before matchmaking
is final, not confirmed fights. **B3's matcher should scope to a window
around a known card's date rather than searching by name across the full
event list** — an unscoped search risks a false match against a speculative
listing that never becomes a real fight, which is a different failure mode
from the disputed-opponent problem in Fork 5 but has the same shape: don't
guess when the data is ambiguous, narrow the search instead.

### Fork 8 — owner allowlist: **restrictive RLS policy, not rewritten permissive ones**

Found during `user-flow-mapper` (2026-08-29), built in A3 (2026-09-01):
the app is publicly deployed with open Google/GitHub signup, so any
stranger can currently sign in and write real rows to the frozen v1
tables — clans, scouting reports. RLS already keeps a stranger's rows
separate from the owner's, so this was never a breach, but it's an
unintended door, and per `docs/user-flows.md`'s security checklist the
fix has to be enforced in the database, not only the UI.

**Mechanism: one restrictive policy per table, not a rewrite of every
existing permissive one.** Postgres RLS policies for the same command are
permissive by default and OR'd together (0012's own comment already
established this) — a new permissive policy can only *widen* what's
already allowed, never narrow it. The only way to cut down what
`clans: create own`, `scouting_reports: author creates`, and similar
policies already allow, without touching any of them, is a **restrictive**
policy: restrictive policies are AND'd on top of whatever the permissive
ones allow. One `as restrictive for all using (is_owner())` policy per
table does the whole job — `clans`, `clan_members`, `clan_invites`,
`scouting_reports`, `report_clan_shares`, `fighter_scouting_reports`,
`fighter_report_clan_shares`. `profiles` is deliberately excluded: its one
row per signup is created by the `handle_new_user` trigger regardless of
this app's RLS, and letting a stranger rename their own harmless
shadow-row isn't meaningful data creation.

**`accept_clan_invite` needed a second, different fix — RLS doesn't reach
inside a `SECURITY DEFINER` function.** Same class of gap as
`odds_snapshots`' original immutability mistake (Fork 7 / B2): this
function's internal `insert into clan_members` runs with the function
owner's privileges, which bypasses the new restrictive policy on
`clan_members` entirely. A stranger with a leaked or guessed invite token
could still join a clan through it. Fixed with an explicit `if not
is_owner() then raise exception` guard inside the function itself — the
table-level policy alone was not enough. Redefined via `create or replace
function` in the new migration, not an edit to `0004` where it was first
defined.

**Verified live 2026-09-01, via `supabase db query -f`: `All RLS checks
passed.`** — the full file, checks 1–16, run for real. Getting there
surfaced and then fixed a real, narrow issue in check 14 itself (not the
schema): the first version of check 14 wrapped its INSERT in a `DO` block,
and that specific shape, run immediately after check 13's *caught*
RLS-rejection exception, failed intermittently through this tool — proven
unrelated to `is_owner()` or the policy by direct calls and multiple
isolated reproductions of the underlying session mechanics, all of which
passed cleanly. The fix: check 14 doesn't need a `DO` block at all — a
plain top-level `INSERT` that runs without error already proves success.
Once rewritten that way, the complete file — including 15 and 16, never
independently isolated — passed end to end. Full diagnostic trail in
`PROJECT_FACTS.md`.

**`lib/auth.ts` (`isOwner()`) carries no security weight of its own.** It
exists for one reason: deciding what the UI shows (sign-in prompt vs. "not
available" vs. the real screen). The actual boundary is `is_owner()` in
Postgres, enforced independently of anything the app layer does or any bug
in it — the same "app-layer check is UX, the database is the boundary"
split already established for the odds-snapshot immutability trigger.

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

- `fights.bout_order smallint` — from the Wikipedia array index. **Added in
  A1** (`supabase/migrations/0015_bout_order_and_starts_at.sql`);
  `syncSchedule.ts` now passes the array index it was already iterating.
  Nullable — only ever known for Wikipedia-sourced fights, since API-Sports
  has no concept of card position.
- `events.starts_at timestamptz` — `events.event_date` is a bare `date` with
  no time, and `fights` carries no time at all. Both the **T-12h odds
  snapshot** and the **pick lock** are defined in terms of a clock, so neither
  was implementable against the original schema. **Column added in A1**,
  **populated in B4**: the earliest `commence_time` among the card's own
  fights that B4 can confidently match (same `AUTO_MATCH_THRESHOLD` as B3's
  pricing — a wrong start time undermines the pick lock the same way a
  wrong price undermines the units board). Not the main event's own time —
  a card's prelims start hours earlier, and that earlier moment is what
  "the card has started" means for the pick lock. **Deliberately
  overwritten on every run, not write-once**: the PRD's "card postponed →
  picks carry to the new date, locks recompute" needs `starts_at` to track
  the freshest odds data, unlike `odds_snapshots`' immutability.
- `fights.wikipedia_winner_id/method/round/reported_at` and
  `fights.api_sports_winner_id/reported_at`, plus `settled_at`/
  `settled_from` — **added in D1** (`0021_result_settlement.sql`). Before
  this, `winner_id`/`method`/`round` were last-write-wins between the two
  sync jobs, so there was no way to tell "both sources agree" from "only
  one has run since" — Fork 6's policy literally could not be evaluated
  against a value that had already been overwritten. `winner_id`/`method`/
  `round` are now authoritative and written only by `lib/settlement/`'s
  settle job; each sync job writes its own report into its own columns
  instead (`upsertFight.ts`, routed through
  `lib/ufc-data-sync/buildSourceReportUpdate.ts`). See the D1 result below
  Fork 6.

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

**C1 result — `picks` built** (`0019_picks.sql`, `0020_picks_check_
security_definer.sql`). Two gaps found closing this out, both against the
schema-decisions text above:

- **The PRD lists three more pick fields this section never named:**
  `confidence`, `predicted_method`, `reasoning` (docs/PRD.md §UC-3/§9).
  Added all three — `confidence smallint` (1-5, user-confirmed: a
  separate coarse gut-check distinct from `estimated_probability`'s
  precise number, simple for both a UI control and the intern's future
  LLM output), `predicted_method`/`reasoning` both nullable text
  (user-confirmed: required free-text reasoning on every pick is real
  friction against the no-learning-curve UX floor).
- **`picks` is owner-only, not public** — a real, deliberate divergence
  from `odds_snapshots`/`fights`' public-read posture. User's own words:
  "for now just me until I prove the picks are actually reliable." Not a
  permanent decision — revisit if the scoreboard is ever made public.
  SELECT is author-agnostic (the owner reads both their own USER rows and
  the INTERN's, which is the entire point of the two-board comparison);
  INSERT/UPDATE is scoped to `author = 'USER' and user_id = auth.uid()` on
  top of `is_owner()` — INTERN rows are service-role-only, written
  exclusively by Phase G's batch job, never by any client including the
  owner's own session.

**The pick-lock trigger (`check_pick_constraints()`) is `SECURITY
DEFINER`** — found live, the first time `supabase/tests/rls.sql`'s new
checks actually ran an `authenticated` insert against it: the open-
conflict check reads `data_conflicts`, which has no grant for
`authenticated` at all (deliberately, 0014), so the trigger itself hit
`permission denied` running as its caller. Same fix, same reason, as
`accept_clan_invite` in 0017: `security definer` + `set search_path =
public`, so the trigger runs with the function owner's privileges
regardless of who's inserting. Third confirmed instance of this exact
class of bug in this codebase (`service_role` bypassing RLS on
`odds_snapshots`, `accept_clan_invite`'s own insert, now this) — worth
checking for by default in any new trigger/function that reads a
service-role-only table.

One trigger enforces all of the following, in order — pick lock, then
fighter membership (predicted, then bet), then the open-conflict check
(item #7's second half, closed by this phase), then a blanket rejection
of any client attempt to set `pick_correct`/`pnl_units` (Phase D's job,
not built yet, so nothing may touch them regardless of role until D's own
migration deliberately reopens that door). All 9 new checks
(`supabase/tests/rls.sql` 17–25) run live and pass, including two the
test-writing process itself caught before they ever reached the live run:
a test-fixture bug (checks 18/19/21/22/23 were accidentally written
against the same *locked* fixture fight built for check 24, so the lock
check fired before the one actually being tested — fixed with a third,
dedicated unlocked fixture fight) and the `SECURITY DEFINER` gap above.

**C3 result — the card view (`/events/[id]`) now writes picks, not just
displays fights.** Extended the existing v1 route rather than a new one
(`docs/user-flows.md`: "why the card view and not the fight page" — you
work a whole card in one pass). A real gap surfaced before any code: the
flow doc's "one tap picks a winner" can't literally satisfy
`estimated_probability`'s `NOT NULL` constraint without either faking a
number (which would make the calibration check tautological) or asking
for something real. User-confirmed resolution: tapping a fighter expands
the row in place to 5 preset probability bands (`quickPickBands.ts`) —
still fast, still a real independent judgment, deliberately *not*
anchored to this fight's own implied probability (unlike C4's bet row —
a pick is opinion, independent of price). `confidence` defaults to 3
silently, since unlike probability it feeds no P&L/edge math.

Auth branching collapses two of the flow diagram's states into one:
logged-out and logged-in-but-not-owner both render the same read-only
card (`docs/user-flows.md`'s auth-gate table treats them identically —
"sign-in prompt" and "not available" are both just "no pick controls").
Conflict holds and the owner's own picks are fetched *only* on the
owner-confirmed path, matching Flow 1's own diagram, which never
branches either onto the read-only leaf.

**Verification, stated honestly:** `getCardView`'s new query (`bout_order`
sort, the odds merge) and `getOpenDisputedFightIds` both ran live against
UFC 331's real card — confirmed `bout_order` sorts main-event-first
(`Joshua Van vs Alexandre Pantoja` at `bout_order=0`) and every fight
correctly shows `unpriced` 19 days out, before T-12h. `saveQuickPickAction`
itself was **not** exercised live — its `cookies()`-based session can't run
outside a real request, the same limitation B5/B6 hit, and unlike those
reads, fabricating a real pick would create fake opinion data under the
owner's own name rather than harmless log rows. Mitigated the same way as
before: every column name in the upsert payload cross-checked against the
real schema, and the actual enforcement (lock, membership, conflict) is
C1's already-live-tested trigger — this action does not re-implement any
of it.

**C4 result — the expanded bet row, and the fields C3 left un-exposed.**
Two forks asked before building: the anchored-probability control is
C3's own band interaction, reframed *relative to* implied probability
("well below market" … "well above market") rather than a slider —
user-confirmed, keeps the interaction cost identical to what's already
shipped while still satisfying "anchored to implied." Stake is a free
numeric field, not preset chips — user-confirmed, since stake *size*
itself is the signal E1's units board measures (a 0.5u chalk read vs a
2.5u underdog read), and presets would cap the one place sizing skill
shows up. Also closed a gap C3's own code comments left open:
`confidence`, `predicted_method`, `reasoning` — all three named in
docs/PRD.md UC-2, present in the schema since C1, never exposed in any
UI — become editable here, since no other roadmap phase claims that
scope.

New pure functions, `lib/scoring/` — `probabilityForFighter` (a bet may
back a fighter other than the pick, so live edge needs
`1 - estimated_probability` when they diverge, never the stored number
verbatim — the PRD's own "underdog I think loses can still be the
correct bet" case), `priceForFighter` (the wrong side's decimal price
silently flips edge's sign), `applyProbabilityDelta` (turns a band's
relative delta into the actual stored value, clamped inside
0019_picks.sql's strict `(0, 1)` check — the PRD's own -6000 example
overflows past 1 unclamped). All three correctness-critical (item #2's
dependency chain) and mutation-verified.

**A data-merging bug caught before it could happen, not after.** C3's
`saveQuickPickAction` sent a *partial* upsert payload. Trusting
Supabase's `resolution=merge-duplicates` upsert to leave every other
column alone on conflict, without checking, is exactly what this
project's working style says not to do with third-party behaviour — so
both save actions were rebuilt around an explicit read-merge-write
(`mergePickFields.ts`, a data-merging rule per the correctness-critical
list, test-first and mutation-verified) that always writes the complete
row. This also caught a second, related issue: a quick-pick retap after
`confidence` was already set to something real via the expanded row
must not silently revert it to the neutral default — `saveQuickPickAction`
now only applies that default when no row exists yet.

The bet row requires both a priced fight (ordering constraint #5) *and*
an existing pick — UC-2's own framing is "log a pick, and *separately*
decide whether to bet it," so a bet can never create a pick from
nothing; `saveBetAction` enforces this server-side, not just hides the
control in the UI. `getMyPicksForFights` widened from C3's
`predictedFighterId`-only slice to the full row (`MyQuickPick` renamed
`MyPick`) so reopening the bet row prefills the last-saved values —
recognition over recall, not re-derivation.

**Verified live, safely:** the expanded column list ran against the real
`picks` table via a throwaway read-only script (admin client, real fight
ids, 0 rows back as expected since no real pick exists yet), then
deleted before commit. Neither save action was exercised live — same
`cookies()`-outside-a-real-request limitation as C3, and fabricating a
real bet would be fabricating money/opinion data under the owner's own
name. The real enforcement remains C1's already-live-tested trigger and
RLS policies.

**`odds_snapshots` is immutable structurally, not by convention — enforced by
a trigger, not by an absent policy.** `unique (fight_id)` allows one row per
fight, and `SELECT` is the only grant either `anon` or `authenticated` ever
gets. The mechanism that actually stops an overwrite, though, is a `BEFORE
UPDATE`/`BEFORE DELETE` trigger that unconditionally raises — **not** the
absence of an RLS policy, which was the original plan and doesn't hold up:
`service_role` bypasses RLS entirely and is granted UPDATE/DELETE on every
table by default (`0005_service_role_default_privileges.sql`), so an absent
policy protects against nothing once the sync job itself runs. Triggers fire
for every role, `service_role` included — the same mechanism already chosen
for the pick lock. Verified live 2026-09-01: `service_role` UPDATE and
DELETE were both rejected by the trigger specifically (checked via the
error message, not just a permissions failure), and a second `INSERT` for an
already-snapshotted fight was separately rejected by the unique constraint.
See `supabase/migrations/0013_odds_snapshots.sql` and `supabase/tests/rls.sql`
checks 7–12.

**`data_conflicts` was created in B3, ahead of A2, on purpose.** B3 (the
odds matcher) needs somewhere to write a low-confidence match; A2
(disputed-opponent detection) needs the same table for the other kind. Fork
5 already fully specified what each kind needs to represent, so the table
didn't need A2's detection logic to exist first — only its shape needed
deciding. A2's remaining scope is now just the `upsertFight.ts` change,
writing into a table that already exists. Two kinds, one table:

- `kind` — `'disputed_opponent'` or `'low_confidence_odds_match'`.
- `fight_id`, **populated only for `disputed_opponent`.** That's the
  existing kept row, and it's what the pick-lock trigger (C1) checks to
  make a disputed fight unbettable and unpickable. Left **null** for
  `low_confidence_odds_match`: an unmatched odds event doesn't identify a
  specific fight with enough confidence to block anything — that fight
  just stays `unpriced`, a state the app already handles, rather than
  becoming a second kind of blocked state. Candidate fight ids, if any,
  live in `details`.
- `details jsonb` — the kind-specific payload (the raw odds event and its
  confidence score, or the disputed candidate's source/fighter data).
  jsonb rather than a wide nullable-column table, since a human review
  queue doesn't need query-time structure the way a settled record would.
- `resolved_at timestamptz` — null means open. An index exists on
  `(fight_id) where resolved_at is null`, since "does this fight have an
  open conflict" is exactly what the pick-lock trigger will ask.
- **RLS: no policy at all for `anon`/`authenticated`, deliberately fail
  closed.** This is an internal review queue (`docs/user-flows.md` gates
  `/conflicts` behind the owner allowlist). `is_owner()` now exists (A3,
  Fork 8) and `data_conflicts` could be given an owner-only read policy at
  any point, but it hasn't been — there's still no `/conflicts` screen to
  read it (that's B6), so there's nothing to loosen this for yet. Add the
  policy when B6 actually needs it, not speculatively now.

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
    conflicts/         components/ (ConflictCard + its three kind-specific
                       cards, DisputedResultCard read-only — built D1),
                       api.ts, actions.ts, resolveDisputedOpponent.ts,
                       resolveLowConfidence.ts (pure, mutation-tested),
                       types.ts — built B6
    job-health/        components/ (JobHealthBanner, RetryButton),
                       api.ts, actions.ts, evaluateJobHealth.ts,
                       types.ts — built B5
    picks/             components/ (QuickPick, BetRow), api.ts
                       (getMyPicksForFights, full MyPick row), actions.ts
                       (saveQuickPickAction, saveBetAction),
                       quickPickBands.ts, betProbabilityBands.ts,
                       mergePickFields.ts (pure, mutation-tested — the
                       read-merge-write both actions funnel through),
                       types.ts — QuickPick/api.ts/actions.ts/types.ts
                       built C3, BetRow/betProbabilityBands.ts/
                       mergePickFields.ts/saveBetAction built C4
    scoreboard/        components/, api.ts, types.ts               [NEW]
    rumours/           components/, api.ts, types.ts               [NEW]
    scouting-reports/  components/, api.ts, types.ts            [FROZEN]
    clans/             components/, api.ts, types.ts            [FROZEN]
    auth/              components/, api.ts
  shared/              components/, utils/
  lib/
    supabase/          browser + server + admin clients (admin.ts: one
                       service-role wrapper, shared — moved 2026-09-01
                       from ufc-data-sync/supabaseAdmin.ts once lib/odds/
                       needed the same client, rather than duplicate it)
    ufc-data-sync/     API-Sports + Wikipedia ingestion (existing);
                       buildSourceReportUpdate.ts — built D1, routes each
                       sync job's result into its own per-source columns
                       on fights instead of the old shared, last-write-
                       wins ones
    llm.ts             single Gemini wrapper — swappable in one file  [NEW]
    jobs/              runWithTracking.ts — generic job_runs bookkeeping,
                       built B5 for the odds jobs, written generically
                       because the Phase F rumour engine needs the same
    odds/              client.ts, matchFights.ts, parseOutcomes.ts,
                       similarity.ts, matchAndSnapshot.ts — built B3;
                       discoverStartTimes.ts, runDiscoverStartTimes.ts —
                       built B4 (`npm run odds:discover-start-times`);
                       snapshotWindow.ts, eligibleUnpricedFights.ts,
                       runOddsJobsOnce.ts, runScheduledOddsJob.ts — built
                       B5 (`npm run odds:scheduled-job`, and
                       .github/workflows/odds.yml every 2h);
                       rankFightMatches (matchFights.ts) — built B6, for
                       the conflicts screen's candidate picker
    reddit/            Reddit OAuth client                           [NEW]
    intern/            clustering + pick generation (batch)          [NEW]
    settlement/         evaluateFightSettlement.ts (pure, mutation-
                       tested), settleFights.ts, runSettleFights.ts
                       (`npm run settlement:settle-fights`, and
                       .github/workflows/sync.yml, after both sync jobs)
                       — built D1
    scoring/           impliedProbability.ts, edge.ts,
                       scorePickCorrect.ts, scoreBetPnl.ts, types.ts
                       (FightOutcome) — built C2; probabilityForFighter.ts,
                       priceForFighter.ts, applyProbabilityDelta.ts — built
                       C4, for the bet row's live edge. Pure functions,
                       no I/O
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
   against known moneyline examples. **Done in C2** —
   `lib/scoring/scoreBetPnl.ts`, tested against a favourite (decimal 1.20,
   profit = stake×0.20) and an underdog (decimal 3.5, profit = stake×2.5),
   plus a losing bet (`-stake` regardless of price) and a void (`0`,
   distinct from no-bet's `null` — see item #8's note below)
2. **Edge and implied-probability math** — `implied = 1 / decimal_odds` and
   `edge = (estimated_probability × decimal_odds) − 1`. This is what decides
   whether the intern bets at all, so an error here doesn't produce a wrong
   number, it produces a silently wrong *strategy*. No American-odds
   conversion: prices are stored exactly as the API returns them. **Done in
   C2** — `lib/scoring/impliedProbability.ts`, `edge.ts`, tested against
   the PRD's own -6000-favourite example (decimal 1.0167 → 98.4% implied,
   edge ≈ 0 when the estimate exactly matches the market). **Extended in
   C4** for the case C2 didn't need to handle yet — a bet backing a
   different fighter than the pick — via `probabilityForFighter.ts` and
   `priceForFighter.ts`, both mutation-verified
3. **Dual settlement** — `pick_correct` and `pnl_units` settle independently.
   The case that must be explicitly tested: prediction right, bet on the other
   fighter, bet wins. Both lines must record the truth rather than one
   overwriting the other. **Done in C2** — `scorePickCorrect.ts`,
   `scoreBetPnl.ts`, and a dedicated `dualSettlement.test.ts`. This exact
   sentence doesn't literally parse for a two-fighter fight (a fighter
   can't simultaneously be "predicted right" while "the other fighter's
   bet wins" — only one fighter wins at all), so rather than guess which
   direction was meant, both are tested: prediction wrong + bet on the
   winner (pick false, P&L positive) and prediction right + bet on the
   loser (pick true, P&L negative) — a mutation-verified regression guard
   confirms `scoreBetPnl` settles against `bet_fighter_id`, never
   `predicted_fighter_id`, which is the actual bug class this item exists
   to catch either way
4. **Pick lock** — a pick cannot be created or edited after `events.starts_at`.
   **Done in C1** — `check_pick_constraints()`, a `BEFORE INSERT OR UPDATE`
   trigger, `supabase/tests/rls.sql` checks 17/24, live-verified
5. **Odds snapshot immutability** — a later sync must not overwrite a price
   that is already pending or settled. **A second half, found while building
   B5:** a too-early write is just as permanent as an overwrite — the
   trigger (B2) only stops the second write, not a premature first one.
   `lib/odds/snapshotWindow.ts`'s `isPastSnapshotWindow` (the T-12h gate) is
   what stops that half, mutation-tested at its boundary and its null-start
   guard
6. **Odds ↔ fight matching** — a wrong match silently corrupts every
   downstream number, so low-confidence matches must reach the review queue
   rather than being guessed. Matching is **scoped to a window around the
   known card date**, not a name search across the full event list — the odds
   feed carries rumoured future matchups (same fighter against different
   opponents on the same date) that an unscoped search could false-match.
   Separately, **the client must select the two outcomes matching the fight's
   two fighters and discard `Draw` if present** — the original bookmaker
   (1xBet)'s MMA `h2h` payload was three-outcome, confirmed live 2026-09-01,
   and a parser that assumes two outcomes will silently misread the array.
   The current bookmaker (BetOnline.ag, switched the same day) is a clean
   2-way market, but the filter stays as a no-op safeguard rather than
   assuming that never changes again. **Done in B3** —
   `lib/odds/matchFights.ts`, `parseOutcomes.ts`, `similarity.ts`, 31 tests.
   The Draw-discard test was checked by mutation twice — once for each
   bookmaker's hardcoded key — removing the filter both times made the test
   fail with the actual Draw price (33.0) returned as a fighter's price,
   confirming it catches the real regression rather than passing for an
   unrelated reason. `matchAndSnapshot.ts` (the write-glue) **ran live for
   the first time in B5** (2026-09-01, explicit confirmation), gated by
   the T-12h check above — safe by construction at the time, since no
   known card was within 12h of starting, so every candidate was correctly
   excluded and `odds_snapshots` stayed at 0 rows, confirmed by a direct
   query afterward
7. **Disputed-opponent detection** — a candidate sharing *exactly one* fighter
   must open a conflict, never insert a second row; and a fight with an open
   conflict must be rejected by the pick-lock trigger. Both halves need a test,
   because a miss here puts real units on a bout that never happened.
   **First half done in A2** — `sharesExactlyOneFighter.ts`, 5 tests,
   mutation-verified. **Third half (resolving a conflict once a human looks)
   done in B6** — see the `data_conflicts` entry below. **Second half (the
   pick-lock trigger rejecting an open conflict) done in C1** —
   `check_pick_constraints()`, `supabase/tests/rls.sql` check 25,
   live-verified. All three halves of this item are now closed
8. **Settlement** — void, draw, and no-contest return the stake **and void
   both lines**: with no winner, "who wins" has no correct answer, so scoring
   the pick as wrong would be a bug, not a harsh call. Disagreement between
   sources settles neither line. **Done in C2, and clarified against
   docs/PRD.md's exact wording:** `pick_correct` is `null` for a void (no
   correct answer to score) but `pnl_units` is `0`, not `null` — the PRD
   says the stake is "voided and returned, not counted as a loss," which is
   a real, known net-zero outcome distinct from `null`'s "no bet was ever
   placed." Collapsing the two would make a voided bet indistinguishable
   from one that never existed on the units board. **The "disagreement
   settles neither line" half is done in D1** — `evaluateFightSettlement.ts`
   is what actually detects agreement/disagreement/draw-NC and produces
   the outcome C2's functions consume; C2 only ever covered what to do
   with an outcome already known. See Fork 6 above for the full result

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
