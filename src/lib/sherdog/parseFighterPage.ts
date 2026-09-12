// Pure parsers for a Sherdog fighter page's HTML. No I/O -- client.ts
// fetches, this reads. Every selector here was pinned against real saved
// pages in __fixtures__/ (2026-09-07); the tests assert exact values so
// a Sherdog markup change breaks loudly instead of silently returning
// nulls that a record derivation would treat as "no fights".

export interface SherdogBio {
  // The clean display name, no nickname -- <span class="fn">.
  name: string | null;
  nickname: string | null;
  heightCm: number | null;
  weightKg: number | null;
  birthDate: string | null; // "Oct 17, 1989" as printed; not reformatted here
  // The age Sherdog prints beside the birth date -- a cross-check for it
  // (birthDateFill.ts), never stored.
  printedAge: number | null;
  nationality: string | null;
  birthplace: string | null;
}

// Sherdog's own headline W-L-D, shown at the top of the page. This is the
// number Phase J stores for a Sherdog-linked fighter, INSTEAD of counting
// the imported fight graph (which would give every freshly-created
// opponent row a fake 1-0). "nc" is No Contest; it is not a draw.
export interface SherdogHeadlineRecord {
  wins: number;
  losses: number;
  draws: number;
  noContests: number;
}

// The KO/TKO vs submission vs decision split Sherdog publishes for wins
// and for losses. Feeds predictInternMethod.ts. Absent counts are 0.
export interface SherdogFinishBreakdown {
  winsByKo: number;
  winsBySub: number;
  winsByDecision: number;
  lossesByKo: number;
  lossesBySub: number;
  lossesByDecision: number;
}

function firstMatch(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseFighterName(html: string): string | null {
  const fn = firstMatch(html, /<span class="fn">([^<]+)<\/span>/);
  return fn ? decodeEntities(fn) : null;
}

export function parseFighterNickname(html: string): string | null {
  // No dedicated visible element on every page; the itemprop=name meta
  // carries `First "Nickname" Last` when there is one. The content
  // attribute may be single- OR double-quoted and (Oliveira) contains
  // literal double-quotes around the nickname, so match the delimiter
  // explicitly rather than with a character class.
  const meta = html.match(/<meta itemprop="name" content=(?:"([^"]*)"|'([^']*)')\s*\/?>/);
  const metaName = meta ? (meta[1] ?? meta[2] ?? "") : "";
  if (!metaName) return null;
  const quoted = metaName.match(/["“]([^"”]+)["”]/);
  return quoted ? decodeEntities(quoted[1]) : null;
}

export function parseBio(html: string): SherdogBio {
  // "<b itemprop="height">5'10"</b> <em>/</em> 177.8 cm" -- take the
  // metric value Sherdog already computed rather than re-deriving it.
  const heightCm = firstMatch(html, /itemprop="height"[^>]*>[^<]*<\/b>\s*<em>\/<\/em>\s*([\d.]+)\s*cm/);
  const weightKg = firstMatch(html, /itemprop="weight"[^>]*>[^<]*<\/b>\s*<em>\/<\/em>\s*([\d.]+)\s*kg/);
  // "<td><b>36</b> <em>/</em> <span itemprop="birthDate">Oct 17, 1989</span>"
  const printedAge = firstMatch(html, /<b>(\d+)<\/b>\s*<em>\/<\/em>\s*<span itemprop="birthDate">/);

  return {
    name: parseFighterName(html),
    nickname: parseFighterNickname(html),
    heightCm: heightCm ? Math.round(Number(heightCm)) : null,
    weightKg: weightKg ? Math.round(Number(weightKg)) : null,
    birthDate: firstMatch(html, /<span itemprop="birthDate">([^<]+)<\/span>/),
    printedAge: printedAge ? Number(printedAge) : null,
    nationality: firstMatch(html, /<strong itemprop="nationality">([^<]+)<\/strong>/),
    birthplace: firstMatch(html, /<span itemprop="addressLocality"[^>]*>([^<]+)<\/span>/),
  };
}

function countCell(html: string, cls: string): number {
  // <div class="winloses win"> <span>Wins</span> <span>37</span> </div>
  // The class SUFFIX is inconsistently pluralised in Sherdog's markup --
  // `win`, `lose`, `draws`, `nc` (confirmed live 2026-09-07 against
  // Deiveson Figueiredo, who has a real majority draw). Anchored with a
  // trailing `"` so `draw` can't loosely match `draws` or vice versa.
  const re = new RegExp(
    `winloses ${cls}"[^>]*>\\s*<span>[^<]*<\\/span>\\s*<span>\\s*(\\d+)\\s*<\\/span>`,
  );
  const m = html.match(re);
  return m ? Number(m[1]) : 0;
}

export function parseHeadlineRecord(html: string): SherdogHeadlineRecord {
  return {
    wins: countCell(html, "win"),
    losses: countCell(html, "lose"),
    // `draws?` -- Sherdog's markup is inconsistently pluralised and the
    // current roster uses `draws`, but accepting both means a page that
    // switches to `draw` doesn't silently skip a real-draw fighter.
    draws: countCell(html, "draws?"),
    noContests: countCell(html, "nc"),
  };
}

function finishCounts(block: string): { ko: number; sub: number; dec: number } {
  // Within one wins/losses column: repeated
  //   <div class="meter-title">KO <em>/</em> TKO</div>
  //   <div class="meter"><div class="pl">10</div>...
  const grab = (label: RegExp): number => {
    const m = block.match(
      new RegExp(`<div class="meter-title">\\s*${label.source}[\\s\\S]*?<div class="pl">\\s*(\\d+)\\s*<\\/div>`),
    );
    return m ? Number(m[1]) : 0;
  };
  return {
    ko: grab(/KO\s*<em>\/<\/em>\s*TKO/),
    sub: grab(/SUBMISSIONS/),
    dec: grab(/DECISIONS/),
  };
}

export function parseFinishBreakdown(html: string): SherdogFinishBreakdown {
  const holder = html.match(/winsloses-holder"[\s\S]*?<div class="loses">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
  const scope = holder ? holder[0] : html;
  const winsBlock = scope.match(/<div class="wins">([\s\S]*?)(?=<div class="loses">|$)/);
  const lossesBlock = scope.match(/<div class="loses">([\s\S]*)/);

  const w = finishCounts(winsBlock ? winsBlock[1] : "");
  const l = finishCounts(lossesBlock ? lossesBlock[1] : "");
  return {
    winsByKo: w.ko,
    winsBySub: w.sub,
    winsByDecision: w.dec,
    lossesByKo: l.ko,
    lossesBySub: l.sub,
    lossesByDecision: l.dec,
  };
}
