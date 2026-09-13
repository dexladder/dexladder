// DexLadder desks gate — perpetual futures and the Rewind backtester.
//
//   node test/gate-desks.js [dist/index.html]        exit code = number of failures
//
// Part A reads the shipped payload: the legacy DLSIM perps bodies delegate to DLAPP and their
// arithmetic is gone. Part B drives the payload in Chromium (mocked network) through the whole
// life of a position: preview → open → funding → stop-loss / liquidation → ledger, journal and
// proof chain — at a desktop and a phone width.
'use strict';
const fs = require('fs'), path = require('path');
const WEB = path.join(__dirname, '..');
const file = process.argv[2] || path.join(WEB, 'dist', 'index.html');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (detail ? '  ' + JSON.stringify(detail).slice(0, 500) : '')); } };
const rel = (a, b, e = 1e-9) => Math.abs(a - b) <= e * Math.max(1, Math.abs(b));

console.log('A · shipped payload');
const html = fs.readFileSync(file, 'utf8');
const del = ['openPerp(side){DLAPP.legacy.perps.open(side)}', 'closePerp(id){DLAPP.legacy.perps.close(id)}', 'tickPerps(){DLAPP.legacy.perps.tick()}',
  'renderPerps(){DLAPP.legacy.perps.render()}', 'mountPerp(){DLAPP.legacy.perps.mount()}', 'fundRate(sym){return DLAPP.legacy.perps.fundRate(sym)}', 'setLev(v){DLAPP.legacy.perps.setLeverage(v)}'];
ok('perps · every DLSIM perps body delegates to DLAPP.legacy.perps', del.every(s => html.includes('function ' + s)), del.filter(s => !html.includes('function ' + s)));
ok('perps · the old desk arithmetic is gone (direct S.bal write, 94% burn, funding outside the margin)', !html.includes('S.bal.USDT-=need') && !html.includes('mk*(1-.94/L)') && !html.includes('p.entry*(1-.94/p.lev)') && !html.includes('eqv=p.margin+(mk-p.entry)*p.qty*dir-(p.fund||0)'));
ok('perps · net worth counts open perps through the typed equity (one wrapper, delegating)', html.includes('portfolioUSD=function(){return _pf.apply(this,arguments)+DLAPP.legacy.perps.equityUSD()}'));
ok('perps · the journal labels a perp close; funding can no longer be switched off', html.includes('${DLAPP.legacy.perps.journalNote(j)}') && !html.includes('"Perp funding accrual"'));
ok('rewind · the desk ships as its own layer, opens through DLAPP, and registers on the desks rail and the palette',
  html.includes('window.DLREWIND=') || html.includes('window.DLREWIND ='), 'layer 42-rewind missing');
ok('rewind · the desk never writes the paper account (no S.bal / execFill in the replay layer)',
  !/DLREWIND[\s\S]{0,4000}?S\.bal/.test(html) && !/DLREWIND[\s\S]{0,4000}?execFill/.test(html));

