// DexLadder SOR gate — the Smart Order Routing desk (layers/53-sor.js, window.DLSOR, v165).
//
//   node test/gate-sor.js [dist/index.html]        exit code = number of failures
//
// Part A reads the shipped payload as text: the layer is there exactly once, it declares its
// build, it never writes the paper account by hand, it compiles nothing at runtime, it keeps no
// localStorage key of its own, it holds no CSS tokens, and it ships the disclosure that says
// what in its venue model is an assumption rather than a feed.
// Part B boots the payload in Chromium (mocked network) and treats DLSOR.quote / DLSOR.route as
// an oracle to be argued with: the same request must give the same answer, a bigger order must
// never fill cheaper, a buy must never fill under mid, a split must never cost more than the
// best single venue that could have filled it, gas must prune a leg it cannot pay for, size must
// be conserved or the shortfall named, the fee schedules must be the published ones, a quote
// must not touch the book, and a market that does not exist must come back missing, not zero.
'use strict';
const fs = require('fs'), path = require('path');
const WEB = path.join(__dirname, '..');
const file = process.argv[2] || path.join(WEB, 'dist', 'index.html');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 500) : '')); } };

/* ------------------------------------------------------------------ A · shipped payload */
console.log('A · shipped payload');
const html = fs.readFileSync(file, 'utf8');

// build154.py wraps every layers/*.js in its own <script> block, so the layer's whole text can
// be lifted out of the payload and every "not in the layer" assert can be scoped to it exactly,
// rather than to a fixed character window after the first mention of the name.
function layerOf(needle) {
  const parts = html.split('<script');
  for (let i = 1; i < parts.length; i++) {
    const end = parts[i].indexOf('</script');
    const body = end < 0 ? parts[i] : parts[i].slice(0, end);
    if (body.indexOf(needle) >= 0) return body;
  }
  return null;
}
const L = layerOf('window.DLSOR') || layerOf('DLSOR =') || layerOf('DLSOR') || '';
// The layer source is not in the staged tree, so nothing below is pinned to a spelling read out
// of 53-sor.js; every spelling asserted here is the house one taken from its sibling layers
// (20-core.js, 42-rewind.js, 45-defi.js, 50-health.js).
const SRC = fs.existsSync(path.join(WEB, 'layers', '53-sor.js'));

// A write to the paper account, and nothing else: `S.bal.USDT =`, `S.bal.USDT -=`,
// `S.bal["USDT"] =`. This is gate-desks.js:27's shape, tightened so that `S.bal.USDT == x`,
// `!=`, `<=` and `>=` are not read as assignments — reads of the account are fine.
const BAL_WRITE = /S\.bal\s*(\[[^\]]{0,60}\]|\.[A-Za-z_$][\w$]*)\s*(\+|-|\*|\/|\|\||&&|\?\?)?=[^=]/;

ok('sor · the layer ships in the payload exactly once (window.DLSOR =, the house spelling)',
  (html.match(/window\.DLSOR\s*=/g) || []).length === 1 && html.split('window.DLSOR =').length === 2,
  { assigns: (html.match(/window\.DLSOR\s*=/g) || []).length, mentions: html.split('DLSOR').length - 1, layerSourceOnDisk: SRC });
