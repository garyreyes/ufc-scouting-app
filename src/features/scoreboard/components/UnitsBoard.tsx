import type { UnitsLine } from "../types";
import styles from "./Board.module.css";

function formatUnits(units: number): string {
  const sign = units > 0 ? "+" : "";
  return `${sign}${units.toFixed(2)}u`;
}

function LineRow({ label, line }: { label: string; line: UnitsLine }) {
  if (line.betsPlaced === 0) {
    return (
      <div className={styles.row}>
        <span className={styles.label}>{label}</span>
        <span className={styles.noData}>No bets yet</span>
      </div>
    );
  }

  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <span className={styles.headline}>{formatUnits(line.netUnits)}</span>
      <span className={styles.detail}>
        {line.betsWon}W-{line.betsLost}L
        {line.betsVoided > 0 ? `-${line.betsVoided}V` : ""} · {line.betsPlaced} bet
        {line.betsPlaced === 1 ? "" : "s"}
      </span>
    </div>
  );
}

// Always renders all three lines, even with no data (docs/user-flows.md:
// "a line that disappears when it has no data reads as a bug and hides
// the control you most need") -- most relevant to "Intern" until Phase G
// ships real intern picks.
export function UnitsBoard({ me, intern, chalk }: { me: UnitsLine; intern: UnitsLine; chalk: UnitsLine }) {
  return (
    <section className={styles.board}>
      <h2 className={styles.title}>Units</h2>
      <p className={styles.subtitle}>Did I find mispriced fights?</p>
      <LineRow label="Me" line={me} />
      <LineRow label="Intern" line={intern} />
      <LineRow label="Chalk" line={chalk} />
    </section>
  );
}
