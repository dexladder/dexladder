/* DexChart studies harness — layer 51 driven head-first against a recording 2D
   context, on top of the real layer 46 engine. Every key registered by
   51-dxstudies.js is added on its own, painted, and checked for: registration,
   canvas work, an empty DXC.errors(), and an output that is either rows or an
   honest note. Then all of them together, then on a 20-bar series, then in Day
   mode, then the four network studies on both the answered and the refused path.
   Node only, no browser. Modelled on test/dxc-harness.js. */
"use strict";
const fs = require("fs");
const path = require("path");

/* ---------- a recording 2D context ---------- */
let ops = 0;
function ctx() {
  const noop = () => { ops++; };
  return {
    canvas: null, globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "", textBaseline: "", lineJoin: "", lineCap: "",
    setTransform: noop, clearRect: noop, fillRect: noop, strokeRect: noop, beginPath: noop, moveTo: noop, lineTo: noop,
    closePath: noop, stroke: noop, fill: noop, arc: noop, ellipse: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
    save: noop, restore: noop, setLineDash: noop, fillText: noop, clip: noop, rect: noop,
    measureText: (t) => { ops++; return { width: String(t).length * 6 }; },
    createLinearGradient: () => ({ addColorStop: noop })
  };
}

/* ---------- a DOM stub, only what the layers touch ---------- */
function mkEl(tag) {
  const e = {
    tagName: String(tag).toUpperCase(), children: [], parentNode: null, firstChild: null, className: "", textContent: "",
    attrs: {}, value: "", checked: false, type: "", title: "",
    style: { setProperty(k, v) { e.attrs["style:" + k] = v; } },
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); }, remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { on ? this._s.add(c) : this._s.delete(c); } return this._s.has(c); },
      contains(c) { return this._s.has(c); }
    },
    setAttribute(k, v) { e.attrs[k] = String(v); }, getAttribute(k) { return e.attrs[k] === undefined ? null : e.attrs[k]; },
    removeAttribute(k) { delete e.attrs[k]; },
    appendChild(c) { c.parentNode = e; e.children.push(c); e.firstChild = e.children[0]; return c; },
    removeChild(c) { const i = e.children.indexOf(c); if (i >= 0) e.children.splice(i, 1); e.firstChild = e.children[0] || null; return c; },
    addEventListener() { }, removeEventListener() { }, setPointerCapture() { }, click() { }, focus() { },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1100, height: 560, right: 1100, bottom: 560 }),
    querySelector(sel) { return find(e, sel)[0] || null; },
    querySelectorAll(sel) { return find(e, sel); },
    closest() { return null; },
    getContext: () => CTX,
    toDataURL: () => "data:,",
    offsetHeight: 200, offsetWidth: 200, clientWidth: 1100, clientHeight: 560, width: 0, height: 0, offsetParent: {}
  };
  return e;
}
function walk(n, out) { out.push(n); (n.children || []).forEach(c => walk(c, out)); return out; }
function find(root, sel) {
  const all = walk(root, []).slice(1);
  const m = /^\[([\w-]+)(?:=['"]?([^'"\]]+)['"]?)?\]$/.exec(sel.trim());
  if (m) return all.filter(n => n.attrs[m[1]] !== undefined && (m[2] === undefined || n.attrs[m[1]] === m[2]));
  const b = /^button\[([\w-]+)(?:=['"]?([^'"\]]+)['"]?)?\]$/.exec(sel.trim());
  if (b) return all.filter(n => n.tagName === "BUTTON" && n.attrs[b[1]] !== undefined && (b[2] === undefined || n.attrs[b[1]] === b[2]));
  if (sel.charAt(0) === ".") return all.filter(n => (n.className || "").split(/\s+/).indexOf(sel.slice(1)) >= 0);
  return all.filter(n => n.tagName === sel.toUpperCase());
}
const CTX = ctx();
const BODY = mkEl("body"), ROOT = mkEl("html");
const NODES = {};
["coinChart", "coinHost", "rpBar"].forEach(id => { NODES[id] = mkEl(id === "coinChart" ? "canvas" : "div"); NODES[id].setAttribute("id", id); });
NODES.rpBar.attrs["data-dxc-off"] = "1";

