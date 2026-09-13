/* ============================================================
   DLWEATHER · v154 — Leverage Weather + Weather composite + Attention
   + Cycle Dials.
   · Leverage Weather desk: real funding, open interest, long/short and
     a live liquidation tape. Ladder: Hyperliquid /info (one POST for
     every perp) → OKX v5 public → Binance Futures public. Liquidations
     stream over Binance's public WebSocket (no CORS on WS), opened
     only while the desk is visible. DVOL from Deribit public.
   · Real funding feeds the DLSIM perps sim (build patch sim-funding).
   · Weather: a 0–100 composite whose formula is printed on the card.
   · Attention: Wikipedia page-view velocity (DLFEEDS.attention).
   · Cycle Dials: Pi-Cycle, Mayer Multiple, Puell from 365 daily closes.
   ============================================================ */
window.DLWEATHER = (function () {
  "use strict";
  if (window.DLWEATHER && window.DLWEATHER.__v) return window.DLWEATHER;
  var C = window.DLCORE, $ = C.$, esc = C.esc;
  var CGB = (function () { try { return typeof CG === "string" ? CG : "https://api.coingecko.com/api/v3"; } catch (e) { return "https://api.coingecko.com/api/v3"; } })();
  var D = { perps: null, at: 0, src: null, stale: false, ls: null, dvol: null, liq: [], liqSum: { long: 0, short: 0 }, ws: null };

  /* ---------------------------------------------------------- perps ladder */
  function fromHL() {
    return C.jget("https://api.hyperliquid.xyz/info", { key: "hl.meta", ttl: 6e4, ms: 9000, init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "metaAndAssetCtxs" }) } }).then(function (r) {
      var j = r.data; var uni = j && j[0] && j[0].universe || [], ctx = j && j[1] || [];
      var list = uni.map(function (u, i) { var c = ctx[i] || {}; var mark = +c.markPx || 0; return { sym: u.name, fund8h: (+c.funding || 0) * 8, oiUsd: (+c.openInterest || 0) * mark, mark: mark, vol24: +c.dayNtlVlm || 0, prem: +c.premium || 0, src: "Hyperliquid" }; }).filter(function (x) { return x.mark > 0; });
      if (list.length < 5) throw new Error("thin"); return { list: list, at: r.at, stale: r.stale, src: "Hyperliquid" };
    });
  }
  function fromOKX() {
    return Promise.all([
      C.jget("https://www.okx.com/api/v5/public/open-interest?instType=SWAP", { key: "okx.oi", ttl: 6e4, ms: 9000 }),
      C.jget("https://www.okx.com/api/v5/market/tickers?instType=SWAP", { key: "okx.tick", ttl: 6e4, ms: 9000 })
    ]).then(function (rs) {
      var oi = {}; (rs[0].data.data || []).forEach(function (x) { if (/-USDT-SWAP$/.test(x.instId)) oi[x.instId.split("-")[0]] = +x.oiCcy || 0; });
      var list = (rs[1].data.data || []).filter(function (t) { return /-USDT-SWAP$/.test(t.instId); }).map(function (t) { var s = t.instId.split("-")[0], px = +t.last || 0; return { sym: s, fund8h: null, oiUsd: (oi[s] || 0) * px, mark: px, vol24: (+t.volCcy24h || 0) * px, prem: 0, src: "OKX" }; });
      if (list.length < 5) throw new Error("thin"); return { list: list, at: rs[1].at, stale: rs[1].stale, src: "OKX" };
    }).then(function (r) { /* funding for the majors only (one call each) */
      return Promise.all(["BTC", "ETH", "SOL"].map(function (s) { return C.jget("https://www.okx.com/api/v5/public/funding-rate?instId=" + s + "-USDT-SWAP", { key: "okx.fr." + s, ttl: 3e5, ms: 8000 }).then(function (x) { var d = x.data.data && x.data.data[0]; var it = r.list.filter(function (y) { return y.sym === s; })[0]; if (it && d) it.fund8h = +d.fundingRate; }).catch(function () {}); })).then(function () { return r; });
    });
  }
  function fromBinance() {
    return C.jget("https://fapi.binance.com/fapi/v1/premiumIndex", { key: "bn.prem", ttl: 6e4, ms: 9000 }).then(function (r) {
      var list = (r.data || []).filter(function (x) { return /USDT$/.test(x.symbol); }).map(function (x) { return { sym: x.symbol.replace(/USDT$/, ""), fund8h: +x.lastFundingRate || 0, oiUsd: null, mark: +x.markPrice || 0, vol24: null, prem: 0, src: "Binance" }; });
      if (list.length < 5) throw new Error("thin"); return { list: list, at: r.at, stale: r.stale, src: "Binance Futures" };
    });
  }
  function loadPerps(force) {
    if (!force && D.perps && Date.now() - D.at < 6e4) return Promise.resolve(D);
    return fromHL().catch(fromOKX).catch(fromBinance).then(function (r) {
      D.perps = r.list; D.at = r.at; D.src = r.src; D.stale = r.stale; D.by = {}; r.list.forEach(function (x) { D.by[x.sym] = x; });
      return D;
    });
  }
  function funding8h(sym) { var x = D.by && D.by[String(sym || "").toUpperCase()]; return x && x.fund8h != null && Date.now() - D.at < 36e5 ? x.fund8h : null; }
  function longShort() {
    return C.jget("https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=BTC&period=1H", { key: "okx.ls", ttl: 3e5, ms: 8000 }).then(function (r) { var d = r.data.data && r.data.data[0]; if (!d) throw new Error("no ls"); D.ls = { ratio: +d[1], at: r.at, src: "OKX" }; return D.ls; })
      .catch(function () { return C.jget("https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1", { key: "bn.ls", ttl: 3e5, ms: 8000 }).then(function (r) { var d = r.data && r.data[0]; if (!d) throw new Error("no ls"); D.ls = { ratio: +d.longShortRatio, at: r.at, src: "Binance Futures" }; return D.ls; }); });
  }
  function dvol() {
    var end = Date.now(), start = end - 864e5;
    return C.jget("https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&resolution=3600&start_timestamp=" + start + "&end_timestamp=" + end, { key: "dvol.btc", ttl: 6e5, ms: 8000 }).then(function (r) { var rows = r.data && r.data.result && r.data.result.data || []; var last = rows[rows.length - 1]; if (!last) throw new Error("no dvol"); D.dvol = { v: +last[4], at: r.at, src: "Deribit" }; return D.dvol; });
  }
  /* ---------------------------------------------------------- liquidation tape (WS, only while open) */
  function wsOpen(onEvt) {
    if (D.ws || typeof WebSocket === "undefined") return;
    try {
      var ws = new WebSocket("wss://fstream.binance.com/ws/!forceOrder@arr"); D.ws = ws;
      ws.onmessage = function (m) { try { var j = JSON.parse(m.data), o = j.o || (j.data && j.data.o); if (!o) return; var ev = { sym: String(o.s || "").replace(/USDT$/, ""), side: o.S === "SELL" ? "long" : "short", usd: (+o.q || 0) * (+o.ap || +o.p || 0), px: +o.ap || +o.p || 0, t: +o.T || Date.now() }; if (!(ev.usd > 0)) return; D.liq.unshift(ev); if (D.liq.length > 60) D.liq.pop(); D.liqSum[ev.side] += ev.usd; onEvt && onEvt(ev); } catch (e) {} };
      ws.onerror = function () { D.wsErr = "stream unreachable — if this site's CSP connect-src lacks wss:, the tape cannot open"; }; ws.onclose = function () { if (D.ws === ws) D.ws = null; };
    } catch (e) { D.wsErr = String(e); }
  }
  function wsClose() { try { D.ws && D.ws.close(); } catch (e) {} D.ws = null; }

  /* ---------------------------------------------------------- Weather composite */
  function weather() {
    var parts = [], W = 50, wsum = 0, used = [];
    function add(name, z, w, note) { z = Math.max(-25, Math.min(25, z)); parts.push({ name: name, z: z, w: w, note: note }); W += w * z; wsum += w; used.push(name); }
    try { var cy = window.DLINTEL && DLINTEL.cycle && DLINTEL.cycle(); if (cy && isFinite(cy.breadth)) add("breadth", (cy.breadth - 50), 0.25, cy.breadth + "% of coins up on the day"); } catch (e) {}
    try { var all = C.coinsAll().filter(function (c) { return isFinite(c.c7) && c.sym !== "USDT" && c.sym !== "USDC"; }).sort(function (a, b) { return b.mcap - a.mcap; }).slice(0, 50); if (all.length) { var m = all.reduce(function (s, c) { return s + c.c7; }, 0) / all.length; add("momentum", m * 2.5, 0.25, "top-50 average 7-day move " + C.pct(m, 1)); } } catch (e) {}
    var fs = ["BTC", "ETH", "SOL"].map(funding8h).filter(function (v) { return v != null; }); if (fs.length) { var fb = fs.reduce(function (a, b) { return a + b; }, 0) / fs.length * 1e4; add("funding", fb * 5, 0.2, "avg 8h funding BTC/ETH/SOL " + fb.toFixed(1) + " bp (" + D.src + ")"); }
    if (D.dvol) add("volatility", -(D.dvol.v - 55) * 0.8, 0.15, "Deribit DVOL " + D.dvol.v.toFixed(1) + " (calm markets score higher)");
    try { var g = typeof G !== "undefined" ? G : null; if (g && g.fng != null) add("fear & greed", (g.fng - 50), 0.15, "alternative.me " + g.fng); } catch (e) {}
    if (wsum > 0 && wsum < 1) { W = 50 + (W - 50) / wsum; } /* renormalise when inputs are missing */
    W = Math.max(0, Math.min(100, W));
    var label = W >= 75 ? "Sunny · greedy" : W >= 55 ? "Fair" : W >= 45 ? "Overcast" : W >= 25 ? "Stormy" : "Blizzard · fearful";
    return { w: W, label: label, parts: parts, missing: ["breadth", "momentum", "funding", "volatility", "fear & greed"].filter(function (n) { return used.indexOf(n) < 0; }) };
  }

  /* ---------------------------------------------------------- Cycle dials (BTC) */
  function cycle() {
    return C.jget(CGB + "/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily", { key: "cg.btc.365", ttl: 36e5, ms: 12000 }).then(function (r) {
      var px = (r.data.prices || []).map(function (p) { return +p[1]; }); if (px.length < 200) throw new Error("thin history");
      var last = px[px.length - 1], ma111 = C.sma(px, 111), ma350x2 = px.length >= 350 ? C.sma(px, 350) * 2 : null, ma200 = C.sma(px, 200);
      var issuancePerDay = 3.125 * 144; /* post-April-2024 halving */
      var usdIss = px.map(function (p) { return p * issuancePerDay; }), puell = usdIss[usdIss.length - 1] / (usdIss.reduce(function (a, b) { return a + b; }, 0) / usdIss.length);
      return { at: r.at, stale: r.stale, last: last, ma111: ma111, ma350x2: ma350x2, mayer: ma200 ? last / ma200 : null, puell: puell, n: px.length,
        pi: ma350x2 ? (ma111 >= ma350x2 ? "crossed — historically a top signal" : ((1 - ma111 / ma350x2) * 100).toFixed(0) + "% below the cross") : "needs 350 days of history (public plan gives 365 max)" };
    });
  }

  /* ---------------------------------------------------------- UI: desk sheet */
  function fmtF(f) { if (f == null) return "—"; var bp = f * 1e4; return '<span class="' + (bp > 3 ? "dn" : bp < -1 ? "up" : "") + '">' + (bp >= 0 ? "+" : "") + bp.toFixed(2) + " bp</span>"; }
  function deskHTML(d) {
    var top = d.perps.slice().sort(function (a, b) { return (b.oiUsd || 0) - (a.oiUsd || 0); }).slice(0, 40);
    var ladder = new Set(C.coinsAll().map(function (c) { return c.sym; }));
    var oiTot = d.perps.reduce(function (s, x) { return s + (x.oiUsd || 0); }, 0);
    var fs = d.perps.filter(function (x) { return x.fund8h != null; }), pos = fs.filter(function (x) { return x.fund8h > 0; }).length;
    return '<div class="dl-2"><div class="dl154"><div class="h">Open interest <span class="sp"></span>' + C.prov(d.src, d.at, d.stale) + '</div><div style="font:800 26px var(--cmc-sans,sans-serif)">' + (oiTot ? C.big(oiTot) : "—") + '</div><div class="n">Notional across ' + d.perps.length + " perps on " + esc(d.src) + '. One venue, not the whole market — the honest number we can get without a key.</div></div>' +
      '<div class="dl154"><div class="h">Funding skew</div><div style="font:800 26px var(--cmc-sans,sans-serif)">' + (fs.length ? Math.round(100 * pos / fs.length) + "% positive" : "—") + '</div><div class="n">' + (fs.length ? pos + " of " + fs.length + " perps pay longs → shorts. High positive skew = crowded longs." : "Funding not exposed by this venue.") + (D.ls ? " · BTC long/short accounts " + D.ls.ratio.toFixed(2) + " (" + esc(D.ls.src) + ")" : "") + (D.dvol ? " · DVOL " + D.dvol.v.toFixed(1) : "") + "</div></div></div>" +
      '<div class="dl154"><div class="h">🧯 Liquidation tape <span class="sp"></span><span id="dlLqSum" style="font:600 11.5px var(--cmc-sans,sans-serif);color:var(--muted)">connecting…</span></div><div id="dlLqTape" style="max-height:180px;overflow:auto;font:500 12px var(--mono,ui-monospace,monospace)"><div class="dl-empty" style="padding:8px">Waiting for the Binance Futures public stream (opens only while this desk is visible).</div></div></div>' +
      '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Perp</th><th class="r">Mark</th><th class="r">Funding 8h</th><th class="r">Open interest</th><th class="r">24h vol</th><th></th></tr></thead><tbody>' + top.map(function (x) { return '<tr' + (ladder.has(x.sym) ? ' class="click" data-coin="' + esc(x.sym) + '"' : "") + "><td><b>" + esc(x.sym) + '</b></td><td class="r">' + C.money(x.mark) + '</td><td class="r">' + fmtF(x.fund8h) + '</td><td class="r">' + (x.oiUsd ? C.big(x.oiUsd) : "—") + '</td><td class="r">' + (x.vol24 ? C.big(x.vol24) : "—") + '</td><td>' + (ladder.has(x.sym) ? '<button class="dl-b" data-perp="' + esc(x.sym) + '">Practise perp</button>' : "") + "</td></tr>"; }).join("") + "</tbody></table></div>" +
      '<div class="dl-formula">funding 8h = venue hourly rate × 8 (Hyperliquid) or the venue’s 8h rate · the DLSIM perps desk now charges THIS rate instead of a synthetic one when it is fresh (&lt; 1 h)\nliquidations: Binance Futures !forceOrder stream — a SELL order means a long was liquidated\nnot a recommendation; leverage in DexLadder is paper and stays paper</div>';
  }
  function paintTape() {
    var el = $("dlLqTape"), sum = $("dlLqSum"); if (!el) return;
    if (D.liq.length) el.innerHTML = D.liq.slice(0, 40).map(function (e) { return '<div class="kv" style="padding:3px 0"><span>' + (e.side === "long" ? '<span class="dn">long</span>' : '<span class="up">short</span>') + " liquidated · " + esc(e.sym) + '</span><b>' + C.money(e.usd, 0) + " @ " + C.money(e.px) + "</b></div>"; }).join("");
    if (sum) sum.textContent = D.ws ? "live · longs " + C.big(D.liqSum.long) + " · shorts " + C.big(D.liqSum.short) + " this session" : (D.wsErr ? "stream unavailable — " + D.wsErr : "connecting…");
  }
  function render(tab, body, el) {
    if (tab === "weather") return weatherView(body);
    if (tab === "cycle") return cycleView(body);
    body.innerHTML = C.skel(5);
    Promise.all([loadPerps(false), longShort().catch(function () { return null; }), dvol().catch(function () { return null; })]).then(function () {
      body.innerHTML = deskHTML(D); paintTape(); wsOpen(function () { if (el.classList.contains("on") && el.dataset.tab === "perps") paintTape(); });
    }).catch(function (e) { body.innerHTML = '<div class="dl-empty">No perp venue reachable right now — ' + esc(e.message || e) + '. The desk retries when you reopen it.</div>'; });
  }
  function weatherView(body) {
    loadPerps(false).catch(function () {}).then(function () { return dvol().catch(function () {}); }).then(function () {
      var w = weather();
      body.innerHTML = '<div class="dl154"><div class="h">🌤 Weather <span class="sp"></span><b style="font-size:22px">' + w.w.toFixed(0) + '</b></div><div class="dl-gauge"><i style="left:' + w.w.toFixed(0) + '%"></i></div><div style="font:700 14px var(--cmc-sans,sans-serif);margin:6px 0">' + esc(w.label) + "</div>" +
        w.parts.map(function (p) { return '<div class="kv"><span>' + esc(p.name) + ' <span style="opacity:.6">' + esc(p.note) + '</span></span><b>' + (p.z >= 0 ? "+" : "") + (p.w * p.z).toFixed(1) + "</b></div>"; }).join("") +
        (w.missing.length ? '<div class="n">Unavailable right now: ' + esc(w.missing.join(", ")) + " — weights renormalised over what we have.</div>" : "") +
        '<div class="dl-formula">Weather = 50 + 0.25·(breadth−50) + 0.25·clamp(2.5·mom7) + 0.20·clamp(5·funding_bp) − 0.15·clamp(0.8·(DVOL−55)) + 0.15·(F&amp;G−50), each term clamped to ±25, result clamped to 0–100\nThis is a printed formula over live inputs, not a proprietary index. Change nothing about your book because of it.</div></div>';
    });
  }
  function cycleView(body) {
    body.innerHTML = C.skel(3);
    cycle().then(function (c) {
      body.innerHTML = '<div class="dl-2">' +
        '<div class="dl154"><div class="h">Pi-Cycle top</div><div style="font:800 20px var(--cmc-sans,sans-serif)">' + esc(c.pi) + '</div><div class="n">111-day SMA ' + C.money(c.ma111, 0) + (c.ma350x2 ? " vs 2×350-day SMA " + C.money(c.ma350x2, 0) : "") + ". A cross has marked cycle tops in the past; the past is not a promise.</div></div>" +
        '<div class="dl154"><div class="h">Mayer Multiple</div><div style="font:800 20px var(--cmc-sans,sans-serif)">' + (c.mayer ? c.mayer.toFixed(2) : "—") + '</div><div class="n">price ÷ 200-day SMA. Historically &lt;0.8 has been "cheap", &gt;2.4 "hot".</div></div>' +
        '<div class="dl154"><div class="h">Puell Multiple</div><div style="font:800 20px var(--cmc-sans,sans-serif)">' + (c.puell ? c.puell.toFixed(2) : "—") + '</div><div class="n">today’s USD issuance (3.125 BTC × 144 blocks) ÷ its 365-day mean — miner-revenue stress vs euphoria.</div></div>' +
        '</div><div class="dl-formula">' + c.n + ' daily closes from CoinGecko (public plan caps history at 365 days, so Pi-Cycle can show today’s status but not its own history) · ' + esc("as of " + C.ago(c.at)) + "</div>";
    }).catch(function (e) { body.innerHTML = '<div class="dl-empty">' + esc(e.message || e) + "</div>"; });
  }
  function open(tab) {
    var el = C.open("dlWeather", { title: "⚡ Leverage Weather", sub: "funding · open interest · liquidations · DVOL — keyless, one venue at a time, labelled", tabs: [["perps", "Perps"], ["weather", "Weather"], ["cycle", "Cycle dials"]], onTab: render }, tab);
    if (!el.__wired) { el.__wired = 1; el.addEventListener("click", function (e) {
      var p = e.target.closest("[data-perp]"); if (p) { C.close("dlWeather"); openCoin(p.getAttribute("data-perp")); setTimeout(function () { try { window.DLSIM && DLSIM.open && DLSIM.open(); } catch (er) {} }, 700); return; }
      var tr = e.target.closest("tr[data-coin]"); if (tr) { C.close("dlWeather"); openCoin(tr.getAttribute("data-coin")); }
    }); }
    var _close = el.querySelector(".dls-x"); if (_close && !_close.__ws) { _close.__ws = 1; _close.addEventListener("click", wsClose); }
  }
  /* ---------------------------------------------------------- Markets card */
  function mount() {
    var host = $("dlCycle") || $("mxMoversHost"); if (!host || $("dlWxCard")) return;
    var box = document.createElement("div"); box.id = "dlWxCard"; box.className = "dl154";
    box.innerHTML = '<div class="h">⚡ Leverage Weather <span class="sp"></span><button data-open="perps">Open desk →</button></div><div id="dlWxBody">' + C.skel(1) + '</div><div class="n" id="dlWxNote">funding · OI · liquidations · Weather composite — every number names its venue</div>';
    host.parentNode.insertBefore(box, host.nextSibling);
    box.addEventListener("click", function (e) { var b = e.target.closest("[data-open]"); if (b) open(b.getAttribute("data-open")); });
    loadPerps(false).then(function (d) {
      var maj = ["BTC", "ETH", "SOL"].map(function (s) { return d.by[s]; }).filter(Boolean), w = weather();
      $("dlWxBody").innerHTML = '<div class="dl-chips" style="margin:0">' + maj.map(function (x) { return '<span class="dl-chip" title="funding 8h">' + esc(x.sym) + " " + fmtF(x.fund8h) + "</span>"; }).join("") + '<button class="dl-chip" data-open="weather" title="' + esc(w.label) + '">🌤 Weather ' + w.w.toFixed(0) + '</button><button class="dl-chip" data-open="cycle">🧭 Cycle dials</button>' + C.prov(d.src, d.at, d.stale, { attr: 'style="align-self:center"' }) + "</div>";
    }).catch(function () { $("dlWxBody").innerHTML = '<div class="dl-empty" style="padding:6px">No perp venue reachable — the card retries on the next visit.</div>'; });
  }
  C.cmd("leverage weather", "Leverage Weather — funding, open interest, liquidation tape", "⚡", function () { open("perps"); });
  C.cmd("weather", "Weather — a printed-formula market composite", "🌤", function () { open("weather"); });
  C.cmd("cycle dials", "Cycle dials — Pi-Cycle, Mayer, Puell from 365 daily closes", "🧭", function () { open("cycle"); });
  C.onPage("markets", mount);
  setTimeout(function () { loadPerps(false).catch(function () {}); }, 4000); /* warm the funding cache for the perps sim */
  return { __v: 154, open: open, load: loadPerps, funding8h: funding8h, weather: weather, cycle: cycle, state: D, wsClose: wsClose };
})();
