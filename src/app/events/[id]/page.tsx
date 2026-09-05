import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/auth";
import { getCardView } from "@/features/fights/api";
import { BoutRow } from "@/features/fights/components/BoutRow";
import { getMyPicksForFights, getInternPicksForFights } from "@/features/picks/api";
import { InternCardRead } from "@/features/picks/components/InternCardRead";
import { getOpenDisputedFightIds } from "@/features/conflicts/api";
import { getRumourFlagSummaries } from "@/features/rumours/api";
import { RumourHealthNotice } from "@/features/rumours/components/RumourHealthNotice";
import { describeOwnerConfigError } from "@/lib/describeOwnerConfigError";
import { OwnerConfigNotice } from "@/shared/components/OwnerConfigNotice";
import type { InternPickSummary, MyPick } from "@/features/picks/types";
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

  // Read-only for everyone who isn't the owner -- logged-out and
  // logged-in-but-not-allowlisted are the same UI state here
  // (docs/user-flows.md's auth-gate table), and Flow 1's own diagram
  // never branches conflict-holds or picks onto either of those paths.
  //
  // A missing OWNER_USER_ID or SUPABASE_SERVICE_ROLE_KEY (found live
  // 2026-09-02: this crashed the whole page with an opaque error) falls
  // into the exact same read-only branch rather than a 500 -- but is
  // still loud about it, via ownerConfigError, rather than silently
  // treating a real owner as a stranger with no explanation. Any OTHER
  // thrown error is a real bug, not a recognized config gap
  // (describeOwnerConfigError.ts returns null for those), and still
  // fails loudly by rethrowing.
  let viewerIsOwner = false;
  let ownerConfigError: string | null = null;
  let myPicks = new Map<string, MyPick>();
  let disputedFightIds = new Set<string>();
  let internPicks = new Map<string, InternPickSummary>();
  try {
    viewerIsOwner = isOwner(user?.id);
    if (viewerIsOwner) {
      const fightIds = event.fights.map((f) => f.id);
      [myPicks, disputedFightIds, internPicks] = await Promise.all([
        getMyPicksForFights(supabase, fightIds),
        getOpenDisputedFightIds(fightIds),
        getInternPicksForFights(supabase, fightIds),
      ]);
    }
  } catch (err) {
    const described = describeOwnerConfigError(err);
    if (!described) throw err;
    viewerIsOwner = false;
    ownerConfigError = described;
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
      {ownerConfigError && <OwnerConfigNotice message={ownerConfigError} />}
      <RumourHealthNotice />
      {viewerIsOwner && event.fights.length > 0 && (
        <InternCardRead fights={event.fights} internPicks={internPicks} />
      )}
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
              internPick={internPicks.get(fight.id) ?? null}
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
