import { describe, expect, it } from "vitest";
import { selectBackfillEvents } from "./selectBackfillEvents";

// I4: the queue for the Wikipedia past-event backfill. Correctness-
// critical because the two boundaries are both easy to get subtly wrong:
// an off-by-one on "today" reprocesses upcoming cards syncSchedule.ts
// already owns (writing Wikipedia data over live scheduled data), and a
// missing done-set check re-fetches every event every run forever.

const WINDOW = { earliest: "2025-01-01", today: "2026-09-04" };

function cand(title: string, date: string | null) {
  return { title, date };
}

describe("selectBackfillEvents", () => {
  it("includes a past, in-window event that has not been done", () => {
    expect(
      selectBackfillEvents([cand("UFC 311", "2025-01-18")], new Set(), WINDOW),
    ).toEqual(["UFC 311"]);
  });

  it("excludes an event dated in the future", () => {
    expect(
      selectBackfillEvents([cand("UFC 340", "2026-12-05")], new Set(), WINDOW),
    ).toEqual([]);
  });

  it("excludes an event dated exactly today (results may not be final)", () => {
    expect(
      selectBackfillEvents([cand("UFC on ESPN: Today", "2026-09-04")], new Set(), WINDOW),
    ).toEqual([]);
  });

  it("includes an event dated yesterday", () => {
    expect(
      selectBackfillEvents([cand("UFC on ESPN: Yesterday", "2026-09-03")], new Set(), WINDOW),
    ).toEqual(["UFC on ESPN: Yesterday"]);
  });

  it("excludes an event before the earliest window bound", () => {
    expect(
      selectBackfillEvents([cand("UFC 310", "2024-12-07")], new Set(), WINDOW),
    ).toEqual([]);
  });

  it("includes an event dated exactly on the earliest bound", () => {
    expect(
      selectBackfillEvents([cand("UFC Vegas: NYD", "2025-01-01")], new Set(), WINDOW),
    ).toEqual(["UFC Vegas: NYD"]);
  });

  it("excludes an event with no parseable date", () => {
    expect(selectBackfillEvents([cand("UFC BJJ 3", null)], new Set(), WINDOW)).toEqual([]);
  });

  it("excludes an event whose external_id (its title) is already in the done set", () => {
    expect(
      selectBackfillEvents(
        [cand("UFC 311", "2025-01-18"), cand("UFC 312", "2025-02-08")],
        new Set(["UFC 311"]),
        WINDOW,
      ),
    ).toEqual(["UFC 312"]);
  });

  it("returns titles oldest-first regardless of input order", () => {
    expect(
      selectBackfillEvents(
        [
          cand("UFC 319", "2025-08-16"),
          cand("UFC 311", "2025-01-18"),
          cand("UFC 315", "2025-05-10"),
        ],
        new Set(),
        WINDOW,
      ),
    ).toEqual(["UFC 311", "UFC 315", "UFC 319"]);
  });

  it("returns nothing for an empty candidate list", () => {
    expect(selectBackfillEvents([], new Set(), WINDOW)).toEqual([]);
  });

  it("de-duplicates a title that appears in more than one year category", () => {
    expect(
      selectBackfillEvents(
        [cand("UFC 323", "2025-12-06"), cand("UFC 323", "2025-12-06")],
        new Set(),
        WINDOW,
      ),
    ).toEqual(["UFC 323"]);
  });
});
