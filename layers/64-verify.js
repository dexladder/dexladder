/* ============================================================================
   DexLadder — DLVERIFY · layer 64 · v166 "check it yourself"
   THE VERIFY DESK

   The question this desk exists to answer: this number on my screen — where
   did it come from, and is it right?

   Until now the only answer was a methodology page. Trust (layer 41) states
   the laws and the model card; Health (layer 50) says whether the feeds and
   the storage are alive. Neither lets you take a figure off a desk and redo
   the arithmetic. This layer does, and it extends those two rather than
   repeating them: nothing here reports feed health, and nothing here restates
   the model card.

   HOW IT WORKS, AND WHY IT IS BUILT THIS WAY
     A formula registry holds the app's load-bearing arithmetic. Every entry
     carries its inputs with their units and their provenance, the formula in
     plain notation, a spreadsheet form of the same expression, and PINNED
     REFERENCE CASES with a citation for where the formula comes from.

     Every entry is computed TWICE, by two implementations written
     deliberately differently:
       A  the direct reading of the formula, printed as numbered working with
          every intermediate value, so a person can redo it on paper
       B  an independent route to the same number — a different algebra, a
          root-find instead of a closed form, an integral instead of a series,
          a prefix-sum instead of a drain loop
     The desk prints BOTH and the delta. Two implementations sharing one bug
     is possible; two implementations built from different identities sharing
     one bug is much less likely, and when they disagree this desk says so in
     large letters instead of picking a winner.

     Where the app ALREADY computes the same thing somewhere else, that third
     answer is pulled in and printed beside the other two — the engine's swap,
     DLDEFI's pair arithmetic, DLTAX's cost basis, DLSOR's all-in. The desk
     reports the gap. It does not decide which surface is right; that is the
     reader's job and this desk's whole point.

   LAWS OBSERVED
     · this layer NEVER trades and NEVER writes a balance. It has no path to
       the engine's fill or network-charge calls, no order, no position and no
       account write of any kind. It reads numbers and recomputes them, and the
       banner says so on every tab of the desk.
     · deterministic — there is no random source anywhere in this layer. Two
       runs of the self-test on the same build print the same deltas.
     · a missing figure stays missing — null, never 0 wearing a price's clothes
     · every other layer is guarded. A layer that is not in this build becomes
       a named "not in this build" row. Never an error, never a silent skip.
     · no storage key of its own — the desk's selection lives in the v154
       bucket through DLCORE.X(), namespaced under X().verify
     · nothing is compiled at runtime, no timers, no observers, no sockets
     · Day + Night — every rule lives in _v166css/64-verify.css, paired
   ============================================================================ */
