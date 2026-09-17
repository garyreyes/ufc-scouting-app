-- M3: fighter aliases + a real merge_fighters() function.
--
-- Before this, merging two duplicate fighter rows only ever happened by
-- hand-written, one-off SQL under supabase/data-fixes/ -- see
-- 2026-09-10_merge-8-name-variant-duplicate-fighters.sql, which this
-- function is ported from (same six-column CASE update on `fights`, same
-- self-referential-fight guard, same "clear Elo history, let the caller
-- recompute" split). Making it a real function lets the app call it live,
-- from the /conflicts "same fighter" choice and from the automatic
-- same-card-name-variant sweep (decideSameCardMerge.ts).
--
-- fighter_aliases stores the RAW dropped display name, not a
-- pre-normalized one -- a deliberate departure from the "alias_normalized
-- unique" shape floated during planning. Every other name-matching rule
-- in this codebase (normalizeName, namesMatchExactly, namesLikelySamePerson,
-- nameSimilarity, isSameCardNameVariant) lives in TypeScript, not SQL, and
-- upsertFighter.ts already has the exact "fetch broadly, decide in tested
-- JS" pattern for a table this small. Replicating that normalization in
-- SQL would mean two implementations of "what counts as the same name" to
-- keep in sync; reading the small alias table into JS and calling the
-- existing normalizeName() does not.
create table fighter_aliases (
  id uuid primary key default gen_random_uuid(),
  alias text not null,
  fighter_id uuid not null references fighters (id) on delete cascade,
  source text not null check (source in ('merge', 'manual')),
  created_at timestamptz not null default now(),
  -- Case-sensitive dedupe of a literal repeat write (upsertFighter.ts's
  -- alias check does the real semantic/normalized lookup in JS) --
  -- this just stops the same exact string being inserted twice.
  unique (alias)
);

create index fighter_aliases_fighter_id_idx on fighter_aliases (fighter_id);

alter table fighter_aliases enable row level security;
-- No policy, no anon/authenticated grant -- same posture as
-- odds_snapshots/rumour_sources: written only by merge_fighters() (via
-- the service role's default privileges, 0005), read only by
-- upsertFighter.ts's own admin-client sync path. Never client-facing.

-- The merge itself. SECURITY DEFINER so it can write across `fights`,
-- `picks`, `rumour_flags`, and `fighter_elo_history` regardless of the
-- calling role's own grants, mirroring accept_clan_invite's (0004) use of
-- the same mechanism for a different table set.
--
-- Restricted to service_role only (see the REVOKE/GRANT below) -- a
-- SECURITY DEFINER function's EXECUTE privilege defaults to PUBLIC in
-- Postgres, which PostgREST would otherwise expose at
-- /rest/v1/rpc/merge_fighters to ANY authenticated (or even anon) client.
-- accept_clan_invite avoids this by checking is_owner() internally, but
-- merge_fighters has no such per-request identity to check against when
-- called from a trusted backend job -- so the grant itself is the
-- boundary here, the same "GRANTs are independent of RLS" lesson
-- CLAUDE.md's own checklist already states.
create function merge_fighters(p_keep_id uuid, p_drop_id uuid)
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

  -- Transaction-LOCAL only (third arg true) -- reverts automatically at
  -- commit/rollback, so it can never leak across a pooled connection to
  -- an unrelated later statement (the same reason 0027's settlement
  -- bypass keys off the CONNECTING ROLE rather than a session-level
  -- setting). check_pick_constraints() below reads this to skip the
  -- pick-lock and open-conflict checks for exactly this one transaction.
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
  --     any scouting notes on them, not just re-file them. Found by
  --     tracing the actual production shape this feature exists for
  --     (Jose Delgado / Jose Miguel Delgado): the Sherdog-linked identity
  --     is not always the one checkMergeGuard picks as keeper (it prefers
  --     external_id), so the DROPPED row is exactly the one likely to
  --     carry the real imported history.
  --     `on conflict do nothing`: a keeper that already has its own
  --     imported history at the same bout_order slot (only possible if
  --     both sides were already linked to the identical Sherdog profile)
  --     keeps its own row rather than aborting the whole merge.
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

  -- 5. Copy sherdog_id (plus everything derived from it -- the import
  --    timestamp and finish-breakdown columns J5/J7 read, which are
  --    meaningless without it) and external_id onto the keeper where it
  --    lacks them. Two independent identity links, each only ever filling
  --    a gap, never overwriting a real value: checkMergeGuard already
  --    refuses the merge outright when both sides carry DIFFERENT
  --    non-null sherdog_ids, so this never has to pick a winner between
  --    two real ones. Without copying the derived columns too, step 3a's
  --    repointed bout rows would sit under the keeper unrecognized --
  --    recomputeFighterRecords.ts keys the Sherdog-record override on
  --    `sherdog_history_imported_at`, not on the bout rows existing.
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

  -- 5a. Repoint any EARLIER aliases that already point at the drop
  --     fighter -- a fighter can be merged more than once (a further
  --     rename, a further correction), and fighter_aliases.fighter_id is
  --     `on delete cascade`. Without this, step 7's delete below would
  --     cascade-destroy an earlier alias row instead of repointing it,
  --     and the next time that older name arrives from any source,
  --     upsertFighter.ts's alias lookup would find nothing and recreate
  --     the exact duplicate this feature exists to stop (reviewer
  --     finding: chained merges, e.g. A merged into B, then B later
  --     merged into C).
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

-- check_pick_constraints() gains one more condition, same "same trigger,
-- one more condition" shape as 0027's settlement bypass and 0041's
-- author-aware lock. `_is_fighter_merge` skips the pick-lock timing
-- check, the open-disputed_opponent check, and the settlement-columns
-- check -- but NOT the fighter-membership check, which merge_fighters()
-- above already guarantees passes by ordering its own updates (fights
-- before picks). A merge write is never itself setting
-- pick_correct/pnl_units/settled_at, but an already-settled pick being
-- repointed would otherwise trip that check too (it looks at the ROW'S
-- resulting values, not just what this statement assigns), so the bypass
-- has to cover it as well, not only the lock/conflict checks.
create or replace function check_pick_constraints()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _event_starts_at timestamptz;
  _fighter1_id uuid;
  _fighter2_id uuid;
  _has_open_conflict boolean;
  _is_settlement_write boolean;
  _is_fighter_merge boolean;
  _lock_offset interval;
begin
  _is_fighter_merge := coalesce(current_setting('app.merging_fighters', true), '') = 'on';

  -- tg_op guard first: `old` is not populated on INSERT, so the column
  -- comparisons below must never be reached in that case.
  if tg_op = 'UPDATE' and current_setting('role', true) = 'service_role' then
    _is_settlement_write :=
      new.fight_id is not distinct from old.fight_id
      and new.author is not distinct from old.author
      and new.user_id is not distinct from old.user_id
      and new.predicted_fighter_id is not distinct from old.predicted_fighter_id
      and new.estimated_probability is not distinct from old.estimated_probability
      and new.confidence is not distinct from old.confidence
      and new.predicted_method is not distinct from old.predicted_method
      and new.reasoning is not distinct from old.reasoning
      and new.bet_fighter_id is not distinct from old.bet_fighter_id
      and new.stake_units is not distinct from old.stake_units;
  else
    _is_settlement_write := false;
  end if;

  select e.starts_at, f.fighter1_id, f.fighter2_id
    into _event_starts_at, _fighter1_id, _fighter2_id
  from fights f
  join events e on e.id = f.event_id
  where f.id = new.fight_id;

  -- Author-aware offset -- see 0041's header for why these two numbers
  -- and where their TS mirror lives.
  _lock_offset := case new.author
    when 'INTERN' then interval '6 hours'
    else interval '1 hour'
  end;

  if not _is_settlement_write and not _is_fighter_merge
     and _event_starts_at is not null
     and now() >= (_event_starts_at - _lock_offset) then
    raise exception 'Picks are locked: % picks lock % before the card starts',
      new.author,
      case new.author when 'INTERN' then '6 hours' else '1 hour' end;
  end if;

  if new.predicted_fighter_id not in (_fighter1_id, _fighter2_id) then
    raise exception 'predicted_fighter_id must be one of this fight''s two fighters';
  end if;

  if new.bet_fighter_id is not null and new.bet_fighter_id not in (_fighter1_id, _fighter2_id) then
    raise exception 'bet_fighter_id must be one of this fight''s two fighters';
  end if;

  if not _is_fighter_merge then
    select exists (
      select 1 from data_conflicts
      where fight_id = new.fight_id and kind = 'disputed_opponent' and resolved_at is null
    ) into _has_open_conflict;

    if _has_open_conflict then
      raise exception 'This fight has an open disputed-opponent conflict -- resolve it at /conflicts first';
    end if;
  end if;

  if (new.pick_correct is not null or new.pnl_units is not null or new.settled_at is not null)
     and not _is_settlement_write and not _is_fighter_merge then
    raise exception 'pick_correct, pnl_units, and settled_at can only be set by the settlement job';
  end if;

  new.updated_at = now();
  return new;
end;
$$;
