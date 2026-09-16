/**
 * Bots — state half. What the user's bots are, where they are kept, and the one seam through
 * which the payload layer hands in the three things the typed core may not do itself: fetch
 * candles, run a user's JavaScript in a Worker, and call a user's signal endpoint.
 *
 * Storage: S.dlsim.bots on the paper account (it saves with everything else), holding only the
 * definitions and each bot's own wallet. Bars are never stored — they are re-fetched on resume.
 */
import { useBots, type BotsDeps, type Decision, type Persisted } from '../hooks/useBots';
import { venue } from '../lib/paper-engine/venues';
import { legacy } from './globals';
import { modeOf, venueOf } from './perps';
import { readSlipBps, DEFAULT_SLIP_BPS } from '../lib/bots/slippage';
import { record, write } from './bots-book';
import type { BacktestResult } from '../lib/bots/backtest';
import type { BotCtx } from '../lib/bots/sandbox';
import type { BotDef, Candle, Strategy } from '../lib/bots';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = globalThis as any;

/** one backtest, as the Worker receives it — values only, so it survives a structured clone */
export interface BtRequest {
  readonly strategy: Strategy;
  readonly bars: readonly Candle[];
  readonly stake: number;
  readonly feeRate: number;
  readonly slipBps: number;
}

/** where a backtest has got to. The stages are the ones the Worker actually crosses: a percentage
 *  inside the fold would be invented, because the fold cannot be interrupted to report on itself. */
export interface BtProgress { readonly step: number; readonly of: number; readonly text: string }

export interface Transport {
  /** closed candles for a market and bar size, oldest first */
  bars(sym: string, interval: string, limit: number): Promise<readonly Candle[]>;
  /** run the user's code on one context in a sandboxed Worker */
  js(def: BotDef, ctx: BotCtx): Promise<Decision>;
  /** GET the user's endpoint once */
  signal(def: BotDef, ctx: BotCtx): Promise<Decision>;
  /** run a strategy in a Worker of its own. Absent = this page has none and the desk runs it
   *  on the main thread instead, with the same arguments and therefore the same numbers. */
  backtest?(req: BtRequest, onProgress: (p: BtProgress) => void): Promise<BacktestResult>;
  /** tear down whatever is running this bot's decisions — the kill switch's freeze step. A
   *  sandbox Worker is terminated, not asked to stop; code in a loop cannot answer a request. */
  stop?(def: BotDef): void;
}

let T: Transport | null = null;
/** Called once by layers/45-bots.js. First wins, as with the fork sandbox. */
export function install(t: Transport): void { if (!T) T = t; }
export const installed = (): boolean => !!T;
const need = (): Transport => { if (!T) throw new Error('the bot runner is not installed on this page'); return T; };
/** the installed effects, or null — the desk asks before it reaches for an optional one. */
export const transport = (): Transport | null => T;

const bag = (): any => { const S = legacy.S(); if (!S) return null; const d = S.dlsim || (S.dlsim = {}); return d.bots || (d.bots = { v: 1, runs: [] }); };

/**
 * The desk-wide slippage setting, in basis points, beside the fee rate and read the same way.
 *
 * It is stored as an OPTIONAL field on the bots bag that already exists (`S.dlsim.bots.slip`) —
 * no new storage key, no rename — so a coinbridge.v1.json written before this shipped decodes
 * unchanged and reads back 0, which is exactly the number it was measured at.
 */
export function slipBps(): number {
  const b = bag();
  return b ? readSlipBps(b.slip) : DEFAULT_SLIP_BPS;
}

export function setSlipBps(n: unknown): number {
  const b = bag(), v = readSlipBps(n);
  if (b) { b.slip = v; legacy.call('saveP'); }
  return v;
}

/**
 * Seal one entry into the proof ledger, through the chain the payload owns.
 *
 * `window.chainAdd(type, data)` computes sha256(i|t|ty|JSON.stringify(d)|prev) and appends; this
 * module must not hash anything itself or there would be two chains disagreeing. When chainAdd is
 * absent — an older shell, or the ledger not yet booted — this returns false and the CALLER must
 * still finish what it was doing and say the seal could not be written. A halt that refused to
 * complete because it could not write a receipt would be the worst possible failure mode.
 */
export function seal(type: string, data: unknown): boolean {
  const fn = G.chainAdd;
  if (typeof fn !== 'function') return false;
  try { fn(type, data); return true; } catch { return false; }
}

/** The fee every bot fill pays: the trader's own venue profile, exactly as the Rewind desk does. */
export function feeRate(): number {
  const S = legacy.S();
  return S && modeOf(S) === 'advanced' ? venue(venueOf(S)).t : 0.001;
}

