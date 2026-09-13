/**
 * Algorithmic execution — TWAP, as pure arithmetic.
 *
 * A TWAP (time-weighted average price) order is a PARENT order: one size, cut into equal slices
 * and sent at a fixed interval, so the average price paid is the market's average over the period
 * instead of whatever the book looked like at one instant. It is how a desk works an order that is
 * large for the venue — and in Advanced mode it teaches its own cost: each slice is its own swap,
 * so on-chain each slice pays its own gas.
 *
 * Nothing here touches the clock, the DOM or the account: `now` is passed in, and the caller
 * sends the slices.
 */
import type { Side } from './types';

export const TWAP = Object.freeze({ minSlices: 2, maxSlices: 24, minMinutes: 1, maxMinutes: 240 });
export const SLICE_CHOICES: readonly number[] = Object.freeze([4, 6, 12, 24]);
export const WINDOW_CHOICES: readonly number[] = Object.freeze([5, 15, 60, 240]);

/** The parent order, as it rests among the working orders. */
export interface TwapOrder {
  readonly id: string;
  readonly type: 'twap';
  readonly side: Side;
  readonly sym: string;
  readonly quote: string;
  /** total size, in base units */
  readonly qty: number;
  readonly slices: number;
  /** slices already sent */
  readonly sent: number;
  /** base units actually filled so far (a slice can fill short) */
  readonly filled: number;
  /** quote spent (buy) or received (sell) so far, fees excluded */
  readonly costQuote: number;
  readonly everyMs: number;
  readonly startedAt: number;
}

export type Plan = { readonly ok: true; readonly order: TwapOrder } | { readonly ok: false; readonly reason: string };

export interface PlanInput {
  readonly id: string; readonly side: Side; readonly sym: string; readonly quote: string;
  readonly qty: number; readonly slices: number; readonly minutes: number; readonly now: number;
}

/** Validate and lay out a parent order. The first slice goes immediately; the last closes the window. */
export function planTwap(i: PlanInput): Plan {
  if (!(i.qty > 0)) return { ok: false, reason: 'Enter a total size to work.' };
  const n = Math.round(i.slices), mins = Math.round(i.minutes);
  if (!(n >= TWAP.minSlices && n <= TWAP.maxSlices)) return { ok: false, reason: `Slices must be between ${TWAP.minSlices} and ${TWAP.maxSlices}.` };
  if (!(mins >= TWAP.minMinutes && mins <= TWAP.maxMinutes)) return { ok: false, reason: `The order must be worked over ${TWAP.minMinutes}–${TWAP.maxMinutes} minutes.` };
  return { ok: true, order: { id: i.id, type: 'twap', side: i.side, sym: i.sym, quote: i.quote, qty: i.qty, slices: n, sent: 0, filled: 0, costQuote: 0, everyMs: Math.round((mins * 60_000) / (n - 1)), startedAt: i.now } };
}

/** Size of slice `index` (0-based). Even, with the rounding remainder on the last one. */
export function sliceQty(o: TwapOrder, index: number): number {
  const even = o.qty / o.slices;
  return index >= o.slices - 1 ? Math.max(0, o.qty - even * (o.slices - 1)) : even;
}

/** How many slices are due by `now` (the first is due at once). */
export function dueCount(o: TwapOrder, now: number): number {
  const elapsed = Math.max(0, now - o.startedAt);
  return Math.min(o.slices, 1 + Math.floor(elapsed / Math.max(1, o.everyMs)));
}

/** The next slice to send, or null when nothing is due yet (or the parent is finished). */
export function nextSlice(o: TwapOrder, now: number): { readonly index: number; readonly qty: number } | null {
  if (o.sent >= o.slices) return null;
  return dueCount(o, now) > o.sent ? { index: o.sent, qty: sliceQty(o, o.sent) } : null;
}

/** Milliseconds until the next slice is due (0 when one is due now, null when finished). */
export function waitMs(o: TwapOrder, now: number): number | null {
  if (o.sent >= o.slices) return null;
  return Math.max(0, o.startedAt + o.sent * o.everyMs - now);
}

export const isComplete = (o: TwapOrder): boolean => o.sent >= o.slices;

export interface Progress { readonly pct: number; readonly avg: number; readonly left: number; readonly sent: number; readonly slices: number }

/** What the working-orders row shows: how far along, at what average, how much is left. */
export function progress(o: TwapOrder): Progress {
  return { pct: Math.min(100, (o.sent / o.slices) * 100), avg: o.filled > 0 ? o.costQuote / o.filled : 0, left: Math.max(0, o.qty - o.filled), sent: o.sent, slices: o.slices };
}

/** Book a slice's result onto the parent. Pure: returns the updated parent. */
export function applySlice(o: TwapOrder, filled: number, avg: number): TwapOrder {
  return { ...o, sent: o.sent + 1, filled: o.filled + Math.max(0, filled), costQuote: o.costQuote + Math.max(0, filled) * Math.max(0, avg) };
}

/** The whole plan in one line, for the ticket and the toast. */
export function describe(qty: number, slices: number, minutes: number, sym: string, onChain: boolean): string {
  const every = minutes / (slices - 1);
  return `${slices} slices of ${(qty / slices).toPrecision(4)} ${sym}, one every ${every < 1 ? Math.round(every * 60) + ' s' : (Math.round(every * 10) / 10) + ' min'}, over ${minutes} min` +
    (onChain ? ` — on-chain that is ${slices} separate swaps, each paying its own gas.` : '.');
}
