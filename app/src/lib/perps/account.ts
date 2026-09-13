/**
 * applyPerp — the one balance transition for perpetuals, the sibling of the spot engine's
 * applyFill. It moves USDT between the wallet and a position's isolated margin and keeps the
 * shared account (stats, trade journal) honest. It never mutates its input.
 *
 *   open    wallet → margin + open fee
 *   margin  wallet ⇄ margin (add / remove)
 *   close   margin + P&L − close fee → wallet  (≥ 0: isolated margin caps the loss)
 *   funding moves no wallet money (it is paid from / into the margin) — ledger row only
 *
 * Realised P&L of a close = what comes back − cashIn (every USDT the position ever took), so fees,
 * funding and added margin are all in it, and a liquidation realises exactly −cashIn.
 */
import { JOURNAL_CAP, type Account, type JournalEntry } from '../paper-engine/account';
import { equity, notional } from './margin';
import type { CloseReason, PerpPosition } from './types';

const DUST = 1e-9;

export type PerpTxnType = 'Perp Long' | 'Perp Short' | 'Perp close' | 'Liquidated' | 'Funding' | 'Margin';
export interface PerpTxn {
  readonly type: PerpTxnType; readonly sym: string; readonly amt: number; readonly val: number; readonly quote: 'USDT';
  readonly lev?: number; readonly side?: PerpPosition['side']; readonly pl?: number; readonly note?: string;
}

export type PerpMove =
  | { readonly kind: 'open'; readonly position: PerpPosition }
  | { readonly kind: 'margin'; readonly position: PerpPosition; readonly delta: number }
  | { readonly kind: 'close'; readonly position: PerpPosition; readonly exit: number; readonly fraction: number; readonly reason: CloseReason; readonly now: number };

export type PerpResult =
  | { readonly ok: false; readonly reason: 'invalid' | 'insufficient-usdt' | 'too-much-margin-removed'; readonly need: number; readonly have: number }
  | { readonly ok: true; readonly account: Account; readonly txn: PerpTxn; readonly realizedUSD: number;
      /** the position after the move — null when it is gone */
      readonly position: PerpPosition | null;
      /** a close's own numbers (null otherwise) */
      readonly close: Closed | null };

export interface Closed {
  readonly qty: number; readonly exit: number; readonly fee: number; readonly cashOut: number; readonly pl: number;
  /** a liquidation: margin left at the mark (the insurance fund's liquidation fee) */
  readonly insuranceFee: number;
  /** a liquidation through the bankruptcy price: the shortfall the insurance fund covered */
  readonly shortfall: number;
}

interface Mut { bal: Record<string, number>; basis: Account['basis']; stats: { -readonly [K in keyof Account['stats']]: number }; journal: JournalEntry[] }
const mut = (a: Account): Mut => ({ bal: { ...a.bal }, basis: a.basis, stats: { ...a.stats }, journal: a.journal.slice() });

export function applyPerp(acct: Account, m: PerpMove): PerpResult {
  const p = m.position, usdt = acct.bal.USDT || 0;
  if (!(p.qty > 0 && p.entry > 0)) return { ok: false, reason: 'invalid', need: 0, have: 0 };
  if (m.kind === 'open') {
    const cost = p.margin + p.openFee;
    if (cost > usdt + DUST) return { ok: false, reason: 'insufficient-usdt', need: cost, have: usdt };
    const a = mut(acct);
    a.bal.USDT = usdt - cost; a.stats.feesUSD += p.openFee;
    return { ok: true, account: a, realizedUSD: 0, position: p, close: null,
      txn: { type: p.side === 'long' ? 'Perp Long' : 'Perp Short', sym: p.sym, amt: p.qty, val: notional(p, p.entry), quote: 'USDT', lev: p.lev, side: p.side } };
  }
  if (m.kind === 'margin') {
    const d = m.delta;
    if (!(Math.abs(d) > DUST)) return { ok: false, reason: 'invalid', need: 0, have: 0 };
    if (d > usdt + DUST) return { ok: false, reason: 'insufficient-usdt', need: d, have: usdt };
    if (-d > p.margin + DUST) return { ok: false, reason: 'too-much-margin-removed', need: -d, have: p.margin };
    const a = mut(acct);
    a.bal.USDT = usdt - d;
    const next = { ...p, margin: p.margin + d, cashIn: p.cashIn + d };
    return { ok: true, account: a, realizedUSD: 0, position: next, close: null,
      txn: { type: 'Margin', sym: p.sym, amt: 0, val: d, quote: 'USDT', note: d > 0 ? 'margin added' : 'margin removed' } };
  }
  return close(acct, m);
}

