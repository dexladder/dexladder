/* ============================================================================
   DexLadder — ASTRA BOOT  ·  "Ladder Nebula"  ·  layer 00  ·  2026-09-07
   Self-mounting opening animation. Particle galaxy → condenses into the
   DexLadder MARK and RESOLVES TO A PIXEL-EXACT LOGO (the particle grid is
   dense enough to tile the shape solid, and the real vector cross-fades in
   over the last quarter of the converge, so the held frame is the actual
   anti-aliased mark with its true gradient — not a stipple of it)
   → holds → shatters → removes itself from the DOM.

   LAWS OBSERVED
     · decorative only  → aria-hidden, pointer-events:none, inert to a11y tree
     · eye-comfort      → no strobe, no per-particle shadowBlur, no flash frame
     · reduced-motion   → single static frame + 240ms fade (no rotation)
     · never traps      → skips on any input; hard watchdog removes at 2900ms
     · leaves no trace  → canvas + node + rAF + listeners all torn down
     · Day + Night      → reads dl.mode / html[data-mode=day]; no inline tokens
                          are ever written to documentElement
     · zero deps, zero network, no Bitcoin glyph, no persistent background
   KILL SWITCHES
     localStorage 'dl.astra' = 'off'   ·   URL ?astra=0   ·   DLASTRA.off()
   API
     DLASTRA.replay()  DLASTRA.off()  DLASTRA.on()  DLASTRA.version
   ========================================================================== */
