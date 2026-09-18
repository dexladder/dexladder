// DexLadder Verify gate — the Verify desk (layers/64-verify.js, window.DLVERIFY, v166).
//
//   node test/gate-verify.js [dist/index.html]      exit code = number of failures
//
// Pure node. Reads the shipped payload as text and requires nothing from Chromium.
//
// PART A asserts the layer's shape: it ships exactly once, it declares its build, it never
// writes the paper account, it compiles nothing at runtime, it keeps no storage key of its own,
// it draws no random numbers, it is ES5, and it ships ASSUMPTIONS and METHOD. It also asserts
// the thing that makes this particular layer honest: every registered formula has at least one
// pinned reference case, and every reference case carries a citation.
//
// PART B is the point of this file. It lifts the REFCASES array straight out of the payload
// text, JSON.parses it, and recomputes each case with a THIRD implementation written below —
// deliberately different again from BOTH implementations in the layer, so that a gate pass is
// evidence and not an echo. Where the layer solves algebra, the gate root-finds; where the
// layer root-finds, the gate integrates; where the layer sums forward, the gate subtracts the
// complement. Two of the checks deliberately use a coarser approximation than the layer does
// (Abramowitz & Stegun 26.2.17 for the normal CDF, error < 7.5e-8) and carry a correspondingly
// looser tolerance, which is stated at the call site rather than hidden.
'use strict';
const fs = require('fs'), path = require('path');
const WEB = path.join(__dirname, '..');
const file = process.argv[2] || path.join(WEB, 'dist', 'index.html');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 500) : '')); }
};

console.log('A · shipped payload');
const html = fs.readFileSync(file, 'utf8');

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
const L = layerOf('window.DLVERIFY =') || layerOf('DLVERIFY') || '';

// A write to the paper account and nothing else. Reads of the account are fine.
const BAL_WRITE = /S\.bal\s*(\[[^\]]{0,60}\]|\.[A-Za-z_$][\w$]*)\s*(\+|-|\*|\/|\|\||&&|\?\?)?=[^=]/;

ok('verify · the layer ships in the payload exactly once (window.DLVERIFY =, the house spelling)',
  (html.match(/window\.DLVERIFY\s*=/g) || []).length === 1,
  { assigns: (html.match(/window\.DLVERIFY\s*=/g) || []).length, layerChars: L.length });
ok('verify · the layer declares its build in its own export (__v: 166)',
  /__v:\s*166\b/.test(L), { sawV: (L.match(/__v:\s*\d+/g) || []).slice(0, 4) });
