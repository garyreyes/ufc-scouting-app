import type { ConflictDisplay } from "../types";
import { DisputedOpponentCard } from "./DisputedOpponentCard";
import { LowConfidenceCard } from "./LowConfidenceCard";
import { DisputedResultCard } from "./DisputedResultCard";

// One queue, three kinds (ARCHITECTURE.md Fork 5, plus disputed_result
// from D1) -- this is the single dispatch point, so the page itself
// doesn't need to know the shapes apart. Switched, not if/else-fallthrough:
// an unhandled kind is a compile error here rather than silently
// rendering the wrong card's shape (the exact risk a new kind landing
// without a matching UI branch would otherwise create).
export function ConflictCard({ conflict }: { conflict: ConflictDisplay }) {
  switch (conflict.kind) {
    case "disputed_opponent":
      return <DisputedOpponentCard conflict={conflict} />;
    case "low_confidence_odds_match":
      return <LowConfidenceCard conflict={conflict} />;
    case "disputed_result":
      return <DisputedResultCard conflict={conflict} />;
    default: {
      // Compile-time exhaustiveness check, not just convention: adding a
      // new kind without a matching case above breaks this build, since
      // `strict` alone (tsconfig.json) doesn't turn a missing switch case
      // into an error on its own -- this assignment is what actually
      // does.
      const exhaustive: never = conflict;
      return exhaustive;
    }
  }
}
