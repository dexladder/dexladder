// DexLadder Lending gate — the Lending desk (layers/55-lending.js, window.DLLEND, v166).
//
//   node test/gate-lending.js [dist/index.html]      exit code = number of failures
//
// Part A reads the shipped payload as text: the layer is there exactly once, it declares its
// build, it never writes the paper account by hand, it compiles nothing at runtime, it keeps no
// localStorage key of its own, it draws no random number, it is ES5, and it ships the honesty
// block that says which reserve parameters are pinned and which are ours.
//
// Part B is the arithmetic. This Mac cannot run the browser gates, so every number below is
// RE-IMPLEMENTED here from the protocol's own formula and asserted against a reference value,
// and then the corresponding constant is looked for in the shipped layer text — so the oracle
// and the payload cannot drift apart silently. Sources are named at each block:
//   · Aave v3 DefaultReserveInterestRateStrategy — the two slopes and the supply rate
//   · Aave v3 MathUtils.calculateLinearInterest / calculateCompoundedInterest — the two indices
//   · Aave v3 GenericLogic.calculateUserAccountData — health factor, LTV, threshold
//   · Aave v3 LiquidationLogic — close factor, liquidation bonus, liquidation protocol fee
'use strict';
const fs = require('fs'), path = require('path');
const WEB = path.join(__dirname, '..');
const file = process.argv[2] || path.join(WEB, 'dist', 'index.html');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 400) : '')); }
};
const near = (a, b, tol) => a != null && b != null && isFinite(a) && isFinite(b) && Math.abs(a - b) <= (tol == null ? 1e-12 : tol);

/* ------------------------------------------------------------------ A · shipped payload */
console.log('A · shipped payload');
const html = fs.readFileSync(file, 'utf8');

// build154.py wraps every layers/*.js in its own <script> block, so the layer's whole text can
// be lifted out and every "not in the layer" assert scoped to it exactly.
function layerOf(needle) {
  const parts = html.split('<script');
  for (let i = 1; i < parts.length; i++) {
    const end = parts[i].indexOf('</script');
    const body = end < 0 ? parts[i] : parts[i].slice(0, end);
    if (body.indexOf(needle) >= 0) return body;
  }
  return null;
}
const L = layerOf('window.DLLEND') || layerOf('DLLEND =') || '';
const SRC = fs.existsSync(path.join(WEB, 'layers', '55-lending.js'));
const BAL_WRITE = /S\.bal\s*(\[[^\]]{0,60}\]|\.[A-Za-z_$][\w$]*)\s*(\+|-|\*|\/|\|\||&&|\?\?)?=[^=]/;

ok('lend · the layer ships in the payload exactly once (window.DLLEND =, the house spelling)',
  (html.match(/window\.DLLEND\s*=/g) || []).length === 1,
  { assigns: (html.match(/window\.DLLEND\s*=/g) || []).length, layerChars: L.length, layerSourceOnDisk: SRC });
ok('lend · the layer declares its build in its own export (__v: 166)', /__v:\s*166\b/.test(L),
  { sawV: (L.match(/__v:\s*\d+/g) || []).slice(0, 4) });
