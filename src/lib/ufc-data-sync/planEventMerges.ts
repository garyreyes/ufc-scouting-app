export interface MergeEventInput {
  id: string;
  event_date: string;
}

export interface MergeFightInput {
  id: string;
  event_id: string;
  fighter1_id: string;
  fighter2_id: string;
  bout_order: number | null;
  winner_id: string | null;
  settled_at: string | null;
  // True when a pick, odds_snapshot, data_conflict or rumour_flag row
  // FK-references this fight. All four RESTRICT the delete (and
  // odds_snapshots is immutable besides), so any of them turns the whole
  // merge into a manual data-fix -- see supabase/data-fixes/.
  hasBlockingRefs: boolean;
}

export interface EventMergePlan {
  event_date: string;
  keeperEventId: string;
  loserEventIds: string[];
  // Every fight belonging to a loser event: both the bouts that also
  // exist on the keeper (true duplicates) and the ones that were dropped
  // from the card before the rename. The keeper's own rows are never
  // touched -- it is the authoritative copy by construction.
  deleteFightIds: string[];
}

export interface SkippedCluster {
  event_date: string;
  eventIds: string[];
  reason: string;
}

export interface MergePlanResult {
  plans: EventMergePlan[];
  skipped: SkippedCluster[];
}

function pairKey(fight: { fighter1_id: string; fighter2_id: string }): string {
  return [fight.fighter1_id, fight.fighter2_id].sort().join("|");
}

/**
 * K1: decides which same-date `events` rows are duplicates of one real
 * card, which one survives, and which fights get removed -- the pure core
 * of mergeDuplicateSameDateEvents.ts.
 *
 * The app tracks at most one UFC card per day, so two `events` rows on
 * the same date that share even one exact fighter pairing are the same
 * event that upsertEvent.ts failed to fold (a source renamed it, or the
 * two sources named it differently). Found live three times -- I4b
 * ("UFC 330"), the 2026-09-09 Paris data-fix, and 2026-09-12
 * ("Rodríguez vs. Silva" renamed to "Silva vs. Delgado").
 *
 * Keeper = the row with the most `bout_order`-set fights (Wikipedia
 * curation = the authoritative card ordering, same call I4b made), then
 * the most fights, then the lexically smallest id for determinism.
 *
 * **Conservative by design -- skips the whole cluster, never guesses,
 * when:**
 *   - a loser event has MORE fights than the chosen keeper (keeper
 *     selection is not safe -- a human should look);
 *   - any loser fight already carries a result (settled_at or winner_id --
 *     a real result must not be deleted automatically);
 *   - any loser fight is FK-referenced by a pick/odds/conflict/rumour
 *     row (the delete would need trigger surgery -- that is what
 *     supabase/data-fixes/ is for).
 * A skipped cluster is reported, not silently dropped.
 */
