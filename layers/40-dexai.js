/* ============================================================
   DEXAI · v154 — DeXaI, the sovereign copilot
   Laws it is built on:
   · Numeric-slot law: DeXaI never types a number. Every figure it shows
     is a fact pulled by a named tool, rendered as a slot with its source
     and freshness. Prose from a language model may only reference facts
     by {{slot}}; any bare numeral it invents is struck out, not shown.
   · Tools before words: coin, market, news, book, journal, forecast,
     weather, sectors, odds, learn (KB + Academy), calc, security, pool,
     supply — all on-device readers of what the app already knows.
   · Actions need a tap: alerts, rungs, forecasts, paper orders are
     compiled and previewed; nothing changes your book until you confirm.
   · Privacy is a setting, default Device-only: the on-device composer
     always works; Chrome's built-in model (Prompt API) is used when the
     browser has it; a gateway you host is optional (URL pasted by you).
   · Memory is a window you control (0–180 days), on this device, in the
     same payload as everything else, and "forget" means forget.
   Surfaces: Read (coin page) · Market read · Desk (chat) · Coach ·
   Tutor (Academy) · Scan (Pool Radar) · Lens (NL screens) · Sentinel
   front (NL alerts) · Brief (Daily Bridge).
   ============================================================ */
window.DEXAI = (function () {
  "use strict";
  if (window.DEXAI && window.DEXAI.__v) return window.DEXAI;
  var C = window.DLCORE, $ = C.$, esc = C.esc;
  var VER = "DeXaI 1.0 · v154";
  var PRIV = { device: "Device-only", hybrid: "Hybrid", cloud: "Cloud" }, MODES = { quick: "Quick", deep: "Deep", research: "Research" };

  function X() { var x = C.X(); if (!x) return null; if (!x.dexai) x.dexai = { mem: [], win: 30, priv: "device", mode: "quick", gw: "", tags: {}, buys: {}, n: 0, ev: [] }; var d = x.dexai; d.mem || (d.mem = []); d.tags || (d.tags = {}); d.buys || (d.buys = {}); d.ev || (d.ev = []); return d; }
  function cfg() { return X() || { mem: [], win: 30, priv: "device", mode: "quick", gw: "", tags: {}, buys: {}, n: 0, ev: [] }; }
  function strip(h) { return String(h == null ? "" : h).replace(/<[^>]+>/g, ""); }
  function feedAt() { try { var s = window.DLBX && DLBX.status && DLBX.status(); return s && s.at || Date.now(); } catch (e) { return Date.now(); } }
  function symIn(q) {
    var words = String(q || "").replace(/[^\w$ ]/g, " ").split(/\s+/).filter(Boolean), all = C.coinsAll(), hit = null;
    for (var i = 0; i < words.length && !hit; i++) { var w = words[i].replace(/^\$/, "").toUpperCase(); if (w.length < 2 || w.length > 6) continue; if (/^(THE|AND|FOR|MY|ME|ON|IN|OF|TO|IS|IT|AT|BY|VS|OR|NOT|ALL|TOP|NEW|NOW|DAY|ONE|CAP|USD|INR|EUR|RSI|ATH|AI|DEX|DO|CAN|HOW|WHY|WHAT|WHO|SET|ADD|BUY|SELL|LONG|SHORT|ODDS|POOL|SCAN|READ|NEWS|MOVE|MOVES|UP|DOWN|OVER|LOW|HIGH|MORE|LESS|THAN|PER|WEEK|HOUR|OPEN|GO|SEE|SHOW|LIST|COINS|COIN|ALERT|WHEN|IF|ABOVE|BELOW|UNDER|FROM|WITH|INTO|WILL|ARE|WAS|BE|AM|LIKE|ABOUT|TELL|GIVE|ALSO|JUST|SOME|ANY|BEST|GOOD|BAD|SAFE|RUG|STOP|LOSS|TAKE|PROFIT|LAST|NEXT|THIS|THAT|BOOK|DESK|LENS|LEARN|QUIZ|HELP|MARKET|MARKETS|STATE|BTC$|ETH$)$/.test(w) && !C.coin(w)) continue; if (C.coin(w)) hit = w; }
    if (!hit) { var ql = String(q || "").toLowerCase(); for (var j = 0; j < all.length && !hit; j++) { var n = String(all[j].name || "").toLowerCase(); if (n.length > 2 && new RegExp("\\b" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(ql)) hit = all[j].sym; } }
    return hit;
  }

  /* ---------------------------------------------------------- facts (the numeric-slot law) */
  function Facts() { this.f = {}; this.ids = []; this.tools = []; this.srcs = {}; }
  Facts.prototype.add = function (id, label, txt, src, at, val) {
    at = at || Date.now(); this.f[id] = { id: id, label: label, txt: txt, src: src || "on-device", at: at, val: val };
    if (this.ids.indexOf(id) < 0) this.ids.push(id);
    var s = src || "on-device"; if (!this.srcs[s] || at < this.srcs[s]) this.srcs[s] = at;
    return this.slot(id);
  };
  Facts.prototype.tool = function (n) { if (this.tools.indexOf(n) < 0) this.tools.push(n); };
  Facts.prototype.slot = function (id) { var f = this.f[id]; if (!f) return '<s class="dx-unsrc" title="no such fact">' + esc(id) + "</s>"; return '<b class="dx-slot" data-f="' + esc(id) + '" title="' + esc(f.label + " · " + f.src + " · " + C.ago(f.at)) + '">' + f.txt + "</b>"; };
  Facts.prototype.sheet = function () { var self = this; return this.ids.map(function (id) { var f = self.f[id]; return id + ": " + f.label + " = " + strip(f.txt) + " [" + f.src + "]"; }).join("\n"); };
  Facts.prototype.foot = function (prov, extra, compact) {
    var self = this, srcs = Object.keys(this.srcs).filter(function (s) { return s !== "on-device"; }).map(function (s) { return esc(s.replace(/ \(.*\)$/, "")) + " " + C.ago(self.srcs[s]); });
    var tools = compact ? '<span class="dx-tool" title="' + esc(this.tools.join(", ")) + '">' + this.tools.length + " tool" + (this.tools.length === 1 ? "" : "s") + "</span>" : this.tools.map(function (t) { return '<span class="dx-tool">' + esc(t) + "</span>"; }).join("");
    return '<div class="dx-foot">' + tools + (srcs.length ? " " + srcs.slice(0, compact ? 4 : 8).join(" · ") : "") + " · " + esc(prov || "on-device composer") + (extra ? " · " + extra : "") + " · a read, not advice</div>";
  };
  /* model prose → html: slots substituted, bare numerals struck */
  function renderProse(text, F) {
    var out = [], unsrc = 0;
    var parts = String(text || "").split(/(\{\{\s*[\w.\-]+\s*\}\})/g);
    parts.forEach(function (p) {
      var m = p.match(/^\{\{\s*([\w.\-]+)\s*\}\}$/);
      if (m) { out.push(F.slot(m[1])); return; }
      out.push(esc(p).replace(/(^|[^\d,.\w])(\$?\d[\d,]*(?:\.\d+)?%?)(?![\d,.]|[hdwmx]\b|-?[a-z])/gi, function (m0, pre, n) { unsrc++; return pre + '<s class="dx-unsrc" title="number not backed by a tool — struck">' + n + "</s>"; }));
    });
    return { html: '<p class="dx-prose">' + out.join("").replace(/\n{2,}/g, "</p><p class=\"dx-prose\">").replace(/\n/g, "<br>") + "</p>", unsrc: unsrc };
  }

  /* ---------------------------------------------------------- tools */
  var T = {};
  function rsiLbl(r) { return r == null ? "no RSI yet" : r >= 70 ? "overbought" : r >= 55 ? "firm" : r > 45 ? "neutral" : r > 30 ? "soft" : "oversold"; }
  function fundLbl(f) { var bp = f * 1e4; return Math.abs(bp) < 1 ? "flat — nobody is paying to be positioned" : bp >= 3 ? "crowded longs paying up" : bp > 0 ? "longs paying, mild" : bp <= -3 ? "crowded shorts paying up" : "shorts paying, mild"; }
  T.coin = function (F, sym) {
    var c = C.coin(sym); if (!c) return null; var p = c.sym.toLowerCase(), at = feedAt(); F.tool("dex_coin");
    var rsi = C.rsi(c.spark || [], 14), volcap = c.mcap ? c.vol / c.mcap * 100 : null;
    F.add(p + ".price", c.sym + " price", C.money(c.price), "CoinGecko", at, c.price);
    F.add(p + ".c1", "1h change", C.chg(c.c1), "CoinGecko", at, c.c1);
    F.add(p + ".c24", "24h change", C.chg(c.c24), "CoinGecko", at, c.c24);
    F.add(p + ".c7", "7d change", C.chg(c.c7), "CoinGecko", at, c.c7);
    F.add(p + ".mcap", "market cap", "$" + C.big(c.mcap), "CoinGecko", at, c.mcap);
    F.add(p + ".vol", "24h volume", "$" + C.big(c.vol), "CoinGecko", at, c.vol);
    F.add(p + ".rank", "rank", "#" + (c.rank || "—"), "CoinGecko", at, c.rank);
    if (c.athPct != null) F.add(p + ".ath", "distance from ATH", C.pct(c.athPct, 1), "CoinGecko", at, c.athPct);
    if (rsi != null) F.add(p + ".rsi", "RSI-14 (7d tape)", rsi.toFixed(0), "on-device · sparkline", at, rsi);
    if (volcap != null) F.add(p + ".volcap", "volume ÷ market cap", volcap.toFixed(1) + "%", "on-device", at, volcap);
    if (c.supply) F.add(p + ".supply", "circulating supply", C.big(c.supply) + (c.maxSupply ? " of " + C.big(c.maxSupply) + " max" : ""), "CoinGecko", at, c.supply);
    return { c: c, rsi: rsi, volcap: volcap };
  };
  T.weather = function (F, sym) {
    var W = window.DLWEATHER; if (!W) return null; F.tool("dex_weather"); var out = {};
    try { var f = sym ? W.funding8h(sym) : null; if (f != null) { out.fund = f; F.add(sym.toLowerCase() + ".fund", "8h funding", (f * 100).toFixed(4) + "%", (W.state && W.state.src) || "perps", W.state && W.state.at, f); } } catch (e) {}
    try { var w = W.weather(); if (w && w.parts && w.parts.length) { out.w = w; F.add("mkt.weather", "Leverage Weather", Math.round(w.w) + "/100 · " + w.label, "composite (" + w.parts.map(function (p) { return p.name; }).join(", ") + ")", Date.now(), w.w); } } catch (e) {}
    return out;
  };
  T.market = function (F) {
    F.tool("dex_market"); var out = {}, at = feedAt();
    try { if (typeof G !== "undefined") { if (G.mcap) { F.add("mkt.cap", "total crypto market cap", "$" + C.big(G.mcap), "CoinGecko global", at, G.mcap); out.cap = G.mcap; } if (G.dom) { F.add("mkt.dom", "BTC dominance", G.dom.toFixed(1) + "%", "CoinGecko global", at, G.dom); out.dom = G.dom; } if (G.fng != null) { F.add("mkt.fng", "Fear & Greed", G.fng + " · " + (G.fngL || ""), "alternative.me", at, G.fng); out.fng = G.fng; } } } catch (e) {}
    try { var cy = window.DLINTEL && DLINTEL.cycle && DLINTEL.cycle(); if (cy) { out.cy = cy; F.add("mkt.breadth", "breadth (coins up on the day)", cy.breadth + "% · " + cy.breadthLbl, "on-device · 500-coin ladder", at, cy.breadth); F.add("mkt.alt", "alt season index (top-50 beating BTC on 7d)", cy.alt + "% · " + cy.altLbl, "on-device · 500-coin ladder", at, cy.alt); } } catch (e) {}
    var all = C.coinsAll().filter(function (c) { return c.sym !== "USDT" && c.sym !== "USDC" && isFinite(c.c24); });
    if (all.length) { var up = all.slice().sort(function (a, b) { return b.c24 - a.c24; })[0], dn = all.slice().sort(function (a, b) { return a.c24 - b.c24; })[0]; out.up = up; out.dn = dn; F.add("mkt.top", "top gainer 24h", up.sym + " " + C.chg(up.c24), "CoinGecko", at, up.c24); F.add("mkt.bottom", "top loser 24h", dn.sym + " " + C.chg(dn.c24), "CoinGecko", at, dn.c24); }
    var btc = C.coin("BTC"), eth = C.coin("ETH"); if (btc) { F.add("btc.price", "BTC price", C.money(btc.price), "CoinGecko", at, btc.price); F.add("btc.c24", "BTC 24h", C.chg(btc.c24), "CoinGecko", at, btc.c24); } if (eth) { F.add("eth.price", "ETH price", C.money(eth.price), "CoinGecko", at, eth.price); F.add("eth.c24", "ETH 24h", C.chg(eth.c24), "CoinGecko", at, eth.c24); }
    T.weather(F, null);
    return out;
  };
  T.news = function (F, sym, n) {
    F.tool("dex_news"); var list = []; try { list = (typeof newsCache !== "undefined" ? newsCache : []) || []; } catch (e) {}
    var c = sym ? C.coin(sym) : null, re = c ? new RegExp("\\b(" + c.sym + "|" + String(c.name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")\\b", "i") : null;
    var out = list.filter(function (a) { return !re || re.test(a.title + " " + (a.excerpt || "")); }).slice(0, n || 5);
    try { if (window.DLOMNI && DLOMNI.sent && re) { (DLOMNI.sent() || []).forEach(function (s) { if (re.test(s.title || "") && out.length < (n || 5)) out.push({ title: s.title, source: s.source || "wire", link: s.link, t: s.t }); }); } } catch (e) {}
    F.add("news.n", "headlines" + (sym ? " mentioning " + sym : " loaded"), String(out.length), "RSS wire", out[0] ? out[0].t : Date.now(), out.length);
    return out;
  };
  T.book = function (F) {
    F.tool("dex_book"); var out = { cash: 0, val: 0, pos: [] };
    try { out.cash = S.bal.USDT || 0; out.val = typeof portfolioUSD === "function" ? portfolioUSD() : out.cash; Object.keys(S.bal || {}).forEach(function (s) { if (s === "USDT" || !(S.bal[s] > 0)) return; var c = C.coin(s); if (!c) return; var b = S.basis && S.basis[s]; out.pos.push({ sym: s, qty: S.bal[s], val: S.bal[s] * c.price, entry: b && b.qty ? b.costUSD / b.qty : null, pl: b && b.qty ? (c.price - b.costUSD / b.qty) * S.bal[s] : null }); }); out.pos.sort(function (a, b) { return b.val - a.val; }); } catch (e) {}
    F.add("book.value", "paper book value", C.money(out.val, 0), "on-device ledger", Date.now(), out.val);
    F.add("book.cash", "paper USDT free", C.money(out.cash, 0), "on-device ledger", Date.now(), out.cash);
    var start = 10000; try { if (S.startBal) start = S.startBal; } catch (e) {}
    F.add("book.pnl", "book vs starting balance", C.chg((out.val / start - 1) * 100), "on-device ledger", Date.now(), out.val / start - 1);
    try { var st = S.stats || {}; F.add("book.trades", "fills so far", String(st.trades || 0), "on-device ledger", Date.now(), st.trades || 0); F.add("book.realized", "realised P&L", (st.realizedUSD >= 0 ? "+" : "−") + C.money(Math.abs(st.realizedUSD || 0), 0), "on-device ledger", Date.now(), st.realizedUSD || 0); if ((st.wins || 0) + (st.losses || 0)) F.add("book.win", "win rate", Math.round(st.wins / (st.wins + st.losses) * 100) + "%", "on-device ledger", Date.now(), st.wins / (st.wins + st.losses)); } catch (e) {}
    if (out.pos[0]) F.add("book.biggest", "largest position", out.pos[0].sym + " " + C.money(out.pos[0].val, 0) + " (" + Math.round(out.pos[0].val / Math.max(1, out.val) * 100) + "% of book)", "on-device ledger", Date.now(), out.pos[0].val);
    try { var sim = S.dlsim && S.dlsim.perps; if (sim && sim.length) F.add("book.perps", "open paper perps", String(sim.length), "on-device ledger", Date.now(), sim.length); } catch (e) {}
    return out;
  };
  T.forecast = function (F, sym, days) {
    var FC = window.DLFORECAST; if (!FC) return null; var k = FC.cone(sym, days || 7); if (!k) return null; F.tool("dex_forecast");
    F.add(sym.toLowerCase() + ".cone" + k.days, k.days + "d one-sigma range (realised vol)", C.money(k.lo1) + " – " + C.money(k.hi1), "on-device · " + k.n + " hourly returns", Date.now(), k.sdT);
    F.add(sym.toLowerCase() + ".vol", "daily realised vol", (k.sdDay * 100).toFixed(1) + "%", "on-device", Date.now(), k.sdDay);
    return k;
  };
  T.sectors = function (F, sym) {
    var SC = window.DLSECTORS; if (!SC) return null; var L = SC.last(); if (!L || !L.list) return null; F.tool("dex_sectors");
    var top = L.list.slice(0, 3), bot = L.list.slice(-3).reverse();
    F.add("sec.top", "strongest sector 24h", top.map(function (s) { return esc(s.name) + " " + C.chg(s.ch, 1); }).join(", "), L.src, L.at, top[0] && top[0].ch);
    F.add("sec.bottom", "weakest sector 24h", bot.map(function (s) { return esc(s.name) + " " + C.chg(s.ch, 1); }).join(", "), L.src, L.at, bot[0] && bot[0].ch);
    return L;
  };
  T.odds = function (F, q) {
    var O = window.DLODDS; if (!O) return Promise.resolve(null);
    return O.events().then(function (r) { var ql = String(q || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(function (w) { return w.length > 3; }); var hits = r.list.map(function (e) { var s = 0; var t = e.title.toLowerCase(); ql.forEach(function (w) { if (t.indexOf(w) > -1) s++; }); return { e: e, s: s }; }).filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s || b.e.vol24 - a.e.vol24; }).slice(0, 3).map(function (x) { return x.e; }); F.tool("dex_odds"); hits.forEach(function (e, i) { var m = e.markets[0]; var y = O.mid(m, "yes"); F.add("odds." + i, e.title, Math.round(y * 100) + "% yes", "Polymarket", r.at, y); }); return { list: hits, at: r.at }; }).catch(function () { return null; });
  };
  T.learn = function (F, q) {
    var O = window.ORACLE; if (!O) return null; var hits = O.lookup(q); var ch = O.acad(q); F.tool("dex_learn");
    return { kb: hits.length && hits[0].s >= 6 ? hits[0].e : null, acad: ch && ch.s >= 6 ? ch : null, more: hits.slice(1, 3).map(function (h) { return h.e; }) };
  };
  T.calc = function (F, expr) {
    var s = String(expr || "").toLowerCase().replace(/[$,]/g, "").replace(/×/g, "*").replace(/÷/g, "/").replace(/\s+/g, "");
    /* percent forms first: 20%of500 → (20/100*500) ; then bare a% → (a/100) */
    s = s.replace(/(\d+(?:\.\d+)?)%of(\d+(?:\.\d+)?)/g, "($1/100*$2)").replace(/(\d+(?:\.\d+)?)%/g, "($1/100)").replace(/\^/g, "**");
    if (!/^[\d.+\-*/()]+$/.test(s.replace(/\*\*/g, "^").replace(/\^/g, "")) || !/\d/.test(s)) return null; F.tool("dex_calc");
    var tok = s.match(/\d+(?:\.\d+)?|\*\*|[+\-*/()]/g); if (!tok || tok.join("") !== s) return null;
    var pos = 0; function peek() { return tok[pos]; } function next() { return tok[pos++]; }
    function prim() { var t = next(); if (t === "(") { var v = expr_(); if (next() !== ")") throw 0; return v; } if (t === "-") return -prim(); if (t === "+") return prim(); if (!/^\d/.test(t || "")) throw 0; return +t; }
    function pow() { var b = prim(); while (peek() === "**") { next(); b = Math.pow(b, prim()); } return b; }
    function term() { var v = pow(); while (peek() === "*" || peek() === "/") { var op = next(), r = pow(); v = op === "*" ? v * r : v / r; } return v; }
    function expr_() { var v = term(); while (peek() === "+" || peek() === "-") { var op = next(), r = term(); v = op === "+" ? v + r : v - r; } return v; }
    try { var v = expr_(); if (pos !== tok.length || !isFinite(v)) return null; F.add("calc.out", "result of " + expr, v.toLocaleString(undefined, { maximumFractionDigits: 8 }), "on-device arithmetic", Date.now(), v); return v; } catch (e) { return null; }
  };
  T.supply = function (F, sym) { var L = window.DLLEDGERS; if (!L) return null; var d = L.supDrift(sym); if (!d) return null; F.tool("dex_supply"); if (d.d7) F.add(sym.toLowerCase() + ".sup7", "measured 7d supply change", C.chg(d.d7.pct, 3), "on-device daily snapshots (" + d.days + "d)", Date.now(), d.d7.pct); if (d.d30) F.add(sym.toLowerCase() + ".sup30", "measured 30d supply change", C.chg(d.d30.pct, 3), "on-device daily snapshots", Date.now(), d.d30.pct); return d; };
  T.security = function (F, chain, addr) { var R = window.DLRADAR; if (!R) return Promise.resolve(null); F.tool("dex_security"); return R.security(chain, addr).then(function (sec) { var v = R.verdict(sec); F.add("sec.risk", "GoPlus risk score", v.risk + "/100 · " + v.label, "GoPlus", Date.now(), v.risk); return { sec: sec, v: v }; }); };
  T.journal = function (F) { F.tool("dex_journal"); var J = []; try { J = (S.journal || []).slice(); } catch (e) {} return J; };

  /* ---------------------------------------------------------- composers (on-device, deterministic, every number a slot) */
  function readCoin(F, sym, deep) {
    var r = T.coin(F, sym); if (!r) return null; var c = r.c, p = c.sym.toLowerCase(), s = function (id) { return F.slot(id); };
    var w = T.weather(F, c.sym), k = deep ? T.forecast(F, c.sym, 7) : null, sup = deep ? T.supply(F, c.sym) : null, nw = deep ? T.news(F, c.sym, 3) : null;
    var mom = c.c1 > 0 && c.c24 > 0 && c.c7 > 0 ? "all three clocks point up — momentum is broad" : c.c1 < 0 && c.c24 < 0 && c.c7 < 0 ? "all three clocks point down — weakness is sustained" : (c.c24 >= 0) !== (c.c7 >= 0) ? "the day and the week disagree — a mixed tape" : "a mixed tape";
    var lines = [];
    lines.push("<b>" + esc(c.name) + "</b> is at " + s(p + ".price") + ", " + s(p + ".c1") + " on the hour, " + s(p + ".c24") + " on the day and " + s(p + ".c7") + " on the week — " + mom + ".");
    if (r.rsi != null) lines.push("RSI-14 on the 7-day tape reads " + s(p + ".rsi") + " — " + rsiLbl(r.rsi) + (r.rsi >= 70 ? " — stretched; chasing here buys someone else's exit." : r.rsi <= 30 ? " — washed out; oversold can stay oversold, but the asymmetry has shifted." : "."));
    if (c.athPct != null) lines.push("It sits " + s(p + ".ath") + " from its all-time high" + (c.athPct > -8 ? " — late-cycle territory, watch for exhaustion." : c.athPct < -70 ? " — deep-value or broken; the chart decides, not the discount." : "."));
    if (r.volcap != null) lines.push("Volume is " + s(p + ".volcap") + " of market cap" + (r.volcap > 15 ? " — unusually heavy for its size; something is moving it today." : r.volcap < 2 ? " — thin; moves here can be exaggerated." : " — ordinary."));
    if (w && w.fund != null) lines.push("Perp funding is " + s(p + ".fund") + " per 8h — " + fundLbl(w.fund) + ".");
    if (k) lines.push("From realised volatility, a one-sigma 7-day range is " + s(p + ".cone7") + " (daily vol " + s(p + ".vol") + ") — that is the width of normal, not a target.");
    if (sup && sup.d7) lines.push("Measured supply drift: " + s(p + ".sup7") + " over 7 days — dilution you can see, not a schedule you were told.");
    if (nw) lines.push(s("news.n") + " headline" + (nw.length === 1 ? "" : "s") + " in the loaded wire mention it" + (nw.length ? ": " + nw.slice(0, 2).map(function (a) { return "“" + esc(a.title.slice(0, 70)) + "” (" + esc(a.source) + ")"; }).join("; ") : "") + ".");
    var flip = []; if (r.rsi != null) flip.push("RSI crossing " + (r.rsi >= 50 ? "back under 50" : "above 50")); flip.push("a daily close outside the 7-day range"); if (w && w.fund != null) flip.push("funding flipping sign"); flip.push("volume ÷ cap doubling");
    return { html: '<div class="dx-read">' + lines.map(function (l) { return '<p class="why">' + l + "</p>"; }).join("") + '<p class="why"><i>What would change this read:</i> ' + flip.join(", ") + ".</p></div>", c: c, F: F };
  }
  function readMarket(F, deep) {
    var m = T.market(F), s = function (id) { return F.slot(id); }, lines = [];
    var cy = m.cy || {};
    lines.push("Crypto is worth " + (F.f["mkt.cap"] ? s("mkt.cap") : "an unknown total right now") + " with Bitcoin at " + (F.f["btc.price"] ? s("btc.price") + " (" + s("btc.c24") + ")" : "—") + " and dominance " + (F.f["mkt.dom"] ? s("mkt.dom") : "—") + ".");
    if (F.f["mkt.breadth"]) lines.push("Breadth is " + s("mkt.breadth") + " and the alt-season dial reads " + s("mkt.alt") + " — " + (cy.alt >= 75 ? "alts are leading BTC; risk appetite is wide." : cy.alt >= 45 ? "leadership is split between BTC and alts." : "BTC is leading; alts are lagging, which is what caution looks like."));
    if (F.f["mkt.weather"]) lines.push("Leverage Weather is " + s("mkt.weather") + ".");
    if (F.f["mkt.fng"]) lines.push("The crowd's mood gauge sits at " + s("mkt.fng") + ".");
    if (F.f["mkt.top"]) lines.push("Extremes on the day: " + s("mkt.top") + " and " + s("mkt.bottom") + ".");
    if (deep) { var L = T.sectors(F); if (L) lines.push("Sector rotation: strongest " + s("sec.top") + "; weakest " + s("sec.bottom") + "."); }
    lines.push("<i>The regime in one line:</i> " + regimeLine(cy, m));
    return { html: '<div class="dx-read">' + lines.map(function (l) { return '<p class="why">' + l + "</p>"; }).join("") + "</div>", F: F, m: m };
  }
  function regimeLine(cy, m) {
    var b = cy.breadth, a = cy.alt, w = m && m.w ? m.w.w : null;
    if (b == null) return "not enough of the ladder has loaded to call a regime.";
    if (b >= 60 && a >= 60) return "broad risk-on — most coins up and alts outrunning BTC; the time to be careful is when it feels easiest.";
    if (b >= 60) return "BTC-led strength — the tape is green but alts are not confirming yet.";
    if (b <= 40 && a <= 40) return "risk-off — most coins red and BTC holding up best; cash is a position.";
    if (b <= 40) return "broad weakness with alts still chasing — late-stage behaviour; be patient.";
    return "a split tape — no edge in direction today; edge is in selection and sizing.";
  }
  function readBook(F, deep) {
    var b = T.book(F), s = function (id) { return F.slot(id); }, lines = [];
    lines.push("Your paper book is worth " + s("book.value") + " (" + s("book.pnl") + " vs your starting balance), with " + s("book.cash") + " free.");
    if (b.pos.length) lines.push("You hold " + b.pos.length + " position" + (b.pos.length > 1 ? "s" : "") + "; the largest is " + s("book.biggest") + (b.pos[0].val / Math.max(1, b.val) > 0.4 ? " — that is concentration, and it should be a decision, not an accident." : "."));
    else lines.push("No open positions — a flat book is a valid position when the regime is unclear.");
    if (F.f["book.win"]) lines.push("Across " + s("book.trades") + " fills your win rate is " + s("book.win") + " and realised P&L is " + s("book.realized") + " — win rate without average win ÷ average loss says little; Coach has both.");
    if (F.f["book.perps"]) lines.push("You also have " + s("book.perps") + " open on the perps desk — funding is a cost that never sleeps.");
    if (deep) { var cr = coachReport(F); if (cr && cr.n) lines.push("<i>Coach:</i> " + cr.fix); }
    return { html: '<div class="dx-read">' + lines.map(function (l) { return '<p class="why">' + l + "</p>"; }).join("") + (b.pos.length ? '<div class="dl-chips" style="margin:6px 0 0">' + b.pos.slice(0, 8).map(function (p) { return '<span class="dl-chip">' + esc(p.sym) + " " + C.money(p.val, 0) + (p.pl != null ? " " + C.chg(p.pl / Math.max(1e-9, p.val - p.pl) * 100, 1) : "") + "</span>"; }).join("") + "</div>" : "") + "</div>", F: F, b: b };
  }

  /* ---------------------------------------------------------- Coach (journal → tags → one thing to fix) */
  function tagsFor(t) { var d = cfg(); return d.tags[t] || []; }
  function coachReport(F) {
    F = F || new Facts(); var J = T.journal(F); if (!J.length) return { n: 0, fix: "No closed trades yet — the journal starts writing itself on your first sell." };
    var wins = J.filter(function (j) { return j.pl > 0; }), losses = J.filter(function (j) { return j.pl <= 0; });
    var avgW = wins.length ? wins.reduce(function (s, j) { return s + j.plPct; }, 0) / wins.length : 0, avgL = losses.length ? losses.reduce(function (s, j) { return s + j.plPct; }, 0) / losses.length : 0;
    var wr = wins.length / J.length, exp = wr * avgW + (1 - wr) * avgL, holds = J.map(function (j) { return j.hold || 0; }).sort(function (a, b) { return a - b; }), medHold = holds[Math.floor(holds.length / 2)] || 0;
    var tagN = {}; J.forEach(function (j) { tagsFor(j.t).forEach(function (t) { tagN[t] = (tagN[t] || 0) + 1; }); });
    var worst = J.slice().sort(function (a, b) { return a.pl - b.pl; })[0], best = J.slice().sort(function (a, b) { return b.pl - a.pl; })[0];
    F.tool("dex_coach");
    F.add("coach.n", "closed trades in the journal", String(J.length), "on-device journal", Date.now(), J.length);
    F.add("coach.win", "win rate", Math.round(wr * 100) + "%", "on-device journal", Date.now(), wr);
    F.add("coach.avgw", "average win", C.pct(avgW, 1), "on-device journal", Date.now(), avgW);
    F.add("coach.avgl", "average loss", C.pct(avgL, 1), "on-device journal", Date.now(), avgL);
    F.add("coach.exp", "expectancy per trade", C.pct(exp, 2), "on-device journal", Date.now(), exp);
    F.add("coach.hold", "median hold", fmtHold(medHold), "on-device journal", Date.now(), medHold);
    if (worst) F.add("coach.worst", "worst trade", worst.sym + " " + C.pct(worst.plPct, 1) + " (" + fmtHold(worst.hold) + ")", "on-device journal", worst.t, worst.pl);
    if (best) F.add("coach.best", "best trade", best.sym + " " + C.pct(best.plPct, 1) + " (" + fmtHold(best.hold) + ")", "on-device journal", best.t, best.pl);
    var brier = null; try { var cal = window.DLFORECAST && DLFORECAST.calibration(); if (cal && cal.n) { brier = cal.brier; F.add("coach.brier", "forecast Brier (" + cal.n + " scored)", cal.brier.toFixed(3) + " · lower is better", "on-device forecasts", Date.now(), cal.brier); } } catch (e) {}
    var ob = null; try { var bb = window.DLODDS && DLODDS.brier(); if (bb && bb.n) { ob = bb; F.add("coach.obrier", "odds Brier (" + bb.n + " settled)", bb.brier.toFixed(3), "on-device odds book", Date.now(), bb.brier); } } catch (e) {}
    /* the one thing to fix — ranked by damage */
    var fixes = [];
    if (tagN.chase >= 2) fixes.push({ w: tagN.chase * 3, t: "You bought after the hour was already up — " + tagN.chase + " chases. Wait for the pullback or skip the trade; momentum you paid for is momentum you don't own." });
    if (tagN.revenge >= 1) fixes.push({ w: tagN.revenge * 4, t: tagN.revenge + " revenge entr" + (tagN.revenge > 1 ? "ies" : "y") + " within ten minutes of a loss. Loss → walk → then decide. The market will still be there." });
    if (tagN.oversize >= 1) fixes.push({ w: tagN.oversize * 3, t: tagN.oversize + " position" + (tagN.oversize > 1 ? "s" : "") + " above a quarter of the book. Size is the only risk control that works while you sleep." });
    if (tagN.nostop >= 2) fixes.push({ w: tagN.nostop * 2, t: tagN.nostop + " trades held over an hour with no stop. Decide the exit before the entry — the Trade page has SL/TSL." });
    if (losses.length >= 3 && Math.abs(avgL) > avgW * 1.5 && avgW > 0) fixes.push({ w: 5, t: "Your average loss is larger than your average win by a wide margin — you cut winners and let losers run. Reverse it: stops tighter, targets wider." });
    if (medHold && medHold < 30 * 60e3 && J.length >= 5) fixes.push({ w: 2, t: "Median hold is under half an hour — that is fee-farming for the venue. Fewer, longer, better." });
    if (wr > 0.7 && exp < 0) fixes.push({ w: 4, t: "High win rate, negative expectancy — the classic trap: many small wins paying for a few big losses." });
    fixes.sort(function (a, b) { return b.w - a.w; });
    var fix = fixes.length ? fixes[0].t : (exp > 0 ? "Expectancy is positive — protect it: same size, same process, no new heroics." : "Expectancy is negative but the sample is small — keep the journal honest for ten more trades before judging.");
    return { n: J.length, wr: wr, avgW: avgW, avgL: avgL, exp: exp, medHold: medHold, tags: tagN, fix: fix, fixes: fixes, brier: brier, ob: ob, worst: worst, best: best, F: F };
  }
  function fmtHold(ms) { var m = (ms || 0) / 6e4; return m < 1 ? "<1m" : m < 60 ? Math.round(m) + "m" : m < 1440 ? (m / 60).toFixed(1) + "h" : (m / 1440).toFixed(1) + "d"; }
  function coachSheet() {
    C.open("dlCoach", { title: "✦ DeXaI Coach", sub: "your journal, tagged and scored — one thing to fix at a time", tabs: [["review", "Review"], ["tags", "Tags"], ["how", "How it judges"]], onTab: function (t, body) {
      var F = new Facts(), r = coachReport(F), s = function (id) { return F.slot(id); };
      if (t === "how") { body.innerHTML = '<div class="dl154"><div class="h">Tags, written the moment a trade closes</div><div class="kv"><span>chase</span><b>bought while the 1h change was already above +4%</b></div><div class="kv"><span>revenge</span><b>bought within 10 minutes of closing a losing trade</b></div><div class="kv"><span>oversize</span><b>entry cost above 25% of the book value</b></div><div class="kv"><span>no-stop</span><b>held over an hour with no SL/TSL order on that coin</b></div><div class="n">Expectancy = win rate × average win + (1 − win rate) × average loss. Brier scores come from your Forecast and Odds ledgers. Nothing here is uploaded; the journal lives in the same payload as your paper book.</div></div>'; return; }
      if (!r.n) { body.innerHTML = '<div class="dl-empty">' + esc(r.fix) + "</div>"; return; }
      if (t === "tags") { var J = T.journal(F); body.innerHTML = '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Trade</th><th class="r">P&L</th><th class="r">Hold</th><th>Tags</th></tr></thead><tbody>' + J.slice(0, 40).map(function (j) { return "<tr><td><b>" + esc(j.sym) + "</b> " + C.ago(j.t) + '</td><td class="r">' + C.chg(j.plPct, 1) + '</td><td class="r">' + fmtHold(j.hold) + "</td><td>" + (tagsFor(j.t).map(function (x) { return '<span class="dx-tag">' + esc(x) + "</span>"; }).join("") || '<span class="dx-tag ok">clean</span>') + "</td></tr>"; }).join("") + "</tbody></table></div>"; return; }
      body.innerHTML = '<div class="dl154"><div class="h">One thing to fix</div><p class="why" style="font:600 14px var(--ui-sans,sans-serif);color:#eaf2ff;margin:4px 0 8px">' + esc(r.fix) + "</p>" + (r.fixes.length > 1 ? '<div class="n">Next: ' + esc(r.fixes[1].t) + "</div>" : "") + "</div>" +
        '<div class="dl-2"><div class="dl154"><div class="h">Scorecard</div><div class="kv"><span>Closed trades</span><b>' + s("coach.n") + '</b></div><div class="kv"><span>Win rate</span><b>' + s("coach.win") + '</b></div><div class="kv"><span>Avg win / avg loss</span><b>' + s("coach.avgw") + " / " + s("coach.avgl") + '</b></div><div class="kv"><span>Expectancy per trade</span><b>' + s("coach.exp") + '</b></div><div class="kv"><span>Median hold</span><b>' + s("coach.hold") + "</b></div>" + (F.f["coach.brier"] ? '<div class="kv"><span>Forecast calibration</span><b>' + s("coach.brier") + "</b></div>" : "") + (F.f["coach.obrier"] ? '<div class="kv"><span>Odds calibration</span><b>' + s("coach.obrier") + "</b></div>" : "") + '</div><div class="dl154"><div class="h">Habits</div>' + (Object.keys(r.tags).length ? Object.keys(r.tags).map(function (k) { return '<div class="kv"><span>' + esc(k) + "</span><b>" + r.tags[k] + "×</b></div>"; }).join("") : '<div class="dl-empty">No bad habits tagged yet.</div>') + (r.worst ? '<div class="kv"><span>Worst</span><b>' + s("coach.worst") + "</b></div>" : "") + (r.best ? '<div class="kv"><span>Best</span><b>' + s("coach.best") + "</b></div>" : "") + "</div></div>" + F.foot("on-device coach");
    } });
  }
  /* tag trades as they close (execFill wrapper) */
  (function wrapFill() {
    var _ef = window.execFill; if (typeof _ef !== "function" || _ef.__dexai) return;
    var w = function (side, sym, quote, amt, px, label, silent) {
      var d = cfg(), before = null; try { before = (S.journal || []).length; } catch (e) {}
      var lastLoss = d.lastLoss || 0, bookVal = 0; try { bookVal = typeof portfolioUSD === "function" ? portfolioUSD() : 0; } catch (e) {}
      var ok = _ef.apply(this, arguments);
      if (!ok) return ok;
      try {
        var c = C.coin(sym), now = Date.now();
        if (side === "buy") { var tags = []; if (c && c.c1 > 4) tags.push("chase"); if (now - lastLoss < 6e5) tags.push("revenge"); if (bookVal && amt * px * (quote === "USDT" ? 1 : (C.coin(quote) || {}).price || 1) > 0.25 * bookVal) tags.push("oversize"); d.buys[sym] = { t: now, tags: tags, hadStop: false }; }
        else {
          var j = S.journal && S.journal[0]; if (j && (S.journal.length !== before || j.t >= now - 50)) {
            var b = d.buys[sym] || { tags: [] }, tags2 = b.tags.slice(); var hasStop = (S.orders || []).some(function (o) { return o.sym === sym && (o.type === "sl" || o.type === "tsl"); }) || label === "sl" || label === "tsl" || b.hadStop;
            if (!hasStop && j.hold > 36e5) tags2.push("nostop"); if (tags2.length) d.tags[j.t] = tags2; if (j.pl < 0) d.lastLoss = now; delete d.buys[sym]; try { var keep = {}; (S.journal || []).forEach(function (x) { keep[x.t] = 1; }); Object.keys(d.tags).forEach(function (k) { if (!keep[k]) delete d.tags[k]; }); } catch (e) {}
            d.n = (d.n || 0) + 1; C.save();
            if (d.n % 5 === 0) { var r = coachReport(); C.toast("warn", "DeXaI Coach · " + d.n + " trades closed", r.fix.slice(0, 140)); }
            event("trade.close", { sym: sym, pl: j.pl, tags: tags2 });
          }
        }
        if (side === "buy") C.save();
      } catch (e) {}
      return ok;
    };
    w.__dexai = 1; window.execFill = w;
    var _po = window.placeAdvOrder; if (typeof _po === "function" && !_po.__dexai) { var w2 = function (type, side, sym) { var r = _po.apply(this, arguments); try { if ((type === "sl" || type === "tsl") && cfg().buys[sym]) cfg().buys[sym].hadStop = true; } catch (e) {} return r; }; w2.__dexai = 1; window.placeAdvOrder = w2; }
  })();

  /* ---------------------------------------------------------- providers */
  var NANO = { st: "unknown", sess: null };
  function nanoProbe() {
    if (NANO.st !== "unknown") return Promise.resolve(NANO.st);
    var LM = window.LanguageModel || (window.ai && window.ai.languageModel);
    if (!LM || !LM.availability) { NANO.st = "none"; return Promise.resolve(NANO.st); }
    return Promise.resolve().then(function () { return LM.availability(); }).then(function (a) { NANO.st = a === "available" || a === "readily" ? "ready" : a === "downloadable" || a === "after-download" || a === "downloading" ? "downloadable" : "none"; return NANO.st; }).catch(function () { NANO.st = "none"; return NANO.st; });
  }
  var SYS = "You are DeXaI, the copilot inside DexLadder, a crypto paper-trading academy. Write plain, calm English, under 110 words. You never write digits: every number must be a slot like {{btc.price}} copied exactly from the FACTS list, and you may only use slots that exist there. Never invent facts, never hype, never give financial advice; describe what the facts say and what would change the read. If a fact is missing, say it is missing.";
  function nanoAsk(F, q, hint) {
    var LM = window.LanguageModel || (window.ai && window.ai.languageModel); if (!LM) return Promise.resolve(null);
    var schema = { type: "object", properties: { answer: { type: "string" }, follow: { type: "array", items: { type: "string" }, maxItems: 3 } }, required: ["answer"] };
    var prompt = "FACTS:\n" + F.sheet() + "\n\nTASK: " + (hint || "Answer the question using only the facts.") + "\nQUESTION: " + q + "\nReply as JSON {\"answer\":\"…\",\"follow\":[\"…\"]}.";
    var p = NANO.sess ? Promise.resolve(NANO.sess) : Promise.resolve().then(function () { return LM.create({ initialPrompts: [{ role: "system", content: SYS }] }); }).then(function (s) { NANO.sess = s; return s; });
    return withTimeout(p.then(function (s) { return s.prompt(prompt, { responseConstraint: schema }); }), 20000).then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) { var m = String(t).match(/\{[\s\S]*\}/); if (m) try { j = JSON.parse(m[0]); } catch (e2) {} } if (!j) j = { answer: String(t || "") }; return { text: j.answer, follow: j.follow || [], model: "Chrome built-in model (on-device)" }; }).catch(function () { NANO.sess = null; return null; });
  }
  function gwAsk(F, q, hint, mode) {
    var d = cfg(), url = String(d.gw || "").replace(/\/+$/, ""); if (!/^https:\/\//.test(url)) return Promise.resolve(null);
    var body = { v: 1, q: q, mode: mode, hint: hint || "", facts: F.ids.map(function (id) { var f = F.f[id]; return { id: id, label: f.label, value: strip(f.txt), src: f.src }; }), mem: memWindow().slice(0, 12).map(function (m) { return { t: m.t, q: m.q }; }), sys: SYS };
    return withTimeout(fetch(url + "/api/dexai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(function (r) { if (!r.ok) throw new Error("gateway " + r.status); return r.json(); }), 15000).then(function (j) { return j && j.answer ? { text: j.answer, follow: j.follow || [], model: "your gateway · " + (j.model || "model") + (j.cached ? " · cached" : "") } : null; }).catch(function () { return null; });
  }
  function withTimeout(p, ms) { return new Promise(function (res, rej) { var t = setTimeout(function () { rej(new Error("timeout")); }, ms); p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); }); }); }
  /* narrative layer: local html is always the ground truth; a model may add prose above it */
  function narrate(F, q, hint, local) {
    var d = cfg(), mode = d.mode || "quick", priv = d.priv || "device";
    if (mode === "quick" && NANO.st !== "ready") return Promise.resolve(local);
    var chain = Promise.resolve(null);
    if (NANO.st === "ready") chain = nanoAsk(F, q, hint);
    if (priv !== "device") chain = chain.then(function (r) { return r || gwAsk(F, q, hint, mode); });
    return chain.then(function (r) {
      if (!r || !r.text) return local;
      var rp = renderProse(r.text, F);
      local.html = rp.html + local.html; local.prov = r.model + (rp.unsrc ? " · " + rp.unsrc + " unsourced number" + (rp.unsrc > 1 ? "s" : "") + " struck" : "");
      if (r.follow && r.follow.length) local.follow = r.follow.slice(0, 3).concat(local.follow || []).slice(0, 3);
      return local;
    }).catch(function () { return local; });
  }
  function status() { var d = cfg(); return { provider: NANO.st === "ready" ? "on-device composer + Chrome built-in model" : "on-device composer", nano: NANO.st, gateway: d.gw ? "set" : "not set", priv: PRIV[d.priv] || "Device-only", mode: MODES[d.mode] || "Quick", memDays: d.win, memN: memWindow().length }; }

  /* ---------------------------------------------------------- memory window */
  function memWindow() { var d = cfg(); if (!d.win) return []; var cut = Date.now() - d.win * 864e5; return d.mem.filter(function (m) { return m.t >= cut; }); }
  function remember(q, intent, sym) { var d = X(); if (!d || !d.win) return; d.mem.unshift({ t: Date.now(), q: String(q).slice(0, 120), i: intent, sym: sym || null }); if (d.mem.length > 60) d.mem.length = 60; C.save(); }
  function forget() { var d = X(); if (!d) return; d.mem = []; d.ev = []; C.save(); }
  function event(name, payload) { try { var d = X(); if (!d) return; d.ev.unshift({ t: Date.now(), n: name, p: summar(payload) }); if (d.ev.length > 40) d.ev.length = 40; } catch (e) {} }
  function summar(p) { try { if (!p) return null; if (p.sym) return { sym: p.sym, pl: p.pl, tags: p.tags }; if (p.pool) return { pool: p.pool.name || p.pool.id, usd: p.usd, pl: p.pl }; if (p.m) return { q: p.m.q, side: p.side, usd: p.usd }; return { k: Object.keys(p).slice(0, 4) }; } catch (e) { return null; } }

  /* ---------------------------------------------------------- answer assembly */
  function ans(title, comp, F, opts) {
    opts = opts || {}; var a = { title: title, html: comp.html + F.foot(opts.prov), src: "DeXaI · " + (opts.src || "tools: " + F.tools.join(", ")), follow: opts.follow || [], jump: opts.jump || null };
    a._F = F; return a;
  }
  function finish(a) { if (a && a._F && a.prov) { a.html = a.html.replace(/<div class="dx-foot">[\s\S]*?<\/div>$/, a._F.foot(a.prov)); } return a; }

  /* ---------------------------------------------------------- intents */
  var PAGES = { markets: "markets", market: "markets", portfolio: "portfolio", book: "portfolio", trade: "trade", academy: "learn", learn: "learn", lessons: "learn", news: "news", explorer: "explorer", p2p: "p2p", community: "community", discover: "discover", desks: "markets", radar: "radar", "pool radar": "radar", odds: "odds", weather: "weather", clock: "clock", sectors: "sectors", baskets: "baskets", coach: "coach", rungs: "markets" };
  var INTENTS = [
    { id: "meta", re: /^(who are you|what are you|what can you do|help|\/help|privacy|what do you remember|forget( everything| me| it)?|clear memory|model card)\b/i, run: function (q) {
      var ql = q.toLowerCase(), st = status(); if (/forget|clear memory/.test(ql)) { forget(); return Promise.resolve({ title: "Forgotten", html: '<div class="dx-read"><p class="why">Memory window emptied on this device. Nothing was ever sent anywhere to forget.</p></div>', src: "DeXaI", follow: ["What can you do?", "Market state", "Read BTC"] }); }
      if (/remember/.test(ql)) { var m = memWindow(); return Promise.resolve({ title: "What DeXaI remembers · " + st.memDays + "-day window", html: '<div class="dx-read">' + (m.length ? m.slice(0, 10).map(function (x) { return '<p class="why">' + C.ago(x.t) + " — " + esc(x.q) + (x.sym ? " <span class=\"dl-chip\">" + esc(x.sym) + "</span>" : "") + "</p>"; }).join("") : '<p class="why">Nothing in the window yet.</p>') + '<p class="why">Stored on this device only, in the same payload as your paper book. Say “forget everything” to clear it.</p></div>', src: "DeXaI · on-device memory", follow: ["Forget everything", "Coach me", "Market state"] }); }
      return Promise.resolve({ title: "DeXaI · what it is", html: '<div class="dx-read"><p class="why">A copilot that reads what this app already knows — prices, your paper book, your journal, the wire, the Academy — and says it plainly. <b>It never types a number:</b> every figure is pulled by a tool and shown as a slot with its source and age. Prose from a model may only point at those slots; anything it invents is struck out.</p><p class="why">Try: <i>read SOL</i> · <i>market state</i> · <i>my book</i> · <i>coach me</i> · <i>news on ETH</i> · <i>forecast BTC 30d</i> · <i>show me oversold large caps</i> · <i>alert me when BTC moves 5% in an hour</i> · <i>buy $200 of ETH</i> · <i>what is a liquidity pool</i> · <i>quiz me</i>.</p><p class="why">Provider now: ' + esc(st.provider) + " · gateway " + esc(st.gateway) + " · privacy " + esc(st.priv) + " · memory " + st.memDays + "d.</p></div>", src: "DeXaI · model card in Trust", follow: ["Market state", "Read BTC", "Coach me"], jump: window.DLTRUST ? ["Open the model card", "DLTRUST.open('dexai')"] : null }); } },
    { id: "calc", re: /^(calc(ulate)?|compute|what('| i)s)?\s*[\d($\-][\d\s$,.+\-*/()%^×÷]*(of\s*[\d$,.]+)?\s*[=?]?\s*$/i, run: function (q) { var F = new Facts(); var v = T.calc(F, q.replace(/^(calc(ulate)?|compute|what('| i)s)\s*/i, "").replace(/[=?]\s*$/, "")); if (v == null) return Promise.resolve(null); return Promise.resolve(ans("Arithmetic", { html: '<div class="dx-read"><p class="why">' + esc(q.replace(/^(calc(ulate)?|compute|what('| i)s)\s*/i, "")) + " = " + F.slot("calc.out") + "</p></div>" }, F, { follow: ["Convert 1 BTC to INR", "My book", "Market state"] })); } },
    { id: "nav", re: /^\s*(open|go to|take me to|show( me)?( the)?|switch to)\s+(the\s+)?([a-z ]{3,20})\s*(page|desk|tab)?\s*$/i, run: function (q) { var m = q.match(INTENTS_BY.nav.re); var k = m[5].trim().toLowerCase(); var go = null; if (PAGES[k]) go = PAGES[k]; else { var c = C.coin(k) || (symIn(k) ? C.coin(symIn(k)) : null); if (c) return Promise.resolve({ title: "Opening " + c.sym, html: '<div class="dx-read"><p class="why">Opening ' + esc(c.name) + ".</p></div>", src: "DeXaI", follow: ["Read " + c.sym], jump: ["Open " + c.sym, "openCoin('" + c.sym + "')"] }); } if (!go) return Promise.resolve(null); var js = go === "radar" ? "DLRADAR&&DLRADAR.open('trend')" : go === "odds" ? "DLODDS&&DLODDS.open('crypto')" : go === "weather" ? "DLWEATHER&&DLWEATHER.open()" : go === "clock" ? "DLCLOCK&&DLCLOCK.open()" : go === "sectors" ? "DLSECTORS&&DLSECTORS.open()" : go === "baskets" ? "DLLEDGERS&&DLLEDGERS.basketSheet()" : go === "coach" ? "DEXAI.coach()" : "nav('" + go + "')"; return Promise.resolve({ title: "Opening " + k, html: '<div class="dx-read"><p class="why">Opening ' + esc(k) + ".</p></div>", src: "DeXaI", follow: [], jump: ["Open " + k, js] }); } },
    { id: "coach", re: /\b(coach|review my (trades|journal|book)|my (journal|trades|mistakes|habits)|what am i doing wrong|how (can|do) i improve|session review)\b/i, run: function (q) { var F = new Facts(), r = coachReport(F), s = function (id) { return F.slot(id); }; if (!r.n) return Promise.resolve(ans("Coach", { html: '<div class="dx-read"><p class="why">' + esc(r.fix) + "</p></div>" }, F, { follow: ["Buy $100 of BTC", "Market state", "Read ETH"], jump: ["Open the Trade page", "nav('trade')"] })); var html = '<div class="dx-read"><p class="why"><b>One thing to fix:</b> ' + esc(r.fix) + '</p><p class="why">Across ' + s("coach.n") + " closed trades: win rate " + s("coach.win") + ", average win " + s("coach.avgw") + " vs average loss " + s("coach.avgl") + ", expectancy " + s("coach.exp") + " per trade, median hold " + s("coach.hold") + "." + (F.f["coach.brier"] ? " Forecast calibration " + s("coach.brier") + "." : "") + "</p>" + (Object.keys(r.tags).length ? '<p class="why">Habits tagged: ' + Object.keys(r.tags).map(function (k) { return '<span class="dx-tag">' + esc(k) + " " + r.tags[k] + "×</span>"; }).join(" ") + "</p>" : "") + "</div>"; var a = ans("DeXaI Coach", { html: html }, F, { follow: ["Open the Coach sheet", "My book", "What is expectancy?"], jump: ["Open Coach", "DEXAI.coach()"] }); return narrate(F, q, "Give a two-sentence coaching note on this trader's journal. Be direct and kind.", a); } },
    { id: "book", re: /\b(my book|portfolio|holdings|balance|p&l|pnl|how am i doing|net worth|what am i worth|my positions|my perps)\b/i, run: function (q) { var F = new Facts(), deep = cfg().mode !== "quick", r = readBook(F, deep); var a = ans("Your book", r, F, { follow: ["Coach me", "Market state", "Buy $100 of BTC"], jump: ["Open Portfolio", "nav('portfolio')"] }); return narrate(F, q, "Summarise this paper portfolio in two sentences.", a); } },
    { id: "alert", re: /\b(alert|notify|tell me when|ping me|warn me|watch for|wake me)\b/i, run: function (q) { var SN = window.DLSENTINEL; if (!SN) return Promise.resolve(null); var rules = SN.compile(q.replace(/^\s*(please\s+)?(set (an? )?alert( for| on| when)?|alert me (when|if)?|notify me (when|if)?|tell me when|ping me (when|if)?|warn me (when|if)?|watch for|wake me (when|if)?)\s*/i, "")); var good = rules.filter(function (r) { return !r.err; }); var F = new Facts(); F.tool("dex_sentinel"); if (!good.length) return Promise.resolve(ans("Sentinel", { html: '<div class="dx-read"><p class="why">I couldn’t compile that into a rule. Sentinel understands shapes like <i>BTC moves 5% in an hour</i>, <i>ETH above 4000</i>, <i>SOL funding flips negative</i>, <i>USDT depegs</i>, <i>BTC RSI under 30</i>, <i>volume spike on DOGE</i>, <i>weather turns stormy</i>.</p>' + (rules[0] && rules[0].err ? '<p class="why">' + esc(rules[0].err) + "</p>" : "") + "</div>" }, F, { follow: ["Alert me when BTC moves 5% in an hour", "Alert me when ETH is above 4000", "Alert me if USDT depegs"] })); var id = pend({ kind: "alert", rules: good }); return Promise.resolve(ans("Sentinel · ready to arm", { html: '<div class="dx-read"><p class="why">Compiled ' + good.length + " rule" + (good.length > 1 ? "s" : "") + ":</p>" + good.map(function (r) { return '<p class="why">• ' + esc(SN.describe(r)) + "</p>"; }).join("") + '<div class="dx-conf">Arm ' + (good.length > 1 ? "these" : "this") + '? Rules run on this device while the app is open.<br><button class="dl-b pri" onclick="DEXAI.confirm(\'' + id + '\')">Arm</button><button class="dl-b" onclick="DEXAI.cancel(\'' + id + '\')">Cancel</button></div></div>' }, F, { follow: ["Open Alerts", "Market state"] })); } },
    { id: "order", re: /^\s*(buy|sell|long|short)\s+\$?\s*([\d,.]+k?)\s*(of|worth of|in|usd of|usdt of)?\s*\$?([a-z]{2,10})\b|^\s*(buy|sell)\s+\$?([a-z]{2,10})\s+(for\s+)?\$?([\d,.]+k?)/i, run: function (q) { var m = q.match(INTENTS_BY.order.re); var side = (m[1] || m[5]).toLowerCase(), usdS = m[2] || m[8], symS = m[4] || m[6]; if (side === "long") side = "buy"; if (side === "short") return Promise.resolve({ title: "Paper shorts live on the perps desk", html: '<div class="dx-read"><p class="why">Spot can’t go short. The Sim desk trades paper perps with funding and liquidation — open it and choose the venue and leverage yourself; DeXaI will not size leverage for you.</p></div>', src: "DeXaI", follow: ["Open the perps desk", "Read " + symS.toUpperCase()], jump: ["Open the perps desk", "window.DLSIM&&DLSIM.open()"] }); var usd = parseFloat(String(usdS).replace(/,/g, "")) * (/k$/i.test(usdS) ? 1000 : 1); var c = C.coin(symS); if (!c) { var alt = symIn(q); c = alt ? C.coin(alt) : null; } if (!c || !(usd > 0)) return Promise.resolve(null); var F = new Facts(); T.coin(F, c.sym); F.tool("dex_order"); var fs = typeof fillSim === "function" ? fillSim(c.sym, "USDT", side, usd / c.price) : { px: c.price, slip: 0 }; F.add("ord.px", "expected fill", C.money(fs.px), "on-device fill engine", Date.now(), fs.px); F.add("ord.slip", "expected slippage", ((fs.slip || 0) * 100).toFixed(3) + "%", "on-device fill engine", Date.now(), fs.slip); F.add("ord.qty", "quantity", (usd / fs.px).toLocaleString(undefined, { maximumFractionDigits: 6 }) + " " + c.sym, "on-device", Date.now(), usd / fs.px); F.add("ord.usd", "order size", C.money(usd, 2), "you", Date.now(), usd); var bal = S.bal.USDT || 0, have = S.bal[c.sym] || 0; var bad = side === "buy" && usd * 1.001 > bal ? "Not enough paper USDT — you have " + C.money(bal, 2) + "." : side === "sell" && usd / fs.px > have * 1.000001 ? "You hold " + have.toLocaleString(undefined, { maximumFractionDigits: 6 }) + " " + c.sym + " — that is less than this order." : null; var bookVal = 0; try { bookVal = portfolioUSD(); } catch (e) {} var warn = []; if (side === "buy" && bookVal && usd > 0.25 * bookVal) warn.push("this is over a quarter of your book — Coach will tag it <i>oversize</i>"); if (side === "buy" && c.c1 > 4) warn.push("the hour is already up " + F.slot(c.sym.toLowerCase() + ".c1") + " — Coach will tag it <i>chase</i>"); var id = pend({ kind: "order", side: side, sym: c.sym, usd: usd, qty: usd / fs.px, px: fs.px }); return Promise.resolve(ans("Paper " + side + " · " + c.sym, { html: '<div class="dx-read"><p class="why">' + (side === "buy" ? "Buy" : "Sell") + " " + F.slot("ord.qty") + " for " + F.slot("ord.usd") + " at about " + F.slot("ord.px") + " (slippage " + F.slot("ord.slip") + ", fee 0.10%). " + c.sym + " is " + F.slot(c.sym.toLowerCase() + ".c24") + " today.</p>" + (warn.length ? '<p class="why">⚠ ' + warn.join("; ") + ".</p>" : "") + (bad ? '<p class="why" style="color:#ff6b87">' + esc(bad) + "</p>" : '<div class="dx-conf">Confirm the paper ' + side + "? It goes through the same fill engine as the Trade page.<br><button class=\"dl-b pri\" onclick=\"DEXAI.confirm('" + id + "')\">Confirm " + side + '</button><button class="dl-b" onclick="DEXAI.cancel(\'' + id + '\')">Cancel</button></div>') + "</div>" }, F, { follow: ["Read " + c.sym, "My book", "Alert me when " + c.sym + " moves 5% in an hour"] })); } },
    { id: "lens", re: /\b(show me|screen|filter|find|list|which|what)\b.*\b(coins?|tokens?|caps?|gainers|losers|oversold|overbought|climbers|sliders|movers|under|over|above|below)\b|\b(oversold|overbought|gainers|losers)\b.*\b(caps?|coins?|majors|alts?)\b|\btop \d+\b/i, run: function (q) { return lens(q); } },
    { id: "rung", re: /\b(add|put)\s+\$?([a-z]{2,10})\s+(to|on|in)\s+(my\s+)?(rung|watchlist|watch list|home)\b|\bcreate (a )?rung\b|\bnew rung\b/i, run: function (q) { var R = window.DLRUNGS; if (!R) return Promise.resolve(null); var m = q.match(/\b(add|put)\s+\$?([a-z]{2,10})\s+(to|on|in)\s+(my\s+)?(rung|watchlist|watch list|home)\b/i); if (m) { var c = C.coin(m[2]); if (!c) return Promise.resolve(null); try { if (typeof toggleWatch === "function" && !(S.watch || []).some(function (w) { return w === c.sym; })) toggleWatch(c.sym); else if (S.watch && S.watch.indexOf(c.sym) < 0) { S.watch.push(c.sym); saveP(); } } catch (e) {} return Promise.resolve({ title: "Added to your Home rung", html: '<div class="dx-read"><p class="why">' + esc(c.name) + " is on your Home rung now — the ★ filter on Markets.</p></div>", src: "DeXaI · rungs", follow: ["Read " + c.sym, "Show my rung", "Alert me when " + c.sym + " moves 5% in an hour"], jump: ["Open Markets", "nav('markets');setTimeout(function(){DLRUNGS.apply('home')},400)"] }); } var name = (q.match(/rung\s+(called|named)\s+([\w ]{2,24})/i) || [])[2] || "DeXaI rung"; var syms = String(q).toUpperCase().match(/\b[A-Z]{2,6}\b/g) || []; syms = syms.filter(function (s) { return C.coin(s); }); var r = R.create(name, syms, "made in the DeXaI desk"); return Promise.resolve({ title: "Rung created", html: '<div class="dx-read"><p class="why">“' + esc(name) + "” with " + syms.length + " coin" + (syms.length === 1 ? "" : "s") + (syms.length ? ": " + syms.join(", ") : " — add coins from any coin page") + ".</p></div>", src: "DeXaI · rungs", follow: ["Show me oversold large caps", "Market state"], jump: ["Open Markets", "nav('markets');setTimeout(function(){DLRUNGS.apply('" + (r ? r.id : "") + "')},400)"] }); } },
    { id: "forecast", re: /\b(forecast|predict|prediction|price target|where will|price in (a|one|\d+) (week|month|day)|next (week|month)|cone|range for)\b/i, run: function (q) { var sym = symIn(q) || (function () { try { return S.view === "coin" ? S.coin : null; } catch (e) { return null; } })() || "BTC"; var days = /30 ?d|month/i.test(q) ? 30 : 7; var F = new Facts(); T.coin(F, sym); var k = T.forecast(F, sym, days); if (!k) return Promise.resolve(null); var p = sym.toLowerCase(); var html = '<div class="dx-read"><p class="why">DeXaI does not predict prices — it measures how wide normal is. From ' + esc(String(k.n)) + " hourly returns, " + esc(sym) + "’s daily realised vol is " + F.slot(p + ".vol") + ", so a one-sigma " + days + "-day range from " + F.slot(p + ".price") + " is " + F.slot(p + ".cone" + days) + ". Two-thirds of the time price stays inside a band like that; one time in three it does not.</p><p class=\"why\">Log a band with a confidence and it will be scored when it lands — calibration is the only prediction skill that can be measured.</p></div>"; return Promise.resolve(ans("Forecast cone · " + sym + " · " + days + "d", { html: html }, F, { follow: ["Read " + sym, "Forecast " + sym + " " + (days === 7 ? "30d" : "7d"), "Coach me"], jump: ["Log a forecast on " + sym, "openCoin('" + sym + "');setTimeout(function(){var e=document.getElementById('dlForecast');e&&e.scrollIntoView({behavior:'smooth'})},600)"] })); } },
    { id: "odds", re: /\b(odds|probability|chance|chances|polymarket|prediction market|will .* (happen|win|pass|hit|reach))\b/i, run: function (q) { var F = new Facts(); return T.odds(F, q).then(function (r) { if (!r || !r.list.length) return null; var html = '<div class="dx-read">' + r.list.map(function (e, i) { return '<p class="why">' + esc(e.title) + " — " + F.slot("odds." + i) + " · ends " + esc(String(e.end || "").slice(0, 10)) + "</p>"; }).join("") + '<p class="why">These are prices, not truths: a market’s mid is what the last traders were willing to pay, and thin markets lie. Buy or sell them with paper money in Odds and your Brier score will tell you if you know better.</p></div>'; return ans("Odds", { html: html }, F, { follow: ["Open Odds", "Market state"], jump: ["Open Odds", "DLODDS.open('crypto')"] }); }); } },
    { id: "security", re: /\b0x[a-fA-F0-9]{40}\b|\b(rug|honeypot|is .* safe|scan (this|the) (token|contract)|token security)\b/i, run: function (q) { var m = q.match(/0x[a-fA-F0-9]{40}/); if (!m) return Promise.resolve({ title: "Scan needs an address", html: '<div class="dx-read"><p class="why">Paste the token contract (0x + 40 hex, or a Solana mint) and I’ll run it through GoPlus and explain each flag in plain words. Pool Radar does the same for any pool you open.</p></div>', src: "DeXaI · security", follow: ["Open Pool Radar", "What is a honeypot?"], jump: window.DLRADAR ? ["Open Pool Radar", "DLRADAR.open('trend')"] : null }); var chain = /\b(bsc|bnb)\b/i.test(q) ? "bsc" : /\bbase\b/i.test(q) ? "base" : /\barbitrum|arb\b/i.test(q) ? "arbitrum" : /\bpolygon|matic\b/i.test(q) ? "polygon" : /\bsolana|sol\b/i.test(q) ? "solana" : "eth"; var F = new Facts(); return T.security(F, chain, m[0]).then(function (r) { if (!r) return null; var el = document.createElement("div"); scan(r.sec, el); return ans("Token scan · " + chain, { html: '<div class="dx-read">' + el.innerHTML + "</div>" }, F, { follow: ["What is a honeypot?", "Open Pool Radar"] }); }).catch(function () { return { title: "Scan failed", html: '<div class="dx-read"><p class="why">GoPlus didn’t answer for that address on ' + esc(chain) + ". Try naming the chain (eth, bsc, base, arbitrum, polygon, solana).</p></div>", src: "DeXaI · security", follow: [] }; }); } },
    { id: "news", re: /\b(news|headlines?|what('s| is) happening|why is .* (up|down|pumping|dumping|moving)|latest on|wire)\b/i, run: function (q) { var sym = symIn(q); var F = new Facts(); if (sym) T.coin(F, sym); var list = T.news(F, sym, 6); var html = '<div class="dx-read">' + (sym ? '<p class="why">' + esc(sym) + " is " + F.slot(sym.toLowerCase() + ".c24") + " today; " + F.slot("news.n") + " headline" + (list.length === 1 ? "" : "s") + " in the loaded wire mention it. Headlines explain moves after the fact more often than before it — read them as context, not cause.</p>" : '<p class="why">' + F.slot("news.n") + " headlines on the loaded wire right now.</p>") + (list.length ? list.map(function (a) { return '<p class="why">• ' + (a.link ? '<a href="' + esc(a.link) + '" target="_blank" rel="noopener noreferrer">' : "") + esc(a.title) + (a.link ? "</a>" : "") + ' <span style="color:var(--muted)">' + esc(a.source) + " · " + C.ago(a.t) + "</span></p>"; }).join("") : '<p class="why">Nothing matching in the loaded feeds — open News to pull the full wire.</p>') + "</div>"; var a = ans("Wire" + (sym ? " · " + sym : ""), { html: html }, F, { follow: sym ? ["Read " + sym, "Forecast " + sym, "Market state"] : ["Market state", "My book"], jump: ["Open News", "nav('news')"] }); return narrate(F, q, "In two sentences, say what the headlines have in common. Do not speculate about causes.", a); } },
    { id: "sectors", re: /\b(sectors?|narratives?|rotation|categories|which (sector|narrative))\b/i, run: function (q) { var F = new Facts(); var SC = window.DLSECTORS; if (!SC) return Promise.resolve(null); return (SC.last() ? Promise.resolve() : SC.load()).then(function () { var L = T.sectors(F); if (!L) return null; var html = '<div class="dx-read"><p class="why">Strongest on the day: ' + F.slot("sec.top") + ".</p><p class=\"why\">Weakest: " + F.slot("sec.bottom") + ".</p><p class=\"why\">Rotation is a story told by 24h averages — one big coin can carry a sector. Open a sector as a Rung to see who is actually doing the work.</p></div>"; return ans("Sectors", { html: html }, F, { follow: ["Market state", "Show me oversold large caps"], jump: ["Open Sectors", "DLSECTORS.open()"] }); }); } },
    { id: "market", re: /\b(market( state| overview| read| summary| regime)?|overview|state of (the )?market|regime|risk[- ]on|risk[- ]off|alt ?season|breadth|weather|fear|greed|dominance|how('s| is) (the )?(market|tape|crypto)( doing)?|whats? up)\b/i, run: function (q) { var F = new Facts(), deep = cfg().mode !== "quick", r = readMarket(F, deep); var a = ans("Market read", r, F, { follow: ["Read BTC", "Sectors", "My book"], jump: ["Open Markets", "nav('markets')"] }); return narrate(F, q, "Describe the market regime in three sentences.", a); } },
    { id: "supply", re: /\b(unlocks?|dilution|supply (drift|change|schedule)|inflation of|emissions?)\b/i, run: function (q) { var sym = symIn(q) || "BTC"; var F = new Facts(); T.coin(F, sym); var d = T.supply(F, sym); var p = sym.toLowerCase(); var html = '<div class="dx-read"><p class="why">' + esc(sym) + " has " + F.slot(p + ".supply") + " in circulation." + (d && d.d7 ? " Measured on this device, supply changed " + F.slot(p + ".sup7") + " over 7 days" + (d.d30 ? " and " + F.slot(p + ".sup30") + " over 30" : "") + " — that is the unlock schedule happening, not promised." : " Supply Drift started recording today; measured 7-day change appears after two daily snapshots.") + "</p></div>"; return Promise.resolve(ans("Supply · " + sym, { html: html }, F, { follow: ["Read " + sym, "Open Supply Drift"], jump: window.DLLEDGERS ? ["Open Supply Drift", "DLLEDGERS.supSheet()"] : null })); } },
    { id: "quiz", re: /\b(quiz me|test me|why is (that|this) the answer|explain (this|the) (lesson|chapter)|explain (it )?simpler|eli5|explain like i('m| am) (5|five|10|ten)|connect (this|it) to (the|today's) market)\b/i, run: function (q) { return tutor(q); } },
    { id: "learn", re: /\b(what (is|are)|what's|explain|how (do|does|did)|define|meaning of|teach me|tell me about (a|an|the)\b)/i, run: function (q) { var F = new Facts(); var r = T.learn(F, q); if (!r || (!r.kb && !r.acad)) return Promise.resolve(null); var e = r.kb, html = '<div class="dx-read">' + (e ? '<p class="why"><b>' + esc(e.title) + ".</b> " + esc(e.body) + "</p>" + (e.deep ? '<p class="why" style="color:#a9bad6">' + esc(e.deep) + "</p>" : "") : "") + (r.acad ? '<p class="why">The Academy teaches this in lesson ' + (r.acad.i + 1) + ", “" + esc(r.acad.t) + "” — interactive, written for someone who has never opened a block explorer.</p>" : "") + "</div>"; var follow = (r.more || []).map(function (x) { return "What is " + x.title.toLowerCase() + "?"; }); follow.push("Quiz me on " + (e ? e.title.toLowerCase() : r.acad.t.toLowerCase())); var a = ans(e ? e.title : r.acad.t, { html: html }, F, { src: "on-device knowledge base" + (r.acad ? " · Academy" : ""), follow: follow.slice(0, 3), jump: r.acad ? ["Open that lesson", "nav('learn');setTimeout(function(){try{enterLesson(" + r.acad.i + ")}catch(e){}},250)"] : (e && e.page ? ["Go there", "nav('" + e.page + "')"] : null) }); return cfg().mode === "quick" ? Promise.resolve(a) : narrate(F, q, "Explain this concept in two plain sentences with one concrete analogy. No numbers.", a); } },
    { id: "read", re: /\b(read|analy[sz]e|analysis|about|thoughts on|how is|how's|what about|look at|should i buy|outlook|tell me about|status of)\b|^\s*\$?[a-z]{2,6}\s*\??\s*$/i, run: function (q) { var sym = symIn(q); if (!sym) return Promise.resolve(null); var F = new Facts(), deep = cfg().mode !== "quick", r = readCoin(F, sym, deep); if (!r) return Promise.resolve(null); var a = ans("DeXaI Read · " + sym, r, F, { follow: ["Forecast " + sym + " 7d", "News on " + sym, "Alert me when " + sym + " moves 5% in an hour"], jump: ["Open " + sym, "openCoin('" + sym + "')"] }); return narrate(F, q, "Give a calm two-sentence read of this coin's tape.", a); } }
  ];
  var INTENTS_BY = {}; INTENTS.forEach(function (i) { INTENTS_BY[i.id] = i; });
  function answer(q) {
    q = String(q || "").trim(); if (!q) return Promise.resolve(null);
    var chain = Promise.resolve(null), hit = null;
    INTENTS.forEach(function (it) { chain = chain.then(function (prev) { if (prev) return prev; if (!it.re.test(q)) return null; var r = null; try { r = it.run(q); } catch (e) { r = null; } return Promise.resolve(r).then(function (a) { if (a) { hit = it.id; a = finish(a); } return a; }).catch(function () { return null; }); }); });
    return chain.then(function (a) { if (a) remember(q, hit, symIn(q)); return a; });
  }

  /* pending actions (confirm / cancel) */
  var PEND = {}; function pend(a) { var id = "p" + Math.random().toString(36).slice(2, 8); PEND[id] = a; return id; }
  function confirm(id) {
    var a = PEND[id]; if (!a) return; delete PEND[id];
    try {
      if (a.kind === "alert") { DLSENTINEL.arm(a.rules); C.toast("good", "Sentinel armed", a.rules.length + " rule" + (a.rules.length > 1 ? "s" : "") + " watching"); C.xp("dexai.alert", 5, "Armed a rule through DeXaI"); }
      if (a.kind === "order") { var ok = execFill(a.side, a.sym, "USDT", a.qty, a.px, "dexai", false); if (ok) { try { updateNavBal(); } catch (e) {} C.sfx(a.side); C.toast("good", "Paper " + a.side + " filled" + C.simTag(), a.qty.toLocaleString(undefined, { maximumFractionDigits: 6 }) + " " + a.sym + " at " + C.money(a.px)); C.xp("dexai.order", 5, "Placed a paper order through DeXaI"); } else C.toast("bad", "Order rejected", "The fill engine refused it — balance or price changed."); }
      if (a.kind === "lens") { DLRUNGS.register(a.rung); DLRUNGS.apply(a.rung.id); if (S.view !== "markets") nav("markets"); setTimeout(function () { try { DLRUNGS.apply(a.rung.id); var el = $("dlRungRail"); el && el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {} }, 500); }
    } catch (e) { C.toast("bad", "Couldn’t do that", String(e.message || e)); }
    document.querySelectorAll(".dx-conf").forEach(function (el) { if (el.innerHTML.indexOf(id) > -1) el.innerHTML = '<span style="color:var(--up)">✓ done</span>'; });
  }
  function cancel(id) { delete PEND[id]; document.querySelectorAll(".dx-conf").forEach(function (el) { if (el.innerHTML.indexOf(id) > -1) el.innerHTML = '<span style="color:var(--muted,#8fa4c4)">cancelled</span>'; }); }

  /* ---------------------------------------------------------- Lens: words → a Rung */
  function lens(q) {
    var ql = q.toLowerCase(), all = C.coinsAll().filter(function (c) { return c.sym !== "USDT" && c.sym !== "USDC" && !(window.DLRUNGS && DLRUNGS.wrapped && DLRUNGS.wrapped[c.sym]); });
    var why = [], list = all.slice();
    var capM = ql.match(/(under|below|less than|<)\s*\$?([\d.]+)\s*(b|bn|billion|m|mn|million|k)?\b/); var capO = ql.match(/(over|above|more than|>|at least)\s*\$?([\d.]+)\s*(b|bn|billion|m|mn|million|k)?\b/);
    function n(m) { var v = parseFloat(m[2]); var u = (m[3] || "").charAt(0); return v * (u === "b" ? 1e9 : u === "m" ? 1e6 : u === "k" ? 1e3 : 1); }
    if (capM) { var x = n(capM); list = list.filter(function (c) { return c.mcap < x; }); why.push("cap under $" + C.big(x)); }
    if (capO) { var y = n(capO); list = list.filter(function (c) { return c.mcap > y; }); why.push("cap over $" + C.big(y)); }
    if (/\blarge[- ]caps?\b|\bmajors?\b|\bblue[- ]chips?\b/.test(ql)) { list = list.filter(function (c) { return c.mcap >= 1e10; }); why.push("large caps (≥ $10B)"); }
    if (/\bmid[- ]caps?\b/.test(ql)) { list = list.filter(function (c) { return c.mcap >= 1e9 && c.mcap < 1e10; }); why.push("mid caps ($1–10B)"); }
    if (/\bsmall[- ]caps?\b|\bmicro[- ]caps?\b/.test(ql)) { list = list.filter(function (c) { return c.mcap < 1e9; }); why.push("small caps (< $1B)"); }
    if (/\bmy (rung|watchlist|home)\b/.test(ql)) { var W = new Set(S.watch || []); list = list.filter(function (c) { return W.has(c.sym); }); why.push("in your Home rung"); }
    if (/\boversold\b/.test(ql)) { list = list.filter(function (c) { return DLAPP.indicators.isOversold(c.spark || []); }); why.push("RSI-14 < " + DLAPP.indicators.RSI_OVERSOLD); }
    if (/\boverbought\b/.test(ql)) { list = list.filter(function (c) { return DLAPP.indicators.isOverbought(c.spark || []); }); why.push("RSI-14 > " + DLAPP.indicators.RSI_OVERBOUGHT); }
    if (/\bheavy (volume|tape)\b|\bhigh volume\b|\bactive\b/.test(ql)) { list = list.filter(function (c) { return c.mcap && c.vol / c.mcap > 0.15; }); why.push("volume ÷ cap > 15%"); }
    var pctM = ql.match(/(up|down|gained|lost|fell|rose)\s+(more than |over |at least )?(\d+)\s*%/); if (pctM) { var p = +pctM[3], dn = /down|lost|fell/.test(pctM[1]); list = list.filter(function (c) { return dn ? c.c24 <= -p : c.c24 >= p; }); why.push((dn ? "down" : "up") + " ≥ " + p + "% today"); }
    var week = /\b(week|7 ?d|weekly)\b/.test(ql);
    if (/\b(gainers|climbers|winners|strongest|best|top performers)\b/.test(ql)) { list.sort(function (a, b) { return (week ? b.c7 - a.c7 : b.c24 - a.c24); }); why.push("sorted by " + (week ? "7d" : "24h") + " gain"); }
    else if (/\b(losers|sliders|weakest|worst|dumping)\b/.test(ql)) { list.sort(function (a, b) { return (week ? a.c7 - b.c7 : a.c24 - b.c24); }); why.push("sorted by " + (week ? "7d" : "24h") + " loss"); }
    else list.sort(function (a, b) { return b.mcap - a.mcap; });
    var topM = ql.match(/\btop\s+(\d+)\b/); var lim = topM ? Math.min(100, +topM[1]) : 30; list = list.slice(0, lim);
    if (!why.length && !topM) return Promise.resolve(null);
    var F = new Facts(); F.tool("dex_lens"); F.add("lens.n", "coins matched", String(list.length), "on-device · 500-coin ladder", feedAt(), list.length);
    var rung = { id: "dx.lens", name: "DeXaI lens", ic: "✦", note: why.join(" · "), syms: list.map(function (c) { return c.sym; }) };
    var id = pend({ kind: "lens", rung: rung });
    var html = '<div class="dx-read"><p class="why">' + F.slot("lens.n") + " match: " + esc(why.join(" · ")) + (topM ? " · top " + lim : "") + ".</p>" + (list.length ? '<div class="dl-chips" style="margin:6px 0">' + list.slice(0, 12).map(function (c) { return '<span class="dl-chip">' + esc(c.sym) + " " + C.chg(week ? c.c7 : c.c24, 1) + "</span>"; }).join("") + (list.length > 12 ? '<span class="dl-chip">+' + (list.length - 12) + "</span>" : "") + "</div>" : "") + (list.length ? '<div class="dx-conf">Open this as a Rung on Markets?<br><button class="dl-b pri" onclick="DEXAI.confirm(\'' + id + '\')">Open as Rung</button><button class="dl-b" onclick="DEXAI.cancel(\'' + id + '\')">Not now</button></div>' : "") + "</div>";
    return Promise.resolve(ans("Lens", { html: html }, F, { follow: ["Show me overbought majors", "Top 10 gainers this week", "Small caps up 10% today"] }));
  }

  /* ---------------------------------------------------------- Tutor (Academy) */
  function lessonCtx() { try { if (typeof ACAD === "undefined") return null; var i = typeof curCh === "number" ? curCh : 0; return { i: i, ch: ACAD[i], quiz: typeof QUIZ !== "undefined" ? QUIZ[i] : null }; } catch (e) { return null; } }
  function tutor(q) {
    var ql = q.toLowerCase(), L = lessonCtx(), F = new Facts(); F.tool("dex_learn");
    var topic = (ql.match(/quiz me (on|about) (.+)$/) || [])[2] || (ql.match(/explain (.+?) (simpler|like)/) || [])[1] || null;
    var kb = null; try { var O = window.ORACLE; var hits = O.lookup(topic || (L && L.ch ? L.ch.t : q)); if (hits.length) kb = hits[0].e; } catch (e) {}
    if (/quiz me|test me/.test(ql)) {
      var qz = L && L.quiz && !topic ? L.quiz : null;
      if (qz) { var id = pend({ kind: "quiz", i: L.i }); return Promise.resolve({ title: "Checkpoint · lesson " + (L.i + 1), html: '<div class="dx-read"><p class="why"><b>' + esc(qz.q) + "</b></p>" + qz.o.map(function (o, k) { return '<p class="why">' + String.fromCharCode(65 + k) + ". " + esc(o) + "</p>"; }).join("") + '<p class="why">Answer in the lesson itself — the checkpoint there banks the XP. Want the why first? Ask <i>why is that the answer</i>.</p></div>', src: "DeXaI Tutor · Academy", follow: ["Why is that the answer?", "Explain it simpler", "Connect this to today's market"], jump: ["Open the lesson", "nav('learn');setTimeout(function(){try{enterLesson(" + L.i + ")}catch(e){}},250)"] }); }
      if (kb) { var k = kb.k[0].split("|")[0]; return Promise.resolve({ title: "Quiz · " + kb.title, html: '<div class="dx-read"><p class="why">In one sentence: what is <b>' + esc(k) + "</b>, and what goes wrong if you get it wrong? Type your answer and I’ll compare it against the knowledge base.</p></div>", src: "DeXaI Tutor", follow: ["What is " + k + "?", "Explain it simpler", "Quiz me"] }); }
      return Promise.resolve(null);
    }
    if (/why is (that|this) the answer/.test(ql)) { if (L && L.quiz) return Promise.resolve({ title: "Why · lesson " + (L.i + 1), html: '<div class="dx-read"><p class="why">' + esc(L.quiz.w) + "</p></div>", src: "DeXaI Tutor · Academy", follow: ["Quiz me", "Explain it simpler", "Connect this to today's market"] }); return Promise.resolve(null); }
    if (/simpler|eli5|like i/.test(ql)) { if (!kb && !(L && L.ch)) return Promise.resolve(null); var body = kb ? kb.body : ""; var first = (body.match(/^[\s\S]*?\.(?=\s|$)/) || [body])[0] || body; var a = { title: "Simpler · " + (kb ? kb.title : L.ch.t), html: '<div class="dx-read"><p class="why">' + esc(first) + "</p>" + (kb && kb.deep ? '<p class="why" style="color:#a9bad6">' + esc(kb.deep) + "</p>" : "") + "</div>", src: "DeXaI Tutor · on-device knowledge base", follow: ["Quiz me", "Connect this to today's market", "What is " + (kb ? kb.title.toLowerCase() : "the halving") + "?"] }; return cfg().mode === "quick" ? Promise.resolve(a) : narrate(F, q, "Explain this to a curious ten-year-old in three short sentences with one everyday analogy. No numbers.", Object.assign(a, { _F: F })); }
    if (/connect/.test(ql)) { var mkt = new Facts(); var r = readMarket(mkt, false); var t = L && L.ch ? L.ch.t : (kb ? kb.title : "this"); return Promise.resolve(ans("“" + t + "” meets today's tape", { html: '<div class="dx-read"><p class="why">Hold the lesson against what is happening right now:</p>' + r.html + "</div>" }, mkt, { follow: ["Quiz me", "Read BTC", "Market state"] })); }
    return Promise.resolve(null);
  }
  function mountTutor() {
    var stage = $("chapterStage"); if (!stage || $("dxTutor")) return; var L = lessonCtx(); if (!L || !L.ch) return;
    var bar = document.createElement("div"); bar.id = "dxTutor"; bar.className = "dx-chips"; bar.style.margin = "14px 0 6px";
    bar.innerHTML = '<span style="font:700 12px var(--ui-sans,sans-serif);color:var(--cyan,#00e5ff);align-self:center">✦ DeXaI Tutor</span><button data-q="Explain it simpler">Explain it simpler</button><button data-q="Quiz me">Quiz me</button><button data-q="Why is that the answer?">Why is that the answer?</button><button data-q="Connect this to today\'s market">Connect to today’s market</button>';
    stage.appendChild(bar);
    bar.addEventListener("click", function (e) { var b = e.target.closest("button[data-q]"); if (!b) return; ask(b.getAttribute("data-q")); });
  }
  (function wrapChapter() { var _sc = window.showChapter; if (typeof _sc !== "function" || _sc.__dexai) return; var w = function () { var r = _sc.apply(this, arguments); setTimeout(mountTutor, 60); return r; }; w.__dexai = 1; window.showChapter = w; })();

  /* ---------------------------------------------------------- Scan: GoPlus flags → plain English */
  function scan(sec, el) {
    if (!sec || !el) return; var R = window.DLRADAR, v = R ? R.verdict(sec) : null, bad = (sec.flags || []).filter(function (f) { return f.bad; });
    var say = { honeypot: "you can buy but the contract will not let you sell — the one flag that ends the conversation", mint: "whoever holds the mint key can print more tokens; your share can be diluted at will", pause: "trading can be paused or wallets blacklisted — the exit door has a lock and you don't hold the key", tax: "a high tax on buys or sells is a toll you pay the deployer on every trade", source: "the code isn't verified — nobody outside the team can read what it actually does", lp: "liquidity is concentrated or unlocked — it can be pulled, and then there is no market", freeze: "a freeze authority exists — your tokens can be frozen in your wallet", proxy: "the contract can be swapped for different code later — what you audited today may not be what runs tomorrow", owner: "the owner keeps powers over the contract; renounced ownership is what 'can't rug' actually means" };
    el.innerHTML = '<div class="dx-read"><p class="why"><b>✦ DeXaI Scan:</b> ' + (v ? v.em + " " + esc(v.label) + " (" + v.risk + "/100). " : "") + (bad.length ? "Plain words for each flag:" : "No structural red flags. That is not the same as safe — it means the contract doesn't have a trapdoor GoPlus can see. Price can still go to zero the honest way.") + "</p>" + bad.map(function (f) { return '<p class="why">• <b>' + esc(f.label) + ":</b> " + esc(say[f.k] || f.txt || "flagged") + "</p>"; }).join("") + '<p class="why" style="color:var(--muted,#8fa4c4)">Sandbox rule: if you would not explain a flag to a friend in one sentence, do not trade past it. Source: GoPlus, pattern-based.</p></div>';
  }

  /* ---------------------------------------------------------- surfaces: Read card (coin page) */
  function mountRead() {
    var sym; try { sym = S.coin; } catch (e) { return; } var host = $("cv-kpis"); if (!host || !sym) return;
    var el = $("dlCoinAI"); if (el && el.dataset.dx === sym) return;
    if (!el) { el = document.createElement("div"); el.id = "dlCoinAI"; host.insertAdjacentElement("afterend", el); }
    el.dataset.dx = sym; el.classList.add("dx");
    var F = new Facts(), r = readCoin(F, sym, true); if (!r) return;
    el.innerHTML = '<div class="h">✦ DeXaI Read · ' + esc(sym) + '<span style="flex:1"></span><span style="font:500 10.5px var(--mono,monospace);color:var(--muted)">' + esc(NANO.st === "ready" ? "on-device + Chrome model" : "on-device") + '</span></div><div class="body">' + r.html + F.foot("on-device composer", null, true) + '</div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="ask" id="dlAskAI">Ask DeXaI about ' + esc(sym) + ' →</button><button class="ask" data-q="Forecast ' + esc(sym) + ' 7d">Forecast</button><button class="ask" data-q="News on ' + esc(sym) + '">Wire</button><button class="ask" data-q="Alert me when ' + esc(sym) + ' moves 5% in an hour">Alert</button></div>';
    el.querySelector("#dlAskAI").onclick = function () { ask("Read " + sym); };
    el.querySelectorAll("button[data-q]").forEach(function (b) { b.onclick = function () { ask(b.getAttribute("data-q")); }; });
    if (NANO.st === "ready" && cfg().mode !== "quick") { narrate(F, "Read " + sym, "Give a calm two-sentence read of this coin's tape.", { html: "" }).then(function (a) { if (a && a.html && el.dataset.dx === sym) { var b = el.querySelector(".body"); b.insertAdjacentHTML("afterbegin", a.html); } }); }
  }
  /* ---------------------------------------------------------- surfaces: Market read card */
  function mountMarket() {
    var anchor = $("dlCycle"); if (!anchor) return; var el = $("dxMarketCard");
    if (el && Date.now() - (+el.dataset.at || 0) < 6e4) return;
    if (!el) { el = document.createElement("div"); el.id = "dxMarketCard"; el.className = "card dl154"; el.style.marginTop = "12px"; anchor.insertAdjacentElement("afterend", el); }
    el.dataset.at = Date.now(); var F = new Facts(), r = readMarket(F, !!(window.DLSECTORS && DLSECTORS.last()));
    el.innerHTML = '<div class="h">✦ DeXaI market read<span class="sp"></span><button class="dl-b" id="dxMkMore">more ▾</button><button class="dl-b" id="dxMkAsk">Ask →</button></div>' + r.html.replace('<div class="dx-read">', '<div class="dx-read dx-fold">') + F.foot("on-device composer", null, true);
    $("dxMkMore").onclick = function () { var d = el.querySelector(".dx-read"); d.classList.toggle("dx-fold"); this.textContent = d.classList.contains("dx-fold") ? "more ▾" : "less ▴"; };
    $("dxMkAsk").onclick = function () { ask("Market state"); };
  }
  /* ---------------------------------------------------------- surfaces: Brief (Daily Bridge) */
  (function wrapBrief() { var _db = window.dailyBrief; if (typeof _db !== "function" || _db.__dexai) return; var w = function () { var r = _db.apply(this, arguments); setTimeout(function () { try { var b = document.querySelector("#modalRoot .brief"); if (!b || b.querySelector(".dx-brief")) return; var F = new Facts(), m = readMarket(F, false), bk = readBook(new Facts(), false), cr = coachReport(); var d = document.createElement("div"); d.className = "dx-brief"; d.innerHTML = "<h4>✦ DeXaI read</h4>" + m.html + bk.html + (cr.n ? '<span class="bl">🧭 Coach: ' + esc(cr.fix) + "</span>" : "") + F.foot("on-device composer"); b.appendChild(d); } catch (e) {} }, 80); return r; }; w.__dexai = 1; window.dailyBrief = w; })();

  /* ---------------------------------------------------------- surfaces: Desk (the chat panel, upgraded in place) */
  var CHAT = { panel: null, bar: null };
  function ask(q) { try { if (window.NXCHAT) { NXCHAT.open(); setTimeout(function () { NXCHAT.ask(q); }, 260); } else if (window.ORACLE) { ORACLE.open(); setTimeout(function () { ORACLE.ask(q); }, 260); } } catch (e) {} }
  function greetHTML() { var st = status(); return '<span class="ttl">DeXaI · your ladder copilot</span><p>I read what this app already knows — prices, the wire, your paper book and journal, the Academy — and I say it plainly. <b>Every number you see from me is pulled by a tool and marked with its source and age.</b> I don’t predict, I don’t advise, and I say so when I can’t ground something.</p><p style="margin-top:6px;font-size:12px;color:var(--muted,#8fa4c4)">' + esc(st.provider) + " · " + esc(st.priv) + " · memory " + st.memDays + 'd — change these in the bar below.</p><div class="src">◈ runs on your device · sources named on every number</div>'; }
  function ctxChips() { var v = null, sym = null; try { v = S.view; sym = S.coin; } catch (e) {} if (v === "coin" && sym) return ["Read " + sym, "Forecast " + sym + " 7d", "Alert me when " + sym + " moves 5% in an hour"]; if (v === "portfolio" || v === "trade") return ["My book", "Coach me", "Market state"]; if (v === "learn") return ["Explain it simpler", "Quiz me", "Connect this to today's market"]; if (v === "news") return ["What's happening?", "News on BTC", "Sectors"]; return ["Market state", "Read BTC", "Show me oversold large caps"]; }
  function paintBar() {
    var bar = CHAT.bar; if (!bar) return; var d = cfg(), st = status();
    bar.innerHTML = '<button class="dx-gear" data-gear="1" title="DeXaI settings">' + esc(MODES[d.mode] || "Quick") + " · " + esc(PRIV[d.priv] || "Device-only") + " · mem " + (d.win ? d.win + "d" : "off") + ' ⚙</button><span class="dx-sets"><span class="seg" title="Quick: on-device only, instant · Deep: more tools + model prose · Research: everything">' + Object.keys(MODES).map(function (k) { return '<button data-mode="' + k + '"' + (d.mode === k ? ' class="on"' : "") + ">" + MODES[k] + "</button>"; }).join("") + '</span><span class="seg" title="Where your question may go. Device-only never sends it anywhere.">' + Object.keys(PRIV).map(function (k) { return '<button data-priv="' + k + '"' + (d.priv === k ? ' class="on"' : "") + ">" + PRIV[k] + "</button>"; }).join("") + '</span><select data-win title="Memory window — on this device only">' + [0, 7, 30, 90, 180].map(function (n) { return '<option value="' + n + '"' + (d.win === n ? " selected" : "") + ">" + (n ? "mem " + n + "d" : "mem off") + "</option>"; }).join("") + '</select></span><span style="flex:1"></span><span title="provider">' + esc(NANO.st === "ready" ? "⚡ Chrome model" : NANO.st === "downloadable" ? "Chrome model downloadable" : "on-device") + (d.gw ? " · gw" : "") + "</span>";
  }
  function upgradePanel() {
    var p = $("nxChat"); if (!p || p.__dx) return; p.__dx = 1; CHAT.panel = p;
    var tt = p.querySelector(".nxc-tt b"); if (tt) tt.textContent = "DeXaI"; p.setAttribute("aria-label", "DeXaI chat");
    var inp = p.querySelector("#nxcIn"); if (inp) { inp.placeholder = "Ask DeXaI — a coin, the market, your book, a lesson…"; inp.setAttribute("aria-label", "Ask DeXaI"); }
    var bar = document.createElement("div"); bar.id = "dxBar"; bar.className = "dx-bar"; CHAT.bar = bar; p.insertBefore(bar, p.querySelector(".nxc-in")); paintBar();
    bar.addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; if (b.dataset.gear) { bar.classList.toggle("open"); return; } var d = X(); if (!d) return; if (b.dataset.mode) d.mode = b.dataset.mode; if (b.dataset.priv) d.priv = b.dataset.priv; C.save(); paintBar(); });
    bar.addEventListener("change", function (e) { var s = e.target.closest("select[data-win]"); if (!s) return; var d = X(); if (!d) return; d.win = +s.value; C.save(); paintBar(); });
    var body = p.querySelector("#nxcBody");
    function fixGreet() { var first = body && body.querySelector(".nxc-m.a"); if (first && /Ask me anything across <b>blockchain/.test(first.innerHTML)) { first.innerHTML = greetHTML(); var sug = p.querySelector(".nxc-sug"); if (sug) sug.innerHTML = ctxChips().map(function (x) { return '<button data-q="' + esc(x) + '">' + esc(x) + "</button>"; }).join(""); } }
    fixGreet(); new MutationObserver(fixGreet).observe(body, { childList: true });
    new MutationObserver(function () { if (p.classList.contains("on")) { paintBar(); var sug = p.querySelector(".nxc-sug"); if (sug && body.querySelectorAll(".nxc-m").length <= 1) sug.innerHTML = ctxChips().map(function (x) { return '<button data-q="' + esc(x) + '">' + esc(x) + "</button>"; }).join(""); } }).observe(p, { attributes: true, attributeFilter: ["class"] });
    var orb = $("sv82-chip"); if (orb) { orb.setAttribute("title", "DeXaI — ask anything: a coin, the market, your book"); orb.setAttribute("aria-label", "Open DeXaI"); }
  }
  new MutationObserver(function () { if ($("nxChat")) upgradePanel(); }).observe(document.body, { childList: true });
  if ($("nxChat")) upgradePanel();
  /* resolver in front of the legacy chain */
  (function hookChat() { var n = 0, iv = setInterval(function () { if (window.NXCHAT && NXCHAT.resolvers) { clearInterval(iv); if (!NXCHAT.resolvers.some(function (r) { return r.__dexai; })) NXCHAT.resolvers.unshift({ __dexai: 1, re: /[\s\S]/, run: function (q) { return answer(q); } }); try { var orb = $("sv82-chip"); if (orb) orb.setAttribute("title", "DeXaI — ask anything: a coin, the market, your book"); } catch (e) {} } else if (++n > 200) clearInterval(iv); }, 250); })();
  /* privacy law for the legacy relay: Device-only blocks the open neural relay; other modes space it to the 2026 keyless limit */
  (function guardRelay() { var _f = window.fetch; if (!_f || _f.__dxGuard) return; var last = 0; var w = function (u, o) { try { var s = typeof u === "string" ? u : u && u.url || ""; if (/text\.pollinations\.ai/.test(s)) { var d = cfg(); if (d.priv === "device") return Promise.resolve(new Response(null, { status: 204 })); var wait = Math.max(0, last + 15000 - Date.now()); last = Date.now() + wait; if (wait) return new Promise(function (res) { setTimeout(function () { res(_f.call(window, u, o)); }, wait); }); } } catch (e) {} return _f.call(window, u, o); }; w.__dxGuard = 1; Object.keys(_f).forEach(function (k) { try { w[k] = _f[k]; } catch (e) {} }); window.fetch = w; })();

  C.onPage("coin", mountRead);
  C.onPage("markets", mountMarket);
  C.onPage("learn", mountTutor);
  C.onTick(function (n) { if (n % 20 === 0 && S.view === "markets") mountMarket(); });
  nanoProbe().then(function () { try { paintBar(); } catch (e) {} });
  C.cmd("dexai", "DeXaI — ask anything: a coin, the market, your book", "✦", function () { ask("What can you do?"); });
  C.cmd("coach", "DeXaI Coach — your journal tagged and scored", "🧭", coachSheet);
  if (window.DLDESKS) DLDESKS.register("coach", "🧭", "Coach", "your journal, tagged and scored", coachSheet);
  return { __v: 154, answer: answer, ask: ask, tools: T, Facts: Facts, render: renderProse, coach: coachSheet, report: coachReport, scan: scan, lens: lens, tutor: tutor, event: event, status: status, confirm: confirm, cancel: cancel, forget: forget, mem: memWindow, probe: nanoProbe, cfg: X, intents: INTENTS, read: mountRead, market: mountMarket };
})();
