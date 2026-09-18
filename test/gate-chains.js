// DexLadder CHAINS gate — the cross-chain desk (layers/57-chains.js, window.DLCHAIN, v166).
//
//   node test/gate-chains.js [dist/index.html]      exit code = number of failures
//
// Pure node. This Mac cannot run the browser gates, so there is no Chromium here — but the
// arithmetic is still gated, and gated hard. Part A reads the shipped payload as text: the layer
// is there exactly once, it declares its build, it never writes the paper account, it compiles
// nothing at runtime, it keeps no storage key of its own, it draws no random number, it is ES5,
// and it ships the disclosure that says which half of it is modelled.
//
// Part B lifts the layer's own <script> block out of the payload and runs it in a node vm with
// stub globals, then argues with it. EVERY numeric assertion below is computed a second time
// INSIDE THIS FILE from the published formula, or checked against a published reference value
// that is cited in the comment beside it. Nothing is gated by calling the layer's own helper and
// comparing it to itself.
//
// Published references used:
//   · Uniswap v3 whitepaper eq. 6.29 / 6.30 — dx = L(1/sqrt(Pa) - 1/sqrt(Pb)), dy = L(sqrt(Pb) - sqrt(Pa))
//   · Uniswap v3 development book, the worked position at price 5000 over the range 4545..5500:
//     L = 1519.437308014769 from 1 unit of base, L = 1517.8823437515 from 5000 units of quote
//   · Uniswap v3-core SwapMath.computeSwapStep and Tick.sol's fee-growth-inside identity
//   · EIP-4844 fake_exponential; MIN_BASE_FEE_PER_BLOB_GAS = 1 wei; Cancun update fraction 3338477
//   · OP-stack Ecotone: l1Fee = l1Gas * (baseFeeScalar*16*l1BaseFee + blobScalar*blobBaseFee)/16e6
//   · Orca Whirlpool: 88 ticks per tick array, at most 3 arrays per swap instruction
//   · Abramowitz & Stegun 7.1.26: Phi(1.96) = 0.9750021, Phi(-1) = 0.1586553
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const WEB = path.join(__dirname, '..');
const file = process.argv[2] || path.join(WEB, 'dist', 'index.html');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 400) : '')); }
};
const near = (a, b, tol) => a != null && b != null && isFinite(a) && isFinite(b) && Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
const rel = (a, b, tol) => a != null && b != null && isFinite(a) && isFinite(b) && b !== 0 && Math.abs(a / b - 1) <= (tol === undefined ? 1e-9 : tol);

/* ------------------------------------------------------------------ A · shipped payload */
console.log('A · shipped payload');
const html = fs.readFileSync(file, 'utf8');

// build154.py wraps every layers/*.js in its own <script> block, so the layer's whole text can be
// lifted out and every "not in the layer" assert scoped to it exactly.
function layerOf(needle) {
  const parts = html.split('<script');
  for (let i = 1; i < parts.length; i++) {
    const end = parts[i].indexOf('</script');
    let body = end < 0 ? parts[i] : parts[i].slice(0, end);
    // parts[i] begins immediately after '<script', so the tag's own attributes and
    // its closing '>' are still on the front. Part A only ever regexed this text, so
    // it did not matter there; Part B EXECUTES it, and a stray '>' is a syntax error.
    const gt = body.indexOf('>');
    if (gt >= 0 && gt < 200) body = body.slice(gt + 1);
    if (body.indexOf(needle) >= 0) return body;
  }
  return null;
}
let L = layerOf('window.DLCHAIN =') || layerOf('window.DLCHAIN') || '';
const SRCFILE = path.join(WEB, 'layers', '57-chains.js');
const inPayload = (html.match(/window\.DLCHAIN\s*=/g) || []).length;
if (!L && fs.existsSync(SRCFILE)) {
  console.log('    ! the payload at ' + path.relative(WEB, file) + ' predates this layer.');
  console.log('    ! Part B is being run against layers/57-chains.js so the arithmetic is still gated;');
  console.log('    ! the payload assertion below is the one that must pass at release.');
  L = fs.readFileSync(SRCFILE, 'utf8');
}

// A write to the paper account and nothing else (gate-sor.js's shape).
const BAL_WRITE = /S\.bal\s*(\[[^\]]{0,60}\]|\.[A-Za-z_$][\w$]*)\s*(\+|-|\*|\/|\|\||&&|\?\?)?=[^=]/;

ok('chains · the layer ships in the payload exactly once (window.DLCHAIN =, the house spelling)',
  inPayload === 1 && html.split('window.DLCHAIN =').length === 2,
  { assigns: inPayload, hint: inPayload === 0 ? 'rebuild the payload with build154.py before release' : 'duplicate layer in the payload' });
