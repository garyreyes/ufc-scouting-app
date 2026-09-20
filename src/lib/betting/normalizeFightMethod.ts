// What a settled fight's method text actually means, for bet
// settlement. Distinct from lib/scoring/fightMethod.ts's FightMethod:
// that enum is what a pick PREDICTS (and includes FINISH, "ends early,
// unclear how", which is a statement about uncertainty and can never be
// an outcome). This is what a fight DID, and it has to carry DRAW, DQ
// and NO_CONTEST, none of which FightMethod models.
export type ResolvedMethod =
  | "DECISION"
  | "KO_TKO"
  | "SUBMISSION"
  | "DQ"
  | "DRAW"
  | "NO_CONTEST"
  // The method is absent or unrecognised. Never a guess -- on production
  // 158 settled fights carry method = null because they settled from
  // API-Sports, which does not report one at all.
  | "UNKNOWN";

/**
 * `fights.method` is free-text Wikipedia prose, not an enum -- real
 * production values include "TKO (punches)", "Decision (unanimous)
 * (29-28, 29-28, 29-28)", "Technical Submission (rear-naked choke)",
 * "Draw (majority) (29-27, 28-28, 28-28)" and "NC (accidental eye
 * poke)".
 *
 * Matches on the LEADING token only (everything before the first
 * parenthesis) rather than searching the whole string. That is what
 * keeps "Draw (majority)" from reading as a decision, since "majority"
 * also appears in decision scorelines -- and a draw pays a Double
 * Chance leg while a decision may not, so confusing them settles real
 * money the wrong way.
 */
export function normalizeFightMethod(methodText: string | null): ResolvedMethod {
  if (methodText === null) return "UNKNOWN";

  const lead = methodText.split("(")[0].trim().toLowerCase();

  switch (lead) {
    case "ko":
    case "tko":
    case "knockout":
    case "technical knockout":
      return "KO_TKO";
    case "submission":
    case "technical submission":
      return "SUBMISSION";
    case "decision":
    case "technical decision":
      return "DECISION";
    case "draw":
    case "technical draw":
      return "DRAW";
    case "nc":
    case "no contest":
      return "NO_CONTEST";
    case "dq":
    case "disqualification":
      return "DQ";
    default:
      return "UNKNOWN";
  }
}
