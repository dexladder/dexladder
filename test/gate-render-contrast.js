// DexLadder RENDERED-PAGE contrast gate — walks the running app in both display modes.
//
// Why this file exists, next to gate-contrast.js
// ---------------------------------------------
// gate-contrast.js proves every DESIGN TOKEN clears AA on every surface. That is necessary
// and it is not sufficient, because the payload also paints with colours that never entered
// the token system:  `.dl154 .up{color:#3ae58f}`, `.or-b .up{color:#4be38f}`, and ~240 more.
//
// In Night those literals sit on a dark panel and read fine. In Day, layers/zz-day-surfaces.js
// retints dark panels to white at runtime — but it only ever repaired a foreground when the
// SAME rule also declared one, so a rule that sets only a colour was walked straight past. The
// panel went white underneath it and the hard-coded green stayed put, at roughly 1.5–2.0.
//
// Neither existing check could see this:
//   * the token checker never reads a non-token literal;
//   * the retint is a per-rule RUNTIME effect, so no static pass over the payload predicts
//     which literal ends up on which surface.
// Only the running page knows. So this gate drives the real app, switches modes, walks every
// route, and measures the COMPUTED foreground of every element that carries text against the
// backdrop that element actually composites onto.
//
// Discipline carried over from gate-contrast.js:
//   * CANARIES — three planted cases travel the exact same collect -> resolve -> compare path
//     every run: one that must PASS, one that must FAIL, and one on a gradient that must land
//     in the position-dependent ADVISORY band. Anything else aborts the run with exit 99.
//     A gate that cannot see a planted failure is not evidence.
//   * FAIL CLOSED — a backdrop this checker cannot resolve is reported as unmeasurable, never
//     skipped. Silently walking past an unparseable background to a lighter ancestor is how a
//     white-on-white glyph reports 1.05 against the wrong surface and gets "fixed" by mistake.
//   * ADVISORY, NOT ASSERTED — decorative marks are measured and printed, never asserted, the
//     same band gate-contrast.js uses for the soft direction washes. Calling a decorative tint
//     a failure is the same error as a false pass.
//
// The hole this gate had, and what closed it (v155-F)
// --------------------------------------------------
// Until v155-F this file walked the EIGHT top-level routes and nothing else. Every surface
// a visitor reaches by CLICKING — the coin detail page behind a markets row, the trade
// ticket, the order book in either mode, an academy lesson, the proof ledger, the tax
// centre, the quant desk, the command palette, the AI console, a P2P trade room, the
// first-run welcome sheet — was never rendered while this gate was looking, so no colour on
// any of them was ever measured. That is how `--txt-1` shipped with no Day value at all:
// seven statistics, the 24h range, the risk-sizing readout, the pair label and the Ask
// buttons all rendered at 1.09-1.15 on the Day coin page, and a gate reporting 0 failures
// never visited the page they were on.
//
// The walk is now ROUTES + SURFACES. A surface is opened the way a visitor opens it (a real
// click on a real markets row, not a URL), measured, and closed. Each surface names the
// selectors that MUST be visible once it is open; if one is not, the gate has stopped
// covering what it claims to cover and the run ABORTS with exit 98 rather than reporting a
// clean sheet over a surface it never reached. That is the same fail-closed discipline the
// canaries apply to the checker itself, applied to the walk.
//
// Usage:  node gate-render-contrast.js [path/to/index.html]
// Exit code = number of asserted failures (0 = clean), 98 = a surface went unreachable,
//             99 = harness/canary fault.
'use strict';

const path = require('path');
const { launch } = require('./harness');
const G = require('./gate-contrast');

const AA_TEXT = G.AA_TEXT;        // 4.5 — SC 1.4.3 normal text
const AA_LARGE = G.AA_NONTEXT;    // 3.0 — SC 1.4.3 large text (>=24px, or >=18.66px bold)
const GHOST_A = 0.35;             // below this alpha a mark is a deliberate ghost, not text

const ROUTES = ['markets', 'news', 'learn', 'blog', 'portfolio', 'discover', 'explorer', 'p2p', 'community'];

