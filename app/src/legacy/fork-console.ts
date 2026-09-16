/**
 * The contract console: paste an ABI, pick a function, read it or send it — and deploy bytecode.
 *
 * This is the part that makes the sandbox about the user's OWN contracts rather than only about
 * pools. Everything is typed from the ABI (so an out-of-range argument is refused before a
 * transaction exists), reads go through eth_call, writes are dry-run first, and a revert comes back
 * as the contract's own message, panic or custom error — never as raw bytes.
 */
import { h, type Child } from '../components/ui/h';
import { CX } from '../design/classes';
import { Bar, Button, Select, TextArea, TextField } from '../components/ui/fields';
import { FactGrid, Section, type Fact } from '../components/domain/fork-facts';
import { Pill } from '../components/ui/pill';
import { decodeLog, decodeParams, formatDecoded } from '../lib/fork/abi-decode';
import { encodeCall } from '../lib/fork/abi-encode';
import type { AbiFn } from '../lib/fork/abi-sig';
import { parseAbi, type AbiSet } from '../lib/fork/abi-json';
import { isAddress, shortHex } from '../lib/fork/hex';
import type { Status } from '../design/tokens';
import type { ForkNode } from '../hooks/useForkNode';
import * as F from './fork-state';

export interface ConsoleCtx {
  node(): ForkNode;
  rerender(): void;
  busy(): string;
  setBusy(b: string): void;
  say(text: string, status?: Status): void;
}

let abi: AbiSet | null = null;
let abiError = '';
let picked = '';
let args: string[] = [];
let out: { readonly text: string; readonly status: Status } | null = null;

const fns = (): readonly AbiFn[] => (abi ? abi.functions : []);
const current = (): AbiFn | null => fns().find(f => f.signature === picked) || fns()[0] || null;
const isRead = (f: AbiFn): boolean => f.mutability === 'view' || f.mutability === 'pure';

function parse(text: string): void {
  abiError = ''; out = null;
  try { abi = parseAbi(text); picked = abi.functions[0] ? (abi.functions[0] as AbiFn).signature : ''; args = []; }
  catch (e) { abi = null; abiError = e instanceof Error ? e.message : String(e); }
}

function calldata(f: AbiFn): string {
  return encodeCall(f.selector, f.inputs.map(i => i.type), f.inputs.map((_, i) => args[i] ?? ''));
}

async function read(ctx: ConsoleCtx): Promise<void> {
  const f = current(), s = F.settings();
  if (!f) return;
  if (!isAddress(s.contract.trim())) { out = { text: 'paste the contract address first', status: 'bad' }; return ctx.rerender(); }
  ctx.setBusy('call'); ctx.rerender();
  try {
    const data = calldata(f);
    const hex = await ctx.node().call(s.contract.trim(), data, abi ? abi.errors : []);
    const types = f.outputs.map(o => o.type);
    const values = types.length ? decodeParams(types, hex) : [];
    const text = types.length
      ? f.outputs.map((o, i) => (o.name || 'out' + i) + ' (' + o.type + ') = ' + formatDecoded(values[i] as never)).join('\n')
      : 'returned no value (' + hex + ')';
    out = { text, status: 'good' };
    ctx.say(f.name + '() → ' + text.replace(/\n/g, ' · '), 'good');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    out = { text: msg, status: 'bad' };
    ctx.say(f.name + '() reverted: ' + msg, 'bad');
  } finally { ctx.setBusy(''); ctx.rerender(); }
}

async function send(ctx: ConsoleCtx): Promise<void> {
  const f = current(), s = F.settings(), st = F.nodeStatus();
  if (!f || !st) return;
  if (!st.writes.ok) { out = { text: st.writes.why, status: 'bad' }; return ctx.rerender(); }
  if (!isAddress(s.contract.trim())) { out = { text: 'paste the contract address first', status: 'bad' }; return ctx.rerender(); }
  ctx.setBusy('send'); ctx.rerender();
  try {
    const r = await ctx.node().sendTx({ from: F.sender(), to: s.contract.trim(), data: calldata(f) }, abi ? abi.errors : []);
    const rc = r.receipt;
    const logs = rc ? rc.logs.map(l => {
      const ev = (abi ? abi.events : []).find(e => e.topic.toLowerCase() === (l.topics[0] || '').toLowerCase());
      if (!ev) return 'log · ' + (l.topics[0] ? shortHex(l.topics[0]) : 'anonymous') + ' from ' + shortHex(l.address);
      const v = decodeLog(ev, l.topics, l.data);
      return ev.name + '(' + Object.keys(v).map(k => k + ': ' + v[k]).join(', ') + ')';
    }) : [];
    const head = rc && rc.ok ? 'mined in block ' + rc.blockNumber + ' · gas ' + rc.gasUsed.toString() : r.revert.kind !== 'none' ? 'reverted: ' + r.revert.text : 'reverted';
    out = { text: [f.name + ' · ' + shortHex(r.hash), head, ...logs].join('\n'), status: rc && rc.ok ? 'good' : 'bad' };
    ctx.say(f.name + ' · ' + shortHex(r.hash) + ' · ' + head, rc && rc.ok ? 'good' : 'bad');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    out = { text: msg, status: 'bad' };
    ctx.say(f.name + ' refused before sending: ' + msg, 'bad');
  } finally { ctx.setBusy(''); ctx.rerender(); }
}

