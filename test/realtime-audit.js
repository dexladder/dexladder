// REALTIME AUDIT — the desktop build driven at 1440x900 against the REAL upstreams.
// Nothing is mocked. Every external request is piped to the live host by test/live-harness.js.
//
// Produces /home/claude/out/realtime/:
//   requests.json / requests.csv   every upstream request: url, status, latency, bytes, CORS, rate headers
//   hosts.json                     per-host roll-up
//   honesty.json                   the one-instant sweep of every rendered mcap / vol / dominance figure
//   snapshot.json                  DLSNAP.current, verbatim
//   selfreport.json                what the app says its own feed state is
//   heatmap.json                   #dlHeat state, canvas pixels, tile count
//   console.json                   page errors, console output, failed requests, >=400 responses
//   perf.json                      FCP, DOM nodes, JS heap, transfer, third-party hosts, time-to-table
//   layout.json                    per-view PROBE, same probe as test/layout-metrics.js
//   shots/*.png                    one screenshot per view
//
// Usage: node test/realtime-audit.js [../dist/index.html]
'use strict';
const fs = require('fs'), path = require('path');
const { launch } = require('./live-harness');

const OUT = process.env.RT_OUT || '/home/claude/out/realtime';
const VIEWS = ['markets', 'portfolio', 'p2p', 'community', 'learn', 'explorer', 'discover', 'news'];
// the mocked-run figures this live run is compared against (docH / deadPct)
const MOCKED = { markets: [6852, 4.8], portfolio: [2970, 0], p2p: [4417, 2.9], community: [3359, 0],
  learn: [5411, 2.2], explorer: [2919, 13], discover: [2531, 0], news: [4749, 2.6] };

fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const W = (n, o) => fs.writeFileSync(path.join(OUT, n), typeof o === 'string' ? o : JSON.stringify(o, null, 1));

/* ---------------------------------------------------------------- the probe
   Copied verbatim from test/layout-metrics.js so the live figures are produced by
   exactly the same measurement as the mocked ones they are compared with. */
