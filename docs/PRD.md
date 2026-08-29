# Product Requirements — UFC Scouting App

**Status:** v2 scope, written retroactively
**Written:** 2026-08-29
**Amended:** 2026-08-29 — picks and bets split into two separate judgments,
scoreboard split into two boards (UC-2, UC-3, UC-4, §5, §8); disputed-opponent
policy decided (§7)
**Supersedes:** the product story in `README.md` (see "Pivot record" below)

> This is the single source of product truth. `ARCHITECTURE.md` owns *how*
> it's built; this owns *what* and *why*. Where they disagree, this wins
> and `ARCHITECTURE.md` gets corrected.

---

## Pivot record — read this first

The app shipped (Phases 1–14) as a **group tool**: clans, invite links,
and a three-tier scouting-report visibility model, built to "make our
group's picks sharper by making our reasoning visible to each other."

That never happened. `HANDOFF.md` still lists "inviting friends and
actually using it together for a real fight card" as not done.

**On 2026-08-29 this was deliberately re-scoped to a single-user tool.**
It was chosen, not drifted into. The group features are frozen, not
deleted (see §4). If the group idea ever returns, the work is intact.

---

## 1. Problem statement

I watch a lot of MMA and I make picks — sometimes with real money. Two
things consistently cost me:

1. **I find out too late.** A bad weight cut, a camp injury, a coaching
   split — these surface on r/MMA and MMA Twitter days before a card, get
   buried under jokes and shitposting, and I read about them *after* the
   fight explains the result. The information was public and I missed it.
2. **I don't actually know if I'm any good.** I have a sense that I read
   fights well. I have no evidence. Picks live in group chats and betting
   apps that don't tell me whether my *reasoning* beats just taking the
   favourite every time.

Neither problem is "I need a model to tell me who wins." Both are
**scouting labour and record-keeping** — exactly the work that's tedious
enough that a human skips it and a machine won't.

**Why now:** the app already has the fighter/event data layer, auth, and a
deploy pipeline built and live. The expensive foundation is done; what's
missing is the part that was actually the point.

---

## 2. Users

**One user: me.** This is a personal tool that has a login only so the data
isn't world-writable.

Confirmed implications — recorded so nobody "helpfully" adds them later:

- **No onboarding, no tutorial, no marketing surface.** The app can assume
  its user knows what a unit and a moneyline are.
- **No per-user cost ceiling.** API spend is one person's usage.
- **Empty states still matter** — but as "no card this week," not as
  "welcome, here's how to get started."
- **No second user type.** No admin, no viewer, no guest. The sync job and
  cron are infrastructure, not users.

If this ever opens to other people, it needs a new PRD, not an edit —
multi-user changes cost structure, onboarding, and RLS all at once.

---

## 3. Core use cases

### UC-1 — Scout the card (the intern's real job)

Before a card, I open an event and each bout shows what the intern turned
up from r/MMA and socials: weight-cut trouble, injuries, camp changes,
short-notice replacements.

**Each flag must show corroboration and sourcing, never a bare boolean:**

- how many *independent* posts said it, over what window
- direct links to each post
- whether any trace back to a named journalist, the camp, or the fighter

The intern **clusters and dedupes; it does not opine.** It never assigns a
credibility score. Judging the rumour is my job — that's the whole
intern-not-oracle premise, and it's why a flag I disagree with costs me
nothing.

### UC-2 — Log a pick, and separately decide whether to bet it

**A pick and a bet are two different judgments and must not be collapsed.**

- A **pick** says who wins. No money. I can have an opinion on a fight I
  would never back.
- A **bet** says *the price is wrong*. Units at the frozen snapshot price.

They come apart at both ends. A -6000 favourite — decimal 1.0167, **98.4%
implied** — is near-certain to win and worthless to back; you would need to
believe better than 98.4% before a single unit of edge exists. And an
underdog I think probably *loses* can still be the correct bet if the market
prices it below my own estimate. So a bet may be placed on the fighter I did
not pick, and that is a feature, not a contradiction.

For each: predicted winner, my **estimated probability**, confidence,
optional predicted method, free-text reasoning — and optionally a
`bet_fighter` plus unit stake.

Estimated probability is required, not decorative. Without it a losing bet
cannot be diagnosed: there is no way to tell a bad read from bad sizing.

