/* ============================================================
   DLDEFI · v159 — the Liquidity Desk
   A simulated, protocol-faithful DeFi bench: automated market makers,
   staking protocols and the loss that only shows up when you leave.

   Nothing here is a metaphor. Every number comes out of the arithmetic the
   real contracts run:

   · AMM v2   — Uniswap V2 constant product. x·y=k, the fee taken off the
                INPUT (out = dx(1-f)·y / (x + dx(1-f))), LP shares minted as
                min(dx·T/x, dy·T/y) with the first mint √(xy) less the
                MINIMUM_LIQUIDITY lock, and the 1/6-of-growth protocol fee
                in its √k form.
   · AMM v3   — Uniswap V3 concentrated liquidity. Ticks are 1.0001^t,
                liquidity is held between √Pa and √Pb, a swap walks √P by
                Δ√P = dy/L (or L/(L/√P + dx)) exactly as computeSwapStep does,
                and a position pays fees only while the price is inside it.
                PRECISION NOTE: this desk does the V3 algebra in double
                precision, not the chain's Q64.96 fixed point. The two agree
                to about 1e-12 relative — right for a simulator, and we do
                not claim wei-exactness.
   · StableSwap— Curve. The invariant A·n^n·S + D = A·D·n^n + D^(n+1)/(n^n·Πx)
                solved by the same Newton iteration as get_D/get_y, the
                imbalance fee f·n/(4(n-1)), and virtual price D/supply.
   · IL        — divergence loss in closed form for 50/50 (2√r/(1+r) - 1) and
                for weighted pools (Πr^w / Σw·r - 1); for a V3 range it is
                computed from the position value function, because no closed
                form survives the boundary. Break-even fee APR and LVR
                (Milionis–Moallemi–Roughgarden–Zhang: σ²/8 for a constant
                product pool) sit next to it, plus a seeded Monte Carlo over
                geometric Brownian motion so the answer is a distribution and
                not a point.
   · Staking   — the Ethereum consensus spec's own reward: base reward per
                increment = 1 ETH · BASE_REWARD_FACTOR(64) / √(total active
                balance), so the APR falls as √ of the stake, exactly as it
                does on mainnet. Slashing is the real two-part penalty
                (EB/32 initial + the ×3 correlation penalty). Reward accrual
                uses the Synthetix StakingRewards accumulator
                (rewardPerToken / userRewardPerTokenPaid) so every claim is
                auditable rather than approximated. veToken boost is Curve's
                min(0.4b + 0.6·S·ve/veTotal, b), capped at 2.5×. Liquid
                staking tracks an exchange rate and a secondary-market
                discount; restaking stacks correlated slashing.

   Paper money only. Positions are funded from the main paper book, and the
   desk says out loud what it does NOT model (gas, MEV against your own add,
   contract bugs, oracle failure, bridge risk, depeg tails).
   ============================================================ */
