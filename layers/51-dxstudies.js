/* ============================================================================
   DXSTUDIES · layer 51 — the indicators DexChart Pro did not ship with
   ----------------------------------------------------------------------------
   Layer 46 registered 65 studies. Measured against the built-in set of the
   terminal most crypto traders arrive from, sixty-eight were missing, and the
   gaps were not exotic: no Tillson T3, no Alligator, no WaveTrend, no funding
   rate, nothing at all under market structure. This layer closes that list.

   It edits nothing. Every study here goes in through DXC.registerStudy, which
   buildlib/dxc_open.py opened for exactly this purpose, so the cache, the pane
   layout, the legend, the indicator dialog and the settings sheet pick them up
   with no knowledge that a second file exists. The maths uses DXC.kit.M where
   the engine already has a formula and adds its own only where it does not —
   nothing here reimplements an EMA.

   THREE THINGS THIS FILE IS HONEST ABOUT
     · Cumulative Volume Delta is an APPROXIMATION. This rail carries OHLCV,
       not trades, so no bar says how much of its volume was bought into the
       ask. The split here is the close's position inside the bar's range, and
       the study is named and legended as that, not as delta.
     · The four derivatives studies are network studies. calc is synchronous,
       so the first call starts a fetch, caches the answer per symbol+period
       and returns a pane that says it is loading; the resolve fills the SAME
       rows object the engine cached and calls mark(). A symbol with no perp,
       or a request that fails, returns no series and says why. Nothing is
       filled in.
     · Relative Volume compares a bar with the same slot of earlier sessions
       only when the bar size divides a day. On daily bars and larger there is
       no same-slot to compare with, so it falls back to a plain rolling mean
       and the legend says which one is on screen.

   HOUSE RULES OBSERVED
     · one IIFE, ES5 only (var/function), idempotent, no dependencies
     · no innerHTML, no eval family, no string timers, no DOM writes at all
     · a value a window cannot support is null — never 0, never carried forward
     · colours are the engine's own SERIES_COLORS and palette; no new hex
     · every calc body is wrapped and routed through DXC.kit.fault
   ============================================================================ */