/* ------------------------------------------------------------------ interaction surfaces */
// Every entry is a surface a visitor reaches by acting, not by navigating. `steps` are run in
// the page in order; `must` are selectors that have to be VISIBLE once the surface is open —
// a missing one aborts the whole run, because a surface that did not open is a surface this
// gate is silently not covering. `close` returns the app to a state the next surface can open
// from. Nothing here measures: the same COLLECT that walks a route walks a surface.
const SURFACES = [
  { id: 'coin-detail',
    why: 'reachable only by clicking a real markets row — where --txt-1 shipped with no Day value',
    steps: [
      { js: "window.nav('markets')", wait: 1500 },
      { js: "(function(){var tr=document.querySelector('table.mx-table tbody tr[data-mxrow]');" +
            "if(!tr)throw new Error('no markets row to click');(tr.querySelector('td.c-coin')||tr).click()})()",
        wait: 7000 }
    ],
    must: ['.cmc-stats .cs .v', '.cs-range .rk-head b', '#cv-pairlabel', '#dlCoinAI button.ask', '#dlAskAI'],
    close: [] },

  { id: 'trade-ticket',
    why: 'the buy ticket and its risk-sizing readout, on the coin page, after the sizer has run',
    steps: [
      { js: "(function(){var a=document.getElementById('amt');if(a){a.value='0.05';try{recalc()}catch(e){}}" +
            "try{setOrdType('limit')}catch(e){}" +
            "var b=document.getElementById('dlApply');if(!b)throw new Error('no risk sizer');b.click()})()",
        wait: 2500 },
      { js: "(function(){try{setSide('sell')}catch(e){}})()", wait: 1200 },
      { js: "(function(){try{setSide('buy');setOrdType('market')}catch(e){}})()", wait: 1200 }
    ],
    must: ['#dlRisk .ro b', '#placeBtn', '#s-price', '#amt'],
    close: [] },

  { id: 'order-book-ladder',
    why: 'the order book in Ladder mode — bid/ask rows, spread, depth bars',
    steps: [{ js: "setBookMode('rows')", wait: 2000 }],
    must: ['#bookRows', '#asks', '#bids', '#bmid-px'],
    close: [] },

  { id: 'order-book-depth',
    why: 'the same book in Depth mode — a different subtree paints, and the Ladder one is hidden',
    steps: [{ js: "setBookMode('depth')", wait: 2000 }],
    must: ['#bookDepth', '#bookMode button[data-m="depth"].on'],
    close: [{ js: "setBookMode('rows')", wait: 800 }] },

  { id: 'blog-article',
    why: 'a Blog post — prose, headings, callout, tables, code and the contents panel only exist inside a post',
    steps: [{ js: "DLAPP.legacy.blog.open('advanced-execution-engine')", wait: 1500 }],
    must: ['#dlBlog .dlx-prose h2', '#dlBlog .dlx-prose-tw th', '#dlBlog .dlx-callout', '#dlBlog .dlx-prose pre', '#dlBlog .dlx-art-nl'],
    close: [] },

  { id: 'academy-lesson',
    why: 'the focused lesson view — a whole page that only exists after a chapter is entered',
    steps: [
      { js: "window.nav('learn')", wait: 3500 },
      { js: "enterLesson(0)", wait: 3000 }
    ],
    must: ['#learnFocus', '#chapterStage'],
    close: [{ js: "(function(){try{exitLesson()}catch(e){}})()", wait: 1200 }] },

  { id: 'proof-ledger',
    why: 'the SHA-256 trade ledger on the portfolio board',
    steps: [
      { js: "window.nav('portfolio')", wait: 4500 },
      { js: "(function(){var c=document.getElementById('chainCard');if(c)c.scrollIntoView({block:'center'})})()", wait: 1200 }
    ],
    must: ['#chainCard', '#chainBody'],
    close: [] },

  { id: 'tax-centre',
    why: 'the realised-gains estimate card',
    steps: [{ js: "(function(){var c=document.getElementById('taxBody');if(c)c.scrollIntoView({block:'center'})})()", wait: 1200 }],
    must: ['#taxBody'],
    close: [] },

  { id: 'quant-desk',
    why: 'the 1,200px quant panel — the tallest card on the board and the one the masonry moves',
    steps: [{ js: "(function(){var c=document.getElementById('dlQuant');if(c)c.scrollIntoView({block:'center'})})()", wait: 1200 }],
    must: ['#dlQuant'],
    close: [{ js: "window.scrollTo(0,0)", wait: 400 }] },

  { id: 'holdings-ledger',
    why: 'the seeded holdings table every user has — and the card it has to fit inside',
    steps: [{ js: "(function(){var c=document.getElementById('pf-body');if(c)c.scrollIntoView({block:'center'})})()", wait: 1200 }],
    must: ['#pf-body', '#page-portfolio .tbl-card thead th'],
    close: [{ js: "window.scrollTo(0,0)", wait: 400 }] },

  { id: 'command-palette',
    why: 'the ⌘K overlay — an opaque sheet over every route, never once rendered under this gate',
    steps: [{ js: "openCmdk()", wait: 1500 }],
    must: ['#cmdk.on', '#cmdkList'],
    close: [{ js: "(function(){try{closeCmdk()}catch(e){}})()", wait: 800 }] },

  { id: 'ai-console',
    why: 'the DeXaI console and one answered turn in its transcript',
    steps: [
      { js: "(function(){if(window.NXCHAT&&NXCHAT.open)return NXCHAT.open();" +
            "if(window.ORACLE&&ORACLE.open)return ORACLE.open();throw new Error('no AI console')})()", wait: 2000 },
      { js: "(function(){try{(window.NXCHAT&&NXCHAT.ask?NXCHAT.ask:ORACLE.ask)('What can you do?')}catch(e){}})()", wait: 4500 }
    ],
    must: ['#nxChat'],
    close: [{ js: "(function(){try{(window.NXCHAT&&NXCHAT.close?NXCHAT.close:ORACLE.close)()}catch(e){}})()", wait: 800 }] },

  { id: 'p2p-trade-room',
    why: 'the escrow room behind a bazaar offer — a modal with its own step rail and chat',
    steps: [
      { js: "window.nav('p2p')", wait: 4500 },
      { js: "(function(){if(typeof P2P==='undefined'||!P2P.offers||!P2P.offers.length)throw new Error('no P2P offers');" +
            "openP2PTrade(P2P.offers[0].id)})()", wait: 2500 }
    ],
    must: ['.modal.p2proom', '#p2Steps', '#p2Body'],
    close: [{ js: "(function(){try{p2pClose()}catch(e){try{closeModal()}catch(e2){}}})()", wait: 900 }] },

  { id: 'first-run-welcome',
    why: 'the sheet every new visitor sees before anything else, and only ever once',
    steps: [
      { js: "(function(){try{localStorage.removeItem('coinbridge.welcomed')}catch(e){}" +
            "var o=document.getElementById('dlxw');if(o)o.remove();" +
            "if(!window.DLXW||!DLXW.first)throw new Error('no welcome module');DLXW.first()})()", wait: 1800 }
    ],
    must: ['#dlxw', '#dlxw .dlxw-card', '#dlxw .dlxw-go'],
    close: [{ js: "(function(){try{DLXW.dismiss()}catch(e){}})()", wait: 900 }] }
];

