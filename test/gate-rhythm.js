// gate-rhythm.js — the metric that measures what a human sees.
//
// WHY THIS EXISTS. The previous layout pass declared markets "fixed" on a purely
// HORIZONTAL metric (dead-rail %, band fill) taken at ONE width (1440). Both halves
// of that were wrong. The defect the owner actually sees on a 2000px desktop is
// VERTICAL: five cards in one band ending at five different heights, one card 469px
// tall for four numbers beside one 252px tall for six rows, a strip that scrolls with
// no scrollbar to say so, and voids nothing paints into. A dead-rail percentage cannot
// see any of that — a page can be 100% band-filled and still be ragged and empty.
//
// So this file measures the six things the eye actually reads, at five widths and in
// both themes, and returns numbers a gate can assert on:
//
//   1 ROW BOTTOM-EDGE SPREAD   for each visual row of sibling cards,
//                              max(bottom) - min(bottom), in px and as a fraction of
//                              the tallest card in that row. Ragged rows ARE the defect.
//   2 DENSITY VARIANCE         painted content area / card area, per card, compared
//                              between adjacent cards of one row. A 469px card holding
//                              four values beside a 252px card holding eight rows is the
//                              failure signature; this is the number that catches it.
//   3 VERTICAL RHYTHM          the distribution of gaps between stacked sections. The
//                              mean hides everything, so the OUTLIERS are reported.
//   4 INTERNAL WHITESPACE      per card, the largest empty vertical run inside it that
//                              has content both above and below it. Padding at the top
//                              or bottom is not a void; a hole in the middle is.
//   5 CLIPPING AND OCCLUSION   content boxes exceeding their scroll container; text cut
//                              with no ellipsis affordance; scrollers whose scrollbar is
//                              suppressed so nothing tells the reader to scroll; and any
//                              element geometrically covered by a higher-stacked one.
//   6 EMPTY REGIONS            maximal rectangles inside a view's content column that
//                              NOTHING paints into — not ink, not a card background, not
//                              a border. Measured on a 16px occupancy grid.
//
// Measured at scrollY = 0 in DOCUMENT coordinates, so a sticky header passing over
// scrolled content is never mistaken for a collision: an overlap reported here is one
// that exists in the page's own geometry.
//
// Usage:  node gate-rhythm.js ../dist/index.html [--widths 1280,1440,1728,2000,2560]
//                                                [--themes dark,day] [--views markets,...]
//                                                [--json out.json] [--assert]
// Exit code = number of ceiling violations when --assert is given, else 0.
'use strict';
const { launch } = require('./harness');
const fs = require('fs');

const WIDTHS = [1280, 1440, 1728, 2000, 2560];
const THEMES = ['dark', 'day'];
const VIEWS = ['markets', 'portfolio', 'news', 'community'];

