-- Q1 (ROADMAP_V2.md Phase Q): the betting journal's data model.
--
-- `picks` (0019) models exactly one opinion plus at most one moneyline
-- bet per fight per author, welded together on one row. That shape is
-- correct for what it does -- it is the calibration/scoreboard backbone
-- and stays frozen -- but it structurally cannot hold a real bet slip:
-- `unique (fight_id, author)` forbids a second bet on a fight, and
-- check_pick_constraints() requires bet_fighter_id to be one of THAT
-- fight's two fighters, so no accumulator and no method market is even
-- expressible. Hence three new tables rather than columns on `picks`.
--
-- Shapes here were taken from 16 real tickets the owner supplied, not
-- from a guess at what a bet looks like. Things the real tickets forced:
--   * a leg is not always a UFC fight (one live accumulator parlays a US
--     Open tennis set with a UFC moneyline; another is a Road to UFC
--     bout that may never exist in `events`) -- hence nullable fight_id
--     plus a text fallback;
--   * "how the bout will be won" names no fighter while "W1 by KO/TKO"
--     does -- hence METHOD_FIGHT and METHOD_FIGHTER are separate markets;
--   * every ticket carries a bookmaker number -- hence bookmaker_bet_id
--     as a real idempotency key for the backfill.

-- ---------------------------------------------------------------------
-- bankroll_ledger
-- ---------------------------------------------------------------------
-- Every peso movement, append-only in spirit. The balance is ALWAYS
-- derived by summing this table and is deliberately never stored
-- anywhere: a stored balance is a second source of truth that silently
-- drifts the first time a write half-fails.
create table bankroll_ledger (
  id uuid primary key default gen_random_uuid(),

  kind text not null check (kind in ('deposit', 'withdrawal', 'slip_settlement', 'adjustment')),

  -- Signed: positive is money in, negative is money out. One signed
  -- column rather than debit/credit pair so "sum it" is the whole
  -- balance rule, with no direction lookup to get wrong.
  amount_php numeric(10, 2) not null,

  -- Set only for kind = 'slip_settlement'. Restrict, not cascade: the
  -- money moved in the real world, so deleting the slip must never
  -- silently rewrite the bankroll's history.
  slip_id uuid,

  occurred_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now(),

  check ((kind = 'slip_settlement') = (slip_id is not null))
);

-- ---------------------------------------------------------------------
-- bet_slips
-- ---------------------------------------------------------------------
create table bet_slips (
  id uuid primary key default gen_random_uuid(),

  -- NULLABLE on purpose: a real slip can span sports (the tennis + UFC
  -- accumulator), so it cannot always be attributed to one UFC card.
  -- Restrict for the same reason odds_snapshots.fight_id is: a recorded
  -- wager must never vanish as a side effect of unrelated cleanup.
  event_id uuid references events (id) on delete restrict,

  -- Same two-author split `picks` uses, so a generated slate (Phase T)
  -- can live in this table in shadow mode and be compared line-for-line
  -- against the owner's real slips without a second schema.
  author text not null check (author in ('USER', 'INTERN')),
  user_id uuid references auth.users (id) on delete restrict,

  archetype text not null check (
    archetype in ('SAFE_PARLAY', 'STRAIGHT_DOG', 'LONGSHOT', 'METHOD_VALUE', 'LOCK', 'OTHER')
  ),

  -- stake_php is the truth (it is what left the bankroll). stake_units
  -- is NOT generated from it: a unit is a policy value (today 1u = P100,
  -- 1% of a P10,000 bankroll) that may be redefined later, and a slip
  -- must keep recording what a unit meant when it was actually placed.
  stake_php numeric(10, 2) not null check (stake_php > 0),
  stake_units numeric(6, 2) not null check (stake_units > 0),

  book text,

  -- The bookmaker's own ticket number. Unique so re-running the
  -- backfill over overlapping screenshots can never double-insert.
  -- Nullable because a hand-entered slip may not have one, and Postgres
  -- permits many nulls under a unique constraint.
  bookmaker_bet_id text unique,

  -- One real ticket was promo-funded with an odd stake (P74.59), which
  -- would otherwise read as a data-entry error in the archetype ROI.
  is_promo boolean not null default false,

  -- As the ticket displayed it, not recomputed. Verified on every
  -- fully-visible real accumulator that this equals the product of the
  -- leg prices (1.22*1.65=2.013, 1.68*2.664=4.475, 2.45*1.8=4.41), but
  -- the ticket is still the record of what was actually agreed, and
  -- books round.
  combined_price numeric(10, 3) not null check (combined_price > 1),

  status text not null default 'open'
    check (status in ('open', 'won', 'lost', 'void', 'cashed_out')),

  -- Total returned, stake included: 0 on a loss, stake back on a void,
  -- whatever was actually taken on a cash-out.
  payout_php numeric(10, 2) check (payout_php >= 0),

  -- Derived, never written. A generated column rather than a stored
  -- value the settlement job has to remember to keep in step -- payout
  -- and P&L disagreeing is exactly the kind of silent wrongness this
  -- project's db-read-safety rules exist to prevent.
  pnl_php numeric(10, 2) generated always as (payout_php - stake_php) stored,
  -- Uses this slip's OWN peso-per-unit (stake_php / stake_units) rather
  -- than a hardcoded 100, so redefining the unit later cannot retro-
  -- actively rewrite the unit P&L of slips already placed.
  pnl_units numeric(10, 4)
    generated always as ((payout_php - stake_php) * stake_units / stake_php) stored,

  placed_at timestamptz not null,
  settled_at timestamptz,
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check ((author = 'USER' and user_id is not null) or (author = 'INTERN' and user_id is null)),
  -- Open means unresolved, and resolved means both a settle time and a
  -- payout. These two together make "settled but payout forgotten"
  -- unrepresentable rather than merely unlikely.
  check ((status = 'open') = (settled_at is null)),
  check ((status = 'open') = (payout_php is null))
);

