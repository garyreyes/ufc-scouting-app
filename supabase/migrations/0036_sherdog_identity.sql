-- Phase J: Sherdog as the identity spine.
--
-- `fighters` has had ONE cross-source key since 0001 (external_id), and
-- 0032/0033 established the "<source>_checked_at" resumable-queue-marker
-- pattern for a job that works through the roster once. Sherdog is a
-- third source with its own id, so it gets the same shape: one id
-- column, one attempt marker.
--
-- Why a dedicated column and not a row in external_id: external_id is
-- already overloaded (an API-Sports numeric id OR a wiki:<pair>
-- placeholder), its uniqueness is load-bearing for upsertFighter's merge
-- fallback, and a fighter legitimately has BOTH an API-Sports id and a
-- Sherdog id at once. A generalised fighter_source_ids table was
-- considered and rejected for this phase: it forces rewriting
-- upsertFighter's existing external_id matching and adds a join to every
-- fighter read, for no gain while there are exactly three sources.
--
-- sherdog_id is an integer, not text: Sherdog routes /fighter/<slug>-<n>
-- purely on the trailing <n> and ignores the slug entirely (verified
-- live 2026-09-07 -- /fighter/anything-76836 resolves to fighter 76836).
-- The slug is decorative; the integer is the whole key.
alter table fighters
  add column sherdog_id integer unique,
  add column sherdog_checked_at timestamptz;

comment on column fighters.sherdog_id is
  'Sherdog''s numeric fighter id (the trailing number in /fighter/<slug>-<id>). Null means not yet resolved. The identity spine: keyed on an integer, not a name string, so transliteration/diacritic/name-order variants collapse to one row.';

comment on column fighters.sherdog_checked_at is
  'When this fighter was last run through the Sherdog identity job, whether or not an id was found. Null means never attempted -- the job''s own queue, same pattern as enrichment_checked_at (0032) and history_backfilled_at (0033).';
