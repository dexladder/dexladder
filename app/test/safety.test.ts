import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HALTED_SAFETY, haltAllText, isHaltable, planHalt, planHaltAll, type BotOrder, type HaltInput } from '../src/lib/bots/kill';
import { BODY_CAP, RING_CAP, TRUNCATED, emptyRing, percentile, push, vitals, type Sample } from '../src/lib/bots/telemetry';
import { LOGBOOK_CAP, MAX_WINDOW, append, appendAll, capNote, emptyBook, filter, finish, slice, type LogDraft } from '../src/lib/bots/logbook';
import { fill, open } from '../src/lib/bots/wallet';
import type { BotDef, Wallet } from '../src/lib/bots/types';

const def = (id: string, kind: BotDef['kind'] = 'rules'): BotDef => ({ id, name: 'Bot ' + id, kind, sym: 'BTC', interval: '1h', stake: 10_000, created: 1, ...(kind === 'signal' ? { url: 'http://127.0.0.1:8787/signal' } : {}) });
const held = (px = 100, feeRate = 0.001): Wallet => fill(open(10_000), 'buy', 1, px, feeRate, 1, 'signal', 'test').wallet;
const order = (id: string, kind: BotOrder['kind'] = 'limit'): BotOrder => ({ id, kind, side: 'sell', qty: 1, px: 105 });
const input = (over: Partial<HaltInput> = {}): HaltInput => ({
  def: def('a'), status: 'live', wallet: open(10_000), orders: [], hasEndpoint: false, hasSandbox: false,
  mark: 100, feeRate: 0.001, cause: 'user', now: 1_000, ...over,
});

test('kill · the halt happens in ONE order: freeze, cancel, flatten, seal, status — and every step is reported even when it had nothing to do', () => {
  const p = planHalt(input({ def: def('a', 'signal'), hasEndpoint: true, orders: [order('o1'), order('o2', 'stop')], wallet: held() }));
  assert.deepEqual(p.steps.map(s => s.kind), ['freeze', 'cancel', 'flatten', 'seal', 'status']);
  assert.ok(p.steps.every(s => /[.!?…]$/.test(s.text)), 'every step is a finished sentence');
  assert.match(p.steps[0]!.text, /127\.0\.0\.1:8787\/signal will not be polled/);
  assert.deepEqual(p.cancelled, ['o1', 'o2']);
  assert.equal(p.status, HALTED_SAFETY);
  // a rules bot has nothing to freeze — the step is still there, marked as having done nothing
  const rules = planHalt(input({}));
  assert.equal(rules.steps[0]!.acted, false);
  assert.match(rules.steps[0]!.text, /Nothing to freeze/);
  assert.equal(planHalt(input({ hasSandbox: true })).steps[0]!.acted, true);
});

test('kill · a halt with nothing held cancels, seals and stops — no phantom fill, no phantom price', () => {
  const p = planHalt(input({ orders: [order('o1')], cause: 'rate-limit' }));
  assert.equal(p.fill, null);
  assert.equal(p.wallet.qty, 0);
  assert.equal(p.steps[2]!.acted, false);
  assert.match(p.steps[2]!.text, /Nothing held/);
  assert.equal(p.draft.data.flat, 0);
  assert.equal(p.draft.data.px, 0);
  assert.equal(p.draft.data.cancelled, 1);
  assert.equal(p.draft.data.eq, 10_000);
  assert.equal(p.draft.data.why, 'rate-limit');
  // nothing to flatten with no mark either, and the plan says so instead of pretending
  const blind = planHalt(input({ wallet: held(), mark: 0 }));
  assert.equal(blind.fill, null);
  assert.ok(blind.wallet.qty > 0);
  assert.match(blind.steps[2]!.text, /no mark to print against/);
});

test('kill · a halt mid-position flattens at the mark, pays the fee, and seals one small flat entry', () => {
  const w = held(100, 0.001);
  const p = planHalt(input({ wallet: w, mark: 120, feeRate: 0.001, orders: [order('o1')] }));
  assert.ok(p.fill, 'the position was flattened');
  assert.equal(p.fill!.px, 120, 'the flatten prints at the mark it was given');
  assert.equal(p.fill!.why, 'close-out');
  assert.equal(p.fill!.side, 'sell');
  assert.ok(Math.abs(p.fill!.fee - p.fill!.qty * 120 * 0.001) < 1e-9, 'the venue fee is charged on the flatten');
  assert.ok(p.wallet.feesUSD > w.feesUSD, 'the fee left the bot’s own wallet');
  assert.equal(p.wallet.qty, 0);
  assert.equal(p.wallet.trades.length, 1);
  assert.ok(Math.abs(p.draft.data.eq - p.wallet.cash) < 0.01, 'the sealed equity is the closing wallet');
  // the ledger entry stays small and flat — the chain truncates to 120 entries and this must not evict trades
  assert.equal(p.draft.type, 'BOT_EMERGENCY_KILL');
  assert.deepEqual(Object.keys(p.draft.data), ['bot', 'name', 'why', 'cancelled', 'flat', 'px', 'eq']);
  assert.ok(Object.values(p.draft.data).every(v => typeof v === 'string' || typeof v === 'number'), 'flat: no nested objects');
  assert.ok(JSON.stringify(p.draft.data).length < 200, 'small: ' + JSON.stringify(p.draft.data));
  assert.equal(p.draft.data.px, 120);
  assert.ok(Math.abs(p.draft.data.flat - p.fill!.qty) < 1e-6);
});

