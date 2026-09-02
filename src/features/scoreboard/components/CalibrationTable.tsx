import type { CalibrationBucket } from "../types";
import styles from "./CalibrationTable.module.css";

function formatPct(pct: number | null): string {
  return pct === null ? "—" : `${Math.round(pct * 100)}%`;
}

function formatCell(bucket: CalibrationBucket | undefined): string {
  if (!bucket || bucket.count === 0) return "—";
  return `${formatPct(bucket.actualPct)} actual (${formatPct(bucket.avgEstimatedPct)} claimed) · ${bucket.count}`;
}

/**
 * G3's calibration check (ROADMAP.md): "of the fights called 70%, did
 * roughly 70% happen?" Every band from computeCalibrationBuckets always
 * renders, even at 0 -- same "a line that disappears when it has no data
 * reads as a bug" rule the two boards above already apply, extended here
 * to bands instead of lines. No chalk column: chalk has no independent
 * probability estimate of its own to check, only a fixed strategy
 * (always the favourite), so there is nothing here for it to be
 * calibrated against.
 *
 * The page's existing small-sample notice (above the two boards) already
 * covers this table too -- it isn't repeated here.
 */
export function CalibrationTable({ me, intern }: { me: CalibrationBucket[]; intern: CalibrationBucket[] }) {
  const internByLabel = new Map(intern.map((b) => [b.label, b]));
  const hasAnyData = me.some((b) => b.count > 0) || intern.some((b) => b.count > 0);

  return (
    <section className={styles.section}>
      <h2 className={styles.title}>Calibration</h2>
      <p className={styles.subtitle}>Of the fights called at each band, how many actually happened that way?</p>

      {!hasAnyData ? (
        <p className={styles.empty}>No scored picks yet.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={styles.caption}>
              Actual result rate against the average probability claimed within each band
            </caption>
            <thead>
              <tr>
                <th>Called</th>
                <th>Me</th>
                <th>Intern</th>
              </tr>
            </thead>
            <tbody>
              {me.map((meBucket) => (
                <tr key={meBucket.label}>
                  <td>{meBucket.label}</td>
                  <td>{formatCell(meBucket)}</td>
                  <td>{formatCell(internByLabel.get(meBucket.label))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
