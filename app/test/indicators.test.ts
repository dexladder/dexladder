import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rsi, rsiLast, ema, sma, bollinger, atr, stochasticK, roc, isOversold, isOverbought, crossAbove, crossBelow, trend, momentumScore, RSI_OVERSOLD, RSI_OVERBOUGHT } from '../src/lib/indicators';

const near = (a: number, b: number, eps: number, msg?: string) => assert.ok(Math.abs(a - b) <= eps, (msg || '') + ` ${a} vs ${b}`);

// Reference Wilder RSI written the textbook way (separate gain/loss arrays, SMA seed, recursive
// smoothing) — a second, independently shaped implementation the library must agree with.
function wilderRef(c: number[], n: number): (number | null)[] {
  const g: number[] = [], l: number[] = [];
  for (let i = 1; i < c.length; i++) { const d = c[i]! - c[i - 1]!; g.push(Math.max(d, 0)); l.push(Math.max(-d, 0)); }
  const out: (number | null)[] = c.map(() => null);
  if (g.length < n) return out;
  let ag = g.slice(0, n).reduce((a, b) => a + b, 0) / n, al = l.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const val = () => (al === 0 ? 100 - 100 / 101 : 100 - 100 / (1 + ag / al));
  out[n] = val();
  for (let i = n; i < g.length; i++) { ag = (ag * (n - 1) + g[i]!) / n; al = (al * (n - 1) + l[i]!) / n; out[i + 1] = val(); }
  return out;
}
const CLOSES = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64, 46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57, 43.42, 42.66, 43.13];

test('RSI matches a textbook Wilder reference on every computed point', () => {
  const r = rsi(CLOSES, 14), ref = wilderRef(CLOSES, 14);
  for (let i = 14; i < CLOSES.length; i++) near(r[i]!, ref[i]!, 1e-9, 'index ' + i);
  // first value by hand: 9 gains summing 3.34 and 4 losses summing 1.40 over the first 14 changes
  near(r[14]!, 100 - 100 / (1 + 3.34 / 1.40), 1e-9, 'hand-computed first RSI');
  near(rsiLast(CLOSES, 14)!, ref[CLOSES.length - 1]!, 1e-9);
});

test('RSI edges: flat series reads 100 (no losses), too-short reads null/neutral', () => {
  assert.equal(rsiLast([1, 2], 14), null);
  assert.deepEqual(rsi([7], 14), [50]);
  const flat = new Array(20).fill(3), rising = Array.from({ length: 20 }, (_, i) => 10 + i);
  assert.equal(rsiLast(flat, 14), 100, 'no losses → the textbook 100 on a screen');
  assert.equal(rsiLast(rising, 14), 100);
  assert.equal(rsi(rising, 14)[19], 100 - 100 / 101, 'the chart keeps its legacy RS cap (99.01)');
});

test('EMA/SMA: lengths preserved, SMA of a constant is the constant, EMA converges', () => {
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(ema(v, 3).length, 10); assert.equal(sma(v, 3).length, 10);
  assert.deepEqual(sma([4, 4, 4, 4], 2), [4, 4, 4, 4]);
  assert.equal(sma(v, 3)[9], 9);
  assert.deepEqual(ema([], 3), []); assert.deepEqual(sma([], 3), []);
});

test('Bollinger: constant series has zero-width bands; warm-up is null', () => {
  const b = bollinger(new Array(25).fill(10), 20, 2);
  assert.equal(b.mid[18], null); assert.equal(b.mid[19], 10); assert.equal(b.upper[24], 10); assert.equal(b.lower[24], 10);
});

test('ATR: first value is the mean true range of the first window, then Wilder-smoothed', () => {
  const bars = [{ h: 10, l: 8, c: 9 }, { h: 11, l: 9, c: 10 }, { h: 12, l: 10, c: 11 }, { h: 14, l: 11, c: 13 }];
  const a = atr(bars, 3);
  assert.equal(a[1], null); near(a[2]!, 2, 1e-12); near(a[3]!, (2 * 2 + 3) / 3, 1e-12);
});

test('Stochastic %K and ROC', () => {
  assert.equal(stochasticK([1, 2, 3], 3)[2], 100);
  assert.equal(stochasticK([3, 2, 1], 3)[2], 0);
  assert.equal(roc([100, 110], 1)[1]!.toFixed(6), (10).toFixed(6));
  assert.equal(roc([0, 110], 1)[1], null);
});

test('Screens share one threshold set', () => {
  assert.equal(RSI_OVERSOLD, 35); assert.equal(RSI_OVERBOUGHT, 70);
  const down = Array.from({ length: 30 }, (_, i) => 100 - i);
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  assert.ok(isOversold(down)); assert.ok(!isOverbought(down));
  assert.ok(isOverbought(up)); assert.ok(!isOversold(up));
  assert.ok(!isOversold([1, 2, 3]));
});

test('Crosses, trend and momentum', () => {
  assert.ok(crossAbove(1, 2, 3, 2)); assert.ok(!crossAbove(3, 2, 4, 2));
  assert.ok(crossBelow(3, 2, 1, 2));
  const up = Array.from({ length: 60 }, (_, i) => 100 * Math.pow(1.01, i));
  assert.equal(trend(up), 'up'); assert.equal(trend(up.slice().reverse()), 'down'); assert.equal(trend([1, 2]), null);
  assert.ok(momentumScore(up)! > 50); assert.ok(momentumScore(up.slice().reverse())! < -50);
});