// The page canvas under everything, per mode. Used only when the chain runs out of paint.
const CANVAS = { night: '#0B1220', day: '#FFFFFF' };

/* ---------------------------------------------------------------- decorative allowlist */
// Every entry is a mark that carries no information a reader must be able to make out, with
// the reason it is exempt. These are MEASURED and PRINTED, just not asserted. Keep this list
// short and specific: a selector added here without a reason is a contrast failure in hiding.
const DECORATIVE = [
  { re: /\.p2step\s*>?\s*em$|p2step.*\bem\b/, why: 'giant ghost step numeral behind the P2P flow copy' },
  { re: /dlc-lockmark/, why: 'embossed lock watermark on the locked-chapter plate' }
];
function decorativeReason(sel) {
  for (const d of DECORATIVE) if (d.re.test(sel)) return d.why;
  return null;
}

/* ---------------------------------------------------------------------- in-page collector */
// Returns one record per element that renders its own text. Everything needed to recompute
// the ratio in Node is captured here; no ratio is computed in the page.
const COLLECT = function () {
  function pathOf(el) {
    const parts = [];
    let n = el, hops = 0;
    while (n && n.nodeType === 1 && hops < 4) {
      let s = n.tagName.toLowerCase();
      if (n.id) { parts.unshift('#' + n.id); break; }
      if (typeof n.className === 'string' && n.className.trim()) {
        s += '.' + n.className.trim().split(/\s+/).slice(0, 3).join('.');
      }
      parts.unshift(s); n = n.parentElement; hops++;
    }
    return parts.join('>');
  }
  function ownText(el) {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
    return t.replace(/\s+/g, ' ').trim();
  }
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const txt = ownText(el);
    if (!txt) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (parseFloat(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const chain = [];
    let n = el, guard = 0;
    while (n && guard++ < 48) {
      const s = getComputedStyle(n);
      // background-clip:text paints the GLYPHS, not a backdrop. Treating it as a backdrop
      // reports a gradient headline as light-on-light and invents a failure that is not there.
      const clip = s.webkitBackgroundClip || s.backgroundClip || '';
      chain.push({ bc: s.backgroundColor, bi: s.backgroundImage, clipText: clip === 'text' });
      n = n.parentElement;
    }
    out.push({
      sel: pathOf(el), text: txt.slice(0, 44), color: cs.color,
      fs: parseFloat(cs.fontSize), fw: cs.fontWeight, chain
    });
  }
  return out;
};

// Planted cases, injected into the live DOM so they are collected and judged exactly like
// real content. #6C7B67 on #FFFFFF is 4.49999958 — a hair under the line, so a checker that
// rounds to 2dp before comparing turns it into 4.50 and passes it. That must never happen.
const PLANT = function () {
  const host = document.createElement('div');
  host.id = 'a11yCanaryHost';
  host.style.cssText = 'position:fixed;left:-99999px;top:0;background:#FFFFFF;padding:4px;z-index:-1';
  host.innerHTML =
    '<span id="a11yCanaryPass" style="color:#000000;font:16px sans-serif">canary pass</span>' +
    '<span id="a11yCanaryFail" style="color:#6C7B67;font:16px sans-serif">canary fail</span>' +
    '<span id="a11yCanaryRangeHost" style="display:inline-block;padding:2px;' +
    'background-image:linear-gradient(90deg,#000000,#FFFFFF)">' +
    '<span id="a11yCanaryRange" style="color:#8A8A8A;font:16px sans-serif">canary range</span></span>';
  document.body.appendChild(host);
};

/* ------------------------------------------------------------------- backdrop resolution */

function parse(v) { return G.parseColor(v, () => null); }   // throws on anything unknown

function gradientStops(bi) {
  if (!bi || bi === 'none') return [];
  const out = [];
  const re = /(rgba?\([^)]*\)|color\(srgb[^)]*\)|#[0-9a-fA-F]{3,8}\b)/g;
  let m;
  while ((m = re.exec(bi))) { try { out.push(parse(m[1])); } catch (e) { /* not a stop */ } }
  return out;
}

