/**
 * Contract specs: how much leverage a market allows and how much maintenance margin a position of
 * a given size needs. The ladders follow the published shape of the large venues (a maintenance
 * rate that steps up with position size, a maintenance amount that keeps the requirement
 * continuous at each step, max leverage ≈ 1 ÷ (2 × mmr)) — rounded, so they are teachable.
 */
import { venue as venueOf } from '../paper-engine/venues';
import type { AssetClass, MarginTier, PerpMode, PerpSpec } from './types';

/** Beginner's ceiling: enough to feel leverage, not enough to be erased by an ordinary day. */
export const BEGINNER_MAX_LEV = 10;
export const MIN_MARGIN = 10;
export const MAX_POSITIONS = 6;
/**
 * Leverage ceiling by asset class (Advanced). The large venues go to 50-125x on majors; the
 * product stops at 25x (owner's call, 11 Sep 2026): past it a paper account dies inside one
 * candle and the desk teaches nothing but noise.
 */
export const CLASS_MAX_LEV: Readonly<Record<AssetClass, number>> = Object.freeze({ major: 25, large: 25, alt: 10 });

/**
 * How much deeper a perpetual's book is than the spot book the desk models. Perp venues carry
 * far more resting size than the spot pair, so an Advanced perp fill walks a book this many
 * times deeper than the spot engine's (owner's call, 11 Sep 2026).
 */
export const PERP_BOOK_DEPTH = 3;

/** [notional upper bound USD, maintenance rate] per step */
const LADDERS: Readonly<Record<AssetClass, readonly (readonly [number, number])[]>> = Object.freeze({
  major: [[5e4, 0.004], [2.5e5, 0.005], [1e6, 0.01], [5e6, 0.025], [2e7, 0.05], [Infinity, 0.125]],
  large: [[5e4, 0.01], [2.5e5, 0.015], [1e6, 0.025], [5e6, 0.05], [Infinity, 0.125]],
  alt: [[2.5e4, 0.02], [1e5, 0.025], [5e5, 0.05], [2e6, 0.1], [Infinity, 0.25]],
});

/** Build a ladder: each step's maintenance amount makes the requirement continuous at its lower edge. */
export function ladder(steps: readonly (readonly [number, number])[], cap: number): MarginTier[] {
  const out: MarginTier[] = [];
  let cum = 0, prevUp = 0, prevMmr = 0;
  for (const [upTo, mmr] of steps) {
    if (out.length) cum += prevUp * (mmr - prevMmr);
    out.push({ upTo, mmr, cum, maxLev: Math.max(1, Math.min(cap, Math.floor(1 / (2 * mmr) + 1e-9))) });
    prevUp = upTo; prevMmr = mmr;
  }
  return out;
}

/** Asset class from market capitalisation (USD). Unknown size is treated as the riskiest class. */
export function assetClass(mcap: number): AssetClass {
  return mcap >= 1e11 ? 'major' : mcap >= 1e10 ? 'large' : 'alt';
}

/** The maintenance step a position of `notional` USD falls in. */
export function tierFor(tiers: readonly MarginTier[], notional: number): MarginTier {
  for (const t of tiers) if (notional <= t.upTo) return t;
  return tiers[tiers.length - 1]!;
}

/** Hours between funding settlements on a venue: Hyperliquid settles hourly, the rest every 8 h. */
export function fundingHoursOf(venueId: string): number { return venueId === 'hyperliquid' ? 1 : 8; }

export function specFor(sym: string, mcap: number, mode: PerpMode, venueId: string): PerpSpec {
  const cls = assetClass(mcap), tiers = ladder(LADDERS[cls], CLASS_MAX_LEV[cls]);
  const adv = mode === 'advanced';
  return {
    sym, cls, tiers,
    maxLev: adv ? CLASS_MAX_LEV[cls] : Math.min(BEGINNER_MAX_LEV, CLASS_MAX_LEV[cls]),
    takerFee: adv ? venueOf(venueId).pt : venueOf('binance').pt,
    fundingHours: adv ? fundingHoursOf(venueId) : 8,
    minMargin: MIN_MARGIN,
  };
}

/** The most leverage a position of `margin` USDT may use on this spec (size steps included). */
export function maxLevFor(spec: PerpSpec, margin: number): number {
  let best = 1;
  for (let L = 1; L <= spec.maxLev; L++) if (L <= tierFor(spec.tiers, margin * L).maxLev) best = L;
  return best;
}
