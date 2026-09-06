import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFighterHtmlById, fetchSherdogHtml, validateSherdogId } from "./client";

type FetchMock = ReturnType<typeof makeFetchMock>;
function makeFetchMock() {
  return vi.fn<(url: string | URL, init?: RequestInit) => Promise<Response>>();
}
const asFetch = (m: FetchMock) => m as unknown as typeof fetch;

describe("validateSherdogId", () => {
  it("accepts a positive integer and returns it", () => {
    expect(validateSherdogId(76836)).toBe(76836);
  });

  it("coerces a clean numeric string", () => {
    expect(validateSherdogId(" 76836 ")).toBe(76836);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["float", 76836.5],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["over int32", 2_147_483_648],
    ["non-numeric string", "76836 OR 1=1"],
    ["empty string", ""],
    ["null", null],
    ["undefined", undefined],
    ["object", {}],
  ])("rejects %s", (_label, value) => {
    expect(() => validateSherdogId(value)).toThrow(/Invalid Sherdog id/);
  });
});

describe("fetchSherdogHtml", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the body on 200 and sends a browser User-Agent", async () => {
    const fetchImpl = makeFetchMock();
    fetchImpl.mockResolvedValue(new Response("<html>ok</html>", { status: 200 }));

    await expect(
      fetchSherdogHtml("/fighter/76836", { spacingMs: 0, fetchImpl: asFetch(fetchImpl) }),
    ).resolves.toBe("<html>ok</html>");

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://www.sherdog.com/fighter/76836");
    expect(init?.headers).toMatchObject({ "User-Agent": expect.stringContaining("Mozilla") });
  });

  it("throws on a non-2xx response", async () => {
    const fetchImpl = makeFetchMock();
    fetchImpl.mockResolvedValue(new Response("nope", { status: 503, statusText: "Service Unavailable" }));

    await expect(
      fetchSherdogHtml("/fighter/76836", { spacingMs: 0, fetchImpl: asFetch(fetchImpl) }),
    ).rejects.toThrow(/Sherdog request failed: 503/);
  });

  it("rejects a non-absolute path before any fetch", async () => {
    const fetchImpl = makeFetchMock();
    await expect(
      fetchSherdogHtml("fighter/76836", { spacingMs: 0, fetchImpl: asFetch(fetchImpl) }),
    ).rejects.toThrow(/site-absolute path/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("one failing call does not poison the throttle chain for the next", async () => {
    const fetchImpl = makeFetchMock();
    fetchImpl
      .mockResolvedValueOnce(new Response("x", { status: 500, statusText: "err" }))
      .mockResolvedValueOnce(new Response("<html>second</html>", { status: 200 }));

    await expect(
      fetchSherdogHtml("/fighter/1", { spacingMs: 0, fetchImpl: asFetch(fetchImpl) }),
    ).rejects.toThrow();
    await expect(
      fetchSherdogHtml("/fighter/2", { spacingMs: 0, fetchImpl: asFetch(fetchImpl) }),
    ).resolves.toBe("<html>second</html>");
  });
});

describe("fetchFighterHtmlById", () => {
  afterEach(() => vi.restoreAllMocks());

  it("validates the id before building the URL (rejected promise, not a sync throw)", async () => {
    const fetchImpl = makeFetchMock();
    await expect(
      fetchFighterHtmlById(-5, { spacingMs: 0, fetchImpl: asFetch(fetchImpl) }),
    ).rejects.toThrow(/Invalid Sherdog id/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requests /fighter/<id> for a valid id", async () => {
    const fetchImpl = makeFetchMock();
    fetchImpl.mockResolvedValue(new Response("<html>f</html>", { status: 200 }));
    await fetchFighterHtmlById(76836, { spacingMs: 0, fetchImpl: asFetch(fetchImpl) });
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://www.sherdog.com/fighter/76836");
  });
});
