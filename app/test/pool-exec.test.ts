import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poolPreview, poolExecute, poolPrice, poolLevels, simulate, explainImpact, type PoolCtx, type Realism } from '../src/lib/paper-engine/pool-exec';
import { FEES, walk } from '../src/lib/paper-engine/match';
import { HEAL_MS } from '../src/lib/paper-engine/book';
import { createBookEngine } from '../src/lib/paper-engine/engine';

const ADV = (venue = 'dexamm', tol = 1, rangePct: number | null = null): Realism => ({ mode: 'advanced', venue, tolerancePct: tol, rangePct });
const SOL = { vol24: 2.1e9, mcap: 6.6e10, chg24: 4.1, price: 142.37 };
const ctx = (over: Partial<PoolCtx> = {}): PoolCtx => ({ mid: 142.37, stats: SOL, quoteUSD: 1, realism: ADV(), dent: null, now: 1_000_000, ...over });

test('preview and execution agree exactly, for every size, side, limit and venue', () => {
  for (const venue of ['dexamm', 'binance', 'kraken']) for (const side of ['buy', 'sell'] as const)
    for (const qty of [0.01, 1, 50, 400, 4000]) for (const limit of [0, 142.37 * (side === 'buy' ? 1.003 : 0.997)]) {
      const c = ctx({ realism: ADV(venue, 50) });
      const p = poolPreview(c, side, qty, { limit }, FEES)!;
      const e = poolExecute(c, side, qty, { limit }, FEES).exec as any;
      assert.equal(e.filled, p.filled); assert.equal(e.avg, p.avg); assert.equal(e.remaining, p.remaining);
      assert.equal(e.slipBps, p.slipBps); assert.equal(JSON.stringify(e.amm), JSON.stringify(p.amm));
    }
});

test('beyond tolerance: clean rejection, the sentence explains it, and the pool is NOT dented', () => {
  const c = ctx({ realism: ADV('dexamm', 0.5) });
  const r = poolExecute(c, 'buy', 3000, {}, FEES);
  assert.equal(r.exec.ok, false);
  assert.ok('rejected' in r.exec && r.exec.rejected && /Price impact .* exceeds your 0\.500% slippage tolerance/.test(r.exec.reason), JSON.stringify(r.exec));
  assert.equal(r.dent, null);
  const p = poolPreview(c, 'buy', 3000, {}, FEES)!;
  assert.equal(p.amm!.withinTolerance, false, 'the preview says so before you press the button');
});

test('a drifted fill dents the pool to the price it actually reached, not back to mid', () => {
  // v162 regression. The dent used to divide driftPct back out, so a swap that
  // executed into a mempool-drifted price stored move = 0 and the very next
  // preview quoted the undrifted mid again - a silent mispricing of exactly the
  // pending-swap behaviour this option exists to teach.
  const c = ctx({ realism: ADV('dexamm', 50) });
  const r = poolExecute(c, 'buy', 5, { driftPct: 0.05 }, FEES);
  assert.ok(r.exec.ok, 'the drifted order should fill');
  assert.ok(r.dent, 'a filled order must dent the pool');
  const reached = r.exec.amm ? r.exec.amm.p1 : NaN;
  assert.ok(isFinite(reached) && reached > c.mid, 'a drifted buy reaches a price above mid');
  assert.ok(Math.abs(r.dent!.move - (reached / c.mid - 1)) < 1e-12,
    `dent must record p1/mid-1 (got ${r.dent!.move}, expected ${reached / c.mid - 1})`);
  assert.ok(r.dent!.move > 0.001, 'a 5% pending-swap drift cannot leave the pool undented');
});

test('a fill dents the pool, the dent heals linearly back to the oracle mid', () => {
  const c = ctx({ realism: ADV('dexamm', 50) });
  const r = poolExecute(c, 'buy', 500, {}, FEES);
  assert.ok(r.exec.ok && r.dent && r.dent.move > 0);
  const d = r.dent!;
  assert.equal(poolPrice(142.37, d, c.now), 142.37 * (1 + d.move));
  assert.ok(Math.abs(poolPrice(142.37, d, c.now + HEAL_MS / 2) - 142.37 * (1 + d.move / 2)) < 1e-9);
  assert.equal(poolPrice(142.37, d, c.now + HEAL_MS), 142.37);
  const again = poolPreview(ctx({ realism: ADV('dexamm', 50), dent: d }), 'buy', 500, {}, FEES)!;
  const fresh = poolPreview(c, 'buy', 500, {}, FEES)!;
  assert.ok(again.avg > fresh.avg, 'buying again straight after costs more — the pool has not recovered yet');
});

