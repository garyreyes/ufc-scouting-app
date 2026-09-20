import { getCardReadiness } from "../api";
import styles from "./CardReadinessPanel.module.css";

/**
 * P9 (ROADMAP_V2.md Phase P): "the number to look at before every card" --
 * turns "the data is accurate" from a hope into something read in three
 * seconds. Lives on /events/upcoming, not global AppShell chrome like
 * JobHealthBanner: that banner is a degraded-only alert meant to
 * disappear on a healthy day, but this panel is meant to be checked
 * every time regardless of health, so it belongs on the one page a
 * before-a-card visit actually lands on (docs/PRD.md UC-1), not on every
 * screen in the app.
 *
 * Renders nothing when there's no upcoming card (getCardReadiness
 * returns null) or when the read itself fails -- same "never the reason
 * the rest of the page goes down" posture as JobHealthBanner's
 * getBannerReasons.
 */
export async function CardReadinessPanel() {
  const readiness = await getCardReadiness().catch(() => null);
  if (!readiness) return null;

  const fightsPending = readiness.fightsTotal - readiness.fightsPriced;
  const fightersUnresolved = readiness.fightersTotal - readiness.fightersSherdogLinked;

  return (
    <div className={styles.panel}>
      <div className={styles.heading}>
        <span className={styles.eventName}>{readiness.eventName}</span>
        <span className={styles.daysUntil}>{formatDaysUntil(readiness.daysUntil)}</span>
      </div>
      <div className={styles.rows}>
        <div className={styles.row}>
          <span className={styles.label}>fights priced</span>
          <span>
            {readiness.fightsPriced} / {readiness.fightsTotal}
            {fightsPending > 0 && (
              <span className={styles.note}> ⚠ {fightsPending} pending (normal before T-12h)</span>
            )}
          </span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>fighters Sherdog-linked</span>
          <span>
            {readiness.fightersSherdogLinked} / {readiness.fightersTotal}
            {fightersUnresolved > 0 && (
              <span className={styles.note}> ⚠ {fightersUnresolved} unresolved</span>
            )}
          </span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>open conflicts</span>
          <span>{readiness.openConflicts}</span>
        </div>
      </div>
    </div>
  );
}

function formatDaysUntil(daysUntil: number): string {
  if (daysUntil === 0) return "today";
  if (daysUntil === 1) return "tomorrow";
  if (daysUntil > 0) return `T-${daysUntil}d`;
  return `${Math.abs(daysUntil)}d ago`;
}
