/* ============================================================
   DLFORECAST · v154 — Forecast Journal + Scenario Cone
   CMC tallies the crowd's price estimates; DexLadder grades YOU. Log a
   range + a confidence for 7 or 30 days; when it lands the tick scores
   it with a Brier score and the journal shows your calibration by
   confidence bucket. XP rewards calibration, not being right.
   The Scenario Cone (1σ / 2σ from realised volatility) is the honest
   answer to "price prediction" — statistics, never a target.
   State: S.v154.fc[] (persisted in the blob).
   ============================================================ */
window.DLFORECAST = (function () {
  "use strict";
  if (window.DLFORECAST && window.DLFORECAST.__v) return window.DLFORECAST;
  var C = window.DLCORE, $ = C.$, esc = C.esc;
  function X() { var x = C.X(); if (!x) return null; x.fc || (x.fc = []); return x; }
  function list() { var x = X(); return x ? x.fc : []; }
  function cone(sym, days) {
    var c = C.coin(sym); if (!c || !c.price) return null;
    var h = (c.hist && c.hist.length > 48 ? c.hist : c.spark || []).slice(-336); var lr = C.logRets(h);
    if (lr.length < 24) return null;
    var sd = C.stdev(lr); /* per-sample; samples are ~hourly on the 7-day spark */
    var perHour = h.length >= 300 ? sd : sd; var sdDay = perHour * Math.sqrt(24), sdT = sdDay * Math.sqrt(days || 7);
    return { px: c.price, sdDay: sdDay, sdT: sdT, lo1: c.price * Math.exp(-sdT), hi1: c.price * Math.exp(sdT), lo2: c.price * Math.exp(-2 * sdT), hi2: c.price * Math.exp(2 * sdT), days: days || 7, n: lr.length };
  }
  function fmtP(v) { return v >= 1000 ? Math.round(v).toLocaleString() : v >= 1 ? v.toFixed(2) : v.toFixed(v >= 0.01 ? 4 : 6); }
  function log(sym, days, lo, hi, conf) {
    var x = X(), c = C.coin(sym); if (!x || !c) return null;
    lo = +lo; hi = +hi; conf = Math.max(0.5, Math.min(0.95, +conf || 0.7)); if (!(hi > lo) || !(lo > 0)) return null;
    var f = { id: "f" + Math.random().toString(36).slice(2, 8), sym: c.sym, t: Date.now(), horizon: days, due: Date.now() + days * 864e5, lo: lo, hi: hi, conf: conf, px0: c.price, res: null };
    x.fc.unshift(f); if (x.fc.length > 120) x.fc.pop(); C.save();
    C.toast("good", "Forecast logged", c.sym + " " + fmtP(lo) + "–" + fmtP(hi) + " in " + days + "d at " + Math.round(conf * 100) + "% confidence · scored when it lands");
    C.xp("fc.first", 10, "First forecast logged — calibration beats conviction");
    try { window.DEXAI && DEXAI.event && DEXAI.event("forecast.log", f); } catch (e) {}
    return f;
  }
  function score() {
    var x = X(); if (!x) return; var now = Date.now(), changed = false;
    x.fc.forEach(function (f) {
      if (f.res || f.due > now) return; var c = C.coin(f.sym); if (!c || !c.price) return;
      var hit = c.price >= f.lo && c.price <= f.hi; f.res = { hit: hit, px: c.price, brier: C.brier(f.conf, hit), t: now }; changed = true;
      C.toast(hit ? "good" : "warn", "Forecast scored · " + f.sym, (hit ? "Landed inside your band" : "Missed the band") + " · Brier " + f.res.brier.toFixed(3) + " (lower is better)");
    });
    if (changed) { C.save(); C.xp("fc.scored", 15, "First forecast scored — now you have a track record"); if (x.fc.filter(function (f) { return f.res; }).length >= 10) C.xp("fc.ten", 25, "Ten scored forecasts — calibration is measurable now"); try { window.DEXAI && DEXAI.event && DEXAI.event("forecast.scored", null); } catch (e) {} }
  }
  function calibration() {
    var done = list().filter(function (f) { return f.res; });
    var buckets = [[0.5, 0.6, "50–60%"], [0.6, 0.75, "60–75%"], [0.75, 0.9, "75–90%"], [0.9, 1.01, "90%+"]].map(function (b) { var fs = done.filter(function (f) { return f.conf >= b[0] && f.conf < b[1]; }); var hits = fs.filter(function (f) { return f.res.hit; }).length; return { label: b[2], n: fs.length, hit: fs.length ? hits / fs.length : null, exp: fs.length ? fs.reduce(function (s, f) { return s + f.conf; }, 0) / fs.length : null }; });
    var brier = done.length ? done.reduce(function (s, f) { return s + f.res.brier; }, 0) / done.length : null;
    var over = buckets.filter(function (b) { return b.n >= 3 && b.hit != null && b.hit < b.exp - 0.15; }).map(function (b) { return b.label; });
    return { n: done.length, brier: brier, buckets: buckets, overconfident: over, open: list().filter(function (f) { return !f.res; }).length };
  }
  /* ---------------------------------------------------------- coin page card */
  function coinCard() {
    var host = $("cv-kpis"); if (!host) return; var sym; try { sym = S.coin; } catch (e) { return; }
    var el = $("dlForecast"); if (el && el.dataset.sym === sym) return; if (el) el.remove();
    var c = C.coin(sym); if (!c) return;
    el = document.createElement("div"); el.id = "dlForecast"; el.className = "dl154"; el.dataset.sym = sym;
    var anchor = $("dlCoinAI") || host;
    anchor.insertAdjacentElement("afterend", el);
    paintCoin(el, c, 7);
  }
  function paintCoin(el, c, days) {
    var k = cone(c.sym, days), mine = list().filter(function (f) { return f.sym === c.sym; }).slice(0, 4);
    el.innerHTML = '<div class="h">🎯 Forecast Journal <span style="font:500 11px var(--ui-sans,sans-serif);color:var(--muted)">· you get graded, not the crowd</span><span class="sp"></span><span class="dl-chips" style="margin:0"><button class="dl-chip' + (days === 7 ? " on" : "") + '" data-h="7">7d</button><button class="dl-chip' + (days === 30 ? " on" : "") + '" data-h="30">30d</button></span></div>' +
      (k ? '<div class="dl-formula" style="margin:0 0 8px">Scenario cone · ' + days + 'd from realised vol (σ/day ' + (k.sdDay * 100).toFixed(2) + '%): 1σ <b>' + fmtP(k.lo1) + " – " + fmtP(k.hi1) + '</b> · 2σ ' + fmtP(k.lo2) + " – " + fmtP(k.hi2) + '\nA cone is statistics about the past, not a prediction — it is where you start drawing your own band.</div>' : '<div class="n">Not enough price history yet for a cone — set your own band.</div>') +
      '<div class="dl-2"><div><div style="display:flex;gap:6px;align-items:center"><input class="dl-inp" id="dlFcLo" type="number" step="any" value="' + (k ? fmtP(k.lo1).replace(/,/g, "") : "") + '" placeholder="low"><span>–</span><input class="dl-inp" id="dlFcHi" type="number" step="any" value="' + (k ? fmtP(k.hi1).replace(/,/g, "") : "") + '" placeholder="high"></div><div style="display:flex;gap:8px;align-items:center;margin-top:8px"><label class="dl-tog" style="flex:1">confidence <input id="dlFcConf" type="range" min="50" max="95" step="5" value="70" style="flex:1"> <b id="dlFcConfV">70%</b></label><button class="dl-b pri" id="dlFcLog">Log forecast</button></div></div>' +
      '<div>' + (mine.length ? mine.map(function (f) { var st = f.res ? (f.res.hit ? '<span class="up">hit · Brier ' + f.res.brier.toFixed(2) + "</span>" : '<span class="dn">miss · Brier ' + f.res.brier.toFixed(2) + "</span>") : (c.price >= f.lo && c.price <= f.hi ? '<span class="up">inside band</span>' : '<span class="dn">outside band</span>') + " · due " + C.until(f.due); return '<div class="kv"><span>' + fmtP(f.lo) + "–" + fmtP(f.hi) + " · " + Math.round(f.conf * 100) + "% · " + f.horizon + "d</span><b>" + st + "</b></div>"; }).join("") : '<div class="dl-empty" style="padding:8px">No forecasts on ' + esc(c.sym) + ' yet. Draw a band you would bet on, say how sure you are, and let time grade you.</div>') + "</div></div>" +
      '<div class="n">Brier score = (confidence − outcome)². 0 is perfect, 0.25 is a coin flip at 50%. Well-calibrated 70% calls land about 70% of the time — that is the skill.</div>';
    el.querySelectorAll("[data-h]").forEach(function (b) { b.onclick = function () { paintCoin(el, c, +b.getAttribute("data-h")); }; });
    var cf = $("dlFcConf"); cf.oninput = function () { $("dlFcConfV").textContent = cf.value + "%"; };
    $("dlFcLog").onclick = function () { if (log(c.sym, days, $("dlFcLo").value, $("dlFcHi").value, cf.value / 100)) paintCoin(el, c, days); else C.toast("bad", "Check the band", "High must be above low, both above zero"); };
  }
  /* ---------------------------------------------------------- portfolio card */
  function portfolioCard() {
    var host = $("chainCard") || $("anStats") || document.querySelector("#page-portfolio .card"); if (!host) return;
    var el = $("dlFcCard"); if (!el) { el = document.createElement("div"); el.id = "dlFcCard"; el.className = "dl154"; host.parentNode.insertBefore(el, host); }
    var cal = calibration();
    el.innerHTML = '<div class="h">🎯 Forecast calibration <span class="sp"></span><span style="font:600 11.5px var(--ui-sans,sans-serif);color:var(--muted)">' + cal.n + " scored · " + cal.open + " open</span></div>" +
      (cal.n ? '<div class="dl-2"><div>' + cal.buckets.map(function (b) { return '<div class="kv"><span>' + b.label + " confidence · " + b.n + "</span><b>" + (b.hit == null ? "—" : Math.round(b.hit * 100) + "% landed vs " + Math.round(b.exp * 100) + "% claimed") + "</b></div>"; }).join("") + '</div><div><div style="font:800 26px var(--ui-sans,sans-serif)">' + cal.brier.toFixed(3) + '</div><div class="n" style="margin:0">average Brier · lower is better · 0.25 = coin-flip</div>' + (cal.overconfident.length ? '<div class="dx-conf" style="margin-top:8px">Overconfident in the ' + esc(cal.overconfident.join(", ")) + " bucket — widen those bands.</div>" : cal.n >= 5 ? '<div class="n">No bucket is badly overconfident. Keep logging.</div>' : "") + "</div></div>" : '<div class="dl-empty">Log a forecast on any coin page. After a few land, this card tells you whether your 80% is really an 80%.</div>') +
      '<div class="n">On-device · scored on the engine tick when a forecast comes due · the Coach reads this card.</div>';
  }
  C.onPage("coin", coinCard);
  C.onPage("portfolio", portfolioCard);
  C.onTick(function (n) { if (n % 40 === 0) score(); });
  setTimeout(score, 5000);
  C.cmd("forecast", "Forecast Journal — draw a band, get graded on calibration", "🎯", function () { nav("portfolio"); setTimeout(function () { var el = $("dlFcCard"); el && el.scrollIntoView({ block: "center" }); }, 500); });
  return { __v: 154, cone: cone, log: log, score: score, list: list, calibration: calibration };
})();
