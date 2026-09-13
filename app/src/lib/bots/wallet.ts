/**
 * A bot's own paper wallet. Isolated by construction: it is a value, created with the stake the
 * user typed, and nothing in it can reach the trader's account. Fills are at the price the bot
 * saw, less the venue fee; equity is marked at every price the bot sees; the risk rules (stop,
 * target, trailing) are checked against every mark, not once per bar — a stop that only looked
 * at closes would let a wick blow straight through it.
 */
import type { BotFill, BotFillWhy, BotTrade, RiskRules, Wallet } from './types';

const DUST = 1e-12;
/** the equity curve keeps at most this many points; older ones are thinned two-for-one */
export const MAX_POINTS = 1800;

export function open(stake: number): Wallet {
  return { start: stake, cash: stake, qty: 0, cost: 0, hwm: 0, openedAt: 0, fills: [], trades: [], equity: [], peak: stake, maxDD: 0, marks: 0, marksInMarket: 0, feesUSD: 0, firstPx: 0, lastPx: 0 };
}

export const equity = (w: Wallet, px: number): number => w.cash + w.qty * px;
export const holding = (w: Wallet): boolean => w.qty > DUST;
export const avgEntry = (w: Wallet): number => (w.qty > DUST ? w.cost / w.qty : 0);
export const openPl = (w: Wallet, px: number): number => (w.qty > DUST ? w.qty * px - w.cost : 0);

function thin(points: readonly (readonly [number, number])[]): (readonly [number, number])[] {
  if (points.length <= MAX_POINTS) return [...points];
  const keep = points.filter((_, i) => i % 2 === 0 || i === points.length - 1);
  return keep;
}

/** Record the price the bot is looking at: equity, drawdown, exposure and the trailing high. */
export function mark(w: Wallet, px: number, t: number): Wallet {
  if (!(px > 0)) return w;
  const eq = equity(w, px), peak = Math.max(w.peak, eq);
  const inMkt = holding(w);
  return {
    ...w, lastPx: px, firstPx: w.firstPx || px,
    equity: thin([...w.equity, [t, eq] as const]), peak, maxDD: Math.max(w.maxDD, peak > 0 ? (peak - eq) / peak : 0),
    marks: w.marks + 1, marksInMarket: w.marksInMarket + (inMkt ? 1 : 0),
    hwm: inMkt ? Math.max(w.hwm, px) : w.hwm,
  };
}

export interface Filled { readonly wallet: Wallet; readonly fill: BotFill | null; readonly text: string }

/**
 * Buy with a share of cash or sell a share of holdings, at `px` with `feeRate`. A buy that cannot
 * pay its fee or a sell with nothing to sell is refused in words, not rounded through.
 */
export function fill(w: Wallet, side: 'buy' | 'sell', fraction: number, px: number, feeRate: number, t: number, why: BotFillWhy, reason: string): Filled {
  if (!(px > 0)) return { wallet: w, fill: null, text: 'no price to fill at' };
  const fr = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 1));
  if (side === 'buy') {
    const spend = w.cash * fr;
    if (!(spend > 1)) return { wallet: w, fill: null, text: 'nothing to spend — the wallet holds ' + w.cash.toFixed(2) + ' USDT' };
    const gross = spend / (1 + feeRate), fee = gross * feeRate, qty = gross / px;
    const f: BotFill = { side, qty, px, fee, t, why, reason };
    return {
      wallet: { ...w, cash: w.cash - gross - fee, qty: w.qty + qty, cost: w.cost + gross, feesUSD: w.feesUSD + fee, fills: cap([...w.fills, f]), hwm: holding(w) ? Math.max(w.hwm, px) : px, openedAt: holding(w) ? w.openedAt : t, firstPx: w.firstPx || px, lastPx: px },
      fill: f, text: 'bought ' + qty.toPrecision(6) + ' @ ' + px.toPrecision(8) + ' · fee ' + fee.toFixed(4),
    };
  }
  const qty = w.qty * fr;
  if (!(qty > DUST) || !holding(w)) return { wallet: w, fill: null, text: 'nothing to sell' };
  const gross = qty * px, fee = gross * feeRate, avg = avgEntry(w), part = qty * avg, pl = qty * (px - avg) - fee;
  const left = w.qty - qty;
  const f: BotFill = { side, qty, px, fee, t, why, reason };
  const trade: BotTrade = { qty, entry: avg, exit: px, pl, plPct: part > 0 ? (pl / part) * 100 : 0, fee, openedAt: w.openedAt, closedAt: t };
  return {
    wallet: { ...w, cash: w.cash + gross - fee, qty: left < DUST ? 0 : left, cost: left < DUST ? 0 : w.cost - part, feesUSD: w.feesUSD + fee, fills: cap([...w.fills, f]), trades: cap([...w.trades, trade]), hwm: left < DUST ? 0 : w.hwm, openedAt: left < DUST ? 0 : w.openedAt, firstPx: w.firstPx || px, lastPx: px },
    fill: f, text: 'sold ' + qty.toPrecision(6) + ' @ ' + px.toPrecision(8) + ' · ' + (pl >= 0 ? '+' : '−') + Math.abs(pl).toFixed(2) + ' USDT',
  };
}

