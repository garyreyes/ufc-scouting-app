-- T1 (ROADMAP_V2.md Phase T): the Intern's own slate and its own bankroll.
--
-- 0064 already anticipated INTERN slips (bet_slips.author, user_id null,
-- service-role-only writes). What it did not anticipate is a second
-- BANKROLL: bankroll_ledger has no owner, so the moment an INTERN slip
-- settled, settleBetSlips.ts would have written its P&L into the owner's
-- balance. This migration splits the ledger by author, seeds the Intern's
-- ₱10,000 opening deposit, and adds the three columns the slate generator
-- needs.

-- ---------------------------------------------------------------------
-- bankroll_ledger.author
-- ---------------------------------------------------------------------
-- Every existing row (the owner's ₱10,000 opening deposit) is the owner's,
-- so the default back-fills correctly.
alter table bankroll_ledger
  add column author text not null default 'USER' check (author in ('USER', 'INTERN'));

create index bankroll_ledger_author_idx on bankroll_ledger (author);

-- A settlement row must land in the bankroll of the slip it settles. The
-- settlement job stamps it, and this makes getting it wrong impossible
-- rather than merely unlikely.
create function check_bankroll_ledger_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _slip_author text;
begin
  if new.slip_id is not null then
    select author into _slip_author from bet_slips where id = new.slip_id;
    if _slip_author is distinct from new.author then
      raise exception 'bankroll_ledger.author (%) must match its slip''s author (%)', new.author, _slip_author;
    end if;
  end if;
  return new;
end;
$$;

create trigger bankroll_ledger_check_author
  before insert or update on bankroll_ledger
  for each row execute function check_bankroll_ledger_author();

-- The owner may record their own deposits and withdrawals, never move the
-- Intern's money.
drop policy "bankroll_ledger: owner records own deposits" on bankroll_ledger;
create policy "bankroll_ledger: owner records own deposits" on bankroll_ledger
  for insert to authenticated
  with check (is_owner() and author = 'USER' and kind in ('deposit', 'withdrawal', 'adjustment'));

-- The Intern's opening bankroll (owner-confirmed 2026-09-28).
insert into bankroll_ledger (kind, amount_php, author, note)
values ('deposit', 10000.00, 'INTERN', 'Intern opening bankroll (Phase T)');

-- ---------------------------------------------------------------------
-- bet_slips
-- ---------------------------------------------------------------------
-- The owner's two method slip types, kept distinct from METHOD_VALUE so the
-- per-archetype ROI board can tell a method parlay from a method single.
alter table bet_slips drop constraint bet_slips_archetype_check;
alter table bet_slips
  add constraint bet_slips_archetype_check
  check (archetype in (
    'SAFE_PARLAY', 'STRAIGHT_DOG', 'LONGSHOT', 'METHOD_VALUE', 'LOCK', 'OTHER',
    'METHOD_PARLAY', 'METHOD_SINGLE'
  ));

-- The generator's idempotency key: intern:{event_id}:{archetype}:{n}. Only
-- ever set on INTERN slips.
alter table bet_slips add column generation_key text unique;
alter table bet_slips
  add constraint bet_slips_generation_key_intern_only
  check (generation_key is null or author = 'INTERN');

-- ---------------------------------------------------------------------
-- bet_legs
-- ---------------------------------------------------------------------
-- Where `price` came from. 'book' = a real ingested or ticket price;
-- 'estimated' = the Intern's own method-price estimate (no method-odds
-- feed exists, PROJECT_FACTS.md); 'entered' = the owner typed the real
-- book price over an estimate before the lock.
alter table bet_legs
  add column price_source text not null default 'book'
  check (price_source in ('book', 'estimated', 'entered'));

-- The Intern's own probability that this leg wins, at generation time.
-- Null for owner legs.
alter table bet_legs
  add column model_probability numeric(5, 4)
  check (model_probability is null or (model_probability > 0 and model_probability < 1));
