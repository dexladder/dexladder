import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cut, load, legacyCore, series } from './legacy';
import { chart, core } from '../src/legacy/indicators';
import { rsi } from '../src/lib/indicators';

const L = load(['emaArr', 'smaArr', 'rsiArr', 'macdArr'].map(n => cut('function ' + n + '(')).join('\n'));
const cases: [number[], number][] = [];
for (let s = 1; s <= 60; s++) for (const p of [1, 2, 3, 9, 12, 14, 20, 26, 50]) cases.push([series(s, (s * 37) % 400), p]);
cases.push([[], 14], [[5], 14], [[5, 5], 14], [[5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], 14]);

const same = (a: unknown, b: unknown) => assert.deepStrictEqual(JSON.stringify(a, (_, v) => (Object.is(v, -0) ? '-0' : v)), JSON.stringify(b, (_, v) => (Object.is(v, -0) ? '-0' : v)));

test('emaArr: bit-identical to the shipped legacy function on 544 cases', () => { for (const [v, p] of cases) same(chart.emaArr(v, p), L.emaArr(v, p)); });
test('smaArr: bit-identical', () => { for (const [v, p] of cases) same(chart.smaArr(v, p), L.smaArr(v, p)); });
test('rsiArr: bit-identical', () => { for (const [v, p] of cases) same(chart.rsiArr(v, p), L.rsiArr(v, p)); });
test('macdArr: bit-identical', () => { for (const [v] of cases) same(chart.macdArr(v), L.macdArr(v)); });

test('DLCORE sma(a, 0) is null now (was 0/0 = NaN — a number that is not one); every other case bit-identical', () => {
  assert.equal(core.sma([1, 2, 3], 0), null); assert.ok(Number.isNaN(legacyCore.sma([1, 2, 3], 0)!));
});

test('DLCORE sma / stdev / logRets / brier: bit-identical to the 42c3c7c layer', () => {
  for (const [v, p] of cases) {
    same(core.sma(v, p), legacyCore.sma(v, p));
    same(core.stdev(v), legacyCore.stdev(v));
    same(core.logRets(v), legacyCore.logRets(v));
  }
  for (const p of [0, 0.3, 0.5, 1]) { same(core.brier(p, true), legacyCore.brier(p, true)); same(core.brier(p, false), legacyCore.brier(p, false)); }
});

test('DLCORE rsi DELIBERATELY changed: Cutler (last-14 plain average) → Wilder, the chart\'s own definition', () => {
  // The defect being fixed: the Rung/Sentinel/copilot RSI disagreed with the chart's RSI for the same prices.
  let disagreements = 0;
  for (const [v] of cases) {
    if (v.length < 15) { assert.equal(core.rsi(v, 14), null); assert.equal(legacyCore.rsi(v, 14), null); continue; }
    const wilderChart = rsi(v, 14)[v.length - 1]!;
    const noLoss = Math.abs(wilderChart - 100 / 1.01) < 1e-9 && legacyCore.rsi(v, 14) === 100;
    if (noLoss) assert.equal(core.rsi(v, 14), 100);           // boundary: no losses → 100 (as before), not the chart's 99.01
    else assert.ok(Math.abs(core.rsi(v, 14)! - wilderChart) < 1e-9, 'screens read what the chart draws');
    if (Math.abs(legacyCore.rsi(v, 14)! - wilderChart) > 1) disagreements++;
  }
  assert.ok(disagreements > 50, 'the old screen RSI disagreed with the chart by >1 point on ' + disagreements + ' cases');
});
