/**
 * Isolated-margin arithmetic for a linear (USDT-margined) perpetual. One sign convention
 * everywhere: dir = +1 long, −1 short.
 *
 *   uPnL          = (mark − entry) × qty × dir
 *   equity        = margin + uPnL
 *   maintenance   = mark × qty × mmr − cum
 *   margin ratio  = maintenance ÷ equity            (≥ 100% → liquidation)
 *   liquidation   equity = maintenance, solved for the mark:
 *                   long  (E·q − M − cum) ÷ (q·(1 − mmr))
 *                   short (E·q + M + cum) ÷ (q·(1 + mmr))
 *   bankruptcy    equity = 0:  long E − M/q,  short E + M/q
 */
import type { PerpPosition, PerpSide } from './types';

export type Shape = Pick<PerpPosition, 'side' | 'qty' | 'entry' | 'margin' | 'mmr' | 'cum'>;

export const dir = (side: PerpSide): 1 | -1 => (side === 'long' ? 1 : -1);

export function uPnl(p: Shape, mark: number): number { return (mark - p.entry) * p.qty * dir(p.side); }
export function equity(p: Shape, mark: number): number { return p.margin + uPnl(p, mark); }
export function maintenance(p: Shape, mark: number): number { return Math.max(0, mark * p.qty * p.mmr - p.cum); }
export function notional(p: Pick<PerpPosition, 'qty'>, mark: number): number { return p.qty * mark; }

/** maintenance ÷ equity; Infinity once equity is gone. */
export function marginRatio(p: Shape, mark: number): number {
  const e = equity(p, mark);
  return e > 0 ? maintenance(p, mark) / e : Infinity;
}

/** Return on the margin, percent. */
export function roe(p: Shape, mark: number): number { return p.margin > 0 ? (uPnl(p, mark) / p.margin) * 100 : 0; }

export function liqPrice(p: Shape): number {
  const { qty: q, entry: E, margin: M, mmr, cum } = p;
  if (!(q > 0)) return 0;
  const px = p.side === 'long' ? (E * q - M - cum) / (q * (1 - mmr)) : (E * q + M + cum) / (q * (1 + mmr));
  return Math.max(0, px);
}

export function bankruptcyPrice(p: Shape): number {
  return p.qty > 0 ? Math.max(0, p.side === 'long' ? p.entry - p.margin / p.qty : p.entry + p.margin / p.qty) : 0;
}

/** Has the mark crossed the liquidation price? */
export function breached(p: Shape, mark: number): boolean {
  if (!(mark > 0)) return false;
  const L = liqPrice(p);
  return p.side === 'long' ? mark <= L : mark >= L;
}

/** How far the mark may move against the position before liquidation, percent of the mark. */
export function distancePct(p: Shape, mark: number): number {
  if (!(mark > 0)) return 0;
  const L = liqPrice(p);
  return (p.side === 'long' ? (mark - L) / mark : (L - mark) / mark) * 100;
}

/** The largest margin that can be withdrawn and still leave the position at its initial-margin level. */
export function removableMargin(p: Shape & { readonly lev: number }, mark: number): number {
  const initial = (p.qty * p.entry) / p.lev;
  return Math.max(0, Math.min(p.margin - initial, equity(p, mark) - initial));
}
