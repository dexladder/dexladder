// owns: options valuation, volatility and strategy desk
// reads: DLAPP, DLCORE, DLDESKS, S paper state, browser DOM
// emits: DLOPT
/* ============================================================================
   DexLadder — DLOPT · layer 56 · v166 "the surface"
   OPTIONS: Black-Scholes-Merton, implied vol, an SVI surface that is CHECKED
   for arbitrage, a CRR binomial for early exercise, and a strategy builder.

   The question this desk exists to answer: what is a strike actually worth,
   what vol is the price telling you, and does the surface you just fitted
   admit a free lunch?

   There is NO options venue feed in this app. Nothing here is a quote. The
   chain is GENERATED from the app's own spot price and a realised-vol-anchored
   SVI surface whose five parameters are printed on the Surface tab, so every
   price on the Chain tab can be traced back to a number you can see and change.
   r and q are INPUTS you type, not measurements.

   LAWS OBSERVED
     · pricing is pure — bs(), iv(), sviW(), crr(), payoff() read no clock, no
       balance, no storage, and draw no random number. Same inputs, same digits
     · deterministic — the SVI fitter restarts from a van der Corput sequence
       offset by an FNV-1a hash of its own inputs, and never the platform's
       random number generator
     · a missing figure stays missing — a price outside the no-arbitrage band
       has NO implied vol, and iv() returns null with a reason, not a number
     · an arbitrage that the fit admits is PRINTED, not hidden: Durrleman's
       butterfly g(k) and calendar monotonicity are reported pass or fail
     · unbounded is the word "unbounded", never a large number wearing its coat
     · money moves only through the engine — execFill / chargeNetwork. This
       layer never assigns to a balance
     · no storage key of its own — state is the v154 bucket via DLCORE.X()
     · nothing is compiled at runtime; the only timer is the core's shared tick
     · Day + Night — every rule lives in _v166css/56-options.css, paired
   ============================================================================ */
