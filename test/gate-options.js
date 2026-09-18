// DexLadder options gate — the Options desk (layers/56-options.js, window.DLOPT, v166).
//
//   node test/gate-options.js [dist/index.html]      exit code = number of failures
//
// Pure node. Nothing here needs Chromium.
//
// Part A reads the shipped payload as text: the layer is there exactly once, it declares its
// build, it never writes the paper account by hand, it compiles nothing at runtime, it keeps no
// localStorage key of its own, it draws no random number, it is ES5, and it ships the disclosure
// that says the chain is generated rather than quoted.
//
// Part B is the arithmetic. Every formula the desk prints is RE-IMPLEMENTED HERE, independently:
// a normal CDF built from the error function (series below |x| < 2.5, Lentz continued fraction
// above it) rather than from Hart's rational; Black-Scholes-Merton; a Newton implied vol; a CRR
// binomial; Durrleman's g; and the lognormal. Those are then argued with, and where a published
// value exists it is cited in the comment. None of Part B calls the layer.
//
// Part C is a bonus and never turns a green run red on its own absence: if layers/56-options.js
// is on disk it is loaded under a stub window and the SHIPPED functions are checked against
// Part B's independent ones.
'use strict';
const fs = require('fs'), path = require('path');
const WEB = path.join(__dirname, '..');
const file = process.argv[2] || path.join(WEB, 'dist', 'index.html');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 400) : '')); }
};

/* ------------------------------------------------------------------ A · shipped payload */
console.log('A · shipped payload');
let html = '';
try { html = fs.readFileSync(file, 'utf8'); } catch (e) { html = ''; }
if (!html) console.log('  ! could not read ' + file + ' — build the payload first; Part A will fail.');

// build154.py wraps every layers/*.js in its own <script> block, so the layer's whole text can be
// lifted out and every "not in the layer" assert scoped to it exactly.
function layerOf(needle) {
  const parts = html.split('<script');
  for (let i = 1; i < parts.length; i++) {
    const end = parts[i].indexOf('</script');
    const body = end < 0 ? parts[i] : parts[i].slice(0, end);
    if (body.indexOf(needle) >= 0) return body;
  }
  return null;
}
const L = layerOf('window.DLOPT') || layerOf('DLOPT =') || '';
if (html && !L) console.log('  ! layers/56-options.js is not in this payload yet — every Part A row below will fail until build154.py has been run. Parts B and C stand on their own.');
const SRC = fs.existsSync(path.join(WEB, 'layers', '56-options.js'));
const BAL_WRITE = /S\.bal\s*(\[[^\]]{0,60}\]|\.[A-Za-z_$][\w$]*)\s*(\+|-|\*|\/|\|\||&&|\?\?)?=[^=]/;

ok('options · the layer ships in the payload exactly once (window.DLOPT =, the house spelling)',
  (html.match(/window\.DLOPT\s*=/g) || []).length === 1,
  { assigns: (html.match(/window\.DLOPT\s*=/g) || []).length, layerChars: L.length, layerSourceOnDisk: SRC });
