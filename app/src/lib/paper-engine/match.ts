/**
 * Matching against the synthetic book: walk-the-book quotes, previews, executions with
 * time-in-force and post-only, queue position for resting orders, and tape flow.
 * Pure — the book goes in, a new book comes out.
 */
import type { Book, FeeSchedule, LiveBook, Side, Take, Tif, Walk } from './types';
import { consume, liveBook } from './book';

export const FEES: FeeSchedule = Object.freeze({ maker: 8e-4, taker: 0.001 });

const EPS = 1e-12;

/** Walk the book for `qty`. `limit` > 0 stops at the first level beyond the limit. */
export function walk(book: LiveBook, side: Side, qty: number, limit = 0): Walk | null {
  if (!(book.mid && qty > 0)) return null;
  const lv = side === 'buy' ? book.asks : book.bids;
  let rem = qty, cost = 0;
  const taken: Take[] = [];
  for (let k = 0; k < lv.length && rem > EPS; k++) {
    const L = lv[k]!;
    if (limit > 0 && (side === 'buy' ? L.p > limit : L.p < limit)) break;
    const take = Math.min(rem, L.a);
    if (take <= EPS) continue;
    cost += take * L.p; rem -= take;
    taken.push({ i: L.i, q: take, p: L.p });
  }
  const filled = qty - rem;
  return {
    mid: book.mid, filled, remaining: rem, cost,
    avg: filled > EPS ? cost / filled : 0,
    taken, levels: taken.length,
    exhausted: rem > EPS && !(limit > 0),
  };
}

export function slippageBps(side: Side, avg: number, mid: number): number {
  if (!avg) return 0;
  return Math.max(0, ((side === 'buy' ? avg - mid : mid - avg) / mid) * 1e4);
}

/** Present when simulated MEV bots are watching the mempool: the bot's gas for its two swaps. */
export interface MevOpts { readonly botGasQuote: number }
export interface PreviewOpts { readonly limit?: number; readonly type?: string; readonly postOnly?: boolean; readonly tolerancePct?: number; readonly mev?: MevOpts }
export interface Preview {
  readonly mid: number; readonly avg: number; readonly filled: number; readonly remaining: number;
  readonly slipBps: number; readonly levels: number; readonly exhausted: boolean;
  readonly feeRate: number; readonly maker: boolean; readonly feeQuote: number;
  readonly naiveAvg: number; readonly naiveFee: number;
  /** present when the order was priced on an AMM curve (Advanced mode) — see pool-exec.ts */
  readonly amm?: AmmFacts;
}

/** A sandwich attack, in numbers (quote asset). */
export interface MevFacts {
  /** what it cost the victim */
  readonly extraQuote: number;
  /** what the bot kept after fees and gas */
  readonly botProfitQuote: number;
  /** the bot's front-run size, base */
  readonly frontBase: number;
  /** the average the victim would have got with no bot */
  readonly cleanAvg: number;
  /** the victim's average with the bot */
  readonly avg: number;
}

/** What the AMM model adds to a preview or a fill, for the ticket and the journal to show. */
export interface AmmFacts {
  readonly venue: string;
  readonly model: 'cpmm' | 'concentrated';
  /** pool value, USD */
  readonly poolUSD: number;
  /** marginal price before the order (oracle mid moved by any recent fill that has not healed) */
  readonly p0: number;
  /** marginal price the order leaves behind */
  readonly p1: number;
  /** average price vs p0, percent */
  readonly impactPct: number;
  /** marginal move p0 → p1, percent */
  readonly movePct: number;
  readonly tolerancePct: number;
  readonly withinTolerance: boolean;
  /** the pool's range ran out before the order did */
  readonly rangeExhausted: boolean;
  /** set when the pool is too thin to trade against at all: the refusal, in words */
  readonly nearZero?: string;
  /** a simulated MEV bot sandwiched this swap (on a fill), or could (on a preview) — see mev.ts */
  readonly sandwich?: MevFacts;
  /** price move between quote and execution, percent (on-chain swaps that waited); 0 when none */
  readonly driftPct: number;
  /** set when the curve came from a pool on the trader's OWN node: that pool, named, and the
      token its depth and prices are denominated in (the node has no USD feed) */
  readonly fork?: { readonly label: string; readonly quote: string };
}

/** What an order would do right now, without doing it. */
export function preview(book: LiveBook, side: Side, qty: number, opts: PreviewOpts = {}, fees: FeeSchedule = FEES): Preview | null {
  const r = walk(book, side, qty, opts.limit || 0);
  if (!r) return null;
  const maker = !!opts.postOnly || (opts.type === 'limit' && r.filled <= EPS);
  const feeRate = maker ? fees.maker : fees.taker;
  return {
    mid: r.mid, avg: r.avg, filled: r.filled, remaining: r.remaining,
    slipBps: slippageBps(side, r.avg, r.mid), levels: r.levels, exhausted: r.exhausted,
    feeRate, maker, feeQuote: r.cost * feeRate, naiveAvg: r.mid, naiveFee: qty * r.mid * 0.001,
  };
}

