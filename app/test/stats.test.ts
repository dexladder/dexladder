import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mean, stdev, returns, logReturns, maxDrawdown, sharpe, sortino, correlation, percentile, clamp, brier, sum } from '../src/lib/math';

const near = (a: number, b: number, eps = 1e-12) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('mean / sum / stdev (sample)', () => {
  assert.equal(mean([]), 0); assert.equal(sum([1, 2, 3]), 6);
  near(stdev([2, 4, 4, 4, 5, 5, 7, 9]), Math.sqrt(32 / 7));
  assert.equal(stdev([5]), 0);
});

test('returns skip non-positive prices; log returns sum to the log of the whole move', () => {
  assert.deepEqual(returns([100, 0, 110, 121]).map(x => +x.toFixed(10)), [0.1]);
  const px = [100, 105, 99, 120];
  near(logReturns(px).reduce((a, b) => a + b, 0), Math.log(120 / 100));
});

test('max drawdown finds the deepest peak-to-trough', () => {
  const d = maxDrawdown([100, 120, 90, 130, 65, 70]);
  near(d.maxDD, 0.5); assert.equal(d.peakIndex, 3); assert.equal(d.troughIndex, 4);
  assert.deepEqual(maxDrawdown([1, 2, 3]), { maxDD: 0, peakIndex: -1, troughIndex: -1 });
});

test('sharpe / sortino are null on zero volatility and signed correctly', () => {
  assert.equal(sharpe([0.01, 0.01, 0.01], 365), null);
  assert.ok(sharpe([0.01, 0.02, -0.005, 0.015], 365)! > 0);
  assert.ok(sortino([0.01, -0.02, 0.03], 365)! > 0);
  assert.equal(sortino([0.01, 0.02], 365), null);
});

test('correlation ±1 on linear series, null on constant', () => {
  near(correlation([1, 2, 3, 4], [2, 4, 6, 8])!, 1);
  near(correlation([1, 2, 3, 4], [8, 6, 4, 2])!, -1);
  assert.equal(correlation([1, 1, 1], [1, 2, 3]), null);
});

test('percentile, clamp, brier', () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3); assert.equal(percentile([10, 20], 0.25), 12.5);
  assert.ok(Number.isNaN(percentile([], 0.5)));
  assert.equal(clamp(5, 0, 1), 1); assert.equal(brier(0.7, true), Math.pow(0.7 - 1, 2));
});
