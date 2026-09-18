-- One-off data correction, not a schema change. Follow-up to 0053
-- (which cancelled the single orphaned fight poisoning /conflicts) and
-- CHANGES.md Phase 92 (which added the dismiss action these rows use).
--
-- All 24 open low_confidence_odds_match rows below were re-ranked live
-- against the current unpriced-fights pool (same rankFightMatches logic
-- features/conflicts/api.ts uses) and confirmed to have ZERO live
-- candidates as of 2026-09-19. Two distinct reasons, not one:
--   - some are genuinely regional/other-promotion bouts the odds
--     provider bundles in alongside UFC events, with no corresponding
--     row in our fighters/fights tables at all;
--   - most are actually real UFC roster fighters who WERE on this exact
--     card (Fiorot vs Grasso, Moreno vs Morales, Cortes-Acosta vs
--     Blaydes, etc.) -- their odds-provider names just had diacritics
--     stripped or fighter order flipped (e.g. "Zhu Rong" vs "Rong
--     Zhu"), which kept the auto-match score under AUTO_MATCH_THRESHOLD
--     (0.85), and by the time anyone would have manually confirmed them
--     every one of those fights had already settled and dropped out of
--     the unpriced pool -- eligibleUnpricedFights.ts already treats a
--     settled fight as no longer needing an odds match by design, so
--     backfilling a price for one now would serve no purpose this app
--     actually uses.
--
-- Either way the correct resolution is the same: no fight to write a
-- price onto, so dismiss with no odds_snapshots write. Same shape
-- resolveLowConfidenceAction takes for a manual per-row dismiss
-- (resolved_at set, resolution 'no_match'), applied here in bulk since
-- doing this one owner-click at a time for 24 rows would be pure toil
-- with no judgment call actually being made per row -- the "zero live
-- candidates" check already IS the judgment call, made once, live,
-- immediately before writing this file.
--
-- Guarded by kind + resolved_at is null, so this is a no-op for any row
-- that's already been resolved through another path (the UI, or a
-- future odds match) by the time this runs.
update data_conflicts
set resolved_at = now(), resolution = 'no_match'
where kind = 'low_confidence_odds_match'
  and resolved_at is null
  and id = any(array[
    'e895e222-291c-4194-afc2-facf23d7234a',
    '5c97e5cb-9e5f-4387-9756-bc3cfed4edd7',
    '047d71c5-4b31-4a29-9f6c-e84e61b1fe36',
    'c848d8ac-4e55-4087-bed7-04266d24b5af',
    '5bc1c0fc-98a3-4989-9e22-ed0055cf21e9',
    'ae2f8a33-4c47-4fe0-bdf8-025434ad9b28',
    '06e68c2f-53fd-4bac-93a6-5c3a44195c72',
    'ac20a6a3-5f8b-4094-b326-a7c99020d2c7',
    'c27eab69-70f2-4a88-943a-b5d032b80d8d',
    '7e8e603f-a094-4c7c-96ca-beabb030b968',
    '8b83f976-63c4-44ac-887a-70d946f29301',
    '113fea05-6c87-4e50-b92b-a2330daf4d9d',
    'f8f86fe9-87f6-496b-b631-ebe0b0b7c2a8',
    'cfc1dd33-67e9-4993-a95c-5b4b5306e56f',
    '7995b03d-d589-41e4-aae0-b331ee3fc505',
    'b6588c04-fe8b-418f-9fb9-52e085d714c3',
    '5e2c6858-056c-4458-856d-e7f7b3d66194',
    '70cf35d2-fd15-464e-897a-f6ecc5795a58',
    '5865ed05-e93b-4a10-b34f-19fa9b1efa70',
    '0a50438d-9fc4-44c1-ba50-b319a89b82dc',
    'e72cb4bc-2723-4fc8-88d3-7fd98c1ff1ab',
    '46a35f8c-f23f-4e2b-a048-d6a8c27db929',
    'acb85889-56c2-4d67-8295-0157ba04aa9f',
    '63049f73-4cac-426f-a8a6-e60a7281da6a'
  ]::uuid[]);
