// Service-worker scenarios — the offline/caching half of the gate.
//
// These cannot run on the main gate's harness: the payload's stale-shell defence deliberately
// refuses to register a worker on localhost / 127.0.0.1 (and purges any it finds), which is the
// origin harness.js serves from. So this module serves the same dist/ over `dexladder.localhost`
// — a *.localhost name, which Chromium treats as a secure context (so the worker is allowed)
// but which the payload's dev-origin regex /^(localhost|127\.0\.0\.1|papertrade\.app)$/ does not
// match, so the production registration path runs exactly as it does on the live site.
//
// The server is scriptable: it can change the build stamp mid-session (a deploy), return a 500
// for the shell, and flip a static asset between broken and good — which is what lets each
// scenario be watched failing against the worker that shipped before this one.
//
// Usage:  node test/swscenarios.js [dist/]      — runs standalone and prints pass/fail
//         require('./swscenarios').run(dir)     — returns [{name, ok, detail}] for gate154
'use strict';
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { chromium } = require('playwright');

const HOST = 'dexladder.localhost';
const BROKEN = 'BROKEN-500-BODY';
const GOOD = 'GOOD-200-BODY';

function serve(dir, state) {
  const index = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');
  const manifest = fs.existsSync(path.join(dir, 'manifest.webmanifest'))
    ? fs.readFileSync(path.join(dir, 'manifest.webmanifest'), 'utf8') : '{}';
  const shell = (stamp) => index.replace(/<meta name="cb:build" content="[^"]*">/,
    '<meta name="cb:build" content="' + stamp + '">');
  const cache = new Map();

  const srv = http.createServer((req, res) => {
    const p = req.url.split('?')[0];
    state.hits.push(p);
    if (p === '/sw.js') {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
      // state.swBump simulates a deploy of a new worker: different bytes, so the browser
      // installs it and the update path runs for real.
      return res.end(state.swBump ? sw + '\n/* redeployed rev ' + state.swBump + ' */\n' : sw);
    }
    // A static asset the page can ask for, flipped between broken and good by the scenario.
    if (p === '/probe.js') {
      if (state.probeBroken) { res.writeHead(500, { 'content-type': 'text/javascript' }); return res.end(BROKEN); }
      res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(GOOD);
    }
    if (p === '/manifest.webmanifest') { res.writeHead(200, { 'content-type': 'application/manifest+json' }); return res.end(manifest); }
    if (p === '/icon.svg') { res.writeHead(200, { 'content-type': 'image/svg+xml' }); return res.end('<svg xmlns="http://www.w3.org/2000/svg"/>'); }
    if (p === '/icon-512.png' || p === '/icon-maskable.svg') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end('x'); }
    if (p === '/' || p === '/index.html') {
      if (state.shell500) { res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><title>500</title>' + BROKEN); }
      if (!cache.has(state.stamp)) cache.set(state.stamp, shell(state.stamp));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      return res.end(cache.get(state.stamp));
    }
    res.writeHead(404); res.end('nf');
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

async function open(dir, state) {
  const { srv, port } = await serve(dir, state);
  const origin = `http://${HOST}:${port}`;
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'dlsw-'));
  const ctx = await chromium.launchPersistentContext(udd, {
    viewport: { width: 1280, height: 900 },
    args: ['--no-proxy-server', '--host-resolver-rules=MAP ' + HOST + ' 127.0.0.1'],
  });
  // Nothing external is needed by these scenarios and every external host is dead in CI.
  await ctx.route(/^https?:\/\/(?!dexladder\.localhost)/, (r) => r.abort());
  // Counts documents in this tab. A reload the visitor did not ask for shows up here as an
  // extra document — this is how "the page reloaded under the user" is measured, rather than
  // by a timing guess.
  await ctx.addInitScript(() => {
    try { sessionStorage.setItem('dl.loads', String(+(sessionStorage.getItem('dl.loads') || 0) + 1)); } catch (e) {}
  });
  const page = await ctx.newPage();
  return {
    page, origin, ctx,
    close: async () => { await ctx.close(); srv.close(); try { fs.rmSync(udd, { recursive: true, force: true }); } catch (e) {} },
  };
}

