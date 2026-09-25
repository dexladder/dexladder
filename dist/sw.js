/* DexLadder service worker — v154 · dexai
 *
 * WHY THIS FILE LOOKS LIKE THIS
 * -----------------------------
 * The worker that shipped before this one served NAVIGATIONS cache-first from the cached
 * shell. A returning visitor with a warm cache therefore kept booting the build they first
 * visited, forever, no matter how many times the site was deployed — the site could be ten
 * builds behind and no returning visitor would ever see it. That is the defect this file
 * exists to close. It is closed WITHOUT giving up offline: offline is a product promise, so
 * navigations are network-FIRST with a deadline and a cached-shell fallback, not network-only.
 *
 * STRATEGY, PER REQUEST TYPE
 *   server tier (/api/, /.netlify/) ... not intercepted at all. Always live. (unchanged)
 *   navigations .................... network-first, NAV_TIMEOUT_MS deadline, cached shell as
 *                                    the fallback. A slow network degrades to the cached
 *                                    shell; it never hangs. A non-ok response is never shown
 *                                    and never cached when a good shell is held.
 *   market/data hosts .............. network-first → cache fallback, TTL-bounded and
 *                                    size-bounded. A fallback still posts {dl:'apicache'} so
 *                                    the app downgrades LIVE → CACHED in the UI.
 *   same-origin static ............. cache-first WITH revalidation (stale-while-revalidate),
 *                                    so an immutable asset is instant but a changed one is
 *                                    picked up on the next load rather than never.
 *
 * EVERY WRITE IS CHECKED. Nothing reaches a cache unless res.ok, status === 200, the response
 * is not opaque, and the content-type is the one that request class is allowed to store. An
 * error page, a 404 body, a captive-portal login page served for an API URL: none of them can
 * become the app. (The old worker checked none of this.)
 *
 * TTL. DATA_TTL_MS bounds the data cache: past it an entry is deleted rather than served, so
 * the app falls back to its own ladder instead of showing a price from last week. The SHELL is
 * deliberately exempt from TTL — expiring it would brick an offline user, which is the one
 * thing offline-first must never do. The shell's age is bounded a different way: every
 * successful navigation rewrites it, so it is never older than the visitor's last online load.
 *
 * BOUND. DATA_MAX entries. Eviction is FIFO over Cache Storage insertion order; because
 * cache.put() removes any matching entry before appending, a re-fetched URL moves to the back,
 * so FIFO here is exactly least-recently-written eviction. Expired entries are dropped in the
 * same sweep. The sweep runs every SWEEP_EVERY writes and on activate — inside waitUntil, not
 * on a timer, because this codebase does not add timers or loops.
 *
 * UPDATES ARE NEVER SILENT. install() does NOT call skipWaiting(). A new worker sits in
 * `waiting` until the PAGE asks for it by posting {dl:'sw-skip-waiting'} — which only happens
 * when the visitor clicks "Reload to update" on the banner the payload shows. The law is that
 * the worker is versioned and never auto-swaps silently; a swap the user chose is not silent.
 *
 * VERSION LOCK. PAYLOAD_SHA is the sha256 of the dist/index.html this worker was minted for,
 * and it is part of the cache name. build154.py refuses to build when the payload's hash and
 * this constant disagree, so the payload cannot change without the worker version changing.
 */
'use strict';

/* --- version ------------------------------------------------------------------------- */
const SW_BUILD    = 'v163';    // asserted by build154.py to equal <meta name="cb:build">
const SW_REV = 5;        // bump for worker-only changes (strategy, TTL, bounds)
const PAYLOAD_SHA = 'e841e04cf9de0a226bd35e8836d5186327a2f924b95f101d03f0853c4bc2d347';
const V           = 'dl-' + SW_BUILD + '-r' + SW_REV + '-' + PAYLOAD_SHA.slice(0, 12);
// Static content served beside the app: the SEO layer, the legal pages and the support page.
// Never cached as the shell, never answered from it.
const CONTENT_ROUTE = /^\/(about|backtesting|blog|crypto-tax|defi|dex-pool-radar|features|fork-sandbox|guides|learn|methodology|onchain-explorer|order-types|paper-trading|perpetuals|privacy|proof-ledger|support|terms|tools|trading-bots|web3)(\/|$)/;
const SHELL_CACHE = V + '-shell';
const DATA_CACHE  = V + '-data';

/* --- policy -------------------------------------------------------------------------- */
const NAV_TIMEOUT_MS = 3500;                 // navigation deadline before the cached shell wins
const NAV_HARD_MS    = 15000;                // and the navigation request is aborted at this point
const DATA_HARD_MS   = 8000;                 // no data request may outlive this
const STATIC_HARD_MS = 15000;                // nor any static one
const DATA_TTL_MS    = 24 * 60 * 60 * 1000;  // a data fallback older than this is dropped, not served
const DATA_MAX       = 120;                  // hard bound on data-cache entries
const SWEEP_EVERY    = 10;                   // sweep after this many data writes
const STAMP          = 'x-dl-cached';        // ms epoch written into every cached data response

