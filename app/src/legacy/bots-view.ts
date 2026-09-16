/**
 * The Bots desk — view half. Three tabs in one sheet: the Arena (every bot, its wallet and its
 * decisions), Build (rules as blocks), and Bring your own (your JavaScript, or your own process
 * at a URL). Each bot trades its own paper wallet; the trader's account is never named here.
 */
import { h, mountInto } from '../components/ui/h';
import { CX } from '../design/classes';
import { BotBuilder } from '../components/domain/bot-builder';
import { BotByo, kitText } from '../components/domain/bot-byo';
import { BotCard } from '../components/domain/bot-card';
import { BotLeaderboard, BotVerdict } from '../components/domain/bot-arena';
import { Section } from '../components/domain/fork-facts';
import { Button } from '../components/ui/fields';
import { rank, verdict } from '../lib/bots/arena';
import { runStrategy } from '../lib/bots/backtest';
import { BLANK, preset } from '../lib/bots/presets';
import { EXAMPLE_JS } from '../lib/bots/sandbox';
import { buildCtx } from '../lib/bots/sandbox';
import { validateBot } from '../lib/bots/validate';
import { score } from '../lib/bots/wallet';
import { BOTS, bars as loadBars, feeRate, holdingText, installed, js as runJs, markets, newId, onChange, price, restore, setSlipBps, signal as callSignal, sleep, slipBps, wake, type BtProgress } from './bots';
import * as panels from './bots-panels';
import { backtest as runOffThread, type BtRun } from './bots-desk';
import { isHaltable } from '../lib/bots/kill';
import { TextField } from '../components/ui/fields';
import { MAX_SLIP_BPS } from '../lib/bots/slippage';
import { legacy } from './globals';
import type { BotDef, BotKind, Strategy } from '../lib/bots';

/* eslint-disable @typescript-eslint/no-explicit-any */
const f = (n: number): string => String(legacy.call('fmt', n) ?? n);
const KIND_LABEL: Readonly<Record<BotKind, string>> = { rules: 'rules', js: 'your JS', signal: 'your endpoint' };

type Tab = 'arena' | 'build' | 'byo' | 'log';
const U = {
  tab: 'arena' as Tab, open: '' as string, busy: '' as string,
  b: { name: 'My first bot', sym: '', interval: '1h', stake: '10000', strategy: BLANK as Strategy },
  y: { kind: 'js' as Exclude<BotKind, 'rules'>, name: 'My bot', sym: '', interval: '1h', stake: '10000', code: EXAMPLE_JS, url: 'http://127.0.0.1:8787/signal', kit: 'py' },
  out: null as { status: 'good' | 'bad' | 'warn' | 'info'; text: string } | null,
  bt: null as ReturnType<typeof runStrategy> | null,
  btRun: null as BtRun | null,
  prog: null as BtProgress | null,
  iv: '1h' as BotDef['interval'],
};
let host: HTMLElement | null = null;

const draft = (): BotDef => ({ id: 'draft', name: U.b.name, kind: 'rules', sym: U.b.sym || markets()[0]!, interval: U.b.interval as BotDef['interval'], stake: Number(U.b.stake) || 0, strategy: U.b.strategy, created: Date.now() });
const draftY = (): BotDef => ({ id: 'draft', name: U.y.name, kind: U.y.kind, sym: U.y.sym || markets()[0]!, interval: U.y.interval as BotDef['interval'], stake: Number(U.y.stake) || 0, ...(U.y.kind === 'js' ? { code: U.y.code } : { url: U.y.url }), created: Date.now() });

function tabs(): HTMLElement {
  const b = (id: Tab, label: string): HTMLElement => {
    const el = Button({ label, primary: U.tab === id, onClick: () => { U.tab = id; U.out = null; render(); } });
    el.id = 'botTab-' + id;
    return el;
  };
  return h('div', { class: [CX.forkBar] }, b('arena', 'Arena'), b('build', 'Build your own bot'), b('byo', 'Bring your own bot'), b('log', 'Execution log'));
}

/**
 * The desk bar: the fee every bot already pays, the slippage every bot will pay, and the kill
 * switch. Slippage sits beside the fee because they are the same kind of thing — what a fill
 * costs beyond its price — and it is applied to the backtest and to a live run by the same
 * setting, so the two stay the same numbers measured on different bars.
 */
