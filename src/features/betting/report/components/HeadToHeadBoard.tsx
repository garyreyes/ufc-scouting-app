import type { RoiLine } from "@/lib/scoring/aggregateRoiLine";
import type { UnitsLine } from "@/lib/scoring/aggregateUnitsLine";
import type { HeadToHeadPair } from "@/lib/scoring/buildBettingHeadToHead";
import styles from "./ReportBoard.module.css";
import pairStyles from "./HeadToHeadBoard.module.css";

function formatPhp(amountPhp: number): string {
  const sign = amountPhp > 0 ? "+" : "";
  return `${sign}₱${amountPhp.toFixed(2)}`;
}

function formatUnits(units: number): string {
  const sign = units > 0 ? "+" : "";
  return `${sign}${units.toFixed(2)}u`;
}

// The owner bet real pesos, INTERN only ever "bets" units -- so this board
// deliberately shows each side in its own native currency rather than
// forcing one conversion, the same way the rest of the app never invents
// a PHP figure for INTERN.
export function HeadToHeadBoard({
  owner,
  intern,
  pairs,
}: {
  owner: RoiLine;
  intern: UnitsLine;
  pairs: (HeadToHeadPair & { fightLabel: string })[];
}) {
  if (pairs.length === 0) {
    return (
      <section className={styles.board}>
        <h2 className={styles.title}>Intern head-to-head</h2>
        <p className={styles.subtitle}>On fights you both had a position on</p>
        <div className={styles.row}>
          <span className={styles.noData}>
            No overlap yet -- no settled single-leg moneyline slip lands on a fight Intern also picked.
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.board}>
      <h2 className={styles.title}>Intern head-to-head</h2>
      <p className={styles.subtitle}>
        {pairs.length} fight{pairs.length === 1 ? "" : "s"} you both had a position on
        -- straight moneyline bets only, so it&apos;s the same bet on both sides.
      </p>
      <div className={styles.row}>
        <span className={styles.label}>You</span>
        <span className={styles.headline}>{formatPhp(owner.netPhp)}</span>
        <span className={styles.detail}>
          {owner.betsWon}W-{owner.betsLost}L{owner.betsVoided > 0 ? `-${owner.betsVoided}V` : ""}
        </span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Intern</span>
        <span className={styles.headline}>{formatUnits(intern.netUnits)}</span>
        <span className={styles.detail}>
          {intern.betsWon}W-{intern.betsLost}L{intern.betsVoided > 0 ? `-${intern.betsVoided}V` : ""}
        </span>
      </div>
      <ul className={pairStyles.pairList}>
        {pairs.map((pair) => (
          <li key={pair.fightId} className={pairStyles.pairRow}>
            <span className={pairStyles.pairFight}>{pair.fightLabel}</span>
            <span className={pairStyles.pairOwner}>{formatPhp(pair.owner.pnlPhp)}</span>
            <span className={pairStyles.pairIntern}>
              {pair.intern.pnlUnits === null ? "—" : formatUnits(pair.intern.pnlUnits)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
