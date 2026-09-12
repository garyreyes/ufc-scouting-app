import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchNearestUpcomingEventId } from "./nearestUpcomingEvent";

interface EventRow {
  id: string;
  event_date: string;
  merged_into: string | null;
}

// Minimal fake of the one chain fetchNearestUpcomingEventId uses:
//   .from("events").select("id").gte("event_date", d).is("merged_into", null)
//     .order("event_date", { ascending: true }).limit(1)  -> await
// It applies the same filters/order/limit the real PostgREST would, so the
// test exercises the query shape, not a hand-fed answer.
function fakeSupabase(events: EventRow[]): SupabaseClient {
  const builder = {
    _rows: events,
    select() {
      return builder;
    },
    gte(col: string, val: string) {
      if (col === "event_date") builder._rows = builder._rows.filter((e) => e.event_date >= val);
      return builder;
    },
    is(col: string, val: unknown) {
      if (col === "merged_into") builder._rows = builder._rows.filter((e) => e.merged_into === val);
      return builder;
    },
    order(col: string, opts: { ascending: boolean }) {
      if (col === "event_date") {
        builder._rows = [...builder._rows].sort((a, b) =>
          opts.ascending ? a.event_date.localeCompare(b.event_date) : b.event_date.localeCompare(a.event_date),
        );
      }
      return builder;
    },
    limit(n: number) {
      builder._rows = builder._rows.slice(0, n);
      return builder;
    },
    then(resolve: (r: { data: EventRow[]; error: null }) => void) {
      resolve({ data: builder._rows, error: null });
    },
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

const FUTURE_A = "2999-01-10";
const FUTURE_B = "2999-02-20";
const PAST = "2000-01-01";

describe("fetchNearestUpcomingEventId", () => {
  it("returns the soonest event whose date is today or later", async () => {
    const supabase = fakeSupabase([
      { id: "later", event_date: FUTURE_B, merged_into: null },
      { id: "soonest", event_date: FUTURE_A, merged_into: null },
      { id: "past", event_date: PAST, merged_into: null },
    ]);
    expect(await fetchNearestUpcomingEventId(supabase)).toBe("soonest");
  });

  it("skips a merged-away (tombstone) event even if it is the soonest", async () => {
    const supabase = fakeSupabase([
      { id: "merged-soonest", event_date: FUTURE_A, merged_into: "real-event" },
      { id: "real-later", event_date: FUTURE_B, merged_into: null },
    ]);
    expect(await fetchNearestUpcomingEventId(supabase)).toBe("real-later");
  });

  it("returns null when there is no upcoming card", async () => {
    const supabase = fakeSupabase([{ id: "past", event_date: PAST, merged_into: null }]);
    expect(await fetchNearestUpcomingEventId(supabase)).toBeNull();
  });
});
