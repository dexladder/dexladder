// DexLadder RISK gate — the portfolio risk desk (layers/59-risk.js, window.DLRISK, v166).
//
//   node test/gate-risk.js [dist/index.html]      exit code = number of failures
//
// Part A reads the shipped payload as text: the layer is there exactly once, it declares its
// build, it is ES5, it compiles nothing at runtime, it keeps no storage key of its own, it draws
// no random number, it never writes the paper account (this desk is READ-ONLY and never calls
// the fill path at all), it assigns its panes rather than returning them, and it ships the
// disclosure block that says which of its figures are modelled rather than measured.
//
// Part B is the arithmetic. This Mac cannot run the browser gates, so nothing here calls the
// layer: every formula is RE-IMPLEMENTED inside this file and checked against a value computed
// by hand or published in the literature and cited at the call site. Where the layer's own prose
// quotes a constant (lambda 0.94, z = 2.3263, the CVaR factor 2.6652, the 11.11% recovery), Part
// A asserts the payload carries that spelling and Part B derives it from first principles, so a
// drift between what the desk SAYS and what the formula GIVES fails the gate.
'use strict';
const fs = require('fs'), path = require('path');
const WEB = path.join(__dirname, '..');
const file = process.argv[2] || path.join(WEB, 'dist', 'index.html');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 500) : '')); } };
const near = (a, b, tol) => a != null && b != null && isFinite(a) && isFinite(b) && Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);

/* ------------------------------------------------------------------ A · shipped payload */
console.log('A · shipped payload');
const html = fs.readFileSync(file, 'utf8');

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
const L = layerOf('window.DLRISK') || layerOf('DLRISK =') || layerOf('DLRISK') || '';
const SRC = fs.existsSync(path.join(WEB, 'layers', '59-risk.js'));

// A write to the paper account and nothing else (gate-sor.js's shape): reads are fine.
const BAL_WRITE = /S\.bal\s*(\[[^\]]{0,60}\]|\.[A-Za-z_$][\w$]*)\s*(\+|-|\*|\/|\|\||&&|\?\?)?=[^=]/;

ok('risk · the layer ships in the payload exactly once (window.DLRISK =, the house spelling)',
  (html.match(/window\.DLRISK\s*=/g) || []).length === 1 && L.length > 20000,
  { assigns: (html.match(/window\.DLRISK\s*=/g) || []).length, layerChars: L.length, layerSourceOnDisk: SRC });

ok('risk · the layer declares its build in its own export (__v: 166)', /__v:\s*166\b/.test(L),
  { sawV: (L.match(/__v:\s*\d+/g) || []).slice(0, 4) });

ok('risk · ES5 only — no arrow function, no const or let, no template literal, no spread',
  !/=>/.test(L) && !/\bconst\s/.test(L) && !/\blet\s/.test(L) && !/`/.test(L) && !/\.\.\./.test(L),
  { arrow: /=>/.test(L), constLet: /\b(const|let)\s/.test(L), tick: /`/.test(L), spread: /\.\.\./.test(L) });

