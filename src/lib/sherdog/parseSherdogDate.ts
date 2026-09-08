// Sherdog prints fight-history dates as "Mon / DD / YYYY" ("Mar / 07 /
// 2026"). This app stores dates as ISO "YYYY-MM-DD" everywhere
// (events.event_date, elo occurred_at). Returns null rather than
// guessing on anything that isn't exactly that shape -- a bout with an
// unparseable date is stored with event_date null, not a wrong date.

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

const DAYS_IN_MONTH: Record<string, number> = {
  "01": 31,
  "02": 29, // allow Feb 29; a wrong-year leap check isn't worth it here
  "03": 31,
  "04": 30,
  "05": 31,
  "06": 30,
  "07": 31,
  "08": 31,
  "09": 30,
  "10": 31,
  "11": 30,
  "12": 31,
};

export function parseSherdogDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^([A-Za-z]{3})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/);
  if (!m) return null;

  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;

  const day = m[2].padStart(2, "0");
  const dayNum = Number(day);
  if (dayNum < 1 || dayNum > DAYS_IN_MONTH[month]) return null;

  return `${m[3]}-${month}-${day}`;
}
