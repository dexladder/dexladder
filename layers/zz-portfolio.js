/* v154l — Portfolio: curation + motion.
   The page was thirteen full-width cards stacked vertically. At >=1400px it now
   reads as a workbench (ledger on the left, automation and context on the right)
   and the numbers animate to their values instead of snapping. */
(function () {
  "use strict";
  if (window.__DLPF) return; window.__DLPF = 1;

  var RM = function () { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

  /* ---- count-up ---------------------------------------------------------- */
  function parseNum(t) { var m = String(t).replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; }
  function fmtLike(sample, v) {
    var dec = (String(sample).split('.')[1] || '').replace(/[^\d]/g, '').length;
    return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  function countTo(el, to, from) {
    if (RM()) { return; }
    var start = performance.now(), dur = 620, sample = el.textContent;
    from = (typeof from === 'number') ? from : 0;
    function step(now) {
      var t = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - t, 3);
      el.textContent = fmtLike(sample, from + (to - from) * e);
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function watchNumber(el) {
    if (!el || el.__dlw) return; el.__dlw = 1;
    var last = parseNum(el.textContent);
    if (last !== null) countTo(el, last, 0);
    new MutationObserver(function () {
      var v = parseNum(el.textContent);
      if (v === null || v === last) return;
      var up = v > last;
      el.classList.remove('dlpf-up', 'dlpf-dn');
      void el.offsetWidth;
      el.classList.add(up ? 'dlpf-up' : 'dlpf-dn');
      last = v;
    }).observe(el, { childList: true, characterData: true, subtree: true });
  }

  /* ---- reveal on scroll -------------------------------------------------- */
  function reveal() {
    if (RM() || !window.IntersectionObserver) return;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('dlpf-in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.04 });
    document.querySelectorAll('#page-portfolio .card').forEach(function (c, i) {
      c.style.setProperty('--dlpf-d', (Math.min(i, 8) * 45) + 'ms');
      c.classList.add('dlpf-rise'); io.observe(c);
    });
  }

  /* ---- staggered table rows --------------------------------------------- */
  function rows() {
    var body = document.getElementById('pf-body');
    if (!body || body.__dlr) return; body.__dlr = 1;
    function paint() {
      if (RM()) return;
      [].forEach.call(body.rows, function (r, i) {
        if (r.__dl) return; r.__dl = 1;
        r.style.setProperty('--dlpf-d', Math.min(i, 14) * 32 + 'ms');
        r.classList.add('dlpf-row');
      });
    }
    paint();
    new MutationObserver(paint).observe(body, { childList: true });
  }


  /* ---- column placement by identity -------------------------------------
     nth-child cannot be trusted here: sign-in banners and toolkits are
     injected at runtime and shift every index. Classify by what a card
     actually contains, so the workbench survives any future insertion. */
  var LEFT  = ['#pf-body', '#anStats', '#equityCv', '#jrnl', '#txnList', '#taxBox', '.tbl-card'];
  var RIGHT = ['#gridList', '#dcaList', '#chainCard', '#coachBox'];
  function place() {
    var sec = document.querySelector('#page-portfolio > .wrap.section');
    if (!sec || innerWidth < 1400) return;
    /* v155-C: once layers/zzz-columns.js has balanced the board into a masonry
       host that owns the full container, the two-track workbench is what left a
       998px dead rail down the right of 87% of the page. The host owns the
       placement from that point on — do not put it back in one track. */
    if (sec.querySelector(':scope > .dlc-host')) return;
    [].forEach.call(sec.children, function (el) {
      var col = '1 / -1';
      if (LEFT.some(function (s) { return el.matches(s) || el.querySelector(s); })) col = '1';
      else if (RIGHT.some(function (s) { return el.matches(s) || el.querySelector(s); })) col = '2';
      else if (/tax center|transaction/i.test((el.innerText || '').slice(0, 60))) col = '1';
      el.style.gridColumn = col;
    });
  }

  function start() {
    watchNumber(document.getElementById('pf-total'));
    document.querySelectorAll('#anStats .k-v, #anStats b, #anStats .v').forEach(watchNumber);
    place(); rows(); reveal();
    addEventListener('resize', function(){clearTimeout(place.__t);place.__t=setTimeout(place,150);}, {passive:true});
    new MutationObserver(function(){clearTimeout(place.__m);place.__m=setTimeout(place,120);}).observe(document.getElementById('page-portfolio')||document.body,{childList:true,subtree:true});
    ['#donut', '#equityCv'].forEach(function (s) {
      var c = document.querySelector(s); if (c && !RM()) c.classList.add('dlpf-draw');
    });
    setTimeout(function () {
      document.querySelectorAll('#anStats .k-v, #anStats b, #anStats .v').forEach(watchNumber);
      rows();
    }, 1800);
  }

  if (document.readyState === 'complete') setTimeout(start, 60);
  else addEventListener('load', function () { setTimeout(start, 60); });
})();
