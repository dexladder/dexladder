/**
 * Positions opened on the old DLSIM desk (S.dlsim.perps, v151–v156) carry {margin, fee, fund,
 * lastF} with funding kept OUTSIDE the margin and a flat 94%-burn liquidation. They are carried
 * forward — never dropped — into the v2 shape: funding moves into the margin, cashIn records what
 * the wallet paid, and the maintenance step comes from the spec's ladder.
 */
import { tierFor } from './spec';
import type { PerpMode, PerpPosition, PerpSpec } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
export function migrate(raw: any, specOf: (sym: string) => PerpSpec, mode: PerpMode, venue: string, now: number): PerpPosition | null {
  if (!raw || typeof raw !== 'object') return null;
  const qty = +raw.qty, entry = +raw.entry, margin = +raw.margin;
  if (!(qty > 0 && entry > 0 && isFinite(margin)) || typeof raw.sym !== 'string' || (raw.side !== 'long' && raw.side !== 'short')) return null;
  if (raw.v === 2) return raw as PerpPosition;
  const s = specOf(raw.sym), fee = +raw.fee || 0, fund = +raw.fund || 0, tier = tierFor(s.tiers, qty * entry);
  return {
    v: 2, id: String(raw.id || Math.floor(now).toString(36)), sym: raw.sym, side: raw.side, lev: Math.max(1, Math.round(+raw.lev || 1)),
    qty, entry, margin: margin - fund, cashIn: margin + fee, openFee: fee, funding: fund,
    lastFundingAt: +raw.lastF || +raw.t || now, venue, mode, takerFee: s.takerFee, fundingHours: s.fundingHours,
    mmr: tier.mmr, cum: tier.cum, t: +raw.t || now,
  };
}
