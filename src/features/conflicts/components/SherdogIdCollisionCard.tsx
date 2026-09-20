"use client";

import { useState, useTransition } from "react";
import { resolveSherdogIdCollisionAction } from "../actions";
import type { SherdogIdCollisionChoice } from "../resolveSherdogIdCollision";
import type { SherdogIdCollisionDisplay } from "../types";
import styles from "./ConflictCard.module.css";

/**
 * P6 (ROADMAP_V2.md): fighters.sherdog_id is UNIQUE, so this fighter's
 * resolved Sherdog match collided with an id another fighter row already
 * holds -- structural proof of a duplicate, not a name-similarity guess,
 * shown as such rather than as a third "which candidate" picker.
 */
export function SherdogIdCollisionCard({ conflict }: { conflict: SherdogIdCollisionDisplay }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function resolve(choice: SherdogIdCollisionChoice) {
    setError(null);
    startTransition(async () => {
      try {
        await resolveSherdogIdCollisionAction(conflict.id, choice);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to resolve");
      }
    });
  }

  return (
    <div className={styles.card}>
      <div className={styles.kindLabel}>Sherdog id collision</div>
      <div className={styles.eventMeta}>
        {conflict.storedName} resolved to Sherdog #{conflict.sherdogId}, already claimed by{" "}
        {conflict.existingFighterName}
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
          <span className={styles.optionHint}>Sherdog matched the wrong page</span>
        </button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
