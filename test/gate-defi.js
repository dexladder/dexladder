// DexLadder DeFi gate — the Liquidity Desk's arithmetic, its payload and its runtime.
//
//   node test/gate-defi.js [dist/index.html]        exit code = number of failures
//
// Part A runs layers/45-defi.js in a sandbox with a stubbed DLCORE and checks the engine
// against values that were published before this desk existed: Uniswap's own impermanent-loss
// table (1.25× → 0.60%, 2× → 5.72%, 4× → 20.00%, 5× → 25.46%), the V3 capital-efficiency
// figures (±10% ≈ 20.4×, ±0.1% ≈ 2000×), Curve's invariant on a balanced pool, the consensus
// spec's 1/√(total stake) reward curve, Curve's 2.5× ve cap, and the Synthetix StakingRewards
// accumulator's conservation identity. An oracle the desk cannot have fitted itself to.
// Part B reads the shipped payload. Part C drives it in Chromium at two widths.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const WEB = path.join(__dirname, '..');
const file = process.argv[2] || path.join(WEB, 'dist', 'index.html');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 400) : '')); } };
const near = (a, b, e = 1e-9) => isFinite(a) && Math.abs(a - b) <= e * Math.max(1, Math.abs(b));

/* ------------------------------------------------------------------ A · the engine */
console.log('A · engine (sandboxed, stubbed DLCORE)');
const stub = {
  $: () => null, esc: (s) => String(s == null ? '' : s), X: () => ({ xp: {} }), save: () => {},
  jget: () => Promise.resolve({}), money: (v) => '$' + v, big: (v) => String(v), pct: (v) => v + '%',
  chg: () => '', ago: () => '', until: () => '', simTag: () => '', coin: () => null, coinsAll: () => [],
  open: () => null, close: () => {}, onPage: () => {}, cmd: () => {}, xp: () => {}, toast: () => {},
  sfx: () => {}, now: () => Date.now()
};
const ctx = { window: { DLCORE: stub, devicePixelRatio: 1 }, document: { querySelector: () => null }, console, Math, Date, JSON, isFinite, parseFloat, setTimeout };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(WEB, 'layers', '45-defi.js'), 'utf8'), ctx, { filename: '45-defi.js' });
const E = ctx.window.DLDEFI;
ok('the layer evaluates and exports its engine', !!(E && E.V2 && E.V3 && E.CURVE && E.IL && E.STK), E ? Object.keys(E) : null);
const { V2, V3, CURVE, IL, STK } = E;

/* --- constant product (Uniswap V2) --- */
ok('V2 · getAmountOut matches the pair: 1000 into 100k/200k at 0.30% = 1974.3160687941',
  near(V2.out(1000, 100000, 200000, 30), 1974.3160687941, 1e-10), V2.out(1000, 100000, 200000, 30));
ok('V2 · the fee makes k grow, never shrink', (() => { const s = V2.swap(1000, 100000, 200000, 30); return s.k1 > s.k0; })());
ok('V2 · a zero-fee pool leaves k exactly where it was', (() => { const s = V2.swap(1000, 100000, 200000, 0); return near(s.k1, s.k0, 1e-12); })());
ok('V2 · getAmountIn inverts getAmountOut', (() => { const o = V2.out(1000, 100000, 200000, 30); return near(V2.inFor(o, 100000, 200000, 30), 1000, 1e-9); })());
ok('V2 · price impact rises with size and is never negative',
  V2.impact(100, 1e5, 2e5, 30) < V2.impact(10000, 1e5, 2e5, 30) && V2.impact(100, 1e5, 2e5, 30) > 0);
