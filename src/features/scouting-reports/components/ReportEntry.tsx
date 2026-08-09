"use client";

import { useState } from "react";
import type { ReportVisibility } from "../types";
import styles from "./ReportEntry.module.css";

const VISIBILITY_LABEL: Record<ReportVisibility, string> = {
  PRIVATE: "Only me",
  ALL_MY_CLANS: "All my clans",
  SPECIFIC_CLANS: "Specific clans",
};

// One note inside an AuthorReportGroup. No collapse of its own -- the
// group already decided to show it -- just the edit/display toggle.
export function ReportEntry({
  body,
  visibility,
  isOwn,
  clans,
  updateAction,
  deleteAction,
}: {
  body: string;
  visibility: ReportVisibility;
  isOwn: boolean;
  clans: { id: string; name: string }[];
  updateAction: (formData: FormData) => void | Promise<void>;
  deleteAction: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draftVisibility, setDraftVisibility] = useState(visibility);

  if (editing) {
    return (
      <form
        action={async (formData) => {
          await updateAction(formData);
          setEditing(false);
        }}
        className={styles.editForm}
      >
        <textarea
          name="body"
          defaultValue={body}
          required
          rows={3}
          className={styles.textarea}
        />
        <div className={styles.row}>
          <select
            name="visibility"
            value={draftVisibility}
            onChange={(event) => setDraftVisibility(event.target.value as ReportVisibility)}
            className={styles.select}
          >
            <option value="PRIVATE">Only me</option>
            <option value="ALL_MY_CLANS">All my clans</option>
            <option value="SPECIFIC_CLANS">Specific clans</option>
          </select>
          <div className={styles.editActions}>
            <button type="submit" className={styles.save}>
              Save
            </button>
            <button type="button" className={styles.cancel} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
        {draftVisibility === "SPECIFIC_CLANS" && (
          <div className={styles.clanList}>
            {clans.length === 0 ? (
              <p className={styles.noClans}>You&apos;re not in any clans yet.</p>
            ) : (
              clans.map((clan) => (
                <label key={clan.id} className={styles.clanOption}>
                  <input type="checkbox" name="clanIds" value={clan.id} />
                  {clan.name}
                </label>
              ))
            )}
          </div>
        )}
        <p className={styles.reshareNote}>
          Re-select clans to share with -- editing doesn&apos;t keep the previous selection.
        </p>
      </form>
    );
  }

  return (
    <div className={styles.entry}>
      <span className={styles.visibility}>{VISIBILITY_LABEL[visibility]}</span>
      <p className={styles.body}>{body}</p>
      {isOwn && (
        <div className={styles.ownActions}>
          <button type="button" className={styles.action} onClick={() => setEditing(true)}>
            Edit
          </button>
          <button
            type="button"
            className={styles.action}
            onClick={() => {
              if (confirm("Delete this report?")) deleteAction();
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
