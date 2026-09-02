import { describe, expect, it } from "vitest";
import { buildWikiFightExternalId } from "./buildWikiFightExternalId";

const EVENT = "UFC Fight Night: Hooker vs. Parnasse";
const PINTO = "11111111-1111-1111-1111-111111111111";
const SPANN = "22222222-2222-2222-2222-222222222222";
const DONCHENKO = "33333333-3333-3333-3333-333333333333";

describe("buildWikiFightExternalId", () => {
  // The actual production bug (2026-09-03): the id used to be
  // `wiki:<title>:<card position>`, so when Wikipedia added two bouts
  // higher up the card, index 3 stopped meaning Pinto vs Spann and
  // started meaning Donchenko vs Soriano. upsertFight matched the OLD
  // row by that id and stamped the NEW bout's weight class onto it,
  // while the incoming bout was never inserted at all.
  it("does not change when the bout moves to a different card position", () => {
    // Position is not an input at all -- that is the whole point.
    expect(buildWikiFightExternalId(EVENT, PINTO, SPANN)).toBe(
      buildWikiFightExternalId(EVENT, PINTO, SPANN),
    );
  });

  // Wikipedia lists the winner first on a settled card and can list the
  // pair either way round before then, so the id must not depend on
  // which fighter the template happened to name first.
  it("is identical whichever order the two fighters are given in", () => {
    expect(buildWikiFightExternalId(EVENT, PINTO, SPANN)).toBe(
      buildWikiFightExternalId(EVENT, SPANN, PINTO),
    );
  });

  it("gives two different bouts on the same card two different ids", () => {
    expect(buildWikiFightExternalId(EVENT, PINTO, SPANN)).not.toBe(
      buildWikiFightExternalId(EVENT, PINTO, DONCHENKO),
    );
  });

  it("gives the same pairing on two different cards two different ids", () => {
    expect(buildWikiFightExternalId(EVENT, PINTO, SPANN)).not.toBe(
      buildWikiFightExternalId("UFC 400", PINTO, SPANN),
    );
  });

  it("stays namespaced to the wikipedia sync, so it can never collide with an API-Sports id", () => {
    expect(buildWikiFightExternalId(EVENT, PINTO, SPANN).startsWith("wiki:")).toBe(true);
  });

  it("still identifies the event it belongs to, for a human reading the row", () => {
    expect(buildWikiFightExternalId(EVENT, PINTO, SPANN)).toContain(EVENT);
  });
});
