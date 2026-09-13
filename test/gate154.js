// v154 gate — every layer adds asserts here. Exit code = number of failures.
'use strict';
const { launch } = require('./harness');
const CG = require('./gate-contrast');
const SWS = require('./swscenarios');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const file = process.argv[2] || 'dist/index.html';
const only = process.argv[3] || '';
const results = [];
function ok(name, cond, detail) { results.push({ name, ok: !!cond, detail }); if (!cond) console.log('  ✗', name, detail || ''); else console.log('  ✓', name); }

(async () => {
  const h = await launch(file);
  const { page } = h;
  await page.waitForTimeout(4500);
  const ev = (fn, ...a) => page.evaluate(fn, ...a);

  console.log('== baseline');
  ok('no page errors after boot', h.errors.length === 0, h.errors.slice(0, 3).join(' | '));
  // v155-G defect 6. The stamp bottom-left, the What's-New banner and the dl.seen key were
  // three separate literals typed into three separate patches, so the payload could ship as
  // v155f with all three still reading v154 — which is exactly what the owner saw. They are
  // derived from build154.py's RELEASE dict now; this asserts the thing a USER can check:
  // the stamp they read IS the build the document declares.
  const stamp = await ev(() => ({
    tag: ((document.getElementById('cbBuildTag') || {}).textContent || '').trim(),
    meta: (document.querySelector('meta[name="cb:build"]') || {}).content || '',
    banner: (document.getElementById('dlNew') || {}).textContent || '',
    seen: (function () { try { return (typeof NEWS !== 'undefined' && NEWS[0] && NEWS[0][0]) || ''; } catch (e) { return ''; } })(),
    seenKey: (function () { try { return String(window.__wnSeenSrc || ''); } catch (e) { return ''; } })()
  }));
  ok('the visible build stamp IS <meta name="cb:build">, not a literal that can drift',
    !!stamp.meta && stamp.tag.split(' ')[0] === stamp.meta, JSON.stringify(stamp));
  ok("and the What's-New banner names the same build as the meta tag",
    stamp.banner.includes(stamp.meta) &&
    (!stamp.seen || String(stamp.seen).split(' ')[0] === stamp.meta), JSON.stringify(stamp));
  ok('MX 500 coins loaded', (await ev(() => window.MXP && MXP.state.coins.length)) === 500);
  ok('DLBX live', (await ev(() => DLBX.status().state)) === 'live');
  ok('legacy mounts present', await ev(() => ['dlCycle', 'dlHeat', 'dlSignals', 'dlIntelCard', 'mxSubnav', 'cbCmd', 'sv82-chip'].every(i => document.getElementById(i))));
  // v159 · the Markets record strip was removed on the owner's call. It is CUT, not hidden:
  // no element, no painter, no third /global fetch — and the two things that hung off it
  // (the trust line and the Journey host) still open the Markets section.
  ok('v159 · the record strip is gone from the document, the payload and the API',
    await ev(() => !document.getElementById('dlGstat')
      && document.querySelectorAll('.gs-i').length === 0
      && !(window.DLSNAP && DLSNAP.mountStrip)));
  // v159a · THE SNAPSHOT BOOTS ITSELF. This assert is first on purpose: it must read the
  // page as a visitor finds it, BEFORE anything below calls cycle(), pulse() or repaint().
  // v159 removed #dlGstat, and mountStrip() — the strip's painter — turned out to be the
  // only thing in the whole app that ever called cycle() on a cold load. Every market figure
  // downstream of DLSNAP then rendered "Unavailable · derived · no data · stale" against
  // feeds that were live and answering. The old gate missed it because the gate itself woke
  // the snapshot up a few hundred lines later, and then measured it. Never again.
  const snapBoot = await ev(() => {
    const c = window.DLSNAP && DLSNAP.current;
    const u = c && c.universes || {};
    const bar = document.getElementById('cbMcap');
    return {
      current: !!c,
      // marketCap is a FIELD object ({value, source, freshness, witnesses…}), not a number —
      // reading it as one is how this assert first "failed" against a snapshot that was fine
      tracked: (u.tracked && u.tracked.marketCap && u.tracked.marketCap.value) || null,
      global: (u.global && u.global.marketCap && u.global.marketCap.value) || null,
      barText: bar ? (bar.innerText || '').trim().slice(0, 40) : null,
      coins: (typeof window.coins !== 'undefined' && window.coins) ? window.coins.length : 0
    };
  });
  ok('v159a · the snapshot has cycled by itself, with nobody asking — a cold visitor sees figures',
    snapBoot.current && (snapBoot.tracked > 0 || snapBoot.global > 0), JSON.stringify(snapBoot));
  ok('v159a · and the command bar states one of them rather than the word Unavailable',
    !!snapBoot.barText && !/unavailable/i.test(snapBoot.barText), JSON.stringify(snapBoot));
  ok('v159a · the starter is in the payload and is not the removed strip',
    await ev(() => {
      // the painter itself is gone (checked on the API, not on the text — the layer's
      // comment names it, and a grep for the word would pass on the explanation alone)
      const s = document.documentElement.outerHTML;
      return !(window.DLSNAP && DLSNAP.mountStrip) && /S\.start\(\)/.test(s);
    }));

  ok('v159 · and nothing that hung off it went with it — the trust line and the Journey host still open Markets',
    await ev(() => {
      const w = document.querySelector('#page-markets .wrap.section');
      const u = document.getElementById('dlUpd'), j = document.getElementById('dlJourneyHost');
      return !!(w && u && j && w.contains(u) && w.contains(j) && /updated|Waiting/i.test(u.innerText || ''));
    }));

  console.log('== 10-feeds');
  ok('fetch wrapper installed before DLLIFE', await ev(() => !!window.fetch.__dlFeeds || !!(window.DLLIFE)));
  ok('Coinlore rung installed at srcs[2]', await ev(() => CBDATA._i.srcs[2].__coinlore === 1));
  const rung = await ev(() => DLFEEDS._src().then(l => ({ n: l.length, first: l[0] && l[0].sym, hist: l[0] && l[0].hist.length })).catch(e => ({ err: String(e) })));
  ok('Coinlore rung returns 30 shaped coins', rung.n === 30 && rung.first === 'BTC' && rung.hist >= 100, JSON.stringify(rung));
  const bn = await ev(() => fetch('https://api.binance.com/api/v3/ticker/price?symbols=%5B%22BTCUSDT%22%5D').then(r => r.json()).then(j => j.length).catch(e => 'ERR ' + e));
  ok('Binance host rewritten to data-api.binance.vision', bn === 2 && !h.net.some(x => x.startsWith('!!BINANCE')), String(bn));
  const cc = await ev(() => fetch('https://min-api.cryptocompare.com/data/pricemulti?fsyms=BTC,ETH&tsyms=USD').then(r => r.json()).catch(e => 'ERR'));
  ok('CryptoCompare pricemulti shim → Coinlore prices', cc && cc.BTC && cc.BTC.USD > 1000, JSON.stringify(cc));
  const hist = await ev(() => fetch('https://min-api.cryptocompare.com/data/v2/histohour?fsym=BTC&tsym=USD&limit=100').then(r => r.json()).then(j => j.Data.Data.length).catch(e => 'ERR'));
  ok('CryptoCompare histohour shim → Kraken OHLC (≥21 candles)', hist >= 21, String(hist));
  const q = await ev(async () => { await quorumCheck(true); openQuorum(); const t = document.getElementById('modalRoot').innerText || ''; const s = JSON.parse(JSON.stringify(QUOR.src)); closeModal(); return { s, hasCoinlore: t.includes('Coinlore'), hasCC: t.includes('CryptoCompare') }; });
  ok('price-consensus witness is Coinlore (label + data)', q.s.cryptocompare === true && q.hasCoinlore && !q.hasCC, JSON.stringify(q));
  const rd = await ev(() => fetch('https://www.reddit.com/r/CryptoCurrency/hot.json?limit=8&raw_json=1').then(r => r.json()).then(j => j.data.children.map(c => c.data)).catch(e => 'ERR'));
  ok('Reddit shim → Attention items from Wikipedia', Array.isArray(rd) && rd.length > 0 && /page views/.test(rd[0].e) && /^https:\/\/en\.wikipedia/.test(rd[0].permalink), JSON.stringify(rd && rd[0]));
  const blk = await ev(() => fetchCC().then(l => ({ n: l.length, src: l[0] && l[0].source })).catch(e => ({ err: String(e) })));
  ok('fetchCC now serves The Block RSS', blk.n > 0 && blk.src === 'The Block', JSON.stringify(blk));
  await ev(() => nav('news'));
  await page.waitForTimeout(3500);
  const news = await ev(() => ({ att: document.body.innerText.includes('Attention pulse'), posts: document.querySelectorAll('.nxd-post').length, postTxt: (document.querySelector('.nxd-post') || {}).innerText || '', block: document.body.innerText.includes('The Block') }));
  ok('News desk renders Attention pulse row', news.att && news.posts > 0 && /page views/.test(news.postTxt), JSON.stringify(news));
  ok('no dead CryptoCompare/Reddit network calls reached the wire', !h.net.some(x => x.startsWith('!!DEAD')), h.net.filter(x => x.startsWith('!!DEAD')).join(','));
  ok('no page errors after feeds checks', h.errors.length === 0, h.errors.slice(0, 3).join(' | '));

  // ---------------------------------------------------------------- 11-newsfeed
  // THE PIN for the owner's 12 Sep 2026 report: "the latest news on top categorised is
  // not loading". On live v156 the desk had no working transport at all — /api/news
  // answers with the SPA shell, corsproxy.io wants a key, allorigins 500s and codetabs
  // 522s — so fetchFeed returned [] for every FEED, loadNews took its !all.length branch
  // and renderNewsFallback BLANKED #frontPkg and #newsSections. These asserts fail if the
  // categorised front page is ever empty again on a payload whose bridges answer, and
  // harness.js now mocks the three old proxies with the status codes they really return.
  console.log('== 11-newsfeed');
  ok('the legacy PROXIES path is retired in favour of the health-tracked ladder',
    await ev(() => (typeof PROXIES !== 'undefined' ? PROXIES.length : -1)) === 0
      && (await ev(() => DLNEWSX.status().legacyRetired)) >= 1,
    JSON.stringify(await ev(() => ({ n: typeof PROXIES !== 'undefined' ? PROXIES.length : -1, retired: DLNEWSX.status().legacyRetired }))));
  ok('fetchFeed is wrapped by the ladder, outside DLRX\'s server-first pull',
    await ev(() => window.fetchFeed.__dlNewsx === 1));
  const lad = await ev(() => DLNEWSX.fetch(FEEDS[0]).then(l => ({
    n: l.length, want: FEEDS[0].name, src: l[0] && l[0].source, link: l[0] && l[0].link,
    t: l[0] && l[0].t, titled: l.every(a => !!a.title && !!a.link),
    dated: l.every(a => a.t > Date.now() - 30 * 864e5 && a.t <= Date.now() + 6e5)
  })).catch(e => ({ err: String(e) })));
  ok('the ladder returns shaped, titled, linked, sanely-dated items for a FEED',
    lad.n >= 4 && !!lad.src && lad.src === lad.want && lad.titled && lad.dated, JSON.stringify(lad));
  ok('a zoneless UTC pubDate is read as UTC, not as the viewer\'s local time',
    await ev(() => DLNEWSX.parseWhen('2026-09-11 21:30:00') === Date.UTC(2026, 8, 11, 21, 30, 0)),
    String(await ev(() => new Date(DLNEWSX.parseWhen('2026-09-11 21:30:00')).toISOString())));
  await ev(() => loadNews(true));
  await page.waitForTimeout(3500);
  const desk = await ev(() => {
    const g = id => document.getElementById(id);
    const bands = [...document.querySelectorAll('#newsSections .sec-head')].map(e => e.innerText.trim());
    return {
      cache: (typeof newsCache !== 'undefined') ? newsCache.length : -1,
      front: g('frontPkg') ? g('frontPkg').children.length : -1,
      lead: !!document.querySelector('#frontPkg h2, #frontPkg h3'),
      bands: bands,
      grid: g('newsGrid') ? g('newsGrid').querySelectorAll('a.card').length : -1,
      note: (g('newsNote') || {}).innerText || '',
      bridge: DLNEWSX.bridge()
    };
  });
  ok('the News desk loads live headlines into newsCache', desk.cache >= 8, JSON.stringify(desk).slice(0, 300));
  ok('the front package at the top of the desk is populated, not blanked',
    desk.front > 0 && desk.lead, JSON.stringify({ front: desk.front, lead: desk.lead }));
  ok('the categorised bands render — at least two of Markets/Policy/Tech/DeFi',
    desk.bands.length >= 2 && desk.bands.some(b => /Markets|Policy|Tech|DeFi/i.test(b)),
    JSON.stringify(desk.bands));
  ok('and the headline grid below them is filled', desk.grid >= 4, String(desk.grid));
  ok('the note says the headlines are live and names the bridge that served them',
    /live headlines/.test(desk.note) && !!desk.bridge && desk.note.includes(desk.bridge),
    JSON.stringify({ note: desk.note, bridge: desk.bridge }));
  ok('rss2json is asked for nothing its free tier refuses (no count= — that 422 was the 8/8 failure)',
    !h.net.some(x => x.startsWith('!!RSS2JSON-COUNT')) && h.net.some(x => /api\.rss2json\.com\/v1\/api\.json\?rss_url=/.test(x)) === (await ev(() => DLNEWSX.status().served.rss2json > 0)),
    h.net.filter(x => /rss2json/.test(x)).slice(0, 2).join(','));
  ok('the ladder carries the two bridges measured alive tonight (cors.lol, allorigins /get) ahead of the quota-bound ones',
    await ev(() => { const r = DLNEWSX.rungs(); return r.length === 6 && r.indexOf('corslol') < r.indexOf('corsworkers') && r.indexOf('allorigins') < r.indexOf('corsworkers') && r.includes('rss2json'); }),
    JSON.stringify(await ev(() => DLNEWSX.rungs())));
  ok('no request reached a bridge that is known dead',
    !h.net.some(x => x.startsWith('!!DEAD-PROXY')), h.net.filter(x => x.startsWith('!!DEAD-PROXY')).slice(0, 2).join(','));
  // Health memory: with every bridge refused, a rung must be benched rather than retried
  // in a loop, and the desk must not claim live headlines it does not have.
  await page.route(/rss2json|cors\.workers\.dev|cors\.lol|allorigins/, r => r.abort());
  const dead = await ev(async () => {
    DLNEWSX.reset();
    const l = await DLNEWSX.fetch(FEEDS[1]);
    return { n: l.length, health: DLNEWSX.health(), fails: DLNEWSX.status().fails, rungs: DLNEWSX.rungs() };
  });
  ok('with every bridge refused the ladder gives up empty instead of hanging',
    dead.n === 0, JSON.stringify(dead).slice(0, 240));
  ok('and each refusal is remembered, so a dead bridge drops down the ladder',
    Object.keys(dead.health).length >= 2
      && Object.keys(dead.health).every(k => !!dead.health[k].fail)
      && dead.rungs.length === 6,
    JSON.stringify(dead.health));
  await page.unroute(/rss2json|cors\.workers\.dev|cors\.lol|allorigins/);
  await ev(() => { DLNEWSX.reset(); });
  ok('no page errors across the news-transport checks', h.errors.length === 0, h.errors.slice(0, 3).join(' | '));


  const sheetTxt = async (openJs, id, wait) => { const r = await ev(async ([js, id, w]) => { try { (new Function(js))(); await new Promise(r => setTimeout(r, w || 900)); const el = document.getElementById(id); const t = el ? el.innerText : 'NO EL'; const rows = el ? el.querySelectorAll('.dl-row,tr,.kv').length : 0; const on = !!(el && el.classList.contains('on')); DLCORE.close(id); return { t, rows, on }; } catch (e) { return { err: String(e) } } }, [openJs, id, wait]); return r; };
  await ev(() => nav('markets'));
  await page.waitForTimeout(2500);

  console.log('== 20-core');
  ok('DLCORE present with S.v154 bucket', await ev(() => !!(window.DLCORE && DLCORE.X() === S.v154 && S.v154.xp)));
  ok('_savePayload persists dlsim/jnotes/v154 (latent v153 bug)', await ev(() => { S.jnotes = S.jnotes || {}; S.jnotes.__gate = 'x'; const p = _savePayload(); return !!(p.x && p.x.v === 154 && p.x.jnotes && p.x.jnotes.__gate === 'x' && 'dlsim' in p.x); }));
  const jg = await ev(() => DLCORE.jget('https://api.coingecko.com/api/v3/global', { key: 'gate.global', ttl: 60000 }).then(r => ({ ok: !!r.data, src: r.src, cached: r.cached })).then(async a => { const b = await DLCORE.jget('https://api.coingecko.com/api/v3/global', { key: 'gate.global', ttl: 60000 }); return { a, b: { cached: b.cached } }; }));
  ok('jget fetches then serves from cache', jg.a.ok && jg.b.cached === true, JSON.stringify(jg));
  ok('day/night formatters sane', await ev(() => DLCORE.money(1234.5) === '$1,235' && DLCORE.big(2.5e9) === '2.50B' && DLCORE.pct(-1.234) === '-1.23%'));

  console.log('== 30-rungs');
  ok('Rungs rail mounted before MX controls', await ev(() => { const r = document.getElementById('dlRungRail'); return !!r && r.querySelectorAll('.dl-chip').length >= 8; }));
  const rg = await ev(() => { const r = DLRUNGS.create('Gate rung', ['BTC', 'ETH', 'SOL']); DLRUNGS.apply(r.id); const n = MXP.state.filter; const set = DLRUNGS.activeSet().size; DLRUNGS.apply(null); DLRUNGS.remove(r.id); return { n, set, left: DLRUNGS.list().some(x => x.name === 'Gate rung') }; });
  ok('create/apply/remove a rung filters the table', rg.n === 'rung' && rg.set === 3 && !rg.left, JSON.stringify(rg));
  const sh = await ev(async () => { const r = DLRUNGS.create('Share me', ['BTC', 'ETH']); const link = await DLRUNGS.share(r.id); const b = link.split('#/rung/')[1]; const pack = JSON.parse(decodeURIComponent(escape(atob(b.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - b.length % 4) % 4))))); const v = await DLRUNGS.verify(pack); DLRUNGS.remove(r.id); return { link: /#\/rung\//.test(link), ok: v && v.ok, syms: pack.p.syms.length }; });
  ok('signed share link verifies (secp256k1)', sh.link && sh.ok && sh.syms === 2, JSON.stringify(sh));
  ok('curated Oversold rung uses RSI', await ev(() => { DLRUNGS.apply('cur.oversold'); const n = DLRUNGS.activeSet().size; DLRUNGS.apply(null); return n >= 0 && MXP.state.filter === 'all'; }));

  console.log('== 31-sectors');
  const sec = await sheetTxt("DLSECTORS.open()", 'dlSectors', 1500);
  ok('Sectors sheet lists categories with relative strength', sec.rows >= 5 && /Layer 1|DeFi|Meme/.test(sec.t), JSON.stringify(sec).slice(0, 200));
  ok('Narrative ribbon mounted', await ev(() => !!document.getElementById('dlNarr')));

  console.log('== 32-radar');
  const rad = await sheetTxt("DLRADAR.open('trend')", 'dlRadar', 1800);
  ok('Pool Radar opens with trending pools (Pool Radar, never DexScan)', rad.rows >= 3 && /Pool Radar/.test(rad.t), JSON.stringify(rad).slice(0, 200));
  ok('no "DexScan" left in the UI copy', await ev(() => !document.body.innerText.includes('DexScan')));
  const amm = await ev(() => { const pool = { name: 'GATE/WETH', liq: 100000, price: 1 }; const q = DLRADAR.quote(pool, 'buy', 1000); return { eff: q && q.eff, slip: q && q.slip, qty: q && q.qty }; });
  ok('AMM quote applies x·y=k slippage', amm.eff > 1 && amm.slip > 0 && amm.qty > 0, JSON.stringify(amm));
  const secv = await ev(() => DLRADAR.security('eth', '0x' + 'a'.repeat(40)).then(s => DLRADAR.verdict(s)));
  ok('GoPlus scan → verdict', secv && typeof secv.risk === 'number' && secv.label, JSON.stringify(secv));

  console.log('== 33-weather');
  const wx = await ev(async () => { await DLWEATHER.load(true); const w = DLWEATHER.weather(); return { f: DLWEATHER.funding8h('BTC'), w: w.w, parts: w.parts.length, label: w.label, card: !!document.getElementById('dlWxCard') }; });
  ok('perps ladder loads funding + composite weather', wx.f != null && wx.parts >= 2 && wx.w >= 0 && wx.w <= 100 && wx.card, JSON.stringify(wx));
  ok('DLSIM funding prefers Weather', await ev(() => { const f = DLSIM.frate('BTC'); return f != null && Math.abs(f - DLWEATHER.funding8h('BTC')) < 1e-9; }));
  const cyc = await ev(() => DLWEATHER.cycle().then(c => ({ mayer: c && c.mayer, pi: c && c.pi != null })).catch(e => ({ err: String(e) })));
  ok('cycle dials compute from 365d history', cyc.mayer > 0, JSON.stringify(cyc));

  console.log('== 34-clock');
  const clk = await ev(() => DLCLOCK.load().then(() => ({ n: DLCLOCK.events().length, kinds: [...new Set(DLCLOCK.events().map(e => e.kind))], card: !!document.getElementById('dlClockCard') })));
  ok('Chain Clock has halving/retarget/expiry/reset events', clk.n >= 4 && clk.card, JSON.stringify(clk));

  console.log('== 35-forecast');
  const fc = await ev(() => { const k = DLFORECAST.cone('BTC', 7); const f = DLFORECAST.log('BTC', 7, k.lo1, k.hi1, 0.7); f.due = Date.now() - 1000; DLFORECAST.score(); const cal = DLFORECAST.calibration(); return { cone: k.lo1 < k.px && k.hi1 > k.px, scored: !!f.res, brier: f.res && f.res.brier, n: cal.n }; });
  ok('forecast cone + log + score (Brier)', fc.cone && fc.scored && fc.brier >= 0 && fc.n >= 1, JSON.stringify(fc));

  console.log('== 36-odds');
  const od = await ev(async () => { const r = await DLODDS.events(); const e = r.list[0], m = e.markets[0]; const c0 = DLODDS.book().cash; const p = DLODDS.buy(e, m, 'yes', 50); const c1 = DLODDS.book().cash; return { n: r.list.length, bought: !!p, spent: c0 - c1, pos: DLODDS.book().pos.length }; });
  ok('Odds: events load, paper buy debits the odds book', od.n >= 2 && od.bought && od.spent > 49 && od.pos >= 1, JSON.stringify(od));

  console.log('== 37-coinpage + 39b ledgers + DeXaI Read');
  await ev(() => openCoin('BTC'));
  await page.waitForTimeout(3500);
  const cp = await ev(() => ({ ids: ['dlCoinAI', 'dlForecast', 'dlDossier', 'dlSupply', 'dlVenues', 'dlWire', 'dlTreasury', 'dlHist', 'dlCsv'].filter(i => !document.getElementById(i)), dx: (document.getElementById('dlCoinAI') || {}).dataset && document.getElementById('dlCoinAI').dataset.dx, slots: document.querySelectorAll('#dlCoinAI .dx-slot').length, unsrc: document.querySelectorAll('#dlCoinAI .dx-unsrc').length, venues: document.querySelectorAll('#dlVenues tr').length, treasury: /Treasury|treasur/i.test((document.getElementById('dlTreasury') || {}).innerText || '') }));
  ok('coin page: every v154 card mounted for BTC', cp.ids.length === 0, 'missing ' + cp.ids.join(','));
  ok('DeXaI Read replaces the AI card with sourced slots, no unsourced numbers', cp.dx === 'BTC' && cp.slots >= 6 && cp.unsrc === 0, JSON.stringify(cp));
  ok('venue table rows', cp.venues >= 2, String(cp.venues));
  await ev(() => openCoin('SOL'));
  await page.waitForTimeout(2500);
  ok('cards re-render for a second coin', await ev(() => document.getElementById('dlCoinAI').dataset.dx === 'SOL' && document.getElementById('dlForecast').dataset.sym === 'SOL' && document.getElementById('dlSupply').dataset.sym === 'SOL' && !document.getElementById('dlTreasury')));

  console.log('== 38-sentinel');
  const sn = await ev(() => { const r1 = DLSENTINEL.compile('BTC moves 5% in an hour'); const r2 = DLSENTINEL.compile('USDT depegs'); const r3 = DLSENTINEL.compile('ETH above 4000 or SOL rsi under 30'); const r4 = DLSENTINEL.compile('DOGE volume doubles'); return { k1: r1[0] && r1[0].kind, dir1: r1[0] && r1[0].dir, k2: r2[0] && r2[0].kind, n3: r3.filter(x => !x.err).length, k4: r4[0] && r4[0].kind }; });
  ok('Sentinel compiles move/depeg/level/rsi/volume rules', sn.k1 === 'v154:move' && sn.dir1 === 0 && sn.k2 === 'v154:depeg' && sn.n3 === 2 && sn.k4 === 'v154:volspike', JSON.stringify(sn));
  const fire = await ev(() => { const r = DLSENTINEL.compile('USDT depegs by 0.1%')[0]; DLSENTINEL.arm([r]); bySym.USDT.price = 0.99; DLSENTINEL.evaluate(true); const hit = !!(S.alerts.find(a => a.id === r.id) || {}).hit; bySym.USDT.price = 1; S.alerts = S.alerts.filter(a => a.id !== r.id); return hit; });
  ok('depeg rule fires on evaluate', fire === true);

  console.log('== 39-desks');
  await ev(() => nav('markets'));
  await page.waitForTimeout(2500);
  const dk = await ev(() => Array.from(document.querySelectorAll('#dlDesksRail [data-desk]')).map(e => e.getAttribute('data-desk')));
  ok('Desks rail lists every desk', ['chains', 'venues', 'yield', 'convert', 'radar', 'odds', 'weather', 'sectors', 'clock', 'supply', 'era', 'baskets', 'coach', 'trust'].every(d => dk.includes(d)), dk.join(','));
  const ch = await sheetTxt("DLDESKS.chainLadder()", 'dlChains', 1500);
  ok('Chain Ladder rows', ch.rows >= 4, JSON.stringify(ch).slice(0, 160));
  const cv = await ev(async () => { DLDESKS.convert(); await new Promise(r => setTimeout(r, 1200)); const el = document.getElementById('dlConvert'); const t = el.innerText; DLCORE.close('dlConvert'); return /INR/.test(t); });
  ok('Convert desk renders INR', cv === true);

  console.log('== 39b-ledgers');
  const lg = await ev(async () => { DLLEDGERS.supRecord(); DLLEDGERS.eraRecord(); const b = DLLEDGERS.mkBasket('Gate', ['BTC', 'ETH', 'SOL'], 'eq'); const c0 = S.bal.USDT; DLLEDGERS.basketBuy(b, 300); const c1 = S.bal.USDT; DLLEDGERS.basketSell(b); const c2 = S.bal.USDT; const lens = document.querySelectorAll('#dlHeatLens .dl-chip').length; return { sup: Object.keys(DLLEDGERS.supStore().days).length, era: Object.keys(DLLEDGERS.eraStore().weeks).length, idx: DLLEDGERS.basketIndex(b), spent: c0 - c1, back: c2 > c1, lens }; });
  ok('Supply/Era recorded, basket buys/sells through the fill engine, heat lenses mounted', lg.sup >= 1 && lg.era >= 1 && Math.abs(lg.idx - 100) < 0.01 && lg.spent > 299 && lg.back && lg.lens === 3, JSON.stringify(lg));

  console.log('== 40-dexai');
  const dx = await ev(async () => { const out = {}; for (const q of ['Read SOL', 'market state', 'my book', 'what is funding?', 'what is 15% of 2400', 'show me top 10 gainers', 'alert me when BTC moves 5% in an hour', 'buy $100 of ETH', 'open portfolio']) { const a = await NXCHAT.answer(q); const d = document.createElement('div'); d.innerHTML = a ? a.html || '' : ''; out[q] = a ? { t: a.title, s: d.querySelectorAll('.dx-slot').length, u: d.querySelectorAll('.dx-unsrc').length, c: d.querySelectorAll('.dx-conf').length } : null; } return out; });
  ok('Read → sourced slots', dx['Read SOL'] && dx['Read SOL'].s >= 6 && dx['Read SOL'].u === 0, JSON.stringify(dx['Read SOL']));
  ok('market state → slots', dx['market state'] && dx['market state'].s >= 6, JSON.stringify(dx['market state']));
  ok('my book → ledger slots', dx['my book'] && dx['my book'].s >= 3);
  ok('learn → v154 KB entry', dx['what is funding?'] && dx['what is funding?'].t === 'Funding rate');
  ok('calc → arithmetic slot', dx['what is 15% of 2400'] && dx['what is 15% of 2400'].t === 'Arithmetic');
  ok('lens/alert/order → confirm cards, never silent actions', dx['show me top 10 gainers'].c === 1 && dx['alert me when BTC moves 5% in an hour'].c === 1 && dx['buy $100 of ETH'].c === 1, JSON.stringify([dx['show me top 10 gainers'], dx['alert me when BTC moves 5% in an hour'], dx['buy $100 of ETH']]));
  ok('nav intent routes before book', dx['open portfolio'] && dx['open portfolio'].t === 'Opening portfolio');
  const law = await ev(() => { const F = new DEXAI.Facts(); F.add('btc.price', 'BTC price', '$67,850', 'CoinGecko', Date.now(), 67850); return DEXAI.render('At {{btc.price}}, maybe $90,000 in 24h, up 12%.', F); });
  ok('numeric-slot law: invented numbers struck, units kept', law.unsrc === 2 && /24h/.test(law.html) && !/<s[^>]*>24/.test(law.html), law.html);
  const cf = await ev(async () => { const a = await NXCHAT.answer('buy $100 of ETH'); const id = (a.html.match(/DEXAI\.confirm\('(\w+)'\)/) || [])[1]; const b0 = S.bal.USDT; DEXAI.confirm(id); return { d: b0 - S.bal.USDT, tags: Object.keys(DEXAI.cfg().buys) }; });
  ok('confirmed paper order fills through execFill', cf.d > 99 && cf.d < 101, JSON.stringify(cf));
  const coach = await ev(() => { const c = bySym.SOL; c.c1 = 6; execFill('buy', 'SOL', 'USDT', 3000 / c.price, c.price, 'market', true); execFill('sell', 'SOL', 'USDT', S.bal.SOL, c.price * 0.98, 'market', true); const t = DEXAI.cfg().tags; const k = Object.keys(t)[0]; return { tags: k ? t[k] : null, fix: DEXAI.report().fix }; });
  ok('Coach tags chase + oversize on close and names one fix', coach.tags && coach.tags.includes('chase') && coach.tags.includes('oversize') && coach.fix.length > 20, JSON.stringify(coach));
  const panel = await ev(async () => { NXCHAT.open(); await new Promise(r => setTimeout(r, 500)); const p = document.getElementById('nxChat'); const r = { title: p.querySelector('.nxc-tt b').textContent, bar: !!document.getElementById('dxBar'), greet: /DeXaI/.test((p.querySelector('.nxc-m.a') || {}).innerText || ''), oracle: /Oracle/.test(p.innerText) }; NXCHAT.close(); return r; });
  ok('Desk panel is DeXaI (title, bar, greeting, no Oracle copy)', panel.title === 'DeXaI' && panel.bar && panel.greet && !panel.oracle, JSON.stringify(panel));
  ok('privacy Device-only blocks the open neural relay', await ev(() => fetch('https://text.pollinations.ai/x').then(r => r.status === 204)));
  const brief = await ev(async () => { dailyBrief(); await new Promise(r => setTimeout(r, 300)); const b = document.querySelector('#modalRoot .dx-brief'); const n = b ? b.querySelectorAll('.dx-slot').length : 0; closeModal(); return n; });
  ok('Daily Bridge carries a DeXaI read', brief >= 8, String(brief));
  await ev(() => nav('learn'));
  await page.waitForTimeout(1200);
  const tut = await ev(async () => { try { enterLesson(2); } catch (e) {} await new Promise(r => setTimeout(r, 700)); const t = document.getElementById('dxTutor'); const a = await NXCHAT.answer('why is that the answer?'); return { chips: t ? t.querySelectorAll('button').length : 0, why: a && a.title }; });
  ok('Tutor chips mount in a lesson and answer "why"', tut.chips === 4 && /Why/.test(tut.why || ''), JSON.stringify(tut));

  console.log('== 41-trust');
  const tr = await ev(async () => { DLTRUST.open('dexai'); await new Promise(r => setTimeout(r, 300)); const ov = document.getElementById('dlTrust'); const r = { title: ov.querySelector('#dltTitle').textContent, gw: !!document.getElementById('dxGw'), tabs: ov.querySelectorAll('#dltTabs button').length }; DLTRUST.open('sources'); await new Promise(r => setTimeout(r, 200)); r.sources = !!ov.querySelector('.v154-src'); r.cc = /CryptoCompare","https/.test(ov.innerHTML); DLTRUST.close(); return r; });
  ok('Trust Center gains DeXaI/Laws/Feeds/v154 pages + gateway field', tr.title === 'DexLadder · DeXaI' && tr.gw && tr.tabs === 14 && tr.sources, JSON.stringify(tr));
  ok('KB gained v154 entries', (await ev(() => ORACLE.KB.filter(e => e.v154).length)) >= 18);
  const gate = await ev(async () => { const x = DLCORE.X(); delete x.lvOk; DLSIM.open(); await new Promise(r => setTimeout(r, 300)); const shown = /Learn before you leverage/.test(document.getElementById('modalRoot').innerText); const b = document.getElementById('dlLvGo'); if (b) b.click(); await new Promise(r => setTimeout(r, 300)); return { shown, ok: !!DLCORE.X().lvOk }; });
  ok('learn-before-leverage primer shows once', gate.shown && gate.ok, JSON.stringify(gate));

  console.log('== display modes (Day + Night only)');
  const dm = await ev(async () => {
    const de = document.documentElement, out = {};
    const meta = () => [...document.querySelectorAll('meta[name="theme-color"]')].map(m => m.content);
    const cs = () => getComputedStyle(de).colorScheme;
    const tok = n => getComputedStyle(de).getPropertyValue(n).trim();
    const inlineAccent = () => ['--cyan', '--indigo', '--brand'].filter(n => de.style.getPropertyValue(n));
    // Contrast is no longer measured in the page. Writing a token into style.color and
    // reading it back is fail-open three ways: an undefined or non-colour token silently
    // inherits the body text colour and reports a flattering ratio, rgba() alpha is dropped,
    // and the ratio is rounded to 2dp before the >= comparison. Contrast is now recomputed
    // from the shipped artifact by test/gate-contrast.js. Tokens are still snapshotted here
    // so the static cascade resolution can be cross-checked against the live browser.
    const TOKENS = ['--ink', '--ink-2', '--muted', '--faint', '--up', '--down', '--bg', '--bg-solid', '--surface', '--surface-2', '--up-soft', '--down-soft'];
    const snapTokens = () => { const o = {}; TOKENS.forEach(n => { o[n] = tok(n) }); return o };

    DLMODE.set('dark', true); await new Promise(r => setTimeout(r, 80));
    out.night = { attr: de.getAttribute('data-mode'), scheme: cs(), meta: meta(), get: DLMODE.get(), accent: tok('--cyan'), t: snapTokens() };
    DLMODE.set('day', true); await new Promise(r => setTimeout(r, 80));
    out.day = { attr: de.getAttribute('data-mode'), scheme: cs(), meta: meta(), get: DLMODE.get(), accent: tok('--cyan'), t: snapTokens() };
    const selEl = document.querySelector('select');
    out.selectSchemeDay = selEl ? getComputedStyle(selEl).colorScheme : 'NO SELECT';
    DLMODE.set('dark', true); await new Promise(r => setTimeout(r, 60));
    out.selectSchemeNight = selEl ? getComputedStyle(selEl).colorScheme : 'NO SELECT';
    out.inlineAccent = inlineAccent();
    // toggle is a true two-state flip
    DLMODE.set('dark', true);
    const seq = []; for (let i = 0; i < 4; i++) { DLMODE.toggle(); seq.push(DLMODE.get()) }
    out.seq = seq.join(',');
    // every retired value falls back to Night
    out.fallback = ['cyber', 'grey', 'system', 'auto', '', null].map(v => { DLMODE.set(v, true); return DLMODE.get() }).join(',');
    // another tab switching mode repaints this one without a reload
    DLMODE.set('dark', true);
    localStorage.setItem('dl.mode', 'day');
    window.dispatchEvent(new StorageEvent('storage', { key: 'dl.mode', newValue: 'day' }));
    await new Promise(r => setTimeout(r, 80));
    out.crossTab = de.getAttribute('data-mode');
    // nothing left that offers another appearance axis
    DLMODE.set('dark', true); await new Promise(r => setTimeout(r, 60));
    const chipEl = document.getElementById('modeChip');
    out.chip = chipEl ? { txt: chipEl.textContent, aria: chipEl.getAttribute('aria-label'), title: chipEl.title } : { txt: 'NO CHIP' };
    out.menu = !!document.getElementById('dlModeMenu');
    DLMODE.toggle(); DLMODE.toggle(); await new Promise(r => setTimeout(r, 120));
    out.menuAfterClicks = !!document.getElementById('dlModeMenu');
    out.hcBtn = !!document.getElementById('dltHcBtn');
    out.contrastAttr = de.getAttribute('data-contrast');
    const vh = document.getElementById('vibes');
    out.vibes = vh ? { html: vh.innerHTML.length, shown: vh.offsetParent !== null } : { html: 0, shown: false };
    out.vibeInKit = /Vibe check/.test(document.body.innerHTML);
    let dead = 0; const walk = rs => { for (const r of rs) { if (r.selectorText && /\.cyber(?![\w-])|\[data-mode=(?:grey|cyber)\]|\[data-contrast=hi\]|\.dlmm-|#dlModeMenu(?![\w-])|#cbTheme(?![\w-])/.test(r.selectorText)) dead++; if (r.cssRules) walk(r.cssRules) } };
    for (const sh of document.styleSheets) { try { walk(sh.cssRules) } catch (e) {} }
    out.deadRules = dead;
    DLMODE.set('dark', true);
    return out;
  });
  ok('Night: no data-mode, color-scheme dark, its own theme-color', dm.night.attr === null && dm.night.scheme === 'dark' && dm.night.meta.join() === '#0B1220', JSON.stringify(dm.night));
  // v154g re-cast the warm-ivory Day skin to a cool hue; the engine's theme-color moved with
  // it (#FBF7F1 → #F5F7FB). Behaviour is intended (decisions.md D-09) — the expectation follows.
  ok('Day: data-mode=day, color-scheme light, its own theme-color', dm.day.attr === 'day' && dm.day.scheme === 'light' && dm.day.meta.join() === '#F5F7FB', JSON.stringify(dm.day));
  ok('exactly one theme-color meta, engine-driven', dm.night.meta.length === 1 && dm.day.meta.length === 1);
  ok('native form controls follow the theme (color-scheme inherited, not pinned)', dm.selectSchemeDay === 'light' && dm.selectSchemeNight === 'dark', JSON.stringify([dm.selectSchemeDay, dm.selectSchemeNight]));
  ok('accent comes from theme tokens — no inline override on <html>', dm.inlineAccent.length === 0 && dm.night.accent !== dm.day.accent, JSON.stringify([dm.inlineAccent, dm.night.accent, dm.day.accent]));
  ok('the chip is a true two-state toggle', dm.seq === 'day,dark,day,dark', dm.seq);
  ok('every retired mode value falls back to Night', dm.fallback === 'dark,dark,dark,dark,dark,dark', dm.fallback);
  ok('a mode change in another tab repaints this one', dm.crossTab === 'day', String(dm.crossTab));
  ok('chip names the action it performs', /Switch to Day/.test(dm.chip.aria || '') && /Night/.test(dm.chip.title || '') && dm.chip.txt === '☾', JSON.stringify(dm.chip));
  ok('no display-mode menu is ever built', !dm.menu && !dm.menuAfterClicks);
  ok('High contrast overlay is gone (no button, no data-contrast)', !dm.hcBtn && dm.contrastAttr === null);
  ok('Vibe accent cycler is gone (no dots, no kit row)', dm.vibes.html === 0 && !dm.vibes.shown && !dm.vibeInKit, JSON.stringify(dm.vibes));
  ok('no stylesheet rule targets a retired mode or control', dm.deadRules === 0, 'dead rules: ' + dm.deadRules);

  // ---- hard-coded foregrounds outside the token system -----------------------------------
  // The token gate proves every TOKEN clears AA. It cannot see a colour written straight into
  // a rule. In Night those literals sat on a dark panel and read; in Day zz-day-surfaces.js
  // retinted the panel under them to white and the literal stayed put, at ~1.4-2.2. The full
  // rendered-page sweep lives in test/gate-render-contrast.js; these asserts pin the specific
  // defects that pass found, so none of them can come back through this gate.
  console.log('== contrast: literals outside the token system');

  const lit = await ev(async () => {
    const de = document.documentElement, out = {};
    const src = document.documentElement.outerHTML;
    // the direction / semantic literals that used to be painted as foregrounds
    out.strandedLiterals = ['color:#3ae58f', 'color:#22d07e', 'color:#4be38f', 'color:#7cf5b2',
      'color:#00e676', 'color:#ff5252', 'color:#ffb300', 'color:#00e5ff', 'color:#eaf0fb',
      'color:#66788f'].filter(t => src.indexOf(t) > -1);
    out.faintDay = null;
    const ratio = (fg, bg) => {
      const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      const L = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
      const a = L(fg), b = L(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const rgb = s => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
    const seen = el => {
      // walk out to the first opaque backdrop, exactly as the render gate does
      let n = el;
      while (n) {
        const c = getComputedStyle(n).backgroundColor;
        const p = (c.match(/[\d.]+/g) || []).map(Number);
        if (p.length === 3 || (p.length === 4 && p[3] === 1)) return p.slice(0, 3);
        n = n.parentElement;
      }
      return [255, 255, 255];
    };

    DLMODE.set('day', true); await new Promise(r => setTimeout(r, 200));
    out.faintDay = getComputedStyle(de).getPropertyValue('--faint').trim();
    out.txt3Day = getComputedStyle(de).getPropertyValue('--txt-3').trim();
    // the source avatar chip must keep its brand tint in Day, or its white initial is stranded
    const sl = document.querySelector('.slogo');
    out.slogoDayBg = sl ? getComputedStyle(sl).backgroundColor : 'none';
    out.slogoDayRatio = sl ? ratio([255, 255, 255], seen(sl)) : 0;
    // the build watermark is inline-styled, so no sweep can reach it
    const bt = document.getElementById('cbBuildTag');
    out.buildTag = bt ? getComputedStyle(bt).color : 'none';
    // the accent-on-a-tint-of-itself family must be mixed toward ink in Day
    const tag = document.querySelector('.nx-tv-tag');
    out.tagDay = tag ? ratio(rgb(getComputedStyle(tag).color), seen(tag)) : null;

    DLMODE.set('dark', true); await new Promise(r => setTimeout(r, 200));
    out.slogoNightRatio = sl ? ratio([255, 255, 255], seen(sl)) : 0;
    out.faintNight = getComputedStyle(de).getPropertyValue('--faint').trim();
    return out;
  });

  ok('no direction or neutral literal is painted as a foreground any more',
    lit.strandedLiterals.length === 0, 'still shipping: ' + lit.strandedLiterals.join(', '));
  ok('the Day faint/txt-3 tokens carry the darkened value that clears a tinted panel',
    lit.faintDay === '#5C687D' && lit.txt3Day === '#5C687D', JSON.stringify([lit.faintDay, lit.txt3Day]));
  ok('Night faint is untouched by the Day correction', lit.faintNight === '#9098A4', lit.faintNight);
  ok('the source avatar keeps its brand tint in Day, so its white initial stays legible',
    lit.slogoDayRatio >= 4.5 && lit.slogoNightRatio >= 4.5,
    JSON.stringify([lit.slogoDayBg, lit.slogoDayRatio, lit.slogoNightRatio]));
  ok('the inline-styled build watermark is legible on its own plate in Day',
    lit.buildTag === 'rgb(166, 174, 185)', lit.buildTag);
  ok('accent text on a tint of itself is mixed toward ink in Day',
    lit.tagDay === null || lit.tagDay >= 4.5, String(lit.tagDay));
  ok('no retired mode is named anywhere in the UI', await ev(() => !/Cybernetic|Warm Dark|Ember dusk|Neon strings|High contrast|Vibe check/.test(document.body.innerText)));

  console.log('== contrast · recomputed from the shipped artifact (gate-contrast.js)');
  // Control (a) — canaries. One planted pass and one planted failure travel the same code
  // path as every real assertion. If the checker cannot see the planted failure, nothing it
  // says about this build is evidence, so the run is abandoned rather than reported.
  const can = CG.runCanaries();
  if (can.passes !== 1 || can.fails !== 1 || !can.gradientRaised || !can.missingRaised) {
    console.error('  \u2717\u2717 CANARY FAULT: expected 1 planted pass + 1 planted failure, got ' +
      can.passes + '/' + can.fails + '; non-colour tokens raise: gradient=' + can.gradientRaised +
      ' undefined=' + can.missingRaised);
    console.error('     The contrast checker cannot detect a planted failure. Refusing to report a pass.');
    await h.close(); process.exit(99);
  }
  ok('contrast canaries: exactly one planted pass and one planted failure',
    can.passes === 1 && can.fails === 1, JSON.stringify(can.results.map(r => r.token + '=' + r.ratio.toFixed(4))));
  ok('contrast canaries: a non-colour or undefined token raises instead of substituting',
    can.gradientRaised && can.missingRaised);

  // Control (b) — recompute from artifact. Two independent reads and parses of the shipped
  // file. No assertion may quote a remembered number; every ratio must reproduce exactly.
  const cgA = CG.computePass(file), cgB = CG.computePass(file);
  ok('contrast: the artifact is byte-identical across both recomputes', cgA.sha === cgB.sha, cgA.sha.slice(0, 16));
  const cgIdx = {}; cgB.rows.forEach(r => { cgIdx[r.id] = r });
  const cgDrift = cgA.rows.filter(r => !cgIdx[r.id] || !Object.is(r.ratio, cgIdx[r.id].ratio) || r.pass !== cgIdx[r.id].pass);
  ok('contrast: every ratio reproduces from a second independent read of the artifact',
    cgDrift.length === 0, cgDrift.map(r => r.id).join(', '));
  ok('contrast: no token is declared by a source the checker would have to skip',
    cgA.problems.length === 0, JSON.stringify(cgA.problems.slice(0, 3)));

  // Control (c) — the static cascade resolution must equal what the browser actually computes.
  const cgLive = { night: dm.night.t, day: dm.day.t };
  const cgMismatch = [];
  for (const mode of ['night', 'day']) {
    for (const n of Object.keys(cgLive[mode])) {
      const w = cgA.winners[mode][n];
      const fromArtifact = w ? String(w.value).replace(/\s+/g, '').toLowerCase() : '';
      const fromBrowser = String(cgLive[mode][n]).replace(/\s+/g, '').toLowerCase();
      if (fromArtifact !== fromBrowser) cgMismatch.push(mode + ' ' + n + ': artifact=' + fromArtifact + ' browser=' + fromBrowser);
    }
  }
  ok('contrast: the artifact cascade resolves to exactly what the browser computes',
    cgMismatch.length === 0, cgMismatch.slice(0, 4).join(' | '));

  // Every token x surface x mode pair, asserted individually and named in full.
  for (const r of cgA.rows) {
    if (!r.normative) continue;
    ok('contrast ' + r.mode + ': ' + r.token + ' on ' + r.surface + ' >= ' + r.threshold.toFixed(1),
      r.pass, r.error ? 'ERROR ' + r.error
        : r.tokenValue + ' on ' + r.surfaceValue + ' = ' + (Math.round(r.ratio * 100) / 100).toFixed(2));
  }

  // ================================================================ v155-C · one canonical snapshot
  // Audit finding 1: six surfaces each fetched or derived their own market cap, 24h volume and
  // BTC dominance, over three different universes at four different instants, through six
  // mutually unaware caches, with nothing recording which universe or which instant a number
  // came from. These three families are the guards against that coming back. Each was watched
  // failing against the pre-fix build before being written here.
  const SRC = require('fs').readFileSync(file, 'utf8');
  // These guards must REPORT a failure on a payload that has no snapshot, not crash the run.
  const evq = async (fn, ...a) => { try { return await ev(fn, ...a); } catch (e) { return null; } };
  await ev(() => nav('markets'));
  await page.waitForTimeout(2500);
  await ev(async () => { if (window.DLSNAP) { await DLSNAP.cycle(true); await new Promise(r => setTimeout(r, 1200)); } });

  console.log('== v155-C · A · at most one producer writes each canonical figure');
  ok('the snapshot layer is mounted and has published one record',
    await ev(() => !!(window.DLSNAP && DLSNAP.__v === 155 && DLSNAP.current && DLSNAP.current.id && DLSNAP.current.digest)),
    await ev(() => window.DLSNAP ? String(DLSNAP.current && DLSNAP.current.id) : 'NO DLSNAP'));
  ok('no surface derives its own market-cap aggregate any more',
    (SRC.match(/reduce\(\(\s*s\s*,\s*[a-z]\s*\)\s*=>\s*s\s*\+\s*\(\s*[a-z]\.mcap\s*\|\|\s*0\s*\),\s*0\)/g) || []).length === 0,
    (SRC.match(/reduce\(\(\s*s\s*,\s*[a-z]\s*\)\s*=>\s*s\s*\+\s*\(\s*[a-z]\.mcap\s*\|\|\s*0\s*\),\s*0\)/g) || []).join(' | '));
  ok('every whole-market /global call site is guarded by the snapshot',
    /if\(window\.DLSNAP\)return DLSNAP\.fill\(G\)/.test(SRC)
      && /window\.DLSNAP\?DLSNAP\.pulse\(\)/.test(SRC)
      && !/DLSNAP\.mountStrip/.test(SRC)
      && /if\(window\.DLSNAP\)return DLSNAP\.answerGlobal\(\);/.test(SRC));
  const one = (await evq(() => {
    const S = DLSNAP.current;
    const num = t => { const m = String(t || '').match(/\$\s?([\d.]+)\s?([TBM])/); return m ? +m[1] * ({ T: 1e12, B: 1e9, M: 1e6 })[m[2]] : null; };
    const T = id => { const n = document.getElementById(id); return n ? n.innerText : ''; };
    const gi = [...document.querySelectorAll('#gstatsIn .gi')].find(e => /Market Cap/.test(e.textContent));
    return {
      global: S.universes.global.marketCap.value,
      tracked: S.universes.tracked.marketCap.value,
      hero: num(T('g-mcap')),
      gi: gi ? num(gi.textContent) : null,
      cb: num(T('cbMcap')),
      mx: num(DLSNAP.mxPanel().replace(/<[^>]+>/g, ' ').match(/Market cap\s*\$[\d.]+\s?[TBM]/) || '')
    };
  })) || {};
  const near = (a, b) => a != null && b != null && Math.abs(a - b) / b < 0.01;
  ok('the whole-market surfaces all read universes.global.marketCap',
    near(one.hero, one.global), JSON.stringify(one));
  ok('the tracked surfaces all read universes.tracked.marketCap',
    near(one.gi, one.tracked) && near(one.cb, one.tracked) && near(one.mx, one.tracked), JSON.stringify(one));
  // The shipped defect exactly: the hero summed WITH the USDT row and the .gi strip summed
  // WITHOUT it, so two figures differed while both were labelled just "market cap". Two
  // surfaces may now differ only if they name different universes.
  const uni = (await evq(() => {
    const num = t => { const m = String(t || '').match(/\$\s?([\d.]+)\s?([TBM])/); return m ? +m[1] * ({ T: 1e12, B: 1e9, M: 1e6 })[m[2]] : null; };
    const lab = el => { const u = el && el.querySelector ? el.querySelector('.gs-u') : null; return u ? u.textContent.trim().toLowerCase() : ''; };
    const gi = [...document.querySelectorAll('#gstatsIn .gi')].find(e => /Market Cap/.test(e.textContent)) || null;
    const heroHost = document.getElementById('g-mcap') ? document.getElementById('g-mcap').closest('.stat-strip') : null;
    return [
      { id: 'hero', v: num((document.getElementById('g-mcap') || {}).textContent), u: lab(heroHost) },
      { id: 'gi', v: gi ? num(gi.textContent) : null, u: lab(gi) },
      { id: 'cmdbar', v: num((document.getElementById('cbMcap') || {}).innerText), u: lab(document.getElementById('cbMcap')) }
    ].filter(x => x.v != null);
  })) || [];
  const clash = [];
  for (let i = 0; i < uni.length; i++) for (let j = i + 1; j < uni.length; j++) {
    const a = uni[i], b = uni[j], same = Math.abs(a.v - b.v) / b.v < 0.01;
    if (!same && (a.u === b.u)) clash.push(a.id + '(' + a.u + ')/' + b.id + '(' + b.u + ')');
    if (same === false && (!a.u || !b.u)) clash.push(a.id + '/' + b.id + ' unlabelled');
  }
  ok('two market-cap figures may differ only if they name different universes',
    uni.length >= 3 && clash.length === 0, JSON.stringify({ uni, clash }));
  ok('the tracked universe is a separately named metric, not a second answer to one question',
    one.tracked !== one.global && typeof one.tracked === 'number'
      && await evq(() => DLSNAP.current.universes.tracked.membership.count > 0
        && typeof DLSNAP.current.universes.tracked.membership.includesStablecoins === 'boolean'
        && DLSNAP.current.universes.global.label !== DLSNAP.current.universes.tracked.label),
    JSON.stringify(one));

  console.log('== v155-C · B · every displayed figure carries provenance AND names its universe');
  const prov = (await evq(() => {
    const hosts = [
      ['hero', (document.getElementById('g-mcap') || {}).closest ? document.getElementById('g-mcap').closest('.stat-strip') : null],
      ['gi-strip', document.getElementById('gstatsIn')],
      ['command-bar', document.getElementById('cbMcap') ? document.getElementById('cbMcap').parentNode : null],
      ['tape', document.getElementById('tapeTrack')]
    ];
    return hosts.filter(h => h[1]).map(([id, host]) => ({
      id,
      // textContent, not innerText: v155-G stops two bars stating the same figure AT ONCE,
      // so a canonical surface may be the one that is not currently shown. It must still
      // carry the figure, its universe label and its provenance chip — the reader is one
      // click or one route away from it, and this is what asserts it is intact there.
      hasNumber: /\$\s?[\d.]+\s?[TBM]/.test(host.textContent || ''),
      hasProv: !!host.querySelector('.dl-prov'),
      hasUniverse: !!host.querySelector('.gs-u') || /Whole crypto market|Tracked set|whole market/i.test(host.textContent || '')
    }));
  })) || [];
  ok('every canonical surface showing a figure carries a .dl-prov source+freshness chip',
    prov.length >= 4 && prov.filter(p => p.hasNumber).length >= 4 && prov.filter(p => p.hasNumber).every(p => p.hasProv),
    JSON.stringify(prov));
  ok('every canonical surface showing a figure names the universe it measured',
    prov.filter(p => p.hasNumber).every(p => p.hasUniverse), JSON.stringify(prov));
  ok('freshness is one of exactly three states, on every chip',
    await ev(() => { const n = [...document.querySelectorAll('.dl-prov')]; return n.length > 0 && n.every(e => /\b(live|recent|stale)\b/.test(e.className)); }),
    await ev(() => [...new Set([...document.querySelectorAll('.dl-prov')].map(e => e.className))].join(' | ')));
  ok('there is exactly one definition of the live/recent/stale thresholds in the build',
    (SRC.match(/age\s*<\s*6e4\s*\?\s*"live"/g) || []).length === 1,
    String((SRC.match(/age\s*<\s*6e4\s*\?\s*"live"/g) || []).length));
  ok('the three clocks are kept apart: observedAt is never back-filled from fetchedAt',
    await evq(() => { const f = DLSNAP.get('universes.global.marketCap'); return f.observedAt === null && typeof f.staleMs === 'number' && f.staleMs >= 0; }),
    await evq(() => JSON.stringify((({ observedAt, fetchedAt, servedAt, staleMs }) => ({ observedAt, fetchedAt, servedAt, staleMs }))(DLSNAP.get('universes.global.marketCap')))));
  ok('a dominance across two incompatible universes is refused, not computed',
    await evq(() => { const b = DLSNAP.dominance(DLSNAP.field(1.59e12, null, { universe: 'tracked', source: 'CoinGecko' }), DLSNAP.current.universes.global.marketCap); return b.value === null && b.reason === 'unsupported'; }));

  console.log('== v155-C · C · no zero is rendered for a missing value');
  ok('no adapter coerces a missing supply to zero, under ANY field name or casing',
    !/supply\s*:\s*\+?[\w.]+\s*\|\|\s*0/i.test(SRC),
    (SRC.match(/supply\s*:\s*\+?[\w.]+\s*\|\|\s*0/gi) || []).join(' | '));
  ok('the fabricated USDT row asserts no observations it did not make',
    await ev(() => { const u = (typeof bySym !== 'undefined' && bySym.USDT) || null; return !u || !u.synthetic || (u.mcap === null && u.vol === null && u.supply === null); }),
    await ev(() => JSON.stringify((typeof bySym !== 'undefined' && bySym.USDT) ? { s: !!bySym.USDT.synthetic, m: bySym.USDT.mcap, v: bySym.USDT.vol, su: bySym.USDT.supply } : 'none')));
  ok('a missing figure renders "Unavailable", never 0 and never a dash',
    await evq(() => DLSNAP.money(DLSNAP.field(null)) === 'Unavailable'
      && DLSNAP.pct(DLSNAP.field(null)) === 'Unavailable'
      && DLSNAP.get('universes.global.nosuchfigure').reason === 'unavailable'));
  ok('a legitimate zero still prints as 0, not "Unavailable"',
    await evq(() => DLSNAP.txt(DLSNAP.field(0, null, { unit: 'COIN' }), String) === '0'
      && DLSNAP.money(DLSNAP.field(0)) !== 'Unavailable'));
  ok('the reason set is closed and value/reason are mutually exclusive',
    await evq(() => { let threw = false; try { DLSNAP.field(null, 'because'); } catch (e) { threw = true; } return threw && DLSNAP.field(5, 'stale').reason === null && DLSNAP.field(null).reason === 'unavailable'; }));
  const miss = (await evq(async () => {
    const sym = (typeof coins !== 'undefined' && coins.find(c => c.sym === 'BTC')) ? 'BTC' : (coins[0] || {}).sym;
    const c = bySym[sym], keep = c.supply;
    c.supply = null;
    try { openCoin(sym); } catch (e) {}
    await new Promise(r => setTimeout(r, 900));
    const t = document.body.innerText;
    const bad = new RegExp('(Circulating supply|Circ\\. Supply)\\s*\\n?\\s*0(\\s|$|' + sym + ')');
    const out = { unavail: /Circulating supply\s*\n?\s*Unavailable|Circ\. Supply\s*\n?\s*Unavailable/.test(t), zero: bad.test(t) };
    c.supply = keep;
    try { nav('markets'); } catch (e) {}
    return out;
  })) || { unavail: false, zero: true };
  await page.waitForTimeout(1200);
  ok('an absent circulating supply renders "Unavailable" and never 0',
    miss.unavail && !miss.zero, JSON.stringify(miss));
  ok('no page errors across the v155-C checks', h.errors.length === 0, h.errors.slice(0, 3).join(' | '));

  // ================================================================ v155-E · uncertainty, shown
  // The live run of 2026-09-09 against the real upstreams found five defects that mocked
  // fixtures structurally could not reveal: a fixture never disagrees with itself, and it
  // never paints the same figure twice at two instants. test/fixtures.js now ships a SECOND
  // whole-market witness (PAPRIKA_GLOBAL) that is out of step with the first in exactly the
  // proportions the live providers were, so every guard below runs against a real
  // disagreement. Each was watched FAILING against the pre-fix payload before being written.
  await ev(() => nav('markets'));
  await page.waitForTimeout(2500);
  await ev(async () => { if (window.DLSNAP) { await DLSNAP.cycle(true); await new Promise(r => setTimeout(r, 1500)); } });

  console.log('== v155-E · 1 · a disagreeing quorum is never rendered as agreement');
  const dis = (await evq(() => {
    const D = DLSNAP.disagreements();
    const cap = DLSNAP.get('universes.global.marketCap'), vol = DLSNAP.get('universes.global.volume24h');
    return {
      n: D.length, paths: D.map(x => x.path), devs: D.map(x => +(+x.dev).toFixed(2)),
      tol: DLSNAP.TOLERANCE,
      capQ: cap.quorum, capW: cap.witnesses.length, capV: cap.value,
      volQ: vol.quorum, volW: vol.witnesses.map(w => w.source + '=' + w.value),
      volV: vol.value, volDev: +(+vol.dev).toFixed(2),
      // the median is a number NEITHER witness reported — that is the whole point of showing it contested
      volIsNeitherWitness: vol.witnesses.every(w => +w.value !== vol.value)
    };
  })) || {};
  ok('the mocked upstreams disagree, so the disagreement path is actually exercised',
    dis.n >= 2 && dis.capQ === 'disagree' && dis.volQ === 'disagree' && dis.devs.every(d => d > dis.tol),
    JSON.stringify(dis));
  ok('a contested figure still shows the median, and the median is a figure no witness reported',
    dis.volIsNeitherWitness === true && typeof dis.volV === 'number', JSON.stringify({ v: dis.volV, w: dis.volW }));

  const shown = (await evq(() => {
    const marks = [...document.querySelectorAll('.dl-dis')];
    const chips = [...document.querySelectorAll('.dl-prov')];
    // a chip that stands over a contested figure — same host element as a .dl-dis mark
    const hostOf = e => e.closest('.stat-strip,#gstatsIn,#tapeTrack,.mx-panel,.gr,.kv') || e.parentElement;
    const contestedHosts = new Set(marks.map(hostOf));
    const chipsOverContested = chips.filter(c => contestedHosts.has(hostOf(c)));
    return {
      marks: marks.length,
      markTexts: [...new Set(marks.map(m => (m.textContent || '').trim()))],
      // the deviation and the witness values must be REACHABLE from the mark
      reachable: marks.every(m => /^-?[\d.]+$/.test(m.getAttribute('data-dev') || '')
        && /CoinGecko=/.test(m.getAttribute('data-witnesses') || '')
        && /Coinpaprika=/.test(m.getAttribute('data-witnesses') || '')
        && /spread ±/.test(m.getAttribute('title') || '')
        && /CoinGecko .* vs Coinpaprika /.test(m.getAttribute('title') || '')),
      chipsOverContested: chipsOverContested.length,
      allContestedChipsSayS: chipsOverContested.every(c => /\bcontested\b/.test(c.className)),
      cleanGreenOverContested: chipsOverContested.filter(c => !/\bcontested\b/.test(c.className))
        .map(c => c.className + ' :: ' + (c.textContent || '').trim().slice(0, 50))
    };
  })) || {};
  ok('a contested figure carries its disagreement AT the point of display, not only in the record',
    shown.marks >= 4 && shown.markTexts.every(t => /sources differ ±[\d.]+%/.test(t)),
    JSON.stringify({ n: shown.marks, t: shown.markTexts }));
  ok('the deviation and both witness values are reachable from every mark',
    shown.marks >= 4 && shown.reachable === true, JSON.stringify({ n: shown.marks, t: shown.markTexts }));
  ok('no provenance chip standing over a contested figure reads as clean agreement',
    shown.chipsOverContested >= 2 && shown.allContestedChipsSayS === true,
    JSON.stringify(shown.cleanGreenOverContested));

  const tick = (await evq(async () => {
    await quorumCheck(true);
    const t = quorumTag();
    return { t, hasWarn: t.indexOf('⚠') >= 0, hasTick: t.indexOf('✓') >= 0, names: /market figure/.test(t) };
  })) || {};
  ok('the witness tick cannot read "✓" beside a contested market figure',
    tick.hasWarn === true && tick.hasTick === false && tick.names === true, JSON.stringify(tick));

  ok('a figure the witnesses AGREE on is not marked as contested',
    await evq(() => {
      const b = DLSNAP.get('universes.global.dominance.BTC');
      return b.quorum === 'agree' && b.witnesses.length === 2 && DLSNAP.dis(b, 'x') === '';
    }), await evq(() => JSON.stringify(DLSNAP.get('universes.global.dominance.BTC'))));

  console.log('== v155-E · 2 · one snapshot, one age, on every surface');
  // Provoke exactly the shipped defect: repaint everything, wait, then repaint ONE surface.
  // Pre-fix each chip baked C.ago() at ITS OWN paint instant, so #dlGstat printed "0s ago"
  // for the same figure the hero admitted was a minute old.
  await ev(() => { try { DLSNAP.repaint(); } catch (e) {} });
  await page.waitForTimeout(6000);
  await ev(() => { try { DLSNAP.paintHero(); } catch (e) {} });
  const ages = (await evq(() => {
    // "every surface showing ONE snapshot shows one age" — so the law is scoped to the chips
    // that name a source the canonical snapshot is actually served from.
    // "every surface showing ONE snapshot shows one age", so the law is scoped by SURFACE:
    // the hosts that render the canonical record. (A CoinGecko chip in the Sectors sheet is a
    // different fetch at a different instant and is legitimately a different age.)
    const HOSTS = ['.dl-snapfoot', '#gstatsIn', '#cbMcap', '#cbVol', '#cbDom',
                   '#tapeTrack', '.mx-glob', '#globRows'];
    const seen = new Set(), chips = [];
    HOSTS.forEach(sel => [...document.querySelectorAll(sel)].forEach(host => {
      const list = [...host.querySelectorAll('.dl-prov')];
      if (host.classList && host.classList.contains('dl-prov')) list.push(host);
      list.forEach(e => { if (!seen.has(e)) { seen.add(e); chips.push(e); } });
    }));
    const rows = chips.map(e => {
      const txt = (e.textContent || '').replace(/\s+/g, ' ').trim();
      const m = /^(.*?) · ((?:\d+[smhd] ago)|no data)/.exec(txt);
      return m ? { src: m[1], age: m[2], at: e.getAttribute('data-at') } : null;
    }).filter(Boolean);
    const bySrc = {}, byAt = {};
    rows.forEach(r => { (bySrc[r.src] = bySrc[r.src] || new Set()).add(r.age); if (r.at) (byAt[r.at] = byAt[r.at] || new Set()).add(r.age); });
    return {
      n: rows.length,
      stamped: rows.filter(r => r.at).length,
      hasAgeNode: [...document.querySelectorAll('.dl-prov[data-at]')]
        .filter(e => / · /.test(e.textContent || '')).every(e => !!e.querySelector('.dl-age')),
      srcClash: Object.keys(bySrc).filter(k => bySrc[k].size > 1).map(k => k + ' => ' + [...bySrc[k]].join('/')),
      atClash: Object.keys(byAt).filter(k => byAt[k].size > 1).map(k => k + ' => ' + [...byAt[k]].join('/')),
      rows: rows.slice(0, 10)
    };
  })) || {};
  ok('every source is shown with exactly one age, whatever order its surfaces painted in',
    ages.n >= 3 && ages.srcClash.length === 0, JSON.stringify({ clash: ages.srcClash, rows: ages.rows }));
  ok('two chips carrying one timestamp print one age',
    ages.stamped >= 3 && ages.atClash.length === 0, JSON.stringify(ages.atClash));
  ok('NO chip anywhere in the document prints an age without the timestamp it derived it from',
    await evq(() => [...document.querySelectorAll('.dl-prov')]
      .filter(e => /\d+[smhd] ago|no data/.test(e.textContent || ''))
      .every(e => e.hasAttribute('data-at') && !!e.querySelector('.dl-age'))),
    await evq(() => [...document.querySelectorAll('.dl-prov')]
      .filter(e => /\d+[smhd] ago|no data/.test(e.textContent || '') && !e.hasAttribute('data-at'))
      .map(e => (e.textContent || '').trim()).join(' | ') || 'none unstamped'));
  ok('the age is derived from a timestamp on the chip, not frozen into its HTML at paint',
    ages.stamped >= 3 && ages.hasAgeNode === true, JSON.stringify({ stamped: ages.stamped, node: ages.hasAgeNode }));
  const moved = (await evq(async () => {
    const before = [...document.querySelectorAll('.dl-prov[data-at] .dl-age')].map(e => e.textContent);
    await new Promise(r => setTimeout(r, 3200));
    DLCORE.provRefresh();
    const after = [...document.querySelectorAll('.dl-prov[data-at] .dl-age')].map(e => e.textContent);
    return { before, after, moved: before.some((b, i) => b !== after[i]) };
  })) || {};
  ok('and one refresh moves every chip together, so they cannot drift apart',
    moved.moved === true && moved.before.length === moved.after.length, JSON.stringify(moved));
  ok('the freshness refresh added no timer, loop or observer',
    (() => {
      const src = fs.readFileSync(path.join(__dirname, '..', 'layers', '20-core.js'), 'utf8');
      const w = src.slice(src.indexOf('var PROV = { now: 0 };'), src.indexOf('function coinsAll'));
      return /function provRefresh\(\)/.test(w) && !/setInterval|requestAnimationFrame|new\s+(Mutation|Intersection|Resize)Observer/.test(w);
    })(), 'layers/20-core.js');

  console.log('== v155-E · 3 · one strip may not carry two witness sets under one chip');
  const wit = (await evq(() => {
    const g = DLSNAP.current.universes.global;
    const src = f => f.source, wl = f => (f.witnesses || []).map(w => w.source).join('+');
    return {
      cap: { s: src(g.marketCap), w: wl(g.marketCap) },
      vol: { s: src(g.volume24h), w: wl(g.volume24h) },
      btc: { s: src(g.dominance.BTC), w: wl(g.dominance.BTC) },
      eth: { s: src(g.dominance.ETH), w: wl(g.dominance.ETH) },
      ethNote: DLSNAP.srcNote(g.dominance.ETH, g.marketCap),
      btcNote: DLSNAP.srcNote(g.dominance.BTC, g.marketCap),
      domNoteInDom: [...document.querySelectorAll('.dl-src')].map(e => (e.textContent || '').trim())
    };
  })) || {};
  ok('BTC dominance is derived from the SAME witnesses as the market cap beside it',
    wit.btc && wit.btc.w === wit.cap.w && wit.btc.w.indexOf('+') > 0 && wit.btcNote === '',
    JSON.stringify(wit));
  ok('a figure that is NOT witnessed the same way names its own source, at the figure',
    wit.eth && wit.eth.s !== wit.cap.s && /CoinGecko only/.test(wit.ethNote)
      && wit.domNoteInDom.some(t => /only$/.test(t)),
    JSON.stringify({ eth: wit.eth, note: wit.ethNote, dom: wit.domNoteInDom }));
  ok('every whole-market figure names exactly the witnesses that spoke for IT, and no others',
    await evq(() => {
      const g = DLSNAP.current.universes.global;
      const all = [g.marketCap, g.volume24h, g.change24h, g.dominance.BTC, g.dominance.ETH];
      // and a figure with no witness at all names no source, rather than borrowing one
      return all.every(f => (f.witnesses || []).length
        ? f.source === f.witnesses.map(w => w.source).join(' + ')
        : (f.value == null && f.source === 'no source'));
    }),
    await evq(() => { const g = DLSNAP.current.universes.global;
      return JSON.stringify({ cap: g.marketCap.source + '<-' + g.marketCap.witnesses.length,
        vol: g.volume24h.source + '<-' + g.volume24h.witnesses.length,
        chg: g.change24h.source + '<-' + g.change24h.witnesses.length,
        btc: g.dominance.BTC.source + '<-' + g.dominance.BTC.witnesses.length,
        eth: g.dominance.ETH.source + '<-' + g.dominance.ETH.witnesses.length }); }));

  ok('a provider answering 0 for a figure that cannot be zero has said nothing, not "zero"',
    await evq(() => {
      const W = DLSNAP.witness1;
      return W('X', 0, 1, 1) === null && W('X', -3, 1, 1) === null
        && W('X', 5, 1, 1) !== null && W('X', 0, 1, 0) !== null && W('X', null, 1, 0) === null
        && DLSNAP.resolve([W('A', 0, 1, 1), W('B', 179e9, 1, 1)].filter(Boolean)).quorum === 'single'
        && DLSNAP.resolve([W('A', 0, 1, 1), W('B', 179e9, 1, 1)].filter(Boolean)).value === 179e9;
    }), 'DLSNAP.witness1');
  console.log('== v155-E · 4 · a subset may not out-measure its superset in silence');
  const sub = (await evq(() => {
    const F = (v, w) => DLSNAP.field(v, null, { unit: 'USD', witnesses: w || [], quorum: (w || []).length > 1 ? 'disagree' : 'single' });
    return {
      ok: DLSNAP.subsetCheck(F(10), F(20), 'x').state,
      inRange: DLSNAP.subsetCheck(F(30), F(20, [{ source: 'A', value: 10 }, { source: 'B', value: 50 }]), 'x').state,
      impossible: DLSNAP.subsetCheck(F(99), F(20, [{ source: 'A', value: 10 }, { source: 'B', value: 30 }]), 'x').state,
      undecidable: DLSNAP.subsetCheck(F(null), F(20), 'x').state,
      live: DLSNAP.current.checks.volume.state,
      tracked: DLSNAP.get('universes.tracked.volume24h').value,
      global: DLSNAP.get('universes.global.volume24h').value,
      flags: [...document.querySelectorAll('.dl-flag')].map(e => (e.textContent || '').trim()),
      nflag: document.querySelectorAll('.dl-flag').length,
      flagTitle: (document.querySelector('.dl-flag') || {}).title || ''
    };
  })) || {};
  ok('subset containment is classified, not assumed: ok / within-witness-range / impossible',
    sub.ok === 'ok' && sub.inRange === 'within-witness-range' && sub.impossible === 'impossible'
      && sub.undecidable === 'undecidable', JSON.stringify(sub));
  ok('the fixtures reproduce the live breach: the tracked 24h volume exceeds the whole-market one',
    sub.tracked > sub.global && sub.live === 'within-witness-range',
    JSON.stringify({ t: sub.tracked, g: sub.global, state: sub.live }));
  ok('and the tracked figure says so where it is shown, naming which of the two is in doubt',
    (sub.flags || []).length >= 3 && (sub.flags || []).every(t => /exceeds the whole-market figure/.test(t))
      && /witnesses disagree/.test(sub.flagTitle || '') && /the one in doubt/.test(sub.flagTitle || ''),
    JSON.stringify({ n: sub.nflag, title: (sub.flagTitle || '').slice(0, 120) }));

  console.log('== v155-E · 5 · no surface may mislabel its own universe, not even while loading');
  const mislabel = (await evq(() => {
    const g = document.querySelector('.mx-glob');
    const head = g ? (g.querySelector('.mx-ph') || {}).textContent : null;
    return {
      // a loading / missing read takes its universe from the PATH it was asked for
      loadTracked: DLSNAP.get('universes.tracked.nosuchfigure').universeLabel,
      loadGlobal: DLSNAP.get('universes.global.nosuchfigure').universeLabel,
      panelHead: head,
      panelIsTracked: /tracked/i.test(head || ''),
      panelSaysWhole: /whole crypto market/i.test(g ? g.innerText : '')
    };
  })) || {};
  ok('a loading or missing figure is labelled with the universe of the path it was asked for',
    /tracked/i.test(mislabel.loadTracked || '') && /whole crypto market/i.test(mislabel.loadGlobal || ''),
    JSON.stringify(mislabel));
  ok('.mx-glob names the tracked set it renders, never the whole market',
    mislabel.panelIsTracked === true && mislabel.panelSaysWhole === false, JSON.stringify(mislabel));
  const covered = (await evq(async () => {
    const g = document.querySelector('.mx-glob');
    if (!g) return { missing: true };
    g.querySelector('.mx-ph').textContent = 'STALE PAINT';
    DLSNAP.repaint();
    await new Promise(r => setTimeout(r, 200));
    const g2 = document.querySelector('.mx-glob');
    return { head: g2 ? (g2.querySelector('.mx-ph') || {}).textContent : null };
  })) || {};
  ok('repaint() covers .mx-glob, so it cannot hold its cold-load state for a whole cycle',
    covered.head && covered.head !== 'STALE PAINT' && /tracked/i.test(covered.head), JSON.stringify(covered));
  // A live run caught the News pulse showing $2.82T / $176.52B while every other surface
  // showed the current record's $2.75T / $132.53B: it painted only on a News visit and
  // repaint() never touched it, so it kept whichever snapshot was current back then.
  const pulseCov = (await evq(async () => {
    await nav('news'); await new Promise(r => setTimeout(r, 2500));
    const ids = ['pg-mcap', 'pg-vol', 'pg-btc', 'pg-eth'];
    const present = ids.filter(i => document.getElementById(i));
    present.forEach(i => { document.getElementById(i).innerHTML = 'STALE PAINT'; });
    DLSNAP.repaint();
    await new Promise(r => setTimeout(r, 200));
    const after = present.map(i => (document.getElementById(i).innerText || '').trim());
    const want = [DLSNAP.money(DLSNAP.get('universes.global.marketCap')),
                  DLSNAP.money(DLSNAP.get('universes.global.volume24h'))];
    await nav('markets'); await new Promise(r => setTimeout(r, 1200));
    return { present: present.length, after, want, stale: after.filter(t => /STALE PAINT/.test(t)).length };
  })) || {};
  ok('repaint() covers the News pulse, so it cannot answer from a snapshot the rest of the app left behind',
    pulseCov.present >= 4 && pulseCov.stale === 0
      && (pulseCov.after || []).some(t => t.indexOf(pulseCov.want[0]) === 0),
    JSON.stringify(pulseCov));

  console.log('== v155-E · 6 · the cheap live-run wastes');
  ok('the coin-icon CDN ref is pinned to a tag, never a moving branch',
    !/cryptocurrency-icons@master/.test(SRC) && (SRC.match(/cryptocurrency-icons@0\.18\.1/g) || []).length === 1,
    (SRC.match(/cryptocurrency-icons@[\w.]+/g) || []).join(' | '));
  const ico = (await evq(() => {
    Object.keys(window.__ICO404 || {}).forEach(function (k) { delete window.__ICO404[k]; });
    const before = icon({ sym: 'ZZQQ', glyph: 'Z', color: '#123456' }, 24);
    window.__icoFail('ZZQQ');
    const after = icon({ sym: 'ZZQQ', glyph: 'Z', color: '#123456' }, 24);
    return { beforeHasImg: /<img/.test(before), afterHasImg: /<img/.test(after), afterHasGlyph: />Z</.test(after) };
  })) || {};
  ok('a coin icon symbol that 404s once is never requested again, and still falls back to the letter glyph',
    ico.beforeHasImg === true && ico.afterHasImg === false && ico.afterHasGlyph === true, JSON.stringify(ico));
  // The finding assumed the letter-glyph fallback was reached for these. It was not: the old
  // handler nulled its own onerror before retrying (logo case) and never retried at all (no-logo
  // case), so a 404 icon left an empty circle and the 404 was never recorded.
  const icoFB = (await evq(() => {
    Object.keys(window.__ICO404 || {}).forEach(function (k) { delete window.__ICO404[k]; });
    const mk = c => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;left:-9999px';
      d.innerHTML = icon(c, 24); document.body.appendChild(d); return d; };
    const a = mk({ sym: 'ZZQQ', glyph: 'Z', color: '#123456' });
    a.querySelector('img').dispatchEvent(new Event('error'));
    const noLogo = { text: (a.textContent || '').trim(), img: !!a.querySelector('img'),
                     recorded: !!(window.__ICO404 || {}).zzqq };
    a.remove();
    Object.keys(window.__ICO404 || {}).forEach(function (k) { delete window.__ICO404[k]; });
    const b = mk({ sym: 'YYQQ', glyph: 'Y', color: '#123456', logo: 'https://example.invalid/x.png' });
    const im = b.querySelector('img');
    im.dispatchEvent(new Event('error'));
    const retried = /cryptocurrency-icons/.test(im.getAttribute('src') || '');
    im.dispatchEvent(new Event('error'));
    const withLogo = { text: (b.textContent || '').trim(), img: !!b.querySelector('img'),
                       retried: retried, recorded: !!(window.__ICO404 || {}).yyqq };
    b.remove();
    return { noLogo, withLogo };
  })) || {};
  // The glyph sits on the coin's OWN brand colour, which is chosen at runtime and spans the
  // whole hue range — no token and no static substitution can answer for it, so the foreground
  // is computed from the backdrop. Swept here across the shipped palette AND across the
  // crossover band, where a shallower ink than #000 drops to 4.14 and fails AA.
  const fg = (await evq(() => {
    const lum = h => { h = h.replace('#', ''); const f = v => { v = parseInt(v, 16) / 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
      return .2126 * f(h.slice(0, 2)) + .7152 * f(h.slice(2, 4)) + .0722 * f(h.slice(4, 6)); };
    const cr = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + .05) / (Math.min(A, B) + .05); };
    const pal = ['#F7931A','#627EEA','#26A17B','#F3BA2F','#14F195','#23A9E1','#0D6DFF','#C2A633','#FF060A',
                 '#E84142','#2A5ADA','#E6007A','#8247E5','#FFA409','#5B7CFF','#98A1BC','#8B5CF6','#00E676'];
    for (let r = 0; r < 256; r += 51) for (let g = 0; g < 256; g += 51) for (let b = 0; b < 256; b += 51)
      pal.push('#' + [r, g, b].map(x => ('0' + x.toString(16)).slice(-2)).join(''));
    let worst = 99, at = '';
    pal.forEach(c => { const v = cr(icoFg(c), c); if (v < worst) { worst = v; at = c + ' -> ' + icoFg(c); } });
    return { worst: +worst.toFixed(2), at, n: pal.length };
  })) || {};
  ok('a coin glyph is legible on every backdrop the brand palette can produce (AA, both modes)',
    fg.worst >= 4.5 && fg.n > 100, JSON.stringify(fg));
  ok('a coin icon with no logo falls back to its letter glyph on the FIRST 404, and records it',
    icoFB.noLogo && icoFB.noLogo.text === 'Z' && icoFB.noLogo.img === false && icoFB.noLogo.recorded === true,
    JSON.stringify(icoFB.noLogo));
  ok('a coin icon with a logo still gets its two attempts, and the second one ends at the glyph',
    icoFB.withLogo && icoFB.withLogo.retried === true && icoFB.withLogo.text === 'Y'
      && icoFB.withLogo.img === false && icoFB.withLogo.recorded === true,
    JSON.stringify(icoFB.withLogo));
  ok('and the repeat-request engine consults that record before asking the CDN again',
    /if\(\(sym\|\|!\(t\.length<=1\)\)&&sym&&!icoDead\(sym\)\)/.test(SRC)
      && /img\.onerror=function\(\)\{window\.__icoFail\(sym\)\}/.test(SRC), 'upgradeIcons');
  ok('the odds board asks for exactly the events it can render, not twice as many',
    (() => { const s = fs.readFileSync(path.join(__dirname, '..', 'layers', '36-odds.js'), 'utf8');
      return !/limit=60/.test(s) && /&limit=30/.test(s) && /list\.slice\(0, 30\)/.test(s); })(),
    'layers/36-odds.js');
  // /api/news answers 200 text/html with the SPA shell on every host (the harness mirrors it).
  // The client must not read that body, and must not ask the same host for it twice.
  const newsReqs = () => h.net.filter(u => /\/api\/news/.test(u)).length;
  const n1 = newsReqs();
  await ev(async () => { try { await DLRX.apiFetch('/api/news'); } catch (e) {} });
  await page.waitForTimeout(800);
  const n2 = newsReqs();
  await ev(async () => { try { await DLRX.apiFetch('/api/news'); } catch (e) {} });
  await page.waitForTimeout(800);
  const n3 = newsReqs();
  ok('a host that answers /api/news with a page instead of the API is never asked again',
    n3 === n2 && n2 - n1 <= 3, `api/news requests: start ${n1}, after one apiFetch ${n2}, after two ${n3}`);
  ok('and the whole session costs at most one request per host, not one per pull',
    n3 <= 3, `${n3} /api/news requests across the whole run for 3 hosts`);
  ok('the client states that it wants JSON and drops a non-JSON body unread',
    /fetch\(h\+path,\{headers:\{accept:"application\/json"\}/.test(SRC)
      && /if\(ct\.indexOf\("json"\)<0\)\{NOAPI\[h\]=1;drop\(res\);continue\}/.test(SRC), 'apiFetch');
  ok('a dead RSS proxy is abandoned on a short client deadline and degrades to a labelled empty state',
    /for\(const px of PROXIES\)try\{const res=await fetch\(px\(feed\.url\),\{headers:\{\},signal:window\.AbortSignal&&AbortSignal\.timeout\?AbortSignal\.timeout\(6e3\)/.test(SRC)
      && /No headlines loaded yet/.test(SRC), 'fetchFeed');
  ok('no page errors across the v155-E checks', h.errors.length === 0, h.errors.slice(0, 3).join(' | '));

  console.log('== hygiene');
  ok('no page errors across every desk', h.errors.length === 0, h.errors.slice(0, 3).join(' | '));
  const realErr = h.consoleErr.filter(t => !/Failed to load resource/.test(t)); ok('console errors are quiet (resource loads excluded — icons CDN is mocked offline)', realErr.length === 0, realErr.slice(0, 3).join(' | '));
  // v155-G defect 6: was `=== 'v154'`, a literal that had to be retyped on every release
  // and said nothing while it matched. The artifacts have to AGREE — that is the real lock.
  ok('the payload build, the worker build and the visible stamp are one build',
    await (async () => {
      const swb = (fs.readFileSync(path.join(__dirname, '..', 'dist', 'sw.js'), 'utf8')
        .match(/const SW_BUILD\s*=\s*'([^']+)'/) || [])[1];
      const m = await ev(() => ({
        meta: (document.querySelector('meta[name="cb:build"]') || {}).content || '',
        tag: ((document.getElementById('cbBuildTag') || {}).textContent || '').trim()
      }));
      return !!swb && m.meta === swb && m.tag.split(' ')[0] === swb;
    })());
  ok('no user-facing Oracle branding left except the DeFi glossary term', await ev(() => { const t = document.body.innerText; return !/Oracle —|Oracle chat|Oracle online|Ask the Oracle/.test(t); }));
  ok('no Bitcoin symbol outside lesson content', await ev(() => { const n = document.querySelectorAll('.dls, #dlDesksRail, #dlRungRail, #dxMarketCard, #nxChat'); return ![...n].some(e => /₿/.test(e.innerText)); }));

  console.log('== theme boot (fresh loads)');
  const boot = async (scheme, seed) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(v => { v === null ? localStorage.removeItem('dl.mode') : localStorage.setItem('dl.mode', v) }, seed);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const early = await page.evaluate(() => document.documentElement.getAttribute('data-mode'));
    await page.waitForTimeout(2500);
    return { early, stored: await page.evaluate(() => localStorage.getItem('dl.mode')) };
  };
  // A later session made Night the unconditional default and stopped consulting the OS
  // (one-time dl.darkdefault.v1 migration). decisions.md D-09. The assertion follows shipped
  // behaviour: a first visit is Night whatever the OS says, and the choice is then sticky.
  const bLight = await boot('light', null);
  ok('first visit opens in Night whatever the OS prefers, before first paint', bLight.early === null && bLight.stored === 'dark', JSON.stringify(bLight));
  const bDark = await boot('dark', null);
  ok('first visit on a dark OS opens in Night, before first paint', bDark.early === null && bDark.stored === 'dark', JSON.stringify(bDark));
  const bStick = await boot('dark', 'day');
  ok('an explicit choice outranks the OS on every later visit', bStick.early === 'day' && bStick.stored === 'day', JSON.stringify(bStick));
  const bLegacy = await boot('dark', 'cyber');
  ok('a stored cyber/grey mode is migrated to Night at boot', bLegacy.early === null && bLegacy.stored === 'dark', JSON.stringify(bLegacy));
  const evicted = await page.evaluate(() => { localStorage.setItem('cb.theme', 'cyber'); localStorage.setItem('dl.contrast', '1'); return 1 });
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2000);
  ok('boot evicts the retired storage keys', await page.evaluate(() => !localStorage.getItem('cb.theme') && !localStorage.getItem('dl.contrast')), String(evicted));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const rm = await ev(async () => { DLMODE.set('dark', true); DLMODE.toggle(); const on = document.documentElement.classList.contains('dl-theming'); DLMODE.set('dark', true); return on });
  ok('reduced motion suppresses the theme cross-fade', rm === false);
  await page.emulateMedia({ colorScheme: null, reducedMotion: null });

  // v155-D. The worker that shipped before this section served NAVIGATIONS cache-first, so a
  // returning visitor with a warm cache kept booting the build they first saw — the site could
  // be ten builds behind and no returning visitor would ever know. These run on their own
  // origin: harness.js serves 127.0.0.1, and the stale-shell defence deliberately refuses to
  // register a worker there (and purges any it finds), so the production registration path is
  // only reachable from a name the dev-origin guard does not match. See test/swscenarios.js.
  console.log('== service worker · freshness, offline, cache hygiene (own origin, own browser)');
  const DIST = path.dirname(path.resolve(file));
  for (const r of await SWS.run(DIST)) ok(r.name, r.ok, r.detail);

  const swsrc = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
  const swcode0 = swsrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const payload = fs.readFileSync(path.resolve(file), 'utf8');
  ok('the worker never serves a navigation from the cache first',
    !/caches\.match\('\.\/index\.html'\)\.then\(\(hit\) => hit \|\| fetch\(req\)\)/.test(swsrc) && /navigateFirst/.test(swsrc));
  ok('every cache write sits behind the res.ok + content-type gate',
    swcode0.split('cache.put(').length === 2 && /async function store\(/.test(swcode0) &&
    swcode0.slice(swcode0.indexOf('async function store(')).indexOf('cache.put(') < 200 &&
    (swcode0.match(/store\(cache/g) || []).length >= 4,
    'cache.put( sites in code: ' + (swcode0.split('cache.put(').length - 1));
  ok('the data cache has an explicit TTL, a hard bound and a documented eviction sweep',
    /DATA_TTL_MS/.test(swsrc) && /DATA_MAX/.test(swsrc) && /async function sweep/.test(swsrc));
  // A fetch event whose respondWith never settles pins the worker, and a pinned worker will not
  // let a new version activate — one hung upstream would block a deploy forever. Every request
  // the worker makes therefore goes through netFetch, which aborts on a deadline.
  const swcode = swsrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const rawFetches = (swcode.match(/(^|[^a-zA-Z])fetch\(/g) || []).length;
  ok('no request class can pin the worker — every fetch goes through the deadline wrapper',
    /function netFetch/.test(swcode) && rawFetches === 1, 'un-wrapped fetch( sites: ' + (rawFetches - 1));
  const lock = (swsrc.match(/const PAYLOAD_SHA = '([0-9a-f]{64})'/) || [])[1];
  ok('the worker version is locked to the payload it was minted for',
    lock === crypto.createHash('sha256').update(payload, 'utf8').digest('hex'), 'sw.js names ' + lock);
  ok('skipWaiting exists exactly once and only the page can reach it',
    swsrc.split('self.skipWaiting()').length === 2 && /d\.dl === 'sw-skip-waiting'/.test(swsrc) &&
    !/skipWaiting/.test(swsrc.slice(swsrc.indexOf("addEventListener('install'"), swsrc.indexOf("addEventListener('activate'")).replace(/\/\/[^\n]*/g, '')));

  // the three stale-shell defences, still present after the rewrite
  ok('stale-shell defence 1 · no worker on a native scheme or a dev origin',
    payload.includes('"capacitor:"===location.protocol') &&
    payload.includes('/^(localhost|127\\.0\\.0\\.1|papertrade\\.app)$/.test(location.hostname)'));
  ok('stale-shell defence 2 · the inline purge keeps its one-shot session-scoped reload',
    payload.includes('"cb.swpurged"') && payload.includes('sessionStorage.setItem(k,"1")'));
  ok('stale-shell defence 3 · the build stamp is visible in the UI',
    await ev(() => { const e = document.getElementById('cbBuildTag'); const b = (document.querySelector('meta[name="cb:build"]') || {}).content || '\u0000'; return !!e && (e.textContent || '').indexOf(b) === 0 && getComputedStyle(e).display !== 'none'; }));
  ok('this origin is a dev origin, so the gate\'s own page carries no worker and no cache',
    await ev(async () => !navigator.serviceWorker.controller && (await caches.keys()).length === 0));
  ok('the payload no longer reloads on every controllerchange',
    !payload.includes('if(!_swap){_swap=!0;try{location.reload()}catch(e){}}') && payload.includes('sw-skip-waiting'));


  // ================================================================= v155-C · layout
  // The measured layout audit (Chromium 1440x900, this harness) found five voids. These
  // asserts are the ceilings that stop them coming back. Every one of them was watched
  // FAIL against the pre-fix payload before it was accepted — the numbers in the comments
  // are that pre-fix reading.
  console.log('== v155-C layout');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(1200);

  const LAYOUT_PROBE = () => {
    const main = document.querySelector('main.active'); if (!main) return null;
    const mb = main.getBoundingClientRect();
    const L = mb.x + scrollX, W = mb.width, docH = document.documentElement.scrollHeight;
    const vis = e => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity !== 0; };
    const all = [...main.querySelectorAll('*')].filter(e => {
      if (!vis(e)) return false; const s = getComputedStyle(e); const r = e.getBoundingClientRect();
      if (r.height < 40 || r.width < 80) return false;
      return (s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)') || parseFloat(s.borderTopWidth) > 0;
    });
    const boxes = all.filter(e => !all.some(o => o !== e && o.contains(e))).map(e => {
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.x + scrollX - L), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
    });
    // dead rail: share of 100px bands where more than 250px of the container is unused
    const bands = [];
    for (let y = 0; y < docH; y += 100) {
      let right = 0;
      for (const b of boxes) if (b.y + b.h > y && b.y < y + 100) right = Math.max(right, b.x + b.w);
      if (right > 0) bands.push(Math.round(W - right));
    }
    const dead = bands.filter(d => d > 250);
    // tail void: empty document below the last thing a reader can actually read
    // in-flow text leaves only: screen-reader announcers and other absolutely parked
    // 1px nodes are not something a reader can see, so they cannot define where a page ends
    const leaves = [...document.querySelectorAll('body *')].filter(e => {
      if (!vis(e) || e.children.length || !(e.textContent || '').trim()) return false;
      const p = getComputedStyle(e).position; if (p !== 'static' && p !== 'relative') return false;
      if (e.closest('[aria-live],[role="status"],.toast,.modal,.dlv-sheet')) return false;
      const r = e.getBoundingClientRect(); return r.width >= 8 && r.height >= 6;
    });
    let lastText = 0, lastEl = '';
    leaves.forEach(e => { const r = e.getBoundingClientRect(); const b = r.y + scrollY + r.height;
      if (b > lastText) { lastText = b; lastEl = e.tagName + '.' + (e.className || '').toString().slice(0, 24) + ' pos=' + getComputedStyle(e).position + ' «' + (e.textContent || '').trim().slice(0, 24) + '»'; } });
    // visible band labels: the uppercase section rules that name a band
    // band rules only: h2/h3 in a news or feed list are item titles, and two stories
    // may legitimately carry the same headline. A SECTION label may not repeat.
    const labels = [...main.querySelectorAll('.mx-rail-h,.mx-ph,.eyebrow,.sec-t,.slab')]
      .filter(vis).map(e => (e.innerText || '').replace(/\s+/g, ' ').trim().toUpperCase())
      .filter(t => t.length > 3 && t.length < 60);
    const seen = {}; labels.forEach(t => { seen[t] = (seen[t] || 0) + 1; });
    return {
      docH, W: Math.round(W),
      deadPct: +(100 * dead.length / Math.max(1, bands.length)).toFixed(1),
      tailVoid: Math.round(docH - lastText),
      lastEl,
      dupLabels: Object.keys(seen).filter(t => seen[t] > 1).map(t => t + ' x' + seen[t])
    };
  };

  const VIEWS = ['markets', 'portfolio', 'p2p', 'community', 'learn', 'explorer', 'discover', 'news'];
  const geo = {};
  for (const v of VIEWS) {
    await ev(x => nav(x), v);
    await page.waitForTimeout(4300);   // past the column pass's last settle at 3.8s
    await ev(() => window.scrollTo(0, 0));
    geo[v] = await ev(LAYOUT_PROBE);
    console.log(`   ${v.padEnd(10)} docH ${String(geo[v].docH).padStart(5)}  dead ${String(geo[v].deadPct).padStart(5)}%  tailVoid ${String(geo[v].tailVoid).padStart(4)}px  last=${geo[v].lastEl}`);
  }

  // --- finding 2 · the tail void, one cause on all eight views ---------------------
  // footer{padding-bottom:112px} reserves a landing strip for #nxbn, the fixed bottom
  // nav, which only exists at max-width:640px. Pre-fix this read 113px on EVERY view.
  for (const v of VIEWS) {
    ok(`tail void · ${v} ends within 60px of its last line (was 113 on all eight)`,
      geo[v].tailVoid <= 60, `${geo[v].tailVoid}px`);
  }

  // --- findings 1 and 5 · the dead right rail --------------------------------------
  // Pre-fix: portfolio 82% of the page (peaking at 998px of a 1,298px container) and
  // community 31%. A view may not spend a fifth of its height with the right third empty.
  for (const v of VIEWS) {
    ok(`dead rail · ${v} under 20% of the page (portfolio was 82%, community 31%)`,
      geo[v].deadPct <= 20, `${geo[v].deadPct}%`);
  }

  // --- finding 3 · no two visible band labels on a view may read the same -----------
  // "TOP MOVERS · 24H" rendered three times on markets: the #mxGL2 top-30 leaderboard,
  // the whole-ladder movers strip, and a header stranded in front of the heatmap when
  // mountHeat() slid #dlHeat between a header and the host it labelled.
  for (const v of VIEWS) {
    ok(`labels · ${v} has no two identical visible section labels`,
      geo[v].dupLabels.length === 0, geo[v].dupLabels.join(' | '));
  }

  // --- finding 6 · markets is not 8,281px of stacked bands -------------------------
  ok('markets is under 7,400px of document (was 8,281)', geo.markets.docH < 7400, geo.markets.docH + 'px');
  // v155-F raised this ceiling from 3,400 to 3,600 for one measured reason: the holdings
  // ledger is no longer packed into a 422px masonry column it could not fit, so its card is
  // back on the full-width run and its height is added to the stack instead of shared between
  // three columns. 3,500px measured. The property this assert exists to hold — that the board
  // is not the tall single stack it was — is unchanged: pre-fix it read 3,880-5,151.
  ok('portfolio is under 3,600px of document (was 3,880-5,151, two 371px columns)',
    geo.portfolio.docH < 3600, geo.portfolio.docH + 'px');

  // --- finding 1 · the portfolio board owns the whole container --------------------
  await ev(() => nav('portfolio'));
  await page.waitForTimeout(5200);   // the board's last settle pass lands at 3.8s
  const pf = await ev(() => {
    const sec = document.querySelector('#page-portfolio > .wrap.section');
    const host = sec && sec.querySelector(':scope > .dlc-host');
    if (!host) return { host: false };
    const cols = [...host.querySelectorAll(':scope > .dlc-col')];
    const w = cols.map(c => Math.round(c.getBoundingClientRect().width));
    const hs = cols.map(c => Math.round(c.getBoundingClientRect().height));
    return {
      host: true, n: cols.length, w, hs,
      hostW: Math.round(host.getBoundingClientRect().width),
      secW: Math.round(sec.getBoundingClientRect().width),
      spread: hs.length ? Math.max(...hs) - Math.min(...hs) : 0
    };
  });
  ok('portfolio board runs three columns, not two', pf.host && pf.n === 3, JSON.stringify(pf));
  ok('portfolio columns are ~420px, never the old 371px', pf.host && Math.min(...pf.w) >= 400, JSON.stringify(pf.w));
  ok('portfolio board spans the whole container — no track left holding an empty rail',
    pf.host && pf.hostW >= pf.secW - 60, `host ${pf.hostW} of section ${pf.secW}`);
  ok('portfolio columns end within 400px of each other (was 2,225)', pf.host && pf.spread <= 400, String(pf.spread));

  // --- finding 3 · exactly one rail header per host --------------------------------
  await ev(() => nav('markets'));
  await page.waitForTimeout(3000);
  const heads = await ev(() => {
    const hs = [...document.querySelectorAll('.mx-rail-h')];
    return {
      texts: hs.map(e => (e.textContent || '').trim()),
      stranded: hs.filter(e => e.getAttribute('data-for') && (!e.nextElementSibling || e.nextElementSibling.id !== e.getAttribute('data-for'))).length
    };
  });
  ok('no rail header is stranded away from the host it labels', heads.stranded === 0, JSON.stringify(heads.texts));
  ok('every rail header text is unique', new Set(heads.texts).size === heads.texts.length, JSON.stringify(heads.texts));

  // --- finding 4 · the heatmap never ships as a blank frame ------------------------
  const heat = await ev(() => {
    const b = document.getElementById('dlHeat'); if (!b) return { missing: true };
    const cv = document.getElementById('dlHeatCv');
    let px = 0; try { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) px++; } catch (e) { px = -1; }
    return { state: b.getAttribute('data-heat'), px, cvShown: getComputedStyle(cv).display !== 'none', note: !!b.querySelector('.hx') };
  });
  ok('heatmap declares that it drew, and did', heat.state === 'ok' && heat.px > 1000 && heat.cvShown, JSON.stringify(heat));
  ok('heatmap ships an honest empty state with it', heat.note === true, JSON.stringify(heat));
  // and prove the empty state actually appears when there is nothing to map
  // `coins` is the ladder the panel maps. Empty it for one repaint and the panel must
  // say Unavailable in words, drop the blank canvas out of the flow, and shrink.
  const heatEmpty = await ev(() => {
    const b = document.getElementById('dlHeat'), cv = document.getElementById('dlHeatCv');
    const keep = coins.slice();
    try {
      coins.length = 0;
      if (window.DLHEATX) DLHEATX.paint(); else if (window.DLOMNI) DLOMNI.heat();
      const note = b.querySelector('.hx');
      return {
        state: b.getAttribute('data-heat'),
        noteShown: !!note && getComputedStyle(note).display !== 'none',
        noteText: note ? (note.innerText || '').trim() : '',
        cvHidden: getComputedStyle(cv).display === 'none',
        h: Math.round(b.getBoundingClientRect().height)
      };
    } finally { coins.length = 0; [].push.apply(coins, keep); }
  });
  ok('heatmap with nothing to map says Unavailable, in words, and hides the blank canvas',
    heatEmpty.state === 'empty' && heatEmpty.noteShown && /Unavailable/.test(heatEmpty.noteText) && heatEmpty.cvHidden,
    JSON.stringify(heatEmpty));
  ok('and the empty panel is a note, not a 426px hole', heatEmpty.h > 0 && heatEmpty.h < 300, heatEmpty.h + 'px');
  await ev(() => { if (window.DLHEATX) DLHEATX.paint(); });
  await page.waitForTimeout(400);
  ok('and it comes back the moment the ladder has data again',
    (await ev(() => (document.getElementById('dlHeat') || {}).getAttribute && document.getElementById('dlHeat').getAttribute('data-heat'))) === 'ok');

  // --- finding 7 · width vocabulary on the panels these changes touched -------------
  const vocab = await ev(() => {
    const mp = document.getElementById('mktpro');
    const host = mp && mp.querySelector(':scope > .dlc-host');
    if (!host) return { host: false };
    const ws = [...host.querySelectorAll(':scope > .dlc-col > *')].map(e => Math.round(e.getBoundingClientRect().width));
    return { host: true, distinct: [...new Set(ws)], n: ws.length };
  });
  ok('every band the markets pass touched is on one width, not twelve',
    vocab.host && vocab.distinct.length === 1 && vocab.n >= 8, JSON.stringify(vocab));

  // --- the laws these changes had to keep ------------------------------------------
  ok('layout adds no animation loop and no new observer',
    (() => {
      const src = fs.readFileSync(path.join(__dirname, '..', 'layers', 'zzz-columns.js'), 'utf8');
      return !/setInterval|requestAnimationFrame|new\s+(MutationObserver|IntersectionObserver|ResizeObserver)/.test(src);
    })(), 'layers/zzz-columns.js');
  ok('no page errors after the layout pass', h.errors.length === 0, h.errors.slice(0, 3).join(' | '));



  // ============================================================ v155-F · the Day text token
  // SHIP BLOCKER. --txt-1 was declared once, on the Night :root, and the Day palette never
  // answered it, so every rule reading it painted #F2F5FA on a white Day card. Seven
  // statistics, the 24h range, the risk-sizing readout, the pair label and the Ask buttons
  // all measured 1.09-1.15:1. Every one of these assertions was watched FAIL against the
  // pre-fix payload; the pre-fix readings are in the assertion text.
  //
  // Every ratio below is computed by test/gate-contrast.js from the colours the BROWSER
  // computed — nothing here does its own colour maths, and nothing quotes a remembered value.
  console.log('== v155-F · the Day value --txt-1 never had');
  await page.setViewportSize({ width: 1440, height: 900 });

  // one in-page probe: the computed foreground, and the opaque backdrop the element really
  // composites onto (translucent ancestors kept, in order, to be composited in Node).
  const PAINT = (sels) => {
    const vis = e => {
      const s = getComputedStyle(e), r = e.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity !== 0 && r.width > 0 && r.height > 0;
    };
    // Chromium resolves color-mix() to color(srgb r g b / a). Reading only rgba() here made a
    // translucent wash look opaque, and the ratio was then computed against the wrong surface.
    const alphaOf = bc => {
      const t = String(bc);
      if (/^transparent$/i.test(t)) return 0;
      let m = t.match(/^rgba?\(([^)]*)\)$/i);
      if (m) { const p = m[1].split(/[,\/\s]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; }
      m = t.match(/^color\(\s*srgb\s+([^)]*)\)$/i);
      if (m) { const p = m[1].split(/[\/\s]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; }
      return 1;
    };
    const out = {};
    for (const sel of sels) {
      const els = [].slice.call(document.querySelectorAll(sel))
        .filter(e => vis(e) && (e.textContent || '').trim());
      if (!els.length) { out[sel] = { n: 0 }; continue; }
      const el = els[0], cs = getComputedStyle(el);
      const over = [];
      let n = el, bg = null, guard = 0, gradAbove = false;
      while (n && guard++ < 48) {
        const s = getComputedStyle(n);
        const bc = s.backgroundColor || 'rgba(0, 0, 0, 0)';
        const a = alphaOf(bc);
        if (s.backgroundImage && s.backgroundImage !== 'none' && a < 1) gradAbove = true;
        if (a === 1) { bg = bc; break; }
        if (a > 0) over.push(bc);
        n = n.parentElement;
      }
      out[sel] = {
        n: els.length, fg: cs.color, bg, over, gradAbove,
        ownBg: cs.backgroundColor, ownImg: cs.backgroundImage,
        fs: parseFloat(cs.fontSize), fw: cs.fontWeight,
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 34)
      };
    }
    return out;
  };
  const ratioOf = r => {
    if (!r || !r.n || !r.bg) return null;
    let bg = CG.parseColor(r.bg, () => null);
    for (let k = r.over.length - 1; k >= 0; k--) bg = CG.composite(CG.parseColor(r.over[k], () => null), bg);
    const fg = CG.parseColor(r.fg, () => null);
    return CG.contrast(CG.composite(fg, bg), bg);
  };
  // 4.5 normal text, 3.0 large text — the same SC 1.4.3 line gate-render-contrast.js holds.
  const needFor = r => (parseInt(r.fw, 10) >= 700 || r.fw === 'bold') && r.fs >= 18.66 ? CG.AA_NONTEXT
                     : r.fs >= 24 ? CG.AA_NONTEXT : CG.AA_TEXT;

  // the seven statistics, the 24h range, the ticket readout, the pair label, the ask buttons
  const COIN_SELS = ['.cmc-stats .cs .v', '.cs-range .rk-head b', '#dlRisk .ro b',
                     '#cv-pairlabel', '#dlAskAI', '#dlCoinAI button.ask'];
  const MKT_SELS = ['#mktpro .mx-glob .gg .v'];
  const paints = {}, tokens = {};
  for (const mode of ['day', 'dark']) {
    await ev(m => window.DLMODE.set(m, true), mode);
    await page.waitForTimeout(1400);
    tokens[mode] = await ev(() => ({
      txt1: getComputedStyle(document.documentElement).getPropertyValue('--txt-1').trim(),
      txt2: getComputedStyle(document.documentElement).getPropertyValue('--txt-2').trim(),
      txt3: getComputedStyle(document.documentElement).getPropertyValue('--txt-3').trim(),
      attr: document.documentElement.getAttribute('data-mode')
    }));
    await ev(() => nav('markets'));
    await page.waitForTimeout(3000);
    paints[mode + '|markets'] = await ev(PAINT, MKT_SELS);
    const got = await ev(() => {
      const tr = document.querySelector('table.mx-table tbody tr[data-mxrow]');
      if (!tr) return null;
      (tr.querySelector('td.c-coin') || tr).click();
      return tr.getAttribute('data-mxrow');
    });
    ok(`a coin detail page opens from a real markets row · ${mode}`, !!got, String(got));
    await page.waitForTimeout(7000);
    paints[mode + '|coin'] = await ev(PAINT, COIN_SELS);
  }

  ok('--txt-1 has a value of its own in each mode (it had ONE, #F2F5FA, for both)',
    tokens.day.txt1 && tokens.dark.txt1 &&
    tokens.day.txt1.toLowerCase() !== tokens.dark.txt1.toLowerCase(),
    `day=${tokens.day.txt1} night=${tokens.dark.txt1}`);
  ok('and the Day value is the DARK end of the pair, not the Night near-white',
    CG.contrast(CG.parseColor(tokens.day.txt1, () => null), CG.parseColor('#FFFFFF', () => null)) >= 4.5,
    tokens.day.txt1);

  for (const mode of ['day', 'dark']) {
    for (const [where, sels] of [['coin', COIN_SELS], ['markets', MKT_SELS]]) {
      const got = paints[mode + '|' + where];
      for (const sel of sels) {
        const r = got[sel];
        if (!r || !r.n) { ok(`${mode} · ${where} · ${sel} renders at all`, false, 'not found'); continue; }
        const need = needFor(r), got2 = ratioOf(r);
        ok(`${mode} · ${sel} reads at ${need.toFixed(1)}:1 (pre-fix Day: 1.09-1.15)`,
          got2 !== null && got2 >= need,
          `${(got2 === null ? 'unresolved' : got2.toFixed(2))} · ${r.fg} on ${r.bg} · «${r.text}»`);
      }
    }
  }
  // and the evidence that these are real text, not gradient-button false positives
  const flat = paints['day|coin'];
  ok('the failing statistics really are bare text on the card (transparent, no image)',
    flat['.cmc-stats .cs .v'].ownBg === 'rgba(0, 0, 0, 0)' && flat['.cmc-stats .cs .v'].ownImg === 'none' &&
    flat['.cs-range .rk-head b'].ownBg === 'rgba(0, 0, 0, 0)' && flat['#dlRisk .ro b'].ownBg === 'rgba(0, 0, 0, 0)',
    JSON.stringify([flat['.cmc-stats .cs .v'].ownBg, flat['.cmc-stats .cs .v'].ownImg]));
  // the structural guard: no --txt-* token may be declared once for two modes again
  ok('every --txt-* token resolves differently in the two modes',
    ['txt1', 'txt2', 'txt3'].every(k => (tokens.day[k] || '').toLowerCase() !== (tokens.dark[k] || '').toLowerCase()),
    JSON.stringify(tokens));

  // ============================================================ v155-F · Era Ledger
  // eraSheet() called paint(keys.length - 1) unguarded. eraRecord() bails below 50 coins, so
  // on that device keys is empty, keys[-1] is undefined, and the sheet read
  // "week of undefined (latest)" over an empty table, "0 weekly snapshots", scrubber max="-1".
  console.log('== v155-F · the Era Ledger printed a literal undefined');
  await ev(m => window.DLMODE.set(m, true), 'dark');
  await page.waitForTimeout(600);
  const era = await ev(() => {
    const keep = coins.slice();
    // coinsAll() prefers MXP.state.coins and falls back to `coins`, so BOTH have to be short
    // for eraRecord() to bail — which is the state of a device whose ladder has not loaded.
    const mx = (window.MXP && MXP.state && MXP.state.coins) || null;
    const keepMx = mx ? mx.slice() : null;
    try {
      try { localStorage.removeItem('dl.era.v1'); } catch (e) {}
      if (mx) mx.length = 0;
      coins.length = 0;                              // eraRecord() bails: nothing to record
      window.DLLEDGERS.eraSheet();
      const lbl = document.getElementById('dlEraLbl');
      const sheet = document.getElementById('dlEra');
      const scrub = document.getElementById('dlEraScrub');
      return {
        lbl: lbl ? (lbl.textContent || '').trim() : null,
        text: sheet ? (sheet.innerText || '').replace(/\s+/g, ' ').trim() : '',
        scrub: !!scrub,
        scrubMax: scrub ? scrub.getAttribute('max') : null,
        rows: sheet ? sheet.querySelectorAll('table tbody tr').length : -1,
        recorded: Object.keys((window.DLLEDGERS.eraStore() || {}).weeks || {}).length
      };
    } finally {
      coins.length = 0; [].push.apply(coins, keep);
      if (mx && keepMx) { mx.length = 0; [].push.apply(mx, keepMx); }
    }
  });
  ok('eraRecord() really did bail — the empty-state branch is what was exercised',
    era.recorded === 0, JSON.stringify(era.recorded));
  ok('an Era Ledger with nothing recorded says Unavailable, not "week of undefined"',
    era.lbl === 'Unavailable', JSON.stringify(era.lbl));
  ok('and the word undefined appears nowhere in the sheet',
    !/undefined/i.test(era.text), era.text.slice(0, 140));
  ok('and it does not ship a scrubber with max="-1" over nothing',
    era.scrub === false && era.scrubMax === null, JSON.stringify([era.scrub, era.scrubMax]));
  ok('and it explains, in words, that nothing has been recorded yet',
    /No weekly snapshot has been recorded yet/.test(era.text), era.text.slice(0, 100));
  ok('and it still names the day the recording started',
    /Recording since \d{4}-\d{2}-\d{2}/.test(era.text), era.text.slice(0, 160));
  await ev(() => { try { window.DLCORE.close('dlEra'); } catch (e) {} });
  await page.waitForTimeout(400);
  // the populated sheet is unchanged: record one week, reopen, and the scrubber is back
  const eraFull = await ev(() => {
    try { localStorage.removeItem('dl.era.v1'); } catch (e) {}
    window.DLLEDGERS.eraRecord();
    window.DLLEDGERS.eraSheet();
    const lbl = document.getElementById('dlEraLbl'), scrub = document.getElementById('dlEraScrub');
    const sheet = document.getElementById('dlEra');
    return { lbl: lbl ? (lbl.textContent || '').trim() : null, max: scrub ? scrub.getAttribute('max') : null,
      rows: sheet ? sheet.querySelectorAll('table tbody tr').length : -1 };
  });
  ok('a recorded Era Ledger still replays, with a real week and a real scrubber',
    /^week of \d{4}-\d{2}-\d{2} \(latest\)$/.test(eraFull.lbl || '') && eraFull.max === '0' && eraFull.rows > 0,
    JSON.stringify(eraFull));
  await ev(() => { try { window.DLCORE.close('dlEra'); } catch (e) {} });
  await page.waitForTimeout(400);

  // ============================================================ v155-F · the holdings ledger
  // The board is a three-column masonry at 1440. The ledger table carries min-width:640px and
  // was packed into a 422px column, so its .tbl-scroll clipped at 388px: the header read
  // "ASSET | HOLDINGS | PRIC" and PRICE, VALUE and 24H sat outside the card. Every user has
  // the seeded 10,000 USDT, so every user saw it.
  console.log('== v155-F · the holdings ledger overflowed its card');
  await ev(() => nav('portfolio'));
  await page.waitForTimeout(5200);
  await ev(() => window.scrollTo(0, 0));
  const pfLedger = await ev(() => {
    const tb = document.getElementById('pf-body'); if (!tb) return null;
    const tbl = tb.closest('table'), sc = tb.closest('.tbl-scroll'), card = tb.closest('.tbl-card');
    if (!tbl || !sc || !card) return null;
    const cr = card.getBoundingClientRect();
    const ths = [].slice.call(tbl.querySelectorAll('thead th'))
      .map(t => ({ t: (t.textContent || '').trim(), r: Math.round(t.getBoundingClientRect().right) }));
    return {
      tbl: Math.round(tbl.getBoundingClientRect().width),
      scClient: sc.clientWidth, scScroll: sc.scrollWidth,
      card: Math.round(cr.width), cardRight: Math.round(cr.right),
      offCard: ths.filter(t => t.t && t.r > Math.round(cr.right) + 1).map(t => t.t),
      inColumn: !!card.closest('.dlc-col'), headers: ths.map(t => t.t).filter(Boolean)
    };
  });
  ok('the holdings ledger renders', !!pfLedger, JSON.stringify(pfLedger));
  ok('the holdings table fits its card at 1440 (was 640px inside a 388px scroller)',
    pfLedger && pfLedger.scScroll <= pfLedger.scClient + 1, JSON.stringify(pfLedger));
  ok('every holdings column is inside the card (PRICE, VALUE and 24H were off-card)',
    pfLedger && pfLedger.offCard.length === 0, JSON.stringify(pfLedger && pfLedger.offCard));
  ok('and the ledger is not packed into a masonry column narrower than its own minimum',
    pfLedger && pfLedger.inColumn === false, JSON.stringify(pfLedger && pfLedger.card));
  // A 64-character SHA-256 tip is a fixed-width token, not prose: it is MEANT to scroll inside
  // its proof row rather than stretch the card, the same way a hash does in git log. Named
  // here with its reason — the way gate-render-contrast.js names a decorative mark — so this
  // check stays honest about the one thing it is not asserting.
  const clip = await ev(() => [].slice.call(document.querySelectorAll('#page-portfolio .card'))
    .map(c => {
      const bad = [].slice.call(c.querySelectorAll('*')).filter(n =>
        n.scrollWidth - n.clientWidth > 4 && getComputedStyle(n).overflowX !== 'visible' &&
        !n.closest('#chainBody'));
      return bad.length ? ((c.id || c.className).toString().slice(0, 30) + ' ×' + bad.length) : null;
    }).filter(Boolean));
  ok('no card on the portfolio board clips its own content sideways at 1440',
    clip.length === 0, JSON.stringify(clip));
  ok('and the board is still a balanced multi-column board, not one stack again',
    await ev(() => {
      const h = document.querySelector('#page-portfolio > .wrap.section > .dlc-host');
      return !!h && h.querySelectorAll(':scope > .dlc-col').length >= 2;
    }));

  ok('the v155-F layers add no timer, loop or observer',
    (() => {
      const era = fs.readFileSync(path.join(__dirname, '..', 'layers', '39b-ledgers.js'), 'utf8');
      const cols = fs.readFileSync(path.join(__dirname, '..', 'layers', 'zzz-columns.js'), 'utf8');
      const slice = era.slice(era.indexOf('function eraSheet()'), era.indexOf('Baskets */'));
      return !/setInterval|requestAnimationFrame|new\s+(Mutation|Intersection|Resize)Observer/.test(slice) &&
             !/setInterval|requestAnimationFrame|new\s+(Mutation|Intersection|Resize)Observer/.test(cols);
    })());
  ok('no page errors after the v155-F pass', h.errors.length === 0, h.errors.slice(0, 3).join(' | '));


  // ============================================================ v155-G · VERTICAL RHYTHM
  // The metric that decides is test/gate-rhythm.js, and it is wired in here so a layout
  // change cannot ship without answering to it. It re-launches the payload at 1280 / 1440 /
  // 1728 / 2000 / 2560 in BOTH modes — because the pass this replaces measured 1440 only,
  // horizontally, and missed every defect the owner could see on a 2000px desktop.
  //
  // The ceilings below are stated with the number the SHIPPED payload measured, so each one
  // is red against it. Two of them are guard-rails rather than defect thresholds and say so.
  console.log('== v155-G · vertical rhythm (5 widths x 2 modes)');
  const RH = require('./gate-rhythm');
  // settle 3800 -> 6000 (13 Sep 2026). zzz-columns.js re-balances at 900/2400/3800/5000 ms, so
  // 3800 measured the board ON the rebalance frame: inside a long gate154 process this read as a
  // ~121k empty region at 2000px and vanished when the width ran alone. v158 raised gate-rhythm.js's
  // own settle to 6000 for exactly this reason and left this inline copy behind. PROVEN, not assumed:
  // the v158 payload itself (5b563e345c18, no DeFi layer) fails this assert here at 3800, so the
  // number was measuring the harness, not the page. The 120,000px ceiling is unchanged.
  const rhRaw = await RH.measure(file, {
    widths: [1280, 1440, 1728, 2000, 2560], themes: ['dark', 'day'], views: ['markets'],
    boot: 15000, settle: 6000
  });
  const rh = rhRaw.map(RH.digest);
  console.log(RH.table(rh));
  const worst = k => rh.reduce((a, d) => Math.max(a, d[k]), 0);
  const where = (k, lim) => JSON.stringify(rh.filter(d => d[k] > lim)
    .map(d => `${d.view}@${d.width}/${d.theme}=${d[k]}`));

  // 1 · ROW BOTTOM-EDGE SPREAD. #mxTopHost shipped 141/95/469/252/141 at 2000px: the tallest
  //     card ended 374px below the shortest, 80% of its own height. A band of sibling cards
  //     is a row; a row ends on one line. 22% is the widest disagreement a reader still reads
  //     as one row, and it leaves the balanced masonry columns (8-16%) untouched.
  ok('no card band on Markets ends more than 22% of its tallest card apart (shipped: 80% at 2000px)',
    worst('rowSpreadFrac') <= 0.22, 'worst ' + worst('rowSpreadFrac') + ' ' + where('rowSpreadFrac', 0.22));
  // and in absolute px for the CARD bands specifically — rows whose tallest member is under
  // 600px. Between five 250px panels 120px IS the ragged edge; between three 1,100px masonry
  // columns the same number is 11% and reads as balanced, which is what the fraction above is
  // for. #mxTopHost shipped 374px here and .mkt-hero 285px.
  ok('and no band of cards ends more than 120px apart in absolute px '
     + '(shipped: 374px in the overview band, 285px in the hero)',
    worst('bandSpread') <= 120, 'worst ' + worst('bandSpread') + ' ' + where('bandSpread', 120));

  // 2 · DENSITY VARIANCE. The tracked-set card painted ink over 10.1% of itself while the
  //     trending card beside it painted 49.7% — 4.9x. That ratio IS the failure signature the
  //     dead-rail metric could not see: both cards filled their band track perfectly.
  ok('no two cards in one band differ by more than 4.5x in ink density (shipped: 4.9x at 2000px)',
    worst('densRatio') <= 4.5, 'worst ' + worst('densRatio') + ' ' + where('densRatio', 4.5));

  // 3 · INTERNAL WHITESPACE — a GUARD-RAIL, not a defect threshold. Equalising a row can be
  //     paid for by stretching a low-content card and opening a hole in it, which would trade
  //     one defect for another. It is proven red not against the shipped payload (48px) but
  //     against the FIRST attempt at this fix, which aligned every bottom edge and measured
  //     266px of nothing inside the network-fees card. The two checks hold each other honest.
  ok('no card holds an empty vertical run over 110px with content above and below it '
     + '(first fix attempt: 266px — this is the check that rejected it)',
    worst('innerGap') <= 110, 'worst ' + worst('innerGap') + ' ' + where('innerGap', 110));

  // 4 · CLIPPING AND OCCLUSION. Ink outside the box that clips it, text cut with no ellipsis,
  //     a scroller whose scrollbar is suppressed, an element a higher-stacked one paints over.
  ok('no ink is clipped away without an ellipsis to say so (shipped: 0 after the ink test)',
    worst('hardClip') === 0, where('hardClip', 0));
  ok('no scroller hides 400-1100px of content behind a suppressed scrollbar '
     + '(shipped: #dlGstat 433px, .t-scroll 902px, .mx-movers 846px at 1440)',
    worst('noAff') === 0, where('noAff', 0));
  ok('no text is truncated with no affordance (shipped: #dlGstat cut 433px of itself at 1440)',
    worst('trunc') === 0, where('trunc', 0));
  ok('nothing is painted over by a higher-stacked sibling, hit-tested three points deep '
     + '(shipped: the Day coin edge covered its own glyph)',
    worst('occl') === 0, where('occl', 0));

  // 5 · EMPTY REGIONS. Maximal rectangles inside the content column that nothing paints into —
  //     not ink, not a card background, not a border. 944x256 sat beside the spotlight card.
  ok('no unpainted rectangle over 120,000px² inside the Markets content column '
     + '(shipped: 944x256 = 242k beside the spotlight, 752x336 = 253k under the ragged band)',
    worst('emptyN') === 0, JSON.stringify(rh.filter(d => d.emptyN).map(d => `${d.width}/${d.theme}:${d.emptyMaxKpx}k`)));

  // 6 · VERTICAL RHYTHM — a GUARD-RAIL. Gaps between the stacked sections of the content
  //     column; the mean hides everything so this counts OUTLIERS (>2.5x the median and
  //     >40px over it). Green on the shipped payload too: this is here so a fix that
  //     equalises rows cannot start scattering the gaps between them.
  ok('no more than two outlier gaps between stacked sections (shipped: 0 — a guard-rail)',
    worst('rhythmOut') <= 2, where('rhythmOut', 2));

  // 7 · ONE BAR OWNS THE FIGURES. #cbCmd, #tape and #dlGstat each stated a market cap, a BTC
  //     dominance and a Fear & Greed within 160px of each other. Every one was right and every
  //     one named its universe — and a visitor read it as the app contradicting itself.
  ok('no two visible bars state the same market figure within 400px of each other '
     + '(shipped: #tape and #dlGstat, both market cap + Fear & Greed, 92px apart)',
    worst('barCollide') === 0,
    JSON.stringify(rhRaw.filter(m => m.statBars && m.statBars.collisions.length)
      .map(m => `${m.width}/${m.theme}:` + JSON.stringify(m.statBars.collisions))));

  // 8 · and the universe a bar is NOT showing is reachable, labelled and provenance-chipped —
  //     the whole point of the presentation. Nothing was deleted to resolve the collision.
  await ev(() => nav('markets'));
  await page.waitForTimeout(4200);
  const uniSw = await ev(async () => {
    const R = () => new Promise(r => setTimeout(r, 450));
    const bar = document.getElementById('cbCmd');
    const rd = () => {
      const t = bar.innerText || '';
      const m = t.match(/MCap\s*\$([\d.]+)\s?([TBM])/);
      return {
        v: m ? +m[1] * ({ T: 1e12, B: 1e9, M: 1e6 })[m[2]] : null,
        u: (bar.querySelector('.gs-u') || {}).textContent || '',
        prov: !!bar.querySelector('.dl-prov'),
        sw: bar.querySelectorAll('.gs-uni button[data-uni]').length,
        pressed: [...bar.querySelectorAll('.gs-uni button')].filter(b => b.getAttribute('aria-pressed') === 'true').length
      };
    };
    // v159 · the command bar is the bar now, and its default universe is the tracked set,
    // so the round trip starts by asking for the OTHER one.
    const a = rd();
    bar.querySelector('.gs-uni button[data-uni="global"]').click(); await R();
    const b = rd();
    bar.querySelector('.gs-uni button[data-uni="tracked"]').click(); await R();
    const c = rd();
    // the ribbon still HOLDS every figure it stopped showing, with its label and its mark
    const tape = document.querySelectorAll('#tape .ti[data-agg]');
    return {
      a, b, c, tapeAgg: tape.length,
      tapeKeeps: [...tape].every(t => /[\d]/.test(t.textContent || '')),
      tapeLabel: !!document.querySelector('#tape .ti[data-agg] .gs-u'),
      tapeProv: !!document.querySelector('#tape .ti[data-agg].dl-prov'),
      cbAggShown: [...document.querySelectorAll('#cbCmd .cb-agg')]
        .every(e => getComputedStyle(e).display !== 'none'),
      cbAggKeeps: !!document.getElementById('cbMcap') &&
        /\$\s?[\d.]+\s?[TBM]/.test(document.getElementById('cbMcap').textContent || '') &&
        !!document.querySelector('#cbMcap .dl-prov') && !!document.querySelector('#cbMcap .gs-u')
    };
  });
  ok('the command bar carries a two-segment universe switch with exactly one pressed',
    uniSw.a.sw === 2 && uniSw.a.pressed === 1, JSON.stringify(uniSw.a));
  ok('switching universe changes the figure and the label together, and is reversible',
    uniSw.b.v !== uniSw.a.v && uniSw.b.u !== uniSw.a.u && uniSw.c.v === uniSw.a.v && uniSw.c.u === uniSw.a.u,
    JSON.stringify([uniSw.a, uniSw.b, uniSw.c]));
  ok('every universe keeps its provenance chip through the switch',
    uniSw.a.prov && uniSw.b.prov && uniSw.c.prov, JSON.stringify(uniSw));
  ok('the price ribbon still HOLDS all three aggregates it stopped showing, '
     + 'with their universe label and their freshness chip',
    uniSw.tapeAgg >= 3 && uniSw.tapeAgg % 3 === 0 && uniSw.tapeKeeps && uniSw.tapeLabel && uniSw.tapeProv,
    JSON.stringify(uniSw));   /* the marquee duplicates its whole track so the loop is seamless */
  ok('v159 · with the record gone the command bar states the figures on Markets too, chip and label intact',
    uniSw.cbAggShown && uniSw.cbAggKeeps, JSON.stringify(uniSw));


  // ================================================================= v157a · phone strips
  // Owner report, 12 Sep 2026, two screenshots at 390px: the What's-New banner filled the
  // screen (a flex row that never wrapped — the summary in a 54px column 224px tall, the ✕
  // at x=410 on a 390px viewport) and the hero stat strip put its third card alone beside a
  // void (.stat:last-child stopped matching once .dl-snapfoot was appended after it). Both
  // are one line now, extended by a chevron. Every number below was read FAILING against
  // the v157 payload before the fix was accepted (banner 244px, strip 289px, card 177px).
  console.log('== v157a · phone strips');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1500);
  const PHONE = () => {
    const R = e => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
    const vis = e => !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0;
    const b = document.getElementById('dlNew'), s = document.querySelector('#page-markets .stat-strip');
    const span = b && b.querySelector(':scope > span'), x = b && b.querySelector('.x'), bm = b && b.querySelector('.dl-more');
    const cards = s ? [...s.querySelectorAll(':scope > .stat')] : [], sm = s && s.querySelector('.dl-more'), foot = s && s.querySelector('.dl-snapfoot');
    return {
      vw: innerWidth, sw: document.documentElement.scrollWidth,
      banner: b ? { r: R(b), open: b.classList.contains('is-open'), spanH: span ? R(span).h : null,
        spanClipped: !!span && span.scrollWidth > span.clientWidth + 1, ellipsis: !!span && getComputedStyle(span).textOverflow === 'ellipsis',
        xRight: x ? R(x).x + R(x).w : null, goShown: [...b.querySelectorAll('.go')].filter(vis).length,
        chev: bm ? { shown: vis(bm), expanded: bm.getAttribute('aria-expanded'), label: bm.getAttribute('aria-label') } : null } : null,
      strip: s ? { r: R(s), open: s.classList.contains('is-open'), tracks: getComputedStyle(s).gridTemplateColumns.split(' ').length,
        tops: [...new Set(cards.map(c => R(c).y))].length, widths: cards.map(c => R(c).w),
        shorts: cards.map(c => (c.querySelector('.k') || {}).getAttribute && c.querySelector('.k').getAttribute('data-short')),
        clipped: cards.filter(c => { const v = c.querySelector('.v'); return v && v.scrollWidth > v.clientWidth + 1; }).length,
        marks: [...s.querySelectorAll('.dl-dis')].map(m => ({ shown: vis(m), title: /spread ±/.test(m.getAttribute('title') || ''), text: (m.textContent || '').trim() })),
        footShown: vis(foot), inline: s.getAttribute('style') || '',
        chev: sm ? { shown: vis(sm), expanded: sm.getAttribute('aria-expanded') } : null } : null
    };
  };
  const ph1 = await ev(PHONE);
  ok('phone · the What’s-New banner is present to be measured (dl.seen is unset in the harness)', !!ph1.banner, JSON.stringify(ph1.banner));
  ok('phone · the banner is ONE line under 60px tall (shipped: 244px), its summary on a single line with an ellipsis, the two links folded away',
    ph1.banner && ph1.banner.r.h <= 60 && ph1.banner.spanH <= 20 && ph1.banner.ellipsis && ph1.banner.goShown === 0, JSON.stringify(ph1.banner));
  ok('phone · the banner’s dismiss ✕ is inside the 390px viewport (shipped: x=410) and the page does not scroll sideways',
    ph1.banner && ph1.banner.xRight <= 390 && ph1.sw <= ph1.vw, JSON.stringify({ xRight: ph1.banner && ph1.banner.xRight, sw: ph1.sw }));
  ok('phone · the banner carries a chevron that says what it does (aria-expanded=false, a label)',
    ph1.banner && ph1.banner.chev && ph1.banner.chev.shown && ph1.banner.chev.expanded === 'false' && /release note/.test(ph1.banner.chev.label), JSON.stringify(ph1.banner && ph1.banner.chev));
  ok('phone · the hero stat strip is ONE row under 64px tall (shipped: 289px): three figures on one line, no card wider than a third',
    ph1.strip && ph1.strip.r.h <= 64 && ph1.strip.tops === 1 && ph1.strip.widths.length === 3 && ph1.strip.widths.every(w => w <= 130) && ph1.strip.tracks === 4, JSON.stringify(ph1.strip));
  ok('phone · the folded strip labels read MCAP · 24H VOL · BTC.D, no figure is clipped, and no inline track override survives (v157a unbalance)',
    ph1.strip && String(ph1.strip.shorts) === 'MCAP,24H VOL,BTC.D' && ph1.strip.clipped === 0 && ph1.strip.inline === '', JSON.stringify(ph1.strip));
  ok('phone · a contested figure keeps its mark AT the number while folded (v155-E law): shown, spread reachable from its title',
    ph1.strip && ph1.strip.marks.length >= 2 && ph1.strip.marks.every(m => m.shown && m.title && /sources differ/.test(m.text)), JSON.stringify(ph1.strip && ph1.strip.marks));
  ok('phone · the provenance foot is folded with the strip and the strip’s chevron is collapsed',
    ph1.strip && ph1.strip.footShown === false && ph1.strip.chev && ph1.strip.chev.shown && ph1.strip.chev.expanded === 'false', JSON.stringify(ph1.strip && ph1.strip.chev));
  // extend both from their chevrons
  await ev(() => { document.querySelectorAll('#dlNew .dl-more, #page-markets .stat-strip .dl-more').forEach(m => m.click()); });
  await page.waitForTimeout(500);
  const ph2 = await ev(PHONE);
  ok('phone · the chevron extends the banner: the full summary wraps unclipped on its own line and the two links appear, ✕ still on screen',
    ph2.banner && ph2.banner.open && ph2.banner.spanH > 20 && !ph2.banner.spanClipped && ph2.banner.goShown === 2 && ph2.banner.xRight <= 390 && ph2.banner.chev.expanded === 'true',
    JSON.stringify(ph2.banner));
  ok('phone · the chevron extends the strip: the third card spans the whole row (shipped: 177px beside 177px of nothing) and the provenance foot is back',
    ph2.strip && ph2.strip.open && ph2.strip.widths[2] >= ph2.strip.r.w - 2 && ph2.strip.footShown === true && ph2.strip.chev.expanded === 'true'
      && ph2.strip.marks.every(m => m.shown), JSON.stringify(ph2.strip));
  // fold them again from the same chevrons, then rotate through landscape and back
  await ev(() => { document.querySelectorAll('#dlNew .dl-more, #page-markets .stat-strip .dl-more').forEach(m => m.click()); });
  await page.waitForTimeout(300);
  const ph3 = await ev(PHONE);
  ok('phone · the same chevrons fold both back to one line', ph3.banner && !ph3.banner.open && ph3.banner.r.h <= 60 && ph3.strip && !ph3.strip.open && ph3.strip.r.h <= 64,
    JSON.stringify({ b: ph3.banner && ph3.banner.r, s: ph3.strip && ph3.strip.r }));
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(1200);
  const land = await ev(() => { const s = document.querySelector('#page-markets .stat-strip'), m = s.querySelector('.dl-more'); return { inline: s.getAttribute('style') || '', tracks: getComputedStyle(s).gridTemplateColumns.split(' ').length, chev: m ? getComputedStyle(m).display : 'missing' }; });
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(1200);
  const ph4 = await ev(PHONE);
  ok('phone · rotating to landscape lets the orphan-row balancer lay the strip out (its inline tracks), and rotating back removes them again — one line, four tracks',
    /grid-template-columns/.test(land.inline) && land.chev === 'none' && ph4.strip && ph4.strip.inline === '' && ph4.strip.tracks === 4 && ph4.strip.r.h <= 64,
    JSON.stringify({ land, back: ph4.strip && { inline: ph4.strip.inline, tracks: ph4.strip.tracks, h: ph4.strip.r.h } }));
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(800);
  const wide = await ev(() => { const b = document.getElementById('dlNew'), s = document.querySelector('#page-markets .stat-strip');
    const d = e => e ? getComputedStyle(e).display : 'missing';
    return { bChev: b ? d(b.querySelector('.dl-more')) : null, sChev: d(s.querySelector('.dl-more')), bH: b ? Math.round(b.getBoundingClientRect().height) : null, foot: d(s.querySelector('.dl-snapfoot')) }; });
  ok('desktop · nothing of this applies at 1440: no chevrons, the banner one line, the provenance foot shown',
    wide.bChev === 'none' && wide.sChev === 'none' && wide.bH <= 48 && wide.foot !== 'none', JSON.stringify(wide));

  // ================================================================ v158 · tidy
  // The owner's seven screenshots of 12 Sep 2026, each pinned so it cannot come back.
  console.log('== v158 · the seven screenshots');
  await ev(() => { try { localStorage.setItem('coinbridge.welcomed', '1'); } catch (e) {} try { closeModal(); } catch (e) {} });
  await ev(() => nav('markets'));
  await page.waitForTimeout(1500);

  // 1 · the command palette: a real field, no ring cutting across the panel's corners
  await ev(() => openCmdk());
  await page.waitForTimeout(1200);
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');   /* keyboard focus → :focus-visible applies */
  const pal = await ev(() => {
    const i = document.getElementById('cmdkIn'), b = document.querySelector('.cmdk');
    const cs = getComputedStyle(i), r = i.getBoundingClientRect(), br = b.getBoundingClientRect();
    return { h: r.height, padL: parseFloat(cs.paddingLeft), focusVisible: i.matches(':focus-visible'), active: document.activeElement === i,
      outline: cs.outlineStyle, outlineW: parseFloat(cs.outlineWidth) || 0, shadow: cs.boxShadow, radius: parseFloat(cs.borderRadius) || 0,
      glyph: /svg/.test(cs.backgroundImage), fits: r.left >= br.left - 0.5 && r.right <= br.right + 0.5,
      panelRing: getComputedStyle(b).boxShadow !== 'none', footer: getComputedStyle(b, '::after').content, sel: !!document.querySelector('.cmdk-item.sel') };
  });
  ok('screenshot 1 · the palette\'s search field is a field: ≥44px tall, a search glyph, the caret inset past it',
    pal.h >= 44 && pal.padL >= 40 && pal.glyph, JSON.stringify(pal));
  ok('screenshot 1 · keyboard focus draws NO ring on the field itself (the panel carries the focus ring)',
    pal.active && pal.focusVisible && (pal.outline === 'none' || pal.outlineW === 0) && pal.shadow === 'none' && pal.panelRing, JSON.stringify(pal));
  ok('screenshot 1 · the field spans the panel edge to edge with square corners under the panel\'s rounded ones, and the palette states its keys',
    pal.fits && pal.radius === 0 && /navigate/.test(pal.footer), JSON.stringify(pal));
  await ev(() => closeCmdk());

  // 2 · the spotlight draws a WEEK, not the last two minutes of ticks
  const spot = await ev(() => {
    const c = bySym.BTC;
    const before = DLH7.series(c);
    for (let k = 0; k < 130; k++) tickEngine();            /* 195 s of session: the old chart was all ticks by now */
    updateSpotlight();
    const after = DLH7.series(c);
    const flat = { sym: 'ZZZ', price: 100, spark: new Array(336).fill(100), hist: new Array(400).fill(100) };
    const distinct = xs => new Set(xs.map(v => Math.round(v * 100))).size;
    return { before: before && before.length, after: after && after.length, distinct: after && distinct(after), last: after && after[after.length - 1], price: c.price,
      caption: document.getElementById('sl-sym').textContent, histTail: c.hist.slice(-84).length, histTailDistinct: distinct(c.hist.slice(-84)),
      flatSeries: DLH7.series(flat), flatLabel: DLH7.label(flat), stripped: DLH7.observed([5, 5, 5, 5].concat(Array.from({ length: 60 }, (_, i) => 5 + i * 0.1))).length };
  });
  ok('screenshot 2 · after 130 ticks the "7-day" line is still the observed week (≥100 points, ≥50 distinct values), ending at the live price',
    spot.after >= 100 && spot.distinct >= 50 && Math.abs(spot.last - spot.price) < 1e-6 && /7-day/.test(spot.caption), JSON.stringify(spot));
  ok('screenshot 2 · the tick ring it used to draw is a staircase by then (≤ 8 distinct values in 84 samples) — proof the old series was the defect',
    spot.histTailDistinct <= 8, JSON.stringify({ histTailDistinct: spot.histTailDistinct }));
  ok('screenshot 2 · a padded placeholder is refused, the caption says "· live", and a front-padded sparkline loses its flat run (one point of it kept as the start)',
    spot.flatSeries === null && /· live$/.test(spot.flatLabel) && spot.stripped === 60, JSON.stringify({ f: spot.flatSeries, l: spot.flatLabel, s: spot.stripped }));

  // 6 · results, not a row of red chips — on the record strip and the command bar
  const quiet = await ev(async () => {
    // v159 · the record strip carried these marks; the command bar carries them now, and its
    // default universe is the tracked set. The sources differ on the WHOLE market, so ask the
    // bar for that universe before measuring how loudly it says so.
    const g = document.getElementById('cbCmd');
    const gb = g.querySelector('.gs-uni button[data-uni="global"]');
    if (gb && gb.getAttribute('aria-pressed') !== 'true') { gb.click(); await new Promise(r => setTimeout(r, 500)); }
    const down = getComputedStyle(document.documentElement).getPropertyValue('--down').trim();
    const rgb = hex => { const n = parseInt(hex.replace('#', ''), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
    const tiny = e => { const r = e.getBoundingClientRect(); return r.width <= 1.5 && r.height <= 1.5; };
    const dis = [...g.querySelectorAll('.dl-dis')];
    const chips = [...g.querySelectorAll('.dl-prov.contested')];
    return {
      dis: dis.length, disText: dis.map(e => e.textContent.trim()), disWords: dis.every(e => !!e.querySelector('.dl-dis-w') && tiny(e.querySelector('.dl-dis-w'))),
      disNarrow: dis.every(e => e.getBoundingClientRect().width <= 64), disNotRed: dis.every(e => getComputedStyle(e).color !== rgb(down) && getComputedStyle(e).borderTopWidth === '0px'),
      uniHidden: [...g.querySelectorAll('.gs-u')].length > 0 && [...g.querySelectorAll('.gs-u')].every(tiny),
      srcHidden: [...g.querySelectorAll('.dl-src')].every(tiny),
      cbUniHidden: [...document.querySelectorAll('#cbCmd .gs-u')].every(tiny),
      chipNotRed: chips.length > 0 && chips.every(e => getComputedStyle(e).color !== rgb(down) && getComputedStyle(e, '::after').content.indexOf('±') >= 0 && !!e.querySelector('.dl-dis-w')),
      chipStillContested: chips.every(e => /sources differ/.test(e.textContent)),
      switchVisible: !tiny(g.querySelector('.gs-uni')), figures: (g.innerText.match(/\$[\d.]+[TBM]/g) || []).length
    };
  });
  ok('screenshot 6 · a contested figure carries a small muted ±x.x% (words for screen readers), not a red bordered chip',
    quiet.dis >= 2 && quiet.disWords && quiet.disNarrow && quiet.disNotRed && quiet.disText.every(t => /sources differ ±[\d.]+%/.test(t)), JSON.stringify(quiet));
  ok('screenshot 6 · the universe chips and the source note are off the command bar (the switch names the universe)',
    quiet.uniHidden && quiet.srcHidden && quiet.cbUniHidden && quiet.switchVisible, JSON.stringify(quiet));
  ok('screenshot 6 · the provenance chip over a contested figure is amber + ±, still classed contested, no red words',
    quiet.chipNotRed && quiet.chipStillContested && quiet.figures >= 2, JSON.stringify(quiet));

  // 3 · 5 · 4 · 7 · the Proof ledger stays inside its card; the board ends on one line
  await ev(() => { try { chainAdd('trade', { side: 'buy', sym: 'BTC', qty: 0.01, px: 60000 }); chainAdd('daily-survived', { day: 1 }); } catch (e) { window.__chainErr = String(e); } });
  await ev(() => nav('portfolio'));
  await page.waitForTimeout(4500);
  const ledger = () => ev(() => {
    const cb = document.getElementById('chainBody'), card = document.getElementById('chainCard');
    if (!cb || !card) return { missing: true };
    const cr = card.getBoundingClientRect(), bs = [...cb.querySelectorAll('.btn.sm')].map(b => b.getBoundingClientRect());
    const head = card.firstElementChild.getBoundingClientRect();
    return { err: window.__chainErr || null, n: bs.length, acts: !!cb.querySelector('.chainacts'), cardW: Math.round(cr.width),
      inside: bs.length > 0 && bs.every(b => b.left >= cr.left - 0.5 && b.right <= cr.right + 0.5),
      oneLine: bs.every(b => b.height <= 40), noScroll: cb.scrollWidth <= cb.clientWidth + 1 && card.scrollWidth <= card.clientWidth + 1,
      chipsInside: [...cb.querySelectorAll('.blk')].every(e => e.getBoundingClientRect().right <= cr.right + 0.5),
      headInside: head.right <= cr.right + 0.5, vw: innerWidth };
  });
  const L1 = await ledger();
  ok('screenshots 3/5 · every Proof-ledger action sits inside the card, on one line each, nothing clipped (desktop column)',
    !L1.missing && !L1.err && L1.n === 5 && L1.acts && L1.inside && L1.oneLine && L1.noScroll && L1.chipsInside && L1.headInside, JSON.stringify(L1));
  const board = await ev(() => {
    const host = document.querySelector('#page-portfolio .dlc-host'); if (!host) return { missing: true };
    const cols = [...host.querySelectorAll(':scope > .dlc-col')];
    const bottoms = cols.map(c => c.getBoundingClientRect().bottom), lasts = cols.map(c => c.lastElementChild.getBoundingClientRect().bottom);
    return { even: host.dataset.dlEven, n: cols.length, spread: Math.max(...bottoms) - Math.min(...bottoms), lastSpread: Math.max(...lasts) - Math.min(...lasts), counts: cols.map(c => c.children.length) };
  });
  ok('screenshots 4/7 · the portfolio board\'s columns end on ONE line (bottom-edge spread ≤ 2px) with every card taking its share',
    !board.missing && board.even === '1' && board.n >= 2 && board.spread <= 2 && board.lastSpread <= 16, JSON.stringify(board));
  /* the COLUMN edges are what a reader sees and they must be exact (≤2px). The last card's own
     bottom is allowed 16px of slack: a card whose content has a min-height of its own cannot
     always absorb the final few pixels, and chasing that would mean stretching content. */
  await page.setViewportSize({ width: 393, height: 852 });
  await page.waitForTimeout(1800);
  const L2 = await ledger();
  ok('screenshots 3/5 · and on a 393px phone the actions wrap inside the card too',
    !L2.missing && L2.n === 5 && L2.inside && L2.oneLine && L2.noScroll && L2.chipsInside && L2.vw === 393, JSON.stringify(L2));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(1200);
  ok('no page errors across the v158 checks', h.errors.length === 0, h.errors.slice(0, 3).join(' | '));

  const fails = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - fails} passed · ${fails} failed`);
  await h.close();
  process.exit(fails);
})().catch(e => { console.error(e); process.exit(99); });
