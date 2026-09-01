import type { AccuracyLine, InternAccuracyLine } from "../types";
import styles from "./Board.module.css";

function formatPct(pct: number | null): string {
  return pct === null ? "—" : `${Math.round(pct * 100)}%`;
}

function LineRow({ label, line, secondary }: { label: string; line: AccuracyLine; secondary?: string }) {
  // A true "nothing at all" state -- no headline number AND no secondary
  // context worth showing (e.g. the intern has zero picks of any kind
  // yet, before Phase G ships). Distinct from "zero head-to-head overlap
  // but real full-card data exists", which must still surface that data
  // rather than silently dropping it.
  if (line.total === 0 && !secondary) {
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
      <span className={styles.headline}>{line.total === 0 ? "No shared picks yet" : formatPct(line.accuracyPct)}</span>
      <span className={styles.detail}>
        {line.total > 0 ? `${line.correct}/${line.total} correct` : "—"}
        {secondary ? ` · ${secondary}` : ""}
      </span>
    </div>
  );
}

// Always renders all three lines (docs/user-flows.md), even before Phase
// G ships real intern picks. The intern's own line shows head-to-head
// (fights the owner also picked -- the PRD's headline comparison) as the
// primary number, with full-card accuracy folded in as secondary context
// once there's enough data on both to be worth showing.
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
    intern.total > 0 ? `${formatPct(intern.accuracyPct)} full-card (${intern.correct}/${intern.total})` : undefined;

  return (
    <section className={styles.board}>
      <h2 className={styles.title}>Accuracy</h2>
      <p className={styles.subtitle}>Did I read the fights right?</p>
      <LineRow label="Me" line={me} />
      <LineRow label="Intern" line={intern.headToHead} secondary={internSecondary} />
      <LineRow label="Chalk" line={chalk} />
    </section>
  );
}
