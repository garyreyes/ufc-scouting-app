-- 0055 (already applied) fixed merge_fighters() to repoint shadow_picks
-- and fighter_scouting_dossiers, but wrote its fix on top of 0045's
-- ORIGINAL body instead of 0046's already-patched one -- silently
-- reintroducing the exact same-transaction unique-constraint collision
-- 0046 fixed once already (0046's own header: "Postgres enforces a
-- non-deferrable unique constraint as each row version is written into
-- the index, not at commit" -- copying the drop row's sherdog_id/
-- external_id onto the keeper WHILE the drop row still holds that same
-- value collides with the drop row's own still-live index entry, because
-- the drop row isn't deleted until step 7).
--
-- Caught immediately, before it ever touched production data: reproduced
-- live in a throwaway `begin; ... rollback;` transaction against the
-- exact two "Casey O'Neill" duplicate rows this session's disputed_
-- opponent cleanup needs to merge (fighter f0f8139e-fe1f-42ec-9198-
-- cf382aafdf90, sherdog_id 175007), confirmed the fix below resolves it,
-- then rolled back before writing this file.
--
-- This migration re-applies 0046's move-before-copy fix, now WITH 0055's
-- two additional repoints folded in (shadow_picks, fighter_scouting_
-- dossiers). Everything else is unchanged from 0046/0055.
create or replace function merge_fighters(p_keep_id uuid, p_drop_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
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

  perform set_config('app.merging_fighters', 'on', true);

  -- 1. Repoint every fights reference, all six columns in ONE statement.
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

  -- 2. Repoint picks.
  update picks set predicted_fighter_id = p_keep_id where predicted_fighter_id = p_drop_id;
  update picks set bet_fighter_id = p_keep_id where bet_fighter_id = p_drop_id;

  -- 2a. Repoint N8 shadow picks (0052, folded in by 0055).
  update shadow_picks set predicted_fighter_id = p_keep_id where predicted_fighter_id = p_drop_id;

  -- 3. Repoint rumour flags.
  update rumour_flags set fighter_id = p_keep_id where fighter_id = p_drop_id;

  -- 3a. Repoint the dropped fighter's imported Sherdog career (0038).
  update fighter_sherdog_bouts b set fighter_id = p_keep_id
  where b.fighter_id = p_drop_id
    and not exists (
      select 1 from fighter_sherdog_bouts k
      where k.fighter_id = p_keep_id and k.bout_order = b.bout_order
    );
  delete from fighter_sherdog_bouts where fighter_id = p_drop_id;

  -- 3b. Repoint fighter-level scouting notes (0009, [FROZEN] feature but
  --     still real user data).
  update fighter_scouting_reports set fighter_id = p_keep_id where fighter_id = p_drop_id;

  -- 3c. Repoint N7 LLM scouting dossiers (0051, folded in by 0055) --
  --     `on delete cascade`, so this one does NOT fail loudly if skipped:
  --     it silently deletes the dropped fighter's dossier history the
  --     moment step 7 runs. Multiple rows per fighter are normal (unique
  --     on (fighter_id, input_hash), not fighter_id alone).
  update fighter_scouting_dossiers set fighter_id = p_keep_id where fighter_id = p_drop_id;

  -- 4. Clear the dropped fighter's Elo history.
  delete from fighter_elo_history where fighter_id = p_drop_id;

  -- 5. Move sherdog_id/external_id onto the keeper where it lacks them --
  --    MOVE, not copy (0046's fix, reapplied here): both columns are
  --    UNIQUE, so the drop row has to give the value up in a separate,
  --    earlier statement before the keeper takes it -- otherwise the
  --    keeper's new index entry collides with the drop row's still-live
  --    one, since the drop row isn't deleted until step 7.
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

  -- 5a. Repoint any EARLIER aliases that already point at the drop fighter.
  update fighter_aliases set fighter_id = p_keep_id where fighter_id = p_drop_id;

  -- 6. Record the dropped name as an alias before the row disappears.
  insert into fighter_aliases (alias, fighter_id, source)
  select d.name, p_keep_id, 'merge' from fighters d where d.id = p_drop_id
  on conflict (alias) do update set fighter_id = excluded.fighter_id;

  -- 7. Delete the dropped row -- nothing references it now.
  delete from fighters where id = p_drop_id;
end;
$$;

revoke execute on function merge_fighters(uuid, uuid) from public;
grant execute on function merge_fighters(uuid, uuid) to service_role;
