-- Bug found live while applying 0055: merge_fighters() (0045) predates
-- both fighter_scouting_dossiers (0051, N7) and shadow_picks (0052, N8),
-- and was never updated to repoint either when they were added -- the
-- same "a fixed function drifts out of sync with tables added after it"
-- shape as every other repoint step already in this function, just not
-- caught until a real merge actually hit it.
--
-- shadow_picks.predicted_fighter_id has no on-delete action (plain
-- references), so the drop fighter's delete at the end of the function
-- would hard-fail with a foreign-key violation -- caught immediately,
-- 0055's whole transaction rolled back, nothing corrupted. Confirmed live
-- 2026-09-19 pushing 0055 against fighter f0f8139e-fe1f-42ec-9198-
-- cf382aafdf90 (a duplicate "Casey O'Neill" row with shadow picks
-- already written against it by N8).
--
-- fighter_scouting_dossiers.fighter_id IS on delete cascade, which is the
-- more dangerous variant: it would not error, it would silently delete
-- the dropped fighter's dossier history -- exactly the "silently
-- destroys real data instead of failing loudly" failure the fighter_
-- sherdog_bouts and fighter_scouting_reports repoints two lines below
-- already exist to prevent. Never actually lost any (no merge has hit
-- this table's data yet), but would have on the very next one.
--
-- Same "copy across before delete" shape as every other repoint in this
-- function; no ON CONFLICT needed on either insert-shaped step here
-- because plain UPDATEs don't have that hazard.
create or replace function merge_fighters(p_keep_id uuid, p_drop_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

  -- 2a. Repoint N8 shadow picks (0052) -- added after this function was
  --     originally written; plain `references fighters (id)` with no
  --     on-delete action, so leaving this out fails loudly (which is how
  --     it was caught) rather than silently, but it still has to be
  --     repointed for the merge to ever complete.
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

  -- 3c. Repoint N7 LLM scouting dossiers (0051) -- `on delete cascade`,
  --     so unlike shadow_picks above this one does NOT fail loudly if
  --     skipped: it silently deletes the dropped fighter's dossier
  --     history (N9's replay/audit trail) the moment step 7 below runs.
  --     Multiple dossier rows per fighter are normal and expected
  --     (unique on (fighter_id, input_hash), not fighter_id alone), so
  --     this can move more than one row -- that's correct, not a bug.
  update fighter_scouting_dossiers set fighter_id = p_keep_id where fighter_id = p_drop_id;

  -- 4. Clear the dropped fighter's Elo history.
  delete from fighter_elo_history where fighter_id = p_drop_id;

  -- 5. Copy sherdog_id (plus everything derived from it) and external_id
  --    onto the keeper where it lacks them.
  update fighters k set
    sherdog_id = d.sherdog_id,
    sherdog_history_imported_at = d.sherdog_history_imported_at,
    sherdog_wins_by_ko = d.sherdog_wins_by_ko,
    sherdog_wins_by_sub = d.sherdog_wins_by_sub,
    sherdog_wins_by_dec = d.sherdog_wins_by_dec,
    sherdog_losses_by_ko = d.sherdog_losses_by_ko,
    sherdog_losses_by_sub = d.sherdog_losses_by_sub,
    sherdog_losses_by_dec = d.sherdog_losses_by_dec
  from fighters d
  where k.id = p_keep_id and d.id = p_drop_id
    and k.sherdog_id is null and d.sherdog_id is not null;

  update fighters k set external_id = d.external_id
  from fighters d
  where k.id = p_keep_id and d.id = p_drop_id
    and k.external_id is null and d.external_id is not null;

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
