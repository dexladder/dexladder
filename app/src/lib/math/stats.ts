/**
 * Descriptive statistics — pure, total, allocation-light.
 *
 * Contract for every function here:
 *   - never throws on short or empty input; returns the documented neutral value instead
 *   - never mutates its arguments
 *   - no I/O, no clock, no randomness
 */

export type Series = readonly number[];

export function sum(a: Series): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]!;
  return s;
}

/** Arithmetic mean. 0 for an empty series. */
export function mean(a: Series): number {
  return a.length ? sum(a) / a.length : 0;
}

/**
 * Sample standard deviation (n − 1 denominator). 0 below two points.
 * Two-pass with `reduce` in the same order as the legacy DLCORE.stdev, so results are
 * bit-identical to what the shipped layers computed.
 */
export function stdev(a: Series): number {
  if (a.length < 2) return 0;
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  const v = a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1);
  return Math.sqrt(v);
}

/** Simple returns p[i]/p[i−1] − 1, skipping any pair with a non-positive price. */
export function returns(px: Series): number[] {
  const o: number[] = [];
  for (let i = 1; i < px.length; i++) {
    const a = px[i - 1]!, b = px[i]!;
    if (a > 0 && b > 0) o.push(b / a - 1);
  }
  return o;
}

/** Log returns ln(p[i]/p[i−1]), skipping any pair with a non-positive price (legacy DLCORE.logRets). */
export function logReturns(px: Series): number[] {
  const o: number[] = [];
  for (let i = 1; i < px.length; i++) {
    const a = px[i - 1]!, b = px[i]!;
    if (a > 0 && b > 0) o.push(Math.log(b / a));
  }
  return o;
}

export interface Drawdown {
  /** Largest peak-to-trough fall as a positive fraction (0.25 = −25%). */
  readonly maxDD: number;
  readonly peakIndex: number;
  readonly troughIndex: number;
}

/** Maximum drawdown of an equity or price curve. {0,-1,-1} when the curve never falls. */
export function maxDrawdown(curve: Series): Drawdown {
  let peak = -Infinity, peakAt = -1, best = 0, bp = -1, bt = -1;
  for (let i = 0; i < curve.length; i++) {
    const v = curve[i]!;
    if (v > peak) { peak = v; peakAt = i; }
    if (peak > 0) {
      const dd = (peak - v) / peak;
      if (dd > best) { best = dd; bp = peakAt; bt = i; }
    }
  }
  return { maxDD: best, peakIndex: bp, troughIndex: bt };
}

/** Annualised Sharpe ratio of periodic returns. null when volatility is zero or data is short. */
export function sharpe(rets: Series, periodsPerYear: number, riskFreePerPeriod = 0): number | null {
  if (rets.length < 2) return null;
  const ex = rets.map(r => r - riskFreePerPeriod);
  const sd = stdev(ex);
  return sd > 0 ? (mean(ex) / sd) * Math.sqrt(periodsPerYear) : null;
}

/** Annualised Sortino ratio (downside deviation against a 0 target). */
export function sortino(rets: Series, periodsPerYear: number): number | null {
  if (rets.length < 2) return null;
  let d = 0;
  for (const r of rets) if (r < 0) d += r * r;
  const dd = Math.sqrt(d / rets.length);
  return dd > 0 ? (mean(rets) / dd) * Math.sqrt(periodsPerYear) : null;
}

/** Pearson correlation over the overlapping tail of two series. null below 3 points or on zero variance. */
export function correlation(a: Series, b: Series): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const x = a.slice(a.length - n), y = b.slice(b.length - n);
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx, dy = y[i]! - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Linear-interpolated percentile, q in [0,1]. NaN for an empty series. */
export function percentile(a: Series, q: number): number {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const pos = clamp(q, 0, 1) * (s.length - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Brier score for one forecast: (p − outcome)². */
export function brier(p: number, hit: boolean): number {
  return Math.pow(p - (hit ? 1 : 0), 2);
}
