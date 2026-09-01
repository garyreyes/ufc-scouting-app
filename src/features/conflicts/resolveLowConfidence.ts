import { parseFighterPrices } from "@/lib/odds/parseOutcomes";
import type { LowConfidenceConflict } from "./types";

export type LowConfidenceResolution =
  | {
      kind: "resolved";
      snapshotInsert: {
        fight_id: string;
        fighter1_price: number;
        fighter2_price: number;
        odds_event_id: string;
        raw_response: unknown;
      };
      conflictUpdate: { resolved_at: string; resolution: string };
    }
  | { kind: "no_price" };

/**
 * What to write when the owner confirms a low-confidence odds event
 * belongs to a specific fight -- pure, matching the same convention as
 * resolveDisputedOpponent.ts. Takes `chosenFightId` and the chosen
 * fighters' names as arguments rather than reading
 * conflict.details.candidateFightId: the whole point of B6's picker
 * (rankFightMatches) is letting the owner override the algorithm's own
 * guess, so this must never fall back to trusting that guess itself.
 *
 * Reuses parseFighterPrices exactly as matchAndSnapshot.ts's automatic
 * path does, so a manual resolution produces the identical shape an
 * automatic match would have -- "no_price" is the same refuse-to-guess
 * outcome as the automatic path's skippedNoPrice case, not a new one.
 */
export function buildLowConfidenceResolution(
  conflict: LowConfidenceConflict,
  chosenFightId: string,
  chosenFighter1Name: string,
  chosenFighter2Name: string,
  now: Date = new Date(),
): LowConfidenceResolution {
  const { oddsEvent } = conflict.details;
  const prices = parseFighterPrices(oddsEvent, chosenFighter1Name, chosenFighter2Name);
  if (!prices) return { kind: "no_price" };

  return {
    kind: "resolved",
    snapshotInsert: {
      fight_id: chosenFightId,
      fighter1_price: prices.fighter1Price,
      fighter2_price: prices.fighter2Price,
      odds_event_id: oddsEvent.id,
      raw_response: oddsEvent,
    },
    conflictUpdate: {
      resolved_at: now.toISOString(),
      resolution: `matched_to_fight:${chosenFightId}`,
    },
  };
}
