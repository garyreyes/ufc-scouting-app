import { notFound } from "next/navigation";
import Link from "next/link";
import { getFightById } from "@/features/fights/api";
import { getReportsForFight } from "@/features/scouting-reports/api";
import { getMyClans } from "@/features/clans/api";
import { createClient } from "@/lib/supabase/server";
import { ReportForm } from "@/features/scouting-reports/components/ReportForm";
import { ReportList } from "@/features/scouting-reports/components/ReportList";
import styles from "./page.module.css";

export default async function FightDetailPage({ params }: PageProps<"/fights/[id]">) {
  const { id } = await params;
  const fight = await getFightById(id);
  if (!fight) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // No fully-public tier for scouting reports (see ARCHITECTURE.md) --
  // scouting_reports isn't even granted to the anon role, so a logged-out
  // visitor would always see zero reports anyway. Skip the query entirely
  // rather than hitting a permission error for a result we already know.
  const [reports, clans] = await Promise.all([
    user ? getReportsForFight(id) : Promise.resolve([]),
    user ? getMyClans() : Promise.resolve([]),
  ]);

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

      <h2>Scouting Reports</h2>
      {user ? (
        <>
          <ReportForm fightId={fight.id} clans={clans} />
          <ReportList reports={reports} currentUserId={user.id} />
        </>
      ) : (
        <p className={styles.signInPrompt}>Sign in to read and write scouting reports.</p>
      )}
    </div>
  );
}
