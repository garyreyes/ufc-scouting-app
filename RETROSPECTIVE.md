# Retrospective — what I'd change next time

An honest look back at how this project actually went, written for whoever
plans the next one (probably future-me, probably with a Claude Code
session reading this file to tune its own workflow).

Two eras: **v1** (Phases 1–14, a group note-sharing tool) and **v2**
(Phases 15–62, the pivot to a single-user handicapping tool with odds,
an automated tipster, a rumour engine, and two scoreboards). The v1
lessons are kept because they're still true and because v2 is partly the
story of whether the fixes held.

---

# Part 1 — v1 lessons (Phases 1–14)

## What caused the most pain

**RLS bugs were invisible until tested live, and testing live was slow.**
Phases 10 and 11 — the clan chicken-and-egg bug and the scouting report
recursion bug — were real permission-logic bugs that `npm run build` and
TypeScript could never catch, because they live in the database. Each one
meant: change SQL in the dashboard, reload, click through the UI, watch it
fail, guess again. Phase 10 additionally burned real time on a wrong
theory (JWT signing keys) before the actual bug surfaced. The technique
that worked — `set local role authenticated; set local
"request.jwt.claims" = '...'` directly in SQL — should have been the
*first* move, not a discovery made after a detour.

**The deploy pipeline had no safety net before it existed.** A
`package-lock.json` / `npm ci` mismatch broke the Actions sync workflow.
Invisible locally (Windows `npm install` tolerated it), surfaced only when
the workflow ran on Linux. No CI meant platform drift had no chance to be
caught early — production caught it instead.

**Two nearly-identical schemas got built instead of one flexible one.**
`fighter_scouting_reports` + `fighter_report_clan_shares` were added by
copying `scouting_reports` + `report_clan_shares` almost exactly, including
a near-duplicate security-definer function. Double the schema surface,
double the RLS policies to audit. A single table with a nullable
`fighter_id` *or* `fight_id` plus a check constraint would have been one
of each. Nothing caught it because there was no design pass — just "copy
the pattern that already works."

**Deployment target was decided very late.** Vercel wasn't picked until
auth, clans, and reports were built. Nothing had to be rebuilt, but
"which env vars reach which execution context" got worked out reactively.

## Did the v1 fixes hold in v2?

| v1 recommendation | Outcome |
|---|---|
| Set up CI before feature code | **Adopted, worked.** Phase 15 stood up real gates (`lint`/`test`/`build` as a required `gates` job). Zero repeats of the lockfile class of bug across 47 more phases. |
| Treat RLS as testable | **Adopted, worked.** `supabase/tests/rls.sql` exists and is trusted. Phase 34 caught a real access-control hole *before* it shipped, and Phase 41 caught a service-role bypass in the pick-lock trigger the same way. This was the highest-leverage v1 fix, exactly as predicted. |
| Design pass before copying a pattern | **Partially.** `feature-planner` got used consistently, and the fork-as-question habit stuck. But see "the I4 scope mistake" below — planning a *data job's blast radius* is a gap the skill doesn't cover. |
| Decide deploy target + secrets early | **Not fully.** Phase 42 was a **production outage** because `OWNER_USER_ID` was never set on Vercel — exactly the "which context needs which env var" gap v1 flagged. The lesson was written down and still not operationalised. |
| Use a Supabase MCP server | **Not done — and it cost again.** The "wrong Supabase project" mistake recurred in v2: a migration was pasted into the dashboard SQL editor against **GAMBLING TRACKER** instead of the app's project. It failed harmlessly (`relation "picks" does not exist`), but only by luck of the table not existing. Two occurrences across two eras makes this systemic, not a slip. |
| Keep surfacing forks as questions | **Adopted, worked, extended.** Now the single most reliable quality mechanism in the project. |

---

# Part 2 — v2 lessons (Phases 15–62)

## The dominant bug class: silently wrong data

v1's worst bugs were *loud* (a page 500s, a policy denies you). v2's worst
bugs were **silent** — code that ran cleanly, returned a plausible number,
and was wrong. Every gate passed on all of these:

