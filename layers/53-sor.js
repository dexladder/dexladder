// owns: smart order routing comparison
// reads: DLAPP, DLCORE, DLDESKS, browser DOM
// emits: DLSOR
/* ============================================================================
   DexLadder — DLSOR · layer 53 · v165 "the route"
   SMART ORDER ROUTING + EXECUTION COMPARISON

   The question this desk exists to answer: for THIS size, right now, do I hit
   the book or the pool — and if I split it, where does each slice belong?

   The app already had two good surfaces that never spoke to each other: a
   volume-anchored 40-level book that orders actually walk, and an AMM curve
   with gas and MEV priced honestly. This layer quotes one order against all of
   them at once, prints the difference line by line, then splits the order by
   marginal cost and works each slice where that slice fills best.

   LAWS OBSERVED
     · a quote is a question, not a trade — quote() and route() are PURE:
       no balance write, no order, no persisted state, no clock inside the math
     · deterministic — same request, same numbers. No random anywhere in this
       layer; the gas signal is resolved OUTSIDE the quote path and cached, so
       two adjacent quotes cannot disagree
     · a missing figure stays missing — null, never 0 wearing a price's clothes
     · money moves only through the engine — execFill / chargeNetwork. This
       layer never assigns to a balance
     · no storage key of its own — state is the v154 bucket via DLCORE.X()
     · nothing is compiled at runtime, no timers, no observers
     · Day + Night — every rule lives in layers/v154.css, paired. No tokens here
   ============================================================================ */
