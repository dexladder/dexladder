/**
 * Rewind desk — view half. A sheet with the replayed chart, a ticket whose orders fill on the
 * bars that come next, the run's metrics as they move, and a verdict that leads with
 * buy-and-hold. It never touches the paper account: this is hypothetical money on real history,
 * and the desk says so.
 */
import { h, mountInto } from '../components/ui/h';
import { CX } from '../design/classes';
import { parseAmount } from '../components/ui/trade-input';
import { BtSetup } from '../components/domain/bt-setup';
import { BtTransport } from '../components/domain/bt-transport';
import { BtTicket } from '../components/domain/bt-ticket';
import { BtMetrics } from '../components/domain/bt-metrics';
import { BtVerdict } from '../components/domain/bt-verdict';
import { useBacktest, type Loaded, type RunEvent } from '../hooks/useBacktest';
import { INTERVALS, type BtOrderType, type Candle, type IntervalId } from '../lib/backtest';
import { draw } from './rewind-chart';
import { CONTEXT, ERAS, eraWindow, feeRate, load, markets } from './rewind';
import { legacy } from './globals';

/* eslint-disable @typescript-eslint/no-explicit-any */
const $ = (id: string): HTMLElement | null => (typeof document !== 'undefined' ? document.getElementById(id) : null);
const f = (n: number): string => String(legacy.call('fmt', n) ?? n);
const day = (t: number): string => new Date(t).toISOString().slice(0, 10);
const when = (t: number, i: IntervalId): string => new Date(t).toISOString().replace('T', ' ').slice(0, i === '1d' ? 10 : 16) + (i === '1d' ? '' : ' UTC');

const U = { sym: '', era: 'd30', interval: '1h' as IntervalId, from: day(Date.now() - 90 * 86_400_000), to: day(Date.now()), cash: '10000', note: '', loading: false };
const T = { type: 'market' as BtOrderType, size: '', px: '', error: null as string | null };
let host: HTMLElement | null = null;

const BT = useBacktest({
  schedule: (fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); },
  id: () => 'bt' + Math.random().toString(36).slice(2, 8),
  emit: e => onEvent(e),
});

function sim(): any { const S = legacy.S(); return S ? (S.dlrw || (S.dlrw = {})) : {}; }

/** Restore the trader's last setup (the desk remembers what they were studying). */
function restore(): void {
  const d = sim();
  const S = legacy.S();
  U.sym = U.sym || d.sym || (S && typeof S.coin === 'string' ? S.coin : '') || 'BTC';
  if (d.era) { U.era = d.era; U.interval = d.interval || U.interval; }
  if (d.cash) U.cash = d.cash;
  if (d.from) { U.from = d.from; U.to = d.to || U.to; }
}

function persist(): void {
  const d = sim();
  d.sym = U.sym; d.era = U.era; d.interval = U.interval; d.cash = U.cash; d.from = U.from; d.to = U.to;
  legacy.call('saveP');
}

function setup(): HTMLElement {
  return BtSetup({
    coins: markets(), sym: U.sym, eras: ERAS, era: U.era, interval: U.interval, from: U.from, to: U.to, cash: U.cash, note: U.note, loading: U.loading,
    onCoin: s => { U.sym = s; persist(); renderSetup(); },
    onEra: id => { U.era = id; const e = ERAS.find(x => x.id === id); if (e) U.interval = e.interval; persist(); renderSetup(); },
    onInterval: i => { U.interval = i; persist(); renderSetup(); },
    onDate: (which, val) => { U[which] = val; persist(); renderSetup(); },
    onCash: raw => { U.cash = raw; persist(); },
    onLoad: () => { void begin(); },
  });
}

function renderSetup(): void { const el = $('btSetupHost'); if (el) mountInto(el, setup()); }

