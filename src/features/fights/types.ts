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

export interface EventWithFights extends EventSummary {
  fights: FightWithFighters[];
}

export interface FightDetail extends FightWithFighters {
  event: EventSummary;
}
