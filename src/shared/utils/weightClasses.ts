// Matches the values API-Sports/Wikipedia actually write into
// fighters.weight_class and fights.weight_class (confirmed against the
// live API's /categories endpoint during Phase 3).
export const WEIGHT_CLASSES = [
  "Flyweight",
  "Bantamweight",
  "Featherweight",
  "Lightweight",
  "Welterweight",
  "Middleweight",
  "Light Heavyweight",
  "Heavyweight",
  "Women's Strawweight",
  "Women's Flyweight",
  "Women's Bantamweight",
  "Women's Featherweight",
] as const;
