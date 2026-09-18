/* DexChart tools harness — layers/52-dxtools.js, head-first, against a recording
   2D context. Every tool this layer registers is placed through the engine's own
   commit path, painted, hit-tested and then reloaded out of localStorage. Any
   throw lands in DXC.errors() instead of being swallowed. Node only, no browser.
   Modelled on test/dxc-harness.js — same context, same DOM stub, same loader. */
"use strict";
const fs = require("fs");
const path = require("path");

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

/* localStorage survives the simulated reload — that is the whole point of it */
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

const TOASTS = [];
const RAF = [], LATER = [];
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
  S: { view: "coin", coin: "BTC", quote: "USDT", chartEngine: "native", bal: { BTC: 0.4, USDT: 25000 }, orders: [{ sym: "BTC", side: "buy", limit: 41000 }], alerts: [{ sym: "BTC", px: 45000 }] },
  pairPrice: () => 43210.5,
  pairHist: () => { const a = []; for (let i = 0; i < 336; i++) a.push(42000 * (1 + Math.sin(i / 20) * 0.03)); return a; },
  avgEntryUSD: () => 40500,
  motionCalm: () => false,
  DLCORE: {
    jget: (u) => {
      const iv = (/interval=([^&]+)/.exec(u) || [, "1h"])[1];
      if (/binance\.vision/.test(u)) return Promise.resolve({ data: klines(N, IVMSMAP[iv] || 36e5) });
      return Promise.reject(new Error("harness: only the kline host is stubbed"));
    },
    /* the alert path layer 52 says it raises through — captured, not stubbed out */
    toast: (kind, title, msg) => { TOASTS.push({ kind, title, msg }); },
    sfx: () => { }
  },
  DLAPP: {}
};
global.window.window = global.window;
global.URL = { createObjectURL: () => "blob:x", revokeObjectURL() { } };

/* ---------- load the layers: the engine first, then the extension ---------- */
const LDIR = path.join(__dirname, "..", "layers");
let BASE = 0;
function loadLayers() {
  eval(fs.readFileSync(path.join(LDIR, "46-dexchart.js"), "utf8"));
  /* what the engine shipped on its own, measured rather than assumed: 71
     placeable tools plus the four cursors */
  BASE = global.window.DXC.tools().length;
  eval(fs.readFileSync(path.join(LDIR, "52-dxtools.js"), "utf8"));
}
loadLayers();
let DXC = global.window.DXC;
let DXT = global.window.DXTOOLS;
function flush() { while (RAF.length) { const f = RAF.shift(); f(0); } }
function tick() { return new Promise(r => setImmediate(r)); }
async function settle(n) { flush(); for (let i = 0; i < (n || 12); i++) { await tick(); flush(); } }

let fails = 0, checks = 0;
function ok(name, cond, extra) {
  checks++;
  if (!cond) { fails++; console.log("  ✖ " + name + (extra ? "  " + JSON.stringify(extra) : "")); }
}
function okv(name, cond, extra) {
  checks++;
  if (!cond) { fails++; console.log("  ✖ " + name + (extra ? "  " + JSON.stringify(extra) : "")); }
  else console.log("  ✓ " + name);
}

/* anchors for a tool that wants n of them: real bar times, prices around the
   close, alternating above and below so a shape has something to enclose */
function anchors(n, g) {
  const s = g.series, base = Math.max(0, s.length - 120), out = [];
  const k = Math.max(1, n | 0);
  for (let i = 0; i < k; i++) {
    const b = s[Math.min(s.length - 1, base + i * 13)];
    out.push({ t: b.t, p: b.c * (1 + (i % 2 ? -0.014 : 0.018) * ((i % 3) + 1) / 2) });
  }
  return out;
}

