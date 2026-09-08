// Pure parser for Sherdog's /stats/fightfinder?SearchTxt= results table.
// Pinned against real saved pages in __fixtures__/ (2026-09-07).
//
// J3's identity resolver ranks these candidates with nameSimilarity and
// either auto-matches the top one or opens a low_confidence_fighter_match
// conflict with the whole list -- the same auto-match / review-queue
// shape matchFighterCandidate.ts already uses for API-Sports.

export interface SherdogSearchCandidate {
  sherdogId: number;
  name: string;
  nickname: string | null;
  // Kept as Sherdog prints them ("5'10\"", "170 lbs"); a "0'0\"" / "0 lbs"
  // means Sherdog has no measurement, not a real zero.
  heightImperial: string | null;
  weightImperial: string | null;
  association: string | null;
}

function clean(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function trailingId(href: string): number | null {
  // Anchor to the LAST -digits: a slug can contain numbers, and
  // single-digit ids exist for old fighters. See the same helper in
  // parseFightHistory.ts.
  const path = href.split(/[?#]/)[0];
  const m = path.match(/-(\d{1,9})$/);
  return m ? Number(m[1]) : null;
}

export function parseSearchResults(html: string): SherdogSearchCandidate[] {
  const start = html.indexOf('class="new_table fightfinder_result"');
  if (start === -1) return [];
  const end = html.indexOf("</table>", start);
  const table = html.slice(start, end === -1 ? undefined : end);

  const out: SherdogSearchCandidate[] = [];
  for (const rowMatch of table.matchAll(/<tr(?:\s+onclick=[^>]*)?>([\s\S]*?)<\/tr>/g)) {
    const row = rowMatch[1];
    if (row.includes('class="table_head"')) continue;

    const link = row.match(/<a href="\/fighter\/([^"]+)"[^>]*>([^<]+)<\/a>/);
    if (!link) continue;
    const sherdogId = trailingId(link[1]);
    if (sherdogId === null) continue;

    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    // cells: [img, name-link, nickname, height, weight, association]
    // Sherdog wraps the nickname cell's text in literal double-quotes.
    const nickname = clean(cells[2] ?? "").replace(/^"+|"+$/g, "").trim() || null;
    const heightImperial = (clean(cells[3] ?? "").match(/^[\d']+'[\d"]*"?/) || [null])[0];
    const weightImperial = (clean(cells[4] ?? "").match(/^\d+\s*lbs/) || [null])[0];
    const association = clean(cells[5] ?? "") || null;

    out.push({
      sherdogId,
      name: clean(link[2]),
      nickname,
      heightImperial: heightImperial && !heightImperial.startsWith("0'0") ? heightImperial : null,
      weightImperial: weightImperial && !/^0\s*lbs/.test(weightImperial) ? weightImperial : null,
      association,
    });
  }
  return out;
}