ok('chains · the layer declares its build in its own export (__v: 166)', /__v:\s*166\b/.test(L), { sawV: (L.match(/__v:\s*\d+/g) || []).slice(0, 4) });
ok('chains · this desk moves no money — no assignment to S.bal, and it never calls execFill or chargeNetwork at all',
  !BAL_WRITE.test(L) && !/\bexecFill\s*\(/.test(L) && !/\bchargeNetwork\s*\(/.test(L),
  { balWrite: (L.match(BAL_WRITE) || [])[0] || null, execFill: /\bexecFill\s*\(/.test(L), chargeNetwork: /\bchargeNetwork\s*\(/.test(L) });
ok('chains · the desk compiles nothing at runtime (no eval, no new Function, no string timer)',
  !/\beval\s*\(/.test(L) && !/new\s+Function\s*\(/.test(L) && !/\bset(Timeout|Interval)\s*\(\s*['"`]/.test(L));
ok('chains · no storage key of its own — state is the v154 bucket through DLCORE.X() and DLCORE.save() — and no token block in the JS',
  !/\blocalStorage\b/.test(L) && !/\bsessionStorage\b/.test(L)
  && /\b(C|DLCORE)\.X\(\)/.test(L) && /\b(C|DLCORE)\.save\(\)/.test(L)
  && !/(:root|html\[data-mode=day\])\s*\{[^{}]*--[\w-]+\s*:/.test(L));
ok('chains · the quote path is deterministic by construction — no random source anywhere in the layer, jitter is an FNV hash',
  !/Math\.random/.test(L) && /2166136261/.test(L),
  { random: (L.match(/.{0,50}Math\.random.{0,30}/g) || []).slice(0, 2), fnv: /2166136261/.test(L) });
ok('chains · ES5 only — no arrow, no const/let, no template literal, no spread',
  !/=>/.test(L) && !/\bconst\s/.test(L) && !/\blet\s/.test(L) && !/`/.test(L) && !/\.\.\./.test(L),
  { arrow: /=>/.test(L), constl: /\bconst\s/.test(L), letl: /\blet\s/.test(L), tick: /`/.test(L), spread: /\.\.\./.test(L) });
ok('chains · the honesty block ships with the layer, and it names what is modelled and what is exact',
  /\bASSUMPTIONS\s*=\s*\[/.test(L) && /\bMETHOD\s*=\s*\[/.test(L)
  && /distribution is modelled/i.test(L) && /arithmetic over it is exact/i.test(L)
  && /no bridge and no l2 is queried live/i.test(L) && /fork node/i.test(L));
ok('chains · anything it opens is torn down on close — it sets __onClose, and it starts no interval at all',
  /__onClose/.test(L) && !/setInterval\s*\(/.test(L));
ok('chains · the sheet body is ASSIGNED, not returned — onTab\'s return value is ignored, which is the bug 53-sor.js shipped',
  /body\.innerHTML\s*=/.test(L));
ok('chains · it registers on the desks rail and the command palette, both guarded',
  /DLDESKS\s*&&\s*window\.DLDESKS\.register|DLDESKS\.register/.test(L) && /C\.cmd\s*&&/.test(L));
ok('chains · a CSS file was written for it and holds no token definitions',
  fs.existsSync(path.join(WEB, '_v166css', '57-chains.css'))
  && !/:root\s*\{/.test(fs.readFileSync(path.join(WEB, '_v166css', '57-chains.css'), 'utf8'))
  && /html\[data-mode="day"\]/.test(fs.readFileSync(path.join(WEB, '_v166css', '57-chains.css'), 'utf8')));

/* ------------------------------------------------------------------ B · the arithmetic */
console.log('\nB · numeric oracles (every figure re-derived in this file)');

const COINS = {
  BTC: { price: 60000, vol: 3.2e10, mcap: 1.2e12, c24: 1.8 },
  ETH: { price: 3000, vol: 1.4e10, mcap: 3.6e11, c24: -2.1 },
  SOL: { price: 150, vol: 3.0e9, mcap: 7.0e10, c24: 4.0 },
  USDT: { price: 1, vol: 5e10, mcap: 1e11, c24: 0 }
};
function spreadTier(v) { return v > 5e9 ? 0.6 : v > 5e8 ? 1.4 : v > 5e7 ? 3.5 : v > 5e6 ? 9 : 22; }
const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  Math: Math, Date: Date, JSON: JSON, Object: Object, Array: Array, String: String,
  Number: Number, isFinite: isFinite, isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt,
  setTimeout: () => 0, clearTimeout: () => {},
  document: { getElementById: () => null, addEventListener: () => {}, querySelectorAll: () => [] }
};
sandbox.window = {
  DLCORE: {
    coin: s => COINS[s] || null,
    esc: s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    X: () => (sandbox.__X || (sandbox.__X = {})), save: () => {}, now: () => 1700000000000,
    money: n => '$' + n.toFixed(2), open: () => null, cmd: () => {}
  },
  DLAPP: {
    paper: {
      GAS_UNITS: { swap: 150000 }, TIER_MULT: { low: .9, medium: 1, high: 1.3 }, FALLBACK_GWEI: 5,
      hash32: e => { let t = 2166136261; for (let n = 0; n < e.length; n++) { t ^= e.charCodeAt(n); t = Math.imul(t, 16777619) >>> 0; } return t >>> 0; },
      poolSpec: st => { const r = 1.4 / spreadTier(st.vol24 || 0); const o = st.vol24 > 0 ? st.vol24 : 0.03 * st.mcap; return { tvlUSD: Math.max(25000, 0.02 * o) * r, tier: r }; }
    }
  }
};
// build154.py's display-currency pass (buildlib/cur.py) rewrites the money sites in every
// layer into DLCUR calls, so the layer lifted OUT OF THE BUILT PAYLOAD depends on DLCUR that
// the browser has and a bare sandbox does not. Stub it at parity: symbol + identity convert.
sandbox.DLCUR = { s: () => '$', c: n => n, code: () => 'USD', rate: () => 1 };
sandbox.window.DLCUR = sandbox.DLCUR;
sandbox.self = sandbox; sandbox.globalThis = sandbox;
let D = null;
try { vm.runInNewContext(L, sandbox, { timeout: 20000 }); D = sandbox.window.DLCHAIN; }
catch (e) { console.log('  ✗ the layer threw while loading: ' + (e && e.message)); fail++; }

if (!D) {
  console.log('\n' + pass + ' passed · ' + (fail || 1) + ' failed');
  process.exit(fail || 1);
}

/* --- the gate's OWN implementations. Nothing below calls a DLCHAIN helper to check a
   DLCHAIN helper; each formula is written out again from the published source. --- */
const LN = Math.log(1.0001);
const gTickToSqrt = t => Math.pow(1.0001, t / 2);
const gAmount0 = (Lq, a, b) => { const lo = Math.min(a, b), hi = Math.max(a, b); return Lq * (1 / lo - 1 / hi); };   // eq. 6.29, written in its whitepaper form
const gAmount1 = (Lq, a, b) => { const lo = Math.min(a, b), hi = Math.max(a, b); return Lq * (hi - lo); };            // eq. 6.30
const gLfrom0 = (x, a, b) => { const lo = Math.min(a, b), hi = Math.max(a, b); return x * lo * hi / (hi - lo); };
const gLfrom1 = (y, a, b) => { const lo = Math.min(a, b), hi = Math.max(a, b); return y / (hi - lo); };
const gNextSqrt0In = (sq, Lq, dx) => Lq * sq / (Lq + dx * sq);
const gNextSqrt1In = (sq, Lq, dy) => sq + dy / Lq;

/* 1 · tick <-> sqrtPrice round-trip, and the exponent itself */
(() => {
  const ticks = [0, 1, -1, 60, -60, 85176, -85176, 202919, 887272, -887272];
  let badRt = 0, badVal = 0;
  ticks.forEach(t => {
    if (D.sqrtPriceToTick(D.tickToSqrtPrice(t)) !== t) badRt++;
    if (!rel(D.tickToSqrtPrice(t), gTickToSqrt(t), 1e-12)) badVal++;
  });
  ok('1 · tick <-> sqrtPrice round-trips exactly over the full legal range, and equals 1.0001^(tick/2)', badRt === 0 && badVal === 0, { badRt, badVal });
})();

/* 2 · the Q64.96 encoding. tick 0 is sqrtPriceX96 = 2^96 = 79228162514264337593543950336 */
ok('2 · sqrtPriceX96 at tick 0 is exactly 2^96 (79228162514264337593543950336)',
  D.sqrtPriceX96(1) === Math.pow(2, 96) && rel(D.x96ToSqrtPrice(Math.pow(2, 96)), 1, 0),
  { got: D.sqrtPriceX96(1) });

/* 3 · the whitepaper amount formulas at the development book's published bounds */
(() => {
  const sp = Math.sqrt(5000), sa = Math.sqrt(4545), sb = Math.sqrt(5500);
  const L0 = D.liquidityFromAmount0(1, sp, sb), L1 = D.liquidityFromAmount1(5000, sa, sp);
  ok('3 · L from 1 unit of base over 5000..5500 = 1519.437308014769 (Uniswap v3 development book)', rel(L0, 1519.437308014769, 1e-12), L0);
  ok('4 · L from 5000 units of quote over 4545..5000 = 1517.8823437515 (same source)', rel(L1, 1517.8823437515, 1e-11), L1);
  ok('5 · liquidityFromAmounts inside the range takes the binding side (the smaller of the two)', rel(D.liquidityFromAmounts(1, 5000, sp, sa, sb), Math.min(L0, L1), 1e-12));
  const Lq = Math.min(L0, L1);
  ok('6 · eq. 6.29 and 6.30 invert: amounts back out of L to the whitepaper values',
    rel(D.amount0For(Lq, sp, sb), gAmount0(Lq, sp, sb), 1e-12) && rel(D.amount1For(Lq, sa, sp), gAmount1(Lq, sa, sp), 1e-12)
    && rel(D.amount1For(Lq, sa, sp), 5000, 1e-11),
    { a0: D.amount0For(Lq, sp, sb), a1: D.amount1For(Lq, sa, sp) });
})();

/* 4 · computeSwapStep, both branches, recomputed */
(() => {
  const sp = Math.sqrt(5000), sa = Math.sqrt(4545), Lq = 1517.8823437515, f = 0.003;
  // capped at the tick boundary: fee is charged ON TOP, amountIn*f/(1-f)
  const big = D.swapStep(sp, sa, Lq, 1e9, f);
  const expIn = gAmount0(Lq, sa, sp), expOut = gAmount1(Lq, sa, sp), expFee = expIn * f / (1 - f);
  ok('7 · computeSwapStep capped at the tick: in, out and fee all equal the whitepaper forms (fee = in*f/(1-f))',
    big.maxed === true && rel(big.amountIn, expIn, 1e-12) && rel(big.amountOut, expOut, 1e-12) && rel(big.feeAmount, expFee, 1e-12),
    { in: big.amountIn, expIn, fee: big.feeAmount, expFee });
  // ending inside the tick: the next sqrt price is L*sqrt(P)/(L + dx*sqrt(P))
  const offer = 0.4;
  const small = D.swapStep(sp, sa, Lq, offer, f);
  const expNext = gNextSqrt0In(sp, Lq, offer * (1 - f));
  ok('8 · computeSwapStep inside the tick: next sqrtPrice = L*sqrt(P)/(L + dx*sqrt(P)) on the fee-less input',
    small.maxed === false && rel(small.sqNext, expNext, 1e-12) && rel(small.amountIn + small.feeAmount, offer, 1e-9),
    { got: small.sqNext, expNext, used: small.amountIn + small.feeAmount });
  // the other direction: quote in, sqrt(P) + dy/L
  const up = D.swapStep(sp, Math.sqrt(5500), Lq, 100, f);
  ok('9 · the rising branch: next sqrtPrice = sqrt(P) + dy/L, and out is the base side',
    rel(up.sqNext, gNextSqrt1In(sp, Lq, 100 * (1 - f)), 1e-12) && rel(up.amountOut, gAmount0(Lq, sp, up.sqNext), 1e-9),
    { got: up.sqNext });
})();

/* 5 · the ladder, and a MULTI-TICK swap: L conserved, amounts conserved, fee growth accrued */
(() => {
  const pool = D.buildTicks({ price: 60000, tvlQuote: 2e7, feePips: 3000, seed: 'gate|BTC|USDT' });
  // the ladder holds exactly the value it was told to hold — recomputed here
  let val = 0;
  pool.slots.forEach(s => {
    const a0 = s.sqHi <= pool.sqrtP ? 0 : gAmount0(s.L, Math.max(pool.sqrtP, s.sqLo), s.sqHi);
    const a1 = s.sqLo >= pool.sqrtP ? 0 : gAmount1(s.L, s.sqLo, Math.min(pool.sqrtP, s.sqHi));
    val += a0 * pool.price + a1;
  });
  ok('10 · the modelled ladder holds exactly the TVL it was calibrated to, recomputed from eq. 6.29/6.30', rel(val, 2e7, 1e-9), val);
  let net = 0; pool.ticks.forEach(t => { net += t.net; });
  ok('11 · liquidityNet over every initialised tick sums to zero — the pool is empty outside the ladder', Math.abs(net) < pool.L * 1e-9, net);
  const again = D.buildTicks({ price: 60000, tvlQuote: 2e7, feePips: 3000, seed: 'gate|BTC|USDT' });
  ok('12 · the ladder is deterministic — the same request builds the same pool, twice',
    JSON.stringify(pool.ticks) === JSON.stringify(again.ticks) && pool.L === again.L);

  const w = D.swapWalk(pool, true, 200);
  ok('13 · a 200-unit sell crosses more than one tick — this is the multi-tick walk the rest of the build does not have',
    w.crossings >= 2 && w.steps.length >= 2, { crossings: w.crossings, steps: w.steps.length });
  let sIn = 0, sOut = 0, sFee = 0, badOut = 0, badL = 0, fg = 0, badFg = 0;
  w.steps.forEach((s, i) => {
    sIn += s.amountIn; sOut += s.amountOut; sFee += s.feeAmount;
    // each step's output, recomputed: dy = L(sqrt(from) - sqrt(to)) on a falling price
    if (!rel(s.amountOut, gAmount1(s.L, s.sqTo, s.sqFrom), 1e-9)) badOut++;
    // each step's input, recomputed: dx = L(1/sqrt(to) - 1/sqrt(from))
    if (!rel(s.amountIn, gAmount0(s.L, s.sqTo, s.sqFrom), 1e-9)) badOut++;
    if (i + 1 < w.steps.length && !rel(s.LAfter, w.steps[i + 1].L, 1e-9)) badL++;
    fg += s.feeAmount / s.L;
    if (!rel(s.feeGrowthGlobal, fg, 1e-9)) badFg++;
  });
  ok('14 · amounts conserved over the walk: sum of step inputs + sum of step fees = the input consumed',
    rel(sIn + sFee, w.amountInUsed, 1e-9) && rel(sOut, w.amountOut, 1e-9) && rel(sIn, w.amountInNet, 1e-9),
    { sIn, sFee, used: w.amountInUsed });
  ok('15 · every step\'s in and out equal the whitepaper deltas at that step\'s own liquidity', badOut === 0, badOut);
  ok('16 · liquidity is continuous across the walk — each step starts at the L the previous one ended on', badL === 0, badL);
  // liquidityNet is applied at each crossing: recompute the expected L after every crossed tick
  const netAt = {}; pool.ticks.forEach(t => { netAt[t.tick] = t.net; });
  let badNet = 0;
  // going down, L = L - net, floored at zero because negative liquidity is not a thing
  w.steps.forEach(s => {
    if (!s.crossed) return;
    const expected = Math.max(0, s.L - netAt[s.tickTarget]);
    if (Math.abs(s.LAfter - expected) > pool.L * 1e-9) badNet++;
  });
  ok('17 · at every crossing L moves by exactly that tick\'s liquidityNet (minus it, going down), floored at zero', badNet === 0, badNet);
  ok('18 · fee growth is accrued per unit of liquidity: the accumulator is the running sum of feeAmount / L',
    badFg === 0 && rel(w.feeGrowthGlobal, fg, 1e-9), { badFg, got: w.feeGrowthGlobal, gate: fg });
  // Tick.sol's three-term identity, recomputed
  const gFgi = (lo, hi, cur, glob, outLo, outHi) => glob - (cur >= lo ? outLo : glob - outLo) - (cur < hi ? outHi : glob - outHi);
  ok('19 · feeGrowthInside is the three-term identity from Tick.sol, in range and out of it',
    near(D.feeGrowthInside(-10, 10, 0, 100, 20, 30), gFgi(-10, 10, 0, 100, 20, 30), 1e-12)
    && near(D.feeGrowthInside(-10, 10, 50, 100, 20, 30), gFgi(-10, 10, 50, 100, 20, 30), 1e-12)
    && near(D.feeGrowthInside(-10, 10, -50, 100, 20, 30), gFgi(-10, 10, -50, 100, 20, 30), 1e-12));
  // a bigger order must never fill better
  const a = D.swapWalk(pool, true, 20), b = D.swapWalk(pool, true, 120);
  ok('20 · impact is monotone in size — a bigger order never fills cheaper', b.impactBps > a.impactBps && a.impactBps >= 0, [a.impactBps, b.impactBps]);
  // the ladder is finite and says so rather than inventing depth
  const huge = D.swapWalk(pool, true, 1e9);
  ok('21 · when the ladder runs out the shortfall is named, not filled — exhausted flag and unfilled amount',
    huge.exhausted === true && huge.amountInUnfilled > 0 && huge.LEnd < pool.L * 1e-6,
    { unfilled: huge.amountInUnfilled, LEnd: huge.LEnd });
})();

/* 6 · EIP-4844 fake_exponential and the blob base fee */
(() => {
  const U = 3338477;
  ok('22 · blob base fee at zero excess is the 1 wei floor (EIP-4844 MIN_BASE_FEE_PER_BLOB_GAS)', near(D.blobBaseFeeWei(0), 1, 1e-12), D.blobBaseFeeWei(0));
  ok('23 · fake_exponential(1, U, U) is e, and the general case is exp(excess/U) — the gate uses Math.exp',
    rel(D.fakeExponential(1, U, U), Math.E, 1e-9) && rel(D.blobBaseFeeWei(5.0e7), Math.exp(5.0e7 / U), 1e-9) && rel(D.blobBaseFeeWei(8.5e7), Math.exp(8.5e7 / U), 1e-9),
    { e: D.fakeExponential(1, U, U), busy: D.blobBaseFeeWei(5.0e7) });
})();

/* 7 · the OP-stack Ecotone decomposition — parts must sum to the total, term by term */
(() => {
  const bytes = 320, zero = 96, l1 = 5e9, blob = 3194333.9647758375, l2base = 0.005e9, l2gas = 150000;
  const bfs = 1368, bbs = 810949;
  const gL1Gas = 4 * zero + 16 * (bytes - zero);                               // 3968
  const gCalldata = gL1Gas * (bfs * 16 * l1) / 16e6;
  const gBlob = gL1Gas * (bbs * blob) / 16e6;
  const gL2 = l2gas * l2base;
  const m = D.opStackFee({ l2Gas: l2gas, l2BaseFeeWei: l2base, l1BaseFeeWei: l1, blobBaseFeeWei: blob, bytes: bytes, zeroBytes: zero });
  ok('24 · Ecotone l1GasUsed = 4*zeroBytes + 16*nonZeroBytes = 3968 for the modelled 320-byte swap',
    D.calldataGas(bytes, zero) === 3968 && m.l1GasUsed === gL1Gas, { got: m.l1GasUsed, gate: gL1Gas });
  ok('25 · the blob-fee decomposition sums to the total: calldata term + blob term + L2 execution = totalWei, each recomputed',
    rel(m.calldataTermWei, gCalldata, 1e-12) && rel(m.blobTermWei, gBlob, 1e-12) && rel(m.l2FeeWei, gL2, 1e-12)
    && rel(m.calldataTermWei + m.blobTermWei + m.l2FeeWei, m.totalWei, 1e-12)
    && rel(m.l1FeeWei, gCalldata + gBlob, 1e-12),
    { calldata: [m.calldataTermWei, gCalldata], blob: [m.blobTermWei, gBlob], total: m.totalWei });
  ok('26 · the blob-versus-calldata crossover is 16*baseFeeScalar*l1BaseFee / blobBaseFeeScalar, and the posting branch follows it',
    rel(m.crossoverBlobBaseFeeWei, 16 * bfs * l1 / bbs, 1e-12)
    && m.posting === (gBlob > gCalldata ? 'blob' : 'calldata'),
    { got: m.crossoverBlobBaseFeeWei, gate: 16 * bfs * l1 / bbs, posting: m.posting });
  // at the crossover the two terms are equal, by construction — check it holds
  const atX = D.opStackFee({ l2Gas: l2gas, l2BaseFeeWei: l2base, l1BaseFeeWei: l1, blobBaseFeeWei: 16 * bfs * l1 / bbs, bytes: bytes, zeroBytes: zero });
  ok('27 · at that crossover blob-base-fee the two L1 terms are exactly equal', rel(atX.calldataTermWei, atX.blobTermWei, 1e-9), [atX.calldataTermWei, atX.blobTermWei]);
})();

/* 8 · Arbitrum Nitro: the poster's L1 cost expressed as extra L2 gas */
(() => {
  const l1 = 5e9, l2p = 0.01e9, l2gas = 150000, bytes = 320, ratio = 0.40, batch = 400;
  const comp = bytes * ratio;                                   // 128 compressed bytes
  const gPosterCalldata = comp * 16 * l1;                       // Nitro charges 16 gas per byte
  const gOverhead = (21000 + 30000) * l1 / batch;
  const a = D.arbitrumFee({ l2Gas: l2gas, l2GasPriceWei: l2p, l1BaseFeeWei: l1, blobBaseFeeWei: 1, batchSize: batch, useBlobs: false });
  ok('28 · Nitro poster charge on calldata = compressedBytes * 16 * l1BaseFee, and the batch overhead is amortised over the batch',
    rel(a.posterWei, gPosterCalldata, 1e-12) && rel(a.batchOverheadWei, gOverhead, 1e-12) && rel(a.compressedBytes, comp, 1e-12),
    { poster: [a.posterWei, gPosterCalldata], overhead: [a.batchOverheadWei, gOverhead] });
  ok('29 · the Nitro identity: posterGas = the L1 outlay / L2 gas price, and totalGas * price = compute + that outlay',
    rel(a.posterGas, (gPosterCalldata + gOverhead) / l2p, 1e-9)
    && rel(a.totalGas, l2gas + (gPosterCalldata + gOverhead) / l2p, 1e-9)
    && rel(a.totalWei, l2gas * l2p + gPosterCalldata + gOverhead, 1e-9),
    { posterGas: a.posterGas, totalGas: a.totalGas, totalWei: a.totalWei });
  const blobs = D.arbitrumFee({ l2Gas: l2gas, l2GasPriceWei: l2p, l1BaseFeeWei: l1, blobBaseFeeWei: 1, batchSize: batch, useBlobs: true });
  ok('30 · with blobs at the 1 wei floor the poster pays compressedBytes * blobBaseFee instead, which is strictly cheaper',
    rel(blobs.posterWei, comp * 1, 1e-12) && blobs.totalWei < a.totalWei && blobs.posting === 'blob',
    { blobPoster: blobs.posterWei, calldataPoster: a.posterWei });
})();

/* 9 · a validity rollup amortises one proof over the batch */
(() => {
  const l1 = 5e9, l2p = 0.02e9, l2gas = 150000, blob = 1, diff = 40;
  const gProof = (500000 + 150000) * l1;
  const one = D.validityFee({ l2Gas: l2gas, l2GasPriceWei: l2p, l1BaseFeeWei: l1, blobBaseFeeWei: blob, batchSize: 1 });
  const k = D.validityFee({ l2Gas: l2gas, l2GasPriceWei: l2p, l1BaseFeeWei: l1, blobBaseFeeWei: blob, batchSize: 1000 });
  ok('31 · the proof cost per transaction is (verifyGas + overhead) * l1BaseFee / batchSize — it falls as 1/N',
    rel(one.perTxProofWei, gProof, 1e-9) && rel(k.perTxProofWei, gProof / 1000, 1e-9),
    { one: one.perTxProofWei, thousand: k.perTxProofWei, gate: gProof });
  ok('32 · the asymptote is L2 execution plus this transaction\'s own state diff, and does not move with batch size',
    rel(one.asymptoteWei, l2gas * l2p + diff * blob, 1e-9) && rel(one.asymptoteWei, k.asymptoteWei, 1e-12),
    { asym: one.asymptoteWei, gate: l2gas * l2p + diff * blob });
  const curve = D.validityCurve({ l2Gas: l2gas, l2GasPriceWei: l2p, l1BaseFeeWei: l1, blobBaseFeeWei: blob }, null);
  let mono = true;
  for (let i = 0; i + 1 < curve.length; i++) if (curve[i + 1].totalWei >= curve[i].totalWei) mono = false;
  ok('33 · the cost-per-transaction curve is strictly decreasing in batch size and each point matches the closed form',
    mono && curve.every(c => rel(c.totalWei, l2gas * l2p + gProof / c.batchSize + diff * blob, 1e-9)),
    curve.map(c => [c.batchSize, c.totalWei]));
})();

/* 10 · Solana: lamports, compute units, and the tick-array wall */
(() => {
  const f = D.solanaFee({ computeUnits: 200000, signatures: 1, microLamportsPerCU: 20000 });
  ok('34 · Solana base fee is 5000 lamports per signature and the priority fee is ceil(CU * microLamports / 1e6)',
    f.baseLamports === 5000 && f.priorityLamports === Math.ceil(200000 * 20000 / 1e6) && f.priorityLamports === 4000
    && f.totalLamports === 9000 && rel(f.totalSol, 9000 / 1e9, 1e-15),
    { base: f.baseLamports, prio: f.priorityLamports });
  const f2 = D.solanaFee({ computeUnits: 200000, signatures: 2, microLamportsPerCU: 0 });
  ok('35 · with no priority bid the fee is base only, and it scales with signatures — there is no auction term',
    f2.totalLamports === 10000 && f2.priorityLamports === 0, f2.totalLamports);
  // 3 arrays x 88 ticks = 264 tick spacings of travel in one swap instruction
  [1, 8, 64, 128].forEach(sp => {
    const t = D.solanaTickArrays(sp, 0);
    if (!rel(t.maxTicksPerSwap, 3 * 88 * sp, 0) || !rel(t.maxPriceRatio, Math.pow(1.0001, 3 * 88 * sp), 1e-9)) fail++;
  });
  const t1 = D.solanaTickArrays(1, 0);
  ok('36 · a Whirlpool swap reaches 3 * 88 * spacing ticks — at spacing 1 that is 264 ticks, a 2.675% move',
    t1.maxTicksPerSwap === 264 && rel(t1.maxMovePct, (Math.pow(1.0001, 264) - 1) * 100, 1e-9),
    { max: t1.maxTicksPerSwap, pct: t1.maxMovePct });
  const t2 = D.solanaTickArrays(1, 400);
  ok('37 · arraysNeeded = ceil(ticks / spacing / 88), and a 400-tick move at spacing 1 needs 5 arrays, so it reverts',
    t2.arraysNeeded === Math.ceil(400 / 1 / 88) && t2.arraysNeeded === 5 && t2.fits === false && /revert|split/i.test(t2.remedy),
    { needed: t2.arraysNeeded });
  ok('38 · the same 400-tick move at spacing 64 fits in one array and one transaction',
    D.solanaTickArrays(64, 400).arraysNeeded === 1 && D.solanaTickArrays(64, 400).fits === true);
})();

/* 11 · the liquidity bridge, at and past its capacity limit */
(() => {
  const inv = 1e6, u0 = 0.35, amt = 2e6, lp = 4, k = 30;
  const gFree = inv * (1 - u0);                       // 650000
  const gU1 = u0 + gFree / inv;                       // exactly 1
  const gPrem = k * (u0 + gU1) / 2;                   // the integral of a linear premium = the midpoint
  const gFee = gFree * (lp + gPrem) / 1e4;
  const b = D.bridgeLiquidity({ amountUSD: amt, inventoryUSD: inv, utilisation: u0, lpFeeBps: lp, premiumBpsPerUtil: k });
  ok('39 · a liquidity bridge PARTIALLY FILLS at the capacity limit: filled = inventory * (1 - utilisation), and the rest is named',
    rel(b.filledUSD, gFree, 1e-9) && rel(b.unfilledUSD, amt - gFree, 1e-9) && b.partial === true && rel(b.capacityUSD, gFree, 1e-9),
    { filled: b.filledUSD, unfilled: b.unfilledUSD, gate: gFree });
  ok('40 · the rebalancing premium is the average of a linear premium over the fill, and the fee follows from it',
    rel(b.utilisationAfter, gU1, 1e-12) && rel(b.premiumBps, gPrem, 1e-12) && rel(b.premiumBps, 20.25, 1e-12) && rel(b.feeUSD, gFee, 1e-9),
    { prem: b.premiumBps, gate: gPrem, fee: b.feeUSD });
  const inside = D.bridgeLiquidity({ amountUSD: 1e5, inventoryUSD: inv, utilisation: u0, lpFeeBps: lp, premiumBpsPerUtil: k });
  ok('41 · inside the inventory it fills whole, and the premium is lower because less of the inventory was consumed',
    inside.partial === false && rel(inside.filledUSD, 1e5, 1e-9) && inside.premiumBps < b.premiumBps
    && rel(inside.premiumBps, k * (u0 + (u0 + 1e5 / inv)) / 2, 1e-12));
})();

/* 12 · the normal tail used for the slippage-breach probability */
ok('42 · the normal CDF matches its published values: Phi(0)=0.5, Phi(1.96)=0.9750021, Phi(-1)=0.1586553',
  near(D.normalCdf(0), 0.5, 1e-9) && near(D.normalCdf(1.96), 0.9750021, 1e-6) && near(D.normalCdf(-1), 0.1586553, 1e-6),
  [D.normalCdf(0), D.normalCdf(1.96), D.normalCdf(-1)]);

/* 13 · the four failure modes each carry arithmetic and a remedy */
(() => {
  const fms = D.failureModes({ principalUSD: 1e5, srcGasUSD: 2.25, dstGasUSD: 0.01, bridgeFeeUSD: 1.5, etaSec: 604800, sigmaAnnual: 0.6, tolerancePct: 0.5 });
  const ids = fms.map(f => f.id).join(',');
  ok('43 · all four failure modes ship, each with its own arithmetic string and its own remedy',
    ids === 'stuck,dstgas,slippage,refund' && fms.every(f => f.arithmetic && f.arithmetic.length > 40 && f.remedy), ids);
  const stuck = fms[0];
  ok('44 · stuck message: expected cost = relayer failure rate * one destination transaction, sunk = source gas + bridge fee',
    rel(stuck.expectedCostUSD, 0.004 * 0.01, 1e-12) && rel(stuck.sunkUSD, 2.25 + 1.5, 1e-12), { exp: stuck.expectedCostUSD, sunk: stuck.sunkUSD });
  const dg = fms[1];
  ok('45 · insufficient destination gas: shortfall = required (2x) - quoted (1.25x buffer), remedy adds one more transaction',
    rel(dg.remedyCostUSD, (0.01 * 2 - 0.01 * 1.25) + 0.01, 1e-12), dg.remedyCostUSD);
  const sl = fms[2];
  const gSigT = 0.6 * Math.sqrt(604800 / 31557600);
  ok('46 · destination slippage: expected absolute drift = sigma*sqrt(t/yr)*sqrt(2/pi) of notional, breach = the two-sided normal tail',
    rel(sl.expectedCostUSD, 1e5 * gSigT * Math.sqrt(2 / Math.PI), 1e-9) && rel(sl.probability, 2 * (1 - D.normalCdf(0.005 / gSigT)), 1e-9),
    { exp: sl.expectedCostUSD, gate: 1e5 * gSigT * Math.sqrt(2 / Math.PI) });
  const rf = fms[3];
  ok('47 · the refund path: recovered = principal - source gas - destination gas - 10bp, and the loss is stated',
    rel(rf.expectedCostUSD, 2.25 + 0.01 + 1e5 * 10 / 1e4, 1e-9), { loss: rf.expectedCostUSD });
})();

/* 14 · the trust column is a statement, and there is no canonical bridge where there is none */
(() => {
  const keys = Object.keys(D.TRUST);
  ok('48 · all four trust classes ship, each with a one-sentence statement of what must stay honest',
    ['native', 'external', 'optimistic', 'local'].every(k => D.TRUST[k] && D.TRUST[k].label && D.TRUST[k].one && D.TRUST[k].one.length > 60), keys);
  const toL2 = D.bridgeRoutes({ from: 'ethereum', to: 'base', amountUSD: 1e5, srcGasUSD: 2.25, dstGasUSD: 0.01, optimistic: true });
  const toSol = D.bridgeRoutes({ from: 'ethereum', to: 'solana', amountUSD: 1e5, srcGasUSD: 2.25, dstGasUSD: 0.001 });
  ok('49 · a rollup gets its canonical routes and a seven-day challenge window; Solana gets none, because none exists',
    toL2.some(r => r.id === 'canonical-in') && toL2.some(r => r.id === 'canonical-out' && r.etaSec === 604800 && r.trust.key === 'optimistic')
    && !toSol.some(r => r.id.indexOf('canonical') === 0) && toSol.length === 3,
    { l2: toL2.map(r => r.id), sol: toSol.map(r => r.id) });
  ok('50 · every route names a trust class and a time, and the m-of-n route says how many must stay honest',
    toL2.every(r => r.trust && r.trust.key && r.etaSec >= 0) && toL2.some(r => r.honestSet && /2 of 3/.test(r.honestSet)));
})();

/* 15 · the comparison itself */
(() => {
  const req = { sym: 'BTC', quote: 'USDT', side: 'buy', base: 400, from: 'ethereum', tolerancePct: 0.5 };
  const a = D.compare(req), b = D.compare(req);
  ok('51 · compare() is deterministic — the same request gives the same numbers, twice',
    JSON.stringify(a.rows.map(r => [r.chain, r.unitCost, r.impactBps, r.crossings])) === JSON.stringify(b.rows.map(r => [r.chain, r.unitCost, r.impactBps, r.crossings])));
  ok('52 · it ranks on all-in cost alone — rank 1 is the cheapest unit cost, and time and trust are separate columns (and compare() priced itself without the desk ever being opened)',
    a.best && a.rows.length === 6 && a.rows.every(r => r.unitCost != null)
    && a.rows.every(r => r.unitCost >= a.best.unitCost - 1e-9)
    && a.rows.every(r => r.etaSec != null && r.trust && r.trust.key), a.rows.map(r => [r.chain, r.rank, Math.round(r.unitCost)]));
  ok('53 · a buy never fills under mid once the swap fee is counted, and impact is never negative',
    a.rows.every(r => r.unitCost == null || r.unitCost >= a.mid - 1e-9) && a.rows.every(r => r.impactBps == null || r.impactBps >= -1e-9));
  ok('54 · thinner modelled liquidity means more tick crossings and worse impact — the ladder is doing real work',
    (() => { const zk = a.rows.filter(r => r.chain === 'zkrollup')[0], e = a.rows.filter(r => r.chain === 'ethereum')[0]; return zk && e && zk.crossings > e.crossings && zk.impactBps > e.impactBps; })(),
    a.rows.map(r => [r.chain, r.crossings, r.impactBps && +r.impactBps.toFixed(1)]));
  const missing = D.compare({ sym: 'NOSUCHCOIN', quote: 'USDT', side: 'buy', base: 1 });
  ok('55 · a market that does not exist comes back MISSING, not zero — null mid, no rows, and a note that says so',
    missing.mid === null && missing.rows.length === 0 && /missing market stays missing/i.test(missing.note));
  ok('56 · the honesty block is on the exported API and says what is modelled and what is exact',
    Array.isArray(D.ASSUMPTIONS) && D.ASSUMPTIONS.length >= 6 && Array.isArray(D.METHOD) && D.METHOD.length >= 10
    && D.ASSUMPTIONS.join(' ').indexOf('MODELLED') >= 0 && /fork node/i.test(D.ASSUMPTIONS.join(' ')));
})();

console.log('\n' + pass + ' passed · ' + fail + ' failed');
process.exit(fail);
