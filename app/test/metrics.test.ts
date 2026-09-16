import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLANK, fill, mark, open, runStrategy, score, PRESETS, type Candle, type Strategy } from '../src/lib/bots';
import {
  DEFAULT_RISK_FREE_PCT, MIN_RETURNS_TO_JUDGE, MS_PER_YEAR, barReturns, barsPerYear, botMetrics,
  riskAdjusted, riskVerdict, underwater, walletUnderwater, type Curve,
} from '../src/lib/bots/metrics';
import { slipped } from '../src/lib/bots/backtest';

const H = 3_600_000;
const near = (a: number, b: number, e = 1e-9): void => assert.ok(Math.abs(a - b) <= e * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);
const bars = (n: number, f: (i: number) => number): Candle[] => Array.from({ length: n }, (_, i) => { const p = f(i); return { t: (i + 1) * H, o: p, h: p * 1.01, l: p * 0.99, c: p, v: 10 + (i % 3) }; });
/** a market that falls hard then recovers — the same tape bots-core.test.ts uses */
const dip = (i: number): number => (i < 30 ? 100 : i < 45 ? 100 - (i - 29) * 2.5 : 62.5 + (i - 44) * 2);
const curveOf = (eq: readonly number[]): Curve => eq.map((e, i) => [(i + 1) * H, e] as const);
/** mulberry32 — a seeded generator, so "random" here is a fixture, not a coin toss */
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** an always-in strategy: buys on any close above zero, never sells on a rule */
const ALWAYS: Strategy = { ...BLANK, entry: [{ left: { kind: 'ind', id: 'close' }, op: '>', right: { kind: 'const', value: 0 } }], exit: [], risk: { stakePct: 1, cooldownBars: 0 } };

test('sharpe · a hand-computed series, annualised by the real bar size', () => {
  // equity 100 → 110 → 104.5 → 114.95 → 109.2025, i.e. per-bar returns +10%, −5%, +10%, −5%.
  //   mean            = (0.1 − 0.05 + 0.1 − 0.05) / 4                     = 0.025
  //   deviations      = ±0.075, each squared = 0.005625, summed over 4     = 0.0225
  //   sample variance = 0.0225 / (4 − 1)                                   = 0.0075
  //   sd              = √0.0075                                            = 0.086602540378…
  //   per-bar Sharpe  = 0.025 / 0.086602540378…                            = 0.288675134594…
  //   1d bars a year  = 31,557,600,000 / 86,400,000                        = 365.25
  //   annualised      = 0.288675134594… × √365.25 (= 19.111514853…)        = 5.51701912267…
  const c = curveOf([100, 110, 104.5, 114.95, 109.2025]);
  assert.deepEqual(barReturns(c).map(x => +x.toFixed(12)), [0.1, -0.05, 0.1, -0.05]);
  assert.equal(barsPerYear('1d'), 365.25);
  assert.equal(barsPerYear('1h'), MS_PER_YEAR / H);
  const d = riskAdjusted(c, '1d');
  near(d.sharpe, 5.5170191226784775, 1e-12);
  // downside deviation uses only the two −5% bars: √((0.0025 + 0.0025) / 3) = 0.040824829046…
  //   per-bar Sortino = 0.025 / 0.040824829046… = 0.612372435695…, × √365.25 = 11.70336490074…
  near(d.sortino, 11.703364900745424, 1e-12);
  // annualised vol = 0.086602540378… × 19.111514853… × 100 = 165.5105736803…%
  near(d.annVolPct, 165.5105736803545, 1e-12);
  assert.equal(d.samples, 4);
  assert.ok(d.thin && 4 < MIN_RETURNS_TO_JUDGE, 'four bars is a sample, not a result — and it says so');

  // the SAME curve on 1h bars annualises by √8766 = 93.6269192059…, not by an invented constant
  near(riskAdjusted(c, '1h').sharpe, 27.027763503479154, 1e-12);

  // the risk-free rate is an argument, de-annualised geometrically: 1.05^(1/365.25) − 1 = 0.000133589…
  assert.equal(DEFAULT_RISK_FREE_PCT, 0);
  near(riskAdjusted(c, '1d', 5).sharpe, 5.487538575345928, 1e-12);
  assert.deepEqual(riskAdjusted(c, '1d', 0), riskAdjusted(c, '1d'), 'the default is zero, stated once');
});

