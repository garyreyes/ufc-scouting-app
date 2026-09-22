"use client";

import { useState, useTransition } from "react";
import { cashOutSlipAction, deleteSlipAction } from "../actions";
import styles from "./SlipList.module.css";

export function SlipActions({ slipId }: { slipId: string }) {
  const [cashingOut, setCashingOut] = useState(false);
  const [payoutInput, setPayoutInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submitCashOut() {
    setError(null);
    const payout = Number(payoutInput);
    if (!(payout >= 0)) {
      setError("Payout must be 0 or more.");
      return;
    }
    startTransition(async () => {
      try {
        await cashOutSlipAction(slipId, payout);
        setCashingOut(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Cash-out failed");
      }
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      try {
        await deleteSlipAction(slipId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete failed");
      }
    });
  }

  return (
    <div className={styles.actions}>
      {cashingOut ? (
        <div className={styles.cashOutRow}>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="Payout received (₱)"
            value={payoutInput}
            onChange={(e) => setPayoutInput(e.target.value)}
            className={styles.cashOutInput}
          />
          <button type="button" className={styles.confirmButton} onClick={submitCashOut} disabled={isPending}>
            Confirm
          </button>
          <button type="button" className={styles.cancelButton} onClick={() => setCashingOut(false)} disabled={isPending}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          <button type="button" className={styles.cashOutButton} onClick={() => setCashingOut(true)} disabled={isPending}>
            Cash out
          </button>
          <button type="button" className={styles.deleteButton} onClick={remove} disabled={isPending}>
            Delete
          </button>
        </>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
