/**
 * ERC-20, as calls and decoders. Nothing here talks to a node: it produces `{to, data}` for
 * eth_call / eth_sendTransaction and reads the 32-byte answers back.
 *
 * `symbol()` and `name()` are decoded defensively because the standard was written after the
 * first tokens shipped: some early contracts return a bytes32, not a string, and a sandbox that
 * throws on those would be wrong about real chain state.
 */
import { decodeTuple, formatDecoded } from './abi-decode';
import { encodeCall } from './abi-encode';
import { selectorOf } from './abi-sig';
import { bytesToUtf8, hexToBytes, strip } from './hex';

export interface Call { readonly to: string; readonly data: string }

export const SIG = {
  name: 'name()', symbol: 'symbol()', decimals: 'decimals()', totalSupply: 'totalSupply()',
  balanceOf: 'balanceOf(address)', allowance: 'allowance(address,address)',
  approve: 'approve(address,uint256)', transfer: 'transfer(address,uint256)',
} as const;

const call = (to: string, sig: string, types: readonly string[] = [], args: readonly unknown[] = []): Call =>
  ({ to, data: encodeCall(selectorOf(sig), types, args as never) });

export const erc20 = {
  name: (token: string): Call => call(token, SIG.name),
  symbol: (token: string): Call => call(token, SIG.symbol),
  decimals: (token: string): Call => call(token, SIG.decimals),
  totalSupply: (token: string): Call => call(token, SIG.totalSupply),
  balanceOf: (token: string, who: string): Call => call(token, SIG.balanceOf, ['address'], [who]),
  allowance: (token: string, owner: string, spender: string): Call => call(token, SIG.allowance, ['address', 'address'], [owner, spender]),
  approve: (token: string, spender: string, amount: bigint): Call => call(token, SIG.approve, ['address', 'uint256'], [spender, amount]),
  transfer: (token: string, to: string, amount: bigint): Call => call(token, SIG.transfer, ['address', 'uint256'], [to, amount]),
};

export function decodeUint(hex: string): bigint {
  return decodeTuple(['uint256'], hexToBytes(hex))[0] as bigint;
}

/** A `decimals()` answer, clamped to something a token can plausibly have. */
export function decodeDecimals(hex: string): number {
  const n = Number(decodeUint(hex));
  return Number.isFinite(n) && n >= 0 && n <= 36 ? Math.trunc(n) : 18;
}

/** `string` when the token follows the standard, `bytes32` when it predates it, hex as a last resort. */
export function decodeText(hex: string): string {
  const raw = strip(hex);
  if (!raw) return '';
  try {
    const s = decodeTuple(['string'], hexToBytes(hex))[0];
    if (typeof s === 'string' && s.length) return s;
  } catch (e) { /* not a string return — try bytes32 below */ }
  if (raw.length === 64) {
    const trimmed = bytesToUtf8(hexToBytes('0x' + raw).filter(b => b !== 0) as unknown as Uint8Array);
    if (/^[\x20-\x7e]+$/.test(trimmed)) return trimmed;
  }
  return '';
}

export interface TokenInfo {
  readonly address: string;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
}

/** Everything the panel needs about a token, from four raw answers. */
export function tokenInfo(address: string, symbolHex: string, nameHex: string, decimalsHex: string): TokenInfo {
  const symbol = decodeText(symbolHex), name = decodeText(nameHex);
  return { address, symbol: symbol || '???', name: name || symbol || 'unnamed token', decimals: decodeDecimals(decimalsHex) };
}

export const showAmount = (v: bigint): string => formatDecoded(v);
