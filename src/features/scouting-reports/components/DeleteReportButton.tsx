"use client";

import { deleteReport } from "../actions";
import styles from "./DeleteReportButton.module.css";

export function DeleteReportButton({ reportId, fightId }: { reportId: string; fightId: string }) {
  return (
    <button
      type="button"
      className={styles.button}
      onClick={() => {
        if (confirm("Delete this report?")) deleteReport(reportId, fightId);
      }}
    >
      Delete
    </button>
  );
}
