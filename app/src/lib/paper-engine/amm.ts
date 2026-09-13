/**
 * AMM swap math — constant product (x·y = k) and one concentrated-liquidity range.
 *
 * A pool is described the way Uniswap v3 describes one position: liquidity L over a price range
 * [pa, pb], at current price p (quote per base). Full range (pa = 0, pb = ∞) IS the constant-
 * product pool: real reserves x = L/√p, y = L·√p, so x·y = L² = k. A finite range concentrates
 * the same capital near the price — more depth inside the range, and none outside it: a swap
 * that pushes the price to the edge of the range stops there (the pool is out of that asset).
 *
 * Swap fees are NOT in here — fees are charged by the account transition (applyFill), so this is
 * the pure curve: what the price does, and what the average price of a swap is.
 *
 * Pure and total: bad inputs produce an empty result, never NaN.
 */
import type { Side } from './types';

export interface Pool {
  /** liquidity (√(base·quote) units) */
  readonly L: number;
  /** √ of the current price */
  readonly sp: number;
  /** √ of the range bounds; 0 and Infinity for a full-range (constant-product) pool */
  readonly spa: number;
  readonly spb: number;
}

export interface Swap {
  /** base units that changed hands */
  readonly filled: number;
  /** quote paid (buy) or received (sell), before fees */
  readonly quote: number;
  /** average execution price (quote / base); 0 when nothing filled */
  readonly avg: number;
  /** marginal price before and after */
  readonly p0: number;
  readonly p1: number;
  /** the size asked for that the range could not absorb (0 for a full-range pool) */
  readonly unfilled: number;
  /** the pool hit the edge of its range */
  readonly exhausted: boolean;
}

const EMPTY = (p: number, qty: number): Swap => ({ filled: 0, quote: 0, avg: 0, p0: p, p1: p, unfilled: Math.max(0, qty), exhausted: false });

/**
 * A pool holding `tvl` of value (in quote units) at price `price`, over a range of ±`rangePct`
 * percent around it — or full range when `rangePct` is null (the constant-product default).
 * L is solved from V = L·(2√p − p/√pb − √pa), the value of the real reserves.
 */
export function poolFromTVL(price: number, tvl: number, rangePct: number | null = null): Pool | null {
  if (!(price > 0) || !(tvl > 0)) return null;
  const sp = Math.sqrt(price);
  let spa = 0, spb = Infinity;
  if (rangePct != null && rangePct > 0) {
    const r = Math.min(rangePct, 99) / 100;
    spa = Math.sqrt(price * (1 - r));
    spb = Math.sqrt(price * (1 + r));
  }
  const denom = 2 * sp - (Number.isFinite(spb) ? price / spb : 0) - spa;
  if (!(denom > 0)) return null;
  return { L: tvl / denom, sp, spa, spb };
}

export const price = (pool: Pool): number => pool.sp * pool.sp;

/** Real reserves of the position at its current price. */
export function reserves(pool: Pool): { base: number; quote: number } {
  const { L, sp, spa, spb } = pool;
  return { base: L * (1 / sp - (Number.isFinite(spb) ? 1 / spb : 0)), quote: L * (sp - spa) };
}

/** Largest base quantity a swap can move before the range runs out (Infinity when it cannot). */
export function maxBase(pool: Pool, side: Side): number {
  const { L, sp, spa, spb } = pool;
  if (side === 'buy') return L * (1 / sp - (Number.isFinite(spb) ? 1 / spb : 0));
  return spa > 0 ? L * (1 / spa - 1 / sp) : Infinity;
}

/** Swap `qty` base: buy = base out of the pool (price rises), sell = base into the pool (price falls). */
export function swap(pool: Pool, side: Side, qty: number): Swap {
  const p0 = price(pool);
  if (!(qty > 0) || !(pool.L > 0)) return EMPTY(p0, qty);
  const cap = maxBase(pool, side);
  const take = Math.min(qty, cap * (1 - 1e-12));
  if (!(take > 0)) return { ...EMPTY(p0, qty), exhausted: true };
  const { L, sp } = pool;
  let sp1: number, quote: number;
  // Δy = L·|√p' − √p| = √p·√p'·Δx exactly — written as a product, not a difference, so a tiny
  // order on a deep pool keeps full precision (the difference form loses ~8 digits)
  if (side === 'buy') sp1 = 1 / (1 / sp - take / L);        // Δx = L(1/√p − 1/√p')
  else sp1 = 1 / (1 / sp + take / L);                       // Δx = L(1/√p' − 1/√p)
  quote = sp * sp1 * take;
  const unfilled = qty - take;
  return { filled: take, quote, avg: quote / take, p0, p1: sp1 * sp1, unfilled: unfilled > qty * 1e-9 ? unfilled : 0, exhausted: take < qty * (1 - 1e-9) };
}

/** Base quantity that moves the marginal price from p to `limit` (0 if the limit is on the wrong side). */
export function baseToPrice(pool: Pool, side: Side, limit: number): number {
  if (!(limit > 0)) return 0;
  const { L, sp } = pool, sl = Math.sqrt(limit);
  const q = side === 'buy' ? (sl > sp ? L * (1 / sp - 1 / Math.min(sl, pool.spb)) : 0)
    : (sl < sp ? L * (1 / Math.max(sl, pool.spa) - 1 / sp) : 0);
  return Math.max(0, q);
}

/** The pool moved to a new marginal price (liquidity and range unchanged) — for arbitrage recovery. */
export function atPrice(pool: Pool, p: number): Pool {
  const sp = Math.min(Math.max(Math.sqrt(p), pool.spa), pool.spb);
  return { ...pool, sp };
}

/** Price impact of a swap, percent: how far the AVERAGE price sits from the pre-trade price. */
export function impactPct(s: Swap): number {
  return s.filled > 0 && s.p0 > 0 ? Math.abs(s.avg / s.p0 - 1) * 100 : 0;
}

/** How far the MARGINAL price moved, percent (what the next trader sees). */
export function priceMovePct(s: Swap): number {
  return s.p0 > 0 ? Math.abs(s.p1 / s.p0 - 1) * 100 : 0;
}
