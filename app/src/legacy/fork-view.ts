/**
 * The Local Fork sandbox panel: connect a node, read a pool, route the ticket to it, and swap on it
 * for real. The view half — every decision it reports is made by lib/fork or the hooks.
 *
 * It renders on action, never on keystroke, so typing a long address or ABI is never interrupted by
 * a redraw. Everything it prints is a reading it can name: a call, a receipt, or the doctor's
 * verdict on facts the node gave.
 */
import { h, mountInto } from '../components/ui/h';
import { CX } from '../design/classes';
import { Bar, Button, TextField } from '../components/ui/fields';
import { Segmented } from '../components/ui/segmented';
import { FactGrid, Findings, Section, type Fact } from '../components/domain/fork-facts';
import { LogList } from '../components/domain/fork-log';
import { Pill } from '../components/ui/pill';
import { chainName, urlProblem } from '../lib/fork/doctor';
import { erc20 } from '../lib/fork/erc20';
import { shortHex } from '../lib/fork/hex';
import { forkVenue, poolLabel } from '../lib/fork/market';
import { formatUnits } from '../lib/fork/units';
import { useForkNode, type ForkNode } from '../hooks/useForkNode';
import { loadPool, poolBalances } from '../hooks/useForkPool';
import { planSwap, runSwap } from '../hooks/useForkSwap';
import { realismOf } from './paper';
import { legacy } from './globals';
import * as F from './fork-state';
import { consoleSection } from './fork-console';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = globalThis as any;
const wait = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
const clock = (): string => { try { return new Date().toLocaleTimeString(); } catch (e) { return ''; } };
const toast = (kind: string, title: string, body: string): void => { legacy.call('toast', kind, title, body); };

let host: HTMLElement | null = null;
let node: ForkNode | null = null;
let nodeUrl = '';
let busy = '';
const draft = { side: 'buy' as 'buy' | 'sell', amount: '', balBase: '', balQuote: '' };

export function nodeFor(url: string): ForkNode {
  if (!node || nodeUrl !== url) { node = useForkNode({ send: F.sendTo(url), now: () => Date.now(), wait }); nodeUrl = url; }
  return node;
}

function say(text: string, status: Parameters<typeof F.log>[1] = 'neutral'): void {
  F.log(text, status, clock());
  render();
}

/** Repaint the legacy surfaces a routed pool changes (the ticket preview, balances, the ladder). */
function repaint(): void { for (const f of ['CBXpreview', 'recalc', 'drawBook']) legacy.call(f); }

// ------------------------------------------------------------------ actions
async function connect(): Promise<void> {
  const url = F.settings().url.trim();
  const bad = urlProblem(url);
  if (bad) return say(bad, 'bad');
  busy = 'connect'; render();
  try {
    const st = await nodeFor(url).probe(url, G.location ? G.location.protocol === 'https:' : false);
    F.setStatus(st);
    say(st.facts.reachable
      ? 'connected · ' + (st.facts.client || 'node') + ' · ' + chainName(st.facts.chainId) + ' · block ' + st.facts.blockNumber
      : 'no answer from ' + url + ' — ' + st.facts.faultMessage, st.facts.reachable ? 'good' : 'bad');
    if (st.facts.reachable && F.settings().pool) await readPool();
  } catch (e) {
    F.setStatus(null);
    say('connect failed: ' + (e instanceof Error ? e.message : String(e)), 'bad');
  } finally { busy = ''; render(); }
}

async function readPool(): Promise<void> {
  const s = F.settings();
  if (!F.nodeStatus()) return say('connect to a node first', 'warn');
  busy = 'pool'; render();
  try {
    const n = nodeFor(s.url);
    const r = await loadPool(n, s.pool.trim(), s.flip);
    F.setPool(r.pool, forkVenue(r.pool));
    const who = F.sender();
    if (who) {
      const bal = await poolBalances(n, r.pool, who);
      draft.balBase = formatUnits(bal.base, r.pool.base.decimals, 6);
      draft.balQuote = formatUnits(bal.quote, r.pool.quote.decimals, 6);
    }
    say('pool read · ' + poolLabel(r.pool) + ' · 1 ' + r.pool.base.symbol + ' = ' + r.pool.price.toPrecision(8) + ' ' + r.pool.quote.symbol + ' at block ' + r.pool.blockNumber, 'good');
    if (F.settings().route) repaint();
  } catch (e) {
    F.setPool(null, null);
    say('pool: ' + (e instanceof Error ? e.message : String(e)), 'bad');
  } finally { busy = ''; render(); }
}

function route(on: boolean): void {
  const p = F.forkPool();
  if (on && !p) return say('load a pool before routing the ticket to it', 'warn');
  F.patch({ route: on });
  if (on) {
    const S = legacy.S();
    if (S && S.dlsim && S.dlsim.mode !== 'pro' && G.DLSIM && typeof G.DLSIM.mode === 'function') G.DLSIM.mode('pro');
    toast('warn', 'Ticket routed to your node', 'Every order on this ticket is now priced on ' + (p ? poolLabel(p) : 'your pool') + ' — its real reserves, its fee, and your node\'s gas price. Fills stay paper; the pool only moves when you send a swap below.');
  } else toast('good', 'Ticket back on market data', 'Orders are priced on the modelled pool again.');
  repaint();
  render();
}

