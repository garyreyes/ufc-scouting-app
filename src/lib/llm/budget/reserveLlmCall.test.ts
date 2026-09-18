import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reserveLlmCall } from "./reserveLlmCall";
import { SURFACE_SOFT_CAPS } from "./llmBudgetPolicy";

interface FakeOptions {
  countToday: number;
  countError?: unknown;
  rpcData?: string | null;
  rpcError?: unknown;
}

function fakeSupabase(opts: FakeOptions) {
  const rpc = vi.fn(async () => ({ data: opts.rpcData ?? null, error: opts.rpcError ?? null }));
  const selectBuilder: { eq: () => typeof selectBuilder; then: (resolve: (r: unknown) => void) => void } = {
    eq: () => selectBuilder,
    then: (resolve) => resolve({ count: opts.countToday, error: opts.countError ?? null }),
  };
  const client = {
    from: () => ({ select: () => selectBuilder }),
    rpc,
  } as unknown as SupabaseClient;
  return { client, rpc };
}

describe("reserveLlmCall", () => {
  it("grants when under both the surface soft cap and the daily cap", async () => {
    const { client } = fakeSupabase({ countToday: 0, rpcData: "row-id-123" });

    const decision = await reserveLlmCall(client, "rumours");

    expect(decision).toEqual({ granted: true, callLogId: "row-id-123" });
  });

  it("denies with surface_soft_cap WITHOUT calling the RPC, once the surface count reaches its cap", async () => {
    const { client, rpc } = fakeSupabase({ countToday: SURFACE_SOFT_CAPS.rumours, rpcData: "should-not-be-used" });

    const decision = await reserveLlmCall(client, "rumours");

    expect(decision).toEqual({ granted: false, reason: "surface_soft_cap" });
    // The soft cap is a cheap pre-check specifically so a runaway surface
    // never even reaches the atomic SQL function -- see llmBudgetPolicy.ts.
    expect(rpc).not.toHaveBeenCalled();
  });

  it("denies with daily_cap when the SQL function returns null (either its cap or its RPM guard fired)", async () => {
    const { client } = fakeSupabase({ countToday: 0, rpcData: null });

    const decision = await reserveLlmCall(client, "rumours");

    expect(decision).toEqual({ granted: false, reason: "daily_cap" });
  });

  it("propagates a real error from the count query rather than treating it as zero", async () => {
    const { client } = fakeSupabase({ countToday: 0, countError: new Error("connection reset") });

    await expect(reserveLlmCall(client, "rumours")).rejects.toThrow("connection reset");
  });

  it("propagates a real error from the RPC call", async () => {
    const { client } = fakeSupabase({ countToday: 0, rpcError: new Error("function does not exist") });

    await expect(reserveLlmCall(client, "rumours")).rejects.toThrow("function does not exist");
  });

  it("passes the surface's own soft cap, not another surface's, when checking", async () => {
    // scouting's cap (200) is well above rumours' count here -- an
    // unconfigured or wrong lookup would wrongly deny this.
    const { client } = fakeSupabase({ countToday: SURFACE_SOFT_CAPS.rumours, rpcData: "granted-id" });

    const decision = await reserveLlmCall(client, "scouting");

    expect(decision).toEqual({ granted: true, callLogId: "granted-id" });
  });
});
