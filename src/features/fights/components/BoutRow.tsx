import Link from "next/link";
import { QuickPick } from "@/features/picks/components/QuickPick";
import { BetRow } from "@/features/picks/components/BetRow";
import type { MyPick } from "@/features/picks/types";
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
  myPick: MyPick | null;
  locked: boolean;
  disputed: boolean;
}) {
  // C4's bet row is additive on top of a quick pick, and only makes sense
  // once the fight is priced -- ROADMAP.md ordering constraint #5, "the
  // odds snapshot precedes the expanded bet row, which is built around
  // implied probability and live edge." Before that, only the note below
  // hints betting is coming, and only once a pick already exists --
  // an unpriced fight three weeks out doesn't need every row cluttered
  // with a state that isn't relevant yet.
  const canShowBetRow = !locked && !disputed && myPick !== null;

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
        {fight.method
          ? `${fight.method}${fight.round ? ` · R${fight.round}` : ""}`
          : // A fight can settle on api_sports alone after the 24h single-
            // source timeout (lib/settlement/), which never carries method/
            // round -- winner_id is set with no method in that case, distinct
            // from a genuinely upcoming fight (neither is set).
            fight.winner_id !== null
            ? "Final"
            : "Upcoming"}
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
          {canShowBetRow &&
            (fight.odds !== null ? (
              <BetRow
                fightId={fight.id}
                fighter1={fight.fighter1}
                fighter2={fight.fighter2}
                odds={fight.odds}
                myPick={myPick}
              />
            ) : (
              <p className={styles.betPending}>Betting opens once priced (T-12h before the card).</p>
            ))}
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