async function sendSwap(): Promise<void> {
  const p = F.forkPool(), st = F.nodeStatus(), s = F.settings();
  if (!p || !st) return say('load a pool first', 'warn');
  if (!st.writes.ok) return say('this node is read-only: ' + st.writes.why, 'bad');
  const n = nodeFor(s.url), from = F.sender();
  busy = 'swap'; render();
  try {
    const tIn = draft.side === 'buy' ? p.quote : p.base;
    const [allowHex] = await n.callMany(s.router.trim() ? [erc20.allowance(tIn.address, from, s.router.trim())] : []);
    const plan = planSwap({
      pool: p, side: draft.side, amount: draft.amount, slippagePct: realismOf(legacy.S()).tolerancePct,
      from, router: s.router.trim(), allowance: allowHex ? BigInt(allowHex) : BigInt(0),
      deadline: Math.floor(Date.now() / 1000) + 600,
    });
    say('sending ' + plan.steps.length + ' transaction(s) · ' + plan.route + ' · ' + plan.note, 'info');
    const out = await runSwap(n, plan, from);
    for (const d of out.done) say(d.label + ' · ' + shortHex(d.hash) + (d.receipt ? ' · gas ' + d.receipt.gasUsed.toString() : ''), 'good');
    if (out.failed) { say(out.failed, 'bad'); toast('bad', 'Swap failed on your node', out.failed); }
    else {
      const got = formatUnits(out.received, plan.decimalsOut, 8), paid = formatUnits(out.sent, plan.decimalsIn, 8);
      const gasEth = formatUnits(out.gasWei, 18, 8);
      say('swapped ' + paid + ' → ' + got + ' · gas ' + out.gasUsed.toString() + ' units (' + gasEth + ' ETH)', 'good');
      toast('good', 'Swap mined on your node', 'You sent ' + paid + ' and received ' + got + ', paying ' + out.gasUsed.toString() + ' gas. This was a real transaction on your fork.');
      draft.amount = '';
    }
    await readPool();
  } catch (e) {
    say('swap: ' + (e instanceof Error ? e.message : String(e)), 'bad');
  } finally { busy = ''; render(); }
}

// ------------------------------------------------------------------ sections
function nodeSection(): HTMLElement {
  const s = F.settings(), st = F.nodeStatus();
  const facts: Fact[] = [];
  if (st) {
    facts.push({ k: 'client', v: st.facts.client || 'unknown' });
    facts.push({ k: 'chain', v: chainName(st.facts.chainId) + (st.facts.chainId != null ? ' (' + st.facts.chainId + ')' : '') });
    facts.push({ k: 'block', v: st.facts.blockNumber != null ? String(st.facts.blockNumber) : '—' });
    facts.push({ k: 'gas price', v: st.gwei > 0 ? st.gwei.toPrecision(4) + ' gwei' : '—' });
    facts.push({ k: 'signer', v: st.facts.accounts.length ? shortHex(st.facts.accounts[0] as string) + ' (+' + (st.facts.accounts.length - 1) + ' more, unlocked by the node)' : 'none — read-only' });
    if (st.facts.isFork) facts.push({ k: 'forked from', v: (st.facts.forkUrl || 'upstream') + (st.facts.forkBlock != null ? ' @ ' + st.facts.forkBlock : '') });
  }
  return Section('Your node', st ? Pill({ status: st.facts.reachable ? (st.writes.ok ? 'good' : 'warn') : 'bad', text: st.facts.reachable ? (st.writes.ok ? 'live · can sign' : 'live · read-only') : 'unreachable' }) : Pill({ status: 'neutral', text: 'not connected' }),
    TextField({ id: 'dlfkUrl', label: 'JSON-RPC URL', value: s.url, placeholder: F.DEFAULT_URL, wide: true, onInput: v => F.patch({ url: v }), onEnter: () => void connect() }),
    Bar(
      Button({ label: busy === 'connect' ? 'connecting…' : st ? 'Reconnect' : 'Connect', primary: true, disabled: !!busy, onClick: () => void connect() }),
      Button({ label: 'Forget', disabled: !st, title: 'Drop the reading and stop routing', onClick: () => { F.setStatus(null); F.patch({ route: false }); say('disconnected', 'neutral'); repaint(); } }),
    ),
    st ? FactGrid(facts) : null,
    st ? Findings(st.findings) : null);
}

