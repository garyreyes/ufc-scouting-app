"use client";

import type { ClanMember } from "../types";
import { removeMember } from "../actions";
import styles from "./MemberList.module.css";

export function MemberList({
  clanId,
  members,
  isOwner,
  currentUserId,
}: {
  clanId: string;
  members: ClanMember[];
  isOwner: boolean;
  currentUserId: string | null;
}) {
  return (
    <ul className={styles.list}>
      {members.map((member) => (
        <li key={member.user_id} className={styles.item}>
          <span>{member.display_name ?? "Unnamed member"}</span>
          {isOwner && member.user_id !== currentUserId && (
            <button
              type="button"
              className={styles.remove}
              onClick={() => {
                if (confirm(`Remove ${member.display_name ?? "this member"} from the clan?`)) {
                  removeMember(clanId, member.user_id);
                }
              }}
            >
              Remove
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