(function () {
  "use strict";
  if (window.DLSOR && window.DLSOR.__v) return;

  var C = window.DLCORE;
  if (!C) return;

  /* -------------------------------------------------------------- the engine */
  function P() { try { return window.DLAPP && window.DLAPP.paper; } catch (e) { return null; } }
  function LP() { try { return window.DLAPP && window.DLAPP.legacy && window.DLAPP.legacy.paper; } catch (e) { return null; } }

  /* --------------------------------------------------------------- constants */

  /* The four book venues carry the REAL published taker schedules — they come
     from the engine's own VENUES table, not a second copy kept here. */
  var BOOK_KEYS = ["binance", "coinbase", "kraken", "hyperliquid"];
  var AMM_KEY = "dexamm";
  var ALL_KEYS = BOOK_KEYS.concat([AMM_KEY]);

  /* Depth share per book venue. THIS IS AN ASSUMPTION, and the desk says so
     everywhere it is used. The four shares sum to exactly 1, so the depth of
     all four book venues together equals the one depth figure the rest of the
     app models for this symbol — only the division between them is invented. */
  var VENUE_SHARE = { binance: 0.55, coinbase: 0.15, kraken: 0.10, hyperliquid: 0.20 };

  var SLICES = 160;          /* resolution of the marginal-cost split */
  var EPS = 1e-12;
  var TOL_FLOOR = 1e-9;

  var ASSUMPTIONS = [
    "The order book is MODELLED, not a venue feed. It is synthesised from live price and 24h volume — 40 levels a side, spread tiered by volume, depth anchored at 4bp of 24h volume (floor $1,800) — and it is the book the trading ticket walks, SCALED to each venue's assumed share of it. No exchange publishes it to this app.",
    "Depth shares between the four book venues — Binance 55%, Hyperliquid 20%, Coinbase 15%, Kraken 10% — are a FIXED ASSUMPTION, not a per-venue measurement. Their sum is exactly the depth the app models for the symbol; only the division between them is invented. Treat the ranking between two book venues as a fee comparison, not a liquidity comparison.",
    "Venue FEES are real published schedules (Binance 0.10% taker, Coinbase Advanced 0.60%, Kraken 0.26%, Hyperliquid 0.045%, AMM 0.30%), read from the engine rather than copied. These are retail tiers; yours will differ. One caveat worth knowing: Hyperliquid's 0.045% is its PERP taker rate, and this desk models it as a spot book venue with no funding — so it looks cheaper here than a spot fill there would be.",
    "The AMM pool is synthesised too: its TVL is derived from 24h volume or market cap, and the swap is a SINGLE-RANGE step. There is no tick data, no tick crossing, and no multi-hop routing anywhere in this build. A swap that would leave the range is truncated and flagged, not carried into the next tick.",
    "Book depth and pool depth come from the SAME input — 24h volume — so their ratio is a fixed modelling constant (the pool is about 50x the book's depth anchor, times a liquidity-tier step), not a measurement. For a major pair that makes the modelled pool roughly 20x deeper than all four book venues together, which means large orders route to the pool partly by construction. Read book-vs-pool as a demonstration of the mechanics, not as a claim about where BTC is really deeper today.",
    "Gas is priced at the modelled gwei times the tier multiplier, 150,000 units per swap, converted through live ETH. Confirmation time is the expected number of blocks GIVEN THE TRANSACTION IS MINED, from the engine's own fate table — it is not a promise, and the timeout branch, whose odds are printed separately, charges gas for a trade that never happened.",
    "MEV exposure is only computed above a 2% slippage tolerance, because below that the simulated bot cannot profit, and only when the account has MEV simulation switched on. It is ADVISORY: it is shown as a cost but is deliberately NOT inside the all-in figure and NOT inside the split's objective, so a sandwich-exposed route is not automatically avoided. A blank cell means the bot had no room or the switch is off, not that the risk does not exist.",
    "Connect a fork node and its pool joins the table as a real venue — real current price and real in-range liquidity. That is the only row on this desk backed by an actual chain."
  ];

  var METHOD = [
    ["The quote", "Every venue is asked the same question: fill this size, this side, right now. Book venues walk the 40-level book level by level. The AMM venue walks the curve. Nobody gets a blended average. Quoting is reproducible within a market tick — it draws no random numbers and reads no clock — but it does read live prices, so it is a pure function of the request AND the current tick, not of the request alone."],
    ["All-in cost", "Average fill × size, plus the venue's taker fee, plus gas where gas exists — and on a sell, minus both. Positive friction always means cost, whichever side you are on. That single number is what the ranking sorts on, not the headline price, which is what makes an expensive venue look cheap."],
    ["Price impact", "Average execution against the pre-trade mid, fee excluded, in basis points. The fee is billed separately so you can see which of the two is actually hurting you."],
    ["The split", "Cost curves are built per venue at 160 breakpoints, then the order is filled one slice at a time into whichever venue has the cheapest NEXT slice. Each curve is CONVEX on a buy and concave on a sell — eating deeper into a book or further along a curve is never cheaper — and for that shape, equalising the marginal cost is the optimum OF THAT 160-POINT GRID. It is exact on the grid and for the gas-free objective; gas is then handled by the removal pass below, which searches one venue at a time and is not guaranteed optimal when two gas-bearing venues are in play."],
    ["Fixed costs", "Gas is a fixed cost per venue used, so the optimal split is re-tested with each gas-bearing venue removed. A leg that cannot pay its own gas is dropped, and the reason is printed. This is the lesson that transfers: a better price on a small slice is not a better trade."],
    ["The comparison", "The plan is measured against the best single venue that could have filled the order alone, and if the split comes out worse once gas is counted, the single venue is what gets offered instead. Read the saving with care: because every book venue is one modelled book scaled by an assumed share, beating ONE of them is partly arithmetic. So the desk also prices the order against the WHOLE unscaled book at the cheapest book fee — whatever it saves beyond that line is the part that is about routing rather than about our share assumption."],
    ["Realised vs predicted", "A sent order stores its prediction. When the fills land, the ledger prints both, and the gap. A model that is never scored is a model you cannot learn from."]
  ];

  /* ------------------------------------------------- gas, resolved off-path */
  /* Deliberately NOT resolved inside quote(): a quote must be reproducible, so
     the signal is cached here and refreshed only on an explicit call. */
  var GAS = { gwei: 5, src: "fallback", cong: "calm", at: 0 };

  function refreshGas() {
    var p = P();
    GAS.src = "fallback";
    try { if (p && p.FALLBACK_GWEI > 0) GAS.gwei = p.FALLBACK_GWEI; } catch (e) {}
    /* If the app has a live signal for this session, prefer it and say so.
       gasEstimate() already carries the ACCOUNT's tier multiplier, so backing
       out a raw gwei means dividing that multiplier out again — otherwise every
       figure on this desk is wrong by TIER_MULT[account tier], in the direction
       that makes gas look worse on a high tier and cheaper on a low one. */
    try {
      var lp = LP();
      if (lp && typeof lp.gasEstimate === "function") {
        var usd = lp.gasEstimate("USDT");
        var eth = ethUSD();
        var units = unitsSwap();
        var acct = 1;
        try { acct = tierMult(String(lp.tierOf(S))); } catch (e) { acct = 1; }
        if (!(acct > 0)) acct = 1;
        if (usd > 0 && eth > 0 && units > 0) {
          GAS.gwei = usd / (units * 1e-9 * eth) / acct;
          GAS.src = "live";
        }
      }
    } catch (e) {}
    try {
      var sig = P() && P().signal ? P().signal(GAS.gwei, [], 0, GAS.src) : null;
      if (sig && P().congestion) GAS.cong = String(P().congestion(sig) || "calm");
    } catch (e) { GAS.cong = "calm"; }
    GAS.at = C.now ? C.now() : 0;
    return GAS;
  }

  function unitsSwap() { try { return P().GAS_UNITS.swap; } catch (e) { return 150000; } }
  function tierMult(t) { try { var m = P().TIER_MULT; return m[t] || m.medium || 1; } catch (e) { return 1; } }
  function ethUSD() { try { var c = C.coin("ETH"); return (c && +c.price) || 0; } catch (e) { return 0; } }

  function gasQuoteFor(quoteSym, tier, units) {
    var p = P(), eth = ethUSD(), qUSD = quoteUSD(quoteSym);
    if (!p || !(eth > 0) || !(qUSD > 0)) return null;   /* null propagates */
    try { return p.gasCost(units || unitsSwap(), GAS.gwei * tierMult(tier), eth, qUSD); }
    catch (e) { return null; }
  }

  /* null, not 1. A quote currency we cannot price is a missing figure, and
     pretending it is 1 turns every number on the desk into fiction. */
  function quoteUSD(sym) {
    if (!sym || sym === "USDT" || sym === "USD") return 1;
    try { var c = C.coin(sym), v = c && +c.price; return v > 0 ? v : null; } catch (e) { return null; }
  }

  /* Expected confirmation seconds, straight off the engine's fate table. */
  function fateOdds(tier) {
    try {
      var tab = P().FATE_TABLE[GAS.cong][tier] || P().FATE_TABLE[GAS.cong].medium;
      return { inc: tab[0], pend: tab[1], out: tab[2] };
    } catch (e) { return { inc: 0.97, pend: 0.03, out: 0 }; }
  }
  function blockSecs() { try { return P().BLOCK_SECONDS || 12; } catch (e) { return 12; } }

  /* ------------------------------------------------------- market primitives */

  function statsOf(sym) {
    var c = null;
    try { c = C.coin(sym); } catch (e) { c = null; }
    if (!c || !(+c.price > 0)) return null;
    return { vol24: +c.vol || 0, mcap: +c.mcap || 0, chg24: +c.c24 || 0, price: +c.price };
  }

  function midOf(sym, q) {
    var s = statsOf(sym);
    if (!s) return null;
    if (q === "USDT" || q === "USD" || !q) return s.price;
    var qp = quoteUSD(q);
    return qp > 0 ? s.price / qp : null;
  }

  /* One book, share-scaled. Scaling every level's size by the venue's share is
     exactly equivalent to building the book at that fraction of the modelled
     depth, because the engine normalises depth linearly. */
  function bookFor(sym, q, mid, st, share, at) {
    var p = P();
    if (!p) return null;
    try {
      var raw = p.buildBook(sym, q, mid, st, at);
      if (!raw) return null;
      var live = p.liveBook(raw, at);
      var scale = function (arr) {
        var out = [], i;
        for (i = 0; i < arr.length; i++) out.push({ p: arr[i].p, a: arr[i].a * share, i: arr[i].i });
        return out;
      };
      return { mid: live.mid, asks: scale(live.asks), bids: scale(live.bids) };
    } catch (e) { return null; }
  }

  function poolFor(st, mid, q, rangePct) {
    var p = P();
    if (!p) return null;
    try {
      var spec = p.poolSpec(st, AMM_KEY, rangePct || null);
      if (!spec || !(spec.tvlUSD > 0)) return null;
      /* poolFromTVL's second argument is total pool value in QUOTE units. */
      var tvlQuote = spec.tvlUSD / quoteUSD(q);
      var pool = p.poolFromTVL(mid, tvlQuote, spec.rangePct || null);
      return pool ? { pool: pool, spec: spec } : null;
    } catch (e) { return null; }
  }

  /* ----------------------------------------------------- raw cumulative cost */
  /* rawAt(v, qty) → { filled, raw } where `raw` is quote SPENT on a buy and
     quote RECEIVED on a sell, both fee-exclusive and gas-exclusive. */

  function rawAt(v, side, qty) {
    var p = P();
    if (!p || !(qty > 0)) return { filled: 0, raw: 0, exhausted: false };
    if (v.kind === "book") {
      try {
        var w = p.walk(v.book, side, qty, 0);
        if (!w) return { filled: 0, raw: 0, exhausted: true };
        return { filled: w.filled, raw: w.cost, exhausted: !!w.exhausted };
      } catch (e) { return { filled: 0, raw: 0, exhausted: true }; }
    }
    try {
      var s = p.swap(v.pool, side, qty);
      if (!s) return { filled: 0, raw: 0, exhausted: true };
      return { filled: s.filled, raw: s.quote, exhausted: !!s.exhausted, p1: s.p1 };
    } catch (e) { return { filled: 0, raw: 0, exhausted: true }; }
  }

  function capOf(v, side) {
    var p = P();
    if (v.kind === "amm") {
      try { var m = p.maxBase(v.pool, side); return m > 0 && isFinite(m) ? m * (1 - 1e-9) : Infinity; }
      catch (e) { return Infinity; }
    }
    var arr = side === "buy" ? v.book.asks : v.book.bids, t = 0, i;
    for (i = 0; i < arr.length; i++) t += arr[i].a;
    return t;
  }

  /* all-in for a venue at qty: fee applied on the raw, gas added once. */
  function allInAt(v, side, qty, tier) {
    var r = rawAt(v, side, qty);
    if (!(r.filled > EPS)) return { filled: 0, allIn: null, raw: 0, fee: 0, exhausted: true };
    var fee = r.raw * v.feeRate;
    var gas = v.gasQuote || 0;
    var allIn = side === "buy" ? r.raw + fee + gas : r.raw - fee - gas;
    return { filled: r.filled, allIn: allIn, raw: r.raw, fee: fee, exhausted: r.exhausted, p1: r.p1 };
  }

  /* ------------------------------------------------------------ the roster */

  function venues() {
    var p = P(), out = [], i, k, f;
    for (i = 0; i < ALL_KEYS.length; i++) {
      k = ALL_KEYS[i];
      f = null;
      try { f = p ? p.venueFees(k).taker : null; } catch (e) { f = null; }
      var meta = null;
      try { meta = p ? p.venue(k) : null; } catch (e) { meta = null; }
      out.push({
        key: k,
        name: (meta && meta.n) || k,
        venueClass: k === AMM_KEY ? "amm" : "book",
        feeRate: f,
        depthShare: k === AMM_KEY ? null : VENUE_SHARE[k],
        schedule: (meta && meta.d) || ""
      });
    }
    return out;
  }

  function forkVenue() {
    try {
      var fk = window.DLAPP && window.DLAPP.fork;
      var pool = fk && fk.pool ? fk.pool() : null;
      if (!pool) return null;
      var fv = fk.routed ? fk.routed() : null;
      return {
        key: "fork", name: (fv && fv.n) || "Forked pool", venueClass: "fork",
        feeRate: (fv && fv.feeRate != null) ? fv.feeRate : 0.003, pool: pool
      };
    } catch (e) { return null; }
  }

  /* ---------------------------------------------------------------- quote() */

  function quote(req) {
    req = req || {};
    var sym = String(req.sym || "BTC").toUpperCase();
    var q = String(req.quote || "USDT").toUpperCase();
    var side = req.side === "sell" ? "sell" : "buy";
    var base = +req.base;
    var tier = req.tier === "low" || req.tier === "high" ? req.tier : "medium";
    var tolPct = +req.tolerancePct > 0 ? +req.tolerancePct : 0.5;
    var at = req.at != null ? +req.at : 0;
    var want = req.venues && req.venues.length ? req.venues : null;

    var st = statsOf(sym), mid = midOf(sym, q);
    if (!st || !(mid > 0)) {
      return {
        sym: sym, quote: q, side: side, base: base > 0 ? base : null, mid: null, at: at,
        venues: [], note: "No market for " + sym + "/" + q + " — nothing to quote. A missing market stays missing here; it does not become a zero.",
        notes: ["no market"]
      };
    }
    if (!(base > 0)) {
      return { sym: sym, quote: q, side: side, base: null, mid: mid, at: at, venues: [], note: window.DLI18N.t("53-sor.f28779674971"), notes: ["no size"] };
    }

    var pooled = poolFor(st, mid, q, req.rangePct);
    var fk = forkVenue();
    var roster = venues(), rows = [], i;

    for (i = 0; i < roster.length; i++) {
      var r = roster[i];
      if (want && want.indexOf(r.key) < 0) continue;
      /* No fee rate means we cannot price the venue. A null rate used to fall
         through arithmetic as zero, which made the venue free, ranked it first
         and won it the whole order. Skip it instead. */
      if (!(typeof r.feeRate === "number" && isFinite(r.feeRate) && r.feeRate >= 0 && r.feeRate < 1)) continue;
      var v = null;
      if (r.venueClass === "book") {
        var bk = bookFor(sym, q, mid, st, VENUE_SHARE[r.key], at);
        if (!bk) continue;
        v = { key: r.key, name: r.name, kind: "book", venueClass: "book", feeRate: r.feeRate, book: bk, gasQuote: 0 };
      } else {
        if (!pooled) continue;
        v = { key: r.key, name: r.name, kind: "amm", venueClass: "amm", feeRate: r.feeRate, pool: pooled.pool, spec: pooled.spec, gasQuote: gasQuoteFor(q, tier, null) || 0 };
      }
      rows.push(row(v, side, base, mid, tolPct, tier, st, q));
    }

    if (fk && (!want || want.indexOf("fork") >= 0)) {
      rows.push(row({ key: "fork", name: fk.name, kind: "amm", venueClass: "fork", feeRate: fk.feeRate, pool: fk.pool, gasQuote: gasQuoteFor(q, tier, null) || 0 }, side, base, mid, tolPct, tier, st, q));
    }

    rank(rows, side);
    return { sym: sym, quote: q, side: side, base: base, mid: mid, at: at, tier: tier, tolerancePct: tolPct, gas: { gwei: GAS.gwei, src: GAS.src, congestion: GAS.cong }, venues: rows, notes: [] };
  }

  function row(v, side, base, mid, tolPct, tier, st, q) {
    var cap = capOf(v, side);
    var a = allInAt(v, side, Math.min(base, cap), tier);
    var filled = a.filled, notes = [];
    var avg = filled > EPS ? (a.raw / filled) : null;
    var impact = avg != null ? safeSlip(side, avg, mid) : null;
    var remaining = Math.max(0, base - filled);
    var allIn = a.allIn;

    if (v.venueClass === "book") notes.push("depth share " + Math.round(VENUE_SHARE[v.key] * 100) + "% — an assumption, not a measurement");
    if (v.venueClass === "amm") notes.push("single-range swap, no tick crossing");
    if (v.venueClass === "fork") notes.push("real pool from your fork node — the only live venue here");
    if (a.exhausted || remaining > base * 1e-9) notes.push("cannot fill the whole size — " + fmtNum(remaining) + " left over");

    /* confirmation time + timeout exposure, from the fate table */
    var t2f = 0, timeoutOdds = null;
    if (v.gasQuote > 0) {
      var o = fateOdds(tier);
      /* Conditioned on being mined. Counting the timeout mass as zero blocks
         made a worse tier print a FASTER confirmation, which is backwards. */
      var mined = o.inc + o.pend;
      t2f = mined > 0 ? (o.inc * 1 + o.pend * 5) / mined * blockSecs() : 0;
      timeoutOdds = o.out;
      if (o.out > 0) notes.push("in " + (o.out * 100).toFixed(1) + "% of cases at this tier it is never mined — gas still burns");
    }

    var mev = mevFor(v, side, filled, mid, tolPct, q);
    if (mev && mev.exposed) notes.push("sandwich exposure at a " + tolPct + "% tolerance");

    var ref = filled > EPS ? filled * mid : null;
    var vsMid = (allIn != null && ref) ? (side === "buy" ? (allIn / ref - 1) : (1 - allIn / ref)) * 1e4 : null;

    return {
      key: v.key, name: v.name, venueClass: v.venueClass,
      avg: avg, filled: filled > EPS ? filled : null, remaining: filled > EPS ? remaining : null,
      capacity: isFinite(cap) ? cap : null,
      impactBps: impact, feeRate: v.feeRate, feeQuote: filled > EPS ? a.fee : null,
      gasQuote: v.gasQuote || 0, mev: mev,
      allInQuote: allIn, allInVsMidBps: vsMid,
      timeToFillSec: t2f, timeoutOdds: timeoutOdds,
      exhausted: !!(a.exhausted || remaining > base * 1e-9),
      notes: notes, rank: null
    };
  }

  function safeSlip(side, avg, mid) {
    var p = P();
    try { return p.slippageBps(side, avg, mid); }
    catch (e) { return Math.max(0, (side === "buy" ? avg - mid : mid - avg) / mid * 1e4); }
  }

  function mevFor(v, side, filled, mid, tolPct, q) {
    var p = P();
    var minTol = 2;
    try { minTol = p.MEV_MIN_TOLERANCE_PCT || 2; } catch (e) {}
    if (v.kind !== "amm" || !(filled > EPS)) return { exposed: false, reason: "book venues are not sandwiched in this model" };
    /* The rest of the app gates sandwiching behind an explicit opt-in that is
       off by default. A desk that predicts a cost the ticket would never charge
       is not being careful, it is being loud. */
    var on = false;
    try { on = !!LP().mevOn(S); } catch (e) { on = false; }
    if (!on) return { exposed: false, reason: "MEV simulation is switched off for this account — turn it on in Sovereign settings to price it" };
    if (!(tolPct > minTol)) return { exposed: false, reason: "at or under a " + minTol + "% tolerance the simulated bot has no room to profit" };
    try {
      var botGas = 2 * (gasQuoteFor(q, "high", null) || 0);
      var s = p.sandwich(v.pool, side, filled, mid, tolPct, v.feeRate, botGas);
      if (!s) return { exposed: false, reason: "no profitable sandwich at this size and tolerance" };
      return { exposed: true, extraQuote: s.extraQuote, botProfitQuote: s.botProfitQuote, frontBase: s.front && s.front.filled };
    } catch (e) { return { exposed: false, reason: "not modelled for this venue" }; }
  }

  function rank(rows, side) {
    var sortable = [], i;
    for (i = 0; i < rows.length; i++) if (rows[i].allInQuote != null) sortable.push(rows[i]);
    sortable.sort(function (a, b) {
      var an = a.allInQuote / (a.filled || 1), bn = b.allInQuote / (b.filled || 1);
      return side === "buy" ? an - bn : bn - an;
    });
    for (i = 0; i < sortable.length; i++) sortable[i].rank = i + 1;
  }

  /* ---------------------------------------------------------------- curve() */
  /* Cumulative all-in cost at `slices`+1 breakpoints, fee applied, gas left
     out (it is a fixed cost, handled by the pruning pass in route()). */

  /* Accepts a venue row straight off quote().venues, using the request that
     produced it (the last one, or an explicit ctx) for side/size/symbol. */
  function curve(vq, slices, ctx) {
    var n = Math.max(4, Math.min(1024, slices || SLICES));
    if (!vq || !vq.key) return null;
    var Q = ctx || LAST.quotes;
    if (!Q || !(Q.base > 0) || !(Q.mid > 0)) return null;
    var v = rebuild(vq, Q);
    if (!v) return null;
    var side = Q.side, base = Q.base, cap = capOf(v, side);
    var step = base / n, maxS = Math.max(0, Math.min(n, Math.floor(cap / step + 1e-9)));
    var cum = [0], i, r;
    for (i = 1; i <= maxS; i++) {
      r = rawAt(v, side, step * i);
      cum.push(side === "buy" ? r.raw * (1 + v.feeRate) : r.raw * (1 - v.feeRate));
    }
    return { key: v.key, step: step, slices: n, usableSlices: maxS, capacity: isFinite(cap) ? cap : null, cum: cum };
  }

  /* Turn a venue row back into a quotable venue object. */
  function rebuild(vr, Q) {
    var st = statsOf(Q.sym);
    if (!st) return null;
    if (vr.venueClass === "book") {
      var bk = bookFor(Q.sym, Q.quote, Q.mid, st, VENUE_SHARE[vr.key], Q.at || 0);
      return bk ? { key: vr.key, name: vr.name, kind: "book", venueClass: "book", feeRate: vr.feeRate, book: bk, gasQuote: 0 } : null;
    }
    if (vr.venueClass === "fork") {
      var fk = forkVenue();
      return fk ? { key: "fork", name: fk.name, kind: "amm", venueClass: "fork", feeRate: fk.feeRate, pool: fk.pool, gasQuote: vr.gasQuote || 0 } : null;
    }
    var pooled = poolFor(st, Q.mid, Q.quote, Q.rangePct);
    return pooled ? { key: vr.key, name: vr.name, kind: "amm", venueClass: "amm", feeRate: vr.feeRate, pool: pooled.pool, gasQuote: vr.gasQuote || 0 } : null;
  }

  /* ---------------------------------------------------------------- route() */

  function route(quotes, req) {
    req = req || {};
    var side = (quotes && quotes.side) || (req.side === "sell" ? "sell" : "buy");
    var base = +((quotes && quotes.base) || req.base);
    var mid = quotes && quotes.mid;
    var tier = (quotes && quotes.tier) || "medium";
    var q = (quotes && quotes.quote) || "USDT";
    var sym = (quotes && quotes.sym) || req.sym;
    var empty = {
      side: side, base: base > 0 ? base : null, legs: [], allInQuote: null, allInVsMidBps: null,
      savedVsBestSingleQuote: null, savedBps: null, dropped: [], remaining: base > 0 ? base : null,
      bestSingle: null, note: window.DLI18N.t("53-sor.f4c66a610b22")
    };
    if (!quotes || !quotes.venues || !quotes.venues.length || !(base > 0) || !(mid > 0)) return empty;

    /* rebuild the venue objects the cost curves need */
    var ctx = { sym: sym, quote: q, side: side, base: base, mid: mid, at: quotes.at || 0, rangePct: req.rangePct };
    var built = [], i, vr, v;
    for (i = 0; i < quotes.venues.length; i++) {
      vr = quotes.venues[i];
      if (vr.allInQuote == null) continue;
      v = rebuild(vr, ctx);
      if (v) built.push(v);
    }
    if (!built.length) return empty;

    var best = solve(built, side, base, tier, q);

    /* ---- fixed-cost pruning: a leg that cannot pay its own gas is dropped */
    var dropped = [], guard = 0;
    while (guard++ < 8) {
      var candidates = [], j;
      for (j = 0; j < best.legs.length; j++) {
        var lk = best.legs[j].key, lv = findV(built, lk);
        if (lv && lv.gasQuote > 0) candidates.push(lk);
      }
      if (!candidates.length) break;
      var improved = null;
      for (j = 0; j < candidates.length; j++) {
        var trial = withoutKey(built, candidates[j]);
        if (!trial.length) continue;
        var alt = solve(trial, side, base, tier, q);
        if (alt.allInQuote == null) continue;
        if (betterThan(alt.allInQuote, best.allInQuote, side, 1e-9) && alt.filled >= best.filled - base * 1e-9) {
          if (!improved || betterThan(alt.allInQuote, improved.plan.allInQuote, side, 0)) improved = { key: candidates[j], plan: alt, trial: trial };
        }
      }
      if (!improved) break;
      dropped.push({
        key: improved.key,
        reason: "its slice could not pay its own gas — dropping it left the order " + fmtQuote(Math.abs(improved.plan.allInQuote - best.allInQuote), q) + " better off"
      });
      built = improved.trial;
      best = improved.plan;
    }

    /* ---- the honest benchmark: the best SINGLE venue that could fill it all */
    var bestSingle = null;
    for (i = 0; i < quotes.venues.length; i++) {
      vr = quotes.venues[i];
      if (vr.allInQuote == null || vr.exhausted) continue;
      if (vr.filled == null || vr.filled < base * (1 - 1e-9)) continue;
      if (!bestSingle || betterThan(vr.allInQuote, bestSingle.allInQuote, side, 0)) bestSingle = { key: vr.key, name: vr.name, allInQuote: vr.allInQuote };
    }

    var saved = null, savedBps = null;
    if (bestSingle && best.allInQuote != null) {
      saved = side === "buy" ? bestSingle.allInQuote - best.allInQuote : best.allInQuote - bestSingle.allInQuote;
      savedBps = bestSingle.allInQuote !== 0 ? saved / Math.abs(bestSingle.allInQuote) * 1e4 : null;
    }

    /* If the split is WORSE than a single venue that could have filled it all,
       return that venue's plan instead. Offering a plan we have just measured
       as worse, under the words "saves nothing", was the wrong answer to our
       own arithmetic. */
    if (bestSingle && saved != null && saved < -Math.abs(bestSingle.allInQuote) * 1e-9) {
      var only = [];
      for (i = 0; i < built.length; i++) if (built[i].key === bestSingle.key) only.push(built[i]);
      if (only.length) {
        var single = solve(only, side, base, tier, q);
        if (single.allInQuote != null) {
          dropped.push({ key: "split", reason: "the split came out " + fmtQuote(-saved, q) + " worse than " + bestSingle.name + " alone once gas was counted, so the single venue is what is offered" });
          best = single;
          saved = 0; savedBps = 0;
        }
      }
    }

    /* The share artifact, stated rather than banked. Every book venue is the
       same modelled book scaled by an assumed share, so beating ONE of them on
       impact is partly arithmetic rather than routing. This prices the order
       against the whole unscaled book at the cheapest book fee it could have
       used: whatever the split saves beyond THAT is real. */
    var wholeBook = null;
    try {
      var st = statsOf(sym);
      var bk2 = bookFor(sym, q, mid, st, 1, quotes.at || 0);
      var cheapest = null;
      for (i = 0; i < quotes.venues.length; i++) {
        vr = quotes.venues[i];
        if (vr.venueClass !== "book") continue;
        if (cheapest == null || vr.feeRate < cheapest) cheapest = vr.feeRate;
      }
      if (bk2 && cheapest != null) {
        var w2 = allInAt({ key: "wholebook", kind: "book", venueClass: "book", feeRate: cheapest, book: bk2, gasQuote: 0 }, side, base, tier);
        if (w2.allIn != null) wholeBook = { allInQuote: w2.allIn, feeRate: cheapest, filled: w2.filled };
      }
    } catch (e) { wholeBook = null; }
    var savedReal = (wholeBook && best.allInQuote != null)
      ? (side === "buy" ? wholeBook.allInQuote - best.allInQuote : best.allInQuote - wholeBook.allInQuote) : null;

    var ref = best.filled > EPS ? best.filled * mid : null;
    var remaining = Math.max(0, base - best.filled);

    return {
      sym: sym, quote: q, side: side, base: base, mid: mid, tier: tier,
      legs: best.legs, allInQuote: best.allInQuote,
      allInVsMidBps: (best.allInQuote != null && ref) ? (side === "buy" ? (best.allInQuote / ref - 1) : (1 - best.allInQuote / ref)) * 1e4 : null,
      filled: best.filled, remaining: remaining > base * 1e-9 ? remaining : 0,
      exhausted: remaining > base * 1e-9,
      bestSingle: bestSingle, savedVsBestSingleQuote: saved, savedBps: savedBps,
      wholeBookQuote: wholeBook ? wholeBook.allInQuote : null,
      savedVsWholeBookQuote: savedReal,
      req: { sym: sym, quote: q, side: side, base: base, tier: tier, tolerancePct: req.tolerancePct || (quotes && quotes.tolerancePct) || 0.5, venues: (req.venues || (quotes && quotes.venues || []).map(function (x) { return x.key; })) },
      dropped: dropped,
      note: saved == null
        ? "No single venue could fill this size alone, so there is nothing to compare the split against."
        : (saved > Math.abs(best.allInQuote) * 1e-9
          ? "Splitting beats the best single venue by " + fmtQuote(saved, q) + "."
          : "Splitting saves nothing here — " + (bestSingle ? bestSingle.name : "one venue") + " alone is as good. Send it there.")
    };
  }

  /* ------------------------------------------------------------------------
     Marginal-cost water-filling.

     One UNIFORM slice size for every venue, so a marginal cost is directly
     comparable across venues without a per-unit rescale. Each venue's curve is
     tabulated at multiples of that slice up to its own capacity; a venue with
     less capacity simply runs out of slices earlier. Because every curve is
     monotone in size, taking each slice where its marginal cost is lowest IS
     the optimal allocation of the separable problem — not an approximation.

     Gas is deliberately absent here: it is a FIXED cost per venue used, which
     no marginal rule can see. route() handles it with a pruning pass.
     ------------------------------------------------------------------------ */
  function solve(built, side, base, tier, q) {
    var n = SLICES, step = base / n, i, j;
    var cum = [], alloc = [];

    for (i = 0; i < built.length; i++) {
      var cap = capOf(built[i], side);
      var maxS = Math.max(0, Math.min(n, Math.floor(cap / step + 1e-9)));
      var arr = [0];
      for (j = 1; j <= maxS; j++) {
        var r = rawAt(built[i], side, step * j);
        arr.push(side === "buy" ? r.raw * (1 + built[i].feeRate) : r.raw * (1 - built[i].feeRate));
      }
      cum.push({ arr: arr, maxS: maxS, idx: 0 });
      alloc.push(0);
    }

    for (var s = 0; s < n; s++) {
      var pick = -1, pickVal = null;
      for (i = 0; i < built.length; i++) {
        var c = cum[i];
        if (c.idx >= c.maxS) continue;                  /* this venue is full */
        var d = c.arr[c.idx + 1] - c.arr[c.idx];
        if (d == null || !isFinite(d)) continue;
        if (pickVal == null || (side === "buy" ? d < pickVal : d > pickVal)) { pickVal = d; pick = i; }
      }
      if (pick < 0) break;                              /* no capacity left anywhere */
      cum[pick].idx++;
    }

    /* The slice grid floors each venue's capacity, so up to one sub-slice per
       venue was being left on the table — and then reported to the user as
       depth the market did not have. Hand the remainder to the venues that
       still have room, cheapest marginal first. */
    var extra = [], allocated = 0;
    for (i = 0; i < built.length; i++) { extra.push(0); allocated += cum[i].idx * step; }
    var left = base - allocated;
    if (left > base * 1e-12) {
      var order = [];
      for (i = 0; i < built.length; i++) {
        var spare = capOf(built[i], side) - cum[i].idx * step;
        if (spare > base * 1e-12) {
          var c2 = cum[i], k2 = c2.idx > 0 ? c2.arr[c2.idx] - c2.arr[c2.idx - 1] : 0;
          order.push({ i: i, spare: spare, marg: k2 });
        }
      }
      order.sort(function (x, y) { return side === "buy" ? x.marg - y.marg : y.marg - x.marg; });
      for (i = 0; i < order.length && left > base * 1e-12; i++) {
        var take = Math.min(left, order[i].spare);
        extra[order[i].i] += take;
        left -= take;
      }
    }

    /* price each venue's allocation at its exact size, and add its gas once */
    var legs = [], total = 0, filledAll = 0;
    for (i = 0; i < built.length; i++) {
      var qty = cum[i].idx * step + extra[i];
      if (!(qty > base * 1e-12)) continue;
      var a = allInAt(built[i], side, qty, tier);
      if (a.allIn == null) continue;
      legs.push({
        key: built[i].key, name: built[i].name, venueClass: built[i].venueClass,
        base: a.filled, share: base > 0 ? a.filled / base : null,
        avg: a.filled > EPS ? a.raw / a.filled : null,
        feeQuote: a.fee, gasQuote: built[i].gasQuote || 0, allInQuote: a.allIn
      });
      total += a.allIn;
      filledAll += a.filled;
    }
    legs.sort(function (x, y) { return y.base - x.base; });
    return { legs: legs, allInQuote: legs.length ? total : null, filled: filledAll };
  }

  function betterThan(a, b, side, slack) {
    if (a == null) return false;
    if (b == null) return true;
    return side === "buy" ? a < b - (slack || 0) : a > b + (slack || 0);
  }
  function findV(list, k) { for (var i = 0; i < list.length; i++) if (list[i].key === k) return list[i]; return null; }
  function withoutKey(list, k) { var o = [], i; for (i = 0; i < list.length; i++) if (list[i].key !== k) o.push(list[i]); return o; }

  /* ----------------------------------------------------------------- send() */
  /* Money moves only here, and only through the engine. */

  function send(plan) {
    var lp = LP();
    if (!plan || typeof plan !== "object") return { ok: false, reason: "nothing to send" };
    if (!lp || typeof lp.execFill !== "function") return { ok: false, reason: "the paper engine is not available" };
    if (typeof S === "undefined") return { ok: false, reason: "the account is not ready yet" };
    if (!plan.req || !plan.req.sym || !(plan.req.base > 0)) return { ok: false, reason: "this plan carries no request to re-price — quote it again before sending" };

    /* RE-QUOTE, ALWAYS. The Route tab renders once per visit and this layer
       runs no timer, so a plan on screen can be minutes old. Filling at a
       remembered average would mint P&L out of a stale quote, which is the one
       mistake a paper desk must never teach. The order is priced NOW. */
    var req = plan.req;
    var fresh = null;
    try { fresh = route(quote(req), req); } catch (e) { fresh = null; }
    if (!fresh || !fresh.legs || !fresh.legs.length) return { ok: false, reason: "the market moved and there is nothing routable at this size now — quote it again" };

    var tolPct = +req.tolerancePct > 0 ? +req.tolerancePct : 0.5;
    if (plan.mid > 0 && fresh.mid > 0) {
      var driftPct = Math.abs(fresh.mid / plan.mid - 1) * 100;
      if (driftPct > tolPct) {
        return {
          ok: false, stale: true, driftPct: driftPct,
          reason: "the price moved " + driftPct.toFixed(2) + "% since that quote, past your " + tolPct + "% tolerance. Nothing was sent — quote it again."
        };
      }
    }

    /* And honour the tolerance the way the ticket does: a pre-trade refusal,
       not a line of small print under a fill that already happened. */
    var pm = P();
    for (var z = 0; z < fresh.legs.length; z++) {
      var lz = fresh.legs[z];
      if (!(lz.avg > 0) || !(fresh.mid > 0)) continue;
      var impactPct = Math.abs(lz.avg / fresh.mid - 1) * 100;
      var chk = null;
      try { chk = pm.checkTolerance(impactPct, tolPct); } catch (e) { chk = null; }
      if (chk && chk.ok === false) return { ok: false, refused: true, reason: (chk.reason || "price impact exceeds your slippage tolerance") + " (" + lz.name + ")" };
    }

    var fills = [], gasPaid = 0, i, leg, okAny = false;
    for (i = 0; i < fresh.legs.length; i++) {
      leg = fresh.legs[i];
      if (!(leg.base > 0) || !(leg.avg > 0) || !isFinite(leg.base) || !isFinite(leg.avg)) continue;
      var notional = leg.base * leg.avg;
      var feeRate = (leg.feeQuote > 0 && notional > 0) ? leg.feeQuote / notional : 0;
      var done = false;
      try {
        done = !!lp.execFill(S, feeRate, fresh.side, fresh.sym, fresh.quote, leg.base, leg.avg, "sor", true);
      } catch (e) { done = false; }
      var gasLeg = 0;
      if (done) {
        okAny = true;
        if (leg.gasQuote > 0 && typeof lp.chargeNetwork === "function") {
          try { gasLeg = lp.chargeNetwork(S, fresh.quote, leg.gasQuote, "Execution route · " + leg.name + " gas") || 0; } catch (e) { gasLeg = 0; }
          gasPaid += gasLeg;
        }
      }
      fills.push({ key: leg.key, name: leg.name, base: leg.base, avg: leg.avg, ok: done, feeRate: feeRate, feeQuote: done ? notional * feeRate : 0, gasQuote: gasLeg });
    }

    if (!okAny) return { ok: false, reason: "no leg filled — check the balance for this size", fills: fills };

    var predicted = {
      allInQuote: fresh.allInQuote, allInVsMidBps: fresh.allInVsMidBps, mid: fresh.mid,
      legs: fresh.legs.length, bestSingle: fresh.bestSingle ? fresh.bestSingle.name : null,
      savedVsBestSingleQuote: fresh.savedVsBestSingleQuote,
      savedVsWholeBookQuote: fresh.savedVsWholeBookQuote
    };
    var realised = realiseFrom(fills, fresh);
    plan = fresh;

    var entry = {
      t: C.now ? C.now() : 0, sym: plan.sym, quote: plan.quote, side: plan.side,
      base: plan.base, predicted: predicted, realised: realised,
      gasQuote: gasPaid, fills: fills
    };
    push(entry);
    try { C.save(); } catch (e) {}
    try { if (typeof updateNavBal === "function") updateNavBal(); } catch (e) {}
    try { C.toast && C.toast("good", "Route sent", fills.length + " legs · " + fmtQuote(realised.allInQuote, plan.quote) + " all-in"); } catch (e) {}
    return { ok: true, entry: entry, fills: fills };
  }

  /* Like for like. `predicted.allInQuote` carries fee and gas, so the realised
     figure must too — otherwise the Gap column is always exactly minus the
     fees, and the one tab that is supposed to score the model instead
     congratulates it on every single trade. */
  function realiseFrom(fills, plan) {
    var raw = 0, got = 0, fee = 0, gas = 0, i;
    for (i = 0; i < fills.length; i++) {
      if (!fills[i].ok) continue;
      got += fills[i].base;
      raw += fills[i].base * fills[i].avg;
      fee += fills[i].feeQuote || 0;
      gas += fills[i].gasQuote || 0;
    }
    var allIn = plan.side === "buy" ? raw + fee + gas : raw - fee - gas;
    var ref = got > 0 && plan.mid > 0 ? got * plan.mid : null;
    return {
      base: got, rawQuote: raw, feeQuote: fee, gasQuote: gas, allInQuote: allIn,
      allInVsMidBps: ref ? (plan.side === "buy" ? (allIn / ref - 1) : (1 - allIn / ref)) * 1e4 : null,
      shortfall: Math.max(0, plan.base - got)
    };
  }

  /* ------------------------------------------------------------ state + log */

  function bucket() {
    var X = null;
    try { X = C.X(); } catch (e) { X = null; }
    if (!X) return null;
    if (!X.sor) X.sor = { log: [], ticket: null };
    if (!X.sor.log) X.sor.log = [];
    return X.sor;
  }
  function log() { var b = bucket(); return b ? b.log.slice() : []; }
  function push(entry) {
    var b = bucket();
    if (!b) return;
    b.log.unshift(entry);
    if (b.log.length > 40) b.log.length = 40;
  }
  function ticket(patch) {
    var b = bucket();
    var base = { sym: "BTC", quote: "USDT", side: "buy", base: 1, tier: "medium", tolerancePct: 0.5, venues: ALL_KEYS.slice() };
    if (!b) return patch ? merge(base, patch) : base;
    if (!b.ticket) b.ticket = base;
    if (patch) { b.ticket = merge(b.ticket, patch); try { C.save(); } catch (e) {} }
    return b.ticket;
  }
  function merge(a, b) { var o = {}, k; for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) o[k] = a[k]; for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) o[k] = b[k]; return o; }

  /* ------------------------------------------------------------- formatting */

  function esc(s) { try { return C.esc ? C.esc(String(s)) : String(s).replace(/[&<>"]/g, ""); } catch (e) { return ""; } }
  function fmtQuote(n, q) {
    if (n == null || !isFinite(n)) return "—";
    try { if (C.money && (q === "USDT" || q === "USD")) return C.money(n); } catch (e) {}
    return fmtNum(n) + " " + (q || "");
  }
  function fmtNum(n) {
    if (n == null || !isFinite(n)) return "—";
    var a = Math.abs(n);
    if (a >= 1000) return n.toFixed(0);
    if (a >= 1) return n.toFixed(2);
    if (a >= 0.01) return n.toFixed(4);
    return n.toFixed(8);
  }
  function fmtBps(n) { return n == null || !isFinite(n) ? "—" : (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(1) + " bp"; }
  function fmtPct(n) { return n == null || !isFinite(n) ? "—" : (n * 100).toFixed(3) + "%"; }
  function fmtSec(n) { return !(n > 0) ? "instant" : n < 60 ? n.toFixed(0) + "s" : (n / 60).toFixed(1) + "m"; }

  /* ------------------------------------------------------------------ the UI */

  var LAST = { quotes: null, plan: null };

  function currentQuote() {
    var t = ticket();
    var req = { sym: t.sym, quote: t.quote, side: t.side, base: +t.base, tier: t.tier, tolerancePct: +t.tolerancePct, venues: t.venues, at: 0 };
    LAST.quotes = quote(req);
    LAST.plan = route(LAST.quotes, req);
    return LAST;
  }

  function bodyFor(tab) {
    if (tab === "compare") return paneCompare();
    if (tab === "route") return paneRoute();
    if (tab === "ledger") return paneLedger();
    if (tab === "method") return paneMethod();
    return paneTicket();
  }

  function paneTicket() {
    var t = ticket(), i, v = venues(), h = "";
    h += ('<div class="sor-note">' + window.DLI18N.t("53-sor.40f435ea1708") + '</div>');
    h += '<div class="dl-2 sor-form">';
    h += field("Symbol", '<input id="sorSym" class="dl-inp" type="text" value="' + esc(t.sym) + '" autocomplete="off" spellcheck="false" aria-label="Symbol">');
    h += field("Side", ('<select id="sorSide" class="dl-inp" aria-label="' + window.DLI18N.t("53-sor.630ef00b7c4f") + '"><option value="buy"') + (t.side === "buy" ? " selected" : "") + ('>' + window.DLI18N.t("53-sor.64e3cb0e4960") + '</option><option value="sell"') + (t.side === "sell" ? " selected" : "") + ('>' + window.DLI18N.t("53-sor.2ec1e2815946") + '</option></select>'));
    h += field("Size (base)", '<input id="sorBase" class="dl-inp" type="number" min="0" step="any" value="' + esc(t.base) + '" aria-label="Size in base units">');
    h += field("Slippage tolerance", ('<select id="sorTol" class="dl-inp" aria-label="' + window.DLI18N.t("53-sor.c17ba547e1ee") + '">') + opts([0.1, 0.5, 1, 2, 3, 5], t.tolerancePct, "%") + '</select>');
    h += field("Gas tier", ('<select id="sorTier" class="dl-inp" aria-label="' + window.DLI18N.t("53-sor.59a92e5b8db2") + '"><option value="low"') + (t.tier === "low" ? " selected" : "") + ('>' + window.DLI18N.t("53-sor.f793de205ead") + '</option><option value="medium"') + (t.tier === "medium" ? " selected" : "") + ('>' + window.DLI18N.t("53-sor.8e588cd18774") + '</option><option value="high"') + (t.tier === "high" ? " selected" : "") + ('>' + window.DLI18N.t("53-sor.c4ebc6d4a583") + '</option></select>'));
    h += '</div>';

    h += ('<div class="sor-sub">' + window.DLI18N.t("53-sor.1d23d0c96186") + '</div><div class="sor-vlist">');
    for (i = 0; i < v.length; i++) {
      var on = t.venues.indexOf(v[i].key) >= 0;
      h += '<label class="sor-vrow"><input type="checkbox" class="sor-vck" data-k="' + esc(v[i].key) + '"' + (on ? " checked" : "") + '>' +
        '<span class="sor-vn">' + esc(v[i].name) + '</span>' +
        '<span class="sor-vf">' + (v[i].feeRate == null ? "—" : fmtPct(v[i].feeRate) + " taker") + '</span>' +
        '<span class="sor-vd">' + (v[i].depthShare == null ? "pool" : Math.round(v[i].depthShare * 100) + "% depth share") + '</span></label>';
    }
    var fk = forkVenue();
    h += '<div class="sor-fork">' + (fk ? "Your forked pool is connected and joins the table as a real venue." : "No fork node connected — every row below is modelled. Connect one in the Fork Sandbox and its pool joins as the one live venue.") + '</div>';
    h += '</div>';
    h += ('<div class="sor-actions"><button class="go" id="sorGo">' + window.DLI18N.t("53-sor.1cb9d55d2925") + '</button></div>');
    return h;
  }

  function field(label, inner) { return '<label class="sor-f"><span class="sor-fl">' + esc(label) + '</span>' + inner + '</label>'; }
  function opts(list, cur, suffix) {
    var h = "", i;
    for (i = 0; i < list.length; i++) h += '<option value="' + list[i] + '"' + (+cur === list[i] ? " selected" : "") + '>' + list[i] + (suffix || "") + '</option>';
    return h;
  }

  function paneCompare() {
    var L = currentQuote(), Q = L.quotes;
    if (!Q || !Q.venues.length) return '<div class="sor-empty">' + esc((Q && Q.note) || "Nothing to compare.") + '</div>';
    var h = '<div class="sor-head"><span class="sor-pair">' + esc(Q.side.toUpperCase()) + " " + fmtNum(Q.base) + " " + esc(Q.sym) + " / " + esc(Q.quote) + ('</span><span class="sor-mid">' + window.DLI18N.t("53-sor.0d402749749f") + '') + fmtQuote(Q.mid, Q.quote) + '</span></div>';
    h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr>' +
      ('<th>' + window.DLI18N.t("53-sor.aea1b15df626") + '</th><th>' + window.DLI18N.t("53-sor.4a7492b24e80") + '</th><th>' + window.DLI18N.t("53-sor.d1f23f0d1361") + '</th><th>' + window.DLI18N.t("53-sor.f842c3e1858d") + '</th><th>' + window.DLI18N.t("53-sor.e23a445d0fa7") + '</th><th>' + window.DLI18N.t("53-sor.bd1f8c9dfcb8") + '<sup>*</sup></th><th>' + window.DLI18N.t("53-sor.eebdd24a77d9") + '</th><th>' + window.DLI18N.t("53-sor.78d6e62221c0") + '</th><th>' + window.DLI18N.t("53-sor.17e83883ff9c") + '</th><th>' + window.DLI18N.t("53-sor.a4130d7d2c3a") + '</th>') +
      '</tr></thead><tbody>';
    var i, r;
    for (i = 0; i < Q.venues.length; i++) {
      r = Q.venues[i];
      h += '<tr data-cls="' + esc(r.venueClass) + '"' + (r.rank === 1 ? ' data-best="1"' : "") + '>' +
        '<td class="sor-n">' + esc(r.name) + (r.exhausted ? ('<span class="sor-flag">' + window.DLI18N.t("53-sor.9834a14ab9bc") + '</span>') : "") + '</td>' +
        '<td>' + fmtQuote(r.avg, Q.quote) + '</td>' +
        '<td>' + (r.impactBps == null ? "—" : r.impactBps.toFixed(1) + " bp") + '</td>' +
        '<td>' + fmtQuote(r.feeQuote, Q.quote) + '</td>' +
        '<td>' + (r.gasQuote > 0 ? fmtQuote(r.gasQuote, Q.quote) : "—") + '</td>' +
        '<td>' + (r.mev && r.mev.exposed ? '<span class="sor-mev">−' + fmtQuote(r.mev.extraQuote, Q.quote) + '</span>' : "—") + '</td>' +
        '<td>' + fmtSec(r.timeToFillSec) + '</td>' +
        '<td class="sor-all">' + fmtQuote(r.allInQuote, Q.quote) + '</td>' +
        '<td>' + fmtBps(r.allInVsMidBps) + '</td>' +
        '<td>' + (r.rank || "—") + '</td></tr>';
    }
    h += '</tbody></table></div>';
    h += ('<div class="sor-legend">' + window.DLI18N.t("53-sor.5a8be833cda2") + '') + GAS.gwei.toFixed(1) + ' gwei (' + esc(GAS.src) + ', ' + esc(GAS.cong) + ('). <b>' + window.DLI18N.t("53-sor.3803d48461ef") + '</b>' + window.DLI18N.t("53-sor.daf0f72babf1") + '</div>');
    h += assumptionStrip();
    return h;
  }

  function paneRoute() {
    var L = currentQuote(), Q = L.quotes, R = L.plan;
    if (!R || !R.legs.length) return '<div class="sor-empty">' + esc((R && R.note) || (Q && Q.note) || "Nothing to route.") + '</div>';
    var h = '<div class="sor-head"><span class="sor-pair">' + esc(R.side.toUpperCase()) + " " + fmtNum(R.base) + " " + esc(R.sym) + ('</span><span class="sor-mid">' + window.DLI18N.t("53-sor.34edcc7acbbf") + '') + fmtQuote(R.allInQuote, R.quote) + " · " + fmtBps(R.allInVsMidBps) + ('' + window.DLI18N.t("53-sor.e40cda96fe01") + '</span></div>');
    h += '<div class="sor-verdict">' + esc(R.note) + '</div>';
    h += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("53-sor.7c94ee113e1b") + '</th><th>' + window.DLI18N.t("53-sor.1af851907331") + '</th><th>' + window.DLI18N.t("53-sor.29887a5ff984") + '</th><th>' + window.DLI18N.t("53-sor.4a7492b24e80") + '</th><th>' + window.DLI18N.t("53-sor.f842c3e1858d") + '</th><th>' + window.DLI18N.t("53-sor.e23a445d0fa7") + '</th><th>' + window.DLI18N.t("53-sor.78d6e62221c0") + '</th></tr></thead><tbody>');
    var i, g;
    for (i = 0; i < R.legs.length; i++) {
      g = R.legs[i];
      h += '<tr><td class="sor-n">' + esc(g.name) + '</td><td>' + fmtNum(g.base) + '</td><td>' + (g.share == null ? "—" : (g.share * 100).toFixed(1) + "%") + '</td><td>' + fmtQuote(g.avg, R.quote) + '</td><td>' + fmtQuote(g.feeQuote, R.quote) + '</td><td>' + (g.gasQuote > 0 ? fmtQuote(g.gasQuote, R.quote) : "—") + '</td><td class="sor-all">' + fmtQuote(g.allInQuote, R.quote) + '</td></tr>';
    }
    h += '</tbody></table></div>';
    if (R.remaining > 0) h += '<div class="sor-warn">' + fmtNum(R.remaining) + " " + esc(R.sym) + ('' + window.DLI18N.t("53-sor.a4fc2b3597bf") + '</div>');
    if (R.dropped.length) {
      h += ('<div class="sor-sub">' + window.DLI18N.t("53-sor.2ff363c1f350") + '</div><ul class="sor-drop">');
      for (i = 0; i < R.dropped.length; i++) h += '<li><b>' + esc(R.dropped[i].key) + '</b> — ' + esc(R.dropped[i].reason) + '</li>';
      h += '</ul>';
    }
    if (R.bestSingle) h += ('<div class="sor-legend">' + window.DLI18N.t("53-sor.102e4bdc197a") + '') + esc(R.bestSingle.name) + ' alone would cost ' + fmtQuote(R.bestSingle.allInQuote, R.quote) + ('' + window.DLI18N.t("53-sor.6c4c248980ea") + '</div>');
    if (R.wholeBookQuote != null) h += ('<div class="sor-legend">' + window.DLI18N.t("53-sor.3b99571ef42c") + '<b>' + window.DLI18N.t("53-sor.47ca7e9d8e95") + '</b>' + window.DLI18N.t("53-sor.a0c1d0eda99f") + '') + fmtQuote(R.wholeBookQuote, R.quote) + ' — a ' + (R.savedVsWholeBookQuote > 0 ? "saving of " + fmtQuote(R.savedVsWholeBookQuote, R.quote) : "difference of " + fmtQuote(Math.abs(R.savedVsWholeBookQuote || 0), R.quote) + " against the split") + ('' + window.DLI18N.t("53-sor.9481fda4870e") + '</div>');
    h += ('<div class="sor-actions"><button class="go" id="sorSend">' + window.DLI18N.t("53-sor.5858a180aa35") + '</button><span class="sor-sendnote">' + window.DLI18N.t("53-sor.90c1ad5c2eed") + '</span></div>');
    return h;
  }

  function paneLedger() {
    var rows = log(), h = "", i, e;
    if (!rows.length) return ('<div class="sor-empty">' + window.DLI18N.t("53-sor.d1019aab9f30") + '</div>');
    h += ('<div class="sor-note">' + window.DLI18N.t("53-sor.73e28fd7a0c5") + '</div>');
    h += ('<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + window.DLI18N.t("53-sor.cf9c7aa24a26") + '</th><th>' + window.DLI18N.t("53-sor.6be090825c99") + '</th><th>' + window.DLI18N.t("53-sor.38557594d0fc") + '</th><th>' + window.DLI18N.t("53-sor.044f92b316fe") + '</th><th>' + window.DLI18N.t("53-sor.5c1fca894f24") + '</th><th>' + window.DLI18N.t("53-sor.cb129306bc6f") + '</th></tr></thead><tbody>');
    for (i = 0; i < rows.length; i++) {
      e = rows[i];
      var gap = (e.predicted && e.realised && e.predicted.allInQuote != null && e.realised.allInQuote != null) ? e.realised.allInQuote - e.predicted.allInQuote : null;
      h += '<tr><td>' + esc(when(e.t)) + '</td><td class="sor-n">' + esc(e.side.toUpperCase() + " " + fmtNum(e.base) + " " + e.sym) + '</td><td>' + (e.fills ? e.fills.length : 0) + '</td><td>' + fmtQuote(e.predicted && e.predicted.allInQuote, e.quote) + '</td><td>' + fmtQuote(e.realised && e.realised.allInQuote, e.quote) + '</td><td>' + (gap == null ? "—" : fmtQuote(gap, e.quote)) + '</td></tr>';
    }
    h += '</tbody></table></div>';
    return h;
  }

  function when(t) {
    if (!(t > 0)) return "—";
    try { return new Date(t).toISOString().slice(5, 16).replace("T", " "); } catch (e) { return "—"; }
  }

  function paneMethod() {
    var h = ('<div class="sor-note">' + window.DLI18N.t("53-sor.1683ab59ec85") + '</div>');
    var i;
    h += '<div class="sor-method">';
    for (i = 0; i < METHOD.length; i++) h += '<div class="sor-mrow"><b>' + esc(METHOD[i][0]) + '</b><span>' + esc(METHOD[i][1]) + '</span></div>';
    h += '</div>';
    h += ('<div class="sor-sub">' + window.DLI18N.t("53-sor.72575be9ba5c") + '</div><ul class="sor-assume">');
    for (i = 0; i < ASSUMPTIONS.length; i++) h += '<li>' + esc(ASSUMPTIONS[i]) + '</li>';
    h += '</ul>';
    return h;
  }

  function assumptionStrip() {
    return ('<div class="sor-strip">' + window.DLI18N.t("53-sor.4a85f5ca8934") + '</div>');
  }

  /* ---------------------------------------------------------------- wiring */

  function readTicket() {
    var t = {}, el;
    el = document.getElementById("sorSym"); if (el) t.sym = String(el.value || "BTC").toUpperCase().trim();
    el = document.getElementById("sorSide"); if (el) t.side = el.value === "sell" ? "sell" : "buy";
    el = document.getElementById("sorBase"); if (el) t.base = +el.value || 0;
    el = document.getElementById("sorTol"); if (el) t.tolerancePct = +el.value || 0.5;
    el = document.getElementById("sorTier"); if (el) t.tier = el.value;
    var cks = document.querySelectorAll(".sor-vck"), keys = [], i;
    for (i = 0; i < cks.length; i++) if (cks[i].checked) keys.push(cks[i].getAttribute("data-k"));
    if (cks.length) t.venues = keys.length ? keys : ALL_KEYS.slice();
    return t;
  }

  function onClick(ev) {
    var tgt = ev.target;
    if (!tgt || !tgt.id) return;
    if (tgt.id === "sorGo") {
      ticket(readTicket());
      refreshGas();
      open("compare");
      return;
    }
    if (tgt.id === "sorSend") {
      var R = LAST.plan;
      var res = send(R);
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

  function open(tab) {
    refreshGas();
    var el = null;
    try {
      el = C.open("dlSor", {
        title: window.DLI18N.t("53-sor.034cb6cb24f7"),
        sub: window.DLI18N.t("53-sor.83d35e74a455"),
        tabs: [["ticket", "Ticket"], ["compare", "Compare"], ["route", "Route"], ["ledger", "Ledger"], ["method", "Method"]],
        /* v166 · bodyFor RETURNS the pane; DLCORE.open ignores an onTab return value,
           so the v165 desk mounted with an empty body. The wrapper is the fix. */
        onTab: function (t, body) { if (body) body.innerHTML = bodyFor(t); }
      }, tab || "ticket");
    } catch (e) { el = null; }
    try { wire(el || document.getElementById("dlSor")); } catch (e) {}
    return el;
  }

  /* register on the desks rail and the command palette; the Academy section
     strip reaches this through the IA table's DLSOR.open action */
  try { if (window.DLDESKS && window.DLDESKS.register) window.DLDESKS.register("sor", "🧭", "Execution", "Route one order across book venues and the pool, and compare the fills", function () { open("ticket"); }); } catch (e) {}
  try { C.cmd && C.cmd("Execution", "Execution — smart order routing across the book venues and the pool", "🧭", function () { open("ticket"); }); } catch (e) {}

  window.DLSOR = {
    __v: 165,
    open: open,
    quote: quote,
    route: route,
    venues: venues,
    curve: curve,
    send: send,
    log: log,
    ticket: ticket,
    refreshGas: refreshGas,
    METHOD: METHOD,
    ASSUMPTIONS: ASSUMPTIONS
  };
})();
