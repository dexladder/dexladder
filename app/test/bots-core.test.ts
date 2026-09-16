import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLANK, PRESETS, describe, evaluate, fill, mark, mergeBars, normalise, open, operandLabel, parseSignal, prepareCode, rank, riskExit, runStrategy, score, series, signalUrl, validateBot, validateStrategy, verdict, warmup, wilsonHalf, barStart, doctor, type Candle, type Strategy } from '../src/lib/bots';

const H = 3_600_000;
const bars = (n: number, f: (i: number) => number): Candle[] => Array.from({ length: n }, (_, i) => { const p = f(i); return { t: (i + 1) * H, o: p, h: p * 1.01, l: p * 0.99, c: p, v: 10 + (i % 3) }; });
/** a market that falls hard then recovers: RSI dips under 30, then climbs past 60 */
const dip = (i: number): number => (i < 30 ? 100 : i < 45 ? 100 - (i - 29) * 2.5 : 62.5 + (i - 44) * 2);

test('indicators · series are causal and warm up as NaN; labels read like a chart legend', () => {
  const b = bars(60, i => 100 + i);
  const ema = series({ kind: 'ind', id: 'ema', p1: 10 }, b);
  assert.equal(ema.length, 60);
  assert.ok(Number.isNaN(ema[3]!) && Number.isFinite(ema[59]!));
  // causal: the value at i is the same whether or not later bars exist
  const short = series({ kind: 'ind', id: 'ema', p1: 10 }, b.slice(0, 40));
  assert.equal(short[39], ema[39]);
  const hi = series({ kind: 'ind', id: 'highest', p1: 5 }, b);
  assert.equal(hi[10], b[9]!.h);     // the previous 5 bars, this one excluded
  assert.equal(operandLabel({ kind: 'ind', id: 'rsi', p1: 14 }), 'RSI(14)');
  assert.equal(operandLabel({ kind: 'ind', id: 'bbUpper', p1: 20, p2: 2 }), 'Bollinger upper(20, 2)');
  assert.equal(operandLabel({ kind: 'const', value: 30 }), '30.00');
  assert.ok(warmup([{ kind: 'ind', id: 'macdHist', p1: 12, p2: 26 }]) >= 37);
});

test('rules · the RSI preset waits through warm-up, buys the dip, sells the recovery, and says why', () => {
  const s = PRESETS[0]!.strategy, b = bars(80, dip);
  const warm = evaluate(s, b, 5, false, -1);
  assert.equal(warm.action, 'hold'); assert.match(warm.reason, /warming up/);
  const buys = b.map((_, i) => evaluate(s, b, i, false, -1)).map((x, i) => ({ i, ...x })).filter(x => x.action === 'buy');
  assert.ok(buys.length > 0, 'the dip must trigger an entry');
  assert.match(buys[0]!.reason, /RSI\(14\) [\d.]+ < 30/);
  const sells = b.map((_, i) => evaluate(s, b, i, true, -1)).filter(x => x.action === 'sell');
  assert.ok(sells.length > 0 && /RSI\(14\) [\d.]+ > 60/.test(sells[sells.length - 1]!.reason));
  // cooldown holds the bot back, in words
  assert.match(evaluate({ ...s, risk: { ...s.risk, cooldownBars: 3 } }, b, 70, false, 1).reason, /cooldown · 2 bar/);
  assert.equal(describe(s)[0], 'Buy when all of: RSI(14) < 30.00');
  const cross = evaluate(PRESETS[1]!.strategy, bars(80, i => (i < 40 ? 100 - i * 0.5 : 80 + (i - 40) * 3)), 60, false, -1);
  assert.equal(cross.action, 'hold');   // a cross happens on ONE bar only
});

