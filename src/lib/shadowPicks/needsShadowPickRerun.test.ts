import { describe, expect, it } from "vitest";
import { needsShadowPickRerun } from "./needsShadowPickRerun";

describe("needsShadowPickRerun", () => {
  it("is true when this fight has never had a shadow pick run", () => {
    expect(
      needsShadowPickRerun({ newestDossierAtMs: 100, lastRunAtMs: undefined, oddsTakenAtMs: null }),
    ).toBe(true);
  });

  it("is true when a dossier changed after the last run", () => {
    expect(
      needsShadowPickRerun({ newestDossierAtMs: 200, lastRunAtMs: 100, oddsTakenAtMs: null }),
    ).toBe(true);
  });

  // The actual bug this function fixes: N8 shipped only checking dossier
  // recency, so a fight that had already run at even-odds (no price yet)
  // never re-ran once a real price landed -- it stayed anchored at 50%
  // forever, while the real intern (Fork 10) re-picks every 2h and always
  // reacts to a new price. See PROJECT_FACTS.md.
  it("is true when a price landed after the last run, even with no dossier change", () => {
    expect(
      needsShadowPickRerun({ newestDossierAtMs: 100, lastRunAtMs: 150, oddsTakenAtMs: 200 }),
    ).toBe(true);
  });

  it("is false when neither the dossier nor the price is newer than the last run", () => {
    expect(
      needsShadowPickRerun({ newestDossierAtMs: 100, lastRunAtMs: 150, oddsTakenAtMs: 120 }),
    ).toBe(false);
  });

  it("is false when there is still no price and the dossier hasn't changed", () => {
    expect(
      needsShadowPickRerun({ newestDossierAtMs: 100, lastRunAtMs: 150, oddsTakenAtMs: null }),
    ).toBe(false);
  });

  it("a price exactly at the last run time does not count as newer", () => {
    expect(
      needsShadowPickRerun({ newestDossierAtMs: 100, lastRunAtMs: 150, oddsTakenAtMs: 150 }),
    ).toBe(false);
  });
});
