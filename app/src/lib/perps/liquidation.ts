/**
 * What happens to an open position at a new mark, and — when the answer is "liquidated" — why,
 * in words a beginner can act on next time.
 *
 * Order of events at one mark (a price that jumped since the last tick is treated as having
 * travelled continuously): a stop-loss that sits before the liquidation price fires first; a
 * take-profit fires when reached; otherwise, once the mark crosses the liquidation price, the
 * liquidation engine closes the position. Stops and liquidations fill at the MARK — in a gap that
 * is worse than the level (the spot desk's Advanced gap rule, applied to perps in both modes).
 */
import { bankruptcyPrice, breached, equity, liqPrice, type Shape } from './margin';
import { fmt0 } from './position';
import type { CloseReason, PerpPosition } from './types';

export function triggerAt(p: PerpPosition, mark: number): Exclude<CloseReason, 'manual'> | null {
  if (!(mark > 0)) return null;
  const long = p.side === 'long', L = liqPrice(p);
  if (p.sl && (long ? mark <= p.sl && p.sl > L : mark >= p.sl && p.sl < L)) return 'stop-loss';
  if (breached(p, mark)) return 'liquidation';
  if (p.tp && (long ? mark >= p.tp : mark <= p.tp)) return 'take-profit';
  return null;
}

export interface Alternative {
  readonly label: string;
  readonly text: string;
  /** would the position still be open at the mark that liquidated it? (null: not a survival question) */
  readonly survives: boolean | null;
}

export interface PostMortem {
  readonly headline: string;
  /** what happened, in order */
  readonly facts: readonly string[];
  /** three things that would have changed the outcome */
  readonly alternatives: readonly Alternative[];
}

type F = (n: number) => string;
const pct = (x: number): string => (Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2)) + '%';

/**
 * The post-mortem of a liquidation at `mark`. `f` formats a price; money is USDT to 2 dp.
 * Counterfactuals keep the SAME margin and the same path, and ask only: at the price that
 * liquidated you, would this change have kept you in?
 */
export function postMortem(p: PerpPosition, mark: number, f: F = fmt0): PostMortem {
  const long = p.side === 'long', L = liqPrice(p), move = Math.abs(L - p.entry) / p.entry * 100;
  const eq = equity(p, mark), usd = (n: number) => Math.abs(n).toFixed(2) + ' USDT';
  const facts: string[] = [
    `You opened a ${p.lev}× ${p.side} on ${p.sym} at ${f(p.entry)} with ${usd(p.margin + p.funding)} of margin — a ${usd(p.qty * p.entry)} position.`,
    `At ${p.lev}× a ${pct(100 / p.lev)} move ${long ? 'down' : 'up'} erases the margin. The venue does not wait for zero: it liquidates when what is left falls to the maintenance margin (${pct(p.mmr * 100)} of the position), so your liquidation price was ${f(L)} — only ${pct(move)} away.`,
  ];
  if (Math.abs(p.funding) > 0.005) {
    const before = liqPrice({ ...p, margin: p.margin + p.funding });
    facts.push(p.funding > 0
      ? `Funding cost you ${usd(p.funding)} while you held it. It came out of the margin, which moved the liquidation price from ${f(before)} to ${f(L)}.`
      : `Funding paid you ${usd(p.funding)} while you held it, which moved the liquidation price from ${f(before)} to ${f(L)} — it was not enough.`);
  }
  facts.push(eq >= 0
    ? `The mark reached ${f(mark)}. The liquidation engine closed the position; the ${usd(eq)} still in its margin went to the insurance fund as the liquidation fee.`
    : `The price gapped to ${f(mark)}, past your bankruptcy price (${f(bankruptcyPrice(p))}). Isolated margin capped your loss at the margin; the ${usd(-eq)} shortfall was covered by the insurance fund.`);
  facts.push(`Total cost of the trade: ${usd(p.cashIn)} (margin, fees and funding). None of it comes back.`);

  const stop = long ? p.entry - (p.entry - L) / 2 : p.entry + (L - p.entry) / 2;
  const stopLoss = p.qty * Math.abs(p.entry - stop) + p.openFee + p.qty * stop * p.takerFee + Math.max(0, p.funding);
  const lower = Math.max(1, Math.min(3, p.lev - 1)), qLow = (p.qty * lower) / p.lev;
  const low: Shape = { ...p, qty: qLow };
  const more: Shape = { ...p, margin: p.margin * 2 };
  return {
    headline: `Liquidated — ${p.sym} ${p.lev}× ${p.side}`,
    facts,
    alternatives: [
      { label: 'A stop-loss', survives: null,
        text: `A stop at ${f(stop)} (half-way to liquidation) would have closed you for about ${usd(stopLoss)} instead of ${usd(p.cashIn)}. A stop is a choice you make; a liquidation is made for you — and costs more.` },
      { label: `${lower}× instead of ${p.lev}×`, survives: !breached(low, mark),
        text: `Same margin at ${lower}× puts liquidation at ${f(liqPrice(low))} (${pct(Math.abs(liqPrice(low) - p.entry) / p.entry * 100)} away)` + (breached(low, mark) ? ' — even that would not have survived this move.' : ` — this move to ${f(mark)} would not have liquidated you.`) },
      { label: 'Twice the margin', survives: !breached(more, mark),
        text: `Adding ${usd(p.margin)} of margin to the same position moves liquidation to ${f(liqPrice(more))}` + (breached(more, mark) ? ' — still not enough for this move.' : ' — enough to ride this move out.') },
    ],
  };
}
