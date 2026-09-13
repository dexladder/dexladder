/* ============================================================
   DLH7 · v158 — the Spotlight's "7-day" series, honestly
   Owner report (12 Sep 2026, screenshot): the Markets spotlight
   card says "BTC · 7-day" and draws a three-step staircase —
   77,154.67 → 77,160 → 77,157 — with a flat run across most of
   the card.

   WHY. The card drew `c.hist.slice(-84)`. `hist` is TWO series in
   one array: the seeded 7-day history (CoinGecko's hourly sparkline,
   or the 30-minute candles DLAPP.legacy.history backfills), followed
   by one live tick every 1.5 s (tickEngine pushes c.price and shifts
   at 576). After 84 ticks — 126 seconds into any session — the last
   84 samples are ALL ticks, and the price only moves on the 60-second
   live poll, so the "7-day" chart is a 2-minute staircase with two
   or three steps. It was never a 7-day chart for longer than two
   minutes.

   WHAT. `c.spark` is the seeded history and nothing else — no tick
   is ever pushed into it, and the backfill writes the real 7-day
   candles into it. So the 7-day chart draws `spark`, with the flat
   run CoinGecko's 168-point sparkline is front-padded with removed,
   and the live price appended as the final point so the line ends
   where the big number is. If no observed history exists yet (every
   history source refused), the card says "· live" over the tick
   ring instead of claiming a week it does not have.

   Layer contract: pure reads of the coin record, no fetch, no timer,
   no observer. Wired in by buildlib/v158.py (count-asserted patches
   on updateSpotlight).
   ============================================================ */
window.DLH7 = (function () {
  "use strict";
  if (window.DLH7 && window.DLH7.__v) return window.DLH7;

  function same(a, b) { return Math.abs(a - b) <= Math.abs(b) * 1e-6; }

  /* the observed part of a seeded series: drop the constant run a padded front carries */
  function observed(sp) {
    if (!Array.isArray(sp) || sp.length < 2) return null;
    var h = [], i, n;
    for (i = 0; i < sp.length; i++) { var v = +sp[i]; if (isFinite(v) && v > 0) h.push(v); }
    n = h.length;
    if (n < 24) return null;
    i = 0;
    while (i < n - 1 && same(h[i + 1], h[0])) i++;
    var out = i ? h.slice(i) : h;
    if (out.length < 24) return null;
    /* ≤ 3 distinct values in a week is a placeholder, not a market */
    var distinct = [out[0]];
    for (i = 1; i < out.length && distinct.length <= 3; i++) {
      var seen = false;
      for (var k = 0; k < distinct.length; k++) if (same(distinct[k], out[i])) { seen = true; break; }
      if (!seen) distinct.push(out[i]);
    }
    if (distinct.length <= 3) return null;
    return out;
  }

  /* the series the spotlight draws: observed history + the live price as its last point */
  function series(c) {
    if (!c) return null;
    var base = observed(c.spark) || observed(c.hist);
    if (!base) return null;
    var out = base.slice();
    var px = +c.price;
    if (isFinite(px) && px > 0 && !same(px, out[out.length - 1])) out.push(px);
    return out;
  }
  function isReal(c) { return !!series(c); }
  function label(c) { return (c && c.sym ? c.sym : "") + (isReal(c) ? " · 7-day" : " · live"); }

  return { __v: 158, series: series, isReal: isReal, label: label, observed: observed };
})();
