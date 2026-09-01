"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isOwner } from "@/lib/auth";
import { runOddsJobsOnce } from "@/lib/odds/runOddsJobsOnce";
import type { OddsJobsSummary } from "@/lib/odds/runOddsJobsOnce";

/**
 * The "manual late pull, accepting the worse price" action (ROADMAP.md
 * B5, docs/PRD.md #9) -- lets the owner run the same odds job the T-12h
 * cron runs, on demand, when the banner shows it's missed or broken.
 *
 * Unlike A3's picks-table allowlist, RLS can't be the real boundary here:
 * odds_snapshots and job_runs have no INSERT grant for anon/authenticated
 * at all (service-role only), so this necessarily runs through the
 * service-role admin client. That means the isOwner() check below -- done
 * against the real session, server-side, never a client-supplied id -- IS
 * the actual security boundary for this one action, not just a UX
 * convenience the way lib/auth.ts's own docstring describes its usual
 * role. Get this check wrong and any signed-in stranger could trigger
 * production writes.
 */
/**
 * Whether the current viewer is the owner -- called from RetryButton on
 * mount (client-side, after hydration), not from JobHealthBanner's own
 * server render. Doing the cookies()-based auth check there instead of in
 * the render path is deliberate: cookies() forces Next to treat the whole
 * page as dynamic, which would have silently downgraded `/`,
 * `/events/past`, and `/events/upcoming` from static+revalidated to
 * server-rendered on every request -- found by comparing `next build`'s
 * route table before and after this check existed. A boolean answering
 * "are you the owner" carries no security weight of its own (the real
 * boundary is retryOddsJobAction's own check); this only decides whether
 * to show a button.
 */
export async function checkCanRetryAction(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return isOwner(user?.id);
}

export async function retryOddsJobAction(): Promise<OddsJobsSummary> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isOwner(user?.id)) {
    throw new Error("Not authorized");
  }

  const admin = getSupabaseAdmin();
  const summary = await runOddsJobsOnce(admin);

  // The banner reads job_runs/odds_snapshots-derived data on whatever page
  // it's mounted on (the whole app shell), so revalidate broadly rather
  // than guessing one path.
  revalidatePath("/", "layout");

  return summary;
}
