import { notFound } from "next/navigation";
import { getFighterById } from "@/features/fighters/api";
import { FightHistoryRow } from "@/features/fighters/components/FightHistoryRow";
import { getReportsForFighter } from "@/features/scouting-reports/api";
import { getMyClans } from "@/features/clans/api";
import { createClient } from "@/lib/supabase/server";
import { FighterReportColumn } from "@/features/scouting-reports/components/FighterReportColumn";
import { formatRecord } from "@/shared/utils/formatRecord";
import styles from "./page.module.css";

export default async function FighterProfilePage({ params }: PageProps<"/fighters/[id]">) {
  const { id } = await params;
  const result = await getFighterById(id);
  if (!result) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Same reasoning as the fight detail page -- fighter_scouting_reports
  // has no anon grant, so skip the query for logged-out visitors.
  const [reports, clans] = user
    ? await Promise.all([getReportsForFighter(id), getMyClans()])
    : [[], []];

  const { fighter, fights } = result;

  // Placeholder fighters synced from Wikipedia (upcoming fights only, no
  // API-Sports profile yet) have no weight_class of their own -- fall back
  // to their most recent fight's weight class rather than showing
  // "Unknown" when we already know it from the card below.
  const mostRecentFight = [...fights].sort((a, b) =>
    b.event.event_date.localeCompare(a.event.event_date),
  )[0];
  const weightClass = fighter.weight_class ?? mostRecentFight?.weight_class ?? null;

  return (
    <div>
      <h1>{fighter.name}</h1>
      <dl className={styles.stats}>
        <Stat label="Weight class" value={weightClass ?? "Unknown"} />
        <Stat label="Height" value={fighter.height_cm ? `${fighter.height_cm} cm` : "Unknown"} />
        <Stat label="Reach" value={fighter.reach_cm ? `${fighter.reach_cm} cm` : "Unknown"} />
        <Stat label="Stance" value={fighter.stance ?? "Unknown"} />
        {/* The stored, derived record (I5) rather than a count taken over
            the fight list below. The two would usually agree, but the
            stored one is the only version that applies the shared
            exclusion rules -- a No Contest counts as nothing, an
            uninterpretable void is skipped rather than guessed, and a
            fight whose winner matches neither fighter is dropped. Counting
            here would quietly re-decide all three. */}
        <Stat label="Record" value={formatRecord(fighter)} />
      </dl>
      <p className={styles.recordNote}>
        Record counts only fights this app tracks (2022 onward, thinner before 2025) — not a full
        career total.
      </p>

      <h2>Fight History</h2>
      {fights.length === 0 ? (
        <p className={styles.empty}>No fights on record.</p>
      ) : (
        <div className={styles.history}>
          {fights.map((fight) => (
            <FightHistoryRow key={fight.id} fight={fight} fighterId={fighter.id} />
          ))}
        </div>
      )}

      <h2 className={styles.reportsHeading}>Scouting Notes</h2>
      {user ? (
        <FighterReportColumn
          fighterId={fighter.id}
          fighterName={fighter.name}
          redirectPath={`/fighters/${fighter.id}`}
          reports={reports}
          currentUserId={user.id}
          clans={clans}
          linkToProfile={false}
        />
      ) : (
        <p className={styles.empty}>Sign in to read and write scouting notes.</p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <dt className={styles.statLabel}>{label}</dt>
      <dd className={styles.statValue}>{value}</dd>
    </div>
  );
}