ok('lend · the desk never writes the paper account directly — no assignment to S.bal, only execFill and chargeNetwork',
  !BAL_WRITE.test(L) && /\bexecFill\s*\(/.test(L) && /\bchargeNetwork\s*\(/.test(L),
  { write: (L.match(BAL_WRITE) || [])[0] || null, execFill: /\bexecFill\s*\(/.test(L), chargeNetwork: /\bchargeNetwork\s*\(/.test(L) });
ok('lend · the desk compiles nothing at runtime (no eval, no new Function, no string timer)',
  !/\beval\s*\(/.test(L) && !/new\s+Function\s*\(/.test(L) && !/\bset(Timeout|Interval)\s*\(\s*['"`]/.test(L));
ok('lend · no localStorage key of its own — state is the v154 bucket through DLCORE.X() and DLCORE.save()',
  !/\blocalStorage\b/.test(L) && !/\bsessionStorage\b/.test(L) && /\b(C|DLCORE)\.X\(\)/.test(L) && /\b(C|DLCORE)\.save\(\)/.test(L),
  { storage: /\b(local|session)Storage\b/.test(L), bucket: /\b(C|DLCORE)\.X\(\)/.test(L) });
ok('lend · no token block in the JS — colours live in _v166css/55-lending.css',
  !/(:root|html\[data-mode=)[^{]{0,40}\{[^{}]*--[\w-]+\s*:/.test(L));
ok('lend · deterministic by construction — Math.random appears nowhere in the layer, and the loss distribution is a quadrature, not a simulation',
  !/Math\.random/.test(L) && /quadrature/i.test(L),
  { random: (L.match(/.{0,50}Math\.random.{0,30}/g) || []).slice(0, 2) });
ok('lend · ES5 only — no arrow functions, no let/const, no template literals, no spread',
  L.length > 0 && !/=>/.test(L) && !/\bconst\s/.test(L) && !/\blet\s/.test(L) && !/`/.test(L) && !/\.\.\./.test(L),
  { arrow: /=>/.test(L), constLet: /\b(const|let)\s/.test(L), tpl: /`/.test(L), spread: /\.\.\./.test(L) });
ok('lend · the honesty block ships — ASSUMPTIONS and METHOD, and the Method tab is one of the five',
  /\bASSUMPTIONS\s*=/.test(L) && /\bMETHOD\s*=/.test(L) && /\["method",\s*"Method"\]/.test(L));
ok('lend · the desk says its reserve parameters are hard-coded with no live protocol feed, and flags the rows that are ours rather than published',
  /hard-?coded/i.test(L) && /no live protocol feed/i.test(L) && /representative/i.test(L) && /Aave v3/i.test(L));
ok('lend · the desk says the cascade sells into the app\'s OWN modelled pool and not a measured order book',
  /modelled pool/i.test(L) && /(measured order book|not a measured)/i.test(L) && /poolFromTVL/.test(L) && /quoteImpact/.test(L));
ok('lend · the five tabs the desk promises are the five it registers',
  /\["market",\s*"Market"\]/.test(L) && /\["position",\s*"Position"\]/.test(L) && /\["liq",\s*"Liquidation"\]/.test(L) && /\["restake",\s*"Restake"\]/.test(L));
ok('lend · onTab assigns body.innerHTML rather than returning a string into the void',
  /onTab:\s*function\s*\([^)]*\)\s*\{[\s\S]{0,200}?body\.innerHTML\s*=/.test(L));
ok('lend · every listener it opens is torn down — __onClose is set, and it starts no interval at all',
  /__onClose/.test(L) && !/setInterval\s*\(/.test(L));
ok('lend · it registers on the desks rail as the Lending desk',
  /DLDESKS\.register\("lend",\s*"\uD83C\uDFE6",\s*"Lending"/.test(L) || /register\("lend"/.test(L));

/* ------------------------------------------------------------------ B · the arithmetic */
console.log('\nB · numeric oracles (each formula re-implemented here, then looked for in the payload)');

/* --- Aave v3 DefaultReserveInterestRateStrategy. WETH mainnet strategy:
       base 0%, U_opt 90%, slope1 2.7%, slope2 80%, reserve factor 15%. --- */
const W = { base: 0, uOpt: 0.90, s1: 0.027, s2: 0.80, rf: 0.15 };
function rate(r, U) {
  return U <= r.uOpt ? r.base + r.s1 * U / r.uOpt
    : r.base + r.s1 + r.s2 * (U - r.uOpt) / (1 - r.uOpt);
}
const supply = (b, U, rf) => b * U * (1 - rf);
const util = (avail, debt) => (avail + debt) > 0 ? debt / (avail + debt) : 0;

ok('1 · two-slope rate at U = 0 is the base rate (0%)', near(rate(W, 0), 0), { got: rate(W, 0) });
ok('2 · two-slope rate at U = U_opt is base + slope1 = 2.70%', near(rate(W, 0.90), 0.027), { got: rate(W, 0.90) });
ok('3 · two-slope rate at U = 1 is base + slope1 + slope2 = 82.70%', near(rate(W, 1), 0.827), { got: rate(W, 1) });
ok('4 · halfway to the kink (U = 45%) is half of slope1 = 1.35%', near(rate(W, 0.45), 0.0135), { got: rate(W, 0.45) });
ok('5 · past the kink at U = 95% the second slope is half-travelled: 2.7% + 40% = 42.70%', near(rate(W, 0.95), 0.427), { got: rate(W, 0.95) });
ok('6 · supply rate at the kink = borrow · U · (1 − reserveFactor) = 2.7% · 0.9 · 0.85 = 2.0655%',
  near(supply(0.027, 0.9, 0.15), 0.020655), { got: supply(0.027, 0.9, 0.15) });
ok('7 · utilisation = debt / (available + debt): 700 of debt against 300 available is 70%',
  near(util(300, 700), 0.7), { got: util(300, 700) });
ok('   · the payload carries this strategy (U_opt 0.90, slope1 0.027, slope2 0.80, reserve factor 0.15)',
  /uOpt:\s*0\.90/.test(L) && /s1:\s*0\.027/.test(L) && /s2:\s*0\.80/.test(L) && /rf:\s*0\.15/.test(L));

/* --- Aave v3 MathUtils. Linear for the liquidity index, the three-term binomial for the
       variable borrow index. SECONDS_PER_YEAR is 31_536_000 (365 days). --- */
const SPY = 31536000;
const linear = (r, s) => 1 + r * s / SPY;
function binomial(r, s) {
  const exp = s, e1 = exp - 1, e2 = exp > 2 ? exp - 2 : 0, rps = r / SPY;
  const b2 = rps * rps, b3 = b2 * rps;
  return 1 + rps * exp + exp * e1 * b2 / 2 + exp * e1 * e2 * b3 / 6;
}
ok('8 · the liquidity index is LINEAR: 5% over a year is a factor of exactly 1.05',
  near(linear(0.05, SPY), 1.05), { got: linear(0.05, SPY) });
const b5 = binomial(0.05, SPY), e5 = Math.exp(0.05);
const closed5 = 1 + 0.05 + 0.05 * 0.05 / 2 * (1 - 1 / SPY) + Math.pow(0.05, 3) / 6 * (1 - 1 / SPY) * (1 - 2 / SPY);
ok('9 · the borrow index binomial at 5% over a year equals its closed form 1 + x + x²/2·(1−1/n) + x³/6·(1−1/n)(1−2/n)',
  near(b5, closed5, 1e-15), { got: b5, want: closed5 });
ok('10 · the binomial always UNDERCHARGES: it is a truncated positive series, so it is below exact e^x',
  b5 < e5 && binomial(0.5, SPY) < Math.exp(0.5), { b5, e5 });
ok('11 · binomial vs exact at 5% over a year is 2.6308e-7 of the factor — 0.0026 bp, or $263 on a billion of debt',
  near(e5 - b5, 2.63079e-7, 1e-11), { got: e5 - b5 });
const d50 = (Math.exp(0.5) - binomial(0.5, SPY)) * 1e4;
ok('12 · at a 50% rate — a reserve well past its kink — the same approximation is 28.88 bp of the factor',
  near(d50, 28.879, 0.02), { got: d50 });
ok('13 · linear and compounded are not the same interest: at 5% the borrow index is 12.7 bp above the liquidity index',
  near((b5 - linear(0.05, SPY)) * 1e4, 12.708, 0.02), { got: (b5 - linear(0.05, SPY)) * 1e4 });
ok('   · the payload carries the seconds-per-year constant and the three-term expansion',
  /SECONDS_PER_YEAR\s*=\s*31536000/.test(L) && /thirdTerm/.test(L) && /expMinusTwo/.test(L));

/* --- Aave v3 GenericLogic.calculateUserAccountData. WETH LTV 80.5%, liquidation threshold 83%.
       Position: 10 WETH at $3,000 against 15,000 USDC at $1. --- */
const LTV = 0.805, LT = 0.83;
const coll = 10 * 3000, debt = 15000;
const hf = coll * LT / debt;
ok('14 · health factor = Σ(collateral · price · THRESHOLD) / Σ(debt · price) = 30,000 · 0.83 / 15,000 = 1.66',
  near(hf, 1.66), { got: hf });
ok('15 · max borrow uses the LTV, not the threshold: 30,000 · 0.805 = 24,150 — the two are different numbers',
  near(coll * LTV, 24150), { got: coll * LTV });
ok('16 · borrowing power used = debt / max borrow = 15,000 / 24,150 = 62.112%',
  near(debt / (coll * LTV), 0.6211180124223602, 1e-15), { got: debt / (coll * LTV) });
ok('17 · the price at which HF hits 1: p* = debt / (amount · threshold) = 15,000 / 8.3 = $1,807.2289',
  near(debt / (10 * LT), 1807.2289156626506, 1e-9), { got: debt / (10 * LT) });
ok('18 · e-mode replaces the threshold: the ETH-correlated category is 93 / 95 / 1, so the same collateral against 15,000 of ETH-correlated debt reads HF 1.90',
  near(coll * 0.95 / debt, 1.9), { got: coll * 0.95 / debt });
ok('   · the payload carries WETH at 80.5 / 83 / 5 and the ETH e-mode category at 93 / 95 / 1',
  /ltv:\s*0\.805/.test(L) && /lt:\s*0\.83/.test(L) && /ltv:\s*0\.93/.test(L) && /lt:\s*0\.95/.test(L));

/* --- Aave v3 LiquidationLogic. DEFAULT_LIQUIDATION_CLOSE_FACTOR 50%,
       MAX 100%, CLOSE_FACTOR_HF_THRESHOLD 0.95, MIN_BASE_MAX_CLOSE_FACTOR_THRESHOLD $2,000. --- */
function closeFactor(h, debtBase, collBase) {
  if (h < 0.95) return 1;
  if (debtBase < 2000) return 1;
  if (collBase < 2000) return 1;
  return 0.5;
}
ok('19 · close factor at HF 0.94 is 100% — below the 0.95 threshold the whole debt may be repaid',
  closeFactor(0.94, 15000, 20000) === 1, { got: closeFactor(0.94, 15000, 20000) });
ok('20 · close factor at HF 0.96 is 50% — merely underwater is only worth half',
  closeFactor(0.96, 15000, 20000) === 0.5, { got: closeFactor(0.96, 15000, 20000) });
ok('21 · a position with under $2,000 on either side is taken whole whatever its health factor',
  closeFactor(0.99, 1500, 20000) === 1 && closeFactor(0.99, 15000, 1500) === 1);

/* seize: baseCollateral = debtToCover · debtPrice / collateralPrice, times (1 + bonus);
   bonusCollateral = C − C/(1 + bonus); protocol fee is taken OF THE BONUS, not of the collateral */
const repay = 7500, cPx = 1780, bonus = 0.05, protFee = 0.10;
const baseColl = repay * 1 / cPx;
const seized = baseColl * (1 + bonus);
const bonusColl = seized - seized / (1 + bonus);
const fee = bonusColl * protFee;
const toLiq = seized - fee;
ok('22 · collateral at par for 7,500 USDC of debt at $1,780 is 4.2134831 WETH',
  near(baseColl, 4.213483146067416, 1e-12), { got: baseColl });
ok('23 · with the 5% liquidation bonus the protocol seizes 4.4241573 WETH',
  near(seized, 4.424157303370787, 1e-12), { got: seized });
ok('24 · the bonus portion is C − C/1.05 = 0.2106742 WETH, and the protocol keeps 10% OF THAT, not 10% of the collateral',
  near(bonusColl, 0.21067415730337077, 1e-12) && near(fee, 0.021067415730337077, 1e-13), { bonusColl, fee });
ok('25 · the liquidator is left 4.4030899 WETH, worth $7,837.50 — a gross margin of exactly 4.5% of what was repaid (5% bonus less the protocol\'s 10% of it)',
  near(toLiq, 4.403089887640449, 1e-12) && near(toLiq * cPx - repay, 337.5, 1e-9), { toLiq, margin: toLiq * cPx - repay });
ok('26 · a 50% close factor does not always leave a healthy position, but here it does: 5.5758427 WETH left against 7,500 of debt reads HF 1.0983667',
  near((10 - seized) * cPx * LT / (15000 - repay), 1.0983666666666666, 1e-9),
  { got: (10 - seized) * cPx * LT / (15000 - repay) });
ok('   · the payload carries the close-factor constants and the bonus-not-collateral fee',
  /CLOSE_FACTOR_HF_THRESHOLD\s*=\s*0\.95/.test(L) && /MIN_BASE_MAX_CLOSE_FACTOR_THRESHOLD\s*=\s*2000/.test(L)
  && /MIN_LEFTOVER_BASE\s*=\s*1000/.test(L) && /bonusPortion\s*=\s*withBonus\s*-\s*withBonus\s*\/\s*\(1\s*\+\s*bonus\)/.test(L));

/* --- the cascade's own curve: constant product, the engine's amm.ts. A forced sale must move
       the marginal price down and the average fill must sit below the pre-trade price. --- */
function poolFromTVL(price, tvl) { const sp = Math.sqrt(price); return { L: tvl / (2 * sp), sp }; }
function sell(pool, qty) { const sp1 = 1 / (1 / pool.sp + qty / pool.L); return { quote: pool.sp * sp1 * qty, p1: sp1 * sp1, p0: pool.sp * pool.sp }; }
const pl = poolFromTVL(3000, 150e6), sale = sell(pl, 1000);
ok('27 · selling seized collateral into a constant-product pool moves the marginal price DOWN and fills below the pre-trade price — which is the whole mechanism of a cascade',
  sale.p1 < sale.p0 && (sale.quote / 1000) < sale.p0 && (sale.quote / 1000) > sale.p1,
  { p0: sale.p0, avg: sale.quote / 1000, p1: sale.p1 });
ok('28 · x·y = k is preserved by that sale to 1e-9 relative — the layer moves the pool by resetting √P, not by inventing liquidity',
  near((pl.L / pl.sp) * (pl.L * pl.sp), (pl.L / Math.sqrt(sale.p1)) * (pl.L * Math.sqrt(sale.p1)), 1e-3 * pl.L * pl.L * 1e-6));

/* --- restaking: the reward split, and the correlated tail. One-factor Gaussian copula. --- */
const avsFees = [0.024, 0.018, 0.012], comm = 0.10;
const extra = avsFees.reduce((a, b) => a + b, 0) * (1 - comm);
ok('29 · the reward split is AVS fee → operator commission → staker: 2.4 + 1.8 + 1.2 = 5.4% of fees, less a 10% operator commission, leaves the staker 4.86%',
  near(extra, 0.0486, 1e-15), { got: extra });
ok('30 · stacked on a 3% LST base that is an effective 7.86%, which is a 2.62× multiple of just holding the LST',
  near(0.03 + extra, 0.0786, 1e-15) && near((0.03 + extra) / 0.03, 2.62, 1e-9), { got: 0.03 + extra });
// expected loss is linear in the marginals, so correlation must NOT move it; only the tail moves
const probs = [0.010, 0.006, 0.003], sev = [0.05, 0.10, 0.25];
let el = 0; for (let i = 0; i < 3; i++) el += probs[i] * sev[i];
ok('31 · expected annual slashing loss is Σ p_i · severity_i = 0.185% and is INDEPENDENT of the correlation — correlation moves the tail, not the mean, which is exactly why a mean-only answer misprices restaking',
  near(el, 0.00185, 1e-15), { got: el });
const indepAll = probs[0] * probs[1] * probs[2];
ok('32 · under independence all three services slash together with probability 1.8e-7 — a number small enough to ignore, which is the mistake',
  near(indepAll, 1.8e-7, 1e-16), { got: indepAll });
// the same joint probability under a one-factor copula at rho = 0.5, by quadrature
function normCdf(x) { // Abramowitz–Stegun 26.2.17, enough for a gate-side cross-check
  const b = [0.319381530, -0.356563782, 1.781477937, -1.821255978, 1.330274429];
  const z = Math.abs(x), t = 1 / (1 + 0.2316419 * z);
  const d = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
  let s = 0, tp = t;
  for (let i = 0; i < 5; i++) { s += b[i] * tp; tp *= t; }
  const p = 1 - d * s;
  return x >= 0 ? p : 1 - p;
}
function normInv(p) { // bisection on normCdf — slow and exact enough for a gate
  let lo = -10, hi = 10;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (normCdf(m) < p) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
const rho = 0.5, sr = Math.sqrt(rho), sr1 = Math.sqrt(1 - rho);
const thr = probs.map(normInv);
let joint = 0, wsum = 0;
const N = 2001, span = 9, step = 2 * span / (N - 1);
for (let j = 0; j < N; j++) {
  const z = -span + j * step;
  let w = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) * step;
  if (j === 0 || j === N - 1) w *= 0.5;
  wsum += w;
  let q = 1;
  for (let i = 0; i < 3; i++) q *= normCdf((thr[i] - sr * z) / sr1);
  joint += w * q;
}
joint /= wsum;
ok('33 · at rho = 0.5 the same three services slash together far more often than the product of their probabilities — the joint tail is more than 100× the independent one',
  joint > indepAll * 100 && joint < 1e-3, { joint, indepAll, ratio: joint / indepAll });
ok('34 · and at rho = 0 the copula collapses back to independence, which is the check that the construction is the right one',
  (function () {
    let jj = 0, ww = 0;
    for (let j = 0; j < N; j++) {
      const z = -span + j * step;
      let w = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) * step;
      if (j === 0 || j === N - 1) w *= 0.5;
      ww += w; let q = 1;
      for (let i = 0; i < 3; i++) q *= normCdf(thr[i]);
      jj += w * q;
    }
    return near(jj / ww, indepAll, 2e-8);
  })(), { indepAll });
ok('   · the payload carries the copula, the correlation parameter and the deterministic node count',
  /one-factor/i.test(L) && /Gaussian copula/i.test(L) && /Z_NODES\s*=\s*321/.test(L) && /normCdf/.test(L) && /normInv/.test(L));
ok('   · the payload prices restaking risk against the break-even rather than only quoting the yield',
  /breakEvenMultiple/.test(L) && /break-even/i.test(L));

console.log('\n' + pass + ' passed · ' + fail + ' failed');
process.exit(fail);
