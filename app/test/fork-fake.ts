/**
 * A scripted EVM node for the unit tests: it speaks JSON-RPC over a function, holds a v2 pair with
 * real reserves, and can be told to revert. Small on purpose — the point is to drive the presenter
 * (probe, call batches, dry-run, send, receipt, logs) with no browser and no network.
 */
import { encodeTuple } from '../src/lib/fork/abi-encode';
import { selectorOf, parseEvent } from '../src/lib/fork/abi-sig';
import { bytesToHex, hexToBytes, strip } from '../src/lib/fork/hex';
import { amountOut } from '../src/lib/fork/univ2';

export const TKA = '0x1111111111111111111111111111111111111111';
export const USDC = '0x2222222222222222222222222222222222222222';
export const PAIR = '0x3333333333333333333333333333333333333333';
export const ROUTER = '0x4444444444444444444444444444444444444444';
export const USER = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
export const TRANSFER_TOPIC = parseEvent('event Transfer(address indexed from, address indexed to, uint256 value)').topic;

const SEL = {
  token0: selectorOf('token0()'), token1: selectorOf('token1()'), getReserves: selectorOf('getReserves()'),
  slot0: selectorOf('slot0()'), liquidity: selectorOf('liquidity()'), fee: selectorOf('fee()'),
  symbol: selectorOf('symbol()'), name: selectorOf('name()'), decimals: selectorOf('decimals()'),
  balanceOf: selectorOf('balanceOf(address)'), allowance: selectorOf('allowance(address,address)'),
  approve: selectorOf('approve(address,uint256)'), transfer: selectorOf('transfer(address,uint256)'),
  swap: selectorOf('swap(uint256,uint256,address,bytes)'),
};

const word = (v: bigint | number | string): string => bytesToHex(encodeTuple(['uint256'], [typeof v === 'string' ? v : v]), false);
const hex = (b: Uint8Array): string => bytesToHex(b);

export interface FakeOpts {
  /** a real public RPC instead of a dev node: no anvil_nodeInfo, chain id 1, no unlocked accounts */
  readonly mainnet?: boolean;
  /** every request fails at the transport, as a blocked browser request does */
  readonly offline?: boolean;
  /** make this selector revert with Error(string) */
  readonly revertOn?: string;
  readonly revertText?: string;
}

