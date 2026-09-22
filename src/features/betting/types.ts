// Mirrors bet_slips.archetype (0064_bankroll_and_slips.sql).
export type SlipArchetype = "SAFE_PARLAY" | "STRAIGHT_DOG" | "LONGSHOT" | "METHOD_VALUE" | "LOCK" | "OTHER";

export type SlipStatus = "open" | "won" | "lost" | "void" | "cashed_out";

// Mirrors bet_legs.market/method_group.
export type LegMarket = "MONEYLINE" | "DOUBLE_CHANCE" | "METHOD_FIGHTER" | "METHOD_FIGHT" | "OTHER";
export type MethodGroup = "DECISION" | "KO_TKO_DQ" | "SUBMISSION" | "ANY_FINISH";

// One leg as the record form emits it. Exactly one of fightId/
// externalDescription is set, matching bet_legs' own
// `check (fight_id is not null or external_description is not null)` --
// the DB constraint is the real enforcement, this is the form's own
// input shape.
export interface NewLegInput {
  fightId: string | null;
  externalDescription: string | null;
  market: LegMarket;
  selectionFighterId: string | null;
  selectionDetail: string | null;
  methodGroup: MethodGroup | null;
  price: number;
}

export interface NewSlipInput {
  eventId: string | null;
  archetype: SlipArchetype;
  stakePhp: number;
  stakeUnits: number;
  book: string | null;
  bookmakerBetId: string | null;
  combinedPrice: number;
  placedAt: string;
  note: string | null;
  legs: NewLegInput[];
}

// A leg as read back for the open-slips list -- the settleable fields
// plus enough fighter/fight display context (name, not just id) for
// SlipList to render without a second fetch per leg.
export interface SlipLeg {
  id: string;
  fightId: string | null;
  fightLabel: string | null;
  externalDescription: string | null;
  market: LegMarket;
  selectionFighterName: string | null;
  selectionDetail: string | null;
  methodGroup: MethodGroup | null;
  price: number;
  legResult: "pending" | "won" | "lost" | "void";
}

export interface OpenSlip {
  id: string;
  eventId: string | null;
  archetype: SlipArchetype;
  stakePhp: number;
  stakeUnits: number;
  book: string | null;
  combinedPrice: number;
  placedAt: string;
  note: string | null;
  status: SlipStatus;
  legs: SlipLeg[];
}

// The event→fight→fighter picker's own data shape (fights/api.ts's
// getUpcomingEvents + getCardView already provide this; re-exported here
// as the shape SlipForm actually consumes so its props don't leak
// features/fights' internal row shape).
export interface FightOption {
  id: string;
  fighter1: { id: string; name: string };
  fighter2: { id: string; name: string };
}
