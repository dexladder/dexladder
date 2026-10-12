// Actual controlled-worker navigation must hash delivered bytes, not a stale URL cache.
'use strict';
const assert = require('assert/strict');
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto');
const { chromium } = require('playwright');
const { mockNetwork } = require('./harness');
const file = path.resolve(process.argv[2] || path.join(__dirname, '../dist/index.html'));
const bytes = fs.readFileSync(file), expected = crypto.createHash('sha256').update(bytes).digest('hex');
const stale = '<!doctype html><title>Previous deployment</title><p>stale URL cache</p>';
const staleHash = crypto.createHash('sha256').update(stale).digest('hex');
(async () => {
  let browser;
  const dir = path.dirname(file);
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://local').pathname;
    const target = pathname === '/' || pathname === '/index.html' ? file : path.join(dir, pathname);
    if (!target.startsWith(dir + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      response.writeHead(404); response.end('missing'); return;
    }
    response.writeHead(200, { 'content-type': target.endsWith('.js') ? 'text/javascript' : target.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(fs.readFileSync(target));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://hashcase.localhost:' + server.address().port;
  try {
    browser = await chromium.launch({ args: ['--host-resolver-rules=MAP hashcase.localhost 127.0.0.1'] });
    const context = await browser.newContext();
    const page = await context.newPage();
    await mockNetwork(page);
    // The fixture matcher treats non-127.0.0.1 hosts as external; let this local origin through.
    await page.route(origin + '/**', route => route.continue());
    await page.goto(origin + '/', { waitUntil: 'load', timeout: 120000 });
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      if (!registration.active) throw Error('worker did not activate');
    });
    async function poison() {
      await page.evaluate(async stale => {
        const names = (await caches.keys()).filter(name => name.endsWith('-shell'));
        if (names.length !== 1) throw Error('expected exactly one active shell cache: ' + names);
        await (await caches.open(names[0])).put(location.origin + '/', new Response(stale, { headers: { 'content-type': 'text/html' } }));
      }, stale);
    }
    await poison();
    const navigation = await page.reload({ waitUntil: 'load', timeout: 120000 });
    assert.equal(crypto.createHash('sha256').update(await navigation.body()).digest('hex'), expected, 'navigation really delivered current artifact');
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'page is actually controlled');
    // Background static refreshes may update '/', so install the deterministic stale entry again.
    await poison();
    const oldHash = await page.evaluate(async () => {
      const bytes = await (await fetch(location.href.split('#')[0], { cache: 'force-cache' })).arrayBuffer();
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    });
    assert.equal(oldHash, staleHash, 'previous URL-fetch strategy demonstrably hashes stale bytes');
    const witness = await page.evaluate(() => new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => { channel.port1.close(); reject(Error('navigation hash witness timed out')); }, 10000);
      channel.port1.onmessage = event => { clearTimeout(timeout); channel.port1.close(); resolve(event.data); };
      navigator.serviceWorker.controller.postMessage({ dl: 'running-build-hash' }, [channel.port2]);
    }));
    assert.equal(witness.sha256, expected, 'worker witnesses exact navigation bytes');
    await page.evaluate(() => { if (window.DLXW) DLXW.dismiss(); DLTRUST.open('about'); });
    await page.waitForFunction(() => document.getElementById('dlBuildHash') && /^[a-f0-9]{64}$/.test(document.getElementById('dlBuildHash').textContent), null, { timeout: 15000 });
    assert.equal(await page.locator('#dlBuildHash').textContent(), expected, 'Trust Center shows current navigation digest despite stale URL cache');
    console.log('running hash: controlled navigation, stale-cache counterexample, worker witness and Trust Center passed');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
