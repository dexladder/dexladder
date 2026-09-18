/* ============================================================================
   DexLadder — DLRISK · layer 59 · v166 "the book, priced for what it can lose"
   PORTFOLIO RISK DESK — covariance, VaR, margin, stress, drawdown

   The question this desk exists to answer: the app can tell you what every
   position is worth. It could not tell you what they are worth TOGETHER — how
   much of the book is one bet wearing five tickers, what a correlated move does
   to maintenance margin, or how big a day has to be before it is a surprise.
   This layer closes that: one covariance matrix over everything held, VaR and
   CVaR that are then BACKTESTED rather than asserted, one net delta per asset
   across spot, perps and LP, margin aggregated across the book, a library of
   measured historical shocks applied as a correlated vector, and drawdown
   analytics with the recovery arithmetic done rather than typed.

   LAWS OBSERVED
     · READ-ONLY. This layer never trades, never opens an order, never assigns
       to a balance and never calls execFill or chargeNetwork. It reads the
       book, the price history and the engine, and it prints numbers. The
       banner on every tab says so.
     · it does not fork the engine — sharpe, sortino, maxDrawdown, correlation,
       percentile, returns, logReturns, stdev, mean and median come from
       DLAPP.paper. What is written here is only what the engine does not own:
       the inverse normal, covariance, shrinkage, Cornish-Fisher, the two VaR
       backtests and the drawdown analytics built on top of maxDrawdown
     · deterministic — no random draw anywhere in this layer, no clock inside any pure function. Every
       figure is a function of the book, the price history and the settings
     · a missing figure stays missing — null with a NAMED reason, never 0 and
       never a confident number off four observations. The covariance work
       REFUSES when the window is too short and says which rule refused it
     · no storage key of its own — settings live in the v154 bucket, X().risk
     · no timers, no sockets, no observers; one delegated click listener, torn
       down in __onClose
     · Day and Night both — every rule lives in _v166css/59-risk.css
   ============================================================================ */