// Flatten background-COLOUR only, from chain index `from` outward. Fails closed: an
// unparseable background-color aborts the resolution rather than being stepped over.
function flatFrom(chain, from, mode) {
  const overlays = [];
  for (let i = from; i < chain.length; i++) {
    if (chain[i].clipText) continue;              // its paint is the glyphs, not a backdrop
    let col;
    try { col = parse(chain[i].bc); } catch (e) { return null; }
    if (col.a === 0) continue;
    if (col.a === 1) {
      let bg = col;
      for (let k = overlays.length - 1; k >= 0; k--) bg = G.composite(overlays[k], bg);
      return bg;
    }
    overlays.push(col);
  }
  let bg = parse(CANVAS[mode]);
  for (let k = overlays.length - 1; k >= 0; k--) bg = G.composite(overlays[k], bg);
  return bg;
}

// The set of colours the text may actually sit on.
//   flat  -> exactly one; the verdict is definite.
//   range -> a gradient is in play; one candidate per stop. A verdict is only definite when
//            every candidate agrees. Where they disagree the result is position-dependent and
//            is reported as advisory rather than asserted either way.
function backdrop(chain, mode) {
  let gi = -1, stops = [];
  for (let i = 0; i < chain.length; i++) {
    if (chain[i].clipText) continue;              // glyph fill, not a backdrop
    const s = gradientStops(chain[i].bi);
    if (s.length) { gi = i; stops = s; break; }
  }
  if (gi === -1) {
    const bg = flatFrom(chain, 0, mode);
    return bg ? { kind: 'flat', cands: [bg] } : { kind: 'unknown' };
  }
  const under = flatFrom(chain, gi, mode);            // background-color paints under the image
  if (!under) return { kind: 'unknown' };
  const overlays = [];
  for (let i = 0; i < gi; i++) {
    if (chain[i].clipText) continue;
    let col;
    try { col = parse(chain[i].bc); } catch (e) { return { kind: 'unknown' }; }
    if (col.a === 0) continue;
    overlays.push(col);
  }
  const cands = [];
  for (const st of stops) {
    let bg = st.a === 1 ? st : G.composite(st, under);
    for (let k = overlays.length - 1; k >= 0; k--) bg = G.composite(overlays[k], bg);
    cands.push(bg);
  }
  return { kind: 'range', cands };
}

