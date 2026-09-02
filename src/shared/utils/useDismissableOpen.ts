"use client";

import { useEffect, type RefObject } from "react";

/**
 * Shared by every trigger+panel disclosure widget (WeightClassFilter,
 * AuthButton). Both had the identical real gap, found in H2's full-app
 * audit: outside-click closed the panel, but nothing closed it on
 * Escape, and focus was never returned to the trigger -- leaving a
 * keyboard-only user with no way out except tabbing through every option
 * inside it. Extracted the moment a second component needed the same
 * fix, per CLAUDE.md's layer-boundary rule (shared logic belongs in
 * shared/, not duplicated per feature).
 */
export function useDismissableOpen(
  open: boolean,
  onClose: () => void,
  containerRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose, containerRef, triggerRef]);
}