ok('V2 · an off-ratio deposit is trimmed to the ratio, not accepted whole', (() => {
  const a = V2.addOptimal(10, 100000, 100, 200000);      /* pool is 1:2000, deposit is 1:10000 */
  return near(a.x, 10, 1e-12) && near(a.y, 20000, 1e-9);
})(), V2.addOptimal(10, 100000, 100, 200000));
ok('V2 · mint then burn returns the same two amounts', (() => {
  const rx = 100, ry = 200000, ts = Math.sqrt(rx * ry);
  const l = V2.mint(10, 20000, rx, ry, ts), b = V2.burn(l, ts + l, rx + 10, ry + 20000);
  return near(b.x, 10, 1e-9) && near(b.y, 20000, 1e-9);
})());
ok('V2 · the first mint burns MINIMUM_LIQUIDITY out of √(x·y) — visible only at wei scale, where the lock actually bites',
  V2.mint(1e-6, 1e-6, 0, 0, 0) < 1e-6 && near(V2.mint(1e-6, 1e-6, 0, 0, 0), 1e-6 - 1e-15, 1e-12), V2.mint(1e-6, 1e-6, 0, 0, 0));
ok('V2 · the protocol fee is exactly one sixth of the growth in √k', (() => {
  const kl = 1e10, rx = 120, ry = 1.44e8 / 1;            /* k = rx·ry chosen above kLast */
  const T = Math.sqrt(kl), L = V2.mintFee(rx, ry, kl, T);
  const s = Math.sqrt(rx * ry), l = Math.sqrt(kl);
  return near(L / (T + L), (1 - l / s) / 6, 1e-12);
})());

/* --- concentrated liquidity (Uniswap V3) --- */
ok('V3 · a ±10% range is ~20.4× the capital efficiency of full range (Uniswap\'s own figure)',
  near(V3.efficiency(1, 0.9, 1.1), 20.4386, 1e-4), V3.efficiency(1, 0.9, 1.1));
ok('V3 · a ±0.1% range is ~2000×', near(V3.efficiency(1, 0.999, 1.001), 2000.499, 1e-4), V3.efficiency(1, 0.999, 1.001));
ok('V3 · tick 0 is price 1 and the tick/price map round-trips', near(V3.tickToPrice(0), 1, 1e-15) && near(V3.priceToTick(V3.tickToPrice(6931)), 6931, 1e-9));
ok('V3 · liquidity and amounts invert each other inside the range', (() => {
  const L = V3.liquidityFor(2000, 1600, 2500, 1, 2000), a = V3.amountsFor(L, 2000, 1600, 2500);
  const L2 = V3.liquidityFor(2000, 1600, 2500, a.x, a.y);
  return near(L2, L, 1e-9);
})());
ok('V3 · below the range the position is all token0, above it all token1', (() => {
  const L = V3.liquidityFor(2000, 1600, 2500, 1, 2000);
  const lo = V3.amountsFor(L, 1500, 1600, 2500), hi = V3.amountsFor(L, 2600, 1600, 2500);
  return lo.y === 0 && lo.x > 0 && hi.x === 0 && hi.y > 0;
})());
ok('V3 · a swap inside the range moves √P by dy/L and pays out L·Δ(1/√P)', (() => {
  const L = 1000, P = 2000, s = V3.step(L, P, 1600, 2500, 100, false, 500);
  const spNext = Math.sqrt(P) + (100 * (1 - 500 / 1e6)) / L;
  return !s.capped && near(s.P, spNext * spNext, 1e-9) && near(s.out, L * (spNext - Math.sqrt(P)) / (Math.sqrt(P) * spNext), 1e-9);
})());
ok('V3 · an oversized swap stops exactly at the range boundary and says so', (() => {
  const s = V3.step(1000, 2000, 1600, 2500, 1e9, false, 500);
  return s.capped && near(s.P, 2500, 1e-6);
})());
ok('V3 · at the entry price the position is worth what was deposited', (() => {
  const L = V3.liquidityFor(2000, 1600, 2500, 1, 2000), a = V3.amountsFor(L, 2000, 1600, 2500);
  return near(V3.value(L, 2000, 1600, 2500), a.x * 2000 + a.y, 1e-9);
})());
ok('V3 · divergence loss is zero when the price has not moved', near(IL.v3(1, 2000, 1600, 2500), 0, 1e-12));
ok('V3 · a narrow range loses more to divergence than a full-range pool does',
  IL.v3(1.2, 2000, 1800, 2200) < IL.v2(1.2), { narrow: IL.v3(1.2, 2000, 1800, 2200), full: IL.v2(1.2) });

