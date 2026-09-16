/* ============================================================
   DLRADAR · v154 — Pool Radar (the DEX screener, renamed from the
   CMC trademark "DexScan"): Trending · Fresh · Movers · Search over
   GeckoTerminal networks, 5m/1h/6h/24h columns, buys/sells, liquidity,
   FDV, age-to-the-second; presets; pool candles drawn by DexLadder's
   own canvas; GoPlus security (EVM + Solana); and the loop CMC cannot
   close — "Practise this pool": a constant-product AMM sandbox with a
   1,000-USDT paper pool book, real liquidity-based slippage, LP fee and
   gas, positions marked to the live pool price.
   Data: GeckoTerminal public API (keyless, ~30/min, versioned header),
   GoPlus (keyless). Everything simulated is labelled.
   ============================================================ */
window.DLRADAR = (function () {
  "use strict";
  if (window.DLRADAR && window.DLRADAR.__v) return window.DLRADAR;
  var C = window.DLCORE, $ = C.$, esc = C.esc;
  var GT = "https://api.geckoterminal.com/api/v2";
  var GTI = { headers: { accept: "application/json;version=20230302" } };
  var NETS = [["eth", "Ethereum"], ["solana", "Solana"], ["base", "Base"], ["bsc", "BNB"], ["arbitrum", "Arbitrum"], ["polygon_pos", "Polygon"], ["avax", "Avalanche"], ["optimism", "Optimism"], ["sui-network", "Sui"], ["ton", "TON"]];
  var GOPLUS = { eth: "1", bsc: "56", polygon_pos: "137", arbitrum: "42161", base: "8453", optimism: "10", avax: "43114" };
  var ST = { net: "eth", tab: "trend", q: "", preset: { liq: 0, age: 0 }, sel: null };
  var LPFEE = 0.003, GAS = 2.2;

  function X() { var x = C.X(); if (!x) return null; x.pools || (x.pools = { cash: 1000, pos: [], hist: [] }); return x.pools; }
  function ageOf(iso) { var t = Date.parse(iso || ""); if (!t) return "—"; var s = (Date.now() - t) / 1e3; return s < 60 ? Math.round(s) + "s" : s < 3600 ? Math.round(s / 60) + "m" : s < 86400 ? (s / 3600).toFixed(1) + "h" : Math.round(s / 86400) + "d"; }
  function shape(j) {
    var inc = {}; (j.included || []).forEach(function (x) { inc[x.id] = x; });
    return (j.data || []).map(function (p) {
      var a = p.attributes || {}, bt = p.relationships && p.relationships.base_token && p.relationships.base_token.data, tok = bt && inc[bt.id], ta = tok && tok.attributes || {};
      var net = (p.relationships && p.relationships.network && p.relationships.network.data && p.relationships.network.data.id) || (p.id || "").split("_")[0] || ST.net;
      var pc = a.price_change_percentage || {}, tx = a.transactions || {}, vol = a.volume_usd || {};
      return { id: p.id, net: net, addr: a.address, name: a.name || "?", sym: ta.symbol || (a.name || "").split("/")[0].trim(), tokAddr: ta.address || (bt && bt.id ? bt.id.split("_").slice(1).join("_") : ""),
        price: +a.base_token_price_usd || 0, liq: +a.reserve_in_usd || 0, fdv: +a.fdv_usd || 0, mcap: +a.market_cap_usd || 0,
        m5: +pc.m5 || 0, h1: +pc.h1 || 0, h6: +pc.h6 || 0, h24: +pc.h24 || 0, buys: (tx.h24 && +tx.h24.buys) || 0, sells: (tx.h24 && +tx.h24.sells) || 0, vol: +vol.h24 || 0, vol1h: +vol.h1 || 0, created: a.pool_created_at };
    });
  }
  function fetchList(kind, net, q) {
    var u, key;
    if (kind === "fresh") { u = GT + "/networks/" + net + "/new_pools?include=base_token&page=1"; key = "gt.new." + net; }
    else if (kind === "search") { u = GT + "/search/pools?query=" + encodeURIComponent(q) + "&network=" + net + "&include=base_token&page=1"; key = "gt.q." + net + "." + q; }
    else { u = GT + "/networks/" + net + "/trending_pools?include=base_token&page=1"; key = "gt.trend." + net; }
    return C.jget(u, { key: key, ttl: kind === "fresh" ? 6e4 : 18e4, ms: 10000, init: GTI }).then(function (r) { return { list: shape(r.data), at: r.at, stale: r.stale }; });
  }
  function fetchPool(net, addr) { return C.jget(GT + "/networks/" + net + "/pools/" + addr + "?include=base_token", { key: "gt.pool." + net + "." + addr, ttl: 6e4, ms: 9000, init: GTI }).then(function (r) { var d = r.data; var l = shape({ data: [d.data], included: d.included }); return { pool: l[0], at: r.at, stale: r.stale }; }); }
  function fetchOhlcv(net, addr, tf) { return C.jget(GT + "/networks/" + net + "/pools/" + addr + "/ohlcv/" + (tf || "hour") + "?aggregate=1&limit=100", { key: "gt.ohlcv." + net + "." + addr + "." + tf, ttl: 12e4, ms: 9000, init: GTI }).then(function (r) { var l = r.data && r.data.data && r.data.data.attributes && r.data.data.attributes.ohlcv_list || []; return { rows: l.slice().sort(function (a, b) { return a[0] - b[0]; }), at: r.at }; }); }
  function security(net, tokAddr) {
    if (net === "solana") return C.jget("https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=" + tokAddr, { key: "gp.sol." + tokAddr, ttl: 6e5, ms: 9000 }).then(function (r) { var res = r.data && r.data.result || {}; var k = Object.keys(res)[0]; var t = k ? res[k] : null; if (!t) throw new Error("not found");
      return { chain: "solana", raw: t, flags: [
        { k: "mint", label: "Mint authority", bad: !!(t.mintable && t.mintable.status === "1"), txt: (t.mintable && t.mintable.status === "1") ? "enabled — supply can grow" : "disabled" },
        { k: "freeze", label: "Freeze authority", bad: !!(t.freezable && t.freezable.status === "1"), txt: (t.freezable && t.freezable.status === "1") ? "enabled — your tokens can be frozen" : "disabled" },
        { k: "close", label: "Closable", bad: !!(t.closable && t.closable.status === "1"), txt: (t.closable && t.closable.status === "1") ? "yes" : "no" },
        { k: "holders", label: "Holders", bad: false, txt: String(t.holder_count || "—") } ], name: t.metadata && t.metadata.name, sym: t.metadata && t.metadata.symbol }; });
    var cid = GOPLUS[net]; if (!cid) return Promise.reject(new Error("No keyless scanner for " + net + " yet"));
    return C.jget("https://api.gopluslabs.io/api/v1/token_security/" + cid + "?contract_addresses=" + tokAddr, { key: "gp." + cid + "." + tokAddr, ttl: 6e5, ms: 9000 }).then(function (r) { var res = r.data && r.data.result || {}; var t = res[tokAddr.toLowerCase()] || res[Object.keys(res)[0]]; if (!t) throw new Error("not found on GoPlus");
      var honey = t.is_honeypot === "1", mint = t.is_mintable === "1", pause = t.transfer_pausable === "1" || t.trading_cooldown === "1" || t.is_blacklisted === "1", bt = 100 * (+t.buy_tax || 0), stx = 100 * (+t.sell_tax || 0), open = t.is_open_source === "1";
      var lpLocked = (t.lp_holders || []).some(function (h) { return +h.is_locked === 1 && +h.percent > 0.5; });
      return { chain: net, raw: t, name: t.token_name, sym: t.token_symbol, flags: [
        { k: "honeypot", label: "Honeypot", bad: honey, txt: honey ? "YES — buys that cannot be sold" : "no" },
        { k: "mint", label: "Owner can mint", bad: mint, txt: mint ? "yes — supply can be inflated on you" : "no" },
        { k: "pause", label: "Pause / blacklist / cooldown", bad: pause, txt: pause ? "yes — trading can be switched off for you" : "no" },
        { k: "tax", label: "Buy / sell tax", bad: bt > 10 || stx > 10, txt: bt.toFixed(0) + "% / " + stx.toFixed(0) + "%" },
        { k: "source", label: "Source verified", bad: !open, txt: open ? "yes" : "no — unreadable contract" },
        { k: "lp", label: "LP locked", bad: !lpLocked, txt: lpLocked ? "majority locked" : "not locked — liquidity can leave" },
        { k: "holders", label: "Holders", bad: false, txt: String(t.holder_count || "—") } ] }; });
  }
  function verdict(sec) { var risk = 0; sec.flags.forEach(function (f) { if (!f.bad) return; risk += f.k === "honeypot" ? 100 : f.k === "mint" ? 30 : f.k === "pause" ? 25 : f.k === "tax" ? 20 : f.k === "source" ? 15 : f.k === "lp" ? 20 : f.k === "freeze" ? 40 : 10; }); var cls = risk >= 60 ? "dang" : risk >= 25 ? "warn" : "safe"; return { risk: Math.min(100, risk), cls: cls, em: cls === "dang" ? "⛔" : cls === "warn" ? "⚠️" : "✅", label: cls === "dang" ? "High risk" : cls === "warn" ? "Caution" : "No red flags found" }; }

  /* ---------------------------------------------------------- candles (own renderer) */
  function drawCandles(cv, rows) {
    if (!cv || !rows || rows.length < 2) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2), W = cv.clientWidth || 600, H = cv.clientHeight || 220;
    cv.width = W * dpr; cv.height = H * dpr; var g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var pad = { l: 8, r: 56, t: 10, b: 20 }, lo = Infinity, hi = -Infinity;
    rows.forEach(function (r) { lo = Math.min(lo, +r[3]); hi = Math.max(hi, +r[2]); });
    if (!(hi > lo)) { hi = lo * 1.01 + 1e-9; }
    var n = rows.length, cw = (W - pad.l - pad.r) / n, y = function (v) { return pad.t + (hi - v) / (hi - lo) * (H - pad.t - pad.b); };
    g.strokeStyle = "rgba(148,163,199,.12)"; g.lineWidth = 1;
    for (var i = 0; i <= 4; i++) { var yy = pad.t + (H - pad.t - pad.b) * i / 4; g.beginPath(); g.moveTo(pad.l, yy); g.lineTo(W - pad.r, yy); g.stroke(); g.fillStyle = "#8b97ad"; g.font = "600 10px system-ui,sans-serif"; g.textAlign = "left"; g.fillText(fmtPx(hi - (hi - lo) * i / 4), W - pad.r + 6, yy + 3); }
    rows.forEach(function (r, i) { var o = +r[1], h = +r[2], l = +r[3], c = +r[4], x = pad.l + cw * i + cw / 2, up = c >= o; g.strokeStyle = g.fillStyle = up ? "#00E676" : "#FF5252"; g.beginPath(); g.moveTo(x, y(h)); g.lineTo(x, y(l)); g.stroke(); var bw = Math.max(1, cw * 0.6), top = y(Math.max(o, c)), hh = Math.max(1, Math.abs(y(o) - y(c))); g.fillRect(x - bw / 2, top, bw, hh); });
    g.fillStyle = "#8b97ad"; g.textAlign = "center"; var t0 = new Date(rows[0][0] * 1e3), t1 = new Date(rows[n - 1][0] * 1e3);
    g.fillText(t0.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit" }), pad.l + 60, H - 6); g.fillText(t1.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit" }), W - pad.r - 60, H - 6);
  }
  function fmtPx(v) { v = +v || 0; return v >= 1000 ? "$" + v.toFixed(0) : v >= 1 ? "$" + v.toFixed(2) : v >= 0.01 ? "$" + v.toFixed(4) : v >= 1e-6 ? "$" + v.toFixed(7) : "$" + v.toExponential(2); }

  /* ---------------------------------------------------------- AMM sandbox (constant product) */
  function quote(pool, side, usd, qty) {
    var Ru = Math.max(1, pool.liq / 2), Rt = Ru / Math.max(pool.price, 1e-12);
    if (side === "buy") { var inn = usd * (1 - LPFEE), dt = Rt * inn / (Ru + inn); return { qty: dt, eff: usd / dt, slip: (usd / dt / pool.price - 1) * 100, fee: usd * LPFEE + GAS }; }
    var outU = Ru * qty / (Rt + qty) * (1 - LPFEE); return { usd: outU, eff: outU / qty, slip: (1 - outU / qty / pool.price) * 100, fee: Ru * qty / (Rt + qty) * LPFEE + GAS };
  }
  function buy(pool, usd) {
    var B = X(); if (!B) return null; usd = +usd; if (!(usd > 0)) return null;
    var q = quote(pool, "buy", usd); var total = usd + GAS;
    if (total > B.cash + 1e-9) { C.toast("bad", "Not enough paper USDT in the pool book", "You have " + C.money(B.cash, 2) + " · faucet refills at 0"); return null; }
    B.cash -= total;
    var p = B.pos.filter(function (x) { return x.id === pool.id; })[0];
    if (p) { p.qty += q.qty; p.cost += usd; } else B.pos.push({ id: pool.id, net: pool.net, addr: pool.addr, name: pool.name, sym: pool.sym, qty: q.qty, cost: usd, entry: q.eff, t: Date.now() });
    B.hist.unshift({ t: Date.now(), side: "buy", sym: pool.sym, usd: usd, qty: q.qty, px: q.eff, slip: q.slip, fee: q.fee }); if (B.hist.length > 60) B.hist.pop();
    C.save(); C.sfx("buy"); C.toast("good", "Pool buy filled" + C.simTag(), "Bought " + q.qty.toFixed(4) + " " + pool.sym + " @ " + fmtPx(q.eff) + " · slippage " + q.slip.toFixed(2) + "% · fee+gas $" + q.fee.toFixed(2));
    C.xp("pool.first", 20, "First pool practised — you felt AMM slippage before it cost you");
    try { window.DEXAI && DEXAI.event && DEXAI.event("pool.buy", { pool: pool, q: q, usd: usd }); } catch (e) {}
    return q;
  }
  function sell(pool, frac) {
    var B = X(); if (!B) return null; var p = B.pos.filter(function (x) { return x.id === pool.id; })[0]; if (!p) return null;
    var qty = p.qty * Math.min(1, Math.max(0.01, +frac || 1)); var q = quote(pool, "sell", 0, qty);
    var costPart = p.cost * qty / p.qty, pl = q.usd - GAS - costPart;
    B.cash += Math.max(0, q.usd - GAS); p.qty -= qty; p.cost -= costPart; if (p.qty <= 1e-9) B.pos = B.pos.filter(function (x) { return x !== p; });
    B.hist.unshift({ t: Date.now(), side: "sell", sym: pool.sym, usd: q.usd, qty: qty, px: q.eff, slip: q.slip, fee: q.fee, pl: pl }); if (B.hist.length > 60) B.hist.pop();
    C.save(); C.sfx("sell"); C.toast(pl >= 0 ? "good" : "bad", "Pool sell filled" + C.simTag(), (pl >= 0 ? "+" : "−") + "$" + Math.abs(pl).toFixed(2) + " · slippage " + q.slip.toFixed(2) + "%");
    try { window.DEXAI && DEXAI.event && DEXAI.event("pool.sell", { pool: pool, q: q, pl: pl, qty: qty }); } catch (e) {}
    return q;
  }
  function faucet() { var B = X(); if (B && B.cash < 1) { B.cash = 1000; C.save(); C.toast("good", "Pool book refilled", "1,000 paper USDT — slippage is free tuition here"); } }

  /* ---------------------------------------------------------- UI */
  function rowHTML(p) {
    return '<div class="dl-row click" data-pool="' + esc(p.id) + '" style="cursor:pointer"><div class="nm"><b>' + esc(p.name) + '</b><span>liq ' + C.big(p.liq) + " · vol " + C.big(p.vol) + " · " + p.buys + "↑ " + p.sells + "↓ · " + ageOf(p.created) + " old" + (p.fdv ? " · FDV " + C.big(p.fdv) : "") + '</span></div><div class="rt">' + fmtPx(p.price) + '<br><span style="font-size:10.5px">' + ["m5", "h1", "h6", "h24"].map(function (k) { return '<span class="' + (p[k] >= 0 ? "up" : "dn") + '" title="' + k + '">' + C.pct(p[k], 1) + "</span>"; }).join(" ") + "</span></div></div>";
  }
  function filterList(list) {
    var pr = ST.preset; return list.filter(function (p) { if (pr.liq && p.liq < pr.liq) return false; if (pr.age) { var t = Date.parse(p.created || ""); if (t && Date.now() - t < pr.age) return false; } return true; });
  }
  function listView(body) {
    var kind = ST.tab === "fresh" ? "fresh" : ST.tab === "search" ? "search" : "trend";
    var head = '<div class="dl-chips" id="dlRdNets">' + NETS.map(function (n) { return '<button class="dl-chip' + (n[0] === ST.net ? " on" : "") + '" data-net="' + n[0] + '">' + esc(n[1]) + "</button>"; }).join("") + "</div>" +
      '<div class="dl-chips" id="dlRdPre"><button class="dl-chip' + (ST.preset.liq ? " on" : "") + '" data-pre="liq">Liquidity ≥ $50k</button><button class="dl-chip' + (ST.preset.age ? " on" : "") + '" data-pre="age">Age ≥ 1h</button><span style="flex:1"></span><span class="dl-prov recent" id="dlRdProv">GeckoTerminal</span></div>' +
      (kind === "search" ? '<div class="dl-in"><input id="dlRdQ" placeholder="Token name, symbol or contract…" value="' + esc(ST.q) + '"><button id="dlRdGo">Search</button></div>' : "") + '<div id="dlRdList">' + C.skel(6) + "</div>" +
      '<div class="dl-note">' + (kind === "fresh" ? "Freshly created pools, age to the second. Most new pools die; the point is to learn to tell which — scan before you practise." : kind === "trend" ? "Trending pools on this network · GeckoTerminal · keyless. Tap a pool for candles, a security scan and the AMM sandbox." : "Search pools by name, symbol or contract on the selected network.") + " Nothing here is a recommendation; every trade in the sandbox is simulated.</div>";
    body.innerHTML = head;
    if (kind === "search" && !ST.q) { $("dlRdList").innerHTML = '<div class="dl-empty">Type a token and tap Search.</div>'; return; }
    fetchList(kind, ST.net, ST.q).then(function (r) {
      var list = filterList(r.list); if (kind === "movers") list.sort(function (a, b) { return b.h24 - a.h24; });
      if (ST.tab === "movers") list = filterList(r.list).sort(function (a, b) { return Math.abs(b.h24) - Math.abs(a.h24); });
      var el = $("dlRdList"); if (!el) return;
      el.innerHTML = list.length ? list.map(rowHTML).join("") : '<div class="dl-empty">No pools match — loosen the presets or pick another network.</div>';
      var pv = $("dlRdProv"); if (pv) pv.outerHTML = C.prov("GeckoTerminal", r.at, r.stale, { attr: 'id="dlRdProv"' });
      el.__list = list;
    }).catch(function (e) { var el = $("dlRdList"); if (el) el.innerHTML = '<div class="dl-empty">Couldn’t reach the DEX feed — ' + esc(e.message || e) + "</div>"; });
  }
  function poolView(body, p) {
    body.innerHTML = '<button class="dl-b" id="dlRdBack">← Back to radar</button><div class="dl154" style="margin-top:10px"><div class="h">' + esc(p.name) + ' <span class="dl-prov recent" id="dlRdPProv">' + esc(NETS.filter(function (n) { return n[0] === p.net; }).map(function (n) { return n[1]; })[0] || p.net) + '</span><span class="sp"></span><b id="dlRdPx">' + fmtPx(p.price) + '</b></div><canvas class="dl-cv" id="dlRdCv"></canvas><div class="dl-chips" style="margin:8px 0 0"><button class="dl-chip on" data-tf="hour">1h candles</button><button class="dl-chip" data-tf="minute">1m</button><button class="dl-chip" data-tf="day">1d</button></div>' +
      '<div class="dl-2" style="margin-top:10px"><div><div class="kv"><span>Liquidity</span><b>' + C.big(p.liq) + '</b></div><div class="kv"><span>24h volume</span><b>' + C.big(p.vol) + '</b></div><div class="kv"><span>Buys / sells 24h</span><b>' + p.buys + " / " + p.sells + '</b></div><div class="kv"><span>FDV</span><b>' + (p.fdv ? C.big(p.fdv) : "—") + '</b></div><div class="kv"><span>Pool age</span><b>' + ageOf(p.created) + '</b></div><div class="kv"><span>5m · 1h · 6h · 24h</span><b>' + ["m5", "h1", "h6", "h24"].map(function (k) { return '<span class="' + (p[k] >= 0 ? "up" : "dn") + '">' + C.pct(p[k], 1) + "</span>"; }).join(" · ") + "</b></div></div>" +
      '<div><div class="h" style="margin-bottom:6px">🛡 Security <span class="sp"></span><button class="dl-b" id="dlRdScan">Scan token</button></div><div id="dlRdSec" class="dl-note" style="margin:0">Tap Scan — GoPlus checks honeypot, mint, pause/blacklist, taxes, source, LP lock. A clean scan is not a guarantee.</div></div></div></div>' +
      sandboxHTML(p);
    $("dlRdBack").onclick = function () { ST.sel = null; listView(body); };
    var cv = $("dlRdCv"); var loadTf = function (tf) { fetchOhlcv(p.net, p.addr, tf).then(function (r) { drawCandles(cv, r.rows); }).catch(function () { var g = cv.getContext("2d"); g.fillStyle = "#8b97ad"; g.font = "600 12px system-ui"; g.fillText("Candles unavailable for this pool right now.", 12, 24); }); };
    loadTf("hour");
    body.querySelectorAll("[data-tf]").forEach(function (b) { b.onclick = function () { body.querySelectorAll("[data-tf]").forEach(function (x) { x.classList.toggle("on", x === b); }); loadTf(b.getAttribute("data-tf")); }; });
    $("dlRdScan").onclick = function () {
      var out = $("dlRdSec"); out.innerHTML = C.skel(2);
      security(p.net, p.tokAddr).then(function (sec) {
        var v = verdict(sec); ST.lastSec = { pool: p, sec: sec, v: v };
        out.innerHTML = '<div class="sec-verdict ' + v.cls + '"><span class="em">' + v.em + '</span><div><b>' + v.label + '</b><span>' + esc(sec.name || p.sym) + " · risk " + v.risk + '/100 · pattern-based</span></div></div><div class="sec-grid">' + sec.flags.map(function (f) { return '<div class="sec-item"><span>' + esc(f.label) + '</span><span class="' + (f.bad ? "bad" : f.k === "holders" ? "neu" : "ok") + '">' + esc(f.txt) + "</span></div>"; }).join("") + '</div><div id="dlRdExplain" style="margin-top:8px"></div>';
        try { window.DEXAI && DEXAI.scan && DEXAI.scan(ST.lastSec, $("dlRdExplain")); } catch (e) {}
      }).catch(function (e) { out.innerHTML = '<div class="dl-empty">' + esc(e.message || e) + "</div>"; });
    };
    wireSandbox(body, p);
  }
  function sandboxHTML(p) {
    var B = X() || { cash: 0, pos: [] }, pos = B.pos.filter(function (x) { return x.id === p.id; })[0];
    return '<div class="dl154" id="dlRdSand"><div class="h">🧪 Practise this pool ' + C.simTag() + '<span class="sp"></span><span style="font:600 11.5px var(--ui-sans,sans-serif);color:var(--muted)">pool book <b id="dlRdCash">' + C.money(B.cash, 2) + "</b> paper USDT</span></div>" +
      '<div class="dl-2"><div><div style="display:flex;gap:6px;margin-bottom:6px"><input class="dl-inp" id="dlRdAmt" type="number" min="1" step="1" value="100" placeholder="USDT"><button class="dl-b pri" id="dlRdBuy">Buy</button></div><div id="dlRdQuote" class="dl-formula" style="margin:0">Enter an amount — the quote shows AMM slippage from this pool’s real liquidity.</div></div>' +
      '<div>' + (pos ? '<div class="kv"><span>Position</span><b id="dlRdPosQ">' + pos.qty.toFixed(4) + " " + esc(p.sym) + '</b></div><div class="kv"><span>Avg entry</span><b>' + fmtPx(pos.cost / pos.qty) + '</b></div><div class="kv"><span>Unrealised</span><b id="dlRdUpl">' + uplHTML(pos, p) + '</b></div><div style="display:flex;gap:6px;margin-top:8px"><button class="dl-b" data-sell="0.5">Sell ½</button><button class="dl-b warn" data-sell="1">Sell all</button></div>' : '<div class="dl-empty" style="padding:10px">No position in this pool yet. Buy a little, watch the slippage, sell, then let the Coach read it.</div>') + "</div></div>" +
      '<div class="n">x·y=k constant product on half the pool’s liquidity · LP fee 0.30% · gas $2.20 · marked to the live pool price. Paper only — nothing touches a chain.</div></div>';
  }
  function uplHTML(pos, p) { var q = quote(p, "sell", 0, pos.qty); var pl = q.usd - GAS - pos.cost; return '<span class="' + (pl >= 0 ? "up" : "dn") + '">' + (pl >= 0 ? "+" : "−") + "$" + Math.abs(pl).toFixed(2) + " (" + C.pct(pl / pos.cost * 100, 1) + ")</span>"; }
  function wireSandbox(body, p) {
    var amt = $("dlRdAmt"), qEl = $("dlRdQuote");
    function refreshQ() { var v = +amt.value; if (!(v > 0)) { qEl.textContent = "Enter an amount."; return; } var q = quote(p, "buy", v); qEl.innerHTML = "≈ <b>" + q.qty.toFixed(4) + " " + esc(p.sym) + "</b> at " + fmtPx(q.eff) + " · slippage <b class='" + (q.slip > 2 ? "dn" : "up") + "'>" + q.slip.toFixed(2) + "%</b> · LP fee + gas $" + q.fee.toFixed(2) + (q.slip > 5 ? "<br>⚠ That size is big for this pool — real traders split it." : ""); }
    amt.oninput = refreshQ; refreshQ();
    $("dlRdBuy").onclick = function () { faucet(); if (buy(p, +amt.value)) { var s = $("dlRdSand"); s.outerHTML = sandboxHTML(p); wireSandbox(body, p); } };
    body.querySelectorAll("[data-sell]").forEach(function (b) { b.onclick = function () { if (sell(p, +b.getAttribute("data-sell"))) { var s = $("dlRdSand"); s.outerHTML = sandboxHTML(p); wireSandbox(body, p); } }; });
  }
  function bookView(body) {
    var B = X() || { cash: 0, pos: [], hist: [] };
    body.innerHTML = '<div class="dl154"><div class="h">📒 Pool book ' + C.simTag() + '<span class="sp"></span><b>' + C.money(B.cash, 2) + '</b> paper USDT</div>' + (B.pos.length ? '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Pool</th><th class="r">Qty</th><th class="r">Cost</th><th class="r">Mark</th><th class="r">P&amp;L</th><th></th></tr></thead><tbody id="dlRdBookRows">' + B.pos.map(function (x) { return '<tr data-pos="' + esc(x.id) + '"><td><b>' + esc(x.name) + '</b><br><span style="opacity:.6">' + esc(x.net) + '</span></td><td class="r">' + x.qty.toFixed(4) + '</td><td class="r">' + C.money(x.cost, 2) + '</td><td class="r" data-mark>…</td><td class="r" data-pl>…</td><td><button class="dl-b" data-open="' + esc(x.id) + '">Open</button></td></tr>'; }).join("") + "</tbody></table></div>" : '<div class="dl-empty">No pool positions. Practise one from the radar.</div>') +
      (B.hist.length ? '<div class="h" style="margin-top:12px">Recent pool trades</div>' + B.hist.slice(0, 8).map(function (h) { return '<div class="kv"><span>' + (h.side === "buy" ? "🟢 Buy" : "🔴 Sell") + " " + esc(h.sym) + " · " + C.ago(h.t) + '</span><b>' + C.money(h.usd, 2) + " · slip " + h.slip.toFixed(2) + "%" + (h.pl != null ? ' · <span class="' + (h.pl >= 0 ? "up" : "dn") + '">' + (h.pl >= 0 ? "+" : "−") + "$" + Math.abs(h.pl).toFixed(2) + "</span>" : "") + "</b></div>"; }).join("") : "") + '<div class="n">Marked to the live pool price on open · refreshes each time you look. The Coach reads slippage, sizing and hold-time from this book.</div></div>';
    B.pos.forEach(function (x) { fetchPool(x.net, x.addr).then(function (r) { var tr = body.querySelector('tr[data-pos="' + x.id + '"]'); if (!tr) return; var p = r.pool; tr.querySelector("[data-mark]").textContent = fmtPx(p.price); tr.querySelector("[data-pl]").innerHTML = uplHTML(x, p); tr.__pool = p; }).catch(function () {}); });
    body.querySelectorAll("[data-open]").forEach(function (b) { b.onclick = function () { var id = b.getAttribute("data-open"), tr = body.querySelector('tr[data-pos="' + id + '"]'); var p = tr && tr.__pool; if (p) { ST.sel = p; poolView(body, p); } else { var x = B.pos.filter(function (z) { return z.id === id; })[0]; fetchPool(x.net, x.addr).then(function (r) { ST.sel = r.pool; poolView(body, r.pool); }); } }; });
  }
  function render(tab, body, el) {
    ST.tab = tab;
    if (tab === "book") return bookView(body);
    if (ST.sel && ST.selTab === tab) return poolView(body, ST.sel);
    ST.sel = null; listView(body);
  }
  function open(tab) {
    var el = C.open("dlRadar", { title: "📡 Pool Radar", sub: "GeckoTerminal · GoPlus · keyless · practise before you ape", tabs: [["trend", "Trending"], ["fresh", "Fresh"], ["movers", "Movers"], ["search", "Search"], ["book", "Pool book"]], onTab: render }, tab);
    if (!el.__wired) { el.__wired = 1; el.addEventListener("click", function (e) {
      var body = el.querySelector(".dls-body");
      var n = e.target.closest("[data-net]"); if (n) { ST.net = n.getAttribute("data-net"); return listView(body); }
      var pr = e.target.closest("[data-pre]"); if (pr) { var k = pr.getAttribute("data-pre"); if (k === "liq") ST.preset.liq = ST.preset.liq ? 0 : 5e4; if (k === "age") ST.preset.age = ST.preset.age ? 0 : 36e5; return listView(body); }
      var go = e.target.closest("#dlRdGo"); if (go) { ST.q = ($("dlRdQ") || {}).value || ""; return listView(body); }
      var row = e.target.closest("[data-pool]"); if (row) { var list = ($("dlRdList") || {}).__list || []; var p = list.filter(function (x) { return x.id === row.getAttribute("data-pool"); })[0]; if (p) { ST.sel = p; ST.selTab = el.dataset.tab; poolView(body, p); C.sfx("click"); } }
    }); el.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target && e.target.id === "dlRdQ") { ST.q = e.target.value; listView(el.querySelector(".dls-body")); } }); }
  }
  /* the hub's DEX tab + launcher route here via build patches (radar-launch / radar-hubtab / radar-openhub) */
  C.cmd("pool radar", "Pool Radar — trending & fresh DEX pools, scan, practise", "📡", function () { open("trend"); });
  C.cmd("fresh pools", "Fresh pools — just-created DEX pools, age to the second", "🆕", function () { open("fresh"); });
  return { __v: 154, open: open, quote: quote, buy: buy, sell: sell, security: security, verdict: verdict, book: X, drawCandles: drawCandles, state: ST, nets: NETS };
})();
