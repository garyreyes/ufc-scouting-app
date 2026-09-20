"use client";

import { useState, useTransition } from "react";
import { resolveStructuralDuplicateAction } from "../actions";
import type { StructuralDuplicateChoice } from "../resolveStructuralDuplicate";
import type { StructuralDuplicateFightersDisplay } from "../types";
import styles from "./ConflictCard.module.css";

/**
 * P8 (ROADMAP_V2.md, I1): the daily integrity sweep found these two
 * fighter rows fold to the same person under the existing structural
 * rules (name-order swap, missing internal space, diacritic/case/
 * whitespace) -- proof from the whole-table sweep, not a live-write guess.
 */
export function StructuralDuplicateFightersCard({ conflict }: { conflict: StructuralDuplicateFightersDisplay }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function resolve(choice: StructuralDuplicateChoice) {
    setError(null);
    startTransition(async () => {
      try {
        await resolveStructuralDuplicateAction(conflict.id, choice);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to resolve");
      }
    });
  }

  return (
    <div className={styles.card}>
      <div className={styles.kindLabel}>Structural duplicate fighters</div>
      <div className={styles.eventMeta}>
        &quot;{conflict.fighterAName}&quot; and &quot;{conflict.fighterBName}&quot; look like the same
        person under a name rearrangement
      </div>
      <div className={styles.options}>
        <button
          type="button"
          className={styles.optionButton}
          onClick={() => resolve("merge")}
          disabled={isPending}
        >
          Same fighter, different row
          <span className={styles.optionHint}>Merge identities</span>
        </button>
        <button
          type="button"
          className={styles.optionButton}
          onClick={() => resolve("not_same_person")}
          disabled={isPending}
        >
          Different people
          <span className={styles.optionHint}>Coincidental name overlap</span>
        </button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