test('kill · the global switch halts everything still in the market, skips what is already out, and each bot gets its own draft', () => {
  assert.deepEqual([isHaltable('live'), isHaltable('paused'), isHaltable('error'), isHaltable('draft'), isHaltable('stopped'), isHaltable(HALTED_SAFETY)], [true, true, true, false, false, false]);
  const plans = planHaltAll([
    input({ def: def('live'), status: 'live', wallet: held(), mark: 110, orders: [order('o1'), order('o2')] }),
    input({ def: def('paused'), status: 'paused' }),
    input({ def: def('draft'), status: 'draft', wallet: held() }),
    input({ def: def('stopped'), status: 'stopped' }),
    input({ def: def('errored', 'js'), status: 'error', hasSandbox: true, wallet: held(), mark: 90, cause: 'repeated-failure' }),
  ]);
  assert.deepEqual(plans.map(p => p.id), ['live', 'paused', 'errored']);
  assert.equal(new Set(plans.map(p => p.draft)).size, 3, 'one draft per bot, never shared');
  assert.ok(plans.every(p => p.status === HALTED_SAFETY && p.draft.type === 'BOT_EMERGENCY_KILL'));
  assert.deepEqual(plans.map(p => !!p.fill), [true, false, true]);
  assert.equal(plans[2]!.draft.data.why, 'repeated-failure');
  assert.match(haltAllText(plans), /Halted 3 bot\(s\) · 2 order\(s\) cancelled · 2 position\(s\) flattened · 3 ledger entries sealed\./);
  assert.match(haltAllText(planHaltAll([input({ status: 'stopped' })])), /No bot was running/);
});

const sample = (ms: number, ok = true, t = ms): Sample => ({ t, ms, ok, status: ok ? 200 : 'timeout', reqBytes: 900, resBytes: ok ? 64 : 0 });
const ringOf = (mss: readonly number[]) => mss.reduce((r, ms) => push(r, sample(ms)), emptyRing());

test('telemetry · percentiles are nearest-rank at n = 0, 1, 2, 100 and 101 — the ring drops the oldest poll, never the count', () => {
  assert.equal(percentile([], 50), 0);
  const v0 = vitals(emptyRing());
  assert.deepEqual([v0.polls, v0.p50, v0.p95, v0.successPct], [0, 0, 0, 0]);
  assert.match(v0.verdict, /Not called yet/);

  const one = vitals(ringOf([5]));
  assert.deepEqual([one.polls, one.p50, one.p95], [1, 5, 5]);

  const two = vitals(ringOf([20, 10]));
  assert.deepEqual([two.polls, two.p50, two.p95], [2, 10, 20], 'p50 of two samples is the lower one, p95 the upper');

  const hundred = vitals(ringOf(Array.from({ length: 100 }, (_, i) => i + 1)));
  assert.deepEqual([hundred.polls, hundred.seen, hundred.p50, hundred.p95], [100, 100, 50, 95]);

  const over = vitals(ringOf(Array.from({ length: 101 }, (_, i) => i + 1)));
  assert.equal(over.polls, RING_CAP, 'the window is bounded');
  assert.equal(over.seen, 101, 'but the count of polls ever made is not');
  assert.deepEqual([over.p50, over.p95], [51, 96], 'the oldest poll was evicted, so both percentiles step up by one');
  assert.match(over.verdict, /the last 100 of 101 polls/);
});

test('telemetry · the failure streak is what the desk leads with; the worst streak survives eviction', () => {
  let r = emptyRing();
  r = push(r, sample(30));
  r = push(r, sample(30, false));
  r = push(r, sample(30, false));
  assert.equal(vitals(r).streak, 2);
  assert.match(vitals(r).verdict, /Failing — the last 2 polls failed with no answer in time/);
  r = push(r, sample(30, false));
  assert.match(vitals(r).verdict, /^Down — the last 3 polls failed/);
  assert.equal(vitals(r).healthy, false);
  r = push(r, sample(30));
  assert.equal(vitals(r).streak, 0, 'one good answer clears the streak');
  assert.equal(vitals(r).worst, 3, 'but not the record of how bad it got');
  assert.match(vitals(r).verdict, /Flaky — 3 of 5 polls failed \(40% good\)/);
  // push the bad run out of the window entirely: the window is clean, the record is kept
  for (let i = 0; i < RING_CAP; i++) r = push(r, sample(12));
  const v = vitals(r);
  assert.deepEqual([v.polls, v.failed, v.streak, v.worst, v.healthy], [RING_CAP, 0, 0, 3, true]);
  assert.match(v.verdict, /Answering — 100% of the last 100 of 105 polls good, typically 12 ms/);
  assert.equal(vitals(ringOf([50, 3000, 3000])).verdict.startsWith('Answering, slowly'), true);
});

