// DexLadder v166 runtime desk gate — the ten new desks, opened in a real browser.
//
//   node test/gate-v166-desks.js [dist/index.html]      exit code = number of failures
//
// Every other v166 gate reads the payload as text or exercises the arithmetic in a sandbox.
// This one is the missing half: it boots the shipped payload in Chromium, opens each new desk
// through its own public open(), walks every tab, and asserts what a user would notice —
// the sheet mounts, the body is NOT empty (the v165 Execution bug), the tab paints, nothing
// throws, no NaN or undefined reaches the screen, and nothing overflows a 360px phone.
'use strict';
const path = require('path');
const { launch } = require('./harness.js');
const file = process.argv[2] || path.join(__dirname, '..', 'dist', 'index.html');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d !== undefined ? '  ' + JSON.stringify(d).slice(0, 600) : '')); } };

const DESKS = [
  ['DLLEND',   'dlLend',   'Lending'],
  ['DLOPT',    'dlOpt',    'Options'],
  ['DLCHAIN',  'dlChain',  'Cross-chain'],
  ['DLORD',    'dlOrd',    'Order Lab'],
  ['DLRISK',   'dlRisk',   'Risk'],
  ['DLPATH',   'dlPath',   'Path'],
  ['DLREPLAY', 'dlReplay', 'Replay'],
  ['DLCARRY',  'dlCarry',  'Carry'],
  ['DLACCESS', 'dlAccess', 'Access'],
  ['DLVERIFY', 'dlVerify', 'Verify'],
  ['DLSOR',    'dlSor',    'Execution']
];

(async () => {
  const hh = await launch(file, { viewport: { width: 1280, height: 900 } });
  const { page, errors } = hh;
  await page.waitForTimeout(3500);

  const present = await page.evaluate(ks => ks.map(k => ({ k: k, has: typeof window[k] === 'object' && window[k] !== null, v: window[k] && window[k].__v, open: !!(window[k] && typeof window[k].open === 'function') })), DESKS.map(d => d[0]));
  ok('every v166 layer is live on the page with __v 166 and a public open()',
    present.every(p => p.has && p.open) && present.filter(p => p.k !== 'DLSOR').every(p => p.v === 166), present);

  const rail = await page.evaluate(() => { try { return (window.DLDESKS && window.DLDESKS.__v) ? document.querySelectorAll('#dlDesksRail [data-desk]').length : -1; } catch (e) { return -2; } });
  ok('the desks rail took the new registrations (>= 11 chips)', rail >= 11, { chips: rail });

  for (const [glob, id, label] of DESKS) {
    const r = await page.evaluate(async ([g, sid]) => {
      const out = { threw: [], tabs: [], sheet: false };
      const M = window[g];
      if (!M || typeof M.open !== 'function') { out.threw.push('no open()'); return out; }
      try { M.open(); } catch (e) { out.threw.push('open: ' + (e && e.message || e)); return out; }
      const el = document.getElementById(sid);
      out.sheet = !!el && el.classList.contains('on');
      if (!el) return out;
      const tabs = [].slice.call(el.querySelectorAll('.dls-tabs button[data-t]')).map(b => b.getAttribute('data-t'));
      out.tabList = tabs;
      const body = el.querySelector('.dls-body');
      for (const t of (tabs.length ? tabs : [''])) {
        try {
          if (t) { el.dataset.tab = t; el.__o && el.__o.onTab && el.__o.onTab(t, body, el); }
          await new Promise(r2 => setTimeout(r2, 90));
          const html = body ? body.innerHTML : '';
          const txt = body ? (body.textContent || '') : '';
          out.tabs.push({
            t: t, chars: html.length, text: txt.replace(/\s+/g, ' ').trim().length,
            nan: /\bNaN\b/.test(txt), undef: /\bundefined\b/.test(txt),
            objobj: txt.indexOf('[object Object]') >= 0
          });
        } catch (e) { out.threw.push(t + ': ' + (e && e.message || e)); }
      }
      try { window.DLCORE && window.DLCORE.close && window.DLCORE.close(sid); } catch (e) {}
      return out;
    }, [glob, id]);

    ok(label + ' · the sheet mounts and opens', r.sheet === true, r);
    ok(label + ' · every tab paints a non-empty body (the v165 Execution bug)',
      r.tabs.length > 0 && r.tabs.every(t => t.chars > 80 && t.text > 40), { tabs: r.tabs, tabList: r.tabList });
    ok(label + ' · nothing threw while opening or switching tabs', r.threw.length === 0, r.threw);
    ok(label + ' · no NaN, undefined or [object Object] reaches the screen',
      r.tabs.every(t => !t.nan && !t.undef && !t.objobj),
      r.tabs.filter(t => t.nan || t.undef || t.objobj));
  }

  // phone width: open every desk again at 360 and measure horizontal overflow
  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(400);
  const over = await page.evaluate(async ks => {
    const bad = [];
    for (const [g, sid] of ks) {
      const M = window[g]; if (!M || !M.open) continue;
      try { M.open(); } catch (e) { continue; }
      const el = document.getElementById(sid); if (!el) continue;
      const tabs = [].slice.call(el.querySelectorAll('.dls-tabs button[data-t]')).map(b => b.getAttribute('data-t'));
      const body = el.querySelector('.dls-body');
      for (const t of (tabs.length ? tabs : [''])) {
        if (t) { el.dataset.tab = t; try { el.__o && el.__o.onTab && el.__o.onTab(t, body, el); } catch (e) {} }
        await new Promise(r => setTimeout(r, 60));
        if (document.documentElement.scrollWidth > 361) bad.push(sid + '/' + t + ' doc ' + document.documentElement.scrollWidth);
        else if (body && body.scrollWidth > body.clientWidth + 2) bad.push(sid + '/' + t + ' body ' + body.scrollWidth + '>' + body.clientWidth);
      }
      try { window.DLCORE.close(sid); } catch (e) {}
    }
    return bad;
  }, DESKS.map(d => [d[0], d[1]]));
  ok('no desk overflows a 360px phone on any tab', over.length === 0, over.slice(0, 8));

  ok('the page raised no uncaught error across the whole tour', errors.length === 0, errors.slice(0, 5));
  await hh.close();
  console.log('\n' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail);
})().catch(e => { console.error(e); process.exit(99); });