test('sharpe · nothing to measure at n = 0 and n = 1 bars, and a flat line has no ratio', () => {
  for (const c of [curveOf([]), curveOf([1000])]) {
    const d = riskAdjusted(c, '1h');
    assert.deepEqual(d, { sharpe: 0, sortino: 0, annVolPct: 0, samples: 0, thin: true });
    // the underwater series is one point per point in, never a return — a single mark is at its
    // own peak, so it is 0% under water, which is a fact rather than an absence
    assert.equal(underwater(c).series.length, c.length);
    assert.equal(underwater(c).maxPct, 0);
  }
  assert.equal(barReturns(curveOf([1000])).length, 0);
  // two points is one return: a mean with no deviation around it, so still no answer
  assert.equal(riskAdjusted(curveOf([1000, 1100]), '1h').samples, 1);
  assert.equal(riskAdjusted(curveOf([1000, 1100]), '1h').sharpe, 0);
  // a perfectly flat curve: sd = 0, and 0/0 is refused rather than printed as ∞
  const flat = riskAdjusted(curveOf(Array.from({ length: 50 }, () => 1000)), '1h');
  assert.equal(flat.sharpe, 0); assert.equal(flat.sortino, 0); assert.equal(flat.annVolPct, 0);
  assert.ok(!flat.thin, '50 returns is enough to judge — it just has nothing to say');
  // a wallet worth nothing ends the return series instead of fabricating a −100% step
  assert.deepEqual(barReturns(curveOf([100, 0, 50])), [-1]);
});

test('underwater · the peak-to-trough max IS the wallet’s maxDDPct, across seeded random tapes', () => {
  for (const seed of [1, 7, 42, 1337, 90210]) {
    const r = rng(seed);
    let w = fill(open(10_000), 'buy', 1, 100, 0.001, 0, 'signal', 'seeded').wallet;
    let px = 100;
    for (let i = 1; i <= 300; i++) { px = Math.max(1, px * (1 + (r() - 0.5) * 0.08)); w = mark(w, px, i * H); }
    const uw = walletUnderwater(w);
    // same points, same formula, same seed peak — so this must be exact, not merely close
    assert.equal(uw.maxPct, score(w).maxDDPct, 'seed ' + seed);
    assert.equal(uw.series.length, w.equity.length);
    assert.ok(uw.maxPct > 0 && uw.maxAt > 0, 'a random walk goes under water at some point');
    assert.ok(uw.series.every(p => p[1] >= 0), 'drawdown is positive going down — the chart negates it');
    assert.ok(uw.longest >= 1 && uw.longestMs >= 0 && uw.currentPct >= 0);
  }
  // and on a real run, end to end
  const run = runStrategy(PRESETS[0]!.strategy, bars(90, dip), 10_000, 0.001);
  assert.equal(walletUnderwater(run.wallet).maxPct, run.score.maxDDPct);
  // the drawn curve is bar CLOSES only, so its trough can never be deeper than the wick-aware one
  assert.ok(underwater(run.curve, run.wallet.start).maxPct <= run.score.maxDDPct + 1e-12,
    'closes cannot find a trough the marks missed');
});

test('underwater · the shape, the length, and where the series starts from', () => {
  // 100 → 120 (peak) → 90 (25% under) → 108 (10% under) → 120 (level) → 132 (new peak)
  const uw = underwater(curveOf([100, 120, 90, 108, 120, 132]));
  assert.deepEqual(uw.series.map(p => +p[1].toFixed(10)), [0, 0, 25, 10, 0, 0]);
  assert.equal(uw.maxPct, 25);
  assert.equal(uw.maxAt, 3 * H, 'the trough is stamped with its own bar');
  assert.equal(uw.longest, 2, 'two points below the 120 peak before it was regained');
  assert.equal(uw.longestMs, H);
  assert.equal(uw.currentPct, 0, 'it ended at a new high');
  // seeded from a stake: a wallet that loses on its very first mark is already under water,
  // which is exactly why walletUnderwater seeds from w.start rather than from the first point
  assert.equal(underwater(curveOf([90]), 100).maxPct, 10);
  assert.equal(underwater(curveOf([90])).maxPct, 0, 'without a seed the first point IS the peak');
  const open2 = underwater(curveOf([100, 80]));
  assert.equal(open2.currentPct, 20); assert.equal(open2.longest, 1);
});

