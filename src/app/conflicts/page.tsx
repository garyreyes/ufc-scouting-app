import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/auth";
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

  if (!isOwner(user.id)) {
    return (
      <div>
        <h1>Conflicts</h1>
        <p>Not available.</p>
      </div>
    );
  }

  const conflicts = await getOpenConflicts();

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
