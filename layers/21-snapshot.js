/*
   DLSNAP · v155 — the one canonical market snapshot.

   Replaces the fetch/derive halves of seven producers that each answered
   "what is the market cap" over a different universe at a different instant:

     updateSpotlight   tracked top-30 INCLUDING USDT, 60s
     renderGStats      tracked top-30 EXCLUDING USDT, on ticker repaint
     marketState       tracked top-30 EXCLUDING USDT, every 5s
     fetchGlobals      CoinGecko /global, fetched ONCE at boot, never again
     loadPulse         CoinGecko /global + a Coinpaprika fallback, once per visit
     mountGstat        CoinGecko /global behind a 5-minute cache, degrading
                       silently to a tracked sum under the same "Market Cap" label
     globalWidget      tracked top-500 (MX.coins), a different store entirely

   Each of those surfaces keeps its name, its node and its call sites; only its
   derivation moves here. They are now readers of one frozen record.

   NO new fetch wrapper: every request goes through DLCORE.jget.
   NO new timer: the cycle rides the payload's existing 60s live loop by
   wrapping loadLive() (the job that interval already runs) and adopt() (the
   moment the tracked universe changes). Nothing here calls setInterval.
*/
window.DLSNAP = (function () {
  "use strict";
  if (window.DLSNAP && window.DLSNAP.__v) return window.DLSNAP;
  var C = window.DLCORE; if (!C) return null;

  /* The pure core — field / wit / resolve / dominance / subsetCheck / contested — lives, typed and
     parity-tested, in web/app/src/lib/snapshot (DLAPP.snapshot). This layer keeps orchestration
     (the cycle, the legs, publish) and rendering. ENV hands the core the two impure inputs it needs. */
  var SN = window.DLAPP.snapshot;
  var ENV = {
    freshness: function (at, stale) { return C.provClass(at || 0, !!stale); },
    num: function (v) { return window.DLF ? DLF.n(v) : (v == null || v === "" ? null : (isFinite(+v) ? +v : null)); }
  };
  var QUORUM_TOLERANCE_PCT = SN.QUORUM_TOLERANCE_PCT;  /* the shipped quorumTag() threshold */
  var TTL = 55000;                                /* < the 60s cycle, so one cycle = one fetch */

  var U_GLOBAL = SN.U_GLOBAL;
  var U_TRACKED = SN.U_TRACKED;

  /* ---------------------------------------------------------------- Field */
  /* The ONLY constructor for a canonical figure. A value is a number or it is
     null with a reason from a closed set. There is no third state, and there is
     no path on which a missing number becomes 0. */
  function field(v, reason, o) { return SN.field(ENV, v, reason, o || {}); }

  /* There is exactly ONE definition of live/recent/stale in the payload, in
     DLCORE.prov (20-core.js). This reads that decision back rather than
     restating the thresholds, so a second freshness scale cannot drift in. */
  function freshness(at, stale) {
    try { return C.provClass(at || 0, !!stale); }
    catch (e) { return "stale"; }
  }

  /* ------------------------------------------------------------- witnesses */
  /* The ONLY constructor for a witness. `positive` marks a quantity that cannot legitimately
     be zero, so a provider answering 0 for it is recorded as having said nothing at all. */
  function wit(src, v, at, positive) { return SN.wit(src, v, at, positive); }
  /* Promoted verbatim from quorumCheck(): median across witnesses, deviation
     flagged past 1.5%. The shipped code computed both and then threw them away. */
  function resolve(ws) { return SN.resolve(ws); }

  /* A ratio is only meaningful inside one universe from one source. Mixing a
     tracked numerator with a whole-market denominator is how "BTC dominance"
     came out four different ways. */
  function dominance(numF, denF, o) { return SN.dominance(ENV, numF, denF, o || {}); }

  /* ------------------------------------------------- a subset cannot out-measure
     its superset. The tracked 30-coin sum came out ABOVE the whole-market figure
     ($133.03B of 24h volume against $132.29B) because the whole-market figure was a
     median of two witnesses 1.99x apart. Each figure is labelled, so it is not a
     contract breach — but a reader reads it as a bug, and the app must say which of
     the two is the uncertain one instead of leaving the pair to be discovered. */
  function subsetCheck(sub, sup, what) { return SN.subsetCheck(sub, sup, what, usd); }

  /* --------------------------------------------------------- disagreement, shown
     resolve() has always computed the median AND the spread. The screen printed the
     median under a plain green "live" chip with a witness tick beside it and threw
     the spread away — CoinGecko $88.52B against Coinpaprika $176.07B rendered as
     "$132.29B · live ✓", a number neither provider reported. A contested figure is
     still worth showing (the median is the best estimate available) but it is never
     shown as though the sources agreed. */
  function contested(f) { return SN.contested(f); }
  function fmtOf(f, v) {
    if (f && f.unit === "%") return (+v).toFixed(f.precision == null ? 1 : f.precision) + "%";
    return usd(v);
  }
  function witText(f, what) {
    if (!f || !f.witnesses || !f.witnesses.length) return "";
    var vals = f.witnesses.map(function (x) { return +x.value; });
    return (what ? what + ": " : "") +
      f.witnesses.map(function (x) { return x.source + " " + fmtOf(f, x.value); }).join(" vs ") +
      " — spread ±" + (+f.dev).toFixed(2) + "% against a ±" + QUORUM_TOLERANCE_PCT + "% tolerance. " +
      "Shown: the median " + fmtOf(f, f.value) + ", which is not a figure either witness reported. " +
      "The true value is somewhere in " + fmtOf(f, Math.min.apply(null, vals)) + " to " + fmtOf(f, Math.max.apply(null, vals)) + ".";
  }
  /* the mark that travels WITH the figure, at the point of display.
     v158: the words are a screen-reader-only span (.dl-dis-w); what the eye gets is a small
     muted "±2.0%" beside the figure, and the witness values in the tooltip. The record, the
     data-* attributes and the accessible name are unchanged — only the volume is. */
  function dis(f, what) {
    if (!contested(f)) return "";
    return '<span class="dl-dis" role="note" tabindex="0" data-dev="' + (+f.dev).toFixed(2) +
      '" data-witnesses="' + C.esc(f.witnesses.map(function (x) { return x.source + "=" + x.value; }).join(";")) +
      '" title="' + C.esc(witText(f, what)) + '"><span class="dl-dis-w">⚠ sources differ </span>±' + (+f.dev).toFixed(1) + "%</span>";
  }
  function mark(path, what) { return dis(get(path), what); }
  /* every contested figure on the current record, for the feed chip and the gate */
  function disagreements() {
    var o = state.current, out = [];
    if (!o) return out;
    ["global", "tracked"].forEach(function (u) {
      var U = o.universes[u]; if (!U) return;
      ["marketCap", "volume24h", "change24h"].forEach(function (k) {
        if (contested(U[k])) out.push({ path: "universes." + u + "." + k, dev: U[k].dev, witnesses: U[k].witnesses });
      });
      ["BTC", "ETH"].forEach(function (k) {
        var f = U.dominance && U.dominance[k];
        if (contested(f)) out.push({ path: "universes." + u + ".dominance." + k, dev: f.dev, witnesses: f.witnesses });
      });
    });
    return out;
  }
  /* the note that names an inconsistency between two universes, at the point of display */
  function flag(kind) {
    var c = state.current && state.current.checks && state.current.checks[kind];
    if (!c || !c.note) return "";
    return '<span class="dl-flag" role="note" tabindex="0" data-check="' + kind + '" data-state="' + c.state +
      '" title="' + C.esc(c.note) + '"><span class="dl-dis-w">⚠ exceeds the whole-market figure</span></span>';
  }
  /* Two figures side by side must not sit under one chip unless they were witnessed
     the same way. Anything on a strip whose witness list differs from the strip's
     own chip names its own source, at the figure. */
  function srcNote(f, ref) {
    if (!f || !ref || f.value == null || !f.source || f.source === ref.source) return "";
    return '<span class="dl-src" title="this figure is not witnessed the same way as the chip on this strip">' +
      C.esc(f.source) + " only</span>";
  }

  /* ---------------------------------------------------------------- digest */
  function digest(S) {
    var acc = [];
    (function walk(o, path) {
      if (o == null || typeof o !== "object") return;
      if (Object.prototype.hasOwnProperty.call(o, "value") && Object.prototype.hasOwnProperty.call(o, "reason")) {
        acc.push(path + "=" + (o.value == null ? "null:" + o.reason : o.value) + "@" + o.universe);
        return;
      }
      Object.keys(o).sort().forEach(function (k) { walk(o[k], path + "." + k); });
    })({ u: S.universes, a: S.assets }, "");
    var s = acc.join("|"), h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
    var h2 = 5381 >>> 0;
    for (var j = s.length - 1; j >= 0; j--) { h2 = (((h2 << 5) + h2) ^ s.charCodeAt(j)) >>> 0; }
    return ("00000000" + h.toString(16)).slice(-8) + ("00000000" + h2.toString(16)).slice(-8);
  }

  function deepFreeze(o) {
    if (o && typeof o === "object" && !Object.isFrozen(o)) {
      Object.freeze(o);
      Object.keys(o).forEach(function (k) { deepFreeze(o[k]); });
    }
    return o;
  }

  /* ------------------------------------------------------------ the tracked
     universe: one membership rule, declared, instead of two silently different
     ones (the hero summed WITH the USDT row, the .gi strip WITHOUT it — the
     two figures differed by exactly the USDT market cap). Rows the payload
     fabricates when a feed omits them are marked synthetic and never counted. */
  function trackedMembers() {
    var cs = [];
    try { cs = (typeof coins !== "undefined" && coins) ? coins : []; } catch (e) { cs = []; }
    return cs.filter(function (c) { return c && !c.synthetic; });
  }

  var state = { current: null, ring: [], pinned: {}, busy: null, lastAt: 0, listeners: [], prices: {}, painters: {} };

  /* ------------------------------------------------------------- the cycle */
  function legGlobal() {
    return C.jget("https://api.coingecko.com/api/v3/global", { key: "snap.cg.global", ttl: TTL })
      .then(function (r) {
        var g = r.data && r.data.data; if (!g) throw new Error("shape");
        return {
          source: "CoinGecko", at: r.at, stale: !!r.stale,
          mcap: g.total_market_cap && g.total_market_cap.usd,
          vol: g.total_volume && g.total_volume.usd,
          btcPct: g.market_cap_percentage && g.market_cap_percentage.btc,
          ethPct: g.market_cap_percentage && g.market_cap_percentage.eth,
          chg: g.market_cap_change_percentage_24h_usd,
          n: g.active_cryptocurrencies
        };
      }).catch(function () { return null; });
  }
  function legPaprika() {
    return C.jget("https://api.coinpaprika.com/v1/global", { key: "snap.pp.global", ttl: TTL })
      .then(function (r) {
        var g = r.data; if (!g) throw new Error("shape");
        return {
          source: "Coinpaprika", at: r.at, stale: !!r.stale,
          mcap: g.market_cap_usd, vol: g.volume_24h_usd,
          btcPct: g.bitcoin_dominance_percentage, ethPct: null,
          chg: g.market_cap_change_24h, n: g.cryptocurrencies_number
        };
      }).catch(function () { return null; });
  }
  function legFng() {
    return C.jget("https://api.alternative.me/fng/?limit=1", { key: "snap.fng", ttl: TTL })
      .then(function (r) {
        var f = r.data && r.data.data && r.data.data[0]; if (!f) throw new Error("shape");
        return { source: "alternative.me", at: r.at, stale: !!r.stale, v: +f.value, label: f.value_classification };
      }).catch(function () { return null; });
  }

  function build(cycleAt, cg, pp, fng) {
    var lead = cg || pp || null;
    /* EVERY whole-market figure is resolved from ITS OWN witnesses, and carries the
       source string those witnesses produce. The shipped code resolved the market cap
       across CoinGecko+Coinpaprika and then stamped that joint source onto every other
       global field — so a CoinGecko-only ETH dominance rendered beside a two-witness
       market cap under one chip that named both providers. One strip, two witness sets,
       one label: fixed by giving each figure its own ledger.
       BTC dominance is witnessed by BOTH providers (Coinpaprika publishes
       bitcoin_dominance_percentage) so it is now derived exactly as the market cap
       beside it is. change24h and ETH dominance have one witness each and say so.
       A percentage that can sit near zero is NOT put to a median vote: resolve()'s
       deviation is |p-median|/median, which explodes as the median approaches 0, so a
       24h change of +0.1% would read as a 300% disagreement. Only the strictly
       positive extensive figures and dominance (always tens of percent) are voted. */
    function W(list) { return resolve(list.filter(Boolean)); }
    /* positive:true for every figure that cannot legitimately BE zero — a whole-market cap, a
       whole-market 24h volume, a dominance share. A live run caught CoinGecko answering
       total_volume.usd = 0 mid-aggregation; the shipped filter only refused null and NaN, so
       the 0 was voted as an observation and the screen showed a median of $89.61B "±100.0%"
       between $0 and $179.21B. A zero there is an ABSENCE, and the law says an absence renders
       Unavailable, never 0. A 24h CHANGE of zero is a real reading, so that one keeps its 0. */
    var capR = W([cg && wit(cg.source, cg.mcap, cg.at, 1), pp && wit(pp.source, pp.mcap, pp.at, 1)]);
    var volR = W([cg && wit(cg.source, cg.vol, cg.at, 1), pp && wit(pp.source, pp.vol, pp.at, 1)]);
    var btcR = W([cg && wit(cg.source, cg.btcPct, cg.at, 1), pp && wit(pp.source, pp.btcPct, pp.at, 1)]);
    var ethR = W([cg && wit(cg.source, cg.ethPct, cg.at, 1)]);
    var chgR = W([cg && wit(cg.source, cg.chg, cg.at, 0) || (pp && wit(pp.source, pp.chg, pp.at, 0))]);
    var meta = {
      observedAt: null,                       /* neither provider timestamps its figure */
      fetchedAt: lead ? lead.at : 0,
      servedAt: lead ? lead.at : 0,
      cycleAt: cycleAt,
      stale: lead ? lead.stale : true,
      universe: "global"
    };
    /* the source of a figure is the list of witnesses that actually spoke for IT */
    function gf(r, o) {
      o = o || {};
      var m = {}, k; for (k in meta) m[k] = meta[k];
      m.witnesses = r.witnesses; m.quorum = r.quorum; m.dev = r.dev;
      /* a figure NO provider reported does not get to borrow the name of one that
         answered about something else (CoinGecko alone publishes ETH dominance, so on a
         Coinpaprika-only cycle that field has no witness at all and must say so) */
      m.source = r.witnesses.length ? r.witnesses.map(function (x) { return x.source; }).join(" + ")
                                    : "no source";
      for (k in o) m[k] = o[k];
      return field(r.value, lead ? null : "unavailable", m);
    }

    var gMcap = gf(capR, { unit: "USD" });
    var global = {
      label: U_GLOBAL,
      membership: {
        count: lead && lead.n != null ? +lead.n : null,
        includesStablecoins: true,
        basis: "every asset the provider tracks"
      },
      marketCap: gMcap,
      volume24h: gf(volR, { unit: "USD" }),
      change24h: gf(chgR, { unit: "%", precision: 2 }),
      dominance: {
        BTC: gf(btcR, { unit: "%", precision: 1 }),
        ETH: gf(ethR, { unit: "%", precision: 1 })
      }
    };

    /* --- the tracked universe: ONE sum, ONE membership rule, declared --- */
    var mem = trackedMembers(), tAt = 0;
    try { tAt = (window.telem && telem.at) || 0; } catch (e) { tAt = 0; }
    if (!tAt) tAt = cycleAt;
    var tSrc = "tracked set"; var tStale = false;
    try { tSrc = (typeof S !== "undefined" && S.mode === "sim") ? "simulated prices" : "live feed"; } catch (e) {}
    try { tStale = (typeof S !== "undefined" && S.mode === "sim"); } catch (e) {}

    var tm = { source: tSrc, observedAt: null, fetchedAt: tAt, servedAt: tAt, cycleAt: cycleAt,
               stale: tStale, universe: "tracked", witnesses: [], quorum: "single", dev: null };
    function tf(v, o) { o = o || {}; var m = {}; for (var k in tm) m[k] = tm[k]; for (var k2 in o) m[k2] = o[k2]; return field(v, null, m); }

    var tot = null, vol = null, wsum = 0, wden = 0, up = 0, seen = 0, btcM = null, ethM = null;
    mem.forEach(function (c) {
      var m = window.DLF ? DLF.n(c.mcap) : c.mcap, v = window.DLF ? DLF.n(c.vol) : c.vol;
      if (m != null) { tot = (tot || 0) + m; wsum += (+c.c24 || 0) * m; wden += m; }
      if (v != null) vol = (vol || 0) + v;
      if (c.c24 != null) { seen++; if (+c.c24 > 0) up++; }
      if (c.sym === "BTC" && m != null) btcM = m;
      if (c.sym === "ETH" && m != null) ethM = m;
    });
    var tMcap = tf(mem.length ? tot : null, { unit: "USD" });
    var tracked = {
      label: U_TRACKED + " · top-" + mem.length,
      membership: {
        count: mem.length,
        includesStablecoins: true,
        basis: "every asset in the live ladder, stablecoins included, fabricated rows excluded"
      },
      marketCap: tMcap,
      volume24h: tf(mem.length ? vol : null, { unit: "USD" }),
      change24h: tf(wden ? wsum / wden : null, { unit: "%", precision: 2, derivedFrom: "market-cap-weighted 24h move of the tracked set" }),
      breadth: tf(seen ? Math.round(up / seen * 100) : null, { unit: "%", precision: 0, derivedFrom: "share of tracked assets up over 24h" }),
      dominance: {
        BTC: dominance(tf(btcM, { unit: "USD" }), tMcap, { cycleAt: cycleAt }),
        ETH: dominance(tf(ethM, { unit: "USD" }), tMcap, { cycleAt: cycleAt })
      }
    };

    var assets = {};
    mem.forEach(function (c) {
      assets[c.sym] = {
        price: tf(c.price, { unit: "USD" }),
        marketCap: tf(c.mcap, { unit: "USD" }),
        volume24h: tf(c.vol, { unit: "USD" }),
        supply: tf(c.supply, { unit: c.sym }),
        change24h: tf(c.c24, { unit: "%", precision: 2 })
      };
    });

    var sentiment = {
      fearGreed: field(fng ? fng.v : null, null, {
        unit: "index", precision: 0, universe: "global",
        source: fng ? fng.source : "no source", observedAt: null,
        fetchedAt: fng ? fng.at : 0, servedAt: fng ? fng.at : 0, cycleAt: cycleAt, stale: fng ? fng.stale : true
      }),
      fearGreedLabel: fng ? String(fng.label || "") : null
    };

    var S2 = { cycleAt: cycleAt, universes: { global: global, tracked: tracked }, assets: assets, sentiment: sentiment,
               checks: { volume: subsetCheck(tracked.volume24h, global.volume24h, "24h volume"),
                         marketCap: subsetCheck(tracked.marketCap, global.marketCap, "market cap") } };
    S2.digest = digest(S2);
    S2.id = "snap_" + cycleAt + "_" + S2.digest.slice(0, 8);
    return S2;
  }

  function publish(S2) {
    deepFreeze(S2);
    state.current = S2;
    state.ring.push(S2); if (state.ring.length > 12) state.ring.shift();
    state.lastAt = S2.cycleAt;
    repaint();
    state.listeners.slice().forEach(function (f) { try { f(S2); } catch (e) {} });
    return S2;
  }

  function cycle(force) {
    if (state.busy) return state.busy;
    if (!force && state.current && Date.now() - state.lastAt < 20000) { repaint(); return Promise.resolve(state.current); }
    var cycleAt = Date.now();
    state.busy = Promise.all([legGlobal(), legPaprika(), legFng()]).then(function (r) {
      state.busy = null; return publish(build(cycleAt, r[0], r[1], r[2]));
    }).catch(function () {
      state.busy = null; return publish(build(cycleAt, null, null, null));
    });
    return state.busy;
  }

  /* Before the first snapshot every read fell back to field(null,"loading",{}), whose
     default universe is "global" — so .mx-glob, which renders the TRACKED set, painted
     "WHOLE CRYPTO MARKET / Market cap Unavailable" for the whole cold load. A loading
     or missing field now takes its universe from the path it was asked for, so no
     surface can mislabel its own universe while it waits. */
  function get(path) {
    var ps = String(path || "").split(".");
    var u = ps[0] === "universes" && ps[1] ? ps[1] : "global";
    var o = state.current;
    if (!o) return field(null, "loading", { universe: u });
    for (var i = 0; i < ps.length; i++) { if (o == null) break; o = o[ps[i]]; }
    return (o && typeof o === "object" && "value" in o && "reason" in o) ? o : field(null, "unavailable", { universe: u });
  }

  /* ------------------------------------------------------------- rendering */
  function usd(v) { try { if (typeof cUSD === "function") return cUSD(v); } catch (e) {} return "$" + C.big(v); }
  function txt(f, fmt) { return f && f.value != null ? (fmt ? fmt(f.value) : String(f.value)) : "Unavailable"; }
  function money(f) { return txt(f, usd); }
  function pctTxt(f) { return txt(f, function (v) { return v.toFixed(f.precision == null ? 1 : f.precision) + "%"; }); }
  function prov(f) {
    if (!f) return "";
    return C.prov(f.source, f.servedAt, f.freshness === "stale",
      contested(f) ? { contested: true, title: witText(f) } : null);
  }
  /* One chip stands for a whole strip, so it must answer for every figure under it:
     if ANY of them is contested the chip says so and carries all their witnesses. */
  function provStrip(pairs, ref) {
    var bad = pairs.filter(function (x) { return contested(x[1]); });
    if (!bad.length) return prov(ref);
    return C.prov(ref.source, ref.servedAt, ref.freshness === "stale",
      { contested: true, title: bad.map(function (x) { return witText(x[1], x[0]); }).join("  ") });
  }
  function label(f) { return f ? f.universeLabel : ""; }
  function uni(f) { return '<span class="gs-u">' + C.esc(label(f)) + "</span>"; }
  function freshClass(path) { var f = get(path); return f ? f.freshness : "stale"; }

  /* S1 · the hero .stat-strip. Reads the whole-market figures; the strip is
     labelled with the universe it is showing, and its provenance chip is
     mounted once beside it. */
  function paintHero() {
    var d = document, mc = d.getElementById("g-mcap"), vl = d.getElementById("g-vol"), dm = d.getElementById("g-dom");
    if (!mc && !vl && !dm) return;
    var cap = get("universes.global.marketCap"), v = get("universes.global.volume24h"), b = get("universes.global.dominance.BTC");
    /* innerHTML, not textContent: a contested figure carries its disagreement mark
       AT the number, not only on the strip's chip. */
    if (mc) mc.innerHTML = C.esc(money(cap)) + dis(cap, "market cap");
    if (vl) vl.innerHTML = C.esc(money(v)) + dis(v, "24h volume");
    if (dm) dm.innerHTML = C.esc(pctTxt(b)) + dis(b, "BTC dominance") + srcNote(b, cap);
    var strip = (mc || vl || dm).closest(".stat-strip");
    if (strip) {
      var foot = strip.querySelector(".dl-snapfoot");
      if (!foot) { foot = d.createElement("div"); foot.className = "dl-snapfoot"; strip.appendChild(foot); }
      foot.innerHTML = uni(cap) + " " + provStrip([["market cap", cap], ["24h volume", v], ["BTC dominance", b]], cap);
    }
  }

  /* S2 · the .gi strip. Was the second, USDT-filtered answer. */
  function paintStrip(host) {
    if (!host) return;
    var t = state.current ? state.current.universes.tracked : null;
    var cap = get("universes.tracked.marketCap"), v = get("universes.tracked.volume24h"),
        w = get("universes.tracked.change24h"), b = get("universes.tracked.dominance.BTC"),
        e = get("universes.tracked.dominance.ETH"), fg = get("sentiment.fearGreed");
    var wv = w.value == null ? null : w.value;
    var s = '<span class="gi">Cryptos: <b>' + (t ? t.membership.count : 0) + "</b></span>" +
      '<span class="gi">Market Cap: <b>' + money(cap) + "</b>" +
      (wv == null ? "" : ' <span class="' + (wv >= 0 ? "up" : "down") + '">' + pctTxt(w) + "</span>") +
      " " + uni(cap) + "</span>" +
      '<span class="gi">24h Vol: <b>' + money(v) + "</b>" + flag("volume") + "</span>" +
      '<span class="gi">BTC Dominance: <b>' + pctTxt(b) + "</b></span>" +
      '<span class="gi">ETH: <b>' + pctTxt(e) + "</b></span>" +
      (fg.value == null ? "" : '<span class="gi">Fear &amp; Greed: <b>' + fg.value + " " +
        C.esc((state.current && state.current.sentiment.fearGreedLabel) || "") + "</b></span>") +
      '<span class="gi">' + prov(cap) + "</span>";
    var sim = false; try { sim = "live" !== telem.mode; } catch (_e) {}
    s += sim ? '<span class="gi" style="color:var(--gold);font-weight:700">● simulated prices — not real market data</span>'
             : '<span class="gi" style="color:var(--faint)">● live feed</span>';
    host.innerHTML = s;
  }

  /* S3 · fetchGlobals' read-model. G is what the tape reads; it was written
     once at boot and never again. Now it is refilled every cycle. */
  function fill(G) {
    if (!G) return G;
    var cap = get("universes.global.marketCap"), b = get("universes.global.dominance.BTC"), fg = get("sentiment.fearGreed");
    G.mcap = cap.value; G.dom = b.value; G.fng = fg.value;
    G.fngL = (state.current && state.current.sentiment.fearGreedLabel) || "";
    /* fill() refreshed the read-model and left the tape showing whatever it had painted
       last — the CoinGecko-only figure from before the first quorum, under a chip with no
       timestamp. The tape is a reader like everything else, so it repaints with the rest.
       renderTicker is the payload's own function and is already called on its own paths;
       calling it here adds no timer and cannot recurse (renderGStats -> paintStrip). */
    try { if (typeof window.renderTicker === "function") window.renderTicker(); } catch (e) {}
    return G;
  }

  /* S5 · the News-desk pulse panel. Its own /global fetch and its Coinpaprika
     fallback are gone; Coinpaprika is now a witness inside the cycle. */
  function pulse() { return cycle().then(function () { paintPulse(); return state.current; }).catch(function () { return null; }); }
  /* The pulse panel used to paint ONLY on a News visit and was never covered by repaint(),
     so it kept whichever snapshot happened to be current when the desk was last opened:
     a live run caught it showing $2.82T / $176.52B while every other surface showed the
     current record's $2.75T / $132.53B, under the same universe label. Painting is now
     separated from fetching so the panel is a reader like every other surface. */
  function paintPulse() {
      var d = document, cap = get("universes.global.marketCap"), v = get("universes.global.volume24h"),
          b = get("universes.global.dominance.BTC"), e = get("universes.global.dominance.ETH"),
          ch = get("universes.global.change24h");
      var set = function (id, s, f, what, ref) {
        var n = d.getElementById(id); if (!n) return;
        n.innerHTML = C.esc(s) + dis(f, what) + (ref ? srcNote(f, ref) : "");
      };
      set("pg-mcap", money(cap), cap, "market cap"); set("pg-vol", money(v), v, "24h volume");
      set("pg-btc", pctTxt(b), b, "BTC dominance", cap); set("pg-eth", pctTxt(e), e, "ETH dominance", cap);
      var row = d.querySelector("#globRows .gr:first-child");
      if (row && row.querySelector("b")) {
        row.querySelector("b").innerHTML = money(cap) + dis(cap, "market cap") +
          (ch.value == null ? "" : ' <span class="' + (ch.value >= 0 ? "up" : "down") + '" style="font-size:12px">' + pctTxt(ch) + "</span>") +
          " " + uni(cap) + " " + provStrip([["market cap", cap], ["24h volume", v]], cap);
      }
  }

  /* ---------------------------------------------------------------- v155-G
     ONE BAR, ONE UNIVERSE AT A TIME.

     Three surfaces stated a market cap, a BTC dominance and a Fear & Greed
     within 160px of one another: #cbCmd (the terminal command bar), #tape (the
     price ribbon) and #dlGstat (the Markets record, cut out in v159 — the owner
     read the panel itself as the noise). Every one of them was
     right and every one of them named the universe it measured — and a reader
     saw two market caps and two dominance figures at once and read the app as
     contradicting itself. The honesty work succeeded and the presentation failed.

     The fix is not to delete a figure or to drop a label. It is to stop showing
     two universes AT THE SAME TIME. Each bar renders exactly one universe and
     carries a two-segment switch; the other universe is one click away, with its
     own label, its own witness chip, its own contested mark. The selection is per
     bar. With the record gone in v159 the command bar is the only one left, on
     every view including Markets, and its default is unchanged: the tracked set.

     No timer and no observer: ONE delegated click listener, installed once, that
     fires only when a reader asks for the other universe. */
  var UNI_KEY = "dl.uni.v1";
  var uniSel = { cb: "tracked" };
  try {
    var _u = JSON.parse(localStorage.getItem(UNI_KEY) || "null");
    if (_u && typeof _u === "object") {
      if (_u.cb === "global" || _u.cb === "tracked") uniSel.cb = _u.cb;
    }
  } catch (e) {}

  function uniBase(which) { return "universes." + uniSel[which] + "."; }
  function uniSwitch(which) {
    var g = uniSel[which] === "global";
    return '<span class="gs-uni" role="group" aria-label="Market universe" data-uni-bar="' + which + '">' +
      '<button type="button" data-uni="global" aria-pressed="' + g + '">Whole market</button>' +
      '<button type="button" data-uni="tracked" aria-pressed="' + !g + '">Tracked set</button></span>';
  }
  /* Which route is on screen, stamped on <html> so a stylesheet can ask.
     This was a `html:has(main#page-markets.page.active)` rule, and a :has() anchored at
     the root with a deep subject makes Chromium re-run the match on every mutation in a
     2.7MB document — the render-contrast walk took the renderer down with it. A one-word
     attribute costs nothing to read. No timer and no observer: it rides window.nav, which
     is the function that already changes the route. */
  function stampRoute() {
    try {
      var m = document.querySelector("main.page.active") || document.querySelector("main.page");
      var id = m ? String(m.id || "").replace(/^page-/, "") : "";
      var de = document.documentElement;
      if (de.getAttribute("data-route") !== id) de.setAttribute("data-route", id);
    } catch (e) {}
  }
  var uniBound = false;
  function uniBind() {
    if (uniBound) return; uniBound = true;
    stampRoute();
    try {
      var _nav = window.nav;
      if (typeof _nav === "function" && !_nav.__dlroute) {
        var w = function () { var r = _nav.apply(this, arguments); stampRoute(); return r; };
        w.__dlroute = 1;
        for (var k in _nav) try { w[k] = _nav[k]; } catch (e2) {}
        window.nav = w;
      }
    } catch (e3) {}
    document.addEventListener("click", function (ev) {
      var t = ev.target, b = t && t.closest && t.closest('.gs-uni button[data-uni]');
      if (!b) return;
      var grp = b.closest(".gs-uni"), which = grp && grp.getAttribute("data-uni-bar");
      if (!which || !(which in uniSel)) return;
      var want = b.getAttribute("data-uni") === "global" ? "global" : "tracked";
      if (uniSel[which] === want) return;
      uniSel[which] = want;
      try { localStorage.setItem(UNI_KEY, JSON.stringify(uniSel)); } catch (e2) {}
      /* repaint() is the path that already runs; it re-derives every chip from the
         one shared clock, so the two bars cannot disagree about the instant. */
      try { repaint(); } catch (e3) {}
    });
  }

  /* S6 · the command bar. Was the third USDT-filtered sum, on a 5s clock.
     It paints from the tracked universe and returns null so the payload's
     updStats() cannot re-derive anything of its own. */
  function barState() {
    var d = document, $$ = function (i) { return d.getElementById(i); };
    var U = uniBase("cb");
    var cap = get(U + "marketCap"), v = get(U + "volume24h"),
        w = get(U + "change24h"), b = get(U + "dominance.BTC"),
        e = get(U + "dominance.ETH"), fg = get("sentiment.fearGreed");
    uniBind();
    /* .cb-agg marks the group that states a market aggregate. It is what layers/v154.css
       hides on the one view that carries a fuller bar for the same figures, so the two
       are never simultaneous — the markup, its labels and its chips are untouched. */
    var agg = function (n) { if (n) n.className = (n.className || "").indexOf("cb-agg") < 0 ? (n.className + " cb-agg") : n.className; return n; };
    var n1 = agg($$("cbMcap"));
    if (n1) n1.innerHTML = uniSwitch("cb") + " MCap <b>" + money(cap) + "</b>" + dis(cap, "market cap") +
      (w.value == null ? "" : ' <span class="' + (w.value >= 0 ? "up" : "down") + '">' + pctTxt(w) + "</span>") +
      " " + uni(cap) + " " + prov(cap);
    var n2 = agg($$("cbVol")); if (n2) n2.innerHTML = "Vol <b>" + money(v) + "</b>" + flag("volume") + dis(v, "24h volume");
    var n3 = agg($$("cbDom")); if (n3) n3.innerHTML = "BTC <b>" + pctTxt(b) + "</b>" + dis(b, "BTC dominance") + srcNote(b, cap);
    var n4 = agg($$("cbEth")); if (n4) n4.innerHTML = "ETH <b>" + pctTxt(e) + "</b>" + srcNote(e, cap);
    var n5 = agg($$("cbFng")); if (n5) n5.innerHTML = fg.value == null ? "" : "F&G <b>" + fg.value + "</b>";
    try { C.provRefresh(); } catch (e) {}
    return null;
  }

  /* S7 · the MX global panel. Was a top-500 store answering the same question
     as the top-30 one, under the same label. Now it renders the tracked
     universe and says so. */
  function mxPanel() {
    var cap = get("universes.tracked.marketCap"), v = get("universes.tracked.volume24h"),
        b = get("universes.tracked.dominance.BTC"), e = get("universes.tracked.dominance.ETH");
    return '<div class="mx-panel mx-glob"><div class="mx-ph">' + C.esc(label(cap)) + "</div>" +
      '<div class="gg"><span class="k">Market cap</span><span class="v">' + money(cap) + "</span></div>" +
      '<div class="gg"><span class="k">24h volume</span><span class="v">' + money(v) + flag("volume") + "</span></div>" +
      '<div class="gg"><span class="k">BTC dominance</span><span class="v">' + pctTxt(b) + "</span></div>" +
      '<div class="gg"><span class="k">ETH dominance</span><span class="v">' + pctTxt(e) + "</span></div>" +
      '<div class="gg">' + uni(cap) + " " + prov(cap) + "</div></div>";
  }

  /* S8 · aggr() declared approx:1 but nothing ever rendered it beside the
     number. It now returns the tracked universe, labelled. */
  function aggrTracked() {
    var t = state.current ? state.current.universes.tracked : null;
    if (!t) return null;
    return {
      mcap: t.marketCap.value, vol: t.volume24h.value,
      btc: t.dominance.BTC.value, eth: t.dominance.ETH.value,
      chg: t.change24h.value, breadth: t.breadth.value,
      n: t.membership.count, approx: 1, __snap: 1
    };
  }


  /* S12 · the DeXaI global intent. Was a fourth provider at a fifth instant;
     the copilot now cites exactly what is on screen. */
  function answerGlobal() {
    var cap = get("universes.global.marketCap"), v = get("universes.global.volume24h"),
        b = get("universes.global.dominance.BTC"), ch = get("universes.global.change24h"),
        t = get("universes.tracked.marketCap");
    return {
      title: "Crypto market · " + label(cap),
      html: '<span class="hero">' + money(cap) + "</span>" + dis(cap, "market cap") +
        '<div class="kv"><span>24h change</span><b>' + pctTxt(ch) + "</b></div>" +
        '<div class="kv"><span>24h volume</span><b>' + money(v) + dis(v, "24h volume") + "</b></div>" +
        '<div class="kv"><span>BTC dominance</span><b>' + pctTxt(b) + "</b>" + srcNote(b, cap) + "</div>" +
        '<div class="kv"><span>' + C.esc(label(t)) + "</span><b>" + money(t) + "</b></div>" +
        '<div class="kv"><span>snapshot</span><b>' + (state.current ? state.current.id : "Unavailable") + "</b></div>" +
        '<div class="kv">' + uni(cap) + " " + provStrip([["market cap", cap], ["24h volume", v]], cap) + "</div>",
      src: cap.source + " · " + label(cap) + " · snapshot " + (state.current ? state.current.id : "none"),
      follow: ["What is bitcoin dominance?", "What is market cap, exactly?", "Top movers today"]
    };
  }

  /* S13 · quorumCheck computed a median and a deviation and discarded both.
     They are now recorded against the snapshot that was on screen. */
  /* The record itself is frozen, so the witness ledger is kept beside it, keyed by the
     snapshot id that was on screen when the vote was taken. */
  function witness(sym, votes, med, dev) {
    if (!state.current) return null;
    var rec = {
      snapshot: state.current.id, median: med, dev: dev,
      quorum: votes.length === 1 ? "single" : (dev > QUORUM_TOLERANCE_PCT ? "disagree" : "agree"),
      witnesses: votes.map(function (v) { return { source: v.k, value: v.p }; }),
      at: Date.now()
    };
    state.prices[sym] = rec;
    return rec;
  }
  function priceWitness(sym) { return state.prices[String(sym || "").toUpperCase()] || null; }

  /* ---------------------------------------------------------------- ledger */
  function byId(id) {
    for (var i = 0; i < state.ring.length; i++) if (state.ring[i].id === id) return state.ring[i];
    return state.pinned[id] || null;                 /* evicted → unavailable, never re-fetched */
  }
  function pin(id) { var s = byId(id); if (s) state.pinned[id] = s; return !!s; }
  function on(f) { state.listeners.push(f); }
  function off(f) { state.listeners = state.listeners.filter(function (x) { return x !== f; }); }

  function repaint() {
    try { paintHero(); } catch (e) {}
    try { var h = document.getElementById("gstatsIn"); if (h) paintStrip(h); } catch (e) {}
    try { barState(); } catch (e) {}
    try { paintPulse(); } catch (e) {}
    /* .mx-glob was painted once by the MX render and never again: repaint() did not
       cover it, so it held its cold-load state for the whole first minute. It is a
       pure string render with no listeners, so replacing it in place is safe. */
    try {
      var gs = document.querySelectorAll(".mx-glob");
      for (var i = 0; i < gs.length; i++) gs[i].outerHTML = mxPanel();
    } catch (e) {}
    try { if (typeof G !== "undefined") fill(G); } catch (e) {}
    /* every chip in the document re-derives its age from ONE clock reading, so the
       surfaces that just repainted and the ones that did not still show one age. */
    try { C.provRefresh(); } catch (e) {}
  }

  /* ------------------------------------------------------------------ boot
     No setInterval here. The cycle rides the payload's existing 60s live loop
     (which calls loadLive) and repaints whenever adopt() changes the tracked
     universe. */
  var started = false;
  function start() {
    if (started) return; started = true;
    try {
      if (typeof window.loadLive === "function") {
        var _ll = window.loadLive;
        window.loadLive = function () { try { cycle(); } catch (e) {} return _ll.apply(this, arguments); };
      }
    } catch (e) {}
    try {
      if (typeof window.adopt === "function") {
        var _ad = window.adopt;
        window.adopt = function () { var r = _ad.apply(this, arguments); try { cycle(); } catch (e) {} return r; };
      }
    } catch (e) {}
    cycle(true);
  }

  return {
    __v: 155,
    get current() { return state.current; },
    get: get, field: field, freshness: freshness, resolve: resolve, dominance: dominance,
    witness1: wit,
    txt: txt, prov: prov, provStrip: provStrip, label: label, uni: uni, money: money, pct: pctTxt,
    contested: contested, dis: dis, mark: mark, witText: witText, disagreements: disagreements,
    flag: flag, srcNote: srcNote, subsetCheck: subsetCheck,
    get checks() { return state.current ? state.current.checks : null; },
    cycle: cycle, digest: digest, byId: byId, pin: pin, on: on, off: off,
    members: trackedMembers,
    asset: function (sym) { try { return (state.current && state.current.assets[String(sym).toUpperCase()]) || null; } catch (e) { return null; } },
    paintHero: paintHero, paintStrip: paintStrip,
    barState: barState, mxPanel: mxPanel, aggrTracked: aggrTracked,
    answerGlobal: answerGlobal, pulse: pulse, paintPulse: paintPulse, fill: fill, witness: witness,
    freshClass: freshClass, start: start, repaint: repaint, priceWitness: priceWitness,
    TOLERANCE: QUORUM_TOLERANCE_PCT
  };
})();

