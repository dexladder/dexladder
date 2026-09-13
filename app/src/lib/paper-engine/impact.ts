/**
 * The price-impact model: which pool an order meets, and what its size does to the price.
 *
 * Every Advanced-mode order is priced on an AMM curve (amm.ts). The pool's depth comes from the
 * coin's own market data:
 *
 *   order-book venues (Binance, Coinbase, Kraken, Hyperliquid)
 *       a "virtual" constant-product pool as deep as the synthetic book: the book rests
 *       depthUSD within ±0.1% of mid, and a full-range pool of value V rests V·0.001/4 there,
 *       so V = 4000 × depthUSD. Impact on these venues therefore matches the book's depth.
 *   DEX (AMM) venue
 *       a real-sized pool: 2% of 24h volume, at least $25,000 — on-chain pools are far thinner
 *       than exchange books, which is the lesson.
 *
 * The old Pro-mode "thin-liquidity penalty" (a flat 1.4–16 bp added to the preview only) is folded
 * in here as a DEPTH multiplier from the same volume ÷ market-cap tiers: a thin coin's pool is
 * shallower, so size moves it more — and a small order still pays almost nothing. One number,
 * used by the preview and the fill alike.
 */
import type { MarketStats, Side } from './types';
import { depthUSD } from './book';
import { thinLiquidityBps } from './venues';
import { poolFromTVL, swap, impactPct, priceMovePct, baseToPrice, type Pool, type Swap } from './amm';

export const DEX_TVL_PER_VOL = 0.02;
export const DEX_MIN_TVL = 25_000;
export const VIRTUAL_POOL_PER_DEPTH = 4000;
/** the reference tier (liquid coin): its depth multiplier is exactly 1 */
export const REFERENCE_TIER_BPS = 1.4;
/** default slippage tolerance, percent (the value most DEX front-ends ship with) */
export const DEFAULT_TOLERANCE_PCT = 0.5;

export type PoolModel = 'cpmm' | 'concentrated';
export interface PoolSpec {
  /** pool value in USD */
  readonly tvlUSD: number;
  /** full range (constant product) or ±rangePct around the price */
  readonly model: PoolModel;
  readonly rangePct: number | null;
  /** the depth multiplier the thin-liquidity tier applied */
  readonly tier: number;
  readonly venueClass: 'book' | 'dex';
}

/** Depth multiplier for a coin's liquidity tier: 1 for a liquid coin, ~0.09 for the thinnest. */
export function tierFactor(stats: Pick<MarketStats, 'vol24' | 'mcap'>): number {
  return REFERENCE_TIER_BPS / thinLiquidityBps(stats.vol24 || 0, stats.mcap || 0);
}

/** The pool an order meets on `venue`. `rangePct` makes the DEX pool concentrated (e.g. 10 = ±10%). */
export function poolSpec(stats: MarketStats, venue: string, rangePct: number | null = null): PoolSpec {
  const tier = tierFactor(stats);
  if (venue === 'dexamm') {
    const vol = stats.vol24 > 0 ? stats.vol24 : stats.mcap > 0 ? 0.03 * stats.mcap : 0;
    const tvl = Math.max(DEX_MIN_TVL, DEX_TVL_PER_VOL * vol) * tier;
    return { tvlUSD: tvl, model: rangePct ? 'concentrated' : 'cpmm', rangePct: rangePct || null, tier, venueClass: 'dex' };
  }
  return { tvlUSD: VIRTUAL_POOL_PER_DEPTH * depthUSD(stats) * tier, model: 'cpmm', rangePct: null, tier, venueClass: 'book' };
}

/** Instantiate the spec at a price, with the pool's value expressed in the pair's quote asset. */
export function poolAt(spec: PoolSpec, price: number, quoteUSD: number): Pool | null {
  return poolFromTVL(price, spec.tvlUSD / (quoteUSD > 0 ? quoteUSD : 1), spec.rangePct);
}

export interface ImpactQuote {
  readonly swap: Swap;
  /** execution-price impact vs the pre-trade price, percent */
  readonly impactPct: number;
  /** how far the marginal price moved, percent */
  readonly movePct: number;
  /** filled / asked */
  readonly fillRatio: number;
}

/**
 * Price `qty` on `pool`. A limit caps the swap where the marginal price reaches it (the rest is
 * the order's remainder). Nothing here decides tolerance — see checkTolerance.
 */
export function quoteImpact(pool: Pool, side: Side, qty: number, limit = 0): ImpactQuote {
  const cap = limit > 0 ? baseToPrice(pool, side, limit) : Infinity;
  const s = swap(pool, side, Math.min(qty, cap));
  const unfilled = qty - s.filled;
  const full: Swap = { ...s, unfilled: unfilled > qty * 1e-9 ? unfilled : 0, exhausted: s.exhausted };
  return { swap: full, impactPct: impactPct(full), movePct: priceMovePct(full), fillRatio: qty > 0 ? full.filled / qty : 0 };
}

export type ToleranceCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** An order whose price impact is beyond the trader's tolerance fails — and says why, in words. */
export function checkTolerance(impact: number, tolerancePct: number): ToleranceCheck {
  if (!(tolerancePct > 0) || impact <= tolerancePct + 1e-12) return { ok: true };
  return {
    ok: false,
    reason: `Price impact ${fmtPct(impact)} exceeds your ${fmtPct(tolerancePct)} slippage tolerance. ` +
      (impact >= 100 ? 'Your order is bigger than this pool can supply at any sane price: it would drain the pool. Trade a fraction of the size.'
        : 'Your size is large for this pool: split the order, use a limit, or raise the tolerance if you accept the cost.'),
  };
}

/** A pool this small is not a market: orders against it are refused outright (nothing is sent). */
export const NEAR_ZERO_POOL_USD = 5_000;
/** A market order the pool can supply less than this share of is refused rather than filled as dust. */
export const MIN_FILL_FRACTION = 0.01;

/**
 * Near-zero liquidity, in words — or null when there is enough to trade. A limit order that fills
 * nothing right now is not a liquidity failure (it waits for its price); a market order is.
 */
export function nearZeroLiquidity(tvlUSD: number, filled: number, qty: number, market: boolean): string | null {
  if (tvlUSD < NEAR_ZERO_POOL_USD) {
    return `Near-zero liquidity: this pool holds only about $${Math.round(tvlUSD).toLocaleString('en-US')} — too little to trade against at a fair price. ` +
      'Nothing was sent. Real tokens like this are where traders get stuck: check pool depth before you buy.';
  }
  if (market && qty > 0 && filled < qty * MIN_FILL_FRACTION) {
    return `Near-zero liquidity at this price: the pool's range can supply only ${((filled / qty) * 100).toFixed(2)}% of your size. Nothing was sent.`;
  }
  return null;
}

export function fmtPct(x: number): string {
  if (x >= 1000) return '>1,000%';   // past this the pool is effectively emptied — a bigger number teaches nothing
  return (x >= 10 ? x.toFixed(1) : x >= 1 ? x.toFixed(2) : x.toFixed(x < 0.01 ? 4 : 3)) + '%';
}
