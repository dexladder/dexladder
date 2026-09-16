/**
 * Paper-engine parity: the ORIGINAL legacy code (cut from the sha-pinned v153 source) and the
 * shipped replacement (buildlib/patches/*.js + the pure engine) run the same scenarios side by
 * side. Every observable is compared exactly: book levels, previews, executions, balances,
 * basis, stats, journal, order book state, and the sequence of toasts / ledger writes.
 *
 * One behaviour differs ON PURPOSE and has its own test: liquidity healing. The legacy book
 * decayed the eaten amount inside every READ, so the more often the UI looked at the book the
 * faster it healed. The engine heals linearly in time only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { cut, load } from './legacy';
import * as P from '../src/legacy/paper';
import { bind } from '../src/legacy/globals';
import { createBookEngine, VENUES, thinLiquidityBps } from '../src/lib/paper-engine';
import { v153 } from './legacy';

const PATCH = (f: string) => readFileSync(join(process.cwd(), '..', 'buildlib', 'patches', f), 'utf8');
const J = (v: unknown) => JSON.stringify(v);

// ------------------------------------------------------------------ a deterministic world
function rng(seed: number) { let t = seed >>> 0; return () => { t += 0x6d2b79f5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
const COINS: Record<string, { sym: string; price: number; vol: number; mcap: number; c24: number }> = {
  BTC: { sym: 'BTC', price: 64000, vol: 3.1e10, mcap: 1.26e12, c24: 1.8 },
  ETH: { sym: 'ETH', price: 2500, vol: 1.4e10, mcap: 3.0e11, c24: -2.2 },
  SOL: { sym: 'SOL', price: 142.37, vol: 2.1e9, mcap: 6.6e10, c24: 4.1 },
  PEPE: { sym: 'PEPE', price: 0.0000091, vol: 6.0e8, mcap: 3.8e9, c24: -7.5 },
  MID: { sym: 'MID', price: 3.21, vol: 7.0e7, mcap: 9.0e8, c24: 0.4 },
  THIN: { sym: 'THIN', price: 0.412, vol: 8.0e6, mcap: 1.0e8, c24: 12 },
  DUST: { sym: 'DUST', price: 0.019, vol: 4.0e5, mcap: 2.0e7, c24: -1 },
  NOVOL: { sym: 'NOVOL', price: 7.7, vol: 0, mcap: 5.0e8, c24: 0 },
  NOTHING: { sym: 'NOTHING', price: 1.5, vol: 0, mcap: 0, c24: 0 },
};
let T = 1_780_000_000_000;
let px: Record<string, number> = {};
const resetPx = () => { px = Object.fromEntries(Object.values(COINS).map(c => [c.sym, c.price])); px.USDT = 1; };
resetPx();
const pairPrice = (b: string, q: string) => { const a = px[b], c = px[q || 'USDT']; return a && c ? a / c : 0; };
const pUSD = (s: string) => px[s] || 0;

function legacyCtx(extra: Record<string, unknown> = {}, seed = 7) {
  const r = rng(seed);
  const ctx = load('', { pairPrice, bySym: COINS, pUSD, ...extra });
  ctx.Date = { now: () => T };
  ctx.Math = Object.assign(Object.create(Math), { random: r });
  ctx.window = ctx;
  return ctx;
}
const run = (ctx: Record<string, any>, src: string) => vm.runInContext(src, ctx);

// ------------------------------------------------------------------ 1 · book / match
const CBX_SRC = cut('window.CBX=function(){"use strict";var LEVELS=40') + '()';

function engines(seed = 7) {
  const L = legacyCtx({}, seed); run(L, CBX_SRC);
  const r = rng(seed);
  const E = createBookEngine({ priceOf: pairPrice, statsOf: s => { const c = COINS[s]; return { vol24: c?.vol || 0, mcap: c?.mcap || 0, chg24: c?.c24 || 0, price: c?.price || 0 }; }, now: () => T, random: r });
  return { L: L.CBX, E };
}
const lv = (b: any) => ({ mid: b.mid, asks: b.asks.map((x: any) => [x.p, x.a]), bids: b.bids.map((x: any) => [x.p, x.a]) });

test('book: every level of every tier is bit-identical (9 markets × 2 quotes)', () => {
  const { L, E } = engines();
  for (const s of Object.keys(COINS)) for (const q of ['USDT', 'ETH']) {
    if (s === q) continue;
    assert.equal(J(lv(E.book(s, q))), J(lv(L.book(s, q))), s + '/' + q);
    assert.equal(E.depthUSD(s), L.depthUSD(s)); assert.equal(E.spreadBps(s), L.spreadBps(s));
  }
  assert.equal(J(E.book('NONE', 'USDT')), J(L.book('NONE', 'USDT')));
});

test('preview: identical across sizes, sides, limits, post-only and limit type', () => {
  const { L, E } = engines();
  for (const s of ['BTC', 'SOL', 'PEPE', 'THIN', 'NOVOL', 'NOTHING']) {
    const mid = pairPrice(s, 'USDT'), unit = 5000 / mid;
    for (const side of ['buy', 'sell'] as const) for (const k of [0.001, 0.4, 1, 3, 25, 400, 1e5]) for (const lim of [0, mid * 0.9995, mid, mid * 1.002, mid * 1.05]) for (const o of [{}, { type: 'limit' }, { postOnly: true }]) {
      const opts = { limit: lim, ...o };
      assert.equal(J(E.preview(s, 'USDT', side, unit * k, opts)), J(L.preview(s, 'USDT', side, unit * k, opts)), `${s} ${side} ${k} ${lim} ${J(o)}`);
    }
  }
});

test('execute: identical results AND identical book afterwards, incl. FOK / IOC / post-only rejects', () => {
  for (const s of ['BTC', 'SOL', 'PEPE', 'THIN', 'NOVOL']) {
    const { L, E } = engines(); const mid = pairPrice(s, 'USDT'), unit = 20000 / mid;
    for (const [side, k, opts] of [
      ['buy', 1, {}], ['sell', 3, { tif: 'IOC' }], ['buy', 50, { tif: 'FOK' }], ['buy', 0.2, { tif: 'FOK' }],
      ['buy', 2, { limit: mid * 1.0004 }], ['sell', 2, { limit: mid * 0.9990, tif: 'ioc' }],
      ['buy', 1, { limit: mid * 1.01, postOnly: true }], ['sell', 1, { limit: mid * 1.01, postOnly: true }], ['buy', 1e4, {}],
    ] as const) {
      assert.equal(J(E.execute(s, 'USDT', side, unit * k, opts)), J(L.execute(s, 'USDT', side, unit * k, opts)), `${s} ${side} ${k} ${J(opts)}`);
      assert.equal(J(lv(E.book(s, 'USDT'))), J(lv(L.book(s, 'USDT'))), 'book after ' + s);
      assert.equal(E.queueAhead(s, 'USDT', side, mid * (side === 'buy' ? 0.999 : 1.001)), L.queueAhead(s, 'USDT', side, mid * (side === 'buy' ? 0.999 : 1.001)));
    }
  }
});

test('healing: identical on the first look after a fill, at any delay (incl. across a rebuild)', () => {
  for (const dt of [0, 400, 1499, 1600, 3000, 5999, 6000, 9000]) {
    const { L, E } = engines(); const t0 = T;
    L.execute('SOL', 'USDT', 'buy', 800, {}); E.execute('SOL', 'USDT', 'buy', 800, {});
    T = t0 + dt;
    assert.equal(J(lv(E.book('SOL', 'USDT'))), J(lv(L.book('SOL', 'USDT'))), 'dt ' + dt);
    T = t0;
  }
});

test('healing DELIBERATELY changed: linear in time, independent of how often the book is read', () => {
  const t0 = T;
  const look = (every: number) => {
    const { L, E } = engines(); L.execute('SOL', 'USDT', 'buy', 800, {}); E.execute('SOL', 'USDT', 'buy', 800, {});
    for (let t = every; t <= 3000; t += every) { T = t0 + t; L.book('SOL', 'USDT'); E.book('SOL', 'USDT'); }
    T = t0 + 3000; const r = { L: L.book('SOL', 'USDT').asks[0].a, E: E.book('SOL', 'USDT').asks[0]!.a }; T = t0; return r;
  };
  const rare = look(3000), often = look(100);
  assert.equal(rare.E, often.E, 'the engine heals the same whether read once or 30 times');
  assert.notEqual(rare.L, often.L, 'the legacy book healed faster the more it was read');
  assert.ok(often.L > often.E, 'legacy over-healed under frequent reads');
});

test('tape: identical draws from the same random stream; no draw when the market is dead', () => {
  const { L, E } = engines(99);
  for (const s of ['BTC', 'NOVOL', 'NOTHING', 'THIN', 'NONE', 'SOL']) for (const dt of [0, 250, 4000]) assert.equal(E.tape(s, dt), L.tape(s, dt), s + ' ' + dt);
});

// ------------------------------------------------------------------ 2 · account transitions
const ACCT_SRC = ['function ensureEng(', 'function basisBuy(', 'function basisSell(', 'function execFill('].map(a => cut(a)).join('\n');
const CIRCUIT_EXEC = cut('window.__cbxFee=null,window.execFill=function(');

function freshS() { return { view: 'coin', bal: { USDT: 25000, ETH: 3 } as Record<string, number>, orders: [] as any[], txns: [] as any[] }; }

function recorder() {
  const log: unknown[] = [];
  return {
    log,
    fns: {
      toast: (...a: unknown[]) => { log.push(['toast', ...a]); },
      mt: (a: string, b: string) => { log.push(['mt', a, b]); return a + ' · ' + b; },
      cUSD: (n: number) => '$' + n.toFixed(2),
      logTxn: (...a: unknown[]) => { log.push(['txn', ...a]); },
      sfx: (k: string) => { log.push(['sfx', k]); }, fillFx: (k: string) => { log.push(['fx', k]); },
      fmt: (n: number) => String(+(+n).toPrecision(8)),
      saveP: () => { log.push(['save']); }, renderOrders: () => {}, updateNavBal: () => {}, renderPosition: () => {}, recalc: () => {}, drawCoinChart: () => {}, renderPortfolio: () => {},
    },
  };
}

/** Install the recorder's functions where the adapter looks for legacy functions (window === globalThis in the app). */
function useGlobals(fns: Record<string, unknown>, S: unknown) {
  const g = globalThis as any;
  Object.assign(g, fns, { pUSD, pairPrice, ensureEng: () => { const s = S as any; s.basis ||= {}; s.orders ||= []; s.stats ||= { wins: 0, losses: 0, feesUSD: 0, realizedUSD: 0, trades: 0 }; s.equityHist ||= []; } });
}

