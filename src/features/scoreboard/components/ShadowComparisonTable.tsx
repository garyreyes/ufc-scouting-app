import { Fragment } from "react";
import type { AccuracyLine, BrierScoreResult, ShadowLineScore, UnitsLine } from "../types";
import styles from "./ShadowComparisonTable.module.css";

const SMALL_SAMPLE_THRESHOLD = 10;

function formatAccuracy(line: AccuracyLine): string {
  if (line.accuracyPct === null) return "—";
  return `${Math.round(line.accuracyPct * 100)}% (${line.correct}/${line.total})`;
}

// N6: lower is better -- 0.25 is what an honest coin flip always scores.
function formatBrier(result: BrierScoreResult): string {
  if (result.score === null) return "—";
  return `${result.score.toFixed(3)} (n=${result.n})`;
}

function formatUnits(units: UnitsLine | null): string {
  if (units === null) return "n/a — no confidence to size a bet from";
  if (units.betsPlaced === 0) return "0.00u (no qualifying bets)";
  const sign = units.netUnits >= 0 ? "+" : "";
  return `${sign}${units.netUnits.toFixed(2)}u (${units.betsPlaced} bet${units.betsPlaced === 1 ? "" : "s"})`;
}

// O3 (Track B): a short display label, not the raw provider string --
// 'gemini'/'groq' are stable identifiers (matching shadow_picks.provider,
// 0061), this is presentation only.
function providerLabel(provider: string): string {
  if (provider === "gemini") return "Gemini";
  if (provider === "groq") return "Groq";
  return provider;
}

/**
 * N9's readout: the deterministic rule (Fork 10) against N8's two shadow
 * lines, over the exact same scored population (`scoredFightCount`) --
 * never the intern's whole settled history, which would compare against
 * a different, larger population than the one the LLM lines were ever
 * scored over. Lives as its own section below `PickHistoryTable`, not
 * folded into the boards above (N9 scope, confirmed 2026-09-19): those
 * boards are the owner's real headline numbers, this is a forward-only
 * shadow experiment, not a fourth competing "official" line.
 *
 * LLM_ONLY never shows a units row with a number in it -- it has no
 * `confidence`, so `decideInternBet` structurally cannot run for it, and
 * a "0.00u" there would misleadingly read as "placed bets and broke
 * even" rather than "this line was never bet at all."
 */
export function ShadowComparisonTable({
  data,
}: {
  data: {
    scoredFightCount: number;
    deterministic: { accuracy: AccuracyLine; brier: BrierScoreResult; units: UnitsLine };
    providers: { provider: string; llmAssisted: ShadowLineScore; llmOnly: ShadowLineScore }[];
  } | null;
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.title}>Shadow comparison</h2>
      <p className={styles.subtitle}>
        The deterministic rule against N8&rsquo;s two forward-only LLM shadow lines, scored on the same fights.
      </p>

      {data === null ? (
        <p className={styles.empty}>No shadow picks have settled yet.</p>
      ) : (
        <>
          {data.scoredFightCount < SMALL_SAMPLE_THRESHOLD && (
            <p className={styles.subtitle}>
              Small sample — {data.scoredFightCount} fight{data.scoredFightCount === 1 ? "" : "s"} scored so far
              (target: {SMALL_SAMPLE_THRESHOLD}). Not a verdict yet.
            </p>
          )}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Accuracy</th>
                  <th>Brier</th>
                  <th>Units</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Deterministic</td>
                  <td>{formatAccuracy(data.deterministic.accuracy)}</td>
                  <td>{formatBrier(data.deterministic.brier)}</td>
                  <td>{formatUnits(data.deterministic.units)}</td>
                </tr>
                {data.providers.map(({ provider, llmAssisted, llmOnly }) => (
                  <Fragment key={provider}>
                    <tr>
                      <td>LLM-assisted ({providerLabel(provider)})</td>
                      <td>{formatAccuracy(llmAssisted.accuracy)}</td>
                      <td>{formatBrier(llmAssisted.brier)}</td>
                      <td>{formatUnits(llmAssisted.units)}</td>
                    </tr>
                    <tr>
                      <td>LLM-only ({providerLabel(provider)})</td>
                      <td>{formatAccuracy(llmOnly.accuracy)}</td>
                      <td>{formatBrier(llmOnly.brier)}</td>
                      <td>{formatUnits(llmOnly.units)}</td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
