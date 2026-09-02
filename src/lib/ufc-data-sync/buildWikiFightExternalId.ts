/**
 * A stable identity for one Wikipedia-sourced bout.
 *
 * **This replaces a position-based id, and the reason matters.** Until
 * 2026-09-03 this was `wiki:<title>:<index in the wikitext>`, which made
 * a fight's identity its slot on the card. Card slots are not stable --
 * MMA cards gain, lose and reorder bouts constantly -- so when Wikipedia
 * added two bouts higher up UFC Fight Night: Hooker vs. Parnasse, index
 * 3 stopped meaning "Pinto vs Spann" and started meaning "Donchenko vs
 * Soriano". upsertFight found the OLD row by that id and wrote the NEW
 * bout's weight class onto it (its update payload carries weight_class
 * and bout_order, never the fighters), so Pinto vs Spann -- a heavyweight
 * bout -- rendered as "Welterweight", and Donchenko vs Soriano was never
 * inserted at all. Three of that card's fourteen bouts were missing from
 * the database for the same reason.
 *
 * Keyed on the fighter pair instead: the one thing about a bout that does
 * not move when the card is reshuffled. Sorted so the template listing
 * the pair in either order (Wikipedia puts the winner first once a card
 * has been contested) still resolves to one row.
 *
 * Fighter IDs rather than the raw names from the wikitext: upsertFighter
 * already owns name-to-row resolution, so an id survives a spelling or
 * diacritic change on the page that a name-keyed id would treat as a
 * different bout entirely.
 *
 * bout_order still updates on every sync, and should -- a bout's POSITION
 * genuinely does change when the card changes. It just can no longer be
 * what the row is identified by.
 */
export function buildWikiFightExternalId(
  eventTitle: string,
  fighter1Id: string,
  fighter2Id: string,
): string {
  const pair = [fighter1Id, fighter2Id].sort();
  return `wiki:${eventTitle}:${pair[0]}:${pair[1]}`;
}
