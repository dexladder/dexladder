/**
 * A pool read from the node → the curve the paper engine already knows how to trade on.
 *
 * amm.ts describes a pool as liquidity L over a price range, and that is exactly what both pool
 * shapes reduce to:
 *   v2   full range. L = √(base·quote) from the pair's OWN reserves, price = quote/base.
 *   v3   concentrated. L is the current tick range's liquidity; the range is bounded by what the
 *        pool actually holds (√pa = √p − quote/L, 1/√pb = 1/√p − base/L), so a swap can never take
 *        more of a token than the contract has — the honest limit of a single-tick reading.
 * Nothing here invents depth: every number comes from a call the panel can show you.
 */
import type { Pool } from '../paper-engine/amm';
import type { TokenInfo } from './erc20';
import { toFloat } from './units';
import { V2_FEE_BPS } from './univ2';

export type PoolKind = 'v2' | 'v3';

export interface ForkPool {
  readonly kind: PoolKind;
  readonly address: string;
  /** the token an order's amount is denominated in */
  readonly base: TokenInfo;
  readonly quote: TokenInfo;
  readonly baseIsToken0: boolean;
  /** swap fee in basis points (v2 pairs are 30 unless the fork's fork says otherwise) */
  readonly feeBps: number;
  /** quote per base, human units */
  readonly price: number;
  readonly baseHeld: number;
  readonly quoteHeld: number;
  readonly pool: Pool;
  /** pool value in quote units (both sides) */
  readonly tvlQuote: number;
  readonly blockNumber: number;
  /** the tick's own liquidity, for a v3 pool (0 for v2) */
  readonly liquidity: number;
}

const EPS = 1e-30;

/** A v2 pair from its reserves. Full range: x·y = k, exactly the pair's invariant. */
export function v2Pool(address: string, t0: TokenInfo, t1: TokenInfo, r0: bigint, r1: bigint, baseIsToken0: boolean, blockNumber: number, feeBps = V2_FEE_BPS): ForkPool | null {
  const base = baseIsToken0 ? t0 : t1, quote = baseIsToken0 ? t1 : t0;
  const b = toFloat(baseIsToken0 ? r0 : r1, base.decimals), q = toFloat(baseIsToken0 ? r1 : r0, quote.decimals);
  if (!(b > EPS) || !(q > EPS)) return null;
  const price = q / b;
  return {
    kind: 'v2', address, base, quote, baseIsToken0, feeBps, price, baseHeld: b, quoteHeld: q,
    pool: { L: Math.sqrt(b * q), sp: Math.sqrt(price), spa: 0, spb: Infinity },
    tvlQuote: 2 * q, blockNumber, liquidity: 0,
  };
}

/**
 * A v3 pool from slot0, its liquidity and its real balances. `priceToken1PerToken0` and
 * `liquidityHumanUnits` are computed by univ3.ts from the same two readings.
 */
export function v3Pool(address: string, t0: TokenInfo, t1: TokenInfo, priceToken1PerToken0: number, liquidityHumanUnits: number, bal0: bigint, bal1: bigint, baseIsToken0: boolean, feePpm: number, blockNumber: number): ForkPool | null {
  const base = baseIsToken0 ? t0 : t1, quote = baseIsToken0 ? t1 : t0;
  const price = baseIsToken0 ? priceToken1PerToken0 : (priceToken1PerToken0 > EPS ? 1 / priceToken1PerToken0 : 0);
  const L = liquidityHumanUnits;
  if (!(price > EPS) || !(L > EPS)) return null;
  const b = toFloat(baseIsToken0 ? bal0 : bal1, base.decimals), q = toFloat(baseIsToken0 ? bal1 : bal0, quote.decimals);
  const sp = Math.sqrt(price);
  // the range the held balances imply; a side the pool holds more than L explains is left open
  const spa = Math.max(0, sp - q / L);
  const invB = 1 / sp - b / L;
  const spb = invB > 1 / (sp * 1e6) ? 1 / invB : Infinity;
  return {
    kind: 'v3', address, base, quote, baseIsToken0, feeBps: feePpm / 100, price, baseHeld: b, quoteHeld: q,
    pool: { L, sp, spa, spb }, tvlQuote: q + b * price, blockNumber, liquidity: L,
  };
}

/** "WETH / USDC · v3 0.30% · 0x1234…cdef" — one line that names everything the quote depends on. */
export function poolLabel(p: ForkPool): string {
  return p.base.symbol + ' / ' + p.quote.symbol + ' · ' + p.kind + ' ' + (p.feeBps / 100).toFixed(2) + '% fee';
}

/** What the engine needs: the pool's own price is the market's mid, in quote units. */
export interface ForkVenue {
  readonly pool: Pool;
  readonly mid: number;
  readonly feeRate: number;
  /** pool value in ITS OWN quote token — a node has no dollar feed, so nothing here is USD */
  readonly tvlQuote: number;
  readonly quoteSymbol: string;
  readonly baseSymbol: string;
  readonly label: string;
  readonly kind: PoolKind;
  readonly address: string;
  readonly blockNumber: number;
}

export function forkVenue(p: ForkPool): ForkVenue {
  return {
    pool: p.pool, mid: p.price, feeRate: p.feeBps / 10000, tvlQuote: p.tvlQuote,
    quoteSymbol: p.quote.symbol, baseSymbol: p.base.symbol, label: poolLabel(p), kind: p.kind,
    address: p.address, blockNumber: p.blockNumber,
  };
}
