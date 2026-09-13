/**
 * Screening and momentum signals — one set of thresholds for every surface that screens.
 *
 * Before: Rungs said "oversold < 35 / overbought > 70", DeXaI's lens said "< 35 / > 65" for the
 * same words. A user asking the copilot for overbought coins got a different list from the
 * Overbought rung. The Rung thresholds are printed to users, so they are the ones kept.
 */
import type { Series } from '../math/stats';
import { rsiLast } from './rsi';
import { smaLast } from './ma';

export const RSI_PERIOD = 14;
export const RSI_OVERSOLD = 35;
export const RSI_OVERBOUGHT = 70;

export function isOversold(spark: Series): boolean {
  const r = rsiLast(spark, RSI_PERIOD);
  return r != null && r < RSI_OVERSOLD;
}

export function isOverbought(spark: Series): boolean {
  const r = rsiLast(spark, RSI_PERIOD);
  return r != null && r > RSI_OVERBOUGHT;
}

/** True on the bar where `a` closes above `b` having been at or below it on the previous bar. */
export function crossAbove(prevA: number, prevB: number, a: number, b: number): boolean {
  return prevA <= prevB && a > b;
}

export function crossBelow(prevA: number, prevB: number, a: number, b: number): boolean {
  return prevA >= prevB && a < b;
}

export type Trend = 'up' | 'down' | 'flat';

/**
 * Trend by fast/slow mean of the tail: 'up' when the fast mean is above the slow mean by more
 * than `band` (fraction), 'down' when below, else 'flat'. null without enough data.
 */
export function trend(vals: Series, fast = 12, slow = 48, band = 0.002): Trend | null {
  const f = smaLast(vals, fast), s = smaLast(vals, slow);
  if (f == null || s == null || !(s > 0)) return null;
  const d = f / s - 1;
  return d > band ? 'up' : d < -band ? 'down' : 'flat';
}

/**
 * Momentum score in [-100, 100]: RSI distance from 50 blended with the tail's trend.
 * Deterministic and explainable — the formula is the documentation.
 */
export function momentumScore(vals: Series): number | null {
  const r = rsiLast(vals, RSI_PERIOD);
  const t = trend(vals);
  if (r == null || t == null) return null;
  const tv = t === 'up' ? 1 : t === 'down' ? -1 : 0;
  return Math.round(((r - 50) / 50) * 70 + tv * 30);
}
