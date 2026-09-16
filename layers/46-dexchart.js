/* ============================================================================
   DXC · DexChart Pro — layer 46 · the DexLadder charting engine
   ----------------------------------------------------------------------------
   Replaces the native chart (one 344px canvas, five indicator toggles, no
   drawing layer) with a full charting terminal that renders on the SAME
   #coinChart canvas inside the SAME bounded #coinHost panel (560px desktop /
   430px phone — gate-arch measures it), so the panel contract is untouched.

   WHAT THIS FILE HOLDS
     1  util + theme            palette per Day/Night, dpr, formatting
     2  state + persistence     one record per surface in localStorage
     3  data                    real OHLCV klines through DLCORE.jget
                                (Binance market data → Coinbase → the payload's
                                own 30-minute series, labelled by source)
     4  math                    58 indicator formulas, pure, array in/out
     5  studies registry        what each indicator draws, its inputs + style
     6  series transforms       Heikin Ashi, Renko, Kagi, Point & Figure,
                                Line Break, Baseline
     7  geometry                panes, price scale (linear/log/%/indexed/
                                inverted), time scale, bar spacing
     8  renderer                grid, axes, 16 chart types, volume, sub-panes,
                                overlays, crosshair, legend, order/position
                                lines, watermark
     9  drawings                60 tools over 14 render primitives, anchors,
                                hit-testing, magnet, undo/redo, per-symbol store
    10  interaction             pointer, wheel, pinch, keyboard, selection
    11  chrome                  tool rail, top bar, HUD, style bar, dialogs
                                (indicators, settings, templates, object tree,
                                compare, hotkeys), fullscreen, PNG snapshot

   LAYER CONTRACT OBSERVED
     · self-mounting, idempotent (window.DXC.__v), mounts on the first draw
     · no network code of its own — every request goes through DLCORE.jget
     · no eval family, no string timers, no persistent timer of its own
       (the payload's own 1s coin tick and rAF-on-dirty drive the redraw)
     · no inline style attribute and no .style.<prop> = assignment anywhere
       (gate-arch ratchets both) — geometry is CSS in layers/v154.css and
       custom properties set with style.setProperty('--dxc-*')
     · no innerHTML on any node that carries user or feed text
     · rebinds nothing: the payload hands control over in buildlib/dxc.py
     · Day + Night, prefers-reduced-motion, keyboard and aria throughout
   ============================================================================ */
