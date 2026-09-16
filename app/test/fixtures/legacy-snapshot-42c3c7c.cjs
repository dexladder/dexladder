// Verbatim cut of the pure core of web/layers/21-snapshot.js (DLSNAP) at commit 42c3c7c —
// constants + field / freshness / wit / resolve / dominance / subsetCheck / contested.
// Frozen so the parity tests compare lib/snapshot against what shipped. Do not edit.
// Free variables the test must provide: C (provClass), usd, window (for window.DLF).
module.exports = function (C, usd, window) {
var QUORUM_TOLERANCE_PCT = 1.5;                 /* the shipped quorumTag() threshold */
var REASONS = { unavailable: 1, unsupported: 1, "insufficient-history": 1, loading: 1, stale: 1 };
var U_GLOBAL = "Whole crypto market";
var U_TRACKED = "Tracked set";
function field(v, reason, o) {
    o = o || {};
    v = window.DLF ? DLF.n(v) : (v == null || v === "" ? null : (isFinite(+v) ? +v : null));
    if (v == null && !reason) reason = "unavailable";
    if (v != null) reason = null;
    if (reason && !REASONS[reason]) throw new Error("reason not in the closed set: " + reason);
    return {
      value: v,
      reason: reason || null,
      unit: o.unit || "USD",
      universe: o.universe || "global",
      universeLabel: o.universeLabel || (o.universe === "tracked" ? U_TRACKED : U_GLOBAL),
      precision: o.precision == null ? null : o.precision,
      source: o.source || "derived",
      observedAt: o.observedAt == null ? null : o.observedAt,   /* never back-filled */
      fetchedAt: o.fetchedAt || 0,
      servedAt: o.servedAt || 0,
      staleMs: o.cycleAt && o.servedAt ? Math.max(0, o.cycleAt - o.servedAt) : null,
      freshness: freshness(o.servedAt, o.stale),
      witnesses: o.witnesses || [],
      quorum: o.quorum || "single",
      dev: o.dev == null ? null : o.dev,
      derivedFrom: o.derivedFrom || null
    };
  }
function freshness(at, stale) {
    try { return C.provClass(at || 0, !!stale); }
    catch (e) { return "stale"; }
  }
function wit(src, v, at, positive) {
    if (v == null || !isFinite(+v)) return null;
    if (positive && +v <= 0) return null;
    return { source: src, value: +v, at: at || 0 };
  }
function resolve(ws) {
    ws = (ws || []).filter(function (w) { return w && w.value != null && isFinite(+w.value); });
    if (!ws.length) return { value: null, reason: "unavailable", quorum: "none", dev: null, witnesses: [] };
    var ps = ws.map(function (w) { return +w.value; }).slice().sort(function (a, b) { return a - b; });
    var med = ps.length % 2 ? ps[(ps.length - 1) / 2] : (ps[ps.length / 2 - 1] + ps[ps.length / 2]) / 2;
    var dev = med ? Math.max.apply(null, ps.map(function (p) { return Math.abs(p - med) / med * 100; })) : 0;
    return {
      value: med, reason: null,
      quorum: ws.length === 1 ? "single" : (dev > QUORUM_TOLERANCE_PCT ? "disagree" : "agree"),
      dev: dev,
      witnesses: ws.map(function (w) { return { source: w.source, value: +w.value, at: w.at || 0 }; })
    };
  }
function dominance(numF, denF, o) {
    o = o || {};
    if (!numF || !denF) return field(null, "unavailable", o);
    if (numF.universe !== denF.universe || numF.source !== denF.source)
      return field(null, "unsupported", { universe: (o.universe || denF.universe), source: denF.source });
    if (numF.value == null || denF.value == null || !denF.value)
      return field(null, numF.reason || denF.reason || "unavailable",
        { universe: denF.universe, source: denF.source, unit: "%" });
    return field(numF.value / denF.value * 100, null, {
      unit: "%", precision: 1, universe: denF.universe, source: denF.source,
      observedAt: denF.observedAt, fetchedAt: denF.fetchedAt, servedAt: denF.servedAt,
      cycleAt: o.cycleAt, stale: denF.freshness === "stale",
      derivedFrom: "ratio of two fields in the " + denF.universe + " universe"
    });
  }
function subsetCheck(sub, sup, what) {
    if (!sub || !sup || sub.value == null || sup.value == null) return { state: "undecidable", note: null };
    if (sub.value <= sup.value) return { state: "ok", note: null };
    var ws = (sup.witnesses || []).map(function (x) { return +x.value; });
    var hi = ws.length ? Math.max.apply(null, ws) : sup.value;
    if (ws.length > 1 && sub.value <= hi) return {
      state: "within-witness-range",
      note: "The tracked-set " + what + " is larger than the whole-market MEDIAN because the two " +
        "whole-market witnesses disagree (" + sup.witnesses.map(function (x) { return x.source + " " + usd(x.value); }).join(" vs ") +
        "). The tracked sum lies inside their range, so the pair is not a contradiction — the whole-market " +
        "figure is the one in doubt, not this one."
    };
    return {
      state: "impossible",
      note: "The tracked-set " + what + " is larger than every whole-market witness. A subset cannot exceed " +
        "its superset, so at least one of the two is wrong; neither should be read as exact."
    };
  }
function contested(f) { return !!(f && f.quorum === "disagree" && f.witnesses && f.witnesses.length > 1); }
  return { field: field, freshness: freshness, wit: wit, resolve: resolve, dominance: dominance, subsetCheck: subsetCheck, contested: contested };
};
