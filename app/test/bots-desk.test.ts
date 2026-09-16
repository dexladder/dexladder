/**
 * The integration seams the desk added on top of the finished cores: the desk-wide slippage
 * setting (one number, both paths), the logbook feed out of the runner, and the halt plan applied
 * to a real run.
 *
 * The two things these tests are actually protecting:
 *   · at 0 bps every number is byte-identical to what shipped, because that is what every saved
 *     bot and every gate was measured at;
 *   · a Worker's answer survives the trip back unchanged, which is what makes "the Worker
 *     produces identical numbers" a claim about serialisation as well as about arithmetic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useBots, type BotsDeps, type Persisted } from '../src/hooks/useBots';
import { runStrategy, slipped } from '../src/lib/bots/backtest';
import { readSlipBps, slipCost, slipNote, DEFAULT_SLIP_BPS, MAX_SLIP_BPS } from '../src/lib/bots/slippage';
import { planHalt, isHaltable, HALTED_SAFETY } from '../src/lib/bots/kill';
import { append, emptyBook, slice } from '../src/lib/bots/logbook';
import { holding, open } from '../src/lib/bots/wallet';
import { PRESETS, type BotDef, type BotFill, type Candle, type LogEventKind } from '../src/lib/bots';

const H = 3_600_000;
const T0 = Date.UTC(2026, 8, 13, 0, 0);
const mk = (i: number, p: number): Candle => ({ t: T0 + i * H, o: p, h: p * 1.005, l: p * 0.995, c: p, v: 5 });
const bars = Array.from({ length: 220 }, (_, i) => mk(i, 100 + Math.sin(i / 7) * 12));
const strat = PRESETS[0]!.strategy;

// ---------------------------------------------------------------- the setting itself

test('slippage · the default is 0, junk reads as 0, and the cap is enforced', () => {
  assert.equal(DEFAULT_SLIP_BPS, 0);
  assert.equal(readSlipBps(undefined), 0);
  assert.equal(readSlipBps(''), 0);
  assert.equal(readSlipBps('not a number'), 0);
  assert.equal(readSlipBps(-40), 0);
  assert.equal(readSlipBps('30'), 30);
  assert.equal(readSlipBps(9_999), MAX_SLIP_BPS);
});

test('slippage · an existing save with no field at all still decodes, and reads back the number it was measured at', () => {
  const oldSave = { v: 1, runs: [] } as { v: number; runs: unknown[]; slip?: number };
  assert.equal(readSlipBps(oldSave.slip), 0);
  assert.equal(runStrategy(strat, bars, 10_000, 0.001, { slipBps: readSlipBps(oldSave.slip) }).score.equity,
    runStrategy(strat, bars, 10_000, 0.001).score.equity);
});

test('slippage · the cost is recovered exactly from the fills it moved', () => {
  const k = 30 / 10_000;
  const raw = 100;
  const buy: BotFill = { side: 'buy', qty: 2, px: slipped(raw, 'buy', 30), fee: 0, t: T0, why: 'signal', reason: '' };
  const sell: BotFill = { side: 'sell', qty: 2, px: slipped(raw, 'sell', 30), fee: 0, t: T0, why: 'signal', reason: '' };
  // a buy paid k above the tape, a sell received k below it: 2 × 100 × 0.003 each way
  assert.ok(Math.abs(slipCost([buy], 30) - 2 * raw * k) < 1e-9, String(slipCost([buy], 30)));
  assert.ok(Math.abs(slipCost([sell], 30) - 2 * raw * k) < 1e-9, String(slipCost([sell], 30)));
  assert.equal(slipCost([buy, sell], 0), 0);
  assert.match(slipNote(0, 0, 0), /Slippage is off/);
  assert.match(slipNote(30, 1.2, 2), /30 bps against every fill/);
});

test('slippage · a slipped run is worse than a clean one, and the clean path is untouched arithmetic', () => {
  const clean = runStrategy(strat, bars, 10_000, 0.001);
  const zero = runStrategy(strat, bars, 10_000, 0.001, { slipBps: 0 });
  const slip = runStrategy(strat, bars, 10_000, 0.001, { slipBps: 50 });
  assert.equal(JSON.stringify(zero), JSON.stringify(clean));
  assert.ok(slip.score.equity < clean.score.equity, slip.score.equity + ' vs ' + clean.score.equity);
});

// ---------------------------------------------------------------- the runner's seams

function world(slipBps: number) {
  let now = T0 + 100 * H + 30_000, px = 100;
  const feed: Candle[] = Array.from({ length: 100 }, (_, i) => mk(i, 100 + (i % 10)));
  const lines: { id: string; kind: LogEventKind; text: string }[] = [];
  const store: (readonly Persisted[])[] = [];
  const deps: BotsDeps = {
    now: () => now, schedule: () => () => undefined,
    bars: async () => feed.slice(), price: () => px, feeRate: () => 0.001,
    decideJs: async () => ({ error: 'no', ms: 1 }),
    decideSignal: async () => ({ signal: { action: 'hold' as const, reason: 'x' }, ms: 1 }),
    persist: rows => { store.push(rows); },
    slipBps: () => slipBps,
    log: (id, kind, _level, text) => { lines.push({ id, kind, text }); },
  };
  return {
    bots: useBots(deps), lines, store,
    closeBar(p: number) { const i = feed.length; feed.push(mk(i, p)); now = T0 + (i + 1) * H + 30_000; px = p; },
  };
}

const buyer = (): BotDef => ({
  id: 'b1', name: 'Buyer', kind: 'rules', sym: 'BTC', interval: '1h', stake: 10_000,
  strategy: { ...strat, entry: [{ left: { kind: 'ind', id: 'close' }, op: '>', right: { kind: 'const', value: 0 } }], exit: [], risk: { stakePct: 1, cooldownBars: 0 } },
  created: T0,
});

test('runner · a live fill pays the desk slippage, and 0 bps leaves the shipped numbers untouched', async () => {
  const a = world(0), b = world(100);
  for (const w of [a, b]) { w.bots.add(buyer()); await w.bots.start('b1'); w.closeBar(100); await w.bots.tick(); }
  const fa = a.bots.get('b1')!.wallet.fills[0]!, fb = b.bots.get('b1')!.wallet.fills[0]!;
  assert.equal(fa.px, 100);                                   // exactly the mark, not 100 × 1
  assert.equal(fb.px, 101);                                   // 100 bps against a buy
  assert.ok(fb.qty < fa.qty, 'a worse price buys less');
  assert.ok(Math.abs(a.bots.get('b1')!.wallet.cash) < 1e-9, 'a 100% buy leaves only float dust');
});

test('runner · every bar, evaluation, dispatch and fill reaches the logbook as a finished sentence', async () => {
  const w = world(0);
  w.bots.add(buyer());
  await w.bots.start('b1');
  w.closeBar(100);
  await w.bots.tick();
  const kinds = new Set(w.lines.map(l => l.kind));
  for (const k of ['tick', 'eval', 'dispatch', 'fill'] as const) assert.ok(kinds.has(k), 'missing ' + k + ' in ' + [...kinds].join(','));
  assert.ok(w.lines.every(l => l.id === 'b1'));
  assert.match(w.lines.find(l => l.kind === 'dispatch')!.text, /Sending a market buy/);
  assert.match(w.lines.find(l => l.kind === 'tick' && /bar closed/.test(l.text))!.text, /A 1h bar closed at/);
});

test('logbook · the viewer window is the only thing a slice ever hands back', () => {
  let b = emptyBook();
  for (let i = 0; i < 400; i++) b = append(b, { bot: 'b1', t: T0 + i, kind: 'tick', text: 'bar ' + i });
  const win = slice(b, 100, 18);
  assert.equal(win.length, 18);
  assert.equal(win[0]!.text, 'bar 100.');
  assert.equal(slice(b, 399, 18).length, 1);
  assert.equal(slice(b, 9_999, 18).length, 0);
});

// ---------------------------------------------------------------- the halt, applied

test('halt · applying the plan cancels exactly the ids it named, takes its wallet, and stands the bot down', async () => {
  const w = world(0);
  const r = w.bots.add(buyer());
  await w.bots.start('b1');
  w.closeBar(100);
  await w.bots.tick();
  r.orders = [{ id: 'o1', kind: 'limit', side: 'sell', qty: 1, px: 120 }, { id: 'o2', kind: 'stop', side: 'sell', qty: 1, px: 80 }];
  assert.ok(holding(r.wallet));
  assert.ok(isHaltable(r.status));

  const plan = planHalt({ def: r.def, status: r.status, wallet: r.wallet, orders: r.orders, hasEndpoint: false, hasSandbox: false, mark: 110, feeRate: 0.001, cause: 'user', now: T0 });
  assert.deepEqual([...plan.cancelled], ['o1', 'o2']);
  assert.equal(plan.steps.length, 5);
  assert.deepEqual(plan.steps.map(s => s.kind), ['freeze', 'cancel', 'flatten', 'seal', 'status']);

  // what the host does with it — exactly what legacy/bots-desk.ts does
  const kill = new Set(plan.cancelled);
  r.orders = r.orders.filter(o => !kill.has(o.id));
  r.wallet = plan.wallet;
  r.status = 'halted';
  w.bots.commit('b1');

  assert.equal(r.orders.length, 0);
  assert.equal(holding(r.wallet), false);
  assert.equal(r.status, 'halted');
  assert.equal(isHaltable(r.status), false, 'a halted bot is not haltable again');
  assert.equal(plan.status, HALTED_SAFETY);
  assert.equal(plan.draft.type, 'BOT_EMERGENCY_KILL');
  assert.equal(plan.draft.data.bot, 'b1');
  assert.equal(plan.draft.data.cancelled, 2);
  assert.ok(plan.draft.data.flat > 0 && plan.draft.data.px === 110);
  assert.ok(w.store.length > 0, 'the halt was persisted');
});

test('halt · the sealed payload stays small — the chain truncates to 120 entries and a bot must not evict trades', () => {
  const w = open(10_000);
  const plan = planHalt({ def: buyer(), status: 'live', wallet: w, orders: [], hasEndpoint: true, hasSandbox: false, mark: 100, feeRate: 0.001, cause: 'user', now: T0 });
  const bytes = JSON.stringify(plan.draft.data).length;
  assert.ok(bytes < 200, 'kill entry is ' + bytes + ' bytes');
  assert.deepEqual(Object.keys(plan.draft.data).sort(), ['bot', 'cancelled', 'eq', 'flat', 'name', 'px', 'why']);
});

// ---------------------------------------------------------------- the Worker's trip home

test('worker · a finished run survives the trip back from a Worker unchanged', () => {
  // postMessage is a structured clone; for a result made only of numbers, strings, arrays and
  // plain objects, a JSON round trip is the same test and runs without a browser.
  const r = runStrategy(strat, bars, 10_000, 0.001, { slipBps: 25 });
  const back = JSON.parse(JSON.stringify(r)) as typeof r;
  assert.equal(JSON.stringify(back), JSON.stringify(r));
  assert.equal(back.score.equity, r.score.equity);
  assert.equal(back.curve.length, r.curve.length);
  assert.equal(back.wallet.fills.length, r.wallet.fills.length);
});
