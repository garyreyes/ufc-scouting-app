import { DAILY_CALL_CAP, MIN_CALL_INTERVAL_MS } from "../models";

/**
 * Pure decision logic for what a call is allowed to spend. Split into two
 * kinds of guard, enforced in two different places, on purpose:
 *
 * - The daily cap and the minimum-interval-since-last-call (real provider
 *   limits -- N1 measured 500 RPD / 15 RPM) are enforced ATOMICALLY inside
 *   Postgres (try_reserve_llm_call(), 0047_llm_call_log.sql), because two
 *   concurrent job runs reading a count in TypeScript and then each
 *   deciding "I'm under the cap" is a classic race -- the count-then-insert
 *   has to be one statement. reserveLlmCall.ts is the I/O half that calls
 *   it.
 * - The per-surface soft ceiling below is NOT a real provider limit --
 *   it exists only so a runaway surface (a scouting job stuck in a retry
 *   loop) can't eat the whole day's budget before the rumour job gets a
 *   turn. A soft ceiling can tolerate the small race a non-atomic
 *   TypeScript-side check allows (worst case: one extra call over), so it
 *   is checked here, in-process, before the atomic SQL call is even
 *   attempted -- cheaper, and correct enough for what it protects against.
 *
 * These functions take state, not I/O -- callers (reserveLlmCall.ts,
 * tests) fetch counts however they like and pass them in.
 */

export const SURFACE_SOFT_CAPS: Record<string, number> = {
  rumours: 120,
  conflicts: 60,
  scouting: 200,
};
// The three soft caps intentionally sum to less than DAILY_CALL_CAP
// (500): the gap is headroom for workflow_dispatch re-runs and backfills
// that don't belong to any one surface's normal budget.

export function isWithinSurfaceSoftCap(surface: string, callsTodayForSurface: number): boolean {
  const cap = SURFACE_SOFT_CAPS[surface];
  if (cap === undefined) return true; // unknown surface: no soft cap configured, not a reason to deny
  return callsTodayForSurface < cap;
}

export function isPastMinInterval(
  lastCallAt: Date | null,
  now: Date,
  minIntervalMs: number = MIN_CALL_INTERVAL_MS,
): boolean {
  if (lastCallAt === null) return true;
  return now.getTime() - lastCallAt.getTime() >= minIntervalMs;
}

export function isWithinDailyCap(callsToday: number, dailyCap: number = DAILY_CALL_CAP): boolean {
  return callsToday < dailyCap;
}
