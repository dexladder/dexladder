/**
 * usePerps — the presenter behind the perpetual-futures desk. Like usePaperEngine it owns only
 * sequencing: pricing, validation, margin, funding and liquidation are pure functions in
 * lib/perps; reading prices, writing the account and drawing the result are injected effects, so
 * the same presenter drives the legacy page today and runs in a test with no DOM at all.
 *
 * One tick, per position, in this order: settle any funding that fell due (it moves the margin,
 * so it can move the liquidation price), then ask what the mark triggers — stop-loss,
 * liquidation, take-profit. Every change is one applyPerp transition, committed once per call.
 */
import type { Account } from '../lib/paper-engine/account';
import {
  applyPerp, fundingTxn, quoteOpen, settle, triggerAt, postMortem, MAX_POSITIONS,
  type CloseReason, type Closed, type FundingRate, type OpenCheck, type PerpMode, type PerpPosition,
  type PerpSide, type PerpSpec, type PerpTxn, type PostMortem,
} from '../lib/perps';

export interface PerpDeps {
  now(): number;
  id(): string;
  mode(): PerpMode;
  venue(): string;
  mark(sym: string): number;
  spec(sym: string): PerpSpec;
  rate(sym: string): FundingRate;
  /**
   * Average price for a market order of `qty` on the perp book: the mark in Beginner, the
   * order-book walk (slippage) in Advanced. `commit` = this is the fill, not a preview.
   */
  fill(sym: string, side: 'buy' | 'sell', qty: number, commit: boolean): number;
  account(): Account;
  positions(): readonly PerpPosition[];
  /** write both back (and persist) — called once per presenter call that changed anything */
  commit(account: Account, positions: readonly PerpPosition[]): void;
  ledger(t: PerpTxn): void;
  emit?(e: PerpEvent): void;
  /** price formatter for the post-mortem's sentences */
  fmt?(n: number): string;
}

export type PerpEvent =
  | { readonly kind: 'opened'; readonly position: PerpPosition; readonly liq: number; readonly distPct: number }
  | { readonly kind: 'refused'; readonly why: string }
  | { readonly kind: 'closed'; readonly position: PerpPosition; readonly close: Closed; readonly reason: Exclude<CloseReason, 'liquidation'>; readonly partial: boolean }
  | { readonly kind: 'liquidated'; readonly position: PerpPosition; readonly close: Closed; readonly postMortem: PostMortem }
  | { readonly kind: 'funding'; readonly position: PerpPosition; readonly paid: number; readonly count: number; readonly caughtUp: boolean }
  | { readonly kind: 'margin'; readonly position: PerpPosition; readonly delta: number };

export interface PerpTicket { readonly sym: string; readonly side: PerpSide; readonly margin: number; readonly lev: number; readonly sl?: number | null; readonly tp?: number | null }

export interface Perps {
  preview(t: PerpTicket): OpenCheck;
  open(t: PerpTicket): OpenCheck;
  close(id: string, fraction?: number): boolean;
  margin(id: string, delta: number): boolean;
  protect(id: string, sl: number | null, tp: number | null): string | null;
  tick(): number;
}

