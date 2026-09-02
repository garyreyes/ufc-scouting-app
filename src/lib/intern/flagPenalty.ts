import type { InternFlag } from "./types";

// How far a fighter's own rumour flags shade their win probability down,
// in absolute probability points. These three constants ARE the intern's
// scouting opinion -- everything else about its pick is the market's --
// so they are deliberately small, capped, and all in one place.
//
// The reasoning behind each:
//   PENALTY_PER_SOURCE     one more independent post saying the same
//                          thing is more signal, so corroboration scales
//                          the penalty. This is the whole reason F2
//                          counts independent claims rather than raw post
//                          volume.
//   MAX_PENALTY_PER_FLAG   one concern, however loudly reported, can't
//                          run away with the estimate. Reached at 3
//                          sources.
//   MAX_PENALTY_PER_FIGHTER a fighter buried in flags still can't be
//                          marked down more than this. Keeps the intern
//                          market-anchored rather than rumour-driven,
//                          which is what docs/PRD.md UC-3 actually asks
//                          for ("anchors on the market and deviates when
//                          its own scouting gives it a reason to").
//
// **These are the first dial G3's calibration check should turn.** If the
// intern turns out systematically over- or under-confident on flagged
// fighters, it is almost certainly these numbers, not the structure.
export const PENALTY_PER_SOURCE = 0.02;
export const MAX_PENALTY_PER_FLAG = 0.06;
export const MAX_PENALTY_PER_FIGHTER = 0.12;

/**
 * Total probability penalty for one fighter, given their own flags.
 * Category is deliberately NOT weighted yet: the honest position is that
 * nothing in this app has yet measured whether a weight-cut flag predicts
 * a loss more strongly than an injury flag does. F4's outcome marking is
 * what will eventually make that answerable -- until there's real data,
 * a uniform weight is a stated assumption rather than an invented one.
 */
export function flagPenalty(flags: InternFlag[]): number {
  const total = flags.reduce(
    (sum, flag) => sum + Math.min(MAX_PENALTY_PER_FLAG, PENALTY_PER_SOURCE * flag.corroborationCount),
    0,
  );
  return Math.min(MAX_PENALTY_PER_FIGHTER, total);
}
