// RETROSPECTIVE.md entry #9 (2026-09-19): "Casey O'Neill" and others were
// stored with their apostrophe as the literal string `&#x27;` -- Sherdog's
// own three hand-rolled decoders (parseFighterPage.ts, parseFightHistory.ts,
// parseSearch.ts) each only matched the DECIMAL numeric-entity form
// (`&#39;`/`&#039;`), never the HEX form (`&#x27;`) Sherdog also emits.
// This is the single shared decoder all three now delegate to, so the
// same gap can't reopen independently in a fourth parser later.
//
// One regex pass, not sequential `.replace()` calls: sequential replacing
// (decode `&amp;` first, then `&lt;`, ...) can double-decode text that
// contains an already-escaped entity (e.g. `&amp;lt;` -> `&lt;` -> `<`,
// which is wrong -- the source meant a literal "&lt;", not "<"). Matching
// every entity once and mapping each match independently avoids that.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const ENTITY_PATTERN = /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi;

export function decodeHtmlEntities(input: string): string {
  return input.replace(ENTITY_PATTERN, (match, body: string) => {
    if (body[0] === "#") {
      const isHex = body[1] === "x" || body[1] === "X";
      const codePoint = isHex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      // An out-of-range/invalid code point (including a lone surrogate,
      // 0xD800-0xDFFF, which String.fromCodePoint throws on) is left as
      // the original text -- this function must never turn unparseable
      // input into a thrown error or a replacement character.
      const isValidCodePoint =
        Number.isFinite(codePoint) &&
        codePoint >= 0 &&
        codePoint <= 0x10ffff &&
        !(codePoint >= 0xd800 && codePoint <= 0xdfff);
      return isValidCodePoint ? String.fromCodePoint(codePoint) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match; // unknown named entity -- leave untouched, don't guess
  });
}