test('wallet · fills pay the fee, sells realise against average cost, marks build the curve and the drawdown', () => {
  let w = open(10_000);
  const b1 = fill(w, 'buy', 0.5, 100, 0.001, 1, 'signal', 'test');
  w = b1.wallet;
  assert.ok(b1.fill && Math.abs(w.cash - 5000) < 1e-9 && Math.abs(w.qty * 100 - 5000 / 1.001) < 1e-6);
  w = mark(w, 110, 2); w = mark(w, 90, 3);
  assert.ok(w.maxDD > 0 && w.hwm === 110 && w.marksInMarket === 2);
  const s1 = fill(w, 'sell', 1, 120, 0.001, 4, 'signal', 'test');
  w = s1.wallet;
  assert.equal(w.qty, 0); assert.equal(w.trades.length, 1); assert.ok(w.trades[0]!.pl > 0);
  assert.match(fill(w, 'sell', 1, 120, 0.001, 5, 'signal', 'x').text, /nothing to sell/);
  const sc = score(mark(w, 120, 6));
  assert.equal(sc.trades, 1); assert.equal(sc.wins, 1); assert.ok(sc.returnPct > 0 && sc.feesUSD > 0);
  assert.ok(Math.abs(sc.buyHoldPct - 20) < 1e-9, 'buy-and-hold is measured from the first mark (110) … ' + sc.buyHoldPct);
});

test('wallet · risk exits: the stop fires before the target, the trailing stop measures from the high since entry', () => {
  let w = fill(open(1000), 'buy', 1, 100, 0, 1, 'signal', '').wallet;
  const r = { stakePct: 1, stopLossPct: 5, takeProfitPct: 10, trailingPct: 4, cooldownBars: 0 };
  assert.equal(riskExit(w, r, 97), null);
  assert.equal(riskExit(w, r, 94.9)!.why, 'stop-loss');
  assert.equal(riskExit(w, r, 110.1)!.why, 'take-profit');
  w = mark(w, 108, 2);                    // the high since entry is now 108
  const t = riskExit(w, r, 103.5)!;
  assert.equal(t.why, 'trailing'); assert.match(t.reason, /off the 108\.0000 high/);
});

test('backtest · decisions fill at the NEXT open, risk exits fire on the wick, the run ends flat, and it beats or trails buy-and-hold honestly', () => {
  const s = PRESETS[0]!.strategy, b = bars(90, dip);
  const r = runStrategy(s, b, 10_000, 0.001);
  assert.ok(r.wallet.fills.length >= 2, 'a round trip happened');
  const entry = r.wallet.fills[0]!;
  const sigBar = b.findIndex(x => x.t === entry.t) - 1;
  assert.ok(sigBar >= 0 && entry.px === b[sigBar + 1]!.o, 'entry price is the open of the bar AFTER the signal bar');
  assert.equal(r.wallet.qty, 0, 'measured flat');
  assert.equal(r.curve.length, 90);
  assert.ok(r.log.some(l => l.kind === 'fill' && /because entry · ✓ RSI/.test(l.text)));
  // a tight stop on a straight fall exits at the wick, not the close
  const crash: Strategy = { ...BLANK, entry: [{ left: { kind: 'ind', id: 'close' }, op: '>', right: { kind: 'const', value: 0 } }], exit: [], risk: { stakePct: 1, stopLossPct: 1, cooldownBars: 100 } };
  const fall = bars(30, i => 100 - i * 2);
  const c = runStrategy(crash, fall, 1000, 0);
  const stop = c.wallet.fills.find(f => f.why === 'stop-loss')!;
  const stopBar = fall.find(x => x.t === stop.t)!;
  assert.ok(stop && stop.px === stopBar.l, 'the stop filled at the bar low');
  const v = verdict(c.score, false);
  assert.match(v[0]!.text, /vs buy-and-hold/);
});

