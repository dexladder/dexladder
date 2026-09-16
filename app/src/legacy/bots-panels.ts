/**
 * The Bots desk's four new panels, wired to state: the kill switch, the virtualised execution log,
 * a telemetry panel per endpoint bot, and the equity curve.
 *
 * They live here rather than in bots-view.ts for two reasons. The view is already the desk's three
 * tabs and its two builders, and one file doing six things stops being readable; and these four
 * share a small piece of UI state of their own (which scope the kill switch is armed for, where
 * the log is scrolled to, which filters are set) that the tabs have no business seeing.
 *
 * No panel decides anything. Every sentence on screen was written by a pure core — `kill.ts` wrote
 * the halt steps, `telemetry.ts` the verdict, `logbook.ts` the cap note, `slippage.ts` the note
 * under the figure — and this file only chooses which of them to show.
 */
import { BotKill } from '../components/domain/bot-halt';
import { BotLogView, ROW_PX } from '../components/domain/bot-log';
import { BotTelemetry } from '../components/domain/bot-telemetry';
import { BotCurve, BotProgress } from '../components/domain/bot-curve';
import { capNote, filter, slice, MAX_WINDOW, type LogEventKind, type LogEventLevel } from '../lib/bots/logbook';
import { vitals } from '../lib/bots/telemetry';
import { botMetrics } from '../lib/bots/metrics';
import { isHaltable } from '../lib/bots/kill';
import { slipCost, slipNote } from '../lib/bots/slippage';
import { BOTS, slipBps, type BtProgress } from './bots';
import { book, clearBook, ring } from './bots-book';
import { fire, preview, type BtRun, type HaltReport } from './bots-desk';
import * as chart from './bots-chart';
import { legacy } from './globals';
import type { RunState } from '../hooks/useBots';
import type { BacktestResult } from '../lib/bots/backtest';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = globalThis as any;
const fmt = (n: number): string => String(legacy.call('fmt', n) ?? n);

const P = {
  /** '' = idle, 'all' = the global switch is armed, otherwise the bot id it is armed for */
  armed: '' as string,
  report: null as HaltReport | null,
  /** the log viewport's scroll offset, and the row index it works out to */
  top: 0, from: 0,
  level: '' as string, kind: '' as string, bot: '' as string,
};

let repaint: () => void = () => undefined;
/** The view registers its repaint here, exactly as the state half does. */
export const install = (fn: () => void): void => { repaint = fn; };

// ---------------------------------------------------------------- the kill switch

export const haltable = (): number => BOTS.runs().filter(r => isHaltable(r.status)).length;
/** Arm the switch for one bot (the card's own Halt button) or for all of them. */
export const arm = (scope: string): void => { P.armed = scope; P.report = null; repaint(); };

function fired(): void {
  const scope = P.armed;
  P.armed = '';
  const rep = fire(scope === 'all' ? undefined : scope, 'user');
  P.report = rep;
  legacy.call('toast', rep.sealNote ? 'warn' : 'good', 'Bots halted', rep.headline);
  repaint();
}

export function killBar(): HTMLElement {
  const one = P.armed && P.armed !== 'all' ? P.armed : '';
  return BotKill({
    haltable: haltable(),
    armed: P.armed,
    plans: P.armed ? preview(one || undefined) : [],
    report: P.report,
    name: one ? BOTS.get(one)?.def.name || '' : '',
    onArm: arm,
    onCancel: () => { P.armed = ''; repaint(); },
    onFire: fired,
    onDismiss: () => { P.report = null; repaint(); },
  });
}

// ---------------------------------------------------------------- the execution log

/** rows kept in the DOM: the viewport (320 px, 260 px on a phone) plus a little either side */
const WINDOW = Math.min(MAX_WINDOW, Math.ceil(320 / ROW_PX) + 6);

export function logTab(): HTMLElement {
  const b = book();
  const narrowed = !!(P.level || P.kind || P.bot);
  const q = {
    ...(P.level ? { level: P.level as LogEventLevel } : {}),
    ...(P.kind ? { kind: P.kind as LogEventKind } : {}),
    ...(P.bot ? { bot: P.bot } : {}),
  };
  // Unfiltered — the common case — reads through the core's own window function. A narrowed view
  // has to match first, and the match is a capped array in memory; neither ever reaches the DOM.
  const matched = narrowed ? filter(b, q) : null;
  const total = matched ? matched.length : b.events.length;
  const from = Math.max(0, Math.min(Math.max(0, total - 1), P.from));
  const rows = matched ? matched.slice(from, from + WINDOW) : slice(b, from, WINDOW);
  return BotLogView({
    rows, total, from, cap: capNote(b),
    level: P.level, kind: P.kind, bot: P.bot,
    bots: BOTS.runs().map(r => ({ value: r.def.id, label: r.def.name })),
    onScroll: top => {
      P.top = top;
      const next = Math.floor(top / ROW_PX);
      if (next !== P.from) { P.from = next; repaint(); }
    },
    onFilter: (k, v) => { P[k] = v; P.from = 0; P.top = 0; repaint(); },
    onClear: () => { clearBook(); P.from = 0; P.top = 0; repaint(); },
  });
}

// ---------------------------------------------------------------- endpoint telemetry

function copy(what: 'request' | 'response', text: string): void {
  const c = G.navigator && G.navigator.clipboard;
  const p = c && typeof c.writeText === 'function' ? c.writeText(text) : null;
  if (p && typeof p.then === 'function') {
    p.then(
      () => legacy.call('toast', 'good', 'Copied', 'The raw ' + what + ' is on your clipboard, exactly as it went over the wire.'),
      () => legacy.call('toast', 'warn', 'Could not copy', 'This browser refused clipboard access. The block selects in one click — copy it by hand.'));
    return;
  }
  legacy.call('toast', 'warn', 'Could not copy', 'This browser gives the page no clipboard. The block selects in one click — copy it by hand.');
}

/** A telemetry panel, but only for a bot that actually polls something. */
export function telemetry(r: RunState): HTMLElement | null {
  if (r.def.kind !== 'signal') return null;
  const rg = ring(r.def.id);
  return BotTelemetry({
    id: r.def.id, name: r.def.name, url: r.def.url || '',
    v: vitals(rg), request: rg.lastRequest, response: rg.lastResponse, onCopy: copy,
  });
}

// ---------------------------------------------------------------- the equity curve

export const progressBlock = (p: BtProgress): HTMLElement => BotProgress(p.step, p.of, p.text);

export function curveBlock(bt: BacktestResult, run: BtRun, interval: RunState['def']['interval']): HTMLElement {
  const bps = slipBps(), cost = slipCost(bt.wallet.fills, bps);
  return BotCurve({
    score: bt.score, m: botMetrics(bt, interval), slipBps: bps, slipCost: cost,
    slipNote: slipNote(bps, cost, bt.wallet.fills.length), runNote: run.note, fmt,
  });
}

/**
 * Draw the canvas and put the log back where it was. Called after the desk has mounted, never
 * during it: a component builds elements, and an element with no box cannot be drawn into.
 */
export function paint(bt: BacktestResult | null, interval: RunState['def']['interval']): void {
  const cv = document.getElementById('botCurve');
  if (cv && bt) {
    const m = botMetrics(bt, interval);
    chart.draw(cv as HTMLCanvasElement, { curve: bt.curve, under: m.underwater, start: bt.wallet.start, maxDDPct: bt.score.maxDDPct, fmt });
  }
  const log = document.getElementById('botLogView');
  if (log && log.scrollTop !== P.top) log.scrollTop = P.top;
}
