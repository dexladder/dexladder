import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  init, submit, cancel, advance, closeOut, priceFor, metrics, verdict, winRateBand, drawdownBars, sharpe,
  binanceCandles, krakenCandles, coinbaseCandles, sanitize, barsIn, barsPerYear, gaps, INTERVALS, isInterval,
  type BtOrder, type BtState, type Candle,
} from '../src/lib/backtest';

const H = 3_600_000;
const bar = (i: number, o: number, h: number, l: number, c: number): Candle => ({ t: i * H, o, h, l, c, v: 1 });
const near = (a: number, b: number, e = 1e-9) => assert.ok(Math.abs(a - b) <= e * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);
const ord = (o: Partial<BtOrder> & { side: BtOrder['side'] }): BtOrder => ({ id: 'o' + Math.random(), type: 'market', qty: 1, placedAt: 0, ...o });
const run = (s: BtState, bars: readonly Candle[], n: number, fee = 0) => { for (let k = 0; k < n; k++) s = advance(s, bars, fee).state; return s; };

test('candles · every source parses to the same shape, sorted, deduped, sanity-checked', () => {
  assert.deepEqual(binanceCandles([[3600000, '11', '11', '8', '9', '1'], [60000, '10', '12', '9', '11', '3'], [60000, '10', '12', '9', '11', '3'], [0, '1', '1', '1', '1', '1']]),
    [{ t: 60000, o: 10, h: 12, l: 9, c: 11, v: 3 }, { t: 3600000, o: 11, h: 11, l: 8, c: 9, v: 1 }], 'sorted, deduped, and a zero timestamp is not a bar');
  assert.deepEqual(krakenCandles({ result: { XXBTZUSD: [[60, '1', '2', '0.5', '1.5', '1.2', '7', 3]], last: 60 } }), [{ t: 60000, o: 1, h: 2, l: 0.5, c: 1.5, v: 7 }]);
  assert.deepEqual(coinbaseCandles([[120, 1, 3, 2, 2.5, 9], [60, 1, 2, 1.5, 1.8, 4]]).map(c => c.t), [60000, 120000]);
  assert.equal(sanitize([{ t: 1, o: 1, h: 0.5, l: 0.9, c: 1, v: 0 }]).length, 0, 'a high below the body is not a candle');
  assert.equal(sanitize([bar(0, 1, 1, 1, 1), bar(5, 1, 1, 1, 1)], 1 * H, 4 * H).length, 0);
  assert.equal(barsIn(0, 24 * H, '4h'), 6); assert.equal(Math.round(barsPerYear('1d')), 365);
  assert.equal(gaps([bar(0, 1, 1, 1, 1), bar(1, 1, 1, 1, 1), bar(9, 1, 1, 1, 1)], '1h'), 1);
  assert.ok(isInterval('1h') && !isInterval('3m') && INTERVALS['4h'] === 4 * H);
});

test('no lookahead · a market order placed on bar i fills at the OPEN of bar i+1', () => {
  const bars = [bar(0, 100, 110, 90, 105), bar(1, 106, 120, 100, 118)];
  let s = run(init(1000), bars, 1);
  s = submit(s, ord({ side: 'buy', qty: 5 }), bars[0]).state;
  assert.equal(s.fills.length, 0, 'nothing fills on the bar you can already see');
  s = advance(s, bars, 0.001).state;
  assert.equal(s.fills[0]!.px, 106); assert.equal(s.fills[0]!.why, 'market-open');
  near(s.cash, 1000 - 5 * 106 * 1.001); near(s.equity[1]!, s.cash + 5 * 118);
});

test('fill rules · limits and stops fill only when the bar trades through them; a gap pays honestly', () => {
  const b = bar(1, 100, 110, 90, 105);
  assert.deepEqual(priceFor(ord({ side: 'buy', type: 'limit', px: 95 }), b), { px: 95, why: 'limit' });
  assert.deepEqual(priceFor(ord({ side: 'buy', type: 'limit', px: 105 }), b), { px: 100, why: 'limit-gap' }, 'the bar opened below the limit: you get the better price');
  assert.equal(priceFor(ord({ side: 'buy', type: 'limit', px: 89 }), b), null);
  assert.deepEqual(priceFor(ord({ side: 'sell', type: 'stop', px: 95 }), b), { px: 95, why: 'stop' });
  assert.deepEqual(priceFor(ord({ side: 'sell', type: 'stop', px: 104 }), b), { px: 100, why: 'stop-gap' }, 'the bar opened below the stop: the gap costs you');
  assert.deepEqual(priceFor(ord({ side: 'buy', type: 'stop', px: 108 }), b), { px: 108, why: 'stop' });
  assert.deepEqual(priceFor(ord({ side: 'sell', type: 'limit', px: 108 }), b), { px: 108, why: 'limit' });
});

test('within one bar the pessimistic order is taken: market, then stops, then limits', () => {
  const bars = [bar(0, 100, 100, 100, 100), bar(1, 100, 120, 80, 110)];
  let s = run(init(10_000), bars, 1);
  s = submit(s, ord({ id: 'm', side: 'buy', qty: 10 }), bars[0]).state;
  s = submit(s, ord({ id: 'l', side: 'buy', type: 'limit', px: 85, qty: 10 }), bars[0]).state;
  s = submit(s, ord({ id: 's', side: 'buy', type: 'stop', px: 115, qty: 10 }), bars[0]).state;
  const r = advance(s, bars, 0);
  assert.deepEqual(r.state.fills.map(f => f.orderId), ['m', 's', 'l']);
  assert.deepEqual(r.state.fills.map(f => f.px), [100, 115, 85]);
  assert.equal(r.events.length, 3); assert.match(r.events[0]!.text, /^Bought 10\.0000 @ 100\.00000 at the open/);
});