/* --- StableSwap (Curve) --- */
ok('Curve · D on a balanced 3-pool is the sum of the balances', near(CURVE.D([1e6, 1e6, 1e6], 100), 3e6, 1e-9), CURVE.D([1e6, 1e6, 1e6], 100));
ok('Curve · get_y is the inverse of the balance it was given', (() => {
  const xs = [1.1e6, 1e6, 0.9e6];
  return near(CURVE.y(xs, 0, 1, xs[0], 100), xs[1], 1e-6);
})());
ok('Curve · a small swap on a balanced pool trades at ~1:1 net of fee', (() => {
  const r = CURVE.exchange([1e6, 1e6, 1e6], 0, 1, 1000, 100, 4).rate;
  return r > 0.9995 && r < 1;
})(), CURVE.exchange([1e6, 1e6, 1e6], 0, 1, 1000, 100, 4).rate);
ok('Curve · on a large trade StableSwap beats x·y=k, which is the entire product', (() => {
  const c = CURVE.vsConstantProduct([1e6, 1e6, 1e6], 0, 1, 300000, 100, 4);
  return c.edge > 0.05;
})(), CURVE.vsConstantProduct([1e6, 1e6, 1e6], 0, 1, 300000, 100, 4).edge);
ok('Curve · raising A flattens the curve (a big swap gets a better rate)',
  CURVE.exchange([1e6, 1e6, 1e6], 0, 1, 300000, 500, 4).rate > CURVE.exchange([1e6, 1e6, 1e6], 0, 1, 300000, 10, 4).rate);
ok('Curve · virtual price is 1 when supply equals D', near(CURVE.virtualPrice([1e6, 1e6, 1e6], 100, 3e6), 1, 1e-9));
ok('Curve · the imbalance fee is f·n/(4(n−1)) — a 4 bps base becomes 1.5 bps per coin on a 3-pool, and 2 bps on a 2-pool',
  near(CURVE.imbalanceFee(4, 3), 1.5, 1e-12) && near(CURVE.imbalanceFee(4, 2), 2, 1e-12), [CURVE.imbalanceFee(4, 3), CURVE.imbalanceFee(4, 2)]);

/* --- divergence loss --- */
[[1.25, -0.619201], [2, -5.719096], [4, -20], [5, -25.464401]].forEach(([r, v]) =>
  ok(`IL · ${r}× price move loses ${Math.abs(v).toFixed(2)}% (Uniswap's published table)`, near(IL.v2(r) * 100, v, 1e-6), IL.v2(r) * 100));
ok('IL · the loss is symmetric in the price ratio (2× and ½× cost the same)', near(IL.v2(2), IL.v2(0.5), 1e-12));
ok('IL · it is never positive — an AMM cannot beat holding on price alone',
  [0.1, 0.5, 1, 1.5, 3, 10].every(r => IL.v2(r) <= 1e-15));
ok('IL · the weighted formula collapses to the 50/50 one at equal weights', near(IL.weighted([2, 1], [0.5, 0.5]), IL.v2(2), 1e-12));
ok('IL · an 80/20 pool loses less than 50/50 on the same move', IL.weighted([2, 1], [0.8, 0.2]) > IL.v2(2));
ok('LVR · σ²/8 per year — 60% vol costs 4.5% of pool value', near(IL.lvrAPR(60), 4.5, 1e-9), IL.lvrAPR(60));
ok('IL · the break-even fee APR annualises the loss over the horizon', near(IL.breakevenFeeAPR(-5, 365), 5, 1e-12));
ok('IL · fee APR from turnover: $1m/day on $10m TVL at 0.30% = 10.95%', near(IL.feeAPR(1e6, 1e7, 30), 10.95, 1e-9), IL.feeAPR(1e6, 1e7, 30));

