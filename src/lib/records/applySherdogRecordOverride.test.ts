import { describe, expect, it } from "vitest";
import { applySherdogRecordOverride } from "./applySherdogRecordOverride";
import type { FighterRecord } from "./deriveFighterRecords";

const A = "aaaa";
const B = "bbbb";
const C = "cccc";

const rec = (w: number, l: number, d = 0): FighterRecord => ({ wins: w, losses: l, draws: d });

describe("applySherdogRecordOverride", () => {
  it("a Sherdog-linked fighter gets the Sherdog count, not the graph count", () => {
    const out = applySherdogRecordOverride(
      new Map([[A, rec(3, 1)]]), // graph
      new Map([[A, rec(29, 1)]]), // sherdog
      [A],
    );
    expect(out.get(A)).toEqual(rec(29, 1));
  });

  it("an unlinked fighter keeps the graph count untouched", () => {
    const out = applySherdogRecordOverride(new Map([[B, rec(5, 2)]]), new Map(), [A]);
    expect(out.get(B)).toEqual(rec(5, 2));
  });

  it("a linked fighter with no Sherdog bouts becomes 0-0-0 (Sherdog says fightless)", () => {
    const out = applySherdogRecordOverride(new Map([[A, rec(2, 0)]]), new Map(), [A]);
    expect(out.get(A)).toEqual(rec(0, 0, 0));
  });

  it("a linked fighter absent from the graph still gets their Sherdog record", () => {
    const out = applySherdogRecordOverride(new Map(), new Map([[A, rec(10, 4)]]), [A]);
    expect(out.get(A)).toEqual(rec(10, 4));
  });

  it("does not mutate the input maps", () => {
    const graph = new Map([[A, rec(3, 1)]]);
    applySherdogRecordOverride(graph, new Map([[A, rec(29, 1)]]), [A]);
    expect(graph.get(A)).toEqual(rec(3, 1));
  });

  it("handles a mix: one linked, one not, one linked-and-fightless", () => {
    const out = applySherdogRecordOverride(
      new Map([
        [A, rec(3, 1)],
        [B, rec(7, 7)],
        [C, rec(1, 0)],
      ]),
      new Map([[A, rec(25, 3)]]),
      [A, C],
    );
    expect(out.get(A)).toEqual(rec(25, 3)); // linked -> sherdog
    expect(out.get(B)).toEqual(rec(7, 7)); // unlinked -> graph
    expect(out.get(C)).toEqual(rec(0, 0, 0)); // linked, no sherdog bouts -> zero
  });
});
