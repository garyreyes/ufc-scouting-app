import { nameSimilarity } from "../text/nameSimilarity";
import type { FighterCandidate } from "./types";

// Candidates are always scoped to one fight's own two fighters, never the
// full roster -- see types.ts's FighterCandidate comment for why that
// already closes most of the cross-fighter ambiguity risk PRD's edge
// cases name (Silva, Rodriguez, Nurmagomedov).

// For resolveFighterMention: the LLM is instructed to echo one of the two
// exact names it was given, so this only needs to tolerate minor
// rephrasing/truncation, not a fuzzy free-text search.
const NAME_MATCH_THRESHOLD = 0.7;

// For findFighterMentionInText: a single word from a real post compared
// against a fighter's bare last name. Lower than the whole-name threshold
// on purpose -- short strings produce noisier bigram scores -- but still
// high enough to reject an unrelated word.
const MENTION_MATCH_THRESHOLD = 0.75;

function lastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

function tokenize(text: string): string[] {
  return text.split(/[^\p{L}\p{N}'-]+/u).filter(Boolean);
}

/**
 * Resolves a name string (as returned by the LLM clustering step) to
 * whichever of the two real fighters it confidently matches. Returns null
 * -- never a guess -- when neither clears the threshold, or when both do
 * about equally (an unresolvable tie), per PRD's "ambiguous mentions are
 * dropped, not guessed."
 */
export function resolveFighterMention(
  name: string,
  fighter1: FighterCandidate,
  fighter2: FighterCandidate,
): FighterCandidate | null {
  if (!name.trim()) return null;

  const score1 = nameSimilarity(name, fighter1.name);
  const score2 = nameSimilarity(name, fighter2.name);
  const best = Math.max(score1, score2);
  if (best < NAME_MATCH_THRESHOLD) return null;
  if (score1 === score2) return null;

  return score1 > score2 ? fighter1 : fighter2;
}

/**
 * Scans free post text for a mention of either fighter's last name. If
 * the text names BOTH fighters (common in a short-notice-replacement
 * post: "X replaces Y after Y's injury"), which one the concern is
 * actually about isn't decidable from name-matching alone -- dropped
 * rather than guessed, same rule as resolveFighterMention. Only used by
 * the heuristic fallback path; the LLM path gets to read the sentence
 * instead of pattern-matching it.
 */
export function findFighterMentionInText(
  text: string,
  fighter1: FighterCandidate,
  fighter2: FighterCandidate,
): FighterCandidate | null {
  const words = tokenize(text);
  const last1 = lastName(fighter1.name);
  const last2 = lastName(fighter2.name);

  const mentions1 = words.some((w) => nameSimilarity(w, last1) >= MENTION_MATCH_THRESHOLD);
  const mentions2 = words.some((w) => nameSimilarity(w, last2) >= MENTION_MATCH_THRESHOLD);

  if (mentions1 && mentions2) return null;
  if (mentions1) return fighter1;
  if (mentions2) return fighter2;
  return null;
}
