/**
 * The synthetic order book: deterministic, anchored to the coin's real 24h volume.
 *
 *   spread      by volume tier — 0.6 / 1.4 / 3.5 / 9 / 22 bps (>$5B, >$500M, >$50M, >$5M, rest)
 *   depth       max($1,800, 0.04% of 24h volume) resting within ±0.1% of mid
 *   levels      40 per side, geometric widening (×1.19 per level)
 *   shape       seeded per pair (FNV-1a of "SYM|QUOTE") — the same book every time for the same market
 *   healing     liquidity our fills eat comes back LINEARLY over 6 s
 *
 * Pure: time and prices are arguments. Nothing here reads a clock, a global or the network.
 */
import type { Book, LiveBook, LiveLevel, MarketStats, RawLevel, Take } from './types';

export const LEVELS = 40;
export const HEAL_MS = 6000;
/** A stored book is rebuilt when mid moves more than this fraction, or after REBUILD_MS. */
export const REBUILD_MOVE = 2e-5;
export const REBUILD_MS = 1500;

/** FNV-1a 32-bit. */
export function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/** Deterministic [0,1) noise for level i of a seeded side (legacy sin-hash, kept bit-exact). */
export function levelNoise(seed: number, i: number): number {
  const v = 43758.5453 * Math.sin(1e-4 * seed + 12.9898 * i);
  return v - Math.floor(v);
}

export function spreadBps(vol24: number): number {
  return vol24 > 5e9 ? 0.6 : vol24 > 5e8 ? 1.4 : vol24 > 5e7 ? 3.5 : vol24 > 5e6 ? 9 : 22;
}

/** Resting depth (USD) within ±0.1% of mid. Unknown volume falls back to 3% of market cap, then $4M. */
export function depthUSD(stats: Pick<MarketStats, 'vol24' | 'mcap'>): number {
  let vol = stats.vol24 || 0;
  if (!(vol > 0)) vol = stats.mcap ? 0.03 * stats.mcap : 4e6;
  return Math.max(1800, 4e-4 * vol);
}

/** Distance of level i from mid, as a price. */
export function levelDistance(mid: number, half: number, i: number): number {
  return half + 3e-5 * mid * (Math.pow(1.19, i) - 1) / 0.19;
}

function scale(side: { p: number; w: number }[], mid: number, dUSD: number): RawLevel[] {
  let band = 0;
  side.forEach(L => { if (Math.abs(L.p - mid) / mid <= 0.001) band += L.w; });
  if (band <= 0) band = side[0]!.w;
  const k = dUSD / (band * mid);
  return side.map(L => ({ p: L.p, w: L.w, a: L.w * k, eat: 0, eatT: 0 }));
}

/** A fresh, untouched book for `sym|quote` at `mid`. null when there is no price. */
export function buildBook(sym: string, quote: string, mid: number, stats: MarketStats, now: number): Book | null {
  if (!(mid > 0)) return null;
  const seed = hash32(sym + '|' + quote);
  const half = (mid * spreadBps(stats.vol24 || 0)) / 2 / 1e4;
  const asks: { p: number; w: number }[] = [], bids: { p: number; w: number }[] = [];
  for (let i = 0; i < LEVELS; i++) {
    asks.push({ p: mid + levelDistance(mid, half, i), w: (0.6 + 0.8 * levelNoise(seed, i)) * (1 + 0.16 * i) });
    bids.push({ p: mid - levelDistance(mid, half, i), w: (0.6 + 0.8 * levelNoise(seed, i + 91)) * (1 + 0.16 * i) });
  }
  const d = depthUSD(stats);
  return { mid, asks: scale(asks, mid, d), bids: scale(bids, mid, d), t: now };
}

export function needsRebuild(prev: Book | null | undefined, mid: number, now: number): boolean {
  return !prev || Math.abs(prev.mid - mid) / mid > REBUILD_MOVE || now - prev.t > REBUILD_MS;
}

/** Carry our own consumption across a rebuild, level by level. */
export function carryEat(prev: Book | null | undefined, next: Book): Book {
  if (!prev) return next;
  const carry = (n: readonly RawLevel[], o: readonly RawLevel[]) =>
    n.map((L, i) => (i < o.length ? { ...L, eat: o[i]!.eat, eatT: o[i]!.eatT } : L));
  return { ...next, asks: carry(next.asks, prev.asks), bids: carry(next.bids, prev.bids) };
}

/** Eaten quantity still missing at `now` — linear heal to zero over HEAL_MS. */
export function eatenAt(L: RawLevel, now: number): number {
  if (!L.eat) return 0;
  const heal = Math.min(1, Math.max(0, now - L.eatT) / HEAL_MS);
  const left = L.eat * (1 - heal);
  return left <= 1e-12 ? 0 : left;
}

/** The book as a taker sees it at `now`. */
export function liveBook(b: Book, now: number): LiveBook {
  const view = (side: readonly RawLevel[]): LiveLevel[] => side.map((L, i) => ({ p: L.p, a: Math.max(0, L.a - eatenAt(L, now)), i }));
  return { mid: b.mid, asks: view(b.asks), bids: view(b.bids) };
}

/**
 * Record our consumption. The remaining eaten amount at `now` is folded in first, so a level hit
 * twice heals from the second hit with everything still missing.
 */
export function consume(b: Book, bookSide: 'asks' | 'bids', taken: readonly Take[], now: number): Book {
  if (!taken.length) return b;
  const side = b[bookSide].slice();
  for (const t of taken) {
    const L = side[t.i];
    if (!L) continue;
    side[t.i] = { ...L, eat: eatenAt(L, now) + t.q, eatT: now };
  }
  return { ...b, [bookSide]: side };
}
