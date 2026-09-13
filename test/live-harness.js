// LIVE harness: serves a build over http and pipes EVERY non-localhost request to the
// REAL upstream through node's fetch (which reaches the network via the container's
// transparently-intercepted egress / HTTPS_PROXY). Nothing is mocked. The browser is
// launched with NO --proxy-server, because Chromium's own proxy stack does not work in
// this container (recorded failure); interception + node-side fetch is the method that
// does. Every request is logged: url, host, method, status, latency, bytes, upstream
// CORS headers, rate-limit headers, error.
//
// Usage: node test/live-harness.js <index.html>
'use strict';
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');

if (!process.env.NODE_EXTRA_CA_CERTS) process.env.NODE_EXTRA_CA_CERTS = '/root/.ccr/ca-bundle.crt';

const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/;
const FETCH_TIMEOUT_MS = 25000;

// Response headers that must not be replayed verbatim: node's fetch has already
// decoded the body, and the framing/security headers belong to the upstream hop.
const DROP_RES = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection',
  'keep-alive', 'set-cookie', 'set-cookie2', 'content-security-policy',
  'content-security-policy-report-only', 'x-frame-options', 'strict-transport-security',
  'alt-svc', 'report-to', 'nel']);
// Request headers the browser sets that belong to the browser hop, not ours.
const DROP_REQ = new Set(['host', 'connection', 'content-length', 'accept-encoding',
  'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-dest', 'sec-ch-ua', 'sec-ch-ua-mobile',
  'sec-ch-ua-platform', 'upgrade-insecure-requests']);

const RATE_HEADERS = ['retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining',
  'x-ratelimit-reset', 'ratelimit-remaining', 'ratelimit-reset', 'x-mbx-used-weight-1m',
  'cf-ray'];

function serve(dir) {
  return new Promise(res => {
    const srv = http.createServer((req, r) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      let f = path.join(dir, p === '/' ? '/index.html' : p);
      if (!fs.existsSync(f)) { r.writeHead(404); return r.end('nf'); }
      const ext = path.extname(f);
      r.writeHead(200, {
        'content-type': ext === '.html' ? 'text/html; charset=utf-8'
          : ext === '.js' ? 'text/javascript'
          : ext === '.webmanifest' ? 'application/manifest+json'
          : 'application/octet-stream'
      });
      fs.createReadStream(f).pipe(r);
    }).listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }));
  });
}

function hostOf(u) { try { return new URL(u).host; } catch (e) { return '?'; } }

// The transparent pipe. Returns the log array it appends to.
async function liveRoute(page, log) {
  await page.route(/^https?:\/\//, async route => {
    const req = route.request();
    const u = req.url();
    if (LOCAL.test(u)) return route.continue();

    const method = req.method();
    const t0 = Date.now();
    const rec = { t: t0, url: u, host: hostOf(u), method, type: req.resourceType(),
      status: 0, ms: 0, bytes: 0, ok: false, err: null, acao: null, ct: null, rate: null };

    // CORS preflight: answer it ourselves. Sending an OPTIONS upstream and replaying it
    // is the honest thing only if the upstream answers; most of these APIs 405 it, which
    // would abort the real request and hide the actual feed behaviour. The preflight is
    // recorded so it is visible in the evidence.
    if (method === 'OPTIONS') {
      rec.status = 204; rec.ms = 0; rec.ok = true; rec.err = 'preflight-answered-locally';
      log.push(rec);
      return route.fulfill({ status: 204, headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers': '*',
        'access-control-max-age': '600'
      }, body: '' });
    }

    const hdr = {};
    for (const [k, v] of Object.entries(req.headers())) {
      if (!DROP_REQ.has(k.toLowerCase())) hdr[k] = v;
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
      const init = { method, headers: hdr, redirect: 'follow', signal: ac.signal };
      const pd = req.postDataBuffer && req.postDataBuffer();
      if (pd && method !== 'GET' && method !== 'HEAD') init.body = pd;
      const res = await fetch(u, init);
      const ab = await res.arrayBuffer();
      const body = Buffer.from(ab);
      clearTimeout(timer);

      rec.status = res.status; rec.ms = Date.now() - t0; rec.bytes = body.length;
      rec.ok = res.status >= 200 && res.status < 400;
      rec.acao = res.headers.get('access-control-allow-origin');
      rec.ct = res.headers.get('content-type');
      const rl = {};
      for (const h of RATE_HEADERS) { const v = res.headers.get(h); if (v != null) rl[h] = v; }
      if (Object.keys(rl).length) rec.rate = rl;
      if (!rec.ok) rec.snip = body.toString('utf8').slice(0, 240);
      log.push(rec);

      const out = {};
      res.headers.forEach((v, k) => { if (!DROP_RES.has(k.toLowerCase())) out[k] = v; });
      // The one thing we add: the browser is on http://127.0.0.1, which is not an origin
      // any of these APIs allowlists. The upstream's OWN acao value is recorded above,
      // so a real CORS refusal is still visible in the evidence even though it is not
      // allowed to break the run.
      out['access-control-allow-origin'] = '*';
      out['access-control-expose-headers'] = '*';
      return route.fulfill({ status: res.status, headers: out, body });
    } catch (e) {
      clearTimeout(timer);
      rec.ms = Date.now() - t0;
      rec.err = String((e && e.message) || e) + (e && e.cause && e.cause.message ? ' / ' + e.cause.message : '');
      rec.status = 0; rec.ok = false;
      log.push(rec);
      // Unreachable stays unreachable. No substitute data, ever.
      return route.abort('failed');
    }
  });
}

