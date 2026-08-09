"use client";

import { useState } from "react";
import type { ReportVisibility } from "../types";
import { ReportEntry } from "./ReportEntry";
import styles from "./AuthorReportGroup.module.css";

export interface ReportGroupEntry {
  id: string;
  body: string;
  visibility: ReportVisibility;
  updateAction: (formData: FormData) => void | Promise<void>;
  deleteAction: () => void | Promise<void>;
}

// All of one author's notes (on the same fighter/fight), collapsed under a
// single row. Grouping (not just per-note collapsing) matters once someone
// writes more than one note -- otherwise their name shows up as several
// separate rows in the list, which is what actually reads as clutter.
export function AuthorReportGroup({
  authorName,
  isOwn,
  entries,
  clans,
}: {
  authorName: string | null;
  isOwn: boolean;
  entries: ReportGroupEntry[];
  clans: { id: string; name: string }[];
}) {
  const [expanded, setExpanded] = useState(false);

  const flatFirstBody = entries[0].body.replace(/\s+/g, " ").trim();
  const preview =
    entries.length > 1
      ? `${entries.length} notes`
      : flatFirstBody.length > 80
        ? `${flatFirstBody.slice(0, 80).trimEnd()}…`
        : flatFirstBody;

  return (
    <div className={styles.group}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
      >
        <span className={styles.chevron} data-expanded={expanded}>
          ▸
        </span>
        <span className={styles.author}>{authorName ?? "Unknown"}</span>
        {!expanded && <span className={styles.preview}>{preview}</span>}
      </button>
      {expanded && (
        <div className={styles.entries}>
          {entries.map((entry) => (
            <ReportEntry
              key={entry.id}
              body={entry.body}
              visibility={entry.visibility}
              isOwn={isOwn}
              clans={clans}
              updateAction={entry.updateAction}
              deleteAction={entry.deleteAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}
