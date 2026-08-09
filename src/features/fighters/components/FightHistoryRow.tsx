import Link from "next/link";
import type { FighterFightHistoryEntry } from "../types";
import styles from "./FightHistoryRow.module.css";

export function FightHistoryRow({
  fight,
  fighterId,
}: {
  fight: FighterFightHistoryEntry;
  fighterId: string;
}) {
  const opponent = fight.fighter1.id === fighterId ? fight.fighter2 : fight.fighter1;
  const outcome = !fight.winner_id
    ? "Upcoming"
    : fight.winner_id === fighterId
      ? "Win"
      : "Loss";

  return (
    <Link href={`/fights/${fight.id}`} className={styles.row}>
      <span className={`${styles.outcome} ${styles[outcome.toLowerCase()]}`}>{outcome}</span>
      <div className={styles.details}>
        <span className={styles.opponent}>vs {opponent.name}</span>
        <span className={styles.event}>
          {fight.event.name} · {fight.weight_class ?? "—"}
        </span>
      </div>
      <span className={styles.method}>
        {fight.method ? `${fight.method}${fight.round ? ` · R${fight.round}` : ""}` : ""}
      </span>
    </Link>
  );
}
