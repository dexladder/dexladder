/* ============================================================================
   DXSCRIPTUI · layer 54 — the human half of DexScript
   ----------------------------------------------------------------------------
   Layer 53 is a language with no front door. It compiles, it runs, it registers
   with the chart, and none of that is reachable by anyone who is not holding a
   console. This layer is the door: an editor with real highlighting, a library
   of scripts worth reading, a place to keep your own, a way to carry them
   between machines, and a converter that takes the Pine most traders arrive
   with as far as it honestly goes.

   WHAT THIS FILE HOLDS
     1  helpers, keys and the one stylesheet
     2  the shipped library — 41 scripts, registered on demand
     3  user scripts, and which scripts are on the chart PER MARKET
     4  export and import of .dexs files
     5  DXSPINE — the Pine v5 subset converter
     6  the highlighter — tokens to spans, no markup anywhere
     7  the editor dialog
     8  the library browser
     9  the chrome and the one delegated click listener
    10  boot and the public surface

   WHY THE LIBRARY IS NOT REGISTERED AT LOAD
     DXS.register() puts a study in the engine's registry, and the indicator
     dialog lists every key in that registry. Registering 41 scripts at load
     would bury the engine's own 133 studies under a wall of entries nobody
     asked for. A library script is compiled and registered at the moment
     somebody adds it, and the per-market state below is what brings it back
     on the next visit.

   WHY THE EDITOR IS A TEXTAREA UNDER A PRE
     Highlighting needs coloured runs; a textarea has one colour. The two are
     stacked instead: the <pre> behind holds one <span> per token, built with
     createElement and textContent, and the textarea in front carries the
     caret, the selection and the keyboard with its own text transparent. The
     two layers agree because they are given identical font, padding and
     white-space, and the scroll positions are tied together. No markup is
     assigned anywhere in this file, and there is no contenteditable: an editor
     built on contenteditable has to parse markup back out of the DOM, and that
     is a door this codebase keeps shut.

   WHAT THE PINE CONVERTER IS AND IS NOT
     It is a subset TRANSLATOR, not a Pine runtime. It rewrites the shapes a
     study is usually written in and it refuses the rest in the open: every
     line it cannot carry is commented out in the output and named in a note,
     so the converted script still compiles and nothing is silently dropped.
     Section 5 lists what it takes, what it approximates and what it refuses,
     and the same list is printed in the converter's own dialog.

   HOUSE RULES OBSERVED
     · one IIFE, ES5 only (var/function), idempotent, no dependencies but 46/53
     · no eval, no Function constructor, no string timer, no markup assignment
     · no inline style attribute; only node.style.setProperty("--dxc-…", v)
     · one <style> element, built with createElement and textContent
     · one delegated click listener on document, keyed on data-dxs
     · errors are values: everything that can throw goes through DXC.kit.fault
   ============================================================================ */
