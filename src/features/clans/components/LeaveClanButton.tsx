"use client";

import { leaveClan } from "../actions";
import styles from "./LeaveClanButton.module.css";

export function LeaveClanButton({ clanId }: { clanId: string }) {
  return (
    <button
      type="button"
      className={styles.button}
      onClick={() => {
        if (confirm("Leave this clan?")) leaveClan(clanId);
      }}
    >
      Leave clan
    </button>
  );
}