const cap = <T>(xs: readonly T[], n = 400): T[] => (xs.length > n ? xs.slice(xs.length - n) : [...xs]);

export interface RiskHit { readonly why: 'stop-loss' | 'take-profit' | 'trailing'; readonly reason: string }

/** Does this mark trip a risk exit? Stop first (the loss is real), then the trailing stop, then the target. */
export function riskExit(w: Wallet, r: RiskRules, px: number): RiskHit | null {
  if (!holding(w) || !(px > 0)) return null;
  const avg = avgEntry(w), chg = (px / avg - 1) * 100;
  if (r.stopLossPct && chg <= -r.stopLossPct) return { why: 'stop-loss', reason: 'mark ' + px.toPrecision(7) + ' is ' + Math.abs(chg).toFixed(2) + '% under the ' + avg.toPrecision(7) + ' entry — stop-loss ' + r.stopLossPct + '% hit' };
  if (r.trailingPct && w.hwm > 0) {
    const off = (1 - px / w.hwm) * 100;
    if (off >= r.trailingPct) return { why: 'trailing', reason: 'mark ' + px.toPrecision(7) + ' is ' + off.toFixed(2) + '% off the ' + w.hwm.toPrecision(7) + ' high since entry — trailing stop ' + r.trailingPct + '% hit' };
  }
  if (r.takeProfitPct && chg >= r.takeProfitPct) return { why: 'take-profit', reason: 'mark ' + px.toPrecision(7) + ' is ' + chg.toFixed(2) + '% over the ' + avg.toPrecision(7) + ' entry — take-profit ' + r.takeProfitPct + '% reached' };
  return null;
}

// ---------------------------------------------------------------- measured the way a desk measures it

export interface Score {
  readonly equity: number;
  readonly returnPct: number;
  readonly buyHoldPct: number;
  readonly edgePct: number;
  readonly maxDDPct: number;
  readonly trades: number;
  readonly wins: number;
  readonly winRatePct: number;
  readonly profitFactor: number;
  readonly expectancy: number;
  readonly exposurePct: number;
  readonly feesUSD: number;
  readonly feeDragPct: number;
  readonly openPl: number;
  readonly fills: number;
}

export function score(w: Wallet): Score {
  const px = w.lastPx || 0, eq = px > 0 ? equity(w, px) : w.cash;
  let wins = 0, gw = 0, gl = 0, sum = 0;
  for (const t of w.trades) { sum += t.pl; if (t.pl >= 0) { wins++; gw += t.pl; } else gl += -t.pl; }
  const n = w.trades.length, ret = w.start > 0 ? (eq / w.start - 1) * 100 : 0;
  const bh = w.firstPx > 0 && px > 0 ? (px / w.firstPx - 1) * 100 : 0;
  return {
    equity: eq, returnPct: ret, buyHoldPct: bh, edgePct: ret - bh, maxDDPct: w.maxDD * 100,
    trades: n, wins, winRatePct: n ? (wins / n) * 100 : 0,
    profitFactor: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0, expectancy: n ? sum / n : 0,
    exposurePct: w.marks ? (w.marksInMarket / w.marks) * 100 : 0,
    feesUSD: w.feesUSD, feeDragPct: w.start > 0 ? (w.feesUSD / w.start) * 100 : 0,
    openPl: openPl(w, px), fills: w.fills.length,
  };
}
