"use client";

import { useState, useTransition } from "react";
import { saveBetAction } from "../actions";
import { BET_PROBABILITY_BANDS, nearestBetProbabilityBand } from "../betProbabilityBands";
import { impliedProbability } from "@/lib/scoring/impliedProbability";
import { applyProbabilityDelta } from "@/lib/scoring/applyProbabilityDelta";
import { probabilityForFighter } from "@/lib/scoring/probabilityForFighter";
import { priceForFighter } from "@/lib/scoring/priceForFighter";
import { edge } from "@/lib/scoring/edge";
import { FIGHT_METHODS, fightMethodLabel, type FightMethod } from "@/lib/scoring/fightMethod";
import type { MyPick } from "../types";
import styles from "./BetRow.module.css";

interface FighterOption {
  id: string;
  name: string;
}

const CONFIDENCE_LEVELS = [1, 2, 3, 4, 5];

// Odds are guaranteed non-null by the caller (BoutRow only renders BetRow
// once the fight is priced -- see ordering constraint #5, ROADMAP.md) and
// myPick is guaranteed non-null (a bet can't create a pick out of thin
// air, actions.ts's saveBetAction enforces the same rule server-side).
export function BetRow({
  fightId,
  fighter1,
  fighter2,
  odds,
  myPick,
}: {
  fightId: string;
  fighter1: FighterOption;
  fighter2: FighterOption;
  odds: { fighter1_price: number; fighter2_price: number };
  myPick: MyPick;
}) {
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const predictedFighterId = myPick.predictedFighterId;
  const impliedForPredicted = impliedProbability(
    priceForFighter(predictedFighterId, fighter1.id, fighter2.id, odds)!,
  );
  const initialBand = nearestBetProbabilityBand(impliedForPredicted, myPick.estimatedProbability);

  const [confidence, setConfidence] = useState(myPick.confidence);
  const [predictedMethod, setPredictedMethod] = useState<FightMethod | null>(
    myPick.predictedMethod ?? null,
  );
  const [reasoning, setReasoning] = useState(myPick.reasoning ?? "");
  const [delta, setDelta] = useState(initialBand.delta);
  const [betFighterId, setBetFighterId] = useState(myPick.betFighterId ?? predictedFighterId);
  const [stakeInput, setStakeInput] = useState(myPick.stakeUnits?.toString() ?? "");

  const estimatedProbability = applyProbabilityDelta(impliedForPredicted, delta);
  const betPrice = priceForFighter(betFighterId, fighter1.id, fighter2.id, odds);
  const betProbability = probabilityForFighter(betFighterId, predictedFighterId, estimatedProbability);
  const liveEdge = betPrice !== null ? edge(betProbability, betPrice) : null;

  const predictedFighterName = predictedFighterId === fighter1.id ? fighter1.name : fighter2.name;
  const hasBet = myPick.betFighterId !== null;

  function save() {
    setError(null);
    const trimmedStake = stakeInput.trim();
    const stakeUnits = trimmedStake === "" ? null : Number(trimmedStake);
    if (stakeUnits !== null && !(stakeUnits > 0)) {
      setError("Stake must be greater than 0, or left blank for no bet.");
      return;
    }
    startTransition(async () => {
      try {
        await saveBetAction(fightId, {
          estimatedProbability,
          confidence,
          predictedMethod,
          reasoning: reasoning.trim() === "" ? null : reasoning.trim(),
          betFighterId: stakeUnits === null ? null : betFighterId,
          stakeUnits,
        });
        setExpanded(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
      }
    });
  }

  function removeBet() {
    setError(null);
    startTransition(async () => {
      try {
        await saveBetAction(fightId, { betFighterId: null, stakeUnits: null });
        setStakeInput("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to remove bet");
      }
    });
  }

  if (!expanded) {
    return (
      <button type="button" className={styles.toggle} onClick={() => setExpanded(true)}>
        {hasBet
          ? `Edit bet — ${myPick.stakeUnits}u on ${myPick.betFighterId === fighter1.id ? fighter1.name : fighter2.name}`
          : "Bet this fight"}
      </button>
    );
  }

  return (
    <div className={styles.betRow}>
      <div className={styles.field}>
        <span className={styles.label}>Confidence</span>
        <div className={styles.chips}>
          {CONFIDENCE_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              className={`${styles.chip} ${confidence === level ? styles.chipSelected : ""}`}
              onClick={() => setConfidence(level)}
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>
          Market: {Math.round(impliedForPredicted * 100)}% on {predictedFighterName} · You:{" "}
          {Math.round(estimatedProbability * 100)}%
        </span>
        <div className={styles.chips}>
          {BET_PROBABILITY_BANDS.map((band) => (
            <button
              key={band.label}
              type="button"
              className={`${styles.chip} ${delta === band.delta ? styles.chipSelected : ""}`}
              onClick={() => setDelta(band.delta)}
            >
              {band.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Back</span>
        <div className={styles.chips}>
          <button
            type="button"
            className={`${styles.chip} ${betFighterId === fighter1.id ? styles.chipSelected : ""}`}
            onClick={() => setBetFighterId(fighter1.id)}
          >
            {fighter1.name}
          </button>
          <button
            type="button"
            className={`${styles.chip} ${betFighterId === fighter2.id ? styles.chipSelected : ""}`}
            onClick={() => setBetFighterId(fighter2.id)}
          >
            {fighter2.name}
          </button>
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`stake-${fightId}`}>
          Stake (units, blank = no bet)
        </label>
        <input
          id={`stake-${fightId}`}
          type="number"
          step="0.5"
          min="0.5"
          placeholder="e.g. 1.5"
          value={stakeInput}
          onChange={(e) => setStakeInput(e.target.value)}
          className={styles.stakeInput}
        />
      </div>

      {liveEdge !== null && stakeInput.trim() !== "" && (
        <p className={styles.edge}>
          {liveEdge >= 0 ? "+" : ""}
          {Math.round(liveEdge * 1000) / 10}% edge backing {betFighterId === fighter1.id ? fighter1.name : fighter2.name}
        </p>
      )}

      <div className={styles.field}>
        <span className={styles.label}>Predicted method (optional)</span>
        <div className={styles.chips}>
          {FIGHT_METHODS.map((m) => (
            <button
              key={m}
              type="button"
              className={`${styles.chip} ${predictedMethod === m ? styles.chipSelected : ""}`}
              onClick={() => setPredictedMethod(predictedMethod === m ? null : m)}
            >
              {fightMethodLabel(m)}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`reasoning-${fightId}`}>
          Reasoning (optional)
        </label>
        <textarea
          id={`reasoning-${fightId}`}
          value={reasoning}
          onChange={(e) => setReasoning(e.target.value)}
          className={styles.textarea}
          rows={2}
        />
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.actions}>
        <button type="button" className={styles.save} onClick={save} disabled={isPending}>
          Save
        </button>
        {hasBet && (
          <button type="button" className={styles.remove} onClick={removeBet} disabled={isPending}>
            Remove bet
          </button>
        )}
        <button type="button" className={styles.cancel} onClick={() => setExpanded(false)} disabled={isPending}>
          Close
        </button>
      </div>
    </div>
  );
}
