/**
 * Legacy adapters for the paper engine. The payload's CBX module, its two execFill bodies and its
 * order-evaluation loops keep their public names and call shapes; their bodies are now these
 * functions, which read legacy state, call the pure engine, and write the result back.
 *
 * Writing back is IN PLACE (same S.bal / S.basis / S.stats / S.journal objects), because older
 * wrappers hold references to them — the DeXaI coach reads S.journal[0] right after a fill.
 */
import { createBookEngine, applyFill, DEFAULT_TOLERANCE_PCT, venue as venueOf, gasCost, GAS_UNITS, TIER_MULT, type PriorityTier, type Realism, type MevOpts, type Txn, buyBasis, sellBasis, gapRule, explainGap, type ExecOpts, trigger, tradableQty, stepQueue, stopHit, limitTouched, type Account, type BookEngine, type RestingOrder } from '../lib/paper-engine';
import { legacy, type LegacyState } from './globals';
import { perpTxnLabel } from '../lib/perps/account';
import { signal as gasSignal } from './gas-feed';
import { routedVenue } from './fork-state';

let engine: BookEngine | null = null;

/** The CBX-compatible engine over the live payload (prices from pairPrice, stats from bySym). */
export function cbx(): BookEngine {
  if (engine) return engine;
  engine = createBookEngine({
    priceOf: (sym, quote) => legacy.pairPrice(sym, quote) || 0,
    statsOf: sym => { const c = legacy.coin(sym); return { vol24: (c && c.vol) || 0, mcap: (c && c.mcap) || 0, chg24: (c && c.c24) || 0, price: (c && c.price) || 0 }; },
    now: () => Date.now(),
    random: () => Math.random(),
    realism: () => realismOf(legacy.S()),
  });
  return engine;
}

/**
 * Execution realism from the paper account (S.dlsim, persisted with it): the DLSIM "Pro" mode is
 * Advanced; the venue profile picks the pool; slipTol / range are the Advanced ticket's settings.
 */
export function realismOf(S: LegacyState | undefined): Realism {
  const d = (S && S.dlsim) || {};
  return {
    mode: d.mode === 'pro' ? 'advanced' : 'beginner',
    venue: typeof d.venue === 'string' && d.venue ? d.venue : 'binance',
    tolerancePct: +d.slipTol > 0 ? +d.slipTol : DEFAULT_TOLERANCE_PCT,
    rangePct: +d.range > 0 ? +d.range : null,
    // a pool on the trader's own node, when the Fork sandbox is routing the ticket there
    fork: routedVenue(),
  };
}

/** The Advanced ticket's priority tier (S.dlsim.tier); Medium unless the trader chose otherwise. */
export function tierOf(S: LegacyState | undefined): PriorityTier {
  const t = S && S.dlsim && S.dlsim.tier;
  return t === 'low' || t === 'high' ? t : 'medium';
}

/**
 * Does an order settle on-chain (and so pay gas)? Only in Advanced — on the DEX venue, or on a pool
 * routed from the trader's own node (a swap there is a real transaction, priced at the node's gas).
 */
export function onChain(r: Realism): boolean { return r.mode === 'advanced' && (r.venue === 'dexamm' || !!r.fork); }

/** Simulated MEV bots: Advanced, on-chain, and only when the trader switched them on (off by default). */
export function mevOn(S: LegacyState | undefined): boolean {
  return onChain(realismOf(S)) && !!(S && S.dlsim && S.dlsim.mev === true);
}

/** The bots' cost of attacking (two swaps at High priority), in `quote` — or null when they are off. */
export function mevOf(S: LegacyState | undefined): MevOpts | null {
  if (!S || !mevOn(S)) return null;
  return { botGasQuote: 2 * gasIn(S.quote, GAS_UNITS.swap, gasSignal().gwei * TIER_MULT.high) };
}

/** Gas for `units` at `gwei`, in `quote`. */
export function gasIn(quote: string, units: number, gwei: number): number {
  return gasCost(units, gwei, legacy.pairPrice('ETH', 'USDT') || 0, legacy.pUSD(quote) || 1);
}

/** Gas the next swap on this pair would pay at the trader's tier (0 off-chain) — for fee lines. */
export function gasEstimate(quote: string): number {
  const S = legacy.S(), r = realismOf(S);
  return onChain(r) ? gasIn(quote, GAS_UNITS.swap, gasSignal().gwei * TIER_MULT[tierOf(S)]) : 0;
}

/** Would this fill go through? The same rules as the fill itself (applyFill), run dry. */
export function affordable(S: LegacyState | undefined, side: 'buy' | 'sell', sym: string, quote: string, qty: number, px: number, rate: number, networkQuote = 0): boolean {
  if (!S) return false;
  legacy.call('ensureEng');
  return applyFill(accountOf(S), { side, sym, quote, amt: qty, px, feeRate: rate, quoteUSD: legacy.pUSD(quote) || 0, now: Date.now(), networkQuote }).ok;
}

