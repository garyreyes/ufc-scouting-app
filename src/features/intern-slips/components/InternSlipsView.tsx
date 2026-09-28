import { ArchetypeRoiBoard } from "@/features/betting/report/components/ArchetypeRoiBoard";
import { BankrollCurveChart } from "@/features/betting/report/components/BankrollCurveChart";
import { SLIP_TYPE_LABELS } from "../types";
import type { InternCardView, InternSlipsPageData } from "../types";
import { SlipCard, formatPhp } from "./SlipCard";
import styles from "./InternSlips.module.css";

function lockText(startsAt: string | null, locked: boolean): string {
  if (locked) return "Locked — the Intern's slate is final for this card.";
  if (startsAt === null) return "Rebuilds every 2 hours until the start time is confirmed.";
  const lockAt = new Date(new Date(startsAt).getTime() - 6 * 60 * 60 * 1000);
  const when = lockAt.toLocaleString("en-PH", { weekday: "short", hour: "numeric", minute: "2-digit" });
  return `Rebuilds every 2 hours as odds and picks move · locks ${when}. Estimated method prices can be replaced with your book's price until then.`;
}

function BankrollHeader({ data }: { data: InternSlipsPageData }) {
  const net = data.balancePhp - data.openingPhp;
  const roi = data.overall.roiPct;
  return (
    <section className={styles.bankroll}>
      <span className={styles.balance}>{formatPhp(data.balancePhp)}</span>
      <span className={styles.balanceDetail}>
        {formatPhp(net, true)} since the {formatPhp(data.openingPhp)} start
        {data.overall.betsPlaced > 0 &&
          ` · ${data.overall.betsWon}W-${data.overall.betsLost}L · ROI ${roi === null ? "—" : `${roi > 0 ? "+" : ""}${roi.toFixed(1)}%`} on ${formatPhp(data.overall.stakedPhp)} staked`}
      </span>
    </section>
  );
}

function UpcomingCard({ card }: { card: NonNullable<InternSlipsPageData["upcoming"]> }) {
  return (
    <section className={styles.section}>
      <h2>{card.eventName}</h2>
      <p className={styles.sectionMeta}>{lockText(card.startsAt, card.locked)}</p>
      {card.slips.length === 0 ? (
        <p className={styles.empty}>
          No slate yet. The Intern builds it once this card is priced — odds land about 12 hours before the first
          fight.
        </p>
      ) : (
        <>
          <p className={styles.sectionMeta}>
            {formatPhp(card.stakedPhp)} across {card.slips.length} slip{card.slips.length === 1 ? "" : "s"}
          </p>
          <div className={styles.slips}>
            {card.slips.map((slip) => (
              <SlipCard key={slip.id} slip={slip} editable={!card.locked} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function PastCard({ card }: { card: InternCardView }) {
  const settled = card.slips.every((s) => s.status !== "open");
  return (
    <details className={styles.pastCard}>
      <summary>
        <span>{card.eventName}</span>
        <span className={styles.money}>{settled ? formatPhp(card.netPhp, true) : "Settling…"}</span>
      </summary>
      <div className={`${styles.slips} ${styles.pastBody}`}>
        {card.slips.map((slip) => (
          <SlipCard key={slip.id} slip={slip} editable={false} />
        ))}
      </div>
    </details>
  );
}

export function InternSlipsView({ data }: { data: InternSlipsPageData }) {
  return (
    <>
      <BankrollHeader data={data} />

      {data.upcoming ? (
        <UpcomingCard card={data.upcoming} />
      ) : (
        <p className={styles.empty}>No upcoming card on the schedule.</p>
      )}

      <div className={styles.boards}>
        <ArchetypeRoiBoard overall={data.overall} byArchetype={data.byArchetype} labels={SLIP_TYPE_LABELS} />
        <BankrollCurveChart points={data.curve} />
      </div>

      {data.past.length > 0 && (
        <section className={styles.section}>
          <h2>Past cards</h2>
          {data.past.map((card) => (
            <PastCard key={card.eventId} card={card} />
          ))}
        </section>
      )}
    </>
  );
}
