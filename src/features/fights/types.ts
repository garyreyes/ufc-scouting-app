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

export interface FightDetail extends FightWithFighters {
  event: EventSummary;
}
