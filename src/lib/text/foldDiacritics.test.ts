import { describe, expect, it } from "vitest";
import { foldDiacritics } from "./foldDiacritics";

describe("foldDiacritics", () => {
  it("folds an accented letter to its plain ASCII equivalent", () => {
    expect(foldDiacritics("é")).toBe("e");
  });

  it("leaves plain ASCII text unchanged", () => {
    expect(foldDiacritics("Dan Hooker")).toBe("Dan Hooker");
  });

  // Real production names that all hit this exact fold (2026-09-03, I2
  // live verification against production).
  it.each([
    ["Maurício Ruffy", "Mauricio Ruffy"],
    ["Patrício Pitbull", "Patricio Pitbull"],
    ["José Luiz", "Jose Luiz"],
    ["Gianni Vázquez", "Gianni Vazquez"],
    ["Joel Álvarez", "Joel Alvarez"],
  ])("folds %s to %s", (input, expected) => {
    expect(foldDiacritics(input)).toBe(expected);
  });
});
