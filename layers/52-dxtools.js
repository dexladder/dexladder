/* ============================================================
   DXTOOLS · v165 — the drawing tools DexChart did not have, and the
   object layer that manages what is on the chart.

   layers/46-dexchart.js shipped 71 tools. Measured against TradingView's
   set, the gaps were whole families rather than odds and ends: nothing
   cyclic, no fixed-unit Gann, no anchored volume work, most of the named
   chart patterns, and no way to keep a drawing's look, alert on it, or
   handle a dozen of them at once. This layer closes those gaps through
   DXC.registerTool — the engine is not edited again, and every tool here
   is stored, hit-tested, styled, undone and persisted by exactly the
   paths the built-in 71 use.

   Everything a tool draws with comes from DXC.kit. That is deliberate:
   a tool that reimplements a label box or a hit test drifts from the
   house look the first time the engine's changes, and then the chart
   has two appearances instead of one.
   ============================================================ */
window.DXTOOLS = (function () {
  "use strict";
  /* A layer may be appended twice by a stale shell. Registering a tool id that
     already exists is refused by the engine anyway, but the chrome and the
     document listener are not idempotent on their own, so guard the whole thing. */
  if (window.DXTOOLS && window.DXTOOLS.__v) return window.DXTOOLS;

  /* The engine reaches the document by its bare global name and the window by
     its own; a layer that goes through window.document instead is fine in a
     browser and undefined under the node harness, where window is a stub. */
  var W = window, d = document;
  var DXC = W.DXC;
  if (!DXC || typeof DXC.registerTool !== "function" || !DXC.kit) {
    /* The engine is absent (a page that never mounts the chart) or too old to be
       extended. Say so once and stand down rather than throwing through boot. */
    return { __v: 165, ok: false, why: "DexChart engine missing or not open for extension" };
  }

  var K = DXC.kit, M = K.M, LS = K.LS, TAU = K.TAU;
  var FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618, 2, 2.618, 3.618, 4.236];
  var FIB_MAIN = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  var FIB_EXT = [0, 0.382, 0.618, 1, 1.272, 1.618, 2, 2.618];
  var GANN = [[1, 8], [1, 4], [1, 3], [1, 2], [1, 1], [2, 1], [3, 1], [4, 1], [8, 1]];
  var PHI = 1.6180339887;
  var DAYMS = 864e5;

  var K_TPL = "dl.dxt.tpl";      /* name -> style */
  var K_TDEF = "dl.dxt.tooldef"; /* tool id -> template name */
  /* A group has no store of its own: membership, hidden and locked all live on
     the objects, which is what makes a group survive undo and a reload for free. */

  /* ---------------------------------------------------------------- helpers */
  function S() { try { return W["S"] || {}; } catch (e) { return {}; } }
  function C() { return K.colors; }
  function P() { return K.pal(); }
  function num(v, dflt) { return typeof v === "number" && isFinite(v) ? v : dflt; }
  function clamp(v, a, b) { return K.clamp(v, a, b); }
  function ptsOf(o, g, sc) {
    var out = [], i;
    for (i = 0; i < o.pts.length; i++) out.push(K.sxy(g, sc, o.pts[i]));
    return out;
  }
  /* A tool is rendered while it is still being placed, so every render must cope
     with fewer points than it asked for. Rather than each tool testing, they call
     this and fall back to whatever they do have. */
  function at(o, i) { return o.pts[Math.min(i, o.pts.length - 1)]; }
  function px(g, o, i) { return g.x(g.iOf(at(o, i).t)); }
  function idxOf(g, t) { return clamp(Math.round(g.iOf(t)), 0, Math.max(0, g.series.length - 1)); }
  function span(o, g, i, j) { return g.iOf(at(o, j).t) - g.iOf(at(o, i).t); }
  function inPlot(g, x0) { return x0 >= g.plotL - 2 && x0 <= g.plotR + 2; }
  function stroke(x, o, w, dsh) {
    x.strokeStyle = o.st.c; x.lineWidth = w == null ? o.st.w : w; K.dash(x, dsh == null ? o.st.dash : dsh);
  }
  function vline(x, g, x0) { K.lineTo(x, { x: x0, y: g.plotT }, { x: x0, y: g.plotB }); }
  function fs(o, off) { return Math.max(8, (o.st.fs || 12) + (off || 0)); }
  /* the price a two-point line carries at an arbitrary time, in DATA space — the
     alert check needs this, and so does every projection tool */
  function priceAt(a, b, t) {
    var dt = b.t - a.t;
    if (!dt) return b.p;
    return a.p + (b.p - a.p) * ((t - a.t) / dt);
  }
  function hitPts(o, g, sc, x0, y0, close) { return K.hitPoly(ptsOf(o, g, sc), x0, y0, !!close); }
  function nearX(list, x0) {
    var best = 1e9, i;
    for (i = 0; i < list.length; i++) best = Math.min(best, Math.abs(x0 - list[i]));
    return best;
  }
  /* the price unit a fixed-scale Gann tool measures an angle in: one bar wide by
     one unit tall. ATR is the only honest default — it is what a bar of this
     market actually moves — and the user can override it on the object. */
  function gannUnit(o, g) {
    var u = num(o.st.unit, 0);
    if (u > 0) return u;
    var a = M.atr(g.series, 14), i = idxOf(g, at(o, 0).t), v = a && a[i];
    if (!(v > 0)) v = at(o, 0).p * 0.01;
    return v;
  }
  /* UTC-day boundaries inside a bar range. A "session" on a crypto chart is the
     UTC day — the venue never closes, so anything else would be invented. */
  function sessions(g, lo, hi) {
    var out = [], i, cur = null;
    for (i = lo; i <= hi && i < g.series.length; i++) {
      var dnum = Math.floor(g.series[i].t / DAYMS);
      if (!cur || cur.d !== dnum) { cur = { d: dnum, from: i, to: i, t: g.series[i].t }; out.push(cur); }
      else cur.to = i;
    }
    return out;
  }

  /* ---------------------------------------------------------------- one stylesheet
     The rules below are the only CSS this layer adds. Everything else reuses the
     engine's dxc- classes so the dialogs are the same furniture. Both appearances
     are stated; the Night colours are measured against the #141619 panel ground. */
  function styles() {
    if (d.getElementById("dxtCss")) return;
    var s = d.createElement("style");
    s.setAttribute("id", "dxtCss");
    s.textContent = [
      ".dxt-sw{flex:none;width:11px;height:11px;border-radius:3px;background:var(--dxc-c,#5B8CFF)}",
      ".dxt-st{padding:1px 7px;border-radius:999px;font:600 9.5px Inter,system-ui,sans-serif;letter-spacing:.06em}",
      ".dxt-st.armed{background:rgba(0,229,255,.16);color:#7FE9FF}",
      ".dxt-st.fired{background:rgba(255,209,102,.18);color:#FFD166}",
      ".dxt-st.off{background:rgba(140,155,220,.14);color:#AEB9CF}",
      ".dxt-gr{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 2px}",
      ".dxt-cell{min-width:74px}",
      "html[data-mode=day] .dxt-st.armed{background:rgba(14,127,168,.14);color:#0B5E7C}",
      "html[data-mode=day] .dxt-st.fired{background:rgba(138,90,0,.14);color:#6B4600}",
      "html[data-mode=day] .dxt-st.off{background:rgba(11,16,32,.07);color:#4A5468}"
    ].join("\n");
    d.head ? d.head.appendChild(s) : d.body.appendChild(s);
  }

  /* ---------------------------------------------------------------- templates
     A template is the look of a drawing with the drawing taken out: colour,
     width, dash, fill and font size. It can be applied to one object, to a
     named group, to every object of a tool, or set as what a tool is born with. */
  var STYLE_KEYS = ["c", "w", "dash", "fill", "fs"];
  function readStyle(st) {
    var o = {}, i;
    for (i = 0; i < STYLE_KEYS.length; i++) o[STYLE_KEYS[i]] = st[STYLE_KEYS[i]];
    return o;
  }
  function applyStyle(st, tpl) {
    var i;
    for (i = 0; i < STYLE_KEYS.length; i++) if (tpl[STYLE_KEYS[i]] != null) st[STYLE_KEYS[i]] = tpl[STYLE_KEYS[i]];
  }
  function templates() { return LS.get(K_TPL, {}) || {}; }
  function toolDefaults() { return LS.get(K_TDEF, {}) || {}; }

  /* ---------------------------------------------------------------- alerts
     An alert lives ON the drawing, so it travels with it through undo, the
     per-market store and a reload. It is checked once per painted frame against
     the newest bar — the same bar the chart is drawing — and raised through the
     app's own alert path (DLCORE.toast + sfx), which is what Sentinel uses in
     layers/38-sentinel.js. There is no separate notifier to keep in step. */
  var LOG = [];
  function alertRef(o, t) {
    if (o.alert && num(o.alert.px, 0) > 0) return o.alert.px;
    if (o.pts.length >= 2 && o.pts[1] && o.pts[1].t !== o.pts[0].t) return priceAt(o.pts[0], o.pts[1], t);
    return o.pts[0].p;
  }
  function boxOf(o) {
    var a = o.pts[0], b = o.pts[o.pts.length - 1];
    return {
      p0: Math.min(a.p, b.p), p1: Math.max(a.p, b.p),
      t0: Math.min(a.t, b.t), t1: Math.max(a.t, b.t)
    };
  }
  function raise(o, msg, good) {
    LOG.push({ at: Date.now(), id: o.id, tool: o.tool, msg: msg });
    if (LOG.length > 60) LOG.shift();
    var core = null;
    try { core = W.DLCORE && typeof W.DLCORE.toast === "function" ? W.DLCORE : null; } catch (e) { core = null; }
    if (core) {
      try { core.toast(good ? "good" : "bad", "Chart alert", msg); } catch (e) { }
      try { if (typeof core.sfx === "function") core.sfx("alert"); } catch (e) { }
    }
    try { if (W.DEXAI && typeof W.DEXAI.event === "function") W.DEXAI.event("dxc.objectAlert", { id: o.id, tool: o.tool, msg: msg }); } catch (e) { }
  }
  function checkAlert(o, g, cur, prev) {
    var al = o.alert;
    if (!al || al.off || !cur || !prev) return false;
    if (al.hit && al.once !== false) return false;
    var sym = (S().coin || "") + "/" + (S().quote || "");
    var label = (DXC.toolDefs()[o.tool] || { l: o.tool }).l;
    if (al.kind === "enter") {
      var b = boxOf(o);
      var inNow = cur.c >= b.p0 && cur.c <= b.p1 && cur.t >= b.t0;
      var inWas = prev.c >= b.p0 && prev.c <= b.p1 && prev.t >= b.t0;
      if (inNow && !inWas) {
        al.hit = Date.now();
        raise(o, sym + " entered the " + label + " between " + K.fmt(b.p0) + " and " + K.fmt(b.p1) + " at " + K.fmt(cur.c), true);
        K.mark();
        return true;
      }
      return false;
    }
    var ref = alertRef(o, cur.t);
    if (!(ref > 0)) return false;
    var wasBelow = prev.c < ref, isBelow = cur.c < ref;
    if (wasBelow === isBelow) return false;
    if (al.dir === 1 && !wasBelow) return false;   /* upward crossings only */
    if (al.dir === -1 && wasBelow) return false;   /* downward crossings only */
    al.hit = Date.now();
    raise(o, sym + " crossed " + (wasBelow ? "above" : "below") + " the " + label + " at " + K.fmt(ref) + " (close " + K.fmt(cur.c) + ")", !wasBelow ? false : true);
    K.mark();
    return true;
  }

  /* ---------------------------------------------------------------- the per-frame sweep
     Run once per painted frame, not once per object: V.geo is a fresh object on
     every paint, so its identity is the frame's identity. The sweep does the two
     things that have to happen while the newest bar is in hand — arm-and-check
     the alerts, and give a newly placed drawing its tool's default template. */
  var lastGeo = null;
  function sweep() {
    var g = K.geo();
    if (!g || g === lastGeo) return;
    lastGeo = g;
    var a = K.drawings(), i, dirty = false;
    var tdef = toolDefaults(), tpl = templates();
    var s = g.series, n = s.length;
    var cur = n ? s[n - 1] : null, prev = n > 1 ? s[n - 2] : null;
    for (i = 0; i < a.length; i++) {
      var o = a[i];
      if (!o || !o.st) continue;
      /* st.tpl is the mark that says "this layer has seen this object". Stamping
         every object the first time means a drawing made before a tool default
         existed is never restyled behind the user's back — only one made after. */
      if (o.st.tpl === undefined) {
        var nm = tdef[o.tool], t = nm && tpl[nm];
        if (t) { applyStyle(o.st, t); o.st.tpl = nm; } else o.st.tpl = "";
        dirty = true;
      }
      if (o.alert && checkAlert(o, g, cur, prev)) dirty = true;
    }
    if (dirty) K.saveDraws();
  }
  function badge(o, x, g, sc) {
    if (!o.alert || o.alert.off) return;
    var p = K.sxy(g, sc, o.pts[0]), pal = P();
    var fired = !!o.alert.hit;
    K.label(x, p.x + 9, p.y - 9, fired ? "⚑ fired" : "⚑ armed", pal.ink, fired ? "#FFD166" : "#00E5FF", "left", 9);
  }

  /* ---------------------------------------------------------------- registration
     Every render and hit goes through one wrapper: the sweep runs first, the
     tool draws, the alert badge goes on top, and anything that throws lands in
     DXC.errors() through the engine's own fault channel instead of killing the
     frame. The wrapper is applied to the built-in 71 as well, so an alert on a
     trend line is checked on the same frame as an alert on a new one. */
  var REG = [], COUNT = 0;
  function wrapOne(def, id) {
    if (!def || def.__dxt) return;
    def.__dxt = 1;
    var r = def.render, h = def.hit;
    if (typeof r === "function") {
      def.render = function (o, x, g, sc) {
        try { sweep(); } catch (e) { K.fault("dxt:sweep", e); }
        try { r(o, x, g, sc); } catch (e) { K.fault("dxt:render:" + id, e); }
        try { badge(o, x, g, sc); } catch (e) { K.fault("dxt:badge:" + id, e); }
      };
    }
    if (typeof h === "function") {
      def.hit = function (o, g, sc, x0, y0) {
        try {
          var v = h(o, g, sc, x0, y0);
          return typeof v === "number" && isFinite(v) ? v : 1e9;
        } catch (e) { K.fault("dxt:hit:" + id, e); return 1e9; }
      };
    }
  }
  function reg(id, def) {
    REG.push(id);
    if (DXC.registerTool(id, def)) COUNT++;
  }

  /* =====================================================================
     TOOLS · CYCLES
     Two anchors measure an interval; the tool repeats it. Everything here is
     derived from the two points in DATA space, so the rhythm survives a zoom.
     ===================================================================== */

  reg("cyclic", {
    l: "Cyclic lines", g: "Cycles", n: 2, ic: "⦙",
    render: function (o, x, g, sc) {
      var i0 = g.iOf(at(o, 0).t), step = span(o, g, 0, 1);
      if (Math.abs(step) < 0.5) { K.lineTo(x, { x: g.x(i0), y: g.plotT }, { x: g.x(i0), y: g.plotB }); return; }
      /* solve for the repeats that actually land inside the plot rather than
         looping a fixed count and trusting the clip */
      var kL = Math.ceil((g.idx(g.plotL) - i0) / step), kR = Math.floor((g.idx(g.plotR) - i0) / step);
      var lo = Math.min(kL, kR), hi = Math.max(kL, kR), k;
      if (hi - lo > 400) hi = lo + 400;
      x.save();
      for (k = lo; k <= hi; k++) {
        var xx = g.x(i0 + step * k);
        if (!inPlot(g, xx)) continue;
        stroke(x, o, k === 0 || k === 1 ? o.st.w : 1, k === 0 || k === 1 ? o.st.dash : 2);
        x.globalAlpha = k === 0 || k === 1 ? 1 : 0.7;
        vline(x, g, xx);
        K.label(x, xx + 3, g.plotT + 12, String(k), o.st.c, false, "left", fs(o, -3));
      }
      x.globalAlpha = 1; K.dash(x, 0); x.restore();
    },
    hit: function (o, g, sc, x0, y0) {
      var i0 = g.iOf(at(o, 0).t), step = span(o, g, 0, 1);
      if (Math.abs(step) < 0.5) return Math.abs(x0 - g.x(i0));
      var k = Math.round((g.idx(x0) - i0) / step);
      return Math.abs(x0 - g.x(i0 + step * k));
    }
  });

  reg("sineline", {
    l: "Sine line", g: "Cycles", n: 2, ic: "∼",
    render: function (o, x, g, sc) {
      var a = at(o, 0), b = at(o, 1);
      var period = b.t - a.t, amp = (b.p - a.p) / 2, mid = (a.p + b.p) / 2;
      if (!period) { K.lineTo(x, K.sxy(g, sc, a), K.sxy(g, sc, b)); return; }
      var cycles = Math.max(1, Math.round(num(+o.st.variant, 0) || 1));
      /* the wave runs from the first anchor to the right edge when the object is
         extended, which is how a cycle drawing is actually read forward */
      var tEnd = o.st.extR ? g.t(g.idx(g.plotR)) : b.t;
      var tStart = o.st.extL ? g.t(g.idx(g.plotL)) : a.t;
      var n = 200, i, pts = [];
      for (i = 0; i <= n; i++) {
        var t = tStart + (tEnd - tStart) * (i / n);
        var ph = (t - a.t) / period * TAU * cycles;
        pts.push({ x: g.x(g.iOf(t)), y: sc.y(mid - amp * Math.cos(ph)) });
      }
      x.save(); stroke(x, o); K.polyPath(x, pts, false); x.stroke(); K.dash(x, 0);
      x.globalAlpha = 0.5; x.lineWidth = 1; K.dash(x, 2);
      K.lineTo(x, { x: pts[0].x, y: sc.y(mid) }, { x: pts[n].x, y: sc.y(mid) });
      K.dash(x, 0); x.globalAlpha = 1; x.restore();
    },
    hit: function (o, g, sc, x0, y0) {
      var a = at(o, 0), b = at(o, 1), period = b.t - a.t;
      if (!period) return K.dist2seg(x0, y0, K.sxy(g, sc, a), K.sxy(g, sc, b));
      var cycles = Math.max(1, Math.round(num(+o.st.variant, 0) || 1));
      var t = g.t(g.idx(x0)), ph = (t - a.t) / period * TAU * cycles;
      var mid = (a.p + b.p) / 2, amp = (b.p - a.p) / 2;
      return Math.abs(y0 - sc.y(mid - amp * Math.cos(ph)));
    }
  });

  reg("timecycles", {
    l: "Time cycles (Fib)", g: "Cycles", n: 2, ic: "⌁",
    render: function (o, x, g, sc) {
      var i0 = g.iOf(at(o, 0).t), st = span(o, g, 0, 1), i;
      if (Math.abs(st) < 0.5) return;
      x.save();
      for (i = 0; i < FIB.length; i++) {
        var xx = g.x(i0 + st * FIB[i]);
        if (!inPlot(g, xx)) continue;
        x.strokeStyle = C()[i % C().length]; x.lineWidth = FIB[i] === 1 ? o.st.w : 1; K.dash(x, FIB[i] === 1 ? 0 : 2);
        vline(x, g, xx);
        K.label(x, xx + 3, g.plotT + 12 + (i % 2) * 13, FIB[i].toFixed(3), x.strokeStyle, false, "left", fs(o, -3));
        K.label(x, xx + 3, g.plotB - 6 - (i % 2) * 12, K.stamp(g.t(i0 + st * FIB[i]), K.cfg().iv), x.strokeStyle, false, "left", fs(o, -4));
      }
      K.dash(x, 0); x.restore();
    },
    hit: function (o, g, sc, x0) {
      var i0 = g.iOf(at(o, 0).t), st = span(o, g, 0, 1), i, xs = [];
      for (i = 0; i < FIB.length; i++) xs.push(g.x(i0 + st * FIB[i]));
      return nearX(xs, x0);
    }
  });

  reg("tbfibtime", {
    l: "Trend-based Fib time", g: "Cycles", n: 3, ic: "⑆",
    render: function (o, x, g, sc) {
      var i0 = g.iOf(at(o, 0).t), i1 = g.iOf(at(o, 1).t), i2 = g.iOf(at(o, 2).t);
      var st = i1 - i0, i;
      if (Math.abs(st) < 0.5) return;
      x.save();
      /* the measured leg is drawn as the reference so the projection can be read
         against the swing it came from, the way the price version does it */
      stroke(x, o, 1, 2);
      K.polyPath(x, ptsOf(o, g, sc), false); x.stroke(); K.dash(x, 0);
      for (i = 0; i < FIB_EXT.length; i++) {
        var xx = g.x(i2 + st * FIB_EXT[i]);
        if (!inPlot(g, xx)) continue;
        x.strokeStyle = C()[i % C().length]; x.lineWidth = 1; K.dash(x, 2);
        vline(x, g, xx);
        K.label(x, xx + 3, g.plotT + 12, (FIB_EXT[i] * 100).toFixed(1) + "%", x.strokeStyle, false, "left", fs(o, -3));
      }
      K.dash(x, 0); x.restore();
    },
    hit: function (o, g, sc, x0, y0) {
      var i0 = g.iOf(at(o, 0).t), st = span(o, g, 0, 1), i2 = g.iOf(at(o, 2).t), i, xs = [];
      for (i = 0; i < FIB_EXT.length; i++) xs.push(g.x(i2 + st * FIB_EXT[i]));
      return Math.min(nearX(xs, x0), hitPts(o, g, sc, x0, y0, false));
    }
  });

  /* =====================================================================
     TOOLS · CHANNELS — two more forks
     ===================================================================== */

  reg("pitchfan", {
    l: "Pitchfan", g: "Channels", n: 3, ic: "⑇",
    render: function (o, x, g, sc) {
      var p = ptsOf(o, g, sc);
      if (p.length < 3) { K.lineTo(x, p[0], p[p.length - 1]); return; }
      var A = p[0], B = p[1], Cc = p[2], i;
      x.save();
      /* a pitchfan is the fork's base read as a fib ladder: a ray from the pivot
         through each fib fraction of B–C, rather than three parallel rails */
      for (i = 0; i < FIB_MAIN.length; i++) {
        var f = FIB_MAIN[i];
        var q = { x: B.x + (Cc.x - B.x) * f, y: B.y + (Cc.y - B.y) * f };
        var e = K.extendLine(A, q, false, true, g.plotL, g.plotR);
        x.strokeStyle = f === 0 || f === 1 ? o.st.c : C()[i % C().length];
        x.lineWidth = f === 0 || f === 1 ? o.st.w : 1;
        K.lineTo(x, e[0], e[1]);
        K.label(x, Math.min(e[1].x, g.plotR) - 4, e[1].y - 3, (f * 100).toFixed(1) + "%", x.strokeStyle, false, "right", fs(o, -3));
      }
      stroke(x, o, 1, 2); K.lineTo(x, B, Cc); K.dash(x, 0);
      x.restore();
    },
    hit: function (o, g, sc, x0, y0) {
      var p = ptsOf(o, g, sc);
      if (p.length < 3) return K.dist2seg(x0, y0, p[0], p[p.length - 1]);
      var best = K.dist2seg(x0, y0, p[1], p[2]), i;
      for (i = 0; i < FIB_MAIN.length; i++) {
        var f = FIB_MAIN[i], q = { x: p[1].x + (p[2].x - p[1].x) * f, y: p[1].y + (p[2].y - p[1].y) * f };
        var e = K.extendLine(p[0], q, false, true, g.plotL, g.plotR);
        best = Math.min(best, K.dist2seg(x0, y0, e[0], e[1]));
      }
      return best;
    }
  });

  reg("inpitchfork", {
    l: "Inside pitchfork", g: "Channels", n: 3, ic: "⑉",
    render: function (o, x, g, sc) {
      var p = ptsOf(o, g, sc);
      if (p.length < 3) { K.lineTo(x, p[0], p[p.length - 1]); return; }
      /* The inside fork hangs its handle on the MIDDLE pivot and runs the rails
         through the outer two, so the body of the move sits inside the fork
         rather than beside it. That is the whole difference from Andrews. */
      var H = p[1], R1 = p[0], R2 = p[2];
      var mid = { x: (R1.x + R2.x) / 2, y: (R1.y + R2.y) / 2 };
      var dx = mid.x - H.x, dy = mid.y - H.y;
      var k = (g.plotR - H.x) / (dx || 1e-9);
      function ray(from) { return { x: from.x + dx * k, y: from.y + dy * k }; }
      var mEnd = ray(H), u = ray(R1), v = ray(R2);
      K.fillPoly(x, [R1, u, v, R2], o.st.c, o.st.fill * 0.5);
      x.save();
      stroke(x, o); K.lineTo(x, H, mEnd); K.dash(x, 0);
      K.lineTo(x, R1, u); K.lineTo(x, R2, v);
      K.dash(x, 2);
      var f, s0;
      for (f = 0.25; f < 0.99; f += 0.25) {
        if (Math.abs(f - 0.5) < 1e-9) continue;
        s0 = { x: R1.x + (R2.x - R1.x) * f, y: R1.y + (R2.y - R1.y) * f };
        K.lineTo(x, s0, ray(s0));
      }
      K.dash(x, 0);
      K.lineTo(x, R1, R2);
      x.restore();
    },
    hit: function (o, g, sc, x0, y0) {
      var p = ptsOf(o, g, sc);
      if (p.length < 3) return K.dist2seg(x0, y0, p[0], p[p.length - 1]);
      var mid = { x: (p[0].x + p[2].x) / 2, y: (p[0].y + p[2].y) / 2 };
      return Math.min(K.dist2seg(x0, y0, p[1], mid), K.dist2seg(x0, y0, p[0], p[2]));
    }
  });

  /* =====================================================================
     TOOLS · GANN — the fixed-unit half the engine did not have
     The engine's Gann box, fan and square are all dragged: their angles are
     whatever the two corners make on screen, so they change with the zoom.
     A real Gann angle is a price per bar. These three take one anchor and a
     unit, so a 1×1 stays a 1×1.
     ===================================================================== */

  reg("gann11", {
    l: "Gann 1×1", g: "Gann", n: 1, ic: "◹",
    render: function (o, x, g, sc) {
      var a = at(o, 0), u = gannUnit(o, g), i0 = g.iOf(a.t);
      var nBars = Math.max(4, (g.plotR - g.x(i0)) / Math.max(0.6, g.sp));
      var A = { x: g.x(i0), y: sc.y(a.p) };
      var up = { x: g.x(i0 + nBars), y: sc.y(a.p + u * nBars) };
      var dn = { x: g.x(i0 + nBars), y: sc.y(a.p - u * nBars) };
      x.save();
      stroke(x, o); K.lineTo(x, A, up);
      x.globalAlpha = 0.65; K.lineTo(x, A, dn); x.globalAlpha = 1; K.dash(x, 0);
      K.label(x, A.x + 6, A.y - 6, "1×1  " + K.fmt(u) + "/bar", o.st.c, null, "left", fs(o, -2));
      x.restore();
    },
    hit: function (o, g, sc, x0, y0) {
      var a = at(o, 0), u = gannUnit(o, g), i0 = g.iOf(a.t);
      var nBars = Math.max(4, (g.plotR - g.x(i0)) / Math.max(0.6, g.sp));
      var A = { x: g.x(i0), y: sc.y(a.p) };
      return Math.min(
        K.dist2seg(x0, y0, A, { x: g.x(i0 + nBars), y: sc.y(a.p + u * nBars) }),
        K.dist2seg(x0, y0, A, { x: g.x(i0 + nBars), y: sc.y(a.p - u * nBars) }));
    }
  });

  reg("gannfanfix", {
    l: "Gann fan (fixed)", g: "Gann", n: 1, ic: "◸",
    render: function (o, x, g, sc) {
      var a = at(o, 0), u = gannUnit(o, g), i0 = g.iOf(a.t), i;
      var nBars = Math.max(4, (g.plotR - g.x(i0)) / Math.max(0.6, g.sp));
      var A = { x: g.x(i0), y: sc.y(a.p) };
      x.save();
      for (i = 0; i < GANN.length; i++) {
        var r = GANN[i], slope = u * (r[1] / r[0]);
        x.strokeStyle = r[0] === r[1] ? o.st.c : C()[i % C().length];
        x.lineWidth = r[0] === r[1] ? o.st.w : 1;
        var B = { x: g.x(i0 + nBars), y: sc.y(a.p + slope * nBars) };
        K.lineTo(x, A, B);
        K.label(x, Math.min(B.x, g.plotR) - 4, B.y - 2, r[0] + "×" + r[1], x.strokeStyle, false, "right", fs(o, -4));
      }
      x.restore();
    },
    hit: function (o, g, sc, x0, y0) {
      var a = at(o, 0), u = gannUnit(o, g), i0 = g.iOf(a.t), i;
      var nBars = Math.max(4, (g.plotR - g.x(i0)) / Math.max(0.6, g.sp));
      var A = { x: g.x(i0), y: sc.y(a.p) }, best = 1e9;
      for (i = 0; i < GANN.length; i++) {
        var r = GANN[i], slope = u * (r[1] / r[0]);
        best = Math.min(best, K.dist2seg(x0, y0, A, { x: g.x(i0 + nBars), y: sc.y(a.p + slope * nBars) }));
      }
      return best;
    }
  });

  reg("gannsqfix", {
    l: "Gann square (fixed)", g: "Gann", n: 1, ic: "▩",
    render: function (o, x, g, sc) {
      var a = at(o, 0), u = gannUnit(o, g), i0 = g.iOf(a.t);
      var nBars = Math.max(4, Math.round(num(+o.st.span, 0) || 45));
      var x0 = g.x(i0), x1 = g.x(i0 + nBars);
      var y0 = sc.y(a.p), y1 = sc.y(a.p + u * nBars);
      var fr = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1], i;
      x.save(); x.lineWidth = 1;
      for (i = 0; i < fr.length; i++) {
        x.strokeStyle = C()[i % C().length]; x.globalAlpha = 0.75;
        K.lineTo(x, { x: x0, y: y0 + (y1 - y0) * fr[i] }, { x: x1, y: y0 + (y1 - y0) * fr[i] });
        K.lineTo(x, { x: x0 + (x1 - x0) * fr[i], y: y0 }, { x: x0 + (x1 - x0) * fr[i], y: y1 });
      }
      x.globalAlpha = 1;
      x.strokeStyle = o.st.c; x.lineWidth = o.st.w;
      K.lineTo(x, { x: x0, y: y0 }, { x: x1, y: y1 });
      K.lineTo(x, { x: x0, y: y1 }, { x: x1, y: y0 });
      x.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      K.label(x, x0 + 4, Math.min(y0, y1) - 4, nBars + " bars × " + K.fmt(u * nBars), o.st.c, null, "left", fs(o, -3));
      x.restore();
    },
    hit: function (o, g, sc, x0, y0) {
      var a = at(o, 0), u = gannUnit(o, g), i0 = g.iOf(a.t);
      var nBars = Math.max(4, Math.round(num(+o.st.span, 0) || 45));
      return K.hitBox(K.bbox([{ x: g.x(i0), y: sc.y(a.p) }, { x: g.x(i0 + nBars), y: sc.y(a.p + u * nBars) }]), x0, y0);
    }
  });

  /* =====================================================================
     TOOLS · FIBONACCI
     ===================================================================== */

  reg("fibwedge", {
    l: "Fib wedge", g: "Fibonacci", n: 3, ic: "◄",
    render: function (o, x, g, sc) {
      var p = ptsOf(o, g, sc);
      if (p.length < 3) { K.lineTo(x, p[0], p[p.length - 1]); return; }
      var A = p[0], i;
      /* the wedge is the fan between two rays out of one apex: each fib fraction
         picks a point on the far edge, so the ladder widens with the wedge */
      var prev = null;
      x.save();
      for (i = 0; i < FIB_MAIN.length; i++) {
        var f = FIB_MAIN[i];
        var q = { x: p[1].x + (p[2].x - p[1].x) * f, y: p[1].y + (p[2].y - p[1].y) * f };
        var e = K.extendLine(A, q, false, o.st.extR, g.plotL, g.plotR);
        if (prev && o.st.fill) K.fillPoly(x, [A, prev[1], e[1]], C()[i % C().length], o.st.fill * 0.4);
        x.strokeStyle = f === 0 || f === 1 ? o.st.c : C()[i % C().length];
        x.lineWidth = f === 0 || f === 1 ? o.st.w : 1;
        K.lineTo(x, e[0], e[1]);
        K.label(x, Math.min(e[1].x, g.plotR) - 4, e[1].y - 3, (f * 100).toFixed(1) + "%", x.strokeStyle, false, "right", fs(o, -3));
        prev = e;
      }
      stroke(x, o, 1, 2); K.lineTo(x, p[1], p[2]); K.dash(x, 0);
      x.restore();
    },
    hit: function (o, g, sc, x0, y0) {
      var p = ptsOf(o, g, sc);
      if (p.length < 3) return K.dist2seg(x0, y0, p[0], p[p.length - 1]);
      return Math.min(K.dist2seg(x0, y0, p[0], p[1]), K.dist2seg(x0, y0, p[0], p[2]), K.dist2seg(x0, y0, p[1], p[2]));
    }
  });

  reg("fibspiral", {
    l: "Fib spiral", g: "Fibonacci", n: 2, ic: "🌀",
    render: function (o, x, g, sc) {
      var a = K.sxy(g, sc, at(o, 0)), b = K.sxy(g, sc, at(o, 1));
      var r0 = Math.hypot(b.x - a.x, b.y - a.y);
      if (!(r0 > 1)) return;
      var th0 = Math.atan2(b.y - a.y, b.x - a.x);
      /* a golden spiral is r = r0 · φ^(θ/(π/2)): the radius multiplies by φ every
         quarter turn. Sampled rather than built from four arcs so the growth is
         continuous instead of stepping at each quadrant. */
      var turns = 3.2, n = 260, i, pts = [];
      for (i = 0; i <= n; i++) {
        var th = (i / n) * TAU * turns;
        var r = r0 * Math.pow(PHI, -th / (Math.PI / 2));
        pts.push({ x: a.x + r * Math.cos(th0 + th), y: a.y + r * Math.sin(th0 + th) });
      }
      x.save(); stroke(x, o); K.polyPath(x, pts, false); x.stroke(); K.dash(x, 0);
      x.globalAlpha = 0.45; x.lineWidth = 1; K.dash(x, 2);
      for (i = 0; i <= 4; i++) {
        var rr = r0 * Math.pow(PHI, -i);
        x.beginPath(); x.arc(a.x, a.y, rr, 0, TAU); x.stroke();
      }
      K.dash(x, 0); x.globalAlpha = 1;
      x.fillStyle = o.st.c; x.beginPath(); x.arc(a.x, a.y, 3, 0, TAU); x.fill();
      x.restore();
    },
    hit: function (o, g, sc, x0, y0) {
      var a = K.sxy(g, sc, at(o, 0)), b = K.sxy(g, sc, at(o, 1));
      var r0 = Math.hypot(b.x - a.x, b.y - a.y), r = Math.hypot(x0 - a.x, y0 - a.y), i, best = 1e9;
      if (!(r0 > 1)) return 1e9;
      for (i = 0; i <= 5; i++) best = Math.min(best, Math.abs(r - r0 * Math.pow(PHI, -i)));
      return best;
    }
  });

  reg("fibext3", {
    l: "Fib extension (A-B-C)", g: "Fibonacci", n: 3, ic: "⑊",
    render: function (o, x, g, sc) {
      var p = ptsOf(o, g, sc);
      if (p.length < 3) { K.lineTo(x, p[0], p[p.length - 1]); return; }
      var A = at(o, 0).p, B = at(o, 1).p, Cp = at(o, 2).p, leg = B - A, i;
      var x0 = p[2].x, x1 = g.plotR, prevY = null;
      x.save();
      for (i = 0; i < FIB_EXT.length; i++) {
        var f = FIB_EXT[i], pv = Cp + leg * f, yy = sc.y(pv);
        if (prevY != null && o.st.fill) {
          x.globalAlpha = o.st.fill * 0.45; x.fillStyle = C()[i % C().length];
          x.fillRect(Math.min(x0, x1), Math.min(yy, prevY), Math.abs(x1 - x0), Math.abs(prevY - yy));
          x.globalAlpha = 1;
        }
        x.strokeStyle = f === 0 || f === 1 ? o.st.c : C()[i % C().length];
        x.lineWidth = f === 0 || f === 1 ? o.st.w : 1;
        K.dash(x, f === 0.618 || f === 1.618 ? 0 : 2);
        K.lineTo(x, { x: x0, y: yy }, { x: x1, y: yy });
        K.label(x, x0 + 4, yy - 3, (f * 100).toFixed(1) + "%  " + K.fmt(pv) + "  " + K.pct(Cp ? (pv / Cp - 1) * 100 : 0),
          x.strokeStyle, false, "left", fs(o, -3));
        prevY = yy;
      }
      K.dash(x, 0);
      stroke(x, o, 1, 2); K.polyPath(x, p, false); x.stroke(); K.dash(x, 0);
      x.restore();
    },
    hit: function (o, g, sc, x0, y0) {
      var A = at(o, 0).p, B = at(o, 1).p, Cp = at(o, 2).p, leg = B - A, i, best = hitPts(o, g, sc, x0, y0, false);
      if (x0 < px(g, o, 2) - 4) return best;
      for (i = 0; i < FIB_EXT.length; i++) best = Math.min(best, Math.abs(y0 - sc.y(Cp + leg * FIB_EXT[i])));
      return best;
    }
  });

  reg("fibproj", {
    l: "Fib projection", g: "Fibonacci", n: 3, ic: "⑈",
    render: function (o, x, g, sc) {
      var p = ptsOf(o, g, sc);
      if (p.length < 3) { K.lineTo(x, p[0], p[p.length - 1]); return; }
      var A = at(o, 0), B = at(o, 1), Cp = at(o, 2);
      var legP = B.p - A.p, i2 = g.iOf(Cp.t), legI = g.iOf(B.t) - g.iOf(A.t), i;
      x.save();
      /* a projection is a target in BOTH axes: the price the leg repeats to, and
         the bar it would get there on. Drawing only the price half is the mistake
         that makes a projection look like a retracement. */
      for (i = 1; i < FIB_EXT.length; i++) {
        var f = FIB_EXT[i], pv = Cp.p + legP * f, yy = sc.y(pv), xx = g.x(i2 + legI * f);
        x.strokeStyle = C()[i % C().length]; x.lineWidth = f === 1 ? o.st.w : 1; K.dash(x, 2);
        K.lineTo(x, { x: p[2].x, y: yy }, { x: Math.min(xx, g.plotR), y: yy });
        if (inPlot(g, xx)) K.lineTo(x, { x: xx, y: yy }, { x: xx, y: sc.y(Cp.p) });
        K.dash(x, 0);
        x.fillStyle = x.strokeStyle;
        x.beginPath(); x.arc(clamp(xx, g.plotL, g.plotR), yy, 2.6, 0, TAU); x.fill();
        K.label(x, clamp(xx, g.plotL, g.plotR) - 4, yy - 4, (f * 100).toFixed(0) + "%  " + K.fmt(pv), x.strokeStyle, false, "right", fs(o, -3));
      }
      stroke(x, o, o.st.w, 0); K.polyPath(x, p, false); x.stroke();
      x.restore();
    },
    hit: function (o, g, sc, x0, y0) {
      var Cp = at(o, 2), legP = at(o, 1).p - at(o, 0).p, i, best = hitPts(o, g, sc, x0, y0, false);
      for (i = 1; i < FIB_EXT.length; i++) best = Math.min(best, Math.abs(y0 - sc.y(Cp.p + legP * FIB_EXT[i])));
      return best;
    }
  });

  /* =====================================================================
     TOOLS · VOLUME
     The engine's volume profile study reads the VISIBLE range and moves as you
     pan. These four are anchored: the range is the drawing, so the profile
     stays on the auction it was drawn for.
     ===================================================================== */

  function drawProfile(x, g, sc, prof, ax, w, dir, o, tag) {
    if (!prof || !prof.max || !(w > 2)) return;
    var i, pal = P();
    x.save();
    for (i = 0; i < prof.bins.length; i++) {
      var v = prof.bins[i];
      if (!(v > 0)) continue;
      var pLo = prof.lo + prof.step * i, pHi = pLo + prof.step;
      var y0 = sc.y(pHi), y1 = sc.y(pLo), h = Math.max(1, Math.abs(y1 - y0) - 0.5);
      var bw = w * (v / prof.max) * 0.92;
      var inVa = i >= prof.vaLo && i <= prof.vaHi;
      x.globalAlpha = i === prof.poc ? 0.85 : inVa ? 0.46 : 0.24;
      x.fillStyle = i === prof.poc ? "#FFD166" : prof.up[i] >= v / 2 ? pal.up : pal.dn;
      x.fillRect(dir < 0 ? ax - bw : ax, Math.min(y0, y1), bw, h);
    }
    x.globalAlpha = 1;
    /* the point of control and the 70% value area are the two lines a desk reads
       a profile from; everything else is context */
    var pocP = prof.lo + prof.step * (prof.poc + 0.5);
    var vaL = prof.lo + prof.step * prof.vaLo, vaH = prof.lo + prof.step * (prof.vaHi + 1);
    var e0 = dir < 0 ? ax - w : ax, e1 = dir < 0 ? ax : ax + w;
    x.strokeStyle = "#FFD166"; x.lineWidth = 1.4;
    K.lineTo(x, { x: e0, y: sc.y(pocP) }, { x: e1, y: sc.y(pocP) });
    x.strokeStyle = o.st.c; x.lineWidth = 1; K.dash(x, 2);
    K.lineTo(x, { x: e0, y: sc.y(vaH) }, { x: e1, y: sc.y(vaH) });
    K.lineTo(x, { x: e0, y: sc.y(vaL) }, { x: e1, y: sc.y(vaL) });
    K.dash(x, 0);
    K.label(x, ax, sc.y(pocP) - 3, (tag ? tag + " " : "") + "POC " + K.fmt(pocP), pal.ink, "#FFD166", dir < 0 ? "right" : "left", fs(o, -3));
    K.label(x, e0 + 4, sc.y(vaH) - 3, "VAH " + K.fmt(vaH) + "  \u00b7  " + K.volFmt(prof.total), o.st.c, false, "left", fs(o, -4));
    K.label(x, e0 + 4, sc.y(vaL) + 11, "VAL " + K.fmt(vaL), o.st.c, false, "left", fs(o, -4));
    x.restore();
  }
  /* A hit test runs for every drawing on every pointer move, and an anchored
     VWAP is an O(bars) sweep. One entry is enough: the pointer is over one
     object at a time, and the series identity invalidates it on a new frame. */
  var VW = { s: null, lo: -1, v: null };
  function vwapCached(s, lo) {
    if (VW.s === s && VW.lo === lo && VW.v) return VW.v;
    VW.s = s; VW.lo = lo; VW.v = M.vwapFrom(s, lo);
    return VW.v;
  }
  function rangeOf(o, g, i, j) {
    var a = idxOf(g, at(o, i).t), b = idxOf(g, at(o, j).t);
    return { lo: Math.min(a, b), hi: Math.max(a, b) };
  }

  reg("fixedvp", {
    l: "Fixed range volume profile", g: "Volume", n: 2, ic: "▤",
    render: function (o, x, g, sc) {
      var r = rangeOf(o, g, 0, 1);
      if (r.hi - r.lo < 2) return;
      var bins = clamp(Math.round(num(+o.st.bins, 0) || 44), 8, 140);
      var prof = M.volProfile(g.series, r.lo, r.hi + 1, bins);
      var xL = g.x(r.lo), xR = g.x(r.hi);
      x.save();
      x.globalAlpha = 0.06; x.fillStyle = o.st.c;
      x.fillRect(xL, g.plotT, Math.max(1, xR - xL), g.plotB - g.plotT);
      x.globalAlpha = 1;
      stroke(x, o, 1, 2); vline(x, g, xL); vline(x, g, xR); K.dash(x, 0);
      x.restore();
      /* the histogram grows from the right edge of the range, so it reads against
         the bars it was measured over instead of covering them */
      drawProfile(x, g, sc, prof, xR, Math.max(30, (xR - xL) * 0.88), -1, o, "");
    },
    hit: function (o, g, sc, x0) {
      var r = rangeOf(o, g, 0, 1);
      return nearX([g.x(r.lo), g.x(r.hi)], x0);
    }
  });

  reg("anchvp", {
    l: "Anchored volume profile", g: "Volume", n: 1, ic: "▥",
    render: function (o, x, g, sc) {
      var lo = idxOf(g, at(o, 0).t), hi = g.series.length - 1;
      if (hi - lo < 2) return;
      var prof = M.volProfile(g.series, lo, hi + 1, clamp(Math.round(num(+o.st.bins, 0) || 44), 8, 140));
      var xL = g.x(lo), xR = Math.min(g.x(hi), g.plotR);
      x.save(); stroke(x, o, 1, 2); vline(x, g, xL); K.dash(x, 0); x.restore();
      drawProfile(x, g, sc, prof, xR, Math.max(40, (xR - xL) * 0.3), -1, o, "");
    },
    hit: function (o, g, sc, x0) { return Math.abs(x0 - g.x(idxOf(g, at(o, 0).t))); }
  });

  reg("sessvp", {
    l: "Session volume profile", g: "Volume", n: 2, ic: "▦",
    render: function (o, x, g, sc) {
      var r = rangeOf(o, g, 0, 1);
      if (r.hi - r.lo < 2) return;
      var ss = sessions(g, r.lo, r.hi), i;
      /* one profile per UTC day. On a bar size where the whole range is a single
         day this degenerates to the fixed-range profile, which is correct. */
      for (i = 0; i < ss.length && i < 40; i++) {
        var s = ss[i];
        if (s.to - s.from < 1) continue;
        var prof = M.volProfile(g.series, s.from, s.to + 1, clamp(Math.round(num(+o.st.bins, 0) || 26), 8, 90));
        var xL = g.x(s.from), xR = g.x(s.to);
        drawProfile(x, g, sc, prof, xL, Math.max(14, (xR - xL) * 0.75), 1, o, "");
        x.save(); stroke(x, o, 1, 2); x.globalAlpha = 0.5; vline(x, g, xL); x.globalAlpha = 1; K.dash(x, 0); x.restore();
      }
    },
    hit: function (o, g, sc, x0) {
      var r = rangeOf(o, g, 0, 1);
      return x0 >= Math.min(g.x(r.lo), g.x(r.hi)) - 4 && x0 <= Math.max(g.x(r.lo), g.x(r.hi)) + 4
        ? nearX([g.x(r.lo), g.x(r.hi)], x0) : 1e9;
    }
  });

  reg("avwap", {
    l: "Anchored VWAP", g: "Volume", n: 1, ic: "⩗",
    render: function (o, x, g, sc) {
      var lo = idxOf(g, at(o, 0).t), s = g.series, i;
      if (lo >= s.length - 1) return;
      var v = vwapCached(s, lo);
      /* the bands are the volume-weighted deviation of typical price around the
         same running mean, accumulated with it — anything else is a different
         statistic wearing the same name */
      var cum = 0, cv = 0, up = [], dn = [];
      for (i = lo; i < s.length; i++) {
        var tp = (s[i].h + s[i].l + s[i].c) / 3, vol = s[i].v || 1, mean = v[i];
        cum += (tp - mean) * (tp - mean) * vol; cv += vol;
        var sd = cv ? Math.sqrt(cum / cv) : 0;
        up[i] = mean + sd; dn[i] = mean - sd;
      }
      var pathV = [], pathU = [], pathD = [];
      for (i = Math.max(lo, g.from); i < Math.min(g.to, s.length); i++) {
        if (v[i] == null) continue;
        pathV.push({ x: g.x(i), y: sc.y(v[i]) });
        pathU.push({ x: g.x(i), y: sc.y(up[i]) });
        pathD.push({ x: g.x(i), y: sc.y(dn[i]) });
      }
      if (!pathV.length) return;
      x.save();
      if (o.st.fill && pathU.length > 1) {
        var poly = pathU.concat(pathD.slice().reverse());
        K.fillPoly(x, poly, o.st.c, o.st.fill * 0.5);
      }
      stroke(x, o, 1, 2); K.polyPath(x, pathU, false); x.stroke(); K.polyPath(x, pathD, false); x.stroke();
      stroke(x, o, o.st.w, 0); K.polyPath(x, pathV, false); x.stroke();
      var lastP = pathV[pathV.length - 1];
      K.label(x, lastP.x - 4, lastP.y - 4, "AVWAP " + K.fmt(v[s.length - 1] || v[Math.min(g.to, s.length) - 1]), o.st.c, false, "right", fs(o, -2));
      x.save(); stroke(x, o, 1, 2); x.globalAlpha = 0.6; vline(x, g, g.x(lo)); x.globalAlpha = 1; K.dash(x, 0); x.restore();
      x.restore();
    },
    hit: function (o, g, sc, x0, y0) {
      var lo = idxOf(g, at(o, 0).t), s = g.series;
      if (lo >= s.length - 1) return 1e9;
      var i = clamp(Math.round(g.idx(x0)), lo, s.length - 1);
      var v = vwapCached(s, lo);
      return v[i] == null ? 1e9 : Math.abs(y0 - sc.y(v[i]));
    }
  });

  /* =====================================================================
     TOOLS · CHART PATTERNS
     The engine's patternTool draws a labelled polyline, which is right for a
     harmonic. A flag, a cup or a diamond is a SHAPE, so these draw the shape —
     a pattern you cannot recognise at a glance is not a pattern tool.
     ===================================================================== */

  /* the measured move every reversal pattern implies: the depth of the pattern
     projected from the break. Drawn dashed, and labelled as a target, never as
     a forecast the tool is claiming. */
  function target(x, g, sc, xFrom, neck, depth, o, up) {
    var tp = up ? neck + depth : neck - depth, pal = P();
    x.save();
    x.strokeStyle = up ? pal.up : pal.dn; x.lineWidth = 1.2; K.dash(x, 4);
    K.lineTo(x, { x: xFrom, y: sc.y(tp) }, { x: g.plotR, y: sc.y(tp) });
    K.dash(x, 0);
    K.label(x, xFrom + 5, sc.y(tp) - 3, "target " + K.fmt(tp), pal.ink, up ? pal.up : pal.dn, "left", fs(o, -3));
    x.restore();
  }
  function vertexLabels(x, p, labels, o) {
    var i;
    for (i = 0; i < p.length && i < labels.length; i++) {
      K.label(x, p[i].x, p[i].y - 8, labels[i], P().ink, o.st.c, "center", fs(o, -3));
    }
  }

  reg("patflag", {
    l: "Flag", g: "Patterns", n: 4, ic: "⚑",
    render: function (o, x, g, sc) {
      var p = ptsOf(o, g, sc);
      if (p.length < 4) { K.polyPath(x, p, false); stroke(x, o); x.stroke(); K.dash(x, 0); return; }
      var pole0 = p[0], pole1 = p[1], u0 = p[1], u1 = p[2];
      /* the lower rail is the upper rail moved down by the fourth point's offset:
         a flag is a PARALLEL channel against the pole, not two free lines */
      var off = p[3].y - (u0.y + (u1.y - u0.y) * ((p[3].x - u0.x) / ((u1.x - u0.x) || 1e-9)));
      var l0 = { x: u0.x, y: u0.y + off }, l1 = { x: u1.x, y: u1.y + off };
      K.fillPoly(x, [u0, u1, l1, l0], o.st.c, o.st.fill);
      x.save();
      stroke(x, o, o.st.w + 1.2, 0); K.lineTo(x, pole0, pole1);
      stroke(x, o, o.st.w, o.st.dash); K.lineTo(x, u0, u1); K.lineTo(x, l0, l1); K.dash(x, 0);
      K.label(x, (pole0.x + pole1.x) / 2, (pole0.y + pole1.y) / 2, "pole", P().ink, o.st.c, "center", fs(o, -3));
      x.restore();
      target(x, g, sc, Math.max(u1.x, l1.x), at(o, 2).p, Math.abs(at(o, 1).p - at(o, 0).p), o, at(o, 1).p >= at(o, 0).p);
    },
    hit: function (o, g, sc, x0, y0) { return hitPts(o, g, sc, x0, y0, false); }
  });

  reg("patpennant", {
    l: "Pennant", g: "Patterns", n: 4, ic: "◅",
    render: function (o, x, g, sc) {
      var p = ptsOf(o, g, sc);
      if (p.length < 4) { K.polyPath(x, p, false); stroke(x, o); x.stroke(); K.dash(x, 0); return; }
      var pole0 = p[0], pole1 = p[1];
      /* the two rails converge: extend both to where they meet, and draw the
         triangle that actually closes rather than two rails that never do */
      var a1 = pole1, a2 = p[2], b1 = { x: pole1.x, y: p[3].y }, b2 = p[3];
      var apex = meet(a1, a2, b1, b2);
      var tip = apex || { x: Math.max(a2.x, b2.x), y: (a2.y + b2.y) / 2 };
      K.fillPoly(x, [a1, tip, b1], o.st.c, o.st.fill);
      x.save();
      stroke(x, o, o.st.w + 1.2, 0); K.lineTo(x, pole0, pole1);
      stroke(x, o, o.st.w, o.st.dash); K.lineTo(x, a1, tip); K.lineTo(x, b1, tip); K.dash(x, 0);
      x.restore();
      target(x, g, sc, tip.x, at(o, 2).p, Math.abs(at(o, 1).p - at(o, 0).p), o, at(o, 1).p >= at(o, 0).p);
    },
    hit: function (o, g, sc, x0, y0) { return hitPts(o, g, sc, x0, y0, false); }
  });
  /* where two segments' lines cross, or null when they are parallel */
  function meet(a1, a2, b1, b2) {
    var d1x = a2.x - a1.x, d1y = a2.y - a1.y, d2x = b2.x - b1.x, d2y = b2.y - b1.y;
    var den = d1x * d2y - d1y * d2x;
    if (!den) return null;
    var t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / den;
    return { x: a1.x + d1x * t, y: a1.y + d1y * t };
  }

  reg("patwedge", {
    l: "Wedge", g: "Patterns", n: 4, ic: "◭",
    render: function (o, x, g, sc) {
      var p = ptsOf(o, g, sc);
      if (p.length < 4) { K.polyPath(x, p, false); stroke(x, o); x.stroke(); K.dash(x, 0); return; }
      var u0 = p[0], u1 = p[2], l0 = p[1], l1 = p[3];
      var apex = meet(u0, u1, l0, l1);
      var right = apex && apex.x > Math.max(u1.x, l1.x) && apex.x < g.plotR + 400 ? apex : null;
      var uEnd = right || u1, lEnd = right || l1;
      K.fillPoly(x, [u0, uEnd, lEnd, l0], o.st.c, o.st.fill);
      x.save();
      stroke(x, o); K.lineTo(x, u0, uEnd); K.lineTo(x, l0, lEnd); K.dash(x, 0);
      x.globalAlpha = 0.6; x.lineWidth = 1; K.dash(x, 2);
      K.lineTo(x, u0, l0); K.lineTo(x, uEnd, lEnd);
      K.dash(x, 0); x.globalAlpha = 1;
      var rising = at(o, 2).p > at(o, 0).p;
      K.label(x, (u0.x + uEnd.x) / 2, Math.min(u0.y, uEnd.y) - 8, rising ? "rising wedge" : "falling wedge",
        P().ink, o.st.c, "center", fs(o, -3));
      x.restore();
    },
    hit: function (o, g, sc, x0, y0) {
      var p = ptsOf(o, g, sc);
      if (p.length < 4) return hitPts(o, g, sc, x0, y0, false);
      return Math.min(K.dist2seg(x0, y0, p[0], p[2]), K.dist2seg(x0, y0, p[1], p[3]));
    }
  });

  /* the cup and the rounding bottom share one arc: a quadratic through the two
     rims with the control point placed so the curve actually passes the low,
     which a naive control point does not — a quadratic sits half way to it. */
  function bowl(L, B, R) {
    return { x: 2 * B.x - (L.x + R.x) / 2, y: 2 * B.y - (L.y + R.y) / 2 };
  }
  function bowlPts(L, B, R, n) {
    var c = bowl(L, B, R), out = [], i;
    for (i = 0; i <= n; i++) {
      var t = i / n, mt = 1 - t;
      out.push({ x: mt * mt * L.x + 2 * mt * t * c.x + t * t * R.x, y: mt * mt * L.y + 2 * mt * t * c.y + t * t * R.y });
    }
    return out;
  }

  reg("patcup", {
    l: "Cup & handle", g: "Patterns", n: 3, ic: "◡",
    render: function (o, x, g, sc) {
      var p = ptsOf(o, g, sc);
      if (p.length < 3) { K.lineTo(x, p[0], p[p.length - 1]); return; }
      var L = p[0], B = p[1], R = p[2], c = bowl(L, B, R);
      x.save();
      if (o.st.fill) {
        x.beginPath(); x.moveTo(L.x, L.y); x.quadraticCurveTo(c.x, c.y, R.x, R.y); x.closePath();
        x.globalAlpha = o.st.fill; x.fillStyle = o.st.c; x.fill(); x.globalAlpha = 1;
      }
      stroke(x, o);
      x.beginPath(); x.moveTo(L.x, L.y); x.quadraticCurveTo(c.x, c.y, R.x, R.y); x.stroke();
      /* the handle: a shallow drift down and right off the right rim, a quarter
         of the cup wide and a fifth of it deep — the shape's own proportions */
      var w = R.x - L.x, dep = B.y - (L.y + R.y) / 2;
      var h1 = { x: R.x + w * 0.16, y: R.y + dep * 0.22 }, h2 = { x: R.x + w * 0.3, y: R.y + dep * 0.06 };
      K.lineTo(x, R, h1); K.lineTo(x, h1, h2);
      K.dash(x, 2); x.globalAlpha = 0.7;
      K.lineTo(x, { x: L.x, y: (L.y + R.y) / 2 }, { x: g.plotR, y: (L.y + R.y) / 2 });
      K.dash(x, 0); x.globalAlpha = 1;
      K.label(x, (L.x + R.x) / 2, Math.max(L.y, R.y) + 14, "cup & handle", P().ink, o.st.c, "center", fs(o, -3));
      x.restore();
      target(x, g, sc, h2.x, (at(o, 0).p + at(o, 2).p) / 2, Math.abs((at(o, 0).p + at(o, 2).p) / 2 - at(o, 1).p), o, true);
    },
    hit: function (o, g, sc, x0, y0) {
      var p = ptsOf(o, g, sc);
      if (p.length < 3) return K.dist2seg(x0, y0, p[0], p[p.length - 1]);
      return K.hitPoly(bowlPts(p[0], p[1], p[2], 24), x0, y0, false);
    }
  });

  reg("patround", {
    l: "Rounding bottom", g: "Patterns", n: 3, ic: "⌣",
    render: function (o, x, g, sc) {
      var p = ptsOf(o, g, sc);
      if (p.length < 3) { K.lineTo(x, p[0], p[p.length - 1]); return; }
      var L = p[0], B = p[1], R = p[2], c = bowl(L, B, R);
      x.save();
      if (o.st.fill) {
        x.beginPath(); x.moveTo(L.x, L.y); x.quadraticCurveTo(c.x, c.y, R.x, R.y); x.closePath();
        x.globalAlpha = o.st.fill * 0.8; x.fillStyle = o.st.c; x.fill(); x.globalAlpha = 1;
      }
      stroke(x, o);
      x.beginPath(); x.moveTo(L.x, L.y); x.quadraticCurveTo(c.x, c.y, R.x, R.y); x.stroke();
      K.dash(x, 2); x.globalAlpha = 0.75;
      K.lineTo(x, { x: L.x, y: (L.y + R.y) / 2 }, { x: g.plotR, y: (L.y + R.y) / 2 });
      K.dash(x, 0); x.globalAlpha = 1;
      var down = at(o, 1).p > (at(o, 0).p + at(o, 2).p) / 2;
      K.label(x, (L.x + R.x) / 2, down ? Math.min(L.y, R.y) - 8 : Math.max(L.y, R.y) + 14,
        down ? "rounding top" : "rounding bottom", P().ink, o.st.c, "center", fs(o, -3));
      x.restore();
      target(x, g, sc, R.x, (at(o, 0).p + at(o, 2).p) / 2, Math.abs((at(o, 0).p + at(o, 2).p) / 2 - at(o, 1).p), o, !down);
    },
    hit: function (o, g, sc, x0, y0) {
      var p = ptsOf(o, g, sc);
      if (p.length < 3) return K.dist2seg(x0, y0, p[0], p[p.length - 1]);
      return K.hitPoly(bowlPts(p[0], p[1], p[2], 24), x0, y0, false);
    }
  });

  reg("patrect", {
    l: "Rectangle (pattern)", g: "Patterns", n: 4, ic: "▤",
    render: function (o, x, g, sc) {
      var p = ptsOf(o, g, sc);
      if (p.length < 4) { K.polyPath(x, p, false); stroke(x, o); x.stroke(); K.dash(x, 0); return; }
      /* the range is what the four touches agree on, not what the first and last
         happen to be: a rectangle pattern is defined by its touched extremes */
      var i, hi = -Infinity, lo = Infinity, xL = Infinity, xR = -Infinity;
      for (i = 0; i < p.length; i++) { hi = Math.max(hi, -p[i].y); lo = Math.min(lo, -p[i].y); xL = Math.min(xL, p[i].x); xR = Math.max(xR, p[i].x); }
      var yTop = -hi, yBot = -lo;
      x.save();
      x.globalAlpha = o.st.fill; x.fillStyle = o.st.c;
      x.fillRect(xL, yTop, xR - xL, yBot - yTop); x.globalAlpha = 1;
      stroke(x, o); x.strokeRect(xL, yTop, xR - xL, yBot - yTop); K.dash(x, 0);
      x.fillStyle = o.st.c;
      for (i = 0; i < p.length; i++) { x.beginPath(); x.arc(p[i].x, p[i].y, 3, 0, TAU); x.fill(); }
      var hiP = sc.v ? sc.v(yTop) : at(o, 0).p, loP = sc.v ? sc.v(yBot) : at(o, 1).p;
      K.label(x, xL + 4, yTop - 4, "range " + K.fmt(hiP) + " – " + K.fmt(loP), o.st.c, false, "left", fs(o, -3));
      x.restore();
      target(x, g, sc, xR, hiP, Math.abs(hiP - loP), o, true);
    },
    hit: function (o, g, sc, x0, y0) { return hitPts(o, g, sc, x0, y0, false); }
  });

  /* the double / triple reversals: a labelled skeleton, a neckline through the
     reaction points, and the measured move off the break */
  function topsTool(id, label, labels, tops, ic, up) {
    reg(id, {
      l: label, g: "Patterns", n: labels.length, ic: ic,
      render: function (o, x, g, sc) {
        var p = ptsOf(o, g, sc), i;
        x.save();
        stroke(x, o); K.polyPath(x, p, false); x.stroke(); K.dash(x, 0);
        vertexLabels(x, p, labels, o);
        /* the neckline runs through the reaction points BETWEEN the peaks */
        var neckY = null, nx0 = p[0].x, nx1 = p[p.length - 1].x;
        var mids = [], j;
        for (j = 1; j < p.length - 1; j += 2) mids.push(p[j]);
        if (mids.length) {
          neckY = 0;
          for (j = 0; j < mids.length; j++) neckY += mids[j].y;
          neckY /= mids.length;
          x.strokeStyle = o.st.c; x.lineWidth = 1.2; K.dash(x, 2);
          K.lineTo(x, { x: nx0, y: neckY }, { x: g.plotR, y: neckY });
          K.dash(x, 0);
          K.label(x, nx0 + 4, neckY - 4, "neckline", o.st.c, false, "left", fs(o, -3));
        }
        x.restore();
        if (neckY != null && sc.v) {
          var neckP = sc.v(neckY), ext = 0;
          for (i = 0; i < p.length; i += 2) ext = Math.max(ext, Math.abs(sc.v(p[i].y) - neckP));
          if (ext > 0) target(x, g, sc, nx1, neckP, ext, o, !up);
        }
      },
      hit: function (o, g, sc, x0, y0) { return hitPts(o, g, sc, x0, y0, false); }
    });
  }
  topsTool("pat2top", "Double top", ["1", "2", "3", "4", "5"], 2, "Ⅿ", true);
  topsTool("pat2bot", "Double bottom", ["1", "2", "3", "4", "5"], 2, "Ⅳ", false);
  topsTool("pat3top", "Triple top", ["1", "2", "3", "4", "5", "6", "7"], 3, "Ⲙ", true);
  topsTool("pat3bot", "Triple bottom", ["1", "2", "3", "4", "5", "6", "7"], 3, "Ⱳ", false);

  reg("patdiamond", {
    l: "Diamond", g: "Patterns", n: 4, ic: "◇",
    render: function (o, x, g, sc) {
      var p = ptsOf(o, g, sc);
      if (p.length < 4) { K.polyPath(x, p, false); stroke(x, o); x.stroke(); K.dash(x, 0); return; }
      /* the four points are left, top, right, bottom in the order they were
         clicked; the shape closes so the broadening-then-narrowing reads at once */
      K.fillPoly(x, p, o.st.c, o.st.fill);
      x.save();
      stroke(x, o); K.polyPath(x, p, true); x.stroke(); K.dash(x, 0);
      x.globalAlpha = 0.55; x.lineWidth = 1; K.dash(x, 2);
      K.lineTo(x, p[0], p[2]); K.lineTo(x, p[1], p[3]);
      K.dash(x, 0); x.globalAlpha = 1;
      K.label(x, p[2].x + 6, p[2].y, "diamond", P().ink, o.st.c, "left", fs(o, -3));
      x.restore();
      if (sc.v) {
        var h = Math.abs(sc.v(p[1].y) - sc.v(p[3].y));
        target(x, g, sc, p[2].x, sc.v(p[2].y), h, o, sc.v(p[2].y) > sc.v(p[0].y));
      }
    },
    hit: function (o, g, sc, x0, y0) { return hitPts(o, g, sc, x0, y0, true); }
  });

  /* =====================================================================
     TOOLS · ELLIOTT DEGREES
     The engine has the wave SHAPES. What it did not have is the degree: the
     same five waves are written differently depending on whether they are a
     minor, an intermediate or a major swing, and a count that does not say
     its degree cannot be nested inside another one.
     ===================================================================== */
  function degreeTool(id, label, marks, ic, scaleF) {
    reg(id, {
      l: label, g: "Elliott", n: marks.length, ic: ic,
      render: function (o, x, g, sc) {
        var p = ptsOf(o, g, sc), i;
        x.save();
        stroke(x, o); K.polyPath(x, p, false); x.stroke(); K.dash(x, 0);
        for (i = 0; i < p.length && i < marks.length; i++) {
          var above = i === 0 ? true : p[i].y <= p[i - 1].y;
          K.label(x, p[i].x, p[i].y + (above ? -9 : 17), marks[i], P().ink, o.st.c, "center",
            Math.max(9, Math.round(fs(o, -2) * scaleF)));
        }
        var lastP = p[p.length - 1];
        K.label(x, lastP.x + 8, lastP.y, label, o.st.c, false, "left", fs(o, -3));
        x.restore();
      },
      hit: function (o, g, sc, x0, y0) { return hitPts(o, g, sc, x0, y0, false); }
    });
  }
  degreeTool("ellMinor", "Elliott minor degree", ["1", "2", "3", "4", "5"], "①", 0.92);
  degreeTool("ellInt", "Elliott intermediate degree", ["(1)", "(2)", "(3)", "(4)", "(5)"], "⑴", 1.05);
  degreeTool("ellMajor", "Elliott major degree", ["((1))", "((2))", "((3))", "((4))", "((5))"], "Ⓘ", 1.2);

  /* =====================================================================
     TOOLS · ANNOTATIONS
     ===================================================================== */

  function boxText(x, ax, ay, lines, o, bg, align) {
    var f = fs(o, 0), i, w = 0, pal = P();
    x.save();
    x.font = "600 " + f + "px Inter,system-ui,sans-serif";
    for (i = 0; i < lines.length; i++) w = Math.max(w, x.measureText(lines[i]).width);
    var pad = 6, bw = w + pad * 2, bh = lines.length * (f + 4) + pad * 2 - 4;
    var bx = align === "right" ? ax - bw : ax;
    x.globalAlpha = 0.94; x.fillStyle = bg || pal.tipBg; x.fillRect(bx, ay - bh, bw, bh); x.globalAlpha = 1;
    x.strokeStyle = o.st.c; x.lineWidth = 1; x.strokeRect(bx, ay - bh, bw, bh);
    x.fillStyle = bg ? pal.ink : o.st.c;
    for (i = 0; i < lines.length; i++) x.fillText(lines[i], bx + pad, ay - bh + pad + f - 2 + i * (f + 4));
    x.restore();
    return { x: bx, y: ay - bh, w: bw, h: bh };
  }
  /* A few annotations only know how wide they are once they have measured their
     own text, and that is a property of the frame, not of the drawing. Keeping it
     in a side map means nothing transient is written into the saved object. */
  var MEAS = {};
  function measured(o, w, h) { MEAS[o.id] = { w: w, h: h }; }
  function mw(o, dflt) { return MEAS[o.id] ? MEAS[o.id].w : dflt; }
  function mh(o, dflt) { return MEAS[o.id] ? MEAS[o.id].h : dflt; }

  reg("pricenote", {
    l: "Price note", g: "Annotations", n: 1, ic: "🖉", ask: true,
    render: function (o, x, g, sc) {
      var a = K.sxy(g, sc, at(o, 0)), pal = P();
      var lastBar = K.last(g.series), lastC = lastBar ? lastBar.c : 0;
      var p0 = at(o, 0).p;
      var lines = [o.st.txt || "note", K.fmt(p0) + (lastC ? "   " + K.pct((p0 / lastC - 1) * 100) + " from last" : "")];
      x.save();
      x.strokeStyle = o.st.c; x.lineWidth = o.st.w; K.dash(x, 2);
      K.lineTo(x, { x: g.plotL, y: a.y }, { x: g.plotR, y: a.y }); K.dash(x, 0);
      x.fillStyle = o.st.c; x.beginPath(); x.arc(a.x, a.y, 3.4, 0, TAU); x.fill();
      x.restore();
      boxText(x, a.x + 8, a.y - 6, lines, o, null, "left");
    },
    hit: function (o, g, sc, x0, y0) { return Math.abs(y0 - sc.y(at(o, 0).p)); }
  });

  reg("table", {
    l: "Table", g: "Annotations", n: 1, ic: "▦",
    render: function (o, x, g, sc) {
      var a = K.sxy(g, sc, at(o, 0)), pal = P();
      var rows = o.st.tbl && o.st.tbl.length ? o.st.tbl : [["Level", "Price"], ["entry", K.fmt(at(o, 0).p)], ["note", "double-click to edit"]];
      var f = fs(o, -1), i, j, cols = 0;
      for (i = 0; i < rows.length; i++) cols = Math.max(cols, rows[i].length);
      x.save();
      x.font = "600 " + f + "px Inter,system-ui,sans-serif";
      var wCol = [], cw;
      for (j = 0; j < cols; j++) {
        cw = 40;
        for (i = 0; i < rows.length; i++) cw = Math.max(cw, x.measureText(String(rows[i][j] == null ? "" : rows[i][j])).width + 14);
        wCol.push(cw);
      }
      var tw = 0;
      for (j = 0; j < cols; j++) tw += wCol[j];
      var rh = f + 9, th = rows.length * rh;
      x.globalAlpha = 0.95; x.fillStyle = pal.tipBg; x.fillRect(a.x, a.y, tw, th); x.globalAlpha = 1;
      /* the header row carries the object's colour so the grid reads as one thing
         rather than a stack of lines that happen to line up */
      x.globalAlpha = 0.2; x.fillStyle = o.st.c; x.fillRect(a.x, a.y, tw, rh); x.globalAlpha = 1;
      x.strokeStyle = o.st.c; x.lineWidth = 1;
      x.strokeRect(a.x, a.y, tw, th);
      x.globalAlpha = 0.45;
      for (i = 1; i < rows.length; i++) K.lineTo(x, { x: a.x, y: a.y + i * rh }, { x: a.x + tw, y: a.y + i * rh });
      var acc = 0;
      for (j = 1; j < cols; j++) { acc += wCol[j - 1]; K.lineTo(x, { x: a.x + acc, y: a.y }, { x: a.x + acc, y: a.y + th }); }
      x.globalAlpha = 1;
      for (i = 0; i < rows.length; i++) {
        var cx = a.x;
        for (j = 0; j < cols; j++) {
          x.fillStyle = i === 0 ? o.st.c : pal.textHi;
          x.fillText(String(rows[i][j] == null ? "" : rows[i][j]), cx + 7, a.y + i * rh + f + 3);
          cx += wCol[j];
        }
      }
      x.restore();
      measured(o, tw, th);
    },
    hit: function (o, g, sc, x0, y0) {
      var a = K.sxy(g, sc, at(o, 0)), w = mw(o, 160), h = mh(o, 60);
      return x0 >= a.x - 4 && x0 <= a.x + w + 4 && y0 >= a.y - 4 && y0 <= a.y + h + 4 ? 0 : 1e9;
    }
  });

  var EMOJI = ["🎯", "🔥", "⚠️", "✅", "❌", "💧", "🐂", "🐻", "⏳", "💡", "📌", "🚀"];
  reg("emoji", {
    l: "Emoji", g: "Annotations", n: 1, ic: "🙂", ask: true,
    render: function (o, x, g, sc) {
      var a = K.sxy(g, sc, at(o, 0)), f = (o.st.fs || 12) * 2.1;
      var glyph = o.st.txt && o.st.txt.length <= 4 ? o.st.txt : EMOJI[0];
      x.save();
      x.font = f + "px Inter,system-ui,sans-serif"; x.textAlign = "center";
      x.fillStyle = o.st.c;
      x.fillText(glyph, a.x, a.y);
      if (o.st.txt && o.st.txt.length > 4) K.label(x, a.x, a.y + 14, o.st.txt, o.st.c, false, "center", fs(o, -3));
      x.restore();
    },
    hit: function (o, g, sc, x0, y0) {
      var a = K.sxy(g, sc, at(o, 0));
      return Math.hypot(x0 - a.x, y0 - a.y + 8) - 14;
    }
  });

  reg("balloon", {
    l: "Balloon", g: "Annotations", n: 1, ic: "🗯", ask: true,
    render: function (o, x, g, sc) {
      var a = K.sxy(g, sc, at(o, 0)), f = fs(o, 0), txt = o.st.txt || "balloon", pal = P();
      x.save();
      x.font = "600 " + f + "px Inter,system-ui,sans-serif";
      var w = x.measureText(txt).width + 18, h = f + 16, bx = a.x - w / 2, by = a.y - h - 14, r = 8;
      /* a rounded box drawn by hand: arcTo is not in the engine's canvas surface,
         and quadratic corners keep the shape inside the primitives already in use */
      x.beginPath();
      x.moveTo(bx + r, by);
      x.lineTo(bx + w - r, by); x.quadraticCurveTo(bx + w, by, bx + w, by + r);
      x.lineTo(bx + w, by + h - r); x.quadraticCurveTo(bx + w, by + h, bx + w - r, by + h);
      x.lineTo(a.x + 7, by + h); x.lineTo(a.x, a.y - 3); x.lineTo(a.x - 7, by + h);
      x.lineTo(bx + r, by + h); x.quadraticCurveTo(bx, by + h, bx, by + h - r);
      x.lineTo(bx, by + r); x.quadraticCurveTo(bx, by, bx + r, by);
      x.closePath();
      x.globalAlpha = 0.95; x.fillStyle = pal.tipBg; x.fill(); x.globalAlpha = 1;
      x.strokeStyle = o.st.c; x.lineWidth = o.st.w; x.stroke();
      x.fillStyle = o.st.c; x.textAlign = "center";
      x.fillText(txt, a.x, by + f + 6);
      x.restore();
      measured(o, w, h);
    },
    hit: function (o, g, sc, x0, y0) {
      var a = K.sxy(g, sc, at(o, 0)), w = mw(o, 80), h = mh(o, 30);
      return x0 >= a.x - w / 2 - 4 && x0 <= a.x + w / 2 + 4 && y0 >= a.y - h - 20 && y0 <= a.y + 4 ? 0 : 1e9;
    }
  });

  reg("badge", {
    l: "Badge", g: "Annotations", n: 1, ic: "❶", ask: true,
    render: function (o, x, g, sc) {
      var a = K.sxy(g, sc, at(o, 0)), f = fs(o, -1), txt = o.st.txt || "1", pal = P();
      x.save();
      x.font = "700 " + f + "px Inter,system-ui,sans-serif";
      var w = Math.max(f + 10, x.measureText(txt).width + 14), h = f + 8;
      var by = a.y - h - 10;
      x.strokeStyle = o.st.c; x.lineWidth = 1.2;
      K.lineTo(x, { x: a.x, y: a.y }, { x: a.x, y: by + h });
      x.fillStyle = o.st.c;
      x.beginPath();
      x.moveTo(a.x - w / 2 + h / 2, by);
      x.lineTo(a.x + w / 2 - h / 2, by);
      x.arc(a.x + w / 2 - h / 2, by + h / 2, h / 2, -Math.PI / 2, Math.PI / 2);
      x.lineTo(a.x - w / 2 + h / 2, by + h);
      x.arc(a.x - w / 2 + h / 2, by + h / 2, h / 2, Math.PI / 2, -Math.PI / 2);
      x.closePath(); x.fill();
      x.fillStyle = pal.ink; x.textAlign = "center";
      x.fillText(txt, a.x, by + f + 2);
      x.restore();
      measured(o, w, h);
    },
    hit: function (o, g, sc, x0, y0) {
      var a = K.sxy(g, sc, at(o, 0)), w = mw(o, 30), h = mh(o, 20);
      return x0 >= a.x - w / 2 - 4 && x0 <= a.x + w / 2 + 4 && y0 >= a.y - h - 16 && y0 <= a.y + 4 ? 0 : 1e9;
    }
  });

  reg("tag", {
    l: "Tag", g: "Annotations", n: 1, ic: "🏳", ask: true,
    render: function (o, x, g, sc) {
      var a = K.sxy(g, sc, at(o, 0)), f = fs(o, -1), pal = P();
      var txt = (o.st.txt ? o.st.txt + "  " : "") + K.fmt(at(o, 0).p);
      x.save();
      x.font = "600 " + f + "px ui-monospace,Menlo,monospace";
      var w = x.measureText(txt).width + 18, h = f + 8, tip = 7;
      /* a tag points back at the bar it is pinned to, which is what separates it
         from a plain label sitting near one */
      x.beginPath();
      x.moveTo(a.x, a.y);
      x.lineTo(a.x + tip, a.y - h / 2);
      x.lineTo(a.x + w, a.y - h / 2);
      x.lineTo(a.x + w, a.y + h / 2);
      x.lineTo(a.x + tip, a.y + h / 2);
      x.closePath();
      x.fillStyle = o.st.c; x.fill();
      x.fillStyle = pal.ink; x.textAlign = "left";
      x.fillText(txt, a.x + tip + 5, a.y + f / 2 - 1);
      x.restore();
      measured(o, w, h);
    },
    hit: function (o, g, sc, x0, y0) {
      var a = K.sxy(g, sc, at(o, 0)), w = mw(o, 70), h = mh(o, 20);
      return x0 >= a.x - 4 && x0 <= a.x + w + 4 && y0 >= a.y - h / 2 - 4 && y0 <= a.y + h / 2 + 4 ? 0 : 1e9;
    }
  });

  /* =====================================================================
     TOOLS · POSITIONS AND PROJECTION
     ===================================================================== */

  /* The paper wallet is a map of coin -> amount on the app's state object (S.bal);
     the cash leg is the quote coin. There is no single "account equity" field on
     the paper desk that a chart drawing may read — DLAPP.legacy.perps.equityUSD is
     the PERPS margin account, which is not the spot wallet this tool sizes against.
     So: the quote balance when it is there, an amount typed onto the object when it
     is not, and the drawing says which it used rather than inventing a number. */
  function accountCash(o) {
    var st = S(), q = st.quote || "USDT";
    var typed = num(+o.st.acct, 0);
    if (typed > 0) return { cash: typed, src: "typed" };
    var bal = st.bal && st.bal[q];
    if (typeof bal === "number" && isFinite(bal) && bal > 0) return { cash: bal, src: q + " balance" };
    return { cash: 0, src: "no paper balance" };
  }
  function riskRender(long) {
    return function (o, x, g, sc) {
      var p0 = at(o, 0), p1 = at(o, 1), pal = P();
      var entry = p0.p, stop = p1.p;
      var a = K.sxy(g, sc, p0), x1 = px(g, o, 1);
      var x0 = Math.min(a.x, x1), xw = Math.abs(x1 - a.x) || 130;
      var yE = a.y, yS = sc.y(stop);
      var per = Math.abs(entry - stop);
      var riskPct = clamp(num(+o.st.risk, 0) || 1, 0.05, 100);
      var acct = accountCash(o);
      var budget = acct.cash * riskPct / 100;
      var qty = per > 0 && budget > 0 ? budget / per : 0;
      var rr = num(+o.st.rr, 0) || 2;
      var tgt = long ? entry + per * rr : entry - per * rr, yT = sc.y(tgt);
      x.save();
      x.globalAlpha = 0.16;
      x.fillStyle = pal.dn; x.fillRect(x0, Math.min(yE, yS), xw, Math.abs(yS - yE));
      x.fillStyle = pal.up; x.fillRect(x0, Math.min(yE, yT), xw, Math.abs(yT - yE));
      x.globalAlpha = 1;
      x.strokeStyle = pal.faint; x.lineWidth = 1; K.dash(x, 2);
      K.lineTo(x, { x: x0, y: yE }, { x: x0 + xw, y: yE }); K.dash(x, 0);
      x.strokeStyle = pal.dn; K.lineTo(x, { x: x0, y: yS }, { x: x0 + xw, y: yS });
      x.strokeStyle = pal.up; K.lineTo(x, { x: x0, y: yT }, { x: x0 + xw, y: yT });
      K.label(x, x0 + 4, yE - 4, (long ? "LONG " : "SHORT ") + K.fmt(entry), pal.textHi, null, "left", fs(o, -2));
      K.label(x, x0 + 4, yS + (yS < yE ? -4 : 12), "stop " + K.fmt(stop), pal.ink, pal.dn, "left", fs(o, -2));
      K.label(x, x0 + 4, yT + (yT < yE ? -4 : 12), "target " + K.fmt(tgt) + "   R:R " + rr.toFixed(2), pal.ink, pal.up, "left", fs(o, -2));
      var line = qty > 0
        ? "risk " + riskPct.toFixed(2) + "%  ·  " + K.fmt(budget) + " of " + K.fmt(acct.cash) + "  ·  size " + K.sig(qty)
        : "risk " + riskPct.toFixed(2) + "%  ·  " + acct.src + " — type an amount on the object to size it";
      K.label(x, x0 + xw - 4, (yE + yS) / 2, line, pal.ink, qty > 0 ? "#FFD166" : pal.faint, "right", fs(o, -2));
      x.restore();
    };
  }
  function riskHit(o, g, sc, x0, y0) {
    var a = K.sxy(g, sc, at(o, 0)), x1 = px(g, o, 1);
    var left = Math.min(a.x, x1), w = Math.abs(x1 - a.x) || 130;
    if (x0 < left - 4 || x0 > left + w + 4) return 1e9;
    return Math.min(Math.abs(y0 - a.y), Math.abs(y0 - sc.y(at(o, 1).p)));
  }
  reg("riskpos", { l: "Long, sized from risk %", g: "Positions", n: 2, ic: "⚖", render: riskRender(true), hit: riskHit });
  reg("riskshort", { l: "Short, sized from risk %", g: "Positions", n: 2, ic: "⚓", render: riskRender(false), hit: riskHit });

  reg("ghostfeed", {
    l: "Ghost feed", g: "Positions", n: 2, ic: "👻",
    render: function (o, x, g, sc) {
      var r = rangeOf(o, g, 0, 1), pal = P();
      var len = r.hi - r.lo + 1;
      if (len < 2) return;
      var reps = clamp(Math.round(num(+o.st.reps, 0) || 2), 1, 8);
      var s = g.series, anchor = s.length - 1, base = s[r.lo].c, shift = s[anchor].c - base;
      var bw = Math.max(1, g.sp * 0.62), i, k;
      x.save();
      /* the copied stretch, laid end to end from the last real bar and each
         repeat re-based on the one before it, so the projection is continuous
         instead of jumping back to the source price at every seam */
      for (k = 0; k < reps; k++) {
        for (i = 0; i < len; i++) {
          var b = s[r.lo + i];
          if (!b) continue;
          var cx = g.x(anchor + 1 + k * len + i);
          if (!inPlot(g, cx)) continue;
          var up = b.c >= b.o;
          x.globalAlpha = 0.42 - k * 0.06;
          x.strokeStyle = up ? pal.up : pal.dn; x.fillStyle = up ? pal.upFill : pal.dnFill;
          x.beginPath(); x.moveTo(cx, sc.y(b.h + shift)); x.lineTo(cx, sc.y(b.l + shift)); x.stroke();
          var yo = sc.y(b.o + shift), yc = sc.y(b.c + shift);
          x.fillRect(cx - bw / 2, Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
        }
        shift += s[r.hi].c - s[r.lo].c;
      }
      x.globalAlpha = 1;
      stroke(x, o, 1, 2); vline(x, g, g.x(anchor + 0.5)); K.dash(x, 0);
      K.label(x, g.x(anchor + 1), g.plotT + 12, "ghost ×" + reps + " (" + len + " bars)", o.st.c, false, "left", fs(o, -3));
      x.restore();
    },
    hit: function (o, g, sc, x0) {
      var r = rangeOf(o, g, 0, 1);
      return nearX([g.x(r.lo), g.x(r.hi)], x0);
    }
  });

  reg("cone", {
    l: "Forecast cone", g: "Positions", n: 3, ic: "◁",
    render: function (o, x, g, sc) {
      var p = ptsOf(o, g, sc);
      if (p.length < 3) { K.lineTo(x, p[0], p[p.length - 1]); return; }
      var A = at(o, 0), U = at(o, 1), D = at(o, 2);
      var iA = g.iOf(A.t), iEnd = Math.max(g.iOf(U.t), g.iOf(D.t));
      var xA = g.x(iA), xE = g.x(iEnd);
      var yA = sc.y(A.p), yU = sc.y(U.p), yD = sc.y(D.p);
      var mid = (U.p + D.p) / 2, i;
      x.save();
      /* three nested bands rather than one wedge: a cone that only shows its
         outer edge says nothing about where inside it the path is likely to be */
      var fr = [1, 0.62, 0.3];
      for (i = 0; i < fr.length; i++) {
        var up = { x: xE, y: yA + (yU - yA) * fr[i] }, dn = { x: xE, y: yA + (yD - yA) * fr[i] };
        K.fillPoly(x, [{ x: xA, y: yA }, up, dn], o.st.c, (o.st.fill || 0.12) * (0.5 + i * 0.28));
      }
      stroke(x, o, o.st.w, 2);
      K.lineTo(x, { x: xA, y: yA }, { x: xE, y: yU });
      K.lineTo(x, { x: xA, y: yA }, { x: xE, y: yD });
      K.dash(x, 0);
      x.globalAlpha = 0.8;
      K.lineTo(x, { x: xA, y: yA }, { x: xE, y: sc.y(mid) });
      x.globalAlpha = 1;
      K.label(x, xE - 4, yU - 4, K.fmt(U.p) + "  " + K.pct(A.p ? (U.p / A.p - 1) * 100 : 0), o.st.c, false, "right", fs(o, -3));
      K.label(x, xE - 4, yD + 12, K.fmt(D.p) + "  " + K.pct(A.p ? (D.p / A.p - 1) * 100 : 0), o.st.c, false, "right", fs(o, -3));
      K.label(x, xE - 4, sc.y(mid) - 4, "mid " + K.fmt(mid), o.st.c, false, "right", fs(o, -3));
      x.restore();
    },
    hit: function (o, g, sc, x0, y0) {
      var p = ptsOf(o, g, sc);
      if (p.length < 3) return K.dist2seg(x0, y0, p[0], p[p.length - 1]);
      return Math.min(K.dist2seg(x0, y0, p[0], p[1]), K.dist2seg(x0, y0, p[0], p[2]));
    }
  });

  /* =====================================================================
     TOOLS · MEASURE
     ===================================================================== */

  reg("bardelta", {
    l: "Bar delta", g: "Measure", n: 2, ic: "Δ",
    render: function (o, x, g, sc) {
      var r = rangeOf(o, g, 0, 1), pal = P();
      if (r.hi - r.lo < 1) return;
      var s = g.series, i, up = 0, dn = 0, cum = 0, path = [], peak = 0;
      /* Without a tick tape there is no true buy/sell split. What a bar CAN say
         is where it closed inside its own range: a close at the high is buying,
         a close at the low is selling. That is the estimate this draws, and the
         label says so rather than calling it order flow. */
      for (i = r.lo; i <= r.hi && i < s.length; i++) {
        var b = s[i], rg = b.h - b.l, f = rg > 0 ? ((b.c - b.l) - (b.h - b.c)) / rg : 0;
        var dv = (b.v || 0) * f;
        if (dv >= 0) up += dv; else dn -= dv;
        cum += dv;
        peak = Math.max(peak, Math.abs(cum));
        path.push({ i: i, dv: dv, cum: cum });
      }
      if (!path.length) return;
      var yBase = g.plotB - 46, hMax = 30, maxAbs = 1;
      for (i = 0; i < path.length; i++) maxAbs = Math.max(maxAbs, Math.abs(path[i].dv));
      var bw = Math.max(1, g.sp * 0.6);
      x.save();
      for (i = 0; i < path.length; i++) {
        var h = Math.abs(path[i].dv) / maxAbs * hMax;
        x.globalAlpha = 0.75;
        x.fillStyle = path[i].dv >= 0 ? pal.up : pal.dn;
        x.fillRect(g.x(path[i].i) - bw / 2, path[i].dv >= 0 ? yBase - h : yBase, bw, Math.max(1, h));
      }
      x.globalAlpha = 1;
      x.strokeStyle = pal.faint; x.lineWidth = 1;
      K.lineTo(x, { x: g.x(r.lo), y: yBase }, { x: g.x(r.hi), y: yBase });
      var line = [];
      for (i = 0; i < path.length; i++) line.push({ x: g.x(path[i].i), y: yBase - (path[i].cum / (peak || 1)) * hMax });
      stroke(x, o, o.st.w, 0); K.polyPath(x, line, false); x.stroke();
      K.label(x, g.x(r.lo) + 4, yBase - hMax - 6,
        "delta " + K.volFmt(cum) + "  ·  up " + K.volFmt(up) + "  ·  down " + K.volFmt(dn) + "  (close-in-range estimate)",
        o.st.c, false, "left", fs(o, -3));
      x.restore();
    },
    hit: function (o, g, sc, x0, y0) {
      var r = rangeOf(o, g, 0, 1);
      var yB = g.plotB - 46;
      return x0 >= g.x(r.lo) - 4 && x0 <= g.x(r.hi) + 4 ? Math.abs(y0 - yB) : 1e9;
    }
  });

  reg("sessrange", {
    l: "Session range", g: "Measure", n: 2, ic: "▯",
    render: function (o, x, g, sc) {
      var r = rangeOf(o, g, 0, 1), pal = P();
      var ss = sessions(g, r.lo, r.hi), i, j;
      x.save();
      for (i = 0; i < ss.length && i < 60; i++) {
        var s0 = ss[i], hi = -Infinity, lo = Infinity;
        for (j = s0.from; j <= s0.to; j++) { hi = Math.max(hi, g.series[j].h); lo = Math.min(lo, g.series[j].l); }
        if (!isFinite(hi)) continue;
        var xL = g.x(s0.from - 0.4), xR = g.x(s0.to + 0.4), yT = sc.y(hi), yB = sc.y(lo);
        var up = g.series[s0.to].c >= g.series[s0.from].o;
        x.globalAlpha = 0.1; x.fillStyle = up ? pal.up : pal.dn;
        x.fillRect(xL, yT, xR - xL, yB - yT); x.globalAlpha = 1;
        x.strokeStyle = up ? pal.up : pal.dn; x.lineWidth = 1; K.dash(x, 2);
        x.strokeRect(xL, yT, xR - xL, yB - yT); K.dash(x, 0);
        K.label(x, (xL + xR) / 2, yT - 4, K.pct(lo ? (hi / lo - 1) * 100 : 0), pal.ink, up ? pal.up : pal.dn, "center", fs(o, -4));
      }
      x.restore();
    },
    hit: function (o, g, sc, x0) {
      var r = rangeOf(o, g, 0, 1);
      return x0 >= Math.min(g.x(r.lo), g.x(r.hi)) - 4 && x0 <= Math.max(g.x(r.lo), g.x(r.hi)) + 4 ? 0 : 1e9;
    }
  });

  reg("sessbreaks", {
    l: "Session breaks", g: "Measure", n: 2, ic: "┊",
    render: function (o, x, g, sc) {
      var r = rangeOf(o, g, 0, 1);
      var ss = sessions(g, r.lo, r.hi), i;
      x.save();
      for (i = 0; i < ss.length && i < 200; i++) {
        var xx = g.x(ss[i].from - 0.5);
        if (!inPlot(g, xx)) continue;
        stroke(x, o, 1, 2); x.globalAlpha = 0.75;
        vline(x, g, xx);
        K.label(x, xx + 3, g.plotT + 12, K.stamp(ss[i].t, "1d"), o.st.c, false, "left", fs(o, -4));
      }
      x.globalAlpha = 1; K.dash(x, 0); x.restore();
    },
    hit: function (o, g, sc, x0) {
      var r = rangeOf(o, g, 0, 1), ss = sessions(g, r.lo, r.hi), xs = [], i;
      for (i = 0; i < ss.length; i++) xs.push(g.x(ss[i].from - 0.5));
      return xs.length ? nearX(xs, x0) : 1e9;
    }
  });

  reg("openrange", {
    l: "Opening range", g: "Measure", n: 2, ic: "⊟",
    render: function (o, x, g, sc) {
      var r = rangeOf(o, g, 0, 1), pal = P(), i;
      if (r.hi - r.lo < 1) return;
      var hi = -Infinity, lo = Infinity;
      for (i = r.lo; i <= r.hi && i < g.series.length; i++) { hi = Math.max(hi, g.series[i].h); lo = Math.min(lo, g.series[i].l); }
      if (!isFinite(hi) || !(hi > lo)) return;
      var h = hi - lo, xL = g.x(r.lo - 0.5), xR = g.x(r.hi + 0.5);
      x.save();
      x.globalAlpha = o.st.fill; x.fillStyle = o.st.c;
      x.fillRect(xL, sc.y(hi), xR - xL, sc.y(lo) - sc.y(hi)); x.globalAlpha = 1;
      stroke(x, o); x.strokeRect(xL, sc.y(hi), xR - xL, sc.y(lo) - sc.y(hi)); K.dash(x, 0);
      /* the range projected up and down at 1× and 2× — the only two lines an
         opening-range break is actually traded against */
      var levels = [[hi + h, "+1×"], [hi + h * 2, "+2×"], [lo - h, "−1×"], [lo - h * 2, "−2×"]];
      for (i = 0; i < levels.length; i++) {
        var up = levels[i][0] > hi;
        x.strokeStyle = up ? pal.up : pal.dn; x.lineWidth = 1; K.dash(x, 4);
        K.lineTo(x, { x: xR, y: sc.y(levels[i][0]) }, { x: g.plotR, y: sc.y(levels[i][0]) });
        K.dash(x, 0);
        K.label(x, xR + 5, sc.y(levels[i][0]) - 3, levels[i][1] + "  " + K.fmt(levels[i][0]), x.strokeStyle, false, "left", fs(o, -3));
      }
      K.label(x, xL + 4, sc.y(hi) - 4, "OR " + K.fmt(lo) + " – " + K.fmt(hi) + "  (" + K.pct(lo ? h / lo * 100 : 0) + ")",
        o.st.c, false, "left", fs(o, -3));
      x.restore();
    },
    hit: function (o, g, sc, x0, y0) {
      var r = rangeOf(o, g, 0, 1), i, hi = -Infinity, lo = Infinity;
      for (i = r.lo; i <= r.hi && i < g.series.length; i++) { hi = Math.max(hi, g.series[i].h); lo = Math.min(lo, g.series[i].l); }
      if (!isFinite(hi)) return 1e9;
      return K.hitBox(K.bbox([{ x: g.x(r.lo), y: sc.y(hi) }, { x: g.x(r.hi), y: sc.y(lo) }]), x0, y0);
    }
  });

  reg("anchmeasure", {
    l: "Anchored measure", g: "Measure", n: 1, ic: "⇲",
    render: function (o, x, g, sc) {
      var lo = idxOf(g, at(o, 0).t), s = g.series, pal = P();
      var hiI = s.length - 1;
      if (hiI <= lo) return;
      var a = s[lo], b = s[hiI], i, mfe = 0, mae = 0;
      for (i = lo; i <= hiI; i++) {
        mfe = Math.max(mfe, s[i].h - a.c);
        mae = Math.min(mae, s[i].l - a.c);
      }
      var dp = b.c - a.c, pctv = a.c ? dp / a.c * 100 : 0, bars = hiI - lo;
      var ms = b.t - a.t, dys = ms / DAYMS;
      var xA = g.x(lo), xB = Math.min(g.x(hiI), g.plotR);
      var yA = sc.y(a.c), yB = sc.y(b.c), up = dp >= 0;
      x.save();
      x.globalAlpha = 0.12; x.fillStyle = up ? pal.up : pal.dn;
      x.fillRect(Math.min(xA, xB), Math.min(yA, yB), Math.abs(xB - xA), Math.abs(yB - yA)); x.globalAlpha = 1;
      x.strokeStyle = up ? pal.up : pal.dn; x.lineWidth = 1.2;
      K.lineTo(x, { x: xA, y: yA }, { x: xB, y: yA });
      K.lineTo(x, { x: xA, y: yB }, { x: xB, y: yB });
      x.fillStyle = up ? pal.up : pal.dn;
      K.arrowHead(x, { x: (xA + xB) / 2, y: yA }, { x: (xA + xB) / 2, y: yB }, 8);
      x.restore();
      boxText(x, Math.min(xA + 8, g.plotR - 190), Math.min(yA, yB) - 6, [
        K.fmt(dp) + "   " + K.pct(pctv),
        bars + " bars  ·  " + (dys >= 1 ? dys.toFixed(1) + "d" : (ms / 36e5).toFixed(1) + "h"),
        "best " + K.pct(a.c ? mfe / a.c * 100 : 0) + "   worst " + K.pct(a.c ? mae / a.c * 100 : 0)
      ], o, null, "left");
    },
    hit: function (o, g, sc, x0, y0) {
      var lo = idxOf(g, at(o, 0).t), s = g.series;
      if (lo >= s.length - 1) return 1e9;
      return Math.min(Math.abs(x0 - g.x(lo)), Math.abs(y0 - sc.y(s[lo].c)));
    }
  });

  /* =====================================================================
     THE OBJECT LAYER
     Three things the chart could not do: keep a look, watch a drawing, and
     handle a dozen drawings as one. All three are dialogs built from the
     engine's own widgets, and all three reach the click handler through the
     one delegated listener below — a per-node handler would leak every time
     a dialog is rebuilt, which these dialogs do on every action.
     ===================================================================== */

  var el = K.el, btn = K.btn, modal = K.modal, closeModal = K.closeModal, fieldRow = K.fieldRow;
  var inputNum = K.inputNum, select = K.select, checkbox = K.checkbox, clear = K.clear;

  function toolLabel(id) { var t = DXC.toolDefs()[id]; return t ? t.l : id; }
  function objName(o) {
    return toolLabel(o.tool) + (o.st.txt ? " · " + o.st.txt : "") + (o.grp ? "  [" + o.grp + "]" : "");
  }
  function objsIn(name) {
    var a = K.drawings(), out = [], i;
    for (i = 0; i < a.length; i++) if (a[i].grp === name) out.push(a[i]);
    return out;
  }
  function groupNames() {
    var a = K.drawings(), seen = {}, out = [], i;
    for (i = 0; i < a.length; i++) if (a[i].grp && !seen[a[i].grp]) { seen[a[i].grp] = 1; out.push(a[i].grp); }
    out.sort();
    return out;
  }
  function byId(id) {
    var a = K.drawings(), i;
    for (i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
    return null;
  }
  function pick(sel) { return d.getElementById(sel); }
  function checkedIds(box) {
    var out = [], i, rows = box ? box.querySelectorAll("[data-dxt-pick]") : [];
    for (i = 0; i < rows.length; i++) if (rows[i].checked) out.push(rows[i].getAttribute("data-dxt-pick"));
    return out;
  }

  /* ------------------------------------------------------------- templates */
  function dlgTpl() {
    var body = modal("Drawing templates", true);
    var tpl = templates(), tdef = toolDefaults(), names = [], k;
    for (k in tpl) if (Object.prototype.hasOwnProperty.call(tpl, k)) names.push(k);
    names.sort();

    body.appendChild(el("div", "dxc-lg", "Saved templates"));
    if (!names.length) body.appendChild(el("div", "dxc-empty", "Nothing saved yet. The style below starts from what a new drawing is born with."));
    var i;
    for (i = 0; i < names.length; i++) {
      var t = tpl[names[i]], row = el("div", "dxc-li static");
      var sw = el("span", "dxt-sw");
      sw.style.setProperty("--dxc-c", t.c || "#5B8CFF");
      row.appendChild(sw);
      row.appendChild(el("span", "nm", names[i]));
      row.appendChild(el("span", "tg", "w " + (t.w == null ? "—" : t.w) + " · fill " + (t.fill == null ? "—" : t.fill)));
      row.appendChild(btn("dxc-b", "Apply", "Apply to the objects ticked below", { "data-dxt-tpl-apply": names[i] }));
      row.appendChild(btn("dxc-b", "Default", "Make this the default for a tool", { "data-dxt-tpl-def": names[i] }));
      row.appendChild(btn("dxc-b", "New drawings", "Use for every new drawing", { "data-dxt-tpl-new": names[i] }));
      row.appendChild(btn("dxc-b", "Delete", "Delete this template", { "data-dxt-tpl-del": names[i] }));
      body.appendChild(row);
    }

    body.appendChild(el("div", "dxc-lg", "Save the current style"));
    var cur = K.drawStyle();
    var nm = el("input", "dxc-in wide", null, { type: "text", placeholder: "Template name", id: "dxtTplName" });
    body.appendChild(nm);
    var cIn = el("input", "dxc-in", null, { type: "text", id: "dxtTplC", value: cur.c || "#00E5FF" });
    cIn.value = cur.c || "#00E5FF";
    fieldRow(body, "Colour (hex)", cIn);
    var wIn = inputNum(cur.w == null ? 1.6 : cur.w, "0.2"); wIn.setAttribute("id", "dxtTplW");
    fieldRow(body, "Line width", wIn);
    var dIn = select([{ v: "0", l: "Solid" }, { v: "2", l: "Dotted" }, { v: "4", l: "Dashed" }], String(cur.dash || 0));
    dIn.setAttribute("id", "dxtTplD");
    fieldRow(body, "Dash", dIn);
    var fIn = inputNum(cur.fill == null ? 0.12 : cur.fill, "0.02"); fIn.setAttribute("id", "dxtTplF");
    fieldRow(body, "Fill opacity", fIn);
    var sIn = inputNum(cur.fs == null ? 12 : cur.fs, "1"); sIn.setAttribute("id", "dxtTplS");
    fieldRow(body, "Font size", sIn);
    var row2 = el("div", "dxc-row");
    row2.appendChild(btn("dxc-go", "Save template", "Save these five values under the name above", { "data-dxc": "dxt-tpl-save" }));
    body.appendChild(row2);

    body.appendChild(el("div", "dxc-lg", "Tool defaults"));
    var any = false;
    for (k in tdef) {
      if (!Object.prototype.hasOwnProperty.call(tdef, k)) continue;
      any = true;
      var r3 = el("div", "dxc-li static");
      r3.appendChild(el("span", "nm", toolLabel(k)));
      r3.appendChild(el("span", "tg", tdef[k]));
      r3.appendChild(btn("dxc-b", "Clear", "Stop giving this tool that template", { "data-dxt-tpl-undef": k }));
      body.appendChild(r3);
    }
    if (!any) body.appendChild(el("div", "dxc-empty", "No tool has a default template yet."));

    body.appendChild(el("div", "dxc-lg", "Apply to"));
    body.appendChild(objPicker());
    body.appendChild(el("div", "dxc-note",
      "A template is a look, not a drawing: colour, width, dash, fill and font size. "
      + "Set it as a tool default and the NEXT drawing made with that tool is born with it — "
      + "drawings already on the chart are left alone."));
  }
  function objPicker() {
    var box = el("div", "dxc-list", null, { id: "dxtPick" });
    var a = K.drawings(), i;
    if (!a.length) { box.appendChild(el("div", "dxc-empty", "Nothing drawn on this market yet.")); return box; }
    for (i = a.length - 1; i >= 0; i--) {
      /* a div, not a label: a label would toggle its own checkbox when the row's
         Edit button is pressed, which is not what pressing Edit means */
      var o = a[i], row = el("div", "dxc-li static");
      var ck = checkbox(false);
      ck.setAttribute("data-dxt-pick", o.id);
      row.appendChild(ck);
      row.appendChild(el("span", "nm", objName(o)));
      row.appendChild(el("span", "tg", K.fmt(o.pts[0].p)));
      if (o.tool === "table") row.appendChild(btn("dxc-b", "Edit rows", "Edit this table's cells", { "data-dxt-tbl-edit": o.id }));
      if (o.tool === "emoji") row.appendChild(btn("dxc-b", "Pick", "Choose the sticker", { "data-dxt-emoji": o.id }));
      box.appendChild(row);
    }
    return box;
  }

  /* ------------------------------------------------------------- alerts */
  function dlgAlerts() {
    var body = modal("Alerts on drawings", true);
    var a = K.drawings(), i, n = 0;
    body.appendChild(el("div", "dxc-lg", "Objects"));
    if (!a.length) body.appendChild(el("div", "dxc-empty", "Nothing drawn yet — an alert hangs on a drawing."));
    for (i = a.length - 1; i >= 0; i--) {
      var o = a[i], al = o.alert, row = el("div", "dxc-li static");
      row.appendChild(el("span", "ic", (DXC.toolDefs()[o.tool] || { ic: "?" }).ic));
      row.appendChild(el("span", "nm", objName(o)));
      var state = el("span", "dxt-st " + (!al ? "off" : al.hit ? "fired" : "armed"),
        !al ? "no alert" : al.hit ? "fired" : "armed");
      row.appendChild(state);
      if (al) n++;
      row.appendChild(btn("dxc-b", al ? "Edit" : "Add", al ? "Edit this alert" : "Put an alert on this drawing", { "data-dxt-al-edit": o.id }));
      if (al) row.appendChild(btn("dxc-b", al.hit ? "Re-arm" : "Disarm", "Arm or disarm", { "data-dxt-al-arm": o.id }));
      if (al) row.appendChild(btn("dxc-b", "Remove", "Take the alert off", { "data-dxt-al-del": o.id }));
      body.appendChild(row);
    }
    body.appendChild(el("div", "dxc-lg", "Fired, this session"));
    if (!LOG.length) body.appendChild(el("div", "dxc-empty", "Nothing has fired yet."));
    for (i = LOG.length - 1; i >= 0 && i > LOG.length - 12; i--) {
      var r2 = el("div", "dxc-li static");
      r2.appendChild(el("span", "nm", LOG[i].msg));
      r2.appendChild(el("span", "tg", K.stamp(LOG[i].at, "1h")));
      body.appendChild(r2);
    }
    body.appendChild(el("div", "dxc-note",
      "An alert is checked against the newest bar on every painted frame and raised through the app's own "
      + "alert path — the toast, the sound and the DeXaI event Sentinel uses. It also marks the drawing on "
      + "the chart. " + n + " drawing" + (n === 1 ? " carries" : "s carry") + " one."));
  }
  function dlgAlertEdit(id) {
    var o = byId(id);
    if (!o) return;
    var body = modal("Alert on " + objName(o));
    var al = o.alert || { kind: o.pts.length >= 2 ? "cross" : "cross", dir: 0, off: false, once: true };
    var kind = select([{ v: "cross", l: "Price crosses the line" }, { v: "enter", l: "Price enters the box" }], al.kind || "cross");
    kind.setAttribute("id", "dxtAlKind");
    fieldRow(body, "When", kind);
    var dir = select([{ v: "0", l: "Either way" }, { v: "1", l: "Upward only" }, { v: "-1", l: "Downward only" }], String(al.dir == null ? 0 : al.dir));
    dir.setAttribute("id", "dxtAlDir");
    fieldRow(body, "Direction", dir);
    var pxIn = inputNum(num(al.px, 0) || 0, "any"); pxIn.setAttribute("id", "dxtAlPx");
    fieldRow(body, "Price override (0 = read the drawing)", pxIn);
    var once = checkbox(al.once !== false); once.setAttribute("id", "dxtAlOnce");
    fieldRow(body, "Fire once", once);
    var row = el("div", "dxc-row");
    row.appendChild(btn("dxc-go", "Save", "Put this alert on the drawing", { "data-dxc": "dxt-al-save", "data-id": id }));
    row.appendChild(btn("dxc-b", "Cancel", "Close", { "data-dxc": "close" }));
    body.appendChild(row);
    body.appendChild(el("div", "dxc-note",
      "A line alert reads the price the drawing carries at the newest bar, so a sloping trend line moves its own "
      + "trigger as the chart advances. A box alert fires when a close lands inside the drawing's price range."));
  }

  /* ------------------------------------------------------------- groups */
  function dlgGroups() {
    var body = modal("Groups", true);
    var names = groupNames(), i;
    body.appendChild(el("div", "dxc-lg", "Groups on " + K.symKey()));
    if (!names.length) body.appendChild(el("div", "dxc-empty", "No groups yet. Tick some objects below and name one."));
    for (i = 0; i < names.length; i++) {
      var mem = objsIn(names[i]), hidden = 0, locked = 0, j;
      for (j = 0; j < mem.length; j++) { if (mem[j].st.vis === false) hidden++; if (mem[j].st.lock) locked++; }
      var row = el("div", "dxc-li static");
      row.appendChild(el("span", "nm", names[i]));
      row.appendChild(el("span", "tg", mem.length + " object" + (mem.length === 1 ? "" : "s")
        + (hidden ? " · " + hidden + " hidden" : "") + (locked ? " · " + locked + " locked" : "")));
      row.appendChild(btn("dxc-b", hidden === mem.length ? "Show" : "Hide", "Hide or show the whole group", { "data-dxt-g-vis": names[i] }));
      row.appendChild(btn("dxc-b", locked === mem.length ? "Unlock" : "Lock", "Lock or unlock the whole group", { "data-dxt-g-lock": names[i] }));
      row.appendChild(btn("dxc-b", "Ungroup", "Take these objects out of the group", { "data-dxt-g-out": names[i] }));
      row.appendChild(btn("dxc-b", "Delete", "Delete every object in the group", { "data-dxt-g-del": names[i] }));
      body.appendChild(row);
    }
    body.appendChild(el("div", "dxc-lg", "Make a group"));
    var nm = el("input", "dxc-in wide", null, { type: "text", placeholder: "Group name", id: "dxtGrpName" });
    body.appendChild(nm);
    body.appendChild(objPicker());
    var row2 = el("div", "dxc-row");
    row2.appendChild(btn("dxc-go", "Group the ticked objects", "Put every ticked object in the named group", { "data-dxc": "dxt-g-add" }));
    body.appendChild(row2);
    body.appendChild(el("div", "dxc-note",
      "Hiding and locking a group sets the same two flags the engine already honours on each object, so a hidden "
      + "group is skipped by the renderer and a locked one cannot be dragged."));
  }

  /* ------------------------------------------------------------- sticker set */
  function dlgEmoji(id) {
    var o = byId(id);
    if (!o) return;
    var body = modal("Sticker");
    var grid = el("div", "dxt-gr"), i;
    for (i = 0; i < EMOJI.length; i++) {
      grid.appendChild(btn("dxc-b", EMOJI[i], "Use " + EMOJI[i], { "data-dxt-emoji-set": EMOJI[i], "data-id": id }));
    }
    body.appendChild(grid);
    body.appendChild(el("div", "dxc-note", "A sticker is one glyph on the object's own text field, so it travels with the drawing and can also be typed by hand."));
  }

  /* ------------------------------------------------------------- table editor */
  function dlgTable(id) {
    var o = byId(id);
    if (!o) return;
    var body = modal("Table contents");
    var rows = o.st.tbl && o.st.tbl.length ? o.st.tbl : [["Level", "Price"], ["", ""], ["", ""]];
    var ta = el("textarea", "dxc-ta", null, { id: "dxtTblTxt", rows: "8" });
    var lines = [], i;
    for (i = 0; i < rows.length; i++) lines.push(rows[i].join(" | "));
    ta.value = lines.join("\n");
    body.appendChild(ta);
    var row = el("div", "dxc-row");
    row.appendChild(btn("dxc-go", "Save", "Write these rows onto the table", { "data-dxc": "dxt-tbl-save", "data-id": id }));
    row.appendChild(btn("dxc-b", "Cancel", "Close", { "data-dxc": "close" }));
    body.appendChild(row);
    body.appendChild(el("div", "dxc-note", "One row per line, cells separated by a vertical bar. The first row is the header."));
  }

  /* ------------------------------------------------------------- the chrome
     The rail is rebuilt by the engine whenever a tool is pinned, so these three
     buttons are re-added rather than added once. The check is one attribute
     read, which is cheap enough to do on a frame. */
  function ensureChrome() {
    var rail = d.getElementById("dxcRail");
    if (!rail || rail.getAttribute("data-dxt") === "1") return;
    rail.setAttribute("data-dxt", "1");
    rail.appendChild(el("i", "dxc-sep"));
    rail.appendChild(btn("dxc-t", "◈", "Drawing templates", { "data-dxc": "dxt-tpl" }));
    rail.appendChild(btn("dxc-t", "⚑", "Alerts on drawings", { "data-dxc": "dxt-alerts" }));
    rail.appendChild(btn("dxc-t", "❏", "Groups", { "data-dxc": "dxt-groups" }));
    styles();
  }

  var wired = false;
  function wireClicks() {
    if (wired) return;
    wired = true;
    d.addEventListener("click", function (e) {
      try { onClick(e); } catch (err) { K.fault("dxt:click", err); }
    });
  }
  function onClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var n, o, i, ids, name;

    n = t.closest("[data-dxt-tpl-apply]");
    if (n) {
      ids = checkedIds(pick("dxtPick"));
      var tpl = templates()[n.getAttribute("data-dxt-tpl-apply")];
      if (tpl && ids.length) {
        K.pushUndo();
        for (i = 0; i < ids.length; i++) { o = byId(ids[i]); if (o) { applyStyle(o.st, tpl); o.st.tpl = n.getAttribute("data-dxt-tpl-apply"); } }
        K.saveDraws(); K.mark();
      }
      dlgTpl(); return;
    }
    n = t.closest("[data-dxt-tpl-new]");
    if (n) {
      var t2 = templates()[n.getAttribute("data-dxt-tpl-new")];
      /* dl.dxc.style is the engine's own "what a new drawing looks like" key —
         writing it here is the same thing the style bar does when a colour is
         picked, so there is one default, not two competing ones. */
      if (t2) LS.set("dl.dxc.style", readStyle(t2));
      dlgTpl(); return;
    }
    n = t.closest("[data-dxt-tpl-def]");
    if (n) { dlgTplDefault(n.getAttribute("data-dxt-tpl-def")); return; }
    n = t.closest("[data-dxt-tpl-undef]");
    if (n) { var td = toolDefaults(); delete td[n.getAttribute("data-dxt-tpl-undef")]; LS.set(K_TDEF, td); dlgTpl(); return; }
    n = t.closest("[data-dxt-tpl-del]");
    if (n) { var tp = templates(); delete tp[n.getAttribute("data-dxt-tpl-del")]; LS.set(K_TPL, tp); dlgTpl(); return; }

    n = t.closest("[data-dxt-tbl-edit]");
    if (n) { dlgTable(n.getAttribute("data-dxt-tbl-edit")); return; }
    n = t.closest("[data-dxt-emoji]");
    if (n) { dlgEmoji(n.getAttribute("data-dxt-emoji")); return; }
    n = t.closest("[data-dxt-emoji-set]");
    if (n) {
      o = byId(n.getAttribute("data-id"));
      if (o) { K.pushUndo(); o.st.txt = n.getAttribute("data-dxt-emoji-set"); K.saveDraws(); K.mark(); }
      closeModal(); return;
    }

    n = t.closest("[data-dxt-al-edit]");
    if (n) { dlgAlertEdit(n.getAttribute("data-dxt-al-edit")); return; }
    n = t.closest("[data-dxt-al-arm]");
    if (n) {
      o = byId(n.getAttribute("data-dxt-al-arm"));
      if (o && o.alert) { if (o.alert.hit) { o.alert.hit = null; o.alert.off = false; } else o.alert.off = !o.alert.off; K.saveDraws(); K.mark(); }
      dlgAlerts(); return;
    }
    n = t.closest("[data-dxt-al-del]");
    if (n) { o = byId(n.getAttribute("data-dxt-al-del")); if (o) { delete o.alert; K.saveDraws(); K.mark(); } dlgAlerts(); return; }

    n = t.closest("[data-dxt-g-vis]");
    if (n) {
      name = n.getAttribute("data-dxt-g-vis");
      var mem = objsIn(name), allHidden = mem.length > 0, j;
      for (j = 0; j < mem.length; j++) if (mem[j].st.vis !== false) allHidden = false;
      K.pushUndo();
      for (j = 0; j < mem.length; j++) mem[j].st.vis = allHidden ? true : false;
      K.saveDraws(); K.mark(); dlgGroups(); return;
    }
    n = t.closest("[data-dxt-g-lock]");
    if (n) {
      name = n.getAttribute("data-dxt-g-lock");
      var m2 = objsIn(name), allLocked = m2.length > 0, j2;
      for (j2 = 0; j2 < m2.length; j2++) if (!m2[j2].st.lock) allLocked = false;
      K.pushUndo();
      for (j2 = 0; j2 < m2.length; j2++) m2[j2].st.lock = !allLocked;
      K.saveDraws(); K.mark(); dlgGroups(); return;
    }
    n = t.closest("[data-dxt-g-out]");
    if (n) {
      var m3 = objsIn(n.getAttribute("data-dxt-g-out")), j3;
      K.pushUndo();
      for (j3 = 0; j3 < m3.length; j3++) delete m3[j3].grp;
      K.saveDraws(); K.mark(); dlgGroups(); return;
    }
    n = t.closest("[data-dxt-g-del]");
    if (n) {
      var m4 = objsIn(n.getAttribute("data-dxt-g-del")), all = K.drawings(), j4, ix;
      K.pushUndo();
      for (j4 = 0; j4 < m4.length; j4++) { ix = all.indexOf(m4[j4]); if (ix >= 0) all.splice(ix, 1); }
      K.saveDraws(); K.mark(); dlgGroups(); return;
    }

    var act = t.closest("[data-dxc]");
    if (!act) return;
    var a2 = act.getAttribute("data-dxc");
    if (a2 === "dxt-tpl") { ensureChrome(); dlgTpl(); return; }
    if (a2 === "dxt-alerts") { dlgAlerts(); return; }
    if (a2 === "dxt-groups") { dlgGroups(); return; }
    if (a2 === "dxt-tpl-save") {
      var nmEl = pick("dxtTplName"), nm = nmEl && nmEl.value ? nmEl.value.replace(/^\s+|\s+$/g, "") : "";
      if (!nm) return;
      var tp2 = templates();
      tp2[nm] = {
        c: (pick("dxtTplC") || {}).value || "#00E5FF",
        w: +(pick("dxtTplW") || {}).value || 1.6,
        dash: +(pick("dxtTplD") || {}).value || 0,
        fill: +(pick("dxtTplF") || {}).value || 0,
        fs: +(pick("dxtTplS") || {}).value || 12
      };
      LS.set(K_TPL, tp2); dlgTpl(); return;
    }
    if (a2 === "dxt-tpl-def-save") {
      var td2 = toolDefaults(), tsel = pick("dxtDefTool");
      if (tsel && tsel.value) { td2[tsel.value] = act.getAttribute("data-name"); LS.set(K_TDEF, td2); }
      dlgTpl(); return;
    }
    if (a2 === "dxt-al-save") {
      o = byId(act.getAttribute("data-id"));
      if (o) {
        K.pushUndo();
        o.alert = {
          kind: (pick("dxtAlKind") || {}).value || "cross",
          dir: +(pick("dxtAlDir") || {}).value || 0,
          px: +(pick("dxtAlPx") || {}).value || 0,
          once: !!(pick("dxtAlOnce") || {}).checked,
          off: false, hit: null
        };
        K.saveDraws(); K.mark();
      }
      dlgAlerts(); return;
    }
    if (a2 === "dxt-g-add") {
      var gn = pick("dxtGrpName"), gname = gn && gn.value ? gn.value.replace(/^\s+|\s+$/g, "") : "";
      ids = checkedIds(pick("dxtPick"));
      if (gname && ids.length) {
        K.pushUndo();
        for (i = 0; i < ids.length; i++) { o = byId(ids[i]); if (o) o.grp = gname; }
        K.saveDraws(); K.mark();
      }
      dlgGroups(); return;
    }
    if (a2 === "dxt-tbl-save") {
      o = byId(act.getAttribute("data-id"));
      var ta = pick("dxtTblTxt");
      if (o && ta) {
        K.pushUndo();
        var ls = String(ta.value).split("\n"), out = [];
        for (i = 0; i < ls.length && i < 24; i++) {
          if (!ls[i].replace(/\s/g, "")) continue;
          out.push(ls[i].split("|").map(function (c) { return c.replace(/^\s+|\s+$/g, "").slice(0, 40); }).slice(0, 6));
        }
        o.st.tbl = out;
        K.saveDraws(); K.mark();
      }
      closeModal(); return;
    }
  }
  function dlgTplDefault(name) {
    var body = modal("Default for a tool");
    var ids = DXC.tools(), opts = [], i;
    for (i = 0; i < ids.length; i++) {
      var def = DXC.toolDefs()[ids[i]];
      if (!def || !def.render) continue;
      opts.push({ v: ids[i], l: def.g + " · " + def.l });
    }
    opts.sort(function (a, b) { return a.l < b.l ? -1 : a.l > b.l ? 1 : 0; });
    var sel = select(opts, opts.length ? opts[0].v : "");
    sel.setAttribute("id", "dxtDefTool");
    fieldRow(body, "Tool", sel);
    var row = el("div", "dxc-row");
    row.appendChild(btn("dxc-go", "Use “" + name + "” for that tool", "Set the default", { "data-dxc": "dxt-tpl-def-save", "data-name": name }));
    row.appendChild(btn("dxc-b", "Cancel", "Close", { "data-dxc": "close" }));
    body.appendChild(row);
    body.appendChild(el("div", "dxc-note", "The next drawing made with that tool is born with this look. Existing drawings are not touched."));
  }

  /* =====================================================================
     MOUNT
     ===================================================================== */

  /* Every registered tool AND the 71 the engine shipped go through the wrapper,
     so an alert on a built-in trend line is checked on the same frame as one on
     a tool from this layer. */
  (function wrapAll() {
    var T = DXC.toolDefs(), k;
    for (k in T) if (Object.prototype.hasOwnProperty.call(T, k)) wrapOne(T[k], k);
  })();
  DXC.reindex();

  styles();
  ensureChrome();
  wireClicks();
  /* The rail is thrown away and rebuilt when a tool is pinned to it, which takes
     this layer's three buttons with it. Watch for that rather than polling. */
  try {
    if (typeof W.MutationObserver === "function") {
      var mo = new W.MutationObserver(function () { try { ensureChrome(); } catch (e) { K.fault("dxt:observe", e); } });
      if (d.body) mo.observe(d.body, { childList: true, subtree: true });
    }
  } catch (e) { K.fault("dxt:observe", e); }

  return {
    __v: 165,
    ok: true,
    tools: function () { return REG.slice(); },
    registered: function () { return COUNT; },
    groups: function () { return groupNames(); },
    templates: templates,
    alerts: function () { return LOG.slice(); },
    openTemplates: dlgTpl, openAlerts: dlgAlerts, openGroups: dlgGroups, openTable: dlgTable,
    /* the per-frame work, exposed so a harness can drive it without a pointer */
    refresh: function () { lastGeo = null; sweep(); }
  };
})();
