import type { RoiLine } from "@/lib/scoring/aggregateRoiLine";
import type { BankrollPoint } from "@/lib/scoring/buildBankrollCurve";
import type { SlateArchetype } from "@/lib/intern/slate/types";

export type { SlateArchetype };

// The owner's own names for the five slip types (2026-09-28), in the order
// the slate reads top to bottom: safest money first, lottery tickets last.
export const SLIP_TYPE_ORDER: SlateArchetype[] = [
  "STRAIGHT_DOG",
  "SAFE_PARLAY",
  "METHOD_SINGLE",
  "METHOD_PARLAY",
  "LONGSHOT",
];

export const SLIP_TYPE_LABELS: Record<SlateArchetype, string> = {
  STRAIGHT_DOG: "Value bet",
  SAFE_PARLAY: "Confident parlay",
  METHOD_SINGLE: "Method single",
  METHOD_PARLAY: "Method parlay",
  LONGSHOT: "Longshot moneylines",
};

export const SLIP_TYPE_HINTS: Record<SlateArchetype, string> = {
  STRAIGHT_DOG: "An underdog the Intern rates meaningfully above the market",
  SAFE_PARLAY: "Its 2–4 most confident picks the market doesn't disagree with",
  METHOD_SINGLE: "The single most likely fighter-and-method",
  METHOD_PARLAY: "2–4 fighters winning the way the Intern expects",
  LONGSHOT: "Every pick it likes, strung together",
};

export interface InternLegView {
  id: string;
  detail: string;
  price: number;
  priceSource: "book" | "estimated" | "entered";
  result: "pending" | "won" | "lost" | "void";
  modelProbability: number | null;
}

export interface InternSlipView {
  id: string;
  archetype: SlateArchetype;
  status: "open" | "won" | "lost" | "void" | "cashed_out";
  stakePhp: number;
  combinedPrice: number;
  pnlPhp: number | null;
  legs: InternLegView[];
}

export interface InternCardView {
  eventId: string;
  eventName: string;
  eventDate: string;
  slips: InternSlipView[];
  netPhp: number;
  stakedPhp: number;
}

export interface InternSlipsPageData {
  openingPhp: number;
  balancePhp: number;
  overall: RoiLine;
  byArchetype: { archetype: SlateArchetype; line: RoiLine }[];
  curve: BankrollPoint[];
  upcoming: (InternCardView & { startsAt: string | null; locked: boolean }) | null;
  past: InternCardView[];
}
