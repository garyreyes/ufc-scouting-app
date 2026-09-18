-- Phase N4: advisory LLM proposals for `low_confidence_sherdog_match`
-- conflicts -- propose, never auto-apply. The population this targets is
-- deliberately narrow: the residual `historyCorroborates`
-- (resolveOpenSherdogConflictsJob.ts, M5) already declines to auto-resolve
-- -- a real Sherdog page name-order swap, a common surname, or a
-- romanization/nickname gap (Renato Moicano = Sherdog's "Renato Carneiro")
-- with no corroborating bout on record. The heuristic already resolves
-- the easy population (10/10 in a recent dry-run); this is where a human
-- still has to read the evidence, and an LLM reading names/bios can write
-- the human-readable *why* that the raw candidate list doesn't carry
-- today.
--
-- `disputed_opponent`'s merge path is deliberately OUT of scope here --
-- merge_fighters() destroys rows permanently and Phase M's own merge
-- migrations (0045/0046) found two real near-misses in that exact
-- function before it ever ran live. Proposing a *match* (does this
-- fighter row correspond to that external Sherdog id) is a fundamentally
-- lower-stakes question than proposing a *merge* (should these two
-- existing rows become one) -- the former's worst case is a fighter
-- staying unmatched a while longer; the latter's worst case is
-- irreversible data loss on a wrong keeper/drop choice.
create table conflict_resolution_proposals (
  id uuid primary key default gen_random_uuid(),
  conflict_id uuid not null references data_conflicts (id) on delete cascade,

  -- {"chosenSherdogId": number | null} -- jsonb rather than a bare int
  -- column so a later conflict kind (e.g. low_confidence_fighter_match)
  -- can reuse this same table with a differently-shaped proposal,
  -- matching data_conflicts.details' own "one column, many kinds" choice.
  proposed_action jsonb not null,
  rationale text not null,

  -- Which real call produced this -- N9's replay tooling and any future
  -- "why did it suggest this" audit both need this, not just the raw
  -- rationale text.
  llm_call_id uuid references llm_call_log (id) on delete set null,

  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  rejected_at timestamptz,

  -- One active proposal per conflict -- a later run's fresh read of the
  -- evidence REPLACES the old suggestion (upsert target), it does not
  -- accumulate a history of stale guesses. llm_call_log already retains
  -- the full call history if a past prompt/response ever needs auditing.
  unique (conflict_id)
);

create index conflict_resolution_proposals_conflict_id_idx on conflict_resolution_proposals (conflict_id);

alter table conflict_resolution_proposals enable row level security;

-- Same posture as data_conflicts itself (0014): no client read/write
-- grant at all. The /conflicts page always reads through the admin
-- client behind requireOwner() -- an advisory suggestion is still
-- something only the owner should see, same reasoning as the conflict
-- rows it annotates.
