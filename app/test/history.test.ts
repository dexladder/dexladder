import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFabricated, resample, fromCloses, binanceCloses, krakenCloses, coinbaseCloses } from '../src/lib/market/history';

const walk = (n: number, p0 = 100): number[] => { const o: number[] = []; let p = p0; for (let i = 0; i < n; i++) { p *= 1 + Math.sin(i * 1.7) * 0.004; o.push(p); } return o; };

test('padding is recognised: a constant, a step (the owner screenshot), too few points; a real walk is not', () => {
  assert.equal(isFabricated(new Array(336).fill(78975)), true);
  assert.equal(isFabricated([...new Array(180).fill(78975), ...new Array(156).fill(77153)]), true, 'flat, cliff, flat');
  assert.equal(isFabricated([...new Array(250).fill(78975), ...walk(86, 78975)]), true, 'a live tail after a padded run');
  assert.equal(isFabricated(walk(10)), true, 'too short to be a history');
  assert.equal(isFabricated(walk(336)), false);
  const stretched: number[] = []; for (const v of walk(168)) stretched.push(v, v);   // CoinGecko 168h inflated to 336
  assert.equal(isFabricated(stretched), false, 'an hourly sparkline stretched 2x is still real');
});

test('resample keeps both ends and interpolates linearly', () => {
  assert.deepEqual(resample([1, 3], 3), [1, 2, 3]);
  assert.equal(resample(walk(720), 336).length, 336);
  assert.deepEqual(resample([5], 3), [5, 5, 5]);
});

test('fromCloses ends exactly at the live price, keeps the shape, refuses a different asset', () => {
  const closes = walk(336, 60000), live = closes[335]! * 1.0004;
  const s = fromCloses(closes, live, 336)!;
  assert.equal(s.length, 336); assert.equal(s[335], live);
  assert.ok(Math.abs(s[100]! / s[200]! - closes[100]! / closes[200]!) < 1e-12, 'returns unchanged');
  assert.equal(fromCloses(closes, live * 3, 336), null, 'a 3x basis is not the same asset');
  assert.equal(fromCloses(closes.slice(0, 10), live, 336), null);
});

test('parsers: Binance klines, Kraken OHLC, Coinbase candles (newest-first) all give closes oldest-first', () => {
  assert.deepEqual(binanceCloses([[1, '1', '2', '0.5', '1.5', '9'], [2, '1.5', '2', '1', '1.7', '9']]), [1.5, 1.7]);
  assert.deepEqual(krakenCloses({ error: [], result: { XXBTZUSD: [[1, '1', '2', '0.5', '10', '0', '0', 1], [2, '1', '2', '1', '11', '0', '0', 1]], last: 2 } }), [10, 11]);
  assert.deepEqual(coinbaseCloses([[2, 1, 2, 1, 21, 5], [1, 1, 2, 1, 20, 5]]), [20, 21]);
  assert.deepEqual(binanceCloses({ code: -1121 }), []);
});