/* --- Monte Carlo --- */
const mc1 = IL.monteCarlo({ paths: 500, days: 90, sigma: 60, feeApr: 20, seed: 7 });
const mc2 = IL.monteCarlo({ paths: 500, days: 90, sigma: 60, feeApr: 20, seed: 7 });
const mc3 = IL.monteCarlo({ paths: 500, days: 90, sigma: 60, feeApr: 20, seed: 8 });
ok('MC · the same seed gives the same distribution — the lab can be argued with', mc1.median === mc2.median && mc1.p5 === mc2.p5);
ok('MC · a different seed gives a different one', mc1.median !== mc3.median);
ok('MC · percentiles are ordered', mc1.p5 <= mc1.p25 && mc1.p25 <= mc1.median && mc1.median <= mc1.p75 && mc1.p75 <= mc1.p95);
ok('MC · with no volatility and no fees the LP exactly matches holding',
  near(IL.monteCarlo({ paths: 200, days: 90, sigma: 0, feeApr: 0, seed: 3 }).median, 0, 1e-9));
ok('MC · with no volatility the fee income is the whole answer',
  near(IL.monteCarlo({ paths: 200, days: 365, sigma: 0, feeApr: 10, seed: 3 }).median, 10, 1e-6));
ok('MC · more volatility, worse median at the same fee',
  IL.monteCarlo({ paths: 600, days: 90, sigma: 120, feeApr: 20, seed: 5 }).median <
  IL.monteCarlo({ paths: 600, days: 90, sigma: 30, feeApr: 20, seed: 5 }).median);

/* --- staking --- */
ok('ETH · the reward falls as 1/√(total stake): quadrupling the stake halves the APR', (() => {
  const a = STK.ethAPR(30e6, 32, 1, 0).consensus, b = STK.ethAPR(120e6, 32, 1, 0).consensus;
  return near(a / b, 2, 1e-9);
})());
ok('ETH · at 34M staked the consensus APR lands between 2.5% and 3.2%, as mainnet does', (() => {
  const c = STK.ethAPR(34e6, 32, 1, 0).consensus; return c > 2.5 && c < 3.2;
})(), STK.ethAPR(34e6, 32, 1, 0).consensus);
ok('ETH · uptime scales the reward linearly', near(STK.ethAPR(34e6, 32, 0.5, 0).consensus, STK.ethAPR(34e6, 32, 1, 0).consensus / 2, 1e-12));
ok('ETH · execution-layer rewards are added, not blended away', near(STK.ethAPR(34e6, 32, 1, 1.1).total - STK.ethAPR(34e6, 32, 1, 0).total, 1.1, 1e-12));
ok('Slashing · an isolated slashing costs the initial EB/32 and nothing more', near(STK.slash(32, 34e6, 0).total, 1, 1e-12));
ok('Slashing · the correlation penalty is 3× your share of the slashed total, capped at your balance', (() => {
  const s = STK.slash(32, 34e6, 34e6 / 3);
  return near(s.correlation, 32, 1e-9) && s.total <= 33 + 1e-9;
})(), STK.slash(32, 34e6, 34e6 / 3));
ok('Slashing · a correlated failure costs multiples of a lone one',
  STK.slash(32, 34e6, 1e6).total > 3 * STK.slash(32, 34e6, 0).total, STK.slash(32, 34e6, 1e6));