/** Gas for a transaction that traded nothing. Returns what was actually paid (capped at the balance). */
export function chargeNetwork(S: LegacyState | undefined, quote: string, amount: number, note = 'gas'): number {
  legacy.call('ensureEng');
  if (!S || !(amount > 0)) return 0;
  const r = applyFill(accountOf(S), { side: 'buy', sym: quote, quote, amt: 0, px: 0, feeRate: 0, quoteUSD: legacy.pUSD(quote) || 0, now: Date.now(), networkQuote: amount, note });
  if (!r.ok) return 0;
  commit(S, r.account);
  if (r.txn) ledger(S, r.txn);
  legacy.call('saveP');
  return r.networkQuote;
}

/** Log a transaction through the legacy ledger, then attach what the legacy row has no column for. */
function ledger(S: LegacyState, t: Txn): void {
  legacy.call('logTxn', t.type, t.sym, t.amt, t.val, t.quote);
  const row = S.txns && S.txns[0];
  const extra: Record<string, unknown> = {};
  for (const k of ['of', 'gas', 'mev', 'note'] as const) if (t[k] != null) extra[k] = t[k];
  if (row && Object.keys(extra).length) { Object.assign(row, extra); legacy.call('renderTxns'); }
}

/** Ledger text for the rows the legacy renderer cannot label (gas rows, partial / gas / sandwich notes). */
export function txnLabel(t: { type?: string; sym?: string; amt?: number; val?: number; quote?: string; of?: number; gas?: number; mev?: number; note?: string; lev?: number; pl?: number }, fmt: (n: number) => string): string | null {
  const perp = perpTxnLabel(t, fmt);
  if (perp) return perp;
  if (t.type === 'Gas') return 'Gas · ' + fmt(t.val || 0) + ' ' + (t.quote || '') + (t.note ? ' · ' + t.note : '');
  if (t.type !== 'Buy' && t.type !== 'Sell') return null;
  if (t.of == null && t.gas == null && t.mev == null) return null;
  const amt = t.amt || 0;
  return t.type + ' ' + fmt(amt) + ' ' + t.sym + ' @ ' + fmt(amt ? (t.val || 0) / amt : 0) + ' ' + t.quote +
    (t.of ? ' · partial ' + ((amt / t.of) * 100).toFixed(0) + '% of ' + fmt(t.of) : '') +
    (t.gas ? ' · gas ' + fmt(t.gas) : '') + (t.mev ? ' · sandwiched +' + fmt(t.mev) : '');
}

/** A fill the ticket has fully priced (venue rate + this transaction's gas) — see execFill. */
let priced: { networkQuote: number } | null = null;
/** What the ledger should record about the ticket's fill (its full size, a sandwich's cost). */
let meta: { asked: number; mevQuote: number } | null = null;
export function withFillMeta<T>(m: { asked: number; mevQuote: number }, f: () => T): T {
  meta = m;
  try { return f(); } finally { meta = null; }
}
export function withPricedFill<T>(networkQuote: number, f: () => T): T {
  priced = { networkQuote };
  try { return f(); } finally { priced = null; }
}

export function accountOf(S: LegacyState): Account {
  return { bal: S.bal || {}, basis: S.basis || {}, stats: S.stats, journal: S.journal || [] };
}

function syncRecord(target: Record<string, unknown>, src: Readonly<Record<string, unknown>>): void {
  for (const k of Object.keys(target)) if (!(k in src)) delete target[k];
  for (const k of Object.keys(src)) target[k] = src[k];
}

/** Basis entries are updated field by field on the SAME object (the legacy code mutated `b` in place). */
function syncBasis(target: Record<string, Record<string, unknown>>, src: Readonly<Record<string, object>>): void {
  for (const k of Object.keys(target)) if (!(k in src)) delete target[k];
  for (const k of Object.keys(src)) {
    const cur = target[k];
    if (cur && typeof cur === 'object') Object.assign(cur, src[k]); else target[k] = { ...(src[k] as Record<string, unknown>) };
  }
}

/** Write an account back onto legacy S without replacing any of its containers. */
export function commit(S: LegacyState, a: Account): void {
  if (!S.bal) S.bal = {};
  if (!S.basis) S.basis = {};
  syncRecord(S.bal, a.bal);
  syncBasis(S.basis as Record<string, Record<string, unknown>>, a.basis);
  Object.assign(S.stats, a.stats);
  // legacy creates S.journal lazily, on the first close — so do we
  if (S.journal) S.journal.splice(0, S.journal.length, ...a.journal);
  else if (a.journal.length) S.journal = a.journal.slice();
}