const realNow = Date.now;
function withClock<R>(f: () => R): R { Date.now = () => T; try { return f(); } finally { Date.now = realNow; } }

function sidePair() {
  const A = recorder(), B = recorder();
  const S1 = freshS(), S2 = freshS();
  const L = legacyCtx({ S: S1, ...A.fns }); run(L, ACCT_SRC);
  const N = legacyCtx({ S: S2, ...B.fns, DLAPP: { legacy: { paper: P } } });
  run(N, PATCH('execFill.base.js') + '\n' + PATCH('basisBuy.js') + '\n' + PATCH('basisSell.js') + '\n' + cut('function ensureEng('));
  return { A, B, S1, S2, L, N };
}

const OPS: [string, string, string, number, number][] = [
  ['buy', 'SOL', 'USDT', 10, 142.37], ['buy', 'SOL', 'USDT', 5.5, 150.02], ['sell', 'SOL', 'USDT', 4, 160], ['sell', 'SOL', 'USDT', 11.5, 130],
  ['sell', 'SOL', 'USDT', 0.1, 131], ['buy', 'BTC', 'USDT', 1, 64000], ['buy', 'PEPE', 'ETH', 5e7, 0.0000091 / 2500], ['sell', 'PEPE', 'ETH', 2e7, 0.00000001 / 2500 * 1000],
  ['buy', 'SOL', 'ETH', 3, 142.37 / 2500], ['sell', 'ETH', 'USDT', 1, 2600], ['sell', 'PEPE', 'ETH', 3e7, 0.0000091 / 2500], ['buy', 'MID', 'USDT', 100, 3.21],
  ['sell', 'MID', 'USDT', 100, 3.21], ['buy', 'THIN', 'USDT', 1e9, 0.4], ['sell', 'DUST', 'USDT', 1, 0.02], ['buy', 'SOL', 'USDT', 0, 140], ['buy', 'SOL', 'USDT', 1, 0],
];