**Pricing comes from one scheduled odds snapshot taken ~12 hours before the
event** — that's when I actually place my hypothetical picks. Every pick,
mine and the intern's, settles at that single frozen price.

This is deliberately *better* than snapshotting per-pick. One reference
price per card means the intern and I are priced identically, so the P&L
comparison measures reads rather than who happened to pick earlier. It also
fits the free tier exactly: one pull per card.

A pick logged before the snapshot lands sits **unpriced** until T-12h, then
takes that price. Odds are never re-read after the snapshot.

### UC-3 — The intern picks against me

The intern **anchors on the market and deviates when its own scouting gives
it a reason to.** It is explicitly not allowed to just rubber-stamp heavy
favourites — a favourite with a corroborated weight-cut flag is exactly the
case it should fade.

It runs the **same two-judgment discipline as me**, so the comparison is
like-for-like: it picks a winner on every fight, and separately decides
whether the price justifies backing anyone.

**It must be capable of declining to bet.** A pick it is confident in but
cannot back at the offered price is a correct and expected output — silence
on a -6000 favourite is the intern working, not failing. Betting is gated on
edge, `(estimated_probability × decimal_odds) − 1`, above a threshold, and
sized by that edge. This is what stops it piling units onto unbackable
favourites, and it is the same reason it is not allowed to rubber-stamp
chalk.

### UC-4 — The scoreboard: two boards, not one

Because a pick and a bet are different judgments, they are scored separately.
Every row settles **twice, independently**.

**Board 1 — units (bets only).** Did I find mispriced fights?

| Line | What it is | Why it's there |
|---|---|---|
| **Me** | my bets, my stakes | the thing being measured |
| **Intern** | its bets, its stakes | the opponent |
| **Chalk** | flat 1u on every favourite, every fight | the control — precisely the strategy that ignores value |

**Board 2 — accuracy (picks).** Did I read the fights right?

| Line | What it is | Why it's there |
|---|---|---|
| **Me** | my picks | |
| **Intern** | its picks | head-to-head on fights we both picked |
| **Chalk** | always pick the favourite | the control — favourites win most of the time, so a pick line that cannot beat this is noise |

Head-to-head on shared fights is the headline accuracy number, since only
fights we both picked are like-for-like. The intern's full-card accuracy is
shown alongside as secondary context — it costs nothing and stabilises faster.

**The two boards can and should disagree.** Being right and losing money
means good reads and bad prices; being wrong and making money means the
reverse. That divergence is not noise to be reconciled — it is the most
informative thing on the screen, and neither board alone can show it.

Both chalk lines are computed automatically and cost nothing. **If neither of
us beats them, that's the single most valuable thing this app can tell me** —
and without them, a positive P&L proves nothing.

Breakdowns: by weight class, by stance/style matchup, by favourite vs.
underdog, and by whether a rumour flag was present.

### UC-5 — Close the loop on rumours

After the fight, mark whether a flag turned out to be real. Over time this
says whether the rumour engine is signal or noise — measurable, not vibes.

---

## 4. Explicitly out of scope

**Frozen, not deleted** (code and tables stay, routes stay reachable, no
further development):

- Clans, clan invites, clan membership
- Shared scouting reports and the `PRIVATE` / `SPECIFIC_CLANS` /
  `ALL_MY_CLANS` visibility model
- The deferred `scouting_reports` + `fighter_scouting_reports` table merge
  described in `HANDOFF.md` — it was postponed pending real multi-user
  activity, which is now never coming. **Do not start it.**

**Not built, deliberately:**

- **Real-money betting, in any form.** Units are simulated. No bookmaker
  accounts, no bet placement, no real currency, no bankroll withdrawal.
  This is a paper scoreboard for measuring reads.
- **Multi-user anything** — no leaderboards against other people, no
  sharing, no public profiles, no fully-public tier
- **Live / in-fight** anything — no round-by-round, no live odds streaming
- **A native mobile app** — responsive web only
- **Non-UFC promotions** — no Bellator, PFL, ONE, regional
- **Fighter-level advanced stats** (strike accuracy, takedown defence) —
  never confirmed available on the current source; not a v1 dependency
- **The intern giving a credibility verdict** on a rumour — explicitly
  rejected in favour of corroboration counts + links
- **Automated bet sizing advice.** The intern sizes *its own* simulated
  stakes. It never tells me what to stake.

---