const PROBE = () => {
  const main = document.querySelector('main.active'); if (!main) return null;
  const mb = main.getBoundingClientRect();
  const L = mb.x + scrollX, W = mb.width, docH = document.documentElement.scrollHeight;
  const vis = e => { const s = getComputedStyle(e); return s.display!=='none' && s.visibility!=='hidden' && +s.opacity!==0; };
  const all = [...main.querySelectorAll('*')].filter(e=>{
    if(!vis(e)) return false; const s=getComputedStyle(e); const r=e.getBoundingClientRect();
    if(r.height<40||r.width<80) return false;
    return (s.backgroundColor && s.backgroundColor!=='rgba(0, 0, 0, 0)') || parseFloat(s.borderTopWidth)>0;
  });
  const boxes = all.filter(e=>!all.some(o=>o!==e&&o.contains(e))).map(e=>{
    const r=e.getBoundingClientRect();
    return { id:e.id||'', cls:(e.className||'').toString().slice(0,44), tag:e.tagName,
      x:Math.round(r.x+scrollX-L), y:Math.round(r.y+scrollY), w:Math.round(r.width), h:Math.round(r.height),
      txt:(e.innerText||'').trim().length };
  });
  const bands=[], cover=[];
  for(let y=0;y<docH;y+=100){ let right=0; const iv=[];
    for(const b of boxes){ if(b.y+b.h>y && b.y<y+100){ right=Math.max(right,b.x+b.w); iv.push([b.x,b.x+b.w]); } }
    if(right<=0) continue;
    bands.push(Math.round(W-right));
    iv.sort((a,b)=>a[0]-b[0]); let tot=0, cx=iv[0][0], cy=iv[0][1];
    for(const [a,b] of iv.slice(1)){ if(a>cy){ tot+=cy-cx; cx=a; cy=b; } else cy=Math.max(cy,b); }
    tot+=cy-cx; cover.push(Math.min(1,tot/W));
  }
  const dead=bands.filter(d=>d>250);
  const bandFill = cover.length ? cover.reduce((a,b)=>a+b,0)/cover.length : 0;
  const sorted=[...boxes].sort((a,b)=>a.y-b.y); const rows=[];
  for(const b of sorted){ const r=rows[rows.length-1];
    if(r && Math.abs(b.y-r.y)<=24) { r.items.push(b); r.sum+=b.w; }
    else rows.push({y:b.y, sum:b.w, items:[b]}); }
  const fills=rows.map(r=>Math.min(1.4,r.sum/W));
  const rowFill = fills.length ? fills.reduce((a,b)=>a+b,0)/fills.length : 0;
  const lowRows = fills.filter(f=>f<0.70).length;
  const area = boxes.reduce((a,b)=>a+b.w*b.h,0);
  const density = area/(W*docH);
  const docAll=[...document.querySelectorAll('body *')].filter(e=>{
    if(!vis(e)) return false; const s=getComputedStyle(e); const r=e.getBoundingClientRect();
    if(r.height<12||r.width<40) return false;
    if(s.position==='fixed') return false;
    return (s.backgroundColor && s.backgroundColor!=='rgba(0, 0, 0, 0)') || parseFloat(s.borderTopWidth)>0;
  });
  const lastBottom = docAll.length?Math.max(...docAll.map(e=>{const r=e.getBoundingClientRect();return r.y+scrollY+r.height;})):0;
  const leaves=[...document.querySelectorAll('body *')].filter(e=>{
    if(!vis(e)||e.children.length||!(e.textContent||'').trim()) return false;
    const p=getComputedStyle(e).position; if(p!=='static'&&p!=='relative') return false;
    if(e.closest('[aria-live],[role="status"],.toast,.modal,.dlv-sheet')) return false;
    const r=e.getBoundingClientRect(); return r.width>=8&&r.height>=6;
  });
  const lastText=leaves.length?Math.max(...leaves.map(e=>{const r=e.getBoundingClientRect();return r.y+scrollY+r.height;})):0;
  const wset=[...new Set(boxes.map(b=>b.w))].sort((a,b)=>a-b);
  const labs=[...main.querySelectorAll('h1,h2,h3,h4,.sec-t,.eyebrow,.slab,.hd,.ttl,.title,[class*="label"],[class*="head"]')]
    .filter(vis).map(e=>(e.innerText||'').trim()).filter(t=>t.length>3&&t.length<48);
  const cnt={}; labs.forEach(t=>{const k=t.toLowerCase(); cnt[k]=(cnt[k]||0)+1;});
  const dups=Object.entries(cnt).filter(([,n])=>n>1).sort((a,b)=>b[1]-a[1]);
  const empty=boxes.filter(b=>b.h>120&&b.w>300&&b.txt<25).map(b=>`${b.id||b.cls} ${b.w}x${b.h}`);
  return { W:Math.round(W), docH, bands:bands.length, deadBands:dead.length,
    deadPct:+(100*dead.length/Math.max(1,bands.length)).toFixed(1),
    deadMax:bands.length?Math.max(...bands):0,
    rowFill:+rowFill.toFixed(3), bandFill:+bandFill.toFixed(3), rows:rows.length, lowRows,
    density:+density.toFixed(3), tailVoid:Math.round(docH-lastBottom), textVoid:Math.round(docH-lastText),
    widths:wset.length, dups:dups.slice(0,8), empty:empty.slice(0,8) };
};

/* --------------------------------------------------- overflow / truncation
   Real data has long names, missing supplies and extreme numbers. This finds text
   that does not fit the box it was given, per view. */
