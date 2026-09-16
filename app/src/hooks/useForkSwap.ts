/**
 * useForkSwap — a REAL swap on the user's node, planned before it is sent.
 *
 * The plan is the whole point: every step is named and shown (an approval only when the allowance
 * is short, then the swap), the minimum output is derived from the trader's own slippage tolerance,
 * and each step is dry-run by useForkNode before it is signed. The node signs with an account it
 * has unlocked — no key ever enters DexLadder.
 *
 * Three routes, in the order they are preferred:
 *   router-v2  approve + swapExactTokensForTokens (a router address was given)
 *   pair-v2    transfer to the pair + pair.swap — the router-free path, exactly what a router does
 *   router-v3  approve + exactInputSingle (a v3 pool cannot be swapped from an EOA without one)
 */
import type { AbiCustomError } from '../lib/fork/abi-json';
import { decodeLog } from '../lib/fork/abi-decode';
import { encodeCall } from '../lib/fork/abi-encode';
import { parseEvent, selectorOf } from '../lib/fork/abi-sig';
import { erc20 } from '../lib/fork/erc20';
import { isAddress } from '../lib/fork/hex';
import type { ForkPool } from '../lib/fork/market';
import { formatUnits, parseUnits } from '../lib/fork/units';
import { amountOut, v2 } from '../lib/fork/univ2';
import { EXACT_INPUT_SINGLE_TYPES, V3SIG } from '../lib/fork/univ3';
import type { Receipt, TxRequest } from '../lib/fork/tx';
import type { ForkNode } from './useForkNode';
import type { Side } from '../lib/paper-engine/types';

export const TRANSFER = parseEvent('event Transfer(address indexed from, address indexed to, uint256 value)');

export class SwapError extends Error {}

export interface SwapStep { readonly label: string; readonly tx: TxRequest }
export interface SwapPlan {
  readonly route: 'router-v2' | 'pair-v2' | 'router-v3';
  readonly steps: readonly SwapStep[];
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly amountIn: bigint;
  readonly expectedOut: bigint;
  readonly minOut: bigint;
  readonly decimalsIn: number;
  readonly decimalsOut: number;
  readonly note: string;
}

export interface PlanInput {
  readonly pool: ForkPool;
  readonly side: Side;
  /** what the trader sends, in the input token's own units ("1.5") */
  readonly amount: string;
  readonly slippagePct: number;
  readonly from: string;
  readonly router: string;
  readonly allowance: bigint;
  /** unix seconds for the router deadline (the clock belongs to the caller) */
  readonly deadline: number;
}

