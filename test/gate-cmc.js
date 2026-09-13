// gate-cmc.js — the CoinMarketCap keyless rail, pinned.
//
// WHY A GATE AND NOT A TEST. Everything this feature depends on lives on somebody
// else's server and was true on 12 Sep 2026. Three things rot silently:
//
//   1 THE ALLOWLIST DRIFT. The app asks the relay for a path the relay does not
//     carry (or the relay carries one the app never asks for). The user sees an
//     empty desk; nothing logs. Asserted structurally, both directions.
//   2 THE UNIT TRAP. v4/dex percent_change_price_* are FRACTIONS. Verified live:
//     WETH/USDT read 0.0281 in the same minute CMC's own ETH quote read 2.769%.
//     Anything that prints them raw is off by 100x and reads as a dead market.
//     The x100 must exist exactly once in each surface.
//   3 THE KEY CREEPING IN. The whole point is keyless. A key header, an x402
//     route or an endpoint that answers 403 without one is a regression even if
//     it "works" on the developer's machine.
//
// Plus single-source: the web venue registry and the native one must name the
// same networks and the same dex slugs, or the two apps show different markets.
//
// Usage: node test/gate-cmc.js [dist/index.html] [--live]
//        --live also probes CoinMarketCap itself and asserts that every endpoint
//        the app uses still answers without a key, and that every endpoint the
//        app deliberately avoids still refuses one. Offline runs skip that.
'use strict';
const fs = require('fs'), path = require('path');
const WEB = path.resolve(__dirname, '..');
const payload = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(WEB, 'dist', 'index.html');
const LIVE = process.argv.includes('--live');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✖ ' + m); } };

const layer = fs.readFileSync(path.join(WEB, 'layers', '42-cmc.js'), 'utf8');
const relay = fs.readFileSync(path.join(WEB, 'gateway', 'functions', 'api', 'cmc.js'), 'utf8');
const native = fs.readFileSync(path.join(WEB, '..', 'ios', 'DexLadder', 'DXCMC.swift'), 'utf8');
const hub = fs.readFileSync(path.join(WEB, '..', 'ios', 'DexLadder', 'DXHub.swift'), 'utf8');
const built = fs.existsSync(payload) ? fs.readFileSync(payload, 'utf8') : '';

/* Comments in these files NAME the endpoints that need a key — that prose is the
   record of why they are absent, so a check that reads it as a call site would
   punish the documentation. Every "is it reached" assertion below runs on code
   with the comments stripped; every "is it explained" assertion runs on the raw
   text. Stripping is line-oriented so a "https://" inside a string survives. */
const decomment = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
const layerCode = decomment(layer), relayCode = decomment(relay), nativeCode = decomment(native);

/* ---- 1 · the layer actually ships ---- */
ok(built.includes('window.DLCMC'), 'the built payload does not contain the DLCMC layer — layers/*.js are globbed, so 42-cmc.js was not picked up');
ok(built.includes('/api/cmc'), 'the built payload never names the relay route');
ok(/DXCMCView\(\)/.test(hub), 'the native hub does not mount DXCMCView — the desk exists but nothing opens it');

