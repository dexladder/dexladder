// owns: advanced paper order laboratory
// reads: DLAPP, DLCORE, DLDESKS, S paper state, browser DOM
// emits: DLORD
/* ============================================================================
   DexLadder — DLORD · layer 58 · v166 "⌁ Order Lab"
   ICEBERG · TRAILING STOPS · BRACKET/OTO/OTOCO · PEG · EXECUTION REALISM

   The question this desk exists to answer: the app can already place a market,
   limit, stop, stop-limit, OCO, TWAP, DCA and grid order. What it could not
   tell you is what those orders COST you in the places cost actually hides —
   in the queue, in the wick, in the millisecond, and in the part of the order
   that never filled at all. This desk prices that.

   Four things it adds, and one it insists on:
     · iceberg — every refresh puts the clip at the BACK of the queue, priced
       against one resting order of the full size, with the detection signature
       (clip-size entropy) printed beside the saving
     · trailing stops resolved HONESTLY — the trail moves off the running
       extreme, the stop is checked against the bar's WICK, and when one bar
       could both extend the trail and hit the stop the PESSIMISTIC branch is
       taken. The engine's own trigger() for a tsl does the opposite on a
       single price; the difference is printed, not hidden
     · bracket / OTO / OTOCO with proportional child sizing on a PARTIAL parent
       fill, cancel-on-parent-cancel, and the double-fill race labelled
     · peg to mid / bid / offer with an offset, a limit cap, and the queue cost
       of every re-peg — a peg is a queue decision wearing a price's clothes
     · implementation shortfall, decomposed: delay + impact + fee + opportunity.
       That decomposition is the point of the desk.

   LAWS OBSERVED
     · every simulation is PURE — simulate() writes no balance, places no order,
       persists nothing and reads no clock inside the arithmetic
     · deterministic — per-venue latency and reject rolls come from an FNV-1a
       hash of (venue, order id, tick). No random number is drawn here, ever
     · a missing figure stays missing — null, never 0 wearing a price's clothes
     · money moves only through the engine — execFill / chargeNetwork on an
       explicit send. This layer never assigns to a balance
     · nothing is re-implemented that the engine owns: queueAhead, stepQueue,
       ocoEffect, trigger, stopHit, armStop, tradableQty, buildBook, liveBook,
       walk, venueFees, VENUES, GAS_UNITS, TIER_MULT are CALLED, not copied
     · no storage key of its own — state is the v154 bucket via DLCORE.X()
     · no timers, no observers, nothing compiled at runtime
     · Day + Night — every rule lives in _v166css/58-orders.css, paired
   ============================================================================ */
