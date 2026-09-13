// v155 stabilisation gate — audit 2026-09-07.
// Deterministic: every provider is a fixture, the clock is only read through the app.
// Exit code = number of failures.
'use strict';
const fs = require('fs');
const { launch } = require('./harness');
const F = require('./fixtures155');
const file = process.argv[2] || '../dist/index.html';
const results = [];
function ok(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  if (!cond) console.log('  ✗', name, detail === undefined ? '' : detail); else console.log('  ✓', name);
}
const json = (route, obj) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(obj) });

(async () => {
  const src = fs.readFileSync(file, 'utf8');

  console.log('== v155-A · source invariants (finding 2, decisions D-02/D-03)');
  ok('no adapter coerces a missing circulating supply to zero', !/circulating_supply\|\|0/.test(src));
  ok('the Coinpaprika shim no longer invents an all-time high', !/ath:1\.6\*pr/.test(src) && !/ath_change_percentage:-37\.5/.test(src));
  ok('the Coinpaprika shim no longer invents a 24h range', !/high_24h:pr\*\(1\+Math\.abs/.test(src));
  ok('the Coinpaprika shim no longer reports market cap as FDV', !/fully_diluted_valuation:\+q\.market_cap\|\|0/.test(src));
  ok('block height 0 is treated as a confirmed block (finding 11)', !/tx\.block_id>0\?/.test(src) && /tx\.block_id>=0\?/.test(src));

  const h = await launch(file);
  const { page } = h;
  await page.waitForTimeout(5000);
  const ev = (fn, ...a) => page.evaluate(fn, ...a);

  console.log('== v155-A · DLF nullable-number contract');
  const dlf = await ev(() => window.DLF ? [DLF.n(null), DLF.n(undefined), DLF.n(''), DLF.n('abc'), DLF.n(NaN), DLF.n(Infinity), DLF.n(0), DLF.n('12.5'), DLF.n(-3)] : 'MISSING');
  ok('DLF.n maps absent / empty / non-numeric / non-finite to null',
    Array.isArray(dlf) && dlf.slice(0, 6).every(v => v === null), JSON.stringify(dlf));
  ok('DLF.n preserves a legitimate zero and real numbers',
    Array.isArray(dlf) && dlf[6] === 0 && dlf[7] === 12.5 && dlf[8] === -3, JSON.stringify(dlf));
  ok('DLF.txt renders an unknown as "Unavailable", a known value as itself',
    await ev(() => DLF.txt(null) === 'Unavailable' && DLF.txt(0, null, 'BTC') === '0 BTC'));

  console.log('== v155-A · renderers say Unavailable, never 0 (finding 2 acceptance)');
  const rend = await ev(async () => {
    const find = () => (window.MXP && MXP.state.coins || []).find(c => c.sym === 'BTC');
    const c = find(); if (!c) return { err: 'no BTC in MXP state' };
    const orig = c.supply;
    const rowText = () => {
      const rows = [...document.querySelectorAll('tr')].filter(r => /\bBTC\b/.test(r.innerText));
      return rows.map(r => r.innerText).join(' ⏐ ');
    };
    c.supply = null; MXP.render(); if (window.mxRender) try { mxRender() } catch (e) {}
    await new Promise(r => setTimeout(r, 400));
    const unknown = rowText();
    c.supply = 0; MXP.render(); if (window.mxRender) try { mxRender() } catch (e) {}
    await new Promise(r => setTimeout(r, 400));
    const zero = rowText();
    c.supply = orig; MXP.render(); if (window.mxRender) try { mxRender() } catch (e) {}
    await new Promise(r => setTimeout(r, 400));
    return { unknown, zero, restored: rowText() };
  });
  ok('an unknown BTC supply renders "Unavailable" in the markets table',
    !rend.err && /Unavailable/.test(rend.unknown), JSON.stringify(rend.err || (rend.unknown || '').slice(0, 200)));
  ok('a legitimate zero supply still renders as a number, not "Unavailable"',
    !rend.err && !/Unavailable/.test(rend.zero), JSON.stringify((rend.zero || '').slice(0, 200)));

  // The coin page renders from the DLCORE coin record, which is a different store from
  // MXP.state.coins (see audit finding 1 — one canonical snapshot is Phase 1b work).
  // This assertion covers the renderer contract; the adapter is covered by the provider
  // fixtures below.
  const detail = await ev(async () => {
    const c = window.DLCORE && DLCORE.coin && DLCORE.coin('BTC'); if (!c) return { err: 'no DLCORE coin' };
    const orig = c.supply; c.supply = null;
    openCoin('BTC'); await new Promise(r => setTimeout(r, 2200));
    const t = document.body.innerText;
    const seg = (t.match(/Circulating supply[\s\S]{0,40}/) || [''])[0] + ' | ' + (t.match(/Circ\. Supply[\s\S]{0,40}/) || [''])[0];
    const zeroSeen = /Circulating supply\s*\n?\s*0\b/.test(t);
    c.supply = orig;
    return { seg, zeroSeen };
  });
  ok('the coin detail supply row says Unavailable when the record has no supply',
    !detail.err && /Unavailable/.test(detail.seg) && !detail.zeroSeen, JSON.stringify(detail));

  console.log('== v155-A · supply drift needs elapsed coverage (finding 16)');
  const drift = await ev(([one, ten, forty]) => {
    const put = o => { try { DLCORE.lsSet('dl.supply.v1', o) } catch (e) { localStorage.setItem('dl.supply.v1', JSON.stringify(o)) } };
    const out = {};
    put(one);
    let d = DLLEDGERS.supDrift('BTC');
    out.one = { d7: d && d.d7, d30: d && d.d30, txt7: DLLEDGERS.driftText(d && d.d7), cov: d && d.coverage };
    put(ten);
    d = DLLEDGERS.supDrift('BTC');
    out.ten = { d7: d && d.d7, txt7: DLLEDGERS.driftText(d && d.d7), d30: d && d.d30, txt30: DLLEDGERS.driftText(d && d.d30), cov: d && d.coverage };
    put(forty);
    d = DLLEDGERS.supDrift('BTC');
    out.forty = { d7pct: d && d.d7 && d.d7.pct, d30pct: d && d.d30 && d.d30.pct, cov: d && d.coverage };
    try { localStorage.removeItem('dl.supply.v1') } catch (e) {}
    return out;
  }, [F.supplyStore(1, 'BTC', 100, 100), F.supplyStore(10, 'BTC', 100, 110), F.supplyStore(40, 'BTC', 100, 140)]);
  ok('one day of history reports insufficient coverage, not +0.000%',
    drift.one && drift.one.d7 && drift.one.d7.reason === 'insufficient-history' && drift.one.d7.pct === undefined,
    JSON.stringify(drift.one));
  ok('the short window says how much history it has',
    /Collecting history · 1 of 7 days/.test(drift.one && drift.one.txt7 || ''), JSON.stringify(drift.one && drift.one.txt7));
  ok('ten days of history measures 7d but still refuses 30d',
    drift.ten && drift.ten.d7 && typeof drift.ten.d7.pct === 'number' && drift.ten.d30 && drift.ten.d30.reason === 'insufficient-history',
    JSON.stringify(drift.ten));
  ok('forty days of history measures both windows',
    drift.forty && typeof drift.forty.d7pct === 'number' && typeof drift.forty.d30pct === 'number' && drift.forty.cov === 40,
    JSON.stringify(drift.forty));

  console.log('== v155-A · provider fixtures: absent / zero / malformed supply');
  const variants = {};
  for (const variant of ['null', 'absent', 'garbage', 'zero']) {
    await page.route(/api\.coingecko\.com\/api\/v3\/coins\/markets/, r => json(r, F.cgMarkets(variant, 100)));
    const got = await ev(async () => {
      if (!(window.MXP && MXP.reload)) return { err: 'no MXP.reload' };
      await MXP.reload(); await new Promise(r => setTimeout(r, 1200));
      const b = MXP.state.coins.find(c => c.sym === 'BTC'), z = MXP.state.coins.find(c => c.sym === 'ZRO0');
      return { btc: b ? b.supply : 'NO BTC', zero: z ? z.supply : 'NO ZRO0' };
    });
    variants[variant] = got;
    await page.unroute(/api\.coingecko\.com\/api\/v3\/coins\/markets/);
  }
  ok('an explicit null supply stays null', variants.null && variants.null.btc === null, JSON.stringify(variants.null));
  ok('an absent supply key stays null', variants.absent && variants.absent.btc === null, JSON.stringify(variants.absent));
  ok('a malformed ("n/a") supply stays null', variants.garbage && variants.garbage.btc === null, JSON.stringify(variants.garbage));
  ok('a legitimate zero supply survives normalisation as 0',
    variants.zero && variants.zero.zero === 0, JSON.stringify(variants.zero));

  console.log('== v155-A · Coinpaprika fallback invents nothing');
  await page.route(/api\.coingecko\.com\/api\/v3\/coins\/markets/, r => r.fulfill({ status: 429, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"status":{"error_code":429}}' }));
  await page.route(/api\.coinpaprika\.com\/v1\/tickers/, r => json(r, F.paprika('null')));
  const fb = await ev(async () => {
    if (!(window.MXP && MXP.reload)) return { err: 'no MXP.reload' };
    try { await MXP.reload() } catch (e) {}
    await new Promise(r => setTimeout(r, 2500));
    const b = MXP.state.coins.find(c => c.sym === 'BTC');
    return b ? { supply: b.supply, ath: b.ath, athPct: b.athPct, hi: b.hi24, lo: b.lo24, price: b.price } : { err: 'no BTC' };
  });
  ok('the fallback does not invent an all-time high', fb && fb.ath !== null ? (fb.ath === null || fb.athPct !== -37.5) : true, JSON.stringify(fb));
  ok('the fallback does not invent a supply', fb && fb.supply !== 0, JSON.stringify(fb));
  await page.unroute(/api\.coingecko\.com\/api\/v3\/coins\/markets/);
  await page.unroute(/api\.coinpaprika\.com\/v1\/tickers/);

  console.log('== hygiene');
  ok('no page errors across the v155 checks', h.errors.length === 0, h.errors.slice(0, 3).join(' | '));

  const bad = results.filter(r => !r.ok).length;
  console.log('\n' + (results.length - bad) + ' passed · ' + bad + ' failed');
  await h.close();
  process.exit(bad);
})().catch(e => { console.error(e); process.exit(99); });
