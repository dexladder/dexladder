/* cmc-dev-server.mjs — serve dist/ AND the real /api/cmc relay, locally.
 *
 * The relay is the reason the web rail works at all (CoinMarketCap sends no CORS
 * header), so a preview that serves only static files shows the rail DARK and
 * proves nothing. This runs the actual Pages Function — the same file that will
 * be deployed, imported, not re-implemented — behind an in-memory stand-in for
 * the edge cache, so what you see locally is what Cloudflare will serve.
 *
 *   node test/cmc-dev-server.mjs [dist] [port]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(process.argv[2] || path.join(here, '..', 'dist'));
const PORT = +(process.argv[3] || 8099);
const FN = path.join(here, '..', 'gateway', 'functions', 'api', 'cmc.js');

const store = new Map();
globalThis.caches = { default: {
  async match(req) { const v = store.get(req.url); return v ? v.clone() : undefined; },
  async put(req, res) { store.set(req.url, res.clone()); }
} };
const relay = await import(FN);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname === '/api/cmc') {
    try {
      const out = req.method === 'OPTIONS'
        ? relay.onRequestOptions({ request: new Request('http://127.0.0.1' + req.url), env: {} })
        : await relay.onRequestGet({ request: new Request('http://127.0.0.1' + req.url), env: {}, waitUntil: (p) => p });
      const body = out.body ? Buffer.from(await out.arrayBuffer()) : Buffer.alloc(0);
      const h = {}; out.headers.forEach((v, k) => { h[k] = v; });
      console.log(String(out.status).padEnd(4), u.searchParams.get('p'), 'cache=' + (h['x-dl-cache'] || '-'));
      res.writeHead(out.status, h); return res.end(body);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
    }
  }
  let f = path.join(DIST, u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');   // SPA fallback, as Pages does
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log('DexLadder + the live CoinMarketCap relay → http://127.0.0.1:' + PORT + '/');
  console.log('open the command palette and type "spot rail" · Ctrl-C stops the server');
});
