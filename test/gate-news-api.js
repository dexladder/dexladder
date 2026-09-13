// gate-news-api.js — the /api/news server core, tested hermetically (no network, no browser).
//   node test/gate-news-api.js
// Stubs `fetch` with fixture feeds: one RSS 2.0 with CDATA + media:content, one Atom with
// <link href>, one feed answering 500, one hanging past the deadline, one duplicating a title,
// one carrying a future-dated item. Then assembles the two host files exactly as
// web/deploy/pack.sh does and syntax-checks both.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process'), os = require('os');
const WEB = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')); } }

const core = fs.readFileSync(path.join(WEB, 'gateway', 'news-core.js'), 'utf8');
const ctx = { AbortSignal: { timeout: () => undefined }, console };
vm.createContext(ctx);
vm.runInContext(core, ctx);
const C = ctx.DL_NEWS_CORE;

console.log('== /api/news core');
ok('core exposes the seven newsroom feeds under the client\'s FEEDS names',
  C.FEEDS.length === 7 && ['Cointelegraph', 'CoinDesk', 'Decrypt', 'Bitcoin Magazine', 'NewsBTC', 'CryptoSlate', 'The Block'].every(n => C.FEEDS.some(f => f.name === n)));
ok('the fixed feed list is the only thing that can be fetched (not an open proxy)',
  !/searchParams|url\.search|query\.url|event\.queryStringParameters/.test(core));

const NOW = Date.UTC(2026, 8, 12, 15, 0, 0);
const rss = (items) => '<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>x</title>' +
  items.map(i => `<item><title><![CDATA[${i.title}]]></title><link>${i.link}</link><pubDate>${i.date}</pubDate>` +
    (i.media ? `<media:content url="${i.media}" medium="image"/>` : '') +
    `<description><![CDATA[<p>${i.desc || 'Body &amp; more'}</p>${i.img ? `<img src="${i.img}">` : ''}]]></description></item>`).join('') + '</channel></rss>';
const atom = (items) => '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>y</title>' +
  items.map(i => `<entry><title>${i.title}</title><link rel="alternate" href="${i.link}"/><published>${i.date}</published><summary>${i.desc || 'sum'}</summary></entry>`).join('') + '</feed>';

const h = (ms) => new Date(NOW - ms).toUTCString();
const FIX = {
  'cointelegraph.com': rss([
    { title: 'Bitcoin holds &amp; ETH climbs', link: 'https://cointelegraph.com/a', date: h(3600e3), media: 'https://img/ct1.jpg' },
    { title: 'Future dated item', link: 'https://cointelegraph.com/f', date: new Date(NOW + 864e5).toUTCString() },
    { title: 'Old story', link: 'https://cointelegraph.com/o', date: h(30 * 3600e3), media: 'https://img/ct-old.jpg' }
  ]),
  'coindesk.com': atom([
    { title: 'Regulators meet in Basel', link: 'https://www.coindesk.com/b', date: new Date(NOW - 1800e3).toISOString() },
    { title: 'Bitcoin holds & ETH climbs', link: 'https://www.coindesk.com/dup', date: new Date(NOW - 600e3).toISOString() } /* duplicate title, newer */
  ]),
  'decrypt.co': rss([{ title: 'Solana &#8217;s new client', link: 'https://decrypt.co/s', date: h(7200e3), img: 'https://img/de.jpg', desc: 'Firedancer &lt;b&gt;ships&lt;/b&gt;' }]),
  'bitcoinmagazine.com': null,      /* 500 */
  'newsbtc.com': 'hang',            /* never resolves within the deadline */
  'cryptoslate.com': rss([{ title: 'Layer 2 fees fall', link: 'https://cryptoslate.com/l2', date: h(300e3) }]),
  'theblock.co': rss([{ title: 'Exchange volumes rise', link: 'https://www.theblock.co/v', date: h(900e3) }])
};
function stubFetch(u, init) {
  const host = Object.keys(FIX).find(k => u.includes(k));
  const body = FIX[host];
  if (body === null) return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('boom') });
  if (body === 'hang') return new Promise((_, rej) => setTimeout(() => rej(new Error('AbortError')), 30));
  return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });
}

