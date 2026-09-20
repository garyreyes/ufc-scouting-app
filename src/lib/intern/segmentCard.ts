export interface CardFight {
  fightId: string;
  boutOrder: number | null;
}

export interface SegmentedFight {
  fightId: string;
  segment: "main" | "prelims";
}

// Main card = the 5 fights closest to the main event -- bout_order 0 is
// the main event, ascending toward prelims (features/fights/api.ts's own
// sort convention). Everything else on the card is prelims, including
// fights with no bout_order at all (API-Sports-only, never matched to a
// Wikipedia card page) -- they sort last and simply fall out of the
// first 5, never excluded from the card entirely.
const MAIN_CARD_SIZE = 5;

export function segmentCard(fights: CardFight[]): SegmentedFight[] {
  const sorted = [...fights].sort((a, b) => {
    if (a.boutOrder === null && b.boutOrder === null) return 0;
    if (a.boutOrder === null) return 1;
    if (b.boutOrder === null) return -1;
    return a.boutOrder - b.boutOrder;
  });

  return sorted.map((fight, index) => ({
    fightId: fight.fightId,
    segment: index < MAIN_CARD_SIZE ? "main" : "prelims",
  }));
}
