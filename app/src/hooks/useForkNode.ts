/**
 * useForkNode — the presenter over ONE JSON-RPC endpoint: the user's own node.
 *
 * It owns sequencing and nothing else. The transport is injected (`send`), so the typed core stays
 * free of network code and a test can drive a scripted node with no browser at all; the clock and
 * the delay between receipt polls are injected for the same reason.
 *
 * Two rules are structural, not optional:
 *   · every write is dry-run with eth_call first, so a revert is a sentence BEFORE a transaction
 *     is signed — and if a sent transaction still fails, the same call re-runs to explain it;
 *   · nothing is ever signed here. The node signs, from an account it already has unlocked, so
 *     DexLadder never holds a key.
 */
import { decodeRevert, type Revert } from '../lib/fork/abi-decode';
import type { AbiCustomError } from '../lib/fork/abi-json';
import { diagnose, isLoopback, writePolicy, type Finding, type NodeFacts } from '../lib/fork/doctor';
import { hexToBigInt, toSafeNumber } from '../lib/fork/hex';
import { bodyOf, faultText, parseBatch, parseResponse, request, type RpcFault } from '../lib/fork/rpc';
import { readReceipt, toGwei, txParams, type RawLog, type Receipt, type TxRequest } from '../lib/fork/tx';

export type RpcSend = (body: string) => Promise<string>;
export interface ForkNodeDeps { readonly send: RpcSend; now(): number; wait(ms: number): Promise<void> }

export class NodeError extends Error {
  readonly fault: RpcFault;
  readonly revert: Revert;
  constructor(fault: RpcFault, revert: Revert = { kind: 'none' }) {
    super(revert.kind !== 'none' ? revert.text : faultText(fault));
    this.fault = fault;
    this.revert = revert;
  }
}

export interface NodeStatus {
  readonly facts: NodeFacts;
  readonly findings: readonly Finding[];
  readonly writes: { readonly ok: boolean; readonly why: string };
  readonly gwei: number;
  readonly at: number;
}

export interface SendResult { readonly hash: string; readonly receipt: Receipt | null; readonly revert: Revert }

/* eslint-disable @typescript-eslint/no-explicit-any */
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const numOf = (v: unknown): number | null => (typeof v === 'string' && /^0x/i.test(v) ? toSafeNumber(hexToBigInt(v)) : typeof v === 'number' ? v : null);

