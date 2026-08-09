// Postgres error 22P02: "invalid input syntax for type uuid". A malformed
// id in the URL (typo, stale link) should read as "not found," not crash
// the page -- callers treat this the same as a real not-found result.
export function isInvalidIdError(error: { code?: string }): boolean {
  return error.code === "22P02";
}
