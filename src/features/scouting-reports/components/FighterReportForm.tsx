"use client";

import { useState } from "react";
import { createFighterReport } from "../actions";
import type { ReportVisibility } from "../types";
import styles from "./ReportForm.module.css";

export function FighterReportForm({
  fighterId,
  redirectPath,
  clans,
}: {
  fighterId: string;
  redirectPath: string;
  clans: { id: string; name: string }[];
}) {
  const [visibility, setVisibility] = useState<ReportVisibility>("PRIVATE");

  return (
    <form action={createFighterReport} className={styles.form}>
      <input type="hidden" name="fighterId" value={fighterId} />
      <input type="hidden" name="redirectPath" value={redirectPath} />
      <textarea
        name="body"
        placeholder="What's your read on this fighter? (e.g. good wrestling, weak chin)"
        required
        rows={3}
        maxLength={2000}
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
          Post note
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