(async () => {
  console.log("DexChart tools harness");
  ok("the engine mounted", DXC.mount() === true);
  DXC.draw();
  await settle(14);

  const g0 = DXC.geometry();
  okv("candles arrived", DXC.bars().length > 500, { bars: DXC.bars().length });
  okv("layer 52 loaded and reports itself", !!DXT && DXT.ok === true && DXT.__v === 165, { v: DXT && DXT.__v, ok: DXT && DXT.ok });

  const MINE = DXT.tools();
  const DEFS = DXC.toolDefs();
  okv("every id this layer asked for registered", DXT.registered() === MINE.length, { asked: MINE.length, registered: DXT.registered() });
  okv(MINE.length + " new tools on top of the engine's " + BASE + " — " + DXC.tools().length + " in total",
    DXC.tools().length === BASE + MINE.length, { base: BASE, total: DXC.tools().length, mine: MINE.length });

  /* the groups these tools landed in */
  const groups = {};
  MINE.forEach(id => { const dd = DEFS[id]; groups[dd.g] = (groups[dd.g] || 0) + 1; });
  console.log("  groups: " + Object.keys(groups).map(k => k + " (" + groups[k] + ")").join(", "));

  /* ---------------- one tool at a time ---------------- */
  const bad = { reg: [], place: [], ops: [], errs: [], near: [], far: [] };
  for (const id of MINE) {
    const def = DEFS[id];
    if (!def || typeof def.render !== "function" || DXC.tools().indexOf(id) < 0) { bad.reg.push(id); continue; }

    DXC.clearDrawings(); DXC.clearErrors();
    flush(); ops = 0; DXC.paint();
    const baseOps = ops;

    const g = DXC.geometry();
    const pts = anchors(def.n, g);
    const made = DXC.place(id, pts, { txt: "label", risk: 1.5 });
    if (!made) { bad.place.push(id); continue; }

    DXC.clearErrors(); ops = 0; DXC.paint();
    if (!(ops > baseOps)) bad.ops.push({ id, baseOps, ops });
    if (DXC.errors().length) bad.errs.push({ id, errs: DXC.errors().slice(0, 2) });

    /* Hit testing, measured rather than guessed at two points. A tool that tiles
       the plot (cyclic lines, session breaks) is genuinely never far away in x,
       so a fixed "far corner" probe proves nothing about it. What must be true
       of every tool is that it answers a finite number on its own anchor, that
       somewhere it is inside the engine's 7px selection tolerance — otherwise it
       cannot be clicked — and that somewhere else it clearly says "not me". */
    const gg = DXC.geometry(), sc = gg.layout[0].sc, o = DXC.drawings()[0];
    const near = DXC.kit.sxy(gg, sc, o.pts[0]);
    const dAnchor = def.hit(o, gg, sc, near.x, near.y);
    if (!(typeof dAnchor === "number" && isFinite(dAnchor))) bad.near.push({ id, dAnchor });
    let dMin = Infinity, dMax = -Infinity;
    for (let sx = 0; sx <= gg.W; sx += 25) {
      for (let sy = 0; sy <= gg.H; sy += 4) {
        const v = def.hit(o, gg, sc, sx, sy);
        if (typeof v !== "number" || Number.isNaN(v)) { dMin = NaN; break; }
        if (v < dMin) dMin = v;
        if (v > dMax) dMax = v;
      }
    }
    if (!(dMin < 7)) bad.near.push({ id, dAnchor, dMin });
    if (!(dMax > 40)) bad.far.push({ id, dMin, dMax });
  }
  okv("every tool is in the registry with a render", bad.reg.length === 0, bad.reg);
  okv("every tool places through the commit path", bad.place.length === 0, bad.place);
  okv("every tool's paint issues canvas work beyond the empty chart", bad.ops.length === 0, bad.ops.slice(0, 6));
  okv("no tool throws while rendering", bad.errs.length === 0, bad.errs.slice(0, 6));
  okv("every hit test answers a finite distance, and is selectable within 7px somewhere", bad.near.length === 0, bad.near.slice(0, 8));
  okv("every hit test answers a large distance somewhere away from the object", bad.far.length === 0, bad.far.slice(0, 8));

  /* ---------------- all of them at once ---------------- */
  DXC.clearDrawings(); DXC.clearErrors();
  flush(); ops = 0; DXC.paint();
  const emptyOps = ops;
  let placed = 0;
  for (const id of MINE) {
    const g = DXC.geometry();
    if (DXC.place(id, anchors(DEFS[id].n, g), { txt: "label", risk: 1.5 })) placed++;
  }
  DXC.clearErrors(); ops = 0; DXC.paint();
  okv("all " + placed + " render together without a fault", placed === MINE.length && DXC.errors().length === 0, DXC.errors().slice(0, 6));
  okv("rendering " + placed + " objects issues far more canvas work", ops > emptyOps * 1.2, { empty: emptyOps, withAll: ops });

  /* ---------------- a bar-size change keeps them ---------------- */
  DXC.setInterval("4h");
  await settle(10);
  DXC.clearErrors(); DXC.paint();
  okv("a bar-size change keeps every drawing and still paints", DXC.drawings().length === placed && DXC.errors().length === 0,
    { kept: DXC.drawings().length, placed, errs: DXC.errors().slice(0, 3) });
  DXC.setInterval("1h");
  await settle(10);

  /* ---------------- undo ---------------- */
  const beforeUndo = DXC.drawings().length;
  DXC.undo();
  okv("undo removes the last object", DXC.drawings().length === beforeUndo - 1, { before: beforeUndo, after: DXC.drawings().length });
  DXC.redo();
  okv("redo puts it back", DXC.drawings().length === beforeUndo);

  /* ---------------- Day mode ---------------- */
  MODE = "day"; DXC.clearErrors(); ops = 0; DXC.paint();
  okv("Day mode renders every tool", ops > 400 && DXC.errors().length === 0, DXC.errors().slice(0, 4));
  MODE = "dark"; DXC.paint();

  /* ---------------- alerts, groups and templates ---------------- */
  const target = DXC.drawings()[0];
  target.alert = { kind: "cross", dir: 0, px: DXC.bars()[DXC.bars().length - 1].c, once: true, off: false, hit: null };
  DXC.kit.saveDraws();
  DXT.refresh();
  DXC.clearErrors(); DXC.paint();
  okv("an alert on an object is stored on the object and survives a paint",
    !!DXC.drawings()[0].alert && DXC.errors().length === 0, DXC.errors().slice(0, 3));

  /* drive a real crossing: put the trigger between the last two closes */
  const bs = DXC.bars(), c1 = bs[bs.length - 1].c, c0 = bs[bs.length - 2].c;
  if (c1 !== c0) {
    const t2 = DXC.drawings()[1];
    t2.alert = { kind: "cross", dir: 0, px: (c0 + c1) / 2, once: true, off: false, hit: null };
    DXC.kit.saveDraws();
    TOASTS.length = 0;
    DXT.refresh();
    okv("a crossing fires and is raised through DLCORE.toast", TOASTS.length === 1 && !!t2.alert.hit, { toasts: TOASTS.slice(0, 1), hit: t2.alert.hit });
    okv("the fired alert is in the layer's own log too", DXT.alerts().length >= 1, DXT.alerts().slice(-1));
  }

  DXC.drawings()[2].grp = "setup";
  DXC.drawings()[3].grp = "setup";
  DXC.kit.saveDraws();
  okv("a group is read back off the objects", DXT.groups().indexOf("setup") >= 0, DXT.groups());

  DXC.kit.LS.set("dl.dxt.tpl", { thin: { c: "#B36BFF", w: 0.8, dash: 2, fill: 0.04, fs: 10 } });
  DXC.kit.LS.set("dl.dxt.tooldef", { cyclic: "thin" });
  const freshId = DXC.place("cyclic", anchors(2, DXC.geometry()));
  DXT.refresh(); DXC.paint();
  const fresh = DXC.drawings().filter(o => o.id === freshId)[0];
  okv("a tool default template styles the next drawing made with that tool",
    !!fresh && fresh.st.c === "#B36BFF" && fresh.st.w === 0.8, fresh && { c: fresh.st.c, w: fresh.st.w, tpl: fresh.st.tpl });
  const older = DXC.drawings()[0];
  okv("a drawing that was already there is not restyled behind the user's back", older.st.c !== "#B36BFF", { c: older.st.c });

  /* ---------------- a reload ---------------- */
  const raw = store["dl.dxc.draw.BTC-USDT"];
  const stored = raw ? JSON.parse(raw) : [];
  okv("every object persisted to localStorage in (time, price)",
    stored.length === DXC.drawings().length && stored[0].pts[0].t > 0 && stored[0].pts[0].p > 0,
    { stored: stored.length, live: DXC.drawings().length });
  const alertsStored = stored.filter(o => o.alert).length;
  okv("the alerts persisted with their objects", alertsStored >= 1, { alertsStored });
  okv("the groups persisted with their objects", stored.filter(o => o.grp === "setup").length === 2);

  const wanted = DXC.drawings().length;
  const sig = JSON.stringify(DXC.drawings().map(o => [o.tool, o.pts.length]));
  delete global.window.DXC;
  delete global.window.DXTOOLS;
  loadLayers();
  DXC = global.window.DXC;
  DXT = global.window.DXTOOLS;
  okv("the engine and the layer come back after a reload", !!DXC && !!DXT && DXT.ok === true);
  DXC.mount(); DXC.draw();
  await settle(14);
  DXC.clearErrors(); ops = 0; DXC.paint();
  okv("a reload restores every drawing out of localStorage", DXC.drawings().length === wanted,
    { restored: DXC.drawings().length, wanted });
  okv("the restored objects are the same tools with the same anchors",
    JSON.stringify(DXC.drawings().map(o => [o.tool, o.pts.length])) === sig);
  okv("the reloaded chart paints them without a fault", ops > 400 && DXC.errors().length === 0, DXC.errors().slice(0, 4));
  okv("the tool count is the same after a reload", DXC.tools().length === BASE + MINE.length, { base: BASE, total: DXC.tools().length });

  MODE = "day"; DXC.clearErrors(); ops = 0; DXC.paint();
  okv("Day mode renders after the reload too", ops > 400 && DXC.errors().length === 0, DXC.errors().slice(0, 4));
  MODE = "dark";

  console.log(fails
    ? "\nFAILED · " + fails + " of " + checks + " checks"
    : "\nall " + checks + " checks passed · " + MINE.length + " tools registered · " + DXC.tools().length + " tools on the engine");
  process.exit(fails ? 1 : 0);
})();
