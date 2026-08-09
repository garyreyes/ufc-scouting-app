import type { Fighter } from "../types";
import { FighterCard } from "./FighterCard";
import styles from "./FighterGrid.module.css";

export function FighterGrid({ fighters }: { fighters: Fighter[] }) {
  if (fighters.length === 0) {
    return <p className={styles.empty}>No fighters found.</p>;
  }

  return (
    <div className={styles.grid}>
      {fighters.map((fighter) => (
        <FighterCard key={fighter.id} fighter={fighter} />
      ))}
    </div>
  );
}