test('validate · every refusal is a sentence', () => {
  const errs = validateStrategy({ ...BLANK, entry: [{ left: { kind: 'ind', id: 'rsi' }, op: '<', right: { kind: 'const', value: 130 } }], exit: [], risk: { stakePct: 2, cooldownBars: 0 } });
  assert.ok(errs.some(e => /RSI runs 0–100/.test(e)) && errs.some(e => /Stake per entry/.test(e)) && errs.some(e => /can never sell/.test(e)));
  assert.deepEqual(validateStrategy(PRESETS[2]!.strategy), []);
  const scale = validateStrategy({ ...BLANK, entry: [{ left: { kind: 'ind', id: 'rsi' }, op: '>', right: { kind: 'ind', id: 'ema' } }] });
  assert.ok(scale.some(e => /different scales/.test(e)));
  assert.ok(validateBot({ id: 'a', name: 'x', kind: 'signal', sym: 'BTC', interval: '1h', stake: 1000, url: 'ftp://x', created: 1 }).some(e => /http:\/\//.test(e)));
  assert.ok(validateBot({ id: 'a', name: 'x', kind: 'js', sym: 'BTC', interval: '1h', stake: 1000, code: 'const a = 1;', created: 1 }).some(e => /onBar/.test(e)));
  assert.deepEqual(validateBot({ id: 'a', name: 'x', kind: 'rules', sym: 'BTC', interval: '1h', stake: 1000, strategy: PRESETS[0]!.strategy, created: 1 }), []);
});

test('sandbox · onBar answers are normalised, garbage is refused in words, module syntax is rewritten without eval', () => {
  assert.equal((normalise('BUY') as { signal: { action: string } }).signal.action, 'buy');
  assert.equal((normalise({ action: 'long', size: 3, reason: 'x' }) as { signal: { size: number } }).signal.size, 1);
  assert.equal((normalise(undefined) as { signal: { action: string } }).signal.action, 'hold');
  assert.match((normalise('moon') as { error: string }).error, /expected buy, sell or hold/);
  assert.match((normalise(42) as { error: string }).error, /returned a number/);
  const src = prepareCode('import x from "y";\nexport default { onBar(c) { return "hold"; } }');
  assert.ok(!/import x/.test(src.split('\n')[0]!.replace(/^\/\/.*/, '')) && /module\.exports = \{/.test(src));
});

test('signal · the URL carries the wallet and the closes; answers parse; the doctor names causes', () => {
  const w = fill(open(1000), 'buy', 0.5, 100, 0, 1, 'signal', '').wallet;
  const u = signalUrl('http://127.0.0.1:8787/signal', { sym: 'BTC', interval: '1h', i: 12, t: 99, px: 105, wallet: w, closes: [1, 2, 3], last: 'buy' });
  assert.match(u, /^http:\/\/127\.0\.0\.1:8787\/signal\?sym=BTC&iv=1h&i=12&t=99&px=105&qty=/);
  assert.match(u, /&last=buy&c=1%2C2%2C3$/);
  assert.equal((parseSignal('{"action":"sell","reason":"take it"}') as { signal: { reason: string } }).signal.reason, 'take it');
  assert.equal((parseSignal('"hold"') as { signal: { action: string } }).signal.action, 'hold');
  assert.match((parseSignal('<!doctype html><html>') as { error: string }).error, /HTML page/);
  assert.ok(doctor('http://127.0.0.1:8787', true, 'TypeError: Failed to fetch').some(l => /Access-Control-Allow-Origin/.test(l)));
  assert.ok(doctor('http://example.com/s', true, 'x').some(l => /mixed content/.test(l)));
  assert.match(doctor('http://127.0.0.1:1', true, '503')[0]!, /HTTP 503/);
});

test('arena · rank by edge over buy-and-hold; a small sample is called too early; Wilson band is wide at n=3', () => {
  const sc = (edge: number, trades: number) => ({ ...score(open(1)), edgePct: edge, returnPct: edge, trades });
  const def = (id: string) => ({ id, name: id, kind: 'rules' as const, sym: 'BTC', interval: '1h' as const, stake: 1, created: 1 });
  const rows = rank([{ def: def('a'), status: 'live', score: sc(-2, 9) }, { def: def('b'), status: 'live', score: sc(5, 9) }, { def: def('c'), status: 'live', score: sc(1, 2) }]);
  assert.deepEqual(rows.map(r => r.id), ['b', 'c', 'a']);
  assert.equal(rows[0]!.call, 'beats the market'); assert.equal(rows[1]!.call, 'too early to say'); assert.equal(rows[2]!.call, 'trails the market');
  assert.ok(Math.abs(wilsonHalf(3, 3) - 28.1) < 1);   // 3/3 wins: the 95 % band still reaches down to 44 %
});

test('intervals · bar boundaries are UTC-aligned and only CLOSED bars merge; a restated bar replaces its twin', () => {
  const now = Date.UTC(2026, 8, 13, 10, 37);
  assert.equal(barStart(now, '1h'), Date.UTC(2026, 8, 13, 10));
  const have = [{ t: Date.UTC(2026, 8, 13, 8), c: 1 }, { t: Date.UTC(2026, 8, 13, 9), c: 2 }];
  const fresh = [{ t: Date.UTC(2026, 8, 13, 9), c: 2.5 }, { t: Date.UTC(2026, 8, 13, 10), c: 3 }];   // 10:00 is still open
  const m = mergeBars(have, fresh, '1h', now);
  assert.equal(m.bars.length, 2); assert.equal(m.added, 0); assert.equal(m.bars[1]!.c, 2.5);
});
