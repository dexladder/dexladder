import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useBacktest, SPEEDS, type Loaded, type RunEvent } from '../src/hooks/useBacktest';
import type { Candle } from '../src/lib/backtest';

const H = 3_600_000;
const bars = (n: number, f: (i: number) => number): Candle[] => Array.from({ length: n }, (_, i) => { const p = f(i); return { t: (i + 1) * H, o: p, h: p * 1.01, l: p * 0.99, c: p, v: 1 }; });

function rig(n = 10, shape: (i: number) => number = i => 100 + i) {
  const ev: RunEvent[] = [], timers: (() => void)[] = [];
  let k = 0;
  const bt = useBacktest({ schedule: fn => { timers.push(fn); return () => timers.splice(timers.indexOf(fn), 1); }, id: () => 'o' + ++k, emit: e => ev.push(e), beat: 100 });
  const run: Loaded = { sym: 'BTC', interval: '1h', context: bars(3, () => 99), bars: bars(n, shape), source: 'test', feeRate: 0.001, label: '1h bars' };
  bt.load(run, 10_000);
  const fire = () => { const t = timers.shift(); if (t) t(); };
  return { bt, ev, fire, run, timers };
}

test('hook · an order cannot be placed before the first bar is seen, and never fills on the bar you saw', () => {
  const { bt, ev } = rig();
  assert.match(bt.order({ type: 'market', side: 'buy', qty: 1 })!, /Step one bar first/);
  bt.step();
  assert.equal(bt.order({ type: 'market', side: 'buy', qty: 1 }), null);
  assert.equal(bt.state().fills.length, 0);
  bt.step();
  assert.equal(bt.state().fills.length, 1);
  assert.equal(bt.state().fills[0]!.px, bt.run()!.bars[1]!.o);
  assert.ok(ev.some(e => e.kind === 'order'));
});

test('hook · play advances one bar per beat, pause stops it, speed changes the beat', () => {
  const { bt, fire, timers } = rig(6);
  bt.play(); assert.equal(bt.playing(), true);
  assert.equal(bt.state().i, 0, 'play steps at once, then on every beat');
  fire(); fire();
  assert.equal(bt.state().i, 2);
  bt.pause(); assert.equal(bt.playing(), false); assert.equal(timers.length, 0);
  bt.setSpeed(16); assert.equal(bt.speed(), 16);
  bt.setSpeed(7); assert.equal(bt.speed(), 1, 'only the published speeds');
  assert.deepEqual([...SPEEDS], [1, 4, 16, 64]);
});

test('hook · the visible series is the context plus the bars reached — never a bar from the future', () => {
  const { bt } = rig(8);
  assert.equal(bt.visible().length, 3);
  bt.step(3);
  assert.equal(bt.visible().length, 6);
  assert.equal(bt.visible().at(-1)!.t, bt.run()!.bars[2]!.t);
});

test('hook · reaching the last bar closes the run out flat and emits the end', () => {
  const { bt, ev } = rig(5);
  bt.step(); bt.order({ type: 'market', side: 'buy', qty: 10 });
  bt.step(99);
  const s = bt.state();
  assert.equal(s.done, true); assert.equal(s.qty, 0); assert.equal(s.trades.length, 1);
  assert.equal(ev.filter(e => e.kind === 'end').length, 1);
  assert.equal(bt.order({ type: 'market', side: 'buy', qty: 1 }), 'The run has finished — restart to trade it again.');
  assert.ok(bt.metrics().returnPct > 0 && bt.verdict().lines.length >= 5);
});

test('hook · restart puts the run back to the start with the same bars', () => {
  const { bt } = rig(5);
  bt.step(2); bt.order({ type: 'market', side: 'buy', qty: 5 }); bt.step();
  bt.restart();
  const s = bt.state();
  assert.deepEqual([s.i, s.qty, s.fills.length, s.trades.length, s.cash], [-1, 0, 0, 0, 10_000]);
  assert.equal(bt.visible().length, 3);
});

test('hook · a rejected order is reported and changes nothing', () => {
  const { bt, ev } = rig();
  bt.step();
  assert.match(bt.order({ type: 'limit', side: 'buy', qty: 1 })!, /needs a price/);
  assert.match(bt.order({ type: 'market', side: 'sell', qty: 1 })!, /cannot sell more/);
  assert.equal(bt.state().orders.length, 0);
  assert.equal(ev.filter(e => e.kind === 'rejected').length, 2);
});
