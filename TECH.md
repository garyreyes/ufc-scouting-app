# TECH.md — how this actually works under the hood

This is a plain-English tour of the tech stack and, more importantly, how
each piece solves a specific real problem the project ran into. Where a
solution isn't obvious, there's a short code excerpt. For the full schema
and design reasoning, see [ARCHITECTURE.md](ARCHITECTURE.md); this file is
about *how the code does what it does*, not the original design decisions.

## The stack, in one paragraph

**Next.js** (React framework) renders the pages and handles routing.
**Supabase** is Postgres (the actual database) plus Auth (login) plus Row
Level Security (who's allowed to see/edit which rows) bundled together.
The app never talks to the outside UFC data sources live — a separate
**sync job** fetches fighter/event/fight data on a schedule and writes it
into Supabase, so the app itself only ever reads from its own database.

## Problem 1: where does fighter/event/fight data actually come from?

Two outside sources, because neither one alone is enough:

- **API-Sports** (`v1.mma.api-sports.io`) — a paid-tier MMA data API,
  used on the free plan. Has real fighter bios (height, reach, stance,
  record) and confirmed fight results. Its big limitation: the free plan
  can only see a rolling window of about 3 days in the past to 1 day in
  the future — it's structurally incapable of showing next month's card.
- **Wikipedia** — every upcoming UFC event gets a Wikipedia page days-to-
  weeks in advance, listing the full fight card. No API key needed. Its
  limitation: only names and fight results, no fighter bio stats (height,
  reach, etc).

So: **API-Sports covers "who fought and what happened," Wikipedia covers
"what's coming up."** Two separate scripts run these:

```text
src/lib/ufc-data-sync/syncJob.ts       -- pulls from API-Sports
src/lib/ufc-data-sync/syncSchedule.ts  -- pulls from Wikipedia
```

Both get run automatically twice a day by a GitHub Actions cron job
(`.github/workflows/sync.yml`) — see [ARCHITECTURE.md](ARCHITECTURE.md)
for why GitHub Actions instead of Vercel.

## Problem 2: API-Sports only allows 10 requests/minute

This isn't documented anywhere — it was found by hitting the limit during
development. Every API-Sports call goes through one shared function
(`src/lib/ufc-data-sync/client.ts`) that forces a 6.5-second gap between
requests, no matter which part of the code is asking:

```ts
const MIN_INTERVAL_MS = 6500;
let queue: Promise<void> = Promise.resolve();
function throttle(): Promise<void> {
  const next = queue.then(() => new Promise((resolve) => setTimeout(resolve, MIN_INTERVAL_MS)));
  queue = next;
  return next;
}
```

This is why a sync run takes a while (minutes, not seconds) if a lot of
fighters need fetching — it's deliberately slow to avoid getting
rate-limited mid-run.

## Problem 3: reading Wikipedia's fight card format

Wikipedia doesn't have an API for "give me the fight card as structured
data" — the schedule lives inside the page's raw wikitext as a template,
like:

```text
{{MMAevent bout|Lightweight|Islam Makhachev|def.|Ian Machado Garry|...}}
```

`fetchSchedule.ts` fetches that raw wikitext via Wikipedia's MediaWiki API,
finds every `{{MMAevent bout ...}}` block with a regex, and splits each one
by its `|` pipes into weight class / fighter1 / result-or-vs / fighter2 /
method / round. A finished bout is detected by that middle field literally
being the string `"def."`; the winner is always the fighter listed first
(that's the Wikipedia template's own convention — winner always goes
before "def.").

## Problem 4: the same fighter/event/fight shows up from both sources — how are they merged?

This is the "upsert" logic (`upsertFighter.ts`, `upsertEvent.ts`,
`upsertFight.ts`) — each one runs an "update if it already exists,
otherwise insert" against the database, and the hard part is *deciding
what counts as "already exists"* when the two sources don't share a common
ID.

- **Fighters**: match by API-Sports' numeric ID first. If that's not
  present (i.e. this fighter only exists as a Wikipedia name so far),
  fall back to matching by exact name.
- **Events**: match by ID first, otherwise same date + a name match that
  ignores punctuation/capitalization (so `"UFC 329"` and `"UFC 329:"`
  count as the same event).
- **Fights**: match by ID first, otherwise same event + the same two
  fighters *in either order* (API-Sports and Wikipedia don't always agree
  on which fighter is "fighter 1").

Whichever source runs second fills in the gaps rather than overwriting —
`stripNullish.ts` strips out any field that's `null`/`undefined` before an
update, so a sparse Wikipedia record (no height/reach) can never wipe out
better data API-Sports already wrote:

```ts
export function stripNullish<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== null && value !== undefined),
  ) as Partial<T>;
}
```

## Problem 5: most fighters have no weight class on their own row — why does filtering still work?

Real gap in the data: a fighter first created from a Wikipedia schedule
scrape only gets a `name` — nothing else, since Wikipedia's schedule page
doesn't list a fighter's personal stats, only what fight they're in. At
one point roughly 128 of ~144 fighters in the database had a `null`
`weight_class` on the `fighters` table itself.

The fix lives in `getFighters()` (`src/features/fighters/api.ts`): after
loading fighters, a helper called `fillMissingWeightClasses()` finds every
fighter still missing a weight class, looks up their *most recent fight*,
and borrows that fight's weight class as a stand-in — a fight always has
its own `weight_class`, independent of whether the fighters do. Crucially,
the weight-class filter checkboxes on the fighters grid filter against
this *resolved* value, not the raw (mostly-empty) database column —
filtering on the raw column was an earlier bug that made the filter show
almost nothing.

## Problem 6: four different ways the code talks to Supabase — why not just one?

Each one exists to solve a different access problem:

| Client | File | Used for | Knows who's logged in? |
|---|---|---|---|
| Public anon client | `src/lib/db.ts` | Fighters/events/fights (public data) | No |
| Browser session client | `src/lib/supabase/client.ts` | Client-side auth actions | Yes (via cookies) |
| Server session client | `src/lib/supabase/server.ts` | Clans, scouting reports — anything that needs "who is this user" for permission checks | Yes (via cookies) |
| Admin client | `src/lib/ufc-data-sync/supabaseAdmin.ts` | Sync job only | N/A — bypasses all permission checks entirely |

The admin client uses the **service-role key**, which skips Row Level
Security completely. It's used exactly once in the whole codebase, inside
the sync job, and is never allowed to reach the browser — see
`.env.local.example`'s comment on it, and the security checklist in
CLAUDE.md/ARCHITECTURE.md that gets checked before shipping any
Supabase-backed feature.

The session-aware clients (browser + server) both read the same login
cookie, which is why `src/proxy.ts` exists — Next.js renamed
`middleware.ts` to `proxy.ts` in this version. Its whole job is to refresh
that login cookie on every request, because a plain Server Component is
not allowed to write cookies during rendering (only a proxy/middleware
layer can) — without it, logins would silently expire instead of
refreshing.

## Problem 7: how permissions actually work (not app code — the database itself)

Fighters/events/fights are public-read tables — anyone, even logged out,
can see them, enforced by a Row Level Security policy on the table itself
(`using (true)` for `select`, no insert/update/delete policy at all for
normal users — only the service-role sync job can write to them).

Clans and scouting reports are the opposite: private by default, with
specific allow-rules. E.g. a scouting report set to `SPECIFIC_CLANS` is
only visible to members of the clans it's explicitly shared with — that
rule is written as SQL directly on the `scouting_reports` table, not as an
`if` statement somewhere in the app. That matters: it means even a bug in
the app's own code can't accidentally leak a private report, because the
database itself refuses the query before the app ever sees the row.

## Problem 8: how the fighters search/filter page avoids extra round trips

`src/app/fighters/page.tsx` reads the search box text and selected weight
classes straight from the page's own URL (`?q=...&weightClass=...`)
instead of keeping that state in the browser's memory. That means:
picking a filter updates the URL, which triggers the page to re-fetch with
the new filters already applied server-side — no separate "loading"
spinner/client fetch, and the exact search is bookmarkable/shareable as a
link.
