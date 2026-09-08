// Pure parser for the PRO fight-history table on a Sherdog fighter page.
// Pinned against real saved pages in __fixtures__/ (2026-09-07). The
// amateur-record table is a separate module lower on the page and is
// deliberately NOT read here -- an amateur bout is not part of the pro
// record Phase J imports.

export type SherdogFightResult = "win" | "loss" | "draw" | "nc" | "unknown";

export interface SherdogHistoryFight {
  // The fighter whose page this is: result from THEIR perspective.
  result: SherdogFightResult;
  opponentName: string;
  opponentSherdogId: number | null;
  eventName: string | null;
  eventSherdogId: number | null;
  // As printed, e.g. "Jun / 26 / 2011". Reformatting is the caller's job.
  date: string | null;
  method: string | null; // "Submission (Face Crank)", "Decision (Unanimous)", ...
  referee: string | null;
  round: number | null;
  time: string | null; // "2:48"
}

const RESULT_CLASS: Record<string, SherdogFightResult> = {
  win: "win",
  loss: "loss",
  draw: "draw",
  no_contest: "nc",
};

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function trailingId(href: string): number | null {
  // Sherdog hrefs end "...-<id>". A slug can itself contain numbers
  // ("...-2-<id>" for a rematch page), so anchor to the LAST -digits at
  // the end of the path, after stripping any query/hash. Single-digit
  // ids exist for pre-2010 fighters (matters for J4's history import).
  const path = href.split(/[?#]/)[0];
  const m = path.match(/-(\d{1,9})$/);
  return m ? Number(m[1]) : null;
}

/**
 * Every completed pro bout on the page, newest first (Sherdog's own
 * order). An empty array means the table was not found OR the fighter
 * has no pro fights -- the caller distinguishes those by whether the
 * page parsed at all elsewhere (bio/name present).
 */
export function parseFightHistory(html: string): SherdogHistoryFight[] {
  // The PRO and AMATEUR history tables carry the IDENTICAL
  // class="module fight_history"; only document order separates them
  // (pro first). Slice to the first </table> after the pro block's start
  // -- there is nothing but whitespace between </table> and the next
  // </section>, so this is the same cut today but survives Sherdog
  // changing the section wrapper, which </section> would not.
  const start = html.indexOf('class="module fight_history"');
  if (start === -1) return [];
  const tableEnd = html.indexOf("</table>", start);
  const table = html.slice(start, tableEnd === -1 ? undefined : tableEnd);

  const out: SherdogHistoryFight[] = [];
  for (const rowMatch of table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const row = rowMatch[1];

    const resultClass = row.match(/<span class="final_result ([a-z_]+)">/);
    if (!resultClass) continue; // header row / spacer

    const opp = row.match(/<td>\s*<a href="\/fighter\/([^"]+)"[^>]*>([^<]+)<\/a>\s*<\/td>/);

    // Event cell: an <a href="/events/..."> whose text may be wrapped in
    // <span itemprop="award"> or may be bare.
    const eventAnchor = row.match(/<a href="\/events\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/);

    const date = row.match(/<span class="sub_line">\s*([A-Z][a-z]{2} \/ \d{2} \/ \d{4})\s*<\/span>/);

    const method = row.match(/<td class="winby"><b>([^<]+)<\/b>/);
    // Referee: linked (<a href="/referee/..">Name</a>) or bare text, inside
    // the winby cell's sub_line. Empty <span class="sub_line"></span> => none.
    const refCell = row.match(/<td class="winby">[\s\S]*?<br\s*\/?>\s*<span class="sub_line">([\s\S]*?)<\/span>/);
    const referee = refCell ? stripTags(refCell[1]) || null : null;

    // The last two bare <td> cells are Round and Time.
    const bareCells = [...row.matchAll(/<td>\s*([^<]*?)\s*<\/td>/g)].map((m) => m[1].trim());
    const tail = bareCells.slice(-2);
    const roundRaw = tail[0];
    const timeRaw = tail[1];

    out.push({
      result: RESULT_CLASS[resultClass[1]] ?? "unknown",
      opponentName: opp ? stripTags(opp[2]) : "",
      opponentSherdogId: opp ? trailingId(opp[1]) : null,
      eventName: eventAnchor ? stripTags(eventAnchor[2]) || null : null,
      eventSherdogId: eventAnchor ? trailingId(eventAnchor[1]) : null,
      date: date ? date[1] : null,
      method: method ? stripTags(method[1]) : null,
      referee,
      round: roundRaw && /^\d+$/.test(roundRaw) ? Number(roundRaw) : null,
      time: timeRaw && /^\d+:\d{2}$/.test(timeRaw) ? timeRaw : null,
    });
  }
  return out;
}
