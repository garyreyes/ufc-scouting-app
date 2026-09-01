// What settlement (Phase D) has already decided about a fight, by the
// time it hands a fight to these pure scoring functions. Deciding WHETHER
// a fight is ready to be scored at all -- source agreement, the 24h
// single-source timeout, disputed-opponent holds -- is Phase D's
// orchestration job (ARCHITECTURE.md Fork 6), not this pure-math layer's.
// A fight sources disagree on simply never reaches these functions yet;
// there is no third "disagreement" variant to model here.
export type FightOutcome =
  | { kind: "decided"; winnerId: string }
  // Cancelled, no contest, or a draw -- ARCHITECTURE.md item #8: "with no
  // winner, 'who wins' has no correct answer, so scoring the pick as
  // wrong would be a bug." docs/PRD.md: the stake is "voided and
  // returned, not counted as a loss."
  | { kind: "void" };