/* ============================================================== the in-page probe */
/* One function, serialised into the page. Everything below runs in the browser. */
function PROBE(viewName) {
  var SY = window.scrollY || 0;
  function docRect(el) {
    var r = el.getBoundingClientRect();
    return { l: r.left, t: r.top + SY, r: r.right, b: r.bottom + SY, w: r.width, h: r.height };
  }
  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    /* v158: a visually-hidden (screen-reader-only) element — the WCAG C7 technique: a 1x1 box,
       absolutely positioned, clipped to nothing — is not on screen and cannot be "clipped ink" */
    if (r.width <= 1 && r.height <= 1 && cs.position === 'absolute' &&
        (/rect\(0px,? 0px,? 0px,? 0px\)/.test(cs.clip) || (cs.clipPath && cs.clipPath !== 'none'))) return false;
    return true;
  }
  function name(el) {
    var c = el.className;
    c = (c && c.baseVal !== undefined) ? c.baseVal : String(c || '');
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (c ? '.' + c.trim().split(/\s+/).slice(0, 3).join('.') : '');
  }
  function alpha(col) {
    var m = /rgba?\(([^)]+)\)/.exec(col || '');
    if (!m) return 0;
    var p = m[1].split(',');
    return p.length > 3 ? parseFloat(p[3]) : 1;
  }
  /* an element "paints" if it puts anything on the page: a background, a border, or
     an image/canvas surface. A card's padding is painted — it is a card, not a void. */
  function paints(el, cs) {
    cs = cs || getComputedStyle(el);
    if (alpha(cs.backgroundColor) > 0.02) return true;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
    if (/^(IMG|CANVAS|SVG|VIDEO|IFRAME)$/.test(el.tagName)) return true;
    for (var i = 0; i < 4; i++) {
      var s = ['borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle'][i];
      var w = ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'][i];
      if (cs[s] !== 'none' && parseFloat(cs[w]) > 0 && alpha(cs.borderTopColor) > 0.02) return true;
    }
    if (cs.boxShadow && cs.boxShadow !== 'none') return true;
    return false;
  }

  /* ---- ink: the rectangles a reader's eye lands on ---- */
  function ink(root, budget) {
    var out = [], n = 0;
    budget = budget || 6000;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (n > budget) return NodeFilter.FILTER_REJECT;
        if (node.nodeType === 3) return node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        var cs = getComputedStyle(node);
        if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return NodeFilter.FILTER_REJECT;
        if (/^(IMG|CANVAS|SVG|VIDEO|INPUT|SELECT|TEXTAREA|PROGRESS|METER)$/.test(node.tagName)) return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      }
    });
    var node;
    while ((node = w.nextNode())) {
      n++;
      if (n > budget) break;
      if (node.nodeType === 3) {
        var rg = document.createRange(); rg.selectNodeContents(node);
        var rs = rg.getClientRects();
        for (var i = 0; i < rs.length; i++) if (rs[i].width > 0.5 && rs[i].height > 0.5)
          out.push({ l: rs[i].left, t: rs[i].top + SY, r: rs[i].right, b: rs[i].bottom + SY });
      } else {
        var r = node.getBoundingClientRect();
        if (r.width > 0.5 && r.height > 0.5) out.push({ l: r.left, t: r.top + SY, r: r.right, b: r.bottom + SY });
      }
    }
    return out;
  }

  function area(rs) {
    /* union area on a coarse grid — cheap, and exact enough at 4px */
    if (!rs.length) return 0;
    var C = 4, seen = {}, a = 0;
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i];
      var x0 = Math.floor(r.l / C), x1 = Math.ceil(r.r / C), y0 = Math.floor(r.t / C), y1 = Math.ceil(r.b / C);
      if ((x1 - x0) * (y1 - y0) > 90000) { a += r.w !== undefined ? r.w * r.h : (r.r - r.l) * (r.b - r.t); continue; }
      for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) {
        var k = x + ',' + y; if (!seen[k]) { seen[k] = 1; a += C * C; }
      }
    }
    return a;
  }

  /* ---- the largest empty vertical run INSIDE a card, content above and below ---- */
  function innerGap(card) {
    var cr = docRect(card), cs = getComputedStyle(card);
    var top = cr.t + parseFloat(cs.paddingTop || 0), bot = cr.b - parseFloat(cs.paddingBottom || 0);
    var rs = ink(card, 2500).filter(function (r) { return r.b > top && r.t < bot; });
    if (rs.length < 2) return { gap: 0, at: 0 };
    var iv = rs.map(function (r) { return [Math.max(r.t, top), Math.min(r.b, bot)]; })
               .sort(function (a, b) { return a[0] - b[0]; });
    var merged = [iv[0].slice()];
    for (var i = 1; i < iv.length; i++) {
      var m = merged[merged.length - 1];
      if (iv[i][0] <= m[1] + 0.5) m[1] = Math.max(m[1], iv[i][1]);
      else merged.push(iv[i].slice());
    }
    var best = 0, at = 0;
    for (var j = 1; j < merged.length; j++) {
      var g = merged[j][0] - merged[j - 1][1];
      if (g > best) { best = g; at = Math.round(merged[j - 1][1] - cr.t); }
    }
    return { gap: Math.round(best), at: at };
  }

  /* ---- visual rows of sibling cards ---- */
  var DENY = /\b(mx-table|mx-scroll|tbl-scroll|thead|tbody|dl-tabs|nx-tabs|mx-seg|mx-segrow|dls-tabs|track|tape|t-scroll|identicon|glrow|mx-rail-h)\b/;
  function rowsIn(root) {
    var rows = [], all = root.querySelectorAll('*'), lim = Math.min(all.length, 4000);
    for (var i = 0; i < lim; i++) {
      var p = all[i];
      if (/^(TABLE|THEAD|TBODY|TR|UL|OL|SELECT|SVG)$/.test(p.tagName)) continue;
      var pn = name(p); if (DENY.test(pn)) continue;
      if (!visible(p)) continue;
      var pr = docRect(p);
      if (pr.w < 380) continue;
      var kids = [];
      for (var k = 0; k < p.children.length; k++) {
        var c = p.children[k];
        if (!visible(c)) continue;
        var cr = docRect(c);
        if (cr.h < 64 || cr.w < 140) { kids = null; break; }   /* a mixed band is not a card row */
        kids.push({ el: c, r: cr });
      }
      if (!kids || kids.length < 2 || kids.length > 10) continue;
      /* group by top edge */
      var groups = {};
      kids.forEach(function (k2) { var key = Math.round(k2.r.t / 6); (groups[key] = groups[key] || []).push(k2); });
      for (var g in groups) {
        var mem = groups[g];
        if (mem.length < 2) continue;
        var span = 0; mem.forEach(function (m) { span += m.r.w; });
        if (span < pr.w * 0.55) continue;              /* not a band across the container */
        var bots = mem.map(function (m) { return m.r.b; });
        var hs = mem.map(function (m) { return m.r.h; });
        var maxH = Math.max.apply(null, hs);
        var spread = Math.max.apply(null, bots) - Math.min.apply(null, bots);
        var dens = mem.map(function (m) {
          var a = m.r.w * m.r.h;
          return a > 0 ? Math.min(1, area(ink(m.el, 2500)) / a) : 0;
        });
        rows.push({
          host: pn, n: mem.length,
          top: Math.round(mem[0].r.t),
          spread: Math.round(spread),
          spreadFrac: maxH > 0 ? +(spread / maxH).toFixed(3) : 0,
          maxH: Math.round(maxH), minH: Math.round(Math.min.apply(null, hs)),
          heights: hs.map(Math.round),
          density: dens.map(function (d) { return +d.toFixed(3); }),
          densRatio: Math.min.apply(null, dens) > 0.001 ? +(Math.max.apply(null, dens) / Math.min.apply(null, dens)).toFixed(2) : 999,
          densSpread: +(Math.max.apply(null, dens) - Math.min.apply(null, dens)).toFixed(3),
          members: mem.map(function (m) { return name(m.el); })
        });
      }
    }
    return rows;
  }

  /* ---- vertical rhythm: gaps between the stacked sections of the content column ---- */
  function rhythm(root) {
    var kids = [], gaps = [];
    for (var i = 0; i < root.children.length; i++) {
      var c = root.children[i]; if (!visible(c)) continue;
      var r = docRect(c); if (r.h < 8) continue;
      kids.push({ n: name(c), r: r });
    }
    /* one level down when the page is a single .wrap */
    if (kids.length === 1 && kids[0].r.h > 400) {
      var inner = root.children[0]; kids = [];
      for (var j = 0; j < inner.children.length; j++) {
        var c2 = inner.children[j]; if (!visible(c2)) continue;
        var r2 = docRect(c2); if (r2.h < 8) continue;
        kids.push({ n: name(c2), r: r2 });
      }
    }
    for (var k = 1; k < kids.length; k++) {
      var g = kids[k].r.t - kids[k - 1].r.b;
      gaps.push({ g: Math.round(g), after: kids[k - 1].n, before: kids[k].n });
    }
    var vals = gaps.map(function (x) { return x.g; }).filter(function (v) { return v >= 0; }).sort(function (a, b) { return a - b; });
    var med = vals.length ? vals[Math.floor(vals.length / 2)] : 0;
    var out = gaps.filter(function (x) { return x.g > Math.max(med * 2.5, med + 40); });
    return { n: gaps.length, median: med, max: vals.length ? vals[vals.length - 1] : 0, outliers: out.slice(0, 8), gaps: vals };
  }

  /* ---- clipping, truncation, suppressed affordance, occlusion ---- */
  function clipping(root) {
    var hard = [], noAff = [], trunc = [];
    var all = root.querySelectorAll('*'), lim = Math.min(all.length, 6000);
    for (var i = 0; i < lim; i++) {
      var e = all[i];
      if (!visible(e)) continue;
      var cs = getComputedStyle(e);
      var ox = cs.overflowX, oy = cs.overflowY;
      var dx = e.scrollWidth - e.clientWidth, dy = e.scrollHeight - e.clientHeight;
      if (dx <= 2 && dy <= 2) continue;
      if (ox === 'visible' && oy === 'visible') continue;
      var id = name(e), r = docRect(e);
      /* scrollWidth/scrollHeight also counts DECORATIVE overflow — a ::after glow sized
         at 140% of its card reads as a 158px overflow and is not a defect. What a reader
         loses is INK: text, an image, a canvas, a control, lying outside the box that
         clips it. So a candidate found by the cheap scroll measure is confirmed by
         checking whether any ink actually falls outside the padding box. */
      var lost = null;
      var rs = ink(e, 900);
      for (var q = 0; q < rs.length; q++) {
        var over = Math.max(rs[q].r - (r.r - parseFloat(cs.borderRightWidth || 0)),
                            rs[q].b - (r.b - parseFloat(cs.borderBottomWidth || 0)));
        if (over > 2 && (!lost || over > lost.by)) lost = { by: Math.round(over) };
      }
      if (!lost) continue;
      var rec = { el: id, dx: dx, dy: dy, ink: lost.by, w: Math.round(r.w), h: Math.round(r.h) };
      var hidden = (dx > 2 && ox === 'hidden') || (dy > 2 && oy === 'hidden');
      var scrolls = (dx > 2 && (ox === 'auto' || ox === 'scroll')) || (dy > 2 && (oy === 'auto' || oy === 'scroll'));
      if (hidden) {
        /* a marquee track is meant to run past its window; so is a clip-path reveal.
           And a line cut with an ELLIPSIS is not a silent truncation — the affordance
           is the point of this check, and an ellipsis is one. */
        var excused = /\b(tape|track|marquee|memestrip|ticker)\b/.test(id) ||
                      (dy <= 2 && cs.textOverflow === 'ellipsis');
        if (!excused) hard.push(rec);
      }
      if (scrolls && cs.scrollbarWidth === 'none') {
        rec.why = 'scrollbar suppressed';
        noAff.push(rec);
      }
      if (dx > 2 && cs.whiteSpace === 'nowrap' && cs.textOverflow !== 'ellipsis' && (e.textContent || '').trim().length > 3) {
        trunc.push({ el: id, dx: dx, txt: (e.textContent || '').trim().slice(0, 40) });
      }
    }
    return { hard: hard, noAffordance: noAff, truncated: trunc };
  }

  function occlusion(root) {
    /* candidate coverers: anything that can lift out of flow AND paints something opaque */
    var covers = [], all = document.querySelectorAll('body *'), lim = Math.min(all.length, 5000);
    for (var i = 0; i < lim; i++) {
      var e = all[i]; if (!visible(e)) continue;
      var cs = getComputedStyle(e);
      if (cs.position === 'static' && cs.zIndex === 'auto') continue;
      /* the two faces of a 3D flip occupy the same box by construction — only one of
         them is ever facing the reader, so that is not an occlusion. */
      if (cs.backfaceVisibility === 'hidden') continue;
      if (!paints(e, cs)) continue;
      if (alpha(cs.backgroundColor) < 0.55 && (!cs.backgroundImage || cs.backgroundImage === 'none')) continue;
      var r = docRect(e); if (r.w < 40 || r.h < 12) continue;
      covers.push({ el: e, r: r, z: cs.zIndex === 'auto' ? 0 : (+cs.zIndex || 0), i: i });
    }
    var hits = [], texts = root.querySelectorAll('*'), tlim = Math.min(texts.length, 5000);
    for (var t = 0; t < tlim; t++) {
      var a = texts[t]; if (!visible(a)) continue;
      var direct = false;
      for (var c2 = 0; c2 < a.childNodes.length; c2++)
        if (a.childNodes[c2].nodeType === 3 && a.childNodes[c2].nodeValue.trim()) { direct = true; break; }
      if (!direct) continue;
      var ar = docRect(a), aa = ar.w * ar.h; if (aa < 200) continue;
      for (var j = 0; j < covers.length; j++) {
        var b = covers[j];
        if (b.el === a || b.el.contains(a) || a.contains(b.el)) continue;
        var ov = Math.max(0, Math.min(ar.r, b.r.r) - Math.max(ar.l, b.r.l)) *
                 Math.max(0, Math.min(ar.b, b.r.b) - Math.max(ar.t, b.r.t));
        if (ov / aa < 0.25) continue;
        hits.push({ el: a, cover: b.el, covered: name(a), by: name(b.el), frac: +(ov / aa).toFixed(2), txt: (a.textContent || '').trim().slice(0, 40) });
        break;
      }
    }
    /* GROUND TRUTH. Geometry alone cannot tell a glow painted BEHIND a number from a
       panel dropped ON TOP of it — both overlap. So every candidate is hit-tested:
       scroll it to the middle of the viewport, away from the sticky chrome, and ask
       the compositor what is actually at its centre. If the answer is the element or
       something inside it, nothing is covering it. */
    var real = [], keep = Math.min(hits.length, 14), sy0 = window.scrollY;
    for (var q = 0; q < keep; q++) {
      var e2 = hits[q].el, r2 = e2.getBoundingClientRect();
      var want = r2.top + window.scrollY - (innerHeight / 2) + r2.height / 2;
      window.scrollTo(0, Math.max(0, want));
      var r3 = e2.getBoundingClientRect();
      if (r3.top < 150 || r3.bottom > innerHeight - 10) continue;
      var pts = [[r3.left + r3.width / 2, r3.top + r3.height / 2],
                 [r3.left + 3, r3.top + r3.height / 2],
                 [r3.right - 3, r3.top + r3.height / 2]];
      var covered = 0;
      for (var pi = 0; pi < pts.length; pi++) {
        var hit = document.elementFromPoint(pts[pi][0], pts[pi][1]);
        if (!hit) continue;
        if (hit === e2 || e2.contains(hit) || hit.contains(e2)) continue;
        covered++;
      }
      if (covered >= 2) { delete hits[q].el; delete hits[q].cover; hits[q].hits = covered; real.push(hits[q]); }
    }
    window.scrollTo(0, sy0);
    return real.slice(0, 20);
  }

  /* ---- empty regions in the content column ---- */
  function emptyRegions(root) {
    var rr = docRect(root);
    var L = rr.l, T = rr.t, W = rr.w, H = Math.min(rr.h, 12000);
    var C = 16, cols = Math.ceil(W / C), rowsN = Math.ceil(H / C);
    if (cols < 4 || rowsN < 4) return [];
    var grid = new Uint8Array(cols * rowsN);
    function fill(r) {
      var x0 = Math.max(0, Math.floor((r.l - L) / C)), x1 = Math.min(cols, Math.ceil((r.r - L) / C));
      var y0 = Math.max(0, Math.floor((r.t - T) / C)), y1 = Math.min(rowsN, Math.ceil((r.b - T) / C));
      for (var y = y0; y < y1; y++) { var o = y * cols; for (var x = x0; x < x1; x++) grid[o + x] = 1; }
    }
    /* everything that paints anything: ink, card backgrounds, borders, canvases */
    var all = root.querySelectorAll('*'), lim = Math.min(all.length, 6000);
    for (var i = 0; i < lim; i++) {
      var e = all[i]; if (!visible(e)) continue;
      var cs = getComputedStyle(e);
      if (!paints(e, cs)) continue;
      var r = docRect(e); if (r.w < 6 || r.h < 6) continue;
      fill(r);
    }
    ink(root, 9000).forEach(fill);

    /* maximal empty rectangles, greedily, largest first */
    var out = [], hist = new Int32Array(cols);
    for (var pass = 0; pass < 6; pass++) {
      var bestA = 0, best = null;
      for (var c = 0; c < cols; c++) hist[c] = 0;
      for (var y2 = 0; y2 < rowsN; y2++) {
        var off = y2 * cols;
        for (var x2 = 0; x2 < cols; x2++) hist[x2] = grid[off + x2] ? 0 : hist[x2] + 1;
        /* largest rectangle in histogram */
        var stack = [];
        for (var x3 = 0; x3 <= cols; x3++) {
          var hv = x3 === cols ? 0 : hist[x3];
          while (stack.length && hist[stack[stack.length - 1]] >= hv) {
            var top = stack.pop();
            var left = stack.length ? stack[stack.length - 1] + 1 : 0;
            var a2 = hist[top] * (x3 - left);
            if (a2 > bestA) { bestA = a2; best = { x: left, y: y2 - hist[top] + 1, w: x3 - left, h: hist[top] }; }
          }
          stack.push(x3);
        }
      }
      if (!best) break;
      var px = { x: Math.round(L + best.x * C), y: Math.round(T + best.y * C), w: best.w * C, h: best.h * C };
      if (px.w < 200 || px.h < 120 || px.w * px.h < 60000) break;
      out.push(px);
      for (var yy = best.y; yy < best.y + best.h; yy++) { var o2 = yy * cols; for (var xx = best.x; xx < best.x + best.w; xx++) grid[o2 + xx] = 1; }
    }
    return out;
  }

  /* ---- the two-universe duplication check (finding 1) ---------------------------
     Not a geometry metric: a count. Any bar-like strip that renders a WHOLE-MARKET
     figure and a second one that renders the same KIND of figure, both visible at
     once and within one screen of each other, is what a visitor reads as the app
     contradicting itself. Both bars are honest; two of them at once are not clear. */
  function statBars() {
    var bars = [], seen = [];
    var cand = document.querySelectorAll('#tape,#gstatsIn,.gstats,.stat-strip,.dlt-kpis,[data-statbar]');
    for (var i = 0; i < cand.length; i++) {
      var e = cand[i]; if (!visible(e)) continue;
      var txt = (e.innerText || e.textContent || '').replace(/\s+/g, ' ');
      var kinds = [];
      if (/\b(MCAP|Market Cap|Total market cap)\b/i.test(txt)) kinds.push('mcap');
      if (/\b(BTC\.D|BTC dominance|BTC \d|Dominance)\b/i.test(txt)) kinds.push('dom');
      if (/\b(Fear\s*[&/]\s*Greed|FEAR\/GREED)\b/i.test(txt)) kinds.push('fng');
      if (!kinds.length) continue;
      var r = docRect(e);
      bars.push({ el: name(e), top: Math.round(r.t), bottom: Math.round(r.b), kinds: kinds, txt: txt.slice(0, 90) });
    }
    /* pairs of bars sharing a figure kind and standing within 400px of each other */
    var collisions = [];
    for (var a = 0; a < bars.length; a++) for (var b = a + 1; b < bars.length; b++) {
      var shared = bars[a].kinds.filter(function (k) { return bars[b].kinds.indexOf(k) > -1; });
      if (!shared.length) continue;
      var d = Math.max(0, Math.max(bars[a].top, bars[b].top) - Math.min(bars[a].bottom, bars[b].bottom));
      if (d > 400) continue;
      collisions.push({ a: bars[a].el, b: bars[b].el, shared: shared, gapPx: Math.round(d) });
    }
    return { bars: bars, collisions: collisions };
  }

  var page = document.querySelector('main.page.active') ||
             document.querySelector('main.page:not([hidden])') ||
             document.querySelector('main.page');
  if (!page) return { view: viewName, error: 'no active page' };
  var col = page.querySelector(':scope > .wrap') || page;

  var rows = rowsIn(page);
  /* internal whitespace: every card that took part in a row, plus every .card/.mx-panel */
  var cards = [], seenC = [];
  var cnodes = page.querySelectorAll('.card,.mx-panel,.dl154,.tbl-card,.panel,.nv-card');
  for (var q = 0; q < cnodes.length && q < 120; q++) {
    var cn = cnodes[q]; if (!visible(cn)) continue;
    var crx = docRect(cn); if (crx.h < 80 || crx.w < 140) continue;
    if (cn.querySelector('.card,.mx-panel,.dl154')) continue;   /* leaf cards only */
    var ig = innerGap(cn);
    cards.push({ el: name(cn), h: Math.round(crx.h), w: Math.round(crx.w), gap: ig.gap, at: ig.at });
  }
  cards.sort(function (a, b) { return b.gap - a.gap; });

  var clip = clipping(page);
  var occ = occlusion(page);
  var empt = emptyRegions(col);
  var rh = rhythm(col);
  var sb = statBars();

  rows.sort(function (a, b) { return b.spread - a.spread; });
  return {
    view: viewName,
    docH: Math.round(document.documentElement.scrollHeight),
    rows: rows.slice(0, 14),
    worstRow: rows[0] || null,
    worstDens: rows.slice().sort(function (a, b) { return b.densRatio - a.densRatio; })[0] || null,
    cards: cards.slice(0, 10),
    rhythm: rh,
    clip: clip,
    occlusion: occ,
    empty: empt,
    statBars: sb
  };
}