(function () {
  "use strict";
  if (window.DLRISK && window.DLRISK.__v) return;

  var C = window.DLCORE;
  if (!C) return;

  /* ------------------------------------------------------------- the engine */
  function P() { try { return window.DLAPP && window.DLAPP.paper; } catch (e) { return null; } }
  function PERP() { try { return window.DLAPP && window.DLAPP.perps; } catch (e) { return null; } }
  function LPERP() { try { return window.DLAPP && window.DLAPP.legacy && window.DLAPP.legacy.perps; } catch (e) { return null; } }
  function DEFI() { try { return window.DLDEFI; } catch (e) { return null; } }
  function OPT() { try { return window.DLOPT; } catch (e) { return null; } }
  function H7() { try { return window.DLH7; } catch (e) { return null; } }
  function ST() { try { return typeof S === "undefined" ? null : S; } catch (e) { return null; } }

  /* --------------------------------------------------------------- constants */

  /* RiskMetrics' decay factor. 0.94 is not a taste: J.P. Morgan/Reuters fitted
     it in the RiskMetrics Technical Document (4th edition, 1996, table 5.9) as
     the lambda that minimised out-of-sample RMSE of the one-day variance
     forecast across their sample of markets. 0.97 is their monthly figure and
     is offered as the slower alternative. Neither is measured on YOUR book. */
  var LAMBDA = 0.94;
  var LAMBDA_SLOW = 0.97;

  /* Below this many usable returns the desk refuses to print a correlation. 30
     is the floor where the standard error of a Pearson r is still under ~0.19
     at r = 0, which is already too wide to rank two assets by. Under it the
     honest answer is "not enough window", and that is what gets printed. */
  var MIN_OBS = 30;

  /* The desk stops at 12 assets. Beyond that the matrix is mostly estimation
     error at any window this app can reach, and the table stops being legible
     on a phone. Positions past the twelfth by gross USD are named, not hidden. */
  var MAX_ASSETS = 12;

  var EPS = 1e-12;
  var DAY_MS = 864e5;
  var STABLE = { USDT: 1, USDC: 1, DAI: 1, USD: 1, TUSD: 1, BUSD: 1, FDUSD: 1, PYUSD: 1 };

  var ASSUMPTIONS = [
    "This desk is READ-ONLY. It never sends an order, never assigns to a balance and never calls the engine's fill path. Every number here is a measurement of the book you already have.",
    "The price history is the app's OWN seeded series (DLH7): 336 half-hourly closes backfilled from Binance or Coinbase klines, or CoinGecko's 168-point hourly sparkline. That is SEVEN DAYS. Seven days is enough to see today's co-movement and nowhere near enough to see a regime. Every annualised figure on this desk is seven days of data multiplied by the square root of a year, and it says so where it is used.",
    "The bar spacing is INFERRED as the series length divided by seven days — 336 points reads as half-hourly, 168 as hourly. If a source ever hands back a differently-spaced series the annualisation factor will be wrong by exactly the ratio, and nothing in the payload tells this desk the spacing directly.",
    "The EWMA decay is 0.94 per bar by default, the RiskMetrics daily figure, applied here to HALF-HOURLY bars. That is a modelling choice made for you: it puts the effective window at about 32 bars, which on a half-hourly series is about 16 hours, not the one day RiskMetrics fitted it for. Change it on the Method tab and the effective sample size moves with it.",
    "Ledoit-Wolf shrinkage pulls the sample matrix toward a CONSTANT-CORRELATION target: every off-diagonal correlation replaced by the average pairwise correlation, variances left alone. The intensity is the analytic optimum from Ledoit and Wolf (2004), not a knob. It makes a short window usable; it does not make it true, and it biases every pair toward the average pair.",
    "Square-root-of-time horizon scaling assumes returns are independent and identically distributed with no autocorrelation and no volatility clustering. Crypto has all three. The scaling is LABELLED every time it is used, and it breaks hardest exactly when you need it: in a trending or a clustered market a 10-day VaR scaled from a 1-day VaR is too small, sometimes by a third.",
    "Cornish-Fisher modified VaR is a four-moment expansion, not a distribution. It is only monotone in the quantile for a bounded range of skew and excess kurtosis; outside it the expansion can cross itself and return a modified VaR smaller than the normal one. The desk checks the monotonicity condition and refuses the figure by name when it fails.",
    "The equity curve behind the drawdown tab is a RECONSTRUCTION, not a record. The app keeps no history of your account value, so today's net delta per asset is marked backwards through the seven-day price history with the cash leg held flat. It answers 'what would this book have done last week', not 'what did you do last week'. Every trade you actually made in that window is invisible to it.",
    "Calmar's published definition is the trailing 36 months and MAR's is the whole record since inception. Seven days is neither. Both are computed over the window that exists and are labelled as such — the ratio is real arithmetic over a fake window, and it is shown so that the Method tab can say why you should not quote it.",
    "The stress library is a set of MEASURED historical moves, each with its window named in the table: the peak-to-trough falls of 12 March 2020, 19 May 2021, the LUNA week of 5 to 12 May 2022, the FTX collapse of 8 to 9 November 2022, and the yen-carry unwind of 4 to 5 August 2024. They are rounded to a tenth of a percent, they are HISTORY and not a forecast, and an asset the scenario does not name is shocked by its beta to BTC — a modelled step, flagged in its row.",
    "A scenario is applied as an INSTANTANEOUS shock. A real move takes hours, and for a leveraged book the path matters more than the destination: a position can be liquidated on the way to a level it would have survived. The margin arithmetic here is the end state only.",
    "Perp margin is ISOLATED, exactly as the app models it. The cross-margin figures are a COUNTERFACTUAL — what the same positions would look like under one collateral pool — and the app cannot trade them that way. Free USDT is excluded from cross collateral by default because the app does not post it.",
    "LP delta comes from the Liquidity Desk's own formulas: a v2 position is half its value in each token by construction, a v3 position uses getAmountsForLiquidity at the live price, and a v3 position outside its range is 100% one asset and earns no fees. Fee accrual is excluded from delta because the desk models it as a USD figure, not as pool tokens.",
    "Option delta is read only if a DLOPT layer is present and exposes it in a shape this desk recognises. If it is present and does not, the desk says the delta is unread rather than counting it as zero."
  ];

  var METHOD = [
    ["What this desk reads", "The book, not a feed: spot balances off the paper account, perps off the app's own position list, LP positions off the Liquidity Desk, options off DLOPT if it is loaded. Prices and history come from the app's coin records. Nothing here is fetched and nothing here is written."],
    ["Returns", "Log returns, from the engine's logReturns. Log rather than simple because they add across time, which is the only thing that makes a horizon scaling arithmetically coherent, and because the covariance of log returns is the object every formula below actually wants."],
    ["Covariance, three ways", "SAMPLE: the usual 1/T inner product of demeaned returns. EWMA: a normalised exponential recursion, num = lambda*num + r*r', den = lambda*den + 1, covariance = num/den, so the estimate is a proper weighted average at any window length rather than a sum that has not finished converging. SHRUNK: Ledoit-Wolf toward a constant-correlation target, with the analytic intensity delta = max(0, min(1, (pi - rho)/gamma/T)) from 'Honey, I Shrunk the Sample Covariance Matrix' (Ledoit and Wolf, Journal of Portfolio Management 30(4), 2004). The shrunk matrix keeps the sample variances exactly and moves only the off-diagonals."],
    ["Effective sample size", "For exponential weights the Kish effective sample size is (sum w)^2 / sum w^2. At lambda = 0.94 over a long window that is (1+lambda)/(1-lambda) = 32.3 bars, whatever the raw window length. That is the number the refusal rule reads, not the raw count — an EWMA over 336 bars is still a 32-bar estimate."],
    ["When the desk refuses", "Under 30 usable overlapping returns, no correlation is printed: the standard error of a Pearson r at that length is wider than the differences you would be ranking. When the number of assets exceeds the number of returns, the sample matrix is singular by construction and is refused by name; the shrunk matrix is still offered, flagged, because shrinkage is what makes it invertible."],
    ["VaR, three ways", "HISTORICAL: the empirical quantile of the return series, through the engine's percentile — no distribution assumed, and it can only ever be as bad as the worst thing in the window. PARAMETRIC: mu + z*sigma with z from an inverse normal (Acklam, 2003; |relative error| < 1.15e-9), so the 99% one-day figure is 2.3263 sigma when mu is zero. MODIFIED: Cornish-Fisher, z' = z + (z^2-1)S/6 + (z^3-3z)K/24 - (2z^3-5z)S^2/36, with S the sample skew and K the sample excess kurtosis (Zangari 1996; Favre and Galeano 2002). At S = K = 0 the expansion reduces exactly to z, which is the check that says it is wired up right."],
    ["CVaR", "Historical CVaR is the mean of every return at or beyond the historical VaR. Parametric CVaR is mu + sigma*phi(z)/(1-c), which at 99% is 2.6652 sigma — always worse than the 2.3263 sigma VaR, because it is the average of the tail rather than its edge."],
    ["Horizon", "Square root of time, and it is an ASSUMPTION every time. mu scales with h, sigma with sqrt(h). Under the same i.i.d. aggregation, skew scales as S/sqrt(h) and excess kurtosis as K/h, so the Cornish-Fisher figure converges toward the normal one as the horizon grows — which is the assumption doing the work, not the market."],
    ["Backtesting the VaR", "A VaR nobody scores is an opinion. The series is walked forward: the VaR is estimated on the first window and every subsequent bar is an exception or it is not. KUPIEC's proportion-of-failures test asks whether the exception RATE matches the confidence level, LR = -2*ln[(1-p)^(T-x) p^x] + 2*ln[(1-x/T)^(T-x) (x/T)^x], chi-square with one degree of freedom (Kupiec, Journal of Derivatives 3(2), 1995). CHRISTOFFERSEN's independence test asks whether the exceptions CLUSTER, from the two-state transition counts, also chi-square with one degree of freedom (Christoffersen, International Economic Review 39(4), 1998). Their sum is the conditional-coverage test, chi-square with two. A model can pass the first and fail the second, and that failure is the one that costs money."],
    ["Exposure", "One net delta per asset, in base units and in USD. Spot is its balance. A perp is qty times the direction, so a short is a negative delta; its funding carry is qty*mark*rate8h*3 per day, positive meaning the position pays. Because margin is isolated, that payment leaves the margin, and the liquidation price moves by exactly the funding divided by qty*(1-mmr) for a long and qty*(1+mmr) for a short — the desk prints that drift per day and the days it would take on its own. A v2 LP is half its value in each token. A v3 LP uses getAmountsForLiquidity at the live price, and out of range it is 100% one asset."],
    ["Beta", "Beta to BTC is cov(i, BTC)/var(BTC) out of the same matrix the rest of the desk uses, so the beta and the correlation can never disagree. The book's beta is the USD-weighted sum, reported both as a dollar figure and divided by net equity."],
    ["Margin", "Isolated per position, exactly as the engine models it: maintenance = mark*qty*mmr - cum, equity = margin + uPnL, liquidation solved from equity = maintenance. The cross-margin equivalent pools every perp's equity and every perp's maintenance into one health factor. The book liquidation level is found by bisection on a single market factor applied through each asset's beta — the size of the correlated move, expressed as a BTC move, that takes the book to a health factor of 1."],
    ["Stress", "Each scenario is a vector of measured moves, applied at once. An asset the scenario names gets its measured move; an asset it does not gets beta times the scenario's BTC move, flagged. The output is the P&L, the new health factor, and the position that did the damage — which is usually not the position with the largest loss, but the one whose loss was leveraged."],
    ["Drawdown", "The underwater curve is value over running peak minus one. Max drawdown and its peak and trough indices come from the engine's maxDrawdown; the dates, the recovery time and the longest underwater stretch are read off the same curve. The Ulcer index is the root mean square of the percentage drawdowns (Martin and McCann, 1989) and the pain index is their mean absolute value; the pain ratio is the annualised return over the pain index. Calmar and MAR are the same ratio, annualised return over max drawdown, over different windows."],
    ["Return needed to recover", "1/(1-d) - 1, computed rather than typed. A 10% fall needs 11.11% back, a 50% fall needs 100%, a 90% fall needs 900%. The asymmetry is the whole argument for caring about drawdown at all."],
    ["Concentration and contribution", "The Herfindahl-Hirschman index is the sum of squared gross weights, and its reciprocal is the effective number of positions. Marginal contribution to risk is (Sigma w)_i / sigma_p, and component contribution is w_i times that. The component contributions sum EXACTLY to portfolio volatility, because w'(Sigma w)/sigma_p is sigma_p by construction — the desk prints the residual of that identity on the Exposure tab, and if it is ever anything but zero to machine precision, every matrix figure above it is wrong."]
  ];

  /* ==========================================================================
     1 · NUMERICS THE ENGINE DOES NOT OWN
     Everything here is a formula the typed core has no export for. Anything it
     DOES own is called, not copied — see section 2.
     ========================================================================== */

  /* Inverse standard normal CDF. Peter Acklam's rational approximation (2003),
     |relative error| < 1.15e-9 over the whole open interval. The engine's
     normal(u1,u2) is a Box-Muller DRAW, not a quantile, so it cannot be used
     for this and is not. */
  var AK_A = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  var AK_B = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  var AK_C = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  var AK_D = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];

  function invNorm(p) {
    if (!(p > 0 && p < 1)) return null;
    var lo = 0.02425, q, r;
    if (p < lo) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((AK_C[0] * q + AK_C[1]) * q + AK_C[2]) * q + AK_C[3]) * q + AK_C[4]) * q + AK_C[5]) /
        ((((AK_D[0] * q + AK_D[1]) * q + AK_D[2]) * q + AK_D[3]) * q + 1);
    }
    if (p <= 1 - lo) {
      q = p - 0.5; r = q * q;
      return (((((AK_A[0] * r + AK_A[1]) * r + AK_A[2]) * r + AK_A[3]) * r + AK_A[4]) * r + AK_A[5]) * q /
        (((((AK_B[0] * r + AK_B[1]) * r + AK_B[2]) * r + AK_B[3]) * r + AK_B[4]) * r + 1);
    }
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((AK_C[0] * q + AK_C[1]) * q + AK_C[2]) * q + AK_C[3]) * q + AK_C[4]) * q + AK_C[5]) /
      ((((AK_D[0] * q + AK_D[1]) * q + AK_D[2]) * q + AK_D[3]) * q + 1);
  }

  function normPdf(x) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); }

  /* Complementary error function, the Chebyshev form from Numerical Recipes
     (fractional error < 1.2e-7) — enough for a p-value printed to three
     decimals, and nowhere near enough to be used as a quantile, which is why
     the quantile above is Acklam's. */
  function erfc(x) {
    var z = Math.abs(x), t = 1 / (1 + 0.5 * z);
    var r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
      t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }

  /* Upper tail of a chi-square. Only 1 and 2 degrees of freedom are needed here
     and both are closed forms, so nothing is approximated twice. */
  function chi2sf(x, df) {
    if (!(x > 0)) return 1;
    if (df === 1) return erfc(Math.sqrt(x / 2));
    if (df === 2) return Math.exp(-x / 2);
    return null;
  }

  /* Sample skew and excess kurtosis, the population (biased) forms — the ones
     Cornish-Fisher's expansion is written against. */
  function skewOf(a) {
    var n = a.length; if (n < 3) return null;
    var m = emean(a), s = 0, v = 0, i, d;
    for (i = 0; i < n; i++) { d = a[i] - m; v += d * d; s += d * d * d; }
    v /= n; if (!(v > 0)) return null;
    return (s / n) / Math.pow(v, 1.5);
  }
  function exKurtOf(a) {
    var n = a.length; if (n < 4) return null;
    var m = emean(a), s = 0, v = 0, i, d;
    for (i = 0; i < n; i++) { d = a[i] - m; v += d * d; s += d * d * d * d; }
    v /= n; if (!(v > 0)) return null;
    return (s / n) / (v * v) - 3;
  }

  /* Cornish-Fisher quantile expansion. At s = k = 0 it returns z exactly. */
  function cornishFisher(z, s, k) {
    var sk = s || 0, ku = k || 0;
    return z + (z * z - 1) * sk / 6 + (z * z * z - 3 * z) * ku / 24 - (2 * z * z * z - 5 * z) * sk * sk / 36;
  }

  /* The expansion is only a valid quantile function while it is monotone in z
     (Maillard, 2012). This walks the expansion from the quantile being read up
     to the median in steps of 0.05 and refuses the moment it turns back on
     itself. It is a check on the interval the figure is actually read on, not
     a proof over the whole line — a pair of moments can be fine at 99% and
     broken at 99.9%, and this will say so rather than smoothing it over. */
  function cfMonotone(s, k, zFrom) {
    var z0 = (zFrom != null && isFinite(zFrom) && zFrom < 0) ? zFrom : -4;
    var z = z0, step = 0.05, prev = null, cur;
    while (z <= 0) {
      cur = cornishFisher(z, s, k);
      if (prev !== null && cur < prev) return false;
      prev = cur; z += step;
    }
    return true;
  }

  /* ==========================================================================
     2 · THE ENGINE'S OWN FORMULAS
     Called, never re-implemented. If the typed core is absent the desk says so
     and computes nothing, rather than quietly running a second copy.
     ========================================================================== */

  function engineReady() { var p = P(); return !!(p && p.stdev && p.mean && p.correlation && p.percentile && p.logReturns && p.maxDrawdown); }
  function emean(a) { try { return P().mean(a); } catch (e) { return null; } }
  function estdev(a) { try { return P().stdev(a); } catch (e) { return null; } }
  function elogRets(px) { try { return P().logReturns(px); } catch (e) { return []; } }
  function epct(a, q) { try { return P().percentile(a, q); } catch (e) { return null; } }
  function ecorr(a, b) { try { return P().correlation(a, b); } catch (e) { return null; } }
  function emaxDD(c) { try { return P().maxDrawdown(c); } catch (e) { return null; } }
  function esharpe(r, ppy) { try { return P().sharpe(r, ppy, 0); } catch (e) { return null; } }
  function esortino(r, ppy) { try { return P().sortino(r, ppy); } catch (e) { return null; } }

  /* ==========================================================================
     3 · PRICE HISTORY
     The app's own seeded series, through DLH7 (layer 23) which already strips
     the constant front-padding CoinGecko's sparkline arrives with and refuses
     a placeholder series. Nothing is fetched here.
     ========================================================================== */

  function coin(sym) { try { return C.coin(sym); } catch (e) { return null; } }
  function priceOf(sym) {
    var u = String(sym || "").toUpperCase();
    if (STABLE[u]) return 1;
    var c = coin(u); var v = c && +c.price;
    return v > 0 ? v : null;
  }

  /* The seeded history for one symbol, live price appended. A stablecoin has
     no meaningful series in this app, so it is given a flat one and flagged —
     it carries no risk here and pretending otherwise would put noise in the
     matrix that the book does not actually have. */
  function histOf(sym) {
    var u = String(sym || "").toUpperCase();
    if (STABLE[u]) return { px: null, n: 0, stable: true, reason: "a stablecoin is held flat at 1 on this desk — the app has no depeg series for it, and the stress library is where a depeg is priced" };
    var c = coin(u);
    if (!c) return { px: null, n: 0, reason: "no coin record for " + u };
    var h = H7(), s = null;
    try { if (h && h.series) s = h.series(c); } catch (e) { s = null; }
    if (!s || s.length < 2) return { px: null, n: 0, reason: "the app has no observed 7-day series for " + u + " yet — every history source refused it this session" };
    return { px: s, n: s.length, stable: false, reason: null };
  }

  /* Bar spacing, INFERRED. The seeded series is seven days long by
     construction: 336 half-hourly klines, or CoinGecko's 168 hourly points. */
  function barsPerDay(n) {
    if (!(n > 1)) return null;
    var b = n / 7;
    if (b >= 36) return 48;
    if (b >= 18) return 24;
    if (b >= 9) return 12;
    return Math.max(1, Math.round(b));
  }
  function spacingLabel(bpd) {
    if (bpd === 48) return "half-hourly";
    if (bpd === 24) return "hourly";
    if (bpd === 12) return "two-hourly";
    return bpd ? (24 / bpd).toFixed(1) + "-hourly" : "unknown";
  }

  /* An aligned matrix of log returns, newest last, one column per symbol. The
     series are aligned on their TAIL because the app's sources hand back
     different lengths for different coins and the last bar is the one they
     agree on. Symbols with no usable series are dropped BY NAME. */
  function retMatrix(syms) {
    var cols = [], keep = [], dropped = [], i, h, r;
    for (i = 0; i < syms.length; i++) {
      h = histOf(syms[i]);
      if (!h.px) { dropped.push({ sym: syms[i], why: h.reason }); continue; }
      r = elogRets(h.px);
      if (!r || r.length < 2) { dropped.push({ sym: syms[i], why: "fewer than two usable returns in the series" }); continue; }
      cols.push(r); keep.push(String(syms[i]).toUpperCase());
    }
    if (!cols.length) return { syms: [], X: [], T: 0, N: 0, dropped: dropped, barsPerDay: null };
    var T = cols[0].length, j;
    for (i = 1; i < cols.length; i++) if (cols[i].length < T) T = cols[i].length;
    var X = [];
    for (i = 0; i < T; i++) {
      var row = [];
      for (j = 0; j < cols.length; j++) row.push(cols[j][cols[j].length - T + i]);
      X.push(row);
    }
    return { syms: keep, X: X, T: T, N: keep.length, dropped: dropped, barsPerDay: barsPerDay(T + 1) };
  }

  /* ==========================================================================
     4 · COVARIANCE, CORRELATION, SHRINKAGE
     ========================================================================== */

  function zeros(n, m) { var o = [], i, j; for (i = 0; i < n; i++) { o.push([]); for (j = 0; j < m; j++) o[i].push(0); } return o; }

  function demean(X) {
    var T = X.length, N = T ? X[0].length : 0, mu = [], Y = [], i, j, s;
    for (j = 0; j < N; j++) { s = 0; for (i = 0; i < T; i++) s += X[i][j]; mu.push(T ? s / T : 0); }
    for (i = 0; i < T; i++) { var r = []; for (j = 0; j < N; j++) r.push(X[i][j] - mu[j]); Y.push(r); }
    return { mu: mu, Y: Y };
  }

  /* Sample covariance with the 1/T denominator. 1/T rather than 1/(T-1)
     because Ledoit-Wolf's intensity is derived against 1/T and mixing the two
     makes delta wrong by T/(T-1); the engine's stdev keeps 1/(T-1) and is used
     wherever a single-series volatility is wanted, which is why the two are
     kept apart rather than blended. */
  function sampleCov(X) {
    var d = demean(X), Y = d.Y, T = Y.length, N = T ? Y[0].length : 0;
    if (!T || !N) return null;
    var S = zeros(N, N), i, j, t, s;
    for (i = 0; i < N; i++) for (j = i; j < N; j++) {
      s = 0; for (t = 0; t < T; t++) s += Y[t][i] * Y[t][j];
      S[i][j] = S[j][i] = s / T;
    }
    return S;
  }

  /* EWMA covariance as a NORMALISED recursion:
        num = lambda*num + r r' ,  den = lambda*den + 1 ,  Sigma = num/den
     which is exactly the weighted average sum(w_t r r')/sum(w_t) with
     w_t = lambda^(T-1-t). The plain RiskMetrics recursion without the
     denominator is only that average in the limit; at 40 bars it is still
     about 8% short, and this desk runs on short windows. */
  function ewmaCov(X, lam) {
    var T = X.length, N = T ? X[0].length : 0;
    if (!T || !N) return null;
    var L = (lam > 0 && lam < 1) ? lam : LAMBDA;
    var d = demean(X), Y = d.Y;
    var num = zeros(N, N), den = 0, t, i, j;
    for (t = 0; t < T; t++) {
      den = L * den + 1;
      for (i = 0; i < N; i++) for (j = i; j < N; j++) {
        num[i][j] = L * num[i][j] + Y[t][i] * Y[t][j];
        if (j !== i) num[j][i] = num[i][j];
      }
    }
    if (!(den > 0)) return null;
    var S = zeros(N, N);
    for (i = 0; i < N; i++) for (j = 0; j < N; j++) S[i][j] = num[i][j] / den;
    return S;
  }

  /* Kish effective sample size of the exponential weights over T bars:
        (sum w)^2 / sum w^2, w_t = lambda^(T-1-t)
     which closes to (1-L^T)^2 (1+L) / ((1-L)(1-L^(2T))) and tends to
     (1+L)/(1-L) — 32.33 bars at 0.94. */
  function ewmaEffN(lam, T) {
    var L = (lam > 0 && lam < 1) ? lam : LAMBDA;
    if (!(T > 0)) return null;
    var sw = (1 - Math.pow(L, T)) / (1 - L);
    var sw2 = (1 - Math.pow(L, 2 * T)) / (1 - L * L);
    return sw2 > 0 ? sw * sw / sw2 : null;
  }

  /* Ledoit-Wolf shrinkage toward a constant-correlation target.
     Ledoit and Wolf (2004), "Honey, I Shrunk the Sample Covariance Matrix",
     Journal of Portfolio Management 30(4), pp. 110-119. The target keeps the
     sample variances and replaces every correlation by the average one; the
     intensity is the analytic optimum, delta = max(0, min(1, (pi-rho)/gamma/T)). */
  function shrinkLW(X) {
    var d = demean(X), Y = d.Y, T = Y.length, N = T ? Y[0].length : 0;
    if (!T || !N) return null;
    var S = sampleCov(X), i, j, t, s;
    if (!S) return null;

    var rsum = 0, rcnt = 0, den;
    for (i = 0; i < N; i++) for (j = i + 1; j < N; j++) {
      den = Math.sqrt(S[i][i] * S[j][j]);
      if (den > EPS) { rsum += S[i][j] / den; rcnt++; }
    }
    var rbar = rcnt ? rsum / rcnt : 0;

    var F = zeros(N, N);
    for (i = 0; i < N; i++) for (j = 0; j < N; j++) F[i][j] = i === j ? S[i][i] : rbar * Math.sqrt(S[i][i] * S[j][j]);

    /* pi: the summed asymptotic variance of each sample entry */
    var PI = zeros(N, N), pi = 0, dd;
    for (i = 0; i < N; i++) for (j = 0; j < N; j++) {
      s = 0; for (t = 0; t < T; t++) { dd = Y[t][i] * Y[t][j] - S[i][j]; s += dd * dd; }
      PI[i][j] = s / T; pi += PI[i][j];
    }

    /* rho: the summed covariance between the sample entry and the target */
    function theta(k, a, b) {
      var acc = 0, tt;
      for (tt = 0; tt < T; tt++) acc += (Y[tt][k] * Y[tt][k] - S[k][k]) * (Y[tt][a] * Y[tt][b] - S[a][b]);
      return acc / T;
    }
    var rho = 0;
    for (i = 0; i < N; i++) rho += PI[i][i];
    for (i = 0; i < N; i++) for (j = 0; j < N; j++) {
      if (i === j) continue;
      if (!(S[i][i] > EPS) || !(S[j][j] > EPS)) continue;
      rho += (rbar / 2) * (Math.sqrt(S[j][j] / S[i][i]) * theta(i, i, j) + Math.sqrt(S[i][i] / S[j][j]) * theta(j, i, j));
    }

    var gamma = 0, g;
    for (i = 0; i < N; i++) for (j = 0; j < N; j++) { g = F[i][j] - S[i][j]; gamma += g * g; }

    var kappa = gamma > EPS ? (pi - rho) / gamma : 0;
    var delta = Math.max(0, Math.min(1, kappa / T));
    var Sig = zeros(N, N);
    for (i = 0; i < N; i++) for (j = 0; j < N; j++) Sig[i][j] = delta * F[i][j] + (1 - delta) * S[i][j];
    return { Sigma: Sig, delta: delta, rbar: rbar, pi: pi, rho: rho, gamma: gamma, target: F, sample: S };
  }

  function corrFrom(S) {
    if (!S) return null;
    var N = S.length, R = zeros(N, N), i, j, d;
    for (i = 0; i < N; i++) for (j = 0; j < N; j++) {
      d = Math.sqrt(S[i][i] * S[j][j]);
      R[i][j] = d > EPS ? S[i][j] / d : (i === j ? 1 : null);
    }
    return R;
  }

  /* The one public entry point for the matrix work. Every refusal is NAMED. */
  function covariance(opt) {
    opt = opt || {};
    var method = opt.method === "sample" || opt.method === "ewma" ? opt.method : "shrunk";
    var lam = +opt.lambda > 0 && +opt.lambda < 1 ? +opt.lambda : LAMBDA;
    /* Every return out of this function carries the SAME shape, refusal or not.
       A refusal that omits method or T printed the word "undefined" into the
       window strip on a cold account, which is the one screen a new visitor
       sees first. */
    function refuse(why, M) {
      return {
        ok: false, reason: why, method: method, lambda: method === "ewma" ? lam : null,
        syms: (M && M.syms) || [], T: (M && M.T) || 0, N: (M && M.N) || 0, effN: null,
        barsPerDay: (M && M.barsPerDay) || null, spacing: spacingLabel((M && M.barsPerDay) || null),
        dropped: (M && M.dropped) || [], singular: false, delta: null, rbar: null,
        cov: null, corr: null, vol: null
      };
    }
    if (!engineReady()) return refuse("the typed engine (DLAPP.paper) is not loaded, so nothing here can be computed", null);
    var syms = opt.syms || bookSymbols();
    var M = retMatrix(syms);
    if (!M.N) return refuse("no asset in the book has a usable price history yet — open a position, or wait for the 7-day series to seed", M);

    var effN = method === "ewma" ? ewmaEffN(lam, M.T) : M.T;
    var out = {
      ok: false, reason: null, method: method, lambda: method === "ewma" ? lam : null,
      syms: M.syms, T: M.T, N: M.N, effN: effN, barsPerDay: M.barsPerDay,
      spacing: spacingLabel(M.barsPerDay), dropped: M.dropped,
      singular: M.T < M.N, delta: null, rbar: null, cov: null, corr: null, vol: null
    };

    /* the refusals, in the order they bite */
    if (M.T < MIN_OBS) {
      out.reason = "only " + M.T + " overlapping returns — under the desk's floor of " + MIN_OBS + ". At that length the standard error of a correlation is wider than the differences you would be ranking, so no matrix is printed.";
      return out;
    }
    if (effN != null && effN < MIN_OBS) {
      out.reason = "the effective sample size at lambda " + lam.toFixed(2) + " is " + effN.toFixed(1) + " bars, under the floor of " + MIN_OBS + ". Raise lambda or use the sample or shrunk estimator.";
      return out;
    }
    if (method === "sample" && M.T < M.N) {
      out.reason = "the sample matrix is singular by construction: " + M.N + " assets against " + M.T + " returns. Use the shrunk estimator, which is invertible at any window, and read its intensity as the price you paid for that.";
      return out;
    }

    var S = null, lw = null;
    if (method === "sample") S = sampleCov(M.X);
    else if (method === "ewma") S = ewmaCov(M.X, lam);
    else { lw = shrinkLW(M.X); S = lw ? lw.Sigma : null; out.delta = lw ? lw.delta : null; out.rbar = lw ? lw.rbar : null; }
    if (!S) { out.reason = "the covariance could not be formed from the aligned returns"; return out; }

    var i, vol = [];
    for (i = 0; i < M.N; i++) vol.push(S[i][i] > 0 ? Math.sqrt(S[i][i]) : 0);
    out.ok = true; out.cov = S; out.corr = corrFrom(S); out.vol = vol; out.X = M.X;
    return out;
  }

  /* Beta to BTC, straight off the same matrix, so beta and correlation cannot
     disagree with each other. */
  function betaToBTC(cv) {
    if (!cv || !cv.ok) return null;
    var bi = cv.syms.indexOf("BTC");
    if (bi < 0) return { ok: false, reason: "BTC is not in the book, so there is nothing to take a beta against" };
    var vb = cv.cov[bi][bi];
    if (!(vb > EPS)) return { ok: false, reason: "BTC's variance over this window is zero" };
    var out = {}, i;
    for (i = 0; i < cv.syms.length; i++) out[cv.syms[i]] = cv.cov[i][bi] / vb;
    return { ok: true, beta: out, btcVar: vb };
  }

  /* ==========================================================================
     5 · CONCENTRATION AND RISK CONTRIBUTION
     ========================================================================== */

  function concentration(weights) {
    var g = 0, i, w = [];
    for (i = 0; i < weights.length; i++) g += Math.abs(weights[i]);
    if (!(g > EPS)) return { ok: false, reason: "the book has no gross exposure to concentrate" };
    for (i = 0; i < weights.length; i++) w.push(Math.abs(weights[i]) / g);
    var hhi = 0;
    for (i = 0; i < w.length; i++) hhi += w[i] * w[i];
    var sorted = w.slice().sort(function (a, b) { return b - a; });
    var top = function (n) { var s = 0, k; for (k = 0; k < Math.min(n, sorted.length); k++) s += sorted[k]; return s; };
    return {
      ok: true, hhi: hhi, effectiveN: hhi > 0 ? 1 / hhi : null,
      top1: top(1), top3: top(3), top5: top(5), gross: g, weights: w, n: w.length,
      floor: w.length ? 1 / w.length : null
    };
  }

  /* Marginal and component contribution to risk.
        sigma_p = sqrt(w' S w),  MCTR_i = (S w)_i / sigma_p,  CCTR_i = w_i MCTR_i
     and sum(CCTR) = w'(S w)/sigma_p = sigma_p exactly. The residual of that
     identity is returned and printed: it is the check that says the matrix
     arithmetic above it is right. */
  function riskContrib(w, S) {
    if (!S || !w || w.length !== S.length) return { ok: false, reason: "the weight vector and the covariance matrix are different lengths" };
    var n = w.length, Sw = [], i, j, s;
    for (i = 0; i < n; i++) { s = 0; for (j = 0; j < n; j++) s += S[i][j] * w[j]; Sw.push(s); }
    var varp = 0;
    for (i = 0; i < n; i++) varp += w[i] * Sw[i];
    if (!(varp > 0)) return { ok: false, reason: "portfolio variance is zero or negative over this window — there is nothing to attribute" };
    var sp = Math.sqrt(varp), mctr = [], cctr = [], sum = 0;
    for (i = 0; i < n; i++) { mctr.push(Sw[i] / sp); cctr.push(w[i] * Sw[i] / sp); sum += cctr[i]; }
    return {
      ok: true, sigma: sp, variance: varp, mctr: mctr, cctr: cctr,
      sumCCTR: sum, residual: sum - sp,
      identityHolds: Math.abs(sum - sp) <= 1e-9 * Math.max(1e-18, Math.abs(sp))
    };
  }

  /* ==========================================================================
     6 · VaR AND CVaR
     Losses are reported POSITIVE. A 99% one-day VaR of 0.042 means "a day this
     bad or worse happens about 1 time in 100, and it costs 4.2%".
     ========================================================================== */

  function varSuite(rets, conf, horizon, valueUSD) {
    var c = conf > 0 && conf < 1 ? conf : 0.99;
    var h = horizon > 0 ? horizon : 1;
    var V = valueUSD != null && isFinite(valueUSD) ? valueUSD : null;
    var out = {
      ok: false, reason: null, conf: c, horizon: h, n: rets ? rets.length : 0, valueUSD: V,
      scaled: h !== 1, scaling: "square root of time — an assumption, not a measurement"
    };
    if (!engineReady()) { out.reason = "the typed engine is not loaded"; return out; }
    if (!rets || rets.length < MIN_OBS) {
      out.reason = "only " + (rets ? rets.length : 0) + " returns — under the desk's floor of " + MIN_OBS + ". A 99% quantile off a short window is the worst point in it, not a quantile.";
      return out;
    }

    var mu1 = emean(rets), sd1 = estdev(rets);
    var sk1 = skewOf(rets), ku1 = exKurtOf(rets);
    if (!(sd1 > 0)) { out.reason = "the return series has zero volatility over this window"; return out; }

    /* i.i.d. aggregation: mu scales with h, sigma with sqrt(h), skew with
       1/sqrt(h) and excess kurtosis with 1/h. Every one of those is the
       assumption talking. */
    var rt = Math.sqrt(h);
    var mu = mu1 * h, sd = sd1 * rt;
    var sk = sk1 == null ? null : sk1 / rt, ku = ku1 == null ? null : ku1 / h;

    var zLo = invNorm(1 - c);                      /* negative: the loss tail */
    var zHi = invNorm(c);

    /* historical: the empirical quantile, scaled */
    var qh = epct(rets, 1 - c);
    var histVaR = qh == null ? null : -qh * rt;
    var tail = [], i;
    for (i = 0; i < rets.length; i++) if (rets[i] <= qh) tail.push(rets[i]);
    var histCVaR = tail.length ? -emean(tail) * rt : null;

    /* parametric normal */
    var parVaR = -(mu + zLo * sd);
    var parCVaR = -mu + sd * normPdf(zHi) / (1 - c);

    /* Cornish-Fisher modified */
    var mono = (sk == null || ku == null) ? false : cfMonotone(sk, ku, zLo);
    var zcf = (sk == null || ku == null) ? null : cornishFisher(zLo, sk, ku);
    var cfVaR = zcf == null ? null : -(mu + zcf * sd);

    out.ok = true;
    out.mu = mu; out.sigma = sd; out.mu1 = mu1; out.sigma1 = sd1;
    out.skew = sk; out.exKurt = ku; out.skew1 = sk1; out.exKurt1 = ku1;
    out.z = zLo; out.zcf = zcf;
    out.hist = { varPct: histVaR, cvarPct: histCVaR, tailN: tail.length, q: qh };
    out.param = { varPct: parVaR, cvarPct: parCVaR };
    out.cf = {
      varPct: mono ? cfVaR : null, monotone: mono,
      reason: mono ? null : "the Cornish-Fisher expansion is not monotone at this skew and excess kurtosis, so it is not a quantile here and no modified VaR is printed. That is the expansion's known failure mode, not a data problem."
    };
    if (V != null) {
      out.usd = {
        hist: histVaR == null ? null : histVaR * Math.abs(V),
        histCVaR: histCVaR == null ? null : histCVaR * Math.abs(V),
        param: parVaR * Math.abs(V),
        paramCVaR: parCVaR * Math.abs(V),
        cf: out.cf.varPct == null ? null : out.cf.varPct * Math.abs(V)
      };
    }
    out.breaks = "square-root-of-time breaks where returns are autocorrelated or volatility clusters — both of which crypto does. In a trending or a clustered market a multi-day figure scaled from a one-day figure is too small.";
    return out;
  }

  /* ---------------------------------------------------- the two backtests */

  /* Kupiec's proportion-of-failures likelihood ratio (Kupiec, Journal of
     Derivatives 3(2), 1995, pp. 73-84). chi-square, one degree of freedom. */
  function kupiecPOF(T, x, p) {
    if (!(T > 0) || !(p > 0 && p < 1) || x < 0 || x > T) return null;
    var pi = x / T;
    /* the restricted log-likelihood, under the claimed exception rate p */
    var l0 = (T - x) * Math.log(1 - p) + (x > 0 ? x * Math.log(p) : 0);
    /* the unrestricted one, under the observed rate. At x = 0 or x = T the
       observed rate is a boundary and the likelihood is exactly 1, so the
       log-likelihood is 0 rather than a logarithm of zero. */
    var l1 = (x === 0 || x === T) ? 0 : ((T - x) * Math.log(1 - pi) + x * Math.log(pi));
    var lr = -2 * (l0 - l1);
    return { lr: lr, p: chi2sf(lr, 1), exceptions: x, obs: T, rate: pi, expected: p * T, expectedRate: p };
  }

  /* Christoffersen's independence test (Christoffersen, International Economic
     Review 39(4), 1998, pp. 841-862): are the exceptions a first-order Markov
     chain with the same transition probability from both states? chi-square,
     one degree of freedom. */
  function christoffersenInd(flags) {
    if (!flags || flags.length < 3) return null;
    var n00 = 0, n01 = 0, n10 = 0, n11 = 0, i, a, b;
    for (i = 1; i < flags.length; i++) {
      a = flags[i - 1] ? 1 : 0; b = flags[i] ? 1 : 0;
      if (!a && !b) n00++; else if (!a && b) n01++; else if (a && !b) n10++; else n11++;
    }
    var N = n00 + n01 + n10 + n11;
    var p01 = (n00 + n01) > 0 ? n01 / (n00 + n01) : 0;
    var p11 = (n10 + n11) > 0 ? n11 / (n10 + n11) : 0;
    var p = N > 0 ? (n01 + n11) / N : 0;
    var base = { n00: n00, n01: n01, n10: n10, n11: n11, p01: p01, p11: p11, pHat: p };
    if (!(p > 0 && p < 1)) {
      base.lr = null; base.p = null;
      base.reason = n01 + n11 === 0 ? "no exception in the tested window — there is nothing whose independence could be tested" : "every bar in the tested window is an exception";
      return base;
    }
    function lg(v, k) { return k > 0 ? k * Math.log(v) : 0; }
    var l0 = lg(1 - p, n00 + n10) + lg(p, n01 + n11);
    var l1 = lg(1 - p01, n00) + lg(p01, n01) + lg(1 - p11, n10) + lg(p11, n11);
    base.lr = -2 * (l0 - l1);
    base.p = chi2sf(base.lr, 1);
    base.reason = null;
    return base;
  }

  /* Walk the series forward: estimate on the first window-many bars, test every
     bar after it, re-estimating each step. No clock, no random, so the same
     series always produces the same verdict. */
  function backtestVaR(rets, conf, window, kind) {
    var c = conf > 0 && conf < 1 ? conf : 0.99;
    var w = window > 0 ? Math.floor(window) : Math.max(MIN_OBS, Math.floor((rets ? rets.length : 0) / 3));
    var k = kind === "hist" || kind === "cf" ? kind : "param";
    var out = { ok: false, reason: null, conf: c, window: w, kind: k };
    if (!engineReady()) { out.reason = "the typed engine is not loaded"; return out; }
    if (!rets || rets.length < w + MIN_OBS) {
      out.reason = "a walk-forward backtest needs an estimation window plus at least " + MIN_OBS + " bars to test. This series has " + (rets ? rets.length : 0) + " and the window is " + w + ".";
      return out;
    }
    var flags = [], levels = [], i, sub, mu, sd, z, lvl, sk, ku, zc;
    var zLo = invNorm(1 - c);
    for (i = w; i < rets.length; i++) {
      sub = rets.slice(i - w, i);
      if (k === "hist") {
        var q = epct(sub, 1 - c);
        lvl = q == null ? null : -q;
      } else {
        mu = emean(sub); sd = estdev(sub);
        if (!(sd > 0)) { lvl = null; }
        else if (k === "cf") {
          sk = skewOf(sub); ku = exKurtOf(sub);
          zc = (sk == null || ku == null || !cfMonotone(sk, ku, zLo)) ? zLo : cornishFisher(zLo, sk, ku);
          lvl = -(mu + zc * sd);
        } else {
          lvl = -(mu + zLo * sd);
        }
      }
      if (lvl == null) continue;
      levels.push(lvl);
      flags.push(rets[i] < -lvl ? 1 : 0);
    }
    if (flags.length < MIN_OBS) { out.reason = "too few testable bars after the estimation window"; return out; }
    var x = 0;
    for (i = 0; i < flags.length; i++) x += flags[i];
    var pof = kupiecPOF(flags.length, x, 1 - c);
    var ind = christoffersenInd(flags);
    var cc = (pof && ind && ind.lr != null) ? { lr: pof.lr + ind.lr, p: chi2sf(pof.lr + ind.lr, 2) } : null;

    out.ok = true; out.tested = flags.length; out.exceptions = x;
    out.rate = x / flags.length; out.expectedRate = 1 - c;
    out.kupiec = pof; out.christoffersen = ind; out.cc = cc;
    out.verdict = verdictOf(pof, ind, cc);
    out.meanLevel = emean(levels);
    return out;
  }

  function verdictOf(pof, ind, cc) {
    if (!pof) return { text: "not testable", tone: "warn" };
    var a = pof.p != null && pof.p >= 0.05;
    var b = ind && ind.p != null ? ind.p >= 0.05 : null;
    if (a && b === true) return { text: "the model holds: the exception rate matches the level and the exceptions do not cluster", tone: "good" };
    if (a && b === false) return { text: "the RATE is right but the exceptions CLUSTER — the model is blind to volatility clustering, which is the failure that empties an account in one week rather than over a year", tone: "bad" };
    if (!a && b === true) return { text: "the exception rate is wrong at the 5% level — the VaR is " + (pof.rate > pof.expectedRate ? "too small" : "too large") + " — but what exceptions there are fall independently", tone: "bad" };
    if (!a && b === false) return { text: "the model fails both tests: the rate is wrong and the exceptions cluster", tone: "bad" };
    return { text: "the rate test " + (a ? "passes" : "fails") + "; independence could not be tested (" + ((ind && ind.reason) || "no transitions") + ")", tone: a ? "warn" : "bad" };
  }

  /* ==========================================================================
     7 · EXPOSURE — one net delta per asset, every position type decomposed
     Reads only. Nothing in this section writes anything, anywhere.
     ========================================================================== */

  function balances() {
    var s = ST();
    try { return (s && s.bal) ? s.bal : null; } catch (e) { return null; }
  }

  function spotLegs() {
    var b = balances(), out = [], k, q, px;
    if (!b) return out;
    for (k in b) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) continue;
      q = +b[k];
      if (!(Math.abs(q) > 1e-12)) continue;
      px = priceOf(k);
      if (px == null) { out.push({ kind: "spot", sym: k, base: q, price: null, usd: null, why: "no price for " + k }); continue; }
      out.push({ kind: "spot", sym: String(k).toUpperCase(), base: q, price: px, usd: q * px, cash: !!STABLE[String(k).toUpperCase()] });
    }
    return out;
  }

  function perpRaw() {
    var s = ST();
    try {
      var arr = s && s.dlsim && s.dlsim.perps;
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function fundRate8h(sym) {
    var lp = LPERP();
    try { if (lp && lp.fundRate) { var r = +lp.fundRate(sym); if (isFinite(r)) return r; } } catch (e) {}
    var p = PERP(), c = coin(sym);
    try { if (p && p.estimateRate8h) return p.estimateRate8h((c && +c.c24) || 0); } catch (e) {}
    return null;
  }

  function perpLegs() {
    var raw = perpRaw(), p = PERP(), out = [], i, q, mark, side, dir, shape;
    for (i = 0; i < raw.length; i++) {
      q = raw[i];
      if (!q || !q.sym || !(+q.qty > 0)) continue;
      side = q.side === "short" ? "short" : "long";
      dir = side === "long" ? 1 : -1;
      mark = priceOf(q.sym);
      shape = { side: side, qty: +q.qty, entry: +q.entry, margin: +q.margin, mmr: +q.mmr || 0, cum: +q.cum || 0, lev: +q.lev || 1 };
      var leg = {
        kind: "perp", id: q.id, sym: String(q.sym).toUpperCase(), side: side, dir: dir,
        qty: +q.qty, entry: +q.entry, margin: +q.margin, lev: +q.lev || null,
        mmr: shape.mmr, cum: shape.cum, fundingHours: +q.fundingHours || 8,
        mark: mark, shape: shape,
        base: dir * (+q.qty), usd: mark == null ? null : dir * (+q.qty) * mark,
        notional: mark == null ? null : (+q.qty) * mark
      };
      if (mark != null && p) {
        try { leg.uPnl = p.uPnl(shape, mark); } catch (e) { leg.uPnl = null; }
        try { leg.equity = p.equity(shape, mark); } catch (e) { leg.equity = null; }
        try { leg.maint = p.maintenance(shape, mark); } catch (e) { leg.maint = null; }
        try { leg.liq = p.liqPrice(shape); } catch (e) { leg.liq = null; }
        try { leg.marginRatio = p.marginRatio(shape, mark); } catch (e) { leg.marginRatio = null; }
        try { leg.distPct = p.distancePct(shape, mark); } catch (e) { leg.distPct = null; }
      } else if (!p) {
        leg.why = "DLAPP.perps is not loaded, so this position's margin state cannot be read from the engine";
      }
      /* funding carry, per day. intervalRate is rate8h*hours/8 and there are
         24/hours settlements a day, so the cadence cancels: rate8h*3. Positive
         means the position PAYS. */
      var r8 = fundRate8h(q.sym);
      leg.rate8h = r8;
      leg.fundingPerDay = (r8 == null || mark == null) ? null : (+q.qty) * mark * r8 * 3 * dir;
      /* isolated margin means that payment leaves the margin, so it moves the
         liquidation price by exactly d(liq)/d(margin) times the funding. */
      if (leg.fundingPerDay != null && shape.qty > 0) {
        /* d(liq)/d(margin): negative for a long, positive for a short, straight
           off the engine's own liquidation formula. Funding PAID reduces the
           margin, so the margin change is minus the carry. */
        var dLdM = side === "long" ? -1 / (shape.qty * (1 - shape.mmr)) : 1 / (shape.qty * (1 + shape.mmr));
        leg.liqDriftPerDay = dLdM * (-leg.fundingPerDay);
        if (leg.liq != null && mark != null && Math.abs(leg.liqDriftPerDay) > EPS) {
          var gapToMark = side === "long" ? (mark - leg.liq) : (leg.liq - mark);
          var closing = side === "long" ? leg.liqDriftPerDay > 0 : leg.liqDriftPerDay < 0;
          leg.fundingDaysToLiq = closing && gapToMark > 0 ? gapToMark / Math.abs(leg.liqDriftPerDay) : null;
        }
      }
      out.push(leg);
    }
    return out;
  }

  function lpLegs() {
    var d = DEFI(), out = [], i;
    if (!d || !d.positions) return out;
    var pos = null;
    try { pos = d.positions(); } catch (e) { pos = null; }
    var lp = (pos && pos.lp) || [];
    for (i = 0; i < lp.length; i++) {
      var q = lp[i];
      if (!q || !q.sym || !(+q.usd > 0)) continue;
      var sym = String(q.sym).toUpperCase();
      var px = priceOf(sym), entry = +q.px;
      var leg = { kind: "lp", lpKind: q.kind === "v3" ? "v3" : "v2", sym: sym, usdIn: +q.usd, entry: entry, lo: +q.lo, hi: +q.hi, price: px, t: q.t };
      if (px == null || !(entry > 0)) { leg.why = "no live price for " + sym + ", so the position cannot be marked"; out.push(leg); continue; }
      var r = px / entry;
      if (leg.lpKind === "v3" && d.V3 && d.V3.value && d.V3.amountsFor) {
        /* value is linear in L, so the liquidity that was minted for the deposited USD of
           value at the entry price is usd / value(1, entry, lo, hi). Then the
           live split is getAmountsForLiquidity at the live price. */
        var unit = null;
        try { unit = d.V3.value(1, entry, +q.lo, +q.hi); } catch (e) { unit = null; }
        if (!(unit > 0)) { leg.why = "the range is degenerate, so no liquidity can be recovered from it"; out.push(leg); continue; }
        var L = (+q.usd) / unit, am = null;
        try { am = d.V3.amountsFor(L, px, +q.lo, +q.hi); } catch (e) { am = null; }
        if (!am) { leg.why = "the position formula refused this range"; out.push(leg); continue; }
        leg.L = L; leg.base = am.x; leg.quote = am.y;
        leg.usd = am.x * px + am.y;
        leg.inRange = px > +q.lo && px < +q.hi;
        leg.side = px <= +q.lo ? "all base" : (px >= +q.hi ? "all quote" : "split");
        leg.note = leg.inRange ? "in range: " + pctOf(am.x * px, leg.usd) + " of the value is " + sym
          : (px <= +q.lo ? "OUT OF RANGE BELOW — the position is 100% " + sym + " and earning nothing"
            : "OUT OF RANGE ABOVE — the position is 100% quote, zero " + sym + " delta, and earning nothing");
      } else {
        /* v2: a constant-product position is half its value in each token by
           construction, whatever the price. Value is the Liquidity Desk's own
           mark: hodl * (1 + divergence loss), fees excluded from delta. */
        var il = 0;
        try { if (d.IL && d.IL.v2) il = d.IL.v2(r); } catch (e) { il = 0; }
        var hodl = (+q.usd) * (1 + r) / 2;
        var value = hodl * (1 + il);
        leg.usd = value; leg.base = value / 2 / px; leg.quote = value / 2;
        leg.il = il; leg.inRange = true; leg.side = "split";
        leg.note = "half the value in " + sym + " and half in quote, by construction — divergence loss " + (il * 100).toFixed(2) + "%";
      }
      out.push(leg);
    }
    return out;
  }

  function pctOf(a, b) { return b > 0 ? (a / b * 100).toFixed(1) + "%" : "—"; }

  /* Options: guarded hard, because this desk does not own DLOPT's shape. If the
     layer is present and does not expose a delta in a form recognised here,
     that is REPORTED, not counted as zero. */
  function optLegs() {
    var o = OPT();
    if (!o) return { legs: [], present: false, reason: null };
    var raw = null, via = null;
    try { if (typeof o.exposure === "function") { raw = o.exposure(); via = "DLOPT.exposure()"; } } catch (e) { raw = null; }
    if (!raw) { try { if (typeof o.positions === "function") { raw = o.positions(); via = "DLOPT.positions()"; } } catch (e) { raw = null; } }
    if (!raw || !raw.length) return { legs: [], present: true, reason: "DLOPT is loaded but returned no position this desk could read (" + (via || "no exposure() or positions()") + ")" };
    var out = [], i, q, dl, sym;
    for (i = 0; i < raw.length; i++) {
      q = raw[i]; if (!q) continue;
      sym = String(q.sym || q.underlying || "").toUpperCase();
      dl = q.deltaBase != null ? +q.deltaBase : (q.delta != null && q.qty != null ? +q.delta * +q.qty : (q.delta != null ? +q.delta : null));
      if (!sym || dl == null || !isFinite(dl)) continue;
      var px = priceOf(sym);
      out.push({ kind: "option", sym: sym, base: dl, price: px, usd: px == null ? null : dl * px, src: via, label: q.label || q.name || "option" });
    }
    if (!out.length) return { legs: [], present: true, reason: "DLOPT is loaded and returned " + raw.length + " record(s), but none carried a delta in a shape this desk recognises (deltaBase, or delta and qty). Its delta is UNREAD here, not zero." };
    return { legs: out, present: true, reason: null, via: via };
  }

  /* One net delta per asset, and the book's. */
  function exposure() {
    var spot = spotLegs(), perps = perpLegs(), lps = lpLegs(), op = optLegs();
    var legs = spot.concat(perps).concat(lps).concat(op.legs);
    var by = {}, order = [], i, L, sym, cash = 0;

    for (i = 0; i < legs.length; i++) {
      L = legs[i];
      sym = L.sym;
      if (L.kind === "spot" && STABLE[sym]) { cash += L.usd || 0; continue; }
      if (L.base == null || !isFinite(L.base)) continue;
      if (!by[sym]) { by[sym] = { sym: sym, base: 0, usd: 0, price: priceOf(sym), spot: 0, perp: 0, lp: 0, option: 0, legs: [] }; order.push(sym); }
      by[sym].base += L.base;
      by[sym][L.kind === "option" ? "option" : L.kind] += L.base;
      by[sym].legs.push(L);
    }
    /* the quote side of an LP position is cash-like: it is quote held inside a
       pool, and it belongs in the cash leg, not in a delta. */
    for (i = 0; i < lps.length; i++) if (lps[i].quote != null && isFinite(lps[i].quote)) cash += lps[i].quote;

    var rows = [], net = 0, gross = 0;
    for (i = 0; i < order.length; i++) {
      var b = by[order[i]];
      b.usd = b.price == null ? null : b.base * b.price;
      if (b.usd != null) { net += b.usd; gross += Math.abs(b.usd); }
      rows.push(b);
    }
    rows.sort(function (a, c) { return Math.abs(c.usd || 0) - Math.abs(a.usd || 0); });

    var kept = rows.slice(0, MAX_ASSETS), tail = rows.slice(MAX_ASSETS);
    var perpEq = 0, perpMaint = 0, perpFund = 0;
    for (i = 0; i < perps.length; i++) {
      if (perps[i].equity != null) perpEq += perps[i].equity;
      if (perps[i].maint != null) perpMaint += perps[i].maint;
      if (perps[i].fundingPerDay != null) perpFund += perps[i].fundingPerDay;
    }

    return {
      legs: legs, spot: spot, perps: perps, lp: lps, options: op,
      rows: kept, tail: tail, byAsset: by,
      cashUSD: cash, netDeltaUSD: net, grossDeltaUSD: gross,
      perpEquityUSD: perpEq, perpMaintUSD: perpMaint, fundingPerDayUSD: perpFund,
      equityUSD: cash + net + perpEq - sumPerpNotionalDelta(perps),
      deltaPlusCashUSD: cash + net,
      truncated: tail.length ? tail.length + " smaller position(s) are outside the twelve the matrix covers, and are named under the table rather than folded in" : null
    };
  }

  /* A perp's USD delta is already counted in the delta table; its EQUITY is the
     margin plus unrealised, which is the cash-like part. Subtracting the delta
     avoids counting the same price exposure twice in the equity figure. */
  function sumPerpNotionalDelta(perps) {
    var s = 0, i;
    for (i = 0; i < perps.length; i++) if (perps[i].usd != null) s += perps[i].usd;
    return s;
  }

  function bookSymbols() {
    var e = exposure(), out = [], i;
    for (i = 0; i < e.rows.length; i++) out.push(e.rows[i].sym);
    if (out.indexOf("BTC") < 0 && priceOf("BTC") != null) out.push("BTC");
    return out;
  }

  /* ==========================================================================
     8 · MARGIN — isolated as the app models it, cross as a counterfactual
     ========================================================================== */

  /* Mark every perp under a shock map {SYM: fractional move} and report the
     margin state. Nothing is written; this builds a new object each time. */
  function marginState(perps, shock) {
    var p = PERP();
    if (!p) return { ok: false, reason: "DLAPP.perps is not loaded, so no margin figure can be read from the engine" };
    var rows = [], i, L, mark, eq, mt, ratio, liq, breach = false, worst = null;
    var sumEq = 0, sumMt = 0, anyMark = false;
    for (i = 0; i < perps.length; i++) {
      L = perps[i];
      if (L.mark == null) { rows.push({ sym: L.sym, why: "no mark price" }); continue; }
      var mv = shock && shock[L.sym] != null ? +shock[L.sym] : 0;
      mark = L.mark * (1 + mv);
      if (!(mark > 0)) mark = EPS;
      anyMark = true;
      try { eq = p.equity(L.shape, mark); } catch (e) { eq = null; }
      try { mt = p.maintenance(L.shape, mark); } catch (e) { mt = null; }
      try { ratio = p.marginRatio(L.shape, mark); } catch (e) { ratio = null; }
      try { liq = p.liqPrice(L.shape); } catch (e) { liq = null; }
      var brk = false;
      try { brk = !!p.breached(L.shape, mark); } catch (e) { brk = false; }
      if (brk) breach = true;
      if (eq != null) sumEq += eq;
      if (mt != null) sumMt += mt;
      var row = {
        sym: L.sym, id: L.id, side: L.side, qty: L.qty, entry: L.entry, lev: L.lev,
        mark: mark, move: mv, equity: eq, maint: mt, marginRatio: ratio, liq: liq,
        breached: brk, uPnl: (eq != null && L.margin != null) ? eq - L.margin : null,
        hf: (mt != null && mt > 0 && eq != null) ? eq / mt : (eq != null ? Infinity : null)
      };
      if (row.uPnl != null && (worst == null || row.uPnl < worst.uPnl)) worst = row;
      rows.push(row);
    }
    if (!anyMark) return { ok: false, reason: "no perp position has a mark price" };
    return {
      ok: true, rows: rows, isolatedBreach: breach, worst: worst,
      crossEquity: sumEq, crossMaint: sumMt,
      crossHF: sumMt > 0 ? sumEq / sumMt : (sumEq > 0 ? Infinity : null),
      n: rows.length
    };
  }

  /* The correlated move that takes the book to a health factor of 1, expressed
     as a BTC move and applied through each asset's beta. Bisection on a
     monotone-in-practice function: deterministic, 60 steps, and it reports the
     bracket it searched rather than pretending the answer is exact. */
  function bookLiquidation(perps, beta, mode) {
    var m = mode === "isolated" ? "isolated" : "cross";
    var base = marginState(perps, null);
    if (!base.ok) return { ok: false, reason: base.reason };
    if (!perps.length) return { ok: false, reason: "no perp position is open, so there is no liquidation level to find" };

    function shockAt(s) {
      var o = {}, i, b;
      for (i = 0; i < perps.length; i++) {
        b = beta && beta[perps[i].sym] != null ? beta[perps[i].sym] : 1;
        o[perps[i].sym] = b * s;
      }
      return o;
    }
    function bad(s) {
      var st = marginState(perps, shockAt(s));
      if (!st.ok) return true;
      return m === "isolated" ? st.isolatedBreach : !(st.crossHF != null && st.crossHF > 1);
    }
    /* search downward first (a long book dies on a fall), then upward */
    var dirs = [-1, 1], k, lo, hi, i, s;
    for (k = 0; k < dirs.length; k++) {
      lo = 0; hi = 0;
      for (i = 1; i <= 20; i++) { s = dirs[k] * i * 0.05; if (bad(s)) { hi = s; break; } lo = s; }
      if (hi === 0) continue;
      for (i = 0; i < 60; i++) {
        var mid = (lo + hi) / 2;
        if (bad(mid)) hi = mid; else lo = mid;
      }
      return {
        ok: true, mode: m, btcMove: hi, direction: dirs[k] < 0 ? "down" : "up",
        bracket: [lo, hi], note: "the size of a correlated move, stated as a BTC move and passed to every other asset through its beta, at which the book reaches a health factor of 1. It is the END state of an instantaneous move: a real path can liquidate on the way to a level the book would have survived."
      };
    }
    return { ok: false, reason: "no correlated move within plus or minus 100% brings the book to a health factor of 1 in " + m + " mode — the book is not close to liquidation on this axis" };
  }

  /* ==========================================================================
     9 · STRESS — measured historical shocks, applied as a correlated vector
     Every figure below is a RECORDED peak-to-trough move over the named window,
     rounded to a tenth of a percent. They are history, not a forecast, and an
     asset a scenario does not name is shocked by its beta to BTC.
     ========================================================================== */

  var SCENARIOS = [
    {
      id: "covid", name: "Black Thursday", when: "12-13 March 2020",
      window: "BTC 11 Mar close to 13 Mar low, UTC",
      src: "CoinGecko daily closes and intraday lows",
      note: "The market maker withdrawal. BitMEX went down for 25 minutes and that is the only reason the fall stopped where it did.",
      moves: { BTC: -0.372, ETH: -0.439, XRP: -0.400, LTC: -0.430, BNB: -0.392 },
      other: -0.450, stable: 0
    },
    {
      id: "may2021", name: "19 May 2021", when: "19 May 2021",
      window: "daily open to intraday low, UTC",
      src: "CoinGecko intraday",
      note: "A leverage flush. Several venues' price feeds stalled during it, so stops did not fire where their owners thought they would.",
      moves: { BTC: -0.310, ETH: -0.462, BNB: -0.550, DOGE: -0.480, ADA: -0.400 },
      other: -0.450, stable: 0
    },
    {
      id: "luna", name: "the LUNA week", when: "5-12 May 2022",
      window: "5 May high to 12 May low, UTC",
      src: "CoinGecko daily highs and lows; UST and USDT lows on 12 May",
      note: "A stablecoin failure that took the whole market with it. USDT traded down to 0.9485 intraday on 12 May — the one week in this library where a dollar was not a dollar.",
      moves: { BTC: -0.327, ETH: -0.412, LUNA: -1.000, UST: -0.700, SOL: -0.520, AVAX: -0.500, USDT: -0.0515 },
      other: -0.480, stable: -0.0515
    },
    {
      id: "ftx", name: "FTX", when: "8-9 November 2022",
      window: "7 Nov close to 9 Nov low, UTC",
      src: "CoinGecko daily closes and intraday lows",
      note: "A venue failure. The damage was concentrated in what the venue had touched, which is why SOL is three times BTC here and why a 'diversified' alt book was not.",
      moves: { BTC: -0.246, ETH: -0.312, SOL: -0.627, FTT: -0.940, BNB: -0.200 },
      other: -0.350, stable: 0
    },
    {
      id: "aug2024", name: "the yen carry unwind", when: "4-5 August 2024",
      window: "2 Aug close to 5 Aug low, UTC",
      src: "CoinGecko daily closes and intraday lows",
      note: "A shock that started outside crypto entirely. Correlation to equities went to one for about six hours, which is the argument against holding crypto as a diversifier.",
      moves: { BTC: -0.197, ETH: -0.276, SOL: -0.297, DOGE: -0.300 },
      other: -0.280, stable: 0
    }
  ];

  function scenarioById(id) {
    var i;
    for (i = 0; i < SCENARIOS.length; i++) if (SCENARIOS[i].id === id) return SCENARIOS[i];
    return null;
  }

  /* Build the shock vector for a scenario over the book's assets. Named assets
     take their measured move; everything else takes beta times the scenario's
     BTC move and is FLAGGED as modelled rather than measured. */
  function shockVector(sc, syms, beta) {
    var v = {}, how = {}, i, s, b;
    var btc = sc.moves.BTC != null ? sc.moves.BTC : sc.other;
    for (i = 0; i < syms.length; i++) {
      s = syms[i];
      if (STABLE[s]) { v[s] = sc.stable || 0; how[s] = sc.stable ? "measured depeg" : "held at par"; continue; }
      if (sc.moves[s] != null) { v[s] = sc.moves[s]; how[s] = "measured"; continue; }
      b = beta && beta[s] != null ? beta[s] : null;
      if (b != null) { v[s] = b * btc; how[s] = "modelled: beta " + b.toFixed(2) + " times the scenario's BTC move"; }
      else { v[s] = sc.other; how[s] = "modelled: the scenario's catch-all move, because no beta could be estimated"; }
    }
    return { shock: v, how: how, btc: btc };
  }

  /* Apply a shock vector to the whole book: spot, LP, perps, options. */
  function stress(opt) {
    opt = opt || {};
    var e = opt.exposure || exposure();
    var cv = opt.cov || covariance({ method: opt.method || "shrunk", lambda: opt.lambda });
    var bt = betaToBTC(cv);
    var beta = bt && bt.ok ? bt.beta : null;
    var syms = [], i;
    for (i = 0; i < e.rows.length; i++) syms.push(e.rows[i].sym);

    var sc = opt.custom ? null : scenarioById(opt.id || "covid");
    var sv;
    if (opt.custom) {
      if (opt.custom.factor != null) {
        var f = +opt.custom.factor, rho = opt.custom.rho != null ? +opt.custom.rho : null;
        var v = {}, how = {};
        for (i = 0; i < syms.length; i++) {
          if (STABLE[syms[i]]) { v[syms[i]] = 0; how[syms[i]] = "held at par"; continue; }
          if (rho != null) {
            /* a stated uniform correlation with the factor, scaled by the ratio
               of volatilities — the textbook single-factor beta when the
               correlation is asserted rather than estimated */
            var vi = cv.ok ? cv.vol[cv.syms.indexOf(syms[i])] : null;
            var vb = cv.ok && cv.syms.indexOf("BTC") >= 0 ? cv.vol[cv.syms.indexOf("BTC")] : null;
            var bb = (vi != null && vb > 0) ? rho * vi / vb : rho;
            v[syms[i]] = bb * f;
            how[syms[i]] = "modelled: an ASSERTED correlation of " + rho.toFixed(2) + " scaled by the volatility ratio";
          } else {
            var b2 = beta && beta[syms[i]] != null ? beta[syms[i]] : 1;
            v[syms[i]] = b2 * f;
            how[syms[i]] = "modelled: beta " + b2.toFixed(2) + " times the factor move";
          }
        }
        sv = { shock: v, how: how, btc: f };
        sc = { id: "custom", name: "custom factor shock", when: "now", window: "instantaneous", src: "your input", note: (rho != null ? "a market factor with BTC's volatility moving " + (f * 100).toFixed(1) + "%, passed to every asset INCLUDING BTC through an asserted correlation of " + rho.toFixed(2) + " scaled by the volatility ratio — so BTC itself takes " + (rho * f * 100).toFixed(1) + "%, not the headline figure." : "a BTC move of " + (f * 100).toFixed(1) + "% passed to every other asset through its estimated beta.") };
      } else {
        sv = { shock: opt.custom.moves || {}, how: {}, btc: (opt.custom.moves && opt.custom.moves.BTC) || 0 };
        for (i = 0; i < syms.length; i++) { if (sv.shock[syms[i]] == null) sv.shock[syms[i]] = 0; sv.how[syms[i]] = "your figure"; }
        sc = { id: "custom", name: "custom shock vector", when: "now", window: "instantaneous", src: "your input", note: "each asset moved by the figure you set. Nothing here is estimated." };
      }
    } else {
      if (!sc) return { ok: false, reason: "no such scenario" };
      sv = shockVector(sc, syms, beta);
    }

    /* per-asset P&L on delta */
    var rows = [], pnl = 0, worst = null;
    for (i = 0; i < e.rows.length; i++) {
      var R = e.rows[i], mv = sv.shock[R.sym] || 0;
      var dp = R.usd == null ? null : R.usd * mv;
      if (dp != null) pnl += dp;
      var row = { sym: R.sym, usd: R.usd, move: mv, how: sv.how[R.sym] || "—", pnl: dp, hasPerp: Math.abs(R.perp) > 1e-12, hasLp: Math.abs(R.lp) > 1e-12 };
      if (dp != null && (worst == null || dp < worst.pnl)) worst = row;
      rows.push(row);
    }

    var before = marginState(e.perps, null);
    var after = marginState(e.perps, sv.shock);
    var liqd = [], j;
    if (after.ok) for (j = 0; j < after.rows.length; j++) if (after.rows[j].breached) liqd.push(after.rows[j].sym + " " + after.rows[j].side);

    var eq0 = e.equityUSD;
    return {
      ok: true, scenario: sc, shock: sv.shock, how: sv.how,
      rows: rows, pnlUSD: pnl, worst: worst,
      equityBefore: eq0, equityAfter: eq0 == null ? null : eq0 + pnl,
      pnlPct: (eq0 != null && Math.abs(eq0) > EPS) ? pnl / Math.abs(eq0) : null,
      marginBefore: before, marginAfter: after,
      liquidated: liqd,
      damage: worst ? (worst.sym + " did the damage: " + fmtUSD(worst.pnl) + " of the " + fmtUSD(pnl) + (worst.hasPerp ? ", and it is the leveraged leg" : "")) : null,
      betaUsed: beta ? true : false,
      betaReason: bt && !bt.ok ? bt.reason : null
    };
  }

  /* ==========================================================================
     10 · DRAWDOWN AND RECOVERY
     ========================================================================== */

  /* The equity curve is RECONSTRUCTED: today's net delta per asset marked back
     through the seven-day history, cash held flat. It is not a record of the
     account. Every tab that shows it says so. */
  function equityCurve(e) {
    e = e || exposure();
    var cols = [], keep = [], i, h;
    for (i = 0; i < e.rows.length; i++) {
      if (e.rows[i].base == null || !isFinite(e.rows[i].base)) continue;
      h = histOf(e.rows[i].sym);
      if (!h.px) continue;
      cols.push({ sym: e.rows[i].sym, px: h.px, base: e.rows[i].base });
      keep.push(e.rows[i].sym);
    }
    if (!cols.length) return { ok: false, reason: "no asset in the book has a usable price series, so no equity curve can be reconstructed" };
    var T = cols[0].px.length;
    for (i = 1; i < cols.length; i++) if (cols[i].px.length < T) T = cols[i].px.length;
    /* the cash leg: whatever the account holds that is not price exposure */
    var cashLeg = (e.cashUSD || 0) + (e.perpEquityUSD || 0) - sumPerpNotionalDelta(e.perps);
    var curve = [], t, j, v;
    for (t = 0; t < T; t++) {
      v = cashLeg;
      for (j = 0; j < cols.length; j++) v += cols[j].base * cols[j].px[cols[j].px.length - T + t];
      curve.push(v);
    }
    return { ok: true, curve: curve, syms: keep, T: T, barsPerDay: barsPerDay(T), cashLeg: cashLeg };
  }

  function returnToRecover(d) {
    if (d == null || !isFinite(d)) return null;
    if (d >= 1) return Infinity;
    if (d <= 0) return 0;
    return 1 / (1 - d) - 1;
  }

  function recoveryTable(marks) {
    var list = marks || [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.75, 0.9], out = [], i;
    for (i = 0; i < list.length; i++) out.push({ dd: list[i], need: returnToRecover(list[i]) });
    return out;
  }

  function drawdown(curve, bpd, nowMs) {
    if (!engineReady()) return { ok: false, reason: "the typed engine is not loaded" };
    if (!curve || curve.length < 3) return { ok: false, reason: "the reconstructed curve is shorter than three bars" };
    var dd = emaxDD(curve);
    if (!dd) return { ok: false, reason: "the engine's maxDrawdown refused this curve" };

    var peak = -Infinity, under = [], i, d, longest = 0, run = 0, runStart = -1, longestStart = -1, longestEnd = -1;
    var sumSq = 0, sumAbs = 0;
    for (i = 0; i < curve.length; i++) {
      if (curve[i] > peak) peak = curve[i];
      d = peak > 0 ? curve[i] / peak - 1 : 0;
      under.push(d);
      sumSq += (d * 100) * (d * 100);
      sumAbs += Math.abs(d * 100);
      if (d < -1e-12) { if (run === 0) runStart = i; run++; if (run > longest) { longest = run; longestStart = runStart; longestEnd = i; } }
      else run = 0;
    }
    var ulcer = Math.sqrt(sumSq / curve.length);
    var pain = sumAbs / curve.length;

    /* time to recovery from the max-drawdown trough */
    var rec = null, recBars = null;
    if (dd.troughIndex >= 0 && dd.peakIndex >= 0) {
      var pv = curve[dd.peakIndex];
      for (i = dd.troughIndex + 1; i < curve.length; i++) if (curve[i] >= pv) { rec = i; break; }
      recBars = rec == null ? null : rec - dd.troughIndex;
    }

    var bars = bpd > 0 ? bpd : 48;
    var ppy = bars * 365;
    var rets = elogRets(curve) || [];
    var totalRet = (curve[0] > 0) ? curve[curve.length - 1] / curve[0] - 1 : null;
    var years = (curve.length - 1) / ppy;
    var cagr = (totalRet != null && years > 0) ? Math.pow(1 + totalRet, 1 / years) - 1 : null;

    var now = nowMs != null ? nowMs : 0;
    function at(i) { return now > 0 && bars > 0 ? now - (curve.length - 1 - i) * (DAY_MS / bars) : null; }

    var calmar = (cagr != null && dd.maxDD > 0) ? cagr / dd.maxDD : null;
    return {
      ok: true,
      underwater: under, maxDD: dd.maxDD, peakIndex: dd.peakIndex, troughIndex: dd.troughIndex,
      peakAt: at(dd.peakIndex), troughAt: at(dd.troughIndex), recoveredAt: rec == null ? null : at(rec),
      recoveredIndex: rec, recoveryBars: recBars,
      recoveryDays: recBars == null ? null : recBars / bars,
      stillUnderwater: rec == null && dd.maxDD > 0,
      longestUnderwaterBars: longest, longestUnderwaterDays: longest / bars,
      longestFrom: longestStart < 0 ? null : at(longestStart), longestTo: longestEnd < 0 ? null : at(longestEnd),
      ulcer: ulcer, painIndex: pain,
      painRatio: (cagr != null && pain > 0) ? (cagr * 100) / pain : null,
      totalReturn: totalRet, cagr: cagr, years: years,
      calmar: calmar, mar: calmar,
      calmarNote: "Calmar is published as the trailing 36 months and MAR as the whole record since inception. This window is seven days, so the two are the same number here and neither is the published statistic. It is shown to be argued with.",
      needToRecover: dd.maxDD > 0 ? returnToRecover(dd.maxDD) : 0,
      sharpe: esharpe(rets, ppy), sortino: esortino(rets, ppy),
      barsPerDay: bars, periodsPerYear: ppy, n: curve.length,
      annualisedNote: "annualised from " + curve.length + " " + spacingLabel(bars) + " bars — seven days multiplied by the square root of a year. Read it as a scale, not a forecast."
    };
  }

  /* ==========================================================================
     11 · SETTINGS (the v154 bucket, namespaced)
     ========================================================================== */

  var DEF = { method: "shrunk", lambda: LAMBDA, conf: 0.99, horizon: 1, kind: "param", scenario: "covid", crossFree: false, factor: -0.2, rho: null };

  function cfg(patch) {
    var x = null;
    try { x = C.X(); } catch (e) { x = null; }
    if (!x) return merge(DEF, patch || {});
    if (!x.risk) x.risk = merge(DEF, {});
    if (patch) { x.risk = merge(x.risk, patch); try { C.save(); } catch (e) {} }
    return merge(DEF, x.risk);
  }
  function merge(a, b) {
    var o = {}, k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) o[k] = a[k];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) o[k] = b[k];
    return o;
  }

  /* ==========================================================================
     12 · FORMATTING
     ========================================================================== */

  function esc(s) { try { return C.esc ? C.esc(String(s)) : String(s).replace(/[&<>"]/g, ""); } catch (e) { return ""; } }
  function fmtUSD(n) {
    if (n == null || !isFinite(n)) return "—";
    try { if (C.money) return C.money(n, Math.abs(n) >= 1000 ? 0 : 2); } catch (e) {}
    return (n < 0 ? "−$" : "$") + Math.abs(n).toFixed(2);
  }
  function fmtPct(n, dp) {
    if (n == null || !isFinite(n)) return "—";
    return (n >= 0 ? "" : "−") + Math.abs(n * 100).toFixed(dp == null ? 2 : dp) + "%";
  }
  function fmtSigned(n, dp) {
    if (n == null || !isFinite(n)) return "—";
    return (n >= 0 ? "+" : "−") + Math.abs(n * 100).toFixed(dp == null ? 2 : dp) + "%";
  }
  function fmtNum(n, dp) {
    if (n == null || !isFinite(n)) return "—";
    if (n === Infinity) return "∞";
    return n.toFixed(dp == null ? 3 : dp);
  }
  function fmtBase(n) {
    if (n == null || !isFinite(n)) return "—";
    var a = Math.abs(n);
    if (a >= 1000) return n.toFixed(1);
    if (a >= 1) return n.toFixed(4);
    return n.toFixed(8);
  }
  function fmtP(p) {
    if (p == null || !isFinite(p)) return "—";
    if (p < 0.001) return "< 0.001";
    return p.toFixed(3);
  }
  function fmtDate(ms) {
    if (!(ms > 0)) return "—";
    try { return new Date(ms).toISOString().slice(5, 16).replace("T", " "); } catch (e) { return "—"; }
  }
  function cls(n) { return n == null || !isFinite(n) ? "" : (n >= 0 ? "rk-up" : "rk-dn"); }

  /* ==========================================================================
     13 · THE ANALYSIS THE PANES SHARE
     One build per paint, so the tabs cannot disagree with each other.
     ========================================================================== */

  var LAST = null;

  function build(force) {
    var c = cfg();
    var e = exposure();
    var cv = covariance({ method: c.method, lambda: c.lambda });
    var bt = betaToBTC(cv);
    var ec = equityCurve(e);
    var pr = ec.ok ? elogRets(ec.curve) : [];
    var eq = e.equityUSD;
    var vs = varSuite(pr, c.conf, c.horizon, eq);
    var bk = backtestVaR(pr, c.conf, null, c.kind);
    var dd = ec.ok ? drawdown(ec.curve, ec.barsPerDay, C.now ? C.now() : 0) : { ok: false, reason: ec.reason };

    /* weights for the contribution arithmetic: dollar delta over net equity */
    var w = [], i, idx, ok = cv.ok && eq != null && Math.abs(eq) > 1;
    if (ok) {
      for (i = 0; i < cv.syms.length; i++) {
        idx = -1;
        var j;
        for (j = 0; j < e.rows.length; j++) if (e.rows[j].sym === cv.syms[i]) { idx = j; break; }
        w.push(idx >= 0 && e.rows[idx].usd != null ? e.rows[idx].usd / eq : 0);
      }
    }
    var rc = ok ? riskContrib(w, cv.cov) : { ok: false, reason: cv.ok ? "the book has no net equity to weight against" : cv.reason };
    var con = concentration(ok ? w : []);
    LAST = { cfg: c, exp: e, cov: cv, beta: bt, eqCurve: ec, portRets: pr, varr: vs, back: bk, dd: dd, w: w, rc: rc, con: con, equityUSD: eq };
    return LAST;
  }

  function banner() {
    return '<div class="rk-banner">READ-ONLY. This desk never trades, never opens an order and never writes a balance. It reads the book, the engine and the app\'s own price history, and prints what they say.</div>';
  }
  function windowStrip(A) {
    var cv = A.cov;
    var n = cv.T || (A.portRets ? A.portRets.length : 0);
    return '<div class="rk-strip">window: ' + n + ' ' + esc(spacingLabel(cv.barsPerDay || (A.eqCurve.ok ? A.eqCurve.barsPerDay : null))) +
      ' returns (seven days, the app\'s own seeded series) · estimator: ' + esc(cv.method) +
      (cv.method === "ewma" ? ' at lambda ' + fmtNum(cv.lambda, 2) : "") +
      (cv.effN != null ? ' · effective sample ' + fmtNum(cv.effN, 1) + ' bars' : "") +
      (cv.delta != null ? ' · shrinkage intensity ' + fmtNum(cv.delta, 3) : "") + '</div>';
  }

  /* ---------------------------------------------------------- Exposure tab */

  function paneExposure() {
    var A = build(), e = A.exp, cv = A.cov, h = banner();
    h += windowStrip(A);

    h += '<div class="rk-kpis">' +
      kpi("Net delta", fmtUSD(e.netDeltaUSD), "the book's directional exposure in dollars") +
      kpi("Gross delta", fmtUSD(e.grossDeltaUSD), "long plus short, unnetted") +
      kpi("Cash and quote", fmtUSD(e.cashUSD), "stablecoin balances plus the quote side of every LP position") +
      kpi("Perp equity", fmtUSD(e.perpEquityUSD), "isolated margin plus unrealised, across every open perp") +
      kpi("Account equity", fmtUSD(e.equityUSD), "cash, spot and LP marked, plus perp equity") +
      kpi("Funding carry", e.fundingPerDayUSD == null ? "—" : fmtUSD(-e.fundingPerDayUSD) + "/day", "positive means the book is PAID to hold these perps") +
      '</div>';

    /* per-asset delta */
    h += '<div class="rk-sub">Net delta, by asset</div>';
    if (!e.rows.length) h += '<div class="dl-empty">The book holds no price exposure. Buy something, open a perp or provide liquidity and this table fills.</div>';
    else {
      h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Asset</th><th class="r">Spot</th><th class="r">Perp</th><th class="r">LP</th><th class="r">Option</th><th class="r">Net (base)</th><th class="r">Net (USD)</th><th class="r">Beta to BTC</th><th class="r">Weight</th></tr></thead><tbody>';
      var i, b = A.beta && A.beta.ok ? A.beta.beta : null;
      for (i = 0; i < e.rows.length; i++) {
        var R = e.rows[i];
        h += '<tr><td class="rk-n">' + esc(R.sym) + '</td>' +
          '<td class="r">' + (Math.abs(R.spot) > 1e-12 ? fmtBase(R.spot) : "—") + '</td>' +
          '<td class="r ' + cls(R.perp) + '">' + (Math.abs(R.perp) > 1e-12 ? fmtBase(R.perp) : "—") + '</td>' +
          '<td class="r">' + (Math.abs(R.lp) > 1e-12 ? fmtBase(R.lp) : "—") + '</td>' +
          '<td class="r">' + (Math.abs(R.option) > 1e-12 ? fmtBase(R.option) : "—") + '</td>' +
          '<td class="r">' + fmtBase(R.base) + '</td>' +
          '<td class="r rk-usd ' + cls(R.usd) + '">' + fmtUSD(R.usd) + '</td>' +
          '<td class="r">' + (b && b[R.sym] != null ? fmtNum(b[R.sym], 2) : "—") + '</td>' +
          '<td class="r">' + (A.w.length && cv.ok ? (cv.syms.indexOf(R.sym) >= 0 ? fmtPct(A.w[cv.syms.indexOf(R.sym)], 1) : "—") : "—") + '</td></tr>';
      }
      h += '</tbody></table></div>';
    }
    if (e.truncated) h += '<div class="rk-note">' + esc(e.truncated) + '</div>';
    if (e.options.present && e.options.reason) h += '<div class="rk-warn">' + esc(e.options.reason) + '</div>';
    if (!e.options.present) h += '<div class="rk-note">No options layer is loaded, so there is no option delta to read. Nothing here is treated as zero on its behalf.</div>';

    /* position decomposition */
    h += '<div class="rk-sub">How each position decomposes</div>';
    h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Position</th><th>Type</th><th class="r">Base delta</th><th class="r">USD</th><th>What the arithmetic is</th></tr></thead><tbody>';
    var k, any = false;
    for (k = 0; k < e.spot.length; k++) {
      var sp = e.spot[k];
      if (sp.cash) continue;
      any = true;
      h += '<tr><td class="rk-n">' + esc(sp.sym) + '</td><td>spot</td><td class="r">' + fmtBase(sp.base) + '</td><td class="r">' + fmtUSD(sp.usd) + '</td><td class="rk-w">a balance is its own delta, one for one</td></tr>';
    }
    for (k = 0; k < e.perps.length; k++) {
      var pl = e.perps[k]; any = true;
      h += '<tr><td class="rk-n">' + esc(pl.sym) + ' ' + esc(pl.side) + ' ' + (pl.lev ? pl.lev + "x" : "") + '</td><td>perp</td><td class="r ' + cls(pl.base) + '">' + fmtBase(pl.base) + '</td><td class="r ' + cls(pl.usd) + '">' + fmtUSD(pl.usd) + '</td><td class="rk-w">' +
        'notional ' + fmtUSD(pl.notional) + ', ' + esc(pl.side) + ' so delta is ' + (pl.dir > 0 ? "+" : "−") + 'qty. ' +
        (pl.rate8h == null ? "no funding rate available." :
          "funding " + fmtNum(pl.rate8h * 100, 4) + "%/8h, carry " + fmtUSD(pl.fundingPerDay) + "/day " + (pl.fundingPerDay > 0 ? "PAID" : "RECEIVED") + ". " +
          (pl.liqDriftPerDay == null ? "" : "isolated margin, so that funding walks the liquidation price " + fmtUSD(Math.abs(pl.liqDriftPerDay)) + "/day " + (pl.liqDriftPerDay > 0 ? "up" : "down") +
            (pl.fundingDaysToLiq != null ? " — funding alone reaches the mark in " + fmtNum(pl.fundingDaysToLiq, 1) + " days" : "") + ".")) +
        '</td></tr>';
    }
    for (k = 0; k < e.lp.length; k++) {
      var lq = e.lp[k]; any = true;
      h += '<tr><td class="rk-n">' + esc(lq.sym) + ' ' + esc(lq.lpKind) + '</td><td>LP</td><td class="r">' + (lq.base == null ? "—" : fmtBase(lq.base)) + '</td><td class="r">' + fmtUSD(lq.usd) + '</td><td class="rk-w">' + esc(lq.note || lq.why || "—") + '</td></tr>';
    }
    for (k = 0; k < e.options.legs.length; k++) {
      var op = e.options.legs[k]; any = true;
      h += '<tr><td class="rk-n">' + esc(op.label) + '</td><td>option</td><td class="r">' + fmtBase(op.base) + '</td><td class="r">' + fmtUSD(op.usd) + '</td><td class="rk-w">delta read from ' + esc(op.src) + '</td></tr>';
    }
    if (!any) h += '<tr><td colspan="5" class="rk-w">nothing open</td></tr>';
    h += '</tbody></table></div>';

    /* correlation matrix */
    h += '<div class="rk-sub">Correlation</div>';
    if (!cv.ok) h += '<div class="rk-refuse"><b>refused</b> — ' + esc(cv.reason) + '</div>';
    else {
      h += '<div class="dl-tblw"><table class="dl-tbl rk-mx"><thead><tr><th></th>';
      var a, c2;
      for (a = 0; a < cv.syms.length; a++) h += '<th class="r">' + esc(cv.syms[a]) + '</th>';
      h += '</tr></thead><tbody>';
      for (a = 0; a < cv.syms.length; a++) {
        h += '<tr><td class="rk-n">' + esc(cv.syms[a]) + '</td>';
        for (c2 = 0; c2 < cv.syms.length; c2++) {
          var v = cv.corr[a][c2];
          h += '<td class="r" data-r="' + (v == null ? "" : (v >= 0.8 ? "hi" : v >= 0.4 ? "mid" : v <= -0.4 ? "neg" : "lo")) + '">' + (v == null ? "—" : v.toFixed(2)) + '</td>';
        }
        h += '</tr>';
      }
      h += '</tbody></table></div>';
      h += '<div class="rk-note">Diagonal is 1 by construction. ' +
        (cv.method === "shrunk" ? 'Shrinkage intensity ' + fmtNum(cv.delta, 3) + ' toward an average correlation of ' + fmtNum(cv.rbar, 3) + ' — at intensity 1 every off-diagonal here would BE that average.' :
          cv.method === "ewma" ? 'Exponentially weighted at lambda ' + fmtNum(cv.lambda, 2) + ', effective sample ' + fmtNum(cv.effN, 1) + ' bars out of ' + cv.T + '.' :
            'Plain sample correlation over ' + cv.T + ' returns, no weighting and no shrinkage.') + '</div>';
      if (cv.singular) h += '<div class="rk-warn">' + cv.N + ' assets against ' + cv.T + ' returns: the SAMPLE matrix is singular. Only the shrunk estimator is invertible here, and its intensity is the price of that.</div>';
    }
    if (cv.dropped && cv.dropped.length) {
      h += '<div class="rk-note">Left out of the matrix by name: ';
      var dsr = [], dq;
      for (dq = 0; dq < cv.dropped.length; dq++) dsr.push(esc(cv.dropped[dq].sym) + " (" + esc(cv.dropped[dq].why) + ")");
      h += dsr.join("; ") + '</div>';
    }

    /* contribution and concentration */
    h += '<div class="rk-sub">Concentration and risk contribution</div>';
    if (!A.rc.ok) h += '<div class="rk-refuse"><b>refused</b> — ' + esc(A.rc.reason) + '</div>';
    else {
      h += '<div class="rk-kpis">' +
        kpi("Portfolio volatility", fmtPct(A.rc.sigma, 3) + " / bar", "one " + esc(spacingLabel(cv.barsPerDay)) + " bar, from w'Sw") +
        kpi("HHI", fmtNum(A.con.hhi, 3), "1/N = " + fmtNum(A.con.floor, 3) + " is perfectly even, 1 is one position") +
        kpi("Effective positions", fmtNum(A.con.effectiveN, 2), "1/HHI — how many positions this book really is") +
        kpi("Top 1 / top 3", fmtPct(A.con.top1, 1) + " / " + fmtPct(A.con.top3, 1), "share of gross exposure") +
        '</div>';
      h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Asset</th><th class="r">Weight</th><th class="r">Volatility</th><th class="r">MCTR</th><th class="r">CCTR</th><th class="r">Share of risk</th></tr></thead><tbody>';
      var q2;
      for (q2 = 0; q2 < cv.syms.length; q2++) {
        h += '<tr><td class="rk-n">' + esc(cv.syms[q2]) + '</td><td class="r">' + fmtPct(A.w[q2], 1) + '</td><td class="r">' + fmtPct(cv.vol[q2], 3) + '</td>' +
          '<td class="r">' + fmtPct(A.rc.mctr[q2], 3) + '</td><td class="r ' + cls(A.rc.cctr[q2]) + '">' + fmtPct(A.rc.cctr[q2], 3) + '</td>' +
          '<td class="r">' + fmtPct(A.rc.sigma > 0 ? A.rc.cctr[q2] / A.rc.sigma : null, 1) + '</td></tr>';
      }
      h += '</tbody></table></div>';
      h += '<div class="rk-ident" data-ok="' + (A.rc.identityHolds ? "1" : "0") + '"><b>identity check</b> — the component contributions must sum EXACTLY to portfolio volatility, because w\'(Sw)/sigma is sigma. Sum ' +
        fmtPct(A.rc.sumCCTR, 6) + ' against ' + fmtPct(A.rc.sigma, 6) + ', residual ' + A.rc.residual.toExponential(2) + '. ' +
        (A.rc.identityHolds ? 'It holds, which is the check that says every matrix figure above it is wired up right.' : 'IT DOES NOT HOLD. Treat every matrix figure on this desk as broken until it does.') + '</div>';
    }
    return h;
  }

  function kpi(label, value, note) {
    return '<div class="rk-kpi"><span class="rk-kl">' + esc(label) + '</span><b class="rk-kv">' + esc(value) + '</b><span class="rk-kn">' + esc(note) + '</span></div>';
  }

  /* --------------------------------------------------------------- VaR tab */

  function paneVaR() {
    var A = build(), c = A.cfg, V = A.varr, B = A.back, h = banner();
    h += windowStrip(A);
    h += '<div class="dl-2 rk-form">' +
      field("Confidence", '<select id="rkConf" class="dl-inp" aria-label="Confidence">' + optsOf([0.90, 0.95, 0.975, 0.99, 0.995], c.conf, function (v) { return (v * 100).toFixed(v === 0.975 || v === 0.995 ? 1 : 0) + "%"; }) + '</select>') +
      field("Horizon (bars)", '<select id="rkHz" class="dl-inp" aria-label="Horizon in bars">' + optsOf([1, 2, 6, 12, 24, 48, 96, 336], c.horizon, function (v) { return v + (v === 1 ? " bar" : " bars"); }) + '</select>') +
      field("Estimator", '<select id="rkMethod" class="dl-inp" aria-label="Covariance estimator"><option value="shrunk"' + (c.method === "shrunk" ? " selected" : "") + '>Ledoit-Wolf shrunk</option><option value="sample"' + (c.method === "sample" ? " selected" : "") + '>sample</option><option value="ewma"' + (c.method === "ewma" ? " selected" : "") + '>EWMA</option></select>') +
      field("EWMA lambda", '<select id="rkLam" class="dl-inp" aria-label="EWMA lambda">' + optsOf([0.90, 0.92, 0.94, 0.96, 0.97, 0.99], c.lambda, function (v) { return v.toFixed(2) + (v === 0.94 ? " (RiskMetrics daily)" : v === 0.97 ? " (RiskMetrics monthly)" : ""); }) + '</select>') +
      field("Backtest model", '<select id="rkKind" class="dl-inp" aria-label="Model to backtest"><option value="param"' + (c.kind === "param" ? " selected" : "") + '>parametric normal</option><option value="hist"' + (c.kind === "hist" ? " selected" : "") + '>historical</option><option value="cf"' + (c.kind === "cf" ? " selected" : "") + '>Cornish-Fisher</option></select>') +
      '</div><div class="rk-actions"><button class="go" id="rkApply">Recompute</button></div>';

    if (!V.ok) { h += '<div class="rk-refuse"><b>refused</b> — ' + esc(V.reason) + '</div>'; return h; }

    var hz = c.horizon > 1 ? " over " + c.horizon + " bars" : " over one bar";
    h += '<div class="rk-sub">Value at risk, ' + (c.conf * 100).toFixed(1) + '%' + esc(hz) + '</div>';
    h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Method</th><th class="r">VaR</th><th class="r">VaR (USD)</th><th class="r">CVaR</th><th class="r">CVaR (USD)</th><th>What it assumes</th></tr></thead><tbody>';
    h += '<tr><td class="rk-n">historical simulation</td><td class="r">' + fmtPct(V.hist.varPct, 2) + '</td><td class="r">' + fmtUSD(V.usd && V.usd.hist) + '</td><td class="r">' + fmtPct(V.hist.cvarPct, 2) + '</td><td class="r">' + fmtUSD(V.usd && V.usd.histCVaR) + '</td><td class="rk-w">no distribution at all — the empirical quantile of ' + V.n + ' returns, ' + V.hist.tailN + ' of them in the tail. It can never be worse than the worst bar in the window, which is its whole weakness.</td></tr>';
    h += '<tr><td class="rk-n">parametric normal</td><td class="r">' + fmtPct(V.param.varPct, 2) + '</td><td class="r">' + fmtUSD(V.usd && V.usd.param) + '</td><td class="r">' + fmtPct(V.param.cvarPct, 2) + '</td><td class="r">' + fmtUSD(V.usd && V.usd.paramCVaR) + '</td><td class="rk-w">mu + z sigma, z = ' + fmtNum(V.z, 4) + '. At 99% with zero drift that is 2.3263 sigma, and the CVaR is phi(z)/(1-c) = 2.6652 sigma. Normal tails, which crypto does not have.</td></tr>';
    h += '<tr><td class="rk-n">Cornish-Fisher modified</td><td class="r">' + (V.cf.varPct == null ? "refused" : fmtPct(V.cf.varPct, 2)) + '</td><td class="r">' + fmtUSD(V.usd && V.usd.cf) + '</td><td class="r">—</td><td class="r">—</td><td class="rk-w">' +
      (V.cf.varPct == null ? esc(V.cf.reason) : 'four moments: skew ' + fmtNum(V.skew, 3) + ', excess kurtosis ' + fmtNum(V.exKurt, 3) + ', z adjusted from ' + fmtNum(V.z, 4) + ' to ' + fmtNum(V.zcf, 4) + '. At zero skew and zero excess kurtosis it returns z exactly.') + '</td></tr>';
    h += '</tbody></table></div>';

    if (V.scaled) h += '<div class="rk-warn"><b>square-root-of-time, and it is an assumption.</b> mu scaled by ' + c.horizon + ', sigma by ' + fmtNum(Math.sqrt(c.horizon), 3) + ', skew by 1/' + fmtNum(Math.sqrt(c.horizon), 3) + ' and excess kurtosis by 1/' + c.horizon + ' — the i.i.d. aggregation. ' + esc(V.breaks) + '</div>';
    else h += '<div class="rk-note">No horizon scaling is applied at one bar, so nothing on this table is assumed beyond each method\'s own distribution.</div>';

    h += '<div class="rk-sub">Backtest — does the VaR hold up</div>';
    if (!B.ok) h += '<div class="rk-refuse"><b>refused</b> — ' + esc(B.reason) + '</div>';
    else {
      h += '<div class="rk-verdict" data-tone="' + esc(B.verdict.tone) + '">' + esc(B.verdict.text) + '</div>';
      h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Test</th><th class="r">Statistic</th><th class="r">p</th><th class="r">at 5%</th><th>What it asks</th></tr></thead><tbody>';
      h += '<tr><td class="rk-n">Kupiec, proportion of failures</td><td class="r">' + fmtNum(B.kupiec.lr, 3) + '</td><td class="r">' + fmtP(B.kupiec.p) + '</td><td class="r">' + (B.kupiec.p >= 0.05 ? "pass" : "FAIL") + '</td><td class="rk-w">is the exception RATE right? ' + B.exceptions + ' exceptions in ' + B.tested + ' tested bars, ' + fmtPct(B.rate, 2) + ' against an expected ' + fmtPct(B.expectedRate, 2) + ' (' + fmtNum(B.kupiec.expected, 1) + ' expected). Chi-square, one degree of freedom.</td></tr>';
      if (B.christoffersen && B.christoffersen.lr != null) {
        h += '<tr><td class="rk-n">Christoffersen, independence</td><td class="r">' + fmtNum(B.christoffersen.lr, 3) + '</td><td class="r">' + fmtP(B.christoffersen.p) + '</td><td class="r">' + (B.christoffersen.p >= 0.05 ? "pass" : "FAIL") + '</td><td class="rk-w">do the exceptions CLUSTER? transitions n00=' + B.christoffersen.n00 + ', n01=' + B.christoffersen.n01 + ', n10=' + B.christoffersen.n10 + ', n11=' + B.christoffersen.n11 + '. An exception after an exception ' + fmtPct(B.christoffersen.p11, 1) + ' of the time against ' + fmtPct(B.christoffersen.p01, 1) + ' otherwise.</td></tr>';
      } else {
        h += '<tr><td class="rk-n">Christoffersen, independence</td><td class="r">—</td><td class="r">—</td><td class="r">—</td><td class="rk-w">' + esc((B.christoffersen && B.christoffersen.reason) || "not testable") + '</td></tr>';
      }
      if (B.cc) h += '<tr><td class="rk-n">conditional coverage</td><td class="r">' + fmtNum(B.cc.lr, 3) + '</td><td class="r">' + fmtP(B.cc.p) + '</td><td class="r">' + (B.cc.p >= 0.05 ? "pass" : "FAIL") + '</td><td class="rk-w">the two above summed, chi-square with two degrees of freedom.</td></tr>';
      h += '</tbody></table></div>';
      h += '<div class="rk-note">Walk-forward: the model is fitted on the first ' + B.window + ' bars and every bar after it is scored, refitting each step. Average VaR level over the test ' + fmtPct(B.meanLevel, 2) + '. Seven days of half-hourly bars is a small test and a pass here is weak evidence — a FAIL, though, is strong evidence, and the clustering failure is the one that matters.</div>';
    }
    return h;
  }

  function field(label, inner) { return '<label class="rk-f"><span class="rk-fl">' + esc(label) + '</span>' + inner + '</label>'; }
  function optsOf(list, cur, fmt) {
    var h = "", i;
    for (i = 0; i < list.length; i++) h += '<option value="' + list[i] + '"' + (Math.abs(+cur - list[i]) < 1e-9 ? " selected" : "") + '>' + esc(fmt ? fmt(list[i]) : list[i]) + '</option>';
    return h;
  }

  /* ------------------------------------------------------------ Stress tab */

  function paneStress() {
    var A = build(), c = A.cfg, h = banner();
    h += windowStrip(A);
    h += '<div class="rk-sub">The library — measured moves, named windows</div>';
    h += '<div class="rk-scen">';
    var i;
    for (i = 0; i < SCENARIOS.length; i++) {
      var s = SCENARIOS[i];
      h += '<button class="rk-sb' + (c.scenario === s.id ? " on" : "") + '" data-scen="' + esc(s.id) + '"><b>' + esc(s.name) + '</b><span>' + esc(s.when) + '</span><em>BTC ' + fmtSigned(s.moves.BTC, 1) + '</em></button>';
    }
    h += '</div>';

    h += '<div class="dl-2 rk-form">' +
      field("Custom factor move", '<select id="rkFactor" class="dl-inp" aria-label="Custom factor move">' + optsOf([-0.05, -0.1, -0.2, -0.35, -0.5, 0.1, 0.2], c.factor, function (v) { return (v * 100).toFixed(0) + "%"; }) + '</select>') +
      field("Correlation assumption", '<select id="rkRho" class="dl-inp" aria-label="Correlation assumption"><option value=""' + (c.rho == null ? " selected" : "") + '>use each asset\'s estimated beta</option>' + optsOf([0.5, 0.7, 0.85, 1], c.rho == null ? -9 : c.rho, function (v) { return "assert correlation " + v.toFixed(2); }) + '</select>') +
      '</div><div class="rk-actions"><button class="go" id="rkCustom">Run the custom shock</button><span class="rk-sendnote">A factor move is passed to every asset through its beta, or through the correlation you assert. Nothing is traded.</span></div>';

    var res = c.scenario === "custom"
      ? stress({ exposure: A.exp, cov: A.cov, custom: { factor: c.factor, rho: c.rho } })
      : stress({ exposure: A.exp, cov: A.cov, id: c.scenario });
    if (!res.ok) { h += '<div class="rk-refuse"><b>refused</b> — ' + esc(res.reason) + '</div>'; return h; }

    h += '<div class="rk-sub">' + esc(res.scenario.name) + ' — ' + esc(res.scenario.when) + '</div>';
    h += '<div class="rk-note"><b>window:</b> ' + esc(res.scenario.window) + ' · <b>source:</b> ' + esc(res.scenario.src) + '. ' + esc(res.scenario.note) + ' Applied as an INSTANTANEOUS shock: a real move takes hours, and for a leveraged book the path can liquidate you on the way to a level you would have survived.</div>';

    h += '<div class="rk-kpis">' +
      kpi("P&L", fmtUSD(res.pnlUSD), "delta times the shock, summed across the book") +
      kpi("Of equity", fmtPct(res.pnlPct, 1), "against account equity of " + fmtUSD(res.equityBefore)) +
      kpi("Equity after", fmtUSD(res.equityAfter), "before any liquidation is applied") +
      kpi("Health factor", res.marginAfter.ok ? fmtNum(res.marginAfter.crossHF, 2) : "—", "cross-margin equivalent, equity over maintenance; 1 is liquidation") +
      '</div>';
    if (res.damage) h += '<div class="rk-verdict" data-tone="bad">' + esc(res.damage) + '</div>';
    if (res.liquidated.length) h += '<div class="rk-warn">Liquidated under this shock, in isolated margin as the app actually runs it: ' + esc(res.liquidated.join(", ")) + '.</div>';

    h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Asset</th><th class="r">Net delta (USD)</th><th class="r">Move</th><th class="r">P&L</th><th>Where the move came from</th></tr></thead><tbody>';
    for (i = 0; i < res.rows.length; i++) {
      var R = res.rows[i];
      h += '<tr><td class="rk-n">' + esc(R.sym) + '</td><td class="r">' + fmtUSD(R.usd) + '</td><td class="r ' + cls(R.move) + '">' + fmtSigned(R.move, 1) + '</td><td class="r ' + cls(R.pnl) + '">' + fmtUSD(R.pnl) + '</td><td class="rk-w">' + esc(R.how) + '</td></tr>';
    }
    h += '</tbody></table></div>';
    if (res.betaReason) h += '<div class="rk-note">' + esc(res.betaReason) + ' — unnamed assets fell back to the scenario\'s catch-all move.</div>';

    /* margin under the shock */
    h += '<div class="rk-sub">Margin, before and after</div>';
    if (!res.marginAfter.ok) h += '<div class="rk-refuse"><b>refused</b> — ' + esc(res.marginAfter.reason) + '</div>';
    else if (!res.marginAfter.rows.length) h += '<div class="dl-empty">No perp is open, so there is no margin to stress.</div>';
    else {
      h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Position</th><th class="r">Mark after</th><th class="r">Liquidation</th><th class="r">Equity</th><th class="r">Maintenance</th><th class="r">HF</th><th class="r">State</th></tr></thead><tbody>';
      for (i = 0; i < res.marginAfter.rows.length; i++) {
        var M = res.marginAfter.rows[i];
        if (M.why) { h += '<tr><td class="rk-n">' + esc(M.sym) + '</td><td colspan="6" class="rk-w">' + esc(M.why) + '</td></tr>'; continue; }
        h += '<tr><td class="rk-n">' + esc(M.sym) + ' ' + esc(M.side) + '</td><td class="r">' + fmtUSD(M.mark) + '</td><td class="r">' + fmtUSD(M.liq) + '</td><td class="r ' + cls(M.equity) + '">' + fmtUSD(M.equity) + '</td><td class="r">' + fmtUSD(M.maint) + '</td><td class="r">' + fmtNum(M.hf, 2) + '</td><td class="r">' + (M.breached ? '<span class="rk-liq">LIQUIDATED</span>' : "open") + '</td></tr>';
      }
      h += '</tbody></table></div>';
      h += '<div class="rk-note">Isolated: ' + (res.marginBefore.ok ? 'cross-margin equivalent before the shock was HF ' + fmtNum(res.marginBefore.crossHF, 2) + ' on ' + fmtUSD(res.marginBefore.crossEquity) + ' of equity against ' + fmtUSD(res.marginBefore.crossMaint) + ' of maintenance' : "—") + '. The cross figure is a COUNTERFACTUAL — the app posts margin per position and cannot trade the book this way.</div>';
    }

    /* the standing −20% / −35% table and the book liquidation level */
    h += '<div class="rk-sub">The two moves worth knowing by heart</div>';
    h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Correlated move</th><th class="r">P&L</th><th class="r">Equity after</th><th class="r">Cross HF</th><th class="r">Liquidated</th></tr></thead><tbody>';
    var moves = [-0.20, -0.35], mi;
    for (mi = 0; mi < moves.length; mi++) {
      var r2 = stress({ exposure: A.exp, cov: A.cov, custom: { factor: moves[mi], rho: null } });
      h += '<tr><td class="rk-n">' + (moves[mi] * 100).toFixed(0) + '% on BTC, everything else by its beta</td><td class="r ' + cls(r2.pnlUSD) + '">' + fmtUSD(r2.pnlUSD) + '</td><td class="r">' + fmtUSD(r2.equityAfter) + '</td><td class="r">' + (r2.marginAfter.ok ? fmtNum(r2.marginAfter.crossHF, 2) : "—") + '</td><td class="r">' + (r2.liquidated.length ? esc(r2.liquidated.join(", ")) : "none") + '</td></tr>';
    }
    h += '</tbody></table></div>';

    var bl = bookLiquidation(A.exp.perps, A.beta && A.beta.ok ? A.beta.beta : null, "cross");
    var bi = bookLiquidation(A.exp.perps, A.beta && A.beta.ok ? A.beta.beta : null, "isolated");
    h += '<div class="rk-note"><b>book liquidation level.</b> ' +
      (bl.ok ? 'Cross-margin equivalent: a correlated move of ' + fmtSigned(bl.btcMove, 1) + ' on BTC takes the book to a health factor of 1. ' : esc(bl.reason) + ' ') +
      (bi.ok ? 'Isolated, as the app actually runs it: the first position breaches at ' + fmtSigned(bi.btcMove, 1) + '. ' : "") +
      'Found by bisection on a single market factor passed through each asset\'s beta, 60 steps. ' + (bl.ok ? esc(bl.note) : "") + '</div>';
    return h;
  }

  /* ---------------------------------------------------------- Drawdown tab */

  function paneDrawdown() {
    var A = build(), D = A.dd, h = banner();
    h += '<div class="rk-warn"><b>this curve is a reconstruction, not a record.</b> The app keeps no history of your account value, so today\'s net delta per asset is marked backwards through the seven-day price history with the cash leg held flat. It answers "what would this book have done last week", not "what did you do last week". Every trade you actually made in that window is invisible to it.</div>';
    if (!D.ok) { h += '<div class="rk-refuse"><b>refused</b> — ' + esc(D.reason) + '</div>'; return h; }

    h += '<div class="rk-kpis">' +
      kpi("Max drawdown", fmtPct(-D.maxDD, 2), "peak to trough on the reconstructed curve") +
      kpi("Return needed", fmtPct(D.needToRecover, 2), "1/(1-d) - 1, computed") +
      kpi("Ulcer index", fmtNum(D.ulcer, 2), "root mean square of the percentage drawdowns") +
      kpi("Pain index", fmtNum(D.painIndex, 2), "mean absolute drawdown") +
      kpi("Pain ratio", fmtNum(D.painRatio, 2), "annualised return over the pain index") +
      kpi("Calmar / MAR", fmtNum(D.calmar, 2), "annualised return over max drawdown") +
      '</div>';

    h += '<div class="rk-sub">The drawdown, in detail</div>';
    h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Measure</th><th class="r">Value</th><th>What it means</th></tr></thead><tbody>';
    h += row2("Peak", fmtDate(D.peakAt) + " (bar " + D.peakIndex + ")", "the high water mark the fall was measured from");
    h += row2("Trough", fmtDate(D.troughAt) + " (bar " + D.troughIndex + ")", "the low");
    h += row2("Depth", fmtPct(-D.maxDD, 2), "from the engine's own maxDrawdown, not a second copy of the formula");
    h += row2("Time to recovery", D.recoveryBars == null ? "never, in this window" : fmtNum(D.recoveryDays, 2) + " days (" + D.recoveryBars + " bars)", D.stillUnderwater ? "the curve has not come back to the peak inside the window — it is still underwater" : "bars from the trough to the first close back at the peak");
    h += row2("Longest underwater stretch", fmtNum(D.longestUnderwaterDays, 2) + " days (" + D.longestUnderwaterBars + " bars)", "the longest run of bars below a previous peak — usually a worse experience than the depth");
    h += row2("Underwater from / to", fmtDate(D.longestFrom) + " to " + fmtDate(D.longestTo), "when that stretch ran");
    h += row2("Ulcer index", fmtNum(D.ulcer, 3), "Martin and McCann (1989): the root mean square of the percentage drawdowns, so a long shallow drawdown scores worse than a short deep one");
    h += row2("Pain index", fmtNum(D.painIndex, 3), "the mean absolute drawdown — the same idea without the squaring");
    h += row2("Pain ratio", fmtNum(D.painRatio, 3), "annualised return divided by the pain index");
    h += row2("Calmar", fmtNum(D.calmar, 3), "published as annualised return over max drawdown across the trailing 36 MONTHS");
    h += row2("MAR", fmtNum(D.mar, 3), "the same ratio over the whole record since inception");
    h += row2("Sharpe / Sortino", fmtNum(D.sharpe, 2) + " / " + fmtNum(D.sortino, 2), "from the engine, annualised at " + D.periodsPerYear + " periods a year");
    h += row2("Total return, window", fmtPct(D.totalReturn, 2), "the reconstructed curve start to end");
    h += '</tbody></table></div>';
    h += '<div class="rk-warn">' + esc(D.calmarNote) + ' ' + esc(D.annualisedNote) + '</div>';

    /* the underwater curve, drawn as bars so it needs no canvas and no library */
    h += '<div class="rk-sub">Underwater curve</div><div class="rk-uw" role="img" aria-label="underwater curve, ' + D.n + ' bars, deepest ' + fmtPct(-D.maxDD, 1) + '">';
    var i, step = Math.max(1, Math.ceil(D.underwater.length / 160));
    for (i = 0; i < D.underwater.length; i += step) {
      var d = D.underwater[i];
      var pctH = D.maxDD > 0 ? Math.min(100, Math.abs(d) / D.maxDD * 100) : 0;
      /* bucketed to twenty steps so the height lives in the stylesheet: this
         layer defines no inline geometry and no colour of its own. */
      h += '<i data-h="' + (Math.round(pctH / 5) * 5) + '" title="' + fmtPct(d, 2) + '"></i>';
    }
    h += '</div><div class="rk-note">Every bar is value over running peak, scaled so the deepest bar is full height (' + fmtPct(-D.maxDD, 2) + '). Flat bottom means a new high.</div>';

    /* return to recover */
    h += '<div class="rk-sub">Return needed to recover</div>';
    h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th class="r">Drawdown</th><th class="r">Return needed</th><th>Why</th></tr></thead><tbody>';
    var tbl = recoveryTable(), t;
    for (t = 0; t < tbl.length; t++) {
      h += '<tr><td class="r">' + fmtPct(-tbl[t].dd, 0) + '</td><td class="r rk-usd">' + fmtSigned(tbl[t].need, 2) + '</td><td class="rk-w">1/(1 - ' + tbl[t].dd.toFixed(2) + ') - 1</td></tr>';
    }
    h += '<tr data-yours="1"><td class="r">' + fmtPct(-D.maxDD, 2) + ' (yours)</td><td class="r rk-usd">' + fmtSigned(D.needToRecover, 2) + '</td><td class="rk-w">the same arithmetic on your own max drawdown</td></tr>';
    h += '</tbody></table></div>';
    h += '<div class="rk-note">Every figure in this table is computed from 1/(1-d) - 1, not typed in. The asymmetry is the whole argument for caring about drawdown: a 50% fall needs a 100% gain, and a 90% fall needs 900%.</div>';
    return h;
  }

  function row2(a, b, c3) { return '<tr><td class="rk-n">' + esc(a) + '</td><td class="r">' + esc(b) + '</td><td class="rk-w">' + esc(c3) + '</td></tr>'; }

  /* ------------------------------------------------------------ Method tab */

  function paneMethod() {
    var h = banner();
    h += '<div class="rk-note">Everything this desk does, in plain language. If a number on any other tab cannot be traced to one of these paragraphs, it should not be on the screen.</div>';
    var i;
    h += '<div class="rk-method">';
    for (i = 0; i < METHOD.length; i++) h += '<div class="rk-mrow"><b>' + esc(METHOD[i][0]) + '</b><span>' + esc(METHOD[i][1]) + '</span></div>';
    h += '</div>';
    h += '<div class="rk-sub">What is assumed, and what is measured</div><ul class="rk-assume">';
    for (i = 0; i < ASSUMPTIONS.length; i++) h += '<li>' + esc(ASSUMPTIONS[i]) + '</li>';
    h += '</ul>';
    h += '<div class="rk-sub">The stress library, with its sources</div>';
    h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Scenario</th><th>Window</th><th>Source</th><th class="r">BTC</th><th class="r">ETH</th><th class="r">catch-all</th></tr></thead><tbody>';
    for (i = 0; i < SCENARIOS.length; i++) {
      var s = SCENARIOS[i];
      h += '<tr><td class="rk-n">' + esc(s.name) + '<br><span class="rk-w">' + esc(s.when) + '</span></td><td class="rk-w">' + esc(s.window) + '</td><td class="rk-w">' + esc(s.src) + '</td><td class="r rk-dn">' + fmtSigned(s.moves.BTC, 1) + '</td><td class="r rk-dn">' + (s.moves.ETH == null ? "—" : fmtSigned(s.moves.ETH, 1)) + '</td><td class="r rk-dn">' + fmtSigned(s.other, 1) + '</td></tr>';
    }
    h += '</tbody></table></div>';
    h += '<div class="rk-note">These are measured historical moves over the named windows, rounded to a tenth of a percent. They are a scenario LIBRARY, not a data feed: nothing refreshes them, and the next crash will not be one of them. The catch-all is what an asset the scenario does not name gets when no beta can be estimated for it.</div>';
    h += '<div class="rk-sub">What this desk deliberately does not do</div><ul class="rk-assume">';
    var NOT = [
      "It does not trade, hedge, rebalance or size a position. It measures; the decision is yours.",
      "It does not model liquidity: every stress figure assumes you can exit at the shocked price. In every one of the five scenarios in the library, you could not.",
      "It does not model the PATH of a move, only its end state, so a position that would have been liquidated on the way to a level it survives is shown as surviving.",
      "It does not model correlation breaking. The matrix is estimated on a quiet week and applied to a crash week, which is exactly when correlations go to one — that is the single largest error on this desk and it is in the optimistic direction.",
      "It has no counterparty, bridge, oracle, smart-contract or venue-failure risk in it at all. Three of the five scenarios in its own library were caused by one of those."
    ];
    for (i = 0; i < NOT.length; i++) h += '<li>' + esc(NOT[i]) + '</li>';
    h += '</ul>';
    return h;
  }

  /* ==========================================================================
     14 · WIRING
     ========================================================================== */

  function bodyFor(tab, body) {
    /* onTab's return value is IGNORED by DLCORE.open — the pane must be
       ASSIGNED here. A bodyFor that returns a string and never touches
       body.innerHTML renders an empty desk; that bug shipped once already. */
    var h;
    try {
      if (tab === "var") h = paneVaR();
      else if (tab === "stress") h = paneStress();
      else if (tab === "dd") h = paneDrawdown();
      else if (tab === "method") h = paneMethod();
      else h = paneExposure();
    } catch (err) {
      h = '<div class="rk-refuse"><b>the desk could not build this pane</b> — ' + esc((err && err.message) || err) + '. Nothing was written anywhere; this desk only reads.</div>';
    }
    if (body) body.innerHTML = h;
    return h;
  }

  function readForm() {
    var p = {}, el;
    el = document.getElementById("rkConf"); if (el) p.conf = +el.value || 0.99;
    el = document.getElementById("rkHz"); if (el) p.horizon = +el.value || 1;
    el = document.getElementById("rkMethod"); if (el) p.method = el.value;
    el = document.getElementById("rkLam"); if (el) p.lambda = +el.value || LAMBDA;
    el = document.getElementById("rkKind"); if (el) p.kind = el.value;
    el = document.getElementById("rkFactor"); if (el) p.factor = +el.value || -0.2;
    el = document.getElementById("rkRho"); if (el) p.rho = el.value === "" ? null : (+el.value || null);
    return p;
  }

  function onClick(ev) {
    var tgt = ev.target, sb;
    try { sb = tgt && tgt.closest ? tgt.closest("[data-scen]") : null; } catch (e) { sb = null; }
    if (sb) { cfg({ scenario: sb.getAttribute("data-scen") }); open("stress"); return; }
    if (!tgt || !tgt.id) return;
    if (tgt.id === "rkApply") { cfg(readForm()); open("var"); return; }
    if (tgt.id === "rkCustom") { var p = readForm(); p.scenario = "custom"; cfg(p); open("stress"); return; }
  }

  var wired = false;
  function wire(el) {
    if (!el || wired) return;
    el.addEventListener("click", onClick);
    wired = true;
    el.__onClose = function () { try { el.removeEventListener("click", onClick); } catch (e) {} wired = false; LAST = null; };
  }

  /* The sheet id, and why it is not "dlRisk".
     DLCORE.sheet() starts with "var el = $(id)" and REUSES whatever element
     already carries that id. The trading ticket has owned <div id="dlRisk">
     since long before this layer — it is the "Risk sizing" box that
     mountRisk() drops next to the place button, and layers/v154.css has styled
     it under #dlRisk for just as long. Opening a sheet on that id handed
     sheet() a div that is not one of its own, so the next line,
     el.querySelector(".dls-t").innerHTML, read a property of null and the whole
     open() threw. The desk never mounted and the catch below ate the reason.
     The id is namespaced now, and the gate asserts no other element in the
     payload claims it. */
  var SHEET_ID = "dlRiskDesk";
  var MOUNT_ERR = null;

  function open(tab) {
    var el = null;
    MOUNT_ERR = null;

    /* check the id BEFORE asking for the sheet, so the reason is named rather
       than inferred from a null-property TypeError three frames down */
    try {
      var clash = document.getElementById(SHEET_ID);
      if (clash && String(clash.className || "").indexOf("dls") < 0) {
        MOUNT_ERR = "the sheet id " + SHEET_ID + " is already taken by another element in the payload, so DLCORE.sheet would reuse it and fail";
      }
    } catch (e) {}

    try {
      el = C.open(SHEET_ID, {
        title: "⚖ Risk",
        sub: "One covariance matrix over everything you hold — what the book can lose, and which position would do it",
        tabs: [["exp", "Exposure"], ["var", "VaR"], ["stress", "Stress"], ["dd", "Drawdown"], ["method", "Method"]],
        onTab: bodyFor
      }, tab || "exp");
    } catch (e) {
      el = null;
      MOUNT_ERR = "DLCORE.open refused the sheet: " + ((e && e.message) || e);
    }

    /* a desk that fails to mount must SAY SO. Swallowing this is what made the
       first failure invisible: open() returned, nothing threw, and nothing was
       on the screen. */
    if (!el) {
      if (!MOUNT_ERR) MOUNT_ERR = "DLCORE.open returned nothing for the sheet id " + SHEET_ID;
      try { if (window.console && window.console.error) window.console.error("DLRISK: the Risk desk did not mount — " + MOUNT_ERR); } catch (e2) {}
      try { C.toast && C.toast("bad", "Risk desk did not open", MOUNT_ERR); } catch (e3) {}
      return null;
    }
    try { wire(el); } catch (e4) {}
    return el;
  }

  function mountError() { return MOUNT_ERR; }

  try { if (window.DLDESKS && window.DLDESKS.register) window.DLDESKS.register("risk", "⚖", "Risk", "Correlation, VaR, margin aggregation, stress and drawdown across the whole book", function () { open("exp"); }); } catch (e) {}
  try { C.cmd && C.cmd("risk", "Risk — correlation, VaR, stress and drawdown across the book", "⚖", function () { open("exp"); }); } catch (e) {}

  window.DLRISK = {
    __v: 166,
    open: open,
    sheetId: SHEET_ID,
    mountError: mountError,
    /* matrix */
    covariance: covariance, sampleCov: sampleCov, ewmaCov: ewmaCov, shrinkLW: shrinkLW,
    corrFrom: corrFrom, ewmaEffN: ewmaEffN, betaToBTC: betaToBTC, retMatrix: retMatrix,
    /* tail */
    varSuite: varSuite, cornishFisher: cornishFisher, cfMonotone: cfMonotone,
    invNorm: invNorm, normPdf: normPdf, chi2sf: chi2sf,
    kupiecPOF: kupiecPOF, christoffersenInd: christoffersenInd, backtestVaR: backtestVaR,
    skewOf: skewOf, exKurtOf: exKurtOf,
    /* book */
    exposure: exposure, spotLegs: spotLegs, perpLegs: perpLegs, lpLegs: lpLegs, optLegs: optLegs,
    marginState: marginState, bookLiquidation: bookLiquidation,
    /* stress */
    stress: stress, shockVector: shockVector, SCENARIOS: SCENARIOS,
    /* drawdown */
    equityCurve: equityCurve, drawdown: drawdown, returnToRecover: returnToRecover, recoveryTable: recoveryTable,
    /* shape */
    concentration: concentration, riskContrib: riskContrib,
    histOf: histOf, barsPerDay: barsPerDay, cfg: cfg,
    LAMBDA: LAMBDA, MIN_OBS: MIN_OBS,
    METHOD: METHOD, ASSUMPTIONS: ASSUMPTIONS
  };
})();
