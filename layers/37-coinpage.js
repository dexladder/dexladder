/* ============================================================
   DLDOSSIER · v154 — coin-page depth the audit found missing:
   · Story (CoinGecko description, cached 7d) for all 500 coins, not 56
   · Dossier links (site · whitepaper · explorer · code · socials)
   · Code & Crowd — real developer / community numbers (CMC AI narrates
     these; DexLadder shows the figures with their source)
   · Contracts → one-tap GoPlus scan (no pasting)
   · Venues — tradeability from CoinGecko tickers: spread, ±2% depth,
     trust, staleness, and "fill quality for YOUR size"
   · Coin Wire — the News desk filtered to this coin, sentiment-tagged
   · Treasury Map (BTC / ETH) — companies & governments, % of supply
   · CSV export of 365 daily closes
   All keyless; every card names its source and freshness.
   ============================================================ */
window.DLDOSSIER = (function () {
  "use strict";
  if (window.DLDOSSIER && window.DLDOSSIER.__v) return window.DLDOSSIER;
  /* v162 · esc() escapes an attribute; it does not make a URL safe. Only
     http(s) may reach an href — a javascript: URI from a feed or from a
     CoinGecko link block would otherwise run on click. */
  function safeHref(u) { u = String(u == null ? "" : u); return /^https?:\/\//i.test(u) ? u : "#"; }
  var C = window.DLCORE, $ = C.$, esc = C.esc;
  var CGB = (function () { try { return typeof CG === "string" ? CG : "https://api.coingecko.com/api/v3"; } catch (e) { return "https://api.coingecko.com/api/v3"; } })();
  function cur() { try { return S.coin; } catch (e) { return null; } }
  function detail(id) { return C.jget(CGB + "/coins/" + id + "?localization=false&tickers=false&market_data=false&community_data=true&developer_data=true&sparkline=false", { key: "cg.coin." + id, ttl: 6048e5, ms: 12000 }); }
  function tickers(id) { return C.jget(CGB + "/coins/" + id + "/tickers?include_exchange_logo=false&depth=true&order=volume_desc", { key: "cg.tick." + id, ttl: 3e5, ms: 12000 }); }
  function treasury(id) { return C.jget(CGB + "/companies/public_treasury/" + id, { key: "cg.treas." + id, ttl: 36e5, ms: 12000 }); }
  function story(desc) { var t = String(desc || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(); if (!t) return ""; var s = t.split(/(?<=[.!?])\s+/).slice(0, 3).join(" "); return s.length > 420 ? s.slice(0, 417) + "…" : s; }
  function card(id, anchorId) { var el = $(id); if (el) return el; el = document.createElement("div"); el.id = id; el.className = "dl154"; var a = $(anchorId) || $("dlForecast") || $("dlCoinAI") || $("cv-kpis"); a.insertAdjacentElement("afterend", el); return el; }

  /* ---------------------------------------------------------- Dossier */
  function dossier() {
    var sym = cur(), c = C.coin(sym); if (!c || !c.id) return;
    var el = card("dlDossier", "dlForecast"); if (el.dataset.sym === sym) return; el.dataset.sym = sym;
    el.innerHTML = '<div class="h">📁 Dossier · ' + esc(sym) + '</div>' + C.skel(2);
    detail(c.id).then(function (r) {
      var d = r.data || {}, L = d.links || {}, dev = d.developer_data || {}, com = d.community_data || {}, plat = d.platforms || {};
      var links = [];
      (L.homepage || []).filter(Boolean).slice(0, 1).forEach(function (u) { links.push(["Website", u]); });
      if (L.whitepaper) links.push(["Whitepaper", L.whitepaper]);
      (L.blockchain_site || []).filter(Boolean).slice(0, 2).forEach(function (u) { links.push(["Explorer", u]); });
      (L.repos_url && L.repos_url.github || []).filter(Boolean).slice(0, 1).forEach(function (u) { links.push(["Code", u]); });
      if (L.twitter_screen_name) links.push(["X", "https://x.com/" + L.twitter_screen_name]);
      if (L.subreddit_url) links.push(["Reddit", L.subreddit_url]);
      var chains = Object.keys(plat).filter(function (k) { return k && plat[k]; }).slice(0, 6);
      var st = story(d.description && d.description.en);
      el.innerHTML = '<div class="h">📁 Dossier · ' + esc(sym) + '<span class="sp"></span>' + C.prov("CoinGecko", r.at, r.stale) + "</div>" +
        (st ? '<div style="font:500 13px var(--ui-sans,sans-serif);line-height:1.5;margin-bottom:8px">' + esc(st) + "</div>" : "") +
        (links.length ? '<div class="dl-chips" style="margin:0 0 8px">' + links.map(function (l) { return '<a class="dl-chip" href="' + esc(safeHref(l[1])) + '" target="_blank" rel="noopener noreferrer" style="text-decoration:none">' + esc(l[0]) + " ↗</a>"; }).join("") + "</div>" : "") +
        '<div class="dl-2"><div><div class="h" style="margin-bottom:4px">Code</div>' + (dev.commit_count_4_weeks != null || dev.stars ? '<div class="kv"><span>Commits · 4 weeks</span><b>' + (dev.commit_count_4_weeks != null ? dev.commit_count_4_weeks : "—") + '</b></div><div class="kv"><span>Stars · forks</span><b>' + (dev.stars || 0).toLocaleString() + " · " + (dev.forks || 0).toLocaleString() + '</b></div><div class="kv"><span>PRs merged · contributors</span><b>' + (dev.pull_requests_merged || 0).toLocaleString() + " · " + (dev.pull_request_contributors || 0) + "</b></div>" : '<div class="n" style="margin:0">No public repository tracked.</div>') + "</div>" +
        '<div><div class="h" style="margin-bottom:4px">Crowd</div><div class="kv"><span>X followers</span><b>' + (com.twitter_followers ? com.twitter_followers.toLocaleString() : "—") + '</b></div><div class="kv"><span>Reddit members</span><b>' + (com.reddit_subscribers ? com.reddit_subscribers.toLocaleString() : "—") + '</b></div><div class="kv"><span>Telegram</span><b>' + (com.telegram_channel_user_count ? com.telegram_channel_user_count.toLocaleString() : "—") + "</b></div></div></div>" +
        (chains.length ? '<div class="h" style="margin:10px 0 4px">Contracts <span style="font:500 11px var(--ui-sans,sans-serif);color:var(--muted)">· one tap scans it on GoPlus</span></div><div class="dl-chips" style="margin:0">' + chains.map(function (k) { return '<button class="dl-chip" data-scan="' + esc(k) + '" data-addr="' + esc(plat[k]) + '" title="' + esc(plat[k]) + '">🛡 ' + esc(k) + "</button>"; }).join("") + "</div>" : "") +
        '<div class="n">Numbers, not adjectives: commits, stars and followers straight from CoinGecko’s developer and community data. A busy repo is a pulse, not a promise.</div>';
      el.querySelectorAll("[data-scan]").forEach(function (b) { b.onclick = function () { scanContract(b.getAttribute("data-scan"), b.getAttribute("data-addr")); }; });
    }).catch(function (e) { el.innerHTML = '<div class="h">📁 Dossier · ' + esc(sym) + '</div><div class="dl-empty">Dossier unavailable — ' + esc(e.message || e) + "</div>"; });
  }
  var NETMAP = { ethereum: "eth", "binance-smart-chain": "bsc", "polygon-pos": "polygon", "arbitrum-one": "arbitrum", base: "base", "optimistic-ethereum": "optimism", avalanche: "avalanche" };
  function scanContract(platform, addr) {
    var net = NETMAP[platform];
    if (!net) { C.toast("warn", "No keyless scanner for " + platform + " yet", "GoPlus covers Ethereum, BNB, Polygon, Arbitrum, Base, Optimism, Avalanche (and Solana in Pool Radar)"); return; }
    try { openIntel("sec"); } catch (e) { return; }
    setTimeout(function () { var chip = document.querySelector('#dlSecNet [data-n="' + net + '"]'); chip && chip.click(); var inp = $("dlSecAddr"); if (inp) { inp.value = addr; var go = $("dlSecGo"); go && go.click(); } }, 250);
  }

  /* ---------------------------------------------------------- Venues */
  function venues() {
    var sym = cur(), c = C.coin(sym); if (!c || !c.id || sym === "USDT") return;
    var el = card("dlVenues", "dlDossier"); if (el.dataset.sym === sym) return; el.dataset.sym = sym;
    el.innerHTML = '<div class="h">🏦 Venues · tradeability</div>' + C.skel(3);
    tickers(c.id).then(function (r) {
      var t = (r.data && r.data.tickers || []).filter(function (x) { return x && x.converted_volume && x.converted_volume.usd > 0; }).slice(0, 8);
      var size = 1000;
      function row(x) { var vol = x.converted_volume.usd, depth = +x.cost_to_move_up_usd || 0, spread = +x.bid_ask_spread_percentage || 0, trust = x.trust_score, slip = depth ? Math.min(20, size / depth * 2) : null; return '<tr><td><b>' + esc(x.market && x.market.name || "?") + '</b><br><span style="opacity:.6">' + esc(x.base) + "/" + esc(x.target) + '</span></td><td class="r">' + C.money(+x.last) + '</td><td class="r">' + C.big(vol) + '</td><td class="r">' + spread.toFixed(2) + '%</td><td class="r">' + (depth ? C.big(depth) : "—") + '</td><td class="r ' + (slip == null ? "" : slip < 0.2 ? "up" : slip > 1 ? "dn" : "") + '">' + (slip == null ? "—" : "≈" + slip.toFixed(2) + "%") + '</td><td>' + (trust === "green" ? "🟢" : trust === "yellow" ? "🟡" : trust === "red" ? "🔴" : "⚪") + (x.is_stale ? ' <span class="dn" title="stale ticker">stale</span>' : "") + "</td></tr>"; }
      el.innerHTML = '<div class="h">🏦 Venues · tradeability <span class="sp"></span>' + C.prov("CoinGecko tickers", r.at, r.stale) + "</div>" + (t.length ? '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Venue</th><th class="r">Last</th><th class="r">24h vol</th><th class="r">Spread</th><th class="r">Depth +2%</th><th class="r">Slip @ $' + size + '</th><th>Trust</th></tr></thead><tbody>' + t.map(row).join("") + "</tbody></table></div>" : '<div class="dl-empty">No venue tickers for this asset.</div>') +
        '<div class="dl-formula">slip @ $1,000 ≈ order ÷ (cost to move the book +2%) × 2% — a linear read inside the 2% band, the same shape the Pro execution overlay charges you\nTrust = CoinGecko’s venue score. Spread and depth are why the same coin fills differently on different venues — the Venue Board ranks them for your size.</div>';
    }).catch(function (e) { el.innerHTML = '<div class="h">🏦 Venues</div><div class="dl-empty">Tickers unavailable — ' + esc(e.message || e) + "</div>"; });
  }

  /* ---------------------------------------------------------- Coin Wire */
  function wire() {
    var sym = cur(), c = C.coin(sym); if (!c) return;
    var el = card("dlWire", "dlVenues"); var nc = []; try { nc = newsCache || []; } catch (e) {}
    var name = c.name.toLowerCase(), re = new RegExp("\\b(" + sym.toLowerCase().replace(/[^a-z0-9]/g, "") + "|" + name.replace(/[^a-z0-9 ]/g, "") + ")\\b", "i");
    var hits = nc.filter(function (a) { return re.test(a.title || "") || re.test(a.excerpt || ""); }).slice(0, 6);
    var sent = function (t) { try { return window.DLOMNI && DLOMNI.sent ? DLOMNI.sent(t) : 0; } catch (e) { return 0; } };
    el.innerHTML = '<div class="h">📰 Coin Wire · ' + esc(sym) + ' <span style="font:500 11px var(--ui-sans,sans-serif);color:var(--muted)">· the News desk filtered to this coin</span><span class="sp"></span>' + (nc.length ? '<span class="dl-prov recent">' + nc.length + " headlines loaded</span>" : '<button class="dl-b" id="dlWireLoad">Load the desk</button>') + "</div>" +
      (hits.length ? hits.map(function (a) { var s = sent(a.title); return '<div class="kv" style="align-items:flex-start"><span><a href="' + esc(safeHref(a.link)) + '" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none">' + esc(a.title) + '</a><br><span style="opacity:.6">' + esc(a.source) + " · " + C.ago(a.t) + '</span></span><b class="' + (s > 0 ? "up" : s < 0 ? "dn" : "") + '">' + (s > 0 ? "bullish" : s < 0 ? "bearish" : "neutral") + "</b></div>"; }).join("") : '<div class="dl-empty" style="padding:8px">' + (nc.length ? "No headline mentions " + esc(c.name) + " right now — quiet tape." : "Open the News desk once and this card fills from the same headlines.") + "</div>") +
      '<div class="n">Sentiment is the on-device keyword scorer from the News desk — a lexicon, not an oracle.</div>';
    var b = $("dlWireLoad"); if (b) b.onclick = function () { try { loadNews(true).then(function () { el.dataset.sym = ""; wire(); }); } catch (e) {} };
  }

  /* ---------------------------------------------------------- Treasury Map (BTC/ETH) */
  function treasuryCard() {
    var sym = cur(); if (sym !== "BTC" && sym !== "ETH") { var old = $("dlTreasury"); old && old.remove(); return; }
    var id = sym === "BTC" ? "bitcoin" : "ethereum";
    var el = card("dlTreasury", "dlWire"); if (el.dataset.sym === sym) return; el.dataset.sym = sym;
    el.innerHTML = '<div class="h">🏛 Treasury Map</div>' + C.skel(2);
    treasury(id).then(function (r) {
      var d = r.data || {}, list = (d.companies || []).slice(0, 8);
      el.innerHTML = '<div class="h">🏛 Treasury Map · ' + sym + ' <span class="sp"></span>' + C.prov("CoinGecko", r.at, r.stale) + '</div><div class="kv"><span>Held by tracked treasuries</span><b>' + (d.total_holdings || 0).toLocaleString() + " " + sym + " · " + (d.market_cap_dominance != null ? (+d.market_cap_dominance).toFixed(2) + "% of supply" : "") + "</b></div>" +
        list.map(function (x) { return '<div class="kv"><span>' + esc(x.name) + ' <span style="opacity:.6">' + esc(x.symbol || "") + " · " + esc(x.country || "") + "</span></span><b>" + (+x.total_holdings || 0).toLocaleString() + " · " + (+x.percentage_of_total_supply || 0).toFixed(2) + "%</b></div>"; }).join("") +
        '<div style="margin-top:8px"><button class="dl-b" id="dlTreasAll">Full map →</button></div><div class="n">Public companies and governments that disclose holdings. Cost basis and current value are in the full map.</div>';
      $("dlTreasAll").onclick = function () { C.open("dlTreasurySheet", { title: "🏛 Treasury Map · " + sym, sub: "CoinGecko public-treasury data · keyless", tabs: [], onTab: function (t, body) { body.innerHTML = '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Holder</th><th>Country</th><th class="r">Holdings</th><th class="r">% supply</th><th class="r">Entry value</th><th class="r">Current value</th></tr></thead><tbody>' + (d.companies || []).map(function (x) { return "<tr><td><b>" + esc(x.name) + "</b> " + esc(x.symbol || "") + "</td><td>" + esc(x.country || "") + '</td><td class="r">' + (+x.total_holdings || 0).toLocaleString() + '</td><td class="r">' + (+x.percentage_of_total_supply || 0).toFixed(3) + '%</td><td class="r">' + C.big(x.total_entry_value_usd) + '</td><td class="r">' + C.big(x.total_current_value_usd) + "</td></tr>"; }).join("") + "</tbody></table></div>"; } }); };
    }).catch(function (e) { el.innerHTML = '<div class="h">🏛 Treasury Map</div><div class="dl-empty">' + esc(e.message || e) + "</div>"; });
  }

  /* ---------------------------------------------------------- CSV export on the history card */
  function csvButton() {
    var h = $("dlHist"); if (!h || h.querySelector("#dlCsv")) return;
    var b = document.createElement("button"); b.id = "dlCsv"; b.className = "dl-b"; b.textContent = "⬇ CSV · 365d"; b.style.margin = "6px 0 0";
    h.appendChild(b);
    b.onclick = function () { var c = C.coin(cur()); if (!c || !c.id) return; b.disabled = true; C.jget(CGB + "/coins/" + c.id + "/market_chart?vs_currency=usd&days=365&interval=daily", { key: "cg." + c.id + ".365", ttl: 36e5, ms: 12000 }).then(function (r) { var rows = (r.data.prices || []).map(function (p, i) { var mc = r.data.market_caps && r.data.market_caps[i], v = r.data.total_volumes && r.data.total_volumes[i]; return new Date(p[0]).toISOString().slice(0, 10) + "," + p[1] + "," + (mc ? mc[1] : "") + "," + (v ? v[1] : ""); }); dlFile(c.sym + "_daily_365.csv", "text/csv", "date,close_usd,market_cap_usd,volume_usd\n" + rows.join("\n")); C.toast("good", "CSV saved", c.sym + " · " + rows.length + " daily closes · CoinGecko"); }).catch(function (e) { C.toast("bad", "Export failed", String(e.message || e)); }).then(function () { b.disabled = false; }); };
  }

  function mounts() { if (!document.querySelector("#page-coin.active")) return; dossier(); venues(); wire(); treasuryCard(); csvButton(); }
  C.onPage("coin", mounts);
  return { __v: 154, mounts: mounts, detail: detail, tickers: tickers, story: story, scanContract: scanContract };
})();
