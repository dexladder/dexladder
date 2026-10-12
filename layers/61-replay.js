// owns: historical strategy and scenario replay
// reads: DLAPP, DLCORE, DLDESKS, DLLEND, browser DOM
// emits: DLREPLAY
/* ============================================================================
   DexLadder — DLREPLAY · layer 61 · v166 "⟲ Replay"
   MULTI-REGIME HISTORICAL REPLAY · SCENARIO BUILDER · FUNDING & LIQUIDATION TAPE

   The question this desk exists to answer: this strategy worked in the stretch
   you just looked at — but that stretch was ONE draw. What did it do in every
   OTHER stretch of history that measured the same way, and what would break it?

   Three moves, in order:
     1. A regime is a MEASUREMENT, not a date you typed. Over whatever history
        the venue will give us, a window is rolled across the series and each
        position is labelled by four measured features: Kaufman's efficiency
        ratio (trend), realised volatility (close-to-close and Garman-Klass),
        the drawdown state at the window's right edge, and the sign of the
        funding the app's own funding model implies. Every threshold is printed
        next to the label. March 2020, LUNA and FTX are BOOKMARKS — typed date
        ranges — and the desk labels them as bookmarks and then prints what the
        measurement says about them anyway.
     2. Pick a regime and the desk replays the strategy across EVERY window that
        matches it, and reports a distribution — median, quartiles, worst, the
        count, the spread — never one hero number. One window is an anecdote.
     3. A scenario is composable shocks, each with a parameter and a stated
        mechanism, applied in a stated order, with the MARGINAL effect of each
        one printed rather than only the total.

   LAWS OBSERVED
     · the no-lookahead law is not re-implemented here. Every fill in this desk
       goes through DLAPP.backtest — the SAME engine the Rewind desk (42-rewind)
       runs — whose rule is: a decision made while looking at bar t fills at the
       OPEN of bar t+1, a stop fills only when the bar's range trades through it,
       and a gap is paid at the open. After every run this layer AUDITS the
       engine's own fills (lawAudit) and refuses to print a result whose fills
       do not satisfy the law. If DLAPP.backtest is missing, the desk prints a
       named empty state — it does not fall back to arithmetic of its own.
     · deterministic — not one random number is drawn anywhere in this layer.
       Every choice a scenario needs to
       make (where an unanchored gap lands, how ties break) is derived from an
       FNV-1a hash of the window key and the scenario parameters. The seed IS
       the scenario: the same scenario always replays byte-identically.
     · this desk never trades. It touches no balance, calls no execFill, and
       every number on it is hypothetical by construction.
     · a missing figure stays missing — null, never 0 wearing a price's clothes.
     · no storage key of its own — state is the v154 bucket via DLCORE.X().
     · nothing is compiled at runtime, no timers, no sockets, no observers.
     · Day + Night — every rule lives in _v166css/61-replay.css. No tokens here.
   ============================================================================ */
