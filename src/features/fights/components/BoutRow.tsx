import Link from "next/link";
import { QuickPick } from "@/features/picks/components/QuickPick";
import type { MyQuickPick } from "@/features/picks/types";
import type { CardBout } from "../types";
import styles from "./BoutRow.module.css";

// "owner": full interactive row. "read-only": everyone else (logged out,
// or logged in but not the allowlisted owner) -- one shared state, since
// docs/user-flows.md's auth-gate table treats both the same way here
// ("sign-in prompt" and "not available" are both just "no pick controls
// shown"), and Flow 1's diagram never branches conflict-holds or picks
// onto either of those paths.
export type CardViewerState = "owner" | "read-only";

export function BoutRow({
  fight,
  viewerState,
  myPick,
  locked,
  disputed,
}: {
  fight: CardBout;
  viewerState: CardViewerState;
  myPick: MyQuickPick | null;
  locked: boolean;
  disputed: boolean;
}) {
  return (
    <div className={styles.row}>
      <span className={styles.weightClass}>{fight.weight_class ?? "—"}</span>
      <div className={styles.matchup}>
        <FighterName
          fighter={fight.fighter1}
          isWinner={fight.winner_id === fight.fighter1.id}
          price={fight.odds?.fighter1_price ?? null}
        />
        <span className={styles.vs}>vs</span>
        <FighterName
          fighter={fight.fighter2}
          isWinner={fight.winner_id === fight.fighter2.id}
          price={fight.odds?.fighter2_price ?? null}
        />
      </div>
      <span className={styles.result}>
        {fight.method ? `${fight.method}${fight.round ? ` · R${fight.round}` : ""}` : "Upcoming"}
      </span>
      <Link href={`/fights/${fight.id}`} className={styles.reportsLink}>
        Scouting reports →
      </Link>

      {viewerState === "owner" && (
        <div className={styles.pickArea}>
          <QuickPick
            fightId={fight.id}
            fighter1={fight.fighter1}
            fighter2={fight.fighter2}
            existingPick={myPick}
            locked={locked}
            disputed={disputed}
          />
        </div>
      )}
    </div>
  );
}

function FighterName({
  fighter,
  isWinner,
  price,
}: {
  fighter: { id: string; name: string };
  isWinner: boolean;
  price: number | null;
}) {
  return (
    <span className={styles.fighterWithPrice}>
      <Link href={`/fighters/${fighter.id}`} className={`${styles.fighter} ${isWinner ? styles.winner : ""}`}>
        {fighter.name}
      </Link>
      <span className={styles.price}>{price !== null ? price.toFixed(2) : "Unpriced"}</span>
    </span>
  );
}
