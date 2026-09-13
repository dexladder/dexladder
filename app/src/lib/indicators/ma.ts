/**
 * Moving averages. Arithmetic order matches the legacy payload's emaArr/smaArr exactly, so
 * swapping the legacy call sites onto these functions is bit-identical (pinned by
 * test/indicators.parity.test.ts, which runs the legacy source side by side).
 */
import type { Series } from '../math/stats';

/** Clamp a period into [1, n] the way every legacy caller expected. */
export function clampPeriod(p: number, n: number): number {
  return Math.max(1, Math.min(p, n));
}

/**
 * Exponential moving average, seeded with the first value (k = 2 / (p + 1)).
 * Output has the same length as the input. Empty in → empty out.
 */
export function ema(vals: Series, period: number): number[] {
  if (!vals.length) return [];
  const p = clampPeriod(period, vals.length);
  const k = 2 / (p + 1);
  let e = vals[0]!;
  const o = [e];
  for (let i = 1; i < vals.length; i++) { e = vals[i]! * k + e * (1 - k); o.push(e); }
  return o;
}

/**
 * Simple moving average with a pass-through warm-up: points before the first full window
 * carry the raw value, so a chart overlay starts on the price instead of at zero.
 */
export function sma(vals: Series, period: number): number[] {
  if (!vals.length) return [];
  const p = clampPeriod(period, vals.length);
  const o: number[] = [];
  let s = 0;
  for (let i = 0; i < vals.length; i++) {
    s += vals[i]!;
    if (i >= p) s -= vals[i - p]!;
    o.push(i >= p - 1 ? s / p : vals[i]!);
  }
  return o;
}

/** Mean of the last n values; null when fewer than n exist. */
export function smaLast(a: Series, n: number): number | null {
  if (a.length < n || n < 1) return null;
  let s = 0;
  for (let i = a.length - n; i < a.length; i++) s += a[i]!;
  return s / n;
}