test('slippage · the fill moves against you on both sides, and the price is what moves', () => {
  // 50 bps = 0.5%: a buy at 100 pays 100.5, a sell at 100 receives 99.5 (`near`, not `equal`:
  // 100 × 1.005 is 100.49999999999999 in binary floating point, and pretending otherwise would
  // be testing IEEE-754 rather than the fill)
  near(slipped(100, 'buy', 50), 100.5, 1e-15);
  near(slipped(100, 'sell', 50), 99.5, 1e-15);
  near(slipped(100, 'buy', -50), 100.5, 1e-15);   // the sign of the bps cannot make slippage a gift
  // zero and nonsense return the price itself — the identical float, which is what keeps the
  // four-argument path bit-for-bit the shipped one
  assert.equal(slipped(100, 'buy', 0), 100);
  assert.equal(slipped(100, 'sell', Number.NaN), 100);
  assert.equal(slipped(0.07, 'buy', 0), 0.07);

  const b = bars(60, dip);
  const plain = runStrategy(ALWAYS, b, 10_000, 0);
  const slip = runStrategy(ALWAYS, b, 10_000, 0, { slipBps: 50 });
  const e0 = plain.wallet.fills[0]!, e1 = slip.wallet.fills[0]!;
  assert.equal(e0.side, 'buy');
  near(e1.px, e0.px * 1.005, 1e-15);
  const x0 = plain.wallet.fills[plain.wallet.fills.length - 1]!, x1 = slip.wallet.fills[slip.wallet.fills.length - 1]!;
  assert.equal(x0.side, 'sell');
  near(x1.px, x0.px * 0.995, 1e-15);
  assert.ok(slip.score.returnPct < plain.score.returnPct, 'worse fills on both legs cannot pay better');

  // the basis moved, so the stop distance moved with it: a 1% stop measured from an entry that is
  // 0.5% worse fires on a shallower fall — this is why slippage is not deducted as a cost
  const stopper: Strategy = { ...ALWAYS, risk: { stakePct: 1, stopLossPct: 1, cooldownBars: 100 } };
  const fallBars = bars(20, i => 100 - i * 0.2);
  const a = runStrategy(stopper, fallBars, 1000, 0);
  const c = runStrategy(stopper, fallBars, 1000, 0, { slipBps: 50 });
  const sa = a.wallet.fills.find(f => f.why === 'stop-loss')!, sc = c.wallet.fills.find(f => f.why === 'stop-loss')!;
  assert.ok(sa && sc && sc.t < sa.t, 'the slipped entry hits its stop on an earlier bar');
});

test('slippage · 0 bps reproduces the shipped numbers exactly, however it is spelled', () => {
  const tapes: readonly Candle[][] = [bars(90, dip), bars(60, i => 100 + i), bars(40, i => 100 - i), bars(120, i => 100 + Math.sin(i / 5) * 10)];
  const strategies: readonly Strategy[] = [PRESETS[0]!.strategy, PRESETS[1]!.strategy, PRESETS[2]!.strategy, ALWAYS,
    { ...ALWAYS, risk: { stakePct: 0.5, stopLossPct: 2, takeProfitPct: 4, trailingPct: 3, cooldownBars: 2 } }];
  for (const s of strategies) for (const t of tapes) for (const fee of [0, 0.001, 0.0026]) {
    const base = runStrategy(s, t, 10_000, fee);
    // the four-argument call, the empty options object, an explicit zero and an explicit undefined
    assert.deepStrictEqual(runStrategy(s, t, 10_000, fee, {}), base, s.name);
    assert.deepStrictEqual(runStrategy(s, t, 10_000, fee, { slipBps: 0 }), base, s.name);
    assert.deepStrictEqual(runStrategy(s, t, 10_000, fee, undefined), base, s.name);
  }
});