const SHELL_REQUIRED = ['./index.html'];
const SHELL_OPTIONAL = ['./', './manifest.webmanifest', './icon.svg', './icon-512.png'];

// Market/data hosts: network-first, cache fallback (the app downgrades LIVE → CACHED when a fallback is served).
// v154: CryptoCompare retired (free API ended May 2026) → Coinlore; new desks' hosts added so offline replays keep working.
const API_HOSTS = /coingecko|coinpaprika|coinlore|binance|coinbase|er-api|alternative\.me|geckoterminal|gopluslabs|llama\.fi|hyperliquid|okx\.com|deribit|polymarket|mempool\.space|blockstream|wikimedia|kraken\.com|theblock/;

/* --- helpers ------------------------------------------------------------------------- */

// One-shot deadline. Not a loop and not a poll: it is the "degrade, never hang" rule.
function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const t = setTimeout(() => { if (!settled) { settled = true; reject(new Error('sw-timeout')); } }, ms);
    p.then(
      (v) => { if (!settled) { settled = true; clearTimeout(t); resolve(v); } },
      (e) => { if (!settled) { settled = true; clearTimeout(t); reject(e); } }
    );
  });
}

// Every request the worker makes carries a hard deadline and is ABORTED when it expires.
// This is not belt-and-braces: a fetch event whose respondWith never settles pins the worker
// alive, and a pinned worker will not let a new version activate — so a single hung upstream
// (measured here: api.coinbase.com, still open after 16s) is enough to block a deploy forever.
// Bounded requests are what make the update path in this file actually reachable.
function netFetch(req, ms, init) {
  const ac = new AbortController();
  const t = setTimeout(() => { try { ac.abort(); } catch (e) {} }, ms);
  const done = () => clearTimeout(t);
  return fetch(req, Object.assign({ signal: ac.signal }, init || {}))
    .then((r) => { done(); return r; }, (e) => { done(); throw e; });
}

function ctOf(res) { try { return String(res.headers.get('content-type') || '').toLowerCase(); } catch (e) { return ''; } }

// The single gate every cache.put() must pass. No res.ok, no cache — full stop.
function storable(res, kind) {
  if (!res || !res.ok || res.status !== 200 || res.type === 'opaque' || res.type === 'opaqueredirect') return false;
  const ct = ctOf(res);
  if (kind === 'shell')  return ct.indexOf('text/html') === 0 || ct.indexOf('text/html') > -1;
  if (kind === 'data')   return /json|text\/|xml/.test(ct);
  if (kind === 'static') return res.type === 'basic' && ct !== '';
  return false;
}

// Re-issue a response carrying the time it was stored. Cache Storage keeps no timestamps of
// its own, so the TTL has to live in a header we add.
async function stamped(res) {
  const body = await res.clone().blob();
  const h = new Headers(res.headers);
  h.set(STAMP, String(Date.now()));
  return new Response(body, { status: res.status, statusText: res.statusText, headers: h });
}

function fresh(res) {
  const t = res && +res.headers.get(STAMP);
  return !!t && (Date.now() - t) < DATA_TTL_MS;
}

// THE ONLY PLACE THIS WORKER WRITES TO A CACHE. Every call site goes through here, so the
// res.ok / status / content-type gate cannot be bypassed by adding a new one — and the gate
// asserts that cache.put() appears exactly once in this file, inside this function.
async function store(cache, key, res, kind) {
  if (!storable(res, kind)) return false;
  await cache.put(key, kind === 'static' ? res.clone() : await stamped(res));
  return true;
}

let writes = 0;
async function sweep(cache) {
  const keys = await cache.keys();           // insertion order, oldest write first
  const live = [];
  for (const k of keys) {
    const r = await cache.match(k);
    if (!fresh(r)) { await cache.delete(k); continue; }   // TTL
    live.push(k);
  }
  const over = live.length - DATA_MAX;                     // BOUND: drop the oldest writes
  for (let i = 0; i < over; i++) await cache.delete(live[i]);
}

async function putData(req, res) {
  const cache = await caches.open(DATA_CACHE);
  if (!(await store(cache, req, res, 'data'))) return;
  if ((++writes % SWEEP_EVERY) === 0) await sweep(cache);
}

function tellApiCache(url) {
  return self.clients.matchAll().then((cs) =>
    cs.forEach((c) => c.postMessage({ dl: 'apicache', u: url.hostname + url.pathname }))
  ).catch(() => {});
}

