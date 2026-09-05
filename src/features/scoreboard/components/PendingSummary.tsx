import type { PendingSummary as PendingSummaryData, PendingSide } from "../types";
import styles from "./PendingSummary.module.css";

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

function sideDetail(side: PendingSide): string {
  if (side.picks === 0) return "no open picks";
  const picks = `${side.picks} pick${side.picks === 1 ? "" : "s"}`;
  if (side.bets === 0) return `${picks} · no bets`;
  return `${picks} · ${side.bets} bet${side.bets === 1 ? "" : "s"} · ${round1(side.unitsAtRisk)}u at risk`;
}

/**
 * What each side has riding on fights that haven't settled yet. Sits
 * above the boards because the boards are strictly about scored results
 * -- and before the first card of a window settles, that's nothing,
 * while the intern has usually already committed to a full slate. This
 * keeps the page answering "what's the intern doing" immediately.
 *
 * Rendered whenever there's anything pending on either side; the page
 * omits it entirely when both sides are empty.
 */
export function PendingSummary({ pending }: { pending: PendingSummaryData }) {
  return (
    <section className={styles.wrap} aria-label="Open picks and bets">
      <p className={styles.heading}>Riding on upcoming fights</p>
      <div className={styles.row}>
        <span className={styles.label}>Intern</span>
        <span className={styles.detail}>{sideDetail(pending.intern)}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>You</span>
        <span className={styles.detail}>{sideDetail(pending.me)}</span>
      </div>
    </section>
  );
}
