import type { Series } from '../math/stats';
import { ema } from './ma';

export interface Macd { readonly line: number[]; readonly sig: number[]; readonly hist: number[] }

/** MACD(fast, slow, signal) — defaults 12/26/9. Same arithmetic as the legacy macdArr. */
export function macd(vals: Series, fast = 12, slow = 26, signal = 9): Macd {
  const f = ema(vals, fast), s = ema(vals, slow);
  const line = vals.map((_, i) => f[i]! - s[i]!);
  const sig = ema(line, signal);
  return { line, sig, hist: line.map((v, i) => v - sig[i]!) };
}