ok('Exit queue · churn is max(4, active/65536) validators per epoch', (() => {
  const active = 65536 * 10, days = STK.exitQueueDays(active, 2250);
  return near(days, 2250 / (10 * 225), 1e-12);
})());
ok('ve · no lock means no boost; a full four-year lock with enough weight reaches 2.5×', (() => {
  const none = STK.veBoost(1000, 1e6, 0, 5e5).boost, max = STK.veBoost(1000, 1e6, 5e5, 5e5).boost;
  return near(none, 1, 1e-12) && near(max, 2.5, 1e-12);
})(), [STK.veBoost(1000, 1e6, 0, 5e5).boost, STK.veBoost(1000, 1e6, 5e5, 5e5).boost]);
ok('ve · the lock decays linearly — two years is half the weight of four', near(STK.veBalance(1000, 2), STK.veBalance(1000, 4) / 2, 1e-12));
ok('LST · the redemption rate compounds and the market price carries the discount', (() => {
  const l = STK.lst(1, 4, 365, -1.5, 7);
  return near(l.rate, 1.04, 1e-12) && near(l.market, 1.04 * 0.985, 1e-12);
})());
ok('Staking accrual · the Synthetix accumulator conserves the reward budget exactly', (() => {
  const R = STK.Rewards(1);                    /* 1 token per second */
  R.stake('a', 100, 0); R.stake('b', 100, 100);
  const a = R.earned('a', 200), b = R.earned('b', 200);
  return near(a, 150, 1e-9) && near(b, 50, 1e-9) && near(a + b, 200, 1e-9);
})(), (() => { const R = STK.Rewards(1); R.stake('a', 100, 0); R.stake('b', 100, 100); return [R.earned('a', 200), R.earned('b', 200)]; })());
ok('Staking accrual · claiming empties the balance and does not double-pay', (() => {
  const R = STK.Rewards(1); R.stake('a', 100, 0);
  const c = R.claim('a', 100);
  return near(c, 100, 1e-9) && near(R.earned('a', 100), 0, 1e-9) && near(R.earned('a', 200), 100, 1e-9);
})());
ok('Restaking · stacking services raises the APR and the expected loss with it', (() => {
  const r = STK.restake(1e4, 3, [{ apr: 3, slashPct: 5, prob: 0.02 }, { apr: 2, slashPct: 10, prob: 0.01 }], 0.5);
  return near(r.apr, 8, 1e-12) && r.expectedNetAPR < r.apr && r.worstCasePct >= 10;
})(), STK.restake(1e4, 3, [{ apr: 3, slashPct: 5, prob: 0.02 }, { apr: 2, slashPct: 10, prob: 0.01 }], 0.5));
ok('the desk names what it does not model, in its own code', Array.isArray(E.blind) && E.blind.length >= 6 && E.blind.join(' ').includes('gas'));

/* ------------------------------------------------------------------ B · the shipped payload */
console.log('\nB · shipped payload');
const html = fs.readFileSync(file, 'utf8');
ok('the desk ships as its own layer', html.includes('window.DLDEFI=') || html.includes('window.DLDEFI ='));
ok('it registers on the desks rail and on the command palette',
  html.includes('DLDESKS.register("defi"') && html.includes('C.cmd("impermanent loss"') && html.includes('C.cmd("staking"'));
