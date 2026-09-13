/* v154e — Day surface reconciliation.
   The payload paints dozens of panels with hard-coded dark gradients that were never given a
   Day value, so in Day they render as grey slabs on a light page. This walks every stylesheet
   once, finds rules whose background is dark, and emits a Day-scoped light counterpart.
   Deterministic, runs after every other layer, costs one pass at idle. */
(function () {
  "use strict";
  if (window.__DLDAYSURF) return; window.__DLDAYSURF = 1;

  /* `slogo` is a per-source avatar: a brand-tinted square carrying the source initial, with the
     favicon laid over it. Its background is a colour-mix that reads as dark, so the sweep retinted
     it to near-white and stranded the white initial on it at 1.05. It is not a panel - keep the
     tint in both modes and the initial stays legible (white on the mix measures 10.7). */
  var SKIP = /btc-scene|wp-book|wp-page|pnode|pscene|halv-|faucet|engine-tog|\.mark|brand|chapterStage|hashbox|netwrap|tsim|kn-dia|kn-agree|sn-snack|dvx-stage|cine-film|poster|slogo|\bcanvas\b|\bsvg\b|dl-skel|skel|::selection|scrollbar/i;
  var HEX = /#([0-9a-f]{3,8})\b/gi, RGB = /rgba?\(([^)]+)\)/gi;

  function lum(r, g, b) {
    function f(x) { x /= 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function hexL(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length < 6) return null;
    return lum(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));
  }
  /* mean luminance of every colour in a background declaration, weighted by alpha:
     a low-alpha white wash over an unknown parent is not evidence of darkness, so it is skipped. */
  function darkness(v) {
    var Ls = [], m, p;
    HEX.lastIndex = 0; while ((m = HEX.exec(v))) { var L = hexL(m[1]); if (L !== null) Ls.push(L); }
    RGB.lastIndex = 0; while ((m = RGB.exec(v))) {
      p = m[1].split(/[,\/\s]+/).filter(Boolean).map(parseFloat);
      if (p.length < 3) continue;
      if (p.length > 3 && p[3] < 0.35) continue;              /* translucent wash — carries no colour */
      Ls.push(lum(p[0], p[1], p[2]));
    }
    if (!Ls.length) return null;
    return Ls.reduce(function (a, b) { return a + b; }, 0) / Ls.length;
  }

  /* v155-F · a color-mix that is mostly transparent carries no colour of its own, exactly as
     a low-alpha rgba() does. Without this, `color-mix(in srgb,var(--cyan,#00e5ff) 12%,transparent)`
     read as a BRIGHT cyan panel, so the rule was walked past as though it painted one — and the
     light foreground on it was never repaired. 1.03:1 on the AI console's jump button. */
  function stripWashes(v) {
    return String(v == null ? '' : v).replace(/color-mix\([^()]*(?:\([^()]*\)[^()]*)*\)/gi, function (m) {
      var pc = /(\d+(?:\.\d+)?)%/.exec(m);
      return (/transparent/i.test(m) && pc && parseFloat(pc[1]) < 35) ? '' : m;
    });
  }

  var TIER = [
    [0.02, '#FFFFFF'],       /* near-black panels become the raised surface */
    [0.06, '#FFFFFF'],
    [0.14, '#F7F9FC'],
    [0.22, '#F1F4F9']        /* mid-grey slabs become the inset surface */
  ];
  function lightFor(L) { for (var i = 0; i < TIER.length; i++) if (L <= TIER[i][0]) return TIER[i][1]; return '#F1F4F9'; }

  /* ---- v155-F · the other half of the hole ------------------------------------------
     The sweep above repairs a foreground only when the SAME rule also paints a dark
     background. A rule that declares ONLY a colour was walked straight past: the panel
     under it went white and the light literal stayed put. Extending
     test/gate-render-contrast.js past the eight top-level routes measured what that costs —
     #cff6ff on the retinted ask button at 1.06, #eaf0ff on the chart header at 1.14,
     #b9c6de / #afc2df / #aeb9cf / #8fa4c4 across the AI console, the rank chip and the
     lesson plates, and a #fff title on a white card at 1.00.

     So: a rule whose background is absent, or only a translucent wash that carries no
     colour of its own, composites onto whatever is beneath — which in Day is light. Its
     light foreground is re-cast to the SAME hue and saturation at a lightness dark enough
     to clear AA with headroom, so the accent survives and the invisibility does not. An
     achromatic literal has no hue to keep, so it takes the ink token instead.

     FG_TARGET is contrast against #FFFFFF. 5.5 there leaves ~4.9 on the darkest tinted Day
     surface the payload paints (#E0EEF2 / #E5EAF1), which is the real worst case. */
  var FG_TARGET = 5.5;
  function ratioOnWhite(L) { return 1.05 / (L + 0.05); }
  function hsl(R, G, B) {
    var r = R / 255, g = G / 255, b = B / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn, h = 0, sa = 0;
    if (d) {
      sa = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
      h /= 6;
    }
    return [h, sa, l];
  }
  function hslHex(h, sa, l) {
    function ch(t) { if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }
    var q = l < 0.5 ? l * (1 + sa) : l + sa - l * sa, p = 2 * l - q;
    function hx(v) { v = Math.round(v * 255).toString(16); return v.length < 2 ? '0' + v : v; }
    return '#' + hx(ch(h + 1 / 3)) + hx(ch(h)) + hx(ch(h - 1 / 3));
  }
  /* keep hue and saturation, walk the lightness down until the ratio clears the target */
  function darkenTo(R, G, B) {
    var c = hsl(R, G, B), lo = 0.02, hi = c[2], best = hslHex(c[0], c[1], lo);
    for (var i = 0; i < 24; i++) {
      var mid = (lo + hi) / 2, hex = hslHex(c[0], c[1], mid), L = hexL(hex);
      if (ratioOnWhite(L) >= FG_TARGET) { best = hex; lo = mid; } else { hi = mid; }
    }
    return best;
  }
  function dayFg(v) {
    v = String(v || '').trim(); if (!v) return null;
    var R, G, B, m = /^#([0-9a-f]{3,8})$/i.exec(v);
    if (m) {
      var h = m[1];
      if (h.length === 3 || h.length === 4) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      if (h.length < 6) return null;
      if (h.length === 8 && parseInt(h.slice(6, 8), 16) / 255 < 0.9) return null;
      R = parseInt(h.slice(0, 2), 16); G = parseInt(h.slice(2, 4), 16); B = parseInt(h.slice(4, 6), 16);
    } else {
      var p2 = /^rgba?\(([^)]+)\)$/i.exec(v); if (!p2) return null;   /* var(), color-mix(): already themed */
      var q2 = p2[1].split(/[,\/\s]+/).filter(Boolean).map(parseFloat);
      if (q2.length < 3 || !isFinite(q2[0])) return null;
      if (q2.length > 3 && q2[3] < 0.9) return null;                  /* a ghost is not text */
      R = q2[0]; G = q2[1]; B = q2[2];
    }
    if (ratioOnWhite(lum(R, G, B)) >= FG_TARGET) return null;         /* already dark enough */
    var c = hsl(R, G, B);
    if (c[1] < 0.06) return 'var(--ink)';                             /* no hue to preserve */
    return darkenTo(R, G, B);
  }

  function run() {
    var out = [], seen = {}, seenFg = {}, sheets = document.styleSheets, i, j, rules, r, sel, bg, L, fg, fL;
    for (i = 0; i < sheets.length; i++) {
      try { rules = sheets[i].cssRules; } catch (e) { continue; }
      if (!rules) continue;
      for (j = 0; j < rules.length; j++) {
        r = rules[j];
        if (!r || r.type !== 1 || !r.selectorText) continue;
        sel = r.selectorText;
        if (SKIP.test(sel) || sel.indexOf('data-mode') > -1 || seen[sel]) continue;
        bg = r.style.getPropertyValue('background') || r.style.getPropertyValue('background-image') ||
             r.style.getPropertyValue('background-color');
        L = bg ? darkness(stripWashes(bg)) : null;
        if (L === null) {
          /* no background of its own, or only a translucent wash: whatever is under it is
             light in Day, so a light foreground here is invisible. Re-cast it. */
          if (seenFg[sel]) continue;
          /* a rule that paints a THEMED background already answers for its own foreground in
             both modes — var(--up), var(--down), var(--brand) invert between them, and the
             pairing is deliberate. Only an absent background, or a wash that carries no
             colour, means "whatever is beneath", which in Day is light. */
          if (bg && /var\(/i.test(stripWashes(bg))) continue;
          var cast = dayFg(r.style.getPropertyValue('color'));
          if (!cast) continue;
          seenFg[sel] = 1;
          out.push('html[data-mode=day] ' + sel.split(',').map(function (x) { return x.trim(); })
            .join(',html[data-mode=day] ') + '{color:' + cast + ' !important}');
          continue;
        }
        if (L > 0.22) continue;
        seen[sel] = 1;
        var decl = 'background:' + lightFor(L) + ' !important;';
        if (/backdrop-filter/.test(r.style.cssText)) decl += 'backdrop-filter:none !important;-webkit-backdrop-filter:none !important;';
        if (r.style.getPropertyValue('border-color') || /border\s*:/.test(r.style.cssText)) decl += 'border-color:var(--line) !important;';
        if (r.style.getPropertyValue('box-shadow')) decl += 'box-shadow:var(--nv-e1) !important;';
        fg = r.style.getPropertyValue('color');
        if (fg) { fL = darkness(fg); if (fL !== null && fL > 0.5) decl += 'color:var(--ink) !important;'; }
        out.push('html[data-mode=day] ' + sel.split(',').map(function (x) { return x.trim(); })
          .join(',html[data-mode=day] ') + '{' + decl + '}');
      }
    }
    /* hand-written corrections the sweep cannot infer */
    out.push(
      'html[data-mode=day] #dlSignals .dl-tabs button{background:#FFF!important;color:var(--muted)!important;border-color:var(--line-2)!important}',
      'html[data-mode=day] #dlSignals .dl-tabs button.on{background:var(--indigo)!important;color:#FFF!important;border-color:transparent!important}',
      'html[data-mode=day] .card::before{background:linear-gradient(135deg,rgba(47,75,208,.20),rgba(109,40,217,.10) 40%,rgba(13,20,33,.06))!important}',
      'html[data-mode=day] .dl-skel,html[data-mode=day] .skel{background:linear-gradient(90deg,#EEF2F8,#F7F9FC,#EEF2F8)!important;background-size:200% 100%!important}',
      'html[data-mode=day] .dlx-ghost{border-color:var(--line-2)!important;color:var(--ink-2)!important}',
      'html[data-mode=day] .toast,html[data-mode=day] .modal,html[data-mode=day] .cmdk{color:var(--ink)!important}'
    );
    var st = document.createElement('style');
    st.id = 'dl-day-surfaces';
    st.textContent = out.join('\n');
    document.head.appendChild(st);
    try { window.__DLDAYSURF_N = out.length; } catch (e) {}
  }


  /* runtime warm purge: layers that inject their own <style> after build can still carry the
     old cream skin. Re-cast any light-warm colour inside a Day-scoped rule onto a cool hue at
     the same HSL lightness — contrast is preserved exactly, the cream is not. */
  function coolWarm() {
    var sheets = document.styleSheets, fixed = 0, i, j, rules, r, css, out = [];
    function recast(txt) {
      return txt.replace(/#([0-9a-f]{6})\b/gi, function (m, h) {
        var R = parseInt(h.slice(0, 2), 16), G = parseInt(h.slice(2, 4), 16), B = parseInt(h.slice(4, 6), 16);
        if (!(R >= G && G >= B && R - B >= 6 && lum(R, G, B) > 0.42)) return m;
        fixed++; return cool(R, G, B);
      }).replace(/rgba?\((\d+),\s*(\d+),\s*(\d+)(,\s*[\d.]+)?\)/g, function (m, R, G, B, A) {
        R = +R; G = +G; B = +B;
        if (!(R >= G && G >= B && R - B >= 6 && lum(R, G, B) > 0.42)) return m;
        fixed++;
        var c = cool(R, G, B).slice(1);
        return 'rgba(' + parseInt(c.slice(0,2),16) + ',' + parseInt(c.slice(2,4),16) + ',' + parseInt(c.slice(4,6),16) + (A || ',1') + ')';
      });
    }
    function cool(R, G, B) {
      var mx = Math.max(R, G, B) / 255, mn = Math.min(R, G, B) / 255, l = (mx + mn) / 2, d = mx - mn,
          s = d === 0 ? 0 : (l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn));
      s = Math.min(s, 0.30);
      var h = 214 / 360, q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
      function ch(t) { if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t; if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6; return p; }
      function hx(v) { v = Math.round(v * 255).toString(16); return v.length < 2 ? '0' + v : v; }
      return '#' + hx(ch(h + 1/3)) + hx(ch(h)) + hx(ch(h - 1/3));
    }
    for (i = 0; i < sheets.length; i++) {
      try { rules = sheets[i].cssRules; } catch (e) { continue; }
      if (!rules) continue;
      for (j = 0; j < rules.length; j++) {
        r = rules[j];
        if (!r || r.type !== 1 || !r.selectorText || r.selectorText.indexOf('data-mode') < 0) continue;
        if (r.selectorText.indexOf('day') < 0) continue;
        css = r.style.cssText; if (!css) continue;
        var next = recast(css);
        if (next !== css) out.push(r.selectorText + '{' + next + '}');
      }
    }
    if (out.length) {
      var st2 = document.createElement('style');
      st2.id = 'dl-day-warm-purge'; st2.textContent = out.join('\n');
      document.head.appendChild(st2);
    }
    try { window.__DLWARMFIX = fixed; } catch (e) {}
  }

  var _run0 = run; run = function () { _run0(); coolWarm(); };

  if (document.readyState === 'complete') setTimeout(run, 0);
  else window.addEventListener('load', function () { setTimeout(run, 0); });
})();
