import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getFighters } from "./api";
import type { Fighter } from "./types";

const ROW_CAP = 1000;

function makeFighter(n: number, weightClass: string | null = "Lightweight"): Fighter {
  return {
    id: `id-${String(n).padStart(6, "0")}`,
    name: `Filler Fighter ${n}`,
    height_cm: null,
    reach_cm: null,
    weight_class: weightClass,
    stance: null,
    wins: 0,
    losses: 0,
    draws: 0,
    sherdog_wins_by_ko: null,
    sherdog_wins_by_sub: null,
    sherdog_wins_by_dec: null,
    sherdog_losses_by_ko: null,
    sherdog_losses_by_sub: null,
    sherdog_losses_by_dec: null,
    sherdog_history_imported_at: null,
  };
}

/**
 * Covers `.from("fighters").select(...).order().ilike()` (paged, same
 * ROW_CAP truncation PostgREST applies live) and `.from("fights").select
 * (...).or(...)` (the weight-class-fill fallback, unpaged per call but
 * with every `.or()` call's id list recorded so chunking can be
 * asserted).
 */
function fakeSupabase(fighters: Fighter[], fights: { fighter1_id: string; fighter2_id: string }[] = []) {
  const orCalls: string[] = [];

  const client = {
    from(table: "fighters" | "fights") {
      if (table === "fighters") {
        return {
          select() {
            let ilikeVal: string | null = null;
            let gtValue: string | null = null;
            let limitValue = ROW_CAP;
            const builder = {
              ilike(_c: string, v: string) {
                ilikeVal = v;
                return builder;
              },
              order() {
                return builder;
              },
              gt(_c: string, v: string) {
                gtValue = v;
                return builder;
              },
              limit(n: number) {
                limitValue = Math.min(limitValue, n);
                return builder;
              },
              then(resolve: (result: { data: Fighter[]; error: null }) => void) {
                let rows = [...fighters].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
                if (ilikeVal !== null) {
                  const needle = ilikeVal.replace(/%/g, "").toLowerCase();
                  rows = rows.filter((r) => r.name.toLowerCase().includes(needle));
                }
                if (gtValue !== null) rows = rows.filter((r) => r.id > (gtValue as string));
                resolve({ data: rows.slice(0, limitValue), error: null });
              },
            };
            return builder;
          },
        };
      }
      return {
        select() {
          return {
            or(orString: string) {
              orCalls.push(orString);
              // Every fighter1/fighter2 id mentioned in this OR clause,
              // matched against the seeded fights -- good enough for a
              // fake, since the real assertion is about chunk count/size.
              const ids = orString.match(/\(([^)]*)\)/g)?.flatMap((s) => s.slice(1, -1).split(",")) ?? [];
              const matched = fights.filter((f) => ids.includes(f.fighter1_id) || ids.includes(f.fighter2_id));
              return Promise.resolve({
                data: matched.map((f) => ({ ...f, weight_class: "Welterweight", event: { event_date: "2026-09-01" } })),
                error: null,
              });
            },
          };
        },
      };
    },
  };

  return { client: client as unknown as SupabaseClient, orCalls };
}

describe("getFighters", () => {
  it("returns every fighter even past PostgREST's row cap", async () => {
    // 1,050 fighters (today's real count is 822 and rising).
    const fighters = Array.from({ length: 1050 }, (_, i) => makeFighter(i));
    const { client } = fakeSupabase(fighters);

    const result = await getFighters("", [], client);

    expect(result).toHaveLength(1050);
  });

  it("chunks the weight-class-fill lookup instead of one oversized .or() list", async () => {
    // 250 fighters with no weight_class -- enough to force multiple
    // chunks at the shared DEFAULT_CHUNK_SIZE (100).
    const fighters = Array.from({ length: 250 }, (_, i) => makeFighter(i, null));
    const fights = fighters.map((f) => ({ fighter1_id: f.id, fighter2_id: "opponent" }));
    const { client, orCalls } = fakeSupabase(fighters, fights);

    const result = await getFighters("", [], client);

    expect(orCalls.length).toBeGreaterThan(1);
    // Each chunk's OR clause mentions at most 100 ids per side.
    for (const orString of orCalls) {
      const idsInClause = orString.match(/\(([^)]*)\)/)?.[1].split(",") ?? [];
      expect(idsInClause.length).toBeLessThanOrEqual(100);
    }
    expect(result.every((f) => f.weight_class === "Welterweight")).toBe(true);
  });
});