function deskBar(): HTMLElement {
  return h('div', { class: [CX.perp], id: 'botDeskBar' },
    h('div', { class: [CX.perpGrid] },
      TextField({ id: 'botSlip', label: 'Slippage (bps, 0–' + MAX_SLIP_BPS + ')', value: String(slipBps()),
        placeholder: '0', unit: 'bps', onInput: v => { setSlipBps(v); render(); } }),
      h('div', { class: [CX.stat] },
        h('span', { class: [CX.statLabel] }, 'Venue fee'),
        h('span', { class: [CX.statValue] }, (feeRate() * 100).toFixed(3) + '%'),
        h('span', { class: [CX.statHint] }, 'your own venue profile, per fill'))),
    panels.killBar());
}

// ---------------------------------------------------------------- Arena

function arena(): HTMLElement {
  const runs = BOTS.runs();
  const rows = rank(runs.map(r => ({ def: r.def, status: r.status, score: score(r.wallet) })));
  const picked = runs.find(r => r.def.id === U.open) || null;
  return h('div', { class: [CX.perp], id: 'botArena' },
    Section('The Arena', null, BotLeaderboard({ rows, fmt: f, note: 'Ranked by edge over buy-and-hold on the same bars — a bot that made 8% while the coin made 12% is behind. Every wallet is paper and its own; nothing here touches your trading account.', onPick: id => { U.open = U.open === id ? '' : id; render(); } })),
    ...runs.flatMap(r => [BotCard({
      id: r.def.id, name: r.def.name, kindLabel: KIND_LABEL[r.def.kind], market: r.def.sym + ' · ' + r.def.interval,
      status: r.status, health: r.health, score: score(r.wallet), holding: holdingText(r.def.id), log: r.log, open: U.open === r.def.id, fmt: f,
      haltable: isHaltable(r.status), onHalt: () => panels.arm(r.def.id),
      onStart: () => { void BOTS.start(r.def.id).then(render); }, onPause: () => { BOTS.pause(r.def.id); render(); },
      onStop: () => { BOTS.stop(r.def.id); render(); }, onReset: () => { BOTS.reset(r.def.id); render(); },
      onRemove: () => { BOTS.remove(r.def.id); if (U.open === r.def.id) U.open = ''; render(); },
      onToggle: () => { U.open = U.open === r.def.id ? '' : r.def.id; render(); },
    }), U.open === r.def.id ? panels.telemetry(r) : null]),
    picked ? BotVerdict(verdict(score(picked.wallet), true), 'What ' + picked.def.name + '’s numbers say') : null);
}

// ---------------------------------------------------------------- Build

async function backtest(): Promise<void> {
  U.busy = 'bt'; U.out = null; U.prog = { step: 0, of: 3, text: 'Loading bars…' }; render();
  try {
    const d = draft();
    const rows = await loadBars(d);
    U.iv = d.interval;
    const run = await runOffThread(d.strategy!, rows, d.stake, p => { U.prog = p; render(); });
    U.bt = run.result; U.btRun = run;
    U.out = { status: 'info', text: 'Tested on ' + rows.length + ' real ' + d.interval + ' bars of ' + d.sym + ' — the rules never saw a price before it happened: every decision filled at the next bar’s open. ' + run.note + ' (' + run.ms + ' ms.)' };
  } catch (e) { U.bt = null; U.btRun = null; U.out = { status: 'bad', text: 'Could not test: ' + ((e as Error).message || e) }; }
  U.busy = ''; U.prog = null; render();
}

function launch(def: BotDef): void {
  const errs = validateBot(def);
  if (errs.length) { U.out = { status: 'bad', text: errs[0]! }; return render(); }
  const id = newId();
  BOTS.add({ ...def, id, created: Date.now() });
  void BOTS.start(id).then(() => { U.tab = 'arena'; U.open = id; render(); });
  legacy.call('toast', 'good', def.name + ' is live', 'It trades its own ' + def.stake.toLocaleString('en-US') + ' USDT paper wallet on ' + def.sym + ' · ' + def.interval + ' bars. Your account is untouched.');
  U.tab = 'arena'; U.open = id; render();
}

