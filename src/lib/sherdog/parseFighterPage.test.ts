import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBio, parseFinishBreakdown, parseHeadlineRecord } from "./parseFighterPage";
import { parseFightHistory } from "./parseFightHistory";

const fx = (n: string) => readFileSync(join(__dirname, "__fixtures__", n), "utf-8");
const OLIVEIRA = fx("fighter-oliveira-30300.html");
const MAKHACHEV = fx("fighter-makhachev-76836.html");
const QILENG = fx("fighter-qileng-aori-222519.html");
const LETOI = fx("fighter-letoi-345261.html");
const FIGUEIREDO = fx("fighter-figueiredo-110485.html");

describe("parseBio", () => {
  it("reads every field from a complete page (Oliveira)", () => {
    expect(parseBio(OLIVEIRA)).toEqual({
      name: "Charles Oliveira",
      nickname: "do Bronxs",
      heightCm: 178,
      weightKg: 70,
      birthDate: "Oct 17, 1989",
      printedAge: 36,
      nationality: "Brazil",
      birthplace: "Guaruja, Sao Paulo",
    });
  });

  it("reads the age Sherdog prints beside the birth date (Makhachev)", () => {
    expect(parseBio(MAKHACHEV).printedAge).toBe(34);
  });

  it("takes the clean display name, not the nickname-laden meta (Makhachev)", () => {
    const bio = parseBio(MAKHACHEV);
    expect(bio.name).toBe("Islam Makhachev");
    expect(bio.nickname).toBeNull();
    expect(bio.nationality).toBe("Russia");
  });

  it("returns null for fields Sherdog does not have, without throwing (Letoi)", () => {
    const bio = parseBio(LETOI);
    expect(bio.name).toBe("Liam Letoi");
    expect(bio.heightCm).toBeNull();
    expect(bio.birthDate).toBeNull();
    expect(bio.printedAge).toBeNull();
    expect(bio.birthplace).toBeNull();
  });
});

describe("parseHeadlineRecord", () => {
  it("Oliveira: 37-11-0 with 1 No Contest", () => {
    expect(parseHeadlineRecord(OLIVEIRA)).toEqual({ wins: 37, losses: 11, draws: 0, noContests: 1 });
  });

  it("Makhachev: 29-1-0, no NC block on the page", () => {
    expect(parseHeadlineRecord(MAKHACHEV)).toEqual({ wins: 29, losses: 1, draws: 0, noContests: 0 });
  });

  it("Letoi: 0-1-0, a debut loss", () => {
    expect(parseHeadlineRecord(LETOI)).toEqual({ wins: 0, losses: 1, draws: 0, noContests: 0 });
  });

  it("Figueiredo: 25-7 with a real DRAW — the class suffix is 'draws', not 'draw'", () => {
    // Sherdog pluralises the headline class inconsistently (win / lose /
    // draws / nc). Before this was pinned, every fighter with a real
    // draw failed J4's headline-vs-counted cross-check.
    expect(parseHeadlineRecord(FIGUEIREDO)).toEqual({ wins: 25, losses: 7, draws: 1, noContests: 0 });
  });

  // The load-bearing cross-check: J5 stores this headline number for a
  // Sherdog-linked fighter INSTEAD of counting the imported graph. If the
  // two disagree, J4 opens a conflict rather than writing. These fixtures
  // prove they agree on real pages.
  it.each([
    ["Oliveira", OLIVEIRA],
    ["Makhachev", MAKHACHEV],
    ["Qileng Aori", QILENG],
    ["Letoi", LETOI],
    ["Figueiredo", FIGUEIREDO],
  ])("%s: headline W-L equals counting the history rows", (_name, html) => {
    const rec = parseHeadlineRecord(html);
    const hist = parseFightHistory(html);
    const counted = { win: 0, loss: 0, draw: 0, nc: 0, unknown: 0 };
    for (const f of hist) counted[f.result]++;
    expect(counted.win).toBe(rec.wins);
    expect(counted.loss).toBe(rec.losses);
    expect(counted.draw).toBe(rec.draws);
    expect(counted.nc).toBe(rec.noContests);
    expect(counted.unknown).toBe(0);
  });
});

describe("parseFinishBreakdown", () => {
  it("Oliveira: wins 10 KO / 22 SUB / 5 DEC, losses 5 KO / 4 SUB / 2 DEC", () => {
    expect(parseFinishBreakdown(OLIVEIRA)).toEqual({
      winsByKo: 10,
      winsBySub: 22,
      winsByDecision: 5,
      lossesByKo: 5,
      lossesBySub: 4,
      lossesByDecision: 2,
    });
  });

  it("the finish counts sum to the headline W and L", () => {
    const rec = parseHeadlineRecord(OLIVEIRA);
    const f = parseFinishBreakdown(OLIVEIRA);
    expect(f.winsByKo + f.winsBySub + f.winsByDecision).toBe(rec.wins);
    expect(f.lossesByKo + f.lossesBySub + f.lossesByDecision).toBe(rec.losses);
  });
});
