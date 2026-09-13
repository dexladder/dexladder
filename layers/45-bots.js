/* ============================================================================
   DLBOTS · v160 — BUILD YOUR OWN BOT and BRING YOUR OWN BOT.
   ---------------------------------------------------------------------------
   Two ways to put a strategy in front of the live market, both on paper money:
     · Build — rules as blocks (indicator, comparison, value), tested on real
       history bar by bar, then run live.
     · Bring — YOUR bot. Either JavaScript that runs in a Worker this layer
       spawns, or your own process (any language) answering one GET with one
       JSON object. Either way it trades a wallet of its own; the trader's
       paper account is never reachable from a bot.

   WHAT THIS LAYER IS RESPONSIBLE FOR — the three effects the typed core is not
   allowed to hold: fetching candles, running the user's code, and calling the
   user's endpoint. Everything else (the rules, the wallet, the scoring, the
   panels) is in web/app/src/lib/bots + hooks/useBots + components/domain/bot-*
   + legacy/bots*.ts, and the architecture gate keeps it that way.

   THE SANDBOX, exactly
   1 · The user's code IS the Worker's own script: a Blob of [shield + their
       source + bridge]. Nothing is eval'd — the payload stays eval-free.
   2 · The shield removes fetch, XMLHttpRequest, WebSocket, importScripts,
       indexedDB and caches from the Worker's global scope before the user's
       first line runs. A Worker has no DOM and no storage to begin with.
   3 · One answer per closed bar, with a deadline. A bot that hangs is
       terminated and reported; five consecutive failures stop it.
   4 · A signal endpoint is called with a plain GET (no custom headers, so no
       preflight) and a timeout; what comes back is parsed by the typed core.
       Every call is measured where it happens — round trip, HTTP status or the
       named fault when there was none, bytes each way, and the raw request and
       response — and handed to lib/bots/telemetry, which is the only honest way
       to say whether someone's own bot is healthy: a browser reports every
       refusal, every missing CORS header and every wrong port as one empty
       TypeError, so the calls themselves are the evidence.
   5 · A SECOND Worker, built exactly the way the sandbox one is (a Blob of
       [shield + script], no eval), runs backtests off the main thread. Its
       script is the app bundle itself — the same runStrategy the main thread
       would call, out of the same bytes — so "identical numbers" is a property
       of the construction, not a hope. DLBOTS.btProof() runs both and compares.

   Layer contract: self-mounting, idempotent, no persistent timer of its own
   (the hook owns the loop), no rebinding of any top-level binding, no inline
   style, no innerHTML, and it edits no other layer.
   ============================================================================ */
