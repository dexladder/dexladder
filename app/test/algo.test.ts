/** TWAP planning and the OCO rule — pure, so both are pinned here before any UI touches them. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTwap, sliceQty, dueCount, nextSlice, waitMs, applySlice, progress, isComplete, describe as describeTwap, TWAP } from '../src/lib/paper-engine/algo';
import { ocoEffect, trigger, type RestingOrder } from '../src/lib/paper-engine/orders';

const T0 = 1_000_000;
const plan = (qty = 12, slices = 4, minutes = 30, now = T0) => {
  const p = planTwap({ id: 'p1', side: 'buy', sym: 'SOL', quote: 'USDT', qty, slices, minutes, now });
  assert.ok(p.ok); return p.order;
};

test('a TWAP plan is even, bounded, and spreads the slices across the whole window', () => {
  const o = plan(12, 4, 30);
  assert.equal(o.type, 'twap'); assert.equal(o.sent, 0); assert.equal(o.filled, 0);
  assert.equal(o.everyMs, 600_000, '30 min ÷ 3 gaps = one slice every 10 minutes');
  assert.deepEqual([0, 1, 2, 3].map(i => sliceQty(o, i)), [3, 3, 3, 3]);
  const odd = plan(10, 3, 30);
  const parts = [0, 1, 2].map(i => sliceQty(odd, i));
  assert.ok(Math.abs(parts.reduce((a, b) => a + b, 0) - 10) < 1e-12, 'the slices are exactly the order');
  assert.ok(parts[2]! >= parts[0]! - 1e-12, 'the rounding remainder rides on the last slice');
  assert.deepEqual([0, 1, 2, 3, 4].map(i => sliceQty(plan(1, 5, 5), i)).map(x => +x.toFixed(9)), [0.2, 0.2, 0.2, 0.2, 0.2]);
});

test('a plan refuses sizes, slice counts and windows it cannot work', () => {
  const bad = (o: object) => planTwap({ id: 'x', side: 'buy', sym: 'SOL', quote: 'USDT', qty: 10, slices: 4, minutes: 30, now: T0, ...o } as never);
  assert.equal(bad({ qty: 0 }).ok, false);
  assert.equal(bad({ slices: 1 }).ok, false);
  assert.equal(bad({ slices: TWAP.maxSlices + 1 }).ok, false);
  assert.equal(bad({ minutes: 0 }).ok, false);
  assert.equal(bad({ minutes: TWAP.maxMinutes + 1 }).ok, false);
  assert.equal(bad({ slices: TWAP.maxSlices, minutes: TWAP.maxMinutes }).ok, true);
});

test('slices come due on the clock, one at a time, and the parent finishes exactly once', () => {
  let o = plan(12, 4, 30);
  assert.equal(dueCount(o, T0), 1, 'the first slice goes at once');
  assert.deepEqual(nextSlice(o, T0), { index: 0, qty: 3 });
  assert.equal(waitMs(o, T0), 0);
  o = applySlice(o, 3, 100);
  assert.equal(nextSlice(o, T0), null, 'nothing more is due in the same instant');
  assert.equal(waitMs(o, T0), 600_000);
  assert.equal(nextSlice(o, T0 + 599_999), null);
  assert.deepEqual(nextSlice(o, T0 + 600_000), { index: 1, qty: 3 });
  assert.equal(dueCount(o, T0 + 10 * 600_000), 4, 'a long gap never sends more than the plan');
  o = applySlice(o, 3, 102); o = applySlice(o, 3, 98); assert.equal(isComplete(o), false);
  o = applySlice(o, 3, 104);
  assert.equal(isComplete(o), true); assert.equal(nextSlice(o, T0 + 9e6), null);
  const p = progress(o);
  assert.equal(p.pct, 100); assert.equal(p.sent, 4); assert.ok(Math.abs(p.avg - 101) < 1e-9); assert.ok(Math.abs(p.left) < 1e-9);
});

test('a slice that fills short leaves the rest visible in the progress', () => {
  let o = plan(10, 2, 10);
  o = applySlice(o, 4, 50);                       // asked 5, got 4
  const p = progress(o);
  assert.ok(Math.abs(p.left - 6) < 1e-9); assert.equal(p.avg, 50); assert.equal(p.sent, 1);
  o = applySlice(o, 0, 0);                        // a slice that could not fill at all
  assert.equal(isComplete(o), true); assert.ok(Math.abs(progress(o).avg - 50) < 1e-9);
});

test('the plan describes itself, and says what it costs on-chain', () => {
  const s = describeTwap(12, 4, 30, 'SOL', true);
  assert.match(s, /4 slices/); assert.match(s, /every 10 min/); assert.match(s, /over 30 min/);
  assert.match(s, /4 separate swaps, each paying its own gas/);
  assert.ok(!describeTwap(12, 4, 30, 'SOL', false).includes('gas'));
  assert.match(describeTwap(12, 13, 6, 'SOL', false), /every 30 s/);
});

const leg = (id: string, type: string, px: number, qty = 2, oco = 'g1'): RestingOrder => ({ id, type, side: 'sell', sym: 'SOL', quote: 'USDT', qty, px, oco });

test('OCO: a filled leg cancels its partner; a partial fill shrinks it instead', () => {
  const book = [leg('a', 'tp', 120), leg('b', 'sl', 90), { ...leg('c', 'sl', 80), oco: undefined } as unknown as RestingOrder];
  assert.deepEqual(ocoEffect(book, 'a', 2), { cancel: ['b'], reduce: [] }, 'the untethered order c is never touched');
  assert.deepEqual(ocoEffect(book, 'a', 0.5), { cancel: [], reduce: [{ id: 'b', qty: 1.5 }] });
  assert.deepEqual(ocoEffect(book, 'a', 1.9999999999), { cancel: ['b'], reduce: [] }, 'no dust leg is left behind');
  assert.deepEqual(ocoEffect(book, 'c', 2), { cancel: [], reduce: [] }, 'an order in no group cancels nothing');
  assert.deepEqual(ocoEffect(book, 'nope', 2), { cancel: [], reduce: [] });
  const three = [leg('a', 'tp', 120), leg('b', 'sl', 90), leg('d', 'sl', 85)];
  assert.deepEqual(ocoEffect(three, 'a', 2).cancel, ['b', 'd'], 'every other leg of the group goes');
});

test('the legs are ordinary resting orders — they still trigger exactly as tp and sl do', () => {
  assert.deepEqual(trigger(leg('a', 'tp', 120), 121), { hit: true, side: 'sell', px: 120 });
  assert.equal(trigger(leg('a', 'tp', 120), 119).hit, false);
  assert.deepEqual(trigger(leg('b', 'sl', 90), 89), { hit: true, side: 'sell', px: 90 });
  assert.equal(trigger({ ...leg('p', 'twap', 0), type: 'twap' }, 100).hit, false, 'a TWAP parent never triggers itself');
  assert.equal(trigger({ ...leg('v', 'void', 0), type: 'void' }, 100).hit, false, 'a cancelled leg is inert');
});