const store = {};
global.document = {
  readyState: "complete", body: BODY, documentElement: ROOT,
  getElementById: id => NODES[id] || null,
  createElement: mkEl, addEventListener() { }, removeEventListener() { },
  querySelector: sel => find(BODY, sel)[0] || null,
  querySelectorAll: sel => find(BODY, sel)
};
ROOT.getAttribute = k => (k === "data-mode" ? MODE : null);
let MODE = "dark";

/* ---------- synthetic but well-formed OHLCV ---------- */
const T0 = Date.UTC(2026, 0, 1);
let BARS = 900;
function klines(n, iv) {
  const rows = []; let p = 42000;
  for (let i = 0; i < n; i++) {
    const o = p;
    p = p * (1 + Math.sin(i / 17) * 0.004 + Math.cos(i / 7) * 0.002 + (i % 53 === 0 ? 0.01 : 0));
    const c = p, h = Math.max(o, c) * 1.002, l = Math.min(o, c) * 0.998;
    rows.push([T0 + i * iv, String(o), String(h), String(l), String(c), String(1000 + (i % 40) * 37)]);
  }
  return rows;
}
const IVMSMAP = { "1m": 6e4, "3m": 18e4, "5m": 3e5, "15m": 9e5, "30m": 18e5, "1h": 36e5, "2h": 72e5, "4h": 144e5, "6h": 216e5, "12h": 432e5, "1d": 864e5, "3d": 2592e5, "1w": 6048e5, "1M": 2592e6 };

/* ---------- the futures-data stub: BTCUSDT answers, anything else does not ---------- */
let fapiHits = 0, fapiRefused = 0;
function fapi(url) {
  fapiHits++;
  const sym = (/(?:symbol|pair)=([A-Z0-9]+)/.exec(url) || [, ""])[1];
  if (sym !== "BTCUSDT") { fapiRefused++; return Promise.reject(new Error("no perpetual for " + sym)); }
  const per = (/period=([^&]+)/.exec(url) || [, "1h"])[1];
  const step = IVMSMAP[per] || 36e5;
  const out = [];
  for (let i = 0; i < 400; i++) {
    const t = T0 + i * step;
    if (/fundingRate/.test(url)) { if (i % 8) continue; out.push({ symbol: sym, fundingTime: t, fundingRate: String(0.0001 * Math.sin(i / 9)) }); }
    else if (/openInterestHist/.test(url)) out.push({ symbol: sym, sumOpenInterest: String(50000 + i * 3), sumOpenInterestValue: String(2.1e9 + i * 1e6), timestamp: t });
    else if (/globalLongShortAccountRatio/.test(url)) out.push({ symbol: sym, longShortRatio: String(1 + 0.2 * Math.sin(i / 11)), longAccount: "0.6", shortAccount: "0.4", timestamp: t });
    else if (/futures\/data\/basis/.test(url)) out.push({ pair: sym, contractType: "PERPETUAL", basis: String(12 * Math.sin(i / 13)), basisRate: String(0.0004 * Math.sin(i / 13)), timestamp: t });
  }
  return Promise.resolve({ data: out });
}

let jgets = 0;
global.window = {
  devicePixelRatio: 2, innerWidth: 1400, innerHeight: 900,
  requestAnimationFrame: fn => { RAF.push(fn); return RAF.length; },
  setTimeout: (fn) => { LATER.push(fn); return 0; }, clearTimeout() { }, setInterval: () => 0, clearInterval() { },
  performance: { now: () => Date.now() },
  localStorage: {
    getItem: k => (store[k] === undefined ? null : store[k]),
    setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; }
  },
  getComputedStyle: () => ({ display: "none" }),
  S: { view: "coin", coin: "BTC", quote: "USDT", chartEngine: "native", bal: { BTC: 0.4 }, orders: [], alerts: [] },
  pairPrice: () => 43210.5,
  pairHist: () => { const a = []; for (let i = 0; i < 336; i++) a.push(42000 * (1 + Math.sin(i / 20) * 0.03)); return a; },
  avgEntryUSD: () => 40500,
  motionCalm: () => false,
  DLCORE: {
    jget: (u) => {
      jgets++;
      if (/fapi\.binance\.com/.test(u)) return fapi(u);
      const iv = (/interval=([^&]+)/.exec(u) || [, "1h"])[1];
      if (/binance\.vision/.test(u)) return Promise.resolve({ data: klines(BARS, IVMSMAP[iv] || 36e5) });
      return Promise.reject(new Error("harness: only the kline and futures hosts are stubbed"));
    }
  },
  DLAPP: {}
};
const RAF = [], LATER = [];
global.window.window = global.window;
global.URL = { createObjectURL: () => "blob:x", revokeObjectURL() { } };

