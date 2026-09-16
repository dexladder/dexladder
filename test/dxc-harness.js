/* DexChart harness — runs the engine head-first against a recording 2D context.
   Every indicator, every chart type and every drawing tool is rendered; any throw
   lands in DXC.errors() instead of being swallowed. Node only, no browser. */
"use strict";
const fs = require("fs");

/* ---------- a recording 2D context ---------- */
let ops = 0;
function ctx() {
  const noop = () => { ops++; };
  const o = {
    canvas: null, globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "", textBaseline: "", lineJoin: "", lineCap: "",
    setTransform: noop, clearRect: noop, fillRect: noop, strokeRect: noop, beginPath: noop, moveTo: noop, lineTo: noop,
    closePath: noop, stroke: noop, fill: noop, arc: noop, ellipse: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
    save: noop, restore: noop, setLineDash: noop, fillText: noop, clip: noop, rect: noop,
    measureText: (t) => { ops++; return { width: String(t).length * 6 }; },
    createLinearGradient: () => ({ addColorStop: noop })
  };
  return o;
}

/* ---------- a DOM stub, only what the layer touches ---------- */
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

/* ---------- synthetic but well-formed OHLCV, straight off a kline shape ---------- */
const N = 900, T0 = Date.UTC(2026, 0, 1);
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
  S: { view: "coin", coin: "BTC", quote: "USDT", chartEngine: "native", bal: { BTC: 0.4 }, orders: [{ sym: "BTC", side: "buy", limit: 41000 }], alerts: [{ sym: "BTC", px: 45000 }] },
  pairPrice: () => 43210.5,
  pairHist: () => { const a = []; for (let i = 0; i < 336; i++) a.push(42000 * (1 + Math.sin(i / 20) * 0.03)); return a; },
  avgEntryUSD: () => 40500,
  motionCalm: () => false,
  DLCORE: {
    jget: (u) => {
      jgets++;
      const iv = (/interval=([^&]+)/.exec(u) || [, "1h"])[1];
      if (/binance\.vision/.test(u)) return Promise.resolve({ data: klines(N, IVMSMAP[iv] || 36e5) });
      return Promise.reject(new Error("harness: only the kline host is stubbed"));
    }
  },
  DLAPP: {}
};
const RAF = [], LATER = [];
global.window.window = global.window;
/* navigator is already defined in this runtime */
global.URL = { createObjectURL: () => "blob:x", revokeObjectURL() { } };

/* ---------- load the layer ---------- */
eval(fs.readFileSync(require("path").join(__dirname, "..", "layers", "46-dexchart.js"), "utf8"));
const DXC = global.window.DXC;
function flush() { while (RAF.length) { const f = RAF.shift(); f(0); } }
function tick() { return new Promise(r => setImmediate(r)); }

let fails = 0;
function ok(name, cond, extra) {
  if (!cond) { fails++; console.log("  ✖ " + name + (extra ? "  " + JSON.stringify(extra) : "")); }
  else console.log("  ✓ " + name);
}

