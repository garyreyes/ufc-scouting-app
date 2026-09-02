-- F4 (UC-5): "After the fight, mark whether a flag turned out to be
-- real." This is what makes the PRD's rumour precision metric
-- measurable at all -- without it, "was the rumour engine signal or
-- noise" stays a vibe, never a number.
--
-- null outcome means "not yet marked" -- the same null-means-pending
-- pattern data_conflicts.resolved_at already established in this schema,
-- not a new convention.
--
-- No new RLS policy or grant needed: rumour_flags already has zero
-- client write grant (0024_rumour_flags_and_sources.sql), so the mark
-- action goes through the service-role admin client the same way
-- resolveDisputedOpponentAction/resolveLowConfidenceAction already do for
-- data_conflicts -- the owner check in that server action IS the real
-- security boundary here, not a policy on this column.
--
-- Enforcement that a flag can only be marked once its OWN fight has
-- settled lives in the server action (re-checks fights.settled_at
-- directly), not a cross-table trigger here -- this is a data-quality
-- guard on a secondary analytics field, not a money or auth path, and
-- the write is already funnelled through exactly one action with no
-- other route to this column. Matches the proportionality of
-- resolveLowConfidenceAction's own in-action "no_price" check rather
-- than the heavier trigger machinery odds_snapshots/pick-lock use for
-- genuinely correctness-critical, money-adjacent guarantees.

alter table rumour_flags
  add column outcome text check (outcome in ('confirmed', 'refuted', 'unknown')),
  add column outcome_marked_at timestamptz;
