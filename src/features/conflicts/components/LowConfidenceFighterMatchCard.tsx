"use client";

import { useState, useTransition } from "react";
import { resolveFighterMatchAction } from "../actions";
import type { LowConfidenceFighterMatchDisplay } from "../types";
import styles from "./ConflictCard.module.css";

// Not a real external id -- API-Sports ids are numeric strings, so this
// can never collide with a genuine candidate.
const NONE_OF_THESE = "__none__";

/**
 * I2: a name-only fighter's best API-Sports search candidate didn't
 * clear the auto-match threshold. Candidates are the full ranked list
 * snapshotted at detection time (enrichFighters.ts), each carrying
 * enough of the real record (height, reach, stance, nickname, team) for
 * the owner to actually recognize the right person rather than guessing
 * from a name alone.
 */
export function LowConfidenceFighterMatchCard({ conflict }: { conflict: LowConfidenceFighterMatchDisplay }) {
  const [selected, setSelected] = useState(conflict.candidates[0]?.externalId ?? NONE_OF_THESE);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function resolve() {
    setError(null);
    startTransition(async () => {
      try {
        await resolveFighterMatchAction(conflict.id, selected === NONE_OF_THESE ? null : selected);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to resolve");
      }
    });
  }

  return (
    <div className={styles.card}>
      <div className={styles.kindLabel}>Fighter match needs review</div>
      <div className={styles.eventMeta}>{conflict.storedName}</div>
      {conflict.candidates.length === 0 ? (
        <p className={styles.noCandidates}>No API-Sports candidates -- nothing to match yet.</p>
      ) : (
        <>
          <select className={styles.select} value={selected} onChange={(event) => setSelected(event.target.value)}>
            {conflict.candidates.map((c) => (
              <option key={c.externalId} value={c.externalId}>
                {c.name} ({Math.round(c.confidence * 100)}% match)
                {c.nickname ? ` "${c.nickname}"` : ""}
                {c.team ? ` — ${c.team}` : ""}
              </option>
            ))}
            <option value={NONE_OF_THESE}>None of these — leave unmatched</option>
          </select>
          <button type="button" className={styles.optionButton} onClick={resolve} disabled={isPending}>
            {isPending ? "Resolving…" : "Confirm"}
          </button>
        </>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