test('telemetry · the payload inspector truncates out loud — the cut is stated, never silent', () => {
  const big = 'x'.repeat(BODY_CAP + 50);
  const r = push(emptyRing(), sample(40), { request: 'http://127.0.0.1:8787/signal?sym=BTC', response: big });
  assert.equal(r.lastRequest!.truncated, false);
  assert.equal(r.lastRequest!.text, 'http://127.0.0.1:8787/signal?sym=BTC');
  assert.equal(r.lastResponse!.truncated, true);
  assert.equal(r.lastResponse!.chars, BODY_CAP + 50, 'the original size is reported, not the kept size');
  assert.ok(r.lastResponse!.text.includes(TRUNCATED));
  assert.match(r.lastResponse!.text, /showing the first 4,000 of 4,050 characters/);
  assert.equal(r.lastResponse!.text.slice(0, BODY_CAP), big.slice(0, BODY_CAP));
  // a poll with no raw text keeps the last exchange rather than blanking the inspector
  const next = push(r, sample(41));
  assert.equal(next.lastResponse!.chars, BODY_CAP + 50);
});

const draft = (i: number, over: Partial<LogDraft> = {}): LogDraft => ({ bot: 'a', t: 1_000 + i, kind: 'tick', text: 'Bar ' + i + ' closed at 61,240.50.', ...over });

test('logbook · the cap is bounded and says what it cost; slice hands a viewer a window, never the list', () => {
  let b = emptyBook();
  for (let i = 0; i < LOGBOOK_CAP + 50; i++) b = append(b, draft(i));
  assert.equal(b.events.length, LOGBOOK_CAP);
  assert.equal(b.dropped, 50);
  assert.equal(b.events[0]!.seq, 51, 'seq is monotonic across eviction, so a scrolled-away row keys back to itself');
  assert.equal(b.next, LOGBOOK_CAP + 51);
  assert.match(capNote(b), /Showing the last 600 of 650 events — 50 older one\(s\) were dropped/);
  assert.match(capNote(emptyBook()), /nothing dropped yet/);

  const win = slice(b, 10, 5);
  assert.equal(win.length, 5);
  assert.equal(win[0]!.seq, 61, 'index 0 is the oldest entry kept');
  assert.equal(slice(b, 0, 10_000).length, MAX_WINDOW, 'a viewer asking for everything still gets a window');
  assert.equal(slice(b, LOGBOOK_CAP + 99, 10).length, 0);
  assert.equal(slice(b, -5, 3)[0]!.seq, 51);
});

test('logbook · every entry is a finished sentence, and the filters answer by level, kind and bot', () => {
  const b = appendAll(emptyBook(), [
    draft(1, { kind: 'eval', text: 'RSI(14) 27.4 < 30 — entry conditions met' }),
    draft(2, { kind: 'dispatch', text: 'Sent a market buy for 0.163 BTC.' }),
    draft(3, { kind: 'fill', text: 'Bought 0.163 @ 61,240.50 · fee 0.9996' }),
    draft(4, { kind: 'halt', bot: 'b', text: 'Halted for safety after 5 failed polls.' }),
    draft(5, { kind: 'error', bot: 'b', text: {} }),
  ]);
  assert.deepEqual(b.events.map(e => e.level), ['info', 'info', 'info', 'warn', 'error']);
  assert.equal(b.events[0]!.text, 'RSI(14) 27.4 < 30 — entry conditions met.', 'a sentence gets its full stop');
  assert.equal(b.events[4]!.text, 'Something failed and no reason came back with it.', 'an object never reaches the panel as [object Object]');
  assert.equal(finish('   ', 'tick'), 'A bar closed and the bot looked at it.');
  assert.equal(finish('[object Object]', 'dispatch'), 'The bot sent an order.');
  assert.equal(finish('x'.repeat(400), 'eval').length, 240);
  assert.ok(finish('x'.repeat(400), 'eval').endsWith('…'), 'a cut sentence shows that it was cut');
  assert.equal(finish('Held · nothing to do ·', 'eval'), 'Held · nothing to do ·');

  assert.deepEqual(filter(b, { bot: 'b' }).map(e => e.kind), ['halt', 'error']);
  assert.deepEqual(filter(b, { level: 'info' }).map(e => e.kind), ['eval', 'dispatch', 'fill']);
  assert.deepEqual(filter(b, { kind: 'fill', bot: 'a' }).length, 1);
  assert.equal(filter(b, {}).length, 5, 'an empty query is the "all" filter');
  assert.equal(append(emptyBook(), draft(1, { kind: 'tick', level: 'warn' })).events[0]!.level, 'warn', 'a caller may override the level');
});
