// Sherdog prints dates in two shapes: fight history as "Mon / DD / YYYY"
// ("Mar / 07 / 2026"), and a fighter's bio birth date as "Mon D, YYYY"
// ("Dec 4, 2002" -- day NOT zero-padded, confirmed live). This app stores
// dates as ISO "YYYY-MM-DD" everywhere (events.event_date, elo
// occurred_at, fighters.birth_date). Both parsers return null rather than
// guessing on anything that isn't exactly their shape -- an unparseable
// date is stored as null, not a wrong date. Built from the text, never via
// Date parsing: a local-midnight Date in UTC+8 lands on the previous day.

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
  "02": 28,
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

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function buildIsoDate(monthAbbr: string, dayRaw: string, yearRaw: string): string | null {
  const month = MONTHS[monthAbbr.toLowerCase()];
  if (!month) return null;

  const year = Number(yearRaw);
  const day = dayRaw.padStart(2, "0");
  const dayNum = Number(day);

  // A real leap check, not "Feb 29 is always fine" -- an invalid date
  // isn't a slightly-wrong value, it's a hard Postgres `date` insert
  // failure that would wedge the whole fighter's import on every run.
  let maxDay = DAYS_IN_MONTH[month];
  if (month === "02" && isLeapYear(year)) maxDay = 29;
  if (dayNum < 1 || dayNum > maxDay) return null;

  return `${yearRaw}-${month}-${day}`;
}

export function parseSherdogDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^([A-Za-z]{3})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/);
  return m ? buildIsoDate(m[1], m[2], m[3]) : null;
}

export function parseSherdogBirthDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/);
  return m ? buildIsoDate(m[1], m[2], m[3]) : null;
}
