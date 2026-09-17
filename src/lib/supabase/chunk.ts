// Splits an array into groups of at most `size`, so a Supabase `.in()` /
// `.or()` filter list never grows into an oversized request URL. Extracted
// from resolveSherdogIdentityJob.ts (J3), which proved 100 safe live, once
// M1 needed the same guard in several other jobs.
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Keep any `.in()` list well under the URL-length wall.
export const DEFAULT_CHUNK_SIZE = 100;
