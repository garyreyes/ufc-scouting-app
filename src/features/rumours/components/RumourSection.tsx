import { CATEGORY_LABELS } from "@/lib/rumours/concernKeywords";
import { postUriToWebUrl } from "../postUriToWebUrl";
import type { RumourFlagDetail } from "../types";
import styles from "./RumourSection.module.css";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * /fights/[id]'s full rumour section -- docs/user-flows.md: "every rumour
 * source with its links." Grouped by fighter, since a concern is always
 * about one specific fighter (PRD UC-1), never the fight in the
 * abstract. The intern never gives a credibility verdict (UC-1,
 * explicitly) and neither does this component -- corroboration count,
 * sourcing, and links are shown; judging them is the viewer's job.
 * Renders nothing when there are no flags for this fight -- a "no rumours"
 * empty state here would just be noise on the far more common clean-card
 * case, unlike /scoreboard's empty state which is a deliberate first-run
 * message.
 */
export function RumourSection({
  fighter1,
  fighter2,
  flags,
}: {
  fighter1: { id: string; name: string };
  fighter2: { id: string; name: string };
  flags: RumourFlagDetail[];
}) {
  if (flags.length === 0) return null;

  const flagsByFighter = [fighter1, fighter2].map((fighter) => ({
    fighter,
    flags: flags.filter((f) => f.fighterId === fighter.id),
  }));

  return (
    <section className={styles.section}>
      <h2>Rumours</h2>
      {flagsByFighter.map(
        ({ fighter, flags: fighterFlags }) =>
          fighterFlags.length > 0 && (
            <div key={fighter.id} className={styles.fighterGroup}>
              <h3>{fighter.name}</h3>
              {fighterFlags.map((flag) => (
                <FlagCard key={flag.id} flag={flag} />
              ))}
            </div>
          ),
      )}
    </section>
  );
}

function FlagCard({ flag }: { flag: RumourFlagDetail }) {
  return (
    <article className={styles.flagCard}>
      <div className={styles.flagHeader}>
        <span className={styles.category}>{CATEGORY_LABELS[flag.category]}</span>
        <span className={styles.corroboration}>
          {flag.corroborationCount} independent source{flag.corroborationCount === 1 ? "" : "s"}
        </span>
      </div>
      <p className={styles.summary}>{flag.summary}</p>
      <ul className={styles.sourceList}>
        {flag.sources.map((source) => {
          const webUrl = postUriToWebUrl(source.uri, source.authorHandle);
          return (
            <li key={source.uri} className={styles.source}>
              <div className={styles.sourceMeta}>
                <span className={styles.author}>
                  @{source.authorHandle}
                  {source.isNamedSource && <span className={styles.namedBadge}>named source</span>}
                </span>
                <span className={styles.date}>{formatDate(source.postCreatedAt)}</span>
              </div>
              <p className={styles.excerpt}>{source.excerpt}</p>
              <div className={styles.links}>
                {webUrl && (
                  <a href={webUrl} target="_blank" rel="noopener noreferrer">
                    View post →
                  </a>
                )}
                {source.externalUrl && (
                  <a href={source.externalUrl} target="_blank" rel="noopener noreferrer">
                    Read article →
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
