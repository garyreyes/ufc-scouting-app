import { sharesExactlyOneFighter } from "./sharesExactlyOneFighter";

export interface FightForClustering {
  id: string;
  fighter1_id: string;
  fighter2_id: string;
}

/**
 * Groups fights (already scoped to ONE event) into connected components
 * by the "shares exactly one fighter" edge -- the same relation
 * upsertFight.ts's live disputed-opponent check already uses, just
 * applied retroactively across ALL of an event's fights at once instead
 * of one incoming write against existing rows (I2c).
 *
 * **A real chain, not just isolated pairs**, is why this can't be a
 * simple pairwise scan: I2c's own production data has "Gauge Young"
 * implicated across three fight rows, and "Ce Liu" across three more
 * where the two ends share nothing directly (their own "Ce Liu" fighter
 * id differs -- a name-order variant) but are still connected through a
 * shared middle fight. Union-find over the shared-fighter edges is what
 * correctly keeps a real chain as ONE cluster instead of reporting it as
 * several disconnected pairs that would each get resolved independently
 * and leave the others referencing an already-consumed row.
 *
 * Only returns clusters of 2+ fights -- a fight with no overlap with
 * anything else on its card is not this function's concern.
 */
export function clusterFightsBySharedFighter(fights: FightForClustering[]): string[][] {
  const parent = new Map<string, string>();
  for (const f of fights) parent.set(f.id, f.id);

  function find(id: string): string {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path compression -- flatten every visited node straight to the
    // root, so repeated finds on a long chain stay cheap.
    let cur = id;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  function union(a: string, b: string): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  }

  for (let i = 0; i < fights.length; i++) {
    for (let j = i + 1; j < fights.length; j++) {
      if (sharesExactlyOneFighter(fights[i], fights[j])) {
        union(fights[i].id, fights[j].id);
      }
    }
  }

  const groups = new Map<string, string[]>();
  for (const f of fights) {
    const root = find(f.id);
    const list = groups.get(root) ?? [];
    list.push(f.id);
    groups.set(root, list);
  }

  return [...groups.values()].filter((g) => g.length >= 2);
}
