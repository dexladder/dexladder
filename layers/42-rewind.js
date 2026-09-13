/* ============================================================
   DLREWIND · v157 — the Rewind desk (bar-by-bar backtester)
   · Real candles for a market, a bar size and a stretch of history
     (Binance market-data → Coinbase → Kraken), replayed one bar at a
     time. Orders fill on the bars that come NEXT — market at the open,
     limits and stops only when a bar trades through them — so a run can
     never flatter itself with a price the trader had not seen.
   · Live equity curve, drawdown, exposure, profit factor, Sharpe and a
     verdict that leads with buy-and-hold and names a small sample.
   · Hypothetical by construction: the desk never touches the paper
     account (that is the Terminal's job).
   The desk itself is typed: web/app/src/lib/backtest + hooks/useBacktest
   + components/domain/bt-* + legacy/rewind*.ts. This layer only opens it.
   ============================================================ */
window.DLREWIND = (function () {
  "use strict";
  if (window.DLREWIND && window.DLREWIND.__v) return window.DLREWIND;
  var C = window.DLCORE, $ = C.$;
  var watched = false;

  function body(t, host) {
    try { window.DLAPP && DLAPP.legacy.rewind.mount(host); }
    catch (e) { host.textContent = "The Rewind desk could not start: " + ((e && e.message) || e); }
  }

  /* the replay clock must never run out of sight: pause when the sheet closes */
  function watch(el) {
    if (watched || !el || typeof MutationObserver !== "function") return;
    watched = true;
    new MutationObserver(function () {
      if (!el.classList.contains("on")) { try { DLAPP.legacy.rewind.hide(); } catch (e) {} }
    }).observe(el, { attributes: true, attributeFilter: ["class"] });
  }

  function open() {
    var el = C.open("dlRewind", {
      title: "⏮ Rewind",
      sub: "bar-by-bar backtester — real candles, your orders, no lookahead",
      tabs: [], onTab: body
    });
    watch(el);
    return el;
  }

  /* a launcher in the Terminal's side column, above the perps desk */
  function mountBtn() {
    try {
      var side = document.querySelector("#page-coin .side");
      if (!side || $("dlRwCard")) return;
      var card = document.createElement("div");
      card.className = "card"; card.id = "dlRwCard";
      var h = document.createElement("div"); h.className = "ph";
      var b = document.createElement("b"); b.textContent = "⏮ Rewind";
      var tag = document.createElement("span"); tag.className = "tag"; tag.textContent = "BACKTEST";
      h.appendChild(b); h.appendChild(tag);
      var note = document.createElement("div"); note.className = "fnote";
      note.textContent = "Replay this market bar by bar on real history and trade it — equity curve, drawdown and a verdict against buy-and-hold. Hypothetical: your paper account is not touched.";
      var go = document.createElement("button"); go.className = "btn"; go.type = "button"; go.textContent = "Open Rewind";
      go.onclick = open;
      card.appendChild(h); card.appendChild(note); card.appendChild(go);
      var perp = $("dlPerp");
      if (perp && perp.parentNode === side) side.insertBefore(card, perp); else side.appendChild(card);
    } catch (e) {}
  }

  C.cmd("rewind", "Rewind — replay real history bar by bar and trade it", "⏮", open);
  try { if (window.DLDESKS && DLDESKS.register) DLDESKS.register("rewind", "⏮", "Rewind", "bar-by-bar backtester on real history", open); } catch (e) {}
  C.onPage("coin", mountBtn);
  return { __v: 157, open: open, mounts: mountBtn };
})();