/* ---------- load the engine, then the studies layer ---------- */
eval(fs.readFileSync(path.join(__dirname, "..", "layers", "46-dexchart.js"), "utf8"));
const BASE = global.window.DXC.indicators().length;
eval(fs.readFileSync(path.join(__dirname, "..", "layers", "51-dxstudies.js"), "utf8"));
const DXC = global.window.DXC, DXS = global.window.DXSTUDIES;

function flush() { while (RAF.length) { const f = RAF.shift(); f(0); } }
function tick() { return new Promise(r => setImmediate(r)); }
async function settle(n) { for (let i = 0; i < (n || 12); i++) { await tick(); flush(); } }

let fails = 0;
function ok(name, cond, extra) {
  if (!cond) { fails++; console.log("  ✖ " + name + (extra ? "  " + JSON.stringify(extra).slice(0, 400) : "")); }
  else console.log("  ✓ " + name);
}

/* did THIS study put anything on the chart, or say honestly why not? */
function outputOf(st) {
  const geo = DXC.geometry();
  if (!geo) return null;
  const pools = [].concat(geo.rowsFor || [], ...geo.layout.slice(1).map(p => p.rows || []));
  const hit = pools.filter(r => r.st.id === st.id)[0];
  return hit ? hit.r : null;
}

/* ---------- a hand-built series with the market structures planted in it ----------
   The synthetic klines above trend too cleanly to contain a double top, an
   imbalance or a displacement candle, so the five market-structure studies would
   pass a "did it throw?" test while finding nothing at all. This fixture plants
   each structure at a known bar index and the assertions name that index. */
function ramp(a, b, n) { const o = []; for (let i = 1; i <= n; i++) o.push(a + (b - a) * i / n); return o; }
function fixture() {
  let cl = [100];
  cl = cl.concat(ramp(100, 120, 15));   // rise to the first top
  cl = cl.concat(ramp(120, 112, 12));   // pullback, leaving a swing low at 112
  cl = cl.concat(ramp(112, 120, 18));   // back to the SAME high — the equal highs
  cl = cl.concat(ramp(120, 117, 7));    // roll off it
  const sweep = cl.length;
  cl = cl.concat([116]);                // a bar that wicks through both tops and closes inside
  cl = cl.concat(ramp(116, 114, 3));
  const dispDn = cl.length;
  cl = cl.concat([104]);                // displacement down through the 112 swing low
  cl = cl.concat(ramp(104, 113, 9));
  cl = cl.concat(ramp(113, 103, 16));   // a LOWER low reached on a shallower slope
  cl = cl.concat(ramp(103, 112, 10));
  cl = cl.concat(ramp(112, 109, 6));
  const dispUp = cl.length;
  cl = cl.concat([120]);                // displacement up through the 112 swing high
  cl = cl.concat(ramp(120, 122, 8));    // room for the last swings to confirm
  const bs = [];
  for (let i = 0; i < cl.length; i++) {
    const o = i ? cl[i - 1] : cl[0], c = cl[i], w = 0.18;
    bs.push({ t: Date.UTC(2026, 0, 1) + i * 36e5, o, h: Math.max(o, c) + w, l: Math.min(o, c) - w, c, v: 1000 + (i % 7) * 60 });
  }
  bs[sweep].h = 121.6;
  return { bs, sweep, dispDn, dispUp };
}
function defaultsOf(k) { const p = {}; DXC.studyDefs()[k].in.forEach(x => p[x.k] = x.d); return p; }
function runOn(bs, k, over) {
  const p = defaultsOf(k);
  if (over) Object.keys(over).forEach(x => p[x] = over[x]);
  return DXC.studyDefs()[k].calc(bs, p, {}, { i0: 0, n: bs.length });
}
function marksOf(r, kind) {
  const o = [];
  (r.rows || []).filter(x => x.kind === kind).forEach(x => x.data.forEach((m, i) => { if (m) o.push({ i, m }); }));
  return o;
}