window.DLBOTS = (function () {
  "use strict";
  if (window.DLBOTS && window.DLBOTS.__v) return window.DLBOTS;
  var C = window.DLCORE, $ = C.$;
  var TIMEOUT_MS = 8000, BAR_MS = 1500, READY_MS = 4000, BT_MS = 60000;
  var workers = {};   /* bot id → { w, url, ready, seq, pending } */

  /* ----------------------------------------------------------------- candles
     The same ladder the Rewind desk uses, through the payload's own fetch path
     (DLCORE.jget: cache, timeout, host health). Binance market-data first (it
     is the only free host with every bar size), then Coinbase. */
  function get(url, key, ttl) {
    if (!C || typeof C.jget !== "function") return Promise.reject(new Error("no data path on this page"));
    return C.jget(url, { key: key, ttl: ttl || 45000, ms: 9000 }).then(function (r) { return r && "data" in r ? r.data : r; });
  }

  function bars(sym, interval, limit) {
    var B = window.DLAPP.bots, K = window.DLAPP.backtest;
    var n = Math.min(1000, limit || 400);
    return get(B.klinesUrl(sym, interval, n), "dl.bot.b." + sym + "." + interval, 45000)
      .then(function (rows) { return K.binanceCandles(rows); })
      .then(function (cs) { if (cs.length) return cs; throw new Error("no bars"); })
      .catch(function () {
        return get(B.coinbaseUrl(sym, interval), "dl.bot.c." + sym + "." + interval, 45000)
          .then(function (rows) { return K.coinbaseCandles(rows); })
          .then(function (cs) {
            if (cs.length) return cs;
            throw new Error("No venue has " + sym + " " + interval + " bars right now — try another market or bar size.");
          });
      });
  }

  /* ------------------------------------------------------------ the sandbox
     The Worker's script is: shield, then the user's own source, then the
     bridge that calls their onBar. No eval, no Function, no import. */
  var SHIELD = [
    "(function(){var g=self;['fetch','XMLHttpRequest','WebSocket','importScripts','indexedDB','caches','Notification','SharedWorker','Worker'].forEach(function(k){",
    "try{Object.defineProperty(g,k,{value:undefined,configurable:false,writable:false})}catch(e){try{g[k]=undefined}catch(e2){}}});})();",
    "var __ta=(function(){function sma(a,n){if(!a.length)return 0;var s=0,k=Math.min(n,a.length);for(var i=a.length-k;i<a.length;i++)s+=a[i];return s/k}",
    "function ema(a,n){if(!a.length)return 0;var k=2/(n+1),e=a[0];for(var i=1;i<a.length;i++)e=a[i]*k+e*(1-k);return e}",
    "function rsi(a,n){n=n||14;if(a.length<n+1)return 50;var g=0,l=0,i;for(i=1;i<=n;i++){var d=a[i]-a[i-1];d>=0?g+=d:l-=d}g/=n;l/=n;",
    "for(i=n+1;i<a.length;i++){var x=a[i]-a[i-1];g=(g*(n-1)+(x>0?x:0))/n;l=(l*(n-1)+(x<0?-x:0))/n}return l===0?100:100-100/(1+g/l)}",
    "function atr(bs,n){n=n||14;if(!bs.length)return 0;var p=null,s=0,c=0;for(var i=0;i<bs.length;i++){var b=bs[i];var tr=p===null?b.h-b.l:Math.max(b.h-b.l,Math.abs(b.h-p),Math.abs(b.l-p));p=b.c;s+=tr;c++;if(c>n){s-=0}}return s/Math.max(1,c)}",
    "function hi(a,n){var k=Math.min(n,a.length),m=-Infinity;for(var i=a.length-k;i<a.length;i++)m=Math.max(m,a[i]);return m}",
    "function lo(a,n){var k=Math.min(n,a.length),m=Infinity;for(var i=a.length-k;i<a.length;i++)m=Math.min(m,a[i]);return m}",
    "function cross(f,s){return f>s?'up':f<s?'down':'flat'}",
    "return{sma:sma,ema:ema,rsi:rsi,atr:atr,highest:hi,lowest:lo,cross:cross}})();",
    "var module={exports:{}};",
    "/* ---- your strategy starts here ---- */\n",
  ].join("");

  var BRIDGE = [
    "\n/* ---- your strategy ends here ---- */",
    "self.onmessage=function(ev){var m=ev.data;if(!m||m.t!=='bar')return;var ctx=m.ctx;ctx.ta=__ta;",
    "var fn=(typeof onBar==='function')?onBar:(module.exports&&typeof module.exports.onBar==='function'?module.exports.onBar:null);",
    "if(!fn){self.postMessage({t:'error',id:m.id,message:'no onBar(ctx) was defined — DexLadder calls onBar on every closed bar'});return}",
    "try{var v=fn(ctx);self.postMessage({t:'signal',id:m.id,value:v===undefined?null:v})}",
    "catch(e){self.postMessage({t:'error',id:m.id,message:'onBar threw: '+((e&&e.message)||e)})}};",
    "self.postMessage({t:'ready',hasOnBar:typeof onBar==='function'||!!(module.exports&&module.exports.onBar)});",
  ].join("");

  function kill(id) {
    var s = workers[id];
    if (!s) return;
    try { s.w.terminate(); } catch (e) {}
    try { URL.revokeObjectURL(s.url); } catch (e) {}
    delete workers[id];
  }

  function spawn(def) {
    kill(def.id);
    var src = SHIELD + window.DLAPP.bots.prepareCode(String(def.code || "")) + BRIDGE;
    var url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    var w = new Worker(url);
    var s = { w: w, url: url, ready: false, seq: 0, pending: {}, code: def.code };
    workers[def.id] = s;
    w.onmessage = function (ev) {
      var m = ev.data || {};
      if (m.t === "ready") { s.ready = true; if (s.onReady) s.onReady(); return; }
      var p = s.pending[m.id];
      if (!p) return;
      delete s.pending[m.id];
      clearTimeout(p.timer);
      if (m.t === "error") p.done({ error: m.message, ms: Date.now() - p.t0 });
      else {
        var out = window.DLAPP.bots.normalise(m.value);
        p.done(out.error ? { error: out.error, ms: Date.now() - p.t0 } : { signal: out.signal, ms: Date.now() - p.t0 });
      }
    };
    w.onerror = function (e) {
      var msg = "your code could not start: " + ((e && e.message) || "syntax error") + (e && e.lineno ? " (line " + Math.max(1, e.lineno - 14) + ")" : "");
      Object.keys(s.pending).forEach(function (k) { var p = s.pending[k]; clearTimeout(p.timer); delete s.pending[k]; p.done({ error: msg, ms: 0 }); });
      if (s.onReady) s.onReady(msg);
      s.broken = msg;
      try { e.preventDefault(); } catch (e2) {}
    };
    return s;
  }

  /** one bar, one answer, with a deadline — the typed core decides what it means */
  function js(def, ctx) {
    var s = workers[def.id];
    if (!s || s.code !== def.code) s = spawn(def);
    return new Promise(function (resolve) {
      if (s.broken) return resolve({ error: s.broken, ms: 0 });
      var id = ++s.seq, t0 = Date.now();
      var p = { t0: t0, done: resolve };
      p.timer = setTimeout(function () {
        delete s.pending[id];
        kill(def.id);
        resolve({ error: "your bot did not answer within " + (BAR_MS / 1000) + "s — it was stopped for this bar (an infinite loop cannot be interrupted any other way)", ms: Date.now() - t0 });
      }, BAR_MS + (s.ready ? 0 : READY_MS));
      s.pending[id] = p;
      var send = function () { try { s.w.postMessage({ t: "bar", id: id, ctx: ctx }); } catch (e) { resolve({ error: "could not reach the sandbox: " + ((e && e.message) || e), ms: 0 }); } };
      if (s.ready) send(); else s.onReady = function (err) { if (err) return; send(); };
    });
  }

  /* --------------------------------------------------------- your own bot
     A plain GET: no custom header, so no preflight for you to answer.

     Every call is measured here, around the fetch itself, because this is the
     only place that knows what actually happened: the status the server sent,
     or — when there was none — which of the four nameable faults it was. The
     ring in lib/bots/telemetry keeps the last 100 of these plus the newest
     request and response verbatim, and the desk shows them. A failure is never
     re-labelled on the way: a timeout is a timeout, an abort is an abort, and a
     fetch that rejected with nothing is "network", not a guess at CORS — a
     browser does not tell a page which of those it was. */
  var REQ_NOTE = "\n\n(GET · mode cors · cache no-store · credentials omit · no referrer · no custom header, so your endpoint never has to answer a preflight.)";

  function poll(t0, ok, status, url, body) {
    var now = Date.now();
    return {
      sample: { t: now, ms: now - t0, ok: !!ok, status: status, reqBytes: url.length, resBytes: body == null ? 0 : String(body).length },
      raw: { request: "GET " + url + REQ_NOTE, response: body == null ? "" : String(body) }
    };
  }

  function signal(def, ctx) {
    var B = window.DLAPP.bots;
    var r = BOTSTATE(def, ctx);
    var url = B.signalUrl(String(def.url || ""), r);
    var t0 = Date.now(), https = location.protocol === "https:";
    return new Promise(function (resolve) {
      var ctl = typeof AbortController === "function" ? new AbortController() : null;
      var timedOut = false;
      var timer = setTimeout(function () {
        timedOut = true;
        if (ctl) ctl.abort();
        var msg = "no answer within " + (TIMEOUT_MS / 1000) + "s from your endpoint";
        resolve({ error: msg, ms: Date.now() - t0, poll: poll(t0, false, "timeout", url, msg) });
      }, TIMEOUT_MS);
      var init = { method: "GET", mode: "cors", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" };
      if (ctl) init.signal = ctl.signal;
      fetch(url, init).then(function (res) {
        return res.text().then(function (body) {
          clearTimeout(timer);
          if (timedOut) return;
          if (!res.ok) return resolve({ error: "your endpoint answered HTTP " + res.status + " · " + B.doctor(def.url, https, String(res.status))[0], ms: Date.now() - t0, poll: poll(t0, false, res.status, url, body) });
          var out = B.parseSignal(body);
          resolve(out.error
            ? { error: out.error, ms: Date.now() - t0, poll: poll(t0, false, "parse", url, body) }
            : { signal: out.signal, ms: Date.now() - t0, poll: poll(t0, true, res.status, url, body) });
        });
      }).catch(function (e) {
        clearTimeout(timer);
        if (timedOut) return;
        var aborted = e && e.name === "AbortError";
        var why = aborted ? "the call was aborted" : ((e && e.message) || String(e));
        var said = "could not reach " + def.url + " — " + why + ". " + B.doctor(def.url, https, why).join(" ");
        resolve({ error: said, ms: Date.now() - t0, poll: poll(t0, false, aborted ? "aborted" : "network", url, said) });
      });
    });
  }

  /* ------------------------------------------------- the backtest Worker
     Built the same way the sandbox is: a Blob of [shield + script], handed to
     new Worker(). Nothing is eval'd. The difference is the script — the
     sandbox's is the USER's code, and this one's is the app bundle, read back
     off its own inline <script> tag. Running the shipped bytes is what makes
     the Worker's numbers identical to the main thread's by construction rather
     than by careful re-implementation.

     window is aliased to self before the bundle runs, because the bundle
     publishes DLAPP with Object.defineProperty(window, …) behind a typeof-window
     guard and would otherwise hand a Worker nothing at all. That is safe only
     because the bundle touches no DOM at load — which is a law it already
     keeps, so the architecture gate is what holds this up. */
  var BT_SHIELD = [
    "self.window=self;",
    "(function(){var g=self;['fetch','XMLHttpRequest','WebSocket','importScripts','indexedDB','caches','Notification','SharedWorker','Worker'].forEach(function(k){",
    "try{Object.defineProperty(g,k,{value:undefined,configurable:false,writable:false})}catch(e){try{g[k]=undefined}catch(e2){}}});})();",
    "\n"
  ].join("");

  /* Progress is reported at the stages the Worker actually crosses. There is no
     percentage inside the fold, and inventing one would be the one number on
     this desk nobody could reproduce: a single pass over the bars cannot stop to
     report on itself, and a faked ramp would claim a precision the core cannot
     back. What the Worker really buys is that the page keeps painting. */
  var BT_BRIDGE = [
    "\nself.onmessage=function(ev){var m=ev.data;if(!m||m.t!=='bt')return;var t0=Date.now();",
    "try{var q=m.req;",
    "self.postMessage({t:'progress',id:m.id,step:1,of:3,text:'Received '+q.bars.length+' bars in a Worker of its own \\u2014 this page stays responsive.'});",
    "var B=self.DLAPP.bots;",
    "self.postMessage({t:'progress',id:m.id,step:2,of:3,text:'Walking every bar: decisions on the close, fills at the next open, risk exits checked against every wick.'});",
    "var r=B.runStrategy(q.strategy,q.bars,q.stake,q.feeRate,{slipBps:q.slipBps});",
    "self.postMessage({t:'progress',id:m.id,step:3,of:3,text:'Scored \\u2014 handing the wallet, the curve and the log back.'});",
    "self.postMessage({t:'done',id:m.id,result:r,ms:Date.now()-t0});",
    "}catch(e){self.postMessage({t:'fail',id:m.id,message:(e&&e.message)||String(e)});}};",
    "self.postMessage({t:'ready'});"
  ].join("");

  var btSrc = null, btW = null, btUrl = null, btSeq = 0, btPending = {}, btBroken = null;
  /* assembled, never written whole — see the note under bundleSource() */
  var BT_MARK = "//@" + "inject-before:";

  /* The app bundle, read back off the inline <script> the build injected it as.
     It carries the build's own early-injection marker at the top, which is what
     identifies it without the build having to cooperate.

     THE MARKER IS NEVER WRITTEN OUT WHOLE IN THIS FILE — not in this comment and
     not in the lookup below. build154.py scans every layer for that literal and
     treats the rest of the line as an anchor that must appear exactly once in
     the payload — a comment ABOUT the marker counts. Spelling it here made this
     layer claim a sentence fragment as an injection anchor, and the
     build died on `anchor not unique`. It is assembled at runtime instead. */
  function bundleSource() {
    if (btSrc) return btSrc;
    var ss = document.getElementsByTagName("script");
    for (var i = 0; i < ss.length; i++) {
      var el = ss[i];
      if (el.src) continue;
      var t = el.textContent || "";
      var k = t.indexOf(BT_MARK);
      if (k >= 0 && k < 40 && t.indexOf("DLAPP") > 0) { btSrc = t; return t; }
    }
    return null;
  }

  function btSpawn() {
    if (btW) return btW;
    if (btBroken) return null;
    if (typeof Worker !== "function") { btBroken = "this browser has no Worker"; return null; }
    var src = bundleSource();
    if (!src) { btBroken = "the app bundle is not an inline script on this page"; return null; }
    try {
      btUrl = URL.createObjectURL(new Blob([BT_SHIELD + src + BT_BRIDGE], { type: "text/javascript" }));
      btW = new Worker(btUrl);
    } catch (e) { btBroken = (e && e.message) || String(e); return null; }
    btW.onmessage = function (ev) {
      var m = ev.data || {};
      if (m.t === "ready") return;
      var p = btPending[m.id];
      if (!p) return;
      if (m.t === "progress") { try { p.onProgress(m); } catch (e) {} return; }
      delete btPending[m.id];
      clearTimeout(p.timer);
      if (m.t === "done") p.resolve(m.result);
      else p.reject(new Error(m.message || "the backtest Worker failed"));
    };
    btW.onerror = function (e) {
      btBroken = "the backtest Worker could not start: " + ((e && e.message) || "unknown");
      Object.keys(btPending).forEach(function (k) { var p = btPending[k]; clearTimeout(p.timer); delete btPending[k]; p.reject(new Error(btBroken)); });
      try { btW.terminate(); } catch (e2) {}
      try { URL.revokeObjectURL(btUrl); } catch (e2) {}
      btW = null;
      try { e.preventDefault(); } catch (e2) {}
    };
    return btW;
  }

  /** one strategy over one set of bars, off the main thread */
  function backtest(req, onProgress) {
    var w = btSpawn();
    if (!w) return Promise.reject(new Error(btBroken || "no Worker on this page"));
    return new Promise(function (resolve, reject) {
      var id = ++btSeq;
      var p = { resolve: resolve, reject: reject, onProgress: onProgress || function () {} };
      p.timer = setTimeout(function () {
        delete btPending[id];
        reject(new Error("the backtest did not finish within " + (BT_MS / 1000) + "s"));
      }, BT_MS);
      btPending[id] = p;
      try { w.postMessage({ t: "bt", id: id, req: req }); }
      catch (e) { delete btPending[id]; clearTimeout(p.timer); reject(new Error("could not reach the backtest Worker: " + ((e && e.message) || e))); }
    });
  }

  /* A deterministic series, so the proof below reproduces on any machine: a
     seeded LCG, never Math.random. */
  function proofBars(n) {
    var H = 3600000, t0 = Math.floor(Date.now() / H) * H - n * H, s = 12345, out = [], p = 100;
    for (var i = 0; i < n; i++) {
      s = (s * 1103515245 + 12345) % 2147483648;
      var u = s / 2147483648 - 0.5;
      p = Math.max(1, p * (1 + u * 0.03));
      out.push({ t: t0 + i * H, o: p, h: p * 1.006, l: p * 0.994, c: p * (1 + u * 0.004), v: 1000 + i });
    }
    return out;
  }

  function digest(r) {
    return {
      equity: r.score.equity, returnPct: r.score.returnPct, buyHoldPct: r.score.buyHoldPct,
      maxDDPct: r.score.maxDDPct, trades: r.score.trades, fills: r.score.fills, feesUSD: r.score.feesUSD,
      cash: r.wallet.cash, qty: r.wallet.qty, marks: r.wallet.marks, bars: r.bars,
      curve: r.curve.length, log: r.log.length, last: r.curve.length ? r.curve[r.curve.length - 1][1] : 0
    };
  }

  function firstDiff(a, b) {
    var n = Math.min(a.length, b.length);
    for (var i = 0; i < n; i++) if (a[i] !== b[i]) return "at char " + i + ": " + a.slice(Math.max(0, i - 40), i + 40) + " ≠ " + b.slice(Math.max(0, i - 40), i + 40);
    return "lengths differ: " + a.length + " vs " + b.length;
  }

  /**
   * Run the SAME strategy over the SAME bars twice — once in the Worker, once on
   * this thread — and compare the two results field for field. This is the claim
   * "the Worker produces identical numbers" stated as something a machine can
   * check, on this build, in this browser, rather than asserted in a comment.
   */
  function btProof(opts) {
    opts = opts || {};
    var K = window.DLAPP.bots;
    var bars = opts.bars || proofBars(opts.n || 600);
    var strategy = opts.strategy || K.preset(opts.preset || "rsi").strategy;
    var stake = opts.stake == null ? 10000 : opts.stake;
    var fee = opts.feeRate == null ? 0.001 : opts.feeRate;
    var slip = opts.slipBps == null ? 0 : opts.slipBps;
    var req = { strategy: strategy, bars: bars, stake: stake, feeRate: fee, slipBps: slip };
    var stages = [], t0 = Date.now();
    var main = K.runStrategy(strategy, bars, stake, fee, { slipBps: slip });
    var mainMs = Date.now() - t0;
    return backtest(req, function (m) { stages.push(m.step); }).then(function (w) {
      var mj = JSON.stringify(main), wj = JSON.stringify(w);
      return {
        equal: mj === wj, viaWorker: true, bars: bars.length, slipBps: slip, stages: stages,
        mainMs: mainMs, chars: mj.length, main: digest(main), worker: digest(w),
        diff: mj === wj ? "" : firstDiff(mj, wj)
      };
    }, function (e) {
      return { equal: false, viaWorker: false, bars: bars.length, slipBps: slip, stages: stages, error: (e && e.message) || String(e), main: digest(main), worker: null };
    });
  }

  function BOTSTATE(def, ctx) {
    return { sym: ctx.sym, interval: ctx.interval, i: ctx.i, t: ctx.t, px: ctx.price, wallet: { qty: ctx.position.qty, cost: ctx.position.qty * ctx.position.avgEntry, cash: ctx.cash }, closes: ctx.close, last: ctx.last };
  }

  /* ------------------------------------------------------------------- desk */
  function body(t, hostEl) {
    try { window.DLAPP.legacy.bots.mount(hostEl); }
    catch (e) { hostEl.textContent = "The Bots desk could not start: " + ((e && e.message) || e); }
  }

  var watched = false;
  function watch(el) {
    if (watched || !el || typeof MutationObserver !== "function") return;
    watched = true;
    new MutationObserver(function () {
      if (!el.classList.contains("on")) { try { window.DLAPP.legacy.bots.hide(); } catch (e) {} }
    }).observe(el, { attributes: true, attributeFilter: ["class"] });
  }

  function open() {
    var el = C.open("dlBots", {
      title: "🤖 Bots",
      sub: "build a bot from rules, or bring your own — each trades its own paper wallet against the live market",
      tabs: [], onTab: body
    });
    watch(el);
    return el;
  }

  /* a launcher in the Terminal's side column, under the Rewind card */
  function mountBtn() {
    try {
      var side = document.querySelector("#page-coin .side");
      if (!side || $("dlBotCard")) return;
      var card = document.createElement("div");
      card.className = "card"; card.id = "dlBotCard";
      var hd = document.createElement("div"); hd.className = "ph";
      var b = document.createElement("b"); b.textContent = "🤖 Bots";
      var tag = document.createElement("span"); tag.className = "tag"; tag.textContent = "AUTOMATE";
      hd.appendChild(b); hd.appendChild(tag);
      var note = document.createElement("div"); note.className = "fnote";
      note.textContent = "Build a bot from rules and test it on real history, or bring your own — JavaScript in a sandbox, or your own program answering one URL. Each bot gets its own paper wallet and is scored against buy-and-hold. Your account is never touched.";
      var go = document.createElement("button"); go.className = "btn"; go.type = "button"; go.textContent = "Open Bots";
      go.onclick = open;
      card.appendChild(hd); card.appendChild(note); card.appendChild(go);
      var rw = $("dlRwCard");
      if (rw && rw.parentNode === side) side.insertBefore(card, rw.nextSibling); else side.appendChild(card);
    } catch (e) {}
  }

  /* install the effects into the typed core, once. `stop` is the kill switch's
     freeze step made real: a sandbox Worker is terminated, never asked to stop,
     because code in an infinite loop cannot answer a request to stand down. */
  try { window.DLAPP.legacy.bots.install({ bars: bars, js: js, signal: signal, backtest: backtest, stop: function (def) { kill(def && def.id); } }); } catch (e) {}
  /* a live bot keeps running while the app is open, whichever page is shown */
  try { window.DLAPP.legacy.bots.restore(); window.DLAPP.legacy.bots.wake(); } catch (e) {}

  C.cmd("bots", "Bots — build your own, or bring your own, and race them on paper", "🤖", open);
  try { if (window.DLDESKS && DLDESKS.register) DLDESKS.register("bots", "🤖", "Bots", "build your own bot, or bring your own", open); } catch (e) {}
  C.onPage("coin", mountBtn);
  return { __v: 160, open: open, mounts: mountBtn, bars: bars, js: js, signal: signal, kill: kill, backtest: backtest, btProof: btProof, btBars: proofBars, btWorker: function () { return !!btW; }, btBroken: function () { return btBroken; } };
})();
