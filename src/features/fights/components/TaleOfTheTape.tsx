import { formatRecord } from "@/shared/utils/formatRecord";
import type { TapeFighter } from "../types";
import styles from "./TaleOfTheTape.module.css";

// One row of the tape.
interface TapeRow {
  label: string;
  left: string | null;
  right: string | null;
  // Whether each side's text is worth showing at all, when that differs
  // from "the text isn't null." Height/Reach/Stance don't need this --
  // there, no data means a genuinely null string. Record and Elo always
  // produce a string ("No tracked fights", "Unrated"), so THEY need an
  // explicit flag to say when that string carries no real information --
  // defaults to `left`/`right` being non-null when omitted.
  leftInformative?: boolean;
  rightInformative?: boolean;
  // Raw comparable values, when the row supports a differential at all.
  // Stance and record are categorical/compound and deliberately have
  // none -- a "+9" next to a record would be inventing a metric.
  leftValue?: number | null;
  rightValue?: number | null;
  unit?: string;
}

/**
 * The fight page's side-by-side comparison (I5, docs/PRD.md should-have).
 *
 * Values come straight off features/fights/api.ts -- this renders and
 * nothing else, per the layer boundary. Every row handles a missing side
 * on its own, because a Wikipedia-only placeholder fighter genuinely has
 * no height, reach, or stance until enrichment reaches them, and that is
 * the state a real first-time visitor hits most often on an upcoming
 * card.
 *
 * A row where BOTH sides carry no real information is dropped entirely
 * rather than rendered as noise -- an empty row costs attention and says
 * nothing. This covers two shapes: Height/Reach/Stance are simply
 * missing (a placeholder fighter enrichment hasn't reached yet), and
 * Record/Elo always produce a STRING ("No tracked fights", "Unrated")
 * but that string is uninformative when neither fighter has one -- two
 * total UFC debutants sharing a card is a real, common case, and
 * "No tracked fights vs No tracked fights" says nothing an empty row
 * wouldn't. One side alone being uninformative is kept, though: "No
 * tracked fights" next to a real 12-3 is a genuine, useful contrast.
 */
export function TaleOfTheTape({
  fighter1,
  fighter2,
}: {
  fighter1: TapeFighter;
  fighter2: TapeFighter;
}) {
  const rows: TapeRow[] = [
    {
      label: "Record",
      left: formatRecord(fighter1),
      right: formatRecord(fighter2),
      leftInformative: hasTrackedRecord(fighter1),
      rightInformative: hasTrackedRecord(fighter2),
    },
    {
      label: "Height",
      left: fighter1.height_cm ? `${fighter1.height_cm} cm` : null,
      right: fighter2.height_cm ? `${fighter2.height_cm} cm` : null,
      leftValue: fighter1.height_cm,
      rightValue: fighter2.height_cm,
      unit: "cm",
    },
    {
      label: "Reach",
      left: fighter1.reach_cm ? `${fighter1.reach_cm} cm` : null,
      right: fighter2.reach_cm ? `${fighter2.reach_cm} cm` : null,
      leftValue: fighter1.reach_cm,
      rightValue: fighter2.reach_cm,
      unit: "cm",
    },
    {
      label: "Stance",
      left: fighter1.stance,
      right: fighter2.stance,
    },
    {
      // Labeled "current" deliberately: this is each fighter's rating
      // TODAY, not their rating as of this particular fight's date.
      // For an upcoming fight that's exactly right -- it's the same
      // number the intern's own reasoning line uses to make its call.
      // For a past fight it is NOT "what determined this result" --
      // fighter_elo_history keeps full history precisely so a future
      // as-of-this-fight view is possible, but building that lookup is
      // its own piece of work, not folded into I5.
      label: "Elo (current)",
      left: formatElo(fighter1),
      right: formatElo(fighter2),
      leftInformative: fighter1.eloRating !== null,
      rightInformative: fighter2.eloRating !== null,
      leftValue: fighter1.eloRating === null ? null : Math.round(fighter1.eloRating),
      rightValue: fighter2.eloRating === null ? null : Math.round(fighter2.eloRating),
    },
  ];

  const visible = rows.filter((row) => {
    const leftInformative = row.leftInformative ?? row.left !== null;
    const rightInformative = row.rightInformative ?? row.right !== null;
    return leftInformative || rightInformative;
  });
  if (visible.length === 0) return null;

  return (
    <section className={styles.tape} aria-label="Tale of the tape">
      <div className={styles.header}>
        <span className={styles.headerName}>{fighter1.name}</span>
        <span className={styles.headerLabel} />
        <span className={`${styles.headerName} ${styles.right}`}>{fighter2.name}</span>
      </div>

      {visible.map((row) => {
        const diff = differential(row);
        return (
          <div key={row.label} className={styles.row}>
            <span className={`${styles.value} ${diff === "left" ? styles.advantage : ""}`}>
              {row.left ?? "—"}
              {diff === "left" && <span className={styles.edge}>{diffLabel(row)}</span>}
            </span>
            <span className={styles.label}>{row.label}</span>
            <span
              className={`${styles.value} ${styles.right} ${diff === "right" ? styles.advantage : ""}`}
            >
              {diff === "right" && <span className={styles.edge}>{diffLabel(row)}</span>}
              {row.right ?? "—"}
            </span>
          </div>
        );
      })}

      <p className={styles.footnote}>
        Records and Elo count only fights this app tracks (2022 onward, thinner before 2025) — not
        full career totals. Elo is each fighter&apos;s rating as of today, not their rating on the
        date of this fight.
      </p>
    </section>
  );
}

// A record of 0-0-0 means nothing countable was found for this fighter
// (deriveFighterRecords.ts omits such a fighter from its map entirely),
// not a real record of zero wins -- see formatRecord.ts. That string
// still needs to be SHOWN (it's genuine information on its own), but it
// must not count as "informative" for the purpose of deciding whether
// the whole row is worth rendering when the other side is equally empty.
function hasTrackedRecord(fighter: TapeFighter): boolean {
  return fighter.wins + fighter.losses + fighter.draws > 0;
}

// The rated-fight count rides along with the rating rather than taking
// its own row: it is the sample size FOR that number, and it is the same
// pairing the intern's own reasoning line quotes, so the tape and the
// intern read identically.
function formatElo(fighter: TapeFighter): string | null {
  if (fighter.eloRating === null) return "Unrated";
  const fights = fighter.ratedFightCount;
  return `${Math.round(fighter.eloRating)} · ${fights} rated`;
}

function differential(row: TapeRow): "left" | "right" | null {
  const { leftValue, rightValue } = row;
  if (leftValue == null || rightValue == null) return null;
  if (leftValue === rightValue) return null;
  return leftValue > rightValue ? "left" : "right";
}

function diffLabel(row: TapeRow): string {
  const gap = Math.abs((row.leftValue ?? 0) - (row.rightValue ?? 0));
  return row.unit ? `+${gap} ${row.unit}` : `+${gap}`;
}
