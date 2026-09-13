/**
 * The replay engine: one pure step per bar.
 *
 * The rules, chosen so a result can never flatter itself with a price the trader could not have
 * seen (and printed on the desk, verbatim):
 *   · A market order placed while looking at bar i fills at the OPEN of bar i+1.
 *   · A limit fills when the bar trades through it: buy when low ≤ limit, sell when high ≥ limit —
 *     at the limit, or at the open when the bar GAPPED past it (you get the better price).
 *   · A stop fills when the bar trades through it — at the stop, or at the open when the bar
 *     gapped past it (you get the worse price; that is what a gap does).
 *   · Within one bar: market, then stops, then limits. The tape inside a bar is unknown, so the
 *     engine takes the pessimistic order rather than the flattering one.
 *   · Equity is marked at every close; a fill can never spend cash the account does not have.
 */
import type { BtEvent, BtFill, BtOrder, BtState, Candle, FillWhy } from './types';

export const DEFAULT_FEE = 0.001;
const DUST = 1e-12;

export function init(cash: number): BtState {
  return { i: -1, cash, qty: 0, cost: 0, openedBar: -1, orders: [], fills: [], trades: [], equity: [], feesUSD: 0, peak: cash, maxDD: 0, barsInMarket: 0, start: cash, done: false };
}

export interface Submit { readonly state: BtState; readonly error: string | null }

/** Place an order for the bars that come next. Never fills here — the next bar does that. */
export function submit(s: BtState, o: BtOrder, bar: Candle | undefined): Submit {
  if (!(o.qty > 0)) return { state: s, error: 'Enter a size first.' };
  if (o.type !== 'market' && !(o.px && o.px > 0)) return { state: s, error: 'A ' + o.type + ' order needs a price.' };
  if (o.side === 'sell' && o.qty > s.qty + DUST) return { state: s, error: 'You hold ' + s.qty.toPrecision(6) + ' — you cannot sell more than that.' };
  if (o.side === 'buy' && bar && o.qty * (o.px || bar.c) > s.cash * 1.0001) return { state: s, error: 'That would cost more cash than the run has left.' };
  const pending = s.orders.filter(x => x.side === o.side && x.type !== 'market').reduce((n, x) => n + x.qty, 0);
  if (o.side === 'sell' && pending + o.qty > s.qty + DUST) return { state: s, error: 'Your resting sell orders already cover everything you hold.' };
  return { state: { ...s, orders: [...s.orders, o] }, error: null };
}

export function cancel(s: BtState, id: string): BtState { return { ...s, orders: s.orders.filter(o => o.id !== id) }; }

/** What a bar does to one order: the fill price and why, or null. */
export function priceFor(o: BtOrder, b: Candle): { px: number; why: FillWhy } | null {
  if (o.type === 'market') return { px: b.o, why: 'market-open' };
  const p = o.px!;
  if (o.type === 'limit') {
    if (o.side === 'buy') return b.o <= p ? { px: b.o, why: 'limit-gap' } : b.l <= p ? { px: p, why: 'limit' } : null;
    return b.o >= p ? { px: b.o, why: 'limit-gap' } : b.h >= p ? { px: p, why: 'limit' } : null;
  }
  if (o.side === 'buy') return b.o >= p ? { px: b.o, why: 'stop-gap' } : b.h >= p ? { px: p, why: 'stop' } : null;
  return b.o <= p ? { px: b.o, why: 'stop-gap' } : b.l <= p ? { px: p, why: 'stop' } : null;
}

const RANK = { market: 0, stop: 1, limit: 2 } as const;

export interface Advanced { readonly state: BtState; readonly events: readonly BtEvent[] }

/** Step onto the next bar: fill what it fills, mark the close. */
export function advance(s: BtState, bars: readonly Candle[], feeRate = DEFAULT_FEE): Advanced {
  const n = s.i + 1, b = bars[n];
  if (!b || s.done) return { state: { ...s, done: true }, events: [] };
  let st: BtState = { ...s, i: n };
  const events: BtEvent[] = [];
  for (const o of [...s.orders].sort((a, c) => RANK[a.type] - RANK[c.type])) {
    const hit = priceFor(o, b);
    if (!hit) continue;
    const r = apply(st, o, hit.px, hit.why, b, n, feeRate);
    st = r.state;
    events.push({ bar: n, kind: r.fill ? 'fill' : 'rejected', text: r.text, ...(r.fill ? { fill: r.fill } : {}) });
  }
  return { state: mark(st, b, n), events };
}

