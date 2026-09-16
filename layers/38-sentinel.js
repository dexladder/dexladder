/* ============================================================
   DLSENTINEL · v154 — Sentinel: alerts you say in words, compiled into
   rules you can read. New rule kinds on the existing alert engine:
   move-in-window, volume spike, funding flip/level, stablecoin depeg,
   RSI cross, Weather level, Rung breadth. Rules live in S.alerts with
   kind "v154:*" (same list, same alert centre, same notifications);
   the engine evaluates them on the one engine tick. The compiler is
   deterministic (DeXaI can front it with a model, but never needs to).
   ============================================================ */
window.DLSENTINEL = (function () {
  "use strict";
  if (window.DLSENTINEL && window.DLSENTINEL.__v) return window.DLSENTINEL;
  var C = window.DLCORE, $ = C.$, esc = C.esc;
  var STABLES = { USDT: 1, USDC: 1, DAI: 1, FDUSD: 1, USDE: 1, TUSD: 1, PYUSD: 1, USDS: 1, FRAX: 1, USD1: 1, RLUSD: 1 };
  var RING = {}, RING_MS = 3 * 3600e3, SAMPLE_MS = 30e3, lastSample = 0;
  function sample() {
    var now = Date.now(); if (now - lastSample < SAMPLE_MS) return; lastSample = now;
    var syms = {}; (S.alerts || []).forEach(function (a) { if (a.sym) syms[a.sym] = 1; });
    Object.keys(syms).forEach(function (s) { var c = C.coin(s); if (!c || !c.price) return; var r = RING[s] || (RING[s] = []); r.push([now, c.price]); while (r.length && now - r[0][0] > RING_MS) r.shift(); });
  }
  function changeOver(sym, ms) { var r = RING[sym]; if (!r || r.length < 2) return null; var now = Date.now(), base = null; for (var i = 0; i < r.length; i++) { if (now - r[i][0] <= ms) { base = r[i]; break; } } if (!base) base = r[0]; var c = C.coin(sym); if (!c) return null; return { pct: (c.price / base[1] - 1) * 100, span: now - base[0] }; }
  function winMs(v, u) { v = +v || 1; return u === "d" ? v * 864e5 : u === "h" ? v * 36e5 : v * 6e4; }
  function winTxt(ms) { return ms >= 864e5 ? Math.round(ms / 864e5) + "d" : ms >= 36e5 ? Math.round(ms / 36e5) + "h" : Math.round(ms / 6e4) + "m"; }
  /* ---------------------------------------------------------- rule model */
  function mk(kind, sym, fields) { return Object.assign({ id: "s" + Math.random().toString(36).slice(2, 8), sym: sym, kind: "v154:" + kind, created: Date.now(), hit: null, lastPx: (C.coin(sym) || {}).price || null }, fields || {}); }
  function desc(a) {
    var k = a.kind.replace("v154:", ""), c = C.coin(a.sym);
    if (k === "move") { var ch = changeOver(a.sym, a.win); return (a.dir < 0 ? "Drops" : a.dir > 0 ? "Rises" : "Moves ±") + " " + a.val + "% within " + winTxt(a.win) + (ch ? " · " + winTxt(ch.span) + " so far " + C.pct(ch.pct, 1) : " · sampling…"); }
    if (k === "volspike") return "24h volume ≥ " + a.mult + "× the level when armed (" + C.big(a.base) + ")" + (c ? " · now " + C.big(c.vol) : "");
    if (k === "funding") { var f = window.DLWEATHER ? DLWEATHER.funding8h(a.sym) : null; return (a.mode === "flip" ? "Funding flips " + (a.dir < 0 ? "negative" : "positive") : "Funding " + (a.dir < 0 ? "below −" : "above +") + a.val + " bp") + (f != null ? " · now " + (f * 1e4).toFixed(2) + " bp" : " · waiting for the venue"); }
    if (k === "depeg") return "Depegs beyond ±" + a.val + "% from $1" + (c ? " · now $" + c.price.toFixed(4) : "");
    if (k === "rsi") { var r = c ? C.rsi(c.spark || [], 14) : null; return "RSI-14 " + (a.dir < 0 ? "drops below " : "rises above ") + a.val + (r != null ? " · now " + r.toFixed(0) : ""); }
    if (k === "weather") return "Weather " + (a.dir < 0 ? "below " : "above ") + a.val + (window.DLWEATHER ? " · now " + DLWEATHER.weather().w.toFixed(0) : "");
    if (k === "breadth") return "Rung “" + a.rung + "” ≥ " + a.val + "% " + (a.dir < 0 ? "red" : "green") + " on the day";
    return "Sentinel rule";
  }
  function evaluate() {
    if (!S.alerts || !S.alerts.length) return; sample();
    var fired = false;
    S.alerts.forEach(function (a) {
      if (a.hit || typeof a.kind !== "string" || a.kind.indexOf("v154:") !== 0) return;
      var k = a.kind.slice(5), c = C.coin(a.sym), go = false, msg = "";
      try {
        if (k === "move") { var ch = changeOver(a.sym, a.win); if (ch && ((a.dir < 0 && ch.pct <= -a.val) || (a.dir > 0 && ch.pct >= a.val) || (!a.dir && Math.abs(ch.pct) >= a.val))) { go = true; msg = a.sym + " moved " + C.pct(ch.pct, 1) + " within " + winTxt(ch.span) + " (rule: " + a.val + "% in " + winTxt(a.win) + ")"; } }
        else if (k === "volspike" && c) { if (c.vol >= a.base * a.mult) { go = true; msg = a.sym + " volume " + C.big(c.vol) + " is " + (c.vol / a.base).toFixed(1) + "× the level when armed"; } }
        else if (k === "funding" && window.DLWEATHER) { var f = DLWEATHER.funding8h(a.sym); if (f != null) { var bp = f * 1e4; if (a.mode === "flip") { if (a.prev != null && ((a.dir < 0 && a.prev >= 0 && f < 0) || (a.dir > 0 && a.prev <= 0 && f > 0))) { go = true; msg = a.sym + " funding flipped " + (f < 0 ? "negative" : "positive") + " (" + bp.toFixed(2) + " bp / 8h)"; } a.prev = f; } else if ((a.dir < 0 && bp <= -a.val) || (a.dir > 0 && bp >= a.val)) { go = true; msg = a.sym + " funding " + bp.toFixed(2) + " bp / 8h crossed your " + a.val + " bp line"; } } }
        else if (k === "depeg" && c) { var dev = Math.abs(c.price - 1) * 100; if (dev >= a.val) { go = true; msg = a.sym + " is $" + c.price.toFixed(4) + " — " + dev.toFixed(2) + "% off the peg"; } }
        else if (k === "rsi" && c) { var r = C.rsi(c.spark || [], 14); if (r != null) { if (a.prevR != null && ((a.dir < 0 && a.prevR >= a.val && r < a.val) || (a.dir > 0 && a.prevR <= a.val && r > a.val))) { go = true; msg = a.sym + " RSI-14 crossed " + (a.dir < 0 ? "below" : "above") + " " + a.val + " (now " + r.toFixed(0) + ")"; } a.prevR = r; } }
        else if (k === "weather" && window.DLWEATHER) { var w = DLWEATHER.weather().w; if (a.prevW != null && ((a.dir < 0 && a.prevW >= a.val && w < a.val) || (a.dir > 0 && a.prevW <= a.val && w > a.val))) { go = true; msg = "Weather crossed " + (a.dir < 0 ? "below" : "above") + " " + a.val + " (now " + w.toFixed(0) + ")"; } a.prevW = w; }
        else if (k === "breadth" && window.DLRUNGS) { var rg = DLRUNGS.get(a.rungId); if (rg) { var set = rg.fn ? rg.fn(C.coinsAll()) : rg.syms.map(C.coin).filter(Boolean); var n = set.length, m = set.filter(function (x) { return a.dir < 0 ? x.c24 < 0 : x.c24 > 0; }).length; if (n >= 3 && m / n * 100 >= a.val) { go = true; msg = "Rung “" + a.rung + "”: " + m + " of " + n + " coins " + (a.dir < 0 ? "red" : "green") + " today"; } } }
      } catch (e) {}
      if (go) { a.hit = Date.now(); fired = true; C.toast(a.dir < 0 ? "bad" : "good", "Sentinel", msg); C.sfx("alert"); try { if ("Notification" in window && Notification.permission === "granted") new Notification("DexLadder — Sentinel", { body: msg }); } catch (e) {} try { window.DEXAI && DEXAI.event && DEXAI.event("sentinel.fired", { a: a, msg: msg }); } catch (e) {} }
    });
    if (fired) { try { bellRing(); updateAlertChip(); } catch (e) {} C.save(); }
  }
  /* ---------------------------------------------------------- compiler (deterministic) */
  function findSym(txt) {
    var all = C.coinsAll(), t = " " + txt.toLowerCase() + " ";
    var hit = null; all.forEach(function (c) { if (hit) return; var s = c.sym.toLowerCase(); if (s.length >= 2 && new RegExp("[\\s$]" + s.replace(/[^a-z0-9]/g, "") + "[\\s,.!?]").test(t)) hit = c; });
    if (!hit) all.forEach(function (c) { if (hit) return; var n = c.name.toLowerCase(); if (n.length >= 3 && t.indexOf(" " + n + " ") > -1) hit = c; });
    if (!hit) { if (/\bbitcoin\b/.test(t)) hit = C.coin("BTC"); else if (/\b(ether|ethereum)\b/.test(t)) hit = C.coin("ETH"); }
    return hit;
  }
  function compile(text) {
    var out = [], parts = String(text || "").split(/\s*(?:\bor\b|\band\b|;|,)\s*/i).filter(Boolean);
    parts.forEach(function (p) {
      var t = p.toLowerCase().trim(), c = findSym(t), m;
      if ((m = t.match(/(drops?|falls?|down|dumps?|loses?|sinks?|rises?|pumps?|up|gains?|climbs?|jumps?)\s+(?:by\s+)?(\d+(?:\.\d+)?)\s*%\s*(?:in|within|over)\s+(?:the\s+)?(?:next\s+)?(\d+|an?|one)?\s*(m|min|minutes?|h|hr|hours?|d|days?)\b/))) { if (!c) return out.push({ err: "Which coin? " + p }); if (m[3] && !/^\d/.test(m[3])) m[3] = "1"; var dir = /^(drops?|falls?|down|dumps?|loses?|sinks?)$/.test(m[1]) ? -1 : 1; var unit = m[4][0] === "d" ? "d" : m[4][0] === "h" ? "h" : "m"; return out.push(mk("move", c.sym, { dir: dir, val: +m[2], win: winMs(m[3] || 1, unit) })); }
      if ((m = t.match(/funding\s+(?:flips?|turns?|goes)\s+(negative|positive)/))) { if (!c) return out.push({ err: "Which perp? " + p }); return out.push(mk("funding", c.sym, { mode: "flip", dir: m[1] === "negative" ? -1 : 1, prev: null })); }
      if ((m = t.match(/funding\s+(above|over|below|under)\s+(?:\+|-|−)?(\d+(?:\.\d+)?)\s*bp/))) { if (!c) return out.push({ err: "Which perp? " + p }); return out.push(mk("funding", c.sym, { mode: "level", dir: /above|over/.test(m[1]) ? 1 : -1, val: +m[2], prev: null })); }
      if ((m = t.match(/depeg(?:s)?(?:\s+(?:by|beyond|more than)\s+(\d+(?:\.\d+)?)\s*%)?/))) { var st = c && STABLES[c.sym] ? c.sym : "USDT"; return out.push(mk("depeg", st, { val: +(m[1] || 0.5) })); }
      if ((m = t.match(/rsi\s+(above|over|below|under|crosses above|crosses below)\s+(\d+)/))) { if (!c) return out.push({ err: "Which coin? " + p }); return out.push(mk("rsi", c.sym, { dir: /above|over/.test(m[1]) ? 1 : -1, val: +m[2], prevR: null })); }
      if ((m = t.match(/volume\s+(spikes?|doubles?|triples?|(\d+(?:\.\d+)?)\s*x)/))) { if (!c) return out.push({ err: "Which coin? " + p }); var mult = /doubl/.test(m[1]) ? 2 : /tripl/.test(m[1]) ? 3 : m[2] ? +m[2] : 2; return out.push(mk("volspike", c.sym, { mult: mult, base: c.vol || 0 })); }
      if ((m = t.match(/weather\s+(above|over|below|under)\s+(\d+)/))) return out.push(mk("weather", "BTC", { dir: /above|over/.test(m[1]) ? 1 : -1, val: +m[2], prevW: null }));
      if ((m = t.match(/(?:rung\s+)?[“"']?([a-z0-9 ._-]+?)[”"']?\s+(?:is\s+)?(?:mostly|breadth|(\d+)\s*%)\s*(red|down|green|up)/)) && window.DLRUNGS) { var name = m[1].trim(), rg = DLRUNGS.list().concat(DLRUNGS.curated).filter(function (r) { return r.name.toLowerCase() === name; })[0]; if (rg) return out.push(mk("breadth", "BTC", { rungId: rg.id, rung: rg.name, dir: /red|down/.test(m[3]) ? -1 : 1, val: +(m[2] || 70) })); }
      if ((m = t.match(/(above|over|crosses|hits|reaches|breaks|below|under|drops to|falls to)\s+\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m)?\b/))) { if (!c) return out.push({ err: "Which coin? " + p }); var v = +m[2].replace(/,/g, ""); if (m[3] === "k") v *= 1e3; if (m[3] === "m") v *= 1e6; var kind = /below|under|drops to|falls to/.test(m[1]) ? "below" : "above"; return out.push({ id: Math.random().toString(36).slice(2, 8), sym: c.sym, kind: kind, val: v, created: Date.now(), hit: null, lastPx: c.price, lastAbs: null, base: true }); }
      if ((m = t.match(/(?:moves?|swings?|changes?)\s+(?:more than\s+|by\s+)?(?:\+\/?-\s*|±\s*)?(\d+(?:\.\d+)?)\s*%\s*(?:in|within|over)\s+(?:the\s+)?(?:next\s+)?(\d+|an?|one)?\s*(m|min|minutes?|h|hr|hours?|d|days?)\b/))) { if (!c) return out.push({ err: "Which coin? " + p }); var n3 = m[2] && /^\d/.test(m[2]) ? +m[2] : 1, u3 = m[3][0] === "d" ? "d" : m[3][0] === "h" ? "h" : "m"; return out.push(mk("move", c.sym, { dir: 0, val: +m[1], win: winMs(n3, u3) })); }
      if ((m = t.match(/moves?\s+(?:more than\s+)?(\d+(?:\.\d+)?)\s*%/))) { if (!c) return out.push({ err: "Which coin? " + p }); return out.push({ id: Math.random().toString(36).slice(2, 8), sym: c.sym, kind: "pct", val: +m[1], created: Date.now(), hit: null, lastPx: c.price, lastAbs: Math.abs(c.c24), base: true }); }
      out.push({ err: "Couldn’t compile: “" + p + "”" });
    });
    return out;
  }
  function arm(rules) {
    S.alerts || (S.alerts = []); var n = 0;
    rules.forEach(function (r) { if (r.err) return; if (S.alerts.length >= 40) return; delete r.base; S.alerts.unshift(r); n++; });
    if (n) { C.save(); try { updateAlertChip(); } catch (e) {} try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch (e) {} C.xp("sentinel.first", 10, "First Sentinel rule armed — words compiled into a watch"); }
    return n;
  }
  function describe(r) { if (r.err) return r.err; if (r.kind && r.kind.indexOf("v154:") === 0) return r.sym + " · " + desc(r); try { return r.sym + " · " + alertDesc(r); } catch (e) { return r.sym + " · " + r.kind + " " + r.val; } }
  /* ---------------------------------------------------------- UI: composer inside the alert centre */
  function composerHTML() {
    return '<div class="dl154" id="dlSentinel" style="margin:0 0 12px"><div class="h">🛰 Sentinel <span style="font:500 11px var(--ui-sans,sans-serif);color:var(--muted)">· say it, we compile it</span></div><div class="dl-in" style="margin-bottom:6px"><input id="dlSnIn" placeholder="e.g. SOL drops 5% in 1h · funding flips negative on ETH · USDT depegs · BTC rsi above 70"><button id="dlSnGo">Compile</button></div><div id="dlSnOut"></div><div class="n" style="margin-top:6px">Kinds: price above/below · moves N% · drops/rises N% in a window · volume doubles · funding flips/level · depeg · RSI cross · weather level · a Rung mostly red/green. Rules stay editable in this list.</div></div>';
  }
  function wireComposer() {
    var inp = $("dlSnIn"), go = $("dlSnGo"), out = $("dlSnOut"); if (!inp || !go) return;
    var pending = [];
    function show() { out.innerHTML = pending.length ? pending.map(function (r, i) { return '<div class="kv"><span>' + (r.err ? "⚠ " : "✓ ") + esc(describe(r)) + "</span>" + (r.err ? "" : '<button class="dl-b" data-drop="' + i + '">✕</button>') + "</div>"; }).join("") + (pending.some(function (r) { return !r.err; }) ? '<button class="dl-b pri" id="dlSnArm" style="margin-top:8px">Arm ' + pending.filter(function (r) { return !r.err; }).length + "</button>" : "") : ""; var armB = $("dlSnArm"); if (armB) armB.onclick = function () { var n = arm(pending); pending = []; C.toast("good", "Sentinel armed", n + " rule" + (n === 1 ? "" : "s") + " watching the live feed"); try { openAlerts(); } catch (e) {} }; out.querySelectorAll("[data-drop]").forEach(function (b) { b.onclick = function () { pending.splice(+b.getAttribute("data-drop"), 1); show(); }; }); }
    go.onclick = function () { pending = compile(inp.value); show(); }; inp.addEventListener("keydown", function (e) { if (e.key === "Enter") go.onclick(); });
  }
  (function hookAlerts() {
    try {
      var _oa = window.openAlerts;
      if (typeof _oa === "function" && !_oa.__v154) { var w = function () { var r = _oa.apply(this, arguments); try { var m = document.querySelector("#modalRoot .modal"); if (m && !$("dlSentinel")) { var list = m.querySelector(".alert-list") || m.querySelector("h2"); var d = document.createElement("div"); d.innerHTML = composerHTML(); (list || m).insertAdjacentElement(list ? "beforebegin" : "afterend", d.firstChild); wireComposer(); } } catch (e) {} return r; }; w.__v154 = 1; window.openAlerts = w; }
      var _ad = window.alertDesc;
      if (typeof _ad === "function" && !_ad.__v154) { var w2 = function (a) { if (a && typeof a.kind === "string" && a.kind.indexOf("v154:") === 0) return desc(a); return _ad.apply(this, arguments); }; w2.__v154 = 1; window.alertDesc = w2; }
    } catch (e) {}
  })();
  C.onTick(function (n) { if (n % 4 === 0) evaluate(); });
  C.cmd("sentinel", "Sentinel — alerts in plain words (moves, funding, depeg, RSI, breadth)", "🛰", function () { try { openAlerts(); } catch (e) {} });
  return { __v: 154, compile: compile, arm: arm, evaluate: evaluate, desc: desc, describe: describe, ring: RING, sample: sample };
})();
