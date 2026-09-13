/**
 * Funding: the payment that keeps a perpetual's price tied to spot. At every settlement the side
 * the market is crowded into pays the other side  rate × position notional. Positive rate → longs
 * pay shorts. Settlements sit on a fixed UTC clock (00:00 / 08:00 / 16:00, or every hour on
 * Hyperliquid); only positions OPEN at a settlement pay or receive it.
 *
 * Isolated margin means the payment comes out of (or goes into) the position's own margin — so
 * funding really does move the liquidation price. A position that sleeps through many settlements
 * (the app was closed) settles each missed one at the current mark and rate, and says so.
 */
import { dir } from './margin';
import type { PerpPosition } from './types';

const HOUR = 3_600_000;
/** guard against a malformed feed value: the large venues cap funding well inside ±0.75 % / 8 h */
export const RATE_CAP_8H = 0.0075;
/** a position that sleeps for weeks settles at most this many intervals on wake */
export const MAX_CATCHUP = 2000;

export interface FundingRate {
  /** rate per 8 hours (the unit every venue quotes, whatever its cadence) */
  readonly rate8h: number;
  readonly source: 'live' | 'estimate';
  /** where a live rate came from (venue name), for the label */
  readonly venue?: string;
}

export function clampRate(r: number): number { return Math.max(-RATE_CAP_8H, Math.min(RATE_CAP_8H, r)); }

/**
 * The labelled fallback when no venue is reachable: the 0.01 % / 8 h baseline most venues charge
 * in a quiet market, tilted by the 24 h move (a hot market crowds longs, who then pay more).
 */
export function estimateRate8h(chg24Pct: number): number {
  return 1e-4 + 5e-4 * Math.max(-1, Math.min(1, (chg24Pct || 0) / 10));
}

export function rateOf(live: number | null | undefined, chg24Pct: number, venue?: string): FundingRate {
  return live != null && isFinite(live)
    ? { rate8h: clampRate(live), source: 'live', ...(venue ? { venue } : {}) }
    : { rate8h: estimateRate8h(chg24Pct), source: 'estimate' };
}

/** The rate actually charged per settlement on a cadence of `hours`. */
export function intervalRate(rate8h: number, hours: number): number { return (rate8h * hours) / 8; }

/** The first settlement strictly after `t`. */
export function nextSettlement(t: number, hours: number): number {
  const H = hours * HOUR;
  return Math.floor(t / H) * H + H;
}

/** Settlement instants s with from < s ≤ to (oldest first, at most MAX_CATCHUP). */
export function settlementsBetween(from: number, to: number, hours: number): number[] {
  const out: number[] = [];
  for (let s = nextSettlement(from, hours); s <= to && out.length < MAX_CATCHUP; s += hours * HOUR) out.push(s);
  return out;
}

/** One settlement's payment for a position: + the position pays, − it receives (USDT). */
export function payment(p: Pick<PerpPosition, 'side' | 'qty'>, mark: number, rate8h: number, hours: number): number {
  return p.qty * mark * intervalRate(rate8h, hours) * dir(p.side);
}

export interface Settled {
  readonly position: PerpPosition;
  /** net paid across the settlements (+ paid, − received) */
  readonly paid: number;
  readonly count: number;
  /** settlements were missed while the app was closed and priced at the current mark */
  readonly caughtUp: boolean;
}

/** Apply every settlement due up to `now` to the position's margin. */
export function settle(p: PerpPosition, mark: number, rate8h: number, now: number): Settled {
  const due = settlementsBetween(p.lastFundingAt, now, p.fundingHours);
  if (!due.length || !(mark > 0)) return { position: p, paid: 0, count: 0, caughtUp: false };
  const paid = payment(p, mark, rate8h, p.fundingHours) * due.length;
  return {
    position: { ...p, margin: p.margin - paid, funding: p.funding + paid, lastFundingAt: due[due.length - 1]! },
    paid, count: due.length, caughtUp: due.length > 1,
  };
}

/** Human line: "0.0100 % / 8 h · longs pay shorts". */
export function describeRate(r: FundingRate): string {
  const pct = (r.rate8h * 100).toFixed(4) + '% / 8h';
  const who = r.rate8h > 0 ? 'longs pay shorts' : r.rate8h < 0 ? 'shorts pay longs' : 'nobody pays';
  return pct + ' · ' + who + ' · ' + (r.source === 'live' ? 'live' + (r.venue ? ' (' + r.venue + ')' : '') : 'estimate from the 24h move');
}
