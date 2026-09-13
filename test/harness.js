// Headless harness: serves a build over http, mocks every external host with fixtures,
// exposes helpers for gate scripts. Usage: node test/harness.js <index.html> [--baseline]
'use strict';
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const F = require('./fixtures');

function serve(dir){
  return new Promise(res => {
    const srv = http.createServer((req, r) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      let f = path.join(dir, p === '/' ? '/index.html' : p);
      if (!fs.existsSync(f)) { r.writeHead(404); return r.end('nf'); }
      const ext = path.extname(f);
      r.writeHead(200, { 'content-type': ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' ? 'text/javascript' : 'application/octet-stream' });
      fs.createReadStream(f).pipe(r);
    }).listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }));
  });
}

function json(route, obj, status){ return route.fulfill({ status: status||200, contentType: 'application/json', headers:{'access-control-allow-origin':'*'}, body: JSON.stringify(obj) }); }
function text(route, s, ct){ return route.fulfill({ status: 200, contentType: ct||'text/plain', headers:{'access-control-allow-origin':'*'}, body: s }); }

async function mockNetwork(page, log){
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, async route => {
    const u = route.request().url(); const method = route.request().method();
    log && log.push(u);
    try {
      // CoinGecko
      if (/api\.coingecko\.com\/api\/v3\/coins\/markets/.test(u)) { const q = new URL(u).searchParams; const per=+q.get('per_page')||30, page_=+q.get('page')||1; return json(route, F.markets(page_, per)); }
      if (/api\.coingecko\.com\/api\/v3\/global$/.test(u)) return json(route, F.GLOBAL);
      if (/coingecko\.com\/api\/v3\/search\/trending/.test(u)) return json(route, F.TRENDING);
      if (/coingecko\.com\/api\/v3\/exchange_rates/.test(u)) return json(route, F.RATES);
      if (/coingecko\.com\/api\/v3\/coins\/categories/.test(u)) return json(route, F.CATEGORIES);
      if (/coingecko\.com\/api\/v3\/companies\/public_treasury/.test(u)) return json(route, F.TREASURY);
      if (/coingecko\.com\/api\/v3\/exchanges/.test(u)) return json(route, F.EXCHANGES);
      let m = u.match(/coingecko\.com\/api\/v3\/coins\/([a-z0-9-]+)\/market_chart\?.*days=(\d+|max)/); if (m) return json(route, F.marketChart(m[2]==='max'?365:+m[2]));
      m = u.match(/coingecko\.com\/api\/v3\/coins\/([a-z0-9-]+)\/tickers/); if (m) return json(route, F.TICKERS);
      m = u.match(/coingecko\.com\/api\/v3\/coins\/([a-z0-9-]+)\/history/); if (m) return json(route, { id:m[1], market_data:{ current_price:{ usd: m[1]==='bitcoin'?60000:2500, inr: m[1]==='bitcoin'?4980000:207500, eur: m[1]==='bitcoin'?55000:2300 } } });
      m = u.match(/coingecko\.com\/api\/v3\/coins\/([a-z0-9-]+)(\?|$)/); if (m) return json(route, F.COIN_DETAIL(m[1]));
      // alternative.me
      if (/alternative\.me\/fng/.test(u)) return json(route, F.FNG);
      // Coinpaprika — the SECOND witness for every whole-market figure. It is mocked to
      // DISAGREE with CoinGecko exactly as it does live (market cap 2.51% apart, 24h volume
      // 1.99x apart, BTC dominance in agreement), because a fixture that agrees with itself
      // can never exercise the quorum:"disagree" path that shipped un-rendered for a year.
      if (/api\.coinpaprika\.com\/v1\/global/.test(u)) return json(route, F.PAPRIKA_GLOBAL);
      // GeckoTerminal
      if (/geckoterminal\.com\/api\/v2\/networks\/[a-z_]+\/new_pools/.test(u)) return json(route, F.gtPools('new'));
      if (/geckoterminal\.com\/api\/v2\/networks\/[a-z_]+\/trending_pools/.test(u)) return json(route, F.gtPools('trending'));
      if (/geckoterminal\.com\/api\/v2\/networks\/[a-z_]+\/pools\/[^/]+\/ohlcv/.test(u)) return json(route, F.gtOhlcv());
      if (/geckoterminal\.com\/api\/v2\/search\/pools/.test(u)) return json(route, F.gtPools('trending'));
      if (/geckoterminal\.com\/api\/v2\/networks(\?|$)/.test(u)) return json(route, { data:[{id:'eth',attributes:{name:'Ethereum'}},{id:'solana',attributes:{name:'Solana'}},{id:'base',attributes:{name:'Base'}},{id:'bsc',attributes:{name:'BNB Chain'}}] });
      // DexScreener
      if (/api\.dexscreener\.com/.test(u)) return json(route, { pairs: [] });
      // GoPlus
      if (/gopluslabs\.io\/api\/v1\/solana\/token_security/.test(u)) return json(route, { code:1, result:{ 'So11111111111111111111111111111111111111112': { mintable:{status:'0'}, freezable:{status:'0'}, closable:{status:'0'}, metadata:{name:'Wrapped SOL',symbol:'SOL'}, holder_count:'1000000', creators:[], lp_holders:[] } } });
      if (/gopluslabs\.io\/api\/v1\/token_security/.test(u)) return json(route, F.GOPLUS);
      // DefiLlama
      if (/api\.llama\.fi\/v2\/chains/.test(u)) return json(route, F.LLAMA_CHAINS);
      if (/api\.llama\.fi\/overview\/dexs/.test(u)) return json(route, Object.assign({}, F.LLAMA_DEXS, { totalDataChartBreakdown: [[Math.floor(Date.now()/1000), {Ethereum:2.4e9, Solana:1.8e9, BSC:9e8, Base:7e8}]] }));
      if (/api\.llama\.fi\/overview\/fees/.test(u)) return json(route, Object.assign({}, F.LLAMA_FEES, { totalDataChartBreakdown: [[Math.floor(Date.now()/1000), {Ethereum:2.4e6, Solana:1.9e6, Tron:2.2e6}]] }));
      if (/yields\.llama\.fi\/pools/.test(u)) return json(route, F.LLAMA_YIELDS);
      if (/stablecoins\.llama\.fi\/stablecoinchains/.test(u)) return json(route, [{name:'Ethereum',totalCirculatingUSD:{peggedUSD:1.3e11}},{name:'Tron',totalCirculatingUSD:{peggedUSD:6e10}},{name:'Solana',totalCirculatingUSD:{peggedUSD:8e9}}]);
      if (/stablecoins\.llama\.fi/.test(u)) return json(route, { peggedAssets: [] });
      // derivatives
      if (/api\.hyperliquid\.xyz\/info/.test(u)) return json(route, F.HL_META);
      if (/deribit\.com\/api\/v2\/public\/get_volatility_index_data/.test(u)) return json(route, F.DVOL);
      if (/okx\.com\/api\/v5/.test(u)) return json(route, { code:'0', data:[] });
      if (/binance\.(com|vision)\/fapi/.test(u)) return json(route, []);
      if (/data-api\.binance\.vision\/api\/v3\/ticker\/price/.test(u)) return json(route, [{symbol:'BTCUSDT',price:'67852'},{symbol:'ETHUSDT',price:'3521'}]);
      if (/data-api\.binance\.vision\/api\/v3\/ticker\/24hr/.test(u)) return json(route, []);
      if (/data-api\.binance\.vision\/api\/v3\/klines/.test(u)) return json(route, []);
      if (/api\.binance\.com/.test(u)) { log && log.push('!!BINANCE-CORS-HOST:'+u); return route.abort(); }
      // Polymarket
      if (/gamma-api\.polymarket\.com\/events\?slug=/.test(u)) { const slug=decodeURIComponent(u.split('slug=')[1]); return json(route, F.POLY_EVENTS.data.filter(e=>e.slug===slug)); }
      if (/gamma-api\.polymarket\.com\/events/.test(u)) return json(route, F.POLY_EVENTS.data);
      m = u.match(/gamma-api\.polymarket\.com\/markets\/([a-z0-9]+)/); if (m) { const mk = F.POLY_EVENTS.data.map(e=>e.markets[0]).find(x=>x.id===m[1]); if (!mk) return route.fulfill({status:404, body:'nf'}); const closed = global.__polyClose && global.__polyClose[m[1]]; return json(route, closed ? Object.assign({}, mk, { closed:true, outcomePrices: JSON.stringify(closed) }) : mk); }
      if (/gamma-api\.polymarket\.com\/markets/.test(u)) return json(route, F.POLY_EVENTS.data.map(e=>e.markets[0]));
      if (/clob\.polymarket\.com\/midpoint/.test(u)) return json(route, F.POLY_MID);
      if (/clob\.polymarket\.com\/midpoints/.test(u)) return json(route, { '111':'0.415','222':'0.585','333':'0.88','444':'0.12','555':'0.22','666':'0.78' });
      if (/clob\.polymarket\.com\/price/.test(u)) return json(route, { price:'0.42' });
      // chain
      if (/mempool\.space\/api\/v1\/difficulty-adjustment/.test(u)) return json(route, F.MEMPOOL_DA);
      if (/mempool\.space\/api\/v1\/fees\/recommended/.test(u)) return json(route, { fastestFee:12, halfHourFee:9, hourFee:7, economyFee:4, minimumFee:2 });
      if (/blockstream\.info\/api\/blocks\/tip\/height/.test(u)) return text(route, F.TIP_HEIGHT);
      if (/blockstream\.info\/api\/fee-estimates/.test(u)) return json(route, {'1':12,'3':10,'6':8});
      if (/blockstream\.info/.test(u)) return json(route, {});
      if (/publicnode\.com|cloudflare-eth\.com|rpc\.ankr\.com/.test(u)) return json(route, { jsonrpc:'2.0', id:1, result:'0x5f5e100' });
      // wikipedia
      m = u.match(/wikimedia\.org\/api\/rest_v1\/metrics\/pageviews\/per-article\/en\.wikipedia\/all-access\/user\/([^/]+)\//); if (m) return json(route, F.WIKI(decodeURIComponent(m[1])));
      if (/en\.wikipedia\.org\/api\/rest_v1\/page\/summary/.test(u)) return json(route, { title:'Bitcoin', extract:'Bitcoin is a decentralized digital currency.', content_urls:{desktop:{page:'https://en.wikipedia.org/wiki/Bitcoin'}} });
      // coinlore / kraken / coinbase
      if (/api\.coinlore\.net\/api\/tickers/.test(u)) return json(route, F.COINLORE);
      if (/api\.coinlore\.net\/api\/ticker/.test(u)) return json(route, F.COINLORE_TICKER.slice(0,2));
      if (/api\.kraken\.com\/0\/public\/Ticker/.test(u)) return json(route, { error:[], result:{ XXBTZUSD:{c:['67851.0','1']}, XETHZUSD:{c:['3520.5','1']} } });
      if (/api\.kraken\.com\/0\/public\/OHLC/.test(u)) { const rows=[]; for(let i=200;i>0;i--) rows.push([Math.floor(Date.now()/1000)-i*3600,'67000','67500','66500',String(67000+i*2),'67200','12','40']); return json(route, { error:[], result:{ XXBTZUSD: rows, last: 1 } }); }
      if (/api\.exchange\.coinbase\.com\/products\/[^/]+\/candles/.test(u)) { const rows=[]; for(let i=0;i<300;i++) rows.push([Math.floor(Date.now()/1000)-i*3600, 66500, 67500, 67000, 67000+i, 12]); return json(route, rows); }
      // FX
      if (/open\.er-api\.com/.test(u)) return json(route, { result:'success', rates:{ USD:1, EUR:0.92, INR:83.1, GBP:0.78, JPY:146, AED:3.67, SGD:1.34, CAD:1.36, AUD:1.5, CHF:0.86, BRL:5.4, KRW:1330, CNY:7.2, TRY:34, NGN:1500, ZAR:18, MXN:19, IDR:15800, PHP:57, VND:24800, PKR:278, BDT:118, THB:35, MYR:4.5, SAR:3.75, EGP:48, RUB:90, PLN:4.0, SEK:10.5, NOK:10.8, HKD:7.8, NZD:1.65 } });
      // news
      // The desk's transport ladder, mocked as the open web actually answered it on
      // 12 Sep 2026. The three raw-XML proxies the payload shipped with were ALL mocked
      // ALIVE here until now, which is why no gate ever saw the reported failure: the
      // categorised front page was blank in production and green in the suite. They are
      // mocked with their real live status codes, and flagged, so any future reliance on
      // them shows up in h.net.
      const feedName = (raw) => (String(raw||'').match(/https?:\/\/(?:www\.)?([a-z0-9.-]+)/)||[])[1] || 'feed';
      // Re-measured from the owner's Chrome on the evening of 12 Sep 2026 (v158):
      //   rss2json answers 422 to ANY `count=` on the free tier — that parameter is what made the
      //   rung fail 8/8 in production; without it, 200 and 10 items.
      //   test.cors.workers.dev is out of quota: 429 with no CORS header, which a page sees as a
      //   TypeError. allorigins /raw is 408; its /get JSON envelope is alive. codetabs times out.
      //   api.cors.lol answers the full feed. Every one is mocked with what it really did.
      if (/api\.rss2json\.com/.test(u)) {
        if (/[?&]count=/.test(u)) { log && log.push('!!RSS2JSON-COUNT:'+u); return json(route, { status:'error', message:'count is only available for API key holders' }, 422); }
        const inner = decodeURIComponent((u.split('rss_url=')[1]||'').split('&')[0]); return json(route, F.RSS2JSON(feedName(inner)));
      }
      if (/api\.cors\.lol/.test(u)) { const inner = decodeURIComponent((u.split('url=')[1]||'').split('&')[0]); return text(route, F.RSS(feedName(inner)), 'application/rss+xml'); }
      if (/api\.allorigins\.win\/get/.test(u)) { const inner = decodeURIComponent((u.split('url=')[1]||'').split('&')[0]); return json(route, { contents: F.RSS(feedName(inner)), status: { url: inner, content_type: 'application/rss+xml', http_code: 200 } }); }
      if (/test\.cors\.workers\.dev/.test(u)) { log && log.push('!!DEAD-PROXY-corsworkers:'+u); return route.fulfill({ status:429, contentType:'text/plain', body:'error code: 1015' }); }
      if (/corsproxy\.io/.test(u)) { log && log.push('!!DEAD-PROXY-corsproxy:'+u); return json(route, { error:'A valid API key is required.' }, 401); }
      if (/allorigins/.test(u)) { log && log.push('!!DEAD-PROXY-allorigins-raw:'+u); return route.fulfill({ status:408, contentType:'text/plain', headers:{'access-control-allow-origin':'*'}, body:'Request Timeout' }); }
      if (/codetabs/.test(u)) { log && log.push('!!DEAD-PROXY-codetabs:'+u); return route.abort('timedout'); }
      if (/min-api\.cryptocompare\.com/.test(u)) { log && log.push('!!DEAD-CRYPTOCOMPARE:'+u); return json(route, { Response:'Error', Message:'no subscription' }, 401); }
      if (/reddit\.com/.test(u)) { log && log.push('!!DEAD-REDDIT:'+u); return route.fulfill({ status:403, body:'blocked' }); }
      // Mirrors the live deploys exactly: every /api host answers HTTP 200 text/html with the
      // SPA index shell, not news. A 404 could never exercise the client's "200 but wrong
      // content-type" path, which is where 7.78 MB of the live run went.
      if (/dexladder\.com\/api|netlify\.app\/api|pages\.dev\/api/.test(u))
        return route.fulfill({ status:200, contentType:'text/html; charset=utf-8',
          headers:{'access-control-allow-origin':'*'}, body:'<!doctype html><html><body>'+'x'.repeat(200000)+'</body></html>' });
      if (/text\.pollinations\.ai/.test(u)) return text(route, 'Relay answer (fixture).');
      if (/google\.com\/s2\/favicons|fonts\.|tradingview\.com|qrserver|geojs\.io/.test(u)) return route.abort();
      log && log.push('??UNMOCKED:'+u);
      return route.abort();
    } catch (e) { return route.abort(); }
  });
}

