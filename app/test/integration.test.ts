/**
 * Phase 2.6 integration rules: the gap policy for resting orders, convergence to the old instant
 * fill as liquidity → ∞, dents that always heal, and Beginner exactly as it was.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gapRule, explainGap, createBookEngine, HEAL_MS, type Realism } from '../src/lib/paper-engine';
import * as P from '../src/legacy/paper';
import { bind } from '../src/legacy/globals';

test('gap policy table: limits and take-profits keep their price; stops become market orders in Advanced', () => {
  for (const adv of [false, true]) {
    assert.equal(gapRule('limit', adv), 'order-price');
    assert.equal(gapRule('tp', adv), 'order-price');
    assert.equal(gapRule('stop', adv), 'market');
    assert.equal(gapRule('stopl', adv), 'order-price', 'a stop-limit becomes a limit — it never chases a gap');
  }
  assert.equal(gapRule('sl', false), 'order-price', 'Beginner: the forgiving Phase 1 fill, kept exactly');
  assert.equal(gapRule('tsl', false), 'order-price');
  assert.equal(gapRule('sl', true), 'market');
  assert.equal(gapRule('tsl', true), 'market');
});

test('the gap explanation: only when the fill is materially worse than the stop', () => {
  const f = (n: number) => n.toFixed(2);
  assert.match(explainGap(140, 130, 'sell', f)!, /^Your stop was at 140\.00 but the market was already at 130\.00 when it fired \(7\.14% worse\)/);
  assert.equal(explainGap(140, 139.99, 'sell', f), null, 'a hair is not a gap');
  assert.equal(explainGap(140, 141, 'sell', f), null, 'better than the stop is not a gap');
  assert.match(explainGap(100, 104, 'buy', f)!, /4\.00% worse/);
});

test('Advanced stop-loss through a gap: it fills at the market where it is (with impact), not at the stop price', () => {
  let cur = 130;
  const S: any = { bal: { USDT: 0, SOL: 5 }, basis: {}, stats: { wins: 0, losses: 0, feesUSD: 0, realizedUSD: 0, trades: 0 }, dlsim: { mode: 'pro', venue: 'binance' }, txns: [] };
  bind({ state: () => S, coin: () => ({ sym: 'SOL', price: cur, vol: 1e9, mcap: 1e10, c24: 2 }) });
  Object.assign(globalThis as any, { pUSD: (s: string) => (s === 'USDT' ? 1 : cur), pairPrice: (b: string) => (b === 'ETH' ? 2500 : b === 'SOL' ? cur : 0), ensureEng() {}, logTxn() {}, toast() {}, saveP() {}, fmt: (n: number) => n.toFixed(2) });
  const sl = { id: 'x', type: 'sl', side: 'sell' as const, sym: 'SOL', quote: 'USDT', qty: 5, px: 140 };
  const G = P.stopMarket(sl, 'sell', 5)!;
  assert.ok(G && G.filled === 5 && G.avg < 130 && G.avg > 129.9, 'the market (130) less a little impact');
  assert.match(G.why || '', /stop was at 140\.00 but the market was already at 1(29\.9\d|30\.00) when it fired/);
  assert.equal(P.stopMarket({ ...sl, type: 'tp', px: 120 }, 'sell', 5), null, 'a take-profit keeps its price');
  assert.deepEqual(Object.keys(P.stopOpts(sl, 'sell')).sort(), ['afford', 'tif', 'tolerancePct']);
  assert.equal(P.stopOpts(sl, 'sell').tolerancePct, Infinity, 'no tolerance cap on a stop');
  S.dlsim.mode = 'beginner';
  assert.equal(P.stopMarket(sl, 'sell', 5), null, 'Beginner: at the stop price, as in Phase 1');
  assert.deepEqual(P.stopOpts(sl, 'sell'), { tif: 'IOC' }, 'Beginner: the Phase 1 stop options exactly');
});

test('as liquidity → ∞ the Advanced fill converges to the old instant fill at mid', () => {
  const deep = { vol24: 1e15, mcap: 1e16, chg24: 1, price: 100 };
  const R: Realism = { mode: 'advanced', venue: 'dexamm', tolerancePct: 0.5, rangePct: null };
  const e = createBookEngine({ priceOf: () => 100, statsOf: () => deep, now: () => 1, random: () => 0.5, realism: () => R });
  const x = e.execute('SOL', 'USDT', 'buy', 10, {});
  assert.ok('remaining' in x && Math.abs(x.avg / 100 - 1) < 1e-9 && x.filled === 10 && x.remaining === 0);
});

test('a fill dents the pool, and the dent always heals: never permanent', () => {
  let now = 1_000;
  const R: Realism = { mode: 'advanced', venue: 'dexamm', tolerancePct: 5, rangePct: null };
  const e = createBookEngine({ priceOf: () => 142.37, statsOf: () => ({ vol24: 2.1e9, mcap: 6.6e10, chg24: 4, price: 142.37 }), now: () => now, random: () => 0.5, realism: () => R });
  const clean = e.preview('SOL', 'USDT', 'buy', 1)!.avg;
  e.execute('SOL', 'USDT', 'buy', 300, { tolerancePct: 5 });
  assert.ok(e.preview('SOL', 'USDT', 'buy', 1)!.avg > clean, 'right after: dearer');
  now += HEAL_MS / 2;
  const half = e.preview('SOL', 'USDT', 'buy', 1)!.avg;
  assert.ok(half > clean && half < e.preview('SOL', 'USDT', 'buy', 1)!.avg + 1e-9);
  now += HEAL_MS;
  assert.equal(e.preview('SOL', 'USDT', 'buy', 1)!.avg, clean, 'healed exactly');
});
