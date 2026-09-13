/**
 * MEV — the sandwich attack, simulated (Advanced mode, on-chain swaps only, off unless the trader
 * turns the bots on).
 *
 * A market swap sent through the public mempool announces its size and its slippage tolerance.
 * A bot that sees it buys first (the FRONT-run) to push the price toward the worst price the
 * victim still accepts, lets the victim's swap execute at that worse price, then sells straight
 * back (the BACK-run). The victim still "fills within tolerance" — the tolerance was the bot's
 * budget.
 *
 * The bot is rational, not random: it attacks only when
 *   · the victim's tolerance is wide (> MEV_MIN_TOLERANCE_PCT — below that there is little room), and
 *   · the attack pays: back-run proceeds − front-run cost − pool fees on both legs − its own gas
 *     for two swaps at High priority > 0.
 * So "meaningful size" is not a magic number: it is the size at which your tolerance is worth
 * more than the bot's gas. It then takes the largest front-run that keeps the victim inside
 * tolerance — the victim fills at (essentially) the worst price inside it.
 *
 * Pure: the pool is the exact curve the victim would have met (amm.ts); nothing random.
 */
import type { Side } from './types';
import { swap, atPrice, type Pool, type Swap } from './amm';
import type { MevFacts } from './match';

export const MEV_MIN_TOLERANCE_PCT = 2;
/** how close to the tolerance edge the bot aims (it must stay strictly inside to not revert the victim) */
const EDGE = 1 - 1e-6;

export interface Sandwich {
  /** the bot's first swap (same side as the victim) */
  readonly front: Swap;
  /** the victim's swap, on the pool the front-run left */
  readonly victim: Swap;
  /** the bot's closing swap (opposite side), on the pool the victim left */
  readonly back: Swap;
  /** what the victim's swap would have been with no bot */
  readonly clean: Swap;
  /** the bot's net, after both legs' pool fees and its gas (quote) */
  readonly botProfitQuote: number;
  /** what the sandwich cost the victim (quote) */
  readonly extraQuote: number;
}

const other = (s: Side): Side => (s === 'buy' ? 'sell' : 'buy');

/**
 * Would a bot sandwich this swap, and how? `p0` is the price the victim was QUOTED (tolerance is
 * measured from it); `pool` is the pool the swap executes on. `feeRate` is the pool fee both bot
 * legs pay; `botGasQuote` is the bot's gas for its two swaps. Null = no attack.
 */
export function sandwich(pool: Pool, side: Side, qty: number, p0: number, tolerancePct: number, feeRate: number, botGasQuote: number): Sandwich | null {
  if (!(qty > 0 && p0 > 0) || !(tolerancePct > MEV_MIN_TOLERANCE_PCT)) return null;
  const clean = swap(pool, side, qty);
  if (clean.exhausted || !(clean.filled > 0)) return null;
  const bound = p0 * (1 + (side === 'buy' ? 1 : -1) * (tolerancePct / 100) * EDGE);
  const inside = (v: Swap) => !v.exhausted && v.filled >= qty * (1 - 1e-9) && (side === 'buy' ? v.avg <= bound : v.avg >= bound);
  const at = (f: number) => { const front = swap(pool, side, f); return { front, victim: swap(atPrice(pool, front.p1), side, qty) }; };
  if (!inside(clean)) return null;
  // largest front-run that keeps the victim inside tolerance (monotone in f): grow, then bisect
  let lo = 0, hi = qty;
  for (let i = 0; i < 80 && inside(at(hi).victim) && !at(hi).front.exhausted; i++) { lo = hi; hi *= 2; }
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (inside(at(mid).victim) && !at(mid).front.exhausted) lo = mid; else hi = mid; }
  if (!(lo > 0)) return null;
  const { front, victim } = at(lo);
  const back = swap(atPrice(pool, victim.p1), other(side), front.filled);
  const gross = side === 'buy' ? back.quote * (1 - feeRate) - front.quote * (1 + feeRate) : front.quote * (1 - feeRate) - back.quote * (1 + feeRate);
  const botProfitQuote = gross - Math.max(0, botGasQuote);
  if (!(botProfitQuote > 0)) return null;
  const extraQuote = side === 'buy' ? victim.quote - clean.quote : clean.quote - victim.quote;
  return { front, victim, back, clean, botProfitQuote, extraQuote };
}

/** The sentence the trader sees, verbatim first line, then the numbers. */
export const SANDWICH_ALERT = 'You were sandwiched by a simulated MEV bot. In real trading this is why low slippage + private RPC matters.';

/** Plain English for a sandwich that happened (the facts a fill carries). */
export function explainMev(s: MevFacts, fmtQuote: (x: number) => string, tolText: string): string {
  return `${SANDWICH_ALERT} A bot saw your swap in the public mempool, traded just before it to push the price to the edge of your ${tolText} tolerance, ` +
    `and traded straight back after it. It cost you ${fmtQuote(s.extraQuote)}; the bot kept ${fmtQuote(s.botProfitQuote)} after its gas. ` +
    `A tighter tolerance leaves it no room.`;
}