test('execFill keeps legacy object identity: S.bal, S.stats, S.journal and each S.basis entry are mutated in place', () => {
  const { B, S2, N, S1, L } = sidePair();
  withClock(() => {
    L.execFill('buy', 'SOL', 'USDT', 2, 140); useGlobals(B.fns, S2); N.execFill('buy', 'SOL', 'USDT', 2, 140);
    const refs = (S: any) => ({ bal: S.bal, stats: S.stats, basisSOL: S.basis.SOL, basis: S.basis });
    const r1 = refs(S1), r2 = refs(S2);
    T += 1000; L.execFill('buy', 'SOL', 'USDT', 1, 150); useGlobals(B.fns, S2); N.execFill('buy', 'SOL', 'USDT', 1, 150);
    T += 1000; L.execFill('sell', 'SOL', 'USDT', 1, 160, 'x', true); useGlobals(B.fns, S2); N.execFill('sell', 'SOL', 'USDT', 1, 160, 'x', true);
    const j1 = (S1 as any).journal, j2 = (S2 as any).journal;
    T += 1000; L.execFill('sell', 'SOL', 'USDT', 1, 161, 'x', true); useGlobals(B.fns, S2); N.execFill('sell', 'SOL', 'USDT', 1, 161, 'x', true);
    for (const k of ['bal', 'stats', 'basisSOL', 'basis'] as const) assert.equal((refs(S2) as any)[k] === (r2 as any)[k], (refs(S1) as any)[k] === (r1 as any)[k], k + ' identity');
    assert.equal((S2 as any).journal === j2, (S1 as any).journal === j1, 'journal identity');
    assert.equal(J(S2), J(S1));
  });
});