export interface ExecOpts {
  readonly limit?: number; readonly tif?: Tif | string; readonly postOnly?: boolean; readonly tolerancePct?: number;
  /**
   * Asked BEFORE any liquidity is consumed: can the account pay for this fill? When it answers
   * false the order is refused and the book/pool is left exactly as it was — an order you cannot
   * afford never dents the market.
   */
  readonly afford?: (filled: number, avg: number, feeRate: number) => boolean;
  /**
   * Advanced, on-chain only: the relative price move between the quote and the moment the swap
   * is mined (a pending transaction meets a moved pool). Tolerance is judged against the QUOTE.
   */
  readonly driftPct?: number;
  /** Advanced, on-chain market swaps only: simulated MEV bots are watching (see mev.ts) */
  readonly mev?: MevOpts;
}

/** The refusal an unaffordable order gets: what it WOULD have filled, and nothing consumed. */
export interface Unfunded { readonly ok: false; readonly unfunded: true; readonly reason: string; readonly filled: number; readonly avg: number; readonly feeRate: number; readonly mid: number }
/** Why a POOL order was refused (the book path keeps its legacy shape): the gas model treats them differently. */
export type RejectCode = 'no-market' | 'post-only' | 'fok' | 'tolerance' | 'no-liquidity';
export type Execution =
  | { readonly ok: false; readonly rejected?: true; readonly reason: string; readonly code?: RejectCode }
  | Unfunded
  | {
      readonly ok: boolean; readonly filled: number; readonly remaining: number; readonly avg: number; readonly mid: number;
      readonly slipBps: number; readonly levels: number; readonly feeRate: number; readonly maker: false; readonly tif: string;
      readonly exhausted: boolean; readonly naiveAvg: number; readonly naiveCost: number; readonly realCost: number;
      readonly amm?: AmmFacts;
    };

/**
 * Execute against the book. Returns the execution and the book with our consumption recorded.
 * post-only rejects if it would cross; FOK rejects unless the whole size fills at the limit.
 */
export function execute(book: Book, side: Side, qty: number, opts: ExecOpts, now: number, fees: FeeSchedule = FEES): { exec: Execution; book: Book } {
  const tif = String(opts.tif || 'GTC').toUpperCase();
  const limit = opts.limit || 0;
  const live = liveBook(book, now);
  if (!live.mid) return { exec: { ok: false, reason: 'no market' }, book };
  const touch = side === 'buy' ? live.asks[0]?.p : live.bids[0]?.p;
  if (opts.postOnly && limit > 0 && touch != null && (side === 'buy' ? limit >= touch : limit <= touch)) {
    return { exec: { ok: false, rejected: true, reason: 'post-only would cross the spread — it would pay taker fees, so it was rejected instead' }, book };
  }
  const r = walk(live, side, qty, limit);
  if (!r) return { exec: { ok: false, reason: 'no market' }, book };
  if (tif === 'FOK' && r.remaining > 1e-9) {
    return { exec: { ok: false, rejected: true, reason: 'fill-or-kill: only ' + ((r.filled / qty) * 100).toFixed(1) + '% of that size is available at your price' }, book };
  }
  if (r.filled > EPS && opts.afford && !opts.afford(r.filled, r.avg, fees.taker)) {
    return { exec: { ok: false, unfunded: true, reason: 'insufficient balance', filled: r.filled, avg: r.avg, feeRate: fees.taker, mid: r.mid }, book };
  }
  const next = consume(book, side === 'buy' ? 'asks' : 'bids', r.taken, now);
  return {
    book: next,
    exec: {
      ok: r.filled > EPS, filled: r.filled, remaining: r.remaining, avg: r.avg, mid: r.mid,
      slipBps: slippageBps(side, r.avg, r.mid), levels: r.levels, feeRate: fees.taker, maker: false, tif,
      exhausted: r.exhausted, naiveAvg: r.mid, naiveCost: qty * r.mid, realCost: r.cost,
    },
  };
}

/** Quantity resting ahead of a new order at `limit` — everything at that price or better on our side. */
export function queueAhead(book: LiveBook, side: Side, limit: number): number {
  if (!book.mid) return 0;
  const lv = side === 'buy' ? book.bids : book.asks;
  let ahead = 0;
  for (const L of lv) {
    if (!(side === 'buy' ? L.p >= limit : L.p <= limit)) break;
    ahead += L.a;
  }
  return ahead;
}

/**
 * Base quantity printed on the tape in `dtMs`: 24h volume spread evenly, times a draw in
 * [0.6, 2.2). `u` is a uniform [0,1) draw supplied by the caller (the engine is RNG-free).
 */
export function tapeFlow(vol24: number, price: number, dtMs: number, u: number): number {
  return vol24 > 0 && price > 0 ? (vol24 / price / 864e5) * Math.max(0, dtMs) * (0.6 + 1.6 * u) : 0;
}
