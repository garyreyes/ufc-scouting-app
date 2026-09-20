export interface ShadowPickScoringRow {
  fightId: string;
  line: "LLM_ASSISTED" | "LLM_ONLY";
  // O3 (Track B): part of the dedup key below, same reasoning as `line`
  // -- two providers' rows for the same fight/line are independent
  // streams, not revisions of the same one (DECISIONS.md, 2026-09-20).
  provider: string;
  predictedFighterId: string;
  probability: number;
  // Only set on LLM_ASSISTED -- see shadow_picks' own column comment.
  confidence: number | null;
  createdAtMs: number;
}

/**
 * N9's read of `shadow_picks` (0052_shadow_picks.sql's own comment: "a
 * reader must select the latest row per (fight_id, line) with created_at
 * strictly before that fight's card lock time -- never the latest row
 * unconditionally, which would leak post-lock information into a
 * forward-only measurement"). Shadow picks revise until lock and are
 * append-only, so a fight can have many rows per line; this picks
 * exactly the one that was live at the moment INTERN's own pick locked,
 * the same forward-only discipline every other line in this app already
 * measures itself against. O3 (Track B): the dedup key is really
 * (fight_id, line, provider) since 0061 -- two providers answering the
 * same line for the same fight are independent streams, not revisions
 * of one (DECISIONS.md, 2026-09-20).
 *
 * A fight missing from `lockAtMsByFightId` (cancelled, or its card never
 * got a confirmed `starts_at`) is dropped entirely -- there's no lock
 * instant to measure against, mirroring `isPickLocked`'s own "no
 * startsAt, never locked" rule rather than inventing a different one here.
 */
export function selectLatestBeforeLock(
  rows: ShadowPickScoringRow[],
  lockAtMsByFightId: Map<string, number>,
): ShadowPickScoringRow[] {
  const latestByKey = new Map<string, ShadowPickScoringRow>();

  for (const row of rows) {
    const lockAtMs = lockAtMsByFightId.get(row.fightId);
    if (lockAtMs === undefined) continue;
    if (row.createdAtMs >= lockAtMs) continue;

    const key = `${row.fightId}:${row.line}:${row.provider}`;
    const existing = latestByKey.get(key);
    if (!existing || row.createdAtMs > existing.createdAtMs) {
      latestByKey.set(key, row);
    }
  }

  return [...latestByKey.values()];
}