function isLarge(fs, fw) {
  const bold = fw === 'bold' || parseInt(fw, 10) >= 700;
  return fs >= 24 || (bold && fs >= 18.66);
}
const hex = c => '#' + [c.r, c.g, c.b].map(n => n.toString(16).padStart(2, '0').toUpperCase()).join('');

// Judge one collected record. Never throws: an unresolvable case becomes `unmeasurable`,
// which is reported and counted, not quietly dropped.
function judge(rec, mode) {
  const need = isLarge(rec.fs, rec.fw) ? AA_LARGE : AA_TEXT;
  let fg;
  try { fg = parse(rec.color); } catch (e) { return { band: 'unmeasurable', why: 'colour ' + rec.color, need }; }
  if (fg.a === 0) return { band: 'skip', why: 'fully transparent — no text is presented' };

  const dec = decorativeReason(rec.sel);
  const ghost = fg.a < GHOST_A;
  const bd = backdrop(rec.chain, mode);
  if (bd.kind === 'unknown') return { band: 'unmeasurable', why: 'backdrop unresolved', need };

  const ratios = bd.cands.map(bg => G.contrast(G.composite(fg, bg), bg));
  const lo = Math.min.apply(null, ratios), hi = Math.max.apply(null, ratios);
  const on = hex(bd.cands[ratios.indexOf(lo)]);

  if (dec || ghost) {
    return { band: 'decorative', ratio: lo, on, need,
             why: dec || 'alpha ' + fg.a.toFixed(2) + ' — a deliberate ghost, not text' };
  }
  if (bd.kind === 'range' && lo < need && hi >= need) {
    return { band: 'position', ratio: lo, hi, on, need };   // depends where on the gradient it lands
  }
  return { band: hi < need ? 'fail' : 'pass', ratio: lo, on, need };
}

/* ------------------------------------------------------------------------------- driver */

// Is every one of these selectors present AND actually painted? Returns the failures.
// A surface that cannot show its own furniture has not opened, and this gate must not
// pretend to have measured it.
const VISCHECK = function (sels) {
  const bad = [];
  for (const sel of sels) {
    let el = null;
    try { el = document.querySelector(sel); } catch (e) { bad.push(sel + ' (bad selector)'); continue; }
    if (!el) { bad.push(sel + ' (absent)'); continue; }
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0 ||
        r.width < 1 || r.height < 1) bad.push(sel + ' (present but not painted)');
  }
  return bad;
};

async function runSteps(page, steps) {
  for (const st of steps || []) {
    await page.evaluate(st.js);                 // throws out of collectAll — never swallowed
    await page.waitForTimeout(st.wait || 800);
  }
}

