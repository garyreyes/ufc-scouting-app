import type { FighterScoutingReport } from "../types";
import { updateFighterReport, deleteFighterReport } from "../actions";
import { AuthorReportGroup, type ReportGroupEntry } from "./AuthorReportGroup";
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

  const groups = new Map<
    string,
    { authorName: string | null; isOwn: boolean; entries: ReportGroupEntry[] }
  >();
  for (const report of reports) {
    const entry: ReportGroupEntry = {
      id: report.id,
      body: report.body,
      visibility: report.visibility,
      updateAction: updateFighterReport.bind(null, report.id, redirectPath),
      deleteAction: deleteFighterReport.bind(null, report.id, redirectPath),
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