alter table bankroll_ledger
  add constraint bankroll_ledger_slip_id_fkey
  foreign key (slip_id) references bet_slips (id) on delete restrict;

create index bet_slips_event_id_idx on bet_slips (event_id);
create index bet_slips_placed_at_idx on bet_slips (placed_at);
create index bankroll_ledger_occurred_at_idx on bankroll_ledger (occurred_at);

-- ---------------------------------------------------------------------
-- bet_legs
-- ---------------------------------------------------------------------
-- A straight single is simply a one-leg slip. There is deliberately no
-- separate "single" concept anywhere in this model, so settlement and
-- archetype reporting never need a special case.
create table bet_legs (
  id uuid primary key default gen_random_uuid(),

  -- Cascade, unlike `picks`' restrict convention elsewhere in this
  -- schema: a leg has no meaning apart from its slip, so deleting a
  -- mis-entered slip must take its legs with it rather than stranding
  -- orphan rows that no query would ever find again.
  slip_id uuid not null references bet_slips (id) on delete cascade,

  -- Nullable: real slips contain legs this app has no fight row for
  -- (other sports, Road to UFC, regional cards). Those legs still have
  -- to be recordable, or the journal cannot hold real tickets.
  fight_id uuid references fights (id) on delete restrict,
  -- What the leg was, when fight_id cannot express it. Required exactly
  -- when fight_id is absent (below), so a leg is never unidentifiable.
  external_description text,

  market text not null check (
    market in ('MONEYLINE', 'DOUBLE_CHANCE', 'METHOD_FIGHTER', 'METHOD_FIGHT', 'OTHER')
  ),

  -- Which fighter the leg is ON. Null for METHOD_FIGHT ("how the bout
  -- will be won" names no fighter) and for OTHER (non-MMA legs).
  -- Membership in this fight's own two fighters is enforced by trigger
  -- below, the same way check_pick_constraints() does it for picks --
  -- a plain FK cannot express it.
  selection_fighter_id uuid references fighters (id) on delete restrict,

  -- The book's own label, stored verbatim ("Decision W1 - Yes",
  -- "KO/TKO/DQ", "Double Chance. 2X"). Kept as written rather than
  -- normalised into an enum: these strings vary by book, and the
  -- original wording is the only unambiguous record of what was agreed.
  selection_detail text,

  -- The settleable meaning of selection_detail. Required for both method
  -- markets, meaningless otherwise. These four groups are taken from the
  -- markets the owner's book actually offers, not an invented taxonomy:
  --   DECISION   <- "Decision W1 - Yes"
  --   KO_TKO_DQ  <- "W1 By KO, TKO Or DQ - Yes", "How The Bout Will Be
  --                  Won. KO/TKO/DQ"
  --   SUBMISSION <- a submission-only market
  --   ANY_FINISH <- "1 Will Win By KO, TKO, Painful Lock, Chokehold, DQ
  --                  or Refusal - Yes" (anything that isn't a decision)
  -- Normalised at entry rather than parsed from selection_detail at
  -- settle time: re-parsing free text to decide whether real money won
  -- or lost is precisely the silent-wrongness this schema avoids.
  method_group text check (method_group in ('DECISION', 'KO_TKO_DQ', 'SUBMISSION', 'ANY_FINISH')),

  -- THE PRICE ACTUALLY TAKEN. The single most important column here.
  -- `picks` stores no price at all and settlement re-derives one from
  -- odds_snapshots at settle time (settlePicks.ts), which silently
  -- misprices anything struck at a different book -- and the owner bets
  -- at a PH-facing book whose lines differ from the ingested BetOnline
  -- reference. Storing it is also the only thing that ever makes
  -- closing-line value computable.
  price numeric(6, 3) not null check (price > 1),

  leg_result text not null default 'pending'
    check (leg_result in ('pending', 'won', 'lost', 'void')),
  settled_at timestamptz,

  created_at timestamptz not null default now(),

  check (fight_id is not null or external_description is not null),
  check (market in ('METHOD_FIGHT', 'OTHER') or selection_fighter_id is not null),
  check ((market in ('METHOD_FIGHTER', 'METHOD_FIGHT')) = (method_group is not null)),
  check ((leg_result = 'pending') = (settled_at is null))
);

