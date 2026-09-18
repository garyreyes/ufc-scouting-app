import { describe, expect, it } from "vitest";
import { verifyClaims } from "./verifyClaims";
import type { ClaimCheck } from "./types";

interface Claim {
  id: string;
  uris: string[];
}
interface Facts {
  realUris: Set<string>;
}

describe("verifyClaims", () => {
  it("keeps a claim that passes every check", () => {
    const facts: Facts = { realUris: new Set(["u1"]) };
    const checks: ClaimCheck<Claim, Facts>[] = [(c) => ({ ok: true, claim: c })];

    const result = verifyClaims([{ id: "a", uris: ["u1"] }], facts, checks);

    expect(result.kept).toEqual([{ id: "a", uris: ["u1"] }]);
    expect(result.droppedCount).toBe(0);
  });

  it("drops a claim that fails any check, and counts the reason by name", () => {
    const facts: Facts = { realUris: new Set() };
    const checks: ClaimCheck<Claim, Facts>[] = [
      () => ({ ok: false, reason: "unknown_source_uri" }),
    ];

    const result = verifyClaims([{ id: "a", uris: ["fake"] }], facts, checks);

    expect(result.kept).toEqual([]);
    expect(result.droppedCount).toBe(1);
    expect(result.dropReasons).toEqual({ unknown_source_uri: 1 });
  });

  // The generalization of parseClusterResponse.ts's sourceUris filter: a
  // check can NARROW a claim (strip the fake uris) rather than only
  // keep/drop it whole, and the flag survives if anything real is left.
  it("lets a check narrow a claim instead of only keep/drop", () => {
    const facts: Facts = { realUris: new Set(["real1"]) };
    const stripFakeUris: ClaimCheck<Claim, Facts> = (claim, f) => ({
      ok: true,
      claim: { ...claim, uris: claim.uris.filter((u) => f.realUris.has(u)) },
    });

    const result = verifyClaims([{ id: "a", uris: ["real1", "fake"] }], facts, [stripFakeUris]);

    expect(result.kept).toEqual([{ id: "a", uris: ["real1"] }]);
  });

  it("runs later checks against the narrowed claim from earlier checks, not the original", () => {
    const facts: Facts = { realUris: new Set(["real1"]) };
    const strip: ClaimCheck<Claim, Facts> = (claim, f) => ({
      ok: true,
      claim: { ...claim, uris: claim.uris.filter((u) => f.realUris.has(u)) },
    });
    const dropIfEmpty: ClaimCheck<Claim, Facts> = (claim) =>
      claim.uris.length === 0 ? { ok: false, reason: "no_real_sources" } : { ok: true, claim };

    const survivor = verifyClaims([{ id: "a", uris: ["real1"] }], facts, [strip, dropIfEmpty]);
    const casualty = verifyClaims([{ id: "b", uris: ["fake"] }], facts, [strip, dropIfEmpty]);

    expect(survivor.kept).toHaveLength(1);
    expect(casualty.kept).toHaveLength(0);
    expect(casualty.dropReasons).toEqual({ no_real_sources: 1 });
  });

  it("aggregates drop reasons across multiple claims", () => {
    const facts: Facts = { realUris: new Set() };
    const alwaysFail: ClaimCheck<Claim, Facts> = () => ({ ok: false, reason: "bad" });

    const result = verifyClaims(
      [
        { id: "a", uris: [] },
        { id: "b", uris: [] },
      ],
      facts,
      [alwaysFail],
    );

    expect(result.dropReasons).toEqual({ bad: 2 });
    expect(result.droppedCount).toBe(2);
  });

  it("returns an empty result for an empty claim list without calling any check", () => {
    let calls = 0;
    const check: ClaimCheck<Claim, Facts> = (c) => {
      calls++;
      return { ok: true, claim: c };
    };

    const result = verifyClaims([], { realUris: new Set<string>() }, [check]);

    expect(result).toEqual({ kept: [], droppedCount: 0, dropReasons: {} });
    expect(calls).toBe(0);
  });
});