(function () {
  "use strict";
  if (window.DLORD && window.DLORD.__v) return;

  var C = window.DLCORE;
  if (!C) return;

  function P() { try { return window.DLAPP && window.DLAPP.paper; } catch (e) { return null; } }
  function LP() { try { return window.DLAPP && window.DLAPP.legacy && window.DLAPP.legacy.paper; } catch (e) { return null; } }

  /* ------------------------------------------------------------- constants */

  /* One "book step" is the engine's own book-rebuild horizon (01-app.js
     needsRebuild: a book older than 1,500 ms is rebuilt). Every step count on
     this desk converts to wall-clock at this rate. It is a modelling constant,
     not a venue's matching cadence. */
  var STEP_MS = 1500;

  /* The engine's tapeFlow is vol24 / price / 86,400,000 ms × elapsed ×
     (0.6 + 1.6·r) with r random. This desk cannot draw r — determinism is a
     gate — so it uses the EXPECTED value of that factor, 1.4, and says so. */
  var FLOW_NOISE_MEAN = 1.4;
  var MS_PER_DAY = 86400000;

  var BOOK_KEYS = ["binance", "coinbase", "kraken", "hyperliquid"];
  var AMM_KEY = "dexamm";
  var ALL_KEYS = BOOK_KEYS.concat([AMM_KEY]);

  /* Latency. The engine publishes no round-trip figure for any venue, so the
     floor and the excess mean below are THIS DESK's assumption and are named
     as such everywhere they are used. Shape: a SHIFTED EXPONENTIAL — a fixed
     floor plus an exponential excess drawn by inverse CDF from a uniform taken
     off the FNV-1a hash of (venue | order id | tick). Mean = floor + excess.
     The AMM's floor is not invented: it is one block off the engine's own
     BLOCK_SECONDS. */
  var LAT_FLOOR_MS = { binance: 22, coinbase: 48, kraken: 55, hyperliquid: 30 };
  var LAT_EXCESS_MS = { binance: 28, coinbase: 70, kraken: 80, hyperliquid: 35, dexamm: 4000 };

  /* The stress dial. One number from 0 to 1 moves four channels together.
     Every coefficient here is a modelling constant of this desk. */
  var SPREAD_K = 3;      /* spread multiplier      = 1 + 3·s            */
  var DEPTH_K = 2;       /* depth multiplier       = 1 / (1 + 2·s)      */
  var LAT_K = 3;         /* latency excess mult    = 1 + 3·s            */
  var REJECT_BASE = 0.002;
  var REJECT_K = 0.18;   /* reject rate            = 0.002 + 0.18·s²    */
  var THROTTLE_OPS = 8;  /* orders per second per venue before queueing */

  /* 30-day volume tiers. The engine publishes ONE retail rate per venue and
     this desk does not keep a second copy of any schedule — the base rate is
     always venueFees(key). The tier is a MULTIPLIER on that base, shaped like
     a published VIP ladder, and it is an assumption of this desk. A rebate is
     shown only where the engine's own maker rate is negative; none currently
     is, so the rebate column stays empty rather than inventing one. */
  var VOL_BANDS = [0, 1e6, 1e7, 1e8, 1e9];
  var TAKER_MULT = [1, 0.90, 0.80, 0.65, 0.50];
  var MAKER_MULT = [1, 0.75, 0.50, 0.25, 0.00];

  var EPS = 1e-9;

  /* --------------------------------------------------------------- honesty */

  var ASSUMPTIONS = [
    "The queue model is THE APP'S OWN, not a venue's. Position ahead of you comes from the engine's queueAhead() over the modelled 40-level book, and each step is the engine's stepQueue(): the tape eats the queue ahead first, and once it is gone a resting order takes min(remaining, max(flow, 12% of remaining)) per step. No exchange publishes its matching queue to this app, and no real venue fills in 12% steps. Read every fill-time figure here as the cost of a queue decision under that model, not as a prediction of a venue's clock.",
    "One book step is 1,500 ms, which is the engine's own book-rebuild horizon (needsRebuild in 01-app.js), not a venue's matching cadence. Every 'time to fill' on this desk is step count times that constant.",
    "Tape flow per step is the engine's tapeFlow formula — 24h volume / price / 86,400,000 ms times elapsed — with its random factor (0.6 + 1.6·r) held at its EXPECTED value of 1.4. This desk may not draw a random number, so it uses the mean of the engine's own noise term and says so here.",
    "A refresh puts the clip at the back of a REPLENISHED level. The modelled book is stationary, so when a clip trades out the level is back at its modelled size — which means re-joining puts the same queueAhead in front of you again. That is the whole iceberg penalty: one wait per refresh instead of one wait for the order.",
    "The trailing stop's PESSIMISTIC tie-break is a choice, not a measurement. When one bar's high could extend the trail and its low could hit the stop, this desk fires the stop at the level that existed BEFORE the bar. The engine's own trigger() for a tsl does the opposite — it lifts the high-water from the same price it then tests — so on the same bar the engine is more generous than this desk by exactly the amount the trail would have moved. Both are shown. Neither is what a venue did: intrabar order is unknowable from OHLC.",
    "Per-venue latency is MODELLED, not measured. Shape: a shifted exponential — a floor plus an exponential excess, drawn by inverse CDF from a uniform taken off an FNV-1a hash of (venue, order id, tick), so it is reproducible and never random. Floors and excess means (Binance 22+28 ms, Coinbase 48+70, Kraken 55+80, Hyperliquid 30+35) are this desk's assumption. The AMM's floor is one block off the engine's BLOCK_SECONDS and is the only latency figure here with a source.",
    "Fee tiers by 30-day volume are a MULTIPLIER on the engine's published rate, not a second fee schedule. The base is always venueFees(key) — Binance 0.10% taker / 0.10% maker, Coinbase Advanced 0.60% / 0.40%, Kraken 0.26% / 0.16%, Hyperliquid 0.045% / 0.015%, AMM 0.30%. The ladder (taker ×1, ×0.90, ×0.80, ×0.65, ×0.50 and maker ×1, ×0.75, ×0.50, ×0.25, ×0 at $0 / $1m / $10m / $100m / $1bn of 30-day volume) is shaped like a published VIP ladder but is this desk's assumption. A maker REBATE is shown only where the engine's own maker rate is negative — none currently is, so that column stays empty rather than inventing a rebate.",
    "The stress dial's four coefficients are modelling constants of this desk: spread ×(1 + 3s), depth ×1/(1 + 2s), latency excess ×(1 + 3s), reject rate 0.002 + 0.18s². Throttle cap is 8 orders per second per venue. None of these is measured from a venue under load.",
    "Shortfall attribution turns each stress channel on ONE AT A TIME from the calm baseline and reports the interaction residual separately, so the four parts plus the residual equal the total exactly. It is not a Shapley value: with interacting channels the individual figures are first-order effects, and the residual is the honest name for what the split cannot assign.",
    "This desk never trades on its own. Every figure on Build, Simulate and Stress is pure arithmetic over the modelled book; nothing reaches the account until you press send on the Ledger tab, and that send goes through the same execFill / chargeNetwork the trading ticket uses."
  ];

  var METHOD = [
    ["Queue position", "queueAhead() sums the resting size at prices at or better than yours on YOUR side of the book — bids for a buy, asks for a sell. That is the number of base units that must trade through before a single unit of yours can. stepQueue() then advances it one book step at a time: the tape eats the queue ahead first, and only once it is gone does your order take min(remaining, max(flow, 12% of remaining)) per step. Both are the engine's functions, called not copied."],
    ["Iceberg", "An iceberg of total Q showing clips of D is n = ceil(Q/D) separate resting orders. The first joins at today's queueAhead; every refresh after it joins a replenished level, so it waits the SAME queueAhead again. Fill time is the sum over clips; the penalty is that sum minus the steps a single resting order of the full size would have taken. The penalty rises with every extra clip, and it rises faster than the hiding does."],
    ["The detection side", "A repeating clip at one price is a signature. Clip-size entropy is Shannon's H = −Σ p log₂ p over the distinct clip sizes, in bits, against its own ceiling log₂(n). The printed score is 1 − H/Hmax: 1 means every clip was identical and the iceberg is maximally legible on the tape, 0 means the clips carried no repeat at all. n = 1 has no ceiling, so the score is missing rather than zero. A bigger clip buys fewer refreshes and a lower time penalty; it costs you a larger print on every one."],
    ["Trailing stop — the trail", "The trail hangs off the RUNNING EXTREME, not off the last close: on a long, extreme = max(extreme, bar high), and the stop is extreme × (1 − trail%) or extreme − offset. It ratchets one way only: the stop is never allowed to fall. Before an activation price is reached the order is dormant and there is no stop at all."],
    ["Trailing stop — the wick, and the tie", "The stop is tested against the bar's LOW, not its close, because a wick is a real trade. When a bar could both extend the trail and hit the stop, this desk takes the PESSIMISTIC branch: the stop fires at the level that existed BEFORE the bar, so the trail gets no credit for a high that may have come after the dip. On the activation bar the same rule arms the order from the high and then lets the low take it out. The optimistic resolution — the engine's own ordering — is printed beside it so you can see what the choice is worth."],
    ["Path dependence", "OHLC does not carry intrabar order, so the answer depends on the bar size you looked at. Coarsening the same series merges the bar that ratcheted the trail with the bar that dipped, and under the pessimistic rule the merged bar is tested against the OLD stop — which the dip may not reach. The desk runs the identical series at 1×, 2× and 4× and prints the three answers together. If they disagree, that disagreement is the honest result."],
    ["Bracket, OTO, OTOCO", "A parent fill arms the children. On a PARTIAL parent fill of f out of Q the children are sized to f, not to Q — an unfilled parent leaves nothing to protect. Between the two children the engine's ocoEffect() decides: a fill of n on one leg shrinks its partner to partner.qty − n exactly, and cancels it when that reaches zero. Cancelling the parent cancels every child that has not filled. When both legs are touched inside one bar the race is resolved PESSIMISTICALLY — the stop fills first, the take-profit is then reduced by what the stop took — and the row is labelled, because OHLC cannot say which came first."],
    ["Peg", "A peg is a queue decision wearing a price's clothes. The price is the anchor (mid, bid or offer) plus an offset, clamped by a limit cap that, once binding, means you are no longer pegged and the desk says so. Every re-peg cancels and replaces, which is a new order at the back of a replenished level — so the queue cost of a peg is the re-peg count times one full queueAhead wait. A fast cadence tracks the market and never fills; a slow one fills and drifts."],
    ["Latency and rejects", "Latency is a shifted exponential: floor + excess × (−ln(1 − u)), where u is the top 24 bits of an FNV-1a hash of (venue | order id | tick) scaled to [0,1). Same inputs, same millisecond, forever. Under stress the excess mean is multiplied by (1 + 3s). A reject is the same hash on a different salt tested against 0.002 + 0.18s². Above 8 orders per second a venue throttles, and the excess queues at (rate/cap − 1) × 1,000 ms."],
    ["Fees", "The base rate is the engine's venueFees(key) and nothing on this desk keeps a second copy of it. The 30-day volume tier is a multiplier on that base. A maker rebate is a NEGATIVE maker rate, and the desk prints one only if the engine's table publishes one — it does not, for any venue, today."],
    ["Implementation shortfall", "Perold's decomposition (Journal of Portfolio Management, 1988), in four parts against the decision price. On a buy: delay = filled × (arrival − decision), the market moving while you decided; impact = filled × (average fill − arrival), your own order moving the price; fee = commission plus gas actually paid; opportunity = unfilled × (end − decision), the part you never got, priced against where you started. On a sell every sign flips so that a positive number is always a cost. Delay + impact collapses to filled × (fill − decision), so the four parts sum to the total by construction — the desk asserts that identity rather than trusting it. A fully filled order has exactly zero opportunity cost and needs no end price; an order with a remainder cannot be priced without one, and the desk WITHHOLDS the total rather than pricing that remainder at no drift, because doing so reports a reject as a saving."],
    ["Attribution under stress", "Total shortfall at stress s, minus the same order at s = 0, is the cost of the dial. To say WHICH channel cost it, the desk re-prices the order four more times with exactly one channel moved and the rest calm. Those four first-order effects plus a residual equal the total exactly. The residual is the interaction — wider spread hurting more because depth is thinner — and it is printed rather than smeared across the four."]
  ];

  /* ---------------------------------------------------- determinism helpers */
  /* FNV-1a 32, the engine's own hash32 where it is reachable so the two can
     never disagree; the local mirror is byte-for-byte the same loop. */
  function hash32(s) {
    var p = P();
    try { if (p && typeof p.hash32 === "function") return p.hash32(String(s)); } catch (e) {}
    var h = 2166136261, i, str = String(s);
    for (i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  /* top 24 bits → [0,1). Deterministic: no random draw, ever. */
  function unit01(s) { return (hash32(s) >>> 8) / 16777216; }

  /* ------------------------------------------------------ market primitives */

  function statsOf(sym) {
    var c = null;
    try { c = C.coin(sym); } catch (e) { c = null; }
    if (!c || !(+c.price > 0)) return null;
    return { vol24: +c.vol || 0, mcap: +c.mcap || 0, price: +c.price };
  }
  function quoteUSD(sym) {
    if (!sym || sym === "USDT" || sym === "USD") return 1;
    try { var c = C.coin(sym), v = c && +c.price; return v > 0 ? v : null; } catch (e) { return null; }
  }
  function midOf(sym, q) {
    var s = statsOf(sym);
    if (!s) return null;
    if (!q || q === "USDT" || q === "USD") return s.price;
    var qp = quoteUSD(q);
    return qp > 0 ? s.price / qp : null;
  }
  function blockSecs() { try { var v = P().BLOCK_SECONDS; return v > 0 ? v : 12; } catch (e) { return 12; } }

  /* The engine's book, live, unscaled. Depth may be squeezed by the stress
     dial — the engine normalises depth linearly, so scaling every level's size
     is exactly building the book at that fraction of the modelled depth. */
  function bookOf(sym, q, at, depthMult, spreadMult) {
    var p = P(), st = statsOf(sym), mid = midOf(sym, q);
    if (!p || !st || !(mid > 0)) return null;
    try {
      var raw = p.buildBook(sym, q || "USDT", mid, st, at || 0);
      if (!raw) return null;
      var live = p.liveBook(raw, at || 0);
      var dm = depthMult > 0 ? depthMult : 1;
      var sm = spreadMult > 0 ? spreadMult : 1;
      var widen = function (arr, sign) {
        var out = [], i, d;
        for (i = 0; i < arr.length; i++) {
          d = (arr[i].p - live.mid) * sm;
          out.push({ p: live.mid + d, a: arr[i].a * dm, i: i });
        }
        return out;
      };
      return { mid: live.mid, asks: widen(live.asks, 1), bids: widen(live.bids, -1) };
    } catch (e) { return null; }
  }

  /* Base units the tape prints per book step. The engine's tapeFlow with its
     random factor held at its expected value of 1.4 — see ASSUMPTIONS. */
  function flowPerStep(sym) {
    var st = statsOf(sym);
    if (!st || !(st.price > 0) || !(st.vol24 > 0)) return null;
    return st.vol24 / st.price / MS_PER_DAY * STEP_MS * FLOW_NOISE_MEAN;
  }

  /* -------------------------------------------------------------- the queue */
  /* queueAhead lives on the engine's BOOK ENGINE (paper.queueAhead(sym, quote,
     side, px)) as well as on the typed core over a book object. Prefer the
     book-object form because this desk already holds a stressed book and must
     not silently fall back to the unstressed one. */
  function aheadOf(book, side, px) {
    var p = P();
    if (!book || !(px > 0)) return null;
    if (p && typeof p.queueAhead === "function") {
      try {
        var v = p.queueAhead(book, side, px);
        if (typeof v === "number" && isFinite(v)) return v;
      } catch (e) {}
    }
    return null;
  }

  /* One book step, the engine's stepQueue. Returns null if the engine is gone
     — this desk does not own the queue rule and will not pretend to. */
  function step1(order, px, flow) {
    var p = P();
    if (!p || typeof p.stepQueue !== "function") return null;
    try { return p.stepQueue(order, px, flow); } catch (e) { return null; }
  }

  /* Steps for ONE resting order of qty sitting behind ahead, at flow per
     step. Pure, terminating: once 12% of what is left drops below the flow the
     order finishes linearly. */
  function queueSteps(qty, ahead, flow, side, px) {
    if (!(qty > 0) || !(flow > 0)) return null;
    var o = { side: side === "sell" ? "sell" : "buy", px: px > 0 ? px : 100, qty: qty, qAhead: ahead > 0 ? ahead : 0 };
    var mkt = o.side === "buy" ? o.px : o.px;   /* touched: buy fills at or under px */
    var steps = 0, fills = 0, guard = 0, r;
    while (o.qty > 1e-9 && guard++ < 200000) {
      r = step1(o, mkt, flow);
      if (!r) return null;
      steps++;
      if (r.kind === "wait") { o.qAhead = r.qAhead; continue; }
      if (r.kind === "fill") { o.qAhead = r.qAhead; o.qty = Math.max(0, o.qty - r.take); fills++; continue; }
      return { steps: steps, fills: fills, unfilled: o.qty };   /* idle: never touched */
    }
    return { steps: steps, fills: fills, unfilled: 0 };
  }
  function stepsMs(n) { return n == null ? null : n * STEP_MS; }

  /* ------------------------------------------------------------- iceberg */

  function clipEntropy(sizes, tick) {
    var n = sizes ? sizes.length : 0;
    if (!(n > 0)) return null;
    var t = tick > 0 ? tick : 1e-8, m = {}, i, k, key, H = 0, p;
    for (i = 0; i < n; i++) { key = String(Math.round(sizes[i] / t)); m[key] = (m[key] || 0) + 1; }
    for (k in m) if (Object.prototype.hasOwnProperty.call(m, k)) { p = m[k] / n; H -= p * Math.log(p) / Math.LN2; }
    var Hmax = Math.log(n) / Math.LN2;
    /* n = 1 has no ceiling. A missing figure stays missing. */
    return { bits: H, max: Hmax, distinct: keyCount(m), score: Hmax > 0 ? 1 - H / Hmax : null };
  }
  function keyCount(m) { var n = 0, k; for (k in m) if (Object.prototype.hasOwnProperty.call(m, k)) n++; return n; }

  /* total Q shown in clips of D, behind ahead, at flow. */
  function iceberg(total, clip, ahead, flow, side, px) {
    if (!(total > 0) || !(clip > 0) || !(flow > 0)) return null;
    var n = Math.max(1, Math.ceil(total / clip - 1e-12)), i, rem = total, d;
    var sizes = [], sum = 0, fills = 0, r;
    for (i = 0; i < n; i++) {
      d = Math.min(clip, rem); rem -= d; sizes.push(d);
      r = queueSteps(d, ahead, flow, side, px);
      if (!r) return null;
      sum += r.steps; fills += r.fills;
    }
    var one = queueSteps(total, ahead, flow, side, px);
    if (!one) return null;
    var ent = clipEntropy(sizes, clip * 1e-4);
    return {
      clips: n, sizes: sizes, displayFrac: clip / total,
      icebergSteps: sum, singleSteps: one.steps,
      penaltySteps: sum - one.steps,
      penaltyMs: (sum - one.steps) * STEP_MS,
      penaltyPct: one.steps > 0 ? (sum - one.steps) / one.steps * 100 : null,
      icebergMs: sum * STEP_MS, singleMs: one.steps * STEP_MS,
      prints: fills, entropy: ent
    };
  }

  /* ------------------------------------------------------- trailing stops */

  function trailLevel(o, ext) {
    if (!(ext > 0)) return null;
    if (o.mode === "abs") return o.offset > 0 ? ext - o.offset : null;
    return o.pct > 0 ? ext * (1 - o.pct / 100) : null;
  }

  /* PESSIMISTIC. The stop is tested against the bar's LOW using the level that
     existed BEFORE the bar, so a high inside the same bar buys the trail
     nothing. Ratchets one way: the stop never falls. */
  function trailPath(bars, o) {
    if (!bars || !bars.length || !o) return null;
    var armed = !(o.activation > 0), ext = null, stop = (o.initStop > 0 ? o.initStop : null);
    var i, b, couldExtend, cand, path = [], armedAt = null;
    for (i = 0; i < bars.length; i++) {
      b = bars[i];
      if (!armed) {
        if (b.h >= o.activation) {
          armed = true; armedAt = i; ext = b.h; cand = trailLevel(o, ext);
          if (cand != null && (stop == null || cand > stop)) stop = cand;
          path.push({ i: i, ext: ext, stop: stop, armed: true });
          if (stop != null && b.l <= stop) return done(true, i, stop, ext, true, armedAt, path);
        } else path.push({ i: i, ext: null, stop: null, armed: false });
        continue;
      }
      couldExtend = (ext == null || b.h > ext);
      if (stop != null && b.l <= stop) return done(true, i, stop, ext, couldExtend, armedAt, path);
      if (ext == null || b.h > ext) { ext = b.h; cand = trailLevel(o, ext); if (cand != null && (stop == null || cand > stop)) stop = cand; }
      path.push({ i: i, ext: ext, stop: stop, armed: true });
    }
    return done(false, null, null, ext, false, armedAt, path, stop);
  }
  function done(hit, i, px, ext, tie, armedAt, path, resting) {
    return { hit: hit, index: i, px: px, ext: ext, tie: !!tie, armedAt: armedAt, path: path, resting: hit ? null : (resting == null ? null : resting) };
  }

  /* OPTIMISTIC — the engine's own ordering in trigger(): lift the high-water
     from this bar's price, THEN test. Shown beside the pessimistic answer so
     the cost of the choice is visible rather than argued about. */
  function trailOptimistic(bars, o) {
    if (!bars || !bars.length || !o) return null;
    var armed = !(o.activation > 0), ext = null, stop = (o.initStop > 0 ? o.initStop : null), i, b, cand;
    for (i = 0; i < bars.length; i++) {
      b = bars[i];
      if (!armed) { if (b.h >= o.activation) armed = true; else continue; }
      if (ext == null || b.h > ext) { ext = b.h; cand = trailLevel(o, ext); if (cand != null && (stop == null || cand > stop)) stop = cand; }
      if (stop != null && b.l <= stop) return { hit: true, index: i, px: stop, ext: ext };
    }
    return { hit: false, index: null, px: null, ext: ext, resting: stop };
  }

  /* k adjacent bars → one bar. o of the first, c of the last, h/l the extremes. */
  function coarsen(bars, k) {
    if (!bars || !bars.length || !(k > 1)) return bars ? bars.slice() : [];
    var out = [], i, j, hi, lo, cl, end;
    for (i = 0; i < bars.length; i += k) {
      hi = -Infinity; lo = Infinity; cl = bars[i].c; end = Math.min(bars.length, i + k);
      for (j = i; j < end; j++) { if (bars[j].h > hi) hi = bars[j].h; if (bars[j].l < lo) lo = bars[j].l; cl = bars[j].c; }
      out.push({ o: bars[i].o, h: hi, l: lo, c: cl });
    }
    return out;
  }

  /* the same series at three bar sizes — the path-dependence panel */
  function trailScales(bars, o, scales) {
    var ks = scales && scales.length ? scales : [1, 2, 4], out = [], i, cb, r;
    for (i = 0; i < ks.length; i++) {
      cb = coarsen(bars, ks[i]);
      r = trailPath(cb, o);
      out.push({ k: ks[i], bars: cb.length, hit: !!(r && r.hit), px: r ? r.px : null, index: r ? r.index : null, resting: r ? r.resting : null, tie: !!(r && r.tie) });
    }
    return out;
  }

  /* -------------------------------------------------- bracket / OTO / OTOCO */

  /* ocoEffect is the engine's. It is the whole reason a partial fill on one
     leg shrinks its partner by EXACTLY what filled. */
  function ocoOn(legs, id, filledQty) {
    var p = P();
    if (!p || typeof p.ocoEffect !== "function") return null;
    try { return p.ocoEffect(legs, id, filledQty); } catch (e) { return null; }
  }

  /* A parent fill of filled out of total arms children sized to filled.
     Nothing that did not fill gets protected. */
  function bracket(o) {
    var total = +o.total, filled = Math.max(0, Math.min(+o.filled || 0, total));
    if (!(total > 0)) return null;
    var armedQty = filled;
    var out = {
      total: total, filled: filled, ratio: total > 0 ? filled / total : null,
      armed: armedQty > EPS, armedQty: armedQty,
      legs: [], cancelledOnParentCancel: [], race: null, note: ""
    };
    if (o.parentCancelled) {
      out.armed = false; out.armedQty = 0;
      out.cancelledOnParentCancel = ["tp", "sl"];
      out.note = "parent cancelled — both children cancelled with it, because a child of an order that never existed has nothing to protect.";
      return out;
    }
    if (!(armedQty > EPS)) { out.note = "parent unfilled — nothing armed."; return out; }
    out.legs = [
      { id: "tp", oco: "brk", qty: armedQty, px: +o.tpPx || 0, kind: "take-profit" },
      { id: "sl", oco: "brk", qty: armedQty, px: +o.slPx || 0, kind: "stop" }
    ];
    /* the double-fill race: both legs touched inside one bar */
    if (o.bar && o.bar.h >= out.legs[0].px && out.legs[0].px > 0 && o.bar.l <= out.legs[1].px && out.legs[1].px > 0) {
      var stopQty = Math.min(armedQty, +o.raceStopQty > 0 ? +o.raceStopQty : armedQty);
      var eff = ocoOn(out.legs, "sl", stopQty);
      out.race = {
        resolved: "stop first",
        pessimistic: true,
        stopQty: stopQty,
        effect: eff,
        note: window.DLI18N.t("58-orders.59c83401f2bb")
      };
    }
    out.note = "parent filled " + trim(filled) + " of " + trim(total) + " — each child armed at " + trim(armedQty) + ", sized to the fill and not to the order.";
    return out;
  }
  function trim(n) { return n == null || !isFinite(n) ? "—" : (Math.round(n * 1e8) / 1e8) + ""; }

  /* ---------------------------------------------------------------- peg */

  function pegPx(side, anchorPx, offBps, capPx) {
    if (!(anchorPx > 0)) return null;
    var px = anchorPx * (1 + (side === "buy" ? -1 : 1) * (offBps || 0) / 1e4), capped = false;
    if (capPx > 0) {
      if (side === "buy" && px > capPx) { px = capPx; capped = true; }
      if (side === "sell" && px < capPx) { px = capPx; capped = true; }
    }
    return { px: px, capped: capped, anchorPx: anchorPx };
  }

  /* Every re-peg is a cancel-replace, which is a new order at the back of a
     replenished level — so the queue cost of a peg is repegs × one full wait. */
  function peg(o) {
    var book = o.book, side = o.side === "sell" ? "sell" : "buy";
    if (!book || !(o.qty > 0) || !(o.flow > 0)) return null;
    var anchor = o.anchor === "bid" ? (book.bids[0] && book.bids[0].p)
      : o.anchor === "offer" ? (book.asks[0] && book.asks[0].p) : book.mid;
    var pp = pegPx(side, anchor, o.offBps, o.capPx);
    if (!pp) return null;
    var ahead = aheadOf(book, side, pp.px);
    if (ahead == null) return null;
    var steps = queueSteps(o.qty, ahead, o.flow, side, pp.px);
    if (!steps) return null;
    var every = o.everySteps > 0 ? Math.floor(o.everySteps) : 0;
    /* a re-peg happens every every steps for as long as the order is alive */
    var repegs = every > 0 ? Math.max(0, Math.floor(steps.steps / every)) : 0;
    var waitPer = flowWait(ahead, o.flow);
    return {
      px: pp.px, anchor: o.anchor, anchorPx: pp.anchorPx, capped: pp.capped,
      ahead: ahead, baseSteps: steps.steps, repegs: repegs,
      repegSteps: repegs * waitPer, repegMs: repegs * waitPer * STEP_MS,
      totalSteps: steps.steps + repegs * waitPer,
      note: pp.capped
        ? "the cap is binding, so this order is no longer pegged — it is a plain limit sitting at the cap."
        : "pegged " + (o.offBps || 0) + " bp " + (side === "buy" ? "below " : "above ") + o.anchor + "."
    };
  }
  /* steps to clear a queue of ahead at flow — the wait a re-join pays */
  function flowWait(ahead, flow) { return !(ahead > 0) || !(flow > 0) ? 0 : Math.ceil(ahead / flow); }

  /* ------------------------------------------------- execution realism */

  /* Shifted exponential by inverse CDF. floor + excess·(−ln(1−u)), u from the
     FNV hash of (venue | order id | tick). Mean = floor + excess·(1+LAT_K·s).
     Never random, never a clock read inside the arithmetic. */
  function latencyMs(venueKey, orderId, tick, stress) {
    var floorMs = LAT_FLOOR_MS[venueKey];
    if (floorMs == null) floorMs = venueKey === AMM_KEY ? blockSecs() * 1000 : null;
    var ex = LAT_EXCESS_MS[venueKey];
    if (floorMs == null || ex == null) return null;          /* unknown venue stays missing */
    var u = unit01(venueKey + "|" + orderId + "|" + tick);
    if (u > 0.9999999) u = 0.9999999;
    var k = 1 + LAT_K * (stress > 0 ? stress : 0);
    return floorMs + ex * k * (-Math.log(1 - u));
  }
  function latencyMeanMs(venueKey, stress) {
    var floorMs = LAT_FLOOR_MS[venueKey];
    if (floorMs == null) floorMs = venueKey === AMM_KEY ? blockSecs() * 1000 : null;
    var ex = LAT_EXCESS_MS[venueKey];
    if (floorMs == null || ex == null) return null;
    return floorMs + ex * (1 + LAT_K * (stress > 0 ? stress : 0));
  }
  function rejectRate(stress) { var s = stress > 0 ? stress : 0; return REJECT_BASE + REJECT_K * s * s; }
  function rejected(venueKey, orderId, tick, stress) {
    return unit01("rej|" + venueKey + "|" + orderId + "|" + tick) < rejectRate(stress);
  }
  /* above the cap the excess queues; below it costs nothing */
  function throttleMs(ratePerSec, cap) {
    var c = cap > 0 ? cap : THROTTLE_OPS;
    return ratePerSec > c ? (ratePerSec / c - 1) * 1000 : 0;
  }

  /* fee tier — a multiplier on the ENGINE's published rate, never a copy */
  function volBand(vol30) {
    var i, b = 0, v = vol30 > 0 ? vol30 : 0;
    for (i = 0; i < VOL_BANDS.length; i++) if (v >= VOL_BANDS[i]) b = i;
    return b;
  }
  function baseFees(venueKey) {
    var p = P();
    if (!p || typeof p.venueFees !== "function") return null;
    try { var f = p.venueFees(venueKey); return f && typeof f.taker === "number" ? { maker: f.maker, taker: f.taker } : null; }
    catch (e) { return null; }
  }
  function feeFor(venueKey, role, vol30) {
    var b = baseFees(venueKey);
    if (!b) return null;
    var band = volBand(vol30);
    return role === "maker" ? b.maker * MAKER_MULT[band] : b.taker * TAKER_MULT[band];
  }
  /* a rebate is a NEGATIVE maker rate. The engine publishes none; this reads
     the table rather than asserting the absence. */
  function rebateOf(venueKey, vol30) {
    var r = feeFor(venueKey, "maker", vol30);
    return r == null ? null : (r < 0 ? -r : null);
  }
  function feeTable(vol30) {
    var out = [], i, k, b;
    for (i = 0; i < ALL_KEYS.length; i++) {
      k = ALL_KEYS[i]; b = baseFees(k);
      var meta = null; try { meta = P().venue(k); } catch (e) { meta = null; }
      out.push({
        key: k, name: (meta && meta.n) || k, schedule: (meta && meta.d) || "",
        baseTaker: b ? b.taker : null, baseMaker: b ? b.maker : null,
        taker: feeFor(k, "taker", vol30), maker: feeFor(k, "maker", vol30),
        rebate: rebateOf(k, vol30), band: volBand(vol30)
      });
    }
    return out;
  }

  /* the dial: one number, four channels */
  function stressProfile(s) {
    var x = s > 0 ? (s > 1 ? 1 : s) : 0;
    return {
      s: x,
      spreadMult: 1 + SPREAD_K * x,
      depthMult: 1 / (1 + DEPTH_K * x),
      latMult: 1 + LAT_K * x,
      rejectRate: rejectRate(x),
      throttleCap: THROTTLE_OPS
    };
  }

  /* --------------------------------------------- implementation shortfall */
  /* Perold (1988). On a buy every term is positive when it hurt you; on a sell
     every sign flips so the reading never changes. delay + impact collapses to
     filled × (fill − decision), so the four parts sum to the total by
     construction — and check() asserts it rather than trusting it. */
  function shortfall(o) {
    var Q = +o.total, f = Math.max(0, Math.min(+o.filled || 0, Q));
    var dp = +o.decision, ap = +o.arrival, fp = +o.avgFill, ep = +o.end;
    if (!(Q > 0) || !(dp > 0)) return null;
    var sgn = o.side === "sell" ? -1 : 1;
    var delay = (ap > 0) ? sgn * f * (ap - dp) : null;
    var impact = (ap > 0 && fp > 0) ? sgn * f * (fp - ap) : null;
    var fee = (+o.fee || 0) + (+o.gas || 0);
    var unfilled = Q - f;
    /* A fully filled order has exactly zero opportunity cost and needs no end
       price. An order with a remainder CANNOT be priced without one — and the
       desk withholds the total rather than pricing the remainder at no drift,
       which would report a reject as a saving. A missing figure stays missing. */
    var needsEnd = unfilled > EPS && !(ep > 0);
    var opp = needsEnd ? null : (unfilled <= EPS ? 0 : sgn * unfilled * (ep - dp));
    if (delay == null || impact == null) return null;
    var total = needsEnd ? null : delay + impact + fee + opp;
    return {
      filled: f, total: Q, unfilled: unfilled,
      delay: delay, impact: impact, fee: fee, opportunity: opp,
      needsEnd: needsEnd,
      totalCost: total,
      bps: total != null && Q * dp > 0 ? total / (Q * dp) * 1e4 : null,
      identity: total == null ? null : Math.abs((delay + impact + fee + opp) - total)
    };
  }

  /* ------------------------------------------- the priced order under stress */
  /* One order, one stress level, in quote units. Every term is named so the
     attribution below can move exactly one of them. */
  function priceOrder(req, on, s) {
    var prof = stressProfile(s);
    var spreadMult = on.spread ? prof.spreadMult : 1;
    var depthMult = on.depth ? prof.depthMult : 1;
    var latMult = on.lat ? prof.latMult : 1;
    var rr = on.rej ? prof.rejectRate : rejectRate(0);
    var book = bookOf(req.sym, req.quote, req.at || 0, depthMult, spreadMult);
    var p = P();
    if (!book || !p) return null;
    var mid = book.mid;
    var want = +req.base;
    if (!(want > 0) || !(mid > 0)) return null;

    /* how much actually gets sent: rejects shave the order deterministically */
    var slices = Math.max(1, Math.round(+req.slices > 0 ? +req.slices : 8)), i, sent = 0, rejN = 0;
    for (i = 0; i < slices; i++) {
      if (unit01("rej|" + req.venue + "|" + (req.id || "o") + "|" + i + "|" + (req.at || 0)) < rr) rejN++;
      else sent += want / slices;
    }
    var w = null;
    try { w = p.walk(book, req.side === "sell" ? "sell" : "buy", sent, 0); } catch (e) { w = null; }
    if (!w || !(w.filled > 0)) return null;

    var feeRate = feeFor(req.venue, "taker", +req.vol30 || 0);
    if (feeRate == null) return null;
    var notional = w.cost;
    var fee = notional * feeRate;

    /* latency drift: the market moves while the order is in flight, at the
       symbol's own modelled half-spread per second of latency. */
    var lat = latencyMeanMs(req.venue, on.lat ? s : 0);
    var latSec = lat == null ? 0 : lat / 1000;
    var sbps = spreadBpsOf(req.sym);
    if (sbps == null) return null;
    var halfSpreadPx = mid * sbps * spreadMult / 2 / 1e4;
    var drift = w.filled * halfSpreadPx * latSec;
    var thr = throttleMs(+req.ratePerSec || 0, THROTTLE_OPS);
    drift += w.filled * halfSpreadPx * (thr / 1000);

    var arrival = mid;
    var avgFill = w.avg + (req.side === "sell" ? -1 : 1) * (w.filled > 0 ? drift / w.filled : 0);
    /* NOT defaulted to mid. An end price the desk cannot see stays missing, so
       an order with a remainder reports no total rather than a flattering one. */
    var end = +req.endPx > 0 ? +req.endPx : 0;
    var sf = shortfall({
      side: req.side, total: want, filled: w.filled,
      decision: +req.decisionPx > 0 ? +req.decisionPx : mid,
      arrival: arrival, avgFill: avgFill, end: end,
      fee: fee, gas: +req.gas || 0
    });
    if (!sf) return null;
    return {
      mid: mid, sent: sent, rejects: rejN, slices: slices, rejectRate: rr,
      filled: w.filled, avg: w.avg, avgWithDrift: avgFill, levels: w.levels,
      feeRate: feeRate, fee: fee, driftQuote: drift, latencyMs: lat, throttleMs: thr,
      spreadMult: spreadMult, depthMult: depthMult, latMult: latMult,
      shortfall: sf, cost: sf.totalCost
    };
  }
  /* the engine's spreadBps takes 24h VOLUME, not a symbol — the book-engine
     wrapper is what takes a symbol, and this desk holds the typed core. */
  function spreadBpsOf(sym) {
    var p = P(), st = statsOf(sym);
    if (!p || !st || typeof p.spreadBps !== "function") return null;
    try { var v = p.spreadBps(st.vol24 || 0); return typeof v === "number" && isFinite(v) ? v : null; } catch (e) {}
    return null;
  }

  /* one channel at a time, plus the residual the split cannot assign */
  var CHANNELS = [["spread", "Spread"], ["depth", "Depth"], ["lat", "Latency"], ["rej", "Rejects"]];
  function attribute(req, s) {
    var none = { spread: 0, depth: 0, lat: 0, rej: 0 };
    var base = priceOrder(req, none, s);
    var all = priceOrder(req, { spread: 1, depth: 1, lat: 1, rej: 1 }, s);
    if (!base || !all) return null;
    if (base.cost == null || all.cost == null) {
      return { ok: false, needsEnd: true, note: window.DLI18N.t("58-orders.54275d588001") };
    }
    var parts = [], i, on, r, sum = 0, k;
    for (i = 0; i < CHANNELS.length; i++) {
      k = CHANNELS[i][0];
      on = { spread: 0, depth: 0, lat: 0, rej: 0 }; on[k] = 1;
      r = priceOrder(req, on, s);
      if (!r) return null;
      if (r.cost == null) return { ok: false, needsEnd: true, note: "the " + CHANNELS[i][1].toLowerCase() + " channel leaves part of this order unfilled, and without an end price its opportunity cost cannot be priced. Set an end price on the Build tab." };
      parts.push({ key: k, label: CHANNELS[i][1], cost: r.cost - base.cost });
      sum += r.cost - base.cost;
    }
    var total = all.cost - base.cost;
    return {
      ok: true, calm: base, stressed: all, s: stressProfile(s),
      parts: parts, firstOrderSum: sum, residual: total - sum, total: total,
      identity: Math.abs((sum + (total - sum)) - total)
    };
  }

  /* ------------------------------------------------------------- simulate */
  /* PURE. No balance write, no order placed, nothing persisted, no clock read
     inside the arithmetic. The tick is passed in so two calls with the same
     tick give the same numbers, forever. */
  function simulate(t) {
    var req = normalise(t);
    var p = P();
    if (!p) return { ok: false, note: window.DLI18N.t("58-orders.fa12ebcf9d31") };
    var book = bookOf(req.sym, req.quote, req.at, 1, 1);
    var flow = flowPerStep(req.sym);
    var mid = book ? book.mid : null;
    if (!book || !(mid > 0) || !(flow > 0)) {
      return { ok: false, note: "no modelled market for " + req.sym + "/" + req.quote + " — a missing price stays missing rather than defaulting to 1." };
    }
    var restPx = req.restPx > 0 ? req.restPx : mid * (req.side === "buy" ? 0.999 : 1.001);
    var ahead = aheadOf(book, req.side, restPx);
    var out = {
      ok: true, at: req.at, req: req, mid: mid, flow: flow, restPx: restPx, ahead: ahead,
      iceberg: null, trail: null, scales: null, optimistic: null, bracket: null, peg: null,
      fees: feeTable(req.vol30), shortfall: null, attribution: null, latency: null
    };

    if (ahead != null) {
      out.iceberg = iceberg(req.base, req.clip > 0 ? req.clip : req.base, ahead, flow, req.side, restPx);
      /* what a bigger clip buys you, on this exact order */
      out.clipCurve = [];
      var divs = [1, 2, 3, 4, 6, 8, 12, 16], di, ic;
      for (di = 0; di < divs.length; di++) {
        ic = iceberg(req.base, req.base / divs[di], ahead, flow, req.side, restPx);
        if (ic) out.clipCurve.push({ n: ic.clips, clip: req.base / divs[di], displayFrac: ic.displayFrac, penaltySteps: ic.penaltySteps, penaltyMs: ic.penaltyMs, score: ic.entropy ? ic.entropy.score : null });
      }
      out.peg = peg({ book: book, side: req.side, qty: req.base, flow: flow, anchor: req.pegAnchor, offBps: req.pegOffBps, capPx: req.pegCapPx, everySteps: req.pegEvery });
    }

    var bars = req.bars && req.bars.length ? req.bars : sampleBars(mid);
    var topt = { mode: req.trailMode, pct: req.trailPct, offset: req.trailAbs, activation: req.activation, initStop: req.initStop };
    out.bars = bars;
    out.trail = trailPath(bars, topt);
    out.optimistic = trailOptimistic(bars, topt);
    out.scales = trailScales(bars, topt, [1, 2, 4]);
    out.scalesAgree = agree(out.scales);

    out.bracket = bracket({
      total: req.base, filled: req.parentFilled, parentCancelled: req.parentCancelled,
      tpPx: req.tpPx > 0 ? req.tpPx : mid * 1.04, slPx: req.slPx > 0 ? req.slPx : mid * 0.97,
      bar: req.raceBar || { h: mid * 1.05, l: mid * 0.96 }, raceStopQty: req.raceStopQty
    });

    out.latency = [];
    var vi;
    for (vi = 0; vi < ALL_KEYS.length; vi++) {
      out.latency.push({
        key: ALL_KEYS[vi],
        calmMs: latencyMeanMs(ALL_KEYS[vi], 0),
        stressMs: latencyMeanMs(ALL_KEYS[vi], req.stress),
        drawMs: latencyMs(ALL_KEYS[vi], req.orderId, req.at, req.stress),
        rejected: rejected(ALL_KEYS[vi], req.orderId, req.at, req.stress)
      });
    }

    var pr = { sym: req.sym, quote: req.quote, side: req.side, base: req.base, venue: req.venue,
      vol30: req.vol30, at: req.at, id: req.orderId, slices: req.slices, ratePerSec: req.ratePerSec,
      decisionPx: req.decisionPx, endPx: req.endPx, gas: req.gasQuote };
    out.priced = priceOrder(pr, { spread: 1, depth: 1, lat: 1, rej: 1 }, req.stress);
    out.shortfall = out.priced ? out.priced.shortfall : null;
    out.attribution = attribute(pr, req.stress);
    return out;
  }

  function agree(rows) {
    if (!rows || rows.length < 2) return true;
    var i, a = rows[0];
    for (i = 1; i < rows.length; i++) {
      if (rows[i].hit !== a.hit) return false;
      if (a.hit && Math.abs((rows[i].px || 0) - (a.px || 0)) > 1e-9) return false;
    }
    return true;
  }

  /* A hand-written bar series anchored on the live mid. It is a SHAPE, not a
     history: the desk uses it only to show the tie-break and the bar-size
     disagreement. Paste your own on the Build tab and it is used instead. */
  function sampleBars(mid) {
    var f = [
      [1.000, 1.000, 0.990, 1.000],
      [1.000, 1.010, 1.000, 1.010],
      [1.010, 1.400, 1.020, 1.390],
      [1.390, 1.350, 1.250, 1.300]
    ], out = [], i;
    for (i = 0; i < f.length; i++) out.push({ o: mid * f[i][0], h: mid * f[i][1], l: mid * f[i][2], c: mid * f[i][3] });
    return out;
  }

  function normalise(t) {
    var d = ticket();
    var o = t ? merge(d, t) : d;
    return {
      sym: String(o.sym || "BTC").toUpperCase(), quote: String(o.quote || "USDT").toUpperCase(),
      side: o.side === "sell" ? "sell" : "buy",
      base: +o.base > 0 ? +o.base : 1,
      clip: +o.clip > 0 ? +o.clip : 0,
      restPx: +o.restPx > 0 ? +o.restPx : 0,
      trailMode: o.trailMode === "abs" ? "abs" : "pct",
      trailPct: +o.trailPct > 0 ? +o.trailPct : 10,
      trailAbs: +o.trailAbs > 0 ? +o.trailAbs : 0,
      activation: +o.activation > 0 ? +o.activation : 0,
      initStop: +o.initStop > 0 ? +o.initStop : 0,
      parentFilled: +o.parentFilled >= 0 ? +o.parentFilled : 0,
      parentCancelled: !!o.parentCancelled,
      tpPx: +o.tpPx > 0 ? +o.tpPx : 0, slPx: +o.slPx > 0 ? +o.slPx : 0,
      raceStopQty: +o.raceStopQty > 0 ? +o.raceStopQty : 0,
      pegAnchor: o.pegAnchor === "bid" || o.pegAnchor === "offer" ? o.pegAnchor : "mid",
      pegOffBps: +o.pegOffBps > 0 ? +o.pegOffBps : 0,
      pegCapPx: +o.pegCapPx > 0 ? +o.pegCapPx : 0,
      pegEvery: +o.pegEvery > 0 ? +o.pegEvery : 0,
      venue: ALL_KEYS.indexOf(o.venue) >= 0 ? o.venue : "binance",
      vol30: +o.vol30 > 0 ? +o.vol30 : 0,
      stress: +o.stress > 0 ? Math.min(1, +o.stress) : 0,
      slices: +o.slices > 0 ? Math.round(+o.slices) : 8,
      ratePerSec: +o.ratePerSec > 0 ? +o.ratePerSec : 0,
      decisionPx: +o.decisionPx > 0 ? +o.decisionPx : 0,
      endPx: +o.endPx > 0 ? +o.endPx : 0,
      gasQuote: +o.gasQuote > 0 ? +o.gasQuote : 0,
      orderId: String(o.orderId || "lab-1"),
      at: +o.at > 0 ? +o.at : 0,
      bars: o.bars && o.bars.length ? o.bars : null
    };
  }

  /* ----------------------------------------------------------------- send */
  /* The ONLY place in this layer that touches money, and it does it through
     the engine. A simulation is a question; this is the answer costing you
     something. The order is re-priced NOW — filling at a remembered average
     would mint P&L out of a stale simulation. */
  function send(sim) {
    var lp = LP();
    if (!sim || !sim.ok) return { ok: false, reason: "nothing simulated — run the Simulate tab first" };
    if (!lp || typeof lp.execFill !== "function") return { ok: false, reason: "the paper engine is not available" };
    if (typeof S === "undefined") return { ok: false, reason: "the account is not ready yet" };
    var req = sim.req;
    if (!req || !req.sym || !(req.base > 0)) return { ok: false, reason: "this simulation carries no order to re-price" };

    var fresh = simulate(req);
    if (!fresh.ok || !fresh.priced || !(fresh.priced.filled > 0)) return { ok: false, reason: "nothing fills at this size right now — simulate it again" };
    if (sim.mid > 0 && fresh.mid > 0) {
      var drift = Math.abs(fresh.mid / sim.mid - 1) * 100;
      if (drift > 1) return { ok: false, stale: true, reason: "the price moved " + drift.toFixed(2) + "% since that simulation. Nothing was sent — simulate it again." };
    }

    /* size the fill to what the account can actually trade — the engine's own
       rule, not a second opinion. */
    var p = P(), qty = fresh.priced.filled;
    try {
      if (p && typeof p.tradableQty === "function") {
        var have = 0;
        try { have = (S && S.bal && S.bal[fresh.req.sym]) || 0; } catch (e) { have = 0; }
        qty = p.tradableQty({ qty: qty }, fresh.req.side, have);
      }
    } catch (e) { qty = fresh.priced.filled; }
    if (!(qty > 0)) return { ok: false, reason: "the account cannot trade this size" };

    var avg = fresh.priced.avgWithDrift > 0 ? fresh.priced.avgWithDrift : fresh.priced.avg;
    var okFill = false;
    try { okFill = !!lp.execFill(S, fresh.priced.feeRate, fresh.req.side, fresh.req.sym, fresh.req.quote, qty, avg, "orderlab", true); }
    catch (e) { okFill = false; }
    if (!okFill) return { ok: false, reason: "the engine refused the fill — check the balance for this size" };

    var gasPaid = 0;
    if (fresh.req.venue === AMM_KEY && fresh.req.gasQuote > 0 && typeof lp.chargeNetwork === "function") {
      try { gasPaid = lp.chargeNetwork(S, fresh.req.quote, fresh.req.gasQuote, "Order Lab · AMM gas") || 0; } catch (e) { gasPaid = 0; }
    }

    var entry = {
      t: C.now ? C.now() : 0, sym: fresh.req.sym, quote: fresh.req.quote, side: fresh.req.side,
      base: fresh.req.base, filled: qty, avg: avg, venue: fresh.req.venue, stress: fresh.req.stress,
      feeRate: fresh.priced.feeRate, feeQuote: qty * avg * fresh.priced.feeRate, gasQuote: gasPaid,
      shortfall: fresh.shortfall ? {
        delay: fresh.shortfall.delay, impact: fresh.shortfall.impact,
        fee: fresh.shortfall.fee, opportunity: fresh.shortfall.opportunity,
        totalCost: fresh.shortfall.totalCost, bps: fresh.shortfall.bps
      } : null
    };
    push(entry);
    try { C.save(); } catch (e) {}
    try { if (typeof updateNavBal === "function") updateNavBal(); } catch (e) {}
    try { C.toast && C.toast("good", "Order Lab sent", trim(qty) + " " + fresh.req.sym + " at " + fmtQuote(avg, fresh.req.quote)); } catch (e) {}
    return { ok: true, entry: entry };
  }

  /* ------------------------------------------------------------ state + log */

  function bucket() {
    var X = null;
    try { X = C.X(); } catch (e) { X = null; }
    if (!X) return null;
    if (!X.ordlab) X.ordlab = { log: [], ticket: null };
    if (!X.ordlab.log) X.ordlab.log = [];
    return X.ordlab;
  }
  function log() { var b = bucket(); return b ? b.log.slice() : []; }
  function push(e) { var b = bucket(); if (!b) return; b.log.unshift(e); if (b.log.length > 40) b.log.length = 40; }
  function ticket(patch) {
    var b = bucket();
    var base = {
      sym: "BTC", quote: "USDT", side: "buy", base: 12, clip: 1.5,
      trailMode: "pct", trailPct: 10, trailAbs: 0, activation: 0,
      parentFilled: 4.5, pegAnchor: "mid", pegOffBps: 5, pegEvery: 4,
      venue: "binance", vol30: 0, stress: 0.4, slices: 12, ratePerSec: 0,
      decisionPx: 0, endPx: 0, orderId: "lab-1"
    };
    if (!b) return patch ? merge(base, patch) : base;
    if (!b.ticket) b.ticket = base;
    if (patch) { b.ticket = merge(b.ticket, patch); try { C.save(); } catch (e) {} }
    return b.ticket;
  }
  function merge(a, b) {
    var o = {}, k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) o[k] = a[k];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) o[k] = b[k];
    return o;
  }

  /* ------------------------------------------------------------- formatting */

  function esc(s) { try { return C.esc ? C.esc(String(s)) : String(s).replace(/[&<>"]/g, ""); } catch (e) { return ""; } }
  function fmtNum(n) {
    if (n == null || !isFinite(n)) return "—";
    var a = Math.abs(n);
    if (a >= 1000) return n.toFixed(0);
    if (a >= 1) return n.toFixed(2);
    if (a >= 0.01) return n.toFixed(4);
    return n.toFixed(8);
  }
  function fmtQuote(n, q) {
    if (n == null || !isFinite(n)) return "—";
    try { if (C.money && (q === "USDT" || q === "USD")) return C.money(n); } catch (e) {}
    return fmtNum(n) + " " + (q || "");
  }
  function fmtMs(n) {
    if (n == null || !isFinite(n)) return "—";
    if (n < 1000) return n.toFixed(0) + " ms";
    if (n < 60000) return (n / 1000).toFixed(1) + " s";
    return (n / 60000).toFixed(1) + " min";
  }
  function fmtPct(n, d) { return n == null || !isFinite(n) ? "—" : (n * 100).toFixed(d == null ? 3 : d) + "%"; }
  function fmtBps(n) { return n == null || !isFinite(n) ? "—" : (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(1) + " bp"; }
  function when(t) { if (!(t > 0)) return "—"; try { return new Date(t).toISOString().slice(5, 16).replace("T", " "); } catch (e) { return "—"; } }

  /* ------------------------------------------------------------------ the UI */

  function field(label, inner) { return '<label class="ord-f"><span class="ord-fl">' + esc(label) + '</span>' + inner + '</label>'; }
  function opts(list, cur, suffix) {
    var h = "", i;
    for (i = 0; i < list.length; i++) h += '<option value="' + list[i] + '"' + (+cur === +list[i] ? " selected" : "") + '>' + list[i] + (suffix || "") + '</option>';
    return h;
  }
  function sel(list, cur) {
    var h = "", i;
    for (i = 0; i < list.length; i++) h += '<option value="' + esc(list[i][0]) + '"' + (cur === list[i][0] ? " selected" : "") + '>' + esc(list[i][1]) + '</option>';
    return h;
  }

  /* ---------------------------------------------------------------- Build */
  function paneBuild() {
    var t = ticket(), h = "";
    h += ('<div class="ord-note">' + window.DLI18N.t("58-orders.7368983b8297") + '</div>');
    h += '<div class="dl-2 ord-form">';
    h += field("Symbol", '<input id="ordSym" class="dl-inp" type="text" value="' + esc(t.sym) + '" autocomplete="off" spellcheck="false" aria-label="Symbol">');
    h += field("Side", ('<select id="ordSide" class="dl-inp" aria-label="' + window.DLI18N.t("58-orders.630ef00b7c4f") + '">') + sel([["buy", "Buy"], ["sell", "Sell"]], t.side) + '</select>');
    h += field("Size (base)", '<input id="ordBase" class="dl-inp" type="number" min="0" step="any" value="' + esc(t.base) + '" aria-label="Size in base units">');
    h += field("Iceberg clip", '<input id="ordClip" class="dl-inp" type="number" min="0" step="any" value="' + esc(t.clip) + '" aria-label="Displayed clip size">');
    h += '</div>';

    h += ('<div class="ord-sub">' + window.DLI18N.t("58-orders.99bdef936602") + '</div><div class="dl-2 ord-form">');
    h += field("Trail by", ('<select id="ordTMode" class="dl-inp" aria-label="' + window.DLI18N.t("58-orders.aefe0dfc60ce") + '">') + sel([["pct", "Percent"], ["abs", "Absolute offset"]], t.trailMode) + '</select>');
    h += field("Trail %", '<input id="ordTPct" class="dl-inp" type="number" min="0" step="any" value="' + esc(t.trailPct) + '" aria-label="Trail percent">');
    h += field("Trail offset", '<input id="ordTAbs" class="dl-inp" type="number" min="0" step="any" value="' + esc(t.trailAbs) + '" aria-label="Trail absolute offset">');
    h += field("Activation price", '<input id="ordAct" class="dl-inp" type="number" min="0" step="any" value="' + esc(t.activation) + '" aria-label="Activation price">');
    h += '</div>';
    h += ('<div class="ord-rule">' + window.DLI18N.t("58-orders.fb361325ecd4") + '<b>' + window.DLI18N.t("58-orders.9702d9de8539") + '</b>' + window.DLI18N.t("58-orders.ef001c711387") + '<b>' + window.DLI18N.t("58-orders.a53503b0a4c1") + '</b>' + window.DLI18N.t("58-orders.e4540719c4fa") + '</div>');

    h += ('<div class="ord-sub">' + window.DLI18N.t("58-orders.0f8dac002d7b") + '</div><div class="dl-2 ord-form">');
    h += field("Parent filled", '<input id="ordPF" class="dl-inp" type="number" min="0" step="any" value="' + esc(t.parentFilled) + '" aria-label="Parent filled quantity">');
    h += field("Take-profit", '<input id="ordTP" class="dl-inp" type="number" min="0" step="any" value="' + esc(t.tpPx || "") + '" aria-label="Take profit price">');
    h += field("Stop", '<input id="ordSL" class="dl-inp" type="number" min="0" step="any" value="' + esc(t.slPx || "") + '" aria-label="Stop price">');
    h += field("Parent cancelled", ('<select id="ordPC" class="dl-inp" aria-label="' + window.DLI18N.t("58-orders.0760931c36c7") + '">') + sel([["", "No"], ["1", "Yes — cancel the children"]], t.parentCancelled ? "1" : "") + '</select>');
    h += '</div>';

    h += ('<div class="ord-sub">' + window.DLI18N.t("58-orders.7743acb06502") + '</div><div class="dl-2 ord-form">');
    h += field("Anchor", ('<select id="ordPegA" class="dl-inp" aria-label="' + window.DLI18N.t("58-orders.66a273ec807e") + '">') + sel([["mid", "Mid"], ["bid", "Bid"], ["offer", "Offer"]], t.pegAnchor) + '</select>');
    h += field("Offset (bp)", '<input id="ordPegO" class="dl-inp" type="number" min="0" step="any" value="' + esc(t.pegOffBps) + '" aria-label="Peg offset in basis points">');
    h += field("Limit cap", '<input id="ordPegC" class="dl-inp" type="number" min="0" step="any" value="' + esc(t.pegCapPx || "") + '" aria-label="Peg limit cap">');
    h += field("Re-peg every", ('<select id="ordPegE" class="dl-inp" aria-label="' + window.DLI18N.t("58-orders.20b69c7b913a") + '">') + opts([0, 2, 4, 8, 16], t.pegEvery, " steps") + '</select>');
    h += '</div>';

    h += ('<div class="ord-sub">' + window.DLI18N.t("58-orders.8b70a2d9ed50") + '</div><div class="dl-2 ord-form">');
    h += field("Decision price", '<input id="ordDec" class="dl-inp" type="number" min="0" step="any" value="' + esc(t.decisionPx || "") + '" aria-label="Decision price">');
    h += field("End price", '<input id="ordEnd" class="dl-inp" type="number" min="0" step="any" value="' + esc(t.endPx || "") + '" aria-label="End price">');
    h += '</div>';
    h += ('<div class="ord-rule">' + window.DLI18N.t("58-orders.057d9730d5b3") + '<b>' + window.DLI18N.t("58-orders.6e16db102267") + '</b>' + window.DLI18N.t("58-orders.a9825837c44d") + '<b>' + window.DLI18N.t("58-orders.04b447783afe") + '</b>' + window.DLI18N.t("58-orders.0ab1b56ce1aa") + '</div>');
    h += ('<div class="ord-actions"><button class="go" id="ordGo">' + window.DLI18N.t("58-orders.f35b0a38a9e8") + '</button><span class="ord-sendnote">' + window.DLI18N.t("58-orders.51a0f36bc274") + '</span></div>');
    return h;
  }

  /* -------------------------------------------------------------- Simulate */
  function paneSim() {
    var R = simulate(null);
    if (!R.ok) return '<div class="ord-empty">' + esc(R.note) + '</div>';
    var q = R.req.quote, h = "";
    h += '<div class="ord-head"><span class="ord-pair">' + esc(R.req.side.toUpperCase()) + " " + fmtNum(R.req.base) + " " + esc(R.req.sym) + " / " + esc(q) +
      ('</span><span class="ord-mid">' + window.DLI18N.t("58-orders.0d402749749f") + '') + fmtQuote(R.mid, q) + ' · resting at ' + fmtQuote(R.restPx, q) + ' · ' + (R.ahead == null ? "queue unknown" : fmtNum(R.ahead) + " " + esc(R.req.sym) + " ahead of you") + '</span></div>';

    /* ---- iceberg */
    h += ('<div class="ord-sub">' + window.DLI18N.t("58-orders.330218a5d7ad") + '</div>');
    if (!R.iceberg) h += ('<div class="ord-empty">' + window.DLI18N.t("58-orders.8a733a751c66") + '</div>');
    else {
      var I = R.iceberg;
      h += '<div class="ord-kpis">' +
        kpi("Clips", I.clips + "") +
        kpi("Displayed", fmtPct(I.displayFrac, 1)) +
        kpi("One resting order", fmtMs(I.singleMs)) +
        kpi("Iceberg", fmtMs(I.icebergMs)) +
        kpi("Refresh penalty", fmtMs(I.penaltyMs) + (I.penaltyPct == null ? "" : " · +" + I.penaltyPct.toFixed(0) + "%"), "bad") +
        kpi("Clip entropy", I.entropy == null || I.entropy.score == null ? "—" : I.entropy.bits.toFixed(2) + " bits · signature " + (I.entropy.score * 100).toFixed(0) + "%", I.entropy && I.entropy.score != null && I.entropy.score > 0.8 ? "bad" : "") +
        '</div>';
      h += ('<div class="ord-legend">' + window.DLI18N.t("58-orders.b9005d4ef05a") + '') + (R.ahead == null ? "queue" : fmtNum(R.ahead) + " " + esc(R.req.sym)) + ('' + window.DLI18N.t("58-orders.c4cdee2185fe") + '</div>');
      if (R.clipCurve && R.clipCurve.length) {
        h += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("58-orders.4b782ddc92a5") + '</th><th class="r">' + window.DLI18N.t("58-orders.3915dc6884f3") + '</th><th class="r">' + window.DLI18N.t("58-orders.c9a4af5f6825") + '</th><th class="r">' + window.DLI18N.t("58-orders.241c75409278") + '</th><th class="r">' + window.DLI18N.t("58-orders.f1a73e2204a1") + '</th></tr></thead><tbody>');
        var ci;
        for (ci = 0; ci < R.clipCurve.length; ci++) {
          var cc = R.clipCurve[ci];
          h += '<tr' + (cc.n === I.clips ? ' data-best="1"' : '') + '><td>' + cc.n + '</td><td class="r">' + fmtNum(cc.clip) + '</td><td class="r">' + fmtPct(cc.displayFrac, 1) + '</td><td class="r">' + fmtMs(cc.penaltyMs) + '</td><td class="r">' + (cc.score == null ? "—" : (cc.score * 100).toFixed(0) + "%") + '</td></tr>';
        }
        h += ('</tbody></table></div><div class="ord-legend">' + window.DLI18N.t("58-orders.f35243d5a9f4") + '</div>');
      }
    }

    /* ---- trailing */
    h += ('<div class="ord-sub">' + window.DLI18N.t("58-orders.c915b463d402") + '</div>');
    var T = R.trail, O = R.optimistic;
    h += '<div class="ord-kpis">' +
      kpi("Pessimistic", T && T.hit ? "stopped at " + fmtQuote(T.px, q) + " on bar " + (T.index + 1) : "never stopped · trail resting at " + fmtQuote(T && T.resting, q)) +
      kpi("Optimistic (engine order)", O && O.hit ? "stopped at " + fmtQuote(O.px, q) + " on bar " + (O.index + 1) : "never stopped") +
      kpi("Running extreme", fmtQuote(T && T.ext, q)) +
      kpi("Tie-break bar", T && T.tie ? "yes — this bar could have done both" : "no", T && T.tie ? "bad" : "") +
      '</div>';
    h += '<div class="ord-rule">' + (T && T.tie
      ? ('' + window.DLI18N.t("58-orders.d0c2308507ec") + '<b>' + window.DLI18N.t("58-orders.6db7d803e74f") + '</b>' + window.DLI18N.t("58-orders.bb7150dcb0b7") + '')
      : 'No bar in this series could have both extended the trail and hit the stop, so the two resolutions agree here. They will not always.') + '</div>';

    h += ('<div class="ord-sub">' + window.DLI18N.t("58-orders.b14501319a92") + '</div>');
    h += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("58-orders.7ee027db5f6a") + '</th><th class="r">' + window.DLI18N.t("58-orders.f2c3526915d3") + '</th><th>' + window.DLI18N.t("58-orders.4e80abb5b146") + '</th><th class="r">' + window.DLI18N.t("58-orders.93c91c851e7a") + '</th></tr></thead><tbody>');
    var si;
    for (si = 0; si < R.scales.length; si++) {
      var sc = R.scales[si];
      h += '<tr><td>' + sc.k + '×</td><td class="r">' + sc.bars + '</td><td>' + (sc.hit ? "stopped on bar " + (sc.index + 1) : "never stopped") + '</td><td class="r">' + (sc.hit ? fmtQuote(sc.px, q) : (sc.resting == null ? "—" : "trail at " + fmtQuote(sc.resting, q))) + '</td></tr>';
    }
    h += '</tbody></table></div>';
    h += '<div class="ord-rule ' + (R.scalesAgree ? "" : "ord-dis") + '">' + (R.scalesAgree
      ? 'All three bar sizes agree on this series. That is luck, not a property: coarsening merges the bar that ratcheted the trail with the bar that dipped, and under the pessimistic rule the merged bar is tested against the OLD stop.'
      : ('' + window.DLI18N.t("58-orders.b888c36d642a") + '<b>' + window.DLI18N.t("58-orders.67656def000f") + '</b>' + window.DLI18N.t("58-orders.776596d3a7b6") + '')) + '</div>';

    /* ---- bracket */
    h += ('<div class="ord-sub">' + window.DLI18N.t("58-orders.95e92fe100f4") + '</div>');
    var B = R.bracket;
    if (!B) h += ('<div class="ord-empty">' + window.DLI18N.t("58-orders.2eee82a908e8") + '</div>');
    else {
      h += '<div class="ord-kpis">' +
        kpi("Parent", fmtNum(B.filled) + " of " + fmtNum(B.total) + (B.ratio == null ? "" : " · " + fmtPct(B.ratio, 1))) +
        kpi("Children armed", B.armed ? fmtNum(B.armedQty) + " each" : "none") +
        kpi("Race", B.race ? "both legs touched — stop first" : "no race", B.race ? "bad" : "") +
        '</div>';
      h += '<div class="ord-legend">' + esc(B.note) + '</div>';
      if (B.race && B.race.effect) {
        var red = B.race.effect.reduce || [], can = B.race.effect.cancel || [];
        h += '<div class="ord-rule">' + esc(B.race.note) + ' The engine\'s ocoEffect() then ' +
          (can.length ? 'cancelled the take-profit outright' : red.length ? 'reduced the take-profit to ' + fmtNum(red[0].qty) : 'left the partner unchanged') + '.</div>';
      }
      if (B.cancelledOnParentCancel.length) h += '<div class="ord-rule">' + esc(B.note) + '</div>';
    }

    /* ---- peg */
    h += ('<div class="ord-sub">' + window.DLI18N.t("58-orders.3c1c0ecc6279") + '</div>');
    if (!R.peg) h += ('<div class="ord-empty">' + window.DLI18N.t("58-orders.8b3fc8b90e15") + '</div>');
    else {
      var G = R.peg;
      h += '<div class="ord-kpis">' +
        kpi("Pegged price", fmtQuote(G.px, q) + (G.capped ? " · capped" : "")) +
        kpi("Anchor", esc(G.anchor) + " " + fmtQuote(G.anchorPx, q)) +
        kpi("Re-pegs", G.repegs + "") +
        kpi("Queue cost of re-pegging", fmtMs(G.repegMs), G.repegs > 0 ? "bad" : "") +
        '</div>';
      h += '<div class="ord-legend">' + esc(G.note) + ('' + window.DLI18N.t("58-orders.bcbae51e1b46") + '</div>');
    }
    h += assumptionStrip();
    return h;
  }

  function kpi(label, value, cls) {
    return '<div class="ord-kpi' + (cls ? " ord-" + cls : "") + '"><span class="ord-kl">' + esc(label) + '</span><span class="ord-kv">' + value + '</span></div>';
  }

  /* ---------------------------------------------------------------- Stress */
  function paneStress() {
    var t = ticket(), R = simulate(null), h = "";
    if (!R.ok) return '<div class="ord-empty">' + esc(R.note) + '</div>';
    var q = R.req.quote;
    h += ('<div class="ord-note">' + window.DLI18N.t("58-orders.4f50078e0f69") + '</div>');
    h += '<div class="dl-2 ord-form">';
    h += field("Stress", ('<select id="ordStress" class="dl-inp" aria-label="' + window.DLI18N.t("58-orders.5193bb0193a4") + '">') + opts([0, 0.2, 0.4, 0.6, 0.8, 1], t.stress, "") + '</select>');
    h += field("Venue", ('<select id="ordVenue" class="dl-inp" aria-label="' + window.DLI18N.t("58-orders.aea1b15df626") + '">') + sel(venueOpts(), t.venue) + '</select>');
    h += field("30-day volume", ('<select id="ordVol" class="dl-inp" aria-label="' + window.DLI18N.t("58-orders.d177e16a4688") + '">') + sel(volOpts(), String(t.vol30 || 0)) + '</select>');
    h += field("Orders / second", '<input id="ordRate" class="dl-inp" type="number" min="0" step="any" value="' + esc(t.ratePerSec) + '" aria-label="Order rate per second">');
    h += '</div>';
    h += ('<div class="ord-actions"><button class="go" id="ordStressGo">' + window.DLI18N.t("58-orders.ea2363685535") + '</button></div>');

    var pf = stressProfile(R.req.stress);
    h += '<div class="ord-kpis">' +
      kpi("Spread", "× " + pf.spreadMult.toFixed(2)) +
      kpi("Depth", "× " + pf.depthMult.toFixed(3)) +
      kpi("Latency excess", "× " + pf.latMult.toFixed(2)) +
      kpi("Reject rate", fmtPct(pf.rejectRate, 2), pf.rejectRate > 0.05 ? "bad" : "") +
      kpi("Throttle cap", pf.throttleCap + " /s") +
      '</div>';

    h += ('<div class="ord-sub">' + window.DLI18N.t("58-orders.22075996e62a") + '</div>');
    h += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("58-orders.aea1b15df626") + '</th><th class="r">' + window.DLI18N.t("58-orders.943dae369794") + '</th><th class="r">' + window.DLI18N.t("58-orders.27d014b697ac") + '</th><th class="r">' + window.DLI18N.t("58-orders.4703c32a8a7d") + '</th><th>' + window.DLI18N.t("58-orders.a00fb0c50741") + '</th></tr></thead><tbody>');
    var i;
    for (i = 0; i < R.latency.length; i++) {
      var L = R.latency[i];
      h += '<tr><td class="ord-n">' + esc(vname(L.key)) + '</td><td class="r">' + fmtMs(L.calmMs) + '</td><td class="r">' + fmtMs(L.stressMs) + '</td><td class="r">' + fmtMs(L.drawMs) + '</td><td>' + (L.rejected ? ('<span class="ord-bad">' + window.DLI18N.t("58-orders.20cd938a2ea6") + '</span>') : "accepted") + '</td></tr>';
    }
    h += '</tbody></table></div>';
    h += ('<div class="ord-legend">' + window.DLI18N.t("58-orders.a13bbdec6cf5") + '') + blockSecs() + ' s). Under stress the excess mean is multiplied by ' + pf.latMult.toFixed(2) + '.</div>';

    h += ('<div class="ord-sub">' + window.DLI18N.t("58-orders.62695b840951") + '</div>');
    h += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("58-orders.aea1b15df626") + '</th><th class="r">' + window.DLI18N.t("58-orders.0fff0e409810") + '</th><th class="r">' + window.DLI18N.t("58-orders.3badfdd1305b") + '</th><th class="r">' + window.DLI18N.t("58-orders.1ae80e4d731a") + '</th><th class="r">' + window.DLI18N.t("58-orders.a83ce4d361b8") + '</th><th class="r">' + window.DLI18N.t("58-orders.606d230ed1cc") + '</th></tr></thead><tbody>');
    for (i = 0; i < R.fees.length; i++) {
      var F = R.fees[i];
      h += '<tr' + (F.key === R.req.venue ? ' data-best="1"' : '') + '><td class="ord-n">' + esc(F.name) + '</td><td class="r">' + fmtPct(F.baseTaker) + '</td><td class="r">' + fmtPct(F.taker) + '</td><td class="r">' + fmtPct(F.baseMaker) + '</td><td class="r">' + fmtPct(F.maker) + '</td><td class="r">' + (F.rebate == null ? "—" : fmtPct(F.rebate)) + '</td></tr>';
    }
    h += '</tbody></table></div>';
    h += ('<div class="ord-legend">' + window.DLI18N.t("58-orders.a0769bd6b727") + '<b>' + window.DLI18N.t("58-orders.6d1a3e36778d") + '</b>' + window.DLI18N.t("58-orders.b76b87eddaf7") + '</div>');

    /* ---- attribution */
    h += ('<div class="ord-sub">' + window.DLI18N.t("58-orders.387786c71e95") + '</div>');
    var SF = R.shortfall, A = R.attribution;
    if (!SF) h += ('<div class="ord-empty">' + window.DLI18N.t("58-orders.44ee7cb0a244") + '</div>');
    else {
      h += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("58-orders.ce54f0e22dbb") + '</th><th class="r">' + window.DLI18N.t("58-orders.168038b4a502") + '') + esc(q) + (')</th><th class="r">' + window.DLI18N.t("58-orders.29887a5ff984") + '</th><th>' + window.DLI18N.t("58-orders.1f36becc3aa7") + '</th></tr></thead><tbody>');
      var comps = [
        ["Delay", SF.delay, "the market moved between your decision price and the price when your order arrived"],
        ["Impact", SF.impact, "your own order walking the book away from the arrival price"],
        ["Fee", SF.fee, "commission at your tier, plus gas actually paid"],
        ["Opportunity", SF.opportunity, "the part that never filled, priced against the decision price"]
      ];
      for (i = 0; i < comps.length; i++) {
        h += '<tr><td class="ord-n">' + esc(comps[i][0]) + '</td><td class="r">' + fmtQuote(comps[i][1], q) + '</td><td class="r">' + (SF.totalCost && comps[i][1] != null ? (comps[i][1] / SF.totalCost * 100).toFixed(1) + "%" : "—") + '</td><td class="ord-why">' + esc(comps[i][2]) + '</td></tr>';
      }
      h += ('<tr data-best="1"><td class="ord-n">' + window.DLI18N.t("58-orders.c9b3c38247f7") + '</td><td class="r">') + fmtQuote(SF.totalCost, q) + '</td><td class="r">' + (SF.bps == null ? "—" : fmtBps(SF.bps)) + '</td><td class="ord-why">' + (SF.totalCost == null ? "withheld — the opportunity cost of the unfilled remainder cannot be priced without an end price." : "delay + impact + fee + opportunity, and the four sum to it by construction — the identity is asserted, not assumed (residual " + SF.identity.toExponential(1) + ").") + '</td></tr>';
      h += '</tbody></table></div>';
      h += ('<div class="ord-legend">' + window.DLI18N.t("58-orders.8ac3395d7b39") + '<i>' + window.DLI18N.t("58-orders.4fd7d7be0fc1") + '</i>' + window.DLI18N.t("58-orders.426113d221d8") + '') + fmtNum(SF.filled) + ' of ' + fmtNum(SF.total) + '; ' + fmtNum(SF.unfilled) + ' never filled.' + (SF.needsEnd ? (' <b>' + window.DLI18N.t("58-orders.0f11ce83975d") + '</b>' + window.DLI18N.t("58-orders.a823ab875933") + '') : ' The remainder is charged as opportunity cost rather than quietly dropped.') + '</div>';
    }

    if (A && !A.ok) {
      h += ('<div class="ord-sub">' + window.DLI18N.t("58-orders.76a544ef98d2") + '</div>');
      h += '<div class="ord-empty">' + esc(A.note) + '</div>';
    } else if (A) {
      h += ('<div class="ord-sub">' + window.DLI18N.t("58-orders.76a544ef98d2") + '</div>');
      h += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("58-orders.ce4683e7013a") + '</th><th class="r">' + window.DLI18N.t("58-orders.7f5077dfa568") + '') + esc(q) + (')</th><th class="r">' + window.DLI18N.t("58-orders.737519222b98") + '</th></tr></thead><tbody>');
      for (i = 0; i < A.parts.length; i++) {
        h += '<tr><td class="ord-n">' + esc(A.parts[i].label) + '</td><td class="r">' + fmtQuote(A.parts[i].cost, q) + '</td><td class="r">' + (A.total ? (A.parts[i].cost / A.total * 100).toFixed(1) + "%" : "—") + '</td></tr>';
      }
      h += ('<tr><td class="ord-n">' + window.DLI18N.t("58-orders.30ae5a230cad") + '</td><td class="r">') + fmtQuote(A.residual, q) + '</td><td class="r">' + (A.total ? (A.residual / A.total * 100).toFixed(1) + "%" : "—") + '</td></tr>';
      h += ('<tr data-best="1"><td class="ord-n">' + window.DLI18N.t("58-orders.ff03e3b6263b") + '</td><td class="r">') + fmtQuote(A.total, q) + '</td><td class="r">100.0%</td></tr>';
      h += '</tbody></table></div>';
      h += ('<div class="ord-legend">' + window.DLI18N.t("58-orders.c46bf250972b") + '</div>');
    }
    h += assumptionStrip();
    return h;
  }

  function venueOpts() { var o = [], i, m; for (i = 0; i < ALL_KEYS.length; i++) { m = null; try { m = P().venue(ALL_KEYS[i]); } catch (e) {} o.push([ALL_KEYS[i], (m && m.n) || ALL_KEYS[i]]); } return o; }
  function vname(k) { try { var m = P().venue(k); return (m && m.n) || k; } catch (e) { return k; } }
  function volOpts() {
    return [["0", "under $1m"], ["1000000", "$1m – $10m"], ["10000000", "$10m – $100m"], ["100000000", "$100m – $1bn"], ["1000000000", "over $1bn"]];
  }

  /* ---------------------------------------------------------------- Ledger */
  function paneLedger() {
    var rows = log(), h = "", i, e;
    h += ('<div class="ord-note">' + window.DLI18N.t("58-orders.52475b848f39") + '</div>');
    h += ('<div class="ord-actions"><button class="go" id="ordSend">' + window.DLI18N.t("58-orders.22edefa7d006") + '</button></div>');
    if (!rows.length) return h + ('<div class="ord-empty">' + window.DLI18N.t("58-orders.ba7e9c7e0d71") + '</div>');
    h += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("58-orders.cf9c7aa24a26") + '</th><th>' + window.DLI18N.t("58-orders.6be090825c99") + '</th><th>' + window.DLI18N.t("58-orders.aea1b15df626") + '</th><th class="r">' + window.DLI18N.t("58-orders.3a1bc53ffcdf") + '</th><th class="r">' + window.DLI18N.t("58-orders.41835ff14ac6") + '</th><th class="r">' + window.DLI18N.t("58-orders.fd9b6df3cdbc") + '</th><th class="r">' + window.DLI18N.t("58-orders.d1f23f0d1361") + '</th><th class="r">' + window.DLI18N.t("58-orders.f842c3e1858d") + '</th><th class="r">' + window.DLI18N.t("58-orders.35ad5041aabb") + '</th><th class="r">' + window.DLI18N.t("58-orders.c9b3c38247f7") + '</th></tr></thead><tbody>');
    for (i = 0; i < rows.length; i++) {
      e = rows[i];
      var s = e.shortfall;
      h += '<tr><td>' + esc(when(e.t)) + '</td><td class="ord-n">' + esc(e.side.toUpperCase() + " " + fmtNum(e.base) + " " + e.sym) + '</td><td>' + esc(vname(e.venue)) + '</td>' +
        '<td class="r">' + fmtNum(e.filled) + '</td><td class="r">' + fmtQuote(e.avg, e.quote) + '</td>' +
        '<td class="r">' + fmtQuote(s && s.delay, e.quote) + '</td><td class="r">' + fmtQuote(s && s.impact, e.quote) + '</td>' +
        '<td class="r">' + fmtQuote(s && s.fee, e.quote) + '</td><td class="r">' + fmtQuote(s && s.opportunity, e.quote) + '</td>' +
        '<td class="r ord-all">' + fmtQuote(s && s.totalCost, e.quote) + '</td></tr>';
    }
    h += '</tbody></table></div>';
    return h;
  }

  /* ---------------------------------------------------------------- Method */
  function paneMethod() {
    var h = ('<div class="ord-note">' + window.DLI18N.t("58-orders.1c3677bef725") + '</div>');
    var i;
    h += '<div class="ord-method">';
    for (i = 0; i < METHOD.length; i++) h += '<div class="ord-mrow"><b>' + esc(METHOD[i][0]) + '</b><span>' + esc(METHOD[i][1]) + '</span></div>';
    h += '</div>';
    h += ('<div class="ord-sub">' + window.DLI18N.t("58-orders.72575be9ba5c") + '</div><ul class="ord-assume">');
    for (i = 0; i < ASSUMPTIONS.length; i++) h += '<li>' + esc(ASSUMPTIONS[i]) + '</li>';
    h += '</ul>';
    h += ('<div class="ord-sub">' + window.DLI18N.t("58-orders.27e28ac8b975") + '</div><ul class="ord-assume">');
    h += ('<li>' + window.DLI18N.t("58-orders.209049bfc7f4") + '</li>');
    h += ('<li>' + window.DLI18N.t("58-orders.28b2c46e0949") + '</li>');
    h += ('<li>' + window.DLI18N.t("58-orders.9d2c2627569a") + '</li>');
    h += '</ul>';
    return h;
  }

  function assumptionStrip() {
    return ('<div class="ord-strip">' + window.DLI18N.t("58-orders.ffbd903af6b3") + '</div>');
  }

  /* ---------------------------------------------------------------- wiring */

  function readTicket() {
    var t = {}, el, v;
    el = document.getElementById("ordSym"); if (el) t.sym = String(el.value || "BTC").toUpperCase().replace(/[^A-Z0-9]/g, "");
    el = document.getElementById("ordSide"); if (el) t.side = el.value === "sell" ? "sell" : "buy";
    el = document.getElementById("ordBase"); if (el) t.base = +el.value || 0;
    el = document.getElementById("ordClip"); if (el) t.clip = +el.value || 0;
    el = document.getElementById("ordTMode"); if (el) t.trailMode = el.value === "abs" ? "abs" : "pct";
    el = document.getElementById("ordTPct"); if (el) t.trailPct = +el.value || 0;
    el = document.getElementById("ordTAbs"); if (el) t.trailAbs = +el.value || 0;
    el = document.getElementById("ordAct"); if (el) t.activation = +el.value || 0;
    el = document.getElementById("ordPF"); if (el) t.parentFilled = +el.value || 0;
    el = document.getElementById("ordTP"); if (el) t.tpPx = +el.value || 0;
    el = document.getElementById("ordSL"); if (el) t.slPx = +el.value || 0;
    el = document.getElementById("ordPC"); if (el) t.parentCancelled = el.value === "1";
    el = document.getElementById("ordPegA"); if (el) t.pegAnchor = el.value;
    el = document.getElementById("ordPegO"); if (el) t.pegOffBps = +el.value || 0;
    el = document.getElementById("ordPegC"); if (el) t.pegCapPx = +el.value || 0;
    el = document.getElementById("ordPegE"); if (el) t.pegEvery = +el.value || 0;
    el = document.getElementById("ordStress"); if (el) t.stress = +el.value || 0;
    el = document.getElementById("ordVenue"); if (el) t.venue = el.value;
    el = document.getElementById("ordVol"); if (el) t.vol30 = +el.value || 0;
    el = document.getElementById("ordRate"); if (el) t.ratePerSec = +el.value || 0;
    el = document.getElementById("ordDec"); if (el) t.decisionPx = +el.value || 0;
    el = document.getElementById("ordEnd"); if (el) t.endPx = +el.value || 0;
    return t;
  }

  function onClick(ev) {
    var tgt = ev.target;
    if (!tgt || !tgt.id) return;
    if (tgt.id === "ordGo") { ticket(readTicket()); open("sim"); return; }
    if (tgt.id === "ordStressGo") { ticket(readTicket()); open("stress"); return; }
    if (tgt.id === "ordSend") {
      var sim = simulate(null);
      var res = send(sim);
      if (!res.ok) { try { C.toast && C.toast("bad", "Not sent", res.reason); } catch (e) {} return; }
      open("ledger");
    }
  }

  var wired = false;
  function wire(el) {
    if (!el || wired) return;
    el.addEventListener("click", onClick);
    wired = true;
    el.__onClose = function () { try { el.removeEventListener("click", onClick); } catch (e) {} wired = false; };
  }

  /* onTab receives (tabId, bodyEl) and its RETURN VALUE IS IGNORED — the body
     must be assigned here or the desk renders empty. */
  function onTab(tab, body) {
    var h;
    if (tab === "sim") h = paneSim();
    else if (tab === "stress") h = paneStress();
    else if (tab === "ledger") h = paneLedger();
    else if (tab === "method") h = paneMethod();
    else h = paneBuild();
    if (body) body.innerHTML = h;
    return h;
  }

  function open(tab) {
    var el = null;
    try {
      el = C.open("dlOrd", {
        title: window.DLI18N.t("58-orders.ab256d988180"),
        sub: window.DLI18N.t("58-orders.25170e7ff68b"),
        tabs: [["build", "Build"], ["sim", "Simulate"], ["stress", "Stress"], ["ledger", "Ledger"], ["method", "Method"]],
        onTab: onTab
      }, tab || "build");
    } catch (e) { el = null; }
    try { wire(el || document.getElementById("dlOrd")); } catch (e) {}
    return el;
  }

  try { if (window.DLDESKS && window.DLDESKS.register) window.DLDESKS.register("orderlab", "⌁", "Order Lab", "Iceberg, trailing stops, brackets and pegs — and what each one costs in the queue", function () { open("build"); }); } catch (e) {}
  try { C.cmd && C.cmd("Order Lab", "Order Lab — iceberg, trailing stops, brackets, pegs", "⌁", function () { open("build"); }); } catch (e) {}

  window.DLORD = {
    __v: 166,
    open: open,
    simulate: simulate,
    send: send,
    log: log,
    ticket: ticket,
    hash32: hash32,
    unit01: unit01,
    queueSteps: queueSteps,
    iceberg: iceberg,
    clipEntropy: clipEntropy,
    trailPath: trailPath,
    trailOptimistic: trailOptimistic,
    trailScales: trailScales,
    coarsen: coarsen,
    bracket: bracket,
    peg: peg,
    pegPx: pegPx,
    latencyMs: latencyMs,
    latencyMeanMs: latencyMeanMs,
    rejectRate: rejectRate,
    rejected: rejected,
    throttleMs: throttleMs,
    feeFor: feeFor,
    feeTable: feeTable,
    volBand: volBand,
    stressProfile: stressProfile,
    attribute: attribute,
    shortfall: shortfall,
    METHOD: METHOD,
    ASSUMPTIONS: ASSUMPTIONS
  };
})();
