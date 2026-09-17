export interface ReconciliationFight {
  id: string;
  /** fights.external_id. Only a `wiki:<title>:<f1>:<f2>` row belonging to
   *  THIS event's title is ever a candidate -- an API-Sports fight, or one
   *  adopted from a merged duplicate event, is never this function's
   *  business. */
  externalId: string;
  settledAt: string | null;
  wikipediaMissingSince: string | null;
}

export type ReconciliationAction =
  | { action: "markMissing"; fightId: string }
  | { action: "cancel"; fightId: string }
  | { action: "clearMissing"; fightId: string };

// A single miss could just as easily be a mid-edit Wikipedia page, not a
// real cancellation (upsertFight.ts's own disputed-opponent branch made
// exactly this mistake once before -- see its own header comment). The
// bout must be missing for a second sync, at least this many hours after
// the first, before it's treated as genuinely gone. sync.yml runs roughly
// every ~12h in practice, so this spans at least one more run without
// requiring a full day's wait the way a settlement single-source timeout
// does -- a cancellation is a removal the source has already committed to,
// not a pending result.
const DEFAULT_GRACE_HOURS = 6;

/**
 * M2: decides what should happen to each of this event's already-stored
 * Wikipedia bouts, given which fight ids the CURRENT sync actually found
 * present on the page (a fight counts as present whether it was cleanly
 * upserted or is the subject of an open disputed_opponent conflict --
 * callers must include both, never just the upserted set, or a genuine
 * opponent dispute would be mistaken for a cancellation).
 *
 * Pure and I/O-free by design (lib/scoring/'s own convention): the caller
 * (processScheduleEvent.ts) owns fetching this event's existing fights and
 * writing the decision; this owns only the judgment, and owns none of the
 * "should reconciliation even run this time" question -- that is a
 * separate, caller-side decision (a malformed or heavily truncated page
 * parse must skip calling this at all, never be fed into it as if it were
 * a normal absence).
 *
 * Never returns a "cancel" for a fight already settled by any means
 * (settledAt !== null) or whose external_id doesn't belong to this
 * event's title -- both are simply not this function's business.
 */
export function planCardReconciliation(
  eventTitle: string,
  existingFights: readonly ReconciliationFight[],
  presentFightIds: ReadonlySet<string>,
  now: Date,
  graceHours: number = DEFAULT_GRACE_HOURS,
): ReconciliationAction[] {
  const prefix = `wiki:${eventTitle}:`;
  const actions: ReconciliationAction[] = [];

  for (const fight of existingFights) {
    if (fight.settledAt !== null) continue;
    if (!fight.externalId.startsWith(prefix)) continue;

    const isPresent = presentFightIds.has(fight.id);

    if (isPresent) {
      if (fight.wikipediaMissingSince !== null) {
        actions.push({ action: "clearMissing", fightId: fight.id });
      }
      continue;
    }

    if (fight.wikipediaMissingSince === null) {
      actions.push({ action: "markMissing", fightId: fight.id });
      continue;
    }

    const hoursMissing =
      (now.getTime() - new Date(fight.wikipediaMissingSince).getTime()) / (1000 * 60 * 60);
    if (hoursMissing >= graceHours) {
      actions.push({ action: "cancel", fightId: fight.id });
    }
  }

  return actions;
}
