import { hashCanonicalJson } from "../llm/promptHash";
import { getSupabaseAdmin } from "../supabase/admin";
import { buildFightFacts } from "./buildFightFacts";
import { buildShadowPicksPrompt } from "./buildShadowPicksPrompt";
import { extractFightIdsFromRawOutput, replayLlmCall } from "./replayLlmCall";
import type { ShadowPickFacts } from "./types";

function arg(prefix: string): string | undefined {
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

/**
 * N9's replay CLI (`npm run llm:replay -- --call-id=<uuid>`) -- re-runs
 * the post-model pipeline over a real stored `llm_call_log` row with zero
 * network, so a parser/verifier regression becomes a diff instead of a
 * mystery (0047_llm_call_log.sql's own header comment).
 *
 * Locates the call's fights from its OWN raw output
 * (`extractFightIdsFromRawOutput`), never from `shadow_picks` --
 * N9's own planning audit found the one call most worth replaying is
 * exactly the kind that dropped every claim and so wrote zero rows to
 * that table (a `shadow_picks`-only lookup would fail on precisely its
 * most useful case). `--event-id=<uuid>` is the fallback for when even
 * that lenient extraction finds nothing (the raw output itself is not
 * valid JSON at all).
 */
async function main() {
  const callId = arg("--call-id=");
  const eventIdFallback = arg("--event-id=");
  if (!callId) {
    throw new Error("Usage: npm run llm:replay -- --call-id=<uuid> [--event-id=<uuid>]");
  }

  const supabase = getSupabaseAdmin();

  const { data: callRow, error: callError } = await supabase
    .from("llm_call_log")
    .select("id, surface, raw_output, prompt_hash, status")
    .eq("id", callId)
    .single();
  if (callError) throw callError;

  if (callRow.surface !== "shadowPicks") {
    throw new Error(`llm_call_log ${callId} has surface "${callRow.surface}", not "shadowPicks" -- wrong call id.`);
  }
  const rawOutput = callRow.raw_output as string | null;
  if (!rawOutput) {
    throw new Error(
      `llm_call_log ${callId} has no raw_output (status: ${callRow.status ?? "never finished"}) -- this call never returned a response, nothing to replay.`,
    );
  }

  let fightIds = extractFightIdsFromRawOutput(rawOutput);
  // Only actually FALL BACK to --event-id when extraction found nothing --
  // a caller passing it defensively alongside a raw output that extracts
  // fine must never have it silently override the real event, which would
  // pair the extracted fight ids with a mismatched event's cardDate (wrong
  // ages baked into the rebuilt prompt) and misreport the resulting hash
  // mismatch as "facts drifted" rather than as a bad --event-id.
  const usedEventIdFallback = fightIds.length === 0;
  if (usedEventIdFallback) {
    if (!eventIdFallback) {
      throw new Error(
        "Could not locate any fightId in this call's raw_output (the audit's own worst case -- a response with no valid picks at all). " +
          "Pass --event-id=<uuid> to replay against that card's fights instead.",
      );
    }
    const { data: fights, error: fightsError } = await supabase
      .from("fights")
      .select("id")
      .eq("event_id", eventIdFallback);
    if (fightsError) throw fightsError;
    fightIds = (fights ?? []).map((f) => f.id as string);
    if (fightIds.length === 0) throw new Error(`No fights found for event ${eventIdFallback}.`);
  }

  const { data: oneFight, error: oneFightError } = await supabase
    .from("fights")
    .select("event_id")
    .eq("id", fightIds[0])
    .single();
  if (oneFightError) throw oneFightError;
  const eventId = usedEventIdFallback ? eventIdFallback! : (oneFight.event_id as string);

  const { data: eventRow, error: eventError } = await supabase
    .from("events")
    .select("event_date")
    .eq("id", eventId)
    .single();
  if (eventError) throw eventError;
  const cardDate = eventRow.event_date as string;

  const { fightsById } = await buildFightFacts(supabase, fightIds, cardDate);
  if (fightsById.size === 0) {
    throw new Error(
      "None of this call's fights currently have both fighters' dossiers on file -- cannot rebuild the facts needed to replay against.",
    );
  }
  const facts: ShadowPickFacts = { eventId, fightsById };

  // Comparison only -- a mismatch means CURRENT facts (or fight ORDER;
  // `.in()` gives no ordering guarantee, and this rebuild does not try to
  // reproduce the original call's order) differ from what the call
  // actually saw, not that the parser broke (N9 audit finding #4).
  const rebuiltPrompt = buildShadowPicksPrompt([...fightsById.values()]);
  const rebuiltHash = hashCanonicalJson(rebuiltPrompt);
  const hashMatches = callRow.prompt_hash === rebuiltHash;

  console.log(`Replaying call ${callId} (${fightIds.length} fight id(s) found, event ${eventId}).`);
  console.log(
    hashMatches
      ? "Prompt hash matches the stored call -- current facts are unchanged since it ran."
      : `Prompt hash does NOT match the stored call (stored: ${callRow.prompt_hash ?? "none"}, rebuilt: ${rebuiltHash}) -- ` +
          "facts (or fight order) have drifted since the call ran. Treat any diff below as reflecting that drift too, not proof of a parser regression on its own.",
  );

  const outcome = replayLlmCall(rawOutput, eventId, callId, facts);

  console.log(
    `Parsed ${outcome.claimsProposed} claim(s), kept ${outcome.claimsKept} after verification, ` +
      `producing ${outcome.results.length} shadow-pick row(s).`,
  );
  if (Object.keys(outcome.dropReasons).length > 0) {
    console.log("Drop reasons:", outcome.dropReasons);
  }
  for (const result of outcome.results) {
    console.log(
      `  fight=${result.fightId} line=${result.line} predicted=${result.predictedFighterId} ` +
        `probability=${result.probability.toFixed(4)} confidence=${result.confidence ?? "n/a"}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
