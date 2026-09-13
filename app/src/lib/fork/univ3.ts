/**
 * Uniswap-v3-style pools: slot0, the pool's liquidity and its fee tier.
 *
 * A v3 pool's price is a Q64.96 square root, and its depth is the liquidity of the tick range the
 * price sits in — not the whole balance. Both are read here; how far that liquidity reaches is
 * bounded in market.ts by what the pool actually HOLDS, because ticks beyond the current range
 * cannot be enumerated without walking the tick bitmap, and a quote that pretended otherwise
 * would be wrong in exactly the interesting case.
 */
import { decodeTuple } from './abi-decode';
import { encodeCall } from './abi-encode';
import { selectorOf } from './abi-sig';
import { hexToBytes } from './hex';
import type { Call } from './erc20';

export const V3SIG = {
  slot0: 'slot0()', liquidity: 'liquidity()', fee: 'fee()', tickSpacing: 'tickSpacing()',
  token0: 'token0()', token1: 'token1()',
  /** the router's single-hop exact-in swap; the argument is one static struct */
  exactInputSingle: 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))',
} as const;

export const EXACT_INPUT_SINGLE_TYPES = ['address', 'address', 'uint24', 'address', 'uint256', 'uint256', 'uint256', 'uint160'] as const;

const call = (to: string, sig: string): Call => ({ to, data: encodeCall(selectorOf(sig), [], []) });

export const v3 = {
  slot0: (pool: string): Call => call(pool, V3SIG.slot0),
  liquidity: (pool: string): Call => call(pool, V3SIG.liquidity),
  fee: (pool: string): Call => call(pool, V3SIG.fee),
  token0: (pool: string): Call => call(pool, V3SIG.token0),
  token1: (pool: string): Call => call(pool, V3SIG.token1),
};

export interface Slot0 { readonly sqrtPriceX96: bigint; readonly tick: number }

export function decodeSlot0(hex: string): Slot0 {
  const v = decodeTuple(['uint160', 'int24', 'uint16', 'uint16', 'uint16', 'uint8', 'bool'], hexToBytes(hex));
  return { sqrtPriceX96: v[0] as bigint, tick: Number(v[1] as bigint) };
}

/** token1 per token0, in human units: (sqrtP/2^96)² × 10^(dec0−dec1). */
export function priceFromSqrt(sqrtPriceX96: bigint, dec0: number, dec1: number): number {
  const q96 = Math.pow(2, 96);
  const sp = Number(sqrtPriceX96) / q96;
  return sp * sp * Math.pow(10, dec0 - dec1);
}

/** L in human √(token0·token1) units: the raw L scaled out of both tokens' decimals. */
export function liquidityHuman(liquidityRaw: bigint, dec0: number, dec1: number): number {
  return Number(liquidityRaw) / Math.pow(10, (dec0 + dec1) / 2);
}

/** A v3 fee tier (parts per million) as basis points: 3000 → 30 bp. */
export const feeBpsOf = (feePpm: number): number => feePpm / 100;
