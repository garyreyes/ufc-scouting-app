const BASE_URL = "https://v1.mma.api-sports.io";

// Free plan allows 10 requests/minute (undocumented, found by hitting it).
// Serialize all calls through this module and space them out so a
// multi-request sync job doesn't get rate-limited mid-run.
const MIN_INTERVAL_MS = 6500;
let queue: Promise<void> = Promise.resolve();

function throttle(): Promise<void> {
  const next = queue.then(() => new Promise<void>((resolve) => setTimeout(resolve, MIN_INTERVAL_MS)));
  queue = next;
  return next;
}

export async function apiSportsGet<T>(
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  const apiKey = process.env.UFC_API_SPORTS_KEY;
  if (!apiKey) {
    throw new Error("Missing UFC_API_SPORTS_KEY");
  }

  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  await throttle();
  const res = await fetch(url, { headers: { "x-apisports-key": apiKey } });
  if (!res.ok) {
    throw new Error(`API-Sports request failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length > 0) {
    throw new Error(`API-Sports error on ${path}: ${JSON.stringify(json.errors)}`);
  }

  return json.response as T;
}
