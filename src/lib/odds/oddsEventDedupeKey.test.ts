import { describe, expect, it } from "vitest";
import { buildOddsEventDedupeKey } from "./oddsEventDedupeKey";
import type { OddsEvent } from "./types";

function oddsEvent(overrides: Partial<OddsEvent> = {}): OddsEvent {
  return {
    id: "097259d4c82c4ae646995fc8d665c410",
    commence_time: "2026-09-20T04:00:00Z",
    home_team: "Alexandre Pantoja",
    away_team: "Joshua Van",
    bookmakers: [],
    ...overrides,
  };
}

// D4 (ROADMAP_V2.md Phase P): the feed re-emitted the same bout under a
// new event id with a spelling variant ("Łukasz Charzewski" vs "Lukasz
// Charzewski" was the real production case), and both got queued as
// separate low_confidence_odds_match rows because dedup keyed on the raw,
// ever-changing oddsEvent.id. The key must be built from the bout's own
// identity (names, folded the same way matching already does, plus the
// commence date) so a re-emission under a new id collapses onto the same
// key. Uses "Chárzewski"/"Charzewski" here rather than the real Ł/l case --
// foldDiacritics has a documented, separate limitation with Polish ł not
// being NFD-decomposable, which is out of scope for this dedup-key test.
describe("buildOddsEventDedupeKey", () => {
  it("is identical for the same bout re-emitted with a spelling variant under a new event id", () => {
    const original = oddsEvent({
      id: "event-1",
      home_team: "Chárzewski",
      away_team: "Some Opponent",
    });
    const reEmitted = oddsEvent({
      id: "event-2", // a new id, same underlying bout
      home_team: "Charzewski",
      away_team: "Some Opponent",
    });
    expect(buildOddsEventDedupeKey(original)).toBe(buildOddsEventDedupeKey(reEmitted));
  });

  it("is identical regardless of which side is home vs away", () => {
    const straight = oddsEvent({ home_team: "Justin Gaethje", away_team: "Ilia Topuria" });
    const swapped = oddsEvent({ home_team: "Ilia Topuria", away_team: "Justin Gaethje" });
    expect(buildOddsEventDedupeKey(straight)).toBe(buildOddsEventDedupeKey(swapped));
  });

  it("differs for two genuinely different bouts on the same date", () => {
    const first = oddsEvent({ home_team: "Justin Gaethje", away_team: "Ilia Topuria" });
    const second = oddsEvent({ home_team: "Alexandre Pantoja", away_team: "Joshua Van" });
    expect(buildOddsEventDedupeKey(first)).not.toBe(buildOddsEventDedupeKey(second));
  });

  it("differs for the same fighters on a different date", () => {
    const first = oddsEvent({ commence_time: "2026-09-20T04:00:00Z" });
    const second = oddsEvent({ commence_time: "2026-12-01T04:00:00Z" });
    expect(buildOddsEventDedupeKey(first)).not.toBe(buildOddsEventDedupeKey(second));
  });

  it("is unaffected by a same-day commence_time correction", () => {
    const first = oddsEvent({ commence_time: "2026-09-20T04:00:00Z" });
    const second = oddsEvent({ commence_time: "2026-09-20T23:00:00Z" });
    expect(buildOddsEventDedupeKey(first)).toBe(buildOddsEventDedupeKey(second));
  });
});
