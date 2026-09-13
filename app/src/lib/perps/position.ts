/**
 * Opening a position: validate the ticket against the spec and price it — the same numbers the
 * preview shows and the open uses. A refusal always carries the sentence that explains it.
 */
import { maxLevFor, tierFor } from './spec';
import { liqPrice, distancePct, bankruptcyPrice } from './margin';
import { intervalRate } from './funding';
import type { PerpMode, PerpPosition, PerpSide, PerpSpec } from './types';

export interface OpenTicket {
  readonly sym: string;
  readonly side: PerpSide;
  /** USDT the trader posts as isolated margin */
  readonly margin: number;
  readonly lev: number;
  readonly mark: number;
  /** average fill price (= mark in Beginner; the order-book walk in Advanced) */
  readonly fill: number;
  readonly sl?: number | null;
  readonly tp?: number | null;
}

export interface OpenCtx {
  readonly spec: PerpSpec;
  readonly venue: string;
  readonly mode: PerpMode;
  readonly rate8h: number;
  readonly now: number;
  readonly id: string;
  /** open positions already on the desk */
  readonly open: number;
  readonly maxPositions: number;
}

export interface OpenQuote {
  readonly position: PerpPosition;
  readonly notional: number;
  readonly openFee: number;
  readonly liq: number;
  readonly bankrupt: number;
  /** percent the mark may move against the position before liquidation */
  readonly distPct: number;
  /** what the trader loses if liquidated: all the margin, plus the fee already paid */
  readonly worstCase: number;
  /** funding one settlement would cost (+) or pay (−) at today's rate */
  readonly fundingPerSettlement: number;
  readonly maxLev: number;
  readonly mmr: number;
}

export type OpenCheck = { readonly ok: true; readonly quote: OpenQuote } | { readonly ok: false; readonly why: string; readonly quote?: OpenQuote };

export function quoteOpen(t: OpenTicket, c: OpenCtx): OpenCheck {
  const s = c.spec;
  if (!(t.mark > 0 && t.fill > 0)) return { ok: false, why: 'No price for ' + t.sym + ' yet — wait for the feed.' };
  if (!(t.margin >= s.minMargin)) return { ok: false, why: 'Post at least ' + s.minMargin + ' USDT of margin.' };
  const maxLev = maxLevFor(s, t.margin), lev = Math.round(t.lev);
  if (!(lev >= 1)) return { ok: false, why: 'Leverage starts at 1×.' };
  const notional = t.margin * lev, tier = tierFor(s.tiers, notional);
  const position: PerpPosition = {
    v: 2, id: c.id, sym: t.sym, side: t.side, lev, qty: notional / t.fill, entry: t.fill, margin: t.margin,
    cashIn: t.margin + notional * s.takerFee, openFee: notional * s.takerFee, funding: 0, lastFundingAt: c.now,
    venue: c.venue, mode: c.mode, takerFee: s.takerFee, fundingHours: s.fundingHours, mmr: tier.mmr, cum: tier.cum, t: c.now,
    ...(t.sl && t.sl > 0 ? { sl: t.sl } : {}), ...(t.tp && t.tp > 0 ? { tp: t.tp } : {}),
  };
  const liq = liqPrice(position);
  const quote: OpenQuote = {
    position, notional, openFee: position.openFee, liq, bankrupt: bankruptcyPrice(position), distPct: distancePct(position, t.fill),
    worstCase: position.cashIn, fundingPerSettlement: position.qty * t.mark * intervalRate(c.rate8h, s.fundingHours) * (t.side === 'long' ? 1 : -1),
    maxLev, mmr: tier.mmr,
  };
  if (lev > s.maxLev) return { ok: false, quote, why: (c.mode === 'beginner' ? 'Beginner mode stops at ' : 'This market allows at most ') + s.maxLev + '× leverage.' };
  if (lev > maxLev) return { ok: false, quote, why: 'A ' + fmt0(notional) + ' USDT position needs more maintenance margin — at this size the most you can use is ' + maxLev + '×.' };
  if (c.open >= c.maxPositions) return { ok: false, quote, why: 'The desk holds ' + c.maxPositions + ' positions at most — close one first.' };
  const long = t.side === 'long';
  if (t.sl) {
    if (long ? t.sl >= t.fill : t.sl <= t.fill) return { ok: false, quote, why: 'A ' + t.side + ' stop-loss sits ' + (long ? 'below' : 'above') + ' the entry price.' };
    if (long ? t.sl <= liq : t.sl >= liq) return { ok: false, quote, why: 'Your stop-loss is past the liquidation price (' + fmt0(liq) + ') — liquidation would come first and the stop could never fire. Move it closer or use less leverage.' };
  }
  if (t.tp && (long ? t.tp <= t.fill : t.tp >= t.fill)) return { ok: false, quote, why: 'A ' + t.side + ' take-profit sits ' + (long ? 'above' : 'below') + ' the entry price.' };
  return { ok: true, quote };
}

/** deterministic grouping (no locale): 54300 → 54,300 */
export function fmt0(n: number): string {
  if (!(Math.abs(n) >= 100)) return n.toPrecision(4);
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
