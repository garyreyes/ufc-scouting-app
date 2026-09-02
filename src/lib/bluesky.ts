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

interface CachedSession {
  accessJwt: string;
  expiresAtMs: number;
}

// Module-level cache, not per-call auth: a single job run typically makes
// several searches (one per fighter or concern keyword), and re-
// authenticating every call would waste latency and Bluesky's own
// separate auth rate limit for no benefit. Conservative TTL well under
// the real session lifetime, re-authenticating a bit early rather than
// risking a stale token mid-run.
let cachedSession: CachedSession | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedSession && cachedSession.expiresAtMs > Date.now()) {
    return cachedSession.accessJwt;
  }

  const identifier = requireEnv(process.env.BLUESKY_IDENTIFIER, "BLUESKY_IDENTIFIER");
  const password = requireEnv(process.env.BLUESKY_APP_PASSWORD, "BLUESKY_APP_PASSWORD");

  const res = await fetch(`${BASE_URL}/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok) {
    throw new Error(`Bluesky auth failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as { accessJwt: string };
  cachedSession = { accessJwt: json.accessJwt, expiresAtMs: Date.now() + 30 * 60 * 1000 };
  return cachedSession.accessJwt;
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
