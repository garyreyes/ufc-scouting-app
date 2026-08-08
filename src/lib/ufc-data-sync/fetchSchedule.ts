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