const OVERFLOW = () => {
  const main = document.querySelector('main.active'); if (!main) return null;
  const vis = e => { const s=getComputedStyle(e); return s.display!=='none'&&s.visibility!=='hidden'&&+s.opacity!==0; };
  const out = { clipped: [], ellipsis: [], overflowX: [], longest: [], unavailable: 0, nan: [] };
  const els = [...main.querySelectorAll('*')].filter(vis);
  for (const e of els) {
    const r = e.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
    const s = getComputedStyle(e);
    const t = (e.innerText || '').trim();
    if (!e.children.length && t) {
      // clipped: content wider/taller than the box, with the overflow hidden
      if ((s.overflow === 'hidden' || s.overflowX === 'hidden' || s.textOverflow === 'ellipsis')) {
        if (e.scrollWidth > e.clientWidth + 2) out.ellipsis.push({ cls: (e.className||'').toString().slice(0,40), sw: e.scrollWidth, cw: e.clientWidth, txt: t.slice(0, 60) });
      } else if (e.scrollWidth > e.clientWidth + 2 && s.overflow === 'visible') {
        out.clipped.push({ cls: (e.className||'').toString().slice(0,40), sw: e.scrollWidth, cw: e.clientWidth, txt: t.slice(0, 60) });
      }
      if (t.length > 46 && r.width < 200) out.longest.push({ cls: (e.className||'').toString().slice(0,40), w: Math.round(r.width), txt: t.slice(0, 70) });
      if (/\bNaN\b|Infinity|undefined|\[object/.test(t)) out.nan.push({ cls: (e.className||'').toString().slice(0,40), txt: t.slice(0, 80) });
    }
    if (e.scrollWidth > e.clientWidth + 8 && (s.overflowX === 'auto' || s.overflowX === 'scroll')) {
      out.overflowX.push({ cls: (e.className||'').toString().slice(0,40), sw: e.scrollWidth, cw: e.clientWidth });
    }
  }
  out.unavailable = (main.innerText.match(/Unavailable/g) || []).length;
  out.docWiderThanViewport = document.documentElement.scrollWidth > window.innerWidth + 1;
  ['clipped','ellipsis','overflowX','longest','nan'].forEach(k => { out[k+'N'] = out[k].length; out[k] = out[k].slice(0, 12); });
  return out;
};

/* ------------------------------------------------------------- the sweep
   Every rendered market-cap / 24h-volume / BTC-dominance figure ANYWHERE in the
   document, captured in ONE synchronous pass so every value is from one instant. */
const HONESTY = () => {
  const parse = s => {
    const m = /(-?)\$\s?([\d,]+(?:\.\d+)?)\s*([TBMK])?/i.exec(s);
    if (!m) return null;
    const mult = { T: 1e12, B: 1e9, M: 1e6, K: 1e3 }[(m[3] || '').toUpperCase()] || 1;
    return (m[1] ? -1 : 1) * parseFloat(m[2].replace(/,/g, '')) * mult;
  };
  const pctOf = s => { const m = /(-?\d+(?:\.\d+)?)\s*%/.exec(s); return m ? parseFloat(m[1]) : null; };
  const vis = e => { let n = e; while (n && n.nodeType === 1) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; n = n.parentElement; } return true; };
  const inActiveView = e => { const m = e.closest('main'); return !m || m.classList.contains('active'); };
  const pathOf = e => { const a = []; let n = e; for (let i = 0; n && n.nodeType === 1 && i < 6; i++, n = n.parentElement) a.unshift((n.id ? '#' + n.id : n.tagName.toLowerCase()) + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).slice(0,2).join('.') : '')); return a.join('>'); };

  const hits = [];
  const leaves = [...document.querySelectorAll('body *')].filter(e => !e.children.length && (e.textContent || '').trim());
  for (const e of leaves) {
    const t = (e.textContent || '').trim().replace(/\s+/g, ' ');
    if (t.length > 40) continue;
    const hasMoney = /\$\s?[\d,]/.test(t), hasPct = /\d\s*%/.test(t);
    if (!hasMoney && !hasPct) continue;
    const p1 = e.parentElement, p2 = p1 && p1.parentElement, p3 = p2 && p2.parentElement;
    const ctx = [p1, p2, p3].filter(Boolean).map(n => (n.innerText || n.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200)).join(' ⟂ ');
    hits.push({ txt: t, val: hasMoney ? parse(t) : null, pct: hasPct ? pctOf(t) : null,
      ctx: ctx.slice(0, 320), path: pathOf(e), vis: vis(e), active: inActiveView(e),
      view: (e.closest('main') || {}).id || 'chrome' });
  }

  // the surfaces named in the snapshot module, read by id whether or not their view is active
  const IDS = ['g-mcap','g-vol','g-dom','cbMcap','cbVol','cbDom','cbEth','cbFng','gstatsIn',
               'pg-mcap','pg-vol','pg-btc','pg-eth','feed','feedLbl','cbFeed','globRows'];
  const named = {};
  IDS.forEach(id => { const e = document.getElementById(id); if (e) named[id] = { text: (e.innerText || e.textContent || '').trim().replace(/\s+/g,' ').slice(0, 400), vis: vis(e), html: e.innerHTML.slice(0, 500) }; });
  const mxg = [...document.querySelectorAll('.mx-glob')].map(e => ({ text: (e.innerText||'').trim().replace(/\s+/g,' ').slice(0,400), vis: vis(e) }));
  let dexai = null; try { dexai = window.DLSNAP ? window.DLSNAP.answerGlobal() : null; } catch (e) { dexai = { err: String(e) }; }

  // provenance chips and universe labels currently in the DOM
  const prov = [...document.querySelectorAll('.dl-prov')].map(e => ({
    text: (e.textContent||'').trim(), cls: (e.className||'').toString(), vis: vis(e), near: pathOf(e) }));
  const uni = [...document.querySelectorAll('.gs-u')].map(e => ({ text: (e.textContent||'').trim(), vis: vis(e), near: pathOf(e) }));
  const sim = [...document.querySelectorAll('.dl-sim')].map(e => (e.textContent||'').trim());

  return { at: Date.now(), hits, named, mxGlobal: mxg, dexai, prov, uni, sim };
};

