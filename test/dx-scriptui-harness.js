/* DexScript UI harness — layer 54 driven head-first on top of the real layer 46
   engine and the real layer 53 language, against a recording 2D context.

   What it proves, in order:
     · every shipped library script COMPILES, and is named if it does not
     · every one of them RUNS over the harness bars: rows, no errors, no limit
     · every strategy script produces a trade list and finite statistics
     · a library script registers, reaches the chart through DXC.addStudy and
       paints with DXC.errors() empty
     · a user script round-trips through localStorage, export writes JSON that
       import accepts, and import names the script that does not compile
     · what is on the chart is PER MARKET: BTC's scripts do not follow USDC
     · the highlighter's spans cover every byte of the source exactly once
     · the Pine converter takes fifteen real v5 snippets, the output compiles,
       and the notes classify what was translated, approximated and refused
     · the editor opens and no node under it carries a style attribute

   ONE NOTE ON FLAKINESS, STATED RATHER THAN HIDDEN: layer 53 stops a run that
   passes a 250 ms WALL CLOCK budget, and a loaded machine can push a script
   that normally takes 4 ms past it. A run that trips that one budget is retried
   a few times before it is called a failure; every other budget (steps, loop
   depth, slots, array size) is deterministic and fails on the first pass.

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
    attrs: {}, value: "", checked: false, type: "", title: "", files: null,
    selectionStart: 0, selectionEnd: 0, scrollTop: 0, scrollLeft: 0,
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
    addEventListener(k, fn) { (e._on || (e._on = {}))[k] = fn; }, removeEventListener() { },
    setPointerCapture() { }, click() { e._clicked = (e._clicked || 0) + 1; }, focus() { },
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
const BODY = mkEl("body"), ROOT = mkEl("html"), HEAD = mkEl("head");
const NODES = {};
["coinChart", "coinHost", "rpBar"].forEach(id => { NODES[id] = mkEl(id === "coinChart" ? "canvas" : "div"); NODES[id].setAttribute("id", id); });
NODES.rpBar.attrs["data-dxc-off"] = "1";

const store = {};
global.document = {
  readyState: "complete", body: BODY, documentElement: ROOT, head: HEAD,
  /* the real document finds anything on the page by id; the fixed map alone
     would hide every dialog these layers open, so fall back to a body walk */
  getElementById: id => NODES[id] || walk(BODY, []).filter(n => n.attrs.id === id)[0] || null,
  createElement: mkEl, addEventListener(k, fn) { (DOCON[k] || (DOCON[k] = [])).push(fn); }, removeEventListener() { },
  querySelector: sel => find(BODY, sel)[0] || null,
  querySelectorAll: sel => find(BODY, sel)
};
const DOCON = {};
ROOT.getAttribute = k => (k === "data-mode" ? MODE : null);
let MODE = "dark";

/* ---------- synthetic but well-formed OHLCV ---------- */
const N = 600, T0 = Date.UTC(2026, 0, 1);
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

const RAF = [], LATER = [];
global.window = {
  devicePixelRatio: 2, innerWidth: 1400, innerHeight: 900,
  requestAnimationFrame: fn => { RAF.push(fn); return RAF.length; },
  setTimeout: (fn) => { LATER.push(fn); return LATER.length; }, clearTimeout() { }, setInterval: () => 0, clearInterval() { },
  performance: { now: () => Date.now() },
  localStorage: {
    getItem: k => (store[k] === undefined ? null : store[k]),
    setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; }
  },
  getComputedStyle: () => ({ display: "none" }),
  S: { view: "coin", coin: "BTC", quote: "USDT", chartEngine: "native", bal: {}, orders: [], alerts: [] },
  pairPrice: () => 43210.5,
  pairHist: () => { const a = []; for (let i = 0; i < 336; i++) a.push(42000); return a; },
  avgEntryUSD: () => 40500,
  motionCalm: () => false,
  Blob: function (parts) { this.parts = parts; },
  DLCORE: {
    jget: (u) => {
      const iv = (/interval=([^&]+)/.exec(u) || [, "1h"])[1];
      if (/binance\.vision/.test(u)) return Promise.resolve({ data: klines(N, IVMSMAP[iv] || 36e5) });
      return Promise.reject(new Error("harness: only the kline host is stubbed"));
    }
  },
  DLAPP: {}
};
global.window.window = global.window;
global.URL = { createObjectURL: () => "blob:x", revokeObjectURL() { } };

