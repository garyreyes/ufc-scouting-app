# supabase/data-fixes

One-off, manually-run SQL that repairs **data**, not schema. Distinct from
`supabase/migrations/` (schema, applied by every environment, never
edited once run) and `supabase/tests/` (RLS assertions).

Each file here is a record of a deliberate production data cleanup —
what was wrong, why, the exact statements, and what to verify after.
Nothing runs these automatically. They exist so a later session can see
how a class of problem was handled (the same reason `PROJECT_FACTS.md`
records the Phase 7 duplicate-cleanup and the I4b UFC 330 event merge).

**Convention:** `YYYY-MM-DD_short-description.sql`, wrapped in
`begin; … commit;`, with a header comment covering pre-state, the fix,
and the post-check. Run in the Supabase SQL editor against the pinned
project (`vrwlfcywyfzfczajpdoh`), never blindly re-run.

| File | What it fixed |
|---|---|
| `2026-09-09_merge-ufc-paris-duplicate-event.sql` | "UFC Fight Night: Paris" and "UFC Fight Night: Hooker vs. Parnasse" were two rows for one 2026-09-05 card; Michael Page vs Ruziboev existed twice (one settled, one not) |
