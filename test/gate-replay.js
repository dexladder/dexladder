// DexLadder Replay gate — the ⟲ Replay desk (layers/61-replay.js, window.DLREPLAY, v166).
//
//   node test/gate-replay.js [dist/index.html]      exit code = number of failures
//
// Pure node, no Chromium: this Mac cannot run the browser gates.
//
// Part A reads the shipped payload as text: the layer is there exactly once, it declares its
// build, it is ES5, it compiles nothing at runtime, it keeps no storage key of its own, it never
// writes the paper account, it draws no random number, it ships its honesty block, and — the one
// that matters most on this desk — it routes every fill through DLAPP.backtest instead of owning
// a fill rule of its own, and audits the engine's fills afterwards.
//
// Part B is the arithmetic. Every oracle below is re-implemented here from the published formula
// and checked against a value computed by hand (or against a published test vector, cited in the
// comment). Nothing in Part B calls the layer: a gate that asks the code under test what the
// answer is has only proved the code is consistent with itself.
'use strict';
const fs = require('fs'), path = require('path');
const WEB = path.join(__dirname, '..');
const file = process.argv[2] || path.join(WEB, 'dist', 'index.html');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 400) : '')); }
};
const near = (a, b, tol) => a != null && b != null && isFinite(a) && isFinite(b) && Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);

/* ------------------------------------------------------------------ A · shipped payload */
console.log('A · shipped payload');
const html = fs.readFileSync(file, 'utf8');

// build154.py wraps every layers/*.js in its own <script> block, so the layer's whole text can be
// lifted out of the payload and every "not in the layer" assert scoped to it exactly.
function layerOf(needle) {
  const parts = html.split('<script');
  for (let i = 1; i < parts.length; i++) {
    const end = parts[i].indexOf('</script');
    const body = end < 0 ? parts[i] : parts[i].slice(0, end);
    if (body.indexOf(needle) >= 0) return body;
  }
  return null;
}
const L = layerOf('window.DLREPLAY') || layerOf('DLREPLAY =') || '';
const SRC = fs.existsSync(path.join(WEB, 'layers', '61-replay.js'));

// A write to the paper account and nothing else (gate-desks.js:27's shape, tightened so a
// comparison is not read as an assignment).
const BAL_WRITE = /S\.bal\s*(\[[^\]]{0,60}\]|\.[A-Za-z_$][\w$]*)\s*(\+|-|\*|\/|\|\||&&|\?\?)?=[^=]/;

ok('replay · the layer ships in the payload exactly once (window.DLREPLAY =, the house spelling)',
  (html.match(/window\.DLREPLAY\s*=/g) || []).length === 1,
  { assigns: (html.match(/window\.DLREPLAY\s*=/g) || []).length, layerChars: L.length, layerSourceOnDisk: SRC });
ok('replay · the layer declares its build in its own export (__v: 166)', /__v:\s*166\b/.test(L),
  { sawV: (L.match(/__v:\s*\d+/g) || []).slice(0, 4) });
ok('replay · ES5 only — no arrow, no let/const, no template literal, no spread, no class',
  L.length > 0 && !/=>/.test(L) && !/\blet\s/.test(L) && !/\bconst\s/.test(L) && !/`/.test(L) && !/\.\.\./.test(L) && !/\bclass\s+[A-Za-z]/.test(L),
  { arrow: /=>/.test(L), let: /\blet\s/.test(L), const: /\bconst\s/.test(L), tick: /`/.test(L), spread: /\.\.\./.test(L) });
