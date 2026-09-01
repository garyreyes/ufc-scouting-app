import type { ConflictDisplay } from "../types";
import { DisputedOpponentCard } from "./DisputedOpponentCard";
import { LowConfidenceCard } from "./LowConfidenceCard";

// One queue, two kinds (ARCHITECTURE.md Fork 5) -- this is the single
// dispatch point, so the page itself doesn't need to know the two shapes
// apart.
export function ConflictCard({ conflict }: { conflict: ConflictDisplay }) {
  if (conflict.kind === "disputed_opponent") {
    return <DisputedOpponentCard conflict={conflict} />;
  }
  return <LowConfidenceCard conflict={conflict} />;
}
