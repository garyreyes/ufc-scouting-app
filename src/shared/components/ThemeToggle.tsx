"use client";

import { useEffect, useState } from "react";
import styles from "./ThemeToggle.module.css";

const THEME_STORAGE_KEY = "theme";

export function ThemeToggle() {
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    // Deliberate: server has no `document`, so the initial render must
    // match its "false" (dark) output. Reading the real value in a lazy
    // useState initializer instead would cause a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLight(document.documentElement.dataset.theme === "light");
  }, []);

  function toggle() {
    const next = isLight ? "dark" : "light";
    if (next === "dark") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = "light";
    }
    localStorage.setItem(THEME_STORAGE_KEY, next);
    setIsLight(next === "light");
  }

  return (
    <button type="button" className={styles.button} onClick={toggle} aria-label="Toggle dark mode">
      {isLight ? "\u{1F319}" : "\u{2600}\u{FE0F}"}
    </button>
  );
}