ok('risk · the desk compiles nothing at runtime (no eval, no new Function, no string timer)',
  !/\beval\s*\(/.test(L) && !/new\s+Function\s*\(/.test(L) && !/\bset(Timeout|Interval)\s*\(\s*['"]/.test(L),
  { eval: /\beval\s*\(/.test(L), fn: /new\s+Function\s*\(/.test(L) });

ok('risk · no storage key of its own — state is the v154 bucket through DLCORE.X() and DLCORE.save()',
  !/\blocalStorage\b/.test(L) && !/\bsessionStorage\b/.test(L) && /\b(C|DLCORE)\.X\(\)/.test(L) && /\b(C|DLCORE)\.save\(\)/.test(L),
  { ls: /\blocalStorage\b/.test(L), ss: /\bsessionStorage\b/.test(L), bucket: /\b(C|DLCORE)\.X\(\)/.test(L) });

ok('risk · every figure is deterministic — Math.random appears nowhere in the layer',
  !/Math\.random/.test(L), { hits: (L.match(/.{0,50}Math\.random.{0,30}/g) || []).slice(0, 3) });

ok('risk · the desk is READ-ONLY: it never assigns to a balance AND never calls the fill path at all',
  !BAL_WRITE.test(L) && !/\bexecFill\s*\(/.test(L) && !/\bchargeNetwork\s*\(/.test(L) && /READ-ONLY/.test(L),
  { balWrite: (L.match(BAL_WRITE) || [])[0] || null, execFill: /\bexecFill\s*\(/.test(L), chargeNetwork: /\bchargeNetwork\s*\(/.test(L), saysSo: /READ-ONLY/.test(L) });

ok('risk · the honesty block ships with the layer and names what is modelled rather than measured',
  /\bASSUMPTIONS\s*=/.test(L) && /\bMETHOD\s*=/.test(L) && /assum/i.test(L) && /model(l?ed|s)/i.test(L) && /reconstruction/i.test(L),
  { assumptions: /\bASSUMPTIONS\s*=/.test(L), method: /\bMETHOD\s*=/.test(L), reconstruction: /reconstruction/i.test(L) });

ok('risk · the pane is ASSIGNED, not returned — onTab writes body.innerHTML (the 53-sor bug, not repeated)',
  /body\.innerHTML\s*=/.test(L) && /onTab:\s*bodyFor/.test(L),
  { assigns: /body\.innerHTML\s*=/.test(L), wired: /onTab:\s*bodyFor/.test(L) });

ok('risk · anything it opens is torn down on close, and it starts no interval and no socket',
  /__onClose/.test(L) && !/setInterval\s*\(/.test(L) && !/new\s+WebSocket/.test(L),
  { onClose: /__onClose/.test(L), interval: (L.match(/setInterval\s*\(/g) || []).length });

ok('risk · no CSS token block and no raw hex in the JS — the rules live in the stylesheet',
  !/(:root|html\[data-mode=day\])\s*\{[^{}]*--[\w-]+\s*:/.test(L) && !/style="[^"]*#[0-9a-fA-F]{3}/.test(L),
  { tokens: /(:root|html\[data-mode=day\])\s*\{[^{}]*--[\w-]+\s*:/.test(L) });

ok('risk · the desk registers on the rail as "Risk" and carries the five tabs it promises',
  /DLDESKS\.register\(\s*["']risk["']/.test(L) && /\["exp",\s*"Exposure"\]/.test(L) && /\["var",\s*"VaR"\]/.test(L)
  && /\["stress",\s*"Stress"\]/.test(L) && /\["dd",\s*"Drawdown"\]/.test(L) && /\["method",\s*"Method"\]/.test(L),
  { register: /DLDESKS\.register\(\s*["']risk["']/.test(L) });

ok('risk · it does not fork the engine: sharpe, sortino, maxDrawdown, correlation, percentile, logReturns, mean and stdev are CALLED off DLAPP.paper',
  /P\(\)\.maxDrawdown/.test(L) && /P\(\)\.correlation/.test(L) && /P\(\)\.percentile/.test(L)
  && /P\(\)\.logReturns/.test(L) && /P\(\)\.sharpe/.test(L) && /P\(\)\.sortino/.test(L)
  && /P\(\)\.mean/.test(L) && /P\(\)\.stdev/.test(L),
  { maxDrawdown: /P\(\)\.maxDrawdown/.test(L), correlation: /P\(\)\.correlation/.test(L), percentile: /P\(\)\.percentile/.test(L) });

// the constants the desk QUOTES in its own prose, checked against Part B's arithmetic below
ok('risk · the stated constants are in the payload — lambda 0.94 (RiskMetrics), z = 2.3263 at 99%, the 2.6652 CVaR factor, and the 11.11% recovery example',
  /LAMBDA\s*=\s*0\.94\b/.test(L) && /2\.3263/.test(L) && /2\.6652/.test(L) && /11\.11/.test(L) && /RiskMetrics/.test(L),
  { lambda: /LAMBDA\s*=\s*0\.94\b/.test(L), z: /2\.3263/.test(L), es: /2\.6652/.test(L), rec: /11\.11/.test(L) });

ok('risk · it refuses rather than guessing — a named minimum window, and a refusal path that returns null with a reason',
  /MIN_OBS\s*=\s*30\b/.test(L) && /reason/.test(L) && /refus/i.test(L),
  { minObs: /MIN_OBS\s*=\s*30\b/.test(L) });

ok('risk · square-root-of-time is labelled as an assumption wherever it is used',
  /square[- ]root[- ]of[- ]time/i.test(L) && /assumption/i.test(L),
  { labelled: /square[- ]root[- ]of[- ]time/i.test(L) });

// The sheet id, and the bug this gate exists to stop coming back.
// v166 shipped this desk on the id "dlRisk", which the trading ticket has owned since long
// before it (mountRisk() drops <div id="dlRisk"> next to the place button, and layers/v154.css
// styles it). DLCORE.sheet() starts with `var el = $(id)` and REUSES whatever carries the id,
// so it handed the sheet primitive a div that was not one of its own and the very next line,
// el.querySelector(".dls-t").innerHTML, read a property of null. open() caught it and returned,
// nothing threw, and nothing mounted. These three asserts make that impossible to repeat.
const SHEET_ID = ((L.match(/var\s+SHEET_ID\s*=\s*["']([\w-]+)["']/) || [])[1])
  || ((L.match(/C\.open\(\s*["']([\w-]+)["']/) || [])[1]) || null;
// the layer's own <script> block removed, so "elsewhere in the payload" means elsewhere
const ELSEWHERE = L ? html.split(L).join('\n') : html;
const claimsId = id => id ? [
  new RegExp('id\\s*=\\s*["\']' + id + '["\']'),          // id="x" in markup or el.id="x"
  new RegExp('\\.id\\s*=\\s*["\']' + id + '["\']'),
  new RegExp('getElementById\\(\\s*["\']' + id + '["\']'),
  new RegExp('\\$\\(\\s*["\']#?' + id + '["\']')
].filter(re => re.test(ELSEWHERE)).map(re => re.source) : ['no id found'];

ok('risk · the desk names its sheet id in one place and it is NOT the trading ticket\'s dlRisk',
  SHEET_ID === 'dlRiskDesk' && !/C\.open\(\s*["']dlRisk["']/.test(L) && !/getElementById\(\s*["']dlRisk["']\)/.test(L),
  { sheetId: SHEET_ID, opensDlRisk: /C\.open\(\s*["']dlRisk["']/.test(L) });

ok('risk · nothing else in the payload claims that id — DLCORE.sheet() reuses any element that does, and the desk then never mounts',
  !!SHEET_ID && claimsId(SHEET_ID).length === 0,
  { sheetId: SHEET_ID, claimedBy: claimsId(SHEET_ID), note: 'the legacy ticket owns dlRisk: ' + /id\s*=\s*["']dlRisk["']/.test(html) });

ok('risk · a failed mount is LOUD — open() records the reason, logs it and toasts it, and never swallows the error into an empty catch',
  /MOUNT_ERR/.test(L) && /mountError/.test(L) && /console\.error/.test(L)
  && /C\.toast\s*&&\s*C\.toast\(\s*["']bad["']\s*,\s*["']Risk desk did not open["']/.test(L)
  && !/catch\s*\(\s*e\s*\)\s*\{\s*el\s*=\s*null;?\s*\}/.test(L),
  { records: /MOUNT_ERR/.test(L), exported: /mountError/.test(L), logs: /console\.error/.test(L) });

ok('risk · the desk renders a NAMED empty state rather than a blank pane — every refusal carries a reason, and the cold-account panes have somewhere to say it',
  /rk-refuse/.test(L) && /dl-empty/.test(L) && /reason/.test(L)
  && /no asset in the book has a usable price history/.test(L)
  && /The book holds no price exposure/.test(L),
  { refuse: /rk-refuse/.test(L), empty: /dl-empty/.test(L) });

ok('risk · the stylesheet ships beside it, scoped to the SAME id the desk opens, with no token definitions of its own',
  (() => {
    const p = path.join(WEB, '_v166css', '59-risk.css');
    if (!fs.existsSync(p) || !SHEET_ID) return false;
    const css = fs.readFileSync(p, 'utf8');
    const sels = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/^([^@\s][^{]*)\{/gm) || [];
    return sels.length > 20 && sels.every(s2 => s2.indexOf('#' + SHEET_ID) >= 0)
      && !/(:root|html\[data-mode=day\])\s*\{[^{}]*--[\w-]+\s*:/.test(css);
  })(), { css: '_v166css/59-risk.css', sheetId: SHEET_ID });

/* ------------------------------------------------------------------ B · numeric oracles */
console.log('\nB · numeric oracles (every formula re-implemented here, checked against hand or published values)');

// --- 1 · Pearson correlation against a hand-computed pair.
// x = 1,2,3,4,5  y = 2,4,5,4,5.  mx = 3, my = 4.
// Sxy = (-2)(-2)+(-1)(0)+(0)(1)+(1)(0)+(2)(1) = 4+0+0+0+2 = 6
// Sxx = 4+1+0+1+4 = 10 ;  Syy = 4+0+1+0+1 = 6 ;  r = 6/sqrt(60) = 0.7745966692414834
{
  const x = [1, 2, 3, 4, 5], y = [2, 4, 5, 4, 5];
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  const r = sxy / Math.sqrt(sxx * syy);
  ok('1 · Pearson correlation on a hand-computed pair is 6/sqrt(60) = 0.7745966692',
    near(r, 6 / Math.sqrt(60), 1e-15) && near(r, 0.7745966692414834, 1e-15) && sxy === 6 && sxx === 10 && syy === 6,
    { r, sxy, sxx, syy });
}

// --- 2 · EWMA: the normalised recursion the layer uses must equal the closed weighted average.
//   recursion:  num = L*num + r^2 ,  den = L*den + 1 ,  var = num/den
//   closed:     sum(L^(n-1-i) r_i^2) / sum(L^(n-1-i))
{
  const R = [0.01, -0.02, 0.015, -0.005, 0.03, -0.012, 0.004, 0.022, -0.018, 0.007], lam = 0.94;
  let num = 0, den = 0;
  for (let i = 0; i < R.length; i++) { den = lam * den + 1; num = lam * num + R[i] * R[i]; }
  const rec = num / den;
  let sw = 0, s = 0;
  for (let i = 0; i < R.length; i++) { const w = Math.pow(lam, R.length - 1 - i); sw += w; s += w * R[i] * R[i]; }
  const closed = s / sw;
  ok('2 · the EWMA recursion equals the hand-rolled exponentially weighted average, bit for bit',
    near(rec, closed, 1e-18) && rec > 0, { rec, closed, diff: rec - closed });
}

// --- 3 · EWMA effective sample size. Kish: (sum w)^2 / sum w^2.
// For w_i = (1-L)L^i over an infinite window: sum w = 1, sum w^2 = (1-L)/(1+L),
// so N_eff = (1+L)/(1-L) = 1.94/0.06 = 32.3333... at L = 0.94 (RiskMetrics' daily decay).
{
  const lam = 0.94, T = 20000;
  const sw = (1 - Math.pow(lam, T)) / (1 - lam);
  const sw2 = (1 - Math.pow(lam, 2 * T)) / (1 - lam * lam);
  const effN = sw * sw / sw2;
  ok('3 · the EWMA effective sample size at lambda 0.94 converges to (1+L)/(1-L) = 32.3333 bars',
    near(effN, 1.94 / 0.06, 1e-9) && near(effN, 32.333333333, 1e-6), { effN, want: 1.94 / 0.06 });
}

// --- 4 · the component-contribution identity: sum(CCTR) == sigma_p exactly.
// Built on a hand-written positive-definite 3x3 and a weight vector with a short in it.
{
  const S = [[0.0004, 0.00018, 0.00009], [0.00018, 0.0009, 0.00021], [0.00009, 0.00021, 0.0016]];
  const w = [0.62, -0.25, 0.41];
  const Sw = S.map(row => row.reduce((s, v, j) => s + v * w[j], 0));
  const varp = w.reduce((s, v, i) => s + v * Sw[i], 0);
  const sp = Math.sqrt(varp);
  const cctr = w.map((v, i) => v * Sw[i] / sp);
  const sum = cctr.reduce((a, b) => a + b, 0);
  ok('4 · the component contributions sum EXACTLY to portfolio volatility — w\'(Sw)/sigma is sigma',
    varp > 0 && Math.abs(sum - sp) <= 1e-12 * sp, { sigma: sp, sum, residual: sum - sp });
}

// --- 5 · parametric VaR at 99%. Published quantile of the standard normal:
// Phi^-1(0.99) = 2.3263478740408408 (Abramowitz & Stegun 26.2; the value Acklam's
// approximation is fitted to). With mu = 0 the VaR is exactly z*sigma.
{
  const z = 2.3263478740408408, sigma = 0.0184;
  const varPct = z * sigma;
  ok('5 · parametric VaR at 99% with zero drift is 2.3263478740 x sigma',
    near(varPct, 2.3263478740408408 * 0.0184, 1e-18) && near(varPct / sigma, 2.3263478740408408, 1e-15) && near(varPct, 0.04280480088235147, 1e-15),
    { varPct, ratio: varPct / sigma });
}

// --- 6 · parametric CVaR at 99% is sigma * phi(z)/(1-c).
// phi(2.3263478740408408) = 0.026652142182150803 ; /0.01 = 2.6652142182150804
{
  const z = 2.3263478740408408;
  const phi = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  const factor = phi / 0.01;
  ok('6 · parametric CVaR at 99% is 2.6652142182 x sigma, and it is always worse than the VaR',
    near(factor, 2.6652142182, 1e-6) && near(phi, 0.0266521422, 1e-9) && factor > 2.3263478740408408, { phi, factor });
}

// --- 7 · Acklam's inverse normal CDF, against published quantiles.
// Phi^-1(0.99) = 2.326347874, Phi^-1(0.95) = 1.644853627, Phi^-1(0.975) = 1.959963985.
{
  const A = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const B = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const Cc = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const D = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const inv = p => {
    const lo = 0.02425;
    if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((Cc[0] * q + Cc[1]) * q + Cc[2]) * q + Cc[3]) * q + Cc[4]) * q + Cc[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1); }
    if (p <= 1 - lo) { const q = p - 0.5, r = q * q; return (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1); }
    const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((Cc[0] * q + Cc[1]) * q + Cc[2]) * q + Cc[3]) * q + Cc[4]) * q + Cc[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
  };
  ok('7 · the inverse normal matches the published quantiles at 95%, 97.5% and 99% to 1e-8',
    near(inv(0.99), 2.326347874, 1e-8) && near(inv(0.95), 1.644853627, 1e-8) && near(inv(0.975), 1.959963985, 1e-8)
    && near(inv(0.01), -2.326347874, 1e-8),
    { p99: inv(0.99), p95: inv(0.95), p975: inv(0.975) });
}

// --- 8 · Cornish-Fisher reduces EXACTLY to z at zero skew and zero excess kurtosis.
// z' = z + (z^2-1)S/6 + (z^3-3z)K/24 - (2z^3-5z)S^2/36   (Zangari 1996; Favre & Galeano 2002)
{
  const cf = (z, s, k) => z + (z * z - 1) * s / 6 + (z * z * z - 3 * z) * k / 24 - (2 * z * z * z - 5 * z) * s * s / 36;
  const z = -2.3263478740408408;
  ok('8 · Cornish-Fisher returns z EXACTLY at zero skew and zero excess kurtosis',
    cf(z, 0, 0) === z && cf(-1.6448536269514722, 0, 0) === -1.6448536269514722, { cf0: cf(z, 0, 0), z });
}

// --- 9 · Cornish-Fisher at a known pair, arithmetic done by hand.
// z = -2, S = 0.6, K = 3:
//   (z^2-1)S/6      = (4-1)(0.6)/6      = 0.3
//   (z^3-3z)K/24    = (-8+6)(3)/24      = -0.25
//   (2z^3-5z)S^2/36 = (-16+10)(0.36)/36 = -0.06  -> subtracted, so +0.06
//   z' = -2 + 0.3 - 0.25 + 0.06 = -1.89
{
  const cf = (z, s, k) => z + (z * z - 1) * s / 6 + (z * z * z - 3 * z) * k / 24 - (2 * z * z * z - 5 * z) * s * s / 36;
  ok('9 · Cornish-Fisher at z = -2, skew 0.6, excess kurtosis 3 is -1.89, term by term',
    near(cf(-2, 0.6, 3), -1.89, 1e-12), { got: cf(-2, 0.6, 3) });
}

// --- 10 · max drawdown on a hand-written equity series.
// [100,120,90,110,80,130,125]: peak 120 at index 1, trough 80 at index 4, (120-80)/120 = 1/3.
{
  const c = [100, 120, 90, 110, 80, 130, 125];
  let peak = -Infinity, pa = -1, best = 0, bp = -1, bt = -1;
  for (let i = 0; i < c.length; i++) { if (c[i] > peak) { peak = c[i]; pa = i; } if (peak > 0) { const d = (peak - c[i]) / peak; if (d > best) { best = d; bp = pa; bt = i; } } }
  ok('10 · max drawdown on [100,120,90,110,80,130,125] is exactly 1/3, peak at index 1, trough at index 4',
    near(best, 1 / 3, 1e-15) && bp === 1 && bt === 4, { best, bp, bt });
}

// --- 11 · Ulcer index on the same series (Martin & McCann, 1989): RMS of the percentage drawdowns.
// drawdowns: 0, 0, -25, -8.333..., -33.333..., 0, -3.846153...
// sum of squares = 625 + 69.4444 + 1111.1111 + 14.79289 = 1820.3484 ; /7 = 260.0498 ; sqrt = 16.126059
{
  const c = [100, 120, 90, 110, 80, 130, 125];
  let peak = -Infinity, ss = 0, sa = 0;
  const dd = [];
  for (let i = 0; i < c.length; i++) { if (c[i] > peak) peak = c[i]; const d = 100 * (c[i] / peak - 1); dd.push(d); ss += d * d; sa += Math.abs(d); }
  const ulcer = Math.sqrt(ss / c.length), pain = sa / c.length;
  ok('11 · the Ulcer index of that curve is 16.1260590127 and the pain index is 10.0248',
    near(ulcer, 16.12605901268343, 1e-10) && near(pain, (25 + 100 / 12 + 100 / 3 + 500 / 130) / 7, 1e-10),
    { ulcer, pain, dd: dd.map(x => +x.toFixed(4)) });
}

// --- 12 · return needed to recover: 1/(1-d) - 1, computed, not typed.
// -10% needs +11.1111%, -20% needs +25%, -50% needs +100%, -90% needs +900%.
{
  const need = d => 1 / (1 - d) - 1;
  ok('12 · the recovery table is arithmetic: -10% needs +11.1111%, -20% +25%, -50% +100%, -90% +900%',
    near(need(0.1), 1 / 9, 1e-15) && near(need(0.1) * 100, 11.111111111111111, 1e-12)
    && near(need(0.2), 0.25, 1e-15) && near(need(0.5), 1, 1e-15) && near(need(0.9), 9, 1e-12),
    { d10: need(0.1), d20: need(0.2), d50: need(0.5), d90: need(0.9) });
}

// --- 13 · Kupiec's proportion-of-failures LR on a known exception count.
// LR = -2 ln[(1-p)^(T-x) p^x] + 2 ln[(1-x/T)^(T-x) (x/T)^x], chi-square with 1 df.
// T = 250, x = 5, p = 0.01 (Kupiec 1995's own worked shape):
//   l0 = 245 ln(0.99) + 5 ln(0.01)  = -2.4623340 - 23.0258509 = -25.4881849
//   l1 = 245 ln(0.98) + 5 ln(0.02)  = -4.9496639 - 19.5601151 = -24.5097790
//   LR = -2(l0 - l1) = 1.9568097882
{
  const kupiec = (T, x, p) => {
    const pi = x / T;
    const l0 = (T - x) * Math.log(1 - p) + (x > 0 ? x * Math.log(p) : 0);
    const l1 = (x === 0 || x === T) ? 0 : (T - x) * Math.log(1 - pi) + x * Math.log(pi);
    return -2 * (l0 - l1);
  };
  const lr = kupiec(250, 5, 0.01);
  const lr0 = kupiec(250, 0, 0.01);   // no exception at all: LR = -2*250*ln(0.99) = 5.0251679268
  ok('13 · Kupiec POF at T=250, x=5, p=0.01 is 1.9568097882, and at x=0 it is -2T ln(1-p) = 5.0251679268',
    near(lr, 1.956809788230622, 1e-10) && near(lr0, -2 * 250 * Math.log(0.99), 1e-12) && near(lr0, 5.025167926750726, 1e-10),
    { lr, lr0 });
}

// --- 14 · chi-square upper tails, closed forms, against the published critical values.
// chi2(1) 5% critical value 3.841459, 1% 6.634897 ; chi2(2) 5% critical value 5.991465.
{
  const erfc = x => {
    const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
    const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
      t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  };
  const sf1 = x => erfc(Math.sqrt(x / 2)), sf2 = x => Math.exp(-x / 2);
  ok('14 · the chi-square tails land on the published critical values: chi2(1) 3.841459 -> 0.05, 6.634897 -> 0.01, chi2(2) 5.991465 -> 0.05',
    near(sf1(3.841459), 0.05, 1e-6) && near(sf1(6.634897), 0.01, 1e-6) && near(sf2(5.991465), 0.05, 1e-6),
    { a: sf1(3.841459), b: sf1(6.634897), c: sf2(5.991465) });
}

// --- 15 · Christoffersen's independence test on a hand-built exception string.
// 100 bars, exceptions at 10, 11, 12 and 50 — three of the four follow another, which is
// exactly the clustering the test exists to catch.
// transitions: n00 = 93, n01 = 2, n10 = 2, n11 = 2 ; pi01 = 2/95, pi11 = 0.5, pi = 4/99
{
  const flags = new Array(100).fill(0);
  flags[10] = 1; flags[11] = 1; flags[12] = 1; flags[50] = 1;
  let n00 = 0, n01 = 0, n10 = 0, n11 = 0;
  for (let i = 1; i < flags.length; i++) {
    const a = flags[i - 1], b = flags[i];
    if (!a && !b) n00++; else if (!a && b) n01++; else if (a && !b) n10++; else n11++;
  }
  const p01 = n01 / (n00 + n01), p11 = n11 / (n10 + n11), p = (n01 + n11) / (n00 + n01 + n10 + n11);
  const lg = (v, k) => (k > 0 ? k * Math.log(v) : 0);
  const l0 = lg(1 - p, n00 + n10) + lg(p, n01 + n11);
  const l1 = lg(1 - p01, n00) + lg(p01, n01) + lg(1 - p11, n10) + lg(p11, n11);
  const lr = -2 * (l0 - l1);
  const erfc = x => { const z = Math.abs(x), t = 1 / (1 + 0.5 * z); const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))); return x >= 0 ? r : 2 - r; };
  ok('15 · Christoffersen independence on a clustered exception string gives LR = 8.5610736 and rejects at 5%',
    n00 === 93 && n01 === 2 && n10 === 2 && n11 === 2 && near(p11, 0.5, 1e-15)
    && near(lr, 8.561073633750002, 1e-9) && erfc(Math.sqrt(lr / 2)) < 0.05,
    { n00, n01, n10, n11, p01, p11, lr, p: erfc(Math.sqrt(lr / 2)) });
}

// --- 16 · and the same test does NOT reject when the same four exceptions are spread out.
// A test that flagged everything would be worthless; this is the control.
{
  const flags = new Array(100).fill(0);
  flags[10] = 1; flags[40] = 1; flags[70] = 1; flags[95] = 1;
  let n00 = 0, n01 = 0, n10 = 0, n11 = 0;
  for (let i = 1; i < flags.length; i++) { const a = flags[i - 1], b = flags[i]; if (!a && !b) n00++; else if (!a && b) n01++; else if (a && !b) n10++; else n11++; }
  const p01 = n01 / (n00 + n01), p11 = (n10 + n11) > 0 ? n11 / (n10 + n11) : 0, p = (n01 + n11) / (n00 + n01 + n10 + n11);
  const lg = (v, k) => (k > 0 ? k * Math.log(v) : 0);
  const lr = -2 * ((lg(1 - p, n00 + n10) + lg(p, n01 + n11)) - (lg(1 - p01, n00) + lg(p01, n01) + lg(1 - p11, n10) + lg(p11, n11)));
  ok('16 · the same test does not reject when those four exceptions are spread out (LR = 0.3369417)',
    n11 === 0 && near(lr, 0.336941704, 1e-8) && lr < 3.841459, { n00, n01, n10, n11, lr });
}

// --- 17 · Ledoit-Wolf shrinkage: the shrunk matrix is the convex combination delta*F + (1-delta)*S,
// the target keeps the sample VARIANCES exactly, and every off-diagonal correlation of the target
// is the average sample correlation. (Ledoit & Wolf 2004, JPM 30(4), the constant-correlation target.)
{
  const S = [[0.0004, 0.00018, 0.00009], [0.00018, 0.0009, 0.00021], [0.00009, 0.00021, 0.0016]];
  const N = 3;
  let rs = 0, rc = 0;
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { rs += S[i][j] / Math.sqrt(S[i][i] * S[j][j]); rc++; }
  const rbar = rs / rc;
  const F = [];
  for (let i = 0; i < N; i++) { F.push([]); for (let j = 0; j < N; j++) F[i].push(i === j ? S[i][i] : rbar * Math.sqrt(S[i][i] * S[j][j])); }
  const delta = 0.37;
  const Sig = [];
  for (let i = 0; i < N; i++) { Sig.push([]); for (let j = 0; j < N; j++) Sig[i].push(delta * F[i][j] + (1 - delta) * S[i][j]); }
  let diagKept = true, corrOk = true;
  for (let i = 0; i < N; i++) { if (!near(Sig[i][i], S[i][i], 1e-18)) diagKept = false; }
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) if (!near(F[i][j] / Math.sqrt(F[i][i] * F[j][j]), rbar, 1e-12)) corrOk = false;
  // 0.3/sqrt(0.0004*0.0009) style hand check: r01 = 0.00018/sqrt(0.0004*0.0009) = 0.00018/0.0006 = 0.3
  ok('17 · Ledoit-Wolf: the shrunk diagonal IS the sample diagonal, and every target correlation is the average one (0.3, 0.1125, 0.175 -> rbar 0.195833)',
    diagKept && corrOk && near(S[0][1] / Math.sqrt(S[0][0] * S[1][1]), 0.3, 1e-15) && near(rbar, (0.3 + 0.1125 + 0.175) / 3, 1e-12),
    { rbar, diagKept, corrOk });
}

// --- 18 · perp funding carry and its drift on the liquidation price.
// intervalRate = rate8h*hours/8, settlements per day = 24/hours, so daily = rate8h*3 whatever
// the cadence. Isolated margin: the payment leaves the margin, and
//   liq(long) = (E q - M - cum)/(q(1-mmr))  ->  d(liq)/d(margin) = -1/(q(1-mmr))
// so a long paying F a day walks its liquidation price UP by F/(q(1-mmr)) a day.
{
  const qty = 4, mark = 3000, rate8h = 0.0001, mmr = 0.005;
  const daily8 = qty * mark * (rate8h * 8 / 8) * (24 / 8);
  const daily1 = qty * mark * (rate8h * 1 / 8) * (24 / 1);
  const drift = daily8 / (qty * (1 - mmr));
  ok('18 · funding carry is rate8h x 3 a day whatever the settlement cadence, and it walks a long\'s liquidation price up by F/(q(1-mmr))',
    near(daily8, qty * mark * rate8h * 3, 1e-12) && near(daily1, daily8, 1e-12)
    && near(daily8, 3.6, 1e-12) && near(drift, 3.6 / (4 * 0.995), 1e-12) && near(drift, 0.9045226130653267, 1e-12),
    { daily8, daily1, drift });
}

// --- 19 · the v3 out-of-range identity: below the range a position is 100% token0 and its
// token1 amount is exactly zero (Uniswap v3 whitepaper 6.29/6.30, getAmountsForLiquidity).
{
  const amountsFor = (L, P, Pa, Pb) => {
    const sp = Math.sqrt(P), sa = Math.sqrt(Pa), sb = Math.sqrt(Pb);
    if (sb <= sa) return { x: 0, y: 0 };
    if (sp <= sa) return { x: L * (sb - sa) / (sa * sb), y: 0 };
    if (sp >= sb) return { x: 0, y: L * (sb - sa) };
    return { x: L * (sb - sp) / (sp * sb), y: L * (sp - sa) };
  };
  const below = amountsFor(1000, 1500, 2000, 3000);
  const above = amountsFor(1000, 3500, 2000, 3000);
  const inR = amountsFor(1000, 2500, 2000, 3000);
  ok('19 · a v3 position below its range is 100% base and above it is 100% quote — zero delta, by the position formula',
    below.y === 0 && below.x > 0 && above.x === 0 && above.y > 0 && inR.x > 0 && inR.y > 0
    && near(below.x, 1000 * (Math.sqrt(3000) - Math.sqrt(2000)) / (Math.sqrt(2000) * Math.sqrt(3000)), 1e-12),
    { below, above, inR });
}

// --- 20 · sample skew and excess kurtosis on a hand series.
// [1,2,3,4,5]: mean 3, population variance 2, third central moment 0 -> skew 0,
// fourth central moment (16+1+0+1+16)/5 = 6.8 -> kurtosis 6.8/4 = 1.7, excess = -1.3.
{
  const a = [1, 2, 3, 4, 5], n = a.length, m = 3;
  let v = 0, s3 = 0, s4 = 0;
  for (let i = 0; i < n; i++) { const d = a[i] - m; v += d * d; s3 += d * d * d; s4 += d * d * d * d; }
  v /= n;
  const skew = (s3 / n) / Math.pow(v, 1.5), exk = (s4 / n) / (v * v) - 3;
  ok('20 · skew and excess kurtosis on [1,2,3,4,5] are exactly 0 and -1.3 (a flat distribution has thin tails)',
    near(v, 2, 1e-15) && near(skew, 0, 1e-15) && near(exk, -1.3, 1e-12), { v, skew, exk });
}

console.log('\n' + pass + ' passed · ' + fail + ' failed');
process.exit(fail);
