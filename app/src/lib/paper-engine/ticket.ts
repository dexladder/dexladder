/**
 * The order ticket as pure decisions: validation, stop arming, and what happens to the part of
 * an order the book could not fill. The presenter (hooks/usePaperEngine) sequences these around
 * the engine; the view only reads fields and prints the outcome.
 */
import type { Side } from './types';

export type TicketType = 'market' | 'limit' | 'stop' | 'stopl';

export interface Ticket {
  readonly type: TicketType | string;
  readonly side: Side;
  readonly sym: string;
  readonly quote: string;
  readonly amt: number;
  /** limit price (limit / stop-limit), 0 when absent */
  readonly limit: number;
  /** trigger price (stop / stop-limit), 0 when absent */
  readonly stop: number;
  readonly tif: string;
  readonly postOnly: boolean;
  readonly reduceOnly: boolean;
  /** slippage tolerance, percent (Advanced mode); absent = the engine's configured tolerance */
  readonly tolerancePct?: number;
}

export const isStopType = (t: string): boolean => t === 'stop' || t === 'stopl';
export const needsLimit = (t: string): boolean => t === 'limit' || t === 'stopl';

/** The first reason this ticket cannot be sent, in the order the ticket reports them; null if it can. */
export function ticketError(t: Ticket, heldBase: number): string | null {
  if (!(t.amt > 0)) return 'Enter an amount greater than zero.';
  if (needsLimit(t.type) && !(t.limit > 0)) return 'Enter a limit price.';
  if (isStopType(t.type) && !(t.stop > 0)) return 'Enter a stop / trigger price.';
  if (t.reduceOnly && t.side === 'buy' && !(heldBase > 0)) return 'Reduce-only: you have no ' + t.sym + ' position to reduce.';
  return null;
}

export interface StopArm {
  readonly type: 'stop' | 'stopl';
  readonly px: number;
  readonly extra: { readonly lim: number; readonly tif: string; readonly post: boolean; readonly reduce: boolean; readonly armAbove: boolean };
}

/** A stop arms above the market when its trigger is above the current price. */
export function armStop(t: Ticket, cur: number): StopArm {
  return {
    type: t.type === 'stop' ? 'stop' : 'stopl',
    px: t.stop,
    extra: { lim: t.limit || 0, tif: t.tif, post: t.postOnly, reduce: t.reduceOnly, armAbove: t.stop > cur },
  };
}

export type Remainder =
  | { readonly kind: 'none' }
  | { readonly kind: 'cancel'; readonly by: 'ioc' | 'book' | 'pool' }
  | { readonly kind: 'rest'; readonly px: number }
  | { readonly kind: 'drop' };

/**
 * The unfilled part of an order. IOC always cancels; a market order that is not GTC cancels when
 * the book runs out; a limit (or any GTC order) rests — at its limit, or 10 bp through mid for a
 * GTC market remainder. On a POOL (Advanced) a market order's remainder is always cancelled: a
 * swap is atomic, and the pool's range has run out — there is no queue to rest in. A limit's
 * remainder rests (GTC) or cancels (IOC) the same as on a book; FOK never gets here.
 */
export function remainder(t: Ticket, rest: number, mid: number, pool = false): Remainder {
  if (!(rest > 1e-9)) return { kind: 'none' };
  // a swap is atomic: what a pool could not supply to a MARKET order is simply not bought (sold)
  if (pool && t.type === 'market') return { kind: 'cancel', by: 'pool' };
  if (t.tif === 'IOC' || (t.type === 'market' && t.tif !== 'GTC')) return { kind: 'cancel', by: t.tif === 'IOC' ? 'ioc' : 'book' };
  if (t.type === 'limit' || t.tif === 'GTC') return { kind: 'rest', px: t.limit || mid * (t.side === 'buy' ? 0.999 : 1.001) };
  return { kind: 'drop' };
}