window.DXC = (function () {
  "use strict";
  if (window.DXC && window.DXC.__v) return window.DXC;

  var d = document, W = window;
  var C = W.DLCORE || null;

  /* =====================================================================
     1 · UTIL + THEME
     ===================================================================== */

  var TAU = Math.PI * 2;
  /* The payload declares its state object with a LEXICAL binding (`S`), so it is not a
     property of window — a layer reaches it by name, because every layer is an inline
     script sharing the page's global lexical scope. W.S is the fallback the node harness
     (test/dxc-harness.js) uses, where no such binding exists. */
  function ST() {
    try { if (typeof S !== "undefined" && S) return S; } catch (e) { }
    return W["S"] || {};
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function last(a) { return a && a.length ? a[a.length - 1] : null; }
  function now() { return Date.now(); }
  function calm() { try { return typeof W.motionCalm === "function" ? !!W.motionCalm() : false; } catch (e) { return false; } }
  function day() { return d.documentElement.getAttribute("data-mode") === "day"; }

  /* price formatting: the payload's own fmt when it is there, a sane fallback when it is not */
  function fmt(v, dec) {
    if (!isNum(v)) return "—";
    if (typeof W.fmt === "function" && dec == null) { try { return W.fmt(v); } catch (e) { } }
    var a = Math.abs(v), p = dec != null ? dec : a >= 1000 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 5 : 8;
    return v.toLocaleString(undefined, { minimumFractionDigits: p, maximumFractionDigits: p });
  }
  function sig(v) { /* axis labels: short, stable width */
    if (!isNum(v)) return "";
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (v / 1e6).toFixed(2) + "M";
    if (a >= 1000) return v.toFixed(a >= 1e5 ? 0 : 2);
    if (a >= 1) return v.toFixed(4);
    if (a >= 0.01) return v.toFixed(5);
    return v.toPrecision(4);
  }
  function vol(v) {
    var a = Math.abs(+v || 0);
    return a >= 1e9 ? (a / 1e9).toFixed(2) + "B" : a >= 1e6 ? (a / 1e6).toFixed(2) + "M" : a >= 1e3 ? (a / 1e3).toFixed(1) + "K" : a.toFixed(2);
  }
  function pctS(v, dec) { return (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(dec == null ? 2 : dec) + "%"; }

  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function stamp(t, iv) {
    var x = new Date(t), intra = IVMS(iv) < 864e5;
    /* v162 · a daily candle is a UTC day. Reading it with local getters put the
       previous date on the bar for every viewer west of UTC. Intraday stamps
       stay local, which is what a reader wants on a minute chart. */
    return intra ? (pad2(x.getDate()) + " " + MON[x.getMonth()] + "  " + pad2(x.getHours()) + ":" + pad2(x.getMinutes()))
      : (pad2(x.getUTCDate()) + " " + MON[x.getUTCMonth()] + " " + x.getUTCFullYear());
  }
  function tickLabel(t, iv) {
    var x = new Date(t), ms = IVMS(iv);
    if (ms >= 26e8) return String(x.getUTCFullYear());
    if (ms >= 864e5) return pad2(x.getUTCDate()) + " " + MON[x.getUTCMonth()];
    if (x.getHours() === 0 && x.getMinutes() === 0) return pad2(x.getDate()) + " " + MON[x.getMonth()];
    return pad2(x.getHours()) + ":" + pad2(x.getMinutes());
  }

  /* one palette per mode. Night is the TradingView-parity box the panel already paints
     (#141619 ground, #2A2E39 inner line) so the engine and the panel agree. */
  var PAL_NIGHT = {
    bg: "#141619", grid: "rgba(130,145,190,.075)", gridH: "rgba(130,145,190,.075)",
    axis: "#2A2E39", text: "#7E8AB8", textHi: "#E7EDF8", faint: "rgba(126,138,184,.45)",
    up: "#22D39A", dn: "#FF5A78", upFill: "rgba(34,211,154,.86)", dnFill: "rgba(255,90,120,.86)",
    volUp: "rgba(34,211,154,.30)", volDn: "rgba(255,90,120,.30)",
    line: "#5B8CFF", cross: "rgba(185,198,255,.42)", tipBg: "rgba(9,13,30,.92)", tipLine: "rgba(140,155,220,.32)",
    mark: "rgba(231,237,248,.045)", sel: "#00E5FF", band: "rgba(91,140,255,.10)", ink: "#0A0E20"
  };
  var PAL_DAY = {
    bg: "#FFFFFF", grid: "rgba(11,16,32,.055)", gridH: "rgba(11,16,32,.055)",
    axis: "#D7DEEA", text: "#5A6580", textHi: "#0B1020", faint: "rgba(90,101,128,.5)",
    up: "#0E9F6E", dn: "#E02D4E", upFill: "rgba(14,159,110,.9)", dnFill: "rgba(224,45,78,.9)",
    volUp: "rgba(14,159,110,.22)", volDn: "rgba(224,45,78,.22)",
    line: "#3355DD", cross: "rgba(20,30,60,.4)", tipBg: "rgba(255,255,255,.95)", tipLine: "rgba(11,16,32,.14)",
    mark: "rgba(11,16,32,.04)", sel: "#0E7FA8", band: "rgba(51,85,221,.09)", ink: "#FFFFFF"
  };
  function P() { return day() ? PAL_DAY : PAL_NIGHT; }

  /* a deterministic palette for study lines, so two studies never collide */
  var SERIES_COLORS = ["#5B8CFF", "#F5A623", "#22D39A", "#FF5A78", "#B36BFF", "#00E5FF",
    "#FFD166", "#7BE38A", "#FF8A5B", "#6FA8FF", "#E26BFF", "#3DD6D0"];

  /* =====================================================================
     2 · STATE + PERSISTENCE
     ===================================================================== */

  var LS = {
    get: function (k, dflt) {
      try { var s = W.localStorage.getItem(k); return s ? JSON.parse(s) : dflt; } catch (e) { return dflt; }
    },
    set: function (k, v) { try { W.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
    del: function (k) { try { W.localStorage.removeItem(k); } catch (e) { } }
  };

  var K_CFG = "dl.dxc.cfg", K_TPL = "dl.dxc.tpl", K_DRAW = "dl.dxc.draw.", K_FAV = "dl.dxc.fav";

  function defCfg() {
    return {
      iv: "1h",
      type: "candles",
      studies: [
        { id: "vol", k: "vol", p: {}, s: {}, pane: 1, on: true },
        { id: "ema20", k: "ema", p: { len: 20, src: "close" }, s: { c: "#F5A623" }, pane: 0, on: true },
        { id: "ema50", k: "ema", p: { len: 50, src: "close" }, s: { c: "#5B8CFF" }, pane: 0, on: true }
      ],
      scale: { mode: "linear", invert: false, lock: false, right: true },
      bars: { spacing: 8, right: 14 },
      look: {
        grid: true, gridV: true, wick: true, border: true, hollowUp: false, mark: true,
        priceLine: true, hlLines: false, avgLine: false, countdown: true, sessions: false,
        orders: true, position: true, alerts: true, prec: 0
      },
      draw: { magnet: "off", stay: false, hide: false, lock: false, sync: true },
      cmp: []
    };
  }
  function mergeCfg(base, over) {
    if (!over || typeof over !== "object") return base;
    var out = base, k;
    for (k in over) {
      if (!Object.prototype.hasOwnProperty.call(over, k)) continue;
      if (k === "studies" || k === "cmp") { if (Array.isArray(over[k])) out[k] = over[k]; continue; }
      if (out[k] && typeof out[k] === "object" && !Array.isArray(out[k]) && over[k] && typeof over[k] === "object") {
        var j; for (j in over[k]) if (Object.prototype.hasOwnProperty.call(over[k], j)) out[k][j] = over[k][j];
      } else out[k] = over[k];
    }
    return out;
  }

  var CFG = mergeCfg(defCfg(), LS.get(K_CFG, null));
  function saveCfg() { LS.set(K_CFG, CFG); }

  /* live, non-persisted view state */
  var V = {
    mounted: false, dirty: true, raf: 0,
    /* time scale: first visible bar index (float) and how many bars are visible */
    i0: null, n: null,
    /* price scale overrides per pane, set by dragging the axis; null = auto */
    yman: {},
    cursor: null,           /* {x,y,i,pane} */
    sel: [],                /* selected drawing ids */
    tool: null,             /* active tool id */
    pending: null,          /* drawing under construction */
    drag: null,             /* {mode, ...} */
    panes: [],              /* computed layout */
    geo: null,              /* computed geometry of the last frame */
    replay: { on: false, i: 0, play: false, speed: 1, at: 0 },
    fs: false,
    msg: "",
    mkey: ""
  };

  function symKey() {
    var S = ST();
    return (S.coin || "BTC") + "-" + (S.quote || "USDT");
  }
  function mkey() { return symKey() + "|" + CFG.iv; }

  /* =====================================================================
     3 · DATA — real OHLCV
     ===================================================================== */

  var IVS = [
    { id: "1m", ms: 60000, bn: "1m", cb: 60, lbl: "1 minute" },
    { id: "3m", ms: 180000, bn: "3m", cb: 0, lbl: "3 minutes" },
    { id: "5m", ms: 300000, bn: "5m", cb: 300, lbl: "5 minutes" },
    { id: "15m", ms: 900000, bn: "15m", cb: 900, lbl: "15 minutes" },
    { id: "30m", ms: 1800000, bn: "30m", cb: 0, lbl: "30 minutes" },
    { id: "1h", ms: 3600000, bn: "1h", cb: 3600, lbl: "1 hour" },
    { id: "2h", ms: 7200000, bn: "2h", cb: 0, lbl: "2 hours" },
    { id: "4h", ms: 14400000, bn: "4h", cb: 14400, lbl: "4 hours" },
    { id: "6h", ms: 21600000, bn: "6h", cb: 21600, lbl: "6 hours" },
    { id: "12h", ms: 43200000, bn: "12h", cb: 0, lbl: "12 hours" },
    { id: "1d", ms: 86400000, bn: "1d", cb: 86400, lbl: "1 day" },
    { id: "3d", ms: 259200000, bn: "3d", cb: 0, lbl: "3 days" },
    { id: "1w", ms: 604800000, bn: "1w", cb: 0, lbl: "1 week" },
    { id: "1M", ms: 2592000000, bn: "1M", cb: 0, lbl: "1 month" }
  ];
  var QUICK_IV = ["5m", "15m", "1h", "4h", "1d", "1w"];
  function IV(id) { for (var i = 0; i < IVS.length; i++) if (IVS[i].id === id) return IVS[i]; return IVS[5]; }
  function IVMS(id) { return IV(id).ms; }

  /* a store per symbol+interval: {bars:[{t,o,h,l,c,v}], src, at, state} */
  var BOOK = {};
  function store(key) { return BOOK[key] || (BOOK[key] = { bars: [], src: "", at: 0, state: "idle", err: "" }); }

  function jget(url, key, ttl) {
    if (!C || typeof C.jget !== "function") return Promise.reject(new Error("no data path on this page"));
    return C.jget(url, { key: key, ttl: ttl || 45000, ms: 9000 }).then(function (r) { return r && "data" in r ? r.data : r; });
  }
  function binURL(sym, bn, n, end) {
    return "https://data-api.binance.vision/api/v3/klines?symbol=" + sym + "USDT&interval=" + bn +
      "&limit=" + n + (end ? "&endTime=" + end : "");
  }
  function cbURL(sym, sec) {
    return "https://api.exchange.coinbase.com/products/" + sym + "-USD/candles?granularity=" + sec;
  }
  function parseBinance(rows) {
    var K = W.DLAPP && W.DLAPP.backtest;
    if (K && typeof K.binanceCandles === "function") return K.binanceCandles(rows);
    if (!Array.isArray(rows)) return [];
    return rows.filter(Array.isArray).map(function (r) {
      return { t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] || 0 };
    }).filter(okBar).sort(byT);
  }
  function parseCoinbase(rows) {
    var K = W.DLAPP && W.DLAPP.backtest;
    if (K && typeof K.coinbaseCandles === "function") return K.coinbaseCandles(rows);
    if (!Array.isArray(rows)) return [];
    return rows.filter(Array.isArray).map(function (r) {
      return { t: +r[0] * 1000, o: +r[3], h: +r[2], l: +r[1], c: +r[4], v: +r[5] || 0 };
    }).filter(okBar).sort(byT);
  }
  function okBar(c) {
    return c && c.t > 0 && c.o > 0 && c.h > 0 && c.l > 0 && c.c > 0 &&
      c.h >= Math.max(c.o, c.c) - 1e-9 && c.l <= Math.min(c.o, c.c) + 1e-9;
  }
  function byT(a, b) { return a.t - b.t; }

  /* the payload's own 30-minute close series, aggregated into candles. Honest last resort:
     it is labelled 'on-device series' in the legend, never passed off as venue candles. */
  function localBars(sym, quote, iv) {
    var hist = null;
    try { hist = typeof W.pairHist === "function" ? W.pairHist(sym, quote, 1e9) : null; } catch (e) { hist = null; }
    if (!hist || hist.length < 8) return [];
    var per = Math.max(1, Math.round(IVMS(iv) / 18e5)), out = [], endT = now(), step = IVMS(iv);
    var groups = Math.floor(hist.length / per);
    for (var g = 0; g < groups; g++) {
      var seg = hist.slice(g * per, (g + 1) * per), hi = -Infinity, lo = Infinity;
      for (var i = 0; i < seg.length; i++) { if (seg[i] > hi) hi = seg[i]; if (seg[i] < lo) lo = seg[i]; }
      out.push({ t: endT - (groups - 1 - g) * step, o: seg[0], c: seg[seg.length - 1], h: hi, l: lo, v: 0, synth: true });
    }
    return out.filter(okBar);
  }

  /* scale a USDT series into the surface's quote so the chart joins the live price with no step */
  function rescale(bars, sym, quote) {
    if (!bars.length) return bars;
    var live = 0;
    try { live = typeof W.pairPrice === "function" ? W.pairPrice(sym, quote) : 0; } catch (e) { live = 0; }
    if (!(live > 0)) return bars;
    var k = live / last(bars).c;
    if (!(k > 0 && isFinite(k))) return bars;
    if (Math.abs(k - 1) < 1e-9) return bars;
    return bars.map(function (b) {
      return { t: b.t, o: b.o * k, h: b.h * k, l: b.l * k, c: b.c * k, v: b.v, synth: b.synth };
    });
  }

  function merge(have, fresh, cap) {
    var m = {}, i, out = [];
    for (i = 0; i < have.length; i++) m[have[i].t] = have[i];
    for (i = 0; i < fresh.length; i++) m[fresh[i].t] = fresh[i];
    for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k)) out.push(m[k]);
    out.sort(byT);
    cap = cap || 1500;
    return out.length > cap ? out.slice(out.length - cap) : out;
  }

  var LOADQ = {};
  function load(force) {
    var S = ST(), sym = S.coin || "BTC", quote = S.quote || "USDT", iv = CFG.iv, key = sym + "-" + quote + "|" + iv;
    var st = store(key), spec = IV(iv);
    if (st.state === "loading") return;
    if (!force && st.at && now() - st.at < Math.min(60000, spec.ms)) return;
    if (LOADQ[key] && now() - LOADQ[key] < 4000) return;
    LOADQ[key] = now();
    st.state = "loading";
    var want = 1000;
    jget(binURL(sym, spec.bn, want), "dl.dxc.b." + key, Math.min(45000, spec.ms))
      .then(function (rows) {
        var cs = parseBinance(rows);
        if (!cs.length) throw new Error("no bars");
        return { cs: cs, src: "Binance" };
      })
      .catch(function () {
        if (!spec.cb) throw new Error("no second venue for " + iv);
        return jget(cbURL(sym, spec.cb), "dl.dxc.c." + key, Math.min(45000, spec.ms))
          .then(function (rows) {
            var cs = parseCoinbase(rows);
            if (!cs.length) throw new Error("no bars");
            return { cs: cs, src: "Coinbase" };
          });
      })
      .then(function (r) {
        st.bars = merge(st.bars, rescale(r.cs, sym, quote));
        st.src = r.src; st.at = now(); st.state = "ok"; st.err = "";
        V.dirty = true; frame();
      })
      .catch(function (e) {
        var lb = localBars(sym, quote, iv);
        if (lb.length) { st.bars = lb; st.src = "on-device series"; st.at = now(); st.state = "ok"; }
        else { st.state = "err"; st.err = String((e && e.message) || e); }
        V.dirty = true; frame();
      });
  }

  /* the bar array the renderer reads, with the live price folded into the open bar */
  function bars() {
    var S = ST(), key = (S.coin || "BTC") + "-" + (S.quote || "USDT") + "|" + CFG.iv;
    var st = store(key), bs = st.bars;
    if (!bs.length) return bs;
    var live = 0;
    try { live = typeof W.pairPrice === "function" ? W.pairPrice(S.coin, S.quote) : 0; } catch (e) { live = 0; }
    if (!(live > 0)) return bs;
    var ms = IVMS(CFG.iv), lb = last(bs), openAt = Math.floor(now() / ms) * ms, out = bs;
    if (lb.t >= openAt) {
      out = bs.slice(0, bs.length - 1);
      out.push({ t: lb.t, o: lb.o, h: Math.max(lb.h, live), l: Math.min(lb.l, live), c: live, v: lb.v, synth: lb.synth, live: true });
    } else if (openAt - lb.t <= ms * 3) {
      out = bs.slice();
      out.push({ t: openAt, o: lb.c, h: Math.max(lb.c, live), l: Math.min(lb.c, live), c: live, v: 0, synth: lb.synth, live: true });
    }
    return out;
  }
  function source() {
    var S = ST(), st = store((S.coin || "BTC") + "-" + (S.quote || "USDT") + "|" + CFG.iv);
    return st;
  }

  /* comparison overlays: another symbol's closes on the same bars, normalised to % */
  var CMPB = {};
  function loadCmp(sym) {
    var spec = IV(CFG.iv), key = sym + "|" + CFG.iv;
    if (CMPB[key] && now() - CMPB[key].at < Math.min(120000, spec.ms * 2)) return;
    CMPB[key] = CMPB[key] || { bars: [], at: 0 };
    CMPB[key].at = now();
    jget(binURL(sym, spec.bn, 1000), "dl.dxc.x." + key, Math.min(60000, spec.ms))
      .then(function (rows) {
        var cs = parseBinance(rows);
        if (cs.length) { CMPB[key] = { bars: cs, at: now() }; V.dirty = true; frame(); }
      }).catch(function () { });
  }
  function cmpBars(sym) { var r = CMPB[sym + "|" + CFG.iv]; return r ? r.bars : []; }

  /* =====================================================================
     4 · MATH — every formula the studies use. Pure: arrays in, arrays out.
     A leading value that a window cannot support is null, never a guess,
     so nothing is ever drawn from a window that did not exist yet.
     ===================================================================== */

  var M = {};

  M.src = function (bs, which) {
    var i, n = bs.length, o = new Array(n);
    for (i = 0; i < n; i++) {
      var b = bs[i];
      o[i] = which === "open" ? b.o : which === "high" ? b.h : which === "low" ? b.l :
        which === "hl2" ? (b.h + b.l) / 2 : which === "hlc3" ? (b.h + b.l + b.c) / 3 :
          which === "ohlc4" ? (b.o + b.h + b.l + b.c) / 4 : which === "vol" ? b.v : b.c;
    }
    return o;
  };
  M.sma = function (x, p) {
    var o = new Array(x.length), s = 0, i;
    for (i = 0; i < x.length; i++) {
      s += x[i];
      if (i >= p) s -= x[i - p];
      o[i] = i >= p - 1 ? s / p : null;
    }
    return o;
  };
  M.ema = function (x, p) {
    var o = new Array(x.length), k = 2 / (p + 1), e = null, i, s = 0;
    for (i = 0; i < x.length; i++) {
      if (i < p - 1) { s += x[i]; o[i] = null; continue; }
      if (i === p - 1) { s += x[i]; e = s / p; o[i] = e; continue; }
      e = x[i] * k + e * (1 - k); o[i] = e;
    }
    return o;
  };
  M.rma = function (x, p) {   /* Wilder's smoothing */
    var o = new Array(x.length), e = null, s = 0, i;
    for (i = 0; i < x.length; i++) {
      if (i < p - 1) { s += x[i]; o[i] = null; continue; }
      if (i === p - 1) { s += x[i]; e = s / p; o[i] = e; continue; }
      e = (e * (p - 1) + x[i]) / p; o[i] = e;
    }
    return o;
  };
  M.wma = function (x, p) {
    var o = new Array(x.length), i, j, den = p * (p + 1) / 2;
    for (i = 0; i < x.length; i++) {
      if (i < p - 1) { o[i] = null; continue; }
      var s = 0;
      for (j = 0; j < p; j++) s += x[i - p + 1 + j] * (j + 1);
      o[i] = s / den;
    }
    return o;
  };
  M.hma = function (x, p) {
    var h = Math.max(1, Math.round(p / 2)), s = Math.max(1, Math.round(Math.sqrt(p)));
    var a = M.wma(x, h), b = M.wma(x, p), raw = x.map(function (_, i) {
      return a[i] == null || b[i] == null ? null : 2 * a[i] - b[i];
    });
    return M.wmaN(raw, s);
  };
  M.wmaN = function (x, p) {   /* WMA that tolerates nulls at the head */
    var o = new Array(x.length), i, j, den = p * (p + 1) / 2;
    for (i = 0; i < x.length; i++) {
      if (i < p - 1) { o[i] = null; continue; }
      var s = 0, bad = false;
      for (j = 0; j < p; j++) { var v = x[i - p + 1 + j]; if (v == null) { bad = true; break; } s += v * (j + 1); }
      o[i] = bad ? null : s / den;
    }
    return o;
  };
  M.dema = function (x, p) {
    var e1 = M.ema(x, p), e2 = M.emaN(e1, p);
    return x.map(function (_, i) { return e1[i] == null || e2[i] == null ? null : 2 * e1[i] - e2[i]; });
  };
  M.tema = function (x, p) {
    var e1 = M.ema(x, p), e2 = M.emaN(e1, p), e3 = M.emaN(e2, p);
    return x.map(function (_, i) {
      return e1[i] == null || e2[i] == null || e3[i] == null ? null : 3 * e1[i] - 3 * e2[i] + e3[i];
    });
  };
  M.emaN = function (x, p) {   /* EMA over a series with a null head */
    var o = new Array(x.length), k = 2 / (p + 1), e = null, seen = 0, s = 0, i;
    for (i = 0; i < x.length; i++) {
      if (x[i] == null) { o[i] = null; continue; }
      seen++;
      if (seen < p) { s += x[i]; o[i] = null; continue; }
      if (seen === p) { s += x[i]; e = s / p; o[i] = e; continue; }
      e = x[i] * k + e * (1 - k); o[i] = e;
    }
    return o;
  };
  M.vwma = function (bs, p) {
    var o = new Array(bs.length), i, num = 0, den = 0;
    for (i = 0; i < bs.length; i++) {
      num += bs[i].c * bs[i].v; den += bs[i].v;
      if (i >= p) { num -= bs[i - p].c * bs[i - p].v; den -= bs[i - p].v; }
      o[i] = i >= p - 1 && den > 0 ? num / den : null;
    }
    return o;
  };
  M.kama = function (x, p, fast, slow) {
    fast = fast || 2; slow = slow || 30;
    var o = new Array(x.length), fsc = 2 / (fast + 1), ssc = 2 / (slow + 1), e = null, i, j;
    for (i = 0; i < x.length; i++) {
      if (i < p) { o[i] = null; continue; }
      var chg = Math.abs(x[i] - x[i - p]), volat = 0;
      for (j = i - p + 1; j <= i; j++) volat += Math.abs(x[j] - x[j - 1]);
      var er = volat ? chg / volat : 0, sc = Math.pow(er * (fsc - ssc) + ssc, 2);
      e = e == null ? x[i] : e + sc * (x[i] - e);
      o[i] = e;
    }
    return o;
  };
  M.alma = function (x, p, off, sigma) {
    off = off == null ? 0.85 : off; sigma = sigma || 6;
    var o = new Array(x.length), m = off * (p - 1), s = p / sigma, i, j;
    for (i = 0; i < x.length; i++) {
      if (i < p - 1) { o[i] = null; continue; }
      var num = 0, den = 0;
      for (j = 0; j < p; j++) {
        var w = Math.exp(-((j - m) * (j - m)) / (2 * s * s));
        num += x[i - p + 1 + j] * w; den += w;
      }
      o[i] = den ? num / den : null;
    }
    return o;
  };
  M.linreg = function (x, p, off) {
    var o = new Array(x.length), i, j;
    off = off || 0;
    for (i = 0; i < x.length; i++) {
      if (i < p - 1) { o[i] = null; continue; }
      var sx = 0, sy = 0, sxy = 0, sxx = 0;
      for (j = 0; j < p; j++) { var xx = j, yy = x[i - p + 1 + j]; sx += xx; sy += yy; sxy += xx * yy; sxx += xx * xx; }
      var den = p * sxx - sx * sx, m2 = den ? (p * sxy - sx * sy) / den : 0, b = (sy - m2 * sx) / p;
      o[i] = m2 * (p - 1 - off) + b;
    }
    return o;
  };
  M.stdev = function (x, p) {
    var o = new Array(x.length), i, j;
    for (i = 0; i < x.length; i++) {
      if (i < p - 1) { o[i] = null; continue; }
      var m2 = 0, s2 = 0;
      for (j = i - p + 1; j <= i; j++) m2 += x[j];
      m2 /= p;
      for (j = i - p + 1; j <= i; j++) s2 += (x[j] - m2) * (x[j] - m2);
      o[i] = Math.sqrt(s2 / p);
    }
    return o;
  };
  M.tr = function (bs) {
    var o = new Array(bs.length), i;
    for (i = 0; i < bs.length; i++) {
      if (!i) { o[i] = bs[i].h - bs[i].l; continue; }
      var pc = bs[i - 1].c;
      o[i] = Math.max(bs[i].h - bs[i].l, Math.abs(bs[i].h - pc), Math.abs(bs[i].l - pc));
    }
    return o;
  };
  M.atr = function (bs, p) { return M.rma(M.tr(bs), p); };
  M.rsi = function (x, p) {
    var o = new Array(x.length), g = [], l = [], i;
    for (i = 0; i < x.length; i++) {
      var dd = i ? x[i] - x[i - 1] : 0;
      g.push(dd > 0 ? dd : 0); l.push(dd < 0 ? -dd : 0);
    }
    var ag = M.rma(g, p), al = M.rma(l, p);
    for (i = 0; i < x.length; i++) {
      if (ag[i] == null || al[i] == null) { o[i] = null; continue; }
      o[i] = al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i]);
    }
    return o;
  };
  M.stoch = function (bs, p, k, dd) {
    var raw = new Array(bs.length), i, j;
    for (i = 0; i < bs.length; i++) {
      if (i < p - 1) { raw[i] = null; continue; }
      var hi = -Infinity, lo = Infinity;
      for (j = i - p + 1; j <= i; j++) { if (bs[j].h > hi) hi = bs[j].h; if (bs[j].l < lo) lo = bs[j].l; }
      raw[i] = hi === lo ? 50 : (bs[i].c - lo) / (hi - lo) * 100;
    }
    var K = M.smaN(raw, k), D = M.smaN(K, dd);
    return { k: K, d: D };
  };
  M.smaN = function (x, p) {
    var o = new Array(x.length), i, j;
    for (i = 0; i < x.length; i++) {
      if (i < p - 1) { o[i] = null; continue; }
      var s = 0, bad = false;
      for (j = i - p + 1; j <= i; j++) { if (x[j] == null) { bad = true; break; } s += x[j]; }
      o[i] = bad ? null : s / p;
    }
    return o;
  };
  M.stochRsi = function (x, rp, sp, k, dd) {
    var r = M.rsi(x, rp), raw = new Array(x.length), i, j;
    for (i = 0; i < x.length; i++) {
      if (i < sp - 1 || r[i] == null) { raw[i] = null; continue; }
      var hi = -Infinity, lo = Infinity, bad = false;
      for (j = i - sp + 1; j <= i; j++) { if (r[j] == null) { bad = true; break; } if (r[j] > hi) hi = r[j]; if (r[j] < lo) lo = r[j]; }
      raw[i] = bad ? null : (hi === lo ? 50 : (r[i] - lo) / (hi - lo) * 100);
    }
    var K = M.smaN(raw, k), D = M.smaN(K, dd);
    return { k: K, d: D };
  };
  M.macd = function (x, f, s, sg) {
    var ef = M.ema(x, f), es = M.ema(x, s);
    var line = x.map(function (_, i) { return ef[i] == null || es[i] == null ? null : ef[i] - es[i]; });
    var sig = M.emaN(line, sg);
    var hist = line.map(function (v, i) { return v == null || sig[i] == null ? null : v - sig[i]; });
    return { line: line, sig: sig, hist: hist };
  };
  M.dmi = function (bs, p, sp) {
    var n = bs.length, pdm = new Array(n), ndm = new Array(n), i;
    for (i = 0; i < n; i++) {
      if (!i) { pdm[i] = 0; ndm[i] = 0; continue; }
      var up = bs[i].h - bs[i - 1].h, dn = bs[i - 1].l - bs[i].l;
      pdm[i] = up > dn && up > 0 ? up : 0;
      ndm[i] = dn > up && dn > 0 ? dn : 0;
    }
    var atr = M.rma(M.tr(bs), p), sp1 = M.rma(pdm, p), sn1 = M.rma(ndm, p);
    var pdi = new Array(n), ndi = new Array(n), dx = new Array(n);
    for (i = 0; i < n; i++) {
      if (atr[i] == null || !atr[i] || sp1[i] == null) { pdi[i] = ndi[i] = dx[i] = null; continue; }
      pdi[i] = 100 * sp1[i] / atr[i]; ndi[i] = 100 * sn1[i] / atr[i];
      var sum = pdi[i] + ndi[i];
      dx[i] = sum ? 100 * Math.abs(pdi[i] - ndi[i]) / sum : 0;
    }
    return { pdi: pdi, ndi: ndi, adx: M.rmaN(dx, sp || p) };
  };
  M.rmaN = function (x, p) {
    var o = new Array(x.length), e = null, seen = 0, s = 0, i;
    for (i = 0; i < x.length; i++) {
      if (x[i] == null) { o[i] = null; continue; }
      seen++;
      if (seen < p) { s += x[i]; o[i] = null; continue; }
      if (seen === p) { s += x[i]; e = s / p; o[i] = e; continue; }
      e = (e * (p - 1) + x[i]) / p; o[i] = e;
    }
    return o;
  };
  M.cci = function (bs, p) {
    var tp = M.src(bs, "hlc3"), ma = M.sma(tp, p), o = new Array(bs.length), i, j;
    for (i = 0; i < bs.length; i++) {
      if (ma[i] == null) { o[i] = null; continue; }
      var dev = 0;
      for (j = i - p + 1; j <= i; j++) dev += Math.abs(tp[j] - ma[i]);
      dev /= p;
      o[i] = dev ? (tp[i] - ma[i]) / (0.015 * dev) : 0;
    }
    return o;
  };
  M.mfi = function (bs, p) {
    var tp = M.src(bs, "hlc3"), pos = [], neg = [], i;
    for (i = 0; i < bs.length; i++) {
      var f = tp[i] * bs[i].v, up = i && tp[i] > tp[i - 1], dn = i && tp[i] < tp[i - 1];
      pos.push(up ? f : 0); neg.push(dn ? f : 0);
    }
    var sp = M.sma(pos, p), sn = M.sma(neg, p), o = new Array(bs.length);
    for (i = 0; i < bs.length; i++) {
      if (sp[i] == null) { o[i] = null; continue; }
      o[i] = sn[i] === 0 ? 100 : 100 - 100 / (1 + sp[i] / sn[i]);
    }
    return o;
  };
  M.roc = function (x, p) {
    return x.map(function (v, i) { return i < p || !x[i - p] ? null : (v - x[i - p]) / x[i - p] * 100; });
  };
  M.mom = function (x, p) { return x.map(function (v, i) { return i < p ? null : v - x[i - p]; }); };
  M.willr = function (bs, p) {
    var o = new Array(bs.length), i, j;
    for (i = 0; i < bs.length; i++) {
      if (i < p - 1) { o[i] = null; continue; }
      var hi = -Infinity, lo = Infinity;
      for (j = i - p + 1; j <= i; j++) { if (bs[j].h > hi) hi = bs[j].h; if (bs[j].l < lo) lo = bs[j].l; }
      o[i] = hi === lo ? -50 : (hi - bs[i].c) / (hi - lo) * -100;
    }
    return o;
  };
  M.obv = function (bs) {
    var o = new Array(bs.length), s = 0, i;
    for (i = 0; i < bs.length; i++) {
      if (i) s += bs[i].c > bs[i - 1].c ? bs[i].v : bs[i].c < bs[i - 1].c ? -bs[i].v : 0;
      o[i] = s;
    }
    return o;
  };
  M.cmf = function (bs, p) {
    var mfv = bs.map(function (b) {
      var r = b.h - b.l;
      return r ? ((b.c - b.l) - (b.h - b.c)) / r * b.v : 0;
    });
    var a = M.sma(mfv, p), v = M.sma(bs.map(function (b) { return b.v; }), p);
    return a.map(function (x, i) { return x == null || !v[i] ? null : x / v[i]; });
  };
  M.adl = function (bs) {
    var o = new Array(bs.length), s = 0, i;
    for (i = 0; i < bs.length; i++) {
      var r = bs[i].h - bs[i].l;
      s += r ? ((bs[i].c - bs[i].l) - (bs[i].h - bs[i].c)) / r * bs[i].v : 0;
      o[i] = s;
    }
    return o;
  };
  M.chaikinOsc = function (bs, f, s) {
    var a = M.adl(bs), ef = M.emaN(a, f), es = M.emaN(a, s);
    return a.map(function (_, i) { return ef[i] == null || es[i] == null ? null : ef[i] - es[i]; });
  };
  M.uo = function (bs, p1, p2, p3) {
    var n = bs.length, bp = new Array(n), trr = new Array(n), i;
    for (i = 0; i < n; i++) {
      var pc = i ? bs[i - 1].c : bs[i].o, tl = Math.min(bs[i].l, pc), th = Math.max(bs[i].h, pc);
      bp[i] = bs[i].c - tl; trr[i] = th - tl;
    }
    function avg(p) {
      var a = M.sma(bp, p), b = M.sma(trr, p);
      return a.map(function (x, i2) { return x == null || !b[i2] ? null : x / b[i2]; });
    }
    var a1 = avg(p1), a2 = avg(p2), a3 = avg(p3);
    return a1.map(function (_, i2) {
      return a1[i2] == null || a2[i2] == null || a3[i2] == null ? null : 100 * (4 * a1[i2] + 2 * a2[i2] + a3[i2]) / 7;
    });
  };
  M.aroon = function (bs, p) {
    var up = new Array(bs.length), dn = new Array(bs.length), i, j;
    for (i = 0; i < bs.length; i++) {
      if (i < p) { up[i] = dn[i] = null; continue; }
      var hi = -Infinity, lo = Infinity, hj = i, lj = i;
      for (j = i - p; j <= i; j++) {
        if (bs[j].h >= hi) { hi = bs[j].h; hj = j; }
        if (bs[j].l <= lo) { lo = bs[j].l; lj = j; }
      }
      up[i] = 100 * (p - (i - hj)) / p; dn[i] = 100 * (p - (i - lj)) / p;
    }
    return { up: up, dn: dn };
  };
  M.ao = function (bs) {
    var hl = M.src(bs, "hl2"), a = M.sma(hl, 5), b = M.sma(hl, 34);
    return a.map(function (v, i) { return v == null || b[i] == null ? null : v - b[i]; });
  };
  M.trix = function (x, p) {
    var e1 = M.ema(x, p), e2 = M.emaN(e1, p), e3 = M.emaN(e2, p);
    return e3.map(function (v, i) { return v == null || e3[i - 1] == null || !e3[i - 1] ? null : (v - e3[i - 1]) / e3[i - 1] * 100; });
  };
  M.chop = function (bs, p) {
    var trr = M.tr(bs), o = new Array(bs.length), i, j;
    for (i = 0; i < bs.length; i++) {
      if (i < p - 1) { o[i] = null; continue; }
      var s = 0, hi = -Infinity, lo = Infinity;
      for (j = i - p + 1; j <= i; j++) { s += trr[j]; if (bs[j].h > hi) hi = bs[j].h; if (bs[j].l < lo) lo = bs[j].l; }
      var rg = hi - lo;
      o[i] = rg > 0 && s > 0 ? 100 * Math.log(s / rg) / Math.log(p) : null;
    }
    return o;
  };
  M.force = function (bs, p) {
    var f = bs.map(function (b, i) { return i ? (b.c - bs[i - 1].c) * b.v : 0; });
    return M.emaN(f, p);
  };
  M.elder = function (bs, p) {
    var e = M.ema(M.src(bs, "close"), p);
    return {
      bull: bs.map(function (b, i) { return e[i] == null ? null : b.h - e[i]; }),
      bear: bs.map(function (b, i) { return e[i] == null ? null : b.l - e[i]; })
    };
  };
  M.klinger = function (bs, f, s) {
    var n = bs.length, vf = new Array(n), trend = 1, cm = 0, i;
    for (i = 0; i < n; i++) {
      var dm = bs[i].h - bs[i].l, hlc = bs[i].h + bs[i].l + bs[i].c;
      var prev = i ? bs[i - 1].h + bs[i - 1].l + bs[i - 1].c : hlc;
      var t = hlc > prev ? 1 : -1;
      if (i && t === trend) cm += dm; else cm = dm + (i ? bs[i - 1].h - bs[i - 1].l : 0);
      trend = t;
      vf[i] = cm ? bs[i].v * Math.abs(2 * (dm / cm) - 1) * 100 * t : 0;
    }
    var ef = M.emaN(vf, f), es = M.emaN(vf, s);
    return vf.map(function (_, i2) { return ef[i2] == null || es[i2] == null ? null : ef[i2] - es[i2]; });
  };
  M.pvt = function (bs) {
    var o = new Array(bs.length), s = 0, i;
    for (i = 0; i < bs.length; i++) {
      if (i && bs[i - 1].c) s += (bs[i].c - bs[i - 1].c) / bs[i - 1].c * bs[i].v;
      o[i] = s;
    }
    return o;
  };
  M.dpo = function (x, p) {
    var s = M.sma(x, p), sh = Math.floor(p / 2) + 1;
    return x.map(function (v, i) { return i - sh < 0 || s[i - sh] == null ? null : v - s[i - sh]; });
  };
  M.vortex = function (bs, p) {
    var n = bs.length, vp = new Array(n), vm = new Array(n), trr = M.tr(bs), i, j;
    for (i = 0; i < n; i++) {
      vp[i] = i ? Math.abs(bs[i].h - bs[i - 1].l) : 0;
      vm[i] = i ? Math.abs(bs[i].l - bs[i - 1].h) : 0;
    }
    var pl = new Array(n), mi = new Array(n);
    for (i = 0; i < n; i++) {
      if (i < p) { pl[i] = mi[i] = null; continue; }
      var sp = 0, sm = 0, st = 0;
      for (j = i - p + 1; j <= i; j++) { sp += vp[j]; sm += vm[j]; st += trr[j]; }
      pl[i] = st ? sp / st : null; mi[i] = st ? sm / st : null;
    }
    return { plus: pl, minus: mi };
  };
  M.massIndex = function (bs, p) {
    var rg = bs.map(function (b) { return b.h - b.l; });
    var e1 = M.emaN(rg, 9), e2 = M.emaN(e1, 9);
    var r = e1.map(function (v, i) { return v == null || !e2[i] ? null : v / e2[i]; });
    return M.smaN(r, p);
  };
  M.eom = function (bs, p) {
    var e = bs.map(function (b, i) {
      if (!i) return 0;
      var mid = (b.h + b.l) / 2 - (bs[i - 1].h + bs[i - 1].l) / 2, rg = b.h - b.l;
      return b.v && rg ? mid / (b.v / 1e6 / rg) : 0;
    });
    return M.smaN(e, p);
  };
  M.bop = function (bs, p) {
    var b = bs.map(function (x) { var r = x.h - x.l; return r ? (x.c - x.o) / r : 0; });
    return p > 1 ? M.smaN(b, p) : b;
  };
  M.rvi = function (bs, p) {
    var num = bs.map(function (b) { return b.c - b.o; }), den = bs.map(function (b) { return b.h - b.l; });
    var sn = M.smaN(num, p), sd = M.smaN(den, p);
    var r = sn.map(function (v, i) { return v == null || !sd[i] ? null : v / sd[i]; });
    return { rvi: r, sig: M.smaN(r, 4) };
  };
  M.fisher = function (bs, p) {
    var hl = M.src(bs, "hl2"), n = bs.length, o = new Array(n), v1 = 0, f = 0, i, j;
    for (i = 0; i < n; i++) {
      if (i < p - 1) { o[i] = null; continue; }
      var hi = -Infinity, lo = Infinity;
      for (j = i - p + 1; j <= i; j++) { if (hl[j] > hi) hi = hl[j]; if (hl[j] < lo) lo = hl[j]; }
      var rg = hi - lo;
      v1 = rg ? 0.66 * ((hl[i] - lo) / rg - 0.5) + 0.67 * v1 : v1;
      v1 = clamp(v1, -0.999, 0.999);
      f = 0.5 * Math.log((1 + v1) / (1 - v1)) + 0.5 * f;
      o[i] = f;
    }
    return o;
  };
  M.crsi = function (x, rp, up, rocp) {
    var r = M.rsi(x, rp), n = x.length, streak = new Array(n), i;
    for (i = 0; i < n; i++) {
      if (!i) { streak[i] = 0; continue; }
      var s = streak[i - 1] || 0;
      streak[i] = x[i] > x[i - 1] ? (s > 0 ? s + 1 : 1) : x[i] < x[i - 1] ? (s < 0 ? s - 1 : -1) : 0;
    }
    var rs = M.rsi(streak, up), rc = M.roc(x, 1), rank = new Array(n), j;
    for (i = 0; i < n; i++) {
      if (i < rocp) { rank[i] = null; continue; }
      var cnt = 0;
      for (j = i - rocp; j < i; j++) if (rc[j] != null && rc[i] != null && rc[j] < rc[i]) cnt++;
      rank[i] = cnt / rocp * 100;
    }
    return x.map(function (_, i2) {
      return r[i2] == null || rs[i2] == null || rank[i2] == null ? null : (r[i2] + rs[i2] + rank[i2]) / 3;
    });
  };
  M.hv = function (x, p) {
    var lr = x.map(function (v, i) { return i && x[i - 1] > 0 ? Math.log(v / x[i - 1]) : null; });
    var s = new Array(x.length), i, j;
    for (i = 0; i < x.length; i++) {
      if (i < p) { s[i] = null; continue; }
      var m2 = 0, c = 0;
      for (j = i - p + 1; j <= i; j++) if (lr[j] != null) { m2 += lr[j]; c++; }
      if (!c) { s[i] = null; continue; }
      m2 /= c;
      var v2 = 0;
      for (j = i - p + 1; j <= i; j++) if (lr[j] != null) v2 += (lr[j] - m2) * (lr[j] - m2);
      s[i] = Math.sqrt(v2 / c) * Math.sqrt(365) * 100;
    }
    return s;
  };
  M.coppock = function (x, l, s, w) {
    var a = M.roc(x, l), b = M.roc(x, s);
    var sum = a.map(function (v, i) { return v == null || b[i] == null ? null : v + b[i]; });
    return M.wmaN(sum, w);
  };
  M.psar = function (bs, step, mx) {
    var n = bs.length, o = new Array(n);
    if (!n) return o;
    var up = bs[Math.min(1, n - 1)].c >= bs[0].c, af = step, ep = up ? bs[0].h : bs[0].l, sar = up ? bs[0].l : bs[0].h, i;
    for (i = 0; i < n; i++) {
      if (!i) { o[i] = sar; continue; }
      sar = sar + af * (ep - sar);
      if (up) {
        if (bs[i].l < sar) { up = false; sar = ep; ep = bs[i].l; af = step; }
        else if (bs[i].h > ep) { ep = bs[i].h; af = Math.min(mx, af + step); }
      } else {
        if (bs[i].h > sar) { up = true; sar = ep; ep = bs[i].h; af = step; }
        else if (bs[i].l < ep) { ep = bs[i].l; af = Math.min(mx, af + step); }
      }
      o[i] = sar;
    }
    return o;
  };
  M.supertrend = function (bs, p, mult) {
    var atr = M.atr(bs, p), n = bs.length, up = new Array(n), dn = new Array(n), dir = new Array(n), i;
    var fu = null, fl = null, trend = 1;
    for (i = 0; i < n; i++) {
      if (atr[i] == null) { up[i] = dn[i] = null; dir[i] = 1; continue; }
      var mid = (bs[i].h + bs[i].l) / 2, bu = mid + mult * atr[i], bl = mid - mult * atr[i];
      fu = fu == null ? bu : (bu < fu || bs[i - 1].c > fu ? bu : fu);
      fl = fl == null ? bl : (bl > fl || bs[i - 1].c < fl ? bl : fl);
      trend = trend === 1 ? (bs[i].c < fl ? -1 : 1) : (bs[i].c > fu ? 1 : -1);
      dir[i] = trend;
      up[i] = trend === 1 ? fl : null;
      dn[i] = trend === -1 ? fu : null;
    }
    return { up: up, dn: dn, dir: dir };
  };
  M.ichimoku = function (bs, tp, kp, sp, disp) {
    function mid(i, p) {
      if (i < p - 1) return null;
      var hi = -Infinity, lo = Infinity, j;
      for (j = i - p + 1; j <= i; j++) { if (bs[j].h > hi) hi = bs[j].h; if (bs[j].l < lo) lo = bs[j].l; }
      return (hi + lo) / 2;
    }
    var n = bs.length, ten = new Array(n), kij = new Array(n), sa = new Array(n + disp), sb = new Array(n + disp), chik = new Array(n), i;
    for (i = 0; i < n; i++) {
      ten[i] = mid(i, tp); kij[i] = mid(i, kp);
      sa[i + disp] = ten[i] == null || kij[i] == null ? null : (ten[i] + kij[i]) / 2;
      sb[i + disp] = mid(i, sp);
    }
    for (i = 0; i < n; i++) if (i + disp < n) chik[i] = bs[i + disp] ? bs[i + disp].c : null; else chik[i] = null;
    return { tenkan: ten, kijun: kij, spanA: sa, spanB: sb, chikou: chik, disp: disp };
  };
  M.vwapSession = function (bs, anchorMs) {
    var o = new Array(bs.length), cum = 0, cv = 0, lastA = -1, i;
    for (i = 0; i < bs.length; i++) {
      var a = anchorMs ? Math.floor(bs[i].t / anchorMs) : 0;
      if (a !== lastA) { cum = 0; cv = 0; lastA = a; }
      var tp = (bs[i].h + bs[i].l + bs[i].c) / 3, v = bs[i].v || 1;
      cum += tp * v; cv += v;
      o[i] = cv ? cum / cv : null;
    }
    return o;
  };
  M.vwapFrom = function (bs, startIdx) {
    var o = new Array(bs.length), cum = 0, cv = 0, i;
    for (i = 0; i < bs.length; i++) {
      if (i < startIdx) { o[i] = null; continue; }
      var tp = (bs[i].h + bs[i].l + bs[i].c) / 3, v = bs[i].v || 1;
      cum += tp * v; cv += v;
      o[i] = cv ? cum / cv : null;
    }
    return o;
  };
  M.donchian = function (bs, p) {
    var u = new Array(bs.length), l = new Array(bs.length), m2 = new Array(bs.length), i, j;
    for (i = 0; i < bs.length; i++) {
      if (i < p - 1) { u[i] = l[i] = m2[i] = null; continue; }
      var hi = -Infinity, lo = Infinity;
      for (j = i - p + 1; j <= i; j++) { if (bs[j].h > hi) hi = bs[j].h; if (bs[j].l < lo) lo = bs[j].l; }
      u[i] = hi; l[i] = lo; m2[i] = (hi + lo) / 2;
    }
    return { up: u, lo: l, mid: m2 };
  };
  M.zigzag = function (bs, pct) {
    var n = bs.length, i;
    /* rebuild cleanly: alternate extremes */
    var out = [], cd = 0, cur = null;
    for (i = 1; i < n; i++) {
      var h2 = bs[i].h, l2 = bs[i].l;
      if (cur == null) { cur = { i: 0, p: bs[0].c }; out.push(cur); cd = 0; continue; }
      if (cd >= 0 && h2 >= cur.p * (1 + pct / 100)) { if (cd === 1) { out[out.length - 1] = { i: i, p: h2 }; } else { out.push({ i: i, p: h2 }); } cur = out[out.length - 1]; cd = 1; }
      else if (cd <= 0 && l2 <= cur.p * (1 - pct / 100)) { if (cd === -1) { out[out.length - 1] = { i: i, p: l2 }; } else { out.push({ i: i, p: l2 }); } cur = out[out.length - 1]; cd = -1; }
      else if (cd === 1 && h2 > cur.p) { out[out.length - 1] = { i: i, p: h2 }; cur = out[out.length - 1]; }
      else if (cd === -1 && l2 < cur.p) { out[out.length - 1] = { i: i, p: l2 }; cur = out[out.length - 1]; }
    }
    return out;
  };
  M.chandelier = function (bs, p, mult) {
    var atr = M.atr(bs, p), n = bs.length, lo = new Array(n), sh = new Array(n), i, j;
    for (i = 0; i < n; i++) {
      if (atr[i] == null) { lo[i] = sh[i] = null; continue; }
      var hi = -Infinity, mn = Infinity;
      for (j = Math.max(0, i - p + 1); j <= i; j++) { if (bs[j].h > hi) hi = bs[j].h; if (bs[j].l < mn) mn = bs[j].l; }
      lo[i] = hi - mult * atr[i]; sh[i] = mn + mult * atr[i];
    }
    return { long: lo, short: sh };
  };
  M.pivots = function (bs, kind) {
    /* one set per calendar day of the loaded series, projected forward onto the next day */
    var byDay = {}, i;
    for (i = 0; i < bs.length; i++) {
      var k = Math.floor(bs[i].t / 864e5);
      var g = byDay[k] || (byDay[k] = { h: -Infinity, l: Infinity, c: 0, o: bs[i].o, first: i, last: i });
      if (bs[i].h > g.h) g.h = bs[i].h;
      if (bs[i].l < g.l) g.l = bs[i].l;
      g.c = bs[i].c; g.last = i;
    }
    var keys = Object.keys(byDay).map(Number).sort(function (a, b) { return a - b; }), out = [];
    for (i = 1; i < keys.length; i++) {
      var pv = byDay[keys[i - 1]], cur = byDay[keys[i]], H = pv.h, L = pv.l, Cl = pv.c, O = cur.o, R = H - L, lv = {};
      if (kind === "fib") {
        var pp = (H + L + Cl) / 3;
        lv = { P: pp, R1: pp + 0.382 * R, R2: pp + 0.618 * R, R3: pp + R, S1: pp - 0.382 * R, S2: pp - 0.618 * R, S3: pp - R };
      } else if (kind === "woodie") {
        var pw = (H + L + 2 * O) / 4;
        lv = { P: pw, R1: 2 * pw - L, R2: pw + R, R3: H + 2 * (pw - L), S1: 2 * pw - H, S2: pw - R, S3: L - 2 * (H - pw) };
      } else if (kind === "camarilla") {
        lv = {
          P: (H + L + Cl) / 3, R1: Cl + R * 1.1 / 12, R2: Cl + R * 1.1 / 6, R3: Cl + R * 1.1 / 4,
          S1: Cl - R * 1.1 / 12, S2: Cl - R * 1.1 / 6, S3: Cl - R * 1.1 / 4
        };
      } else if (kind === "demark") {
        var x = Cl < O ? H + 2 * L + Cl : Cl > O ? 2 * H + L + Cl : H + L + 2 * Cl;
        lv = { P: x / 4, R1: x / 2 - L, S1: x / 2 - H };
      } else {
        var p0 = (H + L + Cl) / 3;
        lv = { P: p0, R1: 2 * p0 - L, R2: p0 + R, R3: H + 2 * (p0 - L), S1: 2 * p0 - H, S2: p0 - R, S3: L - 2 * (H - p0) };
      }
      out.push({ from: cur.first, to: cur.last, lv: lv });
    }
    return out;
  };
  M.volProfile = function (bs, from, to, bins) {
    if (to <= from) return null;
    var hi = -Infinity, lo = Infinity, i;
    for (i = from; i < to; i++) { if (bs[i].h > hi) hi = bs[i].h; if (bs[i].l < lo) lo = bs[i].l; }
    if (!(hi > lo)) return null;
    var arr = new Array(bins), up = new Array(bins), step = (hi - lo) / bins;
    for (i = 0; i < bins; i++) { arr[i] = 0; up[i] = 0; }
    for (i = from; i < to; i++) {
      var b = bs[i], v = b.v || Math.abs(b.c - b.o) + (b.h - b.l);
      var a = clamp(Math.floor((b.l - lo) / step), 0, bins - 1), z = clamp(Math.floor((b.h - lo) / step), 0, bins - 1);
      var share = v / (z - a + 1);
      for (var j = a; j <= z; j++) { arr[j] += share; if (b.c >= b.o) up[j] += share; }
    }
    var total = 0, poc = 0, pocV = -1;
    for (i = 0; i < bins; i++) { total += arr[i]; if (arr[i] > pocV) { pocV = arr[i]; poc = i; } }
    /* value area: grow from the POC until 70% of the volume is inside */
    var lo2 = poc, hi2 = poc, acc = arr[poc];
    while (acc < total * 0.7 && (lo2 > 0 || hi2 < bins - 1)) {
      var dLo = lo2 > 0 ? arr[lo2 - 1] : -1, dHi = hi2 < bins - 1 ? arr[hi2 + 1] : -1;
      if (dHi >= dLo) { hi2++; acc += arr[hi2]; } else { lo2--; acc += arr[lo2]; }
    }
    return { lo: lo, step: step, bins: arr, up: up, max: pocV, poc: poc, vaLo: lo2, vaHi: hi2, total: total };
  };

  /* =====================================================================
     5 · STUDIES REGISTRY
     Each study declares its inputs, whether it lives on the price pane or a
     pane of its own, and returns rows the renderer can draw. `calc` is the
     only place a formula is chosen; the renderer knows nothing about RSI.
     ===================================================================== */

  var SRC_OPTS = ["close", "open", "high", "low", "hl2", "hlc3", "ohlc4"];
  function num(p, k, dflt) { var v = +p[k]; return isFinite(v) && v > 0 ? v : dflt; }

  function line(data, c, w, dash, name, extra) {
    var r = { kind: "line", data: data, c: c, w: w || 1.4, dash: dash || 0, name: name };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) r[k] = extra[k];
    return r;
  }

  var ST_DEF = {
    /* ---------------------------------------------------- price overlays */
    sma: {
      name: "Moving Average (SMA)", g: "Moving averages", over: true,
      in: [{ k: "len", l: "Length", d: 20 }, { k: "src", l: "Source", d: "close", opts: SRC_OPTS }],
      calc: function (bs, p, s) { return { rows: [line(M.sma(M.src(bs, p.src || "close"), num(p, "len", 20)), s.c, s.w, s.dash, "SMA " + num(p, "len", 20))] }; }
    },
    ema: {
      name: "Moving Average (EMA)", g: "Moving averages", over: true,
      in: [{ k: "len", l: "Length", d: 20 }, { k: "src", l: "Source", d: "close", opts: SRC_OPTS }],
      calc: function (bs, p, s) { return { rows: [line(M.ema(M.src(bs, p.src || "close"), num(p, "len", 20)), s.c, s.w, s.dash, "EMA " + num(p, "len", 20))] }; }
    },
    wma: {
      name: "Weighted MA (WMA)", g: "Moving averages", over: true,
      in: [{ k: "len", l: "Length", d: 20 }, { k: "src", l: "Source", d: "close", opts: SRC_OPTS }],
      calc: function (bs, p, s) { return { rows: [line(M.wma(M.src(bs, p.src || "close"), num(p, "len", 20)), s.c, s.w, s.dash, "WMA " + num(p, "len", 20))] }; }
    },
    smma: {
      name: "Smoothed MA (RMA)", g: "Moving averages", over: true,
      in: [{ k: "len", l: "Length", d: 20 }, { k: "src", l: "Source", d: "close", opts: SRC_OPTS }],
      calc: function (bs, p, s) { return { rows: [line(M.rma(M.src(bs, p.src || "close"), num(p, "len", 20)), s.c, s.w, s.dash, "RMA " + num(p, "len", 20))] }; }
    },
    hma: {
      name: "Hull MA (HMA)", g: "Moving averages", over: true,
      in: [{ k: "len", l: "Length", d: 20 }, { k: "src", l: "Source", d: "close", opts: SRC_OPTS }],
      calc: function (bs, p, s) { return { rows: [line(M.hma(M.src(bs, p.src || "close"), num(p, "len", 20)), s.c, s.w, s.dash, "HMA " + num(p, "len", 20))] }; }
    },
    dema: {
      name: "Double EMA (DEMA)", g: "Moving averages", over: true,
      in: [{ k: "len", l: "Length", d: 20 }, { k: "src", l: "Source", d: "close", opts: SRC_OPTS }],
      calc: function (bs, p, s) { return { rows: [line(M.dema(M.src(bs, p.src || "close"), num(p, "len", 20)), s.c, s.w, s.dash, "DEMA " + num(p, "len", 20))] }; }
    },
    tema: {
      name: "Triple EMA (TEMA)", g: "Moving averages", over: true,
      in: [{ k: "len", l: "Length", d: 20 }, { k: "src", l: "Source", d: "close", opts: SRC_OPTS }],
      calc: function (bs, p, s) { return { rows: [line(M.tema(M.src(bs, p.src || "close"), num(p, "len", 20)), s.c, s.w, s.dash, "TEMA " + num(p, "len", 20))] }; }
    },
    vwma: {
      name: "Volume-weighted MA", g: "Moving averages", over: true,
      in: [{ k: "len", l: "Length", d: 20 }],
      calc: function (bs, p, s) { return { rows: [line(M.vwma(bs, num(p, "len", 20)), s.c, s.w, s.dash, "VWMA " + num(p, "len", 20))] }; }
    },
    kama: {
      name: "Kaufman Adaptive MA", g: "Moving averages", over: true,
      in: [{ k: "len", l: "Length", d: 10 }, { k: "fast", l: "Fast", d: 2 }, { k: "slow", l: "Slow", d: 30 }],
      calc: function (bs, p, s) { return { rows: [line(M.kama(M.src(bs, "close"), num(p, "len", 10), num(p, "fast", 2), num(p, "slow", 30)), s.c, s.w, s.dash, "KAMA " + num(p, "len", 10))] }; }
    },
    alma: {
      name: "Arnaud Legoux MA", g: "Moving averages", over: true,
      in: [{ k: "len", l: "Length", d: 21 }, { k: "off", l: "Offset", d: 0.85, step: 0.05 }, { k: "sig", l: "Sigma", d: 6 }],
      calc: function (bs, p, s) { return { rows: [line(M.alma(M.src(bs, "close"), num(p, "len", 21), +p.off || 0.85, num(p, "sig", 6)), s.c, s.w, s.dash, "ALMA " + num(p, "len", 21))] }; }
    },
    lsma: {
      name: "Least Squares MA", g: "Moving averages", over: true,
      in: [{ k: "len", l: "Length", d: 25 }, { k: "off", l: "Offset", d: 0 }],
      calc: function (bs, p, s) { return { rows: [line(M.linreg(M.src(bs, "close"), num(p, "len", 25), +p.off || 0), s.c, s.w, s.dash, "LSMA " + num(p, "len", 25))] }; }
    },
    ribbon: {
      name: "MA Ribbon (8)", g: "Moving averages", over: true,
      in: [{ k: "base", l: "Base length", d: 10 }, { k: "gap", l: "Step", d: 10 }],
      calc: function (bs, p) {
        var b = num(p, "base", 10), g = num(p, "gap", 10), x = M.src(bs, "close"), rows = [], i;
        for (i = 0; i < 8; i++) rows.push(line(M.ema(x, b + i * g), SERIES_COLORS[i], 1, 0, "EMA " + (b + i * g)));
        return { rows: rows };
      }
    },
    bb: {
      name: "Bollinger Bands", g: "Bands & channels", over: true,
      in: [{ k: "len", l: "Length", d: 20 }, { k: "mult", l: "StdDev", d: 2, step: 0.1 }, { k: "src", l: "Source", d: "close", opts: SRC_OPTS }],
      calc: function (bs, p, s) {
        var x = M.src(bs, p.src || "close"), L = num(p, "len", 20), m2 = +p.mult || 2;
        var mid = M.sma(x, L), sd = M.stdev(x, L);
        var up = mid.map(function (v, i) { return v == null ? null : v + m2 * sd[i]; });
        var lo = mid.map(function (v, i) { return v == null ? null : v - m2 * sd[i]; });
        return { rows: [{ kind: "band", a: up, b: lo, c: s.c || "#5B8CFF", fill: 0.08, name: "BB" }, line(up, s.c || "#5B8CFF", 1.1, 0, "BB upper"), line(mid, s.c || "#5B8CFF", 1.1, 4, "BB basis"), line(lo, s.c || "#5B8CFF", 1.1, 0, "BB lower")] };
      }
    },
    keltner: {
      name: "Keltner Channels", g: "Bands & channels", over: true,
      in: [{ k: "len", l: "Length", d: 20 }, { k: "mult", l: "ATR mult", d: 2, step: 0.1 }, { k: "atr", l: "ATR length", d: 10 }],
      calc: function (bs, p, s) {
        var mid = M.ema(M.src(bs, "close"), num(p, "len", 20)), a = M.atr(bs, num(p, "atr", 10)), m2 = +p.mult || 2;
        var up = mid.map(function (v, i) { return v == null || a[i] == null ? null : v + m2 * a[i]; });
        var lo = mid.map(function (v, i) { return v == null || a[i] == null ? null : v - m2 * a[i]; });
        return { rows: [{ kind: "band", a: up, b: lo, c: s.c || "#B36BFF", fill: 0.07, name: "KC" }, line(up, s.c || "#B36BFF", 1.1, 0, "KC upper"), line(mid, s.c || "#B36BFF", 1, 4, "KC basis"), line(lo, s.c || "#B36BFF", 1.1, 0, "KC lower")] };
      }
    },
    donchian: {
      name: "Donchian Channels", g: "Bands & channels", over: true,
      in: [{ k: "len", l: "Length", d: 20 }],
      calc: function (bs, p, s) {
        var r = M.donchian(bs, num(p, "len", 20));
        return { rows: [{ kind: "band", a: r.up, b: r.lo, c: s.c || "#22D39A", fill: 0.06, name: "DC" }, line(r.up, s.c || "#22D39A", 1.1, 0, "DC upper"), line(r.mid, s.c || "#22D39A", 1, 4, "DC basis"), line(r.lo, s.c || "#22D39A", 1.1, 0, "DC lower")] };
      }
    },
    env: {
      name: "Envelope", g: "Bands & channels", over: true,
      in: [{ k: "len", l: "Length", d: 20 }, { k: "pct", l: "Percent", d: 2, step: 0.1 }],
      calc: function (bs, p, s) {
        var mid = M.sma(M.src(bs, "close"), num(p, "len", 20)), k = (+p.pct || 2) / 100;
        var up = mid.map(function (v) { return v == null ? null : v * (1 + k); }), lo = mid.map(function (v) { return v == null ? null : v * (1 - k); });
        return { rows: [line(up, s.c || "#F5A623", 1.1, 0, "Env upper"), line(mid, s.c || "#F5A623", 1, 4, "Env basis"), line(lo, s.c || "#F5A623", 1.1, 0, "Env lower")] };
      }
    },
    regchan: {
      name: "Linear Regression Channel", g: "Bands & channels", over: true,
      in: [{ k: "len", l: "Length", d: 100 }, { k: "mult", l: "Deviations", d: 2, step: 0.1 }],
      calc: function (bs, p, s) {
        var L = Math.min(num(p, "len", 100), bs.length), x = M.src(bs, "close"), n = bs.length, i;
        if (L < 3) return { rows: [] };
        var sx = 0, sy = 0, sxy = 0, sxx = 0;
        for (i = 0; i < L; i++) { var xx = i, yy = x[n - L + i]; sx += xx; sy += yy; sxy += xx * yy; sxx += xx * xx; }
        var den = L * sxx - sx * sx, m2 = den ? (L * sxy - sx * sy) / den : 0, b = (sy - m2 * sx) / L;
        var mid = new Array(n), dev = 0;
        for (i = 0; i < n; i++) mid[i] = i < n - L ? null : m2 * (i - (n - L)) + b;
        for (i = n - L; i < n; i++) dev += (x[i] - mid[i]) * (x[i] - mid[i]);
        dev = Math.sqrt(dev / L) * (+p.mult || 2);
        var up = mid.map(function (v) { return v == null ? null : v + dev; }), lo = mid.map(function (v) { return v == null ? null : v - dev; });
        return { rows: [{ kind: "band", a: up, b: lo, c: s.c || "#00E5FF", fill: 0.06, name: "LRC" }, line(up, s.c || "#00E5FF", 1.1, 0, "upper"), line(mid, s.c || "#00E5FF", 1.4, 0, "regression"), line(lo, s.c || "#00E5FF", 1.1, 0, "lower")] };
      }
    },
    psar: {
      name: "Parabolic SAR", g: "Trend", over: true,
      in: [{ k: "step", l: "Step", d: 0.02, step: 0.01 }, { k: "max", l: "Max", d: 0.2, step: 0.02 }],
      calc: function (bs, p, s) { return { rows: [{ kind: "dots", data: M.psar(bs, +p.step || 0.02, +p.max || 0.2), c: s.c || "#FFD166", name: "PSAR" }] }; }
    },
    supertrend: {
      name: "Supertrend", g: "Trend", over: true,
      in: [{ k: "len", l: "ATR length", d: 10 }, { k: "mult", l: "Factor", d: 3, step: 0.1 }],
      calc: function (bs, p) {
        var r = M.supertrend(bs, num(p, "len", 10), +p.mult || 3);
        return { rows: [line(r.up, "#22D39A", 1.8, 0, "Supertrend"), line(r.dn, "#FF5A78", 1.8, 0, "Supertrend")] };
      }
    },
    ichimoku: {
      name: "Ichimoku Cloud", g: "Trend", over: true,
      in: [{ k: "t", l: "Conversion", d: 9 }, { k: "k", l: "Base", d: 26 }, { k: "s", l: "Span B", d: 52 }, { k: "d", l: "Displacement", d: 26 }],
      calc: function (bs, p) {
        var r = M.ichimoku(bs, num(p, "t", 9), num(p, "k", 26), num(p, "s", 52), num(p, "d", 26));
        return {
          rows: [
            { kind: "cloud", a: r.spanA, b: r.spanB, c: "#22D39A", c2: "#FF5A78", fill: 0.12, name: "Kumo" },
            line(r.tenkan, "#5B8CFF", 1.3, 0, "Tenkan"), line(r.kijun, "#FF5A78", 1.3, 0, "Kijun"),
            line(r.chikou, "#22D39A", 1, 4, "Chikou"),
            line(r.spanA, "#22D39A", 1, 0, "Span A"), line(r.spanB, "#FF5A78", 1, 0, "Span B")
          ], extend: num(p, "d", 26)
        };
      }
    },
    vwap: {
      name: "VWAP (session)", g: "Volume", over: true,
      in: [{ k: "anchor", l: "Anchor", d: "1d", opts: ["1d", "1w", "1M", "none"] }],
      calc: function (bs, p, s) {
        var a = p.anchor === "1w" ? 6048e5 : p.anchor === "1M" ? 2592e6 : p.anchor === "none" ? 0 : 864e5;
        return { rows: [line(M.vwapSession(bs, a), s.c || "#00E5FF", 1.6, 0, "VWAP")] };
      }
    },
    avwap: {
      name: "Anchored VWAP (visible)", g: "Volume", over: true, in: [],
      calc: function (bs, p, s, g) { return { rows: [line(M.vwapFrom(bs, g ? Math.max(0, Math.floor(g.i0)) : 0), s.c || "#FFD166", 1.6, 0, "AVWAP")] }; }
    },
    vp: {
      name: "Volume Profile (visible range)", g: "Volume", over: true,
      in: [{ k: "bins", l: "Rows", d: 40 }, { k: "va", l: "Value area %", d: 70 }],
      calc: function (bs, p, s, g) {
        if (!g) return { rows: [] };
        var prof = M.volProfile(bs, Math.max(0, Math.floor(g.i0)), Math.min(bs.length, Math.ceil(g.i0 + g.n)), clamp(num(p, "bins", 40), 8, 120));
        return { rows: prof ? [{ kind: "profile", prof: prof, c: s.c || "#5B8CFF", name: "VP" }] : [] };
      }
    },
    zigzag: {
      name: "ZigZag", g: "Trend", over: true,
      in: [{ k: "pct", l: "Deviation %", d: 5, step: 0.5 }],
      calc: function (bs, p, s) { return { rows: [{ kind: "zig", pts: M.zigzag(bs, +p.pct || 5), c: s.c || "#B36BFF", name: "ZigZag" }] }; }
    },
    pivots: {
      name: "Pivot Points", g: "Trend", over: true,
      in: [{ k: "kind", l: "Type", d: "traditional", opts: ["traditional", "fib", "woodie", "camarilla", "demark"] }],
      calc: function (bs, p) { return { rows: [{ kind: "pivots", sets: M.pivots(bs, p.kind || "traditional"), name: "Pivots" }] }; }
    },
    chandelier: {
      name: "Chandelier Exit", g: "Trend", over: true,
      in: [{ k: "len", l: "Length", d: 22 }, { k: "mult", l: "ATR mult", d: 3, step: 0.1 }],
      calc: function (bs, p) {
        var r = M.chandelier(bs, num(p, "len", 22), +p.mult || 3);
        return { rows: [line(r.long, "#22D39A", 1.3, 4, "Long stop"), line(r.short, "#FF5A78", 1.3, 4, "Short stop")] };
      }
    },
    hilo: {
      name: "High / Low of range", g: "Trend", over: true, in: [],
      calc: function (bs, p, s, g) {
        if (!g) return { rows: [] };
        var a = Math.max(0, Math.floor(g.i0)), z = Math.min(bs.length, Math.ceil(g.i0 + g.n)), hi = -Infinity, lo = Infinity, i;
        for (i = a; i < z; i++) { if (bs[i].h > hi) hi = bs[i].h; if (bs[i].l < lo) lo = bs[i].l; }
        return { rows: [], levels: [{ v: hi, c: "#FF5A78", dash: 4, label: "range high" }, { v: lo, c: "#22D39A", dash: 4, label: "range low" }] };
      }
    },

    /* ---------------------------------------------------------- own pane */
    vol: {
      name: "Volume", g: "Volume", over: false, h: 0.16,
      in: [{ k: "ma", l: "MA length", d: 20 }],
      calc: function (bs, p) {
        var v = bs.map(function (b) { return b.v; });
        var rows = [{ kind: "vbars", data: v, bs: bs, name: "Volume" }];
        if (num(p, "ma", 20) > 1) rows.push(line(M.sma(v, num(p, "ma", 20)), "#F5A623", 1.2, 0, "Vol MA"));
        return { rows: rows, zero: true, fmt: "vol" };
      }
    },
    rsi: {
      name: "Relative Strength Index", g: "Oscillators", over: false, h: 0.18,
      in: [{ k: "len", l: "Length", d: 14 }, { k: "ma", l: "MA length", d: 0 }, { k: "src", l: "Source", d: "close", opts: SRC_OPTS }],
      calc: function (bs, p, s) {
        var r = M.rsi(M.src(bs, p.src || "close"), num(p, "len", 14)), rows = [line(r, s.c || "#B36BFF", 1.5, 0, "RSI " + num(p, "len", 14))];
        if (+p.ma > 1) rows.push(line(M.smaN(r, +p.ma), "#F5A623", 1.1, 0, "RSI MA"));
        return { rows: rows, range: [0, 100], levels: [{ v: 70, dash: 4 }, { v: 50, dash: 2 }, { v: 30, dash: 4 }], zones: [[70, 100], [0, 30]] };
      }
    },
    macd: {
      name: "MACD", g: "Oscillators", over: false, h: 0.18,
      in: [{ k: "f", l: "Fast", d: 12 }, { k: "s", l: "Slow", d: 26 }, { k: "sg", l: "Signal", d: 9 }],
      calc: function (bs, p) {
        var r = M.macd(M.src(bs, "close"), num(p, "f", 12), num(p, "s", 26), num(p, "sg", 9));
        return {
          rows: [{ kind: "hist", data: r.hist, up: "#22D39A", dn: "#FF5A78", name: "Histogram" },
            line(r.line, "#5B8CFF", 1.4, 0, "MACD"), line(r.sig, "#F5A623", 1.2, 0, "Signal")], zero: true
        };
      }
    },
    stoch: {
      name: "Stochastic", g: "Oscillators", over: false, h: 0.16,
      in: [{ k: "len", l: "%K length", d: 14 }, { k: "k", l: "%K smooth", d: 1 }, { k: "d", l: "%D smooth", d: 3 }],
      calc: function (bs, p) {
        var r = M.stoch(bs, num(p, "len", 14), num(p, "k", 1), num(p, "d", 3));
        return { rows: [line(r.k, "#5B8CFF", 1.4, 0, "%K"), line(r.d, "#F5A623", 1.2, 0, "%D")], range: [0, 100], levels: [{ v: 80, dash: 4 }, { v: 20, dash: 4 }], zones: [[80, 100], [0, 20]] };
      }
    },
    stochrsi: {
      name: "Stochastic RSI", g: "Oscillators", over: false, h: 0.16,
      in: [{ k: "rsi", l: "RSI length", d: 14 }, { k: "stoch", l: "Stoch length", d: 14 }, { k: "k", l: "%K", d: 3 }, { k: "d", l: "%D", d: 3 }],
      calc: function (bs, p) {
        var r = M.stochRsi(M.src(bs, "close"), num(p, "rsi", 14), num(p, "stoch", 14), num(p, "k", 3), num(p, "d", 3));
        return { rows: [line(r.k, "#5B8CFF", 1.4, 0, "%K"), line(r.d, "#F5A623", 1.2, 0, "%D")], range: [0, 100], levels: [{ v: 80, dash: 4 }, { v: 20, dash: 4 }] };
      }
    },
    atr: {
      name: "Average True Range", g: "Volatility", over: false, h: 0.14,
      in: [{ k: "len", l: "Length", d: 14 }],
      calc: function (bs, p, s) { return { rows: [line(M.atr(bs, num(p, "len", 14)), s.c || "#FFD166", 1.4, 0, "ATR " + num(p, "len", 14))] }; }
    },
    adx: {
      name: "ADX / DMI", g: "Trend", over: false, h: 0.16,
      in: [{ k: "len", l: "DI length", d: 14 }, { k: "sm", l: "ADX smoothing", d: 14 }],
      calc: function (bs, p) {
        var r = M.dmi(bs, num(p, "len", 14), num(p, "sm", 14));
        return { rows: [line(r.adx, "#FFD166", 1.6, 0, "ADX"), line(r.pdi, "#22D39A", 1.2, 0, "+DI"), line(r.ndi, "#FF5A78", 1.2, 0, "−DI")], range: [0, 100], levels: [{ v: 25, dash: 4 }] };
      }
    },
    cci: {
      name: "Commodity Channel Index", g: "Oscillators", over: false, h: 0.15,
      in: [{ k: "len", l: "Length", d: 20 }],
      calc: function (bs, p, s) { return { rows: [line(M.cci(bs, num(p, "len", 20)), s.c || "#5B8CFF", 1.4, 0, "CCI")], levels: [{ v: 100, dash: 4 }, { v: 0, dash: 2 }, { v: -100, dash: 4 }] }; }
    },
    mfi: {
      name: "Money Flow Index", g: "Volume", over: false, h: 0.15,
      in: [{ k: "len", l: "Length", d: 14 }],
      calc: function (bs, p, s) { return { rows: [line(M.mfi(bs, num(p, "len", 14)), s.c || "#3DD6D0", 1.4, 0, "MFI")], range: [0, 100], levels: [{ v: 80, dash: 4 }, { v: 20, dash: 4 }] }; }
    },
    roc: {
      name: "Rate of Change", g: "Momentum", over: false, h: 0.14,
      in: [{ k: "len", l: "Length", d: 9 }],
      calc: function (bs, p, s) { return { rows: [line(M.roc(M.src(bs, "close"), num(p, "len", 9)), s.c || "#B36BFF", 1.4, 0, "ROC")], zero: true }; }
    },
    mom: {
      name: "Momentum", g: "Momentum", over: false, h: 0.14,
      in: [{ k: "len", l: "Length", d: 10 }],
      calc: function (bs, p, s) { return { rows: [line(M.mom(M.src(bs, "close"), num(p, "len", 10)), s.c || "#6FA8FF", 1.4, 0, "MOM")], zero: true }; }
    },
    willr: {
      name: "Williams %R", g: "Oscillators", over: false, h: 0.14,
      in: [{ k: "len", l: "Length", d: 14 }],
      calc: function (bs, p, s) { return { rows: [line(M.willr(bs, num(p, "len", 14)), s.c || "#FF8A5B", 1.4, 0, "%R")], range: [-100, 0], levels: [{ v: -20, dash: 4 }, { v: -80, dash: 4 }] }; }
    },
    obv: {
      name: "On-Balance Volume", g: "Volume", over: false, h: 0.14, in: [],
      calc: function (bs, p, s) { return { rows: [line(M.obv(bs), s.c || "#22D39A", 1.4, 0, "OBV")], fmt: "vol" }; }
    },
    cmf: {
      name: "Chaikin Money Flow", g: "Volume", over: false, h: 0.14,
      in: [{ k: "len", l: "Length", d: 20 }],
      calc: function (bs, p, s) { return { rows: [line(M.cmf(bs, num(p, "len", 20)), s.c || "#3DD6D0", 1.4, 0, "CMF")], zero: true }; }
    },
    chosc: {
      name: "Chaikin Oscillator", g: "Volume", over: false, h: 0.14,
      in: [{ k: "f", l: "Fast", d: 3 }, { k: "s", l: "Slow", d: 10 }],
      calc: function (bs, p, s) { return { rows: [line(M.chaikinOsc(bs, num(p, "f", 3), num(p, "s", 10)), s.c || "#E26BFF", 1.4, 0, "Chaikin")], zero: true, fmt: "vol" }; }
    },
    uo: {
      name: "Ultimate Oscillator", g: "Oscillators", over: false, h: 0.14,
      in: [{ k: "p1", l: "Fast", d: 7 }, { k: "p2", l: "Middle", d: 14 }, { k: "p3", l: "Slow", d: 28 }],
      calc: function (bs, p, s) { return { rows: [line(M.uo(bs, num(p, "p1", 7), num(p, "p2", 14), num(p, "p3", 28)), s.c || "#FFD166", 1.4, 0, "UO")], range: [0, 100], levels: [{ v: 70, dash: 4 }, { v: 30, dash: 4 }] }; }
    },
    aroon: {
      name: "Aroon", g: "Trend", over: false, h: 0.14,
      in: [{ k: "len", l: "Length", d: 14 }],
      calc: function (bs, p) {
        var r = M.aroon(bs, num(p, "len", 14));
        return { rows: [line(r.up, "#22D39A", 1.3, 0, "Aroon up"), line(r.dn, "#FF5A78", 1.3, 0, "Aroon down")], range: [0, 100], levels: [{ v: 50, dash: 2 }] };
      }
    },
    ao: {
      name: "Awesome Oscillator", g: "Momentum", over: false, h: 0.14, in: [],
      calc: function (bs) { return { rows: [{ kind: "hist", data: M.ao(bs), up: "#22D39A", dn: "#FF5A78", name: "AO" }], zero: true }; }
    },
    trix: {
      name: "TRIX", g: "Momentum", over: false, h: 0.14,
      in: [{ k: "len", l: "Length", d: 18 }],
      calc: function (bs, p, s) { return { rows: [line(M.trix(M.src(bs, "close"), num(p, "len", 18)), s.c || "#6FA8FF", 1.4, 0, "TRIX")], zero: true }; }
    },
    sdev: {
      name: "Standard Deviation", g: "Volatility", over: false, h: 0.13,
      in: [{ k: "len", l: "Length", d: 20 }],
      calc: function (bs, p, s) { return { rows: [line(M.stdev(M.src(bs, "close"), num(p, "len", 20)), s.c || "#B36BFF", 1.4, 0, "StdDev")] }; }
    },
    chop: {
      name: "Choppiness Index", g: "Volatility", over: false, h: 0.13,
      in: [{ k: "len", l: "Length", d: 14 }],
      calc: function (bs, p, s) { return { rows: [line(M.chop(bs, num(p, "len", 14)), s.c || "#FFD166", 1.4, 0, "CHOP")], range: [0, 100], levels: [{ v: 61.8, dash: 4 }, { v: 38.2, dash: 4 }] }; }
    },
    force: {
      name: "Force Index", g: "Volume", over: false, h: 0.13,
      in: [{ k: "len", l: "Length", d: 13 }],
      calc: function (bs, p, s) { return { rows: [line(M.force(bs, num(p, "len", 13)), s.c || "#FF8A5B", 1.4, 0, "Force")], zero: true, fmt: "vol" }; }
    },
    elder: {
      name: "Elder-Ray Power", g: "Momentum", over: false, h: 0.14,
      in: [{ k: "len", l: "EMA length", d: 13 }],
      calc: function (bs, p) {
        var r = M.elder(bs, num(p, "len", 13));
        return { rows: [{ kind: "hist", data: r.bull, up: "#22D39A", dn: "#22D39A", name: "Bull" }, { kind: "hist", data: r.bear, up: "#FF5A78", dn: "#FF5A78", name: "Bear" }], zero: true };
      }
    },
    klinger: {
      name: "Klinger Oscillator", g: "Volume", over: false, h: 0.14,
      in: [{ k: "f", l: "Fast", d: 34 }, { k: "s", l: "Slow", d: 55 }],
      calc: function (bs, p, s) { return { rows: [line(M.klinger(bs, num(p, "f", 34), num(p, "s", 55)), s.c || "#E26BFF", 1.4, 0, "KVO")], zero: true, fmt: "vol" }; }
    },
    pvt: {
      name: "Price Volume Trend", g: "Volume", over: false, h: 0.13, in: [],
      calc: function (bs, p, s) { return { rows: [line(M.pvt(bs), s.c || "#3DD6D0", 1.4, 0, "PVT")], fmt: "vol" }; }
    },
    dpo: {
      name: "Detrended Price Oscillator", g: "Momentum", over: false, h: 0.13,
      in: [{ k: "len", l: "Length", d: 21 }],
      calc: function (bs, p, s) { return { rows: [line(M.dpo(M.src(bs, "close"), num(p, "len", 21)), s.c || "#5B8CFF", 1.4, 0, "DPO")], zero: true }; }
    },
    vortex: {
      name: "Vortex Indicator", g: "Trend", over: false, h: 0.14,
      in: [{ k: "len", l: "Length", d: 14 }],
      calc: function (bs, p) {
        var r = M.vortex(bs, num(p, "len", 14));
        return { rows: [line(r.plus, "#22D39A", 1.3, 0, "VI+"), line(r.minus, "#FF5A78", 1.3, 0, "VI−")] };
      }
    },
    mass: {
      name: "Mass Index", g: "Volatility", over: false, h: 0.13,
      in: [{ k: "len", l: "Length", d: 25 }],
      calc: function (bs, p, s) { return { rows: [line(M.massIndex(bs, num(p, "len", 25)), s.c || "#FFD166", 1.4, 0, "Mass")], levels: [{ v: 27, dash: 4 }] }; }
    },
    eom: {
      name: "Ease of Movement", g: "Volume", over: false, h: 0.13,
      in: [{ k: "len", l: "Length", d: 14 }],
      calc: function (bs, p, s) { return { rows: [line(M.eom(bs, num(p, "len", 14)), s.c || "#7BE38A", 1.4, 0, "EOM")], zero: true }; }
    },
    bop: {
      name: "Balance of Power", g: "Momentum", over: false, h: 0.13,
      in: [{ k: "len", l: "Smoothing", d: 14 }],
      calc: function (bs, p) { return { rows: [{ kind: "hist", data: M.bop(bs, num(p, "len", 14)), up: "#22D39A", dn: "#FF5A78", name: "BOP" }], zero: true }; }
    },
    rvi: {
      name: "Relative Vigor Index", g: "Oscillators", over: false, h: 0.14,
      in: [{ k: "len", l: "Length", d: 10 }],
      calc: function (bs, p) {
        var r = M.rvi(bs, num(p, "len", 10));
        return { rows: [line(r.rvi, "#5B8CFF", 1.4, 0, "RVI"), line(r.sig, "#F5A623", 1.1, 0, "Signal")], zero: true };
      }
    },
    fisher: {
      name: "Fisher Transform", g: "Oscillators", over: false, h: 0.14,
      in: [{ k: "len", l: "Length", d: 9 }],
      calc: function (bs, p, s) { return { rows: [line(M.fisher(bs, num(p, "len", 9)), s.c || "#00E5FF", 1.4, 0, "Fisher")], zero: true }; }
    },
    crsi: {
      name: "Connors RSI", g: "Oscillators", over: false, h: 0.14,
      in: [{ k: "rsi", l: "RSI", d: 3 }, { k: "up", l: "Streak RSI", d: 2 }, { k: "roc", l: "Rank length", d: 100 }],
      calc: function (bs, p, s) { return { rows: [line(M.crsi(M.src(bs, "close"), num(p, "rsi", 3), num(p, "up", 2), num(p, "roc", 100)), s.c || "#B36BFF", 1.4, 0, "CRSI")], range: [0, 100], levels: [{ v: 90, dash: 4 }, { v: 10, dash: 4 }] }; }
    },
    hv: {
      name: "Historical Volatility", g: "Volatility", over: false, h: 0.13,
      in: [{ k: "len", l: "Length", d: 20 }],
      calc: function (bs, p, s) { return { rows: [line(M.hv(M.src(bs, "close"), num(p, "len", 20)), s.c || "#FF8A5B", 1.4, 0, "HV %")] }; }
    },
    coppock: {
      name: "Coppock Curve", g: "Momentum", over: false, h: 0.13,
      in: [{ k: "l", l: "Long ROC", d: 14 }, { k: "s", l: "Short ROC", d: 11 }, { k: "w", l: "WMA", d: 10 }],
      calc: function (bs, p, s) { return { rows: [line(M.coppock(M.src(bs, "close"), num(p, "l", 14), num(p, "s", 11), num(p, "w", 10)), s.c || "#7BE38A", 1.4, 0, "Coppock")], zero: true }; }
    },
    bbw: {
      name: "Bollinger Bandwidth", g: "Volatility", over: false, h: 0.13,
      in: [{ k: "len", l: "Length", d: 20 }, { k: "mult", l: "StdDev", d: 2, step: 0.1 }],
      calc: function (bs, p, s) {
        var x = M.src(bs, "close"), L = num(p, "len", 20), mid = M.sma(x, L), sd = M.stdev(x, L), m2 = +p.mult || 2;
        return { rows: [line(mid.map(function (v, i) { return v == null || !v ? null : 2 * m2 * sd[i] / v * 100; }), s.c || "#5B8CFF", 1.4, 0, "BBW %")] };
      }
    },
    pctb: {
      name: "Bollinger %B", g: "Volatility", over: false, h: 0.13,
      in: [{ k: "len", l: "Length", d: 20 }, { k: "mult", l: "StdDev", d: 2, step: 0.1 }],
      calc: function (bs, p, s) {
        var x = M.src(bs, "close"), L = num(p, "len", 20), mid = M.sma(x, L), sd = M.stdev(x, L), m2 = +p.mult || 2;
        return { rows: [line(mid.map(function (v, i) { return v == null || !sd[i] ? null : (x[i] - (v - m2 * sd[i])) / (4 * m2 * sd[i] / 2) * 100; }), s.c || "#F5A623", 1.4, 0, "%B")], range: [-20, 120], levels: [{ v: 100, dash: 4 }, { v: 0, dash: 4 }] };
      }
    },
    ret: {
      name: "Bar change %", g: "Momentum", over: false, h: 0.13, in: [],
      calc: function (bs) {
        return { rows: [{ kind: "hist", data: bs.map(function (b) { return b.o ? (b.c - b.o) / b.o * 100 : null; }), up: "#22D39A", dn: "#FF5A78", name: "Change %" }], zero: true };
      }
    }
  };

  var ST_KEYS = Object.keys(ST_DEF);
  function stDef(k) { return ST_DEF[k] || null; }
  function stDefaults(k) {
    var def = stDef(k), p = {}, i;
    if (!def) return p;
    for (i = 0; i < def.in.length; i++) p[def.in[i].k] = def.in[i].d;
    return p;
  }
  function uid(pfx) { return pfx + "-" + Math.floor(now() % 1e7).toString(36) + "-" + (uid.n = (uid.n || 0) + 1); }

  /* the computed-study cache: keyed by symbol, interval, bar count, params and visible range */
  var CACHE = {};
  function studyRows(st, bs, g) {
    var def = stDef(st.k);
    if (!def) return null;
    var needsRange = st.k === "vp" || st.k === "avwap" || st.k === "hilo" || st.k === "regchan";
    var key = st.id + "|" + mkey() + "|" + bs.length + "|" + JSON.stringify(st.p) + "|" + JSON.stringify(st.s || {}) +
      (needsRange && g ? "|" + Math.round(g.i0) + "," + Math.round(g.n) : "") + "|" + (bs.length ? last(bs).c : 0);
    if (CACHE[key]) return CACHE[key];
    var out;
    try { out = def.calc(bs, st.p || {}, st.s || {}, g) || { rows: [] }; }
    catch (e) { out = { rows: [], err: String((e && e.message) || e) }; fault("study:" + st.k, e); }
    out.def = def;
    var ks = Object.keys(CACHE);
    if (ks.length > 60) for (var i = 0; i < 30; i++) delete CACHE[ks[i]];
    CACHE[key] = out;
    return out;
  }

  /* =====================================================================
     6 · SERIES TRANSFORMS — the chart types that are not the bars themselves
     ===================================================================== */

  var TYPES = [
    { id: "candles", l: "Candles" }, { id: "hollow", l: "Hollow candles" }, { id: "heikin", l: "Heikin Ashi" },
    { id: "bars", l: "Bars (OHLC)" }, { id: "hlc", l: "HLC bars" }, { id: "line", l: "Line" },
    { id: "lineMk", l: "Line with markers" }, { id: "step", l: "Step line" }, { id: "area", l: "Area" },
    { id: "baseline", l: "Baseline" }, { id: "cols", l: "Columns" }, { id: "hilo", l: "High-Low" },
    { id: "renko", l: "Renko" }, { id: "linebreak", l: "Line Break" }, { id: "kagi", l: "Kagi" }, { id: "pnf", l: "Point & Figure" }
  ];
  function typeLabel(id) { for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i].l; return id; }
  var BRICKED = { renko: 1, linebreak: 1, kagi: 1, pnf: 1 };

  function heikin(bs) {
    var o = new Array(bs.length), i, po = null, pc = null;
    for (i = 0; i < bs.length; i++) {
      var b = bs[i], hc = (b.o + b.h + b.l + b.c) / 4;
      var ho = po == null ? (b.o + b.c) / 2 : (po + pc) / 2;
      var hh = Math.max(b.h, ho, hc), hl = Math.min(b.l, ho, hc);
      o[i] = { t: b.t, o: ho, h: hh, l: hl, c: hc, v: b.v, src: i };
      po = ho; pc = hc;
    }
    return o;
  }
  function brickSize(bs, mode, val, atrLen) {
    if (mode === "atr") { var a = last(M.atr(bs, atrLen || 14)); return a || (bs.length ? last(bs).c * 0.005 : 1); }
    if (mode === "pct") return (bs.length ? last(bs).c : 1) * (val || 0.5) / 100;
    return val || (bs.length ? last(bs).c * 0.005 : 1);
  }
  function renko(bs, size) {
    var out = [], i, open = null, dir = 0;
    if (!bs.length || !(size > 0)) return out;
    open = Math.round(bs[0].c / size) * size;
    for (i = 0; i < bs.length; i++) {
      var c = bs[i].c, guard = 0;
      while (c >= open + size && guard++ < 500) {
        out.push({ t: bs[i].t, o: open, c: open + size, h: open + size, l: open, v: bs[i].v, src: i, dir: 1 });
        open += size; dir = 1;
      }
      guard = 0;
      while (c <= open - size && guard++ < 500) {
        out.push({ t: bs[i].t, o: open, c: open - size, h: open, l: open - size, v: bs[i].v, src: i, dir: -1 });
        open -= size; dir = -1;
      }
    }
    return out;
  }
  function lineBreak(bs, n) {
    var out = [], i;
    for (i = 0; i < bs.length; i++) {
      var c = bs[i].c;
      if (!out.length) { out.push({ t: bs[i].t, o: bs[i].o, c: c, h: Math.max(bs[i].o, c), l: Math.min(bs[i].o, c), v: bs[i].v, src: i }); continue; }
      var k = Math.min(n, out.length), hi = -Infinity, lo = Infinity, j;
      for (j = out.length - k; j < out.length; j++) { hi = Math.max(hi, out[j].o, out[j].c); lo = Math.min(lo, out[j].o, out[j].c); }
      if (c > hi) out.push({ t: bs[i].t, o: hi, c: c, h: c, l: hi, v: bs[i].v, src: i, dir: 1 });
      else if (c < lo) out.push({ t: bs[i].t, o: lo, c: c, h: lo, l: c, v: bs[i].v, src: i, dir: -1 });
    }
    return out;
  }
  function kagi(bs, revPct) {
    var pts = [], i, dir = 0, ext = bs.length ? bs[0].c : 0, rev = revPct / 100;
    for (i = 0; i < bs.length; i++) {
      var c = bs[i].c;
      if (dir === 0) {
        if (c > ext * (1 + rev)) { dir = 1; pts.push({ i: i, p: ext }); ext = c; }
        else if (c < ext * (1 - rev)) { dir = -1; pts.push({ i: i, p: ext }); ext = c; }
        continue;
      }
      if (dir === 1) {
        if (c > ext) { ext = c; if (pts.length) pts[pts.length - 1] = { i: i, p: c, dir: 1 }; }
        else if (c < ext * (1 - rev)) { pts.push({ i: i, p: ext, dir: 1 }); dir = -1; ext = c; }
      } else {
        if (c < ext) { ext = c; if (pts.length) pts[pts.length - 1] = { i: i, p: c, dir: -1 }; }
        else if (c > ext * (1 + rev)) { pts.push({ i: i, p: ext, dir: -1 }); dir = 1; ext = c; }
      }
    }
    pts.push({ i: bs.length - 1, p: bs.length ? last(bs).c : 0, dir: dir });
    return pts;
  }
  function pnf(bs, box, rev) {
    var cols = [], cur = null, i;
    for (i = 0; i < bs.length; i++) {
      var h = Math.floor(bs[i].h / box), l = Math.ceil(bs[i].l / box);
      if (!cur) { cur = { dir: bs[i].c >= bs[i].o ? 1 : -1, from: Math.min(h, l), to: Math.max(h, l), src: i }; cols.push(cur); continue; }
      if (cur.dir === 1) {
        if (h > cur.to) cur.to = h;
        else if (l <= cur.to - rev) { cur = { dir: -1, from: cur.to - 1, to: l, src: i }; cols.push(cur); }
      } else {
        if (l < cur.to) cur.to = l;
        else if (h >= cur.to + rev) { cur = { dir: 1, from: cur.to + 1, to: h, src: i }; cols.push(cur); }
      }
    }
    return cols;
  }

  /* the series the price pane actually draws, for the chosen type */
  function priceSeries(bs) {
    var t = CFG.type;
    if (t === "heikin") return { bars: heikin(bs), kind: "candle" };
    if (t === "renko") return { bars: renko(bs, brickSize(bs, CFG.brickMode || "atr", CFG.brickVal, CFG.brickAtr)), kind: "brick" };
    if (t === "linebreak") return { bars: lineBreak(bs, CFG.lbN || 3), kind: "brick" };
    if (t === "kagi") return { bars: bs, kagi: kagi(bs, CFG.kagiRev || 4), kind: "kagi" };
    if (t === "pnf") return { bars: bs, pnf: pnf(bs, brickSize(bs, CFG.brickMode || "atr", CFG.brickVal, CFG.brickAtr), CFG.pnfRev || 3), box: brickSize(bs, CFG.brickMode || "atr", CFG.brickVal, CFG.brickAtr), kind: "pnf" };
    return { bars: bs, kind: t === "bars" || t === "hlc" ? "bar" : t === "candles" || t === "hollow" ? "candle" : "line" };
  }

  /* =====================================================================
     7 · GEOMETRY — panes, price scale, time scale
     ===================================================================== */

  var PADR = 64, PADT = 8, PADB = 22, PADL = 38;

  function cv() { return d.getElementById("coinChart"); }
  function host() { return d.getElementById("coinHost"); }

  function paneList(bsLen) {
    var out = [], seen = {}, i, s;
    for (i = 0; i < CFG.studies.length; i++) {
      s = CFG.studies[i];
      if (!s.on) continue;
      var def = stDef(s.k);
      if (!def || def.over) continue;
      var key = s.pane == null ? i + 1 : s.pane;
      if (!seen[key]) { seen[key] = { id: key, studies: [], h: def.h || 0.15 }; out.push(seen[key]); }
      seen[key].studies.push(s);
      seen[key].h = Math.max(seen[key].h, def.h || 0.15);
    }
    return out;
  }

  function transform(mode, base) {
    if (mode === "log") return { f: function (p) { return p > 0 ? Math.log(p) : 0; }, g: function (y) { return Math.exp(y); } };
    if (mode === "percent") return { f: function (p) { return base ? (p / base - 1) * 100 : p; }, g: function (v) { return base ? base * (1 + v / 100) : v; } };
    if (mode === "indexed") return { f: function (p) { return base ? p / base * 100 : p; }, g: function (v) { return base ? v * base / 100 : v; } };
    return { f: function (p) { return p; }, g: function (v) { return v; } };
  }

  function scale(top, bot, lo, hi, mode, base, invert) {
    var tr = transform(mode, base), a = tr.f(lo), b = tr.f(hi);
    if (!(isFinite(a) && isFinite(b)) || a === b) { b = a + 1; }
    var H = bot - top;
    return {
      top: top, bot: bot, lo: lo, hi: hi, mode: mode, base: base, invert: !!invert, tr: tr, a: a, b: b,
      y: function (p) {
        var v = tr.f(p), f = (v - a) / (b - a);
        if (this.invert) f = 1 - f;
        return bot - f * H;
      },
      v: function (yy) {
        var f = (bot - yy) / H;
        if (this.invert) f = 1 - f;
        return tr.g(a + f * (b - a));
      },
      ticks: function (px) {
        var want = clamp(Math.round(H / clamp(px || 44, 26, 90)), 2, 12), out = [], i;
        if (mode === "log") {
          for (i = 0; i <= want; i++) out.push(tr.g(a + (b - a) * i / want));
          return out;
        }
        var span = b - a, raw = span / want, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
        var norm = raw / mag, stepN = norm >= 5 ? 5 : norm >= 2 ? 2 : norm >= 1 ? 1 : 0.5, step = stepN * mag;
        var start = Math.ceil(a / step) * step;
        for (i = start; i <= b + step * 0.001; i += step) out.push(tr.g(i));
        return out;
      }
    };
  }

  /* the whole frame's geometry, recomputed each draw */
  function geometry(bs, W2, H2) {
    var ps = priceSeries(bs), series = ps.bars, n = series.length;
    if (!n) return null;

    /* time scale */
    if (V.n == null || V.i0 == null) {
      V.n = Math.min(n, Math.max(30, Math.floor((W2 - PADL - PADR) / clamp(CFG.bars.spacing, 1.2, 60))));
      V.i0 = Math.max(0, n - V.n);
    }
    V.n = clamp(V.n, 6, Math.max(6, n + 400));
    V.i0 = clamp(V.i0, -CFG.bars.right, Math.max(0, n - 2));
    var plotL = PADL, plotR = W2 - PADR, plotW = Math.max(40, plotR - plotL);
    var sp = plotW / V.n;

    var i0 = V.i0, nvis = V.n;
    var from = Math.max(0, Math.floor(i0)), to = Math.min(n, Math.ceil(i0 + nvis) + 1);

    /* pane layout */
    var panes = paneList(n), plotT = PADT, plotB = H2 - PADB, avail = plotB - plotT, i;
    var subs = [], sumH = 0;
    for (i = 0; i < panes.length; i++) {
      var hf = CFG.paneH && CFG.paneH[panes[i].id] ? CFG.paneH[panes[i].id] : panes[i].h;
      hf = clamp(hf, 0.06, 0.42); sumH += hf; subs.push(hf);
    }
    if (sumH > 0.72) { var k = 0.72 / sumH; for (i = 0; i < subs.length; i++) subs[i] *= k; sumH = 0.72; }
    var mainH = avail * (1 - sumH) - panes.length * 6;
    var y = plotT, layout = [{ id: 0, top: y, bot: y + mainH, studies: [] }];
    y += mainH + 6;
    for (i = 0; i < panes.length; i++) {
      var hh = avail * subs[i];
      layout.push({ id: panes[i].id, top: y, bot: y + hh, studies: panes[i].studies, h: subs[i] });
      y += hh + 6;
    }

    var g = {
      series: series, ps: ps, bars: bs, n: n, i0: i0, nvis: nvis, sp: sp,
      plotL: plotL, plotR: plotR, plotW: plotW, plotT: plotT, plotB: plotB, W: W2, H: H2,
      from: from, to: to, layout: layout,
      x: function (idx) { return plotL + (idx - i0 + 0.5) * sp; },
      idx: function (px) { return (px - plotL) / sp + i0 - 0.5; },
      t: function (idx) {
        if (!series.length) return 0;
        var ms = IVMS(CFG.iv);
        if (idx <= 0) return series[0].t + idx * ms;
        if (idx >= series.length - 1) return series[series.length - 1].t + (idx - (series.length - 1)) * ms;
        var a = Math.floor(idx), f = idx - a;
        return series[a].t + (series[a + 1].t - series[a].t) * f;
      },
      iOf: function (t) {
        if (!series.length) return 0;
        var ms = IVMS(CFG.iv);
        if (t <= series[0].t) return (t - series[0].t) / ms;
        if (t >= series[series.length - 1].t) return series.length - 1 + (t - series[series.length - 1].t) / ms;
        var lo2 = 0, hi2 = series.length - 1;
        while (hi2 - lo2 > 1) { var mid = (lo2 + hi2) >> 1; if (series[mid].t <= t) lo2 = mid; else hi2 = mid; }
        var dt = series[hi2].t - series[lo2].t;
        return lo2 + (dt ? (t - series[lo2].t) / dt : 0);
      }
    };

    /* price scale for the main pane */
    var hi = -Infinity, lo = Infinity, base = series[from] ? series[from].c : series[0].c;
    for (i = from; i < to && i < n; i++) {
      var b2 = series[i];
      if (b2.h > hi) hi = b2.h;
      if (b2.l < lo) lo = b2.l;
    }
    /* overlay studies widen the scale so a band is never clipped */
    var rowsFor = [];
    for (i = 0; i < CFG.studies.length; i++) {
      var st = CFG.studies[i];
      if (!st.on) continue;
      var def = stDef(st.k);
      if (!def || !def.over) continue;
      var r = studyRows(st, bs, { i0: i0, n: nvis });
      if (!r) continue;
      rowsFor.push({ st: st, r: r });
      var j, q, row;
      for (j = 0; j < r.rows.length; j++) {
        row = r.rows[j];
        var arrs = row.kind === "band" || row.kind === "cloud" ? [row.a, row.b] : row.data ? [row.data] : [];
        for (q = 0; q < arrs.length; q++) {
          var arr = arrs[q];
          if (!arr) continue;
          for (var z = from; z < Math.min(to, arr.length); z++) {
            var v2 = arr[z];
            if (v2 == null || !isFinite(v2)) continue;
            if (v2 > hi) hi = v2; if (v2 < lo) lo = v2;
          }
        }
      }
      if (r.levels) for (j = 0; j < r.levels.length; j++) {
        if (isNum(r.levels[j].v)) { if (r.levels[j].v > hi) hi = r.levels[j].v; if (r.levels[j].v < lo) lo = r.levels[j].v; }
      }
    }
    if (!isFinite(hi) || !isFinite(lo)) return null;
    var padF = 0.06, rg = hi - lo || hi * 0.01 || 1;
    var man = V.yman[0];
    var loP = man ? man.lo : lo - rg * padF, hiP = man ? man.hi : hi + rg * padF;
    var mode = CFG.scale.mode;
    g.mainBase = base;
    g.rowsFor = rowsFor;
    layout[0].sc = scale(layout[0].top, layout[0].bot, loP, hiP, mode, base, CFG.scale.invert);

    /* scales for the sub-panes */
    for (i = 1; i < layout.length; i++) {
      var pane = layout[i], phi = -Infinity, plo = Infinity, fixed = null, fmtK = null, zero = false, lv = [], zones = null;
      pane.rows = [];
      for (var s2 = 0; s2 < pane.studies.length; s2++) {
        var r2 = studyRows(pane.studies[s2], bs, { i0: i0, n: nvis });
        if (!r2) continue;
        pane.rows.push({ st: pane.studies[s2], r: r2 });
        if (r2.range) fixed = r2.range;
        if (r2.fmt) fmtK = r2.fmt;
        if (r2.zero) zero = true;
        if (r2.levels) lv = lv.concat(r2.levels);
        if (r2.zones) zones = r2.zones;
        for (var j2 = 0; j2 < r2.rows.length; j2++) {
          var rw = r2.rows[j2], dat = rw.data || rw.a;
          if (!dat) continue;
          for (var z2 = from; z2 < Math.min(to, dat.length); z2++) {
            var v3 = dat[z2];
            if (v3 == null || !isFinite(v3)) continue;
            if (v3 > phi) phi = v3; if (v3 < plo) plo = v3;
          }
          if (rw.b) for (z2 = from; z2 < Math.min(to, rw.b.length); z2++) {
            var v4 = rw.b[z2];
            if (v4 == null || !isFinite(v4)) continue;
            if (v4 > phi) phi = v4; if (v4 < plo) plo = v4;
          }
        }
      }
      if (fixed) { plo = fixed[0]; phi = fixed[1]; }
      else {
        if (!isFinite(phi)) { phi = 1; plo = 0; }
        if (zero) { var m3 = Math.max(Math.abs(phi), Math.abs(plo)); phi = m3; plo = -m3; }
        var prg = phi - plo || Math.abs(phi) * 0.1 || 1;
        phi += prg * 0.08; plo -= prg * 0.08;
        if (fmtK === "vol" && plo > 0) plo = 0;
      }
      pane.sc = scale(pane.top, pane.bot, plo, phi, "linear", 0, false);
      pane.fmt = fmtK; pane.levels = lv; pane.zones = zones; pane.fixed = fixed;
    }
    return g;
  }

  function paneAt(g, yy) {
    if (!g) return null;
    for (var i = 0; i < g.layout.length; i++) if (yy >= g.layout[i].top - 3 && yy <= g.layout[i].bot + 3) return g.layout[i];
    return g.layout[0];
  }

  /* =====================================================================
     8 · RENDERER
     ===================================================================== */

  function dash(x, n) { x.setLineDash(n ? (n === 2 ? [2, 3] : n === 4 ? [5, 4] : [n, n]) : []); }

  function drawLineRow(x, g, sc, row, from, to, extend) {
    var data = row.data;
    if (!data) return;
    x.save();
    x.beginPath();
    var started = false, i, lim = Math.min(to + (extend || 0), data.length);
    for (i = from; i < lim; i++) {
      var v = data[i];
      if (v == null || !isFinite(v)) { started = false; continue; }
      var px = g.x(i), py = sc.y(v);
      if (!started) { x.moveTo(px, py); started = true; } else x.lineTo(px, py);
    }
    x.lineWidth = row.w || 1.4;
    x.strokeStyle = row.c || P().line;
    x.lineJoin = "round"; x.lineCap = "butt";
    dash(x, row.dash);
    x.stroke();
    x.restore();
  }
  function drawStepRow(x, g, sc, row, from, to) {
    var data = row.data;
    x.save(); x.beginPath();
    var started = false, i;
    for (i = from; i < Math.min(to, data.length); i++) {
      var v = data[i];
      if (v == null) { started = false; continue; }
      var px = g.x(i), py = sc.y(v);
      if (!started) { x.moveTo(px - g.sp / 2, py); started = true; } else x.lineTo(px - g.sp / 2, py);
      x.lineTo(px + g.sp / 2, py);
    }
    x.lineWidth = row.w || 1.6; x.strokeStyle = row.c || P().line; dash(x, row.dash); x.stroke(); x.restore();
  }
  function drawBandRow(x, g, sc, row, from, to, cloud) {
    var a = row.a, b = row.b, i, pts = [];
    x.save();
    if (cloud) {
      /* Ichimoku: the cloud is coloured by which span is on top */
      var seg = [];
      for (i = from; i < Math.min(to, a.length); i++) {
        if (a[i] == null || b[i] == null) { if (seg.length > 1) fillSeg(seg); seg = []; continue; }
        seg.push({ x: g.x(i), a: sc.y(a[i]), b: sc.y(b[i]), up: a[i] >= b[i] });
      }
      if (seg.length > 1) fillSeg(seg);
      x.restore();
      return;
    }
    x.beginPath();
    var started = false;
    for (i = from; i < Math.min(to, a.length); i++) {
      if (a[i] == null) continue;
      var px = g.x(i), py = sc.y(a[i]);
      if (!started) { x.moveTo(px, py); started = true; } else x.lineTo(px, py);
      pts.push(i);
    }
    for (i = pts.length - 1; i >= 0; i--) {
      var j = pts[i];
      if (b[j] == null) continue;
      x.lineTo(g.x(j), sc.y(b[j]));
    }
    x.closePath();
    x.globalAlpha = row.fill == null ? 0.08 : row.fill;
    x.fillStyle = row.c || P().line;
    x.fill();
    x.restore();

    function fillSeg(sg) {
      var k = 0;
      while (k < sg.length - 1) {
        var up = sg[k].up, m = k;
        while (m < sg.length && sg[m].up === up) m++;
        x.beginPath();
        x.moveTo(sg[k].x, sg[k].a);
        for (var q = k; q < m; q++) x.lineTo(sg[q].x, sg[q].a);
        for (q = m - 1; q >= k; q--) x.lineTo(sg[q].x, sg[q].b);
        x.closePath();
        x.globalAlpha = row.fill == null ? 0.1 : row.fill;
        x.fillStyle = up ? row.c : row.c2 || row.c;
        x.fill();
        x.globalAlpha = 1;
        k = Math.max(m, k + 1);
      }
    }
  }
  function drawHistRow(x, g, sc, row, from, to) {
    var data = row.data, bw = Math.max(1, g.sp * 0.66), i;
    x.save();
    for (i = from; i < Math.min(to, data.length); i++) {
      var v = data[i];
      if (v == null || !isFinite(v)) continue;
      var y0 = sc.y(0), y1 = sc.y(v);
      x.fillStyle = v >= 0 ? row.up : row.dn;
      x.globalAlpha = 0.8;
      x.fillRect(g.x(i) - bw / 2, Math.min(y0, y1), bw, Math.max(1, Math.abs(y1 - y0)));
    }
    x.restore();
  }
  function drawVolRow(x, g, sc, row, from, to) {
    var bs = row.bs, data = row.data, bw = Math.max(1, g.sp * 0.7), i, pal = P();
    x.save();
    for (i = from; i < Math.min(to, data.length); i++) {
      var v = data[i];
      if (v == null) continue;
      var y0 = sc.y(0), y1 = sc.y(v), up = bs[i] ? bs[i].c >= bs[i].o : true;
      x.fillStyle = up ? pal.volUp : pal.volDn;
      x.fillRect(g.x(i) - bw / 2, Math.min(y0, y1), bw, Math.max(1, Math.abs(y1 - y0)));
    }
    x.restore();
  }
  function drawDots(x, g, sc, row, from, to) {
    var data = row.data, i;
    x.save(); x.fillStyle = row.c;
    for (i = from; i < Math.min(to, data.length); i++) {
      var v = data[i];
      if (v == null) continue;
      x.beginPath(); x.arc(g.x(i), sc.y(v), Math.max(1, Math.min(2.4, g.sp * 0.16)), 0, TAU); x.fill();
    }
    x.restore();
  }
  function drawZig(x, g, sc, row) {
    var pts = row.pts, i;
    if (!pts || pts.length < 2) return;
    x.save(); x.beginPath();
    for (i = 0; i < pts.length; i++) {
      var px = g.x(pts[i].i), py = sc.y(pts[i].p);
      if (!i) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.lineWidth = 1.4; x.strokeStyle = row.c; x.stroke(); x.restore();
  }
  function drawPivots(x, g, sc, row) {
    var sets = row.sets, pal = P(), i, k;
    if (!sets) return;
    x.save(); x.font = "9px ui-monospace,Menlo,monospace"; x.textAlign = "left";
    for (i = 0; i < sets.length; i++) {
      var s = sets[i];
      if (s.to < g.from - 2 || s.from > g.to + 2) continue;
      var x0 = g.x(Math.max(s.from, g.from)), x1 = g.x(Math.min(s.to, g.to));
      for (k in s.lv) {
        if (!Object.prototype.hasOwnProperty.call(s.lv, k)) continue;
        var v = s.lv[k], yy = sc.y(v);
        if (yy < sc.top || yy > sc.bot) continue;
        x.strokeStyle = k === "P" ? "#FFD166" : k[0] === "R" ? pal.dn : pal.up;
        x.globalAlpha = 0.75; x.lineWidth = 1; dash(x, k === "P" ? 0 : 2);
        x.beginPath(); x.moveTo(x0, yy); x.lineTo(x1, yy); x.stroke();
        x.globalAlpha = 1; x.fillStyle = x.strokeStyle;
        x.fillText(k, x0 + 2, yy - 2);
      }
    }
    dash(x, 0); x.restore();
  }
  function drawProfile(x, g, sc, row) {
    var prof = row.prof, i, wMax = g.plotW * 0.26, pal = P();
    x.save();
    for (i = 0; i < prof.bins.length; i++) {
      var v = prof.bins[i];
      if (!v) continue;
      var p0 = prof.lo + i * prof.step, p1 = p0 + prof.step;
      var y0 = sc.y(p1), y1 = sc.y(p0), w2 = v / prof.max * wMax;
      var inVA = i >= prof.vaLo && i <= prof.vaHi;
      x.globalAlpha = i === prof.poc ? 0.55 : inVA ? 0.3 : 0.16;
      x.fillStyle = i === prof.poc ? "#FFD166" : row.c || pal.line;
      x.fillRect(g.plotR - w2, Math.min(y0, y1), w2, Math.max(1, Math.abs(y1 - y0) - 0.5));
    }
    x.globalAlpha = 1;
    var pocP = prof.lo + (prof.poc + 0.5) * prof.step, py = sc.y(pocP);
    x.strokeStyle = "#FFD166"; x.lineWidth = 1; dash(x, 2);
    x.beginPath(); x.moveTo(g.plotL, py); x.lineTo(g.plotR, py); x.stroke(); dash(x, 0);
    x.restore();
  }

  function drawRows(x, g, pane, list, extend) {
    var i, j, sc = pane.sc;
    for (i = 0; i < list.length; i++) {
      var rows = list[i].r.rows;
      for (j = 0; j < rows.length; j++) {
        var row = rows[j];
        if (row.kind === "band") drawBandRow(x, g, sc, row, g.from, g.to, false);
        else if (row.kind === "cloud") drawBandRow(x, g, sc, row, g.from, g.to + (list[i].r.extend || 0), true);
        else if (row.kind === "hist") drawHistRow(x, g, sc, row, g.from, g.to);
        else if (row.kind === "vbars") drawVolRow(x, g, sc, row, g.from, g.to);
        else if (row.kind === "dots") drawDots(x, g, sc, row, g.from, g.to);
        else if (row.kind === "zig") drawZig(x, g, sc, row);
        else if (row.kind === "pivots") drawPivots(x, g, sc, row);
        else if (row.kind === "profile") drawProfile(x, g, sc, row);
        else if (row.kind === "step") drawStepRow(x, g, sc, row, g.from, g.to);
        else drawLineRow(x, g, sc, row, g.from, g.to + (list[i].r.extend || 0), 0);
      }
      if (list[i].r.levels) for (j = 0; j < list[i].r.levels.length; j++) {
        var lv = list[i].r.levels[j];
        if (!isNum(lv.v)) continue;
        var yy = sc.y(lv.v);
        if (yy < sc.top - 1 || yy > sc.bot + 1) continue;
        x.save();
        x.strokeStyle = lv.c || P().faint; x.lineWidth = 1; dash(x, lv.dash || 2);
        x.beginPath(); x.moveTo(g.plotL, yy); x.lineTo(g.plotR, yy); x.stroke();
        if (lv.label) { x.fillStyle = lv.c || P().text; x.font = "9px ui-monospace,Menlo,monospace"; x.textAlign = "left"; x.fillText(lv.label, g.plotL + 3, yy - 3); }
        x.restore();
      }
    }
    dash(x, 0);
  }

  function drawGrid(x, g, pane) {
    var pal = P(), sc = pane.sc, i;
    if (CFG.look.grid) {
      var ticks = sc.ticks(pane.id === 0 ? 46 : 34);
      x.save(); x.strokeStyle = pal.grid; x.lineWidth = 1;
      for (i = 0; i < ticks.length; i++) {
        var yy = Math.round(sc.y(ticks[i])) + 0.5;
        if (yy < pane.top || yy > pane.bot) continue;
        x.beginPath(); x.moveTo(g.plotL, yy); x.lineTo(g.plotR, yy); x.stroke();
      }
      x.restore();
    }
    /* the axis labels */
    x.save();
    x.fillStyle = pal.text; x.font = "10px ui-monospace,Menlo,Consolas,monospace"; x.textAlign = "left";
    var tk = sc.ticks(pane.id === 0 ? 46 : 34);
    for (i = 0; i < tk.length; i++) {
      var y2 = sc.y(tk[i]);
      if (y2 < pane.top + 4 || y2 > pane.bot - 2) continue;
      var lbl = pane.id === 0
        ? (CFG.scale.mode === "percent" ? pctS(transform("percent", g.mainBase).f(tk[i]), 2) : CFG.scale.mode === "indexed" ? transform("indexed", g.mainBase).f(tk[i]).toFixed(1) : sig(tk[i]))
        : (pane.fmt === "vol" ? vol(tk[i]) : sig(tk[i]));
      x.fillText(lbl, g.plotR + 6, y2 + 3);
    }
    x.restore();
  }

  function drawTimeAxis(x, g) {
    var pal = P(), i;
    x.save();
    x.strokeStyle = pal.axis; x.lineWidth = 1;
    x.beginPath(); x.moveTo(g.plotL, g.plotB + 0.5); x.lineTo(g.W, g.plotB + 0.5); x.stroke();
    x.beginPath(); x.moveTo(g.plotR + 0.5, PADT); x.lineTo(g.plotR + 0.5, g.plotB); x.stroke();
    x.fillStyle = pal.text; x.font = "10px ui-monospace,Menlo,monospace"; x.textAlign = "center";
    var every = Math.max(1, Math.round(78 / Math.max(1, g.sp)));
    var startI = Math.ceil(g.from / every) * every;
    for (i = startI; i < g.to; i += every) {
      if (i < 0 || i >= g.series.length) continue;
      var px = g.x(i);
      if (px < g.plotL + 14 || px > g.plotR - 14) continue;
      if (CFG.look.gridV) {
        x.strokeStyle = pal.grid;
        x.beginPath(); x.moveTo(Math.round(px) + 0.5, PADT); x.lineTo(Math.round(px) + 0.5, g.plotB); x.stroke();
      }
      x.fillStyle = pal.text;
      x.fillText(tickLabel(g.series[i].t, CFG.iv), px, g.plotB + 14);
    }
    x.restore();
  }

  function watermark(x, g) {
    if (!CFG.look.mark) return;
    var S = ST(), pal = P();
    x.save();
    x.globalAlpha = 1; x.fillStyle = pal.mark;
    x.textAlign = "center"; x.textBaseline = "middle";
    var cx = (g.plotL + g.plotR) / 2, cy = (g.layout[0].top + g.layout[0].bot) / 2;
    x.font = "700 " + Math.round(Math.min(54, g.plotW / 11)) + "px Inter,system-ui,sans-serif";
    x.fillText((S.coin || "BTC") + " / " + (S.quote || "USDT"), cx, cy - 14);
    x.font = "600 " + Math.round(Math.min(20, g.plotW / 28)) + "px Inter,system-ui,sans-serif";
    x.fillText("DexLadder · " + IV(CFG.iv).lbl + " · " + typeLabel(CFG.type), cx, cy + 20);
    x.textBaseline = "alphabetic";
    x.restore();
  }

  function drawPrice(x, g) {
    var pal = P(), sc = g.layout[0].sc, ps = g.ps, series = g.series, i;
    var bw = Math.max(1, Math.min(g.sp * 0.68, 26)), t = CFG.type;

    if (ps.kind === "kagi") {
      var pts = ps.kagi;
      x.save(); x.lineWidth = 1.6;
      for (i = 1; i < pts.length; i++) {
        var a = pts[i - 1], b = pts[i];
        x.strokeStyle = b.p >= a.p ? pal.up : pal.dn;
        x.beginPath();
        x.moveTo(g.x(a.i), sc.y(a.p)); x.lineTo(g.x(b.i), sc.y(a.p)); x.lineTo(g.x(b.i), sc.y(b.p));
        x.stroke();
      }
      x.restore(); return;
    }
    if (ps.kind === "pnf") {
      var cols = ps.pnf, box = ps.box, cw = Math.max(2, g.sp * 0.7);
      x.save(); x.lineWidth = 1.4;
      for (i = 0; i < cols.length; i++) {
        var c2 = cols[i], cx = g.x(c2.src), lo2 = Math.min(c2.from, c2.to), hi2 = Math.max(c2.from, c2.to);
        x.strokeStyle = c2.dir === 1 ? pal.up : pal.dn;
        for (var lvl = lo2; lvl <= hi2; lvl++) {
          var yy = sc.y((lvl + 0.5) * box), r = cw / 2;
          x.beginPath();
          if (c2.dir === 1) { x.moveTo(cx - r, yy + r); x.lineTo(cx + r, yy - r); x.moveTo(cx + r, yy + r); x.lineTo(cx - r, yy - r); }
          else { x.arc(cx, yy, r * 0.82, 0, TAU); }
          x.stroke();
        }
      }
      x.restore(); return;
    }
    if (ps.kind === "line" || t === "line" || t === "area" || t === "step" || t === "baseline" || t === "lineMk" || t === "cols" || t === "hilo") {
      var closes = series.map(function (b) { return b.c; });
      if (t === "cols") {
        x.save();
        for (i = g.from; i < g.to; i++) {
          var b3 = series[i];
          if (!b3) continue;
          x.fillStyle = b3.c >= b3.o ? pal.upFill : pal.dnFill;
          var y0 = sc.y(b3.o), y1 = sc.y(b3.c);
          x.fillRect(g.x(i) - bw / 2, Math.min(y0, y1), bw, Math.max(1, Math.abs(y1 - y0)));
        }
        x.restore();
      } else if (t === "hilo") {
        x.save(); x.lineWidth = Math.max(1, bw * 0.5);
        for (i = g.from; i < g.to; i++) {
          var b4 = series[i];
          if (!b4) continue;
          x.strokeStyle = b4.c >= b4.o ? pal.up : pal.dn;
          x.beginPath(); x.moveTo(g.x(i), sc.y(b4.h)); x.lineTo(g.x(i), sc.y(b4.l)); x.stroke();
        }
        x.restore();
      } else if (t === "step") {
        drawStepRow(x, g, sc, { data: closes, c: pal.line, w: 1.8 }, g.from, g.to);
      } else {
        var up = series.length > 1 && last(series).c >= series[Math.max(0, g.from)].c;
        var accent = t === "baseline" ? null : pal.line;
        if (t === "area" || t === "baseline") {
          var baseY = t === "baseline" ? sc.y(g.mainBase) : sc.bot;
          x.save();
          x.beginPath();
          var st2 = false;
          for (i = g.from; i < g.to; i++) {
            if (closes[i] == null) continue;
            var px2 = g.x(i), py2 = sc.y(closes[i]);
            if (!st2) { x.moveTo(px2, baseY); x.lineTo(px2, py2); st2 = true; } else x.lineTo(px2, py2);
          }
          x.lineTo(g.x(Math.min(g.to, series.length) - 1), baseY);
          x.closePath();
          var grd = x.createLinearGradient(0, sc.top, 0, sc.bot);
          if (t === "baseline") {
            grd.addColorStop(0, pal.up + "55"); grd.addColorStop(0.5, "rgba(0,0,0,0)"); grd.addColorStop(1, pal.dn + "55");
          } else {
            grd.addColorStop(0, (up ? pal.up : pal.dn) + "44"); grd.addColorStop(1, (up ? pal.up : pal.dn) + "02");
          }
          x.fillStyle = grd; x.fill(); x.restore();
        }
        drawLineRow(x, g, sc, { data: closes, c: accent || (up ? pal.up : pal.dn), w: 2 }, g.from, g.to, 0);
        if (t === "lineMk") {
          x.save(); x.fillStyle = accent || pal.line;
          for (i = g.from; i < g.to; i++) { x.beginPath(); x.arc(g.x(i), sc.y(closes[i]), Math.min(2.6, Math.max(1, g.sp * 0.18)), 0, TAU); x.fill(); }
          x.restore();
        }
      }
    } else {
      /* candles, hollow candles, heikin ashi, bars, hlc bars, renko, line break */
      x.save();
      var hollow = t === "hollow", bars2 = t === "bars" || t === "hlc";
      x.lineWidth = 1;
      for (i = g.from; i < g.to; i++) {
        var b5 = series[i];
        if (!b5) continue;
        var up2 = b5.dir != null ? b5.dir > 0 : b5.c >= b5.o;
        var col = up2 ? pal.up : pal.dn, cx2 = g.x(i);
        var yo = sc.y(b5.o), yc = sc.y(b5.c), yh = sc.y(b5.h), yl = sc.y(b5.l);
        if (bars2) {
          x.strokeStyle = col; x.lineWidth = Math.max(1, Math.min(2, g.sp * 0.14));
          x.beginPath(); x.moveTo(cx2, yh); x.lineTo(cx2, yl); x.stroke();
          x.beginPath();
          if (t === "bars") { x.moveTo(cx2 - bw / 2, yo); x.lineTo(cx2, yo); }
          x.moveTo(cx2, yc); x.lineTo(cx2 + bw / 2, yc);
          x.stroke();
          continue;
        }
        if (CFG.look.wick) {
          x.strokeStyle = col; x.lineWidth = Math.max(0.8, Math.min(1.4, g.sp * 0.1));
          x.beginPath(); x.moveTo(Math.round(cx2) + 0.5, yh); x.lineTo(Math.round(cx2) + 0.5, yl); x.stroke();
        }
        var bt = Math.min(yo, yc), bh = Math.max(1, Math.abs(yc - yo));
        if (hollow && up2) {
          x.strokeStyle = col; x.lineWidth = 1;
          x.strokeRect(Math.round(cx2 - bw / 2) + 0.5, Math.round(bt) + 0.5, Math.round(bw), Math.round(bh));
        } else {
          x.fillStyle = up2 ? pal.upFill : pal.dnFill;
          x.fillRect(cx2 - bw / 2, bt, bw, bh);
          if (CFG.look.border && bw > 3) {
            x.strokeStyle = col; x.lineWidth = 1;
            x.strokeRect(Math.round(cx2 - bw / 2) + 0.5, Math.round(bt) + 0.5, Math.round(bw), Math.round(bh));
          }
        }
      }
      x.restore();
    }
  }

  function priceTag(x, g, yy, text, bg, fg) {
    var pal = P();
    if (yy < PADT || yy > g.plotB) return;
    x.save();
    x.font = "600 10px ui-monospace,Menlo,monospace";
    var w2 = Math.max(46, x.measureText(text).width + 10);
    x.fillStyle = bg; x.fillRect(g.plotR + 1, yy - 8, Math.min(w2, PADR - 2), 16);
    x.fillStyle = fg || pal.ink; x.textAlign = "left";
    x.fillText(text, g.plotR + 5, yy + 3.5);
    x.restore();
  }

  function drawMarks(x, g) {
    var pal = P(), sc = g.layout[0].sc, series = g.series, lb = last(series);
    if (!lb) return;
    /* the live price line + tag, the way every terminal marks it */
    if (CFG.look.priceLine) {
      var yy = sc.y(lb.c), up = lb.c >= lb.o;
      x.save();
      x.strokeStyle = up ? pal.up : pal.dn; x.globalAlpha = 0.75; x.lineWidth = 1; dash(x, 2);
      x.beginPath(); x.moveTo(g.plotL, yy); x.lineTo(g.plotR, yy); x.stroke();
      dash(x, 0); x.globalAlpha = 1; x.restore();
      priceTag(x, g, yy, fmt(lb.c), up ? pal.up : pal.dn, pal.ink);
      if (CFG.look.countdown) {
        var ms = IVMS(CFG.iv), left = ms - (now() - Math.floor(now() / ms) * ms);
        var sec = Math.floor(left / 1000), mm = Math.floor(sec / 60), hh = Math.floor(mm / 60);
        var cd = hh > 0 ? hh + "h " + pad2(mm % 60) + "m" : mm > 0 ? mm + ":" + pad2(sec % 60) : sec + "s";
        x.save(); x.font = "600 9px ui-monospace,Menlo,monospace"; x.fillStyle = pal.text; x.textAlign = "left";
        x.fillText(cd, g.plotR + 5, yy + 16);
        x.restore();
      }
    }
    /* the visible range's high and low */
    if (CFG.look.hlLines) {
      var hi = -Infinity, lo = Infinity, i;
      for (i = g.from; i < g.to && i < series.length; i++) { if (series[i].h > hi) hi = series[i].h; if (series[i].l < lo) lo = series[i].l; }
      if (isFinite(hi)) {
        x.save(); x.lineWidth = 1; dash(x, 4);
        x.strokeStyle = pal.dn; x.beginPath(); x.moveTo(g.plotL, sc.y(hi)); x.lineTo(g.plotR, sc.y(hi)); x.stroke();
        x.strokeStyle = pal.up; x.beginPath(); x.moveTo(g.plotL, sc.y(lo)); x.lineTo(g.plotR, sc.y(lo)); x.stroke();
        dash(x, 0); x.restore();
      }
    }
    /* the position's average entry and the working orders, read from the paper engine */
    var S = ST();
    if (CFG.look.position) {
      var held = (S.bal && S.bal[S.coin]) || 0, ae = 0;
      try { ae = typeof W.avgEntryUSD === "function" ? W.avgEntryUSD(S.coin) : 0; } catch (e) { ae = 0; }
      if (held > 1e-9 && ae > 0) {
        var yE = sc.y(ae);
        x.save(); x.strokeStyle = "#FFD166"; x.lineWidth = 1.2; dash(x, 4);
        x.beginPath(); x.moveTo(g.plotL, yE); x.lineTo(g.plotR, yE); x.stroke(); dash(x, 0); x.restore();
        priceTag(x, g, yE, "entry " + fmt(ae), "#FFD166", "#0A0E20");
      }
    }
    if (CFG.look.orders && Array.isArray(S.orders)) {
      for (var k = 0; k < S.orders.length; k++) {
        var o = S.orders[k];
        if (!o || o.sym !== S.coin) continue;
        var px = +o.limit || +o.stop || +o.px || 0;
        if (!(px > 0)) continue;
        var yO = sc.y(px), buy = o.side === "buy";
        x.save(); x.strokeStyle = buy ? pal.up : pal.dn; x.globalAlpha = 0.9; x.lineWidth = 1; dash(x, 2);
        x.beginPath(); x.moveTo(g.plotL, yO); x.lineTo(g.plotR, yO); x.stroke(); dash(x, 0); x.globalAlpha = 1; x.restore();
        priceTag(x, g, yO, (buy ? "buy " : "sell ") + fmt(px), buy ? pal.up : pal.dn, pal.ink);
      }
    }
    if (CFG.look.alerts && Array.isArray(S.alerts)) {
      for (var a2 = 0; a2 < S.alerts.length; a2++) {
        var al = S.alerts[a2];
        if (!al || al.sym !== S.coin || !(+al.px > 0)) continue;
        var yA = sc.y(+al.px);
        x.save(); x.strokeStyle = "#00E5FF"; x.globalAlpha = 0.8; x.lineWidth = 1; dash(x, 4);
        x.beginPath(); x.moveTo(g.plotL, yA); x.lineTo(g.plotR, yA); x.stroke(); dash(x, 0); x.globalAlpha = 1; x.restore();
        priceTag(x, g, yA, "alert " + fmt(+al.px), "#00E5FF", "#04121c");
      }
    }
  }

  function drawCompare(x, g) {
    if (!CFG.cmp.length) return;
    var sc = g.layout[0].sc, i, j;
    for (i = 0; i < CFG.cmp.length; i++) {
      var sym = CFG.cmp[i], cb = cmpBars(sym);
      if (!cb.length) { loadCmp(sym); continue; }
      /* map the comparison series onto our own bar times, then rebase it onto our first
         visible close so two assets of different price scales can be read together */
      var mapd = new Array(g.series.length), k = 0;
      for (j = 0; j < g.series.length; j++) {
        while (k < cb.length - 1 && cb[k + 1].t <= g.series[j].t) k++;
        mapd[j] = cb[k] ? cb[k].c : null;
      }
      var baseOur = g.series[g.from] ? g.series[g.from].c : 0, baseIts = mapd[g.from];
      if (!baseIts || !baseOur) continue;
      var scaled = mapd.map(function (v) { return v == null ? null : v / baseIts * baseOur; });
      drawLineRow(x, g, sc, { data: scaled, c: SERIES_COLORS[(i + 3) % SERIES_COLORS.length], w: 1.4, dash: 2 }, g.from, g.to, 0);
    }
  }

  function drawCrosshair(x, g) {
    var cr = V.cursor, pal = P();
    if (!cr || V.tool === "eraser") return;
    var px = cr.x, py = cr.y;
    x.save();
    x.strokeStyle = pal.cross; x.lineWidth = 1; dash(x, 2);
    x.beginPath(); x.moveTo(Math.round(px) + 0.5, PADT); x.lineTo(Math.round(px) + 0.5, g.plotB); x.stroke();
    x.beginPath(); x.moveTo(g.plotL, Math.round(py) + 0.5); x.lineTo(g.plotR, Math.round(py) + 0.5); x.stroke();
    dash(x, 0); x.restore();
    var pane = paneAt(g, py);
    if (pane) {
      var v = pane.sc.v(py);
      var lbl = pane.id === 0
        ? (CFG.scale.mode === "percent" ? pctS(transform("percent", g.mainBase).f(v), 2) : sig(v))
        : (pane.fmt === "vol" ? vol(v) : sig(v));
      priceTag(x, g, py, lbl, pal.tipLine, pal.textHi);
    }
    /* the time tag under the cursor */
    var i = Math.round(g.idx(px));
    if (i >= 0 && i < g.series.length) {
      var txt = stamp(g.series[i].t, CFG.iv);
      x.save(); x.font = "600 10px ui-monospace,Menlo,monospace";
      var w2 = x.measureText(txt).width + 12;
      x.fillStyle = pal.tipLine; x.fillRect(clamp(px - w2 / 2, g.plotL, g.plotR - w2), g.plotB + 2, w2, 17);
      x.fillStyle = pal.textHi; x.textAlign = "center";
      x.fillText(txt, clamp(px, g.plotL + w2 / 2, g.plotR - w2 / 2), g.plotB + 14);
      x.restore();
    }
  }

  function drawEmpty(x, W2, H2, msg) {
    var pal = P();
    x.save();
    x.fillStyle = pal.bg; x.fillRect(0, 0, W2, H2);
    x.fillStyle = pal.text; x.font = "600 13px Inter,system-ui,sans-serif"; x.textAlign = "center";
    x.fillText(msg, W2 / 2, H2 / 2);
    x.restore();
  }

  /* =====================================================================
     9 · DRAWINGS
     A drawing is stored in DATA space — (time, price) — so it stays where it
     was put through zoom, pan, an interval change and a reload. Every tool is
     one entry in TOOL: how many points it takes, how it renders, how it is
     hit-tested. The primitives below are shared by all of them.
     ===================================================================== */

  var ERRS = [];             /* render faults, newest last — DXC.errors() reads it */
  function fault(where, e) {
    ERRS.push({ at: where, err: String((e && e.message) || e) });
    if (ERRS.length > 40) ERRS.shift();
  }

  var DRAWS = {};            /* symbol-quote → [obj] */
  var UNDO = [], REDO = [];

  function drawings() {
    var k = symKey();
    if (!DRAWS[k]) DRAWS[k] = LS.get(K_DRAW + k, []) || [];
    return DRAWS[k];
  }
  function saveDraws() {
    var k = symKey();
    LS.set(K_DRAW + k, DRAWS[k] || []);
  }
  function pushUndo() {
    UNDO.push(JSON.stringify(drawings()));
    if (UNDO.length > 60) UNDO.shift();
    REDO.length = 0;
  }
  function undo() {
    if (!UNDO.length) return;
    REDO.push(JSON.stringify(drawings()));
    try { DRAWS[symKey()] = JSON.parse(UNDO.pop()); } catch (e) { }
    V.sel = []; saveDraws(); mark();
  }
  function redo() {
    if (!REDO.length) return;
    UNDO.push(JSON.stringify(drawings()));
    try { DRAWS[symKey()] = JSON.parse(REDO.pop()); } catch (e) { }
    V.sel = []; saveDraws(); mark();
  }
  function byId(id) {
    var a = drawings(), i;
    for (i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
    return null;
  }
  function removeIds(ids) {
    var a = drawings(), i;
    pushUndo();
    for (i = a.length - 1; i >= 0; i--) if (ids.indexOf(a[i].id) >= 0) a.splice(i, 1);
    V.sel = []; saveDraws(); mark();
  }

  var DEF_STYLE = { c: "#00E5FF", w: 1.6, dash: 0, fill: 0.12, fs: 12, txt: "", extL: false, extR: false, lock: false, vis: true, variant: "" };
  function newObj(tool, pts, st) {
    var s = {}, k;
    for (k in DEF_STYLE) if (Object.prototype.hasOwnProperty.call(DEF_STYLE, k)) s[k] = DEF_STYLE[k];
    if (st) for (k in st) if (Object.prototype.hasOwnProperty.call(st, k)) s[k] = st[k];
    return { id: uid("dx"), tool: tool, pts: pts, st: s, pane: 0 };
  }

  /* ---- primitives ---- */
  function sxy(g, sc, pt) { return { x: g.x(g.iOf(pt.t)), y: sc.y(pt.p) }; }
  function lineTo(x, a, b) { x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); }
  function extend(a, b, extL, extR, L, R) {
    var dx = b.x - a.x, dy = b.y - a.y, A = { x: a.x, y: a.y }, B = { x: b.x, y: b.y };
    if (!dx && !dy) return [A, B];
    if (extR) { var kR = (R - b.x) / (dx || 1e-9); if (dx) B = { x: R, y: b.y + dy * kR }; else B = { x: b.x, y: dy > 0 ? 1e5 : -1e5 }; }
    if (extL) { var kL = (L - a.x) / (dx || 1e-9); if (dx) A = { x: L, y: a.y + dy * kL }; else A = { x: a.x, y: dy > 0 ? -1e5 : 1e5 }; }
    return [A, B];
  }
  function dist2seg(px, py, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    if (!l2) return Math.hypot(px - a.x, py - a.y);
    var t = clamp(((px - a.x) * dx + (py - a.y) * dy) / l2, 0, 1);
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
  }
  function label(x, px, py, text, col, bg, align, fs) {
    if (!text) return;
    x.save();
    x.font = "600 " + (fs || 10) + "px ui-monospace,Menlo,monospace";
    x.textAlign = align || "left";
    var w2 = x.measureText(text).width, pal = P();
    if (bg !== false) {
      var bx = align === "right" ? px - w2 - 6 : align === "center" ? px - w2 / 2 - 3 : px - 1;
      x.fillStyle = bg || pal.tipBg;
      x.fillRect(bx, py - (fs || 10) - 2, w2 + 7, (fs || 10) + 6);
    }
    x.fillStyle = col || pal.textHi;
    x.fillText(text, px + (align === "left" ? 2 : 0), py);
    x.restore();
  }
  function arrowHead(x, a, b, size) {
    var ang = Math.atan2(b.y - a.y, b.x - a.x), s = size || 9;
    x.beginPath();
    x.moveTo(b.x, b.y);
    x.lineTo(b.x - s * Math.cos(ang - 0.38), b.y - s * Math.sin(ang - 0.38));
    x.lineTo(b.x - s * Math.cos(ang + 0.38), b.y - s * Math.sin(ang + 0.38));
    x.closePath(); x.fill();
  }
  function polyPath(x, pts, close) {
    x.beginPath();
    for (var i = 0; i < pts.length; i++) { if (!i) x.moveTo(pts[i].x, pts[i].y); else x.lineTo(pts[i].x, pts[i].y); }
    if (close) x.closePath();
  }
  function fillPoly(x, pts, col, alpha) {
    x.save(); polyPath(x, pts, true); x.globalAlpha = alpha; x.fillStyle = col; x.fill(); x.restore();
  }
  function hitPoly(pts, px, py, close) {
    var i, best = 1e9;
    for (i = 1; i < pts.length; i++) best = Math.min(best, dist2seg(px, py, pts[i - 1], pts[i]));
    if (close && pts.length > 2) best = Math.min(best, dist2seg(px, py, pts[pts.length - 1], pts[0]));
    return best;
  }
  function bbox(pts) {
    var x0 = Math.min(pts[0].x, pts[1].x), x1 = Math.max(pts[0].x, pts[1].x);
    var y0 = Math.min(pts[0].y, pts[1].y), y1 = Math.max(pts[0].y, pts[1].y);
    return { x0: x0, x1: x1, y0: y0, y1: y1, w: x1 - x0, h: y1 - y0 };
  }
  function hitBox(b, px, py) {
    var onEdge = Math.min(
      dist2seg(px, py, { x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }),
      dist2seg(px, py, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }),
      dist2seg(px, py, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }),
      dist2seg(px, py, { x: b.x0, y: b.y1 }, { x: b.x0, y: b.y0 }));
    return onEdge;
  }

  var FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618, 2, 2.618, 3.618, 4.236];
  var FIB_MAIN = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  var FIB_EXT = [0, 0.382, 0.618, 1, 1.272, 1.618, 2, 2.618];
  var GANN_ANGLES = [[1, 8], [1, 4], [1, 3], [1, 2], [1, 1], [2, 1], [3, 1], [4, 1], [8, 1]];

  /* ---- the tool table ---- */
  var TOOL = {};
  function T(id, o) { TOOL[id] = o; o.id = id; return o; }

  /* · cursors */
  T("cursor", { l: "Cross", g: "Cursors", n: -1, ic: "✛" });
  T("dot", { l: "Dot", g: "Cursors", n: -1, ic: "·" });
  T("arrowcur", { l: "Arrow", g: "Cursors", n: -1, ic: "↖" });
  T("eraser", { l: "Eraser", g: "Cursors", n: -1, ic: "⌫" });

  /* · lines */
  function lineRender(o, x, g, sc, opt) {
    var a = sxy(g, sc, o.pts[0]), b = o.pts[1] ? sxy(g, sc, o.pts[1]) : a;
    var e = extend(a, b, opt.extL || o.st.extL, opt.extR || o.st.extR, g.plotL, g.plotR);
    x.save(); x.strokeStyle = o.st.c; x.lineWidth = o.st.w; dash(x, o.st.dash);
    lineTo(x, e[0], e[1]); dash(x, 0);
    if (opt.head) { x.fillStyle = o.st.c; arrowHead(x, a, b, 10 + o.st.w * 2); }
    x.restore();
    if (opt.info) {
      var dp = o.pts[1].p - o.pts[0].p, pctv = o.pts[0].p ? dp / o.pts[0].p * 100 : 0;
      var nb = Math.round(g.iOf(o.pts[1].t) - g.iOf(o.pts[0].t));
      label(x, (a.x + b.x) / 2, (a.y + b.y) / 2 - 6, fmt(dp) + "  " + pctS(pctv) + "  " + nb + " bars", o.st.c, null, "center", o.st.fs);
    }
    if (opt.angle) {
      var ang = Math.atan2(a.y - b.y, b.x - a.x) * 180 / Math.PI;
      label(x, b.x + 6, b.y, ang.toFixed(1) + "°", o.st.c, null, "left", o.st.fs);
    }
    return e;
  }
  function lineHit(o, g, sc, px, py, opt) {
    var a = sxy(g, sc, o.pts[0]), b = o.pts[1] ? sxy(g, sc, o.pts[1]) : a;
    var e = extend(a, b, (opt && opt.extL) || o.st.extL, (opt && opt.extR) || o.st.extR, g.plotL, g.plotR);
    return dist2seg(px, py, e[0], e[1]);
  }
  T("trend", { l: "Trend line", g: "Lines", n: 2, ic: "╱", render: function (o, x, g, sc) { lineRender(o, x, g, sc, {}); }, hit: lineHit });
  T("ray", { l: "Ray", g: "Lines", n: 2, ic: "→", render: function (o, x, g, sc) { lineRender(o, x, g, sc, { extR: true }); }, hit: function (o, g, sc, px, py) { return lineHit(o, g, sc, px, py, { extR: true }); } });
  T("xline", { l: "Extended line", g: "Lines", n: 2, ic: "↔", render: function (o, x, g, sc) { lineRender(o, x, g, sc, { extL: true, extR: true }); }, hit: function (o, g, sc, px, py) { return lineHit(o, g, sc, px, py, { extL: true, extR: true }); } });
  T("arrowline", { l: "Arrow", g: "Lines", n: 2, ic: "➜", render: function (o, x, g, sc) { lineRender(o, x, g, sc, { head: true }); }, hit: lineHit });
  T("infoline", { l: "Info line", g: "Lines", n: 2, ic: "ℹ", render: function (o, x, g, sc) { lineRender(o, x, g, sc, { info: true }); }, hit: lineHit });
  T("angleline", { l: "Trend angle", g: "Lines", n: 2, ic: "∠", render: function (o, x, g, sc) { lineRender(o, x, g, sc, { angle: true }); }, hit: lineHit });
  T("hline", {
    l: "Horizontal line", g: "Lines", n: 1, ic: "─",
    render: function (o, x, g, sc) {
      var y = sc.y(o.pts[0].p);
      x.save(); x.strokeStyle = o.st.c; x.lineWidth = o.st.w; dash(x, o.st.dash);
      lineTo(x, { x: g.plotL, y: y }, { x: g.plotR, y: y }); dash(x, 0); x.restore();
      priceTag(x, g, y, o.st.txt || fmt(o.pts[0].p), o.st.c, "#0A0E20");
    },
    hit: function (o, g, sc, px, py) { return Math.abs(py - sc.y(o.pts[0].p)); }
  });
  T("hray", {
    l: "Horizontal ray", g: "Lines", n: 1, ic: "╌",
    render: function (o, x, g, sc) {
      var y = sc.y(o.pts[0].p), x0 = g.x(g.iOf(o.pts[0].t));
      x.save(); x.strokeStyle = o.st.c; x.lineWidth = o.st.w; dash(x, o.st.dash);
      lineTo(x, { x: x0, y: y }, { x: g.plotR, y: y }); dash(x, 0); x.restore();
      priceTag(x, g, y, o.st.txt || fmt(o.pts[0].p), o.st.c, "#0A0E20");
    },
    hit: function (o, g, sc, px, py) {
      var y = sc.y(o.pts[0].p), x0 = g.x(g.iOf(o.pts[0].t));
      return px < x0 - 4 ? 1e9 : Math.abs(py - y);
    }
  });
  T("vline", {
    l: "Vertical line", g: "Lines", n: 1, ic: "│",
    render: function (o, x, g, sc) {
      var x0 = g.x(g.iOf(o.pts[0].t));
      x.save(); x.strokeStyle = o.st.c; x.lineWidth = o.st.w; dash(x, o.st.dash);
      lineTo(x, { x: x0, y: PADT }, { x: x0, y: g.plotB }); dash(x, 0); x.restore();
      label(x, x0, g.plotB - 4, o.st.txt || stamp(o.pts[0].t, CFG.iv), o.st.c, null, "center", o.st.fs);
    },
    hit: function (o, g, sc, px) { return Math.abs(px - g.x(g.iOf(o.pts[0].t))); }
  });
  T("crossline", {
    l: "Cross line", g: "Lines", n: 1, ic: "✚",
    render: function (o, x, g, sc) {
      var x0 = g.x(g.iOf(o.pts[0].t)), y = sc.y(o.pts[0].p);
      x.save(); x.strokeStyle = o.st.c; x.lineWidth = o.st.w; dash(x, o.st.dash);
      lineTo(x, { x: x0, y: PADT }, { x: x0, y: g.plotB });
      lineTo(x, { x: g.plotL, y: y }, { x: g.plotR, y: y });
      dash(x, 0); x.restore();
      priceTag(x, g, y, fmt(o.pts[0].p), o.st.c, "#0A0E20");
    },
    hit: function (o, g, sc, px, py) {
      return Math.min(Math.abs(px - g.x(g.iOf(o.pts[0].t))), Math.abs(py - sc.y(o.pts[0].p)));
    }
  });

  /* · channels */
  T("pchan", {
    l: "Parallel channel", g: "Channels", n: 3, ic: "▱",
    render: function (o, x, g, sc) {
      var a = sxy(g, sc, o.pts[0]), b = sxy(g, sc, o.pts[1]), c3 = o.pts[2] ? sxy(g, sc, o.pts[2]) : b;
      var off = c3.y - (a.y + (b.y - a.y) * ((c3.x - a.x) / ((b.x - a.x) || 1e-9)));
      var a2 = { x: a.x, y: a.y + off }, b2 = { x: b.x, y: b.y + off };
      var e1 = extend(a, b, o.st.extL, o.st.extR, g.plotL, g.plotR), e2 = extend(a2, b2, o.st.extL, o.st.extR, g.plotL, g.plotR);
      fillPoly(x, [e1[0], e1[1], e2[1], e2[0]], o.st.c, o.st.fill);
      x.save(); x.strokeStyle = o.st.c; x.lineWidth = o.st.w; dash(x, o.st.dash);
      lineTo(x, e1[0], e1[1]); lineTo(x, e2[0], e2[1]);
      /* the median line every desk reads the middle of a channel from */
      lineTo(x, { x: e1[0].x, y: (e1[0].y + e2[0].y) / 2 }, { x: e1[1].x, y: (e1[1].y + e2[1].y) / 2 });
      dash(x, 0); x.restore();
    },
    hit: function (o, g, sc, px, py) {
      var a = sxy(g, sc, o.pts[0]), b = sxy(g, sc, o.pts[1]), c3 = o.pts[2] ? sxy(g, sc, o.pts[2]) : b;
      var off = c3.y - (a.y + (b.y - a.y) * ((c3.x - a.x) / ((b.x - a.x) || 1e-9)));
      return Math.min(dist2seg(px, py, a, b), dist2seg(px, py, { x: a.x, y: a.y + off }, { x: b.x, y: b.y + off }));
    }
  });
  T("flatchan", {
    l: "Flat top / bottom", g: "Channels", n: 3, ic: "⌷",
    render: function (o, x, g, sc) {
      var a = sxy(g, sc, o.pts[0]), b = sxy(g, sc, o.pts[1]), c3 = o.pts[2] ? sxy(g, sc, o.pts[2]) : b;
      var a2 = { x: a.x, y: c3.y }, b2 = { x: b.x, y: c3.y };
      fillPoly(x, [a, b, b2, a2], o.st.c, o.st.fill);
      x.save(); x.strokeStyle = o.st.c; x.lineWidth = o.st.w; dash(x, o.st.dash);
      lineTo(x, a, b); lineTo(x, a2, b2); dash(x, 0); x.restore();
    },
    hit: function (o, g, sc, px, py) {
      var a = sxy(g, sc, o.pts[0]), b = sxy(g, sc, o.pts[1]), c3 = o.pts[2] ? sxy(g, sc, o.pts[2]) : b;
      return Math.min(dist2seg(px, py, a, b), dist2seg(px, py, { x: a.x, y: c3.y }, { x: b.x, y: c3.y }));
    }
  });
  T("dischan", {
    l: "Disjoint channel", g: "Channels", n: 4, ic: "⌗",
    render: function (o, x, g, sc) {
      var p = o.pts.map(function (q) { return sxy(g, sc, q); });
      if (p.length < 4) p[3] = p[2] || p[1];
      fillPoly(x, [p[0], p[1], p[3], p[2]], o.st.c, o.st.fill);
      x.save(); x.strokeStyle = o.st.c; x.lineWidth = o.st.w; dash(x, o.st.dash);
      lineTo(x, p[0], p[1]); lineTo(x, p[2], p[3]); dash(x, 0); x.restore();
    },
    hit: function (o, g, sc, px, py) {
      var p = o.pts.map(function (q) { return sxy(g, sc, q); });
      return Math.min(dist2seg(px, py, p[0], p[1]), p[3] ? dist2seg(px, py, p[2], p[3]) : 1e9);
    }
  });
  T("regtrend", {
    l: "Regression trend", g: "Channels", n: 2, ic: "⩘",
    render: function (o, x, g, sc) {
      var i0 = Math.round(g.iOf(o.pts[0].t)), i1 = Math.round(g.iOf(o.pts[1].t)), lo = Math.min(i0, i1), hi = Math.max(i0, i1);
      lo = clamp(lo, 0, g.series.length - 1); hi = clamp(hi, 0, g.series.length - 1);
      if (hi - lo < 2) return;
      var n = hi - lo + 1, sx = 0, sy = 0, sxy2 = 0, sxx = 0, i, dev = 0;
      for (i = lo; i <= hi; i++) { var xx = i - lo, yy = g.series[i].c; sx += xx; sy += yy; sxy2 += xx * yy; sxx += xx * xx; }
      var den = n * sxx - sx * sx, m2 = den ? (n * sxy2 - sx * sy) / den : 0, b0 = (sy - m2 * sx) / n;
      for (i = lo; i <= hi; i++) { var f = m2 * (i - lo) + b0; dev += (g.series[i].c - f) * (g.series[i].c - f); }
      dev = Math.sqrt(dev / n) * 2;
      var A = { x: g.x(lo), y: sc.y(b0) }, B = { x: g.x(hi), y: sc.y(m2 * (hi - lo) + b0) };
      var A1 = { x: A.x, y: sc.y(b0 + dev) }, B1 = { x: B.x, y: sc.y(m2 * (hi - lo) + b0 + dev) };
      var A2 = { x: A.x, y: sc.y(b0 - dev) }, B2 = { x: B.x, y: sc.y(m2 * (hi - lo) + b0 - dev) };
      fillPoly(x, [A1, B1, B2, A2], o.st.c, o.st.fill * 0.6);
      x.save(); x.strokeStyle = o.st.c; x.lineWidth = o.st.w;
      lineTo(x, A, B); dash(x, 2); lineTo(x, A1, B1); lineTo(x, A2, B2); dash(x, 0); x.restore();
    },
    hit: function (o, g, sc, px, py) { return lineHit(o, g, sc, px, py, {}); }
  });
  T("pitchfork", {
    l: "Pitchfork", g: "Channels", n: 3, ic: "⑄",
    render: function (o, x, g, sc) {
      var p = o.pts.map(function (q) { return sxy(g, sc, q); });
      if (p.length < 3) return;
      var variant = o.st.variant || "andrews";
      var A = p[0], B = p[1], C3 = p[2];
      if (variant === "schiff") A = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
      if (variant === "mschiff") A = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
      var mid = { x: (B.x + C3.x) / 2, y: (B.y + C3.y) / 2 };
      var dx = mid.x - A.x, dy = mid.y - A.y, kk = (g.plotR - A.x) / (dx || 1e-9);
      function ray(from) {
        return { x: from.x + dx * kk, y: from.y + dy * kk };
      }
      x.save(); x.strokeStyle = o.st.c; x.lineWidth = o.st.w;
      var medEnd = ray(A), upEnd = ray(B), dnEnd = ray(C3);
      fillPoly(x, [B, upEnd, dnEnd, C3], o.st.c, o.st.fill * 0.5);
      lineTo(x, A, medEnd);
      dash(x, 0); lineTo(x, B, upEnd); lineTo(x, C3, dnEnd);
      dash(x, 2);
      /* the 0.5 / 0.25 / 0.75 internal rails a pitchfork is actually traded from */
      [[0.25, 0.25], [0.75, 0.75]].forEach(function (f) {
        var s0 = { x: B.x + (C3.x - B.x) * f[0], y: B.y + (C3.y - B.y) * f[0] };
        lineTo(x, s0, ray(s0));
      });
      dash(x, 0);
      lineTo(x, B, C3);
      x.restore();
    },
    hit: function (o, g, sc, px, py) {
      var p = o.pts.map(function (q) { return sxy(g, sc, q); });
      if (p.length < 3) return 1e9;
      return Math.min(dist2seg(px, py, p[0], { x: (p[1].x + p[2].x) / 2, y: (p[1].y + p[2].y) / 2 }), dist2seg(px, py, p[1], p[2]));
    }
  });

  /* · fibonacci */
  function fibLevels(o, x, g, sc, levels, vertical) {
    var a = sxy(g, sc, o.pts[0]), b = o.pts[1] ? sxy(g, sc, o.pts[1]) : a, i;
    var p0 = o.pts[0].p, p1 = (o.pts[1] || o.pts[0]).p, x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    if (o.st.extR) x1 = g.plotR;
    if (o.st.extL) x0 = g.plotL;
    x.save();
    for (i = 0; i < levels.length; i++) {
      var f = levels[i], pv = p1 + (p0 - p1) * f, yy = sc.y(pv);
      if (i && o.st.fill) {
        var prev = p1 + (p0 - p1) * levels[i - 1];
        x.globalAlpha = o.st.fill * 0.5;
        x.fillStyle = SERIES_COLORS[i % SERIES_COLORS.length];
        x.fillRect(x0, Math.min(yy, sc.y(prev)), x1 - x0, Math.abs(sc.y(prev) - yy));
        x.globalAlpha = 1;
      }
      x.strokeStyle = f === 0 || f === 1 ? o.st.c : SERIES_COLORS[i % SERIES_COLORS.length];
      x.lineWidth = f === 0 || f === 1 ? o.st.w : 1;
      dash(x, f === 0.5 ? 2 : 0);
      lineTo(x, { x: x0, y: yy }, { x: x1, y: yy });
      label(x, x0 + 4, yy - 3, (f * 100).toFixed(1) + "%  " + fmt(pv), x.strokeStyle, false, "left", o.st.fs - 1);
    }
    dash(x, 0);
    x.strokeStyle = o.st.c; x.lineWidth = 1; dash(x, 2);
    lineTo(x, a, b); dash(x, 0);
    x.restore();
  }
  T("fibret", {
    l: "Fib retracement", g: "Fibonacci", n: 2, ic: "⑁",
    render: function (o, x, g, sc) { fibLevels(o, x, g, sc, o.st.levels || FIB_MAIN); }, hit: lineHit
  });
  T("fibext", {
    l: "Trend-based Fib extension", g: "Fibonacci", n: 3, ic: "⑂",
    render: function (o, x, g, sc) {
      var p = o.pts.map(function (q) { return sxy(g, sc, q); });
      if (p.length < 3) { lineRender(o, x, g, sc, {}); return; }
      var d1 = o.pts[1].p - o.pts[0].p, base = o.pts[2].p, i;
      x.save();
      for (i = 0; i < FIB_EXT.length; i++) {
        var pv = base + d1 * FIB_EXT[i], yy = sc.y(pv);
        x.strokeStyle = SERIES_COLORS[i % SERIES_COLORS.length]; x.lineWidth = 1;
        lineTo(x, { x: p[2].x, y: yy }, { x: g.plotR, y: yy });
        label(x, p[2].x + 4, yy - 3, (FIB_EXT[i] * 100).toFixed(1) + "%  " + fmt(pv), x.strokeStyle, false, "left", o.st.fs - 1);
      }
      x.strokeStyle = o.st.c; x.lineWidth = o.st.w; dash(x, 2);
      polyPath(x, p, false); x.stroke(); dash(x, 0);
      x.restore();
    },
    hit: function (o, g, sc, px, py) { return hitPoly(o.pts.map(function (q) { return sxy(g, sc, q); }), px, py, false); }
  });
  T("fibfan", {
    l: "Fib speed/resistance fan", g: "Fibonacci", n: 2, ic: "⑀",
    render: function (o, x, g, sc) {
      var a = sxy(g, sc, o.pts[0]), b = sxy(g, sc, o.pts[1]), i;
      x.save();
      for (i = 0; i < FIB_MAIN.length; i++) {
        var f = FIB_MAIN[i], yy = b.y + (a.y - b.y) * f;
        var e = extend(a, { x: b.x, y: yy }, false, true, g.plotL, g.plotR);
        x.strokeStyle = SERIES_COLORS[i % SERIES_COLORS.length]; x.lineWidth = 1;
        lineTo(x, e[0], e[1]);
        label(x, b.x + 4, yy, (f * 100).toFixed(1) + "%", x.strokeStyle, false, "left", o.st.fs - 1);
      }
      x.strokeStyle = o.st.c; x.lineWidth = o.st.w; dash(x, 2); lineTo(x, a, b); dash(x, 0);
      x.restore();
    }, hit: lineHit
  });
  T("fibarc", {
    l: "Fib arcs", g: "Fibonacci", n: 2, ic: "◠",
    render: function (o, x, g, sc) {
      var a = sxy(g, sc, o.pts[0]), b = sxy(g, sc, o.pts[1]), R = Math.hypot(b.x - a.x, b.y - a.y), i;
      x.save();
      for (i = 1; i < FIB_MAIN.length; i++) {
        x.strokeStyle = SERIES_COLORS[i % SERIES_COLORS.length]; x.lineWidth = 1;
        x.beginPath(); x.arc(a.x, a.y, R * FIB_MAIN[i], 0, TAU); x.stroke();
      }
      x.strokeStyle = o.st.c; x.lineWidth = o.st.w; dash(x, 2); lineTo(x, a, b); dash(x, 0);
      x.restore();
    },
    hit: function (o, g, sc, px, py) {
      var a = sxy(g, sc, o.pts[0]), b = sxy(g, sc, o.pts[1]), R = Math.hypot(b.x - a.x, b.y - a.y);
      var dr = Math.abs(Math.hypot(px - a.x, py - a.y) - R);
      return Math.min(dr, dist2seg(px, py, a, b));
    }
  });
  T("fibcircle", {
    l: "Fib circles", g: "Fibonacci", n: 2, ic: "◎",
    render: function (o, x, g, sc) {
      var a = sxy(g, sc, o.pts[0]), b = sxy(g, sc, o.pts[1]), R = Math.hypot(b.x - a.x, b.y - a.y), i;
      x.save();
      for (i = 1; i < FIB_MAIN.length; i++) {
        x.strokeStyle = SERIES_COLORS[i % SERIES_COLORS.length]; x.lineWidth = 1;
        x.globalAlpha = 0.9;
        x.beginPath(); x.ellipse(a.x, a.y, R * FIB_MAIN[i], R * FIB_MAIN[i] * 0.62, 0, 0, TAU); x.stroke();
      }
      x.restore();
    },
    hit: function (o, g, sc, px, py) {
      var a = sxy(g, sc, o.pts[0]), b = sxy(g, sc, o.pts[1]), R = Math.hypot(b.x - a.x, b.y - a.y);
      return Math.abs(Math.hypot(px - a.x, (py - a.y) / 0.62) - R);
    }
  });
  T("fibtime", {
    l: "Fib time zones", g: "Fibonacci", n: 2, ic: "⑃",
    render: function (o, x, g, sc) {
      var i0 = g.iOf(o.pts[0].t), i1 = g.iOf(o.pts[1].t), span = i1 - i0, i;
      var seq = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
      x.save();
      for (i = 0; i < seq.length; i++) {
        var xx = g.x(i0 + span * seq[i]);
        if (xx < g.plotL || xx > g.plotR) continue;
        x.strokeStyle = SERIES_COLORS[i % SERIES_COLORS.length]; x.lineWidth = 1; dash(x, 2);
        lineTo(x, { x: xx, y: PADT }, { x: xx, y: g.plotB });
        label(x, xx + 3, PADT + 12, String(seq[i]), x.strokeStyle, false, "left", o.st.fs - 1);
      }
      dash(x, 0); x.restore();
    },
    hit: function (o, g, sc, px) { return Math.abs(px - g.x(g.iOf(o.pts[0].t))); }
  });
  T("fibchan", {
    l: "Fib channel", g: "Fibonacci", n: 3, ic: "⑅",
    render: function (o, x, g, sc) {
      var p = o.pts.map(function (q) { return sxy(g, sc, q); });
      if (p.length < 3) { lineRender(o, x, g, sc, {}); return; }
      var off = p[2].y - (p[0].y + (p[1].y - p[0].y) * ((p[2].x - p[0].x) / ((p[1].x - p[0].x) || 1e-9))), i;
      x.save();
      for (i = 0; i < FIB_MAIN.length; i++) {
        var f = FIB_MAIN[i];
        var A = { x: p[0].x, y: p[0].y + off * f }, B = { x: p[1].x, y: p[1].y + off * f };
        var e = extend(A, B, o.st.extL, true, g.plotL, g.plotR);
        x.strokeStyle = SERIES_COLORS[i % SERIES_COLORS.length]; x.lineWidth = 1;
        lineTo(x, e[0], e[1]);
        label(x, e[1].x - 4, e[1].y - 3, (f * 100).toFixed(1) + "%", x.strokeStyle, false, "right", o.st.fs - 1);
      }
      x.restore();
    },
    hit: function (o, g, sc, px, py) { return lineHit(o, g, sc, px, py, {}); }
  });

  /* · Gann */
  T("gannbox", {
    l: "Gann box", g: "Gann", n: 2, ic: "▦",
    render: function (o, x, g, sc) {
      var p = [sxy(g, sc, o.pts[0]), sxy(g, sc, o.pts[1])], b = bbox(p), i;
      var fr = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1];
      x.save(); x.lineWidth = 1;
      for (i = 0; i < fr.length; i++) {
        x.strokeStyle = SERIES_COLORS[i % SERIES_COLORS.length]; x.globalAlpha = 0.8;
        lineTo(x, { x: b.x0, y: b.y0 + b.h * fr[i] }, { x: b.x1, y: b.y0 + b.h * fr[i] });
        lineTo(x, { x: b.x0 + b.w * fr[i], y: b.y0 }, { x: b.x0 + b.w * fr[i], y: b.y1 });
      }
      x.globalAlpha = 1; x.strokeStyle = o.st.c; x.lineWidth = o.st.w;
      x.strokeRect(b.x0, b.y0, b.w, b.h);
      x.restore();
    },
    hit: function (o, g, sc, px, py) { return hitBox(bbox([sxy(g, sc, o.pts[0]), sxy(g, sc, o.pts[1])]), px, py); }
  });
  T("gannfan", {
    l: "Gann fan", g: "Gann", n: 2, ic: "⋰",
    render: function (o, x, g, sc) {
      var a = sxy(g, sc, o.pts[0]), b = sxy(g, sc, o.pts[1]), i;
      var dx = b.x - a.x, dy = b.y - a.y;
      x.save(); x.lineWidth = 1;
      for (i = 0; i < GANN_ANGLES.length; i++) {
        var r = GANN_ANGLES[i];
        var tgt = { x: a.x + (r[0] >= r[1] ? dx : dx * r[0] / r[1]), y: a.y + (r[1] >= r[0] ? dy : dy * r[1] / r[0]) };
        var e = extend(a, tgt, false, true, g.plotL, g.plotR);
        x.strokeStyle = r[0] === r[1] ? o.st.c : SERIES_COLORS[i % SERIES_COLORS.length];
        x.lineWidth = r[0] === r[1] ? o.st.w : 1;
        lineTo(x, e[0], e[1]);
        label(x, Math.min(e[1].x, g.plotR) - 4, e[1].y - 2, r[0] + "×" + r[1], x.strokeStyle, false, "right", o.st.fs - 2);
      }
      x.restore();
    }, hit: lineHit
  });
  T("gannsq", {
    l: "Gann square", g: "Gann", n: 2, ic: "◫",
    render: function (o, x, g, sc) {
      var p = [sxy(g, sc, o.pts[0]), sxy(g, sc, o.pts[1])], b = bbox(p);
      x.save(); x.strokeStyle = o.st.c; x.lineWidth = o.st.w;
      x.strokeRect(b.x0, b.y0, b.w, b.h);
      x.lineWidth = 1; x.strokeStyle = SERIES_COLORS[2];
      lineTo(x, { x: b.x0, y: b.y1 }, { x: b.x1, y: b.y0 });
      lineTo(x, { x: b.x0, y: b.y0 }, { x: b.x1, y: b.y1 });
      x.strokeStyle = SERIES_COLORS[5];
      lineTo(x, { x: b.x0, y: b.y0 + b.h / 2 }, { x: b.x1, y: b.y0 + b.h / 2 });
      lineTo(x, { x: b.x0 + b.w / 2, y: b.y0 }, { x: b.x0 + b.w / 2, y: b.y1 });
      x.restore();
    },
    hit: function (o, g, sc, px, py) { return hitBox(bbox([sxy(g, sc, o.pts[0]), sxy(g, sc, o.pts[1])]), px, py); }
  });

  /* · shapes */
  T("rect", {
    l: "Rectangle", g: "Shapes", n: 2, ic: "▭",
    render: function (o, x, g, sc) {
      var b = bbox([sxy(g, sc, o.pts[0]), sxy(g, sc, o.pts[1])]);
      x.save();
      x.globalAlpha = o.st.fill; x.fillStyle = o.st.c; x.fillRect(b.x0, b.y0, b.w, b.h); x.globalAlpha = 1;
      x.strokeStyle = o.st.c; x.lineWidth = o.st.w; dash(x, o.st.dash); x.strokeRect(b.x0, b.y0, b.w, b.h); dash(x, 0);
      if (o.st.txt) label(x, b.x0 + 4, b.y0 + o.st.fs + 2, o.st.txt, o.st.c, false, "left", o.st.fs);
      x.restore();
    },
    hit: function (o, g, sc, px, py) { return hitBox(bbox([sxy(g, sc, o.pts[0]), sxy(g, sc, o.pts[1])]), px, py); }
  });
  T("rotrect", {
    l: "Rotated rectangle", g: "Shapes", n: 3, ic: "◰",
    render: function (o, x, g, sc) {
      var p = o.pts.map(function (q) { return sxy(g, sc, q); });
      if (p.length < 3) { lineRender(o, x, g, sc, {}); return; }
      var dx = p[1].x - p[0].x, dy = p[1].y - p[0].y, L = Math.hypot(dx, dy) || 1;
      var nx = -dy / L, ny = dx / L, h = (p[2].x - p[1].x) * nx + (p[2].y - p[1].y) * ny;
      var q0 = p[0], q1 = p[1], q2 = { x: p[1].x + nx * h, y: p[1].y + ny * h }, q3 = { x: p[0].x + nx * h, y: p[0].y + ny * h };
      fillPoly(x, [q0, q1, q2, q3], o.st.c, o.st.fill);
      x.save(); x.strokeStyle = o.st.c; x.lineWidth = o.st.w; polyPath(x, [q0, q1, q2, q3], true); x.stroke(); x.restore();
    },
    hit: function (o, g, sc, px, py) { return hitPoly(o.pts.map(function (q) { return sxy(g, sc, q); }), px, py, true); }
  });
  T("ellipse", {
    l: "Ellipse", g: "Shapes", n: 2, ic: "⬭",
    render: function (o, x, g, sc) {
      var b = bbox([sxy(g, sc, o.pts[0]), sxy(g, sc, o.pts[1])]);
      x.save();
      x.beginPath(); x.ellipse(b.x0 + b.w / 2, b.y0 + b.h / 2, Math.max(1, b.w / 2), Math.max(1, b.h / 2), 0, 0, TAU);
      x.globalAlpha = o.st.fill; x.fillStyle = o.st.c; x.fill(); x.globalAlpha = 1;
      x.strokeStyle = o.st.c; x.lineWidth = o.st.w; dash(x, o.st.dash); x.stroke(); dash(x, 0);
      x.restore();
    },
    hit: function (o, g, sc, px, py) {
      var b = bbox([sxy(g, sc, o.pts[0]), sxy(g, sc, o.pts[1])]);
      var rx = Math.max(1, b.w / 2), ry = Math.max(1, b.h / 2);
      var nx = (px - (b.x0 + rx)) / rx, ny = (py - (b.y0 + ry)) / ry;
      return Math.abs(Math.hypot(nx, ny) - 1) * Math.min(rx, ry);
    }
  });
  T("circle", {
    l: "Circle", g: "Shapes", n: 2, ic: "◯",
    render: function (o, x, g, sc) {
      var a = sxy(g, sc, o.pts[0]), b = sxy(g, sc, o.pts[1]), R = Math.hypot(b.x - a.x, b.y - a.y);
      x.save(); x.beginPath(); x.arc(a.x, a.y, R, 0, TAU);
      x.globalAlpha = o.st.fill; x.fillStyle = o.st.c; x.fill(); x.globalAlpha = 1;
      x.strokeStyle = o.st.c; x.lineWidth = o.st.w; x.stroke(); x.restore();
    },
    hit: function (o, g, sc, px, py) {
      var a = sxy(g, sc, o.pts[0]), b = sxy(g, sc, o.pts[1]);
      return Math.abs(Math.hypot(px - a.x, py - a.y) - Math.hypot(b.x - a.x, b.y - a.y));
    }
  });
  T("tri", {
    l: "Triangle", g: "Shapes", n: 3, ic: "△",
    render: function (o, x, g, sc) {
      var p = o.pts.map(function (q) { return sxy(g, sc, q); });
      fillPoly(x, p, o.st.c, o.st.fill);
      x.save(); x.strokeStyle = o.st.c; x.lineWidth = o.st.w; polyPath(x, p, p.length > 2); x.stroke(); x.restore();
    },
    hit: function (o, g, sc, px, py) { return hitPoly(o.pts.map(function (q) { return sxy(g, sc, q); }), px, py, true); }
  });
  T("poly", {
    l: "Polyline", g: "Shapes", n: 0, ic: "⌇", multi: true,
    render: function (o, x, g, sc) {
      var p = o.pts.map(function (q) { return sxy(g, sc, q); });
      x.save(); x.strokeStyle = o.st.c; x.lineWidth = o.st.w; dash(x, o.st.dash); polyPath(x, p, false); x.stroke(); dash(x, 0); x.restore();
    },
    hit: function (o, g, sc, px, py) { return hitPoly(o.pts.map(function (q) { return sxy(g, sc, q); }), px, py, false); }
  });
  T("path", {
    l: "Path (closed)", g: "Shapes", n: 0, ic: "⬠", multi: true,
    render: function (o, x, g, sc) {
      var p = o.pts.map(function (q) { return sxy(g, sc, q); });
      fillPoly(x, p, o.st.c, o.st.fill);
      x.save(); x.strokeStyle = o.st.c; x.lineWidth = o.st.w; polyPath(x, p, true); x.stroke(); x.restore();
    },
    hit: function (o, g, sc, px, py) { return hitPoly(o.pts.map(function (q) { return sxy(g, sc, q); }), px, py, true); }
  });
  T("arc", {
    l: "Arc", g: "Shapes", n: 3, ic: "◡",
    render: function (o, x, g, sc) {
      var p = o.pts.map(function (q) { return sxy(g, sc, q); });
      if (p.length < 3) { lineRender(o, x, g, sc, {}); return; }
      x.save(); x.strokeStyle = o.st.c; x.lineWidth = o.st.w;
      x.beginPath(); x.moveTo(p[0].x, p[0].y); x.quadraticCurveTo(p[2].x, p[2].y, p[1].x, p[1].y); x.stroke(); x.restore();
    },
    hit: function (o, g, sc, px, py) { return hitPoly(o.pts.map(function (q) { return sxy(g, sc, q); }), px, py, false); }
  });
  T("curve", {
    l: "Curve", g: "Shapes", n: 3, ic: "∿",
    render: function (o, x, g, sc) {
      var p = o.pts.map(function (q) { return sxy(g, sc, q); });
      if (p.length < 3) { lineRender(o, x, g, sc, {}); return; }
      x.save(); x.strokeStyle = o.st.c; x.lineWidth = o.st.w; dash(x, o.st.dash);
      x.beginPath(); x.moveTo(p[0].x, p[0].y); x.quadraticCurveTo(p[2].x, p[2].y, p[1].x, p[1].y); x.stroke(); dash(x, 0); x.restore();
    },
    hit: function (o, g, sc, px, py) { return hitPoly(o.pts.map(function (q) { return sxy(g, sc, q); }), px, py, false); }
  });
  T("dcurve", {
    l: "Double curve", g: "Shapes", n: 4, ic: "≈",
    render: function (o, x, g, sc) {
      var p = o.pts.map(function (q) { return sxy(g, sc, q); });
      if (p.length < 4) { lineRender(o, x, g, sc, {}); return; }
      x.save(); x.strokeStyle = o.st.c; x.lineWidth = o.st.w;
      x.beginPath(); x.moveTo(p[0].x, p[0].y); x.bezierCurveTo(p[2].x, p[2].y, p[3].x, p[3].y, p[1].x, p[1].y); x.stroke(); x.restore();
    },
    hit: function (o, g, sc, px, py) { return hitPoly(o.pts.map(function (q) { return sxy(g, sc, q); }), px, py, false); }
  });
  T("brush", {
    l: "Brush", g: "Brushes", n: 0, ic: "✎", free: true,
    render: function (o, x, g, sc) {
      var p = o.pts.map(function (q) { return sxy(g, sc, q); });
      x.save(); x.strokeStyle = o.st.c; x.lineWidth = o.st.w + 0.8; x.lineJoin = "round"; x.lineCap = "round";
      polyPath(x, p, false); x.stroke(); x.restore();
    },
    hit: function (o, g, sc, px, py) { return hitPoly(o.pts.map(function (q) { return sxy(g, sc, q); }), px, py, false); }
  });
  T("highlight", {
    l: "Highlighter", g: "Brushes", n: 0, ic: "▬", free: true,
    render: function (o, x, g, sc) {
      var p = o.pts.map(function (q) { return sxy(g, sc, q); });
      x.save(); x.globalAlpha = 0.28; x.strokeStyle = o.st.c; x.lineWidth = o.st.w + 12; x.lineJoin = "round"; x.lineCap = "round";
      polyPath(x, p, false); x.stroke(); x.restore();
    },
    hit: function (o, g, sc, px, py) { return hitPoly(o.pts.map(function (q) { return sxy(g, sc, q); }), px, py, false) - 6; }
  });

  /* · annotations */
  function textRender(o, x, g, sc, opt) {
    var a = sxy(g, sc, o.pts[0]), txt = o.st.txt || "text", fs = o.st.fs || 12;
    x.save();
    x.font = "600 " + fs + "px Inter,system-ui,sans-serif";
    var w2 = x.measureText(txt).width, pad = 5;
    if (opt.box) {
      x.globalAlpha = 0.92; x.fillStyle = P().tipBg;
      x.fillRect(a.x, a.y - fs - pad, w2 + pad * 2, fs + pad * 2);
      x.globalAlpha = 1;
      x.strokeStyle = o.st.c; x.lineWidth = 1;
      x.strokeRect(a.x, a.y - fs - pad, w2 + pad * 2, fs + pad * 2);
    }
    if (opt.pin) {
      x.strokeStyle = o.st.c; x.lineWidth = o.st.w;
      lineTo(x, { x: a.x, y: a.y }, { x: a.x, y: a.y - 26 });
      x.fillStyle = o.st.c; x.beginPath(); x.arc(a.x, a.y, 3, 0, TAU); x.fill();
    }
    x.fillStyle = o.st.c;
    x.fillText(txt, a.x + (opt.box ? pad : 0), a.y - (opt.pin ? 30 : 0));
    x.restore();
    return { x: a.x, y: a.y, w: w2, h: fs };
  }
  function textHit(o, g, sc, px, py) {
    var a = sxy(g, sc, o.pts[0]), fs = o.st.fs || 12;
    var w2 = (o.st.txt || "text").length * fs * 0.58;
    return px >= a.x - 6 && px <= a.x + w2 + 10 && py >= a.y - fs - 10 && py <= a.y + 8 ? 0 : 1e9;
  }
  T("text", { l: "Text", g: "Annotations", n: 1, ic: "T", ask: true, render: function (o, x, g, sc) { textRender(o, x, g, sc, {}); }, hit: textHit });
  T("anchtext", { l: "Anchored text", g: "Annotations", n: 1, ic: "Tᴀ", ask: true, render: function (o, x, g, sc) { textRender(o, x, g, sc, { pin: true }); }, hit: textHit });
  T("note", { l: "Note", g: "Annotations", n: 1, ic: "🗒", ask: true, render: function (o, x, g, sc) { textRender(o, x, g, sc, { box: true }); }, hit: textHit });
  T("comment", { l: "Comment", g: "Annotations", n: 1, ic: "💬", ask: true, render: function (o, x, g, sc) { textRender(o, x, g, sc, { box: true, pin: true }); }, hit: textHit });
  T("callout", {
    l: "Callout", g: "Annotations", n: 2, ic: "🗨", ask: true,
    render: function (o, x, g, sc) {
      var a = sxy(g, sc, o.pts[0]), b = o.pts[1] ? sxy(g, sc, o.pts[1]) : a, txt = o.st.txt || "callout", fs = o.st.fs || 12;
      x.save();
      x.font = "600 " + fs + "px Inter,system-ui,sans-serif";
      var w2 = x.measureText(txt).width + 14, h2 = fs + 12;
      x.strokeStyle = o.st.c; x.lineWidth = o.st.w;
      lineTo(x, a, { x: b.x, y: b.y + h2 / 2 });
      x.globalAlpha = 0.94; x.fillStyle = P().tipBg;
      x.fillRect(b.x, b.y, w2, h2); x.globalAlpha = 1;
      x.strokeRect(b.x, b.y, w2, h2);
      x.fillStyle = o.st.c; x.fillText(txt, b.x + 7, b.y + fs + 3);
      x.fillStyle = o.st.c; x.beginPath(); x.arc(a.x, a.y, 3, 0, TAU); x.fill();
      x.restore();
    },
    hit: function (o, g, sc, px, py) {
      var b = o.pts[1] ? sxy(g, sc, o.pts[1]) : sxy(g, sc, o.pts[0]), fs = o.st.fs || 12;
      var w2 = (o.st.txt || "callout").length * fs * 0.6 + 14;
      return px >= b.x - 4 && px <= b.x + w2 && py >= b.y - 4 && py <= b.y + fs + 16 ? 0 : lineHit(o, g, sc, px, py, {});
    }
  });
  T("pricelabel", {
    l: "Price label", g: "Annotations", n: 1, ic: "🏷",
    render: function (o, x, g, sc) {
      var a = sxy(g, sc, o.pts[0]);
      x.save();
      x.fillStyle = o.st.c; x.beginPath(); x.arc(a.x, a.y, 3.4, 0, TAU); x.fill();
      label(x, a.x + 8, a.y + 4, (o.st.txt ? o.st.txt + "  " : "") + fmt(o.pts[0].p), "#0A0E20", o.st.c, "left", o.st.fs);
      x.restore();
    }, hit: function (o, g, sc, px, py) { var a = sxy(g, sc, o.pts[0]); return Math.hypot(px - a.x, py - a.y) - 6; }
  });
  T("signpost", {
    l: "Signpost", g: "Annotations", n: 1, ic: "⚐", ask: true,
    render: function (o, x, g, sc) {
      var a = sxy(g, sc, o.pts[0]), fs = o.st.fs || 11, txt = o.st.txt || "note";
      x.save();
      x.strokeStyle = o.st.c; x.lineWidth = o.st.w;
      lineTo(x, a, { x: a.x, y: a.y - 34 });
      x.font = "600 " + fs + "px Inter,system-ui,sans-serif";
      var w2 = x.measureText(txt).width + 12;
      x.fillStyle = o.st.c; x.fillRect(a.x, a.y - 34 - fs - 6, w2, fs + 8);
      x.fillStyle = "#0A0E20"; x.fillText(txt, a.x + 6, a.y - 34 - 3);
      x.restore();
    }, hit: textHit
  });
  T("flag", {
    l: "Flag mark", g: "Annotations", n: 1, ic: "⚑",
    render: function (o, x, g, sc) {
      var a = sxy(g, sc, o.pts[0]);
      x.save();
      x.strokeStyle = o.st.c; x.lineWidth = 1.4;
      lineTo(x, a, { x: a.x, y: a.y - 22 });
      x.fillStyle = o.st.c;
      x.beginPath(); x.moveTo(a.x, a.y - 22); x.lineTo(a.x + 15, a.y - 17); x.lineTo(a.x, a.y - 12); x.closePath(); x.fill();
      x.restore();
    }, hit: function (o, g, sc, px, py) { var a = sxy(g, sc, o.pts[0]); return Math.hypot(px - a.x, py - a.y + 16) - 10; }
  });
  T("sticker", {
    l: "Sticker", g: "Annotations", n: 1, ic: "★", ask: true,
    render: function (o, x, g, sc) {
      var a = sxy(g, sc, o.pts[0]), fs = (o.st.fs || 12) * 1.8;
      x.save(); x.font = fs + "px Inter,system-ui,sans-serif"; x.textAlign = "center";
      x.fillStyle = o.st.c;
      x.fillText(o.st.txt || "★", a.x, a.y);
      x.restore();
    }, hit: function (o, g, sc, px, py) { var a = sxy(g, sc, o.pts[0]); return Math.hypot(px - a.x, py - a.y) - 12; }
  });
  function arrowIcon(dir) {
    return function (o, x, g, sc) {
      var a = sxy(g, sc, o.pts[0]), s = 9 + o.st.w * 2;
      x.save(); x.fillStyle = o.st.c;
      var to = dir === "up" ? { x: a.x, y: a.y - s * 2 } : dir === "down" ? { x: a.x, y: a.y + s * 2 } :
        dir === "left" ? { x: a.x - s * 2, y: a.y } : { x: a.x + s * 2, y: a.y };
      x.strokeStyle = o.st.c; x.lineWidth = o.st.w + 0.6;
      lineTo(x, a, to);
      arrowHead(x, a, to, s);
      x.restore();
    };
  }
  T("arrowup", { l: "Arrow up", g: "Arrows", n: 1, ic: "⬆", render: arrowIcon("up"), hit: function (o, g, sc, px, py) { var a = sxy(g, sc, o.pts[0]); return Math.hypot(px - a.x, py - a.y + 12) - 10; } });
  T("arrowdown", { l: "Arrow down", g: "Arrows", n: 1, ic: "⬇", render: arrowIcon("down"), hit: function (o, g, sc, px, py) { var a = sxy(g, sc, o.pts[0]); return Math.hypot(px - a.x, py - a.y - 12) - 10; } });
  T("arrowleft", { l: "Arrow left", g: "Arrows", n: 1, ic: "⬅", render: arrowIcon("left"), hit: function (o, g, sc, px, py) { var a = sxy(g, sc, o.pts[0]); return Math.hypot(px - a.x + 12, py - a.y) - 10; } });
  T("arrowright", { l: "Arrow right", g: "Arrows", n: 1, ic: "➡", render: arrowIcon("right"), hit: function (o, g, sc, px, py) { var a = sxy(g, sc, o.pts[0]); return Math.hypot(px - a.x - 12, py - a.y) - 10; } });

  /* · measures and positions */
  T("pricerange", {
    l: "Price range", g: "Measure", n: 2, ic: "⇕",
    render: function (o, x, g, sc) {
      var a = sxy(g, sc, o.pts[0]), b = sxy(g, sc, o.pts[1]), dp = o.pts[1].p - o.pts[0].p;
      var pct2 = o.pts[0].p ? dp / o.pts[0].p * 100 : 0, up = dp >= 0, pal = P();
      x.save();
      x.globalAlpha = 0.14; x.fillStyle = up ? pal.up : pal.dn;
      x.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x) || 90, Math.abs(b.y - a.y));
      x.globalAlpha = 1;
      x.strokeStyle = up ? pal.up : pal.dn; x.lineWidth = 1.2;
      lineTo(x, { x: Math.min(a.x, b.x), y: a.y }, { x: Math.min(a.x, b.x) + (Math.abs(b.x - a.x) || 90), y: a.y });
      lineTo(x, { x: Math.min(a.x, b.x), y: b.y }, { x: Math.min(a.x, b.x) + (Math.abs(b.x - a.x) || 90), y: b.y });
      x.fillStyle = up ? pal.up : pal.dn;
      arrowHead(x, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, 8);
      label(x, (a.x + b.x) / 2, (a.y + b.y) / 2, fmt(dp) + "  (" + pctS(pct2) + ")", "#0A0E20", up ? pal.up : pal.dn, "center", o.st.fs);
      x.restore();
    }, hit: lineHit
  });
  T("daterange", {
    l: "Date range", g: "Measure", n: 2, ic: "⇔",
    render: function (o, x, g, sc) {
      var a = sxy(g, sc, o.pts[0]), b = sxy(g, sc, o.pts[1]);
      var nb = Math.abs(Math.round(g.iOf(o.pts[1].t) - g.iOf(o.pts[0].t))), pal = P();
      var yy = g.plotB - 26;
      x.save();
      x.globalAlpha = 0.12; x.fillStyle = pal.line;
      x.fillRect(Math.min(a.x, b.x), PADT, Math.abs(b.x - a.x), g.plotB - PADT); x.globalAlpha = 1;
      x.strokeStyle = pal.line; x.lineWidth = 1.2;
      lineTo(x, { x: a.x, y: PADT }, { x: a.x, y: g.plotB });
      lineTo(x, { x: b.x, y: PADT }, { x: b.x, y: g.plotB });
      x.fillStyle = pal.line;
      arrowHead(x, { x: a.x, y: yy }, { x: b.x, y: yy }, 8);
      var span = Math.abs(o.pts[1].t - o.pts[0].t), days = span / 864e5;
      label(x, (a.x + b.x) / 2, yy - 6, nb + " bars  ·  " + (days >= 1 ? days.toFixed(1) + "d" : (span / 36e5).toFixed(1) + "h"), "#0A0E20", pal.line, "center", o.st.fs);
      x.restore();
    },
    hit: function (o, g, sc, px) { return Math.min(Math.abs(px - g.x(g.iOf(o.pts[0].t))), Math.abs(px - g.x(g.iOf(o.pts[1].t)))); }
  });
  T("dprange", {
    l: "Date & price range", g: "Measure", n: 2, ic: "⤡",
    render: function (o, x, g, sc) {
      var a = sxy(g, sc, o.pts[0]), b = sxy(g, sc, o.pts[1]), b2 = bbox([a, b]);
      var dp = o.pts[1].p - o.pts[0].p, pct2 = o.pts[0].p ? dp / o.pts[0].p * 100 : 0;
      var nb = Math.abs(Math.round(g.iOf(o.pts[1].t) - g.iOf(o.pts[0].t))), up = dp >= 0, pal = P();
      x.save();
      x.globalAlpha = 0.14; x.fillStyle = up ? pal.up : pal.dn; x.fillRect(b2.x0, b2.y0, b2.w, b2.h); x.globalAlpha = 1;
      x.strokeStyle = up ? pal.up : pal.dn; x.lineWidth = 1.2; x.strokeRect(b2.x0, b2.y0, b2.w, b2.h);
      label(x, b2.x0 + b2.w / 2, b2.y0 + b2.h / 2, fmt(dp) + " (" + pctS(pct2) + ")  ·  " + nb + " bars", "#0A0E20", up ? pal.up : pal.dn, "center", o.st.fs);
      x.restore();
    },
    hit: function (o, g, sc, px, py) { return hitBox(bbox([sxy(g, sc, o.pts[0]), sxy(g, sc, o.pts[1])]), px, py); }
  });
  T("ruler", {
    l: "Measure", g: "Measure", n: 2, ic: "📏",
    render: function (o, x, g, sc) { TOOL.dprange.render(o, x, g, sc); }, hit: function (o, g, sc, px, py) { return TOOL.dprange.hit(o, g, sc, px, py); }
  });
  function posRender(long) {
    return function (o, x, g, sc) {
      var p = o.pts, a = sxy(g, sc, p[0]);
      var stopP = p[1] ? p[1].p : p[0].p * (long ? 0.98 : 1.02);
      var tgtP = p[2] ? p[2].p : p[0].p * (long ? 1.04 : 0.96);
      var x1 = p[1] ? g.x(g.iOf(p[1].t)) : a.x + 120, pal = P();
      var yE = a.y, yS = sc.y(stopP), yT = sc.y(tgtP);
      var x0 = Math.min(a.x, x1), xw = Math.abs(x1 - a.x) || 120;
      x.save();
      x.globalAlpha = 0.16; x.fillStyle = pal.dn;
      x.fillRect(x0, Math.min(yE, yS), xw, Math.abs(yS - yE));
      x.fillStyle = pal.up;
      x.fillRect(x0, Math.min(yE, yT), xw, Math.abs(yT - yE));
      x.globalAlpha = 1;
      x.strokeStyle = pal.faint; x.lineWidth = 1; dash(x, 2);
      lineTo(x, { x: x0, y: yE }, { x: x0 + xw, y: yE }); dash(x, 0);
      x.strokeStyle = pal.dn; lineTo(x, { x: x0, y: yS }, { x: x0 + xw, y: yS });
      x.strokeStyle = pal.up; lineTo(x, { x: x0, y: yT }, { x: x0 + xw, y: yT });
      var risk = Math.abs(p[0].p - stopP), rew = Math.abs(tgtP - p[0].p), rr = risk ? rew / risk : 0;
      label(x, x0 + 4, yE - 4, (long ? "LONG " : "SHORT ") + fmt(p[0].p), pal.textHi, null, "left", o.st.fs - 1);
      label(x, x0 + 4, yT + (yT < yE ? -4 : 12), "target " + fmt(tgtP) + "  (" + pctS((tgtP / p[0].p - 1) * 100) + ")", "#0A0E20", pal.up, "left", o.st.fs - 1);
      label(x, x0 + 4, yS + (yS < yE ? -4 : 12), "stop " + fmt(stopP) + "  (" + pctS((stopP / p[0].p - 1) * 100) + ")", "#0A0E20", pal.dn, "left", o.st.fs - 1);
      label(x, x0 + xw - 4, (yT + yS) / 2, "R:R " + rr.toFixed(2), "#0A0E20", "#FFD166", "right", o.st.fs - 1);
      x.restore();
    };
  }
  function posHit(o, g, sc, px, py) {
    var a = sxy(g, sc, o.pts[0]), x1 = o.pts[1] ? g.x(g.iOf(o.pts[1].t)) : a.x + 120;
    var yS = sc.y(o.pts[1] ? o.pts[1].p : o.pts[0].p), yT = sc.y(o.pts[2] ? o.pts[2].p : o.pts[0].p);
    var x0 = Math.min(a.x, x1), xw = Math.abs(x1 - a.x) || 120;
    if (px < x0 - 4 || px > x0 + xw + 4) return 1e9;
    return Math.min(Math.abs(py - a.y), Math.abs(py - yS), Math.abs(py - yT));
  }
  T("long", { l: "Long position", g: "Positions", n: 2, ic: "⇧", auto: "long", render: posRender(true), hit: posHit });
  T("short", { l: "Short position", g: "Positions", n: 2, ic: "⇩", auto: "short", render: posRender(false), hit: posHit });
  T("rr", { l: "Risk / reward", g: "Positions", n: 2, ic: "⚖", auto: "long", render: posRender(true), hit: posHit });
  T("forecast", {
    l: "Forecast", g: "Positions", n: 3, ic: "⤳",
    render: function (o, x, g, sc) {
      var p = o.pts.map(function (q) { return sxy(g, sc, q); }), pal = P();
      if (p.length < 3) { lineRender(o, x, g, sc, {}); return; }
      x.save();
      x.strokeStyle = pal.up; x.lineWidth = o.st.w; dash(x, 2);
      lineTo(x, p[0], p[1]); lineTo(x, p[1], p[2]); dash(x, 0);
      fillPoly(x, [p[0], p[1], p[2]], o.st.c, o.st.fill * 0.6);
      label(x, p[2].x + 4, p[2].y, "forecast " + fmt(o.pts[2].p), o.st.c, null, "left", o.st.fs - 1);
      x.restore();
    },
    hit: function (o, g, sc, px, py) { return hitPoly(o.pts.map(function (q) { return sxy(g, sc, q); }), px, py, false); }
  });
  T("projection", {
    l: "Projection", g: "Positions", n: 3, ic: "⟿",
    render: function (o, x, g, sc) {
      var p = o.pts.map(function (q) { return sxy(g, sc, q); });
      if (p.length < 3) { lineRender(o, x, g, sc, {}); return; }
      var dx = p[1].x - p[0].x, dy = p[1].y - p[0].y;
      var t2 = { x: p[2].x + dx, y: p[2].y + dy };
      x.save();
      x.strokeStyle = o.st.c; x.lineWidth = o.st.w;
      lineTo(x, p[0], p[1]);
      dash(x, 4); lineTo(x, p[2], t2); dash(x, 0);
      x.fillStyle = o.st.c; arrowHead(x, p[2], t2, 9);
      x.restore();
    },
    hit: function (o, g, sc, px, py) { return hitPoly(o.pts.map(function (q) { return sxy(g, sc, q); }), px, py, false); }
  });
  T("barspattern", {
    l: "Bars pattern", g: "Positions", n: 2, ic: "⋮⋮",
    render: function (o, x, g, sc) {
      var i0 = Math.round(g.iOf(o.pts[0].t)), i1 = Math.round(g.iOf(o.pts[1].t)), pal = P();
      var lo = clamp(Math.min(i0, i1), 0, g.series.length - 1), hi = clamp(Math.max(i0, i1), 0, g.series.length - 1);
      if (hi - lo < 1) return;
      /* the copied bars, re-anchored where the second point sits */
      var anchor = o.st.anchorIdx == null ? hi + 4 : o.st.anchorIdx, base = g.series[lo].c, shift = o.pts[1].p - base;
      var bw = Math.max(1, g.sp * 0.6), i;
      x.save(); x.globalAlpha = 0.75;
      for (i = lo; i <= hi; i++) {
        var b5 = g.series[i], cx = g.x(anchor + (i - lo)), up = b5.c >= b5.o;
        x.strokeStyle = up ? pal.up : pal.dn; x.fillStyle = up ? pal.upFill : pal.dnFill;
        x.beginPath(); x.moveTo(cx, sc.y(b5.h + shift)); x.lineTo(cx, sc.y(b5.l + shift)); x.stroke();
        var yo = sc.y(b5.o + shift), yc = sc.y(b5.c + shift);
        x.fillRect(cx - bw / 2, Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
      }
      x.restore();
    },
    hit: function (o, g, sc, px, py) { return lineHit(o, g, sc, px, py, {}); }
  });

  /* · patterns */
  function patternTool(id, l, labels, close, ic) {
    T(id, {
      l: l, g: "Patterns", n: labels.length, ic: ic || "△",
      render: function (o, x, g, sc) {
        var p = o.pts.map(function (q) { return sxy(g, sc, q); }), i;
        x.save();
        x.strokeStyle = o.st.c; x.lineWidth = o.st.w; dash(x, o.st.dash);
        polyPath(x, p, !!close && p.length === labels.length); x.stroke(); dash(x, 0);
        if (close && p.length === labels.length) { x.globalAlpha = o.st.fill; x.fillStyle = o.st.c; x.fill(); x.globalAlpha = 1; }
        for (i = 0; i < p.length && i < labels.length; i++) {
          label(x, p[i].x, p[i].y - 8, labels[i], "#0A0E20", o.st.c, "center", o.st.fs - 1);
        }
        x.restore();
      },
      hit: function (o, g, sc, px, py) { return hitPoly(o.pts.map(function (q) { return sxy(g, sc, q); }), px, py, !!close); }
    });
  }
  patternTool("xabcd", "XABCD pattern", ["X", "A", "B", "C", "D"], false, "Ⅹ");
  patternTool("cypher", "Cypher pattern", ["X", "A", "B", "C", "D"], false, "Ⅽ");
  patternTool("abcd", "ABCD pattern", ["A", "B", "C", "D"], false, "Ⓐ");
  patternTool("hns", "Head & shoulders", ["1", "2", "3", "4", "5", "6", "7"], false, "⌒");
  patternTool("tripattern", "Triangle pattern", ["1", "2", "3", "4"], true, "◺");
  patternTool("threedrives", "Three drives", ["1", "2", "3", "4", "5", "6", "7"], false, "Ⅲ");
  patternTool("ell5", "Elliott impulse (12345)", ["1", "2", "3", "4", "5", "⓸"], false, "⑤");
  patternTool("ell3", "Elliott correction (ABC)", ["A", "B", "C", "⓷"], false, "③");
  patternTool("ellTri", "Elliott triangle (ABCDE)", ["A", "B", "C", "D", "E", "⓹"], false, "⑃");
  patternTool("ellDouble", "Elliott double combo", ["W", "X", "Y", "⓶"], false, "Ⓦ");
  patternTool("ellTriple", "Elliott triple combo", ["W", "X", "Y", "X", "Z"], false, "Ⓩ");

  var TOOL_KEYS = Object.keys(TOOL);
  var TOOL_GROUPS = (function () {
    var seen = {}, out = [], i;
    for (i = 0; i < TOOL_KEYS.length; i++) {
      var t = TOOL[TOOL_KEYS[i]];
      if (!seen[t.g]) { seen[t.g] = { g: t.g, tools: [] }; out.push(seen[t.g]); }
      seen[t.g].tools.push(t);
    }
    return out;
  })();

  function drawAll(x, g) {
    if (CFG.draw.hide) return;
    var a = drawings(), i, sc = g.layout[0].sc;
    for (i = 0; i < a.length; i++) {
      var o = a[i], def = TOOL[o.tool];
      if (!def || !def.render || o.st.vis === false) continue;
      try { def.render(o, x, g, sc); } catch (e) { fault("draw:" + o.tool, e); }
      if (V.sel.indexOf(o.id) >= 0) handles(x, g, sc, o);
    }
    if (V.pending && V.pending.pts.length) {
      var pd = V.pending, pdef = TOOL[pd.tool];
      if (pdef && pdef.render && pd.pts.length >= Math.max(1, Math.min(2, pdef.n || 1))) {
        x.save(); x.globalAlpha = 0.85;
        try { pdef.render(pd, x, g, sc); } catch (e) { fault("draw:" + pd.tool, e); }
        x.restore();
      }
      handles(x, g, sc, pd);
    }
  }
  function handles(x, g, sc, o) {
    var i, pal = P();
    x.save();
    for (i = 0; i < o.pts.length; i++) {
      var p = sxy(g, sc, o.pts[i]);
      x.beginPath(); x.arc(p.x, p.y, 4, 0, TAU);
      x.fillStyle = o.st.lock ? pal.faint : pal.sel; x.fill();
      x.lineWidth = 1.4; x.strokeStyle = pal.bg; x.stroke();
    }
    x.restore();
  }
  function hitTest(g, px, py, tol) {
    var a = drawings(), i, best = null, bd = tol == null ? 7 : tol, sc = g.layout[0].sc;
    for (i = a.length - 1; i >= 0; i--) {
      var o = a[i], def = TOOL[o.tool];
      if (!def || !def.hit || o.st.vis === false || CFG.draw.hide) continue;
      var dd;
      try { dd = def.hit(o, g, sc, px, py); } catch (e) { dd = 1e9; fault("hit:" + o.tool, e); }
      if (dd <= bd) { best = o; bd = dd; }
    }
    return best;
  }
  function hitHandle(g, px, py) {
    var i, j, sc = g.layout[0].sc;
    for (i = 0; i < V.sel.length; i++) {
      var o = byId(V.sel[i]);
      if (!o || o.st.lock) continue;
      for (j = 0; j < o.pts.length; j++) {
        var p = sxy(g, sc, o.pts[j]);
        if (Math.hypot(px - p.x, py - p.y) <= 7) return { o: o, i: j };
      }
    }
    return null;
  }

  /* =====================================================================
     10 · THE FRAME + INTERACTION
     ===================================================================== */

  function mark() { V.dirty = true; frame(); }
  function frame() {
    if (V.raf) return;
    V.raf = W.requestAnimationFrame(function () { V.raf = 0; paint(); });
  }

  function replaySlice(bs) {
    if (!V.replay.on) return bs;
    var n = clamp(V.replay.i, 10, bs.length);
    return bs.slice(0, n);
  }

  function paint() {
    var c = cv(), h = host();
    if (!c || !h || !owns()) return;
    var rect = h.getBoundingClientRect();
    var W2 = Math.max(120, Math.round(rect.width)), H2 = Math.max(120, Math.round(rect.height));
    var dpr = Math.min(2, W.devicePixelRatio || 1);
    var BW = Math.round(W2 * dpr), BH = Math.round(H2 * dpr);
    if (c.width !== BW || c.height !== BH) { c.width = BW; c.height = BH; }
    var x = c.getContext("2d");
    if (!x) return;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    var pal = P();
    x.clearRect(0, 0, W2, H2);
    x.fillStyle = pal.bg;
    x.fillRect(0, 0, W2, H2);

    var src = source(), raw = bars();
    if (!raw.length) {
      drawEmpty(x, W2, H2, src.state === "loading" ? "Loading " + IV(CFG.iv).lbl + " candles…"
        : src.state === "err" ? "No venue has these candles right now — try another bar size." : "Waiting for market data…");
      load(false);
      legend(null);
      return;
    }
    var bs = replaySlice(raw);
    var g = geometry(bs, W2, H2);
    if (!g) { drawEmpty(x, W2, H2, "Not enough bars to draw " + typeLabel(CFG.type) + "."); return; }
    V.geo = g;

    watermark(x, g);
    var i;
    for (i = 0; i < g.layout.length; i++) drawGrid(x, g, g.layout[i]);
    /* the sub-pane zones (RSI 70/30 and the like) sit under everything */
    for (i = 1; i < g.layout.length; i++) {
      var pane = g.layout[i];
      if (!pane.zones) continue;
      x.save();
      for (var z = 0; z < pane.zones.length; z++) {
        var zz = pane.zones[z], y0 = pane.sc.y(zz[0]), y1 = pane.sc.y(zz[1]);
        x.globalAlpha = 0.06; x.fillStyle = P().line;
        x.fillRect(g.plotL, Math.min(y0, y1), g.plotW, Math.abs(y1 - y0));
      }
      x.restore();
    }
    /* pane separators */
    x.save();
    x.strokeStyle = P().axis; x.lineWidth = 1;
    for (i = 1; i < g.layout.length; i++) {
      var yy = Math.round(g.layout[i].top - 3) + 0.5;
      x.beginPath(); x.moveTo(g.plotL, yy); x.lineTo(g.plotR, yy); x.stroke();
    }
    x.restore();

    drawTimeAxis(x, g);
    if (g.rowsFor.length) drawRows(x, g, g.layout[0], g.rowsFor.filter(function (r) {
      var k = r.st.k;
      return k === "vp" || k === "pivots";
    }));
    drawPrice(x, g);
    drawCompare(x, g);
    if (g.rowsFor.length) drawRows(x, g, g.layout[0], g.rowsFor.filter(function (r) {
      var k = r.st.k;
      return !(k === "vp" || k === "pivots");
    }));
    for (i = 1; i < g.layout.length; i++) drawRows(x, g, g.layout[i], g.layout[i].rows || []);
    drawMarks(x, g);
    drawAll(x, g);
    if (V.replay.on) {
      x.save();
      var cut = g.x(bs.length - 1) + g.sp / 2;
      x.globalAlpha = 0.5; x.fillStyle = P().bg;
      if (cut < g.plotR) x.fillRect(cut, PADT, g.plotR - cut, g.plotB - PADT);
      x.globalAlpha = 1;
      x.strokeStyle = "#FFD166"; x.lineWidth = 1.4;
      x.beginPath(); x.moveTo(cut, PADT); x.lineTo(cut, g.plotB); x.stroke();
      x.restore();
    }
    drawCrosshair(x, g);
    /* the plot's own frame, last, so nothing paints over the panel edge */
    x.save();
    x.strokeStyle = P().axis; x.lineWidth = 1;
    x.beginPath(); x.moveTo(g.plotL + 0.5, PADT); x.lineTo(g.plotL + 0.5, g.plotB); x.stroke();
    x.restore();
    legend(g);
    load(false);
  }

  /* ---------------------------------------------------------- the legend */
  var LEG = null;
  function legend(g) {
    var box = d.getElementById("dxcLegend");
    if (!box) return;
    while (box.firstChild) box.removeChild(box.firstChild);
    var S = ST(), src = source();
    var i = g && V.cursor ? clamp(Math.round(g.idx(V.cursor.x)), 0, g.series.length - 1) : g ? g.series.length - 1 : 0;
    var b = g && g.series[i] ? g.series[i] : null;
    var pal = P();

    function row(cls) { var e = d.createElement("div"); e.className = "dxc-lrow " + (cls || ""); box.appendChild(e); return e; }
    function chip(parent, text, cls, colour) {
      var e = d.createElement("span");
      e.className = "dxc-chip " + (cls || "");
      e.textContent = text;
      if (colour) e.style.setProperty("--dxc-c", colour);
      parent.appendChild(e);
      return e;
    }
    var r1 = row("hd");
    chip(r1, (S.coin || "BTC") + " / " + (S.quote || "USDT"), "sym");
    chip(r1, IV(CFG.iv).id, "iv");
    chip(r1, typeLabel(CFG.type), "ty");
    chip(r1, src.src ? src.src : src.state === "loading" ? "loading…" : "—", "src");
    if (src.state === "err") chip(r1, "no candles", "bad");
    if (b) {
      var r2 = row("ohlc"), chg = b.o ? (b.c - b.o) / b.o * 100 : 0, up = b.c >= b.o;
      chip(r2, "O", "k"); chip(r2, fmt(b.o), up ? "up" : "dn");
      chip(r2, "H", "k"); chip(r2, fmt(b.h), up ? "up" : "dn");
      chip(r2, "L", "k"); chip(r2, fmt(b.l), up ? "up" : "dn");
      chip(r2, "C", "k"); chip(r2, fmt(b.c), up ? "up" : "dn");
      chip(r2, pctS(chg), up ? "up b" : "dn b");
      if (b.v) { chip(r2, "V", "k"); chip(r2, vol(b.v), "v"); }
      chip(r2, stamp(b.t, CFG.iv), "t");
    }
    /* one line per study, with its value at the cursor — the data window every
       terminal shows, without a second panel to look at */
    if (g) {
      var all = [], j;
      for (j = 0; j < g.rowsFor.length; j++) all.push(g.rowsFor[j]);
      for (j = 1; j < g.layout.length; j++) all = all.concat(g.layout[j].rows || []);
      for (j = 0; j < all.length; j++) {
        var st = all[j].st, r = all[j].r, def = stDef(st.k);
        if (!def) continue;
        var rr = row("st");
        rr.setAttribute("data-id", st.id);
        var nm = def.name.replace(/\s*\(.*\)$/, ""), ins = [], q;
        if (def.in) for (q = 0; q < def.in.length; q++) {
          var vv = st.p[def.in[q].k];
          if (vv != null && def.in[q].opts == null) ins.push(vv);
        }
        chip(rr, nm + (ins.length ? " " + ins.join(" ") : ""), "nm");
        for (q = 0; q < r.rows.length; q++) {
          var rw = r.rows[q], dat = rw.data;
          if (!dat || rw.kind === "vbars") continue;
          var v2 = dat[i];
          if (v2 == null || !isFinite(v2)) continue;
          chip(rr, r.fmt === "vol" ? vol(v2) : sig(v2), "val", rw.c || rw.up || pal.line);
        }
        if (r.rows.length === 1 && r.rows[0].kind === "vbars" && b) chip(rr, vol(b.v), "val", pal.text);
        var ex = d.createElement("button");
        ex.type = "button"; ex.className = "dxc-lx"; ex.title = "Settings for " + def.name;
        ex.setAttribute("aria-label", "Settings for " + def.name);
        ex.textContent = "⚙";
        ex.setAttribute("data-dxc", "st-settings"); ex.setAttribute("data-id", st.id);
        rr.appendChild(ex);
        var rm = d.createElement("button");
        rm.type = "button"; rm.className = "dxc-lx"; rm.title = "Remove " + def.name;
        rm.setAttribute("aria-label", "Remove " + def.name);
        rm.textContent = "✕";
        rm.setAttribute("data-dxc", "st-remove"); rm.setAttribute("data-id", st.id);
        rr.appendChild(rm);
      }
    }
    if (V.msg) { var rm2 = row("msg"); rm2.textContent = V.msg; }
  }

  /* ---------------------------------------------------------- magnet */
  function snapPrice(g, i, price, py) {
    var mode = CFG.draw.magnet;
    if (mode === "off" || !g.series[i]) return price;
    var b = g.series[i], sc = g.layout[0].sc;
    var cands = [b.o, b.h, b.l, b.c, (b.h + b.l) / 2], best = price, bd = 1e9, k;
    for (k = 0; k < cands.length; k++) {
      var dd = Math.abs(sc.y(cands[k]) - py);
      if (dd < bd) { bd = dd; best = cands[k]; }
    }
    if (mode === "strong") return best;
    return bd <= 14 ? best : price;
  }
  function ptAt(g, px, py, snap) {
    var idx = g.idx(px), i = clamp(Math.round(idx), 0, Math.max(0, g.series.length - 1));
    var sc = g.layout[0].sc, price = sc.v(py);
    if (snap !== false) price = snapPrice(g, i, price, py);
    return { t: g.t(snap === false ? idx : (CFG.draw.magnet === "strong" ? i : idx)), p: price };
  }

  /* ---------------------------------------------------------- tools */
  function setTool(id) {
    V.tool = id === V.tool && id !== "cursor" ? "cursor" : id;
    V.pending = null;
    syncRail();
    mark();
  }
  function commit(o) {
    pushUndo();
    drawings().push(o);
    saveDraws();
    V.pending = null;
    V.sel = [o.id];
    if (!CFG.draw.stay) V.tool = "cursor";
    syncRail(); styleBar(); mark();
  }
  function startOrExtend(g, px, py) {
    var def = TOOL[V.tool];
    if (!def || def.n === -1) return false;
    var p = ptAt(g, px, py);
    if (def.free) {
      V.pending = newObj(V.tool, [p], drawStyle());
      V.drag = { mode: "free" };
      return true;
    }
    if (!V.pending) {
      V.pending = newObj(V.tool, [p], drawStyle());
      if (def.ask) {
        var pend = V.pending;
        askText("", function (txt) {
          if (txt == null) { V.pending = null; mark(); return; }
          pend.st.txt = txt;
          if (def.n === 1) commit(pend); else mark();
        });
        if (def.n === 1) return true;
        V.pending.pts.push(p);
        V.drag = { mode: "place" };
        return true;
      }
      if (def.n === 1) { commit(V.pending); return true; }
      if (def.auto) {
        /* a position tool is created whole: entry here, stop and target one ATR away,
           so it is useful the moment it lands and every anchor is still draggable */
        var bs = g.series, a = last(M.atr(bs, 14)) || p.p * 0.01, longp = def.auto === "long";
        var t2 = g.t(clamp(g.iOf(p.t) + Math.max(6, Math.round(g.nvis * 0.18)), 0, g.series.length + 200));
        V.pending.pts = [p, { t: t2, p: longp ? p.p - a : p.p + a }, { t: t2, p: longp ? p.p + a * 2 : p.p - a * 2 }];
        commit(V.pending);
        return true;
      }
      V.pending.pts.push(p);      /* the provisional second point, moved by the pointer */
      V.drag = { mode: "place" };
      return true;
    }
    /* a click while placing fixes the current provisional point */
    var need = def.n;
    if (def.multi) {
      V.pending.pts.push(p);
      return true;
    }
    V.pending.pts[V.pending.pts.length - 1] = p;
    if (V.pending.pts.length >= need) { commit(V.pending); return true; }
    V.pending.pts.push(p);
    return true;
  }
  function drawStyle() {
    var s = LS.get("dl.dxc.style", null);
    return s || { c: "#00E5FF", w: 1.6, dash: 0, fill: 0.12, fs: 12 };
  }
  function rememberStyle(st) {
    LS.set("dl.dxc.style", { c: st.c, w: st.w, dash: st.dash, fill: st.fill, fs: st.fs });
  }

  /* ---------------------------------------------------------- pointer */
  var wired = false;
  function wire() {
    if (wired) return;
    var h = host();
    if (!h) return;
    wired = true;

    h.addEventListener("wheel", function (e) {
      if (!owns()) return;
      e.preventDefault();
      var g = V.geo;
      if (!g) return;
      var rect = h.getBoundingClientRect(), px = e.clientX - rect.left;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) {
        V.i0 += (e.deltaX || e.deltaY) > 0 ? Math.max(1, V.n * 0.04) : -Math.max(1, V.n * 0.04);
        mark(); return;
      }
      zoom(e.deltaY > 0 ? 1.16 : 0.862, clamp((px - g.plotL) / Math.max(1, g.plotW), 0, 1));
    }, { passive: false });

    var PTS = {}, pinch = null, nPts = 0;
    h.addEventListener("pointerdown", function (e) {
      if (!owns()) return;
      var g = V.geo;
      if (!g) return;
      var rect = h.getBoundingClientRect(), px = e.clientX - rect.left, py = e.clientY - rect.top;
      PTS[e.pointerId] = { x: e.clientX, y: e.clientY }; nPts++;
      try { h.setPointerCapture(e.pointerId); } catch (_) { }
      if (nPts === 2) { CH_pinch(); return; }

      /* the price axis: drag to stretch the scale, double-click to auto-fit */
      if (px > g.plotR) { V.drag = { mode: "yscale", y: py, lo: g.layout[0].sc.lo, hi: g.layout[0].sc.hi }; return; }
      if (py > g.plotB) { V.drag = { mode: "xscale", x: px, n: V.n }; return; }

      var tool = V.tool || "cursor";
      if (tool === "eraser") {
        var vic = hitTest(g, px, py, 9);
        if (vic) removeIds([vic.id]);
        return;
      }
      if (tool !== "cursor" && tool !== "dot" && tool !== "arrowcur") {
        if (startOrExtend(g, px, py)) { mark(); return; }
      }
      /* selection and moving */
      var hd = hitHandle(g, px, py);
      if (hd) { pushUndo(); V.drag = { mode: "anchor", o: hd.o, i: hd.i }; return; }
      var hit = hitTest(g, px, py);
      if (hit) {
        if (e.shiftKey) { if (V.sel.indexOf(hit.id) < 0) V.sel.push(hit.id); }
        else V.sel = [hit.id];
        styleBar();
        if (!hit.st.lock && !CFG.draw.lock) {
          pushUndo();
          V.drag = { mode: "move", ids: V.sel.slice(), px: px, py: py, snap: JSON.stringify(V.sel.map(function (id) { return byId(id).pts; })) };
        }
        mark(); return;
      }
      if (V.sel.length) { V.sel = []; styleBar(); }
      V.drag = { mode: "pan", x: px, i0: V.i0 };
      mark();

      function CH_pinch() {
        V.drag = null;
        var a = [], k;
        for (k in PTS) if (Object.prototype.hasOwnProperty.call(PTS, k)) a.push(PTS[k]);
        if (a.length < 2) return;
        pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), n: V.n };
      }
    });

    h.addEventListener("pointermove", function (e) {
      if (!owns()) return;
      var g = V.geo, rect = h.getBoundingClientRect();
      var px = e.clientX - rect.left, py = e.clientY - rect.top;
      if (PTS[e.pointerId]) PTS[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (pinch && nPts >= 2) {
        var a = [], k;
        for (k in PTS) if (Object.prototype.hasOwnProperty.call(PTS, k)) a.push(PTS[k]);
        if (a.length >= 2) {
          var dd = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
          if (dd > 4 && pinch.d > 4) {
            var f = pinch.d / dd;
            V.n = clamp(Math.round(pinch.n * f), 6, (V.geo ? V.geo.n : 400) + 400);
            mark();
          }
        }
        return;
      }
      if (!g) return;
      V.cursor = { x: px, y: py };
      var dr = V.drag;
      if (dr) {
        if (dr.mode === "pan") {
          V.i0 = dr.i0 - (px - dr.x) / Math.max(0.6, g.sp);
          V.i0 = clamp(V.i0, -CFG.bars.right, Math.max(0, g.n - 2));
        } else if (dr.mode === "yscale") {
          var mid = (dr.lo + dr.hi) / 2, half = (dr.hi - dr.lo) / 2;
          var f2 = clamp(1 + (py - dr.y) / 180, 0.2, 5);
          V.yman[0] = { lo: mid - half * f2, hi: mid + half * f2 };
        } else if (dr.mode === "xscale") {
          V.n = clamp(Math.round(dr.n * (1 + (dr.x - px) / 260)), 6, g.n + 400);
        } else if (dr.mode === "anchor") {
          dr.o.pts[dr.i] = ptAt(g, px, py);
          saveDraws();
        } else if (dr.mode === "move") {
          var base = JSON.parse(dr.snap), i, j;
          var dIdx = (px - dr.px) / Math.max(0.6, g.sp);
          for (i = 0; i < dr.ids.length; i++) {
            var o = byId(dr.ids[i]);
            if (!o) continue;
            for (j = 0; j < o.pts.length; j++) {
              var bp = base[i][j], bi = g.iOf(bp.t), sc = g.layout[0].sc;
              var y0 = sc.y(bp.p) + (py - dr.py);
              o.pts[j] = { t: g.t(bi + dIdx), p: sc.v(y0) };
            }
          }
          saveDraws();
        } else if (dr.mode === "free" && V.pending) {
          V.pending.pts.push(ptAt(g, px, py, false));
        } else if (dr.mode === "place" && V.pending) {
          V.pending.pts[V.pending.pts.length - 1] = ptAt(g, px, py);
        }
        mark();
        return;
      }
      if (V.pending && !V.pending.st.__await) {
        var def = TOOL[V.pending.tool];
        if (def && !def.free && V.pending.pts.length) V.pending.pts[V.pending.pts.length - 1] = ptAt(g, px, py);
      }
      mark();
    });

    function up(e) {
      if (e && e.pointerId != null && PTS[e.pointerId]) { delete PTS[e.pointerId]; nPts = Math.max(0, nPts - 1); }
      if (nPts < 2) pinch = null;
      var dr = V.drag;
      V.drag = null;
      if (!dr) return;
      if (dr.mode === "free" && V.pending) {
        if (V.pending.pts.length > 2) commit(V.pending); else { V.pending = null; mark(); }
        return;
      }
      if (dr.mode === "place" && V.pending) {
        var def = TOOL[V.pending.tool], g = V.geo;
        if (def && g) {
          var movedEnough = V.pending.pts.length >= 2 &&
            Math.abs(g.x(g.iOf(V.pending.pts[0].t)) - g.x(g.iOf(last(V.pending.pts).t))) +
            Math.abs(g.layout[0].sc.y(V.pending.pts[0].p) - g.layout[0].sc.y(last(V.pending.pts).p)) > 6;
          if (movedEnough && V.pending.pts.length >= def.n) commit(V.pending);
          else mark();
        }
        return;
      }
      if (dr.mode === "anchor" || dr.mode === "move") { saveDraws(); mark(); }
    }
    h.addEventListener("pointerup", up);
    h.addEventListener("pointercancel", up);
    h.addEventListener("pointerleave", function () { V.cursor = null; mark(); });
    h.addEventListener("dblclick", function (e) {
      if (!owns()) return;
      var g = V.geo, rect = h.getBoundingClientRect(), px = e.clientX - rect.left, py = e.clientY - rect.top;
      if (!g) return;
      if (px > g.plotR) { V.yman[0] = null; mark(); return; }
      var hit = hitTest(g, px, py);
      if (hit && TOOL[hit.tool] && TOOL[hit.tool].ask) {
        askText(hit.st.txt || "", function (t) { if (t != null) { pushUndo(); hit.st.txt = t; saveDraws(); mark(); } });
        return;
      }
      if (V.pending && TOOL[V.pending.tool] && TOOL[V.pending.tool].multi && V.pending.pts.length > 1) { commit(V.pending); return; }
      fit();
    });
    h.addEventListener("contextmenu", function (e) {
      if (!owns()) return;
      var g = V.geo, rect = h.getBoundingClientRect(), px = e.clientX - rect.left, py = e.clientY - rect.top;
      if (!g) return;
      e.preventDefault();
      contextMenu(px, py, e.clientX, e.clientY);
    });

    d.addEventListener("keydown", keys);
  }

  function keys(e) {
    if (!owns()) return;
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    var k = e.key, meta = e.metaKey || e.ctrlKey;
    if (meta && (k === "z" || k === "Z")) { if (e.shiftKey) redo(); else undo(); e.preventDefault(); return; }
    if (meta && (k === "y" || k === "Y")) { redo(); e.preventDefault(); return; }
    if (k === "Escape") { V.pending = null; V.tool = "cursor"; V.sel = []; styleBar(); syncRail(); mark(); return; }
    if ((k === "Delete" || k === "Backspace") && V.sel.length) { removeIds(V.sel.slice()); e.preventDefault(); return; }
    if (e.altKey) {
      var map = { t: "trend", h: "hline", v: "vline", f: "fibret", r: "rect", p: "pchan", b: "brush", e: "ellipse", i: "infoline", l: "long", s: "short", c: "callout", x: "xabcd" };
      var id = map[String(k).toLowerCase()];
      if (id) { setTool(id); e.preventDefault(); return; }
    }
    if (k === "+" || k === "=") { zoom(0.85, 0.5); e.preventDefault(); return; }
    if (k === "-" || k === "_") { zoom(1.18, 0.5); e.preventDefault(); return; }
    if (k === "ArrowLeft") { V.i0 -= Math.max(1, V.n * 0.08); mark(); e.preventDefault(); return; }
    if (k === "ArrowRight") { V.i0 += Math.max(1, V.n * 0.08); mark(); e.preventDefault(); return; }
    if (k === "Home") { V.i0 = 0; mark(); e.preventDefault(); return; }
    if (k === "End") { realtime(); e.preventDefault(); return; }
    if (k === "m" || k === "M") { CFG.draw.magnet = CFG.draw.magnet === "off" ? "weak" : CFG.draw.magnet === "weak" ? "strong" : "off"; saveCfg(); syncRail(); mark(); return; }
    if (k === "?") { dlgHotkeys(); return; }
  }

  function zoom(f, anchor) {
    var g = V.geo;
    if (!g) return;
    var a = V.i0 + (anchor == null ? 0.5 : anchor) * V.n;
    V.n = clamp(Math.round(V.n * f), 6, g.n + 400);
    V.i0 = a - (anchor == null ? 0.5 : anchor) * V.n;
    V.i0 = clamp(V.i0, -CFG.bars.right, Math.max(0, g.n - 2));
    mark();
  }
  function realtime() {
    var g = V.geo;
    if (!g) { V.i0 = null; mark(); return; }
    V.i0 = Math.max(-CFG.bars.right, g.n - V.n + CFG.bars.right * 0.5);
    mark();
  }
  function fit() {
    V.yman[0] = null;
    var g = V.geo;
    if (g) { V.n = Math.min(g.n, Math.max(30, Math.floor(g.plotW / clamp(CFG.bars.spacing, 1.2, 60)))); V.i0 = Math.max(0, g.n - V.n); }
    else { V.n = null; V.i0 = null; }
    mark();
  }

  /* =====================================================================
     11 · CHROME — the toolbars, the HUD and the dialogs
     Every node is built with createElement and textContent — no innerHTML at
     all, so no feed or user string is ever parsed as markup. Positions travel
     as CSS custom properties, never as an inline style declaration.
     ===================================================================== */

  function el(tag, cls, text, attrs) {
    var e = d.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    return e;
  }
  function btn(cls, text, title, attrs) {
    var b = el("button", cls, text, attrs || {});
    b.type = "button";
    if (title) { b.title = title; b.setAttribute("aria-label", title); }
    return b;
  }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }
  function at(node, px, py) {
    node.style.setProperty("--dxc-x", Math.round(px) + "px");
    node.style.setProperty("--dxc-y", Math.round(py) + "px");
  }

  /* ------------------------------------------------------------- the rail */
  function railHost() { return d.getElementById("dxcRail"); }
  function syncRail() {
    var r = railHost();
    if (!r) return;
    var bs = r.querySelectorAll("button[data-tool]"), i;
    for (i = 0; i < bs.length; i++) {
      var on = bs[i].getAttribute("data-tool") === (V.tool || "cursor");
      bs[i].classList.toggle("on", on);
      bs[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
    var mg = r.querySelector("[data-dxc='magnet']");
    if (mg) {
      mg.classList.toggle("on", CFG.draw.magnet !== "off");
      mg.textContent = CFG.draw.magnet === "strong" ? "🧲" : CFG.draw.magnet === "weak" ? "🧲" : "🧲";
      mg.title = "Magnet: " + CFG.draw.magnet + " (M)";
    }
    var sy = r.querySelector("[data-dxc='stay']");
    if (sy) sy.classList.toggle("on", !!CFG.draw.stay);
    var lk = r.querySelector("[data-dxc='lockall']");
    if (lk) lk.classList.toggle("on", !!CFG.draw.lock);
    var hd = r.querySelector("[data-dxc='hideall']");
    if (hd) hd.classList.toggle("on", !!CFG.draw.hide);
  }
  function buildRail(hostEl) {
    var r = el("div", "dxc-rail", null, { id: "dxcRail", role: "toolbar", "aria-label": "Drawing tools" });
    var fav = LS.get(K_FAV, ["cursor", "trend", "hline", "fibret", "rect", "long", "text", "brush"]);
    var i;
    /* the favourites, always one click away */
    for (i = 0; i < fav.length; i++) {
      var t = TOOL[fav[i]];
      if (!t) continue;
      r.appendChild(btn("dxc-t", t.ic, t.l, { "data-tool": t.id }));
    }
    r.appendChild(el("i", "dxc-sep"));
    /* every group behind its own flyout */
    for (i = 0; i < TOOL_GROUPS.length; i++) {
      var gr = TOOL_GROUPS[i];
      if (gr.g === "Cursors") continue;
      var b = btn("dxc-t grp", gr.tools[0].ic, gr.g, { "data-group": gr.g });
      r.appendChild(b);
    }
    r.appendChild(el("i", "dxc-sep"));
    r.appendChild(btn("dxc-t", "🧲", "Magnet (M)", { "data-dxc": "magnet" }));
    r.appendChild(btn("dxc-t", "⇥", "Stay in drawing mode", { "data-dxc": "stay" }));
    r.appendChild(btn("dxc-t", "🔒", "Lock all drawings", { "data-dxc": "lockall" }));
    r.appendChild(btn("dxc-t", "👁", "Hide all drawings", { "data-dxc": "hideall" }));
    r.appendChild(btn("dxc-t", "🗂", "Objects on this chart", { "data-dxc": "objects" }));
    r.appendChild(btn("dxc-t", "🗑", "Remove all drawings", { "data-dxc": "clearall" }));
    hostEl.appendChild(r);
    return r;
  }
  function flyout(groupName, anchorEl) {
    closeFly();
    var gr = null, i;
    for (i = 0; i < TOOL_GROUPS.length; i++) if (TOOL_GROUPS[i].g === groupName) gr = TOOL_GROUPS[i];
    if (!gr) return;
    var f = el("div", "dxc-fly", null, { id: "dxcFly", role: "menu", "aria-label": groupName });
    f.appendChild(el("div", "dxc-fly-h", groupName));
    for (i = 0; i < gr.tools.length; i++) {
      var t = gr.tools[i], row = btn("dxc-fly-i", null, t.l, { "data-tool": t.id, role: "menuitem" });
      row.appendChild(el("span", "ic", t.ic));
      row.appendChild(el("span", "lb", t.l));
      var star = el("span", "fv", "☆");
      star.setAttribute("data-fav", t.id);
      star.title = "Pin to the rail";
      row.appendChild(star);
      f.appendChild(row);
    }
    d.body.appendChild(f);
    var rect = anchorEl.getBoundingClientRect();
    at(f, rect.right + 6, clamp(rect.top, 8, Math.max(8, W.innerHeight - f.offsetHeight - 10)));
  }
  function closeFly() { var f = d.getElementById("dxcFly"); if (f && f.parentNode) f.parentNode.removeChild(f); }

  /* -------------------------------------------------------- the style bar */
  function styleBar() {
    var bar = d.getElementById("dxcStyle");
    if (!bar) return;
    if (!V.sel.length) { bar.classList.remove("on"); clear(bar); return; }
    var o = byId(V.sel[0]);
    if (!o) { bar.classList.remove("on"); clear(bar); return; }
    clear(bar);
    bar.classList.add("on");
    var def = TOOL[o.tool] || { l: o.tool };
    bar.appendChild(el("span", "dxc-sl", def.l));
    /* colour */
    var cols = ["#00E5FF", "#5B8CFF", "#22D39A", "#FFD166", "#FF8A5B", "#FF5A78", "#B36BFF", "#E7EDF8", "#7E8AB8"];
    var COLNAME = { "#00E5FF": "Cyan", "#5B8CFF": "Blue", "#22D39A": "Green", "#FFD166": "Amber", "#FF8A5B": "Orange", "#FF5A78": "Red", "#B36BFF": "Violet", "#E7EDF8": "White", "#7E8AB8": "Grey" };
    var cw = el("span", "dxc-cw");
    for (var i = 0; i < cols.length; i++) {
      /* v162 · the swatch's accessible name was the raw hex, read aloud as
         "hash 5 B 8 C F F". Name the colour instead. */
      var cb = btn("dxc-c" + (o.st.c === cols[i] ? " on" : ""), null, COLNAME[cols[i]] || cols[i], { "data-colour": cols[i] });
      cb.style.setProperty("--dxc-c", cols[i]);
      cw.appendChild(cb);
    }
    bar.appendChild(cw);
    /* width */
    var ws = [1, 1.6, 2.4, 3.6];
    for (i = 0; i < ws.length; i++) bar.appendChild(btn("dxc-sb" + (o.st.w === ws[i] ? " on" : ""), "▁".repeat(1), "Line width " + ws[i], { "data-w": String(ws[i]) }));
    bar.appendChild(btn("dxc-sb" + (o.st.dash === 0 ? " on" : ""), "──", "Solid", { "data-dash": "0" }));
    bar.appendChild(btn("dxc-sb" + (o.st.dash === 4 ? " on" : ""), "╌╌", "Dashed", { "data-dash": "4" }));
    bar.appendChild(btn("dxc-sb" + (o.st.dash === 2 ? " on" : ""), "┄┄", "Dotted", { "data-dash": "2" }));
    bar.appendChild(btn("dxc-sb", "◧", "Fill opacity", { "data-dxc": "fill" }));
    if (def.ask) bar.appendChild(btn("dxc-sb", "T", "Edit the text", { "data-dxc": "edit-text" }));
    if (o.tool === "trend" || o.tool === "ray" || o.tool === "xline" || o.tool === "pchan" || o.tool === "fibret" || o.tool === "fibchan") {
      bar.appendChild(btn("dxc-sb" + (o.st.extL ? " on" : ""), "⇤", "Extend left", { "data-dxc": "extL" }));
      bar.appendChild(btn("dxc-sb" + (o.st.extR ? " on" : ""), "⇥", "Extend right", { "data-dxc": "extR" }));
    }
    if (o.tool === "pitchfork") {
      bar.appendChild(btn("dxc-sb" + (o.st.variant === "schiff" ? " on" : ""), "S", "Schiff", { "data-variant": "schiff" }));
      bar.appendChild(btn("dxc-sb" + (o.st.variant === "mschiff" ? " on" : ""), "M", "Modified Schiff", { "data-variant": "mschiff" }));
      bar.appendChild(btn("dxc-sb" + (!o.st.variant || o.st.variant === "andrews" ? " on" : ""), "A", "Andrews", { "data-variant": "andrews" }));
    }
    bar.appendChild(el("i", "dxc-sep2"));
    bar.appendChild(btn("dxc-sb" + (o.st.lock ? " on" : ""), "🔒", "Lock", { "data-dxc": "lock" }));
    bar.appendChild(btn("dxc-sb", "⧉", "Clone", { "data-dxc": "clone" }));
    bar.appendChild(btn("dxc-sb", "⬆", "Bring to front", { "data-dxc": "front" }));
    bar.appendChild(btn("dxc-sb", "✕", "Delete", { "data-dxc": "del" }));
  }

  /* ------------------------------------------------------------ the HUD */
  function syncHud() {
    var hud = d.getElementById("dxcHud");
    if (!hud) return;
    var b = hud.querySelector("[data-dxc='log']");
    if (b) b.classList.toggle("on", CFG.scale.mode === "log");
    b = hud.querySelector("[data-dxc='pct']");
    if (b) b.classList.toggle("on", CFG.scale.mode === "percent");
    b = hud.querySelector("[data-dxc='inv']");
    if (b) b.classList.toggle("on", !!CFG.scale.invert);
    b = hud.querySelector("[data-dxc='replay']");
    if (b) b.classList.toggle("on", !!V.replay.on);
    var rp = hud.querySelector(".dxc-rp");
    if (rp) rp.classList.toggle("on", !!V.replay.on);
  }
  function buildHud(hostEl) {
    var hud = el("div", "dxc-hud", null, { id: "dxcHud" });
    var rp = el("span", "dxc-rp");
    rp.appendChild(btn("dxc-h", "⏮", "Step back one bar", { "data-dxc": "rp-back" }));
    rp.appendChild(btn("dxc-h", "⏯", "Play / pause the replay", { "data-dxc": "rp-play" }));
    rp.appendChild(btn("dxc-h", "⏭", "Step forward one bar", { "data-dxc": "rp-fwd" }));
    rp.appendChild(btn("dxc-h", "✕", "Leave bar replay", { "data-dxc": "rp-exit" }));
    hud.appendChild(rp);
    hud.appendChild(btn("dxc-h", "⏪", "Bar replay", { "data-dxc": "replay" }));
    hud.appendChild(btn("dxc-h", "log", "Logarithmic price scale", { "data-dxc": "log" }));
    hud.appendChild(btn("dxc-h", "%", "Percent scale", { "data-dxc": "pct" }));
    hud.appendChild(btn("dxc-h", "⇅", "Invert the scale", { "data-dxc": "inv" }));
    hud.appendChild(btn("dxc-h", "⤢", "Fit the data (double-click the chart)", { "data-dxc": "fit" }));
    hud.appendChild(btn("dxc-h", "⏩", "Scroll to the latest bar (End)", { "data-dxc": "rt" }));
    hud.appendChild(btn("dxc-h", "📷", "Save a PNG of the chart", { "data-dxc": "shot" }));
    hud.appendChild(btn("dxc-h", "⛶", "Fullscreen", { "data-dxc": "fs" }));
    hostEl.appendChild(hud);
  }

  /* -------------------------------------------------------- the top bar */
  function syncBar() {
    var bar = d.getElementById("dxcBar");
    if (!bar) return;
    var bs = bar.querySelectorAll("button[data-iv]"), i;
    for (i = 0; i < bs.length; i++) {
      var on = bs[i].getAttribute("data-iv") === CFG.iv;
      bs[i].classList.toggle("on", on);
      bs[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
    var lbl = bar.querySelector("[data-dxc='iv-more']");
    if (lbl) lbl.textContent = QUICK_IV.indexOf(CFG.iv) >= 0 ? "⋯" : CFG.iv;
    var ty = bar.querySelector("[data-dxc='type']");
    if (ty) ty.textContent = typeLabel(CFG.type);
    var nd = bar.querySelector("[data-count='ind']");
    if (nd) nd.textContent = String(CFG.studies.filter(function (s) { return s.on; }).length);
  }
  function buildBar() {
    var bar = d.getElementById("dxcBar");
    if (!bar) return;
    clear(bar);
    var seg = el("span", "dxc-seg");
    var i;
    for (i = 0; i < QUICK_IV.length; i++) seg.appendChild(btn("dxc-b", QUICK_IV[i], IV(QUICK_IV[i]).lbl, { "data-iv": QUICK_IV[i] }));
    seg.appendChild(btn("dxc-b", "⋯", "All bar sizes", { "data-dxc": "iv-more" }));
    bar.appendChild(seg);

    var seg2 = el("span", "dxc-seg");
    var tb = btn("dxc-b wide", typeLabel(CFG.type), "Chart type", { "data-dxc": "type" });
    seg2.appendChild(tb);
    bar.appendChild(seg2);

    var seg3 = el("span", "dxc-seg");
    var ib = btn("dxc-b wide", null, "Indicators, metrics and strategies", { "data-dxc": "ind" });
    ib.appendChild(el("span", null, "ƒ Indicators"));
    ib.appendChild(el("span", "dxc-n", String(CFG.studies.filter(function (s) { return s.on; }).length), { "data-count": "ind" }));
    seg3.appendChild(ib);
    seg3.appendChild(btn("dxc-b", "⊞", "Compare another market", { "data-dxc": "cmp" }));
    seg3.appendChild(btn("dxc-b", "🗂", "Objects on this chart", { "data-dxc": "objects" }));
    seg3.appendChild(btn("dxc-b", "❏", "Chart layouts and templates", { "data-dxc": "tpl" }));
    seg3.appendChild(btn("dxc-b", "⚙", "Chart settings", { "data-dxc": "settings" }));
    seg3.appendChild(btn("dxc-b", "?", "Keyboard shortcuts", { "data-dxc": "keys" }));
    bar.appendChild(seg3);
    syncBar();
  }

  /* -------------------------------------------------------- the dialogs */
  function modal(title, wide) {
    closeModal2();
    var back = el("div", "dxc-modal" + (wide ? " wide" : ""), null, { id: "dxcModal", role: "dialog", "aria-modal": "true", "aria-label": title });
    var sheet = el("div", "dxc-sheet");
    var head = el("div", "dxc-sh");
    head.appendChild(el("b", null, title));
    head.appendChild(btn("dxc-x", "✕", "Close", { "data-dxc": "close" }));
    sheet.appendChild(head);
    var body = el("div", "dxc-sb2");
    sheet.appendChild(body);
    back.appendChild(sheet);
    d.body.appendChild(back);
    return body;
  }
  function closeModal2() { var m = d.getElementById("dxcModal"); if (m && m.parentNode) m.parentNode.removeChild(m); }

  function fieldRow(parent, label2, node) {
    var r = el("label", "dxc-fr");
    r.appendChild(el("span", "dxc-fl", label2));
    r.appendChild(node);
    parent.appendChild(r);
    return r;
  }
  function inputNum(val, step) {
    var i = el("input", "dxc-in", null, { type: "number", step: step || "1", value: String(val) });
    i.value = String(val);
    return i;
  }
  function select(opts, val) {
    var s = el("select", "dxc-in"), i;
    for (i = 0; i < opts.length; i++) {
      var o = el("option", null, opts[i].l != null ? opts[i].l : opts[i], { value: opts[i].v != null ? opts[i].v : opts[i] });
      s.appendChild(o);
    }
    s.value = val;
    return s;
  }
  function checkbox(on) {
    var i = el("input", "dxc-ck", null, { type: "checkbox" });
    i.checked = !!on;
    return i;
  }

  function askText(initial, cb) {
    var body = modal("Text");
    var inp = el("input", "dxc-in wide", null, { type: "text", placeholder: "Type the label…" });
    inp.value = initial || "";
    body.appendChild(inp);
    var row = el("div", "dxc-row");
    var ok = btn("dxc-go", "Add", "Add");
    var no = btn("dxc-b", "Cancel", "Cancel");
    row.appendChild(ok); row.appendChild(no);
    body.appendChild(row);
    inp.focus();
    ok.addEventListener("click", function () { closeModal2(); cb(inp.value); });
    no.addEventListener("click", function () { closeModal2(); cb(null); });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { closeModal2(); cb(inp.value); }
      if (e.key === "Escape") { closeModal2(); cb(null); }
    });
  }

  function dlgIndicators() {
    var body = modal("Indicators, metrics and strategies", true);
    var search = el("input", "dxc-in wide", null, { type: "search", placeholder: "Search " + ST_KEYS.length + " studies…" });
    body.appendChild(search);
    var listBox = el("div", "dxc-list");
    body.appendChild(listBox);
    function render(q) {
      clear(listBox);
      var groups = {}, order = [], i;
      for (i = 0; i < ST_KEYS.length; i++) {
        var k = ST_KEYS[i], def = ST_DEF[k];
        if (q && def.name.toLowerCase().indexOf(q) < 0 && def.g.toLowerCase().indexOf(q) < 0) continue;
        if (!groups[def.g]) { groups[def.g] = []; order.push(def.g); }
        groups[def.g].push({ k: k, def: def });
      }
      for (i = 0; i < order.length; i++) {
        listBox.appendChild(el("div", "dxc-lg", order[i]));
        var arr = groups[order[i]];
        for (var j = 0; j < arr.length; j++) {
          var row = btn("dxc-li", null, "Add " + arr[j].def.name, { "data-add": arr[j].k });
          row.appendChild(el("span", "nm", arr[j].def.name));
          row.appendChild(el("span", "tg", arr[j].def.over ? "overlay" : "pane"));
          var has = CFG.studies.some(function (s) { return s.k === arr[j].k && s.on; });
          if (has) row.appendChild(el("span", "on", "on chart"));
          listBox.appendChild(row);
        }
      }
      if (!order.length) listBox.appendChild(el("div", "dxc-empty", "Nothing matches that."));
    }
    render("");
    search.addEventListener("input", function () { render(search.value.trim().toLowerCase()); });
    search.focus();
  }

  function addStudy(k) {
    var def = stDef(k);
    if (!def) return;
    var st = { id: uid(k), k: k, p: stDefaults(k), s: { c: SERIES_COLORS[CFG.studies.length % SERIES_COLORS.length], w: 1.4, dash: 0 }, on: true, pane: def.over ? 0 : CFG.studies.length + 1 };
    CFG.studies.push(st);
    saveCfg(); mark(); syncBar();
    return st;
  }
  function removeStudy(id) {
    var i;
    for (i = 0; i < CFG.studies.length; i++) if (CFG.studies[i].id === id) { CFG.studies.splice(i, 1); break; }
    saveCfg(); mark(); syncBar();
  }
  function studyById(id) {
    for (var i = 0; i < CFG.studies.length; i++) if (CFG.studies[i].id === id) return CFG.studies[i];
    return null;
  }
  function dlgStudy(id) {
    var st = studyById(id), def = st && stDef(st.k);
    if (!def) return;
    var body = modal(def.name);
    var i;
    for (i = 0; i < def.in.length; i++) {
      var f = def.in[i];
      if (f.opts) {
        var s = select(f.opts, st.p[f.k] == null ? f.d : st.p[f.k]);
        s.setAttribute("data-p", f.k);
        fieldRow(body, f.l, s);
      } else {
        var n = inputNum(st.p[f.k] == null ? f.d : st.p[f.k], f.step ? String(f.step) : "1");
        n.setAttribute("data-p", f.k);
        fieldRow(body, f.l, n);
      }
    }
    var col = el("span", "dxc-cw");
    var cols = SERIES_COLORS.concat(["#E7EDF8", "#7E8AB8"]);
    for (i = 0; i < cols.length; i++) {
      var cb = btn("dxc-c" + ((st.s && st.s.c) === cols[i] ? " on" : ""), null, cols[i], { "data-scolour": cols[i] });
      cb.style.setProperty("--dxc-c", cols[i]);
      col.appendChild(cb);
    }
    fieldRow(body, "Colour", col);
    var w = select([{ v: "1", l: "thin" }, { v: "1.4", l: "normal" }, { v: "2", l: "bold" }, { v: "3", l: "heavy" }], String((st.s && st.s.w) || 1.4));
    w.setAttribute("data-sw", "1");
    fieldRow(body, "Line width", w);
    var ds = select([{ v: "0", l: "solid" }, { v: "4", l: "dashed" }, { v: "2", l: "dotted" }], String((st.s && st.s.dash) || 0));
    ds.setAttribute("data-sdash", "1");
    fieldRow(body, "Line style", ds);
    if (!def.over) {
      var ph = inputNum(((CFG.paneH && CFG.paneH[st.pane]) || def.h || 0.15).toFixed(2), "0.01");
      ph.setAttribute("data-paneh", String(st.pane));
      fieldRow(body, "Pane height (0.06–0.42)", ph);
    }
    var row = el("div", "dxc-row");
    row.appendChild(btn("dxc-go", "Apply", "Apply", { "data-dxc": "st-apply", "data-id": id }));
    row.appendChild(btn("dxc-b", "Remove", "Remove", { "data-dxc": "st-remove", "data-id": id }));
    row.appendChild(btn("dxc-b", "Reset", "Reset to defaults", { "data-dxc": "st-reset", "data-id": id }));
    body.appendChild(row);
  }

  function dlgSettings() {
    var body = modal("Chart settings", true);
    var i;
    body.appendChild(el("div", "dxc-lg", "Price scale"));
    var mode = select([{ v: "linear", l: "Linear" }, { v: "log", l: "Logarithmic" }, { v: "percent", l: "Percent" }, { v: "indexed", l: "Indexed to 100" }], CFG.scale.mode);
    mode.setAttribute("data-set", "scale.mode");
    fieldRow(body, "Scale", mode);
    var inv = checkbox(CFG.scale.invert); inv.setAttribute("data-set", "scale.invert"); fieldRow(body, "Invert the scale", inv);
    var prec = select([{ v: "0", l: "automatic" }, { v: "2", l: "2 decimals" }, { v: "4", l: "4 decimals" }, { v: "6", l: "6 decimals" }, { v: "8", l: "8 decimals" }], String(CFG.look.prec || 0));
    prec.setAttribute("data-set", "look.prec"); fieldRow(body, "Price precision", prec);

    body.appendChild(el("div", "dxc-lg", "Bars and grid"));
    var sp = inputNum(CFG.bars.spacing, "0.5"); sp.setAttribute("data-set", "bars.spacing"); fieldRow(body, "Bar spacing (px)", sp);
    var ro = inputNum(CFG.bars.right, "1"); ro.setAttribute("data-set", "bars.right"); fieldRow(body, "Right margin (bars)", ro);
    var ck = [["look.grid", "Horizontal grid"], ["look.gridV", "Vertical grid"], ["look.wick", "Candle wicks"], ["look.border", "Candle borders"],
      ["look.mark", "Symbol watermark"], ["look.priceLine", "Live price line"], ["look.countdown", "Countdown to the bar close"],
      ["look.hlLines", "High and low of the visible range"], ["look.orders", "Working orders"], ["look.position", "Average entry"], ["look.alerts", "Price alerts"]];
    for (i = 0; i < ck.length; i++) {
      var path = ck[i][0], parts = path.split("."), cur = parts[0] === "look" ? CFG.look[parts[1]] : CFG.scale[parts[1]];
      var c2 = checkbox(cur); c2.setAttribute("data-set", path);
      fieldRow(body, ck[i][1], c2);
    }
    body.appendChild(el("div", "dxc-lg", "Renko, Kagi and Point & Figure"));
    var bm = select([{ v: "atr", l: "ATR" }, { v: "abs", l: "Absolute price" }, { v: "pct", l: "Percent" }], CFG.brickMode || "atr");
    bm.setAttribute("data-set", "brickMode"); fieldRow(body, "Brick size from", bm);
    var bv = inputNum(CFG.brickVal || 0, "0.01"); bv.setAttribute("data-set", "brickVal"); fieldRow(body, "Brick value (absolute / %)", bv);
    var ba = inputNum(CFG.brickAtr || 14, "1"); ba.setAttribute("data-set", "brickAtr"); fieldRow(body, "ATR length for the brick", ba);
    var lb = inputNum(CFG.lbN || 3, "1"); lb.setAttribute("data-set", "lbN"); fieldRow(body, "Line-break lines", lb);
    var kg = inputNum(CFG.kagiRev || 4, "0.5"); kg.setAttribute("data-set", "kagiRev"); fieldRow(body, "Kagi reversal %", kg);
    var pr = inputNum(CFG.pnfRev || 3, "1"); pr.setAttribute("data-set", "pnfRev"); fieldRow(body, "Point & Figure reversal (boxes)", pr);

    var row = el("div", "dxc-row");
    row.appendChild(btn("dxc-go", "Apply", "Apply", { "data-dxc": "set-apply" }));
    row.appendChild(btn("dxc-b", "Reset the chart", "Reset everything to defaults", { "data-dxc": "set-reset" }));
    body.appendChild(row);
  }

  function dlgTemplates() {
    var body = modal("Chart layouts and templates", true);
    var tpl = LS.get(K_TPL, {}) || {}, names = Object.keys(tpl), i;
    body.appendChild(el("div", "dxc-lg", "Saved layouts"));
    if (!names.length) body.appendChild(el("div", "dxc-empty", "No layout saved yet — save the current one below."));
    for (i = 0; i < names.length; i++) {
      var row = el("div", "dxc-li static");
      row.appendChild(el("span", "nm", names[i]));
      row.appendChild(btn("dxc-b", "Load", "Load " + names[i], { "data-tpl-load": names[i] }));
      row.appendChild(btn("dxc-b", "Delete", "Delete " + names[i], { "data-tpl-del": names[i] }));
      body.appendChild(row);
    }
    body.appendChild(el("div", "dxc-lg", "Save this layout"));
    var nm = el("input", "dxc-in wide", null, { type: "text", placeholder: "Layout name", id: "dxcTplName" });
    body.appendChild(nm);
    var row2 = el("div", "dxc-row");
    row2.appendChild(btn("dxc-go", "Save", "Save this layout", { "data-dxc": "tpl-save" }));
    body.appendChild(row2);
    body.appendChild(el("div", "dxc-lg", "Export / import"));
    var ta = el("textarea", "dxc-ta", JSON.stringify(CFG), { id: "dxcTplJson", spellcheck: "false" });
    body.appendChild(ta);
    var row3 = el("div", "dxc-row");
    row3.appendChild(btn("dxc-b", "Import from the box", "Import", { "data-dxc": "tpl-import" }));
    body.appendChild(row3);
  }

  function dlgObjects() {
    var body = modal("Objects on this chart", true);
    var a = drawings(), i;
    body.appendChild(el("div", "dxc-lg", a.length + " object" + (a.length === 1 ? "" : "s") + " on " + symKey()));
    if (!a.length) body.appendChild(el("div", "dxc-empty", "Nothing drawn yet. Pick a tool from the left rail."));
    for (i = a.length - 1; i >= 0; i--) {
      var o = a[i], def = TOOL[o.tool] || { l: o.tool, ic: "?" };
      var row = el("div", "dxc-li static" + (V.sel.indexOf(o.id) >= 0 ? " sel" : ""));
      row.appendChild(el("span", "ic", def.ic));
      var nm = el("span", "nm", def.l + (o.st.txt ? " · " + o.st.txt : ""));
      row.appendChild(nm);
      row.appendChild(el("span", "tg", fmt(o.pts[0].p)));
      row.appendChild(btn("dxc-b", o.st.vis === false ? "Show" : "Hide", "Toggle visibility", { "data-ob-vis": o.id }));
      row.appendChild(btn("dxc-b", o.st.lock ? "Unlock" : "Lock", "Toggle lock", { "data-ob-lock": o.id }));
      row.appendChild(btn("dxc-b", "Go", "Select and centre", { "data-ob-go": o.id }));
      row.appendChild(btn("dxc-b", "Delete", "Delete", { "data-ob-del": o.id }));
      body.appendChild(row);
    }
    var row2 = el("div", "dxc-row");
    row2.appendChild(btn("dxc-b", "Remove all", "Remove every drawing on this market", { "data-dxc": "clearall" }));
    body.appendChild(row2);
  }

  function dlgCompare() {
    var body = modal("Compare another market");
    body.appendChild(el("div", "dxc-lg", "On the chart"));
    var i;
    if (!CFG.cmp.length) body.appendChild(el("div", "dxc-empty", "Nothing compared yet."));
    for (i = 0; i < CFG.cmp.length; i++) {
      var row = el("div", "dxc-li static");
      row.appendChild(el("span", "nm", CFG.cmp[i] + " / USDT"));
      row.appendChild(btn("dxc-b", "Remove", "Remove " + CFG.cmp[i], { "data-cmp-del": CFG.cmp[i] }));
      body.appendChild(row);
    }
    body.appendChild(el("div", "dxc-lg", "Add a market"));
    var inp = el("input", "dxc-in wide", null, { type: "text", placeholder: "Symbol, e.g. ETH", id: "dxcCmpSym" });
    body.appendChild(inp);
    var quick = el("div", "dxc-row");
    var picks = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX"];
    for (i = 0; i < picks.length; i++) quick.appendChild(btn("dxc-b", picks[i], "Compare " + picks[i], { "data-cmp-add": picks[i] }));
    body.appendChild(quick);
    var row2 = el("div", "dxc-row");
    row2.appendChild(btn("dxc-go", "Add", "Add the symbol in the box", { "data-dxc": "cmp-add" }));
    body.appendChild(row2);
    body.appendChild(el("div", "dxc-note", "A compared market is rebased onto the first visible bar, so two assets of different prices can be read on one scale."));
  }

  function dlgTypes(anchorEl) {
    var body = modal("Chart type");
    var wrap = el("div", "dxc-list"), i;
    for (i = 0; i < TYPES.length; i++) {
      var row = btn("dxc-li" + (CFG.type === TYPES[i].id ? " sel" : ""), null, TYPES[i].l, { "data-type": TYPES[i].id });
      row.appendChild(el("span", "nm", TYPES[i].l));
      if (BRICKED[TYPES[i].id]) row.appendChild(el("span", "tg", "brick / reversal in settings"));
      wrap.appendChild(row);
    }
    body.appendChild(wrap);
  }
  function dlgIvs() {
    var body = modal("Bar size");
    var wrap = el("div", "dxc-list"), i;
    for (i = 0; i < IVS.length; i++) {
      var row = btn("dxc-li" + (CFG.iv === IVS[i].id ? " sel" : ""), null, IVS[i].lbl, { "data-iv": IVS[i].id });
      row.appendChild(el("span", "nm", IVS[i].lbl));
      row.appendChild(el("span", "tg", IVS[i].id));
      wrap.appendChild(row);
    }
    body.appendChild(wrap);
  }
  function dlgHotkeys() {
    var body = modal("Keyboard and pointer", true);
    var rows = [
      ["Wheel", "Zoom the time scale around the pointer"],
      ["Shift + wheel", "Scroll sideways"],
      ["Drag the chart", "Pan"],
      ["Drag the price axis", "Stretch the price scale · double-click it to auto-fit"],
      ["Drag the time axis", "Compress or expand the bars"],
      ["Double-click the chart", "Fit the data"],
      ["Right-click", "The chart menu (alerts, scale, snapshot)"],
      ["+ / −", "Zoom in / out"],
      ["← / →", "Pan one screen-eighth"],
      ["Home / End", "First bar / back to real time"],
      ["M", "Cycle the magnet: off → weak → strong"],
      ["Alt + T", "Trend line"], ["Alt + H", "Horizontal line"], ["Alt + V", "Vertical line"],
      ["Alt + F", "Fib retracement"], ["Alt + R", "Rectangle"], ["Alt + P", "Parallel channel"],
      ["Alt + B", "Brush"], ["Alt + E", "Ellipse"], ["Alt + I", "Info line"],
      ["Alt + L / Alt + S", "Long / short position"], ["Alt + C", "Callout"], ["Alt + X", "XABCD pattern"],
      ["Shift + click", "Add to the selection"],
      ["Ctrl/⌘ + Z", "Undo"], ["Ctrl/⌘ + Shift + Z", "Redo"],
      ["Delete", "Delete the selection"], ["Esc", "Cancel the tool and clear the selection"],
      ["?", "This list"]
    ];
    var t = el("table", "dxc-keys"), i;
    for (i = 0; i < rows.length; i++) {
      var tr = el("tr");
      tr.appendChild(el("th", null, rows[i][0]));
      tr.appendChild(el("td", null, rows[i][1]));
      t.appendChild(tr);
    }
    body.appendChild(t);
  }

  function contextMenu(px, py, cx, cy) {
    closeFly();
    var g = V.geo, hit = hitTest(g, px, py);
    var m = el("div", "dxc-fly", null, { id: "dxcFly", role: "menu" });
    var pane = paneAt(g, py), price = pane ? pane.sc.v(py) : 0;
    function item(label2, action, arg) {
      var b = btn("dxc-fly-i", null, label2, { role: "menuitem", "data-dxc": action });
      if (arg) b.setAttribute("data-id", arg);
      b.appendChild(el("span", "lb", label2));
      m.appendChild(b);
    }
    if (hit) {
      m.appendChild(el("div", "dxc-fly-h", TOOL[hit.tool] ? TOOL[hit.tool].l : hit.tool));
      V.sel = [hit.id]; styleBar();
      if (TOOL[hit.tool] && TOOL[hit.tool].ask) item("Edit the text", "edit-text");
      item(hit.st.lock ? "Unlock" : "Lock", "lock");
      item("Clone", "clone");
      item("Bring to front", "front");
      item("Delete", "del");
    } else {
      m.appendChild(el("div", "dxc-fly-h", fmt(price)));
      item("Add a price alert here", "alert-here", String(price));
      item("Draw a horizontal line here", "hline-here", String(price));
      item("Reset the price scale", "fit");
      item("Scroll back to real time", "rt");
      item(CFG.scale.mode === "log" ? "Linear scale" : "Logarithmic scale", "log");
      item("Save a PNG", "shot");
      item(CFG.draw.hide ? "Show the drawings" : "Hide the drawings", "hideall");
      item("Chart settings", "settings");
    }
    d.body.appendChild(m);
    at(m, clamp(cx, 8, Math.max(8, W.innerWidth - 220)), clamp(cy, 8, Math.max(8, W.innerHeight - 260)));
    mark();
  }

  /* ---------------------------------------------------------- snapshot */
  function snapshot() {
    var c = cv();
    if (!c) return;
    var S = ST(), name = "dexchart-" + (S.coin || "BTC") + (S.quote || "USDT") + "-" + CFG.iv + ".png";
    function give(url, revoke) {
      var a = el("a", null, null, { download: name, href: url });
      d.body.appendChild(a);
      a.click();
      if (a.parentNode) a.parentNode.removeChild(a);
      if (revoke) W.setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { } }, 4000);
      V.msg = "Chart saved as " + name;
      mark();
      W.setTimeout(function () { V.msg = ""; mark(); }, 4000);
    }
    if (c.toBlob) c.toBlob(function (b) { if (b) give(URL.createObjectURL(b), true); });
    else give(c.toDataURL("image/png"), false);
  }
  function fullscreen(on) {
    V.fs = on == null ? !V.fs : !!on;
    d.body.classList.toggle("dxc-fs", V.fs);
    W.setTimeout(function () { V.n = null; V.i0 = null; mark(); }, 60);
  }

  /* ---------------------------------------------------------- replay */
  var rpTimer = 0;
  function replayToggle(on) {
    var raw = bars();
    V.replay.on = on == null ? !V.replay.on : !!on;
    if (V.replay.on) {
      V.replay.i = V.replay.i && V.replay.i < raw.length ? V.replay.i : Math.max(30, Math.floor(raw.length * 0.7));
    } else { replayPlay(false); }
    syncHud(); mark();
  }
  function replayStep(k) {
    var raw = bars();
    V.replay.i = clamp(V.replay.i + k, 10, raw.length);
    if (V.replay.i >= raw.length) replayPlay(false);
    mark();
  }
  function replayPlay(on) {
    V.replay.play = on == null ? !V.replay.play : !!on;
    if (rpTimer) { W.clearInterval(rpTimer); rpTimer = 0; }
    if (V.replay.play && V.replay.on) {
      rpTimer = W.setInterval(function () {
        if (!owns() || !V.replay.on) { replayPlay(false); return; }
        replayStep(1);
      }, 420);
    }
    syncHud();
  }

  /* ------------------------------------------------------- the one click handler
     One listener on the document covers the rail, the bar, the HUD, the legend,
     the flyouts and the dialogs — no per-node handler to leak, and every target
     is addressed by a data attribute this file owns. */
  var clickWired = false;
  function wireClicks() {
    if (clickWired) return;
    clickWired = true;
    d.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      var fav = t.closest("[data-fav]");
      if (fav) {
        var list = LS.get(K_FAV, []) || [], id2 = fav.getAttribute("data-fav");
        if (list.indexOf(id2) < 0) list.push(id2);
        if (list.length > 14) list.shift();
        LS.set(K_FAV, list);
        var r = railHost();
        if (r && r.parentNode) { r.parentNode.removeChild(r); buildRail(host()); syncRail(); }
        closeFly();
        e.preventDefault();
        return;
      }
      var tool = t.closest("[data-tool]");
      if (tool) { setTool(tool.getAttribute("data-tool")); closeFly(); return; }
      var grp = t.closest("[data-group]");
      if (grp) { flyout(grp.getAttribute("data-group"), grp); return; }
      var iv = t.closest("[data-iv]");
      if (iv) { setInterval2(iv.getAttribute("data-iv")); closeModal2(); return; }
      var ty = t.closest("[data-type]");
      if (ty) { CFG.type = ty.getAttribute("data-type"); saveCfg(); syncBar(); closeModal2(); mark(); return; }
      var add = t.closest("[data-add]");
      if (add) { var s2 = addStudy(add.getAttribute("data-add")); closeModal2(); if (s2) dlgStudy(s2.id); return; }
      var col = t.closest("[data-colour]");
      if (col && V.sel.length) {
        pushUndo();
        for (var q = 0; q < V.sel.length; q++) { var o2 = byId(V.sel[q]); if (o2) o2.st.c = col.getAttribute("data-colour"); }
        var o3 = byId(V.sel[0]); if (o3) rememberStyle(o3.st);
        saveDraws(); styleBar(); mark(); return;
      }
      var sc2 = t.closest("[data-scolour]");
      if (sc2) {
        var dlg = t.closest(".dxc-sheet"), idA = dlg ? dlg.querySelector("[data-dxc='st-apply']") : null;
        var st2 = idA ? studyById(idA.getAttribute("data-id")) : null;
        if (st2) { st2.s = st2.s || {}; st2.s.c = sc2.getAttribute("data-scolour"); saveCfg(); mark(); dlgStudy(st2.id); }
        return;
      }
      var wq = t.closest("[data-w]");
      if (wq && V.sel.length) { applySel(function (o) { o.st.w = +wq.getAttribute("data-w"); }); return; }
      var dq = t.closest("[data-dash]");
      if (dq && V.sel.length) { applySel(function (o) { o.st.dash = +dq.getAttribute("data-dash"); }); return; }
      var vq = t.closest("[data-variant]");
      if (vq && V.sel.length) { applySel(function (o) { o.st.variant = vq.getAttribute("data-variant"); }); return; }

      var ob = t.closest("[data-ob-vis]");
      if (ob) { var oo = byId(ob.getAttribute("data-ob-vis")); if (oo) { pushUndo(); oo.st.vis = oo.st.vis === false; saveDraws(); mark(); dlgObjects(); } return; }
      ob = t.closest("[data-ob-lock]");
      if (ob) { var o4 = byId(ob.getAttribute("data-ob-lock")); if (o4) { pushUndo(); o4.st.lock = !o4.st.lock; saveDraws(); mark(); dlgObjects(); } return; }
      ob = t.closest("[data-ob-del]");
      if (ob) { removeIds([ob.getAttribute("data-ob-del")]); dlgObjects(); return; }
      ob = t.closest("[data-ob-go]");
      if (ob) {
        var o5 = byId(ob.getAttribute("data-ob-go")), g2 = V.geo;
        if (o5 && g2) { V.sel = [o5.id]; V.i0 = clamp(g2.iOf(o5.pts[0].t) - V.n / 2, -CFG.bars.right, Math.max(0, g2.n - 2)); }
        closeModal2(); styleBar(); mark(); return;
      }
      var tl = t.closest("[data-tpl-load]");
      if (tl) {
        var tpl = LS.get(K_TPL, {}) || {}, got = tpl[tl.getAttribute("data-tpl-load")];
        if (got) { CFG = mergeCfg(defCfg(), got); saveCfg(); CACHE = {}; V.n = null; V.i0 = null; buildBar(); syncHud(); mark(); }
        closeModal2(); return;
      }
      tl = t.closest("[data-tpl-del]");
      if (tl) { var tp2 = LS.get(K_TPL, {}) || {}; delete tp2[tl.getAttribute("data-tpl-del")]; LS.set(K_TPL, tp2); dlgTemplates(); return; }
      var ca = t.closest("[data-cmp-add]");
      if (ca) { addCmp(ca.getAttribute("data-cmp-add")); dlgCompare(); return; }
      var cd = t.closest("[data-cmp-del]");
      if (cd) {
        var sym = cd.getAttribute("data-cmp-del"), k2 = CFG.cmp.indexOf(sym);
        if (k2 >= 0) CFG.cmp.splice(k2, 1);
        saveCfg(); mark(); dlgCompare(); return;
      }

      var act = t.closest("[data-dxc]");
      if (!act) { if (!t.closest(".dxc-fly")) closeFly(); return; }
      var a2 = act.getAttribute("data-dxc");
      if (a2 === "close") { closeModal2(); return; }
      if (a2 === "iv-more") { dlgIvs(); return; }
      if (a2 === "type") { dlgTypes(act); return; }
      if (a2 === "ind") { dlgIndicators(); return; }
      if (a2 === "cmp") { dlgCompare(); return; }
      if (a2 === "objects") { dlgObjects(); return; }
      if (a2 === "tpl") { dlgTemplates(); return; }
      if (a2 === "settings") { dlgSettings(); return; }
      if (a2 === "keys") { dlgHotkeys(); return; }
      if (a2 === "st-settings") { dlgStudy(act.getAttribute("data-id")); return; }
      if (a2 === "st-remove") { removeStudy(act.getAttribute("data-id")); closeModal2(); return; }
      if (a2 === "st-reset") {
        var st3 = studyById(act.getAttribute("data-id"));
        if (st3) { st3.p = stDefaults(st3.k); saveCfg(); CACHE = {}; mark(); dlgStudy(st3.id); }
        return;
      }
      if (a2 === "st-apply") { applyStudyDialog(act.getAttribute("data-id")); return; }
      if (a2 === "set-apply") { applySettingsDialog(); return; }
      if (a2 === "set-reset") { CFG = defCfg(); saveCfg(); CACHE = {}; V.n = null; V.i0 = null; buildBar(); syncHud(); closeModal2(); mark(); return; }
      if (a2 === "tpl-save") {
        var nmEl = d.getElementById("dxcTplName"), nm2 = nmEl && nmEl.value.trim();
        if (nm2) { var tp3 = LS.get(K_TPL, {}) || {}; tp3[nm2] = JSON.parse(JSON.stringify(CFG)); LS.set(K_TPL, tp3); dlgTemplates(); }
        return;
      }
      if (a2 === "tpl-import") {
        var ta = d.getElementById("dxcTplJson");
        if (ta) {
          try {
            var got2 = JSON.parse(ta.value);
            CFG = mergeCfg(defCfg(), got2); saveCfg(); CACHE = {}; V.n = null; V.i0 = null;
            buildBar(); syncHud(); closeModal2(); mark();
          } catch (err) { V.msg = "That is not a layout this chart can read."; mark(); }
        }
        return;
      }
      if (a2 === "cmp-add") { var ip = d.getElementById("dxcCmpSym"); if (ip && ip.value.trim()) { addCmp(ip.value.trim().toUpperCase()); dlgCompare(); } return; }
      if (a2 === "magnet") { CFG.draw.magnet = CFG.draw.magnet === "off" ? "weak" : CFG.draw.magnet === "weak" ? "strong" : "off"; saveCfg(); syncRail(); return; }
      if (a2 === "stay") { CFG.draw.stay = !CFG.draw.stay; saveCfg(); syncRail(); return; }
      if (a2 === "lockall") { CFG.draw.lock = !CFG.draw.lock; saveCfg(); syncRail(); return; }
      if (a2 === "hideall") { CFG.draw.hide = !CFG.draw.hide; saveCfg(); syncRail(); closeFly(); mark(); return; }
      if (a2 === "clearall") {
        if (drawings().length) { pushUndo(); DRAWS[symKey()] = []; V.sel = []; saveDraws(); mark(); }
        closeModal2(); closeFly(); return;
      }
      if (a2 === "log") { CFG.scale.mode = CFG.scale.mode === "log" ? "linear" : "log"; saveCfg(); syncHud(); closeFly(); mark(); return; }
      if (a2 === "pct") { CFG.scale.mode = CFG.scale.mode === "percent" ? "linear" : "percent"; saveCfg(); syncHud(); mark(); return; }
      if (a2 === "inv") { CFG.scale.invert = !CFG.scale.invert; saveCfg(); syncHud(); mark(); return; }
      if (a2 === "fit") { fit(); closeFly(); return; }
      if (a2 === "rt") { realtime(); closeFly(); return; }
      if (a2 === "shot") { snapshot(); closeFly(); return; }
      if (a2 === "fs") { fullscreen(); return; }
      if (a2 === "replay") { replayToggle(); return; }
      if (a2 === "rp-play") { replayPlay(); return; }
      if (a2 === "rp-fwd") { replayStep(1); return; }
      if (a2 === "rp-back") { replayStep(-1); return; }
      if (a2 === "rp-exit") { replayToggle(false); return; }
      if (a2 === "edit-text") {
        var o6 = byId(V.sel[0]);
        if (o6) askText(o6.st.txt || "", function (txt) { if (txt != null) { pushUndo(); o6.st.txt = txt; saveDraws(); mark(); } });
        closeFly(); return;
      }
      if (a2 === "lock") { applySel(function (o) { o.st.lock = !o.st.lock; }); closeFly(); return; }
      if (a2 === "clone") {
        var o7 = byId(V.sel[0]);
        if (o7) {
          pushUndo();
          var cl = JSON.parse(JSON.stringify(o7));
          cl.id = uid("dx");
          var g3 = V.geo, shift = g3 ? (g3.t(g3.iOf(cl.pts[0].t) + Math.round(V.n * 0.06)) - cl.pts[0].t) : 0;
          cl.pts = cl.pts.map(function (p) { return { t: p.t + shift, p: p.p }; });
          drawings().push(cl); V.sel = [cl.id]; saveDraws(); styleBar(); mark();
        }
        closeFly(); return;
      }
      if (a2 === "front") {
        var o8 = byId(V.sel[0]), arr = drawings(), ix = arr.indexOf(o8);
        if (o8 && ix >= 0) { pushUndo(); arr.splice(ix, 1); arr.push(o8); saveDraws(); mark(); }
        closeFly(); return;
      }
      if (a2 === "del") { if (V.sel.length) removeIds(V.sel.slice()); closeFly(); return; }
      if (a2 === "fill") {
        applySel(function (o) { o.st.fill = o.st.fill >= 0.3 ? 0 : o.st.fill + 0.1; });
        return;
      }
      if (a2 === "alert-here") {
        var S2 = ST();
        if (typeof W.openAlertModal === "function") { try { W.openAlertModal(S2.coin); } catch (err2) { } }
        closeFly(); return;
      }
      if (a2 === "hline-here") {
        var g4 = V.geo, pr2 = +act.getAttribute("data-id");
        if (g4 && isNum(pr2)) {
          var o9 = newObj("hline", [{ t: g4.t(g4.n - 1), p: pr2 }], drawStyle());
          commit(o9);
        }
        closeFly(); return;
      }
    });
    d.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeModal2(); closeFly(); } });
  }
  function applySel(fn) {
    if (!V.sel.length) return;
    pushUndo();
    for (var i = 0; i < V.sel.length; i++) { var o = byId(V.sel[i]); if (o) fn(o); }
    var first = byId(V.sel[0]);
    if (first) rememberStyle(first.st);
    saveDraws(); styleBar(); mark();
  }
  function applyStudyDialog(id) {
    var st = studyById(id), sheet = d.querySelector("#dxcModal .dxc-sheet");
    if (!st || !sheet) return;
    var ins = sheet.querySelectorAll("[data-p]"), i;
    for (i = 0; i < ins.length; i++) {
      var k = ins[i].getAttribute("data-p"), v = ins[i].value;
      st.p[k] = ins[i].tagName === "SELECT" ? v : (isFinite(+v) ? +v : v);
    }
    var w = sheet.querySelector("[data-sw]"), ds = sheet.querySelector("[data-sdash]"), ph = sheet.querySelector("[data-paneh]");
    st.s = st.s || {};
    if (w) st.s.w = +w.value;
    if (ds) st.s.dash = +ds.value;
    if (ph) { CFG.paneH = CFG.paneH || {}; CFG.paneH[ph.getAttribute("data-paneh")] = clamp(+ph.value || 0.15, 0.06, 0.42); }
    saveCfg(); CACHE = {}; closeModal2(); mark();
  }
  function applySettingsDialog() {
    var sheet = d.querySelector("#dxcModal .dxc-sheet");
    if (!sheet) return;
    var ins = sheet.querySelectorAll("[data-set]"), i;
    for (i = 0; i < ins.length; i++) {
      var path = ins[i].getAttribute("data-set"), parts = path.split(".");
      var val = ins[i].type === "checkbox" ? ins[i].checked : (ins[i].tagName === "SELECT" ? ins[i].value : +ins[i].value);
      if (parts.length === 2) {
        if (!CFG[parts[0]]) CFG[parts[0]] = {};
        if (parts[0] === "look" && parts[1] === "prec") val = +val;
        CFG[parts[0]][parts[1]] = val;
      } else CFG[path] = val;
    }
    saveCfg(); CACHE = {}; V.n = null; V.i0 = null; syncHud(); buildBar(); closeModal2(); mark();
  }
  function addCmp(sym) {
    sym = String(sym || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!sym || CFG.cmp.indexOf(sym) >= 0) return;
    if (CFG.cmp.length >= 4) CFG.cmp.shift();
    CFG.cmp.push(sym);
    saveCfg(); loadCmp(sym); mark();
  }
  function setInterval2(id) {
    if (!IV(id) || CFG.iv === id) { CFG.iv = id; }
    CFG.iv = id;
    saveCfg();
    V.n = null; V.i0 = null; V.replay.on = false; replayPlay(false);
    CACHE = {};
    syncBar(); load(true); mark();
  }

  /* =====================================================================
     MOUNT + PUBLIC API
     ===================================================================== */

  function owns() {
    var S = ST();
    if (S.view !== "coin") return false;
    if (S.chartEngine === "tv") return false;
    var rp = d.getElementById("rpBar");
    if (rp && rp.parentNode && rp.getAttribute("data-dxc-off") !== "1") {
      /* the Time-machine replay desk owns the canvas while it is open */
      var cs = W.getComputedStyle ? W.getComputedStyle(rp) : null;
      if (cs && cs.display !== "none") return false;
    }
    return true;
  }

  function mount() {
    var h = host();
    if (!h) return false;
    if (h.getAttribute("data-dxc") === "1") { wire(); wireClicks(); return true; }
    h.setAttribute("data-dxc", "1");
    h.classList.add("dxc-on");
    buildRail(h);
    h.appendChild(el("div", "dxc-legend", null, { id: "dxcLegend", "aria-hidden": "true" }));
    h.appendChild(el("div", "dxc-stylebar", null, { id: "dxcStyle", role: "toolbar", "aria-label": "Selected drawing" }));
    buildHud(h);
    buildBar();
    syncRail(); syncHud();
    wire(); wireClicks();
    V.mounted = true;
    return true;
  }

  /* the payload calls this from drawCoinChart (see buildlib/dxc.py) */
  function draw() {
    if (!mount()) return;
    if (V.mkey !== mkey()) {
      /* a new market or bar size: drop the view, keep the drawings (they are per market) */
      V.mkey = mkey(); V.n = null; V.i0 = null; V.sel = []; V.yman = {};
      load(true);
    }
    mark();
  }
  function sync() {
    /* engine switch, replay open or close, day/night change */
    var h = host();
    if (!h) return;
    h.classList.toggle("dxc-idle", !owns());
    if (owns()) { mount(); mark(); }
  }

  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", function () { wireClicks(); });
  else wireClicks();

  return {
    __v: 160,
    owns: owns, draw: draw, sync: sync, mount: mount, paint: paint,
    cfg: function () { return CFG; },
    setInterval: setInterval2,
    setType: function (t) { CFG.type = t; saveCfg(); syncBar(); mark(); },
    addStudy: addStudy, removeStudy: removeStudy, studies: function () { return CFG.studies; },
    tools: function () { return TOOL_KEYS.slice(); },
    toolGroups: function () { return TOOL_GROUPS.map(function (g) { return { group: g.g, tools: g.tools.map(function (t) { return t.id; }) }; }); },
    indicators: function () { return ST_KEYS.slice(); },
    types: function () { return TYPES.map(function (t) { return t.id; }); },
    intervals: function () { return IVS.map(function (i) { return i.id; }); },
    setTool: setTool,
    /** place a drawing from code, through the same commit path a pointer uses
     *  (undo entry, per-market store, redraw): DXC.place('hline', [{t, p}]) */
    place: function (tool, pts, style) {
      if (!TOOL[tool] || TOOL[tool].n === -1 || !TOOL[tool].render || !Array.isArray(pts) || !pts.length) return null;
      var o = newObj(tool, pts.map(function (p) { return { t: +p.t, p: +p.p }; }), style);
      commit(o);
      return o.id;
    },
    drawings: drawings, clearDrawings: function () { pushUndo(); DRAWS[symKey()] = []; saveDraws(); mark(); },
    undo: undo, redo: redo, snapshot: snapshot, fullscreen: fullscreen,
    replay: replayToggle, replayStep: replayStep,
    math: M, geometry: function () { return V.geo; }, source: source, bars: bars,
    errors: function () { return ERRS.slice(); }, clearErrors: function () { ERRS.length = 0; },
    zoom: zoom, fit: fit, realtime: realtime
  };
})();
