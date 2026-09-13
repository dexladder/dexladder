/* ============================================================
   DLCLOCK · v154 — Chain Clock: events that cannot go stale because
   the chain (or a published rule) is the source. No editorial calendar,
   no key: BTC halving (Esplora tip), difficulty retarget (mempool.space),
   Deribit monthly expiry + CME monthly expiry (calendar rules),
   Polymarket resolutions (public Gamma), your own DexLadder deadlines
   (day reset, forecasts due). CMC's Events / ICO / Airdrop calendars
   were empty or dormant when audited; this one is never empty.
   ============================================================ */
window.DLCLOCK = (function () {
  "use strict";
  if (window.DLCLOCK && window.DLCLOCK.__v) return window.DLCLOCK;
  var C = window.DLCORE, $ = C.$, esc = C.esc;
  var EV = [], AT = 0;
  function lastFriday(y, m) { var d = new Date(Date.UTC(y, m + 1, 0, 8, 0, 0)); while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() - 1); return d; }
  function nextLastFriday(hourUTC) { var now = new Date(), y = now.getUTCFullYear(), m = now.getUTCMonth(); var d = lastFriday(y, m); d.setUTCHours(hourUTC, 0, 0, 0); if (d.getTime() <= Date.now()) { d = lastFriday(y, m + 1); d.setUTCHours(hourUTC, 0, 0, 0); } return d; }
  function localMidnight() { var d = new Date(); d.setHours(24, 0, 0, 0); return d; }
  function ruleEvents() {
    var out = [];
    var der = nextLastFriday(8); out.push({ t: der.getTime(), title: "Deribit monthly options expiry", kind: "derivatives", src: "calendar rule · last Friday 08:00 UTC", sub: "Max-pain chatter peaks here; implied vol usually resets after" });
    var cme = nextLastFriday(15); out.push({ t: cme.getTime(), title: "CME Bitcoin futures expiry", kind: "derivatives", src: "calendar rule · last Friday, 4pm London", sub: "Basis and roll flows around the expiry" });
    out.push({ t: localMidnight().getTime(), title: "Your day resets — gm streak & daily ritual", kind: "you", src: "DexLadder · local midnight", sub: "Survive today’s macro scenario to keep the streak (+75 XP)" });
    try { var x = C.X(); (x && x.fc || []).filter(function (f) { return !f.res && f.due > Date.now(); }).sort(function (a, b) { return a.due - b.due; }).slice(0, 3).forEach(function (f) { out.push({ t: f.due, title: "Forecast due · " + f.sym + " " + f.lo.toFixed(f.lo < 1 ? 4 : 0) + "–" + f.hi.toFixed(f.hi < 1 ? 4 : 0), kind: "you", src: "your Forecast Journal", sub: "Brier-scored on the tick when it lands" }); }); } catch (e) {}
    return out;
  }
  function chainEvents() {
    var a = C.jget("https://blockstream.info/api/blocks/tip/height", { key: "esp.tip", ttl: 3e5, ms: 8000, text: true }).then(function (r) {
      var h = parseInt(r.data, 10); if (!(h > 0)) throw new Error("no tip"); var next = 210000 * Math.ceil(h / 210000), left = next - h;
      return { t: Date.now() + left * 6e5, title: "Bitcoin halving #" + (next / 210000), kind: "bitcoin", src: "Blockstream Esplora · tip " + h.toLocaleString(), sub: left.toLocaleString() + " blocks to go at ~10 min each · reward → " + (50 / Math.pow(2, next / 210000)).toFixed(4) + " BTC" };
    });
    var b = C.jget("https://mempool.space/api/v1/difficulty-adjustment", { key: "mp.da", ttl: 3e5, ms: 8000 }).then(function (r) {
      var d = r.data; return { t: +d.estimatedRetargetDate || Date.now() + (+d.remainingTime || 0), title: "Difficulty retarget " + (d.difficultyChange >= 0 ? "+" : "") + (+d.difficultyChange || 0).toFixed(1) + "%", kind: "bitcoin", src: "mempool.space", sub: (d.remainingBlocks || "?") + " blocks left · progress " + (+d.progressPercent || 0).toFixed(0) + "% of the 2,016-block epoch" };
    });
    var c = C.jget("https://gamma-api.polymarket.com/events?closed=false&order=endDate&ascending=true&limit=40", { key: "poly.soon", ttl: 6e5, ms: 9000 }).then(function (r) {
      var list = Array.isArray(r.data) ? r.data : (r.data && r.data.data) || [];
      var soon = list.filter(function (e) { var t = Date.parse(e.endDate || ""); return t && t > Date.now() && t < Date.now() + 21 * 864e5; });
      var crypto = soon.filter(function (e) { return (e.tags || []).some(function (t) { return /crypto|bitcoin|ethereum/i.test(t.label || t.slug || ""); }) || /bitcoin|btc|eth|solana|crypto/i.test(e.title || ""); });
      return (crypto.length ? crypto : soon).slice(0, 5).map(function (e) { return { t: Date.parse(e.endDate), title: "Resolves · " + (e.title || "market"), kind: "odds", src: "Polymarket", sub: "24h volume " + C.big(+e.volume24hr || +e.volume || 0) + " · practise it in the Odds Desk", slug: e.slug }; });
    }).catch(function () { return []; });
    return Promise.all([a.catch(function () { return null; }), b.catch(function () { return null; }), c]).then(function (rs) { return [rs[0], rs[1]].filter(Boolean).concat(rs[2]); });
  }
  function load(force) {
    if (!force && AT && Date.now() - AT < 3e5) { EV = EV.filter(function (e) { return e.kind === "you" ? false : true; }).concat(ruleEvents()); return Promise.resolve(EV); }
    return chainEvents().then(function (ch) { EV = ch.concat(ruleEvents()).filter(function (e) { return e.t > Date.now() - 6e4; }).sort(function (a, b) { return a.t - b.t; }); AT = Date.now(); return EV; });
  }
  function icon(k) { return k === "bitcoin" ? "⛏" : k === "derivatives" ? "📉" : k === "odds" ? "🎲" : "🧭"; }
  function rowHTML(e) { return '<div class="dl-row"' + (e.slug ? ' data-odds="' + esc(e.slug) + '" style="cursor:pointer"' : "") + '><div class="nm"><b>' + icon(e.kind) + " " + esc(e.title) + "</b><span>" + esc(e.sub || "") + ' · <i style="opacity:.75">' + esc(e.src) + '</i></span></div><div class="rt">' + C.until(e.t) + '<br><span style="font-size:10.5px;opacity:.7">' + new Date(e.t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) + "</span></div></div>"; }
  function open() {
    var el = C.open("dlClock", { title: "🕰 Chain Clock", sub: "events the chain and published rules decide — never an empty calendar", tabs: [], onTab: function (t, body) { body.innerHTML = C.skel(5); load(true).then(function (ev) { body.innerHTML = ev.map(rowHTML).join("") + '<div class="dl-formula">halving ETA = blocks left × 10 min from the live tip · retarget ETA from mempool.space\'s live estimate · expiries from the venues\' published calendar rules · Polymarket resolutions from its public API · your own deadlines from this device\nWhy no news calendar: the audited CMC Events / ICO / Airdrop pages were empty or dormant; DexLadder shows only what it can keep current.</div>'; }).catch(function (e) { body.innerHTML = '<div class="dl-empty">' + esc(e.message || e) + "</div>"; }); } });
    if (!el.__wired) { el.__wired = 1; el.addEventListener("click", function (e) { var o = e.target.closest("[data-odds]"); if (o && window.DLODDS) { C.close("dlClock"); DLODDS.open("crypto", o.getAttribute("data-odds")); } }); }
  }
  function mount() {
    var host = $("dlWxCard") || $("dlCycle") || $("mxMoversHost"); if (!host || $("dlClockCard")) return;
    var box = document.createElement("div"); box.id = "dlClockCard"; box.className = "dl154";
    box.innerHTML = '<div class="h">🕰 Chain Clock <span class="sp"></span><button data-open="1">All events →</button></div><div id="dlClockBody">' + C.skel(2) + '</div><div class="n">halving · difficulty · expiries · resolutions · your deadlines — computed, not curated</div>';
    host.parentNode.insertBefore(box, host.nextSibling);
    box.addEventListener("click", function (e) { if (e.target.closest("[data-open]")) open(); var o = e.target.closest("[data-odds]"); if (o && window.DLODDS) DLODDS.open("crypto", o.getAttribute("data-odds")); });
    load(false).then(function (ev) { var b = $("dlClockBody"); if (b) b.innerHTML = ev.slice(0, 4).map(rowHTML).join(""); });
  }
  C.cmd("chain clock", "Chain Clock — halving, retarget, expiries, resolutions, your deadlines", "🕰", open);
  C.onPage("markets", mount);
  return { __v: 154, open: open, load: load, events: function () { return EV; } };
})();