(function () {
  "use strict";
  if (window.DLOPT && window.DLOPT.__v) return;

  var C = window.DLCORE;
  if (!C) return;

  function P() { try { return window.DLAPP && window.DLAPP.paper; } catch (e) { return null; } }
  function LP() { try { return window.DLAPP && window.DLAPP.legacy && window.DLAPP.legacy.paper; } catch (e) { return null; } }

  /* ========================================================================
     1 · THE NORMAL LAW

     Hart's 1968 rational/continued-fraction algorithm for the standard normal
     CDF, in the arrangement Graeme West published ("Better approximations to
     cumulative normal functions", Wilmott, May 2005).

     ACCURACY, MEASURED rather than quoted — this exact code compared against
     0.5*erfc(-x/sqrt(2)) in double precision on a 0.01 grid over [-40, 40]:

         max ABSOLUTE error   1.67e-16     (about one ulp of 0.5)
         max RELATIVE error   4.2e-16  for |x| <= 1
                              1.4e-14  for |x| <= 3
                              4.6e-11  for |x| <= 5
                              2.9e-9   at the branch join, x = -7.07, where the
                                       value is 7.7e-13 so the absolute error
                                       there is about 2e-21
         below x = -37 it returns exactly 0: N(-37) is 5.7e-300 and nothing a
         price can carry survives down there.

     The absolute bound is the one that matters, because it is an absolute CDF
     error that propagates into an absolute price error.

     Why not Abramowitz & Stegun 7.1.26 (the five-term t = 1/(1+0.2316419x)
     polynomial every options tutorial copies)? Its stated maximum absolute
     error is 7.5e-8. Two things break at that accuracy:

       (a) Newton on implied vol divides a PRICE error by vega. A CDF error of
           7.5e-8 turns into a price error of order S * 7.5e-8 (the call price
           carries N(d1) multiplied by S), so on a $100 underlying that is
           7.5e-6 of price. Divide by vega: for a 30-day at-the-money option
           vega is about 0.11 per vol point, so the noise floor on the implied
           vol is ~7e-5 of a vol point; for a 1-day wing where vega falls to
           1e-3 per point, the same price error is 7e-3 of a vol point, and for
           a deep wing where vega is 1e-5 it is whole vol points. You cannot
           converge an implied vol to 1e-8 with a price function that is only
           right to 1e-7 — the iteration stops on noise.
       (b) 7.1.26's error is a POLYNOMIAL RIPPLE, not a smooth bias: it wiggles
           with x. Its derivative therefore disagrees with the true density by
           orders more than its value disagrees with the true CDF, so the
           analytic vega and the finite-difference vega of the SAME pricer stop
           matching, and a Newton step built from one and measured on the other
           can cycle instead of converging. Hart has no such ripple.
     ======================================================================== */

  var SQRT2PI = 2.5066282746310002;

  function npdf(x) {
    if (!isFinite(x)) return 0;
    return Math.exp(-0.5 * x * x) / SQRT2PI;
  }

  function ncdf(x) {
    if (x !== x) return null;                       /* NaN in, missing out */
    var y = Math.abs(x), e, b, c;
    if (y > 37) {
      c = 0;                                        /* underflows a double */
    } else {
      e = Math.exp(-0.5 * y * y);
      if (y < 7.07106781186547) {                   /* Hart's rational branch */
        b = 3.52624965998911e-02 * y + 0.700383064443688;
        b = b * y + 6.37396220353165;
        b = b * y + 33.912866078383;
        b = b * y + 112.079291497871;
        b = b * y + 221.213596169931;
        b = b * y + 220.206867912376;
        c = e * b;
        b = 8.83883476483184e-02 * y + 1.75566716318264;
        b = b * y + 16.064177579207;
        b = b * y + 86.7807322029461;
        b = b * y + 296.564248779674;
        b = b * y + 637.333633378831;
        b = b * y + 793.826512519948;
        b = b * y + 440.413735824752;
        c = c / b;
      } else {                                      /* continued fraction tail */
        b = y + 0.65;
        b = y + 4 / b;
        b = y + 3 / b;
        b = y + 2 / b;
        b = y + 1 / b;
        c = e / (b * SQRT2PI);
      }
    }
    return x > 0 ? 1 - c : c;
  }

  /* ========================================================================
     2 · BLACK-SCHOLES-MERTON with a continuous carry q

       F  = S e^((r-q)T)
       d1 = ( ln(S/K) + (r - q + v^2/2) T ) / (v sqrt(T)),   d2 = d1 - v sqrt(T)
       call = S e^(-qT) N(d1) - K e^(-rT) N(d2)
       put  = K e^(-rT) N(-d2) - S e^(-qT) N(-d1)

     Merton (1973) "Theory of Rational Option Pricing", section 4, is the carry
     form; Black-Scholes (1973) is the q = 0 case. q is a CONTINUOUS yield: a
     staking or funding rate you type in, not a measured one.

     Greeks are analytic, not bumped. vega is per 1.00 of vol (a move from 60%
     to 160%); vegaPt divides by 100 and is what the desk prints. theta is per
     YEAR; thetaDay is theta / 365 and both are labelled everywhere they appear.
     vanna = d(delta)/d(vol) = -e^(-qT) n(d1) d2 / v.
     volga = d(vega)/d(vol) = vega * d1 d2 / v.
     ======================================================================== */

  var TINY = 1e-12;

  /* The deterministic corner: with no time or no vol left there is no
     distribution, only the discounted forward intrinsic. Curvature there is
     either exactly zero or a kink with no finite value — and a kink returns
     null, because a missing figure stays missing. */
  function degenerate(S, K, T, r, q, isCall) {
    var dfR = Math.exp(-r * Math.max(0, T)), dfQ = Math.exp(-q * Math.max(0, T));
    var F = S * dfQ / dfR;                          /* forward, in spot units */
    var itm = isCall ? F > K : F < K;
    var atk = Math.abs(F - K) <= Math.abs(K) * 1e-14;
    var px = dfR * Math.max(0, isCall ? F - K : K - F);
    return {
      price: px, d1: null, d2: null,
      delta: atk ? null : (isCall ? (itm ? dfQ : 0) : (itm ? -dfQ : 0)),
      gamma: atk ? null : 0, vega: atk ? null : 0, vegaPt: atk ? null : 0,
      theta: 0, thetaDay: 0, rho: 0, vanna: atk ? null : 0, volga: atk ? null : 0,
      degenerate: true
    };
  }

  function bs(S, K, T, r, q, v, isCall) {
    S = +S; K = +K; T = +T; r = +r; q = +q; v = +v;
    if (!(S > 0) || !(K > 0) || !isFinite(r) || !isFinite(q)) return null;
    if (!(T > TINY) || !(v > TINY)) return degenerate(S, K, Math.max(0, T), r, q, !!isCall);

    var sq = Math.sqrt(T), vs = v * sq;
    var dfQ = Math.exp(-q * T), dfR = Math.exp(-r * T);
    var d1 = (Math.log(S / K) + (r - q + 0.5 * v * v) * T) / vs;
    var d2 = d1 - vs;
    var nd1 = npdf(d1);
    var Nd1 = ncdf(d1), Nd2 = ncdf(d2), Nn1 = ncdf(-d1), Nn2 = ncdf(-d2);
    var price = isCall ? (S * dfQ * Nd1 - K * dfR * Nd2) : (K * dfR * Nn2 - S * dfQ * Nn1);
    var vega = S * dfQ * nd1 * sq;
    var thetaCommon = -S * dfQ * nd1 * v / (2 * sq);
    var theta = isCall
      ? thetaCommon + q * S * dfQ * Nd1 - r * K * dfR * Nd2
      : thetaCommon - q * S * dfQ * Nn1 + r * K * dfR * Nn2;

    return {
      price: price < 0 ? 0 : price,
      d1: d1, d2: d2, df: dfR, dq: dfQ,
      delta: isCall ? dfQ * Nd1 : -dfQ * Nn1,
      gamma: dfQ * nd1 / (S * vs),
      vega: vega, vegaPt: vega / 100,
      theta: theta, thetaDay: theta / 365,
      rho: isCall ? K * T * dfR * Nd2 : -K * T * dfR * Nn2,
      vanna: -dfQ * nd1 * d2 / v,
      volga: vega * d1 * d2 / v,
      degenerate: false
    };
  }

  function callPrice(S, K, T, r, q, v) { var o = bs(S, K, T, r, q, v, true); return o ? o.price : null; }
  function putPrice(S, K, T, r, q, v) { var o = bs(S, K, T, r, q, v, false); return o ? o.price : null; }

  /* Put-call parity as an identity to be TESTED, not assumed:
       C - P - S e^(-qT) + K e^(-rT) = 0
     Returned as an absolute gap and as a gap relative to the strike, so the
     Method tab can show it is machine epsilon and not something we hope. */
  function parityGap(S, K, T, r, q, v) {
    var c = callPrice(S, K, T, r, q, v), p = putPrice(S, K, T, r, q, v);
    if (c == null || p == null) return null;
    var lhs = c - p, rhs = S * Math.exp(-q * T) - K * Math.exp(-r * T);
    return { call: c, put: p, lhs: lhs, rhs: rhs, abs: lhs - rhs, rel: K > 0 ? (lhs - rhs) / K : null };
  }

  /* ========================================================================
     3 · IMPLIED VOLATILITY

     Order of operations, and it matters:
       1. no-arbitrage bounds FIRST. A European call must sit inside
              [ max(0, S e^(-qT) - K e^(-rT)) , S e^(-qT) ]
          and a put inside [ max(0, K e^(-rT) - S e^(-qT)) , K e^(-rT) ].
          Outside that band no vol reproduces the price, so there is no answer:
          iv() returns a null sigma with the reason attached. It does NOT return 0, and
          it does not clamp the price to the boundary and pretend.
       2. at the lower bound exactly, the only consistent vol is 0 — returned
          as 0 with reason "at intrinsic", because that is a real answer.
       2b. IN THE MONEY, solve the OUT-OF-THE-MONEY TWIN through put-call
          parity and return its vol. Parity is exact in this model, and the ITM
          price is dominated by intrinsic — its time value can be 1e-6 of the
          quoted number — so the twin is the same answer, far better
          conditioned.
       3. seed: Brenner-Subrahmanyam (1988), in the Bharadia-Christofides-Salkin
          (1996) form that does not require the option to be at the money:
              v0 = sqrt(2 pi / T) * (price - (Sd - Kd)/2) / ((Sd + Kd)/2)
          with Sd = S e^(-qT), Kd = K e^(-rT). At the money Sd = Kd and this
          collapses to the textbook v0 = sqrt(2 pi / T) * price / S.
       4. Newton-Raphson on vega, NEWTON_MAX = 60 steps, stopping when the VOL
          STEP falls under VOL_TOL = 1e-13 — not when the price residual is
          small, because for a deep wing the price is 1e-6 and vega is 1e-5, so
          a residual of 1e-11 still leaves the vol wrong in the sixth decimal.
          Newton is quadratic here, so a step of 1e-13 means the root is
          already resolved to double precision. Price is strictly
          increasing in vol, so a Newton step that leaves (VOL_MIN, VOL_MAX) or
          meets a vega under VEGA_FLOOR = 1e-10 is not a convergence problem to
          be damped away, it is a signal that the root is somewhere the tangent
          cannot see: we hand over to bisection.
       5. bisection on a PROVEN bracket: price is monotone in v, so we double
          hi from the seed until price(hi) > target or hi > VOL_MAX. If the
          band check passed and hi hits VOL_MAX without covering the price, the
          price is inside the band but beyond a 1000% vol — reported as such,
          not fitted. BISECT_MAX = 200 halvings takes any bracket below 1e-60.
     ======================================================================== */

  var NEWTON_MAX = 60, BISECT_MAX = 200, VEGA_FLOOR = 1e-10, VOL_TOL = 1e-13;
  var VOL_MIN = 1e-9, VOL_MAX = 10;                 /* 10 = 1000% annualised */

  function ivBounds(S, K, T, r, q, isCall) {
    var Sd = S * Math.exp(-q * T), Kd = K * Math.exp(-r * T);
    return isCall
      ? { lo: Math.max(0, Sd - Kd), hi: Sd, Sd: Sd, Kd: Kd }
      : { lo: Math.max(0, Kd - Sd), hi: Kd, Sd: Sd, Kd: Kd };
  }

  function iv(price, S, K, T, r, q, isCall, noFlip) {
    price = +price; S = +S; K = +K; T = +T; r = +r; q = +q;
    if (!(price >= 0) || !(S > 0) || !(K > 0) || !isFinite(r) || !isFinite(q)) {
      return { sigma: null, reason: "an input is missing or not a number", iters: 0, method: null };
    }
    if (!(T > TINY)) {
      return { sigma: null, reason: "the option has expired — an expired price carries no vol", iters: 0, method: null };
    }
    var b = ivBounds(S, K, T, r, q, isCall);
    var scale = Math.max(1e-12, Math.abs(b.hi));
    if (price < b.lo - scale * 1e-12) {
      return { sigma: null, reason: "below intrinsic (" + b.lo.toFixed(8) + ") — no vol reproduces it", iters: 0, method: null, bounds: b };
    }
    if (price > b.hi + scale * 1e-12) {
      return { sigma: null, reason: "above the upper no-arbitrage bound (" + b.hi.toFixed(8) + ") — no vol reproduces it", iters: 0, method: null, bounds: b };
    }
    if (price <= b.lo + scale * 1e-12) {
      /* Strictly, price is increasing in vol and the unique vol reproducing
         the lower bound is zero. In FLOATING POINT a deep in-the-money option
         sits on that bound for every vol up to a large one, so this is really
         the statement "this price carries no volatility information". Zero is
         returned because it is the only value consistent with the price, and
         identified:false says not to put this strike in a surface fit. */
      return { sigma: 0, reason: "at the intrinsic bound to within double precision — the price carries no volatility information at this strike", iters: 0, method: "bound", identified: false, bounds: b };
    }
    if (price >= b.hi - scale * 1e-12) {
      return { sigma: null, reason: "at the upper bound — the implied vol is unbounded", iters: 0, method: null, bounds: b };
    }

    /* IN THE MONEY: solve the OUT-OF-THE-MONEY TWIN instead, through parity.
       An in-the-money price is dominated by intrinsic — at S/K = 1.25 and a
       week to run the whole time value is 1e-6 of the price — so its vol is
       the worst-conditioned number on the board. Put-call parity is exact in
       this model, so the twin has the SAME implied vol with none of that
       conditioning. If the twin price lands outside its own band (which only
       rounding can do) we fall through and solve the original.

       The limit on an in-the-money implied vol is then the CANCELLATION in
       price - Sd + Kd, not the solver: at S/K = 1.25 with a week to run, the
       subtraction of two numbers near 40 leaves a time value of 2e-6 carrying
       an absolute error of about 1e-14, so the vol is only recoverable to
       about 5e-10. That is a property of the price you were handed, and the
       desk would rather say so than print fourteen digits of it. */
    if (!noFlip) {
      var twin = null;
      if (isCall && b.Sd > b.Kd) twin = iv(price - b.Sd + b.Kd, S, K, T, r, q, false, true);
      else if (!isCall && b.Kd > b.Sd) twin = iv(price + b.Sd - b.Kd, S, K, T, r, q, true, true);
      if (twin && twin.sigma != null) { twin.viaParity = true; return twin; }
    }

    var PRICE_TOL = 1e-13 * Math.max(1, K);
    var mid = 0.5 * (b.Sd + b.Kd);
    var seed = Math.sqrt(2 * Math.PI / T) * (price - 0.5 * (b.Sd - b.Kd)) / (mid > 0 ? mid : 1);
    if (!(seed > VOL_MIN) || !isFinite(seed)) seed = 0.5;
    if (seed > VOL_MAX) seed = VOL_MAX;

    /* --- Newton on vega.

       The stopping test is on the VOL STEP, not on an absolute price residual.
       That distinction is the difference between an implied vol good to 1e-13
       and one good to 1e-5: for a deep wing the price is 1e-6 and vega is
       1e-5, so a price residual of 1e-11 still leaves a vol error of 1e-6.
       Newton converges quadratically here, so a step under VOL_TOL means the
       NEXT step would be of order VOL_TOL^2 and the root is already resolved
       to double precision. */
    var v = seed, i, o, diff, dv = null;
    for (i = 0; i < NEWTON_MAX; i++) {
      o = bs(S, K, T, r, q, v, isCall);
      if (!o) break;
      diff = o.price - price;
      if (!(o.vega > VEGA_FLOOR)) break;             /* the tangent is flat: stop */
      var step = diff / o.vega;
      var nv = v - step;
      if (!(nv > VOL_MIN) || !(nv < VOL_MAX) || nv !== nv) break;
      dv = Math.abs(nv - v);
      v = nv;
      if (dv <= VOL_TOL * Math.max(1e-3, v)) {
        o = bs(S, K, T, r, q, v, isCall);
        return { sigma: v, reason: null, iters: i + 1, method: "newton", seed: seed, step: dv, residual: o ? o.price - price : null, identified: true, bounds: b };
      }
    }
    o = bs(S, K, T, r, q, v, isCall);
    if (o && Math.abs(o.price - price) < PRICE_TOL && dv != null && dv < 1e-6) {
      return { sigma: v, reason: null, iters: NEWTON_MAX, method: "newton", seed: seed, step: dv, residual: o.price - price, identified: true, bounds: b };
    }

    /* --- bisection on a bracket we PROVE, using monotonicity in v */
    var lo = VOL_MIN, hi = Math.max(seed, 0.05), n = 0;
    while (n < 60) {
      var ph = bs(S, K, T, r, q, hi, isCall);
      if (ph && ph.price > price) break;
      hi *= 2; n++;
      if (hi > VOL_MAX) { hi = VOL_MAX; break; }
    }
    var pHi = bs(S, K, T, r, q, hi, isCall);
    if (!pHi || !(pHi.price >= price)) {
      return { sigma: null, reason: "inside the no-arbitrage band but above a " + (VOL_MAX * 100) + "% vol — not fitted", iters: n, method: null, bounds: b };
    }
    var it = 0, m, pm;
    for (it = 0; it < BISECT_MAX; it++) {
      m = 0.5 * (lo + hi);
      pm = bs(S, K, T, r, q, m, isCall);
      if (!pm) break;
      if (pm.price > price) hi = m; else lo = m;
      if (hi - lo < 1e-14 * Math.max(1, hi)) break;
    }
    m = 0.5 * (lo + hi);
    pm = bs(S, K, T, r, q, m, isCall);
    return {
      sigma: m, reason: null, iters: it + 1, method: "bisection", seed: seed,
      residual: pm ? pm.price - price : null, bounds: b
    };
  }

  /* ========================================================================
     4 · THE VOLATILITY SURFACE — raw SVI, then an ARBITRAGE CHECK

     Coordinates: log-moneyness k = ln(K / F) with F the forward, and TOTAL
     VARIANCE w = sigma^2 T. Total variance is the honest axis: it is what has
     to be monotone across expiries, and it is what a butterfly condition is
     written in.

     Gatheral's raw SVI slice (Gatheral 2004, "A parsimonious arbitrage-free
     implied volatility parameterization"; Gatheral & Jacquier 2014, "Arbitrage
     -free SVI volatility surfaces", Quantitative Finance 14(1)):

         w(k) = a + b ( rho (k - m) + sqrt( (k - m)^2 + sig^2 ) )

     with b >= 0, |rho| < 1, sig > 0 and a + b sig sqrt(1 - rho^2) >= 0 so that
     w >= 0 everywhere. The wings are asymptotically linear with slopes
     b(1 -/+ rho), which is why Lee's moment formula caps b(1 + |rho|) <= 4/T.

     FITTING is deterministic and draws no random number at all: coordinate
     descent (golden-section along one parameter at a time, cycling) restarted
     from a van der Corput low-discrepancy sequence whose offset is an FNV-1a
     hash of the inputs themselves. The same slice always fits to the same five
     numbers, which is the only way a surface can be compared week to week.

     CHECKING is separate from fitting, deliberately — a fit that is inside its
     parameter box can still admit a butterfly, and this desk prints that
     rather than clamping it away:

       Durrleman's condition (Durrleman 2003/2009, "From implied to spot
       volatilities"), the density-positivity test written on a slice:

           g(k) = ( 1 - k w'(k) / (2 w(k)) )^2
                  - ( w'(k)^2 / 4 ) ( 1/w(k) + 1/4 )
                  + w''(k) / 2

       g(k) >= 0 for every k is equivalent to a non-negative risk-neutral
       density, i.e. no butterfly arbitrage on that slice. g < 0 anywhere means
       a butterfly spread with a negative cost and a non-negative payoff.

       Calendar-spread arbitrage: total variance must be non-decreasing in T at
       every fixed k. w_2(k) < w_1(k) for T_2 > T_1 is a free calendar spread.

     Both are reported with the worst k and the size of the violation. A
     surface that fails is shown as failing.
     ======================================================================== */

  function sviW(p, k) {
    var x = k - p.m, s = Math.sqrt(x * x + p.sig * p.sig);
    return p.a + p.b * (p.rho * x + s);
  }
  function sviDW(p, k) {
    var x = k - p.m, s = Math.sqrt(x * x + p.sig * p.sig);
    return p.b * (p.rho + x / s);
  }
  function sviD2W(p, k) {
    var x = k - p.m, s2 = x * x + p.sig * p.sig;
    return p.b * p.sig * p.sig / (s2 * Math.sqrt(s2));
  }

  /* g(k). Returns null where w <= 0 — a slice with no variance has no density
     and the desk will not print a number for it. */
  function durrlemanG(p, k) {
    var w = sviW(p, k);
    if (!(w > 0)) return null;
    var d = sviDW(p, k), dd = sviD2W(p, k);
    var t1 = 1 - k * d / (2 * w);
    return t1 * t1 - (d * d / 4) * (1 / w + 0.25) + dd / 2;
  }

  /* The butterfly report for one slice, on a k grid wide enough to reach the
     wings (+/- 1.5 in log-moneyness is roughly a 4.5x move). */
  function butterfly(p, kLo, kHi, n) {
    n = n || 241;
    kLo = kLo == null ? -1.5 : kLo; kHi = kHi == null ? 1.5 : kHi;
    var worst = null, atK = null, i, k, g, neg = 0, pts = [];
    for (i = 0; i < n; i++) {
      k = kLo + (kHi - kLo) * i / (n - 1);
      g = durrlemanG(p, k);
      if (g == null) continue;
      pts.push({ k: k, g: g });
      if (g < 0) neg++;
      if (worst == null || g < worst) { worst = g; atK = k; }
    }
    return {
      ok: worst != null && worst >= 0, minG: worst, atK: atK,
      negPoints: neg, tested: pts.length, grid: pts,
      wings: { left: p.b * (1 - p.rho), right: p.b * (1 + p.rho) }
    };
  }

  /* Calendar monotonicity across a set of fitted slices, sorted by T. */
  function calendar(slices, kLo, kHi, n) {
    n = n || 121; kLo = kLo == null ? -1.0 : kLo; kHi = kHi == null ? 1.0 : kHi;
    var s = slices.slice().sort(function (a, b) { return a.T - b.T; });
    var pairs = [], i, j, k, w1, w2, worst, atK, bad;
    for (i = 0; i + 1 < s.length; i++) {
      worst = null; atK = null; bad = 0;
      for (j = 0; j < n; j++) {
        k = kLo + (kHi - kLo) * j / (n - 1);
        w1 = sviW(s[i].p, k); w2 = sviW(s[i + 1].p, k);
        var gap = w2 - w1;
        if (gap < 0) bad++;
        if (worst == null || gap < worst) { worst = gap; atK = k; }
      }
      pairs.push({ from: s[i].T, to: s[i + 1].T, minGap: worst, atK: atK, badPoints: bad, ok: worst >= 0 });
    }
    var allOk = true;
    for (i = 0; i < pairs.length; i++) if (!pairs[i].ok) allOk = false;
    return { ok: allOk, pairs: pairs };
  }

  /* ---- deterministic search plumbing -------------------------------------
     FNV-1a over the slice's own inputs, then a van der Corput sequence in five
     bases offset by that hash. Nothing on this path is random. */
  function hash32(str) {
    var h = 2166136261, i;
    str = String(str);
    for (i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }
  function vdc(i, base) {
    var f = 1 / base, r = 0, n = i;
    while (n > 0) { r += f * (n % base); n = Math.floor(n / base); f /= base; }
    return r;
  }
  var VDC_BASES = [2, 3, 5, 7, 11];

  function golden(f, lo, hi, iters) {
    var gr = 0.6180339887498949, i;
    var c = hi - gr * (hi - lo), d = lo + gr * (hi - lo);
    var fc = f(c), fd = f(d);
    for (i = 0; i < (iters || 60); i++) {
      if (fc < fd) { hi = d; d = c; fd = fc; c = hi - gr * (hi - lo); fc = f(c); }
      else { lo = c; c = d; fc = fd; d = lo + gr * (hi - lo); fd = f(d); }
      if (hi - lo < 1e-13) break;
    }
    return 0.5 * (lo + hi);
  }

  var SVI_RESTARTS = 12, SVI_SWEEPS = 26, SVI_SHRINK = 0.55;

  /* 3x3 symmetric solve, Gaussian elimination with partial pivoting. Returns
     null on a singular system rather than a number made of noise. */
  function solve3(A, y) {
    var M = [[A[0][0], A[0][1], A[0][2], y[0]], [A[1][0], A[1][1], A[1][2], y[1]], [A[2][0], A[2][1], A[2][2], y[2]]];
    var i, j, k, piv, t, f;
    for (i = 0; i < 3; i++) {
      piv = i;
      for (j = i + 1; j < 3; j++) if (Math.abs(M[j][i]) > Math.abs(M[piv][i])) piv = j;
      if (Math.abs(M[piv][i]) < 1e-14) return null;
      if (piv !== i) { t = M[i]; M[i] = M[piv]; M[piv] = t; }
      for (j = i + 1; j < 3; j++) {
        f = M[j][i] / M[i][i];
        for (k = i; k < 4; k++) M[j][k] -= f * M[i][k];
      }
    }
    var x = [0, 0, 0];
    for (i = 2; i >= 0; i--) {
      t = M[i][3];
      for (k = i + 1; k < 3; k++) t -= M[i][k] * x[k];
      x[i] = t / M[i][i];
    }
    return x;
  }

  /* points: [{k, w, weight?}] for ONE expiry.

     QUASI-EXPLICIT CALIBRATION (Zeliade Systems white paper, "Quasi-explicit
     calibration of Gatheral's SVI model", 2009): with m and sig FIXED the
     slice is LINEAR in three unknowns, because

         w(k) = a + c1 (k - m) + c2 sqrt((k - m)^2 + sig^2),
         c1 = b rho,   c2 = b

     so the inner problem is an exact weighted 3x3 least squares and only the
     two genuinely nonlinear parameters are searched. That is why the fit
     recovers an SVI slice from its own prices to machine precision instead of
     wandering, which a naive five-way descent does.

     The constraints are applied as a PROJECTION of the linear solution, not as
     a penalty, and each is the published one:
         b >= 0                                (an upward smile)
         |rho| < 1                             ( |c1| < c2 )
         b(1 + |rho|) <= 4/T, i.e. c2 + |c1| <= 4/T   (Lee's moment formula)
         a + b sig sqrt(1 - rho^2) >= 0        (w >= 0 everywhere)
     with a re-solved exactly for whatever (c1, c2) survive.

     The outer search is coordinate descent — golden section on m, then on sig,
     cycling — restarted twelve times from a van der Corput low-discrepancy
     sequence offset by an FNV-1a hash of the slice's own inputs. No random
     draw anywhere: the same slice always fits to the same five numbers. */
  function sviFit(points, T, tag) {
    var pts = [], i;
    for (i = 0; i < (points || []).length; i++) {
      var pt = points[i];
      if (pt && isFinite(pt.k) && pt.w > 0) pts.push({ k: +pt.k, w: +pt.w, wt: pt.weight > 0 ? +pt.weight : 1 });
    }
    if (pts.length < 5) return { ok: false, reason: "a raw SVI slice has five parameters and needs at least five strikes with a usable implied vol — got " + pts.length, p: null };

    var kMin = pts[0].k, kMax = pts[0].k, wMin = pts[0].w, wMax = pts[0].w;
    for (i = 1; i < pts.length; i++) {
      if (pts[i].k < kMin) kMin = pts[i].k;
      if (pts[i].k > kMax) kMax = pts[i].k;
      if (pts[i].w < wMin) wMin = pts[i].w;
      if (pts[i].w > wMax) wMax = pts[i].w;
    }
    var span = Math.max(1e-6, kMax - kMin);
    var mBox = [kMin - span, kMax + span];
    var sBox = [1e-4, Math.max(1, 4 * span)];
    var leeCap = 4 / Math.max(T, 1e-8);

    function sseOf(p) {
      var t = 0, j, d;
      for (j = 0; j < pts.length; j++) { d = sviW(p, pts[j].k) - pts[j].w; t += pts[j].wt * d * d; }
      return t;
    }

    /* the exact inner solve at fixed (m, sig), then the projection */
    function inner(m, sig) {
      var S0 = 0, S1 = 0, S2 = 0, S11 = 0, S12 = 0, S22 = 0, R0 = 0, R1 = 0, R2 = 0, j, wt, y1, y2, ww;
      for (j = 0; j < pts.length; j++) {
        wt = pts[j].wt; ww = pts[j].w;
        y1 = pts[j].k - m; y2 = Math.sqrt(y1 * y1 + sig * sig);
        S0 += wt; S1 += wt * y1; S2 += wt * y2;
        S11 += wt * y1 * y1; S12 += wt * y1 * y2; S22 += wt * y2 * y2;
        R0 += wt * ww; R1 += wt * y1 * ww; R2 += wt * y2 * ww;
      }
      var x = solve3([[S0, S1, S2], [S1, S11, S12], [S2, S12, S22]], [R0, R1, R2]);
      var a, c1, c2;
      if (x) { a = x[0]; c1 = x[1]; c2 = x[2]; } else { a = wMin; c1 = 0; c2 = 0; }
      if (!(c2 > 0)) c2 = 0;
      if (Math.abs(c1) > 0.999 * c2) c1 = (c1 < 0 ? -1 : 1) * 0.999 * c2;
      if (c2 + Math.abs(c1) > leeCap) {
        var sc = leeCap / (c2 + Math.abs(c1));
        c2 *= sc; c1 *= sc;
      }
      if (S0 > 0) a = (R0 - c1 * S1 - c2 * S2) / S0;         /* a re-solved exactly */
      var rho = c2 > 0 ? c1 / c2 : 0;
      var floor = -c2 * sig * Math.sqrt(Math.max(0, 1 - rho * rho));
      if (a < floor) a = floor;
      var p = { a: a, b: c2, rho: rho, m: m, sig: sig };
      return { p: p, sse: sseOf(p) };
    }

    var seedStr = tag ? String(tag) : (T + "|" + pts.length + "|" + kMin.toFixed(6) + "|" + kMax.toFixed(6) + "|" + wMin.toFixed(8) + "|" + wMax.toFixed(8));
    var off = hash32(seedStr) / 4294967296;
    /* the data-driven start: the smile's own minimum, and a width of half the
       strike span. Restart 0 is that; the rest are the quasi-random sweep. */
    var kAtMin = pts[0].k;
    for (i = 1; i < pts.length; i++) if (pts[i].w < pts[0].w && pts[i].w <= wMin) kAtMin = pts[i].k;
    var best = null, r;
    for (r = 0; r <= SVI_RESTARTS; r++) {
      var m, sg;
      if (r === 0) { m = kAtMin; sg = Math.max(1e-3, span / 2); }
      else {
        var u0 = vdc(r, VDC_BASES[0]) + off, u1 = vdc(r, VDC_BASES[1]) + off;
        u0 -= Math.floor(u0); u1 -= Math.floor(u1);
        m = mBox[0] + (mBox[1] - mBox[0]) * u0;
        sg = sBox[0] + (Math.min(sBox[1], 0.8) - sBox[0]) * u1;
      }
      /* Coordinate descent on a SHRINKING local bracket. A golden section over
         the whole box would ignore where the restart started, which makes
         twelve restarts twelve copies of one search; the sse surface in
         (m, sig) is not unimodal, so that matters. */
      var radM = (mBox[1] - mBox[0]) / 2, radS = (sBox[1] - sBox[0]) / 2;
      var cur = inner(m, sg), sweep;
      for (sweep = 0; sweep < SVI_SWEEPS; sweep++) {
        var prev = cur.sse;
        m = golden((function (g) { return function (x) { return inner(x, g).sse; }; })(sg), Math.max(mBox[0], m - radM), Math.min(mBox[1], m + radM), 50);
        cur = inner(m, sg);
        sg = golden((function (g) { return function (x) { return inner(g, x).sse; }; })(m), Math.max(sBox[0], sg - radS), Math.min(sBox[1], sg + radS), 50);
        cur = inner(m, sg);
        radM *= SVI_SHRINK; radS *= SVI_SHRINK;
        if (prev - cur.sse < 1e-20 * Math.max(1, prev)) break;
      }
      if (!best || cur.sse < best.sse) best = cur;
    }

    var rmse = Math.sqrt(Math.max(0, best.sse) / pts.length);
    var bf = butterfly(best.p, Math.min(-1.5, kMin * 2), Math.max(1.5, kMax * 2), 241);
    return {
      ok: true, p: best.p, T: T, sse: best.sse, rmse: rmse, n: pts.length,
      restarts: SVI_RESTARTS, seed: seedStr, butterfly: bf,
      volAt: function (k) { var w = sviW(best.p, k); return w > 0 && T > 0 ? Math.sqrt(w / T) : null; }
    };
  }

  /* ========================================================================
     5 · AMERICAN EXERCISE — Cox-Ross-Rubinstein

     Cox, Ross & Rubinstein (1979), "Option pricing: a simplified approach":

         dt = T/N,  u = e^(v sqrt(dt)),  d = 1/u,
         p  = ( e^((r-q) dt) - d ) / ( u - d ),   discount e^(-r dt)

     The tree is recombining, so the whole thing is one array rolled backwards.
     At every node an American holder compares continuation with intrinsic and
     takes the better — the EARLY-EXERCISE BOUNDARY is the spot at which that
     comparison flips, extracted per time step rather than described in prose.

     p must land in (0,1) or the tree is not a probability: with N too small
     for a large (r-q) it does not, and crr() says so instead of pricing.

     Convergence is SHOWN, not assumed: crrConverge() prices a European call on
     the same tree against the closed form, and the error oscillates as it
     falls — roughly O(1/N) with the even/odd alternation CRR is known for,
     which is exactly why doubling N once is not a convergence proof.
     ======================================================================== */

  var CRR_MAX_N = 1200;

  function crr(S, K, T, r, q, v, isCall, american, N) {
    N = Math.max(2, Math.min(CRR_MAX_N, Math.floor(N || 200)));
    if (!(S > 0) || !(K > 0) || !(T > 0) || !(v > 0)) return null;
    var dt = T / N, u = Math.exp(v * Math.sqrt(dt)), d = 1 / u;
    var a = Math.exp((r - q) * dt), p = (a - d) / (u - d), df = Math.exp(-r * dt);
    if (!(p > 0 && p < 1)) {
      return { price: null, N: N, p: p, reason: "the risk-neutral step probability came out at " + p.toFixed(6) + ", outside (0,1) — this tree is not a probability at N=" + N + ". Raise N or lower the carry." };
    }
    /* One power table for the whole tree: pw[e + N] = u^e for e in [-N, N].
       Calling Math.pow once per node instead costs a million calls at N = 800,
       which is the difference between a tab that renders and one that hangs. */
    var pw = [], e;
    pw[N] = 1;
    for (e = 1; e <= N; e++) { pw[N + e] = pw[N + e - 1] * u; pw[N - e] = pw[N - e + 1] * d; }
    var val = [], sj = [], j;
    for (j = 0; j <= N; j++) {
      var Sj = S * pw[2 * j];
      sj.push(Sj);
      val.push(Math.max(0, isCall ? Sj - K : K - Sj));
    }
    /* The exercise region is an interval: S ABOVE a critical level for a call,
       S BELOW it for a put. So the boundary at a step is the LOWEST exercised
       node for a call and the HIGHEST for a put. Where no node exercises the
       boundary is null for that step — missing, not zero. */
    var boundary = [], exercised = 0, i;
    for (i = N - 1; i >= 0; i--) {
      var bnd = null;
      for (j = 0; j <= i; j++) {
        var cont = df * (p * val[j + 1] + (1 - p) * val[j]);
        var Sij = S * pw[2 * j - i + N];
        if (american) {
          var ex = Math.max(0, isCall ? Sij - K : K - Sij);
          if (ex > cont) {
            val[j] = ex; exercised++;
            if (bnd == null) bnd = Sij;
            else if (isCall) { if (Sij < bnd) bnd = Sij; }
            else { if (Sij > bnd) bnd = Sij; }
          } else val[j] = cont;
        } else val[j] = cont;
      }
      if (american) boundary.push({ step: i, t: i * dt, S: bnd });
    }
    boundary.reverse();
    return {
      price: val[0], N: N, dt: dt, u: u, d: d, p: p, df: df,
      american: !!american, exercisedNodes: exercised,
      boundary: boundary, spotGrid: sj
    };
  }

  /* American premium and the convergence table, both printed rather than
     asserted. 'euro' here is the SAME tree with early exercise switched off,
     so the premium is a like-for-like difference and not a model mismatch. */
  function americanPremium(S, K, T, r, q, v, isCall, N) {
    var am = crr(S, K, T, r, q, v, isCall, true, N);
    var eu = crr(S, K, T, r, q, v, isCall, false, N);
    var bsEu = bs(S, K, T, r, q, v, isCall);
    if (!am || !eu || am.price == null || eu.price == null) return null;
    return {
      american: am.price, europeanTree: eu.price, europeanClosed: bsEu ? bsEu.price : null,
      premium: am.price - eu.price,
      premiumPct: eu.price > 0 ? (am.price - eu.price) / eu.price : null,
      treeVsClosed: bsEu ? eu.price - bsEu.price : null,
      N: am.N, boundary: am.boundary, p: am.p
    };
  }

  function crrConverge(S, K, T, r, q, v, isCall, list) {
    var Ns = list || [25, 50, 100, 200, 400, 800];
    var closed = bs(S, K, T, r, q, v, isCall), rows = [], i;
    for (i = 0; i < Ns.length; i++) {
      var eu = crr(S, K, T, r, q, v, isCall, false, Ns[i]);
      var am = crr(S, K, T, r, q, v, isCall, true, Ns[i]);
      rows.push({
        N: Ns[i],
        euro: eu ? eu.price : null,
        closed: closed ? closed.price : null,
        err: (eu && eu.price != null && closed) ? eu.price - closed.price : null,
        amer: am ? am.price : null,
        premium: (am && eu && am.price != null && eu.price != null) ? am.price - eu.price : null
      });
    }
    return rows;
  }

  /* ========================================================================
     6 · WHERE THE CHAIN COMES FROM

     Plainly: there is no options venue in this app and nobody publishes a
     chain to it. Everything on the Chain tab is GENERATED here, from
       (a) the app's own live spot price, and
       (b) a surface anchored on the coin's REALISED volatility, with a skew
           whose parameters are printed on the Surface tab.
     These are model prices. They are not quotes and nobody will fill them.

     Realised vol: the payload carries a 56-point sparkline per coin, which is
     the CoinGecko 7-day hourly series truncated to its last 56 hours. So the
     annualisation factor is sqrt(24 * 365) = sqrt(8760) per bar — read off the
     real bar size, not a magic constant. A coin with no usable series falls
     back to FALLBACK_VOL and the desk says "fallback" where it is used.

     From realised vol to an implied ATM term structure, with every constant
     named and adjustable:

       sigma_atm(T) = ( RV + (LONG_VOL - RV) (1 - e^(-T/TERM_TAU)) ) * VRP

       VRP       = 1.10   implied sits above realised on average. A VOLATILITY
                          RISK PREMIUM is an assumption, not a measurement.
       LONG_VOL  = 0.65   the level the term structure pulls toward.
       TERM_TAU  = 0.25y  how fast it gets there.

     The smile is a raw SVI slice built so that its ATM level and its ATM skew
     are the two numbers above rather than free parameters:

       w_atm = sigma_atm^2 T
       skew(T) = SKEW_30 * sqrt(30 / days)     (skew flattens as sqrt(T))
       m = 0, rho = RHO (-0.30), sig = SVI_SIG_K (0.10)
       b = 2 sigma_atm T skew(T) / rho         so that dsigma/dk at k=0 = skew
       a = w_atm - b sig

     and the slice is then run through the SAME butterfly and calendar checks
     as a fitted one, so the generator has to pass its own exam.

     Bid and ask are the surface vol plus and minus SPREAD_VOL_PTS (1 vol
     point). That width is a fixed modelling constant. No commission, no
     exercise fee and no funding are modelled anywhere on this desk.
     ======================================================================== */

  var FALLBACK_VOL = 0.60, VRP = 1.10, LONG_VOL = 0.65, TERM_TAU = 0.25;
  var RHO = -0.30, SVI_SIG_K = 0.10, SKEW_30 = -0.09;
  var SPREAD_VOL_PTS = 0.01;
  var EXPIRY_DAYS = [7, 14, 30, 60, 90, 180];
  var STRIKE_STEPS = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
  var STRIKE_STEP_SD = 0.25;                 /* strike ladder spacing, in sigma*sqrt(T) */
  var ANN_HOURLY = Math.sqrt(24 * 365);
  var DAY_MS = 86400000, YEAR_DAYS = 365;

  function realisedVol(sym) {
    var c = null;
    try { c = C.coin(sym); } catch (e) { c = null; }
    var px = c && c.spark && c.spark.length > 8 ? c.spark : null;
    if (!px) return { vol: FALLBACK_VOL, src: "fallback", n: 0 };
    var rets = null, sd = null;
    try { rets = C.logRets(px); sd = C.stdev(rets); } catch (e) { sd = null; }
    if (!(sd > 0)) return { vol: FALLBACK_VOL, src: "fallback", n: px.length };
    return { vol: sd * ANN_HOURLY, src: "realised", n: px.length, bars: "hourly" };
  }

  function atmVol(rv, T) {
    var base = rv + (LONG_VOL - rv) * (1 - Math.exp(-T / TERM_TAU));
    return base * VRP;
  }

  /* The generator's slice for one expiry, in the SAME raw-SVI parameters the
     fitter reports, so the two can be compared digit by digit. */
  function genSlice(rv, T) {
    var days = Math.max(1e-6, T * YEAR_DAYS);
    var sa = atmVol(rv, T), wAtm = sa * sa * T;
    var skew = SKEW_30 * Math.sqrt(30 / days);
    var b = 2 * sa * T * skew / RHO;                 /* both negative -> b > 0 */
    if (!(b > 0)) b = 1e-6;
    var capB = 4 / Math.max(T, 1e-6) / (1 + Math.abs(RHO));
    if (b > capB) b = capB;                          /* Lee's wing bound, kept */
    var a = wAtm - b * SVI_SIG_K;
    var floor = a + b * SVI_SIG_K * Math.sqrt(1 - RHO * RHO);
    if (floor < 0) a = a - floor;                    /* keep w >= 0 everywhere */
    return { a: a, b: b, rho: RHO, m: 0, sig: SVI_SIG_K };
  }

  /* Strikes are rounded to a tick, and the tick is derived from the LADDER
     SPACING rather than from the price alone: a tick coarser than the spacing
     collapses eleven strikes into three, which is how a "chain" quietly stops
     being a chain. tick = the 1/2/2.5/5 x 10^n step just under half a rung. */
  function niceTick(F, spacing) {
    if (!(F > 0)) return 1;
    var want = spacing > 0 ? spacing / 2 : F / 200;
    if (!(want > 0)) want = F / 200;
    var mag = Math.pow(10, Math.floor(Math.log(want) / Math.LN10));
    var n = want / mag, step;
    if (n >= 5) step = 5 * mag;
    else if (n >= 2.5) step = 2.5 * mag;
    else if (n >= 2) step = 2 * mag;
    else step = mag;
    if (!(step > 0) || !isFinite(step)) step = F / 200;
    return step;
  }

  function market(sym) {
    var c = null;
    try { c = C.coin(sym); } catch (e) { c = null; }
    var S = c && +c.price > 0 ? +c.price : null;
    if (S == null) return { sym: sym, S: null, rv: null, note: "no spot price for " + sym + " — nothing to build a chain on" };
    var rv = realisedVol(sym);
    return { sym: sym, S: S, rv: rv.vol, rvSrc: rv.src, rvBars: rv.n, note: null };
  }

  /* One generated chain. 'now' is passed in so a rebuild inside one tick is
     reproducible; the expiry timestamps are snapped to 08:00 UTC. */
  function chain(sym, r, q, now) {
    var M = market(sym);
    if (M.S == null) return { sym: sym, S: null, expiries: [], note: M.note };
    r = isFinite(+r) ? +r : 0.04; q = isFinite(+q) ? +q : 0;
    now = now || (C.now ? C.now() : 0);
    var out = [], e, i, j;
    for (i = 0; i < EXPIRY_DAYS.length; i++) {
      var days = EXPIRY_DAYS[i];
      var expiry = snap8(now + days * DAY_MS);
      var T = Math.max(1 / (YEAR_DAYS * 24), (expiry - now) / DAY_MS / YEAR_DAYS);
      var F = M.S * Math.exp((r - q) * T);
      var p = genSlice(M.rv, T);
      var sa = atmVol(M.rv, T);
      var rung = F * (Math.exp(STRIKE_STEP_SD * sa * Math.sqrt(T)) - 1);
      var tick = niceTick(F, rung);
      var rows = [], seen = {};
      for (j = 0; j < STRIKE_STEPS.length; j++) {
        var kWant = STRIKE_STEPS[j] * STRIKE_STEP_SD * sa * Math.sqrt(T);
        var K = Math.round(F * Math.exp(kWant) / tick) * tick;
        if (!(K > 0) || seen[K]) continue;
        seen[K] = 1;
        var k = Math.log(K / F);
        var w = sviW(p, k);
        var v = w > 0 ? Math.sqrt(w / T) : null;
        if (!(v > 0)) continue;
        var cg = bs(M.S, K, T, r, q, v, true), pg = bs(M.S, K, T, r, q, v, false);
        var vBid = Math.max(1e-6, v - SPREAD_VOL_PTS), vAsk = v + SPREAD_VOL_PTS;
        rows.push({
          K: K, k: k, w: w, vol: v,
          call: cg, put: pg,
          callBid: callPrice(M.S, K, T, r, q, vBid), callAsk: callPrice(M.S, K, T, r, q, vAsk),
          putBid: putPrice(M.S, K, T, r, q, vBid), putAsk: putPrice(M.S, K, T, r, q, vAsk),
          atm: false
        });
      }
      /* mark the strike nearest the forward, for the ladder and the builder */
      var bestI = -1, bestD = null;
      for (j = 0; j < rows.length; j++) {
        var dd = Math.abs(rows[j].k);
        if (bestD == null || dd < bestD) { bestD = dd; bestI = j; }
      }
      if (bestI >= 0) rows[bestI].atm = true;
      e = {
        days: days, expiry: expiry, T: T, F: F, atmVol: sa, gen: p, atmIndex: bestI,
        rows: rows, label: dayLabel(expiry)
      };
      out.push(e);
    }
    var slices = [], bf = [];
    for (i = 0; i < out.length; i++) {
      slices.push({ T: out[i].T, p: out[i].gen });
      bf.push({ days: out[i].days, T: out[i].T, report: butterfly(out[i].gen, -1.5, 1.5, 121) });
    }
    return {
      sym: sym, S: M.S, r: r, q: q, now: now, rv: M.rv, rvSrc: M.rvSrc, rvBars: M.rvBars,
      expiries: out, generatorButterfly: bf, generatorCalendar: calendar(slices), note: null
    };
  }

  function snap8(ms) {
    var d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 8, 0, 0, 0);
  }
  function dayLabel(ms) {
    try { return new Date(ms).toISOString().slice(0, 10); } catch (e) { return "—"; }
  }

  /* Refit the generated chain from its own MID PRICES, through iv(). This is a
     round trip on purpose: prices -> implied vol -> total variance -> SVI. If
     the fitter cannot get back to the generator's five numbers, one of the two
     is wrong, and the Surface tab prints both sets side by side. */
  function surface(ch) {
    if (!ch || !ch.expiries || !ch.expiries.length) return { ok: false, slices: [], note: (ch && ch.note) || "no chain" };
    var slices = [], i, j;
    for (i = 0; i < ch.expiries.length; i++) {
      var e = ch.expiries[i], pts = [], ivs = [];
      for (j = 0; j < e.rows.length; j++) {
        var row = e.rows[j];
        /* OTM side only, the market convention: calls above the forward, puts
           below. An ITM option's vega is the same but its price is dominated
           by intrinsic, so its implied vol is the least well determined. */
        var useCall = row.k >= 0;
        var px = useCall ? row.call.price : row.put.price;
        var got = iv(px, ch.S, row.K, e.T, ch.r, ch.q, useCall);
        ivs.push({ K: row.K, k: row.k, side: useCall ? "call" : "put", price: px, iv: got.sigma, reason: got.reason, method: got.method, iters: got.iters, gen: row.vol });
        if (got.sigma > 0) pts.push({ k: row.k, w: got.sigma * got.sigma * e.T, weight: 1 });
      }
      var fit = sviFit(pts, e.T, ch.sym + "|" + e.days + "|" + pts.length);
      slices.push({ days: e.days, T: e.T, expiry: e.expiry, label: e.label, gen: e.gen, fit: fit, ivs: ivs, atmVol: e.atmVol });
    }
    var fitted = [], k;
    for (i = 0; i < slices.length; i++) if (slices[i].fit && slices[i].fit.ok) fitted.push({ T: slices[i].T, p: slices[i].fit.p });
    var cal = calendar(fitted);
    var bad = 0;
    for (i = 0; i < slices.length; i++) if (slices[i].fit && slices[i].fit.ok && !slices[i].fit.butterfly.ok) bad++;
    return { ok: true, slices: slices, calendar: cal, butterflyFails: bad, sym: ch.sym, S: ch.S, r: ch.r, q: ch.q };
  }

  /* ========================================================================
     7 · STRATEGIES

     A structure is a list of legs. A leg is a signed quantity of one contract
     (or of the underlying itself), and 1 contract is 1 unit of the underlying
     — there is no 100-share multiplier here, because there is no listed
     contract here to have one.

     Four things are computed for every structure, and none of them is a
     picture of a payoff diagram pretending to be arithmetic:

       payoff at the HORIZON (the nearest expiry in the structure). A leg that
         outlives the horizon is not dropped and it is not treated as expiring
         early — it is MARKED with Black-Scholes at its remaining life, which
         is the only reason a calendar spread has a payoff shape at all.
       breakevens, by scanning the profit curve and bisecting every sign change
         to 1e-12 of the underlying. Not read off a chart.
       max profit / max loss, from the kinks, from the value at S = 0, and from
         the measured slope as S grows. The underlying cannot go below zero, so
         the downside extreme is a NUMBER (the value at zero) and only the
         upside can run away; when it does the answer is the word UNBOUNDED,
         never a big number, because a big number invites a position size.
       probability of profit, integrating the lognormal over the profitable
         region exactly (no Monte Carlo): under the RISK-NEUTRAL measure,
             ln S_H ~ Normal( ln S + (r - q - sigma^2/2) H , sigma^2 H )
         with sigma the ATM vol at the horizon. THE DRIFT IS NAMED: r - q -
         sigma^2/2 is the pricing drift, not a forecast. Under a real-world
         drift mu the same structure has a different probability of profit, and
         this desk does not claim to know mu.
     ======================================================================== */

  var SLOPE_EPS = 1e-7, GRID_N = 601;

  function legValueAt(leg, ST, H, r, q) {
    if (leg.kind === "spot") return leg.qty * ST;
    var isCall = leg.kind === "call";
    var rem = leg.T - H;
    if (rem <= 1e-9) return leg.qty * Math.max(0, isCall ? ST - leg.K : leg.K - ST);
    var o = bs(ST, leg.K, rem, r, q, leg.v, isCall);
    return o ? leg.qty * o.price : null;
  }

  function horizonOf(legs) {
    var H = null, i;
    for (i = 0; i < legs.length; i++) {
      if (legs[i].kind === "spot") continue;
      if (H == null || legs[i].T < H) H = legs[i].T;
    }
    return H;
  }

  function netCost(legs) {
    var c = 0, i, L;
    for (i = 0; i < legs.length; i++) {
      L = legs[i];
      /* you pay the ask to get long and receive the bid to get short — the
         only trading cost this desk models is that crossing */
      c += L.qty > 0 ? L.qty * (L.ask != null ? L.ask : L.px) : L.qty * (L.bid != null ? L.bid : L.px);
    }
    return c;
  }

  function profitAt(legs, ST, H, r, q, cost) {
    var v = 0, i, lv;
    for (i = 0; i < legs.length; i++) {
      lv = legValueAt(legs[i], ST, H, r, q);
      if (lv == null) return null;
      v += lv;
    }
    return v - cost;
  }

  function analyse(legs, S, r, q) {
    var H = horizonOf(legs);
    if (H == null) return null;
    var cost = netCost(legs);
    var f = function (x) { return profitAt(legs, x, H, r, q, cost); };
    var lo = S * 0.02, hi = S * 4, i, x, y;
    var xs = [], ys = [];
    for (i = 0; i < GRID_N; i++) {
      x = lo + (hi - lo) * i / (GRID_N - 1);
      xs.push(x); ys.push(f(x));
    }
    /* kinks matter more than grid points: add every strike exactly */
    for (i = 0; i < legs.length; i++) if (legs[i].K > 0) { xs.push(legs[i].K); ys.push(f(legs[i].K)); }

    /* breakevens by bisection on every sign change of the grid */
    var be = [];
    for (i = 1; i < GRID_N; i++) {
      var a = lo + (hi - lo) * (i - 1) / (GRID_N - 1), b2 = lo + (hi - lo) * i / (GRID_N - 1);
      var fa = f(a), fb = f(b2);
      if (fa == null || fb == null) continue;
      if (fa === 0) { be.push(a); continue; }
      if (fa * fb < 0) {
        var l = a, h2 = b2, m2, fm, it;
        for (it = 0; it < 200; it++) {
          m2 = 0.5 * (l + h2); fm = f(m2);
          if (fm == null) break;
          if (fa * fm <= 0) h2 = m2; else { l = m2; fa = fm; }
          if (h2 - l < 1e-12 * Math.max(1, h2)) break;
        }
        be.push(0.5 * (l + h2));
      }
    }

    /* Tail slope, measured rather than reasoned about — and measured ONLY on
       the upside, because the underlying cannot go below zero. Every payoff in
       this desk is finite at S = 0, so the downside is bounded by construction
       and its extreme is the value AT zero, which is evaluated and included
       rather than guessed at. Only a non-zero slope as S grows without limit
       can make a leg of this structure unbounded. */
    var sHi = (f(S * 40) - f(S * 20)) / (S * 20);
    var atZero = f(1e-9 * S);
    var maxP = atZero, maxL = atZero, atP = 0, atL = 0;
    for (i = 0; i < ys.length; i++) {
      if (ys[i] == null) continue;
      if (maxP == null || ys[i] > maxP) { maxP = ys[i]; atP = xs[i]; }
      if (maxL == null || ys[i] < maxL) { maxL = ys[i]; atL = xs[i]; }
    }
    var upUnbounded = sHi > SLOPE_EPS;
    var lossUp = sHi < -SLOPE_EPS;

    return {
      horizonYears: H, cost: cost, breakevens: be,
      maxProfit: upUnbounded ? null : maxP,
      maxProfitAt: upUnbounded ? null : atP,
      maxProfitUnbounded: !!upUnbounded,
      maxLoss: lossUp ? null : maxL,
      maxLossAt: lossUp ? null : atL,
      maxLossUnbounded: !!lossUp,
      slopeHigh: sHi, valueAtZero: atZero,
      curve: { xs: xs.slice(0, GRID_N), ys: ys.slice(0, GRID_N) },
      profitAt: f
    };
  }

  function netGreeks(legs, S, r, q) {
    var g = { delta: 0, gamma: 0, vega: 0, vegaPt: 0, theta: 0, thetaDay: 0, rho: 0, vanna: 0, volga: 0 }, i, L, o, miss = 0;
    for (i = 0; i < legs.length; i++) {
      L = legs[i];
      if (L.kind === "spot") { g.delta += L.qty; continue; }
      o = bs(S, L.K, L.T, r, q, L.v, L.kind === "call");
      if (!o) { miss++; continue; }
      if (o.delta == null) { miss++; continue; }
      g.delta += L.qty * o.delta;
      g.gamma += L.qty * o.gamma;
      g.vega += L.qty * o.vega;
      g.vegaPt += L.qty * o.vegaPt;
      g.theta += L.qty * o.theta;
      g.thetaDay += L.qty * o.thetaDay;
      g.rho += L.qty * o.rho;
      g.vanna += L.qty * o.vanna;
      g.volga += L.qty * o.volga;
    }
    g.missing = miss;
    return g;
  }

  /* P(profit) under the lognormal. The profitable region is read off the SAME
     profit function the payoff chart draws, so the two can never disagree. */
  function probOfProfit(an, S, H, r, q, sigma) {
    if (!an || !(S > 0) || !(H > 0) || !(sigma > 0)) return null;
    var cuts = an.breakevens.slice().sort(function (a, b) { return a - b; });
    var edges = [0].concat(cuts).concat([Infinity]);
    var drift = (r - q - 0.5 * sigma * sigma) * H, sd = sigma * Math.sqrt(H);
    function cdf(x) {
      if (!(x > 0)) return 0;
      if (!isFinite(x)) return 1;
      return ncdf((Math.log(x / S) - drift) / sd);
    }
    var p = 0, i, a, b2, midS, val, segs = [];
    for (i = 0; i + 1 < edges.length; i++) {
      a = edges[i]; b2 = edges[i + 1];
      midS = !isFinite(b2) ? Math.max(S * 8, (a || S) * 2) : (a === 0 ? b2 * 0.5 : 0.5 * (a + b2));
      val = an.profitAt(midS);
      var mass = cdf(b2) - cdf(a);
      if (val != null && val > 0) p += mass;
      segs.push({ from: a, to: b2, profitable: val != null && val > 0, mass: mass });
    }
    return { p: p, drift: "risk-neutral: r - q - sigma^2/2", sigma: sigma, horizonYears: H, segments: segs };
  }

  /* --- the eleven structures. Strikes are taken from the generated ladder by
     offset from the at-the-forward strike, so every leg is a strike you can
     see on the Chain tab rather than an invented number. */
  function rowAt(e, off) {
    var i = e.atmIndex + (off || 0);
    if (i < 0) i = 0;
    if (i > e.rows.length - 1) i = e.rows.length - 1;
    return e.rows[i];
  }
  function legFrom(row, e, kind, qty) {
    var isCall = kind === "call";
    return {
      kind: kind, qty: qty, K: row.K, T: e.T, expiry: e.expiry, v: row.vol,
      px: isCall ? row.call.price : row.put.price,
      bid: isCall ? row.callBid : row.putBid,
      ask: isCall ? row.callAsk : row.putAsk
    };
  }
  function spotLeg(S, qty) { return { kind: "spot", qty: qty, K: null, T: null, v: null, px: S, bid: S, ask: S }; }

  var STRATS = [
    { id: "bull-call", name: "Bull call spread", note: window.DLI18N.t("56-options.2d5ec43ccfb4"),
      build: function (ch, e, e2, n) { return [legFrom(rowAt(e, 0), e, "call", n), legFrom(rowAt(e, 2), e, "call", -n)]; } },
    { id: "bear-put", name: "Bear put spread", note: window.DLI18N.t("56-options.5ca5d73234a8"),
      build: function (ch, e, e2, n) { return [legFrom(rowAt(e, 0), e, "put", n), legFrom(rowAt(e, -2), e, "put", -n)]; } },
    { id: "straddle", name: "Long straddle", note: window.DLI18N.t("56-options.90b14b28e596"),
      build: function (ch, e, e2, n) { return [legFrom(rowAt(e, 0), e, "call", n), legFrom(rowAt(e, 0), e, "put", n)]; } },
    { id: "strangle", name: "Long strangle", note: window.DLI18N.t("56-options.ef045bfe83f0"),
      build: function (ch, e, e2, n) { return [legFrom(rowAt(e, 2), e, "call", n), legFrom(rowAt(e, -2), e, "put", n)]; } },
    { id: "butterfly", name: "Long call butterfly", note: window.DLI18N.t("56-options.cec92aa880b5"),
      build: function (ch, e, e2, n) { return [legFrom(rowAt(e, -2), e, "call", n), legFrom(rowAt(e, 0), e, "call", -2 * n), legFrom(rowAt(e, 2), e, "call", n)]; } },
    { id: "iron-condor", name: "Iron condor", note: window.DLI18N.t("56-options.824c088983e2"),
      build: function (ch, e, e2, n) { return [legFrom(rowAt(e, -2), e, "put", -n), legFrom(rowAt(e, -4), e, "put", n), legFrom(rowAt(e, 2), e, "call", -n), legFrom(rowAt(e, 4), e, "call", n)]; } },
    { id: "calendar", name: "Call calendar", note: window.DLI18N.t("56-options.8e59e3f6efd6"),
      build: function (ch, e, e2, n) { return e2 ? [legFrom(rowAt(e, 0), e, "call", -n), legFrom(rowAt(e2, 0), e2, "call", n)] : null; } },
    { id: "collar", name: "Collar", note: window.DLI18N.t("56-options.257be8fa7f35"),
      build: function (ch, e, e2, n) { return [spotLeg(ch.S, n), legFrom(rowAt(e, -2), e, "put", n), legFrom(rowAt(e, 2), e, "call", -n)]; } },
    { id: "covered-call", name: "Covered call", note: window.DLI18N.t("56-options.415107ffd1ff"),
      build: function (ch, e, e2, n) { return [spotLeg(ch.S, n), legFrom(rowAt(e, 2), e, "call", -n)]; } },
    { id: "protective-put", name: "Protective put", note: window.DLI18N.t("56-options.792a77f84968"),
      build: function (ch, e, e2, n) { return [spotLeg(ch.S, n), legFrom(rowAt(e, -2), e, "put", n)]; } },
    { id: "risk-reversal", name: "Risk reversal", note: window.DLI18N.t("56-options.26445fad7c42"),
      build: function (ch, e, e2, n) { return [legFrom(rowAt(e, 2), e, "call", n), legFrom(rowAt(e, -2), e, "put", -n)]; } }
  ];

  function strategy(id, ch, opts) {
    opts = opts || {};
    if (!ch || !ch.expiries || !ch.expiries.length) return null;
    var def = null, i;
    for (i = 0; i < STRATS.length; i++) if (STRATS[i].id === id) def = STRATS[i];
    if (!def) return null;
    var ei = Math.max(0, Math.min(ch.expiries.length - 1, opts.expiry == null ? 2 : +opts.expiry));
    var fi = Math.max(0, Math.min(ch.expiries.length - 1, opts.far == null ? Math.min(ch.expiries.length - 1, ei + 2) : +opts.far));
    if (fi <= ei) fi = Math.min(ch.expiries.length - 1, ei + 1);
    var n = +opts.qty > 0 ? +opts.qty : 1;
    var legs = def.build(ch, ch.expiries[ei], ch.expiries[fi], n);
    if (!legs || !legs.length) return { id: id, name: def.name, note: def.note, legs: [], reason: "this structure needs two different expiries and the chain has only one" };
    var an = analyse(legs, ch.S, ch.r, ch.q);
    var g = netGreeks(legs, ch.S, ch.r, ch.q);
    var sigH = ch.expiries[ei].atmVol;
    var pop = an ? probOfProfit(an, ch.S, an.horizonYears, ch.r, ch.q, sigH) : null;
    return {
      id: id, name: def.name, note: def.note, legs: legs, expiryIndex: ei, farIndex: fi, qty: n,
      analysis: an, greeks: g, pop: pop, horizonDays: an ? an.horizonYears * YEAR_DAYS : null,
      netCost: an ? an.cost : null
    };
  }

  /* ========================================================================
     8 · PAPER POSITIONS, AND WHAT A SHORT OPTION COSTS TO HOLD

     The engine this app already owns can hold a long position in a symbol and
     can move quote currency, and it cannot hold a negative one. So a position
     here is a CLAIM TICKET: a synthetic symbol bought through execFill at its
     NET CASH OUTLAY, and sold back through execFill at the cash the desk owes
     you when you close. Nothing is ever assigned to a balance directly.

       long  option:  outlay/unit = ask premium
                      close/unit  = bid premium (or intrinsic at expiry)
       short option:  outlay/unit = MARGIN - bid premium     (margin is posted)
                      close/unit  = MARGIN - ask premium     (you buy it back)
                                  = MARGIN - intrinsic at expiry

     so the P&L of the ticket is exactly the P&L of the option, and a short
     position ties up its margin the whole time it is open, which is the point.

     MARGIN RULE, stated rather than waved at — the Reg T / CBOE minimum for an
     uncovered equity option, per unit of underlying:

         margin = max( premium + 0.20 S - OTM ,  premium + 0.10 X )
         OTM    = max(0, K - S) for a call, max(0, S - K) for a put
         X      = S for a call, K for a put

     MARGIN_BASE = 0.20 and MARGIN_FLOOR = 0.10 are the US listed-equity
     numbers. No crypto venue uses them: they run portfolio margin and their
     requirement will be different, usually smaller and path-dependent. This is
     a teaching number with a published source, not a venue's.

     A short whose settlement exceeds its posted margin is a MARGIN BREACH: the
     shortfall is charged to the account through chargeNetwork and printed.
     ======================================================================== */

  var MARGIN_BASE = 0.20, MARGIN_FLOOR = 0.10, SETTLE_FLOOR = 1e-12;

  function marginShort(S, K, premium, isCall) {
    if (!(S > 0) || !(K > 0) || !(premium >= 0)) return null;
    var otm = isCall ? Math.max(0, K - S) : Math.max(0, S - K);
    var m1 = premium + MARGIN_BASE * S - otm;
    var m2 = premium + MARGIN_FLOOR * (isCall ? S : K);
    return Math.max(m1, m2);
  }

  function bucket() {
    var X = null;
    try { X = C.X(); } catch (e) { X = null; }
    if (!X) return null;
    if (!X.opt) X.opt = { pos: [], log: [], seq: 1, ticket: null };
    if (!X.opt.pos) X.opt.pos = [];
    if (!X.opt.log) X.opt.log = [];
    if (!X.opt.seq) X.opt.seq = 1;
    return X.opt;
  }
  function positions() { var b = bucket(); return b ? b.pos.slice() : []; }
  function logRows() { var b = bucket(); return b ? b.log.slice() : []; }
  function pushLog(row) {
    var b = bucket();
    if (!b) return;
    b.log.unshift(row);
    if (b.log.length > 40) b.log.length = 40;
  }
  function acct() { try { return typeof S !== "undefined" ? S : null; } catch (e) { return null; } }

  /* The mark of an open claim: what closing it would put back in the account,
     per unit. Long = the bid. Short = margin less the ask. */
  function markOf(pos, ch, now) {
    if (!pos) return null;
    now = now || (C.now ? C.now() : 0);
    var T = (pos.expiry - now) / DAY_MS / YEAR_DAYS;
    var Sp = ch && ch.S > 0 ? ch.S : null;
    if (Sp == null) return null;
    var isCall = pos.kind === "call";
    if (!(T > 0)) {
      var intr = Math.max(0, isCall ? Sp - pos.K : pos.K - Sp);
      return { T: 0, vol: null, value: intr, per: pos.side === "long" ? intr : (pos.margin - intr), expired: true, intrinsic: intr };
    }
    var v = volAtK(ch, pos.K, T);
    if (!(v > 0)) return null;
    var bid = priceOne(Sp, pos.K, T, ch.r, ch.q, Math.max(1e-6, v - SPREAD_VOL_PTS), isCall);
    var ask = priceOne(Sp, pos.K, T, ch.r, ch.q, v + SPREAD_VOL_PTS, isCall);
    var mid = priceOne(Sp, pos.K, T, ch.r, ch.q, v, isCall);
    return {
      T: T, vol: v, value: mid, bid: bid, ask: ask, expired: false,
      per: pos.side === "long" ? bid : (pos.margin - ask)
    };
  }
  function priceOne(S1, K, T, r, q, v, isCall) { var o = bs(S1, K, T, r, q, v, isCall); return o ? o.price : null; }

  /* The surface at an arbitrary (K, T) — the generator evaluated directly, so
     the mark of an open position and the price on the Chain tab are the same
     function of the same five parameters. */
  function volAtK(ch, K, T) {
    if (!ch || !(ch.S > 0) || !(K > 0) || !(T > 0)) return null;
    var F = ch.S * Math.exp((ch.r - ch.q) * T);
    var p = genSlice(ch.rv, T);
    var w = sviW(p, Math.log(K / F));
    return w > 0 ? Math.sqrt(w / T) : null;
  }

  function claimSym(id) { return "OPT" + id; }

  /* Open. Long or short, and a short posts its margin in cash through the same
     call. Returns { ok, reason } and never half-opens: if execFill refuses,
     nothing is recorded. */
  function openPos(spec) {
    var lp = LP(), St = acct();
    if (!lp || typeof lp.execFill !== "function") return { ok: false, reason: "the paper engine is not available" };
    if (!St) return { ok: false, reason: "the account is not ready yet" };
    var b = bucket();
    if (!b) return { ok: false, reason: "the v154 state bucket is not available" };
    var ch = spec.chain;
    if (!ch || !(ch.S > 0)) return { ok: false, reason: "no chain to price this against" };
    var qty = +spec.qty > 0 ? +spec.qty : 0;
    if (!(qty > 0)) return { ok: false, reason: "size must be greater than zero" };
    var isCall = spec.kind === "call", long = spec.side !== "short";
    var T = (spec.expiry - ch.now) / DAY_MS / YEAR_DAYS;
    if (!(T > 0)) return { ok: false, reason: "that expiry has already passed" };
    var v = volAtK(ch, spec.K, T);
    if (!(v > 0)) return { ok: false, reason: "the surface has no vol at that strike" };
    var bid = priceOne(ch.S, spec.K, T, ch.r, ch.q, Math.max(1e-6, v - SPREAD_VOL_PTS), isCall);
    var ask = priceOne(ch.S, spec.K, T, ch.r, ch.q, v + SPREAD_VOL_PTS, isCall);
    if (bid == null || ask == null) return { ok: false, reason: "the model would not price that contract" };

    var margin = long ? 0 : marginShort(ch.S, spec.K, ask, isCall);
    if (!long && !(margin > 0)) return { ok: false, reason: "the margin requirement could not be computed" };
    var per = long ? ask : (margin - bid);
    if (!(per > 0)) return { ok: false, reason: "the net outlay came out at or below zero, which this ticket cannot represent" };

    var id = b.seq++;
    var sym = claimSym(id), quote = spec.quote || "USDT";
    var done = false;
    try { done = !!lp.execFill(St, 0, "buy", sym, quote, qty, per, "options", true); } catch (e) { done = false; }
    if (!done) {
      b.seq--;
      return { ok: false, reason: long
        ? "not enough " + quote + " for the premium (" + fmtQ(per * qty, quote) + ")"
        : "not enough " + quote + " for the margin less the premium (" + fmtQ(per * qty, quote) + ")" };
    }
    var pos = {
      id: id, claim: sym, sym: ch.sym, quote: quote, kind: isCall ? "call" : "put",
      side: long ? "long" : "short", qty: qty, K: spec.K, expiry: spec.expiry,
      openAt: ch.now, openVol: v, openBid: bid, openAsk: ask, openPer: per,
      premiumPer: long ? ask : bid, margin: margin, r: ch.r, q: ch.q, tag: spec.tag || null
    };
    b.pos.push(pos);
    lastPx(sym, per);
    pushLog({ t: ch.now, act: "open", id: id, text: (long ? "long " : "short ") + qty + " " + ch.sym + " " + dayLabel(spec.expiry) + " " + spec.K + (isCall ? " call" : " put") + " at " + fmtQ(long ? ask : bid, quote) + (long ? "" : ", margin " + fmtQ(margin * qty, quote)) });
    try { C.save(); } catch (e) {}
    try { if (typeof updateNavBal === "function") updateNavBal(); } catch (e) {}
    try { C.sfx && C.sfx("buy"); } catch (e) {}
    try { C.toast && C.toast("good", "Option opened" + (C.simTag ? C.simTag() : ""), pos.side + " " + qty + " " + ch.sym + " " + spec.K + " " + pos.kind + " at " + (v * 100).toFixed(1) + "% vol"); } catch (e) {}
    return { ok: true, pos: pos };
  }

  /* The app prices unknown symbols off its own last-price cache, so writing
     the desk's model mark there is what makes the portfolio show an open
     contract at the same number the Positions tab shows. It is a PRICE cache,
     not a balance: nothing here moves money. */
  function lastPx(sym, px) {
    try {
      var St = acct();
      if (!St || !(px >= 0)) return;
      if (!St.lastPx) St.lastPx = {};
      St.lastPx[sym] = px;
    } catch (e) {}
  }

  function closePos(id, ch, why) {
    var lp = LP(), St = acct(), b = bucket();
    if (!lp || !St || !b) return { ok: false, reason: "the paper engine is not available" };
    var pos = null, i;
    for (i = 0; i < b.pos.length; i++) if (b.pos[i].id === id) pos = b.pos[i];
    if (!pos) return { ok: false, reason: "no such position" };
    var m = markOf(pos, ch);
    if (!m) return { ok: false, reason: "the position cannot be marked right now — no spot price" };
    var per = m.per, breach = 0;
    if (!(per > 0)) { breach = -Math.min(0, per); per = SETTLE_FLOOR; }
    var done = false;
    try { done = !!lp.execFill(St, 0, "sell", pos.claim, pos.quote, pos.qty, per, "options", true); } catch (e) { done = false; }
    if (!done) return { ok: false, reason: "the engine would not settle the claim — is it still in the account?" };
    if (breach > 0 && typeof lp.chargeNetwork === "function") {
      try { lp.chargeNetwork(St, pos.quote, breach * pos.qty, "Options margin breach on " + pos.claim); } catch (e) {}
    }
    var pl = (per - pos.openPer) * pos.qty - breach * pos.qty;
    for (i = 0; i < b.pos.length; i++) if (b.pos[i].id === id) { b.pos.splice(i, 1); break; }
    pushLog({
      t: C.now ? C.now() : 0, act: why || "close", id: id,
      text: (why === "expiry" ? "settled " : "closed ") + pos.side + " " + pos.qty + " " + pos.sym + " " + pos.K + " " + pos.kind +
        (m.expired ? " at intrinsic " + fmtQ(m.intrinsic, pos.quote) : " at " + fmtQ(m.per, pos.quote)) +
        (breach > 0 ? " — MARGIN BREACH of " + fmtQ(breach * pos.qty, pos.quote) + " charged to the account" : ""),
      pl: pl
    });
    try { C.save(); } catch (e) {}
    try { if (typeof updateNavBal === "function") updateNavBal(); } catch (e) {}
    try { C.toast && C.toast(pl >= 0 ? "good" : "bad", why === "expiry" ? "Option settled" : "Option closed", (pl >= 0 ? "+" : "−") + fmtQ(Math.abs(pl), pos.quote) + (breach > 0 ? " · margin breach charged" : "")); } catch (e) {}
    return { ok: true, pl: pl, breach: breach, mark: m };
  }

  /* Cash-settled expiry. Every position past its expiry timestamp settles to
     intrinsic on the next mark — nothing is left to rot in the book. */
  function settleDue(ch) {
    var b = bucket();
    if (!b || !b.pos.length || !ch || !(ch.S > 0)) return 0;
    var now = ch.now || (C.now ? C.now() : 0), n = 0, i;
    var due = [];
    for (i = 0; i < b.pos.length; i++) if (b.pos[i].expiry <= now) due.push(b.pos[i].id);
    for (i = 0; i < due.length; i++) if (closePos(due[i], ch, "expiry").ok) n++;
    return n;
  }

  function markAll(ch) {
    var b = bucket();
    if (!b || !ch) return [];
    var out = [], i, m, pos;
    for (i = 0; i < b.pos.length; i++) {
      pos = b.pos[i];
      m = markOf(pos, ch);
      if (m && m.per != null) lastPx(pos.claim, Math.max(0, m.per));
      out.push({
        pos: pos, mark: m,
        unreal: m && m.per != null ? (m.per - pos.openPer) * pos.qty : null,
        marginTied: pos.side === "short" ? pos.margin * pos.qty : 0
      });
    }
    return out;
  }

  /* ========================================================================
     9 · THE HONESTY BLOCK
     ======================================================================== */

  var ASSUMPTIONS = [
    "THERE IS NO OPTIONS VENUE FEED IN THIS APP. Nobody publishes a chain to it, and nothing on the Chain tab is a quote. Every strike, every premium and every greek is GENERATED here from the app's own live spot price and a model surface. These are model prices. No venue will fill them and no venue was asked.",
    "The surface is anchored on REALISED volatility, computed from the coin's 56-point sparkline — the CoinGecko 7-day hourly series truncated to its last 56 hours — so the annualisation factor is sqrt(24*365), read off the real bar size. If the coin carries no usable series the desk falls back to FALLBACK_VOL = 60% and labels it 'fallback' where it is used. The payload itself synthesises a sparkline for a coin that has none, and a vol measured off a synthesised series is a vol measured off nothing.",
    "Implied sits above realised by a VOLATILITY RISK PREMIUM of VRP = 1.10, and the term structure pulls toward LONG_VOL = 65% with a time constant TERM_TAU = 0.25 years. All three are ASSUMED CONSTANTS. They are not estimated from anything, and on a given day they will be wrong.",
    "The skew is an assumption with a printed shape: rho = -0.30, SVI sig = 0.10, and an at-the-money skew of SKEW_30 = -0.09 vol per unit of log-moneyness at 30 days, decayed as sqrt(30/days). You can read all five raw-SVI parameters of every expiry on the Surface tab. A real crypto surface has a skew that moves; this one does not.",
    "Bid and ask are the surface vol minus and plus SPREAD_VOL_PTS = 1 vol point. That width is a fixed modelling constant, not a measured market width. It is the ONLY trading cost on this desk: no commission, no exercise fee, no funding, no borrow.",
    "r and q are INPUTS YOU TYPE, not measurements. r defaults to 4% and q to 0. Nothing in this app measures a crypto carry rate, and for a coin with staking or perp funding the honest q is neither zero nor constant.",
    "Contracts are on ONE unit of the underlying and are cash-settled at expiry against the app's spot price. There is no 100-share multiplier, no physical delivery, no assignment before expiry for the short side, and no exercise decision for the long side — an in-the-money long settles automatically.",
    "The short-option MARGIN is the Reg T / CBOE minimum for an uncovered equity option: max(premium + 0.20*S - OTM, premium + 0.10*X). MARGIN_BASE = 0.20 and MARGIN_FLOOR = 0.10 are US listed-equity numbers and NO crypto venue uses them — venues run portfolio margin, usually asking less and re-asking it as the position moves. This is a teaching number with a published source, not a venue's requirement.",
    "A paper position is held in the account as a synthetic CLAIM symbol bought at its net cash outlay, because the engine that owns the account can hold a long position and move cash but cannot hold a negative one. The desk writes its model mark into the app's own last-price cache so the portfolio values an open contract at the same number the Positions tab shows. It never assigns to a balance.",
    "The American premium comes from a CRR binomial on the same inputs. A binomial is a discretisation: the convergence table on the Chain tab shows the European tree against the closed form as N grows, and the error oscillates while it falls. Read the premium as an order of magnitude, not as a price.",
    "Probability of profit is computed under the RISK-NEUTRAL measure, with drift r - q - sigma^2/2 and the horizon's at-the-money vol. That is the pricing drift, not a forecast of anything. Under a real-world drift the same structure has a different probability of profit, and this desk does not claim to know that drift."
  ];

  var METHOD = [
    ["The normal law", "Hart's 1968 rational approximation in the arrangement West published in 2005, accurate to about 1e-15 absolute — full double precision. The tutorial standby, Abramowitz & Stegun 7.1.26, is only good to 7.5e-8, and that is not enough here for two reasons: Newton on implied vol divides a price error by vega, so for a short-dated wing where vega is 1e-3 a 7.5e-8 CDF error becomes tens of vol points; and 7.1.26's error is a polynomial ripple rather than a smooth bias, so the analytic vega and the finite-difference vega of the same pricer stop agreeing and Newton can cycle instead of converging."],
    ["Black-Scholes-Merton", "d1 = (ln(S/K) + (r - q + v^2/2)T) / (v sqrt(T)), d2 = d1 - v sqrt(T); call = S e^(-qT) N(d1) - K e^(-rT) N(d2); put = K e^(-rT) N(-d2) - S e^(-qT) N(-d1). Merton (1973) is the continuous-carry form. Every greek is analytic, not bumped: delta, gamma, vega, theta (per year AND per day, both labelled), rho, plus vanna = -e^(-qT) n(d1) d2/v and volga = vega d1 d2/v. With no time or no vol left there is no distribution, only the discounted forward intrinsic, and the curvature at the kink is returned as missing rather than as zero."],
    ["Put-call parity", "C - P = S e^(-qT) - K e^(-rT), checked as an identity rather than assumed. The Method tab prints the residual so you can see it is machine epsilon and not a hope."],
    ["Implied vol", "Bounds first: a call price must sit inside [max(0, S e^(-qT) - K e^(-rT)), S e^(-qT)] and a put inside [max(0, K e^(-rT) - S e^(-qT)), K e^(-rT)]. Outside that band NO vol reproduces the price and iv() returns null with the reason — never a zero, never a clamp. At the lower bound the only consistent vol is zero and that is what comes back. Inside: a Brenner-Subrahmanyam seed in the Bharadia-Christofides-Salkin form, then Newton on vega for at most 60 steps to a price residual of 1e-12*max(1,K); a step that leaves (1e-9, 10) or meets a vega under 1e-10 hands over to bisection on a bracket PROVEN by the monotonicity of price in vol, 200 halvings deep."],
    ["The surface", "Strikes in log-moneyness k = ln(K/F), expiries in total variance w = sigma^2 T. Per expiry a raw SVI slice w(k) = a + b(rho(k-m) + sqrt((k-m)^2 + sig^2)) (Gatheral 2004; Gatheral & Jacquier 2014), fitted by coordinate descent with golden-section line searches, restarted twelve times from a van der Corput low-discrepancy sequence offset by an FNV-1a hash of the slice's own inputs. Nothing on this path is random: the same slice always fits to the same five numbers."],
    ["The arbitrage check", "Fitting and checking are separate on purpose. Butterfly: Durrleman's g(k) = (1 - k w'/(2w))^2 - (w'^2/4)(1/w + 1/4) + w''/2 must be non-negative everywhere, which is exactly the statement that the risk-neutral density is non-negative; g < 0 somewhere IS a butterfly with a negative cost and a non-negative payoff. Calendar: total variance must be non-decreasing in T at every k. Both are reported with the worst k and the size of the violation, and a surface that fails is shown as failing."],
    ["American exercise", "Cox-Ross-Rubinstein (1979): dt = T/N, u = e^(v sqrt(dt)), d = 1/u, p = (e^((r-q)dt) - d)/(u - d). At every node the American holder takes the better of continuation and intrinsic, and the step at which that flips is the EARLY-EXERCISE BOUNDARY, extracted from the tree rather than described. The premium is American minus European ON THE SAME TREE, so it is a like-for-like difference. p outside (0,1) means the tree is not a probability at that N, and crr() says so instead of pricing."],
    ["Structures", "A structure is a list of signed legs. The payoff horizon is the NEAREST expiry in it; a leg that outlives the horizon is marked with Black-Scholes at its remaining life, which is the only reason a calendar spread has a shape at all. Breakevens come from bisecting every sign change of the profit curve to 1e-12 of the underlying. Max profit and max loss come from the kinks, from the value at S = 0 and from the measured slope as S grows: the underlying cannot go below zero, so the downside extreme is always a number and only the upside can run away. When it does, the answer is the word UNBOUNDED, never a large number, because a large number invites a position size."],
    ["Probability of profit", "The profitable region is read off the same profit function the payoff chart draws, then integrated exactly against the lognormal — no Monte Carlo. ln S_H is normal with mean ln S + (r - q - sigma^2/2)H and variance sigma^2 H, sigma being the horizon's at-the-money vol. The drift is named in the output because a probability of profit without its drift assumption is a number pretending to be a forecast."],
    ["Money", "A position is a claim ticket bought through the engine at its net cash outlay and sold back at what closing it returns: for a long, the ask in and the bid out; for a short, margin less the bid in and margin less the ask out, so the short's margin is tied up the whole time it is open. Expiry is cash-settled at intrinsic. A settlement bigger than the posted margin is a margin breach and the shortfall is charged, not forgiven."]
  ];

  /* ========================================================================
     10 · FORMATTING
     ======================================================================== */

  function esc(s) { try { return C.esc ? C.esc(String(s)) : String(s).replace(/[&<>"]/g, ""); } catch (e) { return ""; } }
  function fmtQ(n, q) {
    if (n == null || !isFinite(n)) return "—";
    try { if (C.money && (q === "USDT" || q === "USD" || q == null)) return C.money(n); } catch (e) {}
    return num(n) + " " + (q || "");
  }
  function num(n) {
    if (n == null || !isFinite(n)) return "—";
    var a = Math.abs(n);
    if (a >= 1000) return n.toFixed(0);
    if (a >= 1) return n.toFixed(2);
    if (a >= 0.01) return n.toFixed(4);
    if (a === 0) return "0";
    return n.toExponential(2);
  }
  function pctv(v) { return v == null || !isFinite(v) ? "—" : (v * 100).toFixed(2) + "%"; }
  function sig4(n) { return n == null || !isFinite(n) ? "—" : (Math.abs(n) >= 1 ? n.toFixed(4) : n.toPrecision(4)); }
  function unbounded(v, isUnb, q) { return isUnb ? ('<b class="opt-unb">' + window.DLI18N.t("56-options.75cf685d0646") + '</b>') : fmtQ(v, q); }

  /* ========================================================================
     11 · THE DESK
     ======================================================================== */

  var ST = { ch: null, sf: null, exp: 2, strat: "bull-call", qty: 1 };

  function ticket(patch) {
    var b = bucket();
    var base = { sym: "BTC", r: 0.04, q: 0, quote: "USDT", qty: 1, N: 200 };
    if (!b) return patch ? mergeObj(base, patch) : base;
    if (!b.ticket) b.ticket = base;
    if (patch) { b.ticket = mergeObj(b.ticket, patch); try { C.save(); } catch (e) {} }
    return b.ticket;
  }
  function mergeObj(a, b) {
    var o = {}, k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) o[k] = a[k];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) o[k] = b[k];
    return o;
  }

  function rebuild() {
    var t = ticket();
    ST.ch = chain(t.sym, t.r, t.q, C.now ? C.now() : 0);
    if (ST.ch && ST.ch.S > 0) { try { settleDue(ST.ch); } catch (e) {} }
    return ST.ch;
  }

  function header(ch) {
    if (!ch || ch.S == null) return '<div class="opt-empty">' + esc((ch && ch.note) || "no market") + "</div>";
    return '<div class="opt-head"><span class="opt-pair">' + esc(ch.sym) + " " + fmtQ(ch.S, "USDT") + '</span>' +
      ('<span class="opt-meta">' + window.DLI18N.t("56-options.65a134db059d") + '') + pctv(ch.rv) + " (" + esc(ch.rvSrc) + ", " + ch.rvBars + " hourly bars) · r " + pctv(ch.r) + " · q " + pctv(ch.q) + '</span></div>' +
      ('<div class="opt-strip">' + window.DLI18N.t("56-options.066b4075dc15") + '</div>');
  }

  function paneChain() {
    var ch = rebuild();
    if (!ch || ch.S == null) return '<div class="opt-empty">' + esc((ch && ch.note) || "no market") + "</div>";
    var t = ticket(), h = header(ch), i;
    h += '<div class="dl-2 opt-form">' +
      fld("Symbol", '<input id="optSym" class="dl-inp" type="text" value="' + esc(t.sym) + '" spellcheck="false" autocomplete="off" aria-label="Symbol">') +
      fld("r (rate, %)", '<input id="optR" class="dl-inp" type="number" step="any" value="' + (t.r * 100) + '" aria-label="Risk free rate percent">') +
      fld("q (carry, %)", '<input id="optQ" class="dl-inp" type="number" step="any" value="' + (t.q * 100) + '" aria-label="Carry yield percent">') +
      fld("Size (contracts)", '<input id="optQty" class="dl-inp" type="number" min="0" step="any" value="' + esc(t.qty) + '" aria-label="Size in contracts">') +
      ('</div><div class="opt-actions"><button class="dl-b" id="optGo">' + window.DLI18N.t("56-options.cd9255979a89") + '</button></div>');

    h += ('<div class="opt-sub">' + window.DLI18N.t("56-options.6956d81401b8") + '</div><div class="dl-chips opt-exps">');
    for (i = 0; i < ch.expiries.length; i++) {
      h += '<button class="dl-chip' + (i === ST.exp ? " on" : "") + '" data-exp="' + i + '">' + ch.expiries[i].days + "d · " + esc(ch.expiries[i].label) + "</button>";
    }
    h += "</div>";

    var e = ch.expiries[Math.min(ST.exp, ch.expiries.length - 1)];
    h += '<div class="opt-note">' + e.days + " days (T = " + e.T.toFixed(4) + "y) · forward " + fmtQ(e.F, "USDT") + " · at-the-money vol " + pctv(e.atmVol) +
      " · slice a=" + sig4(e.gen.a) + " b=" + sig4(e.gen.b) + " rho=" + sig4(e.gen.rho) + " m=" + sig4(e.gen.m) + " sig=" + sig4(e.gen.sig) + "</div>";
    h += '<div class="dl-tblw"><table class="dl-tbl opt-chain"><thead><tr>' +
      ('<th>' + window.DLI18N.t("56-options.92c872eb9eff") + '</th><th class="r">' + window.DLI18N.t("56-options.8254c329a928") + '</th><th class="r">' + window.DLI18N.t("56-options.b9f6da279ec5") + '</th><th class="r">' + window.DLI18N.t("56-options.59aa3f5873fb") + '</th><th class="r">' + window.DLI18N.t("56-options.9449d53f774d") + '</th><th class="r">' + window.DLI18N.t("56-options.4f4a9410ffcd") + '</th><th class="r">' + window.DLI18N.t("56-options.be9d587defa1") + '</th><th class="r">' + window.DLI18N.t("56-options.ed9f316c1b9a") + '</th><th class="r">' + window.DLI18N.t("56-options.67d2cd9e39ce") + '</th><th class="r">' + window.DLI18N.t("56-options.8f9149e193a2") + '</th><th class="r">' + window.DLI18N.t("56-options.dc4c608d1020") + '</th><th>' + window.DLI18N.t("56-options.9709653fc80c") + '</th>') +
      "</tr></thead><tbody>";
    for (i = 0; i < e.rows.length; i++) {
      var R = e.rows[i];
      h += "<tr" + (R.atm ? ' data-atm="1"' : "") + '><td class="opt-k">' + num(R.K) + "</td>" +
        '<td class="r">' + R.k.toFixed(4) + "</td>" +
        '<td class="r">' + pctv(R.vol) + "</td>" +
        '<td class="r">' + fmtQ(R.callBid, "USDT") + "</td>" +
        '<td class="r">' + fmtQ(R.callAsk, "USDT") + "</td>" +
        '<td class="r">' + sig4(R.call.delta) + "</td>" +
        '<td class="r">' + sig4(R.call.gamma) + "</td>" +
        '<td class="r">' + sig4(R.call.vegaPt) + "</td>" +
        '<td class="r">' + sig4(R.call.thetaDay) + "</td>" +
        '<td class="r">' + fmtQ(R.putBid, "USDT") + "</td>" +
        '<td class="r">' + fmtQ(R.putAsk, "USDT") + "</td>" +
        '<td class="opt-trade">' +
        btn("long", "call", R.K, e.expiry, "+C") + btn("short", "call", R.K, e.expiry, "−C") +
        btn("long", "put", R.K, e.expiry, "+P") + btn("short", "put", R.K, e.expiry, "−P") +
        "</td></tr>";
    }
    h += "</tbody></table></div>";
    h += ('<div class="opt-legend">' + window.DLI18N.t("56-options.ace3650b6359") + '</div>');

    /* the American premium and the convergence of the tree, for the ATM strike */
    var atm = e.rows[e.atmIndex];
    if (atm) {
      var ap = americanPremium(ch.S, atm.K, e.T, ch.r, ch.q, atm.vol, false, t.N || 200);
      h += ('<div class="opt-sub">' + window.DLI18N.t("56-options.e6cb69f010d0") + '') + num(atm.K) + (window.DLI18N.t("56-options.8ecbc0212d57") + "</div>");
      if (ap) {
        h += '<div class="opt-grid">' +
          kv("American (N=" + ap.N + ")", fmtQ(ap.american, "USDT")) +
          kv("European, same tree", fmtQ(ap.europeanTree, "USDT")) +
          kv("European, closed form", fmtQ(ap.europeanClosed, "USDT")) +
          kv("Early-exercise premium", fmtQ(ap.premium, "USDT") + (ap.premiumPct != null ? " (" + (ap.premiumPct * 100).toFixed(2) + "%)" : "")) +
          kv("Tree minus closed form", sig4(ap.treeVsClosed)) +
          kv("Step probability p", sig4(ap.p)) +
          "</div>";
        var bnd = ap.boundary, bi, shown = 0, bh = "";
        for (bi = 0; bi < bnd.length && shown < 8; bi += Math.max(1, Math.floor(bnd.length / 8))) {
          if (bnd[bi] && bnd[bi].S != null) { bh += "<tr><td>" + ((e.T - bnd[bi].t) * YEAR_DAYS).toFixed(1) + (window.DLI18N.t("56-options.b87d96774af7") + "</td><td class=\"r\">") + num(bnd[bi].S) + "</td></tr>"; shown++; }
        }
        h += bh
          ? ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("56-options.864927fe11e0") + '</th><th class="r">' + window.DLI18N.t("56-options.44187bec7acf") + '</th></tr></thead><tbody>') + bh + "</tbody></table></div>"
          : ('<div class="opt-note">' + window.DLI18N.t("56-options.8e87b97c3502") + '') + pctv(ch.q) + (window.DLI18N.t("56-options.7014a5c20e75") + "</div>");
      }
      var conv = crrConverge(ch.S, atm.K, e.T, ch.r, ch.q, atm.vol, true, [25, 50, 100, 200, 400, 800]);
      h += ('<div class="opt-sub">' + window.DLI18N.t("56-options.e18285db2537") + '') + num(atm.K) + ('' + window.DLI18N.t("56-options.3481fe9faa90") + '</div>');
      h += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("56-options.8ce86a6ae65d") + '</th><th class="r">' + window.DLI18N.t("56-options.312e08e8acdf") + '</th><th class="r">' + window.DLI18N.t("56-options.6427e0429960") + '</th><th class="r">' + window.DLI18N.t("56-options.ca00fccfb408") + '</th><th class="r">' + window.DLI18N.t("56-options.0baaf6f25d1c") + '</th><th class="r">' + window.DLI18N.t("56-options.870dc23d2183") + '</th></tr></thead><tbody>');
      for (i = 0; i < conv.length; i++) {
        h += "<tr><td>" + conv[i].N + '</td><td class="r">' + sig4(conv[i].euro) + '</td><td class="r">' + sig4(conv[i].closed) + '</td><td class="r">' + sig4(conv[i].err) + '</td><td class="r">' + sig4(conv[i].amer) + '</td><td class="r">' + sig4(conv[i].premium) + "</td></tr>";
      }
      h += ("</tbody></table></div><div class=\"opt-legend\">" + window.DLI18N.t("56-options.94b61d855385") + "</div>");
    }
    return h;
  }

  function btn(side, kind, K, expiry, label) {
    return '<button class="dl-b opt-t" data-act="open" data-side="' + side + '" data-kind="' + kind + '" data-k="' + K + '" data-x="' + expiry + '">' + label + "</button>";
  }
  function fld(label, inner) { return '<label class="opt-f"><span class="opt-fl">' + esc(label) + "</span>" + inner + "</label>"; }
  function kv(k, v) { return '<div class="opt-kv"><span>' + esc(k) + "</span><b>" + v + "</b></div>"; }

  /* A pair of slices kept here on purpose: one that passes Durrleman and one
     that does not. A check nobody has ever seen fail is a check nobody should
     believe, so the desk shows both every time. */
  var DEMO_GOOD = { a: 0.02, b: 0.20, rho: -0.30, m: 0.00, sig: 0.15 };
  var DEMO_BAD = { a: 0.005, b: 0.35, rho: -0.85, m: 0.05, sig: 0.02 };

  function paneSurface() {
    var ch = ST.ch || rebuild();
    if (!ch || ch.S == null) return '<div class="opt-empty">' + esc((ch && ch.note) || "no market") + "</div>";
    var sf = surface(ch);
    ST.sf = sf;
    var h = header(ch), i, j;
    h += ('<div class="opt-note">' + window.DLI18N.t("56-options.a3e20bff6a17") + '</div>');
    h += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("56-options.6956d81401b8") + '</th><th class="r">' + window.DLI18N.t("56-options.ca978112ca1b") + '</th><th class="r">' + window.DLI18N.t("56-options.3e23e8160039") + '</th><th class="r">' + window.DLI18N.t("56-options.0ddbc6c1d81a") + '</th><th class="r">' + window.DLI18N.t("56-options.62c66a7a5dd7") + '</th><th class="r">' + window.DLI18N.t("56-options.a543997d84f1") + '</th><th class="r">' + window.DLI18N.t("56-options.1ffb32b9312e") + '</th><th class="r">' + window.DLI18N.t("56-options.a7e52e98a4bf") + '</th><th>' + window.DLI18N.t("56-options.a30f6a02eaa2") + '</th></tr></thead><tbody>');
    for (i = 0; i < sf.slices.length; i++) {
      var s = sf.slices[i], f = s.fit;
      h += '<tr><td class="opt-k">' + s.days + (window.DLI18N.t("56-options.45742ce86258") + "</td><td class=\"r\">") + sig4(s.gen.a) + '</td><td class="r">' + sig4(s.gen.b) + '</td><td class="r">' + sig4(s.gen.rho) + '</td><td class="r">' + sig4(s.gen.m) + '</td><td class="r">' + sig4(s.gen.sig) + '</td><td class="r">—</td><td class="r">' + sig4(butterfly(s.gen, -1.5, 1.5, 121).minG) + ('</td><td>' + window.DLI18N.t("56-options.9123dcbb0b42") + '</td></tr>');
      if (f && f.ok) {
        h += '<tr><td class="opt-k">' + s.days + ('' + window.DLI18N.t("56-options.42a1abe93cee") + '</td><td class="r">') + sig4(f.p.a) + '</td><td class="r">' + sig4(f.p.b) + '</td><td class="r">' + sig4(f.p.rho) + '</td><td class="r">' + sig4(f.p.m) + '</td><td class="r">' + sig4(f.p.sig) + '</td><td class="r">' + sig4(f.rmse) + '</td><td class="r">' + sig4(f.butterfly.minG) + '</td><td>' +
          (f.butterfly.ok ? ('<span class="opt-ok">' + window.DLI18N.t("56-options.2c28ec094b83") + '</span>') : ('<span class="opt-bad">' + window.DLI18N.t("56-options.79f9a73c3c93") + '') + f.butterfly.atK.toFixed(3) + ", " + f.butterfly.negPoints + " of " + f.butterfly.tested + (window.DLI18N.t("56-options.ee12266b32f6") + "</span>")) + "</td></tr>";
      } else {
        h += '<tr><td class="opt-k">' + s.days + ('' + window.DLI18N.t("56-options.42a1abe93cee") + '</td><td colspan="8">') + esc((f && f.reason) || "not fitted") + "</td></tr>";
      }
    }
    h += "</tbody></table></div>";

    /* the implied-vol round trip, which is also a test of iv() */
    var worst = 0, worstAt = null, nBad = 0, total = 0;
    for (i = 0; i < sf.slices.length; i++) {
      for (j = 0; j < sf.slices[i].ivs.length; j++) {
        var iv1 = sf.slices[i].ivs[j];
        total++;
        if (iv1.iv == null) { nBad++; continue; }
        var d = Math.abs(iv1.iv - iv1.gen);
        if (d > worst) { worst = d; worstAt = sf.slices[i].days + "d K=" + num(iv1.K); }
      }
    }
    h += '<div class="opt-grid">' +
      kv("Implied-vol round trip", total + " strikes priced then re-solved") +
      kv("Worst vol error", worst.toExponential(2) + (worstAt ? " at " + esc(worstAt) : "")) +
      kv("Strikes with no implied vol", nBad + (nBad ? " (outside the no-arbitrage band, or zero vega)" : "")) +
      "</div>";

    h += ('<div class="opt-sub">' + window.DLI18N.t("56-options.a23d12f9cffa") + '</div>');
    if (sf.calendar && sf.calendar.pairs.length) {
      h += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("56-options.989da04b0aaa") + '</th><th class="r">' + window.DLI18N.t("56-options.c0f4d7a22f36") + '</th><th class="r">' + window.DLI18N.t("56-options.4b303797a03f") + '</th><th>' + window.DLI18N.t("56-options.4a36f89dafb0") + '</th></tr></thead><tbody>');
      for (i = 0; i < sf.calendar.pairs.length; i++) {
        var pr = sf.calendar.pairs[i];
        h += "<tr><td>" + (pr.from * YEAR_DAYS).toFixed(0) + "d to " + (pr.to * YEAR_DAYS).toFixed(0) + ('' + window.DLI18N.t("56-options.18ac3e7343f0") + '</td><td class="r">') + sig4(pr.minGap) + '</td><td class="r">' + (pr.atK == null ? "—" : pr.atK.toFixed(3)) + "</td><td>" +
          (pr.ok ? ('<span class="opt-ok">' + window.DLI18N.t("56-options.74bc9fb5bd59") + '</span>') : ('<span class="opt-bad">' + window.DLI18N.t("56-options.169441fbe464") + '') + pr.badPoints + (window.DLI18N.t("56-options.bbbc02efdd44") + "</span>")) + "</td></tr>";
      }
      h += "</tbody></table></div>";
    } else h += ('<div class="opt-note">' + window.DLI18N.t("56-options.b5c59e05f317") + '</div>');

    var bg = butterfly(DEMO_GOOD, -1.5, 1.5, 241), bb = butterfly(DEMO_BAD, -1.5, 1.5, 241);
    h += ('<div class="opt-sub">' + window.DLI18N.t("56-options.9ee420a3052d") + '</div><div class="opt-note">' + window.DLI18N.t("56-options.dcdd903c8c10") + '</div>') +
      ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("56-options.87bd78650264") + '</th><th class="r">' + window.DLI18N.t("56-options.ca978112ca1b") + '</th><th class="r">' + window.DLI18N.t("56-options.3e23e8160039") + '</th><th class="r">' + window.DLI18N.t("56-options.0ddbc6c1d81a") + '</th><th class="r">' + window.DLI18N.t("56-options.62c66a7a5dd7") + '</th><th class="r">' + window.DLI18N.t("56-options.a543997d84f1") + '</th><th class="r">' + window.DLI18N.t("56-options.a7e52e98a4bf") + '</th><th>' + window.DLI18N.t("56-options.7dfd134957f3") + '</th></tr></thead><tbody>') +
      ('<tr><td class="opt-k">' + window.DLI18N.t("56-options.be8e11ccfae3") + '</td><td class="r">') + sig4(DEMO_GOOD.a) + '</td><td class="r">' + sig4(DEMO_GOOD.b) + '</td><td class="r">' + sig4(DEMO_GOOD.rho) + '</td><td class="r">' + sig4(DEMO_GOOD.m) + '</td><td class="r">' + sig4(DEMO_GOOD.sig) + '</td><td class="r">' + sig4(bg.minG) + "</td><td>" + (bg.ok ? ('<span class="opt-ok">' + window.DLI18N.t("56-options.2c28ec094b83") + '</span>') : ('<span class="opt-bad">' + window.DLI18N.t("56-options.c1481e2eb555") + '</span>')) + "</td></tr>" +
      ('<tr><td class="opt-k">' + window.DLI18N.t("56-options.78b1aa3bbca5") + '</td><td class="r">') + sig4(DEMO_BAD.a) + '</td><td class="r">' + sig4(DEMO_BAD.b) + '</td><td class="r">' + sig4(DEMO_BAD.rho) + '</td><td class="r">' + sig4(DEMO_BAD.m) + '</td><td class="r">' + sig4(DEMO_BAD.sig) + '</td><td class="r">' + sig4(bb.minG) + "</td><td>" + (bb.ok ? ('<span class="opt-bad">' + window.DLI18N.t("56-options.49233e8f4eb9") + '</span>') : ('<span class="opt-ok">' + window.DLI18N.t("56-options.fbebc603cd94") + '') + bb.atK.toFixed(3) + ")</span>") + "</td></tr>" +
      "</tbody></table></div>";
    h += ('<div class="opt-legend">' + window.DLI18N.t("56-options.9db55f775099") + '< 0 there is a butterfly spread with a negative cost and a payoff that cannot be negative — the surface is claiming a free lunch, and this desk prints it rather than smoothing it away.</div>');
    return h;
  }

  function paneBuilder() {
    var ch = ST.ch || rebuild();
    if (!ch || ch.S == null) return '<div class="opt-empty">' + esc((ch && ch.note) || "no market") + "</div>";
    var t = ticket(), i;
    var h = header(ch);
    h += ('<div class="opt-sub">' + window.DLI18N.t("56-options.7203c2b3dad3") + '</div><div class="dl-chips opt-strats">');
    for (i = 0; i < STRATS.length; i++) {
      h += '<button class="dl-chip' + (STRATS[i].id === ST.strat ? " on" : "") + '" data-strat="' + esc(STRATS[i].id) + '">' + esc(STRATS[i].name) + "</button>";
    }
    h += "</div>";
    h += '<div class="dl-chips opt-exps">';
    for (i = 0; i < ch.expiries.length; i++) h += '<button class="dl-chip' + (i === ST.exp ? " on" : "") + '" data-exp="' + i + '">' + ch.expiries[i].days + (window.DLI18N.t("56-options.18ac3e7343f0") + "</button>");
    h += "</div>";

    var st = strategy(ST.strat, ch, { expiry: ST.exp, qty: +t.qty > 0 ? +t.qty : 1 });
    if (!st) return h + ('<div class="opt-empty">' + window.DLI18N.t("56-options.7c5c140ed9e8") + '</div>');
    if (!st.legs.length) return h + '<div class="opt-empty">' + esc(st.reason || "no legs") + "</div>";
    h += '<div class="opt-note"><b>' + esc(st.name) + "</b> — " + esc(st.note) + "</div>";
    h += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("56-options.7c94ee113e1b") + '</th><th class="r">' + window.DLI18N.t("56-options.32e8369a9c4f") + '</th><th class="r">' + window.DLI18N.t("56-options.7cd58cdd64a3") + '</th><th class="r">' + window.DLI18N.t("56-options.ab51004e9d71") + '</th><th class="r">' + window.DLI18N.t("56-options.b9f6da279ec5") + '</th><th class="r">' + window.DLI18N.t("56-options.90ac16783fbc") + '</th><th class="r">' + window.DLI18N.t("56-options.cb08ecc9ed45") + '</th></tr></thead><tbody>');
    for (i = 0; i < st.legs.length; i++) {
      var L = st.legs[i];
      var cash = L.qty > 0 ? L.qty * (L.ask == null ? L.px : L.ask) : L.qty * (L.bid == null ? L.px : L.bid);
      h += "<tr><td>" + esc(L.kind) + '</td><td class="r">' + (L.qty > 0 ? "+" : "") + num(L.qty) + '</td><td class="r">' + (L.K == null ? "—" : num(L.K)) + '</td><td class="r">' + (L.T == null ? "—" : (L.T * YEAR_DAYS).toFixed(0)) + '</td><td class="r">' + (L.v == null ? "—" : pctv(L.v)) + '</td><td class="r">' + fmtQ(L.px, "USDT") + '</td><td class="r">' + (cash >= 0 ? "−" : "+") + fmtQ(Math.abs(cash), "USDT") + "</td></tr>";
    }
    h += "</tbody></table></div>";

    var an = st.analysis, be = "";
    for (i = 0; i < an.breakevens.length; i++) be += (i ? ", " : "") + num(an.breakevens[i]);
    h += '<div class="opt-grid">' +
      kv("Net " + (an.cost >= 0 ? "debit" : "credit"), fmtQ(Math.abs(an.cost), "USDT")) +
      kv("Horizon", (an.horizonYears * YEAR_DAYS).toFixed(0) + " days (the nearest expiry in the structure)") +
      kv("Breakevens", be || "none — the structure never crosses zero") +
      kv("Max profit", unbounded(an.maxProfit, an.maxProfitUnbounded, "USDT") + (an.maxProfitUnbounded ? "" : " at " + num(an.maxProfitAt))) +
      kv("Max loss", unbounded(an.maxLoss, an.maxLossUnbounded, "USDT") + (an.maxLossUnbounded ? "" : " at " + num(an.maxLossAt))) +
      kv("P(profit), risk-neutral", st.pop ? (st.pop.p * 100).toFixed(1) + "%" : "—") +
      "</div>";
    h += ('<div class="opt-legend">' + window.DLI18N.t("56-options.47116382af6d") + '') + pctv(st.pop ? st.pop.sigma : null) + ('' + window.DLI18N.t("56-options.12d34f41220a") + '</div>');

    var g = st.greeks;
    h += ('<div class="opt-sub">' + window.DLI18N.t("56-options.c2d3dac2ab40") + '</div><div class="opt-grid">') +
      kv("Delta", sig4(g.delta)) + kv("Gamma", sig4(g.gamma)) +
      kv("Vega (per vol point)", sig4(g.vegaPt)) +
      kv("Theta (per day)", sig4(g.thetaDay)) +
      kv("Theta (per year)", sig4(g.theta)) +
      kv("Rho", sig4(g.rho)) + kv("Vanna", sig4(g.vanna)) + kv("Volga", sig4(g.volga)) +
      "</div>";
    h += payoffSVG(an, ch.S);
    h += ('<div class="opt-sub">' + window.DLI18N.t("56-options.1f3cacf7b273") + '</div><div class="dl-tblw"><table class="dl-tbl"><thead><tr><th class="r">' + window.DLI18N.t("56-options.be2bdbb3100e") + '</th><th class="r">' + window.DLI18N.t("56-options.c020c04fc24e") + '</th><th class="r">' + window.DLI18N.t("56-options.a4f70ab964da") + '</th></tr></thead><tbody>');
    var half = an.horizonYears / 2, mids = [0.8, 0.9, 0.95, 1, 1.05, 1.1, 1.2];
    for (i = 0; i < mids.length; i++) {
      var Sx = ch.S * mids[i];
      var atH = an.profitAt(Sx);
      var mk = markToModel(st.legs, Sx, half, ch.r, ch.q) ;
      h += '<tr><td class="r">' + num(Sx) + '</td><td class="r">' + fmtQ(atH, "USDT") + '</td><td class="r">' + (mk == null ? "—" : fmtQ(mk - an.cost, "USDT")) + "</td></tr>";
    }
    h += ("</tbody></table></div><div class=\"opt-legend\">" + window.DLI18N.t("56-options.37a2fed3d89c") + "</div>");
    h += ('<div class="opt-actions"><button class="dl-b pri" id="optOpenStrat">' + window.DLI18N.t("56-options.c8e0c0e8fd33") + '</button><span class="opt-sendnote">' + window.DLI18N.t("56-options.1508d454c55a") + '</span></div>');
    return h;
  }

  /* Mark the whole structure with tRemain years still to run on the horizon. */
  function markToModel(legs, Sx, tRemain, r, q) {
    var v = 0, i, L, o;
    for (i = 0; i < legs.length; i++) {
      L = legs[i];
      if (L.kind === "spot") { v += L.qty * Sx; continue; }
      var rem = L.T - (horizonOf(legs) - tRemain);
      if (rem <= 1e-9) { v += L.qty * Math.max(0, L.kind === "call" ? Sx - L.K : L.K - Sx); continue; }
      o = bs(Sx, L.K, rem, r, q, L.v, L.kind === "call");
      if (!o) return null;
      v += L.qty * o.price;
    }
    return v;
  }

  function payoffSVG(an, S0) {
    var xs = an.curve.xs, ys = an.curve.ys, i;
    var loY = null, hiY = null, loX = xs[0], hiX = xs[xs.length - 1];
    for (i = 0; i < ys.length; i++) {
      if (ys[i] == null) continue;
      if (loY == null || ys[i] < loY) loY = ys[i];
      if (hiY == null || ys[i] > hiY) hiY = ys[i];
    }
    if (loY == null || hiY == null || hiY === loY) return "";
    var W = 620, H = 170, pts = "", zero = H - (0 - loY) / (hiY - loY) * H;
    for (i = 0; i < xs.length; i++) {
      if (ys[i] == null) continue;
      var x = (xs[i] - loX) / (hiX - loX) * W;
      var y = H - (ys[i] - loY) / (hiY - loY) * H;
      pts += (pts ? " " : "") + x.toFixed(1) + "," + y.toFixed(1);
    }
    var sx = (S0 - loX) / (hiX - loX) * W;
    return '<div class="opt-chart"><svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="payoff at the horizon">' +
      '<line class="opt-zero" x1="0" y1="' + zero.toFixed(1) + '" x2="' + W + '" y2="' + zero.toFixed(1) + '"></line>' +
      '<line class="opt-spot" x1="' + sx.toFixed(1) + '" y1="0" x2="' + sx.toFixed(1) + '" y2="' + H + '"></line>' +
      '<polyline class="opt-pl" points="' + pts + '"></polyline></svg>' +
      '<div class="opt-axis"><span>' + num(loX) + ("</span><span>" + window.DLI18N.t("56-options.cd06d0445cea")) + num(S0) + "</span><span>" + num(hiX) + "</span></div></div>";
  }

  function panePositions() {
    var ch = ST.ch || rebuild();
    var rows = ch && ch.S > 0 ? markAll(ch) : [];
    var h = ch && ch.S > 0 ? header(ch) : "";
    if (!rows.length) h += ('<div class="opt-empty">' + window.DLI18N.t("56-options.6a3d9bca0137") + '</div>');
    else {
      var i, tiedTotal = 0, unrealTotal = 0;
      h += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("56-options.6d031af10da7") + '</th><th class="r">' + window.DLI18N.t("56-options.32e8369a9c4f") + '</th><th class="r">' + window.DLI18N.t("56-options.593cbe7299f7") + '</th><th class="r">' + window.DLI18N.t("56-options.5e87a2ad2b80") + '</th><th class="r">' + window.DLI18N.t("56-options.648aaefbade1") + '</th><th class="r">' + window.DLI18N.t("56-options.6201eb4dccc9") + '</th><th class="r">' + window.DLI18N.t("56-options.34aceb1b8d88") + '</th><th class="r">' + window.DLI18N.t("56-options.415333e77180") + '</th><th></th></tr></thead><tbody>');
      for (i = 0; i < rows.length; i++) {
        var P0 = rows[i].pos, m = rows[i].mark;
        tiedTotal += rows[i].marginTied;
        if (rows[i].unreal != null) unrealTotal += rows[i].unreal;
        h += "<tr><td class=\"opt-k\">" + esc(P0.side) + " " + esc(P0.sym) + " " + num(P0.K) + " " + esc(P0.kind) + " " + esc(dayLabel(P0.expiry)) + '</td><td class="r">' + num(P0.qty) + '</td><td class="r">' + (m ? (m.T * YEAR_DAYS).toFixed(1) : "—") + '</td><td class="r">' + (m && m.vol != null ? pctv(m.vol) : "expired") + '</td><td class="r">' + fmtQ(P0.openPer, P0.quote) + '</td><td class="r">' + (m ? fmtQ(m.per, P0.quote) : "—") + '</td><td class="r ' + (rows[i].unreal >= 0 ? "up" : "dn") + '">' + (rows[i].unreal == null ? "—" : (rows[i].unreal >= 0 ? "+" : "−") + fmtQ(Math.abs(rows[i].unreal), P0.quote)) + '</td><td class="r">' + (rows[i].marginTied ? fmtQ(rows[i].marginTied, P0.quote) : "—") + '</td><td><button class="dl-b" data-act="close" data-id="' + P0.id + ('' + window.DLI18N.t("56-options.35f207f4bef3") + '</button></td></tr>');
      }
      h += "</tbody></table></div>";
      h += '<div class="opt-grid">' + kv("Unrealised, marked to model", fmtQ(unrealTotal, "USDT")) + kv("Margin tied up by short legs", fmtQ(tiedTotal, "USDT")) + "</div>";
      h += ('<div class="opt-legend">' + window.DLI18N.t("56-options.46e7e1d880b9") + '</div>');
    }
    var lg = logRows(), j;
    if (lg.length) {
      h += ('<div class="opt-sub">' + window.DLI18N.t("56-options.21e49eb2b299") + '</div><div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("56-options.cf9c7aa24a26") + '</th><th>' + window.DLI18N.t("56-options.f8cf83a76a98") + '</th><th class="r">' + window.DLI18N.t("56-options.2a0f7ad1ebef") + '</th></tr></thead><tbody>');
      for (j = 0; j < lg.length; j++) {
        h += "<tr><td>" + esc(when(lg[j].t)) + "</td><td>" + esc(lg[j].text) + '</td><td class="r">' + (lg[j].pl == null ? "—" : fmtQ(lg[j].pl, "USDT")) + "</td></tr>";
      }
      h += "</tbody></table></div>";
    }
    return h;
  }

  function when(t) {
    if (!(t > 0)) return "—";
    try { return new Date(t).toISOString().slice(5, 16).replace("T", " "); } catch (e) { return "—"; }
  }

  function paneMethod() {
    var h = ('<div class="opt-note">' + window.DLI18N.t("56-options.2a8e26ee1bfc") + '</div>');
    var i;
    /* the parity identity, computed live so it cannot rot */
    var g = parityGap(100, 100, 1, 0.05, 0.02, 0.2);
    if (g) {
      h += '<div class="opt-grid">' +
        kv("Parity check, S=K=100, T=1, r=5%, q=2%, v=20%", "C − P = " + g.lhs.toFixed(12)) +
        kv("S e^(−qT) − K e^(−rT)", g.rhs.toFixed(12)) +
        kv("Residual", g.abs.toExponential(3) + " — machine epsilon, not a hope") +
        "</div>";
    }
    h += '<div class="opt-method">';
    for (i = 0; i < METHOD.length; i++) h += '<div class="opt-mrow"><b>' + esc(METHOD[i][0]) + "</b><span>" + esc(METHOD[i][1]) + "</span></div>";
    h += "</div>";
    h += ('<div class="opt-sub">' + window.DLI18N.t("56-options.72575be9ba5c") + '</div><ul class="opt-assume">');
    for (i = 0; i < ASSUMPTIONS.length; i++) h += "<li>" + esc(ASSUMPTIONS[i]) + "</li>";
    h += "</ul>";
    return h;
  }

  /* ------------------------------------------------------------- wiring */

  function bodyFor(tab, body) {
    /* onTab's return value is ignored by the sheet — the body is written here
       or nothing renders at all. */
    var html;
    try {
      if (tab === "surface") html = paneSurface();
      else if (tab === "builder") html = paneBuilder();
      else if (tab === "positions") html = panePositions();
      else if (tab === "method") html = paneMethod();
      else html = paneChain();
    } catch (e) {
      html = '<div class="opt-empty">' + esc("this tab could not be built: " + (e && e.message || e)) + "</div>";
    }
    if (body) body.innerHTML = html;
    return html;
  }

  function readTicket() {
    var t = {}, el;
    el = document.getElementById("optSym"); if (el) t.sym = String(el.value || "BTC").toUpperCase().replace(/[^A-Z0-9]/g, "");
    el = document.getElementById("optR"); if (el) t.r = (+el.value || 0) / 100;
    el = document.getElementById("optQ"); if (el) t.q = (+el.value || 0) / 100;
    el = document.getElementById("optQty"); if (el) t.qty = +el.value || 1;
    return t;
  }

  function repaint(tab) {
    var el = document.getElementById("dlOpt");
    if (!el) return;
    var body = el.querySelector(".dls-body");
    if (!body) return;
    if (tab) el.dataset.tab = tab;
    bodyFor(el.dataset.tab || "chain", body);
  }

  function onClick(ev) {
    var tgt = ev.target, el;
    if (!tgt) return;
    if (tgt.id === "optGo") { ticket(readTicket()); rebuild(); repaint("chain"); return; }
    el = tgt.getAttribute ? tgt.getAttribute("data-exp") : null;
    if (el != null) { ST.exp = +el; repaint(); return; }
    el = tgt.getAttribute ? tgt.getAttribute("data-strat") : null;
    if (el != null) { ST.strat = String(el); repaint(); return; }
    var act = tgt.getAttribute ? tgt.getAttribute("data-act") : null;
    if (act === "open") {
      var t = ticket();
      var res = openPos({
        chain: ST.ch || rebuild(), kind: tgt.getAttribute("data-kind"), side: tgt.getAttribute("data-side"),
        K: +tgt.getAttribute("data-k"), expiry: +tgt.getAttribute("data-x"), qty: +t.qty > 0 ? +t.qty : 1, quote: t.quote || "USDT"
      });
      if (!res.ok) { try { C.toast && C.toast("bad", "Not opened", res.reason); } catch (e) {} return; }
      repaint("positions");
      return;
    }
    if (act === "close") {
      var id = +tgt.getAttribute("data-id");
      var r2 = closePos(id, ST.ch || rebuild(), "close");
      if (!r2.ok) { try { C.toast && C.toast("bad", "Not closed", r2.reason); } catch (e) {} }
      repaint("positions");
      return;
    }
    if (tgt.id === "optOpenStrat") {
      var ch = ST.ch || rebuild(), tk = ticket();
      var st = strategy(ST.strat, ch, { expiry: ST.exp, qty: +tk.qty > 0 ? +tk.qty : 1 });
      if (!st || !st.legs.length) return;
      var okN = 0, failed = [], i;
      for (i = 0; i < st.legs.length; i++) {
        var L = st.legs[i];
        if (L.kind === "spot") { failed.push("the spot leg — buy or sell the coin on the trading ticket, this desk does not"); continue; }
        var r3 = openPos({ chain: ch, kind: L.kind, side: L.qty > 0 ? "long" : "short", K: L.K, expiry: L.expiry, qty: Math.abs(L.qty), quote: tk.quote || "USDT", tag: st.id });
        if (r3.ok) okN++; else failed.push(L.kind + " " + L.K + ": " + r3.reason);
      }
      try {
        C.toast && C.toast(okN ? "good" : "bad", okN + " of " + st.legs.length + " legs opened",
          failed.length ? failed.join(" · ") : "every leg went through");
      } catch (e) {}
      repaint("positions");
      return;
    }
  }

  var wired = false;
  function wire(el) {
    if (!el || wired) return;
    el.addEventListener("click", onClick);
    wired = true;
    el.__onClose = function () { try { el.removeEventListener("click", onClick); } catch (e) {} wired = false; };
  }

  function open(tab) {
    rebuild();
    var el = null;
    try {
      el = C.open("dlOpt", {
        title: window.DLI18N.t("56-options.3122bee4fbfc"),
        sub: window.DLI18N.t("56-options.c2d9aa4026c7"),
        tabs: [["chain", "Chain"], ["surface", "Surface"], ["builder", "Builder"], ["positions", "Positions"], ["method", "Method"]],
        onTab: bodyFor
      }, tab || "chain");
    } catch (e) { el = null; }
    try { wire(el || document.getElementById("dlOpt")); } catch (e) {}
    return el;
  }

  /* Mark on the app's own shared tick — this layer starts no timer of its own.
     Every 12th tick is enough for a model mark and keeps the tree off the hot
     path; expiry is settled on the same pass. */
  try {
    C.onTick && C.onTick(function (n) {
      if (n % 12 !== 0) return;
      var b = bucket();
      if (!b || !b.pos.length) return;
      try {
        var t = ticket();
        var ch = chain(t.sym, t.r, t.q, C.now ? C.now() : 0);
        if (!ch || !(ch.S > 0)) return;
        settleDue(ch);
        markAll(ch);
        var el = document.getElementById("dlOpt");
        if (el && el.classList.contains("on") && el.dataset.tab === "positions") repaint();
      } catch (e) {}
    });
  } catch (e) {}

  try { if (window.DLDESKS && window.DLDESKS.register) window.DLDESKS.register("options", "◉", "Options", "Price a strike, read the surface, and see what a short option ties up", function () { open("chain"); }); } catch (e) {}
  try { C.cmd && C.cmd("Options", "Options — Black-Scholes, an SVI surface that is checked, and a strategy builder", "◉", function () { open("chain"); }); } catch (e) {}

  window.DLOPT = {
    __v: 166,
    open: open,
    ncdf: ncdf, npdf: npdf,
    bs: bs, call: callPrice, put: putPrice, parityGap: parityGap,
    iv: iv, ivBounds: ivBounds,
    sviW: sviW, sviDW: sviDW, sviD2W: sviD2W, sviFit: sviFit,
    durrlemanG: durrlemanG, butterfly: butterfly, calendar: calendar,
    crr: crr, americanPremium: americanPremium, crrConverge: crrConverge,
    chain: chain, surface: surface, genSlice: genSlice, atmVol: atmVol, volAtK: volAtK,
    strategies: STRATS, strategy: strategy, analyse: analyse, netGreeks: netGreeks,
    probOfProfit: probOfProfit, marginShort: marginShort,
    openPos: openPos, closePos: closePos, settleDue: settleDue, markAll: markAll,
    positions: positions, log: logRows, ticket: ticket,
    hash32: hash32,
    METHOD: METHOD, ASSUMPTIONS: ASSUMPTIONS
  };
})();