| Incident | The silent failure |
|---|---|
| **Elo eligibility + ordering** (Phase 48) | Elo read `settled_at IS NOT NULL` ordered by `settled_at`. Production had 57 fights with a recorded winner and **zero settled**, so the rebuild ran over an empty set — for weeks. And settlement order isn't chronological, so even once fights settled they'd have rated in the wrong sequence. Two bugs, one query, no error. |
| **Positional bout identity** (Phase 47) | `external_id` was `UFC 330:7` — card *position*. A reordered card stamped the wrong bout's winner onto a row. Left 10 fights recording a winner who wasn't in the bout (Phase 49 cleared them). |
| **Fabricated draws** (Phase 49) | The obvious repair — clear `winner_id` on those 10 rows — would have *promoted* them from "excluded" to "real draws that move ratings," because `method` was also populated. Listing the rows in full before touching them is what caught it. |
| **Unbounded queries** (Phases 59–60) | `.select()` over a whole table truncates at PostgREST's row cap **with no error**. `recomputeEloRatings` was one event away from rebuilding every rating from a partial graph. And `.in("fight_id", [...832 uuids])` built a ~30KB URL that the edge rejected — a hard `/scoreboard` 500 in production. |
| **`numeric` arrives as a string** (Phase 61) | `stake_units`/`pnl_units` were cast `as number` but PostgREST serialises `numeric` as strings. `netUnits += "1.56"` concatenates. Dormant only because nothing had settled yet. |
| **Wrong column names** (Phase 58 work) | Querying `wikipedia_reported_winner_id` (real name: `wikipedia_winner_id`) or `fights.created_at` (doesn't exist) returns an error object — and `?? []` turned that into a confident "0 rows." |
| **A dead branch in a heuristic** (Phase 62) | `predictInternMethod` could **never** return `SUBMISSION` for any input, and every heavyweight fight returned `KO_TKO` regardless of matchup. The tests passed because the lopsided case only asserted `.not.toBe("DECISION")`. Found by a reviewer brute-forcing the input space. |

**The pattern:** every one of these is a case where *wrong* and *right*
produce identically-shaped output. TypeScript, lint, and build cannot
distinguish them, and a hand-written test only catches them if the author
already suspected the failure.

## The I4 scope mistake — the one genuine self-inflicted data incident

The Wikipedia history backfill was run with an "all past events" scope. It
reprocessed 3 events that had already been hand-curated in Phases 52–54,
firing the disputed-opponent guard on already-settled bouts and opening ~9
spurious conflicts. Recovery took a full pass: narrow the job to gap-only
permanently, revert 2 contaminated events to their exact prior state,
delete 8 conflicts, clear `wikipedia_*` on 18 rows.

**What would have prevented it:** a mandatory dry-run printing *what the
job would touch* before it touched anything. The scope question was even
surfaced as a fork and answered — the answer was just wrong, and nothing
made that visible until after the write.

## External APIs never match their docs

Every single external-source assumption that got verified turned out
wrong, and each verification changed the plan:

- **API-Sports**: undocumented ~3-day date window, ~10 req/min cap,
  free tier serves **seasons 2022–2024 only** (refuses 2025+), and
  **serves no win/loss record field at all** — the record had to be
  derived by counting, not fetched.
- **Reddit → Bluesky** (Phase 37): Reddit's API now needs opaque manual
  approval; X's free tier is gone. The whole social source pivoted at
  spike time rather than at integration time.
- **Bluesky**: `createSession` is capped at 30/5min *and* 300/day per
  account, and `searchPosts` 403s on the `public.api.bsky.app` mirror.
  A cold-cache retry storm (Phase 56) burned the daily cap and then
  perpetuated itself.
- **Wikipedia**: 429s after ~6 rapid requests; needs 1.5s spacing.
- **UFCStats.com**: rejected outright — every page behind a JavaScript
  proof-of-work wall, found by checking rather than assuming.

The `CLAUDE.md` rule "do not trust third-party docs over what the API
actually does" was written after the first of these and paid for itself
four more times.

## What worked well

**The correctness-critical / judgment split.** Test-first on money math,
counting, ID resolution, and data-merging rules; no tests on layout, copy,
or ordering. 420 tests, almost all on pure functions, and they caught real
regressions without breaking on every legitimate UI change. The split is
the reason the test suite is trusted rather than tolerated.

**Pure function + I/O sibling.** `computeEloHistory` (pure, sequential
math) / `recomputeEloRatings` (fetch, delete, reinsert) is the template
the whole codebase follows. It's what made the Elo rules testable at all,
and it's why extracting `isNoContestOrAmbiguous` and `devigTwoWay` later
was mechanical rather than risky.

**Verification spikes before building.** B1 (odds), F1 (social source),
I2 (does API-Sports have a record field?), I4 (can the parser read a past
event?). Four spikes, four plan changes. None was wasted.

**The `reviewer` agent.** Two invocations this session, two real bugs the
gates could not see: the offset-pagination flaw and the unreachable
`SUBMISSION` branch. Both were in code I had just written and believed
correct. Fresh eyes with no memory of the intent is a genuinely different
check from re-reading your own work.

**`PROJECT_FACTS.md`.** The highest-value document in the repo. It's what
stopped decisions being re-litigated across dozens of sessions — "the
intern doesn't read W/L records," "records are tracked-window not career,"
"the backfill is gap-only permanently." Each of those would otherwise have
been rediscovered the expensive way.

**Deterministic over LLM for the intern** (user-confirmed, Phase 41). The
same fight always produces the same number, which is the only reason the
calibration check means anything. With a non-deterministic estimator you
cannot tell a bad rule from a bad day.

**Dual-source settlement.** Nothing is authoritative until two independent
sources agree, or one source plus a 24h timeout. Disagreements open a
human-review row instead of being silently resolved. This is why the data
is trustworthy enough to build ratings on.

---

# Part 3 — what to change next project

## 1. Write a "silent failure" checklist and apply it to every query

The dominant v2 bug class has a small, enumerable set of causes:

- **Never `.select()` a whole table unpaged.** PostgREST truncates at its
  row cap with no error. Use keyset pagination (`id > cursor`), not
  offset — an offset shifts under concurrent writes.
- **Never build an unbounded `.in(...)` list.** It goes in the URL; a few
  hundred UUIDs exceeds the length limit and returns a hard error.
- **Coerce `numeric` columns with `Number()`.** They arrive as strings.
- **Verify column names against the migration before writing the query.**
  A typo returns an error object, not an empty result.
- **Never `?? []` on a query result without checking `error` first.** That
  idiom converts every failure into a confident empty list.

This is five rules and would have prevented five separate incidents.

## 2. Any heuristic mapping continuous input → discrete output gets a reachability test

Brute-force the input grid and assert every possible output actually
occurs. The `predictInternMethod` dead branch survived a hand-written test
suite because the assertions were vague (`.not.toBe(X)`), and it would
have shipped a permanently-wrong prediction that no amount of later tuning
could fix. This test is ~10 lines and mechanical.

## 3. Every data-mutating job ships with a dry-run, and the dry-run is mandatory

Print what would be touched — counts, sample rows, the exact scope — and
require reading it before the real run. The I4 scope mistake is the only
self-inflicted data incident in 62 phases, and a dry-run would have made
it a non-event.

## 4. Env-var contract in ARCHITECTURE.md from day one

A table of *variable → which execution contexts need it* (local / CI /
Vercel / Actions), written before the first deploy. Phase 42 was a
production outage from `OWNER_USER_ID` missing on Vercel — the exact gap
v1's retrospective already named. Writing the lesson down didn't fix it;
a checklist artifact would have.

Also: **trim secrets on read.** A trailing space in `BLUESKY_APP_PASSWORD`
caused two separate debugging detours.

## 5. Pin the database connection — do not navigate to it

The wrong-project mistake has now happened twice across two eras. The fix
isn't care, it's making the wrong project unreachable: a Supabase MCP
server, or a wrapper script that reads the pinned ref and refuses to run
against anything else. Dashboard SQL editors have a project dropdown and
that dropdown is the hazard.

## 6. Budget for the "verified live" step explicitly

Phases 24 and 25 are literally "applied live" and then "*actually*
verified live." Deploying is not verifying. Every phase touching
production data should end with a read-back query proving the intended
state exists — and that query should be written *before* the mutation.

## 7. Docs need an index and an archive policy

`CHANGES.md` is ~2,800 lines. It's genuinely valuable — the incident
history in it is what made this retrospective possible — but no session
reads it whole. The "read these first, in this order" table in
`CLAUDE.md` is what actually works. Next project: keep that table from
day one, and archive `CHANGES.md` per phase-range once it passes ~1,000
lines.

---

# Part 4 — recommendations for the skill set

Written for a Claude Code session tuning its own workflow. Ordered by
expected value.

## A. New skill: `db-read-safety` (highest value)

Encode Part 3 §1 as a loadable checklist that triggers whenever a session
writes a Supabase/PostgREST query. It should be *automatic on trigger*,
like `security-baseline` is from `feature-planner` — not something a
session has to remember to invoke. Five rules, five prevented incidents.
Nothing else in this list has that hit rate.

## B. New skill: `verification-spike`

Formalise what already happened informally four times: before building
against an external API, write the smallest possible script that proves
the specific behaviour the design depends on, run it live, and record the
result in `PROJECT_FACTS.md`. Every spike in this project changed the
plan. Make it a required step in `feature-planner` whenever a feature
depends on an external source's behaviour, and have it write its findings
rather than leaving them in the transcript.

## C. `feature-planner` amendments

1. **Make the `reviewer` pass mandatory, not optional.** It's currently
   described as part of "the normal path" and is easy to skip. It went
   2-for-2 on finding real bugs the gates missed. It should be a step with
   a checkbox, not a suggestion.
2. **Add a blast-radius question for correctness-critical work:** *"If
   this silently returns the wrong value, how would we find out?"* If the
   honest answer is "we wouldn't," that names the test to write. Every
   incident in the Part 2 table would have been caught by taking that
   question seriously.
3. **Add a data-job scope step.** When a feature writes to existing rows
   in bulk, require: what's in scope, what's explicitly out, and what the
   dry-run prints. The scope fork was asked in I4; what was missing was
   any way to *see* the answer was wrong before the write.
4. **Require the assertion to be specific.** A test asserting
   `.not.toBe(X)` on a three-valued output is not a test. Where output is
   an enum, assert the exact value and assert reachability of all values.

## D. New skill: `migration-runner`

Wrap every migration application: read the pinned project ref from
`supabase/.temp/project-ref`, print it, compare it against the expected
value recorded in `CLAUDE.md`, and refuse to proceed on mismatch. Then
apply, then verify the object exists with a read-back query, then
reconcile the migration tracking table. This project needed all four steps
and did them manually every time — including one run against the wrong
project.

## E. `harness-setup` amendments

1. **Scaffold a `job_runs`-style table for any project with scheduled
   jobs.** One row per execution with status and a summary blob. This
   project's version is the only reason silent job failures are visible at
   all, and it was added late (Phase 27) rather than with the first cron.
2. **Scaffold the docs index table** (`read these first, in this order`)
   into `CLAUDE.md` at setup, not organically.
3. **Add an env-var contract table** to the generated `ARCHITECTURE.md`
   skeleton — variable × execution context.

## F. Design the workflow around the tool-permission boundary

A meaningful fraction of this session was: attempt a DB-mutating command →
blocked by the auto-mode classifier → hand a copy-pasteable command to the
human → wait → parse their screenshot. That loop is *fine* — the boundary
is correct — but it should be **designed for** rather than discovered each
time:

- Every mutating operation ships as a documented `npm run` script with a
  `--dry-run` default, so handing it over is one line and the human can't
  fat-finger the scope.
- The session should hand over the command *and* the exact expected
  output, so the human's paste-back can be verified rather than eyeballed.
- Read-only verification should use a path that isn't blocked
  (`supabase db query --linked` worked throughout) so the session can
  confirm the human's action landed without another round trip.

## G. Keep, unchanged

- **Surface forks as questions.** Still the highest-quality mechanism in
  the project. `AskUserQuestion` with honest tradeoffs and a stated
  recommendation, then stop.
- **The correctness-critical / judgment test split.** Do not dilute it
  into "test everything."
- **Pure logic separated from I/O as file layout.** It's what made every
  later extraction and every test possible.
- **`PROJECT_FACTS.md` as an append-only anti-relitigation log.** Write to
  it whenever a decision would be expensive to rediscover.

---

## Summary if short on time

v1's lesson was *test the database, and stand up CI on day one*. Both were
adopted and both held.

**v2's lesson is different: the expensive bugs are the silent ones.** Code
that runs clean, returns a plausible number, and is wrong — a truncated
query, a string that should have been a number, a heuristic branch that
can never fire. Gates cannot see any of it.

If only two things change next project: **encode the silent-failure
checklist as an auto-triggering skill**, and **make the fresh-eyes review
pass mandatory instead of optional**. Those two would have caught most of
Part 2.
