import styles from "./OwnerConfigNotice.module.css";

/**
 * Shown only to a logged-in viewer who hit describeOwnerConfigError.ts's
 * recognized case -- OWNER_USER_ID or SUPABASE_SERVICE_ROLE_KEY missing
 * on this deployment, found live 2026-09-02 (a missing env var crashed
 * every owner-gated page with an opaque Next.js error digest). The page
 * around this still renders its normal read-only view; this is the
 * "loud" half of "read-only, but loud, not a silent downgrade" --
 * user-confirmed over both "keep hard-crashing" and "leave it as is."
 */
export function OwnerConfigNotice({ message }: { message: string }) {
  return (
    <p className={styles.notice} role="status">
      {message}
    </p>
  );
}
