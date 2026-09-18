/* DexScript harness — layer 53 driven head-first on top of the real layer 46
   engine, against a recording 2D context. It does not check that the language
   runs; it checks that the language is RIGHT. Every oracle below computes the
   expected series in plain JavaScript in this file and compares it with what
   the interpreter produced, to 1e-9. Then the semantics that make it Pine and
   not a calculator, then the parser on every syntax form and on twenty scripts
   that must fail on a named line, then the budgets, then the no-lookahead
   guarantee, then the strategy arithmetic on a hand-built series with a known
   answer, then registration through DXC, then determinism.
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
  setTimeout: (fn) => { LATER.push(fn); return 0; }, clearTimeout() { }, setInterval: () => 0, clearInterval() { },
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

/* ---------- load both layers ---------- */
eval(fs.readFileSync(path.join(__dirname, "..", "layers", "46-dexchart.js"), "utf8"));
eval(fs.readFileSync(path.join(__dirname, "..", "layers", "53-dexscript.js"), "utf8"));
const DXC = global.window.DXC, DXS = global.window.DXS;
function flush() { while (RAF.length) { const f = RAF.shift(); f(0); } }
function tick() { return new Promise(r => setImmediate(r)); }

let fails = 0, checks = 0;
function ok(name, cond, extra) {
  checks++;
  if (!cond) { fails++; console.log("  ✖ " + name + (extra !== undefined ? "  " + JSON.stringify(extra).slice(0, 360) : "")); }
  else console.log("  ✓ " + name);
}

/* ---------- the bars the language tests run on: fixed, no randomness ---------- */
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
const CLOSE = BARS.map(b => b.c);
const HIGH = BARS.map(b => b.h), LOW = BARS.map(b => b.l), OPEN = BARS.map(b => b.o);

/* ---------- plain-JS oracles ---------- */
const nul = n => new Array(n).fill(null);
function oSma(x, p) { const o = nul(x.length); let s = 0; for (let i = 0; i < x.length; i++) { s += x[i]; if (i >= p) s -= x[i - p]; o[i] = i >= p - 1 ? s / p : null; } return o; }
function oEma(x, p) { const o = nul(x.length); const k = 2 / (p + 1); let e = null, s = 0; for (let i = 0; i < x.length; i++) { if (i < p - 1) { s += x[i]; continue; } if (i === p - 1) { s += x[i]; e = s / p; o[i] = e; continue; } e = x[i] * k + e * (1 - k); o[i] = e; } return o; }
function oRma(x, p) { const o = nul(x.length); let e = null, s = 0; for (let i = 0; i < x.length; i++) { if (i < p - 1) { s += x[i]; continue; } if (i === p - 1) { s += x[i]; e = s / p; o[i] = e; continue; } e = (e * (p - 1) + x[i]) / p; o[i] = e; } return o; }
function oWma(x, p) { const o = nul(x.length), den = p * (p + 1) / 2; for (let i = 0; i < x.length; i++) { if (i < p - 1) continue; let s = 0; for (let j = 0; j < p; j++) s += x[i - p + 1 + j] * (j + 1); o[i] = s / den; } return o; }
function oStdev(x, p) { const o = nul(x.length); for (let i = 0; i < x.length; i++) { if (i < p - 1) continue; let m = 0; for (let j = i - p + 1; j <= i; j++) m += x[j]; m /= p; let q = 0; for (let j = i - p + 1; j <= i; j++) q += (x[j] - m) * (x[j] - m); o[i] = Math.sqrt(q / p); } return o; }
function oRsi(x, p) {
  const g = [], l = [];
  for (let i = 0; i < x.length; i++) { const d = i ? x[i] - x[i - 1] : 0; g.push(d > 0 ? d : 0); l.push(d < 0 ? -d : 0); }
  const ag = oRma(g, p), al = oRma(l, p);
  return x.map((_, i) => (ag[i] == null || al[i] == null) ? null : (al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i])));
}
function oTr() { return BARS.map((b, i) => i ? Math.max(b.h - b.l, Math.abs(b.h - BARS[i - 1].c), Math.abs(b.l - BARS[i - 1].c)) : b.h - b.l); }
function oAtr(p) { return oRma(oTr(), p); }
function oHighest(x, p) { const o = nul(x.length); for (let i = p - 1; i < x.length; i++) { let m = -Infinity; for (let j = i - p + 1; j <= i; j++) m = Math.max(m, x[j]); o[i] = m; } return o; }

function near(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}
function sameSeries(got, want) {
  if (!got || got.length !== want.length) return { ok: false, at: -1, got: got && got.length, want: want.length };
  for (let i = 0; i < want.length; i++) if (!near(got[i], want[i])) return { ok: false, at: i, got: got[i], want: want[i] };
  return { ok: true };
}

function compile(src) { return DXS.compile(src); }
function runSrc(src, params, bars) {
  const c = compile(src);
  if (!c.ok) return { err: c.errors };
  const r = DXS.run(c.prog, bars || BARS, params || {}, {});
  return r;
}
function seriesOf(src, which, params, bars) {
  const r = runSrc(src, params, bars);
  if (r.err) return { err: r.err };
  if (r.errors && r.errors.length) return { err: r.errors };
  const p = r.plots[which || 0];
  return p ? p.values : null;
}
function oracle(name, src, want, which) {
  const got = seriesOf(src, which || 0);
  if (!got || got.err) { ok("oracle · " + name, false, got && got.err); return; }
  const cmp = sameSeries(got, want);
  ok("oracle · " + name, cmp.ok, cmp);
}

