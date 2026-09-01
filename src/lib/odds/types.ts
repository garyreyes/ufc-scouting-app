// Shapes matching The Odds API's real response, verified live 2026-09-01
// against mma_mixed_martial_arts/odds?bookmakers=onexbet (see
// ARCHITECTURE.md Fork 7 / CHANGES.md Phase 16).

export interface OddsOutcome {
  name: string;
  price: number;
}

export interface OddsMarket {
  key: string;
  outcomes: OddsOutcome[];
}

export interface OddsBookmaker {
  key: string;
  markets: OddsMarket[];
}

export interface OddsEvent {
  id: string;
  commence_time: string; // ISO 8601, e.g. "2026-09-20T04:00:00Z"
  home_team: string;
  away_team: string;
  bookmakers: OddsBookmaker[];
}

// A fight from our own DB, shaped for matching only -- not the full
// `fights` row.
export interface FightForMatching {
  id: string;
  eventDate: string; // events.event_date, a bare date ("YYYY-MM-DD")
  fighter1Name: string;
  fighter2Name: string;
}

export interface FighterPrices {
  fighter1Price: number;
  fighter2Price: number;
}