async function deploy(ctx: ConsoleCtx): Promise<void> {
  const s = F.settings(), st = F.nodeStatus();
  if (!st || !st.writes.ok) { out = { text: st ? st.writes.why : 'connect first', status: 'bad' }; return ctx.rerender(); }
  const code = s.bytecode.trim();
  if (!/^0x[0-9a-fA-F]{2,}$/.test(code)) { out = { text: 'paste the creation bytecode (0x…) — Foundry: out/<C>.sol/<C>.json → bytecode.object', status: 'bad' }; return ctx.rerender(); }
  ctx.setBusy('deploy'); ctx.rerender();
  try {
    const r = await ctx.node().sendTx({ from: F.sender(), data: code });
    const addr = r.receipt ? r.receipt.contractAddress : '';
    if (addr) { F.patch({ contract: addr }); out = { text: 'deployed at ' + addr + ' · gas ' + (r.receipt ? r.receipt.gasUsed.toString() : '?'), status: 'good' }; ctx.say('deployed ' + addr, 'good'); }
    else { out = { text: r.revert.kind !== 'none' ? 'deployment reverted: ' + r.revert.text : 'no contract address in the receipt', status: 'bad' }; ctx.say('deploy failed', 'bad'); }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    out = { text: msg, status: 'bad' }; ctx.say('deploy refused: ' + msg, 'bad');
  } finally { ctx.setBusy(''); ctx.rerender(); }
}

// ------------------------------------------------------------------ the section
export function consoleSection(ctx: ConsoleCtx): Child {
  const st = F.nodeStatus(), s = F.settings();
  if (!st || !st.facts.reachable) return null;
  const f = current();
  const facts: Fact[] = [];
  if (abi) {
    facts.push({ k: 'ABI', v: abi.functions.length + ' function(s) · ' + abi.events.length + ' event(s) · ' + abi.errors.length + ' error(s) · read as ' + abi.source });
    if (abi.skipped.length) facts.push({ k: 'skipped', v: abi.skipped.join(' · ') });
    if (f) facts.push({ k: 'selector', v: f.selector + ' · ' + f.signature + ' · ' + f.mutability });
  }
  const busy = ctx.busy();
  return Section('Your contract', abi ? Pill({ status: 'info', text: abi.functions.length + ' fns' }) : null,
    TextField({ id: 'dlfkAddr', label: 'Contract address', value: s.contract, placeholder: '0x…', wide: true, onInput: v => F.patch({ contract: v }) }),
    TextArea({ id: 'dlfkAbi', label: 'ABI — JSON, a Foundry/Hardhat artifact, or one signature per line', value: s.abi, placeholder: 'function balanceOf(address) view returns (uint256)', onInput: v => F.patch({ abi: v }) }),
    Bar(Button({ label: 'Read ABI', disabled: !!busy, onClick: () => { parse(F.settings().abi); ctx.say(abi ? 'ABI read · ' + abi.functions.length + ' functions' : 'ABI: ' + abiError, abi ? 'good' : 'bad'); } })),
    abiError ? h('div', { class: [CX.previewNote, CX.bad] }, abiError) : null,
    abi && abi.functions.length ? Select({
      id: 'dlfkFn', label: 'Function', value: picked,
      options: fns().map(x => ({ value: x.signature, label: (isRead(x) ? '🔍 ' : '✎ ') + x.signature })),
      onChange: v => { picked = v; args = []; out = null; ctx.rerender(); },
    }) : null,
    ...(f ? f.inputs.map((inp, i) => TextField({
      id: 'dlfkArg' + i, label: (inp.name || 'arg' + i) + ' · ' + inp.type, value: args[i] || '', wide: true,
      placeholder: inp.type === 'address' ? '0x…' : inp.type.startsWith('uint') ? 'base units (whole number)' : inp.type,
      onInput: v => { args[i] = v; },
    })) : []),
    f ? Bar(
      Button({ label: busy === 'call' ? 'reading…' : 'Read (eth_call)', primary: isRead(f), disabled: !!busy, onClick: () => void read(ctx) }),
      isRead(f) ? null : Button({ label: busy === 'send' ? 'sending…' : 'Send transaction', primary: true, disabled: !!busy || !st.writes.ok, onClick: () => void send(ctx) }),
    ) : null,
    facts.length ? FactGrid(facts) : null,
    out ? h('div', { class: [CX.forkOut, CX[out.status]] }, out.text) : null,
    TextArea({ id: 'dlfkCode', label: 'Deploy creation bytecode (optional)', value: s.bytecode, placeholder: '0x60806040…', onInput: v => F.patch({ bytecode: v }) }),
    Bar(Button({ label: busy === 'deploy' ? 'deploying…' : 'Deploy', disabled: !!busy || !st.writes.ok, onClick: () => void deploy(ctx) })));
}