(async () => {
  const res = await C.collect(stubFetch, NOW);
  ok('five of seven feeds answer; the dead ones are reported by name with an error, never silently dropped',
    res.ok === 5 && res.of === 7 && res.sources['Bitcoin Magazine'].count === 0 && /HTTP 500/.test(res.sources['Bitcoin Magazine'].err) && res.sources['NewsBTC'].count === 0 && !!res.sources['NewsBTC'].err,
    JSON.stringify(res.sources));
  ok('items carry the client\'s shape: title, link, img, source, t, excerpt',
    res.items.every(i => i.title && /^https?:/.test(i.link) && 'img' in i && i.source && i.t > 0 && 'excerpt' in i));
  ok('newest first', res.items.every((it, k) => k === 0 || res.items[k - 1].t >= it.t), res.items.map(i => i.t).join(','));
  ok('a duplicate title is kept once (the first in newest-first order)',
    res.items.filter(i => /Bitcoin holds/.test(i.title)).length === 1 && res.items.find(i => /Bitcoin holds/.test(i.title)).source === 'CoinDesk');
  ok('CDATA and entities are decoded: "&amp;" → "&", "&#8217;" → "’", tags stripped from the excerpt',
    res.items.some(i => i.title === 'Bitcoin holds & ETH climbs') && res.items.some(i => i.title === 'Solana ’s new client') && res.items.find(i => /Solana/.test(i.title)).excerpt === 'Firedancer ships');
  ok('media:content and inline <img> both yield an image; Atom <link href> yields the link',
    res.items.find(i => i.link === 'https://cointelegraph.com/o').img === 'https://img/ct-old.jpg' && res.items.find(i => /Solana/.test(i.title)).img === 'https://img/de.jpg' && res.items.some(i => i.link === 'https://www.coindesk.com/b'));
  ok('a future-dated item is clamped to now, so it cannot pin itself above the whole desk',
    res.items.find(i => /Future dated/.test(i.title)).t === NOW && res.items[0].t <= NOW);
  ok('newest is reported in the envelope for the ops panel', res.newest === res.items[0].t);
  const r = C.respond(res);
  ok('200 · JSON · CORS * · cached one minute on a live answer',
    r.status === 200 && /json/.test(r.headers['content-type']) && r.headers['access-control-allow-origin'] === '*' && /max-age=60/.test(r.headers['cache-control']) && r.headers['x-dl-news'] === '5/7');
  ok('the body parses back to the same envelope the client joins on (items[].source === FEEDS[].name)',
    JSON.parse(r.body).items.every(i => C.FEEDS.some(f => f.name === i.source)));
  const dead = await C.collect(() => Promise.reject(new Error('down')), NOW);
  const rd = C.respond(dead);
  ok('a total outage is a 503 with no-store — emptiness is never cached', rd.status === 503 && rd.headers['cache-control'] === 'no-store' && JSON.parse(rd.body).ok === 0);
  ok('the cap is 110', C.CAP === 110);
  ok('a zoneless date string is still read', C.when('2026-09-11 21:30:00') > 0);

  console.log('== the two host files, assembled as pack.sh assembles them');
  const tails = path.join(WEB, 'gateway', 'tails');
  const worker = core + fs.readFileSync(path.join(tails, 'worker.tail.js'), 'utf8');
  const nfn = core + fs.readFileSync(path.join(tails, 'netlify.tail.js'), 'utf8');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dlnews-'));
  fs.writeFileSync(path.join(tmp, 'worker.mjs'), worker);
  fs.writeFileSync(path.join(tmp, 'news.js'), nfn);
  let w = true, n = true, werr = '', nerr = '';
  try { cp.execFileSync(process.execPath, ['--check', path.join(tmp, 'worker.mjs')], { stdio: 'pipe' }); } catch (e) { w = false; werr = String(e.stderr).slice(0, 200); }
  try { cp.execFileSync(process.execPath, ['--check', path.join(tmp, 'news.js')], { stdio: 'pipe' }); } catch (e) { n = false; nerr = String(e.stderr).slice(0, 200); }
  ok('dist/_worker.js (core + Cloudflare tail) is a valid ES module', w, werr);
  ok('netlify/functions/news.js (core + Netlify tail) is valid CommonJS', n, nerr);
  ok('the Worker passes every non-/api request to the static assets untouched', /env\.ASSETS\.fetch\(request\)/.test(worker) && /pathname\.startsWith\("\/api\/"\)/.test(worker));
  ok('the Worker answers unknown /api paths with the honest not-deployed 503 (the _redirects rule it replaces)', /not-deployed/.test(worker) && /status: 503/.test(worker));
  ok('_routes.json scopes the Worker to /api/* so _headers and _redirects still govern the payload',
    (() => { try { const j = JSON.parse(fs.readFileSync(path.join(WEB, 'gateway', '_routes.json'), 'utf8')); return j.version === 1 && j.include.length === 1 && j.include[0] === '/api/*'; } catch (e) { return false; } })());
  ok('the Netlify function tells the CDN to cache a live answer and never an outage', /netlify-cdn-cache-control/.test(nfn) && /no-store/.test(nfn));
  const nrd = fs.readFileSync(path.join(WEB, 'deploy', '_redirects.netlify'), 'utf8');
  ok('_redirects.netlify routes /api/news to the function BEFORE the /api/* 503 rule',
    nrd.indexOf('/api/news') >= 0 && nrd.indexOf('/api/news') < nrd.indexOf('/api/*') && /\/api\/news\s+\/\.netlify\/functions\/news\s+200/.test(nrd));
  const crd = fs.readFileSync(path.join(WEB, 'deploy', '_redirects.cloudflare'), 'utf8');
  ok('_redirects.cloudflare no longer shadows /api/* (the Worker owns that prefix now)', !/^\/api\/\*/m.test(crd));
  const pack = fs.readFileSync(path.join(WEB, 'deploy', 'pack.sh'), 'utf8');
  ok('pack.sh assembles _worker.js + _routes.json into the Cloudflare bundle and netlify.toml + the function into the Netlify bundle',
    /_worker\.js/.test(pack) && /_routes\.json/.test(pack) && /netlify\.toml/.test(pack) && /netlify\/functions\/news\.js/.test(pack));
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(99); });