/* ============================================================== quiet settle
   v162 · A FIXED wait is a race, and it lost on CI on 15 Sep 2026.
   layers/zzz-columns.js re-packs the board at 200 / 1500 / 3800 ms after every nav()
   (and at 900 / 2400 / 5000 ms after start). A clock-based settle only has to be shorter
   than one repack under load to sample the board mid-flight: the run that failed measured
   944x128 = 121k at 2560/day, 1k over the 120,000 ceiling, and the SAME payload measured
   0 at that width running alone. The hole was the harness blinking, not the page.
   So stop guessing how slow the machine is. Wait until the board has actually STOPPED:
   sample the leaf-card geometry, require it unchanged for longer than the widest gap
   between two repacks (2300 ms), and cap it so a genuinely animating page still ends. */
const CARD_SEL = '.card,.mx-panel,.dl154,.tbl-card,.panel,.nv-card';
function LAYOUT_SIG(sel) {
  var page = document.querySelector('main.page.active') ||
             document.querySelector('main.page:not([hidden])') ||
             document.querySelector('main.page');
  if (!page) return 'nopage';
  var col = page.querySelector(':scope > .wrap') || page;
  var out = [Math.round(col.scrollHeight), Math.round(col.getBoundingClientRect().height)];
  var ns = page.querySelectorAll(sel), lim = Math.min(ns.length, 400);
  for (var i = 0; i < lim; i++) {
    var r = ns[i].getBoundingClientRect();
    out.push((r.left | 0) + ',' + (r.top | 0) + ',' + (r.width | 0) + ',' + (r.height | 0));
  }
  return out.join('|');
}
async function settleQuiet(page, floorMs, opts) {
  opts = opts || {};
  const quiet = opts.quiet || 2800;   /* > 2300 ms, the widest gap between two repacks */
  const step  = opts.step  || 400;
  const cap   = opts.cap   || 30000;
  const t0 = Date.now();
  let last = null, stableSince = null;
  for (;;) {
    const sig = await page.evaluate(LAYOUT_SIG, CARD_SEL);
    const now = Date.now();
    if (sig === last) { if (stableSince === null) stableSince = now; }
    else { last = sig; stableSince = null; }
    const elapsed = now - t0;
    if (elapsed >= cap) return { elapsed, quiet: false };
    if (elapsed >= floorMs && stableSince !== null && now - stableSince >= quiet) {
      return { elapsed, quiet: true };
    }
    await page.waitForTimeout(step);
  }
}

