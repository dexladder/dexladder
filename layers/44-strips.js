/* ============================================================
   DLSTRIPS · v157a — the two Markets panels that covered a phone screen
   (owner report, 12 Sep 2026, two screenshots at 390px).
   1. #dlNew, the What's-New banner: a flex row that never wrapped, so the
      release summary sat in a 54px column 224px tall and the dismiss ✕ was
      at x=410 on a 390px viewport (244px tall, measured in the harness).
   2. The hero .stat-strip: three cards on a two-column grid, the third
      alone beside a void — .stat:last-child{grid-column:1/-1} stopped
      matching the moment 21-snapshot appended .dl-snapfoot after it
      (289px tall, the BTC card 177px wide beside 177px of nothing).
   Under 640px both collapse to ONE line that a chevron extends. The
   geometry is CSS (layers/v154.css, media-scoped, nothing above 920px);
   this file only adds the chevron, the short labels and the toggle —
   no inline styles, no .style assignments (gate-arch ratchets), no timer,
   loop or observer, and the figures themselves are still painted by
   21-snapshot, untouched.
   ============================================================ */
window.DLSTRIPS = (function () {
  "use strict";
  if (window.DLSTRIPS && window.DLSTRIPS.__v) return window.DLSTRIPS;
  var d = document;
  var SHORT = { "total market cap": "MCAP", "24h volume": "24H VOL", "btc dominance": "BTC.D" };
  var CHEV = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">' +
    '<path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function chevron(open, closed) {
    var b = d.createElement("button");
    b.type = "button"; b.className = "dl-more";
    b.setAttribute("aria-expanded", "false"); b.setAttribute("aria-label", open);
    b.setAttribute("data-open", open); b.setAttribute("data-closed", closed);
    b.innerHTML = CHEV;
    return b;
  }
  function isOpen(host) { return host.classList.contains("is-open"); }
  function setOpen(host, open) {
    host.classList.toggle("is-open", !!open);
    var b = host.querySelector(".dl-more");
    if (b) {
      b.setAttribute("aria-expanded", open ? "true" : "false");
      var lbl = open ? b.getAttribute("data-closed") : b.getAttribute("data-open");
      if (lbl) b.setAttribute("aria-label", lbl);
    }
    return !!open;
  }
  /* A closed strip opens from a tap anywhere on it (the whole line is the affordance on a
     phone); an open one closes only from its chevron, so the marks, links and foot inside it
     keep their own jobs. Controls that already do something never toggle. */
  function wire(host) {
    host.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      if (t.closest(".dl-more")) { setOpen(host, !isOpen(host)); return; }
      if (t.closest("a,button,.dl-dis,.dl-flag,.dl-src,.dl-prov,.gs-u,[tabindex]")) return;
      if (!isOpen(host)) setOpen(host, true);
    });
  }
  /* 1 · the banner (mounted by DLTOUR.mounts ~4s after boot, so it is watched for) */
  function banner() {
    var b = d.getElementById("dlNew");
    if (!b || b.__dlstrips) return false;
    b.__dlstrips = 1;
    b.classList.add("dl-compact");
    b.appendChild(chevron("Show the full release note", "Fold the release note"));
    wire(b);
    return true;
  }
  /* 2 · the hero strip */
  function strip() {
    var v = d.getElementById("g-mcap"), s = v && v.closest ? v.closest(".stat-strip") : null;
    if (!s || s.__dlstrips) return false;
    s.__dlstrips = 1;
    s.classList.add("dl-compact");
    var ks = s.querySelectorAll(".stat .k");
    for (var i = 0; i < ks.length; i++) {
      var t = (ks[i].textContent || "").trim().toLowerCase();
      ks[i].setAttribute("data-short", SHORT[t] || (ks[i].textContent || "").trim().slice(0, 7));
    }
    s.appendChild(chevron("Show the full market figures", "Fold the market figures"));
    wire(s);
    return true;
  }
  function mount() { strip(); banner(); }
  /* The banner is mounted by DLTOUR.mounts() (mountAll, ~4s after boot), so that one call
     is wrapped — a function wrapper that costs nothing when not called, the same shape
     zzz-columns uses for nav(); no timer, no loop, no observer. */
  function watch() {
    var T = window.DLTOUR;
    if (!T || typeof T.mounts !== "function" || T.mounts.__dlstrips) return;
    var orig = T.mounts;
    var wrapped = function () { var r = orig.apply(this, arguments); try { banner(); } catch (e) {} return r; };
    wrapped.__dlstrips = 1;
    T.mounts = wrapped;
  }
  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", function () { mount(); watch(); });
  else { mount(); watch(); }
  return { __v: 157, mount: mount, setOpen: setOpen, isOpen: isOpen };
})();
