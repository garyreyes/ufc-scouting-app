import { notFound } from "next/navigation";
import Link from "next/link";
import { getFightById } from "@/features/fights/api";
import { getReportsForFight, getReportsForFighter } from "@/features/scouting-reports/api";
import { getMyClans } from "@/features/clans/api";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/auth";
import { ReportForm } from "@/features/scouting-reports/components/ReportForm";
import { ReportList } from "@/features/scouting-reports/components/ReportList";
import { FighterReportColumn } from "@/features/scouting-reports/components/FighterReportColumn";
import { getRumourFlagsForFight } from "@/features/rumours/api";
import { RumourSection } from "@/features/rumours/components/RumourSection";
import styles from "./page.module.css";

export default async function FightDetailPage({ params }: PageProps<"/fights/[id]">) {
  const { id } = await params;
  const fight = await getFightById(id);
  if (!fight) notFound();

  // Public, same posture as the odds/fight data above it -- rumour_flags/
  // rumour_sources are public-read, and docs/user-flows.md's "full rumour
  // sources with links" applies to /fights/[id] for every visitor, not
  // just the owner (only scouting reports below stay gated).
  const rumourFlags = await getRumourFlagsForFight(id);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // No fully-public tier for scouting reports (see ARCHITECTURE.md) --
  // scouting_reports/fighter_scouting_reports aren't even granted to the
  // anon role, so a logged-out visitor would always see zero reports
  // anyway. Skip the queries entirely rather than hitting a permission
  // error for a result we already know.
  const [matchupReports, fighter1Reports, fighter2Reports, clans] = user
    ? await Promise.all([
        getReportsForFight(id),
        getReportsForFighter(fight.fighter1.id),
        getReportsForFighter(fight.fighter2.id),
        getMyClans(),
      ])
    : [[], [], [], []];

  const redirectPath = `/fights/${id}`;

  return (
    <div>
      <Link href={`/events/${fight.event.id}`} className={styles.eventLink}>
        {fight.event.name}
      </Link>
      <h1>
        {fight.fighter1.name} vs {fight.fighter2.name}
      </h1>
      <p className={styles.meta}>
        {fight.weight_class ?? "Weight class unknown"}
        {fight.method ? ` · ${fight.method}${fight.round ? ` · R${fight.round}` : ""}` : ""}
      </p>

      <RumourSection
        fighter1={fight.fighter1}
        fighter2={fight.fighter2}
        flags={rumourFlags}
        settled={fight.winner_id !== null}
        viewerIsOwner={isOwner(user?.id)}
      />

      {!user && <p className={styles.signInPrompt}>Sign in to read and write scouting reports.</p>}

      {user && (
        <>
          <h2>Individual Reports</h2>
          <div className={styles.fighterColumns}>
            <FighterReportColumn
              fighterId={fight.fighter1.id}
              fighterName={fight.fighter1.name}
              redirectPath={redirectPath}
              reports={fighter1Reports}
              currentUserId={user.id}
              clans={clans}
            />
            <FighterReportColumn
              fighterId={fight.fighter2.id}
              fighterName={fight.fighter2.name}
              redirectPath={redirectPath}
              reports={fighter2Reports}
              currentUserId={user.id}
              clans={clans}
            />
          </div>

          <h2 className={styles.matchupHeading}>Matchup Report</h2>
          <ReportForm fightId={fight.id} clans={clans} />
          <ReportList reports={matchupReports} currentUserId={user.id} clans={clans} />
        </>
      )}
    </div>
  );
}