/* ═══════════════════════════════════════════════════════════════════════════
   v159a · THE SNAPSHOT STARTS ITSELF.

   It never did. `start()` has existed since v155 — it wraps window.loadLive and
   window.adopt so every refresh re-cycles, then cycles once itself — and NOTHING
   IN THE APP EVER CALLED IT. What actually booted the canonical snapshot was
   mountStrip(), the #dlGstat painter, whose body ended `if (state.current)
   paint(); else cycle();`. The Markets record strip was the ignition key for
   every market figure in the product.

   v159 removed that strip on the owner's call, and with it the only caller of
   cycle() on a cold load. loadPulse() also calls DLSNAP.pulse(), but it is
   guarded by pulseLoaded and only runs when the Pulse view is opened — so on
   Markets, the command bar, the hero, the tracked-set card and every figure
   downstream of DLSNAP rendered "Unavailable · derived · no data · stale"
   against feeds that were live and answering. DLBX read `live` from CoinGecko
   with 30 coins in hand the whole time; nothing was ever asked for.

   So the layer boots itself now, which is what a self-mounting layer should
   always have done:
     · wait for window.loadLive to exist, so start()'s hook actually lands —
       installing it before the payload defines loadLive silently wraps nothing;
     · then start(), which cycles immediately and re-cycles on every refresh;
     · then confirm. cycle(true) can land before the first coin list does, and
       if loadLive has already fired by then the hook has nothing left to catch,
       which is exactly how a cold load gets stuck on nulls forever. So poll the
       tracked market cap and re-cycle until it is real — bounded, and it stops
       the moment it has an answer or after 40 s, because a surface that retries
       forever is a surface that hides a dead feed.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  var S = window.DLSNAP; if (!S || !S.start) return;
  var waited = 0, confirmed = 0;

  function hasFigure() {
    try {
      var c = S.current;
      if (!c) return false;
      var u = c.universes || {};
      var t = (u.tracked && u.tracked.marketCap), g = (u.global && u.global.marketCap);
      return (t != null && t > 0) || (g != null && g > 0);
    } catch (e) { return false; }
  }

  function confirm() {
    if (hasFigure() || confirmed > 20) return;          /* ~40 s ceiling */
    confirmed++;
    try { S.cycle(); } catch (e) {}
    try { S.repaint(); } catch (e) {}
    setTimeout(confirm, 2000);
  }

  function boot() {
    /* 10 s for the payload to define loadLive; after that, start anyway —
       one cycle with no refresh hook still beats no snapshot at all. */
    if (typeof window.loadLive !== "function" && waited < 100) {
      waited++; setTimeout(boot, 100); return;
    }
    try { S.start(); } catch (e) {}
    setTimeout(confirm, 1200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else { boot(); }
})();
