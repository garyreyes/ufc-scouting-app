"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./Sidebar.module.css";

const NAV_ITEMS = [
  { href: "/events/upcoming", label: "Upcoming Events", icon: "\u{1F4C5}" },
  { href: "/events/past", label: "Past Events", icon: "\u{1F551}" },
  { href: "/fighters", label: "Fighters", icon: "\u{1F94A}" },
  { href: "/clans", label: "Clans", icon: "\u{1F465}" },
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
    </nav>
  );
}
