import { supabase } from "@/lib/db";
import { evaluateJobHealth } from "@/shared/utils/evaluateJobHealth";
import type { RumourFlagDetail, RumourFlagSummary, RumourSourceDetail } from "./types";

// The job_runs job_name F2's runScheduledRumourJob.ts writes.
export const RUMOUR_JOB_NAME = "rumour_scan";

// 3x the rumour job's own 6h cron cadence (.github/workflows/rumours.yml)
// -- same "one missed tick is normal jitter, two in a row is a real
// signal" reasoning shared/utils/evaluateJobHealth.ts's default uses for
// the odds job's 2h cadence, just scaled to this job's own cadence rather
// than reusing that default outright.
const RUMOUR_STALE_THRESHOLD_HOURS = 18;

/**
 * Card-view badge data (BoutRow): every flag for the given fights,
 * without full source lists -- that's getRumourFlagsForFight's job, for
 * /fights/[id]. Public data, no owner gate: rumour_flags/rumour_sources
 * are public-read (0024_rumour_flags_and_sources.sql), matching
 * odds_snapshots' posture, since docs/user-flows.md shows flags on the
 * read-only card view too.
 *
 * Fetched separately from getCardView rather than folded into it --
 * same "fetch separately, merge in JS" pattern getMyPicksForFights and
 * getOpenDisputedFightIds already use alongside it in
 * /events/[id]/page.tsx.
 */
export async function getRumourFlagSummaries(
  fightIds: string[],
): Promise<Map<string, RumourFlagSummary[]>> {
  if (fightIds.length === 0) return new Map();

  const { data: flags, error: flagsError } = await supabase
    .from("rumour_flags")
    .select("id, fight_id, fighter_id, category, summary, last_corroborated_at")
    .in("fight_id", fightIds);
  if (flagsError) throw flagsError;
  if (!flags || flags.length === 0) return new Map();

  const countByFlagId = await getSourceCountsByFlagId(flags.map((f) => f.id as string));

  const byFightId = new Map<string, RumourFlagSummary[]>();
  for (const f of flags) {
    const fightId = f.fight_id as string;
    const list = byFightId.get(fightId) ?? [];
    list.push({
      id: f.id as string,
      fighterId: f.fighter_id as string,
      category: f.category as RumourFlagSummary["category"],
      summary: f.summary as string,
      corroborationCount: countByFlagId.get(f.id as string) ?? 0,
      lastCorroboratedAt: f.last_corroborated_at as string,
    });
    byFightId.set(fightId, list);
  }
  return byFightId;
}

/**
 * /fights/[id]'s full rumour section: every flag for this one fight, each
 * with its complete, real source list -- PRD UC-1's "direct links to
 * each post" requirement. Same public posture as the summary query above.
 */
export async function getRumourFlagsForFight(fightId: string): Promise<RumourFlagDetail[]> {
  const { data: flags, error: flagsError } = await supabase
    .from("rumour_flags")
    .select("id, fighter_id, category, summary, last_corroborated_at")
    .eq("fight_id", fightId);
  if (flagsError) throw flagsError;
  if (!flags || flags.length === 0) return [];

  const flagIds = flags.map((f) => f.id as string);
  const { data: sources, error: sourcesError } = await supabase
    .from("rumour_sources")
    .select("flag_id, post_uri, author_handle, excerpt, external_url, is_named_source, post_created_at")
    .in("flag_id", flagIds)
    .order("post_created_at", { ascending: false });
  if (sourcesError) throw sourcesError;

  const sourcesByFlagId = new Map<string, RumourSourceDetail[]>();
  for (const s of sources ?? []) {
    const flagId = s.flag_id as string;
    const list = sourcesByFlagId.get(flagId) ?? [];
    list.push({
      uri: s.post_uri as string,
      authorHandle: s.author_handle as string,
      excerpt: s.excerpt as string,
      externalUrl: s.external_url as string | null,
      isNamedSource: s.is_named_source as boolean,
      postCreatedAt: s.post_created_at as string,
    });
    sourcesByFlagId.set(flagId, list);
  }

  return flags.map((f) => {
    const flagSources = sourcesByFlagId.get(f.id as string) ?? [];
    return {
      id: f.id as string,
      fighterId: f.fighter_id as string,
      category: f.category as RumourFlagDetail["category"],
      summary: f.summary as string,
      lastCorroboratedAt: f.last_corroborated_at as string,
      corroborationCount: flagSources.length,
      sources: flagSources,
    };
  });
}

async function getSourceCountsByFlagId(flagIds: string[]): Promise<Map<string, number>> {
  if (flagIds.length === 0) return new Map();
  const { data: sources, error } = await supabase
    .from("rumour_sources")
    .select("flag_id")
    .in("flag_id", flagIds);
  if (error) throw error;

  const counts = new Map<string, number>();
  for (const s of sources ?? []) {
    const flagId = s.flag_id as string;
    counts.set(flagId, (counts.get(flagId) ?? 0) + 1);
  }
  return counts;
}

export interface RumourScanHealth {
  degraded: boolean;
  lastScrapedAt: string | null;
}

/**
 * docs/user-flows.md's "Rumour engine degraded" state for /events/[id]:
 * "Flags unavailable, last scraped X" -- a separate, page-scoped notice
 * from features/job-health's global JobHealthBanner (app-shell chrome,
 * odds-specific wording), not folded into it. Three reasons: the copy is
 * materially different from that banner's rigid "job hasn't run in Xh"
 * phrasing; user-flows.md places this state in /events/[id]'s own table,
 * not the global-chrome section; and a site-wide banner would show on
 * every page (e.g. /fighters) even though rumour flags only ever appear
 * on /events/[id] and /fights/[id]. Reuses evaluateJobHealth (moved to
 * shared/ for exactly this reason) rather than duplicating its logic.
 *
 * No manual-retry action here, unlike the odds job's banner -- docs/
 * user-flows.md only specifies "a manual late-pull action" for the odds
 * case, not this one; the asymmetry is deliberate, not a gap.
 */
export async function getRumourScanHealth(now: Date = new Date()): Promise<RumourScanHealth> {
  const { data, error } = await supabase
    .from("job_runs")
    .select("job_name, status, finished_at, error")
    .eq("job_name", RUMOUR_JOB_NAME)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;

  const lastScrapedAt = data ? (data.finished_at as string) : null;

  if (!data) {
    return { degraded: true, lastScrapedAt: null };
  }

  const runs = [
    {
      jobName: data.job_name as string,
      status: data.status as "success" | "failure",
      finishedAt: data.finished_at as string,
      error: data.error as string | null,
    },
  ];
  const status = evaluateJobHealth(runs, [RUMOUR_JOB_NAME], 0, now, RUMOUR_STALE_THRESHOLD_HOURS);

  return { degraded: status.kind === "degraded", lastScrapedAt };
}
