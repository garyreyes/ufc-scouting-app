"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getConflictsBadgeAction } from "@/features/conflicts/actions";
import styles from "./Sidebar.module.css";

// Clans deliberately absent (H1, ROADMAP.md): the PRD's own "Should have"
// item is "retire or clearly hide the frozen clan surface from
// navigation" -- roadmap-planning already chose the hide option, routes
// stay reachable (/clans, /clans/[id], /invite/[token] all still resolve,
// unlinked), matching CLAUDE.md's "frozen, not deleted" posture for the
// whole v1 group feature set.
const NAV_ITEMS = [
  { href: "/events/upcoming", label: "Upcoming Events", icon: "\u{1F4C5}" },
  { href: "/events/past", label: "Past Events", icon: "\u{1F551}" },
  { href: "/fighters", label: "Fighters", icon: "\u{1F94A}" },
  { href: "/scoreboard", label: "Scoreboard", icon: "\u{1F4CA}" },
] as const;

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();

  return (
    <nav className={`${styles.sidebar} ${collapsed ? styles.collapsed : ""}`}>
      {NAV_ITEMS.map((item) => {
        const isActive = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`${styles.link} ${isActive ? styles.active : ""}`}
            title={collapsed ? item.label : undefined}
          >
            <span className={styles.icon} aria-hidden="true">
              {item.icon}
            </span>
            {!collapsed && <span className={styles.label}>{item.label}</span>}
          </Link>
        );
      })}
      <ConflictsNavItem collapsed={collapsed} isActive={pathname.startsWith("/conflicts")} />
    </nav>
  );
}

/**
 * Deliberately not a permanent nav item (docs/user-flows.md): appears
 * only once the count is confirmed positive AND the viewer is confirmed
 * the owner, checked client-side after mount via a gated server action
 * rather than in Sidebar's own render -- the owner check needs a real
 * session (cookies()), and doing that in the shared render path would
 * taint every page's caching the same way B5's JobHealthBanner originally
 * did (see PROJECT_FACTS.md). A permanently-visible, permanently-empty
 * queue trains you to ignore it -- the same failure as an always-red CI
 * gate -- so this renders nothing at all until there's something real to
 * show.
 */
function ConflictsNavItem({ collapsed, isActive }: { collapsed: boolean; isActive: boolean }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    getConflictsBadgeAction()
      .then(setCount)
      .catch(() => setCount(null));
  }, []);

  if (!count) return null;

  return (
    <Link
      href="/conflicts"
      className={`${styles.link} ${isActive ? styles.active : ""}`}
      title={collapsed ? "Conflicts" : undefined}
    >
      <span className={styles.icon} aria-hidden="true">
        {"⚠️"}
      </span>
      {!collapsed && (
        <span className={styles.label}>
          Conflicts <span className={styles.badge}>{count}</span>
        </span>
      )}
      {collapsed && <span className={styles.badgeCollapsed}>{count}</span>}
    </Link>
  );
}