ok('sor · the layer declares its build in its own export (__v: 165)', /__v:\s*165\b/.test(L), { layerChars: L.length, sawV: (L.match(/__v:\s*\d+/g) || []).slice(0, 4) });
ok('sor · the desk never writes the paper account directly — no assignment to S.bal anywhere in the layer, only execFill and chargeNetwork',
  !BAL_WRITE.test(html.slice(Math.max(0, html.indexOf('DLSOR')), html.indexOf('DLSOR') < 0 ? 0 : html.indexOf('DLSOR') + 60000))
  && !BAL_WRITE.test(L) && /\bexecFill\s*\(/.test(L) && /\bchargeNetwork\s*\(/.test(L),
  { scopedWrite: (L.match(BAL_WRITE) || [])[0] || null, execFill: /\bexecFill\s*\(/.test(L), chargeNetwork: /\bchargeNetwork\s*\(/.test(L) });
ok('sor · the desk compiles nothing at runtime (no eval, no new Function, no string timer)',
  !/\beval\s*\(/.test(L) && !/new\s+Function\s*\(/.test(L) && !/\bset(Timeout|Interval)\s*\(\s*['"`]/.test(L),
  { eval: /\beval\s*\(/.test(L), fn: /new\s+Function\s*\(/.test(L), strTimer: /\bset(Timeout|Interval)\s*\(\s*['"`]/.test(L) });
ok('sor · no localStorage key of its own — state is the v154 bucket through DLCORE.X() and DLCORE.save() — and no token block in the JS',
  !/\blocalStorage\b/.test(L)
  && /\b(C|DLCORE)\.X\(\)/.test(L) && /\b(C|DLCORE)\.save\(\)/.test(L)
  && !/(:root|html\[data-mode=day\])\s*\{[^{}]*--[\w-]+\s*:/.test(L),
  { localStorage: /\blocalStorage\b/.test(L), bucket: /\b(C|DLCORE)\.X\(\)/.test(L), save: /\b(C|DLCORE)\.save\(\)/.test(L), tokens: /(:root|html\[data-mode=day\])\s*\{[^{}]*--[\w-]+\s*:/.test(L) });
ok('sor · the quote path is deterministic by construction — Math.random appears nowhere in the layer', !/Math\.random/.test(L), { hits: (L.match(/.{0,60}Math\.random.{0,40}/g) || []).slice(0, 3) });
ok('sor · the layer states what its venue model assumes — depth shares are an assumption, the book is modelled and not a venue feed (ASSUMPTIONS / METHOD ship with it)',
  /\bASSUMPTIONS\s*=/.test(L) && /\bMETHOD\s*=/.test(L)
  && /assum/i.test(L) && /model(l?ed|s)/i.test(L) && /(venue|exchange)\s+feed/i.test(L),
  { assumptions: /\bASSUMPTIONS\s*=/.test(L), method: /\bMETHOD\s*=/.test(L), assum: /assum/i.test(L), modelled: /model(l?ed|s)/i.test(L), feed: /(venue|exchange)\s+feed/i.test(L) });
ok('sor · anything the desk opens live is torn down on close — it sets __onClose, or it starts no interval at all',
  /__onClose/.test(L) || !/setInterval\s*\(/.test(L),
  { onClose: /__onClose/.test(L), setInterval: (L.match(/setInterval\s*\(/g) || []).length });
const academy = (html.match(/id:"academy"[\s\S]{0,8000}?\}\]\}/) || [''])[0];
ok('sor · Academy carries Execution on its section strip and opens the desk through the IA table (action DLSOR.open)',
  /action:\s*["']DLSOR\.open["']/.test(html) && !!academy && /action:\s*["']DLSOR\.open["']/.test(academy) && /Execution/.test(academy),
  { inPayload: /action:\s*["']DLSOR\.open["']/.test(html), academyChars: academy.length, inAcademy: !!academy && /action:\s*["']DLSOR\.open["']/.test(academy), label: /Execution/.test(academy) });
// v166: the build number is no longer pinned to a literal here. Pinning it made this gate
// fail on every release bump for a reason that has nothing to do with routing. What matters
// is the INVARIANT: exactly one build meta, exactly one visible stamp, and the stamp derived
// from that meta rather than typed — so the two cannot drift. The build is read, not asserted.
var _metas = html.match(/<meta name="cb:build" content="(v[^"]+)">/g) || [];
var _build = (_metas[0] || '').replace(/^.*content="/, '').replace(/">$/, '');
ok('sor · the visible stamp reads the build off the meta, so the two cannot drift (payload is ' + (_build || 'unstamped') + ')',
  _metas.length === 1 && /^v\d+[a-z]?$/.test(_build)
  && html.split('id="cbBuildTag"').length === 2
  && html.indexOf('cb:build"]\')||{}).content||"' + _build + '"') > 0,
  { meta: _metas.slice(0, 3), build: _build, stamp: html.split('id="cbBuildTag"').length - 1 });

/* ------------------------------------------------------------------ B · live oracle */
(async () => {
  console.log('\nB · runtime (Chromium, mocked network)');
  const { launch } = require('./harness');
  const hh = await launch(file, { viewport: { width: 1440, height: 900 } });
  const { page, errors } = hh;
  await page.waitForTimeout(6000);

  const r = await page.evaluate(async () => {
    const wait = ms => new Promise(res => setTimeout(res, ms));
    const out = { threw: [] };
    const guard = (tag, fn) => { try { return fn(); } catch (e) { out.threw.push(tag + ': ' + (e && e.message || e)); return null; } };
    try { openCoin('BTC'); } catch (e) {}
    await wait(1600);

    if (!window.DLSOR) { out.api = { has: false }; return out; }
    const BOOK = ['binance', 'coinbase', 'kraken', 'hyperliquid'];
    const ALL = BOOK.concat(['dexamm']);
    const req = o => Object.assign({ sym: 'BTC', quote: 'USDT', side: 'buy', base: 0.5, tolerancePct: 1, tier: 'medium', venues: ALL.slice() }, o || {});
    const byKey = q => { const m = {}; ((q && q.venues) || []).forEach(v => { m[v.key] = v; }); return m; };
    // a single venue priced for the WHOLE order — the only honest thing a split can be compared to
    const single = (rq, k) => { const q = DLSOR.quote(Object.assign({}, rq, { venues: [k] })); return ((q && q.venues) || [])[0] || null; };
    const TIME = { at: 1, t: 1, ts: 1, quotedAt: 1, asOf: 1 };
    const strip = q => JSON.stringify(((q && q.venues) || []).map(v => {
      const c = {}; Object.keys(v).sort().forEach(k => { if (!TIME[k]) c[k] = v[k]; }); return c;
    }));

    out.api = guard('api', () => ({
      has: true, v: DLSOR.__v,
      quote: typeof DLSOR.quote, route: typeof DLSOR.route, venues: typeof DLSOR.venues,
      curve: typeof DLSOR.curve, send: typeof DLSOR.send, log: typeof DLSOR.log, open: typeof DLSOR.open,
      method: Array.isArray(DLSOR.METHOD) && DLSOR.METHOD.length, assumptions: !!DLSOR.ASSUMPTIONS
    }));
    out.api = out.api || { has: true };
    out.api.openedOk = false;
    try { DLSOR.open('route'); await wait(500); out.api.openedOk = true; } catch (e) { out.threw.push('open: ' + (e && e.message || e)); }

    // 12 · determinism
    out.det = guard('det', () => {
      const rq = req(), a = DLSOR.quote(rq), b = DLSOR.quote(rq);
      return { same: strip(a) === strip(b), mid: a.mid === b.mid, n: ((a.venues) || []).length, keys: ((a.venues) || []).map(v => v.key) };
    });

    // a size that actually runs a venue out of book, found by probing rather than guessed
    out.bigBase = guard('bigBase', () => {
      let s = 1;
      for (let i = 0; i < 12; i++) {
        const q = DLSOR.quote(req({ base: s }));
        if (((q && q.venues) || []).some(v => v.exhausted === true)) return s;
        s *= 8;
      }
      return s;
    }) || 4096;

    // 13 · monotonicity
    out.mono = guard('mono', () => {
      const x = byKey(DLSOR.quote(req({ base: 0.25 }))), y = byKey(DLSOR.quote(req({ base: 1 })));
      return ALL.map(k => {
        const a = x[k], b = y[k];
        return { key: k, a: a && a.avg, b: b && b.avg,
          ok: !a || !b ? false : (a.avg == null || b.avg == null) ? false : b.avg >= a.avg - 1e-12 };
      });
    });

    // 14 · impact sign
    out.sign = guard('sign', () => {
      const qb = DLSOR.quote(req({ side: 'buy' })), qs = DLSOR.quote(req({ side: 'sell' }));
      return {
        midBuy: qb.mid, midSell: qs.mid,
        buy: ((qb.venues) || []).map(v => ({ key: v.key, avg: v.avg, ok: v.avg == null || v.avg >= qb.mid - 1e-9 })),
        sell: ((qs.venues) || []).map(v => ({ key: v.key, avg: v.avg, ok: v.avg == null || v.avg <= qs.mid + 1e-9 }))
      };
    });

    // 15 · the split is never worse than the best single venue
    out.split = guard('split', () => [0.05, 0.5, out.bigBase].map(sz => {
      const rq = req({ base: sz }), q = DLSOR.quote(rq), plan = DLSOR.route(q, rq);
      const cands = ALL.map(k => single(rq, k)).filter(v => v && v.allInQuote != null && v.filled >= sz - 1e-9);
      const best = cands.length ? Math.min.apply(null, cands.map(v => v.allInQuote)) : null;
      return { sz, plan: plan && plan.allInQuote, best, bestOf: cands.map(v => v.key),
        saved: plan && plan.savedVsBestSingleQuote, savedBps: plan && plan.savedBps,
        legs: ((plan && plan.legs) || []).map(l => l.key),
        ok: !plan || plan.allInQuote == null ? false : best == null ? true : plan.allInQuote <= best + 1e-6 };
    }));
    out.splitSell = guard('splitSell', () => {
      const rq = req({ side: 'sell', base: 0.5 }), q = DLSOR.quote(rq), plan = DLSOR.route(q, rq);
      const cands = ALL.map(k => single(rq, k)).filter(v => v && v.allInQuote != null && v.filled >= 0.5 - 1e-9);
      const best = cands.length ? Math.max.apply(null, cands.map(v => v.allInQuote)) : null;
      return { plan: plan && plan.allInQuote, best, ok: !plan || plan.allInQuote == null ? false : best == null ? true : plan.allInQuote >= best - 1e-6 };
    });

    // 16 · gas pruning — a tiny order cannot pay a fixed on-chain cost
    out.gas = guard('gas', () => {
      const rq = req({ base: 1e-4 }), q = DLSOR.quote(rq), plan = DLSOR.route(q, rq);
      const amm = single(rq, 'dexamm'), dropped = (plan && plan.dropped) || [];
      return {
        plan: plan && plan.allInQuote, amm: amm && amm.allInQuote, ammGas: amm && amm.gasQuote,
        legs: ((plan && plan.legs) || []).map(l => l.key),
        ammDropped: dropped.some(d => d.key === 'dexamm'),
        dropped: dropped.map(d => ({ key: d.key, reason: d.reason })),
        reasoned: dropped.every(d => typeof d.reason === 'string' && d.reason.length > 0)
      };
    });

    // 17 · conservation
    out.cons = guard('cons', () => [0.5, out.bigBase].map(sz => {
      const rq = req({ base: sz }), q = DLSOR.quote(rq), plan = DLSOR.route(q, rq);
      const vs = (q && q.venues) || [], legs = (plan && plan.legs) || [];
      const sum = legs.reduce((a, l) => a + (+l.base || 0), 0), short = sz - sum;
      const exhausted = vs.filter(v => v.exhausted === true).map(v => v.key);
      const rem = vs.reduce((a, v) => a + (+v.remaining || 0), 0);
      return { sz, sum, short, exhausted, remaining: plan && plan.remaining, venueRemaining: rem,
        ok: Math.abs(short) <= 1e-9
          || (short > 1e-9 && plan && plan.remaining != null && Math.abs(plan.remaining - short) <= 1e-9)
          || (short > 1e-9 && vs.length > 0 && vs.every(v => v.exhausted === true) && rem > 0) };
    }));

    // 18 · the published fee schedules, not a second copy
    out.fees = guard('fees', () => {
      const vs = DLSOR.venues() || [];
      return BOOK.map(k => {
        const v = vs.filter(x => x.key === k)[0] || null, f = DLAPP.paper.venueFees(k) || null;
        return { key: k, sor: v && v.feeRate, taker: f && f.taker, maker: f && f.maker,
          ok: !!v && !!f && Math.abs(v.feeRate - f.taker) <= 1e-12 };
      });
    });

    // 19 · a quote is a question, not a trade
    out.pure = guard('pure', () => {
      const bal0 = JSON.stringify(S.bal), tr0 = S.stats.trades, tx0 = S.txns.length;
      for (let i = 0; i < 5; i++) {
        const rq = req({ base: 0.1 * (i + 1) }), q = DLSOR.quote(rq);
        DLSOR.route(q, rq);
        try { DLSOR.curve(((q && q.venues) || [])[0], 8); } catch (e) {}
      }
      return { bal: JSON.stringify(S.bal) === bal0, trades: S.stats.trades === tr0, txns: S.txns.length === tx0,
        bal0: bal0.slice(0, 120), bal1: JSON.stringify(S.bal).slice(0, 120) };
    });

    // 20 · a market that does not exist comes back missing, not zero
    out.nope = guard('nope', () => {
      const q = DLSOR.quote(req({ sym: 'ZZZZNOPE' })), vs = (q && q.venues) || [];
      const notes = vs.length === 0
        ? (Array.isArray(q && q.notes) ? q.notes : (q && q.note ? [q.note] : []))
        : vs.reduce((a, v) => a.concat(v.notes || []), []);
      return { n: vs.length, mid: q && q.mid,
        zeros: vs.filter(v => v.avg === 0 || v.impactBps === 0 || v.allInQuote === 0).map(v => v.key),
        nulls: vs.every(v => v.avg === null && v.impactBps === null),
        notes: notes.slice(0, 4) };
    });

    try { DLCORE.close('dlSor'); } catch (e) {}
    out.overflow = document.documentElement.scrollWidth - innerWidth;
    return out;
  });

  const A = r.api || {}, every = (a, f) => Array.isArray(a) && a.length > 0 && a.every(f);
  ok('sor · the desk is live at v165 and its whole quote surface is callable (quote, route, venues, curve, send, log, open, METHOD, ASSUMPTIONS)',
    A.has === true && A.v === 165 && A.quote === 'function' && A.route === 'function' && A.venues === 'function'
    && A.curve === 'function' && A.send === 'function' && A.log === 'function' && A.open === 'function'
    && A.method >= 1 && A.assumptions === true && A.openedOk === true, [A, r.threw]);
  ok('sor · the same request gives the same quote — the venue table is identical byte for byte, timestamps aside',
    !!r.det && r.det.same === true && r.det.mid === true && r.det.n >= 5, r.det);
  ok('sor · there is no free lunch — a 4× order never fills at a better average on any venue, book or AMM',
    every(r.mono, v => v.ok === true), r.mono);
  ok('sor · impact has a sign — a buy never fills under mid, a sell never fills over it, on every venue',
    !!r.sign && every(r.sign.buy, v => v.ok === true) && every(r.sign.sell, v => v.ok === true), r.sign);
  ok('sor · the split is never worse than the best single venue (buy, 3 sizes including one that exhausts a venue; and a sell nets no less)',
    every(r.split, s => s.ok === true) && !!r.splitSell && r.splitSell.ok === true
    && every(r.split, s => s.saved == null || s.saved >= -1e-6), [r.split, r.splitSell, r.bigBase]);
  ok('sor · a fixed on-chain cost prunes the leg that cannot pay it — a tiny order never costs more than routing it all through the AMM, and every dropped leg carries its reason',
    !!r.gas && r.gas.reasoned === true && r.gas.amm != null && r.gas.plan != null && r.gas.plan <= r.gas.amm + 1e-6, r.gas);
  ok('sor · nothing is silently lost — the legs add up to the order, or the shortfall is named as remaining against an exhausted venue',
    every(r.cons, c => c.ok === true), r.cons);
  ok('sor · the fee schedules are the published ones — every book venue charges DLAPP.paper.venueFees(key).taker, not a second copy',
    every(r.fees, f => f.ok === true), r.fees);
  ok('sor · a quote is a question, not a trade — five quotes and five routes leave the balances, the trade count and the ledger untouched',
    !!r.pure && r.pure.bal === true && r.pure.trades === true && r.pure.txns === true, r.pure);
  ok('sor · a missing market stays missing — no market means null avg and null impact, or no venues and a note saying why, and never a 0 dressed as a price',
    !!r.nope && r.nope.mid !== 0 && r.nope.zeros.length === 0
    && ((r.nope.n === 0 && r.nope.notes.length > 0) || (r.nope.n > 0 && r.nope.nulls === true)), r.nope);
  ok('sor · the desk boots, quotes and routes with no page error and fits the width',
    errors.length === 0 && r.threw.length === 0 && r.overflow <= 1, [errors.slice(0, 3), r.threw.slice(0, 3), r.overflow]);
  await hh.close();

  console.log(`\n${pass} passed · ${fail} failed`);
  process.exit(fail);
})().catch(e => { console.error(e); process.exit(99); });
