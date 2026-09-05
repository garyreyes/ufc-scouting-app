import { fightMethodLabel } from "@/lib/scoring/fightMethod";
import { buildInternCardReadRows } from "../internCardRead";
import type { InternPickSummary } from "../types";
import styles from "./InternCardRead.module.css";

interface CardFight {
  id: string;
  fighter1: { id: string; name: string };
  fighter2: { id: string; name: string };
  odds: { fighter1_price: number; fighter2_price: number } | null;
}

function pct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function edgeText(value: number | null): string {
  if (value === null) return "—";
  const p = Math.round(value * 1000) / 10;
  return `${p >= 0 ? "+" : ""}${p}%`;
}

/**
 * The card-view "Intern's read" panel -- every fight the intern has an
 * opinion on, in one table: its pick, predicted method, whether it bet
 * (and how much), and how its probability compares to the de-vigged
 * market. Collapsed by default (native <details>, no JS) because a card
 * page is already dense per-row; owner-only, rendered by the same gate
 * as the per-fight intern lines.
 *
 * Unpriced fights (most of an upcoming card until ~T-12h) show the pick
 * and "—" for the market columns rather than being hidden -- the early
 * read is the point.
 */
export function InternCardRead({
  fights,
  internPicks,
}: {
  fights: CardFight[];
  internPicks: Map<string, InternPickSummary>;
}) {
  const rows = buildInternCardReadRows(fights, internPicks);
  if (rows.length === 0) return null;

  const betCount = rows.filter((r) => r.betName !== null).length;

  return (
    <details className={styles.panel}>
      <summary className={styles.summary}>
        Intern&apos;s read — {rows.length} pick{rows.length === 1 ? "" : "s"}
        {betCount > 0 ? `, ${betCount} bet${betCount === 1 ? "" : "s"}` : ""}
      </summary>

      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.left}>Fight</th>
              <th className={styles.left}>Pick</th>
              <th className={styles.left}>Method</th>
              <th className={styles.left}>Bet</th>
              <th>Market</th>
              <th>Intern</th>
              <th>Edge</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.fightId} className={row.betName ? styles.betRow : ""}>
                <td className={styles.left}>
                  {row.fighter1Name} <span className={styles.vs}>v</span> {row.fighter2Name}
                </td>
                <td className={styles.left}>{row.pickName}</td>
                <td className={styles.left}>{fightMethodLabel(row.method)}</td>
                <td className={styles.left}>
                  {row.betName ? (
                    <span className={styles.betCell}>
                      {row.betName} {Number(row.stakeUnits)}u
                    </span>
                  ) : (
                    <span className={styles.noBet}>—</span>
                  )}
                </td>
                <td>{pct(row.marketProb)}</td>
                <td>{pct(row.internProb)}</td>
                {/* The accent only fires on a fight the intern ACTUALLY
                    bet. A pick made while the fight was unpriced can show
                    a >5% edge here against fresh odds before the next
                    cron places the bet -- highlighting that would read as
                    "the intern found an edge and didn't act," a bug it
                    isn't. */}
                <td className={row.betName && row.edgePct !== null && row.edgePct >= 0.05 ? styles.edgeLive : ""}>
                  {edgeText(row.edgePct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={styles.footnote}>
        Market/Intern/Edge describe the bet fighter where there&apos;s a bet, otherwise the pick.
        Market % is de-vigged. The intern bets only above a +5% edge.
      </p>
    </details>
  );
}