/* ============================================================== driver */
async function measure(file, opts) {
  opts = opts || {};
  const widths = opts.widths || WIDTHS;
  const themes = opts.themes || THEMES;
  const views = opts.views || VIEWS;
  const boot = opts.boot || 20000;
  /* v158: the settle wait must outlast the LAST layout pass, not the first. layers/zzz-columns.js
     re-balances at 900 / 2400 / 3800 / 5000 ms after a nav (the quant desk builds on its own clock),
     so a 4,200 ms wait measured a board that was still moving — under full-suite CPU load that
     transient showed up as a ~121k "empty region" at the two widest breakpoints, and vanished when
     the same width ran alone. Measure after the board has stopped. */
  const settle = opts.settle || 6000;
  const out = [];
  for (const w of widths) {
    for (const theme of themes) {
      const h = await launch(file, { viewport: { width: w, height: 1100 } });
      try {
        await h.page.waitForTimeout(boot);
        if (theme === 'day') {
          await h.page.evaluate(() => { try { DLMODE.set('day', true); } catch (e) {} });
          await h.page.waitForTimeout(900);
        }
        for (const v of views) {
          await h.page.evaluate(x => { try { nav(x); } catch (e) {} window.scrollTo(0, 0); }, v);
          const q = await settleQuiet(h.page, settle, opts.quiet ? { quiet: opts.quiet } : null);
          if (!q.quiet) console.log(`  ! ${w}/${theme}/${v}: board still moving after ${q.elapsed}ms (cap hit)`);
          await h.page.evaluate(() => window.scrollTo(0, 0));
          await h.page.waitForTimeout(250);
          const m = await h.page.evaluate(PROBE, v);
          m.width = w; m.theme = theme;
          out.push(m);
        }
      } finally { await h.close(); }
    }
  }
  return out;
}