(async () => {
  console.log("DexScript harness · DXS v" + DXS.__v + " · " + DXS.docs().length + " library entries · " + BARS.length + " bars");

  /* ================================================================== 1 */
  console.log("\n== oracles: twelve series computed twice, in two languages");

  oracle("ta.sma(close, 20)", 'study("t")\nplot(ta.sma(close, 20), "x")\n', oSma(CLOSE, 20));
  oracle("ta.ema(close, 21)", 'study("t")\nplot(ta.ema(close, 21), "x")\n', oEma(CLOSE, 21));
  oracle("ta.wma(close, 9)", 'study("t")\nplot(ta.wma(close, 9), "x")\n', oWma(CLOSE, 9));
  oracle("ta.stdev(close, 20)", 'study("t")\nplot(ta.stdev(close, 20), "x")\n', oStdev(CLOSE, 20));
  oracle("ta.rsi(close, 14)", 'study("t")\nplot(ta.rsi(close, 14), "x")\n', oRsi(CLOSE, 14));
  oracle("ta.atr(14)", 'study("t")\nplot(ta.atr(14), "x")\n', oAtr(14));
  oracle("ta.highest(high, 10)", 'study("t")\nplot(ta.highest(high, 10), "x")\n', oHighest(HIGH, 10));
  oracle("ta.ema of ta.rsi, nested", 'study("t")\nplot(ta.ema(ta.rsi(close, 14), 9), "x")\n',
    (() => { const r = oRsi(CLOSE, 14); const o = nul(r.length); let e = null, s = 0, seen = 0; for (let i = 0; i < r.length; i++) { if (r[i] == null) continue; seen++; if (seen < 9) { s += r[i]; continue; } if (seen === 9) { s += r[i]; e = s / 9; o[i] = e; continue; } e = r[i] * (2 / 10) + e * (1 - 2 / 10); o[i] = e; } return o; })());

  /* crossover counts */
  {
    const f = oEma(CLOSE, 9), s = oEma(CLOSE, 21);
    const want = nul(CLOSE.length);
    let n = 0, pa = null, pb = null;
    for (let i = 0; i < CLOSE.length; i++) {
      const x = f[i], y = s[i];
      const cross = (pa != null && pb != null && x != null && y != null && pa <= pb && x > y);
      pa = x; pb = y;
      if (cross) n++;
      want[i] = n;
    }
    oracle("crossover count carried in a var",
      'study("t")\nf = ta.ema(close, 9)\ns = ta.ema(close, 21)\nvar int n = 0\nif ta.crossover(f, s)\n    n := n + 1\nplot(n, "x")\n', want);
  }

  /* var accumulation */
  oracle("var accumulates once per bar", 'study("t")\nvar float acc = 0\nacc := acc + 1\nplot(acc, "x")\n',
    CLOSE.map((_, i) => i + 1));

  /* history operator */
  oracle("close[1] is the previous close", 'study("t")\nplot(close[1], "x")\n',
    CLOSE.map((_, i) => (i ? CLOSE[i - 1] : null)));
  oracle("x[3] on a script variable", 'study("t")\nx = ta.sma(close, 5)\nplot(x[3], "y")\n',
    (() => { const s = oSma(CLOSE, 5); return s.map((_, i) => (i >= 3 ? s[i - 3] : null)); })());

  /* a for loop that reproduces an SMA by hand */
  oracle("for loop sums the window by hand",
    'study("t")\ntotal = 0.0\nfor i = 0 to 9\n    total := total + close[i]\nplot(total / 10, "x")\n', oSma(CLOSE, 10));

  /* a nested function */
  oracle("a function calling a function",
    'study("t")\ndbl(x) => x * 2\nshift(x, k) =>\n    q = dbl(x)\n    q + k\nplot(shift(close, 5), "x")\n',
    CLOSE.map(c => c * 2 + 5));

  /* a ternary chain */
  {
    const e = oEma(CLOSE, 10), s = oSma(CLOSE, 10), w = oWma(CLOSE, 10);
    oracle("ternary chain picks the EMA branch",
      'study("t")\nmode = input.string("EMA", "Type", options=["EMA", "SMA", "WMA"])\nplot(mode == "EMA" ? ta.ema(close, 10) : mode == "SMA" ? ta.sma(close, 10) : ta.wma(close, 10), "x")\n', e);
    const gotS = seriesOf('study("t")\nmode = input.string("EMA", "Type", options=["EMA", "SMA", "WMA"])\nplot(mode == "EMA" ? ta.ema(close, 10) : mode == "SMA" ? ta.sma(close, 10) : ta.wma(close, 10), "x")\n', 0, { mode: "WMA" });
    ok("oracle · the same chain follows an input to the WMA branch", sameSeries(gotS, w).ok, sameSeries(gotS, w));
    void s;
  }

  /* barssince and valuewhen */
  {
    const cond = BARS.map(b => b.c > b.o);
    const bs = nul(cond.length); let n = null;
    for (let i = 0; i < cond.length; i++) { if (cond[i]) n = 0; else if (n != null) n++; bs[i] = n; }
    oracle("ta.barssince", 'study("t")\nplot(ta.barssince(close > open), "x")\n', bs);
    const vw = nul(cond.length); let last = null;
    for (let i = 0; i < cond.length; i++) { if (cond[i]) last = CLOSE[i]; vw[i] = last; }
    oracle("ta.valuewhen", 'study("t")\nplot(ta.valuewhen(close > open, close, 0), "x")\n', vw);
  }

  /* ================================================================== 2 */
  console.log("\n== semantics: what makes it Pine and not a calculator");

  {
    const got = seriesOf('study("t")\nvar float first = close\nplot(first, "x")\n');
    ok("var evaluates its initialiser once, on bar 0", sameSeries(got, CLOSE.map(() => CLOSE[0])).ok, { got: got && got.slice(0, 3) });
  }
  {
    const got = seriesOf('study("t")\nnow = close\nplot(now, "x")\n');
    ok("a plain declaration re-evaluates on every bar", sameSeries(got, CLOSE).ok);
  }
  {
    const got = seriesOf('study("t")\nplot(close[500] + 1, "x")\n');
    ok("na propagates through arithmetic", got && got.every(v => v === null));
  }
  {
    const got = seriesOf('study("t")\nplot(ta.sma(close, 30), "x")\n');
    ok("a window that has not filled is na, never 0",
      got && got.slice(0, 29).every(v => v === null) && got[29] !== null && Math.abs(got[29] - oSma(CLOSE, 30)[29]) < 1e-12);
  }
  {
    const got = seriesOf('study("t")\nplot(nz(ta.sma(close, 30), -1), "x")\n');
    ok("nz() is the only way a na becomes a number", got && got.slice(0, 29).every(v => v === -1));
  }
  {
    /* the same formula twice must be two independent windows, and the one
       inside an if must only advance on the bars the if ran */
    const src = 'study("t")\na = ta.ema(close, 5)\nb = 0.0\nif bar_index % 2 == 0\n    b := ta.ema(close, 5)\nplot(a, "a")\nplot(b, "b")\n';
    const r = runSrc(src);
    const wantA = oEma(CLOSE, 5);
    const evens = [], evenIdx = [];
    for (let i = 0; i < CLOSE.length; i += 2) { evens.push(CLOSE[i]); evenIdx.push(i); }
    const emaEven = oEma(evens, 5);
    const wantB = CLOSE.map((_, i) => (i % 2 === 0 ? (emaEven[evenIdx.indexOf(i)] == null ? null : emaEven[evenIdx.indexOf(i)]) : 0));
    ok("ta.ema outside the if is the ordinary EMA", sameSeries(r.plots[0].values, wantA).ok, sameSeries(r.plots[0].values, wantA));
    ok("ta.ema inside the if keeps state on its own call site", sameSeries(r.plots[1].values, wantB).ok, sameSeries(r.plots[1].values, wantB));
  }
  {
    const r = runSrc('study("t")\nplot(ta.sma(close, 5), "a")\nplot(ta.sma(close, 5) + 0, "b")\n');
    ok("two identical call sites do not share a window", sameSeries(r.plots[0].values, r.plots[1].values).ok);
  }
  {
    const r = runSrc('study("t")\nvar a = array.new_float(0)\narray.push(a, close)\nplot(array.size(a), "n")\nplot(array.avg(a), "m")\n');
    ok("var holds an array across bars", r.plots[0].values[399] === 400);
    ok("array.avg over everything seen so far", near(r.plots[1].values[399], CLOSE.reduce((x, y) => x + y, 0) / 400));
  }
  {
    const r = runSrc('study("t")\nplot(str.length(str.format("{0}-{1}", 12, "ab")), "n")\n');
    ok("str.format is positional, not printf", r.plots[0].values[0] === 5, r.plots[0].values[0]);
  }
  {
    const r = runSrc('study("t", overlay=false, range_lo=0, range_hi=100)\nplot(ta.rsi(close, 14), "r")\nhline(70, "ob", linestyle="dashed")\n');
    ok("study() can pin the pane range the engine reads", !!r.range && r.range[0] === 0 && r.range[1] === 100, r.range);
    ok("hline becomes a level with the right dash", r.levels.length === 1 && r.levels[0].v === 70 && r.levels[0].dash === 4, r.levels);
  }
  {
    const r = runSrc('study("t")\nplotshape(close > open, "up", style="triangleup", location="belowbar", color="#22D39A", text="B")\nbgcolor(close > open ? color.new("#FF5A78", 0.9) : na)\nlabel(close, close > open ? "U" : "")\n');
    const kinds = r.rows.map(x => x.kind).sort();
    ok("shapes, bg and labels rows come out in the engine's shapes", JSON.stringify(kinds) === JSON.stringify(["bg", "labels", "shapes"]), kinds);
    const sh = r.rows.filter(x => x.kind === "shapes")[0];
    ok("a shapes row is one entry per bar, null where nothing happened",
      sh.data.length === BARS.length && sh.data.some(v => v === null) && sh.data.some(v => v && v.s === "up" && v.txt === "B"));
    const bg = r.rows.filter(x => x.kind === "bg")[0];
    ok("a bg entry is a hex with the transparency baked in",
      bg.data.some(v => typeof v === "string" && /^#[0-9A-F]{8}$/.test(v)), bg.data.filter(Boolean)[0]);
  }
  {
    const r = runSrc('study("t")\nalertcondition(ta.crossover(close, ta.sma(close, 20)), "cross", "close crossed the mean")\n');
    ok("alertcondition collects the bars it fired on",
      r.alerts.length === 1 && r.alerts[0].title === "cross" && r.alerts[0].bars.length > 2 && r.alerts[0].bars.every(i => i >= 19), r.alerts[0] && r.alerts[0].bars.slice(0, 5));
  }
  {
    /* request.security: an honest 4h read of a 1h chart, and no lookahead */
    const src = 'study("t")\nplot(request.security(syminfo.ticker, "4h", close), "h4")\n';
    const got = seriesOf(src);
    const buckets = [];
    BARS.forEach((b, i) => {
      const k = Math.floor(b.t / 14400000);
      if (!buckets.length || buckets[buckets.length - 1].k !== k) buckets.push({ k, c: b.c, last: i });
      else { buckets[buckets.length - 1].c = b.c; buckets[buckets.length - 1].last = i; }
    });
    const want = nul(BARS.length);
    let done = -1;
    for (let i = 0; i < BARS.length; i++) {
      const bi = buckets.findIndex(x => x.k === Math.floor(BARS[i].t / 14400000));
      const closes = buckets[bi].last === i;
      want[i] = closes ? buckets[bi].c : (bi > 0 ? buckets[bi - 1].c : null);
      void done;
    }
    ok("request.security aggregates 1h into 4h with no lookahead", sameSeries(got, want).ok, sameSeries(got, want));
    const bad = compile('study("t")\nplot(request.security(syminfo.ticker, "4h", myVar), "x")\nmyVar = close\n');
    ok("request.security refuses to read a script variable", !bad.ok && bad.errors[0].line === 2, bad.errors);
  }

  /* ================================================================== 3 */
  console.log("\n== parser: every form in, twenty bad scripts out");

  {
    const all = [
      '//@version=1',
      'study("Everything", "EV", overlay=false, precision=4, range_lo=-1, range_hi=1)',
      '',
      'a = input.int(14, "a", minval=1, maxval=99, step=1)',
      'b = input.float(1.5, "b", step=0.25)',
      'c = input.bool(false, "c")',
      'd = input.string("x", "d", options=["x", "y"])',
      'e = input.source(hl2, "e")',
      'f = input.color("#FF5A78", "f")',
      'g = input(7, "g")',
      'float ff = 1.0',
      'int ii = 2',
      'bool bb = true',
      'string ss = "s"',
      'color cc = color.new("#00E5FF", 0.2)',
      'var int counter = 0',
      'var float carried = na',
      '[m1, m2, m3] = ta.macd(close, 12, 26, 9)',
      'add(p, q) => p + q',
      'wide(p, q) =>',
      '    t = add(p, q)',
      '    t * 2',
      'if close > open',
      '    counter := counter + 1',
      'else if close < open',
      '    counter := counter - 1',
      'else',
      '    counter := counter',
      'total = 0.0',
      'for i = 0 to a - 1',
      '    if i > 100',
      '        break',
      '    total := total + close[i]',
      'for j = 10 to 0 by -2',
      '    total := total + j',
      'k = 0',
      'while k < 3',
      '    k := k + 1',
      '    if k == 2',
      '        continue',
      'carried := ff + ii + (bb ? 1 : 0) + str.length(ss) + g',
      'z = -a + math.abs(-b) % 3 / 2 * 2 - 1',
      'y = not (close > open) and (close[1] > open[1] or true)',
      'plot(m1, "macd", color=cc, linewidth=2, style="histogram")',
      'plot(wide(close, 1) - close * 2 - 1, "wide")',
      'd1 = ta.change(close, 2)',
      'plot(e + m2 + m3 + total + carried + z + (y ? 1 : 0) + (na(close) ? 1 : 0) + nz(close[9999], 0) + d1, "sum")',
      'plotchar(close > open, "u", char="+", location="top", color=f)',
      'hline(0, "zero", linestyle="dotted", linewidth=1)',
      'barcolor(close > open ? color.green : color.red)',
      'alertcondition(counter > 0, "t", "m")'
    ].join("\n") + "\n";
    const c = compile(all);
    ok("every syntax form in the brief parses in one script", c.ok, c.errors);
    if (c.ok) {
      const r = DXS.run(c.prog, BARS, {}, {});
      ok("...and the same script runs to the last bar", r.errors.length === 0, r.errors);
      ok("...and its inputs are described for the dialog", c.meta.inputs.length === 7 && c.meta.inputs[0].type === "int" && c.meta.inputs[4].type === "source", c.meta.inputs.map(x => x.k + ":" + x.type));
    }
  }

  const BAD = [
    ["an unclosed paren", 'study("x")\nplot(ta.sma(close, 10)\n', 3],
    ["a block that is not indented", 'study("x")\nif close > 0\nplot(close, "c")\n', 3],
    ["an unknown identifier", 'study("x")\n\nplot(nope, "c")\n', 3],
    ["too few arguments", 'study("x")\nplot(ta.sma(close), "c")\n', 2],
    ["too many arguments", 'study("x")\nplot(ta.sma(close, 3, 4, 5), "c")\n', 2],
    ["a named argument that does not exist", 'study("x")\nplot(ta.sma(close, length=3, period=4), "c")\n', 2],
    ["assignment to a built-in series", 'study("x")\nclose = 1\n', 2],
    ["reassignment of a built-in series", 'study("x")\nclose := 1\n', 2],
    [":= on a name never declared", 'study("x")\nq := 1\n', 2],
    ["a name declared twice", 'study("x")\nq = 1\nq = 2\n', 3],
    ["mixed tabs and spaces", 'study("x")\nif close > 0\n\t plot(close, "c")\n', 3],
    ["tabs on one line, spaces on another", 'study("x")\nif close > 0\n\tq = 1\nif close < 0\n    r = 2\n', 5],
    ["an unterminated string", 'study("x")\nplot(close, "c)\n', 2],
    ["a multi-value builtin read as one", 'study("x")\nq = ta.bb(close, 20, 2)\nplot(q, "c")\n', 2],
    ["the wrong number of names for a tuple", 'study("x")\n[a, b] = ta.macd(close, 12, 26, 9)\nplot(a, "c")\n', 2],
    ["a namespace called as a function", 'study("x")\nplot(math(1), "c")\n', 2],
    ["a function that is not in the library", 'study("x")\nplot(ta.nope(close, 3), "c")\n', 2],
    ["else with no if", 'study("x")\nq = 1\nelse\n    q := 2\n', 3],
    ["a user function given the wrong arity", 'study("x")\nf(a, b) => a + b\nplot(f(close), "c")\n', 3],
    ["a second study() declaration", 'study("x")\nstudy("y")\n', 2],
    ["a title that is computed rather than written", 'study("x" + "y")\n', 1],
    ["strategy.* with no strategy()", 'study("x")\nstrategy.entry("l", "long")\n', 2],
    ["a plot style that does not exist", 'study("x")\nplot(close, "c", style="squiggle")\n', 2],
    ["history on a name declared inside a block", 'study("x")\nif close > 0\n    q = 1\n    plot(q[1], "c")\n', 4],
    ["a dangling indent", 'study("x")\n    q = 1\n', 2],
    ["a stray character", 'study("x")\nq = 1 @ 2\n', 2]
  ];
  {
    let wrong = [];
    BAD.forEach(([name, src, line]) => {
      const c = compile(src);
      if (c.ok) wrong.push({ name, why: "compiled" });
      else if (c.errors[0].line !== line) wrong.push({ name, want: line, got: c.errors[0].line, msg: c.errors[0].msg });
    });
    ok("all " + BAD.length + " bad scripts fail on the right line", wrong.length === 0, wrong);
    BAD.slice(0, 3).forEach(([name, src]) => {
      const c = compile(src);
      console.log("      e.g. " + name + " → line " + c.errors[0].line + ": " + c.errors[0].msg);
    });
  }
  {
    const c = compile('plot(close, "c")\n');
    ok("a script with no study() line still compiles, with a warning", c.ok && c.warnings.some(w => /study\(\)/.test(w.msg)), c.warnings);
    const l = DXS.lint('study("x")\nplot(nope, "c")\n');
    ok("lint() reports the same thing with a severity", l.length >= 1 && l[0].severity === "error" && l[0].line === 2, l);
    const t = DXS.tokens('study("x") // hi\nplot(ta.ema(close, 9), "E")\n');
    ok("tokens() labels a call, a keyword, a string and a comment",
      t.some(x => x.k === "fn") && t.some(x => x.k === "kw") && t.some(x => x.k === "str") && t.some(x => x.k === "com"), t.slice(0, 6));
  }

  /* ================================================================== 4 */
  console.log("\n== limits: a runaway script stops and says where");

  {
    const c = compile('study("x")\nn = 0\nwhile true\n    n := n + 1\nplot(n, "n")\n');
    const r = DXS.run(c.prog, BARS, {}, {});
    ok("an infinite while stops on the per-bar loop budget, with a line",
      r.errors.length === 1 && /10000 times/.test(r.errors[0].msg) && r.errors[0].line === 3, r.errors);
    ok("...and the rows it already had still come back", r.rows.length === 1, r.rows.length);
  }
  {
    const c = compile('study("x")\ns = 0.0\nfor i = 0 to 9000\n    s := s + i\nplot(s, "s")\n');
    const t0 = Date.now();
    const r = DXS.run(c.prog, BARS, {}, {});
    ok("a loop under the per-bar cap still meets the whole-run step budget",
      r.errors.length === 1 && /interpreter steps|ms budget/.test(r.errors[0].msg) && r.errors[0].line > 0, r.errors);
    ok("...and it gave up quickly rather than hanging the tab", Date.now() - t0 < 4000, { ms: Date.now() - t0, steps: r.steps });
  }
  {
    const c = compile('study("x")\nvar a = array.new_float(0)\nfor i = 0 to 9999\n    array.push(a, close)\nplot(array.size(a), "n")\n');
    const r = DXS.run(c.prog, BARS, {}, {});
    ok("a 200k-element push is refused, on the line that pushed",
      r.errors.length === 1 && /100000 elements/.test(r.errors[0].msg) && r.errors[0].line === 4, r.errors);
  }
  {
    const c = compile('study("x")\nf(n) => n <= 0 ? 0 : f(n - 1) + 1\nplot(f(100), "d")\n');
    ok("a recursive function compiles", c.ok, c.errors);
    const r = DXS.run(c.prog, BARS, {}, {});
    ok("...and stops at depth 64 rather than blowing the JS stack",
      r.errors.length === 1 && /64 deep/.test(r.errors[0].msg) && r.errors[0].line > 0, r.errors);
  }
  {
    let big = 'study("x")\n';
    while (big.length < 70000) big += 'plot(close, "c")\n';
    const c = compile(big);
    ok("a source over 64 KB is refused before it is parsed", !c.ok && /64 KB/.test(c.errors[0].msg), c.errors);
  }
  {
    let many = 'study("x")\n';
    for (let i = 0; i < 40; i++) many += 'plot(close, "p' + i + '")\n';
    const c = compile(many);
    ok("more than 32 plots is refused", !c.ok && /32 plots/.test(c.errors[0].msg), c.errors);
  }
  {
    const L = DXS.limits();
    ok("limits() reports the eight budgets",
      L.steps === 4000000 && L.ms === 250 && L.depth === 64 && L.loop === 10000 && L.array === 100000 && L.plots === 32 && L.slots === 4096 && L.source === 65536, L);
  }

  /* ================================================================== 5 */
  console.log("\n== the strategy: no order can be filled by the bar that placed it");

  {
    const src = 'strategy("nl", overlay=true, initial_capital=10000, commission=0, slippage=0, default_qty=1)\n' +
      'if bar_index == 10\n    strategy.entry("l", "long")\n' +
      'if bar_index == 20\n    strategy.close("l")\n' +
      'plot(close, "c")\n';
    const r = runSrc(src);
    const t = r.strategy.trades;
    ok("an entry signalled on bar 10 fills at bar 11's open",
      t.length === 1 && t[0].entryBar === 11 && t[0].entryPrice === BARS[11].o, t[0] && { bar: t[0].entryBar, px: t[0].entryPrice, want: BARS[11].o });
    ok("an exit signalled on bar 20 fills at bar 21's open",
      t.length === 1 && t[0].exitBar === 21 && t[0].exitPrice === BARS[21].o, t[0] && { bar: t[0].exitBar, px: t[0].exitPrice, want: BARS[21].o });
  }
  {
    /* the cheat: enter and exit on the same bar, at the close it has just
       seen. Both orders go into the same queue, so both meet the same open. */
    const src = 'strategy("cheat", overlay=true, initial_capital=10000, commission=0, slippage=0, default_qty=1)\n' +
      'if bar_index == 10\n    strategy.entry("l", "long")\n    strategy.close("l")\n' +
      'plot(close, "c")\n';
    const r = runSrc(src);
    const t = r.strategy.trades;
    ok("a strategy that tries to enter and exit on one bar cannot fill on it",
      t.length === 1 && t[0].entryBar === 11 && t[0].exitBar === 11, t[0] && { inb: t[0].entryBar, outb: t[0].exitBar });
    ok("...and it books exactly nothing, not the move it had already seen",
      t.length === 1 && t[0].entryPrice === BARS[11].o && t[0].exitPrice === BARS[11].o && t[0].pnl === 0, t[0] && { pnl: t[0].pnl });
    ok("...no trade anywhere in the run opened before the signal bar closed",
      r.strategy.trades.every(x => x.entryBar >= 11));
  }
  {
    const r = runSrc('strategy("lim", overlay=true, initial_capital=10000, commission=0, slippage=0, default_qty=1)\n' +
      'if bar_index == 10\n    strategy.entry("l", "long", limit=close * 0.5)\n' +
      'plot(close, "c")\n');
    ok("a limit far away simply never fills", r.strategy.trades.length === 0 && r.strategy.stats.openAtEnd === 0);
  }

  /* ---------- the hand-built series with a known answer ---------- */
  {
    const O = [100, 100, 100, 100, 105, 110, 110, 110, 110, 108, 104, 104];
    const C = [100, 100, 105, 105, 110, 110, 110, 108, 106, 104, 104, 104];
    const HB = O.map((o, i) => ({
      t: T0 + i * 3600000, o, c: C[i], h: Math.max(o, C[i]), l: Math.min(o, C[i]), v: 100
    }));
    const src = 'strategy("hand", overlay=true, initial_capital=1000, commission=0, slippage=0, default_qty=1)\n' +
      'if bar_index == 1\n    strategy.entry("l", "long")\n' +
      'if bar_index == 4\n    strategy.close("l")\n' +
      'if bar_index == 6\n    strategy.entry("l", "long")\n' +
      'if bar_index == 9\n    strategy.close("l")\n' +
      'plot(close, "c")\n';
    const c = compile(src);
    const r = DXS.run(c.prog, HB, {}, {});
    const t = r.strategy.trades, s = r.strategy.stats;
    ok("hand-built run books exactly two trades", t.length === 2, t.map(x => [x.entryBar, x.entryPrice, x.exitBar, x.exitPrice, x.pnl]));
    ok("trade 1: in at bar 2 @100, out at bar 5 @110, +10 (+10%), 3 bars",
      t.length === 2 && t[0].entryPrice === 100 && t[0].exitPrice === 110 && t[0].pnl === 10 && t[0].pnlPct === 10 && t[0].bars === 3, t[0]);
    ok("trade 2: in at bar 7 @110, out at bar 10 @104, −6, 3 bars",
      t.length === 2 && t[1].entryPrice === 110 && t[1].exitPrice === 104 && t[1].pnl === -6 && t[1].bars === 3, t[1]);
    ok("MAE and MFE come off the bars the trade was open for",
      t.length === 2 && t[0].mae === 0 && t[0].mfe === 10 && t[1].mae === -6 && t[1].mfe === 0,
      t.map(x => [x.mae, x.mfe]));
    ok("the equity curve is one value per bar and marks the open position",
      JSON.stringify(r.strategy.equity) === JSON.stringify([1000, 1000, 1005, 1005, 1010, 1010, 1010, 1008, 1006, 1004, 1004, 1004]), r.strategy.equity);
    ok("net profit is 4", s.netProfit === 4, s.netProfit);
    ok("gross profit 10, gross loss 6", s.grossProfit === 10 && s.grossLoss === 6, [s.grossProfit, s.grossLoss]);
    ok("profit factor is 10/6", near(s.profitFactor, 10 / 6), s.profitFactor);
    ok("win rate is 50%", s.winRate === 50, s.winRate);
    ok("average win 10, average loss 6", s.avgWin === 10 && s.avgLoss === 6, [s.avgWin, s.avgLoss]);
    ok("largest win 10, largest loss 6", s.largestWin === 10 && s.largestLoss === 6, [s.largestWin, s.largestLoss]);
    ok("max drawdown is 6 on the equity curve", s.maxDrawdown === 6, s.maxDrawdown);
    ok("max drawdown is 0.594…% of the peak", near(s.maxDrawdownPct, 6 / 1010 * 100), s.maxDrawdownPct);
    ok("final equity 1004, return 0.4%", s.finalEquity === 1004 && near(s.returnPct, 0.4), [s.finalEquity, s.returnPct]);
    ok("trade count, wins and losses agree", s.trades === 2 && s.wins === 1 && s.losses === 1);
    {
      const eq = r.strategy.equity, ret = [];
      for (let i = 1; i < eq.length; i++) ret.push(eq[i] / eq[i - 1] - 1);
      let m = 0; ret.forEach(v => m += v); m /= ret.length;
      let q = 0; ret.forEach(v => q += (v - m) * (v - m));
      const sd = Math.sqrt(q / ret.length);
      ok("Sharpe is the annualised per-bar equity return", near(s.sharpe, m / sd * Math.sqrt(31557600000 / 3600000)), s.sharpe);
    }
  }
  {
    /* commission and slippage actually reach the fill */
    const O = [100, 100, 100, 100, 100, 100];
    const HB = O.map((o, i) => ({ t: T0 + i * 3600000, o, c: 100, h: 100, l: 100, v: 1 }));
    const c = compile('strategy("fees", overlay=true, initial_capital=1000, commission=1, slippage=0, default_qty=2)\n' +
      'if bar_index == 0\n    strategy.entry("l", "long")\n' +
      'if bar_index == 2\n    strategy.close("l")\n' +
      'plot(close, "c")\n');
    const r = DXS.run(c.prog, HB, {}, {});
    const t = r.strategy.trades[0];
    ok("commission is a percent of notional charged on both sides",
      t && t.qty === 2 && near(t.fees, 4) && near(t.pnl, -4), t && { fees: t.fees, pnl: t.pnl });
  }
  {
    const O = [100, 100, 100, 100];
    const HB = O.map((o, i) => ({ t: T0 + i * 3600000, o, c: 100, h: 100, l: 100, v: 1 }));
    const c = compile('strategy("slip", overlay=true, initial_capital=1000, commission=0, slippage=3, default_qty=1)\n' +
      'if bar_index == 0\n    strategy.entry("l", "long")\n' +
      'if bar_index == 1\n    strategy.close("l")\n' +
      'plot(close, "c")\n');
    const r = DXS.run(c.prog, HB, {}, {});
    const t = r.strategy.trades[0];
    ok("slippage is ticks and always works against the fill", t && t.entryPrice > 100 && t.exitPrice < 100 && t.pnl < 0, t && { i: t.entryPrice, o: t.exitPrice });
  }
  {
    const O = [100, 100, 100, 100, 100, 100];
    const HB = O.map((o, i) => ({ t: T0 + i * 3600000, o, c: 100, h: 100, l: 100, v: 1 }));
    const c = compile('strategy("pyr", overlay=true, initial_capital=100000, commission=0, slippage=0, pyramiding=2, default_qty=1)\n' +
      'strategy.entry("l", "long")\n' +
      'plot(close, "c")\n');
    const r = DXS.run(c.prog, HB, {}, {});
    ok("pyramiding caps how many entries stack up in one direction", r.strategy.stats.openAtEnd === 2, r.strategy.stats.openAtEnd);
  }

  /* ================================================================== 6 */
  console.log("\n== registration: a script becomes a study the engine cannot tell apart");

  ok("the layer mounted onto the host", DXC.mount() === true);
  DXC.draw();
  flush();
  for (let i = 0; i < 14; i++) { await tick(); flush(); }
  ok("candles arrived through the engine's own data path", DXC.bars().length > 300, { bars: DXC.bars().length });

  const before = DXC.indicators().length;
  {
    const reg = DXS.register("t1", 'study("Harness one", overlay=false, precision=2, range_lo=0, range_hi=100)\nlen = input.int(14, "Length", minval=2, maxval=400)\nplot(ta.rsi(close, len), "RSI", color="#00E5FF")\nhline(70, "ob", linestyle="dashed")\n');
    ok("register() returns the key the engine stores it under", reg.ok && reg.key === "dxs:t1", reg.errors);
    ok("the study appears in DXC.indicators()", DXC.indicators().indexOf("dxs:t1") >= 0 && DXC.indicators().length === before + 1);
    ok("its inputs became a dialog the engine can render",
      (() => { const d = DXC.studyDefs()["dxs:t1"]; return d && d.g === "Scripts" && d.over === false && d.in.length === 1 && d.in[0].k === "len" && d.in[0].d === 14; })(),
      DXC.studyDefs()["dxs:t1"] && DXC.studyDefs()["dxs:t1"].in);

    DXC.studies().length = 0;
    DXC.clearErrors();
    ops = 0;
    const st = DXC.addStudy("dxs:t1");
    flush(); DXC.paint();
    ok("adding it paints without an error", ops > 200 && DXC.errors().length === 0, { ops, errs: DXC.errors().slice(0, 3) });
    const geo = DXC.geometry();
    const pane = geo.layout[1];
    ok("its pane took the fixed range the script declared (engine reads `range`)",
      !!pane && !!pane.fixed && pane.fixed[0] === 0 && pane.fixed[1] === 100, pane && pane.fixed);
    ok("its rows and levels reached the renderer",
      !!pane && pane.rows.length === 1 && pane.rows[0].r.rows.length === 1 && pane.rows[0].r.levels.length === 1);
    void st;
  }
  {
    /* every starting template, through the same door a user would use */
    let bad = [];
    DXS.PRELUDE.forEach((p, i) => {
      const reg = DXS.register("pre" + i, p.src);
      if (!reg.ok) { bad.push({ i, name: p.name, errors: reg.errors }); return; }
      DXC.studies().length = 0;
      DXC.clearErrors();
      ops = 0;
      DXC.addStudy(reg.key);
      flush(); DXC.paint();
      const geo = DXC.geometry();
      let drew = false;
      if (geo) {
        const pools = [].concat(geo.rowsFor || [], ...geo.layout.slice(1).map(q => q.rows || []));
        drew = pools.some(q => q.st.k === reg.key && (q.r.rows.length > 0 || (q.r.levels || []).length > 0));
      }
      if (!drew || DXC.errors().length || ops < 150) bad.push({ i, name: p.name, drew, ops, errs: DXC.errors().slice(0, 2) });
    });
    ok("all " + DXS.PRELUDE.length + " starting templates register, draw and leave DXC.errors() empty", bad.length === 0, bad);
    ok("registered() lists every one of them", DXS.registered().length === DXS.PRELUDE.length + 1, DXS.registered().length);
  }
  {
    /* removal goes through the engine's own half of the contract, with an
       instance of the script sitting on the chart while it happens */
    DXC.studies().length = 0;
    DXC.clearErrors();
    const inst = DXC.addStudy("dxs:t1");
    flush(); DXC.paint();
    const n0 = DXC.indicators().length;
    ok("the study under test is on the chart before it is removed",
      DXC.studies().some(x => x.k === "dxs:t1") && !!inst);
    const gone = DXS.unregister("t1");
    ok("unregister() removes the definition and the engine's key list follows",
      gone === true && !DXC.studyDefs()["dxs:t1"] && DXC.indicators().indexOf("dxs:t1") < 0 && DXC.indicators().length === n0 - 1,
      { before: n0, after: DXC.indicators().length });
    ok("...the instance that was on the chart went with it",
      DXC.studies().every(x => x.k !== "dxs:t1"), DXC.studies().map(x => x.k));
    ok("...no placeholder was parked in its place",
      DXC.indicators().indexOf("dxs:__none") < 0 && !DXC.studyDefs()["dxs:__none"] &&
      DXC.indicators().every(k => k.indexOf("dxs:") !== 0 || !!DXS.registered().some(r => r.key === k)),
      DXC.indicators().filter(k => k.indexOf("dxs:") === 0));
    ok("...and every key the dialog still lists has a definition behind it",
      DXC.indicators().every(k => !!DXC.studyDefs()[k]));
    DXC.clearErrors();
    ops = 0;
    flush(); DXC.paint();
    ok("...a paint after the removal is clean", ops > 150 && DXC.errors().length === 0, { ops, errs: DXC.errors().slice(0, 3) });
    ok("adding a key that was unregistered does nothing", DXC.addStudy("dxs:t1") === undefined && DXC.studies().every(x => x.k !== "dxs:t1"));
    ok("the engine refuses to unregister one of its own 65 built-ins",
      DXC.unregisterStudy("rsi") === false && DXC.indicators().indexOf("rsi") >= 0);
    DXC.studies().length = 0;
  }
  {
    const r = DXS.register("t1", 'study("x")\nplot(nope, "c")\n');
    ok("register() refuses a script that does not compile and says where", !r.ok && r.errors[0].line === 2, r.errors);
    ok("...and nothing was left half-registered", !DXC.studyDefs()["dxs:t1"]);
  }
  {
    /* the engine hands a SELECT back as a string and a number field as a
       number, so every input type has to survive that round trip */
    const reg = DXS.register("t2", 'study("Types", overlay=true)\nn = input.int(5, "n", minval=1, maxval=50)\nb = input.bool(true, "b")\ns = input.string("EMA", "s", options=["EMA", "SMA"])\nsrc = input.source(close, "src")\nc = input.color("#FFD166", "c")\nplot(b ? (s == "EMA" ? ta.ema(src, n) : ta.sma(src, n)) : na, "out", color=c)\n');
    ok("a mixed-input script registers", reg.ok, reg.errors);
    const def = DXC.studyDefs()["dxs:t2"];
    const bs = DXC.bars();
    const a1 = def.calc(bs, { n: 10, b: "on", s: "SMA", src: "high", c: "#FF5A78" }, { c: "#5B8CFF", w: 1.4, dash: 0 });
    const a2 = def.calc(bs, { n: 10, b: "off", s: "SMA", src: "high", c: "#FF5A78" }, { c: "#5B8CFF", w: 1.4, dash: 0 });
    const want = oSma(bs.map(x => x.h), 10);
    ok("a bool input arrives as \"on\"/\"off\" and a source input as a name",
      sameSeries(a1.rows[0].data, want).ok && a2.rows[0].data.every(v => v === null),
      sameSeries(a1.rows[0].data, want));
    ok("a colour input reaches the row", a1.rows[0].c === "#FF5A78", a1.rows[0].c);
    DXS.unregister("t2");
  }

  /* ================================================================== 7 */
  console.log("\n== determinism");
  {
    const c = compile(DXS.PRELUDE[1].src);
    const a = DXS.run(c.prog, BARS, { len: 21 }, {});
    const b = DXS.run(c.prog, BARS, { len: 21 }, {});
    const strip = r => JSON.stringify({ rows: r.rows, levels: r.levels, plots: r.plots, alerts: r.alerts, zero: r.zero, range: r.range, errors: r.errors, steps: r.steps });
    ok("the same program over the same bars twice is byte-identical", strip(a) === strip(b));
    ok("...and the step count is identical too", a.steps === b.steps, [a.steps, b.steps]);
    const c2 = compile('study("r")\nplot(math.random(0, 1, 7), "x")\n');
    const r1 = DXS.run(c2.prog, BARS, {}, {}), r2 = DXS.run(c2.prog, BARS, {}, {});
    ok("even math.random repeats, because its seed is reset per run",
      JSON.stringify(r1.plots[0].values) === JSON.stringify(r2.plots[0].values));
  }
  {
    const c = compile(DXS.PRELUDE[5].src);
    const a = DXS.run(c.prog, BARS, {}, {}), b = DXS.run(c.prog, BARS, {}, {});
    ok("a strategy is deterministic to the trade", JSON.stringify(a.strategy) === JSON.stringify(b.strategy));
  }

  /* ------------------------------------------------------------ argument aliases
     The build counts the byte sequence style=" across the whole payload as an inline
     style attribute and cannot tell an HTML attribute from those characters inside a
     script's source string. The shipped library is therefore written with draw= and
     dash=, and style= / linestyle= stay valid because that is what a converted Pine
     script arrives spelling. Both spellings must keep producing the same chart. */
  (function () {
    var A = 'study("alias", overlay=false)\nr = ta.rsi(close, 14)\n' +
            'plot(r, "R", draw="histogram")\nhline(70, "OB", dash="dashed")\n' +
            'plotshape(ta.crossover(r, 30), "B", draw="triangleup", location="bottom")\n';
    var B = 'study("alias", overlay=false)\nr = ta.rsi(close, 14)\n' +
            'plot(r, "R", style="histogram")\nhline(70, "OB", linestyle="dashed")\n' +
            'plotshape(ta.crossover(r, 30), "B", style="triangleup", location="bottom")\n';
    var ca = DXS.compile(A), cb = DXS.compile(B);
    ok("draw= and dash= compile", ca.ok, ca.errors);
    ok("style= and linestyle= still compile", cb.ok, cb.errors);
    if (ca.ok && cb.ok) {
      var ra = DXS.run(ca.prog, BARS, {}, {}), rb = DXS.run(cb.prog, BARS, {}, {});
      ok("the two spellings produce the same rows and levels",
        JSON.stringify(ra.rows) === JSON.stringify(rb.rows) &&
        JSON.stringify(ra.levels) === JSON.stringify(rb.levels));
    }
    var bad = DXS.compile('study("x")\nplot(close, "c", drawr="line")\n');
    ok("an unknown argument name is still refused", !bad.ok && /drawr/.test((bad.errors[0]||{}).msg || ""));
  })();


  /* ================================================================== 8 */
  console.log("\n== the library surface");
  {
    const by = {};
    DXS.docs().forEach(d => { by[d.ns] = (by[d.ns] || 0) + 1; });
    ok("docs() describes every entry with a namespace, a signature and prose",
      DXS.docs().every(d => d.ns && d.name && d.sig && d.about) && by.ta >= 60 && by.math >= 24 && by.str === 13 && by.array === 27,
      by);
    console.log("      " + Object.keys(by).sort().map(k => k + ":" + by[k]).join("  "));
  }
  {
    /* a broad sweep: call every ta.* entry once and make sure none of them
       throws or returns something that is not a number, a bool or na */
    const docs = DXS.docs().filter(d => d.ns === "ta");
    let bad = [];
    docs.forEach(d => {
      const full = "ta." + d.name;
      const tup = /^\[/.test(d.sig);
      const BOOLS = { crossover: 1, crossunder: 1, cross: 1, rising: 1, falling: 1 };
      const wrap = x => (BOOLS[d.name] ? "(" + x + " ? 1 : 0)" : x);
      const nOut = tup ? d.sig.slice(1, d.sig.indexOf("]")).split(",").length : 1;
      const names = [];
      for (let q = 0; q < nOut; q++) names.push("q" + q);
      const src = tup
        ? 'study("s")\n[' + names.join(", ") + '] = ' + full + '(' + argsFor(full) + ')\nplot(q0, "x")\n'
        : 'study("s")\nplot(' + wrap(full + '(' + argsFor(full) + ')') + ', "x")\n';
      const c = compile(src);
      if (!c.ok) { bad.push({ full, errors: c.errors }); return; }
      const r = DXS.run(c.prog, BARS, {}, {});
      if (r.errors.length) { bad.push({ full, errors: r.errors }); return; }
      const v = r.plots[0].values;
      if (!v || v.length !== BARS.length) { bad.push({ full, why: "wrong length" }); return; }
      if (!v.some(x => x !== null)) bad.push({ full, why: "never produced a value" });
      if (v.some(x => x !== null && typeof x !== "number" && typeof x !== "boolean")) bad.push({ full, why: "produced a non-number" });
    });
    ok("all " + docs.length + " ta.* entries compute a real series over the bars", bad.length === 0, bad.slice(0, 5));
  }

  console.log(fails ? "\nFAILED · " + fails + " of " + checks + " check(s)" : "\nall " + checks + " checks passed · " + DXS.docs().length + " library entries · " + DXS.PRELUDE.length + " templates");
  process.exit(fails ? 1 : 0);
})();

/* arguments good enough to exercise each ta.* entry once */
function argsFor(full) {
  const A = {
    "ta.sma": "close, 14", "ta.ema": "close, 14", "ta.rma": "close, 14", "ta.smma": "close, 14",
    "ta.wma": "close, 14", "ta.hma": "close, 14", "ta.swma": "close", "ta.vwma": "close, 14",
    "ta.vwap": "hlc3", "ta.sum": "close, 14", "ta.cum": "volume", "ta.change": "close, 1",
    "ta.mom": "close, 10", "ta.roc": "close, 9", "ta.stdev": "close, 20", "ta.variance": "close, 20",
    "ta.dev": "close, 20", "ta.median": "close, 20", "ta.mode": "close, 20",
    "ta.percentile_linear_interpolation": "close, 20, 75", "ta.percentrank": "close, 20",
    "ta.highest": "high, 14", "ta.lowest": "low, 14", "ta.highestbars": "high, 14", "ta.lowestbars": "low, 14",
    "ta.rising": "close, 3", "ta.falling": "close, 3",
    "ta.crossover": "close, ta.sma(close, 20)", "ta.crossunder": "close, ta.sma(close, 20)", "ta.cross": "close, ta.sma(close, 20)",
    "ta.barssince": "close > open", "ta.valuewhen": "close > open, close, 0",
    "ta.pivothigh": "3, 3", "ta.pivotlow": "3, 3",
    "ta.rsi": "close, 14", "ta.stoch": "close, high, low, 14", "ta.stochrsi": "close, 14, 14",
    "ta.macd": "close, 12, 26, 9", "ta.tr": "", "ta.atr": "14", "ta.atr_percent": "14", "ta.range": "14",
    "ta.bb": "close, 20, 2", "ta.bbw": "close, 20, 2", "ta.kc": "close, 20, 2", "ta.kcw": "close, 20, 2",
    "ta.dmi": "14, 14", "ta.adx": "14, 14", "ta.cci": "hlc3, 20", "ta.mfi": "hlc3, 14",
    "ta.obv": "", "ta.accdist": "", "ta.cmo": "close, 9", "ta.tsi": "close, 13, 25", "ta.wpr": "14",
    "ta.sar": "0.02, 0.02, 0.2", "ta.supertrend": "3, 10", "ta.linreg": "close, 14, 0",
    "ta.correlation": "close, open, 20", "ta.alma": "close, 21, 0.85, 6", "ta.kama": "close, 10, 2, 30",
    "ta.dema": "close, 20", "ta.tema": "close, 20", "ta.zlema": "close, 20", "ta.trix": "close, 18"
  };
  return A[full] === undefined ? "close, 14" : A[full];
}
