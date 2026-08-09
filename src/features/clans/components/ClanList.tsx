import Link from "next/link";
import type { Clan } from "../types";
import styles from "./ClanList.module.css";

export function ClanList({ clans }: { clans: Clan[] }) {
  if (clans.length === 0) {
    return <p className={styles.empty}>You&apos;re not in any clans yet.</p>;
  }

  return (
    <div className={styles.list}>
      {clans.map((clan) => (
        <Link key={clan.id} href={`/clans/${clan.id}`} className={styles.card}>
          {clan.name}
        </Link>
      ))}
    </div>
  );
}
