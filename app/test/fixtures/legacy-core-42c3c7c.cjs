// Verbatim copy of the DLCORE math helpers as shipped in web/layers/20-core.js at commit 42c3c7c
// (lines 155-161). Frozen here so the parity tests keep comparing against the ORIGINAL formulas
// after 20-core.js is changed to delegate to DLAPP. Do not edit.
module.exports = (function () {

  /* ---------------------------------------------------------- math */
  function sma(a, n) { if (a.length < n) return null; var s = 0; for (var i = a.length - n; i < a.length; i++) s += a[i]; return s / n; }
  function rsi(a, n) { n = n || 14; if (!a || a.length < n + 1) return null; var g = 0, l = 0; for (var i = a.length - n; i < a.length; i++) { var d = a[i] - a[i - 1]; if (d >= 0) g += d; else l -= d; } if (l === 0) return 100; var rs = (g / n) / (l / n); return 100 - 100 / (1 + rs); }
  function stdev(a) { if (!a || a.length < 2) return 0; var m = a.reduce(function (x, y) { return x + y; }, 0) / a.length; var v = a.reduce(function (x, y) { return x + (y - m) * (y - m); }, 0) / (a.length - 1); return Math.sqrt(v); }
  function logRets(px) { var o = []; for (var i = 1; i < px.length; i++) if (px[i - 1] > 0 && px[i] > 0) o.push(Math.log(px[i] / px[i - 1])); return o; }
  function brier(p, hit) { return Math.pow(p - (hit ? 1 : 0), 2); }
  return { sma: sma, rsi: rsi, stdev: stdev, logRets: logRets, brier: brier };
})();
