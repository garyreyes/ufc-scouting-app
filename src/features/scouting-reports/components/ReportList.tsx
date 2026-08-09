import type { ScoutingReport } from "../types";
import { updateReport, deleteReport } from "../actions";
import { AuthorReportGroup, type ReportGroupEntry } from "./AuthorReportGroup";
import styles from "./ReportList.module.css";

export function ReportList({
  reports,
  currentUserId,
  clans,
}: {
  reports: ScoutingReport[];
  currentUserId: string | null;
  clans: { id: string; name: string }[];
}) {
  if (reports.length === 0) {
    return <p className={styles.empty}>No scouting reports yet.</p>;
  }

  const groups = new Map<
    string,
    { authorName: string | null; isOwn: boolean; entries: ReportGroupEntry[] }
  >();
  for (const report of reports) {
    const entry: ReportGroupEntry = {
      id: report.id,
      body: report.body,
      visibility: report.visibility,
      updateAction: updateReport.bind(null, report.id, report.fight_id),
      deleteAction: deleteReport.bind(null, report.id, report.fight_id),
    };
    const existing = groups.get(report.user_id);
    if (existing) {
      existing.entries.push(entry);
    } else {
      groups.set(report.user_id, {
        authorName: report.author_name,
        isOwn: report.user_id === currentUserId,
        entries: [entry],
      });
    }
  }

  return (
    <div className={styles.list}>
      {Array.from(groups.entries()).map(([userId, group]) => (
        <AuthorReportGroup
          key={userId}
          authorName={group.authorName}
          isOwn={group.isOwn}
          entries={group.entries}
          clans={clans}
        />
      ))}
    </div>
  );
}