async function begin(): Promise<void> {
  const w = eraWindow(U.era, U.interval, U.from, U.to, Date.now());
  U.loading = true; U.note = 'Fetching real ' + U.interval + ' candles for ' + U.sym + '…'; renderSetup();
  try {
    const r = await load(U.sym, U.interval, w.from, w.to);
    const bars = r.candles, ctx = Math.min(CONTEXT, Math.max(0, bars.length - 30));
    const run: Loaded = {
      sym: U.sym, interval: U.interval, context: bars.slice(0, ctx), bars: bars.slice(ctx), source: r.source, feeRate: feeRate(),
      label: U.interval + ' bars · ' + day(bars[ctx]!.t) + ' → ' + day(bars[bars.length - 1]!.t),
    };
    U.note = bars.length + ' real bars from ' + r.source + ' · ' + run.label + (r.gaps ? ' · ' + r.gaps + ' gap(s) in the venue’s data, drawn as they came' : '');
    U.loading = false;
    BT.load(run, parseAmount(U.cash) || 10_000);
  } catch (e: any) {
    U.loading = false; U.note = String((e && e.message) || e);
    renderSetup();
  }
}

function transport(): HTMLElement {
  const run = BT.run(), s = BT.state(), bar: Candle | undefined = run ? run.bars[s.i] : undefined;
  return BtTransport({
    bar: s.i, bars: run ? run.bars.length : 0, when: bar ? when(bar.t, run!.interval) : '—', price: bar ? f(bar.c) + ' USDT' : '—',
    playing: BT.playing(), speed: BT.speed(), done: s.done,
    onPlay: () => { BT.toggle(); renderBar(); }, onStep: n => BT.step(n), onRestart: () => { BT.restart(); renderAll(); },
    onFinish: () => { BT.step(1e6); }, onSpeed: x => { BT.setSpeed(x); renderBar(); },
  });
}

function ticket(): HTMLElement {
  const run = BT.run(), s = BT.state(), px = run && run.bars[s.i] ? run.bars[s.i]!.c : 0;
  return BtTicket({
    state: s, sym: run ? run.sym : '', price: px, type: T.type, size: T.size, px: T.px, error: T.error, ready: s.i >= 0 && !s.done, fmt: f,
    onType: t => { T.type = t; renderTicket(); },
    onSize: raw => { T.size = raw; },
    onPx: raw => { T.px = raw; },
    // a size preset means "this share of what I could sell", or of what my cash could buy
    onPreset: fr => {
      const p = parseAmount(T.px) || px, base = s.qty > 0 ? s.qty : p > 0 ? s.cash / p : 0;
      T.size = base > 0 ? String(+(fr * base).toPrecision(6)) : '';
      renderTicket();
    },
    onSide: side => {
      const qty = side === 'sell' && !parseAmount(T.size) ? s.qty : parseAmount(T.size) || 0;
      T.error = BT.order({ type: T.type, side, qty, ...(T.type === 'market' ? {} : { px: parseAmount(T.px) || 0 }) });
      if (!T.error) { T.size = ''; }
      renderTicket();
    },
    onCancel: id => BT.cancel(id),
  });
}

function log(text: string, status: 'good' | 'bad' | 'neutral'): void {
  const el = $('btLog');
  if (!el) return;
  el.prepend(h('div', { class: [CX.btLine] }, h('span', { class: [CX.change, CX[status]] }, text)));
  while (el.children.length > 60) el.lastElementChild?.remove();
}

function renderChart(): void {
  const cv = $('btChart') as HTMLCanvasElement | null, run = BT.run();
  if (!cv || !run) return;
  const s = BT.state();
  draw(cv, { bars: BT.visible(), fills: s.fills, equity: s.equity, start: s.start, context: run.context.length, fmt: f });
}
function renderTicket(): void { const el = $('btTicketHost'); if (el) mountInto(el, ticket()); }
function renderMetrics(): void { const el = $('btMetricsHost'); if (el) mountInto(el, BtMetrics({ m: BT.metrics(), fmt: f })); }
function renderVerdict(): void { const el = $('btVerdictHost'); if (el) mountInto(el, BtVerdict({ verdict: BT.verdict(), done: BT.state().done })); }
function renderBar(): void { const el = $('btBarHost'); if (el) mountInto(el, transport()); }
function renderAll(): void { renderBar(); renderChart(); renderMetrics(); renderTicket(); renderVerdict(); }