create index bet_legs_slip_id_idx on bet_legs (slip_id);
-- Drives the INTERN-vs-owner head-to-head: several real tickets land on
-- fights INTERN also priced (Elliott, Bukauskas, Hooker, Rahiki).
create index bet_legs_fight_id_idx on bet_legs (fight_id);

-- Deliberately NO unique constraint on (slip_id, fight_id). A journal
-- records what actually happened, including a same-fight ticket; the
-- correlation that implies is surfaced in the exposure report (Phase S)
-- and forbidden in the generator (Phase T) -- a generator rule, not a
-- rule the record of reality should be held to.

-- ---------------------------------------------------------------------
-- Constraint triggers
-- ---------------------------------------------------------------------
-- Deliberately NO pick-lock equivalent. `picks` locks before the card
-- starts so a client cannot edit an opinion once results are known; a
-- slip is a record of a wager that was ALREADY placed, and backfilling
-- historical tickets is a first-class use case, so a time lock would
-- make the table useless for its actual purpose. That does mean slip
-- records are self-reported -- bookmaker_bet_id is what makes them
-- auditable against a real ticket, and it is the honest limit of what
-- this table can claim.
create function check_bet_leg_constraints()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _fighter1_id uuid;
  _fighter2_id uuid;
  -- Same role check 0022's check_pick_constraints() uses and verified
  -- live there: current_user follows role switching, session_user does
  -- not.
  _is_settlement_write boolean;
begin
  _is_settlement_write := current_user = 'service_role';

  if new.fight_id is not null and new.selection_fighter_id is not null then
    select f.fighter1_id, f.fighter2_id
      into _fighter1_id, _fighter2_id
    from fights f
    where f.id = new.fight_id;

    if new.selection_fighter_id not in (_fighter1_id, _fighter2_id) then
      raise exception 'selection_fighter_id must be one of this fight''s two fighters';
    end if;
  end if;

  if new.leg_result <> 'pending' and not _is_settlement_write then
    raise exception 'leg_result can only be set by the settlement job';
  end if;

  return new;
end;
$$;

create trigger bet_legs_check_constraints
  before insert or update on bet_legs
  for each row execute function check_bet_leg_constraints();

