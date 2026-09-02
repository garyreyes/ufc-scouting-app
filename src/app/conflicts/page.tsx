import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/auth";
import { describeOwnerConfigError } from "@/lib/describeOwnerConfigError";
import { OwnerConfigNotice } from "@/shared/components/OwnerConfigNotice";
import { getOpenConflicts } from "@/features/conflicts/api";
import { ConflictCard } from "@/features/conflicts/components/ConflictCard";

// Owner-gated per docs/user-flows.md's auth-gate table ("/scoreboard,
// /conflicts": sign-in prompt / "not available" / full). Gates render in
// place, they do not redirect -- same shipped convention as /clans.
export default async function ConflictsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div>
        <h1>Conflicts</h1>
        <p>Sign in to view conflicts.</p>
      </div>
    );
  }

  // A missing OWNER_USER_ID or SUPABASE_SERVICE_ROLE_KEY (found live
  // 2026-09-02) previously crashed this whole page with an opaque error.
  // This is an owner-only page with no meaningful content for anyone
  // else, so falling back reaches the same "Not available" branch that
  // already exists for a real non-owner -- plus a loud, specific notice
  // explaining why. Any other thrown error is a real bug and still
  // rethrows.
  let ownerConfigError: string | null = null;
  let conflicts: Awaited<ReturnType<typeof getOpenConflicts>> = [];
  let isRealOwner = false;
  try {
    isRealOwner = isOwner(user.id);
    if (isRealOwner) conflicts = await getOpenConflicts();
  } catch (err) {
    const described = describeOwnerConfigError(err);
    if (!described) throw err;
    ownerConfigError = described;
  }

  if (!isRealOwner) {
    return (
      <div>
        <h1>Conflicts</h1>
        {ownerConfigError && <OwnerConfigNotice message={ownerConfigError} />}
        <p>Not available.</p>
      </div>
    );
  }

  if (conflicts.length === 0) {
    return (
      <div>
        <h1>Conflicts</h1>
        {/* The GOOD state (docs/user-flows.md) -- must read as resolved,
            not blank or broken. */}
        <p>Nothing needs review. Every fight is confidently matched.</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Conflicts ({conflicts.length})</h1>
      {conflicts.map((conflict) => (
        <ConflictCard key={conflict.id} conflict={conflict} />
      ))}
    </div>
  );
}
