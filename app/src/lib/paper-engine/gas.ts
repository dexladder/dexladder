/**
 * Gas and priority fees — what an on-chain swap costs to send, and what can happen to it.
 *
 * Only the DEX (AMM) venue settles on-chain; order-book venues match off-chain and charge no gas.
 * The model is Ethereum L1 (EIP-1559), priced from the live gas signal the app already reads
 * (eth_gasPrice ≈ base fee + a typical tip):
 *
 *   price paid   = signal gwei × tier multiplier   (Low 0.9 · Medium 1.0 · High 1.3)
 *   swap gas     = 150,000 units  (a typical Uniswap-style swap)
 *   revert gas   =  90,000 units  (a swap that fails on-chain still burns the gas it used)
 *   cancel gas   =  21,000 units  (a stuck swap is cancelled by a replacement at High)
 *
 * Congestion is read RELATIVE to the recent gas history kept on this device (gwei ÷ its median),
 * so the model works whether "normal" is 2 gwei or 40. What a tier buys you under congestion is a
 * small published table — the table is the documentation. The random draw is passed in.
 */

export type PriorityTier = 'low' | 'medium' | 'high';
export type Congestion = 'calm' | 'busy' | 'congested';
export type TxFate = 'included' | 'pending' | 'timeout' | 'reverted';

export const TIER_MULT: Readonly<Record<PriorityTier, number>> = Object.freeze({ low: 0.9, medium: 1.0, high: 1.3 });
export const GAS_UNITS = Object.freeze({ swap: 150_000, revert: 90_000, cancel: 21_000 });
/** used when no live signal has ever been read (clearly labelled "estimate" to the user) */
export const FALLBACK_GWEI = 5;
/** a tx that waits this many blocks is "pending"; each block is 12 s on Ethereum */
export const BLOCK_SECONDS = 12;

/**
 * P(fate) per congestion level and tier: [included next block, pending a few blocks, never picked
 * up]. Rows sum to 1. A REVERT is not drawn here — it is caused: a swap that lands after the price
 * has moved past the trader's slippage tolerance reverts on-chain (see the presenter).
 */
export const FATE_TABLE: Readonly<Record<Congestion, Readonly<Record<PriorityTier, readonly [number, number, number]>>>> = Object.freeze({
  calm:      { low: [0.88, 0.11, 0.01], medium: [0.97, 0.03, 0.00], high: [0.995, 0.005, 0.00] },
  busy:      { low: [0.50, 0.35, 0.15], medium: [0.84, 0.15, 0.01], high: [0.96, 0.04, 0.00] },
  congested: { low: [0.20, 0.40, 0.40], medium: [0.62, 0.32, 0.06], high: [0.93, 0.07, 0.00] },
});

export interface GasSignal {
  /** gwei the network is asking right now */
  readonly gwei: number;
  /** median of the recent readings kept on this device */
  readonly reference: number;
  /** when it was read (ms); 0 for the fallback */
  readonly at: number;
  readonly source: 'live' | 'cached' | 'estimate' | 'node';
}

