import { isPickLocked } from "@/lib/picks/pickLockOffsets";

// Phase T5: the one owner write on an INTERN slip. Method legs are priced
// by estimate (no method-odds feed exists); the owner may replace an
// estimate with the real book price -- but only while the slate is still
// live, only on legs that were estimated, and never with hindsight.

export interface LegOverrideContext {
  slipAuthor: "USER" | "INTERN";
  slipStatus: string;
  priceSource: string;
  legResult: string;
  startsAt: string | null;
  price: number;
  now: Date;
}

const MIN_PRICE = 1.01;
const MAX_PRICE = 1000; // bet_legs.price is numeric(6,3)

/** null = allowed; otherwise the reason it isn't, shown to the owner. */
export function checkLegOverride(c: LegOverrideContext): string | null {
  if (c.slipAuthor !== "INTERN") return "Only the Intern's slips take a price override here.";
  if (c.slipStatus !== "open" || c.legResult !== "pending") return "This slip has already settled.";
  if (c.priceSource !== "estimated" && c.priceSource !== "entered") {
    return "Only estimated legs can be re-priced -- this one uses the real ingested line.";
  }
  if (isPickLocked(c.startsAt, "INTERN", c.now)) return "The Intern's slate is locked for this card.";
  if (!Number.isFinite(c.price) || c.price < MIN_PRICE || c.price >= MAX_PRICE) {
    return `Enter a decimal price between ${MIN_PRICE} and ${MAX_PRICE}.`;
  }
  return null;
}
