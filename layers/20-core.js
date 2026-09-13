/* ============================================================
   DLCORE · v154 — shared substrate for the v154 layers
   · persisted extension bucket S.v154 (+ S.dlsim / S.jnotes, which
     v151–v153 never wrote into the coinbridge.v1 blob)
   · keyless fetch with per-host health (probe → cooldown → stale)
   · sheet primitive (same chrome as the on-chain hub)
   · page mounts, command-palette registry, idempotent XP, math
   Layer contract: wraps window functions, never rebinds top-level
   lets/consts, idempotent, no persistent timers beyond one observer.
   ============================================================ */
window.DLCORE = (function () {
  "use strict";
  if (window.DLCORE && window.DLCORE.__v) return window.DLCORE;
  var doc = document;
  function $(id) { return doc.getElementById(id); }
  function esc(x) { return String(x == null ? "" : x).replace(/[&<>"']/g, function (m) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]; }); }
  function now() { return Date.now(); }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  /* ---------------------------------------------------------- state bucket + persistence */
  function X() {
    try { if (typeof S === "undefined") return null; S.v154 || (S.v154 = { xp: {} }); S.v154.xp || (S.v154.xp = {}); return S.v154; } catch (e) { return null; }
  }
  function save() { try { typeof saveP === "function" && saveP(); } catch (e) {} }
  (function persistExt() {
    try {
      if (typeof window._savePayload === "function" && !window._savePayload.__v154) {
        var _sp = window._savePayload;
        var w = function () {
          var p = _sp.apply(this, arguments);
          try {
            p.x = { v: 154, dlsim: S.dlsim || null, jnotes: S.jnotes || null, v154: S.v154 || null };
            /* keep the blob lean: cap the arrays we own */
            if (p.x.v154) {
              var b = p.x.v154;
              ["fc", "odds", "pools", "yield", "sent", "coach", "era", "supply"].forEach(function (k) { if (Array.isArray(b[k]) && b[k].length > 120) b[k] = b[k].slice(0, 120); });
              if (b.dexai && Array.isArray(b.dexai.mem) && b.dexai.mem.length > 60) b.dexai.mem = b.dexai.mem.slice(-60);
            }
          } catch (e) {}
          return p;
        };
        w.__v154 = 1; window._savePayload = w;
      }
      if (typeof loadP === "function" && typeof S !== "undefined") {
        var P = loadP(); var x = P && P.x;
        if (x && typeof x === "object") {
          if (x.dlsim && !S.dlsim) S.dlsim = x.dlsim;
          if (x.jnotes && !S.jnotes) S.jnotes = x.jnotes;
          if (x.v154 && !S.v154) S.v154 = x.v154;
        }
      }
    } catch (e) {}
  })();

  /* ---------------------------------------------------------- health + fetch */
  var H = {};
  function hostOf(u) { try { return new URL(u).host; } catch (e) { return u.slice(0, 40); } }
  function hstate(h) { return H[h] || (H[h] = { fails: 0, cool: 0, ok: 0, lat: 0, n: 0 }); }
  function tmo(ms) { try { if (window.AbortSignal && AbortSignal.timeout) return AbortSignal.timeout(ms); } catch (e) {} return undefined; }
  var MEM = {};
  /* jget(url, {ms, ttl, key, init, text}) → Promise<{data, at, src, stale}> */
  function jget(u, o) {
    o = o || {};
    var key = o.key || u, ttl = o.ttl || 0, host = hostOf(u), hs = hstate(host);
    var m = MEM[key] || (ttl ? lsGet("dl.c154." + key) : null);
    if (m && ttl && now() - m.at < ttl && !o.force) { MEM[key] = m; return Promise.resolve({ data: m.d, at: m.at, src: host, stale: false, cached: true }); }
    if (hs.cool > now() && !o.force) {
      if (m) return Promise.resolve({ data: m.d, at: m.at, src: host, stale: true, cached: true });
      return Promise.reject(new Error("cooling " + host));
    }
    var t0 = now();
    var init = Object.assign({ headers: { accept: o.text ? "*/*" : "application/json" }, signal: tmo(o.ms || 8000) }, o.init || {});
    return fetch(u, init).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return o.text ? r.text() : r.json();
    }).then(function (d) {
      hs.fails = 0; hs.cool = 0; hs.ok = now(); hs.lat = now() - t0; hs.n++;
      var rec = { d: d, at: now() }; MEM[key] = rec; if (ttl) lsSet("dl.c154." + key, rec);
      return { data: d, at: rec.at, src: host, stale: false, cached: false };
    }).catch(function (e) {
      hs.fails++; hs.cool = now() + 9e4 * Math.min(3, hs.fails); hs.err = String(e && e.message || e);
      if (m) return { data: m.d, at: m.at, src: host, stale: true, cached: true, err: hs.err };
      throw e;
    });
  }
  function health() { var o = {}; for (var k in H) o[k] = Object.assign({}, H[k]); return o; }

  /* ---------------------------------------------------------- formatting */
  function money(v, d) { v = +v || 0; if (d == null) d = v >= 1000 ? 0 : v >= 1 ? 2 : v >= 0.01 ? 4 : 6; return "$" + v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function big(v) { v = +v || 0; var a = Math.abs(v), s = v < 0 ? "-" : ""; return s + (a >= 1e12 ? (a / 1e12).toFixed(2) + "T" : a >= 1e9 ? (a / 1e9).toFixed(2) + "B" : a >= 1e6 ? (a / 1e6).toFixed(1) + "M" : a >= 1e3 ? (a / 1e3).toFixed(1) + "K" : a.toFixed(0)); }
  function pctS(v, d) { v = +v || 0; return (v >= 0 ? "+" : "") + v.toFixed(d == null ? 2 : d) + "%"; }
  function chg(v, d) { v = +v || 0; return '<span class="' + (v >= 0 ? "up" : "dn") + '">' + pctS(v, d) + "</span>"; }
  function span(s) { s = Math.max(0, s); return s < 60 ? Math.round(s) + "s ago" : s < 3600 ? Math.round(s / 60) + "m ago" : s < 86400 ? Math.round(s / 3600) + "h ago" : Math.round(s / 86400) + "d ago"; }
  function ago(t) { if (!t) return "—"; return span((now() - t) / 1e3); }
  function until(t) { var s = Math.max(0, (t - now()) / 1e3); return s < 3600 ? Math.round(s / 60) + " min" : s < 86400 ? (s / 3600).toFixed(1) + " h" : Math.round(s / 86400) + " d"; }
  /* ------------------------------------------------- provenance chips (v155-E)
     A chip's AGE IS NO LONGER BAKED IN AT PAINT TIME. Two surfaces reading ONE
     snapshot used to paint a minute apart and print two different ages for the
     same figure — one instant showed "0s ago · live" on #dlGstat beside "1m ago ·
     recent" on the hero. That is stale labelled live, which the feed-honesty law
     forbids.

     A chip now carries its own timestamp in data-at, and its age text and its
     live/recent/stale class are derived from ONE shared clock reading (PROV.now)
     that only provRefresh() advances. Every chip in the document is therefore a
     pure function of (data-at, PROV.now): paint order cannot make two chips
     showing one timestamp disagree, ever.

     provRefresh() adds NO timer, loop or observer. It is called from paths that
     already run: DLSNAP.repaint() (the 60s cycle), DLSNAP.barState() (the
     payload's existing 1s command-bar tick, every 5th tick) and runMounts()
     (nav + the DOM-churn kick). Cost is one querySelectorAll over ~10 nodes. */
  var PROV = { now: 0 };
  function provNow() { return PROV.now || (PROV.now = now()); }
  /* the ONE definition of the live/recent/stale thresholds in the build */
  function provClass(at, stale) { var age = at ? provNow() - at : 1e12; return stale ? "stale" : age < 6e4 ? "live" : age < 9e5 ? "recent" : "stale"; }
  function provAge(at) { return at ? span((provNow() - at) / 1e3) : "no data"; }
  function provCls(at, stale, contested) { return "dl-prov " + provClass(at, stale) + (contested ? " contested" : ""); }
  /* o.contested: the witnesses behind this figure do not agree. The chip keeps its
     freshness word (they are orthogonal facts) and additionally says so, so it can
     never read as clean agreement. o.title carries the witness values.
     v158: the words "· sources differ" stay in the DOM and in the accessible name
     (.dl-dis-w is a screen-reader-only span); on screen the chip shows its amber dot
     and a ± glyph (layers/v154.css) — the owner asked for results, not a red row. */
  function prov(src, at, stale, o) {
    o = o || {};
    at = +at || 0;
    return '<span class="' + provCls(at, stale, o.contested) + (o.cls ? " " + o.cls : "") + '" data-at="' + at + '"' +
      (o.attr ? " " + o.attr : "") +
      (stale ? ' data-stale="1"' : "") + (o.contested ? ' data-contested="1"' : "") +
      ' title="' + esc(o.title || "source · freshness") + '">' + esc(src) + " · " +
      '<span class="dl-age">' + provAge(at) + "</span>" +
      (stale ? " · stale" : "") + (o.contested ? '<span class="dl-dis-w"> · sources differ</span>' : "") + "</span>";
  }
  function provRefresh() {
    PROV.now = now();
    var ns = doc.querySelectorAll(".dl-prov[data-at]"), i, n, at, a;
    for (i = 0; i < ns.length; i++) {
      n = ns[i]; at = +n.getAttribute("data-at") || 0; a = n.querySelector(".dl-age");
      if (a) a.textContent = provAge(at);
      /* toggle ONLY the state classes — a chip may carry layout classes of its own
         (the tape's .ti), and blowing the whole class list away would strip them */
      n.classList.remove("live", "recent", "stale", "contested");
      n.classList.add("dl-prov");
      n.classList.add(provClass(at, n.hasAttribute("data-stale")));
      if (n.hasAttribute("data-contested")) n.classList.add("contested");
    }
    return ns.length;
  }
  function simTag() { return '<span class="dl-sim" title="paper money — simulated">simulated</span>'; }

  /* ---------------------------------------------------------- coins */
  function coinsAll() { try { if (window.MXP && MXP.state && MXP.state.coins && MXP.state.coins.length) return MXP.state.coins; } catch (e) {} try { return typeof coins !== "undefined" ? coins : []; } catch (e) { return []; } }
  function coin(sym) { sym = String(sym || "").toUpperCase(); try { if (typeof bySym !== "undefined" && bySym[sym]) return bySym[sym]; } catch (e) {} var all = coinsAll(); for (var i = 0; i < all.length; i++) if (all[i].sym === sym) return all[i]; return null; }
  function cgId(sym) { var c = coin(sym); return c && c.id || null; }

  /* ---------------------------------------------------------- math
     One implementation of each formula: web/app/src/lib (typed, unit-tested, parity-pinned),
     bundled as DLAPP. rsi is Wilder's — the same RSI the coin chart draws. (Until 2026-09-10 this
     file carried a plain last-14-changes average, so Rungs/Sentinel/DeXaI disagreed with the chart.) */
  var M = window.DLAPP.legacy.core;
  function sma(a, n) { return M.sma(a, n); }
  function rsi(a, n) { return M.rsi(a, n); }
  function stdev(a) { return M.stdev(a); }
  function logRets(px) { return M.logRets(px); }
  function brier(p, hit) { return M.brier(p, hit); }

  /* ---------------------------------------------------------- sheet primitive */
  function sheet(id, o) {
    var el = $(id);
    if (!el) {
      el = doc.createElement("div"); el.id = id; el.className = "dls"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", o.title || id);
      el.innerHTML = '<div class="dls-head"><b class="dls-t"></b><span class="dls-sub"></span><button class="dls-x" aria-label="Close">✕</button></div><div class="dls-tabs"></div><div class="dls-body"></div>';
      doc.body.appendChild(el);
      el.querySelector(".dls-x").onclick = function () { closeSheet(id); };
      el.addEventListener("click", function (e) { var b = e.target.closest(".dls-tabs button[data-t]"); if (b) { el.dataset.tab = b.getAttribute("data-t"); paintTabs(el); o.onTab && o.onTab(el.dataset.tab, el.querySelector(".dls-body"), el); } });
      doc.addEventListener("keydown", function (e) { if (e.key === "Escape" && el.classList.contains("on")) closeSheet(id); });
      el.__o = o;
    }
    el.__o = o;
    el.querySelector(".dls-t").innerHTML = o.title || "";
    el.querySelector(".dls-sub").innerHTML = o.sub || "";
    var tabs = el.querySelector(".dls-tabs");
    tabs.innerHTML = (o.tabs || []).map(function (t) { return '<button data-t="' + esc(t[0]) + '">' + esc(t[1]) + "</button>"; }).join("");
    tabs.style.display = o.tabs && o.tabs.length ? "" : "none";
    if (!el.dataset.tab || !(o.tabs || []).some(function (t) { return t[0] === el.dataset.tab; })) el.dataset.tab = o.tabs && o.tabs.length ? o.tabs[0][0] : "";
    paintTabs(el);
    return el;
  }
  function paintTabs(el) { el.querySelectorAll(".dls-tabs button").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-t") === el.dataset.tab); }); }
  function openSheet(id, o, tab) {
    var el = sheet(id, o);
    if (tab) el.dataset.tab = tab;
    paintTabs(el);
    el.classList.add("on");
    try { doc.body.classList.add("dls-open"); } catch (e) {}
    var body = el.querySelector(".dls-body"); body.scrollTop = 0;
    try { o.onTab && o.onTab(el.dataset.tab, body, el); } catch (e) { body.innerHTML = '<div class="dl-empty">' + esc(e.message || e) + "</div>"; }
    try { typeof sfx === "function" && sfx("open"); } catch (e) {}
    return el;
  }
  function closeSheet(id) { var el = $(id); if (el) el.classList.remove("on"); if (!doc.querySelector(".dls.on")) doc.body.classList.remove("dls-open"); }
  function skel(n) { var s = ""; for (var i = 0; i < (n || 5); i++) s += '<div class="dl-skel"></div>'; return s; }

  /* ---------------------------------------------------------- mounts (idempotent, re-run on nav + DOM churn) */
  var MOUNTS = [], mT = null;
  function runMounts() {
    var v = null; try { v = S.view; } catch (e) {}
    MOUNTS.forEach(function (m) { if (!m.page || m.page === v) { try { m.fn(v); } catch (e) { m.err = String(e && e.message || e); } } });
    try { provRefresh(); } catch (e) {}
  }
  function kick(ms) { clearTimeout(mT); mT = setTimeout(runMounts, ms || 450); }
  function onPage(page, fn) { MOUNTS.push({ page: page, fn: fn }); kick(300); }
  (function wrapNav() {
    try {
      var _nv = window.nav;
      if (typeof _nv === "function" && !_nv.__v154) {
        var w = function () { var r = _nv.apply(this, arguments); kick(450); setTimeout(runMounts, 1200); return r; };
        w.__v154 = 1; window.nav = w;
      }
    } catch (e) {}
    try {
      var _oc = window.openCoin;
      if (typeof _oc === "function" && !_oc.__v154) { var w2 = function () { var r = _oc.apply(this, arguments); kick(500); setTimeout(runMounts, 1300); return r; }; w2.__v154 = 1; window.openCoin = w2; }
    } catch (e) {}
  })();
  function armObserver() {
    ["page-markets", "page-coin", "page-portfolio", "page-learn"].forEach(function (id) {
      var pg = $(id); if (!pg || pg.__v154mo) return;
      pg.__v154mo = 1;
      new MutationObserver(function () { kick(500); }).observe(pg, { childList: true, subtree: false });
    });
  }

  /* ---------------------------------------------------------- command palette registry */
  var CMDS = [];
  function cmd(name, desc, ic, fn) { CMDS.push({ name: name, desc: desc, ic: ic, fn: fn }); }
  (function wrapCmdk() {
    try {
      var _cb = window.cmdkBuild;
      if (typeof _cb === "function" && !_cb.__v154) {
        var w = function (q) {
          var it = _cb.apply(this, arguments) || [];
          var qq = String(q || "").toLowerCase().trim();
          CMDS.forEach(function (c) { if (!qq || (c.name + " " + c.desc).toLowerCase().indexOf(qq) > -1) it.push({ grp: "Commands", ic: c.ic, label: c.name, sub: c.desc, run: c.fn }); });
          return it.slice(0, 60);
        };
        w.__v154 = 1; window.cmdkBuild = w;
      }
    } catch (e) {}
  })();

  /* ---------------------------------------------------------- XP, toasts */
  function xp(flag, n, why) {
    var x = X(); if (!x) return false;
    if (x.xp[flag]) return false;
    x.xp[flag] = now();
    try { typeof addXP === "function" ? addXP(n, why) : null; } catch (e) {}
    save(); return true;
  }
  function toastS(kind, t, m) { try { typeof toast === "function" && toast(kind, t, m); } catch (e) {} }
  function sfxS(k) { try { typeof sfx === "function" && sfx(k); } catch (e) {} }

  /* ---------------------------------------------------------- tick hook (one engine tick — piggyback on evalOrders) */
  var TICKS = [], tickN = 0;
  function onTick(fn) { TICKS.push(fn); }
  (function wrapTick() {
    try {
      var _eo = window.evalOrders;
      if (typeof _eo === "function" && !_eo.__v154) {
        var w = function () { var r = _eo.apply(this, arguments); tickN++; for (var i = 0; i < TICKS.length; i++) { try { TICKS[i](tickN); } catch (e) {} } return r; };
        w.__v154 = 1; window.evalOrders = w;
      }
    } catch (e) {}
  })();

  function boot() { armObserver(); kick(600); [1800, 3200, 6000, 12000].forEach(function (ms) { setTimeout(runMounts, ms); }); }
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", boot); else boot();

  return { __v: 154, $: $, esc: esc, X: X, save: save, jget: jget, health: health, money: money, big: big, pct: pctS, chg: chg, ago: ago, until: until, prov: prov, provClass: provClass, provAge: provAge, provRefresh: provRefresh, simTag: simTag,
    coinsAll: coinsAll, coin: coin, cgId: cgId, sma: sma, rsi: rsi, stdev: stdev, logRets: logRets, brier: brier,
    sheet: sheet, open: openSheet, close: closeSheet, skel: skel, onPage: onPage, kick: kick, mounts: runMounts, cmd: cmd, xp: xp, toast: toastS, sfx: sfxS, onTick: onTick, lsGet: lsGet, lsSet: lsSet, lsDel: lsDel, now: now };
})();
