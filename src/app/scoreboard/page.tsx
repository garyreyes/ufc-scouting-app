import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/auth";
import { getScoreboardData } from "@/features/scoreboard/api";
import { UnitsBoard } from "@/features/scoreboard/components/UnitsBoard";
import { AccuracyBoard } from "@/features/scoreboard/components/AccuracyBoard";
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

  if (!isOwner(user.id)) {
    return (
      <div>
        <h1>Scoreboard</h1>
        <p>Not available.</p>
      </div>
    );
  }

  const data = await getScoreboardData(supabase);

  // The state for the first card or two (docs/user-flows.md) -- a blank
  // chart here is a failure, so this gets real copy explaining why,
  // rather than an empty board or nothing at all.
  if (data.accuracy.me.total === 0) {
    return (
      <div>
        <h1>Scoreboard</h1>
        <p className={styles.empty}>No settled picks yet — the chalk line appears after the first card.</p>
      </div>
    );
  }

  const isSmallSample = data.settledCardCount < SMALL_SAMPLE_THRESHOLD;

  return (
    <div>
      <h1>Scoreboard</h1>

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
    </div>
  );
}
