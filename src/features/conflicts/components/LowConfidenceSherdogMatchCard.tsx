"use client";

import { useState, useTransition } from "react";
import { resolveSherdogMatchAction } from "../actions";
import type { LowConfidenceSherdogMatchDisplay } from "../types";
import styles from "./ConflictCard.module.css";

// Sherdog ids are positive integers, so any non-numeric sentinel is safe
// from colliding with a real candidate value.
const NONE_OF_THESE = "__none__";

function describe(c: LowConfidenceSherdogMatchDisplay["candidates"][number]): string {
  const bits = [
    c.nickname ? `"${c.nickname}"` : null,
    c.weightImperial,
    c.association,
  ].filter(Boolean);
  return bits.length > 0 ? ` — ${bits.join(", ")}` : "";
}

function whyQueued(conflict: LowConfidenceSherdogMatchDisplay): string {
  switch (conflict.reason) {
    case "ambiguous":
      return "More than one Sherdog fighter shares this name — pick the right one.";
    case "guard_mismatch":
      return conflict.guardMismatchPageName
        ? `Auto-match pointed at a page named "${conflict.guardMismatchPageName}" — likely the wrong person.`
        : "The auto-matched page looked like a different person.";
    case "below_threshold":
    default:
      return "No candidate was a confident enough name match to link automatically.";
  }
}

/**
 * J3b: a fighter's best Sherdog search candidate didn't clear the
 * auto-match threshold -- a name-order swap ("Aori Qileng" vs Sherdog's
 * "Qileng Aori"), a common surname. Candidates are the full ranked list
 * snapshotted at detection, each with the nickname / listed weight / gym
 * the owner needs to tell two same-named fighters apart.
 */
export function LowConfidenceSherdogMatchCard({
  conflict,
}: {
  conflict: LowConfidenceSherdogMatchDisplay;
}) {
  const [selected, setSelected] = useState(
    conflict.candidates[0] ? String(conflict.candidates[0].sherdogId) : NONE_OF_THESE,
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function resolve() {
    setError(null);
    startTransition(async () => {
      try {
        await resolveSherdogMatchAction(
          conflict.id,
          selected === NONE_OF_THESE ? null : Number(selected),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to resolve");
      }
    });
  }

  return (
    <div className={styles.card}>
      <div className={styles.kindLabel}>Sherdog match needs review</div>
      <div className={styles.eventMeta}>{conflict.storedName}</div>
      <p className={styles.optionHint}>{whyQueued(conflict)}</p>
      {conflict.candidates.length === 0 ? (
        <p className={styles.noCandidates}>No Sherdog candidates — nothing to match yet.</p>
      ) : (
        <>
          <select
            className={styles.select}
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            {conflict.candidates.map((c) => (
              <option key={c.sherdogId} value={c.sherdogId}>
                {c.name} ({Math.round(c.confidence * 100)}% match){describe(c)}
              </option>
            ))}
            <option value={NONE_OF_THESE}>None of these — leave unmatched</option>
          </select>
          <button
            type="button"
            className={styles.optionButton}
            onClick={resolve}
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