/** Mark equity at a bar's close and update the drawdown watermark. */
function mark(s: BtState, b: Candle, n: number): BtState {
  const eq = s.cash + s.qty * b.c, peak = Math.max(s.peak, eq);
  return {
    ...s, equity: [...s.equity, eq], peak, maxDD: Math.max(s.maxDD, peak > 0 ? (peak - eq) / peak : 0),
    barsInMarket: s.barsInMarket + (s.qty > DUST ? 1 : 0), openedBar: s.qty > DUST ? (s.openedBar < 0 ? n : s.openedBar) : -1,
  };
}

interface Applied { state: BtState; fill: BtFill | null; text: string }

function apply(s: BtState, o: BtOrder, px: number, why: FillWhy, b: Candle, n: number, feeRate: number): Applied {
  const rest = s.orders.filter(x => x.id !== o.id);
  const qty = o.side === 'sell' ? Math.min(o.qty, s.qty) : o.qty;
  const gross = qty * px, fee = gross * feeRate;
  if (!(qty > DUST)) return { state: { ...s, orders: rest }, fill: null, text: 'Nothing left to sell — the order was dropped.' };
  if (o.side === 'buy' && gross + fee > s.cash + 1e-9) return { state: { ...s, orders: rest }, fill: null, text: 'Not enough cash at ' + px.toPrecision(6) + ' — the order was cancelled.' };
  const fill: BtFill = { orderId: o.id, side: o.side, qty, px, fee, bar: n, t: b.t, why };
  const st: BtState = o.side === 'buy'
    ? { ...s, orders: rest, cash: s.cash - gross - fee, qty: s.qty + qty, cost: s.cost + gross, feesUSD: s.feesUSD + fee, fills: [...s.fills, fill], openedBar: s.qty > DUST ? s.openedBar : n }
    : sell(s, rest, fill, feeRate);
  return { state: st, fill, text: label(o, fill) };
}

function sell(s: BtState, rest: readonly BtOrder[], f: BtFill, _feeRate: number): BtState {
  const avg = s.qty > DUST ? s.cost / s.qty : f.px, part = f.qty * avg, pl = f.qty * (f.px - avg) - f.fee;
  const left = s.qty - f.qty;
  return {
    ...s, orders: rest, cash: s.cash + f.qty * f.px - f.fee, qty: left < DUST ? 0 : left, cost: left < DUST ? 0 : s.cost - part,
    feesUSD: s.feesUSD + f.fee, fills: [...s.fills, f],
    trades: [...s.trades, { qty: f.qty, entry: avg, exit: f.px, pl, plPct: part > 0 ? (pl / part) * 100 : 0, fee: f.fee, openedAt: s.openedBar, closedAt: f.bar, bars: Math.max(0, f.bar - (s.openedBar < 0 ? f.bar : s.openedBar)) }],
  };
}

function label(o: BtOrder, f: BtFill): string {
  const how = f.why === 'market-open' ? 'at the open' : f.why === 'limit' ? 'at your limit' : f.why === 'stop' ? 'at your stop'
    : f.why === 'limit-gap' ? 'better than your limit — the bar opened through it' : 'worse than your stop — the bar gapped through it';
  return (o.side === 'buy' ? 'Bought ' : 'Sold ') + f.qty.toPrecision(6) + ' @ ' + f.px.toPrecision(8) + ' ' + how;
}

/** Sell everything at the last close, so a finished run is measured flat (fees included). */
export function closeOut(s: BtState, bars: readonly Candle[], feeRate = DEFAULT_FEE): BtState {
  const b = bars[s.i];
  if (!b || s.qty <= DUST) return { ...s, done: true };
  const f: BtFill = { orderId: 'close-out', side: 'sell', qty: s.qty, px: b.c, fee: s.qty * b.c * feeRate, bar: s.i, t: b.t, why: 'close-out' };
  const st = sell(s, [], f, feeRate);
  return { ...st, equity: [...st.equity.slice(0, -1), st.cash], done: true };
}
