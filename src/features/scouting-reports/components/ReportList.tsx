import type { ScoutingReport } from "../types";
import { DeleteReportButton } from "./DeleteReportButton";
import styles from "./ReportList.module.css";

const VISIBILITY_LABEL: Record<ScoutingReport["visibility"], string> = {
  PRIVATE: "Only me",
  ALL_MY_CLANS: "All my clans",
  SPECIFIC_CLANS: "Specific clans",
};

export function ReportList({
  reports,
  currentUserId,
}: {
  reports: ScoutingReport[];
  currentUserId: string | null;
}) {
  if (reports.length === 0) {
    return <p className={styles.empty}>No scouting reports yet.</p>;
  }

  return (
    <div className={styles.list}>
      {reports.map((report) => (
        <div key={report.id} className={styles.card}>
          <div className={styles.header}>
            <span className={styles.author}>{report.author_name ?? "Unknown"}</span>
            <span className={styles.visibility}>{VISIBILITY_LABEL[report.visibility]}</span>
          </div>
          <p className={styles.body}>{report.body}</p>
          {report.user_id === currentUserId && (
            <DeleteReportButton reportId={report.id} fightId={report.fight_id} />
          )}
        </div>
      ))}
    </div>
  );
}
