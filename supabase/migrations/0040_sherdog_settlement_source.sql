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

alter table fights
  add column sherdog_winner_id uuid references fighters (id),
  add column sherdog_method text,
  add column sherdog_round smallint,
  -- Same "set once, never refreshed" clock as wikipedia_reported_at /
  -- api_sports_reported_at -- the single-source timeout measures against
  -- it. applySherdogResults.ts writes all of these together.
  add column sherdog_reported_at timestamptz,
  -- True when BOTH fighters' Sherdog pages listed this bout and agreed on
  -- the winner (matchSherdogFightResult.ts). Required before Sherdog may
  -- settle a fight with no other source behind it ("sherdog_only_12h");
  -- a one-sided match still corroborates or breaks a tie.
  add column sherdog_bilateral boolean not null default false;

-- Same defensive pairing 0021 applied to wikipedia_method/round: a
-- sherdog_method or sherdog_round without a sherdog_reported_at would
-- mean the writer drifted out of sync.
alter table fights
  add constraint fights_sherdog_report_columns_together
  check (
    (sherdog_reported_at is null)
    or (sherdog_method is not null or sherdog_round is not null or sherdog_winner_id is not null)
  );

-- Widen settled_from for the two new outcomes:
--   both_agree            -- unchanged name, now also fires for wiki+sherdog / api+sherdog / all three
--   majority_2_of_3       -- exactly two of the three sources agree, the third dissents
--   sherdog_only_12h      -- wiki + api both silent, Sherdog reported >=12h ago AND both
--                            fighters' Sherdog pages corroborate each other (bilateral)
alter table fights drop constraint fights_settled_from_check;
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
