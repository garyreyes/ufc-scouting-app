"use client";

import { useState, useTransition } from "react";
import { resolveLowConfidenceAction } from "../actions";
import type { LowConfidenceDisplay } from "../types";
import styles from "./ConflictCard.module.css";

// Not a real fight id (fights.id is a uuid) -- can never collide with a
// genuine candidate. Same sentinel shape LowConfidenceFighterMatchCard.tsx
// already uses for its own "none of these" option.
const NONE_OF_THESE = "__none__";

/**
 * An odds event couldn't be confidently linked to a fight. Candidates are
 * every fight in the odds event's date window, ranked by the algorithm's
 * own confidence (rankFightMatches) -- the owner can pick a lower-ranked
 * one if the top guess was itself wrong, rather than only ever
 * confirming or rejecting it blind. "No matching fight" (dismiss, no
 * price written) is available whether or not any candidates exist --
 * plenty of odds events are for fighters we don't track at all (regional/
 * other-promotion cards the provider bundles in), and forcing a pick
 * among wrong candidates would silently write a fabricated price onto an
 * unrelated real fight.
 */
export function LowConfidenceCard({ conflict }: { conflict: LowConfidenceDisplay }) {
  const [selected, setSelected] = useState(conflict.candidates[0]?.id ?? NONE_OF_THESE);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function resolve(chosenFightId: string | null) {
    setError(null);
    startTransition(async () => {
      try {
        await resolveLowConfidenceAction(conflict.id, chosenFightId);
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
        <>
          <p className={styles.noCandidates}>
            No candidate fights in this card&apos;s date window -- nothing to match yet.
          </p>
          <button type="button" className={styles.optionButton} onClick={() => resolve(null)} disabled={isPending}>
            {isPending ? "Resolving…" : "No matching fight — dismiss"}
          </button>
        </>
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
            <option value={NONE_OF_THESE}>No matching fight — dismiss</option>
          </select>
          <button
            type="button"
            className={styles.optionButton}
            onClick={() => resolve(selected === NONE_OF_THESE ? null : selected)}
            disabled={isPending}
          >
            {isPending ? "Resolving…" : "Confirm"}
          </button>
        </>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
