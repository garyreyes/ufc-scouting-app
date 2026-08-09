import type { ClanMember } from "../types";
import styles from "./MemberList.module.css";

export function MemberList({ members }: { members: ClanMember[] }) {
  return (
    <ul className={styles.list}>
      {members.map((member) => (
        <li key={member.user_id} className={styles.item}>
          {member.display_name ?? "Unnamed member"}
        </li>
      ))}
    </ul>
  );
}
