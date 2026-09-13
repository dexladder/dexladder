/** Volatility bands and range indicators. Output arrays are input-length; warm-up points are null. */
import type { Series } from '../math/stats';

export interface Bands { readonly mid: (number | null)[]; readonly upper: (number | null)[]; readonly lower: (number | null)[] }

/** Bollinger Bands (period, k·σ) with the population σ of each window (Bollinger's own definition). */
export function bollinger(vals: Series, period = 20, k = 2): Bands {
  const mid: (number | null)[] = [], upper: (number | null)[] = [], lower: (number | null)[] = [];
  for (let i = 0; i < vals.length; i++) {
    if (i < period - 1) { mid.push(null); upper.push(null); lower.push(null); continue; }
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += vals[j]!;
    const m = s / period;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (vals[j]! - m) ** 2;
    const sd = Math.sqrt(v / period);
    mid.push(m); upper.push(m + k * sd); lower.push(m - k * sd);
  }
  return { mid, upper, lower };
}

export interface Ohlc { readonly h: number; readonly l: number; readonly c: number }

/** Average True Range, Wilder-smoothed. */
export function atr(bars: readonly Ohlc[], period = 14): (number | null)[] {
  const out: (number | null)[] = [];
  let prevC: number | null = null, acc = 0, a: number | null = null;
  bars.forEach((b, i) => {
    const tr = prevC == null ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - prevC), Math.abs(b.l - prevC));
    prevC = b.c;
    if (i < period) { acc += tr; a = i === period - 1 ? acc / period : null; }
    else a = ((a as number) * (period - 1) + tr) / period;
    out.push(a);
  });
  return out;
}

/** Stochastic %K over a close series (no highs/lows available on sparklines). */
export function stochasticK(vals: Series, period = 14): (number | null)[] {
  return vals.map((v, i) => {
    if (i < period - 1) return null;
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) { hi = Math.max(hi, vals[j]!); lo = Math.min(lo, vals[j]!); }
    return hi > lo ? ((v - lo) / (hi - lo)) * 100 : 50;
  });
}

/** Rate of change over n periods, in percent. null in warm-up or across a zero price. */
export function roc(vals: Series, n = 12): (number | null)[] {
  return vals.map((v, i) => (i < n || !(vals[i - n]! > 0) ? null : (v / vals[i - n]! - 1) * 100));
}
