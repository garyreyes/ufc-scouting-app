import type { RumourOutcome } from "../types";
import styles from "./RumourOutcomeTag.module.css";

const LABELS: Record<RumourOutcome, string> = {
  confirmed: "✓ Confirmed",
  refuted: "✗ Refuted",
  unknown: "? Unknown",
};

/**
 * The read-only half of UC-5: once an owner marks a flag (see
 * RumourOutcomeMarking), every visitor sees the same tag -- outcomes are
 * public, matching the rest of rumour data's posture. Renders nothing
 * when unmarked, same "don't show a badge for the empty case" rule
 * RumourBadge already follows.
 */
export function RumourOutcomeTag({ outcome }: { outcome: RumourOutcome | null }) {
  if (outcome === null) return null;
  return <span className={styles.tag}>{LABELS[outcome]}</span>;
}
