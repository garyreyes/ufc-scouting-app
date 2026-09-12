// Whole years between two ISO "YYYY-MM-DD" dates, birthday-aware. Compared
// as strings, never via Date, so no timezone can shift either day. A Feb 29
// birthday is reached on Mar 1 in a non-leap year ("02-28" < "02-29").
export function ageOnDate(birthDate: string, onDate: string): number {
  const years = Number(onDate.slice(0, 4)) - Number(birthDate.slice(0, 4));
  return onDate.slice(5, 10) < birthDate.slice(5, 10) ? years - 1 : years;
}
