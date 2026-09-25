/* v155-C — height-balanced columns, and the three voids they close.
   CSS multi-column packs perfectly but splits cards mid-sentence, which is what
   broke the portfolio board. Real masonry does not use columns: it measures each
   card and drops it into whichever column is currently shortest. That is what
   this does — DOM wrappers, no splitting, no voids, fully reversible.

   Three jobs, all measured against test/harness.js at 1440x900:
     portfolio  eleven panels at 371px down the middle-left, ~998px of dead rail
                on 87% of the page. The host now owns the full container and runs
                three columns at ~420px.
     markets    fifteen full-width bands before the 500-coin table, six of them
                under 300px tall. The band run pairs up two-up.
     community  the 320px rail died 401px early. The feed's tail now spans the
                full width instead of running down one 968px column beside nothing.

   v158: after the last nudge the host stretches its columns to one bottom edge
   (data-dl-even → layers/v154.css); the cards in a column share the slack equally.

   No new timers, no new observers, no animation loops: the same three one-shot
   settle passes this layer always had, the same resize listener, plus two
   function wrappers (nav, renderCommunity) that cost nothing when not called. */
(function () {
  "use strict";
  if (window.__DLCOLS) return; window.__DLCOLS = 1;
  var GAP = 16;

  function vis(el) { return !!(el && el.getBoundingClientRect().width > 0); }

  /* --- generic masonry ---------------------------------------------------- */
  function unwrap(host) {
    var cols = host.querySelectorAll(':scope > .dlc-col');
    if (!cols.length) return;
    var frag = document.createDocumentFragment();
    [].forEach.call(cols, function (c) {
      while (c.firstChild) {
        var k = c.firstChild;
        if (k.nodeType === 1) { k.style.marginBottom = ''; k.style.width = ''; k.style.removeProperty('--dl-grow'); }
        frag.appendChild(k);
      }
    });
    host.insertBefore(frag, cols[0]);
    [].forEach.call(cols, function (c) { c.remove(); });
    host.style.display = ''; host.style.gap = ''; host.style.alignItems = '';
    host.style.gridTemplateColumns = '';
    delete host.dataset.dlCols;
    delete host.dataset.dlEven;
  }

  /* Distribute cards into n columns, always into the shortest one.

     Two passes, and the second is the one that matters. A card measured at full
     container width is not the card you get inside a 422px column — long copy
     wraps and it grows, sometimes by half again. Packing on those stale heights
     is what left one column 400px longer than another and put the ragged edge
     back. So: pack once to give every card its real width, re-measure, pack
     again on the true heights, then nudge. */
  function pack(host, items, n, hs) {
    /* natural heights while packing: the even-edge stretch (v158) is switched on only
       once the placement is final, otherwise pass 2 would measure the slack it added */
    delete host.dataset.dlEven;
    var old = host.querySelectorAll(':scope > .dlc-col');
    var cols = [], heights = [];
    for (var i = 0; i < n; i++) {
      var c = document.createElement('div');
      c.className = 'dlc-col';
      c.style.cssText = 'display:flex;flex-direction:column;gap:' + GAP + 'px;min-width:0';
      cols.push(c); heights.push(0);
    }
    host.style.display = 'grid';
    host.style.gridTemplateColumns = 'repeat(' + n + ',minmax(0,1fr))';
    host.style.gap = GAP + 'px';
    host.style.alignItems = 'start';
    cols.forEach(function (c) { host.appendChild(c); });
    items.forEach(function (el, k) {
      var h = hs[k] || 1, s = 0;
      for (var i = 1; i < n; i++) if (heights[i] < heights[s]) s = i;
      el.style.width = '100%';
      cols[s].appendChild(el);
      heights[s] += h + GAP;
    });
    [].forEach.call(old, function (c) { c.remove(); });
    host.dataset.dlCols = String(n);
    return cols;
  }

  function measure(items) {
    return items.map(function (el) { return el.getBoundingClientRect().height || 1; });
  }

  /* v155-F · a card can carry a hard minimum width of its own. The portfolio holdings
     ledger's table is min-width:640px; packed into a 422px column its .tbl-scroll clipped
     at 388px, so the header read "ASSET | HOLDINGS | PRIC" and PRICE, VALUE and 24H sat
     outside the card. Every user has the seeded 10,000 USDT, so every user saw it.

     A card that cannot fit a column does not belong in the columns — it stays on the
     full-width run above the board, where 640px fits inside 1,298px with room to spare.
     The minimum is READ, not hard-coded to one card: the payload states it either inline
     or on `table` (min-width:880px), so those are what is measured. One pass over a
     handful of nodes per card, no timer, no observer. */
  function minNeed(el) {
    var need = 0, n = el.querySelectorAll('table,[style*="min-width"]');
    for (var i = 0; i < n.length; i++) {
      var mw = parseFloat(getComputedStyle(n[i]).minWidth);
      if (mw > need) need = mw;
    }
    return need;
  }
  function tooWideForColumn(el, colW) { return minNeed(el) > colW; }

  function distribute(host, items, n) {
    pack(host, items, n, measure(items));      /* pass 1: give every card its real width */
    var cols = pack(host, items, n, measure(items));  /* pass 2: pack on the true heights */

    /* Last nudge. Sequential packing cannot recover from one very tall card — the
       portfolio's quant desk is 1,220px on its own — so this moves whichever card
       of the tallest column most reduces the spread into the shortest, and stops
       the moment no move improves it. Order inside a masonry is column-major
       already, so moving a card is a placement decision, not a reordering one. */
    /* v162 · this used to read getBoundingClientRect inside the same loop that
       appended cards, so every pass forced a synchronous reflow — up to 24 of
       them on each Portfolio render and on every resize. Same greedy algorithm,
       but all measuring happens first, the passes run against a model, and the
       moves are applied in one batch at the end. A card's height does not change
       when it moves between equal-width columns, so the model is exact. */
    for (var round = 0; round < 3; round++) {
    var model = cols.map(function (c) { return [].slice.call(c.children); });
    var hs = cols.map(function (c) { return c.getBoundingClientRect().height; });
    var CH = new Map();
    model.forEach(function (list) { list.forEach(function (el) { CH.set(el, el.getBoundingClientRect().height + GAP); }); });
    var moves = [];
    for (var pass = 0; pass < 24; pass++) {
      var tall = 0, short = 0;
      for (var i = 1; i < n; i++) {
        if (hs[i] > hs[tall]) tall = i;
        if (hs[i] < hs[short]) short = i;
      }
      var spread = hs[tall] - hs[short];
      if (spread < 40 || model[tall].length < 2) break;
      var best = null, bestSpread = spread, bestAt = -1;
      for (var j = 0; j < model[tall].length; j++) {
        var h = CH.get(model[tall][j]) || 0;
        var trial = hs.slice();
        trial[tall] -= h; trial[short] += h;
        var sp = Math.max.apply(null, trial) - Math.min.apply(null, trial);
        if (sp < bestSpread - 1) { bestSpread = sp; best = model[tall][j]; bestAt = j; }
      }
      if (!best) break;
      model[tall].splice(bestAt, 1);
      model[short].push(best);
      var bh = CH.get(best) || 0;
      hs[tall] -= bh; hs[short] += bh;
      moves.push([short, best]);
    }
    moves.forEach(function (mv) { cols[mv[0]].appendChild(mv[1]); });
    if (!moves.length) break;   /* converged */
    }

    /* v158 · one bottom edge. Packing and nudging still left the columns 100–160px
       apart (the owner's screenshots 4 and 7: a ragged board with dead space under the
       shortest column). The host now stretches every column to the tallest one and the
       cards share their column's slack IN PROPORTION TO THEIR OWN HEIGHT — justified
       like a line of text: a 900px desk absorbs most of a 120px gap, a 200px card a few
       px, so nothing changes shape that a reader would notice. The weight is the card's
       natural height, read now, before the stretch is switched on; layers/v154.css keys
       the flex on the attribute, so the stretch is a pure-CSS state with nothing to
       undo. A card that declares itself empty (data-heat="empty") takes no slack at all:
       an empty state is a note, never a hole. */
    items.forEach(function (el) {
      el.style.setProperty('--dl-grow', String(Math.max(1, Math.round(el.getBoundingClientRect().height))));
    });
    host.dataset.dlEven = '1';
  }

  /* Column count from the width the host actually has, not from innerWidth:
     the portfolio host used to sit inside a 757px grid track, so a 1440px
     window produced two 371px columns and left the right third of the page
     empty. Target column width is ~420px. */
  function colsFor(w) { return w >= 1180 ? 3 : w >= 760 ? 2 : 1; }

  /* --- the portfolio board -------------------------------------------------
     Hero and allocation stay full width on the first row; everything below is
     balanced across columns so no column runs out before the others. The host
     spans every track of the section grid — that is the fix for the dead rail. */
  function portfolio() {
    var sec = document.querySelector('#page-portfolio > .wrap.section');
    /* a hidden page measures zero, so tearing its board down while it is off screen
       would only destroy a layout nobody asked to change. Leave it alone until the
       nav wrapper brings it back on screen. */
    if (!sec || !vis(sec)) return;
    var host = sec.querySelector(':scope > .dlc-host');

    if (host) { unwrap(host); while (host.firstChild) sec.insertBefore(host.firstChild, host); host.remove(); }
    sec.style.gridTemplateColumns = '';

    var n = colsFor(sec.clientWidth);
    if (n < 2) return;

    var kids = [].slice.call(sec.children).filter(function (k) { return k.nodeType === 1; });
    var at = -1;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].matches('.pf-top') || kids[i].querySelector('.pf-top')) { at = i; break; }
    }
    if (at < 0) return;
    var tail = kids.slice(at + 1);
    if (tail.length < 3) return;

    /* split the tail: anything that cannot fit a column keeps the full width */
    var colW = (sec.clientWidth - GAP * (n - 1)) / n;
    var wide = [], packable = [];
    tail.forEach(function (el) { (tooWideForColumn(el, colW) ? wide : packable).push(el); });
    if (packable.length < 3) return;

    host = document.createElement('div');
    host.className = 'dlc-host';
    host.style.marginTop = GAP + 'px';
    host.style.gridColumn = '1 / -1';
    sec.appendChild(host);
    /* the section's two-track workbench grid exists only to seat this host, and
       the host is now the whole width — collapse the tracks so nothing is left
       holding an empty column open. */
    sec.style.gridTemplateColumns = 'minmax(0,1fr)';
    /* full-width cards stay above the balanced board, in the order they were written */
    wide.forEach(function (el) {
      el.style.width = ''; el.style.gridColumn = '1 / -1';
      sec.insertBefore(el, host);
    });
    distribute(host, packable, n);
    /* The portfolio board has eight internal joins at desktop width. Keep the
       cards readable without letting the spacing recreate the tall-page regression.
       These are inline because pack() owns the reversible grid; set them after the
       final distribution so the measured board and the rendered board agree. */
    if (n >= 3) {
      host.style.gap = '1px';
      host.style.marginTop = '0';
      [].forEach.call(host.querySelectorAll(':scope > .dlc-col'), function (col) {
        col.style.gap = '1px';
      });
    }
  }

  /* --- the markets band run -------------------------------------------------
     #mktpro is fifteen full-width bands stacked before the 500-coin table.
     Everything between the overview grid and the table controls is a
     self-contained panel, so it packs two-up. A rail header belongs to the host
     it labels (the payload stamps data-for on it), so the two travel as one. */
  function mktUnpair(root) {
    [].forEach.call(root.querySelectorAll('.dlc-pair'), function (p) {
      while (p.firstChild) p.parentNode.insertBefore(p.firstChild, p);
      p.remove();
    });
  }

  function markets() {
    var mp = document.getElementById('mktpro');
    if (!mp || !vis(mp)) return;
    var host = mp.querySelector(':scope > .dlc-host');
    if (host) {
      unwrap(host);
      while (host.firstChild) mp.insertBefore(host.firstChild, host);
      host.remove();
    }
    mktUnpair(mp);

    var kids = [].slice.call(mp.children);
    var from = -1, to = -1;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].id === 'mxTopHost') from = i + 1;
      if (kids[i].id === 'mxCtlHost') { to = i; break; }
    }
    if (from < 1 || to < 0 || to - from < 4) return;
    if (colsFor(mp.clientWidth) < 2) return;

    var run = kids.slice(from, to).filter(function (k) {
      return k.nodeType === 1 && k.getBoundingClientRect().height > 8;
    });
    if (run.length < 4) return;

    /* keep every rail header welded to its host */
    var items = [], k = 0;
    while (k < run.length) {
      var el = run[k];
      var forId = el.classList.contains('mx-rail-h') && el.getAttribute('data-for');
      if (forId && k + 1 < run.length && run[k + 1].id === forId) {
        var pair = document.createElement('div');
        pair.className = 'dlc-pair';
        el.parentNode.insertBefore(pair, el);
        pair.appendChild(el);
        pair.appendChild(run[k + 1]);
        items.push(pair);
        k += 2;
      } else { items.push(el); k += 1; }
    }
    if (items.length < 4) return;

    host = document.createElement('div');
    host.className = 'dlc-host';
    mp.insertBefore(host, kids[to]);
    distribute(host, items, colsFor(mp.clientWidth));
    repaintHeat();
  }

  /* The heatmap paints into a canvas sized from its CSS box. Moving it into a
     column halves that box, so the bitmap has to be redrawn or it ships
     horizontally squashed. layers/39b-ledgers.js exposes the repaint. */
  function repaintHeat() {
    try { if (window.DLHEATX && DLHEATX.paint) DLHEATX.paint(); } catch (e) {}
  }

  /* --- community: the feed widens where the rail ends -----------------------
     A clean 968 + 320 split, but the feed outruns the rail by 800px and the
     last third of the page was an empty gutter. The posts that start below the
     rail are moved into a full-width block under both columns — same order, no
     content added or removed. renderCommunity() rebuilds #commFeed wholesale,
     so the split is undone before it runs and rebuilt after. */
  function commUnwrap() {
    var w = document.querySelector('#page-community .comm-grid > .dlc-wide');
    if (!w) return;
    var feed = document.getElementById('commFeed');
    if (feed) while (w.firstChild) feed.appendChild(w.firstChild);
    w.remove();
  }

  function community() {
    var g = document.querySelector('#page-community .comm-grid');
    if (!g || !vis(g)) return;
    commUnwrap();
    if (g.clientWidth < 1100) return;
    var aside = g.querySelector(':scope > aside, :scope > .comm-side');
    var feed = document.getElementById('commFeed');
    if (!aside || !feed) return;

    var ab = aside.getBoundingClientRect().bottom;
    var kids = [].slice.call(feed.children);
    var at = -1;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].getBoundingClientRect().top >= ab) { at = i; break; }
    }
    if (at < 1 || kids.length - at < 2) return;

    var w = document.createElement('div');
    w.className = 'dlc-wide';
    g.appendChild(w);
    for (var j = at; j < kids.length; j++) w.appendChild(kids[j]);
  }

  /* --- schedule ------------------------------------------------------------- */
  var t, t2, t3;
  function run() {
    try { portfolio(); } catch (e) {}
    try { markets(); } catch (e) {}
    try { community(); } catch (e) {}
  }
  /* Two one-shot passes, both cancelled by the next schedule(): the first lays the
     board out at once, the later two re-balance after the cards that arrive on their
     own clock have settled — the portfolio's quant desk is 1,220px and only builds on
     the first visit, and packing without it leaves one column 600px longer than its
     neighbour. Three one-shot timers, every one of them cancelled by the next
     schedule(): no interval, no rAF loop, nothing left running between navigations. */
  function schedule() {
    clearTimeout(t); clearTimeout(t2); clearTimeout(t3);
    t = setTimeout(run, 200); t2 = setTimeout(run, 1500); t3 = setTimeout(run, 3800);
  }

  function start() {
    run();
    addEventListener('resize', schedule, { passive: true });
    [900, 2400, 5000].forEach(function (ms) { setTimeout(run, ms); });

    /* a hidden page measures zero, so every view has to be laid out once it is
       actually on screen. Wrapping nav costs nothing until nav is called. */
    var _nav = window.nav;
    if (typeof _nav === 'function' && !_nav.__dlcols) {
      var w = function () { var r = _nav.apply(this, arguments); schedule(); return r; };
      w.__dlcols = 1; window.nav = w;
    }
    /* renderCommunity() replaces #commFeed wholesale — put the tail back first,
       then re-split once the new feed has laid out. */
    var _rc = window.renderCommunity;
    if (typeof _rc === 'function' && !_rc.__dlcols) {
      var w2 = function () {
        try { commUnwrap(); } catch (e) {}
        var r = _rc.apply(this, arguments);
        schedule();
        return r;
      };
      w2.__dlcols = 1; window.renderCommunity = w2;
    }
  }
  if (document.readyState === 'complete') setTimeout(start, 200);
  else addEventListener('load', function () { setTimeout(start, 200); });
})();
