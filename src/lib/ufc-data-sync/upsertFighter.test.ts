import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertFighter } from "./upsertFighter";

interface FighterRow {
  id: string;
  name: string;
  external_id: string | null;
}

interface AliasRow {
  alias: string;
  fighter_id: string;
}

function fakeSupabase(fighters: FighterRow[], aliases: AliasRow[] = []) {
  const updates: { id: string; payload: Record<string, unknown> }[] = [];
  const inserts: Record<string, unknown>[] = [];
  let nextId = 1;

  const client = {
    from(table: "fighters" | "fighter_aliases") {
      if (table === "fighter_aliases") {
        return {
          select() {
            return Promise.resolve({ data: aliases, error: null });
          },
        };
      }
      return {
        select() {
          let eqCol: string | null = null;
          let eqVal: unknown = null;
          let ilikeVal: string | null = null;
          const builder = {
            eq(col: string, val: unknown) {
              eqCol = col;
              eqVal = val;
              return builder;
            },
            ilike(_c: string, val: string) {
              ilikeVal = val;
              return builder;
            },
            maybeSingle() {
              let row: FighterRow | undefined;
              if (eqCol) row = fighters.find((f) => (f as unknown as Record<string, unknown>)[eqCol!] === eqVal);
              else if (ilikeVal !== null) {
                const needle = ilikeVal.toLowerCase();
                row = fighters.find((f) => f.name.toLowerCase() === needle);
              }
              return Promise.resolve({ data: row ?? null, error: null });
            },
            then(resolve: (r: { data: FighterRow[]; error: null }) => void) {
              resolve({ data: fighters, error: null });
            },
          };
          return builder;
        },
        update(payload: Record<string, unknown>) {
          return {
            eq(_c: string, id: string) {
              const row = fighters.find((f) => f.id === id);
              if (row) Object.assign(row, payload);
              updates.push({ id, payload });
              return Promise.resolve({ error: null });
            },
          };
        },
        insert(payload: Record<string, unknown>) {
          return {
            select() {
              return {
                single() {
                  const row = { id: `new-${nextId++}`, external_id: null, ...payload } as FighterRow;
                  fighters.push(row);
                  inserts.push(payload);
                  return Promise.resolve({ data: { id: row.id }, error: null });
                },
              };
            },
          };
        },
      };
    },
  };

  return { client: client as unknown as SupabaseClient, fighters, updates, inserts };
}

describe("upsertFighter -- alias resolution (M3)", () => {
  it("resolves an incoming name through fighter_aliases before ever reaching the name match", () => {
    // "Jose Delgado" was merged away; its name lives on as an alias
    // pointing at the keeper, "Jose Miguel Delgado". A later sync
    // reporting the OLD name must resolve straight to the keeper, not
    // recreate a duplicate or reopen a dispute.
    const { client, updates } = fakeSupabase(
      [{ id: "keeper", name: "Jose Miguel Delgado", external_id: "2759" }],
      [{ alias: "Jose Delgado", fighter_id: "keeper" }],
    );

    return upsertFighter(client, { name: "Jose Delgado" }).then((id) => {
      expect(id).toBe("keeper");
      expect(updates).toEqual([{ id: "keeper", payload: { name: "Jose Delgado" } }]);
    });
  });

  it("matches an alias case/diacritic-insensitively, same as the rest of this module's name matching", async () => {
    const { client } = fakeSupabase(
      [{ id: "keeper", name: "Andre Lima", external_id: "2679" }],
      [{ alias: "André Lima", fighter_id: "keeper" }],
    );

    const id = await upsertFighter(client, { name: "andre lima" });
    expect(id).toBe("keeper");
  });

  it("falls through to normal insert when no alias matches", async () => {
    const { client, inserts } = fakeSupabase([], [{ alias: "Someone Else", fighter_id: "other" }]);

    const id = await upsertFighter(client, { name: "Brand New Fighter" });

    expect(id).toBe("new-1");
    expect(inserts).toHaveLength(1);
  });
});
