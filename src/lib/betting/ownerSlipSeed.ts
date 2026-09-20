// Q3: the owner's 16 real bet slips (2026-08-23 -> 2026-09-13),
// transcribed from bookmaker screenshots.
//
// Every fighter here was resolved by NAME against a live query of the
// three events, never by position. The ticket's W1/W2 does NOT reliably
// match the database's fighter1/fighter2 -- slip 86025536447 reads
// "Marquel Mederos vs Mason Jones" and backs W1 (Mederos), but the
// fights row stores Jones as fighter1. A positional mapping would have
// recorded that bet on the wrong fighter, and the bet_legs trigger could
// not have caught it, because Jones genuinely is one of the two.
//
// `status` and `payoutPhp` are the figures PRINTED ON THE TICKET, not
// values this codebase computed. settleSlip's job is to reproduce them
// (see settleSlip.test.ts), so writing computed values here would make
// that test circular.

export const OWNER_USER_ID = "80ae2af8-4f13-42fc-b9b3-3e07d13e762b";
export const PESOS_PER_UNIT = 100;

const EVENT_AUG22 = "45bf71e2-6aac-459c-a65d-02660c6181a8"; // FN: Hernandez vs Rodrigues
const EVENT_SEP05 = "e97d3061-768b-4294-9ea7-4d63f8742047"; // FN: Hooker vs Parnasse
const EVENT_SEP12 = "88556d2d-304c-43f3-b20c-7a356a03df6c"; // FN: Silva vs Delgado (Noche)

export interface SeedLeg {
  fightId: string | null;
  externalDescription: string | null;
  market: "MONEYLINE" | "DOUBLE_CHANCE" | "METHOD_FIGHTER" | "METHOD_FIGHT" | "OTHER";
  selectionFighterId: string | null;
  selectionDetail: string;
  methodGroup: "DECISION" | "KO_TKO_DQ" | "SUBMISSION" | "ANY_FINISH" | null;
  price: number;
  // From the ticket. "pending" only where the screenshot was cut off AND
  // the slip was already dead from another leg, so the real result is
  // both unknown and irrelevant to the money.
  legResult: "won" | "lost" | "void" | "pending";
}

export interface SeedSlip {
  bookmakerBetId: string | null;
  eventId: string | null;
  archetype: "SAFE_PARLAY" | "STRAIGHT_DOG" | "LONGSHOT" | "METHOD_VALUE" | "LOCK" | "OTHER";
  stakePhp: number;
  combinedPrice: number;
  status: "won" | "lost" | "void";
  payoutPhp: number;
  placedAt: string;
  isPromo?: boolean;
  note?: string;
  legs: SeedLeg[];
}

