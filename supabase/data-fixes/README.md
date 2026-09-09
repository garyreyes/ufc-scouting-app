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

**Always dry-run first: swap the final `commit;` for `rollback;` and run
it.** Every statement executes against real data and nothing persists, so
all the blockers surface in one pass. The 2026-09-09 merge below hit
three separate ones — a pick-lock trigger, odds-snapshot immutability,
and an Elo foreign key — and each was found only after a failed COMMIT
until the rollback dry-run was used. Before touching `fights`, also list
what references it:

```sql
select tc.table_name, kcu.column_name, rc.delete_rule
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
where tc.constraint_type = 'FOREIGN KEY' and ccu.table_name = 'fights';
```

Six tables FK-reference `fights.id`: `picks`, `odds_snapshots`,
`fighter_elo_history`, `rumour_flags`, `data_conflicts` (all RESTRICT /
NO ACTION) and `scouting_reports` (CASCADE).

| File | What it fixed |
|---|---|
| `2026-09-09_merge-ufc-paris-duplicate-event.sql` | "UFC Fight Night: Paris" and "UFC Fight Night: Hooker vs. Parnasse" were two rows for one 2026-09-05 card; Michael Page vs Ruziboev existed twice (one settled, one not) |
