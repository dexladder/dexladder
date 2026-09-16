/* ============================================================
   DLODDS · v154 — Odds Desk: live Polymarket odds you can PAPER-TRADE.
   CMC aggregates prediction markets as data; DexLadder turns them into
   practice. Public reads only (Gamma events/markets + CLOB midpoints,
   keyless, documented "does not require authentication"). A separate
   1,000-USDT Odds book: buy YES/NO shares at the live mid plus a
   printed spread/slippage model, settle to $1/$0 on resolution, get a
   Brier score on the probability you paid. Nothing here touches a
   wallet; nothing here is a recommendation.
   ============================================================ */
window.DLODDS = (function () {
  "use strict";
  if (window.DLODDS && window.DLODDS.__v) return window.DLODDS;
  var C = window.DLCORE, $ = C.$, esc = C.esc;
  var GAMMA = "https://gamma-api.polymarket.com", CLOB = "https://clob.polymarket.com";
  var ST = { tab: "crypto", sel: null, mids: {}, midsAt: 0 };
  function X() { var x = C.X(); if (!x) return null; x.odds || (x.odds = { cash: 1000, pos: [], hist: [], settled: 0 }); return x.odds; }
  function parse(s) { try { return typeof s === "string" ? JSON.parse(s) : (s || []); } catch (e) { return []; } }
  function classify(e) {
    var tags = (e.tags || []).map(function (t) { return String(t.label || t.slug || "").toLowerCase(); }).join(" "), t = String(e.title || "").toLowerCase();
    if (/crypto|bitcoin|ethereum|solana|defi|stablecoin/.test(tags) || /bitcoin|btc|\beth\b|ethereum|solana|crypto|dogecoin|xrp|coinbase|binance/.test(t)) return "crypto";
    if (/econom|fed|inflation|rates|macro|finance|business/.test(tags) || /fed |fomc|rate cut|inflation|cpi|recession|tariff|gdp|treasury/.test(t)) return "macro";
    if (/politic|election|geopolit/.test(tags) || /president|election|congress|senate|parliament|minister/.test(t)) return "politics";
    return "other";
  }
  function shapeEvents(list) {
    return (list || []).map(function (e) {
      var ms = (e.markets || []).filter(function (m) { return !m.closed; }).map(function (m) { var o = parse(m.outcomes), p = parse(m.outcomePrices), ids = parse(m.clobTokenIds); return { id: m.id, q: m.question || e.title, outcomes: o, prices: p.map(Number), tokens: ids, yesTok: ids[0], noTok: ids[1], vol: +m.volume || 0, liq: +m.liquidity || +e.liquidity || 0, end: m.endDate || e.endDate }; }).filter(function (m) { return m.yesTok; });
      return { id: e.id, slug: e.slug, title: e.title, end: e.endDate, vol24: +e.volume24hr || 0, vol: +e.volume || 0, liq: +e.liquidity || 0, kind: classify(e), markets: ms };
    }).filter(function (e) { return e.markets.length; });
  }
  function events(force) {
    return C.jget(GAMMA + "/events?closed=false&order=volume24hr&ascending=false&limit=30", { key: "poly.top", ttl: 3e5, ms: 9000, force: force }).then(function (r) { var list = Array.isArray(r.data) ? r.data : (r.data && r.data.data) || []; return { list: shapeEvents(list), at: r.at, stale: r.stale }; });
  }
  function eventBySlug(slug) { return C.jget(GAMMA + "/events?slug=" + encodeURIComponent(slug), { key: "poly.ev." + slug, ttl: 3e5, ms: 9000 }).then(function (r) { var list = Array.isArray(r.data) ? r.data : (r.data && r.data.data) || []; return shapeEvents(list)[0] || null; }); }
  function market(id, force) { return C.jget(GAMMA + "/markets/" + id, { key: "poly.m." + id, ttl: 6e4, ms: 9000, force: force }).then(function (r) { var m = r.data; return { id: m.id, closed: !!m.closed, prices: parse(m.outcomePrices).map(Number), q: m.question, end: m.endDate }; }); }
  function mids(tokens) {
    var need = tokens.filter(function (t) { return t && (ST.mids[t] == null || Date.now() - ST.midsAt > 6e4); });
    if (!need.length) return Promise.resolve(ST.mids);
    return C.jget(CLOB + "/midpoints", { key: "clob.mids." + need.slice(0, 40).join(",").slice(0, 200), ttl: 6e4, ms: 9000, init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(need.slice(0, 200).map(function (t) { return { token_id: t }; })) } }).then(function (r) {
      var d = r.data || {}; Object.keys(d).forEach(function (k) { var v = +(d[k] && d[k].mid != null ? d[k].mid : d[k]); if (isFinite(v)) ST.mids[k] = v; }); ST.midsAt = Date.now(); return ST.mids;
    }).catch(function () { return ST.mids; });
  }
  function midOf(m, side) { var y = ST.mids[m.yesTok]; if (y == null) y = isFinite(m.prices[0]) ? m.prices[0] : 0.5; return side === "yes" ? y : 1 - y; }
  /* ---------------------------------------------------------- paper book */
  function effPrice(m, side, usd, sell) { var mid = midOf(m, side), spread = 0.005, slip = m.liq > 0 ? Math.min(0.08, 0.02 * usd / Math.max(1000, m.liq / 10)) : 0.01; return Math.max(0.01, Math.min(0.99, sell ? mid - spread - slip : mid + spread + slip)); }
  function buy(ev, m, side, usd) {
    var B = X(); if (!B) return null; usd = +usd; if (!(usd >= 1)) return null; if (usd > B.cash + 1e-9) { C.toast("bad", "Not enough paper USDT in the Odds book", "You have " + C.money(B.cash, 2)); return null; }
    var px = effPrice(m, side, usd, false), sh = usd / px; B.cash -= usd;
    var p = B.pos.filter(function (x) { return x.mid === m.id && x.side === side; })[0];
    if (p) { p.shares += sh; p.cost += usd; } else B.pos.push({ mid: m.id, tok: side === "yes" ? m.yesTok : m.noTok, side: side, shares: sh, cost: usd, q: m.q, slug: ev.slug, end: m.end, t: Date.now(), yesTok: m.yesTok, noTok: m.noTok, liq: m.liq });
    B.hist.unshift({ t: Date.now(), act: "buy", side: side, usd: usd, px: px, q: m.q }); if (B.hist.length > 60) B.hist.pop();
    C.save(); C.sfx("buy"); C.toast("good", "Odds position opened" + C.simTag(), sh.toFixed(1) + " " + side.toUpperCase() + " shares at " + (px * 100).toFixed(1) + "¢ · pays $1 each if " + side.toUpperCase() + " resolves");
    C.xp("odds.first", 15, "First odds contract practised — probability has a price");
    try { window.DEXAI && DEXAI.event && DEXAI.event("odds.buy", { m: m, side: side, usd: usd, px: px }); } catch (e) {}
    return { px: px, shares: sh };
  }
  function sell(pos, frac) {
    var B = X(); if (!B) return null; var m = { yesTok: pos.yesTok, noTok: pos.noTok, prices: [0.5, 0.5], liq: pos.liq || 0 }; var sh = pos.shares * Math.min(1, Math.max(0.01, +frac || 1)); var px = effPrice(m, pos.side, sh * midOf(m, pos.side), true); var usd = sh * px, costPart = pos.cost * sh / pos.shares, pl = usd - costPart;
    B.cash += usd; pos.shares -= sh; pos.cost -= costPart; if (pos.shares <= 1e-6) B.pos = B.pos.filter(function (x) { return x !== pos; });
    B.hist.unshift({ t: Date.now(), act: "sell", side: pos.side, usd: usd, px: px, q: pos.q, pl: pl }); if (B.hist.length > 60) B.hist.pop();
    C.save(); C.sfx("sell"); C.toast(pl >= 0 ? "good" : "bad", "Odds position closed" + C.simTag(), (pl >= 0 ? "+" : "−") + "$" + Math.abs(pl).toFixed(2) + " at " + (px * 100).toFixed(1) + "¢");
    return pl;
  }
  function settle(force) {
    var B = X(); if (!B || !B.pos.length) return Promise.resolve(0);
    var n = 0;
    return Promise.all(B.pos.slice().map(function (p) { return market(p.mid, force).then(function (m) {
      if (!m.closed || !m.prices.length) return;
      var yesWon = m.prices[0] >= 0.99, noWon = m.prices[1] >= 0.99; if (!yesWon && !noWon) return;
      var win = (p.side === "yes" && yesWon) || (p.side === "no" && noWon), payout = win ? p.shares : 0, pl = payout - p.cost, paid = p.cost / p.shares;
      B.cash += payout; B.pos = B.pos.filter(function (x) { return x !== p; }); B.settled++; n++;
      B.hist.unshift({ t: Date.now(), act: "settle", side: p.side, usd: payout, px: win ? 1 : 0, q: p.q, pl: pl, brier: C.brier(paid, win) }); if (B.hist.length > 60) B.hist.pop();
      C.toast(win ? "good" : "bad", "Odds market resolved" + C.simTag(), (win ? "Paid $1/share · " : "Expired worthless · ") + (pl >= 0 ? "+" : "−") + "$" + Math.abs(pl).toFixed(2) + " · you paid " + (paid * 100).toFixed(0) + "¢ for a " + (win ? "win" : "loss"));
    }).catch(function () {}); })).then(function () { if (n) { C.save(); C.xp("odds.settled", 25, "First odds contract settled — the market graded you"); } return n; });
  }
  function faucet() { var B = X(); if (B && B.cash < 1 && !B.pos.length) { B.cash = 1000; C.save(); C.toast("good", "Odds book refilled", "1,000 paper USDT"); } }
  function brierBook() { var B = X(); var s = (B && B.hist || []).filter(function (h) { return h.act === "settle" && h.brier != null; }); return s.length ? { n: s.length, brier: s.reduce(function (a, h) { return a + h.brier; }, 0) / s.length } : null; }
  /* ---------------------------------------------------------- UI */
  function pc(v) { return (v * 100).toFixed(0) + "¢"; }
  function eventRow(e) {
    var m = e.markets[0]; var y = midOf(m, "yes");
    return '<div class="dl-row click" data-ev="' + esc(e.slug) + '" style="cursor:pointer"><div class="nm"><b>' + esc(e.title) + "</b><span>" + e.markets.length + (e.markets.length > 1 ? " outcomes" : " market") + " · vol " + C.big(e.vol) + " · resolves " + C.until(Date.parse(e.end)) + '</span></div><div class="rt"><span style="font-size:16px;font-weight:800" class="' + (y >= 0.5 ? "up" : "dn") + '">' + pc(y) + '</span><br><span style="font-size:10.5px;opacity:.7">YES mid</span></div></div>';
  }
  function listView(body, kind) {
    body.innerHTML = C.skel(6);
    events(false).then(function (r) {
      var list = r.list.filter(function (e) { return kind === "soon" ? true : e.kind === kind; });
      if (kind === "soon") list = list.slice().sort(function (a, b) { return Date.parse(a.end) - Date.parse(b.end); });
      list = list.slice(0, 30);
      return mids(list.map(function (e) { return e.markets[0].yesTok; })).then(function () {
        body.innerHTML = '<div class="dl-note" style="margin:0 0 10px">Live Polymarket mids · public API · paper only. Buy YES or NO shares in the Odds book; each pays $1 if it resolves your way. ' + C.prov("Polymarket", r.at, r.stale) + "</div>" + (list.length ? list.map(eventRow).join("") : '<div class="dl-empty">No open markets in this lane right now.</div>') + primer();
      });
    }).catch(function (e) { body.innerHTML = '<div class="dl-empty">Polymarket unreachable — ' + esc(e.message || e) + "</div>"; });
  }
  function primer() { return '<details class="dl154" style="margin-top:12px"><summary style="cursor:pointer;font:700 13px var(--ui-sans,sans-serif)">📘 Two-minute primer: what a 41¢ YES actually means</summary><div class="n" style="font-size:12px;line-height:1.5">A YES share pays $1 if the event happens and $0 if not. A 41¢ price is the market saying "41% likely". If you think it is 60% likely, YES at 41¢ has positive expected value: 0.60 × $1 − $0.41 = +19¢ per share — <i>if</i> your 60% is honest. That is why the Odds book grades you with a Brier score on the probability you paid, not on whether you won. Buying NO at 59¢ is the mirror bet. Spread and slippage are modelled from the market’s liquidity and printed on every ticket.</div></details>'; }
  function marketView(body, ev) {
    mids(ev.markets.map(function (m) { return m.yesTok; })).then(function () {
      body.innerHTML = '<button class="dl-b" id="dlOdBack">← Back</button><div class="dl154" style="margin-top:10px"><div class="h">' + esc(ev.title) + '<span class="sp"></span><span class="dl-prov recent">Polymarket · resolves ' + C.until(Date.parse(ev.end)) + "</span></div>" +
        ev.markets.slice(0, 12).map(function (m, i) { var y = midOf(m, "yes"); return '<div class="dl154" style="margin:8px 0"><div class="kv" style="border:0"><span><b>' + esc(m.q) + '</b><br><span style="opacity:.7">vol ' + C.big(m.vol) + " · liquidity " + C.big(m.liq) + '</span></span><b style="font-size:18px" class="' + (y >= 0.5 ? "up" : "dn") + '">YES ' + pc(y) + " · NO " + pc(1 - y) + '</b></div><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px"><input class="dl-inp" data-amt="' + i + '" type="number" min="1" step="1" value="50" style="width:110px"><button class="dl-b pri" data-buy="yes" data-i="' + i + '">Buy YES</button><button class="dl-b" data-buy="no" data-i="' + i + '">Buy NO</button><span class="dl-note" style="margin:0" data-q="' + i + '">$50 → ' + quoteTxt(m, "yes", 50) + "</span></div></div>"; }).join("") +
        '<div class="dl-formula">fill = mid ± 0.5¢ spread ± slippage (2% of order per $' + "" + '(liquidity/10) up to 8¢) · payout $1/share on resolution · Odds book is paper — ' + C.money((X() || {}).cash || 0, 2) + " USDT available</div></div>" + primer();
      $("dlOdBack").onclick = function () { ST.sel = null; listView(body, ST.tab); };
      body.querySelectorAll("[data-amt]").forEach(function (inp) { inp.oninput = function () { var i = +inp.getAttribute("data-amt"), m = ev.markets[i]; var q = body.querySelector('[data-q="' + i + '"]'); if (q) q.textContent = "$" + inp.value + " → " + quoteTxt(m, "yes", +inp.value); }; });
      body.querySelectorAll("[data-buy]").forEach(function (b) { b.onclick = function () { var i = +b.getAttribute("data-i"), m = ev.markets[i], usd = +(body.querySelector('[data-amt="' + i + '"]') || {}).value; faucet(); if (buy(ev, m, b.getAttribute("data-buy"), usd)) marketView(body, ev); }; });
    });
  }
  function quoteTxt(m, side, usd) { var px = effPrice(m, side, usd, false); return (usd / px).toFixed(1) + " " + side.toUpperCase() + " @ " + pc(px) + " · max payout $" + (usd / px).toFixed(2); }
  function bookView(body) {
    var B = X() || { cash: 0, pos: [], hist: [] }; body.innerHTML = C.skel(3);
    settle().then(function () { return mids(B.pos.map(function (p) { return p.yesTok; })); }).then(function () {
      var bb = brierBook();
      body.innerHTML = '<div class="dl154"><div class="h">🎲 Odds book ' + C.simTag() + '<span class="sp"></span><b>' + C.money(B.cash, 2) + '</b> paper USDT</div>' +
        (B.pos.length ? '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Market</th><th>Side</th><th class="r">Shares</th><th class="r">Paid</th><th class="r">Mid now</th><th class="r">Mark P&amp;L</th><th></th></tr></thead><tbody>' + B.pos.map(function (p, i) { var m = { yesTok: p.yesTok, noTok: p.noTok, prices: [0.5, 0.5] }; var mid = midOf(m, p.side), mark = p.shares * mid, pl = mark - p.cost; return '<tr><td style="white-space:normal;max-width:320px">' + esc(p.q) + "<br><span style='opacity:.6'>resolves " + C.until(Date.parse(p.end)) + '</span></td><td><b class="' + (p.side === "yes" ? "up" : "dn") + '">' + p.side.toUpperCase() + '</b></td><td class="r">' + p.shares.toFixed(1) + '</td><td class="r">' + pc(p.cost / p.shares) + '</td><td class="r">' + pc(mid) + '</td><td class="r ' + (pl >= 0 ? "up" : "dn") + '">' + (pl >= 0 ? "+" : "−") + "$" + Math.abs(pl).toFixed(2) + '</td><td><button class="dl-b" data-close="' + i + '">Close</button></td></tr>'; }).join("") + "</tbody></table></div>" : '<div class="dl-empty">No open odds positions.</div>') +
        (bb ? '<div class="kv" style="margin-top:10px"><span>Your odds Brier over ' + bb.n + " settled</span><b>" + bb.brier.toFixed(3) + " (0.25 = coin flip)</b></div>" : "") +
        (B.hist.length ? '<div class="h" style="margin-top:12px">Recent</div>' + B.hist.slice(0, 8).map(function (h) { return '<div class="kv"><span>' + (h.act === "buy" ? "🟢 Buy " : h.act === "sell" ? "🔴 Close " : "🏁 Settled ") + h.side.toUpperCase() + " · " + esc(String(h.q || "").slice(0, 60)) + '</span><b>' + C.money(h.usd, 2) + (h.pl != null ? ' · <span class="' + (h.pl >= 0 ? "up" : "dn") + '">' + (h.pl >= 0 ? "+" : "−") + "$" + Math.abs(h.pl).toFixed(2) + "</span>" : " @ " + pc(h.px)) + "</b></div>"; }).join("") : "") +
        '<div class="n">Positions are marked at the live YES/NO mid; resolution is checked from Polymarket’s public market data each time you open this book. The Coach reads the Brier score here.</div></div>';
      body.querySelectorAll("[data-close]").forEach(function (b) { b.onclick = function () { var p = B.pos[+b.getAttribute("data-close")]; if (p) { sell(p, 1); bookView(body); } }; });
    });
  }
  function render(tab, body, el) { ST.tab = tab; if (tab === "book") return bookView(body); if (ST.sel) return marketView(body, ST.sel); listView(body, tab); }
  function open(tab, slug) {
    var el = C.open("dlOdds", { title: "🎲 Odds Desk", sub: "live Polymarket odds · paper-traded · graded on the probability you paid", tabs: [["crypto", "Crypto"], ["macro", "Macro"], ["politics", "Politics"], ["soon", "Resolving soon"], ["book", "Odds book"]], onTab: render }, tab || "crypto");
    if (!el.__wired) { el.__wired = 1; el.addEventListener("click", function (e) { var r = e.target.closest("[data-ev]"); if (r) { var slug = r.getAttribute("data-ev"); var body = el.querySelector(".dls-body"); body.innerHTML = C.skel(3); eventBySlug(slug).then(function (ev) { if (ev) { ST.sel = ev; marketView(body, ev); } else listView(body, ST.tab); }); } }); }
    if (slug) { var body = el.querySelector(".dls-body"); body.innerHTML = C.skel(3); eventBySlug(slug).then(function (ev) { if (ev) { ST.sel = ev; marketView(body, ev); } }); }
  }
  function mount() {
    var host = $("dlClockCard") || $("dlWxCard") || $("mxMoversHost"); if (!host || $("dlOddsCard")) return;
    var box = document.createElement("div"); box.id = "dlOddsCard"; box.className = "dl154";
    box.innerHTML = '<div class="h">🎲 Odds Desk ' + C.simTag() + '<span class="sp"></span><button data-open="crypto">Open desk →</button></div><div id="dlOddsBody">' + C.skel(2) + '</div><div class="n">live Polymarket odds · paper-traded · you are graded on the probability you paid</div>';
    host.parentNode.insertBefore(box, host.nextSibling);
    box.addEventListener("click", function (e) { var b = e.target.closest("[data-open]"); if (b) return open(b.getAttribute("data-open")); var r = e.target.closest("[data-ev]"); if (r) open("crypto", r.getAttribute("data-ev")); });
    events(false).then(function (r) { var list = r.list.filter(function (e) { return e.kind === "crypto"; }).slice(0, 3); return mids(list.map(function (e) { return e.markets[0].yesTok; })).then(function () { var b = $("dlOddsBody"); if (b) b.innerHTML = list.length ? list.map(eventRow).join("") : '<div class="dl-empty" style="padding:6px">No open crypto markets right now.</div>'; }); }).catch(function () { var b = $("dlOddsBody"); if (b) b.innerHTML = '<div class="dl-empty" style="padding:6px">Polymarket unreachable — retries on the next visit.</div>'; });
  }
  C.cmd("odds", "Odds Desk — paper-trade live prediction-market odds", "🎲", function () { open("crypto"); });
  C.onPage("markets", mount);
  C.onTick(function (n) { if (n % 400 === 0) settle().catch(function () {}); });
  return { __v: 154, open: open, events: events, buy: buy, sell: sell, settle: settle, book: X, mid: midOf, brier: brierBook, quote: effPrice };
})();
