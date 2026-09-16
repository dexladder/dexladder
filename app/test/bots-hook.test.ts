import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useBots, TICK_MS, type BotsDeps, type Persisted } from '../src/hooks/useBots';
import { PRESETS, type BotDef, type Candle } from '../src/lib/bots';

const H = 3_600_000;
const T0 = Date.UTC(2026, 8, 13, 0, 0);
const mk = (i: number, p: number): Candle => ({ t: T0 + i * H, o: p, h: p * 1.005, l: p * 0.995, c: p, v: 5 });

/** a controllable world: a clock, a price, a bar feed, two deciders, a store */
function world() {
  let now = T0 + 100 * H + 30_000;     // 30 s into bar 100
  let px = 100;
  const feed: Candle[] = Array.from({ length: 100 }, (_, i) => mk(i, 100 + (i % 10)));   // bars 0..99 closed, 100 in progress
  const timers: { fn: () => void; at: number }[] = [];
  const store: (readonly Persisted[])[] = [];
  const events: string[] = [];
  let js: (ctx: unknown) => unknown = () => 'hold';
  let sig: (ctx: unknown) => unknown = () => ({ action: 'hold' });
  const deps: BotsDeps = {
    now: () => now,
    schedule: (fn, ms) => { const t = { fn, at: now + ms }; timers.push(t); return () => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); }; },
    bars: async () => feed.slice(),
    price: () => px,
    feeRate: () => 0.001,
    decideJs: async (_d, ctx) => { const v = js(ctx); return v instanceof Error ? { error: v.message, ms: 1 } : { signal: { action: v as 'buy', reason: 'js said ' + String(v) }, ms: 1 }; },
    decideSignal: async (_d, ctx) => { const v = sig(ctx) as { action: 'buy' | 'sell' | 'hold' }; return { signal: { action: v.action, reason: 'endpoint said ' + v.action }, ms: 2 }; },
    persist: rows => { store.push(rows); },
    emit: (k, id, text) => { events.push(k + ':' + id + (text ? ':' + text : '')); },
  };
  const bots = useBots(deps);
  return {
    bots, events, store, timers,
    setPrice(p: number) { px = p; },
    /** close the current bar at price p and move 30 s into the next one */
    closeBar(p: number) { const i = feed.length; feed.push(mk(i, p)); now = T0 + (i + 1) * H + 30_000; px = p; },
    advance(ms: number) { now += ms; },
    setJs(f: typeof js) { js = f; }, setSig(f: typeof sig) { sig = f; },
    fire() { const t = timers.shift(); if (t) t.fn(); },
  };
}

const rulesBot = (): BotDef => ({ id: 'r1', name: 'RSI bot', kind: 'rules', sym: 'BTC', interval: '1h', stake: 10_000, strategy: { ...PRESETS[0]!.strategy, entry: [{ left: { kind: 'ind', id: 'close' }, op: '>', right: { kind: 'const', value: 0 } }], exit: [{ left: { kind: 'ind', id: 'close' }, op: '>', right: { kind: 'const', value: 150 } }], risk: { stakePct: 0.5, stopLossPct: 3, cooldownBars: 0 } }, created: T0 });

test('hook · a new bot loads history but decides only from the NEXT close; then a buy fills at the live price on its own wallet', async () => {
  const w = world();
  w.bots.add(rulesBot());
  await w.bots.start('r1');
  const r = w.bots.get('r1')!;
  assert.equal(r.status, 'live'); assert.equal(r.bars.length, 100); assert.equal(r.wallet.fills.length, 0);
  assert.ok(r.log.some(l => /first decision at the next 1h close/.test(l.text)));
  await w.bots.tick();                                   // still inside bar 100 — nothing new
  assert.equal(r.wallet.fills.length, 0);
  w.closeBar(101);                                       // bar 100 closes at 101
  await w.bots.tick();
  assert.equal(r.wallet.fills.length, 1);
  assert.equal(r.wallet.fills[0]!.px, 101, 'filled at the price DexLadder saw next');
  assert.ok(Math.abs(r.wallet.cash - 5000) < 1e-6, 'half the cash, as the stake says');
  assert.ok(w.events.some(e => e.startsWith('fill:r1:buy')));
  assert.ok(w.store.length > 0 && w.store[w.store.length - 1]![0]!.wallet.fills.length === 1, 'the store holds the wallet');
});

