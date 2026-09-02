// PRD UC-1: "whether any trace back to a named journalist, the camp, or
// the fighter." Only the first is honestly determinable today -- see
// 0024_rumour_flags_and_sources.sql's comment on rumour_sources.is_named_source
// for why camp/fighter self-attribution is out of scope for F2.
//
// `.web.brid.gy` bridge accounts mirror an established outlet's own feed
// onto Bluesky (F1's verified finding, ROADMAP.md) -- Bloody Elbow, MMA
// Fighting, and MMA Mania were all confirmed live. A hand-maintained
// allowlist covers named outlets/beat writers who post natively on
// Bluesky instead of (or in addition to) a bridge account -- found live,
// F3 (2026-09-02): Bloody Elbow posts under BOTH `bloodyelbow.com` (a
// real, native, non-bridged handle) and a separate `.web.brid.gy`
// mirror, and only the bridge one was being caught before this list
// existed. Extend as more real ones turn up -- don't guess a handle
// that hasn't actually been observed posting real MMA content.
const KNOWN_OUTLET_HANDLES: readonly string[] = ["bloodyelbow.com"];

export function isNamedSource(authorHandle: string): boolean {
  const handle = authorHandle.toLowerCase();
  return handle.endsWith(".web.brid.gy") || KNOWN_OUTLET_HANDLES.includes(handle);
}
