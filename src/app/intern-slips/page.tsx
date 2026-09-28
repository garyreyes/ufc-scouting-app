import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/auth";
import { describeOwnerConfigError } from "@/lib/describeOwnerConfigError";
import { OwnerConfigNotice } from "@/shared/components/OwnerConfigNotice";
import { getInternSlipsPageData } from "@/features/intern-slips/api";
import { InternSlipsView } from "@/features/intern-slips/components/InternSlipsView";
import styles from "@/features/intern-slips/components/InternSlips.module.css";

// Phase T5. Owner-gated identically to /betting and /scoreboard -- the
// tables it reads are "owner reads all" (0064), and RLS is the real gate.
export default async function InternSlipsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div>
        <h1>Intern Slips</h1>
        <p>Sign in to view the Intern&apos;s slips.</p>
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
        <h1>Intern Slips</h1>
        {ownerConfigError && <OwnerConfigNotice message={ownerConfigError} />}
        <p>Not available.</p>
      </div>
    );
  }

  const data = await getInternSlipsPageData(supabase);

  return (
    <div>
      <h1>Intern Slips</h1>
      <p className={styles.intro}>
        The Intern&apos;s own bets on each card, against its own paper bankroll — separate from your journal and from
        the pick scoreboard.
      </p>
      <InternSlipsView data={data} />
    </div>
  );
}
