/**
 * Ticket parity: the legacy CIRCUIT placeOrder (validation, stops, execution, remainder handling,
 * copy) against the view + usePaperEngine presenter that replaced it. Same world, same fields,
 * same clicks: the account, the resting orders, the book, the field state and the ordered log
 * of every legacy effect must match exactly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { cut, load } from './legacy';
import * as P from '../src/legacy/paper';
import * as Tk from '../src/legacy/ticket';
import { bind } from '../src/legacy/globals';

const PATCH = (f: string) => readFileSync(join(process.cwd(), '..', 'buildlib', 'patches', f), 'utf8');
const J = (v: unknown) => JSON.stringify(v);
function rng(seed: number) { let t = seed >>> 0; return () => { t += 0x6d2b79f5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }

const COINS: Record<string, any> = {
  SOL: { sym: 'SOL', price: 142.37, vol: 2.1e9, mcap: 6.6e10, c24: 4.1 },
  THIN: { sym: 'THIN', price: 0.412, vol: 8.0e6, mcap: 1.0e8, c24: 12 },
  NOPX: { sym: 'NOPX', vol: 1e6, mcap: 1e7, c24: 0 },
  ETH: { sym: 'ETH', price: 2500, vol: 1.4e10, mcap: 3.0e11, c24: -2.2 },
};
const px: Record<string, number> = { SOL: 142.37, THIN: 0.412, ETH: 2500, USDT: 1 };
// NOPX is listed but has no price yet: the real pairPrice answers NaN for it, not 0
const pairPrice = (b: string, q: string) => (b === 'NOPX' ? NaN : px[b] && px[q || 'USDT'] ? px[b]! / px[q || 'USDT']! : 0);
let T = 1_790_000_000_000;

function dom() {
  const el: Record<string, { value: string; textContent: string }> = {};
  for (const id of ['amt', 'limPx', 'stopPx', 'err']) el[id] = { value: '', textContent: '' };
  return { el, document: { getElementById: (id: string) => el[id] || null } };
}
function rec() {
  const log: unknown[] = [];
  const r = (name: string) => (...a: unknown[]) => { log.push([name, ...a]); };
  return { log, fns: {
    toast: r('toast'), mt: (a: string) => a, cUSD: (v: number) => '$' + v.toFixed(2), logTxn: r('txn'), sfx: r('sfx'), fillFx: r('fillFx'), bookImpulse: r('impulse'),
    saveP: r('save'), renderOrders: r('renderOrders'), updateNavBal: r('nav'), renderPosition: r('pos'), recalc: r('recalc'), drawCoinChart: r('chart'), renderPortfolio: r('pf'), CBXpreview: r('preview'),
    fmt: (v: number) => String(+(+v).toPrecision(8)),
  } };
}
function S0(side: 'buy' | 'sell', type: string, coin = 'SOL') { return { view: 'coin', coin, quote: 'USDT', side, ordType: type, bal: { USDT: 20000, SOL: 12 } as Record<string, number>, orders: [] as any[], txns: [] as any[] }; }

const holder: { S: any } = { S: null };
bind({ state: () => holder.S, coin: s => COINS[s] });

const BASE = ['function ensureEng(', 'function basisBuy(', 'function basisSell(', 'function execFill(', 'function placeAdvOrder('].map(a => cut(a)).join('\n');
const CIRCUIT = 'var _exec=execFill;' + cut('window.__cbxFee=null,window.execFill=function(') + ';' + cut('function fillWith(');
const LEG_PLACE = cut('window.placeOrder=function(){var t=S.ordType;if("dca"===t||"grid"===t)return _place.apply(this,arguments)');
const CBX_SRC = cut('window.CBX=function(){"use strict";var LEVELS=40') + '()';

interface Case { noDent?: true; expect?: string; name: string; side: 'buy' | 'sell'; type: string; amt: string; lim?: string; stop?: string; tif?: string; post?: boolean; reduce?: boolean; coin?: string; bal?: Record<string, number> }
const CASES: Case[] = [
  { expect: 'err:Enter an amount greater than zero.', name: 'no amount', side: 'buy', type: 'market', amt: '' },
  { name: 'limit without price', side: 'buy', type: 'limit', amt: '2' },
  { name: 'stop without trigger', side: 'sell', type: 'stop', amt: '2' },
  { name: 'stop-limit without limit', side: 'buy', type: 'stopl', amt: '2', stop: '150' },
  { name: 'reduce-only buy, nothing held', side: 'buy', type: 'market', amt: '2', reduce: true, bal: { USDT: 5000 } },
  { expect: 'Order filled', name: 'market buy, fills', side: 'buy', type: 'market', amt: '3' },
  { name: 'market sell, fills', side: 'sell', type: 'market', amt: '5' },
  { expect: 'Remainder working', name: 'market buy thin book GTC → partial + rests', side: 'buy', type: 'market', amt: '4000000', coin: 'THIN', bal: { USDT: 5e6 } },
  { expect: 'Remainder cancelled', name: 'market buy thin book IOC → remainder cancelled', side: 'buy', type: 'market', amt: '4000000', coin: 'THIN', tif: 'IOC', bal: { USDT: 5e6 } },
  { expect: 'Order rejected', name: 'market FOK too big → rejected', side: 'buy', type: 'market', amt: '4000000', coin: 'THIN', tif: 'FOK', bal: { USDT: 5e6 } },
  { expect: 'Partially filled', name: 'limit buy through the touch → partial + rests at limit', side: 'buy', type: 'limit', amt: '20000', lim: '142.40', bal: { USDT: 5e6 } },
  { name: 'limit buy below market → rests entirely', side: 'buy', type: 'limit', amt: '4', lim: '140' },
  { expect: 'Order rejected', name: 'post-only crossing → rejected', side: 'buy', type: 'limit', amt: '4', lim: '143', post: true },
  { expect: 'Remainder working', name: 'post-only resting → rests', side: 'sell', type: 'limit', amt: '4', lim: '143', post: true },
  { name: 'stop sell armed below', side: 'sell', type: 'stop', amt: '4', stop: '139' },
  { expect: 'Stop order armed', name: 'stop-limit buy armed above', side: 'buy', type: 'stopl', amt: '4', stop: '145', lim: '145.2' },
  { noDent: true, expect: 'err:Not enough USDT', name: 'unfunded buy', side: 'buy', type: 'market', amt: '500' },
  { noDent: true, name: 'unfunded sell', side: 'sell', type: 'market', amt: '50' },
];

for (const c of CASES) {
  test('ticket · ' + c.name, () => {
    T += 10_000;
    const make = (seed: number) => { const d = dom(); d.el.amt!.value = c.amt; d.el.limPx!.value = c.lim || ''; d.el.stopPx!.value = c.stop || ''; const S = S0(c.side, c.type, c.coin); if (c.bal) S.bal = { ...c.bal }; return { d, S, r: rec(), rand: rng(seed) }; };
    const A = make(5), B = make(5);
    const ctxOf = (x: ReturnType<typeof make>, extra: Record<string, unknown>) => {
      const ctx = load('', { pairPrice, bySym: COINS, pUSD: (s: string) => px[s] || 0, S: x.S, document: x.d.document, ...x.r.fns, TIF: c.tif || 'GTC', POST: !!c.post, REDUCE: !!c.reduce, _place: () => { x.r.log.push(['legacy-place']); }, ...extra });
      ctx.Date = { now: () => T }; ctx.Math = Object.assign(Object.create(Math), { random: x.rand }); ctx.window = ctx;
      vm.runInContext('var $=function(id){return document.getElementById(id)},n=function(v){return fmt(v)};', ctx);
      return ctx;
    };
    const L = ctxOf(A, {});
    vm.runInContext(BASE + ';' + CBX_SRC + ';' + CIRCUIT + ';' + LEG_PLACE, L);
    const N = ctxOf(B, { DLAPP: { legacy: { paper: P, ticket: Tk } } });
    P.cbx().reset();
    holder.S = B.S;
    const g = globalThis as any;
    const saved = { document: g.document, Date: Date.now };
    Object.assign(g, B.r.fns, { document: B.d.document, pairPrice, pUSD: (s: string) => px[s] || 0 });
    Date.now = () => T;
    try {
      vm.runInContext(cut('function ensureEng(') + ';' + cut('function placeAdvOrder(') + ';' + PATCH('basisBuy.js') + PATCH('basisSell.js') + PATCH('execFill.base.js') +
        ';window.CBX=DLAPP.legacy.paper.cbx();' + 'var _exec=execFill;' + PATCH('execFill.cbx.js') + ';' + cut('function fillWith(') + ';' + PATCH('placeOrder.cbx.js'), N);
      g.placeAdvOrder = N.placeAdvOrder; g.ensureEng = N.ensureEng;
      L.window.placeOrder();
      N.window.placeOrder();
      assert.equal(J(B.S), J(A.S), 'account and resting orders');
      assert.equal(J(B.d.el), J(A.d.el), 'ticket fields and error line');
      assert.equal(J(B.r.log), J(A.r.log), 'ordered effects');
      if (c.expect) {  // the scenario really exercised the path it is named after (checked on the LEGACY side)
        if (c.expect.startsWith('err:')) assert.ok(A.d.el.err!.textContent.startsWith(c.expect.slice(4)), A.d.el.err!.textContent);
        else assert.ok(A.r.log.some(x => (x as unknown[])[0] === 'toast' && (x as unknown[])[2] === c.expect), c.expect + ' in ' + J(A.r.log));
      }
      const bk = (b: any) => J({ a: b.asks.map((l: any) => [l.p, l.a]), b: b.bids.map((l: any) => [l.p, l.a]) });
      if (c.noDent) {
        // DELIBERATE (Phase 2.6): the account is checked BEFORE liquidity is consumed. The legacy
        // ticket ate the book for an order it then refused; the new one leaves the book untouched.
        const after = bk(N.CBX.book(c.coin || 'SOL', 'USDT'));
        P.cbx().reset();
        const untouched = bk(N.CBX.book(c.coin || 'SOL', 'USDT'));
        assert.notEqual(bk(L.CBX.book(c.coin || 'SOL', 'USDT')), untouched, 'the legacy ticket dented the book');
        assert.equal(after, untouched, 'the new ticket did not');
      } else assert.equal(bk(N.CBX.book(c.coin || 'SOL', 'USDT')), bk(L.CBX.book(c.coin || 'SOL', 'USDT')), 'book after');
    } finally { g.document = saved.document; Date.now = saved.Date; }
  });
}