/** Coalesce the redraws of a fast replay into one per frame (64× steps faster than a screen). */
let pending = false;
function paint(): void {
  if (pending) return;
  pending = true;
  const run = (): void => { pending = false; renderAll(); };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else setTimeout(run, 16);
}

function onEvent(e: RunEvent): void {
  if (e.kind === 'loaded') { T.error = null; renderSetup(); renderAll(); return; }
  if (e.kind === 'order') { for (const x of e.events) log('bar ' + (x.bar + 1) + ' · ' + x.text, x.kind === 'fill' ? 'good' : 'bad'); }
  if (e.kind === 'rejected') { T.error = e.why; renderTicket(); return; }
  if (e.kind === 'end') {
    const m = BT.metrics(), d = sim();
    d.last = { sym: BT.run()?.sym, label: BT.run()?.label, ret: +m.returnPct.toFixed(2), bh: +m.buyHoldPct.toFixed(2), dd: +m.maxDDPct.toFixed(2), trades: m.trades, at: Date.now() };
    legacy.call('saveP');
    log('Run finished — the open position was closed at the last close, so the result is measured flat.', 'neutral');
    renderAll();
    return;
  }
  paint();
}

/** Build the desk into a host element (the layer hands us the sheet body). Idempotent. */
export function mount(el: HTMLElement): void {
  host = el; restore();
  const d = sim().last;
  mountInto(el, h('div', { class: [CX.bt], id: 'btDesk' },
    h('div', { class: [CX.perpLine] }, 'Real candles, replayed one bar at a time. Your orders fill on the bars that come next — never on the one you are looking at. '
      + 'This is hypothetical: nothing here touches your paper account.'
      + (d && d.label ? ` Last run: ${d.sym} ${d.label} — ${d.ret >= 0 ? '+' : '−'}${Math.abs(d.ret)}% against ${d.bh >= 0 ? '+' : '−'}${Math.abs(d.bh)}% buy-and-hold.` : '')),
    h('div', { id: 'btSetupHost' }),
    h('div', { id: 'btBarHost' }),
    h('div', { class: [CX.btSide] },
      h('div', { class: [CX.perp] },
        h('canvas', { id: 'btChart', class: [CX.btChart], attrs: { height: '320' }, aria: { label: 'Replayed candles, your fills, and the equity curve' } }),
        h('div', { id: 'btMetricsHost' })),
      h('div', { class: [CX.perp] },
        h('div', { id: 'btTicketHost' }),
        h('div', { class: [CX.btList], id: 'btLog', aria: { label: 'Fill log' } }))),
    h('div', { id: 'btVerdictHost' }),
    h('div', { class: [CX.perpLine] }, 'Fills: market at the next bar’s open; limits and stops only when a bar trades through them, at your price — or at the open when the bar gapped past it. '
      + 'Fees follow your execution profile. Bar data is public market data, cached on this device.')));
  renderSetup(); renderAll();
  el.addEventListener('keydown', key);
}

function key(e: Event): void {
  const k = (e as KeyboardEvent).key, tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT') return;
  if (k === 'ArrowRight') { e.preventDefault(); BT.step(1); }
  else if (k === ' ') { e.preventDefault(); BT.toggle(); renderBar(); }
}

/** Stop the clock when the sheet closes (a replay must never run out of sight). */
export function hide(): void { BT.pause(); renderBar(); }
export function mounted(): boolean { return !!host && !!$('btDesk'); }
export const intervals = INTERVALS;
