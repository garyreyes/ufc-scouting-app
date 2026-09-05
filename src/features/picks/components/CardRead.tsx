import { fightMethodLabel } from "@/lib/scoring/fightMethod";
import { buildCardReadRows, type CardReadPick } from "../cardRead";
import styles from "./CardRead.module.css";

interface CardFight {
  id: string;
  fighter1: { id: string; name: string };
  fighter2: { id: string; name: string };
  odds: { fighter1_price: number; fighter2_price: number } | null;
}

// "you" = the owner's own picks; "intern" = the automated tipster's.
// The two panels render as a matched pair on the card page, so this only
// changes the words, never the columns.
type Perspective = "you" | "intern";

const COPY: Record<Perspective, { title: string; probHeader: string; footnote: string }> = {
  you: {
    title: "Your card",
    probHeader: "You",
    footnote:
      "Market/You/Edge describe the bet fighter where there's a bet, otherwise the pick. Market % is de-vigged; \"You\" is the probability you entered.",
  },
  intern: {
    title: "Intern's read",
    probHeader: "Intern",
    footnote:
      "Market/Intern/Edge describe the bet fighter where there's a bet, otherwise the pick. Market % is de-vigged. The intern bets only above a +5% edge.",
  },
};

function pct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function edgeText(value: number | null): string {
  if (value === null) return "—";
  const p = Math.round(value * 1000) / 10;
  return `${p >= 0 ? "+" : ""}${p}%`;
}

/**
 * The card-view read panel -- every fight the given party has an opinion
 * on, in one table: the pick, its confidence and called method, whether
 * there's a bet (and how much), and how the party's probability compares
 * to the de-vigged market. Collapsed by default (native <details>, no JS)
 * because a card page is already dense per-row; owner-only, rendered by
 * the same gate as the per-fight pick lines.
 *
 * Rendered twice on /events/[id] -- once for the owner ("you"), once for
 * the intern -- so the owner can read their whole card against the
 * machine's at a glance.
 *
 * Unpriced fights (most of an upcoming card until ~T-12h) show the pick
 * and "—" for the market columns rather than being hidden -- the early
 * read is the point.
 */
export function CardRead({
  perspective,
  fights,
  picks,
}: {
  perspective: Perspective;
  fights: CardFight[];
  picks: Map<string, CardReadPick>;
}) {
  const rows = buildCardReadRows(fights, picks);
  if (rows.length === 0) return null;

  const copy = COPY[perspective];
  const betCount = rows.filter((r) => r.betName !== null).length;

  return (
    <details className={styles.panel}>
      <summary className={styles.summary}>
        {copy.title} — {rows.length} pick{rows.length === 1 ? "" : "s"}
        {betCount > 0 ? `, ${betCount} bet${betCount === 1 ? "" : "s"}` : ""}
      </summary>

      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.left}>Fight</th>
              <th className={styles.left}>Pick</th>
              <th>Conf</th>
              <th className={styles.left}>Method</th>
              <th className={styles.left}>Bet</th>
              <th>Market</th>
              <th>{copy.probHeader}</th>
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
                <td>{row.confidence}/5</td>
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
                <td>{pct(row.pickerProb)}</td>
                {/* The accent only fires on a fight there's ACTUALLY a bet
                    on. A pick made while the fight was unpriced can show a
                    >5% edge here against fresh odds before a bet is placed
                    -- highlighting that would read as "found an edge and
                    didn't act," a bug it isn't. */}
                <td className={row.betName && row.edgePct !== null && row.edgePct >= 0.05 ? styles.edgeLive : ""}>
                  {edgeText(row.edgePct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={styles.footnote}>{copy.footnote}</p>
    </details>
  );
}