ok('the six tabs are declared', ['"pool"', '"range"', '"stable"', '"il"', '"stake"', '"mine"'].every(t => html.includes('[' + t + ', ')) || /tabs: \[\["pool"/.test(html));
ok('every figure the desk shows is marked simulated', /DLDEFI[\s\S]{0,60000}?simTag\(\)/.test(html));
ok('the desk runs no eval-family code', !/DLDEFI[\s\S]{0,60000}?new Function\(/.test(html) && !/DLDEFI[\s\S]{0,60000}?\beval\(/.test(html));
ok('the paper book is only ever touched through the two funded paths',
  (html.match(/S\.bal\.USDT = bal - p\.usd/g) || []).length === 1 && (html.match(/S\.bal\.USDT = bal - s\.usd/g) || []).length === 1);
ok('divergence loss is recomputed from the live price, never stored on the position',
  html.includes('function markLP(p)') && !/d\.lp\[[^\]]*\]\.il\s*=/.test(html));
ok('no new localStorage key — positions live in the v154 bucket',
  /x\.defi \|\| \(x\.defi = /.test(html) && !html.includes('"dl.defi'));
ok('the honesty list ships with the payload', html.includes('smart-contract risk — no bug, no upgrade key, no paused pool'));

/* ------------------------------------------------------------------ C · runtime */
(async () => {
  console.log('\nC · runtime (Chromium, mocked network)');
  const { launch } = require('./harness');
  for (const w of [1440, 393]) {
    const hh = await launch(file, { viewport: { width: w, height: 900 } });
    const { page, errors } = hh;
    await page.waitForTimeout(6000);
    const r = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms)), out = {};
      const sheet = () => document.getElementById('dlDefi');
      const bodyTxt = () => (sheet().querySelector('.dls-body') || {}).innerText || '';
      out.engine = !!(window.DLDEFI && DLDEFI.V2 && DLDEFI.IL);
      DLDEFI.open('pool'); await wait(600);
      out.open = !!(sheet() && sheet().classList.contains('on'));
      out.tabs = sheet().querySelectorAll('.dls-tabs button').length;
      out.pool = /x · y = k/.test(bodyTxt()) && !!document.getElementById('dfPoolCv');
      /* a swap must quote worse than mid, and executing it must move the reserves */
      document.getElementById('dfSwapUsd').value = '250000';
      document.getElementById('dfSwapGo').click(); await wait(120);
      out.quote = /Price impact/.test(bodyTxt());
      const before = bodyTxt();
      document.getElementById('dfSwapExec').click(); await wait(150);
      out.moved = bodyTxt() !== before;
      DLDEFI.open('range'); await wait(500);
      out.rangeEff = /Capital efficiency/.test(bodyTxt()) && /×/.test(bodyTxt());
      DLDEFI.open('stable'); await wait(500);
      out.stable = /Invariant D/.test(bodyTxt());
      DLDEFI.open('il'); await wait(500);
      out.il = /Break-even fee APR/.test(bodyTxt()) && /LVR/.test(bodyTxt());
      document.getElementById('dfMcGo').click(); await wait(900);
      out.mc = /2,000 paths/.test(bodyTxt());
      DLDEFI.open('stake'); await wait(500);
      out.stake = /Consensus-layer APR/.test(bodyTxt()) && /Correlation penalty/.test(bodyTxt()) && /Restaking/.test(bodyTxt());
      /* the paper book: provide liquidity, then take it back */
      const bal0 = S.bal.USDT;
      DLDEFI.open('pool'); await wait(500);
      document.getElementById('dfAddUsd').value = '1000';
      document.getElementById('dfAddGo').click(); await wait(500);
      out.debited = Math.abs((bal0 - S.bal.USDT) - 1000) < 1e-6;
      out.recorded = (DLDEFI.positions().lp || []).length > 0;
      out.mine = /Liquidity positions/.test(bodyTxt()) && /does not model/.test(bodyTxt());
      const rm = sheet().querySelector('[data-rm]');
      if (rm) { rm.click(); await wait(500); }
      out.returned = S.bal.USDT > bal0 - 1000 + 1e-9;
      out.cleared = (DLDEFI.positions().lp || []).length === 0;
      out.ledgerUntouched = !((S.chain && S.chain.bl) || []).some(b => /liquidity/i.test(JSON.stringify(b)));
      out.overflow = document.documentElement.scrollWidth - innerWidth;
      out.sheetOverflow = sheet().scrollWidth - sheet().clientWidth;
      return out;
    });
    ok(`${w}px · the desk opens with all six tabs and the pool curve draws`, r.engine && r.open && r.tabs === 6 && r.pool, r);
    ok(`${w}px · a swap is quoted against mid with its impact named, and executing it moves the reserves`, r.quote && r.moved, r);
    ok(`${w}px · the range tab states capital efficiency`, r.rangeEff, r);
    ok(`${w}px · StableSwap solves its invariant`, r.stable, r);
    ok(`${w}px · the IL lab gives a break-even fee and an LVR, and 2,000 paths run`, r.il && r.mc, r);
    ok(`${w}px · staking shows the spec APR, the correlation penalty and the restaking stack`, r.stake, r);
    ok(`${w}px · providing liquidity debits the paper book and records the position`, r.debited && r.recorded, r);
    ok(`${w}px · My positions marks to market and names what the desk does not model`, r.mine, r);
    ok(`${w}px · removing liquidity pays back into the paper book and clears the position`, r.returned && r.cleared, r);
    ok(`${w}px · the desk fits the width`, r.overflow <= 1 && r.sheetOverflow <= 1, r);
    ok(`${w}px · no page error`, errors.length === 0, errors.slice(0, 3));
    await hh.close();
  }
  console.log(`\n${pass} passed · ${fail} failed`);
  process.exit(fail);
})().catch(e => { console.error(e); process.exit(99); });
