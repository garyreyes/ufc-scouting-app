import Link from "next/link";
import { CATEGORY_LABELS } from "@/lib/rumours/concernKeywords";
import type { RumourFlagSummary } from "../types";
import styles from "./RumourBadge.module.css";

/**
 * The collapsed bout row's "rumour-flag badge" (docs/user-flows.md).
 * Deliberately terse -- categories and corroboration detail are one tap
 * away on /fights/[id] (progressive disclosure), not crammed into the
 * card view where a user is scanning a whole card at once. Renders
 * nothing when this fighter has no flags -- a badge that always shows
 * "0" would compete for attention on every clean fighter, every row.
 */
export function RumourBadge({ fightId, flags }: { fightId: string; flags: RumourFlagSummary[] }) {
  if (flags.length === 0) return null;

  const categoryList = [...new Set(flags.map((f) => CATEGORY_LABELS[f.category]))].join(", ");
  const totalSources = flags.reduce((sum, f) => sum + f.corroborationCount, 0);

  return (
    <Link
      href={`/fights/${fightId}`}
      className={styles.badge}
      title={`${categoryList} (${totalSources} source${totalSources === 1 ? "" : "s"})`}
    >
      ⚠ {flags.length === 1 ? categoryList : `${flags.length} flags`}
    </Link>
  );
}
