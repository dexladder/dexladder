import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poolFromTVL, swap, reserves, price, maxBase, baseToPrice, impactPct, priceMovePct, atPrice } from '../src/lib/paper-engine/amm';

const rel = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} vs ${b}`);

// A textbook constant-product pool: 100 base, 10,000 quote → price 100, k = 1,000,000.
const P = poolFromTVL(100, 20_000)!;

test('full range IS constant product: reserves 100 / 10,000, price 100, x·y = L²', () => {
  const r = reserves(P);
  rel(r.base, 100); rel(r.quote, 10_000); rel(price(P), 100); rel(r.base * r.quote, P.L * P.L);
});

test('buy and sell match the x·y = k formula by hand', () => {
  const b = swap(P, 'buy', 10);
  rel(b.quote, 1_000_000 / 90 - 10_000);           // pay y' − y where y' = k / (x − 10)
  rel(b.avg, (1_000_000 / 90 - 10_000) / 10);
  rel(b.p1, (1_000_000 / 90) / 90);                // new price = y'/x'
  const s = swap(P, 'sell', 10);
  rel(s.quote, 10_000 - 1_000_000 / 110);          // receive y − k / (x + 10)
  rel(s.p1, (1_000_000 / 110) / 110);
});

test('k is preserved by a swap and a round trip is path-independent (no fee in the curve)', () => {
  const b = swap(P, 'buy', 7.3);
  const after = atPrice(P, b.p1);
  const r = reserves(after);
  rel(r.base * r.quote, 1_000_000, 1e-9);
  const back = swap(after, 'sell', 7.3);
  rel(back.quote, b.quote, 1e-9); rel(back.p1, 100, 1e-9);
});

test('impact grows with size; a small order has near-zero impact', () => {
  let prev = -1;
  for (const q of [1e-6, 0.01, 0.1, 1, 5, 20, 60]) { const i = impactPct(swap(P, 'buy', q)); assert.ok(i > prev, `${q} → ${i}`); prev = i; }
  assert.ok(impactPct(swap(P, 'buy', 1e-6)) < 1e-5, 'a millionth of the pool moves the price by ~nothing');
  rel(impactPct(swap(P, 'buy', 10)), (111.1111111111111 / 100 - 1) * 100, 1e-9);
  assert.ok(priceMovePct(swap(P, 'buy', 10)) > impactPct(swap(P, 'buy', 10)), 'the marginal price moves further than the average');
});

test('a full-range pool can never be bought empty; a sell always fills', () => {
  const b = swap(P, 'buy', 1000);
  assert.ok(b.filled < 100 && b.exhausted && b.unfilled > 900, 'at most the reserves, never all of them');
  assert.equal(maxBase(P, 'sell'), Infinity);
  const s = swap(P, 'sell', 1e6); assert.equal(s.filled, 1e6); assert.ok(!s.exhausted);
});

test('concentrated range: deeper near the price, and it runs out at the edge', () => {
  const C = poolFromTVL(100, 20_000, 10)!;
  const r = reserves(C); rel(r.base * 100 + r.quote, 20_000, 1e-9);   // same capital
  assert.ok(C.L > P.L * 5, 'the same $20k over ±10% is several times the liquidity');
  assert.ok(impactPct(swap(C, 'buy', 1)) < impactPct(swap(P, 'buy', 1)) / 5, 'small trades see the amplified depth');
  const edge = maxBase(C, 'buy');
  const big = swap(C, 'buy', edge * 3);
  assert.ok(big.exhausted && Math.abs(big.filled - edge) < edge * 1e-9, 'fills only what the range holds');
  rel(big.p1, 110, 1e-6);                                               // and stops at the top of the range
  const low = swap(C, 'sell', maxBase(C, 'sell') * 2);
  assert.ok(low.exhausted); rel(low.p1, 90, 1e-6);
});

test('baseToPrice(limit) is exactly the size that walks the marginal price to the limit', () => {
  for (const [side, lim] of [['buy', 104], ['sell', 97.5]] as const) {
    const q = baseToPrice(P, side, lim);
    rel(swap(P, side, q).p1, lim, 1e-9);
  }
  assert.equal(baseToPrice(P, 'buy', 99), 0); assert.equal(baseToPrice(P, 'sell', 101), 0);
});

test('bad input gives an empty result, never NaN', () => {
  assert.equal(poolFromTVL(0, 100), null); assert.equal(poolFromTVL(100, 0), null);
  const z = swap(P, 'buy', 0); assert.equal(z.filled, 0); assert.equal(z.avg, 0); assert.equal(impactPct(z), 0);
  assert.equal(swap(P, 'buy', NaN).filled, 0);
});