(function () {
  "use strict";
  if (window.DLVERIFY && window.DLVERIFY.__v) return;

  var C = window.DLCORE;
  if (!C) return;

  var EPS = 1e-15;

  /* ------------------------------------------------------------- honesty */

  var ASSUMPTIONS = [
    "This desk verifies ARITHMETIC, not data. It can prove that the app applied the constant-product formula correctly to the reserves it was handed. It cannot prove those reserves are the reserves of a real pool — most of the market surfaces in this build are modelled, and the desks that model them say so on their own Method tabs. A green self-test means the maths is right about whatever it was fed.",
    "The MAINTENANCE MARGIN LADDER used for the perp formulas is Binance's published USD-margined BTCUSDT bracket table (notional up to 50k at 0.40% with a 0 maintenance amount, to 250k at 0.50%/50, to 1M at 1.00%/1,300, to 10M at 2.50%/16,300). It is the real published table for that one contract and it is used here as the WORKED EXAMPLE, not as a claim about any other venue, contract or account tier. Your venue's ladder will differ and the liquidation price differs with it.",
    "The LIQUIDATION PRICE assumes ISOLATED margin, maintenance margin charged on the notional at the MARK price, and no fees or funding accrued between entry and liquidation. Cross margin, fee-inclusive liquidation and the insurance-fund haircut are deliberately not modelled here; a cross-margin account liquidates later and this desk would understate the distance.",
    "The BREAK-EVEN FEE APR compounds: it is the annual rate at which fee income, compounded over the holding period, exactly cancels divergence loss. The convention matches layer 45's liquidity desk, which accrues fees as (1+APR)^(days/365)−1. A desk that accrued fees linearly would print a different break-even, and neither is wrong — the convention has to be stated, and this is the one stated.",
    "The NORMAL DISTRIBUTION behind Black-Scholes and parametric VaR is computed to about 1e-15 by Hart's rational approximation and inverted by Acklam's approximation with one Halley refinement. The independent second implementation prices the option by numerically integrating the risk-neutral payoff instead, which agrees to about 1e-13 here — so the pinned tolerance on those cases is 1e-9, not machine zero. The gate uses a THIRD and deliberately coarser approximation (Abramowitz & Stegun 26.2.17) and carries a correspondingly looser tolerance, which is stated per case.",
    "HISTORICAL VaR uses the linear-interpolation percentile convention — the same one a spreadsheet's PERCENTILE.INC uses — so the exported CSV can be checked in a spreadsheet without an argument about ranks. A venue quoting VaR on the nearest-rank convention will print a different number on the same returns, and neither is a bug.",
    "SHARPE here is (mean − risk-free) / sample standard deviation × √periods, with the (n−1) Bessel correction and a per-period risk-free rate. It is a sample statistic on whatever series you hand it: on twelve observations it is noise wearing a decimal point, and the desk prints the sample size beside it for that reason.",
    "COST BASIS is arithmetic, not tax advice. FIFO consumes lots in acquisition order; HIFO consumes the highest unit cost first. Neither models wash sales, fee capitalisation, transfers between wallets, lot-level holding periods or any jurisdiction's specific-identification record-keeping requirements. It exists here so the app's own cost-basis figure can be re-derived by hand, not so it can be filed."
  ];

  var METHOD = [
    ["What this desk is for", "Every other desk in this app produces numbers. This one takes a number apart. Pick a formula, see its inputs with their units and where each one came from, read the formula in plain notation, then read the recomputation as numbered lines with every intermediate value printed — so you can redo it on paper, or in a spreadsheet, and disagree with it."],
    ["Two implementations, always", "Every registered formula is computed twice by code that was written to be different. Implementation A reads the formula left to right, the way the notation does. Implementation B gets to the same number another way: the constant-product output comes from the invariant k/x' rather than the direct ratio; the liquidation price is found by bisecting on equity-minus-maintenance instead of solving the bracket algebra; the Black-Scholes price is a numerical integral of the discounted payoff instead of two normal CDFs; max drawdown is an all-pairs scan instead of a running peak. The delta between A and B is printed on every row. A shared bug has to survive two different derivations to hide, and it usually cannot."],
    ["Reference cases with citations", "Each formula ships pinned inputs and a pinned expected output, with a citation naming where the formula comes from. Some of those expected values are themselves published — the divergence-loss figures at 1.25x, 1.5x, 2x, 3x, 4x and 5x are the ones Uniswap's own documentation quotes; the maintenance amounts 50, 1,300 and 16,300 are Binance's published bracket table; the normal quantiles 1.6449 and 2.3263 are the standard table. The rest are derived from the cited formula and stated as derived."],
    ["The self-test", "Runs every registered formula against every one of its reference cases and prints pass or fail with the actual delta and the tolerance it was measured against. It runs here on demand, and the release gate runs the same reference cases out of the shipped payload with a THIRD implementation written inside the gate — so the gate is not merely agreeing with this layer."],
    ["Cross-checks", "Where two surfaces in this app compute the same thing by different routes, this tab asks both and prints the disagreement: the order-book walk against the pool quote for the same size, the routing desk's all-in against the ticket's preview, the tax ledger's cost basis against this layer's. It reports the gap. It does not pick a winner, because a desk that silently reconciles two disagreeing numbers is how the disagreement stops being visible."],
    ["Export, so you can leave", "Everything — inputs, expected outputs, the formula text, the spreadsheet form of it and the citations — exports as CSV and JSON. Open it in a spreadsheet, type the formula yourself, and check this app's arithmetic with no trust in this app at all. That is the intended use."],
    ["What it does not do", "It never trades, never places an order and never writes a balance. It holds no keys, sends nothing anywhere and has no network path of its own. Feed health and storage health are Health's job (layer 50); the model card and the laws are Trust's (layer 41). This desk only checks arithmetic."]
  ];

  /* ==========================================================================
     THE INDEPENDENT KERNEL
     Implementation B for every formula, plus the shared numerics. Nothing in
     here calls the engine or another layer: if it did, it would not be an
     independent check.
     ========================================================================== */

  /* Hart's rational approximation to the standard normal CDF (~1e-15).
     Used by implementation A for Black-Scholes and parametric VaR. */
  function ncdf(x) {
    var z = Math.abs(x), c, e, b, d, f;
    if (z > 37) c = 0;
    else {
      e = Math.exp(-z * z / 2);
      if (z < 7.07106781186547) {
        b = 3.52624965998911e-2 * z + 0.700383064443688;
        b = b * z + 6.37396220353165; b = b * z + 33.912866078383;
        b = b * z + 112.079291497871; b = b * z + 221.213596169931;
        b = b * z + 220.206867912376;
        d = 8.83883476483184e-2 * z + 1.75566716318264;
        d = d * z + 16.064177579207; d = d * z + 86.7807322029461;
        d = d * z + 296.564248779674; d = d * z + 637.333633378831;
        d = d * z + 793.826512519948; d = d * z + 440.413735824752;
        c = e * b / d;
      } else {
        f = z + 1 / (z + 2 / (z + 3 / (z + 4 / (z + 0.65))));
        c = e / (f * 2.506628274631);
      }
    }
    return x > 0 ? 1 - c : c;
  }

  /* Acklam's inverse normal CDF, refined once by Halley against ncdf above. */
  function ninv(p) {
    if (!(p > 0 && p < 1)) return null;
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    var pl = 0.02425, q, r, x, e, u;
    if (p < pl) {
      q = Math.sqrt(-2 * Math.log(p));
      x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p <= 1 - pl) {
      q = p - 0.5; r = q * q;
      x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    e = ncdf(x) - p;
    u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
    return x - u / (1 + x * u / 2);
  }

  /* composite Simpson, fixed panels — deterministic, no adaptive recursion */
  function simpson(f, lo, hi, n) {
    if (n % 2) n += 1;
    var h = (hi - lo) / n, s = f(lo) + f(hi), i;
    for (i = 1; i < n; i++) s += f(lo + i * h) * (i % 2 ? 4 : 2);
    return s * h / 3;
  }

  function num(v, dflt) { v = parseFloat(v); return isFinite(v) ? v : dflt; }
  function arr(v) {
    if (Object.prototype.toString.call(v) === "[object Array]") return v;
    if (typeof v !== "string") return [];
    var parts = v.split(/[,;\s]+/), out = [], i, n;
    for (i = 0; i < parts.length; i++) { if (!parts[i]) continue; n = parseFloat(parts[i]); if (isFinite(n)) out.push(n); }
    return out;
  }
  /* pairs: "0.5@42000; 0.25@61000" or the already-parsed [[qty, cost]] form */
  function pairs(v) {
    if (Object.prototype.toString.call(v) === "[object Array]") return v;
    if (typeof v !== "string") return [];
    var rows = v.split(/[;\n]+/), out = [], i, bits, a, b;
    for (i = 0; i < rows.length; i++) {
      if (!/\S/.test(rows[i])) continue;
      bits = rows[i].split(/[@,x]/i);
      a = parseFloat(bits[0]); b = parseFloat(bits[1]);
      if (isFinite(a) && isFinite(b)) out.push([a, b]);
    }
    return out;
  }

  /* The published Binance USD-margined BTCUSDT bracket table. Columns are
     [upper notional bound, maintenance margin rate, maintenance amount]. The
     third column is not free: cum(k+1) = cum(k) + cap(k)·(rate(k+1) − rate(k)),
     which is exactly what makes the closed form and the marginal sum agree —
     and the self-test checks that identity as a case of its own. */
  var MM_LADDER = [[50000, 0.004, 0], [250000, 0.005, 50], [1000000, 0.01, 1300], [10000000, 0.025, 16300]];

  function mmBracket(n) {
    var i;
    for (i = 0; i < MM_LADDER.length; i++) if (n <= MM_LADDER[i][0]) return i;
    return MM_LADDER.length - 1;
  }
  /* B: maintenance margin as the SUM OF MARGINAL SLICES through the ladder */
  function mmMarginal(n) {
    var lo = 0, s = 0, i, hi, w;
    for (i = 0; i < MM_LADDER.length; i++) {
      hi = MM_LADDER[i][0];
      w = Math.min(Math.max(n - lo, 0), hi - lo);
      s += w * MM_LADDER[i][1];
      lo = hi;
    }
    if (n > lo) s += (n - lo) * MM_LADDER[MM_LADDER.length - 1][1];
    return s;
  }
  /* A: the venue's published closed form, notional × rate − maintenance amount */
  function mmClosed(n) { var k = mmBracket(n); return n * MM_LADDER[k][1] - MM_LADDER[k][2]; }

  function equityLessMM(side, entry, qty, margin, px) {
    var pnl = side === "short" ? qty * (entry - px) : qty * (px - entry);
    return (margin + pnl) - mmMarginal(qty * px);
  }

  /* ==========================================================================
     THE REGISTRY
     ========================================================================== */

  var REG = {}, ORDER = [];

  function register(def) {
    if (!def || !def.id) return null;
    if (REG[def.id]) return REG[def.id];
    var e = {
      id: String(def.id),
      label: String(def.label || def.id),
      group: String(def.group || "other"),
      inputs: def.inputs || [],
      formula: String(def.formula || ""),
      sheet: def.sheet == null ? null : String(def.sheet),
      compute: typeof def.compute === "function" ? def.compute : null,
      alt: typeof def.alt === "function" ? def.alt : null,
      engine: typeof def.engine === "function" ? def.engine : null,
      reference: def.reference || [],
      source: String(def.source || ""),
      unit: def.unit == null ? "" : String(def.unit),
      owner: String(def.owner || "DLVERIFY")
    };
    REG[e.id] = e;
    ORDER.push(e.id);
    return e;
  }
  function get(id) { return REG[id] || null; }
  function ids() { return ORDER.slice(); }
  function list() { var i, out = []; for (i = 0; i < ORDER.length; i++) out.push(REG[ORDER[i]]); return out; }

  /* step helper: every implementation A builds its working as it goes */
  function W() {
    var steps = [];
    return {
      s: function (text, value, unit) { steps.push({ n: steps.length + 1, t: text, v: value, u: unit || "" }); return value; },
      out: function (v, note) { return { v: v, steps: steps, note: note || null }; }
    };
  }

  /* ==========================================================================
     SEEDS — the app's load-bearing numbers
     ========================================================================== */

  function seed() {

    /* ---------------------------------------------------- 1 · constant product */
    register({
      id: "amm.cp.out",
      label: "Constant-product swap output",
      group: "AMM",
      unit: "token out",
      formula: "out = (dx·(1−f))·ry / (rx + dx·(1−f)),  f = feeBps/10000",
      sheet: "=(dx*(1-f))*ry/(rx+dx*(1-f))",
      source: "Adams, Zinsmeister, Salem, Robinson, Uniswap v2 Core (March 2020), §3.1 — the pair enforces x·y ≥ k with the fee taken on the input amount; the same expression is UniswapV2Library.getAmountOut.",
      inputs: [
        { name: "dx", unit: "token in", source: "your trade size" },
        { name: "rx", unit: "token in", source: "pool reserve of the input token" },
        { name: "ry", unit: "token out", source: "pool reserve of the output token" },
        { name: "feeBps", unit: "bp", source: "the pair's fee — 30 bp on a Uniswap v2 pair" }
      ],
      compute: function (i) {
        var w = W(), dx = num(i.dx, 0), rx = num(i.rx, 0), ry = num(i.ry, 0), f = num(i.feeBps, 30);
        if (!(dx > 0 && rx > 0 && ry > 0)) return w.out(null, "a reserve or a size of zero is not a trade");
        var fr = w.s("fee fraction f = feeBps ÷ 10000", f / 1e4);
        var ax = w.s("amount in after fee  ax = dx·(1−f)", dx * (1 - fr));
        var den = w.s("denominator  rx + ax", rx + ax);
        var out = w.s("out = ax·ry ÷ (rx + ax)", ax * ry / den);
        w.s("execution price  out ÷ dx", out / dx);
        return w.out(out);
      },
      /* B: never forms ax·ry/(rx+ax). It holds the invariant and subtracts. */
      alt: function (i) {
        var dx = num(i.dx, 0), rx = num(i.rx, 0), ry = num(i.ry, 0), f = num(i.feeBps, 30);
        if (!(dx > 0 && rx > 0 && ry > 0)) return null;
        var k = rx * ry, ax = dx * (1 - f / 1e4), rx2 = rx + ax;
        return ry - k / rx2;
      },
      engine: function (i) {
        var d = layer("DLDEFI");
        if (!d || !d.V2 || typeof d.V2.out !== "function") return null;
        try { return d.V2.out(num(i.dx, 0), num(i.rx, 0), num(i.ry, 0), num(i.feeBps, 30)); } catch (e) { return null; }
      },
      reference: refsFor("amm.cp.out")
    });

    register({
      id: "amm.cp.impact",
      label: "Constant-product price impact",
      group: "AMM",
      unit: "bp",
      formula: "impact = (mid − out/dx) / mid × 10000,  mid = ry/rx",
      sheet: "=((ry/rx)-(out/dx))/(ry/rx)*10000",
      source: "Definition used across this app's execution surfaces: average execution against the PRE-TRADE mid. Derived from Uniswap v2 Core §3.1; layer 45's V2.impact is the same definition, and layer 53's slippageBps is its book-side twin.",
      inputs: [
        { name: "dx", unit: "token in", source: "your trade size" },
        { name: "rx", unit: "token in", source: "pool reserve of the input token" },
        { name: "ry", unit: "token out", source: "pool reserve of the output token" },
        { name: "feeBps", unit: "bp", source: "the pair's fee" }
      ],
      compute: function (i) {
        var w = W(), dx = num(i.dx, 0), rx = num(i.rx, 0), ry = num(i.ry, 0), f = num(i.feeBps, 30);
        if (!(dx > 0 && rx > 0 && ry > 0)) return w.out(null, "no pool, no impact");
        var mid = w.s("pre-trade mid  ry ÷ rx", ry / rx);
        var ax = w.s("amount in after fee  dx·(1−feeBps/10000)", dx * (1 - f / 1e4));
        var out = w.s("out = ax·ry ÷ (rx+ax)", ax * ry / (rx + ax));
        var exec = w.s("execution price  out ÷ dx", out / dx);
        var bps = w.s("impact = (mid − exec) ÷ mid × 10000", (mid - exec) / mid * 1e4, "bp");
        return w.out(bps);
      },
      /* B: the closed form. exec/mid collapses to (rx/(rx+ax))·(ax/dx), so the
         reserves cancel out of the ratio entirely — a completely different
         expression that never divides an output by a size. */
      alt: function (i) {
        var dx = num(i.dx, 0), rx = num(i.rx, 0), f = num(i.feeBps, 30);
        if (!(dx > 0 && rx > 0)) return null;
        var ax = dx * (1 - f / 1e4);
        return (1 - (rx / (rx + ax)) * (ax / dx)) * 1e4;
      },
      engine: function (i) {
        var d = layer("DLDEFI");
        if (!d || !d.V2 || typeof d.V2.impact !== "function") return null;
        try { return d.V2.impact(num(i.dx, 0), num(i.rx, 0), num(i.ry, 0), num(i.feeBps, 30)) * 1e4; } catch (e) { return null; }
      },
      reference: refsFor("amm.cp.impact")
    });

    /* ------------------------------------------------- 2 · Uniswap v3 amounts */
    register({
      id: "v3.amount0",
      label: "Uniswap v3 in-range amount of token0",
      group: "AMM",
      unit: "token0",
      formula: "x = L·(√Pb − √P) / (√P·√Pb),  for Pa ≤ P ≤ Pb",
      sheet: "=L*(SQRT(Pb)-SQRT(P))/(SQRT(P)*SQRT(Pb))",
      source: "Adams, Zinsmeister, Salem, Robinson, Keefer, Uniswap v3 Core whitepaper (March 2021), equation 6.29 — x = L·(1/√P − 1/√pb) inside the range.",
      inputs: [
        { name: "L", unit: "liquidity", source: "your position's liquidity" },
        { name: "P", unit: "token1 per token0", source: "the pool's current price" },
        { name: "Pa", unit: "token1 per token0", source: "the lower bound of your range" },
        { name: "Pb", unit: "token1 per token0", source: "the upper bound of your range" }
      ],
      compute: function (i) {
        var w = W(), L = num(i.L, 0), P = num(i.P, 0), Pa = num(i.Pa, 0), Pb = num(i.Pb, 0);
        if (!(L > 0 && P > 0 && Pa > 0 && Pb > Pa)) return w.out(null, "a range needs Pb above Pa and a price above zero");
        if (P < Pa || P > Pb) return w.out(null, "price is outside the range — this formula is the in-range case only");
        var sp = w.s("√P", Math.sqrt(P));
        var sb = w.s("√Pb", Math.sqrt(Pb));
        var x = w.s("x = L·(√Pb − √P) ÷ (√P·√Pb)", L * (sb - sp) / (sp * sb));
        return w.out(x);
      },
      /* B: through the virtual-reserve invariant of whitepaper eq. 2.2,
         (x + L/√pb)·(y + L·√pa) = L². Solve it for x given y. */
      alt: function (i) {
        var L = num(i.L, 0), P = num(i.P, 0), Pa = num(i.Pa, 0), Pb = num(i.Pb, 0);
        if (!(L > 0 && P > 0 && Pa > 0 && Pb > Pa) || P < Pa || P > Pb) return null;
        var y = L * (Math.sqrt(P) - Math.sqrt(Pa));
        return (L * L) / (y + L * Math.sqrt(Pa)) - L / Math.sqrt(Pb);
      },
      engine: function (i) {
        var d = layer("DLDEFI");
        if (!d || !d.V3 || typeof d.V3.amountsFor !== "function") return null;
        try { var a = d.V3.amountsFor(num(i.L, 0), num(i.P, 0), num(i.Pa, 0), num(i.Pb, 0)); return a ? a.x : null; } catch (e) { return null; }
      },
      reference: refsFor("v3.amount0")
    });

    register({
      id: "v3.amount1",
      label: "Uniswap v3 in-range amount of token1",
      group: "AMM",
      unit: "token1",
      formula: "y = L·(√P − √Pa),  for Pa ≤ P ≤ Pb",
      sheet: "=L*(SQRT(P)-SQRT(Pa))",
      source: "Uniswap v3 Core whitepaper (March 2021), equation 6.30 — y = L·(√P − √pa) inside the range.",
      inputs: [
        { name: "L", unit: "liquidity", source: "your position's liquidity" },
        { name: "P", unit: "token1 per token0", source: "the pool's current price" },
        { name: "Pa", unit: "token1 per token0", source: "the lower bound of your range" },
        { name: "Pb", unit: "token1 per token0", source: "the upper bound of your range" }
      ],
      compute: function (i) {
        var w = W(), L = num(i.L, 0), P = num(i.P, 0), Pa = num(i.Pa, 0), Pb = num(i.Pb, 0);
        if (!(L > 0 && P > 0 && Pa > 0 && Pb > Pa)) return w.out(null, "a range needs Pb above Pa");
        if (P < Pa || P > Pb) return w.out(null, "price is outside the range — this formula is the in-range case only");
        var sp = w.s("√P", Math.sqrt(P));
        var sa = w.s("√Pa", Math.sqrt(Pa));
        var y = w.s("y = L·(√P − √Pa)", L * (sp - sa));
        return w.out(y);
      },
      /* B: from x through the same invariant, in the other direction */
      alt: function (i) {
        var L = num(i.L, 0), P = num(i.P, 0), Pa = num(i.Pa, 0), Pb = num(i.Pb, 0);
        if (!(L > 0 && P > 0 && Pa > 0 && Pb > Pa) || P < Pa || P > Pb) return null;
        var x = L * (1 / Math.sqrt(P) - 1 / Math.sqrt(Pb));
        return (L * L) / (x + L / Math.sqrt(Pb)) - L * Math.sqrt(Pa);
      },
      engine: function (i) {
        var d = layer("DLDEFI");
        if (!d || !d.V3 || typeof d.V3.amountsFor !== "function") return null;
        try { var a = d.V3.amountsFor(num(i.L, 0), num(i.P, 0), num(i.Pa, 0), num(i.Pb, 0)); return a ? a.y : null; } catch (e) { return null; }
      },
      reference: refsFor("v3.amount1")
    });

    /* ------------------------------------------- 3 · divergence (impermanent) loss */
    register({
      id: "il.divergence",
      label: "Divergence loss (50/50 pool)",
      group: "AMM",
      unit: "fraction of the hold value",
      formula: "IL(r) = 2·√r / (1 + r) − 1,  r = P1/P0",
      sheet: "=2*SQRT(r)/(1+r)-1",
      source: "The closed form for a 50/50 constant-product pool, derived in Pintail, \"Uniswap: A Good Deal for Liquidity Providers?\" (2019) and quoted in Uniswap's own docs; the reference values at 1.25x, 1.5x, 2x, 3x, 4x and 5x below are the published ones.",
      inputs: [{ name: "r", unit: "price ratio", source: "the price now divided by the price when you deposited" }],
      compute: function (i) {
        var w = W(), r = num(i.r, 0);
        if (!(r > 0)) return w.out(null, "a price ratio of zero is not a price ratio");
        var sr = w.s("√r", Math.sqrt(r));
        var top = w.s("2·√r", 2 * sr);
        var bot = w.s("1 + r", 1 + r);
        var il = w.s("IL = 2√r ÷ (1+r) − 1", top / bot - 1);
        w.s("as a percentage", il * 100, "%");
        return w.out(il);
      },
      /* B: no closed form at all. Build the position, move the price, value
         both sides. Deposit x0=1 at P0=1 so y0=1; k is conserved. */
      alt: function (i) {
        var r = num(i.r, 0);
        if (!(r > 0)) return null;
        var x0 = 1, y0 = 1, k = x0 * y0, P1 = r;
        var x1 = Math.sqrt(k / P1), y1 = Math.sqrt(k * P1);
        var pool = x1 * P1 + y1, hold = x0 * P1 + y0;
        return pool / hold - 1;
      },
      engine: function (i) {
        var d = layer("DLDEFI");
        if (!d || !d.IL || typeof d.IL.v2 !== "function") return null;
        try { return d.IL.v2(num(i.r, 0)); } catch (e) { return null; }
      },
      reference: refsFor("il.divergence")
    });

    register({
      id: "il.breakeven",
      label: "Break-even fee APR against divergence loss",
      group: "AMM",
      unit: "fraction per year",
      formula: "APR = (1 / (1 + IL(r)))^(365/days) − 1",
      sheet: "=(1/(1+(2*SQRT(r)/(1+r)-1)))^(365/days)-1",
      source: "This desk's own definition, stated so it can be argued with: the annual rate at which compounded fee income exactly cancels divergence loss over the holding period. The compounding convention matches layer 45's liquidity desk, which accrues fees as (1+APR)^(days/365)−1.",
      inputs: [
        { name: "r", unit: "price ratio", source: "the price now divided by the price when you deposited" },
        { name: "days", unit: "days", source: "how long the position was open" }
      ],
      compute: function (i) {
        var w = W(), r = num(i.r, 0), days = num(i.days, 0);
        if (!(r > 0 && days > 0)) return w.out(null, "needs a price ratio and a holding period");
        var il = w.s("IL = 2√r ÷ (1+r) − 1", 2 * Math.sqrt(r) / (1 + r) - 1);
        var need = w.s("period fee needed  1 ÷ (1+IL) − 1", 1 / (1 + il) - 1);
        var apr = w.s("APR = (1 + period fee)^(365/days) − 1", Math.pow(1 + need, 365 / days) - 1);
        w.s("as a percentage", apr * 100, "%");
        return w.out(apr);
      },
      /* B: express the required period return as the loss over the REMAINING
         value, −IL/(1+IL), then annualise through logs rather than Math.pow. */
      alt: function (i) {
        var r = num(i.r, 0), days = num(i.days, 0);
        if (!(r > 0 && days > 0)) return null;
        var x0 = 1, y0 = 1, k = 1, P1 = r;
        var pool = Math.sqrt(k / P1) * P1 + Math.sqrt(k * P1), hold = x0 * P1 + y0;
        var il = pool / hold - 1;
        var need = -il / (1 + il);
        return Math.exp((365 / days) * Math.log(1 + need)) - 1;
      },
      reference: refsFor("il.breakeven")
    });

    /* --------------------------------------------------------------- 4 · perps */
    register({
      id: "perp.mm",
      label: "Perp maintenance margin (tiered ladder)",
      group: "Perps",
      unit: "quote",
      formula: "MM(N) = N·rate(k) − cum(k),  k the bracket holding N",
      sheet: "=N*rate-cum",
      source: "Binance USD-margined futures leverage & margin brackets for BTCUSDT: the published \"maintenance amount\" column (0, 50, 1300, 16300) against the rate column (0.40%, 0.50%, 1.00%, 2.50%). The maintenance amount is what makes the piecewise function continuous.",
      inputs: [{ name: "notional", unit: "quote", source: "position size × mark price" }],
      compute: function (i) {
        var w = W(), n = num(i.notional, 0);
        if (!(n > 0)) return w.out(null, "no position, no maintenance margin");
        var k = mmBracket(n);
        w.s("bracket holding this notional (1-indexed)", k + 1);
        var rate = w.s("maintenance margin rate for that bracket", MM_LADDER[k][1]);
        var cum = w.s("published maintenance amount for that bracket", MM_LADDER[k][2]);
        var mm = w.s("MM = notional × rate − maintenance amount", n * rate - cum);
        return w.out(mm);
      },
      /* B: the ladder as what it actually is — a piecewise-linear function.
         Sum rate_j over the width of each bracket the notional passes through.
         Never touches the maintenance-amount column at all. */
      alt: function (i) {
        var n = num(i.notional, 0);
        if (!(n > 0)) return null;
        return mmMarginal(n);
      },
      reference: refsFor("perp.mm")
    });

    register({
      id: "perp.liq",
      label: "Perp liquidation price (isolated margin)",
      group: "Perps",
      unit: "quote per base",
      formula: "long:  P = (qty·E − M − cum) / (qty·(1 − rate))\nshort: P = (qty·E + M + cum) / (qty·(1 + rate))",
      sheet: "=(qty*E-M-cum)/(qty*(1-rate))",
      source: "Rearranged from the isolated-margin liquidation condition margin + PnL = MM(notional at mark), with MM from Binance's published bracket table. It is the standard USD-margined isolated liquidation price with the maintenance-amount term carried through.",
      inputs: [
        { name: "side", unit: "long or short", source: "your position" },
        { name: "entry", unit: "quote per base", source: "your average entry price" },
        { name: "qty", unit: "base", source: "position size" },
        { name: "margin", unit: "quote", source: "isolated margin posted" }
      ],
      compute: function (i) {
        var w = W(), side = String(i.side || "long") === "short" ? "short" : "long";
        var E = num(i.entry, 0), qty = num(i.qty, 0), M = num(i.margin, 0);
        if (!(E > 0 && qty > 0 && M > 0)) return w.out(null, "needs an entry, a size and some margin");
        var k = mmBracket(qty * E), P = E, j, rate, cum, k2;
        for (j = 0; j < 40; j++) {
          rate = MM_LADDER[k][1]; cum = MM_LADDER[k][2];
          P = side === "long" ? (qty * E - M - cum) / (qty * (1 - rate)) : (qty * E + M + cum) / (qty * (1 + rate));
          k2 = mmBracket(qty * P);
          if (k2 === k) break;
          k = k2;
        }
        w.s("entry notional  qty × entry", qty * E);
        w.s("bracket at the liquidation notional (1-indexed)", k + 1);
        w.s("maintenance margin rate", MM_LADDER[k][1]);
        w.s("maintenance amount", MM_LADDER[k][2]);
        w.s(side === "long" ? "numerator  qty·E − margin − cum" : "numerator  qty·E + margin + cum",
          side === "long" ? qty * E - M - MM_LADDER[k][2] : qty * E + M + MM_LADDER[k][2]);
        w.s(side === "long" ? "denominator  qty·(1 − rate)" : "denominator  qty·(1 + rate)",
          side === "long" ? qty * (1 - MM_LADDER[k][1]) : qty * (1 + MM_LADDER[k][1]));
        var out = w.s("liquidation price", P);
        w.s("distance from entry", (side === "long" ? (E - P) / E : (P - E) / E) * 100, "%");
        return w.out(out);
      },
      /* B: no algebra at all. Bisect on equity − maintenance margin, using the
         MARGINAL ladder sum rather than the closed form, so neither the bracket
         algebra nor the maintenance-amount column is on this path. */
      alt: function (i) {
        var side = String(i.side || "long") === "short" ? "short" : "long";
        var E = num(i.entry, 0), qty = num(i.qty, 0), M = num(i.margin, 0);
        if (!(E > 0 && qty > 0 && M > 0)) return null;
        var lo = side === "long" ? 1e-12 : E, hi = side === "long" ? E : E * 1000, j, mid, f;
        for (j = 0; j < 300; j++) {
          mid = (lo + hi) / 2;
          f = equityLessMM(side, E, qty, M, mid);
          if (side === "long") { if (f > 0) hi = mid; else lo = mid; }
          else { if (f > 0) lo = mid; else hi = mid; }
        }
        return (lo + hi) / 2;
      },
      reference: refsFor("perp.liq")
    });

    register({
      id: "perp.funding",
      label: "Perp funding payment",
      group: "Perps",
      unit: "quote",
      formula: "payment = notional × rate8h × hours / 8",
      sheet: "=notional*rate8h*hours/8",
      source: "The mechanism every major perpetual venue uses: the funding rate is quoted per settlement interval (8 hours on Binance, Bybit, OKX and Hyperliquid's 8h-equivalent) and is charged on position notional at each settlement. Positive means longs pay shorts.",
      inputs: [
        { name: "notional", unit: "quote", source: "position size × mark price" },
        { name: "rate8h", unit: "fraction per 8h", source: "the venue's funding rate for the interval" },
        { name: "hours", unit: "hours", source: "how long the position was open" }
      ],
      compute: function (i) {
        var w = W(), n = num(i.notional, 0), r = num(i.rate8h, 0), h = num(i.hours, 0);
        if (!(n > 0) || !isFinite(r) || !(h >= 0)) return w.out(null, "needs a notional, a rate and a duration");
        var iv = w.s("settlement intervals elapsed  hours ÷ 8", h / 8);
        var per = w.s("payment per interval  notional × rate", n * r);
        var tot = w.s("total payment  per interval × intervals", per * iv);
        return w.out(tot);
      },
      /* B: goes the whole way round through the annualised rate. Three
         settlements a day, 365 days, then back down to hours. A units bug in
         either direction shows up here and nowhere else. */
      alt: function (i) {
        var n = num(i.notional, 0), r = num(i.rate8h, 0), h = num(i.hours, 0);
        if (!(n > 0) || !isFinite(r) || !(h >= 0)) return null;
        var apr = r * 3 * 365;
        return n * apr * (h / 8760);
      },
      reference: refsFor("perp.funding")
    });

    /* ----------------------------------------------------------- 5 · risk stats */
    register({
      id: "risk.sharpe",
      label: "Sharpe ratio",
      group: "Risk",
      unit: "ratio",
      formula: "S = (mean(r) − rf) / sd(r) × √periods,  sd with the (n−1) correction",
      sheet: "=(AVERAGE(range)-rf)/STDEV.S(range)*SQRT(periods)",
      source: "Sharpe, \"The Sharpe Ratio\", Journal of Portfolio Management 21(1), 1994 — the ex-post ratio of mean excess return to its standard deviation, scaled by the square root of the number of periods in a year.",
      inputs: [
        { name: "returns", unit: "fraction per period", source: "your per-period returns — paste or edit the series" },
        { name: "rf", unit: "fraction per period", source: "risk-free rate for the SAME period length" },
        { name: "periods", unit: "periods per year", source: "252 for trading days, 365 for calendar days, 8760 for hours" }
      ],
      compute: function (i) {
        var w = W(), R = arr(i.returns), rf = num(i.rf, 0), per = num(i.periods, 252), n = R.length, s = 0, j;
        if (n < 2) return w.out(null, "two observations are not a sample");
        w.s("sample size n", n);
        for (j = 0; j < n; j++) s += R[j];
        var m = w.s("mean of the returns", s / n);
        var ss = 0;
        for (j = 0; j < n; j++) ss += (R[j] - m) * (R[j] - m);
        w.s("sum of squared deviations", ss);
        var sd = w.s("sample standard deviation  √(ss ÷ (n−1))", Math.sqrt(ss / (n - 1)));
        if (!(sd > 0)) return w.out(null, "a series with no dispersion has no Sharpe ratio");
        var ex = w.s("excess mean  mean − rf", m - rf);
        var sc = w.s("annualising factor  √periods", Math.sqrt(per));
        var out = w.s("Sharpe = excess ÷ sd × √periods", ex / sd * sc);
        return w.out(out);
      },
      /* B: one-pass variance from Σx and Σx². Numerically the WORSE way to do
         it, which is exactly why it is the check: if the two disagree on a
         real series, the series has a conditioning problem worth knowing about. */
      alt: function (i) {
        var R = arr(i.returns), rf = num(i.rf, 0), per = num(i.periods, 252), n = R.length, s1 = 0, s2 = 0, j;
        if (n < 2) return null;
        for (j = 0; j < n; j++) { s1 += R[j]; s2 += R[j] * R[j]; }
        var m = s1 / n, v = (s2 - n * m * m) / (n - 1), sd = Math.sqrt(v);
        return sd > 0 ? ((m - rf) * Math.sqrt(per)) / sd : null;
      },
      engine: function (i) {
        var p = engine();
        if (!p || typeof p.sharpe !== "function") return null;
        try { var v = p.sharpe(arr(i.returns)); return typeof v === "number" && isFinite(v) ? v : null; } catch (e) { return null; }
      },
      reference: refsFor("risk.sharpe")
    });

    register({
      id: "risk.maxdd",
      label: "Maximum drawdown",
      group: "Risk",
      unit: "fraction",
      formula: "MDD = max over t of (peak(≤t) − equity(t)) / peak(≤t)",
      sheet: "=MAX((MAX($A$1:A1)-A1)/MAX($A$1:A1))  filled down",
      source: "Standard definition: the largest peak-to-trough fall in the equity curve, measured as a fraction of the peak. Same definition as the engine's maxDrawdown and the Quant desk's max-DD column.",
      inputs: [{ name: "equity", unit: "quote", source: "your equity curve, one value per period" }],
      compute: function (i) {
        var w = W(), E = arr(i.equity), n = E.length, pk = -Infinity, mx = 0, at = -1, j, dd;
        if (n < 2) return w.out(null, "a curve of one point has no drawdown");
        w.s("points in the curve", n);
        for (j = 0; j < n; j++) {
          if (E[j] > pk) pk = E[j];
          if (pk > 0) { dd = (pk - E[j]) / pk; if (dd > mx) { mx = dd; at = j; } }
        }
        w.s("running peak before the worst point", pk);
        w.s("index of the worst point (0-based)", at);
        w.s("equity at that point", at >= 0 ? E[at] : null);
        var out = w.s("max drawdown", mx);
        w.s("as a percentage", mx * 100, "%");
        w.s("gain needed to climb back out", mx < 1 ? mx / (1 - mx) * 100 : null, "%");
        return w.out(out);
      },
      /* B: no running peak. Every ordered pair i<j, the worst fall between
         them. O(n²) and deliberately naive — it cannot inherit a bug in the
         peak bookkeeping because it keeps no peak. */
      alt: function (i) {
        var E = arr(i.equity), n = E.length, mx = 0, a, b, d;
        if (n < 2) return null;
        for (a = 0; a < n; a++) for (b = a + 1; b < n; b++) {
          if (E[a] > 0) { d = (E[a] - E[b]) / E[a]; if (d > mx) mx = d; }
        }
        return mx;
      },
      engine: function (i) {
        var p = engine();
        if (!p || typeof p.maxDrawdown !== "function") return null;
        try { var v = p.maxDrawdown(arr(i.equity)); return typeof v === "number" && isFinite(v) ? v : null; } catch (e) { return null; }
      },
      reference: refsFor("risk.maxdd")
    });

    register({
      id: "risk.var.hist",
      label: "Historical VaR",
      group: "Risk",
      unit: "quote",
      formula: "VaR = −quantile(returns, 1−confidence) × notional,  linear interpolation",
      sheet: "=-PERCENTILE.INC(range,1-confidence)*notional",
      source: "Historical simulation VaR as described in Jorion, Value at Risk (3rd ed., 2006), ch. 10 — the empirical quantile of the realised return distribution, with no distributional assumption. The interpolation convention is spelled out so a spreadsheet gives the same answer.",
      inputs: [
        { name: "returns", unit: "fraction per period", source: "the realised return series" },
        { name: "confidence", unit: "fraction", source: "0.95 or 0.99" },
        { name: "notional", unit: "quote", source: "the position this is measured on" }
      ],
      compute: function (i) {
        var w = W(), R = arr(i.returns).slice(), conf = num(i.confidence, 0.95), N = num(i.notional, 0);
        if (R.length < 2 || !(conf > 0 && conf < 1)) return w.out(null, "needs a series and a confidence between 0 and 1");
        R.sort(function (a, b) { return a - b; });
        w.s("observations", R.length);
        var p = w.s("tail probability  1 − confidence", 1 - conf);
        var h = w.s("interpolated rank  (n−1)·p", (R.length - 1) * p);
        var lo = Math.floor(h), hi = Math.ceil(h);
        w.s("lower neighbour", R[lo]);
        w.s("upper neighbour", R[hi]);
        var q = w.s("quantile (linear interpolation)", lo === hi ? R[lo] : R[lo] + (h - lo) * (R[hi] - R[lo]));
        var out = w.s("VaR = −quantile × notional", -q * N);
        return w.out(out);
      },
      /* B: sorts the OTHER WAY and counts in from the top, so the rank
         arithmetic is the mirror image. A fencepost error in one does not
         reproduce in the other. */
      alt: function (i) {
        var R = arr(i.returns).slice(), conf = num(i.confidence, 0.95), N = num(i.notional, 0);
        if (R.length < 2 || !(conf > 0 && conf < 1)) return null;
        R.sort(function (a, b) { return b - a; });
        var n = R.length, h = (n - 1) * conf, lo = Math.floor(h), hi = Math.ceil(h);
        var q = lo === hi ? R[lo] : R[lo] + (h - lo) * (R[hi] - R[lo]);
        return -q * N;
      },
      reference: refsFor("risk.var.hist")
    });

    register({
      id: "risk.var.param",
      label: "Parametric (normal) VaR",
      group: "Risk",
      unit: "quote",
      formula: "VaR = −(μ − z·σ) × notional,  z = Φ⁻¹(confidence)",
      sheet: "=-(mu-NORM.S.INV(confidence)*sigma)*notional",
      source: "The delta-normal VaR of Jorion, Value at Risk (3rd ed., 2006), ch. 7. The quantile z is the standard normal inverse: 1.6448536270 at 95% and 2.3263478740 at 99% — the published table values, which the reference cases below pin directly.",
      inputs: [
        { name: "mu", unit: "fraction per period", source: "mean return over the horizon" },
        { name: "sigma", unit: "fraction per period", source: "standard deviation over the same horizon" },
        { name: "confidence", unit: "fraction", source: "0.95 or 0.99" },
        { name: "notional", unit: "quote", source: "the position this is measured on" }
      ],
      compute: function (i) {
        var w = W(), mu = num(i.mu, 0), sg = num(i.sigma, 0), conf = num(i.confidence, 0.95), N = num(i.notional, 0);
        if (!(sg > 0) || !(conf > 0 && conf < 1)) return w.out(null, "needs a positive sigma and a confidence between 0 and 1");
        var z = w.s("z = Φ⁻¹(confidence)", ninv(conf));
        var q = w.s("quantile return  μ − z·σ", mu - z * sg);
        var out = w.s("VaR = −quantile × notional", -q * N);
        return w.out(out);
      },
      /* B: never calls the inverse normal. Finds z by bisecting the CDF, then
         rebuilds the same number — a root-find where A used a rational
         approximation. */
      alt: function (i) {
        var mu = num(i.mu, 0), sg = num(i.sigma, 0), conf = num(i.confidence, 0.95), N = num(i.notional, 0);
        if (!(sg > 0) || !(conf > 0 && conf < 1)) return null;
        var lo = -40, hi = 40, j, mid;
        for (j = 0; j < 200; j++) { mid = (lo + hi) / 2; if (ncdf(mid) < conf) lo = mid; else hi = mid; }
        var z = (lo + hi) / 2;
        return -(mu - z * sg) * N;
      },
      reference: refsFor("risk.var.param")
    });

    /* ------------------------------------------------------- 6 · Black-Scholes */
    register({
      id: "opt.bs.call",
      label: "Black-Scholes call price",
      group: "Options",
      unit: "quote",
      formula: "C = S·e^(−qT)·Φ(d1) − K·e^(−rT)·Φ(d2)\nd1 = (ln(S/K) + (r − q + σ²/2)·T) / (σ√T),  d2 = d1 − σ√T",
      sheet: "=S*EXP(-q*T)*NORM.S.DIST(d1,TRUE)-K*EXP(-r*T)*NORM.S.DIST(d2,TRUE)",
      source: "Black & Scholes, \"The Pricing of Options and Corporate Liabilities\", Journal of Political Economy 81(3), 1973, with Merton's continuous dividend yield q. The pinned case S=K=100, r=5%, σ=20%, T=1 is the standard textbook example (Hull, Options, Futures and Other Derivatives) whose call price is 10.4506.",
      inputs: [
        { name: "S", unit: "quote", source: "spot price of the underlying" },
        { name: "K", unit: "quote", source: "strike" },
        { name: "r", unit: "fraction per year", source: "continuously compounded risk-free rate" },
        { name: "q", unit: "fraction per year", source: "continuous dividend or carry yield — 0 for a coin" },
        { name: "sigma", unit: "fraction per year", source: "implied volatility" },
        { name: "T", unit: "years", source: "time to expiry" }
      ],
      compute: function (i) { return bsSteps("call", i); },
      /* B: no normal CDF anywhere. Integrate the discounted payoff under the
         lognormal risk-neutral density with composite Simpson, split at the
         payoff's kink so the rule reaches machine precision. */
      alt: function (i) { return bsIntegral("call", i); },
      engine: function (i) { return optPrice("call", i); },
      reference: refsFor("opt.bs.call")
    });

    register({
      id: "opt.bs.put",
      label: "Black-Scholes put price",
      group: "Options",
      unit: "quote",
      formula: "P = K·e^(−rT)·Φ(−d2) − S·e^(−qT)·Φ(−d1)",
      sheet: "=K*EXP(-r*T)*NORM.S.DIST(-d2,TRUE)-S*EXP(-q*T)*NORM.S.DIST(-d1,TRUE)",
      source: "Black & Scholes (1973) with Merton's q. Put-call parity C − P = S·e^(−qT) − K·e^(−rT) is checked as a reference case of its own, which is the strongest single test on this pair: it holds for ANY correct pricer and fails for almost every incorrect one.",
      inputs: [
        { name: "S", unit: "quote", source: "spot price of the underlying" },
        { name: "K", unit: "quote", source: "strike" },
        { name: "r", unit: "fraction per year", source: "continuously compounded risk-free rate" },
        { name: "q", unit: "fraction per year", source: "continuous dividend or carry yield" },
        { name: "sigma", unit: "fraction per year", source: "implied volatility" },
        { name: "T", unit: "years", source: "time to expiry" }
      ],
      compute: function (i) { return bsSteps("put", i); },
      alt: function (i) { return bsIntegral("put", i); },
      engine: function (i) { return optPrice("put", i); },
      reference: refsFor("opt.bs.put")
    });

    register({
      id: "opt.bs.parity",
      label: "Put-call parity residual",
      group: "Options",
      unit: "quote",
      formula: "residual = (C − P) − (S·e^(−qT) − K·e^(−rT)),  which must be 0",
      sheet: "=(C-P)-(S*EXP(-q*T)-K*EXP(-r*T))",
      source: "A no-arbitrage identity, not a model: it holds for any European pair on the same underlying, strike and expiry regardless of the pricing model. Stoll (1969). A non-zero residual here means one of the two prices above is wrong.",
      inputs: [
        { name: "S", unit: "quote", source: "spot price of the underlying" },
        { name: "K", unit: "quote", source: "strike" },
        { name: "r", unit: "fraction per year", source: "risk-free rate" },
        { name: "q", unit: "fraction per year", source: "carry yield" },
        { name: "sigma", unit: "fraction per year", source: "implied volatility" },
        { name: "T", unit: "years", source: "time to expiry" }
      ],
      compute: function (i) {
        var w = W();
        var c = bsSteps("call", i), p = bsSteps("put", i);
        if (c.v == null || p.v == null) return w.out(null, "one of the two legs did not price");
        var S = num(i.S, 0), K = num(i.K, 0), r = num(i.r, 0), q = num(i.q, 0), T = num(i.T, 0);
        w.s("call price", c.v);
        w.s("put price", p.v);
        var lhs = w.s("C − P", c.v - p.v);
        var rhs = w.s("S·e^(−qT) − K·e^(−rT)", S * Math.exp(-q * T) - K * Math.exp(-r * T));
        var res = w.s("residual  (C−P) − (forward difference)", lhs - rhs);
        return w.out(res);
      },
      /* B: the same identity but priced by the integral, not the CDF. */
      alt: function (i) {
        var c = bsIntegral("call", i), p = bsIntegral("put", i);
        if (c == null || p == null) return null;
        var S = num(i.S, 0), K = num(i.K, 0), r = num(i.r, 0), q = num(i.q, 0), T = num(i.T, 0);
        return (c - p) - (S * Math.exp(-q * T) - K * Math.exp(-r * T));
      },
      engine: function (i) {
        var o = layer("DLOPT");
        if (!o || typeof o.parityGap !== "function") return null;
        try {
          var g = o.parityGap(num(i.S, 0), num(i.K, 0), num(i.T, 0), num(i.r, 0), num(i.q, 0), num(i.sigma, 0));
          return g && typeof g.abs === "number" && isFinite(g.abs) ? g.abs : null;
        } catch (e) { return null; }
      },
      reference: refsFor("opt.bs.parity")
    });

    /* ------------------------------------------------------- 7 · health factor */
    register({
      id: "lend.hf",
      label: "Lending health factor",
      group: "Lending",
      unit: "ratio",
      formula: "HF = Σ(collateral_i × price_i × liquidationThreshold_i) / Σ(debt_j × price_j)",
      sheet: "=SUMPRODUCT(qty,price,threshold)/SUMPRODUCT(debtQty,debtPrice)",
      source: "Aave V3 Technical Paper (January 2022), §3.3 — the health factor is the ratio of threshold-weighted collateral to total borrowed value, and a position is liquidatable below 1. The same definition is used by Compound V3 and by every fork of either.",
      inputs: [
        { name: "collateral", unit: "qty@price rows", source: "your supplied assets — one 'qty@price' per line" },
        { name: "thresholds", unit: "fraction", source: "each asset's liquidation threshold, in the same order" },
        { name: "debt", unit: "qty@price rows", source: "your borrowed assets — one 'qty@price' per line" }
      ],
      compute: function (i) {
        var w = W(), col = pairs(i.collateral), th = arr(i.thresholds), dbt = pairs(i.debt), j, numr = 0, den = 0, v;
        if (!col.length || !dbt.length) return w.out(null, "needs at least one collateral row and one debt row");
        if (th.length !== col.length) return w.out(null, "one liquidation threshold per collateral row, in the same order");
        for (j = 0; j < col.length; j++) {
          v = col[j][0] * col[j][1];
          w.s("collateral row " + (j + 1) + "  qty × price", v);
          w.s("  × liquidation threshold " + th[j], v * th[j]);
          numr += v * th[j];
        }
        w.s("threshold-weighted collateral", numr);
        for (j = 0; j < dbt.length; j++) { w.s("debt row " + (j + 1) + "  qty × price", dbt[j][0] * dbt[j][1]); den += dbt[j][0] * dbt[j][1]; }
        w.s("total debt value", den);
        if (!(den > 0)) return w.out(null, "no debt means no health factor — the position cannot be liquidated");
        var hf = w.s("HF = weighted collateral ÷ debt", numr / den);
        w.s("liquidatable below", 1);
        return w.out(hf);
      },
      /* B: aggregates first. Total collateral value, then a value-weighted
         average threshold, then one division. Same answer by a route that
         never multiplies a row by its own threshold. */
      alt: function (i) {
        var col = pairs(i.collateral), th = arr(i.thresholds), dbt = pairs(i.debt), j, tc = 0, wsum = 0, td = 0, v;
        if (!col.length || !dbt.length || th.length !== col.length) return null;
        for (j = 0; j < col.length; j++) { v = col[j][0] * col[j][1]; tc += v; wsum += v * th[j]; }
        for (j = 0; j < dbt.length; j++) td += dbt[j][0] * dbt[j][1];
        if (!(tc > 0) || !(td > 0)) return null;
        var avgLt = wsum / tc;
        return (tc * avgLt) / td;
      },
      /* Deliberately NO engine column. The lending desk resolves each asset's
         liquidation threshold from its own reserve table rather than taking one
         as an argument, so asking it about the hand-entered thresholds above
         would manufacture a disagreement that is about parameters, not
         arithmetic. The Cross-check tab says exactly that instead. */
      reference: refsFor("lend.hf")
    });

    /* --------------------------------------------------------- 8 · book walk */
    register({
      id: "book.walk",
      label: "Order-book walk average fill",
      group: "Execution",
      unit: "quote per base",
      formula: "avg = Σ(min(remaining, size_k) × price_k) / filled,  levels taken in order",
      sheet: "=SUMPRODUCT(taken,price)/SUM(taken)",
      source: "The mechanic of a marketable order on a limit book — it is what the engine's walk() does and what layer 53's execution comparison prices every book venue with. There is no model in it: given the levels, the answer is arithmetic.",
      inputs: [
        { name: "levels", unit: "price@size rows", source: "the book, best price first — one 'price@size' per line" },
        { name: "qty", unit: "base", source: "the size you want to fill" }
      ],
      compute: function (i) {
        var w = W(), L = pairs(i.levels), qty = num(i.qty, 0), rem = qty, cost = 0, f = 0, j, take;
        if (!L.length || !(qty > 0)) return w.out(null, "needs a book and a size");
        for (j = 0; j < L.length && rem > EPS; j++) {
          take = Math.min(rem, L[j][1]);
          w.s("level " + (j + 1) + " @ " + L[j][0] + " — take " + take, take * L[j][0]);
          cost += take * L[j][0]; f += take; rem -= take;
        }
        w.s("filled", f);
        w.s("unfilled", Math.max(0, qty - f));
        w.s("total cost", cost);
        if (!(f > EPS)) return w.out(null, "nothing filled");
        var avg = w.s("average fill  cost ÷ filled", cost / f);
        return w.out(avg, rem > EPS ? "the book ran out before the size did — " + rem + " left over" : null);
      },
      /* B: builds cumulative depth, binary-searches for the boundary level and
         prices the whole levels as a prefix sum plus one partial. It never
         drains a remaining counter, so an off-by-one in the drain loop has
         nowhere to hide. */
      alt: function (i) {
        var L = pairs(i.levels), qty = num(i.qty, 0), cum = [], c = 0, j;
        if (!L.length || !(qty > 0)) return null;
        for (j = 0; j < L.length; j++) { c += L[j][1]; cum.push(c); }
        var q = Math.min(qty, c);
        if (!(q > 0)) return null;
        var lo = 0, hi = cum.length - 1, k = cum.length - 1, m;
        while (lo <= hi) { m = (lo + hi) >> 1; if (cum[m] >= q - EPS) { k = m; hi = m - 1; } else lo = m + 1; }
        var full = 0;
        for (j = 0; j < k; j++) full += L[j][1] * L[j][0];
        var part = (q - (k > 0 ? cum[k - 1] : 0)) * L[k][0];
        return (full + part) / q;
      },
      engine: function (i) {
        var p = engine();
        if (!p || typeof p.walk !== "function") return null;
        try {
          var L = pairs(i.levels), asks = [], j;
          for (j = 0; j < L.length; j++) asks.push({ p: L[j][0], a: L[j][1], i: j });
          var r = p.walk({ mid: L.length ? L[0][0] : 0, asks: asks, bids: [] }, "buy", num(i.qty, 0), 0);
          return r && r.filled > 0 ? r.cost / r.filled : null;
        } catch (e) { return null; }
      },
      reference: refsFor("book.walk")
    });

    /* --------------------------------------------------------- 9 · cost basis */
    register({
      id: "tax.fifo",
      label: "FIFO realised gain",
      group: "Cost basis",
      unit: "quote",
      formula: "basis = Σ(taken_k × unitCost_k) over lots in acquisition order;  gain = qty×price − basis",
      sheet: "=qty*price-SUMPRODUCT(taken,unitCost)",
      source: "First-in first-out lot relief, the default ordering where no specific identification is made. Described for property generally in IRS Publication 550 and applied to digital assets by Rev. Proc. 2024-28. This is arithmetic, not tax advice.",
      inputs: [
        { name: "lots", unit: "qty@unitCost rows", source: "your acquisitions, oldest first — one 'qty@cost' per line" },
        { name: "sell", unit: "base", source: "the quantity disposed of" },
        { name: "price", unit: "quote per base", source: "the disposal price" }
      ],
      compute: function (i) { return basisSteps(pairs(i.lots), num(i.sell, 0), num(i.price, 0), false); },
      alt: function (i) { return basisAlt(pairs(i.lots), num(i.sell, 0), num(i.price, 0), false); },
      engine: function (i) {
        var t = layer("DLTAX");
        if (!t || typeof t.basis !== "function") return null;
        try { var r = t.basis("fifo", pairs(i.lots), num(i.sell, 0), num(i.price, 0)); return r && typeof r.gain === "number" ? r.gain : (typeof r === "number" ? r : null); } catch (e) { return null; }
      },
      reference: refsFor("tax.fifo")
    });

    register({
      id: "tax.hifo",
      label: "HIFO realised gain",
      group: "Cost basis",
      unit: "quote",
      formula: "same as FIFO, but lots are consumed in DESCENDING unit cost",
      sheet: "=qty*price-SUMPRODUCT(taken,unitCost)  with lots sorted by unitCost descending",
      source: "Highest-in first-out: a specific-identification ordering that consumes the most expensive lots first, minimising the realised gain. Permitted only where the taxpayer can identify the units disposed of — IRS Rev. Proc. 2024-28 sets out the per-wallet identification rules for digital assets. This is arithmetic, not tax advice.",
      inputs: [
        { name: "lots", unit: "qty@unitCost rows", source: "your acquisitions — order does not matter here" },
        { name: "sell", unit: "base", source: "the quantity disposed of" },
        { name: "price", unit: "quote per base", source: "the disposal price" }
      ],
      compute: function (i) { return basisSteps(pairs(i.lots), num(i.sell, 0), num(i.price, 0), true); },
      alt: function (i) { return basisAlt(pairs(i.lots), num(i.sell, 0), num(i.price, 0), true); },
      engine: function (i) {
        var t = layer("DLTAX");
        if (!t || typeof t.basis !== "function") return null;
        try { var r = t.basis("hifo", pairs(i.lots), num(i.sell, 0), num(i.price, 0)); return r && typeof r.gain === "number" ? r.gain : (typeof r === "number" ? r : null); } catch (e) { return null; }
      },
      reference: refsFor("tax.hifo")
    });
  }

  /* ------------------------------------------------- shared step builders */

  function bsSteps(cp, i) {
    var w = W(), S = num(i.S, 0), K = num(i.K, 0), r = num(i.r, 0), q = num(i.q, 0), sg = num(i.sigma, 0), T = num(i.T, 0);
    if (!(S > 0 && K > 0 && sg > 0 && T > 0)) return w.out(null, "needs a positive spot, strike, volatility and time");
    var sT = w.s("σ·√T", sg * Math.sqrt(T));
    var d1 = w.s("d1 = (ln(S/K) + (r − q + σ²/2)·T) ÷ σ√T", (Math.log(S / K) + (r - q + sg * sg / 2) * T) / sT);
    var d2 = w.s("d2 = d1 − σ√T", d1 - sT);
    var dfS = w.s("e^(−qT)", Math.exp(-q * T));
    var dfK = w.s("e^(−rT)", Math.exp(-r * T));
    var out;
    if (cp === "call") {
      var n1 = w.s("Φ(d1)", ncdf(d1)), n2 = w.s("Φ(d2)", ncdf(d2));
      out = w.s("C = S·e^(−qT)·Φ(d1) − K·e^(−rT)·Φ(d2)", S * dfS * n1 - K * dfK * n2);
    } else {
      var m1 = w.s("Φ(−d1)", ncdf(-d1)), m2 = w.s("Φ(−d2)", ncdf(-d2));
      out = w.s("P = K·e^(−rT)·Φ(−d2) − S·e^(−qT)·Φ(−d1)", K * dfK * m2 - S * dfS * m1);
    }
    return w.out(out);
  }

  function bsIntegral(cp, i) {
    var S = num(i.S, 0), K = num(i.K, 0), r = num(i.r, 0), q = num(i.q, 0), sg = num(i.sigma, 0), T = num(i.T, 0);
    if (!(S > 0 && K > 0 && sg > 0 && T > 0)) return null;
    var sT = sg * Math.sqrt(T), m = Math.log(S) + (r - q - sg * sg / 2) * T;
    /* The payoff has a KINK at ST = K, and Simpson's rule converges badly
       across a kink. Split the interval there — the integrand is analytic on
       each side and the rule then reaches machine precision. */
    var zk = (Math.log(K) - m) / sT;
    var f = function (z) {
      var ST = Math.exp(m + sT * z);
      var pay = cp === "call" ? ST - K : K - ST;
      return (pay > 0 ? pay : 0) * Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
    };
    var lo = cp === "call" ? Math.max(zk, -14) : -14;
    var hi = cp === "call" ? 14 : Math.min(zk, 14);
    if (!(hi > lo)) return 0;
    return Math.exp(-r * T) * simpson(f, lo, hi, 20000);
  }

  /* The options desk's own pricer, on its published signature bs(S,K,T,r,q,v).
     Guarded: if it is not in this build, or its shape has moved, this returns
     null and the Check tab prints no third column rather than a wrong one. */
  function optPrice(cp, i) {
    var o = layer("DLOPT");
    var fn = o && (cp === "call" ? o.call : o.put);
    if (typeof fn !== "function") return null;
    try {
      var v = fn(num(i.S, 0), num(i.K, 0), num(i.T, 0), num(i.r, 0), num(i.q, 0), num(i.sigma, 0));
      return typeof v === "number" && isFinite(v) ? v : null;
    } catch (e) { return null; }
  }

  function basisSteps(lots, sell, price, hifo) {
    var w = W(), L = lots.slice(), rem = sell, basis = 0, j, take;
    if (!L.length || !(sell > 0)) return w.out(null, "needs lots and a disposal quantity");
    if (hifo) L.sort(function (a, b) { return b[1] - a[1]; });
    w.s("lots available", L.length);
    w.s(hifo ? "consumption order" : "consumption order", hifo ? "highest unit cost first" : "oldest lot first");
    for (j = 0; j < L.length && rem > EPS; j++) {
      take = Math.min(rem, L[j][0]);
      w.s("lot " + (j + 1) + " @ " + L[j][1] + " — take " + take, take * L[j][1]);
      basis += take * L[j][1]; rem -= take;
    }
    var used = sell - rem;
    w.s("quantity relieved", used);
    if (rem > EPS) w.s("short by (not enough lots)", rem);
    var b = w.s("cost basis consumed", basis);
    var pr = w.s("proceeds  quantity × price", used * price);
    var g = w.s("realised gain  proceeds − basis", pr - b);
    return w.out(g, rem > EPS ? "the lots ran out before the disposal did — " + rem + " unmatched" : null);
  }

  function basisAlt(lots, sell, price, hifo) {
    var L = lots.slice(), j, cum = [], c = 0;
    if (!L.length || !(sell > 0)) return null;
    if (hifo) L.sort(function (a, b) { return b[1] - a[1]; });
    for (j = 0; j < L.length; j++) { c += L[j][0]; cum.push(c); }
    var q = Math.min(sell, c), basis = 0, lo = 0, hi, wdt;
    /* integrate cost over the consumed interval of the cumulative-quantity axis */
    for (j = 0; j < L.length; j++) {
      hi = cum[j];
      wdt = Math.min(Math.max(q - lo, 0), hi - lo);
      basis += wdt * L[j][1];
      lo = hi;
    }
    return q * price - basis;
  }

  /* ==========================================================================
     REFCASES — pinned reference values.
     The format below is deliberately strict JSON (quoted keys, no trailing
     commas, no comments inside the array) so that test/gate-verify.js can lift
     this array straight out of the shipped payload text, JSON.parse it, and
     recompute every case with a THIRD implementation written inside the gate.
     Do not reformat it and do not put an expression in it.
       fid    the formula id it belongs to
       in     the pinned inputs
       expect the pinned expected output
       tol    absolute tolerance the self-test measures against
       cite   where the formula (and, where marked published, the value) comes from
     ========================================================================== */
  var REFCASES = [
    {"id":"cp1","fid":"amm.cp.out","in":{"dx":10,"rx":1000,"ry":2000000,"feeBps":30},"expect":19743.160687941225,"tol":1e-6,"cite":"Uniswap v2 Core (2020) §3.1 / UniswapV2Library.getAmountOut — value derived from the cited formula"},
    {"id":"cp2","fid":"amm.cp.out","in":{"dx":1,"rx":1000,"ry":2000000,"feeBps":30},"expect":1992.0139620798066,"tol":1e-7,"cite":"Uniswap v2 Core (2020) §3.1 — 1\u00d70.997\u00d72,000,000 / 1,000.997, value derived from the cited formula"},
    {"id":"cp3","fid":"amm.cp.out","in":{"dx":500,"rx":1000,"ry":2000000,"feeBps":0},"expect":666666.6666666666,"tol":1e-6,"cite":"Uniswap v2 Core (2020) §3.1 with a zero fee — the pure x·y=k case, dx=rx/2 gives exactly ry/3"},
    {"id":"imp1","fid":"amm.cp.impact","in":{"dx":10,"rx":1000,"ry":2000000,"feeBps":30},"expect":128.41965602938785,"tol":1e-6,"cite":"Definition used across this app's execution surfaces; derived from Uniswap v2 Core §3.1"},
    {"id":"imp2","fid":"amm.cp.impact","in":{"dx":10,"rx":1000,"ry":2000000,"feeBps":0},"expect":99.00990099009901,"tol":1e-7,"cite":"Fee-free constant product: impact collapses to dx/(rx+dx) = 10/1010 = 0.990099%"},
    {"id":"v3a","fid":"v3.amount0","in":{"L":2000,"P":2500,"Pa":2000,"Pb":3200},"expect":4.644660940672625,"tol":1e-9,"cite":"Uniswap v3 Core whitepaper (2021) eq. 6.29 — value derived from the cited formula"},
    {"id":"v3b","fid":"v3.amount1","in":{"L":2000,"P":2500,"Pa":2000,"Pb":3200},"expect":10557.280900008407,"tol":1e-7,"cite":"Uniswap v3 Core whitepaper (2021) eq. 6.30 — value derived from the cited formula"},
    {"id":"il125","fid":"il.divergence","in":{"r":1.25},"expect":-0.006192010000093395,"tol":1e-12,"cite":"PUBLISHED: Uniswap docs / Pintail (2019) quote 0.6% divergence loss at a 1.25x price move"},
    {"id":"il150","fid":"il.divergence","in":{"r":1.5},"expect":-0.020204102886728803,"tol":1e-12,"cite":"PUBLISHED: Uniswap docs / Pintail (2019) quote 2.0% at 1.5x"},
    {"id":"il200","fid":"il.divergence","in":{"r":2},"expect":-0.05719095841793653,"tol":1e-12,"cite":"PUBLISHED: Uniswap docs / Pintail (2019) quote 5.7% at 2x"},
    {"id":"il300","fid":"il.divergence","in":{"r":3},"expect":-0.1339745962155614,"tol":1e-12,"cite":"PUBLISHED: Uniswap docs / Pintail (2019) quote 13.4% at 3x"},
    {"id":"il400","fid":"il.divergence","in":{"r":4},"expect":-0.19999999999999996,"tol":1e-12,"cite":"PUBLISHED: Uniswap docs / Pintail (2019) quote 20.0% at 4x — the closed form gives exactly 0.2"},
    {"id":"il500","fid":"il.divergence","in":{"r":5},"expect":-0.2546440075000701,"tol":1e-12,"cite":"PUBLISHED: Uniswap docs / Pintail (2019) quote 25.5% at 5x"},
    {"id":"il050","fid":"il.divergence","in":{"r":0.5},"expect":-0.05719095841793653,"tol":1e-12,"cite":"Symmetry in the ratio: halving the price costs exactly what doubling it costs"},
    {"id":"be1","fid":"il.breakeven","in":{"r":2,"days":90},"expect":0.26977259109014984,"tol":1e-9,"cite":"This desk's stated definition, compounding on layer 45's (1+APR)^(days/365) convention"},
    {"id":"mm1","fid":"perp.mm","in":{"notional":30000},"expect":120,"tol":1e-9,"cite":"PUBLISHED: Binance BTCUSDT bracket 1 — 30,000 × 0.40% − 0 = 120"},
    {"id":"mm2","fid":"perp.mm","in":{"notional":300000},"expect":1700,"tol":1e-9,"cite":"PUBLISHED: Binance BTCUSDT bracket 3 — 300,000 × 1.00% − 1,300 = 1,700"},
    {"id":"mm3","fid":"perp.mm","in":{"notional":750000},"expect":6200,"tol":1e-9,"cite":"PUBLISHED: Binance BTCUSDT bracket 3 — 750,000 × 1.00% − 1,300 = 6,200"},
    {"id":"mm4","fid":"perp.mm","in":{"notional":2000000},"expect":33700,"tol":1e-9,"cite":"PUBLISHED: Binance BTCUSDT bracket 4 — 2,000,000 × 2.50% − 16,300 = 33,700"},
    {"id":"liq1","fid":"perp.liq","in":{"side":"long","entry":60000,"qty":1,"margin":6000},"expect":54221.10552763819,"tol":1e-6,"cite":"Isolated-margin liquidation condition with Binance's BTCUSDT bracket 2 (0.50% / 50) — value derived"},
    {"id":"liq2","fid":"perp.liq","in":{"side":"short","entry":60000,"qty":1,"margin":6000},"expect":65721.39303482587,"tol":1e-6,"cite":"Same condition, short side — value derived"},
    {"id":"liq3","fid":"perp.liq","in":{"side":"long","entry":60000,"qty":5,"margin":30000},"expect":54282.82828282828,"tol":1e-6,"cite":"A case that crosses a bracket: entry notional 300,000 sits in bracket 3, and so does the liquidation notional — value derived"},
    {"id":"fund1","fid":"perp.funding","in":{"notional":60000,"rate8h":0.0001,"hours":24},"expect":18,"tol":1e-9,"cite":"Three settlements in 24h at 1 bp on a 60,000 notional = 18 — the standard 8h perpetual funding mechanism"},
    {"id":"fund2","fid":"perp.funding","in":{"notional":125000,"rate8h":0.000125,"hours":72},"expect":140.625,"tol":1e-9,"cite":"Nine settlements at 1.25 bp on 125,000 = 140.625"},
    {"id":"sh1","fid":"risk.sharpe","in":{"returns":[0.012,-0.004,0.008,0.021,-0.011,0.003,0.017,-0.006,0.009,0.014,-0.002,0.005],"rf":0,"periods":252},"expect":8.881629862374899,"tol":1e-9,"cite":"Sharpe (1994) with the (n−1) sample standard deviation — value derived from the cited definition"},
    {"id":"dd1","fid":"risk.maxdd","in":{"equity":[100,108,104,121,96,99,130,118,142,131,150]},"expect":0.2066115702479339,"tol":1e-12,"cite":"Peak 121 to trough 96 is the worst fall: 25/121 = 0.20661157 — value derived"},
    {"id":"var1","fid":"risk.var.hist","in":{"returns":[-0.031,0.012,-0.008,0.024,-0.045,0.006,-0.017,0.033,-0.002,0.019,-0.026,0.004,-0.011,0.028,-0.038,0.009,-0.006,0.015,-0.022,0.002],"confidence":0.95,"notional":10000},"expect":383.5,"tol":1e-9,"cite":"Jorion (2006) ch.10 historical simulation, PERCENTILE.INC interpolation — value derived"},
    {"id":"var2","fid":"risk.var.hist","in":{"returns":[-0.031,0.012,-0.008,0.024,-0.045,0.006,-0.017,0.033,-0.002,0.019,-0.026,0.004,-0.011,0.028,-0.038,0.009,-0.006,0.015,-0.022,0.002],"confidence":0.99,"notional":10000},"expect":436.7,"tol":1e-9,"cite":"Same series at 99% — value derived"},
    {"id":"varp1","fid":"risk.var.param","in":{"mu":0,"sigma":0.02,"confidence":0.95,"notional":10000},"expect":328.97072539029444,"tol":1e-7,"cite":"PUBLISHED z: Φ⁻¹(0.95) = 1.6448536269514722, so 1.6448536269514722 × 0.02 × 10,000"},
    {"id":"varp2","fid":"risk.var.param","in":{"mu":0,"sigma":0.02,"confidence":0.99,"notional":10000},"expect":465.26957480816816,"tol":1e-7,"cite":"PUBLISHED z: Φ⁻¹(0.99) = 2.3263478740408408, so 2.3263478740408408 × 0.02 × 10,000"},
    {"id":"bs1","fid":"opt.bs.call","in":{"S":100,"K":100,"r":0.05,"q":0,"sigma":0.2,"T":1},"expect":10.450583572185565,"tol":1e-9,"cite":"PUBLISHED: the standard Black-Scholes textbook case (Hull) — S=K=100, r=5%, σ=20%, T=1 prices the call at 10.4506"},
    {"id":"bs2","fid":"opt.bs.put","in":{"S":100,"K":100,"r":0.05,"q":0,"sigma":0.2,"T":1},"expect":5.573526022256971,"tol":1e-9,"cite":"PUBLISHED: the same textbook case — the put is 5.5735, and put-call parity ties the two"},
    {"id":"bs3","fid":"opt.bs.call","in":{"S":42,"K":40,"r":0.1,"q":0,"sigma":0.2,"T":0.5},"expect":4.759422392871532,"tol":1e-9,"cite":"PUBLISHED: Hull's worked example — S=42, K=40, r=10%, σ=20%, T=0.5 gives a call of 4.76"},
    {"id":"bs4","fid":"opt.bs.put","in":{"S":42,"K":40,"r":0.1,"q":0,"sigma":0.2,"T":0.5},"expect":0.8085993729000922,"tol":1e-9,"cite":"PUBLISHED: Hull's same worked example — the put is 0.81"},
    {"id":"par1","fid":"opt.bs.parity","in":{"S":100,"K":100,"r":0.05,"q":0,"sigma":0.2,"T":1},"expect":0,"tol":1e-9,"cite":"Put-call parity is an identity, so the residual is exactly zero for any correct pricer (Stoll 1969)"},
    {"id":"par2","fid":"opt.bs.parity","in":{"S":42,"K":40,"r":0.1,"q":0.03,"sigma":0.2,"T":0.5},"expect":0,"tol":1e-9,"cite":"The identity holds with a carry yield too: C − P = S·e^(−qT) − K·e^(−rT)"},
    {"id":"hf1","fid":"lend.hf","in":{"collateral":[[4,2500],[0.15,60000]],"thresholds":[0.83,0.78],"debt":[[9000,1],[2000,1]]},"expect":1.3927272727272728,"tol":1e-12,"cite":"Aave V3 Technical Paper (2022) §3.3 — (4×2500×0.83 + 0.15×60000×0.78) / 11,000 = 15,320/11,000"},
    {"id":"hf2","fid":"lend.hf","in":{"collateral":[[10000,1]],"thresholds":[0.8],"debt":[[8000,1]]},"expect":1,"tol":1e-12,"cite":"Aave V3 §3.3 — a position exactly at the liquidation boundary has HF = 1"},
    {"id":"bw1","fid":"book.walk","in":{"levels":[[60010,0.4],[60025,0.9],[60050,1.2],[60090,2],[60150,3.5]],"qty":3},"expect":60043.833333333336,"tol":1e-7,"cite":"Marketable order against a limit book — 180,131.5 of cost over 3.0 filled"},
    {"id":"bw2","fid":"book.walk","in":{"levels":[[60010,0.4],[60025,0.9],[60050,1.2],[60090,2],[60150,3.5]],"qty":1.3},"expect":60020.38461538461,"tol":1e-7,"cite":"Same book, a size that stops inside level 3 — 78,026.5 over 1.3"},
    {"id":"bw3","fid":"book.walk","in":{"levels":[[60010,0.4],[60025,0.9],[60050,1.2],[60090,2],[60150,3.5]],"qty":99},"expect":60098.9375,"tol":1e-7,"cite":"A size the book cannot fill — the average is over the 8.0 that did fill, and the shortfall is named, not hidden"},
    {"id":"fifo1","fid":"tax.fifo","in":{"lots":[[0.5,42000],[0.25,61000],[0.8,38500],[0.4,55000]],"sell":1,"price":58000},"expect":12125,"tol":1e-9,"cite":"IRS Pub. 550 / Rev. Proc. 2024-28 FIFO ordering — 0.5@42,000 + 0.25@61,000 + 0.25@38,500 = 45,875 of basis"},
    {"id":"fifo2","fid":"tax.fifo","in":{"lots":[[0.5,42000],[0.25,61000],[0.8,38500],[0.4,55000]],"sell":1.95,"price":58000},"expect":24050,"tol":1e-9,"cite":"The same lots, a larger disposal — 89,050 of basis against 113,100 of proceeds"},
    {"id":"hifo1","fid":"tax.hifo","in":{"lots":[[0.5,42000],[0.25,61000],[0.8,38500],[0.4,55000]],"sell":1,"price":58000},"expect":6050,"tol":1e-9,"cite":"HIFO ordering — 0.25@61,000 + 0.4@55,000 + 0.35@42,000 = 51,950 of basis, half the FIFO gain on the same disposal"},
    {"id":"hifo2","fid":"tax.hifo","in":{"lots":[[0.5,42000],[0.25,61000],[0.8,38500],[0.4,55000]],"sell":1.95,"price":58000},"expect":24050,"tol":1e-9,"cite":"Once every lot is consumed the ordering cannot matter — HIFO and FIFO must agree exactly, and this case is here to prove it"}
  ];

  function refsFor(fid) {
    var out = [], i;
    for (i = 0; i < REFCASES.length; i++) if (REFCASES[i].fid === fid) out.push(REFCASES[i]);
    return out;
  }

  /* ==========================================================================
     OTHER LAYERS — every one guarded, every absence named
     ========================================================================== */

  var NEIGHBOURS = [
    ["DLTAX", "Tax / cost basis desk", "cross-checks this layer's FIFO and HIFO against the ledger's own"],
    ["DLSOR", "Execution / routing desk", "cross-checks the routing all-in against the book walk here"],
    ["DLDEFI", "Liquidity desk", "cross-checks the pair and range arithmetic"],
    ["DLRISK", "Risk desk", "cross-checks Sharpe, drawdown and VaR"],
    ["DLOPT", "Options desk", "cross-checks the Black-Scholes price"],
    ["DLLEND", "Lending desk", "cross-checks the health factor"]
  ];

  function layer(name) {
    try { var l = window[name]; return (l && l.__v) ? l : null; } catch (e) { return null; }
  }
  function engine() { try { return (window.DLAPP && window.DLAPP.paper) || null; } catch (e) { return null; } }

  function neighbours() {
    var out = [], i, l;
    for (i = 0; i < NEIGHBOURS.length; i++) {
      l = layer(NEIGHBOURS[i][0]);
      out.push({ key: NEIGHBOURS[i][0], name: NEIGHBOURS[i][1], why: NEIGHBOURS[i][2], present: !!l, build: l ? l.__v : null });
    }
    return out;
  }

  /* ==========================================================================
     CHECK · SELF-TEST · CROSS-CHECK
     ========================================================================== */

  function check(id, inputs) {
    var e = get(id);
    if (!e) return { ok: false, id: id, note: "no formula registered under that id" };
    var a = null, b = null, g = null, aerr = null, berr = null;
    try { a = e.compute ? e.compute(inputs || {}) : null; } catch (x) { aerr = String(x && x.message || x); }
    try { b = e.alt ? e.alt(inputs || {}) : null; } catch (x) { berr = String(x && x.message || x); }
    try { g = e.engine ? e.engine(inputs || {}) : null; } catch (x) { g = null; }
    var av = a && typeof a === "object" ? a.v : (typeof a === "number" ? a : null);
    var steps = (a && a.steps) || [];
    var bv = typeof b === "number" && isFinite(b) ? b : null;
    var gv = typeof g === "number" && isFinite(g) ? g : null;
    return {
      ok: true, id: id, entry: e, inputs: inputs || {},
      a: av, b: bv, engine: gv,
      steps: steps, note: (a && a.note) || null,
      aError: aerr, bError: berr,
      deltaAB: (av == null || bv == null) ? null : av - bv,
      relAB: (av == null || bv == null || Math.abs(av) < 1e-300) ? null : (av - bv) / Math.abs(av),
      deltaEngine: (av == null || gv == null) ? null : av - gv
    };
  }

  function selfTest() {
    var rows = [], i, j, e, r, c, pass = 0, fail = 0, noRef = [];
    for (i = 0; i < ORDER.length; i++) {
      e = REG[ORDER[i]];
      if (!e.reference || !e.reference.length) { noRef.push(e.id); continue; }
      for (j = 0; j < e.reference.length; j++) {
        c = e.reference[j];
        r = check(e.id, c["in"]);
        var got = r.a, tol = c.tol == null ? 1e-9 : c.tol;
        var dExp = (got == null) ? null : got - c.expect;
        var okExp = got != null && Math.abs(dExp) <= tol;
        var dAB = r.deltaAB;
        var okAB = r.b == null ? null : Math.abs(dAB) <= Math.max(tol, 1e-9);
        var good = okExp && okAB !== false;
        if (good) pass++; else fail++;
        rows.push({
          caseId: c.id, id: e.id, label: e.label, group: e.group,
          expect: c.expect, got: got, alt: r.b, engine: r.engine,
          tol: tol, deltaExpect: dExp, deltaAB: dAB,
          okExpect: okExp, okAB: okAB, pass: good, cite: c.cite, note: r.note
        });
      }
    }
    return { rows: rows, passed: pass, failed: fail, total: pass + fail, withoutReference: noRef };
  }

  /* ---- cross-checks between paths that already exist elsewhere in the app */

  function crossChecks() {
    var out = [];
    out.push(xcBookVsPool());
    out.push(xcSorVsPreview());
    out.push(xcTaxBasis());
    out.push(xcEngineSharpe());
    out.push(xcOptions());
    out.push(xcInvNorm());
    out.push(xcLendThresholds());
    return out;
  }

  function missingRow(title, key, why) {
    return { title: title, state: "absent", a: null, b: null, delta: null,
      note: key + " is not in this build — " + why + ". Nothing is skipped silently: this row exists so the gap is visible." };
  }

  /* the modelled book walked for a size, against the same size through the
     pool quote — two surfaces that should broadly agree and usually will not */
  function xcBookVsPool() {
    var s = layer("DLSOR");
    if (!s || typeof s.quote !== "function") return missingRow("Book walk vs pool quote, same size", "DLSOR", "the routing desk is where both quotes come from");
    var q = null;
    try { q = s.quote({ sym: "BTC", quote: "USDT", side: "buy", base: 0.5, tier: "medium", tolerancePct: 1 }); } catch (e) { q = null; }
    if (!q || !q.venues || !q.venues.length) return { title: "Book walk vs pool quote, same size", state: "no data", a: null, b: null, delta: null, note: (q && q.note) || "the routing desk had no market to quote — nothing to compare." };
    var book = null, pool = null, i;
    for (i = 0; i < q.venues.length; i++) {
      if (q.venues[i].venueClass === "book" && q.venues[i].avg != null && (book == null || q.venues[i].avg < book.avg)) book = q.venues[i];
      if (q.venues[i].venueClass === "amm" && q.venues[i].avg != null) pool = q.venues[i];
    }
    if (!book || !pool) return { title: "Book walk vs pool quote, same size", state: "no data", a: null, b: null, delta: null, note: "one of the two surfaces did not quote this size." };
    return {
      title: "Book walk vs pool quote — buy 0.5 BTC",
      state: "both", aLabel: book.name + " (book walk)", bLabel: pool.name + " (pool curve)",
      a: book.avg, b: pool.avg, delta: book.avg - pool.avg,
      note: "Two independent fill paths for the same size. They are NOT expected to agree: layer 53 states that book depth and pool depth are both derived from 24h volume by different constants, so the gap is partly a modelling artifact. It is printed rather than reconciled — this desk reports the gap, it does not pick a winner."
    };
  }

  /* the routing desk's all-in for a size, against the engine's own preview */
  function xcSorVsPreview() {
    var s = layer("DLSOR"), p = engine();
    if (!s || typeof s.quote !== "function") return missingRow("Routing all-in vs ticket preview", "DLSOR", "the routing desk owns the all-in figure");
    if (!p || typeof p.preview !== "function") return { title: "Routing all-in vs ticket preview", state: "absent", a: null, b: null, delta: null, note: "the typed engine's preview() is not reachable in this build — the ticket's side of the comparison is missing, so no claim is made." };
    var q = null;
    try { q = s.quote({ sym: "BTC", quote: "USDT", side: "buy", base: 0.25, tier: "medium", tolerancePct: 1, venues: ["dexamm"] }); } catch (e) { q = null; }
    var row = q && q.venues && q.venues.length ? q.venues[0] : null;
    if (!row || row.allInQuote == null) return { title: "Routing all-in vs ticket preview", state: "no data", a: null, b: null, delta: null, note: (q && q.note) || "the routing desk did not price this size." };
    var pv = null;
    try { pv = p.preview({ sym: "BTC", quote: "USDT", side: "buy", base: 0.25 }); } catch (e) { pv = null; }
    var pvq = pv && typeof pv.allInQuote === "number" ? pv.allInQuote : (pv && typeof pv.cost === "number" ? pv.cost : null);
    if (pvq == null) return { title: "Routing all-in vs ticket preview", state: "no data", a: row.allInQuote, b: null, delta: null, note: "the engine's preview did not return a comparable all-in for this request in this build, so this desk prints the routing figure alone rather than inventing the other side." };
    return {
      title: "Routing all-in vs ticket preview — buy 0.25 BTC on the pool",
      state: "both", aLabel: "DLSOR all-in", bLabel: "engine preview",
      a: row.allInQuote, b: pvq, delta: row.allInQuote - pvq,
      note: "Two routes to the cost of one order. A non-zero gap is a real disagreement between two surfaces a user can see, and it is printed here rather than reconciled."
    };
  }

  /* this layer's cost basis against the tax ledger's, on the ledger's own lots */
  function xcTaxBasis() {
    var t = layer("DLTAX");
    if (!t) return missingRow("Cost basis — DLTAX vs this layer", "DLTAX", "the tax ledger owns the app's cost-basis figure");
    var lots = null, sell = null, px = null;
    try {
      if (typeof t.lots === "function") lots = t.lots("BTC");
      if (typeof t.lastDisposal === "function") { var d = t.lastDisposal("BTC"); if (d) { sell = +d.qty; px = +d.price; } }
    } catch (e) { lots = null; }
    if (!lots || !lots.length || !(sell > 0) || !(px > 0)) {
      return { title: "Cost basis — DLTAX vs this layer", state: "no data", a: null, b: null, delta: null,
        note: "DLTAX is in this build but exposed no lots and no disposal to compare on. The comparison is named and left empty rather than filled with an example — an example would prove nothing about your ledger." };
    }
    var norm = [], i;
    for (i = 0; i < lots.length; i++) norm.push([+lots[i].qty || +lots[i][0] || 0, +lots[i].unitCost || +lots[i][1] || 0]);
    var mine = basisAlt(norm, sell, px, false);
    var theirs = null;
    try { var r = t.basis("fifo", norm, sell, px); theirs = r && typeof r.gain === "number" ? r.gain : (typeof r === "number" ? r : null); } catch (e) { theirs = null; }
    if (theirs == null) return { title: "Cost basis — DLTAX vs this layer", state: "no data", a: mine, b: null, delta: null, note: "DLTAX did not answer a basis() call in the shape this layer expects, so only this layer's figure is shown." };
    return { title: "Cost basis (FIFO) — DLTAX vs this layer", state: "both", aLabel: "this layer", bLabel: "DLTAX", a: mine, b: theirs, delta: mine - theirs,
      note: "Same lots, same disposal, two implementations. A non-zero delta means one of the two is wrong and neither this desk nor the ledger gets to decide which." };
  }

  /* the typed engine's Sharpe against this layer's, on one pinned series */
  function xcEngineSharpe() {
    var p = engine();
    var R = [0.012, -0.004, 0.008, 0.021, -0.011, 0.003, 0.017, -0.006, 0.009, 0.014, -0.002, 0.005];
    var mine = null;
    try { var r = check("risk.sharpe", { returns: R, rf: 0, periods: 252 }); mine = r.a; } catch (e) { mine = null; }
    if (!p || typeof p.sharpe !== "function") return { title: "Sharpe — typed engine vs this layer", state: "absent", a: mine, b: null, delta: null,
      note: "DLAPP.paper.sharpe is not reachable in this build. This layer's figure stands alone and is not cross-checked." };
    var theirs = null;
    try { var v = p.sharpe(R); theirs = typeof v === "number" && isFinite(v) ? v : null; } catch (e) { theirs = null; }
    if (theirs == null) return { title: "Sharpe — typed engine vs this layer", state: "no data", a: mine, b: null, delta: null, note: "the engine's sharpe() did not return a finite number for this series." };
    return { title: "Sharpe — typed engine vs this layer", state: "both", aLabel: "this layer (×√252)", bLabel: "engine", a: mine, b: theirs, delta: (mine == null ? null : mine - theirs),
      note: "The engine's sharpe() may annualise on a different period count, or not at all. A large gap here is a UNITS disagreement, not necessarily an arithmetic one — which is why the gap is printed with both conventions named rather than silently rescaled." };
  }

  /* the options desk's Black-Scholes against this layer's, on the textbook case */
  function xcOptions() {
    var o = layer("DLOPT");
    var inp = { S: 100, K: 100, r: 0.05, q: 0, sigma: 0.2, T: 1 };
    var mine = bsSteps("call", inp).v;
    if (!o || typeof o.call !== "function") return { title: "Black-Scholes call — options desk vs this layer", state: "absent", a: mine, b: null, delta: null,
      note: "DLOPT is not in this build, so this layer's price stands alone and is cross-checked only by its own integral. Named here rather than skipped." };
    var theirs = optPrice("call", inp);
    if (theirs == null) return { title: "Black-Scholes call — options desk vs this layer", state: "no data", a: mine, b: null, delta: null,
      note: "DLOPT is in this build but did not return a finite price on its published bs(S,K,T,r,q,v) signature for the textbook case." };
    return { title: "Black-Scholes call — options desk vs this layer (S=K=100, r=5%, σ=20%, T=1)", state: "both",
      aLabel: "this layer", bLabel: "DLOPT", a: mine, b: theirs, delta: mine - theirs,
      note: "Two pricers on the published textbook case, whose call price is 10.4506. Both use a Hart-style normal CDF, so agreement here is weaker evidence than the integral check on the Check tab — it rules out a coding error, not a shared approximation error." };
  }

  /* the inverse normal, three ways: this layer, the risk desk, and the table */
  function xcInvNorm() {
    var r = layer("DLRISK");
    var mine95 = ninv(0.95), mine99 = ninv(0.99);
    var TABLE95 = 1.6448536269514722, TABLE99 = 2.3263478740408408;
    if (!r || typeof r.invNorm !== "function") return { title: "Inverse normal Φ⁻¹(0.95) — risk desk vs this layer vs the table", state: "absent",
      a: mine95, b: null, delta: mine95 - TABLE95,
      note: "DLRISK is not in this build. This layer gets " + mine95 + " against the published table value " + TABLE95 + "; the third opinion is missing and is named rather than skipped." };
    var t95 = null;
    try { var v = r.invNorm(0.95); t95 = typeof v === "number" && isFinite(v) ? v : null; } catch (e) { t95 = null; }
    if (t95 == null) return { title: "Inverse normal Φ⁻¹(0.95) — risk desk vs this layer vs the table", state: "no data", a: mine95, b: null, delta: null, note: "DLRISK.invNorm did not return a finite number." };
    return { title: "Inverse normal Φ⁻¹(0.95) — risk desk vs this layer (table: " + TABLE95 + ")", state: "both",
      aLabel: "this layer (Acklam + one Halley step)", bLabel: "DLRISK.invNorm", a: mine95, b: t95, delta: mine95 - t95,
      note: "One primitive, two desks, and a published table value to hold both to. This layer refines Acklam's approximation once against its own CDF, which is why it lands on the table value to the last digit; a raw Acklam is good to about 1.15e-9 and a gap of that size here is the approximation, not a bug. Φ⁻¹(0.99): this layer " + mine99 + ", table " + TABLE99 + "." };
  }

  /* why the lending desk's health factor is NOT compared numerically */
  function xcLendThresholds() {
    var l = layer("DLLEND");
    return { title: "Health factor — lending desk vs this layer", state: "absent", a: null, b: null, delta: null,
      note: l
        ? "DLLEND is in this build (v" + l.__v + ") and computes a health factor, but it resolves each asset's liquidation threshold from its OWN reserve table rather than taking one as an argument. Feeding it the hand-entered thresholds on the Check tab would produce a disagreement about parameters rather than about arithmetic, so no number is compared here. The two agree on the DEFINITION — threshold-weighted collateral over debt — and that is what the Check tab verifies twice."
        : "DLLEND is not in this build, so there is no second health factor to compare against. This layer's own two implementations still check each other on the Check tab." };
  }

  /* ==========================================================================
     EXPORT
     ========================================================================== */

  function csvCell(v) {
    var s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCSV() {
    var head = ["formula_id", "label", "group", "case_id", "inputs_json", "expected", "tolerance", "unit", "formula", "spreadsheet_formula", "citation", "source"];
    var lines = [head.join(",")], i, j, e, c;
    for (i = 0; i < ORDER.length; i++) {
      e = REG[ORDER[i]];
      if (!e.reference || !e.reference.length) {
        lines.push([e.id, e.label, e.group, "", "", "", "", e.unit, e.formula, e.sheet, "(no reference case)", e.source].map(csvCell).join(","));
        continue;
      }
      for (j = 0; j < e.reference.length; j++) {
        c = e.reference[j];
        lines.push([e.id, e.label, e.group, c.id, jsonOf(c["in"]), c.expect, c.tol, e.unit, e.formula, e.sheet, c.cite, e.source].map(csvCell).join(","));
      }
    }
    return lines.join("\n");
  }

  function jsonOf(v) { try { return JSON.stringify(v); } catch (e) { return ""; } }

  function toJSON() {
    var out = { build: 166, desk: "verify", generated: null, note:
      "Inputs, expected outputs and the formula text for every figure the DexLadder Verify desk registers. Redo the arithmetic wherever you like: nothing here depends on this app. 'spreadsheet' is the same expression in spreadsheet notation. 'citation' names where the formula comes from; values marked PUBLISHED are quoted from that source, the rest are derived from it.",
      formulas: [] };
    try { out.generated = new Date(C.now ? C.now() : 0).toISOString(); } catch (e) { out.generated = null; }
    var i, j, e, c, f;
    for (i = 0; i < ORDER.length; i++) {
      e = REG[ORDER[i]];
      f = { id: e.id, label: e.label, group: e.group, unit: e.unit, formula: e.formula, spreadsheet: e.sheet, source: e.source, owner: e.owner, inputs: e.inputs, cases: [] };
      for (j = 0; j < (e.reference || []).length; j++) {
        c = e.reference[j];
        f.cases.push({ id: c.id, inputs: c["in"], expected: c.expect, tolerance: c.tol, citation: c.cite });
      }
      out.formulas.push(f);
    }
    return JSON.stringify(out, null, 1);
  }

  function download(name, text, mime) {
    try {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: mime || "text/plain" }));
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { try { URL.revokeObjectURL(a.href); a.parentNode.removeChild(a); } catch (e) {} }, 800);
      return true;
    } catch (e) {
      try { C.toast && C.toast("bad", "Download blocked", "Your browser refused the download. The Export tab prints the same text — select it and copy."); } catch (x) {}
      return false;
    }
  }

  /* ==========================================================================
     STATE (v154 bucket, namespaced — no storage key of its own)
     ========================================================================== */

  function ST(o) {
    var x = C.X();
    if (!x.verify) x.verify = { id: "amm.cp.out", caseId: null, inputs: null };
    if (o) {
      var k;
      for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) x.verify[k] = o[k];
      try { C.save(); } catch (e) {}
    }
    return x.verify;
  }

  function currentCase() {
    var s = ST(), e = get(s.id) || REG[ORDER[0]];
    if (!e) return null;
    var refs = e.reference || [], i, c = refs.length ? refs[0] : null;
    for (i = 0; i < refs.length; i++) if (refs[i].id === s.caseId) c = refs[i];
    return { entry: e, ref: c };
  }
  function currentInputs() {
    var s = ST(), cc = currentCase();
    if (!cc) return {};
    if (s.inputs && s.id === cc.entry.id) return s.inputs;
    return cc.ref ? cloneIn(cc.ref["in"]) : {};
  }
  function cloneIn(o) {
    var out = {}, k;
    for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k];
    return out;
  }

  /* ==========================================================================
     THE UI
     ========================================================================== */

  function esc(s) {
    try { return C.esc ? C.esc(String(s == null ? "" : s)) : String(s == null ? "" : s).replace(/[&<>"]/g, ""); }
    catch (e) { return ""; }
  }

  function fmt(v, unit) {
    if (v == null || !isFinite(v)) return "—";
    var a = Math.abs(v), s;
    if (a === 0) s = "0";
    else if (a >= 1e12 || a < 1e-7) s = v.toExponential(10);
    else if (a >= 1000) s = v.toFixed(6).replace(/\.?0+$/, "");
    else s = v.toPrecision(12).replace(/\.?0+$/, "").replace(/(\.\d*?)0+e/, "$1e");
    return s + (unit ? " " + unit : "");
  }
  function fmtDelta(v) {
    if (v == null || !isFinite(v)) return "—";
    if (v === 0) return "0 (exact)";
    var a = Math.abs(v);
    return (v > 0 ? "+" : "−") + (a < 1e-4 || a >= 1e7 ? a.toExponential(3) : a.toPrecision(6));
  }
  function stamp() {
    try { return new Date(C.now ? C.now() : 0).toISOString().replace("T", " ").slice(0, 19) + "Z"; } catch (e) { return "—"; }
  }

  function banner() {
    return '<div class="v-banner"><b>This desk never trades and never writes a balance.</b> It reads numbers and recomputes them. It places no order, holds no position, sends nothing anywhere and has no network path of its own. Feed and storage health are the Health desk; the model card and the laws are Trust. This one only checks arithmetic.</div>';
  }

  function bodyFor(tab, body) {
    if (!body) return;
    var h;
    if (tab === "registry") h = paneRegistry();
    else if (tab === "selftest") h = paneSelfTest();
    else if (tab === "crosscheck") h = paneCross();
    else if (tab === "export") h = paneExport();
    else if (tab === "method") h = paneMethod();
    else h = paneCheck();
    body.innerHTML = h;
  }

  /* ------------------------------------------------------------ Check tab */

  function paneCheck() {
    var cc = currentCase();
    if (!cc) return banner() + '<div class="v-empty">Nothing is registered. That is itself a failure — this layer seeds its own registry at load.</div>';
    var e = cc.entry, ins = currentInputs(), r = check(e.id, ins), i, h = banner();

    h += '<div class="v-form"><label class="v-f"><span class="v-fl">Formula</span><select id="vSel" class="dl-inp" aria-label="Formula to check">' + optsForSelect(e.id) + '</select></label>';
    if ((e.reference || []).length > 1) {
      h += '<label class="v-f"><span class="v-fl">Reference case</span><select id="vCase" class="dl-inp" aria-label="Reference case">' + caseOpts(e, cc.ref) + '</select></label>';
    }
    h += '</div>';

    h += '<div class="v-head"><span class="v-title">' + esc(e.label) + '</span><span class="v-pill">' + esc(e.group) + '</span><span class="v-pill">owner: ' + esc(e.owner) + '</span></div>';

    h += '<div class="v-sub">Formula, in plain notation</div><div class="dl-formula v-formula">' + esc(e.formula) + '</div>';
    if (e.sheet) h += '<div class="v-sheet"><span class="v-fl">Spreadsheet form</span><code>' + esc(e.sheet) + '</code></div>';

    h += '<div class="v-sub">Inputs, with where each one came from</div><div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Input</th><th>Value</th><th>Unit</th><th>Where it comes from</th><th>Read at</th></tr></thead><tbody>';
    for (i = 0; i < e.inputs.length; i++) {
      var nm = e.inputs[i].name, val = ins[nm];
      h += '<tr><td class="v-n">' + esc(nm) + '</td>' +
        '<td><input class="dl-inp v-in" data-k="' + esc(nm) + '" value="' + esc(inStr(val)) + '" aria-label="' + esc(nm) + '"></td>' +
        '<td>' + esc(e.inputs[i].unit || "") + '</td>' +
        '<td class="v-prov">' + esc(e.inputs[i].source || "") + '</td>' +
        '<td class="v-age">' + esc(prov(e, cc.ref, nm, ins)) + '</td></tr>';
    }
    h += '</tbody></table></div>';
    h += '<div class="v-actions"><button class="dl-b pri" id="vRun">Recompute</button><button class="dl-b" id="vReset">Back to the reference case</button></div>';

    h += '<div class="v-sub">The working, line by line</div>';
    if (!r.steps.length) h += '<div class="v-empty">' + esc(r.note || "This input set produced no working — a missing figure stays missing here.") + '</div>';
    else {
      h += '<ol class="v-steps">';
      for (i = 0; i < r.steps.length; i++) {
        h += '<li class="v-step"><span class="v-sn">' + r.steps[i].n + '</span><span class="v-st">' + esc(r.steps[i].t) + '</span><span class="v-sv">' + esc(fmt(r.steps[i].v, r.steps[i].u)) + '</span></li>';
      }
      h += '</ol>';
    }
    if (r.note) h += '<div class="v-warn">' + esc(r.note) + '</div>';

    h += '<div class="v-sub">Two implementations, and the gap between them</div>';
    h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Path</th><th class="r">Answer</th><th>What it does</th></tr></thead><tbody>';
    h += '<tr><td class="v-n">A · the formula as written</td><td class="r v-num">' + esc(fmt(r.a, e.unit)) + '</td><td>reads the notation left to right and prints every intermediate above</td></tr>';
    h += '<tr><td class="v-n">B · independent route</td><td class="r v-num">' + esc(fmt(r.b, e.unit)) + '</td><td>' + esc(altNote(e.id)) + '</td></tr>';
    if (r.engine != null) h += '<tr><td class="v-n">C · the app elsewhere</td><td class="r v-num">' + esc(fmt(r.engine, e.unit)) + '</td><td>the same figure as another surface in this build computes it</td></tr>';
    h += '</tbody></table></div>';

    var agree = r.deltaAB != null && Math.abs(r.deltaAB) <= 1e-9;
    if (r.b == null) h += '<div class="v-warn">The independent implementation returned nothing for these inputs, so nothing has been checked. That is not a pass.</div>';
    else if (agree) h += '<div class="v-ok"><b>A and B agree.</b> Delta ' + esc(fmtDelta(r.deltaAB)) + '. Two different derivations landed on the same number.</div>';
    else h += '<div class="v-bad"><b>A and B DISAGREE by ' + esc(fmtDelta(r.deltaAB)) + '.</b> One of the two implementations in this layer is wrong, or these inputs sit somewhere the formula does not hold. This desk does not pick a winner: a number the app cannot re-derive two ways is a number it should not be showing.</div>';
    if (r.engine != null && r.a != null && Math.abs(r.deltaEngine) > 1e-9) {
      h += '<div class="v-warn"><b>The rest of the app disagrees too</b> — by ' + esc(fmtDelta(r.deltaEngine)) + '. Printed, not reconciled. See the Cross-check tab.</div>';
    }
    if (r.aError) h += '<div class="v-bad">Implementation A threw: ' + esc(r.aError) + '</div>';
    if (r.bError) h += '<div class="v-bad">Implementation B threw: ' + esc(r.bError) + '</div>';

    if (cc.ref) {
      h += '<div class="v-sub">The pinned reference case</div><div class="v-cite"><b>Expected ' + esc(fmt(cc.ref.expect, e.unit)) + '</b> to within ' + esc(String(cc.ref.tol)) + '. <span class="v-src">' + esc(cc.ref.cite) + '</span></div>';
    }
    h += '<div class="v-cite"><b>Where the formula comes from.</b> <span class="v-src">' + esc(e.source) + '</span></div>';
    return h;
  }

  function inStr(v) {
    if (v == null) return "";
    if (Object.prototype.toString.call(v) !== "[object Array]") return String(v);
    if (!v.length) return "";
    if (Object.prototype.toString.call(v[0]) === "[object Array]") {
      var out = [], i;
      for (i = 0; i < v.length; i++) out.push(v[i][0] + "@" + v[i][1]);
      return out.join("; ");
    }
    return v.join(", ");
  }

  function altNote(id) {
    var m = {
      "amm.cp.out": "holds the invariant k = rx·ry and subtracts k/rx′ — never forms ax·ry/(rx+ax)",
      "amm.cp.impact": "the collapsed closed form, in which the reserves cancel out of the ratio entirely",
      "v3.amount0": "solves the virtual-reserve invariant (x + L/√Pb)(y + L√Pa) = L² for x",
      "v3.amount1": "solves the same invariant for y, starting from x",
      "il.divergence": "no closed form at all — builds the position, moves the price, values both sides",
      "il.breakeven": "expresses the shortfall against the REMAINING value and annualises through logs",
      "perp.mm": "sums the marginal rate over each bracket the notional passes through — never reads the maintenance-amount column",
      "perp.liq": "bisects on equity minus maintenance margin — no bracket algebra on this path at all",
      "perp.funding": "converts to an annual rate and back, so a units bug in either direction shows up",
      "risk.sharpe": "one-pass variance from Σx and Σx² instead of the two-pass sum of squared deviations",
      "risk.maxdd": "an all-pairs scan with no running peak to get wrong",
      "risk.var.hist": "sorts the other way and counts in from the top, mirroring the rank arithmetic",
      "risk.var.param": "bisects the normal CDF for z instead of calling the inverse approximation",
      "opt.bs.call": "numerically integrates the discounted payoff under the lognormal density — no normal CDF anywhere",
      "opt.bs.put": "numerically integrates the discounted payoff — no normal CDF anywhere",
      "opt.bs.parity": "the same identity, both legs priced by the integral instead of the CDF",
      "lend.hf": "aggregates first, then applies one value-weighted average threshold",
      "book.walk": "prefix sums plus a binary search for the boundary level — no drain loop",
      "tax.fifo": "integrates cost over the consumed interval of the cumulative-quantity axis",
      "tax.hifo": "same interval integration, after the descending sort"
    };
    return m[id] || "a second implementation written separately in this layer";
  }

  function prov(e, ref, name, ins) {
    var s = ST();
    if (s.inputs && s.id === e.id && s.inputs[name] != null) return "you typed it · " + stamp();
    if (ref) return "pinned reference case " + ref.id;
    return "default";
  }

  function optsForSelect(cur) {
    var h = "", i, e, g = "";
    for (i = 0; i < ORDER.length; i++) {
      e = REG[ORDER[i]];
      if (e.group !== g) { if (g) h += "</optgroup>"; h += '<optgroup label="' + esc(e.group) + '">'; g = e.group; }
      h += '<option value="' + esc(e.id) + '"' + (e.id === cur ? " selected" : "") + ">" + esc(e.label) + "</option>";
    }
    if (g) h += "</optgroup>";
    return h;
  }
  function caseOpts(e, cur) {
    var h = "", i, refs = e.reference || [];
    for (i = 0; i < refs.length; i++) h += '<option value="' + esc(refs[i].id) + '"' + (cur && refs[i].id === cur.id ? " selected" : "") + ">" + esc(refs[i].id + " — expects " + fmt(refs[i].expect)) + "</option>";
    return h;
  }

  /* --------------------------------------------------------- Registry tab */

  function paneRegistry() {
    var h = banner();
    h += '<div class="v-note">Every formula the app can be asked to prove. Other layers may add their own with <code>DLVERIFY.register()</code>; this layer seeds the list below. A formula with no reference case is a formula nobody has pinned an answer to, and the gate refuses a build that ships one.</div>';
    h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Formula</th><th>Group</th><th>Notation</th><th class="r">Cases</th><th>Source</th></tr></thead><tbody>';
    var i, e;
    for (i = 0; i < ORDER.length; i++) {
      e = REG[ORDER[i]];
      h += '<tr><td class="v-n">' + esc(e.label) + '<span class="v-id">' + esc(e.id) + '</span></td>' +
        '<td>' + esc(e.group) + '</td>' +
        '<td class="v-formula-cell">' + esc(e.formula) + '</td>' +
        '<td class="r">' + ((e.reference || []).length || '<span class="v-badflag">none</span>') + '</td>' +
        '<td class="v-src">' + esc(e.source) + '</td></tr>';
    }
    h += '</tbody></table></div>';

    h += '<div class="v-sub">Layers this desk cross-checks against</div><div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Layer</th><th>What it is</th><th>In this build</th><th>What it is used for here</th></tr></thead><tbody>';
    var nb = neighbours(), j;
    for (j = 0; j < nb.length; j++) {
      h += '<tr><td class="v-n">' + esc(nb[j].key) + '</td><td>' + esc(nb[j].name) + '</td>' +
        '<td>' + (nb[j].present ? '<span class="v-yes">yes · v' + esc(nb[j].build) + '</span>' : '<span class="v-no">not in this build</span>') + '</td>' +
        '<td>' + esc(nb[j].why) + '</td></tr>';
    }
    h += '</tbody></table></div>';
    h += '<div class="v-note">A layer that is not in this build degrades to the row above and to a named empty row on the Cross-check tab. It is never an error and it is never skipped quietly, because a cross-check that silently does not run reads exactly like a cross-check that passed.</div>';
    return h;
  }

  /* -------------------------------------------------------- Self-test tab */

  function paneSelfTest() {
    var t = selfTest(), h = banner(), i, r;
    h += '<div class="' + (t.failed ? "v-bad" : "v-ok") + '"><b>' + t.passed + ' passed · ' + t.failed + ' failed</b> across ' + t.total + ' pinned reference cases in ' + ORDER.length + ' formulas. Run at ' + esc(stamp()) + '.' +
      (t.failed ? ' A failure here means this build is printing a number it cannot re-derive. Do not trust the desk that shows it.' : ' Every registered formula reproduced its pinned value, and its independent implementation agreed.') + '</div>';
    if (t.withoutReference.length) h += '<div class="v-warn">Registered with no reference case, so nothing was checked: ' + esc(t.withoutReference.join(", ")) + '. The release gate fails on this.</div>';
    h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Case</th><th>Formula</th><th class="r">Expected</th><th class="r">A</th><th class="r">Δ vs expected</th><th class="r">B</th><th class="r">Δ A−B</th><th>Result</th></tr></thead><tbody>';
    for (i = 0; i < t.rows.length; i++) {
      r = t.rows[i];
      h += '<tr' + (r.pass ? "" : ' data-fail="1"') + '><td class="v-n">' + esc(r.caseId) + '</td>' +
        '<td>' + esc(r.label) + '</td>' +
        '<td class="r v-num">' + esc(fmt(r.expect)) + '</td>' +
        '<td class="r v-num">' + esc(fmt(r.got)) + '</td>' +
        '<td class="r v-num">' + esc(fmtDelta(r.deltaExpect)) + '</td>' +
        '<td class="r v-num">' + esc(fmt(r.alt)) + '</td>' +
        '<td class="r v-num">' + esc(fmtDelta(r.deltaAB)) + '</td>' +
        '<td>' + (r.pass ? '<span class="v-yes">pass</span>' : '<span class="v-no">FAIL</span>') + '</td></tr>';
    }
    h += '</tbody></table></div>';
    h += '<div class="v-sub">Where each expected value comes from</div><ul class="v-cites">';
    for (i = 0; i < t.rows.length; i++) h += '<li><b>' + esc(t.rows[i].caseId) + '</b> — ' + esc(t.rows[i].cite) + '</li>';
    h += '</ul>';
    h += '<div class="v-note">Cases whose citation begins PUBLISHED carry a value quoted from the source named; the rest carry a value derived from the formula that source states. The release gate runs these same cases out of the shipped payload with a third implementation written inside the gate, so passing here and passing there are two different facts.</div>';
    return h;
  }

  /* ------------------------------------------------------- Cross-check tab */

  function paneCross() {
    var rows = crossChecks(), h = banner(), i, r;
    h += '<div class="v-note">Where two surfaces in this app compute the same thing by different routes, both are asked and the disagreement is printed. This desk reports the gap. It does not pick a winner — a desk that silently reconciles two disagreeing numbers is how the disagreement stops being visible.</div>';
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      h += '<div class="v-xc"><div class="v-xt">' + esc(r.title) + '</div>';
      if (r.state === "both") {
        h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Path</th><th class="r">Figure</th></tr></thead><tbody>' +
          '<tr><td class="v-n">' + esc(r.aLabel) + '</td><td class="r v-num">' + esc(fmt(r.a)) + '</td></tr>' +
          '<tr><td class="v-n">' + esc(r.bLabel) + '</td><td class="r v-num">' + esc(fmt(r.b)) + '</td></tr>' +
          '<tr><td class="v-n">disagreement</td><td class="r v-num">' + esc(fmtDelta(r.delta)) + '</td></tr>' +
          '</tbody></table></div>';
      } else {
        h += '<div class="v-empty">' + esc(r.state === "absent" ? "not in this build" : "no data to compare") + '</div>';
      }
      h += '<div class="v-xn">' + esc(r.note) + '</div></div>';
    }
    return h;
  }

  /* ----------------------------------------------------------- Export tab */

  function paneExport() {
    var h = banner();
    h += '<div class="v-note">Everything this desk knows, in two formats that do not need this app. Open the CSV in a spreadsheet, type the formula in the <code>spreadsheet_formula</code> column yourself, and check the <code>expected</code> column against your own arithmetic. If your spreadsheet disagrees with this app, the app is what is wrong.</div>';
    h += '<div class="v-actions"><button class="dl-b pri" id="vCsv">Download CSV</button><button class="dl-b" id="vJson">Download JSON</button></div>';
    h += '<div class="v-sub">What is in the export</div><div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Column</th><th>What it holds</th></tr></thead><tbody>' +
      '<tr><td class="v-n">formula_id · label · group</td><td>which registered formula the row belongs to</td></tr>' +
      '<tr><td class="v-n">case_id · inputs_json</td><td>the pinned reference case and its exact inputs, as JSON</td></tr>' +
      '<tr><td class="v-n">expected · tolerance</td><td>the answer this app claims, and how close is close enough</td></tr>' +
      '<tr><td class="v-n">formula</td><td>the formula in plain notation, the same text the Check tab shows</td></tr>' +
      '<tr><td class="v-n">spreadsheet_formula</td><td>the same expression in spreadsheet notation, ready to paste</td></tr>' +
      '<tr><td class="v-n">citation · source</td><td>where the value and the formula come from</td></tr>' +
      '</tbody></table></div>';
    h += '<div class="v-sub">The first rows, so you can see the shape before you download</div><pre class="v-pre">' + esc(toCSV().split("\n").slice(0, 8).join("\n")) + '\n…</pre>';
    h += '<div class="v-note">Nothing is sent anywhere. Both files are built in this page and handed to your browser\'s download. This layer has no network path of its own.</div>';
    return h;
  }

  /* ----------------------------------------------------------- Method tab */

  function paneMethod() {
    var h = banner(), i;
    h += '<div class="v-note">Everything this desk does, in plain language. If a number here cannot be traced to one of these paragraphs, it should not be on the screen.</div>';
    h += '<div class="v-method">';
    for (i = 0; i < METHOD.length; i++) h += '<div class="v-mrow"><b>' + esc(METHOD[i][0]) + '</b><span>' + esc(METHOD[i][1]) + '</span></div>';
    h += '</div>';
    h += '<div class="v-sub">What is assumed, and what is measured</div><ul class="v-assume">';
    for (i = 0; i < ASSUMPTIONS.length; i++) h += '<li>' + esc(ASSUMPTIONS[i]) + '</li>';
    h += '</ul>';
    h += '<div class="v-sub">What this desk deliberately does not do</div><ul class="v-assume">' +
      '<li>It does not report feed health, storage health or build identity. That is the Health desk (layer 50), and duplicating it here would give you two answers to one question.</li>' +
      '<li>It does not restate the model card, the privacy modes or the laws. That is Trust (layer 41).</li>' +
      '<li>It does not verify data provenance beyond naming it. It can prove the arithmetic was applied correctly to the inputs; it cannot prove the inputs describe a real market.</li>' +
      '<li>It does not trade, hold a position, sign anything or write a balance — and it has no code path that could.</li>' +
      '</ul>';
    return h;
  }

  /* ------------------------------------------------------------- wiring */

  function readInputs() {
    var nodes = document.querySelectorAll("#dlVerify .v-in"), out = {}, i, k, raw;
    for (i = 0; i < nodes.length; i++) {
      k = nodes[i].getAttribute("data-k");
      raw = String(nodes[i].value == null ? "" : nodes[i].value);
      out[k] = raw;
    }
    return out;
  }

  function onChange(ev) {
    var t = ev.target;
    if (!t || !t.id) return;
    if (t.id === "vSel") { ST({ id: t.value, caseId: null, inputs: null }); open("check"); return; }
    if (t.id === "vCase") { ST({ caseId: t.value, inputs: null }); open("check"); return; }
  }

  function onClick(ev) {
    var t = ev.target;
    if (!t || !t.id) return;
    if (t.id === "vRun") { ST({ inputs: readInputs() }); open("check"); return; }
    if (t.id === "vReset") { ST({ inputs: null }); open("check"); return; }
    if (t.id === "vCsv") { download("dexladder-verify-" + stamp().slice(0, 10) + ".csv", toCSV(), "text/csv"); return; }
    if (t.id === "vJson") { download("dexladder-verify-" + stamp().slice(0, 10) + ".json", toJSON(), "application/json"); return; }
  }

  var wired = false;
  function wire(el) {
    if (!el || wired) return;
    el.addEventListener("click", onClick);
    el.addEventListener("change", onChange);
    wired = true;
    el.__onClose = function () {
      try { el.removeEventListener("click", onClick); el.removeEventListener("change", onChange); } catch (e) {}
      wired = false;
    };
  }

  function open(tab) {
    var el = null;
    try {
      el = C.open("dlVerify", {
        title: "✓ Verify",
        sub: "Any number in this app, taken apart — inputs, formula, the working, and a second implementation that disagrees out loud",
        tabs: [["check", "Check"], ["registry", "Registry"], ["selftest", "Self-test"], ["crosscheck", "Cross-check"], ["export", "Export"], ["method", "Method"]],
        onTab: bodyFor
      }, tab || "check");
    } catch (e) { el = null; }
    try { wire(el || document.getElementById("dlVerify")); } catch (e) {}
    return el;
  }

  /* ------------------------------------------------------------- seed it */
  try { seed(); } catch (e) {}

  try { if (window.DLDESKS && window.DLDESKS.register) window.DLDESKS.register("verify", "✓", "Verify", "Take any number in the app apart — inputs, formula, the working, and a second implementation", function () { open("check"); }); } catch (e) {}
  try { C.cmd && C.cmd("verify", "Verify — check any figure in this app, step by step", "✓", function () { open("check"); }); } catch (e) {}
  try { C.cmd && C.cmd("self-test", "Verify — run every formula against its pinned reference values", "✓", function () { open("selftest"); }); } catch (e) {}

  window.DLVERIFY = {
    __v: 166,
    open: open,
    register: register,
    get: get,
    list: list,
    ids: ids,
    check: check,
    selfTest: selfTest,
    crossChecks: crossChecks,
    neighbours: neighbours,
    toCSV: toCSV,
    toJSON: toJSON,
    REFCASES: REFCASES,
    MM_LADDER: MM_LADDER,
    ncdf: ncdf,
    ninv: ninv,
    METHOD: METHOD,
    ASSUMPTIONS: ASSUMPTIONS
  };
})();