export function usePerps(d: PerpDeps): Perps {
  const emit = (e: PerpEvent): void => { try { d.emit?.(e); } catch { /* a view error never undoes a committed move */ } };
  const openSide = (s: PerpSide): 'buy' | 'sell' => (s === 'long' ? 'buy' : 'sell');
  const closeSide = (s: PerpSide): 'buy' | 'sell' => (s === 'long' ? 'sell' : 'buy');

  function check(t: PerpTicket, commit: boolean): OpenCheck {
    const mark = d.mark(t.sym), spec = d.spec(t.sym);
    const qty = mark > 0 ? (t.margin * t.lev) / mark : 0;
    const fill = qty > 0 ? d.fill(t.sym, openSide(t.side), qty, commit) : 0;
    return quoteOpen({ sym: t.sym, side: t.side, margin: t.margin, lev: t.lev, mark, fill, sl: t.sl ?? null, tp: t.tp ?? null },
      { spec, venue: d.venue(), mode: d.mode(), rate8h: d.rate(t.sym).rate8h, now: d.now(), id: d.id(), open: d.positions().length, maxPositions: MAX_POSITIONS });
  }

  /** Close (part of) a position at `exit`; returns the account and the remaining position list. */
  function doClose(acct: Account, list: PerpPosition[], p: PerpPosition, fraction: number, reason: CloseReason, mark: number): Account {
    const exit = reason === 'liquidation' ? mark : d.fill(p.sym, closeSide(p.side), p.qty * fraction, true) || mark;
    const r = applyPerp(acct, { kind: 'close', position: p, exit, fraction, reason, now: d.now() });
    if (!r.ok || !r.close) return acct;
    const i = list.findIndex(x => x.id === p.id);
    if (r.position) list.splice(i, 1, r.position); else list.splice(i, 1);
    d.ledger(r.txn);
    if (reason === 'liquidation') emit({ kind: 'liquidated', position: p, close: r.close, postMortem: postMortem(p, mark, d.fmt) });
    else emit({ kind: 'closed', position: p, close: r.close, reason, partial: !!r.position });
    return r.account;
  }

  return {
    preview: t => check(t, false),
    open(t) {
      const c = check(t, true);
      if (!c.ok) { emit({ kind: 'refused', why: c.why }); return c; }
      const r = applyPerp(d.account(), { kind: 'open', position: c.quote.position });
      if (!r.ok) {
        const why = `Not enough USDT: this needs ${c.quote.worstCase.toFixed(2)} (margin + ${(c.quote.position.takerFee * 100).toFixed(3)}% open fee), you have ${r.have.toFixed(2)}.`;
        emit({ kind: 'refused', why }); return { ok: false, why, quote: c.quote };
      }
      d.commit(r.account, [...d.positions(), c.quote.position]);
      d.ledger(r.txn);
      emit({ kind: 'opened', position: c.quote.position, liq: c.quote.liq, distPct: c.quote.distPct });
      return c;
    },
    close(id, fraction = 1) {
      const list = d.positions().slice(), p = list.find(x => x.id === id), mark = p ? d.mark(p.sym) : 0;
      if (!p || !(mark > 0)) return false;
      const before = d.account(), acct = doClose(before, list, p, fraction, 'manual', mark);
      if (acct === before) return false;
      d.commit(acct, list); return true;
    },
    margin(id, delta) {
      const list = d.positions().slice(), i = list.findIndex(x => x.id === id), p = list[i];
      if (!p) return false;
      const r = applyPerp(d.account(), { kind: 'margin', position: p, delta });
      if (!r.ok || !r.position) { emit({ kind: 'refused', why: r.ok ? 'Nothing to change.' : r.reason === 'insufficient-usdt' ? 'Not enough USDT in the wallet to add that margin.' : 'That would take out more margin than the position holds.' }); return false; }
      list[i] = r.position;
      d.commit(r.account, list); d.ledger(r.txn); emit({ kind: 'margin', position: r.position, delta });
      return true;
    },
    protect(id, sl, tp) {
      const list = d.positions().slice(), i = list.findIndex(x => x.id === id), p = list[i];
      if (!p) return 'That position is closed.';
      const probe = quoteOpen({ sym: p.sym, side: p.side, margin: p.margin, lev: p.lev, mark: p.entry, fill: p.entry, sl, tp },
        { spec: { ...d.spec(p.sym), maxLev: p.lev, minMargin: 0 }, venue: p.venue, mode: p.mode, rate8h: 0, now: p.t, id: p.id, open: 0, maxPositions: 1 });
      if (!probe.ok && /stop-loss|take-profit/.test(probe.why)) return probe.why;
      const { sl: _s, tp: _t, ...rest } = p;
      list[i] = { ...rest, ...(sl && sl > 0 ? { sl } : {}), ...(tp && tp > 0 ? { tp } : {}) };
      d.commit(d.account(), list);
      return null;
    },
    tick() {
      const list = d.positions().slice();
      if (!list.length) return 0;
      let acct = d.account(), changed = 0;
      for (const p0 of list.slice()) {
        const mark = d.mark(p0.sym);
        if (!(mark > 0)) continue;
        let p = p0;
        const s = settle(p, mark, d.rate(p.sym).rate8h, d.now());
        if (s.count) {
          p = s.position; list.splice(list.findIndex(x => x.id === p.id), 1, p); changed++;
          d.ledger(fundingTxn(p, s.paid, s.count));
          emit({ kind: 'funding', position: p, paid: s.paid, count: s.count, caughtUp: s.caughtUp });
        }
        const why = triggerAt(p, mark);
        if (why) { acct = doClose(acct, list, p, 1, why, mark); changed++; }
      }
      if (changed) d.commit(acct, list);
      return changed;
    },
  };
}
