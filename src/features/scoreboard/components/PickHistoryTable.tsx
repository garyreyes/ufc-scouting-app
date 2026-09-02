"use client";

import { useMemo, useState } from "react";
import { aggregateAccuracyLine } from "@/lib/scoring/aggregateAccuracyLine";
import { aggregateUnitsLine } from "@/lib/scoring/aggregateUnitsLine";
import type { BetResult } from "@/lib/scoring/aggregateUnitsLine";
import type { PickTableRow } from "../types";
import styles from "./PickHistoryTable.module.css";

const ALL = "All";
type FavoriteFilter = "All" | "Favorite" | "Underdog";

function formatUnits(units: number): string {
  const sign = units > 0 ? "+" : "";
  return `${sign}${units.toFixed(2)}u`;
}

/**
 * E2 (docs/user-flows.md): "the PRD's breakdowns (weight class, stance
 * matchup, favourite vs underdog, flag present) are filters on that
 * table," filtered client-side -- this app's whole pick history is at
 * most a few hundred rows, small enough that a live re-fetch per filter
 * would only add latency for no real benefit.
 *
 * The summary line above the table reuses the exact same
 * aggregateAccuracyLine/aggregateUnitsLine the boards themselves use, so
 * "12/18 correct in this slice" is computed the identical way "my
 * accuracy" is -- one reduction, not a second one built for filtering.
 */
export function PickHistoryTable({ rows }: { rows: PickTableRow[] }) {
  const [weightClass, setWeightClass] = useState(ALL);
  const [stanceMatchup, setStanceMatchup] = useState(ALL);
  const [favoriteFilter, setFavoriteFilter] = useState<FavoriteFilter>(ALL);

  const weightClassOptions = useMemo(() => {
    const values = [...new Set(rows.map((r) => r.weightClass).filter((w): w is string => w !== null))].sort();
    return [ALL, ...values];
  }, [rows]);

  const stanceMatchupOptions = useMemo(() => {
    const values = [...new Set(rows.map((r) => r.stanceMatchup))].sort();
    return [ALL, ...values];
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (weightClass !== ALL && row.weightClass !== weightClass) return false;
      if (stanceMatchup !== ALL && row.stanceMatchup !== stanceMatchup) return false;
      if (favoriteFilter === "Favorite" && row.favoriteOrUnderdog !== "favorite") return false;
      if (favoriteFilter === "Underdog" && row.favoriteOrUnderdog !== "underdog") return false;
      return true;
    });
  }, [rows, weightClass, stanceMatchup, favoriteFilter]);

  const accuracy = aggregateAccuracyLine(filteredRows.map((r) => r.pickCorrect));
  const betResults: BetResult[] = filteredRows
    .filter((r) => r.pnlUnits !== null)
    .map((r) => ({ stakeUnits: r.stakeUnits as number, pnlUnits: r.pnlUnits as number }));
  const units = aggregateUnitsLine(betResults);

  return (
    <section className={styles.section}>
      <h2 className={styles.title}>Pick history</h2>

      <div className={styles.filters}>
        <label className={styles.filterField}>
          Weight class
          <select value={weightClass} onChange={(e) => setWeightClass(e.target.value)}>
            {weightClassOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.filterField}>
          Stance matchup
          <select value={stanceMatchup} onChange={(e) => setStanceMatchup(e.target.value)}>
            {stanceMatchupOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.filterField}>
          Favourite / underdog
          <select value={favoriteFilter} onChange={(e) => setFavoriteFilter(e.target.value as FavoriteFilter)}>
            <option value="All">All</option>
            <option value="Favorite">Favourite</option>
            <option value="Underdog">Underdog</option>
          </select>
        </label>

        <label className={styles.filterField}>
          Flag present
          <select disabled aria-describedby="flag-filter-hint">
            <option>Not available yet</option>
          </select>
        </label>
      </div>
      {/* A `title` attribute isn't reliably read by screen readers or shown
          on touch -- this is the real, visible explanation the select
          above points to via aria-describedby, same "state the control,
          don't hide it" principle as the small-sample banner. */}
      <p id="flag-filter-hint" className={styles.filterHint}>
        Flag present arrives with the rumour engine (Phase F).
      </p>

      <p className={styles.summary}>
        {accuracy.total > 0
          ? `${accuracy.correct}/${accuracy.total} correct (${Math.round((accuracy.accuracyPct ?? 0) * 100)}%)`
          : "No picks in this slice"}
        {units.betsPlaced > 0 && ` · ${formatUnits(units.netUnits)} across ${units.betsPlaced} bets`}
      </p>

      {filteredRows.length === 0 ? (
        <p className={styles.empty}>No picks match these filters.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={styles.caption}>
              Settled picks{filteredRows.length !== rows.length ? `, filtered (${filteredRows.length} of ${rows.length})` : ""}
            </caption>
            <thead>
              <tr>
                <th>Card</th>
                <th>Matchup</th>
                <th>Weight class</th>
                <th>Picked</th>
                <th>Result</th>
                <th>Bet</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.pickId}>
                  <td>
                    {row.eventName} · {row.eventDate}
                  </td>
                  <td>
                    {row.fighter1Name} vs {row.fighter2Name}
                  </td>
                  <td>{row.weightClass ?? "—"}</td>
                  <td>
                    {row.predictedFighterName}
                    {row.favoriteOrUnderdog && (
                      <span className={styles.tag}> ({row.favoriteOrUnderdog})</span>
                    )}
                  </td>
                  <td>
                    {row.pickCorrect === null ? "Void" : row.pickCorrect ? "Correct" : "Incorrect"}
                  </td>
                  <td>
                    {row.betFighterName
                      ? `${row.stakeUnits}u on ${row.betFighterName} → ${
                          row.pnlUnits !== null ? formatUnits(row.pnlUnits) : "—"
                        }`
                      : "No bet"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