window.DLDEFI = (function () {
  "use strict";
  if (window.DLDEFI && window.DLDEFI.__v) return window.DLDEFI;
  var C = window.DLCORE, $ = C.$, esc = C.esc, money = C.money;

  /* ---------------------------------------------------------- deterministic randomness
     A lab whose answer changes every time you open it is not a lab. mulberry32
     + Box–Muller: same seed, same distribution, so the gate can pin it. */
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) {
    var u = 0, v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function num(v, d) { v = parseFloat(v); return isFinite(v) ? v : d; }

  /* ============================================================
     1 · CONSTANT PRODUCT (Uniswap V2)
     ============================================================ */
  var MINIMUM_LIQUIDITY = 1e-15;   /* 1000 wei at 18 decimals — the burned first mint */
  var V2 = {
    /* out = dx·(1-f)·y / (x + dx·(1-f)) — fee on the input, the way the pair does it */
    out: function (dx, rx, ry, feeBps) {
      if (!(dx > 0) || !(rx > 0) || !(ry > 0)) return 0;
      var ax = dx * (1e4 - (feeBps == null ? 30 : feeBps)) / 1e4;
      return ax * ry / (rx + ax);
    },
    /* the input a desired output demands (getAmountIn) */
    inFor: function (dy, rx, ry, feeBps) {
      if (!(dy > 0) || !(ry > dy)) return Infinity;
      return rx * dy / ((ry - dy) * (1e4 - (feeBps == null ? 30 : feeBps)) / 1e4);
    },
    spot: function (rx, ry) { return rx > 0 ? ry / rx : 0; },
    /* price impact INCLUDING the fee — what the trader actually gives up vs mid */
    impact: function (dx, rx, ry, feeBps) {
      var o = V2.out(dx, rx, ry, feeBps); if (!(o > 0)) return 0;
      var mid = V2.spot(rx, ry); return mid > 0 ? (mid - o / dx) / mid : 0;
    },
    swap: function (dx, rx, ry, feeBps) {
      var o = V2.out(dx, rx, ry, feeBps);
      return { out: o, rx: rx + dx, ry: ry - o, exec: dx > 0 ? o / dx : 0,
        impact: V2.impact(dx, rx, ry, feeBps), k0: rx * ry, k1: (rx + dx) * (ry - o) };
    },
    quote: function (dx, rx, ry) { return rx > 0 ? dx * ry / rx : 0; },
    /* the pair refuses an off-ratio deposit: it takes the side that binds */
    addOptimal: function (xDes, yDes, rx, ry) {
      if (!(rx > 0) || !(ry > 0)) return { x: xDes, y: yDes };
      var yOpt = V2.quote(xDes, rx, ry);
      if (yOpt <= yDes) return { x: xDes, y: yOpt };
      var xOpt = V2.quote(yDes, ry, rx);
      return { x: Math.min(xOpt, xDes), y: yDes };
    },
    mint: function (x, y, rx, ry, ts) {
      if (!(ts > 0)) return Math.max(0, Math.sqrt(x * y) - MINIMUM_LIQUIDITY);
      return Math.min(x * ts / rx, y * ts / ry);
    },
    burn: function (l, ts, rx, ry) {
      if (!(ts > 0)) return { x: 0, y: 0 };
      return { x: l * rx / ts, y: l * ry / ts };
    },
    /* UniswapV2Pair._mintFee — one sixth of the growth in √k, minted to the treasury */
    mintFee: function (rx, ry, kLast, ts) {
      if (!(kLast > 0) || !(ts > 0)) return 0;
      var rk = Math.sqrt(rx * ry), rkl = Math.sqrt(kLast);
      if (!(rk > rkl)) return 0;
      return ts * (rk - rkl) / (5 * rk + rkl);
    }
  };

  /* ============================================================
     2 · CONCENTRATED LIQUIDITY (Uniswap V3)
     price P is token1 per token0; the pool stores √P
     ============================================================ */
  var V3 = {
    tickToPrice: function (t) { return Math.pow(1.0001, t); },
    priceToTick: function (p) { return p > 0 ? Math.log(p) / Math.log(1.0001) : -887272; },
    usable: function (t, sp) { sp = sp || 1; return Math.round(t / sp) * sp; },
    /* the three regions of getLiquidityForAmounts */
    liquidityFor: function (P, Pa, Pb, x, y) {
      var sp = Math.sqrt(P), sa = Math.sqrt(Pa), sb = Math.sqrt(Pb);
      if (sb <= sa) return 0;
      if (sp <= sa) return x * sa * sb / (sb - sa);
      if (sp >= sb) return y / (sb - sa);
      return Math.min(x * sp * sb / (sb - sp), y / (sp - sa));
    },
    amountsFor: function (L, P, Pa, Pb) {
      var sp = Math.sqrt(P), sa = Math.sqrt(Pa), sb = Math.sqrt(Pb);
      if (sb <= sa) return { x: 0, y: 0 };
      if (sp <= sa) return { x: L * (sb - sa) / (sa * sb), y: 0 };
      if (sp >= sb) return { x: 0, y: L * (sb - sa) };
      return { x: L * (sb - sp) / (sp * sb), y: L * (sp - sa) };
    },
    /* value of the position denominated in token1 */
    value: function (L, P, Pa, Pb) { var a = V3.amountsFor(L, P, Pa, Pb); return a.x * P + a.y; },
    /* one computeSwapStep inside a single range: walk √P, stop at the boundary */
    step: function (L, P, Pa, Pb, amountIn, zeroForOne, feeBps) {
      var f = (feeBps == null ? 500 : feeBps) / 1e6;          /* V3 fees are in hundredths of a bip */
      var fee = amountIn * f, dIn = amountIn - fee;
      var sp = Math.sqrt(P), sa = Math.sqrt(Pa), sb = Math.sqrt(Pb), spNext;
      if (!(L > 0)) return { out: 0, fee: 0, P: P, used: 0, capped: true };
      if (zeroForOne) {                                        /* token0 in → price falls */
        spNext = L * sp / (L + dIn * sp);
        if (spNext < sa) {                                     /* the range runs out */
          spNext = sa;
          var maxIn = L * (sp - spNext) / (sp * spNext);
          dIn = maxIn; fee = dIn * f / (1 - f);
          var outC = L * (sp - spNext);
          return { out: outC, fee: fee, P: spNext * spNext, used: dIn + fee, capped: true };
        }
        return { out: L * (sp - spNext), fee: fee, P: spNext * spNext, used: amountIn, capped: false };
      }
      spNext = sp + dIn / L;                                   /* token1 in → price rises */
      if (spNext > sb) {
        spNext = sb;
        var maxIn1 = L * (spNext - sp);
        dIn = maxIn1; fee = dIn * f / (1 - f);
        var outC1 = L * (spNext - sp) / (sp * spNext);
        return { out: outC1, fee: fee, P: spNext * spNext, used: dIn + fee, capped: true };
      }
      return { out: L * (spNext - sp) / (sp * spNext), fee: fee, P: spNext * spNext, used: amountIn, capped: false };
    },
    /* how much more liquidity the same money buys inside a range than across all prices:
       V = L(2√P − √Pa − P/√Pb) concentrated, V = 2L√P full-range → ratio below */
    efficiency: function (P, Pa, Pb) {
      var sp = Math.sqrt(P), sa = Math.sqrt(Math.min(Pa, P)), sb = Math.sqrt(Math.max(Pb, P));
      var den = 2 * sp - sa - P / sb;
      return den > 0 ? 2 * sp / den : 1;
    },
    inRange: function (P, Pa, Pb) { return P >= Pa && P <= Pb; }
  };

  /* ============================================================
     3 · STABLESWAP (Curve)
     ============================================================ */
  var CURVE = {
    D: function (xs, A) {
      var n = xs.length, S = 0, i, j;
      for (i = 0; i < n; i++) S += xs[i];
      if (S === 0) return 0;
      var D = S, Ann = A * Math.pow(n, n), Dp, Dprev;
      for (i = 0; i < 255; i++) {
        Dp = D;
        for (j = 0; j < n; j++) Dp = Dp * D / (n * xs[j]);
        Dprev = D;
        D = (Ann * S + Dp * n) * D / ((Ann - 1) * D + (n + 1) * Dp);
        if (Math.abs(D - Dprev) < 1e-12 * Math.max(1, D)) break;
      }
      return D;
    },
    /* the balance of coin j once coin i is set to x, holding D */
    y: function (xs, i, j, x, A) {
      var n = xs.length, D = CURVE.D(xs, A), Ann = A * Math.pow(n, n);
      var c = D, S_ = 0, k, _x;
      for (k = 0; k < n; k++) {
        if (k === j) continue;
        _x = (k === i) ? x : xs[k];
        S_ += _x; c = c * D / (_x * n);
      }
      c = c * D / (Ann * n);
      var b = S_ + D / Ann, y = D, yPrev;
      for (k = 0; k < 255; k++) {
        yPrev = y;
        y = (y * y + c) / (2 * y + b - D);
        if (Math.abs(y - yPrev) < 1e-12 * Math.max(1, y)) break;
      }
      return y;
    },
    exchange: function (xs, i, j, dx, A, feeBps) {
      var x = xs[i] + dx, y1 = CURVE.y(xs, i, j, x, A);
      var dy = xs[j] - y1, fee = dy * (feeBps == null ? 4 : feeBps) / 1e4;
      var out = xs.slice(); out[i] = x; out[j] = y1 + fee;
      return { out: dy - fee, fee: fee, xs: out, rate: dx > 0 ? (dy - fee) / dx : 0 };
    },
    /* imbalanced deposits and withdrawals pay a scaled fee so balanced ones do not subsidise them */
    imbalanceFee: function (feeBps, n) { return n > 1 ? feeBps * n / (4 * (n - 1)) : feeBps; },
    virtualPrice: function (xs, A, supply) { return supply > 0 ? CURVE.D(xs, A) / supply : 1; },
    /* the same trade on x·y=k, so the curve's flat middle can be seen rather than asserted */
    vsConstantProduct: function (xs, i, j, dx, A, feeBps) {
      var s = CURVE.exchange(xs, i, j, dx, A, feeBps);
      var cp = V2.out(dx, xs[i], xs[j], feeBps);
      return { stable: s.out, product: cp, edge: cp > 0 ? s.out / cp - 1 : 0 };
    }
  };

  /* ============================================================
     4 · DIVERGENCE (IMPERMANENT) LOSS
     ============================================================ */
  var IL = {
    /* the 50/50 closed form: 2√r/(1+r) − 1 */
    v2: function (r) { return r > 0 ? 2 * Math.sqrt(r) / (1 + r) - 1 : -1; },
    /* Balancer weighted pools: Πr^w / Σw·r − 1 */
    weighted: function (rs, ws) {
      var num = 1, den = 0, i;
      for (i = 0; i < rs.length; i++) { num *= Math.pow(rs[i], ws[i]); den += ws[i] * rs[i]; }
      return den > 0 ? num / den - 1 : 0;
    },
    /* a V3 range has no closed form once the price leaves it — value it instead */
    v3: function (r, P0, Pa, Pb) {
      var L = V3.liquidityFor(P0, Pa, Pb, 1, P0), a0 = V3.amountsFor(L, P0, Pa, Pb);
      var P1 = P0 * r, v1 = V3.value(L, P1, Pa, Pb), hodl = a0.x * P1 + a0.y;
      return hodl > 0 ? v1 / hodl - 1 : 0;
    },
    /* LVR: what an arbitrageur takes from a constant-product pool per unit time.
       Milionis, Moallemi, Roughgarden & Zhang — σ²/8 of pool value, annualised. */
    lvrAPR: function (sigmaPct) { var s = sigmaPct / 100; return s * s / 8 * 100; },
    /* the fee APR a position must earn to come out level with simply holding */
    breakevenFeeAPR: function (ilPct, days) { return days > 0 ? -ilPct * 365 / days : 0; },
    /* fee APR a pool actually pays: turnover × fee, divided by your share of it */
    feeAPR: function (dailyVolume, tvl, feeBps) {
      return tvl > 0 ? dailyVolume * (feeBps / 1e4) / tvl * 365 * 100 : 0;
    },
    /* seeded GBM Monte Carlo: LP (fees minus divergence) against holding */
    monteCarlo: function (o) {
      var paths = o.paths || 2000, days = o.days || 90, sig = (o.sigma == null ? 60 : o.sigma) / 100,
        mu = (o.drift || 0) / 100, feeApr = (o.feeApr || 0) / 100, r = rng(o.seed || 42);
      var dt = 1 / 365, out = [], beats = 0, i, d, S, il, fee, net, sum = 0;
      for (i = 0; i < paths; i++) {
        S = 1;
        for (d = 0; d < days; d++) S *= Math.exp((mu - sig * sig / 2) * dt + sig * Math.sqrt(dt) * gauss(r));
        il = o.range ? IL.v3(S, 1, o.range[0], o.range[1]) : IL.v2(S);
        fee = Math.pow(1 + feeApr, days / 365) - 1;
        net = (1 + il) * (1 + fee) - 1;                 /* LP value relative to holding */
        if (net > 0) beats++;
        out.push(net * 100); sum += net * 100;
      }
      out.sort(function (a, b) { return a - b; });
      var q = function (p) { return out[clamp(Math.floor(p * (out.length - 1)), 0, out.length - 1)]; };
      return { p5: q(0.05), p25: q(0.25), median: q(0.5), p75: q(0.75), p95: q(0.95),
        mean: sum / paths, winRate: beats / paths * 100, paths: paths, dist: out };
    }
  };

  /* ============================================================
     5 · STAKING
     ============================================================ */
  var STK = {
    EPOCHS_YEAR: 82180,              /* 365.25 d / 6.4 min */
    BASE_REWARD_FACTOR: 64,
    /* consensus-spec get_base_reward: 1 ETH · 64 / √(total active balance).
       The APR falls as √ of the stake — the same curve mainnet rides. */
    ethAPR: function (totalStakedETH, effBalETH, participation, mevAPR) {
      if (!(totalStakedETH > 0)) return { consensus: 0, execution: 0, total: 0 };
      var gwei = totalStakedETH * 1e9;
      var brpi = 1e9 * STK.BASE_REWARD_FACTOR / Math.sqrt(gwei);   /* per 1-ETH increment, per epoch */
      var perEpoch = (effBalETH || 32) * brpi;                      /* gwei, all duties, perfect */
      var yearly = perEpoch * STK.EPOCHS_YEAR / 1e9;                /* ETH */
      var cons = yearly / (effBalETH || 32) * 100 * clamp(participation == null ? 1 : participation, 0, 1);
      return { consensus: cons, execution: mevAPR || 0, total: cons + (mevAPR || 0),
        issuance: cons / 100 * totalStakedETH };
    },
    /* the real penalty is two parts: the initial slice, then a correlation penalty
       that scales with how many others were slashed in the same window */
    slash: function (effBalETH, totalStakedETH, slashedETH) {
      var eb = effBalETH || 32;
      var initial = eb / 32;
      var corr = Math.min(eb, 3 * eb * (slashedETH || 0) / Math.max(1, totalStakedETH));
      return { initial: initial, correlation: corr, total: initial + corr,
        pct: (initial + corr) / eb * 100 };
    },
    /* how long the exit queue is: churn = max(4, active/65536) validators per epoch */
    exitQueueDays: function (activeValidators, leaving) {
      var churn = Math.max(4, Math.floor(activeValidators / 65536));
      return leaving / (churn * 225);
    },
    /* Synthetix StakingRewards, the accumulator every farm copied.
       Keeping the real accounting means a claim is auditable, not estimated. */
    Rewards: function (rewardRate) {
      var rpt = 0, total = 0, last = 0, bal = {}, paid = {}, earned = {};
      function sync(t) { if (total > 0) rpt += rewardRate * (t - last) / total; last = t; }
      function upd(who, t) { sync(t); earned[who] = (earned[who] || 0) + (bal[who] || 0) * (rpt - (paid[who] || 0)); paid[who] = rpt; }
      return {
        stake: function (who, amt, t) { upd(who, t); bal[who] = (bal[who] || 0) + amt; total += amt; },
        withdraw: function (who, amt, t) { upd(who, t); amt = Math.min(amt, bal[who] || 0); bal[who] -= amt; total -= amt; return amt; },
        earned: function (who, t) { sync(t); return (earned[who] || 0) + (bal[who] || 0) * (rpt - (paid[who] || 0)); },
        claim: function (who, t) { upd(who, t); var e = earned[who] || 0; earned[who] = 0; return e; },
        rewardPerToken: function (t) { sync(t); return rpt; },
        totalSupply: function () { return total; }
      };
    },
    /* veCRV: lock longer, count for more — capped at 2.5× */
    veBalance: function (amount, lockYears) { return amount * clamp(lockYears, 0, 4) / 4; },
    veBoost: function (bal, totalSupply, ve, veTotal) {
      if (!(bal > 0)) return { working: 0, boost: 1 };
      var working = Math.min(0.4 * bal + 0.6 * totalSupply * (veTotal > 0 ? ve / veTotal : 0), bal);
      return { working: working, boost: clamp(working / (0.4 * bal), 1, 2.5) };
    },
    /* liquid staking: a rate that only goes up, and a market price that need not follow it */
    lst: function (rate0, netAPR, days, premiumPct, queueDays) {
      var rate = rate0 * Math.pow(1 + netAPR / 100, days / 365);
      return { rate: rate, market: rate * (1 + (premiumPct || 0) / 100),
        discountPct: premiumPct || 0, queueDays: queueDays || 0,
        note: (premiumPct || 0) < 0 ? "trading below its redemption value" : "at or above redemption value" };
    },
    /* restaking: one stake, several obligations, and the tail that stacks */
    restake: function (principal, baseAPR, avs, corr) {
      var extra = 0, risk = 0, worst = 0, i;
      for (i = 0; i < avs.length; i++) {
        extra += avs[i].apr;
        risk += avs[i].prob * avs[i].slashPct;
        worst = Math.max(worst, avs[i].slashPct);
      }
      var joint = avs.length ? worst + (avs.length - 1) * worst * clamp(corr == null ? 0.5 : corr, 0, 1) : 0;
      return { apr: baseAPR + extra, expectedLossPct: risk, worstCasePct: Math.min(100, joint),
        expectedNetAPR: baseAPR + extra - risk, principal: principal };
    }
  };

  /* ---------------------------------------------------------- what this desk does not model */
  var BLIND = [
    "gas — every add, remove, swap and claim here is free; on-chain they are not",
    "MEV against you — your own deposit and swap are never sandwiched",
    "smart-contract risk — no bug, no upgrade key, no paused pool",
    "oracle failure and bridge risk",
    "depeg tails — the stable desk lets you push a depeg, but never surprises you with one",
    "reward-token price — farm emissions are counted at today's price, which is the assumption that has broken the most farmers"
  ];

  /* ============================================================
     STATE — lives in the v154 bucket, never a new localStorage key
     ============================================================ */
  function D() { var x = C.X(); if (!x) return null; x.defi || (x.defi = { lp: [], st: [], seed: 42 }); return x.defi; }
  var ST = {
    v2: { sym: "ETH", px: 0, tvl: 4e6, feeBps: 30, dx: 0 },
    v3: { lo: -20, hi: 25, dep: 10000, feeBps: 500 },
    cv: { A: 100, bal: [1e6, 1e6, 1e6], feeBps: 4, dx: 100000, depeg: 0 },
    il: { r: 100, sigma: 60, drift: 0, feeApr: 18, days: 90, w: 50, paths: 2000 },
    stk: { total: 34e6, eb: 32, mev: 1.1, part: 99, lock: 4, slashed: 300, avs: 3, corr: 50 }
  };

  function live(sym) {
    var c = C.coin(sym || ST.v2.sym);
    return c && c.price > 0 ? c.price : 0;
  }
  function pairPrice() { var p = live(); return p > 0 ? p : 3000; }

  /* ---------------------------------------------------------- tiny chart (no dependency) */
  function draw(cv, series, o) {
    if (!cv || !cv.getContext) return;
    o = o || {};
    var dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 320, h = cv.clientHeight || 200;
    cv.width = w * dpr; cv.height = h * dpr;
    var g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    var all = [], i, j;
    for (i = 0; i < series.length; i++) for (j = 0; j < series[i].v.length; j++) if (isFinite(series[i].v[j])) all.push(series[i].v[j]);
    if (!all.length) return;
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    if (o.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (hi - lo < 1e-9) { hi = lo + 1; }
    var pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    var X = function (k, n) { return 8 + k * (w - 16) / Math.max(1, n - 1); };
    var Y = function (v) { return h - 10 - (v - lo) / (hi - lo) * (h - 20); };
    if (o.zero && lo < 0 && hi > 0) {
      g.strokeStyle = "rgba(148,163,199,.35)"; g.setLineDash([4, 4]); g.beginPath();
      g.moveTo(8, Y(0)); g.lineTo(w - 8, Y(0)); g.stroke(); g.setLineDash([]);
    }
    for (i = 0; i < series.length; i++) {
      var s = series[i]; if (!s.v.length) continue;
      g.strokeStyle = s.c || "#14BED0"; g.lineWidth = s.lw || 2; g.beginPath();
      for (j = 0; j < s.v.length; j++) { var x = X(j, s.v.length), y = Y(s.v[j]); j ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
      if (s.fill) {
        g.lineTo(X(s.v.length - 1, s.v.length), Y(o.zero ? 0 : lo)); g.lineTo(X(0, s.v.length), Y(o.zero ? 0 : lo)); g.closePath();
        g.fillStyle = s.fill; g.fill();
      }
    }
    if (o.marks) for (i = 0; i < o.marks.length; i++) {
      var m = o.marks[i], mx = X(m.at, o.n || 100);
      g.strokeStyle = m.c || "rgba(255,179,0,.7)"; g.lineWidth = 1; g.beginPath();
      g.moveTo(mx, 10); g.lineTo(mx, h - 10); g.stroke();
    }
  }

  /* ---------------------------------------------------------- small DOM helpers */
  function kv(k, v, cls) { return '<div class="kv"><span>' + k + '</span><b' + (cls ? ' class="' + cls + '"' : "") + ">" + v + "</b></div>"; }
  function sgn(v, d) { return '<span class="' + (v >= 0 ? "up" : "dn") + '">' + (v >= 0 ? "+" : "") + v.toFixed(d == null ? 2 : d) + "%</span>"; }
  function fld(label, id, val, step, min, max) {
    return '<label class="df-lab"><span class="df-cap">' + esc(label) +
      '</span><input class="dl-inp" type="number" id="' + id + '" value="' + val + '" step="' + (step || "any") + '"' +
      (min != null ? ' min="' + min + '"' : "") + (max != null ? ' max="' + max + '"' : "") + "></label>";
  }
  function rng2(label, id, val, min, max, step) {
    return '<label class="df-lab2"><span class="df-cap">' + esc(label) +
      ' <b id="' + id + 'v" class="df-val">' + val + '</b></span>' +
      '<input type="range" id="' + id + '" value="' + val + '" min="' + min + '" max="' + max + '" step="' + (step || 1) + '" class="df-rng"></label>';
  }
  function on(id, ev, fn) { var el = $(id); if (el) el.addEventListener(ev, fn); }
  function val(id, d) { var el = $(id); return el ? num(el.value, d) : d; }

  /* ============================================================
     TAB 1 · the constant-product pool
     ============================================================ */
  function tabPool(body) {
    var px = pairPrice(), sym = ST.v2.sym;
    var ry = ST.v2.tvl / 2, rx = ry / px;                    /* seeded 50/50 at the live price */
    var P = { rx: rx, ry: ry, ts: Math.sqrt(rx * ry), kLast: rx * ry, sym: sym, feeBps: ST.v2.feeBps, vol: 0, fees: 0, trades: 0 };
    ST.v2.pool = P;
    body.innerHTML =
      '<div class="dl154"><div class="h">💧 Constant product · ' + esc(sym) + '/USD ' + C.simTag() +
        '<span class="sp"></span><span class="df-cap">x · y = k</span></div>' +
        '<div id="dfPoolStats"></div>' +
        '<div class="dl-2 df-mt10">' +
          '<div>' + fld("Swap USD → " + esc(sym), "dfSwapUsd", 25000, 100, 0) +
            '<button class="dl-b pri df-w100" id="dfSwapGo">Preview the swap</button>' +
            '<div id="dfSwapOut" class="df-mt8"></div></div>' +
          '<div>' + fld("Add liquidity (USD, split 50/50)", "dfAddUsd", 10000, 100, 0) +
            '<button class="dl-b df-w100" id="dfAddGo">Provide liquidity</button>' +
            '<div class="n">Your deposit is split at the pool ratio and funded from the paper book. The pair mints min(dx·T/x, dy·T/y) shares — deposit off-ratio and the surplus is simply refused.</div></div>' +
        '</div>' +
        '<canvas class="dl-cv df-h180 df-mt12" id="dfPoolCv"></canvas>' +
        '<div class="n">The curve is the pool. Every swap slides along it, and the further you slide the worse your price — that is slippage, and it is arithmetic, not a fee.</div>' +
        '<div class="dl-formula">out = dx·(1−f)·y / (x + dx·(1−f))   ·   f = ' + (P.feeBps / 100).toFixed(2) + '%\n' +
        'shares = min(dx·T/x, dy·T/y)   ·   first mint = √(x·y) − MINIMUM_LIQUIDITY\n' +
        'protocol fee = T·(√k − √k_last) / (5√k + √k_last)   — one sixth of the growth in √k</div>' +
      '</div>';
    function stats() {
      var s = $("dfPoolStats"); if (!s) return;
      s.innerHTML = kv("Reserves", P.rx.toFixed(4) + " " + esc(sym) + "  ·  " + money(P.ry, 0)) +
        kv("Pool price", money(V2.spot(P.rx, P.ry), 2)) +
        kv("k (invariant)", C.big(P.rx * P.ry)) +
        kv("LP shares outstanding", P.ts.toFixed(6)) +
        kv("Volume through the pool", money(P.vol, 0)) +
        kv("Fees paid to LPs", money(P.fees, 2), "up") +
        kv("Protocol cut if the switch is on", V2.mintFee(P.rx, P.ry, P.kLast, P.ts).toFixed(8) + " shares");
      curve();
    }
    function curve() {
      var cv = $("dfPoolCv"); if (!cv) return;
      var k = P.rx * P.ry, pts = [], i, lo = P.rx * 0.35, hi = P.rx * 2.2;
      for (i = 0; i <= 90; i++) { var x = lo + (hi - lo) * i / 90; pts.push(k / x); }
      var at = Math.round((P.rx - lo) / (hi - lo) * 90);
      draw(cv, [{ v: pts, c: "#5B7CFF", lw: 2, fill: "rgba(91,124,255,.10)" }], { marks: [{ at: at, c: "rgba(20,190,208,.9)" }], n: 91 });
    }
    stats();
    on("dfSwapGo", "click", function () {
      var dUsd = val("dfSwapUsd", 0); if (!(dUsd > 0)) return;
      var r = V2.swap(dUsd, P.ry, P.rx, P.feeBps);            /* USD in, token out */
      var mid = P.rx > 0 ? P.ry / P.rx : 0;
      $("dfSwapOut").innerHTML =
        kv("You receive", r.out.toFixed(6) + " " + esc(sym)) +
        kv("At a mid price you would have got", (dUsd / mid).toFixed(6) + " " + esc(sym)) +
        kv("Effective price", money(dUsd / r.out, 2)) +
        kv("Price impact + fee", (r.impact * 100).toFixed(3) + "%", r.impact > 0.01 ? "dn" : "") +
        kv("Fee to LPs", money(dUsd * P.feeBps / 1e4, 2), "up") +
        kv("k after", C.big(r.k1) + " (never below " + C.big(r.k0) + ")") +
        '<button class="dl-b df-w100 df-mt8" id="dfSwapExec">Execute against the pool</button>';
      on("dfSwapExec", "click", function () {
        var e = V2.swap(dUsd, P.ry, P.rx, P.feeBps);
        P.ry = e.rx; P.rx = e.ry; P.vol += dUsd; P.fees += dUsd * P.feeBps / 1e4; P.trades++;
        stats(); $("dfSwapOut").innerHTML = '<div class="n">Executed. The reserves moved — quote it again and the price is worse.</div>';
        C.xp("defi.swap", 10, "First AMM swap — you moved the price yourself");
      });
    });
    on("dfAddGo", "click", function () {
      var usd = val("dfAddUsd", 0); if (!(usd > 0)) return;
      addLP({ kind: "v2", sym: sym, usd: usd, px: V2.spot(P.rx, P.ry), feeBps: P.feeBps,
        share: V2.mint(usd / 2 / V2.spot(P.rx, P.ry), usd / 2, P.rx, P.ry, P.ts) / P.ts });
    });
  }

  /* ============================================================
     TAB 2 · concentrated liquidity
     ============================================================ */
  function tabRange(body) {
    var px = pairPrice(), sym = ST.v2.sym;
    body.innerHTML =
      '<div class="dl154"><div class="h">🎯 Concentrated range · ' + esc(sym) + '/USD ' + C.simTag() + '</div>' +
        '<div class="dl-2">' +
          '<div>' + rng2("Lower bound (% from spot)", "dfLo", ST.v3.lo, -80, -1, 1) +
            rng2("Upper bound (% from spot)", "dfHi", ST.v3.hi, 1, 300, 1) +
            fld("Deposit (USD)", "dfDep", ST.v3.dep, 100, 0) +
            '<label class="df-lab"><span class="df-cap">Fee tier</span>' +
            '<select class="dl-inp" id="dfTier"><option value="100">0.01% · stable pairs</option><option value="500" selected>0.05% · correlated</option>' +
            '<option value="3000">0.30% · standard</option><option value="10000">1.00% · exotic</option></select></label></div>' +
          '<div id="dfRangeStats"></div>' +
        '</div>' +
        '<canvas class="dl-cv df-h200 df-mt12" id="dfRangeCv"></canvas>' +
        '<div class="n">The blue line is what your position is worth as the price moves; the dashed grey is holding the same two tokens. Inside the range you earn fees. Outside it you hold one asset, earn nothing, and the loss stops growing only because there is nothing left to convert.</div>' +
        '<div id="dfRangeVerdict"></div>' +
        '<button class="dl-b pri df-w100 df-mt10" id="dfRangeGo">Open this position</button>' +
        '<div class="dl-formula">L = min( x·√P·√Pb/(√Pb−√P) , y/(√P−√Pa) )\n' +
        'x = L(√Pb−√P)/(√P·√Pb)   ·   y = L(√P−√Pa)\n' +
        'capital efficiency = 2√P / (2√P − √Pa − P/√Pb)   vs the same money spread over every price</div>' +
      '</div>';
    function paint() {
      var lo = val("dfLo", ST.v3.lo), hi = val("dfHi", ST.v3.hi), dep = val("dfDep", ST.v3.dep), tier = val("dfTier", 500);
      ST.v3.lo = lo; ST.v3.hi = hi; ST.v3.dep = dep; ST.v3.feeBps = tier;
      var t = $("dfLov"); if (t) t.textContent = lo + "%";
      var t2 = $("dfHiv"); if (t2) t2.textContent = "+" + hi + "%";
      var Pa = px * (1 + lo / 100), Pb = px * (1 + hi / 100);
      /* split the deposit the way the range demands, then read the liquidity back */
      var L = V3.liquidityFor(px, Pa, Pb, 1, px), a = V3.amountsFor(L, px, Pa, Pb);
      var unit = a.x * px + a.y, scale = unit > 0 ? dep / unit : 0;
      L *= scale; a = V3.amountsFor(L, px, Pa, Pb);
      var eff = V3.efficiency(px, Pa, Pb);
      var lowTick = V3.usable(V3.priceToTick(Pa), tier === 100 ? 1 : tier === 500 ? 10 : tier === 3000 ? 60 : 200);
      var hiTick = V3.usable(V3.priceToTick(Pb), tier === 100 ? 1 : tier === 500 ? 10 : tier === 3000 ? 60 : 200);
      $("dfRangeStats").innerHTML =
        kv("Range", money(Pa, 2) + " → " + money(Pb, 2)) +
        kv("Ticks (spacing applied)", Math.round(lowTick) + " → " + Math.round(hiTick)) +
        kv("Liquidity L", L.toFixed(4)) +
        kv("You deposit", a.x.toFixed(6) + " " + esc(sym) + "  +  " + money(a.y, 2)) +
        kv("Capital efficiency vs full range", eff.toFixed(1) + "×", "up") +
        kv("Fee tier", (tier / 1e4).toFixed(2) + "%") +
        kv("Fully converted to " + esc(sym) + " below", money(Pa, 2)) +
        kv("Fully converted to USD above", money(Pb, 2));
      /* value curve across a wide price sweep */
      var vs = [], hs = [], i, a0 = a, n = 100, loP = px * 0.4, hiP = px * 2.2, marks = [];
      for (i = 0; i <= n; i++) {
        var P1 = loP + (hiP - loP) * i / n;
        vs.push(V3.value(L, P1, Pa, Pb));
        hs.push(a0.x * P1 + a0.y);
      }
      marks.push({ at: Math.round((Pa - loP) / (hiP - loP) * n), c: "rgba(255,179,0,.6)" });
      marks.push({ at: Math.round((Pb - loP) / (hiP - loP) * n), c: "rgba(255,179,0,.6)" });
      marks.push({ at: Math.round((px - loP) / (hiP - loP) * n), c: "rgba(20,190,208,.9)" });
      draw($("dfRangeCv"), [
        { v: hs, c: "rgba(148,163,199,.55)", lw: 1.5 },
        { v: vs, c: "#14BED0", lw: 2.5, fill: "rgba(20,190,208,.08)" }
      ], { marks: marks, n: n + 1 });
      var il20 = IL.v3(1.2, px, Pa, Pb) * 100, ilD20 = IL.v3(0.8, px, Pa, Pb) * 100;
      var flat20 = IL.v2(1.2) * 100;
      $("dfRangeVerdict").innerHTML =
        '<div class="dl154 df-mt10"><div class="h">What the range costs you</div>' +
        kv("If " + esc(sym) + " rises 20%", sgn(il20) + " vs holding") +
        kv("If " + esc(sym) + " falls 20%", sgn(ilD20) + " vs holding") +
        kv("A full-range position at +20% would lose", sgn(flat20)) +
        '<div class="n">Concentration cuts both ways: ' + eff.toFixed(1) + '× the fees per dollar while the price sits inside, and ' +
        (Math.abs(il20 / (flat20 || -1))).toFixed(1) + '× the divergence loss when it walks out. This is the trade, and no interface can make it go away.</div></div>';
    }
    ["dfLo", "dfHi", "dfDep", "dfTier"].forEach(function (id) { on(id, "input", paint); on(id, "change", paint); });
    paint();
    on("dfRangeGo", "click", function () {
      var lo = val("dfLo", -20), hi = val("dfHi", 25), dep = val("dfDep", 10000);
      addLP({ kind: "v3", sym: sym, usd: dep, px: px, lo: px * (1 + lo / 100), hi: px * (1 + hi / 100), feeBps: val("dfTier", 500) / 100 });
    });
  }

  /* ============================================================
     TAB 3 · StableSwap
     ============================================================ */
  function tabStable(body) {
    body.innerHTML =
      '<div class="dl154"><div class="h">⚖ StableSwap · 3-pool ' + C.simTag() +
        '<span class="sp"></span><span class="df-cap">Curve invariant</span></div>' +
        '<div class="dl-2">' +
          '<div>' + rng2("Amplification A", "dfA", ST.cv.A, 1, 2000, 1) +
            rng2("Pool imbalance (%)", "dfImb", 0, 0, 90, 1) +
            fld("Swap size (coin A → coin B)", "dfCvDx", ST.cv.dx, 1000, 0) +
            '<div class="n">A is the whole argument. High A pins the pool to 1:1 and makes big swaps cheap — until the peg breaks, when the same A hands arbitrageurs the pool at par.</div></div>' +
          '<div id="dfCvStats"></div>' +
        '</div>' +
        '<canvas class="dl-cv df-h190 df-mt12" id="dfCvCv"></canvas>' +
        '<div class="n">Blue is the StableSwap curve, grey is x·y=k for the same reserves. The flat middle is the entire product.</div>' +
        '<div class="dl-formula">A·n^n·S + D = A·D·n^n + D^(n+1) / (n^n·Πx)     (Newton, 255 iterations, same as get_D)\n' +
        'imbalanced deposit fee = f·n / (4(n−1))     ·     virtual price = D / LP supply</div>' +
      '</div>';
    function paint() {
      var A = val("dfA", 100), imb = val("dfImb", 0), dx = val("dfCvDx", 100000);
      var t = $("dfAv"); if (t) t.textContent = A;
      var t2 = $("dfImbv"); if (t2) t2.textContent = imb + "%";
      var base = 1e6, xs = [base * (1 + imb / 100), base, base * (1 - imb / 100 * 0.6)];
      var D = CURVE.D(xs, A), ex = CURVE.exchange(xs, 0, 1, dx, A, ST.cv.feeBps);
      var cmp = CURVE.vsConstantProduct(xs, 0, 1, dx, A, ST.cv.feeBps);
      var supply = base * 3;
      $("dfCvStats").innerHTML =
        kv("Balances", xs.map(function (v) { return C.big(v); }).join("  ·  ")) +
        kv("Invariant D", C.big(D)) +
        kv("Virtual price", CURVE.virtualPrice(xs, A, supply).toFixed(6)) +
        kv("You swap", C.big(dx) + " A") +
        kv("You receive", C.big(ex.out) + " B") +
        kv("Rate", ex.rate.toFixed(6), ex.rate < 0.995 ? "dn" : "up") +
        kv("Slippage vs 1:1", ((1 - ex.rate) * 100).toFixed(4) + "%") +
        kv("Same trade on x·y=k", C.big(cmp.product) + " B") +
        kv("StableSwap advantage", sgn(cmp.edge * 100, 3)) +
        kv("Imbalanced-deposit fee", (CURVE.imbalanceFee(ST.cv.feeBps, 3) / 100).toFixed(4) + "%");
      var pts = [], cps = [], i, n = 80;
      for (i = 0; i <= n; i++) {
        var d = base * 1.6 * i / n;
        var e = CURVE.exchange(xs, 0, 1, d + 1, A, ST.cv.feeBps);
        pts.push(e.rate);
        cps.push(d > 0 ? V2.out(d, xs[0], xs[1], ST.cv.feeBps) / d : 1);
      }
      draw($("dfCvCv"), [
        { v: cps, c: "rgba(148,163,199,.55)", lw: 1.5 },
        { v: pts, c: "#14BED0", lw: 2.5, fill: "rgba(20,190,208,.08)" }
      ], {});
    }
    ["dfA", "dfImb", "dfCvDx"].forEach(function (id) { on(id, "input", paint); on(id, "change", paint); });
    paint();
  }

  /* ============================================================
     TAB 4 · the IL lab
     ============================================================ */
  function tabIL(body) {
    body.innerHTML =
      '<div class="dl154"><div class="h">📉 Divergence loss lab ' + C.simTag() + '</div>' +
        '<div class="dl-2">' +
          '<div>' + rng2("Price change of the volatile asset (%)", "dfR", 0, -90, 400, 1) +
            rng2("Pool weight on that asset (%)", "dfW", ST.il.w, 5, 95, 5) +
            rng2("Annualised volatility (%)", "dfSig", ST.il.sigma, 5, 200, 5) +
            rng2("Fee APR the pool actually pays (%)", "dfFee", ST.il.feeApr, 0, 200, 1) +
            rng2("Horizon (days)", "dfDays", ST.il.days, 7, 730, 1) +
            '</div>' +
          '<div id="dfIlStats"></div>' +
        '</div>' +
        '<canvas class="dl-cv df-h200 df-mt12" id="dfIlCv"></canvas>' +
        '<div class="n">The curve is divergence loss against price change. It is symmetric in ratio, never positive, and it is only "impermanent" if the price comes back — which is a hope, not a mechanism.</div>' +
        '<div id="dfMc"></div>' +
        '<button class="dl-b pri df-w100 df-mt10" id="dfMcGo">Run 2,000 simulated paths</button>' +
        '<div class="dl-formula">50/50:      IL = 2√r/(1+r) − 1\n' +
        'weighted:   IL = Π rᵢ^wᵢ / Σ wᵢrᵢ − 1            (Balancer)\n' +
        'LVR:        σ²/8 per year of pool value          (Milionis–Moallemi–Roughgarden–Zhang)\n' +
        'break-even: fee APR ≥ −IL × 365/days\n' +
        'paths:      dS/S = μ dt + σ dW, daily steps, seeded — the same seed gives the same answer</div>' +
      '</div>';
    function paint() {
      var r = 1 + val("dfR", 0) / 100, w = val("dfW", 50) / 100, sig = val("dfSig", 60),
        fee = val("dfFee", 18), days = val("dfDays", 90);
      [["dfRv", (val("dfR", 0) >= 0 ? "+" : "") + val("dfR", 0) + "%"], ["dfWv", val("dfW", 50) + "/" + (100 - val("dfW", 50))],
       ["dfSigv", sig + "%"], ["dfFeev", fee + "%"], ["dfDaysv", days + " d"]].forEach(function (p) { var e = $(p[0]); if (e) e.textContent = p[1]; });
      ST.il = { r: val("dfR", 0), sigma: sig, drift: 0, feeApr: fee, days: days, w: val("dfW", 50), paths: 2000 };
      var il50 = IL.v2(r) * 100, ilW = IL.weighted([r, 1], [w, 1 - w]) * 100;
      var feeEarn = (Math.pow(1 + fee / 100, days / 365) - 1) * 100;
      var net = ((1 + ilW / 100) * (1 + feeEarn / 100) - 1) * 100;
      var lvr = IL.lvrAPR(sig), be = IL.breakevenFeeAPR(ilW, days);
      $("dfIlStats").innerHTML =
        kv("Divergence loss · 50/50", sgn(il50), il50 < 0 ? "dn" : "") +
        kv("Divergence loss · " + val("dfW", 50) + "/" + (100 - val("dfW", 50)), sgn(ilW), ilW < 0 ? "dn" : "") +
        kv("Fees earned over " + days + " days", sgn(feeEarn), "up") +
        kv("LP vs simply holding", sgn(net), net >= 0 ? "up" : "dn") +
        kv("Break-even fee APR needed", be.toFixed(1) + "%", fee >= be ? "up" : "dn") +
        kv("LVR — what arbitrage takes, per year", lvr.toFixed(2) + "%", "dn") +
        kv("Does the fee cover the arbitrage?", fee >= lvr ? "yes, by " + (fee - lvr).toFixed(1) + " points" : "no, short by " + (lvr - fee).toFixed(1) + " points", fee >= lvr ? "up" : "dn") +
        '<div class="n">LVR is the honest floor: even with no fee income, an arbitrageur rebalances your pool for free and keeps the difference. A pool whose fee APR sits below σ²/8 is paying its LPs to provide a public service.</div>';
      var vs = [], ws = [], i, n = 100;
      for (i = 0; i <= n; i++) {
        var rr = 0.1 + 3.9 * i / n;
        vs.push(IL.v2(rr) * 100); ws.push(IL.weighted([rr, 1], [w, 1 - w]) * 100);
      }
      draw($("dfIlCv"), [
        { v: vs, c: "rgba(148,163,199,.55)", lw: 1.5 },
        { v: ws, c: "#F0455E", lw: 2.5, fill: "rgba(240,69,94,.08)" }
      ], { zero: true, marks: [{ at: Math.round((r - 0.1) / 3.9 * n) }], n: n + 1 });
    }
    ["dfR", "dfW", "dfSig", "dfFee", "dfDays"].forEach(function (id) { on(id, "input", paint); });
    paint();
    on("dfMcGo", "click", function () {
      var d = D(), seed = (d && d.seed) || 42;
      var mc = IL.monteCarlo({ paths: 2000, days: ST.il.days, sigma: ST.il.sigma, drift: 0, feeApr: ST.il.feeApr, seed: seed });
      $("dfMc").innerHTML = '<div class="dl154 df-mt10"><div class="h">2,000 paths · seed ' + seed + ' ' + C.simTag() + '</div>' +
        kv("Median outcome vs holding", sgn(mc.median)) +
        kv("Middle half of outcomes", sgn(mc.p25) + " → " + sgn(mc.p75)) +
        kv("5th to 95th percentile", sgn(mc.p5) + " → " + sgn(mc.p95)) +
        kv("Paths where the LP beat holding", mc.winRate.toFixed(1) + "%", mc.winRate >= 50 ? "up" : "dn") +
        '<canvas class="dl-cv df-h150 df-mt10" id="dfMcCv"></canvas>' +
        '<div class="n">Geometric Brownian motion at ' + ST.il.sigma + '% vol over ' + ST.il.days + ' days, fees accrued at ' + ST.il.feeApr +
        '% APR. Sorted outcomes, worst on the left. Re-running gives the same picture: the seed is fixed so the lab can be argued with.</div></div>';
      var step = Math.max(1, Math.floor(mc.dist.length / 120)), thin = [];
      for (var i = 0; i < mc.dist.length; i += step) thin.push(mc.dist[i]);
      draw($("dfMcCv"), [{ v: thin, c: "#5B7CFF", lw: 2, fill: "rgba(91,124,255,.12)" }], { zero: true });
      C.xp("defi.mc", 15, "Ran the IL lab — a distribution, not a promise");
    });
  }

  /* ============================================================
     TAB 5 · staking
     ============================================================ */
  function tabStake(body) {
    body.innerHTML =
      '<div class="dl154"><div class="h">🔐 Proof-of-stake · the spec\'s own arithmetic ' + C.simTag() + '</div>' +
        '<div class="dl-2">' +
          '<div>' + rng2("Total ETH staked (millions)", "dfTot", 34, 1, 120, 1) +
            rng2("Execution-layer rewards — tips + MEV (% APR)", "dfMev", ST.stk.mev * 10, 0, 60, 1) +
            rng2("Your uptime (%)", "dfPart", ST.stk.part, 50, 100, 1) +
            '<div id="dfStkStats"></div></div>' +
          '<div>' + rng2("ETH slashed in the same 36-day window", "dfSl", ST.stk.slashed, 0, 20000, 100) +
            '<div id="dfSlashStats"></div>' +
            rng2("Lock length for a ve-position (years)", "dfLock", 4, 0, 4, 0.25) +
            '<div id="dfVeStats"></div></div>' +
        '</div>' +
        '<canvas class="dl-cv df-h180 df-mt12" id="dfStkCv"></canvas>' +
        '<div class="n">Yield against total stake. It is a √ curve because the spec divides the base reward by √(total active balance): every validator that joins pays for itself out of everyone\'s reward.</div>' +
        '<div id="dfLstStats"></div>' +
        '<div class="dl-2 df-mt10"><div>' + fld("Paper-stake (USD)", "dfStkUsd", 5000, 100, 0) +
        '<button class="dl-b pri df-w100" id="dfStkGo">Stake it</button></div>' +
        '<div id="dfRestake"></div></div>' +
        '<div class="dl-formula">base reward/increment = 1 ETH × 64 / √(total active balance)   ·   32 increments/validator · 82,180 epochs/yr\n' +
        'slashing = EB/32  +  min(EB, 3 × EB × slashed/total)        ·  exit churn = max(4, active/65536) per epoch\n' +
        'accrual  = Synthetix rewardPerToken: rpt += rate·Δt/supply ; earned = bal·(rpt − paid)\n' +
        've boost = min(0.4b + 0.6·S·ve/veTotal, b) / 0.4b, capped at 2.5×</div>' +
      '</div>';
    function paint() {
      var tot = val("dfTot", 34) * 1e6, mev = val("dfMev", 11) / 10, part = val("dfPart", 99) / 100,
        sl = val("dfSl", 300), lock = val("dfLock", 4);
      [["dfTotv", val("dfTot", 34) + "M ETH"], ["dfMevv", (mev).toFixed(1) + "%"], ["dfPartv", val("dfPart", 99) + "%"],
       ["dfSlv", C.big(sl) + " ETH"], ["dfLockv", lock + " yr"]].forEach(function (p) { var e = $(p[0]); if (e) e.textContent = p[1]; });
      var a = STK.ethAPR(tot, 32, part, mev);
      $("dfStkStats").innerHTML =
        kv("Consensus-layer APR", a.consensus.toFixed(2) + "%", "up") +
        kv("Execution-layer APR", a.execution.toFixed(2) + "%", "up") +
        kv("Total nominal APR", a.total.toFixed(2) + "%", "up") +
        kv("Network issuance", C.big(a.issuance) + " ETH / year") +
        kv("Share of supply staked", (tot / 120.4e6 * 100).toFixed(1) + "%") +
        kv("Exit queue if 5% leave at once", STK.exitQueueDays(tot / 32, tot * 0.05 / 32).toFixed(1) + " days");
      var s = STK.slash(32, tot, sl);
      $("dfSlashStats").innerHTML =
        kv("Initial penalty", s.initial.toFixed(4) + " ETH") +
        kv("Correlation penalty", s.correlation.toFixed(4) + " ETH", s.correlation > 1 ? "dn" : "") +
        kv("Total slashed from you", s.total.toFixed(4) + " ETH  (" + s.pct.toFixed(2) + "%)", "dn") +
        '<div class="n">Alone you lose about 1 ETH. In a correlated failure — one client bug, one cloud region — the penalty scales with everyone else who went down with you, up to your whole balance. That is the argument for client diversity, stated as arithmetic.</div>';
      var ve = STK.veBalance(1000, lock), b = STK.veBoost(1000, 1e6, ve, 5e5);
      $("dfVeStats").innerHTML =
        kv("ve-balance from 1,000 tokens", ve.toFixed(0)) +
        kv("Working balance", b.working.toFixed(0)) +
        kv("Reward boost", b.boost.toFixed(2) + "×", b.boost > 1.5 ? "up" : "") +
        '<div class="n">The lock decays linearly to zero. A four-year lock is not a deposit — it is an illiquid position whose only exit is the secondary market.</div>';
      var l = STK.lst(1.0, a.total * 0.9, 365, -1.5, 7);
      $("dfLstStats").innerHTML = '<div class="dl154 df-mt10"><div class="h">💧 Liquid staking</div>' +
        kv("Redemption rate after a year", l.rate.toFixed(5) + " ETH per LST") +
        kv("Secondary-market price", l.market.toFixed(5) + " ETH  (" + l.discountPct.toFixed(1) + "%)", l.discountPct < 0 ? "dn" : "up") +
        kv("Withdrawal queue", l.queueDays + " days") +
        kv("Operator fee assumed", "10% of rewards") +
        '<div class="n">An LST ' + l.note + '. The discount is the market pricing the queue: when exit takes ' + l.queueDays +
        ' days, selling at −' + Math.abs(l.discountPct).toFixed(1) + '% is the cost of not waiting. In stress that gap widens, which is how a "pegged" asset becomes a leveraged one.</div></div>';
      var rs = STK.restake(10000, a.total, [{ apr: 3.2, slashPct: 5, prob: 0.02 }, { apr: 2.1, slashPct: 10, prob: 0.01 }, { apr: 1.4, slashPct: 15, prob: 0.005 }], 0.5);
      $("dfRestake").innerHTML = '<div class="dl154"><div class="h">🔁 Restaking · 3 services</div>' +
        kv("Stacked APR", rs.apr.toFixed(2) + "%", "up") +
        kv("Expected slashing cost", rs.expectedLossPct.toFixed(2) + "%", "dn") +
        kv("Expected net", rs.expectedNetAPR.toFixed(2) + "%", rs.expectedNetAPR > a.total ? "up" : "dn") +
        kv("Worst correlated case", "−" + rs.worstCasePct.toFixed(1) + "%", "dn") +
        '<div class="n">The extra yield is real and so is the extra way to lose. One stake now answers to three slashers, and their failures are not independent.</div>';
      var pts = [], i;
      for (i = 0; i <= 60; i++) pts.push(STK.ethAPR(2e6 + i * 2e6, 32, 1, mev).total);
      draw($("dfStkCv"), [{ v: pts, c: "#3AE58F", lw: 2.5, fill: "rgba(58,229,143,.10)" }],
        { marks: [{ at: Math.round((tot - 2e6) / 2e6) }], n: 61 });
    }
    ["dfTot", "dfMev", "dfPart", "dfSl", "dfLock"].forEach(function (id) { on(id, "input", paint); });
    paint();
    on("dfStkGo", "click", function () {
      var usd = val("dfStkUsd", 0); if (!(usd > 0)) return;
      var a = STK.ethAPR(val("dfTot", 34) * 1e6, 32, val("dfPart", 99) / 100, val("dfMev", 11) / 10);
      addStake({ usd: usd, apr: a.total, kind: "eth", label: "Ethereum validator (pooled)" });
    });
  }

  /* ============================================================
     TAB 6 · my positions
     ============================================================ */
  function addLP(p) {
    var d = D(); if (!d) return;
    try {
      var bal = S.bal.USDT || 0;
      if (p.usd > bal) { C.toast("bad", "Not enough paper USDT", "You have " + money(bal, 2) + " on the main book"); return; }
      S.bal.USDT = bal - p.usd;
    } catch (e) { return; }
    p.t = Date.now(); p.fees = 0;
    d.lp.unshift(p); if (d.lp.length > 40) d.lp.pop();
    C.save(); try { updateNavBal(); } catch (e) {}
    C.sfx("buy");
    C.toast("good", "Liquidity provided" + C.simTag(),
      money(p.usd, 2) + " into " + (p.kind === "v3" ? "a " + esc(p.sym) + " range" : esc(p.sym) + "/USD") + " — you now hold both sides, and the pool decides the mix");
    C.xp("defi.lp", 20, "First liquidity position — you are the counterparty now");
    open("mine");
  }
  function addStake(s) {
    var d = D(); if (!d) return;
    try {
      var bal = S.bal.USDT || 0;
      if (s.usd > bal) { C.toast("bad", "Not enough paper USDT", "You have " + money(bal, 2) + " on the main book"); return; }
      S.bal.USDT = bal - s.usd;
    } catch (e) { return; }
    s.t = Date.now();
    d.st.unshift(s); if (d.st.length > 40) d.st.pop();
    C.save(); try { updateNavBal(); } catch (e) {}
    C.sfx("buy");
    C.toast("good", "Paper-staked" + C.simTag(), money(s.usd, 2) + " at " + s.apr.toFixed(2) + "% — a rate observed today, not promised tomorrow");
    C.xp("defi.stake", 15, "First stake — the yield is the easy part, the exit queue is not");
    open("mine");
  }
  /* mark a position to the live price: divergence loss is computed, not stored */
  function markLP(p) {
    var now = live(p.sym) || p.px, r = p.px > 0 ? now / p.px : 1;
    var days = (Date.now() - p.t) / 864e5;
    var il = p.kind === "v3" ? IL.v3(r, p.px, p.lo, p.hi) : IL.v2(r);
    var feeApr = p.kind === "v3" ? 24 : 12;                    /* the desk's stated assumption */
    var fees = p.usd * (Math.pow(1 + feeApr / 100, days / 365) - 1);
    var hodl = p.usd * (1 + r) / 2;                            /* half the book rode the move */
    var value = hodl * (1 + il) + fees;
    return { r: r, days: days, il: il * 100, fees: fees, hodl: hodl, value: value, pl: value - p.usd, vsHodl: value - hodl };
  }
  function markStake(s) {
    var days = (Date.now() - s.t) / 864e5;
    return { days: days, value: s.usd * Math.pow(1 + s.apr / 100, days / 365) };
  }
  function tabMine(body) {
    var d = D();
    if (!d) { body.innerHTML = '<div class="dl-empty">The paper book is not ready yet.</div>'; return; }
    var lp = d.lp || [], st = d.st || [], i;
    var rows = lp.map(function (p, i) {
      var m = markLP(p);
      return '<tr><td><b>' + esc(p.sym) + (p.kind === "v3" ? " · range" : " · 50/50") + '</b><br><span class="df-sub">' +
        (p.kind === "v3" ? money(p.lo, 0) + "–" + money(p.hi, 0) + (V3.inRange(live(p.sym) || p.px, p.lo, p.hi) ? " · in range" : " · OUT OF RANGE, earning nothing") : "full range") +
        " · " + C.ago(p.t) + '</span></td><td class="r">' + money(p.usd, 0) + '</td><td class="r">' + money(m.value, 2) +
        '</td><td class="r ' + (m.il < 0 ? "dn" : "") + '">' + m.il.toFixed(2) + '%</td><td class="r up">' + money(m.fees, 2) +
        '</td><td class="r ' + (m.vsHodl >= 0 ? "up" : "dn") + '">' + (m.vsHodl >= 0 ? "+" : "") + money(m.vsHodl, 2) +
        '</td><td class="r"><button class="dl-b" data-rm="' + i + '">Remove</button></td></tr>';
    }).join("");
    var srows = st.map(function (s, i) {
      var m = markStake(s);
      return '<tr><td><b>' + esc(s.label) + '</b><br><span class="df-sub">' + s.apr.toFixed(2) + "% APR at stake time · " + C.ago(s.t) +
        '</span></td><td class="r">' + money(s.usd, 0) + '</td><td class="r">' + money(m.value, 2) + '</td><td class="r up">+' +
        money(m.value - s.usd, 2) + '</td><td class="r"><button class="dl-b" data-us="' + i + '">Unstake</button></td></tr>';
    }).join("");
    body.innerHTML =
      '<div class="dl154"><div class="h">🧾 Liquidity positions ' + C.simTag() + '</div>' +
        (lp.length ? '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Position</th><th class="r">In</th><th class="r">Value</th><th class="r">Divergence</th><th class="r">Fees</th><th class="r">vs holding</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>"
          : '<div class="dl-empty">No liquidity provided yet. The Pools tab is where you become the counterparty.</div>') +
        '<div class="n">Value is marked to the live price every time you open this tab: divergence loss is recomputed from the price ratio, never stored. Fee income assumes 12% APR full-range / 24% in-range — the desk\'s stated assumption, not a measured pool.</div></div>' +
      '<div class="dl154"><div class="h">🔐 Stakes ' + C.simTag() + '</div>' +
        (st.length ? '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Protocol</th><th class="r">In</th><th class="r">Value</th><th class="r">Yield</th><th></th></tr></thead><tbody>' + srows + "</tbody></table></div>"
          : '<div class="dl-empty">Nothing staked.</div>') + "</div>" +
      '<div class="dl154"><div class="h">🙈 What this desk does not model</div>' +
        BLIND.map(function (b) { return '<div class="kv"><span>' + esc(b) + "</span><b>—</b></div>"; }).join("") +
        '<div class="n">Every one of these has cost real people real money. A simulator that quietly left them out would be teaching the wrong lesson, so they are listed instead of hidden.</div></div>';
    body.querySelectorAll("[data-rm]").forEach(function (b) {
      b.onclick = function () {
        var i = +b.getAttribute("data-rm"), p = d.lp[i]; if (!p) return;
        var m = markLP(p);
        try { S.bal.USDT = (S.bal.USDT || 0) + m.value; updateNavBal(); } catch (e) {}
        d.lp.splice(i, 1); C.save(); C.sfx("sell");
        C.toast(m.vsHodl >= 0 ? "good" : "warn", "Liquidity removed" + C.simTag(),
          money(m.value, 2) + " back — " + (m.vsHodl >= 0 ? "ahead of" : "behind") + " simply holding by " + money(Math.abs(m.vsHodl), 2));
        open("mine");
      };
    });
    body.querySelectorAll("[data-us]").forEach(function (b) {
      b.onclick = function () {
        var i = +b.getAttribute("data-us"), s = d.st[i]; if (!s) return;
        var m = markStake(s);
        try { S.bal.USDT = (S.bal.USDT || 0) + m.value; updateNavBal(); } catch (e) {}
        d.st.splice(i, 1); C.save(); C.sfx("sell");
        C.toast("good", "Unstaked" + C.simTag(), money(m.value, 2) + " back (+" + money(m.value - s.usd, 2) + " paper yield)");
        open("mine");
      };
    });
  }

  /* ============================================================
     the desk
     ============================================================ */
  function bodyFor(t, body) {
    try {
      if (t === "range") return tabRange(body);
      if (t === "stable") return tabStable(body);
      if (t === "il") return tabIL(body);
      if (t === "stake") return tabStake(body);
      if (t === "mine") return tabMine(body);
      return tabPool(body);
    } catch (e) {
      body.innerHTML = '<div class="dl-empty">' + esc(e && e.message || e) + "</div>";
    }
  }
  function open(tab) {
    return C.open("dlDefi", {
      title: "🧪 Liquidity Desk",
      sub: "AMMs, staking and divergence loss — the contracts' own arithmetic, on paper money",
      tabs: [["pool", "Pools"], ["range", "Concentrated"], ["stable", "StableSwap"], ["il", "IL lab"], ["stake", "Staking"], ["mine", "My positions"]],
      onTab: bodyFor
    }, tab);
  }

  /* a launcher card in the Terminal's side column */
  function mountBtn() {
    try {
      var side = document.querySelector("#page-coin .side");
      if (!side || $("dlDefiCard")) return;
      /* the same chrome the Rewind card uses — it is the one already proved against
         the contrast gate in both modes, and a launcher is not the place to invent a button */
      var card = document.createElement("div");
      card.className = "card"; card.id = "dlDefiCard";
      var h = document.createElement("div"); h.className = "ph";
      var b = document.createElement("b"); b.textContent = "🧪 Liquidity Desk";
      var tag = document.createElement("span"); tag.className = "tag"; tag.textContent = "SIMULATED";
      h.appendChild(b); h.appendChild(tag);
      var note = document.createElement("div"); note.className = "fnote";
      note.textContent = "Provide liquidity into a constant-product pool or a concentrated range, push a stablecoin off its peg, stake into the consensus spec's own reward curve, and watch divergence loss decide whether any of it was worth it.";
      var go = document.createElement("button"); go.className = "btn"; go.type = "button";
      go.textContent = "Open the Liquidity Desk";
      go.onclick = function () { open(); };
      card.appendChild(h); card.appendChild(note); card.appendChild(go);
      var rw = $("dlRwCard");
      if (rw && rw.parentNode === side) side.insertBefore(card, rw); else side.appendChild(card);
    } catch (e) {}
  }

  C.cmd("liquidity", "Liquidity Desk — AMM pools, staking and impermanent loss", "🧪", function () { open(); });
  C.cmd("impermanent loss", "IL lab — divergence loss, LVR and a 2,000-path simulation", "📉", function () { open("il"); });
  C.cmd("staking", "Staking — the consensus spec's reward curve, slashing and ve-locks", "🔐", function () { open("stake"); });
  try { if (window.DLDESKS && DLDESKS.register) DLDESKS.register("defi", "🧪", "Liquidity", "AMM pools, staking and divergence loss", function () { open(); }); } catch (e) {}
  C.onPage("coin", mountBtn);

  return { __v: 159, open: open, mounts: mountBtn,
    V2: V2, V3: V3, CURVE: CURVE, IL: IL, STK: STK, rng: rng, blind: BLIND,
    positions: function () { return D(); } };
})();