export function planEventMerges(
  events: MergeEventInput[],
  fights: MergeFightInput[],
): MergePlanResult {
  const plans: EventMergePlan[] = [];
  const skipped: SkippedCluster[] = [];

  const fightsByEvent = new Map<string, MergeFightInput[]>();
  for (const fight of fights) {
    const list = fightsByEvent.get(fight.event_id) ?? [];
    list.push(fight);
    fightsByEvent.set(fight.event_id, list);
  }

  const eventsByDate = new Map<string, MergeEventInput[]>();
  for (const event of events) {
    const list = eventsByDate.get(event.event_date) ?? [];
    list.push(event);
    eventsByDate.set(event.event_date, list);
  }

  for (const [date, dateEvents] of eventsByDate) {
    if (dateEvents.length < 2) continue;

    for (const cluster of clusterEventsBySharedBout(dateEvents, fightsByEvent)) {
      if (cluster.length < 2) continue;

      const keeper = pickKeeper(cluster, fightsByEvent);
      const losers = cluster.filter((e) => e.id !== keeper.id);
      const keeperFights = fightsByEvent.get(keeper.id) ?? [];
      const keeperFightCount = keeperFights.length;

      let skipReason: string | null = null;
      const deleteFightIds: string[] = [];

      for (const loser of losers) {
        const loserFights = fightsByEvent.get(loser.id) ?? [];

        if (loserFights.length > keeperFightCount) {
          skipReason = `loser event ${loser.id} has more fights (${loserFights.length}) than keeper ${keeper.id} (${keeperFightCount}) -- manual review`;
          break;
        }

        for (const fight of loserFights) {
          if (fight.settled_at !== null || fight.winner_id !== null) {
            // winner_id is only ever written by the settlement job (which
            // also sets settled_at), so this is belt-and-suspenders -- but
            // a real result must never be deleted on a guess.
            skipReason = `loser fight ${fight.id} already carries a result -- manual review`;
            break;
          }
          if (fight.hasBlockingRefs) {
            skipReason = `loser fight ${fight.id} is referenced by a pick/odds/conflict/rumour row -- manual data-fix required`;
            break;
          }
          // Every loser fight is removed, including a bout that exists
          // ONLY on the loser (dropped from the card before the rename,
          // or a late bout one source added and the other hasn't). Safe:
          // it has no result and no refs (both checked above), and if it
          // is still real, the next sync re-reports it -- upsertEvent
          // follows `merged_into`, so it lands on the keeper, not a
          // resurrected duplicate.
          deleteFightIds.push(fight.id);
        }
        if (skipReason) break;
      }

      if (skipReason) {
        skipped.push({ event_date: date, eventIds: cluster.map((e) => e.id).sort(), reason: skipReason });
        continue;
      }

      plans.push({
        event_date: date,
        keeperEventId: keeper.id,
        loserEventIds: losers.map((e) => e.id).sort(),
        deleteFightIds,
      });
    }
  }

  return { plans, skipped };
}

// Connected components of same-date events, joined by any shared exact
// fighter pairing. A three-way rename chain ("330" / "330: A vs B" /
// "330: A vs. B") lands in one component; a genuinely separate same-date
// event (no shared bout) stays on its own and is left alone.
function clusterEventsBySharedBout(
  dateEvents: MergeEventInput[],
  fightsByEvent: Map<string, MergeFightInput[]>,
): MergeEventInput[][] {
  const pairKeysByEvent = new Map<string, Set<string>>();
  for (const event of dateEvents) {
    pairKeysByEvent.set(event.id, new Set((fightsByEvent.get(event.id) ?? []).map(pairKey)));
  }

  const parent = new Map<string, string>();
  for (const event of dateEvents) parent.set(event.id, event.id);
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = id;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };

  for (let i = 0; i < dateEvents.length; i++) {
    for (let j = i + 1; j < dateEvents.length; j++) {
      const a = pairKeysByEvent.get(dateEvents[i].id)!;
      const b = pairKeysByEvent.get(dateEvents[j].id)!;
      if ([...a].some((k) => b.has(k))) union(dateEvents[i].id, dateEvents[j].id);
    }
  }

  const groups = new Map<string, MergeEventInput[]>();
  for (const event of dateEvents) {
    const root = find(event.id);
    const list = groups.get(root) ?? [];
    list.push(event);
    groups.set(root, list);
  }
  return [...groups.values()];
}

function pickKeeper(
  cluster: MergeEventInput[],
  fightsByEvent: Map<string, MergeFightInput[]>,
): MergeEventInput {
  const score = (event: MergeEventInput) => {
    const eventFights = fightsByEvent.get(event.id) ?? [];
    return {
      boutOrderSet: eventFights.filter((f) => f.bout_order !== null).length,
      fightCount: eventFights.length,
    };
  };
  return [...cluster].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa.boutOrderSet !== sb.boutOrderSet) return sb.boutOrderSet - sa.boutOrderSet;
    if (sa.fightCount !== sb.fightCount) return sb.fightCount - sa.fightCount;
    return a.id < b.id ? -1 : 1;
  })[0];
}
