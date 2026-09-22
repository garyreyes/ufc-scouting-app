import type { OpenSlip, SlipLeg } from "../types";
import { SlipActions } from "./SlipActions";
import styles from "./SlipList.module.css";

function legLabel(leg: SlipLeg): string {
  const subject = leg.fightLabel ?? leg.externalDescription ?? "Unknown leg";
  const selection = leg.selectionFighterName ?? leg.selectionDetail ?? leg.market;
  return `${subject} — ${selection}${leg.selectionDetail && leg.selectionFighterName ? ` (${leg.selectionDetail})` : ""}`;
}

function legResultLabel(result: SlipLeg["legResult"]): string {
  switch (result) {
    case "pending":
      return "pending";
    case "won":
      return "won";
    case "lost":
      return "lost";
    case "void":
      return "void";
  }
}

/**
 * Every open slip (getOpenSlips already scopes to status='open' under
 * RLS). Settlement into won/lost/void happens off-page, in
 * settleBetSlips.ts -- this list only ever shows what's still open, plus
 * the one client-writable exception, cash-out (SlipActions).
 */
export function SlipList({ slips }: { slips: OpenSlip[] }) {
  if (slips.length === 0) {
    return <p className={styles.empty}>No open slips yet — record one above.</p>;
  }

  return (
    <div className={styles.list}>
      {slips.map((slip) => (
        <div key={slip.id} className={styles.card}>
          <div className={styles.header}>
            <span className={styles.archetype}>{slip.archetype}</span>
            <span className={styles.stake}>
              ₱{slip.stakePhp.toFixed(2)} ({slip.stakeUnits}u) @ {slip.combinedPrice.toFixed(3)}
              {slip.book && ` · ${slip.book}`}
            </span>
          </div>
          <ul className={styles.legList}>
            {slip.legs.map((leg) => (
              <li key={leg.id} className={styles.leg}>
                <span>{legLabel(leg)}</span>
                <span className={`${styles.legResult} ${styles[`legResult_${leg.legResult}`]}`}>
                  {legResultLabel(leg.legResult)}
                </span>
              </li>
            ))}
          </ul>
          {slip.note && <p className={styles.note}>{slip.note}</p>}
          <SlipActions slipId={slip.id} />
        </div>
      ))}
    </div>
  );
}
