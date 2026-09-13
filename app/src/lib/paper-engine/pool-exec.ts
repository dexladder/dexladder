/**
 * Advanced-mode execution: previews and fills priced on the pool curve (impact.ts + amm.ts).
 *
 * One function — simulate() — prices an order; preview() reports it and execute() commits it,
 * so what the ticket shows is exactly what the fill does at the same instant. The only state is
 * the "dent" our own last fill left in the pool's price: arbitrage pulls the price back to the
 * oracle mid linearly over HEAL_MS (the same 6 s the order book heals over). A rejected order
 * never leaves a dent.
 */
import type { FeeSchedule, LiveBook, LiveLevel, MarketStats, Side } from './types';
import type { AmmFacts, Execution, ExecOpts, MevFacts, MevOpts, Preview, PreviewOpts } from './match';
import { HEAL_MS, LEVELS, levelDistance } from './book';
import { poolSpec, poolAt, quoteImpact, checkTolerance, nearZeroLiquidity, DEFAULT_TOLERANCE_PCT, NEAR_ZERO_POOL_USD, fmtPct, type PoolSpec } from './impact';
import { atPrice, baseToPrice, swap, type Pool } from './amm';
import { sandwich } from './mev';
import type { ForkVenue } from '../fork/market';

export type ExecMode = 'beginner' | 'advanced';
export interface Realism {
  readonly mode: ExecMode;
  readonly venue: string;
  /** slippage tolerance, percent */
  readonly tolerancePct: number;
  /** DEX pool range, ±percent; null = full range (constant product) */
  readonly rangePct: number | null;
  /**
   * A pool read from the trader's own node (the Local Fork sandbox). When it is set it REPLACES
   * the modelled pool: the curve, the price and the fee are the contract's own, so an order is
   * priced against liquidity that really exists rather than against a depth estimate.
   */
  readonly fork?: ForkVenue | null;
}
export const BEGINNER: Realism = Object.freeze({ mode: 'beginner', venue: 'binance', tolerancePct: DEFAULT_TOLERANCE_PCT, rangePct: null, fork: null });

/** Our last fill's displacement of the pool price (p/mid − 1), and when it happened. */
export interface Dent { readonly move: number; readonly t: number }

export interface PoolCtx {
  /** oracle mid, quote per base */
  readonly mid: number;
  readonly stats: MarketStats;
  /** USD value of one unit of the quote asset */
  readonly quoteUSD: number;
  readonly realism: Realism;
  readonly dent: Dent | null | undefined;
  readonly now: number;
}

/** The pool price right now: mid, moved by what is left of our last fill's dent. */
export function poolPrice(mid: number, dent: Dent | null | undefined, now: number): number {
  if (!dent || !dent.move) return mid;
  const left = 1 - Math.min(1, Math.max(0, now - dent.t) / HEAL_MS);
  return mid * (1 + dent.move * left);
}

export interface Built { readonly spec: PoolSpec; readonly pool: Pool; readonly p0: number }

export function buildPool(ctx: PoolCtx): Built | null {
  if (!(ctx.mid > 0)) return null;
  const f = ctx.realism.fork;
  const p0 = poolPrice(ctx.mid, ctx.dent, ctx.now);
  if (f) {
    // the pool IS the contract's: keep its liquidity and range, move it only by our own unhealed dent
    const spec: PoolSpec = { tvlUSD: f.tvlQuote * (ctx.quoteUSD > 0 ? ctx.quoteUSD : 1), model: f.kind === 'v3' ? 'concentrated' : 'cpmm', rangePct: null, tier: 1, venueClass: 'dex' };
    return { spec, pool: atPrice(f.pool, p0), p0 };
  }
  const spec = poolSpec(ctx.stats, ctx.realism.venue, ctx.realism.rangePct);
  const pool = poolAt(spec, p0, ctx.quoteUSD);
  return pool ? { spec, pool, p0 } : null;
}

export interface Simulation {
  readonly filled: number; readonly remaining: number; readonly avg: number; readonly cost: number;
  readonly facts: AmmFacts; readonly tolerance: ReturnType<typeof checkTolerance>;
  /** the pool the order executes on (after any drift) */
  readonly pool: Pool;
}

/**
 * Price an order. `driftPct` moves the pool between the quote and the execution (a swap that was
 * pending for a few blocks); impact and tolerance are always measured against the QUOTE price,
 * because that is the price the trader agreed to.
 */
