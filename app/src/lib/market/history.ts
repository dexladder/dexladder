/**
 * Price history, honestly. A coin's history array (`hist`, 336 samples ≈ 7 days at 30 min) comes
 * from the price source's sparkline. Sources without one (the Coinlore rung, a snapshot saved
 * without a sparkline) pad the array with a constant — and the charts then draw a flat line and a
 * cliff that never happened, and every indicator that reads the series (RSI, correlation, vol
 * cones) reads a fiction. This module recognises that padding and turns public candles into a
 * real series of the same length. Pure: the adapter fetches and writes.
 */

/** Values equal to 6 significant figures. */
const same = (a: number, b: number): boolean => Math.abs(a - b) <= Math.abs(b) * 1e-6;

/**
 * Is this series padded rather than observed? Real 30-minute prices of a listed coin do not sit
 * still: a run of identical values covering ≥ 25% of the series, or ≤ 3 distinct values in all,
 * is a placeholder.
 */
export function isFabricated(hist: readonly number[]): boolean {
  const h = hist.filter(v => Number.isFinite(v) && v > 0);
  if (h.length < 24) return true;
  let run = 1, longest = 1;
  const distinct: number[] = [h[0]!];
  for (let i = 1; i < h.length; i++) {
    if (same(h[i]!, h[i - 1]!)) { run++; if (run > longest) longest = run; } else run = 1;
    if (distinct.length <= 3 && !distinct.some(d => same(d, h[i]!))) distinct.push(h[i]!);
  }
  return distinct.length <= 3 || longest >= h.length * 0.25;
}

/** Resample `xs` to exactly `n` points by linear interpolation (keeps first and last). */
export function resample(xs: readonly number[], n: number): number[] {
  if (!xs.length || n < 1) return [];
  if (xs.length === 1) return new Array<number>(n).fill(xs[0]!);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? xs.length - 1 : (i * (xs.length - 1)) / (n - 1), a = Math.floor(t), f = t - a;
    const lo = xs[a]!, hi = xs[Math.min(xs.length - 1, a + 1)]!;
    out.push(lo + (hi - lo) * f);
  }
  return out;
}

/**
 * A history series of `n` points from real closes, ending at the live price. The candles are
 * quoted against USDT or USD, the app against its consensus USD price; the whole series is
 * scaled by live ÷ last close (a basis of a few basis points) so it joins the live price with no
 * step — shape and returns are unchanged.
 */
export function fromCloses(closes: readonly number[], live: number, n: number): number[] | null {
  const c = closes.filter(v => Number.isFinite(v) && v > 0);
  if (c.length < 24 || !(live > 0)) return null;
  const k = live / c[c.length - 1]!;
  if (!(k > 0.8 && k < 1.25)) return null;               // a different asset or a broken quote: refuse
  const out = resample(c.map(v => v * k), n);
  out[out.length - 1] = live;
  return out;
}

/** Closes from Binance klines rows ([openTime, open, high, low, close, …]), oldest first. */
export function binanceCloses(rows: unknown): number[] {
  return Array.isArray(rows) ? rows.map(r => (Array.isArray(r) ? +r[4] : NaN)).filter(v => v > 0) : [];
}
/** Closes from a Kraken OHLC response ({result:{PAIR:[[time,o,h,l,c,…]],last}}), oldest first. */
export function krakenCloses(j: unknown): number[] {
  const res = j && typeof j === 'object' ? (j as { result?: Record<string, unknown> }).result : undefined;
  if (!res) return [];
  const key = Object.keys(res).find(k => k !== 'last');
  const rows = key ? res[key] : null;
  return Array.isArray(rows) ? rows.map(r => (Array.isArray(r) ? +r[4] : NaN)).filter(v => v > 0) : [];
}
/** Closes from Coinbase candles ([[time, low, high, open, close, volume]], newest first). */
export function coinbaseCloses(rows: unknown): number[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter(Array.isArray).slice().sort((a, b) => +a[0] - +b[0]).map(r => +r[4]).filter(v => v > 0);
}
