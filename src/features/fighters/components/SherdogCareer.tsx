import type { Fighter, SherdogBout } from "../types";
import styles from "./SherdogCareer.module.css";

const RESULT_LABEL: Record<SherdogBout["result"], string> = {
  win: "Win",
  loss: "Loss",
  draw: "Draw",
  nc: "NC",
  unknown: "—",
};

function resultClass(result: SherdogBout["result"]): string {
  if (result === "win") return styles.win;
  if (result === "loss") return styles.loss;
  return styles.other;
}

function formatYear(date: string | null): string {
  return date ? date.slice(0, 4) : "";
}

function finishLine(fighter: Fighter): string | null {
  const w = [fighter.sherdog_wins_by_ko, fighter.sherdog_wins_by_sub, fighter.sherdog_wins_by_dec];
  const l = [fighter.sherdog_losses_by_ko, fighter.sherdog_losses_by_sub, fighter.sherdog_losses_by_dec];
  if (w.some((n) => n === null) || l.some((n) => n === null)) return null;
  return (
    `Wins: ${w[0]} KO/TKO · ${w[1]} sub · ${w[2]} dec` +
    `  —  Losses: ${l[0]} KO/TKO · ${l[1]} sub · ${l[2]} dec`
  );
}

/**
 * J4: the fighter's full career as Sherdog records it, shown alongside
 * (not merged into) the app's own Fight History. This is where the
 * pre-2022 and regional bouts the "Fight History" note warns are missing
 * actually live.
 */
export function SherdogCareer({ fighter, bouts }: { fighter: Fighter; bouts: SherdogBout[] }) {
  if (bouts.length === 0) return null;

  const finish = finishLine(fighter);

  return (
    <section>
      <h2>Full Career (Sherdog)</h2>
      {finish && <p className={styles.finishSplit}>{finish}</p>}
      <p className={styles.sourceNote}>
        Complete professional record from Sherdog, including bouts before this app started tracking.
        Opponent and event names are as Sherdog lists them.
      </p>
      <div className={styles.list}>
        {bouts.map((b) => (
          <div key={b.bout_order} className={styles.row}>
            <span className={`${styles.result} ${resultClass(b.result)}`}>{RESULT_LABEL[b.result]}</span>
            <div className={styles.details}>
              <span className={styles.opponent}>vs {b.opponent_name}</span>
              <span className={styles.event}>
                {[b.event_name, formatYear(b.event_date)].filter(Boolean).join(" · ")}
              </span>
            </div>
            <span className={styles.method}>
              {b.method}
              {b.round ? ` · R${b.round}` : ""}
              {b.bout_time ? ` ${b.bout_time}` : ""}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