const SELFREPORT = () => {
  const g = n => { try { return eval(n); } catch (e) { return undefined; } };
  const out = {};
  try { out.telem = (typeof telem !== 'undefined') ? { mode: telem.mode, lat: telem.lat, ticks: telem.ticks, at: telem.at } : null; } catch (e) { out.telem = 'err:' + e.message; }
  try { out.S_mode = (typeof S !== 'undefined') ? S.mode : null; } catch (e) { out.S_mode = 'err'; }
  try { out.coins = (typeof coins !== 'undefined' && coins) ? coins.length : null; } catch (e) { out.coins = null; }
  try { out.synthetic = (typeof coins !== 'undefined' && coins) ? coins.filter(c => c && c.synthetic).length : null; } catch (e) {}
  try { out.mxCoins = (window.MXP && MXP.state && MXP.state.coins) ? MXP.state.coins.length : null; } catch (e) {}
  const t = id => { const e = document.getElementById(id); return e ? { text: (e.innerText||e.textContent||'').trim().replace(/\s+/g,' '), cls: (e.className||'').toString() } : null; };
  out.feed = t('feed'); out.feedLbl = t('feedLbl'); out.cbFeed = t('cbFeed'); out.cbBuildTag = t('cbBuildTag');
  out.bodyMentionsCached = /\bCACHED\b/.test(document.body.innerText);
  out.bodyMentionsSim = /simulated prices/i.test(document.body.innerText);
  out.rows = document.querySelectorAll('table.mx-table tbody tr').length;
  return out;
};

const HEATMAP = () => {
  const h = document.getElementById('dlHeat');
  if (!h) return { present: false };
  const cv = document.getElementById('dlHeatCv');
  const r = h.getBoundingClientRect();
  const out = { present: true, dataHeat: h.getAttribute('data-heat'),
    box: { w: Math.round(r.width), h: Math.round(r.height) },
    note: (h.querySelector('.hx') ? (h.querySelector('.hx').innerText || '').trim() : null),
    noteVisible: !!(h.querySelector('.hx') && getComputedStyle(h.querySelector('.hx')).display !== 'none'),
    text: (h.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 300) };
  if (cv) {
    const cr = cv.getBoundingClientRect();
    out.canvas = { w: cv.width, h: cv.height, cssW: Math.round(cr.width), cssH: Math.round(cr.height),
      display: getComputedStyle(cv).display, cells: (cv.__lensCells || []).length };
    try {
      const ctx = cv.getContext('2d');
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let nonBlank = 0, colours = new Set();
      for (let i = 0; i < d.length; i += 4 * 37) {
        if (d[i + 3] > 8) { nonBlank++; colours.add(d[i] + ',' + d[i+1] + ',' + d[i+2]); }
      }
      out.canvas.sampled = Math.ceil(d.length / (4 * 37));
      out.canvas.painted = nonBlank;
      out.canvas.paintedPct = +(100 * nonBlank / Math.max(1, Math.ceil(d.length / (4 * 37)))).toFixed(1);
      out.canvas.distinctColours = colours.size;
    } catch (e) { out.canvas.err = String(e.message); }
  }
  try { out.lensMode = window.DLLEDG && DLLEDG.lensMode ? DLLEDG.lensMode() : null; } catch (e) {}
  return out;
};

