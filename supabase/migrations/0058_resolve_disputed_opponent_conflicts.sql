-- One-off data correction, not a schema change. Resolves all 5 open
-- disputed_opponent conflicts flagged at /conflicts as of 2026-09-19,
-- each researched live against the real fight record (Wikipedia/Sherdog/
-- Tapology) before writing. Same effect as clicking each option in
-- DisputedOpponentCard.tsx (resolveDisputedOpponentAction /
-- buildDisputedOpponentResolution), applied here as a migration per the
-- "route production writes through a reviewed file" pattern established
-- by 0053/0054 rather than an ad-hoc script.
--
-- All five guarded by kind + resolved_at is null (or, for the merges, an
-- existence check on both fighter rows), so this is a no-op for anything
-- already resolved through the UI by the time this runs.

-- #1 UFC 298 (2024-02-17): Ikram Aliskerov withdrew pre-fight (staph
-- infection); Roman Kopylov actually stepped in and fought Anthony
-- Hernandez (lost by submission, round 2). The existing row is correct
-- -- the candidate (Aliskerov) never fought this card. Confirm existing.
update data_conflicts
set resolved_at = now(), resolution = 'confirmed_existing'
where id = '47ce2815-7ce7-48bb-9c8a-ba29dccb7bb1'
  and kind = 'disputed_opponent'
  and resolved_at is null;

-- #2 UFC Fight Night: Moicano vs. Saint Denis (2024-09-28, Paris):
-- Germaine de Randamie withdrew (broken finger + fractured foot);
-- Jacqueline Cavalcanti replaced her and actually fought Nora Cornolle
-- (won by split decision). Existing row is correct. Confirm existing.
update data_conflicts
set resolved_at = now(), resolution = 'confirmed_existing'
where id = 'db51f474-1b56-4d1b-9620-e90294192b54'
  and kind = 'disputed_opponent'
  and resolved_at is null;

-- #3 UFC 308 (2024-10-26): Kennedy Nzechukwu vs. Chris Barnett is the
-- fight that actually happened (Nzechukwu won by TKO, round 1) -- the
-- existing "vs. Marcos Rogerio de Lima" row was stale. Use the candidate
-- pairing; guarded on the exact current fighter ids so this is a no-op
-- if the row already changed since detection.
update fights
set fighter1_id = 'ec170258-842d-47f6-a603-35817d994c94', -- Chris Barnett
    fighter2_id = 'aeb456cd-bee0-47b9-a3f3-ab0a5ef809b7'  -- Kennedy Nzechukwu
where id = '5cb7fd95-815f-48ae-a7b0-511868c8a94b'
  and fighter1_id = 'aeb456cd-bee0-47b9-a3f3-ab0a5ef809b7'
  and fighter2_id = 'ebb1620d-6f51-4265-bdc7-b09c2def8cb3';

update data_conflicts
set resolved_at = now(), resolution = 'used_candidate'
where id = '5a21083d-ca7b-459f-a743-53d48360f536'
  and kind = 'disputed_opponent'
  and resolved_at is null;

-- #4 UFC 331 (2026-09-19): not a real opponent dispute -- two duplicate
-- rows for the same real "Casey O'Neill" (one carries sherdog_id 175007
-- with no external_id, the other external_id 903 with no sherdog_id).
-- Same keep/drop rule the "merge" choice uses (decideSameCardMerge.ts:
-- prefer the row with external_id; merge_fighters() copies the dropped
-- row's sherdog_id onto the keeper, so no identity data is lost).
do $$
begin
  if exists (select 1 from fighters where id = 'f0f8139e-fe1f-42ec-9198-cf382aafdf90')
     and exists (select 1 from fighters where id = 'c5a1d4f0-acec-447e-89de-c9396852fa9b') then
    perform merge_fighters('c5a1d4f0-acec-447e-89de-c9396852fa9b', 'f0f8139e-fe1f-42ec-9198-cf382aafdf90');
  end if;
end $$;

update data_conflicts
set resolved_at = now(), resolution = 'merged_fighters'
where id = '0788de6b-df0c-43f8-89b6-5a92f607ab1d'
  and kind = 'disputed_opponent'
  and resolved_at is null;

-- #5 UFC 331 (2026-09-19): same shape -- "Osman Diaz" (sherdog_id
-- 156965) and "Ozzy Diaz" (external_id 2734) are one real person
-- (Tapology/Sherdog/BetMGM all list him as "Ozzy Diaz" for this bout).
-- Keep the external_id row, merge the sherdog-linked row into it.
do $$
begin
  if exists (select 1 from fighters where id = '95309fb6-412f-4adb-85e8-e52e2ba2fcd1')
     and exists (select 1 from fighters where id = '804b64f7-6ff4-4901-a18f-e88952c441d8') then
    perform merge_fighters('804b64f7-6ff4-4901-a18f-e88952c441d8', '95309fb6-412f-4adb-85e8-e52e2ba2fcd1');
  end if;
end $$;

update data_conflicts
set resolved_at = now(), resolution = 'merged_fighters'
where id = '7c7b5efd-1631-4316-a722-e8ebaf71347e'
  and kind = 'disputed_opponent'
  and resolved_at is null;