async function launch(indexPath, opts) {
  opts = opts || {};
  const dir = path.dirname(path.resolve(indexPath));
  const { srv, port } = await serve(dir);
  const browser = await chromium.launch();          // NO --proxy-server: it does not work here
  const ctx = await browser.newContext({
    viewport: opts.viewport || { width: 1440, height: 900 },
    serviceWorkers: 'allow'                          // payload unregisters its SW on 127.0.0.1
  });
  const page = await ctx.newPage();
  const errors = [], consoleErr = [], consoleAll = [], net = [], failed = [], browserResponses = [];
  page.on('pageerror', e => errors.push({ t: Date.now(), msg: String((e && e.message) || e), stack: String((e && e.stack) || '').slice(0, 600) }));
  page.on('console', m => {
    const r = { t: Date.now(), type: m.type(), text: m.text().slice(0, 500) };
    consoleAll.push(r);
    if (m.type() === 'error') consoleErr.push(r);
  });
  page.on('requestfailed', r => failed.push({ t: Date.now(), url: r.url(), method: r.method(), type: r.resourceType(), err: (r.failure() && r.failure().errorText) || '?' }));
  page.on('response', r => { if (r.status() >= 400) browserResponses.push({ t: Date.now(), url: r.url(), status: r.status() }); });

  await liveRoute(page, net);
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/${path.basename(indexPath)}`, { waitUntil: 'load', timeout: 120000 });
  return {
    browser, page, ctx, port, t0,
    errors, consoleErr, consoleAll, net, failed, browserResponses,
    close: async () => { try { await browser.close(); } catch (e) {} srv.close(); }
  };
}

module.exports = { launch, liveRoute, serve, hostOf };

if (require.main === module) {
  (async () => {
    const file = process.argv[2] || path.join(__dirname, '..', 'dist', 'index.html');
    const h = await launch(file);
    await h.page.waitForTimeout(25000);
    const info = await h.page.evaluate(() => ({
      title: document.title,
      rows: document.querySelectorAll('table.mx-table tbody tr').length,
      build: (document.getElementById('cbBuildTag') || {}).textContent,
      mode: (window.S || {}).mode,
      telem: (window.telem || {}).mode,
      snap: window.DLSNAP && window.DLSNAP.current ? window.DLSNAP.current.id : null,
      mcap: window.DLSNAP ? window.DLSNAP.get('universes.global.marketCap').value : null
    }));
    console.log('info', info);
    const byHost = {};
    h.net.forEach(r => { const k = r.host; (byHost[k] = byHost[k] || []).push(r); });
    Object.entries(byHost).sort((a, b) => b[1].length - a[1].length).forEach(([k, v]) => {
      const st = {}; v.forEach(r => { st[r.err && !r.status ? 'ERR' : r.status] = (st[r.err && !r.status ? 'ERR' : r.status] || 0) + 1; });
      console.log(String(v.length).padStart(4), k.padEnd(34), JSON.stringify(st));
    });
    console.log('pageerrors', h.errors.length, h.errors.slice(0, 5).map(e => e.msg));
    console.log('console errors', h.consoleErr.length);
    await h.close();
    process.exit(0);
  })().catch(e => { console.error(e); process.exit(1); });
}