async function collectAll(file, log) {
  const h = await launch(file, { viewport: { width: 1440, height: 900 } });
  const page = h.page;
  await page.waitForTimeout(20000);
  // the boot welcome sheet would otherwise sit over every route in the walk; it is measured
  // deliberately, as its own surface, in both modes.
  await page.evaluate("(function(){try{DLXW&&DLXW.dismiss&&DLXW.dismiss()}catch(e){}})()");
  await page.waitForTimeout(900);
  await page.evaluate(PLANT);
  const byMode = {}, unreachable = [], coverage = {};
  for (const mode of ['night', 'day']) {
    await page.evaluate(m => window.DLMODE.set(m === 'night' ? 'dark' : 'day', true), mode);
    await page.waitForTimeout(1200);
    const recs = [];
    for (const rt of ROUTES) {
      try { await page.evaluate(r => window.nav(r), rt); } catch (e) { continue; }
      await page.waitForTimeout(1400);
      for (const r of await page.evaluate(COLLECT)) { r.route = rt; r.surface = 'route:' + rt; recs.push(r); }
    }
    const nRoutes = recs.length;

    for (const sf of SURFACES) {
      let bad;
      try {
        await runSteps(page, sf.steps);
        bad = await page.evaluate(VISCHECK, sf.must);
      } catch (e) {
        bad = ['open failed: ' + (e && e.message || e)];
      }
      if (bad.length) { unreachable.push(mode + ' · ' + sf.id + ' → ' + bad.join('; ')); continue; }
      const before = recs.length;
      for (const r of await page.evaluate(COLLECT)) { r.route = sf.id; r.surface = sf.id; recs.push(r); }
      coverage[mode + '.' + sf.id] = recs.length - before;
      try { await runSteps(page, sf.close); } catch (e) { /* closing is best-effort */ }
    }
    byMode[mode] = recs;
    log('   walked ' + mode + ': ' + nRoutes + ' elements over ' + ROUTES.length + ' routes + ' +
        (recs.length - nRoutes) + ' over ' + SURFACES.length + ' interaction surfaces = ' + recs.length);
  }
  await h.close();
  return { byMode, unreachable, coverage };
}