(async () => {
  console.log('B · runtime (Chromium, mocked network)');
  const { launch } = require('./harness');
  for (const w of [1440, 393]) {
    const hh = await launch(file, { viewport: { width: w, height: 900 } });
    const { page, errors } = hh;
    await page.waitForTimeout(6000);
    const r = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms)), out = {}, P = DLAPP.perps;
      const type = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
      const bl = () => (S.chain && S.chain.bl) || [], H = 3600e3, txt = id => (document.getElementById(id) || {}).innerText || '';
      openCoin('BTC'); await wait(1500); DLSIM.mounts(); await wait(200);
      const card = document.getElementById('dlPerp');
      out.mount = { v: card && card.dataset.v, inSide: !!(card && card.closest('#page-coin .side')), overflow: document.documentElement.scrollWidth - innerWidth, cardOverflow: card ? card.scrollWidth - card.clientWidth : -1 };
      // preview = what opens
      type('dlpMargin', '100'); document.querySelector('#dlpLevSeg [data-value="10"]').click(); await wait(100);
      const prev = txt('dlpPrev'), liqTxt = (prev.match(/Liquidation price\s*([\d,.]+)/) || [])[1];
      const usdt0 = S.bal.USDT, nw0 = portfolioUSD(), chain0 = bl().length;
      document.getElementById('dlpLong').click(); await wait(200);
      const p = S.dlsim.perps[0];
      out.open = { n: S.dlsim.perps.length, lev: p && p.lev, dUSDT: S.bal.USDT - usdt0, cost: p && p.cashIn, fee: p && p.openFee, dNw: portfolioUSD() - nw0,
        liqPreview: liqTxt && +liqTxt.replace(/,/g, ''), liq: p && P.liqPrice(p), row: txt('txns').split('\n').find(l => /Perp Long .* · 10× · 1,000\.00 USDT position/.test(l)) || null,
        chain: bl().length - chain0, chainTy: (bl()[bl().length - 1] || {}).ty };
      // funding: pretend the position has been open since before the last settlement
      const m0 = p.margin, L0 = P.liqPrice(p), rate = DLAPP.legacy.perps.fundRate('BTC');
      p.lastFundingAt = Math.floor(Date.now() / (8 * H)) * 8 * H - 1; DLAPP.legacy.perps.tick(); await wait(100);
      const p1 = S.dlsim.perps[0];
      out.funding = { paid: m0 - p1.margin, expect: p1.qty * pairPrice('BTC', 'USDT') * rate, liqMoved: P.liqPrice(p1) !== L0 || rate === 0, row: /Funding BTC · [+−]/.test(txt('txns')) };
      // liquidation
      const usdt1 = S.bal.USDT, r0 = S.stats.realizedUSD, cashIn = p1.cashIn, px0 = bySym.BTC.price;
      bySym.BTC.price = P.liqPrice(p1) * 0.998; DLAPP.legacy.perps.tick(); await wait(200);
      const pm = document.getElementById('dlpPm');
      out.liq = { gone: S.dlsim.perps.length === 0, wallet: S.bal.USDT === usdt1, realized: S.stats.realizedUSD - r0, cashIn,
        pm: pm ? pm.querySelectorAll('li').length : 0, pmText: pm ? /maintenance margin/.test(pm.innerText) && /insurance fund/.test(pm.innerText) : false,
        journal: S.journal[0] && S.journal[0].perp && S.journal[0].perp.reason, row: /Liquidated .* · 10× · −/.test(txt('txns')), chainTy: (bl()[bl().length - 1] || {}).ty };
      bySym.BTC.price = px0;
      document.querySelector('#dlpPm button').click(); await wait(100); out.liq.dismissed = !document.getElementById('dlpPm') && !S.dlsim.perpPm;
      // a stop-loss exits first and costs less than the margin
      type('dlpMargin', '100'); document.querySelector('#dlpLevSeg [data-value="5"]').click(); await wait(50);
      const mk = pairPrice('BTC', 'USDT'); type('dlpSl', String(Math.round(mk * 1.05))); document.getElementById('dlpShort').click(); await wait(200);
      const s = S.dlsim.perps[0], r1 = S.stats.realizedUSD;
      bySym.BTC.price = mk * 1.06; DLAPP.legacy.perps.tick(); await wait(200); bySym.BTC.price = px0;
      out.stop = { opened: !!(s && s.sl), gone: S.dlsim.perps.length === 0, reason: S.journal[0] && S.journal[0].perp && S.journal[0].perp.reason, lost: r1 - S.stats.realizedUSD, cashIn: s && s.cashIn };
      // Beginner caps leverage, in words; Advanced opens 25× and walks the book
      type('dlpMargin', '100'); S.dlsim.lev = 25; DLAPP.legacy.perps.open('long'); await wait(100);
      out.cap = { refused: S.dlsim.perps.length === 0, toast: [...document.querySelectorAll('.toast')].map(t => t.innerText).find(t => /Beginner mode stops at 10×/.test(t)) || null };
      S.dlsim.mode = 'pro'; DLSIM.mounts(); await wait(100);
      type('dlpMargin', '4000'); S.dlsim.lev = 25; DLAPP.legacy.perps.open('long'); await wait(200);
      const a = S.dlsim.perps[0], mkNow = pairPrice('BTC', 'USDT');
      out.adv = { opened: !!a, lev: a && a.lev, mode: a && a.mode, slip: a && a.entry > mkNow, slider: !!document.getElementById('dlpLev'), partial: !!document.querySelector('#dlpList [data-perp] button[title^="Close half"]') };
      // the perp book is PERP_BOOK_DEPTH times the spot book: the same size pays less impact
      out.adv.depth = DLAPP.perps.PERP_BOOK_DEPTH;
      out.adv.perpDepth = Math.round(DLAPP.legacy.perps.book().depthUSD('BTC'));
      out.adv.spotDepth = Math.round(CBX.depthUSD('BTC'));
      if (a) DLAPP.legacy.perps.close(a.id);
      S.dlsim.mode = 'beginner';

      // an old DLSIM position is carried forward, not dropped
      const ep = pairPrice('ETH', 'USDT');   // at the live mark, so the tick does not liquidate it before we look
      S.dlsim.perps.push({ id: 'old001', sym: 'ETH', side: 'short', lev: 5, qty: 500 / ep, entry: ep, margin: 100, fee: 0.25, fund: 0.5, liq: 0, t: Date.now() - 5e6, lastF: Date.now() - 1e6 });
      DLAPP.legacy.perps.render(); await wait(100);
      const mg = S.dlsim.perps.find(x => x.id === 'old001');
      out.migrate = { v: mg && mg.v, margin: mg && mg.margin, cashIn: mg && mg.cashIn, shown: !!document.querySelector('[data-perp="old001"]') };
      if (mg) DLAPP.legacy.perps.close('old001');
      return out;
    });
    const o = r.open;
    ok(`${w}px · the perps desk mounts on the Terminal (v2), no horizontal overflow`, r.mount.v === '2' && r.mount.inSide && r.mount.overflow <= 1 && r.mount.cardOverflow <= 1, r.mount);
    ok(`${w}px · open: the wallet pays exactly margin + open fee; net worth moves only by the fee`, o.n === 1 && o.lev === 10 && rel(o.dUSDT, -o.cost) && rel(o.dNw, -o.fee, 1e-6), o);
    ok(`${w}px · the preview's liquidation price is the position's`, Math.abs(o.liqPreview - o.liq) < 0.01, o);
    ok(`${w}px · the open is a labelled ledger row and a proof-chain block`, !!o.row && o.chain >= 1 && o.chainTy === 'perp long', o);
    ok(`${w}px · funding settles from the margin at the live rate, moves the liquidation price, and is a ledger row`, rel(r.funding.paid, r.funding.expect, 1e-6) && r.funding.liqMoved && r.funding.row, r.funding);
    ok(`${w}px · the mark through the liquidation price force-closes: nothing comes back, realised = −cash in`, r.liq.gone && r.liq.wallet && rel(r.liq.realized, -r.liq.cashIn), r.liq);
    ok(`${w}px · the liquidation is explained (facts + three alternatives), journaled, chained, and dismissable`, r.liq.pm >= 7 && r.liq.pmText && r.liq.journal === 'liquidation' && r.liq.row && r.liq.chainTy === 'liquidated' && r.liq.dismissed, r.liq);
    ok(`${w}px · a stop-loss exits before liquidation and loses less than the margin`, r.stop.opened && r.stop.gone && r.stop.reason === 'stop-loss' && r.stop.lost > 0 && r.stop.lost < r.stop.cashIn, r.stop);
    ok(`${w}px · Beginner refuses 25× with the reason; Advanced opens it on the order book (slippage, slider, partial close)`, r.cap.refused && !!r.cap.toast && r.adv.opened && r.adv.lev === 25 && r.adv.mode === 'advanced' && r.adv.slip && r.adv.slider && r.adv.partial, [r.cap, r.adv]);
    ok(`${w}px · the perp book is ${r.adv.depth}× as deep as the spot book (a perp venue carries more resting size)`, r.adv.depth === 3 && r.adv.spotDepth > 0 && Math.abs(r.adv.perpDepth - 3 * r.adv.spotDepth) <= 1, r.adv);
    ok(`${w}px · an old DLSIM position is migrated (funding into the margin) and shown`, r.migrate.v === 2 && rel(r.migrate.margin, 99.5) && rel(r.migrate.cashIn, 100.25) && r.migrate.shown, r.migrate);
    // ---- Rewind: a whole replay, on candles the gate controls
    const rw = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms)), out = {};
      // a market that falls 30% then doubles — deterministic, so every fill price is checkable
      const now = Date.now(), H = 3600e3, rows = [];
      for (let i = 300; i > 0; i--) { const k = 300 - i, p = k < 150 ? 100 - k * 0.2 : 70 + (k - 150) * 0.4; rows.push([now - i * H, String(p), String(p * 1.01), String(p * 0.99), String(p * 1.002), '10']); }
      const C = window.DLCORE, orig = C.jget;
      C.jget = (u, o) => (/klines/.test(u) ? Promise.resolve({ data: rows, at: Date.now(), stale: false }) : orig(u, o));
      const btn = t => [...document.querySelectorAll('#btBar button')].find(b => t.test(b.title));
      const type = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
      openCoin('BTC'); await wait(1200);
      out.launcher = !!document.getElementById('dlRwCard');
      DLREWIND.open(); await wait(400);
      out.mounted = !!document.getElementById('btDesk');
      const usdt0 = S.bal.USDT, txns0 = S.txns.length;
      document.getElementById('btLoad').click(); await wait(1200);
      out.note = document.getElementById('btNote').innerText;
      btn(/One bar forward/).click(); await wait(80);
      const bars = DLAPP.legacy.rewind.mounted();
      // an order placed on the bar you see fills at the NEXT bar's open
      type('btSize', '10'); document.getElementById('btBuy').click(); await wait(80);
      out.resting = document.getElementById('btTicket').innerText.includes('at the next open');
      btn(/One bar forward/).click(); await wait(120);
      out.log1 = document.getElementById('btLog').innerText.split('\n')[0];
      // a limit below the market only fills when a bar trades through it
      type('btSize', '5'); document.querySelector('#btType [data-value="limit"]').click(); await wait(60);
      type('btPx', '50'); document.getElementById('btBuy').click(); await wait(60);
      out.limitRests = document.getElementById('btTicket').innerText.includes('limit @ 50');
      btn(/Ten bars forward/).click(); await wait(200);
      out.limitStill = document.getElementById('btTicket').innerText.includes('limit @ 50');
      btn(/Finish the run/).click(); await wait(1500);
      out.verdict = document.getElementById('btVerdict').innerText;
      out.metrics = document.getElementById('btMetrics').innerText;
      out.flat = /Run finished/i.test(out.verdict) && /Measured flat/i.test(out.verdict);
      out.untouched = S.bal.USDT === usdt0 && S.txns.length === txns0;
      out.chart = (() => { const c = document.getElementById('btChart'); return c && c.width > 300 && c.height > 200; })();
      out.overflow = document.documentElement.scrollWidth - innerWidth;
      // restart puts it back
      btn(/Back to the first bar/).click(); await wait(200);
      out.restarted = /bar 1 \/|not started/.test(document.getElementById('btBar').innerText);
      try { C.close('dlRewind'); } catch (e) {}
      await wait(200);
      C.jget = orig;
      out.bars = bars;
      return out;
    });
    ok(`${w}px · Rewind: a launcher on the Terminal, the desk mounts, and real candles load for the range`, rw.launcher && rw.mounted && /real bars from/.test(rw.note), rw);
    ok(`${w}px · Rewind: an order rests on the bar you see and fills at the NEXT bar's open`, rw.resting && /Bought 10\.0000 @ [\d.]+ at the open/.test(rw.log1 || ''), rw);
    ok(`${w}px · Rewind: a limit below the market keeps waiting until a bar trades through it`, rw.limitRests && rw.limitStill, rw);
    ok(`${w}px · Rewind: finishing closes out flat and the verdict leads with buy-and-hold`, rw.flat && /buy-and-hold/i.test(rw.verdict) && /No lookahead/i.test(rw.verdict), { flat: rw.flat, bh: /buy-and-hold/i.test(rw.verdict), look: /No lookahead/i.test(rw.verdict), tail: (rw.verdict || '').slice(-260) });
    ok(`${w}px · Rewind: the run is hypothetical — the paper account and its ledger are untouched`, rw.untouched, rw);
    ok(`${w}px · Rewind: the chart draws and the desk fits the width; restart returns to the first bar`, rw.chart && rw.overflow <= 1 && rw.restarted, rw);
    ok(`${w}px · no page error`, errors.length === 0, errors.slice(0, 3));
    await hh.close();
  }
  console.log(`\n${pass} passed · ${fail} failed`);
  process.exit(fail);
})().catch(e => { console.error(e); process.exit(99); });
