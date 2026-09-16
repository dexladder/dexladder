/**
 * Rewind desk — data half. Real candles for a chosen market, bar size and stretch of history,
 * through the payload's own fetch path (DLCORE.jget: cache, timeout, host health): Binance's
 * market-data host first (it is the only free source with deep history and a start/end window),
 * then Coinbase, then Kraken for recent ranges. Nothing is synthesised: if no venue has the bars,
 * the desk says so and loads nothing.
 */
import { binanceCandles, coinbaseCandles, krakenCandles, sanitize, INTERVALS, barsIn, gaps, type Candle, type IntervalId } from '../lib/backtest';
import { venue } from '../lib/paper-engine/venues';
import { legacy } from './globals';
import { modeOf, venueOf } from './perps';
import type { Era } from '../components/domain/bt-setup';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = globalThis as any;
const DAY = 86_400_000;
/** the desk replays at most this many bars — beyond it, a bigger bar size is the honest answer */
export const MAX_BARS = 1200;
/** bars drawn before the first tradable one, so the trader sees where the market came from */
export const CONTEXT = 40;

export const ERAS: readonly Era[] = Object.freeze([
  { id: 'd30', label: 'Last 30 days', from: 0, to: 0, interval: '1h', note: 'the market you have been watching' },
  { id: 'd90', label: 'Last 90 days', from: 0, to: 0, interval: '4h', note: 'a quarter' },
  { id: 'y1', label: 'Last 12 months', from: 0, to: 0, interval: '1d', note: 'a year of daily bars' },
  { id: 'covid', label: 'Mar 2020 · COVID crash', from: Date.UTC(2020, 1, 5), to: Date.UTC(2020, 3, 20), interval: '4h', note: 'the fastest halving of a market anyone had seen' },
  { id: 'top21', label: 'Nov 2021 · the cycle top', from: Date.UTC(2021, 9, 1), to: Date.UTC(2021, 11, 20), interval: '4h', note: 'the last leg up, and the turn nobody called' },
  { id: 'luna', label: 'May 2022 · LUNA spiral', from: Date.UTC(2022, 4, 1), to: Date.UTC(2022, 4, 31), interval: '1h', note: 'a top-ten coin going to zero in a week' },
  { id: 'ftx', label: 'Nov 2022 · FTX bank run', from: Date.UTC(2022, 10, 1), to: Date.UTC(2022, 10, 30), interval: '1h', note: 'an exchange failing in public' },
]);

export function eraWindow(id: string, interval: IntervalId, from: string, to: string, now: number): { from: number; to: number } {
  const e = ERAS.find(x => x.id === id);
  if (e && e.from) return { from: e.from, to: e.to };
  if (id === 'custom') {
    const f = Date.parse(from + 'T00:00:00Z'), t = Date.parse(to + 'T23:59:59Z');
    if (f > 0 && t > f) return { from: f, to: Math.min(t, now) };
  }
  const days = id === 'y1' ? 365 : id === 'd90' ? 90 : 30;
  return { from: now - days * DAY - CONTEXT * INTERVALS[interval], to: now };
}

/** The fee every fill in the replay pays: the trader's own venue profile. */
export function feeRate(): number {
  const S = legacy.S();
  return modeOf(S) === 'advanced' ? venue(venueOf(S)).t : 0.001;
}

/** Coins the desk offers: whatever the ladder is showing, most liquid first. */
export function markets(): string[] {
  const all = legacy.callIn('DLCORE', 'coinsAll') || [];
  const syms = (Array.isArray(all) ? all : []).filter((c: any) => c && c.sym && c.sym !== 'USDT' && (c.vol || 0) > 0)
    .sort((a: any, b: any) => (b.vol || 0) - (a.vol || 0)).map((c: any) => c.sym).slice(0, 40);
  return syms.length ? syms : ['BTC', 'ETH', 'SOL'];
}

const KR: Readonly<Record<string, string>> = { BTC: 'XBT', DOGE: 'XDG' };
const KR_MIN: Readonly<Record<IntervalId, number>> = { '1h': 60, '4h': 240, '1d': 1440 };
const CB_SEC: Readonly<Record<IntervalId, number>> = { '1h': 3600, '4h': 14400, '1d': 86400 };

function get(url: string, key: string): Promise<unknown> {
  const C = G.DLCORE;
  if (!C || typeof C.jget !== 'function') return Promise.reject(new Error('no data path'));
  return C.jget(url, { key, ttl: 10 * 60_000, ms: 9000 }).then((r: any) => (r && 'data' in r ? r.data : r));
}

async function binance(sym: string, interval: IntervalId, from: number, to: number): Promise<Candle[]> {
  const out: Candle[] = [];
  let cur = from;
  for (let page = 0; page < 6 && cur < to; page++) {
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${sym}USDT&interval=${interval}&startTime=${cur}&endTime=${to}&limit=1000`;
    const rows = binanceCandles(await get(url, `dl.rw.b.${sym}.${interval}.${cur}`));
    if (!rows.length) break;
    out.push(...rows);
    const last = rows[rows.length - 1]!.t;
    if (rows.length < 1000 || last <= cur) break;
    cur = last + INTERVALS[interval];
  }
  return out;
}

async function coinbase(sym: string, interval: IntervalId, from: number, to: number): Promise<Candle[]> {
  const out: Candle[] = [], span = 300 * INTERVALS[interval];
  for (let page = 0, cur = from; page < 6 && cur < to; page++, cur += span) {
    const end = Math.min(to, cur + span);
    const url = `https://api.exchange.coinbase.com/products/${sym}-USD/candles?granularity=${CB_SEC[interval]}&start=${new Date(cur).toISOString()}&end=${new Date(end).toISOString()}`;
    try { out.push(...coinbaseCandles(await get(url, `dl.rw.c.${sym}.${interval}.${cur}`))); } catch { break; }
  }
  return out;
}

async function kraken(sym: string, interval: IntervalId, from: number): Promise<Candle[]> {
  const url = `https://api.kraken.com/0/public/OHLC?pair=${KR[sym] || sym}USD&interval=${KR_MIN[interval]}&since=${Math.floor(from / 1000)}`;
  return krakenCandles(await get(url, `dl.rw.k.${sym}.${interval}.${Math.floor(from / DAY)}`));
}

export interface LoadResult { candles: Candle[]; source: string; gaps: number }

/** Real bars for the window, or an Error whose message is what the desk shows the trader. */
export async function load(sym: string, interval: IntervalId, from: number, to: number): Promise<LoadResult> {
  const want = barsIn(from, to, interval);
  if (want > MAX_BARS + CONTEXT) throw new Error(`That window is ${want.toLocaleString('en-US')} bars — more than a person can replay. Choose a bigger bar size or a shorter range.`);
  const tries: readonly [string, () => Promise<Candle[]>][] = [
    ['Binance', () => binance(sym, interval, from, to)],
    ['Coinbase', () => coinbase(sym, interval, from, to)],
    ['Kraken', () => kraken(sym, interval, from)],
  ];
  for (const [name, fn] of tries) {
    try {
      const candles = sanitize(await fn(), from, to);
      if (candles.length >= CONTEXT + 20) return { candles, source: name, gaps: gaps(candles, interval) };
    } catch { /* next venue */ }
  }
  throw new Error(`No venue has ${sym} bars for that window. ${sym} may not have been listed yet — try BTC or ETH, a later range, or a bigger bar size.`);
}