export function simulate(ctx: PoolCtx, side: Side, qty: number, limit: number, tolerancePct?: number, driftPct = 0): Simulation | null {
  const b = buildPool(ctx);
  if (!b || !(qty > 0)) return null;
  const pExec = b.p0 * (1 + driftPct);
  const pool = driftPct ? (ctx.realism.fork ? atPrice(b.pool, pExec) : poolAt(b.spec, pExec, ctx.quoteUSD)) : b.pool;
  if (!pool || !(pExec > 0)) return null;
  const q = quoteImpact(pool, side, qty, limit);
  const impact = q.swap.filled > 0 ? Math.abs(q.swap.avg / b.p0 - 1) * 100 : 0;
  const tol = tolerancePct != null && tolerancePct > 0 ? tolerancePct : ctx.realism.tolerancePct;
  const tolerance = checkTolerance(impact, tol);
  // A forked pool's depth is in ITS quote token and the node has no dollar feed, so the
  // absolute-dollar floor cannot be applied to it; the share-of-your-size test still can.
  const tvlForThin = ctx.realism.fork ? NEAR_ZERO_POOL_USD : b.spec.tvlUSD;
  const thin = nearZeroLiquidity(tvlForThin, q.swap.filled, qty, !(limit > 0));
  return {
    filled: q.swap.filled, remaining: qty - q.swap.filled, avg: q.swap.avg, cost: q.swap.quote, tolerance, pool,
    facts: {
      venue: ctx.realism.fork ? 'localfork' : ctx.realism.venue, model: b.spec.model, poolUSD: b.spec.tvlUSD, p0: b.p0, p1: q.swap.p1,
      ...(ctx.realism.fork ? { fork: { label: ctx.realism.fork.label, quote: ctx.realism.fork.quoteSymbol } } : {}),
      impactPct: impact, movePct: Math.abs(q.swap.p1 / b.p0 - 1) * 100, tolerancePct: tol, withinTolerance: tolerance.ok,
      rangeExhausted: q.swap.exhausted, driftPct: driftPct * 100, ...(thin ? { nearZero: thin } : {}),
    },
  };
}

/**
 * What a rational MEV bot does to this simulation (market swaps only; a limit caps the price
 * itself). Null = no attack (bots off, tolerance tight, or not worth the bot's gas).
 */
export function mevOn(s: Simulation, side: Side, qty: number, limit: number, feeRate: number, mev: MevOpts | undefined): { facts: MevFacts; p1: number; cost: number } | null {
  if (!mev || limit > 0 || !(s.filled > 1e-12) || !s.tolerance.ok) return null;
  const sw = sandwich(s.pool, side, qty, s.facts.p0, s.facts.tolerancePct, feeRate, mev.botGasQuote);
  if (!sw) return null;
  return { facts: { extraQuote: sw.extraQuote, botProfitQuote: sw.botProfitQuote, frontBase: sw.front.filled, cleanAvg: sw.clean.avg, avg: sw.victim.avg }, p1: sw.back.p1, cost: sw.victim.quote };
}

export function poolPreview(ctx: PoolCtx, side: Side, qty: number, opts: PreviewOpts, fees: FeeSchedule): Preview | null {
  const s = simulate(ctx, side, qty, opts.limit || 0, opts.tolerancePct);
  if (!s) return null;
  const maker = !!opts.postOnly || (opts.type === 'limit' && s.filled <= 1e-12);
  const feeRate = maker ? fees.maker : fees.taker;
  // the preview is the clean price; a possible sandwich is reported next to it, never mixed into it
  const m = mevOn(s, side, qty, opts.limit || 0, fees.taker, opts.mev);
  return {
    mid: ctx.mid, avg: s.avg, filled: s.filled, remaining: s.remaining, slipBps: s.facts.impactPct * 100, levels: 0,
    exhausted: s.facts.rangeExhausted, feeRate, maker, feeQuote: s.cost * feeRate, naiveAvg: ctx.mid, naiveFee: qty * ctx.mid * 0.001,
    amm: m ? { ...s.facts, sandwich: m.facts } : s.facts,
  };
}

/**
 * Execute on the pool. Rejections (post-only that would take, FOK that cannot complete, impact
 * beyond tolerance, no liquidity at all) return the dent unchanged. A fill returns the new dent.
 */
