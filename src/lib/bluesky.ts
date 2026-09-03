import { requireEnv } from "./requireEnv";

const BASE_URL = "https://bsky.social/xrpc";

// Verified live 2026-09-02 (ROADMAP.md F1, replacing the originally
// planned Reddit source -- see the same file for the full reasoning: X
// killed its free tier in Feb 2026, Reddit's API now requires a manual,
// opaque approval process with no guaranteed outcome). Two real, non-
// obvious findings from that verification:
//
// 1. `public.api.bsky.app` (the endpoint Bluesky's own docs describe as
//    the public, unauthenticated read mirror) returns a blanket 403 on
//    `app.bsky.feed.searchPosts` specifically -- confirmed this isn't a
//    broad network block (a trivial getProfile call against the same
//    host succeeds unauthenticated) and isn't fixed by adding a real
//    User-Agent or an auth token against that same host. The fix is
//    routing search through the authenticated session's own PDS host
//    (`bsky.social`) instead -- confirmed live, real results, real rate-
//    limit headers (ratelimit-limit: 3000, w=300s -- 3000 requests per 5
//    minutes, far beyond anything this app's cadence needs).
// 2. A meaningful share of real MMA content on Bluesky arrives via
//    "bridge" accounts (handles ending `.web.brid.gy`) mirroring outlets
//    like Bloody Elbow, MMA Fighting, and MMA Mania -- these posts carry
//    an EMPTY `record.text`, with the actual article title/summary/link
//    living in `record.embed.external` instead (confirmed by inspecting
//    a real bridged post's full JSON live). Ignoring that field would
//    silently drop a large share of the highest-quality, named-source
//    content this integration exists to catch.
export interface BlueskyPost {
  uri: string;
  authorHandle: string;
  // record.text when the post has one; otherwise the embedded link
  // card's title + description (see finding #2 above) -- never both, so
  // callers get one coherent string regardless of which shape the post
  // came in.
  text: string;
  // The real source link for a bridged news post is the article itself,
  // not just the Bluesky post -- docs/PRD.md's "direct links to each
  // post" requirement is better served by this than by uri alone when
  // it's present.
  externalUrl: string | null;
  createdAt: string;
}

interface RawExternalEmbed {
  title?: string;
  description?: string;
  uri?: string;
}

interface RawPost {
  uri: string;
  author?: { handle?: string };
  record?: {
    text?: string;
    createdAt?: string;
    embed?: { external?: RawExternalEmbed };
  };
  embed?: { external?: RawExternalEmbed };
  indexedAt?: string;
}

/**
 * A failure of `com.atproto.server.createSession` specifically -- a bad
 * app password, or (the case that actually happened) the account being
 * rate-limited. Callers that scan a whole card treat this as card-wide
 * rather than one fighter's bad luck.
 */
export class BlueskyAuthError extends Error {
  readonly status: number;
  constructor(status: number, body: string) {
    super(`Bluesky auth failed: ${status} ${body}`.trim());
    this.name = "BlueskyAuthError";
    this.status = status;
  }
}

interface CachedSession {
  accessJwt: string;
  expiresAtMs: number;
}

// Conservative session TTL, well under the real lifetime -- re-authenticate
// a little early rather than risk a stale token mid-run.
const SESSION_TTL_MS = 30 * 60 * 1000;

// Bluesky rate-limits `com.atproto.server.createSession` to **30 per 5
// minutes and 300 per day, measured per account** (verified 2026-09-03
// against docs.bsky.app) -- a separate, far stricter limiter than the
// 3000-per-5min the search endpoint gets (finding #1 above). It took the
// scheduled rumour job (runRumourScanJob.ts) down for two days straight,
// 2026-09-02 to -03: it scans ~14 fights, each firing two concurrent
// searchMmaPosts calls, and a naive "re-auth whenever the cache is cold"
// turned that into ~28 createSession attempts per run -- enough to trip
// the 5-minute limit inside one run, after which the per-fight retry kept
// the account pinned past its daily cap and it never recovered.
//
// Two guards keep it to at most one attempt per run, whatever the outcome:
//   1. single-flight -- concurrent cold-cache callers await ONE in-flight
//      createSession (`pendingAuth`), not one each;
//   2. failure cooldown -- after any auth failure, every caller fails fast
//      with no network call for this long. One full rate-limit window, so
//      a genuinely limited account gets a real rest instead of a beating.
const AUTH_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