async function launch(indexPath, opts){
  opts = opts || {};
  const dir = path.dirname(path.resolve(indexPath));
  const { srv, port } = await serve(dir);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [], consoleErr = [], net = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  page.on('console', m => { if (m.type() === 'error') consoleErr.push(m.text()); });
  await mockNetwork(page, net);
  await page.goto(`http://127.0.0.1:${port}/${path.basename(indexPath)}`, { waitUntil: 'load' });
  return { browser, page, errors, consoleErr, net, close: async () => { await browser.close(); srv.close(); } };
}
module.exports = { launch };

if (require.main === module) {
  (async () => {
    const file = process.argv[2];
    const h = await launch(file);
    await h.page.waitForTimeout(4000);
    const info = await h.page.evaluate(() => ({ title: document.title, rows: document.querySelectorAll('table.mx-table tbody tr').length, build: (document.getElementById('cbBuildTag')||{}).textContent, mode: (window.S||{}).mode, coins: (window.MXP && MXP.state.coins.length) }));
    console.log('info', info);
    console.log('pageerrors', h.errors.length, h.errors.slice(0,5));
    console.log('console errors', h.consoleErr.length, h.consoleErr.slice(0,5));
    console.log('net', h.net.length, 'dead:', h.net.filter(x=>x.startsWith('!!')).slice(0,10), 'unmocked:', h.net.filter(x=>x.startsWith('??')).slice(0,10));
    await h.close();
  })().catch(e => { console.error(e); process.exit(1); });
}
