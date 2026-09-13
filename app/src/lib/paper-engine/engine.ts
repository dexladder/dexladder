/**
 * The book engine: the one stateful piece, and its state is only a cache of books keyed by pair.
 * Prices, market stats, the clock and randomness are injected, so the same inputs replay the
 * same fills — in a test, in the app, or in a replayed session.
 */
import type { Book, FeeSchedule, LiveBook, MarketStats, Side } from './types';
import { buildBook, carryEat, depthUSD, liveBook, needsRebuild, spreadBps, LEVELS } from './book';
import { execute, preview, queueAhead, tapeFlow, FEES, type ExecOpts, type Execution, type Preview, type PreviewOpts } from './match';
import { poolExecute, poolPreview, poolLevels, BEGINNER, type Dent, type PoolCtx, type Realism } from './pool-exec';
import { venue as venueOf } from './venues';

export interface EngineDeps {
  priceOf(sym: string, quote: string): number;
  statsOf(sym: string): MarketStats;
  now(): number;
  /** uniform [0,1) */
  random(): number;
  readonly fees?: FeeSchedule;
  /**
   * Execution realism, read per call. Beginner (the default) fills on the synthetic order book
   * exactly as before; Advanced prices every order on a pool curve with impact and tolerance.
   */
  realism?(): Realism;
}

export interface BookEngine {
  /** the realism the next order will run under */
  realism(): Realism;
  book(sym: string, quote?: string): LiveBook;
  preview(sym: string, quote: string, side: Side, qty: number, opts?: PreviewOpts): Preview | null;
  execute(sym: string, quote: string, side: Side, qty: number, opts?: ExecOpts): Execution;
  queueAhead(sym: string, quote: string, side: Side, limit: number): number;
  tape(sym: string, dtMs: number): number;
  depthUSD(sym: string): number;
  spreadBps(sym: string): number;
  readonly FEE: FeeSchedule;
  /** impact=false: fills never eat liquidity (legacy CBX.cfg.impact). latency is advisory. */
  readonly cfg: { latency: boolean; impact: boolean };
  levels(): number;
  reset(): void;
}

const EMPTY: LiveBook = Object.freeze({ mid: 0, asks: [], bids: [] });

/** In Advanced mode an order pays its venue's published maker/taker rates (VENUES), not the flat default. */
export function venueFees(id: string): FeeSchedule {
  const v = venueOf(id);
  return { maker: v.m, taker: v.t };
}

/** On a forked pool the fee is the contract's own tier — maker and taker alike (a swap is a swap). */
export function realismFees(r: Realism): FeeSchedule {
  return r.fork ? { maker: r.fork.feeRate, taker: r.fork.feeRate } : venueFees(r.venue);
}

export function createBookEngine(deps: EngineDeps): BookEngine {
  const fees = deps.fees || FEES;
  const cache = new Map<string, Book>();
  const dents = new Map<string, Dent>();
  const cfg = { latency: true, impact: true };
  const realism = (): Realism => { try { return (deps.realism && deps.realism()) || BEGINNER; } catch { return BEGINNER; } };

  /** Advanced mode's pricing context for a pair, or null in Beginner mode / without a price. */
  function poolCtx(sym: string, quote: string): PoolCtx | null {
    const r = realism();
    if (r.mode !== 'advanced') return null;
    // a forked pool prices itself: its own reserves are the market, not the data feed
    const mid = r.fork ? r.fork.mid : deps.priceOf(sym, quote) || 0;
    if (!(mid > 0)) return null;
    // a forked pool is denominated in its own quote token: one unit of it is the unit of account
    const qU = r.fork ? 1 : quote === 'USDT' ? 1 : deps.priceOf(quote, 'USDT') || 0;
    return { mid, stats: deps.statsOf(sym), quoteUSD: qU, realism: r, dent: dents.get(sym + '|' + quote), now: deps.now() };
  }

  function stored(sym: string, quote: string): Book | null {
    const k = sym + '|' + quote, mid = deps.priceOf(sym, quote) || 0;
    if (!(mid > 0)) return null;
    const prev = cache.get(k), now = deps.now();
    if (!needsRebuild(prev, mid, now)) return prev!;
    const fresh = buildBook(sym, quote, mid, deps.statsOf(sym), now);
    if (!fresh) return null;
    const b = carryEat(prev, fresh);
    cache.set(k, b);
    return b;
  }

  return {
    realism,
    book(sym, quote = 'USDT') {
      const pc = poolCtx(sym, quote);
      if (pc) return poolLevels(pc);
      const b = stored(sym, quote); return b ? liveBook(b, deps.now()) : EMPTY;
    },
    preview(sym, quote, side, qty, opts = {}) {
      const q = quote || 'USDT', pc = poolCtx(sym, q);
      if (pc) return poolPreview(pc, side, qty, opts, realismFees(pc.realism));
      const b = stored(sym, q); return b ? preview(liveBook(b, deps.now()), side, qty, opts, fees) : null;
    },
    execute(sym, quote, side, qty, opts = {}) {
      const q = quote || 'USDT', pc = poolCtx(sym, q);
      if (pc) {
        const r = poolExecute(pc, side, qty, opts, realismFees(pc.realism));
        if (cfg.impact && r.dent) dents.set(sym + '|' + q, r.dent);
        return r.exec;
      }
      const b = stored(sym, q);
      if (!b) return { ok: false, reason: 'no market' };
      const r = execute(b, side, qty, opts, deps.now(), fees);
      if (cfg.impact) cache.set(sym + '|' + q, r.book);
      return r.exec;
    },
    // an AMM has no queue: a resting order fills when the pool price reaches it
    queueAhead(sym, quote, side, limit) { if (poolCtx(sym, quote || 'USDT')) return 0; const b = stored(sym, quote || 'USDT'); return b ? queueAhead(liveBook(b, deps.now()), side, limit) : 0; },
    // the draw is taken only when there is a tape to print (legacy order of Math.random calls)
    tape(sym, dtMs) { const s = deps.statsOf(sym); return s.vol24 > 0 && s.price > 0 ? tapeFlow(s.vol24, s.price, dtMs, deps.random()) : 0; },
    depthUSD(sym) { return depthUSD(deps.statsOf(sym)); },
    spreadBps(sym) { return spreadBps(deps.statsOf(sym).vol24 || 0); },
    FEE: fees,
    cfg,
    levels: () => LEVELS,
    reset() { cache.clear(); dents.clear(); },
  };
}
