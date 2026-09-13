import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchEventSchedule } from "./fetchSchedule";

function mockWikitext(wikitext: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ parse: { wikitext: { "*": wikitext } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const GOOD_BOUT = `{{MMAevent bout
|Featherweight
|[[Jean Silva]]
|def.
|Jose Miguel Delgado
|Submission (rear-naked choke)
|3
|2:57
}}`;

// A malformed block -- missing both fighter fields -- the same shape
// fetchEventSchedule.ts already silently drops (fields.length too short
// for rawFighter1/rawFighter2 to exist at all).
const MALFORMED_BOUT = `{{MMAevent bout
|Featherweight
}}`;

describe("fetchEventSchedule", () => {
  it("reports zero skipped bouts when every block parses cleanly", async () => {
    mockWikitext(`{{start date|2026|9|12}}\n${GOOD_BOUT}`);
    const event = await fetchEventSchedule("UFC Fight Night: Silva vs. Delgado");
    expect(event.bouts).toHaveLength(1);
    expect(event.skippedBoutCount).toBe(0);
  });

  it("counts a malformed bout block as skipped, not silently dropped", async () => {
    mockWikitext(`{{start date|2026|9|12}}\n${GOOD_BOUT}\n${MALFORMED_BOUT}`);
    const event = await fetchEventSchedule("UFC Fight Night: Silva vs. Delgado");
    expect(event.bouts).toHaveLength(1);
    expect(event.skippedBoutCount).toBe(1);
  });
});
