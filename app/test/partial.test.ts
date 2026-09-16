/**
 * Partial fills and liquidity failure (Phase 2.4): fill what the pool holds, the remainder by TIF,
 * refuse near-zero liquidity outright, and put the partial quantity and average in the ledger.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBookEngine, applyFill, remainder, nearZeroLiquidity, NEAR_ZERO_POOL_USD, MIN_FILL_FRACTION, type Account, type Realism, type Ticket, type MarketStats } from '../src/lib/paper-engine';
import { usePaperEngine, type FillMeta, type PaperEvent } from '../src/hooks/usePaperEngine';

const SOL: MarketStats = { vol24: 2.1e9, mcap: 6.6e10, chg24: 4.1, price: 142.37 };
const DUST: MarketStats = { vol24: 1e3, mcap: 1e9, chg24: 9, price: 142.37 };   // thinnest tier, $25k floor × 0.0875
const fresh = (usdt = 1e7): Account => ({ bal: { USDT: usdt }, basis: {}, stats: { wins: 0, losses: 0, feesUSD: 0, realizedUSD: 0, trades: 0 }, journal: [] });

function world(realism: Realism, stats: MarketStats = SOL) {
  let acct = fresh();
  const engine = createBookEngine({ priceOf: (b, q) => (b === 'SOL' && q === 'USDT' ? 142.37 : 0), statsOf: () => stats, now: () => 7e6, random: () => 0.5, realism: () => realism });
  const events: PaperEvent[] = [], metas: FillMeta[] = [], placed: unknown[][] = [];
  const pe = usePaperEngine({
    engine, price: () => 142.37, held: s => acct.bal[s] || 0,
    fill: (side, sym, quote, qty, px, rate, _l, net, meta) => {
      const r = applyFill(acct, { side, sym, quote, amt: qty, px, feeRate: rate, quoteUSD: 1, now: 1, networkQuote: net, ...(meta ? { asked: meta.asked } : {}) });
      if (r.ok) { acct = r.account; if (meta) metas.push(meta); } return r.ok;
    },
    place: (...a) => { placed.push(a); return 'rest1'; }, emit: e => events.push(e),
  });
  return { pe, engine, events, metas, placed, acct: () => acct };
}
const T = (over: Partial<Ticket> = {}): Ticket => ({ type: 'market', side: 'buy', sym: 'SOL', quote: 'USDT', amt: 10, limit: 0, stop: 0, tif: 'GTC', postOnly: false, reduceOnly: false, tolerancePct: 3, ...over });
const ADV: Realism = { mode: 'advanced', venue: 'dexamm', tolerancePct: 3, rangePct: null };

test('near-zero liquidity, in words: a tiny pool, or a market order the pool can barely touch; a waiting limit is not a failure', () => {
  assert.equal(NEAR_ZERO_POOL_USD, 5000); assert.equal(MIN_FILL_FRACTION, 0.01);
  assert.match(nearZeroLiquidity(2187, 5, 5, true)!, /^Near-zero liquidity: this pool holds only about \$2,187/);
  assert.match(nearZeroLiquidity(1e6, 0.5, 100, true)!, /can supply only 0\.50% of your size/);
  assert.equal(nearZeroLiquidity(1e6, 0, 100, false), null);
  assert.equal(nearZeroLiquidity(1e6, 1, 100, true), null);
});

test('a near-zero-liquidity pool refuses the order outright: nothing fills, nothing is dented, the preview says so first', () => {
  const w = world(ADV, DUST);
  const pv = w.engine.preview('SOL', 'USDT', 'buy', 0.1, { tolerancePct: 3 })!;
  assert.ok(pv.amm && /Near-zero liquidity/.test(pv.amm.nearZero || ''));
  const p0 = pv.avg;
  const o = w.pe.submit(T({ amt: 0.1 }));
  assert.ok(o.status === 'rejected' && /^Near-zero liquidity/.test(o.reason));
  assert.equal(w.acct().bal.USDT, 1e7);
  assert.equal(w.engine.preview('SOL', 'USDT', 'buy', 0.1, { tolerancePct: 3 })!.avg, p0);
});

test('concentrated range runs out under a market order: fill what the pool has, cancel the rest (a swap is atomic)', () => {
  const w = world({ ...ADV, rangePct: 1 });
  const pv = w.engine.preview('SOL', 'USDT', 'buy', 1e6, { tolerancePct: 3 })!;
  assert.ok(pv.exhausted && pv.filled > 1e6 * 0.01 && pv.filled < 1e6);
  const o = w.pe.submit(T({ amt: 1e6 }));
  assert.ok(o.status === 'done' && o.exec);
  assert.equal(o.filled, pv.filled, 'preview = fill, partial quantity');
  assert.equal(o.exec!.avg, pv.avg, 'preview = fill, partial average');
  assert.deepEqual(o.remainder, { kind: 'cancel', by: 'pool' });
  assert.equal(w.placed.length, 0, 'nothing rests');
  assert.deepEqual(w.metas[0], { asked: 1e6, mevQuote: 0 }, 'the ledger learns the full size');
});

test('a limit on the pool fills up to its price; the remainder rests (GTC) or is cancelled (IOC)', () => {
  const g = world(ADV), lim = 142.37 * 1.004;
  const og = g.pe.submit(T({ type: 'limit', limit: lim, amt: 1e5 }));
  assert.ok(og.status === 'done' && og.filled > 0 && og.rest > 0 && og.remainder.kind === 'rest' && og.exec!.avg <= lim);
  assert.equal(g.placed.length, 1);
  assert.equal(g.placed[0]![4], og.rest, 'the working order is exactly the remainder');
  const i = world(ADV), oi = i.pe.submit(T({ type: 'limit', limit: lim, amt: 1e5, tif: 'IOC' }));
  assert.ok(oi.status === 'done' && oi.remainder.kind === 'cancel' && i.placed.length === 0);
});

test('remainder policy: pool market → cancel; the book keeps its Phase 1 behaviour exactly', () => {
  const t = T({ amt: 5 });
  assert.deepEqual(remainder(t, 2, 100, true), { kind: 'cancel', by: 'pool' });
  assert.deepEqual(remainder(t, 2, 100), { kind: 'rest', px: 99.9 });
  assert.deepEqual(remainder(T({ tif: 'IOC' }), 2, 100, true), { kind: 'cancel', by: 'pool' });
  assert.deepEqual(remainder(T({ type: 'limit', limit: 101 }), 2, 100, true), { kind: 'rest', px: 101 });
});

test('the ledger row carries the partial size, the gas and the sandwich; a gas-only charge is its own row', () => {
  const a = applyFill(fresh(), { side: 'buy', sym: 'SOL', quote: 'USDT', amt: 4, px: 100, feeRate: 0.003, quoteUSD: 1, now: 1, networkQuote: 2, asked: 10, mevQuote: 1.5 });
  assert.ok(a.ok && a.txn);
  assert.deepEqual(a.txn, { type: 'Buy', sym: 'SOL', quote: 'USDT', amt: 4, val: 400, of: 10, gas: 2, mev: 1.5 });
  const full = applyFill(fresh(), { side: 'buy', sym: 'SOL', quote: 'USDT', amt: 4, px: 100, feeRate: 0.001, quoteUSD: 1, now: 1, asked: 4 });
  assert.ok(full.ok && full.txn && !('of' in full.txn) && !('gas' in full.txn), 'a whole fill with no gas keeps the Phase 1 row exactly');
  const g = applyFill(fresh(), { side: 'buy', sym: 'USDT', quote: 'USDT', amt: 0, px: 0, feeRate: 0, quoteUSD: 1, now: 1, networkQuote: 3, note: 'reverted swap' });
  assert.ok(g.ok && g.txn);
  assert.deepEqual(g.txn, { type: 'Gas', sym: 'USDT', amt: 0, val: 3, quote: 'USDT', gas: 3, note: 'reverted swap' });
});

import * as P from '../src/legacy/paper';
test('ledger labels: gas rows and annotated fills; ordinary rows fall through to the legacy label', () => {
  const f = (n: number) => n.toFixed(2);
  assert.equal(P.txnLabel({ type: 'Gas', val: 2.5, quote: 'USDT', note: 'reverted swap' }, f), 'Gas · 2.50 USDT · reverted swap');
  assert.equal(P.txnLabel({ type: 'Buy', sym: 'SOL', amt: 4, val: 400, quote: 'USDT', of: 10, gas: 2, mev: 1.5 }, f), 'Buy 4.00 SOL @ 100.00 USDT · partial 40% of 10.00 · gas 2.00 · sandwiched +1.50');
  assert.equal(P.txnLabel({ type: 'Buy', sym: 'SOL', amt: 4, val: 400, quote: 'USDT' }, f), null);
  assert.equal(P.txnLabel({ type: 'Deposit', val: 100 }, f), null);
});

test('a partial close says so in the trade journal; a whole close keeps the Phase 1 entry exactly', () => {
  const held: Account = { ...fresh(0), bal: { SOL: 10 }, basis: { SOL: { qty: 10, costUSD: 1000, t0: 0 } as never } };
  const part = applyFill(held, { side: 'sell', sym: 'SOL', quote: 'USDT', amt: 4, px: 120, feeRate: 0.001, quoteUSD: 1, now: 5, asked: 10 });
  assert.ok(part.ok && part.account.journal[0] && part.account.journal[0].of === 10 && part.account.journal[0].qty === 4);
  const whole = applyFill(held, { side: 'sell', sym: 'SOL', quote: 'USDT', amt: 4, px: 120, feeRate: 0.001, quoteUSD: 1, now: 5, asked: 4 });
  assert.ok(whole.ok && whole.account.journal[0] && !('of' in whole.account.journal[0]));
});