test('execFill: a failing quote conversion aborts the fill, as the legacy call did (no silent $1 quote)', () => {
  const { B, S2, N } = sidePair();
  const before = J(S2);
  withClock(() => { useGlobals(B.fns, S2); (globalThis as any).pUSD = () => { throw new Error('rates down'); }; assert.throws(() => N.execFill('buy', 'SOL', 'USDT', 1, 140)); });
  (globalThis as any).pUSD = pUSD;
  assert.equal(J((S2 as any).bal), J(JSON.parse(before).bal), 'no balance moved'); assert.equal((S2 as any).stats.trades, 0);
});

test('execFill (base, 0.10% fee): every balance, basis, stat, journal row and effect identical over 17 fills', () => {
  const { A, B, S1, S2, L, N } = sidePair();
  withClock(() => OPS.forEach(([side, sym, q, amt, p], i) => {
    T += 60_000 * (i + 1);
    const r1 = L.execFill(side, sym, q, amt, p, 'x', i % 5 === 3);
    useGlobals(B.fns, S2);
    const r2 = N.execFill(side, sym, q, amt, p, 'x', i % 5 === 3);
    assert.equal(r2, r1, 'return ' + i);
    assert.equal(J(S2), J(S1), 'state after op ' + i);
  }));
  assert.equal(J(B.log), J(A.log), 'toasts and ledger writes');
  const kinds = (k: string) => A.log.filter(x => (x as unknown[])[0] === k).length;
  assert.ok(kinds('txn') >= 10 && kinds('toast') >= 2 && kinds('mt') >= 2, `scenario exercised fills (${kinds('txn')}) and P&L toasts (${kinds('toast')})`);
});