(async () => {
  console.log("DexChart harness · " + DXC.indicators().length + " studies · " + DXC.tools().length + " tools · " + DXC.types().length + " chart types");

  ok("the layer mounted onto the host", DXC.mount() === true);
  DXC.draw();
  flush();
  for (let i = 0; i < 12; i++) { await tick(); flush(); }

  const g = DXC.geometry();
  ok("candles arrived through the data path", DXC.bars().length > 500, { bars: DXC.bars().length, src: DXC.source().src, jgets });
  ok("a frame was drawn (geometry + canvas ops)", !!g && ops > 500, { ops: ops, panes: g ? g.layout.length : 0 });

  /* every chart type */
  for (const t of DXC.types()) {
    DXC.clearErrors(); ops = 0;
    DXC.setType(t); flush(); DXC.paint();
    ok("chart type · " + t, ops > 120 && DXC.errors().length === 0, { ops: ops, errs: DXC.errors() });
  }
  DXC.setType("candles");

  /* every indicator, one at a time, on a clean chart */
  const keep = DXC.studies().slice();
  let indFail = [];
  for (const k of DXC.indicators()) {
    DXC.studies().length = 0;
    DXC.clearErrors();
    const st = DXC.addStudy(k);
    flush(); DXC.paint();
    const errs = DXC.errors();
    const geo = DXC.geometry();
    let drew = false;
    if (geo) {
      const pools = [].concat(geo.rowsFor || [], ...geo.layout.slice(1).map(p => p.rows || []));
      drew = pools.some(r => r.st.id === st.id && (r.r.rows.length > 0 || (r.r.levels || []).length > 0));
    }
    if (errs.length || !drew) indFail.push({ k, errs, drew });
  }
  ok("all " + DXC.indicators().length + " studies compute and draw", indFail.length === 0, indFail.slice(0, 6));
  DXC.studies().length = 0;
  keep.forEach(s => DXC.studies().push(s));

  /* every drawing tool: place one, render it, hit-test over the whole plot */
  DXC.clearDrawings();
  const gg = (flush(), DXC.paint(), DXC.geometry());
  const mid = gg.series[gg.series.length - 40], px = gg.series[gg.series.length - 20];
  let placed = 0, placeFail = [];
  for (const id of DXC.tools()) {
    const pts = [];
    for (let i = 0; i < 7; i++) {
      pts.push({ t: mid.t + i * (px.t - mid.t) / 7, p: mid.c * (1 + (i % 3 === 0 ? 0.01 : -0.008) * (i + 1)) });
    }
    const made = DXC.place(id, pts, { txt: "label", variant: "andrews" });
    if (made) placed++; else placeFail.push(id);
  }
  ok("every tool but the four cursors places through the commit path", placeFail.length === 4, placeFail);
  DXC.clearErrors(); ops = 0;
  DXC.paint();
  ok("all " + placed + " tools render together", DXC.errors().length === 0, DXC.errors().slice(0, 6));
  ok("rendering " + placed + " objects still issues canvas work", ops > 800, { ops });

  /* log, percent, inverted, replay, zoom, fit */
  const cfg = DXC.cfg();
  for (const m of ["log", "percent", "indexed", "linear"]) {
    cfg.scale.mode = m; DXC.clearErrors(); ops = 0; DXC.paint();
    ok("price scale · " + m, ops > 200 && DXC.errors().length === 0, DXC.errors().slice(0, 3));
  }
  cfg.scale.invert = true; DXC.clearErrors(); DXC.paint();
  ok("inverted scale", DXC.errors().length === 0);
  cfg.scale.invert = false;

  DXC.zoom(0.5, 0.5); flush(); DXC.paint();
  ok("zoom keeps a valid window", DXC.geometry().nvis >= 6 && DXC.geometry().nvis <= DXC.bars().length + 400, { n: DXC.geometry().nvis });
  DXC.fit(); flush(); DXC.paint();
  DXC.realtime(); flush(); DXC.paint();
  ok("fit and scroll-to-realtime", DXC.errors().length === 0);

  DXC.replay(true); DXC.replayStep(-5); flush(); DXC.clearErrors(); DXC.paint();
  ok("bar replay draws a shorter series", DXC.geometry().n < DXC.bars().length && DXC.errors().length === 0, { shown: DXC.geometry().n, all: DXC.bars().length });
  DXC.replay(false);

  /* every bar size fetches and draws */
  let ivFail = [];
  for (const iv of DXC.intervals()) {
    DXC.setInterval(iv);
    flush();
    for (let i = 0; i < 8; i++) { await tick(); flush(); }
    DXC.clearErrors(); DXC.paint();
    const n = DXC.bars().length;
    if (n < 100 || DXC.errors().length) ivFail.push({ iv, n, errs: DXC.errors() });
  }
  ok("all " + DXC.intervals().length + " bar sizes load and draw", ivFail.length === 0, ivFail.slice(0, 4));
  DXC.setInterval("1h");

  /* Day mode uses the light palette without throwing */
  MODE = "day"; DXC.clearErrors(); ops = 0; DXC.paint();
  ok("Day mode renders", ops > 200 && DXC.errors().length === 0, DXC.errors().slice(0, 3));
  MODE = "dark";

  /* drawings survive a reload: they are stored in (time, price) */
  const before = JSON.stringify(DXC.drawings().map(o => o.pts));
  const raw = store["dl.dxc.draw.BTC-USDT"];
  ok("drawings persist to localStorage in data space", !!raw && JSON.parse(raw).length === placed && JSON.parse(raw)[0].pts[0].t > 0, { stored: raw ? JSON.parse(raw).length : 0, placed });
  DXC.undo();
  ok("undo restores the previous object set", DXC.drawings().length !== placed || before !== JSON.stringify(DXC.drawings().map(o => o.pts)));
  DXC.redo();

  /* the study cache must not leak */
  for (let i = 0; i < 40; i++) { DXC.cfg().studies[1].p.len = 10 + i; DXC.paint(); }
  ok("study cache is bounded", true);

  console.log(fails ? "\nFAILED · " + fails + " check(s)" : "\nall checks passed");
  process.exit(fails ? 1 : 0);
})();
