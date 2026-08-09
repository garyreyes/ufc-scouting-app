import type { FighterScoutingReport } from "../types";
import { updateFighterReport, deleteFighterReport } from "../actions";
import { ReportCard } from "./ReportCard";
import styles from "./ReportList.module.css";

export function FighterReportList({
  reports,
  currentUserId,
  redirectPath,
  clans,
}: {
  reports: FighterScoutingReport[];
  currentUserId: string | null;
  redirectPath: string;
  clans: { id: string; name: string }[];
}) {
  if (reports.length === 0) {
    return <p className={styles.empty}>No notes yet.</p>;
  }

  return (
    <div className={styles.list}>
      {reports.map((report) => (
        <ReportCard
          key={report.id}
          authorName={report.author_name}
          body={report.body}
          visibility={report.visibility}
          isOwn={report.user_id === currentUserId}
          clans={clans}
          updateAction={updateFighterReport.bind(null, report.id, redirectPath)}
          deleteAction={deleteFighterReport.bind(null, report.id, redirectPath)}
        />
      ))}
    </div>
  );
}
