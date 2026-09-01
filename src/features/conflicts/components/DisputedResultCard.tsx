import type { DisputedResultDisplay } from "../types";
import styles from "./ConflictCard.module.css";

/**
 * Two sources disagree about what happened (lib/settlement/'s D1 settle
 * job) -- either they reported different winners, or Wikipedia reported
 * a draw/No Contest while api_sports reported a clear winner. Read-only
 * for now: most of these self-resolve the same way disputed_opponent
 * rows do (the next twice-daily sync run finds the sources now agree,
 * and the settle job simply settles it then), so a manual "pick the
 * winner" action is a well-scoped later add if it turns out to be
 * genuinely needed, not a gap in this pass. See ROADMAP.md D1.
 */
export function DisputedResultCard({ conflict }: { conflict: DisputedResultDisplay }) {
  return (
    <div className={styles.card}>
      <div className={styles.kindLabel}>Disputed result</div>
      <div className={styles.eventMeta}>
        {conflict.eventName} · {conflict.eventDate}
      </div>
      <div className={styles.eventMeta}>
        {conflict.fighter1Name} vs {conflict.fighter2Name}
      </div>
      <div className={styles.options}>
        <div className={styles.optionButton}>
          Wikipedia: {conflict.wikipediaWinnerName ?? "No winner (draw/NC)"}
          <span className={styles.optionHint}>
            {conflict.wikipediaMethod}
            {conflict.wikipediaRound ? ` · R${conflict.wikipediaRound}` : ""}
          </span>
        </div>
        <div className={styles.optionButton}>
          API-Sports: {conflict.apiSportsWinnerName ?? "No report"}
        </div>
      </div>
      <p className={styles.noCandidates}>
        No manual override yet -- this clears automatically once the sources agree on a later sync.
      </p>
    </div>
  );
}