function close(acct: Account, m: Extract<PerpMove, { kind: 'close' }>): PerpResult {
  const p = m.position, f = Math.max(0, Math.min(1, m.fraction));
  if (!(f > 0 && m.exit > 0)) return { ok: false, reason: 'invalid', need: 0, have: 0 };
  const liq = m.reason === 'liquidation', q = p.qty * f;
  const part = { ...p, qty: q, margin: p.margin * f };
  const eq = equity(part, m.exit);
  const fee = liq ? 0 : q * m.exit * p.takerFee;
  const cashOut = liq ? 0 : Math.max(0, eq - fee);
  const pl = cashOut - p.cashIn * f;
  const a = mut(acct);
  a.bal.USDT = (acct.bal.USDT || 0) + cashOut;
  a.stats.feesUSD += fee; a.stats.realizedUSD += pl; a.stats.trades++;
  if (pl >= 0) a.stats.wins++; else a.stats.losses++;
  a.journal.unshift({
    sym: p.sym, qty: q, entry: p.entry, exit: m.exit, pl, plPct: p.cashIn > 0 ? (pl / (p.cashIn * f)) * 100 : 0,
    hold: m.now - p.t, t: m.now, perp: { side: p.side, lev: p.lev, reason: m.reason, funding: p.funding * f },
  });
  if (a.journal.length > JOURNAL_CAP) a.journal.pop();
  const rest = f < 1 - 1e-9 ? { ...p, qty: p.qty - q, margin: p.margin - part.margin, cashIn: p.cashIn * (1 - f), openFee: p.openFee * (1 - f), funding: p.funding * (1 - f) } : null;
  return {
    ok: true, account: a, realizedUSD: pl, position: rest,
    close: { qty: q, exit: m.exit, fee, cashOut, pl, insuranceFee: liq ? Math.max(0, eq) : 0, shortfall: liq ? Math.max(0, -eq) : 0 },
    txn: { type: liq ? 'Liquidated' : 'Perp close', sym: p.sym, amt: q, val: q * m.exit, quote: 'USDT', lev: p.lev, side: p.side, pl,
      ...(m.reason !== 'manual' ? { note: m.reason } : f < 1 - 1e-9 ? { note: Math.round(f * 100) + '% closed' } : {}) },
  };
}

/** The ledger row for a funding settlement (the money moved inside the position's margin). */
export function fundingTxn(p: PerpPosition, paid: number, count: number): PerpTxn {
  return { type: 'Funding', sym: p.sym, amt: 0, val: -paid, quote: 'USDT', side: p.side, lev: p.lev,
    note: (paid > 0 ? 'paid' : 'received') + (count > 1 ? ' · ' + count + ' settlements' : '') };
}

/** Mark-to-market value of open perps: each position's equity, never below zero (isolated). */
export function perpEquityUSD(positions: readonly PerpPosition[], markOf: (sym: string) => number): number {
  let v = 0;
  for (const p of positions) { const mk = markOf(p.sym); v += Math.max(0, mk > 0 ? equity(p, mk) : p.margin); }
  return v;
}


/** Ledger text for perp rows (the legacy renderer would divide by a zero amount on funding rows). */
export function perpTxnLabel(t: { type?: string; sym?: string; amt?: number; val?: number; lev?: number; pl?: number; note?: string }, fmt: (n: number) => string): string | null {
  const amt = t.amt || 0, val = t.val || 0, sgn = (n: number) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n));
  const tail = (t.pl != null ? ' · ' + sgn(t.pl) + ' USDT' : '') + (t.note ? ' · ' + t.note : '');
  switch (t.type) {
    case 'Perp Long': case 'Perp Short': return t.type + ' ' + fmt(amt) + ' ' + t.sym + (t.lev ? ' · ' + t.lev + '×' : '') + ' · ' + fmt(val) + ' USDT position';
    case 'Perp close': case 'Liquidated': return t.type + ' ' + fmt(amt) + ' ' + t.sym + ' @ ' + fmt(amt ? val / amt : 0) + (t.lev ? ' · ' + t.lev + '×' : '') + tail;
    case 'Funding': return 'Funding ' + t.sym + ' · ' + sgn(val) + ' USDT' + (t.note ? ' · ' + t.note : '');
    case 'Margin': return 'Margin ' + t.sym + ' · ' + sgn(val) + ' USDT' + (t.note ? ' · ' + t.note : '');
    default: return null;
  }
}

/** The trade journal's suffix for a perp close: " · 10× long perp · liquidated". */
export function journalNote(j: { perp?: { side: string; lev: number; reason: string } }): string {
  const p = j && j.perp;
  return p ? ' · ' + p.lev + '× ' + p.side + ' perp' + (p.reason !== 'manual' ? ' · ' + (p.reason === 'liquidation' ? 'liquidated' : p.reason) : '') : '';
}
