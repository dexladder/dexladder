/* ============================================================
   DLSECTORS · v154 — Sectors + Narrative Rotation
   500+ CoinGecko categories (keyless) as a browsable sheet, each one a
   tap away from becoming a Rung; a Narrative Rotation ribbon on
   Markets ranks sectors by 24h move relative to the whole market and
   by volume heat, with the formula printed. Data: /coins/categories
   (10-min cache) and /coins/markets?category=… on demand.
   ============================================================ */
window.DLSECTORS = (function () {
  "use strict";
  if (window.DLSECTORS && window.DLSECTORS.__v) return window.DLSECTORS;
  var C = window.DLCORE, $ = C.$, esc = C.esc;
  var CGB = (function () { try { return typeof CG === "string" ? CG : "https://api.coingecko.com/api/v3"; } catch (e) { return "https://api.coingecko.com/api/v3"; } })();
  var LAST = null, Q = "";
  function load(force) {
    return C.jget(CGB + "/coins/categories?order=market_cap_desc", { key: "cg.categories", ttl: 6e5, ms: 9000, force: force }).then(function (r) {
      var list = (r.data || []).filter(function (c) { return c && c.market_cap > 0; }).map(function (c) {
        return { id: c.id, name: c.name, mcap: +c.market_cap || 0, ch: +c.market_cap_change_24h || 0, vol: +c.volume_24h || 0, top: c.top_3_coins_id || [], heat: c.market_cap ? (+c.volume_24h || 0) / c.market_cap : 0 };
      });
      /* relative flow: sector 24h minus the cap-weighted median of all sectors (a robust "market" baseline) */
      var chs = list.map(function (c) { return c.ch; }).sort(function (a, b) { return a - b; });
      var med = chs.length ? chs[Math.floor(chs.length / 2)] : 0;
      list.forEach(function (c) { c.rel = c.ch - med; });
      LAST = { list: list, at: r.at, stale: r.stale, med: med, src: "CoinGecko" };
      return LAST;
    });
  }
  function symOf(id) { var all = C.coinsAll(); for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i].sym; return null; }
  function rungFor(sec) {
    return C.jget(CGB + "/coins/markets?vs_currency=usd&category=" + encodeURIComponent(sec.id) + "&order=market_cap_desc&per_page=100&page=1", { key: "cg.cat." + sec.id, ttl: 6e5, ms: 9000 }).then(function (r) {
      var syms = (r.data || []).map(function (x) { return String(x.symbol || "").toUpperCase(); }).filter(Boolean);
      var known = new Set(C.coinsAll().map(function (c) { return c.sym; }));
      var onLadder = syms.filter(function (s) { return known.has(s); });
      var rung = { id: "sec." + sec.id, name: sec.name.replace(/\s*\(.*?\)\s*/g, " ").trim().slice(0, 28), ic: "◈", syms: onLadder, note: sec.name + " · " + onLadder.length + " of " + syms.length + " sector coins are on the 500-coin ladder", sector: sec.id };
      window.DLRUNGS && DLRUNGS.register(rung);
      return rung;
    });
  }
  function openAsRung(id) {
    var sec = (LAST && LAST.list || []).filter(function (c) { return c.id === id; })[0]; if (!sec) return;
    C.toast("good", "Building rung", sec.name + " — fetching the sector’s coins…");
    rungFor(sec).then(function (r) { C.close("dlSectors"); nav("markets"); setTimeout(function () { DLRUNGS.apply(r.id); }, 500); C.xp("sector.rung", 10, "Turned a sector into a Rung"); }).catch(function (e) { C.toast("bad", "Sector unavailable", String(e.message || e)); });
  }
  function rowsHTML(list) {
    return '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>#</th><th>Sector</th><th class="r">Market cap</th><th class="r">24h</th><th class="r">vs market</th><th class="r">Vol / cap</th><th>Top 3 on the ladder</th><th></th></tr></thead><tbody>' +
      list.map(function (c, i) {
        var tops = c.top.map(symOf).filter(Boolean).slice(0, 3);
        return '<tr class="click" data-sec="' + esc(c.id) + '"><td>' + (i + 1) + "</td><td><b>" + esc(c.name) + '</b></td><td class="r">' + C.big(c.mcap) + '</td><td class="r">' + C.chg(c.ch) + '</td><td class="r">' + C.chg(c.rel) + '</td><td class="r">' + (100 * c.heat).toFixed(1) + "%</td><td>" + (tops.length ? tops.map(function (s) { return '<button class="dl-b" data-coin="' + esc(s) + '" style="min-height:24px;padding:0 8px">' + esc(s) + "</button>"; }).join(" ") : '<span style="opacity:.5">off-ladder</span>') + '</td><td><button class="dl-b" data-rung="' + esc(c.id) + '">🪜 Rung</button></td></tr>';
      }).join("") + "</tbody></table></div>";
  }
  function rotationHTML(list, med) {
    var byRel = list.filter(function (c) { return c.mcap > 2e8; }).slice().sort(function (a, b) { return b.rel - a.rel; });
    var inn = byRel.slice(0, 8), out = byRel.slice(-8).reverse();
    var maxAbs = Math.max(1, Math.abs(inn[0] ? inn[0].rel : 1), Math.abs(out[0] ? out[0].rel : 1));
    function bar(c, dir) { var w = Math.min(100, Math.abs(c.rel) / maxAbs * 100); return '<div class="kv" style="border:0;padding:5px 0;align-items:center;gap:8px"><span style="flex:0 0 42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(c.name) + '</span><span style="flex:1;height:8px;border-radius:99px;background:rgba(255,255,255,.05);position:relative"><i style="position:absolute;top:0;bottom:0;' + (dir > 0 ? "left:0" : "right:0") + ";width:" + w.toFixed(0) + "%;border-radius:99px;background:" + (dir > 0 ? "#3ae58f" : "#ff6b87") + '"></i></span><b style="flex:0 0 64px;text-align:right">' + C.pct(c.rel, 1) + "</b></div>"; }
    return '<div class="dl-2"><div class="dl154"><div class="h">🟢 Rotating in</div>' + inn.map(function (c) { return bar(c, 1); }).join("") + '</div><div class="dl154"><div class="h">🔴 Rotating out</div>' + out.map(function (c) { return bar(c, -1); }).join("") + "</div></div>" +
      '<div class="dl-formula">rotation = sector 24h market-cap change − median 24h change across all sectors (' + C.pct(med, 2) + ' today)\nvol / cap = 24h volume ÷ market cap — the "heat" of a sector\nsectors under $200M are hidden from rotation to keep noise out; data: CoinGecko categories, keyless</div>';
  }
  function render(tab, body, el) {
    body.innerHTML = C.skel(6);
    load(false).then(function (d) {
      var list = d.list;
      if (Q) { var q = Q.toLowerCase(); list = list.filter(function (c) { return c.name.toLowerCase().indexOf(q) > -1; }); }
      var head = '<div class="dl-in" style="margin-bottom:10px"><input id="dlSecQ" placeholder="Search ' + d.list.length + ' sectors…" value="' + esc(Q) + '">' + C.prov(d.src, d.at, d.stale, { attr: 'style="align-self:center"' }) + "</div>";
      body.innerHTML = head + (tab === "rot" ? rotationHTML(d.list, d.med) : rowsHTML(list.slice(0, 200)));
      var q = $("dlSecQ"); if (q) { q.oninput = function () { Q = q.value; render(el.dataset.tab, body, el); }; if (Q) { q.focus(); q.setSelectionRange(Q.length, Q.length); } }
    }).catch(function (e) { body.innerHTML = '<div class="dl-empty">Sectors unreachable right now — ' + esc(e.message || e) + "</div>"; });
  }
  function open(tab) {
    var el = C.open("dlSectors", { title: "◈ Sectors & Narrative Rotation", sub: "500+ sectors · each one a tap from becoming a Rung", tabs: [["list", "Sectors"], ["rot", "Rotation"]], onTab: render }, tab);
    if (!el.__wired) { el.__wired = 1; el.addEventListener("click", function (e) {
      var r = e.target.closest("[data-rung]"); if (r) return openAsRung(r.getAttribute("data-rung"));
      var c = e.target.closest("[data-coin]"); if (c) { C.close("dlSectors"); return openCoin(c.getAttribute("data-coin")); }
      var tr = e.target.closest("tr[data-sec]"); if (tr) return openAsRung(tr.getAttribute("data-sec"));
    }); }
  }
  /* Markets ribbon */
  function mount() {
    var rail = $("dlRungRail"); if (!rail || $("dlNarr")) return;
    var box = document.createElement("div"); box.id = "dlNarr"; box.className = "dl154";
    box.innerHTML = '<div class="h">🌀 Narrative rotation <span class="sp"></span><button data-open="rot">Open Sectors →</button></div><div class="dl-chips" id="dlNarrChips" style="margin:0">' + C.skel(1) + "</div>";
    rail.parentNode.insertBefore(box, rail.nextSibling);
    box.addEventListener("click", function (e) { var b = e.target.closest("[data-open]"); if (b) return open(b.getAttribute("data-open")); var s = e.target.closest("[data-sec]"); if (s) return open("list"), setTimeout(function () { openAsRung(s.getAttribute("data-sec")); }, 50); });
    load(false).then(function (d) {
      var byRel = d.list.filter(function (c) { return c.mcap > 2e8; }).sort(function (a, b) { return b.rel - a.rel; });
      var picks = byRel.slice(0, 5).concat(byRel.slice(-3).reverse());
      $("dlNarrChips").innerHTML = picks.map(function (c) { return '<button class="dl-chip" data-sec="' + esc(c.id) + '" title="' + esc(c.name) + " · vs market " + C.pct(c.rel, 1) + '">' + (c.rel >= 0 ? "🟢" : "🔴") + " " + esc(c.name.replace(/\s*\(.*?\)\s*/g, " ").trim().slice(0, 22)) + " " + C.chg(c.rel, 1) + "</button>"; }).join("") + C.prov("CoinGecko", d.at, d.stale, { attr: 'style="align-self:center"' });
    }).catch(function () { var el = $("dlNarrChips"); if (el) el.innerHTML = '<span class="dl-empty" style="padding:6px">Sector feed unreachable — retries on next visit.</span>'; });
  }
  C.cmd("sectors", "Sectors & Narrative Rotation — which narrative is capturing the tape", "◈", function () { open("rot"); });
  C.onPage("markets", mount);
  return { __v: 154, open: open, load: load, rungFor: rungFor, last: function () { return LAST; } };
})();
