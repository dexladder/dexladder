/* ============================================================
   DLLEDGERS · v154 — Supply Drift · Era Ledger · Baskets · Heat lenses
   · Supply Drift: the sovereign answer to "token unlocks" (no free
     unlock API exists in 2026) — record circulating supply daily on this
     device and show measured 7d/30d dilution per coin + a movers sheet.
   · Era Ledger: weekly top-100 snapshots recorded from today; a scrub
     to replay the ladder as it was. Honest about its start date.
   · Baskets: build an index (equal or cap-weighted), track it vs BTC,
     and paper-trade it as one unit through the real fill engine.
   · Heat lenses: the market heatmap redrawn by Rung, by sector rung,
     or coloured by RSI (Overbought map).
   ============================================================ */
window.DLLEDGERS = (function () {
  "use strict";
  if (window.DLLEDGERS && window.DLLEDGERS.__v) return window.DLLEDGERS;
  var C = window.DLCORE, $ = C.$, esc = C.esc;
  var SUP_LS = "dl.supply.v1", ERA_LS = "dl.era.v1";
  function day(t) { return new Date(t || Date.now()).toISOString().slice(0, 10); }

  /* ---------------------------------------------------------- Supply Drift */
  function supStore() { return C.lsGet(SUP_LS) || { since: day(), days: {} }; }
  function supRecord() {
    var all = C.coinsAll(); if (all.length < 50) return;
    var st = supStore(), d = day(); if (st.days[d]) return;
    var row = {}; all.forEach(function (c) { if (null != c.supply && isFinite(c.supply) && c.supply > 0) row[c.sym] = Math.round(c.supply); });
    st.days[d] = row; var keys = Object.keys(st.days).sort(); while (keys.length > 35) { delete st.days[keys.shift()]; }
    C.lsSet(SUP_LS, st);
  }
  /* Audit finding 16 / decision D-02: a drift over N days needs N days of ELAPSED
     coverage, not merely a non-empty array. The old code fell back to keys[0] when no
     snapshot was old enough, so a one-day-old device reported "+0.000%" over 7d and 30d
     as though it were an observation. The window is now either measured or explicitly short. */
  function covDays(keys) {
    if (!keys.length) return 0;
    var a = Date.parse(keys[0] + "T00:00:00Z"), b = Date.parse(keys[keys.length - 1] + "T00:00:00Z");
    return Math.floor((b - a) / 864e5) + 1;
  }
  function supDrift(sym) {
    var st = supStore(), keys = Object.keys(st.days).sort(); if (!keys.length) return null;
    var now = st.days[keys[keys.length - 1]][sym]; if (null == now) return null;
    var cov = covDays(keys);
    function back(nd) {
      var target = day(Date.now() - nd * 864e5), k = null;
      for (var i = keys.length - 1; i >= 0; i--) { if (keys[i] <= target) { k = keys[i]; break; } }
      if (!k) return { reason: "insufficient-history", have: cov, need: nd };
      var v = st.days[k][sym];
      if (null == v) return { reason: "unavailable", from: k };
      return { pct: (now / v - 1) * 100, from: k, days: nd };
    }
    return { now: now, d7: back(7), d30: back(30), since: st.since, days: keys.length, coverage: cov };
  }
  /* One place decides how a drift window reads, so the card, the movers desk and DeXaI
     cannot disagree about the same window. */
  function driftText(w) {
    if (!w) return "Unavailable";
    if (w.reason === "insufficient-history") return "Collecting history · " + w.have + " of " + w.need + " days";
    if (w.reason) return "Unavailable";
    return C.chg(w.pct, 3);
  }
  function supCard() {
    var sym; try { sym = S.coin; } catch (e) { return; } var c = C.coin(sym); if (!c) return;
    var host = $("dlDossier") || $("dlForecast") || $("cv-kpis"); if (!host) return;
    var el = $("dlSupply"); if (el && el.dataset.sym === sym) return; if (!el) { el = document.createElement("div"); el.id = "dlSupply"; el.className = "dl154"; } el.dataset.sym = sym; host.insertAdjacentElement("afterend", el);
    var d = supDrift(sym), max = c.maxSupply || c.totalSupply || null, prog = (max && null != c.supply) ? Math.min(100, c.supply / max * 100) : null;
    el.innerHTML = '<div class="h">🌊 Supply Drift · ' + esc(sym) + '</div>' + (prog != null ? '<div class="kv"><span>Circulating of max</span><b>' + prog.toFixed(1) + "% (" + (null == c.supply ? "Unavailable" : C.big(c.supply)) + " / " + C.big(max) + ')</b></div><div class="dl-gauge" style="background:linear-gradient(90deg,#3ae58f,#ffb300)"><i style="left:' + prog.toFixed(0) + '%"></i></div>' : '<div class="kv"><span>Circulating</span><b>' + (null == c.supply ? "Unavailable" : C.big(c.supply) + " · no fixed max") + "</b></div>") +
      (d ? '<div class="kv"><span>Measured 7d supply change</span><b>' + driftText(d.d7) + '</b></div><div class="kv"><span>Measured 30d supply change</span><b>' + driftText(d.d30) + "</b></div>" : "") +
      '<div class="n">Recorded on this device every day since ' + esc(d ? d.since : day()) + " (" + (d ? d.days : 1) + " day" + (d && d.days !== 1 ? "s" : "") + " so far). Dilution is measured, not scraped from an unlock schedule — a rising circulating supply is the unlock happening. <button class=\"dl-b\" id=\"dlSupMore\">Movers →</button></div>";
    $("dlSupMore").onclick = supSheet;
  }
  function supSheet() {
    C.open("dlSupplySheet", { title: "🌊 Supply Drift · movers", sub: "measured circulating-supply change on this device", tabs: [], onTab: function (t, body) {
      var st = supStore(), keys = Object.keys(st.days).sort();
      if (keys.length < 2) { body.innerHTML = '<div class="dl-empty">Recording started ' + esc(st.since) + '. Come back after a few days — the ladder’s supply is snapshotted once a day, and drift needs two points.</div>'; return; }
      var rows = C.coinsAll().map(function (c) { var d = supDrift(c.sym); return d && d.d7 && null != d.d7.pct ? { sym: c.sym, name: c.name, p7: d.d7.pct, p30: (d.d30 && null != d.d30.pct) ? d.d30.pct : null, now: d.now } : null; }).filter(Boolean).sort(function (a, b) { return b.p7 - a.p7; });
      body.innerHTML = '<div class="dl-2"><div class="dl154"><div class="h">Inflating fastest · 7d</div>' + rows.slice(0, 12).map(function (r) { return '<div class="kv"><span><b>' + esc(r.sym) + "</b> " + esc(r.name) + "</span><b>" + C.chg(r.p7, 2) + "</b></div>"; }).join("") + '</div><div class="dl154"><div class="h">Shrinking · 7d</div>' + rows.slice(-12).reverse().map(function (r) { return '<div class="kv"><span><b>' + esc(r.sym) + "</b> " + esc(r.name) + "</span><b>" + C.chg(r.p7, 2) + "</b></div>"; }).join("") + "</div></div>" +
        '<div class="dl-formula">drift = circulating supply today ÷ circulating supply N days ago − 1, from daily snapshots taken on this device (' + keys.length + " days recorded since " + esc(st.since) + ")\nSupply data: CoinGecko circulating_supply per coin. Stablecoins mint and burn with demand — their drift is flow, not dilution.</div>";
    } });
  }

  /* ---------------------------------------------------------- Era Ledger */
  function eraStore() { return C.lsGet(ERA_LS) || { since: day(), weeks: {} }; }
  function weekKey(t) { var d = new Date(t || Date.now()); var dow = d.getUTCDay(); d.setUTCDate(d.getUTCDate() - dow); return d.toISOString().slice(0, 10); }
  function eraRecord() {
    var all = C.coinsAll(); if (all.length < 50) return; var st = eraStore(), k = weekKey(); if (st.weeks[k]) return;
    st.weeks[k] = all.slice().sort(function (a, b) { return b.mcap - a.mcap; }).slice(0, 100).map(function (c) { return [c.sym, Math.round(c.mcap), +c.price.toPrecision(6)]; });
    var keys = Object.keys(st.weeks).sort(); while (keys.length > 52) delete st.weeks[keys.shift()];
    C.lsSet(ERA_LS, st);
  }
  function eraSheet() {
    C.open("dlEra", { title: "🗓 Era Ledger", sub: "the ladder as it was, one snapshot a week, recorded on this device", tabs: [], onTab: function (t, body) {
      var st = eraStore(), keys = Object.keys(st.weeks).sort(); if (!keys.length) { eraRecord(); st = eraStore(); keys = Object.keys(st.weeks).sort(); }
      var latest = st.weeks[keys[keys.length - 1]] || [];
      function paint(i) {
        var k = keys[i], snap = st.weeks[k] || [], rankNow = {}; latest.forEach(function (r, j) { rankNow[r[0]] = j + 1; });
        $("dlEraLbl").textContent = "week of " + k + (i === keys.length - 1 ? " (latest)" : "");
        $("dlEraTbl").innerHTML = '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>#</th><th>Coin</th><th class="r">Market cap then</th><th class="r">Price then</th><th class="r">Rank now</th></tr></thead><tbody>' + snap.slice(0, 50).map(function (r, j) { var rn = rankNow[r[0]]; var mv = rn ? rn - (j + 1) : null; return '<tr class="click" data-coin="' + esc(r[0]) + '"><td>' + (j + 1) + "</td><td><b>" + esc(r[0]) + '</b></td><td class="r">' + C.big(r[1]) + '</td><td class="r">' + C.money(r[2]) + '</td><td class="r">' + (rn ? rn + (mv ? ' <span class="' + (mv < 0 ? "up" : "dn") + '">' + (mv < 0 ? "▲" + (-mv) : "▼" + mv) + "</span>" : "") : "off the top 100") + "</td></tr>"; }).join("") + "</tbody></table></div>";
      }
      /* v155-F: paint(keys.length - 1) was unguarded. eraRecord() bails while fewer than 50
         coins have loaded, so on that device keys is empty, keys[-1] is undefined, and the
         sheet read "week of undefined (latest)" over an empty table with a scrubber whose
         max was -1. Nothing is missing here — nothing has happened yet — and the law is that
         missing data reads "Unavailable", never a literal undefined and never a bare dash. */
      if (!keys.length) {
        body.innerHTML = '<div class="dl154"><div class="h">Replay the Ladder <span class="sp"></span><span id="dlEraLbl">Unavailable</span></div><div class="dl-empty">No weekly snapshot has been recorded yet, so there is nothing to replay. The ladder is snapshotted once a week, on this device, and only once at least 50 coins have loaded — the first one lands as soon as the market data does.</div><div class="n">Recording since ' + esc(st.since) + ". CoinMarketCap can replay 2013; this ledger can only replay what you have witnessed — and it says so.</div></div>";
        return;
      }
      body.innerHTML = '<div class="dl154"><div class="h">Replay the Ladder <span class="sp"></span><span id="dlEraLbl"></span></div><input type="range" id="dlEraScrub" min="0" max="' + (keys.length - 1) + '" value="' + (keys.length - 1) + '" style="width:100%"><div class="n">' + keys.length + " weekly snapshot" + (keys.length === 1 ? "" : "s") + " since " + esc(st.since) + ". CoinMarketCap can replay 2013; this ledger can only replay what you have witnessed — and it says so.</div></div><div id=\"dlEraTbl\"></div>";
      paint(keys.length - 1);
      $("dlEraScrub").oninput = function () { paint(+this.value); };
      body.addEventListener("click", function (e) { var tr = e.target.closest("tr[data-coin]"); if (tr && C.coin(tr.getAttribute("data-coin"))) { C.close("dlEra"); openCoin(tr.getAttribute("data-coin")); } });
    } });
  }

  /* ---------------------------------------------------------- Baskets */
  function B() { var x = C.X(); if (!x) return null; x.baskets || (x.baskets = []); return x.baskets; }
  function mkBasket(name, syms, mode) {
    var legs = syms.map(C.coin).filter(function (c) { return c && c.price > 0; }); if (legs.length < 2) return null;
    var tot = legs.reduce(function (s, c) { return s + (mode === "cap" ? c.mcap : 1); }, 0);
    var b = { id: "b" + Math.random().toString(36).slice(2, 8), name: String(name || "Basket").slice(0, 32), mode: mode, t: Date.now(), legs: legs.map(function (c) { return { sym: c.sym, w: (mode === "cap" ? c.mcap : 1) / tot, px0: c.price }; }), btc0: (C.coin("BTC") || {}).price || 0, held: null };
    B().unshift(b); if (B().length > 12) B().pop(); C.save(); C.xp("basket.first", 10, "First Basket built — an index of your own");
    return b;
  }
  /* v162 · a leg with no live price used to be skipped, which quietly removed
     its weight from the index: a two-leg equal-weight basket with one feed out
     printed 50 — a 50% loss that never happened. The index is now stated over
     the legs that actually have a price, and returns null when none do, so the
     caller can say Unavailable instead of printing a wrong number. */
  function basketIndex(b) {
    var v = 0, w = 0;
    b.legs.forEach(function (l) {
      var c = C.coin(l.sym);
      if (c && c.price > 0 && l.px0 > 0) { v += l.w * c.price / l.px0; w += l.w; }
    });
    if (!(w > 0)) return null;
    return (v / w) * 100;
  }
  function basketBuy(b, usd) {
    usd = +usd; if (!(usd > 0)) return; var bal = S.bal.USDT || 0; if (usd > bal) { C.toast("bad", "Not enough paper USDT", "You have " + C.money(bal, 2)); return; }
    var held = []; b.legs.forEach(function (l) { var c = C.coin(l.sym); if (!c) return; var amt = usd * l.w / c.price; var F = typeof fillSim === "function" ? fillSim(l.sym, "USDT", "buy", amt) : { px: c.price }; if (typeof execFill === "function" && execFill("buy", l.sym, "USDT", amt, F.px, "basket", true)) held.push({ sym: l.sym, qty: amt }); });
    b.held = held; b.usd = usd; C.save(); try { updateNavBal(); } catch (e) {} C.sfx("buy"); C.toast("good", "Basket bought" + C.simTag(), C.money(usd, 2) + " split across " + held.length + " legs through the real fill engine — it shows in your Portfolio");
    C.xp("basket.trade", 15, "Traded a Basket as one unit");
  }
  function basketSell(b) {
    if (!b.held) return; var n = 0; b.held.forEach(function (h) { var have = S.bal[h.sym] || 0, q = Math.min(h.qty, have); if (q > 1e-9) { var c = C.coin(h.sym); var F = typeof fillSim === "function" ? fillSim(h.sym, "USDT", "sell", q) : { px: c.price }; if (execFill("sell", h.sym, "USDT", q, F.px, "basket", true)) n++; } });
    b.held = null; C.save(); try { updateNavBal(); } catch (e) {} C.sfx("sell"); C.toast("good", "Basket sold" + C.simTag(), n + " legs closed — realised P&L is in the journal");
  }
  function basketSheet() {
    C.open("dlBaskets", { title: "🧺 Baskets", sub: "your own index · tracked vs BTC · tradeable as one unit", tabs: [], onTab: function (t, body) {
      var bs = B() || [], btc = (C.coin("BTC") || {}).price || 0;
      body.innerHTML = '<div class="dl154"><div class="h">New basket</div><div class="dl-2"><input class="dl-inp" id="dlBkName" placeholder="Name (e.g. L2 trio, AI infra)"><input class="dl-inp" id="dlBkSyms" placeholder="ARB, OP, MATIC…"></div><div style="display:flex;gap:8px;margin-top:8px;align-items:center"><label class="dl-tog"><input type="radio" name="dlBkMode" value="eq" checked> equal-weight</label><label class="dl-tog"><input type="radio" name="dlBkMode" value="cap"> cap-weighted</label><span style="flex:1"></span><button class="dl-b pri" id="dlBkMake">Build</button></div><div class="n">Index starts at 100 when built. DL10 = the top 10 by cap, cap-weighted, is one tap below.<button class="dl-b" id="dlBkDl10" style="margin-left:8px">Build DL10</button></div></div>' +
        (bs.length ? bs.map(function (b, i) { var idx = basketIndex(b), btcIdx = b.btc0 ? btc / b.btc0 * 100 : null; return '<div class="dl154"><div class="h">🧺 ' + esc(b.name) + ' <span style="font:500 11px var(--ui-sans,sans-serif);color:var(--muted)">· ' + (b.mode === "cap" ? "cap-weighted" : "equal-weight") + " · since " + C.ago(b.t) + '</span><span class="sp"></span><b style="font-size:18px" class="' + (idx >= 100 ? "up" : "dn") + '">' + idx.toFixed(2) + "</b></div>" + '<div class="kv"><span>vs BTC over the same period</span><b>' + (btcIdx ? C.chg(idx - btcIdx, 2) + ' <span style="opacity:.6">(BTC ' + btcIdx.toFixed(1) + ")</span>" : "—") + '</b></div><div class="dl-chips" style="margin:6px 0">' + b.legs.map(function (l) { var c = C.coin(l.sym); return '<span class="dl-chip">' + esc(l.sym) + " " + (l.w * 100).toFixed(0) + "% " + (c ? C.chg((c.price / l.px0 - 1) * 100, 1) : "") + "</span>"; }).join("") + '</div><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' + (b.held ? '<span class="dl-sim">held · ' + C.money(b.usd, 0) + ' at entry</span><button class="dl-b warn" data-sell="' + i + '">Sell basket</button>' : '<input class="dl-inp" data-amt="' + i + '" type="number" value="1000" style="width:110px"><button class="dl-b pri" data-buy="' + i + '">Buy basket</button>') + '<button class="dl-b" data-del="' + i + '">Delete</button></div></div>'; }).join("") : '<div class="dl-empty">No baskets yet.</div>') +
        '<div class="dl-formula">index = Σ weight × (price now ÷ price at build) × 100 · buying routes every leg through the same fill engine (slippage, fees, cost basis) as a normal order, so the Portfolio, journal and tax centre all see it</div>';
      $("dlBkMake").onclick = function () { var syms = $("dlBkSyms").value.split(/[,\s]+/).filter(Boolean); var mode = body.querySelector('input[name="dlBkMode"]:checked').value; if (mkBasket($("dlBkName").value, syms, mode)) basketSheet(); else C.toast("bad", "Need at least two ladder coins", "Symbols must be on the 500-coin ladder"); };
      $("dlBkDl10").onclick = function () { var top = C.coinsAll().filter(function (c) { return c.sym !== "USDT" && c.sym !== "USDC" && !(window.DLRUNGS && DLRUNGS.wrapped[c.sym]); }).sort(function (a, b) { return b.mcap - a.mcap; }).slice(0, 10).map(function (c) { return c.sym; }); if (mkBasket("DL10", top, "cap")) basketSheet(); };
      body.querySelectorAll("[data-buy]").forEach(function (b) { b.onclick = function () { var i = +b.getAttribute("data-buy"); basketBuy(bs[i], (body.querySelector('[data-amt="' + i + '"]') || {}).value); basketSheet(); }; });
      body.querySelectorAll("[data-sell]").forEach(function (b) { b.onclick = function () { basketSell(bs[+b.getAttribute("data-sell")]); basketSheet(); }; });
      body.querySelectorAll("[data-del]").forEach(function (b) { b.onclick = function () { bs.splice(+b.getAttribute("data-del"), 1); C.save(); basketSheet(); }; });
    } });
  }

  /* ---------------------------------------------------------- Heat lenses */
  var LENS = "top";
  function squarify(items, x, y, w, h, out) { /* same shape as DLOMNI's: slice-and-dice by area share, row by row */
    if (!items.length) return; var tot = items.reduce(function (s, i) { return s + i.a; }, 0); if (!tot) return;
    var horiz = w >= h, pos = 0, i = 0;
    while (i < items.length) { tot = 0; for (var q = i; q < items.length; q++) tot += items[q].a; if (!tot || w <= 0 || h <= 0) return; var rowA = 0, j = i, rowW = horiz ? Math.max(1, (items[i].a / tot) * w) : Math.max(1, (items[i].a / tot) * h); rowA = items[i].a; j++;
      /* grow the row while it keeps cells squarer */
      while (j < items.length) { var a2 = rowA + items[j].a, side = horiz ? (a2 / tot) * w : (a2 / tot) * h, worst = Math.max.apply(null, items.slice(i, j + 1).map(function (it) { var s = it.a / a2 * (horiz ? h : w); return Math.max(side / s, s / side); })), cur = Math.max.apply(null, items.slice(i, j).map(function (it) { var s = it.a / rowA * (horiz ? h : w); return Math.max(rowW / s, s / rowW); })); if (worst <= cur) { rowA = a2; rowW = side; j++; } else break; }
      var off = 0; for (var k = i; k < j; k++) { var frac = items[k].a / rowA; if (horiz) { var ch = frac * h; out.push({ x: x + pos, y: y + off, w: rowW, h: ch, c: items[k].c }); off += ch; } else { var cw = frac * w; out.push({ x: x + off, y: y + pos, w: cw, h: rowW, c: items[k].c }); off += cw; } }
      if (horiz) { x += rowW; w -= rowW; } else { y += rowW; h -= rowW; } horiz = w >= h; i = j; }
  }
  /* v155-C: the panel says out loud whether it has anything to map. Anything but
     "ok" and layers/v154.css swaps the canvas for the honest Unavailable note —
     the payload never renders a blank frame where data is missing. */
  function heatState(s) { try { var b = $("dlHeat"); if (b) b.setAttribute("data-heat", s); } catch (e) {} }
  function drawLens(set, mode) {
    var cv = $("dlHeatCv"); if (!cv) return heatState("empty");
    if (!set || !set.length) return heatState("empty");
    heatState("ok");
    var dpr = Math.min(window.devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return heatState("empty");
    cv.width = W * dpr; cv.height = H * dpr; var g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = "#101726"; g.fillRect(0, 0, W, H);
    var items = set.filter(function (c) { return c.mcap > 0; }).slice(0, 40).map(function (c) { return { a: Math.sqrt(c.mcap), c: c }; }).sort(function (a, b) { return b.a - a.a; }), out = [];
    squarify(items, 0, 0, W, H, out);
    out.forEach(function (cell) { var c = cell.c, v, col; if (mode === "rsi") { var r = C.rsi(c.spark || [], 14); v = r == null ? 50 : r; var m = Math.min(1, Math.abs(v - 50) / 30); col = v >= 50 ? "rgba(230,64,78," + (0.3 + 0.6 * m) + ")" : "rgba(22,163,94," + (0.3 + 0.6 * m) + ")"; } else { v = c.c24 || 0; var mg = Math.min(Math.abs(v) / 8, 1); col = v >= 0 ? "rgba(22,163,94," + (0.34 + 0.55 * mg) + ")" : "rgba(230,64,78," + (0.34 + 0.55 * mg) + ")"; }
      g.fillStyle = col; g.fillRect(cell.x + 1, cell.y + 1, Math.max(0, cell.w - 2), Math.max(0, cell.h - 2));
      if (cell.w > 46 && cell.h > 30) { g.fillStyle = "#fff"; g.font = "800 " + Math.min(15, Math.max(10, cell.w / 6)) + "px system-ui,sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(c.sym, cell.x + cell.w / 2, cell.y + cell.h / 2 - 6); g.font = "600 10px system-ui,sans-serif"; g.fillText(mode === "rsi" ? "RSI " + Math.round(v) : (v >= 0 ? "+" : "") + v.toFixed(1) + "%", cell.x + cell.w / 2, cell.y + cell.h / 2 + 8); } });
    cv.__lensCells = out;
  }
  function lensPaint() {
    if (LENS === "top") {
      /* DLOMNI.heat() carries its own heatState() calls. If the module is not there
         at all, the panel has nothing to draw and must say so rather than sit blank. */
      try { if (window.DLOMNI && DLOMNI.heat) { DLOMNI.heat(); return; } } catch (e) {}
      return heatState("empty");
    }
    if (LENS === "rsi") return drawLens(C.coinsAll().slice(0, 40), "rsi");
    if (LENS === "rung" && window.DLRUNGS) { var set = DLRUNGS.activeSet(); var list = C.coinsAll().filter(function (c) { return set.has(c.sym); }); if (!list.length) list = C.coinsAll().slice(0, 30); return drawLens(list, "chg"); }
    return heatState("empty");
  }
  /* The canvas is sized from its CSS box, so anything that changes that box has to
     ask for a repaint or the bitmap ships stretched. layers/zzz-columns.js does. */
  window.DLHEATX = { paint: lensPaint };
  function mountLens() {
    var heat = $("dlHeat"); if (!heat || $("dlHeatLens")) return;
    var hh = heat.querySelector(".hh");
    var bar = document.createElement("div"); bar.id = "dlHeatLens"; bar.className = "dl-chips"; bar.style.margin = "6px 0 8px";
    bar.innerHTML = '<button class="dl-chip on" data-lens="top">Top 30 · 24h</button><button class="dl-chip" data-lens="rung">Active Rung</button><button class="dl-chip" data-lens="rsi">Overbought map · RSI</button>';
    if (hh) hh.insertAdjacentElement("afterend", bar); else heat.insertAdjacentElement("afterbegin", bar);
    var hn = heat.querySelector(".hn"); if (hn && !hn.dataset.base) hn.dataset.base = hn.textContent;
    bar.addEventListener("click", function (e) { var b = e.target.closest("[data-lens]"); if (!b) return; LENS = b.getAttribute("data-lens"); bar.querySelectorAll("[data-lens]").forEach(function (x) { x.classList.toggle("on", x === b); }); if (hn) hn.textContent = LENS === "rsi" ? "Top 40 by market cap · size = cap · colour = RSI-14 (red = overbought, green = oversold) · tap a tile to open the coin" : LENS === "rung" ? "Your active Rung · size = cap · colour = 24h move · tap a tile to open the coin" : hn.dataset.base; lensPaint(); });
    var cv = $("dlHeatCv"); if (cv && !cv.__lensClick) { cv.__lensClick = 1; cv.addEventListener("click", function (e) { if (LENS === "top" || !cv.__lensCells) return; var r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; var hit = cv.__lensCells.filter(function (c) { return x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h; })[0]; if (hit) openCoin(hit.c.sym); }, true); }
  }
  C.onPage("markets", mountLens);
  C.onPage("coin", supCard);
  C.onTick(function (n) { if (n === 20 || n % 2400 === 0) { supRecord(); eraRecord(); }
    /* no new timer: a heatmap that has nothing to map re-tries on the tick that is
       already running, so late ladder data replaces the Unavailable note by itself. */
    var b = $("dlHeat");
    if (b && b.getAttribute("data-heat") !== "ok" && b.getBoundingClientRect().width > 0) lensPaint();
  });
  setTimeout(function () { supRecord(); eraRecord(); }, 9000);
  if (window.DLDESKS) { DLDESKS.register("supply", "🌊", "Supply Drift", "measured dilution, recorded here", supSheet); DLDESKS.register("era", "🗓", "Era Ledger", "replay the ladder week by week", eraSheet); DLDESKS.register("baskets", "🧺", "Baskets", "your own index, tradeable as one unit", basketSheet); }
  C.cmd("supply drift", "Supply Drift — measured circulating-supply change", "🌊", supSheet);
  C.cmd("era ledger", "Era Ledger — replay the ladder week by week", "🗓", eraSheet);
  C.cmd("baskets", "Baskets — build an index and trade it as one unit", "🧺", basketSheet);
  return { __v: 154, supDrift: supDrift, driftText: driftText, covDays: covDays, supRecord: supRecord, supSheet: supSheet, supStore: supStore, eraRecord: eraRecord, eraStore: eraStore, eraSheet: eraSheet, baskets: B, mkBasket: mkBasket, basketIndex: basketIndex, basketBuy: basketBuy, basketSell: basketSell, basketSheet: basketSheet, lens: lensPaint, lensMode: function () { return LENS; } };
})();