test('hook · a stop-loss fires on a live mark between bars, and the bot does not re-enter until the next close', async () => {
  const w = world();
  w.bots.add(rulesBot()); await w.bots.start('r1');
  w.closeBar(100); await w.bots.tick();
  const r = w.bots.get('r1')!;
  assert.equal(r.wallet.fills.length, 1);
  w.setPrice(96.5); w.advance(TICK_MS); await w.bots.tick();          // −3.5 % on a mark, no bar closed
  assert.equal(r.wallet.fills.length, 2); assert.equal(r.wallet.fills[1]!.why, 'stop-loss'); assert.equal(r.wallet.qty, 0);
  assert.ok(r.log.some(l => l.kind === 'risk' && /stop-loss 3% hit/.test(l.text)));
  w.advance(TICK_MS); await w.bots.tick();
  assert.equal(r.wallet.fills.length, 2, 'no re-entry between closes');
  w.closeBar(97); await w.bots.tick();
  assert.equal(r.wallet.fills.length, 3, 're-entered at the next close');
});

test('hook · JS and endpoint bots decide through their deciders; errors are counted and the bot stops after five', async () => {
  const w = world();
  w.bots.add({ id: 'j1', name: 'js', kind: 'js', sym: 'BTC', interval: '1h', stake: 1000, code: 'function onBar(){}', created: T0 });
  w.bots.add({ id: 's1', name: 'sig', kind: 'signal', sym: 'BTC', interval: '1h', stake: 1000, url: 'http://127.0.0.1:1/s', created: T0 });
  await w.bots.start('j1'); await w.bots.start('s1');
  w.setJs(ctx => ((ctx as { close: number[] }).close.length === 101 ? 'buy' : 'hold'));
  w.setSig(() => ({ action: 'buy' }));
  w.closeBar(100); await w.bots.tick();
  assert.equal(w.bots.get('j1')!.wallet.fills.length, 1); assert.equal(w.bots.get('s1')!.wallet.fills.length, 1);
  assert.match(w.bots.get('j1')!.log[w.bots.get('j1')!.log.length - 1]!.text, /because js said buy/);
  w.setJs(() => new Error('onBar threw: boom'));
  for (let i = 0; i < 5; i++) { w.closeBar(100 + i); await w.bots.tick(); }
  const j = w.bots.get('j1')!;
  assert.equal(j.status, 'error'); assert.equal(j.health.errors, 5); assert.ok(w.events.filter(e => e.startsWith('error:j1')).length === 5);
  assert.equal(w.bots.get('s1')!.status, 'live', 'one bot failing never touches another');
});

test('hook · restore resumes live bots, names the bars it missed, takes no trade for them, and the scheduler wakes', async () => {
  const w = world();
  w.bots.add(rulesBot()); await w.bots.start('r1');
  w.closeBar(100); await w.bots.tick();
  const saved = w.store[w.store.length - 1]!;
  const w2 = world();
  // the world moved on: more bars closed while the page was away
  w2.closeBar(100); w2.closeBar(100); w2.closeBar(100); w2.closeBar(120);
  w2.bots.restore(saved);
  assert.ok(w2.bots.awake(), 'a live bot wakes the loop');
  await w2.bots.tick();
  const r = w2.bots.get('r1')!;
  assert.ok(r.log.some(l => /2 bar\(s\) closed while this page was away/.test(l.text)), r.log.map(l => l.text).join('\n'));
  assert.equal(r.wallet.fills.length, 1, 'no trades were taken for missed bars (the position was kept)');
  w2.bots.stop('r1');
  assert.equal(r.status, 'stopped'); assert.equal(r.wallet.qty, 0); assert.equal(r.wallet.fills[1]!.why, 'close-out');
  w2.bots.reset('r1');
  assert.equal(w2.bots.get('r1')!.wallet.fills.length, 0);
  w2.bots.sleep(); assert.equal(w2.bots.awake(), false);
});
