"use client";

import { useId, useMemo, useState } from "react";
import type { BankrollPoint } from "@/lib/scoring/buildBankrollCurve";
import styles from "./BankrollCurveChart.module.css";

const WIDTH = 640;
const HEIGHT = 220;
const PAD_X = 12;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

function formatPhp(amountPhp: number): string {
  return `₱${amountPhp.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

// The one genuinely new UI element this codebase needed for Q5 -- no
// charting library exists here, and a single-series line doesn't need
// one. Single series -> no legend box (the title names it), one hue
// (var(--accent), the app's only brand color, already used nowhere else
// as a status signal -- this codebase reads P&L sign as text, not color,
// so the line doesn't invent a green/red convention the rest of the app
// doesn't have).
export function BankrollCurveChart({ points }: { points: BankrollPoint[] }) {
  const gradientId = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const { path, xForIndex, yForBalance, minBalance, maxBalance, stepWidth } = useMemo(() => {
    if (points.length === 0) {
      return { path: "", xForIndex: () => 0, yForBalance: () => 0, minBalance: 0, maxBalance: 0, stepWidth: WIDTH };
    }
    const balances = points.map((p) => p.balancePhp);
    const min = Math.min(...balances, 0);
    const max = Math.max(...balances, 0);
    const range = max - min || 1;

    const innerWidth = WIDTH - PAD_X * 2;
    const innerHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
    // The actual spacing between adjacent points -- must match the hover
    // hit-rects below exactly, or they leave dead zones between points
    // (or overlap) instead of tiling the chart edge-to-edge.
    const stepWidth = points.length === 1 ? WIDTH : innerWidth / (points.length - 1);
    const xForIndex = (i: number) => PAD_X + (points.length === 1 ? 0 : i * stepWidth);
    const yForBalance = (balance: number) => PAD_TOP + innerHeight - ((balance - min) / range) * innerHeight;

    const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${xForIndex(i)},${yForBalance(p.balancePhp)}`).join(" ");
    return { path, xForIndex, yForBalance, minBalance: min, maxBalance: max, stepWidth };
  }, [points]);

  if (points.length === 0) {
    return (
      <section className={styles.chart}>
        <h2 className={styles.title}>Bankroll</h2>
        <p className={styles.subtitle}>No ledger entries yet</p>
      </section>
    );
  }

  const current = points[points.length - 1];
  const hovered = hoverIndex === null ? null : points[hoverIndex];

  return (
    <section className={styles.chart}>
      <h2 className={styles.title}>Bankroll</h2>
      <p className={styles.subtitle}>{formatPhp(current.balancePhp)} as of {formatDate(current.occurredAt)}</p>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className={styles.svg}
        role="img"
        aria-label={`Bankroll curve from ${formatPhp(minBalance)} to ${formatPhp(maxBalance)}, currently ${formatPhp(current.balancePhp)}`}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line
          x1={PAD_X}
          x2={WIDTH - PAD_X}
          y1={yForBalance(0)}
          y2={yForBalance(0)}
          className={styles.zeroLine}
        />
        <path d={`${path} L${xForIndex(points.length - 1)},${HEIGHT - PAD_BOTTOM} L${PAD_X},${HEIGHT - PAD_BOTTOM} Z`} fill={`url(#${gradientId})`} stroke="none" />
        <path d={path} className={styles.line} strokeLinecap="round" strokeLinejoin="round" />
        {hovered && (
          <>
            <line
              x1={xForIndex(hoverIndex!)}
              x2={xForIndex(hoverIndex!)}
              y1={PAD_TOP}
              y2={HEIGHT - PAD_BOTTOM}
              className={styles.crosshair}
            />
            <circle cx={xForIndex(hoverIndex!)} cy={yForBalance(hovered.balancePhp)} r={4} className={styles.dot} />
          </>
        )}
        {points.map((p, i) => (
          <rect
            key={p.occurredAt + i}
            x={xForIndex(i) - stepWidth / 2}
            y={PAD_TOP}
            width={stepWidth}
            height={HEIGHT - PAD_TOP - PAD_BOTTOM}
            fill="transparent"
            onMouseEnter={() => setHoverIndex(i)}
          />
        ))}
      </svg>
      {hovered && (
        <div className={styles.tooltip}>
          <span className={styles.tooltipDate}>{formatDate(hovered.occurredAt)}</span>
          <span className={styles.tooltipValue}>{formatPhp(hovered.balancePhp)}</span>
        </div>
      )}
    </section>
  );
}
