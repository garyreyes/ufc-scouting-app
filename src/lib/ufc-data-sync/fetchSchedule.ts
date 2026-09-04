// API-Sports' free tier can't reach future dates at all (see client.ts /
// syncJob.ts comments and CHANGES.md Phase 5), so upcoming-event discovery
// comes from Wikipedia instead -- free, no key required, and its MMA event
// pages use a structured template we can parse without a full HTML scrape.

const WIKI_API = "https://en.wikipedia.org/w/api.php";
const USER_AGENT = "ufc-scouting-app/0.1 (personal project; contact via GitHub)";

export interface ScheduledBout {
  weightClass: string;
  fighter1Name: string;
  fighter2Name: string;
  winnerName: string | null;
  method: string | null;
  round: number | null;
  time: string | null;
}

export interface ScheduledEvent {
  title: string;
  date: string | null;
  bouts: ScheduledBout[];
}

async function wikipediaQuery<T>(params: Record<string, string>): Promise<T> {
  const url = new URL(WIKI_API);
  url.searchParams.set("format", "json");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Wikipedia API request failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

function stripWikiMarkup(text: string): string {
  return text
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, "$1")
    .replace(/\s*\(c\)\s*$/i, "")
    .trim();
}

export async function listUpcomingUfcEventTitles(): Promise<string[]> {
  const json = await wikipediaQuery<{
    query: { categorymembers: { title: string }[] };
  }>({
    action: "query",
    list: "categorymembers",
    cmtitle: "Category:Scheduled mixed martial arts events",
    cmlimit: "50",
  });

  return json.query.categorymembers
    .map((m) => m.title)
    .filter((title) => title.startsWith("UFC"));
}

/**
 * A category member that is an actual UFC MMA event page with a fight
 * card — not a grappling card ("UFC BJJ 3", which carries no
 * `{{MMAevent bout}}` templates), a list/navigation page, or a
 * non-event topic that happens to be filed under the year category.
 */
export function isUfcMmaEventTitle(title: string): boolean {
  if (!title.startsWith("UFC")) return false;
  if (/^UFC BJJ\b/.test(title)) return false;
  if (title.startsWith("List of")) return false;
  return true;
}

/**
 * Every UFC event page filed under `Category:<year> in UFC`, paginated
 * (a year has ~46 and the API caps a page at 500, but `cmcontinue` is
 * handled anyway so this can't silently truncate). I3 filled 2022-2024
 * fight history from API-Sports; its free tier refuses 2025+, so I4's
 * backfill discovers the 2025-to-now events here instead. `ns: 0` keeps
 * it to real articles, not category/template pages.
 */
export async function listUfcEventTitlesInCategoryYear(year: number): Promise<string[]> {
  const titles: string[] = [];
  let cmcontinue: string | undefined;

  do {
    const json = await wikipediaQuery<{
      query: { categorymembers: { title: string; ns: number }[] };
      continue?: { cmcontinue: string };
    }>({
      action: "query",
      list: "categorymembers",
      cmtitle: `Category:${year} in UFC`,
      cmlimit: "500",
      ...(cmcontinue ? { cmcontinue } : {}),
    });
    for (const member of json.query.categorymembers) {
      if (member.ns === 0 && isUfcMmaEventTitle(member.title)) titles.push(member.title);
    }
    cmcontinue = json.continue?.cmcontinue;
  } while (cmcontinue);

  return titles;
}

export async function fetchEventSchedule(title: string): Promise<ScheduledEvent> {
  const json = await wikipediaQuery<{ parse: { wikitext: { "*": string } } }>({
    action: "parse",
    page: title,
    prop: "wikitext",
  });
  const wikitext = json.parse.wikitext["*"];

  const dateMatch = wikitext.match(/\{\{start date\|(\d+)\|(\d+)\|(\d+)/);
  const date = dateMatch
    ? `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`
    : null;

  const bouts: ScheduledBout[] = [];
  for (const block of wikitext.matchAll(/\{\{MMAevent bout([\s\S]*?)\}\}/g)) {
    const fields = block[1]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.replace(/^\|/, "").trim());

    const [weightClass, rawFighter1, separator, rawFighter2, method, round, time] = fields;
    if (!rawFighter1 || !rawFighter2) continue;

    const fighter1Name = stripWikiMarkup(rawFighter1);
    const isFinished = separator?.trim().toLowerCase() === "def.";

    bouts.push({
      weightClass: weightClass?.trim() ?? "",
      fighter1Name,
      fighter2Name: stripWikiMarkup(rawFighter2),
      winnerName: isFinished ? fighter1Name : null,
      method: method?.trim() || null,
      round: round?.trim() ? Number(round.trim()) : null,
      time: time?.trim() || null,
    });
  }

  return { title, date, bouts };
}
