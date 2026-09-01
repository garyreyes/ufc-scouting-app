// C3's own slice of a picks row -- just enough to render "your pick" on
// the collapsed card-view row. Stake/reasoning/method are C4's concern
// (the expanded bet row), not fetched here.
export interface MyQuickPick {
  fightId: string;
  predictedFighterId: string;
}
