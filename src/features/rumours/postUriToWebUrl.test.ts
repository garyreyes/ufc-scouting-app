import { describe, expect, it } from "vitest";
import { postUriToWebUrl } from "./postUriToWebUrl";

describe("postUriToWebUrl", () => {
  it("resolves a real AT-URI to a browsable bsky.app link", () => {
    const uri = "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3jxyzabc123";
    expect(postUriToWebUrl(uri, "bloodyelbow.com.web.brid.gy")).toBe(
      "https://bsky.app/profile/bloodyelbow.com.web.brid.gy/post/3jxyzabc123",
    );
  });

  it("uses the handle, not the did, in the resolved link", () => {
    const uri = "at://did:plc:someotherdid/app.bsky.feed.post/abc";
    const url = postUriToWebUrl(uri, "realhandle.bsky.social");
    expect(url).toContain("realhandle.bsky.social");
    expect(url).not.toContain("did:plc");
  });

  it("returns null for a uri missing the app.bsky.feed.post segment", () => {
    expect(postUriToWebUrl("at://did:plc:xyz/app.bsky.feed.repost/abc", "handle")).toBeNull();
  });

  it("returns null for a completely malformed uri", () => {
    expect(postUriToWebUrl("not-a-uri-at-all", "handle")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(postUriToWebUrl("", "handle")).toBeNull();
  });
});
