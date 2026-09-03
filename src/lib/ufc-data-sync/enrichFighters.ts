import type { SupabaseClient } from "@supabase/supabase-js";
import { searchFighters } from "./searchFighters";
import { decideFighterMatch, rankFighterCandidates } from "./matchFighterCandidate";
import { stripNullish } from "./stripNullish";

export interface EnrichFightersSummary {
  attempted: number;
  matched: number;
  queued: number;
  noCandidates: number;
  failed: number;
}

// ~40 requests/run at client.ts's 6.5s throttle is ~4.3 minutes, well
// under the 15-minute job timeout other jobs use, and leaves real
// headroom in the shared 100/day API-Sports free-tier budget alongside
// the twice-daily results sync (~10-15 requests/run -- see
// ROADMAP.md Phase I's own accounting). Exported so a caller (or a live
// verification run) can override it for a small confirmed batch without
// touching the production default.
export const DEFAULT_BATCH_SIZE = 40;

/**
 * I2's enrichment job: works through name-only fighters, one API-Sports
 * search each, matching lib/odds's auto-match/review-queue shape
 * (decideFighterMatch mirrors matchFights.ts's decideMatch).
 *
 * **Self-throttling and resumable by construction, not by any separate
 * queue table.** The query is `external_id is null and
 * enrichment_checked_at is null` -- "not yet enriched, not yet even
 * attempted" IS the queue, so this project's one-table preference
 * (ARCHITECTURE.md Fork 6/D1) extends here too: nothing new to keep in
 * sync with `fighters` itself. enrichment_checked_at is set on every
 * attempt regardless of outcome (matched, queued for review, or
 * genuinely absent from API-Sports), so a fighter is only ever searched
 * once -- re-running this job costs nothing against fighters it has
 * already resolved one way or another.
 *
 * A low-confidence best guess opens a `low_confidence_fighter_match`
 * conflict with the FULL ranked candidate list snapshotted into
 * `details`, not just the top guess -- the owner's own review screen
 * needs every real candidate to correct the algorithm, the same
 * reasoning `rankFightMatches` already serves for B6's odds queue.
 *
 * `no_candidates` is not a conflict, matching decideFighterMatch's own
 * documented reasoning: a real debutant or a very recent signee simply
 * hasn't reached API-Sports yet.
 */
export async function enrichFighters(
  supabase: SupabaseClient,
  batchSize: number = DEFAULT_BATCH_SIZE,
): Promise<EnrichFightersSummary> {
  const summary: EnrichFightersSummary = {
    attempted: 0,
    matched: 0,
    queued: 0,
    noCandidates: 0,
    failed: 0,
  };

  const { data: orphans, error } = await supabase
    .from("fighters")
    .select("id, name")
    .is("external_id", null)
    .is("enrichment_checked_at", null)
    .limit(batchSize);
  if (error) throw error;
  if (!orphans || orphans.length === 0) return summary;

  for (const fighter of orphans) {
    summary.attempted++;
    const fighterId = fighter.id as string;
    const fighterName = fighter.name as string;
    const checkedAt = new Date().toISOString();

    try {
      const candidates = await searchFighters(fighterName);
      const decision = decideFighterMatch(fighterName, candidates);

      if (decision.kind === "no_candidates") {
        summary.noCandidates++;
        await markChecked(supabase, fighterId, checkedAt);
        continue;
      }

      if (decision.kind === "low_confidence") {
        summary.queued++;
        const ranked = rankFighterCandidates(fighterName, candidates);
        const byExternalId = new Map(candidates.map((c) => [c.externalId, c]));

        const { error: insertError } = await supabase.from("data_conflicts").insert({
          kind: "low_confidence_fighter_match",
          fight_id: null,
          details: {
            fighterId,
            storedName: fighterName,
            candidates: ranked.map((r) => {
              const c = byExternalId.get(r.externalId)!;
              return {
                externalId: c.externalId,
                name: c.name,
                confidence: r.confidence,
                heightCm: c.heightCm,
                reachCm: c.reachCm,
                weightKg: c.weightKg,
                weightClass: c.weightClass,
                stance: c.stance,
                nickname: c.nickname,
                team: c.team,
              };
            }),
          },
        });
        if (insertError) throw insertError;
        await markChecked(supabase, fighterId, checkedAt);
        continue;
      }

      // matched
      const matched = candidates.find((c) => c.externalId === decision.externalId)!;
      const updatePayload = {
        ...stripNullish({
          external_id: matched.externalId,
          height_cm: matched.heightCm,
          reach_cm: matched.reachCm,
          weight_kg: matched.weightKg,
          weight_class: matched.weightClass,
          stance: matched.stance,
          nickname: matched.nickname,
          team: matched.team,
        }),
        synced_at: checkedAt,
        enrichment_checked_at: checkedAt,
      };
      const { error: updateError } = await supabase.from("fighters").update(updatePayload).eq("id", fighterId);
      if (updateError) throw updateError;
      summary.matched++;
    } catch (err) {
      summary.failed++;
      console.error(`Enrichment failed for fighter ${fighterId} (${fighterName}):`, err);
    }
  }

  return summary;
}

async function markChecked(supabase: SupabaseClient, fighterId: string, checkedAt: string): Promise<void> {
  const { error } = await supabase
    .from("fighters")
    .update({ enrichment_checked_at: checkedAt })
    .eq("id", fighterId);
  if (error) throw error;
}
