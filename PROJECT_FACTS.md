# Project Facts

Durable, project-specific decisions and facts that should survive across
sessions without being re-explained or re-litigated.

This is not `CLAUDE.md` (safety rules), not `CHANGES.md` (a dated log of what
shipped), and not `ARCHITECTURE.md` (the stack and structure). It is the
running memory of *decisions already made and why*, so a future session
doesn't reopen a settled question.

Appended to by `feature-planner` whenever a real decision gets made.

---

## Product scope

- **This is a single-user tool.** Confirmed 2026-08-29. It has a login only so
  the data isn't world-writable. No onboarding, no tutorial, no admin, no
  viewer, no guest. If it ever opens to other people it needs a **new PRD, not
  an edit** — multi-user changes structure, onboarding, and RLS all at once.
- **The v1 group features are frozen, not deleted.** Clans, invites, shared
  reports, and the three-tier visibility model keep their code, tables, and
  routes. No further development. If the group idea returns, the work is
  intact.
- **The `scouting_reports`/`fighter_scouting_reports` merge is cancelled
  permanently**, not deferred. It was waiting on real multi-user activity that
  the solo pivot means is never coming. Do not let a future session inherit it
  as an open TODO.
- **Real-money betting is out of scope in every form.** Units are simulated.
  No bookmaker accounts, no bet placement, no real currency. This is a paper
  scoreboard for measuring reads.
- **$0/month is a hard ceiling.** Free tiers only, no exceptions.

## Picks vs bets — the core product distinction

Decided 2026-08-29, user-originated.

- A **pick** says who wins. A **bet** says the price is wrong. They are
  different judgments and are stored and scored separately.
- **A bet may back a different fighter than the pick.** If you think A wins
  60% but A is priced at 75% implied, and B is priced at 25% while you think
  B wins 40%, then B is the correct bet. This looks contradictory on screen
  and is correct.
- A -6000 favourite is decimal 1.0167, **98.4% implied** — near-certain to win
  and worthless to back. The intern **declining to bet is a valid output**,
  not a failure.
- Every row settles **twice, independently**: `pick_correct` scores the
  opinion, `pnl_units` scores the money. Being right and losing money is a
  real and informative outcome.
- `estimated_probability` is **required**, not decorative. Without it a losing
  bet cannot be diagnosed — there's no way to separate a bad read from bad
  sizing. It also makes calibration directly checkable: of the fights called
  70%, did roughly 70% happen?
- **Accuracy must never stand in for the units board.** High pick accuracy
  with negative P&L is coherent and common — good reads at bad prices — and
  reading it as success is the exact mistake the two-board split prevents.

## Data sources

- **UFCStats.com is rejected, on evidence.** Checked live 2026-08-29: every
  page returns a 2,998-byte JavaScript proof-of-work challenge instead of
  content, and port 443 refuses connections. Reaching it would mean defeating
  a deliberate anti-bot gate on an already-unlicensed source. Do not re-propose
  it without re-checking whether that wall is still there.
- **Results come from Wikipedia + API-Sports cross-checked.** Both already
  built and licensed. API-Sports' known limitation is *no lookahead*, which
  doesn't apply to settlement — settlement is backward-looking.
- **No preferred-source rule.** Phase 7 disproved it: Wikipedia was stale in
  one case, API-Sports stale in the other. Any static precedence would have
  been wrong half the time.
- **`bout_order` is free.** `fetchSchedule.ts` already walks Wikipedia's
  `{{MMAevent bout}}` templates in document order and discards it. It only
  needs persisting as the array index.
- **Disputed opponents: detect, hold, self-resolve.** A candidate sharing
  exactly one fighter opens a conflict instead of inserting a second row. The
  fight is excluded from **both boards** while open. It clears on source
  convergence (usually days before the card) or on a confirmed result.

## Odds

- **1xBet, decimal, 2-way `h2h`.** Bookmaker key `onexbet`, **EU** region.
  Decimal is The Odds API's default format, so **no American-odds conversion
  exists anywhere in the codebase and none should be added** — it's a
  correctness risk that buys nothing.
- **Credits are 1 per region per market for the whole request**, not per
  event. One card's snapshot is 1 credit against ~500/month, so budget is not
  the binding constraint.
- **Double chance / 1X2 was raised and rejected** (2026-08-29). The 2-way
  market already returns the stake on a draw, so there is nothing to hedge;
  MMA is not normally offered three-way; hedging would shorten every price to
  insure a sub-1% event whose unhedged outcome is "stake returned," not
  "loss"; and it would make the units board measure hedging discipline rather
  than reads. Do not reintroduce without evidence 1xBet actually lists a
  three-way MMA market.
- **Unverified and blocking:** that 1xBet is a supported *bookmaker* does not
  establish that it returns *MMA* prices. The Odds API warns some bookmakers
  don't list less popular sports. Check a live response, and pick a fallback
  bookmaker, before any code depends on it.

## Undocumented external limits, found empirically

- **API-Sports free tier**: 100 req/day, a **~3-day date window**, and a **~10
  req/min** rate limit. None of these are documented — all three were found by
  triggering the errors (Phase 5).
- **Standing rule:** do not trust a provider's documented limits over what the
  API actually does. This rule has now paid off twice.
- **Still unverified**, and must be checked before code is built against them:
  The Odds API free tier, Reddit API at personal volume, and Gemini Flash's
  free tier for the actual clustering job.

## Infrastructure

- **The user has multiple Supabase projects.** Confirm the dashboard shows
  `ufc-scouting-app` (`vrwlfcywyfzfczajpdoh.supabase.co`) before running any
  migration. Phase 11 ran one against an unrelated project by mistake.
- **The GitHub repo is public.** Verified 2026-08-29 that no key-shaped string
  exists in the working tree or anywhere in git history, and that `.env*` is
  ignored with an `!.env*.example` exception.
- **Pushing to `main` is a production deploy** — Vercel auto-deploys from it.
- **The CI job is named `gates` and branch protection requires it by name.**
  Renaming the job silently disables protection, because a required check that
  never posts blocks merges forever rather than failing loudly.
- **Node 22**, chosen in Phase 12 after lockfile drift broke the sync workflow.

## Deliberate non-decisions

- **Clan invite links stay as-is** — no expiry, unlimited reuse, revoke
  manually. Works like a Discord invite. A deliberate choice for a small
  trusted group, not an oversight. Moot under the freeze, recorded so it isn't
  "fixed" later.
- **Pick lock is enforced at the card, not the bout.** Per-fight start times
  aren't reliably available, so picks lock at `events.starts_at`. This is
  *stricter* than the PRD's per-fight rule, which is the safe direction — it
  cannot be used to cheat the scoreboard.
