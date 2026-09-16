import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poolSpec, poolAt, tierFactor, checkTolerance, quoteImpact, DEX_MIN_TVL, VIRTUAL_POOL_PER_DEPTH } from '../src/lib/paper-engine/impact';
import { depthUSD } from '../src/lib/paper-engine/book';
import { thinLiquidityBps } from '../src/lib/paper-engine/venues';
import { swap, baseToPrice } from '../src/lib/paper-engine/amm';

const BTC = { vol24: 3.1e10, mcap: 1.26e12, chg24: 1.8, price: 64000 };
const THIN = { vol24: 8e5, mcap: 1e8, chg24: 3, price: 0.41 };

test('the thin-liquidity penalty is folded in as depth: same tiers, one source', () => {
  assert.equal(tierFactor(BTC), 1.4 / thinLiquidityBps(BTC.vol24, BTC.mcap));
  assert.equal(tierFactor({ vol24: 0, mcap: 0 }), 1.4 / 2);
  assert.ok(tierFactor(THIN) < 0.1, 'the thinnest tier keeps under a tenth of the depth');
});

test('an order-book venue gets a virtual pool exactly as deep as the synthetic book within ±0.1%', () => {
  const liquid = { vol24: 3.1e10, mcap: 3e11, chg24: 0, price: 64000 };   // tier factor 1
  const spec = poolSpec(liquid, 'binance');
  assert.equal(spec.tvlUSD, VIRTUAL_POOL_PER_DEPTH * depthUSD(liquid));
  const pool = poolAt(spec, 64000, 1)!;
  const q = baseToPrice(pool, 'buy', 64000 * 1.001);
  const quoteThere = swap(pool, 'buy', q).quote;
  assert.ok(Math.abs(quoteThere / depthUSD(liquid) - 1) < 0.001, `${quoteThere} vs ${depthUSD(liquid)}`);
});

test('the DEX pool is a real-sized pool: 2% of volume, never under $25k, thinner than the book', () => {
  assert.ok(poolSpec(BTC, 'dexamm').tvlUSD < poolSpec(BTC, 'binance').tvlUSD / 10);
  assert.equal(poolSpec({ vol24: 0, mcap: 0, chg24: 0, price: 1 }, 'dexamm').tvlUSD, DEX_MIN_TVL * tierFactor({ vol24: 0, mcap: 0 }));
  assert.equal(poolSpec(BTC, 'dexamm', 10).model, 'concentrated');
});

test('small size ≈ no impact; large size on a thin pool moves the price a lot', () => {
  const big = poolAt(poolSpec(BTC, 'dexamm'), 64000, 1)!;
  assert.ok(quoteImpact(big, 'buy', 0.01).impactPct < 0.01, '$640 of BTC on the DEX');
  const thin = poolAt(poolSpec(THIN, 'dexamm'), 0.41, 1)!;
  assert.ok(quoteImpact(thin, 'buy', 20_000).impactPct > 2, '$8k into a thin pool');
});

test('tolerance: inside passes; beyond fails with the educational sentence', () => {
  assert.deepEqual(checkTolerance(0.4, 0.5), { ok: true });
  assert.deepEqual(checkTolerance(0.5, 0.5), { ok: true });
  const r = checkTolerance(3.214, 1);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason.startsWith('Price impact 3.21% exceeds your 1.00% slippage tolerance.'), JSON.stringify(r));
});

test('a limit caps the fill where the marginal price reaches it', () => {
  const pool = poolAt(poolSpec(THIN, 'dexamm'), 0.41, 1)!;
  const q = quoteImpact(pool, 'buy', 1e7, 0.42);
  assert.ok(q.fillRatio < 1 && q.fillRatio > 0);
  assert.ok(Math.abs(q.swap.p1 - 0.42) < 1e-9);
  assert.ok(q.swap.avg < 0.42);
});

test('an order that would drain the pool says so instead of printing an absurd percentage', () => {
  const r = checkTolerance(1e14, 0.5);
  assert.ok(!r.ok && r.reason.startsWith('Price impact >1,000% exceeds your 0.500% slippage tolerance. Your order is bigger than this pool can supply'), JSON.stringify(r));
});
