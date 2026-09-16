/**
 * Legacy adapter for the perpetual-futures desk. The DLSIM names stay (openPerp, closePerp,
 * tickPerps, renderPerps, mountPerp, fundRate — and window.DLSIM.long/short/close/lev); their
 * bodies are now these functions, which read the paper account, call usePerps, and write back
 * IN PLACE (S.bal / S.stats / S.journal / S.dlsim.perps keep their identities, as the rest of
 * the payload holds references to them).
 */
import { usePerps, type PerpEvent, type Perps } from '../hooks/usePerps';
import { specFor, migrate, isPerpV2, rateOf, perpEquityUSD, journalNote, PERP_BOOK_DEPTH, type FundingRate, type PerpMode, type PerpPosition, type PerpSpec, type PerpTxn } from '../lib/perps';
import { createBookEngine, BEGINNER, type BookEngine } from '../lib/paper-engine';
import { legacy, type LegacyState } from './globals';
import { accountOf, commit as commitAccount } from './paper';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sim = { mode?: string; venue?: string; lev?: number; perps?: any[]; perpPm?: unknown; _xpP?: number; [k: string]: any };

export function sim(S: LegacyState | undefined): Sim | null {
  if (!S) return null;
  if (!S.dlsim) S.dlsim = { mode: 'beginner', venue: 'binance', latency: 1, partial: 1, funding: 1, lev: 5, perps: [] };
  if (!Array.isArray(S.dlsim.perps)) S.dlsim.perps = [];
  return S.dlsim as Sim;
}
export const modeOf = (S: LegacyState | undefined): PerpMode => (S && S.dlsim && S.dlsim.mode === 'pro' ? 'advanced' : 'beginner');
export const venueOf = (S: LegacyState | undefined): string => (S && S.dlsim && typeof S.dlsim.venue === 'string' && S.dlsim.venue) || 'binance';
export const markOf = (sym: string): number => { const m = legacy.pairPrice(sym, 'USDT'); return m > 0 ? m : 0; };

export function specOf(sym: string): PerpSpec {
  const S = legacy.S(), c = legacy.coin(sym);
  return specFor(sym, (c && c.mcap) || 0, modeOf(S), venueOf(S));
}

export function rateFor(sym: string): FundingRate {
  const live = legacy.funding8h(sym), c = legacy.coin(sym);
  return rateOf(live ? live.rate : null, (c && c.c24) || 0, live ? live.venue : undefined);
}

/** Open positions, migrated from the old desk's shape on first read (never dropped). */
export function positions(S: LegacyState | undefined = legacy.S()): PerpPosition[] {
  const d = sim(S);
  if (!d) return [];
  const raw = d.perps || [];
  if (raw.length && raw.every(isPerpV2)) return raw as PerpPosition[];
  const now = Date.now(), out = raw.map((p: any) => migrate(p, specOf, modeOf(S), venueOf(S), now)).filter(Boolean) as PerpPosition[];
  (d.perps as any[]).splice(0, raw.length, ...out);
  legacy.call('saveP');
  return out;
}

/** The perp order book: the synthetic order book (a perp venue is an order book, not a pool). */
let book: BookEngine | null = null;
export function perpBook(): BookEngine {
  return book || (book = createBookEngine({
    priceOf: (s, q) => legacy.pairPrice(s, q) || 0,
    statsOf: s => { const c = legacy.coin(s); return { vol24: ((c && c.vol) || 0) * PERP_BOOK_DEPTH, mcap: (c && c.mcap) || 0, chg24: (c && c.c24) || 0, price: (c && c.price) || 0 }; },
    now: () => Date.now(), random: () => Math.random(), realism: () => BEGINNER,
  }));
}

function fill(sym: string, side: 'buy' | 'sell', qty: number, commit: boolean): number {
  const mark = markOf(sym);
  if (modeOf(legacy.S()) !== 'advanced' || !(qty > 0)) return mark;
  const r: any = commit ? perpBook().execute(sym, 'USDT', side, qty, { tif: 'IOC' }) : perpBook().preview(sym, 'USDT', side, qty);
  if (!r || !(r.filled > 0) || !(r.avg > 0)) return mark;
  // what the book could not hold fills at the mark (a perp venue's depth is far beyond our book's 40 levels)
  return (r.avg * r.filled + mark * Math.max(0, qty - r.filled)) / qty;
}

function ledger(t: PerpTxn): void {
  const S = legacy.S();
  legacy.call('logTxn', t.type, t.sym, t.amt, t.val, 'USDT');
  const row = S && S.txns && S.txns[0];
  if (row) { for (const k of ['lev', 'side', 'pl', 'note'] as const) if (t[k] != null) row[k] = t[k]; }
  legacy.call('renderTxns');
}

let viewHook: ((e: PerpEvent) => void) | null = null;
/** The view registers here for domain events (toasts, the post-mortem, re-render). */
export function onEvent(fn: (e: PerpEvent) => void): void { viewHook = fn; }

let presenter: Perps | null = null;
export function perps(): Perps {
  return presenter || (presenter = usePerps({
    now: () => Date.now(),
    id: () => Math.random().toString(36).slice(2, 8),
    mode: () => modeOf(legacy.S()), venue: () => venueOf(legacy.S()),
    mark: markOf, spec: specOf, rate: rateFor, fill,
    account: () => { const S = legacy.S(); return S ? accountOf(S) : { bal: {}, basis: {}, stats: { wins: 0, losses: 0, feesUSD: 0, realizedUSD: 0, trades: 0 }, journal: [] }; },
    positions: () => positions(),
    commit: (a, list) => {
      const S = legacy.S(), d = sim(S);
      if (!S || !d) return;
      commitAccount(S, a);
      (d.perps as any[]).splice(0, d.perps!.length, ...list);
      legacy.call('saveP');
    },
    ledger,
    emit: e => { if (viewHook) viewHook(e); },
    fmt: n => String(legacy.call('fmt', n)),
  }));
}

/** Net worth counts open perps at their equity (margin + unrealised P&L, never below zero). */
export function equityUSD(): number {
  try { return perpEquityUSD(positions(), markOf); } catch { return 0; }
}

export { journalNote };
