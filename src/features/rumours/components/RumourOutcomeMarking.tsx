"use client";

import { useState, useTransition } from "react";
import { markRumourOutcomeAction } from "../actions";
import { CATEGORY_LABELS } from "@/lib/rumours/concernKeywords";
import type { RumourFlagSummary, RumourOutcome } from "../types";
import styles from "./RumourOutcomeMarking.module.css";

const OUTCOMES: { value: RumourOutcome; label: string }[] = [
  { value: "confirmed", label: "Confirmed" },
  { value: "refuted", label: "Refuted" },
  { value: "unknown", label: "Unknown" },
];

/**
 * UC-5's write half: "beside the flag, on the card you already have
 * open" (docs/user-flows.md Flow 2) -- rendered by the caller only when
 * the fight has settled and the viewer is the owner (BoutRow/RumourSection
 * already compute both; this component trusts neither on its own, since
 * markRumourOutcomeAction re-checks both server-side regardless -- same
 * belt-and-suspenders posture as every other owner-gated action in this
 * app).
 */
export function RumourOutcomeMarking({
  flags,
  fighterNameById,
}: {
  flags: RumourFlagSummary[];
  fighterNameById: Map<string, string>;
}) {
  if (flags.length === 0) return null;

  return (
    <div className={styles.marking}>
      <span className={styles.label}>Rumour outcomes</span>
      {flags.map((flag) => (
        <FlagToggle key={flag.id} flag={flag} fighterName={fighterNameById.get(flag.fighterId) ?? "?"} />
      ))}
    </div>
  );
}

function FlagToggle({ flag, fighterName }: { flag: RumourFlagSummary; fighterName: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function mark(outcome: RumourOutcome) {
    setError(null);
    // Clicking the already-selected state unmarks it, rather than
    // needing a separate "clear" control -- flag.outcome reflects the
    // last server-confirmed value, so this reads correctly even after a
    // page revalidation from a previous mark.
    const next = flag.outcome === outcome ? null : outcome;
    startTransition(async () => {
      try {
        await markRumourOutcomeAction(flag.id, next);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
      }
    });
  }

  return (
    <div className={styles.flagRow}>
      <span className={styles.flagLabel}>
        {CATEGORY_LABELS[flag.category]} — {fighterName}
      </span>
      <div className={styles.buttons}>
        {OUTCOMES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className={`${styles.button} ${flag.outcome === value ? styles.buttonActive : ""}`}
            onClick={() => mark(value)}
            disabled={isPending}
            aria-pressed={flag.outcome === value}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <span className={styles.error}>{error}</span>}
    </div>
  );
}