/* ---------- one series per candlestick formation, so the count is a fact ---------- */
function B(o, h, l, c) { return { o, h, l, c }; }
function patSeries(dir, pat) {
  const bs = [];
  /* the context ramps INTO 100 so the pattern bars that follow continue the trend
     the hammer / hanging-man / tweezer rules read, instead of fighting it */
  for (let i = 0; i < 10; i++) { const c = 100 - dir * (9 - i) * 0.4, o = c - dir * 0.4; bs.push({ t: i * 36e5, o, h: Math.max(o, c) + 0.1, l: Math.min(o, c) - 0.1, c, v: 100 }); }
  pat.forEach((b, j) => bs.push({ t: (10 + j) * 36e5, o: b.o, h: b.h, l: b.l, c: b.c, v: 100 }));
  return bs;
}
const PATTERNS = [
  /* opened above the previous close, so the bar cannot also read as an engulfing */
  ["Hammer", -1, [B(100.2, 100.9, 97.2, 100.7)]],
  ["Hanging Man", 1, [B(100, 100.7, 97, 100.5)]],
  /* and with no lower shadow at all, so it cannot also read as a tweezer bottom */
  ["Inv Hammer", -1, [B(100.2, 104, 100.2, 100.7)]],
  ["Shooting Star", 1, [B(100, 104, 99.8, 100.5)]],
  ["Doji", 1, [B(100, 101, 99, 100.01)]],
  ["Dragonfly", 1, [B(100, 100.05, 97, 100.01)]],
  ["Gravestone", 1, [B(100, 103, 99.95, 100.01)]],
  ["Marubozu ↑", 1, [B(100, 104.02, 99.98, 104)]],
  ["Marubozu ↓", -1, [B(104, 104.02, 99.98, 100)]],
  ["Spinning Top", 1, [B(100, 102, 98, 100.8)]],
  ["Bull Engulf", -1, [B(101, 101.2, 99.8, 100), B(99.9, 101.4, 99.7, 101.2)]],
  ["Bear Engulf", 1, [B(100, 101.2, 99.8, 101), B(101.1, 101.3, 99.6, 99.8)]],
  ["Bull Harami", -1, [B(105, 105.2, 99.8, 100), B(101, 104.2, 100.8, 104)]],
  ["Bear Harami", 1, [B(100, 105.2, 99.8, 105), B(104, 104.2, 100.8, 101)]],
  ["Harami Cross", 1, [B(100, 105.2, 99.8, 105), B(102, 103.4, 101.6, 102.02)]],
  ["Piercing", -1, [B(105, 105.2, 99.8, 100), B(99.5, 103.2, 99.4, 103)]],
  ["Dark Cloud", 1, [B(100, 105.2, 99.8, 105), B(105.5, 105.6, 101.8, 102)]],
  ["Morning Star", -1, [B(110, 110.2, 103.8, 104), B(103, 103.6, 102.6, 103.2), B(103.5, 108.2, 103.4, 108)]],
  ["Evening Star", 1, [B(104, 110.2, 103.8, 110), B(111, 111.4, 110.4, 110.8), B(110.5, 110.6, 105.8, 106)]],
  ["3 Soldiers", 1, [B(100, 104.1, 99.9, 104), B(102, 107.1, 101.9, 107), B(105, 110.1, 104.9, 110)]],
  ["3 Crows", -1, [B(110, 110.1, 105.9, 106), B(108, 108.1, 102.9, 103), B(105, 105.1, 99.9, 100)]],
  ["3 Inside Up", -1, [B(110, 110.2, 103.8, 104), B(105, 108.2, 104.8, 108), B(108, 112.2, 107.8, 112)]],
  ["3 Inside Down", 1, [B(104, 110.2, 103.8, 110), B(108, 108.2, 104.8, 105), B(105, 105.2, 99.8, 100)]],
  ["Bull Kicker", -1, [B(105, 105.2, 99.8, 100), B(105.5, 110.2, 105.4, 110)]],
  ["Bear Kicker", 1, [B(100, 105.2, 99.8, 105), B(99.5, 99.6, 94.8, 95)]],
  ["Tweezer Top", 1, [B(100, 102.2, 99.8, 102), B(102.1, 102.21, 100.3, 100.5)]],
  ["Tweezer Bottom", -1, [B(102, 102.2, 99.8, 100), B(99.9, 101.7, 99.79, 101.5)]],
  ["Inside Bar", 1, [B(100, 105.2, 99.8, 105), B(102, 103.5, 101.5, 103)]],
  ["Outside Bar", 1, [B(100, 100.7, 99.8, 100.5), B(100.3, 102, 99, 101.5)]]
];

