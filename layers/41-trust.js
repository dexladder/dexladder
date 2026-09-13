/* ============================================================
   DLTRUST · v154 — Trust: model card · laws · feed diagnostics · settings
   · The DeXaI model card in the app's own words, with the numeric-slot
     law, providers, privacy modes and the memory window — and the only
     place a gateway URL is set (pasted by you; the app never holds keys).
   · DexLadder's laws, stated where a user can read them.
   · Feed diagnostics: every host the app talks to, with health, cooldown
     and the 5-rung price ladder's live state.
   · Knowledge-base entries for everything v154 added, so "what is
     funding?" has a grounded answer.
   · Learn-before-leverage: a one-time primer before the perps desk opens.
   ============================================================ */
window.DLTRUST154 = (function () {
  "use strict";
  if (window.DLTRUST154 && window.DLTRUST154.__v) return window.DLTRUST154;
  var C = window.DLCORE, $ = C.$, esc = C.esc;

  /* ---------------------------------------------------------- knowledge base additions (grounded answers for v154 vocabulary) */
  var KB_ADD = [
    ["perpetual|perp|perps|perpetual futures|perpetual swap", "Perpetual futures", "A futures contract with no expiry. Instead of settling on a date, a funding payment passes between longs and shorts every few hours to keep the contract's price pinned to spot. You can go long or short with leverage, and you can be liquidated.", "Perps are where most crypto leverage lives. The Sim desk trades them with paper money on real funding and real liquidation maths — the lesson is the same, the tuition is free.", "trade", "funding rate|liquidation|leverage"],
    ["funding|funding rate|funding payment", "Funding rate", "A small payment, usually every eight hours, from the crowded side of a perpetual to the other side. Positive funding means longs pay shorts — the crowd is long. Negative means shorts pay longs. It is the cost of being positioned, and it never sleeps.", "Leverage Weather reads funding across venues as a mood gauge: crowded longs paying up is what a top often feels like from the inside.", "trade", "perpetual futures|open interest|leverage weather"],
    ["liquidation|liquidated|liq price|liquidations", "Liquidation", "When a leveraged position's losses eat through its margin, the venue closes it by force — at whatever price the book offers. Your position is gone and, on most venues, so is the margin. Cascades happen when many liquidations hit the same thin book at once.", "The liquidation tape in Leverage Weather is those forced closes arriving in real time. Watching them teaches more about leverage than any lesson.", "trade", "leverage|funding rate|perpetual futures"],
    ["leverage|margin|leveraged|10x|20x|50x|100x", "Leverage and margin", "Borrowing to hold a bigger position than your money. 10× leverage means a 10% move against you erases your margin. Leverage does not change whether you are right; it changes how long you can afford to be wrong — and that is usually shorter than the market's patience.", "The Sim desk lets you feel it with paper money first. Learn before you leverage is the only order that works.", "trade", "liquidation|funding rate|volatility and risk"],
    ["open interest|oi", "Open interest", "The total size of all open perpetual positions on a venue. Rising open interest with a rising price means new money is coming in; rising price with falling open interest means shorts are covering, which fades faster.", null, "trade", "perpetual futures|funding rate"],
    ["prediction market|prediction markets|polymarket|odds market|event contract", "Prediction markets", "Markets where a share pays $1 if an event happens and $0 if it does not. The price is the crowd's probability. They are useful because people bet real money on them, and treacherous because thin markets can be pushed.", "Odds lets you buy and sell them with paper money and scores you with a Brier score — the honest way to find out whether you know better than the crowd.", null, "brier score|calibration"],
    ["brier|brier score", "Brier score", "The mean squared error between your stated probability and what happened: forecast 80% and it happens, the error is (1 − 0.8)² = 0.04; it doesn't happen, the error is 0.64. Lower is better; 0.25 is a coin flip; below 0.1 is genuinely good.", "Every forecast you log and every odds position you settle gets one. Coach reads them.", null, "calibration|prediction markets"],
    ["calibration|calibrated|overconfident", "Calibration", "Being right as often as you say you are. If your 80% calls land 80% of the time, you are calibrated; if they land 55%, you are overconfident — the most common and most expensive trading flaw.", "Forecast buckets your logged calls by confidence and shows the hit rate in each. Conviction is free; calibration is earned.", null, "brier score"],
    ["realised volatility|realized volatility|vol|forecast cone|one sigma|sigma", "Realised volatility and the cone", "How much a price actually moved over a window, measured as the standard deviation of its returns. Scaled by the square root of time, it gives a cone: the range price stays inside roughly two-thirds of the time. It is a measure of how wide normal is — not a prediction of where price goes.", "DeXaI's Forecast card draws that cone from the last seven days of hourly returns. Log a band with a confidence and it will be scored when it lands.", null, "volatility and risk|calibration"],
    ["expectancy|edge|expected value", "Expectancy", "What a trade is worth on average: win rate × average win + (1 − win rate) × average loss. A 70% win rate with small wins and big losses has negative expectancy — the classic trap. It is the only number that says whether a process makes money.", "Coach computes it from your journal and names the one habit dragging it down.", "portfolio", "paper trading"],
    ["unlock|unlocks|dilution|vesting|emissions|supply drift", "Token unlocks and dilution", "Tokens promised to insiders and investors that enter circulation on a schedule. Each unlock is new supply looking for buyers. Schedules are announced; what actually gets sold is not.", "Supply Drift does not scrape a schedule — it records circulating supply daily on your device and shows the measured change. Rising supply is the unlock happening.", null, "supply|market capitalisation"],
    ["sector rotation|narrative|narratives|rotation", "Sector rotation and narratives", "Money moving between themes — L1s, DeFi, memes, AI, gaming. A narrative is a story that makes a sector move together; rotation is the story changing. Sector averages can be carried by one large coin, so look inside before you believe the label.", null, "markets", "market capitalisation|bitcoin dominance"],
    ["honeypot|honey pot", "Honeypot", "A token contract that lets you buy but silently refuses to let you sell. The chart looks perfect right up until you try to leave. Security scanners check the contract's transfer rules for it; nothing else about the chart can tell you.", null, "markets", "rug pulls|smart contracts"],
    ["rung|rungs|watchlist", "Rungs", "DexLadder's watchlists. A rung is a named set of coins on the ladder — yours, curated (Climbers, Oversold, Clean Ladder…), or a sector. Any rung can be shared as a signed link that another DexLadder verifies before importing.", null, "markets", "market capitalisation"],
    ["sentinel|alert rule|alert rules", "Sentinel", "Alerts written in words and compiled into rules that run on your device: a move within a window, a funding flip, a depeg, an RSI cross, a volume spike, the weather turning. They watch while the app is open.", null, "markets", "rsi|funding rate"],
    ["leverage weather|weather score", "Leverage Weather", "A composite mood gauge from breadth, momentum, funding, volatility and fear-and-greed, with the formula printed and weights renormalised when an input is missing. Sunny is greedy; blizzard is fearful. It describes the crowd, not the future.", null, "markets", "funding rate|bitcoin dominance"],
    ["pool radar|new pools|trending pools|dex pools", "Pool Radar", "Live DEX pools by network: trending, freshly created, movers, search. Each pool opens with its own candles, a security scan of the token contract, and an AMM sandbox where you can buy and sell with paper money against the pool's real liquidity.", null, "markets", "automated market makers|liquidity pools|honeypot"],
    ["basket|baskets|index basket|my index", "Baskets", "Your own index: a named set of coins, equal- or cap-weighted, tracked against BTC from the day you built it and tradeable as one unit through the same fill engine as any order.", null, "markets", "dollar-cost averaging|market capitalisation"],
    ["era ledger|ladder history|replay the ladder", "Era Ledger", "A weekly snapshot of the top 100, recorded on your device from the day you first opened v154, with a scrub to replay the ladder as it was. It cannot show 2013 — it shows what you witnessed, and says so.", null, "markets", "market capitalisation"],
    ["dexai|dex ai|copilot|assistant", "DeXaI", "The copilot inside DexLadder. It reads what the app already knows — prices, the wire, your paper book and journal, the Academy — and says it plainly. It never types a number: every figure is pulled by a tool and shown with its source and age. Models may add prose; anything they invent is struck out.", "Privacy is a setting, default Device-only. Memory is a window you control. The model card is in Trust.", null, "paper trading"]
  ];
  (function addKB() {
    try {
      var O = window.ORACLE; if (!O || !O.KB) return; var have = {}; O.KB.forEach(function (e) { have[e.title] = 1; });
      KB_ADD.forEach(function (r) { if (have[r[1]]) return; O.KB.push({ k: r[0].split("|"), title: r[1], body: r[2], deep: r[3], page: r[4], rel: (r[5] || "").split("|").filter(Boolean), v154: true }); });
    } catch (e) {}
  })();

  /* ---------------------------------------------------------- laws + changes (the app's own words) */
  var LAWS = [
    ["No ads, no boosts, no paid ranks", "Nothing on the ladder is sponsored. Rank is market cap; movers are moves. There is no “trending” you can buy."],
    ["No launchpad, no listings, no token", "DexLadder lists nothing and launches nothing. It reads public markets; it does not make them."],
    ["No accounts", "There is no login. Your book, journal, rungs, forecasts and DeXaI memory live in this browser's storage — export them, back them up, delete them. Nobody else can."],
    ["Paper money only", "Every trade here is simulated on live prices. The fill engine charges slippage and fees so the lesson is honest; the loss is tuition, not money."],
    ["One source, one build", "The website and the app payload are the same bytes. What you read on the web is what the app runs."],
    ["Anything from outside keeps itself current", "Every feed is raced and health-checked; dead sources are shimmed or retired. The 5-rung price ladder: CoinGecko → Coinpaprika → Coinlore → Binance → Coinbase, then truth."],
    ["Every number has a source", "Cards print their formula; DeXaI marks every figure with a tool, a source and an age. A number without a source is a rumour."],
    ["Bugs get gates", "Every reported bug becomes a permanent test in the build gate. Regressions are refused, not apologised for."],
    ["Learn before you leverage", "The perps desk opens with a primer the first time. It does not block you — it makes sure you have read it."]
  ];
  var CHANGES = [
    ["Ladder hygiene", "CryptoCompare rung retired (free API ended May 2026) → Coinlore; Reddit pulse → Attention pulse from Wikipedia page views; Binance routed through its CORS-safe host; open perps and journal notes now persist (they did not, before)."],
    ["Rungs", "Named watchlists with curated sets, sector rungs and signed share links."],
    ["Pool Radar", "Trending, fresh, movers and search across ten networks; per-pool candles, GoPlus scan, AMM sandbox on real liquidity."],
    ["Leverage Weather", "Perps ladder across Hyperliquid, OKX, Binance; funding, long/short, DVOL, liquidation tape, composite weather with a printed formula; Pi-Cycle, Mayer and Puell dials."],
    ["Chain Clock", "Halving, difficulty retarget, option expiries, day reset, forecast due dates, Polymarket resolutions — one clock."],
    ["Forecast", "Realised-vol cones, logged bands with confidence, Brier scoring, calibration buckets."],
    ["Odds", "Polymarket crypto, macro and politics with a paper book that settles at $1/$0 and scores you."],
    ["Coin dossier", "Story, code & crowd, contract chips that drive the scanner, venue table with depth and slippage, the coin's own wire, treasury holders, CSV export."],
    ["Sentinel", "Alerts written in words, compiled into rules that run on-device."],
    ["Desks", "Chain Ladder, Venue Board, Yield Sandbox, Convert with time travel — plus Supply Drift, Era Ledger, Baskets and heat lenses."],
    ["DeXaI", "Read, Market read, Desk, Coach, Tutor, Scan, Lens, Sentinel front, Brief — one copilot, numeric-slot law, privacy modes, memory window."],
    ["Trust", "This sheet: model card, laws, feed diagnostics, the gateway setting, learn-before-leverage."]
  ];

  /* ---------------------------------------------------------- pages inside the v149 Trust Center (About & Trust overlay) */
  var MINE = { dexai: "DeXaI", laws: "Laws", feeds: "Feeds", v154: "v154" };
  function paintPage(tab, body) {
    if (tab === "dexai") return paintModelCard(body);
    if (tab === "laws") { body.innerHTML = '<div class="dlt-prose"><h3>Laws</h3><p style="color:var(--faint)">What DexLadder will not do, in writing.</p>' + LAWS.map(function (l) { return '<div class="dl154"><div class="h">' + esc(l[0]) + '</div><div class="n" style="font-size:12.5px">' + esc(l[1]) + "</div></div>"; }).join("") + "</div>"; return; }
    if (tab === "v154") { body.innerHTML = '<div class="dlt-prose"><h3>What v154 adds</h3><p style="color:var(--faint)">Build ' + esc(String(typeof BUILD !== "undefined" ? BUILD : "v154")) + " · everything below is layered on the v153 payload; nothing was removed.</p>" + CHANGES.map(function (c) { return '<div class="dl154"><div class="h">' + esc(c[0]) + '</div><div class="n" style="font-size:12.5px">' + esc(c[1]) + "</div></div>"; }).join("") + "</div>"; return; }
    if (tab === "feeds") return paintFeeds(body);
  }
  function wrapTrust() {
    var L = window.DLTRUST; if (!L || typeof L.open !== "function" || L.open.__v154) return false;
    var _open = L.open;
    var w = function (tab) {
      if (MINE[tab]) { _open("about"); var ov = document.getElementById("dlTrust"); if (!ov) return; var body = ov.querySelector("#dltBody"), title = ov.querySelector("#dltTitle"); if (title) title.textContent = "DexLadder · " + MINE[tab]; addTabs(ov, tab); if (body) { body.innerHTML = ""; paintPage(tab, body); } var sh = ov.querySelector(".dlv-sheet"); if (sh) sh.scrollTop = 0; return; }
      var r = _open.apply(this, arguments); var ov2 = document.getElementById("dlTrust"); if (ov2) { addTabs(ov2, tab); post(tab, ov2.querySelector("#dltBody")); } return r;
    };
    w.__v154 = 1; L.open = w; return true;
  }
  function addTabs(ov, cur) {
    var tabs = ov.querySelector("#dltTabs"); if (!tabs) return;
    if (MINE[cur]) tabs.querySelectorAll("button:not([data-v154])").forEach(function (b) { b.classList.remove("on"); });
    Object.keys(MINE).forEach(function (k) { var b = tabs.querySelector('button[data-v154="' + k + '"]'); if (!b) { b = document.createElement("button"); b.type = "button"; b.setAttribute("data-v154", k); b.textContent = MINE[k]; b.onclick = function () { DLTRUST.open(k); }; tabs.appendChild(b); } b.classList.toggle("on", cur === k); });
  }
  /* legacy pages, kept current: sources gains the v154 feeds; changelog gains the v154 row; privacy names the new providers */
  function post(tab, body) {
    if (!body) return;
    if (tab === "sources" && !body.querySelector(".v154-src")) { var card = body.querySelector(".dlt-card"); if (card) card.insertAdjacentHTML("afterend", '<div class="dlt-card v154-src"><b>Added in v154</b> — all keyless, all requested from your device:<br>Coinlore (price rung 3) · Kraken &amp; Coinbase Exchange (candle history) · Wikimedia page views (Attention pulse) · The Block RSS (news) · GeckoTerminal networks, trending, new pools, OHLCV · GoPlus EVM + Solana (token security) · DefiLlama chains, DEX volumes, fees, stablecoin chains, yields · Hyperliquid, OKX, Binance Futures (perps, funding, long/short, liquidations) · Deribit DVOL · Polymarket Gamma + CLOB (odds) · mempool.space &amp; Blockstream (difficulty, tip height) · open.er-api (32 fiats) · CoinGecko categories, coin detail, tickers, history, public treasuries.<br><b>DeXaI:</b> the on-device composer needs nothing; Chrome’s built-in model runs on-device when the browser has it; a gateway is optional and only used when you paste its URL.</div>'); }
    if (tab === "changelog" && !body.querySelector(".v154-row")) { var c2 = body.querySelector(".dlt-card"); if (c2) c2.insertAdjacentHTML("afterbegin", '<div class="dlt-vrow v154-row"><span class="n"><b style="color:var(--ink)">v154</b> · dexai</span><span class="val" style="color:var(--muted);font-weight:400;max-width:62%">' + CHANGES.map(function (c) { return c[0]; }).join(" · ") + ' — see the v154 tab</span></div>'); }
    if (tab === "privacy" && !body.querySelector(".v154-priv")) { var pr = body.querySelector(".dlt-prose"); if (pr) pr.insertAdjacentHTML("beforeend", '<h3 class="v154-priv">DeXaI (v154)</h3><p>DeXaI’s default mode is <b>Device-only</b>: your questions are answered by an on-device composer and, when your browser has one, Chrome’s built-in model — nothing leaves the device. In Hybrid or Cloud mode, and only after you paste a gateway URL you deployed yourself, the question and the facts it needs are sent to <b>your</b> gateway; DexLadder runs none. DeXaI’s memory window lives in this browser’s storage beside your paper book and can be emptied with “forget everything”.</p>'); }
  }
  function open(tab) { if (wrapTrust() || (window.DLTRUST && window.DLTRUST.open)) DLTRUST.open(tab || "dexai"); }
  function VER() { try { return DEXAI && DEXAI.status ? "DeXaI 1.0 · v154 · provider: " + DEXAI.status().provider : "DeXaI 1.0 · v154"; } catch (e) { return "DeXaI 1.0 · v154"; } }
  function paintModelCard(body) {
    var st = window.DEXAI ? DEXAI.status() : null, d = window.DEXAI ? DEXAI.cfg() : null;
    body.innerHTML = '<div class="dlt-prose"><h3>DeXaI · model card</h3><p style="color:var(--faint)">' + esc(VER()) + '</p></div><div class="dl154"><div class="h">✦ What it is</div>' +
      '<div class="kv"><span>What it is</span><b>a copilot over the app’s own tools</b></div>' +
      '<div class="kv"><span>Numbers</span><b>only from tools · every figure carries source + age</b></div>' +
      '<div class="kv"><span>Model prose</span><b>optional · may only cite tool slots · invented numbers are struck</b></div>' +
      '<div class="kv"><span>Actions</span><b>alerts, rungs, forecasts, paper orders — always previewed, always your tap</b></div>' +
      '<div class="kv"><span>Provider now</span><b>' + esc(st ? st.provider : "—") + "</b></div>" +
      '<div class="kv"><span>Chrome built-in model</span><b>' + esc(st ? (st.nano === "ready" ? "ready — runs on this device" : st.nano === "downloadable" ? "available after download (Chrome AI settings)" : "not in this browser") : "—") + "</b></div>" +
      '<div class="kv"><span>Privacy mode</span><b>' + esc(st ? st.priv : "—") + "</b></div><div class=\"kv\"><span>Memory window</span><b>" + (st ? st.memDays + " days · " + st.memN + " entries on this device" : "—") + "</b></div>" +
      '<div class="n">Device-only: your question never leaves this device — the composer and, when present, Chrome’s built-in model answer. Hybrid: on-device first, your gateway for prose when the on-device model is absent. Cloud: your gateway first. The gateway is a Cloudflare Pages Function you deploy from the v154 kit; it holds the model keys — this app never does.</div></div>' +
      '<div class="dl154"><div class="h">Gateway</div><div class="dl-2"><input class="dl-inp" id="dxGw" placeholder="https://your-gateway.pages.dev" value="' + esc(d ? d.gw || "" : "") + '"><div style="display:flex;gap:6px"><button class="dl-b pri" id="dxGwSave">Save</button><button class="dl-b" id="dxGwTest">Test</button><button class="dl-b warn" id="dxGwClear">Clear</button></div></div><div class="n" id="dxGwOut">Paste the URL of the gateway you deployed. Keys stay on the gateway. Leave empty to stay device-only.</div></div>' +
      '<div class="dl154"><div class="h">Memory</div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="n" style="margin:0">' + (st ? st.memN : 0) + ' remembered questions in the window</span><span class="sp"></span><button class="dl-b warn" id="dxForget">Forget everything</button></div></div>' +
      '<div class="dl154"><div class="h">Laws it cannot break</div><div class="n" style="font-size:12.5px">It cannot place an order, arm an alert or change a rung without your tap. It cannot invent a number. It cannot see anything outside this app’s state and the feeds the app already reads. It does not advise: it reads.</div></div>';
    $("dxGwSave").onclick = function () { var v = $("dxGw").value.trim(); if (v && !/^https:\/\/[^\s/]+/.test(v)) { $("dxGwOut").textContent = "Needs an https:// URL."; return; } var x = DEXAI.cfg(); if (x) { x.gw = v; C.save(); } $("dxGwOut").textContent = v ? "Saved. Switch privacy to Hybrid or Cloud in the DeXaI bar to use it." : "Cleared — device-only."; };
    $("dxGwClear").onclick = function () { $("dxGw").value = ""; $("dxGwSave").onclick(); };
    $("dxGwTest").onclick = function () { var v = $("dxGw").value.trim().replace(/\/+$/, ""); if (!/^https:\/\//.test(v)) { $("dxGwOut").textContent = "Enter an https:// URL first."; return; } $("dxGwOut").textContent = "Testing…"; var t0 = Date.now(); fetch(v + "/api/dexai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ v: 1, ping: 1 }) }).then(function (r) { return r.json().then(function (j) { $("dxGwOut").textContent = r.ok && j && j.ok ? "Gateway answered in " + (Date.now() - t0) + " ms · model " + (j.model || "?") + (j.keys ? " · keys: " + j.keys.join(", ") : "") : "Gateway replied " + r.status + " — check the deployment."; }); }).catch(function (e) { $("dxGwOut").textContent = "No answer: " + (e.message || e) + ". CORS or URL?"; }); };
    $("dxForget").onclick = function () { DEXAI.forget(); paintModelCard(body); C.toast("good", "Forgotten", "DeXaI memory emptied on this device"); };
  }
  function paintFeeds(body) {
    var H = C.health(), F = window.DLFEEDS ? DLFEEDS.status() : null, B = null; try { B = DLBX.status(); } catch (e) {}
    var hosts = Object.keys(H).sort();
    body.innerHTML = '<div class="dlt-prose"><h3>Feeds</h3><p style="color:var(--faint)">Every host this session has spoken to, with health. Nothing here is sent anywhere.</p></div><div class="dl154"><div class="h">Price ladder<span class="sp"></span>' + (B ? C.prov(B.state + " · " + (B.src || "—") + (B.latency ? " · " + Math.round(B.latency) + " ms" : ""), B.at, B.state !== "live") : "") + '</div><div class="n">Rungs, in order: CoinGecko → Coinpaprika → Coinlore → Binance (vision host) → Coinbase → truth (last good payload).' + (B && B.practice ? " Practice mode: prices are a replay." : "") + (B && B.offline ? " Offline." : "") + "</div></div>" +
      (F ? '<div class="dl154"><div class="h">Shims (v154 hygiene)</div>' + Object.keys(F).map(function (k) { var v = F[k]; return '<div class="kv"><span>' + esc(k) + "</span><b>" + esc(typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v)) + "</b></div>"; }).join("") + "</div>" : "") +
      '<div class="dl154"><div class="h">Hosts this session</div>' + (hosts.length ? '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Host</th><th class="r">ok</th><th class="r">fails</th><th class="r">latency</th><th class="r">state</th></tr></thead><tbody>' + hosts.map(function (h) { var x = H[h], cool = x.cool > Date.now(); return "<tr><td>" + esc(h) + '</td><td class="r">' + (x.ok || 0) + '</td><td class="r">' + (x.fails || 0) + '</td><td class="r">' + (x.lat ? Math.round(x.lat) + " ms" : "—") + '</td><td class="r">' + (cool ? '<span class="dn">cooling ' + C.until(x.cool) + "</span>" : '<span class="up">ok</span>') + "</td></tr>"; }).join("") + "</tbody></table></div>" : '<div class="dl-empty">No v154 desk has fetched yet — open one and come back.</div>') + '<div class="n">Health is per host: three failures start a cooldown, cached data is served stale in the meantime and marked so. Nothing here is sent anywhere.</div></div>';
  }

  /* ---------------------------------------------------------- learn before you leverage (soft gate, once) */
  (function gateSim() {
    var n = 0, iv = setInterval(function () {
      var Sm = window.DLSIM; if (!Sm || typeof Sm.open !== "function") { if (++n > 200) clearInterval(iv); return; }
      clearInterval(iv); if (Sm.open.__trust) return; var _o = Sm.open;
      var w = function () { var self = this, args = arguments; var x = C.X(); if (x && x.lvOk) return _o.apply(self, args); try { if (typeof modal !== "function") return _o.apply(self, args); } catch (e) { return _o.apply(self, args); }
        var e = null; try { e = ORACLE.KB.filter(function (k) { return k.title === "Leverage and margin"; })[0]; } catch (err) {}
        modal('<button class="mx" onclick="closeModal()">✕</button><h2 style="margin-bottom:2px">Learn before you leverage</h2><p class="sub" style="margin-bottom:10px">a two-minute primer, once</p><div class="dl154"><div class="h">Leverage and margin</div><div class="n" style="font-size:13px">' + esc(e ? e.body : "Borrowing to hold a bigger position than your money. 10× leverage means a 10% move against you erases your margin.") + "</div>" + (e && e.deep ? '<div class="n" style="font-size:12.5px;color:#a9bad6">' + esc(e.deep) + "</div>" : "") + '<div class="kv"><span>Funding</span><b>a payment every 8h from the crowded side — a cost that never sleeps</b></div><div class="kv"><span>Liquidation</span><b>losses eat the margin → the venue closes you by force</b></div><div class="kv"><span>Paper</span><b>this desk uses paper money on real funding and real liquidation maths</b></div></div><div style="display:flex;gap:9px;margin-top:14px"><button class="btn sm" id="dlLvGo">I’ve read it — open the desk</button><button class="btn sm" onclick="closeModal()">Not now</button></div>');
        var b = $("dlLvGo"); if (b) b.onclick = function () { if (x) { x.lvOk = Date.now(); C.save(); } try { closeModal(); } catch (er) {} C.xp("trust.lv", 10, "Read the leverage primer before opening the perps desk"); _o.apply(self, args); };
      };
      w.__trust = 1; Sm.open = w;
    }, 250);
  })();

  (function arm() { var n = 0, iv = setInterval(function () { if (wrapTrust()) clearInterval(iv); else if (++n > 200) clearInterval(iv); }, 250); })();
  C.cmd("trust", "Trust — DeXaI model card, laws, feeds, gateway", "🛡", function () { open("dexai"); });
  C.cmd("feeds", "Feed diagnostics — every host, health and cooldowns", "📡", function () { open("feeds"); });
  C.cmd("what's new", "v154 — what changed since v153", "🆕", function () { open("v154"); });
  if (window.DLDESKS) DLDESKS.register("trust", "🛡", "Trust", "model card · laws · feeds", function () { open("dexai"); });
  return { __v: 154, open: open, laws: LAWS, changes: CHANGES, kb: KB_ADD, pages: MINE };
})();
