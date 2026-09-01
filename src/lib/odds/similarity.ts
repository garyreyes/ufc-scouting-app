// Dice's coefficient over character bigrams. Hand-rolled rather than an
// external library on purpose: this is the correctness-critical core of
// odds<->fight matching (ARCHITECTURE.md item #6 -- "a wrong match
// silently corrupts every downstream number"), and a small, fully-tested
// implementation of a well-specified algorithm is a smaller risk surface
// here than trusting a dependency whose edge-case behaviour was never
// verified against fighter names specifically.

function normalize(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks (é -> e, ñ -> n)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

// Known limitation: precomposed letters that aren't decomposable via NFD
// (e.g. Polish ł/Ł) are NOT folded to their Latin look-alike. Bigram
// similarity tolerates this reasonably well anyway -- only the bigrams
// touching that letter differ, not the whole name -- see
// similarity.test.ts's "Syguła" case for the actual score this produces.
function bigrams(s: string): string[] {
  if (s.length < 2) return s.length === 0 ? [] : [s];
  const result: string[] = [];
  for (let i = 0; i < s.length - 1; i++) {
    result.push(s.slice(i, i + 2));
  }
  return result;
}

/**
 * Dice's coefficient: 2 * |shared bigrams| / (|bigrams(a)| + |bigrams(b)|),
 * with each shared bigram consumed on match so a repeated bigram in one
 * name can't match the same bigram in the other twice. Returns 0 (nothing
 * in common) to 1 (identical after normalization). Order-independent and
 * tolerant of minor spelling/diacritic differences, since it compares
 * character pairs rather than requiring an exact match.
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (na.length === 0 || nb.length === 0) return 0;

  const bigramsA = bigrams(na);
  const bigramsBPool = bigrams(nb);
  const totalA = bigramsA.length;
  const totalB = bigramsBPool.length;

  let matches = 0;
  for (const bg of bigramsA) {
    const idx = bigramsBPool.indexOf(bg);
    if (idx !== -1) {
      matches++;
      bigramsBPool.splice(idx, 1);
    }
  }

  return (2 * matches) / (totalA + totalB);
}