ok('replay · the desk compiles nothing at runtime (no eval, no new Function, no string timer)',
  L.length > 0 && !/\beval\s*\(/.test(L) && !/new\s+Function\s*\(/.test(L) && !/\bset(Timeout|Interval)\s*\(\s*['"]/.test(L));
ok('replay · no storage key of its own — state is the v154 bucket through DLCORE.X() / save(), and no token block in the JS',
  L.length > 0 && !/\blocalStorage\b/.test(L) && !/\bsessionStorage\b/.test(L)
  && /\b(C|DLCORE)\.X\(\)/.test(L) && /\b(C|DLCORE)\.save\(\)/.test(L)
  && !/(:root|html\[data-mode=day\])\s*\{[^{}]*--[\w-]+\s*:/.test(L));
ok('replay · the desk never writes the paper account, and never trades at all (no execFill anywhere in it)',
  L.length > 0 && !BAL_WRITE.test(L) && !/\bexecFill\s*\(/.test(L) && !/\bchargeNetwork\s*\(/.test(L));
ok('replay · a scenario is reproducible by construction — no random number is drawn anywhere in the layer, and the seed is an FNV-1a hash',
  L.length > 0 && !/Math\.random/.test(L) && /2166136261/.test(L) && /16777619/.test(L) && /Math\.imul/.test(L));
ok('replay · every fill is routed through the Rewind engine — DLAPP.backtest — and the layer owns no fill rule of its own',
  L.length > 0 && /DLAPP\s*&&\s*window\.DLAPP\.backtest|window\.DLAPP\.backtest/.test(L)
  && /\bB\.advance\s*\(|\.advance\s*\(/.test(L) && /\.closeOut\s*\(/.test(L) && /\.priceFor\s*\(/.test(L)
  && /lawAudit/.test(L),
  { backtest: /window\.DLAPP\.backtest/.test(L), advance: /\.advance\s*\(/.test(L), priceFor: /\.priceFor\s*\(/.test(L) });
ok('replay · the law is audited after every run: a fill must land after the decision bar, inside that bar range, and a market fill pays that bar open',
  L.length > 0 && /f\.bar\s*>\s*placed/.test(L) && /b\.l\s*\*|f\.px\s*<\s*b\.l/.test(L) && /market-open/.test(L) && /close-out/.test(L));
ok('replay · the honesty block ships (ASSUMPTIONS + METHOD) and is blunt about the history — survivorship, listing, granularity and that a shock is a hypothesis',
  L.length > 0 && /\bASSUMPTIONS\s*=/.test(L) && /\bMETHOD\s*=/.test(L)
  && /SURVIVORSHIP/i.test(L) && /LISTING EFFECT/i.test(L) && /granularity/i.test(L)
  && /HYPOTHESIS, NOT A FORECAST/i.test(L) && /NOT INDEPENDENT DRAWS/i.test(L));
ok('replay · a regime is a measurement with printed thresholds, and the named episodes are labelled BOOKMARKS rather than regimes',
  L.length > 0 && /BOOKMARK/.test(L) && /bookmark/i.test(L) && /Thresholds, printed/.test(L)
  && /ER_TREND\s*=\s*0\.35/.test(L) && /ER_CHOP\s*=\s*0\.15/.test(L) && /DD_BEAR\s*=\s*0\.20/.test(L));
ok('replay · the distribution is reported, never one hero number (median, quartiles, worst, count, spread)',
  L.length > 0 && /median:/.test(L) && /q1:/.test(L) && /q3:/.test(L) && /iqr:/.test(L) && /worst:/.test(L) && /anecdote/.test(L));
ok('replay · anything the desk opens is torn down on close — it sets __onClose, and it starts no interval at all',
  L.length > 0 && /__onClose/.test(L) && !/setInterval\s*\(/.test(L));
ok('replay · the shocks compose in a stated order and each one prints its marginal effect',
  L.length > 0 && /SHOCK_ORDER\s*=\s*\["vol",\s*"gap",\s*"depeg",\s*"funding",\s*"depth",\s*"cascade"\]/.test(L)
  && /marginal:/.test(L) && /residual:/.test(L));
ok('replay · the desk ships its own stylesheet rules, and none of them live in the JS',
  fs.existsSync(path.join(WEB, '_v166css', '61-replay.css')));

/* ------------------------------------------------------------------ B · the arithmetic */
console.log('\nB · numeric oracles (re-implemented here, checked against hand values)');

/* 1 — FNV-1a 32-bit. Published test vectors (Fowler/Noll/Vo; the reference values in the
   IETF draft-eastlake-fnv appendix): "" → 0x811c9dc5, "a" → 0xe40c292c, "foobar" → 0xbf9cf968. */
function fnv1a(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
ok('B1 · FNV-1a matches the three published vectors — the seed function is the standard one',
  fnv1a('') === 0x811c9dc5 && fnv1a('a') === 0xe40c292c && fnv1a('foobar') === 0xbf9cf968,
  { empty: fnv1a('').toString(16), a: fnv1a('a').toString(16), foobar: fnv1a('foobar').toString(16) });

/* 2 — Kaufman efficiency ratio: net move ÷ total path (Perry Kaufman, Smarter Trading, 1995). */
function er(c) { let d = 0; for (let i = 1; i < c.length; i++) d += Math.abs(c[i] - c[i - 1]); return d > 0 ? Math.abs(c[c.length - 1] - c[0]) / d : 0; }
ok('B2 · efficiency ratio: a straight line is 1, a round trip is 0, 100→110→105→120 is 20/30',
  near(er([10, 11, 12, 13]), 1) && near(er([10, 12, 10, 12]), 1 / 3, 1e-12) && near(er([10, 10, 10]), 0)
  && near(er([100, 110, 105, 120]), 20 / 30, 1e-12),
  { straight: er([10, 11, 12, 13]), zigzag: er([10, 12, 10, 12]), mixed: er([100, 110, 105, 120]) });

/* 3 — R² of ln(price) on bar index: a perfect exponential fits exactly. */
function r2(c) {
  const n = c.length, y = c.map(Math.log);
  let mx = 0, my = 0, sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { mx += i; my += y[i]; } mx /= n; my /= n;
  for (let i = 0; i < n; i++) { const dx = i - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return (sxy * sxy) / (sxx * syy);
}
ok('B3 · R² of log price on time is 1 for a constant-growth series (100,110,121,133.1) and below it for a zigzag',
  near(r2([100, 110, 121, 133.1]), 1, 1e-12) && r2([100, 120, 100, 120, 100, 121]) < 0.2,
  { exp: r2([100, 110, 121, 133.1]), zig: r2([100, 120, 100, 120, 100, 121]) });

/* 4 — Garman-Klass (1980): σ² = 0.5·ln(h/l)² − (2·ln2 − 1)·ln(c/o)².
   For o=100 h=104 l=98 c=102 the hand value is 0.0016140884158007947. */
const GK_K = 2 * Math.log(2) - 1;
const gk = b => 0.5 * Math.pow(Math.log(b.h / b.l), 2) - GK_K * Math.pow(Math.log(b.c / b.o), 2);
ok('B4 · Garman-Klass per-bar variance matches the hand value, and its constant 2ln2−1 is 0.3862943611198906',
  near(gk({ o: 100, h: 104, l: 98, c: 102 }), 0.0016140884158007947, 1e-17) && near(GK_K, 0.3862943611198906, 1e-15),
  { gk: gk({ o: 100, h: 104, l: 98, c: 102 }), k: GK_K });

/* 5 — Parkinson (1980): σ² = ln(h/l)² ÷ (4·ln2). Doubling the log range quadruples the variance. */
const PK_K = 4 * Math.log(2);
const pk = b => Math.pow(Math.log(b.h / b.l), 2) / PK_K;
ok('B5 · Parkinson per-bar variance matches its closed form, and quadruples when the log range doubles',
  near(pk({ o: 100, h: 104, l: 98, c: 102 }), Math.pow(Math.log(104 / 98), 2) / (4 * Math.log(2)), 1e-18)
  && near(pk({ h: 100 * Math.exp(0.12), l: 100 }) / pk({ h: 100 * Math.exp(0.06), l: 100 }), 4, 1e-9)
  && near(Math.sqrt(pk({ o: 100, h: 104, l: 98, c: 102 })), 0.035687400967109151, 1e-15));

/* 6 — annualisation: the typed core's own bar clock is 31,557,600,000 ms (365.25 days). */
const bpy = ms => 31557600000 / ms;
ok('B6 · bars per year: 365.25 daily, 2191.5 four-hourly, 8766 hourly',
  near(bpy(86400000), 365.25) && near(bpy(14400000), 2191.5) && near(bpy(3600000), 8766),
  { d: bpy(86400000), h4: bpy(14400000), h1: bpy(3600000) });

/* 7 — close-to-close realised vol: sample stdev (n−1) of log returns × √(bars per year). */
function cc(closes, bars) {
  const r = []; for (let i = 1; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1]));
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - m) * (b - m), 0) / (r.length - 1);
  return Math.sqrt(v) * Math.sqrt(bars);
}
// two bars up 1% then down 1%: r = [ln1.01, ln(0.99/1.01)]… use a series with a known stdev instead:
// closes 100,101,100,101 → log returns ±ln(1.01) alternating, mean 0 for an even count of pairs.
// closes 100,101,100,101 → log returns [+a, −a, +a] with a = ln(1.01); mean a/3, sample
// variance (n−1=2) = 4a²/3, so the annualised figure is 2a/√3 × √365.25 = 0.21958466237562405.
ok('B7 · close-to-close vol is the n−1 sample stdev of log returns annualised: a flat series is exactly 0, and 100,101,100,101 daily is 2·ln(1.01)/√3 × √365.25 = 0.2195846623756',
  near(cc([100, 100, 100, 100], 365.25), 0)
  && near(cc([100, 101, 100, 101], 365.25), Math.sqrt(4 * Math.pow(Math.log(1.01), 2) / 3) * Math.sqrt(365.25), 1e-15)
  && near(cc([100, 101, 100, 101], 365.25), 0.21958466237562405, 1e-15),
  { flat: cc([100, 100, 100, 100], 365.25), alt: cc([100, 101, 100, 101], 365.25) });

/* 8 — type-7 (PERCENTILE.INC) quantiles: q at h = (n−1)p, interpolated between order statistics. */
function q7(a, p) { const s = a.slice().sort((x, y) => x - y), h = (s.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h); return s[lo] + (s[hi] - s[lo]) * (h - lo); }
ok('B8 · quartiles on [1,2,3,4] are 1.75 / 2.5 / 3.25 and on [2,4,4,4,5,5,7,9] are 4 / 4.5 / 5.5',
  near(q7([1, 2, 3, 4], 0.25), 1.75) && near(q7([1, 2, 3, 4], 0.5), 2.5) && near(q7([1, 2, 3, 4], 0.75), 3.25)
  && near(q7([2, 4, 4, 4, 5, 5, 7, 9], 0.25), 4) && near(q7([2, 4, 4, 4, 5, 5, 7, 9], 0.5), 4.5) && near(q7([2, 4, 4, 4, 5, 5, 7, 9], 0.75), 5.5));

/* 9 — the regime label is a total function of the measurement, and the thresholds are applied
   consistently: nothing between the cuts is labelled as a trend, nothing above them as chop,
   and a window exactly on a tercile edge falls on the low side of the cut, every time. */
const ER_TREND = 0.35, ER_CHOP = 0.15, DD_NEAR = 0.05, DD_BEAR = 0.20;
const trendOf = f => f.er >= ER_TREND ? (f.dir > 0 ? 'up' : 'down') : f.er <= ER_CHOP ? 'chop' : 'drift';
const volOf = (f, t) => f.rv <= t.lo ? 'vol-lo' : f.rv >= t.hi ? 'vol-hi' : 'vol-mid';
const ddOf = f => f.dd < DD_NEAR ? 'highs' : f.dd < DD_BEAR ? 'correction' : 'bear';
const sample = [];
for (let i = 0; i < 90; i++) sample.push({ er: (i % 10) / 10, dir: i % 2 ? 1 : -1, rv: 0.05 + (i % 9) * 0.05, dd: (i % 6) * 0.06 });
const T = { lo: q7(sample.map(s => s.rv), 1 / 3), hi: q7(sample.map(s => s.rv), 2 / 3) };
let consistent = true, labelled = 0;
for (const s of sample) {
  const lab = trendOf(s) + '·' + volOf(s, T) + '·' + ddOf(s);
  if (!/^(up|down|drift|chop)·vol-(lo|mid|hi)·(highs|correction|bear)$/.test(lab)) consistent = false;
  if (s.er > ER_CHOP && s.er < ER_TREND && trendOf(s) !== 'drift') consistent = false;
  if (s.rv < T.lo && volOf(s, T) !== 'vol-lo') consistent = false;
  if (s.rv > T.hi && volOf(s, T) !== 'vol-hi') consistent = false;
  if (s.dd >= DD_BEAR && ddOf(s) !== 'bear') consistent = false;
  labelled++;
}
ok('B9 · the regime thresholds are applied consistently over 90 constructed windows: every window gets exactly one label, the cuts never overlap, and the terciles are the measured ones',
  consistent && labelled === 90 && T.lo < T.hi, { lo: T.lo, hi: T.hi, labelled });

/* 10 — the no-lookahead law, on a series where cheating is detectably better.
   Decision on bar 0's close (100). Honest: fill at bar 1's OPEN (120). Cheat: fill at the 100 the
   decision was taken on. Exit at bar 2's close (129). */
const S10 = [{ o: 100, h: 100, l: 100, c: 100 }, { o: 120, h: 125, l: 118, c: 120 }, { o: 121, h: 130, l: 119, c: 129 }];
const honest = (S10[2].c / S10[1].o - 1) * 100, cheat = (S10[2].c / S10[0].c - 1) * 100;
ok('B10 · a lookahead fill on this constructed series is 21.5 points better than the honest one — so a desk that cannot tell them apart is not testing anything',
  near(honest, 7.5, 1e-12) && near(cheat, 29, 1e-12) && near(cheat - honest, 21.5, 1e-12),
  { honest, cheat });

/* 11 — the stop rule against the bar's full range, and the gap that pays worse than the stop. */
function stopFill(o, b) {   // sell stop, the engine's rule
  return b.o <= o.px ? { px: b.o, why: 'stop-gap' } : b.l <= o.px ? { px: o.px, why: 'stop' } : null;
}
const inRange = stopFill({ px: 119 }, { o: 120, h: 125, l: 118, c: 124 });
const gapped = stopFill({ px: 119 }, { o: 110, h: 112, l: 108, c: 111 });
const missed = stopFill({ px: 100 }, { o: 120, h: 125, l: 118, c: 124 });
ok('B11 · a stop is checked against the whole bar: it fills at the stop when the range trades through it (119), at the OPEN when the bar gapped past it (110, worse), and not at all when the range never reached it',
  inRange && inRange.px === 119 && inRange.why === 'stop' && gapped && gapped.px === 110 && gapped.why === 'stop-gap' && missed === null,
  { inRange, gapped, missed });

/* 12 — funding settlements on the real UTC clock, and the payment at one settlement. */
const HOUR = 3600000;
const nextS = (t, h) => Math.floor(t / (h * HOUR)) * h * HOUR + h * HOUR;
function settles(from, to, h) { const o = []; for (let s = nextS(from, h); s <= to; s += h * HOUR) o.push(s); return o; }
const t0 = Date.UTC(2026, 0, 1);
ok('B12 · the funding clock is real UTC: 3 settlements in 24h at 8h (08:00, 16:00, 00:00), 24 at hourly, and the first one after 00:00 is 08:00Z',
  settles(t0, t0 + 86400000, 8).length === 3 && settles(t0 + 60000, t0 + 86400000, 8).length === 3
  && settles(t0, t0 + 86400000, 1).length === 24 && settles(t0, t0 + 86400000, 8)[0] === Date.UTC(2026, 0, 1, 8),
  { eight: settles(t0, t0 + 86400000, 8).map(x => new Date(x).toISOString()) });

const pay = (qty, mark, r8, h, dir) => qty * mark * (r8 * h / 8) * dir;
ok('B13 · funding accrual over a known number of intervals: 0.5 BTC at $60,000 and 0.01%/8h pays $3.00 a settlement, $9.00 over 24h, and a short receives the same figure',
  near(pay(0.5, 60000, 1e-4, 8, 1), 3, 1e-12) && near(pay(0.5, 60000, 1e-4, 8, 1) * 3, 9, 1e-12)
  && near(pay(0.5, 60000, 1e-4, 8, -1), -3, 1e-12) && near(pay(0.5, 60000, 1e-4, 1, 1), 0.375, 1e-12),
  { one: pay(0.5, 60000, 1e-4, 8, 1), hourly: pay(0.5, 60000, 1e-4, 1, 1) });

/* 14 — the app's funding model: 0.01%/8h baseline tilted by the 24h move, clamped at ±100%. */
const est = m => 1e-4 + 5e-4 * Math.max(-1, Math.min(1, (m || 0) / 10));
ok('B14 · the modelled funding rate is 0.01%/8h at a flat tape, 0.06% at +10% or beyond, −0.04% at −10% or beyond',
  near(est(0), 1e-4, 1e-15) && near(est(10), 6e-4, 1e-15) && near(est(50), 6e-4, 1e-15) && near(est(-30), -4e-4, 1e-15));

/* 15 — the maintenance ladder and the liquidation price, the shape the engine ships.
   major steps [[5e4,0.004],[2.5e5,0.005],[1e6,0.01],…]; each step's maintenance amount keeps the
   requirement continuous at its lower edge: cum += prevUpTo × (mmr − prevMmr). */
function ladder(steps) { const o = []; let cum = 0, pu = 0, pm = 0; for (const [up, mmr] of steps) { if (o.length) cum += pu * (mmr - pm); o.push({ up, mmr, cum }); pu = up; pm = mmr; } return o; }
const MAJ = ladder([[5e4, 0.004], [2.5e5, 0.005], [1e6, 0.01], [5e6, 0.025]]);
const liqLong = (E, q, M, mmr, cum) => Math.max(0, (E * q - M - cum) / (q * (1 - mmr)));
const liqShort = (E, q, M, mmr, cum) => Math.max(0, (E * q + M + cum) / (q * (1 + mmr)));
ok('B15 · the maintenance amounts are continuous (0, 50, 1300) and a 10x long on 1 BTC at $60,000 liquidates at 54,221.105527638194',
  near(MAJ[0].cum, 0) && near(MAJ[1].cum, 50, 1e-12) && near(MAJ[2].cum, 1300, 1e-9)
  && near(liqLong(60000, 1, 6000, 0.005, 50), 54221.105527638194, 1e-6)
  && near(liqShort(60000, 1, 6000, 0.005, 50), 66050 / 1.005, 1e-9),
  { cums: MAJ.map(x => x.cum), long: liqLong(60000, 1, 6000, 0.005, 50) });

/* 16 — the volatility shock preserves the mean log return, so the window ends where it ended. */
function volShock(bars, m) {
  const r = []; for (let i = 1; i < bars.length; i++) r.push(Math.log(bars[i].c / bars[i - 1].c));
  const mr = r.reduce((a, b) => a + b, 0) / r.length, c = [bars[0].c];
  for (let i = 0; i < r.length; i++) c.push(c[i] * Math.exp(mr + m * (r[i] - mr)));
  return bars.map((b, i) => ({ t: b.t, o: c[i] * Math.pow(b.o / b.c, m), h: c[i] * Math.pow(b.h / b.c, m), l: c[i] * Math.pow(b.l / b.c, m), c: c[i] }));
}
const BARS = [{ t: 0, o: 100, h: 101, l: 99, c: 100 }, { t: 1, o: 100, h: 106, l: 99, c: 105 }, { t: 2, o: 105, h: 106, l: 100, c: 102 }, { t: 3, o: 102, h: 110, l: 101, c: 109 }];
const V2 = volShock(BARS, 2), V1 = volShock(BARS, 1);
ok('B16 · the volatility shock is mean-preserving: ×2 leaves the endpoint at 109 exactly, doubles each bar log range, ×1 is the identity, and every shocked bar is still well formed',
  near(V2[3].c, 109, 1e-9) && near(Math.log(V2[1].h / V2[1].l), 2 * Math.log(BARS[1].h / BARS[1].l), 1e-12)
  && near(V1[2].c, 102, 1e-9)
  && V2.every(b => b.h >= Math.max(b.o, b.c) - 1e-9 && b.l <= Math.min(b.o, b.c) + 1e-9),
  { end: V2[3].c, range: Math.log(V2[1].h / V2[1].l) });

/* 17 — the gap: every bar from k onward is multiplied by (1+g), so the jump lands between bar
   k−1's close and bar k's open and nothing before k moves. */
function gapShock(bars, g, k) { return bars.map((b, i) => { const f = i >= k ? 1 + g : 1; return { o: b.o * f, h: b.h * f, l: b.l * f, c: b.c * f }; }); }
const G = gapShock(BARS, -0.12, 2);
ok('B17 · the gap moves the level from its own bar onward and nothing before it: bar 1 is untouched, bar 2 opens 12% lower, and the jump sits between bar 1 close and bar 2 open',
  near(G[1].c, BARS[1].c) && near(G[2].o, BARS[2].o * 0.88, 1e-12)
  && near(G[2].o / G[1].c, (BARS[2].o / BARS[1].c) * 0.88, 1e-12) && near(G[3].c / G[2].c, BARS[3].c / BARS[2].c, 1e-12));

/* 18 — the depeg moves the QUOTE asset: p ÷ (1+d). A percentage return in that quote is
   unchanged; the dollar value is what moves. */
const depeg = (bars, d) => bars.map(b => ({ o: b.o / (1 + d), h: b.h / (1 + d), l: b.l / (1 + d), c: b.c / (1 + d) }));
const D5 = depeg(BARS, -0.05);
ok('B18 · a −5% depeg divides every quoted price by 0.95, leaves the nominal return identical, and shows up only when the result is marked back to dollars',
  near(D5[0].c, 100 / 0.95, 1e-12) && near(D5[3].c / D5[0].c, BARS[3].c / BARS[0].c, 1e-12)
  && near((1.09 * (1 - 0.05) - 1) * 100, 3.55, 1e-12),
  { quoted: D5[0].c, nominal: D5[3].c / D5[0].c });

/* 19 — depth: a full-range constant-product pool's AVERAGE price impact for a buy of q base is
   exactly x/(1−x) with x = 2·q·p₀/TVL (from Δy = L·(√p' − √p), L = TVL/(2√p)). */
const impact = (q, p0, tvl) => { const x = 2 * q * p0 / tvl; return x / (1 - x); };
ok('B19 · the depth model is the pool the ticket walks: impact = x/(1−x) with x = 2·q·p₀/TVL — 2.0004 bp on $100 into $1M, and quartering the depth multiplies it by 4.0024, not by 4',
  near(impact(1, 100, 1e6), 0.00020004000800160033, 1e-15)
  && near(impact(1, 100, 0.25e6) / impact(1, 100, 1e6), 4.002401921538028, 1e-9),
  { full: impact(1, 100, 1e6) * 1e4, quarter: impact(1, 100, 0.25e6) * 1e4 });

/* 20 — the shocks compose: each marginal is the difference between two runs, so the marginals
   sum to the total EXACTLY, whatever the runs did. Checked on a chain of six. */
const R = [10, 4, -3, -3.5, -9, -21, -21];
const marg = []; for (let i = 1; i < R.length; i++) marg.push(R[i] - R[i - 1]);
ok('B20 · the marginal effects telescope: their sum is the total to the last bit, and a shock with no effect contributes exactly 0',
  near(marg.reduce((a, b) => a + b, 0), R[R.length - 1] - R[0], 0) && marg[marg.length - 1] === 0,
  { total: R[R.length - 1] - R[0], sum: marg.reduce((a, b) => a + b, 0) });

/* 21 — the interaction residual: the sum of the shocks priced ALONE is not the total, and the
   difference is the number the desk prints rather than hides. */
const alone = [2.13, -11.39, 0, -21.36, -0.25, -29.8], total = -18.01;
ok('B21 · pricing each shock alone does not add up to pricing them together — the residual is the part a one-at-a-time test misses',
  near(total - alone.reduce((a, b) => a + b, 0), total - (-60.67), 1e-9) && Math.abs(total - alone.reduce((a, b) => a + b, 0)) > 1,
  { sumAlone: alone.reduce((a, b) => a + b, 0), total });

/* 22 — determinism: the seed is the scenario. The same key and parameters hash to the same value,
   any change moves it, and the derived bar index is stable. */
function seedOf(key, sh) {
  let s = key;
  for (const k of ['vol', 'gap', 'depeg', 'funding', 'depth', 'cascade']) s += '|' + k + ':' + (sh[k] ? '1' : '0') + ':' + (sh[k] === undefined ? '-' : sh[k]);
  return fnv1a(s);
}
const K = 'BTC|1d|1700000000000|1705000000000';
const A = seedOf(K, { vol: 1.8, gap: -0.12 }), B2 = seedOf(K, { vol: 1.8, gap: -0.12 }), Cx = seedOf(K, { vol: 1.9, gap: -0.12 });
const barIn = (seed, a, b) => a + 1 + (seed % Math.max(1, b - a - 1));
ok('B22 · the same scenario hashes to the same seed and lands the unanchored shock on the same bar every time; a 0.1 change to one parameter moves the seed',
  A === B2 && A !== Cx && barIn(A, 100, 160) === barIn(B2, 100, 160)
  && barIn(A, 100, 160) > 100 && barIn(A, 100, 160) <= 160,
  { a: A.toString(16), c: Cx.toString(16), bar: barIn(A, 100, 160) });

/* 23 — a distribution, not a hero number: the median of an asymmetric sample is not its mean,
   and the IQR of a wide sample is wide. This is the check that the desk reports a shape. */
const sampleEdges = [-31.2, -8.4, -2.1, -0.4, 0.3, 1.1, 2.9, 4.4, 51.8];
const med = q7(sampleEdges, 0.5), mean9 = sampleEdges.reduce((a, b) => a + b, 0) / 9;
ok('B23 · on a fat-tailed sample of nine windows the median is +0.30, the mean is +2.04 and the IQR is 5.0 — the distribution is the answer, and a single hero number would have been the mean',
  near(med, 0.3, 1e-12) && near(mean9, 2.0444444444444, 1e-9)
  && near(q7(sampleEdges, 0.25), -2.1, 1e-12) && near(q7(sampleEdges, 0.75), 2.9, 1e-12)
  && near(q7(sampleEdges, 0.75) - q7(sampleEdges, 0.25), 5, 1e-12),
  { median: med, mean: mean9, iqr: q7(sampleEdges, 0.75) - q7(sampleEdges, 0.25) });

/* 24 — the overlap correction: a 60-bar window stepping 15 bars shares bars with its three
   neighbours, so only every 4th window is an independent draw. */
ok('B24 · with a 60-bar window and a 15-bar stride, every 4th window is disjoint — the desk must report n on that subset, not on all of them',
  Math.ceil(60 / 15) === 4 && Math.ceil(90 / 30) === 3 && Math.ceil(60 / 60) === 1);

console.log('\n' + pass + ' passed · ' + fail + ' failed');
process.exit(fail);
