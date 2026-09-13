/**
 * The paper account: balances, average-cost basis, realised P&L and the closed-trade journal.
 * One pure transition — applyFill — replaces the balance arithmetic that was copied into three
 * legacy call sites (the base execFill, the CIRCUIT fee override and the DLSIM venue wrapper).
 *
 * Semantics are the legacy ones, kept exactly (pinned by test/paper.parity.test.ts):
 *   - fee = feeRate × notional, paid in the quote asset; a buy must afford notional + fee
 *   - basis is average cost in USD; selling realises (exit − average) × qty
 *   - a breakeven close counts as a win (legacy `pl >= 0`)
 *   - trading against a non-USDT quote also moves the QUOTE asset's basis (it is spent/received)
 *   - dust below 1e-9 is swept from balances and basis
 */

export const JOURNAL_CAP = 60;
const DUST = 1e-9;

export interface Basis { readonly qty: number; readonly costUSD: number; readonly t0?: number }
export interface Stats { readonly wins: number; readonly losses: number; readonly feesUSD: number; readonly realizedUSD: number; readonly trades: number }
export interface JournalEntry {
  readonly sym: string; readonly qty: number; readonly entry: number; readonly exit: number;
  readonly pl: number; readonly plPct: number; readonly hold: number; readonly t: number;
  /** the sell order's full size, when this close was a partial fill of it */
  readonly of?: number;
  /** a perpetual's close (lib/perps): side, leverage, why it closed, net funding paid */
  readonly perp?: { readonly side: 'long' | 'short'; readonly lev: number; readonly reason: 'manual' | 'stop-loss' | 'take-profit' | 'liquidation'; readonly funding: number };
}
export interface Account {
  readonly bal: Readonly<Record<string, number>>;
  readonly basis: Readonly<Record<string, Basis>>;
  readonly stats: Stats;
  readonly journal: readonly JournalEntry[];
}

export const EMPTY_STATS: Stats = Object.freeze({ wins: 0, losses: 0, feesUSD: 0, realizedUSD: 0, trades: 0 });

export interface FillInput {
  readonly side: 'buy' | 'sell';
  readonly sym: string;
  readonly quote: string;
  readonly amt: number;
  readonly px: number;
  readonly feeRate: number;
  /** USD value of one unit of the quote asset (1 for USDT) */
  readonly quoteUSD: number;
  readonly now: number;
  /**
   * Network (gas) cost in the quote asset, paid on top of the trade. With `amt: 0` the transition
   * is a CHARGE ONLY — a transaction that failed on-chain still paid its gas — and that charge is
   * capped at the quote balance (the account can be emptied by gas, never overdrawn).
   */
  readonly networkQuote?: number;
  /** the order's full size (for the ledger), when this fill is only part of it */
  readonly asked?: number;
  /** what a simulated MEV sandwich cost this fill, quote (ledger only — it is already in `px`) */
  readonly mevQuote?: number;
  /** a charge-only row's reason */
  readonly note?: string;
}

export interface Txn {
  readonly type: 'Buy' | 'Sell' | 'Gas'; readonly sym: string; readonly amt: number; readonly val: number; readonly quote: string;
  /** the order's full size, when this fill was only part of it */
  readonly of?: number;
  /** gas this transaction paid (quote) */
  readonly gas?: number;
  /** what a simulated MEV sandwich cost this fill (quote) */
  readonly mev?: number;
  /** a Gas row's reason ("reverted swap", "cancelled swap") */
  readonly note?: string;
}

export type FillResult =
  | { readonly ok: false; readonly reason: 'invalid' | 'insufficient-quote' | 'insufficient-base'; readonly need: number; readonly have: number }
  | { readonly ok: true; readonly account: Account; readonly fee: number; readonly feeUSD: number; readonly realizedUSD: number; readonly txn: Txn | null; readonly networkQuote: number };

interface Mut { bal: Record<string, number>; basis: Record<string, Basis>; stats: { -readonly [K in keyof Stats]: number }; journal: JournalEntry[] }

function basisBuy(m: Mut, sym: string, amt: number, pxUSD: number, now: number): void {
  const b = m.basis[sym] || { qty: 0, costUSD: 0 };
  m.basis[sym] = { qty: b.qty + amt, costUSD: b.costUSD + amt * pxUSD, t0: b.t0 || now };
}

function basisSell(m: Mut, sym: string, amt: number, pxUSD: number, now: number): number {
  const b = m.basis[sym];
  if (!b || b.qty <= 1e-12) return 0;
  const take = Math.min(amt, b.qty), avg = b.costUSD / b.qty, pl = take * (pxUSD - avg);
  const qty = b.qty - take;
  if (qty <= DUST) delete m.basis[sym];
  else m.basis[sym] = { ...b, qty, costUSD: b.costUSD - take * avg };
  m.stats.realizedUSD += pl;
  if (pl >= 0) m.stats.wins++; else m.stats.losses++;
  m.journal.unshift({ sym, qty: take, entry: avg, exit: pxUSD, pl, plPct: avg ? ((pxUSD - avg) / avg) * 100 : 0, hold: b.t0 ? now - b.t0 : 0, t: now });
  if (m.journal.length > JOURNAL_CAP) m.journal.pop();
  return pl;
}