/**
 * execFill(rate, …) — the balance transition behind every paper fill.
 * `playful` selects the base build's toast copy ("gains secured 💎"); the fee-override path used
 * plain copy. Returns true on a fill, false when the account cannot afford it (legacy contract).
 */
export function execFill(S: LegacyState | undefined, rate: number, side: 'buy' | 'sell', sym: string, quote: string, amt: number, px: number, label: unknown, silent: unknown, playful: boolean): boolean {
  legacy.call('ensureEng');
  if (!S || !(amt > 0 && px > 0)) return false;
  // Advanced: every fill pays its venue's rate (maker for a resting limit) and, on-chain, its gas —
  // the ticket prices its own fills; every other path (resting orders, stops, DCA, bots, DeXaI) is
  // priced here at Medium priority. Perps keep their own fee model. This replaces the DLSIM
  // after-the-fact fee delta, which wrote the balance a second time.
  let feeRate = rate, networkQuote = 0;
  const real = realismOf(S);
  if (priced) networkQuote = priced.networkQuote;
  else if (real.mode === 'advanced' && label !== 'perp') {
    const v = venueOf(real.venue);
    feeRate = label === 'limit' ? v.m : v.t;
    if (onChain(real)) networkQuote = gasIn(quote, GAS_UNITS.swap, gasSignal().gwei * TIER_MULT.medium);
  }
  const r = applyFill(accountOf(S), {
    side, sym, quote, amt, px, feeRate, quoteUSD: legacy.pUSD(quote) || 0, now: Date.now(), networkQuote,
    ...(meta ? { asked: meta.asked, mevQuote: meta.mevQuote } : {}),
  });
  if (!r.ok || !r.txn) return false;
  commit(S, r.account);
  if (side === 'sell' && !silent && Math.abs(r.realizedUSD) > 1e-9) {
    const pl = r.realizedUSD;
    const title = playful ? legacy.call('mt', 'Realized P&L', pl >= 0 ? 'gains secured 💎' : 'took the L 🧻 (tuition)') : 'Realized P&L';
    legacy.call('toast', pl >= 0 ? 'good' : 'bad', title, (pl >= 0 ? '+' : '−') + legacy.call('cUSD', Math.abs(pl)));
  }
  ledger(S, r.txn);
  return true;
}

/**
 * Gap policy (orders.ts): in Advanced a triggered stop-loss / trailing stop / stop is a MARKET order
 * at the trigger — it meets the market where it is (gap + impact), with no tolerance cap. Returns
 * null when the order fills at its own price instead (Beginner, limits, take-profits).
 */
export function stopMarket(o: RestingOrder, side: 'buy' | 'sell', qty: number): { filled: number; avg: number; why?: string; reason?: string } | null {
  const S = legacy.S();
  if (gapRule(o.type, realismOf(S).mode === 'advanced') !== 'market') return null;
  const R = cbx().execute(o.sym, o.quote, side, qty, stopOpts(o, side));
  if (!('remaining' in R) || !(R.filled > 1e-12)) return { filled: 0, avg: 0, reason: ('reason' in R && R.reason) || 'no liquidity at the trigger' };
  const why = explainGap(o.px, R.avg, side, x => String(legacy.call('fmt', x)));
  return { filled: R.filled, avg: R.avg, ...(why ? { why } : {}) };
}

/** Execution options for a triggered stop: IOC; in Advanced also no tolerance cap and a balance check first. */
export function stopOpts(o: RestingOrder, side?: 'buy' | 'sell'): ExecOpts {
  const S = legacy.S(), real = realismOf(S);
  if (real.mode !== 'advanced') return { tif: 'IOC' };
  const sd = side || o.side, gas = onChain(real) ? gasIn(o.quote, GAS_UNITS.swap, gasSignal().gwei * TIER_MULT.medium) : 0;
  return { tif: 'IOC', tolerancePct: Infinity, afford: (q, px, rate) => affordable(S, sd, o.sym, o.quote, q, px, rate, gas) };
}

/** Legacy basisBuy / basisSell (still called by the P2P settlement path) over the pure basis math. */
export function basisBuy(S: LegacyState | undefined, sym: string, amt: number, pxUSD: number): void {
  legacy.call('ensureEng');
  if (S) commit(S, buyBasis(accountOf(S), sym, amt, pxUSD, Date.now()));
}
export function basisSell(S: LegacyState | undefined, sym: string, amt: number, pxUSD: number): number {
  legacy.call('ensureEng');
  if (!S) return 0;
  const r = sellBasis(accountOf(S), sym, amt, pxUSD, Date.now());
  commit(S, r.account);
  return r.pl;
}

export { trigger, tradableQty, stepQueue, stopHit, limitTouched };
export type { RestingOrder };
