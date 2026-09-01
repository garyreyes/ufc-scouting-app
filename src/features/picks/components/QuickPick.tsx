"use client";

import { useState, useTransition } from "react";
import { saveQuickPickAction } from "../actions";
import { QUICK_PICK_BANDS } from "../quickPickBands";
import type { MyPick } from "../types";
import styles from "./QuickPick.module.css";

interface FighterOption {
  id: string;
  name: string;
}

export function QuickPick({
  fightId,
  fighter1,
  fighter2,
  existingPick,
  locked,
  disputed,
}: {
  fightId: string;
  fighter1: FighterOption;
  fighter2: FighterOption;
  existingPick: MyPick | null;
  locked: boolean;
  disputed: boolean;
}) {
  // The fighter currently mid-tap, awaiting a probability band choice --
  // distinct from existingPick, which is the last SAVED pick. Tapping
  // either fighter (new pick or changing an existing one) opens the band
  // row for that fighter; picking a band is what actually saves.
  const [pendingFighterId, setPendingFighterId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (disputed) {
    return (
      <div className={styles.held}>
        Held — disputed opponent.{" "}
        <a href="/conflicts" className={styles.heldLink}>
          Resolve at /conflicts
        </a>
      </div>
    );
  }

  if (locked) {
    return (
      <div className={styles.locked}>
        Picks locked — the card has started.
        {existingPick && (
          <span className={styles.lockedPick}>
            {" "}
            Your pick: {existingPick.predictedFighterId === fighter1.id ? fighter1.name : fighter2.name}
          </span>
        )}
      </div>
    );
  }

  function selectFighter(fighterId: string) {
    setError(null);
    setPendingFighterId(fighterId);
  }

  function saveBand(probability: number) {
    if (!pendingFighterId) return;
    setError(null);
    const fighterId = pendingFighterId;
    startTransition(async () => {
      try {
        await saveQuickPickAction(fightId, fighterId, probability);
        setPendingFighterId(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save pick");
      }
    });
  }

  return (
    <div className={styles.quickPick}>
      <div className={styles.fighterButtons}>
        <FighterPickButton
          fighter={fighter1}
          isPicked={existingPick?.predictedFighterId === fighter1.id}
          onClick={() => selectFighter(fighter1.id)}
        />
        <FighterPickButton
          fighter={fighter2}
          isPicked={existingPick?.predictedFighterId === fighter2.id}
          onClick={() => selectFighter(fighter2.id)}
        />
      </div>

      {pendingFighterId && (
        <div className={styles.bands}>
          <span className={styles.bandsLabel}>
            How sure is {pendingFighterId === fighter1.id ? fighter1.name : fighter2.name}?
          </span>
          <div className={styles.bandButtons}>
            {QUICK_PICK_BANDS.map((band) => (
              <button
                key={band.label}
                type="button"
                className={styles.bandButton}
                onClick={() => saveBand(band.probability)}
                disabled={isPending}
              >
                {band.label} ({Math.round(band.probability * 100)}%)
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}

function FighterPickButton({
  fighter,
  isPicked,
  onClick,
}: {
  fighter: FighterOption;
  isPicked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.fighterButton} ${isPicked ? styles.fighterButtonPicked : ""}`}
      onClick={onClick}
    >
      {fighter.name}
      {isPicked && <span className={styles.pickedLabel}>Your pick</span>}
    </button>
  );
}
