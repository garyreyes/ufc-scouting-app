import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/auth";
import { getCardView } from "@/features/fights/api";
import { BoutRow } from "@/features/fights/components/BoutRow";
import { getMyPicksForFights } from "@/features/picks/api";
import { getOpenDisputedFightIds } from "@/features/conflicts/api";
import { getRumourFlagSummaries } from "@/features/rumours/api";
import { RumourHealthNotice } from "@/features/rumours/components/RumourHealthNotice";
import type { MyPick } from "@/features/picks/types";
import styles from "./page.module.css";

function formatDate(dateString: string): string {
  return new Date(`${dateString}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function EventDetailPage({
  params,
  searchParams,
}: PageProps<"/events/[id]">) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const weightClassParam = resolvedSearchParams.weightClass;
  const weightClasses = Array.isArray(weightClassParam)
    ? weightClassParam
    : weightClassParam
      ? [weightClassParam]
      : [];

  const event = await getCardView(id, weightClasses);
  if (!event) notFound();

  // Own render, not shared layout chrome (unlike JobHealthBanner) --
  // /events/[id] is already a dynamic route, so a cookies()-based check
  // here costs nothing extra (see PROJECT_FACTS.md's note on where that
  // cost actually matters).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerIsOwner = isOwner(user?.id);

  // Read-only for everyone who isn't the owner -- logged-out and
  // logged-in-but-not-allowlisted are the same UI state here
  // (docs/user-flows.md's auth-gate table), and Flow 1's own diagram
  // never branches conflict-holds or picks onto either of those paths.
  let myPicks = new Map<string, MyPick>();
  let disputedFightIds = new Set<string>();
  if (viewerIsOwner) {
    const fightIds = event.fights.map((f) => f.id);
    [myPicks, disputedFightIds] = await Promise.all([
      getMyPicksForFights(supabase, fightIds),
      getOpenDisputedFightIds(fightIds),
    ]);
  }

  // Public, unlike picks/conflicts above -- rumour_flags/rumour_sources
  // are public-read (0024_rumour_flags_and_sources.sql), and docs/
  // user-flows.md shows flags on the read-only card view too.
  const rumourFlagsByFight = await getRumourFlagSummaries(event.fights.map((f) => f.id));

  const locked = event.starts_at !== null && new Date() >= new Date(event.starts_at);

  return (
    <div>
      <h1>{event.name}</h1>
      <p className={styles.date}>{formatDate(event.event_date)}</p>
      {!viewerIsOwner && (
        <p className={styles.gateNote}>
          {user ? "Not available." : "Sign in to make picks."}
        </p>
      )}
      <RumourHealthNotice />
      {event.fights.length === 0 ? (
        <p className={styles.empty}>No fights match the selected filter.</p>
      ) : (
        <div className={styles.fightList}>
          {event.fights.map((fight) => (
            <BoutRow
              key={fight.id}
              fight={fight}
              viewerState={viewerIsOwner ? "owner" : "read-only"}
              myPick={myPicks.get(fight.id) ?? null}
              locked={locked}
              disputed={disputedFightIds.has(fight.id)}
              rumourFlags={rumourFlagsByFight.get(fight.id) ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}
