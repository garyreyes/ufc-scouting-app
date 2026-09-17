import type { Degradation } from "./types";

/**
 * One definition of the loud "Degraded:" warning line, shared by every
 * job entry point (generalizes scanFightForRumours.ts's mode: "llm" |
 * "heuristic" reporting). Returns null when nothing is worth flagging.
 *
 * The keptRatio check is the important addition beyond what existed
 * before Phase N: a verifier that drops every claim currently produces
 * output IDENTICAL to a model that found nothing at all. Without counting
 * proposed-vs-kept there is no way to tell "the LLM found no rumours this
 * run" apart from "every rumour the LLM found got rejected by the
 * verifier" -- and the second one is a real signal something upstream is
 * wrong (a prompt drifted, a fact-check got too strict), not a quiet
 * night.
 */
export function describeDegradation(d: Degradation): string | null {
  const reasons: string[] = [];

  if (d.mapFallback > 0) {
    reasons.push(`${d.mapFallback} unit(s) fell back to heuristic map`);
  }
  if (d.mapBudgetDenied > 0) {
    reasons.push(`${d.mapBudgetDenied} unit(s) denied budget on map`);
  }
  if (d.reduceMode !== "llm" && d.reduceMode !== "pure" && d.reduceMode !== "skipped_no_units") {
    reasons.push(`reduce ran in ${d.reduceMode} mode`);
  }

  const mapKeptRatio = d.mapClaimsProposed > 0 ? d.mapClaimsKept / d.mapClaimsProposed : 1;
  if (d.mapClaimsProposed > 0 && mapKeptRatio < 0.5) {
    reasons.push(
      `map verifier kept only ${d.mapClaimsKept}/${d.mapClaimsProposed} proposed claims (${Math.round(mapKeptRatio * 100)}%)`,
    );
  }

  const reduceKeptRatio = d.reduceClaimsProposed > 0 ? d.reduceClaimsKept / d.reduceClaimsProposed : 1;
  if (d.reduceClaimsProposed > 0 && reduceKeptRatio < 0.5) {
    reasons.push(
      `reduce verifier kept only ${d.reduceClaimsKept}/${d.reduceClaimsProposed} proposed claims (${Math.round(reduceKeptRatio * 100)}%)`,
    );
  }

  if (reasons.length === 0) return null;
  return reasons.join("; ");
}
