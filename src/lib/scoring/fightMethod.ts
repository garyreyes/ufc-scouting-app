// The three ways a fight ends, as stored in picks.predicted_method
// (constrained by 0035_predicted_method_enum.sql) and predicted by both
// the human pick form and the intern (lib/intern/predictInternMethod.ts).
// NULL -- "no method called" -- stays valid for a human pick.
//
// Lives in lib/scoring/ alongside the other pick/settlement primitives
// (edge, impliedProbability, FightOutcome) since both features/ and
// lib/intern/ need it -- same home as devigTwoWay.
export const FIGHT_METHODS = ["DECISION", "KO_TKO", "SUBMISSION"] as const;

export type FightMethod = (typeof FIGHT_METHODS)[number];

export function isFightMethod(value: unknown): value is FightMethod {
  return typeof value === "string" && (FIGHT_METHODS as readonly string[]).includes(value);
}

export function fightMethodLabel(method: string | null): string {
  switch (method) {
    case "DECISION":
      return "Decision";
    case "KO_TKO":
      return "KO/TKO";
    case "SUBMISSION":
      return "Submission";
    default:
      return "\u2014";
  }
}
