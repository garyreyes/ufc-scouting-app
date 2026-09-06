// The one wrapper CLAUDE.md's third-party rule requires for Sherdog.
// Feature code imports THIS, never fetches sherdog.com directly.
//
// Sherdog has no API. This scrapes public fighter/event pages. What the
// 2026-09-07 verification spike established about doing that safely:
//  - no key, no auth, no secret involved;
//  - robots.txt is `Allow: /` for every agent (checked live) -- but ToS
//    was NOT reviewed here, so treat storage-and-reuse as the open
//    question the human signed off on, not something this file decided;
//  - the site served 6 rapid unspaced requests all 200 where Wikipedia
//    429s at ~6. Spacing here is courtesy + insurance, not a known hard
//    limit. Same 1.5s the Wikipedia backfill already uses.

const SHERDOG_BASE_URL = "https://www.sherdog.com";

// A real browser UA. Sherdog served the spike's requests fine with this;
// a bare `node`/`undici` UA is the kind of thing anti-bot layers single
// out first.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const DEFAULT_SPACING_MS = 1500;

/**
 * Rejects anything that is not a positive 32-bit integer BEFORE it can
 * reach a URL. sherdog_id is `integer` in the schema; a float, a
 * negative, NaN, Infinity, or a string like "76836 OR 1=1" must never be
 * interpolated into `/fighter/<id>`. Returns the validated number so
 * callers use the clean value.
 */
export function validateSherdogId(value: unknown): number {
  const n = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0 || n > 2_147_483_647) {
    throw new Error(`Invalid Sherdog id: ${JSON.stringify(value)}`);
  }
  return n;
}

let queue: Promise<void> = Promise.resolve();

function throttle(spacingMs: number): Promise<void> {
  const next = queue.then(() => new Promise<void>((resolve) => setTimeout(resolve, spacingMs)));
  // Swallow rejection on the chain itself so one failed call can't poison
  // every later throttle() -- the caller still sees its own error.
  queue = next.catch(() => {});
  return next;
}

export interface FetchOptions {
  spacingMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Throttled GET of a sherdog.com path, returning the raw HTML. Throws on
 * any non-2xx. `path` must be a site-absolute path ("/fighter/76836");
 * callers never pass a full URL, so this file owns the host.
 */
export async function fetchSherdogHtml(path: string, opts: FetchOptions = {}): Promise<string> {
  if (!path.startsWith("/")) {
    throw new Error(`fetchSherdogHtml expects a site-absolute path, got: ${path}`);
  }
  const doFetch = opts.fetchImpl ?? fetch;
  await throttle(opts.spacingMs ?? DEFAULT_SPACING_MS);

  const res = await doFetch(`${SHERDOG_BASE_URL}${path}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (!res.ok) {
    throw new Error(`Sherdog request failed: ${res.status} ${res.statusText} for ${path}`);
  }
  return res.text();
}

/**
 * Fighter page HTML by Sherdog id. Validates the id first. `async` so an
 * invalid id surfaces as a rejected promise, not a synchronous throw the
 * caller's `.catch` would miss.
 */
export async function fetchFighterHtmlById(sherdogId: unknown, opts?: FetchOptions): Promise<string> {
  const id = validateSherdogId(sherdogId);
  return fetchSherdogHtml(`/fighter/${id}`, opts);
}

export { SHERDOG_BASE_URL, USER_AGENT, DEFAULT_SPACING_MS };
