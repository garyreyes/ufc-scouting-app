-- N5: decideInternPick already computes rumour/Elo/size/age deltas at its
-- rawDelta line -- this column stores them structured, alongside the
-- prose already written into reasoning, so a later pass (N8's shadow-pick
-- comparison) can query "how much did Elo move this pick" instead of only
-- reading a sentence. Pure additive refactor: the probability/confidence
-- decideInternPick returns is unchanged (gated by a characterization test
-- in decideInternPick.characterization.test.ts), this only exposes more
-- of what it already computed.
--
-- Nullable and USER picks never populate it -- signals is an artifact of
-- decideInternPick's own deterministic rule, which only the INTERN author
-- runs (0019_picks.sql's author check).
alter table picks
  add column signals jsonb;
