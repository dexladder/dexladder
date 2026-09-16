/* v154j — (1) Night is forced on, once, for every existing visitor.
            (2) Grid orphan-row killer: no card grid may end with empty tracks. */
(function () {
  "use strict";

  /* ---------- 1 · force Night ---------------------------------------------
     Boot already defaults a MISSING dl.mode to dark, but anyone who ever
     opened Day still carries dl.mode="day" and keeps landing in Day. Move
     every visitor back to Night exactly once, then never touch their choice
     again. Runs before paint via the head boot script's attribute, and here
     as the belt-and-braces pass for tabs already open. */
  try {
    var RESET = "dl.darkdefault.v1";
    if (!localStorage.getItem(RESET)) {
      localStorage.setItem(RESET, "1");
      localStorage.setItem("dl.mode", "dark");
      var de = document.documentElement;
      de.removeAttribute("data-mode");
      de.style.setProperty("color-scheme", "dark");
      var mt = document.querySelector('meta[name="theme-color"]');
      if (mt) mt.setAttribute("content", "#0B1220");
      if (window.DLMODE && DLMODE.set) { try { DLMODE.set("dark", true); } catch (e) {} }
    }
  } catch (e) {}

  /* ---------- 2 · orphan-row killer ---------------------------------------
     auto-fit gives every grid the right number of columns for the width, but
     a 9-card grid in 5 columns still ends with 4 empty tracks — which is the
     dead space you actually see. For every card grid: if the last row is
     short, stretch its items across the leftover tracks so the row is full.
     Pure layout, no DOM moved, no content invented. */
  /* Structural grids: their column meaning is fixed (rail + body, table rows,
     ledger lines). Never touched. Everything else that looks like a card band
     is balanced, so this keeps working for grids added later. */
  var DENY = /\b(wrap|coin-grid|p2p-grid|comm-grid|p2xShell|dj-deck|mx-table|tbl-card|txn|blk-row|jrow|dcarow|botrow|alrow|entrow|identicon|dt-h|dt-r|p2x-row|p2x-bh|sn-vend|sn-tok|kn-cmp|sn-mine|sn-route|ih-how|ncard|corr|mx-seg|dl-tabs|nx-tabs|dlx-art-lay|dlx-art-nav|dlf-top)\b/;   /* the Blog: reading column + contents, prev/next; dlf-top: the footer's brand + four named link columns, a fixed meaning per track */

  function unbalance(g) {
    g.style.removeProperty('grid-template-columns'); g.style.removeProperty('align-items');
    [].forEach.call(g.children, function (k) {
      if (k.dataset.dlSpan) { k.style.removeProperty('grid-column'); delete k.dataset.dlSpan; }
    });
  }

  function candidates() {
    var list = [], seen = [];
    document.querySelectorAll('.page, body').forEach(function (root) {
      root.querySelectorAll('*').forEach(function (g) {
        if (seen.indexOf(g) > -1) return;
        var cs = getComputedStyle(g);
        if (cs.display.indexOf('grid') < 0) return;
        var cls = (g.className || '').toString() + ' ' + (g.id || '');
        if (DENY.test(cls)) return;
        /* v157a · a strip that layers/44-strips.js has folded to one line on a phone
           (.dl-compact, <=640px) lays itself out in CSS; balancing it here would put
           the three figures back on two rows. It is also UNbalanced on the way in, so a
           rotation from landscape (where it was balanced) does not leave the inline
           !important tracks behind on the portrait layout. */
        if (/\bdl-compact\b/.test(cls) && innerWidth <= 640) { unbalance(g); return; }
        var r = g.getBoundingClientRect();
        if (r.width < 520) return;
        var tracks = cs.gridTemplateColumns.split(' ').filter(Boolean).length;
        if (tracks < 2 || tracks > 8) return;
        seen.push(g); list.push(g);
      });
    });
    return list;
  }


  /* Pick the column count that divides the item count evenly, instead of
     leaving an orphan row and stretching one card across it. Eight films at
     1824px become 4 + 4, not 7 + 1. Only if no even split keeps the card in a
     sane width band do we fall back to stretching the tail. */
  var MINW = 258, MAXW = 520;

  function balance() {
    candidates().forEach(function (g) {
      var cs = getComputedStyle(g);
      if (cs.display.indexOf('grid') < 0) return;
      var tracks = cs.gridTemplateColumns.split(' ').filter(Boolean).length;
      if (tracks < 2) return;

      /* v155-G · a member that already spans every track is not one of the CARDS being
         balanced — it is the band's own footer or header. The hero stat strip is three
         stat tiles plus a full-width provenance footer; counting the footer made n=4,
         which scores an even 2x2 split and leaves the third tile alone in row two with
         433x91 of nothing beside it. Three tiles are three columns. */
      var kids = [].filter.call(g.children, function (k) {
        var st = getComputedStyle(k);
        if (st.display === 'none' || k.getBoundingClientRect().height <= 0) return false;
        var a = st.gridColumnStart, b = st.gridColumnEnd;
        if ((a === '1' && b === '-1') || /span\s+(all|[0-9]{2,})/.test(b)) return false;
        return true;
      });
      kids.forEach(function (k) { if (k.dataset.dlSpan) { k.style.gridColumn = ''; delete k.dataset.dlSpan; } });
      var n = kids.length;
      if (n < 2) return;

      var W = g.getBoundingClientRect().width;
      var gap = parseFloat(cs.columnGap || cs.gap || '14') || 14;
      function widthAt(c) { return (W - (c - 1) * gap) / c; }

      var best = null;
      for (var c = 2; c <= Math.min(8, n); c++) {
        var w = widthAt(c);
        if (w < MINW || w > MAXW) continue;
        var rem = n % c;
        var rows = Math.ceil(n / c);
        /* even split first; then fewest empty tracks; then widest cards */
        var score = (rem === 0 ? 0 : 1000 + (c - rem) * 10) + rows;
        if (!best || score < best.score) best = { c: c, score: score, rem: rem };
      }

      if (best) {
        g.style.setProperty('grid-template-columns', 'repeat(' + best.c + ',minmax(0,1fr))', 'important');
        tracks = best.c;
      } else if (n < tracks) {
        g.style.setProperty('grid-template-columns', 'repeat(' + n + ',minmax(0,1fr))', 'important');
        return;
      }

      /* v155-G · a band of sibling cards is a ROW, and a row's members end on one
         line. 'start' is what left five markets panels ending at 141/95/469/252/141
         with nothing to equalise them — the packer chose the column count and then
         declined to answer for the bottom edge. Stretch is the answer for a card
         band; test/gate-rhythm.js measures the internal whitespace that a stretch
         can open, so this cannot be traded against that. */
      g.style.alignItems = g.style.alignItems || 'stretch';
      var rem2 = n % tracks;
      if (rem2 === 0) return;                       /* tidy */
      var tail = kids.slice(n - rem2);
      var base = Math.floor(tracks / rem2), extra = tracks - base * rem2;
      tail.forEach(function (k, i2) {
        var span = base + (i2 < extra ? 1 : 0);
        if (span > 1) { k.style.gridColumn = 'span ' + span; k.dataset.dlSpan = '1'; }
      });
    });
  }

  var t;
  function schedule() { clearTimeout(t); t = setTimeout(balance, 120); }

  function start() {
    balance();
    addEventListener('resize', schedule, { passive: true });
    /* grids are populated asynchronously by the data layers */
    try {
      var mo = new MutationObserver(schedule);
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    [400, 1200, 2600, 5000].forEach(function (ms) { setTimeout(balance, ms); });
  }

  if (document.readyState === 'complete') start();
  else addEventListener('load', start);
})();
