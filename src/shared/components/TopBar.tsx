"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { WeightClassFilter } from "./WeightClassFilter";
import { ThemeToggle } from "./ThemeToggle";
import styles from "./TopBar.module.css";

export function TopBar({
  collapsed,
  onToggleSidebar,
}: {
  collapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    router.push(`/fighters?${params.toString()}`);
  }

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <button
          type="button"
          className={styles.hamburger}
          onClick={onToggleSidebar}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <span />
          <span />
          <span />
        </button>
        <Link href="/events/upcoming" className={styles.brand}>
          UFC Scouting
        </Link>
      </div>
      <form className={styles.searchArea} onSubmit={handleSubmit}>
        <input
          type="search"
          placeholder="Search fighters"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={styles.searchInput}
        />
        <button type="submit" className={styles.searchButton} aria-label="Search">
          &#128269;
        </button>
        <WeightClassFilter />
      </form>
      <ThemeToggle />
    </header>
  );
}
