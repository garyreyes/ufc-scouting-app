# UFC Scouting App

**Live app:** https://ufc-scouting-app-2jtj.vercel.app/

## Why this exists

I'm a huge MMA/UFC fan, and my friends and I already make picks together —
mostly on apps like Verdict, and occasionally with real money on the line.
What's always been missing is a shared place to actually *reason through*
a card together beforehand: not just "who do you got," but *why* — a
fighter's wrestling is overrated, someone's chin has been getting cracked
the last two fights, a style matchup nobody else is talking about.

That's what this app is. A UFC fighter/event catalog backed by real data,
with a "scouting report" note system layered on top — private by default,
shareable with your friend group ("clan") when you want a second opinion
or want to compare notes before locking in picks. The goal is to make our
group's picks sharper by making our reasoning visible to each other, not
just the picks themselves.

## What you can do with it

- **Browse fighters and events** — pulled from real UFC data (API-Sports +
  Wikipedia), synced automatically twice a day, no manual data entry
- **Sign in** with Google or GitHub — no passwords to manage
- **Create or join a "clan"** — your friend group. Create one and share the
  invite link, or use a link a friend sends you
- **Write scouting reports** two ways:
  - **Per-fighter notes** — e.g. "Islam Makhachev — elite wrestling,
    doesn't get taken down" — attached to the fighter, visible on their
    profile and on every fight they're in
  - **Matchup reports** — notes specific to one fight, once you've weighed
    both fighters against each other
- **Control who sees each note** you write, per report:
  - `PRIVATE` — only you
  - `SPECIFIC_CLANS` — only the clan(s) you pick
  - `ALL_MY_CLANS` — anyone in any clan you're in
  - (there's deliberately no fully-public option — this is for your group,
    not the internet)
- **Edit or delete** your own reports any time; nobody else can touch them

## Using it with your friends

1. Sign in at the link above
2. Go to **Clans → Create Clan**, give it a name
3. Open the clan, generate an invite link, send it to your friends
4. Once they've joined, write scouting reports on upcoming fights and set
   visibility to your clan — everyone in it sees each other's notes
5. Before the card, review the fighter and matchup notes together to sharpen
   your picks

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Copy
`.env.local.example` to `.env.local` and fill in your own Supabase project
values to run it locally.

Other scripts:
- `npm run build` / `npm run start` — production build/run
- `npm run lint` — lint
- `npm run sync` — manually run the fighter/event data sync (normally
  automatic, see below)

## How it's built

Next.js (App Router) + Supabase (Postgres + Auth + Row Level Security).
Fighter/event data comes from an external sync job (API-Sports +
Wikipedia), not entered by hand, and refreshes automatically twice daily
via a GitHub Actions cron workflow (`.github/workflows/sync.yml`). Hosted
on Vercel, auto-deploying on every push to `main`.

Full design, entity model, and the reasoning behind each major decision:
[ARCHITECTURE.md](ARCHITECTURE.md). Phase-by-phase build history and every
bug hit along the way: [CHANGES.md](CHANGES.md). Current status and what's
left: [HANDOFF.md](HANDOFF.md). Lessons learned and what I'd do
differently next time: [RETROSPECTIVE.md](RETROSPECTIVE.md).
