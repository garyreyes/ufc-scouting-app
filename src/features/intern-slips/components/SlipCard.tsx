import { SLIP_TYPE_HINTS, SLIP_TYPE_LABELS } from "../types";
import type { InternSlipView } from "../types";
import { LegPriceOverride } from "./LegPriceOverride";
import styles from "./InternSlips.module.css";

export function formatPhp(amount: number, signed = false): string {
  const sign = signed && amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}₱${Math.abs(amount).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

function slipProbability(slip: InternSlipView): number | null {
  if (slip.legs.some((l) => l.modelProbability === null)) return null;
  return slip.legs.reduce((p, l) => p * (l.modelProbability as number), 1);
}

function moneyLine(slip: InternSlipView): string {
  if (slip.status === "open") {
    return `${formatPhp(slip.stakePhp)} · pays ${formatPhp(slip.stakePhp * slip.combinedPrice)}`;
  }
  const label = slip.status === "won" ? "Won" : slip.status === "lost" ? "Lost" : "Void";
  return `${label} ${formatPhp(slip.pnlPhp ?? 0, true)}`;
}

export function SlipCard({ slip, editable }: { slip: InternSlipView; editable: boolean }) {
  const probability = slipProbability(slip);
  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <div className={styles.type}>{SLIP_TYPE_LABELS[slip.archetype]}</div>
          <div className={styles.hint}>{SLIP_TYPE_HINTS[slip.archetype]}</div>
        </div>
        <span className={styles.money}>{moneyLine(slip)}</span>
      </div>

      <ul className={styles.legs}>
        {slip.legs.map((leg) => (
          <li key={leg.id} className={styles.leg}>
            <span className={leg.result === "pending" ? undefined : styles[`result_${leg.result}`]}>{leg.detail}</span>
            <span className={styles.legPrice}>
              {leg.price.toFixed(2)}
              {leg.priceSource === "estimated" && <span className={styles.tag}>est.</span>}
              {leg.priceSource === "entered" && <span className={styles.tag}>book</span>}
              {editable && leg.priceSource !== "book" && leg.result === "pending" && (
                <LegPriceOverride legId={leg.id} currentPrice={leg.price} />
              )}
            </span>
          </li>
        ))}
      </ul>

      <div className={styles.foot}>
        @ {slip.combinedPrice.toFixed(2)}
        {probability !== null && ` · Intern gives it ${(probability * 100).toFixed(probability < 0.1 ? 1 : 0)}%`}
      </div>
    </article>
  );
}
