/**
 * useForkPool — read ONE pool contract and hand back the curve the paper engine trades on.
 *
 * The shape is detected, not asked for: a contract that answers getReserves() with three packed
 * fields is a v2-style pair; one that answers slot0() is v3-style. Everything after that is the
 * contract's own state — token addresses, decimals, reserves or liquidity, the fee tier — so the
 * depth a quote is priced against is depth that exists on the node.
 */
import { erc20, tokenInfo, type TokenInfo } from '../lib/fork/erc20';
import { isAddress } from '../lib/fork/hex';
import { v2Pool, v3Pool, type ForkPool } from '../lib/fork/market';
import { decodeReserves, v2, V2_FEE_BPS } from '../lib/fork/univ2';
import { decodeSlot0, liquidityHuman, priceFromSqrt, v3 } from '../lib/fork/univ3';
import { decodeUint } from '../lib/fork/erc20';
import type { ForkNode } from './useForkNode';

/** Symbols that read as the money side of a pair, so the ticket's price is the one a trader expects. */
const QUOTEY = /^(W?ETH|USDC|USDT|DAI|FRAX|USDS|LUSD|BUSD|TUSD|USDE|W?BTC|WBNB|WMATIC|WAVAX)$/i;

export class PoolError extends Error {}

async function token(node: ForkNode, address: string): Promise<TokenInfo> {
  const [sym, name, dec] = await node.callMany([erc20.symbol(address), erc20.name(address), erc20.decimals(address)]);
  return tokenInfo(address, sym || '', name || '', dec || '0x12');
}

/** token1 is the quote unless the symbols say otherwise; `flip` is the trader's override. */
export function quoteIsToken1(t0: TokenInfo, t1: TokenInfo): boolean {
  const q0 = QUOTEY.test(t0.symbol), q1 = QUOTEY.test(t1.symbol);
  if (q1 === q0) return true;
  return q1;
}

export interface PoolRead { readonly pool: ForkPool; readonly kind: 'v2' | 'v3'; readonly raw: Record<string, string> }

/** Read `address` as a pool. Throws PoolError with what the contract did or did not answer. */
export async function loadPool(node: ForkNode, address: string, flip = false, feeBpsOverride: number | null = null): Promise<PoolRead> {
  if (!isAddress(address)) throw new PoolError('that is not a contract address (0x + 40 hex digits)');
  const block = await node.blockNumber();
  const [t0a, t1a, reserves, slot0, liq, fee] = await node.callMany([
    v2.token0(address), v2.token1(address), v2.getReserves(address), v3.slot0(address), v3.liquidity(address), v3.fee(address),
  ]);
  if (!t0a || !t1a) throw new PoolError('no token0()/token1() on that address — it is not a Uniswap-style pool (or the address is wrong for this chain)');
  const token0 = '0x' + t0a.slice(-40), token1 = '0x' + t1a.slice(-40);
  const [t0, t1] = await Promise.all([token(node, token0), token(node, token1)]);
  const baseIsToken0 = !flip ? quoteIsToken1(t0, t1) : !quoteIsToken1(t0, t1);
  const raw: Record<string, string> = { token0, token1, reserves: reserves || '', slot0: slot0 || '' };
  if (reserves && reserves.length >= 2 + 192) {
    const r = decodeReserves(reserves);
    const p = v2Pool(address, t0, t1, r.r0, r.r1, baseIsToken0, block, feeBpsOverride ?? V2_FEE_BPS);
    if (!p) throw new PoolError('that pair holds no liquidity on this node (both reserves are zero) — add liquidity first');
    return { pool: p, kind: 'v2', raw };
  }
  if (slot0 && liq) {
    const s = decodeSlot0(slot0), liquidity = decodeUint(liq);
    const feePpm = fee ? Number(decodeUint(fee)) : 3000;
    const [b0, b1] = await node.callMany([erc20.balanceOf(token0, address), erc20.balanceOf(token1, address)]);
    const p = v3Pool(address, t0, t1,
      priceFromSqrt(s.sqrtPriceX96, t0.decimals, t1.decimals), liquidityHuman(liquidity, t0.decimals, t1.decimals),
      b0 ? decodeUint(b0) : BigInt(0), b1 ? decodeUint(b1) : BigInt(0), baseIsToken0,
      feeBpsOverride != null ? feeBpsOverride * 100 : feePpm, block);
    if (!p) throw new PoolError('that pool has no liquidity in the current tick range on this node — a quote would be meaningless');
    return { pool: p, kind: 'v3', raw: { ...raw, liquidity: liq, fee: fee || '' } };
  }
  throw new PoolError('it answers token0()/token1() but neither getReserves() (v2) nor slot0()+liquidity() (v3) — the sandbox cannot price it');
}

/** Balances of both of the pool's tokens for one account, for the panel's wallet row. */
export async function poolBalances(node: ForkNode, p: ForkPool, who: string): Promise<{ base: bigint; quote: bigint }> {
  const [b, q] = await node.callMany([erc20.balanceOf(p.base.address, who), erc20.balanceOf(p.quote.address, who)]);
  return { base: b ? decodeUint(b) : BigInt(0), quote: q ? decodeUint(q) : BigInt(0) };
}
