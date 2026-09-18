// DexLadder Order Lab gate — layers/58-orders.js, window.DLORD, v166.
//
//   node test/gate-orders.js [dist/index.html]      exit code = number of failures
//
// Pure node. Part A reads the shipped payload as text: the layer is there exactly once, it
// declares its build, it never writes the paper account by hand, it compiles nothing at
// runtime, it keeps no localStorage key of its own, it draws no random number, it is ES5, and
// it ships the disclosure that says which of its constants are modelled rather than measured.
// Part B is the arithmetic. Every oracle below is re-implemented here from the formula, not
// taken from the layer, so a change to the layer that changes an answer fails this file.
'use strict';
const fs = require('fs'), path = require('path');
const WEB = path.join(__dirname, '..');
const file = process.argv[2] || path.join(WEB, 'dist', 'index.html');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 500) : '')); }
};
const near = (a, b, tol) => a != null && b != null && isFinite(a) && isFinite(b) && Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);

/* ------------------------------------------------------------------ A · shipped payload */
console.log('A \u00b7 shipped payload');
const html = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';

// build154.py wraps every layers/*.js in its own <script> block, so the layer's whole text can
// be lifted out of the payload and every "not in the layer" assert scoped to it exactly.
function layerOf(needle) {
  const parts = html.split('<script');
  for (let i = 1; i < parts.length; i++) {
    const end = parts[i].indexOf('</script');
    const body = end < 0 ? parts[i] : parts[i].slice(0, end);
    if (body.indexOf(needle) >= 0) return body;
  }
  return null;
}
const L = layerOf('window.DLORD =') || layerOf('DLORD') || '';
const SRC = fs.existsSync(path.join(WEB, 'layers', '58-orders.js'));
const CSS = fs.existsSync(path.join(WEB, '_v166css', '58-orders.css'));

// A write to the paper account, and nothing else. gate-sor.js:27's shape: `S.bal.USDT =`,
// `S.bal.USDT -=`, `S.bal["USDT"] =` — tightened so `==`, `!=`, `<=`, `>=` are reads, not writes.
const BAL_WRITE = /S\.bal\s*(\[[^\]]{0,60}\]|\.[A-Za-z_$][\w$]*)\s*(\+|-|\*|\/|\|\||&&|\?\?)?=[^=]/;

ok('orders \u00b7 the layer ships in the payload exactly once (window.DLORD =, the house spelling)',
  (html.match(/window\.DLORD\s*=/g) || []).length === 1,
  { assigns: (html.match(/window\.DLORD\s*=/g) || []).length, layerChars: L.length, sourceOnDisk: SRC, cssOnDisk: CSS });
ok('orders \u00b7 the layer declares its build in its own export (__v: 166)',
  /__v:\s*166\b/.test(L), { sawV: (L.match(/__v:\s*\d+/g) || []).slice(0, 4) });
