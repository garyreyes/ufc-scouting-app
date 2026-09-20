import type { ResolvedMethod } from "./normalizeFightMethod";

// Mirrors bet_legs.market (0064_bankroll_and_slips.sql).
export type LegMarket = "MONEYLINE" | "DOUBLE_CHANCE" | "METHOD_FIGHTER" | "METHOD_FIGHT" | "OTHER";

// Mirrors bet_legs.method_group. These four are the markets the owner's
// book actually prices, not an invented taxonomy -- see the migration.
export type MethodGroup = "DECISION" | "KO_TKO_DQ" | "SUBMISSION" | "ANY_FINISH";

export type LegSettlement = "won" | "lost" | "void" | "undetermined";

export interface LegForSettlement {
  market: LegMarket;
  selectionFighterId: string | null;
  methodGroup: MethodGroup | null;
}

export interface SettledFightFacts {
  winnerId: string | null;
  method: ResolvedMethod;
  // fights.settled_from = 'cancelled' (0044). Kept separate from method
  // because a cancelled bout has no method text to read at all.
  isCancelled: boolean;
}

function methodMatches(method: ResolvedMethod, group: MethodGroup): boolean {
  switch (group) {
    case "DECISION":
      return method === "DECISION";
    // The book's own label is "By KO, TKO Or DQ", so a DQ win pays here.
    case "KO_TKO_DQ":
      return method === "KO_TKO" || method === "DQ";
    case "SUBMISSION":
      return method === "SUBMISSION";
    // "KO, TKO, Painful Lock, Chokehold, DQ or Refusal" -- i.e. anything
    // that is not a decision.
    case "ANY_FINISH":
      return method === "KO_TKO" || method === "SUBMISSION" || method === "DQ";
  }
}

/**
 * Settles ONE leg against its fight's real outcome.
 *
 * Returns "undetermined" rather than guessing whenever the outcome
 * genuinely does not decide the leg -- an unsettled fight, a leg this
 * app has no fight row for (a real slip parlayed a US Open tennis set
 * with a UFC moneyline), or a method market on one of the 158 production
 * fights that settled with no method recorded. A caller must leave those
 * pending for manual settlement; treating "I don't know" as a loss is
 * how a journal quietly invents money.
 */
export function settleLeg(leg: LegForSettlement, fight: SettledFightFacts | null): LegSettlement {
  // No fight row, or a market this app cannot interpret. Checked before
  // anything else: without a usable selection there is nothing to decide
  // either way.
  if (fight === null || leg.market === "OTHER") return "undetermined";

  if (fight.isCancelled || fight.method === "NO_CONTEST") return "void";

  switch (leg.market) {
    case "MONEYLINE":
      if (fight.method === "DRAW") return "void";
      if (fight.winnerId === null) return "undetermined";
      return fight.winnerId === leg.selectionFighterId ? "won" : "lost";

    // 1X / 2X: the backed fighter wins OR the bout is drawn. A draw is
    // the market's whole reason to exist, so it pays rather than voids.
    case "DOUBLE_CHANCE":
      if (fight.method === "DRAW") return "won";
      if (fight.winnerId === null) return "undetermined";
      return fight.winnerId === leg.selectionFighterId ? "won" : "lost";

    case "METHOD_FIGHTER":
      // Nobody won by any method, so there is no method bet to settle.
      if (fight.method === "DRAW") return "void";
      if (leg.methodGroup === null || fight.winnerId === null) return "undetermined";
      // Checked BEFORE the unknown-method guard on purpose: if the
      // backed fighter lost, the leg is dead whatever the method was --
      // which settles it even on a fight that recorded no method.
      if (fight.winnerId !== leg.selectionFighterId) return "lost";
      if (fight.method === "UNKNOWN") return "undetermined";
      return methodMatches(fight.method, leg.methodGroup) ? "won" : "lost";

    // "How The Bout Will Be Won" -- names no fighter, so only the method
    // matters.
    case "METHOD_FIGHT":
      if (fight.method === "DRAW") return "void";
      if (leg.methodGroup === null || fight.method === "UNKNOWN") return "undetermined";
      return methodMatches(fight.method, leg.methodGroup) ? "won" : "lost";
  }

  return "undetermined";
}
