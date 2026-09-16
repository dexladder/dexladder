import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ladder, assetClass, specFor, maxLevFor, tierFor, CLASS_MAX_LEV, BEGINNER_MAX_LEV, PERP_BOOK_DEPTH,
  uPnl, equity, maintenance, marginRatio, liqPrice, bankruptcyPrice, breached, distancePct, removableMargin,
  settlementsBetween, nextSettlement, payment, settle, estimateRate8h, rateOf, intervalRate, clampRate, RATE_CAP_8H,
  quoteOpen, type OpenCtx, type PerpPosition,
} from '../src/lib/perps';

const H = 3_600_000;
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);
const BTC = specFor('BTC', 1.2e12, 'advanced', 'binance');
const pos = (o: Partial<PerpPosition> = {}): PerpPosition => {
  const lev = o.lev ?? 10, margin = o.margin ?? 100, entry = o.entry ?? 60000, qty = o.qty ?? (margin * lev) / entry;
  const t = tierFor(BTC.tiers, qty * entry);
  return { v: 2, id: 'p1', sym: 'BTC', side: 'long', lev, qty, entry, margin, cashIn: margin + qty * entry * 5e-4, openFee: qty * entry * 5e-4, funding: 0,
    lastFundingAt: 0, venue: 'binance', mode: 'advanced', takerFee: 5e-4, fundingHours: 8, mmr: t.mmr, cum: t.cum, t: 0, ...o };
};

test('spec · maintenance ladders are continuous at every step and leverage ≈ 1 ÷ (2·mmr), capped by class', () => {
  for (const cls of ['major', 'large', 'alt'] as const) {
    const s = specFor('X', cls === 'major' ? 2e11 : cls === 'large' ? 5e10 : 1e9, 'advanced', 'binance');
    assert.equal(s.cls, cls); assert.equal(s.maxLev, CLASS_MAX_LEV[cls]);
    for (let i = 1; i < s.tiers.length; i++) {
      const a = s.tiers[i - 1]!, b = s.tiers[i]!, n = a.upTo;
      near(n * a.mmr - a.cum, n * b.mmr - b.cum);            // same requirement from either side of the edge
      assert.ok(b.maxLev <= a.maxLev, 'bigger positions never get more leverage');
    }
  }
  assert.deepEqual(ladder([[1e4, 0.01], [Infinity, 0.05]], 100).map(t => [t.maxLev, t.cum]), [[50, 0], [10, 400]]);
  assert.equal(CLASS_MAX_LEV.major, 25, 'the product stops at 25×, wherever the venues go');
  assert.equal(PERP_BOOK_DEPTH, 3);
  assert.equal(assetClass(0), 'alt', 'unknown size is treated as the riskiest class');
});

test('spec · Beginner stops at 10×; Advanced pays the venue perp fee and its funding cadence', () => {
  const b = specFor('BTC', 1e12, 'beginner', 'hyperliquid');
  assert.equal(b.maxLev, BEGINNER_MAX_LEV); assert.equal(b.takerFee, 5e-4); assert.equal(b.fundingHours, 8);
  const a = specFor('BTC', 1e12, 'advanced', 'hyperliquid');
  assert.equal(a.maxLev, 25); assert.equal(a.takerFee, 45e-5); assert.equal(a.fundingHours, 1);
  assert.equal(specFor('SHIB', 5e9, 'beginner', 'binance').maxLev, 10);
});

test('spec · size limits leverage: 100 USDT may use the ceiling, 200k USDT may not', () => {
  assert.equal(maxLevFor(BTC, 100), 25);
  assert.equal(maxLevFor(BTC, 200_000), 20, '200k × 25 = 5M sits in the 2.5% step (max 20×)');
});

test('margin · liquidation price is exactly where equity meets maintenance (long and short, every step)', () => {
  for (const side of ['long', 'short'] as const) for (const [margin, lev] of [[100, 10], [2000, 25], [50_000, 20], [10, 2]] as const) {
    const p = pos({ side, margin, lev }), L = liqPrice(p);
    near(equity(p, L), maintenance(p, L), 1e-9);
    near(marginRatio(p, L), 1, 1e-9);
    near(equity(p, bankruptcyPrice(p)), 0, 1e-9);
    assert.ok(breached(p, L) && !breached(p, side === 'long' ? L * 1.0001 : L * 0.9999));
  }
});