export interface Fake {
  send(body: string): Promise<string>;
  readonly sent: { method: string; params: unknown[] }[];
  reserves: { r0: bigint; r1: bigint };
  allowance: bigint;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function fakeNode(opts: FakeOpts = {}): Fake {
  const sent: { method: string; params: unknown[] }[] = [];
  const state = { reserves: { r0: BigInt('100000000000000000000'), r1: BigInt('200000000000') }, allowance: BigInt(0) };
  let block = 1000, nonce = 0;
  const txs = new Map<string, { data: string; to: string; from: string }>();

  const text = (s: string): string => hex(encodeTuple(['string'], [s]));

  function ethCall(p: any): { result?: string; error?: { code: number; message: string; data?: string } } {
    const to = String(p.to || '').toLowerCase(), data = String(p.data || ''), sel = '0x' + strip(data).slice(0, 8);
    const revert = { code: 3, message: 'execution reverted: ' + (opts.revertText || 'nope'), data: '0x08c379a0' + strip(hex(encodeTuple(['string'], [opts.revertText || 'nope']))) };
    if (opts.revertOn && sel === opts.revertOn) return { error: revert };
    if (to === PAIR) {
      if (sel === SEL.token0) return { result: word(TKA) };
      if (sel === SEL.token1) return { result: word(USDC) };
      if (sel === SEL.getReserves) return { result: hex(encodeTuple(['uint112', 'uint112', 'uint32'], [state.reserves.r0, state.reserves.r1, 1700000000])) };
      if (sel === SEL.swap) return { result: '0x' };
      return { error: { code: 3, message: 'execution reverted' } };
    }
    if (to === TKA || to === USDC) {
      if (sel === SEL.symbol) return { result: text(to === TKA ? 'TKA' : 'USDC') };
      if (sel === SEL.name) return { result: text(to === TKA ? 'Test Token A' : 'USD Coin') };
      if (sel === SEL.decimals) return { result: word(to === TKA ? 18 : 6) };
      if (sel === SEL.balanceOf) {
        const who = '0x' + strip(data).slice(8 + 24);
        if (who === strip(PAIR)) return { result: word(to === TKA ? state.reserves.r0 : state.reserves.r1) };
        return { result: word(to === TKA ? BigInt('10000000000000000000') : BigInt('50000000000')) };
      }
      if (sel === SEL.allowance) return { result: word(state.allowance) };
      if (sel === SEL.approve || sel === SEL.transfer) return { result: word(1) };
    }
    if (to === ROUTER) return { result: '0x' };
    return { error: { code: -32000, message: 'no contract at ' + to } };
  }

  function one(req: any): any {
    const id = req && req.id, method = String(req && req.method), params: any[] = (req && req.params) || [];
    sent.push({ method, params });
    const ok = (result: unknown): any => ({ jsonrpc: '2.0', id, result });
    const err = (message: string, code = -32601, data?: string): any => ({ jsonrpc: '2.0', id, error: data ? { code, message, data } : { code, message } });
    if (method === 'web3_clientVersion') return ok(opts.mainnet ? 'Geth/v1.14.0' : 'anvil/v1.0.3');
    if (method === 'eth_chainId') return ok(opts.mainnet ? '0x1' : '0x7a69');
    if (method === 'eth_blockNumber') return ok('0x' + block.toString(16));
    if (method === 'eth_accounts') return ok(opts.mainnet ? [] : [USER, '0x70997970c51812dc3a010c7d01b50e0d17dc79c8']);
    if (method === 'eth_gasPrice') return ok('0x' + BigInt('2500000000').toString(16));
    if (method === 'anvil_nodeInfo') return opts.mainnet ? err('the method anvil_nodeInfo does not exist') : ok({ currentBlockNumber: block, forkConfig: { forkUrl: 'https://rpc.example/mainnet', forkBlockNumber: 20000000 } });
    if (method === 'hardhat_metadata') return err('the method hardhat_metadata does not exist');
    if (method === 'eth_call') { const r = ethCall(params[0] || {}); return r.error ? { jsonrpc: '2.0', id, error: r.error } : ok(r.result); }
    if (method === 'eth_sendTransaction') {
      const p = params[0] || {}, sel = '0x' + strip(String(p.data || '')).slice(0, 8);
      if (opts.revertOn && sel === opts.revertOn) return err('execution reverted', 3, '0x08c379a0' + strip(hex(encodeTuple(['string'], [opts.revertText || 'nope']))));
      const hash = '0x' + String(++nonce).padStart(64, '0');
      txs.set(hash, { data: String(p.data || ''), to: String(p.to || ''), from: String(p.from || '') });
      block++;
      return ok(hash);
    }
    if (method === 'eth_getTransactionReceipt') {
      const hash = String(params[0] || ''), tx = txs.get(hash);
      if (!tx) return ok(null);
      const sel = '0x' + strip(tx.data).slice(0, 8);
      const logs: unknown[] = [];
      if (sel === SEL.transfer) {
        const to = '0x' + strip(tx.data).slice(8 + 24, 8 + 64), amt = BigInt('0x' + strip(tx.data).slice(8 + 64));
        logs.push({ address: tx.to, topics: [TRANSFER_TOPIC, word(tx.from), word(to)], data: word(amt), blockNumber: '0x' + block.toString(16), logIndex: '0x0' });
        if (to.toLowerCase() === PAIR) { state.reserves = { r0: state.reserves.r0 + amt, r1: state.reserves.r1 }; }
      }
      if (sel === SEL.swap) {
        // the pair pays out token1 to the recipient, as a real pair does
        const [, out1, who] = [0, BigInt('0x' + strip(tx.data).slice(8 + 64, 8 + 128)), '0x' + strip(tx.data).slice(8 + 128 + 24, 8 + 192)];
        logs.push({ address: USDC, topics: [TRANSFER_TOPIC, word(PAIR), word(who)], data: word(out1), blockNumber: '0x' + block.toString(16), logIndex: '0x1' });
        state.reserves = { r0: state.reserves.r0, r1: state.reserves.r1 - out1 };
      }
      return ok({ transactionHash: hash, status: '0x1', gasUsed: '0x' + (120000).toString(16), effectiveGasPrice: '0x' + BigInt('2500000000').toString(16), blockNumber: '0x' + block.toString(16), logs });
    }
    if (method === 'eth_getLogs') return ok([]);
    return err('the method ' + method + ' does not exist');
  }

  return {
    sent,
    get reserves() { return state.reserves; },
    set reserves(v) { state.reserves = v; },
    get allowance() { return state.allowance; },
    set allowance(v) { state.allowance = v; },
    async send(body: string): Promise<string> {
      if (opts.offline) throw new TypeError('Failed to fetch');
      const parsed = JSON.parse(body);
      return JSON.stringify(Array.isArray(parsed) ? parsed.map(one) : one(parsed));
    },
  };
}

/** What the pair would really pay out for `amountIn` of token0, by the contract's own arithmetic. */
export const pairOut = (amountIn: bigint, r0: bigint, r1: bigint): bigint => amountOut(amountIn, r0, r1, 30);
export { hexToBytes };
