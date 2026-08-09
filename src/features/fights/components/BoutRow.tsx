import Link from "next/link";
import type { FightWithFighters } from "../types";
import styles from "./BoutRow.module.css";

export function BoutRow({ fight }: { fight: FightWithFighters }) {
  return (
    <div className={styles.row}>
      <span className={styles.weightClass}>{fight.weight_class ?? "—"}</span>
      <div className={styles.matchup}>
        <FighterName fighter={fight.fighter1} isWinner={fight.winner_id === fight.fighter1.id} />
        <span className={styles.vs}>vs</span>
        <FighterName fighter={fight.fighter2} isWinner={fight.winner_id === fight.fighter2.id} />
      </div>
      <span className={styles.result}>
        {fight.method ? `${fight.method}${fight.round ? ` · R${fight.round}` : ""}` : "Upcoming"}
      </span>
      <Link href={`/fights/${fight.id}`} className={styles.reportsLink}>
        Scouting reports →
      </Link>
    </div>
  );
}

function FighterName({
  fighter,
  isWinner,
}: {
  fighter: { id: string; name: string };
  isWinner: boolean;
}) {
  return (
    <Link href={`/fighters/${fighter.id}`} className={`${styles.fighter} ${isWinner ? styles.winner : ""}`}>
      {fighter.name}
    </Link>
  );
}