// Honest last resort: no network and nothing cached yet. Never a hang, never a lie.
function offlinePage() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>DexLadder — offline</title>' +
    '<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#04070c;color:#E7EDF8;' +
    'font:600 15px/1.5 system-ui,sans-serif;text-align:center;padding:24px">' +
    '<div><div style="font-size:34px;margin-bottom:10px">₿</div>' +
    '<p>DexLadder could not reach the network, and this device has no cached copy of the app yet.</p>' +
    '<p style="color:#7E8CA8;font-weight:500">Reconnect and reload once — after that the app runs offline.</p></div>',
    { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

/* --- install / activate --------------------------------------------------------------- */

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Required: if the shell itself is not a good 200 text/html, the install FAILS. The old
    // worker's addAll() would equally have failed here, but it also failed when a decorative
    // icon was missing, which is how a whole offline install could be lost to a 404 favicon.
    for (const u of SHELL_REQUIRED) {
      const res = await netFetch(u, STATIC_HARD_MS, { cache: 'reload' });
      if (!(await store(cache, u, res, 'shell'))) throw new Error('shell not cacheable: ' + u + ' ' + res.status);
    }
    // Tolerated one by one. The old worker used addAll(), which is all-or-nothing: a single
    // missing decorative icon threw away the whole offline install.
    for (const u of SHELL_OPTIONAL) {
      try { await store(cache, u, await netFetch(u, STATIC_HARD_MS, { cache: 'reload' }), 'static'); } catch (err) {}
    }
    // No skipWaiting(). The worker waits until the page asks — see the message handler.
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k)));
    try { await sweep(await caches.open(DATA_CACHE)); } catch (err) {}
    await self.clients.claim();
  })());
});

// The only route to a swap. The payload posts this when the visitor clicks "Reload to update".
self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.dl === 'sw-skip-waiting') self.skipWaiting();
  else if (d.dl === 'sw-version' && e.ports && e.ports[0]) {
    e.ports[0].postMessage({ v: V, build: SW_BUILD, rev: SW_REV, payload: PAYLOAD_SHA, ttl: DATA_TTL_MS, max: DATA_MAX });
  }
});

/* --- fetch strategies ------------------------------------------------------------------ */

async function navigateFirst(e, req) {
  const cache = await caches.open(SHELL_CACHE);
  const net = netFetch(req, NAV_HARD_MS, { cache: 'no-store' }).then((res) => {
    e.waitUntil(store(cache, './index.html', res, 'shell').catch(() => {}));
    return res;
  });

  const cached = await cache.match('./index.html');
  if (!cached) {
    // Nothing to fall back to. Wait for the network rather than fail fast, and if it never
    // comes, say so honestly instead of showing a browser error.
    try { const res = await net; return res.ok ? res : offlinePage(); }
    catch (err) { return offlinePage(); }
  }

  try {
    const res = await withTimeout(net, NAV_TIMEOUT_MS);
    if (res && res.ok) return res;           // fresh build wins — this is the whole point
    return cached;                           // a 500/404 shell is never shown and never stored
  } catch (err) {
    e.waitUntil(net.catch(() => {}));        // slow or offline: serve the shell, let the refresh land
    return cached;
  }
}

async function dataFirst(e, req, url) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const res = await netFetch(req, DATA_HARD_MS);
    e.waitUntil(putData(req, res).catch(() => {}));
    if (res.ok) return res;
    const hit = await cache.match(req);
    if (hit && fresh(hit)) { e.waitUntil(tellApiCache(url)); return hit; }
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit && fresh(hit)) { e.waitUntil(tellApiCache(url)); return hit; }
    if (hit) e.waitUntil(cache.delete(req).catch(() => {}));  // expired: drop, do not serve
    throw err;                                                // the app's own ladder takes over
  }
}

async function staticRevalidate(e, req) {
  const cache = await caches.open(SHELL_CACHE);
  const net = netFetch(req, STATIC_HARD_MS).then((res) => {
    e.waitUntil(store(cache, req, res, 'static').catch(() => {}));
    return res;
  });
  const hit = await cache.match(req);
  if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
  return net;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  // Never cache the server tier — always live (Wallet passes, RSS, the DeXaI gateway).
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;

  // The worker script is the browser's business and is served no-store; never shadow it.
  if (url.origin === self.location.origin && /(^|\/)sw\.js$/.test(url.pathname)) return;

  // CONTENT ROUTES ARE NOT THE APP SHELL.
  // navigateFirst() stores every successful navigation as './index.html' — the shell. That is
  // correct for the app and wrong for every static page beside it: visiting /support/ or a
  // glossary page would overwrite the cached shell with that page, so the next offline boot
  // would open a document instead of DexLadder. It also means a returning visitor could be
  // served the app shell for a content URL, which is exactly the failure App Review hit on the
  // support URL. These paths are therefore not intercepted at all: plain network, no store.
  if (url.origin === self.location.origin && CONTENT_ROUTE.test(url.pathname)) return;

  if (req.mode === 'navigate') { e.respondWith(navigateFirst(e, req)); return; }

  if (API_HOSTS.test(url.hostname)) { e.respondWith(dataFirst(e, req, url)); return; }

  if (url.origin === self.location.origin) { e.respondWith(staticRevalidate(e, req)); }
});
