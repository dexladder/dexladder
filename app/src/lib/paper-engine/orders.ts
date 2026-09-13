/**
 * Resting-order logic as pure decisions. The caller owns the loop, the fills and the effects;
 * these functions only answer "does this order act at this price, and how".
 *
 * Order types:
 *   limit  — buy at or below / sell at or above px
 *   sl/tp  — protective sell below / above px
 *   tsl    — trailing stop: px trails the high-water mark by `trail`% (default 5)
 *   stop   — market order armed at px (armAbove: triggers on a rise, else on a fall)
 *   stopl  — stop that becomes a resting limit at `lim` when triggered
 *   twap   — a parent order worked in slices (lib/paper-engine/algo.ts); it never triggers itself
 * Two orders that carry the same `oco` group are ONE-CANCELS-THE-OTHER: when one fills, the other
 * is cancelled — or, if the fill was partial, reduced by what filled.
 * A limit that carries `qAhead` sits in a queue: it fills only after the tape has printed the
 * quantity resting ahead of it at that price.
 */
import type { Side } from './types';

export interface RestingOrder {
  readonly id: string;
  readonly type: 'limit' | 'sl' | 'tp' | 'tsl' | 'stop' | 'stopl' | string;
  readonly side: Side;
  readonly sym: string;
  readonly quote: string;
  readonly qty: number;
  readonly px: number;
  readonly hw?: number;
  readonly trail?: number;
  readonly lim?: number;
  readonly armAbove?: boolean;
  readonly qAhead?: number | null;
  /** one-cancels-the-other group: legs that share it are a single decision */
  readonly oco?: string;
  readonly q0?: number;
  readonly orig?: number;
}

export type Trigger =
  | { readonly hit: false; readonly hw?: number; readonly px?: number }
  | { readonly hit: true; readonly side: Side; readonly px: number; readonly hw?: number };

/**
 * Legacy trigger rule for limit / sl / tp / tsl at price `cur`. For a trailing stop the new
 * high-water mark and stop price are returned whether or not it fires, so the caller can persist
 * them. Fills happen AT the order price (legacy behaviour — a gap through the level is not modelled).
 */
export function trigger(o: RestingOrder, cur: number): Trigger {
  switch (o.type) {
    case 'limit': return (o.side === 'buy' ? cur <= o.px : cur >= o.px) ? { hit: true, side: o.side, px: o.px } : { hit: false };
    case 'sl': return cur <= o.px ? { hit: true, side: 'sell', px: o.px } : { hit: false };
    case 'tp': return cur >= o.px ? { hit: true, side: 'sell', px: o.px } : { hit: false };
    case 'tsl': {
      const hw = cur > (o.hw || 0) ? cur : o.hw;
      const px = (hw || cur) * (1 - (o.trail || 5) / 100);
      const upd = hw !== o.hw ? { hw: hw as number, px } : { px };
      return cur <= px ? { hit: true, side: 'sell', ...upd } : { hit: false, ...upd };
    }
    default: return { hit: false };
  }
}

export interface OcoEffect {
  /** ids to remove outright */
  readonly cancel: readonly string[];
  /** ids whose size must shrink, with their new size (a partial fill on one leg) */
  readonly reduce: readonly { readonly id: string; readonly qty: number }[];
}

/**
 * What happens to the other legs when `filledId` trades `filledQty`. A leg reduced to nothing is
 * cancelled, not left as dust. Orders outside the group are never touched.
 */
export function ocoEffect(orders: readonly RestingOrder[], filledId: string, filledQty: number): OcoEffect {
  const me = orders.find(o => o.id === filledId);
  if (!me || !me.oco) return { cancel: [], reduce: [] };
  const cancel: string[] = [], reduce: { id: string; qty: number }[] = [];
  const full = filledQty >= me.qty - 1e-9;
  for (const o of orders) {
    if (o.id === filledId || o.oco !== me.oco) continue;
    const left = full ? 0 : o.qty - filledQty;
    if (left <= 1e-9) cancel.push(o.id); else reduce.push({ id: o.id, qty: left });
  }
  return { cancel, reduce };
}

/** Quantity a triggered order may actually trade: sells are capped at what is held. */
export function tradableQty(o: RestingOrder, side: Side, held: number): number {
  return side === 'sell' ? Math.min(o.qty, held) : o.qty;
}

/** Has price reached a stop's trigger? */
export function stopHit(o: RestingOrder, cur: number): boolean {
  return o.armAbove ? cur >= o.px : cur <= o.px;
}

/** Is a limit's price touched (the queue can only move while it is)? */
export function limitTouched(o: RestingOrder, cur: number): boolean {
  return o.side === 'buy' ? cur <= o.px : cur >= o.px;
}

export type QueueStep =
  | { readonly kind: 'idle' }
  | { readonly kind: 'wait'; readonly qAhead: number }
  | { readonly kind: 'fill'; readonly take: number; readonly qAhead: number };

/**
 * Advance a queued limit by `flow` base units of tape. While quantity is ahead of us it drains;
 * once we are at the front we take max(flow, 12% of our size) per step (a minimum crawl so a thin
 * tape still fills eventually), capped at what is left.
 */
export function stepQueue(o: RestingOrder, cur: number, flow: number): QueueStep {
  if (!limitTouched(o, cur)) return { kind: 'idle' };
  let qAhead = o.qAhead || 0, f = flow;
  if (qAhead > 0) {
    qAhead = Math.max(0, qAhead - f);
    if (qAhead > 0) return { kind: 'wait', qAhead };
    f = 1e-4;
  }
  return { kind: 'fill', take: Math.min(o.qty, Math.max(f, 0.12 * o.qty)), qAhead };
}

/**
 * GAP POLICY — what price a resting order gets when the market jumps past its level between two
 * ticks. Decided once, here, and shown to the trader:
 *
 *                     Beginner (forgiving)        Advanced (realistic)
 *   limit, tp         its own price               its own price — a resting limit is filled at the
 *                                                 price it rests at, never worse
 *   sl, tsl           its own price               MARKET AT TRIGGER: a stop becomes a market order;
 *                                                 in a gap you get the market (plus impact), not
 *                                                 your stop price — no tolerance cap, the point of
 *                                                 a stop is to get out
 *   stop              market at trigger           market at trigger (same rule)
 *   stopl             becomes a limit at `lim`    becomes a limit at `lim` — if the market has
 *                                                 gapped past `lim` it does not fill (the lesson
 *                                                 of a stop-limit)
 *
 * Beginner keeps the Phase 1 behaviour byte-for-byte (the parity tests pin it); it is a stated
 * simplification of the forgiving mode, not an accident.
 */
export type GapRule = 'order-price' | 'market';
export function gapRule(type: RestingOrder['type'], advanced: boolean): GapRule {
  if (type === 'stop') return 'market';
  if (advanced && (type === 'sl' || type === 'tsl')) return 'market';
  return 'order-price';
}

/** Plain English for a stop that filled away from its trigger price (null when it did not slip). */
export function explainGap(stopPx: number, avg: number, side: Side, fmt: (n: number) => string): string | null {
  if (!(stopPx > 0 && avg > 0)) return null;
  const worse = side === 'sell' ? avg < stopPx : avg > stopPx;
  const pct = Math.abs(avg / stopPx - 1) * 100;
  if (!worse || pct < 0.05) return null;
  return `Your stop was at ${fmt(stopPx)} but the market was already at ${fmt(avg)} when it fired (${pct.toFixed(2)}% worse): ` +
    'a stop becomes a market order, so in a gap you get the market price, not your stop price. A stop-limit caps the price — and may not fill at all.';
}