(async () => {
  console.log("DexChart studies harness · engine had " + BASE + " · layer 51 registered " + (DXS ? DXS.count : 0) +
    " · engine now reports " + DXC.indicators().length);

  ok("layer 51 published its manifest", !!DXS && DXS.__v === 1 && Array.isArray(DXS.keys));
  ok("the engine refused none of them", !!DXS && DXS.refused.length === 0, DXS ? DXS.refused : null);
  ok("every registered key is in DXC.indicators()", !!DXS && DXS.keys.every(k => DXC.indicators().indexOf(k) >= 0),
    DXS ? DXS.keys.filter(k => DXC.indicators().indexOf(k) < 0) : null);
  ok("the engine's own 65 studies are untouched", BASE === 65 && DXC.indicators().length === BASE + (DXS ? DXS.count : 0),
    { base: BASE, now: DXC.indicators().length, added: DXS ? DXS.count : 0 });
  ok("every def carries a name, a group, an input list and a calc", !!DXS && DXS.keys.every(k => {
    const d = DXC.studyDefs()[k];
    return d && typeof d.calc === "function" && d.name && d.g && Array.isArray(d.in);
  }));
  ok("a second load of the layer is a no-op", (() => {
    const before = DXC.indicators().length;
    eval(fs.readFileSync(path.join(__dirname, "..", "layers", "51-dxstudies.js"), "utf8"));
    return DXC.indicators().length === before;
  })());

  ok("the layer mounted onto the host", DXC.mount() === true);
  DXC.draw();
  flush();
  await settle(14);
  ok("candles arrived through the data path", DXC.bars().length > 500, { bars: DXC.bars().length, jgets });

  /* ---------- one at a time, on a clean chart ---------- */
  const keep = DXC.studies().slice();
  const one = [], dirty = [];
  for (const k of DXS.keys) {
    DXC.studies().length = 0;
    DXC.clearErrors(); ops = 0;
    const st = DXC.addStudy(k);
    flush(); DXC.paint();
    await settle(6);
    DXC.paint();
    const r = outputOf(st);
    const errs = DXC.errors();
    const drew = !!r && ((r.rows || []).length > 0 || (r.levels || []).length > 0 || !!r.note);
    if (errs.length || !drew || ops < 120) one.push({ k, errs: errs.slice(0, 2), drew, ops, rows: r ? (r.rows || []).length : -1, note: r ? r.note : null });
    /* a value a window cannot support must be null — never NaN, never Infinity */
    if (r) for (const row of (r.rows || [])) {
      for (const a of [row.data, row.a, row.b]) {
        if (!a) continue;
        for (const v of a) {
          if (v == null) continue;
          if (typeof v === "number" && !isFinite(v)) { dirty.push({ k, kind: row.kind || "line", v: String(v) }); break; }
          if (typeof v === "object" && v.v != null && !isFinite(v.v)) { dirty.push({ k, kind: row.kind || "line", v: "marker " + v.v }); break; }
        }
      }
    }
  }
  ok("all " + DXS.keys.length + " studies register, compute, paint and produce rows or a note", one.length === 0, one.slice(0, 8));
  ok("no study emits NaN or Infinity anywhere in a row", dirty.length === 0, dirty.slice(0, 8));

  /* nothing may be invented before its window has filled */
  const early = ["t3", "trima", "zlema", "vidya", "zscore", "lrslope", "lrr2", "pctrank", "ulcer", "gkvol", "smi", "tsi", "cmo"]
    .filter(k => { const r = runOn(DXC.bars(), k); const d = (r.rows || [])[0]; return !d || !d.data || d.data[0] != null; });
  ok("a window that has not filled yet reports null, not a guess", early.length === 0, early);

  /* ---------- all of them at once ---------- */
  DXC.studies().length = 0;
  DXS.keys.forEach(k => DXC.addStudy(k));
  DXC.clearErrors(); ops = 0;
  flush(); DXC.paint();
  await settle(10);
  DXC.paint();
  ok("all " + DXS.keys.length + " together render with no error", DXC.errors().length === 0, DXC.errors().slice(0, 6));
  ok("rendering them all still issues canvas work", ops > 2000, { ops });
  const geoAll = DXC.geometry();
  ok("each one owns a pane or an overlay slot", !!geoAll && (geoAll.rowsFor.length + geoAll.layout.slice(1).reduce((a, p) => a + (p.rows || []).length, 0)) === DXS.keys.length,
    { overlays: geoAll ? geoAll.rowsFor.length : -1, panes: geoAll ? geoAll.layout.length - 1 : -1 });

  /* ---------- Day mode ---------- */
  MODE = "day"; DXC.clearErrors(); ops = 0; DXC.paint();
  ok("Day mode renders every study", ops > 2000 && DXC.errors().length === 0, DXC.errors().slice(0, 4));
  MODE = "dark";

  /* ---------- a 20-bar series: nothing may throw on a window that cannot fill ---------- */
  BARS = 20;
  DXC.setInterval("15m");
  flush(); await settle(14);
  DXC.clearErrors(); ops = 0;
  DXC.paint();
  ok("20 bars load", DXC.bars().length === 20, { bars: DXC.bars().length });
  ok("all " + DXS.keys.length + " studies together survive 20 bars", DXC.errors().length === 0, DXC.errors().slice(0, 6));
  const shortFail = [];
  for (const k of DXS.keys) {
    DXC.studies().length = 0;
    DXC.clearErrors();
    DXC.addStudy(k);
    flush(); DXC.paint();
    if (DXC.errors().length) shortFail.push({ k, errs: DXC.errors().slice(0, 2) });
  }
  ok("each study alone on 20 bars throws nothing", shortFail.length === 0, shortFail.slice(0, 8));
  /* and on a two-bar and a one-bar series, called directly */
  const tiny = [];
  for (const k of DXS.keys) {
    for (const n of [1, 2, 3]) {
      try { runOn(DXC.bars().slice(0, n), k); } catch (e) { tiny.push({ k, n, e: String(e.message || e) }); }
    }
  }
  ok("no study throws on a 1, 2 or 3 bar series", tiny.length === 0, tiny.slice(0, 6));
  BARS = 900;
  DXC.setInterval("1h");
  flush(); await settle(14);

  /* ---------- the market structures, on the fixture that contains them ---------- */
  const F = fixture(), FB = F.bs;
  const sweeps = marksOf(runOn(FB, "liqsweep", { lb: 3, tol: 0.5, span: 60 }), "labels");
  ok("Liquidity Sweeps finds the planted sweep, at the planted bar and level",
    sweeps.length === 1 && sweeps[0].i === F.sweep && Math.abs(sweeps[0].m.v - 120.18) < 0.5 && /swept high/.test(sweeps[0].m.txt),
    sweeps.map(s => ({ i: s.i, v: +s.m.v.toFixed(2), txt: s.m.txt })));
  const ms = marksOf(runOn(FB, "mstruct"), "labels");
  ok("Market Structure separates BOS from CHoCH and breaks at the displacement bars",
    ms.some(x => x.m.txt === "BOS" && x.i === F.dispDn) && ms.some(x => x.m.txt === "CHoCH" && x.i === F.dispUp),
    ms.map(x => x.i + ":" + x.m.txt));
  const obR = runOn(FB, "oblocks"), obL = marksOf(obR, "labels");
  /* the last BULLISH candle before the down displacement, and the last BEARISH one
     before the up displacement — that is what an order block is */
  const lastOpp = (idx, wantBull) => { for (let j = idx - 1; j >= idx - 12; j--) { if ((FB[j].c > FB[j].o) === wantBull) return j; } return -1; };
  ok("Order Blocks marks the last opposite candle before each displacement",
    obL.length === 2 &&
    obL.some(x => x.m.txt === "OB−" && x.i === lastOpp(F.dispDn, true)) &&
    obL.some(x => x.m.txt === "OB+" && x.i === lastOpp(F.dispUp, false)),
    { found: obL.map(x => x.i + ":" + x.m.txt), expect: [lastOpp(F.dispDn, true), lastOpp(F.dispUp, false)] });
  ok("Order Blocks draws a band per block with a real top and bottom",
    (obR.rows || []).filter(r => r.kind === "band").length === 2 &&
    (obR.rows || []).filter(r => r.kind === "band").every(r => r.a.some((v, i) => v != null && r.b[i] != null && v > r.b[i])));
  const fv = runOn(FB, "fvg"), fvBands = (fv.rows || []).filter(r => r.kind === "band");
  ok("Fair Value Gaps finds gaps whose top is above their bottom",
    fvBands.length > 0 && fvBands.every(r => r.a.some((v, i) => v != null && r.b[i] != null && v > r.b[i])), { gaps: fvBands.length });
  const dv = marksOf(runOn(FB, "diverg", { lb: 3, span: 90 }), "labels");
  ok("Divergence finds the planted regular bullish divergence at the lower low",
    dv.some(x => x.m.txt === "Bull" && x.i > 75 && x.i < 90), dv.map(x => x.i + ":" + x.m.txt));
  const fr = marksOf(runOn(FB, "fractals"), "shapes");
  ok("Fractals marks the turning points and nothing in between", fr.length >= 6 && fr.length <= 14, { marks: fr.length });
  const pd = runOn(FB, "premdisc");
  ok("Premium / Discount puts equilibrium exactly midway between the range extremes",
    pd.levels.length === 3 && Math.abs(pd.levels[1].v - (pd.levels[0].v + pd.levels[2].v) / 2) < 1e-9,
    pd.levels.map(l => +l.v.toFixed(2)));
  const af = runOn(FB, "autofib");
  ok("Auto Fibonacci brackets the swing it measured (0% and 100% are its ends)",
    af.levels.length === 7 && Math.abs(af.levels[0].v - af.levels[6].v) > 1, af.levels.map(l => l.label + "=" + l.v.toFixed(1)));
  const sr = runOn(FB, "autosr", { lb: 3, tol: 0.8, min: 2, max: 6 });
  ok("Auto S&R returns clustered levels with a touch count in the label",
    sr.levels.length > 0 && sr.levels.every(l => /^[SR] ×\d+$/.test(l.label)), sr.levels.map(l => l.label + "@" + l.v.toFixed(1)));

  /* ---------- every candlestick formation the study claims to name ---------- */
  const missed = [];
  for (const [want, dir, pat] of PATTERNS) {
    const bs = patSeries(dir, pat);
    const r = DXC.studyDefs().candlepat.calc(bs, { side: "both", neutral: "on", txt: "on" }, {}, null);
    const lab = (r.rows || []).filter(x => x.kind === "labels")[0];
    const nm = lab && lab.data[bs.length - 1] ? lab.data[bs.length - 1].txt : null;
    if (nm !== want) missed.push(want + " → " + nm);
  }
  ok("Candlestick Patterns names all " + PATTERNS.length + " formations on a series built for each", missed.length === 0, missed.slice(0, 8));
  const bullOnly = DXC.studyDefs().candlepat.calc(FB, { side: "bullish only", neutral: "off", txt: "on" }, {}, null);
  const bearOnly = DXC.studyDefs().candlepat.calc(FB, { side: "bearish only", neutral: "off", txt: "on" }, {}, null);
  ok("the bullish-only and bearish-only filters actually filter",
    marksOf(bullOnly, "shapes").every(x => x.m.s === "down") && marksOf(bearOnly, "shapes").every(x => x.m.s === "up") &&
    marksOf(bullOnly, "shapes").length > 0 && marksOf(bearOnly, "shapes").length > 0);

  /* ---------- TD Sequential ---------- */
  const td = marksOf(runOn(DXC.bars(), "tdseq"), "labels");
  ok("TD Sequential prints completed 9 setups and reaches a 13 countdown",
    td.some(x => x.m.txt === "9") && td.some(x => x.m.txt === "13"),
    { nines: td.filter(x => x.m.txt === "9").length, thirteens: td.filter(x => x.m.txt === "13").length });

  /* ---------- Technical Rating ---------- */
  const tr = runOn(DXC.bars(), "techrating");
  const trAll = tr.rows.filter(r => r.name === "All")[0].data;
  const trMa = tr.rows.filter(r => r.name === "Moving averages")[0].data;
  const trOs = tr.rows.filter(r => r.name === "Oscillators")[0].data;
  ok("Technical Rating stays inside [-1, 1]", trAll.every(v => v == null || (v >= -1 && v <= 1)));
  ok("Technical Rating's halves are plotted separately and average to the whole",
    trAll.every((v, i) => v == null || trMa[i] == null || trOs[i] == null || Math.abs(v - (trMa[i] + trOs[i]) / 2) < 1e-9));
  ok("Technical Rating actually moves (it is not a constant)", new Set(trAll.filter(v => v != null).map(v => v.toFixed(3))).size > 8);

  /* ---------- Relative Volume's two modes ---------- */
  const rv1h = runOn(DXC.bars(), "rvol").rows[0].name;
  ok("RVOL says in the legend which comparison it is using", /same slot/.test(rv1h), rv1h);
  const daily = DXC.bars().map((b, i) => ({ t: Date.UTC(2026, 0, 1) + i * 864e5, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
  ok("RVOL falls back to a trailing mean when a bar is a day or longer, and says so",
    /trailing mean/.test(runOn(daily, "rvol").rows[0].name));

  /* ---------- Trading Sessions ---------- */
  const ss = runOn(DXC.bars(), "sessions").rows[0];
  ok("Trading Sessions paints only inside its configured UTC hours", ss.kind === "bg" &&
    ss.data.every((c, i) => { const h = new Date(DXC.bars()[i].t).getUTCHours(); return c ? h < 21 : h >= 21; }));
  ok("Trading Sessions refuses a daily bar rather than inventing a session",
    !!runOn(daily, "sessions").note);

  /* ---------- the four network studies, both paths ---------- */
  const DV = ["dvfund", "dvoi", "dvls", "dvbasis"];
  DXC.studies().length = 0;
  DXC.clearErrors();
  const dvSt = DV.map(k => DXC.addStudy(k));
  flush(); DXC.paint();
  await settle(16);
  DXC.paint();
  const answered = DV.map((k, i) => {
    const r = outputOf(dvSt[i]);
    const row = r && (r.rows || [])[0];
    const data = row && row.data;
    const pts = data ? data.filter(v => v != null && isFinite(v)).length : 0;
    return { k, kind: row ? row.kind : null, pts, note: r ? r.note : "no result" };
  });
  ok("BTCUSDT: all four derivatives studies aligned a real series onto the bars",
    answered.every(a => a.pts > 10 && !a.note), answered);
  ok("the derivatives fetches went to fapi.binance.com", fapiHits >= 4, { fapiHits });
  ok("no error surfaced while the futures data landed", DXC.errors().length === 0, DXC.errors().slice(0, 4));

  global.window.S.coin = "ZZZ";
  DXC.studies().length = 0;
  DXC.clearErrors();
  DXC.draw(); flush(); await settle(16);
  const dvSt2 = DV.map(k => DXC.addStudy(k));
  flush(); DXC.paint();
  await settle(16);
  DXC.paint();
  const refused = DV.map((k, i) => {
    const r = outputOf(dvSt2[i]);
    if (!r) return { k, note: "no result" };
    const numeric = (r.rows || []).some(row => (row.data || []).some(v => typeof v === "number" && isFinite(v)));
    return { k, note: r.note, numeric };
  });
  ok("a symbol with no perpetual returns an honest note and invents no series",
    refused.every(x => x.note && /unavailable|no perpetual|no series/i.test(String(x.note)) && !x.numeric), refused);
  ok("the refused symbol was actually refused by the stub", fapiRefused >= 4, { fapiRefused });
  global.window.S.coin = "BTC";
  DXC.draw(); flush(); await settle(14);

  /* ---------- the cache must still be bounded with 68 more definitions ---------- */
  DXC.studies().length = 0;
  keep.forEach(s => DXC.studies().push(s));
  DXC.clearErrors();
  for (let i = 0; i < 40; i++) { DXC.cfg().studies[1].p.len = 10 + i; DXC.paint(); }
  ok("repeated recompute leaks no error", DXC.errors().length === 0, DXC.errors().slice(0, 4));

  console.log(fails ? "\nFAILED · " + fails + " check(s)" : "\nall checks passed · " + DXS.count + " studies added · " + DXC.indicators().length + " total");
  process.exit(fails ? 1 : 0);
})();
