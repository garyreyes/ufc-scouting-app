// The four ways a fight ends, as stored in picks.predicted_method
// (constrained by 0035_predicted_method_enum.sql, widened by
// 0043_predicted_method_finish.sql) and predicted by both the human pick
// form and the intern (lib/intern/predictInternMethod.ts). NULL -- "no
// method called" -- stays valid for a human pick.
//
// FINISH ("ends early, KO or sub, unclear which") was added in L5 alongside
// the intern's finish-record signal -- a fighter with a real mix of KO and
// submission wins (e.g. 8 KO / 7 SUB) genuinely doesn't favour one over the
// other, and forcing a guess there is less honest than naming the real
// uncertainty. Shared with the human form (L5 DECISIONS.md) rather than an
// intern-only value, so both authors stay comparable once method scoring is
// built.
//
// Lives in lib/scoring/ alongside the other pick/settlement primitives
// (edge, impliedProbability, FightOutcome) since both features/ and
// lib/intern/ need it -- same home as devigTwoWay.
export const FIGHT_METHODS = ["DECISION", "KO_TKO", "SUBMISSION", "FINISH"] as const;

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
    case "FINISH":
      return "Finish";
    default:
      return "—";
  }
}
