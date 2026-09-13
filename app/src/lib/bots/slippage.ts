/**
 * Slippage, as a desk setting and as a number the desk can print.
 *
 * `backtest.ts` owns the ARITHMETIC (`slipped`): a fill's price moves against its own direction,
 * so a long entered 30 bps higher is already 30 bps nearer its stop. This module owns the two
 * things a desk needs around it — the setting itself (read back, clamped, defaulted) and what the
 * setting actually cost, recovered from the fills it moved.
 *
 * Why one setting for both the backtest and the live run: `backtest.ts`'s header promises that "a
 * backtest and a live run are the same numbers measured on different bars". A backtest that slips
 * and a live run that does not would break that promise silently — the same strategy on the same
 * bars would print two different equity curves and nothing on screen would say why.
 *
 * Pure: no clock, no DOM, no storage. The host reads the number out of the save file and hands it
 * in; this module only says what a number means and refuses the ones that mean nothing.
 */
import type { BotFill } from './types';

/**
 * Zero, and deliberately so. Every bot already saved, every gate assert and every screenshot in
 * the store was measured with no slippage; a non-zero default would silently restate all of them.
 * A trader who wants slippage priced in chooses it, and then owns the difference.
 */
export const DEFAULT_SLIP_BPS = 0;

/**
 * The most slippage the desk will accept, in basis points. 500 bps is 5% against every fill —
 * past that a paper run stops being a pessimistic model of a venue and becomes a different
 * instrument, and the sell side of `slipped` would be dividing by a number approaching zero.
 */
export const MAX_SLIP_BPS = 500;

/** Whatever the field said, as a usable number. Anything unreadable is the default, never NaN. */
export function readSlipBps(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SLIP_BPS;
  return Math.min(MAX_SLIP_BPS, n);
}

/**
 * What the setting actually cost, in quote, recovered from the fills it moved.
 *
 * `slipped` multiplied the price, so the untouched price is recovered by dividing — a buy paid
 * `px / (1 + k)` before slippage, a sell received `px / (1 - k)`. The difference per fill, times
 * the quantity, is the concession. This is exact for every fill taken at this setting; it is NOT
 * a re-run of the strategy, and it does not claim to be the difference in FINAL equity, because
 * a worse fill also changes which stops fire and when — that difference is only knowable by
 * running the strategy again at 0 bps, which is a second backtest, not a subtraction.
 */
export function slipCost(fills: readonly BotFill[], bps: number): number {
  const k = readSlipBps(bps) / 10_000;
  if (!k) return 0;
  let sum = 0;
  for (const f of fills) {
    const clean = f.side === 'buy' ? f.px / (1 + k) : f.px / (1 - k);
    sum += Math.abs(f.qty * (f.px - clean));
  }
  return sum;
}

/** The sentence under the figure — what the setting is doing, then what it cost. */
export function slipNote(bps: number, cost: number, fills: number): string {
  const n = readSlipBps(bps);
  if (!n) return 'Slippage is off (0 bps): every fill prints at the bar’s own price. Turn it on to price in the gap between the quote you saw and the fill you got — the same number is used by the backtest and by a live run, so the two stay comparable.';
  return n.toFixed(0) + ' bps against every fill — a buy pays ' + (n / 100).toFixed(2) + '% more, a sell receives ' + (n / 100).toFixed(2) + '% less. Over ' + fills + ' fill(s) that conceded ' + cost.toFixed(2) + ' USDT of price. It moves the price, not a fee at the end, so the basis, the stop distance and the trailing high are all quoted from the price the bot was actually filled at.';
}
