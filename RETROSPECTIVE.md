# Retrospective — what I'd change next time

This is a honest look back at how this project actually went, written for
whoever (probably future-me) plans the next one. The app works and
everything in HANDOFF.md is done, but a few things were more painful than
they needed to be, and there's a real gap between "it works" and "it's
built the way a team of engineers would build it." This file is about
closing that gap.

## What actually caused the most pain

**RLS bugs were invisible until tested live, and testing them live was
slow.** Phases 10 and 11 — the clan chicken-and-egg bug and the scouting
report recursion bug — were both real bugs in the permission logic that
`npm run build` and TypeScript couldn't catch, because they live in the
database, not the app code. Every single one required: change SQL in the
Supabase dashboard, reload the app, click through the UI, watch it fail,
guess again. One of them (Phase 10) additionally burned real time on a
wrong theory (JWT signing keys) before the actual bug was found. The fix
that worked — `set local role authenticated; set local
"request.jwt.claims" = '...'` directly in the SQL editor — should have
been the *first* move, not something discovered after a detour.

**The deploy pipeline had no safety net before it existed.** The
package-lock.json/npm-ci mismatch that broke the GitHub Actions sync
workflow was invisible locally (Windows `npm install` tolerated it
silently) and only surfaced when the workflow actually ran on Linux. There
was no CI running `npm ci` + `npm run build` on every push, so this kind
of platform-specific drift had no chance to get caught early — it was
caught by a scheduled job failing in production instead.

**Two nearly-identical schemas got built instead of one flexible one.**
Individual fighter-level scouting reports (Phase 11) were added by copying
the matchup-report schema/RLS pattern almost exactly —
`fighter_scouting_reports` + `fighter_report_clan_shares` mirroring
`scouting_reports` + `report_clan_shares`, including a near-duplicate
security-definer helper function. It works, but it's double the schema
surface, double the RLS policies to audit, and double the places a future
bug like the Phase 11 recursion issue can hide. A single `scouting_reports`
table with a nullable `fighter_id` *or* `fight_id` (with a check constraint
ensuring exactly one is set) would have been one schema, one set of
policies, one helper function — and this wasn't caught because there was
no design pass before implementing, just "copy the pattern that already
works."

**Deployment target was decided very late.** Vercel wasn't picked until
after auth, clans, and scouting reports were already built and verified.
That's not wrong exactly — nothing had to be rebuilt for it — but it meant
things like "which env vars actually need to reach which execution
context" (local / GitHub Actions / Vercel) got figured out reactively at
the end instead of being a known constraint from the start.

## What to change next project

### 1. Set up CI before writing feature code, not after
A GitHub Actions workflow that runs `npm ci`, `npm run build`, and
`npm run lint` on every push — even solo, even before there's a team to
review PRs — would have caught the lockfile drift the moment it happened,
not weeks later when a scheduled job failed. This is cheap to set up and
should be one of the first things scaffolded, alongside the Next.js app
itself.

### 2. Treat RLS policies as testable, not just reviewable
Writing a small suite of SQL test cases up front — using `set local role`
+ `set local "request.jwt.claims"` to simulate different users, checked
against expected row visibility — would have caught both the Phase 10 and
Phase 11 bugs before they ever reached the live app. This doesn't need a
heavyweight framework (though pgTAP exists for this); even a plain `.sql`
script with a handful of asserted scenarios per table, run manually before
each migration ships, beats discovering the bug by clicking around the UI.
**This is the single highest-leverage change** — RLS bugs were the biggest
time sink of the whole project and the only class of bug invisible to
normal build/lint tooling.

### 3. Do a lightweight design pass before copying a working pattern
When a new feature looks structurally identical to one that already
exists (per-fighter reports vs. per-fight reports), that's the moment to
ask "should this actually be the same table with a discriminator column?"
— not after. The `app-architect` skill exists for exactly this kind of
call and should be re-invoked for any feature that adds a new table, not
just at the very start of the project.

### 4. Decide deployment target and secrets layout early
A short "where does this run, and what does each execution context need"
note (local dev / CI / production host) belongs in ARCHITECTURE.md from
the start, even if the actual deploy happens much later. It would have
made explicit, from day one, that the service-role key and the API-Sports
key are sync-job-only and should never reach the deployed app — instead of
that being verified reactively via a grep right before deploying.

### 5. Use a Supabase MCP server for future database-heavy projects
Most of the RLS debugging cost was context-switching overhead: dashboard
tab → SQL editor → paste query → read result → switch back. A Supabase MCP
server (queries and migrations run directly from the coding session) would
cut that loop dramatically, and would have prevented the "wrong Supabase
project" mistake entirely, since the connection would be pinned once
instead of navigated to by hand each time across multiple dashboard tabs/
projects on the same account.

### 6. Keep pushing on the "surface forks as questions" habit — it worked
The one thing that *did* work well and is worth explicitly continuing: the
CLAUDE.md instruction to surface real technical decisions (data source,
hosting platform, sync scheduling mechanism) as questions rather than
picking silently. Every one of those conversations (API-Sports vs.
alternatives, Vercel Cron vs. GitHub Actions, sync frequency matched to
actual pick-making schedule) produced a better decision than a silent
default would have, specifically because the *reasoning* got made
explicit rather than just the outcome. Keep doing this on the next
project, and extend it earlier — to schema design, not just infra choices.

## Summary if short on time

If only doing one thing differently next time: **write a handful of RLS
test cases before building the feature that needs them**, and **stand up
CI on day one**. Everything else in this file is a refinement; those two
would have prevented most of the actual lost time in this project.
