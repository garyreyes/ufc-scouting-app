export interface ExistingSourceReports {
  wikipediaReportedAt: string | null;
  apiSportsReportedAt: string | null;
}

export interface SourceReport {
  source: "wikipedia" | "api_sports";
  winnerId: string | null;
  // Only ever meaningful for wikipedia -- api_sports' fights endpoint has
  // no method/round fields at all (fetchFightHistory.ts).
  method: string | null;
  round: number | null;
}

export interface SourceReportColumnUpdate {
  wikipedia_winner_id?: string | null;
  wikipedia_method?: string | null;
  wikipedia_round?: number | null;
  wikipedia_reported_at?: string;
  api_sports_winner_id?: string | null;
  api_sports_reported_at?: string;
}

/**
 * Turns one source's incoming report into the per-source columns to
 * write on `fights` -- never the shared winner_id/method/round, which
 * are authoritative and owned exclusively by the settle job
 * (lib/settlement/) from 0021_result_settlement.sql forward.
 *
 * Each source has its own "has this bout actually been reported" signal,
 * verified live against real Wikipedia data (see the migration's own
 * comment): wikipedia is reported once `method` is non-null (true even
 * for a draw/NC, which has no winner but a real method string like
 * "NC (overturned)"); api_sports is reported once it has a winner, since
 * that's the only signal its API gives at all.
 *
 * `reported_at` is set on first report only and preserved after -- see
 * evaluateFightSettlement.ts, which measures the 24h single-source
 * timeout against it. A later correction (e.g. a result overturned on
 * appeal) still updates winner/method/round, just never resets the
 * clock.
 */
export function buildSourceReportUpdate(
  report: SourceReport,
  existing: ExistingSourceReports,
  now: string,
): SourceReportColumnUpdate {
  if (report.source === "wikipedia") {
    if (report.method === null) return {};
    return {
      wikipedia_winner_id: report.winnerId,
      wikipedia_method: report.method,
      wikipedia_round: report.round,
      wikipedia_reported_at: existing.wikipediaReportedAt ?? now,
    };
  }

  if (report.winnerId === null) return {};
  return {
    api_sports_winner_id: report.winnerId,
    api_sports_reported_at: existing.apiSportsReportedAt ?? now,
  };
}