## 5. Success metrics

**Primary — the reason this exists:**

> Over **10 completed UFC cards**, my unit P&L beats the intern's unit P&L,
> and both beat the chalk control line.

Losing is a valid, informative result. If chalk wins, I learn my reads
aren't worth the effort — which is worth knowing, and is the honest outcome
the app is built to surface.

**Secondary:**

| Metric | Target |
|---|---|
| Rumour precision | ≥3 flags over 10 cards confirmed real post-fight |
| Rumour recall (inverse) | ≤1 fight per card where a known pre-fight issue was missed entirely |
| Discipline | a logged pick + stake for every card in the 10-card window, none logged after the fight started |
| Odds coverage | ≥90% of staked fights have a snapshotted price |

**Accuracy is a real metric, but a different one.** It scores Board 2 (picks)
and is measured head-to-head against the intern and against always-pick-the-
favourite. What it must never do is stand in for Board 1: accuracy cannot
distinguish a 0.5u chalk bet from a 2.5u underdog read, which is exactly the
skill the units board exists to measure.

**The anti-metric, stated precisely:** using pick accuracy as evidence that
the *betting* is working. A high pick accuracy with a negative unit P&L is a
coherent and common result — it means good reads at bad prices — and reading
it as success is the specific mistake this two-board split exists to prevent.

---

## 6. Constraints

| Constraint | Detail | Source |
|---|---|---|
| **$0/month, hard** | Free tiers only, no exceptions | decided 2026-08-29 |
| Existing stack | Next.js + Supabase + Vercel — not restarting | shipped Phases 1–14 |
| Single developer | Non-technical "vibe coder" building architecture judgement deliberately; structure and security beat delivery speed | `HANDOFF.md` |
| API-Sports free tier | 100 req/day, ~3-day date window, ~10 req/min — all found empirically, none documented | `CHANGES.md` Phase 5 |
| Odds free tier | ~500 credits/month → one scheduled pull per card at T-12h, no line-movement tracking | to verify |
| LLM free tier | Gemini Flash or Groq. **Must be verified empirically before anything is built on it**, and must sit behind one swappable wrapper module so a dead tier is a one-file change | see §9 |
| Reddit API | Free at personal volume; needs a registered OAuth app | to verify |
| Data ordering gap | No `bout_order` column exists; card ordering is currently unreliable | verified in schema |

**Standing rule, learned the hard way:** do not trust a provider's
documented limits over what the API actually does. Phase 5 found two
undocumented free-tier limits only by triggering the errors.

---

## 7. Edge cases and failure states

### Correctness-critical — test-first, per project rules

These involve money math, ID resolution, and data merging. Per the global
working rules, **the failing test gets written before the implementation,
and "done" means the test was run and observed passing.**

- **Odds ↔ fight matching.** Names differ across sources ("Jon Jones" vs
  "Jonathan Jones"). A wrong match puts the wrong price on the wrong fight
  and silently corrupts every downstream P&L number. Needs fuzzy matching
  with a confidence threshold and a **manual review queue for low-confidence
  matches** — never a silent best guess.
- **Pick lock.** A pick cannot be created or edited after the fight's
  scheduled start. Without this the scoreboard is self-cheatable and every
  metric in §5 is worthless.
- **Odds snapshot immutability.** The T-12h price is written once and never
  re-read. A later sync must not overwrite a price that is already pending
  or settled, even if the line has moved since.
- **Unit P&L math.** Underdog returns, favourite returns, and void handling
  must be tested against known moneyline examples.

### Settlement

- **Fight cancelled, no contest, or draw** → stake **voided and returned**,
  not counted as a loss. Must not silently score as a loss.
- **Fighter misses weight but the fight proceeds** → settles normally; the
  missed weight is recorded as a flag outcome, not a void.
- **Card postponed** → picks carry to the new date, locks recompute.
- **Sources disagree on the result** → do not settle. Surface it for manual
  resolution.
- **Disputed opponent** (the `CHANGES.md` Phase 7 problem, now decided): the
  two sources sometimes report a different opponent for the same fighter on
  the same card. These are **one bout the sources disagree about**, not two
  bouts — almost always a late replacement one source hasn't caught. Policy:
  **detect, hold, self-resolve.** A candidate sharing exactly one fighter opens
  a conflict instead of inserting a second row; the fight is excluded from
  **both boards** while the conflict is open, matching sportsbook practice
  where an opponent change voids bets on that bout. It clears automatically
  when the sources converge (the common case, usually days before the card),
  or after the fight, since the row with a confirmed result is the one that
  happened. A preferred-source rule was rejected: Phase 7 showed Wikipedia
  stale in one case and API-Sports stale in the other, so any static
  precedence would have been wrong half the time.