create function check_bet_slip_constraints()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _is_settlement_write boolean;
begin
  _is_settlement_write := current_user = 'service_role';

  -- won/lost/void are FACTS about how the fights resolved, so only the
  -- settlement job may assert them -- otherwise the archetype ROI board
  -- is just whatever the client felt like claiming. 'cashed_out' is the
  -- deliberate exception: only the person who took the cash-out knows
  -- it happened or what it returned, and no job can ever derive it.
  if new.status in ('won', 'lost', 'void') and not _is_settlement_write then
    raise exception 'won/lost/void can only be set by the settlement job (cash out manually instead)';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

create trigger bet_slips_check_constraints
  before insert or update on bet_slips
  for each row execute function check_bet_slip_constraints();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
-- Owner-only throughout, matching `picks` (0019): this is personal
-- financial data, strictly more sensitive than the picks that table
-- already gates. Reads are author-agnostic so the owner sees both their
-- own slips and INTERN's proposed ones; writes are scoped to their own
-- USER rows so INTERN slips stay service-role-only.
alter table bet_slips enable row level security;
alter table bet_legs enable row level security;
alter table bankroll_ledger enable row level security;

create policy "bet_slips: owner reads all" on bet_slips
  for select to authenticated
  using (is_owner());

create policy "bet_slips: owner writes own USER slips" on bet_slips
  for insert to authenticated
  with check (is_owner() and author = 'USER' and user_id = auth.uid());

create policy "bet_slips: owner updates own USER slips" on bet_slips
  for update to authenticated
  using (is_owner() and author = 'USER' and user_id = auth.uid())
  with check (is_owner() and author = 'USER' and user_id = auth.uid());

-- DELETE is granted here, unlike `picks` (which has no delete path at
-- all). A journal entry can simply be wrong -- a mistyped price or a
-- duplicated screenshot -- and there has to be a way to take it back
-- out. The ledger's restrict FK is what stops a deletion from quietly
-- rewriting settled bankroll history.
create policy "bet_slips: owner deletes own USER slips" on bet_slips
  for delete to authenticated
  using (is_owner() and author = 'USER' and user_id = auth.uid());

-- Legs inherit their slip's authorisation: there is no such thing as a
-- leg the owner may touch on a slip they may not.
create policy "bet_legs: owner reads all" on bet_legs
  for select to authenticated
  using (is_owner());

create policy "bet_legs: owner writes legs of own USER slips" on bet_legs
  for insert to authenticated
  with check (
    is_owner()
    and exists (
      select 1 from bet_slips s
      where s.id = bet_legs.slip_id and s.author = 'USER' and s.user_id = auth.uid()
    )
  );

create policy "bet_legs: owner updates legs of own USER slips" on bet_legs
  for update to authenticated
  using (
    is_owner()
    and exists (
      select 1 from bet_slips s
      where s.id = bet_legs.slip_id and s.author = 'USER' and s.user_id = auth.uid()
    )
  )
  with check (
    is_owner()
    and exists (
      select 1 from bet_slips s
      where s.id = bet_legs.slip_id and s.author = 'USER' and s.user_id = auth.uid()
    )
  );

create policy "bet_legs: owner deletes legs of own USER slips" on bet_legs
  for delete to authenticated
  using (
    is_owner()
    and exists (
      select 1 from bet_slips s
      where s.id = bet_legs.slip_id and s.author = 'USER' and s.user_id = auth.uid()
    )
  );

-- The ledger is readable but not client-writable: deposits and
-- withdrawals are real-world events the owner records deliberately
-- (insert allowed), but a settlement row is written by the settlement
-- job alongside the slip it belongs to, and nothing may ever rewrite or
-- delete a money movement after the fact -- no update, no delete policy.
create policy "bankroll_ledger: owner reads all" on bankroll_ledger
  for select to authenticated
  using (is_owner());

create policy "bankroll_ledger: owner records own deposits" on bankroll_ledger
  for insert to authenticated
  with check (is_owner() and kind in ('deposit', 'withdrawal', 'adjustment'));

grant select, insert, update, delete on public.bet_slips to authenticated;
grant select, insert, update, delete on public.bet_legs to authenticated;
grant select, insert on public.bankroll_ledger to authenticated;
-- No anon grant on any of the three, deliberately.