export function poolExecute(ctx: PoolCtx, side: Side, qty: number, opts: ExecOpts, fees: FeeSchedule): { exec: Execution; dent: Dent | null | undefined } {
  const tif = String(opts.tif || 'GTC').toUpperCase(), limit = opts.limit || 0, keep = ctx.dent;
  const b = buildPool(ctx);
  if (!b) return { exec: { ok: false, reason: 'no market' }, dent: keep };
  if (opts.postOnly && limit > 0 && (side === 'buy' ? limit >= b.p0 : limit <= b.p0)) {
    return { exec: { ok: false, rejected: true, code: 'post-only', reason: 'post-only would trade against the pool right away — it would pay the swap fee, so it was rejected instead' }, dent: keep };
  }
  const s = simulate(ctx, side, qty, limit, opts.tolerancePct, opts.driftPct || 0);
  if (!s) return { exec: { ok: false, reason: 'no market', code: 'no-market' }, dent: keep };
  if (s.facts.nearZero) return { exec: { ok: false, rejected: true, code: 'no-liquidity', reason: s.facts.nearZero }, dent: keep };
  if (tif === 'FOK' && s.remaining > 1e-9) {
    return { exec: { ok: false, rejected: true, code: 'fok', reason: 'fill-or-kill: only ' + ((s.filled / qty) * 100).toFixed(1) + '% of that size fits in the pool at your price' }, dent: keep };
  }
  if (s.filled > 1e-12 && !s.tolerance.ok) return { exec: { ok: false, rejected: true, code: 'tolerance', reason: s.tolerance.reason }, dent: keep };
  // a bot in the mempool moves the victim to the edge of its tolerance (still inside it — so it fills)
  const m = mevOn(s, side, qty, limit, fees.taker, opts.mev);
  const avg = m ? m.facts.avg : s.avg, cost = m ? m.cost : s.cost, p1 = m ? m.p1 : s.facts.p1;
  if (s.filled > 1e-12 && opts.afford && !opts.afford(s.filled, avg, fees.taker)) {
    return { exec: { ok: false, unfunded: true, reason: 'insufficient balance', filled: s.filled, avg, feeRate: fees.taker, mid: ctx.mid }, dent: keep };
  }
  const moved = s.filled > 1e-12;
  const impact = moved ? Math.abs(avg / s.facts.p0 - 1) * 100 : 0;
  const facts: AmmFacts = m ? { ...s.facts, impactPct: impact, p1, movePct: Math.abs(p1 / s.facts.p0 - 1) * 100, sandwich: m.facts } : s.facts;
  return {
    dent: moved ? { move: p1 / (ctx.mid * (1 + (opts.driftPct || 0))) - 1, t: ctx.now } : keep,
    exec: {
      ok: moved, filled: s.filled, remaining: s.remaining, avg, mid: ctx.mid, slipBps: impact * 100, levels: 0,
      feeRate: fees.taker, maker: false, tif, exhausted: s.facts.rangeExhausted, naiveAvg: ctx.mid, naiveCost: qty * ctx.mid, realCost: cost, amm: facts,
    },
  };
}

/**
 * The pool drawn as an order book, for the depth ladder: 40 levels a side on the same price grid
 * the synthetic book uses, each holding what the curve absorbs between its price and the previous
 * one. Walking this ladder ≈ swapping on the pool, so what the ladder shows is what a fill meets.
 */
export function poolLevels(ctx: PoolCtx): LiveBook {
  const b = buildPool(ctx);
  if (!b) return { mid: 0, asks: [], bids: [] };
  const side = (s: Side): LiveLevel[] => {
    const out: LiveLevel[] = [];
    let prevBase = 0, prevQuote = 0;
    for (let i = 0; i < LEVELS; i++) {
      const d = levelDistance(b.p0, b.p0 * 5e-5, i);
      const edge = s === 'buy' ? b.p0 + d : b.p0 - d;
      if (!(edge > 0)) break;
      const cum = baseToPrice(b.pool, s, edge);
      const cumQuote = cum > 0 ? swap(b.pool, s, cum).quote : 0;
      const a = cum - prevBase;
      // each rung is priced at the average of the curve segment it stands for, so walking whole
      // rungs reproduces the swap exactly (only a partly-taken last rung is approximate)
      if (a > 0) out.push({ p: (cumQuote - prevQuote) / a, a, i });
      prevBase = cum; prevQuote = cumQuote;
    }
    return out;
  };
  return { mid: b.p0, asks: side('buy'), bids: side('sell') };
}

/** One plain-English sentence for the ticket: what the pool did to this order. */
export function explainImpact(f: AmmFacts, filled: number, asked: number): string {
  const where = f.fork ? 'your pool (' + f.fork.label + ')' : f.venue === 'dexamm' ? 'the DEX pool' : 'the market';
  const size = f.impactPct < 0.05 ? 'Your size barely moves ' + where : 'Your size moves ' + where;
  const part = filled < asked * (1 - 1e-9) ? ` Only ${((filled / asked) * 100).toFixed(1)}% fits at your price.` : '';
  const depth = f.fork
    ? `Your pool holds ≈ ${Math.round(f.poolUSD).toLocaleString('en-US')} ${f.fork.quote} against ${f.fork.label.split(' / ')[0]} — read from the contract, not modelled`
    : `Pool depth ≈ $${Math.round(f.poolUSD).toLocaleString('en-US')}`;
  return `${size}: average ${fmtPct(f.impactPct)} from the pre-trade price, marginal price ${fmtPct(f.movePct)} further. ` +
    `${depth}.${part}`;
}