/* ---- 2 · allowlist parity, both directions ---- */
const relayAliases = [...relay.matchAll(/^\s{2}(\w+):\s*\{\s*path:\s*"([^"]+)"/gm)].map(m => [m[1], m[2]]);
ok(relayAliases.length === 5, 'the relay allowlist is not the 5 routes the app actually uses (found ' + relayAliases.length + ')');
const layerPaths = [...layer.matchAll(/(\w+):\s*"(v\d\/[^"]+)"/g)].map(m => [m[1], m[2]]);
for (const [alias, p] of layerPaths) {
  const hit = relayAliases.find(r => r[0] === alias);
  ok(hit, 'the layer asks for alias "' + alias + '" which the relay does not carry');
  ok(!hit || hit[1] === p, 'alias "' + alias + '" points at ' + p + ' in the layer and ' + (hit && hit[1]) + ' in the relay');
}
for (const [alias] of relayAliases) ok(layerPaths.some(l => l[0] === alias), 'the relay carries alias "' + alias + '" that no surface asks for — dead surface area on a public endpoint');

/* ---- 3 · the endpoints that need a key must not appear anywhere ---- */
const forbidden = ['networks/list', 'listings/info', 'listings/quotes', 'pairs/ohlcv', 'pairs/trade/latest', 'tools/price-conversion', 'blockchain/statistics'];
for (const f of forbidden) {
  ok(!new RegExp('"[^"]*' + f.replace(/\//g, '\\/')).test(relayCode), 'the relay routes ' + f + ', which answers 403 without a key');
  ok(!new RegExp('"[^"]*' + f.replace(/\//g, '\\/')).test(layerCode), 'the web layer calls ' + f + ', which answers 403 without a key');
}
for (const src of [['layer', layerCode], ['relay', relayCode], ['native', nativeCode]]) {
  ok(!/X-CMC_PRO_API_KEY\s*[:"]/.test(src[1].replace(/access-control-allow-headers[\s\S]{0,200}/g, '')), 'the ' + src[0] + ' sets an API key header — this rail is keyless by design');
  ok(!/\/x402\//.test(src[1]), 'the ' + src[0] + ' reaches an x402 route — those answer 402 Payment Required and settle on-chain');
}

/* ---- 4 · the fraction trap, once per surface ---- */
ok((layer.match(/var PCT = 100;/g) || []).length === 1, 'the web layer no longer converts the DEX percent fractions exactly once (PCT = 100)');
ok(/h1:\s*\(\+q\.percent_change_price_1h[^)]*\)\s*\*\s*PCT/.test(layer), 'the web layer does not multiply percent_change_price_1h by PCT');
ok(/h24:\s*\(\+q\.percent_change_price_24h[^)]*\)\s*\*\s*PCT/.test(layer), 'the web layer does not multiply percent_change_price_24h by PCT');
ok((native.match(/\(v \?\? 0\) \* 100/g) || []).length === 1, 'the native surface no longer converts the DEX percent fractions exactly once');
ok(/change1h:\s*DXCMCStore\.pct/.test(native) && /change24h:\s*DXCMCStore\.pct/.test(native), 'the native surface does not route both change fields through pct()');

/* ---- 5 · the relay's cache rules ---- */
ok(/good \? "public, max-age=" \+ route\.ttl : "no-store"/.test(relay), 'the relay may cache a FAILURE — one bad minute would then be served for the whole TTL');
ok(/waitUntil\(cache\.put/.test(relay) && /if \(good\)/.test(relay), 'the relay caches unconditionally');
ok(/const SAFE = \//.test(relay) && /!SAFE\.test\(v\)/.test(relay), 'the relay does not validate parameter values — an allowlist of names without a value check is not a boundary');
ok(/method:\s*"GET"/.test(relay) && !/onRequestPost/.test(relay), 'the relay accepts something other than GET');
/* The last-known-good path. Anonymous access is metered per IP and the relay is
   ONE IP for every reader, so a 429 earned by somebody else's burst must not blank
   a desk — and must not be dressed up as fresh either. */
ok(/staleKey/.test(relayCode), 'the relay keeps no last-known-good copy — one 429 would blank the desk for everybody');
ok(/x-dl-stale/.test(relayCode) && /h\.set\("x-dl-cache", "stale"\)/.test(relayCode), 'the relay serves a stale body without labelling it stale');
ok(!/h\.set\("x-dl-at"/.test(relayCode), 'the relay rewrites x-dl-at on a stale answer — that is a stale figure wearing a fresh timestamp');
ok(/if \(!good && res\.status === 429\) headers\.set\("retry-after"/.test(relayCode), 'retry-after is not set before the Response is constructed, so it never reaches the caller');

/* ---- 6 · honest degradation, not a fake price ---- */
ok(/rail is dark/.test(layer), 'the web layer does not name the dark state — a CORS failure must be explained, not swallowed');
ok(/deploy web\/gateway/.test(layer), 'the dark-state message does not tell the operator how to light the rail');
ok(/One source is not a cross-check/.test(layer) && /One source is not a cross-check/.test(native), 'a single-witness result is not refused on both surfaces');
ok(/bps > 50/.test(layer.replace(/\s+/g, ' ')) || /bps\s*>\s*50/.test(layer), 'the web contested threshold is not 50 bps');
ok(/bps > 50/.test(native), 'the native contested threshold is not 50 bps');
ok(/contested:\s*x\.contested/.test(layer), 'a contested cross-check does not mark the provenance chip — the app would print a disputed price as clean');

/* ---- 7 · single source: the venue registries must match ---- */
const webVenues = {};
for (const m of layer.matchAll(/\{\s*net:\s*"([a-z]+)",\s*name:\s*"([^"]+)",\s*rnet:\s*"([a-z_]+)",\s*dex:\s*\[([^\]]*(?:\][^\]]*)*?)\]\s*\}/g)) {
  webVenues[m[1]] = [...m[4].matchAll(/\["([a-z0-9-]+)",/g)].map(x => x[1]);
}
const natVenues = {};
for (const m of native.matchAll(/DXCMCVenue\(network:\s*"([a-z]+)"[\s\S]*?dexes:\s*\[([\s\S]*?)\]\)/g)) {
  natVenues[m[1]] = [...m[2].matchAll(/\("([a-z0-9-]+)",/g)].map(x => x[1]);
}
ok(Object.keys(webVenues).length === 5, 'the web venue registry is not the 5 verified networks (found ' + Object.keys(webVenues).length + ')');
ok(Object.keys(natVenues).length === 5, 'the native venue registry is not the 5 verified networks (found ' + Object.keys(natVenues).length + ')');
for (const n of Object.keys(webVenues)) {
  ok(natVenues[n], 'network "' + n + '" is on the web rail and missing from the native one');
  if (natVenues[n]) ok(webVenues[n].join(',') === natVenues[n].join(','), 'network "' + n + '" lists different venues on web (' + webVenues[n].join(',') + ') and native (' + natVenues[n].join(',') + ')');
}
for (const bad of ['bsc', 'avalanche', 'avax', 'optimism']) {
  ok(!webVenues[bad], 'the web rail offers "' + bad + '", which is not supported on the keyless tier');
  ok(!natVenues[bad], 'the native rail offers "' + bad + '", which is not supported on the keyless tier');
}

/* ---- 8 · live probe (opt-in) ---- */
async function live() {
  const B = 'https://pro-api.coinmarketcap.com/trial-pro-api';
  const get = async (u) => { try { const r = await fetch(u, { headers: { accept: 'application/json' } }); const j = await r.json().catch(() => null); return { status: r.status, j }; } catch (e) { return { status: 0, err: String(e.message || e) }; } };
  console.log('  live: probing CoinMarketCap without a key…');
  const spot = await get(B + '/v4/dex/spot-pairs/latest?network_slug=ethereum&dex_slug=uniswap-v3');
  ok(spot.status === 200 && spot.j && Array.isArray(spot.j.data) && spot.j.data.length > 0, 'spot-pairs/latest no longer answers keyless (status ' + spot.status + ')');
  const one = spot.j && spot.j.data && spot.j.data[0];
  ok(one && one.quote && one.quote[0] && one.quote[0].price > 0, 'spot-pairs rows no longer carry quote[0].price');
  ok(one && typeof one.base_asset_contract_address === 'string', 'spot-pairs rows no longer carry base_asset_contract_address — the security scan would lose its token');
  /* the unit trap, re-verified against CMC's own coin quote in the same minute */
  const eth = await get(B + '/v3/cryptocurrency/quotes/latest?symbol=ETH&convert=USD');
  const row = eth.j && eth.j.data && eth.j.data.find(r => (Array.isArray(r.quote) ? r.quote[0] : r.quote && r.quote.USD || {}).price > 0);
  const q = row && (Array.isArray(row.quote) ? row.quote[0] : row.quote.USD);
  const weth = spot.j && spot.j.data && spot.j.data.find(r => /WETH\/USD/.test(r.name || ''));
  if (q && weth) {
    const coinPct = Math.abs(q.percent_change_24h), poolFrac = Math.abs(weth.quote[0].percent_change_price_24h) * 100;
    ok(coinPct < 0.05 || Math.abs(coinPct - poolFrac) < Math.abs(coinPct - poolFrac / 100),
       'the DEX percent fields no longer look like fractions — CMC may have changed the unit, and x100 would now be wrong (coin ' + coinPct + '% vs pool x100 ' + poolFrac + ')');
  }
  for (const p of ['v4/dex/networks/list?limit=3', 'v2/cryptocurrency/ohlcv/latest?symbol=BTC', 'v1/tools/price-conversion?amount=1&symbol=BTC&convert=USD']) {
    const r = await get(B + '/' + p);
    ok(r.status === 403, p + ' now answers ' + r.status + ' rather than 403 — it may have become keyless, and the allowlist could grow');
  }
  const x402 = await get('https://pro-api.coinmarketcap.com/x402/v1/dex/search?keyword=pepe');
  ok(x402.status === 402, 'the x402 rail no longer answers 402 — re-read what it costs before touching it');
}

/* ---------------------------------------------------------------------------------------
   4 · THE RELAY IS ACTUALLY DEPLOYED. This is the defect this block exists for: the relay
   was written as a Cloudflare Pages FUNCTION, and in advanced mode a _worker.js replaces
   the functions/ directory outright while _routes.json hands the Worker every /api/* path.
   So from v157 until v159 the live site answered /api/cmc with the 503 "not-deployed"
   envelope and the desk showed its own "the rail is dark" message. Structural, offline,
   and permanent: the packed worker must carry the relay and route it.
   ------------------------------------------------------------------------------------ */
const pack = fs.readFileSync(path.join(WEB, 'deploy', 'pack.sh'), 'utf8');
const tail = fs.readFileSync(path.join(WEB, 'gateway', 'tails', 'worker.tail.js'), 'utf8');
ok(/cat "\$CORE" gateway\/functions\/api\/cmc\.js gateway\/tails\/worker\.tail\.js/.test(pack),
   'pack.sh no longer concatenates the CMC relay into _worker.js — /api/cmc would go back to 503 on the live site');
ok(/url\.pathname === "\/api\/cmc"/.test(tail) && /onRequestGet\(dlCmcCtx\(/.test(tail) && /onRequestOptions\(dlCmcCtx\(/.test(tail),
   'the worker no longer routes /api/cmc to the relay — the 503 fallthrough would swallow it');
ok(tail.indexOf('/api/cmc') < tail.indexOf('startsWith("/api/")'),
   'the /api/* 503 rule now comes BEFORE the /api/cmc route — order decides which one answers');
ok(!/x-cmc[-_]?pro[-_]?api[-_]?key/i.test(relay + tail), 'a CMC key header has appeared in the relay or the worker — the rail is keyless by design');

(async () => {
  if (LIVE) await live();
  console.log(fail === 0 ? `gate-cmc: ${pass} passed` : `gate-cmc: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
