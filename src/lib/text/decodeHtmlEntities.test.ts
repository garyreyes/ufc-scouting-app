import { describe, expect, it } from "vitest";
import { decodeHtmlEntities } from "./decodeHtmlEntities";

describe("decodeHtmlEntities", () => {
  it("decodes the real-world bug: hex numeric apostrophe (RETROSPECTIVE.md entry #9)", () => {
    expect(decodeHtmlEntities("Casey O&#x27;Neill")).toBe("Casey O'Neill");
  });

  it("decodes uppercase hex numeric entities too", () => {
    expect(decodeHtmlEntities("Don&#X27;Tale Mayes")).toBe("Don'Tale Mayes");
  });

  it("decodes decimal numeric entities, with or without a leading zero", () => {
    expect(decodeHtmlEntities("Sean O&#39;Malley")).toBe("Sean O'Malley");
    expect(decodeHtmlEntities("Sean O&#039;Malley")).toBe("Sean O'Malley");
  });

  it("decodes the basic named entities", () => {
    expect(decodeHtmlEntities("Smith &amp; Jones")).toBe("Smith & Jones");
    expect(decodeHtmlEntities("&lt;tag&gt;")).toBe("<tag>");
    expect(decodeHtmlEntities("&quot;quoted&quot;")).toBe('"quoted"');
    expect(decodeHtmlEntities("O&apos;Neill")).toBe("O'Neill");
    expect(decodeHtmlEntities("a&nbsp;b")).toBe("a b");
  });

  it("does not double-decode an already-escaped entity (single-pass, not sequential)", () => {
    // The source meant a literal "&lt;", never a real "<" -- decoding
    // &amp; first and then re-scanning for &lt; would wrongly produce "<".
    expect(decodeHtmlEntities("&amp;lt;")).toBe("&lt;");
  });

  it("decodes an arbitrary numeric entity outside the small named table", () => {
    expect(decodeHtmlEntities("caf&#233;")).toBe("café"); // é = U+00E9 = 233 decimal
    expect(decodeHtmlEntities("caf&#xe9;")).toBe("café");
  });

  it("leaves an unknown named entity untouched rather than guessing", () => {
    expect(decodeHtmlEntities("&notreal;")).toBe("&notreal;");
  });

  it("leaves an out-of-range or lone-surrogate numeric entity untouched, never throwing", () => {
    expect(() => decodeHtmlEntities("&#xd800;")).not.toThrow();
    expect(decodeHtmlEntities("&#xd800;")).toBe("&#xd800;");
    expect(decodeHtmlEntities("&#99999999;")).toBe("&#99999999;");
  });

  it("passes plain text through unchanged", () => {
    expect(decodeHtmlEntities("Alexandre Pantoja")).toBe("Alexandre Pantoja");
  });

  it("handles multiple entities in one string", () => {
    expect(decodeHtmlEntities("O&#x27;Neill &amp; O&#39;Malley")).toBe("O'Neill & O'Malley");
  });
});
