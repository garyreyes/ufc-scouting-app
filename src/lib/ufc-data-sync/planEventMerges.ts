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

// Two event rows this many days apart or fewer, that also share an exact
// fighter pairing, are treated as the same card. 1 covers a timezone /
// broadcast-vs-local date split (found live: "Gamrot vs Salkilld" on
// 2026-08-09 from API-Sports vs "... vs. Salkilld" on 2026-08-08 from
// Wikipedia). The shared-exact-pair requirement is what keeps this safe
// -- two genuinely different cards a day apart never carry the identical
// unordered fighter pair.
const MAX_EVENT_DATE_SKEW_DAYS = 1;

function pairKey(fight: { fighter1_id: string; fighter2_id: string }): string {
  return [fight.fighter1_id, fight.fighter2_id].sort().join("|");
}

function daysApart(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * K1: decides which `events` rows are duplicates of one real card, which
 * one survives, and which fights get removed -- the pure core of
 * mergeDuplicateSameDateEvents.ts.
 *
 * The app tracks at most one UFC card per day, so two `events` rows
 * within a day of each other that share even one exact fighter pairing
 * are the same event that upsertEvent.ts failed to fold (a source
 * renamed it, the two sources named it differently, or they disagree on
 * the calendar date by a timezone). Found live four times -- I4b
 * ("UFC 330"), the 2026-09-09 Paris data-fix, 2026-09-12
 * ("Rodríguez vs. Silva" renamed to "Silva vs. Delgado"), and the
 * "Gamrot vs Salkilld" 2026-08-08/09 date split (K2).
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

  for (const cluster of clusterEventsBySharedBout(events, fightsByEvent)) {
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
      skipped.push({ event_date: keeper.event_date, eventIds: cluster.map((e) => e.id).sort(), reason: skipReason });
      continue;
    }

    plans.push({
      event_date: keeper.event_date,
      keeperEventId: keeper.id,
      loserEventIds: losers.map((e) => e.id).sort(),
      deleteFightIds,
    });
  }

  return { plans, skipped };
}

// Connected components of events joined by a shared exact fighter pairing
// AND a pairwise date within MAX_EVENT_DATE_SKEW_DAYS. A three-way rename
// chain ("330" / "330: A vs B" / "330: A vs. B") lands in one component;
// a genuinely separate event (no shared bout, or too far apart) stays on
// its own. (A transitive chain -- A~B, B~C, each within the window --
// can span more than the window end to end; that needs three rows for
// one card across three dates all sharing exact pairs down the chain,
// which real UFC data does not produce, and the result/ref skip guards
// still apply.)
function clusterEventsBySharedBout(
  events: MergeEventInput[],
  fightsByEvent: Map<string, MergeFightInput[]>,
): MergeEventInput[][] {
  const pairKeysByEvent = new Map<string, Set<string>>();
  for (const event of events) {
    pairKeysByEvent.set(event.id, new Set((fightsByEvent.get(event.id) ?? []).map(pairKey)));
  }

  const parent = new Map<string, string>();
  for (const event of events) parent.set(event.id, event.id);
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

  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      if (daysApart(events[i].event_date, events[j].event_date) > MAX_EVENT_DATE_SKEW_DAYS) continue;
      const a = pairKeysByEvent.get(events[i].id)!;
      const b = pairKeysByEvent.get(events[j].id)!;
      if ([...a].some((k) => b.has(k))) union(events[i].id, events[j].id);
    }
  }

  const groups = new Map<string, MergeEventInput[]>();
  for (const event of events) {
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
