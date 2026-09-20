import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runIntegritySweep } from "./runIntegritySweepJob";

// A generic fake table backed by a mutable row array shared across calls
// within one test -- needed here (unlike matchAndSnapshot.test.ts's
// single-pass fake) because these tests run the sweep TWICE against the
// same fake DB to prove an alert self-heals once its violation clears.

type Row = Record<string, unknown>;

function getFieldValue(row: Row, col: string): unknown {
  if (col.includes("->>")) {
    const [base, key] = col.split("->>");
    const nested = row[base] as Row | undefined;
    return nested?.[key];
  }
  return row[col];
}

interface Filter {
  op: "eq" | "is" | "gte" | "gt" | "in";
  col: string;
  val: unknown;
}

function matches(row: Row, f: Filter): boolean {
  const actual = getFieldValue(row, f.col);
  switch (f.op) {
    case "eq":
    case "is":
      return actual === f.val;
    case "gte":
      return (actual as string) >= (f.val as string);
    case "gt":
      return (actual as string) > (f.val as string);
    case "in":
      return (f.val as unknown[]).includes(actual);
  }
}

function fakeTable(store: { rows: Row[] }, idPrefix: string) {
  let counter = 0;
  return {
    select() {
      const filters: Filter[] = [];
      const builder = {
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        gte(col: string, val: unknown) {
          filters.push({ op: "gte", col, val });
          return builder;
        },
        gt(col: string, val: unknown) {
          filters.push({ op: "gt", col, val });
          return builder;
        },
        eq(col: string, val: unknown) {
          filters.push({ op: "eq", col, val });
          return builder;
        },
        is(col: string, val: unknown) {
          filters.push({ op: "is", col, val });
          return builder;
        },
        in(col: string, val: unknown[]) {
          filters.push({ op: "in", col, val });
          return builder;
        },
        maybeSingle() {
          const data = store.rows.filter((r) => filters.every((f) => matches(r, f)));
          return Promise.resolve({ data: data[0] ?? null, error: null });
        },
        then(resolve: (r: { data: Row[]; error: null }) => void) {
          const data = store.rows.filter((r) => filters.every((f) => matches(r, f)));
          resolve({ data, error: null });
        },
      };
      return builder;
    },
    insert(payload: Row) {
      store.rows.push({ id: `${idPrefix}-${counter++}`, resolved_at: null, ...payload });
      return Promise.resolve({ error: null });
    },
    update(payload: Row) {
      return {
        in(col: string, ids: unknown[]) {
          store.rows = store.rows.map((r) => (ids.includes(r[col]) ? { ...r, ...payload } : r));
          return Promise.resolve({ error: null });
        },
        eq(col: string, val: unknown) {
          store.rows = store.rows.map((r) => (r[col] === val ? { ...r, ...payload } : r));
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

interface FakeWorld {
  fighters: Row[];
  events: Row[];
  fights: Row[];
  odds_snapshots: Row[];
  data_conflicts: Row[];
  integrity_alerts: Row[];
}

function fakeSupabase(world: Partial<FakeWorld> = {}) {
  const stores: Record<string, { rows: Row[] }> = {
    fighters: { rows: world.fighters ?? [] },
    events: { rows: world.events ?? [] },
    fights: { rows: world.fights ?? [] },
    odds_snapshots: { rows: world.odds_snapshots ?? [] },
    data_conflicts: { rows: world.data_conflicts ?? [] },
    integrity_alerts: { rows: world.integrity_alerts ?? [] },
  };

  const client = {
    from(table: string) {
      return fakeTable(stores[table], table);
    },
  };

  return { client: client as unknown as SupabaseClient, stores };
}

const NOW = new Date("2026-09-20T12:00:00Z");

describe("runIntegritySweep -- empty world", () => {
  it("runs without error and reports zero violations", async () => {
    const { client } = fakeSupabase();
    const summary = await runIntegritySweep(client, NOW);
    expect(summary).toEqual({
      structuralDuplicatesOpened: 0,
      missingSherdogChecksOpened: 0,
      missingSherdogChecksClosed: 0,
      unpricedUnconflictedOpened: 0,
      unpricedUnconflictedClosed: 0,
      staleConflictsOpened: 0,
      staleConflictsClosed: 0,
      duplicateOddsConflictsClosed: 0,
      staleLowConfidenceClosed: 0,
    });
  });
});

describe("runIntegritySweep -- I1 structural duplicate fighters", () => {
  it("opens a data_conflicts row for a seeded structural duplicate, and does not stack a second one on re-run", async () => {
    const { client, stores } = fakeSupabase({
      fighters: [
        { id: "a", name: "Choi Doo-ho", sherdog_checked_at: null },
        { id: "b", name: "Dooho Choi", sherdog_checked_at: null },
      ],
    });

    const first = await runIntegritySweep(client, NOW);
    expect(first.structuralDuplicatesOpened).toBe(1);
    const opened = stores.data_conflicts.rows.filter((r) => r.kind === "structural_duplicate_fighters");
    expect(opened).toHaveLength(1);
    expect(opened[0].details).toEqual({
      fighterAId: "a",
      fighterAName: "Choi Doo-ho",
      fighterBId: "b",
      fighterBName: "Dooho Choi",
    });

    const second = await runIntegritySweep(client, NOW);
    expect(second.structuralDuplicatesOpened).toBe(0);
    expect(stores.data_conflicts.rows.filter((r) => r.kind === "structural_duplicate_fighters")).toHaveLength(1);
  });

  // Reviewer finding: an owner's "not_same_person" verdict must not get
  // silently re-asked. I1 re-scans the WHOLE fighters table every run, so
  // the same coincidental name-fold reappears every single sweep -- an
  // open-only dedupe guard would see no OPEN row for the pair and reopen
  // it, undoing the resolution forever.
  it("does not reopen a pair the owner already resolved as not_same_person", async () => {
    const { client, stores } = fakeSupabase({
      fighters: [
        { id: "a", name: "Choi Doo-ho", sherdog_checked_at: null },
        { id: "b", name: "Dooho Choi", sherdog_checked_at: null },
      ],
      data_conflicts: [
        {
          id: "already-answered",
          kind: "structural_duplicate_fighters",
          resolved_at: "2026-09-15T00:00:00Z",
          resolution: "not_same_person",
          detected_at: "2026-09-14T00:00:00Z",
          details: { fighterAId: "a", fighterAName: "Choi Doo-ho", fighterBId: "b", fighterBName: "Dooho Choi" },
        },
      ],
    });

    const summary = await runIntegritySweep(client, NOW);

    expect(summary.structuralDuplicatesOpened).toBe(0);
    expect(stores.data_conflicts.rows.filter((r) => r.kind === "structural_duplicate_fighters")).toHaveLength(1);
  });
});

describe("runIntegritySweep -- I5 stale conflicts self-heal", () => {
  it("opens an alert for a conflict open >7 days, then closes it once the conflict resolves", async () => {
    const { client, stores } = fakeSupabase({
      data_conflicts: [
        { id: "stale-conflict", kind: "disputed_opponent", resolved_at: null, detected_at: "2026-09-10T00:00:00Z" },
      ],
    });

    const first = await runIntegritySweep(client, NOW);
    expect(first.staleConflictsOpened).toBe(1);
    const openAlerts = stores.integrity_alerts.rows.filter((r) => r.invariant === "I5" && r.resolved_at === null);
    expect(openAlerts).toHaveLength(1);
    expect(openAlerts[0].dedupe_key).toBe("stale-conflict");

    // The conflict gets resolved by an owner between sweeps.
    stores.data_conflicts.rows = stores.data_conflicts.rows.map((r) =>
      r.id === "stale-conflict" ? { ...r, resolved_at: "2026-09-20T00:00:00Z" } : r,
    );

    const second = await runIntegritySweep(client, NOW);
    expect(second.staleConflictsOpened).toBe(0);
    expect(second.staleConflictsClosed).toBe(1);
    expect(stores.integrity_alerts.rows.filter((r) => r.invariant === "I5" && r.resolved_at === null)).toHaveLength(
      0,
    );
  });
});