test('margin · worked example: 10× long BTC at 60,000 with 100 USDT liquidates at 54,216.87 (9.64% away)', () => {
  const p = pos();
  near(liqPrice(p), 900 / 0.996 / p.qty, 1e-12);
  assert.equal(liqPrice(p).toFixed(2), '54216.87');
  assert.equal(distancePct(p, 60000).toFixed(2), '9.64');
  near(uPnl(p, 66000), 100); near(uPnl(pos({ side: 'short' }), 66000), -100);
  assert.equal(removableMargin(p, 60000), 0, 'at initial margin nothing can be withdrawn');
  near(removableMargin({ ...p, margin: 150 }, 60000), 50);
});

test('funding · settlements sit on the UTC clock; only positions open at one pay it', () => {
  assert.equal(nextSettlement(0, 8), 8 * H); assert.equal(nextSettlement(8 * H, 8), 16 * H, 'strictly after');
  assert.deepEqual(settlementsBetween(7 * H, 17 * H, 8), [8 * H, 16 * H]);
  assert.deepEqual(settlementsBetween(1 * H, 7.9 * H, 8), []);
  assert.equal(settlementsBetween(0, 5 * H, 1).length, 5);
  assert.equal(intervalRate(8e-4, 1), 1e-4);
});

test('funding · longs pay a positive rate out of the margin, which moves the liquidation price', () => {
  const p = pos({ lastFundingAt: 7 * H }), r = 1e-4;
  near(payment(p, 60000, r, 8), 0.1); near(payment({ ...p, side: 'short' }, 60000, r, 8), -0.1);
  const s = settle(p, 60000, r, 8 * H + 1);
  assert.equal(s.count, 1); near(s.paid, 0.1); near(s.position.margin, 99.9); near(s.position.funding, 0.1);
  assert.equal(s.position.lastFundingAt, 8 * H);
  assert.ok(liqPrice(s.position) > liqPrice(p), 'paying funding brings a long\'s liquidation closer');
  assert.equal(settle(s.position, 60000, r, 15 * H).count, 0, 'settles once per settlement');
  const w = settle(p, 60000, r, 7 * H + 24 * H);
  assert.equal(w.count, 3); assert.equal(w.caughtUp, true);
});

test('funding · the estimate is the legacy momentum formula; live rates are clamped, labelled', () => {
  near(estimateRate8h(0), 1e-4); near(estimateRate8h(10), 6e-4); near(estimateRate8h(-50), -4e-4);
  assert.deepEqual(rateOf(null, 0), { rate8h: 1e-4, source: 'estimate' });
  assert.deepEqual(rateOf(3e-4, 0, 'Binance'), { rate8h: 3e-4, source: 'live', venue: 'Binance' });
  assert.equal(clampRate(0.5), RATE_CAP_8H);
});

const ctx = (o: Partial<OpenCtx> = {}): OpenCtx => ({ spec: BTC, venue: 'binance', mode: 'advanced', rate8h: 1e-4, now: 1000, id: 'x', open: 0, maxPositions: 6, ...o });

test('open · the quote prices the position the way the desk will hold it', () => {
  const r = quoteOpen({ sym: 'BTC', side: 'long', margin: 100, lev: 10, mark: 60000, fill: 60000 }, ctx());
  assert.ok(r.ok);
  const q = r.quote;
  near(q.notional, 1000); near(q.openFee, 0.5); near(q.worstCase, 100.5); near(q.fundingPerSettlement, 0.1);
  assert.equal(q.liq.toFixed(2), '54216.87'); assert.equal(q.position.cashIn, 100.5);
});

test('open · every refusal explains itself', () => {
  const t = { sym: 'BTC', side: 'long' as const, margin: 100, lev: 10, mark: 60000, fill: 60000 };
  const why = (tt: Partial<typeof t> & { sl?: number; tp?: number }, c: Partial<OpenCtx> = {}) => { const r = quoteOpen({ ...t, ...tt }, ctx(c)); return r.ok ? '' : r.why; };
  assert.match(why({ mark: 0, fill: 0 }), /No price/);
  assert.match(why({ margin: 5 }), /at least 10 USDT/);
  assert.match(why({ lev: 25 }, { spec: specFor('BTC', 1e12, 'beginner', 'binance'), mode: 'beginner' }), /Beginner mode stops at 10×/);
  assert.match(why({ lev: 50 }), /This market allows at most 25× leverage/);
  assert.match(why({ margin: 200_000, lev: 25 }), /the most you can use is 20×/);
  assert.match(why({}, { open: 6 }), /close one first/);
  assert.match(why({ sl: 61000 }), /stop-loss sits below/);
  assert.match(why({ sl: 54000 }), /past the liquidation price \(54,217\).*could never fire/);
  assert.match(why({ tp: 59000 }), /take-profit sits above/);
  assert.equal(why({ sl: 57000, tp: 66000 }), '');
});
