import Link from "next/link";
import type { Fighter } from "../types";
import styles from "./FighterCard.module.css";

export function FighterCard({ fighter }: { fighter: Fighter }) {
  return (
    <Link href={`/fighters/${fighter.id}`} className={styles.card}>
      <div className={styles.avatar}>{"\u{1F94A}"}</div>
      <div className={styles.name}>{fighter.name}</div>
      <div className={styles.meta}>{fighter.weight_class ?? "Weight class unknown"}</div>
    </Link>
  );
}
