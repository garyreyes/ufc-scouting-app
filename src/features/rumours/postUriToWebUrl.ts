// rumour_sources.post_uri (lib/bluesky.ts's BlueskyPost.uri) is an AT
// Protocol URI (`at://<did>/app.bsky.feed.post/<rkey>`) -- not a browser-
// openable link. PRD UC-1's "direct links to each post" requirement means
// an actual clickable https URL, so this resolves one from the stored
// post_uri plus the author's handle (already stored separately, and
// friendlier in a URL than the DID embedded in the AT-URI). ID/redirect
// resolution -- CLAUDE.md's test-first list names this class of work
// explicitly: a wrong extraction here isn't a crash, it's a silently
// dead or wrong link, which is worse for trust in the feature than
// showing no link at all.
export function postUriToWebUrl(postUri: string, authorHandle: string): string | null {
  const match = postUri.match(/\/app\.bsky\.feed\.post\/([^/]+)$/);
  if (!match) return null;
  const rkey = match[1];
  return `https://bsky.app/profile/${authorHandle}/post/${rkey}`;
}
