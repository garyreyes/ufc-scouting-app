import type { RoiLine } from "@/lib/scoring/aggregateRoiLine";
import type { ArchetypeRoiRow } from "../../reportApi";
import styles from "./ReportBoard.module.css";

const ARCHETYPE_LABELS: Record<ArchetypeRoiRow["archetype"], string> = {
  SAFE_PARLAY: "Safe parlay",
  STRAIGHT_DOG: "Straight dog",
  LONGSHOT: "Longshot",
  METHOD_VALUE: "Method value",
  LOCK: "Lock",
  OTHER: "Other",
};

function formatPhp(amountPhp: number): string {
  const sign = amountPhp > 0 ? "+" : "";
  return `${sign}₱${amountPhp.toFixed(2)}`;
}

function formatRoi(roiPct: number | null): string {
  if (roiPct === null) return "—";
  const sign = roiPct > 0 ? "+" : "";
  return `${sign}${roiPct.toFixed(1)}%`;
}

function ArchetypeRow({ label, line }: { label: string; line: RoiLine }) {
  if (line.betsPlaced === 0) {
    return (
      <div className={styles.row}>
        <span className={styles.label}>{label}</span>
        <span className={styles.noData}>No settled bets yet</span>
      </div>
    );
  }

  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <span className={styles.headline}>{formatRoi(line.roiPct)}</span>
      <span className={styles.detail}>
        {formatPhp(line.netPhp)} net · {line.betsWon}W-{line.betsLost}L
        {line.betsVoided > 0 ? `-${line.betsVoided}V` : ""} · {line.betsPlaced} bet
        {line.betsPlaced === 1 ? "" : "s"}
      </span>
    </div>
  );
}

// Every archetype renders, even at zero bets (matches UnitsBoard's own
// rule) -- an archetype the owner hasn't used reads as "no bets", not as
// a silently missing row.
export function ArchetypeRoiBoard({ overall, byArchetype }: { overall: RoiLine; byArchetype: ArchetypeRoiRow[] }) {
  return (
    <section className={styles.board}>
      <h2 className={styles.title}>ROI by archetype</h2>
      <p className={styles.subtitle}>Which kind of bet actually earns?</p>
      <ArchetypeRow label="All" line={overall} />
      {byArchetype.map((row) => (
        <ArchetypeRow key={row.archetype} label={ARCHETYPE_LABELS[row.archetype]} line={row.line} />
      ))}
    </section>
  );
}
