/* DLCUR — the display-currency layer.
 *
 * One currency for the whole app. Every money figure in the payload is rendered
 * through DLCUR.c() (convert a USD number) and DLCUR.s() (the symbol), so the
 * choice reaches the terminal, coin pages, screener, portfolio, tickets, desks
 * and charts — not just the markets table, which was the only surface that
 * honoured it before.
 *
 * Rates are live and keyless: CoinGecko /exchange_rates first, open.er-api.com
 * second, cached in localStorage for 6h and reused while stale. A currency with
 * no rate yet renders as USD and repaints the moment the rate lands — this app
 * does not invent a number to fill a gap.
 */
(function () {
  "use strict";
  if (window.DLCUR) return;

  var LS_CUR = "dl.cur.v1", LS_RATES = "dl.cur.rates.v1", TTL = 216e5; /* 6h */

  /* code, symbol, name, locale (null = en-US grouping), minor units */
  var LIST = [
    ["USD", "$",    "US Dollar",          null,    2],
    ["EUR", "€", "Euro",             null,    2],
    ["INR", "₹", "Indian Rupee",     "en-IN", 2],
    ["GBP", "£", "Pound Sterling",   null,    2],
    ["JPY", "¥", "Japanese Yen",     null,    0],
    ["AED", "AED ",   "UAE Dirham",       null,    2],
    ["SGD", "S$",     "Singapore Dollar", null,    2],
    ["AUD", "A$",     "Australian Dollar",null,    2],
    ["CAD", "C$",     "Canadian Dollar",  null,    2],
    ["CHF", "CHF ",   "Swiss Franc",      null,    2],
    ["CNY", "CN¥", "Chinese Yuan",   null,    2],
    ["KRW", "₩", "Korean Won",       null,    0],
    ["BRL", "R$",     "Brazilian Real",   null,    2],
    ["NGN", "₦", "Nigerian Naira",   null,    2],
    ["ZAR", "R",      "South African Rand", null,  2],
    ["RUB", "₽", "Russian Ruble",    null,    2],
    ["TRY", "₺", "Turkish Lira",     null,    2],
    ["IDR", "Rp",     "Indonesian Rupiah",null,    0],
    ["PHP", "₱", "Philippine Peso",  null,    2],
    ["MXN", "MX$",    "Mexican Peso",     null,    2],
    ["VND", "₫", "Vietnamese Dong",  null,    0],
    ["BTC", "₿", "Bitcoin",          null,    8],
    ["ETH", "Ξ", "Ether",            null,    6]
  ];

  var BY = {}, ORDER = [];
  for (var i = 0; i < LIST.length; i++) {
    BY[LIST[i][0]] = { code: LIST[i][0], sym: LIST[i][1], name: LIST[i][2], loc: LIST[i][3], mu: LIST[i][4] };
    ORDER.push(LIST[i][0]);
  }
  var CRYPTO = { BTC: 1, ETH: 1 };

  /* The markets module keeps its state behind MXP; window.MX is another
     module's object entirely, so the state is always resolved, never assumed. */
  function mkt() {
    try { if (window.MXP && MXP.state && MXP.state.coins) return MXP.state; } catch (e) { }
    try { if (window.MX && window.MX.coins) return window.MX; } catch (e) { }
    return null;
  }

  /* units of <code> per 1 USD. USD is the pivot and is always 1. */
  var R = { USD: 1, USDT: 1 };
  var ratesAt = 0, fetching = false;

  function readLS(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function writeLS(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }

  (function seed() {
    try {
      var raw = readLS(LS_RATES); if (!raw) return;
      var j = JSON.parse(raw);
      if (j && j.r && typeof j.r === "object") {
        for (var k in j.r) if (+j.r[k] > 0) R[k] = +j.r[k];
        R.USD = 1; R.USDT = 1;
        ratesAt = +j.t || 0;
      }
    } catch (e) { }
  })();

  function guess() {
    try {
      var l = (navigator.languages && navigator.languages[0]) || navigator.language || "";
      var reg = (l.split("-")[1] || "").toUpperCase();
      var M = { IN: "INR", GB: "GBP", JP: "JPY", AE: "AED", SG: "SGD", AU: "AUD", CA: "CAD",
                CH: "CHF", CN: "CNY", KR: "KRW", BR: "BRL", NG: "NGN", ZA: "ZAR", RU: "RUB",
                TR: "TRY", ID: "IDR", PH: "PHP", MX: "MXN", VN: "VND",
                DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", IE: "EUR", PT: "EUR",
                AT: "EUR", BE: "EUR", FI: "EUR", GR: "EUR" };
      return M[reg] || "USD";
    } catch (e) { return "USD"; }
  }

  var cur = (function () {
    var v = readLS(LS_CUR);
    if (v && BY[v]) return v;
    var g = guess();
    return BY[g] ? g : "USD";
  })();

  /* A quote with no rate yet must not print an invented number. */
  function rate(q) {
    q = q || cur;
    if (q === "USD" || q === "USDT") return 1;
    if (CRYPTO[q]) {
      try {
        if (typeof S !== "undefined" && S && S.fx && +S.fx[q] > 0) return +S.fx[q];
        if (typeof bySym !== "undefined" && bySym && bySym[q] && +bySym[q].price > 0) return 1 / +bySym[q].price;
      } catch (e) { }
      try {
        var m = mkt();
        if (m && m.coins && m.coins.length) {
          for (var i = 0; i < m.coins.length; i++)
            if (m.coins[i].sym === q && +m.coins[i].price > 0) return 1 / +m.coins[i].price;
        }
      } catch (e) { }
      return 0;
    }
    return +R[q] > 0 ? +R[q] : 0;
  }

  function live() { return rate(cur) > 0; }          /* is the active quote usable */
  function act()  { return live() ? cur : "USD"; }   /* what we actually render in */

  function c(v) {
    var n = +v;
    if (!isFinite(n)) return v;
    var r = rate(cur);
    return r > 0 ? n * r : n;
  }
  function s()    { return BY[act()].sym; }
  function code() { return act(); }
  function loc()  { return BY[act()].loc || "en-US"; }

  /* a site's own decimal choice, adjusted for the quote's minor units */
  function dp(n) {
    n = n == null ? 2 : n;
    var m = BY[act()].mu;
    if (m === 0) return n <= 2 ? 0 : n;
    if (m > 2)   return n <= 2 ? m : n;   /* BTC/ETH */
    return n;
  }

  var subs = [];
  function on(fn) { if (typeof fn === "function") subs.push(fn); }
  function emit() {
    for (var i = 0; i < subs.length; i++) { try { subs[i](act()); } catch (e) { } }
    try { window.dispatchEvent(new CustomEvent("dl:cur", { detail: act() })); } catch (e) { }
    repaint();
  }

  /* the two state objects the payload renders money from. They are top-level
     lexical bindings, never window properties, so they are addressed by name. */
  function sync() {
    try { if (typeof S !== "undefined" && S) S.dispQ = act(); } catch (e) { }
    try { var m = mkt(); if (m) m.cur = act(); } catch (e) { }
  }

  /* every surface that holds money on screen, repainted in place */
  function repaint() {
    sync();
    var hooks = ["renderAll", "route", "updateSpotlight", "updatePortfolioLive",
                 "renderTrade", "renderJournal", "renderKPIs", "renderMovers"];
    for (var i = 0; i < hooks.length; i++) {
      try { if (typeof window[hooks[i]] === "function") window[hooks[i]](); } catch (e) { }
    }
    try { if (window.MXP && typeof MXP.render === "function") MXP.render(); } catch (e) { }
  }

  function set(q) {
    if (!BY[q]) return false;
    cur = q; writeLS(LS_CUR, q);
    try { var m = mkt(); if (m) m.cur = q; } catch (e) { }
    try { if (typeof S !== "undefined" && S) S.dispQ = q; } catch (e) { }
    if (!CRYPTO[q] && !(+R[q] > 0)) { refresh(true); }
    emit();
    return true;
  }

  function tfetch(url, ms) {
    var opt = { headers: { accept: "application/json" } };
    try { if (window.AbortSignal && AbortSignal.timeout) opt.signal = AbortSignal.timeout(ms || 9000); } catch (e) { }
    return fetch(url, opt);
  }

  function absorb(map, div) {
    var got = 0;
    for (var k in map) {
      var code2 = k.toUpperCase();
      if (!BY[code2] || CRYPTO[code2]) continue;
      var v = +map[k] / (div || 1);
      if (isFinite(v) && v > 0) { R[code2] = v; got++; }
    }
    R.USD = 1; R.USDT = 1;
    return got;
  }

  function save() {
    var out = {};
    for (var k in R) if (k !== "USDT") out[k] = R[k];
    ratesAt = Date.now();
    writeLS(LS_RATES, JSON.stringify({ t: ratesAt, r: out }));
  }

  function refresh(force) {
    if (fetching) return Promise.resolve(false);
    if (!force && ratesAt && Date.now() - ratesAt < TTL) return Promise.resolve(false);
    fetching = true;
    var wasLive = live();
    var CG = (window.CG_BASE || window.CG || "https://api.coingecko.com/api/v3");
    return tfetch(CG + "/exchange_rates", 9000).then(function (r) {
      if (!r.ok) throw 0;
      return r.json();
    }).then(function (j) {
      var rt = j && j.rates, u = rt && rt.usd && +rt.usd.value;
      if (!u) throw 0;
      var m = {}, n = 0;
      for (var k in rt) { if (rt[k] && rt[k].type === "fiat" && +rt[k].value > 0) { m[k] = +rt[k].value; n++; } }
      if (!n || !absorb(m, u)) throw 0;
      save(); return true;
    }).catch(function () {
      return tfetch("https://open.er-api.com/v6/latest/USD", 9000).then(function (r) {
        if (!r.ok) throw 0; return r.json();
      }).then(function (j) {
        if (!j || !j.rates || !absorb(j.rates, 1)) throw 0;
        save(); return true;
      }).catch(function () { return false; });
    }).then(function (ok) {
      fetching = false;
      if (ok) {
        try { if (typeof S !== "undefined" && S && S.fx) { if (R.EUR > 0) S.fx.EUR = R.EUR; if (R.INR > 0) S.fx.INR = R.INR; } } catch (e) { }
        sync();
        // Repaint ONLY when the chosen quote has just become renderable — a
        // rate that merely refreshed must not redraw surfaces, because a repaint
        // drops the decorations later passes add to them (a disagreement mark on
        // a contested figure, for one). The next natural render picks the new
        // rate up on its own.
        if (!wasLive && live()) emit();
      }
      return ok;
    }, function () { fetching = false; return false; });
  }

  function list() {
    var out = [];
    for (var i = 0; i < ORDER.length; i++) {
      var q = BY[ORDER[i]];
      out.push({ code: q.code, sym: q.sym, name: q.name, crypto: !!CRYPTO[q.code], live: rate(q.code) > 0 });
    }
    return out;
  }

  window.DLCUR = {
    c: c, s: s, q: code, cur: code, want: function () { return cur; },
    loc: loc, dp: dp, rate: rate, live: live, set: set, on: on,
    list: list, refresh: refresh, sym: function (q) { return BY[q] ? BY[q].sym : ""; },
    name: function (q) { return BY[q] ? BY[q].name : q; },
    /* one formatted money string, used by the surfaces that had no formatter of their own */
    money: function (usd, d) {
      var n = c(usd);
      if (!isFinite(n)) return "—";
      var k = dp(d == null ? (Math.abs(n) >= 1000 ? 0 : Math.abs(n) >= 1 ? 2 : 4) : d);
      return s() + n.toLocaleString(loc(), { minimumFractionDigits: k, maximumFractionDigits: k });
    }
  };

  /* Rates are fetched only when the choice actually needs them. A USD reader
     needs none, so the default install adds no request to boot at all — and
     nothing of DLCUR's competes with the payload's own feeds while the page is
     still coming up. Picking a currency fetches its rate there and then. */
  function kick() {
    sync();
    setTimeout(sync, 600);
    setTimeout(sync, 2000);
    if (cur !== "USD") setTimeout(function () { refresh(false); }, 1200);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", kick);
  else kick();
  setInterval(function () { if (cur !== "USD") refresh(false); }, TTL);
  window.addEventListener("online", function () { if (cur !== "USD") refresh(true); });
})();