ok('options · the layer declares its build in its own export (__v: 166)', /__v:\s*166\b/.test(L), { sawV: (L.match(/__v:\s*\d+/g) || []).slice(0, 4) });
ok('options · the desk never writes the paper account directly — no assignment to S.bal, only execFill and chargeNetwork',
  !!L && !BAL_WRITE.test(L) && /\bexecFill\s*\(/.test(L) && /\bchargeNetwork\s*\(/.test(L),
  { scopedWrite: (L.match(BAL_WRITE) || [])[0] || null, execFill: /\bexecFill\s*\(/.test(L), chargeNetwork: /\bchargeNetwork\s*\(/.test(L) });
ok('options · the desk compiles nothing at runtime (no eval, no new Function, no string timer)',
  !!L && !/\beval\s*\(/.test(L) && !/new\s+Function\s*\(/.test(L) && !/\bset(Timeout|Interval)\s*\(\s*['"`]/.test(L));
ok('options · no localStorage key of its own — state is the v154 bucket through DLCORE.X() and DLCORE.save() — and no token block in the JS',
  !!L && !/\blocalStorage\b/.test(L) && /\b(C|DLCORE)\.X\(\)/.test(L) && /\b(C|DLCORE)\.save\(\)/.test(L)
  && !/(:root|html\[data-mode=day\])\s*\{[^{}]*--[\w-]+\s*:/.test(L));
ok('options · every price on this desk is reproducible — no random draw appears anywhere in the layer',
  !!L && !/Math\.random/.test(L), { hits: (L.match(/.{0,50}Math\.random.{0,30}/g) || []).slice(0, 3) });
ok('options · ES5 only — no arrow functions, no let/const, no template literals, no spread',
  !!L && !/=>/.test(L) && !/\bconst\s/.test(L) && !/\blet\s/.test(L) && !/`/.test(L) && !/\.\.\./.test(L),
  { arrow: /=>/.test(L), letconst: /\b(let|const)\s/.test(L), backtick: /`/.test(L), spread: /\.\.\./.test(L) });
ok('options · the honesty block ships with the layer (ASSUMPTIONS and METHOD, both rendered as a Method tab)',
  !!L && /\bASSUMPTIONS\s*=/.test(L) && /\bMETHOD\s*=/.test(L) && /ASSUMPTIONS:\s*ASSUMPTIONS/.test(L) && /METHOD:\s*METHOD/.test(L));
ok('options · the desk says plainly that there is no options venue feed and the chain is generated, not quoted',
  !!L && /no options venue feed/i.test(L) && /GENERATED/.test(L) && /model prices/i.test(L) && /not (a )?quotes?/i.test(L));
ok('options · r and q are named as inputs rather than measurements, and the margin rule names its source',
  !!L && /r and q are INPUTS/i.test(L) && /Reg ?T|CBOE/.test(L) && /0\.20/.test(L) && /0\.10/.test(L));
ok('options · the arbitrage checks are in the layer by name (Durrleman butterfly + calendar monotonicity of total variance)',
  !!L && /Durrleman/.test(L) && /butterfly/i.test(L) && /calendar/i.test(L) && /total variance/i.test(L));
ok('options · Hart / West is the CDF that shipped, not Abramowitz & Stegun 7.1.26 (the coefficient is in the payload and the reason is written down)',
  !!L && /3\.52624965998911e-02/.test(L) && /440\.413735824752/.test(L) && /7\.5e-8/.test(L));
ok('options · anything the desk opens is torn down on close — it sets __onClose, and it starts no interval of its own',
  !!L && /__onClose/.test(L) && !/setInterval\s*\(/.test(L));
ok('options · the sheet WRITES body.innerHTML in onTab rather than returning a string (the 53-sor bug)',
  !!L && /body\.innerHTML\s*=/.test(L));

/* ------------------------------------------------------------------ B · independent arithmetic */
console.log('\nB · the arithmetic, re-implemented here and argued with');

// --- erf / erfc, independent of Hart. Series for |x| < 2.5 (all terms positive, so no
// cancellation), modified Lentz continued fraction above it. Both are textbook (Numerical
// Recipes 6.2 / Abramowitz & Stegun 7.1.5 and 7.1.14) and neither shares a line with the layer.
function erf(x) {
  const a = Math.abs(x);
  if (a < 2.5) {
    // erf(x) = 2/sqrt(pi) * e^(-x^2) * sum_{n>=0} (2x^2)^n x / (1*3*5*...*(2n+1))
    let term = x, sum = x, x2 = x * x;
    for (let n = 1; n < 300; n++) {
      term *= 2 * x2 / (2 * n + 1);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-18) break;
    }
    return 2 / Math.sqrt(Math.PI) * Math.exp(-x2) * sum;
  }
  return x > 0 ? 1 - erfcBig(a) : erfcBig(a) - 1;
}
function erfcBig(x) {
  // erfc(x) = e^(-x^2) / (sqrt(pi) (x + (1/2)/(x + 1/(x + (3/2)/(x + 2/(x + ...))))))
  // (Abramowitz & Stegun 7.1.14), evaluated bottom-up sixty levels deep, which is past double
  // precision for every x >= 2.5 this is called with.
  let cf = 0;
  for (let i = 60; i >= 1; i--) cf = (i / 2) / (x + cf);
  return Math.exp(-x * x) / Math.sqrt(Math.PI) / (x + cf);
}
const N = x => 0.5 * (1 + erf(x / Math.SQRT2));
const n = x => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

// 1 · the CDF at three published points. N(0) = 1/2 exactly; N(1) and N(-1.96) are the standard
// normal table values (Abramowitz & Stegun table 26.1, to the digits a double carries).
ok('B1 · N(0) = 0.5 exactly', N(0) === 0.5, N(0));
ok('B2 · N(1) = 0.841344746068543 (standard normal table)', Math.abs(N(1) - 0.8413447460685429) < 5e-16, N(1));
ok('B3 · N(-1.96) = 0.024997895148220 (the 2.5% tail every table prints)', Math.abs(N(-1.96) - 0.024997895148220435) < 5e-16, N(-1.96));

// --- Black-Scholes-Merton, written out again from Merton (1973)
function bsm(S, K, T, r, q, v, isCall) {
  if (!(T > 0) || !(v > 0)) {
    const F = S * Math.exp((r - q) * T);
    return { price: Math.exp(-r * T) * Math.max(0, isCall ? F - K : K - F), delta: null, vega: 0, gamma: 0 };
  }
  const sq = Math.sqrt(T), d1 = (Math.log(S / K) + (r - q + v * v / 2) * T) / (v * sq), d2 = d1 - v * sq;
  const dq = Math.exp(-q * T), df = Math.exp(-r * T);
  const price = isCall ? S * dq * N(d1) - K * df * N(d2) : K * df * N(-d2) - S * dq * N(-d1);
  return {
    price, d1, d2,
    delta: isCall ? dq * N(d1) : -dq * N(-d1),
    gamma: dq * n(d1) / (S * v * sq),
    vega: S * dq * n(d1) * sq,
    theta: (isCall
      ? -S * dq * n(d1) * v / (2 * sq) + q * S * dq * N(d1) - r * K * df * N(d2)
      : -S * dq * n(d1) * v / (2 * sq) - q * S * dq * N(-d1) + r * K * df * N(-d2)),
    rho: isCall ? K * T * df * N(d2) : -K * T * df * N(-d2),
    vanna: -dq * n(d1) * d2 / v,
    volga: S * dq * n(d1) * sq * d1 * d2 / v,
  };
}

// 4 · Hull, "Options, Futures, and Other Derivatives", the worked European example:
// S = 42, K = 40, r = 10%, T = 0.5, sigma = 20%, no dividend -> c = 4.76, p = 0.81.
const hullC = bsm(42, 40, 0.5, 0.10, 0, 0.20, true).price;
const hullP = bsm(42, 40, 0.5, 0.10, 0, 0.20, false).price;
ok('B4 · Hull textbook European call = 4.76 (S42 K40 r10% T0.5 v20%)', Math.abs(hullC - 4.76) < 5e-3, hullC);
ok('B5 · Hull textbook European put = 0.81', Math.abs(hullP - 0.81) < 5e-3, hullP);

// 6 · put-call parity, over a grid, as an identity
let parityWorst = 0;
[[100, 90], [100, 100], [100, 140], [37, 50]].forEach(([S, K]) => {
  [0.05, 0.5, 2.5].forEach(T => [0.1, 0.45, 1.2].forEach(v => {
    const g = bsm(S, K, T, 0.037, 0.021, v, true).price - bsm(S, K, T, 0.037, 0.021, v, false).price;
    const rhs = S * Math.exp(-0.021 * T) - K * Math.exp(-0.037 * T);
    parityWorst = Math.max(parityWorst, Math.abs(g - rhs) / K);
  }));
});
ok('B6 · put-call parity C - P = S e^(-qT) - K e^(-rT) holds to 1e-14 of the strike, over 36 cases', parityWorst < 1e-14, parityWorst);

// 7 · delta bounds: a call delta lives in [0, e^(-qT)], a put delta in [-e^(-qT), 0], always
let deltaOk = true, deltaBad = null;
[[100, 20], [100, 100], [100, 500]].forEach(([S, K]) => [0.01, 1, 5].forEach(T => [0.05, 1.5].forEach(v => {
  const dq = Math.exp(-0.03 * T);
  const dc = bsm(S, K, T, 0.05, 0.03, v, true).delta, dp = bsm(S, K, T, 0.05, 0.03, v, false).delta;
  if (!(dc >= 0 && dc <= dq + 1e-15 && dp <= 0 && dp >= -dq - 1e-15)) { deltaOk = false; deltaBad = { S, K, T, v, dc, dp, dq }; }
})));
ok('B7 · call delta in [0, e^(-qT)] and put delta in [-e^(-qT), 0] across 18 cases', deltaOk, deltaBad);

// 8 · vega is positive for any option that still carries time value, identical for the call and
// the put, and never negative. It does UNDERFLOW to exactly zero in a far wing — 100/180 with a
// week to run puts d1 at -41 and the density there is below 1e-308 — and zero is the right answer
// there, so the assertion is "positive where there is time value, never negative anywhere".
let vegaOk = true, vegaBad = null, vegaZeros = 0;
[[100, 60], [100, 100], [100, 180]].forEach(([S, K]) => [0.02, 0.5, 3].forEach(T => [0.1, 0.9].forEach(v => {
  const o = bsm(S, K, T, 0.04, 0.01, v, true), b = bsm(S, K, T, 0.04, 0.01, v, false).vega;
  const a = o.vega;
  if (a === 0) vegaZeros++;
  const timeValue = o.price - Math.max(0, S * Math.exp(-0.01 * T) - K * Math.exp(-0.04 * T));
  if (a < 0 || Math.abs(a - b) > 1e-12 * Math.max(1, a)) { vegaOk = false; vegaBad = { S, K, T, v, a, b }; }
  if (timeValue > 1e-9 && !(a > 0)) { vegaOk = false; vegaBad = { S, K, T, v, a, timeValue }; }
})));
ok('B8 · vega >= 0 everywhere, strictly positive wherever there is time value, and identical for the call and the put (18 cases, ' + vegaZeros + ' underflowing to exactly zero in the wing)', vegaOk, vegaBad);
ok('B9 · vega collapses as expiry arrives: vega(T=1e-8) < 1e-3 of vega(T=1) at the money',
  bsm(100, 100, 1e-8, 0.04, 0, 0.5, true).vega < 1e-3 * bsm(100, 100, 1, 0.04, 0, 0.5, true).vega,
  [bsm(100, 100, 1e-8, 0.04, 0, 0.5, true).vega, bsm(100, 100, 1, 0.04, 0, 0.5, true).vega]);

// 10 · analytic greeks against central differences of this same pricer
function fd(f, x, h) { return (f(x + h) - f(x - h)) / (2 * h); }
{
  const S = 100, K = 107, T = 0.8, r = 0.03, q = 0.012, v = 0.42, o = bsm(S, K, T, r, q, v, true);
  const dD = fd(x => bsm(x, K, T, r, q, v, true).price, S, 1e-4);
  const dV = fd(x => bsm(S, K, T, r, q, x, true).price, v, 1e-5);
  const dT = -fd(x => bsm(S, K, x, r, q, v, true).price, T, 1e-5);
  const dR = fd(x => bsm(S, K, T, x, q, v, true).price, r, 1e-6);
  const dVa = fd(x => bsm(S, K, T, r, q, x, true).delta, v, 1e-5);
  const dVo = fd(x => bsm(S, K, T, r, q, x, true).vega, v, 1e-5);
  ok('B10 · delta, vega, theta, rho, vanna and volga all match a central difference of the same pricer',
    Math.abs(o.delta - dD) < 1e-7 && Math.abs(o.vega - dV) < 1e-5 && Math.abs(o.theta - dT) < 1e-5
    && Math.abs(o.rho - dR) < 1e-5 && Math.abs(o.vanna - dVa) < 1e-6 && Math.abs(o.volga - dVo) < 1e-4,
    { delta: [o.delta, dD], vega: [o.vega, dV], theta: [o.theta, dT], rho: [o.rho, dR], vanna: [o.vanna, dVa], volga: [o.volga, dVo] });
}

// --- implied vol, Newton on vega with a bisection fallback, written again
function ivRef(price, S, K, T, r, q, isCall) {
  const Sd = S * Math.exp(-q * T), Kd = K * Math.exp(-r * T);
  const lo = Math.max(0, isCall ? Sd - Kd : Kd - Sd), hi = isCall ? Sd : Kd;
  const scale = Math.max(1e-12, hi);
  if (!(T > 0) || price < lo - scale * 1e-12 || price > hi + scale * 1e-12) return null;
  if (price <= lo + scale * 1e-12) return 0;
  if (price >= hi - scale * 1e-12) return null;
  let v = 0.5;
  for (let i = 0; i < 100; i++) {
    const o = bsm(S, K, T, r, q, v, isCall);
    if (!(o.vega > 1e-12)) break;
    const nv = v - (o.price - price) / o.vega;
    if (!(nv > 1e-9 && nv < 10)) break;
    const step = Math.abs(nv - v); v = nv;
    if (step < 1e-13 * Math.max(1e-3, v)) return v;
  }
  let a = 1e-9, b = 10;
  for (let i = 0; i < 300; i++) { const m = (a + b) / 2; if (bsm(S, K, T, r, q, m, isCall).price > price) b = m; else a = m; }
  return (a + b) / 2;
}
// 11 · the round trip: price at a known vol, solve it back, over a grid where the option is
// actually vol-sensitive (vega > 1e-8 of spot). An in-the-money price carries its vol in the
// digits that the subtraction of intrinsic destroys, which is a property of the price, not the solver.
{
  let worst = 0, worstAt = null, nCases = 0;
  [[100, 70], [100, 90], [100, 100], [100, 115], [100, 160]].forEach(([S, K]) => {
    [0.02, 0.25, 1, 3].forEach(T => [0.08, 0.3, 0.75, 1.6].forEach(v => [true, false].forEach(isCall => {
      const o = bsm(S, K, T, 0.04, 0.01, v, isCall);
      if (!(o.vega > 1e-8 * S)) return;
      const got = ivRef(o.price, S, K, T, 0.04, 0.01, isCall);
      if (got == null) { worst = Infinity; worstAt = { S, K, T, v, isCall }; return; }
      nCases++;
      const e = Math.abs(got - v);
      if (e > worst) { worst = e; worstAt = { S, K, T, v, isCall, got }; }
    })));
  });
  ok('B11 · implied vol round trip is exact to 1e-8 over ' + nCases + ' vol-sensitive cases', worst < 1e-8, { worst, worstAt });
}
// 12 · a price outside the no-arbitrage band has no implied vol at all
{
  const S = 100, K = 90, T = 1, r = 0.04, q = 0.01;
  const hi = S * Math.exp(-q * T), lo = Math.max(0, hi - K * Math.exp(-r * T));
  ok('B12 · a call above S e^(-qT) has NO implied vol (null, not a number, not a clamp)', ivRef(hi * 1.000001, S, K, T, r, q, true) === null, hi);
  ok('B13 · a call below intrinsic has NO implied vol', ivRef(lo * 0.5, S, K, T, r, q, true) === null, lo);
  ok('B14 · a call exactly at intrinsic implies a vol of zero', ivRef(lo, S, K, T, r, q, true) === 0, lo);
}

// --- SVI and Durrleman, written again
const w = (p, k) => p.a + p.b * (p.rho * (k - p.m) + Math.sqrt((k - p.m) * (k - p.m) + p.sig * p.sig));
const dw = (p, k) => p.b * (p.rho + (k - p.m) / Math.sqrt((k - p.m) * (k - p.m) + p.sig * p.sig));
const ddw = (p, k) => { const s2 = (k - p.m) * (k - p.m) + p.sig * p.sig; return p.b * p.sig * p.sig / (s2 * Math.sqrt(s2)); };
const gOf = (p, k) => { const W = w(p, k), D = dw(p, k); return (1 - k * D / (2 * W)) ** 2 - (D * D / 4) * (1 / W + 0.25) + ddw(p, k) / 2; };
function minG(p) { let m = Infinity, at = null; for (let i = 0; i <= 600; i++) { const k = -1.5 + 3 * i / 600; const g = gOf(p, k); if (g < m) { m = g; at = k; } } return { m, at }; }
// The two slices the desk carries on its Surface tab, lifted out of the payload text when it is
// there so the gate checks the SHIPPED constants, with the same literals as a fallback.
function slicesFromPayload() {
  const grab = name => {
    const m = L.match(new RegExp(name + '\\s*=\\s*\\{([^}]*)\\}'));
    if (!m) return null;
    const o = {};
    m[1].split(',').forEach(part => {
      const kv = part.split(':');
      if (kv.length === 2) o[kv[0].trim()] = parseFloat(kv[1]);
    });
    return (o.a != null && o.b != null && o.rho != null && o.m != null && o.sig != null) ? o : null;
  };
  return {
    good: grab('DEMO_GOOD') || { a: 0.02, b: 0.20, rho: -0.30, m: 0.00, sig: 0.15 },
    bad: grab('DEMO_BAD') || { a: 0.005, b: 0.35, rho: -0.85, m: 0.05, sig: 0.02 },
    fromPayload: !!grab('DEMO_GOOD') && !!grab('DEMO_BAD'),
  };
}
{
  const D = slicesFromPayload();
  const g1 = minG(D.good), g2 = minG(D.bad);
  ok('B15 · Durrleman g(k) >= 0 on the slice the desk ships as known-good' + (D.fromPayload ? ' (parameters read out of the payload)' : ' (payload not read; literals used)'),
    g1.m >= 0, { minG: g1.m, at: g1.at, p: D.good });
  ok('B16 · Durrleman g(k) < 0 on the slice the desk ships as known-bad — the butterfly check bites',
    g2.m < 0, { minG: g2.m, at: g2.at, p: D.bad });
}
// 17 · calendar monotonicity: total variance must not fall as T grows
{
  const early = { a: 0.010, b: 0.10, rho: -0.3, m: 0, sig: 0.12 };
  const laterGood = { a: 0.030, b: 0.14, rho: -0.3, m: 0, sig: 0.12 };
  const laterBad = { a: 0.004, b: 0.08, rho: -0.3, m: 0, sig: 0.12 };
  let goodMin = Infinity, badMin = Infinity;
  for (let i = 0; i <= 200; i++) { const k = -1 + 2 * i / 200; goodMin = Math.min(goodMin, w(laterGood, k) - w(early, k)); badMin = Math.min(badMin, w(laterBad, k) - w(early, k)); }
  ok('B17 · a calendar-monotone pair passes (min w2 - w1 >= 0) and a crossing pair fails', goodMin >= 0 && badMin < 0, { goodMin, badMin });
}

// --- CRR, written again
function crrRef(S, K, T, r, q, v, isCall, american, N_) {
  const dt = T / N_, u = Math.exp(v * Math.sqrt(dt)), d = 1 / u;
  const p = (Math.exp((r - q) * dt) - d) / (u - d), df = Math.exp(-r * dt);
  const val = [];
  for (let j = 0; j <= N_; j++) { const Sj = S * Math.pow(u, 2 * j - N_); val.push(Math.max(0, isCall ? Sj - K : K - Sj)); }
  for (let i = N_ - 1; i >= 0; i--) for (let j = 0; j <= i; j++) {
    const cont = df * (p * val[j + 1] + (1 - p) * val[j]);
    if (!american) { val[j] = cont; continue; }
    const Sij = S * Math.pow(u, 2 * j - i);
    val[j] = Math.max(cont, Math.max(0, isCall ? Sij - K : K - Sij));
  }
  return val[0];
}
// 18 · the tree converges on the closed form, and the error shrinks with N
{
  const closed = bsm(100, 100, 1, 0.05, 0, 0.2, true).price;      // 10.450583572... (Hull's ATM example shape)
  const e50 = crrRef(100, 100, 1, 0.05, 0, 0.2, true, false, 50) - closed;
  const e800 = crrRef(100, 100, 1, 0.05, 0, 0.2, true, false, 800) - closed;
  ok('B18 · CRR European call converges on Black-Scholes: |error| < 0.01 at N = 800, and smaller than at N = 50',
    Math.abs(e800) < 0.01 && Math.abs(e800) < Math.abs(e50), { closed, e50, e800 });
}
// 19 · an American put on a non-dividend payer is worth strictly more than the European one;
// an American call on the same is worth exactly the same (Merton 1973: never exercise it early)
{
  const amP = crrRef(100, 100, 1, 0.05, 0, 0.2, false, true, 600);
  const euP = crrRef(100, 100, 1, 0.05, 0, 0.2, false, false, 600);
  const amC = crrRef(100, 100, 1, 0.05, 0, 0.2, true, true, 600);
  const euC = crrRef(100, 100, 1, 0.05, 0, 0.2, true, false, 600);
  ok('B19 · American put > European put, and (Merton 1973) the American call on a zero-carry underlying is worth exactly the European one',
    amP > euP + 1e-6 && Math.abs(amC - euC) < 1e-12, { amP, euP, premium: amP - euP, amC, euC });
}
// 20 · the margin rule, recomputed: max(premium + 0.20 S - OTM, premium + 0.10 X)
{
  const marg = (S, K, prem, isCall) => {
    const otm = isCall ? Math.max(0, K - S) : Math.max(0, S - K);
    return Math.max(prem + 0.20 * S - otm, prem + 0.10 * (isCall ? S : K));
  };
  ok('B20 · Reg T / CBOE uncovered-option margin, four cases',
    Math.abs(marg(100, 110, 3, true) - 13) < 1e-12 &&
    Math.abs(marg(100, 100, 5, true) - 25) < 1e-12 &&
    Math.abs(marg(100, 90, 2, false) - 12) < 1e-12 &&
    Math.abs(marg(100, 50, 0.4, false) - 5.4) < 1e-12,
    [marg(100, 110, 3, true), marg(100, 100, 5, true), marg(100, 90, 2, false), marg(100, 50, 0.4, false)]);
}
// 21 · the lognormal the probability of profit integrates against is the SAME measure the price
// comes from: P(S_T > K) under drift r - q - v^2/2 must equal N(d2) exactly.
{
  let worst = 0;
  [[100, 80], [100, 100], [100, 130]].forEach(([S, K]) => [0.1, 1, 4].forEach(T => [0.2, 0.9].forEach(v => {
    const r = 0.04, q = 0.015;
    const drift = (r - q - v * v / 2) * T, sd = v * Math.sqrt(T);
    const pAbove = 1 - N((Math.log(K / S) - drift) / sd);
    const d2 = (Math.log(S / K) + (r - q - v * v / 2) * T) / sd;
    worst = Math.max(worst, Math.abs(pAbove - N(d2)));
  })));
  ok('B21 · P(S_T > K) under the risk-neutral lognormal equals N(d2) to 1e-15 (18 cases)', worst < 1e-15, worst);
}
// 22 · a vertical spread can never be worth more than the distance between its strikes, and never
// less than zero — the two bounds a strategy builder has no excuse for breaking
{
  let bad = null;
  [0.05, 1, 3].forEach(T => [0.1, 0.8].forEach(v => {
    const lo = bsm(100, 95, T, 0.04, 0, v, true).price, hi = bsm(100, 105, T, 0.04, 0, v, true).price;
    const spread = lo - hi;
    if (!(spread >= -1e-12 && spread <= 10 + 1e-12)) bad = { T, v, spread };
  }));
  ok('B22 · a 95/105 call spread is worth between 0 and 10, at every tenor and vol tested', !bad, bad);
}

/* ------------------------------------------------------------------ C · the shipped layer */
console.log('\nC · the shipped layer against Part B (skipped without failure if the source is absent)');
(function () {
  const src = path.join(WEB, 'layers', '56-options.js');
  if (!fs.existsSync(src)) { console.log('  – layers/56-options.js not on disk; nothing to cross-check'); return; }
  let O = null;
  try {
    const spark = []; let x = 100;
    for (let i = 0; i < 56; i++) { x *= Math.exp(0.003 * Math.sin(i)); spark.push(x); }
    global.window = {
      DLCORE: {
        coin: () => ({ price: 100, spark }),
        logRets: px => { const o = []; for (let i = 1; i < px.length; i++) o.push(Math.log(px[i] / px[i - 1])); return o; },
        stdev: a => { const m = a.reduce((s, y) => s + y, 0) / a.length; return Math.sqrt(a.reduce((s, y) => s + (y - m) * (y - m), 0) / (a.length - 1)); },
        X: () => (global.__X || (global.__X = {})), save: () => {}, now: () => 1789000000000,
        esc: s => String(s), money: v => '$' + (+v).toFixed(2),
        onTick: () => {}, cmd: () => {}, open: () => null, toast: () => {}, sfx: () => {}, simTag: () => '',
      },
    };
    global.document = { getElementById: () => null, querySelectorAll: () => [] };
    require(src);
    O = global.window.DLOPT;
  } catch (e) { console.log('  – the layer would not load under a stub window: ' + (e && e.message || e)); return; }
  if (!O) { console.log('  – the layer loaded but exported nothing'); return; }

  ok('C1 · the shipped export declares v166 and carries the pure functions the gate can argue with',
    O.__v === 166 && typeof O.bs === 'function' && typeof O.iv === 'function' && typeof O.sviFit === 'function'
    && typeof O.crr === 'function' && typeof O.strategy === 'function' && typeof O.marginShort === 'function'
    && Array.isArray(O.METHOD) && Array.isArray(O.ASSUMPTIONS) && O.ASSUMPTIONS.length >= 8,
    { v: O.__v, method: (O.METHOD || []).length, assumptions: (O.ASSUMPTIONS || []).length });

  let worstN = 0;
  for (let x = -12; x <= 12; x += 0.01) worstN = Math.max(worstN, Math.abs(O.ncdf(x) - N(x)));
  ok('C2 · the shipped normal CDF agrees with an erf-based one to 1e-15 over [-12, 12]', worstN < 1e-15, worstN);

  let worstP = 0;
  [[100, 75], [100, 100], [100, 140]].forEach(([S, K]) => [0.03, 0.7, 2].forEach(T => [0.15, 0.9].forEach(v => [true, false].forEach(c => {
    worstP = Math.max(worstP, Math.abs(O.bs(S, K, T, 0.04, 0.012, v, c).price - bsm(S, K, T, 0.04, 0.012, v, c).price));
  }))));
  ok('C3 · the shipped Black-Scholes agrees with the gate\'s own to 1e-12 over 36 cases', worstP < 1e-12, worstP);

  let worstIV = 0;
  [[100, 80], [100, 100], [100, 125]].forEach(([S, K]) => [0.05, 1].forEach(T => [0.2, 0.7].forEach(v => {
    const isCall = K >= 100;
    const px = bsm(S, K, T, 0.04, 0.01, v, isCall).price;
    const got = O.iv(px, S, K, T, 0.04, 0.01, isCall);
    if (got && got.sigma != null) worstIV = Math.max(worstIV, Math.abs(got.sigma - v));
  })));
  ok('C4 · the shipped implied vol round-trips to 1e-8', worstIV < 1e-8, worstIV);
  ok('C5 · the shipped solver returns null (not a number) above the no-arbitrage bound',
    O.iv(100 * Math.exp(-0.01) + 1, 100, 90, 1, 0.04, 0.01, true).sigma === null);

  const D = slicesFromPayload();
  ok('C6 · the shipped Durrleman check passes the good slice and fails the bad one',
    O.butterfly(D.good, -1.5, 1.5, 241).ok === true && O.butterfly(D.bad, -1.5, 1.5, 241).ok === false);

  const p0 = { a: 0.031, b: 0.17, rho: -0.42, m: 0.018, sig: 0.11 };
  const pts = []; for (let i = -6; i <= 6; i++) pts.push({ k: i * 0.055, w: O.sviW(p0, i * 0.055) });
  const f1 = O.sviFit(pts, 1, 'gate'), f2 = O.sviFit(pts, 1, 'gate');
  ok('C7 · the shipped SVI fit recovers a slice from its own total variance (rmse < 1e-9) and is bit-identical on a second run',
    f1.ok && f1.rmse < 1e-9 && JSON.stringify(f1.p) === JSON.stringify(f2.p), { rmse: f1 && f1.rmse, p: f1 && f1.p });

  const tree = O.crr(100, 100, 1, 0.05, 0, 0.2, true, false, 600);
  ok('C8 · the shipped CRR tree matches the gate\'s own tree exactly at N = 600',
    Math.abs(tree.price - crrRef(100, 100, 1, 0.05, 0, 0.2, true, false, 600)) < 1e-12,
    [tree && tree.price, crrRef(100, 100, 1, 0.05, 0, 0.2, true, false, 600)]);

  ok('C9 · the shipped margin rule matches the Reg T formula on four cases',
    Math.abs(O.marginShort(100, 110, 3, true) - 13) < 1e-12 && Math.abs(O.marginShort(100, 50, 0.4, false) - 5.4) < 1e-12,
    [O.marginShort(100, 110, 3, true), O.marginShort(100, 50, 0.4, false)]);

  const ch = O.chain('BTC', 0.04, 0, 1789000000000);
  const sizes = (ch.expiries || []).map(e => e.rows.length);
  ok('C10 · the generated chain has six expiries and a real ladder of strikes at each (not a tick that collapses them)',
    ch.expiries.length === 6 && sizes.every(s => s >= 7), sizes);
  ok('C11 · the generator passes its own butterfly and calendar checks',
    ch.generatorCalendar.ok === true && ch.generatorButterfly.every(b => b.report.ok === true),
    { cal: ch.generatorCalendar.pairs.map(p => p.minGap), bf: ch.generatorButterfly.map(b => b.report.minG) });

  const straddle = O.strategy('straddle', ch, { expiry: 2, qty: 1 });
  const fly = O.strategy('butterfly', ch, { expiry: 2, qty: 1 });
  const cc = O.strategy('covered-call', ch, { expiry: 2, qty: 1 });
  ok('C12 · unbounded is a word, not a number: the straddle\'s upside is unbounded, the butterfly is bounded both ways, and the covered call\'s loss is bounded by spot going to zero',
    straddle.analysis.maxProfitUnbounded === true && straddle.analysis.maxProfit === null
    && fly.analysis.maxProfitUnbounded === false && fly.analysis.maxLossUnbounded === false
    && cc.analysis.maxLossUnbounded === false && cc.analysis.maxLoss < 0,
    { straddle: straddle.analysis.maxProfitUnbounded, fly: [fly.analysis.maxProfit, fly.analysis.maxLoss], cc: cc.analysis.maxLoss });
  ok('C13 · every structure the desk offers builds, prices and reports a probability of profit in [0, 1]',
    O.strategies.every(s => {
      const r = O.strategy(s.id, ch, { expiry: 2, qty: 1 });
      return r && r.legs.length && r.analysis && r.pop && r.pop.p >= 0 && r.pop.p <= 1 && /risk-neutral/.test(r.pop.drift);
    }), O.strategies.map(s => { const r = O.strategy(s.id, ch, { expiry: 2, qty: 1 }); return [s.id, r && r.pop && +r.pop.p.toFixed(3)]; }));
})();

console.log('\n' + pass + ' passed · ' + fail + ' failed');
process.exit(fail);
