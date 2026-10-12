// owns: feed and storage health report
// reads: DLBX, DLCORE, DLMXC, DLSNAP, DLTRUST154, DLVAULT, browser DOM
// emits: DLHEALTH
/* ============================================================
   DLHEALTH · v164 — desk health, in one place.

   WHAT WAS ALREADY TRUE
   ---------------------
   The machinery this reports on is not new. The hedged ladder, the
   per-source circuit breakers, the 7-day last-known-good snapshot and
   the price quorum have all shipped; Trust -> Feeds already prints the
   ladder state and a per-host table. What did NOT exist was one
   surface that also answers "can this desk still WRITE?" — and that is
   the half that loses data when it is wrong.

   WHAT THIS ADDS TO THAT TAB
   --------------------------
   0. BUILD IDENTITY. Which build this tab is actually running, and whether
      the service worker agrees. The payload's build is READ from the page's
      own <meta name="cb:build"> rather than compiled in here, so this row
      cannot drift from what shipped. The worker's build is read too: the
      worker already answers {dl:'sw-version'} over a MessagePort — see the
      message handler in dist/sw.js, which replies {v,build,rev,payload,ttl,
      max}, and test/swscenarios.js has driven that exact call since v155.
      No API is invented for it. When no reply lands inside the deadline the
      row says the query went unanswered; it never prints a guessed version.
      NOT SHOWN: a payload byte-identity row. Nothing in the page carries a
      hash of itself. The only sha256 of dist/index.html in this system is
      the worker's PAYLOAD_SHA mint lock (build154.py refuses to ship when it
      and the payload disagree), and that is the WORKER's claim about the
      payload it was minted for, not a measurement of this document — so it
      is printed as exactly that, among the worker's rows, and no "payload
      hash" row is invented for the page.
   1. STORAGE. DLVAULT.writable() — the boot write-probe result, not
      "connected" — plus archive row counts, real localStorage bytes,
      and the StorageManager estimate. v163 learned the hard way that a
      full origin is not evidence of a problem (a save replaces its key
      and needs only the delta), so the verdict here fires on one
      signal only: a write that actually threw.
   2. MARKET CACHE. Where the 500-coin pack lives after v164 moved it
      out of localStorage, how old it is, and whether a legacy key is
      still waiting to migrate.
   3. LAST-KNOWN-GOOD. The age of dexladder/kv:snap.v1 against its 7-day
      TTL — the payload that carries a cold visit when every rung is
      down. It was written and read and never shown.
   4. QUORUM. The current witness count, spread and tolerance inline,
      rather than only behind the header pill.

   AND TWO CORRECTIONS
   -------------------
   report() returned v.writable, v.rows and v.press — but vaultRead() resolves
   {ok, st, failed} and carries none of those three, so the console form handed
   back undefined where the panel (which reads v.st) was right all along. It
   now states the same truth the panel does, from the same object.


   Rung 3 has been Coinlore since layers/10-feeds.js began installing
   srcCoinlore at CBDATA._i.srcs[2]. The health model still keys that
   rung "cryptocompare", so the per-host table has been printing the
   name of a host the app no longer calls. Labelled by what serves it.

   ASYNC. blocks() is called from inside an innerHTML assignment and so
   must return synchronously. It returns a skeleton with stable ids and
   schedules one fill pass; every reader is independently guarded, so a
   missing DLVAULT or a rejected estimate leaves one row reading "—"
   instead of emptying the tab.
   ============================================================ */
