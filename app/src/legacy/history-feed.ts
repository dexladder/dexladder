/**
 * Backfills real price history for the coins the charts are showing (see lib/market/history.ts).
 * Called from the Terminal chart and the Markets spotlight on every draw; costs one array scan
 * when the series is real. When it is padded, fetches 7 days of 30-minute candles through the
 * app's own fetch path (DLCORE.jget: cache, timeout, host health) from public market data —
 * Binance's market-data host, then Kraken, then Coinbase — writes the series in place, and
 * redraws. Never blocks, never retries a coin sooner than two minutes after a miss.
 */
import { isFabricated, fromCloses, binanceCloses, krakenCloses, coinbaseCloses } from '../lib/market/history';
import { legacy } from './globals';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = globalThis as any;
const N = 336, OK_MS = 10 * 60_000, MISS_MS = 2 * 60_000;
const KR: Readonly<Record<string, string>> = { BTC: 'XBT', DOGE: 'XDG' };
const last: Record<string, { at: number; ok: boolean }> = {};
const busy: Record<string, true> = {};
export const stats = { filled: 0, missed: 0, sources: {} as Record<string, number> };

type Src = { name: string; url: (s: string) => string; closes: (d: unknown) => number[] };
const SOURCES: readonly Src[] = [
  { name: 'binance', url: s => `https://data-api.binance.vision/api/v3/klines?symbol=${s}USDT&interval=30m&limit=${N}`, closes: binanceCloses },
  { name: 'kraken', url: s => `https://api.kraken.com/0/public/OHLC?pair=${KR[s] || s}USD&interval=30`, closes: krakenCloses },
  { name: 'coinbase', url: s => `https://api.exchange.coinbase.com/products/${s}-USD/candles?granularity=1800`, closes: coinbaseCloses },
];

function get(url: string, key: string): Promise<unknown> {
  const C = G.DLCORE;
  // only through the app's own data path (no network code of its own — a gate law)
  if (!C || typeof C.jget !== 'function') return Promise.reject(new Error('no data path'));
  return C.jget(url, { key, ttl: OK_MS, ms: 8000 }).then((r: any) => (r && 'data' in r ? r.data : r));
}

/** Replace the contents of `arr` in place (legacy code holds references to these arrays). */
function write(arr: number[] | undefined, xs: number[]): void {
  if (!Array.isArray(arr)) return;
  arr.length = 0;
  for (const v of xs) arr.push(v);
}

async function backfill(sym: string): Promise<boolean> {
  for (const s of SOURCES) {
    try {
      const c = legacy.coin(sym) as any;
      if (!c || !(c.price > 0)) return false;
      // 30-minute candles: the last N are the last 7 days (Kraken returns 15 days, Coinbase ~6)
      const series = fromCloses(s.closes(await get(s.url(sym), 'dl.hist.' + s.name + '.' + sym)).slice(-N), c.price, N);
      if (!series) continue;
      write(c.hist, series);
      if (Array.isArray(c.spark)) write(c.spark, series); else c.spark = series.slice();
      stats.filled++; stats.sources[s.name] = (stats.sources[s.name] || 0) + 1;
      return true;
    } catch { /* next source */ }
  }
  stats.missed++;
  return false;
}

/** Make sure `sym`'s history is observed, not padded. Returns immediately; redraws when it lands. */
export function ensure(sym: string): void {
  if (!sym || sym === 'USDT' || busy[sym]) return;
  const c = legacy.coin(sym) as any;
  if (!c || !Array.isArray(c.hist) || !isFabricated(c.hist)) return;
  const l = last[sym], now = Date.now();
  if (l && now - l.at < (l.ok ? OK_MS : MISS_MS)) return;
  busy[sym] = true;
  backfill(sym).then(ok => {
    last[sym] = { at: Date.now(), ok };
    delete busy[sym];
    if (ok) { legacy.call('drawCoinChart'); legacy.call('updateSpotlight'); }
  });
}