test('execFill (CIRCUIT fee override): identical at maker, taker and venue rates', () => {
  for (const f of [0.0008, 0.001, 0.0026, 0.006, 0.003]) {
    const { A, B, S1, S2, L, N } = sidePair();
    run(L, 'var _exec=execFill;' + CIRCUIT_EXEC + ';window.__cbxFee=' + f);
    run(N, 'var _exec=execFill;' + PATCH('execFill.cbx.js') + ';window.__cbxFee=' + f);
    withClock(() => OPS.forEach(([side, sym, q, amt, p], i) => {
      T += 1000;
      const r1 = L.window.execFill(side, sym, q, amt, p, 'limit', false);
      useGlobals(B.fns, S2);
      const r2 = N.window.execFill(side, sym, q, amt, p, 'limit', false);
      assert.equal(r2, r1); assert.equal(J(S2), J(S1), `fee ${f} op ${i}`);
    }));
    assert.equal(J(B.log), J(A.log));
  }
});

// ------------------------------------------------------------------ 3 · resting orders (base loop)
test('evalOrders (base): limit / sl / tp / trailing-stop triggers, fills and toasts identical over a price path', () => {
  const { A, B, S1, S2, L, N } = sidePair();
  run(L, cut('function evalOrders(){if(ensureEng(),!S.orders.length)return;const done=[]'));
  run(N, PATCH('evalOrders.base.js'));
  const seed = (S: any) => { S.bal.SOL = 20; S.bal.BTC = 0.02; S.orders = [
    { id: 'a', type: 'limit', side: 'buy', sym: 'SOL', quote: 'USDT', qty: 3, px: 138, t: 1 },
    { id: 'b', type: 'limit', side: 'sell', sym: 'SOL', quote: 'USDT', qty: 2, px: 149, t: 1 },
    { id: 'c', type: 'sl', side: 'sell', sym: 'BTC', quote: 'USDT', qty: 0.02, px: 61000, t: 1 },
    { id: 'd', type: 'tp', side: 'sell', sym: 'SOL', quote: 'USDT', qty: 50, px: 151, t: 1 },
    { id: 'e', type: 'tsl', side: 'sell', sym: 'SOL', quote: 'USDT', qty: 4, px: 130, trail: 3, hw: 142, t: 1 },
    { id: 'f', type: 'tsl', side: 'sell', sym: 'MID', quote: 'USDT', qty: 4, px: 1, t: 1 },
    { id: 'g', type: 'limit', side: 'buy', sym: 'BTC', quote: 'USDT', qty: 5, px: 62000, t: 1 },
    { id: 'h', type: 'mystery', side: 'buy', sym: 'SOL', quote: 'USDT', qty: 1, px: 1e9, t: 1 },
  ]; };
  seed(S1); seed(S2);
  const path = [[142, 64000], [139, 63000], [137.9, 62500], [146, 61900], [150, 60990], [152, 61000], [147.4, 61000], [144, 61000], [140, 61500]];
  withClock(() => path.forEach(([sol, btc], i) => {
    px.SOL = sol!; px.BTC = btc!; px.MID = 3.21 * (1 + 0.01 * i); T += 30_000;
    L.evalOrders(); useGlobals(B.fns, S2); N.evalOrders();
    assert.equal(J(S2), J(S1), 'after step ' + i);
  }));
  resetPx();
  assert.equal(J(B.log), J(A.log));
  assert.ok(S1.orders.length < 8, 'orders actually fired');
});

