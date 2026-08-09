// Used before any .update() call that merges data from one source on top
// of a row that might already have better data from the other source
// (e.g. API-Sports never knows method/round; Wikipedia never knows
// height/reach). Dropping null/undefined keys means "I don't know this
// field" instead of "overwrite it with nothing."
export function stripNullish<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== null && value !== undefined),
  ) as Partial<T>;
}
