"use client";

import { useState, useTransition } from "react";
import { resolveLowConfidenceAction } from "../actions";
import type { LowConfidenceDisplay } from "../types";
import styles from "./ConflictCard.module.css";

/**
 * An odds event couldn't be confidently linked to a fight. Candidates are
 * every fight in the odds event's date window, ranked by the algorithm's
 * own confidence (rankFightMatches) -- the owner can pick a lower-ranked
 * one if the top guess was itself wrong, rather than only ever
 * confirming or rejecting it blind.
 */
export function LowConfidenceCard({ conflict }: { conflict: LowConfidenceDisplay }) {
  const [selected, setSelected] = useState(conflict.candidates[0]?.id ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function resolve() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      try {
        await resolveLowConfidenceAction(conflict.id, selected);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to resolve");
      }
    });
  }

  return (
    <div className={styles.card}>
      <div className={styles.kindLabel}>Low-confidence odds match</div>
      <div className={styles.eventMeta}>
        {conflict.oddsHomeTeam} vs {conflict.oddsAwayTeam}
      </div>
      {conflict.candidates.length === 0 ? (
        <p className={styles.noCandidates}>
          No candidate fights in this card&apos;s date window -- nothing to match yet.
        </p>
      ) : (
        <>
          <select
            className={styles.select}
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            {conflict.candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.fighter1Name} vs {candidate.fighter2Name} (
                {Math.round(candidate.confidence * 100)}% match)
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.optionButton}
            onClick={resolve}
            disabled={isPending || !selected}
          >
            {isPending ? "Resolving…" : "Confirm this match"}
          </button>
        </>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