export function useForkNode(deps: ForkNodeDeps) {
  let id = 0;
  const next = (): number => (id = (id + 1) % 1e9);

  /** One call. Throws NodeError (with a decoded revert when the node returned revert data). */
  async function rpc(method: string, params: readonly unknown[] = [], errors: readonly AbiCustomError[] = []): Promise<unknown> {
    let text: string;
    try { text = await deps.send(bodyOf(request(next(), method, params))); }
    catch (e) { throw new NodeError({ kind: 'transport', message: e instanceof Error ? e.message : String(e) }); }
    const out = parseResponse(text);
    if (out.ok) return out.result;
    throw new NodeError(out.fault, out.fault.data ? decodeRevert(out.fault.data, errors) : { kind: 'none' });
  }

  /** A batch. Returns one outcome per request, in order — a failing member does not fail the rest. */
  async function batch(calls: readonly { readonly method: string; readonly params?: readonly unknown[] }[]) {
    if (!calls.length) return [];
    const reqs = calls.map(c => request(next(), c.method, c.params || []));
    let text: string;
    try { text = await deps.send(bodyOf(reqs)); }
    catch (e) { const f: RpcFault = { kind: 'transport', message: e instanceof Error ? e.message : String(e) }; return reqs.map(() => ({ ok: false as const, fault: f })); }
    return parseBatch(text, reqs.map(r => r.id));
  }

  const optional = async (method: string, params: readonly unknown[] = []): Promise<any> => {
    try { return await rpc(method, params); } catch (e) { return null; }
  };

  /** Who this node is, whether it can sign, and what to do about it if it cannot. */
  async function probe(url: string, pageSecure: boolean): Promise<NodeStatus> {
    const at = deps.now();
    const r = await batch([
      { method: 'web3_clientVersion' }, { method: 'eth_chainId' }, { method: 'eth_blockNumber' },
      { method: 'eth_accounts' }, { method: 'eth_gasPrice' },
    ]);
    const get = (i: number): unknown => { const x = r[i]; return x && x.ok ? x.result : null; };
    const firstFault = r.find(x => x && !x.ok);
    const reachable = r.some(x => x && x.ok);
    const accounts = Array.isArray(get(3)) ? (get(3) as unknown[]).map(str).filter(Boolean) : [];
    const anvil = reachable ? await optional('anvil_nodeInfo') : null;
    const hh = reachable && !anvil ? await optional('hardhat_metadata') : null;
    const forkCfg = (anvil && anvil.forkConfig) || null;
    const forkedNet = (hh && hh.forkedNetwork) || null;
    const facts: NodeFacts = {
      url, pageSecure, loopback: isLoopback(url), reachable,
      faultMessage: !reachable && firstFault && !firstFault.ok ? faultText(firstFault.fault) : '',
      chainId: numOf(get(1)), client: str(get(0)) || (anvil ? 'Anvil' : hh ? 'Hardhat' : ''), blockNumber: numOf(get(2)),
      accounts, devNode: !!(anvil || hh),
      forkUrl: str(forkCfg && forkCfg.forkUrl) || str(forkedNet && forkedNet.rpcUrl),
      forkBlock: numOf(forkCfg && forkCfg.forkBlockNumber) ?? numOf(forkedNet && forkedNet.forkBlockNumber),
      isFork: !!(str(forkCfg && forkCfg.forkUrl) || forkedNet),
    };
    const gweiRaw = get(4);
    return { facts, findings: diagnose(facts), writes: writePolicy(facts), gwei: typeof gweiRaw === 'string' ? toGwei(hexToBigInt(gweiRaw)) : 0, at };
  }

  /** eth_call. `errors` lets the contract's own custom errors name the failure. */
  const call = async (to: string, data: string, errors: readonly AbiCustomError[] = []): Promise<string> =>
    str(await rpc('eth_call', [{ to, data }, 'latest'], errors));

  /** Many eth_calls in one round trip; a member that reverts comes back as an empty string. */
  async function callMany(calls: readonly { readonly to: string; readonly data: string }[]): Promise<string[]> {
    const out = await batch(calls.map(c => ({ method: 'eth_call', params: [{ to: c.to, data: c.data }, 'latest'] })));
    return out.map(o => (o && o.ok ? str(o.result) : ''));
  }

  /**
   * Send a transaction the node signs. Dry-run first: a revert is reported without spending
   * anything. A transaction that reverts anyway is replayed as a call to get its reason.
   */
  async function sendTx(tx: TxRequest, errors: readonly AbiCustomError[] = [], polls = 40, everyMs = 250): Promise<SendResult> {
    const p = txParams(tx);
    await rpc('eth_call', [p, 'latest'], errors);   // a revert here costs nothing and says why
    const hash = str(await rpc('eth_sendTransaction', [p], errors));
    let receipt: Receipt | null = null;
    for (let i = 0; i < polls && !receipt; i++) {
      const raw = await optional('eth_getTransactionReceipt', [hash]);
      receipt = readReceipt(raw);
      if (!receipt) await deps.wait(everyMs);
    }
    let revert: Revert = { kind: 'none' };
    if (receipt && !receipt.ok) {
      try { await rpc('eth_call', [p, 'latest'], errors); }
      catch (e) { if (e instanceof NodeError) revert = e.revert.kind === 'none' ? { kind: 'raw', text: e.message, data: '' } : e.revert; }
    }
    return { hash, receipt, revert };
  }

  const gasPrice = async (): Promise<number> => toGwei(hexToBigInt(str(await rpc('eth_gasPrice'))));
  const blockNumber = async (): Promise<number> => numOf(await rpc('eth_blockNumber')) ?? 0;

  /** Recent logs for one address. `span` blocks back from the head, so it works on a fresh node. */
  async function logs(address: string, fromBlock: number, toBlock: number): Promise<RawLog[]> {
    const raw = await rpc('eth_getLogs', [{ address, fromBlock: '0x' + Math.max(0, fromBlock).toString(16), toBlock: '0x' + Math.max(0, toBlock).toString(16) }]);
    return Array.isArray(raw) ? raw.map((o: any) => ({ address: str(o.address), topics: Array.isArray(o.topics) ? o.topics.map(str) : [], data: str(o.data) || '0x', blockNumber: numOf(o.blockNumber) ?? 0, index: numOf(o.logIndex) ?? 0 })) : [];
  }

  return { rpc, batch, probe, call, callMany, sendTx, gasPrice, blockNumber, logs };
}

export type ForkNode = ReturnType<typeof useForkNode>;
