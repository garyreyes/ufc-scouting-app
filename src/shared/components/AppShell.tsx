"use client";

import { Suspense, useEffect, useState } from "react";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import styles from "./AppShell.module.css";

const COLLAPSE_STORAGE_KEY = "sidebar-collapsed";

export function AppShell({
  children,
  banner,
}: {
  children: React.ReactNode;
  // A Server Component instance created by layout.tsx and passed down as
  // a prop -- AppShell is a Client Component ("use client" above) and
  // can't import/render a Server Component (JobHealthBanner) directly
  // itself; this is the standard children-slot composition for that.
  banner?: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // Deliberate: server has no localStorage, so the initial render must
    // match its "false" output. Reading the real value in a lazy useState
    // initializer instead would cause a hydration mismatch.
    const stored = localStorage.getItem(COLLAPSE_STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored) setCollapsed(stored === "true");
  }, []);

  function toggleSidebar() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
      return next;
    });
  }

  return (
    <div className={styles.shell}>
      <Suspense fallback={<div className={styles.topbarFallback} />}>
        <TopBar collapsed={collapsed} onToggleSidebar={toggleSidebar} />
      </Suspense>
      <Sidebar collapsed={collapsed} />
      <main
        className={styles.content}
        style={{
          marginLeft: collapsed ? "var(--sidebar-width-collapsed)" : "var(--sidebar-width)",
        }}
      >
        {banner}
        {children}
      </main>
    </div>
  );
}
