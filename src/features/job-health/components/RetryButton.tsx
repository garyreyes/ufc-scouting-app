"use client";

import { useEffect, useState, useTransition } from "react";
import { checkCanRetryAction, retryOddsJobAction } from "../actions";
import styles from "./JobHealthBanner.module.css";

/**
 * Checks ownership itself, client-side after mount, rather than the
 * server-rendered JobHealthBanner deciding it -- see actions.ts's
 * checkCanRetryAction docstring for why. Renders nothing until that
 * check resolves true, so a non-owner viewer never sees a button that
 * would just fail; retryOddsJobAction re-checks ownership server-side
 * regardless, which remains the actual security boundary either way.
 */
export function RetryButton() {
  const [canRetry, setCanRetry] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<"idle" | "success" | "error">("idle");

  useEffect(() => {
    checkCanRetryAction()
      .then(setCanRetry)
      .catch(() => setCanRetry(false));
  }, []);

  if (!canRetry) return null;

  function handleClick() {
    startTransition(async () => {
      try {
        await retryOddsJobAction();
        setResult("success");
      } catch {
        setResult("error");
      }
    });
  }

  return (
    <div className={styles.retryRow}>
      <button type="button" className={styles.retryButton} onClick={handleClick} disabled={isPending}>
        {isPending ? "Retrying…" : "Retry now"}
      </button>
      {result === "success" && (
        <span className={styles.retryNote}>Done — reload to see the updated status.</span>
      )}
      {result === "error" && <span className={styles.retryNote}>Retry failed.</span>}
    </div>
  );
}
