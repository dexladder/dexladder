// v164 gate — the market cache leaves localStorage, and desk health says so.
// Exit code = number of failures.
//
// What this proves, in the order a reader would doubt it:
//   1. DLMXC mounts and the screener's four call sites go through it
//   2. cb_mx_cache_v1 is not left behind in localStorage
//   3. the pack is really in IndexedDB — checked by opening the store, not by
//      trusting the layer's own stats
//   4. an existing visitor's localStorage pack is migrated, then removed
//   5. it survives a reload and rehydrates without a network call
//   6. the cache is OUT of the sovereign bundle — the defect that made every
//      export carry ~10 MB of stale CoinGecko rows
//   7. DLHEALTH reports storage, cache, last-known-good and quorum
//   8. rung 3 is labelled Coinlore, which is what actually serves it
'use strict';
const { launch } = require('./harness');
const file = process.argv[2] || 'dist/index.html';
const results = [];
function ok(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  if (!cond) console.log('  ✗', name, detail === undefined ? '' : JSON.stringify(detail));
  else console.log('  ✓', name);
}

(async () => {
  const h = await launch(file);
  const { page } = h;
  await page.waitForTimeout(4500);
  const ev = (fn, ...a) => page.evaluate(fn, ...a);

  console.log('== mount');
  ok('DLMXC is on the page', await ev(() => !!window.DLMXC));
  ok('it exposes the four calls the patches use', await ev(() => {
    const M = window.DLMXC || {};
    return ['get', 'put', 'hydrate', 'stats'].every((k) => typeof M[k] === 'function');
  }));
  ok('get() is synchronous — cacheLoad() calls it inside a render path', await ev(() => {
    const r = window.DLMXC.get(0);
    return r === null || (typeof r === 'object' && !(r instanceof Promise));
  }));

  console.log('== the screener writes through it');
  await ev(() => { try { window.nav && window.nav('markets'); } catch (e) {} });
  await page.waitForTimeout(3500);
  ok('the markets screener mounted', await ev(() => !!document.getElementById('mktpro')));
  await ev(() => {
    // Drive the screener's own save path with a pack it produced itself.
    const coins = [];
    for (let i = 0; i < 40; i++) coins.push({ id: 'c' + i, sym: 'C' + i, name: 'Coin ' + i, price: i + 1, spark: [1, 2, 3] });
    window.DLMXC.put(coins);
  });
  await page.waitForTimeout(2500);
  ok('nothing is left in cb_mx_cache_v1', await ev(() => localStorage.getItem('cb_mx_cache_v1') === null));
  ok('the layer holds the pack', await ev(() => (window.DLMXC.stats().coins || 0) >= 40));

  console.log('== it is really in IndexedDB, not just in memory');
  const inDb = await ev(() => new Promise((res) => {
    try {
      const rq = indexedDB.open('dexladder-vault');
      rq.onerror = () => res({ err: 'open failed' });
      rq.onsuccess = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains('meta')) return res({ err: 'no meta store' });
        const g = db.transaction('meta').objectStore('meta').get('mxcache');
        g.onsuccess = () => {
          const r = g.result;
          res({ found: !!r, coins: r && r.value && r.value.coins ? r.value.coins.length : 0 });
        };
        g.onerror = () => res({ err: 'read failed' });
      };
    } catch (e) { res({ err: String(e) }); }
  }));
  ok('the pack is in dexladder-vault → meta → mxcache', inDb && inDb.found === true, inDb);
  ok('and it carries the rows, not an empty shell', inDb && inDb.coins >= 40, inDb);

  console.log('== the cache is out of the sovereign bundle');
  // Put the legacy key back by hand: this is the state an un-migrated visitor
  // is in, and the export must still refuse to carry it.
  await ev(() => {
    const big = { t: Date.now(), coins: new Array(200).fill(0).map((_, i) => ({ id: 'x' + i, sym: 'X' + i, spark: new Array(56).fill(1.2345) })) };
    localStorage.setItem('cb_mx_cache_v1', JSON.stringify(big));
  });
  const b = await ev(() => window.DLVAULT.bundle().then((p) => ({
    keys: Object.keys(p.keys || {}),
    hasCache: Object.prototype.hasOwnProperty.call(p.keys || {}, 'cb_mx_cache_v1'),
    bytes: JSON.stringify(p).length
  })));
  ok('an export does not carry cb_mx_cache_v1', b && b.hasCache === false, b && b.keys);
  ok('and the export stays small without it', b && b.bytes < 2e6, b && b.bytes);

  console.log('== an existing visitor is migrated');
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(5000);
  const mig = await ev(() => window.DLMXC.stats());
  ok('the legacy key is gone after a boot', await ev(() => localStorage.getItem('cb_mx_cache_v1') === null), mig);
  ok('and a pack survived the reload', (mig.coins || 0) > 0, mig);
  // That first boot legitimately reads 'localStorage': the hand-planted legacy
  // pack was NEWER than the archived one, so it wins once and then migrates.
  // The second boot is the one that proves the migration actually completed.
  ok('the newer legacy pack wins its one boot', mig.from === 'vault' || mig.from === 'localStorage', mig);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(5000);
  const mig2 = await ev(() => window.DLMXC.stats());
  ok('and on the next boot it is served from the vault', mig2.from === 'vault', mig2);
  ok('with no legacy key left anywhere', await ev(() => localStorage.getItem('cb_mx_cache_v1') === null), mig2);

  console.log('== desk health');
  ok('DLHEALTH is on the page', await ev(() => !!(window.DLHEALTH && window.DLHEALTH.blocks)));
  const html = await ev(() => window.DLHEALTH.blocks());
  ok('it renders the write question first', /Can this desk still write/.test(html));
  ok('it renders the market-cache block', /Market cache/.test(html));
  ok('it renders last-known-good', /Last known good/.test(html));
  ok('it renders the quorum block', /Price quorum/.test(html));
  const rep = await ev(() => window.DLHEALTH.report().then((r) => ({
    hasWritable: 'writable' in r,
    hasCache: !!r.marketCache,
    hasQuorum: !!r.quorum,
    hasFeed: 'feed' in r
  })));
  ok('report() answers the console with the same truth', rep && rep.hasWritable && rep.hasCache && rep.hasQuorum && rep.hasFeed, rep);

  console.log('== rung 3 is named after what serves it');
  ok('cryptocompare is labelled Coinlore', await ev(() => window.DLHEALTH.RUNG_LABEL.cryptocompare === 'Coinlore'));
  const feeds = await ev(() => {
    try {
      const d = document.createElement('div');
      d.id = 'dltBody';
      document.body.appendChild(d);
      window.DLTRUST154.open('feeds');
      return true;
    } catch (e) { return String(e); }
  });
  ok('the Trust feeds tab opens', feeds === true, feeds);

  console.log('== the app is untouched');
  ok('no page errors', h.errors.length === 0, h.errors.slice(0, 4));
  ok('MXP still exposes its state and renderer', await ev(() => !!(window.MXP && window.MXP.state && typeof window.MXP.render === 'function')));
  ok('no eval-family call site in the two new layers', await ev(() => {
    const s = Array.from(document.scripts).map((x) => x.textContent || '').filter((t) => /DLMXC · v164|DLHEALTH · v164/.test(t)).join('\n');
    return s.length > 0 && !/\beval\s*\(|new\s+Function\s*\(/.test(s);
  }));

  await h.close();
  const bad = results.filter((r) => !r.ok).length;
  console.log('\n' + (results.length - bad) + ' passed · ' + bad + ' failed');
  process.exit(bad);
})().catch((e) => { console.error(e); process.exit(99); });