export type AuthAction = "use-cache" | "in-cooldown" | "await-pending" | "authenticate";

/**
 * The precedence a `getAccessToken()` call follows, pulled out so the
 * ordering is tested rather than implied: a still-valid session beats
 * everything; a live failure cooldown beats both starting and joining a
 * network attempt; an in-flight attempt is joined, not duplicated;
 * otherwise authenticate.
 */
export function decideAuthAction(state: {
  session: { expiresAtMs: number } | null;
  authFailedUntilMs: number;
  hasPendingAuth: boolean;
  now: number;
}): AuthAction {
  if (state.session && state.session.expiresAtMs > state.now) return "use-cache";
  if (state.now < state.authFailedUntilMs) return "in-cooldown";
  if (state.hasPendingAuth) return "await-pending";
  return "authenticate";
}

let cachedSession: CachedSession | null = null;
let pendingAuth: Promise<string> | null = null;
let authFailedUntilMs = 0;
let lastAuthError: BlueskyAuthError | null = null;

async function createSession(): Promise<string> {
  const identifier = requireEnv(process.env.BLUESKY_IDENTIFIER, "BLUESKY_IDENTIFIER");
  const password = requireEnv(process.env.BLUESKY_APP_PASSWORD, "BLUESKY_APP_PASSWORD");

  const res = await fetch(`${BASE_URL}/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok) {
    throw new BlueskyAuthError(res.status, await res.text());
  }

  const json = (await res.json()) as { accessJwt?: string };
  if (!json.accessJwt) {
    // A 200 with no token would otherwise be cached as a live session for
    // the full TTL, silently failing every search until it expired.
    throw new BlueskyAuthError(res.status, "createSession returned no accessJwt");
  }
  cachedSession = { accessJwt: json.accessJwt, expiresAtMs: Date.now() + SESSION_TTL_MS };
  return json.accessJwt;
}

async function getAccessToken(): Promise<string> {
  const action = decideAuthAction({
    session: cachedSession,
    authFailedUntilMs,
    hasPendingAuth: pendingAuth !== null,
    now: Date.now(),
  });

  if (action === "use-cache") return cachedSession!.accessJwt;
  if (action === "in-cooldown") {
    throw lastAuthError ?? new BlueskyAuthError(429, "createSession is in a post-failure cooldown");
  }
  if (action === "await-pending") return pendingAuth!;

  pendingAuth = createSession();
  try {
    return await pendingAuth;
  } catch (err) {
    authFailedUntilMs = Date.now() + AUTH_FAILURE_COOLDOWN_MS;
    lastAuthError =
      err instanceof BlueskyAuthError
        ? err
        : new BlueskyAuthError(0, err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    pendingAuth = null;
  }
}

function toPost(raw: RawPost): BlueskyPost {
  const record = raw.record ?? {};
  const external = record.embed?.external ?? raw.embed?.external;
  const recordText = record.text?.trim();
  const text =
    recordText && recordText.length > 0
      ? recordText
      : [external?.title, external?.description].filter((v): v is string => Boolean(v)).join(" — ");

  return {
    uri: raw.uri,
    authorHandle: raw.author?.handle ?? "unknown",
    text,
    externalUrl: external?.uri ?? null,
    createdAt: record.createdAt ?? raw.indexedAt ?? new Date().toISOString(),
  };
}

/**
 * The one wrapper CLAUDE.md's third-party-SDK rule requires for
 * Bluesky. Must hit `bsky.social` (the authenticated PDS host), not
 * `public.api.bsky.app` -- see the module comment above for why the
 * "public" mirror silently blocks exactly this endpoint.
 */
export async function searchMmaPosts(query: string, limit = 25): Promise<BlueskyPost[]> {
  const accessJwt = await getAccessToken();

  const url = new URL(`${BASE_URL}/app.bsky.feed.searchPosts`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sort", "latest");

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessJwt}` } });
  if (!res.ok) {
    throw new Error(`Bluesky search failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as { posts?: RawPost[] };
  return (json.posts ?? []).map(toPost);
}