export function price(sym: string): number {
  const p = legacy.pairPrice(sym, 'USDT');
  return Number.isFinite(p) && p > 0 ? p : (legacy.coin(sym)?.price ?? 0);
}

/** Markets a bot can trade: what the ladder is showing, most liquid first. */
export function markets(): string[] {
  const all = legacy.callIn('DLCORE', 'coinsAll') || [];
  const syms = (Array.isArray(all) ? all : []).filter((c: any) => c && c.sym && c.sym !== 'USDT' && (c.vol || 0) > 0)
    .sort((a: any, b: any) => (b.vol || 0) - (a.vol || 0)).map((c: any) => c.sym).slice(0, 40);
  return syms.length ? syms : ['BTC', 'ETH', 'SOL'];
}

const deps: BotsDeps = {
  now: () => Date.now(),
  schedule: (fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); },
  bars: def => need().bars(def.sym, def.interval, 400),
  price,
  feeRate,
  decideJs: (def, ctx) => need().js(def, ctx),
  decideSignal: (def, ctx) => need().signal(def, ctx).then(out => { if (out.poll) record(def.id, out.poll.sample, out.poll.raw); return out; }),
  persist: rows => { const b = bag(); if (!b) return; b.runs = rows; legacy.call('saveP'); },
  emit: (kind, id, text) => { if (kind === 'change') render(); else notify(kind, id, text); },
  slipBps,
  log: (id, kind, level, text) => write({ bot: id, t: Date.now(), kind, level, text }),
};

export const BOTS = useBots(deps);

let painter: (() => void) | null = null;
/** The view registers its repaint here; state never reaches into the DOM itself. */
export function onChange(fn: () => void): void { painter = fn; }
function render(): void { try { painter && painter(); } catch { /* a failing repaint never stops a bot */ } }

function notify(kind: 'fill' | 'error', id: string, text?: string): void {
  const r = BOTS.get(id);
  if (!r) return;
  if (kind === 'fill') { legacy.call('toast', 'info', r.def.name, text || 'traded'); sealFill(id); }
  else legacy.call('toast', 'warn', r.def.name + ' could not decide', text || '');
  render();
}

/**
 * A bot's fill goes into the proof ledger, tagged with the bot that took it — the chain is the
 * record of what this account did, and a trade a bot took is still a trade that happened.
 *
 * One entry per FILL, never per signal, per mark or per halt step: the chain keeps 300 entries and
 * truncates to the last 120, so every line a bot writes is a line of the user's own history it
 * eventually evicts. The payload is flat and small for the same reason — the reason, the log and
 * the wallet live in the logbook, which nobody is hashing.
 */
function sealFill(id: string): void {
  const r = BOTS.get(id);
  const f = r && r.wallet.fills[r.wallet.fills.length - 1];
  if (!r || !f) return;
  seal('BOT_FILL', { bot: r.def.id, name: r.def.name, sym: r.def.sym, side: f.side, qty: +f.qty.toPrecision(8), px: +f.px.toPrecision(8), fee: +f.fee.toFixed(6), why: f.why });
}

/** Read what was saved and put every live bot back to work. */
export function restore(): void {
  const b = bag();
  if (!b || !Array.isArray(b.runs) || !b.runs.length || BOTS.runs().length) return;
  try { BOTS.restore(b.runs as Persisted[]); } catch { /* a corrupt store is not a crash */ }
}

export function newId(): string { return 'b' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }

/** Everything the Arena needs about one bot, with its holding in words. */
export function holdingText(id: string): string {
  const r = BOTS.get(id);
  if (!r) return '';
  if (!(r.wallet.qty > 0)) return 'all cash';
  const px = price(r.def.sym) || r.wallet.lastPx;
  const pl = r.wallet.qty * px - r.wallet.cost;
  return r.wallet.qty.toPrecision(4) + ' ' + r.def.sym + ' open · ' + (pl >= 0 ? '+' : '−') + Math.abs(pl).toFixed(2) + ' USDT';
}

/** The three installed effects, as the desk uses them. */
export const bars = (def: BotDef): Promise<readonly Candle[]> => need().bars(def.sym, def.interval, 1000);
export const js = (def: BotDef, ctx: BotCtx): Promise<Decision> => need().js(def, ctx);
export const signal = (def: BotDef, ctx: BotCtx): Promise<Decision> => need().signal(def, ctx);

/** A page that is closing should not leave a timer behind. */
export function sleep(): void { BOTS.sleep(); }
export function wake(): void { if (BOTS.runs().some(r => r.status === 'live')) BOTS.wake(); }
export const app = (): any => G.DLAPP;
