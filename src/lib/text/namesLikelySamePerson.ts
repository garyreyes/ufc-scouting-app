import { namesMatchExactly } from "./namesMatchExactly";
import { normalizeName } from "./normalizeName";

/**
 * Whether two names almost certainly refer to the same fighter, allowing
 * for the three *structural* rewrites the Wikipedia / API-Sports split
 * actually produces -- and nothing looser.
 *
 * A superset of `namesMatchExactly` (case + diacritic + whitespace fold),
 * adding:
 *
 *  - **missing internal space** -- "Sumudaerji" / "Su Mudaerji",
 *    "Aoriqileng" / "Aori Qileng" (transliterations one source spaces and
 *    the other doesn't);
 *  - **name-order swap** -- "Ce Liu" / "Liu Ce", "Xiong Jingnan" /
 *    "Jingnan Xiong" (family-name-first romanisation).
 *
 * It deliberately does NOT match a nickname or short form ("Wes" /
 * "Wesley", "Stan" / "Stanley"): that is a genuine judgement call a human
 * should make, and this backs `upsertFighter`'s unattended fold-merge
 * where a false positive silently welds two people's careers together
 * (I2b). The two rules it adds are pure rearrangements of the *same
 * characters* -- far safer than any edit-distance or prefix rule.
 *
 * `nameSimilarity.ts`'s fuzzy score remains the thing for review queues a
 * human looks at; this is still only for the automatic path.
 */
export function namesLikelySamePerson(a: string, b: string): boolean {
  if (namesMatchExactly(a, b)) return true;

  const na = normalizeName(a);
  const nb = normalizeName(b);

  // Missing internal space: compare with every space removed.
  if (na.replace(/ /g, "") === nb.replace(/ /g, "")) return true;

  // Name-order swap: same multiset of whitespace-separated tokens. Require
  // at least two tokens on each side so a single-token name can never
  // "reorder" into anything.
  const ta = na.split(" ").filter(Boolean);
  const tb = nb.split(" ").filter(Boolean);
  if (ta.length >= 2 && ta.length === tb.length) {
    const sorted = (t: string[]) => [...t].sort().join(" ");
    if (sorted(ta) === sorted(tb)) return true;
  }

  return false;
}
