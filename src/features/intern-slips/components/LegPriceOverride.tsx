"use client";

import { useState, useTransition } from "react";
import { setInternLegPriceAction } from "../actions";
import styles from "./InternSlips.module.css";

// Progressive disclosure: an estimated method price is right most of the
// time you'll never touch it, so the control stays a small "book price"
// button until it's wanted.
export function LegPriceOverride({ legId, currentPrice }: { legId: string; currentPrice: number }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(currentPrice));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" className={styles.overrideButton} onClick={() => setOpen(true)}>
        Book price
      </button>
    );
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await setInternLegPriceAction(legId, Number(value));
      if (result.error) setError(result.error);
      else setOpen(false);
    });
  }

  return (
    <span className={styles.overrideRow}>
      <input
        className={styles.overrideInput}
        type="number"
        inputMode="decimal"
        step="0.01"
        min="1.01"
        value={value}
        aria-label="Real book price (decimal)"
        onChange={(e) => setValue(e.target.value)}
        autoFocus
      />
      <button type="button" className={styles.saveButton} onClick={save} disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
      <button type="button" className={styles.cancelButton} onClick={() => setOpen(false)} disabled={pending}>
        Cancel
      </button>
      {error && <span className={styles.error}>{error}</span>}
    </span>
  );
}