(function () {
  "use strict";

  var W = window;
  var DXC = W.DXC;
  /* Without the extension surface there is nothing to extend, and a half-loaded
     registry is worse than an absent one. Leave the page exactly as it was. */
  if (!DXC || typeof DXC.registerStudy !== "function" || !DXC.kit) return;
  if (W.DXSTUDIES && W.DXSTUDIES.__v) return;

  var K = DXC.kit;
  var M = K.M, line = K.line, num = K.num, SRC = K.SRC, CL = K.colors;
  var clamp = K.clamp, isNum = K.isNum, fault = K.fault, pal = K.pal, mark = K.mark;

  /* the engine's own series palette, named so the intent of each line reads */
  var C_BLUE = CL[0], C_GOLD = CL[1], C_UP = CL[2], C_DN = CL[3], C_VIOLET = CL[4],
    C_CYAN = CL[5], C_SAND = CL[6], C_MINT = CL[7], C_CORAL = CL[8], C_SKY = CL[9],
    C_MAGENTA = CL[10], C_TEAL = CL[11];

  var REG = [], REFUSED = [];
  function R(k, def) {
    if (DXC.registerStudy(k, def)) REG.push(k); else REFUSED.push(k);
  }
  /* Every calc runs inside this. The engine already catches a throw, but it then
     has nothing to draw and no idea which formula broke; routing it here names
     the study in DXC.errors() so a regression is findable rather than silent. */
  function safe(where, fn) {
    return function (bs, p, s, g) {
      try {
        if (!bs || !bs.length) return { rows: [] };
        return fn(bs, p || {}, s || {}, g) || { rows: [] };
      } catch (e) { fault("dxstudies:" + where, e); return { rows: [] }; }
    };
  }

  /* =====================================================================
     LOCAL MATH
     Only what DXC.kit.M does not already carry. M itself is left untouched:
     a second file mutating the engine's math object is a merge hazard for a
     third one.
     ===================================================================== */

  function nulls(n) { var a = new Array(n), i; for (i = 0; i < n; i++) a[i] = null; return a; }
  function col(bs, k) {
    var a = new Array(bs.length), i;
    for (i = 0; i < bs.length; i++) a[i] = k === "h" ? bs[i].h : k === "l" ? bs[i].l : k === "o" ? bs[i].o : k === "v" ? bs[i].v : bs[i].c;
    return a;
  }
  /* rolling extremes that tolerate a null head, so they compose onto other studies */
  function hhv(x, p) {
    var o = new Array(x.length), i, j;
    for (i = 0; i < x.length; i++) {
      if (i < p - 1) { o[i] = null; continue; }
      var m = -Infinity, bad = false;
      for (j = i - p + 1; j <= i; j++) { if (x[j] == null) { bad = true; break; } if (x[j] > m) m = x[j]; }
      o[i] = bad ? null : m;
    }
    return o;
  }
  function llv(x, p) {
    var o = new Array(x.length), i, j;
    for (i = 0; i < x.length; i++) {
      if (i < p - 1) { o[i] = null; continue; }
      var m = Infinity, bad = false;
      for (j = i - p + 1; j <= i; j++) { if (x[j] == null) { bad = true; break; } if (x[j] < m) m = x[j]; }
      o[i] = bad ? null : m;
    }
    return o;
  }
  /* an EMA whose smoothing constant is given directly, seeded on the first real
     value: the DecisionPoint oscillators are defined that way, not by 2/(n+1)
     over a full warm-up window. */
  function emaA(x, a) {
    var o = new Array(x.length), e = null, i;
    for (i = 0; i < x.length; i++) {
      if (x[i] == null || !isFinite(x[i])) { o[i] = null; continue; }
      e = e == null ? x[i] : e + a * (x[i] - e);
      o[i] = e;
    }
    return o;
  }
  function sub(a, b) {
    var o = new Array(a.length), i;
    for (i = 0; i < a.length; i++) o[i] = a[i] == null || b[i] == null ? null : a[i] - b[i];
    return o;
  }
  function mulC(a, k) {
    var o = new Array(a.length), i;
    for (i = 0; i < a.length; i++) o[i] = a[i] == null ? null : a[i] * k;
    return o;
  }
  function absArr(a) {
    var o = new Array(a.length), i;
    for (i = 0; i < a.length; i++) o[i] = a[i] == null ? null : Math.abs(a[i]);
    return o;
  }
  /* shift a series forward in time: index i lands at i+k, and the array grows so
     the renderer's `extend` can draw the tail past the last bar (the engine does
     the same for the Ichimoku spans). */
  function fwd(a, k) {
    var o = new Array(a.length + k), i;
    for (i = 0; i < k; i++) o[i] = null;
    for (i = 0; i < a.length; i++) o[i + k] = a[i];
    return o;
  }
  /* a straight line between two bar indices, as a full-length series: the row
     kinds the renderer understands are per-index arrays, so a segment is a ramp
     with nulls either side rather than a pair of points. */
  function seg(n, i1, v1, i2, v2) {
    var a = nulls(n), i;
    if (!(i2 > i1)) { if (i1 >= 0 && i1 < n) a[i1] = v1; return a; }
    for (i = i1; i <= i2 && i < n; i++) a[i] = v1 + (v2 - v1) * (i - i1) / (i2 - i1);
    return a;
  }
  function flat(n, i1, i2, v) {
    var a = nulls(n), i;
    for (i = Math.max(0, i1); i <= Math.min(n - 1, i2); i++) a[i] = v;
    return a;
  }
  /* Swing pivots with an explicit left and right lookback. A pivot is only a
     pivot once `right` bars have closed after it, so the last few bars never
     carry one — that is the whole point, and no study here pretends otherwise.

     The comparison is deliberately asymmetric: a tie on the LEFT is allowed, a
     tie on the right is not. Requiring a strict extreme on both sides looks
     tidier and is wrong — equal highs are ordinary (a double top, a round number
     that keeps rejecting, any asset quoted to few decimals), and a detector that
     returns nothing at all when two bars share a high would silently blank the
     five market-structure studies exactly where they matter most. Allowing the
     tie on one side resolves a flat top to its LAST bar, which is also where the
     stops that Liquidity Sweeps is looking for actually sit. */
  function swings(bs, left, right) {
    var n = bs.length, ph = nulls(n), pl = nulls(n), i, j;
    for (i = left; i < n - right; i++) {
      var isH = true, isL = true;
      for (j = i - left; j <= i + right; j++) {
        if (j === i) continue;
        var rightSide = j > i;
        if (rightSide ? bs[j].h >= bs[i].h : bs[j].h > bs[i].h) isH = false;
        if (rightSide ? bs[j].l <= bs[i].l : bs[j].l < bs[i].l) isL = false;
        if (!isH && !isL) break;
      }
      if (isH) ph[i] = bs[i].h;
      if (isL) pl[i] = bs[i].l;
    }
    return { ph: ph, pl: pl };
  }
  /* the bar size, read off the series rather than off the config, so a study is
     right even when the chart is showing a cached interval. */
  function barMs(bs) {
    if (bs.length < 3) return 0;
    var a = [], i;
    for (i = 1; i < Math.min(bs.length, 80); i++) { var dt = bs[i].t - bs[i - 1].t; if (dt > 0) a.push(dt); }
    if (!a.length) return 0;
    a.sort(function (x, y) { return x - y; });
    return a[Math.floor(a.length / 2)] || 0;
  }
  function maOf(kind, bs, x, len) {
    if (kind === "ema") return M.ema(x, len);
    if (kind === "wma") return M.wma(x, len);
    if (kind === "rma") return M.rma(x, len);
    if (kind === "hma") return M.hma(x, len);
    if (kind === "vwma") return M.vwma(bs, len);
    return M.sma(x, len);
  }
  var MA_OPTS = ["sma", "ema", "wma", "rma", "hma", "vwma"];
  var ONOFF = ["on", "off"];
  function on(p, k) { return p[k] !== "off"; }

  /* a pane that has nothing to draw still has to say so. The legend prints study
     names and values, not row names, so the message goes on the canvas as a
     label — an empty pane with no explanation is indistinguishable from a bug. */
  function noteRows(txt, n, v) {
    var a = nulls(n);
    if (n) a[n - 1] = { v: v == null ? 0.5 : v, txt: txt, c: pal().text, fs: 9 };
    return [{ kind: "labels", data: a, name: txt }];
  }

  /* Chande Momentum Oscillator, rolling — VIDYA needs it before the study does */
  function cmoArr(x, p) {
    var n = x.length, o = new Array(n), up = new Array(n), dn = new Array(n), i, su = 0, sd = 0;
    for (i = 0; i < n; i++) {
      var dd = i ? x[i] - x[i - 1] : 0;
      up[i] = dd > 0 ? dd : 0; dn[i] = dd < 0 ? -dd : 0;
      su += up[i]; sd += dn[i];
      if (i > p) { su -= up[i - p]; sd -= dn[i - p]; }
      o[i] = i >= p ? (su + sd ? 100 * (su - sd) / (su + sd) : 0) : null;
    }
    return o;
  }
  /* one ordinary-least-squares fit per bar over the trailing window, returning
     everything the five regression studies want from it, so the window is walked
     once instead of five times. */
  function regWin(x, p) {
    var n = x.length, slope = nulls(n), end = nulls(n), see = nulls(n), r2 = nulls(n), i, j;
    for (i = 0; i < n; i++) {
      if (i < p - 1) continue;
      var sx = 0, sy = 0, sxy = 0, sxx = 0, bad = false;
      for (j = 0; j < p; j++) {
        var yy = x[i - p + 1 + j];
        if (yy == null) { bad = true; break; }
        sx += j; sy += yy; sxy += j * yy; sxx += j * j;
      }
      if (bad) continue;
      var den = p * sxx - sx * sx;
      var m2 = den ? (p * sxy - sx * sy) / den : 0, b = (sy - m2 * sx) / p;
      var mean = sy / p, ssr = 0, sst = 0;
      for (j = 0; j < p; j++) {
        var y2 = x[i - p + 1 + j], yh = m2 * j + b;
        ssr += (y2 - yh) * (y2 - yh); sst += (y2 - mean) * (y2 - mean);
      }
      slope[i] = m2;
      end[i] = m2 * (p - 1) + b;
      see[i] = p > 2 ? Math.sqrt(ssr / (p - 2)) : null;
      r2[i] = sst > 0 ? clamp(1 - ssr / sst, 0, 1) : null;
    }
    return { slope: slope, end: end, see: see, r2: r2 };
  }

  /* =====================================================================
     MOVING AVERAGES
     ===================================================================== */

  R("t3", {
    name: "Tillson T3", g: "Moving averages", over: true,
    in: [{ k: "len", l: "Length", d: 8 }, { k: "vf", l: "Volume factor", d: 0.7, step: 0.05 }, { k: "src", l: "Source", d: "close", opts: SRC }],
    calc: safe("t3", function (bs, p, s) {
      /* six chained EMAs recombined by Tillson's coefficients: the smoothing of a
         long average with much of the lag taken back out by the hot factor. */
      var L = num(p, "len", 8), a = clamp(+p.vf || 0.7, 0.01, 1), x = M.src(bs, p.src || "close");
      var e1 = M.ema(x, L), e2 = M.emaN(e1, L), e3 = M.emaN(e2, L);
      var e4 = M.emaN(e3, L), e5 = M.emaN(e4, L), e6 = M.emaN(e5, L);
      var a2 = a * a, a3 = a2 * a;
      var c1 = -a3, c2 = 3 * a2 + 3 * a3, c3 = -6 * a2 - 3 * a - 3 * a3, c4 = 1 + 3 * a + a3 + 3 * a2;
      var o = new Array(bs.length), i;
      for (i = 0; i < bs.length; i++) {
        o[i] = (e3[i] == null || e4[i] == null || e5[i] == null || e6[i] == null) ? null
          : c1 * e6[i] + c2 * e5[i] + c3 * e4[i] + c4 * e3[i];
      }
      return { rows: [line(o, s.c || C_GOLD, s.w, s.dash, "T3 " + L)] };
    })
  });

  R("trima", {
    name: "Triangular MA (TRIMA)", g: "Moving averages", over: true,
    in: [{ k: "len", l: "Length", d: 20 }, { k: "src", l: "Source", d: "close", opts: SRC }],
    calc: safe("trima", function (bs, p, s) {
      /* an SMA of an SMA: the weight of a bar rises to the middle of the window
         and falls away again, which is what makes it smoother than either half. */
      var L = num(p, "len", 20), x = M.src(bs, p.src || "close");
      var h1 = Math.ceil((L + 1) / 2), h2 = Math.floor(L / 2) + 1;
      return { rows: [line(M.smaN(M.sma(x, h1), h2), s.c || C_BLUE, s.w, s.dash, "TRIMA " + L)] };
    })
  });

  R("zlema", {
    name: "Zero-Lag EMA", g: "Moving averages", over: true,
    in: [{ k: "len", l: "Length", d: 21 }, { k: "src", l: "Source", d: "close", opts: SRC }],
    calc: safe("zlema", function (bs, p, s) {
      /* Ehlers' de-lagging trick: feed the EMA the price plus the move it has
         made since the average's own centre of gravity, not the price itself. */
      var L = num(p, "len", 21), x = M.src(bs, p.src || "close"), lag = Math.floor((L - 1) / 2);
      var dd = new Array(x.length), i;
      for (i = 0; i < x.length; i++) dd[i] = i < lag ? null : x[i] + (x[i] - x[i - lag]);
      return { rows: [line(M.emaN(dd, L), s.c || C_CYAN, s.w, s.dash, "ZLEMA " + L)] };
    })
  });

  R("vidya", {
    name: "VIDYA (Chande variable)", g: "Moving averages", over: true,
    in: [{ k: "len", l: "Length", d: 14 }, { k: "cmo", l: "CMO length", d: 9 }, { k: "src", l: "Source", d: "close", opts: SRC }],
    calc: safe("vidya", function (bs, p, s) {
      /* the smoothing constant is scaled by |CMO|, so the average speeds up when
         the market is one-sided and all but stops when it is not. */
      var L = num(p, "len", 14), CP = num(p, "cmo", 9), x = M.src(bs, p.src || "close");
      var cm = cmoArr(x, CP), al = 2 / (L + 1), o = new Array(x.length), v = null, i;
      for (i = 0; i < x.length; i++) {
        if (cm[i] == null) { o[i] = null; continue; }
        var k = Math.abs(cm[i]) / 100;
        v = v == null ? x[i] : v + al * k * (x[i] - v);
        o[i] = v;
      }
      return { rows: [line(o, s.c || C_VIOLET, s.w, s.dash, "VIDYA " + L)] };
    })
  });

  R("mcginley", {
    name: "McGinley Dynamic", g: "Moving averages", over: true,
    in: [{ k: "len", l: "Length", d: 14 }, { k: "src", l: "Source", d: "close", opts: SRC }],
    calc: safe("mcginley", function (bs, p, s) {
      /* the line adjusts by the fourth power of how far price has run from it, so
         a gap does not leave the average stranded the way a fixed-k EMA does. */
      var L = num(p, "len", 14), x = M.src(bs, p.src || "close"), sm = M.sma(x, L);
      var o = new Array(x.length), md = null, i;
      for (i = 0; i < x.length; i++) {
        if (md == null) { md = sm[i] == null ? null : sm[i]; o[i] = md; continue; }
        var r = md > 0 ? x[i] / md : 1, den = L * Math.pow(r, 4);
        md = isFinite(den) && den !== 0 ? md + (x[i] - md) / den : md;
        o[i] = md;
      }
      return { rows: [line(o, s.c || C_MINT, s.w, s.dash, "McGinley " + L)] };
    })
  });

  R("gmma", {
    name: "Guppy Multiple MA", g: "Moving averages", over: true,
    in: [{ k: "src", l: "Source", d: "close", opts: SRC }, { k: "shortSet", l: "Short band", d: "on", opts: ONOFF }, { k: "longSet", l: "Long band", d: "on", opts: ONOFF }],
    calc: safe("gmma", function (bs, p) {
      /* Guppy's point is the two bands, not the twelve lines: traders on the short
         side against investors on the long side, and the gap between them. */
      var x = M.src(bs, p.src || "close"), rows = [], i;
      var sh = [3, 5, 8, 10, 12, 15], lg = [30, 35, 40, 45, 50, 60];
      if (on(p, "shortSet")) for (i = 0; i < sh.length; i++) rows.push(line(M.ema(x, sh[i]), C_BLUE, 1, 0, "GMMA " + sh[i]));
      if (on(p, "longSet")) for (i = 0; i < lg.length; i++) rows.push(line(M.ema(x, lg[i]), C_DN, 1, 0, "GMMA " + lg[i]));
      return { rows: rows };
    })
  });

  R("dualma", {
    name: "Dual MA Cross", g: "Moving averages", over: true,
    in: [{ k: "fast", l: "Fast length", d: 9 }, { k: "slow", l: "Slow length", d: 21 },
      { k: "type", l: "MA type", d: "ema", opts: MA_OPTS }, { k: "src", l: "Source", d: "close", opts: SRC },
      { k: "show", l: "Cross markers", d: "on", opts: ONOFF }],
    calc: safe("dualma", function (bs, p) {
      var F = num(p, "fast", 9), S2 = num(p, "slow", 21), t = p.type || "ema", x = M.src(bs, p.src || "close");
      var f = maOf(t, bs, x, F), sl = maOf(t, bs, x, S2), n = bs.length;
      var rows = [line(f, C_GOLD, 1.5, 0, t.toUpperCase() + " " + F), line(sl, C_BLUE, 1.5, 0, t.toUpperCase() + " " + S2)];
      if (on(p, "show")) {
        /* the apex of a triangle sits ON the anchor in drawShapeRow, so a mark
           that should point up is the "down" wedge placed under the bar. */
        var mk = nulls(n), i;
        for (i = 1; i < n; i++) {
          if (f[i] == null || sl[i] == null || f[i - 1] == null || sl[i - 1] == null) continue;
          if (f[i - 1] <= sl[i - 1] && f[i] > sl[i]) mk[i] = { v: bs[i].l, s: "down", c: C_UP, txt: "G" };
          else if (f[i - 1] >= sl[i - 1] && f[i] < sl[i]) mk[i] = { v: bs[i].h, s: "up", c: C_DN, txt: "D" };
        }
        rows.push({ kind: "shapes", data: mk, name: "Cross" });
      }
      return { rows: rows };
    })
  });

  /* =====================================================================
     BANDS & CHANNELS
     ===================================================================== */

  R("accband", {
    name: "Acceleration Bands", g: "Bands & channels", over: true,
    in: [{ k: "len", l: "Length", d: 20 }, { k: "f", l: "Factor", d: 4, step: 0.25 }],
    calc: safe("accband", function (bs, p, s) {
      /* Headley scales each band by the bar's own range as a fraction of its
         mid-price, so the envelope widens with the bar rather than with a lag. */
      var L = num(p, "len", 20), f = +p.f || 4, n = bs.length, hu = new Array(n), lo = new Array(n), i;
      for (i = 0; i < n; i++) {
        var b = bs[i], den = b.h + b.l, r = den ? (b.h - b.l) / den : 0;
        hu[i] = b.h * (1 + f * r); lo[i] = b.l * (1 - f * r);
      }
      var up = M.sma(hu, L), dn = M.sma(lo, L), mid = M.sma(M.src(bs, "close"), L);
      return {
        rows: [{ kind: "band", a: up, b: dn, c: s.c || C_TEAL, fill: 0.07, name: "AB" },
          line(up, s.c || C_TEAL, 1.1, 0, "AB upper"), line(mid, s.c || C_TEAL, 1, 4, "AB basis"), line(dn, s.c || C_TEAL, 1.1, 0, "AB lower")]
      };
    })
  });

  R("starc", {
    name: "STARC Bands", g: "Bands & channels", over: true,
    in: [{ k: "len", l: "MA length", d: 6 }, { k: "atr", l: "ATR length", d: 15 }, { k: "mult", l: "ATR mult", d: 2, step: 0.1 }],
    calc: safe("starc", function (bs, p, s) {
      var mid = M.sma(M.src(bs, "close"), num(p, "len", 6)), a = M.atr(bs, num(p, "atr", 15)), m2 = +p.mult || 2;
      var up = mid.map(function (v, i) { return v == null || a[i] == null ? null : v + m2 * a[i]; });
      var dn = mid.map(function (v, i) { return v == null || a[i] == null ? null : v - m2 * a[i]; });
      return {
        rows: [{ kind: "band", a: up, b: dn, c: s.c || C_SAND, fill: 0.06, name: "STARC" },
          line(up, s.c || C_SAND, 1.1, 0, "STARC upper"), line(mid, s.c || C_SAND, 1, 4, "STARC basis"), line(dn, s.c || C_SAND, 1.1, 0, "STARC lower")]
      };
    })
  });

  R("seband", {
    name: "Standard Error Bands", g: "Bands & channels", over: true,
    in: [{ k: "len", l: "Length", d: 21 }, { k: "mult", l: "Errors", d: 2, step: 0.1 }, { k: "sm", l: "Smoothing", d: 3 }],
    calc: safe("seband", function (bs, p, s) {
      /* Andersen's bands: the regression line, plus the standard error of that
         very estimate. They narrow when the fit is good, not when price is calm. */
      var L = clamp(num(p, "len", 21), 3, 400), m2 = +p.mult || 2, sm = Math.max(1, num(p, "sm", 3));
      var r = regWin(M.src(bs, "close"), L);
      var mid = sm > 1 ? M.smaN(r.end, sm) : r.end, se = sm > 1 ? M.smaN(r.see, sm) : r.see;
      var up = mid.map(function (v, i) { return v == null || se[i] == null ? null : v + m2 * se[i]; });
      var dn = mid.map(function (v, i) { return v == null || se[i] == null ? null : v - m2 * se[i]; });
      return {
        rows: [{ kind: "band", a: up, b: dn, c: s.c || C_MAGENTA, fill: 0.06, name: "SEB" },
          line(up, s.c || C_MAGENTA, 1.1, 0, "SEB upper"), line(mid, s.c || C_MAGENTA, 1.3, 0, "regression"), line(dn, s.c || C_MAGENTA, 1.1, 0, "SEB lower")]
      };
    })
  });

  R("atrband", {
    name: "ATR Bands", g: "Bands & channels", over: true,
    in: [{ k: "len", l: "MA length", d: 20 }, { k: "type", l: "MA type", d: "ema", opts: MA_OPTS },
      { k: "atr", l: "ATR length", d: 14 }, { k: "mult", l: "ATR mult", d: 2, step: 0.1 }],
    calc: safe("atrband", function (bs, p, s) {
      var x = M.src(bs, "close"), mid = maOf(p.type || "ema", bs, x, num(p, "len", 20));
      var a = M.atr(bs, num(p, "atr", 14)), m2 = +p.mult || 2;
      var up = mid.map(function (v, i) { return v == null || a[i] == null ? null : v + m2 * a[i]; });
      var dn = mid.map(function (v, i) { return v == null || a[i] == null ? null : v - m2 * a[i]; });
      return {
        rows: [{ kind: "band", a: up, b: dn, c: s.c || C_SKY, fill: 0.06, name: "ATR band" },
          line(up, s.c || C_SKY, 1.1, 0, "upper"), line(mid, s.c || C_SKY, 1, 4, "basis"), line(dn, s.c || C_SKY, 1.1, 0, "lower")]
      };
    })
  });

  R("volstop", {
    name: "Volatility Stop", g: "Bands & channels", over: true,
    in: [{ k: "len", l: "ATR length", d: 20 }, { k: "mult", l: "ATR mult", d: 2, step: 0.1 }],
    calc: safe("volstop", function (bs, p) {
      /* a trailing stop that only ever moves in the direction of the trade and
         flips sides when the close takes it out — the ratchet is the whole idea. */
      var a = M.atr(bs, num(p, "len", 20)), m2 = +p.mult || 2, n = bs.length;
      var lo = nulls(n), sh = nulls(n), flip = nulls(n);
      var up = true, mx = -Infinity, mn = Infinity, stop = null, i;
      for (i = 0; i < n; i++) {
        if (a[i] == null) continue;
        var c = bs[i].c, w = m2 * a[i];
        if (stop == null) { mx = c; mn = c; stop = c - w; lo[i] = stop; continue; }
        mx = Math.max(mx, c); mn = Math.min(mn, c);
        if (up && c < stop) { up = false; mx = c; mn = c; stop = c + w; flip[i] = { v: bs[i].h, s: "up", c: C_DN, txt: "S" }; }
        else if (!up && c > stop) { up = true; mx = c; mn = c; stop = c - w; flip[i] = { v: bs[i].l, s: "down", c: C_UP, txt: "L" }; }
        else stop = up ? Math.max(stop, mx - w) : Math.min(stop, mn + w);
        if (up) lo[i] = stop; else sh[i] = stop;
      }
      return { rows: [line(lo, C_UP, 1.6, 0, "Stop (long)"), line(sh, C_DN, 1.6, 0, "Stop (short)"), { kind: "shapes", data: flip, name: "Flip" }] };
    })
  });

  /* =====================================================================
     TREND
     ===================================================================== */

  function gatorLines(bs, jl, tl, ll2, js, ts, ls) {
    var hl = M.src(bs, "hl2");
    return { jaw: fwd(M.rma(hl, jl), js), teeth: fwd(M.rma(hl, tl), ts), lips: fwd(M.rma(hl, ll2), ls) };
  }

  R("alligator", {
    name: "Alligator (Bill Williams)", g: "Trend", over: true,
    in: [{ k: "jl", l: "Jaw length", d: 13 }, { k: "js", l: "Jaw shift", d: 8 },
      { k: "tl", l: "Teeth length", d: 8 }, { k: "ts", l: "Teeth shift", d: 5 },
      { k: "ll", l: "Lips length", d: 5 }, { k: "ls", l: "Lips shift", d: 3 }],
    calc: safe("alligator", function (bs, p) {
      /* three smoothed averages of the median price, each pushed forward by its
         own number of bars. The displacement is the indicator — without it the
         lines cross where price already is and say nothing about what is next. */
      var js = clamp(num(p, "js", 8), 0, 40), ts = clamp(num(p, "ts", 5), 0, 40), ls = clamp(num(p, "ls", 3), 0, 40);
      var r = gatorLines(bs, num(p, "jl", 13), num(p, "tl", 8), num(p, "ll", 5), js, ts, ls);
      return {
        rows: [line(r.jaw, C_BLUE, 1.5, 0, "Jaw"), line(r.teeth, C_DN, 1.4, 0, "Teeth"), line(r.lips, C_UP, 1.3, 0, "Lips")],
        extend: Math.max(js, ts, ls)
      };
    })
  });

  R("fractals", {
    name: "Williams Fractals", g: "Trend", over: true,
    in: [{ k: "n", l: "Wing bars", d: 2 }],
    calc: safe("fractals", function (bs, p) {
      /* a fractal needs n bars on BOTH sides, so the newest n bars can never carry
         one. That lag is real and the marks stop short of the right edge. */
      var n = bs.length, wing = clamp(num(p, "n", 2), 1, 10);
      var sw = swings(bs, wing, wing), a = M.atr(bs, 14), mk = nulls(n), i;
      for (i = 0; i < n; i++) {
        var pad = a[i] == null ? 0 : a[i] * 0.35;
        if (sw.ph[i] != null) mk[i] = { v: sw.ph[i] + pad, s: "up", c: C_DN };
        else if (sw.pl[i] != null) mk[i] = { v: sw.pl[i] - pad, s: "down", c: C_UP };
      }
      return { rows: [{ kind: "shapes", data: mk, name: "Fractal" }] };
    })
  });

  R("gator", {
    name: "Gator Oscillator", g: "Trend", over: false, h: 0.14,
    in: [{ k: "jl", l: "Jaw length", d: 13 }, { k: "js", l: "Jaw shift", d: 8 },
      { k: "tl", l: "Teeth length", d: 8 }, { k: "ts", l: "Teeth shift", d: 5 },
      { k: "ll", l: "Lips length", d: 5 }, { k: "ls", l: "Lips shift", d: 3 }],
    calc: safe("gator", function (bs, p) {
      /* the gap between the Alligator's lines, above and below zero. The colour is
         the only signal that matters: a bar that grew, or a bar that shrank. */
      var n = bs.length;
      var r = gatorLines(bs, num(p, "jl", 13), num(p, "tl", 8), num(p, "ll", 5),
        clamp(num(p, "js", 8), 0, 40), clamp(num(p, "ts", 5), 0, 40), clamp(num(p, "ls", 3), 0, 40));
      var up = nulls(n), dn = nulls(n), cu = new Array(n), cd = new Array(n), i;
      for (i = 0; i < n; i++) {
        if (r.jaw[i] != null && r.teeth[i] != null) up[i] = Math.abs(r.jaw[i] - r.teeth[i]);
        if (r.teeth[i] != null && r.lips[i] != null) dn[i] = -Math.abs(r.teeth[i] - r.lips[i]);
        cu[i] = up[i] != null && up[i - 1] != null && up[i] < up[i - 1] ? C_DN : C_UP;
        cd[i] = dn[i] != null && dn[i - 1] != null && dn[i] > dn[i - 1] ? C_DN : C_UP;
      }
      return {
        rows: [{ kind: "cols", data: up, cols: cu, base: 0, c: C_UP, name: "Gator up" },
          { kind: "cols", data: dn, cols: cd, base: 0, c: C_DN, name: "Gator down" }], zero: true
      };
    })
  });

  R("kst", {
    name: "Know Sure Thing", g: "Trend", over: false, h: 0.16,
    in: [{ k: "r1", l: "ROC 1", d: 10 }, { k: "r2", l: "ROC 2", d: 15 }, { k: "r3", l: "ROC 3", d: 20 }, { k: "r4", l: "ROC 4", d: 30 },
      { k: "s1", l: "SMA 1", d: 10 }, { k: "s2", l: "SMA 2", d: 10 }, { k: "s3", l: "SMA 3", d: 10 }, { k: "s4", l: "SMA 4", d: 15 },
      { k: "sg", l: "Signal", d: 9 }],
    calc: safe("kst", function (bs, p) {
      /* Pring's four rates of change, each smoothed and then weighted by how slow
         it is, so the long cycle carries the line and the short one only times it. */
      var x = M.src(bs, "close"), n = bs.length;
      var a = M.smaN(M.roc(x, num(p, "r1", 10)), num(p, "s1", 10));
      var b = M.smaN(M.roc(x, num(p, "r2", 15)), num(p, "s2", 10));
      var c = M.smaN(M.roc(x, num(p, "r3", 20)), num(p, "s3", 10));
      var e = M.smaN(M.roc(x, num(p, "r4", 30)), num(p, "s4", 15));
      var k = new Array(n), i;
      for (i = 0; i < n; i++) {
        k[i] = (a[i] == null || b[i] == null || c[i] == null || e[i] == null) ? null : a[i] + 2 * b[i] + 3 * c[i] + 4 * e[i];
      }
      return { rows: [line(k, C_BLUE, 1.5, 0, "KST"), line(M.smaN(k, num(p, "sg", 9)), C_GOLD, 1.2, 0, "Signal")], zero: true };
    })
  });

  R("stc", {
    name: "Schaff Trend Cycle", g: "Trend", over: false, h: 0.15,
    in: [{ k: "f", l: "Fast", d: 23 }, { k: "s", l: "Slow", d: 50 }, { k: "cyc", l: "Cycle", d: 10 }, { k: "d", l: "Smoothing", d: 0.5, step: 0.05 }],
    calc: safe("stc", function (bs, p) {
      /* a stochastic taken twice over a MACD line. Schaff's claim is that a trend
         is a cycle seen from far enough away; the double pass is what makes the
         turns square rather than wavy. */
      var cyc = clamp(num(p, "cyc", 10), 2, 120), f = clamp(+p.d || 0.5, 0.05, 1);
      var m = M.macd(M.src(bs, "close"), num(p, "f", 23), num(p, "s", 50), 9).line;
      var n = bs.length, lo1 = llv(m, cyc), hi1 = hhv(m, cyc);
      var pf = new Array(n), f1 = null, pfv = null, i;
      for (i = 0; i < n; i++) {
        if (m[i] == null || lo1[i] == null || hi1[i] == null) { pf[i] = null; continue; }
        var r1 = hi1[i] - lo1[i];
        f1 = r1 > 0 ? (m[i] - lo1[i]) / r1 * 100 : (f1 == null ? 50 : f1);
        pfv = pfv == null ? f1 : pfv + f * (f1 - pfv);
        pf[i] = pfv;
      }
      var lo2 = llv(pf, cyc), hi2 = hhv(pf, cyc), out = new Array(n), f2 = null, pff = null;
      for (i = 0; i < n; i++) {
        if (pf[i] == null || lo2[i] == null || hi2[i] == null) { out[i] = null; continue; }
        var r2 = hi2[i] - lo2[i];
        f2 = r2 > 0 ? (pf[i] - lo2[i]) / r2 * 100 : (f2 == null ? 50 : f2);
        pff = pff == null ? f2 : pff + f * (f2 - pff);
        out[i] = pff;
      }
      return { rows: [line(out, C_MAGENTA, 1.5, 0, "STC")], range: [0, 100], levels: [{ v: 75, dash: 4 }, { v: 25, dash: 4 }], zones: [[75, 100], [0, 25]] };
    })
  });

  R("wavetrend", {
    name: "WaveTrend Oscillator", g: "Trend", over: false, h: 0.17,
    in: [{ k: "n1", l: "Channel length", d: 10 }, { k: "n2", l: "Average length", d: 21 }, { k: "sg", l: "Signal", d: 4 },
      { k: "hist", l: "Difference", d: "on", opts: ONOFF }],
    calc: safe("wavetrend", function (bs, p) {
      /* LazyBear's WaveTrend, unchanged: the typical price against its own EMA,
         scaled by the average distance between them, then smoothed again. The
         0.015 divisor is Lambert's, carried over from the CCI it descends from. */
      var n1 = num(p, "n1", 10), n2 = num(p, "n2", 21), n = bs.length;
      var ap = M.src(bs, "hlc3"), esa = M.ema(ap, n1);
      var dv = new Array(n), i;
      for (i = 0; i < n; i++) dv[i] = esa[i] == null ? null : Math.abs(ap[i] - esa[i]);
      var de = M.emaN(dv, n1), ci = new Array(n);
      for (i = 0; i < n; i++) ci[i] = (esa[i] == null || de[i] == null || !de[i]) ? null : (ap[i] - esa[i]) / (0.015 * de[i]);
      var wt1 = M.emaN(ci, n2), wt2 = M.smaN(wt1, num(p, "sg", 4));
      var rows = [];
      if (on(p, "hist")) rows.push({ kind: "hist", data: sub(wt1, wt2), up: C_UP, dn: C_DN, name: "WT diff" });
      rows.push(line(wt1, C_CYAN, 1.5, 0, "WT1"));
      rows.push(line(wt2, C_GOLD, 1.2, 0, "WT2"));
      return {
        rows: rows, zero: true,
        levels: [{ v: 60, c: C_DN, dash: 4, label: "OB" }, { v: 53, c: C_DN, dash: 2 }, { v: 0, dash: 2 },
          { v: -53, c: C_UP, dash: 2 }, { v: -60, c: C_UP, dash: 4, label: "OS" }]
      };
    })
  });

  R("rwi", {
    name: "Random Walk Index", g: "Trend", over: false, h: 0.15,
    in: [{ k: "len", l: "Max length", d: 8 }],
    calc: safe("rwi", function (bs, p) {
      /* how far the move is beyond what a random walk of the same volatility would
         have produced, taken over every lookback from 2 to n and the worst kept.
         Prefix-summed true range keeps that sweep O(n·k) rather than O(n·k²). */
      var n = bs.length, L = clamp(num(p, "len", 8), 2, 24), tr = M.tr(bs), pre = new Array(n + 1), i, k;
      pre[0] = 0;
      for (i = 0; i < n; i++) pre[i + 1] = pre[i] + tr[i];
      var hi = nulls(n), lo = nulls(n);
      for (i = L; i < n; i++) {
        var bh = 0, bl = 0;
        for (k = 2; k <= L; k++) {
          var at = (pre[i + 1] - pre[i + 1 - k]) / k;
          if (!(at > 0)) continue;
          var den = at * Math.sqrt(k);
          var vh = (bs[i].h - bs[i - k + 1].l) / den, vl = (bs[i - k + 1].h - bs[i].l) / den;
          if (vh > bh) bh = vh;
          if (vl > bl) bl = vl;
        }
        hi[i] = bh; lo[i] = bl;
      }
      return { rows: [line(hi, C_UP, 1.4, 0, "RWI high"), line(lo, C_DN, 1.4, 0, "RWI low")], levels: [{ v: 1, dash: 4, label: "random walk" }] };
    })
  });

  R("lrcurve", {
    name: "Linear Regression Curve", g: "Trend", over: true,
    in: [{ k: "len", l: "Length", d: 50 }, { k: "src", l: "Source", d: "close", opts: SRC }],
    calc: safe("lrcurve", function (bs, p, s) {
      /* the end point of the fit through the last n bars, plotted bar by bar. It is
         the same arithmetic the engine's LSMA already runs — this one exists so it
         can be read as a curve at a long length with the source chosen. */
      var L = clamp(num(p, "len", 50), 3, 600);
      return { rows: [line(regWin(M.src(bs, p.src || "close"), L).end, s.c || C_CYAN, s.w || 1.5, s.dash, "LR curve " + L)] };
    })
  });

  R("tdseq", {
    name: "TD Sequential (DeMark)", g: "Trend", over: true,
    in: [{ k: "show", l: "Show", d: "9 and 13", opts: ["9 and 13", "all"] }, { k: "cd", l: "Countdown", d: "on", opts: ONOFF }],
    calc: safe("tdseq", function (bs, p) {
      /* DeMark's setup: nine closes each under (buy) or over (sell) the close four
         bars back. The countdown that follows compares the close with the LOW two
         bars back, which is a different test from the setup and is counted apart. */
      var n = bs.length, c = col(bs, "c"), a = M.atr(bs, 14);
      var lab = nulls(n), i;
      var buy = 0, sell = 0, cdB = 0, cdS = 0, armB = false, armS = false;
      var all = p.show === "all";
      function put(i2, txt, colr, below) {
        var pad = a[i2] == null ? 0 : a[i2] * 0.5;
        lab[i2] = { v: below ? bs[i2].l - pad : bs[i2].h + pad, txt: txt, c: colr, fs: 9 };
      }
      for (i = 4; i < n; i++) {
        if (c[i] < c[i - 4]) { buy = buy >= 9 ? 1 : buy + 1; sell = 0; }
        else { buy = 0; }
        if (c[i] > c[i - 4]) { sell = sell >= 9 ? 1 : sell + 1; buy = 0; }
        else { sell = 0; }
        if (buy === 9) { armB = true; cdB = 0; armS = false; cdS = 0; }
        if (sell === 9) { armS = true; cdS = 0; armB = false; cdB = 0; }
        if (on(p, "cd")) {
          if (armB && i >= 2 && c[i] <= bs[i - 2].l) { cdB++; if (cdB >= 13) { put(i, "13", C_UP, true); armB = false; } else if (all) put(i, "c" + cdB, C_MINT, true); }
          if (armS && i >= 2 && c[i] >= bs[i - 2].h) { cdS++; if (cdS >= 13) { put(i, "13", C_DN, false); armS = false; } else if (all) put(i, "c" + cdS, C_CORAL, false); }
        }
        if (lab[i]) continue;
        if (buy === 9) put(i, "9", C_UP, true);
        else if (sell === 9) put(i, "9", C_DN, false);
        else if (all && buy) put(i, String(buy), C_MINT, true);
        else if (all && sell) put(i, String(sell), C_CORAL, false);
      }
      return { rows: [{ kind: "labels", data: lab, name: "TD" }] };
    })
  });

  /* =====================================================================
     OSCILLATORS
     ===================================================================== */

  R("cmo", {
    name: "Chande Momentum Oscillator", g: "Oscillators", over: false, h: 0.15,
    in: [{ k: "len", l: "Length", d: 9 }, { k: "src", l: "Source", d: "close", opts: SRC }],
    calc: safe("cmo", function (bs, p, s) {
      /* RSI's ingredients without Wilder's smoothing, and scaled to ±100 — the
         unsmoothed reading is the point, not an oversight. */
      return {
        rows: [line(cmoArr(M.src(bs, p.src || "close"), num(p, "len", 9)), s.c || C_VIOLET, 1.4, 0, "CMO")],
        range: [-100, 100], levels: [{ v: 50, dash: 4 }, { v: 0, dash: 2 }, { v: -50, dash: 4 }], zones: [[50, 100], [-100, -50]]
      };
    })
  });

  R("tsi", {
    name: "True Strength Index", g: "Oscillators", over: false, h: 0.15,
    in: [{ k: "long", l: "Long", d: 25 }, { k: "short", l: "Short", d: 13 }, { k: "sg", l: "Signal", d: 13 }],
    calc: safe("tsi", function (bs, p) {
      /* Blau double-smooths the change and the absolute change with the same pair
         of EMAs, so the ratio is a momentum reading that is already de-noised. */
      var x = M.src(bs, "close"), n = bs.length, L = num(p, "long", 25), S2 = num(p, "short", 13);
      var pc = new Array(n), i;
      for (i = 0; i < n; i++) pc[i] = i ? x[i] - x[i - 1] : null;
      var ds = M.emaN(M.emaN(pc, L), S2), da = M.emaN(M.emaN(absArr(pc), L), S2), o = new Array(n);
      for (i = 0; i < n; i++) o[i] = (ds[i] == null || da[i] == null || !da[i]) ? null : 100 * ds[i] / da[i];
      return { rows: [line(o, C_BLUE, 1.5, 0, "TSI"), line(M.emaN(o, num(p, "sg", 13)), C_GOLD, 1.2, 0, "Signal")], zero: true, levels: [{ v: 25, dash: 4 }, { v: -25, dash: 4 }] };
    })
  });

  R("smi", {
    name: "Stochastic Momentum Index", g: "Oscillators", over: false, h: 0.15,
    in: [{ k: "len", l: "%K length", d: 10 }, { k: "s1", l: "Smooth 1", d: 3 }, { k: "s2", l: "Smooth 2", d: 3 }, { k: "sg", l: "Signal", d: 10 }],
    calc: safe("smi", function (bs, p) {
      /* Blau's answer to the stochastic: measure the close against the MIDDLE of
         the range rather than its low, so the reading is signed on its own. */
      var L = num(p, "len", 10), n = bs.length;
      var hi = hhv(col(bs, "h"), L), lo = llv(col(bs, "l"), L);
      var rel = new Array(n), rng = new Array(n), i;
      for (i = 0; i < n; i++) {
        if (hi[i] == null || lo[i] == null) { rel[i] = null; rng[i] = null; continue; }
        rel[i] = bs[i].c - (hi[i] + lo[i]) / 2; rng[i] = hi[i] - lo[i];
      }
      var s1 = num(p, "s1", 3), s2 = num(p, "s2", 3);
      var ar = M.emaN(M.emaN(rel, s1), s2), ad = M.emaN(M.emaN(rng, s1), s2), o = new Array(n);
      for (i = 0; i < n; i++) o[i] = (ar[i] == null || ad[i] == null || !ad[i]) ? null : 100 * ar[i] / (ad[i] / 2);
      return {
        rows: [line(o, C_BLUE, 1.5, 0, "SMI"), line(M.emaN(o, num(p, "sg", 10)), C_GOLD, 1.2, 0, "Signal")],
        range: [-100, 100], levels: [{ v: 40, dash: 4 }, { v: 0, dash: 2 }, { v: -40, dash: 4 }], zones: [[40, 100], [-100, -40]]
      };
    })
  });

  R("ppo", {
    name: "Percentage Price Oscillator", g: "Oscillators", over: false, h: 0.15,
    in: [{ k: "f", l: "Fast", d: 12 }, { k: "s", l: "Slow", d: 26 }, { k: "sg", l: "Signal", d: 9 }, { k: "src", l: "Source", d: "close", opts: SRC }],
    calc: safe("ppo", function (bs, p) {
      /* MACD stated as a percentage of the slow average, which is what makes it
         comparable between a coin at 4 dollars and one at 40,000. */
      var x = M.src(bs, p.src || "close"), n = bs.length;
      var ef = M.ema(x, num(p, "f", 12)), es = M.ema(x, num(p, "s", 26)), o = new Array(n), i;
      for (i = 0; i < n; i++) o[i] = (ef[i] == null || es[i] == null || !es[i]) ? null : (ef[i] - es[i]) / es[i] * 100;
      var sg = M.emaN(o, num(p, "sg", 9));
      return { rows: [{ kind: "hist", data: sub(o, sg), up: C_UP, dn: C_DN, name: "Histogram" }, line(o, C_BLUE, 1.4, 0, "PPO %"), line(sg, C_GOLD, 1.2, 0, "Signal")], zero: true };
    })
  });

  R("pvo", {
    name: "Percentage Volume Oscillator", g: "Oscillators", over: false, h: 0.15,
    in: [{ k: "f", l: "Fast", d: 12 }, { k: "s", l: "Slow", d: 26 }, { k: "sg", l: "Signal", d: 9 }],
    calc: safe("pvo", function (bs, p) {
      var v = col(bs, "v"), n = bs.length;
      var ef = M.ema(v, num(p, "f", 12)), es = M.ema(v, num(p, "s", 26)), o = new Array(n), i;
      for (i = 0; i < n; i++) o[i] = (ef[i] == null || es[i] == null || !es[i]) ? null : (ef[i] - es[i]) / es[i] * 100;
      var sg = M.emaN(o, num(p, "sg", 9));
      return { rows: [{ kind: "hist", data: sub(o, sg), up: C_UP, dn: C_DN, name: "Histogram" }, line(o, C_TEAL, 1.4, 0, "PVO %"), line(sg, C_GOLD, 1.2, 0, "Signal")], zero: true };
    })
  });

  R("demarker", {
    name: "DeMarker", g: "Oscillators", over: false, h: 0.14,
    in: [{ k: "len", l: "Length", d: 14 }],
    calc: safe("demarker", function (bs, p, s) {
      /* only the part of each bar that made a NEW extreme counts, so a wide bar
         inside yesterday's range adds nothing at all. */
      var n = bs.length, L = num(p, "len", 14), dmax = new Array(n), dmin = new Array(n), i;
      for (i = 0; i < n; i++) {
        if (!i) { dmax[i] = 0; dmin[i] = 0; continue; }
        dmax[i] = Math.max(bs[i].h - bs[i - 1].h, 0);
        dmin[i] = Math.max(bs[i - 1].l - bs[i].l, 0);
      }
      var a = M.sma(dmax, L), b = M.sma(dmin, L), o = new Array(n);
      for (i = 0; i < n; i++) o[i] = (a[i] == null || b[i] == null) ? null : (a[i] + b[i] ? a[i] / (a[i] + b[i]) : 0.5);
      return { rows: [line(o, s.c || C_SAND, 1.4, 0, "DeMarker")], range: [0, 1], levels: [{ v: 0.7, dash: 4 }, { v: 0.3, dash: 4 }], zones: [[0.7, 1], [0, 0.3]] };
    })
  });

  R("derivosc", {
    name: "Derivative Oscillator", g: "Oscillators", over: false, h: 0.15,
    in: [{ k: "rsi", l: "RSI length", d: 14 }, { k: "e1", l: "EMA 1", d: 5 }, { k: "e2", l: "EMA 2", d: 3 }, { k: "sg", l: "Signal SMA", d: 9 }],
    calc: safe("derivosc", function (bs, p) {
      /* Constance Brown's double-smoothed RSI against its own signal. The plot is
         the difference; the smoothed RSI itself is drawn thin behind it. */
      var r = M.rsi(M.src(bs, "close"), num(p, "rsi", 14));
      var s2 = M.emaN(M.emaN(r, num(p, "e1", 5)), num(p, "e2", 3));
      var sg = M.smaN(s2, num(p, "sg", 9));
      return {
        rows: [{ kind: "hist", data: sub(s2, sg), up: C_UP, dn: C_DN, name: "DOSC" },
          line(s2, C_BLUE, 1.1, 0, "smoothed RSI"), line(sg, C_GOLD, 1.1, 0, "Signal")], zero: true
      };
    })
  });

  R("woodies", {
    name: "Woodies CCI", g: "Oscillators", over: false, h: 0.17,
    in: [{ k: "len", l: "CCI length", d: 14 }, { k: "turbo", l: "Turbo length", d: 6 }, { k: "run", l: "Trend bars", d: 6 }],
    calc: safe("woodies", function (bs, p) {
      /* Woodie reads the CCI as a run, not a level: bars are only coloured once
         the same side of zero has held for `run` of them, which is the whole
         difference between his system and a plain CCI. */
      var L = num(p, "len", 14), n = bs.length, run = clamp(num(p, "run", 6), 2, 30);
      var c = M.cci(bs, L), t = M.cci(bs, num(p, "turbo", 6));
      var cols = new Array(n), streak = 0, side = 0, i;
      for (i = 0; i < n; i++) {
        if (c[i] == null) { cols[i] = pal().faint; streak = 0; side = 0; continue; }
        var sd = c[i] > 0 ? 1 : c[i] < 0 ? -1 : 0;
        streak = sd && sd === side ? streak + 1 : 1;
        side = sd;
        cols[i] = streak >= run ? (sd > 0 ? C_UP : C_DN) : pal().faint;
      }
      return {
        rows: [{ kind: "cols", data: c, cols: cols, base: 0, c: C_BLUE, name: "CCI " + L }, line(t, C_GOLD, 1.2, 0, "Turbo")],
        zero: true, levels: [{ v: 200, dash: 2 }, { v: 100, dash: 4 }, { v: 0, dash: 2 }, { v: -100, dash: 4 }, { v: -200, dash: 2 }]
      };
    })
  });

  /* =====================================================================
     MOMENTUM
     ===================================================================== */

  R("accosc", {
    name: "Accelerator Oscillator (AC)", g: "Momentum", over: false, h: 0.14, in: [],
    calc: safe("accosc", function (bs) {
      /* the Awesome Oscillator minus its own five-bar average: momentum's second
         derivative, which turns before the AO does. Colour is direction, not sign. */
      var ao = M.ao(bs), o = sub(ao, M.smaN(ao, 5)), n = bs.length, cols = new Array(n), i;
      for (i = 0; i < n; i++) cols[i] = (o[i] == null || o[i - 1] == null || o[i] >= o[i - 1]) ? C_UP : C_DN;
      return { rows: [{ kind: "cols", data: o, cols: cols, base: 0, c: C_UP, name: "AC" }], zero: true };
    })
  });

  R("elderimp", {
    name: "Elder Impulse System", g: "Momentum", over: true,
    in: [{ k: "len", l: "EMA length", d: 13 }, { k: "f", l: "MACD fast", d: 12 }, { k: "s", l: "MACD slow", d: 26 }, { k: "sg", l: "MACD signal", d: 9 }],
    calc: safe("elderimp", function (bs, p) {
      /* Elder's rule is a veto, not a score: green needs BOTH the trend average
         and the MACD histogram rising, red needs both falling, and anything else
         is blue — permission withheld. The engine draws bars, not bar colours, so
         the verdict is a wash behind the candle rather than a repaint of it. */
      var x = M.src(bs, "close"), e = M.ema(x, num(p, "len", 13));
      var h = M.macd(x, num(p, "f", 12), num(p, "s", 26), num(p, "sg", 9)).hist;
      var n = bs.length, bg = nulls(n), i;
      for (i = 1; i < n; i++) {
        if (e[i] == null || e[i - 1] == null || h[i] == null || h[i - 1] == null) continue;
        var eu = e[i] > e[i - 1], hu = h[i] > h[i - 1];
        bg[i] = eu && hu ? C_UP : (!eu && !hu) ? C_DN : C_BLUE;
      }
      return { rows: [{ kind: "bg", data: bg, alpha: 0.12, name: "Impulse" }] };
    })
  });

  R("pmo", {
    name: "DecisionPoint Price Momentum", g: "Momentum", over: false, h: 0.15,
    in: [{ k: "l1", l: "Smoothing 1", d: 35 }, { k: "l2", l: "Smoothing 2", d: 20 }, { k: "sg", l: "Signal", d: 10 }],
    calc: safe("pmo", function (bs, p) {
      /* Swenlin's PMO is defined with a 2/n smoothing constant seeded on the first
         reading, not a windowed EMA — so it is built with emaA, not M.ema. */
      var x = M.src(bs, "close"), n = bs.length, rc = new Array(n), i;
      for (i = 0; i < n; i++) rc[i] = i && x[i - 1] ? (x[i] / x[i - 1] - 1) * 100 : null;
      var a1 = emaA(rc, 2 / clamp(num(p, "l1", 35), 2, 400));
      var a2 = emaA(mulC(a1, 10), 2 / clamp(num(p, "l2", 20), 2, 400));
      var sg = emaA(a2, 2 / clamp(num(p, "sg", 10), 2, 400));
      return { rows: [{ kind: "hist", data: sub(a2, sg), up: C_UP, dn: C_DN, name: "PMO diff" }, line(a2, C_BLUE, 1.5, 0, "PMO"), line(sg, C_GOLD, 1.2, 0, "Signal")], zero: true };
    })
  });

  R("apo", {
    name: "Absolute Price Oscillator", g: "Momentum", over: false, h: 0.14,
    in: [{ k: "f", l: "Fast", d: 12 }, { k: "s", l: "Slow", d: 26 }, { k: "type", l: "MA type", d: "ema", opts: MA_OPTS }, { k: "src", l: "Source", d: "close", opts: SRC }],
    calc: safe("apo", function (bs, p, s) {
      /* the same spread MACD plots, in the instrument's own units and with no
         signal line — useful exactly when the absolute size of the gap matters. */
      var x = M.src(bs, p.src || "close"), t = p.type || "ema";
      var o = sub(maOf(t, bs, x, num(p, "f", 12)), maOf(t, bs, x, num(p, "s", 26)));
      return { rows: [{ kind: "hist", data: o, up: C_UP, dn: C_DN, name: "APO" }, line(o, s.c || C_SKY, 1.3, 0, "APO")], zero: true };
    })
  });

  /* =====================================================================
     VOLUME
     ===================================================================== */

  R("adline", {
    name: "Accumulation / Distribution Line", g: "Volume", over: false, h: 0.14,
    in: [{ k: "ma", l: "MA length", d: 0 }],
    calc: safe("adline", function (bs, p, s) {
      /* M.adl has been in the engine since v160 with nothing drawing it. This is
         that line: volume signed by where the close sat inside its own bar. */
      var a = M.adl(bs), rows = [line(a, s.c || C_UP, 1.4, 0, "A/D")];
      if (+p.ma > 1) rows.push(line(M.smaN(a, +p.ma), C_GOLD, 1.1, 0, "A/D MA"));
      return { rows: rows, fmt: "vol" };
    })
  });

  R("volosc", {
    name: "Volume Oscillator", g: "Volume", over: false, h: 0.14,
    in: [{ k: "f", l: "Short", d: 5 }, { k: "s", l: "Long", d: 10 }],
    calc: safe("volosc", function (bs, p, s) {
      var v = col(bs, "v"), n = bs.length, ef = M.ema(v, num(p, "f", 5)), es = M.ema(v, num(p, "s", 10)), o = new Array(n), i;
      for (i = 0; i < n; i++) o[i] = (ef[i] == null || es[i] == null || !es[i]) ? null : (ef[i] - es[i]) / es[i] * 100;
      return { rows: [{ kind: "hist", data: o, up: C_UP, dn: C_DN, name: "Vol osc %" }, line(o, s.c || C_TEAL, 1.2, 0, "Vol osc %")], zero: true };
    })
  });

  R("rvol", {
    name: "Relative Volume (RVOL)", g: "Volume", over: false, h: 0.14,
    in: [{ k: "len", l: "Sessions / bars", d: 10 }],
    calc: safe("rvol", function (bs, p) {
      /* The honest comparison is a bar against the SAME slot of earlier sessions:
         09:00 against 09:00, not against the quiet hours that just passed. That is
         only possible when the bar size divides a day. On daily bars and larger it
         cannot be done at all, so the fallback is a plain trailing mean and the
         legend name says which of the two is on screen. */
      var n = bs.length, L = clamp(num(p, "len", 10), 2, 60), v = col(bs, "v"), o = nulls(n), i;
      var ms = barMs(bs), slotted = ms > 0 && ms < 864e5 && 864e5 % ms === 0;
      if (slotted) {
        var slots = {};
        for (i = 0; i < n; i++) {
          var key = Math.floor((((bs[i].t % 864e5) + 864e5) % 864e5) / ms);
          var g2 = slots[key] || (slots[key] = { a: [], s: 0 });
          if (g2.a.length >= L) o[i] = g2.s / g2.a.length > 0 ? v[i] / (g2.s / g2.a.length) : null;
          g2.a.push(v[i]); g2.s += v[i];
          if (g2.a.length > L) g2.s -= g2.a.shift();
        }
      } else {
        var mv = M.sma(v, L);
        for (i = 1; i < n; i++) o[i] = mv[i - 1] > 0 ? v[i] / mv[i - 1] : null;
      }
      var nm = slotted ? "RVOL · same slot, " + L + " sessions" : "RVOL · trailing mean of " + L + " bars";
      var cols = new Array(n);
      for (i = 0; i < n; i++) cols[i] = o[i] == null ? pal().faint : o[i] >= 1 ? C_UP : C_DN;
      return { rows: [{ kind: "cols", data: o, cols: cols, base: 0, c: C_BLUE, name: nm }], levels: [{ v: 1, dash: 2, label: "normal" }, { v: 2, dash: 4 }] };
    })
  });

  R("nvi", {
    name: "Negative Volume Index", g: "Volume", over: false, h: 0.14,
    in: [{ k: "sg", l: "Signal EMA", d: 255 }],
    calc: safe("nvi", function (bs, p, s) {
      /* Fosback's premise: the smart money moves on quiet days. The index only
         changes on a bar whose volume fell, and holds flat on every other. */
      var n = bs.length, o = new Array(n), x = 1000, i;
      for (i = 0; i < n; i++) {
        if (i && bs[i].v < bs[i - 1].v && bs[i - 1].c) x = x * (1 + (bs[i].c - bs[i - 1].c) / bs[i - 1].c);
        o[i] = x;
      }
      return { rows: [line(o, s.c || C_MINT, 1.4, 0, "NVI"), line(M.emaN(o, clamp(num(p, "sg", 255), 2, 1000)), C_GOLD, 1.1, 0, "Signal")] };
    })
  });

  R("pvi", {
    name: "Positive Volume Index", g: "Volume", over: false, h: 0.14,
    in: [{ k: "sg", l: "Signal EMA", d: 255 }],
    calc: safe("pvi", function (bs, p, s) {
      var n = bs.length, o = new Array(n), x = 1000, i;
      for (i = 0; i < n; i++) {
        if (i && bs[i].v > bs[i - 1].v && bs[i - 1].c) x = x * (1 + (bs[i].c - bs[i - 1].c) / bs[i - 1].c);
        o[i] = x;
      }
      return { rows: [line(o, s.c || C_CORAL, 1.4, 0, "PVI"), line(M.emaN(o, clamp(num(p, "sg", 255), 2, 1000)), C_GOLD, 1.1, 0, "Signal")] };
    })
  });

  R("tsv", {
    name: "Time Segmented Volume", g: "Volume", over: false, h: 0.14,
    in: [{ k: "len", l: "Length", d: 18 }, { k: "ma", l: "MA length", d: 6 }],
    calc: safe("tsv", function (bs, p) {
      /* Worden's TSV: each bar's close-to-close move carries its own volume, then
         the last n of those are summed. Rolling, so the sweep stays O(n). */
      var n = bs.length, L = clamp(num(p, "len", 18), 2, 400), raw = new Array(n), o = nulls(n), sum = 0, i;
      for (i = 0; i < n; i++) raw[i] = i ? (bs[i].c - bs[i - 1].c) * bs[i].v : 0;
      for (i = 0; i < n; i++) {
        sum += raw[i];
        if (i >= L) sum -= raw[i - L];
        if (i >= L) o[i] = sum;
      }
      var rows = [{ kind: "hist", data: o, up: C_UP, dn: C_DN, name: "TSV" }];
      if (num(p, "ma", 6) > 1) rows.push(line(M.smaN(o, num(p, "ma", 6)), C_GOLD, 1.2, 0, "TSV MA"));
      return { rows: rows, zero: true, fmt: "vol" };
    })
  });

  R("vwapsd", {
    name: "VWAP with deviation bands", g: "Volume", over: true,
    in: [{ k: "anchor", l: "Anchor", d: "1d", opts: ["1d", "1w", "1M", "none"] },
      { k: "m1", l: "Band 1 σ", d: 1, step: 0.1 }, { k: "m2", l: "Band 2 σ", d: 2, step: 0.1 }, { k: "m3", l: "Band 3 σ", d: 3, step: 0.1 }],
    calc: safe("vwapsd", function (bs, p, s) {
      /* the deviation is volume-weighted too, carried as a running second moment,
         so a band is the spread of the volume around the VWAP and not of the
         prices that happened to print. */
      var a = p.anchor === "1w" ? 6048e5 : p.anchor === "1M" ? 2592e6 : p.anchor === "none" ? 0 : 864e5;
      var n = bs.length, vw = new Array(n), sd = new Array(n), cum = 0, c2 = 0, cv = 0, lastA = -1, i;
      for (i = 0; i < n; i++) {
        var k = a ? Math.floor(bs[i].t / a) : 0;
        if (k !== lastA) { cum = 0; c2 = 0; cv = 0; lastA = k; }
        var tp = (bs[i].h + bs[i].l + bs[i].c) / 3, v = bs[i].v || 1;
        cum += tp * v; c2 += tp * tp * v; cv += v;
        vw[i] = cv ? cum / cv : null;
        sd[i] = cv ? Math.sqrt(Math.max(0, c2 / cv - vw[i] * vw[i])) : null;
      }
      var rows = [line(vw, s.c || C_CYAN, 1.6, 0, "VWAP")], m = [+p.m1 || 1, +p.m2 || 2, +p.m3 || 3];
      var cs = [C_BLUE, C_VIOLET, C_DN], j;
      for (j = 0; j < 3; j++) {
        var up = [], dn = [];
        for (i = 0; i < n; i++) {
          up.push(vw[i] == null || sd[i] == null ? null : vw[i] + m[j] * sd[i]);
          dn.push(vw[i] == null || sd[i] == null ? null : vw[i] - m[j] * sd[i]);
        }
        if (!j) rows.push({ kind: "band", a: up, b: dn, c: cs[0], fill: 0.05, name: "1σ" });
        rows.push(line(up, cs[j], 1, j ? 4 : 0, "+" + m[j] + "σ"));
        rows.push(line(dn, cs[j], 1, j ? 4 : 0, "−" + m[j] + "σ"));
      }
      return { rows: rows };
    })
  });

  R("cvd", {
    name: "Cumulative Volume Delta (approximation)", g: "Volume", over: false, h: 0.16,
    in: [{ k: "anchor", l: "Anchor", d: "none", opts: ["none", "1d", "1w"] }, { k: "ma", l: "MA length", d: 0 }],
    calc: safe("cvd", function (bs, p, s) {
      /* THIS IS NOT TRUE DELTA. True delta needs the trade tape — which side each
         fill hit — and this rail carries OHLCV only. What is drawn is the close's
         position inside the bar's range used as the buy share, which is the same
         split A/D uses. It correlates with delta and it is not delta, so the study
         is named and legended as an approximation everywhere it appears. */
      var a = p.anchor === "1d" ? 864e5 : p.anchor === "1w" ? 6048e5 : 0;
      var n = bs.length, o = new Array(n), cum = 0, lastA = -1, i;
      for (i = 0; i < n; i++) {
        var k = a ? Math.floor(bs[i].t / a) : 0;
        if (k !== lastA) { cum = 0; lastA = k; }
        var r = bs[i].h - bs[i].l, share = r > 0 ? (bs[i].c - bs[i].l) / r : 0.5;
        cum += bs[i].v * (2 * share - 1);
        o[i] = cum;
      }
      var rows = [{ kind: "area", data: o, c: s.c || C_TEAL, fill: 0.14, base: 0, w: 1.5, name: "CVD · close-position split, not trade-side" }];
      if (+p.ma > 1) rows.push(line(M.smaN(o, +p.ma), C_GOLD, 1.1, 0, "CVD MA"));
      return { rows: rows, zero: true, fmt: "vol" };
    })
  });

  R("netvol", {
    name: "Net Volume", g: "Volume", over: false, h: 0.14,
    in: [{ k: "basis", l: "Sign by", d: "close vs prev", opts: ["close vs prev", "close vs open"] }],
    calc: safe("netvol", function (bs, p) {
      var n = bs.length, o = new Array(n), prev = p.basis !== "close vs open", i;
      for (i = 0; i < n; i++) {
        var up = prev ? (i ? bs[i].c - bs[i - 1].c : 0) : bs[i].c - bs[i].o;
        o[i] = up > 0 ? bs[i].v : up < 0 ? -bs[i].v : 0;
      }
      return { rows: [{ kind: "hist", data: o, up: C_UP, dn: C_DN, name: "Net volume" }], zero: true, fmt: "vol" };
    })
  });

  /* =====================================================================
     VOLATILITY
     ===================================================================== */

  R("ulcer", {
    name: "Ulcer Index", g: "Volatility", over: false, h: 0.14,
    in: [{ k: "len", l: "Length", d: 14 }, { k: "src", l: "Source", d: "close", opts: SRC }],
    calc: safe("ulcer", function (bs, p, s) {
      /* Martin measures the depth AND the duration of being under water, by
         squaring the drawdown before averaging — an index of pain, not of range. */
      var L = clamp(num(p, "len", 14), 2, 400), x = M.src(bs, p.src || "close"), n = bs.length, o = nulls(n), i, j;
      for (i = L - 1; i < n; i++) {
        var acc = 0, mx = -Infinity;
        for (j = i - L + 1; j <= i; j++) {
          if (x[j] > mx) mx = x[j];
          var dd = mx > 0 ? (x[j] - mx) / mx * 100 : 0;
          acc += dd * dd;
        }
        o[i] = Math.sqrt(acc / L);
      }
      return { rows: [line(o, s.c || C_CORAL, 1.4, 0, "Ulcer")] };
    })
  });

  R("chaikvol", {
    name: "Chaikin Volatility", g: "Volatility", over: false, h: 0.14,
    in: [{ k: "len", l: "EMA length", d: 10 }, { k: "roc", l: "ROC length", d: 10 }],
    calc: safe("chaikvol", function (bs, p, s) {
      /* the rate of change of the smoothed high-low spread: it rises when bars are
         getting wider, which is a different question from how far price moved. */
      var n = bs.length, rg = new Array(n), i;
      for (i = 0; i < n; i++) rg[i] = bs[i].h - bs[i].l;
      var e = M.ema(rg, num(p, "len", 10)), rp = num(p, "roc", 10), o = nulls(n);
      for (i = rp; i < n; i++) o[i] = (e[i] == null || e[i - rp] == null || !e[i - rp]) ? null : (e[i] - e[i - rp]) / e[i - rp] * 100;
      return { rows: [line(o, s.c || C_SAND, 1.4, 0, "Chaikin vol %")], zero: true };
    })
  });

  R("natr", {
    name: "Normalized ATR", g: "Volatility", over: false, h: 0.13,
    in: [{ k: "len", l: "Length", d: 14 }],
    calc: safe("natr", function (bs, p, s) {
      var a = M.atr(bs, num(p, "len", 14)), n = bs.length, o = new Array(n), i;
      for (i = 0; i < n; i++) o[i] = (a[i] == null || !bs[i].c) ? null : a[i] / bs[i].c * 100;
      return { rows: [line(o, s.c || C_SAND, 1.4, 0, "NATR %")] };
    })
  });

  R("sterr", {
    name: "Standard Error", g: "Volatility", over: false, h: 0.13,
    in: [{ k: "len", l: "Length", d: 21 }, { k: "src", l: "Source", d: "close", opts: SRC }],
    calc: safe("sterr", function (bs, p, s) {
      /* how far the price has been from its own regression line, which is what the
         Standard Error Bands are built out of — worth a pane of its own. */
      var L = clamp(num(p, "len", 21), 3, 600);
      return { rows: [line(regWin(M.src(bs, p.src || "close"), L).see, s.c || C_MAGENTA, 1.4, 0, "Std error")] };
    })
  });

  R("rvolat", {
    name: "Relative Volatility Index", g: "Volatility", over: false, h: 0.14,
    in: [{ k: "len", l: "StdDev length", d: 10 }, { k: "sm", l: "Smoothing", d: 14 }],
    calc: safe("rvolat", function (bs, p, s) {
      /* Dorsey's RVI is RSI with standard deviation in place of price change: it
         answers which SIDE the volatility came from, not how much there was. */
      var x = M.src(bs, "close"), n = bs.length, sd = M.stdev(x, num(p, "len", 10));
      var up = new Array(n), dn = new Array(n), i;
      for (i = 0; i < n; i++) {
        var d2 = i ? x[i] - x[i - 1] : 0, v = sd[i] == null ? 0 : sd[i];
        up[i] = d2 > 0 ? v : 0; dn[i] = d2 < 0 ? v : 0;
      }
      var S2 = num(p, "sm", 14), au = M.rma(up, S2), ad = M.rma(dn, S2), o = new Array(n);
      for (i = 0; i < n; i++) o[i] = (au[i] == null || ad[i] == null) ? null : (au[i] + ad[i] ? 100 * au[i] / (au[i] + ad[i]) : 50);
      return { rows: [line(o, s.c || C_VIOLET, 1.4, 0, "RVI")], range: [0, 100], levels: [{ v: 60, dash: 4 }, { v: 50, dash: 2 }, { v: 40, dash: 4 }] };
    })
  });

  R("gkvol", {
    name: "Garman–Klass volatility", g: "Volatility", over: false, h: 0.14,
    in: [{ k: "len", l: "Length", d: 20 }],
    calc: safe("gkvol", function (bs, p, s) {
      /* the range estimator: a bar's high and low carry far more information about
         its variance than its close does, so this needs roughly a fifth of the
         history a close-to-close reading would to say the same thing. The
         annualisation factor is read off the series' own bar size. */
      var L = clamp(num(p, "len", 20), 2, 400), n = bs.length, v = new Array(n), i, j;
      for (i = 0; i < n; i++) {
        var b = bs[i];
        if (!(b.h > 0 && b.l > 0 && b.o > 0 && b.c > 0)) { v[i] = null; continue; }
        var a = Math.log(b.h / b.l), c = Math.log(b.c / b.o);
        v[i] = 0.5 * a * a - (2 * Math.LN2 - 1) * c * c;
      }
      var ms = barMs(bs), yr = ms > 0 ? 31557600000 / ms : 365;
      var o = nulls(n);
      for (i = L - 1; i < n; i++) {
        var acc = 0, cnt = 0;
        for (j = i - L + 1; j <= i; j++) if (v[j] != null) { acc += v[j]; cnt++; }
        if (!cnt) continue;
        var mv = acc / cnt;
        o[i] = mv > 0 ? Math.sqrt(mv * yr) * 100 : 0;
      }
      return { rows: [line(o, s.c || C_CORAL, 1.4, 0, "GK vol %")] };
    })
  });

  /* =====================================================================
     STATISTICS
     ===================================================================== */

  R("zscore", {
    name: "Z-Score", g: "Statistics", over: false, h: 0.14,
    in: [{ k: "len", l: "Length", d: 20 }, { k: "src", l: "Source", d: "close", opts: SRC }],
    calc: safe("zscore", function (bs, p, s) {
      /* how many standard deviations the price sits from its own mean — the only
         reading here that is directly comparable between two different markets. */
      var L = num(p, "len", 20), x = M.src(bs, p.src || "close"), m = M.sma(x, L), sd = M.stdev(x, L);
      var n = bs.length, o = new Array(n), i;
      for (i = 0; i < n; i++) o[i] = (m[i] == null || sd[i] == null || !sd[i]) ? null : (x[i] - m[i]) / sd[i];
      return { rows: [line(o, s.c || C_BLUE, 1.4, 0, "Z " + L)], zero: true, levels: [{ v: 2, dash: 4 }, { v: 0, dash: 2 }, { v: -2, dash: 4 }] };
    })
  });

  R("lrslope", {
    name: "Linear Regression Slope", g: "Statistics", over: false, h: 0.14,
    in: [{ k: "len", l: "Length", d: 20 }, { k: "src", l: "Source", d: "close", opts: SRC }],
    calc: safe("lrslope", function (bs, p, s) {
      /* price units gained per bar by the best-fit line. Sign is direction, size is
         how steep, and zero is where a trend stops being one. */
      var L = clamp(num(p, "len", 20), 3, 600);
      return { rows: [line(regWin(M.src(bs, p.src || "close"), L).slope, s.c || C_SKY, 1.4, 0, "Slope " + L)], zero: true };
    })
  });

  R("lrr2", {
    name: "Linear Regression R²", g: "Statistics", over: false, h: 0.13,
    in: [{ k: "len", l: "Length", d: 20 }, { k: "src", l: "Source", d: "close", opts: SRC }],
    calc: safe("lrr2", function (bs, p, s) {
      /* how much of the window's movement the straight line accounts for. It says
         nothing about direction — read it next to the slope, never instead of it. */
      var L = clamp(num(p, "len", 20), 3, 600);
      return {
        rows: [line(regWin(M.src(bs, p.src || "close"), L).r2, s.c || C_MINT, 1.4, 0, "R² " + L)],
        range: [0, 1], levels: [{ v: 0.8, dash: 4, label: "strong fit" }, { v: 0.2, dash: 4 }]
      };
    })
  });

  R("pctrank", {
    name: "Percentile Rank", g: "Statistics", over: false, h: 0.14,
    in: [{ k: "len", l: "Lookback", d: 100 }, { k: "src", l: "Source", d: "close", opts: SRC }],
    calc: safe("pctrank", function (bs, p, s) {
      /* the share of the last n readings this one is above. A flat 100 for many
         bars is a market at the top of its own range, which is worth seeing. */
      var L = clamp(num(p, "len", 100), 2, 400), x = M.src(bs, p.src || "close"), n = bs.length, o = nulls(n), i, j;
      for (i = L; i < n; i++) {
        var cnt = 0;
        for (j = i - L; j < i; j++) if (x[j] < x[i]) cnt++;
        o[i] = cnt / L * 100;
      }
      return { rows: [line(o, s.c || C_VIOLET, 1.4, 0, "Rank %")], range: [0, 100], levels: [{ v: 80, dash: 4 }, { v: 50, dash: 2 }, { v: 20, dash: 4 }] };
    })
  });

  R("pricesrc", {
    name: "Price Sources", g: "Statistics", over: true,
    in: [{ k: "median", l: "Median (hl2)", d: "on", opts: ONOFF }, { k: "typical", l: "Typical (hlc3)", d: "on", opts: ONOFF },
      { k: "weighted", l: "Weighted close", d: "off", opts: ONOFF }, { k: "average", l: "Average (ohlc4)", d: "off", opts: ONOFF }],
    calc: safe("pricesrc", function (bs, p) {
      /* the four prices every other study quietly chooses between, drawn so the
         choice can be seen rather than assumed. */
      var n = bs.length, rows = [], i;
      if (on(p, "median")) rows.push(line(M.src(bs, "hl2"), C_BLUE, 1.2, 0, "Median"));
      if (on(p, "typical")) rows.push(line(M.src(bs, "hlc3"), C_GOLD, 1.2, 0, "Typical"));
      if (on(p, "weighted")) {
        var wc = new Array(n);
        for (i = 0; i < n; i++) wc[i] = (bs[i].h + bs[i].l + 2 * bs[i].c) / 4;
        rows.push(line(wc, C_TEAL, 1.2, 0, "Weighted close"));
      }
      if (on(p, "average")) rows.push(line(M.src(bs, "ohlc4"), C_VIOLET, 1.2, 0, "Average"));
      return { rows: rows };
    })
  });

  /* =====================================================================
     PATTERNS
     ===================================================================== */

  /* Twenty-eight named formations, tested in order of how much evidence each one
     needs: a three-bar pattern beats a two-bar one that is part of it, and a
     one-bar shape is only reported when nothing larger explains the bar. The
     shape tests are all relative to the bar's own range, so they behave the same
     on a 4-dollar coin and a 40,000-dollar one. `d` is +1 bullish, -1 bearish,
     0 for the formations that are genuinely undecided (doji, spinning top,
     inside and outside bars) — those are not dressed up as signals. */
  function candlePatterns(bs) {
    var n = bs.length, out = nulls(n), i;
    var body = new Array(n), rng = new Array(n), ush = new Array(n), lsh = new Array(n), bull = new Array(n), mid = new Array(n);
    for (i = 0; i < n; i++) {
      var b = bs[i];
      body[i] = Math.abs(b.c - b.o); rng[i] = b.h - b.l;
      ush[i] = b.h - Math.max(b.o, b.c); lsh[i] = Math.min(b.o, b.c) - b.l;
      bull[i] = b.c >= b.o; mid[i] = (b.o + b.c) / 2;
    }
    var avg = M.smaN(body, 14);
    function doji(i2) { return rng[i2] > 0 && body[i2] <= rng[i2] * 0.08; }
    function small(i2) { return rng[i2] > 0 && body[i2] <= rng[i2] * 0.34; }
    function big(i2) { return rng[i2] > 0 && body[i2] >= rng[i2] * 0.6 && (avg[i2] == null || body[i2] >= avg[i2]); }
    function upTr(i2) { return i2 >= 5 && bs[i2 - 1].c > bs[i2 - 5].c; }
    function dnTr(i2) { return i2 >= 5 && bs[i2 - 1].c < bs[i2 - 5].c; }
    function near(a, b2, i2) { return rng[i2] > 0 && Math.abs(a - b2) <= rng[i2] * 0.06; }
    function set(i2, nm, d) { out[i2] = { n: nm, d: d }; }

    for (i = 1; i < n; i++) {
      var o = bs[i].o, c = bs[i].c, h = bs[i].h, l = bs[i].l;
      var po = bs[i - 1].o, pc = bs[i - 1].c, ph = bs[i - 1].h, pl = bs[i - 1].l;
      /* --- three-bar formations, most evidence first --- */
      if (i >= 2) {
        var qo = bs[i - 2].o, qc = bs[i - 2].c;
        if (bull[i] && bull[i - 1] && bull[i - 2] && big(i) && big(i - 1) && big(i - 2) &&
          c > pc && pc > qc && o > qo && o < pc && po > qo && po < qc) { set(i, "3 Soldiers", 1); continue; }
        if (!bull[i] && !bull[i - 1] && !bull[i - 2] && big(i) && big(i - 1) && big(i - 2) &&
          c < pc && pc < qc && o < qo && o > pc && po < qo && po > qc) { set(i, "3 Crows", -1); continue; }
        if (!bull[i - 2] && big(i - 2) && bull[i - 1] && Math.max(po, pc) <= qo && Math.min(po, pc) >= qc &&
          bull[i] && c > qo) { set(i, "3 Inside Up", 1); continue; }
        if (bull[i - 2] && big(i - 2) && !bull[i - 1] && Math.max(po, pc) <= qc && Math.min(po, pc) >= qo &&
          !bull[i] && c < qo) { set(i, "3 Inside Down", -1); continue; }
        if (!bull[i - 2] && big(i - 2) && small(i - 1) && Math.max(po, pc) < qc && bull[i] && c > (qo + qc) / 2) { set(i, "Morning Star", 1); continue; }
        if (bull[i - 2] && big(i - 2) && small(i - 1) && Math.min(po, pc) > qc && !bull[i] && c < (qo + qc) / 2) { set(i, "Evening Star", -1); continue; }
      }
      /* --- two-bar formations --- */
      if (!bull[i - 1] && bull[i] && o <= pc && c >= po && body[i] > body[i - 1]) { set(i, "Bull Engulf", 1); continue; }
      if (bull[i - 1] && !bull[i] && o >= pc && c <= po && body[i] > body[i - 1]) { set(i, "Bear Engulf", -1); continue; }
      if (!bull[i - 1] && big(i - 1) && bull[i] && o < pl && c > (po + pc) / 2 && c < po) { set(i, "Piercing", 1); continue; }
      if (bull[i - 1] && big(i - 1) && !bull[i] && o > ph && c < (po + pc) / 2 && c > po) { set(i, "Dark Cloud", -1); continue; }
      if (big(i - 1) && doji(i) && Math.max(o, c) <= Math.max(po, pc) && Math.min(o, c) >= Math.min(po, pc)) { set(i, "Harami Cross", bull[i - 1] ? -1 : 1); continue; }
      if (!bull[i - 1] && big(i - 1) && bull[i] && c <= po && o >= pc) { set(i, "Bull Harami", 1); continue; }
      if (bull[i - 1] && big(i - 1) && !bull[i] && c >= po && o <= pc) { set(i, "Bear Harami", -1); continue; }
      if (!bull[i - 1] && big(i - 1) && bull[i] && big(i) && o >= po) { set(i, "Bull Kicker", 1); continue; }
      if (bull[i - 1] && big(i - 1) && !bull[i] && big(i) && o <= po) { set(i, "Bear Kicker", -1); continue; }
      if (near(h, ph, i) && bull[i - 1] && !bull[i] && upTr(i)) { set(i, "Tweezer Top", -1); continue; }
      if (near(l, pl, i) && !bull[i - 1] && bull[i] && dnTr(i)) { set(i, "Tweezer Bottom", 1); continue; }
      /* --- one-bar shapes --- */
      if (rng[i] > 0 && body[i] >= rng[i] * 0.85 && ush[i] <= rng[i] * 0.06 && lsh[i] <= rng[i] * 0.06) { set(i, bull[i] ? "Marubozu ↑" : "Marubozu ↓", bull[i] ? 1 : -1); continue; }
      if (doji(i) && lsh[i] >= rng[i] * 0.6 && ush[i] <= rng[i] * 0.12) { set(i, "Dragonfly", 1); continue; }
      if (doji(i) && ush[i] >= rng[i] * 0.6 && lsh[i] <= rng[i] * 0.12) { set(i, "Gravestone", -1); continue; }
      if (doji(i)) { set(i, "Doji", 0); continue; }
      if (small(i) && lsh[i] >= body[i] * 2 && ush[i] <= body[i] * 0.7) { if (dnTr(i)) { set(i, "Hammer", 1); continue; } if (upTr(i)) { set(i, "Hanging Man", -1); continue; } }
      if (small(i) && ush[i] >= body[i] * 2 && lsh[i] <= body[i] * 0.7) { if (dnTr(i)) { set(i, "Inv Hammer", 1); continue; } if (upTr(i)) { set(i, "Shooting Star", -1); continue; } }
      if (small(i) && ush[i] >= body[i] && lsh[i] >= body[i]) { set(i, "Spinning Top", 0); continue; }
      if (h <= ph && l >= pl) { set(i, "Inside Bar", 0); continue; }
      if (h > ph && l < pl) { set(i, "Outside Bar", 0); continue; }
    }
    return out;
  }

  R("candlepat", {
    name: "Candlestick Patterns", g: "Patterns", over: true,
    in: [{ k: "side", l: "Show", d: "both", opts: ["both", "bullish only", "bearish only"] },
      { k: "neutral", l: "Undecided shapes", d: "off", opts: ONOFF },
      { k: "txt", l: "Names", d: "on", opts: ONOFF }],
    calc: safe("candlepat", function (bs, p) {
      var n = bs.length, pt = candlePatterns(bs), a = M.atr(bs, 14);
      var mk = nulls(n), lb = nulls(n), i;
      var wantB = p.side !== "bearish only", wantS = p.side !== "bullish only", wantN = on(p, "neutral");
      for (i = 0; i < n; i++) {
        var q = pt[i];
        if (!q) continue;
        if (q.d > 0 && !wantB) continue;
        if (q.d < 0 && !wantS) continue;
        if (!q.d && !wantN) continue;
        var pad = a[i] == null ? 0 : a[i] * 0.4;
        var c2 = q.d > 0 ? C_UP : q.d < 0 ? C_DN : pal().text;
        /* drawShapeRow anchors the triangle's apex at v, so the wedge that points
           UP is the one it calls "down" — a bullish mark therefore sits under the
           bar as "down", and a bearish mark over it as "up". */
        mk[i] = { v: q.d > 0 ? bs[i].l - pad : q.d < 0 ? bs[i].h + pad : bs[i].c, s: q.d > 0 ? "down" : q.d < 0 ? "up" : "circle", c: c2 };
        if (on(p, "txt")) lb[i] = { v: q.d > 0 ? bs[i].l - pad * 2.2 : q.d < 0 ? bs[i].h + pad * 2.2 : bs[i].c, txt: q.n, c: c2, fs: 9 };
      }
      var rows = [{ kind: "shapes", data: mk, name: "Pattern" }];
      if (on(p, "txt")) rows.push({ kind: "labels", data: lb, name: "Pattern name" });
      return { rows: rows };
    })
  });

  R("diverg", {
    name: "Divergence Detector", g: "Patterns", over: true,
    in: [{ k: "osc", l: "Oscillator", d: "rsi", opts: ["rsi", "macd", "obv", "cci", "mfi"] },
      { k: "len", l: "Oscillator length", d: 14 }, { k: "lb", l: "Pivot lookback", d: 5 },
      { k: "span", l: "Max pivot distance", d: 60 }, { k: "hidden", l: "Hidden divergences", d: "on", opts: ONOFF },
      { k: "max", l: "Most recent", d: 12 }],
    calc: safe("diverg", function (bs, p) {
      /* A divergence is a claim about two pivots, so both of them have to be
         confirmed before it can be drawn — the right-hand pivot needs `lb` bars
         after it, and until those close nothing is plotted. Anything that repaints
         the last bar is not a divergence, it is a guess. */
      var n = bs.length, L = clamp(num(p, "lb", 5), 1, 30), span = clamp(num(p, "span", 60), 5, 400);
      var maxN = clamp(num(p, "max", 12), 1, 40), oL = num(p, "len", 14);
      var kind = p.osc || "rsi", x = M.src(bs, "close"), osc;
      if (kind === "macd") osc = M.macd(x, 12, 26, 9).hist;
      else if (kind === "obv") osc = M.obv(bs);
      else if (kind === "cci") osc = M.cci(bs, oL);
      else if (kind === "mfi") osc = M.mfi(bs, oL);
      else osc = M.rsi(x, oL);
      var sw = swings(bs, L, L), found = [], i;
      var lastH = -1, lastL = -1;
      for (i = 0; i < n; i++) {
        if (sw.ph[i] != null) {
          if (lastH >= 0 && i - lastH <= span && osc[i] != null && osc[lastH] != null) {
            if (bs[i].h > bs[lastH].h && osc[i] < osc[lastH]) found.push({ a: lastH, b: i, pa: bs[lastH].h, pb: bs[i].h, t: "Bear", c: C_DN });
            else if (on(p, "hidden") && bs[i].h < bs[lastH].h && osc[i] > osc[lastH]) found.push({ a: lastH, b: i, pa: bs[lastH].h, pb: bs[i].h, t: "H-Bear", c: C_CORAL });
          }
          lastH = i;
        }
        if (sw.pl[i] != null) {
          if (lastL >= 0 && i - lastL <= span && osc[i] != null && osc[lastL] != null) {
            if (bs[i].l < bs[lastL].l && osc[i] > osc[lastL]) found.push({ a: lastL, b: i, pa: bs[lastL].l, pb: bs[i].l, t: "Bull", c: C_UP });
            else if (on(p, "hidden") && bs[i].l > bs[lastL].l && osc[i] < osc[lastL]) found.push({ a: lastL, b: i, pa: bs[lastL].l, pb: bs[i].l, t: "H-Bull", c: C_MINT });
          }
          lastL = i;
        }
      }
      found = found.slice(Math.max(0, found.length - maxN));
      var rows = [], lb = nulls(n), j;
      for (j = 0; j < found.length; j++) {
        var f = found[j];
        rows.push(line(seg(n, f.a, f.pa, f.b, f.pb), f.c, 1.4, 0, f.t));
        lb[f.b] = { v: f.pb, txt: f.t, c: f.c, fs: 9, below: f.t.indexOf("Bull") >= 0 };
      }
      if (!rows.length) return { rows: [{ kind: "labels", data: lb, name: "no divergence in range" }] };
      rows.push({ kind: "labels", data: lb, name: "Divergence" });
      return { rows: rows };
    })
  });

  /* =====================================================================
     MARKET STRUCTURE
     These five are the scripts most often asked for, and the ones most often
     shipped badly. Three rules are kept throughout: a swing is only a swing
     once the bars to its right have closed; a zone stops where it is
     invalidated rather than running to the edge of the screen; and every
     label says which of the two things it is, never a generic arrow.
     ===================================================================== */

  R("oblocks", {
    name: "Order Blocks", g: "Market structure", over: true,
    in: [{ k: "lb", l: "Swing lookback", d: 5 }, { k: "mult", l: "Displacement × ATR", d: 1.5, step: 0.1 },
      { k: "zone", l: "Zone", d: "body", opts: ["body", "wick"] }, { k: "max", l: "Most recent", d: 5 },
      { k: "mit", l: "Stop at mitigation", d: "on", opts: ONOFF }],
    calc: safe("oblocks", function (bs, p) {
      /* An order block here is the last opposite-colour candle before a bar that
         both ran more than `mult` ATRs AND closed through the most recent
         confirmed swing. Without that second test any large candle qualifies,
         which is why so many versions of this draw boxes everywhere. */
      var n = bs.length, L = clamp(num(p, "lb", 5), 1, 30), mult = +p.mult || 1.5;
      var maxN = clamp(num(p, "max", 5), 1, 20), wick = p.zone === "wick", stop = on(p, "mit");
      var a = M.atr(bs, 14), sw = swings(bs, L, L), out = [], i, j;
      var lastH = null, lastL = null;
      for (i = 0; i < n; i++) {
        /* a swing at index i-L is only known now, L bars later */
        var ci = i - L;
        if (ci >= 0 && sw.ph[ci] != null) lastH = { i: ci, v: sw.ph[ci] };
        if (ci >= 0 && sw.pl[ci] != null) lastL = { i: ci, v: sw.pl[ci] };
        if (a[i] == null || !(bs[i].h - bs[i].l >= mult * a[i])) continue;
        var upBreak = lastH && bs[i].c > lastH.v && bs[i].c > bs[i].o;
        var dnBreak = lastL && bs[i].c < lastL.v && bs[i].c < bs[i].o;
        if (!upBreak && !dnBreak) continue;
        var ob = -1;
        for (j = i - 1; j >= Math.max(0, i - 12); j--) {
          if (upBreak && bs[j].c < bs[j].o) { ob = j; break; }
          if (dnBreak && bs[j].c > bs[j].o) { ob = j; break; }
        }
        if (ob < 0) continue;
        var top = wick ? bs[ob].h : Math.max(bs[ob].o, bs[ob].c);
        var bot = wick ? bs[ob].l : Math.min(bs[ob].o, bs[ob].c);
        var end = n - 1;
        if (stop) {
          for (j = i + 1; j < n; j++) {
            if (upBreak ? bs[j].l <= top : bs[j].h >= bot) { end = j; break; }
          }
        }
        out.push({ i: ob, end: end, top: top, bot: bot, up: !!upBreak });
      }
      out = out.slice(Math.max(0, out.length - maxN));
      var rows = [], lb = nulls(n), k;
      for (k = 0; k < out.length; k++) {
        var o = out[k];
        rows.push({ kind: "band", a: flat(n, o.i, o.end, o.top), b: flat(n, o.i, o.end, o.bot), c: o.up ? C_UP : C_DN, fill: 0.14, name: o.up ? "Bull OB" : "Bear OB" });
        lb[o.i] = { v: o.up ? o.bot : o.top, txt: o.up ? "OB+" : "OB−", c: o.up ? C_UP : C_DN, fs: 9, below: o.up };
      }
      if (!rows.length) return { rows: [{ kind: "labels", data: lb, name: "no order block in range" }] };
      rows.push({ kind: "labels", data: lb, name: "OB" });
      return { rows: rows };
    })
  });

  R("fvg", {
    name: "Fair Value Gaps", g: "Market structure", over: true,
    in: [{ k: "min", l: "Min size × ATR", d: 0.25, step: 0.05 }, { k: "max", l: "Most recent", d: 8 },
      { k: "fill", l: "Stop when filled", d: "on", opts: ONOFF }],
    calc: safe("fvg", function (bs, p) {
      /* Three bars, and the middle one moved far enough that the outer two never
         traded the same prices. The gap is that untraded band; it ends the first
         time price comes back through it, not at the right edge. */
      var n = bs.length, mn = +p.min || 0.25, maxN = clamp(num(p, "max", 8), 1, 30), stop = on(p, "fill");
      var a = M.atr(bs, 14), out = [], i, j;
      for (i = 2; i < n; i++) {
        if (a[i] == null) continue;
        var up = bs[i].l > bs[i - 2].h, dn = bs[i].h < bs[i - 2].l;
        if (!up && !dn) continue;
        var top = up ? bs[i].l : bs[i - 2].l, bot = up ? bs[i - 2].h : bs[i].h;
        if (!(top - bot >= mn * a[i])) continue;
        var end = n - 1;
        if (stop) for (j = i + 1; j < n; j++) { if (up ? bs[j].l <= bot : bs[j].h >= top) { end = j; break; } }
        out.push({ i: i - 2, end: end, top: top, bot: bot, up: up });
      }
      out = out.slice(Math.max(0, out.length - maxN));
      var rows = [], lb = nulls(n), k;
      for (k = 0; k < out.length; k++) {
        var f = out[k];
        rows.push({ kind: "band", a: flat(n, f.i, f.end, f.top), b: flat(n, f.i, f.end, f.bot), c: f.up ? C_UP : C_DN, fill: 0.12, name: f.up ? "Bull FVG" : "Bear FVG" });
        lb[f.i] = { v: (f.top + f.bot) / 2, txt: "FVG", c: f.up ? C_UP : C_DN, fs: 9 };
      }
      if (!rows.length) return { rows: [{ kind: "labels", data: lb, name: "no fair value gap in range" }] };
      rows.push({ kind: "labels", data: lb, name: "FVG" });
      return { rows: rows };
    })
  });

  R("mstruct", {
    name: "Market Structure (BOS / CHoCH)", g: "Market structure", over: true,
    in: [{ k: "lb", l: "Swing lookback", d: 5 }, { k: "max", l: "Most recent", d: 10 }],
    calc: safe("mstruct", function (bs, p) {
      /* The distinction is the entire point. A break in the SAME direction as the
         prevailing leg is a Break of Structure; the first break the other way is a
         Change of Character. Calling both "BOS" throws away the only signal. */
      var n = bs.length, L = clamp(num(p, "lb", 5), 1, 30), maxN = clamp(num(p, "max", 10), 1, 40);
      var sw = swings(bs, L, L), out = [], i;
      var hi = null, lo = null, dir = 0;
      for (i = 0; i < n; i++) {
        var ci = i - L;
        if (ci >= 0 && sw.ph[ci] != null) hi = { i: ci, v: sw.ph[ci] };
        if (ci >= 0 && sw.pl[ci] != null) lo = { i: ci, v: sw.pl[ci] };
        if (hi && bs[i].c > hi.v) {
          out.push({ a: hi.i, b: i, v: hi.v, t: dir === -1 ? "CHoCH" : "BOS", up: true });
          dir = 1; hi = null;
        } else if (lo && bs[i].c < lo.v) {
          out.push({ a: lo.i, b: i, v: lo.v, t: dir === 1 ? "CHoCH" : "BOS", up: false });
          dir = -1; lo = null;
        }
      }
      out = out.slice(Math.max(0, out.length - maxN));
      var rows = [], lb = nulls(n), k;
      for (k = 0; k < out.length; k++) {
        var e = out[k], c2 = e.t === "CHoCH" ? C_GOLD : (e.up ? C_UP : C_DN);
        rows.push(line(flat(n, e.a, e.b, e.v), c2, 1.2, 4, e.t));
        lb[e.b] = { v: e.v, txt: e.t, c: c2, fs: 9, below: !e.up };
      }
      if (!rows.length) return { rows: [{ kind: "labels", data: lb, name: "no structure break in range" }] };
      rows.push({ kind: "labels", data: lb, name: "Structure" });
      return { rows: rows };
    })
  });

  R("liqsweep", {
    name: "Liquidity Sweeps", g: "Market structure", over: true,
    in: [{ k: "lb", l: "Swing lookback", d: 4 }, { k: "tol", l: "Equal within × ATR", d: 0.12, step: 0.02 },
      { k: "span", l: "Sweep within bars", d: 60 }, { k: "max", l: "Most recent", d: 8 }],
    calc: safe("liqsweep", function (bs, p) {
      /* Two swings at the same price are where stops sit. A sweep is the bar that
         takes that price out and then CLOSES back inside — a close beyond it is a
         break, not a sweep, and the two are not marked the same. */
      var n = bs.length, L = clamp(num(p, "lb", 4), 1, 30), tolM = +p.tol || 0.12;
      var span = clamp(num(p, "span", 60), 3, 400), maxN = clamp(num(p, "max", 8), 1, 30);
      var a = M.atr(bs, 14), sw = swings(bs, L, L), out = [], i, j;
      var hs = [], ls = [];
      for (i = 0; i < n; i++) { if (sw.ph[i] != null) hs.push(i); if (sw.pl[i] != null) ls.push(i); }
      function scan(list, isHigh) {
        var q;
        for (q = 1; q < list.length; q++) {
          var x1 = list[q - 1], x2 = list[q];
          if (x2 - x1 > span) continue;
          var v1 = isHigh ? bs[x1].h : bs[x1].l, v2 = isHigh ? bs[x2].h : bs[x2].l;
          var tol = a[x2] == null ? 0 : a[x2] * tolM;
          if (Math.abs(v1 - v2) > tol) continue;
          var lvl = isHigh ? Math.max(v1, v2) : Math.min(v1, v2);
          for (j = x2 + 1; j < Math.min(n, x2 + 1 + span); j++) {
            if (isHigh ? bs[j].h > lvl : bs[j].l < lvl) {
              if (isHigh ? bs[j].c < lvl : bs[j].c > lvl) out.push({ a: x1, b: j, v: lvl, up: !isHigh });
              break;
            }
          }
        }
      }
      scan(hs, true); scan(ls, false);
      out.sort(function (x, y) { return x.b - y.b; });
      out = out.slice(Math.max(0, out.length - maxN));
      var rows = [], mk = nulls(n), lb = nulls(n), k;
      for (k = 0; k < out.length; k++) {
        var e = out[k], c2 = e.up ? C_UP : C_DN;
        rows.push(line(flat(n, e.a, e.b, e.v), c2, 1.2, 2, e.up ? "SSL" : "BSL"));
        mk[e.b] = { v: e.v, s: e.up ? "down" : "up", c: c2 };
        lb[e.b] = { v: e.v, txt: e.up ? "swept low" : "swept high", c: c2, fs: 9, below: e.up };
      }
      if (!rows.length) return { rows: [{ kind: "labels", data: lb, name: "no liquidity sweep in range" }] };
      rows.push({ kind: "shapes", data: mk, name: "Sweep" });
      rows.push({ kind: "labels", data: lb, name: "Sweep" });
      return { rows: rows };
    })
  });

  R("premdisc", {
    name: "Premium / Discount zones", g: "Market structure", over: true,
    in: [{ k: "len", l: "Range lookback", d: 120 }, { k: "ote", l: "Optimal entry band", d: "on", opts: ONOFF }],
    calc: safe("premdisc", function (bs, p) {
      /* The range is taken from a fixed bar lookback, NOT from the visible window:
         the engine only re-keys the study cache on the visible range for the four
         studies that declare it, so a window-dependent reading here would go stale
         the moment the chart is panned. */
      var n = bs.length, L = clamp(num(p, "len", 120), 10, 1500), from = Math.max(0, n - L);
      var hi = -Infinity, lo = Infinity, i;
      for (i = from; i < n; i++) { if (bs[i].h > hi) hi = bs[i].h; if (bs[i].l < lo) lo = bs[i].l; }
      if (!(hi > lo)) return { rows: [], note: "range has no height" };
      var eq = (hi + lo) / 2, rows = [];
      rows.push({ kind: "band", a: flat(n, from, n - 1, hi), b: flat(n, from, n - 1, eq), c: C_DN, fill: 0.09, name: "Premium" });
      rows.push({ kind: "band", a: flat(n, from, n - 1, eq), b: flat(n, from, n - 1, lo), c: C_UP, fill: 0.09, name: "Discount" });
      if (on(p, "ote")) {
        rows.push({ kind: "band", a: flat(n, from, n - 1, lo + (hi - lo) * 0.79), b: flat(n, from, n - 1, lo + (hi - lo) * 0.62), c: C_GOLD, fill: 0.12, name: "OTE short" });
        rows.push({ kind: "band", a: flat(n, from, n - 1, lo + (hi - lo) * 0.38), b: flat(n, from, n - 1, lo + (hi - lo) * 0.21), c: C_GOLD, fill: 0.12, name: "OTE long" });
      }
      return {
        rows: rows,
        levels: [{ v: hi, c: C_DN, dash: 2, label: "range high" }, { v: eq, c: pal().faint, dash: 4, label: "equilibrium" }, { v: lo, c: C_UP, dash: 2, label: "range low" }]
      };
    })
  });

  /* =====================================================================
     AUTO TOOLS
     ===================================================================== */

  R("autofib", {
    name: "Auto Fibonacci Retracement", g: "Auto tools", over: true,
    in: [{ k: "pct", l: "Swing deviation %", d: 5, step: 0.5 }, { k: "ext", l: "Extensions", d: "off", opts: ONOFF }],
    calc: safe("autofib", function (bs, p) {
      /* The swing comes from the engine's own ZigZag, so the levels move only when
         the ZigZag itself confirms a new leg — the same evidence the drawing tool
         would use if the leg were placed by hand. */
      var n = bs.length, pts = M.zigzag(bs, +p.pct || 5);
      if (pts.length < 2) return { rows: [], note: "no confirmed swing at this deviation" };
      var b = pts[pts.length - 1], a = pts[pts.length - 2], rng = b.p - a.p;
      if (!rng) return { rows: [], note: "the last swing has no height" };
      var fr = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
      if (on(p, "ext")) fr = fr.concat([1.272, 1.618]);
      var lv = [], i, cs = [C_UP, C_MINT, C_TEAL, pal().text, C_SAND, C_CORAL, C_DN, C_VIOLET, C_MAGENTA];
      for (i = 0; i < fr.length; i++) {
        lv.push({ v: b.p - rng * fr[i], c: cs[i % cs.length], dash: fr[i] === 0 || fr[i] === 1 ? 0 : 4, label: (fr[i] * 100).toFixed(1) + "%" });
      }
      return { rows: [line(seg(n, a.i, a.p, b.i, b.p), pal().faint, 1.2, 2, "swing")], levels: lv };
    })
  });

  R("autosr", {
    name: "Auto Support & Resistance", g: "Auto tools", over: true,
    in: [{ k: "lb", l: "Pivot lookback", d: 6 }, { k: "tol", l: "Cluster within × ATR", d: 0.5, step: 0.1 },
      { k: "min", l: "Min touches", d: 2 }, { k: "max", l: "Lines", d: 6 }, { k: "len", l: "Bars considered", d: 400 }],
    calc: safe("autosr", function (bs, p) {
      /* Pivots are clustered by distance in ATRs rather than in percent, so one
         setting behaves the same on a quiet market and a violent one. A level is
         only drawn once enough separate pivots have actually touched it. */
      var n = bs.length, L = clamp(num(p, "lb", 6), 1, 30), tolM = +p.tol || 0.5;
      var minT = clamp(num(p, "min", 2), 1, 20), maxN = clamp(num(p, "max", 6), 1, 20);
      var from = Math.max(0, n - clamp(num(p, "len", 400), 20, 1500));
      var a = M.atr(bs, 14), sw = swings(bs, L, L), pts = [], i, j;
      for (i = from; i < n; i++) {
        if (sw.ph[i] != null) pts.push(sw.ph[i]);
        if (sw.pl[i] != null) pts.push(sw.pl[i]);
      }
      if (!pts.length) return { rows: [], note: "no confirmed pivot in the lookback" };
      pts.sort(function (x, y) { return x - y; });
      var tol = (a[n - 1] == null ? (pts[pts.length - 1] - pts[0]) / 40 : a[n - 1]) * tolM;
      var groups = [], cur = [pts[0]];
      for (i = 1; i < pts.length; i++) {
        if (pts[i] - cur[cur.length - 1] <= tol) cur.push(pts[i]);
        else { groups.push(cur); cur = [pts[i]]; }
      }
      groups.push(cur);
      var keep = [];
      for (i = 0; i < groups.length; i++) {
        if (groups[i].length < minT) continue;
        var sum = 0;
        for (j = 0; j < groups[i].length; j++) sum += groups[i][j];
        keep.push({ v: sum / groups[i].length, t: groups[i].length });
      }
      keep.sort(function (x, y) { return y.t - x.t; });
      keep = keep.slice(0, maxN);
      if (!keep.length) return { rows: [], note: "no level reached " + minT + " touches" };
      var last = bs[n - 1].c, lv = [];
      for (i = 0; i < keep.length; i++) {
        lv.push({ v: keep[i].v, c: keep[i].v >= last ? C_DN : C_UP, dash: keep[i].t >= minT + 2 ? 0 : 4, label: (keep[i].v >= last ? "R" : "S") + " ×" + keep[i].t });
      }
      return { rows: [], levels: lv };
    })
  });

  R("sessions", {
    name: "Trading Sessions", g: "Auto tools", over: true,
    in: [{ k: "asia", l: "Asia", d: "on", opts: ONOFF }, { k: "a0", l: "Asia open UTC", d: 0 }, { k: "a1", l: "Asia close UTC", d: 8 },
      { k: "lon", l: "London", d: "on", opts: ONOFF }, { k: "l0", l: "London open UTC", d: 7 }, { k: "l1", l: "London close UTC", d: 16 },
      { k: "ny", l: "New York", d: "on", opts: ONOFF }, { k: "n0", l: "New York open UTC", d: 12 }, { k: "n1", l: "New York close UTC", d: 21 }],
    calc: safe("sessions", function (bs, p) {
      /* Hours are UTC and nothing here reads the viewer's clock: a session band
         that moves when a laptop crosses a time zone is worse than none. The three
         windows overlap on purpose — the later one wins the column, which is the
         convention every desk uses for the London/New York hours. */
      var n = bs.length, bg = nulls(n), i;
      var ms = barMs(bs);
      if (ms >= 864e5) return { rows: [], note: "sessions need an intraday bar size" };
      function hrOf(t) { return ((t % 864e5) + 864e5) % 864e5 / 36e5; }
      function within(h, s2, e) {
        s2 = clamp(+s2 || 0, 0, 24); e = clamp(+e || 0, 0, 24);
        return s2 <= e ? (h >= s2 && h < e) : (h >= s2 || h < e);
      }
      for (i = 0; i < n; i++) {
        var h = hrOf(bs[i].t);
        if (on(p, "asia") && within(h, p.a0 == null ? 0 : p.a0, p.a1 == null ? 8 : p.a1)) bg[i] = C_VIOLET;
        if (on(p, "lon") && within(h, p.l0 == null ? 7 : p.l0, p.l1 == null ? 16 : p.l1)) bg[i] = C_BLUE;
        if (on(p, "ny") && within(h, p.n0 == null ? 12 : p.n0, p.n1 == null ? 21 : p.n1)) bg[i] = C_GOLD;
      }
      return { rows: [{ kind: "bg", data: bg, alpha: 0.1, name: "Session" }] };
    })
  });

  /* =====================================================================
     TECHNICAL RATING
     ---------------------------------------------------------------------
     The score is computed from the engine's OWN indicator outputs — M.rsi,
     M.stoch, M.cci, M.dmi, M.ao, M.mom, M.macd, M.stochRsi, M.willr,
     M.elder, M.uo, M.sma, M.ema, M.vwma, M.hma, M.ichimoku — never from a
     weighting table invented here. Twenty-six voters, each returning +1, 0
     or -1, averaged within their half. The rule set is TradingView's
     published Technical Ratings definition, written out so it can be
     checked against the source rather than trusted:

       MOVING AVERAGES (15)  SMA and EMA at 10/20/30/50/100/200, VWMA 20,
         HMA 9, and the Ichimoku base line.
         · every MA:   ma < close -> buy,  ma > close -> sell, else neutral
         · Ichimoku:   buy  when leadA > leadB and close > leadA and
                             close < conversion and conversion > base
                       sell when leadB > leadA and close < leadB and
                             close > conversion and conversion < base
       OSCILLATORS (11)
         · RSI 14      < 30 and rising -> buy; > 70 and falling -> sell
         · Stoch 14,3,3  k<20 and d<20 and k>d -> buy; k>80 and d>80 and k<d -> sell
         · CCI 20      < -100 and rising -> buy; > 100 and falling -> sell
         · ADX 14      adx>20 and DI+ crossed above DI- -> buy; crossed below -> sell
         · AO          cross up through zero, or above zero and rising -> buy; mirrored -> sell
         · Momentum 10 rising -> buy; falling -> sell
         · MACD 12,26,9  line > signal -> buy; line < signal -> sell
         · Stoch RSI   in a downtrend with k<20,d<20,k>d -> buy;
                       in an uptrend with k>80,d>80,k<d -> sell
         · Williams %R in a downtrend and < -80 and rising -> buy; mirrored -> sell
         · Bull Bear Power 13  uptrend with bear power < 0 and rising -> buy;
                       downtrend with bull power > 0 and falling -> sell
         · Ultimate Oscillator > 70 -> buy; < 30 -> sell
       Trend context for the three rules that need one is the close against
       its own 50-bar SMA. A voter whose window has not filled yet does not
       vote and does not count against the average — it is absent, not zero.
     ===================================================================== */

  function ratingSeries(bs) {
    var n = bs.length, x = M.src(bs, "close"), i, k;
    var lens = [10, 20, 30, 50, 100, 200], mas = [];
    for (k = 0; k < lens.length; k++) mas.push(M.sma(x, lens[k]));
    for (k = 0; k < lens.length; k++) mas.push(M.ema(x, lens[k]));
    mas.push(M.vwma(bs, 20));
    mas.push(M.hma(x, 9));
    var ich = M.ichimoku(bs, 9, 26, 52, 26), disp = ich.disp;
    var rsi = M.rsi(x, 14), st = M.stoch(bs, 14, 3, 3), cci = M.cci(bs, 20), dmi = M.dmi(bs, 14, 14);
    var ao = M.ao(bs), mom = M.mom(x, 10), mac = M.macd(x, 12, 26, 9), sr = M.stochRsi(x, 14, 14, 3, 3);
    var wr = M.willr(bs, 14), el = M.elder(bs, 13), uo = M.uo(bs, 7, 14, 28), sma50 = M.sma(x, 50);
    var maR = nulls(n), osR = nulls(n), all = nulls(n);

    function vote(v, up, dn) { return v ? (up ? 1 : dn ? -1 : 0) : 0; }

    for (i = 1; i < n; i++) {
      var c = x[i], mv = 0, mc = 0, ov = 0, oc = 0, j;
      for (j = 0; j < mas.length; j++) {
        var m = mas[j][i];
        if (m == null) continue;
        mc++; mv += m < c ? 1 : m > c ? -1 : 0;
      }
      var lA = ich.spanA[i + disp], lB = ich.spanB[i + disp], tk = ich.tenkan[i], kj = ich.kijun[i];
      if (lA != null && lB != null && tk != null && kj != null) {
        mc++;
        mv += (lA > lB && c > lA && c < tk && tk > kj) ? 1 : (lB > lA && c < lB && c > tk && tk < kj) ? -1 : 0;
      }
      var upT = sma50[i] != null && c > sma50[i], dnT = sma50[i] != null && c < sma50[i];
      if (rsi[i] != null && rsi[i - 1] != null) { oc++; ov += vote(1, rsi[i] < 30 && rsi[i] > rsi[i - 1], rsi[i] > 70 && rsi[i] < rsi[i - 1]); }
      if (st.k[i] != null && st.d[i] != null) { oc++; ov += vote(1, st.k[i] < 20 && st.d[i] < 20 && st.k[i] > st.d[i], st.k[i] > 80 && st.d[i] > 80 && st.k[i] < st.d[i]); }
      if (cci[i] != null && cci[i - 1] != null) { oc++; ov += vote(1, cci[i] < -100 && cci[i] > cci[i - 1], cci[i] > 100 && cci[i] < cci[i - 1]); }
      if (dmi.adx[i] != null && dmi.pdi[i] != null && dmi.pdi[i - 1] != null && dmi.ndi[i - 1] != null) {
        oc++;
        ov += vote(1, dmi.adx[i] > 20 && dmi.pdi[i - 1] < dmi.ndi[i - 1] && dmi.pdi[i] > dmi.ndi[i],
          dmi.adx[i] > 20 && dmi.pdi[i - 1] > dmi.ndi[i - 1] && dmi.pdi[i] < dmi.ndi[i]);
      }
      if (ao[i] != null && ao[i - 1] != null) {
        oc++;
        ov += vote(1, (ao[i] > 0 && ao[i - 1] < 0) || (ao[i] > 0 && ao[i] > ao[i - 1]),
          (ao[i] < 0 && ao[i - 1] > 0) || (ao[i] < 0 && ao[i] < ao[i - 1]));
      }
      if (mom[i] != null && mom[i - 1] != null) { oc++; ov += vote(1, mom[i] > mom[i - 1], mom[i] < mom[i - 1]); }
      if (mac.line[i] != null && mac.sig[i] != null) { oc++; ov += vote(1, mac.line[i] > mac.sig[i], mac.line[i] < mac.sig[i]); }
      if (sr.k[i] != null && sr.d[i] != null) { oc++; ov += vote(1, dnT && sr.k[i] < 20 && sr.d[i] < 20 && sr.k[i] > sr.d[i], upT && sr.k[i] > 80 && sr.d[i] > 80 && sr.k[i] < sr.d[i]); }
      if (wr[i] != null && wr[i - 1] != null) { oc++; ov += vote(1, dnT && wr[i] < -80 && wr[i] > wr[i - 1], upT && wr[i] > -20 && wr[i] < wr[i - 1]); }
      if (el.bull[i] != null && el.bear[i] != null && el.bull[i - 1] != null && el.bear[i - 1] != null) {
        oc++;
        ov += vote(1, upT && el.bear[i] < 0 && el.bear[i] > el.bear[i - 1], dnT && el.bull[i] > 0 && el.bull[i] < el.bull[i - 1]);
      }
      if (uo[i] != null) { oc++; ov += vote(1, uo[i] > 70, uo[i] < 30); }
      if (mc) maR[i] = mv / mc;
      if (oc) osR[i] = ov / oc;
      if (mc && oc) all[i] = (maR[i] + osR[i]) / 2;
      else if (mc) all[i] = maR[i];
      else if (oc) all[i] = osR[i];
    }
    return { ma: maR, osc: osR, all: all, voters: mas.length + 1 + 11 };
  }

  R("techrating", {
    name: "Technical Rating", g: "Ratings", over: false, h: 0.18,
    in: [{ k: "halves", l: "Show the two halves", d: "on", opts: ONOFF }],
    calc: safe("techrating", function (bs, p) {
      var r = ratingSeries(bs), n = bs.length, cols = new Array(n), i;
      for (i = 0; i < n; i++) cols[i] = r.all[i] == null ? pal().faint : r.all[i] >= 0.1 ? C_UP : r.all[i] <= -0.1 ? C_DN : pal().faint;
      var rows = [{ kind: "cols", data: r.all, cols: cols, base: 0, c: C_BLUE, alpha: 0.6, name: "Rating (" + r.voters + " voters)" }];
      if (on(p, "halves")) {
        rows.push(line(r.ma, C_GOLD, 1.3, 0, "Moving averages"));
        rows.push(line(r.osc, C_CYAN, 1.3, 0, "Oscillators"));
      }
      rows.push(line(r.all, C_BLUE, 1.6, 0, "All"));
      return {
        rows: rows, range: [-1, 1],
        levels: [{ v: 0.5, c: C_UP, dash: 4, label: "strong buy" }, { v: 0.1, c: C_UP, dash: 2, label: "buy" },
          { v: 0, dash: 2 }, { v: -0.1, c: C_DN, dash: 2, label: "sell" }, { v: -0.5, c: C_DN, dash: 4, label: "strong sell" }]
      };
    })
  });

  /* =====================================================================
     DERIVATIVES — Binance USD-M futures
     ---------------------------------------------------------------------
     calc is synchronous and the renderer will not wait, so each of these
     starts a fetch on its first call, caches the answer per symbol+period,
     and returns a pane that SAYS it is loading. When the request lands it
     fills the very rows object the engine cached — the study cache keys on
     bars and parameters, not on network state, so mutating the cached
     result in place is the only way the next frame can see it — and then
     asks for a repaint. A symbol with no perpetual, or a request that
     fails, returns no series and prints why. Nothing is ever filled in.
     ===================================================================== */

  var DVC = {};
  var DV_PERIODS = ["5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d"];
  var DV_MS = { "5m": 3e5, "15m": 9e5, "30m": 18e5, "1h": 36e5, "2h": 72e5, "4h": 144e5, "6h": 216e5, "12h": 432e5, "1d": 864e5 };

  function perpSym() {
    var s = "BTC";
    try { s = String(K.symKey() || "BTC-USDT").split("-")[0] || "BTC"; } catch (e) { }
    return s.toUpperCase() + "USDT";
  }
  /* the futures-data endpoints take a fixed set of periods; pick the closest one
     at or below the chart's bar size so the fetched series is never coarser than
     what it is being drawn against. */
  function dvPeriod(bs) {
    var ms = barMs(bs) || 36e5, best = DV_PERIODS[0], i;
    for (i = 0; i < DV_PERIODS.length; i++) if (DV_MS[DV_PERIODS[i]] <= ms) best = DV_PERIODS[i];
    return best;
  }
  function alignTo(bs, pts, holdMs) {
    var n = bs.length, o = nulls(n), i, j = 0, lastV = null, lastT = 0;
    for (i = 0; i < n; i++) {
      while (j < pts.length && pts[j].t <= bs[i].t) { lastV = pts[j].v; lastT = pts[j].t; j++; }
      if (lastV != null && (!holdMs || bs[i].t - lastT <= holdMs)) o[i] = lastV;
    }
    return o;
  }
  function dvGet(ck, url, parse) {
    var e = DVC[ck];
    if (e) return e;
    e = DVC[ck] = { state: "loading", pts: null, err: "", waiting: [] };
    function settle() {
      var w = e.waiting, i;
      e.waiting = [];
      for (i = 0; i < w.length; i++) { try { w[i](e); } catch (x) { fault("dxstudies:dv-apply", x); } }
      try { mark(); } catch (x2) { fault("dxstudies:dv-mark", x2); }
    }
    try {
      K.jget(url, "dxc.dv." + ck, 3e5).then(function (raw) {
        var pts = null;
        try { pts = parse(raw); } catch (x) { fault("dxstudies:dv-parse", x); }
        if (!pts || !pts.length) { e.state = "err"; e.err = "no series for " + ck.split("|")[1]; }
        else { pts.sort(function (a, b) { return a.t - b.t; }); e.state = "ok"; e.pts = pts; }
        settle();
      }, function (err) {
        e.state = "err"; e.err = String((err && err.message) || err || "request failed");
        settle();
      });
    } catch (x3) {
      e.state = "err"; e.err = String((x3 && x3.message) || x3);
      fault("dxstudies:dv-start", x3);
    }
    return e;
  }
  /* one shape for all four: hand back a live rows object and let the fetch fill it */
  function dvSeries(bs, ck, url, parse, fill, what) {
    var out = { rows: [] }, n = bs.length;
    function say(txt) { out.rows = noteRows(txt, n, 0.5); out.range = [0, 1]; out.note = txt; }
    function apply(e) {
      if (e.state === "ok") {
        out.rows = [];
        out.range = null;
        out.note = null;
        fill(out, e.pts);
        if (!out.rows.length) say(what + " · no point lines up with these bars");
      } else say(what + " unavailable · " + e.err);
    }
    var ent = dvGet(ck, url, parse);
    if (ent.state === "loading") { say("loading " + what + " …"); ent.waiting.push(apply); }
    else apply(ent);
    return out;
  }
  function numArr(rows, tk, vk, mul) {
    if (!Array.isArray(rows)) return [];
    var o = [], i;
    for (i = 0; i < rows.length; i++) {
      var t = +rows[i][tk], v = +rows[i][vk];
      if (!isFinite(t) || !isFinite(v)) continue;
      o.push({ t: t, v: v * (mul || 1) });
    }
    return o;
  }

  R("dvfund", {
    name: "Perp funding rate (Binance)", g: "Derivatives", over: false, h: 0.14,
    in: [{ k: "ann", l: "Show as", d: "per 8h %", opts: ["per 8h %", "annualised %"] }],
    calc: safe("dvfund", function (bs, p) {
      /* Funding SETTLES, it does not tick: the rate holds from one settlement to
         the next, so it is drawn as a step and held forward only for one funding
         window. Beyond that there is no rate, and the line stops. */
      var sym = perpSym(), ann = p.ann === "annualised %";
      return dvSeries(bs, "fund|" + sym,
        "https://fapi.binance.com/fapi/v1/fundingRate?symbol=" + sym + "&limit=1000",
        function (raw) { return numArr(raw, "fundingTime", "fundingRate", 100); },
        function (out, pts) {
          var a = alignTo(bs, pts, 9 * 36e5), i;
          if (ann) for (i = 0; i < a.length; i++) if (a[i] != null) a[i] = a[i] * 3 * 365;
          out.rows = [{ kind: "step", data: a, c: C_GOLD, w: 1.5, name: "Funding " + (ann ? "APR %" : "8h %") }];
          out.zero = true;
          out.levels = [{ v: 0, dash: 2 }];
        }, sym + " funding");
    })
  });

  R("dvoi", {
    name: "Perp open interest (Binance)", g: "Derivatives", over: false, h: 0.15,
    in: [{ k: "unit", l: "Unit", d: "USD", opts: ["USD", "contracts"] }],
    calc: safe("dvoi", function (bs, p) {
      /* Binance keeps roughly thirty days of open-interest history, so on a long
         chart the series starts part-way in. That gap is left empty rather than
         back-filled with the oldest reading. */
      var sym = perpSym(), per = dvPeriod(bs), usd = p.unit !== "contracts";
      var field = usd ? "sumOpenInterestValue" : "sumOpenInterest";
      return dvSeries(bs, "oi|" + sym + "|" + per + "|" + field,
        "https://fapi.binance.com/futures/data/openInterestHist?symbol=" + sym + "&period=" + per + "&limit=500",
        function (raw) { return numArr(raw, "timestamp", field, 1); },
        function (out, pts) {
          out.rows = [{ kind: "area", data: alignTo(bs, pts, DV_MS[per] * 2), c: C_TEAL, fill: 0.14, base: null, w: 1.5, name: "OI " + (usd ? "USD" : "contracts") + " · " + per }];
          out.fmt = "vol";
        }, sym + " open interest");
    })
  });

  R("dvls", {
    name: "Perp long/short accounts (Binance)", g: "Derivatives", over: false, h: 0.14, in: [],
    calc: safe("dvls", function (bs) {
      /* This is the ACCOUNT ratio, not a position-size ratio: it counts traders,
         so one desk and one retail account weigh the same. Labelled as such. */
      var sym = perpSym(), per = dvPeriod(bs);
      return dvSeries(bs, "ls|" + sym + "|" + per,
        "https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=" + sym + "&period=" + per + "&limit=500",
        function (raw) { return numArr(raw, "timestamp", "longShortRatio", 1); },
        function (out, pts) {
          out.rows = [line(alignTo(bs, pts, DV_MS[per] * 2), C_VIOLET, 1.5, 0, "Long/short accounts · " + per)];
          out.levels = [{ v: 1, dash: 2, label: "even" }];
        }, sym + " long/short");
    })
  });

  R("dvbasis", {
    name: "Perp basis vs index (Binance)", g: "Derivatives", over: false, h: 0.14,
    in: [{ k: "unit", l: "Show as", d: "%", opts: ["%", "price"] }],
    calc: safe("dvbasis", function (bs, p) {
      /* Basis is the perp against Binance's own INDEX price — a basket of spot
         venues, not this chart's spot feed. Comparing the perp with the candles
         on screen would mix two different reference prices and quietly report the
         difference between the venues as basis. */
      var sym = perpSym(), per = dvPeriod(bs), pct = p.unit !== "price";
      var field = pct ? "basisRate" : "basis";
      return dvSeries(bs, "basis|" + sym + "|" + per + "|" + field,
        "https://fapi.binance.com/futures/data/basis?pair=" + sym + "&contractType=PERPETUAL&period=" + per + "&limit=500",
        function (raw) { return numArr(raw, "timestamp", field, pct ? 100 : 1); },
        function (out, pts) {
          out.rows = [{ kind: "hist", data: alignTo(bs, pts, DV_MS[per] * 2), up: C_UP, dn: C_DN, name: "Basis vs index " + (pct ? "%" : "price") }];
          out.zero = true;
          out.levels = [{ v: 0, dash: 2 }];
        }, sym + " basis");
    })
  });

  /* =====================================================================
     PUBLISH
     What registered, and what the engine refused. A refusal is kept rather
     than swallowed: a key that collides with one of the engine's own is a
     build problem, and it should be readable from the console.
     ===================================================================== */

  W.DXSTUDIES = {
    __v: 1,
    count: REG.length,
    keys: REG.slice(),
    refused: REFUSED.slice(),
    groups: ["Moving averages", "Bands & channels", "Trend", "Oscillators", "Momentum",
      "Volume", "Volatility", "Statistics", "Patterns", "Market structure", "Auto tools",
      "Ratings", "Derivatives"]
  };
})();