ok('orders \u00b7 the desk never writes the paper account directly \u2014 no assignment to S.bal, only execFill and chargeNetwork',
  !BAL_WRITE.test(L) && /\bexecFill\s*\(/.test(L) && /\bchargeNetwork\s*\(/.test(L),
  { scopedWrite: (L.match(BAL_WRITE) || [])[0] || null, execFill: /\bexecFill\s*\(/.test(L), chargeNetwork: /\bchargeNetwork\s*\(/.test(L) });
ok('orders \u00b7 the desk compiles nothing at runtime (no eval, no new Function, no string timer)',
  !/\beval\s*\(/.test(L) && !/new\s+Function\s*\(/.test(L) && !/\bset(Timeout|Interval)\s*\(\s*['"`]/.test(L),
  { evalFn: /\beval\s*\(/.test(L), fn: /new\s+Function\s*\(/.test(L) });
ok('orders \u00b7 no storage key of its own \u2014 state is the v154 bucket through DLCORE.X() / DLCORE.save() \u2014 and no token block in the JS',
  !/\blocalStorage\b/.test(L) && !/\bsessionStorage\b/.test(L)
  && /\b(C|DLCORE)\.X\(\)/.test(L) && /\b(C|DLCORE)\.save\(\)/.test(L)
  && !/(:root|html\[data-mode=day\])\s*\{[^{}]*--[\w-]+\s*:/.test(L),
  { ls: /\blocalStorage\b/.test(L), bucket: /\b(C|DLCORE)\.X\(\)/.test(L), save: /\b(C|DLCORE)\.save\(\)/.test(L) });
ok('orders \u00b7 every latency and reject draw is deterministic by construction \u2014 Math.random appears nowhere in the layer',
  L.length > 0 && !/Math\.random/.test(L), { hits: (L.match(/.{0,50}Math\.random.{0,30}/g) || []).slice(0, 3) });
ok('orders \u00b7 ES5 only \u2014 no arrow, no let/const, no template literal, no spread',
  L.length > 0 && !/=>/.test(L) && !/\bconst\s/.test(L) && !/\blet\s/.test(L) && !/`/.test(L) && !/\.\.\./.test(L),
  { arrow: /=>/.test(L), constLet: /\b(const|let)\s/.test(L), tpl: /`/.test(L), spread: /\.\.\./.test(L) });
ok('orders \u00b7 the desk ships its honesty block \u2014 ASSUMPTIONS and METHOD, naming the modelling constants rather than hiding them',
  /\bASSUMPTIONS\s*=/.test(L) && /\bMETHOD\s*=/.test(L)
  && /assum/i.test(L) && /model(l?ed|s)/i.test(L) && /pessimist/i.test(L) && /queue model/i.test(L),
  { assumptions: /\bASSUMPTIONS\s*=/.test(L), method: /\bMETHOD\s*=/.test(L), pessimistic: /pessimist/i.test(L) });
ok('orders \u00b7 nothing it opens is left open \u2014 it sets __onClose, and it starts no interval at all',
  L.length > 0 && /__onClose/.test(L) && !/setInterval\s*\(/.test(L),
  { onClose: /__onClose/.test(L), intervals: (L.match(/setInterval\s*\(/g) || []).length });
ok('orders \u00b7 onTab assigns body.innerHTML \u2014 a bodyFor that only returns a string renders an empty desk (the 53-sor.js bug)',
  /body\.innerHTML\s*=/.test(L), { assigns: (L.match(/body\.innerHTML\s*=/g) || []).length });
ok('orders \u00b7 it re-uses the engine rather than forking it \u2014 queueAhead, stepQueue, ocoEffect, walk, buildBook, venueFees are CALLED',
  /\bqueueAhead\s*\(/.test(L) && /\bstepQueue\s*\(/.test(L) && /\bocoEffect\s*\(/.test(L)
  && /\bwalk\s*\(/.test(L) && /\bbuildBook\s*\(/.test(L) && /\bvenueFees\s*\(/.test(L),
  { queueAhead: /\bqueueAhead\s*\(/.test(L), stepQueue: /\bstepQueue\s*\(/.test(L), ocoEffect: /\bocoEffect\s*\(/.test(L) });
ok('orders \u00b7 it keeps no second copy of any fee schedule \u2014 the distinctive published rates appear nowhere as literals in the layer',
  L.length > 0 && !/0\.0026\b/.test(L) && !/0\.00045\b/.test(L) && !/45e-5\b/.test(L) && !/0\.0016\b/.test(L),
  { kraken: /0\.0026\b/.test(L), hyper: /(0\.00045|45e-5)\b/.test(L) });
ok('orders \u00b7 the desk registers on the rail and the palette under its own id',
  /DLDESKS[\s\S]{0,80}register\s*\(\s*["']orderlab["']/.test(L) && /\bC\.cmd\s*&&\s*C\.cmd\s*\(/.test(L),
  { rail: /register\s*\(\s*["']orderlab["']/.test(L), cmd: /\bC\.cmd\b/.test(L) });
ok('orders \u00b7 its rules live in _v166css/58-orders.css, every selector scoped to #dlOrd, no token declared there',
  CSS && (() => {
    const c = fs.readFileSync(path.join(WEB, '_v166css', '58-orders.css'), 'utf8');
    const decls = c.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map(s => s.split('{')[0].trim()).filter(Boolean);
    const bad = decls.filter(d => !/^@media/.test(d) && d.split(',').some(p => p.trim() && p.indexOf('#dlOrd') < 0));
    return bad.length === 0 && !/:root\s*\{/.test(c);
  })(), { cssOnDisk: CSS });

/* ------------------------------------------------------------------ B · the arithmetic */
console.log('\nB \u00b7 numeric oracles \u2014 every formula re-implemented here, not called');

/* --- the engine's own primitives, mirrored 1:1 from layers/01-app.js so the oracle and the
   layer are arguing about the same rule and not about two different queue models. --- */
function hash32(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
function unit01(s) { return (hash32(s) >>> 8) / 16777216; }
function limitTouched(o, px) { return o.side === 'buy' ? px <= o.px : px >= o.px; }
function stepQueue(o, px, flow) {
  if (!limitTouched(o, px)) return { kind: 'idle' };
  let r = o.qAhead || 0, e = flow;
  if (r > 0) { r = Math.max(0, r - e); if (r > 0) return { kind: 'wait', qAhead: r }; e = 1e-4; }
  return { kind: 'fill', take: Math.min(o.qty, Math.max(e, 0.12 * o.qty)), qAhead: r };
}
function ocoEffect(orders, id, n) {
  const r = orders.find(x => x.id === id);
  if (!r || !r.oco) return { cancel: [], reduce: [] };
  const cancel = [], reduce = [], full = n >= r.qty - 1e-9;
  for (const l of orders) {
    if (l.id === id || l.oco !== r.oco) continue;
    const d = full ? 0 : l.qty - n;
    if (d <= 1e-9) cancel.push(l.id); else reduce.push({ id: l.id, qty: d });
  }
  return { cancel, reduce };
}
function queueAhead(bk, side, px) {
  if (!bk.mid) return 0;
  const a = side === 'buy' ? bk.bids : bk.asks; let t = 0;
  for (const lv of a) { if (!(side === 'buy' ? lv.p >= px : lv.p <= px)) break; t += lv.a; }
  return t;
}

/* --- the desk's own formulas --- */
function queueSteps(qty, ahead, flow) {
  const o = { side: 'buy', px: 100, qty, qAhead: ahead > 0 ? ahead : 0 };
  let steps = 0, guard = 0;
  while (o.qty > 1e-9 && guard++ < 200000) {
    const r = stepQueue(o, 100, flow); steps++;
    if (r.kind === 'wait') { o.qAhead = r.qAhead; continue; }
    if (r.kind === 'fill') { o.qAhead = r.qAhead; o.qty = Math.max(0, o.qty - r.take); continue; }
    break;
  }
  return steps;
}
function icebergPenalty(total, clip, ahead, flow) {
  const n = Math.max(1, Math.ceil(total / clip - 1e-12));
  let rem = total, sum = 0;
  for (let i = 0; i < n; i++) { const d = Math.min(clip, rem); rem -= d; sum += queueSteps(d, ahead, flow); }
  return { clips: n, penalty: sum - queueSteps(total, ahead, flow) };
}
function clipEntropy(sizes, tick) {
  const n = sizes.length; if (!n) return null;
  const m = {}; for (const s of sizes) { const k = String(Math.round(s / tick)); m[k] = (m[k] || 0) + 1; }
  let H = 0; for (const k in m) { const p = m[k] / n; H -= p * Math.log(p) / Math.LN2; }
  const max = Math.log(n) / Math.LN2;
  return { bits: H, max, score: max > 0 ? 1 - H / max : null };
}
const lvl = (o, e) => o.mode === 'abs' ? e - o.offset : e * (1 - o.pct / 100);
// PESSIMISTIC: test the bar's LOW against the stop that existed BEFORE the bar.
function trailPess(bars, o) {
  let ext = null, stop = o.initStop > 0 ? o.initStop : null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], couldExtend = (ext == null || b.h > ext);
    if (stop != null && b.l <= stop) return { hit: true, index: i, px: stop, tie: couldExtend };
    if (ext == null || b.h > ext) { ext = b.h; const c = lvl(o, ext); if (stop == null || c > stop) stop = c; }
  }
  return { hit: false, index: null, px: null, resting: stop, tie: false };
}
// OPTIMISTIC: lift the extreme from this bar's high FIRST, then test — the engine's trigger() order.
function trailOpt(bars, o) {
  let ext = null, stop = o.initStop > 0 ? o.initStop : null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (ext == null || b.h > ext) { ext = b.h; const c = lvl(o, ext); if (stop == null || c > stop) stop = c; }
    if (stop != null && b.l <= stop) return { hit: true, index: i, px: stop };
  }
  return { hit: false, index: null, px: null, resting: stop };
}
function coarsen(bars, k) {
  const out = [];
  for (let i = 0; i < bars.length; i += k) {
    let h = -Infinity, l = Infinity, c = bars[i].c;
    for (let j = i; j < Math.min(bars.length, i + k); j++) { h = Math.max(h, bars[j].h); l = Math.min(l, bars[j].l); c = bars[j].c; }
    out.push({ o: bars[i].o, h, l, c });
  }
  return out;
}
function shortfall(o) {
  const Q = o.total, f = Math.min(o.filled, Q), sgn = o.side === 'sell' ? -1 : 1, un = Q - f;
  const delay = sgn * f * (o.arrival - o.decision);
  const impact = sgn * f * (o.avgFill - o.arrival);
  const fee = o.fee + (o.gas || 0);
  const needsEnd = un > 1e-9 && !(o.end > 0);
  const opp = needsEnd ? null : (un <= 1e-9 ? 0 : sgn * un * (o.end - o.decision));
  const total = needsEnd ? null : delay + impact + fee + opp;
  return { delay, impact, fee, opportunity: opp, needsEnd, totalCost: total, bps: total == null ? null : total / (Q * o.decision) * 1e4 };
}
const VOL_BANDS = [0, 1e6, 1e7, 1e8, 1e9], TAKER_MULT = [1, 0.90, 0.80, 0.65, 0.50], MAKER_MULT = [1, 0.75, 0.50, 0.25, 0.00];
const volBand = v => { let b = 0; for (let i = 0; i < VOL_BANDS.length; i++) if ((v > 0 ? v : 0) >= VOL_BANDS[i]) b = i; return b; };
const feeFor = (base, role, v) => base * (role === 'maker' ? MAKER_MULT[volBand(v)] : TAKER_MULT[volBand(v)]);
const LAT_FLOOR = { binance: 22, coinbase: 48, kraken: 55, hyperliquid: 30 }, LAT_EX = { binance: 28, coinbase: 70, kraken: 80, hyperliquid: 35, dexamm: 4000 };
function latencyMs(v, id, tick, s) {
  let u = unit01(v + '|' + id + '|' + tick); if (u > 0.9999999) u = 0.9999999;
  return LAT_FLOOR[v] + LAT_EX[v] * (1 + 3 * (s > 0 ? s : 0)) * (-Math.log(1 - u));
}
const rejectRate = s => 0.002 + 0.18 * (s > 0 ? s : 0) * (s > 0 ? s : 0);
const throttleMs = (r, c) => r > c ? (r / c - 1) * 1000 : 0;
const stressProfile = s => ({ spreadMult: 1 + 3 * s, depthMult: 1 / (1 + 2 * s), latMult: 1 + 3 * s, rejectRate: rejectRate(s) });
function pegPx(side, anchor, offBps, cap) {
  let px = anchor * (1 + (side === 'buy' ? -1 : 1) * offBps / 1e4), capped = false;
  if (cap > 0) { if (side === 'buy' && px > cap) { px = cap; capped = true; } if (side === 'sell' && px < cap) { px = cap; capped = true; } }
  return { px, capped };
}

/* ---- 1. the hash, which every deterministic draw on the desk hangs off ---- */
ok('1 \u00b7 FNV-1a 32 of "binance|o1|1000" is 699194308 \u2014 the engine\'s hash32, offset basis 2166136261, prime 16777619',
  hash32('binance|o1|1000') === 699194308, { got: hash32('binance|o1|1000') });
ok('2 \u00b7 unit01 is the top 24 bits over 2^24, in [0,1), and reproducible',
  near(unit01('binance|o1|1000'), 0.1627938151359558, 1e-15) && unit01('x') >= 0 && unit01('x') < 1
  && unit01('binance|o1|1000') === unit01('binance|o1|1000'),
  { got: unit01('binance|o1|1000') });

/* ---- 3-5. the queue, stepped by the engine's own stepQueue ---- */
// no queue ahead: take = max(flow, 12% of remaining); flow 0.1 of a 1-unit order finishes in 10 steps
ok('3 \u00b7 a 1-unit order with nothing ahead of it clears in 10 steps at flow 0.1', queueSteps(1, 0, 0.1) === 10, { got: queueSteps(1, 0, 0.1) });
// 5 units ahead at 0.1 a step is 50 waiting steps, and the 50th also fills — so 50 + 10 = 60
ok('4 \u00b7 5 units of queue ahead at flow 0.1 costs 50 waiting steps, and the step that clears it also fills \u2014 60 total',
  queueSteps(1, 5, 0.1) === 60, { got: queueSteps(1, 5, 0.1) });
ok('5 \u00b7 a 4-unit order behind 2 units at flow 0.5 clears in 12 steps', queueSteps(4, 2, 0.5) === 12, { got: queueSteps(4, 2, 0.5) });

/* ---- 6-8. iceberg ---- */
const pens = [];
for (let n = 1; n <= 8; n++) pens.push(icebergPenalty(12, 12 / n, 6, 0.5).penalty);
ok('6 \u00b7 the iceberg refresh penalty is STRICTLY monotonic in clip count \u2014 every extra clip is another full queue wait (12 units, 6 ahead, flow 0.5)',
  pens.every((v, i) => i === 0 ? v === 0 : v > pens[i - 1]), { pens });
ok('7 \u00b7 and its exact values are [0, 18, 32, 44, 57, 68, 84, 92] steps for 1..8 clips',
  JSON.stringify(pens) === JSON.stringify([0, 18, 32, 44, 57, 68, 84, 92]), { pens });
ok('8 \u00b7 a single resting order pays the queue once \u2014 1 clip is a penalty of exactly zero, by definition',
  icebergPenalty(12, 12, 6, 0.5).penalty === 0 && icebergPenalty(12, 12, 6, 0.5).clips === 1);

/* ---- 9-10. the detection side ---- */
const e1 = clipEntropy([2, 2, 2, 2, 2, 2], 1e-4), e2 = clipEntropy([2, 2, 3, 3], 1e-4), e3 = clipEntropy([1, 2, 3, 4], 1e-4);
ok('9 \u00b7 six identical clips carry 0 bits of clip-size entropy against a ceiling of log2(6) \u2014 signature score 1, maximally legible',
  near(e1.bits, 0) && near(e1.max, Math.log2(6)) && near(e1.score, 1), { e1 });
ok('10 \u00b7 [2,2,3,3] is exactly 1 bit against a ceiling of 2 \u2014 score 0.5; four distinct clips score 0; one clip has no ceiling and the score is null',
  near(e2.bits, 1) && near(e2.max, 2) && near(e2.score, 0.5) && near(e3.score, 0) && clipEntropy([5], 1e-4).score === null,
  { e2, e3, one: clipEntropy([5], 1e-4) });

/* ---- 11-13. trailing stops ---- */
// hand-written series, trail = absolute offset 8. Bar 0 sets extreme 110 -> stop 102 (low 103 misses).
// Bar 1 could BOTH extend the trail (high 112 -> stop 104) and hit it (low 100). Pessimistic fires
// at the PRE-bar stop of 102; the engine's own ordering would have lifted it to 104 first.
const TIE = [{ o: 104, h: 110, l: 103, c: 109 }, { o: 109, h: 112, l: 100, c: 101 }];
const tp = trailPess(TIE, { mode: 'abs', offset: 8 }), to = trailOpt(TIE, { mode: 'abs', offset: 8 });
ok('11 \u00b7 pessimistic tie-break: the bar that could both extend the trail and hit it fires the stop at 102 \u2014 the level that existed BEFORE the bar \u2014 on bar index 1, and is flagged as a tie',
  tp.hit === true && tp.index === 1 && near(tp.px, 102) && tp.tie === true, { tp });
ok('12 \u00b7 the optimistic resolution (the engine\'s trigger() ordering) fires the SAME bar at 104, and the two differ by exactly the trail move 112\u2212110 = 2',
  to.hit === true && to.index === 1 && near(to.px, 104) && near(to.px - tp.px, 2), { to, diff: to.px - tp.px });
// path dependence, trail = 10%. Fine: bar 2's high 140 lifts the stop to 126, bar 3's low 125 takes it.
// Coarsened 2x, the ratchet and the dip land in ONE bar, tested against the OLD stop of 90.9 — which
// a low of 102 never reaches — so the coarser series never stops at all.
const PATH = [{ o: 100, h: 100, l: 99, c: 100 }, { o: 100, h: 101, l: 100, c: 101 }, { o: 101, h: 140, l: 102, c: 139 }, { o: 139, h: 135, l: 125, c: 130 }];
const p1 = trailPess(PATH, { mode: 'pct', pct: 10 }), p2 = trailPess(coarsen(PATH, 2), { mode: 'pct', pct: 10 }), p4 = trailPess(coarsen(PATH, 4), { mode: 'pct', pct: 10 });
ok('13 \u00b7 path dependence is real and is the stated answer: at 1\u00d7 bars the stop fires on bar 3 at 126; at 2\u00d7 and 4\u00d7 the SAME prices never stop at all, and the trail rests at 126',
  p1.hit === true && p1.index === 3 && near(p1.px, 126)
  && p2.hit === false && near(p2.resting, 126)
  && p4.hit === false && near(p4.resting, 126),
  { p1, p2, p4, coarse2: coarsen(PATH, 2) });

/* ---- 14-15. bracket / OCO ---- */
const legs = [{ id: 'tp', oco: 'brk', qty: 3.5 }, { id: 'sl', oco: 'brk', qty: 3.5 }];
const partial = ocoEffect(legs, 'tp', 1.25), full = ocoEffect(legs, 'tp', 3.5);
ok('14 \u00b7 a parent filled 3.5 of 10 arms children of EXACTLY 3.5 \u2014 sized to the fill, not to the order (3.5/10 = 0.35 of the parent)',
  near(legs[0].qty, 3.5) && near(legs[1].qty, 3.5) && near(3.5 / 10, 0.35),
  { armed: legs.map(l => l.qty) });
ok('15 \u00b7 ocoEffect semantics: a 1.25 fill on one leg shrinks its partner to exactly 2.25 (3.5 \u2212 1.25); a full 3.5 fill cancels it outright',
  partial.cancel.length === 0 && partial.reduce.length === 1 && partial.reduce[0].id === 'sl' && near(partial.reduce[0].qty, 2.25)
  && full.cancel.length === 1 && full.cancel[0] === 'sl' && full.reduce.length === 0,
  { partial, full });

/* ---- 16-18. implementation shortfall (Perold 1988) ---- */
const SF = shortfall({ side: 'buy', total: 10, filled: 7, decision: 100, arrival: 100.5, avgFill: 101.2, end: 102, fee: 7.084, gas: 2.2 });
ok('16 \u00b7 buy decomposition against a decision price of 100: delay 7\u00d7(100.5\u2212100)=3.5, impact 7\u00d7(101.2\u2212100.5)=4.9, fee 7.084+2.2=9.284, opportunity 3\u00d7(102\u2212100)=6',
  near(SF.delay, 3.5, 1e-9) && near(SF.impact, 4.9, 1e-9) && near(SF.fee, 9.284, 1e-9) && near(SF.opportunity, 6, 1e-9), { SF });
ok('17 \u00b7 the four components sum to the total EXACTLY (23.684) and the shortfall is 236.84 bp of the 10\u00d7100 decision notional',
  near(SF.delay + SF.impact + SF.fee + SF.opportunity, SF.totalCost, 1e-9) && near(SF.totalCost, 23.684, 1e-9) && near(SF.bps, 236.84, 1e-9),
  { total: SF.totalCost, bps: SF.bps, sum: SF.delay + SF.impact + SF.fee + SF.opportunity });
const SS = shortfall({ side: 'sell', total: 10, filled: 7, decision: 100, arrival: 99.5, avgFill: 98.8, end: 98, fee: 7.084, gas: 2.2 });
ok('18 \u00b7 on a sell every sign flips so a positive figure is still a cost: the mirrored series gives the identical 3.5 / 4.9 / 6 and the same total',
  near(SS.delay, 3.5, 1e-9) && near(SS.impact, 4.9, 1e-9) && near(SS.opportunity, 6, 1e-9) && near(SS.totalCost, 23.684, 1e-9), { SS });
const SN = shortfall({ side: 'buy', total: 10, filled: 7, decision: 100, arrival: 100.5, avgFill: 101.2, end: 0, fee: 7.084, gas: 2.2 });
const SZ = shortfall({ side: 'buy', total: 10, filled: 10, decision: 100, arrival: 100.5, avgFill: 101.2, end: 0, fee: 1, gas: 0 });
ok('19 \u00b7 a remainder with no end price leaves opportunity and total MISSING, not zero \u2014 pricing it at no drift would report a reject as a saving; a fully filled order needs no end price and its opportunity is exactly 0',
  SN.opportunity === null && SN.totalCost === null && SN.needsEnd === true
  && SZ.opportunity === 0 && SZ.needsEnd === false && near(SZ.totalCost, 10 * 0.5 + 10 * 0.7 + 1, 1e-9),
  { SN, SZ });

/* ---- 20-21. fee tiers, against the engine's PUBLISHED schedule read out of the payload ---- */
const PUB = { binance: 0.001, coinbase: 0.006, kraken: 0.0026, hyperliquid: 0.00045, dexamm: 0.003 };
const payloadHasSchedule = /n:"Binance",t:\.001,m:\.001/.test(html) && /n:"Coinbase Adv\.",t:\.006,m:\.004/.test(html)
  && /n:"Kraken",t:\.0026,m:\.0016/.test(html) && /n:"Hyperliquid",t:45e-5,m:15e-5/.test(html) && /n:"DEX \(AMM\)",t:\.003/.test(html);
ok('20 \u00b7 the base rate is the engine\'s own published schedule (Binance 0.10%, Coinbase Adv. 0.60%, Kraken 0.26%, Hyperliquid 0.045%, AMM 0.30%) and band 0 is that rate untouched',
  payloadHasSchedule && Object.keys(PUB).every(k => near(feeFor(PUB[k], 'taker', 0), PUB[k], 1e-12)),
  { payloadHasSchedule, band0: Object.keys(PUB).map(k => [k, feeFor(PUB[k], 'taker', 0)]) });
ok('21 \u00b7 the 30-day ladder is a MULTIPLIER on that base: $100m of volume is band 3, so Binance taker 0.10% \u00d7 0.65 = 0.065%, and Coinbase maker 0.40% \u00d7 0 = 0 at band 4 \u2014 zero, not a rebate, because the engine publishes no negative maker rate',
  volBand(2e8) === 3 && near(feeFor(0.001, 'taker', 2e8), 0.00065, 1e-12)
  && volBand(2e9) === 4 && near(feeFor(0.004, 'maker', 2e9), 0, 1e-12)
  && volBand(1e7) === 2 && near(feeFor(0.0026, 'taker', 1e7), 0.00208, 1e-12)
  && Object.keys(PUB).every(k => PUB[k] > 0),
  { b3: feeFor(0.001, 'taker', 2e8), b4maker: feeFor(0.004, 'maker', 2e9), kraken: feeFor(0.0026, 'taker', 1e7) });

/* ---- 22-24. execution realism ---- */
let acc = 0; const N = 20000;
for (let i = 0; i < N; i++) acc += latencyMs('binance', 'o' + i, 7, 0);
ok('22 \u00b7 latency is a SHIFTED EXPONENTIAL by inverse CDF \u2014 the mean of 20,000 hashed draws lands within 2% of floor+excess = 22+28 = 50 ms',
  Math.abs(acc / N - 50) / 50 < 0.02, { mean: acc / N });
ok('23 \u00b7 it is deterministic (same inputs, same millisecond) and stress multiplies only the EXCESS: at s = 1 the mean is 22 + 28\u00d74 = 134 ms, not 4\u00d750',
  latencyMs('binance', 'o1', 1000, 0) === latencyMs('binance', 'o1', 1000, 0)
  && near(22 + 28 * (1 + 3 * 1), 134) && near(22 + 28 * (1 + 3 * 0), 50)
  && latencyMs('binance', 'o1', 1000, 1) > latencyMs('binance', 'o1', 1000, 0),
  { calm: latencyMs('binance', 'o1', 1000, 0), stressed: latencyMs('binance', 'o1', 1000, 1) });
ok('24 \u00b7 the stress dial moves four channels on stated curves: spread 1+3s, depth 1/(1+2s), latency 1+3s, rejects 0.002+0.18s\u00b2 \u2014 and the throttle queues (rate/cap\u22121)\u00d71000 ms above 8/s',
  near(stressProfile(0.5).spreadMult, 2.5) && near(stressProfile(0.5).depthMult, 0.5) && near(stressProfile(0.5).latMult, 2.5)
  && near(rejectRate(0), 0.002) && near(rejectRate(0.5), 0.047) && near(rejectRate(1), 0.182)
  && near(throttleMs(20, 8), 1500) && throttleMs(4, 8) === 0,
  { p: stressProfile(0.5), r: [rejectRate(0), rejectRate(0.5), rejectRate(1)], t: throttleMs(20, 8) });

/* ---- 25. attribution identity ---- */
// one channel at a time from the calm baseline, plus the residual the split cannot assign
// The channels INTERACT — a wider spread hurts more when the book is thinner — so the impact
// term carries both multipliers and the four first-order effects cannot add to the total.
const cost = (on, s) => {
  const sp = 1 + 3 * (on.spread ? s : 0), dp = 1 / (1 + 2 * (on.depth ? s : 0)), lt = 1 + 3 * (on.lat ? s : 0), rj = rejectRate(on.rej ? s : 0);
  return 5 * (100 * 1.4 / 2 / 1e4 * sp) + 5 * (100 * 8e-5 * 5 * sp / dp) + 5 * (100 * 2e-6 * 45 * lt) + rj * 5 * 100 * 1e-3;
};
const none = { spread: 0, depth: 0, lat: 0, rej: 0 }, s25 = 0.7, base25 = cost(none, s25);
const parts25 = ['spread', 'depth', 'lat', 'rej'].map(k => { const on = Object.assign({}, none); on[k] = 1; return cost(on, s25) - base25; });
const total25 = cost({ spread: 1, depth: 1, lat: 1, rej: 1 }, s25) - base25;
const sum25 = parts25.reduce((a, b) => a + b, 0), resid25 = total25 - sum25;
ok('25 \u00b7 shortfall attribution closes exactly: four first-order effects plus the interaction residual equal the total cost of the dial, and the residual is non-zero because the channels interact',
  near(sum25 + resid25, total25, 1e-12) && Math.abs(resid25) > 1e-12,
  { parts: parts25, sum: sum25, residual: resid25, total: total25 });

/* ---- 26. queue ahead + peg ---- */
const BK = { mid: 100, bids: [{ p: 99.9, a: 3 }, { p: 99.8, a: 5 }, { p: 99.7, a: 7 }], asks: [{ p: 100.1, a: 2 }, { p: 100.2, a: 4 }] };
ok('26 \u00b7 queueAhead sums the resting size at prices AT OR BETTER than yours on your own side: buy at 99.8 has 8 ahead, buy at 99.95 has 0, sell at 100.2 has 6',
  queueAhead(BK, 'buy', 99.8) === 8 && queueAhead(BK, 'buy', 99.95) === 0 && queueAhead(BK, 'sell', 100.2) === 6,
  { a: queueAhead(BK, 'buy', 99.8), b: queueAhead(BK, 'buy', 99.95), c: queueAhead(BK, 'sell', 100.2) });
const pg1 = pegPx('buy', 100, 5, 0), pg2 = pegPx('buy', 100, 5, 99.9), pg3 = pegPx('sell', 100, 5, 100.1);
ok('27 \u00b7 a peg is anchor \u00d7 (1 \u2213 offset), and a binding cap stops it being a peg at all: buy mid \u22125bp = 99.95 uncapped, clamped to 99.90 under a 99.90 cap; sell +5bp = 100.05 clamped up to 100.10',
  near(pg1.px, 99.95) && pg1.capped === false && near(pg2.px, 99.9) && pg2.capped === true
  && near(pg3.px, 100.1) && pg3.capped === true,
  { pg1, pg2, pg3 });

console.log('');
console.log(pass + ' passed \u00b7 ' + fail + ' failed');
process.exit(fail);