function build(): HTMLElement {
  const d = draft();
  return h('div', { class: [CX.perp], id: 'botBuild' },
    BotBuilder({
      name: U.b.name, sym: d.sym, coins: markets(), interval: U.b.interval, stake: U.b.stake, strategy: U.b.strategy,
      errors: validateBot(d), busy: U.busy,
      onField: (k, v) => { (U.b as any)[k === 'sym' ? 'sym' : k] = v; render(); },
      onPreset: id => { const p = preset(id); U.b.strategy = p ? p.strategy : BLANK; if (p) U.b.name = p.label; render(); },
      onStrategy: s => { U.b.strategy = s; render(); },
      onBacktest: () => { void backtest(); }, onLaunch: () => launch(d),
    }),
    U.busy === 'bt' && U.prog ? panels.progressBlock(U.prog) : null,
    U.out ? h('div', { class: [CX.forkOut, CX[U.out.status]], id: 'botOut' }, U.out.text) : null,
    U.bt && U.btRun ? panels.curveBlock(U.bt, U.btRun, U.iv) : null,
    U.bt ? BotVerdict(verdict(U.bt.score, false), 'On history') : null,
    U.bt ? Section('What it did', null, ...U.bt.log.slice(-12).reverse().map(l => h('div', { class: [CX.forkLogRow] }, h('span', { class: [CX.forkLogWhen] }, new Date(l.t).toISOString().slice(5, 16).replace('T', ' ')), h('span', {}, l.text)))) : null);
}

// ---------------------------------------------------------------- Bring your own

async function dryRun(): Promise<void> {
  U.busy = 'dry'; U.out = null; render();
  const d = draftY();
  try {
    const rows = await loadBars(d);
    const ctx = buildCtx(d.sym, d.interval, rows, emptyWallet(d.stake), null);
    const out = d.kind === 'js' ? await runJs(d, ctx) : await callSignal(d, ctx);
    U.out = 'error' in out
      ? { status: 'bad', text: out.error }
      : { status: 'good', text: 'Answered "' + out.signal.action + '" in ' + out.ms + ' ms on the last closed bar (' + d.sym + ' @ ' + f(ctx.price) + ') · ' + out.signal.reason };
  } catch (e) { U.out = { status: 'bad', text: String((e as Error).message || e) }; }
  U.busy = ''; render();
}

const emptyWallet = (stake: number): any => ({ start: stake, cash: stake, qty: 0, cost: 0, hwm: 0, openedAt: 0, fills: [], trades: [], equity: [], peak: stake, maxDD: 0, marks: 0, marksInMarket: 0, feesUSD: 0, firstPx: 0, lastPx: 0 });

function byo(): HTMLElement {
  const d = draftY();
  return BotByo({
    kind: U.y.kind, name: U.y.name, sym: d.sym, coins: markets(), interval: U.y.interval, stake: U.y.stake,
    code: U.y.code, url: U.y.url, kit: U.y.kit, errors: validateBot(d), busy: U.busy, out: U.out,
    health: installed() ? null : { ok: false, text: 'the runner is not installed on this page', ms: 0, errors: 1 },
    onKind: k => { U.y.kind = k; U.out = null; render(); },
    onField: (k, v) => { (U.y as any)[k] = v; if (k !== 'code' && k !== 'url') render(); },
    onExample: () => { U.y.code = EXAMPLE_JS; render(); },
    onKit: id => { U.y.kit = id; render(); },
    onDryRun: () => { void dryRun(); }, onLaunch: () => launch(d),
  });
}

// ---------------------------------------------------------------- mount

export function render(): void {
  if (!host) return;
  mountInto(host, h('div', {}, tabs(), deskBar(),
    U.tab === 'arena' ? arena() : U.tab === 'build' ? build() : U.tab === 'log' ? panels.logTab() : byo()));
  panels.paint(U.bt, U.iv);
}

export function mount(el: HTMLElement): void {
  host = el;
  if (!U.b.sym) { const S = legacy.S(); U.b.sym = (S && typeof S.coin === 'string' ? S.coin : '') || markets()[0]!; U.y.sym = U.b.sym; }
  onChange(render); panels.install(render);
  restore(); wake();
  render();
}

export const hide = (): void => { host = null; };
export const mounted = (): boolean => !!host;
export const kit = kitText;
export { sleep, price };
