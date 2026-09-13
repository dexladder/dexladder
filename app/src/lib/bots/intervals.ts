/** Bar sizes a bot trades on, and where the bar boundaries fall (UTC-aligned, like the venues'). */
import type { BotInterval } from './types';

export const INTERVAL_MS: Readonly<Record<BotInterval, number>> = Object.freeze({
  '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000,
});

export const INTERVAL_LABEL: Readonly<Record<BotInterval, string>> = Object.freeze({
  '1m': '1 minute', '5m': '5 minutes', '15m': '15 minutes', '1h': '1 hour', '4h': '4 hours', '1d': '1 day',
});

/** start of the bar that contains `t` */
export const barStart = (t: number, iv: BotInterval): number => Math.floor(t / INTERVAL_MS[iv]) * INTERVAL_MS[iv];
/** start of the bar after the one containing `t` */
export const nextBarAt = (t: number, iv: BotInterval): number => barStart(t, iv) + INTERVAL_MS[iv];

/** how many closed bars the bot should load before it starts (indicators need history) */
export const HISTORY_BARS = 400;

/** the Binance market-data URL for the last `limit` bars of a symbol, or the bars ending at `end` */
export function klinesUrl(sym: string, iv: BotInterval, limit: number, end?: number): string {
  return 'https://data-api.binance.vision/api/v3/klines?symbol=' + sym + 'USDT&interval=' + iv + '&limit=' + limit + (end ? '&endTime=' + end : '');
}

/** Coinbase granularity for the same bar, so a second venue can answer when the first cannot. */
export const COINBASE_SEC: Readonly<Record<BotInterval, number>> = Object.freeze({ '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 });
export const coinbaseUrl = (sym: string, iv: BotInterval): string => 'https://api.exchange.coinbase.com/products/' + sym + '-USD/candles?granularity=' + COINBASE_SEC[iv];

/**
 * Merge freshly fetched bars into what the bot holds: only bars that CLOSED before `now` count,
 * duplicates by time are replaced (a venue may restate its last bar), order is kept, and the
 * buffer is capped. Returns the merged bars and how many were new.
 */
export function mergeBars<T extends { readonly t: number }>(have: readonly T[], fresh: readonly T[], iv: BotInterval, now: number, cap = 1200): { bars: T[]; added: number } {
  const closedBefore = barStart(now, iv);
  const m = new Map<number, T>();
  for (const b of have) m.set(b.t, b);
  let added = 0;
  for (const b of fresh) { if (b.t < closedBefore) { if (!m.has(b.t)) added++; m.set(b.t, b); } }
  const bars = [...m.values()].sort((a, b) => a.t - b.t);
  return { bars: bars.length > cap ? bars.slice(bars.length - cap) : bars, added };
}
