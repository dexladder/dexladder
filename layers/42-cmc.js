/* ============================================================================
   DLCMC · v157 — SPOT RAIL: CoinMarketCap's own keyless on-chain feed.
   ---------------------------------------------------------------------------
   Pool Radar reads GeckoTerminal. This layer adds a SECOND, independent witness
   for the same on-chain truth — CoinMarketCap's keyless tier — and then does the
   thing neither CMC nor GeckoTerminal will do for you: it puts the two prices
   for ONE pool side by side and says out loud when they disagree.

   Why a second witness rather than a second screener: a DEX price is an
   observation, not a fact. Two indexers watching one contract can differ by a
   block, by a reserve read, by an aggregation rule. A learner who has only ever
   seen one number believes it. A learner who has seen two numbers for one pool
   has learned what an oracle problem is without being lectured at.

   VERIFIED, 12 Sep 2026 — no account, no key, no funds, no contract:
     v4/dex/spot-pairs/latest        live pool price, liquidity, 24h volume, FDV
     v4/dex/pairs/quotes/latest      one pool by contract address
     v3/cryptocurrency/quotes/latest CMC's own quote for a symbol
     v1/cryptocurrency/listings/latest  CMC's ranked universe
     v1/cryptocurrency/categories    CMC's sector taxonomy
     v1/global-metrics/quotes/latest total cap, dominance, DeFi + stable volume
   403 "An API Key is required" on the same tier, so deliberately absent here:
     networks/list · listings/info · listings/quotes · pairs/ohlcv/* ·
     pairs/trade/latest · tools/price-conversion · blockchain/statistics.
   x402/* answers 402 Payment Required — it is a pay-per-call rail that settles
   on-chain, which is exactly the thing DexLadder will not do. Not used.

   TWO FACTS THAT SHAPE EVERY LINE BELOW
   1 · CMC sends no access-control-allow-origin. A browser cannot read the body.
       The web build therefore goes through the same-origin relay /api/cmc
       (web/gateway/functions/api/cmc.js) and degrades HONESTLY when the relay
       is not deployed — it says the rail is dark, it does not fake a price.
       The native apps have no CORS wall and call CMC direct; DXCMC.swift.
   2 · v4/dex percent_change_price_* are FRACTIONS, not percentages. Verified by
       holding a pool against CMC's own coin quote in the same minute: WETH/USDT
       24h read 0.0281 while CMC's ETH quote read 2.769%. Anything that prints
       these raw is off by a factor of 100 and will read as a dead market. x100
       happens once, in fromSpot(), and the gate pins it.

   Layer contract: self-mounting, idempotent, no persistent timer, no rebinding
   of any top-level binding, and it edits no other layer. The AMM sandbox, the
   security scan and the pool book are DLRADAR's — reused through its exported
   API so a CMC pool practises in the same book as a GeckoTerminal pool.
   ============================================================================ */
