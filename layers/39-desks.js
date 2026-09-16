/* ============================================================
   DLDESKS · v154 — the Desks rail + four metric-named desks
   · Desks rail on Markets: every v154 desk one tap away (the IA move
     CMC's menu can't make — pages named after the question, not the asset)
   · Chain Ladder — TVL · DEX volume · fees · stablecoin cap per chain
     (DefiLlama free endpoints), native token → coin page
   · Venue Board — CEX (CoinGecko trust score, volume, country, year) and
     DEX (DefiLlama volumes) with "fill quality for your size" from the
     DLSIM venue overlay
   · Yield Sandbox — DefiLlama pools you can paper-stake (APY accrues
     daily on paper; IL and smart-contract risk are named, not modelled)
   · Convert — 30+ fiats (open.er-api) and time-travel conversion via
     CoinGecko's dated history (what was 1 ETH worth on a date, in INR)
   ============================================================ */
window.DLDESKS = (function () {
  "use strict";
  if (window.DLDESKS && window.DLDESKS.__v) return window.DLDESKS;
  var C = window.DLCORE, $ = C.$, esc = C.esc;
  var CGB = (function () { try { return typeof CG === "string" ? CG : "https://api.coingecko.com/api/v3"; } catch (e) { return "https://api.coingecko.com/api/v3"; } })();
  var LL = "https://api.llama.fi";
  var DESKS = [];
  function reg(id, ic, name, note, fn) { DESKS.push({ id: id, ic: ic, name: name, note: note, fn: fn }); var r = $("dlDesksRail"); r && paintRail(); }
  function paintRail() { var r = $("dlDesksRail"); if (!r) return; r.querySelector(".dl-chips").innerHTML = DESKS.map(function (d) { return '<button class="dl-chip" data-desk="' + esc(d.id) + '" title="' + esc(d.note) + '">' + d.ic + " " + esc(d.name) + "</button>"; }).join(""); }
  function mountRail() {
    var host = $("dlIntelCard") || $("dlSignals"); if (!host || $("dlDesksRail")) return;
    var box = document.createElement("div"); box.id = "dlDesksRail"; box.className = "dl154";
    box.innerHTML = '<div class="h">🗂 Desks <span style="font:500 11px var(--ui-sans,sans-serif);color:var(--muted)">· named after the question, not the coin</span></div><div class="dl-chips" style="margin:0"></div>';
    host.insertAdjacentElement("afterend", box);
    box.addEventListener("click", function (e) { var b = e.target.closest("[data-desk]"); if (!b) return; var d = DESKS.filter(function (x) { return x.id === b.getAttribute("data-desk"); })[0]; d && d.fn(); });
    paintRail();
  }

  /* ---------------------------------------------------------- Chain Ladder */
  function chainData() {
    return Promise.all([
      C.jget(LL + "/v2/chains", { key: "ll.chains", ttl: 6e5, ms: 12000 }),
      C.jget(LL + "/overview/dexs?excludeTotalDataChart=true", { key: "ll.dexs", ttl: 6e5, ms: 15000 }).catch(function () { return null; }),
      C.jget(LL + "/overview/fees?excludeTotalDataChart=true", { key: "ll.fees", ttl: 6e5, ms: 15000 }).catch(function () { return null; }),
      C.jget("https://stablecoins.llama.fi/stablecoinchains", { key: "ll.stablechains", ttl: 6e5, ms: 12000 }).catch(function () { return null; })
    ]).then(function (rs) {
      var chains = (rs[0].data || []).filter(function (c) { return c && c.tvl > 0; });
      function lastBreak(r) { var b = r && r.data && r.data.totalDataChartBreakdown; if (!Array.isArray(b) || !b.length) return {}; var last = b[b.length - 1]; return (last && last[1]) || {}; }
      var dexBy = lastBreak(rs[1]), feeBy = lastBreak(rs[2]);
      var stBy = {}; ((rs[3] && rs[3].data) || []).forEach(function (s) { stBy[s.name] = s.totalCirculatingUSD && +s.totalCirculatingUSD.peggedUSD || 0; });
      var list = chains.map(function (c) { return { name: c.name, tvl: +c.tvl, sym: c.tokenSymbol, id: c.gecko_id, dex: +dexBy[c.name] || 0, fees: +feeBy[c.name] || 0, stable: +stBy[c.name] || 0 }; }).sort(function (a, b) { return b.tvl - a.tvl; }).slice(0, 40);
      return { list: list, at: rs[0].at, stale: rs[0].stale, hasDex: !!Object.keys(dexBy).length, hasFees: !!Object.keys(feeBy).length, hasSt: !!Object.keys(stBy).length };
    });
  }
  function chainLadder() {
    C.open("dlChains", { title: "⛓ Chain Ladder", sub: "TVL · DEX volume · fees · stablecoin cap — DefiLlama, keyless", tabs: [], onTab: function (t, body) {
      body.innerHTML = C.skel(6);
      chainData().then(function (d) {
        var ladder = new Set(C.coinsAll().map(function (c) { return c.sym; }));
        body.innerHTML = '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>#</th><th>Chain</th><th class="r">TVL</th><th class="r">24h DEX vol</th><th class="r">24h fees</th><th class="r">Stablecoins</th><th class="r">Vol / TVL</th><th>Token</th></tr></thead><tbody>' + d.list.map(function (c, i) { var sym = (c.sym || "").toUpperCase(); return "<tr><td>" + (i + 1) + "</td><td><b>" + esc(c.name) + '</b></td><td class="r">' + C.big(c.tvl) + '</td><td class="r">' + (c.dex ? C.big(c.dex) : "—") + '</td><td class="r">' + (c.fees ? C.big(c.fees) : "—") + '</td><td class="r">' + (c.stable ? C.big(c.stable) : "—") + '</td><td class="r">' + (c.dex ? (c.dex / c.tvl * 100).toFixed(1) + "%" : "—") + "</td><td>" + (sym && ladder.has(sym) ? '<button class="dl-b" data-coin="' + esc(sym) + '">' + esc(sym) + "</button>" : esc(sym || "—")) + "</td></tr>"; }).join("") + "</tbody></table></div>" +
          '<div class="dl-formula">' + C.prov("DefiLlama", d.at, d.stale) + "\nvol / TVL = 24h DEX volume ÷ TVL — how hard the locked capital works" + (!d.hasDex ? "\nDEX volume breakdown unavailable right now" : "") + (!d.hasFees ? "\nfees breakdown unavailable right now" : "") + (!d.hasSt ? "\nstablecoin breakdown unavailable right now" : "") + "</div>";
        body.querySelectorAll("[data-coin]").forEach(function (b) { b.onclick = function () { C.close("dlChains"); openCoin(b.getAttribute("data-coin")); }; });
      }).catch(function (e) { body.innerHTML = '<div class="dl-empty">' + esc(e.message || e) + "</div>"; });
    } });
  }

  /* ---------------------------------------------------------- Venue Board */
  function slipFor(venueKey, usd) { try { var V = window.DLSIM && DLSIM.VEN && DLSIM.VEN[venueKey]; if (!V) return null; var bps = 1.4; /* liquidity-scaled tier for a major */ return { fee: V.t * 100, slip: bps / 100, gas: V.gas, total: usd * (V.t + bps / 1e4) + V.gas, d: V.d }; } catch (e) { return null; } }
  var VKEY = { binance: "binance", gdax: "coinbase", kraken: "kraken", hyperliquid: "hyperliquid" };
  function venueBoard(tab) {
    C.open("dlVenueBoard", { title: "🏦 Venue Board", sub: "CoinGecko trust · DefiLlama volumes · your fill cost from the Pro execution overlay", tabs: [["cex", "CEX"], ["dex", "DEX"]], onTab: function (t, body) {
      body.innerHTML = C.skel(6);
      if (t === "cex") C.jget(CGB + "/exchanges?per_page=50&page=1", { key: "cg.exch", ttl: 6e5, ms: 12000 }).then(function (r) {
        var list = (r.data || []).slice(0, 40);
        body.innerHTML = '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>#</th><th>Venue</th><th>Trust</th><th class="r">24h vol (BTC)</th><th>Country</th><th class="r">Since</th><th class="r">Fill $1k (fee+slip+gas)</th></tr></thead><tbody>' + list.map(function (x, i) { var s = slipFor(VKEY[x.id], 1000); return "<tr><td>" + (i + 1) + "</td><td><b>" + esc(x.name) + '</b></td><td>' + (x.trust_score != null ? '<span class="' + (x.trust_score >= 8 ? "up" : x.trust_score >= 6 ? "" : "dn") + '">' + x.trust_score + "/10</span>" : "—") + '</td><td class="r">' + (+x.trade_volume_24h_btc || 0).toLocaleString(undefined, { maximumFractionDigits: 0 }) + "</td><td>" + esc(x.country || "—") + '</td><td class="r">' + (x.year_established || "—") + '</td><td class="r">' + (s ? "$" + s.total.toFixed(2) + ' <span style="opacity:.6">' + s.fee.toFixed(2) + "% + " + s.slip.toFixed(2) + "%</span>" : "—") + "</td></tr>"; }).join("") + "</tbody></table></div>" +
          '<div class="dl-formula">' + C.prov("CoinGecko exchanges", r.at, r.stale) + "\nfill cost = venue taker fee × $1,000 + liquidity-scaled slippage (1.4 bp tier for a major) + gas — the same overlay the Pro execution mode charges your paper orders; venues without an overlay show —\nTrust is CoinGecko’s score (liquidity, scale, cyber-security, legal). Volume alone can be printed; trust is harder to fake.</div>";
      }).catch(function (e) { body.innerHTML = '<div class="dl-empty">' + esc(e.message || e) + "</div>"; });
      else C.jget(LL + "/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true", { key: "ll.dexs.slim", ttl: 6e5, ms: 15000 }).then(function (r) {
        var list = (r.data.protocols || []).filter(function (p) { return p.total24h > 0; }).sort(function (a, b) { return b.total24h - a.total24h; }).slice(0, 40);
        var s = slipFor("dexamm", 1000);
        body.innerHTML = '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>#</th><th>DEX</th><th class="r">24h volume</th><th class="r">7d volume</th><th>Chains</th></tr></thead><tbody>' + list.map(function (p, i) { return "<tr><td>" + (i + 1) + "</td><td><b>" + esc(p.name) + '</b></td><td class="r">' + C.big(p.total24h) + '</td><td class="r">' + (p.total7d ? C.big(p.total7d) : "—") + "</td><td>" + esc((p.chains || []).slice(0, 4).join(", ")) + ((p.chains || []).length > 4 ? " +" + (p.chains.length - 4) : "") + "</td></tr>"; }).join("") + "</tbody></table></div>" +
          '<div class="dl-formula">' + C.prov("DefiLlama DEX volumes", r.data && r.at, r.stale) + (s ? "\nAMM fill for $1,000 in the Pro overlay: $" + s.total.toFixed(2) + " (0.30% LP fee + slippage + ~$2.20 gas) — pool-specific slippage lives in Pool Radar" : "") + "\nRanked by reported 24h volume; DefiLlama de-duplicates wash-heavy sources where it can, not always.</div>";
      }).catch(function (e) { body.innerHTML = '<div class="dl-empty">' + esc(e.message || e) + "</div>"; });
    } }, tab || "cex");
  }

  /* ---------------------------------------------------------- Yield Sandbox */
  var YCACHE = null, YAT = 0;
  function pools() {
    if (YCACHE && Date.now() - YAT < 18e5) return Promise.resolve({ list: YCACHE, at: YAT, stale: false });
    return C.jget("https://yields.llama.fi/pools", { key: "ll.yields", ttl: 0, ms: 25000 }).then(function (r) {
      var d = (r.data && r.data.data) || []; var list = d.filter(function (p) { return p && p.tvlUsd > 5e6 && p.apy > 0 && p.apy < 200; }).sort(function (a, b) { return b.tvlUsd - a.tvlUsd; }).slice(0, 300).map(function (p) { return { id: p.pool, chain: p.chain, project: p.project, sym: p.symbol, tvl: +p.tvlUsd, apy: +p.apy, base: +p.apyBase || 0, rew: +p.apyReward || 0, stable: !!p.stablecoin, il: p.ilRisk === "yes", single: p.exposure === "single", il7d: p.il7d != null ? +p.il7d : null }; });
      YCACHE = list; YAT = r.at; return { list: list, at: r.at, stale: r.stale };
    });
  }
  function Y() { var x = C.X(); if (!x) return null; x.yield || (x.yield = []); return x.yield; }
  function stakeValue(s) { var days = (Date.now() - s.t) / 864e5; return s.usd * Math.pow(1 + s.apy / 100, days / 365); }
  function stake(p, usd) {
    var y = Y(); if (!y) return; usd = +usd; if (!(usd > 0)) return;
    try { var bal = S.bal.USDT || 0; if (usd > bal) { C.toast("bad", "Not enough paper USDT", "You have " + C.money(bal, 2) + " on the main book"); return; } S.bal.USDT = bal - usd; } catch (e) { return; }
    y.unshift({ id: p.id, chain: p.chain, project: p.project, sym: p.sym, apy: p.apy, usd: usd, t: Date.now(), stable: p.stable, il: p.il }); if (y.length > 40) y.pop();
    C.save(); try { updateNavBal(); } catch (e) {} C.sfx("buy"); C.toast("good", "Paper-staked" + C.simTag(), C.money(usd, 2) + " into " + p.project + " " + p.sym + " at " + p.apy.toFixed(2) + "% APY (observed today, not promised)");
    C.xp("yield.first", 15, "First paper stake — yield is a rate, not a guarantee");
  }
  function unstake(i) { var y = Y(); var s = y && y[i]; if (!s) return; var v = stakeValue(s); try { S.bal.USDT = (S.bal.USDT || 0) + v; updateNavBal(); } catch (e) {} y.splice(i, 1); C.save(); C.sfx("sell"); C.toast("good", "Unstaked" + C.simTag(), C.money(v, 2) + " back to the main book (+" + C.money(v - s.usd, 2) + " paper yield)"); }
  var YF = { stable: false, single: false, chain: "" };
  function yieldSandbox(tab) {
    C.open("dlYield", { title: "🌾 Yield Sandbox", sub: "DefiLlama pools · paper-staked from your main book · APRs are observed, not promised", tabs: [["pools", "Pools"], ["mine", "My stakes"]], onTab: function (t, body) {
      if (t === "mine") { var y = Y() || []; body.innerHTML = '<div class="dl154"><div class="h">My paper stakes ' + C.simTag() + "</div>" + (y.length ? y.map(function (s, i) { var v = stakeValue(s); return '<div class="kv"><span><b>' + esc(s.project) + " · " + esc(s.sym) + '</b><br><span style="opacity:.6">' + esc(s.chain) + " · " + s.apy.toFixed(2) + "% APY at stake time · " + C.ago(s.t) + (s.il ? " · IL risk named, not modelled" : "") + "</span></span><b>" + C.money(v, 2) + ' <span class="up">+' + C.money(v - s.usd, 2) + '</span> <button class="dl-b" data-un="' + i + '">Unstake</button></b></div>'; }).join("") : '<div class="dl-empty">Nothing staked. Pick a pool.</div>') + '<div class="n">Accrual = principal × (1 + APY)^(days/365) at the APY you saw when you staked. Real yields move daily; impermanent loss and contract risk are why the Academy IL lab exists.</div></div>'; body.querySelectorAll("[data-un]").forEach(function (b) { b.onclick = function () { unstake(+b.getAttribute("data-un")); yieldSandbox("mine"); }; }); return; }
      body.innerHTML = C.skel(6);
      pools().then(function (r) {
        var chains = {}; r.list.forEach(function (p) { chains[p.chain] = (chains[p.chain] || 0) + 1; });
        var list = r.list.filter(function (p) { return (!YF.stable || p.stable) && (!YF.single || p.single) && (!YF.chain || p.chain === YF.chain); }).slice(0, 60);
        body.innerHTML = '<div class="dl-chips"><button class="dl-chip' + (YF.stable ? " on" : "") + '" data-f="stable">Stablecoins only</button><button class="dl-chip' + (YF.single ? " on" : "") + '" data-f="single">Single-asset only</button>' + Object.keys(chains).sort(function (a, b) { return chains[b] - chains[a]; }).slice(0, 8).map(function (c) { return '<button class="dl-chip' + (YF.chain === c ? " on" : "") + '" data-chain="' + esc(c) + '">' + esc(c) + "</button>"; }).join("") + "</div>" +
          '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Pool</th><th>Chain</th><th class="r">TVL</th><th class="r">APY</th><th class="r">base + reward</th><th>Risk notes</th><th></th></tr></thead><tbody>' + list.map(function (p, i) { return "<tr><td><b>" + esc(p.project) + "</b><br><span style='opacity:.6'>" + esc(p.sym) + "</span></td><td>" + esc(p.chain) + '</td><td class="r">' + C.big(p.tvl) + '</td><td class="r"><b>' + p.apy.toFixed(2) + '%</b></td><td class="r">' + p.base.toFixed(2) + "% + " + p.rew.toFixed(2) + "%</td><td>" + (p.stable ? "stable · " : "") + (p.il ? '<span class="dn">IL risk</span>' : "no IL") + (p.single ? " · single" : " · LP") + '</td><td><div style="display:flex;gap:4px"><input class="dl-inp" data-amt="' + i + '" type="number" value="500" style="width:90px"><button class="dl-b pri" data-stake="' + i + '">Stake</button></div></td></tr>'; }).join("") + "</tbody></table></div>" +
          '<div class="dl-formula">' + C.prov("DefiLlama yields", r.at, r.stale) + "\nfilters: TVL > $5M, 0 < APY < 200% · top 300 by TVL · reward APY is often a token emission that decays — treat it as the flimsy half\nCMC’s yield page is a list; this one lets you feel a rate compound (on paper) and then sends you to the IL lab.</div>";
        body.querySelectorAll("[data-f]").forEach(function (b) { b.onclick = function () { YF[b.getAttribute("data-f")] = !YF[b.getAttribute("data-f")]; yieldSandbox("pools"); }; });
        body.querySelectorAll("[data-chain]").forEach(function (b) { b.onclick = function () { YF.chain = YF.chain === b.getAttribute("data-chain") ? "" : b.getAttribute("data-chain"); yieldSandbox("pools"); }; });
        body.querySelectorAll("[data-stake]").forEach(function (b) { b.onclick = function () { var i = +b.getAttribute("data-stake"); stake(list[i], (body.querySelector('[data-amt="' + i + '"]') || {}).value); }; });
      }).catch(function (e) { body.innerHTML = '<div class="dl-empty">Yield feed unreachable — ' + esc(e.message || e) + "</div>"; });
    } }, tab || "pools");
  }

  /* ---------------------------------------------------------- Convert (30+ fiats, time travel) */
  var FIATS = ["USD", "EUR", "INR", "GBP", "JPY", "AED", "SGD", "CAD", "AUD", "CHF", "BRL", "KRW", "CNY", "TRY", "NGN", "ZAR", "MXN", "IDR", "PHP", "VND", "PKR", "BDT", "THB", "MYR", "SAR", "EGP", "RUB", "PLN", "SEK", "NOK", "HKD", "NZD"];
  function fx() { return C.jget("https://open.er-api.com/v6/latest/USD", { key: "fx.all", ttl: 216e5, ms: 9000 }).then(function (r) { return { rates: r.data.rates || {}, at: r.at, stale: r.stale }; }); }
  function histPrice(id, dateStr) { var d = new Date(dateStr); var dd = String(d.getUTCDate()).padStart(2, "0") + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + d.getUTCFullYear(); return C.jget(CGB + "/coins/" + id + "/history?date=" + dd + "&localization=false", { key: "cg.hist." + id + "." + dd, ttl: 6048e5, ms: 12000 }).then(function (r) { return (r.data && r.data.market_data && r.data.market_data.current_price) || null; }); }
  var CV = { amt: 1, from: "BTC", to: "INR", date: "" };
  function convert() {
    C.open("dlConvert", { title: "🔁 Convert", sub: "crypto ↔ 32 fiats · live, or on any past date", tabs: [], onTab: function (t, body) {
      var all = C.coinsAll().slice(0, 300);
      function opts(sel) { return '<optgroup label="Crypto">' + all.map(function (c) { return '<option value="' + esc(c.sym) + '"' + (sel === c.sym ? " selected" : "") + ">" + esc(c.sym) + " · " + esc(c.name) + "</option>"; }).join("") + '</optgroup><optgroup label="Fiat">' + FIATS.map(function (f) { return '<option value="' + f + '"' + (sel === f ? " selected" : "") + ">" + f + "</option>"; }).join("") + "</optgroup>"; }
      body.innerHTML = '<div class="dl154"><div class="dl-2"><div><label class="n" style="margin:0 0 4px;display:block">Amount</label><input class="dl-inp" id="dlCvAmt" type="number" step="any" value="' + CV.amt + '"></div><div><label class="n" style="margin:0 0 4px;display:block">On date (optional · time travel)</label><input class="dl-inp" id="dlCvDate" type="date" value="' + esc(CV.date) + '" max="' + new Date().toISOString().slice(0, 10) + '"></div></div><div class="dl-2" style="margin-top:8px"><div><label class="n" style="margin:0 0 4px;display:block">From</label><select class="dl-inp" id="dlCvFrom">' + opts(CV.from) + '</select></div><div><label class="n" style="margin:0 0 4px;display:block">To</label><select class="dl-inp" id="dlCvTo">' + opts(CV.to) + '</select></div></div><div class="dl-conv"><div class="out" id="dlCvOut">…</div></div><div class="n" id="dlCvNote"></div></div>';
      ["dlCvAmt", "dlCvDate", "dlCvFrom", "dlCvTo"].forEach(function (id) { $(id).addEventListener("input", run); $(id).addEventListener("change", run); });
      run();
      function run() {
        CV.amt = +$("dlCvAmt").value || 0; CV.date = $("dlCvDate").value; CV.from = $("dlCvFrom").value; CV.to = $("dlCvTo").value;
        var out = $("dlCvOut"), note = $("dlCvNote"); out.textContent = "…";
        var isF = function (s) { return FIATS.indexOf(s) > -1; };
        fx().then(function (f) {
          var usdOf = function (s, hist) { if (s === "USD") return 1; if (isF(s)) return f.rates[s] ? 1 / f.rates[s] : null; var c = C.coin(s); if (!c) return null; if (hist && hist[s] && hist[s].usd) return hist[s].usd; return c.price || null; };
          var render = function (hist, src) { var a = usdOf(CV.from, hist), b = usdOf(CV.to, hist); if (!a || !b) { out.textContent = "No rate for that pair"; return; } var v = CV.amt * a / b; out.textContent = (v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v.toLocaleString(undefined, { maximumFractionDigits: v >= 1 ? 4 : 8 })) + " " + CV.to; note.innerHTML = "1 " + esc(CV.from) + " = " + (a / b >= 1000 ? (a / b).toLocaleString(undefined, { maximumFractionDigits: 2 }) : (a / b).toPrecision(6)) + " " + esc(CV.to) + " · " + esc(src) + (isF(CV.from) || isF(CV.to) ? " · FX " + C.ago(f.at) + " (open.er-api)" : ""); };
          if (CV.date) { var ids = [CV.from, CV.to].filter(function (s) { return !isF(s) && s !== "USD"; }); Promise.all(ids.map(function (s) { var c = C.coin(s); return histPrice(c.id, CV.date).then(function (p) { return [s, p]; }); })).then(function (rs) { var hist = {}; rs.forEach(function (r) { if (r[1]) hist[r[0]] = { usd: r[1].usd }; }); render(hist, "CoinGecko history for " + CV.date + " (today’s FX for fiat legs)"); }).catch(function (e) { out.textContent = "No history for that date"; }); }
          else render(null, "live ladder · " + (window.DLBX ? DLBX.status().src || "cache" : "cache"));
        }).catch(function () { out.textContent = "FX unreachable"; });
      }
    } });
  }

  reg("chains", "⛓", "Chain Ladder", "TVL · DEX volume · fees · stablecoins per chain", chainLadder);
  reg("venues", "🏦", "Venue Board", "CEX trust & volume · DEX volume · your fill cost", venueBoard);
  reg("yield", "🌾", "Yield Sandbox", "paper-stake DefiLlama pools", yieldSandbox);
  reg("convert", "🔁", "Convert", "32 fiats · any past date", convert);
  if (window.DLRADAR) reg("radar", "📡", "Pool Radar", "DEX pools · scan · practise", function () { DLRADAR.open("trend"); });
  if (window.DLODDS) reg("odds", "🎲", "Odds Desk", "paper-trade live odds", function () { DLODDS.open("crypto"); });
  if (window.DLWEATHER) reg("weather", "⚡", "Leverage Weather", "funding · OI · liquidations", function () { DLWEATHER.open("perps"); });
  if (window.DLSECTORS) reg("sectors", "◈", "Sectors", "narrative rotation", function () { DLSECTORS.open("rot"); });
  if (window.DLCLOCK) reg("clock", "🕰", "Chain Clock", "events the chain decides", function () { DLCLOCK.open(); });
  C.cmd("chain ladder", "Chain Ladder — TVL, DEX volume, fees, stablecoins per chain", "⛓", chainLadder);
  C.cmd("venue board", "Venue Board — CEX trust, DEX volume, your fill cost", "🏦", function () { venueBoard("cex"); });
  C.cmd("yield sandbox", "Yield Sandbox — paper-stake live DefiLlama pools", "🌾", function () { yieldSandbox("pools"); });
  C.cmd("convert", "Convert — 32 fiats, any past date", "🔁", convert);
  C.onPage("markets", mountRail);
  return { __v: 154, register: reg, chainLadder: chainLadder, venueBoard: venueBoard, yieldSandbox: yieldSandbox, convert: convert, stakes: Y, stakeValue: stakeValue, pools: pools, fiats: FIATS };
})();
