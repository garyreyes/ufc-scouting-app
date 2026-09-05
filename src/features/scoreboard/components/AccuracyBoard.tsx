import type { AccuracyLine, InternAccuracyLine } from "../types";
import styles from "./Board.module.css";

function formatPct(pct: number | null): string {
  return pct === null ? "—" : `${Math.round(pct * 100)}%`;
}

function LineRow({ label, line, secondary }: { label: string; line: AccuracyLine; secondary?: string }) {
  if (line.total === 0) {
    return (
      <div className={styles.row}>
        <span className={styles.label}>{label}</span>
        <span className={styles.noData}>No picks yet</span>
      </div>
    );
  }

  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <span className={styles.headline}>{formatPct(line.accuracyPct)}</span>
      <span className={styles.detail}>
        {line.correct}/{line.total} correct
        {secondary ? ` · ${secondary}` : ""}
      </span>
    </div>
  );
}

// Always renders all three lines (docs/user-flows.md). The intern's
// headline number is its winrate across ALL its picks -- with only a
// handful of the owner's own picks to compare against, the head-to-head
// number (fights both picked) stays too thin to headline for a long
// while, so it moves to the secondary line as context. The PRD calls
// head-to-head the like-for-like comparison and it still is -- it's just
// not the number worth showing biggest this early.
export function AccuracyBoard({
  me,
  intern,
  chalk,
}: {
  me: AccuracyLine;
  intern: InternAccuracyLine;
  chalk: AccuracyLine;
}) {
  const internSecondary =
    intern.headToHead.total > 0
      ? `${formatPct(intern.headToHead.accuracyPct)} on fights you also picked (${intern.headToHead.correct}/${intern.headToHead.total})`
      : "no shared picks with you yet";

  return (
    <section className={styles.board}>
      <h2 className={styles.title}>Accuracy</h2>
      <p className={styles.subtitle}>Did I read the fights right?</p>
      <LineRow label="Me" line={me} />
      <LineRow label="Intern" line={intern} secondary={intern.total > 0 ? internSecondary : undefined} />
      <LineRow label="Chalk" line={chalk} />
    </section>
  );
}
