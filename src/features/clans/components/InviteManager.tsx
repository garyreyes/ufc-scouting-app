"use client";

import { useState } from "react";
import { createInvite, revokeInvite } from "../actions";
import type { ClanInvite } from "../types";
import styles from "./InviteManager.module.css";

export function InviteManager({ clanId, invites }: { clanId: string; invites: ClanInvite[] }) {
  const [pending, setPending] = useState(false);

  return (
    <div className={styles.container}>
      <button
        type="button"
        className={styles.createButton}
        disabled={pending}
        onClick={async () => {
          setPending(true);
          await createInvite(clanId);
          setPending(false);
        }}
      >
        {pending ? "Creating…" : "Create invite link"}
      </button>
      {invites.length > 0 && (
        <ul className={styles.list}>
          {invites.map((invite) => (
            <InviteRow key={invite.id} invite={invite} clanId={clanId} />
          ))}
        </ul>
      )}
    </div>
  );
}

function InviteRow({ invite, clanId }: { invite: ClanInvite; clanId: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/invite/${invite.token}`;

  return (
    <li className={`${styles.row} ${invite.revoked ? styles.revoked : ""}`}>
      <span className={styles.url}>{invite.revoked ? "Revoked" : url}</span>
      {!invite.revoked && (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.action}
            onClick={() => {
              navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          <button
            type="button"
            className={styles.action}
            onClick={() => revokeInvite(invite.id, clanId)}
          >
            Revoke
          </button>
        </div>
      )}
    </li>
  );
}
