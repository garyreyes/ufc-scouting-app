import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getClanById } from "@/features/clans/api";
import { MemberList } from "@/features/clans/components/MemberList";
import { InviteManager } from "@/features/clans/components/InviteManager";
import { LeaveClanButton } from "@/features/clans/components/LeaveClanButton";
import styles from "./page.module.css";

export default async function ClanDetailPage({ params }: PageProps<"/clans/[id]">) {
  const { id } = await params;

  // clans has no anon grant at all (by design -- only authenticated),
  // so a logged-out visitor must never reach the query, same fix as the
  // fight detail page: guard before querying, not after a crash.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return (
      <div>
        <h1>Sign in to view this clan</h1>
      </div>
    );
  }

  const clan = await getClanById(id);
  if (!clan) notFound();

  return (
    <div>
      <h1>{clan.name}</h1>

      <h2>Members</h2>
      <MemberList members={clan.members} />

      {clan.isOwner && (
        <>
          <h2 className={styles.sectionSpacing}>Invite members</h2>
          <InviteManager clanId={clan.id} invites={clan.invites} />
        </>
      )}

      <div className={styles.sectionSpacing}>
        <LeaveClanButton clanId={clan.id} />
      </div>
    </div>
  );
}