### Rumour engine

- **LLM free tier exhausted or discontinued** → fall back to heuristic
  clustering (fuzzy name match + concern keywords). **Must degrade loudly —
  never silently return zero flags**, which is indistinguishable from
  "nothing to report" and is the worst possible failure.
- **Reddit rate-limited or down** → last successful scrape shown, clearly
  stamped with its age.
- **Post deleted after flagging** → snapshot post text at scrape time so the
  evidence survives link rot.
- **Ambiguous fighter names** ("Silva," "Rodriguez," "Nurmagomedov") →
  ambiguous mentions are dropped, not guessed. A false flag is worse than a
  missing one because it actively moves my hand.
- **Rumour volume spike from a joke or meme** → corroboration counts
  independent *claims*, not raw post volume; near-duplicates collapse.

### Odds and data

- **Odds unavailable for a fight** → picking is still allowed; the pick is
  marked unpriced and excluded from unit P&L, included in accuracy.
- **The T-12h snapshot job fails or is missed** → the whole card is
  unpriced, which would silently void an entire event's scoreboard. Must
  alert loudly and allow a manual late pull, accepting the worse price
  rather than losing the card. A missed snapshot is the single highest-
  impact failure in the system.
- **Free tier exhausted mid-month** → existing snapshots are unaffected; new
  fights show as unpriced.
- **No upcoming card in range** (the Phase 5 ~3-day window problem) →
  explicit "nothing scheduled in range" state, distinct from an error.

---

## 8. Feature prioritisation (MoSCoW)

### Must have — v2 is not real without these

- `bout_order` on fights (correct Main Event → prelims ordering)
- Odds ingestion: one scheduled snapshot per card at T-12h, with fuzzy
  fight matching + a review queue for low-confidence matches
- Disputed-opponent detection: one conflict queue covering both low-confidence
  odds matches and contested bouts; disputed fights excluded from both boards
  until resolved
- Pick logging: predicted winner, **estimated probability**, confidence,
  reasoning — on any fight, no stake required
- Bet logging: **optional and separate**, may back a different fighter than
  the pick; unit stake at the snapshotted price, enforced pick lock
- Reddit/social rumour engine: corroboration count + source links, no
  credibility verdict
- Intern output: market-anchored, rumour-adjusted picks on every fight, plus
  edge-gated bets it is **free to decline entirely**
- Two-board scoreboard: **units and accuracy**, each with its own chalk
  control line
- Result settlement including void / draw / NC handling
- **A test runner** — none is currently installed, and the
  correctness-critical items in §7 cannot be done test-first without one

### Should have

- Rumour outcome tracking (UC-5) — the precision/recall metric depends on it
- Breakdowns by weight class, stance/style matchup, favourite vs. underdog
- Tale-of-the-tape differentials on the fight page
- Retire or clearly hide the frozen clan surface from navigation

### Could have

- A real statistical model as a *fourth* scoreboard line
- Historical / closing-line odds and closing-line value
- A second odds pull at T-24h to measure line movement into the T-12h
  snapshot — the free tier has enough credits for it
- Alternative staking systems (Kelly, flat) as comparison modes
- Method-of-victory prediction scored separately
- Tapology as a supplementary source

### Won't have (this version)

- Everything in §4
- Any paid API tier
- Live odds movement tracking
- Multi-user or social features of any kind

---

## 9. Tech stack

