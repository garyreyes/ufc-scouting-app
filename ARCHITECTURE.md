# UFC Fighter Catalog + Scouting Reports — Architecture

## What this app does
A catalog of UFC fighters (stats: height, reach, record, fight history) where
users can write their own "scouting report" notes on specific fights, so they
can later recall *why* a fighter won or lost (e.g. "won on IQ, not brawling").
Shared with friends via clan-scoped groups.

## Entities & relationships
- **Fighter** — height, reach, weight class, record, stance, etc.
- **Event** — a UFC card (e.g. UFC 329), has a date
- **Fight** — belongs to an Event, links two Fighters, has a result
- **User** — an authenticated person
- **Clan** — a friend group; has many ClanMembers
- **ClanMember** — join of (Clan, User)
- **ScoutingReport** — belongs to (Fight, User); free-text note + `visibility`
- **ReportClanShare** — join of (ScoutingReport, Clan), only used when
  `visibility = SPECIFIC_CLANS`

```
Fighter 1---* Fight
Event   1---* Fight
Clan    1---* ClanMember *---1 User
Fight   1---* ScoutingReport *---1 User
ScoutingReport 1---* ReportClanShare *---1 Clan   (only if SPECIFIC_CLANS)
```

## Data source strategy
Fighter/fight data is pulled from an external source, not entered manually.
The UI and API layer **never call the external source live**. A separate
sync layer fetches and writes into the app's own database on a schedule
(daily/weekly — fighter stats don't change fast enough to need real-time).
This keeps the app up even if the external source is down or changes.

```
lib/ufc-data-sync/
  fetchFighter.ts
  fetchFightHistory.ts
  syncJob.ts
```

## Scouting report visibility model
Each report has one of three visibility levels, chosen by its author:
- `PRIVATE` — only the author can see it
- `SPECIFIC_CLANS` — visible only to members of the clan(s) explicitly
  attached via `ReportClanShare`
- `ALL_MY_CLANS` — visible to anyone sharing any clan with the author

No fully-public tier — deliberately excluded to preserve anonymity outside
one's own clans.

Enforced via **Supabase Row Level Security (RLS) policies** at the database
level, not scattered permission checks in application code. This keeps the
access rule in one place and makes it auditable.

## Auth
**Supabase Auth**, Google + GitHub OAuth only (no email/password).
Chosen because Supabase bundles Postgres + Auth + RLS together, so the
visibility rules above are enforced as database policies rather than
duplicated across API endpoints.

## Security baseline (non-negotiable, verify before shipping any table)
- [ ] RLS is enabled on every table
- [ ] Default posture is deny-all; explicit allow-policies match the
      intended access rules above
- [ ] Only the Supabase anon/public key is used in frontend code — the
      service-role key never appears client-side or in git
- [ ] No endpoint trusts a client-supplied user ID — identity comes from
      the authenticated session only
- [ ] Secrets live in environment variables, never committed to git

## Folder structure (feature-based)
```
src/
  features/
    fighters/        components/, api.ts, types.ts
    fights/           components/, api.ts, types.ts
    scouting-reports/ components/, api.ts, types.ts
    clans/             components/, api.ts, types.ts
    auth/              components/, api.ts
  shared/              components/, utils/
  lib/
    db.ts
    ufc-data-sync/
    auth-config.ts
  app/                 routing/pages
```

Rule of thumb: if a feature's code needs something from another feature,
that's a signal it either belongs in `shared/`, or the feature boundary is
drawn wrong — revisit before adding to it.

## External data source

**API-Sports MMA API** (api-sports.io), chosen over scraping UFCStats.com
(deeper stats, but fragile and unlicensed for reuse) and Wikidata (too thin
on fight-level stats). Free tier: 100 requests/day, resets 00:00 UTC, same
endpoints as paid. A daily/weekly batch sync should stay well under that if
done via paginated event/fight pulls rather than one request per fighter.
Verified against the live API: `/fighters` returns name/height/weight/
reach/stance; `/fights` returns date, weight class, both fighters, and a
`slug` naming the event card (e.g. `"UFC Fight Night: Gamrot vs
Salkilld"`) — there's no dedicated promotion/org filter param, so the sync
job scopes to UFC by matching `slug` against `"UFC"`. Depth of
granular per-fight stats (strikes landed, takedown %) not yet confirmed.

## Open questions (not yet decided)
- Sync frequency for external fighter data (proposed: daily)
