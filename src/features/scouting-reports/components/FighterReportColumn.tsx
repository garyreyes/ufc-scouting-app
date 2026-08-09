import Link from "next/link";
import type { FighterScoutingReport } from "../types";
import { FighterReportForm } from "./FighterReportForm";
import { FighterReportList } from "./FighterReportList";
import styles from "./FighterReportColumn.module.css";

export function FighterReportColumn({
  fighterId,
  fighterName,
  redirectPath,
  reports,
  currentUserId,
  clans,
  linkToProfile = true,
}: {
  fighterId: string;
  fighterName: string;
  redirectPath: string;
  reports: FighterScoutingReport[];
  currentUserId: string | null;
  clans: { id: string; name: string }[];
  linkToProfile?: boolean;
}) {
  return (
    <div className={styles.column}>
      <h3 className={styles.name}>
        {linkToProfile ? <Link href={`/fighters/${fighterId}`}>{fighterName}</Link> : fighterName}
      </h3>
      {currentUserId && (
        <FighterReportForm fighterId={fighterId} redirectPath={redirectPath} clans={clans} />
      )}
      <FighterReportList
        reports={reports}
        currentUserId={currentUserId}
        redirectPath={redirectPath}
        clans={clans}
      />
    </div>
  );
}
