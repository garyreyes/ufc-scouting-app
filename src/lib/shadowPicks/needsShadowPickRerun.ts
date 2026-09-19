export interface ShadowPickRerunInputs {
  newestDossierAtMs: number;
  lastRunAtMs: number | undefined;
  oddsTakenAtMs: number | null;
}

/**
 * N8's original gate only checked dossier recency, which silently
 * anchored a fight's shadow pick at 50% forever once it had run once
 * before a price existed -- a new price never re-triggered a run, unlike
 * the real intern (Fork 10), which re-picks every 2h and always reacts to
 * a new price. Found live, 2026-09-19: UFC 331's shadow picks all ran at
 * 11:31Z while every fight was still unpriced (the T-12h window opened at
 * 09:45Z but the odds job was running late), so every LLM_ASSISTED/
 * LLM_ONLY pick was anchored at an even 50% with no market read at all --
 * see PROJECT_FACTS.md.
 */
export function needsShadowPickRerun(input: ShadowPickRerunInputs): boolean {
  if (input.lastRunAtMs === undefined) return true;
  if (input.newestDossierAtMs > input.lastRunAtMs) return true;
  if (input.oddsTakenAtMs !== null && input.oddsTakenAtMs > input.lastRunAtMs) return true;
  return false;
}
