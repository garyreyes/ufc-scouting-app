import { notFound } from "next/navigation";
import { getClanById } from "@/features/clans/api";
import { MemberList } from "@/features/clans/components/MemberList";
import { InviteManager } from "@/features/clans/components/InviteManager";
import { LeaveClanButton } from "@/features/clans/components/LeaveClanButton";
import styles from "./page.module.css";

export default async function ClanDetailPage({ params }: PageProps<"/clans/[id]">) {
  const { id } = await params;
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
