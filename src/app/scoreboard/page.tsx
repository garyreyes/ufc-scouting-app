import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/auth";
import { describeOwnerConfigError } from "@/lib/describeOwnerConfigError";
import { OwnerConfigNotice } from "@/shared/components/OwnerConfigNotice";
import { getScoreboardData } from "@/features/scoreboard/api";
import { UnitsBoard } from "@/features/scoreboard/components/UnitsBoard";
import { AccuracyBoard } from "@/features/scoreboard/components/AccuracyBoard";
import { CalibrationTable } from "@/features/scoreboard/components/CalibrationTable";
import { PickHistoryTable } from "@/features/scoreboard/components/PickHistoryTable";
import { PendingSummary } from "@/features/scoreboard/components/PendingSummary";
import styles from "./page.module.css";

const SMALL_SAMPLE_THRESHOLD = 10;

// Owner-gated per docs/user-flows.md's auth-gate table ("/scoreboard,
// /conflicts": sign-in prompt / "not available" / full). Gates render in
// place, they do not redirect -- same shipped convention as /conflicts.
export default async function ScoreboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div>
        <h1>Scoreboard</h1>
        <p>Sign in to view the scoreboard.</p>
      </div>
    );
  }

  // A missing OWNER_USER_ID (found live 2026-09-02) previously crashed
  // this whole page with an opaque error before it even reached the
  // "Not available" branch below. Now it reaches that same branch --
  // this page has no meaningful content for a non-owner anyway -- plus a
  // loud, specific notice explaining why. Any other thrown error is a
  // real bug and still rethrows.
  let ownerConfigError: string | null = null;
  let isRealOwner = false;
  try {
    isRealOwner = isOwner(user.id);
  } catch (err) {
    const described = describeOwnerConfigError(err);
    if (!described) throw err;
    ownerConfigError = described;
  }

  if (!isRealOwner) {
    return (
      <div>
        <h1>Scoreboard</h1>
        {ownerConfigError && <OwnerConfigNotice message={ownerConfigError} />}
        <p>Not available.</p>
      </div>
    );
  }

  const data = await getScoreboardData(supabase);
  const hasPending = data.pending.me.picks > 0 || data.pending.intern.picks > 0;

  // The state for the first card or two (docs/user-flows.md) -- a blank
  // chart here is a failure. The gate is now "neither side has a settled
  // pick," not "I have none": the intern picks far more fights than the
  // owner ever will, so it settles picks first, and its board line
  // should show the moment it has one rather than waiting on the owner.
  // The pending summary still renders here so the page says what's
  // riding even when nothing has scored.
  if (data.accuracy.me.total === 0 && data.accuracy.intern.total === 0) {
    return (
      <div>
        <h1>Scoreboard</h1>
        {hasPending && <PendingSummary pending={data.pending} />}
        <p className={styles.empty}>
          No picks have settled yet — the boards fill in as fights resolve.
        </p>
      </div>
    );
  }

  const isSmallSample = data.settledCardCount < SMALL_SAMPLE_THRESHOLD;

  return (
    <div>
      <h1>Scoreboard</h1>

      {hasPending && <PendingSummary pending={data.pending} />}

      {isSmallSample && (
        <p className={styles.notice}>
          Small sample — {data.settledCardCount} card{data.settledCardCount === 1 ? "" : "s"} settled so far
          (target: {SMALL_SAMPLE_THRESHOLD}). Not a verdict yet.
        </p>
      )}

      {data.unpricedSettledPickCount > 0 && (
        <p className={styles.notice}>
          {data.unpricedSettledPickCount} settled pick{data.unpricedSettledPickCount === 1 ? "" : "s"} never got a
          price (a missed snapshot) — counted in accuracy, excluded from units.
        </p>
      )}

      <div className={styles.boards}>
        <UnitsBoard me={data.units.me} intern={data.units.intern} chalk={data.units.chalk} />
        <AccuracyBoard me={data.accuracy.me} intern={data.accuracy.intern} chalk={data.accuracy.chalk} />
      </div>

      <CalibrationTable me={data.calibration.me} intern={data.calibration.intern} />

      <PickHistoryTable rows={data.pickHistory} />
    </div>
  );
}