function mut(acct: Account): Mut {
  return { bal: { ...acct.bal }, basis: { ...acct.basis }, stats: { ...acct.stats }, journal: acct.journal.slice() };
}

/** Add `amt` at `pxUSD` to the average-cost basis of `sym`. */
export function buyBasis(acct: Account, sym: string, amt: number, pxUSD: number, now: number): Account {
  const m = mut(acct); basisBuy(m, sym, amt, pxUSD, now); return m;
}

/** Remove up to `amt` from the basis of `sym` at `pxUSD`, realising P&L and journaling the close. */
export function sellBasis(acct: Account, sym: string, amt: number, pxUSD: number, now: number): { account: Account; pl: number } {
  const m = mut(acct); const pl = basisSell(m, sym, amt, pxUSD, now); return { account: m, pl };
}

/** Apply one fill. Never mutates `acct`. */
export function applyFill(acct: Account, f: FillInput): FillResult {
  const net = f.networkQuote && f.networkQuote > 0 ? f.networkQuote : 0;
  if (f.amt === 0 && net > 0) return chargeOnly(acct, f, net);
  if (!(f.amt > 0 && f.px > 0)) return { ok: false, reason: 'invalid', need: 0, have: 0 };
  const m = mut(acct);
  const val = f.amt * f.px, fee = f.feeRate * val, qU = f.quoteUSD || 0, pxUSD = f.px * qU;
  let realizedUSD = 0;
  if (f.side === 'buy') {
    const cost = val + fee + net, have = m.bal[f.quote] || 0;
    if (cost > have + DUST) return { ok: false, reason: 'insufficient-quote', need: cost, have };
    m.bal[f.quote] = have - cost;
    m.bal[f.sym] = (m.bal[f.sym] || 0) + f.amt;
    basisBuy(m, f.sym, f.amt, pxUSD, f.now);
    if (f.quote !== 'USDT') basisSell(m, f.quote, cost, qU, f.now);
  } else {
    const have = m.bal[f.sym] || 0;
    if (f.amt > have + DUST) return { ok: false, reason: 'insufficient-base', need: f.amt, have };
    const left = have - f.amt;
    if (left < DUST) delete m.bal[f.sym]; else m.bal[f.sym] = left;
    m.bal[f.quote] = (m.bal[f.quote] || 0) + (val - fee);
    if (f.quote !== 'USDT') basisBuy(m, f.quote, val - fee, qU, f.now);
    const j0 = m.journal[0];
    realizedUSD = basisSell(m, f.sym, f.amt, pxUSD, f.now);
    // a close that was only part of the order says so in the trade journal
    if (f.asked && f.asked > f.amt * (1 + 1e-9) && m.journal[0] && m.journal[0] !== j0) m.journal[0] = { ...m.journal[0], of: f.asked };
    if (net) m.bal[f.quote] = Math.max(0, m.bal[f.quote]! - net);   // gas comes out of the proceeds
  }
  m.stats.feesUSD += fee * qU;
  if (net) m.stats.feesUSD += net * qU;
  m.stats.trades++;
  return {
    ok: true, account: m, fee, feeUSD: fee * qU, realizedUSD, networkQuote: net,
    txn: {
      type: f.side === 'buy' ? 'Buy' : 'Sell', sym: f.sym, amt: f.amt, val, quote: f.quote,
      ...(f.asked && f.asked > f.amt * (1 + 1e-9) ? { of: f.asked } : {}),
      ...(net ? { gas: net } : {}),
      ...(f.mevQuote && f.mevQuote > 0 ? { mev: f.mevQuote } : {}),
    },
  };
}

/** Gas for a transaction that traded nothing (timed out, reverted): capped at the quote balance. */
function chargeOnly(acct: Account, f: FillInput, net: number): FillResult {
  const m = mut(acct), have = m.bal[f.quote] || 0, paid = Math.min(net, have);
  if (paid > 0) m.bal[f.quote] = have - paid;
  m.stats.feesUSD += paid * (f.quoteUSD || 0);
  // every deduction leaves a ledger row: gas paid for a swap that traded nothing is a 'Gas' row
  const txn: Txn | null = paid > 0 ? { type: 'Gas', sym: f.quote, amt: 0, val: paid, quote: f.quote, gas: paid, ...(f.note ? { note: f.note } : {}) } : null;
  return { ok: true, account: m, fee: 0, feeUSD: 0, realizedUSD: 0, networkQuote: paid, txn };
}

/** Mark-to-market value of all balances in USD. `priceUSD` returns 0 for unknown assets. */
export function equityUSD(bal: Readonly<Record<string, number>>, priceUSD: (sym: string) => number): number {
  let v = 0;
  for (const sym of Object.keys(bal)) {
    const a = bal[sym] || 0;
    if (a > 0) v += sym === 'USDT' ? a : a * priceUSD(sym);
  }
  return v;
}

/**
 * Venue fee adjustment after a fill (the DLSIM "Pro" profile): the difference between the venue's
 * rate and the rate already charged, plus per-fill gas converted to the quote asset. Positive =
 * the account pays more. A charge is capped at the quote balance (legacy behaviour).
 */
export function venueAdjustment(chargedRate: number, venueRate: number, notional: number, gasUSD: number, quoteUSD: number): number {
  let del = (venueRate - chargedRate) * notional;
  if (gasUSD) del += gasUSD / (quoteUSD || 1);
  return del;
}