function poolSection(): HTMLElement | null {
  const st = F.nodeStatus(), s = F.settings();
  if (!st || !st.facts.reachable) return null;
  const p = F.forkPool();
  const facts: Fact[] = [];
  if (p) {
    facts.push({ k: 'pair', v: p.base.symbol + ' / ' + p.quote.symbol + ' · ' + p.kind + ' · ' + (p.feeBps / 100).toFixed(2) + '% fee' });
    facts.push({ k: 'price', v: '1 ' + p.base.symbol + ' = ' + p.price.toPrecision(8) + ' ' + p.quote.symbol });
    facts.push({ k: p.kind === 'v2' ? 'reserves' : 'pool holds', v: p.baseHeld.toPrecision(8) + ' ' + p.base.symbol + ' · ' + p.quoteHeld.toPrecision(8) + ' ' + p.quote.symbol });
    if (p.kind === 'v3') facts.push({ k: 'tick liquidity', v: p.liquidity.toPrecision(8), title: 'the liquidity of the range the price sits in — crossing ticks is not modelled' });
    facts.push({ k: 'read at', v: 'block ' + p.blockNumber });
    if (draft.balBase) facts.push({ k: 'your balance', v: draft.balBase + ' ' + p.base.symbol + ' · ' + draft.balQuote + ' ' + p.quote.symbol });
  }
  return Section('The pool', p ? Pill({ status: 'info', text: p.kind.toUpperCase() }) : null,
    TextField({ id: 'dlfkPool', label: 'Pool address (v2 pair or v3 pool)', value: s.pool, placeholder: '0x…', wide: true, onInput: v => F.patch({ pool: v }), onEnter: () => void readPool() }),
    TextField({ id: 'dlfkRouter', label: 'Router address (optional · required for v3 swaps)', value: s.router, placeholder: '0x…', wide: true, onInput: v => F.patch({ router: v }) }),
    Bar(
      Button({ label: busy === 'pool' ? 'reading…' : p ? 'Re-read' : 'Load pool', primary: true, disabled: !!busy, onClick: () => void readPool() }),
      Button({ label: s.flip ? 'Quote: token0' : 'Quote: token1', title: 'Which side of the pair prices the other', disabled: !!busy, onClick: () => { F.patch({ flip: !s.flip }); void readPool(); } }),
    ),
    p ? FactGrid(facts) : null,
    p ? Segmented({
      id: 'dlfkRoute', label: 'Price this ticket on your pool', value: s.route ? 'on' : 'off',
      options: [{ value: 'off', label: 'Off', title: 'Orders are priced on DexLadder\'s modelled pool' }, { value: 'on', label: 'On', title: 'Orders are priced on your pool\'s real reserves, fee and gas' }],
      onChange: v => route(v === 'on'),
    }) : null,
    p && s.route ? h('div', { class: [CX.previewNote] }, 'Every order type on the ticket — limit, stop, trailing, OCO, TWAP — now meets ' + poolLabel(p) + '. Amounts are ' + p.base.symbol + ' and prices are ' + p.quote.symbol + ', whatever pair label the ticket shows. Fills are paper; the pool moves only when you swap below.') : null);
}

function swapSection(): HTMLElement | null {
  const p = F.forkPool(), st = F.nodeStatus();
  if (!p || !st) return null;
  const tIn = draft.side === 'buy' ? p.quote : p.base, tOut = draft.side === 'buy' ? p.base : p.quote;
  return Section('Swap for real', Pill({ status: st.writes.ok ? 'warn' : 'neutral', text: st.writes.ok ? 'signs on your node' : 'read-only' }),
    Segmented({
      id: 'dlfkSide', label: 'Direction', value: draft.side,
      options: [{ value: 'buy', label: 'Buy ' + p.base.symbol }, { value: 'sell', label: 'Sell ' + p.base.symbol }],
      onChange: v => { draft.side = v === 'sell' ? 'sell' : 'buy'; render(); },
    }),
    TextField({ id: 'dlfkAmt', label: 'You send (' + tIn.symbol + ')', value: draft.amount, placeholder: '0.0', unit: tIn.symbol, wide: true, onInput: v => { draft.amount = v; } }),
    Bar(Button({ label: busy === 'swap' ? 'sending…' : 'Send swap → ' + tOut.symbol, primary: true, disabled: !!busy || !st.writes.ok, onClick: () => void sendSwap() })),
    h('div', { class: [CX.previewNote] }, st.writes.ok
      ? 'Dry-run first (eth_call), then signed by your node from ' + shortHex(F.sender()) + ' with the minimum output set by your ticket\'s ' + realismOf(legacy.S()).tolerancePct + '% slippage tolerance. DexLadder holds no key.'
      : st.writes.why));
}

// ------------------------------------------------------------------ mount
export function render(): void {
  if (!host) return;
  mountInto(host, h('div', {},
    nodeSection(), poolSection(), swapSection(),
    consoleSection({ node: () => nodeFor(F.settings().url), rerender: render, busy: () => busy, setBusy: (b: string) => { busy = b; }, say }),
    Section('Log', Button({ label: 'Clear', onClick: () => { F.clearLog(); render(); } }), LogList(F.lines()))));
}

/** Mount the panel into `hostEl` (the layer's card body). Idempotent. */
export function mount(hostEl: HTMLElement): void {
  host = hostEl;
  if (!F.lines().length) F.log('Point this at a local node — Anvil or Hardhat — and the terminal prices orders on YOUR pool.', 'neutral', clock());
  render();
}

export const state = F;