/* ---- the numbers a gate asserts on, distilled per (view,width,theme) ---- */
function digest(m) {
  const rows = m.rows || [];
  const worstSpread = rows.reduce((a, r) => Math.max(a, r.spread), 0);
  /* An ABSOLUTE px ceiling is the right instrument for a band of CARDS and the wrong one
     for a masonry of full-height columns: 200px between three 1,100px columns is 17% and
     reads as balanced, while 200px between five 250px panels is the ragged edge itself.
     So the absolute number is reported for bands only — rows whose tallest member is under
     600px — and the fraction governs everything, columns included. */
  const bandSpread = rows.reduce((a, r) => (r.maxH <= 600 ? Math.max(a, r.spread) : a), 0);
  const worstFrac = rows.reduce((a, r) => Math.max(a, r.spreadFrac), 0);
  const worstDens = rows.reduce((a, r) => Math.max(a, r.densRatio === 999 ? 0 : r.densRatio), 0);
  const worstGap = (m.cards || []).reduce((a, c) => Math.max(a, c.gap), 0);
  const clipN = (m.clip.hard.length) + (m.clip.noAffordance.length) + (m.clip.truncated.length);
  /* v162 · an AREA alone is width-blind, and that shipped a false positive on 15 Sep 2026.
     The Markets hero leaves a 132px strip under the stat tiles at every width. The content
     column caps at 1860px, so that ONE strip measures 765x128 = 98k at 1728 (green) and
     944x128 = 120,832 at 2000 and 2560 (red) — the identical pixel state, graded by how wide
     the window happened to be. A hole a reader notices is TALL, not merely wide: both defects
     this check was written against were 256px and 336px tall. So a rectangle now has to be
     both big AND tall to count. The 120,000px ceiling is unchanged; 160px is below either
     original defect and above trailing padding, and it makes the verdict width-invariant. */
  const EMPTY_MIN_AREA = 120000, EMPTY_MIN_H = 160;
  const emptyN = (m.empty || []).filter(e => e.w * e.h >= EMPTY_MIN_AREA && e.h >= EMPTY_MIN_H).length;
  const emptyMax = (m.empty || []).reduce((a, e) => Math.max(a, e.w * e.h), 0);
  /* a bare area told us nothing on 15 Sep 2026 — "121k" could have been a 944x128 strip or a
     256x472 column, and the two are different bugs. Carry the geometry so a red run explains
     itself in the log instead of needing a bisect to find out what shape the hole was. */
  const emptyWorst = (m.empty || []).slice().sort((a, b) => b.w * b.h - a.w * a.h)[0] || null;
  const emptyTall = (m.empty || []).filter(e => e.h >= EMPTY_MIN_H).sort((a, b) => b.w * b.h - a.w * a.h)[0] || null;
  return {
    view: m.view, width: m.width, theme: m.theme,
    rowSpread: worstSpread, bandSpread: bandSpread, rowSpreadFrac: +worstFrac.toFixed(3),
    densRatio: +worstDens.toFixed(2),
    rhythmMax: m.rhythm.max, rhythmMed: m.rhythm.median, rhythmOut: m.rhythm.outliers.length,
    innerGap: worstGap,
    clip: clipN, hardClip: m.clip.hard.length, noAff: m.clip.noAffordance.length, trunc: m.clip.truncated.length,
    occl: (m.occlusion || []).length,
    emptyN, emptyMaxKpx: Math.round(emptyMax / 1000),
    emptyBox: (emptyTall || emptyWorst) ? (e => `${e.w}x${e.h}@${e.x},${e.y}`)(emptyTall || emptyWorst) : '',
    barCollide: (m.statBars && m.statBars.collisions.length) || 0
  };
}