window.DLCMC = (function () {
  "use strict";
  if (window.DLCMC && window.DLCMC.__v) return window.DLCMC;
  var C = window.DLCORE, $ = C.$, esc = C.esc;

  var RELAY = "/api/cmc";
  var DIRECT = "https://pro-api.coinmarketcap.com/trial-pro-api";
  var PATHS = {
    spot: "v4/dex/spot-pairs/latest", pair: "v4/dex/pairs/quotes/latest",
    quotes: "v3/cryptocurrency/quotes/latest", listings: "v1/cryptocurrency/listings/latest",
    global: "v1/global-metrics/quotes/latest"
  };
  var TTL = { spot: 6e4, pair: 45e3, quotes: 6e4, listings: 9e4, global: 12e4 };
  var MODEKEY = "dl.cmchost.v1";

  /* Venue registry — every pair below was probed live and returned rows. The
     absences are as load-bearing as the entries: BNB Chain, Avalanche and
     Optimism answer "The network is not supported" on the keyless tier, so the
     rail does not offer them and the note says why rather than showing an empty
     list the user has to interpret. Pool Radar still covers them. */
  var VENUES = [
    { net: "ethereum", name: "Ethereum", rnet: "eth", dex: [["uniswap-v3", "Uniswap v3"], ["uniswap-v4", "Uniswap v4"], ["uniswap-v2", "Uniswap v2"], ["sushiswap", "SushiSwap"], ["balancer-v2", "Balancer v2"]] },
    { net: "solana", name: "Solana", rnet: "solana", dex: [["raydium", "Raydium"], ["orca", "Orca"], ["pumpswap", "PumpSwap"]] },
    { net: "base", name: "Base", rnet: "base", dex: [["uniswap-v3-base", "Uniswap v3"], ["uniswap-v4-base", "Uniswap v4"], ["uniswap-v2-base", "Uniswap v2"], ["aerodrome-slipstream", "Aerodrome Slipstream"]] },
    { net: "arbitrum", name: "Arbitrum", rnet: "arbitrum", dex: [["uniswap-v3-arbitrum", "Uniswap v3"], ["camelot-v3", "Camelot v3"]] },
    { net: "polygon", name: "Polygon", rnet: "polygon_pos", dex: [["uniswap-v3-polygon", "Uniswap v3"]] }
  ];
  var NOTSUPPORTED = "BNB Chain, Avalanche and Optimism are not on CoinMarketCap's keyless tier. Pool Radar still reads them through GeckoTerminal — this rail says so rather than showing you an empty network.";

  var ST = { vi: 0, di: 0, sel: null, mode: C.lsGet(MODEKEY) || null, err: null };

  /* ---------------------------------------------------------- transport */
  function build(alias, q, mode) {
    var p = [];
    for (var k in q) if (q[k] != null && q[k] !== "") p.push(encodeURIComponent(k) + "=" + encodeURIComponent(q[k]));
    if (mode === "direct") return DIRECT + "/" + PATHS[alias] + (p.length ? "?" + p.join("&") : "");
    return RELAY + "?p=" + encodeURIComponent(alias) + (p.length ? "&" + p.join("&") : "");
  }
  function ckey(alias, q) { var s = alias; for (var k in q) s += "." + k + "-" + q[k]; return "cmc." + s; }
  /* CMC answers 200 with an error inside the envelope as readily as it answers a
     status code, so both shapes are unwrapped here and nowhere else. */
  function unwrap(j) {
    var s = j && j.status;
    if (s && s.error_code && String(s.error_code) !== "0") throw new Error(s.error_message || ("CMC " + s.error_code));
    return j;
  }
  /* The figure's age is CMC's own status.timestamp, never the moment our fetch
     returned. A relay cache hit therefore prints the true age of the price and
     cannot paint a minute-old figure as live. */
  function stampOf(j, fallback) { var t = j && j.status && Date.parse(j.status.timestamp || ""); return t || fallback || C.now(); }

  function once(alias, q, mode) {
    return C.jget(build(alias, q, mode), { key: ckey(alias, q) + "." + mode, ttl: TTL[alias] || 6e4, ms: 12000 })
      .then(function (r) { var j = unwrap(r.data); return { data: j, at: stampOf(j, r.at), stale: r.stale, mode: mode }; });
  }
  /* Mode resolution runs at most twice per session and is remembered. A browser
     that tries direct will fail on CORS with an opaque TypeError — that is not a
     bug to hide, it is the reason the relay exists, so the failure is named. */
  function call(alias, q) {
    q = q || {};
    if (ST.mode) return once(alias, q, ST.mode).catch(function (e) {
      if (ST.mode === "relay") { ST.mode = null; C.lsDel(MODEKEY); return call(alias, q); }
      throw e;
    });
    return once(alias, q, "relay").then(function (r) { ST.mode = "relay"; C.lsSet(MODEKEY, "relay"); ST.err = null; return r; })
      .catch(function () {
        return once(alias, q, "direct").then(function (r) { ST.mode = "direct"; C.lsSet(MODEKEY, "direct"); ST.err = null; return r; })
          .catch(function (e2) {
            ST.err = "The CoinMarketCap rail is dark. The keyless feed sends no CORS header, so a browser needs the relay at " + RELAY + " — deploy web/gateway to Cloudflare Pages and this rail lights up. (" + (e2 && e2.message || e2) + ")";
            throw new Error(ST.err);
          });
      });
  }

  /* ---------------------------------------------------------- shaping */
  var PCT = 100;  /* v4/dex percent fields are fractions — see the header note */
  function fromSpot(r, net, rnet) {
    var q = (r.quote && r.quote[0]) || {};
    var addr = r.contract_address || "";
    return {
      id: "cmc:" + net + ":" + addr, cmc: true, net: rnet, cnet: net, addr: addr,
      name: r.name || "?", sym: r.base_asset_symbol || String(r.name || "").split("/")[0],
      tokAddr: r.base_asset_contract_address || "", ucid: r.base_asset_ucid || null,
      dex: r.dex_slug || "", price: +q.price || 0, liq: +q.liquidity || 0,
      vol: +q.volume_24h || 0, fdv: +q.fully_diluted_value || 0,
      h1: (+q.percent_change_price_1h || 0) * PCT, h24: (+q.percent_change_price_24h || 0) * PCT,
      m5: 0, h6: 0, buys: 0, sells: 0, created: r.created_at || null,
      at: Date.parse(q.last_updated || r.last_updated || "") || 0
    };
  }
  function spot(net, dex) {
    var v = VENUES.filter(function (x) { return x.net === net; })[0] || VENUES[0];
    return call("spot", { network_slug: net, dex_slug: dex }).then(function (r) {
      return { list: (r.data.data || []).map(function (x) { return fromSpot(x, net, v.rnet); }).filter(function (p) { return p.price > 0; }), at: r.at, stale: r.stale, mode: r.mode };
    });
  }
  function pair(net, addr) {
    var v = VENUES.filter(function (x) { return x.net === net; })[0] || VENUES[0];
    return call("pair", { network_slug: net, contract_address: addr }).then(function (r) {
      var row = (r.data.data || [])[0]; if (!row) throw new Error("CoinMarketCap does not index this pool");
      return { pool: fromSpot(row, net, v.rnet), at: r.at, stale: r.stale };
    });
  }
  /* A symbol is not unique on CMC — "ETH" returns Ethereum plus every meme that
     borrowed the ticker. The one with a price and the best rank is the asset. */
  function quote(sym) {
    return call("quotes", { symbol: String(sym || "").toUpperCase(), convert: "USD" }).then(function (r) {
      var rows = (r.data.data || []).filter(function (x) { var q = x.quote; q = Array.isArray(q) ? q[0] : (q && q.USD); return q && q.price > 0; });
      rows.sort(function (a, b) { return (a.cmc_rank || 1e9) - (b.cmc_rank || 1e9); });
      var x = rows[0]; if (!x) throw new Error("no CMC quote for " + sym);
      var q = Array.isArray(x.quote) ? x.quote[0] : x.quote.USD;
      return { sym: x.symbol, name: x.name, rank: x.cmc_rank, price: +q.price || 0, c1: +q.percent_change_1h || 0, c24: +q.percent_change_24h || 0, c7: +q.percent_change_7d || 0, mcap: +q.market_cap || 0, vol: +q.volume_24h || 0, at: r.at, stale: r.stale };
    });
  }
  function ladder(limit) {
    return call("listings", { limit: String(limit || 50), convert: "USD" }).then(function (r) {
      return { list: (r.data.data || []).map(function (x) { var q = (x.quote && x.quote.USD) || {};
        return { rank: x.cmc_rank, sym: x.symbol, name: x.name, price: +q.price || 0, c24: +q.percent_change_24h || 0, c7: +q.percent_change_7d || 0, mcap: +q.market_cap || 0, vol: +q.volume_24h || 0, dom: +q.market_cap_dominance || 0 }; }), at: r.at, stale: r.stale };
    });
  }
  function globals() {
    return call("global", { convert: "USD" }).then(function (r) {
      var d = r.data.data || {}, q = (d.quote && d.quote.USD) || {};
      return { mcap: +q.total_market_cap || 0, vol: +q.total_volume_24h || 0, defi: +q.defi_volume_24h || 0, stable: +q.stablecoin_volume_24h || 0,
        btc: +d.btc_dominance || 0, eth: +d.eth_dominance || 0, active: +d.active_cryptocurrencies || 0, pairs: +d.active_market_pairs || 0, at: r.at, stale: r.stale };
    });
  }

  /* ---------------------------------------------------------- the two-witness test
     GeckoTerminal and CoinMarketCap index the same contract. Agreement is the
     boring case and is still stated. Disagreement above 50 bps is the teachable
     one: it is marked contested, both figures are printed, and nothing in the
     app is allowed to present either as THE price. */
  var GT = "https://api.geckoterminal.com/api/v2";
  var GTNET = { ethereum: "eth", solana: "solana", base: "base", arbitrum: "arbitrum", polygon: "polygon_pos" };
  function crossCheck(cnet, addr) {
    var gt = GTNET[cnet] || "eth";
    return Promise.all([
      pair(cnet, addr).then(function (r) { return r; }, function (e) { return { err: String(e && e.message || e) }; }),
      C.jget(GT + "/networks/" + gt + "/pools/" + addr + "?include=base_token", { key: "cmc.gtx." + gt + "." + addr, ttl: 6e4, ms: 9000, init: { headers: { accept: "application/json;version=20230302" } } })
        .then(function (r) { var a = r.data && r.data.data && r.data.data.attributes || {}; return { price: +a.base_token_price_usd || 0, liq: +a.reserve_in_usd || 0, name: a.name, at: r.at, stale: r.stale }; },
              function (e) { return { err: String(e && e.message || e) }; })
    ]).then(function (a) {
      var c = a[0], g = a[1];
      var cp = c && c.pool && c.pool.price || 0, gp = g && g.price || 0;
      var both = cp > 0 && gp > 0;
      var mid = both ? (cp + gp) / 2 : 0;
      var bps = both ? Math.abs(cp - gp) / mid * 1e4 : null;
      return { cmc: c, gt: g, both: both, bps: bps, contested: both && bps > 50,
        liqGap: (both && c.pool.liq > 0 && g.liq > 0) ? Math.abs(c.pool.liq - g.liq) / ((c.pool.liq + g.liq) / 2) * 100 : null };
    });
  }

  /* ---------------------------------------------------------- UI */
  function px(v) { v = +v || 0; return v >= 1000 ? "$" + v.toFixed(0) : v >= 1 ? "$" + v.toFixed(2) : v >= 0.01 ? "$" + v.toFixed(4) : v >= 1e-6 ? "$" + v.toFixed(7) : "$" + v.toExponential(2); }
  function dark(body, msg) { body.innerHTML = '<div class="dl-empty">' + esc(msg) + "</div>"; }

  function venueChips() {
    var v = VENUES[ST.vi];
    return '<div class="dl-chips" id="dlCmNets">' + VENUES.map(function (x, i) { return '<button class="dl-chip' + (i === ST.vi ? " on" : "") + '" data-cvi="' + i + '">' + esc(x.name) + "</button>"; }).join("") + "</div>" +
      '<div class="dl-chips" id="dlCmDex">' + v.dex.map(function (d, i) { return '<button class="dl-chip' + (i === ST.di ? " on" : "") + '" data-cdi="' + i + '">' + esc(d[1]) + "</button>"; }).join("") + '<span class="sp"></span><span class="dl-prov recent" id="dlCmProv">CoinMarketCap</span></div>';
  }
  function rowHTML(p) {
    return '<div class="dl-row click dlc-row-click" data-cpool="' + esc(p.id) + '"><div class="nm"><b>' + esc(p.name) + '</b><span>liq ' + C.big(p.liq) + " · vol " + C.big(p.vol) + (p.fdv ? " · FDV " + C.big(p.fdv) : "") + " · " + esc(p.dex) + '</span></div><div class="rt">' + px(p.price) +
      '<br><span class="dlc-xs"><span class="' + (p.h1 >= 0 ? "up" : "dn") + '" title="1h">' + C.pct(p.h1, 2) + '</span> <span class="' + (p.h24 >= 0 ? "up" : "dn") + '" title="24h">' + C.pct(p.h24, 2) + "</span></span></div></div>";
  }
  function listView(body) {
    var v = VENUES[ST.vi], d = v.dex[ST.di] || v.dex[0];
    body.innerHTML = venueChips() + '<div id="dlCmList">' + C.skel(6) + "</div>" +
      '<div class="dl-note">CoinMarketCap’s own on-chain feed, read without an account, a key or a wallet. It is the SECOND witness on this app’s pool prices — open a pool to hold it against GeckoTerminal. ' + esc(NOTSUPPORTED) + "</div>";
    spot(v.net, d[0]).then(function (r) {
      var el = $("dlCmList"); if (!el) return;
      var list = r.list.slice(0, 40);
      el.innerHTML = list.length ? list.map(rowHTML).join("") : '<div class="dl-empty">That venue returned no pairs just now.</div>';
      el.__list = list;
      var pv = $("dlCmProv"); if (pv) pv.outerHTML = C.prov("CoinMarketCap", r.at, r.stale, { attr: 'id="dlCmProv"', title: "CMC keyless " + PATHS.spot + " · via " + (r.mode === "direct" ? "direct" : "the /api/cmc relay") });
    }).catch(function (e) { var el = $("dlCmList"); if (el) dark(el, e.message || e); });
  }

  function poolView(body, p) {
    body.innerHTML = '<button class="dl-b" id="dlCmBack">← Back to the rail</button>' +
      '<div class="dl154 dlc-mt10"><div class="h">' + esc(p.name) + ' <span class="dl-prov recent" id="dlCmPProv">CoinMarketCap</span><span class="sp"></span><b>' + px(p.price) + '</b></div>' +
      '<div class="dl-2"><div><div class="kv"><span>Liquidity</span><b>' + C.big(p.liq) + '</b></div><div class="kv"><span>24h volume</span><b>' + C.big(p.vol) + '</b></div><div class="kv"><span>FDV</span><b>' + (p.fdv ? C.big(p.fdv) : "—") + '</b></div><div class="kv"><span>Venue</span><b>' + esc(p.dex) + '</b></div><div class="kv"><span>1h · 24h</span><b><span class="' + (p.h1 >= 0 ? "up" : "dn") + '">' + C.pct(p.h1, 2) + '</span> · <span class="' + (p.h24 >= 0 ? "up" : "dn") + '">' + C.pct(p.h24, 2) + '</span></b></div></div>' +
      '<div><div class="h dlc-mb6">⚖ Two witnesses<span class="sp"></span><button class="dl-b" id="dlCmX">Cross-check</button></div><div id="dlCmXout" class="dl-note dlc-m0">One indexer is an opinion. Hold CoinMarketCap’s price for this contract against GeckoTerminal’s and see whether they agree — and by how much when they do not.</div>' +
      '<div class="h dlc-mrow">🛡 Security<span class="sp"></span><button class="dl-b" id="dlCmScan">Scan token</button></div><div id="dlCmSec" class="dl-note dlc-m0">GoPlus reads the contract’s own rules — honeypot, mint, pause, taxes, LP lock.</div></div></div></div>' +
      '<div class="dl154" id="dlCmSand"></div>';
    $("dlCmBack").onclick = function () { ST.sel = null; listView(body); };
    var pv = $("dlCmPProv"); if (pv) pv.outerHTML = C.prov("CoinMarketCap", p.at || C.now(), false, { attr: 'id="dlCmPProv"', title: "CMC " + PATHS.spot + " · last_updated on the pool row" });

    $("dlCmX").onclick = function () {
      var out = $("dlCmXout"); out.innerHTML = C.skel(2);
      crossCheck(p.cnet, p.addr).then(function (x) {
        if (!x.both) { out.innerHTML = '<div class="dl-empty">Only one witness answered — ' + esc((x.cmc && x.cmc.err) || (x.gt && x.gt.err) || "the other indexer does not carry this pool") + ". One source is not a cross-check, so nothing is claimed here.</div>"; return; }
        var agree = !x.contested;
        out.innerHTML = '<div class="sec-verdict ' + (agree ? "safe" : "warn") + '"><span class="em">' + (agree ? "⚖️" : "⚠️") + '</span><div><b>' + (agree ? "The two indexers agree" : "The two indexers disagree") + '</b><span>' + x.bps.toFixed(1) + ' bps apart on the same contract</span></div></div>' +
          '<div class="sec-grid"><div class="sec-item"><span>CoinMarketCap</span><span class="neu">' + esc(px(x.cmc.pool.price)) + '</span></div><div class="sec-item"><span>GeckoTerminal</span><span class="neu">' + esc(px(x.gt.price)) + '</span></div>' +
          '<div class="sec-item"><span>Spread</span><span class="' + (agree ? "ok" : "bad") + '">' + x.bps.toFixed(1) + ' bps</span></div>' +
          (x.liqGap != null ? '<div class="sec-item"><span>Liquidity read</span><span class="' + (x.liqGap > 10 ? "bad" : "ok") + '">' + x.liqGap.toFixed(1) + '% apart</span></div>' : "") + "</div>" +
          '<div class="dl-note dlc-mt8">' + (agree ? "Two independent indexers reading one contract landed within half a percent. That is what a liquid, well-indexed pool looks like."
            : "A gap this wide means at least one of them is reading a stale block, a different reserve, or a pool too thin to price. On a real venue you would be filled at neither number. This is the oracle problem, on your screen, with your pool.") + "</div>";
        var chip = $("dlCmPProv");
        if (chip) chip.outerHTML = C.prov("CoinMarketCap", p.at || C.now(), false, { attr: 'id="dlCmPProv"', contested: x.contested, title: "CMC " + px(x.cmc.pool.price) + " · GeckoTerminal " + px(x.gt.price) });
        C.xp("cmc.cross", 25, "Cross-checked a pool against a second indexer — you asked a price to prove itself");
        try { window.DEXAI && DEXAI.event && DEXAI.event("cmc.cross", { pool: p, x: x }); } catch (e) {}
      }).catch(function (e) { dark(out, e.message || e); });
    };
    $("dlCmScan").onclick = function () {
      var out = $("dlCmSec"); out.innerHTML = C.skel(2);
      if (!window.DLRADAR || !DLRADAR.security) { dark(out, "The scanner layer is not loaded."); return; }
      DLRADAR.security(p.net, p.tokAddr).then(function (sec) {
        var v = DLRADAR.verdict(sec);
        out.innerHTML = '<div class="sec-verdict ' + v.cls + '"><span class="em">' + v.em + '</span><div><b>' + v.label + '</b><span>' + esc(sec.name || p.sym) + " · risk " + v.risk + '/100</span></div></div><div class="sec-grid">' +
          sec.flags.map(function (f) { return '<div class="sec-item"><span>' + esc(f.label) + '</span><span class="' + (f.bad ? "bad" : f.k === "holders" ? "neu" : "ok") + '">' + esc(f.txt) + "</span></div>"; }).join("") + "</div>";
      }).catch(function (e) { dark(out, e.message || e); });
    };
    sand(body, p);
  }
  /* The sandbox is DLRADAR's, not a second implementation: one AMM, one pool
     book, one set of fills. A CMC pool and a GeckoTerminal pool are practised in
     the same ledger and read by the same coach. */
  function sand(body, p) {
    var el = $("dlCmSand"); if (!el) return;
    if (!window.DLRADAR || !DLRADAR.quote) { el.innerHTML = '<div class="dl-empty">Pool Radar is not loaded, so there is nothing to practise in.</div>'; return; }
    var B = DLRADAR.book() || { cash: 0, pos: [] }, pos = B.pos.filter(function (x) { return x.id === p.id; })[0];
    el.innerHTML = '<div class="h">🧪 Practise this pool ' + C.simTag() + '<span class="sp"></span><span class="dlc-book">pool book <b>' + C.money(B.cash, 2) + '</b> paper USDT</span></div>' +
      '<div class="dl-2"><div><div class="dlc-inline dlc-mb6"><input class="dl-inp" id="dlCmAmt" type="number" min="1" step="1" value="100" placeholder="USDT"><button class="dl-b pri" id="dlCmBuy">Buy</button></div><div id="dlCmQ" class="dl-formula dlc-m0"></div></div>' +
      '<div>' + (pos ? '<div class="kv"><span>Position</span><b>' + pos.qty.toFixed(4) + " " + esc(p.sym) + '</b></div><div class="kv"><span>Avg entry</span><b>' + px(pos.cost / pos.qty) + '</b></div><div class="dlc-inline dlc-mt8"><button class="dl-b" data-csell="0.5">Sell ½</button><button class="dl-b warn" data-csell="1">Sell all</button></div>' : '<div class="dl-empty dlc-p10">No position here yet. Size it small, watch the slippage, then read the cross-check again.</div>') + "</div></div>" +
      '<div class="n">x·y=k on half of CoinMarketCap’s reported liquidity · LP fee 0.30% · gas $2.20 · paper only. The liquidity figure comes from CMC; if the cross-check says the two indexers disagree on it, this quote inherits that doubt.</div>';
    var amt = $("dlCmAmt"), q = $("dlCmQ");
    function refresh() { var v = +amt.value; if (!(v > 0)) { q.textContent = "Enter an amount."; return; } var r = DLRADAR.quote(p, "buy", v); q.innerHTML = "≈ <b>" + r.qty.toFixed(4) + " " + esc(p.sym) + "</b> at " + px(r.eff) + " · slippage <b class='" + (r.slip > 2 ? "dn" : "up") + "'>" + r.slip.toFixed(2) + "%</b> · fee + gas $" + r.fee.toFixed(2); }
    amt.oninput = refresh; refresh();
    $("dlCmBuy").onclick = function () { if (DLRADAR.buy(p, +amt.value)) sand(body, p); };
    el.querySelectorAll("[data-csell]").forEach(function (b) { b.onclick = function () { if (DLRADAR.sell(p, +b.getAttribute("data-csell"))) sand(body, p); }; });
  }

  function ladderView(body) {
    body.innerHTML = C.skel(8);
    ladder(50).then(function (r) {
      body.innerHTML = '<div class="dl154"><div class="h">CoinMarketCap’s own ladder <span class="dl-prov" id="dlCmLProv">CoinMarketCap</span></div><div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>#</th><th>Asset</th><th class="r">Price</th><th class="r">24h</th><th class="r">7d</th><th class="r">Cap</th></tr></thead><tbody>' +
        r.list.map(function (x) { return "<tr><td>" + x.rank + "</td><td><b>" + esc(x.sym) + '</b><br><span class="dlc-faint">' + esc(x.name) + '</span></td><td class="r">' + px(x.price) + '</td><td class="r ' + (x.c24 >= 0 ? "up" : "dn") + '">' + C.pct(x.c24, 1) + '</td><td class="r ' + (x.c7 >= 0 ? "up" : "dn") + '">' + C.pct(x.c7, 1) + '</td><td class="r">' + C.big(x.mcap) + "</td></tr>"; }).join("") +
        '</tbody></table></div><div class="n">This is the ranking CoinMarketCap itself publishes, fetched with no account. DexLadder’s own ladder is built from a five-source hedge; when the two differ, neither is wrong — they are counting different venues.</div></div>';
      var pv = $("dlCmLProv"); if (pv) pv.outerHTML = C.prov("CoinMarketCap", r.at, r.stale, { attr: 'id="dlCmLProv"', title: "CMC keyless " + PATHS.listings });
    }).catch(function (e) { dark(body, e.message || e); });
  }
  function globalView(body) {
    body.innerHTML = C.skel(5);
    globals().then(function (g) {
      body.innerHTML = '<div class="dl154"><div class="h">The market, as CoinMarketCap counts it <span class="dl-prov" id="dlCmGProv">CoinMarketCap</span></div>' +
        '<div class="kv"><span>Total market cap</span><b>' + C.big(g.mcap) + '</b></div><div class="kv"><span>24h volume</span><b>' + C.big(g.vol) + '</b></div>' +
        '<div class="kv"><span>DeFi volume 24h</span><b>' + C.big(g.defi) + '</b></div><div class="kv"><span>Stablecoin volume 24h</span><b>' + C.big(g.stable) + '</b></div>' +
        '<div class="kv"><span>BTC dominance</span><b>' + g.btc.toFixed(2) + '%</b></div><div class="kv"><span>ETH dominance</span><b>' + g.eth.toFixed(2) + '%</b></div>' +
        '<div class="kv"><span>Assets tracked</span><b>' + C.big(g.active) + '</b></div><div class="kv"><span>Active market pairs</span><b>' + C.big(g.pairs) + '</b></div>' +
        '<div class="n">Stablecoin volume against total volume is the honest read of how much of "crypto trading" is people moving between two dollars. DexLadder shows it because it is unflattering.</div></div>';
      var pv = $("dlCmGProv"); if (pv) pv.outerHTML = C.prov("CoinMarketCap", g.at, g.stale, { attr: 'id="dlCmGProv"', title: "CMC keyless " + PATHS.global });
    }).catch(function (e) { dark(body, e.message || e); });
  }

  function render(tab, body) {
    if (tab === "ladder") return ladderView(body);
    if (tab === "global") return globalView(body);
    if (ST.sel) return poolView(body, ST.sel);
    listView(body);
  }
  function open(tab) {
    var el = C.open("dlCmc", { title: "⚖ Spot Rail", sub: "CoinMarketCap keyless · second witness on every pool price", tabs: [["pairs", "Spot pairs"], ["ladder", "CMC ladder"], ["global", "Global"]], onTab: render }, tab);
    if (!el.__cwired) {
      el.__cwired = 1;
      el.addEventListener("click", function (e) {
        var body = el.querySelector(".dls-body");
        var n = e.target.closest("[data-cvi]"); if (n) { ST.vi = +n.getAttribute("data-cvi"); ST.di = 0; ST.sel = null; return listView(body); }
        var d = e.target.closest("[data-cdi]"); if (d) { ST.di = +d.getAttribute("data-cdi"); ST.sel = null; return listView(body); }
        var row = e.target.closest("[data-cpool]");
        if (row) { var list = ($("dlCmList") || {}).__list || []; var p = list.filter(function (x) { return x.id === row.getAttribute("data-cpool"); })[0]; if (p) { ST.sel = p; poolView(body, p); C.sfx("click"); } }
      });
    }
    return el;
  }

  C.cmd("spot rail", "Spot Rail — CoinMarketCap's keyless on-chain feed, second witness on every pool", "⚖", function () { open("pairs"); });
  C.cmd("cross-check a pool", "Hold CoinMarketCap's price for a pool against GeckoTerminal's", "⚖", function () { open("pairs"); });
  C.cmd("cmc ladder", "CoinMarketCap's own top-50 ranking, read without an account", "🪜", function () { open("ladder"); });

  return { __v: 157, open: open, spot: spot, pair: pair, quote: quote, ladder: ladder, globals: globals, crossCheck: crossCheck, fromSpot: fromSpot, venues: VENUES, state: ST, paths: PATHS, relay: RELAY };
})();
