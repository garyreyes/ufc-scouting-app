import type { FightOutcome } from "./types";

// A settled fight's winner_id is authoritative (lib/settlement/) -- null
// means the settle job resolved it to a draw/No Contest, never "unknown"
// (this only ever runs against a fight that already has settled_at set).
export function fightOutcomeFromSettledFight(winnerId: string | null): FightOutcome {
  return winnerId === null ? { kind: "void" } : { kind: "decided", winnerId };
}
