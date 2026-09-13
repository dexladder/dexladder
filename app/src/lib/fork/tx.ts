/**
 * Transaction and log shapes, as the JSON-RPC sends and returns them. Pure: quantities in, 0x
 * strings out, and the receipt read back with every field the panel reports (status, gas actually
 * used, the price it actually paid, and the logs to decode).
 */
import { hexToBigInt, toQuantity, toSafeNumber } from './hex';

export interface TxRequest {
  readonly from: string;
  readonly to?: string;
  readonly data?: string;
  readonly value?: bigint;
  readonly gas?: bigint;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The `params[0]` object for eth_call / eth_estimateGas / eth_sendTransaction. */
export function txParams(tx: TxRequest): Record<string, string> {
  const o: Record<string, string> = { from: tx.from };
  if (tx.to) o.to = tx.to;
  if (tx.data) o.data = tx.data;
  if (tx.value != null) o.value = toQuantity(tx.value);
  if (tx.gas != null) o.gas = toQuantity(tx.gas);
  return o;
}

export interface RawLog { readonly address: string; readonly topics: readonly string[]; readonly data: string; readonly blockNumber: number; readonly index: number }

export interface Receipt {
  readonly hash: string;
  readonly ok: boolean;
  readonly gasUsed: bigint;
  readonly gasPriceWei: bigint;
  readonly blockNumber: number;
  readonly contractAddress: string;
  readonly logs: readonly RawLog[];
}

const num = (v: unknown): number => (typeof v === 'string' ? toSafeNumber(hexToBigInt(v)) ?? 0 : typeof v === 'number' ? v : 0);

export function readLog(o: any): RawLog {
  return {
    address: String((o && o.address) || ''),
    topics: Array.isArray(o && o.topics) ? o.topics.map((t: unknown) => String(t)) : [],
    data: String((o && o.data) || '0x'),
    blockNumber: num(o && o.blockNumber),
    index: num(o && o.logIndex),
  };
}

export function readReceipt(o: any): Receipt | null {
  if (!o || typeof o !== 'object') return null;
  return {
    hash: String(o.transactionHash || ''),
    // pre-Byzantium receipts have no status field; every dev node writes one
    ok: String(o.status || '0x1') !== '0x0',
    gasUsed: hexToBigInt(String(o.gasUsed || '0x0')),
    gasPriceWei: hexToBigInt(String(o.effectiveGasPrice || o.gasPrice || '0x0')),
    blockNumber: num(o.blockNumber),
    contractAddress: o.contractAddress ? String(o.contractAddress) : '',
    logs: Array.isArray(o.logs) ? o.logs.map(readLog) : [],
  };
}

/** wei → gwei, for display and for the gas model (which thinks in gwei). */
export const toGwei = (wei: bigint): number => Number(wei) / 1e9;
