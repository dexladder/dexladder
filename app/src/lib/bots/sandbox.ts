/**
 * Bring Your Own Bot · JavaScript. The protocol between DexLadder and a strategy the user wrote,
 * which runs in a Worker the payload layer spawns (layers/45-bots.js owns the Worker, as the fork
 * layer owns the HTTP — the typed core only says what the messages mean).
 *
 * The user's contract, printed on the desk:
 *   function onBar(ctx) { … return 'buy' | 'sell' | 'hold' | { action, size?, reason? } }
 * ctx carries the closed bars, the closes, the wallet and a small TA helper. One call per closed
 * bar; the answer fills at the price DexLadder sees next. No network, no DOM, no clock — the
 * layer removes them from the Worker before the user's code runs.
 */
import type { Action, Candle, Signal, Wallet } from './types';
import { avgEntry, openPl } from './wallet';

/** what onBar(ctx) receives — plain data, cloned into the Worker */
export interface BotCtx {
  readonly sym: string;
  readonly interval: string;
  /** index of the bar that just closed */
  readonly i: number;
  readonly t: number;
  /** the last bars, oldest first (capped) */
  readonly bars: readonly Candle[];
  readonly close: readonly number[];
  readonly high: readonly number[];
  readonly low: readonly number[];
  readonly volume: readonly number[];
  readonly price: number;
  readonly position: { readonly qty: number; readonly avgEntry: number; readonly openPl: number; readonly holding: boolean };
  readonly cash: number;
  readonly equity: number;
  readonly stake: number;
  /** what the bot last answered, if anything */
  readonly last: Action | null;
}

export const CTX_BARS = 300;

export function buildCtx(sym: string, interval: string, bars: readonly Candle[], w: Wallet, last: Action | null): BotCtx {
  const tail = bars.length > CTX_BARS ? bars.slice(bars.length - CTX_BARS) : bars;
  const b = bars[bars.length - 1];
  const px = b ? b.c : w.lastPx;
  return {
    sym, interval, i: bars.length - 1, t: b ? b.t : 0, bars: tail,
    close: tail.map(x => x.c), high: tail.map(x => x.h), low: tail.map(x => x.l), volume: tail.map(x => x.v),
    price: px, position: { qty: w.qty, avgEntry: avgEntry(w), openPl: openPl(w, px), holding: w.qty > 0 },
    cash: w.cash, equity: w.cash + w.qty * px, stake: w.start, last,
  };
}

// ------------------------------------------------------------------ messages

export type ToWorker = { readonly t: 'bar'; readonly id: number; readonly ctx: BotCtx };
export type FromWorker =
  | { readonly t: 'ready'; readonly hasOnBar: boolean }
  | { readonly t: 'signal'; readonly id: number; readonly value: unknown }
  | { readonly t: 'log'; readonly text: string }
  | { readonly t: 'error'; readonly id?: number; readonly message: string };

/** ms a bot may take to answer one bar before it is stopped */
export const BAR_BUDGET_MS = 1500;
/** ms from spawn to `ready` before the code is declared broken */
export const READY_BUDGET_MS = 4000;

/**
 * Whatever onBar returned, as a Signal — or a refusal in words. Accepts 'buy' / 'sell' / 'hold',
 * { action, size, reason }, or nothing (hold). Anything else is an error the user sees.
 */
export function normalise(value: unknown): { signal: Signal } | { error: string } {
  if (value == null) return { signal: { action: 'hold', reason: 'onBar returned nothing' } };
  if (typeof value === 'string') {
    const a = value.trim().toLowerCase();
    if (a === 'buy' || a === 'sell' || a === 'hold') return { signal: { action: a, reason: 'onBar said "' + a + '"' } };
    if (a === 'long') return { signal: { action: 'buy', reason: 'onBar said "long"' } };
    if (a === 'flat' || a === 'close' || a === 'exit') return { signal: { action: 'sell', reason: 'onBar said "' + a + '"' } };
    return { error: 'onBar returned "' + value.slice(0, 40) + '" — expected buy, sell or hold' };
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const raw = String(o.action ?? o.side ?? o.signal ?? '').trim().toLowerCase();
    const action: Action | null = raw === 'buy' || raw === 'long' ? 'buy' : raw === 'sell' || raw === 'flat' || raw === 'close' || raw === 'exit' ? 'sell' : raw === 'hold' || raw === '' ? 'hold' : null;
    if (!action) return { error: 'onBar returned action "' + raw.slice(0, 40) + '" — expected buy, sell or hold' };
    const size = typeof o.size === 'number' && Number.isFinite(o.size) ? Math.min(1, Math.max(0, o.size)) : undefined;
    const reason = typeof o.reason === 'string' && o.reason.trim() ? o.reason.trim().slice(0, 240) : 'onBar said "' + action + '"';
    return { signal: { action, ...(size != null ? { size } : {}), reason } };
  }
  return { error: 'onBar returned a ' + typeof value + ' — expected buy, sell or hold' };
}

/** ES-module syntax the user may paste, rewritten to the script the Worker runs (no eval anywhere). */
export function prepareCode(src: string): string {
  return src
    .replace(/^\s*export\s+default\s+/m, 'module.exports = ')
    .replace(/^\s*export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\b)/gm, '')
    .replace(/^\s*import\s[^\n]*$/gm, '// (imports are not available in the sandbox)');
}

/** A first bot, printed in the editor so the contract is never a blank page. */
export const EXAMPLE_JS = `// DexLadder calls onBar(ctx) once per CLOSED bar. Return 'buy', 'sell' or 'hold',
// or { action, size, reason } — size is a share of cash (buy) or holdings (sell).
// ctx: sym, interval, bars[], close[], high[], low[], volume[], price, position{qty,avgEntry,openPl,holding},
//      cash, equity, stake, last. ctx.ta has sma, ema, rsi, atr, highest, lowest, cross.
function onBar(ctx) {
  const fast = ctx.ta.ema(ctx.close, 12), slow = ctx.ta.ema(ctx.close, 26);
  const rsi = ctx.ta.rsi(ctx.close, 14);
  if (!ctx.position.holding && ctx.ta.cross(fast, slow) === 'up' && rsi < 65)
    return { action: 'buy', size: 0.6, reason: 'EMA 12 crossed above EMA 26 · RSI ' + rsi.toFixed(1) };
  if (ctx.position.holding && ctx.ta.cross(fast, slow) === 'down')
    return { action: 'sell', reason: 'EMA 12 crossed below EMA 26' };
  return 'hold';
}
`;