export const OWNER_SLIP_SEED: SeedSlip[] = [
  {
    bookmakerBetId: "86025536447",
    eventId: EVENT_AUG22,
    archetype: "STRAIGHT_DOG",
    stakePhp: 74.59,
    combinedPrice: 3.705,
    status: "won",
    payoutPhp: 276.36,
    placedAt: "2026-08-23T00:41:00Z",
    isPromo: true,
    note: "Promo-funded stake, hence the odd amount.",
    legs: [
      {
        fightId: "415dcb60-0860-4e78-9782-5296a80a967d",
        externalDescription: null,
        market: "MONEYLINE",
        // Ticket W1. DB order is REVERSED here -- Jones is fighter1.
        selectionFighterId: "30b518b3-0e4d-4c78-b63e-a5ce77b03f33", // MarQuel Mederos
        selectionDetail: "1X2. W1",
        methodGroup: null,
        price: 3.705,
        legResult: "won",
      },
    ],
  },
  {
    bookmakerBetId: "86268928063",
    eventId: null,
    archetype: "STRAIGHT_DOG",
    stakePhp: 300,
    combinedPrice: 2.53,
    status: "won",
    payoutPhp: 759,
    placedAt: "2026-08-28T10:25:00Z",
    note: "Road to UFC -- not a card this app ingests.",
    legs: [
      {
        fightId: null,
        externalDescription: "Road to UFC: Kasib Murdoch vs Rabindra Dhant — W2 (Dhant)",
        market: "OTHER",
        selectionFighterId: null,
        selectionDetail: "1X2. W2",
        methodGroup: null,
        price: 2.53,
        legResult: "won",
      },
    ],
  },
  {
    bookmakerBetId: "86734905105",
    eventId: EVENT_SEP05,
    archetype: "STRAIGHT_DOG",
    stakePhp: 150,
    combinedPrice: 2.85,
    status: "won",
    payoutPhp: 427.5,
    placedAt: "2026-09-05T18:03:00Z",
    legs: [
      {
        fightId: "c56e188f-c121-46a9-924d-567d785d4dc4",
        externalDescription: null,
        market: "MONEYLINE",
        selectionFighterId: "96bd74ba-02b5-4b2f-aa94-b88430d10664", // Modestas Bukauskas
        selectionDetail: "1X2. W2",
        methodGroup: null,
        price: 2.85,
        legResult: "won",
      },
    ],
  },
  {
    bookmakerBetId: "86731494457",
    eventId: EVENT_SEP05,
    archetype: "STRAIGHT_DOG",
    stakePhp: 250,
    combinedPrice: 2.215,
    status: "won",
    payoutPhp: 553.75,
    placedAt: "2026-09-05T17:11:00Z",
    legs: [
      {
        fightId: "79daea0e-a341-4ba1-ab4c-e524a32836d1",
        externalDescription: null,
        market: "MONEYLINE",
        selectionFighterId: "bd7af370-d118-4213-a5cd-33ab56dfd2ed", // Fabià Sintes
        selectionDetail: "1X2. W2",
        methodGroup: null,
        price: 2.215,
        legResult: "won",
      },
    ],
  },
  {
    bookmakerBetId: "86733149383",
    eventId: EVENT_SEP05,
    archetype: "METHOD_VALUE",
    stakePhp: 150,
    combinedPrice: 3,
    status: "lost",
    payoutPhp: 0,
    placedAt: "2026-09-05T17:35:00Z",
    legs: [
      {
        fightId: "fe215908-824e-4efb-b728-2585755974c8",
        externalDescription: null,
        market: "METHOD_FIGHTER",
        selectionFighterId: "d05f92e0-f8b9-441f-a97e-df27693a0d90", // Nathaniel Wood
        selectionDetail: "Method Of Victory. 1 Will Win By KO, TKO, Painful Lock, Chokehold, DQ or Refusal - Yes",
        methodGroup: "ANY_FINISH",
        price: 3,
        legResult: "lost",
      },
    ],
  },
  {
    bookmakerBetId: "86739093493",
    eventId: EVENT_SEP05,
    archetype: "STRAIGHT_DOG",
    stakePhp: 150,
    combinedPrice: 3.54,
    status: "lost",
    payoutPhp: 0,
    placedAt: "2026-09-05T19:12:00Z",
    legs: [
      {
        fightId: "320519a6-eab0-4c01-b073-c4b7f7d4d89a",
        externalDescription: null,
        market: "MONEYLINE",
        selectionFighterId: "fe1d3c66-f6f8-46c6-b109-6ed9ed9e471c", // Muhammad Naimov
        selectionDetail: "1X2. W2",
        methodGroup: null,
        price: 3.54,
        legResult: "lost",
      },
    ],
  },
  {
    bookmakerBetId: "86746067039",
    eventId: EVENT_SEP05,
    archetype: "STRAIGHT_DOG",
    stakePhp: 150,
    combinedPrice: 5.05,
    status: "lost",
    payoutPhp: 0,
    placedAt: "2026-09-05T21:40:00Z",
    legs: [
      {
        fightId: "d442ff1f-4eb5-4a50-8ab0-79afeda05856",
        externalDescription: null,
        market: "MONEYLINE",
        selectionFighterId: "16c1e9f7-685f-4f2c-8254-07895832073f", // Dan Hooker
        selectionDetail: "1X2. W1",
        methodGroup: null,
        price: 5.05,
        legResult: "lost",
      },
    ],
  },
  {
    bookmakerBetId: null,
    eventId: EVENT_SEP05,
    archetype: "LONGSHOT",
    stakePhp: 500,
    combinedPrice: 5.19,
    status: "won",
    payoutPhp: 2595.05,
    placedAt: "2026-09-05T18:30:00Z",
    note: "Ticket number and header were cut off in the screenshot. Third leg's price (2.15) derived from the product rule and confirmed by the printed payout; its market/selection are NOT legible.",
    legs: [
      {
        fightId: "d43d6681-837d-482c-84bc-9bfb63229d4f",
        externalDescription: null,
        market: "DOUBLE_CHANCE",
        selectionFighterId: "9ece94e2-66b5-4501-9395-83613124e365", // Felipe Lima
        selectionDetail: "Double Chance. 2X",
        methodGroup: null,
        price: 1.42,
        legResult: "won",
      },
      {
        fightId: "03dca95a-1ac6-4c99-b604-8958f151778e",
        externalDescription: null,
        // Names no fighter -- and note the DB stores Duclos as fighter1
        // while the ticket lists Dias first. Irrelevant for this market,
        // which is exactly why METHOD_FIGHT is modelled separately.
        market: "METHOD_FIGHT",
        selectionFighterId: null,
        selectionDetail: "How The Bout Will Be Won. KO/TKO/DQ",
        methodGroup: "KO_TKO_DQ",
        price: 1.7,
        legResult: "won",
      },
      {
        fightId: "191b7b81-3e8e-4a3c-91bc-6ec63a9771ce",
        externalDescription: "Farès Ziam vs Axel Sola — selection not legible on screenshot; price derived from the product rule",
        market: "OTHER",
        selectionFighterId: null,
        selectionDetail: "(not legible)",
        methodGroup: null,
        price: 2.15,
        // Certain: the slip won, so every leg must have won.
        legResult: "won",
      },
    ],
  },
  {
    bookmakerBetId: "87135020559",
    eventId: EVENT_SEP12,
    archetype: "OTHER",
    stakePhp: 300,
    combinedPrice: 2.9,
    status: "won",
    payoutPhp: 870,
    placedAt: "2026-09-12T14:01:00Z",
    legs: [
      {
        fightId: "8c382199-0da4-4eab-b12e-eb71a01d6340",
        externalDescription: null,
        market: "DOUBLE_CHANCE",
        selectionFighterId: "71daecd0-982b-4a07-9096-993d4a61f569", // Alexa Grasso
        selectionDetail: "Double Chance. 2X",
        methodGroup: null,
        price: 2.9,
        legResult: "won",
      },
    ],
  },
  {
    bookmakerBetId: "87137119625",
    eventId: EVENT_SEP12,
    archetype: "SAFE_PARLAY",
    stakePhp: 300,
    combinedPrice: 2.013,
    status: "won",
    payoutPhp: 603.9,
    placedAt: "2026-09-12T14:24:00Z",
    legs: [
      {
        fightId: "45def8a4-725f-45cb-abb6-68871d792d7a",
        externalDescription: null,
        market: "MONEYLINE",
        selectionFighterId: "eb36c4cc-38b3-455d-84ec-ad6aad547f5d", // Thomas Gantt
        selectionDetail: "1X2. W2",
        methodGroup: null,
        price: 1.22,
        legResult: "won",
      },
      {
        fightId: "c95be2f1-edca-424a-8060-1cdd66981ef5",
        externalDescription: null,
        market: "METHOD_FIGHTER",
        selectionFighterId: "7363518f-f957-493a-9763-d70e674c00dc", // Yousri Belgaroui
        selectionDetail: "Method Of Victory. W1 By KO, TKO Or DQ - Yes",
        methodGroup: "KO_TKO_DQ",
        price: 1.65,
        legResult: "won",
      },
    ],
  },
  {
    bookmakerBetId: "87136262219",
    eventId: EVENT_SEP12,
    archetype: "METHOD_VALUE",
    stakePhp: 250,
    combinedPrice: 7.2,
    status: "lost",
    payoutPhp: 0,
    placedAt: "2026-09-12T14:14:00Z",
    legs: [
      {
        fightId: "fda75b8e-540b-43d6-84be-e8f6eb03178a",
        externalDescription: null,
        market: "METHOD_FIGHTER",
        selectionFighterId: "e2c2c864-cf8a-4d3a-8d34-1ae91e0cf9da", // Marwan Rahiki
        selectionDetail: "Method Of Victory. Decision W2 - Yes",
        methodGroup: "DECISION",
        price: 7.2,
        legResult: "lost",
      },
    ],
  },
  {
    bookmakerBetId: null,
    eventId: EVENT_SEP12,
    archetype: "SAFE_PARLAY",
    stakePhp: 200,
    combinedPrice: 2.354,
    status: "lost",
    payoutPhp: 0,
    placedAt: "2026-09-12T14:30:00Z",
    note: "Ticket number cut off. Third leg (David Martínez vs Dan Ige, 1.23) not legible; slip was already dead from the Cortes-Acosta leg, so its result is unknown and irrelevant.",
    legs: [
      {
        fightId: "5cb22cc3-f9b4-4822-b95e-b245f74d67c5",
        externalDescription: null,
        market: "MONEYLINE",
        selectionFighterId: "1021e282-7cb0-442b-b7a0-7c536239362c", // Regina Tarín
        selectionDetail: "1X2. W2",
        methodGroup: null,
        price: 1.32,
        legResult: "won",
      },
      {
        fightId: "9902991c-134e-4ecc-ab02-d542ee304ae1",
        externalDescription: null,
        market: "DOUBLE_CHANCE",
        selectionFighterId: "49783cf8-4363-4dbd-b1e5-13d8d0db457c", // Waldo Cortes-Acosta
        selectionDetail: "Double Chance. 1X",
        methodGroup: null,
        price: 1.45,
        legResult: "lost",
      },
      {
        fightId: "b6e4b174-41cf-4486-a633-3e1fddfd93ed",
        externalDescription: "David Martínez vs Dan Ige — selection not legible on screenshot; price derived from the product rule",
        market: "OTHER",
        selectionFighterId: null,
        selectionDetail: "(not legible)",
        methodGroup: null,
        price: 1.23,
        legResult: "pending",
      },
    ],
  },
  {
    bookmakerBetId: null,
    eventId: EVENT_SEP12,
    archetype: "LONGSHOT",
    stakePhp: 100,
    combinedPrice: 18.228,
    status: "lost",
    payoutPhp: 0,
    placedAt: "2026-09-12T14:35:00Z",
    note: "Ticket number cut off. Third leg (Tim Elliott vs Édgar Cháirez, 2.17) not legible; slip already dead from two lost legs.",
    legs: [
      {
        fightId: "053e54c0-2d6a-4ff7-a8f2-75aca20a2571",
        externalDescription: null,
        market: "METHOD_FIGHTER",
        selectionFighterId: "b3bcb442-a4be-4651-b59c-82593045669d", // Rafa García
        selectionDetail: "Method Of Victory. Decision W1 - Yes",
        methodGroup: "DECISION",
        price: 4.2,
        legResult: "lost",
      },
      {
        fightId: "ce13493b-3ebf-470f-a0ed-56d7d4d4da09",
        externalDescription: null,
        market: "METHOD_FIGHTER",
        selectionFighterId: "32bbcd1f-7c5d-4bdc-91aa-754f23af70ee", // Ignacio Bahamondes
        selectionDetail: "Method Of Victory. W1 By KO, TKO Or DQ - Yes",
        methodGroup: "KO_TKO_DQ",
        price: 2,
        // Right fighter, wrong method -- Bahamondes won by decision.
        legResult: "lost",
      },
      {
        fightId: "ab70ada2-ab30-4b20-9fe4-f43f8cc2672b",
        externalDescription: "Tim Elliott vs Édgar Cháirez — selection not legible on screenshot; price derived from the product rule",
        market: "OTHER",
        selectionFighterId: null,
        selectionDetail: "(not legible)",
        methodGroup: null,
        price: 2.17,
        legResult: "pending",
      },
    ],
  },
  {
    bookmakerBetId: "87166074343",
    eventId: EVENT_SEP12,
    archetype: "STRAIGHT_DOG",
    stakePhp: 103.9,
    combinedPrice: 6.18,
    status: "won",
    payoutPhp: 642.1,
    placedAt: "2026-09-12T20:44:00Z",
    note: "Taken LIVE, ~9 minutes after the bout started, on the read that no underdog had won in the prelims yet.",
    legs: [
      {
        fightId: "ab70ada2-ab30-4b20-9fe4-f43f8cc2672b",
        externalDescription: null,
        market: "MONEYLINE",
        selectionFighterId: "6ca1938f-ae71-4f73-84c4-6dfe0e0ee874", // Tim Elliott
        selectionDetail: "1X2. W1",
        methodGroup: null,
        price: 6.18,
        legResult: "won",
      },
    ],
  },
  {
    bookmakerBetId: "87168965839",
    eventId: null,
    archetype: "OTHER",
    stakePhp: 100,
    combinedPrice: 4.475,
    status: "won",
    payoutPhp: 447.55,
    placedAt: "2026-09-12T21:49:00Z",
    note: "Mixed-sport slip: a US Open tennis leg parlayed with a UFC moneyline. Printed payout reflects the full-precision product (1.68 x 2.664 = 4.47552), not the displayed 4.475.",
    legs: [
      {
        fightId: null,
        externalDescription: "Tennis, US Open Women: Aryna Sabalenka vs Elena Rybakina — W1, 2nd set",
        market: "OTHER",
        selectionFighterId: null,
        selectionDetail: "1X2. W1. 2nd set",
        methodGroup: null,
        price: 1.68,
        legResult: "won",
      },
      {
        fightId: "9902991c-134e-4ecc-ab02-d542ee304ae1",
        externalDescription: null,
        market: "MONEYLINE",
        selectionFighterId: "1c876bf3-654a-4227-99dd-619c5436080c", // Curtis Blaydes
        selectionDetail: "1X2. W2",
        methodGroup: null,
        price: 2.664,
        legResult: "won",
      },
    ],
  },
  {
    bookmakerBetId: "87172232557",
    eventId: EVENT_SEP12,
    archetype: "METHOD_VALUE",
    stakePhp: 300,
    combinedPrice: 4.41,
    status: "lost",
    payoutPhp: 0,
    placedAt: "2026-09-12T23:25:00Z",
    legs: [
      {
        fightId: "b2f9c05f-85d8-46a8-be80-0a891dbfbe23",
        externalDescription: null,
        market: "METHOD_FIGHTER",
        selectionFighterId: "310eeb7a-5a3b-421c-bec2-d57dac1cf82c", // Joseph Morales
        selectionDetail: "Method Of Victory. Decision W2 - Yes",
        methodGroup: "DECISION",
        price: 2.45,
        legResult: "lost",
      },
      {
        fightId: "1afca94d-1c7b-4964-a284-de895839bfee",
        externalDescription: null,
        market: "METHOD_FIGHTER",
        selectionFighterId: "ed6844d5-b404-4b68-8025-5bbd853c6e25", // Jean Silva
        selectionDetail: "Method Of Victory. W1 By KO, TKO Or DQ - Yes",
        methodGroup: "KO_TKO_DQ",
        price: 1.8,
        // Right fighter, wrong method -- Silva won by rear-naked choke.
        legResult: "lost",
      },
    ],
  },
];