test('FOK, post-only, and a limit that only partly fits', () => {
  const c = ctx({ realism: ADV('dexamm', 50) });
  const fok = poolExecute(c, 'buy', 1e5, { tif: 'FOK', limit: 143 }, FEES);
  assert.ok(!fok.exec.ok && 'rejected' in fok.exec && /fill-or-kill/.test(fok.exec.reason)); assert.equal(fok.dent, null);
  const po = poolExecute(c, 'buy', 1, { postOnly: true, limit: 150 }, FEES);
  assert.ok(!po.exec.ok && /post-only/.test((po.exec as any).reason));
  const rest = poolExecute(c, 'buy', 1, { postOnly: true, limit: 140 }, FEES).exec as any;
  assert.equal(rest.filled, 0); assert.equal(rest.remaining, 1);
  const part = poolExecute(c, 'buy', 1e5, { limit: 143 }, FEES).exec as any;
  assert.ok(part.filled > 0 && part.remaining > 0 && Math.abs(part.amm.p1 - 143) < 1e-9);
});

test('small vs large, liquid vs thin — the lesson in numbers', () => {
  const small = simulate(ctx(), 'buy', 1, 0)!;
  assert.ok(small.facts.impactPct < 0.01, 'a $142 order barely moves a $42M pool: ' + small.facts.impactPct);
  const thin = ctx({ mid: 0.41, stats: { vol24: 8e5, mcap: 1e8, chg24: 0, price: 0.41 } });
  const big = simulate(thin, 'buy', 20_000, 0)!;
  assert.ok(big.facts.impactPct > 2);
  assert.match(explainImpact(big.facts, big.filled, 20_000), /moves the DEX pool: average .* Pool depth/);
});

test('the depth ladder is the pool: walking whole rungs is exact, a partly-taken last rung is within 3 bp', () => {
  const c = ctx({ realism: ADV('dexamm', 50) });
  const book = poolLevels(c);
  assert.equal(book.asks.length, 40);
  for (const qty of [10, 200, 2000]) {
    const w = walk(book, 'buy', qty)!, s = simulate(c, 'buy', qty, 0)!;
    assert.ok(Math.abs(w.avg / s.avg - 1) < 3e-4, `${qty}: ladder ${w.avg} vs curve ${s.avg}`);
  }
});

test('engine: Beginner (default) is the order book, unchanged; Advanced routes to the pool and keeps its dent', () => {
  let mode: Realism = { ...ADV(), mode: 'beginner' };
  const E = createBookEngine({ priceOf: (b, q) => (b === 'SOL' && q === 'USDT' ? 142.37 : q === 'USDT' && b === 'USDT' ? 1 : 0), statsOf: () => SOL, now: () => 5e6, random: () => 0.5, realism: () => mode });
  const pb = E.preview('SOL', 'USDT', 'buy', 50)!;
  assert.equal(pb.amm, undefined); assert.ok(pb.levels > 0);
  mode = ADV('dexamm', 50);
  const pa = E.preview('SOL', 'USDT', 'buy', 50)!;
  assert.ok(pa.amm && pa.amm.venue === 'dexamm' && pa.levels === 0);
  const ex = E.execute('SOL', 'USDT', 'buy', 50) as any;
  assert.equal(ex.avg, pa.avg);
  assert.ok(E.preview('SOL', 'USDT', 'buy', 50)!.avg > pa.avg, 'the engine remembered the dent');
  assert.equal(E.queueAhead('SOL', 'USDT', 'buy', 140), 0, 'no queue on an AMM');
  E.reset(); assert.equal(E.preview('SOL', 'USDT', 'buy', 50)!.avg, pa.avg);
});
