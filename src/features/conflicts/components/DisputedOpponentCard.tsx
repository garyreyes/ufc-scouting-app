"use client";

import { useState, useTransition } from "react";
import { resolveDisputedOpponentAction } from "../actions";
import type { DisputedOpponentDisplay } from "../types";
import styles from "./ConflictCard.module.css";

/**
 * Two sources disagree about who the opponent is (ARCHITECTURE.md Fork
 * 5). Each option shows the pairing it would confirm, not an abstract
 * "keep" / "replace" choice -- the owner should recognize the fighters,
 * not have to remember which source said what.
 */
export function DisputedOpponentCard({ conflict }: { conflict: DisputedOpponentDisplay }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function resolve(choice: "existing" | "candidate" | "merge") {
    setError(null);
    startTransition(async () => {
      try {
        await resolveDisputedOpponentAction(conflict.id, choice);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to resolve");
      }
    });
  }

  return (
    <div className={styles.card}>
      <div className={styles.kindLabel}>Disputed opponent</div>
      <div className={styles.eventMeta}>
        {conflict.eventName} · {conflict.eventDate}
      </div>
      <div className={styles.options}>
        <button
          type="button"
          className={styles.optionButton}
          onClick={() => resolve("existing")}
          disabled={isPending}
        >
          {conflict.existingFighter1Name} vs {conflict.existingFighter2Name}
          <span className={styles.optionHint}>Currently on record</span>
        </button>
        <button
          type="button"
          className={styles.optionButton}
          onClick={() => resolve("candidate")}
          disabled={isPending}
        >
          {conflict.candidateFighter1Name} vs {conflict.candidateFighter2Name}
          <span className={styles.optionHint}>Candidate replacement</span>
        </button>
        {/* M3: the two pairings above differ by exactly one fighter --
            this is that fighter saying "these are the same person," not
            a third pairing. The automatic sweep already catches the
            common case (a suffix or dropped middle name); this covers
            whatever it didn't. */}
        <button
          type="button"
          className={styles.optionButton}
          onClick={() => resolve("merge")}
          disabled={isPending}
        >
          Same fighter, different name
          <span className={styles.optionHint}>Merge identities</span>
        </button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
