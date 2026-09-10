-- Phase J7: Sherdog becomes a third result source in the settlement
-- machinery -- the piece J1-J6 deliberately left out (the sidecar stayed
-- read-only). Mirrors the per-source columns 0021/0022 added for
-- Wikipedia and API-Sports.
--
-- WHY THIS MATTERS more than the original "2-of-3 majority" framing:
-- checked live 2026-09-10, every one of ~860 settled fights carries a
-- SINGLE-source settled_from (wikipedia_only_24h 821, api_sports_only_24h
-- 28, wikipedia_draw_or_nc 11). `both_agree` and `disputed_result` have
-- fired ZERO times -- API-Sports free (2022+ only, 100/day) almost never
-- reports the same bout Wikipedia does. So Wikipedia is effectively the
-- lone settlement source today and the 24h single-source wait is pure
-- delay. Sherdog is the second source that actually shows up: a
-- Wikipedia+Sherdog agreement settles immediately (both_agree), and a
-- Sherdog disagreement turns a silent wrong Wikipedia result into a
-- reviewable disputed_result.
--
-- fetchFightHistory (API-Sports) has no "no winner" signal, but Sherdog
-- DOES record draw / nc explicitly (fighter_sherdog_bouts.result), so
-- unlike API-Sports it can corroborate a Wikipedia draw/NC.
--
-- Idempotent: every statement is `if [not] exists`, so a partial or
-- repeated apply is safe.

alter table fights
  add column if not exists sherdog_winner_id uuid references fighters (id),
  add column if not exists sherdog_method text,
  add column if not exists sherdog_round smallint,
  -- Same "set once, never refreshed" clock as wikipedia_reported_at /
  -- api_sports_reported_at while a clean match holds -- the single-source
  -- timeout measures against it. applySherdogResults.ts writes the
  -- sherdog_* columns together and retracts them all if the match later
  -- stops being clean.
  add column if not exists sherdog_reported_at timestamptz,
  -- True when BOTH fighters' Sherdog pages listed this bout and agreed on
  -- the winner (matchSherdogFightResult.ts). A one-sided (non-bilateral)
  -- Sherdog vote is CORROBORATION ONLY: it can confirm an agreement
  -- ("both_agree") but never settle a fight alone ("sherdog_only_12h")
  -- and never cast the deciding vote in a disagreement ("majority_2_of_3").
  add column if not exists sherdog_bilateral boolean not null default false;

-- NOTE: 0021 pairs wikipedia_method/round with wikipedia_reported_at via
-- a CHECK. The Sherdog analogue is deliberately NOT added: a Sherdog
-- draw / NC has sherdog_winner_id null by design, and Sherdog's own
-- history rows frequently carry a null method AND round on older cards
-- (parseFightHistory returns null when the cell doesn't parse), so a
-- legitimate bilateral draw can be {winner null, method null, round null,
-- reported_at set} -- which such a CHECK would reject, wedging
-- applySherdogResults for every fight after it.

-- Widen settled_from for the two new outcomes:
--   majority_2_of_3       -- two of the three sources agree, the third dissents
--   sherdog_only_12h      -- wiki + api both silent, Sherdog reported >=12h ago AND bilateral
-- The existing CHECK was added inline+unnamed in 0021, which Postgres
-- auto-named `fights_settled_from_check` (confirmed live 2026-09-10).
alter table fights drop constraint if exists fights_settled_from_check;
alter table fights
  add constraint fights_settled_from_check
  check (
    settled_from in (
      'both_agree',
      'wikipedia_only_24h',
      'api_sports_only_24h',
      'wikipedia_draw_or_nc',
      'majority_2_of_3',
      'sherdog_only_12h'
    )
  );