const PERF = () => {
  const paints = performance.getEntriesByType('paint').map(p => ({ name: p.name, t: Math.round(p.startTime) }));
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const res = performance.getEntriesByType('resource');
  return {
    paints,
    domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
    loadEvent: Math.round(nav.loadEventEnd || 0),
    domNodes: document.getElementsByTagName('*').length,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    heapTotalMB: performance.memory ? +(performance.memory.totalJSHeapSize / 1048576).toFixed(1) : null,
    resources: res.length,
    resourceTransferBytes: res.reduce((a, r) => a + (r.transferSize || 0), 0),
    resourceDecodedBytes: res.reduce((a, r) => a + (r.decodedBodySize || 0), 0),
    listeners: null
  };
};

(async () => {
  const file = process.argv[2] || path.join(__dirname, '..', 'dist', 'index.html');
  const started = Date.now();
  const log = [];
  const step = (s) => { const l = `[${String(((Date.now()-started)/1000).toFixed(1)).padStart(6)}s] ${s}`; console.log(l); log.push(l); };

  step('launching live harness (no mocks, real upstreams)');
  const h = await launch(file, { viewport: { width: 1440, height: 900 } });
  const { page } = h;
  await page.setViewportSize({ width: 1440, height: 900 });

  // time-to-usable markets table, polled
  let tableAt = null, tableRows = 0;
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    const n = await page.evaluate(() => document.querySelectorAll('table.mx-table tbody tr').length).catch(() => 0);
    if (n > 0) { tableAt = Date.now() - h.t0; tableRows = n; break; }
    await page.waitForTimeout(250);
  }
  step(`markets table: ${tableRows} rows at ${tableAt == null ? 'NEVER (40s)' : tableAt + 'ms'}`);

  step('settling 22s on first load');
  await page.waitForTimeout(22000);

  const perf = await page.evaluate(PERF);
  perf.timeToMarketsTableMs = tableAt; perf.marketsTableRows = tableRows;
  step(`FCP ${(perf.paints.find(p=>p.name==='first-contentful-paint')||{}).t}ms · DOM ${perf.domNodes} · heap ${perf.heapMB}MB`);

  await page.screenshot({ path: path.join(OUT, 'shots', '00-markets-first.png') });

  // ---- layout + overflow pass over the eight views
  const layout = {}, overflow = {};
  for (const v of VIEWS) {
    await page.evaluate(x => nav(x), v).catch(() => {});
    await page.waitForTimeout(4500);
    await page.evaluate(() => window.scrollTo(0, 0));
    layout[v] = await page.evaluate(PROBE);
    overflow[v] = await page.evaluate(OVERFLOW);
    await page.screenshot({ path: path.join(OUT, 'shots', `${v}.png`) });
    const r = layout[v] || {};
    step(`${v.padEnd(10)} docH ${String(r.docH).padStart(5)}  dead ${String(r.deadPct).padStart(5)}%  fill ${(r.bandFill||0).toFixed(2)}  tail ${r.tailVoid}/${r.textVoid}  empty ${(r.empty||[]).length}  unavail ${overflow[v]?overflow[v].unavailable:'?'}`);
  }

  // ---- back to markets, settle, then the one-instant honesty sweep
  step('back to markets for the honesty sweep');
  await page.evaluate(() => nav('markets')).catch(() => {});
  await page.waitForTimeout(8000);
  await page.evaluate(() => { try { if (window.DLSNAP) DLSNAP.cycle(true); } catch (e) {} });
  await page.waitForTimeout(6000);

  const honesty = await page.evaluate(HONESTY);
  const snapshot = await page.evaluate(() => { try { return window.DLSNAP && window.DLSNAP.current ? JSON.parse(JSON.stringify(window.DLSNAP.current)) : null; } catch (e) { return { err: String(e) }; } });
  const selfreport = await page.evaluate(SELFREPORT);
  const heat = await page.evaluate(HEATMAP);
  step(`snapshot ${snapshot ? snapshot.id : 'NONE'} · self-report feed "${selfreport.feedLbl ? selfreport.feedLbl.text : '?'}" / telem ${selfreport.telem ? selfreport.telem.mode : '?'}`);
  step(`heatmap data-heat="${heat.dataHeat}" canvas ${heat.canvas ? heat.canvas.paintedPct + '% painted, ' + heat.canvas.distinctColours + ' colours' : 'none'}`);
  await page.screenshot({ path: path.join(OUT, 'shots', '99-markets-final.png'), fullPage: false });

  // heatmap lens sweep: does another lens fill when the default does not
  const lenses = [];
  for (const l of ['top', 'rung', 'rsi']) {
    await page.evaluate(x => { const b = document.querySelector(`[data-lens="${x}"]`); if (b) b.click(); }, l).catch(() => {});
    await page.waitForTimeout(2500);
    lenses.push(Object.assign({ lens: l }, await page.evaluate(HEATMAP)));
  }
  heat.lenses = lenses;
  step('heatmap lenses: ' + lenses.map(x => `${x.lens}=${x.dataHeat}/${x.canvas ? x.canvas.paintedPct + '%' : '-'}`).join(' '));

  // ---- second honesty sample, one full cycle later, to see whether the surfaces
  //      move together (one snapshot) or independently (they do not agree)
  await page.waitForTimeout(65000);
  const honesty2 = await page.evaluate(HONESTY);
  const snapshot2 = await page.evaluate(() => { try { return window.DLSNAP && window.DLSNAP.current ? JSON.parse(JSON.stringify(window.DLSNAP.current)) : null; } catch (e) { return null; } });
  step(`second sample: snapshot ${snapshot2 ? snapshot2.id : 'NONE'}`);

  // ---------------------------------------------------------------- evidence
  const net = h.net;
  const hosts = {};
  for (const r of net) {
    const k = r.host;
    const o = hosts[k] = hosts[k] || { host: k, n: 0, ok: 0, bytes: 0, msTotal: 0, msMax: 0, status: {}, cors: {}, rate: null, errs: [] };
    o.n++; if (r.ok) o.ok++;
    o.bytes += r.bytes; o.msTotal += r.ms; o.msMax = Math.max(o.msMax, r.ms);
    const key = r.status || ('ERR');
    o.status[key] = (o.status[key] || 0) + 1;
    o.cors[String(r.acao)] = (o.cors[String(r.acao)] || 0) + 1;
    if (r.rate) o.rate = r.rate;
    if (r.err && o.errs.length < 3) o.errs.push(r.err);
  }
  Object.values(hosts).forEach(o => { o.msAvg = Math.round(o.msTotal / o.n); delete o.msTotal; });
  const hostList = Object.values(hosts).sort((a, b) => b.n - a.n);

  perf.thirdPartyHosts = hostList.length;
  perf.upstreamRequests = net.length;
  perf.upstreamBytes = net.reduce((a, r) => a + r.bytes, 0);
  perf.upstreamFailures = net.filter(r => !r.ok).length;

  W('requests.json', net);
  W('requests.csv', 'ts,host,method,type,status,ms,bytes,acao,err,url\n' + net.map(r =>
    [new Date(r.t).toISOString(), r.host, r.method, r.type, r.status, r.ms, r.bytes,
     JSON.stringify(r.acao || ''), JSON.stringify((r.err || '').slice(0, 80)), JSON.stringify(r.url)].join(',')).join('\n'));
  W('hosts.json', hostList);
  W('honesty.json', { sample1: honesty, sample2: honesty2 });
  W('snapshot.json', { sample1: snapshot, sample2: snapshot2 });
  W('selfreport.json', selfreport);
  W('heatmap.json', heat);
  W('perf.json', perf);
  W('layout.json', { live: layout, mocked: MOCKED, overflow });
  W('console.json', { pageErrors: h.errors, consoleErrors: h.consoleErr, consoleAll: h.consoleAll.slice(0, 800),
    requestFailed: h.failed, responses4xx5xx: h.browserResponses });
  W('run.log', log.join('\n') + '\n');

  step(`upstream requests ${net.length} across ${hostList.length} hosts · ${(perf.upstreamBytes/1048576).toFixed(2)}MB · ${perf.upstreamFailures} failures`);
  step(`page errors ${h.errors.length} · console errors ${h.consoleErr.length} · requestfailed ${h.failed.length}`);
  W('run.log', log.join('\n') + '\n');

  await h.close();
  process.exit(0);
})().catch(e => { console.error('AUDIT FAILED', e); process.exit(1); });
