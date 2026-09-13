/**
 * Relative Strength Index — Wilder's smoothing (J. Welles Wilder, 1978), the definition every
 * charting platform uses.
 *
 * Before this module the payload carried THREE RSIs that disagreed on the same coin:
 *   - the coin chart: Wilder-smoothed (legacy rsiArr)        ← kept, this is it
 *   - Rungs / Sentinel / heat lens / DeXaI: a plain average of the last 14 changes (Cutler)
 *   - the strategy lab: Wilder with a null warm-up
 * so a coin could read "oversold" on a Rung and 41 on its own chart. There is now one.
 */
import type { Series } from '../math/stats';

/**
 * Full RSI series, same length as the input. Warm-up points carry the first computed value;
 * a series too short to compute reads 50 (neutral) throughout.
 */
export function rsi(vals: Series, period: number): number[] {
  const p = Math.max(1, Math.min(period, Math.max(1, vals.length - 1)));
  const o: number[] = new Array<number>(vals.length).fill(50);
  if (vals.length < 2) return o;
  let g = 0, l = 0;
  for (let i = 1; i <= p && i < vals.length; i++) {
    const d = vals[i]! - vals[i - 1]!;
    if (d >= 0) g += d; else l -= d;
  }
  g /= p; l /= p;
  if (p < vals.length) o[p] = 100 - 100 / (1 + (l === 0 ? 100 : g / l));
  for (let i = p + 1; i < vals.length; i++) {
    const d = vals[i]! - vals[i - 1]!;
    g = (g * (p - 1) + (d > 0 ? d : 0)) / p;
    l = (l * (p - 1) + (d < 0 ? -d : 0)) / p;
    o[i] = 100 - 100 / (1 + (l === 0 ? 100 : g / l));
  }
  const seed = o[Math.min(p, o.length - 1)]!;
  for (let i = 0; i < p && i < o.length; i++) o[i] = seed;
  return o;
}

/**
 * RSI at the latest point, or null when the series cannot support the period
 * (fewer than period + 1 prices). This is what screens, alerts and the copilot read.
 *
 * Same Wilder averages as the chart series; one documented difference at the boundary: with no
 * losses at all in the window the chart's legacy convention caps RS at 100 (RSI 99.01), while a
 * screen reports the textbook value, 100 — which is also what the screens reported before.
 */
export function rsiLast(vals: Series, period = 14): number | null {
  if (!vals || vals.length < period + 1 || period < 1) return null;
  const p = period;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = vals[i]! - vals[i - 1]!; if (d >= 0) g += d; else l -= d; }
  g /= p; l /= p;
  for (let i = p + 1; i < vals.length; i++) {
    const d = vals[i]! - vals[i - 1]!;
    g = (g * (p - 1) + (d > 0 ? d : 0)) / p;
    l = (l * (p - 1) + (d < 0 ? -d : 0)) / p;
  }
  if (!Number.isFinite(g) || !Number.isFinite(l)) return null;
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
