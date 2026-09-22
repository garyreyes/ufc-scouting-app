export interface LedgerEntry {
  occurredAt: string;
  amountPhp: number;
}

export interface BankrollPoint {
  occurredAt: string;
  balancePhp: number;
}

// bankroll_ledger's balance is deliberately never stored (0064) -- it is
// always the running sum of every signed movement, in occurred_at order.
// This is that same rule applied to a whole series instead of one total,
// so the chart and the "current balance" figure can never disagree.
//
// Callers must pass entries already sorted by occurred_at ascending
// (getBankrollLedger does -- a JS-side sort after selectAllPages, whose
// own cursor is `id`, not occurred_at) -- this function does not re-sort,
// since two rows can share an occurred_at (same-second settlement writes)
// and re-sorting here would silently pick an
// arbitrary tie-break instead of preserving insertion/read order.
export function buildBankrollCurve(entries: LedgerEntry[]): BankrollPoint[] {
  let balance = 0;
  return entries.map((entry) => {
    balance += entry.amountPhp;
    return { occurredAt: entry.occurredAt, balancePhp: balance };
  });
}
