import { describe, expect, it } from "vitest";
import { selectEventsNeedingResultRefresh } from "./selectEventsNeedingResultRefresh";
import type { RefreshCandidateEvent } from "./selectEventsNeedingResultRefresh";

// L2: the queue for the recently-finished-card Wikipedia results refresh.
// Correctness-relevant on both ends -- too wide and re-processing an event
// syncSchedule.ts still owns (or one already fully reported) burns
// requests and risks a disputed-opponent conflict per bout; too narrow
// and a finished card never gets a Wikipedia result and settles
// single-source at best (or not at all).

const WINDOW = { earliest: "2026-08-11", today: "2026-09-10" };

function ev(overrides: Partial<RefreshCandidateEvent>): RefreshCandidateEvent {
  return {
    id: overrides.id ?? "e1",
    externalId: overrides.externalId ?? "UFC Fight Night: A vs. B",
    eventDate: overrides.eventDate ?? "2026-08-29",
    mergedInto: overrides.mergedInto ?? null,
  };
}

describe("selectEventsNeedingResultRefresh", () => {
  it("includes a past, in-window event with an unreported fight", () => {
    expect(
      selectEventsNeedingResultRefresh([ev({ id: "e1" })], new Set(["e1"]), WINDOW),
    ).toEqual(["UFC Fight Night: A vs. B"]);
  });

  it("excludes an event whose fights all have a Wikipedia result already", () => {
    expect(selectEventsNeedingResultRefresh([ev({ id: "e1" })], new Set(), WINDOW)).toEqual([]);
  });

  it("excludes an event dated exactly today (may still be live / results not final)", () => {
    expect(
      selectEventsNeedingResultRefresh(
        [ev({ id: "e1", eventDate: "2026-09-10" })],
        new Set(["e1"]),
        WINDOW,
      ),
    ).toEqual([]);
  });

  it("includes an event dated yesterday", () => {
    expect(
      selectEventsNeedingResultRefresh(
        [ev({ id: "e1", eventDate: "2026-09-09" })],
        new Set(["e1"]),
        WINDOW,
      ),
    ).toEqual(["UFC Fight Night: A vs. B"]);
  });

  it("excludes an event older than the window floor", () => {
    expect(
      selectEventsNeedingResultRefresh(
        [ev({ id: "e1", eventDate: "2026-08-10" })],
        new Set(["e1"]),
        WINDOW,
      ),
    ).toEqual([]);
  });

  it("includes an event dated exactly on the window floor", () => {
    expect(
      selectEventsNeedingResultRefresh(
        [ev({ id: "e1", eventDate: "2026-08-11" })],
        new Set(["e1"]),
        WINDOW,
      ),
    ).toEqual(["UFC Fight Night: A vs. B"]);
  });

  it("excludes an event with a numeric (API-Sports) external_id -- not a Wikipedia title", () => {
    expect(
      selectEventsNeedingResultRefresh(
        [ev({ id: "e1", externalId: "2853" })],
        new Set(["e1"]),
        WINDOW,
      ),
    ).toEqual([]);
  });

  it("excludes an event that has been merged away (tombstone)", () => {
    expect(
      selectEventsNeedingResultRefresh(
        [ev({ id: "e1", mergedInto: "e2" })],
        new Set(["e1"]),
        WINDOW,
      ),
    ).toEqual([]);
  });

  it("returns titles oldest-first regardless of input order", () => {
    expect(
      selectEventsNeedingResultRefresh(
        [
          ev({ id: "c", externalId: "UFC Fight Night: Cee", eventDate: "2026-09-05" }),
          ev({ id: "a", externalId: "UFC Fight Night: Aay", eventDate: "2026-08-15" }),
          ev({ id: "b", externalId: "UFC Fight Night: Bee", eventDate: "2026-08-29" }),
        ],
        new Set(["a", "b", "c"]),
        WINDOW,
      ),
    ).toEqual(["UFC Fight Night: Aay", "UFC Fight Night: Bee", "UFC Fight Night: Cee"]);
  });

  it("returns nothing for an empty event list", () => {
    expect(selectEventsNeedingResultRefresh([], new Set(), WINDOW)).toEqual([]);
  });
});