/* ---------- load the three layers, in the order the payload does ---------- */
const LAYERS = path.join(__dirname, "..", "layers");
eval(fs.readFileSync(path.join(LAYERS, "46-dexchart.js"), "utf8"));
eval(fs.readFileSync(path.join(LAYERS, "53-dexscript.js"), "utf8"));
eval(fs.readFileSync(path.join(LAYERS, "54-dxscriptui.js"), "utf8"));
const DXC = global.window.DXC, DXS = global.window.DXS;
const UI = global.window.DXSCRIPTUI, PINE = global.window.DXSPINE;

function flush() { while (RAF.length) { const f = RAF.shift(); f(0); } }
function tick() { return new Promise(r => setImmediate(r)); }
function click(node) { (DOCON.click || []).forEach(fn => fn({ target: wrapTarget(node), preventDefault() { } })); }
/* the stub's closest() is a no-op, so give the delegated listener a target
   that can walk its own ancestors the way a real one does */
function wrapTarget(node) {
  return {
    closest(sel) {
      const m = /^\[([\w-]+)(?:=['"]?([^'"\]]+)['"]?)?\]$/.exec(sel.trim());
      if (!m) return null;
      let n = node;
      while (n) {
        if (n.attrs && n.attrs[m[1]] !== undefined && (m[2] === undefined || n.attrs[m[1]] === m[2])) return n;
        n = n.parentNode;
      }
      return null;
    }
  };
}

let fails = 0, checks = 0;
function ok(name, cond, extra) {
  checks++;
  if (!cond) { fails++; console.log("  ✖ " + name + (extra !== undefined ? "  " + JSON.stringify(extra).slice(0, 420) : "")); }
  else console.log("  ✓ " + name);
}

/* ---------- the bars every language check runs over ---------- */
const BARS = (() => {
  const out = []; let p = 100;
  for (let i = 0; i < 400; i++) {
    const o = p;
    p = p * (1 + Math.sin(i / 11) * 0.011 + Math.cos(i / 4.5) * 0.006);
    const c = p;
    out.push({ t: T0 + i * 3600000, o, h: Math.max(o, c) * 1.0015, l: Math.min(o, c) * 0.9985, c, v: 1000 + (i % 23) * 11 });
  }
  return out;
})();

const WALL = /ms budget/;
function runRetry(prog, bars, params) {
  let r = DXS.run(prog, bars, params || {}, {});
  for (let k = 0; k < 6 && r.errors.length && WALL.test(String(r.errors[0].msg)); k++) {
    r = DXS.run(prog, bars, params || {}, {});
  }
  return r;
}

