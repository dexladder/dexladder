/**
 * Perpetual-futures value types. Plain data, like the spot engine: serialisable, comparable,
 * replayable. Every perp is USDT-margined, linear, ISOLATED: a position can never lose more than
 * the margin that was put into it, which is the one sentence a beginner must be able to trust.
 */

export type PerpSide = 'long' | 'short';
export type PerpMode = 'beginner' | 'advanced';

/** One step of the maintenance-margin ladder. `cum` keeps the requirement continuous across steps. */
export interface MarginTier {
  /** upper bound of position notional (USD) for this step; Infinity for the last */
  readonly upTo: number;
  /** maintenance-margin rate */
  readonly mmr: number;
  /** the most leverage a position of this size may use */
  readonly maxLev: number;
  /** maintenance amount (USD): maintenance = notional × mmr − cum */
  readonly cum: number;
}

/** Everything the desk needs to know about one perp market. */
export interface PerpSpec {
  readonly sym: string;
  /** 'major' | 'large' | 'alt' — decides the leverage ceiling and the ladder */
  readonly cls: AssetClass;
  readonly tiers: readonly MarginTier[];
  /** the ceiling for this trader right now (mode and asset class applied, before size) */
  readonly maxLev: number;
  readonly takerFee: number;
  /** hours between funding settlements (8, or 1 on Hyperliquid) */
  readonly fundingHours: number;
  /** smallest margin the desk accepts, USDT */
  readonly minMargin: number;
}

export type AssetClass = 'major' | 'large' | 'alt';

/**
 * An open position. `margin` is the isolated collateral as it stands now: posted margin, plus any
 * added, minus any removed, plus funding received, minus funding paid. `cashIn` is every USDT that
 * left the wallet for this position (margin posted and added, open fee) minus margin removed, so
 * the trade's realised result is simply what comes back minus `cashIn`.
 */
export interface PerpPosition {
  readonly v: 2;
  readonly id: string;
  readonly sym: string;
  readonly side: PerpSide;
  readonly lev: number;
  /** base units */
  readonly qty: number;
  /** average entry price, USDT */
  readonly entry: number;
  readonly margin: number;
  readonly cashIn: number;
  readonly openFee: number;
  /** net funding over the life of the position: + paid, − received (USDT) */
  readonly funding: number;
  /** the last settlement this position has taken part in (ms) */
  readonly lastFundingAt: number;
  readonly venue: string;
  readonly mode: PerpMode;
  readonly takerFee: number;
  readonly fundingHours: number;
  /** maintenance tier fixed from the entry notional */
  readonly mmr: number;
  readonly cum: number;
  /** protective stop-loss / take-profit on the MARK price (optional) */
  readonly sl?: number;
  readonly tp?: number;
  readonly t: number;
}

/** Why a position left the book. */
export type CloseReason = 'manual' | 'stop-loss' | 'take-profit' | 'liquidation';