window.DXSCRIPTUI = (function () {
  "use strict";
  /* A stale shell can append a layer twice. The chrome, the listener and the
     stylesheet are not idempotent on their own, so the whole thing is. */
  if (window.DXSCRIPTUI && window.DXSCRIPTUI.__v) return window.DXSCRIPTUI;

  var W = window, d = document;
  var DXC = W.DXC, DXS = W.DXS;
  if (!DXC || !DXC.kit || typeof DXC.registerStudy !== "function") {
    return { __v: 165, ok: false, why: "DexChart engine missing or not open for extension" };
  }
  if (!DXS || typeof DXS.compile !== "function") {
    return { __v: 165, ok: false, why: "DexScript engine (layer 53) is not on this page" };
  }

  /* =====================================================================
     1 · HELPERS, KEYS AND THE ONE STYLESHEET
     ===================================================================== */

  var K = DXC.kit, LS = K.LS;
  var el = K.el, btn = K.btn, clear = K.clear, modal = K.modal, closeModal = K.closeModal;
  var fieldRow = K.fieldRow, inputNum = K.inputNum, select = K.select, checkbox = K.checkbox;

  var K_USER = "dl.dxs.user";   /* id -> {id,title,source,created,modified}    */
  var K_ON = "dl.dxs.on";       /* symKey -> ["lib:id", "user:id", …]          */
  var K_PARAM = "dl.dxs.params";/* regId -> {inputKey: value} set in the editor */
  var FILE_VER = 1;

  function fault(where, e) { try { K.fault("dxsui:" + where, e); } catch (x) { } }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function symKey() { try { return String(K.symKey()); } catch (e) { return "?"; } }
  function now() { return Date.now(); }
  function isNum(v) { return typeof v === "number" && isFinite(v); }

  /* A register id is the engine's study key minus the "dxs:" prefix, and layer
     53 will only take letters, digits, dashes and underscores. */
  function safeId(s) {
    var out = String(s == null ? "" : s).replace(/[^A-Za-z0-9_-]+/g, "_");
    return out.slice(0, 40) || "script";
  }
  function regIdOf(ref) { return (ref.src === "lib" ? "lib_" : "usr_") + safeId(ref.id); }
  function refKey(ref) { return ref.src + ":" + ref.id; }
  function parseRef(s) {
    var at = String(s).indexOf(":");
    if (at < 0) return null;
    var src = s.slice(0, at);
    if (src !== "lib" && src !== "user") return null;
    return { src: src, id: s.slice(at + 1) };
  }

  function stamp(ms) {
    try {
      var x = new Date(ms);
      return x.getUTCFullYear() + "-" + pad2(x.getUTCMonth() + 1) + "-" + pad2(x.getUTCDate()) +
        " " + pad2(x.getUTCHours()) + ":" + pad2(x.getUTCMinutes());
    } catch (e) { return ""; }
  }
  function pad2(n) { return n < 10 ? "0" + n : String(n); }
  function fmtN(v, p) {
    if (!isNum(v)) return "—";
    return v.toFixed(p == null ? 2 : p);
  }

  /* --------------------------------------------------------------- the CSS
     The only rules this layer adds. Everything else reuses the engine's dxc-
     furniture so the dialogs are the same room. Night is measured against the
     #141619 panel ground and the #0C101E editor plate; Day is stated rather
     than left to a runtime retint, because a syntax colour is not a token and
     nothing downstream would repair it. */
  function styles() {
    if (d.getElementById("dxsCss")) return;
    var s = d.createElement("style");
    s.setAttribute("id", "dxsCss");
    s.textContent = [
      /* the editor plate */
      ".dxs-ed{display:flex;border:1px solid #2A3A54;border-radius:9px;background:#0C101E;overflow:hidden}",
      ".dxs-gut{flex:none;width:40px;padding:9px 7px 9px 0;text-align:right;background:#0A0E19;color:#9AA6D0;",
      "font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow:hidden}",
      ".dxs-gut i{display:block;font-style:normal}",
      ".dxs-gut i.bad{color:#FF9DB0;font-weight:700}",
      ".dxs-gut i.warn{color:#FFD166}",
      ".dxs-wrap{position:relative;flex:1;min-width:0;height:min(46vh,320px)}",
      ".dxs-hi,.dxs-ta{position:absolute;top:0;right:0;bottom:0;left:0;margin:0;padding:9px 11px;border:0;",
      "white-space:pre;overflow:auto;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;tab-size:4}",
      ".dxs-hi{color:#E7EDF8;background:#0C101E;pointer-events:none}",
      /* the caret layer. Its own glyphs are fully transparent on purpose: the
         colour the reader sees is the one the <pre> underneath paints. */
      ".dxs-ta{color:transparent;background:none;caret-color:#00E5FF;resize:none}",
      ".dxs-ta:focus{outline:2px solid #00E5FF;outline-offset:-2px}",
      /* the token colours */
      ".dxs-kw{color:#7FD8FF}",
      ".dxs-num{color:#FFD166}",
      ".dxs-str{color:#7BE38A}",
      ".dxs-com{color:#9AA6D0;font-style:italic}",
      ".dxs-fn{color:#C4B0FF}",
      ".dxs-id{color:#E7EDF8}",
      ".dxs-op{color:#FFB3C1}",
      ".dxs-punc{color:#AEB9CF}",
      ".dxs-gap{color:#E7EDF8}",
      /* status, panels and lists */
      ".dxs-stat{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;margin:8px 0 2px;",
      "font:600 11.5px/1.5 Inter,system-ui,sans-serif;color:#AEB9CF}",
      ".dxs-stat .ok{color:#7BE38A}",
      ".dxs-stat .bad{color:#FF9DB0}",
      ".dxs-stat .lim{color:#FFD166}",
      ".dxs-panel{margin-top:12px;border:1px solid #1E2740;border-radius:9px;background:rgba(10,14,25,.6);overflow:hidden}",
      ".dxs-ph{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:8px 11px;",
      "border:0;background:none;color:#E7EDF8;font:700 11.5px Inter,system-ui,sans-serif;cursor:pointer;text-align:left}",
      ".dxs-ph:hover{background:rgba(140,155,220,.14)}",
      ".dxs-ph .cnt{color:#9AA6D0;font-weight:600}",
      ".dxs-pb{padding:4px 11px 11px;max-height:min(40vh,300px);overflow:auto}",
      ".dxs-doc{display:block;width:100%;padding:6px 8px;margin:2px 0;border:1px solid transparent;border-radius:7px;",
      "background:none;color:#AEB9CF;font:500 11.5px/1.45 Inter,system-ui,sans-serif;text-align:left;cursor:pointer}",
      ".dxs-doc:hover{background:rgba(140,155,220,.15);border-color:#2A3A54}",
      ".dxs-doc b{display:block;color:#7FD8FF;font:600 11.5px ui-monospace,SFMono-Regular,Menlo,monospace}",
      ".dxs-src{margin:0;padding:9px 11px;border-radius:8px;background:#0C101E;color:#AEB9CF;",
      "font:11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre;overflow:auto;max-height:200px}",
      ".dxs-card{padding:9px 10px;margin:4px 0;border:1px solid #1E2740;border-radius:9px;background:rgba(12,16,30,.55)}",
      ".dxs-card h4{margin:0 0 3px;font:700 12.5px Inter,system-ui,sans-serif;color:#E7EDF8}",
      ".dxs-card p{margin:0 0 6px;font:500 11.5px/1.5 Inter,system-ui,sans-serif;color:#AEB9CF}",
      ".dxs-meta{font:600 10.5px Inter,system-ui,sans-serif;color:#9AA6D0;letter-spacing:.04em}",
      ".dxs-tab{width:100%;border-collapse:collapse}",
      ".dxs-tab th{text-align:left;padding:5px 8px 5px 0;color:#9AA6D0;font:700 10px Inter,system-ui,sans-serif;",
      "letter-spacing:.1em;text-transform:uppercase}",
      ".dxs-tab td{padding:4px 8px 4px 0;color:#AEB9CF;font:500 11.5px Inter,system-ui,sans-serif;",
      "border-bottom:1px solid #161E33;font-variant-numeric:tabular-nums}",
      ".dxs-tab td.up{color:#7BE38A}",
      ".dxs-tab td.dn{color:#FF9DB0}",
      ".dxs-eq{display:block;width:100%;height:110px;border-radius:8px;background:#0C101E}",
      ".dxs-note{display:flex;gap:8px;padding:5px 0;border-bottom:1px solid #161E33;",
      "font:500 11.5px/1.45 Inter,system-ui,sans-serif;color:#AEB9CF}",
      ".dxs-note .ln{flex:none;width:52px;color:#9AA6D0;font-variant-numeric:tabular-nums}",
      ".dxs-note .tr{color:#7BE38A}",
      ".dxs-note .ap{color:#FFD166}",
      ".dxs-note .un{color:#FF9DB0}",
      ".dxs-chips{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0 2px}",
      ".dxs-chip{padding:3px 9px;border-radius:999px;border:1px solid #2A3A54;background:rgba(20,28,44,.8);",
      "color:#AEB9CF;font:600 11px Inter,system-ui,sans-serif;cursor:pointer}",
      ".dxs-chip:hover{border-color:#00E5FF;color:#E7EDF8}",
      ".dxs-chip.on{background:#00E5FF;border-color:transparent;color:#04121C}",
      ".dxs-hide{display:none}",
      /* the phone. The gutter narrows and the plate keeps its own scroll. */
      "@media (max-width:460px){.dxs-gut{width:30px}.dxs-wrap{height:min(42vh,240px)}",
      ".dxs-hi,.dxs-ta,.dxs-src{font-size:11.5px}}",
      /* ---- Day ---- */
      "html[data-mode=day] .dxs-ed{border-color:#C9D2E4;background:#F2F5FA}",
      "html[data-mode=day] .dxs-gut{background:#E7ECF5;color:#4A5468}",
      "html[data-mode=day] .dxs-gut i.bad{color:#8A1F3A}",
      "html[data-mode=day] .dxs-gut i.warn{color:#6B4600}",
      "html[data-mode=day] .dxs-hi{color:#12161F;background:#F2F5FA}",
      "html[data-mode=day] .dxs-ta{caret-color:#0B5E7C}",
      "html[data-mode=day] .dxs-kw{color:#0B5E7C}",
      "html[data-mode=day] .dxs-num{color:#6B4600}",
      "html[data-mode=day] .dxs-str{color:#14663D}",
      "html[data-mode=day] .dxs-com{color:#4A5468}",
      "html[data-mode=day] .dxs-fn{color:#4B2E9E}",
      "html[data-mode=day] .dxs-id,html[data-mode=day] .dxs-gap{color:#12161F}",
      "html[data-mode=day] .dxs-op{color:#8A1F3A}",
      "html[data-mode=day] .dxs-punc{color:#3E4759}",
      "html[data-mode=day] .dxs-stat{color:#3E4759}",
      "html[data-mode=day] .dxs-stat .ok{color:#14663D}",
      "html[data-mode=day] .dxs-stat .bad{color:#8A1F3A}",
      "html[data-mode=day] .dxs-stat .lim{color:#6B4600}",
      "html[data-mode=day] .dxs-panel{border-color:#D5DCEA;background:#F7F9FD}",
      "html[data-mode=day] .dxs-ph{color:#12161F}",
      "html[data-mode=day] .dxs-ph .cnt{color:#4A5468}",
      "html[data-mode=day] .dxs-doc{color:#3E4759}",
      "html[data-mode=day] .dxs-doc b{color:#0B5E7C}",
      "html[data-mode=day] .dxs-src{background:#F2F5FA;color:#3E4759}",
      "html[data-mode=day] .dxs-card{border-color:#D5DCEA;background:#F7F9FD}",
      "html[data-mode=day] .dxs-card h4{color:#12161F}",
      "html[data-mode=day] .dxs-card p{color:#3E4759}",
      "html[data-mode=day] .dxs-meta{color:#4A5468}",
      "html[data-mode=day] .dxs-tab th{color:#4A5468}",
      "html[data-mode=day] .dxs-tab td{color:#3E4759;border-bottom-color:#E1E7F2}",
      "html[data-mode=day] .dxs-tab td.up{color:#14663D}",
      "html[data-mode=day] .dxs-tab td.dn{color:#8A1F3A}",
      "html[data-mode=day] .dxs-eq{background:#F2F5FA}",
      "html[data-mode=day] .dxs-note{color:#3E4759;border-bottom-color:#E1E7F2}",
      "html[data-mode=day] .dxs-note .ln{color:#4A5468}",
      "html[data-mode=day] .dxs-note .tr{color:#14663D}",
      "html[data-mode=day] .dxs-note .ap{color:#6B4600}",
      "html[data-mode=day] .dxs-note .un{color:#8A1F3A}",
      "html[data-mode=day] .dxs-chip{border-color:#C9D2E4;background:#EDF1F8;color:#3E4759}",
      "html[data-mode=day] .dxs-chip.on{background:#0B5E7C;color:#F2F5FA;border-color:transparent}"
    ].join("\n");
    (d.head || d.body).appendChild(s);
  }

  /* =====================================================================
     2 · THE SHIPPED LIBRARY
     Forty-one scripts, written in DexScript and kept as source rather than as
     JavaScript, because the point of a library entry is that it can be opened,
     read and edited. Every one of them compiles and runs — test/dx-scriptui-
     harness.js walks the whole list and fails by name if one does not.
     ===================================================================== */

  var LIB = [];
  function L(id, group, title, about, lines) {
    LIB.push({ id: id, group: group, title: title, about: about, source: lines.join("\n") + "\n" });
  }

  /* ------------------------------------------------------------------- trend */

  L("ribbon", "Trend", "EMA ribbon", "Five exponential averages, tinted green while they fan up and red while they fan down.", [
    'study("EMA ribbon", "Ribbon", overlay=true, precision=2)',
    '',
    'base = input.int(8, "Shortest EMA", minval=2, maxval=100)',
    'gap  = input.int(6, "Step between bands", minval=1, maxval=40)',
    '',
    'e1 = ta.ema(close, base)',
    'e2 = ta.ema(close, base + gap)',
    'e3 = ta.ema(close, base + gap * 2)',
    'e4 = ta.ema(close, base + gap * 3)',
    'e5 = ta.ema(close, base + gap * 4)',
    '',
    'up = e1 > e2 and e2 > e3 and e3 > e4 and e4 > e5',
    'dn = e1 < e2 and e2 < e3 and e3 < e4 and e4 < e5',
    'tint = up ? color.green : dn ? color.red : color.gray',
    '',
    'plot(e1, "Fastest", color=tint, linewidth=2)',
    'plot(e2, "Band 2", color=tint)',
    'plot(e3, "Band 3", color=tint)',
    'plot(e4, "Band 4", color=tint)',
    'plot(e5, "Slowest", color=tint, linewidth=2)',
    'fill(0, 4, color=tint, transp=0.9)'
  ]);

  L("supertrend", "Trend", "SuperTrend with signals", "The SuperTrend line plus a marker on each flip of its direction.", [
    'study("SuperTrend signals", "ST", overlay=true, precision=2)',
    '',
    'f   = input.float(3, "ATR factor", minval=0.5, maxval=10, step=0.1)',
    'len = input.int(10, "ATR length", minval=1, maxval=100)',
    '',
    '[st, dir] = ta.supertrend(f, len)',
    '',
    'flipUp = dir < 0 and dir[1] > 0',
    'flipDn = dir > 0 and dir[1] < 0',
    '',
    'plot(st, "SuperTrend", color=dir < 0 ? color.green : color.red, linewidth=2)',
    'plotshape(flipUp, "Turn up", draw="triangleup", location="belowbar", color=color.green, text="up")',
    'plotshape(flipDn, "Turn down", draw="triangledown", location="abovebar", color=color.red, text="dn")',
    'alertcondition(flipUp, "SuperTrend turned up", "SuperTrend flipped to the upside")',
    'alertcondition(flipDn, "SuperTrend turned down", "SuperTrend flipped to the downside")'
  ]);

  L("halftrend", "Trend", "HalfTrend", "A trend line that only moves once the opposite extreme has been taken out, so it does not whip on noise.", [
    'study("HalfTrend", "HT", overlay=true, precision=2)',
    '',
    'amp = input.int(2, "Amplitude", minval=1, maxval=20)',
    '',
    'hiMa = ta.sma(high, amp)',
    'loMa = ta.sma(low, amp)',
    'hh   = ta.highest(high, amp)',
    'll   = ta.lowest(low, amp)',
    '',
    'var int trend     = 0',
    'var int nextTrend = 0',
    'var float maxLow  = na',
    'var float minHigh = na',
    '',
    'if nextTrend == 1',
    '    maxLow := math.max(ll, maxLow)',
    '    if hiMa < maxLow and close < low[1]',
    '        trend := 1',
    '        nextTrend := 0',
    '        minHigh := hh',
    'else',
    '    minHigh := math.min(hh, minHigh)',
    '    if loMa > minHigh and close > high[1]',
    '        trend := 0',
    '        nextTrend := 1',
    '        maxLow := ll',
    '',
    'line = trend == 0 ? maxLow : minHigh',
    '',
    'plot(line, "HalfTrend", color=trend == 0 ? color.green : color.red, linewidth=2)',
    'plotshape(trend == 0 and trend[1] == 1, "Turn up", draw="triangleup", location="belowbar", color=color.green)',
    'plotshape(trend == 1 and trend[1] == 0, "Turn down", draw="triangledown", location="abovebar", color=color.red)'
  ]);

  L("trendmeter", "Trend", "Trend strength meter", "ADX, the stretch away from a long average and that average's slope, averaged into one 0-100 reading.", [
    'study("Trend strength meter", "Strength", overlay=false, precision=1, range_lo=0, range_hi=100)',
    '',
    'len = input.int(50, "Reference average", minval=5, maxval=400)',
    'adxLen = input.int(14, "ADX length", minval=2, maxval=100)',
    '',
    'ma  = ta.ema(close, len)',
    'atr = ta.atr(adxLen)',
    'adx = ta.adx(adxLen, adxLen)',
    '',
    'stretch = atr > 0 ? math.min(100, math.abs(close - ma) / atr * 20) : na',
    'slope   = atr > 0 ? math.min(100, math.abs(ma - ma[5]) / atr * 25) : na',
    'strength = math.avg(math.min(100, adx * 2), stretch, slope)',
    '',
    'plot(strength, "Strength", color=strength > 60 ? color.green : strength < 25 ? color.gray : color.orange, draw="area", linewidth=2)',
    'hline(60, "Trending", color=color.green, dash="dashed")',
    'hline(25, "Ranging", color=color.gray, dash="dotted")'
  ]);

  L("maslope", "Trend", "Moving-average slope", "The change in a moving average over a few bars, stated in ATR so it reads the same on any market.", [
    'study("MA slope", "Slope", overlay=false, precision=2)',
    '',
    'len   = input.int(34, "Average length", minval=2, maxval=400)',
    'back  = input.int(3, "Bars to measure over", minval=1, maxval=50)',
    'kind  = input.string("EMA", "Average", options=["EMA", "SMA", "WMA", "HMA"])',
    '',
    'ma = kind == "EMA" ? ta.ema(close, len) : kind == "SMA" ? ta.sma(close, len) : kind == "WMA" ? ta.wma(close, len) : ta.hma(close, len)',
    'atr = ta.atr(14)',
    '',
    'slope = atr > 0 ? (ma - ma[back]) / atr : na',
    '',
    'plot(slope, "Slope in ATR", color=slope > 0 ? color.green : color.red, draw="histogram")',
    'hline(0, "Flat", color=color.gray, dash="solid")'
  ]);

  L("donchian", "Trend", "Donchian trend", "The Donchian channel with its middle line coloured by whichever edge price touched last.", [
    'study("Donchian trend", "DC", overlay=true, precision=2)',
    '',
    'len = input.int(20, "Channel length", minval=2, maxval=400)',
    '',
    'up = ta.highest(high, len)',
    'dn = ta.lowest(low, len)',
    'mid = (up + dn) / 2',
    '',
    'var int side = 0',
    'if high >= up[1]',
    '    side := 1',
    'else if low <= dn[1]',
    '    side := -1',
    '',
    'tint = side > 0 ? color.green : side < 0 ? color.red : color.gray',
    '',
    'plot(up, "Upper", color=color.gray)',
    'plot(dn, "Lower", color=color.gray)',
    'plot(mid, "Middle", color=tint, linewidth=2)',
    'fill(0, 1, color=tint, transp=0.92)'
  ]);

  /* ---------------------------------------------------------------- momentum */

  L("wavetrend", "Momentum", "WaveTrend with crosses", "The WaveTrend oscillator and a marker wherever its two lines cross at an extreme.", [
    'study("WaveTrend", "WT", overlay=false, precision=2, range_lo=-100, range_hi=100)',
    '',
    'chan = input.int(10, "Channel length", minval=2, maxval=100)',
    'avgl = input.int(21, "Average length", minval=2, maxval=100)',
    '',
    'src = hlc3',
    'esa = ta.ema(src, chan)',
    'dev = ta.ema(math.abs(src - esa), chan)',
    'ci  = dev > 0 ? (src - esa) / (0.015 * dev) : na',
    'wt1 = ta.ema(ci, avgl)',
    'wt2 = ta.sma(wt1, 4)',
    '',
    'up = ta.crossover(wt1, wt2) and wt1 < -45',
    'dn = ta.crossunder(wt1, wt2) and wt1 > 45',
    '',
    'plot(wt1, "WT1", color=color.aqua, linewidth=2)',
    'plot(wt2, "WT2", color=color.orange)',
    'fill(0, 1, color=color.aqua, transp=0.88)',
    'hline(60, "Overbought", color=color.red, dash="dashed")',
    'hline(-60, "Oversold", color=color.green, dash="dashed")',
    'plotshape(up, "Buy cross", draw="circle", location="bottom", color=color.green)',
    'plotshape(dn, "Sell cross", draw="circle", location="top", color=color.red)'
  ]);

  L("rsidiv", "Momentum", "RSI with divergence marks", "RSI, with a mark wherever a confirmed price pivot and the matching RSI pivot disagree.", [
    'study("RSI divergence", "RSI div", overlay=false, precision=2, range_lo=0, range_hi=100)',
    '',
    'len  = input.int(14, "RSI length", minval=2, maxval=200)',
    'left = input.int(5, "Pivot left bars", minval=1, maxval=20)',
    'right = input.int(3, "Pivot right bars", minval=1, maxval=20)',
    '',
    'r = ta.rsi(close, len)',
    '',
    'ph = ta.pivothigh(r, left, right)',
    'pl = ta.pivotlow(r, left, right)',
    'pph = ta.pivothigh(high, left, right)',
    'ppl = ta.pivotlow(low, left, right)',
    '',
    'lastRh = ta.valuewhen(not na(ph), ph, 1)',
    'thisRh = ta.valuewhen(not na(ph), ph, 0)',
    'lastPh = ta.valuewhen(not na(pph), pph, 1)',
    'thisPh = ta.valuewhen(not na(pph), pph, 0)',
    '',
    'lastRl = ta.valuewhen(not na(pl), pl, 1)',
    'thisRl = ta.valuewhen(not na(pl), pl, 0)',
    'lastPl = ta.valuewhen(not na(ppl), ppl, 1)',
    'thisPl = ta.valuewhen(not na(ppl), ppl, 0)',
    '',
    'bear = not na(ph) and thisPh > lastPh and thisRh < lastRh',
    'bull = not na(pl) and thisPl < lastPl and thisRl > lastRl',
    '',
    'plot(r, "RSI", color=color.aqua, linewidth=2)',
    'hline(70, "Overbought", color=color.red, dash="dashed")',
    'hline(30, "Oversold", color=color.green, dash="dashed")',
    'hline(50, "Middle", color=color.gray, dash="dotted")',
    'plotshape(bear, "Bearish divergence", draw="triangledown", location="top", color=color.red, text="bear")',
    'plotshape(bull, "Bullish divergence", draw="triangleup", location="bottom", color=color.green, text="bull")',
    'alertcondition(bull, "Bullish RSI divergence", "Price made a lower low while RSI made a higher low")',
    'alertcondition(bear, "Bearish RSI divergence", "Price made a higher high while RSI made a lower high")'
  ]);

  L("stochrsi", "Momentum", "Stochastic RSI with bands", "Stochastic RSI with its %D signal, a shaded band between them and the 20/80 lines.", [
    'study("Stochastic RSI", "StochRSI", overlay=false, precision=2, range_lo=0, range_hi=100)',
    '',
    'rsiLen = input.int(14, "RSI length", minval=2, maxval=200)',
    'stoLen = input.int(14, "Stochastic length", minval=2, maxval=200)',
    'kSm    = input.int(3, "%K smoothing", minval=1, maxval=20)',
    'dSm    = input.int(3, "%D smoothing", minval=1, maxval=20)',
    '',
    'raw = ta.stochrsi(close, rsiLen, stoLen)',
    'k = ta.sma(raw, kSm)',
    'dLine = ta.sma(k, dSm)',
    '',
    'plot(k, "%K", color=color.aqua, linewidth=2)',
    'plot(dLine, "%D", color=color.orange)',
    'fill(0, 1, color=color.aqua, transp=0.88)',
    'hline(80, "Overbought", color=color.red, dash="dashed")',
    'hline(20, "Oversold", color=color.green, dash="dashed")',
    'bgcolor(k > 80 ? color.new("#FF5A78", 0.9) : k < 20 ? color.new("#22D39A", 0.9) : na)'
  ]);

  L("squeeze", "Momentum", "Squeeze momentum", "Bollinger inside Keltner marks the coil; the histogram says which way it is loading.", [
    'study("Squeeze momentum", "SQZ", overlay=false, precision=2)',
    '',
    'len  = input.int(20, "Length", minval=4, maxval=200)',
    'bbM  = input.float(2, "Bollinger deviations", minval=0.5, maxval=5, step=0.1)',
    'kcM  = input.float(1.5, "Keltner multiplier", minval=0.5, maxval=5, step=0.1)',
    '',
    '[bbMid, bbUp, bbDn] = ta.bb(close, len, bbM)',
    '[kcMid, kcUp, kcDn] = ta.kc(close, len, kcM, true)',
    '',
    'on  = bbUp < kcUp and bbDn > kcDn',
    'off = bbUp > kcUp and bbDn < kcDn',
    '',
    'hh = ta.highest(high, len)',
    'll = ta.lowest(low, len)',
    'mid = (((hh + ll) / 2) + ta.sma(close, len)) / 2',
    'mom = ta.linreg(close - mid, len, 0)',
    '',
    'plot(mom, "Momentum", color=mom > 0 ? (mom > mom[1] ? color.green : color.lime) : (mom < mom[1] ? color.red : color.orange), draw="histogram")',
    'plotshape(on, "Squeeze on", draw="circle", location="absolute", color=color.red)',
    'plotshape(off, "Squeeze released", draw="circle", location="absolute", color=color.green)',
    'hline(0, "Zero", color=color.gray, dash="solid")',
    'alertcondition(off and on[1], "Squeeze fired", "The squeeze released on this bar")'
  ]);

  L("tsi", "Momentum", "True Strength Index with signal", "Double-smoothed momentum with an EMA signal line and the difference as a histogram.", [
    'study("True Strength Index", "TSI", overlay=false, precision=2)',
    '',
    'shortLen = input.int(13, "Short smoothing", minval=1, maxval=100)',
    'longLen  = input.int(25, "Long smoothing", minval=1, maxval=200)',
    'sigLen   = input.int(13, "Signal length", minval=1, maxval=100)',
    '',
    't = ta.tsi(close, shortLen, longLen)',
    'sig = ta.ema(t, sigLen)',
    'diff = t - sig',
    '',
    'plot(diff, "TSI minus signal", color=diff > 0 ? color.green : color.red, draw="histogram")',
    'plot(t, "TSI", color=color.aqua, linewidth=2)',
    'plot(sig, "Signal", color=color.orange)',
    'hline(0, "Zero", color=color.gray, dash="solid")',
    'alertcondition(ta.crossover(t, sig), "TSI crossed up", "TSI crossed above its signal line")'
  ]);

  L("aoac", "Momentum", "Awesome and Acceleration", "The Awesome Oscillator as a histogram with the Acceleration Oscillator drawn over it.", [
    'study("Awesome and Acceleration", "AO/AC", overlay=false, precision=2)',
    '',
    'fastLen = input.int(5, "Fast median length", minval=1, maxval=100)',
    'slowLen = input.int(34, "Slow median length", minval=2, maxval=300)',
    '',
    'ao = ta.sma(hl2, fastLen) - ta.sma(hl2, slowLen)',
    'ac = ao - ta.sma(ao, fastLen)',
    '',
    'plot(ao, "Awesome", color=ao > ao[1] ? color.green : color.red, draw="histogram")',
    'plot(ac, "Acceleration", color=ac > ac[1] ? color.aqua : color.orange, draw="line", linewidth=2)',
    'hline(0, "Zero", color=color.gray, dash="solid")',
    'plotshape(ta.crossover(ao, 0), "AO crossed zero up", draw="triangleup", location="bottom", color=color.green)',
    'plotshape(ta.crossunder(ao, 0), "AO crossed zero down", draw="triangledown", location="top", color=color.red)'
  ]);

  L("composite", "Momentum", "Composite momentum", "RSI, Stochastic, CCI and Williams %R rebased to 0-100 and averaged, so one line answers for four.", [
    'study("Composite momentum", "Composite", overlay=false, precision=1, range_lo=0, range_hi=100)',
    '',
    'len = input.int(14, "Length for every part", minval=2, maxval=200)',
    '',
    'r = ta.rsi(close, len)',
    'k = ta.stoch(close, high, low, len)',
    'c = ta.cci(hlc3, len)',
    'w = ta.wpr(len)',
    '',
    'cScaled = math.max(0, math.min(100, (c + 200) / 4))',
    'wScaled = w + 100',
    '',
    'comp = math.avg(r, k, cScaled, wScaled)',
    'sig  = ta.ema(comp, 5)',
    '',
    'plot(comp, "Composite", color=comp > 70 ? color.red : comp < 30 ? color.green : color.aqua, linewidth=2)',
    'plot(sig, "Signal", color=color.gray)',
    'hline(70, "Hot", color=color.red, dash="dashed")',
    'hline(30, "Cold", color=color.green, dash="dashed")'
  ]);

  L("crsi", "Momentum", "Connors RSI signal", "Connors RSI with the entry and exit marks the original rules use.", [
    'study("Connors RSI signal", "CRSI", overlay=false, precision=1, range_lo=0, range_hi=100)',
    '',
    'rsiLen = input.int(3, "Price RSI length", minval=1, maxval=50)',
    'strLen = input.int(2, "Streak RSI length", minval=1, maxval=50)',
    'rocLen = input.int(100, "Percent-rank lookback", minval=10, maxval=400)',
    'entry  = input.float(10, "Entry level", minval=1, maxval=49, step=1)',
    'exitAt = input.float(70, "Exit level", minval=51, maxval=99, step=1)',
    '',
    'var int streak = 0',
    'if close > close[1]',
    '    streak := streak > 0 ? streak + 1 : 1',
    'else if close < close[1]',
    '    streak := streak < 0 ? streak - 1 : -1',
    'else',
    '    streak := 0',
    '',
    'r1 = ta.rsi(close, rsiLen)',
    'r2 = ta.rsi(streak, strLen)',
    'r3 = ta.percentrank(ta.roc(close, 1), rocLen)',
    '',
    'crsi = math.avg(r1, r2, r3)',
    '',
    'buy  = ta.crossunder(crsi, entry)',
    'sell = ta.crossover(crsi, exitAt)',
    '',
    'plot(crsi, "Connors RSI", color=color.purple, linewidth=2)',
    'hline(exitAt, "Exit", color=color.red, dash="dashed")',
    'hline(entry, "Entry", color=color.green, dash="dashed")',
    'plotshape(buy, "Entry", draw="triangleup", location="bottom", color=color.green, text="in")',
    'plotshape(sell, "Exit", draw="triangledown", location="top", color=color.red, text="out")'
  ]);

  L("ppo", "Momentum", "Percentage price oscillator", "MACD stated in percent, so one set of thresholds works across markets of any price.", [
    'study("Percentage price oscillator", "PPO", overlay=false, precision=2)',
    '',
    'fastLen = input.int(12, "Fast", minval=1, maxval=200)',
    'slowLen = input.int(26, "Slow", minval=2, maxval=400)',
    'sigLen  = input.int(9, "Signal", minval=1, maxval=100)',
    '',
    'f = ta.ema(close, fastLen)',
    's = ta.ema(close, slowLen)',
    'ppo = s > 0 ? (f - s) / s * 100 : na',
    'sig = ta.ema(ppo, sigLen)',
    '',
    'plot(ppo - sig, "Histogram", color=ppo > sig ? color.green : color.red, draw="histogram")',
    'plot(ppo, "PPO", color=color.blue, linewidth=2)',
    'plot(sig, "Signal", color=color.orange)',
    'hline(0, "Zero", color=color.gray, dash="solid")'
  ]);

  /* ------------------------------------------------------------------ volume */

  L("rvol", "Volume", "Relative volume", "This bar's volume against the average of its window, with an alert when it doubles.", [
    'study("Relative volume", "RVOL", overlay=false, precision=2)',
    '',
    'len   = input.int(20, "Average length", minval=2, maxval=400)',
    'alert = input.float(2, "Alert multiple", minval=1.1, maxval=10, step=0.1)',
    '',
    'avg = ta.sma(volume, len)',
    'rel = avg > 0 ? volume / avg : na',
    '',
    'hot = rel >= alert',
    '',
    'plot(rel, "Relative volume", color=hot ? color.orange : rel > 1 ? color.green : color.gray, draw="columns")',
    'hline(1, "Average", color=color.gray, dash="solid")',
    'hline(alert, "Alert level", color=color.orange, dash="dashed")',
    'alertcondition(hot, "Volume spike", "Volume reached the alert multiple of its average")'
  ]);

  L("volflow", "Volume", "Volume-weighted trend", "A volume-weighted average against a plain one: the gap says whether volume is backing the move.", [
    'study("Volume-weighted trend", "VW trend", overlay=true, precision=2)',
    '',
    'len = input.int(21, "Length", minval=2, maxval=400)',
    '',
    'vw = ta.vwma(close, len)',
    'ma = ta.sma(close, len)',
    '',
    'backed = vw > ma',
    '',
    'plot(vw, "Volume weighted", color=backed ? color.green : color.red, linewidth=2)',
    'plot(ma, "Plain average", color=color.gray)',
    'fill(0, 1, color=backed ? color.green : color.red, transp=0.9)',
    'plotshape(backed and not backed[1], "Volume turned up", draw="triangleup", location="belowbar", color=color.green)',
    'plotshape(not backed and backed[1], "Volume turned down", draw="triangledown", location="abovebar", color=color.red)'
  ]);

  L("obvma", "Volume", "On-balance volume with average", "OBV with a moving average over it; the cross is the signal, not the level.", [
    'study("OBV with average", "OBV", overlay=false, precision=0)',
    '',
    'len = input.int(21, "Average length", minval=2, maxval=400)',
    '',
    'o = ta.obv()',
    'm = ta.ema(o, len)',
    '',
    'plot(o, "OBV", color=o > m ? color.green : color.red, linewidth=2)',
    'plot(m, "Average", color=color.orange)',
    'plotshape(ta.crossover(o, m), "OBV crossed up", draw="triangleup", location="bottom", color=color.green)',
    'plotshape(ta.crossunder(o, m), "OBV crossed down", draw="triangledown", location="top", color=color.red)',
    'alertcondition(ta.crossover(o, m), "OBV crossed its average", "On-balance volume crossed above its average")'
  ]);

  L("mfiheat", "Volume", "Money flow heatmap", "Money Flow Index drawn as columns and repeated as a background tint, so the extremes read at a glance.", [
    'study("Money flow heatmap", "MFI heat", overlay=false, precision=1, range_lo=0, range_hi=100)',
    '',
    'len = input.int(14, "Length", minval=2, maxval=200)',
    '',
    'm = ta.mfi(hlc3, len)',
    '',
    'tint = m > 80 ? color.new("#FF5A78", 0.55) : m > 60 ? color.new("#FF8A5B", 0.72) : m < 20 ? color.new("#22D39A", 0.55) : m < 40 ? color.new("#7BE38A", 0.72) : na',
    '',
    'plot(m, "Money flow", color=m > 50 ? color.green : color.red, draw="columns")',
    'bgcolor(tint)',
    'hline(80, "Distribution", color=color.red, dash="dashed")',
    'hline(20, "Accumulation", color=color.green, dash="dashed")',
    'hline(50, "Balance", color=color.gray, dash="dotted")'
  ]);

  L("volclimax", "Volume", "Volume climax", "A bar whose volume is an outlier and whose close sits at one end of its own range.", [
    'study("Volume climax", "Climax", overlay=true, precision=2)',
    '',
    'len  = input.int(50, "Lookback", minval=10, maxval=400)',
    'mult = input.float(2.5, "Volume multiple", minval=1.2, maxval=10, step=0.1)',
    'edge = input.float(0.25, "Close inside this fraction of the range", minval=0.05, maxval=0.5, step=0.05)',
    '',
    'avg = ta.sma(volume, len)',
    'big = avg > 0 and volume >= avg * mult',
    'span = high - low',
    'pos  = span > 0 ? (close - low) / span : 0.5',
    '',
    'buyClimax  = big and pos <= edge',
    'sellClimax = big and pos >= 1 - edge',
    '',
    'plotshape(sellClimax, "Buying climax", draw="diamond", location="abovebar", color=color.red, text="climax")',
    'plotshape(buyClimax, "Selling climax", draw="diamond", location="belowbar", color=color.green, text="climax")',
    'plot(ta.ema(close, 20), "Reference EMA", color=color.gray)',
    'alertcondition(buyClimax or sellClimax, "Volume climax", "A climax bar printed on this market")'
  ]);

  /* -------------------------------------------------------------- volatility */

  L("bbsqueeze", "Volatility", "Bollinger squeeze finder", "Bollinger width against its own history: the lowest readings are the coils worth watching.", [
    'study("Bollinger squeeze finder", "BB squeeze", overlay=false, precision=2, range_lo=0, range_hi=100)',
    '',
    'len  = input.int(20, "Bollinger length", minval=2, maxval=400)',
    'mult = input.float(2, "Deviations", minval=0.5, maxval=5, step=0.1)',
    'look = input.int(120, "Percentile lookback", minval=20, maxval=400)',
    'tight = input.float(15, "Squeeze percentile", minval=1, maxval=50, step=1)',
    '',
    'w = ta.bbw(close, len, mult)',
    'rank = ta.percentrank(w, look)',
    '',
    'coiled = rank <= tight',
    '',
    'plot(rank, "Width percentile", color=coiled ? color.orange : color.aqua, draw="area", linewidth=2)',
    'hline(tight, "Squeeze", color=color.orange, dash="dashed")',
    'bgcolor(coiled ? color.new("#F5A623", 0.85) : na)',
    'alertcondition(coiled and not coiled[1], "Squeeze started", "Bollinger width dropped into its squeeze percentile")'
  ]);

  L("atrtrail", "Volatility", "ATR trailing stop", "A stop that follows price by a multiple of ATR and never moves against the position.", [
    'study("ATR trailing stop", "ATR stop", overlay=true, precision=2)',
    '',
    'len  = input.int(14, "ATR length", minval=1, maxval=100)',
    'mult = input.float(3, "ATR multiple", minval=0.5, maxval=10, step=0.1)',
    '',
    'atr = ta.atr(len)',
    'loss = atr * mult',
    '',
    'var float stop = na',
    'var int side = 1',
    '',
    'longStop  = close - loss',
    'shortStop = close + loss',
    '',
    'if na(stop)',
    '    stop := longStop',
    'else if side > 0',
    '    stop := math.max(stop, longStop)',
    '    if close < stop',
    '        side := -1',
    '        stop := shortStop',
    'else',
    '    stop := math.min(stop, shortStop)',
    '    if close > stop',
    '        side := 1',
    '        stop := longStop',
    '',
    'plot(stop, "Trailing stop", color=side > 0 ? color.green : color.red, draw="stepline", linewidth=2)',
    'plotshape(side > 0 and side[1] < 0, "Stop flipped long", draw="triangleup", location="belowbar", color=color.green)',
    'plotshape(side < 0 and side[1] > 0, "Stop flipped short", draw="triangledown", location="abovebar", color=color.red)'
  ]);

  L("kcbb", "Volatility", "Keltner and Bollinger squeeze", "Both channels drawn together; the background marks the bars where Bollinger sits inside Keltner.", [
    'study("Keltner and Bollinger", "KC/BB", overlay=true, precision=2)',
    '',
    'len  = input.int(20, "Length", minval=2, maxval=400)',
    'bbM  = input.float(2, "Bollinger deviations", minval=0.5, maxval=5, step=0.1)',
    'kcM  = input.float(1.5, "Keltner multiple", minval=0.5, maxval=5, step=0.1)',
    '',
    '[bMid, bUp, bDn] = ta.bb(close, len, bbM)',
    '[kMid, kUp, kDn] = ta.kc(close, len, kcM, true)',
    '',
    'inside = bUp < kUp and bDn > kDn',
    '',
    'plot(bUp, "Bollinger upper", color=color.blue)',
    'plot(bDn, "Bollinger lower", color=color.blue)',
    'plot(kUp, "Keltner upper", color=color.orange)',
    'plot(kDn, "Keltner lower", color=color.orange)',
    'plot(bMid, "Basis", color=color.gray)',
    'fill(0, 1, color=color.blue, transp=0.93)',
    'bgcolor(inside ? color.new("#F5A623", 0.86) : na)',
    'alertcondition(not inside and inside[1], "Squeeze released", "Bollinger left the Keltner channel")'
  ]);

  L("nrange", "Volatility", "Normalised range", "The bar's true range as a percent of price, with its own average, so wide and quiet regimes separate.", [
    'study("Normalised range", "Range %", overlay=false, precision=2)',
    '',
    'len = input.int(20, "Average length", minval=2, maxval=400)',
    'hot = input.float(2, "Wide multiple", minval=1.1, maxval=8, step=0.1)',
    '',
    'tr = ta.tr()',
    'pct = close > 0 ? tr / close * 100 : na',
    'avg = ta.sma(pct, len)',
    '',
    'wide = avg > 0 and pct >= avg * hot',
    '',
    'plot(pct, "True range %", color=wide ? color.red : color.aqua, draw="columns")',
    'plot(avg, "Average", color=color.orange, linewidth=2)',
    'alertcondition(wide, "Range expansion", "This bar spans a multiple of the recent average range")'
  ]);

  /* -------------------------------------------------------- market structure
     Layer 51 already draws order blocks, fair value gaps, structure breaks,
     sweeps and premium/discount as built-in studies, with the extra care a
     built-in can afford. These six are deliberately NOT those: each one is the
     shortest honest statement of the idea, written to be read and edited. */

  L("swings", "Structure", "Swing highs and lows", "Confirmed swing points marked on the bar they belong to, out of ta.pivothigh and ta.pivotlow and nothing else.", [
    'study("Swing points", "Swings", overlay=true, precision=2)',
    '',
    'left  = input.int(5, "Bars to the left", minval=1, maxval=50)',
    'right = input.int(5, "Bars to the right", minval=1, maxval=50)',
    '',
    'ph = ta.pivothigh(high, left, right)',
    'pl = ta.pivotlow(low, left, right)',
    '',
    'plotshape(not na(ph), "Swing high", draw="triangledown", location="abovebar", color=color.red, text="H")',
    'plotshape(not na(pl), "Swing low", draw="triangleup", location="belowbar", color=color.green, text="L")',
    'plot(ta.valuewhen(not na(ph), ph, 0), "Last swing high", color=color.red, draw="stepline")',
    'plot(ta.valuewhen(not na(pl), pl, 0), "Last swing low", color=color.green, draw="stepline")'
  ]);

  L("bos", "Structure", "Break of structure", "A close through the last confirmed swing, marked as continuation or as a change of character.", [
    'study("Break of structure", "BOS", overlay=true, precision=2)',
    '',
    'left  = input.int(5, "Bars to the left", minval=1, maxval=50)',
    'right = input.int(3, "Bars to the right", minval=1, maxval=50)',
    '',
    'ph = ta.pivothigh(high, left, right)',
    'pl = ta.pivotlow(low, left, right)',
    '',
    'lastHigh = ta.valuewhen(not na(ph), ph, 0)',
    'lastLow  = ta.valuewhen(not na(pl), pl, 0)',
    '',
    'var int bias = 0',
    'var float brokeHigh = na',
    'var float brokeLow = na',
    '',
    'upBreak = not na(lastHigh) and close > lastHigh and (na(brokeHigh) or lastHigh != brokeHigh)',
    'dnBreak = not na(lastLow) and close < lastLow and (na(brokeLow) or lastLow != brokeLow)',
    '',
    'choch = 0',
    'if upBreak',
    '    choch := bias < 0 ? 1 : 0',
    '    bias := 1',
    '    brokeHigh := lastHigh',
    'else if dnBreak',
    '    choch := bias > 0 ? 1 : 0',
    '    bias := -1',
    '    brokeLow := lastLow',
    '',
    'plot(lastHigh, "Last swing high", color=color.red, draw="stepline")',
    'plot(lastLow, "Last swing low", color=color.green, draw="stepline")',
    'plotshape(upBreak and choch == 0, "Break up", draw="triangleup", location="belowbar", color=color.green, text="BOS")',
    'plotshape(dnBreak and choch == 0, "Break down", draw="triangledown", location="abovebar", color=color.red, text="BOS")',
    'plotshape(upBreak and choch == 1, "Change of character up", draw="flag", location="belowbar", color=color.aqua, text="CHoCH")',
    'plotshape(dnBreak and choch == 1, "Change of character down", draw="flag", location="abovebar", color=color.orange, text="CHoCH")',
    'alertcondition(upBreak or dnBreak, "Structure broke", "Price closed through the last confirmed swing")'
  ]);

  L("fvg", "Structure", "Fair value gaps", "The three-bar imbalance: bar one and bar three never touch, and the space between them is the gap.", [
    'study("Fair value gaps", "FVG", overlay=true, precision=2)',
    '',
    'minPct = input.float(0.1, "Smallest gap, percent of price", minval=0, maxval=5, step=0.05)',
    '',
    'gapUp = low > high[2]',
    'gapDn = high < low[2]',
    '',
    'upSize = gapUp ? low - high[2] : na',
    'dnSize = gapDn ? low[2] - high : na',
    '',
    'big = close > 0 ? minPct / 100 * close : 0',
    '',
    'realUp = gapUp and upSize >= big',
    'realDn = gapDn and dnSize >= big',
    '',
    'plot(realUp ? high[2] : na, "Gap floor", color=color.green, draw="circles", linewidth=2)',
    'plot(realUp ? low : na, "Gap ceiling", color=color.green, draw="circles", linewidth=2)',
    'plot(realDn ? low[2] : na, "Gap ceiling down", color=color.red, draw="circles", linewidth=2)',
    'plot(realDn ? high : na, "Gap floor down", color=color.red, draw="circles", linewidth=2)',
    'plotshape(realUp, "Bullish gap", draw="square", location="belowbar", color=color.green, text="FVG")',
    'plotshape(realDn, "Bearish gap", draw="square", location="abovebar", color=color.red, text="FVG")',
    'alertcondition(realUp or realDn, "Fair value gap", "A three-bar imbalance printed on this market")'
  ]);

  L("orderblock", "Structure", "Order blocks", "The last opposing candle before an impulsive move, held as a band at its own body.", [
    'study("Order blocks", "OB", overlay=true, precision=2)',
    '',
    'push = input.float(1.5, "Impulse, in ATR", minval=0.3, maxval=8, step=0.1)',
    'len  = input.int(14, "ATR length", minval=1, maxval=100)',
    '',
    'atr = ta.atr(len)',
    'bull = close - open > atr * push',
    'bear = open - close > atr * push',
    '',
    'downBefore = close[1] < open[1]',
    'upBefore   = close[1] > open[1]',
    '',
    'bullOb = bull and downBefore',
    'bearOb = bear and upBefore',
    '',
    'var float bullTop = na',
    'var float bullBot = na',
    'var float bearTop = na',
    'var float bearBot = na',
    '',
    'if bullOb',
    '    bullTop := math.max(open[1], close[1])',
    '    bullBot := math.min(low[1], math.min(open[1], close[1]))',
    'if bearOb',
    '    bearTop := math.max(high[1], math.max(open[1], close[1]))',
    '    bearBot := math.min(open[1], close[1])',
    '',
    'plot(bullTop, "Demand top", color=color.green, draw="stepline")',
    'plot(bullBot, "Demand base", color=color.green, draw="stepline")',
    'plot(bearTop, "Supply top", color=color.red, draw="stepline")',
    'plot(bearBot, "Supply base", color=color.red, draw="stepline")',
    'fill(0, 1, color=color.green, transp=0.9)',
    'fill(2, 3, color=color.red, transp=0.9)',
    'plotshape(bullOb, "Demand block", draw="square", location="belowbar", color=color.green, text="OB")',
    'plotshape(bearOb, "Supply block", draw="square", location="abovebar", color=color.red, text="OB")'
  ]);

  L("liquidity", "Structure", "Liquidity levels", "Equal highs and equal lows within a tolerance: the shelves stops are resting under, and the bars that run them.", [
    'study("Liquidity levels", "Liquidity", overlay=true, precision=2)',
    '',
    'left  = input.int(4, "Bars to the left", minval=1, maxval=40)',
    'right = input.int(2, "Bars to the right", minval=1, maxval=40)',
    'tol   = input.float(0.5, "Equal within, in ATR", minval=0.02, maxval=3, step=0.01)',
    '',
    'atr = ta.atr(14)',
    '',
    'ph = ta.pivothigh(high, left, right)',
    'pl = ta.pivotlow(low, left, right)',
    '',
    'h0 = ta.valuewhen(not na(ph), ph, 0)',
    'h1 = ta.valuewhen(not na(ph), ph, 1)',
    'l0 = ta.valuewhen(not na(pl), pl, 0)',
    'l1 = ta.valuewhen(not na(pl), pl, 1)',
    '',
    'eqh = not na(ph) and not na(h1) and math.abs(h0 - h1) <= atr * tol',
    'eql = not na(pl) and not na(l1) and math.abs(l0 - l1) <= atr * tol',
    '',
    'var float sellSide = na',
    'var float buySide = na',
    'if eqh',
    '    sellSide := h0',
    'if eql',
    '    buySide := l0',
    '',
    'sweptUp = not na(sellSide) and high > sellSide and close < sellSide',
    'sweptDn = not na(buySide) and low < buySide and close > buySide',
    '',
    'plot(sellSide, "Sell-side liquidity", color=color.red, draw="stepline")',
    'plot(buySide, "Buy-side liquidity", color=color.green, draw="stepline")',
    'plotshape(eqh, "Equal highs", draw="square", location="abovebar", color=color.red, text="EQH")',
    'plotshape(eql, "Equal lows", draw="square", location="belowbar", color=color.green, text="EQL")',
    'plotshape(sweptUp, "Sell-side swept", draw="xcross", location="abovebar", color=color.orange)',
    'plotshape(sweptDn, "Buy-side swept", draw="xcross", location="belowbar", color=color.orange)',
    'alertcondition(sweptUp or sweptDn, "Liquidity swept", "Price ran a shelf of equal highs or lows and closed back inside")'
  ]);

  L("premdisc", "Structure", "Premium and discount", "The recent range split at its midpoint, with the 0.62-0.79 optimal entry band inside it.", [
    'study("Premium and discount", "Prem/Disc", overlay=true, precision=2)',
    '',
    'len = input.int(60, "Range lookback", minval=10, maxval=400)',
    '',
    'hi = ta.highest(high, len)',
    'lo = ta.lowest(low, len)',
    'mid = (hi + lo) / 2',
    '',
    'span = hi - lo',
    'oteHi = lo + span * 0.79',
    'oteLo = lo + span * 0.62',
    '',
    'zone = close > mid ? 1 : -1',
    '',
    'plot(hi, "Range high", color=color.red)',
    'plot(lo, "Range low", color=color.green)',
    'plot(mid, "Equilibrium", color=zone > 0 ? color.red : color.green, linewidth=2)',
    'plot(oteHi, "OTE top", color=color.orange)',
    'plot(oteLo, "OTE base", color=color.orange)',
    'fill(3, 4, color=color.orange, transp=0.86)',
    'bgcolor(close > oteLo and close < oteHi ? color.new("#F5A623", 0.9) : na)'
  ]);

  /* -------------------------------------------------------- bands and levels */

  L("pivots", "Levels", "Daily pivot levels", "Floor-trader pivots computed from the previous UTC day and held flat across the current one.", [
    'study("Daily pivots", "Pivots", overlay=true, precision=2)',
    '',
    'show = input.bool(true, "Show the outer levels")',
    '',
    'dayNo = math.floor(time / 86400000)',
    'newDay = dayNo != dayNo[1]',
    '',
    'var float dh = na',
    'var float dl = na',
    'var float dc = na',
    'var float ph = na',
    'var float pl = na',
    'var float pc = na',
    '',
    'if newDay',
    '    ph := dh',
    '    pl := dl',
    '    pc := dc',
    '    dh := high',
    '    dl := low',
    'else',
    '    dh := math.max(dh, high)',
    '    dl := math.min(dl, low)',
    'dc := close',
    '',
    'p  = (ph + pl + pc) / 3',
    'r1 = 2 * p - pl',
    's1 = 2 * p - ph',
    'r2 = p + (ph - pl)',
    's2 = p - (ph - pl)',
    '',
    'plot(p, "Pivot", color=color.orange, draw="stepline", linewidth=2)',
    'plot(r1, "R1", color=color.red, draw="stepline")',
    'plot(s1, "S1", color=color.green, draw="stepline")',
    'plot(show ? r2 : na, "R2", color=color.red, draw="stepline")',
    'plot(show ? s2 : na, "S2", color=color.green, draw="stepline")'
  ]);

  L("priorlevels", "Levels", "Prior day and week levels", "Yesterday's high, low and close and last week's high and low, held as steps across the current period.", [
    'study("Prior period levels", "Prior HL", overlay=true, precision=2)',
    '',
    'showWeek = input.bool(true, "Show the weekly levels")',
    '',
    'dayNo  = math.floor(time / 86400000)',
    'weekNo = math.floor(time / 604800000)',
    '',
    'newDay  = dayNo != dayNo[1]',
    'newWeek = weekNo != weekNo[1]',
    '',
    'var float dh = na',
    'var float dl = na',
    'var float pdh = na',
    'var float pdl = na',
    'var float pdc = na',
    'var float wh = na',
    'var float wl = na',
    'var float pwh = na',
    'var float pwl = na',
    '',
    'if newDay',
    '    pdh := dh',
    '    pdl := dl',
    '    pdc := close[1]',
    '    dh := high',
    '    dl := low',
    'else',
    '    dh := math.max(dh, high)',
    '    dl := math.min(dl, low)',
    '',
    'if newWeek',
    '    pwh := wh',
    '    pwl := wl',
    '    wh := high',
    '    wl := low',
    'else',
    '    wh := math.max(wh, high)',
    '    wl := math.min(wl, low)',
    '',
    'plot(pdh, "Prior day high", color=color.red, draw="stepline")',
    'plot(pdl, "Prior day low", color=color.green, draw="stepline")',
    'plot(pdc, "Prior day close", color=color.gray, draw="stepline")',
    'plot(showWeek ? pwh : na, "Prior week high", color=color.orange, draw="stepline", linewidth=2)',
    'plot(showWeek ? pwl : na, "Prior week low", color=color.aqua, draw="stepline", linewidth=2)'
  ]);

  L("sessions", "Levels", "Session levels", "The high and low of each UTC session, with the session you are in tinted behind the bars.", [
    'study("Session levels", "Sessions", overlay=true, precision=2)',
    '',
    'asiaEnd   = input.int(8, "Asia ends at UTC hour", minval=1, maxval=23)',
    'londonEnd = input.int(16, "London ends at UTC hour", minval=1, maxval=23)',
    '',
    'hour = math.floor(time / 3600000) % 24',
    'sess = hour < asiaEnd ? 0 : hour < londonEnd ? 1 : 2',
    'newSess = sess != sess[1]',
    '',
    'var float sh = na',
    'var float sl = na',
    '',
    'if newSess',
    '    sh := high',
    '    sl := low',
    'else',
    '    sh := math.max(sh, high)',
    '    sl := math.min(sl, low)',
    '',
    'tint = sess == 0 ? color.new("#B36BFF", 0.92) : sess == 1 ? color.new("#5B8CFF", 0.92) : color.new("#F5A623", 0.92)',
    '',
    'plot(sh, "Session high", color=color.red, draw="stepline")',
    'plot(sl, "Session low", color=color.green, draw="stepline")',
    'fill(0, 1, color=color.gray, transp=0.94)',
    'bgcolor(tint)'
  ]);

  L("vwapbands", "Levels", "VWAP with deviation bands", "The session VWAP with one, two and three standard deviations either side of it.", [
    'study("VWAP bands", "VWAP", overlay=true, precision=2)',
    '',
    'mult1 = input.float(1, "First band", minval=0.2, maxval=6, step=0.1)',
    'mult2 = input.float(2, "Second band", minval=0.2, maxval=6, step=0.1)',
    'mult3 = input.float(3, "Third band", minval=0.2, maxval=6, step=0.1)',
    '',
    'vw = ta.vwap(hlc3)',
    '',
    'dayNo = math.floor(time / 86400000)',
    'newDay = dayNo != dayNo[1]',
    '',
    'var float sumSq = 0',
    'var float count = 0',
    '',
    'if newDay',
    '    sumSq := 0',
    '    count := 0',
    '',
    'sumSq := sumSq + (hlc3 - vw) * (hlc3 - vw)',
    'count := count + 1',
    '',
    'dev = count > 0 ? math.sqrt(sumSq / count) : na',
    '',
    'plot(vw, "VWAP", color=color.orange, linewidth=2)',
    'plot(vw + dev * mult1, "Upper 1", color=color.blue)',
    'plot(vw - dev * mult1, "Lower 1", color=color.blue)',
    'plot(vw + dev * mult2, "Upper 2", color=color.purple)',
    'plot(vw - dev * mult2, "Lower 2", color=color.purple)',
    'plot(vw + dev * mult3, "Upper 3", color=color.red)',
    'plot(vw - dev * mult3, "Lower 3", color=color.red)',
    'fill(1, 2, color=color.blue, transp=0.92)'
  ]);

  /* -------------------------------------------------------------- strategies */

  L("st-emacross", "Strategies", "EMA cross", "Long on the fast average crossing up, flat on the cross back down. The simplest honest backtest.", [
    'strategy("EMA cross strategy", "EMA X", overlay=true, precision=2, initial_capital=10000, commission=0.04, slippage=1, default_qty=1)',
    '',
    'fastLen = input.int(10, "Fast", minval=1, maxval=200)',
    'slowLen = input.int(30, "Slow", minval=2, maxval=400)',
    '',
    'fast = ta.ema(close, fastLen)',
    'slow = ta.ema(close, slowLen)',
    '',
    'if ta.crossover(fast, slow)',
    '    strategy.entry("long", "long")',
    '',
    'if ta.crossunder(fast, slow)',
    '    strategy.close("long")',
    '',
    'plot(fast, "Fast", color=color.green)',
    'plot(slow, "Slow", color=color.red)'
  ]);

  L("st-supertrend", "Strategies", "SuperTrend follower", "Reverses with the SuperTrend direction, so the book is always on the side the line is on.", [
    'strategy("SuperTrend follower", "ST follow", overlay=true, precision=2, initial_capital=10000, commission=0.04, slippage=1, default_qty=1)',
    '',
    'f   = input.float(3, "ATR factor", minval=0.5, maxval=10, step=0.1)',
    'len = input.int(10, "ATR length", minval=1, maxval=100)',
    'shorts = input.bool(true, "Take the short side too")',
    '',
    '[st, dir] = ta.supertrend(f, len)',
    '',
    'if dir < 0 and dir[1] > 0',
    '    strategy.entry("long", "long")',
    '',
    'if dir > 0 and dir[1] < 0',
    '    if shorts',
    '        strategy.entry("short", "short")',
    '    else',
    '        strategy.close("long")',
    '',
    'plot(st, "SuperTrend", color=dir < 0 ? color.green : color.red, linewidth=2)'
  ]);

  L("st-rsimr", "Strategies", "RSI mean reversion", "Buys oversold, sells the return to the middle, with an ATR stop underneath.", [
    'strategy("RSI mean reversion", "RSI MR", overlay=true, precision=2, initial_capital=10000, commission=0.04, slippage=1, default_qty=1)',
    '',
    'len   = input.int(14, "RSI length", minval=2, maxval=200)',
    'buyAt = input.float(30, "Buy below", minval=5, maxval=49, step=1)',
    'exitAt = input.float(55, "Sell above", minval=50, maxval=95, step=1)',
    'stopMult = input.float(2.5, "Stop, in ATR", minval=0.5, maxval=10, step=0.1)',
    '',
    'r = ta.rsi(close, len)',
    'atr = ta.atr(14)',
    '',
    'if ta.crossunder(r, buyAt)',
    '    strategy.entry("long", "long")',
    '    strategy.exit("stop", "long", loss=atr * stopMult)',
    '',
    'if ta.crossover(r, exitAt)',
    '    strategy.close("long")',
    '',
    'plot(ta.ema(close, 20), "EMA 20", color=color.gray)',
    'plotshape(ta.crossunder(r, buyAt), "Entry", draw="triangleup", location="belowbar", color=color.green)'
  ]);

  L("st-bbrev", "Strategies", "Bollinger reversion", "Buys a close back inside the lower band and sells at the basis.", [
    'strategy("Bollinger reversion", "BB rev", overlay=true, precision=2, initial_capital=10000, commission=0.04, slippage=1, default_qty=1)',
    '',
    'len  = input.int(20, "Length", minval=2, maxval=400)',
    'mult = input.float(2, "Deviations", minval=0.5, maxval=5, step=0.1)',
    '',
    '[mid, up, dn] = ta.bb(close, len, mult)',
    '',
    'reenter = close > dn and close[1] <= dn[1]',
    '',
    'if reenter',
    '    strategy.entry("long", "long")',
    '',
    'if close >= mid and strategy.position_size > 0',
    '    strategy.close("long")',
    '',
    'plot(up, "Upper", color=color.blue)',
    'plot(dn, "Lower", color=color.blue)',
    'plot(mid, "Basis", color=color.orange)',
    'fill(0, 1, color=color.blue, transp=0.92)'
  ]);

  L("st-breakout", "Strategies", "Breakout with ATR stop", "Buys a close above the highest close of the window and trails the position by ATR.", [
    'strategy("Breakout with ATR stop", "Breakout", overlay=true, precision=2, initial_capital=10000, commission=0.04, slippage=1, default_qty=1)',
    '',
    'len   = input.int(20, "Breakout length", minval=2, maxval=400)',
    'trail = input.float(3, "Trailing stop, in ATR", minval=0.5, maxval=10, step=0.1)',
    '',
    'hh = ta.highest(close, len)',
    'atr = ta.atr(14)',
    '',
    'fire = close > hh[1]',
    '',
    'if fire',
    '    strategy.entry("long", "long")',
    '    strategy.exit("trail", "long", trail_points=atr * trail)',
    '',
    'plot(hh, "Breakout level", color=color.orange, draw="stepline")',
    'plotshape(fire, "Breakout", draw="triangleup", location="belowbar", color=color.green)'
  ]);

  L("st-macd", "Strategies", "MACD trend follower", "Reverses with the MACD signal cross and carries an ATR stop on whichever side it is holding.", [
    'strategy("MACD trend follower", "MACD trend", overlay=true, precision=2, initial_capital=10000, commission=0.04, slippage=1, default_qty=1)',
    '',
    'fastLen  = input.int(12, "Fast", minval=1, maxval=200)',
    'slowLen  = input.int(26, "Slow", minval=2, maxval=400)',
    'sigLen   = input.int(9, "Signal", minval=1, maxval=100)',
    'stopMult = input.float(4, "Stop, in ATR", minval=0.5, maxval=20, step=0.1)',
    '',
    '[m, sig, hist] = ta.macd(close, fastLen, slowLen, sigLen)',
    'atr = ta.atr(14)',
    '',
    'co = ta.crossover(m, sig)',
    'cu = ta.crossunder(m, sig)',
    '',
    'if co',
    '    strategy.entry("long", "long")',
    '    strategy.exit("long stop", "long", loss=atr * stopMult)',
    'else if cu',
    '    strategy.entry("short", "short")',
    '    strategy.exit("short stop", "short", loss=atr * stopMult)',
    '',
    'plot(ta.ema(close, slowLen), "Slow EMA", color=color.gray, linewidth=2)',
    'plotshape(co, "Long", draw="triangleup", location="belowbar", color=color.green)',
    'plotshape(cu, "Short", draw="triangledown", location="abovebar", color=color.red)'
  ]);

  L("st-grid", "Strategies", "Grid DCA", "Adds a rung every time price falls a step below the last one and closes the whole ladder on a fixed gain.", [
    'strategy("Grid DCA", "Grid", overlay=true, precision=2, initial_capital=10000, commission=0.02, slippage=1, pyramiding=8, default_qty=1)',
    '',
    'step  = input.float(2, "Rung spacing, percent", minval=0.2, maxval=20, step=0.1)',
    'take  = input.float(3, "Take profit, percent", minval=0.2, maxval=30, step=0.1)',
    'maxRungs = input.int(6, "Most rungs at once", minval=1, maxval=8)',
    '',
    'var float lastBuy = na',
    'var int rungs = 0',
    '',
    'wantRung = rungs == 0 or (not na(lastBuy) and close <= lastBuy * (1 - step / 100))',
    'wantOut  = rungs > 0 and not na(lastBuy) and close >= lastBuy * (1 + take / 100)',
    '',
    'if wantOut',
    '    strategy.close_all()',
    '    rungs := 0',
    '    lastBuy := na',
    'else if wantRung and rungs < maxRungs',
    '    strategy.entry("grid", "long", 1)',
    '    lastBuy := close',
    '    rungs := rungs + 1',
    '',
    'plot(lastBuy, "Last rung", color=color.orange, draw="stepline")',
    'plotshape(wantOut, "Ladder closed", draw="xcross", location="abovebar", color=color.aqua)',
    'plot(na(lastBuy) ? na : lastBuy * (1 + take / 100), "Target", color=color.green, draw="stepline")'
  ]);

  var LIB_BY_ID = {};
  (function () {
    var i;
    for (i = 0; i < LIB.length; i++) LIB_BY_ID[LIB[i].id] = LIB[i];
  })();
  var LIB_GROUPS = (function () {
    var seen = {}, out = [], i;
    for (i = 0; i < LIB.length; i++) if (!seen[LIB[i].group]) { seen[LIB[i].group] = 1; out.push(LIB[i].group); }
    return out;
  })();

  /* =====================================================================
     3 · USER SCRIPTS, AND WHICH SCRIPTS ARE ON THE CHART PER MARKET
     A drawing belongs to a market; so does a script. The engine's CFG.studies
     is one global list, so this layer keeps its own record keyed on
     DXC.kit.symKey() and reconciles the two whenever the symbol has moved.
     ===================================================================== */

  function users() { var o = LS.get(K_USER, null); return (o && typeof o === "object") ? o : {}; }
  function saveUsers(o) { LS.set(K_USER, o); }
  function userList() {
    var o = users(), out = [], k;
    for (k in o) if (has(o, k)) out.push(o[k]);
    out.sort(function (a, b) { return (b.modified || 0) - (a.modified || 0); });
    return out;
  }
  function userById(id) { var o = users(); return has(o, id) ? o[id] : null; }
  function newUserId() { return "u" + now().toString(36) + Math.floor(Math.random() * 1296).toString(36); }

  function saveUser(title, source, id) {
    try {
      var o = users();
      var rec = (id && has(o, id)) ? o[id] : { id: id || newUserId(), created: now() };
      rec.title = String(title || "Untitled script").slice(0, 80);
      rec.source = String(source == null ? "" : source);
      rec.modified = now();
      o[rec.id] = rec;
      saveUsers(o);
      return rec;
    } catch (e) { fault("saveUser", e); return null; }
  }
  function deleteUser(id) {
    try {
      var o = users();
      if (!has(o, id)) return false;
      delete o[id];
      saveUsers(o);
      removeFromChart({ src: "user", id: id });
      return true;
    } catch (e) { fault("deleteUser", e); return false; }
  }

  function sourceOf(ref) {
    if (!ref) return null;
    if (ref.src === "lib") { var L2 = LIB_BY_ID[ref.id]; return L2 ? L2.source : null; }
    var u = userById(ref.id);
    return u ? u.source : null;
  }
  function titleOf(ref) {
    if (!ref) return "";
    if (ref.src === "lib") { var L2 = LIB_BY_ID[ref.id]; return L2 ? L2.title : ref.id; }
    var u = userById(ref.id);
    return u ? u.title : ref.id;
  }

  function onMap() { var o = LS.get(K_ON, null); return (o && typeof o === "object") ? o : {}; }
  function saveOnMap(o) { LS.set(K_ON, o); }
  function onChart(sk) {
    var m = onMap(), list = m[sk || symKey()];
    var out = [], i, r;
    if (!list || !list.length) return out;
    for (i = 0; i < list.length; i++) { r = parseRef(list[i]); if (r) out.push(r); }
    return out;
  }
  function rememberOn(ref, yes) {
    try {
      var m = onMap(), sk = symKey(), list = (m[sk] || []).slice(), k = refKey(ref), at = list.indexOf(k);
      if (yes && at < 0) list.push(k);
      if (!yes && at >= 0) list.splice(at, 1);
      m[sk] = list;
      saveOnMap(m);
    } catch (e) { fault("rememberOn", e); }
  }

  function paramStore() { var o = LS.get(K_PARAM, null); return (o && typeof o === "object") ? o : {}; }

  /* Registering is idempotent by design: layer 53 swaps the def under the same
     key and the engine rebuilds its key list, so an instance already on the
     chart keeps its place and simply recomputes with the new source. */
  function addToChart(ref) {
    var src = sourceOf(ref);
    if (src == null) return { ok: false, errors: [{ line: 0, msg: "that script is not in the library or in your scripts" }], key: null };
    var regId = regIdOf(ref);
    var r;
    try { r = DXS.register(regId, src); } catch (e) { fault("register", e); return { ok: false, errors: [{ line: 0, msg: "the engine refused this script" }], key: null }; }
    if (!r.ok) return { ok: false, errors: r.errors, key: null };
    try {
      var live = DXC.studies(), i, already = false;
      for (i = 0; i < live.length; i++) if (live[i].k === r.key) already = true;
      if (!already) {
        var st = DXC.addStudy(r.key);
        /* the values the editor's inputs panel was left on travel with it */
        var saved = paramStore()[regId];
        if (st && saved) { st.p = st.p || {}; var q; for (q in saved) if (has(saved, q)) st.p[q] = saved[q]; K.mark(); }
      }
    } catch (e) { fault("addStudy", e); }
    rememberOn(ref, true);
    return { ok: true, errors: [], key: r.key, meta: r.meta };
  }

  function removeFromChart(ref) {
    var regId = regIdOf(ref), key = "dxs:" + regId;
    try {
      var live = DXC.studies().slice(), i;
      for (i = 0; i < live.length; i++) if (live[i].k === key) DXC.removeStudy(live[i].id);
    } catch (e) { fault("removeStudy", e); }
    try { DXS.unregister(regId); } catch (e2) { fault("unregister", e2); }
    rememberOn(ref, false);
    return true;
  }

  /* The reconciliation. Called at boot and whenever the chrome is rebuilt,
     which is what happens when the market changes. There is no symbol event on
     the engine to listen to, so this compares rather than subscribes. */
  var lastSym = null;
  function sync() {
    var sk = symKey();
    if (sk === lastSym) return false;
    lastSym = sk;
    try {
      var want = onChart(sk), wantKeys = {}, i;
      for (i = 0; i < want.length; i++) wantKeys["dxs:" + regIdOf(want[i])] = 1;
      var live = DXC.studies().slice();
      for (i = 0; i < live.length; i++) {
        if (String(live[i].k).indexOf("dxs:") !== 0) continue;
        if (!wantKeys[live[i].k]) DXC.removeStudy(live[i].id);
      }
      for (i = 0; i < want.length; i++) addToChart(want[i]);
    } catch (e) { fault("sync", e); }
    return true;
  }

  /* =====================================================================
     4 · EXPORT AND IMPORT
     A .dexs file is JSON with a version on it. Import compiles every script
     before it accepts any of them and names the ones that did not.
     ===================================================================== */

  function exportPayload(list) {
    return {
      format: "dexs",
      version: FILE_VER,
      exported: new Date().toISOString(),
      scripts: list
    };
  }
  function exportOne(ref) {
    var src = sourceOf(ref);
    if (src == null) return null;
    return JSON.stringify(exportPayload([{ title: titleOf(ref), source: src }]), null, 2);
  }
  function exportAllUser() {
    var list = userList(), out = [], i;
    for (i = 0; i < list.length; i++) out.push({ title: list[i].title, source: list[i].source, created: list[i].created, modified: list[i].modified });
    return JSON.stringify(exportPayload(out), null, 2);
  }
  function download(name, text) {
    try {
      if (!W.Blob || !W.URL || !W.URL.createObjectURL) return false;
      var b = new W.Blob([text], { type: "application/json" });
      var url = W.URL.createObjectURL(b);
      var a = el("a", null, null, { href: url, download: name });
      d.body.appendChild(a);
      a.click();
      d.body.removeChild(a);
      W.setTimeout(function () { try { W.URL.revokeObjectURL(url); } catch (e) { } }, 1000);
      return true;
    } catch (e) { fault("download", e); return false; }
  }

  /* Nothing is written until every script in the file has compiled. A partial
     import that half-succeeds is the kind of state nobody can reason about. */
  function importText(text) {
    var res = { ok: false, added: [], failed: [], msg: "" };
    var data;
    try { data = JSON.parse(String(text)); }
    catch (e) { res.msg = "that is not a .dexs file — it is not valid JSON"; return res; }
    if (!data || data.format !== "dexs" || !data.scripts || !data.scripts.length) {
      res.msg = "that JSON is not a DexScript export: it needs a \"format\" of \"dexs\" and a \"scripts\" list";
      return res;
    }
    if (+data.version > FILE_VER) {
      res.msg = "that file was written by a newer version of this app (format " + data.version + ", this one reads " + FILE_VER + ")";
      return res;
    }
    var okList = [], i, s, c;
    for (i = 0; i < data.scripts.length; i++) {
      s = data.scripts[i] || {};
      var title = String(s.title || ("Imported script " + (i + 1)));
      if (typeof s.source !== "string" || !s.source.length) {
        res.failed.push({ title: title, errors: [{ line: 0, msg: "this entry carries no source" }] });
        continue;
      }
      c = DXS.compile(s.source);
      if (!c.ok) { res.failed.push({ title: title, errors: c.errors }); continue; }
      okList.push({ title: c.meta.title || title, source: s.source });
    }
    if (res.failed.length) {
      res.msg = res.failed.length + " of " + data.scripts.length + " script" + (data.scripts.length === 1 ? "" : "s") + " did not compile, so nothing was imported";
      return res;
    }
    for (i = 0; i < okList.length; i++) {
      var rec = saveUser(okList[i].title, okList[i].source, null);
      if (rec) res.added.push(rec);
    }
    res.ok = true;
    res.msg = "Imported " + res.added.length + " script" + (res.added.length === 1 ? "" : "s") + ".";
    return res;
  }

  /* =====================================================================
     5 · DXSPINE — THE PINE v5 SUBSET CONVERTER
     What it does, in one sentence: it rewrites the shapes a Pine STUDY is
     usually written in into DexScript, and it refuses everything else out
     loud. This is a translator, not a Pine runtime — there is no drawing-
     object model here, no second symbol to request, and no Pine type system.

     TRANSLATED    //@version, indicator()/study(), strategy(), input.*,
                   ta.* math.* str.* array.* where the name and arity match,
                   plot plotshape plotchar hline fill bgcolor barcolor,
                   colour literals and color.new/color.rgb/named colours,
                   :=, var, typed declarations, if/else if/else, for, while,
                   ternaries, and/or/not, the history operator, comments,
                   strategy.entry/order/close/close_all/exit.
     APPROXIMATED  transparency (Pine counts 0-100, we count 0-1), plot styles
                   we do not have exactly, int()/float() casts, argument names
                   we have no home for (they are dropped and named), and a
                   request.security timeframe spelled the Pine way.
     REFUSED       request.security on another symbol, label/line/box/table/
                   polyline linefill, matrix.*, map.*, import, method, type,
                   varip, switch, for…in, input.timeframe symbol session price,
                   alert(), runtime.error(), log.*, every ta.* we do not
                   implement, and every strategy.* beyond the five above.
     Each refusal becomes a commented-out line plus a note naming the line.
     ===================================================================== */

  var PINE = (function () {

    /* The names we can actually emit, taken from the engine itself rather than
       from a second list here that would drift out of step with it. */
    var KNOWN = {};
    (function () {
      var docs = [], i, e, full;
      try { docs = DXS.docs() || []; } catch (x) { docs = []; }
      for (i = 0; i < docs.length; i++) {
        e = docs[i];
        full = (e.ns && e.ns !== "global" && e.ns !== "const" && e.ns !== "series") ? (e.ns + "." + e.name) : e.name;
        KNOWN[full] = 1;
      }
      var extra = ["open", "high", "low", "close", "volume", "hl2", "hlc3", "ohlc4", "hlcc4", "time", "bar_index",
        "na", "nz", "true", "false", "last_bar_index", "study", "strategy", "input", "plot", "plotshape",
        "plotchar", "hline", "fill", "bgcolor", "barcolor", "label", "alertcondition"];
      for (i = 0; i < extra.length; i++) KNOWN[extra[i]] = 1;
    })();

    /* every dotted name a Pine source can carry. The ones whose members are
       enum-like or belong to a refused family are listed in SKIP below. */
    var NS = /\b(ta|math|str|array|color|input|request|strategy|syminfo|timeframe|barstate|chart|ticker|session|matrix|map|label|line|box|table|polyline|linefill|log|runtime|display|shape|location|size|plot|hline|adjustment|barmerge|currency|dayofweek|extend|font|format|order|position|scale|text|xloc|yloc|alert)\.([A-Za-z_][A-Za-z0-9_]*)/g;
    var SKIP = {
      plot: 1, shape: 1, location: 1, size: 1, hline: 1, display: 1, color: 1,
      label: 1, line: 1, box: 1, table: 1, polyline: 1, linefill: 1, matrix: 1, map: 1,
      log: 1, runtime: 1, alert: 1, adjustment: 1, barmerge: 1, currency: 1, dayofweek: 1,
      extend: 1, font: 1, format: 1, order: 1, position: 1, scale: 1, text: 1, xloc: 1,
      yloc: 1, chart: 1, ticker: 1, session: 1
    };

    var PLOT_STYLE = {
      "plot.style_line": "line", "plot.style_stepline": "stepline", "plot.style_histogram": "histogram",
      "plot.style_area": "area", "plot.style_columns": "columns", "plot.style_circles": "circles",
      "plot.style_cross": "cross"
    };
    var PLOT_STYLE_NEAR = {
      "plot.style_linebr": "line", "plot.style_areabr": "area",
      "plot.style_stepline_diamond": "stepline", "plot.style_steplinebr": "stepline"
    };
    var SHAPE = {
      "shape.triangleup": "triangleup", "shape.triangledown": "triangledown", "shape.arrowup": "arrowup",
      "shape.arrowdown": "arrowdown", "shape.circle": "circle", "shape.square": "square",
      "shape.diamond": "diamond", "shape.cross": "cross", "shape.xcross": "xcross", "shape.flag": "flag",
      "shape.labelup": "labelup", "shape.labeldown": "labeldown"
    };
    var LOC = {
      "location.abovebar": "abovebar", "location.belowbar": "belowbar", "location.top": "top",
      "location.bottom": "bottom", "location.absolute": "absolute"
    };
    var SIZE = { "size.auto": "auto", "size.tiny": "tiny", "size.small": "small", "size.normal": "normal", "size.large": "large", "size.huge": "huge" };
    var HLINE = { "hline.style_solid": "solid", "hline.style_dashed": "dashed", "hline.style_dotted": "dotted" };
    /* Pine timeframes, spelled the way request.security() here wants them */
    var TF = {
      "1": "1m", "3": "3m", "5": "5m", "15": "15m", "30": "30m", "60": "1h", "120": "2h", "240": "4h",
      "360": "6h", "720": "12h", "D": "1d", "1D": "1d", "3D": "3d", "W": "1w", "1W": "1w", "M": "1M",
      "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "2h": "2h", "4h": "4h",
      "6h": "6h", "12h": "12h", "1d": "1d", "3d": "3d", "1w": "1w", "1M": "1M"
    };

    /* ------------------------------------------------------ small scanners */

    /* a line's code and its trailing comment, split without cutting a string */
    function splitComment(s) {
      var i = 0, q = 0;
      while (i < s.length) {
        var c = s.charAt(i);
        if (q) { if (c === "\\") { i += 2; continue; } if (c === q) q = 0; i++; continue; }
        if (c === "\"" || c === "'") { q = c; i++; continue; }
        if (c === "/" && s.charAt(i + 1) === "/") return { code: s.slice(0, i), com: s.slice(i) };
        i++;
      }
      return { code: s, com: "" };
    }
    function depthOf(s) {
      var i = 0, q = 0, dep = 0;
      while (i < s.length) {
        var c = s.charAt(i);
        if (q) { if (c === "\\") { i += 2; continue; } if (c === q) q = 0; i++; continue; }
        if (c === "\"" || c === "'") { q = c; i++; continue; }
        if (c === "(" || c === "[") dep++;
        if (c === ")" || c === "]") dep--;
        i++;
      }
      return dep;
    }
    function indentOf(s) { var m = /^[ \t]*/.exec(s); return m ? m[0] : ""; }
    function trim1(s) { var t = String(s).replace(/^\s+|\s+$/g, ""); return t.length > 90 ? t.slice(0, 88) + "…" : t; }
    function note(list, line, kind, msg) { list.push({ line: line, kind: kind, msg: msg }); }

    /* split an argument list on its top-level commas */
    function splitArgs(s) {
      var out = [], dep = 0, q = 0, start = 0, i;
      for (i = 0; i < s.length; i++) {
        var c = s.charAt(i);
        if (q) { if (c === "\\") { i++; continue; } if (c === q) q = 0; continue; }
        if (c === "\"" || c === "'") { q = c; continue; }
        if (c === "(" || c === "[") dep++;
        else if (c === ")" || c === "]") dep--;
        else if (c === "," && dep === 0) { out.push(s.slice(start, i)); start = i + 1; }
      }
      if (s.slice(start).replace(/\s+/g, "") !== "") out.push(s.slice(start));
      return out;
    }

    /* the first call to name() in a code string: pre is everything before the
       name, post everything after the closing bracket */
    function callSpan(code, name) {
      var re = new RegExp("(^|[^A-Za-z0-9_.])" + name.replace(/\./g, "\\.") + "\\s*\\(");
      var m = re.exec(code);
      if (!m) return null;
      var nameAt = m.index + m[1].length;
      var open = m.index + m[0].length - 1;
      var dep = 0, q = 0, i;
      for (i = open; i < code.length; i++) {
        var c = code.charAt(i);
        if (q) { if (c === "\\") { i++; continue; } if (c === q) q = 0; continue; }
        if (c === "\"" || c === "'") { q = c; continue; }
        if (c === "(") dep++;
        else if (c === ")") {
          dep--;
          if (!dep) return { open: open, close: i, args: code.slice(open + 1, i), pre: code.slice(0, nameAt), post: code.slice(i + 1) };
        }
      }
      return null;
    }
    function argName(a) {
      var m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/.exec(a);
      return m ? m[1] : null;
    }
    function argValue(a) {
      var m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)([\s\S]*)$/.exec(a);
      return (m ? m[2] : a).replace(/^\s+|\s+$/g, "");
    }

    /* Rewrite every call to name(). rebuild(args) may hand back a new argument
       list; newName renames the call and "" unwraps it. The dot of the new name
       is parked on  while the loop runs, so the scan cannot find the same
       call again and spin. */
    function replaceCalls(code, name, rebuild, newName) {
      var out = code, guard = 0;
      var nm = (newName === undefined) ? name : newName;
      for (; ;) {
        if (++guard > 64) break;
        var sp = callSpan(out, name);
        if (!sp) break;
        var args = splitArgs(sp.args);
        var fresh = rebuild ? rebuild(args) : null;
        var body = (fresh || args).join(",");
        out = sp.pre + (nm === "" ? "" : nm.replace(/\./g, "")) + "(" + body + ")" + sp.post;
      }
      return out.replace(//g, ".");
    }

    /* keep only the arguments we have a home for, and name the ones dropped */
    function keepArgs(args, allowed, callName, line, notes) {
      var out = [], i, n, positional = 0;
      for (i = 0; i < args.length; i++) {
        n = argName(args[i]);
        if (n === null) {
          if (positional < allowed.length) { out.push(args[i]); positional++; continue; }
          note(notes, line, "approximated", callName + " was given more positional arguments than this engine takes; the extra ones were dropped");
          continue;
        }
        if (allowed.indexOf(n) >= 0) { out.push(args[i]); continue; }
        note(notes, line, "approximated", callName + " argument \"" + n + "\" has no equivalent here and was dropped");
      }
      return out;
    }
    function trimCall(code, name, allowed, line, notes) {
      if (code.indexOf(name) < 0) return code;
      var sp = callSpan(code, name);
      if (!sp) return code;
      var args = keepArgs(splitArgs(sp.args), allowed, name + "()", line, notes);
      return code.slice(0, sp.open + 1) + args.join(",") + code.slice(sp.close);
    }

    /* ------------------------------------------------------ the two passes */

    /* The renames that are pure, and that have to happen BEFORE anything is
       judged: a line holding array.new<float> or ta.tr is not unsupported, it
       is spelled differently, and the membership check has to see the new
       spelling or it refuses a line it could have carried. */
    function preNames(s) {
      return String(s)
        .replace(/\barray\.new<\s*(float|int|bool|string)\s*>/g, function (all, ty) { return "array.new_" + ty; })
        .replace(/\bta\.tr\b(?!\s*\()/g, "ta.tr()")
        .replace(/\bta\.vwap\b(?!\s*\()/g, "ta.vwap(hlc3)")
        .replace(/\bsyminfo\.tickerid\b/g, "syminfo.ticker")
        .replace(/\bstrategy\.long\b/g, "\"long\"")
        .replace(/\bstrategy\.short\b/g, "\"short\"");
    }

    /* everything else, with a note for each move that is not exact */
    function rewriteExpr(code, line, notes) {
      var out = code;

      /* a bare hex colour becomes the quoted form this engine's colour reader takes */
      out = out.replace(/(^|[^\w"'#])#([0-9a-fA-F]{6})\b/g, function (all, pre, hex) { return pre + "\"#" + hex.toUpperCase() + "\""; });

      out = out.replace(/\bplot\.style_[a-z_]+/g, function (m) {
        if (PLOT_STYLE[m]) return "\"" + PLOT_STYLE[m] + "\"";
        if (PLOT_STYLE_NEAR[m]) {
          note(notes, line, "approximated", m + " has no exact match here; drawn as \"" + PLOT_STYLE_NEAR[m] + "\"");
          return "\"" + PLOT_STYLE_NEAR[m] + "\"";
        }
        note(notes, line, "approximated", m + " is not a plot style this engine knows; drawn as a line");
        return "\"line\"";
      });
      out = out.replace(/\bshape\.[a-z_]+/g, function (m) {
        if (SHAPE[m]) return "\"" + SHAPE[m] + "\"";
        note(notes, line, "approximated", m + " is not a shape this engine draws; drawn as a circle");
        return "\"circle\"";
      });
      out = out.replace(/\blocation\.[a-z_]+/g, function (m) {
        if (LOC[m]) return "\"" + LOC[m] + "\"";
        note(notes, line, "approximated", m + " is not a location this engine knows; placed above the bar");
        return "\"abovebar\"";
      });
      out = out.replace(/\bsize\.[a-z_]+/g, function (m) { return SIZE[m] ? "\"" + SIZE[m] + "\"" : "\"normal\""; });
      out = out.replace(/\bhline\.style_[a-z_]+/g, function (m) {
        if (HLINE[m]) return "\"" + HLINE[m] + "\"";
        note(notes, line, "approximated", m + " is not a line style here; drawn solid");
        return "\"solid\"";
      });

      /* Pine's transparency runs 0-100 and this engine's runs 0-1 */
      out = replaceCalls(out, "color.new", function (args) {
        if (args.length < 2) return null;
        var t = argValue(args[1]), n = parseFloat(t);
        if (isFinite(n) && String(n) === t) {
          note(notes, line, "approximated", "color.new transparency " + t + " (Pine counts 0-100) became " + (n / 100) + " (this engine counts 0-1)");
          return [args[0], " " + (n / 100)];
        }
        note(notes, line, "approximated", "color.new was given a computed transparency; Pine counts 0-100 and this engine counts 0-1, so divide it by 100 yourself");
        return null;
      });
      out = replaceCalls(out, "color.rgb", function (args) {
        if (args.length < 4) return null;
        var t = argValue(args[3]), n = parseFloat(t);
        if (isFinite(n) && String(n) === t) {
          note(notes, line, "approximated", "color.rgb transparency " + t + " became " + (n / 100));
          return [args[0], args[1], args[2], " " + (n / 100)];
        }
        return null;
      });

      /* the named colours. Every one Pine ships has a home here; anything else
         under color. was refused before this ran. */
      out = out.replace(/\bcolor\.([a-z][a-z_]*)\b/g, function (all, nm) {
        if (KNOWN["color." + nm] || nm === "new" || nm === "rgb") return all;
        note(notes, line, "approximated", "color." + nm + " is not one of this engine's colours; using gray");
        return "color.gray";
      });

      /* the casts. Neither is a function here, so both are named as guesses. */
      out = replaceCalls(out, "int", function () {
        note(notes, line, "approximated", "int(x) became math.round(x) — this language has no cast");
        return null;
      }, "math.round");
      out = replaceCalls(out, "float", function () {
        note(notes, line, "approximated", "float(x) was unwrapped — every number here is already a float");
        return null;
      }, "");

      return out;
    }

    /* ------------------------------------------------ the unsupported table */
    var REFUSE = [
      [/\b(label|line|box|table|polyline|linefill)\s*\.\s*[A-Za-z_]/, "the drawing-object API (label/line/box/table) has no equivalent here — this engine draws through plot, plotshape and label(series, text)"],
      [/\bmatrix\s*\.\s*[A-Za-z_]/, "matrix.* is not implemented"],
      [/\bmap\s*\.\s*[A-Za-z_]/, "map.* is not implemented"],
      [/^\s*import\s+/, "import brings in a Pine library; there are no libraries here"],
      [/^\s*(method|type)\s+/, "user-defined types and methods are not implemented"],
      [/\bvarip\b/, "varip keeps a value across intrabar updates; this engine runs on closed bars only"],
      [/\bswitch\b/, "switch is not implemented — write it as a chain of if / else if"],
      [/\bfor\s+[A-Za-z_][A-Za-z0-9_]*\s+in\b/, "for…in over a collection is not implemented — write a counted for loop"],
      [/\binput\.(timeframe|symbol|session|price|time|text_area|table|enum)\s*\(/, "this input kind is not implemented"],
      [/\brequest\.(financial|dividends|earnings|splits|quandl|economic|seed|currency_rate)\s*\(/, "this request.* feed is not available here"],
      [/\balert\s*\(/, "alert() fires a broker-side alert; use alertcondition(condition, title, message)"],
      [/\bruntime\.error\s*\(/, "runtime.error() is not implemented"],
      [/\blog\.[a-z]+\s*\(/, "log.* is not implemented"],
      [/\bstr\.format_time\s*\(/, "str.format_time is not implemented"],
      [/\bcolor\.(from_gradient|r|g|b|t)\s*\(/, "this color.* function is not implemented — color.new and color.rgb are what this engine has"],
      [/\bta\.(cog|pivot_point_standard)\s*\(/, "this ta.* function is not implemented here"],
      [/=\s*if\b/, "Pine's if returns a value; this language's if is a statement — assign inside the branches instead"],
      [/\bstrategy\.(cancel|cancel_all|risk|convert_to_account|convert_to_symbol|closedtrades|opentrades\s*\.|default_entry_qty|account_currency|margin_liquidation_price|max_contracts_held|netprofit|openprofit|grossprofit|grossloss|wintrades|losstrades|position_avg_price|position_entry_name|initial_capital)\b/, "this strategy.* member is not implemented — the strategy surface here is entry, order, close, close_all and exit"]
    ];

    /* ta.* we do not have is the largest single family, so it is checked
       against the engine's own table rather than listed by hand here. */
    function unknownNamespaced(code) {
      var m, out = null;
      NS.lastIndex = 0;
      while ((m = NS.exec(code))) {
        var ns = m[1], full = ns + "." + m[2];
        if (SKIP[ns]) continue;
        if (KNOWN[full]) continue;
        out = full;
        break;
      }
      NS.lastIndex = 0;
      return out;
    }

    /* ------------------------------------------------------ the declaration */
    function declLine(code, isStrategy, line, notes) {
      var which = isStrategy ? "strategy" : (/\bindicator\s*\(/.test(code) ? "indicator" : "study");
      var sp = callSpan(code, which);
      if (!sp) return null;
      var args = splitArgs(sp.args), i, n, v, pos = 0;
      var POSITIONAL = ["title", "shorttitle", "overlay"];
      var MAP = isStrategy
        ? {
          overlay: "overlay", precision: "precision", pyramiding: "pyramiding",
          initial_capital: "initial_capital", slippage: "slippage",
          default_qty_value: "default_qty", commission_value: "commission",
          title: "title", shorttitle: "shorttitle"
        }
        : { overlay: "overlay", precision: "precision", title: "title", shorttitle: "shorttitle" };
      var got = {};
      for (i = 0; i < args.length; i++) {
        n = argName(args[i]);
        v = argValue(args[i]);
        if (n === null) {
          if (pos < POSITIONAL.length) { got[POSITIONAL[pos]] = v; pos++; continue; }
          note(notes, line, "approximated", "positional argument " + (pos + 1) + " of the declaration has no equivalent here and was dropped");
          pos++;
          continue;
        }
        if (has(MAP, n)) { got[MAP[n]] = v; continue; }
        note(notes, line, "approximated", "declaration argument \"" + n + "\" has no equivalent here and was dropped");
      }
      var order = isStrategy
        ? ["shorttitle", "overlay", "precision", "initial_capital", "commission", "slippage", "pyramiding", "default_qty"]
        : ["shorttitle", "overlay", "precision"];
      var parts = [has(got, "title") ? got.title : "\"Converted script\""];
      for (i = 0; i < order.length; i++) if (has(got, order[i])) parts.push(order[i] + "=" + got[order[i]]);
      return (isStrategy ? "strategy(" : "study(") + parts.join(", ") + ")";
    }

    /* --------------------------------------------------------- the convert */

    /* an assignment whose right-hand side is going away keeps its name bound
       to na, so the lines below it still compile */
    function stub(ind, bare) {
      var m = /^([A-Za-z_][A-Za-z0-9_]*)\s*(:?=)(?!=)/.exec(bare);
      if (m) return ind + m[1] + " " + m[2] + " na";
      /* inside a block a statement has to remain, or the block is empty and
         the parser is right to complain about it */
      return ind.length ? ind + "na" : null;
    }

    function convert(pineSource) {
      var notes = [], out = [];
      var res = { ok: false, source: "", notes: notes };
      if (typeof pineSource !== "string" || !pineSource.replace(/\s+/g, "").length) {
        note(notes, 0, "unsupported", "there is nothing to convert");
        res.source = "study(\"Converted script\", overlay=true)\nplot(close, \"Close\")\n";
        res.ok = false;
        return res;
      }
      try {
        var raw = pineSource.split(/\r?\n/);
        /* join the continuation lines a wrapped call spreads over */
        var lines = [], i, buf = null, bufLine = 0;
        for (i = 0; i < raw.length; i++) {
          if (buf === null) { buf = raw[i]; bufLine = i + 1; }
          else buf = buf + " " + raw[i].replace(/^[ \t]+/, "");
          if (depthOf(splitComment(buf).code) > 0 && i + 1 < raw.length) continue;
          lines.push({ n: bufLine, s: buf });
          buf = null;
        }
        if (buf !== null) lines.push({ n: bufLine, s: buf });

        var sawDecl = false, plotIdx = 0, plotName = {}, hlineName = {}, st;
        for (i = 0; i < lines.length; i++) {
          var ln = lines[i].n, text = lines[i].s;
          var ind = indentOf(text);
          var sp = splitComment(text);
          var com = sp.com;
          var bare = sp.code.replace(/^[ \t]+/, "").replace(/\s+$/, "");

          if (!bare.length) { out.push(com ? ind + com : ""); continue; }

          if (/^\/\/@version\s*=/.test(bare)) {
            out.push("//@version=1   // converted from Pine " + (/(\d+)/.exec(bare) || [, "?"])[1]);
            note(notes, ln, "translated", "the version pragma became this engine's own");
            continue;
          }

          var pre0 = preNames(bare);

          /* a refusal: the line is kept as a comment and the block stays valid */
          var refuse = null, r;
          for (r = 0; r < REFUSE.length; r++) if (REFUSE[r][0].test(pre0)) { refuse = REFUSE[r][1]; break; }
          if (!refuse) {
            var unk = unknownNamespaced(pre0);
            if (unk) refuse = unk + " is not implemented in DexScript";
          }
          if (refuse) {
            note(notes, ln, "unsupported", refuse + " — line " + ln + " was commented out: " + trim1(bare));
            out.push(ind + "// [unsupported] " + bare);
            st = stub(ind, bare);
            if (st) out.push(st);
            continue;
          }

          /* the declaration */
          if (!sawDecl && /^(indicator|study|strategy)\s*\(/.test(pre0)) {
            var isStrat = /^strategy\s*\(/.test(pre0);
            var decl = declLine(pre0, isStrat, ln, notes);
            if (decl) {
              out.push(decl + (com ? "   " + com : ""));
              note(notes, ln, "translated", (isStrat ? "strategy()" : "indicator()") + " became this engine's " + (isStrat ? "strategy()" : "study()"));
              sawDecl = true;
              continue;
            }
          }

          var work = pre0;

          /* request.security: this symbol only, and a timeframe we can name */
          if (/\brequest\.security\s*\(/.test(work)) {
            var rs = callSpan(work, "request.security");
            if (rs) {
              var ra = splitArgs(rs.args);
              var sym = argValue(ra[0] || "");
              if (!/^(syminfo\.ticker|""|'')$/.test(sym)) {
                note(notes, ln, "unsupported", "request.security() on " + trim1(sym) + " asks for a second symbol; only the series on screen is loaded, so line " + ln + " was commented out");
                out.push(ind + "// [unsupported] " + bare);
                st = stub(ind, bare);
                if (st) out.push(st);
                continue;
              }
              var tfRaw = argValue(ra[1] || "").replace(/^["']|["']$/g, "");
              if (!has(TF, tfRaw)) {
                note(notes, ln, "unsupported", "\"" + tfRaw + "\" is not a timeframe this engine knows, so line " + ln + " was commented out");
                out.push(ind + "// [unsupported] " + bare);
                st = stub(ind, bare);
                if (st) out.push(st);
                continue;
              }
              if (TF[tfRaw] !== tfRaw) note(notes, ln, "approximated", "the timeframe \"" + tfRaw + "\" was rewritten as \"" + TF[tfRaw] + "\"");
              work = work.slice(0, rs.open + 1) + "syminfo.ticker, \"" + TF[tfRaw] + "\"," + ra.slice(2).join(",") + work.slice(rs.close);
            }
          }

          work = rewriteExpr(work, ln, notes);

          /* a named plot becomes a positional one, because fill() names plots
             by the order they were written in rather than by a handle */
          var pm = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(plot|hline)\s*\(/.exec(work);
          if (pm) {
            if (pm[2] === "plot") {
              plotName[pm[1]] = plotIdx;
              note(notes, ln, "translated", "the plot handle \"" + pm[1] + "\" became plot number " + plotIdx + ", which is how fill() names a plot here");
              plotIdx++;
            } else {
              hlineName[pm[1]] = 1;
              note(notes, ln, "approximated", "an hline has no handle here, so \"" + pm[1] + "\" was dropped");
            }
            work = work.slice(pm[1].length).replace(/^\s*=\s*/, "");
          } else if (/^plot\s*\(/.test(work)) {
            plotIdx++;
          }

          /* the drawing and order calls: keep what we have a home for */
          work = trimCall(work, "plotshape", ["series", "title", "style", "location", "color", "text", "size"], ln, notes);
          work = trimCall(work, "plotchar", ["series", "title", "char", "location", "color"], ln, notes);
          if (/^plot\s*\(/.test(work)) work = trimCall(work, "plot", ["series", "title", "color", "linewidth", "style"], ln, notes);
          work = trimCall(work, "hline", ["price", "title", "color", "linestyle", "linewidth"], ln, notes);
          work = trimCall(work, "bgcolor", ["color", "transp"], ln, notes);
          work = trimCall(work, "barcolor", ["color"], ln, notes);
          work = trimCall(work, "alertcondition", ["condition", "title", "message"], ln, notes);
          work = trimCall(work, "strategy.entry", ["id", "direction", "qty", "limit", "stop"], ln, notes);
          work = trimCall(work, "strategy.order", ["id", "direction", "qty", "limit", "stop"], ln, notes);
          work = trimCall(work, "strategy.exit", ["id", "from_entry", "profit", "loss", "trail_points"], ln, notes);
          work = trimCall(work, "strategy.close", ["id"], ln, notes);

          /* fill(p1, p2, …) where p1 and p2 were plot handles */
          if (/^fill\s*\(/.test(work)) {
            var fs = callSpan(work, "fill");
            if (fs) {
              var fa = splitArgs(fs.args);
              var a0 = argValue(fa[0] || ""), a1 = argValue(fa[1] || "");
              if (has(hlineName, a0) || has(hlineName, a1)) {
                note(notes, ln, "unsupported", "fill() between two hlines is not implemented, so line " + ln + " was commented out");
                out.push(ind + "// [unsupported] " + bare);
                st = stub(ind, bare);
                if (st) out.push(st);
                continue;
              }
              if (has(plotName, a0)) fa[0] = " " + plotName[a0];
              if (has(plotName, a1)) fa[1] = " " + plotName[a1];
              fa = keepArgs(fa, ["plot1", "plot2", "color", "transp"], "fill()", ln, notes);
              work = "fill(" + fa.join(",") + ")";
            }
          }

          out.push(ind + work + (com ? "   " + com : ""));
          note(notes, ln, "translated", trim1(bare));
        }

        if (!sawDecl) {
          out.unshift("study(\"Converted script\", overlay=true, precision=2)");
          note(notes, 1, "approximated", "this source declared no indicator() or strategy(), so a study() line was added");
        }
        out.unshift("//@version=1   // converted by DXSPINE — a Pine SUBSET translator, not a Pine runtime");

        var text2 = out.join("\n") + "\n";
        var c = DXS.compile(text2);
        if (!c.ok) text2 = salvage(out, notes);
        res.source = text2;
        res.ok = DXS.compile(res.source).ok;
        return res;
      } catch (e) {
        fault("pine", e);
        note(notes, 0, "unsupported", "the converter tripped over this source: " + ((e && e.message) || e));
        res.source = "study(\"Converted script\", overlay=true)\nplot(close, \"Close\")\n";
        res.ok = false;
        return res;
      }
    }

    /* The promise is that the output compiles. When a rewrite has left
       something this language cannot read, the line the compiler names is
       commented out and the attempt is made again — every removal is a note,
       so nothing disappears quietly. */
    function salvage(lines, notes) {
      var work = lines.slice(), guard = 0;
      for (; ;) {
        if (++guard > 120) break;
        var text = work.join("\n") + "\n";
        var c = DXS.compile(text);
        if (c.ok) return text;
        var at = (c.errors[0] && c.errors[0].line) || 0;
        var idx = at - 1;
        if (idx < 0 || idx >= work.length) break;
        if (/^\s*\/\//.test(work[idx]) || !work[idx].replace(/\s+/g, "").length) break;
        note(notes, at, "unsupported", "this line did not survive the conversion and was commented out: " + trim1(work[idx]) + " (" + c.errors[0].msg + ")");
        var ind = indentOf(work[idx]);
        /* A placeholder only belongs where the removed line was the FIRST
           statement of a block; anywhere else it is a fresh indentation error,
           and one of those would send this loop round for ever putting a new
           one in for the last one it took out. */
        var st = opensBlockBefore(work, idx) ? stub(ind, work[idx].replace(/^[ \t]+/, "")) : null;
        work[idx] = ind + "// [unsupported] " + work[idx].replace(/^[ \t]+/, "");
        if (st) work.splice(idx + 1, 0, st);
      }
      note(notes, 0, "unsupported", "this source could not be turned into a script that compiles, so what follows is the original, commented out under a placeholder study");
      return "study(\"Converted script\", overlay=true, precision=2)\nplot(close, \"Close\")\n" + commentAll(lines);
    }
    /* true when the line above idx (skipping blanks and comments) opens a
       block that this line is the body of */
    function opensBlockBefore(work, idx) {
      var j = idx - 1;
      while (j >= 0 && (/^\s*\/\//.test(work[j]) || !work[j].replace(/\s+/g, "").length)) j--;
      if (j < 0) return false;
      var prev = work[j].replace(/^[ \t]+/, "");
      if (indentOf(work[j]).length >= indentOf(work[idx]).length) return false;
      return /^(if|else|for|while)\b/.test(prev);
    }
    function commentAll(lines) {
      var out = [], i;
      for (i = 0; i < lines.length; i++) out.push("// " + String(lines[i]).replace(/^[ \t]+/, ""));
      return out.join("\n") + "\n";
    }

    return {
      __v: 165,
      convert: convert,
      /* the same three lists the dialog prints, so nothing here claims more
         than the table at the top of this section does */
      capabilities: function () {
        return {
          translated: ["//@version", "indicator() / study() / strategy()",
            "input.int / float / bool / string / source / color",
            "ta.* math.* str.* array.* that this engine implements",
            "plot / plotshape / plotchar / hline / fill / bgcolor / barcolor",
            "colour literals, color.new, color.rgb and the named colours",
            ":= and var and typed declarations",
            "if / else if / else, for, while, ternaries, and / or / not",
            "the history operator x[n]", "comments",
            "strategy.entry / order / close / close_all / exit", "alertcondition"],
          approximated: ["transparency (Pine counts 0-100, this engine counts 0-1)",
            "plot styles with no exact match, such as linebr and areabr",
            "int() and float() casts",
            "arguments with no home here — they are dropped and named",
            "request.security timeframes spelled the Pine way",
            "a plot handle, which becomes the plot's number"],
          unsupported: ["request.security on another symbol",
            "label.new / line.new / box.new / table.new and the whole object API",
            "matrix.* and map.*", "import and libraries", "method and user-defined types",
            "varip", "switch", "for … in",
            "input.timeframe / symbol / session / price / time",
            "alert(), runtime.error(), log.*",
            "every ta.* this engine does not implement",
            "strategy.* beyond entry, order, close, close_all and exit"]
        };
      }
    };
  })();


  /* =====================================================================
     6 · THE HIGHLIGHTER
     DXS.tokens() reports the spans it knows about; the whitespace between
     them is not a token and still has to be drawn, or the two layers stop
     agreeing on where a character sits. segments() therefore returns a
     COMPLETE cover of the source: every byte belongs to exactly one run.
     ===================================================================== */

  var CLS = {
    kw: "dxs-kw", num: "dxs-num", str: "dxs-str", com: "dxs-com",
    fn: "dxs-fn", id: "dxs-id", op: "dxs-op", punc: "dxs-punc", gap: "dxs-gap"
  };

  function segments(src) {
    var out = [], toks = [], i, at = 0;
    var s = String(src == null ? "" : src);
    try { toks = DXS.tokens(s) || []; } catch (e) { fault("tokens", e); toks = []; }
    for (i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (!t || typeof t.s !== "number" || typeof t.e !== "number") continue;
      var a = t.s < at ? at : t.s;
      var b = t.e > s.length ? s.length : t.e;
      if (b <= a) continue;
      if (a > at) out.push({ k: "gap", s: at, e: a });
      out.push({ k: has(CLS, t.k) ? t.k : "id", s: a, e: b });
      at = b;
    }
    if (at < s.length) out.push({ k: "gap", s: at, e: s.length });
    return out;
  }

  function paintHighlight(pre, src) {
    clear(pre);
    var s = String(src == null ? "" : src);
    /* a trailing newline keeps the last line on screen when the caret is on it */
    var segs = segments(s), i;
    for (i = 0; i < segs.length; i++) {
      pre.appendChild(el("span", CLS[segs[i].k] || CLS.id, s.slice(segs[i].s, segs[i].e)));
    }
    pre.appendChild(el("span", CLS.gap, "\n"));
  }

  /* =====================================================================
     7 · THE EDITOR
     ===================================================================== */

  var ED = null;   /* the open editor's nodes and state, or null */

  function lineCount(s) { return String(s).split("\n").length; }

  function limitHit(r) {
    var i, m;
    if (!r || !r.errors) return null;
    for (i = 0; i < r.errors.length; i++) {
      m = String(r.errors[i].msg || "");
      if (/budget|at most|more than|history slots/.test(m)) return m;
    }
    return null;
  }

  function openEditor(ref) {
    try {
      styles();
      var body = modal("DexScript editor", true);
      var src = "", title = "Untitled script", refNow = null;
      if (ref) {
        var got = sourceOf(ref);
        if (got != null) { src = got; title = titleOf(ref); refNow = ref; }
      }
      if (!src) {
        src = (DXS.PRELUDE && DXS.PRELUDE[0]) ? DXS.PRELUDE[0].src : "study(\"New script\", overlay=true)\nplot(close, \"Close\")\n";
        title = "New script";
      }

      ED = { ref: refNow, params: {}, compiled: null, run: null, helpOpen: false };

      /* the toolbar */
      var bar = el("div", "dxc-row");
      bar.appendChild(btn("dxc-go", "Run", "Compile this script and put it on the chart", { "data-dxs": "run" }));
      bar.appendChild(btn("dxc-b", "Save", "Save it to your scripts", { "data-dxs": "save" }));
      bar.appendChild(btn("dxc-b", "Save as", "Save it as a new script", { "data-dxs": "saveas" }));
      bar.appendChild(btn("dxc-b", "Revert", "Go back to the saved text", { "data-dxs": "revert" }));
      bar.appendChild(btn("dxc-b", "Delete", "Delete this saved script", { "data-dxs": "delete" }));
      bar.appendChild(btn("dxc-b", "Templates", "Start from one of the built-in templates", { "data-dxs": "templates" }));
      bar.appendChild(btn("dxc-b", "Paste Pine", "Convert a Pine v5 study into DexScript", { "data-dxs": "pine" }));
      bar.appendChild(btn("dxc-b", "Library", "Browse the shipped scripts and your own", { "data-dxs": "library" }));
      bar.appendChild(btn("dxc-b", "Export", "Save this script as a .dexs file", { "data-dxs": "export-one" }));
      body.appendChild(bar);

      var nameIn = el("input", "dxc-in wide", null, { type: "text", id: "dxsName", placeholder: "Script name" });
      nameIn.value = title;
      body.appendChild(nameIn);

      /* the plate */
      var ed = el("div", "dxs-ed");
      var gut = el("div", "dxs-gut", null, { id: "dxsGut", "aria-hidden": "true" });
      var wrap = el("div", "dxs-wrap");
      var pre = el("pre", "dxs-hi", null, { id: "dxsHi", "aria-hidden": "true" });
      var ta = el("textarea", "dxs-ta", null, {
        id: "dxsSrc", spellcheck: "false", autocomplete: "off", autocapitalize: "off",
        autocorrect: "off", wrap: "off", "aria-label": "Script source"
      });
      ta.value = src;
      wrap.appendChild(pre);
      wrap.appendChild(ta);
      ed.appendChild(gut);
      ed.appendChild(wrap);
      body.appendChild(ed);

      var stat = el("div", "dxs-stat", null, { id: "dxsStat", role: "status" });
      body.appendChild(stat);

      var inputsPanel = panel("Inputs", "dxsInputs", "inputs");
      body.appendChild(inputsPanel.root);
      var resPanel = panel("Backtest", "dxsRes", "results");
      body.appendChild(resPanel.root);
      var helpPanel = panel("Reference", "dxsHelp", "help");
      body.appendChild(helpPanel.root);
      var docQ = el("input", "dxc-in wide", null, { type: "search", id: "dxsDocQ", placeholder: "Search the reference\u2026" });
      helpPanel.body.appendChild(docQ);
      var docList = el("div", null, null, { id: "dxsDocList" });
      helpPanel.body.appendChild(docList);
      docQ.addEventListener("input", function () { buildHelp(docQ.value); });

      ED.ta = ta; ED.pre = pre; ED.gut = gut; ED.stat = stat; ED.name = nameIn;
      ED.inputs = inputsPanel.body; ED.res = resPanel.body; ED.help = docList;
      ED.inputsHead = inputsPanel.count; ED.resHead = resPanel.count; ED.helpHead = helpPanel.count;

      /* the two layers are tied together rather than guessed at */
      ta.addEventListener("scroll", function () {
        try { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; gut.scrollTop = ta.scrollTop; } catch (e) { }
      });
      ta.addEventListener("input", function () { schedule(); });
      ta.addEventListener("keydown", function (e) {
        /* Tab indents rather than leaving the field, which is the one thing a
           code editor may take from the browser's focus order. Shift+Tab and
           Escape both hand it straight back. */
        if (e.key !== "Tab" || e.shiftKey) return;
        try {
          e.preventDefault();
          var a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
          ta.value = v.slice(0, a) + "    " + v.slice(b);
          ta.selectionStart = ta.selectionEnd = a + 4;
          schedule();
        } catch (x) { fault("tab", x); }
      });

      buildHelp("");
      refresh(true);
      try { ta.focus(); } catch (e2) { }
      return true;
    } catch (e) { fault("openEditor", e); return false; }
  }

  function panel(title, id, kind) {
    var root = el("div", "dxs-panel");
    var head = btn("dxs-ph", null, title, { "data-dxs": "panel", "data-panel": kind, "aria-expanded": "true" });
    head.appendChild(el("span", null, title));
    var cnt = el("span", "cnt", "");
    head.appendChild(cnt);
    root.appendChild(head);
    var b = el("div", "dxs-pb", null, { id: id });
    root.appendChild(b);
    return { root: root, body: b, count: cnt, head: head };
  }

  var timer = null;
  function schedule() {
    if (!ED) return;
    try { if (timer) W.clearTimeout(timer); } catch (e) { }
    try { timer = W.setTimeout(function () { timer = null; refresh(false); }, 220); }
    catch (e2) { refresh(false); }
  }

  /* One pass: highlight, gutter, compile, status, inputs, and a run when the
     script compiled. Everything the editor shows comes out of this. */
  function refresh(runIt) {
    if (!ED || !ED.ta) return;
    try {
      var src = ED.ta.value;
      paintHighlight(ED.pre, src);
      var c = DXS.compile(src);
      ED.compiled = c;
      var marks = DXS.lint(src) || [];
      paintGutter(src, marks);
      if (c.ok) buildInputs(c.meta);
      else clear(ED.inputs);
      var r = null;
      if (c.ok) {
        var bars = [];
        try { bars = K.barsOf() || []; } catch (e) { bars = []; }
        if (bars.length) r = DXS.run(c.prog, bars, ED.params, {});
      }
      ED.run = r;
      paintStatus(c, r, marks);
      buildResults(c, r);
      if (runIt) { /* the first pass only paints; Run is an explicit button */ }
    } catch (e) { fault("refresh", e); }
  }

  function paintGutter(src, marks) {
    var n = lineCount(src), i, byLine = {};
    for (i = 0; i < marks.length; i++) {
      var m = marks[i];
      if (!m.line || m.line > n) continue;
      if (byLine[m.line] && byLine[m.line].severity === "error") continue;
      byLine[m.line] = m;
    }
    clear(ED.gut);
    for (i = 1; i <= n; i++) {
      var mk = byLine[i];
      var node = el("i", mk ? (mk.severity === "error" ? "bad" : "warn") : null, String(i));
      if (mk) node.title = mk.msg;
      ED.gut.appendChild(node);
    }
  }

  function paintStatus(c, r, marks) {
    clear(ED.stat);
    var warns = 0, i;
    for (i = 0; i < marks.length; i++) if (marks[i].severity === "warning") warns++;
    if (!c.ok) {
      var e0 = c.errors[0] || { line: 0, msg: "this script did not compile" };
      ED.stat.appendChild(el("span", "bad", "Line " + e0.line + (e0.col ? ":" + e0.col : "") + " — " + e0.msg));
      return;
    }
    ED.stat.appendChild(el("span", "ok", "Compiled"));
    ED.stat.appendChild(el("span", null, c.meta.kind === "strategy" ? "strategy" : "study"));
    ED.stat.appendChild(el("span", null, c.meta.inputs.length + " input" + (c.meta.inputs.length === 1 ? "" : "s")));
    if (warns) ED.stat.appendChild(el("span", "lim", warns + " warning" + (warns === 1 ? "" : "s")));
    if (r) {
      ED.stat.appendChild(el("span", null, r.rows.length + " row" + (r.rows.length === 1 ? "" : "s")));
      ED.stat.appendChild(el("span", null, r.steps + " steps"));
      ED.stat.appendChild(el("span", null, r.ms + " ms"));
      var lim = limitHit(r);
      if (lim) ED.stat.appendChild(el("span", "lim", "limit: " + lim));
      else if (r.errors.length) ED.stat.appendChild(el("span", "bad", "line " + r.errors[0].line + ": " + r.errors[0].msg));
    } else {
      ED.stat.appendChild(el("span", null, "no bars loaded yet"));
    }
  }

  /* --------------------------------------------------------- inputs panel */
  function buildInputs(meta) {
    clear(ED.inputs);
    var recs = meta.inputs || [], i;
    ED.inputsHead.textContent = recs.length ? String(recs.length) : "none";
    if (!recs.length) {
      ED.inputs.appendChild(el("div", "dxc-empty", "This script declares no inputs."));
      return;
    }
    for (i = 0; i < recs.length; i++) {
      var rec = recs[i], node;
      var cur = has(ED.params, rec.k) ? ED.params[rec.k] : rec.d;
      if (rec.type === "bool") {
        node = checkbox(cur === true || cur === "on" || cur === "true");
        node.setAttribute("data-dxs-in", rec.k);
        node.setAttribute("data-kind", "bool");
      } else if (rec.type === "string" || rec.type === "source" || rec.type === "color") {
        var opts = (rec.opts && rec.opts.length) ? rec.opts : [rec.d];
        node = select(opts, String(cur));
        node.setAttribute("data-dxs-in", rec.k);
        node.setAttribute("data-kind", rec.type);
      } else {
        node = inputNum(cur, String(rec.step == null ? 1 : rec.step));
        node.setAttribute("data-dxs-in", rec.k);
        node.setAttribute("data-kind", rec.type);
        if (rec.min != null) node.setAttribute("min", String(rec.min));
        if (rec.max != null) node.setAttribute("max", String(rec.max));
      }
      node.addEventListener("change", onInputChange);
      fieldRow(ED.inputs, rec.l, node);
    }
  }
  function onInputChange(e) {
    if (!ED) return;
    try {
      var n = e.target, k = n.getAttribute("data-dxs-in"), kind = n.getAttribute("data-kind");
      if (!k) return;
      if (kind === "bool") ED.params[k] = !!n.checked;
      else if (kind === "int" || kind === "float") ED.params[k] = parseFloat(n.value);
      else ED.params[k] = n.value;
      refresh(false);
      /* an instance already on the chart takes the same values, so the panel
         and the chart never disagree about what was run */
      applyParamsToChart();
    } catch (x) { fault("inputChange", x); }
  }
  function applyParamsToChart() {
    if (!ED || !ED.ref) return;
    try {
      var regId = regIdOf(ED.ref), key = "dxs:" + regId;
      var store = paramStore();
      store[regId] = ED.params;
      LS.set(K_PARAM, store);
      var live = DXC.studies(), i, k;
      for (i = 0; i < live.length; i++) {
        if (live[i].k !== key) continue;
        live[i].p = live[i].p || {};
        for (k in ED.params) if (has(ED.params, k)) live[i].p[k] = ED.params[k];
      }
      K.mark();
    } catch (e) { fault("applyParams", e); }
  }

  /* -------------------------------------------------------- results panel */
  function buildResults(c, r) {
    clear(ED.res);
    if (!c.ok || c.meta.kind !== "strategy") {
      ED.resHead.textContent = "study";
      ED.res.appendChild(el("div", "dxc-empty", "Only a strategy() script has a backtest. This one is a study."));
      return;
    }
    if (!r || !r.strategy) {
      ED.resHead.textContent = "no bars";
      ED.res.appendChild(el("div", "dxc-empty", "There are no bars loaded to run the backtest over."));
      return;
    }
    var S = r.strategy, st = S.stats;
    ED.resHead.textContent = st.trades + " trade" + (st.trades === 1 ? "" : "s");

    var rows = [
      ["Net profit", fmtN(st.netProfit), st.netProfit],
      ["Return", fmtN(st.returnPct) + " %", st.returnPct],
      ["Trades", String(st.trades), 0],
      ["Win rate", fmtN(st.winRate, 1) + " %", 0],
      ["Profit factor", st.profitFactor == null ? "—" : fmtN(st.profitFactor), 0],
      ["Average win", fmtN(st.avgWin), st.avgWin],
      ["Average loss", fmtN(st.avgLoss), -st.avgLoss],
      ["Largest win", fmtN(st.largestWin), st.largestWin],
      ["Largest loss", fmtN(st.largestLoss), -st.largestLoss],
      ["Max drawdown", fmtN(st.maxDrawdown) + " (" + fmtN(st.maxDrawdownPct, 1) + " %)", -st.maxDrawdown],
      ["Sharpe", fmtN(st.sharpe), st.sharpe],
      ["Fees paid", fmtN(st.fees), -st.fees],
      ["Starting capital", fmtN(st.initialCapital), 0],
      ["Final equity", fmtN(st.finalEquity), st.finalEquity - st.initialCapital],
      ["Open at the end", String(st.openAtEnd), 0]
    ];
    var tab = el("table", "dxs-tab");
    var i;
    for (i = 0; i < rows.length; i++) {
      var tr = el("tr");
      tr.appendChild(el("th", null, rows[i][0]));
      var td = el("td", rows[i][2] > 0 ? "up" : rows[i][2] < 0 ? "dn" : null, rows[i][1]);
      tr.appendChild(td);
      tab.appendChild(tr);
    }
    ED.res.appendChild(tab);

    /* the curve, drawn from S.equity and nothing else */
    var cv = el("canvas", "dxs-eq", null, { "aria-label": "Equity curve" });
    ED.res.appendChild(cv);
    drawEquity(cv, S.equity, st.initialCapital);

    ED.res.appendChild(el("div", "dxc-lg", "Trades"));
    if (!S.trades.length) {
      ED.res.appendChild(el("div", "dxc-empty", "This strategy took no trades over the bars on screen."));
      return;
    }
    var t2 = el("table", "dxs-tab");
    var head = el("tr");
    var cols = ["#", "Side", "In", "Out", "Bars", "P/L", "Why"];
    for (i = 0; i < cols.length; i++) head.appendChild(el("th", null, cols[i]));
    t2.appendChild(head);
    var shown = Math.min(S.trades.length, 200);
    for (i = 0; i < shown; i++) {
      var t = S.trades[i], row = el("tr");
      row.appendChild(el("td", null, String(i + 1)));
      row.appendChild(el("td", t.side === "long" ? "up" : "dn", t.side));
      row.appendChild(el("td", null, fmtN(t.entryPrice)));
      row.appendChild(el("td", null, fmtN(t.exitPrice)));
      row.appendChild(el("td", null, String(t.bars)));
      row.appendChild(el("td", t.pnl > 0 ? "up" : t.pnl < 0 ? "dn" : null, fmtN(t.pnl) + " (" + fmtN(t.pnlPct, 1) + "%)"));
      row.appendChild(el("td", null, t.why || ""));
      t2.appendChild(row);
    }
    ED.res.appendChild(t2);
    if (S.trades.length > shown) ED.res.appendChild(el("div", "dxc-note", "Showing the first " + shown + " of " + S.trades.length + " trades."));
  }

  function drawEquity(cv, eq, base) {
    try {
      var dpr = W.devicePixelRatio || 1;
      var wCss = 560, hCss = 110;
      cv.width = Math.round(wCss * dpr);
      cv.height = Math.round(hCss * dpr);
      var x = cv.getContext("2d");
      if (!x) return;
      var P = K.pal();
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.clearRect(0, 0, wCss, hCss);
      var lo = Infinity, hi = -Infinity, i, v;
      for (i = 0; i < eq.length; i++) { v = eq[i]; if (v == null || !isFinite(v)) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
      if (!isFinite(lo) || !isFinite(hi)) return;
      if (isNum(base)) { if (base < lo) lo = base; if (base > hi) hi = base; }
      var span = (hi - lo) || Math.abs(hi) * 0.02 || 1;
      function py(val) { return hCss - 8 - (val - lo) / span * (hCss - 16); }
      function px(idx) { return eq.length < 2 ? 0 : idx / (eq.length - 1) * (wCss - 2) + 1; }
      /* the starting capital, so the curve is read against something */
      if (isNum(base)) {
        x.strokeStyle = P.grid || "#2A2E39";
        x.lineWidth = 1;
        x.beginPath(); x.moveTo(0, py(base)); x.lineTo(wCss, py(base)); x.stroke();
      }
      var last = null;
      x.strokeStyle = (eq.length && eq[eq.length - 1] != null && isNum(base) && eq[eq.length - 1] >= base) ? "#22D39A" : "#FF5A78";
      x.lineWidth = 1.6;
      x.beginPath();
      for (i = 0; i < eq.length; i++) {
        v = eq[i];
        if (v == null || !isFinite(v)) continue;
        if (last === null) x.moveTo(px(i), py(v)); else x.lineTo(px(i), py(v));
        last = i;
      }
      x.stroke();
    } catch (e) { fault("equity", e); }
  }

  /* ----------------------------------------------------------- help panel
     Every DXS.docs() entry, grouped by namespace and filtered by the search
     field above it. A click drops the name at the caret rather than opening a
     second window to copy it out of. */
  function buildHelp(q) {
    if (!ED || !ED.help) return;
    clear(ED.help);
    var docs = [];
    try { docs = DXS.docs() || []; } catch (e) { docs = []; }
    var needle = String(q || "").toLowerCase();
    var groups = {}, order = [], i, shown = 0;
    for (i = 0; i < docs.length; i++) {
      var e2 = docs[i];
      var hay = (e2.ns + "." + e2.name + " " + e2.sig + " " + e2.about).toLowerCase();
      if (needle && hay.indexOf(needle) < 0) continue;
      if (!groups[e2.ns]) { groups[e2.ns] = []; order.push(e2.ns); }
      groups[e2.ns].push(e2);
      shown++;
    }
    ED.helpHead.textContent = shown + " of " + docs.length;
    for (i = 0; i < order.length; i++) {
      ED.help.appendChild(el("div", "dxc-lg", order[i]));
      var arr = groups[order[i]], j;
      for (j = 0; j < arr.length; j++) {
        var b = btn("dxs-doc", null, "Insert " + arr[j].sig, { "data-dxs": "insert", "data-ins": insertFor(arr[j]) });
        b.appendChild(el("b", null, arr[j].sig));
        b.appendChild(el("span", null, arr[j].about));
        ED.help.appendChild(b);
      }
    }
    if (!shown) ED.help.appendChild(el("div", "dxc-empty", "Nothing in the reference matches that."));
  }
  function insertFor(e) {
    var full = (e.ns && e.ns !== "global" && e.ns !== "const" && e.ns !== "series") ? e.ns + "." + e.name : e.name;
    if (e.sig.indexOf("(") < 0) return full;
    return full + "(";
  }
  function insertAtCaret(text) {
    if (!ED || !ED.ta) return;
    try {
      var ta = ED.ta, a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
      ta.value = v.slice(0, a) + text + v.slice(b);
      ta.selectionStart = ta.selectionEnd = a + text.length;
      ta.focus();
      refresh(false);
    } catch (e) { fault("insert", e); }
  }

  /* --------------------------------------------------------- the templates */
  function openTemplates() {
    var body = modal("Templates");
    var list = DXS.PRELUDE || [], i;
    body.appendChild(el("div", "dxc-note", "Six starting points, one per feature of the language. Each one compiles and draws exactly as written."));
    var box = el("div", "dxc-list");
    for (i = 0; i < list.length; i++) {
      var row = btn("dxc-li", null, "Load " + list[i].name, { "data-dxs": "tpl", "data-i": String(i) });
      row.appendChild(el("span", "nm", list[i].name));
      row.appendChild(el("span", "tg", "template"));
      box.appendChild(row);
      box.appendChild(el("div", "dxc-note", list[i].about));
    }
    body.appendChild(box);
  }

  /* ------------------------------------------------------- the Pine dialog */
  function openPine() {
    styles();
    ED = null;
    var body = modal("Paste Pine", true);
    body.appendChild(el("div", "dxc-note",
      "This is a SUBSET TRANSLATOR, not a Pine runtime. It rewrites the shapes a Pine v5 study is usually written in " +
      "and it refuses the rest in the open: any line it cannot carry is commented out in the result and named below it. " +
      "Read the notes before you trust the output."));
    var caps = PINE.capabilities();
    body.appendChild(capList("Translated", caps.translated, "tr"));
    body.appendChild(capList("Approximated", caps.approximated, "ap"));
    body.appendChild(capList("Refused", caps.unsupported, "un"));
    var ta = el("textarea", "dxc-ta", null, { id: "dxsPine", rows: "10", "aria-label": "Pine source", placeholder: "//@version=5\nindicator(\"My study\", overlay=true)\nplot(ta.ema(close, 20))" });
    body.appendChild(ta);
    var row = el("div", "dxc-row");
    row.appendChild(btn("dxc-go", "Convert", "Translate this Pine into DexScript", { "data-dxs": "pine-go" }));
    row.appendChild(btn("dxc-b", "Cancel", "Close", { "data-dxc": "close" }));
    body.appendChild(row);
    body.appendChild(el("div", null, null, { id: "dxsPineOut" }));
  }
  function capList(title, items, cls) {
    var wrap2 = el("div", "dxs-card");
    wrap2.appendChild(el("h4", null, title));
    var i;
    for (i = 0; i < items.length; i++) {
      var n = el("div", "dxs-note");
      n.appendChild(el("span", "ln " + cls, title.slice(0, 3).toLowerCase()));
      n.appendChild(el("span", null, items[i]));
      wrap2.appendChild(n);
    }
    return wrap2;
  }
  function runPine() {
    try {
      var src = d.getElementById("dxsPine");
      var out = d.getElementById("dxsPineOut");
      if (!src || !out) return;
      var r = PINE.convert(src.value);
      clear(out);
      var c = DXS.compile(r.source);
      var head = el("div", "dxs-stat");
      head.appendChild(el("span", c.ok ? "ok" : "bad", c.ok ? "The converted script compiles" : "The converted script did not compile"));
      var tr = 0, ap = 0, un = 0, i;
      for (i = 0; i < r.notes.length; i++) {
        if (r.notes[i].kind === "translated") tr++;
        else if (r.notes[i].kind === "approximated") ap++;
        else un++;
      }
      head.appendChild(el("span", null, tr + " translated"));
      head.appendChild(el("span", "lim", ap + " approximated"));
      head.appendChild(el("span", "bad", un + " refused"));
      out.appendChild(head);

      var pre = el("pre", "dxs-src", r.source);
      out.appendChild(pre);

      var row = el("div", "dxc-row");
      row.appendChild(btn("dxc-go", "Open in the editor", "Load the converted script into the editor", { "data-dxs": "pine-open" }));
      out.appendChild(row);

      out.appendChild(el("div", "dxc-lg", "Notes"));
      for (i = 0; i < r.notes.length; i++) {
        var n = r.notes[i];
        var node = el("div", "dxs-note");
        node.appendChild(el("span", "ln " + (n.kind === "translated" ? "tr" : n.kind === "approximated" ? "ap" : "un"), "line " + n.line));
        node.appendChild(el("span", null, n.msg));
        out.appendChild(node);
      }
      PENDING_PINE = r.source;
    } catch (e) { fault("runPine", e); }
  }
  var PENDING_PINE = null;

  /* =====================================================================
     8 · THE LIBRARY BROWSER
     ===================================================================== */

  var BROWSE = { q: "", group: "All" };

  function openLibrary() {
    styles();
    ED = null;
    var body = modal("Script library", true);
    var search = el("input", "dxc-in wide", null, { type: "search", id: "dxsLibQ", placeholder: "Search " + (LIB.length + userList().length) + " scripts…" });
    search.value = BROWSE.q;
    body.appendChild(search);

    var chips = el("div", "dxs-chips");
    var groups = ["All", "Mine"].concat(LIB_GROUPS), i;
    for (i = 0; i < groups.length; i++) {
      chips.appendChild(btn("dxs-chip" + (groups[i] === BROWSE.group ? " on" : ""), groups[i], "Show " + groups[i], { "data-dxs": "libgroup", "data-g": groups[i] }));
    }
    body.appendChild(chips);

    var tools = el("div", "dxc-row");
    tools.appendChild(btn("dxc-go", "New script", "Open an empty editor", { "data-dxs": "new" }));
    tools.appendChild(btn("dxc-b", "Export all mine", "Save every script of yours as one .dexs file", { "data-dxs": "export-all" }));
    tools.appendChild(btn("dxc-b", "Import", "Read a .dexs file", { "data-dxs": "import" }));
    body.appendChild(tools);

    var list = el("div", null, null, { id: "dxsLibList" });
    body.appendChild(list);
    renderLibrary();

    search.addEventListener("input", function () { BROWSE.q = search.value; renderLibrary(); });
  }

  function renderLibrary() {
    var list = d.getElementById("dxsLibList");
    if (!list) return;
    clear(list);
    var q = String(BROWSE.q || "").toLowerCase();
    var on = {}, want = onChart(), i;
    for (i = 0; i < want.length; i++) on[refKey(want[i])] = 1;

    var items = [];
    if (BROWSE.group === "All" || BROWSE.group === "Mine") {
      var mine = userList();
      for (i = 0; i < mine.length; i++) {
        items.push({ ref: { src: "user", id: mine[i].id }, title: mine[i].title, about: "", group: "Mine", rec: mine[i] });
      }
    }
    if (BROWSE.group !== "Mine") {
      for (i = 0; i < LIB.length; i++) {
        if (BROWSE.group !== "All" && LIB[i].group !== BROWSE.group) continue;
        items.push({ ref: { src: "lib", id: LIB[i].id }, title: LIB[i].title, about: LIB[i].about, group: LIB[i].group, rec: null });
      }
    }

    var shown = 0;
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      if (q && (it.title + " " + it.about + " " + it.group).toLowerCase().indexOf(q) < 0) continue;
      shown++;
      var card = el("div", "dxs-card");
      var h = el("h4", null, it.title);
      card.appendChild(h);
      if (it.about) card.appendChild(el("p", null, it.about));
      var meta = it.group;
      if (it.rec) meta = "Mine · saved " + stamp(it.rec.created) + " · changed " + stamp(it.rec.modified);
      if (on[refKey(it.ref)]) meta = meta + " · on this chart";
      card.appendChild(el("div", "dxs-meta", meta));

      var row = el("div", "dxc-row");
      var k = refKey(it.ref);
      if (on[k]) row.appendChild(btn("dxc-b", "Remove from chart", "Take it off this market", { "data-dxs": "off", "data-ref": k }));
      else row.appendChild(btn("dxc-go", "Add to chart", "Put it on this market", { "data-dxs": "on", "data-ref": k }));
      row.appendChild(btn("dxc-b", "Open in editor", "Read and edit the source", { "data-dxs": "open", "data-ref": k }));
      row.appendChild(btn("dxc-b", "Preview", "Show the source", { "data-dxs": "peek", "data-ref": k }));
      row.appendChild(btn("dxc-b", "Duplicate to my scripts", "Copy it into your own scripts", { "data-dxs": "dup", "data-ref": k }));
      row.appendChild(btn("dxc-b", "Export", "Save it as a .dexs file", { "data-dxs": "export-ref", "data-ref": k }));
      if (it.rec) row.appendChild(btn("dxc-b", "Delete", "Delete this script", { "data-dxs": "del-ref", "data-ref": k }));
      card.appendChild(row);
      card.appendChild(el("div", null, null, { "data-peek": k }));
      list.appendChild(card);
    }
    if (!shown) list.appendChild(el("div", "dxc-empty", "Nothing matches that."));
  }

  function togglePeek(k) {
    var holder = d.querySelector("[data-peek='" + k + "']");
    if (!holder) return;
    if (holder.firstChild) { clear(holder); return; }
    var ref = parseRef(k), src = sourceOf(ref);
    holder.appendChild(el("pre", "dxs-src", src == null ? "(this script is gone)" : src));
  }

  /* ---------------------------------------------------------- import UI */
  function openImport() {
    styles();
    ED = null;
    var body = modal("Import scripts");
    body.appendChild(el("div", "dxc-note",
      "A .dexs file is JSON with a version on it. Every script in it has to compile before any of them is kept — " +
      "if one fails, nothing is imported and the one that failed is named."));
    var file = el("input", "dxc-in wide", null, { type: "file", id: "dxsFile", accept: ".dexs,.json,application/json" });
    body.appendChild(file);
    body.appendChild(el("div", "dxc-lg", "Or paste it here"));
    var ta = el("textarea", "dxc-ta", null, { id: "dxsPaste", rows: "8", "aria-label": "Paste a .dexs file" });
    body.appendChild(ta);
    var row = el("div", "dxc-row");
    row.appendChild(btn("dxc-go", "Import", "Read what is pasted above", { "data-dxs": "import-go" }));
    row.appendChild(btn("dxc-b", "Cancel", "Close", { "data-dxc": "close" }));
    body.appendChild(row);
    body.appendChild(el("div", null, null, { id: "dxsImportOut" }));

    file.addEventListener("change", function () {
      try {
        var f = file.files && file.files[0];
        if (!f || !W.FileReader) return;
        var rd = new W.FileReader();
        rd.onload = function () { showImport(importText(String(rd.result))); };
        rd.onerror = function () { showImport({ ok: false, added: [], failed: [], msg: "that file could not be read" }); };
        rd.readAsText(f);
      } catch (e) { fault("importFile", e); }
    });
  }
  function showImport(res) {
    var out = d.getElementById("dxsImportOut");
    if (!out) return;
    clear(out);
    var head = el("div", "dxs-stat");
    head.appendChild(el("span", res.ok ? "ok" : "bad", res.msg));
    out.appendChild(head);
    var i;
    for (i = 0; i < res.failed.length; i++) {
      var f = res.failed[i];
      var n = el("div", "dxs-note");
      n.appendChild(el("span", "ln un", "failed"));
      n.appendChild(el("span", null, f.title + " — line " + (f.errors[0] ? f.errors[0].line : 0) + ": " + (f.errors[0] ? f.errors[0].msg : "")));
      out.appendChild(n);
    }
    if (res.ok) renderLibrary();
  }

  /* =====================================================================
     9 · THE CHROME AND THE ONE DELEGATED CLICK LISTENER
     ===================================================================== */

  function ensureChrome() {
    var rail = d.getElementById("dxcRail");
    if (rail && rail.getAttribute("data-dxs") !== "1") {
      rail.setAttribute("data-dxs", "1");
      rail.appendChild(el("i", "dxc-sep"));
      rail.appendChild(btn("dxc-t", "{}", "DexScript editor", { "data-dxs": "editor" }));
      rail.appendChild(btn("dxc-t", "≡", "Script library", { "data-dxs": "library" }));
      styles();
    }
    sync();
  }

  /* The engine's indicator dialog is built by the engine; this adds the two
     rows that lead out of it, after the engine's own click handler has put the
     dialog on the page. Both handlers sit on document and the engine's was
     registered first, so the sheet exists by the time this runs. */
  function decorateIndicators() {
    try {
      var m = d.getElementById("dxcModal");
      if (!m) return;
      var body = m.querySelector(".dxc-sb2");
      if (!body || body.getAttribute("data-dxs") === "1") return;
      body.setAttribute("data-dxs", "1");
      body.appendChild(el("div", "dxc-lg", "Scripts"));
      var box = el("div", "dxc-list");
      var a = btn("dxc-li", null, "Write a new script", { "data-dxs": "new" });
      a.appendChild(el("span", "nm", "New script"));
      a.appendChild(el("span", "tg", "editor"));
      box.appendChild(a);
      var b = btn("dxc-li", null, "Browse the script library", { "data-dxs": "library" });
      b.appendChild(el("span", "nm", "Script library"));
      b.appendChild(el("span", "tg", LIB.length + " shipped"));
      box.appendChild(b);
      body.appendChild(box);
    } catch (e) { fault("decorate", e); }
  }

  var wired = false;
  function wireClicks() {
    if (wired) return;
    wired = true;
    d.addEventListener("click", function (e) {
      try { onClick(e); } catch (err) { fault("click", err); }
    });
  }

  function onClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;

    /* the engine's own indicator button, decorated after the fact */
    if (t.closest("[data-dxc='ind']")) { decorateIndicators(); return; }

    var n = t.closest("[data-dxs]");
    if (!n) return;
    var a = n.getAttribute("data-dxs");
    var ref, k;

    if (a === "editor") { sync(); openEditor(currentRef()); return; }
    if (a === "library") { sync(); openLibrary(); return; }
    if (a === "new") { openEditor(null); return; }
    if (a === "templates") { openTemplates(); return; }
    if (a === "pine") { openPine(); return; }
    if (a === "pine-go") { runPine(); return; }
    if (a === "pine-open") {
      var got = PENDING_PINE;
      closeModal();
      openEditor(null);
      if (ED && ED.ta && got != null) { ED.ta.value = got; ED.name.value = "Converted from Pine"; refresh(false); }
      return;
    }
    if (a === "import") { openImport(); return; }
    if (a === "import-go") {
      var pasted = d.getElementById("dxsPaste");
      showImport(importText(pasted ? pasted.value : ""));
      return;
    }
    if (a === "export-all") { download("dexscript-scripts.dexs", exportAllUser()); return; }
    if (a === "libgroup") { BROWSE.group = n.getAttribute("data-g"); openLibrary(); return; }

    if (a === "on" || a === "off" || a === "open" || a === "peek" || a === "dup" || a === "export-ref" || a === "del-ref") {
      k = n.getAttribute("data-ref");
      ref = parseRef(k);
      if (!ref) return;
      if (a === "on") { reportAdd(addToChart(ref)); renderLibrary(); return; }
      if (a === "off") { removeFromChart(ref); renderLibrary(); return; }
      if (a === "open") { openEditor(ref); return; }
      if (a === "peek") { togglePeek(k); return; }
      if (a === "dup") {
        var src2 = sourceOf(ref);
        if (src2 != null) saveUser(titleOf(ref) + " (copy)", src2, null);
        BROWSE.group = "Mine";
        openLibrary();
        return;
      }
      if (a === "export-ref") { download(safeId(titleOf(ref)) + ".dexs", exportOne(ref) || "{}"); return; }
      if (a === "del-ref") {
        deleteUser(ref.id);
        renderLibrary();
        return;
      }
    }

    if (a === "tpl") {
      var i2 = parseInt(n.getAttribute("data-i"), 10);
      var tpl = (DXS.PRELUDE || [])[i2];
      closeModal();
      openEditor(null);
      if (ED && ED.ta && tpl) { ED.ta.value = tpl.src; ED.name.value = tpl.name; refresh(false); }
      return;
    }

    if (!ED) return;

    if (a === "panel") {
      /* Collapsing hides the body; it does not empty it. The reference panel
         owns its search field, and a collapse that threw that away would need
         the whole editor rebuilt to get it back. */
      var pb = n.parentNode ? n.parentNode.querySelector(".dxs-pb") : null;
      if (pb) {
        var openNow = n.getAttribute("aria-expanded") !== "false";
        n.setAttribute("aria-expanded", openNow ? "false" : "true");
        pb.classList.toggle("dxs-hide", openNow);
      }
      return;
    }
    if (a === "insert") { insertAtCaret(n.getAttribute("data-ins") || ""); return; }
    if (a === "run") { doRun(); return; }
    if (a === "save") { doSave(false); return; }
    if (a === "saveas") { doSave(true); return; }
    if (a === "revert") { doRevert(); return; }
    if (a === "delete") { doDelete(); return; }
    if (a === "export-one") {
      var title2 = ED.name ? ED.name.value : "script";
      var payload = JSON.stringify(exportPayload([{ title: title2, source: ED.ta.value }]), null, 2);
      download(safeId(title2) + ".dexs", payload);
      return;
    }
  }

  function currentRef() {
    var want = onChart();
    return want.length ? want[want.length - 1] : null;
  }

  function reportAdd(r) {
    if (!ED || !ED.stat) return;
    if (r.ok) return;
    clear(ED.stat);
    ED.stat.appendChild(el("span", "bad", r.errors[0] ? ("line " + r.errors[0].line + ": " + r.errors[0].msg) : "that script could not be registered"));
  }

  /* Run is deliberately the only path that touches the chart: typing changes
     the editor, it does not silently change what is drawn. */
  function doRun() {
    if (!ED) return;
    refresh(false);
    var c = ED.compiled;
    if (!c || !c.ok) return;
    var rec = saveUser(ED.name ? ED.name.value : c.meta.title, ED.ta.value, ED.ref && ED.ref.src === "user" ? ED.ref.id : null);
    if (!rec) return;
    ED.ref = { src: "user", id: rec.id };
    var r = addToChart(ED.ref);
    reportAdd(r);
    if (r.ok) applyParamsToChart();
  }
  function doSave(asNew) {
    if (!ED) return;
    var id = (!asNew && ED.ref && ED.ref.src === "user") ? ED.ref.id : null;
    var rec = saveUser(ED.name ? ED.name.value : "Untitled script", ED.ta.value, id);
    if (!rec) return;
    ED.ref = { src: "user", id: rec.id };
    refresh(false);
  }
  function doRevert() {
    if (!ED || !ED.ref) return;
    var src = sourceOf(ED.ref);
    if (src == null) return;
    ED.ta.value = src;
    if (ED.name) ED.name.value = titleOf(ED.ref);
    refresh(false);
  }
  function doDelete() {
    if (!ED || !ED.ref || ED.ref.src !== "user") return;
    deleteUser(ED.ref.id);
    ED.ref = null;
    refresh(false);
  }

  /* =====================================================================
     10 · BOOT AND THE PUBLIC SURFACE
     ===================================================================== */

  styles();
  ensureChrome();
  wireClicks();
  /* The rail is thrown away and rebuilt when a tool is pinned, and the whole
     chart chrome is rebuilt when the market changes. Watch for both rather
     than polling on a timer. */
  try {
    if (typeof W.MutationObserver === "function") {
      var mo = new W.MutationObserver(function () { try { ensureChrome(); } catch (e) { fault("observe", e); } });
      if (d.body) mo.observe(d.body, { childList: true, subtree: true });
    }
  } catch (e) { fault("observe", e); }

  W.DXSPINE = (W.DXSPINE && W.DXSPINE.__v) ? W.DXSPINE : PINE;

  return {
    __v: 165,
    ok: true,
    /* the library */
    library: function () { return LIB.slice(); },
    libraryGroups: function () { return LIB_GROUPS.slice(); },
    libraryById: function (id) { return LIB_BY_ID[id] || null; },
    /* your scripts */
    userScripts: userList,
    saveUser: saveUser,
    deleteUser: deleteUser,
    /* what is on this market */
    onChart: onChart,
    addToChart: addToChart,
    removeFromChart: removeFromChart,
    sync: function () { lastSym = null; return sync(); },
    /* carrying them around */
    exportOne: exportOne,
    exportAll: exportAllUser,
    importText: importText,
    /* the editor's own pieces, exposed so a harness can drive them */
    segments: segments,
    open: function (ref) { return openEditor(ref || null); },
    openLibrary: openLibrary,
    openPine: openPine,
    openImport: openImport,
    editor: function () { return ED; },
    refresh: function () { refresh(false); },
    convert: PINE.convert,
    pine: PINE
  };
})();