(function () {
  'use strict';
  if (window.DLASTRA) return;

  var VERSION = 'astra-1.2.0-exact';
  var DUR = { emerge: 420, swirl: 1000, converge: 1520, hold: 1900, dissolve: 2320, hard: 2900 };
  var SEEN_KEY = 'dl.astra.seen';   // sessionStorage — one play per session
  var OFF_KEY  = 'dl.astra';        // localStorage   — 'off' disables forever

  function q(k, s) { try { return (s ? sessionStorage : localStorage).getItem(k); } catch (e) { return null; } }
  function set(k, v, s) { try { (s ? sessionStorage : localStorage).setItem(k, v); } catch (e) {} }
  function del(k, s) { try { (s ? sessionStorage : localStorage).removeItem(k); } catch (e) {} }

  var reduced = false;
  try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  function isDay() {
    try { return document.documentElement.getAttribute('data-mode') === 'day'; } catch (e) { return false; }
  }

  /* --- palette -------------------------------------------------------------
     Night: cyan → indigo on the app's own near-black ground.
     Day:   the same two hues darkened so they carry >=4.5:1 weight on the warm
            paper ground; the ground itself is the Day page colour, never white. */
  function palette() {
    return isDay()
      ? { bg: '#FBF7F1', core: '#12203A', core3: [24, 44, 80],  a: [11, 94, 158], b: [61, 61, 148], dust: [110, 100, 88],  glow: 0.42, ink: '#221A12' }
      : { bg: '#05080E', core: '#F2FAFF', core3: [190, 236, 255], a: [0, 229, 255],  b: [91, 124, 255], dust: [148, 162, 196], glow: 1.0,  ink: '#E7EDF8' };
  }

  /* ---------------------------------------------------------------- geometry
     A log-spiral disc with a differential rotation curve (omega falls off with
     radius, so the arms shear the way a real disc does — that is the whole
     reason this reads as a galaxy and not as confetti). Inclined and squashed
     on Y, depth-sorted by a cheap z so the near edge overdraws the far edge. */
  function build(n, w, h) {
    var P = new Float32Array(n * 8); // r, th, omega, z, size, hue, -, -
    var ARMS = 2, TIGHT = 0.34, R = Math.min(w, h) * 0.52;
    for (var i = 0; i < n; i++) {
      var o = i * 8;
      var bulge = i < n * 0.20;
      var field = !bulge && i % 5 === 0;   // inter-arm dust, no spiral binding
      var u = Math.random();
      // bulge = gaussian core, disc = flat-ish distribution out to R
      var r = bulge ? R * 0.16 * Math.sqrt(-2 * Math.log(1 - u * 0.999)) * 0.6
                    : R * Math.pow(u, 0.46);
      var arm = Math.floor(Math.random() * ARMS) * (Math.PI * 2 / ARMS);
      var spread = (1 - r / R) * 0.70 + 0.30;
      var th = field ? Math.random() * Math.PI * 2
             : arm + Math.log(1 + r / (R * TIGHT)) * 2.05
             + (Math.random() - 0.5) * spread * (bulge ? 3.4 : 1);
      P[o]     = r;
      P[o + 1] = th;
      P[o + 2] = 1;                                   // omega scale, set below
      P[o + 3] = Math.random();                       // z 0..1 (depth)
      P[o + 4] = bulge ? 0.9 + Math.random() * 1.1 : 0.7 + Math.random() * 1.3;
      P[o + 5] = Math.min(1, r / (R * 0.75)) * (0.55 + Math.random() * 0.45); // 0=core hue,1=rim
      // rotation curve: fast core, shearing disc
      P[o + 2] = 1.9 / Math.pow(1 + r / (R * 0.30), 0.72);
    }
    return P;
  }

  /* ------------------------------------------------------------- THE MARK
     The DexLadder mark, rebuilt from the canonical 512-viewBox geometry
     (brand-mark source of truth, 2026-09-03) and rasterised offscreen ONCE at
     device resolution:
       rail   M 260 70 C 500 70, 500 420, 140 420   stroke 34, round caps
       rungs  3 × (48×70 r10 body + 10px wick)      wicks #00E5FF/#00F2D0/#00FFA3
       nodes  2 × r16 ring, stroke 8
       paint  fg gradient #00FFA3 (0,512) → #00E5FF (512,0)

     That one raster does two jobs:
       1. TARGETS — every opaque pixel is scanned, then uniformly subsampled to
          EXACTLY as many points as there are particles, so each particle owns a
          distinct pixel and the cloud tiles the shape solid with no gaps and no
          wasted particles. Each target carries its own colour, so the logo
          arrives already painted in the real gradient.
       2. THE VECTOR ITSELF — the same canvas is composited over the particles
          across the last quarter of the converge, so the frame the eye rests on
          is the true anti-aliased mark, pixel-exact, not an approximation. */
  function markTargets(w, h, day, dpr, N, bg) {
    var S = Math.min(w, h) * (w < 560 ? 0.78 : 0.60);   // on-screen size, CSS px
    var c = document.createElement('canvas');
    var px = Math.max(200, Math.round(S * dpr));
    c.width = c.height = px;
    var x = c.getContext('2d', { willReadFrequently: true });
    if (!x) return null;
    var k = px / 545;                                   // viewBox + the 15px group offset
    if (day) { try { x.filter = 'brightness(.5) saturate(1.15)'; } catch (e) {} }
    x.save();
    x.scale(k, k);
    x.translate(15, 0);

    var fg = x.createLinearGradient(0, 512, 512, 0);
    fg.addColorStop(0, '#00FFA3');
    fg.addColorStop(1, '#00E5FF');
    x.lineCap = 'round';
    x.lineJoin = 'round';

    // rail — the bezier that reads as the D
    x.strokeStyle = fg; x.lineWidth = 34;
    x.beginPath(); x.moveTo(260, 70); x.bezierCurveTo(500, 70, 500, 420, 140, 420); x.stroke();

    // three candle rungs stepping down the rail
    var RUNG = [[260, 70, 180, 236, 90, '#00E5FF'],
                [200, 190, 300, 176, 210, '#00F2D0'],
                [140, 310, 420, 116, 330, '#00FFA3']];
    for (var i = 0; i < 3; i++) {
      var g = RUNG[i];
      x.strokeStyle = g[5]; x.lineWidth = 10;
      x.beginPath(); x.moveTo(g[0], g[1]); x.lineTo(g[0], g[2]); x.stroke();
      x.fillStyle = fg;
      rr(x, g[3], g[4], 48, 70, 10); x.fill();
    }

    // two end nodes — the SVG fills the disc with the tile colour and strokes a
    // ring over it, so the rail is punched through underneath. Reproduce exactly,
    // using the overlay's own ground as the fill.
    x.lineWidth = 8;
    x.fillStyle = bg;
    x.strokeStyle = '#00E5FF'; x.beginPath(); x.arc(260, 70, 16, 0, 6.2832); x.fill(); x.stroke();
    x.strokeStyle = '#00FFA3'; x.beginPath(); x.arc(140, 420, 16, 0, 6.2832); x.fill(); x.stroke();
    x.restore();

    var d;
    try { d = x.getImageData(0, 0, px, px).data; } catch (e) { return null; }

    // ---- pass 1: every opaque pixel + the artwork bbox --------------------
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, n = 0, yy, xx, o;
    for (yy = 0; yy < px; yy++) {
      for (xx = 0; xx < px; xx++) {
        if (d[(yy * px + xx) * 4 + 3] < 128) continue;
        n++;
        if (xx < x0) x0 = xx; if (xx > x1) x1 = xx;
        if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
      }
    }
    if (n < 200) return null;

    // ---- pass 2: keep EXACTLY min(n, N) of them, evenly ------------------
    var keep = Math.min(n, N);
    var stride = n / keep;                      // fractional, walked with an accumulator
    // centre on the ARTWORK bbox, not the tile — the mark sits off-centre in its square
    var ox = w / 2 - ((x0 + x1) / 2) / dpr;
    var oy = h * 0.47 - ((y0 + y1) / 2) / dpr;
    var pts = new Float32Array(keep * 2), cols = new Uint16Array(keep);
    var key = {}, pal = [], seen = 0, taken = 0, next = 0;
    for (yy = 0; yy < px && taken < keep; yy++) {
      for (xx = 0; xx < px && taken < keep; xx++) {
        o = (yy * px + xx) * 4;
        if (d[o + 3] < 128) continue;
        if (seen++ < next) continue;
        next += stride;
        var r = d[o] & 0xF8, g2 = d[o + 1] & 0xF8, b = d[o + 2] & 0xF8;   // 32 levels/channel
        var kk = (r << 16) | (g2 << 8) | b;
        var idx = key[kk];
        if (idx === undefined) { idx = pal.length; key[kk] = idx; pal.push('rgb(' + r + ',' + g2 + ',' + b + ')'); }
        pts[taken * 2]     = xx / dpr + ox;
        pts[taken * 2 + 1] = yy / dpr + oy;
        cols[taken] = idx;
        taken++;
      }
    }
    // cell = the CSS-pixel pitch between kept points; particles are drawn at
    // ~1.25 cell so the grid closes into a solid shape with no moiré holes
    var cell = Math.sqrt((n / (dpr * dpr)) / taken);
    return { p: pts, c: cols, pal: pal, n: taken, cv: c, ox: ox, oy: oy, S: S, cell: cell };
  }

  function rr(x, a, b, w, h, r) {
    x.beginPath();
    x.moveTo(a + r, b);
    x.lineTo(a + w - r, b); x.quadraticCurveTo(a + w, b, a + w, b + r);
    x.lineTo(a + w, b + h - r); x.quadraticCurveTo(a + w, b + h, a + w - r, b + h);
    x.lineTo(a + r, b + h); x.quadraticCurveTo(a, b + h, a, b + h - r);
    x.lineTo(a, b + r); x.quadraticCurveTo(a, b, a + r, b);
    x.closePath();
  }

  var live = null;

  function run() {
    if (live) return;
    if (q(OFF_KEY) === 'off') return;
    try { if (/[?&]astra=0/.test(location.search)) return; } catch (e) {}

    var pal = palette();
    var host = document.createElement('div');
    host.id = 'dlAstra';
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText =
      'position:fixed;inset:0;z-index:2147483000;pointer-events:none;contain:strict;' +
      'background:' + pal.bg + ';opacity:1;will-change:opacity;' +
      'transition:opacity 380ms cubic-bezier(.4,0,.2,1)';
    var cv = document.createElement('canvas');
    cv.style.cssText = 'display:block;width:100%;height:100%';
    host.appendChild(cv);

    var cap = document.createElement('div');
    cap.style.cssText =
      'position:absolute;left:0;right:0;bottom:12%;text-align:center;font:500 11px/1.6 ' +
      'ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.22em;text-transform:uppercase;' +
      'color:' + pal.ink + ';opacity:0;transition:opacity 520ms ease 760ms';
    cap.textContent = 'live markets · paper money · zero stakes';
    host.appendChild(cap);

    (document.body || document.documentElement).appendChild(host);
    requestAnimationFrame(function () { cap.style.opacity = isDay() ? '.62' : '.5'; });

    var ctx = cv.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) { host.remove(); return; }

    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var W = 0, H = 0, P = null, N = 0, TG = null;

    function size() {
      W = host.clientWidth || innerWidth;
      H = host.clientHeight || innerHeight;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      N = Math.max(3000, Math.min(12000, Math.round((W * H) / 155)));
      P = build(N, W, H);
      TG = markTargets(W, H, isDay(), dpr, N, pal.bg);
    }
    size();

    var t0 = performance.now(), raf = 0, dead = false, tilt = 0.44;

    function mix(a, b, t) {
      return 'rgb(' + ((a[0] + (b[0] - a[0]) * t) | 0) + ',' +
                      ((a[1] + (b[1] - a[1]) * t) | 0) + ',' +
                      ((a[2] + (b[2] - a[2]) * t) | 0) + ')';
    }
    var ramp = [], RN = 24;
    for (var ri = 0; ri < RN; ri++) ramp.push(mix(pal.a, pal.b, ri / (RN - 1)));
    var dustC = 'rgb(' + pal.dust.join(',') + ')';

    function frame(now) {
      if (dead) return;
      var t = now - t0;
      if (t > DUR.hard) return end();

      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, W, H);

      var cx = W / 2, cy = H * 0.5;
      var spin = reduced ? 0 : (t / 1000) * 0.85;

      // phase envelopes
      var em  = Math.min(1, t / DUR.emerge);
      var cvg = t <= DUR.swirl ? 0 : Math.min(1, (t - DUR.swirl) / (DUR.converge - DUR.swirl));
      cvg = cvg * cvg * (3 - 2 * cvg);                       // smoothstep
      if (reduced) cvg = 1;   // reduced-motion still gets the finished logo, just no journey
      var out = t <= DUR.hold ? 0 : Math.min(1, (t - DUR.hold) / (DUR.dissolve - DUR.hold));
      var alphaAll = (reduced ? 1 : em) * (1 - out * 0.86);

      ctx.globalCompositeOperation = 'lighter';

      // core bloom — one gradient, not a per-particle blur (that is what cooks GPUs)
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(W, H) * 0.36);
      g.addColorStop(0, 'rgba(' + pal.core3.join(',') + ',' + (0.34 * pal.glow * alphaAll * (1 - cvg * 0.55)).toFixed(3) + ')');
      g.addColorStop(0.22, 'rgba(' + pal.a.join(',') + ',' + (0.20 * pal.glow * alphaAll * (1 - cvg * 0.55)).toFixed(3) + ')');
      g.addColorStop(0.55, 'rgba(' + pal.b.join(',') + ',' + (0.075 * pal.glow * alphaAll).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      var TN = TG ? TG.n : 0, TP = TG ? TG.p : null, TC = TG ? TG.c : null, TPAL = TG ? TG.pal : null;
      var CELL = TG ? TG.cell : 1;
      // the real vector rises over the last quarter of the converge and is what
      // the eye actually rests on during the hold
      var mk = cvg <= 0.60 ? 0 : Math.min(1, (cvg - 0.60) / 0.40);
      mk = mk * mk * (3 - 2 * mk);
      for (var i = 0; i < N; i++) {
        var o = i * 8;
        var r = P[o], th = P[o + 1] + spin * P[o + 2], z = P[o + 3];
        var x = cx + Math.cos(th) * r;
        var y = cy + Math.sin(th) * r * tilt - (z - 0.5) * 18;

        var ti = -1;
        if (cvg > 0 && TN) {
          // targets were subsampled to exactly min(opaquePixels, N), so a plain
          // modulo now gives every target its own particle with none stranded
          ti = i % TN;
          var k = ti * 2;
          x += (TP[k] - x) * cvg;
          y += (TP[k + 1] - y) * cvg;
        }
        if (out > 0) {                                        // dissolve outward
          var dx = x - cx, dy = y - cy;
          x += dx * out * 0.55; y += dy * out * 0.55;
        }

        var depth = 0.55 + z * 0.45;
        var a = alphaAll * depth * (0.46 + (1 - P[o + 5]) * 0.54) * (cvg > 0 ? (0.62 + cvg * 1.55) : 1) * (1 - mk * (1 - out));
        if (a <= 0.012) continue;
        var sb = P[o + 4] * depth;
        var s = sb + (CELL * 1.25 - sb) * cvg;   // close the grid into a solid shape

        ctx.globalAlpha = a;
        // past the halfway point of the converge the particle has taken on the
        // mark's own colour at the pixel it is flying to
        ctx.fillStyle = (ti >= 0 && cvg > 0.42) ? TPAL[TC[ti]]
                      : (P[o + 5] < 0.12 ? pal.core
                      : (P[o + 5] > 0.93 ? dustC : ramp[(P[o + 5] * (RN - 1)) | 0]));
        ctx.fillRect(x, y, s, s);
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      // ---- the exact mark ------------------------------------------------
      if (mk > 0 && TG) {
        ctx.globalAlpha = mk * (1 - out);
        ctx.drawImage(TG.cv, TG.ox, TG.oy, TG.S, TG.S);
        ctx.globalAlpha = 1;
      }

      if (reduced) { setTimeout(end, 240); return; }
      raf = requestAnimationFrame(frame);
    }

    function end() {
      if (dead) return;
      dead = true;
      cancelAnimationFrame(raf);
      host.style.opacity = '0';
      setTimeout(function () { try { host.remove(); } catch (e) {} }, 400);
      removeEventListener('resize', onResize);
      removeEventListener('pointerdown', end, true);
      removeEventListener('keydown', end, true);
      removeEventListener('wheel', end, true);
      document.removeEventListener('visibilitychange', onVis);
      clearTimeout(watchdog);
      live = null;
      set(SEEN_KEY, '1', true);
      try { dispatchEvent(new CustomEvent('dl:astra-done')); } catch (e) {}
    }

    function onResize() { try { size(); } catch (e) { end(); } }
    function onVis() { if (document.hidden) end(); }

    addEventListener('resize', onResize, { passive: true });
    addEventListener('pointerdown', end, true);
    addEventListener('keydown', end, true);
    addEventListener('wheel', end, { capture: true, passive: true });
    document.addEventListener('visibilitychange', onVis);
    var watchdog = setTimeout(end, DUR.hard + 200);

    live = { end: end };
    try {
      dispatchEvent(new CustomEvent('dl:astra-ready', { detail: {
        particles: N, targets: TG ? TG.n : 0, cell: TG ? +TG.cell.toFixed(2) : 0,
        markPx: TG ? Math.round(TG.S) : 0, dpr: dpr, day: isDay(), reduced: reduced
      } }));
    } catch (e) {}
    raf = requestAnimationFrame(frame);
  }

  window.DLASTRA = {
    version: VERSION,
    replay: function () { if (live) live.end(); del(SEEN_KEY, true); setTimeout(run, 60); },
    off: function () { set(OFF_KEY, 'off'); if (live) live.end(); },
    on: function () { del(OFF_KEY); },
    _run: run
  };

  // one play per browsing session; a soft reload inside the PWA does not replay
  if (q(SEEN_KEY, true) !== '1') {
    if (document.body) run();
    else document.addEventListener('DOMContentLoaded', run, { once: true });
  }
})();
