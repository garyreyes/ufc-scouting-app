import { ageOnDate } from "../../shared/utils/ageOnDate";
import type { SherdogBio } from "./parseFighterPage";
import { parseSherdogBirthDate } from "./parseSherdogDate";

export type BirthDateFill =
  | { kind: "fill"; birthDate: string }
  | { kind: "keep" }
  | { kind: "missing" }
  | { kind: "mismatch"; birthDate: string; computedAge: number; printedAge: number };

/**
 * L3-age: whether a Sherdog page's birth date should be written to
 * fighters.birth_date. Never overwrites (same rule as bioFillPayload).
 *
 * Sherdog prints the fighter's age beside the date, so a parsed date whose
 * age on `onDate` disagrees with that number is refused rather than
 * written -- that disagreement is the only visible symptom of a date that
 * parsed to the wrong day or year. A page with no printed age still fills.
 */
export function birthDateFill(
  currentBirthDate: string | null,
  bio: Pick<SherdogBio, "birthDate" | "printedAge">,
  onDate: string,
): BirthDateFill {
  if (currentBirthDate !== null) return { kind: "keep" };

  const birthDate = parseSherdogBirthDate(bio.birthDate);
  if (birthDate === null) return { kind: "missing" };

  if (bio.printedAge !== null) {
    const computedAge = ageOnDate(birthDate, onDate);
    if (computedAge !== bio.printedAge) {
      return { kind: "mismatch", birthDate, computedAge, printedAge: bio.printedAge };
    }
  }

  return { kind: "fill", birthDate };
}