// Wait until a worker is installed AND controlling this page, with the shell in a cache.
async function warm(page, origin) {
  await page.goto(origin + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 }).catch(() => {});
  return page.evaluate(async () => {
    const keys = await caches.keys();
    let urls = [];
    for (const k of keys) urls = urls.concat((await (await caches.open(k)).keys()).map((r) => r.url));
    return { controller: !!navigator.serviceWorker.controller, keys, cachedShell: urls.some((u) => /index\.html$/.test(u)) };
  });
}

const stampOf = (page) => page.evaluate(() => {
  const m = document.querySelector('meta[name="cb:build"]');
  return m ? m.content : '(no stamp)';
});

async function run(dir) {
  dir = path.resolve(dir || 'dist');
  const out = [];
  const add = (name, ok, detail) => out.push({ name, ok: !!ok, detail });

  // ---------------------------------------------------------------- scenario 1: a deploy is seen
  // Install the worker, warm the cache, change the build stamp on the server (a deploy), reload.
  // The reloaded page must be the NEW build. Against the cache-first worker this returns the old
  // stamp forever — that is the "ten builds behind" defect, reproduced.
  {
    const state = { stamp: 'v154', hits: [], probeBroken: false, shell500: false, swBump: 0 };
    const h = await open(dir, state);
    try {
      const w = await warm(h.page, h.origin);
      add('sw scenario 1 · the worker installs and caches the shell', w.controller && w.cachedShell, JSON.stringify(w));
      const before = await stampOf(h.page);
      state.stamp = 'v999';                                   // deploy
      await h.page.reload({ waitUntil: 'domcontentloaded' });
      const after = await stampOf(h.page);
      add('sw scenario 1 · a warm-cache visitor gets the NEW build after a deploy',
        before === 'v154' && after === 'v999', `before=${before} after=${after}`);
      // and the freshly served build is what the cache now holds, so the next offline load is new too
      const recached = await h.page.evaluate(async () => {
        for (const k of await caches.keys()) {
          const r = await (await caches.open(k)).match('./index.html');
          if (r) return (await r.text()).indexOf('content="v999"') > -1;
        }
        return null;
      });
      add('sw scenario 1 · the cached shell is refreshed by the successful navigation', recached === true, String(recached));
    } finally { await h.close(); }
  }

  // ---------------------------------------------------------------- scenario 2: offline still boots
  // The offline promise. Warm the cache, cut the network entirely, reload: the app must still come up.
  {
    const state = { stamp: 'v154', hits: [], probeBroken: false, shell500: false, swBump: 0 };
    const h = await open(dir, state);
    try {
      await warm(h.page, h.origin);
      await h.ctx.setOffline(true);
      let navErr = '';
      await h.page.reload({ waitUntil: 'domcontentloaded' }).catch((e) => { navErr = String(e.message || e).slice(0, 120); });
      const boot = await h.page.evaluate(() => ({
        stamp: (document.querySelector('meta[name="cb:build"]') || {}).content || '',
        title: document.title,
        body: document.body ? document.body.innerHTML.length : 0,
      })).catch((e) => ({ err: String(e) }));
      add('sw scenario 2 · with the network cut, a warm cache still boots the app',
        boot.stamp === 'v154' && /DexLadder/.test(boot.title || '') && boot.body > 10000,
        JSON.stringify(boot) + ' ' + navErr);
      await h.ctx.setOffline(false);
    } finally { await h.close(); }
  }

  // ---------------------------------------------------------------- scenario 3: bad bodies never cached
  // 3a (the literal requirement): serve a 500 for the shell. It must not be shown and must not
  //    replace the good cached shell.
  // 3b (where the missing res.ok check actually bites): a same-origin asset returns 500. The old
  //    worker cached that body and kept serving it after the server was fixed.
  {
    const state = { stamp: 'v154', hits: [], probeBroken: true, shell500: false };
    const h = await open(dir, state);
    try {
      await warm(h.page, h.origin);

      // 3b — broken asset first, then a fixed server.
      const first = await h.page.evaluate(() => fetch('probe.js').then((r) => r.status).catch(() => 'ERR'));
      state.probeBroken = false;
      const second = await h.page.evaluate(() => fetch('probe.js').then((r) => r.text()).catch((e) => 'ERR ' + e));
      add('sw scenario 3 · a 500 body is never cached, so the fixed asset is served next time',
        String(second).indexOf(GOOD) > -1 && String(second).indexOf(BROKEN) === -1, `first=${first} second=${String(second).slice(0, 40)}`);
      const poisoned = await h.page.evaluate(async (bad) => {
        for (const k of await caches.keys()) {
          for (const req of await (await caches.open(k)).keys()) {
            const r = await (await caches.open(k)).match(req);
            if (r && !r.ok) return 'non-ok entry cached: ' + req.url + ' ' + r.status;
            if (r && /probe\.js/.test(req.url) && (await r.clone().text()).indexOf(bad) > -1) return 'broken body cached: ' + req.url;
          }
        }
        return '';
      }, BROKEN);
      add('sw scenario 3 · no cache holds a non-ok response', poisoned === '', poisoned);

      // 3a — the shell itself 500s.
      state.shell500 = true;
      await h.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      const served = await stampOf(h.page).catch(() => '(error page)');
      const shellOk = await h.page.evaluate(async (bad) => {
        for (const k of await caches.keys()) {
          const r = await (await caches.open(k)).match('./index.html');
          if (r) { const t = await r.text(); return t.indexOf(bad) === -1 && t.indexOf('content="v154"') > -1; }
        }
        return null;
      }, BROKEN).catch(() => null);
      add('sw scenario 3 · a 500 for the shell neither replaces the cached shell nor reaches the user',
        served === 'v154' && shellOk === true, `served=${served} cachedShellIntact=${shellOk}`);
      state.shell500 = false;
    } finally { await h.close(); }
  }

  // ---------------------------------------------------------------- scenario 4: update behaviour
  // The worker must NOT take over a live session by itself, and the page must say so when a new
  // build is waiting. (The old build reloaded the page on every controllerchange, unprompted.)
  {
    const state = { stamp: 'v154', hits: [], probeBroken: false, shell500: false, swBump: 0 };
    const h = await open(dir, state);
    try {
      await warm(h.page, h.origin);
      const meta = await h.page.evaluate(() => new Promise((res) => {
        const c = new MessageChannel();
        c.port1.onmessage = (e) => res(e.data);
        navigator.serviceWorker.controller.postMessage({ dl: 'sw-version' }, [c.port2]);
        setTimeout(() => res(null), 3000);
      }));
      // v155-G defect 6: this read 'v154' as a literal, so it went red the moment the
      // release moved and green again only when someone retyped it here. The build is an
      // artifact fact — read it from the worker file under test.
      const SWB = (require('fs').readFileSync(require('path').join(dir, 'sw.js'), 'utf8')
        .match(/const SW_BUILD\s*=\s*'([^']+)'/) || [])[1];
      add('sw scenario 4 · the worker reports a version that carries the build and the payload hash',
        !!SWB && !!meta && new RegExp('^dl-' + SWB + '-r\\d+-[0-9a-f]{12}$').test(meta.v) && meta.build === SWB,
        JSON.stringify({ meta, SWB }));
      add('sw scenario 4 · the worker publishes an explicit TTL and cache bound',
        !!meta && meta.ttl > 0 && meta.max > 0, JSON.stringify(meta && { ttl: meta.ttl, max: meta.max }));
    } finally { await h.close(); }
  }

  // ---------------------------------------------------------------- scenario 5: no silent swap
  // The law: the worker is versioned and NEVER auto-swaps silently. Deploy a new worker while a
  // session is live. It must sit in `waiting`, the tab must NOT reload under the user, and the
  // page must say out loud that a newer build is ready. Then the user's click — and only the
  // user's click — performs the swap.
  {
    const state = { stamp: 'v154', hits: [], probeBroken: false, shell500: false, swBump: 0 };
    const h = await open(dir, state);
    try {
      await warm(h.page, h.origin);
      // The old payload reloaded on EVERY controllerchange — including the very first claim(),
      // so a visitor's first visit silently reloaded the whole 2.6MB app under them. One
      // document is the only honest answer here.
      await h.page.waitForTimeout(2500);
      const loads = await h.page.evaluate(() => sessionStorage.getItem('dl.loads'));
      add('sw scenario 5 · a first visit is never reloaded under the visitor by the worker taking control',
        loads === '1', 'documents in this tab: ' + loads);

      await h.page.evaluate(() => { window.__dlAlive = 'session-marker'; });
      state.swBump = 2;                                        // a new worker is deployed
      const upd = await h.page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        await reg.update();
        await new Promise((r) => setTimeout(r, 2500));
        return {
          waiting: !!(reg.waiting),
          alive: window.__dlAlive || null,                     // gone => the tab was reloaded
          banner: !!document.getElementById('dlSwUpd'),
          text: (document.getElementById('dlSwUpd') || {}).innerText || '',
          loads: sessionStorage.getItem('dl.loads'),
        };
      });
      add('sw scenario 5 · a newly deployed worker waits instead of taking the live session',
        upd.waiting === true && upd.alive === 'session-marker' && upd.loads === '1',
        JSON.stringify(upd));
      add('sw scenario 5 · the page says out loud that a newer build is ready, naming this build',
        upd.banner === true && /newer build/i.test(upd.text) && /v154/.test(upd.text), JSON.stringify(upd.text).slice(0, 160));

      // The click. The swap is not instant: the outgoing worker is only replaced once its own
      // in-flight requests drain, which is why every request in this worker carries a hard
      // deadline — without one a single hung upstream would block the update indefinitely.
      const clicked = await h.page.evaluate(() => {
        const b = [...document.querySelectorAll('#dlSwUpd button')].find((x) => /Reload to update/.test(x.textContent));
        if (!b) return 'no button';
        b.click();
        return 'clicked';
      });
      // window.__dlAlive is gone once the tab has actually reloaded.
      await h.page.waitForFunction(() => window.__dlAlive === undefined, null, { timeout: 40000 }).catch(() => {});
      await h.page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 }).catch(() => {});
      const post = await h.page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return {
          alive: window.__dlAlive || null,
          waiting: !!(reg && reg.waiting),
          controller: !!navigator.serviceWorker.controller,
          banner: !!document.getElementById('dlSwUpd'),
        };
      });
      add('sw scenario 5 · the user\'s click, and only that, performs the swap and reloads',
        clicked === 'clicked' && post.alive === null && post.waiting === false &&
        post.controller === true && post.banner === false,
        JSON.stringify({ clicked, post }));
    } finally { await h.close(); }
  }

  return out;
}

module.exports = { run };

if (require.main === module) {
  (async () => {
    const rows = await run(process.argv[2] || 'dist');
    rows.forEach((r) => console.log(r.ok ? '  ✓ ' + r.name : '  ✗ ' + r.name + '  ' + (r.detail || '')));
    const f = rows.filter((r) => !r.ok).length;
    console.log(`\n${rows.length - f} passed · ${f} failed`);
    process.exit(f);
  })().catch((e) => { console.error(e); process.exit(99); });
}