ok('verify · the payload is a v166 build and carries exactly one build meta',
  (html.match(/<meta name="cb:build" content="v166">/g) || []).length === 1,
  { metas: (html.match(/<meta name="cb:build" content="[^"]*">/g) || []).slice(0, 3) });
ok('verify · this desk never trades — no assignment to S.bal, and no path to the engine\'s fill or network-charge calls anywhere in the layer',
  !BAL_WRITE.test(L) && !/\bexecFill\b/.test(L) && !/\bchargeNetwork\b/.test(L),
  { balWrite: (L.match(BAL_WRITE) || [])[0] || null, execFill: /\bexecFill\b/.test(L), chargeNetwork: /\bchargeNetwork\b/.test(L) });
ok('verify · the layer says so in its own banner, so the claim is on the screen and not only in this file',
  /never trades/i.test(L) && /never writes a balance/i.test(L), {});
ok('verify · the desk compiles nothing at runtime (no eval, no new Function, no string timer)',
  !/\beval\s*\(/.test(L) && !/new\s+Function\s*\(/.test(L) && !/\bset(Timeout|Interval)\s*\(\s*['"`]/.test(L), {});
ok('verify · no storage key of its own — state is the v154 bucket through DLCORE.X() / DLCORE.save() — and no token block in the JS',
  !/\blocalStorage\b/.test(L) && !/\bsessionStorage\b/.test(L)
  && /\b(C|DLCORE)\.X\(\)/.test(L) && /\b(C|DLCORE)\.save\(\)/.test(L)
  && !/(:root|html\[data-mode=day\])\s*\{[^{}]*--[\w-]+\s*:/.test(L), {});
ok('verify · deterministic by construction — no random source appears anywhere in the layer',
  !/Math\.random/.test(L), { hits: (L.match(/.{0,50}Math\.random.{0,30}/g) || []).slice(0, 3) });
ok('verify · ES5 only — no arrow functions, no const/let, no template literals, no spread, no classes, no optional chaining',
  !/=>/.test(L) && !/\bconst\s/.test(L) && !/\blet\s+[A-Za-z_$]/.test(L) && L.indexOf('`') < 0
  && !/(?<![.\w])\.\.\./.test(L) && !/\bclass\s+[A-Z]/.test(L) && !/\?\./.test(L), {
    arrow: /=>/.test(L), constLet: /\b(const|let)\s/.test(L), tick: L.indexOf('`') >= 0,
    spread: /(?<![.\w])\.\.\./.test(L)
  });
ok('verify · the honesty block ships — ASSUMPTIONS and METHOD, and the Method tab renders both',
  /\bASSUMPTIONS\s*=/.test(L) && /\bMETHOD\s*=/.test(L) && /paneMethod/.test(L), {});
ok('verify · onTab ASSIGNS body.innerHTML rather than returning a string (the 53-sor.js bug)',
  /body\.innerHTML\s*=/.test(L), {});
ok('verify · anything the desk opens is torn down on close — it sets __onClose, or it starts no interval at all',
  /__onClose/.test(L) || !/setInterval\s*\(/.test(L), {});
ok('verify · every other layer it reads is guarded and its absence is NAMED, not skipped',
  /not in this build/.test(L) && /DLTAX/.test(L) && /DLSOR/.test(L) && /DLDEFI/.test(L)
  && /DLRISK/.test(L) && /DLOPT/.test(L) && /DLLEND/.test(L), {});
ok('verify · the desk registers on the desks rail and the command palette',
  /DLDESKS\s*&&\s*window\.DLDESKS\.register|DLDESKS\.register\(\s*"verify"/.test(L) && /C\.cmd\s*&&/.test(L), {});

/* ---------------------------------------------- the registry, out of the payload text */
const IDS = [];
{
  const re = /\bid:\s*"([A-Za-z0-9._]+)",\s*\n\s*label:\s*"/g;
  let m;
  while ((m = re.exec(L))) IDS.push(m[1]);
}
ok('verify · the registry seeds a meaningful number of formulas (>= 15 registered in the payload)',
  IDS.length >= 15, { found: IDS.length, ids: IDS });

let REFCASES = null, parseErr = null;
{
  const m = L.match(/var REFCASES = (\[[\s\S]*?\n  \]);/);
  if (!m) parseErr = 'REFCASES array not found in the layer text';
  else { try { REFCASES = JSON.parse(m[1]); } catch (e) { parseErr = String(e && e.message || e); } }
}
ok('verify · the reference cases are lifted straight out of the shipped payload and parse as strict JSON',
  Array.isArray(REFCASES) && REFCASES.length >= 30, { error: parseErr, n: REFCASES ? REFCASES.length : 0 });
if (!REFCASES) { console.log('\n' + pass + ' passed · ' + (fail + 1) + ' failed'); process.exit(fail + 1); }

const byFid = {};
REFCASES.forEach(c => { (byFid[c.fid] = byFid[c.fid] || []).push(c); });

ok('verify · EVERY registered formula has at least one pinned reference case',
  IDS.every(id => (byFid[id] || []).length >= 1),
  { without: IDS.filter(id => !(byFid[id] || []).length) });
ok('verify · every reference case carries a citation naming where the formula comes from',
  REFCASES.every(c => typeof c.cite === 'string' && c.cite.length > 20),
  { thin: REFCASES.filter(c => !c.cite || c.cite.length <= 20).map(c => c.id) });
ok('verify · every reference case carries a numeric expected value and an explicit tolerance',
  REFCASES.every(c => typeof c.expect === 'number' && isFinite(c.expect) && typeof c.tol === 'number' && c.tol > 0),
  { bad: REFCASES.filter(c => typeof c.expect !== 'number' || typeof c.tol !== 'number').map(c => c.id) });
ok('verify · every case id is unique, so a failure names exactly one case',
  new Set(REFCASES.map(c => c.id)).size === REFCASES.length, { n: REFCASES.length });
ok('verify · every reference case belongs to a formula the payload actually registers',
  REFCASES.every(c => IDS.indexOf(c.fid) >= 0),
  { orphans: REFCASES.filter(c => IDS.indexOf(c.fid) < 0).map(c => c.id + '→' + c.fid) });
ok('verify · the expected values reach the self-test — the self-test reads reference[] and measures against expect and tol',
  /selfTest\s*=?\s*function|function selfTest/.test(L) && /\.expect\b/.test(L) && /c\.tol/.test(L)
  && /reference\s*\[\s*j\s*\]|e\.reference/.test(L), {});
ok('verify · at least six citations are PUBLISHED values quoted from their source rather than derived',
  REFCASES.filter(c => /PUBLISHED/.test(c.cite)).length >= 6,
  { published: REFCASES.filter(c => /PUBLISHED/.test(c.cite)).length });
ok('verify · the export carries the formula text and a spreadsheet form, so the arithmetic can be redone outside this app',
  /spreadsheet_formula/.test(L) && /toCSV/.test(L) && /toJSON/.test(L) && /sheet:/.test(L), {});

/* ==========================================================================
   B · A THIRD IMPLEMENTATION
   Every function below reaches the same number by a route the layer does not
   take. Nothing here is imported from the layer; the layer is a string.
   ========================================================================== */
console.log('\nB · reference values recomputed independently inside the gate');

const G = {};

// constant product: root-find dy such that (rx + ax)·(ry − dy) = rx·ry.
// The layer forms the ratio directly (A) and subtracts k/rx' (B). This does neither.
G['amm.cp.out'] = i => {
  const ax = i.dx * (1 - i.feeBps / 1e4), k = i.rx * i.ry;
  let lo = 0, hi = i.ry;
  for (let n = 0; n < 200; n++) {
    const mid = (lo + hi) / 2;
    if ((i.rx + ax) * (i.ry - mid) > k) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
};
// impact from the root-found output, against the pre-trade mid
G['amm.cp.impact'] = i => {
  const out = G['amm.cp.out'](i), mid = i.ry / i.rx;
  return (mid - out / i.dx) / mid * 1e4;
};
// v3 amounts by INTEGRATING the position's own derivative.
// x(P) = L(1/√P − 1/√Pb) so dx/dP = −L/(2·P^1.5) and x(Pb) = 0.
// y(P) = L(√P − √Pa) so dy/dP = L/(2·√P) and y(Pa) = 0.
function simpson(f, a, b, n) {
  if (n % 2) n += 1;
  const h = (b - a) / n; let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return s * h / 3;
}
G['v3.amount0'] = i => simpson(p => i.L / (2 * Math.pow(p, 1.5)), i.P, i.Pb, 40000);
G['v3.amount1'] = i => simpson(p => i.L / (2 * Math.sqrt(p)), i.Pa, i.P, 40000);
// divergence loss: solve the 50/50 condition x·P = y on the curve x·y = k by bisection,
// then value the two sides. No closed form, and no direct √(k·P) either.
G['il.divergence'] = i => {
  const k = 1, P = i.r;
  let lo = 1e-12, hi = 1e12;
  // f(x) = x·P − k/x is increasing in x, so the bracket moves the other way
  for (let n = 0; n < 300; n++) { const x = Math.sqrt(lo * hi); if (x * P < k / x) lo = x; else hi = x; }
  const x1 = Math.sqrt(lo * hi), y1 = k / x1;
  return (x1 * P + y1) / (1 * P + 1) - 1;
};
// break-even APR: bisect on the APR that makes fee income exactly cancel the loss
G['il.breakeven'] = i => {
  const il = G['il.divergence']({ r: i.r });
  let lo = 0, hi = 1e6;
  for (let n = 0; n < 300; n++) {
    const a = (lo + hi) / 2;
    if ((1 + il) * Math.pow(1 + a, i.days / 365) < 1) lo = a; else hi = a;
  }
  return (lo + hi) / 2;
};
// maintenance margin: the UPPER ENVELOPE of the bracket lines. The ladder's rates increase,
// so the piecewise function is convex and equals max(N·rate_k − cum_k) over all k. The layer
// reads one bracket (A) and sums marginal slices (B); neither takes a maximum.
const LADDER = [[50000, 0.004, 0], [250000, 0.005, 50], [1000000, 0.01, 1300], [10000000, 0.025, 16300]];
function mmEnvelope(n) {
  let best = -Infinity;
  for (let k = 0; k < LADDER.length; k++) best = Math.max(best, n * LADDER[k][1] - LADDER[k][2]);
  return best;
}
G['perp.mm'] = i => mmEnvelope(i.notional);
// liquidation price by the SECANT method on equity − maintenance margin, with the envelope
// maintenance margin. Neither the bracket algebra nor the marginal sum is on this path.
G['perp.liq'] = i => {
  const f = P => (i.margin + (i.side === 'short' ? i.qty * (i.entry - P) : i.qty * (P - i.entry))) - mmEnvelope(i.qty * P);
  let x0 = i.entry * (i.side === 'short' ? 1.02 : 0.98), x1 = i.entry * (i.side === 'short' ? 1.5 : 0.5);
  let f0 = f(x0), f1 = f(x1);
  for (let n = 0; n < 300 && Math.abs(f1) > 1e-12; n++) {
    const d = (f1 - f0); if (!d) break;
    const x2 = x1 - f1 * (x1 - x0) / d;
    x0 = x1; f0 = f1; x1 = x2; f1 = f(x1);
  }
  return x1;
};
// funding: accumulate whole settlements one at a time, then the fractional tail
G['perp.funding'] = i => {
  const whole = Math.floor(i.hours / 8); let tot = 0;
  for (let n = 0; n < whole; n++) tot += i.notional * i.rate8h;
  return tot + i.notional * i.rate8h * ((i.hours - whole * 8) / 8);
};
// Sharpe: sample variance from the PAIRWISE-DIFFERENCES identity
//   s² = Σ_{i<j}(x_i − x_j)² / (n(n−1))
// which touches neither the mean nor Σx². (Two-pass is A, one-pass Σx² is B.)
G['risk.sharpe'] = i => {
  const x = i.returns, n = x.length; let s = 0, m = 0;
  for (let a = 0; a < n; a++) { m += x[a]; for (let b = a + 1; b < n; b++) s += (x[a] - x[b]) * (x[a] - x[b]); }
  const varS = s / (n * (n - 1)), sd = Math.sqrt(varS);
  return ((m / n) - i.rf) / sd * Math.sqrt(i.periods);
};
// max drawdown scanned from the RIGHT: for each start, the running minimum to its right
G['risk.maxdd'] = i => {
  const e = i.equity, n = e.length; let mn = e[n - 1], mx = 0;
  for (let a = n - 2; a >= 0; a--) { if (e[a] > 0) mx = Math.max(mx, (e[a] - mn) / e[a]); if (e[a] < mn) mn = e[a]; }
  return mx;
};
// historical VaR via the 1-BASED rank form of PERCENTILE.INC: rank = p(n−1)+1, then
// interpolate between the floor and ceiling ranks. Different index arithmetic again.
G['risk.var.hist'] = i => {
  const s = i.returns.slice().sort((a, b) => a - b), n = s.length;
  const rank = (1 - i.confidence) * (n - 1) + 1;
  const lo = Math.floor(rank), hi = Math.ceil(rank), frac = rank - lo;
  const q = s[lo - 1] + frac * (s[hi - 1] - s[lo - 1]);
  return -q * i.notional;
};
// parametric VaR from the PUBLISHED standard normal quantiles rather than from any
// approximation at all — the gate looks the number up, it does not compute it.
const Z_TABLE = { 0.9: 1.2815515655446004, 0.95: 1.6448536269514722, 0.975: 1.959963984540054, 0.99: 2.3263478740408408 };
G['risk.var.param'] = i => {
  const z = Z_TABLE[i.confidence];
  return z === undefined ? null : -(i.mu - z * i.sigma) * i.notional;
};
// Black-Scholes with a DELIBERATELY COARSER normal CDF: Abramowitz & Stegun 26.2.17,
// |error| < 7.5e-8 in Φ, so these three cases carry a 1e-4 tolerance rather than the
// layer's 1e-9. A coarse third opinion that agrees to 1e-4 still rules out every bug
// this gate exists to catch; pretending to machine precision here would be dishonest.
function ncdfAS(x) {
  const s = x < 0 ? -1 : 1, z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + s * y);
}
function bsAS(cp, i) {
  const sT = i.sigma * Math.sqrt(i.T);
  const d1 = (Math.log(i.S / i.K) + (i.r - i.q + i.sigma * i.sigma / 2) * i.T) / sT, d2 = d1 - sT;
  return cp === 'call'
    ? i.S * Math.exp(-i.q * i.T) * ncdfAS(d1) - i.K * Math.exp(-i.r * i.T) * ncdfAS(d2)
    : i.K * Math.exp(-i.r * i.T) * ncdfAS(-d2) - i.S * Math.exp(-i.q * i.T) * ncdfAS(-d1);
}
G['opt.bs.call'] = i => bsAS('call', i);
G['opt.bs.put'] = i => bsAS('put', i);
G['opt.bs.parity'] = i => (bsAS('call', i) - bsAS('put', i)) - (i.S * Math.exp(-i.q * i.T) - i.K * Math.exp(-i.r * i.T));
// health factor by summing RATIOS rather than dividing sums — each collateral row is
// expressed as a fraction of total debt first, and the fractions are added.
G['lend.hf'] = i => {
  let d = 0; i.debt.forEach(r => { d += r[0] * r[1]; });
  if (!(d > 0)) return null;
  let hf = 0; i.collateral.forEach((r, k) => { hf += (r[0] * r[1] * i.thresholds[k]) / d; });
  return hf;
};
// book walk by COMPLEMENT: price the whole book, then subtract the part left untouched.
G['book.walk'] = i => {
  let total = 0, depth = 0;
  i.levels.forEach(l => { total += l[0] * l[1]; depth += l[1]; });
  const q = Math.min(i.qty, depth);
  let left = depth - q, tail = 0;
  for (let k = i.levels.length - 1; k >= 0 && left > 1e-15; k--) {
    const take = Math.min(left, i.levels[k][1]);
    tail += take * i.levels[k][0]; left -= take;
  }
  return (total - tail) / q;
};
// cost basis by COMPLEMENT too: the basis of every lot, minus the basis of what is left
// after the disposal. The layer drains forward (A) and integrates an interval (B).
function basisComplement(lots, sell, price, hifo) {
  const L2 = lots.slice();
  if (hifo) L2.sort((a, b) => b[1] - a[1]);
  let total = 0, depth = 0;
  L2.forEach(l => { total += l[0] * l[1]; depth += l[0]; });
  const q = Math.min(sell, depth);
  let left = depth - q, rest = 0;
  for (let k = L2.length - 1; k >= 0 && left > 1e-15; k--) {
    const take = Math.min(left, L2[k][0]);
    rest += take * L2[k][1]; left -= take;
  }
  return q * price - (total - rest);
}
G['tax.fifo'] = i => basisComplement(i.lots, i.sell, i.price, false);
G['tax.hifo'] = i => basisComplement(i.lots, i.sell, i.price, true);

// Tolerances the gate measures against. Where the third implementation is coarser than the
// layer's two, the looser figure is stated here in the open rather than buried in a helper.
const GATE_TOL = {
  'amm.cp.out': 1e-6, 'amm.cp.impact': 1e-6,
  'v3.amount0': 1e-9, 'v3.amount1': 1e-7,
  'il.divergence': 1e-10, 'il.breakeven': 1e-7,
  'perp.mm': 1e-9, 'perp.liq': 1e-6, 'perp.funding': 1e-9,
  'risk.sharpe': 1e-9, 'risk.maxdd': 1e-12,
  'risk.var.hist': 1e-9, 'risk.var.param': 1e-9,
  // A&S 26.2.17 is good to 7.5e-8 in Φ, which is about 1e-5 on a price of this size
  'opt.bs.call': 1e-4, 'opt.bs.put': 1e-4, 'opt.bs.parity': 1e-4,
  'lend.hf': 1e-12, 'book.walk': 1e-7, 'tax.fifo': 1e-9, 'tax.hifo': 1e-9
};

let recomputed = 0, agreed = 0;
const covered = {};
REFCASES.forEach(c => {
  const f = G[c.fid];
  if (!f) return;
  let got = null, err = null;
  try { got = f(c['in']); } catch (e) { err = String(e && e.message || e); }
  if (got === null || got === undefined) return;
  recomputed++;
  covered[c.fid] = true;
  const tol = GATE_TOL[c.fid] === undefined ? Math.max(c.tol, 1e-9) : GATE_TOL[c.fid];
  const d = got - c.expect;
  const good = isFinite(d) && Math.abs(d) <= tol;
  if (good) agreed++;
  ok('verify · ' + c.id + ' (' + c.fid + ') — the payload claims ' + c.expect + ', the gate\'s third implementation gets ' + got,
    good, { delta: d, tol: tol, error: err, cite: c.cite });
});

ok('verify · the gate recomputed at least 12 of the payload\'s reference values with its own implementation',
  recomputed >= 12, { recomputed: recomputed, agreed: agreed });
ok('verify · the gate\'s coverage spans at least 10 distinct formulas, not 12 cases of one',
  Object.keys(covered).length >= 10, { formulas: Object.keys(covered).sort() });
ok('verify · every formula the gate can recompute, it did recompute — no case was quietly skipped',
  REFCASES.filter(c => G[c.fid]).length === recomputed,
  { eligible: REFCASES.filter(c => G[c.fid]).length, recomputed: recomputed });

// The maintenance-amount column is not free: cum(k+1) = cum(k) + cap(k)·(rate(k+1) − rate(k))
// is exactly what makes the ladder continuous, and the payload ships those four numbers.
{
  let cum = 0, consistent = true;
  for (let k = 1; k < LADDER.length; k++) {
    cum = cum + LADDER[k - 1][0] * (LADDER[k][1] - LADDER[k - 1][1]);
    if (Math.abs(cum - LADDER[k][2]) > 1e-9) consistent = false;
  }
  ok('verify · the published maintenance-amount column is internally consistent with the rate column, and the payload ships the same ladder',
    consistent && /\[50000, 0\.004, 0\], \[250000, 0\.005, 50\], \[1000000, 0\.01, 1300\], \[10000000, 0\.025, 16300\]/.test(L),
    { consistent: consistent, inPayload: /16300/.test(L) });
}

console.log('\n' + pass + ' passed · ' + fail + ' failed');
process.exit(fail);
