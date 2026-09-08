import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSearchResults } from "./parseSearch";

const fx = (n: string) => readFileSync(join(__dirname, "__fixtures__", n), "utf-8");

describe("parseSearchResults", () => {
  it("returns every candidate row with a stable Sherdog id (Makhachev search)", () => {
    const c = parseSearchResults(fx("search-makhachev.html"));
    expect(c.map((x) => x.sherdogId)).toEqual([224121, 76836, 375266, 100759]);
    expect(c.find((x) => x.sherdogId === 76836)).toEqual({
      sherdogId: 76836,
      name: "Islam Makhachev",
      nickname: null,
      heightImperial: `5'10"`,
      weightImperial: "170 lbs",
      association: "Eagles MMA / American Kickboxing Academy",
    });
  });

  it("treats Sherdog's 0'0\" / 0 lbs placeholders as missing, not real values", () => {
    const c = parseSearchResults(fx("search-makhachev.html"));
    const ali = c.find((x) => x.sherdogId === 224121)!;
    expect(ali.heightImperial).toBeNull();
  });

  it("strips the literal quotes Sherdog wraps around a nickname", () => {
    const c = parseSearchResults(fx("search-andre-lima.html"));
    const bamBam = c.find((x) => x.name === "Alexandre Lima" && x.nickname);
    expect(bamBam?.nickname).toBe("Bam Bam");
  });

  it("returns the full ambiguous candidate list for a common name (13 for 'Andre Lima')", () => {
    // This is why identity resolution goes through the review queue: the
    // right 'Andre Lima' is not obviously the top hit.
    const c = parseSearchResults(fx("search-andre-lima.html"));
    expect(c.length).toBe(13);
    expect(c.some((x) => x.name === "Andre Lima")).toBe(true);
  });

  it("returns [] for HTML with no results table rather than throwing", () => {
    expect(parseSearchResults("<html><body>nothing here</body></html>")).toEqual([]);
  });
});