export function median(xs: readonly number[]): number {
  const s = xs.filter(x => x > 0 && Number.isFinite(x)).slice().sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Build a signal from the latest reading and the kept history (the reading is part of it). */
export function signal(gwei: number | null | undefined, history: readonly number[], at: number, source: GasSignal['source']): GasSignal {
  if (!(gwei != null && gwei > 0)) return { gwei: FALLBACK_GWEI, reference: FALLBACK_GWEI, at: 0, source: 'estimate' };
  const ref = median([...history, gwei]);
  return { gwei, reference: ref > 0 ? ref : gwei, at, source };
}

export function congestion(s: GasSignal): Congestion {
  const r = s.reference > 0 ? s.gwei / s.reference : 1;
  return r >= 2 ? 'congested' : r >= 1.25 ? 'busy' : 'calm';
}

/** Network cost of `units` gas at `gwei`, in the pair's quote asset. */
export function gasCost(units: number, gwei: number, ethUSD: number, quoteUSD: number): number {
  if (!(units > 0 && gwei > 0 && ethUSD > 0)) return 0;
  const usd = units * gwei * 1e-9 * ethUSD;
  return usd / (quoteUSD > 0 ? quoteUSD : 1);
}

export interface Fate {
  readonly fate: TxFate;
  /** blocks the transaction waited before it was mined (0 = next block) */
  readonly blocks: number;
  /** gas units the account pays for */
  readonly units: number;
  /** gwei those units are paid at */
  readonly gwei: number;
  readonly congestion: Congestion;
  readonly tier: PriorityTier;
}

/**
 * What happens to a swap sent at `tier` into `s`. `u` picks the fate from the table, `v` how long
 * a pending transaction waits (3–7 blocks). A timeout is cancelled by a replacement at High, so it
 * pays cancel gas at the High price.
 */
export function fateOf(s: GasSignal, tier: PriorityTier, u: number, v: number): Fate {
  const c = congestion(s), row = FATE_TABLE[c][tier], paid = s.gwei * TIER_MULT[tier];
  if (u < row[0]) return { fate: 'included', blocks: 1, units: GAS_UNITS.swap, gwei: paid, congestion: c, tier };
  if (u < row[0] + row[1]) return { fate: 'pending', blocks: 3 + Math.floor(Math.min(0.9999, Math.max(0, v)) * 5), units: GAS_UNITS.swap, gwei: paid, congestion: c, tier };
  return { fate: 'timeout', blocks: 0, units: GAS_UNITS.cancel, gwei: s.gwei * TIER_MULT.high, congestion: c, tier };
}

/** The same transaction, reverted on-chain: it burned revert gas at the price it was sent at. */
export function reverted(f: Fate): Fate {
  return { ...f, fate: 'reverted', units: GAS_UNITS.revert };
}

/** Probability the swap is never picked up at this tier right now — shown on the ticket. */
export function timeoutRisk(s: GasSignal, tier: PriorityTier): number {
  return FATE_TABLE[congestion(s)][tier][2];
}

/** Probability it waits several blocks (and so meets a moved price). */
export function pendingRisk(s: GasSignal, tier: PriorityTier): number {
  return FATE_TABLE[congestion(s)][tier][1];
}

/**
 * How far the price may have drifted while a transaction was pending: a normal draw scaled by the
 * coin's 24h move spread over the wait (σ ≈ |24h %| · √(seconds / 86,400)), ×1.5 when the chain
 * is busy and ×2.5 when congested. `z` is supplied.
 */
export function pendingDrift(chg24Pct: number, seconds: number, z: number, c: Congestion = 'calm'): number {
  // congestion and volatility travel together: a congested chain is a moving market
  const k = c === 'congested' ? 2.5 : c === 'busy' ? 1.5 : 1;
  const sigma = (Math.max(1, Math.abs(chg24Pct)) / 100) * Math.sqrt(Math.max(0, seconds) / 86_400) * k;
  return sigma * z;
}

/** A standard normal from two uniforms (Box–Muller). */
export function normal(u1: number, u2: number): number {
  return Math.sqrt(-2 * Math.log(Math.max(1e-12, u1))) * Math.cos(2 * Math.PI * u2);
}

/** Plain-English account of what happened to a transaction. */
export function explainFate(f: Fate, costText: string): string {
  const load = f.congestion === 'calm' ? 'The network is calm' : f.congestion === 'busy' ? 'The network is busy' : 'The network is congested';
  switch (f.fate) {
    case 'included': return `${load}; your ${f.tier}-priority swap made the next block (~${BLOCK_SECONDS} s). Gas paid: ${costText}.`;
    case 'pending': return `${load}; your ${f.tier}-priority swap waited ${f.blocks} blocks (~${f.blocks * BLOCK_SECONDS} s) before a validator took it, and the price moved meanwhile. Gas paid: ${costText}.`;
    case 'timeout': return `${load} and your ${f.tier} tip was too low: no validator picked the swap up, so it was cancelled with a replacement transaction. Nothing traded — the cancellation still cost ${costText}. Higher priority buys inclusion.`;
    default: return `${load}; your swap was mined but REVERTED on-chain — when it ran it could no longer meet its terms (usually: the price had moved past your slippage tolerance). Nothing traded, but the gas it burned is gone: ${costText}.`;
  }
}