async function main(argv) {
  const file = argv[2] || path.join(__dirname, '..', 'dist', 'index.html');
  const log = s => console.log(s);
  log('== rendered-page contrast gate · artifact: ' + file);

  const walk = await collectAll(file, log);
  const byMode = walk.byMode;

  // ---- fail closed on coverage: a surface that did not open is not a clean surface ------
  if (walk.unreachable.length) {
    console.error('\n  ✗✗ SURFACE UNREACHABLE — the walk no longer covers what this gate claims:');
    walk.unreachable.forEach(u => console.error('     · ' + u));
    console.error('     Nothing is reported for a surface that was never rendered. Fix the opener');
    console.error('     (or the app) before trusting any number in this run.');
    process.exit(98);
  }

  // ---- control: the three planted cases -------------------------------------------
  const canary = {};
  for (const mode of ['night', 'day']) {
    for (const rec of byMode[mode]) {
      if (!/a11yCanary(Pass|Fail|Range)\b/.test(rec.sel)) continue;
      const which = rec.sel.match(/a11yCanary(Pass|Fail|Range)/)[1].toLowerCase();
      canary[mode + '.' + which] = judge(rec, mode);
    }
  }
  const want = { pass: 'pass', fail: 'fail', range: 'position' };
  let canaryBad = [];
  for (const mode of ['night', 'day']) {
    for (const k of Object.keys(want)) {
      const got = canary[mode + '.' + k];
      const band = got && got.band;
      log('   canary ' + (mode + '.' + k).padEnd(12) + ' -> ' +
        (got ? band + ' @ ' + got.ratio.toFixed(2) : 'NOT COLLECTED'));
      if (band !== want[k]) canaryBad.push(mode + '.' + k + ' expected ' + want[k] + ', got ' + (band || 'nothing'));
    }
  }
  if (canaryBad.length) {
    console.error('\n  ✗✗ CANARY FAULT: ' + canaryBad.join('; '));
    console.error('     The gate is not discriminating. Every result in this run is unverified.');
    process.exit(99);
  }
  log('   canaries OK — a planted pass, a planted 4.49999958 failure, and a planted');
  log('   gradient case that must land in the position-dependent band, all judged correctly');

  // ---- the walk ---------------------------------------------------------------------
  const failures = [];
  let asserted = 0, decorative = 0, position = 0, unmeasurable = 0, skipped = 0;
  const worst = {};

  for (const mode of ['night', 'day']) {
    const groups = {};
    for (const rec of byMode[mode]) {
      if (/a11yCanary/.test(rec.sel)) continue;             // controls are not content
      const v = judge(rec, mode);
      if (v.band === 'skip') { skipped++; continue; }
      if (v.band === 'unmeasurable') { unmeasurable++; continue; }
      if (v.band === 'decorative') { decorative++; continue; }
      if (v.band === 'position') { position++; continue; }
      asserted++;
      if (v.band === 'fail') {
        const key = mode + ' | ' + rec.color + ' on ' + v.on;
        if (!groups[key]) groups[key] = { ratio: v.ratio, need: v.need, n: 0, ex: [] };
        groups[key].n++;
        if (groups[key].ex.length < 2) groups[key].ex.push(rec.sel + ' «' + rec.text.slice(0, 30) + '»');
      }
      const wk = mode;
      if (!worst[wk] || v.ratio < worst[wk].ratio) {
        worst[wk] = { ratio: v.ratio, sel: rec.sel, on: v.on, need: v.need };
      }
    }
    const keys = Object.keys(groups).sort((a, b) => groups[a].ratio - groups[b].ratio);
    log('');
    log('   ' + mode.toUpperCase() + ' — ' + (keys.length ? keys.length + ' distinct failing foreground/backdrop pairs' : 'no failing pairs'));
    for (const k of keys) {
      const g = groups[k];
      log('  ✗ ' + g.ratio.toFixed(2).padStart(6) + ' < ' + g.need.toFixed(1) + '  n=' +
        String(g.n).padStart(3) + '  ' + k.padEnd(46) + ' ' + g.ex[0].slice(0, 62));
      failures.push(k + ' = ' + g.ratio.toFixed(2) + ' < ' + g.need + ' (' + g.n + ' element' +
        (g.n === 1 ? '' : 's') + ', e.g. ' + g.ex[0] + ')');
    }
  }

  log('');
  log('   worst asserted element per mode');
  for (const m of Object.keys(worst)) {
    log('     ' + m.padEnd(6) + ' ' + worst[m].ratio.toFixed(2).padStart(6) + ' (needs ' +
      worst[m].need.toFixed(1) + ')  on ' + worst[m].on + '  ' + worst[m].sel.slice(0, 52));
  }
  log('');
  log('   ' + (asserted - failures.reduce((n, f) => n + 0, 0)) + ' text elements asserted · ' +
    failures.length + ' failing pairs');
  log('   ' + decorative + ' decorative (measured, not asserted) · ' + position +
    ' position-dependent on a gradient · ' + unmeasurable + ' unmeasurable · ' + skipped + ' transparent');

  log('');
  log('   interaction surfaces covered (elements collected per mode)');
  for (const sf of SURFACES) {
    log('     ' + sf.id.padEnd(20) + ' night ' + String(walk.coverage['night.' + sf.id] || 0).padStart(5) +
        '   day ' + String(walk.coverage['day.' + sf.id] || 0).padStart(5) + '   ' + sf.why.slice(0, 62));
  }
  if (failures.length) {
    log('');
    log('   FAILURES');
    failures.forEach(f => log('     · ' + f));
  }
  return failures.length;
}

if (require.main === module) {
  main(process.argv)
    .then(n => process.exit(n))
    .catch(e => { console.error('gate-render-contrast: ' + (e && e.stack || e)); process.exit(99); });
}

module.exports = { judge, backdrop, gradientStops, DECORATIVE, AA_TEXT, AA_LARGE, ROUTES, SURFACES };