// ------------------------------------------------------------------ 4 · resting orders (CIRCUIT loop: queues and stops)
test('evalOrders (CIRCUIT): queued limits drain with the tape, stops fire through the book, stop-limits convert — identical', () => {
  const A = recorder(), B = recorder();
  const S1 = freshS(), S2 = freshS();
  const L = legacyCtx({ S: S1, ...A.fns, n: (v: number) => String(v) }, 11);
  run(L, ACCT_SRC + '\n' + CBX_SRC + ';\n' + cut('function evalOrders(){if(ensureEng(),!S.orders.length)return;const done=[]') +
    ';var _exec=execFill;' + CIRCUIT_EXEC + ';' + cut('function fillWith(') + ';var _eval=evalOrders,lastT=Date.now();' + cut('window.evalOrders=function(){try{ensureEng()}catch(e){}if(S.orders&&S.orders.length){var dt='));
  // new side: the real adapter CBX over the same world, seeded identically
  const r = rng(11); const realRandom = Math.random; Math.random = r;
  bind({ state: () => S2 as any, coin: s => COINS[s] as any });
  (globalThis as any).pairPrice = pairPrice;
  const N = legacyCtx({ S: S2, ...B.fns, n: (v: number) => String(v), DLAPP: { legacy: { paper: P } } }, 11);
  try {
    withClock(() => {
      run(N, cut('function ensureEng(') + '\n' + PATCH('basisBuy.js') + PATCH('basisSell.js') + PATCH('execFill.base.js') + ';window.CBX=DLAPP.legacy.paper.cbx();' +
        PATCH('evalOrders.base.js') + ';var _exec=execFill;' + PATCH('execFill.cbx.js') + ';' + cut('function fillWith(') + ';var _eval=evalOrders,lastT=Date.now();' + PATCH('evalOrders.cbx.js'));
      const seed = (S: any, cbx: any) => { S.bal.SOL = 40; S.orders = [
        { id: 'q1', type: 'limit', side: 'buy', sym: 'SOL', quote: 'USDT', qty: 30, px: 141.9, qAhead: cbx.queueAhead('SOL', 'USDT', 'buy', 141.9), q0: 1, orig: 30, t: 1 },
        { id: 'q2', type: 'limit', side: 'sell', sym: 'SOL', quote: 'USDT', qty: 12, px: 142.6, qAhead: 0, q0: 1, t: 1 },
        { id: 's1', type: 'stop', side: 'sell', sym: 'SOL', quote: 'USDT', qty: 9, px: 139.5, armAbove: false, t: 1 },
        { id: 's2', type: 'stopl', side: 'buy', sym: 'SOL', quote: 'USDT', qty: 5, px: 143.5, lim: 143.6, armAbove: true, t: 1 },
        { id: 'p1', type: 'limit', side: 'buy', sym: 'SOL', quote: 'USDT', qty: 1, px: 100, t: 1 },
      ]; };
      seed(S1, L.CBX); seed(S2, N.CBX);
      assert.equal(J(S2.orders), J(S1.orders), 'queue positions at placement');
      const path = [142.37, 141.8, 141.7, 141.9, 142.7, 143.6, 143.55, 143.5, 139.4, 139.0, 141.0, 99.9];
      path.forEach((p, i) => {
        px.SOL = p; T += 1500 + 250 * i;
        L.window.evalOrders(); useGlobals(B.fns, S2); N.window.evalOrders();
        assert.equal(J(S2), J(S1), 'after tick ' + i + ' @ ' + p);
      });
    });
  } finally { Math.random = realRandom; resetPx(); }
  assert.equal(J(B.log), J(A.log));
  assert.ok(A.log.filter(x => (x as unknown[])[0] === 'toast').length >= 3, 'fills and triggers actually happened');
});

// ------------------------------------------------------------------ 5 · venue table + thin-liquidity penalty
test('venue fee table: identical to the DLSIM literal it replaced; thin-liquidity penalty identical on every tier', () => {
  const src = v153(), a = src.indexOf('var VEN={binance:'), b = src.indexOf('};', a) + 2;
  const legacyVEN = vm.runInNewContext(src.slice(a, b) + ';VEN');
  assert.equal(J(VENUES), J(legacyVEN));
  const L = load(cut('function extraBp(sym){'), { bySym: {
    A: { vol: 0, mcap: 1 }, B: { vol: 1, mcap: 0 }, C: { vol: 5e5, mcap: 1e8 }, D: { vol: 2e6, mcap: 1e8 }, E: { vol: 5e6, mcap: 1e8 }, F: { vol: 9e6, mcap: 1e8 }, G: { vol: 3e9, mcap: 1e10 } } });
  for (const [k, c] of Object.entries({ A: [0, 1], B: [1, 0], C: [5e5, 1e8], D: [2e6, 1e8], E: [5e6, 1e8], F: [9e6, 1e8], G: [3e9, 1e10] }))
    assert.equal(thinLiquidityBps(c[0]!, c[1]!), L.extraBp(k), k);
  assert.equal(L.extraBp('NONE'), 2);
});
