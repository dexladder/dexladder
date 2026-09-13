/**
 * Candles from the public market-data endpoints the payload already uses for price history,
 * parsed and sanitised. Pure: the adapter fetches, this decides what is usable.
 */
import type { Candle } from './types';

export const INTERVALS = Object.freeze({ '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 });
export type IntervalId = keyof typeof INTERVALS;
export const isInterval = (x: string): x is IntervalId => Object.prototype.hasOwnProperty.call(INTERVALS, x);

const ok = (c: Candle): boolean =>
  c.t > 0 && c.o > 0 && c.h > 0 && c.l > 0 && c.c > 0 && c.h >= Math.max(c.o, c.c) - 1e-9 && c.l <= Math.min(c.o, c.c) + 1e-9;

/** Sort by time, drop repeats and anything malformed, keep the window [from, to]. */
export function sanitize(cs: readonly Candle[], from = 0, to = Infinity): Candle[] {
  const seen = new Set<number>(), out: Candle[] = [];
  for (const c of cs.slice().sort((a, b) => a.t - b.t)) {
    if (!ok(c) || seen.has(c.t) || c.t < from || c.t > to) continue;
    seen.add(c.t); out.push(c);
  }
  return out;
}

/** Binance klines: [openTime, open, high, low, close, volume, …] */
export function binanceCandles(rows: unknown): Candle[] {
  if (!Array.isArray(rows)) return [];
  return sanitize(rows.filter(Array.isArray).map(r => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] || 0 })));
}

/** Kraken OHLC: {result:{PAIR:[[time(s), o, h, l, c, vwap, volume, count]], last}} */
export function krakenCandles(j: unknown): Candle[] {
  const res = j && typeof j === 'object' ? (j as { result?: Record<string, unknown> }).result : undefined;
  if (!res) return [];
  const key = Object.keys(res).find(k => k !== 'last');
  const rows = key ? res[key] : null;
  if (!Array.isArray(rows)) return [];
  return sanitize(rows.filter(Array.isArray).map(r => ({ t: +r[0] * 1000, o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[6] || 0 })));
}

/** Coinbase candles: [[time(s), low, high, open, close, volume]], newest first */
export function coinbaseCandles(rows: unknown): Candle[] {
  if (!Array.isArray(rows)) return [];
  return sanitize(rows.filter(Array.isArray).map(r => ({ t: +r[0] * 1000, o: +r[3], h: +r[2], l: +r[1], c: +r[4], v: +r[5] || 0 })));
}

/** How many bars of `interval` a window holds (for a request limit). */
export function barsIn(fromMs: number, toMs: number, interval: IntervalId): number {
  return Math.max(0, Math.ceil((toMs - fromMs) / INTERVALS[interval]));
}

/** Bars per year at this interval — the annualisation factor for Sharpe. */
export function barsPerYear(interval: IntervalId): number { return 31_557_600_000 / INTERVALS[interval]; }

/** A gap of more than two intervals between consecutive bars (a venue outage, a delisting). */
export function gaps(cs: readonly Candle[], interval: IntervalId): number {
  let n = 0;
  for (let i = 1; i < cs.length; i++) if (cs[i]!.t - cs[i - 1]!.t > INTERVALS[interval] * 2.5) n++;
  return n;
}
