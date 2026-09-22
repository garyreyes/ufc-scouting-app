import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/auth";
import { describeOwnerConfigError } from "@/lib/describeOwnerConfigError";
import { OwnerConfigNotice } from "@/shared/components/OwnerConfigNotice";
import { getUpcomingEvents } from "@/features/fights/api";
import { getOpenSlips } from "@/features/betting/api";
import { SlipForm } from "@/features/betting/components/SlipForm";
import { SlipList } from "@/features/betting/components/SlipList";

// Owner-gated the same way /scoreboard and /conflicts are (docs/
// user-flows.md's auth-gate table) -- this is personal financial data,
// strictly more sensitive than picks, and RLS ("bet_slips: owner reads
// all", 0064) already returns zero rows for anyone else regardless.
export default async function BettingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div>
        <h1>Betting journal</h1>
        <p>Sign in to view your slips.</p>
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
        <h1>Betting journal</h1>
        {ownerConfigError && <OwnerConfigNotice message={ownerConfigError} />}
        <p>Not available.</p>
      </div>
    );
  }

  const [events, openSlips] = await Promise.all([getUpcomingEvents(), getOpenSlips(supabase)]);

  return (
    <div>
      <h1>Betting journal</h1>
      <p>
        <Link href="/betting/report">ROI by archetype, bankroll curve &amp; Intern head-to-head &rarr;</Link>
      </p>
      <SlipForm events={events} />
      <SlipList slips={openSlips} />
    </div>
  );
}
