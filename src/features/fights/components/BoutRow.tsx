import Link from "next/link";
import { QuickPick } from "@/features/picks/components/QuickPick";
import { BetRow } from "@/features/picks/components/BetRow";
import { RumourBadge } from "@/features/rumours/components/RumourBadge";
import { RumourOutcomeMarking } from "@/features/rumours/components/RumourOutcomeMarking";
import type { RumourFlagSummary } from "@/features/rumours/types";
import type { InternPickSummary, MyPick } from "@/features/picks/types";
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
  internPick,
  locked,
  disputed,
  rumourFlags,
}: {
  fight: CardBout;
  viewerState: CardViewerState;
  myPick: MyPick | null;
  internPick: InternPickSummary | null;
  locked: boolean;
  disputed: boolean;
  rumourFlags: RumourFlagSummary[];
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
          fightId={fight.id}
          flags={rumourFlags.filter((f) => f.fighterId === fight.fighter1.id)}
        />
        <span className={styles.vs}>vs</span>
        <FighterName
          fighter={fight.fighter2}
          isWinner={fight.winner_id === fight.fighter2.id}
          price={fight.odds?.fighter2_price ?? null}
          fightId={fight.id}
          flags={rumourFlags.filter((f) => f.fighterId === fight.fighter2.id)}
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
          {internPick && (
            <p className={styles.internPick}>
              Intern: {internPick.predictedFighterId === fight.fighter1.id ? fight.fighter1.name : fight.fighter2.name}{" "}
              ({Math.round(internPick.estimatedProbability * 100)}%, confidence {internPick.confidence}/5)
            </p>
          )}
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

      {/* UC-5: only once the fight has settled -- "was this real" has no
          answer before then. winner_id, not a separate settled flag: the
          settlement job always sets both together (settleFights.ts), and
          this is the same signal the row's own "Final"/"Upcoming" label
          above already uses. markRumourOutcomeAction re-checks settled_at
          server-side regardless -- this is just the UI gate. */}
      {viewerState === "owner" && fight.winner_id !== null && rumourFlags.length > 0 && (
        <div className={styles.rumourOutcomeArea}>
          <RumourOutcomeMarking
            flags={rumourFlags}
            fighterNameById={
              new Map([
                [fight.fighter1.id, fight.fighter1.name],
                [fight.fighter2.id, fight.fighter2.name],
              ])
            }
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
  fightId,
  flags,
}: {
  fighter: { id: string; name: string };
  isWinner: boolean;
  price: number | null;
  fightId: string;
  flags: RumourFlagSummary[];
}) {
  return (
    <span className={styles.fighterWithPrice}>
      <Link href={`/fighters/${fighter.id}`} className={`${styles.fighter} ${isWinner ? styles.winner : ""}`}>
        {fighter.name}
      </Link>
      <span className={styles.price}>{price !== null ? price.toFixed(2) : "Unpriced"}</span>
      <RumourBadge fightId={fightId} flags={flags} />
    </span>
  );
}