/** Plan a swap. Throws SwapError with the reason it cannot be planned. */
export function planSwap(inp: PlanInput): SwapPlan {
  const p = inp.pool, buy = inp.side === 'buy';
  const tIn = buy ? p.quote : p.base, tOut = buy ? p.base : p.quote;
  if (!isAddress(inp.from)) throw new SwapError('no unlocked account to send from');
  const amountIn = parseUnits(inp.amount, tIn.decimals);
  if (amountIn <= BigInt(0)) throw new SwapError('enter an amount of ' + tIn.symbol + ' to send');
  // reserves in the direction of this swap, from the same reading the quote used
  const resIn = BigInt(Math.floor((buy ? p.quoteHeld : p.baseHeld) * Math.pow(10, tIn.decimals)));
  const resOut = BigInt(Math.floor((buy ? p.baseHeld : p.quoteHeld) * Math.pow(10, tOut.decimals)));
  const slip = Math.max(0, Math.min(50, inp.slippagePct));
  const expectedOut = p.kind === 'v2' ? amountOut(amountIn, resIn, resOut, p.feeBps) : BigInt(0);
  const cut = (bps: number): bigint => (expectedOut > BigInt(0) ? (expectedOut * BigInt(Math.round(10000 - bps))) / BigInt(10000) : BigInt(0));
  // A router swap is atomic, so the trader's tolerance is exactly the right floor. The router-free
  // path is TWO transactions — the input has already landed in the pair when the swap is asked for —
  // so it must not revert: it asks for 5 bp under the curve, not a whole tolerance under it.
  const ROUTERLESS_MARGIN_BPS = 5;
  const minOut = cut(slip * 100);
  const steps: SwapStep[] = [];
  const approve = (spender: string): void => {
    if (inp.allowance < amountIn) steps.push({ label: 'approve ' + tIn.symbol, tx: { from: inp.from, to: tIn.address, data: erc20.approve(tIn.address, spender, amountIn).data } });
  };
  if (p.kind === 'v3') {
    if (!isAddress(inp.router)) throw new SwapError('a v3 pool cannot be swapped from a plain account: paste your SwapRouter address (it calls back into the pool, which an EOA cannot do)');
    approve(inp.router);
    const args = [tIn.address, tOut.address, Math.round(p.feeBps * 100), inp.from, inp.deadline, amountIn, minOut, 0];
    steps.push({ label: 'exactInputSingle on the router', tx: { from: inp.from, to: inp.router, data: encodeCall(selectorOf(V3SIG.exactInputSingle), EXACT_INPUT_SINGLE_TYPES, args) } });
    return { route: 'router-v3', steps, tokenIn: tIn.address, tokenOut: tOut.address, amountIn, expectedOut, minOut, decimalsIn: tIn.decimals, decimalsOut: tOut.decimals, note: 'The router quotes and swaps; the minimum out is your tolerance applied to the pool price read at block ' + p.blockNumber + '.' };
  }
  if (isAddress(inp.router)) {
    approve(inp.router);
    const data = encodeCall(selectorOf('swapExactTokensForTokens(uint256,uint256,address[],address,uint256)'),
      ['uint256', 'uint256', 'address[]', 'address', 'uint256'], [amountIn, minOut, [tIn.address, tOut.address], inp.from, inp.deadline]);
    steps.push({ label: 'swapExactTokensForTokens', tx: { from: inp.from, to: inp.router, data } });
    return { route: 'router-v2', steps, tokenIn: tIn.address, tokenOut: tOut.address, amountIn, expectedOut, minOut, decimalsIn: tIn.decimals, decimalsOut: tOut.decimals, note: 'Router path ' + tIn.symbol + ' → ' + tOut.symbol + ', minimum out ' + formatUnits(minOut, tOut.decimals, 8) + ' ' + tOut.symbol + '.' };
  }
  // router-free: send the input to the pair, then ask the pair for the output (what every router does)
  const outIsToken0 = p.baseIsToken0 ? buy : !buy;
  const take = cut(ROUTERLESS_MARGIN_BPS);
  steps.push({ label: 'transfer ' + tIn.symbol + ' to the pair', tx: { from: inp.from, to: tIn.address, data: erc20.transfer(tIn.address, p.address, amountIn).data } });
  steps.push({ label: 'pair.swap', tx: { from: inp.from, to: p.address, data: v2.swap(p.address, outIsToken0 ? take : BigInt(0), outIsToken0 ? BigInt(0) : take, inp.from).data } });
  return {
    route: 'pair-v2', steps, tokenIn: tIn.address, tokenOut: tOut.address, amountIn, expectedOut, minOut: take,
    decimalsIn: tIn.decimals, decimalsOut: tOut.decimals,
    note: 'No router given, so the sandbox does what a router does: transfer in, then ask the pair for ' + formatUnits(take, tOut.decimals, 8) + ' ' + tOut.symbol +
      ' — 5 bp under the curve, because in two separate transactions the input has already landed in the pair when the swap is asked for, and a swap that reverts there would leave it donated. A router address makes it atomic and pays the full output.',
  };
}

export interface SwapOutcome {
  readonly done: readonly { readonly label: string; readonly hash: string; readonly receipt: Receipt | null }[];
  readonly failed: string;
  readonly gasUsed: bigint;
  readonly gasWei: bigint;
  /** what the account actually received, read from the Transfer logs */
  readonly received: bigint;
  readonly sent: bigint;
}

/** Run a plan step by step. Stops at the first failure and says which step it was. */
export async function runSwap(node: ForkNode, plan: SwapPlan, from: string, errors: readonly AbiCustomError[] = []): Promise<SwapOutcome> {
  const done: { label: string; hash: string; receipt: Receipt | null }[] = [];
  let gasUsed = BigInt(0), gasWei = BigInt(0), received = BigInt(0), sent = BigInt(0), failed = '';
  const me = from.toLowerCase();
  for (const step of plan.steps) {
    let r;
    try { r = await node.sendTx(step.tx, errors); }
    catch (e) { failed = step.label + ': ' + (e instanceof Error ? e.message : String(e)); break; }
    done.push({ label: step.label, hash: r.hash, receipt: r.receipt });
    if (r.receipt) {
      gasUsed += r.receipt.gasUsed;
      gasWei += r.receipt.gasUsed * r.receipt.gasPriceWei;
      for (const log of r.receipt.logs) {
        if ((log.topics[0] || '').toLowerCase() !== TRANSFER.topic.toLowerCase()) continue;
        const v = decodeLog(TRANSFER, log.topics, log.data);
        const value = BigInt(v.value || '0');
        if (log.address.toLowerCase() === plan.tokenOut.toLowerCase() && String(v.to || '').toLowerCase() === me) received += value;
        if (log.address.toLowerCase() === plan.tokenIn.toLowerCase() && String(v.from || '').toLowerCase() === me) sent += value;
      }
      if (!r.receipt.ok) { failed = step.label + ' reverted' + (r.revert.kind !== 'none' ? ': ' + r.revert.text : ''); break; }
    }
  }
  return { done, failed, gasUsed, gasWei, received, sent };
}
