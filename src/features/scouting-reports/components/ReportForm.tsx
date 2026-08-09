"use client";

import { useState } from "react";
import { createReport } from "../actions";
import type { ReportVisibility } from "../types";
import styles from "./ReportForm.module.css";

export function ReportForm({
  fightId,
  clans,
}: {
  fightId: string;
  clans: { id: string; name: string }[];
}) {
  const [visibility, setVisibility] = useState<ReportVisibility>("PRIVATE");

  return (
    <form action={createReport} className={styles.form}>
      <input type="hidden" name="fightId" value={fightId} />
      <textarea
        name="body"
        placeholder="What did you see? Why did they win or lose?"
        required
        rows={4}
        className={styles.textarea}
      />
      <div className={styles.row}>
        <select
          name="visibility"
          value={visibility}
          onChange={(event) => setVisibility(event.target.value as ReportVisibility)}
          className={styles.select}
        >
          <option value="PRIVATE">Only me</option>
          <option value="ALL_MY_CLANS">All my clans</option>
          <option value="SPECIFIC_CLANS">Specific clans</option>
        </select>
        <button type="submit" className={styles.submit}>
          Post report
        </button>
      </div>
      {visibility === "SPECIFIC_CLANS" && (
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
    </form>
  );
}