(function () {
  "use strict";
  if (window.DLREPLAY && window.DLREPLAY.__v) return;

  var C = window.DLCORE;
  if (!C) return;

  /* --------------------------------------------------------------- engines */
  /* Nothing below re-implements a figure one of these owns. */
  function BT() { try { return window.DLAPP && window.DLAPP.backtest; } catch (e) { return null; } }
  function MA() { try { return window.DLAPP && window.DLAPP.math; } catch (e) { return null; } }
  function IN() { try { return (window.DLAPP && window.DLAPP.indicators) || (window.DLAPP && window.DLAPP.paper); } catch (e) { return null; } }
  function PE() { try { return window.DLAPP && window.DLAPP.paper; } catch (e) { return null; } }
  function PP() { try { return window.DLAPP && window.DLAPP.perps; } catch (e) { return null; } }

  /* ------------------------------------------------------------- constants */

  var DAY = 86400000, HOUR = 3600000;
  var IV_MS = { "1h": 3600000, "4h": 14400000, "1d": 86400000 };
  var MAX_PAGES = { "1h": 3, "4h": 3, "1d": 4 };   /* 1000 bars a page */
  var MAX_BARS = 4200;

  /* Rolling measurement window and how far it steps. Windows that overlap are
     NOT independent draws, so the desk also counts the non-overlapping subset
     and reports the distribution on that. */
  var WIN = 60, STRIDE = 15, WARM = 60;

  /* Trend thresholds on Kaufman's efficiency ratio. A CONVENTION, printed
     wherever it is used, and shown next to this asset's own measured ER
     terciles so you can see whether the cut is doing any work. */
  var ER_TREND = 0.35, ER_CHOP = 0.15;

  /* Drawdown state cuts. Also conventions: 20% is the number the trade press
     calls a bear market, 5% is "near the highs". Neither is a measurement. */
  var DD_NEAR = 0.05, DD_BEAR = 0.20;

  /* Volatility is NOT cut at a fixed number: the desk takes the terciles of
     the realised-vol values it just measured on this asset and prints them. */

  var CASH = 10000;          /* the hypothetical stack every replay starts with */
  var LAW_TOL = 1e-6;

  /* The shock stack, in the order it is applied. Stated once, here, and the
     desk prints it on the Scenario tab. */
  var SHOCK_ORDER = ["vol", "gap", "depeg", "funding", "depth", "cascade"];

  /* Long open interest split by leverage bucket, for the liquidation ladder.
     THIS IS AN ASSUMPTION — no venue publishes the leverage distribution of
     its book — and the desk says so where the ladder is drawn. */
  var LEV_BUCKETS = [[2, 0.20], [3, 0.20], [5, 0.25], [10, 0.20], [20, 0.10], [25, 0.05]];

  /* BOOKMARKS — typed date ranges, not regimes. The dates are the ones the
     Rewind desk already ships (layers/42-rewind.js → ERAS), kept identical so
     the two desks cannot drift. A bookmark is a place to look; the label the
     desk prints beside it is what the MEASUREMENT says about it. */
  var BOOKMARKS = [
    { id: "covid", label: window.DLI18N.t("61-replay.9f08de1131a2"), from: Date.UTC(2020, 1, 5), to: Date.UTC(2020, 3, 20) },
    { id: "may21", label: window.DLI18N.t("61-replay.dd342bb250d3"), from: Date.UTC(2021, 4, 10), to: Date.UTC(2021, 5, 30) },
    { id: "top21", label: window.DLI18N.t("61-replay.b73c9546e692"), from: Date.UTC(2021, 9, 1), to: Date.UTC(2021, 11, 20) },
    { id: "luna", label: window.DLI18N.t("61-replay.5ede38f668ae"), from: Date.UTC(2022, 4, 1), to: Date.UTC(2022, 4, 31) },
    { id: "ftx", label: window.DLI18N.t("61-replay.7e7d3cc72491"), from: Date.UTC(2022, 10, 1), to: Date.UTC(2022, 10, 30) }
  ];

  var ASSUMPTIONS = [
    "The history is PUBLIC CANDLES, fetched through the app's own data path (DLCORE.jget, cached) from Binance's market-data host first, then Coinbase, then Kraken — the same ladder the Rewind desk uses. The desk prints which venue answered and the timestamp of the FIRST bar it actually got: that date, not the range you asked for, is how far back this build goes.",
    "Granularity is a bar, not a tape. At 1d each bar is one UTC day; at 4h and 1h the fetch is capped at 3 pages of 1000 bars, so an hourly request covers months, not years. Nothing inside a bar is known: the engine's fill rules are deliberately pessimistic about the order in which a bar's high and low were printed.",
    "SURVIVORSHIP. Only a pair still listed on the venue has history to fetch. The assets whose regimes you most want — LUNA, FTT, the 2018 alt cohort — are delisted, so their worst windows are simply absent from every distribution on this desk. A regime distribution measured on BTC and ETH is a distribution over the survivors, and it is biased upward by exactly the amount you cannot see.",
    "LISTING EFFECT. A pair listed in 2021 has no 2020 regime and no bear-market windows at all; its 'all of history' is a bull sample. The desk prints the first bar's date next to every distribution so a short history cannot pass itself off as a long one.",
    "OVERLAPPING WINDOWS ARE NOT INDEPENDENT DRAWS. The roll steps " + STRIDE + " bars through a " + WIN + "-bar window, so neighbouring windows share most of their bars. The desk reports the distribution over the NON-OVERLAPPING subset (every " + Math.ceil(WIN / STRIDE) + "th window) and prints the overlapping count beside it. Quartiles taken over overlapping windows would look four times more confident than the data allows.",
    "The volatility terciles are measured on THIS asset over THIS fetched history — 'high vol' means high for this coin in this sample, not high in absolute terms. The two cut points are printed with the label. The trend cuts (ER " + ER_CHOP + " / " + ER_TREND + ") and the drawdown cuts (" + (DD_NEAR * 100) + "% / " + (DD_BEAR * 100) + "%) are CONVENTIONS chosen by this desk, printed everywhere they are used, and shown next to the asset's own measured terciles.",
    "There is NO historical funding feed in this build. The funding column of a regime, and every row of the funding tape, is the app's OWN funding model (DLAPP.perps.estimateRate8h: 0.01% per 8h baseline, tilted by the measured 24h move, capped at ±0.75%) evaluated on the bars of the window. The settlement CLOCK is real — 00:00 / 08:00 / 16:00 UTC, or hourly on a venue that settles hourly — but the rate on each of those rows is modelled, not what anyone actually paid.",
    "Depth is TODAY's depth. The pool a scenario's fills walk is the app's modelled AMM for this symbol, anchored on its CURRENT 24h volume (depth anchor 4bp of 24h volume, pool TVL 2% of 24h volume times a liquidity-tier step). Applying it to a window from 2020 is an anachronism the desk cannot fix: there is no historical depth series here. A depth-collapse shock scales that anchor and says by how much.",
    "A SYNTHESISED SHOCK IS A HYPOTHESIS, NOT A FORECAST. Nothing on the Scenario tab is a probability, an expectation or a prediction. It is: if the returns of this exact window had been stretched by this multiplier, or if this gap had opened here, the arithmetic below is what the run would have paid. The desk does not claim any of it is likely.",
    "The liquidation cascade's leverage ladder — 20% of long open interest at 2x, 20% at 3x, 25% at 5x, 20% at 10x, 10% at 20x, 5% at 25x — is an ASSUMPTION. No venue publishes the leverage distribution of its book. The maintenance-margin steps and the liquidation-price formula underneath it are the engine's own (DLAPP.perps), not a second copy kept here.",
    "The close-out fill is the one fill on this desk that lands on the bar you were looking at: a finished run is measured FLAT, so the engine sells the remaining position at the last bar's close. It is the engine's convention, it is exempted from the law audit by name, and it is counted and printed rather than hidden.",
    "The cascade stops when the forced sales exceed the whole modelled pool. Past that point the constant-product curve keeps printing ever smaller prices and none of them mean anything, so the desk stops the ladder, names the notional still waiting to be liquidated and calls it NO BID rather than showing a number. That stop is a modelling decision, not a market mechanism.",
    "A depeg is applied to the QUOTE asset, so a percentage return measured in that asset is unchanged by construction and the nominal marginal is zero. The desk prints a separate real-in-dollars column rather than pretending the depeg cost the strategy nothing.",
    "This desk never trades. It holds no position, touches no balance and sends nothing to the paper engine. Every figure is hypothetical."
  ];

  var METHOD = [
    ["Where the history comes from", "The app's own fetch path, paged: Binance market data first (the only free source with a start/end window and deep history), then Coinbase, then Kraken. Candles are parsed and sanitised by the typed core (DLAPP.backtest.binanceCandles / coinbaseCandles / krakenCandles / sanitize) — malformed bars, repeats and anything outside the window are dropped before a single measurement is taken. The venue that answered and the first bar's date are printed on the Regimes tab."],
    ["Trend, measured", "Kaufman's efficiency ratio over the window: ER = |c_last − c_first| ÷ Σ|c_i − c_i−1|. It is the net distance travelled divided by the total path walked, so it sits in [0,1]: 1 is a straight line, 0 is a market that ends where it started having been everywhere in between. It is scale-free and needs no fitted parameter, which is why it is the trend measure here rather than an R². The R² of ln(price) on bar index is computed and printed beside it — it answers a different question (how well a straight line in log space fits) and the two disagree in exactly the interesting cases: a smooth curve scores a high R² and a middling ER."],
    ["Volatility, measured", "Two estimators, both annualised by √(bars per year) from the typed core's own bar clock (365.25 days). Close-to-close: the sample standard deviation (n−1) of log returns — it is the one that feels the jump between bars. Garman-Klass (1980), which uses the whole bar: σ² = 0.5·ln(h/l)² − (2·ln2 − 1)·ln(c/o)², averaged over the window. GK is roughly seven times more efficient than close-to-close per bar, but it assumes no drift and NO GAP between bars, so it under-reads a market that jumps overnight. Both are printed; the tercile label is taken from GK, and the close-to-close figure next to it is how you see the gap risk GK ignores. Parkinson (1980), ln(h/l)² ÷ (4·ln2), is printed too as the high-low-only reference."],
    ["Drawdown state", "At the window's right edge: (running peak of every close up to here − this close) ÷ running peak. The peak is taken over ALL the history fetched, not just the window, because where you are in the cycle is not a property of the last sixty bars. Under 5% is 'near highs', 5–20% is 'correction', over 20% is 'bear' — conventions, printed as conventions."],
    ["Funding sign", "There is no historical funding feed here, so the desk evaluates the app's own model — DLAPP.perps.estimateRate8h(24h move) — on the measured move at the window's right edge and takes its sign. It is labelled 'modelled' in the table and in the tape, every time."],
    ["What a regime IS", "The triple (trend state, volatility tercile, drawdown state), with the funding sign as an annotation. Windows carrying the same triple are the same regime. The two volatility cut points are this asset's own measured terciles and are printed with the label; the trend and drawdown cuts are the conventions above. A regime on this desk is therefore always the label of a measurement plus the thresholds that produced it — never a date somebody typed."],
    ["Bookmarks are not regimes", "March 2020, May 2021, LUNA and FTX are typed date ranges carried over from the Rewind desk. They are listed as BOOKMARKS, in their own table, and the desk prints the measured label of the windows that fall inside each one. A bookmark tells you where to look. A measurement tells you what it was."],
    ["The replay itself", "Every fill goes through DLAPP.backtest — the engine the Rewind desk runs — which fills a market order at the OPEN of the bar after the decision, fills a limit or stop only on a bar whose range trades through it, and pays a gap at the open (better than your limit, worse than your stop). This layer does not own a fill rule and does not have one to get wrong. After each run it audits the engine's fills: every fill's bar index must be strictly greater than the bar the order was placed on, every fill price must lie inside that bar's own high-low range, and a market fill's price must equal that bar's open exactly. A run that fails the audit is refused, not printed. The one exemption, counted and named, is the close-out that measures the run flat at the last bar's close."],
    ["Many windows, one distribution", "A strategy is run on every window carrying the chosen label. Against each run stands a buy-and-hold run through the SAME engine over the SAME bars paying the SAME fee, so the benchmark is not a free one. Their difference is the window's edge. The desk then prints the median, the first and third quartiles (linear interpolation between order statistics — the PERCENTILE.INC / type-7 definition), the worst window, the best, the interquartile range as the spread, and how many windows there were — on the non-overlapping subset. The headline is never one number, and when there are fewer than five independent windows the desk says in words that this is an anecdote."],
    ["Shocks compose, and each one is priced alone", "The stack is applied in a fixed order: volatility, then the gap, then the depeg, then funding, then depth, then the cascade — shape first, then level, then carry, then execution, then the reflexive one, which depends on everything above it. The run is re-run after each shock is added, so the marginal effect of shock k is (result with 1..k) − (result with 1..k−1), and those marginals sum to the total EXACTLY, by construction. Each shock is also priced ALONE, and the difference between the sum of the alone effects and the true total is printed as the interaction residual — that residual is the part of the answer you would have missed by testing one shock at a time."],
    ["The mechanisms", "Volatility: log returns are stretched about their own mean, r' = r̄ + m·(r − r̄), so the sum of the log returns — and therefore the window's endpoint — is preserved EXACTLY while the path around it is scaled; each bar's open, high and low are stretched about its close by the same multiplier in log space, so the high-low estimators scale with it. Gap: every bar from the chosen one onward is multiplied by (1+g), so the jump happens between one bar's close and the next bar's open and any stop resting inside it is filled at the open by the engine's own gap rule. Depeg: the QUOTE asset moves, so the price quoted in it becomes p ÷ (1+d) — the dollar value of the coin is unchanged, and the desk prints both the nominal result in the quote asset and the real one in dollars. Funding: the bars do not move at all; a hypothetical carried perp of the run's own average notional pays qty × mark × rate × hours/8 at every real UTC settlement in the window. Depth: the app's depth anchor is scaled and every fill of the run is re-priced through the SAME pool arithmetic the trading ticket uses, so the extra cost is an impact cost, not a fudge factor. Cascade: a trigger drop liquidates every leverage rung whose liquidation price it crosses, those forced sells are walked through the same pool, the resulting price crosses the next rungs, and the loop runs until it stops finding new ones — handed off to DLLEND when that desk is in the build, and computed here with the engine's own maintenance ladder when it is not."],
    ["The funding tape", "Real settlement instants from DLAPP.perps.settlementsBetween on the UTC clock (00:00 / 08:00 / 16:00; hourly where the venue settles hourly), the mark taken from the close of the bar containing each instant, and the rate from the app's funding model evaluated on the trailing 24h move at that instant. Each row shows its own arithmetic — qty × mark × (rate8h × hours ÷ 8) — and the running total is the cumulative drag on a position carried through the whole window."],
    ["The seed is the scenario", "Nothing here draws a random number. Where a scenario needs a choice the trader did not make — which bar an unanchored gap lands on, how a tie breaks — it is taken from an FNV-1a 32-bit hash of the symbol, the interval, the window's first and last timestamps and every shock parameter, printed as an 8-digit seed on the Scenario tab. Change a parameter and the seed changes; change nothing and the replay is identical, run for run, machine for machine."]
  ];

  /* ---------------------------------------------------------------- hashing */
  /* FNV-1a, 32-bit (Fowler / Noll / Vo, 1991): h = 2166136261; for each byte
     h ^= byte; h = h × 16777619 mod 2^32. Math.imul keeps the multiply exact. */
  function hash32(s) {
    var h = 2166136261, i;
    s = String(s);
    for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function hex8(n) { var s = (n >>> 0).toString(16); while (s.length < 8) s = "0" + s; return s; }

  /* The scenario IS the seed: symbol, interval, both window edges, and every
     shock parameter in the fixed order. */
  function seedOf(key, shocks) {
    var s = String(key), i, k, sh;
    for (i = 0; i < SHOCK_ORDER.length; i++) {
      k = SHOCK_ORDER[i];
      sh = shocks && shocks[k];
      s += "|" + k + ":" + (sh && sh.on ? "1" : "0") + ":" + (sh ? paramOf(k, sh) : "-");
    }
    return hash32(s);
  }
  function paramOf(k, sh) {
    if (k === "vol") return String(+sh.mult);
    if (k === "gap") return String(+sh.pct) + "@" + String(sh.at == null ? "seed" : +sh.at);
    if (k === "depeg") return String(+sh.pct);
    if (k === "funding") return String(+sh.rate8h) + "/" + String(sh.side === "short" ? -1 : 1);
    if (k === "depth") return String(+sh.mult);
    if (k === "cascade") return String(+sh.dropPct) + "/" + String(+sh.oiUSD);
    return "-";
  }

  /* ----------------------------------------------------------- measurement */

  /* Kaufman's efficiency ratio (Perry Kaufman, "Smarter Trading", 1995):
     net move ÷ total path. 1 = a straight line, 0 = ends where it started. */
  function efficiencyRatio(closes) {
    if (!closes || closes.length < 2) return null;
    var path = 0, i;
    for (i = 1; i < closes.length; i++) path += Math.abs(closes[i] - closes[i - 1]);
    if (!(path > 0)) return 0;
    return Math.abs(closes[closes.length - 1] - closes[0]) / path;
  }

  /* R² of ln(price) regressed on bar index, and the sign of the slope. */
  function rSquared(closes) {
    if (!closes || closes.length < 3) return null;
    var n = closes.length, y = [], i, mx = 0, my = 0, sxy = 0, sxx = 0, syy = 0, dx, dy;
    for (i = 0; i < n; i++) { if (!(closes[i] > 0)) return null; y.push(Math.log(closes[i])); }
    for (i = 0; i < n; i++) { mx += i; my += y[i]; }
    mx /= n; my /= n;
    for (i = 0; i < n; i++) { dx = i - mx; dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    if (!(sxx > 0) || !(syy > 0)) return null;
    return { r2: (sxy * sxy) / (sxx * syy), slope: sxy / sxx };
  }

  /* Close-to-close realised vol: sample stdev (n−1, the engine's own) of log
     returns, annualised by √(bars per year). */
  function realisedVolCC(closes, bpy) {
    var M = MA();
    if (!M || !closes || closes.length < 3 || !(bpy > 0)) return null;
    var r = M.logReturns(closes);
    if (r.length < 2) return null;
    return M.stdev(r) * Math.sqrt(bpy);
  }

  /* Garman-Klass (1980) per-bar variance, averaged then annualised.
     σ² = 0.5·ln(h/l)² − (2·ln2 − 1)·ln(c/o)². Assumes no drift and no gap
     between bars, so it under-reads a market that jumps overnight. */
  var GK_K = 2 * Math.log(2) - 1;
  function realisedVolGK(bars, bpy) {
    if (!bars || bars.length < 2 || !(bpy > 0)) return null;
    var s = 0, n = 0, i, b, u, d;
    for (i = 0; i < bars.length; i++) {
      b = bars[i];
      if (!(b.h > 0) || !(b.l > 0) || !(b.o > 0) || !(b.c > 0)) continue;
      u = Math.log(b.h / b.l); d = Math.log(b.c / b.o);
      s += 0.5 * u * u - GK_K * d * d; n++;
    }
    if (!n) return null;
    var v = s / n;
    return Math.sqrt(Math.max(0, v) * bpy);
  }

  /* Parkinson (1980): high-low only. σ² = ln(h/l)² ÷ (4·ln2). */
  var PK_K = 4 * Math.log(2);
  function realisedVolPK(bars, bpy) {
    if (!bars || bars.length < 2 || !(bpy > 0)) return null;
    var s = 0, n = 0, i, b, u;
    for (i = 0; i < bars.length; i++) {
      b = bars[i];
      if (!(b.h > 0) || !(b.l > 0)) continue;
      u = Math.log(b.h / b.l); s += (u * u) / PK_K; n++;
    }
    if (!n) return null;
    return Math.sqrt((s / n) * bpy);
  }

  /* Drawdown at bar 'at', measured against the running peak of every close up
     to and including it — the cycle position, not the window's own dip. */
  function drawdownAt(bars, at) {
    if (!bars || !bars.length) return null;
    var peak = 0, i, end = Math.min(at, bars.length - 1);
    for (i = 0; i <= end; i++) if (bars[i].c > peak) peak = bars[i].c;
    if (!(peak > 0)) return null;
    return (peak - bars[end].c) / peak;
  }

  /* The measured 24h move at bar 'at', in percent — the input the app's own
     funding model takes. */
  function move24At(bars, at, ivMs) {
    if (!bars || at < 1) return null;
    var back = Math.max(1, Math.round(DAY / ivMs)), j = at - back;
    if (j < 0) j = 0;
    if (!(bars[j].c > 0)) return null;
    return (bars[at].c / bars[j].c - 1) * 100;
  }

  function fundingModelAt(bars, at, ivMs) {
    var P = PP(), m = move24At(bars, at, ivMs);
    if (!P || typeof P.estimateRate8h !== "function" || m == null) return null;
    return { rate8h: P.estimateRate8h(m), move24: m, src: "modelled" };
  }

  /* Every measured feature of the window [a..b] of the series. */
  function features(bars, a, b, interval) {
    var B = BT();
    if (!B || !bars || b <= a || b >= bars.length) return null;
    var seg = bars.slice(a, b + 1), closes = [], i;
    for (i = 0; i < seg.length; i++) closes.push(seg[i].c);
    var bpy = B.barsPerYear(interval), rs = rSquared(closes);
    var f = fundingModelAt(bars, b, IV_MS[interval] || DAY);
    return {
      a: a, b: b, t0: bars[a].t, t1: bars[b].t, n: seg.length,
      er: efficiencyRatio(closes),
      dir: closes[closes.length - 1] >= closes[0] ? 1 : -1,
      r2: rs ? rs.r2 : null, slope: rs ? rs.slope : null,
      rvCC: realisedVolCC(closes, bpy),
      rvGK: realisedVolGK(seg, bpy),
      rvPK: realisedVolPK(seg, bpy),
      dd: drawdownAt(bars, b),
      ret: closes[0] > 0 ? closes[closes.length - 1] / closes[0] - 1 : null,
      fundRate8h: f ? f.rate8h : null,
      fundSrc: f ? f.src : null
    };
  }

  /* Terciles of a measured series — the ONLY volatility thresholds this desk
     uses, and it prints them. */
  function terciles(vals) {
    var M = MA(), clean = [], i;
    if (!M) return null;
    for (i = 0; i < vals.length; i++) if (vals[i] != null && isFinite(vals[i])) clean.push(vals[i]);
    if (clean.length < 3) return null;
    return { lo: M.percentile(clean, 1 / 3), hi: M.percentile(clean, 2 / 3), n: clean.length };
  }

  function trendState(f) {
    if (f.er == null) return "unknown";
    if (f.er >= ER_TREND) return f.dir > 0 ? "up" : "down";
    if (f.er <= ER_CHOP) return "chop";
    return "drift";
  }
  function volState(f, t) {
    if (!t || f.rvGK == null) return "unknown";
    return f.rvGK <= t.lo ? "vol-lo" : f.rvGK >= t.hi ? "vol-hi" : "vol-mid";
  }
  function ddState(f) {
    if (f.dd == null) return "unknown";
    return f.dd < DD_NEAR ? "highs" : f.dd < DD_BEAR ? "correction" : "bear";
  }

  function labelOf(f, t) {
    var a = trendState(f), b = volState(f, t), c = ddState(f);
    return { id: a + "·" + b + "·" + c, trend: a, vol: b, dd: c, fund: f.fundRate8h == null ? "n/a" : (f.fundRate8h > 0 ? "longs pay" : f.fundRate8h < 0 ? "shorts pay" : "flat") };
  }

  /* Roll the window across the whole series and group by label. */
  function regimes(bars, interval, win, stride) {
    win = win > 4 ? win : WIN;
    stride = stride > 0 ? stride : STRIDE;
    if (!bars || bars.length < win + 2) return null;
    var wins = [], i;
    for (i = 0; i + win - 1 < bars.length; i += stride) {
      var f = features(bars, i, i + win - 1, interval);
      if (f) wins.push(f);
    }
    if (!wins.length) return null;
    var gk = [], j;
    for (j = 0; j < wins.length; j++) gk.push(wins[j].rvGK);
    var t = terciles(gk);
    var every = Math.ceil(win / stride), groups = {}, order = [];
    for (j = 0; j < wins.length; j++) {
      wins[j].label = labelOf(wins[j], t);
      wins[j].indep = (j % every) === 0;
      var id = wins[j].label.id;
      if (!groups[id]) { groups[id] = { id: id, label: wins[j].label, all: [], indep: [] }; order.push(id); }
      groups[id].all.push(wins[j]);
      if (wins[j].indep) groups[id].indep.push(wins[j]);
    }
    var list = [];
    for (j = 0; j < order.length; j++) list.push(groups[order[j]]);
    list.sort(function (x, y) { return y.all.length - x.all.length; });
    return {
      windows: wins, groups: list, vol: t, win: win, stride: stride, every: every,
      thresholds: {
        erChop: ER_CHOP, erTrend: ER_TREND, ddNear: DD_NEAR, ddBear: DD_BEAR,
        volLo: t ? t.lo : null, volHi: t ? t.hi : null,
        erTerciles: terciles((function () { var o = [], k; for (k = 0; k < wins.length; k++) o.push(wins[k].er); return o; })())
      }
    };
  }

  /* ------------------------------------------------------------- the history */

  var H = { key: "", bars: null, src: null, gaps: null, at: 0, err: null, loading: false, gen: 0 };

  function ivOf(x) { return IV_MS[x] ? x : "1d"; }

  function jget(url, key) {
    return C.jget(url, { key: key, ttl: 15 * 60000, ms: 9000 }).then(function (r) {
      return r && typeof r === "object" && "data" in r ? r.data : r;
    });
  }

  function binancePages(sym, iv, from, to) {
    var B = BT(), out = [], max = MAX_PAGES[iv] || 3;
    if (!B) return Promise.reject(new Error("the typed core's candle parser is not in this build"));
    function step(cur, page) {
      if (page >= max || cur >= to) return Promise.resolve(out);
      var url = "https://data-api.binance.vision/api/v3/klines?symbol=" + sym + "USDT&interval=" + iv +
        "&startTime=" + cur + "&endTime=" + to + "&limit=1000";
      return jget(url, "dl.rp.b." + sym + "." + iv + "." + cur).then(function (d) {
        var rows = B.binanceCandles(d), i;
        if (!rows.length) return out;
        for (i = 0; i < rows.length; i++) out.push(rows[i]);
        var last = rows[rows.length - 1].t;
        if (rows.length < 1000 || last <= cur) return out;
        return step(last + IV_MS[iv], page + 1);
      });
    }
    return step(from, 0);
  }

  function coinbasePages(sym, iv, from, to) {
    var B = BT(), out = [], sec = { "1h": 3600, "4h": 14400, "1d": 86400 }[iv], span = 300 * IV_MS[iv];
    if (!B) return Promise.resolve(out);
    function step(cur, page) {
      if (page >= 4 || cur >= to) return Promise.resolve(out);
      var end = Math.min(to, cur + span);
      var url = "https://api.exchange.coinbase.com/products/" + sym + "-USD/candles?granularity=" + sec +
        "&start=" + new Date(cur).toISOString() + "&end=" + new Date(end).toISOString();
      return jget(url, "dl.rp.c." + sym + "." + iv + "." + cur).then(function (d) {
        var rows = B.coinbaseCandles(d), i;
        for (i = 0; i < rows.length; i++) out.push(rows[i]);
        return step(cur + span, page + 1);
      }, function () { return out; });
    }
    return step(from, 0);
  }

  function krakenOne(sym, iv, from) {
    var B = BT(), kr = { BTC: "XBT", DOGE: "XDG" }[sym] || sym, min = { "1h": 60, "4h": 240, "1d": 1440 }[iv];
    if (!B) return Promise.resolve([]);
    var url = "https://api.kraken.com/0/public/OHLC?pair=" + kr + "USD&interval=" + min + "&since=" + Math.floor(from / 1000);
    return jget(url, "dl.rp.k." + sym + "." + iv + "." + Math.floor(from / DAY)).then(function (d) { return B.krakenCandles(d); }, function () { return []; });
  }

  /* Real bars for the window, or a named failure. Nothing is synthesised. */
  function history(sym, interval, years) {
    var B = BT();
    if (!B) return Promise.reject(new Error("The typed core (DLAPP.backtest) is not in this build, so no replay can be trusted. Nothing is estimated in its place."));
    sym = String(sym || "BTC").toUpperCase();
    var iv = ivOf(interval), to = C.now ? C.now() : Date.now();
    var span = (years > 0 ? years : 6) * 365.25 * DAY;
    var cap = MAX_BARS * IV_MS[iv];
    var from = to - Math.min(span, cap);
    var key = sym + "|" + iv + "|" + Math.round(from / DAY);
    if (H.key === key && H.bars) return Promise.resolve(H);
    H.loading = true; H.err = null;
    return binancePages(sym, iv, from, to).then(function (rows) {
      if (rows.length >= 120) return { rows: rows, src: "Binance" };
      return coinbasePages(sym, iv, from, to).then(function (r2) {
        if (r2.length >= 120) return { rows: r2, src: "Coinbase" };
        return krakenOne(sym, iv, from).then(function (r3) { return { rows: r3, src: "Kraken" }; });
      });
    }).then(function (got) {
      var bars = B.sanitize(got.rows, from, to);
      if (bars.length < 120) throw new Error("No venue has enough " + sym + " bars for that range. " + sym + " may not have been listed then — try BTC or ETH, a shorter range, or a bigger bar size.");
      if (bars.length > MAX_BARS) bars = bars.slice(bars.length - MAX_BARS);
      H.key = key; H.bars = bars; H.src = got.src; H.gaps = B.gaps(bars, iv);
      H.at = C.now ? C.now() : Date.now(); H.loading = false; H.err = null; H.interval = iv; H.sym = sym;
      return H;
    }, function (e) {
      H.loading = false; H.err = (e && e.message) || String(e); H.bars = null; H.key = "";
      throw e;
    });
  }

  /* ------------------------------------------------------------ strategies */

  function closesOf(bars, upTo) { var o = [], i; for (i = 0; i <= upTo; i++) o.push(bars[i].c); return o; }

  var STRATS = {
    sma: {
      id: "sma", name: "SMA 10/30 cross",
      note: window.DLI18N.t("61-replay.2a196ab22429"),
      decide: function (bars, t, st, cfg) {
        var I = IN();
        if (!I || typeof I.smaLast !== "function") return null;
        var cl = closesOf(bars, t), f = I.smaLast(cl, cfg.fast || 10), s = I.smaLast(cl, cfg.slow || 30);
        if (f == null || s == null) return null;
        if (f > s && st.qty <= 0) return { buy: true };
        if (f < s && st.qty > 0) return { flat: true };
        return null;
      }
    },
    breakout: {
      id: "breakout", name: "20-bar breakout",
      note: window.DLI18N.t("61-replay.d72fa2f0080b"),
      decide: function (bars, t, st, cfg) {
        var up = cfg.up || 20, dn = cfg.down || 10, i, hi = 0, lo = Infinity;
        if (t < up) return null;
        for (i = t - up; i < t; i++) if (bars[i].h > hi) hi = bars[i].h;
        for (i = t - dn; i < t; i++) if (bars[i].l < lo) lo = bars[i].l;
        if (st.qty <= 0 && bars[t].c > hi) return { buy: true };
        if (st.qty > 0 && bars[t].c < lo) return { flat: true };
        return null;
      }
    },
    hold: {
      id: "hold", name: "Buy and hold",
      note: window.DLI18N.t("61-replay.0c3d81a04e22"),
      decide: function (bars, t, st) { return st.qty <= 0 && !st.fills.length ? { buy: true } : null; }
    }
  };

  /* --------------------------------------------------------- the law audit */
  /* The engine owns the fill rules. This proves the engine's own fills obeyed
     them, so a bug anywhere upstream cannot quietly print a flattering run. */
  function lawAudit(st, bars) {
    var i, f, b, placed, out = { fills: 0, closeOut: 0, ok: true, why: "" };
    for (i = 0; i < st.fills.length; i++) {
      f = st.fills[i];
      b = bars[f.bar];
      if (!b) { out.ok = false; out.why = "a fill landed on a bar that is not in the series"; break; }
      if (f.why === "close-out") { out.closeOut++; continue; }
      out.fills++;
      placed = placedAtOf(f.orderId);
      if (placed == null) { out.ok = false; out.why = "a fill carries no decision bar"; break; }
      if (!(f.bar > placed)) { out.ok = false; out.why = "a fill landed on the bar the decision was made on (bar " + f.bar + ")"; break; }
      if (f.px < b.l * (1 - LAW_TOL) || f.px > b.h * (1 + LAW_TOL)) { out.ok = false; out.why = "a fill printed outside its bar's range at bar " + f.bar; break; }
      if (f.why === "market-open" && Math.abs(f.px - b.o) > b.o * LAW_TOL) { out.ok = false; out.why = "a market fill did not pay the next bar's open at bar " + f.bar; break; }
    }
    return out;
  }
  function placedAtOf(id) {
    var m = /^b(\d+)-/.exec(String(id || ""));
    return m ? +m[1] : null;
  }

  /* A standing, printable proof that the engine we route through is the one
     with the law in it — run on a constructed series where a lookahead fill
     would be detectably better. */
  function lawProof() {
    var B = BT();
    if (!B) return { ok: false, why: "DLAPP.backtest is not in this build" };
    var bars = [
      { t: 0, o: 100, h: 100, l: 100, c: 100, v: 1 },
      { t: 1, o: 120, h: 125, l: 118, c: 120, v: 1 },
      { t: 2, o: 121, h: 130, l: 119, c: 129, v: 1 }
    ];
    var pf = null, ok = true, why = [];
    try { pf = B.priceFor({ id: "b0-m", type: "market", side: "buy", qty: 1, placedAt: 0 }, bars[1]); } catch (e) { pf = null; }
    if (!pf || pf.px !== 120 || pf.why !== "market-open") { ok = false; why.push("a market order did not fill at the next bar's open"); }
    var stopIn = null, stopGap = null;
    try { stopIn = B.priceFor({ id: "b0-s", type: "stop", side: "sell", qty: 1, px: 119, placedAt: 0 }, bars[1]); } catch (e) {}
    try { stopGap = B.priceFor({ id: "b0-s", type: "stop", side: "sell", qty: 1, px: 130, placedAt: 0 }, bars[1]); } catch (e) {}
    if (!stopIn || stopIn.px !== 119 || stopIn.why !== "stop") { ok = false; why.push("a stop inside the bar's range did not fill at the stop"); }
    if (!stopGap || stopGap.px !== 120 || stopGap.why !== "stop-gap") { ok = false; why.push("a stop the bar gapped through did not fill at the open"); }
    /* the same decision, filled honestly and filled with the benefit of hindsight */
    var honest = (bars[2].c / bars[1].o - 1) * 100, cheat = (bars[2].c / bars[0].c - 1) * 100;
    return {
      ok: ok, why: why.join("; "),
      honestPct: honest, cheatPct: cheat, gapPct: cheat - honest,
      note: "On this constructed series a decision taken on bar 0's close pays 120 (the open of bar 1) and earns " + honest.toFixed(2) +
        "%. Filling it at the 100 the decision was made on — the lookahead a backtest on closes gives you for free — earns " + cheat.toFixed(2) +
        "%. The " + (cheat - honest).toFixed(2) + " point difference is what this desk refuses to print."
    };
  }

  /* ----------------------------------------------------------- one replay */
  /* Every fill goes through DLAPP.backtest. This function owns no fill rule. */
  function replayWindow(bars, a, b, stratId, cfg, fee) {
    var B = BT();
    if (!B) return { ok: false, why: "DLAPP.backtest is not in this build" };
    var strat = STRATS[stratId] || STRATS.sma;
    cfg = cfg || {};
    fee = fee > 0 ? fee : B.DEFAULT_FEE;
    var warm = cfg.warm != null ? cfg.warm : WARM;
    var a0 = Math.max(0, a - warm), seg = bars.slice(a0, b + 1), first = a - a0;
    if (seg.length < 5) return { ok: false, why: "the window is too short to replay" };
    var st = B.init(CASH), r, d, sub, exposure = [], rejects = 0, orders = 0, i;
    r = B.advance(st, seg, fee); st = r.state;
    while (!st.done && st.i < seg.length - 1) {
      if (st.i >= first) {
        d = null;
        try { d = strat.decide(seg, st.i, st, cfg); } catch (e) { d = null; }
        if (d && d.flat && st.qty > 0) {
          for (i = 0; i < st.orders.length; i++) st = B.cancel(st, st.orders[i].id);
          sub = B.submit(st, { id: "b" + st.i + "-x", type: "market", side: "sell", qty: st.qty, placedAt: st.i }, seg[st.i]);
          orders++; if (sub.error) rejects++; else st = sub.state;
        } else if (d && d.buy && st.qty <= 0) {
          var qty = (st.cash * 0.95) / seg[st.i].c;
          if (qty > 0) {
            sub = B.submit(st, { id: "b" + st.i + "-m", type: "market", side: "buy", qty: qty, placedAt: st.i }, seg[st.i]);
            orders++; if (sub.error) rejects++; else st = sub.state;
          }
        } else if (cfg.stopAtr > 0 && st.qty > 0 && !st.orders.length) {
          var I = IN(), atr = null;
          try { var arr = I && I.atr ? I.atr(seg.slice(0, st.i + 1), 14) : null; atr = arr ? arr[arr.length - 1] : null; } catch (e) { atr = null; }
          if (atr > 0) {
            var px = seg[st.i].c - cfg.stopAtr * atr;
            if (px > 0) {
              sub = B.submit(st, { id: "b" + st.i + "-s", type: "stop", side: "sell", qty: st.qty, px: px, placedAt: st.i }, seg[st.i]);
              orders++; if (sub.error) rejects++; else st = sub.state;
            }
          }
        }
      }
      r = B.advance(st, seg, fee); st = r.state;
      exposure.push(st.qty * seg[st.i].c);
    }
    st = B.closeOut(st, seg, fee);
    var law = lawAudit(st, seg);
    if (!law.ok) return { ok: false, why: "the run was refused: " + law.why, law: law };
    var m = B.metrics(st, seg, cfg.interval || "1d");
    var M = MA(), avgNotional = M ? M.mean(exposure) : null;
    return {
      ok: true, a: a, b: b, t0: bars[a].t, t1: bars[b].t, strat: strat.id,
      metrics: m, equity: m.equity, returnPct: m.returnPct, maxDDPct: m.maxDDPct,
      trades: m.trades, fills: m.fills, feesUSD: m.feesUSD, rejects: rejects, orders: orders,
      avgNotional: avgNotional, law: law, seg: seg, first: first, state: st
    };
  }

  /* ------------------------------------------------------- the distribution */
  /* Type-7 (PERCENTILE.INC) order statistics, through the engine's own
     percentile so the definition cannot drift between desks. */
  function distribution(vals) {
    var M = MA(), clean = [], i;
    if (!M) return null;
    for (i = 0; i < vals.length; i++) if (vals[i] != null && isFinite(vals[i])) clean.push(vals[i]);
    if (!clean.length) return null;
    var sorted = clean.slice().sort(function (x, y) { return x - y; });
    var q1 = M.percentile(sorted, 0.25), q3 = M.percentile(sorted, 0.75), pos = 0;
    for (i = 0; i < sorted.length; i++) if (sorted[i] > 0) pos++;
    return {
      n: sorted.length, median: M.percentile(sorted, 0.5), q1: q1, q3: q3, iqr: q3 - q1,
      worst: sorted[0], best: sorted[sorted.length - 1], mean: M.mean(sorted),
      stdev: M.stdev(sorted), posShare: sorted.length ? pos / sorted.length : null
    };
  }

  /* Replay a strategy across EVERY window carrying one label. */
  function replayRegime(bars, group, interval, stratId, cfg) {
    if (!group || !group.all || !group.all.length) return { ok: false, why: "no windows carry that label" };
    cfg = cfg || {}; cfg.interval = interval;
    /* The distribution is taken over the NON-OVERLAPPING subset. When a label
       is so rare that it has no non-overlapping window at all, the desk falls
       back to the overlapping ones and says, in the result and on the screen,
       that these are not independent draws. */
    var use = group.indep.length ? group.indep : group.all;
    var overlapping = !group.indep.length;
    var rows = [], i, w, run, bh, edge;
    for (i = 0; i < use.length; i++) {
      w = use[i];
      run = replayWindow(bars, w.a, w.b, stratId, cfg, cfg.fee);
      bh = replayWindow(bars, w.a, w.b, "hold", cfg, cfg.fee);
      if (!run.ok || !bh.ok) { rows.push({ t0: w.t0, t1: w.t1, ok: false, why: run.why || bh.why }); continue; }
      edge = run.returnPct - bh.returnPct;
      rows.push({
        ok: true, t0: w.t0, t1: w.t1, a: w.a, b: w.b, er: w.er, rvGK: w.rvGK,
        ret: run.returnPct, bh: bh.returnPct, edge: edge, dd: run.maxDDPct,
        trades: run.trades, fills: run.fills, fees: run.feesUSD, law: run.law
      });
    }
    var eds = [], rets = [], dds = [], j, okRows = [];
    for (j = 0; j < rows.length; j++) if (rows[j].ok) { okRows.push(rows[j]); eds.push(rows[j].edge); rets.push(rows[j].ret); dds.push(rows[j].dd); }
    return {
      ok: okRows.length > 0, rows: rows, n: okRows.length, nAll: group.all.length,
      edge: distribution(eds), ret: distribution(rets), dd: distribution(dds),
      anecdote: okRows.length < 5, overlapping: overlapping, strat: stratId, label: group.label
    };
  }

  /* ---------------------------------------------------------------- shocks */

  /* Volatility regime change: log returns stretched about their own mean, so
     Σr is preserved exactly and the window ends where it ended. Each bar's
     o/h/l is stretched about its close by the same multiplier in log space. */
  function shockVol(bars, mult) {
    var M = MA();
    if (!M || !(mult > 0) || mult === 1 || bars.length < 2) return bars;
    var r = [], i, c = [bars[0].c], out = [];
    for (i = 1; i < bars.length; i++) r.push(Math.log(bars[i].c / bars[i - 1].c));
    var mr = M.mean(r);
    for (i = 0; i < r.length; i++) c.push(c[i] * Math.exp(mr + mult * (r[i] - mr)));
    for (i = 0; i < bars.length; i++) {
      var b = bars[i], nc = c[i];
      out.push({
        t: b.t, v: b.v, c: nc,
        o: nc * Math.pow(b.o / b.c, mult),
        h: nc * Math.pow(b.h / b.c, mult),
        l: nc * Math.pow(b.l / b.c, mult)
      });
    }
    return out;
  }

  /* An overnight gap: every bar from the chosen one onward is multiplied by (1+pct), so
     the jump happens between bar at−1's close and bar at's open. */
  function shockGap(bars, pct, at) {
    if (!(pct !== 0) || !bars.length) return bars;
    var k = Math.max(1, Math.min(bars.length - 1, at)), out = [], i, b, f;
    for (i = 0; i < bars.length; i++) {
      b = bars[i]; f = i >= k ? 1 + pct : 1;
      out.push({ t: b.t, v: b.v, o: b.o * f, h: b.h * f, l: b.l * f, c: b.c * f });
    }
    return out;
  }

  /* The quote asset depegs: the price QUOTED in it becomes p ÷ (1+d). The
     dollar value of the coin does not change — only the number on the screen. */
  function shockDepeg(bars, pct) {
    if (!(pct !== 0) || !bars.length) return bars;
    var f = 1 / (1 + pct), out = [], i, b;
    if (!(f > 0) || !isFinite(f)) return bars;
    for (i = 0; i < bars.length; i++) {
      b = bars[i];
      out.push({ t: b.t, v: b.v, o: b.o * f, h: b.h * f, l: b.l * f, c: b.c * f });
    }
    return out;
  }

  function priceShocks(bars, stack, seed, a, b) {
    var i, s, out = bars;
    for (i = 0; i < SHOCK_ORDER.length; i++) {
      s = stack[SHOCK_ORDER[i]];
      if (!s || !s.on) continue;
      if (SHOCK_ORDER[i] === "vol") out = shockVol(out, +s.mult);
      if (SHOCK_ORDER[i] === "gap") out = shockGap(out, +s.pct, barIn(s.at, a, b, seed));
      if (SHOCK_ORDER[i] === "depeg") out = shockDepeg(out, +s.pct);
    }
    return out;
  }
  /* Where an unanchored shock lands: INSIDE the replayed window (a shock that
     lands before it is a level change the run never sees), hash-derived from
     the scenario, never random. */
  function barIn(at, a, b, seed) {
    if (at != null && at >= 0) return Math.max(a + 1, Math.min(b, Math.round(at)));
    var span = Math.max(1, b - a - 1);
    return a + 1 + (seed % span);
  }

  /* ------------------------------------------------- execution-side shocks */

  function statsOf(sym) {
    var c = null;
    try { c = C.coin(sym); } catch (e) { c = null; }
    if (!c || !(+c.price > 0)) return null;
    return { vol24: +c.vol || 0, mcap: +c.mcap || 0, chg24: +c.c24 || 0, price: +c.price };
  }

  /* Impact cost of a run's fills at a given depth multiple, through the SAME
     pool arithmetic the trading ticket walks. */
  function impactCost(run, stats, depthMult) {
    var P = PE();
    if (!P || !run || !run.ok || !stats) return null;
    var st = { vol24: (stats.vol24 || 0) * (depthMult > 0 ? depthMult : 1), mcap: stats.mcap || 0 };
    var spec = null;
    try { spec = P.poolSpec(st, "dexamm", null); } catch (e) { spec = null; }
    if (!spec || !(spec.tvlUSD > 0)) return null;
    var total = 0, i, f, pool, sw, rows = [];
    for (i = 0; i < run.state.fills.length; i++) {
      f = run.state.fills[i];
      try {
        pool = P.poolAt(spec, f.px, 1);
        sw = pool ? P.swap(pool, f.side === "buy" ? "buy" : "sell", f.qty) : null;
      } catch (e) { sw = null; }
      if (!sw || !(sw.filled > 0)) continue;
      var cost = Math.abs(sw.avg - f.px) * sw.filled;
      total += cost;
      rows.push({ bar: f.bar, side: f.side, qty: sw.filled, px: f.px, avg: sw.avg, bps: (Math.abs(sw.avg / f.px - 1)) * 1e4, cost: cost });
    }
    return { total: total, rows: rows, tvlUSD: spec.tvlUSD, depthMult: depthMult };
  }

  /* The funding drag on a HYPOTHETICAL carried perp of the run's own average
     notional. The spot run itself pays no funding. */
  function fundingCost(bars, a, b, interval, rate8h, hours, notional, side) {
    var P = PP();
    if (!P || !(notional > 0) || rate8h == null) return null;
    var dueN = P.settlementsBetween(bars[a].t, bars[b].t, hours || 8);
    if (!dueN || !dueN.length) return { total: 0, count: 0 };
    var per = notional * P.intervalRate(rate8h, hours || 8) * (side === "short" ? -1 : 1);
    return { total: per * dueN.length, count: dueN.length, per: per, rate8h: rate8h, hours: hours || 8 };
  }

  /* --------------------------------------------------------- the cascade */

  function barAt(bars, t) {
    var lo = 0, hi = bars.length - 1, mid;
    if (t <= bars[0].t) return 0;
    if (t >= bars[hi].t) return hi;
    while (lo < hi) { mid = (lo + hi + 1) >> 1; if (bars[mid].t <= t) lo = mid; else hi = mid - 1; }
    return lo;
  }

  /* Forced-sale ladder. Handed to DLLEND when that desk is in the build;
     otherwise computed here on the engine's own maintenance ladder. */
  function cascade(o) {
    o = o || {};
    var p0 = +o.price, drop = +o.dropPct, oi = +o.oiUSD, stats = o.stats, depthMult = o.depthMult > 0 ? o.depthMult : 1;
    if (!(p0 > 0) || !(oi > 0)) return null;
    var ext = null;
    try {
      if (window.DLLEND && typeof window.DLLEND.cascade === "function") ext = window.DLLEND.cascade({ price: p0, dropPct: drop, oiUSD: oi, sym: o.sym });
    } catch (e) { ext = null; }
    if (ext && +ext.finalPrice > 0) {
      return { src: "DLLEND", p0: p0, trigger: p0 * (1 + drop), final: +ext.finalPrice, rounds: ext.rounds || [], liquidatedUSD: +ext.liquidatedUSD || null, totalDrop: (p0 - +ext.finalPrice) / p0, amplification: (p0 - +ext.finalPrice) / p0 + drop };
    }
    var P = PE(), PR = PP();
    if (!P || !PR || !stats) return null;
    var spec = null, perpSpec = null;
    try { spec = P.poolSpec({ vol24: (stats.vol24 || 0) * depthMult, mcap: stats.mcap || 0 }, "dexamm", null); } catch (e) { spec = null; }
    try { perpSpec = PR.specFor(o.sym || "BTC", stats.mcap || 0, "advanced", "binance"); } catch (e) { perpSpec = null; }
    if (!spec || !(spec.tvlUSD > 0) || !perpSpec) return null;
    var rungs = [], i, lev, share, notional, qty, tier;
    for (i = 0; i < LEV_BUCKETS.length; i++) {
      lev = LEV_BUCKETS[i][0]; share = LEV_BUCKETS[i][1];
      notional = oi * share; qty = notional / p0;
      try { tier = PR.tierFor(perpSpec.tiers, notional); } catch (e) { tier = null; }
      if (!tier) continue;
      var liq = null;
      try { liq = PR.liqPrice({ side: "long", qty: qty, entry: p0, margin: notional / lev, mmr: tier.mmr, cum: tier.cum }); } catch (e) { liq = null; }
      if (liq == null) continue;
      rungs.push({ lev: lev, share: share, notionalUSD: notional, qty: qty, margin: notional / lev, mmr: tier.mmr, cum: tier.cum, liq: liq, gone: false });
    }
    if (!rungs.length) return null;
    var p = p0 * (1 + drop), rounds = [], soldUSD = 0, askedUSD = 0, guard = 0, noBid = false;
    while (guard++ < 12) {
      var hit = [], q = 0;
      for (i = 0; i < rungs.length; i++) if (!rungs[i].gone && rungs[i].liq >= p) { hit.push(rungs[i]); q += rungs[i].qty; }
      if (!hit.length || !(q > 0)) break;
      /* A round that asks the modelled pool for more value than the whole pool
         holds is not a price, it is a division. Stop and say NO BID. */
      if (askedUSD + q * p > spec.tvlUSD) { noBid = true; break; }
      askedUSD += q * p;
      for (i = 0; i < hit.length; i++) hit[i].gone = true;
      var pool = null, sw = null;
      try { pool = P.poolAt(spec, p, 1); sw = pool ? P.swap(pool, "sell", q) : null; } catch (e) { sw = null; }
      if (!sw || !(sw.filled > 0)) break;
      soldUSD += sw.quote;
      rounds.push({ round: rounds.length + 1, at: p, qty: sw.filled, usd: sw.quote, to: sw.p1, levs: (function () { var s = [], j; for (j = 0; j < hit.length; j++) s.push(hit[j].lev + "x"); return s.join(", "); })() });
      if (!(sw.p1 > 0) || sw.p1 >= p) break;
      p = sw.p1;
    }
    var pending = 0;
    for (i = 0; i < rungs.length; i++) if (!rungs[i].gone && rungs[i].liq >= p) pending += rungs[i].notionalUSD;
    if (pending > 0) noBid = true;
    return {
      src: "own ladder", p0: p0, trigger: p0 * (1 + drop), final: p, rounds: rounds, rungs: rungs,
      liquidatedUSD: soldUSD, askedUSD: askedUSD, tvlUSD: spec.tvlUSD, pendingUSD: pending,
      soldOverTvl: spec.tvlUSD > 0 ? askedUSD / spec.tvlUSD : null, noBid: noBid,
      totalDrop: (p0 - p) / p0, amplification: (p0 - p) / p0 + drop
    };
  }

  /* -------------------------------------------------------- the scenario */

  /* Result of a run under a stack of shocks, in percent of the starting stack,
     with every cost line named. */
  function stageResult(bars, a, b, interval, stratId, cfg, stack, seed, stats, sym) {
    var shocked = priceShocks(bars, stack, seed, a, b);
    var run = replayWindow(shocked, a, b, stratId, cfg, cfg.fee);
    if (!run.ok) return { ok: false, why: run.why };
    var depthMult = stack.depth && stack.depth.on ? +stack.depth.mult : 1;
    var imp = impactCost(run, stats, depthMult);
    var fund = null;
    if (stack.funding && stack.funding.on) {
      fund = fundingCost(shocked, a, b, interval, +stack.funding.rate8h, +stack.funding.hours || 8, run.avgNotional, stack.funding.side);
    }
    var casc = null, cascCost = 0;
    if (stack.cascade && stack.cascade.on) {
      var idx = barIn(stack.cascade.at, a, b, seed);
      casc = cascade({ price: shocked[idx].c, dropPct: +stack.cascade.dropPct, oiUSD: +stack.cascade.oiUSD, stats: stats, depthMult: depthMult, sym: sym });
      if (casc && casc.totalDrop > 0) {
        var held = run.state.equity.length ? run.avgNotional : 0;
        cascCost = held * casc.totalDrop;
        casc.bar = idx;
      }
    }
    var impCost = imp ? imp.total : 0, fundCost = fund ? fund.total : 0;
    var net = run.equity - impCost - fundCost - cascCost;
    var nominalPct = (net / CASH - 1) * 100;
    var depeg = stack.depeg && stack.depeg.on ? +stack.depeg.pct : 0;
    return {
      ok: true, run: run, impact: imp, funding: fund, cascade: casc,
      costs: { impact: impCost, funding: fundCost, cascade: cascCost },
      equity: net, pct: nominalPct,
      realPct: ((net * (1 + depeg)) / CASH - 1) * 100
    };
  }

  /* The full scenario: base, then each shock added in the stated order, with
     the marginal effect of each — and each priced alone, so the interaction
     residual can be printed rather than hidden. */
  function scenario(bars, a, b, interval, stratId, cfg, shocks, sym) {
    cfg = cfg || {}; cfg.interval = interval;
    var stats = statsOf(sym), key = sym + "|" + interval + "|" + bars[a].t + "|" + bars[b].t;
    var seed = seedOf(key, shocks);
    var base = stageResult(bars, a, b, interval, stratId, cfg, {}, seed, stats, sym);
    if (!base.ok) return { ok: false, why: base.why };
    var stack = {}, stages = [], prev = base.pct, i, k, sh, st, alone, sumAlone = 0;
    for (i = 0; i < SHOCK_ORDER.length; i++) {
      k = SHOCK_ORDER[i]; sh = shocks && shocks[k];
      if (!sh || !sh.on) continue;
      stack[k] = sh;
      st = stageResult(bars, a, b, interval, stratId, cfg, stack, seed, stats, sym);
      if (!st.ok) return { ok: false, why: st.why };
      var one = {};
      one[k] = sh;
      alone = stageResult(bars, a, b, interval, stratId, cfg, one, seed, stats, sym);
      var aloneEff = alone.ok ? alone.pct - base.pct : null;
      if (aloneEff != null) sumAlone += aloneEff;
      stages.push({
        key: k, shock: sh, pct: st.pct, realPct: st.realPct, marginal: st.pct - prev,
        alone: aloneEff, costs: st.costs, detail: st
      });
      prev = st.pct;
    }
    var total = prev - base.pct;
    return {
      ok: true, seed: seed, seedHex: hex8(seed), key: key, base: base, stages: stages,
      total: total, sumMarginal: (function () { var s = 0, j; for (j = 0; j < stages.length; j++) s += stages[j].marginal; return s; })(),
      sumAlone: sumAlone, residual: total - sumAlone, order: SHOCK_ORDER.slice(),
      finalPct: prev, finalRealPct: stages.length ? stages[stages.length - 1].realPct : base.realPct
    };
  }

  /* ------------------------------------------------------------- the tape */

  /* Per-settlement funding over the window, on the REAL UTC clock, with the
     arithmetic of every row shown and the cumulative drag carried. */
  function fundingTape(bars, a, b, interval, qty, side, hours) {
    var P = PP();
    if (!P || typeof P.settlementsBetween !== "function") return { ok: false, why: "the perps engine is not in this build, so the tape cannot be reconstructed" };
    hours = hours > 0 ? hours : 8;
    var due = P.settlementsBetween(bars[a].t, bars[b].t, hours), rows = [], cum = 0, i, ivMs = IV_MS[interval] || DAY;
    var dir = side === "short" ? -1 : 1;
    for (i = 0; i < due.length && i < 400; i++) {
      var idx = barAt(bars, due[i]), mark = bars[idx].c;
      var f = fundingModelAt(bars, idx, ivMs);
      if (!f) continue;
      var ir = P.intervalRate(f.rate8h, hours), pay = qty * mark * ir * dir;
      cum += pay;
      rows.push({ t: due[i], mark: mark, rate8h: f.rate8h, move24: f.move24, intervalRate: ir, pay: pay, cum: cum });
    }
    return { ok: true, rows: rows, count: rows.length, total: cum, hours: hours, qty: qty, side: side, src: "modelled" };
  }

  /* The liquidation ladder for one position, with the engine's own steps. */
  function liqLadder(sym, price, notional, levs) {
    var P = PP(), stats = statsOf(sym);
    if (!P || !stats || !(price > 0) || !(notional > 0)) return { ok: false, why: "no market for " + sym + ", so no ladder" };
    var spec = null;
    try { spec = P.specFor(sym, stats.mcap || 0, "advanced", "binance"); } catch (e) { spec = null; }
    if (!spec) return { ok: false, why: "the perps engine is not in this build" };
    levs = levs && levs.length ? levs : [2, 3, 5, 10, 20, 25];
    var rows = [], i, qty = notional / price, tier;
    for (i = 0; i < levs.length; i++) {
      try { tier = P.tierFor(spec.tiers, notional); } catch (e) { tier = null; }
      if (!tier) continue;
      var margin = notional / levs[i];
      var lq = null, sq = null;
      try { lq = P.liqPrice({ side: "long", qty: qty, entry: price, margin: margin, mmr: tier.mmr, cum: tier.cum }); } catch (e) {}
      try { sq = P.liqPrice({ side: "short", qty: qty, entry: price, margin: margin, mmr: tier.mmr, cum: tier.cum }); } catch (e) {}
      rows.push({ lev: levs[i], qty: qty, margin: margin, mmr: tier.mmr, cum: tier.cum, liqLong: lq, liqShort: sq, maxLev: tier.maxLev, distLong: lq == null ? null : (price - lq) / price * 100 });
    }
    return { ok: true, rows: rows, price: price, notional: notional, sym: sym, tierNote: "maintenance steps and the liquidation formula are the engine's own (DLAPP.perps)" };
  }

  /* --------------------------------------------------------------- state */

  function bucket() {
    var X = null;
    try { X = C.X(); } catch (e) { X = null; }
    if (!X) return null;
    if (!X.replay) X.replay = null;
    return X;
  }
  var DEFAULTS = {
    sym: "BTC", interval: "1d", years: 6, win: WIN, stride: STRIDE,
    strat: "sma", regime: null, tab: "regimes",
    fundQty: 1, fundSide: "long", fundHours: 8, notional: 50000,
    shocks: {
      vol: { on: false, mult: 1.8 },
      gap: { on: false, pct: -0.12, at: null },
      depeg: { on: false, pct: -0.05 },
      funding: { on: false, rate8h: 0.003, side: "long", hours: 8 },
      depth: { on: false, mult: 0.25 },
      cascade: { on: false, dropPct: -0.15, oiUSD: 50000000, at: null }
    }
  };
  function cfgState(patch) {
    var X = bucket();
    if (!X) return patch ? merge(DEFAULTS, patch) : DEFAULTS;
    if (!X.replay) X.replay = merge(DEFAULTS, {});
    if (patch) { X.replay = merge(X.replay, patch); try { C.save(); } catch (e) {} }
    return X.replay;
  }
  function merge(a, b) {
    var o = {}, k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) o[k] = a[k];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) o[k] = b[k];
    return o;
  }

  /* ---------------------------------------------------------- formatting */

  function esc(s) { try { return C.esc ? C.esc(String(s)) : String(s).replace(/[&<>"]/g, ""); } catch (e) { return ""; } }
  function pct(n, d) { return n == null || !isFinite(n) ? "—" : (n < 0 ? "−" : "") + Math.abs(n).toFixed(d == null ? 2 : d) + "%"; }
  function sgn(n, d) { return n == null || !isFinite(n) ? "—" : (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(d == null ? 2 : d) + "%"; }
  function num(n, d) { return n == null || !isFinite(n) ? "—" : n.toFixed(d == null ? 3 : d); }
  function usd(n) { if (n == null || !isFinite(n)) return "—"; try { return C.money ? C.money(n) : "$" + n.toFixed(2); } catch (e) { return "$" + n.toFixed(2); } }
  function big(n) { if (n == null || !isFinite(n)) return "—"; try { return C.big ? C.big(n) : String(Math.round(n)); } catch (e) { return String(Math.round(n)); } }
  function day(t) { if (!(t > 0)) return "—"; try { return new Date(t).toISOString().slice(0, 10); } catch (e) { return "—"; } }
  function stamp(t) { if (!(t > 0)) return "—"; try { return new Date(t).toISOString().slice(0, 16).replace("T", " ") + "Z"; } catch (e) { return "—"; } }
  function bpsOf(x) { return x == null || !isFinite(x) ? "—" : (x * 1e4).toFixed(1) + " bp"; }

  /* ------------------------------------------------------------- the UI */

  var VIEW = { tab: "regimes", body: null, el: null, gen: 0 };
  var RUN = { regime: null, scenario: null, window: null };

  function paint() {
    if (!VIEW.body) return;
    try { VIEW.body.innerHTML = paneFor(VIEW.tab); } catch (e) { VIEW.body.innerHTML = '<div class="rp-empty">' + esc((e && e.message) || e) + "</div>"; }
  }

  function ensure(force) {
    var s = cfgState();
    if (H.loading) return;
    if (!force && H.bars && H.sym === s.sym && H.interval === ivOf(s.interval)) { paint(); return; }
    var gen = ++VIEW.gen;
    H.loading = true; paint();
    history(s.sym, s.interval, s.years).then(function () {
      if (gen !== VIEW.gen) return;
      RUN.regime = null; RUN.scenario = null;
      paint();
    }, function () { if (gen === VIEW.gen) paint(); });
  }

  function bodyFor(tab, body, el) {
    VIEW.tab = tab; VIEW.body = body; VIEW.el = el || VIEW.el;
    body.innerHTML = paneFor(tab);
  }

  function paneFor(tab) {
    if (tab === "window") return paneWindow();
    if (tab === "scenario") return paneScenario();
    if (tab === "tape") return paneTape();
    if (tab === "method") return paneMethod();
    return paneRegimes();
  }

  function headStrip() {
    var s = cfgState(), h = '<div class="rp-form dl-2">';
    h += field("Market", '<input id="rpSym" class="dl-inp" type="text" value="' + esc(s.sym) + '" autocomplete="off" spellcheck="false" aria-label="Market symbol">');
    h += field("Bar size", ('<select id="rpIv" class="dl-inp" aria-label="' + window.DLI18N.t("61-replay.7ee027db5f6a") + '">') + opts(["1h", "4h", "1d"], s.interval) + "</select>");
    h += field("Years back", ('<select id="rpYears" class="dl-inp" aria-label="' + window.DLI18N.t("61-replay.406715c11bcf") + '">') + opts([1, 2, 3, 6, 10], s.years) + "</select>");
    h += field("Window (bars)", ('<select id="rpWin" class="dl-inp" aria-label="' + window.DLI18N.t("61-replay.e0f59e72c595") + '">') + opts([30, 60, 90, 120], s.win) + "</select>");
    h += "</div>";
    h += ('<div class="rp-actions"><button class="go" id="rpMeasure" type="button">' + window.DLI18N.t("61-replay.00598b589a16") + '</button>') +
      '<span class="rp-note">' + (H.bars ? esc(H.src) + " · " + H.bars.length + " bars · first bar " + esc(day(H.bars[0].t)) + " · " + (H.gaps || 0) + " gap" + (H.gaps === 1 ? "" : "s") : "nothing fetched yet") + "</span></div>";
    return h;
  }

  function loadingOr(fn) {
    if (H.loading) return '<div class="rp-empty">' + (C.skel ? C.skel(6) : "fetching real candles…") + "</div>";
    if (H.err) return '<div class="rp-empty">' + esc(H.err) + "</div>";
    if (!H.bars) return ('<div class="rp-empty">' + window.DLI18N.t("61-replay.bb6ecaff6767") + '<b>' + window.DLI18N.t("61-replay.00598b589a16") + '</b>' + window.DLI18N.t("61-replay.a112f44cb1f0") + '</div>');
    return fn();
  }

  function regimeSet() {
    var s = cfgState();
    if (!H.bars) return null;
    if (RUN.regime && RUN.regime.key === H.key + "|" + s.win) return RUN.regime.set;
    var set = regimes(H.bars, H.interval, +s.win, +s.stride);
    RUN.regime = { key: H.key + "|" + s.win, set: set };
    return set;
  }

  function paneRegimes() {
    var h = headStrip();
    h += loadingOr(function () {
      var set = regimeSet(), s = cfgState();
      if (!set) return ('<div class="rp-empty">' + window.DLI18N.t("61-replay.2f5ebc1f1282") + '') + esc(s.win) + (window.DLI18N.t("61-replay.7ac2c493c0a5") + "</div>");
      var t = set.thresholds, out = "";
      out += ('<div class="rp-thr"><b>' + window.DLI18N.t("61-replay.3c223ab7c256") + '</b> ') +
        "Trend (convention): efficiency ratio ≥ " + t.erTrend + " is a trend, ≤ " + t.erChop + " is chop, between is drift. " +
        "This asset's own ER terciles came out at " + num(t.erTerciles ? t.erTerciles.lo : null) + " / " + num(t.erTerciles ? t.erTerciles.hi : null) + ". " +
        "Volatility (measured): the Garman-Klass terciles of these " + set.windows.length + " windows are " + pct((t.volLo || 0) * 100, 1) + " and " + pct((t.volHi || 0) * 100, 1) + " annualised — 'high vol' means high for " + esc(H.sym) + " in this sample, nothing more. " +
        "Drawdown (convention): under " + (DD_NEAR * 100) + "% of the running peak is near highs, under " + (DD_BEAR * 100) + "% is a correction, beyond it is a bear. " +
        (window.DLI18N.t("61-replay.728d03d1ea43") + "</div>");
      out += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("61-replay.a4f7986fb0c9") + '</th><th class="r">' + window.DLI18N.t("61-replay.d598026a9cbc") + '</th><th class="r">' + window.DLI18N.t("61-replay.6cbf0605ed3d") + '</th><th class="r">' + window.DLI18N.t("61-replay.f67855248fd3") + '</th><th class="r">' + window.DLI18N.t("61-replay.9a8e8aac98a8") + '</th><th class="r">' + window.DLI18N.t("61-replay.e222dbe26957") + '</th><th>' + window.DLI18N.t("61-replay.e93df741ad32") + '</th><th>' + window.DLI18N.t("61-replay.5b0e83c19eb4") + '</th><th></th></tr></thead><tbody>');
      var i, g;
      for (i = 0; i < set.groups.length; i++) {
        g = set.groups[i];
        var ers = [], vols = [], rets = [], j;
        for (j = 0; j < g.all.length; j++) { ers.push(g.all[j].er); vols.push(g.all[j].rvGK); rets.push(g.all[j].ret == null ? null : g.all[j].ret * 100); }
        var de = distribution(ers), dv = distribution(vols), dr = distribution(rets);
        out += "<tr><td class=\"rp-id\">" + esc(g.id) + "</td><td class=\"r\">" + g.all.length + '</td><td class="r">' + g.indep.length + '</td><td class="r">' + num(de ? de.median : null) +
          '</td><td class="r">' + pct(dv ? dv.median * 100 : null, 1) + '</td><td class="r">' + sgn(dr ? dr.median : null, 1) + "</td><td>" + esc(g.label.fund) + "</td><td>" +
          esc(day(g.all[0].t0)) + " → " + esc(day(g.all[g.all.length - 1].t1)) + '</td><td><button class="rp-pick" type="button" data-rg="' + esc(g.id) + ('' + window.DLI18N.t("61-replay.04b5553d7d92") + '</button></td></tr>');
      }
      out += "</tbody></table></div>";
      out += ('<div class="rp-sub">' + window.DLI18N.t("61-replay.7e6470a9b190") + '</div>');
      out += ('<div class="rp-note">' + window.DLI18N.t("61-replay.a9be65fc3ab7") + '</div>');
      out += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("61-replay.1bac4007880b") + '</th><th>' + window.DLI18N.t("61-replay.218197693424") + '</th><th>' + window.DLI18N.t("61-replay.f4b06ef6d3c8") + '</th><th class="r">' + window.DLI18N.t("61-replay.d135ca987280") + '</th><th>' + window.DLI18N.t("61-replay.5f2d001658f5") + '</th></tr></thead><tbody>');
      for (i = 0; i < BOOKMARKS.length; i++) {
        var bm = BOOKMARKS[i], inw = [], seen = {}, labs = [];
        for (j = 0; j < set.windows.length; j++) {
          var w = set.windows[j];
          if (w.t1 >= bm.from && w.t0 <= bm.to) { inw.push(w); if (!seen[w.label.id]) { seen[w.label.id] = 1; labs.push(w.label.id); } }
        }
        out += "<tr><td>" + esc(bm.label) + (" <span class=\"rp-tag\">" + window.DLI18N.t("61-replay.d6021fcf471e") + "</span></td><td>") + esc(day(bm.from)) + "</td><td>" + esc(day(bm.to)) +
          '</td><td class="r">' + inw.length + "</td><td class=\"rp-id\">" + (labs.length ? esc(labs.join(" · ")) : "outside the history this build fetched") + "</td></tr>";
      }
      out += "</tbody></table></div>";
      return out;
    });
    return h;
  }

  function paneWindow() {
    var s = cfgState(), h = "";
    h += ('<div class="rp-note">' + window.DLI18N.t("61-replay.2776f861e3c7") + '<b>' + window.DLI18N.t("61-replay.66a424a9a958") + '</b>' + window.DLI18N.t("61-replay.0352ed42a20c") + '</div>');
    h += '<div class="rp-form dl-2">';
    h += field("Strategy", ('<select id="rpStrat" class="dl-inp" aria-label="' + window.DLI18N.t("61-replay.6b27710dfaaf") + '">') + optsKV([["sma", STRATS.sma.name], ["breakout", STRATS.breakout.name], ["hold", STRATS.hold.name]], s.strat) + "</select>");
    h += field("Regime", '<input id="rpRg" class="dl-inp" type="text" value="' + esc(s.regime || "") + '" autocomplete="off" spellcheck="false" aria-label="Regime id">');
    h += "</div>";
    h += ('<div class="rp-actions"><button class="go" id="rpRun" type="button">' + window.DLI18N.t("61-replay.5bca00f94fc0") + '</button></div>');
    h += loadingOr(function () {
      var set = regimeSet();
      if (!set) return ('<div class="rp-empty">' + window.DLI18N.t("61-replay.39337ce503a8") + '</div>');
      if (!s.regime) return ('<div class="rp-empty">' + window.DLI18N.t("61-replay.efd968049344") + '<b>' + window.DLI18N.t("61-replay.6f7bd73a7dda") + '</b>' + window.DLI18N.t("61-replay.148ed05727ba") + '</div>');
      var g = null, i;
      for (i = 0; i < set.groups.length; i++) if (set.groups[i].id === s.regime) g = set.groups[i];
      if (!g) return ('<div class="rp-empty">' + window.DLI18N.t("61-replay.2bac2ae88371") + '') + esc(s.regime) + "”.</div>";
      var res = RUN.window && RUN.window.key === H.key + "|" + s.regime + "|" + s.strat ? RUN.window.res
        : (RUN.window = { key: H.key + "|" + s.regime + "|" + s.strat, res: replayRegime(H.bars, g, H.interval, s.strat, { fee: null }) }).res;
      if (!res.ok) return '<div class="rp-empty">' + esc(res.why || "no window replayed cleanly") + "</div>";
      var out = "";
      out += '<div class="rp-head"><span class="rp-pair">' + esc(g.id) + '</span><span class="rp-mid">' + esc(STRATS[s.strat].name) + " · " + res.n + " independent window" + (res.n === 1 ? "" : "s") + " of " + res.nAll + (window.DLI18N.t("61-replay.24fd2c5d396d") + "</span></div>");
      if (res.overlapping) out += ('<div class="rp-warn">' + window.DLI18N.t("61-replay.e030727188cc") + '</div>');
      if (res.anecdote) out += '<div class="rp-warn">' + res.n + " window" + (res.n === 1 ? " is an anecdote, not a sample" : "s is barely a sample") + (window.DLI18N.t("61-replay.58eb2ba56b47") + "</div>");
      out += distTable("Edge over buy-and-hold, per window (percentage points)", res.edge);
      out += distTable("Strategy return per window", res.ret);
      out += distTable("Worst drawdown per window", res.dd);
      out += ('<div class="rp-sub">' + window.DLI18N.t("61-replay.94e6115ba0be") + '</div><div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("61-replay.218197693424") + '</th><th>' + window.DLI18N.t("61-replay.f4b06ef6d3c8") + '</th><th class="r">' + window.DLI18N.t("61-replay.7a475a8b0a07") + '</th><th class="r">' + window.DLI18N.t("61-replay.6b6a05b4e39d") + '</th><th class="r">' + window.DLI18N.t("61-replay.6b27710dfaaf") + '</th><th class="r">' + window.DLI18N.t("61-replay.9aae8468ac00") + '</th><th class="r">' + window.DLI18N.t("61-replay.0f82fe727756") + '</th><th class="r">' + window.DLI18N.t("61-replay.33acd2feddcf") + '</th><th class="r">' + window.DLI18N.t("61-replay.8d13393cf84e") + '</th><th>' + window.DLI18N.t("61-replay.b78c1618fd97") + '</th></tr></thead><tbody>');
      for (i = 0; i < res.rows.length; i++) {
        var r = res.rows[i];
        if (!r.ok) { out += "<tr><td>" + esc(day(r.t0)) + "</td><td>" + esc(day(r.t1)) + '</td><td colspan="8">' + esc(r.why || "refused") + "</td></tr>"; continue; }
        out += "<tr><td>" + esc(day(r.t0)) + "</td><td>" + esc(day(r.t1)) + '</td><td class="r">' + num(r.er) + '</td><td class="r">' + pct(r.rvGK * 100, 0) +
          '</td><td class="r">' + sgn(r.ret) + '</td><td class="r">' + sgn(r.bh) + '</td><td class="r rp-edge">' + sgn(r.edge) + '</td><td class="r">' + pct(r.dd) +
          '</td><td class="r">' + r.trades + "</td><td>" + (r.law && r.law.ok ? esc(r.law.fills + " fills audited") : "refused") + "</td></tr>";
      }
      out += "</tbody></table></div>";
      var pr = lawProof();
      out += ('<div class="rp-legend"><b>' + window.DLI18N.t("61-replay.761ab96788b8") + '</b>' + window.DLI18N.t("61-replay.4b05cc88c080") + '') +
        esc(pr.note) + " Each run is audited afterwards: a fill must land on a bar strictly after the one the decision was made on, inside that bar's own high-low range, and a market fill must pay that bar's open exactly. " +
        (pr.ok ? "The engine in this build passes the constructed check." : "THE ENGINE IN THIS BUILD FAILED THE CHECK: " + esc(pr.why) + " — nothing above should be trusted.") +
        (window.DLI18N.t("61-replay.17dd08b2084c") + "</div>");
      return out;
    });
    return h;
  }

  function distTable(title, d) {
    if (!d) return "";
    return '<div class="rp-sub">' + esc(title) + ('</div><div class="dl-tblw"><table class="dl-tbl rp-dist"><thead><tr><th class="r">' + window.DLI18N.t("61-replay.d598026a9cbc") + '</th><th class="r">' + window.DLI18N.t("61-replay.0d7bf19de564") + '</th><th class="r">' + window.DLI18N.t("61-replay.32d833f348ce") + '</th><th class="r">' + window.DLI18N.t("61-replay.daab7c435134") + '</th><th class="r">' + window.DLI18N.t("61-replay.9fc58f1abf0d") + '</th><th class="r">' + window.DLI18N.t("61-replay.c47d21c643c0") + '</th><th class="r">' + window.DLI18N.t("61-replay.05cafbe33209") + '</th><th class="r">' + window.DLI18N.t("61-replay.2feb9441ea15") + '</th></tr></thead><tbody><tr>') +
      '<td class="r">' + d.n + '</td><td class="r">' + sgn(d.worst) + '</td><td class="r">' + sgn(d.q1) + '</td><td class="r rp-edge">' + sgn(d.median) + '</td><td class="r">' + sgn(d.q3) + '</td><td class="r">' + sgn(d.best) +
      '</td><td class="r">' + num(d.iqr, 2) + '</td><td class="r">' + (d.posShare == null ? "—" : Math.round(d.posShare * 100) + "%") + "</td></tr></tbody></table></div>";
  }

  function paneScenario() {
    var s = cfgState(), sh = s.shocks || DEFAULTS.shocks, h = "";
    h += ('<div class="rp-note">' + window.DLI18N.t("61-replay.84539dd52581") + '<b>') + esc(SHOCK_ORDER.join(" → ")) + ("</b>" + window.DLI18N.t("61-replay.4d55dcdfa240") + "</div>");
    h += '<div class="rp-shocks">';
    h += shockRow("vol", "Volatility regime", "multiplier on the return series, mean preserved", '<input id="rpVolM" class="dl-inp" type="number" step="0.1" min="0.1" value="' + esc(sh.vol.mult) + '" aria-label="Volatility multiplier">', sh.vol.on);
    h += shockRow("gap", "Overnight gap", "every bar from here on is multiplied by (1+g); a stop inside the gap fills at the open", '<input id="rpGapP" class="dl-inp" type="number" step="0.01" value="' + esc(sh.gap.pct) + '" aria-label="Gap size as a fraction">', sh.gap.on);
    h += shockRow("depeg", "Stablecoin depeg", "the QUOTE asset moves: the price quoted in it becomes p ÷ (1+d)", '<input id="rpDepegP" class="dl-inp" type="number" step="0.01" value="' + esc(sh.depeg.pct) + '" aria-label="Depeg as a fraction">', sh.depeg.on);
    h += shockRow("funding", "Funding flip", "rate per 8h on a carried perp of the run's own average notional", '<input id="rpFundR" class="dl-inp" type="number" step="0.0001" value="' + esc(sh.funding.rate8h) + '" aria-label="Funding rate per 8h">', sh.funding.on);
    h += shockRow("depth", "Depth collapse", "the app's depth anchor times this; every fill re-priced through the same pool math", '<input id="rpDepthM" class="dl-inp" type="number" step="0.05" min="0.01" value="' + esc(sh.depth.mult) + '" aria-label="Depth multiplier">', sh.depth.on);
    h += shockRow("cascade", "Liquidation cascade", "a trigger drop, then every leverage rung it crosses sells through the pool", '<input id="rpCascD" class="dl-inp" type="number" step="0.01" value="' + esc(sh.cascade.dropPct) + '" aria-label="Trigger drop as a fraction"><input id="rpCascOi" class="dl-inp" type="number" step="1000000" value="' + esc(sh.cascade.oiUSD) + '" aria-label="Long open interest in USD">', sh.cascade.on);
    h += "</div>";
    h += ('<div class="rp-actions"><button class="go" id="rpScen" type="button">' + window.DLI18N.t("61-replay.403f8004e44d") + '</button></div>');
    h += loadingOr(function () {
      var set = regimeSet();
      if (!set) return ('<div class="rp-empty">' + window.DLI18N.t("61-replay.39337ce503a8") + '</div>');
      var r = RUN.scenario;
      if (!r) return ('<div class="rp-empty">' + window.DLI18N.t("61-replay.7b6bba37a813") + '</div>');
      if (!r.ok) return '<div class="rp-empty">' + esc(r.why) + "</div>";
      var out = "";
      out += ('<div class="rp-head"><span class="rp-pair">' + window.DLI18N.t("61-replay.27bde8b1cd0d") + '') + esc(r.seedHex) + '</span><span class="rp-mid">' + esc(r.key) + "</span></div>";
      out += ('<div class="rp-note">' + window.DLI18N.t("61-replay.a8313a79441a") + '</div>');
      out += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("61-replay.de838855e4a6") + '</th><th>' + window.DLI18N.t("61-replay.dd066ec1bf1d") + '</th><th class="r">' + window.DLI18N.t("61-replay.6a64c9e2c3d8") + '</th><th class="r">' + window.DLI18N.t("61-replay.023f2ca37ae4") + '</th><th class="r">' + window.DLI18N.t("61-replay.13758a65cfcc") + '</th><th class="r">' + window.DLI18N.t("61-replay.7452f05d5d48") + '</th><th class="r">' + window.DLI18N.t("61-replay.e93df741ad32") + '</th><th class="r">' + window.DLI18N.t("61-replay.d1f23f0d1361") + '</th><th class="r">' + window.DLI18N.t("61-replay.9527fb2b3d5c") + '</th></tr></thead><tbody>');
      out += ('<tr><td>' + window.DLI18N.t("61-replay.2bc40a26d6f3") + '</td><td>—</td><td class="r">') + sgn(r.base.pct) + '</td><td class="r">—</td><td class="r">—</td><td class="r">' + sgn(r.base.realPct) + '</td><td class="r">' + usd(r.base.costs.funding) + '</td><td class="r">' + usd(r.base.costs.impact) + '</td><td class="r">' + usd(r.base.costs.cascade) + "</td></tr>";
      var i;
      for (i = 0; i < r.stages.length; i++) {
        var st = r.stages[i];
        out += "<tr><td>" + esc(st.key) + "</td><td>" + esc(paramOf(st.key, st.shock)) + '</td><td class="r">' + sgn(st.pct) + '</td><td class="r rp-edge">' + sgn(st.marginal) +
          '</td><td class="r">' + sgn(st.alone) + '</td><td class="r">' + sgn(st.realPct) + '</td><td class="r">' + usd(st.costs.funding) + '</td><td class="r">' + usd(st.costs.impact) + '</td><td class="r">' + usd(st.costs.cascade) + "</td></tr>";
      }
      out += "</tbody></table></div>";
      out += ('<div class="rp-legend"><b>' + window.DLI18N.t("61-replay.a11ff777b424") + '</b>' + window.DLI18N.t("61-replay.4ba87a98fe23") + '<b>' + window.DLI18N.t("61-replay.7452f05d5d48") + '</b>' + window.DLI18N.t("61-replay.c16a009b4eb3") + '</div>');
      out += ('<div class="rp-legend">' + window.DLI18N.t("61-replay.5214a07a1f01") + '<b>') + sgn(r.total) + ("</b>" + window.DLI18N.t("61-replay.0b8270eb9b0e")) + sgn(r.sumMarginal) + " — they are the same number by construction, because each marginal is the difference between two runs. " +
        (window.DLI18N.t("61-replay.df658c0d1764") + "<b>" + window.DLI18N.t("61-replay.facf8b54e5c0") + "</b>" + window.DLI18N.t("61-replay.5265a86fbe0b")) + sgn(r.sumAlone) + (window.DLI18N.t("61-replay.b5b5ff6e3d7a") + "<b>") + sgn(r.residual) + ("</b>" + window.DLI18N.t("61-replay.f40cfdb0ecc2") + "</div>");
      if (r.stages.length) {
        var last = r.stages[r.stages.length - 1].detail;
        if (last.cascade) {
          out += ('<div class="rp-sub">' + window.DLI18N.t("61-replay.ecb39213da33") + '') + esc(last.cascade.src) + ")</div>";
          out += ('<div class="rp-note">' + window.DLI18N.t("61-replay.dea0c40fc7ac") + '') + pct((last.cascade.trigger / last.cascade.p0 - 1) * 100, 1) + " from " + usd(last.cascade.p0) + (window.DLI18N.t("61-replay.95583ecf5431") + "</div>");
          out += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th class="r">' + window.DLI18N.t("61-replay.cd9558acfc38") + '</th><th class="r">' + window.DLI18N.t("61-replay.1c562678b176") + '</th><th>' + window.DLI18N.t("61-replay.bb25facb6d2a") + '</th><th class="r">' + window.DLI18N.t("61-replay.34f7bdbb9385") + '</th><th class="r">' + window.DLI18N.t("61-replay.a26cdf3a6e70") + '</th><th class="r">' + window.DLI18N.t("61-replay.8c62edd3c91f") + '</th></tr></thead><tbody>');
          for (i = 0; i < last.cascade.rounds.length; i++) {
            var rd = last.cascade.rounds[i];
            out += '<tr><td class="r">' + rd.round + '</td><td class="r">' + usd(rd.at) + "</td><td>" + esc(rd.levs) + '</td><td class="r">' + num(rd.qty, 4) + '</td><td class="r">' + usd(rd.usd) + '</td><td class="r">' + usd(rd.to) + "</td></tr>";
          }
          out += "</tbody></table></div>";
          out += ('<div class="rp-legend">' + window.DLI18N.t("61-replay.e9f7407aa909") + '') + pct(Math.abs((last.cascade.trigger / last.cascade.p0 - 1) * 100), 1) + ", total fall " + pct(last.cascade.totalDrop * 100, 1) +
            ", so the ladder itself added " + pct(Math.max(0, last.cascade.amplification) * 100, 1) + " on top of the shock you asked for. " +
            (last.cascade.soldOverTvl != null ? "The forced sales came to " + num(last.cascade.soldOverTvl, 2) + "x the modelled pool's whole TVL. " : "") +
            (last.cascade.noBid ? ("<b>" + window.DLI18N.t("61-replay.f7a7d1469523") + "</b>" + window.DLI18N.t("61-replay.319f0e69ca46")) + usd(last.cascade.pendingUSD) + " of positions to liquidate and the pool had nothing left to buy them with, so the desk stops rather than printing a price that is arithmetic instead of a market." : "The pool absorbed every rung the drop crossed.") + "</div>";
        }
        if (last.impact && last.impact.rows.length) {
          out += ('<div class="rp-sub">' + window.DLI18N.t("61-replay.2e021522b81a") + '') + usd(last.impact.tvlUSD) + ", depth × " + num(last.impact.depthMult, 2) + ")</div>";
          out += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th class="r">' + window.DLI18N.t("61-replay.95d64cacce0f") + '</th><th>' + window.DLI18N.t("61-replay.630ef00b7c4f") + '</th><th class="r">' + window.DLI18N.t("61-replay.1af851907331") + '</th><th class="r">' + window.DLI18N.t("61-replay.bbcbf5d6ae2b") + '</th><th class="r">' + window.DLI18N.t("61-replay.680ec273bc97") + '</th><th class="r">' + window.DLI18N.t("61-replay.d1f23f0d1361") + '</th><th class="r">' + window.DLI18N.t("61-replay.204a5eb2cd28") + '</th></tr></thead><tbody>');
          for (i = 0; i < last.impact.rows.length && i < 24; i++) {
            var ir = last.impact.rows[i];
            out += '<tr><td class="r">' + ir.bar + "</td><td>" + esc(ir.side) + '</td><td class="r">' + num(ir.qty, 4) + '</td><td class="r">' + usd(ir.px) + '</td><td class="r">' + usd(ir.avg) + '</td><td class="r">' + num(ir.bps, 1) + ('' + window.DLI18N.t("61-replay.bddaf3853bd9") + '</td><td class="r">') + usd(ir.cost) + "</td></tr>";
          }
          out += "</tbody></table></div>";
        }
      }
      return out;
    });
    return h;
  }

  function shockRow(key, name, mech, input, on) {
    return '<label class="rp-shock"><input type="checkbox" class="rp-ck" data-k="' + esc(key) + '"' + (on ? " checked" : "") + '>' +
      '<span class="rp-sn">' + esc(name) + "</span><span class=\"rp-sm\">" + esc(mech) + "</span><span class=\"rp-si\">" + input + "</span></label>";
  }

  function paneTape() {
    var s = cfgState(), h = "";
    h += ('<div class="rp-note">' + window.DLI18N.t("61-replay.3dfef2f87d16") + '<b>' + window.DLI18N.t("61-replay.d8198efa3604") + '</b>' + window.DLI18N.t("61-replay.6b74907ec087") + '<b>' + window.DLI18N.t("61-replay.c549779d79e5") + '</b>' + window.DLI18N.t("61-replay.56db74581643") + '</div>');
    h += '<div class="rp-form dl-2">';
    h += field("Position (base)", '<input id="rpQty" class="dl-inp" type="number" step="any" min="0" value="' + esc(s.fundQty) + '" aria-label="Position size in base units">');
    h += field("Side", ('<select id="rpSide" class="dl-inp" aria-label="' + window.DLI18N.t("61-replay.630ef00b7c4f") + '">') + optsKV([["long", "Long"], ["short", "Short"]], s.fundSide) + "</select>");
    h += field("Settles every", ('<select id="rpHours" class="dl-inp" aria-label="' + window.DLI18N.t("61-replay.ad9f5c3f62c7") + '">') + optsKV([[1, "1h (Hyperliquid)"], [8, "8h (most venues)"]], s.fundHours) + "</select>");
    h += field("Ladder notional (USD)", '<input id="rpNot" class="dl-inp" type="number" step="1000" min="0" value="' + esc(s.notional) + '" aria-label="Notional for the liquidation ladder">');
    h += "</div>";
    h += ('<div class="rp-actions"><button class="go" id="rpTape" type="button">' + window.DLI18N.t("61-replay.528ba381554e") + '</button></div>');
    h += loadingOr(function () {
      var set = regimeSet();
      if (!set) return ('<div class="rp-empty">' + window.DLI18N.t("61-replay.39337ce503a8") + '</div>');
      var w = set.windows[set.windows.length - 1];
      var tape = fundingTape(H.bars, w.a, w.b, H.interval, +s.fundQty, s.fundSide, +s.fundHours);
      var out = "";
      if (!tape.ok) out += '<div class="rp-empty">' + esc(tape.why) + "</div>";
      else {
        out += '<div class="rp-head"><span class="rp-pair">' + esc(H.sym) + " funding · " + esc(day(w.t0)) + " → " + esc(day(w.t1)) + '</span><span class="rp-mid">' + tape.count + " settlements · " + esc(s.fundSide) + " " + num(+s.fundQty, 4) + " · cumulative " + usd(-tape.total) + (window.DLI18N.t("61-replay.5b312bda8ab5") + "</span></div>");
        out += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("61-replay.d0b7c07a6186") + '</th><th class="r">' + window.DLI18N.t("61-replay.d7cda0ca2c85") + '</th><th class="r">' + window.DLI18N.t("61-replay.517bf6889ab7") + '</th><th class="r">' + window.DLI18N.t("61-replay.cc4b19350e9b") + '</th><th class="r">' + window.DLI18N.t("61-replay.c5ac4f893daf") + '</th><th>' + window.DLI18N.t("61-replay.641b3acc7139") + '</th><th class="r">' + window.DLI18N.t("61-replay.fb81b961af45") + '</th><th class="r">' + window.DLI18N.t("61-replay.cecf2aade089") + '</th></tr></thead><tbody>');
        var i, n = tape.rows.length, show = Math.min(n, 60), startAt = Math.max(0, n - show);
        for (i = startAt; i < n; i++) {
          var r = tape.rows[i];
          out += "<tr><td>" + esc(stamp(r.t)) + '</td><td class="r">' + usd(r.mark) + '</td><td class="r">' + sgn(r.move24, 1) + '</td><td class="r">' + bpsOf(r.rate8h) + '</td><td class="r">' + bpsOf(r.intervalRate) +
            '</td><td class="rp-arith">' + num(tape.qty, 4) + " × " + usd(r.mark) + " × " + num(r.intervalRate * 100, 5) + "% " + (tape.side === "short" ? "× −1 " : "") + '</td><td class="r">' + usd(r.pay) + '</td><td class="r">' + usd(r.cum) + "</td></tr>";
        }
        out += "</tbody></table></div>";
        if (n > show) out += '<div class="rp-note">' + (n - show) + " earlier settlements are above this window of the table; the cumulative column carries all " + n + ".</div>";
        out += ('<div class="rp-legend">' + window.DLI18N.t("61-replay.b9078c8dfae3") + '') +
          usd(tape.total) + (window.DLI18N.t("61-replay.df15a22f9564") + "</div>");
      }
      var st = statsOf(H.sym), lad = st ? liqLadder(H.sym, st.price, +s.notional, null) : { ok: false, why: "no live market for " + H.sym + ", so no ladder" };
      out += ('<div class="rp-sub">' + window.DLI18N.t("61-replay.c7a03665e0cf") + '') + (st ? usd(st.price) : "—") + " on " + usd(+s.notional) + (window.DLI18N.t("61-replay.6116f844bde1") + "</div>");
      if (!lad.ok) out += '<div class="rp-empty">' + esc(lad.why) + "</div>";
      else {
        out += ('<div class="rp-note">' + window.DLI18N.t("61-replay.9c036e990fa9") + '</div>');
        out += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th class="r">' + window.DLI18N.t("61-replay.c9968747d776") + '</th><th class="r">' + window.DLI18N.t("61-replay.2bf63d817630") + '</th><th class="r">' + window.DLI18N.t("61-replay.4489bd5ee474") + '</th><th class="r">' + window.DLI18N.t("61-replay.f4ca02e6ee95") + '</th><th class="r">' + window.DLI18N.t("61-replay.aea19c27a854") + '</th><th class="r">' + window.DLI18N.t("61-replay.b7bdf7a2d6e7") + '</th><th class="r">' + window.DLI18N.t("61-replay.fdf93497997c") + '</th></tr></thead><tbody>');
        var j;
        for (j = 0; j < lad.rows.length; j++) {
          var lr = lad.rows[j];
          out += '<tr><td class="r">' + lr.lev + ('' + window.DLI18N.t("61-replay.2d711642b726") + '</td><td class="r">') + usd(lr.margin) + '</td><td class="r">' + pct(lr.mmr * 100, 3) + '</td><td class="r">' + usd(lr.cum) +
            '</td><td class="r">' + usd(lr.liqLong) + '</td><td class="r">' + pct(lr.distLong, 1) + '</td><td class="r">' + usd(lr.liqShort) + "</td></tr>";
        }
        out += "</tbody></table></div>";
      }
      return out;
    });
    return h;
  }

  function paneMethod() {
    var h = ('<div class="rp-note">' + window.DLI18N.t("61-replay.c47051ebefdc") + '</div>');
    var i;
    h += '<div class="rp-method">';
    for (i = 0; i < METHOD.length; i++) h += '<div class="rp-mrow"><b>' + esc(METHOD[i][0]) + "</b><span>" + esc(METHOD[i][1]) + "</span></div>";
    h += "</div>";
    h += ('<div class="rp-sub">' + window.DLI18N.t("61-replay.72575be9ba5c") + '</div><ul class="rp-assume">');
    for (i = 0; i < ASSUMPTIONS.length; i++) h += "<li>" + esc(ASSUMPTIONS[i]) + "</li>";
    h += "</ul>";
    var pr = lawProof();
    h += ('<div class="rp-legend"><b>' + window.DLI18N.t("61-replay.0d11def94a31") + '</b> ') + esc(pr.note) + " " +
      (pr.ok ? "The engine passes the constructed check in this build." : "THE ENGINE FAILED: " + esc(pr.why)) + "</div>";
    return h;
  }

  function field(label, inner) { return '<label class="rp-f"><span class="rp-fl">' + esc(label) + "</span>" + inner + "</label>"; }
  function opts(list, cur) {
    var h = "", i;
    for (i = 0; i < list.length; i++) h += '<option value="' + esc(list[i]) + '"' + (String(cur) === String(list[i]) ? " selected" : "") + ">" + esc(list[i]) + "</option>";
    return h;
  }
  function optsKV(list, cur) {
    var h = "", i;
    for (i = 0; i < list.length; i++) h += '<option value="' + esc(list[i][0]) + '"' + (String(cur) === String(list[i][0]) ? " selected" : "") + ">" + esc(list[i][1]) + "</option>";
    return h;
  }

  /* ------------------------------------------------------------- wiring */

  function val(id, dflt) {
    var el = document.getElementById(id);
    if (!el) return dflt;
    return el.value;
  }
  function readHead() {
    return {
      sym: String(val("rpSym", "BTC") || "BTC").toUpperCase().replace(/[^A-Z0-9]/g, ""),
      interval: ivOf(val("rpIv", "1d")),
      years: +val("rpYears", 6) || 6,
      win: +val("rpWin", WIN) || WIN
    };
  }
  function readShocks() {
    var s = cfgState(), sh = merge(s.shocks || DEFAULTS.shocks, {}), cks = document.querySelectorAll(".rp-ck"), i, k;
    for (i = 0; i < cks.length; i++) {
      k = cks[i].getAttribute("data-k");
      if (!sh[k]) continue;
      sh[k] = merge(sh[k], { on: !!cks[i].checked });
    }
    sh.vol = merge(sh.vol, { mult: +val("rpVolM", sh.vol.mult) });
    sh.gap = merge(sh.gap, { pct: +val("rpGapP", sh.gap.pct) });
    sh.depeg = merge(sh.depeg, { pct: +val("rpDepegP", sh.depeg.pct) });
    sh.funding = merge(sh.funding, { rate8h: +val("rpFundR", sh.funding.rate8h) });
    sh.depth = merge(sh.depth, { mult: +val("rpDepthM", sh.depth.mult) });
    sh.cascade = merge(sh.cascade, { dropPct: +val("rpCascD", sh.cascade.dropPct), oiUSD: +val("rpCascOi", sh.cascade.oiUSD) });
    return sh;
  }

  function onClick(ev) {
    var tgt = ev.target, id = tgt && tgt.id;
    if (tgt && tgt.getAttribute && tgt.getAttribute("data-rg")) {
      cfgState({ regime: tgt.getAttribute("data-rg") });
      RUN.window = null;
      open("window");
      return;
    }
    if (id === "rpMeasure") { cfgState(readHead()); RUN.window = null; RUN.scenario = null; ensure(true); return; }
    if (id === "rpRun") {
      cfgState({ strat: val("rpStrat", "sma"), regime: String(val("rpRg", "") || "").trim() || cfgState().regime });
      RUN.window = null; paint(); return;
    }
    if (id === "rpScen") {
      var s = cfgState({ shocks: readShocks() });
      var set = regimeSet();
      if (!set) { paint(); return; }
      var w = set.windows[set.windows.length - 1];
      RUN.scenario = scenario(H.bars, w.a, w.b, H.interval, s.strat, { fee: null }, s.shocks, H.sym);
      paint(); return;
    }
    if (id === "rpTape") {
      cfgState({ fundQty: +val("rpQty", 1) || 1, fundSide: val("rpSide", "long"), fundHours: +val("rpHours", 8) || 8, notional: +val("rpNot", 50000) || 50000 });
      paint(); return;
    }
  }

  var wired = false;
  function wire(el) {
    if (!el || wired) return;
    el.addEventListener("click", onClick);
    wired = true;
    el.__onClose = function () {
      try { el.removeEventListener("click", onClick); } catch (e) {}
      wired = false; VIEW.body = null; VIEW.gen++;
    };
  }

  function open(tab) {
    var el = null;
    try {
      el = C.open("dlReplay", {
        title: window.DLI18N.t("61-replay.83eaa682123d"),
        sub: window.DLI18N.t("61-replay.77c12187e024"),
        tabs: [["regimes", "Regimes"], ["window", "Window"], ["scenario", "Scenario"], ["tape", "Tape"], ["method", "Method"]],
        onTab: bodyFor
      }, tab || "regimes");
    } catch (e) { el = null; }
    try { wire(el || document.getElementById("dlReplay")); } catch (e) {}
    try { if (!H.bars && !H.loading) ensure(false); } catch (e) {}
    return el;
  }

  try { if (window.DLDESKS && window.DLDESKS.register) window.DLDESKS.register("replay", "⟲", "Replay", "measure regimes, replay every window that matches, compose shocks", function () { open("regimes"); }); } catch (e) {}
  try { C.cmd && C.cmd("Replay", "Replay — multi-regime historical replay and scenario builder", "⟲", function () { open("regimes"); }); } catch (e) {}

  window.DLREPLAY = {
    __v: 166,
    open: open,
    history: history,
    features: features,
    regimes: regimes,
    efficiencyRatio: efficiencyRatio,
    rSquared: rSquared,
    realisedVolCC: realisedVolCC,
    realisedVolGK: realisedVolGK,
    realisedVolPK: realisedVolPK,
    drawdownAt: drawdownAt,
    terciles: terciles,
    labelOf: labelOf,
    replayWindow: replayWindow,
    replayRegime: replayRegime,
    distribution: distribution,
    lawProof: lawProof,
    lawAudit: lawAudit,
    shockVol: shockVol,
    shockGap: shockGap,
    shockDepeg: shockDepeg,
    scenario: scenario,
    cascade: cascade,
    fundingTape: fundingTape,
    liqLadder: liqLadder,
    hash32: hash32,
    seedOf: seedOf,
    STRATS: STRATS,
    SHOCK_ORDER: SHOCK_ORDER,
    BOOKMARKS: BOOKMARKS,
    METHOD: METHOD,
    ASSUMPTIONS: ASSUMPTIONS
  };
})();
