import type { SlateArchetype, SlateSlip } from "./types";

// Phase T4: the pure half of writing a slate -- what the job compares,
// carries over and keys on. The I/O half is generateInternSlate.ts.

export function generationKey(eventId: string, archetype: SlateArchetype, index: number): string {
  return `intern:${eventId}:${archetype}:${index}`;
}

/**
 * What the Intern can stake on this card: its whole ledger (opening
 * deposit + every settled slip's net) minus money still riding on OTHER
 * cards' open slips. The ledger only records a slip's net at settlement,
 * so without the subtraction an unsettled earlier card would be spent twice.
 * PostgREST serialises numeric as a string -- coerced here, not trusted.
 */
export function availableBalance(ledgerAmounts: (number | string)[], otherOpenStakes: (number | string)[]): number {
  const ledger = ledgerAmounts.reduce<number>((sum, a) => sum + Number(a), 0);
  const riding = otherOpenStakes.reduce<number>((sum, s) => sum + Number(s), 0);
  return ledger - riding;
}

export interface EnteredPrice {
  fightId: string;
  market: string;
  selectionFighterId: string | null;
  methodGroup: string | null;
  price: number;
}

function legKey(l: { fightId: string; market: string; selectionFighterId: string | null; methodGroup: string | null }) {
  return `${l.fightId}|${l.market}|${l.selectionFighterId ?? ""}|${l.methodGroup ?? ""}`;
}

/**
 * An owner-entered book price survives a regeneration only while the leg
 * is still the SAME bet (same fight, market, fighter and method group) --
 * if the Intern's method call moves, the old price is for a bet it no
 * longer makes and must not carry over.
 */
export function applyEnteredPrices(slips: SlateSlip[], entered: EnteredPrice[]): SlateSlip[] {
  const byKey = new Map(entered.map((e) => [legKey(e), e.price]));
  return slips.map((s) => {
    const legs = s.legs.map((l) => {
      const price = byKey.get(legKey(l));
      return price === undefined ? l : { ...l, price, priceSource: "entered" as const };
    });
    const combined = legs.reduce((p, l) => p * l.price, 1);
    return { ...s, legs, combinedPrice: Math.round(combined * 1000) / 1000 };
  });
}

/** Canonical form of everything that would be written -- equal means skip the write. */
export function slateSignature(slips: SlateSlip[]): string {
  return JSON.stringify(
    slips
      .map((s) => ({
        k: `${s.archetype}:${s.index}`,
        stake: s.stakePhp,
        // Sorted: legs read back from the DB arrive in no guaranteed order.
        legs: s.legs.map((l) => `${legKey(l)}@${Number(l.price).toFixed(3)}`).sort(),
      }))
      .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)),
  );
}
