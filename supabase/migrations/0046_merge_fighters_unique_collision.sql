-- Fix: merge_fighters() (0045) always failed whenever the DROPPED fighter
-- carried a sherdog_id or external_id the keeper lacked -- which is the
-- single most common shape this function exists for, and exactly the
-- production pair 0045's own step-3a comment cites as its motivating
-- example (Jose Delgado #307733 / Jose Miguel Delgado external_id 2759).
-- Hit live on the first real run, 2026-09-18:
--   23505 duplicate key value violates unique constraint
--   "fighters_sherdog_id_key" -- Key (sherdog_id)=(307733) already exists.
--
-- Both fighters.sherdog_id and fighters.external_id are UNIQUE (0001).
-- 0045's step 5 copied the drop row's value ONTO the keeper while the drop
-- row still held that same value -- the drop row is not deleted until step
-- 7, several statements later. Postgres enforces a non-deferrable unique
-- constraint as each row version is written into the index, not at commit,
-- so the keeper's new index entry collides with the drop row's still-live
-- one and the whole merge aborts.
--
-- Note this is NOT fixable by folding both writes into one UPDATE touching
-- both rows: a single statement gets no reprieve either (the same reason
-- `update t set id = id + 1` fails on a unique id). The ordering is what
-- matters -- clear the drop row FIRST, then write the keeper -- so there
-- is never a moment when two live rows hold the same value. The drop row
-- is deleted at step 7 regardless, so nulling its identity columns here
-- costs nothing.
--
-- Deliberately NOT done by making the constraints DEFERRABLE INITIALLY
-- DEFERRED instead: that would relax uniqueness enforcement for every
-- other writer of these columns (the API-Sports sync, the Sherdog
-- resolver) to catch violations only at commit, to fix one function's
-- statement ordering. Narrow fix over a schema-wide behaviour change.
--
-- Everything else in this function is byte-identical to 0045.
create or replace function merge_fighters(p_keep_id uuid, p_drop_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  -- %type throughout rather than spelled-out types: sherdog_id is integer
  -- (0036) but the finish columns are smallint (0038), and this function
  -- has no business being the place that drift shows up.
  _drop_sherdog_id fighters.sherdog_id%type;
  _drop_sherdog_history_imported_at fighters.sherdog_history_imported_at%type;
  _drop_sherdog_wins_by_ko fighters.sherdog_wins_by_ko%type;
  _drop_sherdog_wins_by_sub fighters.sherdog_wins_by_sub%type;
  _drop_sherdog_wins_by_dec fighters.sherdog_wins_by_dec%type;
  _drop_sherdog_losses_by_ko fighters.sherdog_losses_by_ko%type;
  _drop_sherdog_losses_by_sub fighters.sherdog_losses_by_sub%type;
  _drop_sherdog_losses_by_dec fighters.sherdog_losses_by_dec%type;
  _drop_external_id fighters.external_id%type;
  _keep_sherdog_id fighters.sherdog_id%type;
  _keep_external_id fighters.external_id%type;
begin
  if p_keep_id = p_drop_id then
    raise exception 'merge_fighters: keep and drop are the same fighter (%)', p_keep_id;
  end if;
  if not exists (select 1 from fighters where id = p_keep_id) then
    raise exception 'merge_fighters: keep fighter % does not exist', p_keep_id;
  end if;
  if not exists (select 1 from fighters where id = p_drop_id) then
    raise exception 'merge_fighters: drop fighter % does not exist', p_drop_id;
  end if;

  -- Transaction-LOCAL only (third arg true) -- reverts automatically at
  -- commit/rollback, so it can never leak across a pooled connection to
  -- an unrelated later statement (the same reason 0027's settlement
  -- bypass keys off the CONNECTING ROLE rather than a session-level
  -- setting). check_pick_constraints() reads this to skip the pick-lock
  -- and open-conflict checks for exactly this one transaction.
  perform set_config('app.merging_fighters', 'on', true);

  -- 1. Repoint every fights reference, all six columns in ONE statement --
  --    see the 2026-09-10 data-fix's own comment on why: doing it as six
  --    separate UPDATEs transiently violates fights_winner_is_in_the_bout
  --    (0031) the moment the fighter columns move but winner_id hasn't yet.
  update fights set
    fighter1_id          = case when fighter1_id = p_drop_id then p_keep_id else fighter1_id end,
    fighter2_id          = case when fighter2_id = p_drop_id then p_keep_id else fighter2_id end,
    winner_id            = case when winner_id = p_drop_id then p_keep_id else winner_id end,
    wikipedia_winner_id  = case when wikipedia_winner_id = p_drop_id then p_keep_id else wikipedia_winner_id end,
    api_sports_winner_id = case when api_sports_winner_id = p_drop_id then p_keep_id else api_sports_winner_id end,
    sherdog_winner_id    = case when sherdog_winner_id = p_drop_id then p_keep_id else sherdog_winner_id end
  where p_drop_id in (
    fighter1_id, fighter2_id, winner_id,
    wikipedia_winner_id, api_sports_winner_id, sherdog_winner_id
  );

  if exists (select 1 from fights where fighter1_id = fighter2_id) then
    raise exception 'merge_fighters: would produce a self-referential fight row -- aborting';
  end if;

  -- 2. Repoint picks. Runs AFTER step 1 on purpose: by the time this
  --    fires, the fight's own fighter1_id/fighter2_id already point at
  --    p_keep_id, so check_pick_constraints()'s fighter-membership check
  --    (new.predicted_fighter_id must be one of the fight's two fighters)
  --    passes on its own -- only the pick-lock timing and open-conflict
  --    checks need the bypass above.
  update picks set predicted_fighter_id = p_keep_id where predicted_fighter_id = p_drop_id;
  update picks set bet_fighter_id = p_keep_id where bet_fighter_id = p_drop_id;

  -- 3. Repoint rumour flags.
  update rumour_flags set fighter_id = p_keep_id where fighter_id = p_drop_id;

  -- 3a. Repoint the dropped fighter's imported Sherdog career (0038) onto
  --     the keeper -- both tables' fighter_id columns are `on delete
  --     cascade`, so skipping this and going straight to the delete below
  --     would silently DESTROY the drop fighter's real bout history and
  --     any scouting notes on them, not just re-file them.
  update fighter_sherdog_bouts b set fighter_id = p_keep_id
  where b.fighter_id = p_drop_id
    and not exists (
      select 1 from fighter_sherdog_bouts k
      where k.fighter_id = p_keep_id and k.bout_order = b.bout_order
    );
  delete from fighter_sherdog_bouts where fighter_id = p_drop_id; -- any leftover conflicting rows

  -- 3b. Repoint fighter-level scouting notes (0009, [FROZEN] feature but
  --     still real user data -- no reason a merge should ever be the
  --     thing that silently deletes someone's notes).
  update fighter_scouting_reports set fighter_id = p_keep_id where fighter_id = p_drop_id;

  -- 4. Clear the dropped fighter's Elo history -- the caller is
  --    responsible for a full recomputeEloRatings() afterward, same
  --    "clear here, rebuild from scratch there" split
  --    sweepLatentDisputedOpponents.ts already established.
  delete from fighter_elo_history where fighter_id = p_drop_id;

  -- 5. Move sherdog_id (plus everything derived from it -- the import
  --    timestamp and finish-breakdown columns J5/J7 read, which are
  --    meaningless without it) and external_id onto the keeper where it
  --    lacks them. Two independent identity links, each only ever filling
  --    a gap, never overwriting a real value: checkMergeGuard already
  --    refuses the merge outright when both sides carry DIFFERENT
  --    non-null sherdog_ids, so this never has to pick a winner between
  --    two real ones. Without moving the derived columns too, step 3a's
  --    repointed bout rows would sit under the keeper unrecognized --
  --    recomputeFighterRecords.ts keys the Sherdog-record override on
  --    `sherdog_history_imported_at`, not on the bout rows existing.
  --
  --    MOVE, not copy (this is the 0045 fix): both columns are UNIQUE, so
  --    the drop row has to give the value up BEFORE the keeper takes it,
  --    in a separate earlier statement. See this migration's header.
  select
    sherdog_id, sherdog_history_imported_at,
    sherdog_wins_by_ko, sherdog_wins_by_sub, sherdog_wins_by_dec,
    sherdog_losses_by_ko, sherdog_losses_by_sub, sherdog_losses_by_dec,
    external_id
  into
    _drop_sherdog_id, _drop_sherdog_history_imported_at,
    _drop_sherdog_wins_by_ko, _drop_sherdog_wins_by_sub, _drop_sherdog_wins_by_dec,
    _drop_sherdog_losses_by_ko, _drop_sherdog_losses_by_sub, _drop_sherdog_losses_by_dec,
    _drop_external_id
  from fighters where id = p_drop_id;

  select sherdog_id, external_id into _keep_sherdog_id, _keep_external_id
  from fighters where id = p_keep_id;

  if _keep_sherdog_id is null and _drop_sherdog_id is not null then
    update fighters set sherdog_id = null where id = p_drop_id;
    update fighters set
      sherdog_id = _drop_sherdog_id,
      sherdog_history_imported_at = _drop_sherdog_history_imported_at,
      sherdog_wins_by_ko = _drop_sherdog_wins_by_ko,
      sherdog_wins_by_sub = _drop_sherdog_wins_by_sub,
      sherdog_wins_by_dec = _drop_sherdog_wins_by_dec,
      sherdog_losses_by_ko = _drop_sherdog_losses_by_ko,
      sherdog_losses_by_sub = _drop_sherdog_losses_by_sub,
      sherdog_losses_by_dec = _drop_sherdog_losses_by_dec
    where id = p_keep_id;
  end if;

  if _keep_external_id is null and _drop_external_id is not null then
    update fighters set external_id = null where id = p_drop_id;
    update fighters set external_id = _drop_external_id where id = p_keep_id;
  end if;

  -- 5a. Repoint any EARLIER aliases that already point at the drop
  --     fighter -- a fighter can be merged more than once (a further
  --     rename, a further correction), and fighter_aliases.fighter_id is
  --     `on delete cascade`. Without this, step 7's delete below would
  --     cascade-destroy an earlier alias row instead of repointing it,
  --     and the next time that older name arrives from any source,
  --     upsertFighter.ts's alias lookup would find nothing and recreate
  --     the exact duplicate this feature exists to stop.
  update fighter_aliases set fighter_id = p_keep_id where fighter_id = p_drop_id;

  -- 6. Record the dropped name as an alias before the row disappears --
  --    upsertFighter.ts's alias check means the NEXT time this exact name
  --    comes in from any source, it resolves straight to the keeper
  --    instead of re-creating a duplicate and re-opening a dispute.
  insert into fighter_aliases (alias, fighter_id, source)
  select d.name, p_keep_id, 'merge' from fighters d where d.id = p_drop_id
  on conflict (alias) do update set fighter_id = excluded.fighter_id;

  -- 7. Delete the dropped row -- nothing references it now.
  delete from fighters where id = p_drop_id;
end;
$$;

revoke execute on function merge_fighters(uuid, uuid) from public;
grant execute on function merge_fighters(uuid, uuid) to service_role;
