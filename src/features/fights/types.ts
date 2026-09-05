export interface EventSummary {
  id: string;
  name: string;
  event_date: string;
}

export interface FightFighter {
  id: string;
  name: string;
}

export interface FightWithFighters {
  id: string;
  weight_class: string | null;
  method: string | null;
  round: number | null;
  winner_id: string | null;
  fighter1: FightFighter;
  fighter2: FightFighter;
}

// The card view's own row shape (C3) -- bout_order for sort/display and
// odds, layered onto the base v1 fight shape. odds is null when the
// fight hasn't been priced yet ("unpriced," a normal, handled state --
// not an error).
export interface CardBout extends FightWithFighters {
  bout_order: number | null;
  odds: { fighter1_price: number; fighter2_price: number } | null;
}

// The card view needs starts_at (the pick lock) alongside the enriched
// bout rows.
export interface CardView extends EventSummary {
  starts_at: string | null;
  fights: CardBout[];
}

// One side of the fight page's tale-of-the-tape (I5, docs/PRD.md
// should-have "Tale-of-the-tape differentials on the fight page"). Every
// physical field is nullable because a Wikipedia-only placeholder
// fighter has none of them until API-Sports enrichment catches up --
// "Unknown" is a normal state here, not an error.
//
// wins/losses/draws are the DERIVED record from lib/records/, counted
// over this app's own fight graph (~2022 onward, patchy before 2025) --
// never a career record, and the UI is required to say so. A 0-0-0 total
// means "no tracked fights," not "never won anything."
//
// eloRating is null for a fighter with no rated history at all. That is
// deliberately not collapsed to eloMath.ts's DEFAULT_RATING the way
// generateInternPicks.ts does it: the intern needs a number to do
// arithmetic with, but showing a debutant an invented 1500 would state
// something the data does not support.
export interface TapeFighter extends FightFighter {
  height_cm: number | null;
  reach_cm: number | null;
  stance: string | null;
  wins: number;
  losses: number;
  draws: number;
  eloRating: number | null;
  ratedFightCount: number;
}

export interface FightDetail extends FightWithFighters {
  event: EventSummary;
  fighter1: TapeFighter;
  fighter2: TapeFighter;
}
