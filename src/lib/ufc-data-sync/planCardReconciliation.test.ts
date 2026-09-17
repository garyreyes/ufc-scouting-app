import { describe, expect, it } from "vitest";
import { planCardReconciliation, type ReconciliationFight } from "./planCardReconciliation";

const TITLE = "UFC Fight Night: Silva vs. Delgado";
const NOW = new Date("2026-09-14T12:00:00Z");

function fight(overrides: Partial<ReconciliationFight> = {}): ReconciliationFight {
  return {
    id: "fight-1",
    externalId: `wiki:${TITLE}:aaa:bbb`,
    settledAt: null,
    wikipediaMissingSince: null,
    ...overrides,
  };
}

describe("planCardReconciliation", () => {
  it("does nothing to a fight that is present on the page", () => {
    const f = fight();
    const actions = planCardReconciliation(TITLE, [f], new Set([f.id]), NOW);
    expect(actions).toEqual([]);
  });

  it("marks a fight missing the first time it's absent from the page", () => {
    const f = fight();
    const actions = planCardReconciliation(TITLE, [f], new Set(), NOW);
    expect(actions).toEqual([{ action: "markMissing", fightId: f.id }]);
  });

  it("does not cancel on the first miss, even well past the grace window", () => {
    // wikipediaMissingSince is null -- this run is the FIRST time it's
    // missing, regardless of how much time has passed since some other
    // event. Only markMissing should fire; cancellation waits for a
    // second sync after missing_since is actually set.
    const f = fight({ wikipediaMissingSince: null });
    const actions = planCardReconciliation(TITLE, [f], new Set(), NOW);
    expect(actions).toEqual([{ action: "markMissing", fightId: f.id }]);
  });

  it("does not cancel a fight still missing within the grace window", () => {
    const f = fight({ wikipediaMissingSince: new Date("2026-09-14T08:00:00Z").toISOString() }); // 4h ago
    const actions = planCardReconciliation(TITLE, [f], new Set(), NOW);
    expect(actions).toEqual([]);
  });

  it("cancels a fight missing for at least the grace window (default 6h)", () => {
    const f = fight({ wikipediaMissingSince: new Date("2026-09-14T06:00:00Z").toISOString() }); // 6h ago exactly
    const actions = planCardReconciliation(TITLE, [f], new Set(), NOW);
    expect(actions).toEqual([{ action: "cancel", fightId: f.id }]);
  });

  it("cancels a fight missing well past the grace window", () => {
    const f = fight({ wikipediaMissingSince: new Date("2026-09-10T00:00:00Z").toISOString() });
    const actions = planCardReconciliation(TITLE, [f], new Set(), NOW);
    expect(actions).toEqual([{ action: "cancel", fightId: f.id }]);
  });

  it("clears missing_since when a fight reappears on the page", () => {
    const f = fight({ wikipediaMissingSince: new Date("2026-09-14T08:00:00Z").toISOString() });
    const actions = planCardReconciliation(TITLE, [f], new Set([f.id]), NOW);
    expect(actions).toEqual([{ action: "clearMissing", fightId: f.id }]);
  });

  it("respects a custom grace window", () => {
    const f = fight({ wikipediaMissingSince: new Date("2026-09-14T10:00:00Z").toISOString() }); // 2h ago
    const cancelled = planCardReconciliation(TITLE, [f], new Set(), NOW, 1);
    expect(cancelled).toEqual([{ action: "cancel", fightId: f.id }]);
    const stillWaiting = planCardReconciliation(TITLE, [f], new Set(), NOW, 3);
    expect(stillWaiting).toEqual([]);
  });

  it("ignores an already-settled fight even if it's absent from the page", () => {
    // A fight settled by some other means (Sherdog, API-Sports, a real
    // Wikipedia result already recorded) needs no reconciliation --
    // it isn't a candidate for cancellation just because this particular
    // sync's fresh parse didn't happen to re-list it.
    const f = fight({ settledAt: "2026-09-13T03:00:00Z" });
    const actions = planCardReconciliation(TITLE, [f], new Set(), NOW);
    expect(actions).toEqual([]);
  });

  it("ignores a fight whose external_id doesn't belong to this event's wiki page", () => {
    // An API-Sports-only fight, or a fight adopted from a merged duplicate
    // event -- never this function's business, regardless of presence.
    const f = fight({ externalId: "2853" });
    const actions = planCardReconciliation(TITLE, [f], new Set(), NOW);
    expect(actions).toEqual([]);
  });

  it("ignores a wiki fight belonging to a DIFFERENT event's title", () => {
    const f = fight({ externalId: "wiki:UFC 331:aaa:bbb" });
    const actions = planCardReconciliation(TITLE, [f], new Set(), NOW);
    expect(actions).toEqual([]);
  });

  it("handles a full card: some present, one freshly missing, one past grace, one already cancelled", () => {
    const present = fight({ id: "present", externalId: `wiki:${TITLE}:a:b` });
    const freshlyMissing = fight({ id: "freshly-missing", externalId: `wiki:${TITLE}:c:d` });
    const pastGrace = fight({
      id: "past-grace",
      externalId: `wiki:${TITLE}:e:f`,
      wikipediaMissingSince: new Date("2026-09-14T00:00:00Z").toISOString(),
    });
    const alreadyCancelled = fight({
      id: "already-cancelled",
      externalId: `wiki:${TITLE}:g:h`,
      settledAt: "2026-09-14T06:00:00Z",
    });

    const actions = planCardReconciliation(
      TITLE,
      [present, freshlyMissing, pastGrace, alreadyCancelled],
      new Set(["present"]),
      NOW,
    );

    expect(actions).toEqual([
      { action: "markMissing", fightId: "freshly-missing" },
      { action: "cancel", fightId: "past-grace" },
    ]);
  });
});
