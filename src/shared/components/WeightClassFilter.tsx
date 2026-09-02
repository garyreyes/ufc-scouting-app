"use client";

import { useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { WEIGHT_CLASSES } from "@/shared/utils/weightClasses";
import { useDismissableOpen } from "@/shared/utils/useDismissableOpen";
import styles from "./WeightClassFilter.module.css";

export function WeightClassFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selected = searchParams.getAll("weightClass");

  useDismissableOpen(open, () => setOpen(false), containerRef, triggerRef);

  function toggle(weightClass: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("weightClass");
    const nextSelected = selected.includes(weightClass)
      ? selected.filter((w) => w !== weightClass)
      : [...selected, weightClass];
    for (const w of nextSelected) next.append("weightClass", w);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className={styles.container} ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${selected.length > 0 ? styles.active : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        Filter{selected.length > 0 ? ` (${selected.length})` : ""}
      </button>
      {open && (
        <div className={styles.panel}>
          {WEIGHT_CLASSES.map((weightClass) => (
            <label key={weightClass} className={styles.option}>
              <input
                type="checkbox"
                checked={selected.includes(weightClass)}
                onChange={() => toggle(weightClass)}
              />
              {weightClass}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