(async () => {
  const LIB = UI.library();
  console.log("DexScript UI harness · " + LIB.length + " library scripts · " +
    UI.libraryGroups().length + " groups · " + DXS.docs().length + " reference entries");

  ok("layer 54 mounted on top of the engine and the language", UI && UI.ok === true, UI && UI.why);

  /* ---------------------------------------------------------------- 1 · compile */
  const badCompile = [], compiled = {};
  LIB.forEach(s => {
    const c = DXS.compile(s.source);
    if (!c.ok) badCompile.push({ id: s.id, errors: c.errors });
    else compiled[s.id] = c;
  });
  ok("all " + LIB.length + " library scripts compile", badCompile.length === 0, badCompile);

  /* -------------------------------------------------------------------- 2 · run */
  const badRun = [], timings = [], strategies = [];
  LIB.forEach(s => {
    const c = compiled[s.id];
    if (!c) return;
    const r = runRetry(c.prog, BARS, {});
    if (r.errors.length) { badRun.push({ id: s.id, errors: r.errors }); return; }
    if (!r.rows.length) { badRun.push({ id: s.id, why: "drew nothing at all" }); return; }
    timings.push({ id: s.id, ms: r.ms, steps: r.steps });
    if (c.meta.kind === "strategy") strategies.push({ id: s.id, r: r });
  });
  ok("all " + LIB.length + " library scripts run over " + BARS.length + " bars with rows, no errors and no limit hit",
    badRun.length === 0, badRun);
  timings.sort((a, b) => b.ms - a.ms);
  console.log("    slowest three: " + timings.slice(0, 3).map(t => t.id + " " + t.ms + " ms / " + t.steps + " steps").join("  ·  "));

  /* every group is represented, and by the count the brief asks for */
  const byGroup = {};
  LIB.forEach(s => { byGroup[s.group] = (byGroup[s.group] || 0) + 1; });
  console.log("    by group: " + Object.keys(byGroup).map(g => g + " " + byGroup[g]).join("  ·  "));
  ok("at least 40 library scripts ship", LIB.length >= 40, { count: LIB.length });
  const ids = {};
  let dupe = null;
  LIB.forEach(s => { if (ids[s.id]) dupe = s.id; ids[s.id] = 1; });
  ok("every library id is unique and every entry carries a description",
    !dupe && LIB.every(s => s.about && s.about.length > 10 && s.title && s.group), dupe);

  /* -------------------------------------------------------------- 3 · strategies */
  const badStrat = [];
  strategies.forEach(s => {
    const S = s.r.strategy;
    if (!S) { badStrat.push({ id: s.id, why: "no strategy result" }); return; }
    if (!S.trades || !S.trades.length) { badStrat.push({ id: s.id, why: "took no trades" }); return; }
    const bad = Object.keys(S.stats).filter(k => typeof S.stats[k] === "number" && !isFinite(S.stats[k]));
    if (bad.length) { badStrat.push({ id: s.id, why: "non-finite stats", keys: bad }); return; }
    const badTrade = S.trades.filter(t => !isFinite(t.pnl) || !isFinite(t.entryPrice) || !isFinite(t.exitPrice));
    if (badTrade.length) badStrat.push({ id: s.id, why: "non-finite trade", n: badTrade.length });
  });
  ok("all " + strategies.length + " strategy scripts produce a trade list and finite statistics", badStrat.length === 0, badStrat);
  console.log("    trades: " + strategies.map(s => s.id + " " + s.r.strategy.trades.length).join("  ·  "));

  /* --------------------------------------------------- 4 · registration and paint */
  ok("the layer mounted onto the host", DXC.mount() === true);
  DXC.draw();
  flush();
  for (let i = 0; i < 12; i++) { await tick(); flush(); }
  ok("bars arrived through the engine's data path", DXC.bars().length > 300, { bars: DXC.bars().length });

  DXC.studies().length = 0;
  DXC.clearErrors();
  const added = UI.addToChart({ src: "lib", id: "supertrend" });
  ok("a library script registers and lands on the chart", added.ok && DXC.indicators().indexOf(added.key) >= 0, added.errors);
  flush(); DXC.paint();
  ok("the chart paints with it and DXC.errors() is empty", DXC.errors().length === 0, DXC.errors().slice(0, 4));
  const drew = (() => {
    const g = DXC.geometry();
    if (!g) return false;
    const pools = [].concat(g.rowsFor || [], ...g.layout.slice(1).map(p => p.rows || []));
    return pools.some(r => r.r && r.r.rows && r.r.rows.length);
  })();
  ok("the registered script actually produced rows on the chart", drew);

  /* every library script registers cleanly, one at a time */
  const badReg = [];
  LIB.forEach(s => {
    DXC.clearErrors();
    const r = UI.addToChart({ src: "lib", id: s.id });
    if (!r.ok) { badReg.push({ id: s.id, errors: r.errors }); return; }
    UI.removeFromChart({ src: "lib", id: s.id });
  });
  ok("every library script registers with the engine and comes off again", badReg.length === 0, badReg);

  DXC.studies().length = 0;
  DXC.clearErrors();

  /* ---------------------------------------------- 5 · saving, export and import */
  const SRC_A = 'study("Round trip", overlay=true)\nlen = input.int(9, "Length", minval=2, maxval=99)\nplot(ta.ema(close, len), "EMA", color=color.aqua)\n';
  const rec = UI.saveUser("Round trip", SRC_A, null);
  ok("a user script saves", !!rec && !!rec.id && rec.source === SRC_A);
  ok("it is written into localStorage under one key", !!store["dl.dxs.user"] && JSON.parse(store["dl.dxs.user"])[rec.id].title === "Round trip");
  ok("it comes back out of the list", UI.userScripts().some(u => u.id === rec.id && u.source === SRC_A));

  const dump = UI.exportAll();
  const parsed = JSON.parse(dump);
  ok("export writes valid JSON with a format and a version",
    parsed.format === "dexs" && parsed.version === 1 && parsed.scripts.length >= 1, { keys: Object.keys(parsed) });

  const before = UI.userScripts().length;
  const imp = UI.importText(dump);
  ok("import accepts its own export", imp.ok && imp.added.length === parsed.scripts.length, imp);
  ok("the imported scripts are in the list", UI.userScripts().length === before + parsed.scripts.length);

  const bad = JSON.stringify({
    format: "dexs", version: 1, scripts: [
      { title: "Good one", source: 'study("Good one")\nplot(close, "C")\n' },
      { title: "Broken one", source: 'study("Broken one")\nplot(ta.nonesuch(close, 9), "X")\n' }
    ]
  });
  const beforeBad = UI.userScripts().length;
  const impBad = UI.importText(bad);
  ok("import refuses a file with a script that does not compile, and names it",
    !impBad.ok && impBad.failed.length === 1 && impBad.failed[0].title === "Broken one" && /nonesuch/.test(impBad.failed[0].errors[0].msg),
    impBad.failed);
  ok("nothing from the refused file was written", UI.userScripts().length === beforeBad);
  ok("import refuses something that is not a .dexs file at all", UI.importText("{\"hello\":1}").ok === false);

  ok("a user script deletes", UI.deleteUser(rec.id) === true && !UI.userScripts().some(u => u.id === rec.id));

  /* ------------------------------------------------------------ 6 · per market */
  global.window.S.coin = "BTC"; global.window.S.quote = "USDT";
  UI.sync();
  UI.addToChart({ src: "lib", id: "rvol" });
  UI.addToChart({ src: "lib", id: "pivots" });
  const onBtc = UI.onChart().map(r => r.id).sort();
  ok("two scripts are recorded against BTC-USDT", onBtc.join(",") === "pivots,rvol", onBtc);

  global.window.S.coin = "SOL"; global.window.S.quote = "USDT";
  UI.sync();
  ok("a different market starts with none of them", UI.onChart().length === 0, UI.onChart());
  ok("and the engine has no script studies left on it after the switch",
    DXC.studies().filter(s => String(s.k).indexOf("dxs:") === 0).length === 0,
    DXC.studies().map(s => s.k));
  UI.addToChart({ src: "lib", id: "wavetrend" });
  ok("a script added on SOL is recorded there alone", UI.onChart().map(r => r.id).join(",") === "wavetrend");

  global.window.S.coin = "BTC"; global.window.S.quote = "USDT";
  UI.sync();
  ok("coming back to BTC restores exactly its own two", UI.onChart().map(r => r.id).sort().join(",") === "pivots,rvol", UI.onChart());
  ok("and SOL's script is not on the chart here",
    DXC.studies().filter(s => s.k === "dxs:lib_wavetrend").length === 0);

  UI.removeFromChart({ src: "lib", id: "rvol" });
  UI.removeFromChart({ src: "lib", id: "pivots" });
  DXC.studies().length = 0;

  /* ------------------------------------------------------------- 7 · highlighter */
  const hiSubjects = []
    .concat(DXS.PRELUDE.map(p => ({ name: "PRELUDE · " + p.name, src: p.src })))
    .concat(["ribbon", "squeeze", "liquidity", "vwapbands", "st-grid"].map(id => ({ name: "library · " + id, src: UI.libraryById(id).source })));
  const hiBad = [];
  hiSubjects.forEach(s => {
    const segs = UI.segments(s.src);
    let at = 0, joined = "";
    for (const g of segs) {
      if (g.s !== at) { hiBad.push({ name: s.name, why: g.s < at ? "spans overlap" : "a gap is uncovered", at, g }); return; }
      if (g.e <= g.s) { hiBad.push({ name: s.name, why: "an empty span", g }); return; }
      joined += s.src.slice(g.s, g.e);
      at = g.e;
    }
    if (at !== s.src.length) { hiBad.push({ name: s.name, why: "the tail is uncovered", at, len: s.src.length }); return; }
    if (joined !== s.src) hiBad.push({ name: s.name, why: "the spans do not reassemble the source" });
    if (!segs.some(g => g.k === "kw") || !segs.some(g => g.k === "str") || !segs.some(g => g.k === "fn")) {
      hiBad.push({ name: s.name, why: "no keyword, string or function run was classified" });
    }
  });
  ok("the highlighter covers all " + hiSubjects.length + " sources with no gaps and no overlaps", hiBad.length === 0, hiBad.slice(0, 4));

  /* ------------------------------------------------------------ 8 · the editor */
  const opened = UI.open(null);
  ok("the editor dialog opens", opened === true);
  const sheet = document.querySelector(".dxc-sheet");
  ok("the dialog's sheet is on the page", !!sheet);
  const want = ["dxsSrc", "dxsHi", "dxsGut", "dxsStat", "dxsName", "dxsInputs", "dxsRes", "dxsHelp", "dxsDocQ", "dxsDocList"];
  const missing = want.filter(id => !document.getElementById(id));
  ok("every part of the editor is built: " + want.join(", "), missing.length === 0, missing);

  const styled = walk(sheet || BODY, []).filter(n => n.attrs && n.attrs.style !== undefined);
  ok("no node in the editor's subtree carries a style attribute", styled.length === 0, styled.map(n => n.tagName));

  const gut = document.getElementById("dxsGut");
  const ta = document.getElementById("dxsSrc");
  ok("the gutter numbers every line of the source", gut.children.length === ta.value.split("\n").length,
    { gutter: gut.children.length, lines: ta.value.split("\n").length });
  const hi = document.getElementById("dxsHi");
  ok("the highlight layer reassembles the text in the textarea",
    hi.children.map(c => c.textContent).join("") === ta.value + "\n");
  ok("the status line says the script compiled",
    /Compiled/.test(document.getElementById("dxsStat").children.map(c => c.textContent).join(" ")),
    document.getElementById("dxsStat").children.map(c => c.textContent));
  ok("the reference panel lists the whole standard library, click-to-insert",
    document.querySelectorAll(".dxs-doc").length === DXS.docs().length,
    { rendered: document.querySelectorAll(".dxs-doc").length, docs: DXS.docs().length });

  /* an error in the source marks the failing line in the gutter */
  ta.value = 'study("Broken", overlay=true)\nplot(ta.nonesuch(close, 9), "X")\n';
  UI.refresh();
  /* The stub's classList is its own Set and the engine's el() sets className, so the two never
     meet in this harness. Read the property the code under test actually writes. */
  const marked = document.getElementById("dxsGut").children.filter(c => (c.className || "").split(/\s+/).indexOf("bad") >= 0);
  ok("a failing line is marked in the gutter with its message",
    marked.length === 1 && /nonesuch/.test(marked[0].title), { marked: marked.length, title: marked[0] && marked[0].title });

  /* a strategy fills the results panel out of run().strategy and nothing else */
  ta.value = UI.libraryById("st-emacross").source;
  UI.refresh();
  const resText = walk(document.getElementById("dxsRes"), []).map(n => n.textContent).join(" ");
  ok("a strategy script fills the backtest panel", /Net profit/.test(resText) && /Profit factor/.test(resText) && /Sharpe/.test(resText));
  ok("the equity curve is drawn on its own canvas", !!document.querySelector(".dxs-eq"));

  /* the inputs panel is built from meta.inputs */
  const inputNodes = document.querySelectorAll("[data-dxs-in]");
  ok("the inputs panel renders the script's declared inputs", inputNodes.length === 2, inputNodes.length);

  /* ------------------------------------------------------------- 9 · the Pine */
  const SNIPS = [
    {
      name: "a plain EMA study",
      kind: "clean",
      src: '//@version=5\nindicator("My EMA", "EMA", overlay=true)\nlen = input.int(20, "Length", minval=1)\nplot(ta.ema(close, len), "EMA", color=color.blue, linewidth=2)\n'
    },
    {
      name: "RSI with hlines and a filled band",
      kind: "clean",
      src: '//@version=5\nindicator("RSI", overlay=false, precision=2)\nlen = input.int(14, title="Length")\nr = ta.rsi(close, len)\nplot(r, "RSI", color=color.new(color.purple, 0))\nhline(70, "OB", color=color.red, linestyle=hline.style_dashed)\nhline(30, "OS", color=color.green, linestyle=hline.style_dashed)\nbgcolor(r > 70 ? color.new(color.red, 90) : na)\n'
    },
    {
      name: "MACD with a histogram style",
      kind: "clean",
      src: '//@version=5\nindicator("MACD")\n[macdLine, signalLine, histLine] = ta.macd(close, 12, 26, 9)\nplot(histLine, "Hist", style=plot.style_histogram, color=histLine >= 0 ? color.green : color.red)\nplot(macdLine, "MACD", color=color.blue)\nplot(signalLine, "Signal", color=color.orange)\n'
    },
    {
      name: "bands with fill between two named plots",
      kind: "clean",
      src: '//@version=5\nindicator("BB", overlay=true)\nlen = input.int(20)\nmult = input.float(2.0, "Mult", step=0.1)\n[basis, upper, lower] = ta.bb(close, len, mult)\np1 = plot(upper, "Upper", color=color.blue)\np2 = plot(lower, "Lower", color=color.blue)\nplot(basis, "Basis", color=color.orange)\nfill(p1, p2, color=color.new(color.blue, 90))\n'
    },
    {
      name: "var, := and an if/else block",
      kind: "clean",
      src: '//@version=5\nindicator("Counter", overlay=false)\nvar int flips = 0\nup = ta.crossover(close, ta.sma(close, 20))\nif up\n    flips := flips + 1\nelse\n    flips := flips\nplot(flips, "Flips", color=color.aqua)\n'
    },
    {
      name: "a for loop and a user function",
      kind: "clean",
      src: '//@version=5\nindicator("Weighted", overlay=true)\nlen = input.int(10, "Length")\nweight(k, n) => (n - k) / n\ntotal = 0.0\nwsum = 0.0\nfor i = 0 to len - 1\n    w = weight(i, len)\n    total := total + close[i] * w\n    wsum := wsum + w\nplot(wsum > 0 ? total / wsum : na, "WMA", color=color.purple)\n'
    },
    {
      name: "plotshape with shape and location enums",
      kind: "clean",
      src: '//@version=5\nindicator("Signals", overlay=true)\nup = ta.crossover(ta.ema(close, 9), ta.ema(close, 21))\ndn = ta.crossunder(ta.ema(close, 9), ta.ema(close, 21))\nplotshape(up, title="Buy", style=shape.triangleup, location=location.belowbar, color=color.green, size=size.tiny, text="B")\nplotshape(dn, title="Sell", style=shape.triangledown, location=location.abovebar, color=color.red, text="S")\nplotchar(up, "U", char="▲", location=location.bottom, color=color.green)\n'
    },
    {
      name: "a strategy with entry, close and an exit bracket",
      kind: "clean",
      src: '//@version=5\nstrategy("Cross", "X", overlay=true, initial_capital=10000, commission_value=0.04, slippage=1, default_qty_value=1, pyramiding=1)\nfast = ta.ema(close, 10)\nslow = ta.ema(close, 30)\nif ta.crossover(fast, slow)\n    strategy.entry("long", strategy.long)\n    strategy.exit("x", "long", loss=ta.atr(14) * 2)\nif ta.crossunder(fast, slow)\n    strategy.close("long")\nplot(fast, "Fast")\nplot(slow, "Slow")\n'
    },
    {
      name: "math, str and array calls",
      kind: "clean",
      src: '//@version=5\nindicator("Arrays")\nvar arr = array.new<float>(0)\narray.push(arr, close)\nif array.size(arr) > 50\n    array.shift(arr)\nplot(array.avg(arr), "Mean of the window", color=color.teal)\nplot(math.max(high, low), "Max", color=color.gray)\n'
    },
    {
      name: "a hex colour literal and a wrapped call",
      kind: "clean",
      src: '//@version=5\nindicator("Wrapped", overlay=true)\nplot(ta.sma(close,\n     20),\n     "SMA",\n     color=#5B8CFF,\n     linewidth=2)\n'
    },
    {
      name: "request.security on this symbol at a Pine timeframe",
      kind: "approximated",
      src: '//@version=5\nindicator("HTF", overlay=true)\nhtf = request.security(syminfo.tickerid, "240", ta.ema(close, 20))\nplot(htf, "4h EMA", color=color.orange)\n'
    },
    {
      name: "label.new, which has no equivalent here",
      kind: "unsupported",
      needle: /label/,
      src: '//@version=5\nindicator("Labels", overlay=true)\ne = ta.ema(close, 20)\nif ta.crossover(close, e)\n    label.new(bar_index, high, "up", color=color.green)\nplot(e, "EMA", color=color.blue)\n'
    },
    {
      name: "request.security on ANOTHER symbol",
      kind: "unsupported",
      needle: /second symbol/,
      src: '//@version=5\nindicator("BTC overlay", overlay=false)\nbtc = request.security("BINANCE:BTCUSDT", "60", close)\nplot(btc, "BTC", color=color.orange)\n'
    },
    {
      name: "a ta.* this engine does not implement",
      kind: "unsupported",
      needle: /ta\.cog/,
      src: '//@version=5\nindicator("COG")\nc = ta.cog(close, 10)\nplot(c, "COG", color=color.aqua)\nplot(ta.rsi(close, 14), "RSI", color=color.blue)\n'
    },
    {
      name: "varip, switch, table.new and a for…in loop together",
      kind: "unsupported",
      needle: /varip|switch|table|for/,
      src: '//@version=5\nindicator("Kitchen sink", overlay=true)\nvarip int ticks = 0\nvar t = table.new(position.top_right, 2, 2)\nmode = input.string("A", "Mode", options=["A", "B"])\nk = switch mode\n    "A" => 1\n    => 2\nvals = array.new<float>(3, 0.0)\nfor v in vals\n    ticks := ticks + 1\nplot(ta.ema(close, 20), "EMA", color=color.blue)\n'
    }
  ];

  const pineBad = [];
  let nTranslated = 0, nApprox = 0, nRefused = 0;
  SNIPS.forEach(s => {
    const r = PINE.convert(s.src);
    const c = DXS.compile(r.source);
    const kinds = { translated: 0, approximated: 0, unsupported: 0 };
    r.notes.forEach(n => { kinds[n.kind] = (kinds[n.kind] || 0) + 1; });
    nTranslated += kinds.translated; nApprox += kinds.approximated; nRefused += kinds.unsupported;
    if (!c.ok) { pineBad.push({ name: s.name, why: "the converted script did not compile", errors: c.errors, source: r.source }); return; }
    if (!r.ok) { pineBad.push({ name: s.name, why: "convert() did not report ok" }); return; }
    if (!kinds.translated) { pineBad.push({ name: s.name, why: "nothing was reported as translated" }); return; }
    if (s.kind === "clean" && kinds.unsupported) {
      pineBad.push({ name: s.name, why: "a snippet we can carry reported a refusal", notes: r.notes.filter(n => n.kind === "unsupported") });
      return;
    }
    if (s.kind === "approximated" && !kinds.approximated) {
      pineBad.push({ name: s.name, why: "a snippet that needed an approximation reported none" });
      return;
    }
    if (s.kind === "unsupported") {
      if (!kinds.unsupported) { pineBad.push({ name: s.name, why: "a refusal was expected and none was reported" }); return; }
      const hit = r.notes.some(n => n.kind === "unsupported" && s.needle.test(n.msg));
      if (!hit) { pineBad.push({ name: s.name, why: "the refusal did not name the feature", notes: r.notes.filter(n => n.kind === "unsupported").map(n => n.msg) }); return; }
      /* the refused line must be COMMENTED OUT, not silently dropped */
      if (r.source.indexOf("// [unsupported]") < 0) {
        pineBad.push({ name: s.name, why: "the refused line was dropped rather than commented out", source: r.source });
      }
    }
  });
  ok("all " + SNIPS.length + " Pine snippets convert into a script that compiles, with notes that classify every move",
    pineBad.length === 0, pineBad.slice(0, 3));
  console.log("    notes across the snippets: " + nTranslated + " translated · " + nApprox + " approximated · " + nRefused + " refused");

  const unsup = SNIPS.filter(s => s.kind === "unsupported");
  ok("the " + unsup.length + " snippets built on features we refuse are commented out and named, never dropped",
    unsup.every(s => {
      const r = PINE.convert(s.src);
      return r.source.indexOf("// [unsupported]") >= 0 && r.notes.some(n => n.kind === "unsupported" && s.needle.test(n.msg));
    }));

  /* a converted script has to actually run, not just parse */
  const runnable = PINE.convert(SNIPS[0].src);
  const rc = DXS.compile(runnable.source);
  const rr = rc.ok ? runRetry(rc.prog, BARS, {}) : null;
  ok("a converted study runs over real bars and draws", !!rr && rr.errors.length === 0 && rr.rows.length > 0,
    rr ? rr.errors : rc.errors);

  const caps = PINE.capabilities();
  ok("the converter states its three lists for the dialog to print",
    caps.translated.length > 5 && caps.approximated.length > 2 && caps.unsupported.length > 5);

  /* -------------------------------------------------------- 10 · the other rooms */
  UI.openLibrary();
  ok("the library browser opens and lists every shipped script",
    document.querySelectorAll(".dxs-card").length >= LIB.length, document.querySelectorAll(".dxs-card").length);
  const onBtns = document.querySelectorAll("[data-dxs=on]");
  ok("each card offers an Add to chart button", onBtns.length >= LIB.length, onBtns.length);

  UI.openPine();
  ok("the Pine dialog opens and says what it is",
    !!document.getElementById("dxsPine") &&
    /SUBSET TRANSLATOR/.test(walk(document.querySelector(".dxc-sheet"), []).map(n => n.textContent).join(" ")));

  UI.openImport();
  ok("the import dialog offers both a file picker and a paste box",
    !!document.getElementById("dxsFile") && !!document.getElementById("dxsPaste"));

  /* Day mode has to be stated for every class this layer adds */
  const css = walk(HEAD, []).concat(walk(BODY, [])).filter(n => n.tagName === "STYLE" && n.attrs.id === "dxsCss")[0];
  ok("the layer added exactly one stylesheet, built with textContent", !!css && typeof css.textContent === "string" && css.textContent.length > 500);
  const nightClasses = (css ? css.textContent : "").match(/\.dxs-[a-z-]+/g) || [];
  const dayRules = (css ? css.textContent : "").match(/html\[data-mode=day\][^\n]*/g) || [];
  ok("both appearances are stated: " + dayRules.length + " Day rules beside the Night ones", dayRules.length > 20, dayRules.length);
  ok("no pure white or pure black anywhere in it",
    !/#fff\b|#ffffff|#000\b|#000000/i.test(css ? css.textContent : ""),
    (css ? css.textContent : "").match(/#f{3,6}|#0{3,6}/gi));
  ok("the stylesheet carries a phone breakpoint", /@media \(max-width:460px\)/.test(css ? css.textContent : ""));

  console.log(fails
    ? "\nFAILED · " + fails + " of " + checks + " check(s)"
    : "\nall " + checks + " checks passed · " + LIB.length + " library scripts · " +
    strategies.length + " strategies · " + SNIPS.length + " Pine snippets");
  process.exit(fails ? 1 : 0);
})();
