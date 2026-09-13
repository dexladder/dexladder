/**
 * What a finished (or running) replay is worth, measured the way a desk measures it. Every figure
 * comes from the equity curve the engine marked at each bar close, or from closed trades — never
 * from a price the run had not reached.
 */
import { barsPerYear, type IntervalId } from './candles';
import type { BtState, BtTrade, Candle } from './types';

export interface Metrics {
  readonly start: number;
  readonly equity: number;
  readonly returnPct: number;
  readonly buyHoldPct: number;
  readonly edgePct: number;
  readonly maxDDPct: number;
  /** longest run of bars below the previous peak */
  readonly ddBars: number;
  readonly trades: number;
  readonly wins: number;
  readonly winRatePct: number;
  readonly profitFactor: number;
  /** average P&L per closed trade, quote */
  readonly expectancy: number;
  readonly avgWin: number;
  readonly avgLoss: number;
  readonly sharpe: number;
  readonly exposurePct: number;
  readonly feesUSD: number;
  readonly feeDragPct: number;
  readonly fills: number;
  readonly bars: number;
  /** unrealised P&L of an open position at the last close */
  readonly openPl: number;
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

export function drawdownBars(equity: readonly number[]): number {
  let peak = -Infinity, run = 0, worst = 0;
  for (const e of equity) {
    if (e >= peak) { peak = e; run = 0; } else { run++; if (run > worst) worst = run; }
  }
  return worst;
}

/** Sharpe from per-bar equity returns, annualised by the bars in a year (risk-free 0). */
export function sharpe(equity: readonly number[], interval: IntervalId): number {
  if (equity.length < 3) return 0;
  const r: number[] = [];
  for (let i = 1; i < equity.length; i++) { const p = equity[i - 1]!; if (p > 0) r.push(equity[i]! / p - 1); }
  if (r.length < 2) return 0;
  const m = sum(r) / r.length, sd = Math.sqrt(sum(r.map(x => (x - m) ** 2)) / (r.length - 1));
  return sd > 0 ? (m / sd) * Math.sqrt(barsPerYear(interval)) : 0;
}

export function tradeStats(trades: readonly BtTrade[]): { wins: number; grossWin: number; grossLoss: number } {
  let wins = 0, grossWin = 0, grossLoss = 0;
  for (const t of trades) { if (t.pl >= 0) { wins++; grossWin += t.pl; } else grossLoss += -t.pl; }
  return { wins, grossWin, grossLoss };
}

export function metrics(s: BtState, bars: readonly Candle[], interval: IntervalId): Metrics {
  const last = bars[s.i], eq = s.equity[s.equity.length - 1] ?? s.start;
  const first = bars[0], bh = first && last && first.o > 0 ? (last.c / first.o - 1) * 100 : 0;
  const { wins, grossWin, grossLoss } = tradeStats(s.trades);
  const n = s.trades.length, losses = n - wins;
  return {
    start: s.start,
    equity: eq,
    returnPct: s.start > 0 ? (eq / s.start - 1) * 100 : 0,
    buyHoldPct: bh,
    edgePct: (s.start > 0 ? (eq / s.start - 1) * 100 : 0) - bh,
    maxDDPct: s.maxDD * 100,
    ddBars: drawdownBars(s.equity),
    trades: n, wins,
    winRatePct: n ? (wins / n) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    expectancy: n ? sum(s.trades.map(t => t.pl)) / n : 0,
    avgWin: wins ? grossWin / wins : 0,
    avgLoss: losses ? grossLoss / losses : 0,
    sharpe: sharpe(s.equity, interval),
    exposurePct: s.equity.length ? (s.barsInMarket / s.equity.length) * 100 : 0,
    feesUSD: s.feesUSD,
    feeDragPct: s.start > 0 ? (s.feesUSD / s.start) * 100 : 0,
    fills: s.fills.length,
    bars: s.equity.length,
    openPl: last && s.qty > 0 ? s.qty * last.c - s.cost : 0,
  };
}
