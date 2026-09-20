// P6 (ROADMAP_V2.md): fighters.sherdog_id is UNIQUE (0036) -- when a write
// collides with an already-claimed id, Supabase throws PostgREST's plain
// {message, code, details, hint} object, never a real Error instance (this
// codebase never calls .throwOnError() -- same underlying reason
// generateInternPicks.ts's isLockedError reads `.message` off any object
// that has one rather than checking `instanceof Error`). Checking the
// constraint name, not just the 23505 code, so this never misfires on a
// different unique violation (fighters.external_id is unique too).
export function isSherdogIdCollisionError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = "code" in err ? String((err as { code: unknown }).code) : "";
  const message = "message" in err ? String((err as { message: unknown }).message) : "";
  return code === "23505" && message.includes("fighters_sherdog_id_key");
}
