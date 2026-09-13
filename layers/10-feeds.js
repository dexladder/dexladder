/* ============================================================
   DLFEEDS · v154 — ladder hygiene + compatibility shims
   //@inject-before: window.DLLIFE=function()
   Why: CoinDesk Data (ex-CryptoCompare) ended free API access on
   21 May 2026; Reddit's unauthenticated .json is closed; Binance's
   api.binance.com host is CORS-hostile from browsers.
   What: one fetch wrapper (installed BEFORE DLLIFE captures fetch)
   that (a) rewrites Binance to the market-data host, (b) answers
   CryptoCompare-shaped requests from Coinlore (spot) and Kraken/
   Coinbase (OHLC), (c) answers the Reddit social request with an
   Attention pulse built from Wikipedia page-view velocity; plus a
   Coinlore rung installed at CBDATA._i.srcs[2] and The Block RSS
   replacing the dead CryptoCompare news source. Every source is
   named honestly on screen (labels patched in the build manifest).
   Layer contract: wraps window functions, never rebinds top-level
   lets/consts, idempotent, no persistent timers.
   ============================================================ */
window.DLFEEDS = (function () {
  "use strict";
  if (window.DLFEEDS && window.DLFEEDS.__v) return window.DLFEEDS;
  var _fetch = window.fetch.bind(window);
  var ST = { binanceRewrites: 0, ccShims: 0, redditShims: 0, coinloreRung: 0, kraken: 0, coinbase: 0, wiki: 0, fails: {} };

  function jresp(obj, status) {
    return new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });
  }
  function fail(k) { ST.fails[k] = (ST.fails[k] || 0) + 1; }
  function tmo(ms) {
    try { if (window.AbortSignal && AbortSignal.timeout) return AbortSignal.timeout(ms); } catch (e) {}
    return undefined;
  }
  function jget(u, ms) {
    return _fetch(u, { headers: { accept: "application/json" }, signal: tmo(ms || 8000) }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  /* ---------------------------------------------------------- Coinlore (keyless, 14k coins) */
  var CL = "https://api.coinlore.net/api";
  var _clAt = 0, _cl = null;
  function coinloreTop(limit) {
    if (_cl && Date.now() - _clAt < 60000) return Promise.resolve(_cl);
    return jget(CL + "/tickers/?start=0&limit=" + (limit || 100), 8000).then(function (j) {
      var d = j && j.data;
      if (!Array.isArray(d) || !d.length) throw new Error("empty");
      _cl = d; _clAt = Date.now();
      return d;
    });
  }
  function prevHist(sym, px, n) {
    try { var c = typeof bySym !== "undefined" && bySym[sym]; if (c && c.hist && c.hist.length >= n) return c.hist.slice(); } catch (e) {}
    var a = []; for (var i = 0; i < n; i++) a.push(px); return a;
  }
  /* rung adapter — same coin shape as CBDATA.srcGecko */
  function srcCoinlore() {
    var n = typeof HIST !== "undefined" ? HIST : 336;
    return coinloreTop(100).then(function (d) {
      var out = d.filter(function (x) { return x && +x.price_usd > 0 && +x.rank > 0; })
        .sort(function (a, b) { return +a.rank - +b.rank; }).slice(0, 30)
        .map(function (x, i) {
          var sym = String(x.symbol || "").toUpperCase(), px = +x.price_usd, ch = +x.percent_change_24h || 0;
          var base = null; try { base = typeof bySym !== "undefined" && bySym[sym]; } catch (e) {}
          return {
            id: x.nameid || sym.toLowerCase(), sym: sym, name: x.name || sym,
            logo: base ? base.logo : null, glyph: sym[0] || "?", color: "#98A1BC",
            price: px, open: px / (1 + ch / 100), rank: +x.rank || i + 1,
            c1: +x.percent_change_1h || 0, c24: ch, c7: +x.percent_change_7d || 0,
            mcap: DLF.n(x.market_cap_usd), vol: DLF.n(x.volume24), supply: DLF.n(x.csupply),
            hi24: Math.max(px, px / (1 + ch / 100)), lo24: Math.min(px, px / (1 + ch / 100)),
            ath: base ? base.ath : null, athPct: base ? base.athPct : null,
            maxSupply: DLF.n(x.msupply), spark: prevHist(sym, px, n), hist: prevHist(sym, px, n)
          };
        });
      if (out.length < 5) throw new Error("thin");
      ST.coinloreRung++;
      return out;
    });
  }
  function installRung() {
    try {
      var CI = window.CBDATA && window.CBDATA._i;
      if (CI && Array.isArray(CI.srcs) && CI.srcs.length >= 3 && !CI.srcs[2].__coinlore) {
        srcCoinlore.__coinlore = 1; CI.srcs[2] = srcCoinlore; return true;
      }
    } catch (e) {}
    return false;
  }

  /* ---------------------------------------------------------- CryptoCompare-shaped shims */
  function shimPriceMulti(u) {
    var m = u.match(/fsyms=([^&]+)/), syms = m ? decodeURIComponent(m[1]).split(",") : [];
    return coinloreTop(100).then(function (d) {
      var by = {}; d.forEach(function (x) { var s = String(x.symbol || "").toUpperCase(); if (!by[s] && +x.price_usd > 0) by[s] = +x.price_usd; });
      var out = {}; syms.forEach(function (s) { if (by[s]) out[s] = { USD: by[s] }; });
      ST.ccShims++;
      return jresp(out);
    }).catch(function () { fail("coinlore"); return jresp({ Response: "Error", Message: "witness unreachable" }, 200); });
  }
  var KR = { BTC: "XBT", DOGE: "XDG" };
  function shimHisto(u) {
    var m = u.match(/data\/v2\/(histohour|histoday)\?fsym=([^&]+)&tsym=USD&limit=(\d+)/);
    if (!m) return null;
    var hourly = m[1] === "histohour", sym = decodeURIComponent(m[2]).toUpperCase(), lim = Math.min(2000, +m[3] || 168);
    var kp = (KR[sym] || sym) + "USD";
    return jget("https://api.kraken.com/0/public/OHLC?pair=" + kp + "&interval=" + (hourly ? 60 : 1440), 8000).then(function (j) {
      var res = j && j.result, key = res && Object.keys(res).filter(function (k) { return k !== "last"; })[0];
      var rows = key ? res[key] : null;
      if (!Array.isArray(rows) || rows.length < 21) throw new Error("thin");
      ST.kraken++;
      var d = rows.slice(-lim).map(function (r) { return { time: +r[0], close: +r[4], open: +r[1], high: +r[2], low: +r[3] }; });
      return jresp({ Response: "Success", Data: { Data: d } });
    }).catch(function () {
      var gran = hourly ? 3600 : 86400;
      return jget("https://api.exchange.coinbase.com/products/" + sym + "-USD/candles?granularity=" + gran, 8000).then(function (rows) {
        if (!Array.isArray(rows) || rows.length < 21) throw new Error("thin");
        ST.coinbase++;
        var d = rows.slice().sort(function (a, b) { return a[0] - b[0]; }).slice(-lim).map(function (r) { return { time: +r[0], close: +r[4], open: +r[3], high: +r[2], low: +r[1] }; });
        return jresp({ Response: "Success", Data: { Data: d } });
      });
    }).catch(function () { fail("ohlc"); return jresp({ Response: "Error", Data: { Data: [] } }); });
  }

  /* ---------------------------------------------------------- Attention pulse (Wikipedia page views) */
  var WIKI = { BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana_(blockchain_platform)", XRP: "XRP_Ledger", DOGE: "Dogecoin", ADA: "Cardano_(blockchain_platform)",
    BNB: "BNB_(cryptocurrency)", TRX: "Tron_(blockchain)", AVAX: "Avalanche_(blockchain_platform)", LINK: "Chainlink_(blockchain)", DOT: "Polkadot_(cryptocurrency)",
    LTC: "Litecoin", BCH: "Bitcoin_Cash", SHIB: "Shiba_Inu_(cryptocurrency)", PEPE: "Pepe_(cryptocurrency)", UNI: "Uniswap", MATIC: "Polygon_(blockchain)", POL: "Polygon_(blockchain)",
    XLM: "Stellar_(payment_network)", XMR: "Monero", ETC: "Ethereum_Classic", NEAR: "Near_Protocol", ARB: "Arbitrum", OP: "Optimism_(blockchain)", TON: "The_Open_Network",
    ATOM: "Cosmos_(blockchain)", FIL: "Filecoin", HBAR: "Hedera_(distributed_ledger)", ICP: "Internet_Computer", SUI: "Sui_(blockchain)", APT: "Aptos_(blockchain)",
    USDT: "Tether_(cryptocurrency)", USDC: "USD_Coin", AAVE: "Aave_(protocol)", TAO: "Bittensor", RENDER: "Render_Network", FET: "Fetch.ai", WLD: "Worldcoin", KAS: "Kaspa" };
  var ATT_LS = "dl.attn.v1", ATT_TTL = 6 * 3600e3;
  function ymd(d) { return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, "0") + String(d.getUTCDate()).padStart(2, "0"); }
  function wikiViews(title) {
    var end = new Date(Date.now() - 864e5), start = new Date(Date.now() - 15 * 864e5);
    var u = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/" + encodeURIComponent(title) + "/daily/" + ymd(start) + "/" + ymd(end);
    return jget(u, 8000).then(function (j) {
      var it = (j && j.items) || []; if (it.length < 8) throw new Error("thin");
      var v = it.map(function (x) { return +x.views || 0; }), n = v.length;
      var thisW = v.slice(n - 7).reduce(function (a, b) { return a + b; }, 0), lastW = v.slice(Math.max(0, n - 14), n - 7).reduce(function (a, b) { return a + b; }, 0);
      ST.wiki++;
      return { title: title, week: thisW, prev: lastW, vel: lastW ? (thisW - lastW) / lastW * 100 : 0, url: "https://en.wikipedia.org/wiki/" + title };
    });
  }
  function attention(force) {
    var c = lsGet(ATT_LS);
    if (!force && c && Date.now() - c.t < ATT_TTL && c.list && c.list.length) return Promise.resolve(c.list);
    var syms = [];
    try { syms = (typeof coins !== "undefined" ? coins : []).map(function (x) { return x.sym; }); } catch (e) {}
    if (!syms.length) syms = Object.keys(WIKI);
    var picks = syms.filter(function (s) { return WIKI[s]; }).slice(0, 18);
    if (picks.length < 6) picks = Object.keys(WIKI).slice(0, 12);
    return Promise.all(picks.map(function (s) { return wikiViews(WIKI[s]).then(function (r) { r.sym = s; return r; }).catch(function () { return null; }); })).then(function (all) {
      var list = all.filter(Boolean).sort(function (a, b) { return b.week - a.week; });
      if (!list.length) throw new Error("no attention data");
      lsSet(ATT_LS, { t: Date.now(), list: list });
      return list;
    });
  }
  function fmtK(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(0) + "k" : String(n); }
  function shimReddit(u) {
    var sub = (u.match(/\/r\/([^/]+)\//) || [])[1] || "";
    var slot = { CryptoCurrency: 0, Bitcoin: 1, ethereum: 2 }[sub] || 0;
    return attention(false).then(function (list) {
      var byVel = list.slice().sort(function (a, b) { return b.vel - a.vel; });
      var mine = byVel.filter(function (_, i) { return i % 3 === slot; }).slice(0, 3);
      ST.redditShims++;
      return jresp({ data: { children: mine.map(function (r) {
        var sign = r.vel >= 0 ? "+" : "";
        return { data: { title: (r.sym || "") + " · " + r.title.replace(/_/g, " ").replace(/\s*\(.*\)$/, ""), ups: Math.round(r.week), num_comments: 0,
          permalink: r.url, created_utc: Math.floor(Date.now() / 1000), author: "wikipedia", r: "📖 " + r.sym,
          e: fmtK(r.week) + " page views · 7d · " + sign + r.vel.toFixed(0) + "% vs prior week" } };
      }) } });
    }).catch(function () { fail("wiki"); return jresp({ data: { children: [] } }); });
  }

  /* ---------------------------------------------------------- the wrapper */
  if (!window.fetch.__dlFeeds) {
    var wrapped = function (input, init) {
      var u = typeof input === "string" ? input : (input && input.url) || "";
      try {
        if (/^https:\/\/api\.binance\.com\/api\/v3\//.test(u)) {
          ST.binanceRewrites++;
          var nu = u.replace("https://api.binance.com/api/v3/", "https://data-api.binance.vision/api/v3/");
          return _fetch(typeof input === "string" ? nu : new Request(nu, input), init);
        }
        if (/min-api\.cryptocompare\.com\/data\/pricemulti/.test(u)) return shimPriceMulti(u);
        if (/min-api\.cryptocompare\.com\/data\/v2\/(histohour|histoday)/.test(u)) { var p = shimHisto(u); if (p) return p; }
        if (/min-api\.cryptocompare\.com\/data\/v2\/news/.test(u)) return Promise.resolve(jresp({ Data: [] }));
        if (/min-api\.cryptocompare\.com\//.test(u)) return Promise.resolve(jresp({ Response: "Error", Message: "CoinDesk Data free tier ended 2026-05-21 — shimmed by DexLadder" }, 200));
        if (/^https:\/\/(www\.)?reddit\.com\/r\/[^/]+\/hot\.json/.test(u)) return shimReddit(u);
      } catch (e) {}
      return _fetch(input, init);
    };
    wrapped.__dlFeeds = 1;
    window.fetch = wrapped;
  }

  /* ---------------------------------------------------------- The Block replaces the dead CryptoCompare news source */
  var BLOCK = { name: "The Block", url: "https://www.theblock.co/rss.xml", ic: "TB", color: "#00E5FF", home: "https://www.theblock.co", domain: "theblock.co" };
  function installNews() {
    try {
      if (typeof fetchFeed === "function" && typeof window.fetchCC === "function" && !window.fetchCC.__dlFeeds) {
        var f = function () { return fetchFeed(BLOCK).catch(function () { return []; }); };
        f.__dlFeeds = 1; window.fetchCC = f;
      }
    } catch (e) {}
  }

  function boot() { installRung(); installNews(); }
  boot();
  /* CBDATA may mount later than this layer on slow parses — re-check once */
  setTimeout(boot, 1500);

  return { __v: 154, status: function () { return JSON.parse(JSON.stringify(ST)); }, attention: attention, wikiTitle: function (s) { return WIKI[s] || null; }, coinlore: coinloreTop, _src: srcCoinlore, install: boot };
})();