test('cash and inventory are real: an unaffordable fill is cancelled, a sell is capped at what is held', () => {
  const bars = [bar(0, 100, 100, 100, 100), bar(1, 100, 100, 100, 100), bar(2, 100, 100, 100, 100)];
  let s = run(init(1000), bars, 1);
  assert.match(submit(s, ord({ side: 'buy', qty: 50 }), bars[0]).error!, /more cash than the run has left/);
  assert.match(submit(s, ord({ side: 'sell', qty: 1 }), bars[0]).error!, /cannot sell more than that/);
  s = submit(s, ord({ id: 'a', side: 'buy', type: 'limit', px: 100, qty: 9 }), bars[0]).state;
  s = submit(s, ord({ id: 'b', side: 'buy', type: 'limit', px: 100, qty: 9 }), bars[0]).state;   // both rest; the second cannot be paid for
  const r = advance(s, bars, 0.001);
  assert.equal(r.state.fills.length, 1); assert.equal(r.events[1]!.kind, 'rejected');
  assert.match(r.events[1]!.text, /Not enough cash/);
  assert.equal(cancel(r.state, 'zzz').orders.length, r.state.orders.length);
});

test('a round trip is journaled against average cost, with fees, and the equity curve marks every close', () => {
  const bars = [bar(0, 100, 100, 100, 100), bar(1, 100, 100, 100, 100), bar(2, 200, 200, 200, 200), bar(3, 200, 200, 200, 200)];
  let s = run(init(1000), bars, 1);
  s = submit(s, ord({ side: 'buy', qty: 5 }), bars[0]).state; s = advance(s, bars, 0.001).state;
  s = submit(s, ord({ side: 'sell', qty: 5 }), bars[1]).state; s = advance(s, bars, 0.001).state;
  const t = s.trades[0]!;
  assert.equal(s.trades.length, 1); near(t.entry, 100); near(t.exit, 200);
  near(t.pl, 5 * 100 - 5 * 200 * 0.001); near(t.plPct, (t.pl / 500) * 100);
  near(s.cash, 1000 - 500 - 0.5 + 1000 - 1); near(s.qty, 0);
  assert.deepEqual(s.equity.map(x => Math.round(x * 10) / 10), [1000, 999.5, 1498.5], "bar 1: bought at 100 with a 0.1% fee — equity dips by the fee");
  assert.equal(s.barsInMarket, 1);
});

test('drawdown, exposure and Sharpe come from the marked curve', () => {
  assert.equal(drawdownBars([100, 90, 80, 120, 110]), 2);
  assert.equal(sharpe([100], '1d'), 0);
  assert.ok(sharpe([100, 101, 102, 103], '1d') > 10, 'a straight line up is a very high Sharpe');
  const bars = [bar(0, 100, 100, 100, 100), bar(1, 100, 100, 100, 50), bar(2, 50, 50, 50, 120)];
  let s = run(init(1000), bars, 1);
  s = submit(s, ord({ side: 'buy', qty: 10 }), bars[0]).state;
  s = run(s, bars, 2, 0);
  near(s.maxDD, 0.5); assert.equal(s.barsInMarket, 2);
  const m = metrics(s, bars, '1h');
  near(m.maxDDPct, 50); near(m.buyHoldPct, 20); near(m.exposurePct, (2 / 3) * 100);
  assert.equal(m.trades, 0); near(m.openPl, 10 * 120 - 1000);
});

test('close-out measures a finished run flat', () => {
  const bars = [bar(0, 100, 100, 100, 100), bar(1, 100, 100, 100, 100), bar(2, 150, 150, 150, 150)];
  let s = run(init(1000), bars, 1);
  s = submit(s, ord({ side: 'buy', qty: 5 }), bars[0]).state;
  s = run(s, bars, 2, 0);
  const f = closeOut(s, bars, 0);
  assert.equal(f.done, true); assert.equal(f.qty, 0); assert.equal(f.trades.length, 1);
  near(f.cash, 1000 + 5 * 50); near(f.equity[f.equity.length - 1]!, 1250);
  assert.equal(closeOut(f, bars, 0).trades.length, 1, 'closing out twice changes nothing');
});

test('the verdict never flatters: buy-and-hold first, then sample size, drawdown, fees and the no-lookahead rule', () => {
  const bars = [bar(0, 100, 100, 100, 100), bar(1, 100, 100, 100, 100), bar(2, 90, 90, 90, 90), bar(3, 130, 130, 130, 130)];
  let s = run(init(1000), bars, 1);
  s = submit(s, ord({ side: 'buy', qty: 5 }), bars[0]).state; s = run(s, bars, 1, 0.001);
  s = submit(s, ord({ side: 'sell', qty: 5 }), bars[1]).state; s = run(s, bars, 2, 0.001);
  const v = verdict(metrics(s, bars, '1h'), '1h bars');
  assert.match(v.headline, /Behind buy-and-hold by/);
  assert.deepEqual(v.lines.map(l => l.label.replace(/[\d.,$−%]+/g, '#')), ['Buy-and-hold beat you', '# closed trade', 'Worst drawdown #', 'Fees # (#)', 'In the market # of the time', 'No lookahead']);
  assert.match(v.lines[1]!.text, /A sample this small says almost nothing/);
  assert.match(v.lines[5]!.text, /market orders at the next open/);
  const none = verdict(metrics(run(init(1000), bars, 3), bars, '1h'), '1h bars');
  assert.equal(none.headline, 'Nothing traded yet');
  assert.equal(Math.round(winRateBand(50, 100)), 10);
  assert.ok(winRateBand(100, 3) > 25, 'three wins out of three is not certainty — Wilson, not the textbook ±0%');
});