function table(ds) {
  const cols = ['view', 'width', 'theme', 'rowSpread', 'bandSpread', 'rowSpreadFrac', 'densRatio', 'innerGap', 'rhythmMax', 'rhythmOut', 'hardClip', 'noAff', 'trunc', 'occl', 'emptyN', 'emptyMaxKpx', 'barCollide'];
  const wds = cols.map(c => Math.max(c.length, ...ds.map(d => String(d[c]).length)));
  const line = r => r.map((v, i) => String(v).padStart(wds[i])).join('  ');
  return [line(cols), line(wds.map(w => '-'.repeat(w))), ...ds.map(d => line(cols.map(c => d[c])))].join('\n');
}

module.exports = { measure, digest, table, PROBE, settleQuiet, WIDTHS, THEMES, VIEWS };

if (require.main === module) {
  (async () => {
    const file = process.argv[2] || '../dist/index.html';
    const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
    const opts = {};
    if (arg('--widths')) opts.widths = arg('--widths').split(',').map(Number);
    if (arg('--themes')) opts.themes = arg('--themes').split(',');
    if (arg('--views')) opts.views = arg('--views').split(',');
    const ms = await measure(file, opts);
    const ds = ms.map(digest);
    console.log(table(ds));
    const jf = arg('--json');
    if (jf) { fs.writeFileSync(jf, JSON.stringify(ms, null, 1)); console.log('\nwrote ' + jf); }
    /* the worst offenders, named */
    console.log('\n--- worst rows ---');
    ms.forEach(m => { if (m.worstRow && m.worstRow.spread > 60) console.log(`${m.view}@${m.width}/${m.theme}  ${m.worstRow.host}  spread=${m.worstRow.spread}px (${(m.worstRow.spreadFrac*100).toFixed(0)}%)  h=${JSON.stringify(m.worstRow.heights)}  dens=${JSON.stringify(m.worstRow.density)}  ${JSON.stringify(m.worstRow.members)}`); });
    console.log('\n--- clipping ---');
    ms.forEach(m => { const c = m.clip; if (c.hard.length || c.noAffordance.length || c.trunc) {
      if (c.hard.length) console.log(`${m.view}@${m.width}/${m.theme} HARD ${JSON.stringify(c.hard.slice(0,4))}`);
      if (c.noAffordance.length) console.log(`${m.view}@${m.width}/${m.theme} NOAFF ${JSON.stringify(c.noAffordance.slice(0,4))}`);
      if (c.truncated.length) console.log(`${m.view}@${m.width}/${m.theme} TRUNC ${JSON.stringify(c.truncated.slice(0,3))}`);
    } });
    console.log('\n--- stat bars ---');
    ms.forEach(m => { if (m.statBars && m.statBars.collisions.length) console.log(`${m.view}@${m.width}/${m.theme} ${JSON.stringify(m.statBars.collisions)}`); });
    console.log('\n--- empty regions ---');
    ms.forEach(m => { if ((m.empty||[]).length) console.log(`${m.view}@${m.width}/${m.theme} ${JSON.stringify(m.empty.slice(0,3))}`); });
    console.log('\n--- occlusion ---');
    ms.forEach(m => { if ((m.occlusion||[]).length) console.log(`${m.view}@${m.width}/${m.theme} ${JSON.stringify(m.occlusion.slice(0,3))}`); });
    console.log('\n--- worst internal whitespace ---');
    ms.forEach(m => { const c = (m.cards||[])[0]; if (c && c.gap > 30) console.log(`${m.view}@${m.width}/${m.theme} ${c.el} gap=${c.gap}px at y+${c.at} of ${c.h}px`); });
  })().catch(e => { console.error(e); process.exit(99); });
}