### Currently shipped

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 16.3.0**, App Router | Middleware is `src/proxy.ts` — Next 16 renamed it; building from memory silently breaks it |
| UI | **React 19.2.8** | Server Components by default |
| Language | **TypeScript 5** | strict |
| Styling | **CSS Modules** + CSS custom properties | No Tailwind. Dark mode via `ThemeToggle` |
| Database | **Supabase Postgres** | 12 migrations, numbered, append-only |
| Authorization | **Postgres Row Level Security** | Access rules live in the DB, not scattered through app code |
| Auth | **Supabase Auth** — Google + GitHub OAuth | No passwords, no email/password |
| Client libs | `@supabase/supabase-js`, `@supabase/ssr` | Separate browser/server clients |
| Fighter/event data | **API-Sports MMA API** (free) + **Wikipedia** | Two sources: API-Sports has no lookahead, Wikipedia has the schedule |
| Sync runtime | **tsx**, `dotenv-cli` | `npm run sync` |
| Hosting | **Vercel** free tier | Auto-deploy on push to `main` |
| Cron | **GitHub Actions** (`sync.yml`) | Twice daily |
| CI | **GitHub Actions** (`ci.yml`) | `npm ci` + lint + build |
| Lint | **ESLint 9** + `eslint-config-next` | |
| Testing | **none** | Real gap — see Must-have |

### To be added for v2

| Layer | Choice | Status |
|---|---|---|
| Odds | **The Odds API**, free tier | Limits to verify empirically |
| Social source | **Reddit API** (r/MMA), free tier | Needs a registered OAuth app |
| LLM | **Gemini Flash or Groq**, free tier | Provider undecided; **must sit behind one wrapper module** (`lib/llm.ts`) so it's swappable |
| Fuzzy matching | String-similarity library, TS side | Replaces today's exact `ilike` name match |
| Testing | Test runner TBD (Vitest likely) | Required before correctness-critical work starts |
| Scraping | **Open** — see below | |

### Open technical forks — for `app-architect`, not decided here

1. **UFCStats.com as a third source.** The v2 spec asks for it (correct bout
   order, results in 5–15 min). `ARCHITECTURE.md` Phase 3 explicitly
   rejected it as "fragile and unlicensed." Deferred deliberately.
   **Product requirement to satisfy, whichever way it goes:** results
   reliable enough to settle units within ~24h, and correct card ordering.
   Note a third source makes the Phase 7 merge conflict harder, not easier.
2. **Python vs. TypeScript for scraping.** The v2 spec assumes Python
   (BeautifulSoup, `rapidfuzz`). The project is 100% TypeScript and deploys
   to Vercel. A Python component means a second runtime, probably running in
   GitHub Actions rather than Vercel. Real tradeoff, not yet made.
3. **Where the intern runs.** Rumour scraping + clustering is a batch job,
   not a request-time operation. Likely GitHub Actions alongside the existing
   sync, but odds/LLM rate limits may force a different cadence.
4. **Unified reports table.** The `HANDOFF.md` merge plan is now moot under
   the freeze — confirm it stays cancelled rather than being silently
   inherited by a future session.

### Layer boundaries (unchanged, enforced as file layout)

UI components hold no business logic and make no external calls. All
outbound calls — Supabase, Reddit, odds, LLM — live in `lib/` or a feature's
`api.ts` / `actions.ts`. Route handlers stay thin. Every third-party SDK gets
exactly one wrapper module.

---

## 10. Traceability

| Decision | Origin |
|---|---|
| Solo pivot, clans frozen | decided 2026-08-29 |
| Rumours over stats as the intern's core job | decided 2026-08-29 |
| Corroboration + links, no credibility verdict | decided 2026-08-29 |
| $0 hard ceiling, free-tier LLM | decided 2026-08-29 |
| Unit-based P&L over raw accuracy | user-originated — upgraded the metric |
| Intern must not blindly pick chalk | user-originated — resolved the baseline problem |
| Chalk control line | decided 2026-08-29 |
| Odds priced from one T-12h snapshot, not per-pick | user-originated — matches when picks actually get placed |
| Data source fork deferred | decided 2026-08-29 |
| **Pick and bet split into two judgments** | user-originated — the intern must be able to decline an unbackable favourite |
| **A bet may back a different fighter than the pick** | user-originated — value can sit on the side you think loses |
| **Two scoreboards (units + accuracy), each with a chalk control** | follows from the split; resolves the old "accuracy is an anti-metric but display it anyway" tension |
| UFCStats rejected on evidence (JS proof-of-work wall, no HTTPS) | verified live 2026-08-29 — see `ARCHITECTURE.md` Fork 1 |
| Disputed opponents: detect/hold/self-resolve, no preferred source | decided 2026-08-29 — Phase 7 data disproved static precedence |
| Disputed fights blocked from **both** boards, not just bets | decided 2026-08-29 — a bout that may not exist can't score a pick either |
