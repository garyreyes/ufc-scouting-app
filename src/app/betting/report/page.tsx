import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/auth";
import { describeOwnerConfigError } from "@/lib/describeOwnerConfigError";
import { OwnerConfigNotice } from "@/shared/components/OwnerConfigNotice";
import { getBettingReportData } from "@/features/betting/reportApi";
import { ArchetypeRoiBoard } from "@/features/betting/report/components/ArchetypeRoiBoard";
import { BankrollCurveChart } from "@/features/betting/report/components/BankrollCurveChart";
import { HeadToHeadBoard } from "@/features/betting/report/components/HeadToHeadBoard";
import styles from "./page.module.css";

// Owner-gated identically to /betting and /scoreboard (docs/user-flows.md's
// auth-gate table) -- this reads the same tables /betting already gates,
// plus picks, which /scoreboard already gates the same way.
export default async function BettingReportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div>
        <h1>Betting report</h1>
        <p>Sign in to view your report.</p>
      </div>
    );
  }

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
        <h1>Betting report</h1>
        {ownerConfigError && <OwnerConfigNotice message={ownerConfigError} />}
        <p>Not available.</p>
      </div>
    );
  }

  const data = await getBettingReportData(supabase);

  return (
    <div>
      <h1>Betting report</h1>
      <p className={styles.backLink}>
        <Link href="/betting">&larr; Record &amp; open slips</Link>
      </p>
      <div className={styles.grid}>
        <ArchetypeRoiBoard overall={data.overall} byArchetype={data.byArchetype} />
        <BankrollCurveChart points={data.bankrollCurve} />
        <HeadToHeadBoard
          owner={data.headToHead.owner}
          intern={data.headToHead.intern}
          pairs={data.headToHead.pairs}
        />
      </div>
    </div>
  );
}
