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
- **A void's `pnl_units` is `0`, never `null` — clarified against
  docs/PRD.md's exact wording in C2, not assumed.** `null` means "no bet
  was ever placed" (`bet_fighter_id` is null); `0` means a bet WAS placed
  and its stake was returned net-zero (cancelled/draw/no-contest — "voided
  and returned, not counted as a loss"). `pick_correct` for the same void
  IS `null`, not `false` — "who wins" has no correct answer, so scoring it
  wrong would be a bug. The two fields deliberately use different
  null-vs-zero conventions for the same void event; don't collapse them
  when Phase D's settlement job writes these columns for real.
- **`picks` is owner-only, not public — deliberately, and not permanently.**
  Decided 2026-09-01 (C1), user-originated: "for now just me until I prove
  the picks are actually reliable." A real product reason to record, not
  derivable from the RLS policy alone — revisit making `/scoreboard`/`picks`
  public once there's a track record worth showing. Also carries two PRD
  fields `ARCHITECTURE.md`'s original schema-decisions text never named:
  `confidence` (a separate 1-5 gut-check, distinct from
  `estimated_probability`'s precise number) and `predicted_method`/
  `reasoning` (both nullable — required free text on every pick would fail
  the no-learning-curve UX floor).

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

- **Bookmaker: BetOnline.ag (`betonlineag`), region `us`, decimal.** Switched
  2026-09-01 from the original choice, 1xBet — see below. Decimal is The
  Odds API's default format, so **no American-odds conversion exists
  anywhere in the codebase and none should be added** — it's a correctness
  risk that buys nothing.
- **Why the switch: a real user question about DWCS led to a proper check.**
  The first DWCS check searched for fighters from already-*concluded* weeks
  and only against `onexbet` — found nothing, and was wrong on both counts.
  Rechecked against the correct current week and every bookmaker in the
  feed: DWCS **is** priced, just not by 1xBet. `betonlineag` covers 56/63
  events (89%) vs `onexbet`'s 34/63 (54%), and was the only bookmaker
  checked that cleanly priced both UFC 331 and a real DWCS card. `pinnacle`
  covered DWCS but was absent from UFC 331, so it wasn't a clean
  single-bookmaker replacement.
- **`betonlineag`'s MMA `h2h` is a clean 2-way market** — no `Draw` entry,
  confirmed on both a UFC and DWCS fight. The Draw-discard logic in
  `parseOutcomes.ts` is kept anyway as a no-op safeguard, since it's
  proven-correct by mutation testing and a future bookmaker change could
  reintroduce a three-way shape.
- **Region is empirically irrelevant once `bookmakers=` is explicit** —
  identical coverage confirmed for `betonlineag` across `us`/`eu`/`uk`/`au`.
- **DWCS odds coverage is resolved; DWCS *ingestion* is not.** Wikipedia
  structures DWCS completely differently from UFC event pages: one page per
  *season*, weeks as sections inside it, plain-text dates instead of the
  `{{start date}}` template every parser here expects, and it isn't tracked
  by the category `fetchSchedule.ts` already polls. Whether to actually
  build DWCS ingestion is still an open, separate decision.
- **Credits are 1 per region per market for the whole request**, not per
  event. One card's snapshot is 1 credit against ~500/month, so budget is not
  the binding constraint.
- **Historical: 1xBet's `h2h` was three-outcome**, which is why the
  Draw-discard code exists at all. The 2026-08-29 double-chance discussion
  originally assumed `h2h` was a clean 2-way market and that MMA doesn't
  normally offer three-way — that was asserted, not checked; the live
  1xBet response contradicted it (every payload returned Fighter A,
  Fighter B, and `Draw`, ~33–34.0 decimal, with no separate `h2h_3_way`
  key — `422 INVALID_MARKET` if requested). Moot for the current bookmaker
  (BetOnline.ag is 2-way), kept as context for why the filter is there.
- **Double chance / 1X2 was raised and rejected** (2026-08-29), and the
  rejection still stands after the correction above — for a different reason
  than first given. Double chance is a wrapper bet ("Fighter A wins OR draw")
  that shortens every price to buy protection; what the market actually
  returns is a plain three-way price, not a combined bet. Hedging would still
  insure a sub-1% event at the cost of every price, and would still make the
  units board measure hedging discipline instead of reads. Do not reintroduce
  it — the settlement policy (draw voids and returns the stake) already
  covers the real case for free.
- **Design note for B3, found while reading the live response:** several
  far-future events list the same fighter against different opponents on the
  same date (rumoured pairings the market prices before matchmaking is
  final). The fuzzy fight matcher must scope to a window around a known
  card's date, not search by name across the full event list, or it risks a
  false match against a listing that never becomes a real fight.
- **B3 implemented this, 2026-09-01.** `lib/odds/matchFights.ts` uses a
  36-hour window (chosen from the real gap already observed: UFC 331's
  `commence_time` is 28h after its Wikipedia `event_date`) and a 0.85
  name-similarity threshold for auto-match; anything below opens a
  `data_conflicts` row instead of writing a price. Confirmed against the
  actual rumoured-matchup case (Gaethje listed against two different
  opponents on the same date): the wrong pairing scores well under 0.6,
  nowhere near the auto-match bar.
- **`data_conflicts` is shared, and was created in B3 rather than A2** —
  see `ARCHITECTURE.md`'s schema-decisions section for the shape. A2's
  scope narrowed to just the `upsertFight.ts` detection logic.
- **`matchAndSnapshot.ts` ran live for the first time in B5 (2026-09-01),
  gated by the new T-12h check.** `odds_snapshots` is immutable, so a
  premature write against the wrong fights would have been effectively
  permanent — this run was safe by construction (no known card within
  12h) and confirmed afterward by directly querying the table: 0 rows.
- **`fetchMmaOdds()` had a real, live bug from B3 that shipped undetected
  until B4 first called it end-to-end, 2026-09-01.** `new URL(path, base)`
  treats a leading `/` in `path` as absolute-from-origin, silently
  dropping `BASE_URL`'s own `/v4` instead of appending to it — every real
  request 404'd. Neither B1's `curl` checks nor B3's Vitest coverage ever
  exercised this exact code path: `curl` used the full URL string
  directly, and the tests only covered the pure matching/parsing logic
  downstream of the fetch, never the fetch itself. **The general lesson,
  not just this one bug:** an I/O boundary (`fetch`, a client's URL
  construction) needs either a real invocation or a pure, tested builder
  function around it — pure-function unit tests plus an unrelated manual
  `curl` check are not the same as exercising the actual code path. Apply
  this before trusting `lib/reddit/` or `lib/llm.ts` the first time either
  is built. Fixed here via `buildOddsUrl`, a pure exported function
  (single-argument `new URL(fullString)`, no base to silently resolve
  against) with its own test — mutation-verified, reverting to the broken
  form fails it.
- **`cookies()` anywhere in a Server Component's render path marks that
  whole page dynamic, even for a check as small as "who's logged in."**
  Found in B5: `JobHealthBanner` originally called `createClient()` from
  `lib/supabase/server.ts` (which calls `cookies()`) to decide whether to
  show a retry button, and `next build`'s route table silently flipped
  `/`, `/events/past`, and `/events/upcoming` from static+revalidated
  (`○`) to server-rendered on every request (`ƒ`) — a page-wide cost for
  one small piece of chrome, and it would have shipped unnoticed without
  comparing the build output before and after. Fixed by moving the
  ownership check out of the shared render path entirely: the button
  always renders hidden, checks ownership itself via a client-triggered
  server action after mount, and shows itself only once confirmed. **The
  general lesson:** before adding an auth check to anything mounted in
  shared layout chrome (a banner, a header widget), diff `next build`'s
  route table — a regression here is silent and page-wide, not local to
  the file that changed.

## Access control

- **The app is publicly deployed with open Google/GitHub signup on a tool
  meant for one user.** Found during `user-flow-mapper` (2026-08-29), fixed
  in A3 (2026-09-01): `is_owner()` plus one restrictive RLS policy per
  writable v1 table. See `ARCHITECTURE.md` Fork 8 for the full design.
- **Any new writable table needs the same restrictive policy, added
  deliberately — it will never happen by accident.** A brand-new table with
  only ordinary permissive policies (`user_id = auth.uid()`, etc.) is
  writable by *any* signed-in stranger, not just the owner, until an
  `is_owner()`-scoped policy is added for it too. **Applied in C1**:
  `picks`' own policies check `is_owner()` directly (no separate
  permissive-then-restrictive split was needed, unlike 0017's tables —
  those were retrofitting restriction onto existing permissive policies
  without touching them; `picks` was brand new, so it could just be
  written correctly from the start).
- **`SECURITY DEFINER` cuts both ways, and both directions have now bitten
  this project once.** A `SECURITY DEFINER` function needs its own
  `is_owner()` guard inside the function body — a table's RLS policy does
  not reach it (confirmed with `accept_clan_invite`, A3, bypassing
  `clan_members`' restrictive policy). The inverse also happens: a
  **regular, non-`SECURITY DEFINER` trigger function needs to become one**
  if it reads a table the *calling* role has no grant on at all — found
  live in C1, the first time an `authenticated` insert actually ran
  `check_pick_constraints()`: its open-conflict read of `data_conflicts`
  hit `permission denied` (that table has no `authenticated` grant,
  deliberately, 0014). Fixed with `SECURITY DEFINER` + `set search_path =
  public`, in a new migration (`0020`) since `0019` was already applied —
  never edit an applied migration. Check for both directions by default in
  any new privileged function or any new trigger that reads a
  service-role-only table.
- **`OWNER_USER_ID` must match the UUID hardcoded into `is_owner()`** in
  `supabase/migrations/0017_owner_allowlist.sql`, or the app-layer UI and
  the actual RLS boundary disagree about who the owner is. For any table a
  client writes to directly, the env var is UX only and carries no
  security weight — RLS enforces this independent of it. **Exception,
  found in B5:** for a write that only exists through the service-role
  admin client (no client INSERT grant exists at all for RLS to gate —
  `odds_snapshots`, `job_runs`), `lib/auth.ts`'s `isOwner()` check, run
  server-side against the real session, IS the actual boundary. Same
  underlying lesson as the `SECURITY DEFINER` bullet above, a third
  instance of it: whenever a code path reaches the database with elevated
  privilege and RLS can't see it, something at the app layer has to be the
  real gate, deliberately, not by assuming RLS already covers it.
- **`supabase/tests/rls.sql`'s label `'a'` must be the owner account** for
  checks 13–16 (added in A3) to mean anything — the file's own header now
  says so.

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

- **Migration workflow changed, 2026-09-01: Claude now runs migrations
  directly via the Supabase CLI, with the user's explicit go-ahead.**
  History: the CLI's migration tracking table was found out of sync with
  reality — `migration list --linked` showed every migration `0001`–`0016`
  with an empty `remote` column (all had been applied by hand through the
  Dashboard SQL Editor, which never writes to the CLI's tracking table),
  and `db push --dry-run` confirmed it would try to re-apply all sixteen.
  **Reconciled** via `supabase migration repair --status applied
  0001..0016 --linked` — bookkeeping only, nothing was re-run — after
  which `db push --dry-run` correctly isolated only the genuinely new
  migration as pending. Going forward: `supabase db push --linked` applies
  new migrations directly (re-verify the linked project ref is
  `vrwlfcywyfzfczajpdoh` before every push — the dashboard-visible-name
  checkpoint that caught Phase 11's mistake is gone, so this text
  confirmation is what's left in its place). The DB password was
  deliberately not requested — CLI access through the existing login
  token is a smaller blast radius than a raw Postgres connection string.
- **`supabase db query --linked -f <file>` genuinely works for a script
  shaped like `supabase/tests/rls.sql`** — confirmed 2026-09-01, full file
  run for real, `All RLS checks passed.` (checks 1–16). Getting there found
  one real, narrow, now-understood trigger, not a blanket tool limitation:
  a check whose success path is a `DO $$ ... $$` block containing an
  `INSERT`, run *immediately after* a **different** check whose `DO` block
  **caught** an `insufficient_privilege` exception, fails intermittently
  through this tool. Proven not a schema/policy bug: `is_owner()` and the
  restrictive policy passed every direct call and every simplified,
  semantically-equivalent reproduction (12 isolated diagnostic queries).
  Root cause in the tool/Postgres interaction still not identified.
  **The fix that matters going forward:** a check whose success path
  doesn't need to *catch* anything (no `exception when ...`) doesn't need
  a `DO` block at all — write it as a plain top-level statement (an
  `INSERT` that runs without error already proves success). Only checks
  that genuinely need PL/pgSQL's exception handling need a `DO` block. A
  check written that way is unaffected regardless of what precedes it —
  confirmed by rewriting check 14 this way, which is what made the full
  file pass. Apply this shape to any future check in this file, rather
  than defaulting to `DO $$ ... $$` out of habit.
- **A second Supabase project on the same account is named "GAMBLING
  TRACKER"** (`mbytqdkgwpzaensnphwd`, `ap-northeast-1`) — this is the exact
  project Phase 11 accidentally ran a migration against. It still exists.
  Always confirm the dashboard shows `ufc-scouting-app` /
  `vrwlfcywyfzfczajpdoh` (`ap-southeast-1`) before running anything.

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
- **The migration tracking table can say "applied" for a migration that
  never actually ran.** Found in B6: `data_conflicts` (0014) didn't exist in
  production at all, even though `migration list --linked` showed it
  applied — a genuinely serious gap, since every conflict-detection write
  path (`upsertFight.ts`, `matchAndSnapshot.ts`) would have thrown the
  moment either one first tried to use it, with no visible connection to a
  B3-era migration. Root cause: the Infrastructure entry above's
  `migration repair --status applied 0001..0016` reconciliation assumed
  every one of those files had genuinely been hand-applied through the
  Dashboard SQL Editor before it ran — true for the others, but apparently
  not for 0014, which the file's own header notes was added slightly out
  of the normal sequence ("created now, ahead of ROADMAP.md's A2"). `repair`
  only edits the tracking table; it never checks the schema actually
  matches. Found by a deliberate, safe, read-only live check
  (`getOpenConflicts()`/`getOpenConflictCount()` against production) done
  specifically *because* nothing had exercised that table's real I/O
  boundary yet — same discipline as the `fetchMmaOdds()` lesson above, one
  layer further out: it's not just "exercise the fetch," it's "exercise the
  fetch against the actual schema, don't trust the tracking table that says
  the schema is already right." Fixed by running 0014's file directly via
  `db query -f` against the live database (confirmed working: correct
  columns, correct grants — service_role/postgres only, no anon/
  authenticated). **Standing lesson:** after any `migration repair`,
  cross-check `information_schema.tables`/`.columns` against what every
  migration file actually claims to create, at least once, rather than
  trusting the repaired tracking table as proof the schema is right.
- **Vitest doesn't resolve `tsconfig.json`'s `"@/*"` path alias on its
  own** — Next's own bundler (webpack/Turbopack) does, but nothing wires
  that up for `vitest run`, since there was never a `vitest.config.ts`.
  Latent since day one; only surfaced in B6 when a test file first
  transitively imported a module using `@/...`
  (`resolveDisputedOpponent.ts`). Fixed with `vitest.config.mts`
  (`.mts`, not `.ts` — avoids an ESM/CommonJS warning without touching
  `package.json`'s module type) setting `resolve.alias` to match
  `tsconfig.json` manually. Any future test whose dependency graph reaches
  a `@/`-importing module needs this to already be in place — it now is.
- **Never send a partial object to `.upsert()` on a row multiple
  independent surfaces write to — read-merge-write instead.** Found in
  C4: C3's `saveQuickPickAction` sent
  `{predicted_fighter_id, estimated_probability, confidence}` only,
  relying on Supabase's `resolution=merge-duplicates` upsert to leave
  every other column (`bet_fighter_id`, `stake_units`, `reasoning`, ...)
  untouched on conflict. That reliance was never verified against this
  project's own working style ("don't trust third-party docs over what
  the API actually does" — same rule that caught the API-Sports and
  `matchAndSnapshot.ts` bugs earlier), and a wrong assumption here would
  silently erase a real bet the moment its pick got edited, with no UI
  action that looks like "delete my bet." Fixed by routing both
  `picks` actions through an explicit read-merge-write
  (`features/picks/mergePickFields.ts`, pure, test-first, mutation-
  verified) that always writes the complete row, rather than trusting
  PostgREST's upsert diffing. **Standing lesson:** any future table two
  or more separate actions write partial updates to needs the same
  pattern — a `.upsert(partialObject)` call is only safe when exactly one
  code path ever writes that row.
- **Inside a `SECURITY DEFINER` function, `current_user` is the function's
  OWNER, never the caller — `current_setting('role', true)` is the one
  that actually reflects `SET LOCAL ROLE`.** Found in D2, live-tested
  before shipping (not assumed): `check_pick_constraints()` needed to
  tell the settlement job (`service_role`) apart from every other caller,
  and the first version used `current_user = 'service_role'` — reasonable
  on its face, wrong in practice. `SECURITY DEFINER` was already required
  on this function since 0020 (to read `data_conflicts`, which
  `authenticated` has no grant on), and that elevation swaps
  `current_user` to the function owner (`postgres` here) for the entire
  execution, regardless of what role actually called it — confirmed with
  a throwaway `SECURITY DEFINER` test function returning `current_user`
  both with and without `set local role service_role` active: always
  `postgres`. The real bug this caused: **the settlement job itself got
  rejected by its own access-control check** — a genuine service_role
  write returned the exact same "can only be set by the settlement job"
  error as an unauthorized one, caught by testing the positive case live,
  not just the rejection. Fixed with `current_setting('role', true)`
  instead, which is a plain GUC read, unaffected by the privilege
  elevation — verified the same way, live, both directions, before
  shipping the fix (`0023_fix_settlement_role_check.sql`). **Standing
  lesson:** any future trigger/function that is both `SECURITY DEFINER`
  and needs to know its caller's role must use `current_setting('role',
  true)`, never `current_user` or `session_user` (the latter is the
  underlying login role and doesn't reflect `SET ROLE` either — confirmed
  the same session, both stay `postgres` throughout).

## Deliberate non-decisions

- **Clan invite links stay as-is** — no expiry, unlimited reuse, revoke
  manually. Works like a Discord invite. A deliberate choice for a small
  trusted group, not an oversight. Moot under the freeze, recorded so it isn't
  "fixed" later.
- **Pick lock is enforced at the card, not the bout.** Per-fight start times
  aren't reliably available, so picks lock at `events.starts_at`. This is
  *stricter* than the PRD's per-fight rule, which is the safe direction — it
  cannot be used to cheat the scoreboard.
- **A result correction after settlement is not re-examined — deliberately,
  D1.** `settleFights.ts` only ever looks at fights where `settled_at is
  null`; once set, it's never revisited, even if a source later corrects
  itself (an appeal overturning a decision, e.g. real UFC 214 precedent:
  Jones' KO win over Cormier later became a No Contest). The per-source
  columns (`wikipedia_winner_id` etc.) still update on a later correction —
  only the *clock* (`reported_at`) and the *authoritative* row stop moving
  once settled. If this ever matters for real (a settled pick turns out to
  need un-settling), it needs its own scoped design — don't assume it's
  covered by D1/D2's existing machinery.