window.DLHEALTH = (function () {
  "use strict";
  if (window.DLHEALTH && window.DLHEALTH.__v) return window.DLHEALTH;

  var C = window.DLCORE || null;
  var SNAP_TTL = 6048e5; /* 7d — the value DLBX.snapLoad() enforces */

  /* Rung 3 is served by Coinlore; the health model's key predates the swap. */
  var RUNG_LABEL = {
    coingecko: "CoinGecko",
    coinpaprika: "Coinpaprika",
    cryptocompare: "Coinlore",
    binance: "Binance (vision host)",
    coinbase: "Coinbase"
  };

  function esc(s) {
    try { if (C && C.esc) return C.esc(s); } catch (e) {}
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function set(id, html) { var el = $(id); if (el) el.innerHTML = html; }
  function bytes(n) {
    if (!n && n !== 0) return "—";
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(2) + " MB";
  }
  function ago(t) {
    if (!t) return "—";
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.round(s / 60) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
  }
  function good(t) { return '<span class="up">' + esc(t) + "</span>"; }
  function bad(t) { return '<span class="dn">' + esc(t) + "</span>"; }

  /* ------------------------------------------------ readers */

  /* stats() -> {writable, connected, signed, local:{bytes,keys,headroom},
     series:{id:{label,rows,live}}, quota:{usage,quota}|null}. The failure
     signal is the app's own: _saveNow sets these when a write threw. */
  function vaultRead() {
    var V = window.DLVAULT;
    if (!V || !V.stats) return Promise.resolve({ ok: false });
    return Promise.resolve(V.stats()).then(function (st) {
      return { ok: true, st: st, failed: !!(window._quotaWarned || window._saveFailWarned) };
    }, function () { return { ok: false }; });
  }

  function snapRead() {
    try {
      if (!window.DLBX || !DLBX.snapLoad) return Promise.resolve(null);
      return Promise.resolve(DLBX.snapLoad()).then(function (p) { return p || null; }, function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  function quorumRead() {
    var o = { n: 0, dev: null, tol: null, state: "—" };
    try { o.tol = window.DLSNAP ? DLSNAP.TOLERANCE : null; } catch (e) {}
    try {
      var w = window.DLSNAP && DLSNAP.priceWitness ? DLSNAP.priceWitness("BTC") : null;
      if (w) {
        o.n = (w.witnesses || []).length;
        o.dev = w.dev;
        o.state = w.quorum || "—";
      }
    } catch (e) {}
    return o;
  }

  /* Build identity. The payload's stamp is whatever the shipped document
     says it is — read it, never restate it. */
  function metaOf(name) {
    try {
      var m = document.querySelector('meta[name="' + name + '"]');
      var c = m && m.content;
      return c ? String(c) : null;
    } catch (e) { return null; }
  }

  /* The worker's own version query. dist/sw.js answers {dl:'sw-version'} on
     the port it is handed, with {v, build, rev, payload, ttl, max}; that is a
     handler that already ships, not one invented here. A worker that does not
     answer simply leaves the reply null and the row says so. */
  function swAsk(ctrl) {
    return new Promise(function (res) {
      var done = false, ch = null;
      function fin(m) { if (!done) { done = true; res(m || null); } }
      try { ch = new MessageChannel(); } catch (e) { return fin(null); }
      try {
        ch.port1.onmessage = function (e) { fin(e && e.data); };
        ctrl.postMessage({ dl: "sw-version" }, [ch.port2]);
      } catch (e) { return fin(null); }
      setTimeout(function () { fin(null); }, 1500);
    });
  }

  function swRead() {
    var o = { supported: false, controller: false, script: null, answered: false,
              build: null, rev: null, payload: null, cache: null, update: null };
    try { if (!navigator || !("serviceWorker" in navigator)) return Promise.resolve(o); }
    catch (e) { return Promise.resolve(o); }
    o.supported = true;

    var ctrl = null;
    try { ctrl = navigator.serviceWorker.controller || null; } catch (e) {}
    o.controller = !!ctrl;
    try { if (ctrl && ctrl.scriptURL) o.script = String(ctrl.scriptURL).split("?")[0].split("/").pop() || null; } catch (e) {}

    var pReg = Promise.resolve(null);
    try {
      if (navigator.serviceWorker.getRegistration) {
        pReg = Promise.resolve(navigator.serviceWorker.getRegistration())
          .then(function (r) { return r || null; }, function () { return null; });
      }
    } catch (e) {}
    var pVer = ctrl ? swAsk(ctrl) : Promise.resolve(null);

    return Promise.all([pReg, pVer]).then(function (a) {
      var reg = a[0], m = a[1];
      try {
        if (reg) o.update = reg.waiting ? "waiting" : (reg.installing ? "installing" : "none");
      } catch (e) {}
      try {
        if (!o.script && reg && reg.active && reg.active.scriptURL) {
          o.script = String(reg.active.scriptURL).split("?")[0].split("/").pop() || null;
        }
      } catch (e) {}
      if (m && typeof m === "object") {
        o.answered = true;
        try { o.build = m.build || null; } catch (e) {}
        try { o.rev = (m.rev == null ? null : m.rev); } catch (e) {}
        try { o.payload = m.payload || null; } catch (e) {}
        try { o.cache = m.v || null; } catch (e) {}
      }
      return o;
    }, function () { return o; });
  }

  function buildRead() {
    var base = { payload: metaOf("cb:build"), dated: metaOf("cb:updated"), sw: null };
    return swRead().then(function (sw) { base.sw = sw; return base; },
                         function () { return base; });
  }

  /* ------------------------------------------------ render */

  function skeleton() {
    return (
      '<div class="dl154"><div class="h">Which build is this?<span class="sp"></span>' +
      '<span id="dlhBuildV">\u2014</span></div>' +
      '<div class="n">The build stamp below is read from this document\u2019s own &lt;meta name="cb:build"&gt;, not written into this panel, so it cannot drift from what shipped. The worker\u2019s build is read the same way \u2014 by asking the worker, on the version channel it already answers. Anything not actually read reads \u2014.</div>' +
      '<div id="dlhBuild"></div></div>' +
      '<div class="dl154"><div class="h">Can this desk still write?<span class="sp"></span>' +
      '<span id="dlhVerdict">checking…</span></div>' +
      '<div class="n">The half of desk health that loses data when it is wrong. A full origin is not a fault: a save replaces its key and needs only the delta, so the verdict below fires on one signal — a write that actually threw.</div>' +
      '<div id="dlhVault"></div></div>' +
      '<div class="dl154"><div class="h">Market cache</div>' +
      '<div class="n">The 500-coin screener snapshot. It is a cache: losing it costs one round trip. Since v164 it lives in the vault database, not in the localStorage budget the desk needs, and it is no longer swept into exports.</div>' +
      '<div id="dlhMxc"></div></div>' +
      '<div class="dl154"><div class="h">Last known good</div>' +
      '<div class="n">The snapshot that carries a cold visit when every rung is down — 60 coins with real sparklines, kept 7 days in IndexedDB.</div>' +
      '<div id="dlhSnap"></div></div>' +
      '<div class="dl154"><div class="h">Price quorum<span class="sp"></span>' +
      '<span id="dlhQState">—</span></div>' +
      '<div class="n">One source can lie, lag, or die, so the number on screen is a median across independent witnesses. <a href="#" id="dlhQOpen">Open the consensus panel</a> for the per-witness reads.</div>' +
      '<div id="dlhQuorum"></div></div>'
    );
  }

  function kv(k, v) { return '<div class="kv"><span>' + esc(k) + "</span><b>" + v + "</b></div>"; }

  function fill() {
    /* --- build identity --- */
    buildRead().then(function (b) {
      var w = b.sw || {}, r = "";
      set("dlhBuildV", b.payload ? good(b.payload) : "\u2014");
      r += kv("Payload build", b.payload ? esc(b.payload) : "\u2014");
      if (b.dated) r += kv("Payload dated", esc(b.dated));
      r += kv("Service worker", !w.supported
        ? "\u2014 not supported here"
        : (w.controller ? good("controlling this page") : "not controlling this page"));
      r += kv("Worker script", w.script ? esc(w.script) : "\u2014");
      if (w.answered) {
        r += kv("Worker build", esc(String(w.build || "\u2014")) + (w.rev == null ? "" : " \u00b7 rev " + esc(String(w.rev))));
        r += kv("Worker agrees with payload", (b.payload && w.build)
          ? (w.build === b.payload ? good("yes") : bad("no \u2014 the worker is " + w.build))
          : "\u2014");
        /* The worker's mint lock: the sha256 of the payload it was BUILT for.
           That is the worker's claim, not a hash of this document. */
        r += kv("Worker minted for payload", w.payload ? esc(String(w.payload).slice(0, 12)) : "\u2014");
      } else if (w.controller) {
        r += kv("Worker build", "\u2014 the version query went unanswered");
      } else {
        r += kv("Worker build", "\u2014");
      }
      r += kv("Update waiting",
        w.update === "waiting" ? bad("yes \u2014 a newer build is ready to install")
        : (w.update === "installing" ? "a newer build is installing"
        : (w.update === "none" ? good("no") : "\u2014")));
      set("dlhBuild", r);
    }, function () {
      set("dlhBuild", '<div class="n">The build identity could not be read on this page.</div>');
    });

    /* --- vault / storage --- */
    vaultRead().then(function (v) {
      if (!v.ok) {
        set("dlhVerdict", bad("vault unreadable here"));
        set("dlhVault", '<div class="n">DLVAULT is absent or its stats call was refused — private mode and blocked storage both land here, and the app runs exactly as it did before the archive existed.</div>');
        return;
      }
      var st = v.st || {}, L = st.local || {}, Q = st.quota || null;
      set("dlhVerdict", v.failed ? bad("no — a write has thrown") : (st.writable ? good("yes — the probe wrote") : bad("archive not writable")));
      var rows = "";
      rows += kv("Archive writable", st.writable ? good("yes") : bad("no"));
      rows += kv("Signing available", st.signed ? good("yes") : "no — exports are checksummed, unsigned");
      var ser = st.series || {}, parts = [];
      for (var k in ser) {
        if (!Object.prototype.hasOwnProperty.call(ser, k)) continue;
        parts.push(esc(ser[k].label || k) + " " + (ser[k].rows || 0) + " (" + (ser[k].live || 0) + " live)");
      }
      if (parts.length) rows += kv("Archived", parts.join(" · "));
      rows += kv("Desk keys", (L.keys || 0) + " keys · " + bytes(L.bytes));
      rows += kv("Incremental write", L.headroom === false ? bad("refused at 4 KB") : (L.headroom === true ? good("accepted at 4 KB") : "—"));
      if (Q) rows += kv("Origin estimate", bytes(Q.usage) + (Q.quota ? " of " + bytes(Q.quota) : ""));
      rows += kv("A save has thrown", v.failed ? bad("yes — prune path armed") : good("no"));
      set("dlhVault", rows);
    }, function () { set("dlhVerdict", bad("unreadable")); });

    /* --- market cache --- */
    try {
      var M = window.DLMXC ? DLMXC.stats() : null;
      if (!M) {
        set("dlhMxc", '<div class="n">DLMXC is not on this page — the screener is still using the localStorage key.</div>');
      } else {
        var r = "";
        r += kv("Coins held", M.coins || 0);
        r += kv("Written", M.at ? ago(M.at) : "—");
        r += kv("Size", bytes(M.bytes));
        r += kv("Lives in", M.from === "vault" ? good("vault (IndexedDB)") : (M.from === "localStorage" ? bad("localStorage — migrating") : "—"));
        r += kv("Legacy key still present", M.legacyPresent ? bad("yes") : good("no"));
        set("dlhMxc", r);
      }
    } catch (e) {}

    /* --- last known good --- */
    snapRead().then(function (p) {
      if (!p || !p.t) { set("dlhSnap", '<div class="n">Nothing stored yet — it is written once a live load succeeds.</div>'); return; }
      var age = Date.now() - p.t, left = SNAP_TTL - age;
      var r = "";
      r += kv("Coins", (p.list || []).length);
      r += kv("Captured", ago(p.t));
      r += kv("Expires", left > 0 ? good(Math.round(left / 864e5) + "d left") : bad("expired — will be ignored"));
      set("dlhSnap", r);
    });

    /* --- quorum --- */
    try {
      var q = quorumRead();
      var st = q.state === "agree" ? good("agree") : (q.state === "disagree" ? bad("disagree") : esc(q.state));
      set("dlhQState", st);
      var r2 = "";
      r2 += kv("Witnesses", q.n || 0);
      r2 += kv("Spread", q.dev == null ? "—" : (+q.dev).toFixed(2) + "%");
      r2 += kv("Tolerance", q.tol == null ? "—" : "±" + q.tol + "%");
      set("dlhQuorum", r2);
      var a = $("dlhQOpen");
      if (a) a.onclick = function (e) {
        e.preventDefault();
        try { if (typeof window.openQuorum === "function") openQuorum(); } catch (er) {}
        return false;
      };
    } catch (e) {}
  }

  function blocks() {
    setTimeout(function () { try { fill(); } catch (e) {} }, 0);
    return skeleton();
  }

  /* A console-readable form of the same truth, for anyone verifying the
     claims the site makes rather than reading a panel. */
  function report() {
    return vaultRead().then(function (v) {
      return snapRead().then(function (s) {
        return buildRead().then(function (b) {
          var st = (v && v.ok && v.st) ? v.st : null;
          return {
            /* One truth, stated twice: this is the panel's build block. */
            build: b,
            /* vaultRead() resolves {ok, st, failed}; st IS DLVAULT.stats(). */
            writable: st ? !!st.writable : null,
            vault: st,
            saveFailed: (v && v.ok) ? !!v.failed : null,
            marketCache: (function () { try { return window.DLMXC ? DLMXC.stats() : null; } catch (e) { return null; } })(),
            lastKnownGood: s ? { coins: (s.list || []).length, at: s.t, ageMs: Date.now() - s.t, ttlMs: SNAP_TTL } : null,
            quorum: quorumRead(),
            feed: (function () { try { return DLBX.status(); } catch (e) { return null; } })()
          };
        });
      });
    });
  }

  try {
    if (C && C.cmd) C.cmd("desk health", "Storage, market cache, last-known-good and quorum", "🩺", function () {
      try { if (window.DLTRUST154 && DLTRUST154.open) DLTRUST154.open("feeds"); } catch (e) {}
    });
  } catch (e) {}

  return { __v: 164, blocks: blocks, report: report, RUNG_LABEL: RUNG_LABEL };
})();
