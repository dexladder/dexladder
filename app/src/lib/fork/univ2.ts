/**
 * Uniswap-v2-style pairs: the calls that read one, and the integer swap math the pair itself uses.
 *
 * amountOut is the contract's arithmetic, not a float approximation of it — so what the panel
 * quotes is what the pair will return, to the last base unit, for the reserves it was read at.
 */
import { decodeTuple } from './abi-decode';
import { encodeCall } from './abi-encode';
import { selectorOf } from './abi-sig';
import { ZERO } from './bi';
import { hexToBytes } from './hex';
import type { Call } from './erc20';

export const V2SIG = {
  getReserves: 'getReserves()', token0: 'token0()', token1: 'token1()', factory: 'factory()',
  totalSupply: 'totalSupply()', swap: 'swap(uint256,uint256,address,bytes)',
} as const;

const call = (to: string, sig: string, types: readonly string[] = [], args: readonly unknown[] = []): Call =>
  ({ to, data: encodeCall(selectorOf(sig), types, args as never) });

export const v2 = {
  getReserves: (pair: string): Call => call(pair, V2SIG.getReserves),
  token0: (pair: string): Call => call(pair, V2SIG.token0),
  token1: (pair: string): Call => call(pair, V2SIG.token1),
  factory: (pair: string): Call => call(pair, V2SIG.factory),
  /** the low-level swap: tokens must already have been sent to the pair (this is what a router does) */
  swap: (pair: string, amount0Out: bigint, amount1Out: bigint, to: string): Call =>
    call(pair, V2SIG.swap, ['uint256', 'uint256', 'address', 'bytes'], [amount0Out, amount1Out, to, '0x']),
};

export interface Reserves { readonly r0: bigint; readonly r1: bigint; readonly updatedAt: number }

export function decodeReserves(hex: string): Reserves {
  const [r0, r1, t] = decodeTuple(['uint112', 'uint112', 'uint32'], hexToBytes(hex));
  return { r0: r0 as bigint, r1: r1 as bigint, updatedAt: Number(t as bigint) };
}

export const V2_FEE_BPS = 30;

/** UniswapV2Library.getAmountOut, exactly: floor arithmetic, fee taken off the input. */
export function amountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps = V2_FEE_BPS): bigint {
  if (amountIn <= ZERO || reserveIn <= ZERO || reserveOut <= ZERO) return ZERO;
  const bps = BigInt(10000), keep = BigInt(10000 - feeBps);
  const inAfterFee = amountIn * keep;
  return (inAfterFee * reserveOut) / (reserveIn * bps + inAfterFee);
}

/** UniswapV2Library.getAmountIn: what must be sent in to get `out` (rounded up, as the library does). */
export function amountIn(out: bigint, reserveIn: bigint, reserveOut: bigint, feeBps = V2_FEE_BPS): bigint {
  if (out <= ZERO || reserveIn <= ZERO || reserveOut <= out) return ZERO;
  const bps = BigInt(10000), keep = BigInt(10000 - feeBps);
  return (reserveIn * out * bps) / ((reserveOut - out) * keep) + BigInt(1);
}