test('slippage · composes with the fee in the right order — price first, fee on what that leaves', () => {
  const b = bars(6, () => 100);
  const stake = 10_000, fee = 0.001, bps = 25, k = bps / 10_000;
  const r = runStrategy(ALWAYS, b, stake, fee, { slipBps: bps });
  const entry = r.wallet.fills[0]!;
  // the buy spends all the cash: gross = spend / (1 + fee), the venue fee is taken on that quote
  // notional, and the QUANTITY is what the slipped price decides — slippage changes what you get,
  // the fee changes what you pay for it, and they do not commute into the same number
  const gross = stake / (1 + fee);
  near(entry.px, 100 * (1 + k), 1e-15);
  near(entry.fee, gross * fee, 1e-9);
  near(entry.qty, gross / (100 * (1 + k)), 1e-12);
  // the close-out sells into a slipped price and the fee is charged on the WORSE proceeds
  const exit = r.wallet.fills[r.wallet.fills.length - 1]!;
  assert.equal(exit.why, 'close-out');
  near(exit.px, 100 * (1 - k), 1e-15);
  near(exit.fee, exit.qty * 100 * (1 - k) * fee, 1e-9);
  // fee-free with slippage, and slippage-free with the same fee, are both cheaper than both
  const both = r.score.equity;
  assert.ok(both < runStrategy(ALWAYS, b, stake, fee).score.equity);
  assert.ok(both < runStrategy(ALWAYS, b, stake, 0, { slipBps: bps }).score.equity);
});

test('botMetrics · the institutional block, and a sentence under every figure', () => {
  const run = runStrategy(PRESETS[0]!.strategy, bars(400, dip), 10_000, 0.001);
  const m = botMetrics(run, '1h');
  assert.equal(m.elapsedMs, 400 * H, 'elapsed is bars × bar size, so a venue gap is not counted as compounding');
  assert.deepEqual(m.underwater, walletUnderwater(run.wallet));
  assert.equal(m.underwater.maxPct, run.score.maxDDPct);
  // CAGR compounds the run's own return over the run's own length
  const years = m.elapsedMs / MS_PER_YEAR;
  near(m.cagrPct, (Math.pow(run.score.equity / 10_000, 1 / years) - 1) * 100, 1e-9);
  near(m.calmar, m.cagrPct / run.score.maxDDPct, 1e-9);
  assert.equal(m.samples, 399);
  assert.ok(!m.thin);

  // the house conventions at the edges: no drawdown at all reads ∞ the way profit factor does
  const win = botMetrics({ wallet: { ...run.wallet, start: 100 }, score: { ...run.score, equity: 200, maxDDPct: 0 }, curve: run.curve }, '1h');
  assert.equal(win.calmar, Infinity);
  const dead = botMetrics({ wallet: { ...run.wallet, start: 100 }, score: { ...run.score, equity: 0, maxDDPct: 50 }, curve: run.curve }, '1h');
  assert.equal(dead.cagrPct, -100, 'a wallet taken to zero has no growth rate, it has a total loss');

  const lines = riskVerdict(m);
  assert.equal(lines.length, 4);
  assert.match(lines[0]!.text, /^Sharpe -?\d+\.\d\d · Sortino/);
  assert.match(lines[1]!.text, /compounds to [+−]\d+\.\d\d% a year/);
  assert.match(lines[2]!.text, /^Calmar/);
  assert.match(lines[3]!.text, /Longest stretch under water/);
  assert.ok(lines.every(l => /[.!?]$/.test(l.text)), 'every figure is followed by a finished sentence');
  // a thin sample says so in words, not just in a flag
  const thin = riskVerdict(botMetrics(runStrategy(PRESETS[0]!.strategy, bars(12, dip), 10_000, 0), '1h'));
  assert.equal(thin[0]!.status, 'warn');
  assert.match(thin[0]!.text, /It is a sample, not a result\./);
});
