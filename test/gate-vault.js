// DLVAULT gate — the durable state layer, asserted in a real browser.
// Exit code = number of failures.
//
// What this proves, in the order a reader would doubt it:
//   1. the layer mounts, IndexedDB opens, and the save path is wrapped
//   2. the archive outlives the caps that made the desk forget
//   3. the equity curve survives its 120-point window with no duplicates
//   4. a v2 bundle is signed with the SAME key and verifies under the
//      EXISTING SV82 verifier — one signature scheme, not two
//   5. a tampered bundle is rejected by checksum before any signature work
//   6. the signing key is out of an export unless it is asked for
//   7. export → wipe → import restores keys AND archive
//   8. the app's own state machinery is untouched by all of it
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
  ok('no page errors after boot', h.errors.length === 0, h.errors.slice(0, 3));
  ok('DLVAULT is present', await ev(() => !!window.DLVAULT));
  ok('spec is the v2 sovereign export', await ev(() => window.DLVAULT.SPEC) === 'dexladder/sovereign-export/v2');

  const idb = await ev(() => window.DLVAULT.ready.then(db => !!db));
  ok('IndexedDB opened', idb);
  ok('it is a SEPARATE database from the app\'s own snapshot store', await ev(() => window.DLVAULT.DB !== window.DLVAULT.APP_DB && window.DLVAULT.DB === 'dexladder-vault'), await ev(() => window.DLVAULT.DB));
  ok('the archive is actually WRITABLE, not just connected', await ev(async () => {
    await window.DLVAULT.ready;
    await window.DLVAULT.setMeta('__gateprobe', { v: 1 });
    const r = await window.DLVAULT.meta('__gateprobe');
    return !!(r && r.value && r.value.v === 1) && window.DLVAULT.writable() === true;
  }));
  ok('the app\'s own dexladder/kv snapshot store is untouched', await ev(() => new Promise(res => {
    const r = indexedDB.open('dexladder');
    r.onsuccess = () => { const n = Array.from(r.result.objectStoreNames); r.result.close(); res(n.join(',') === 'kv'); };
    r.onerror = () => res(false);
  })));

  ok('_saveNow is wrapped', await ev(() => !!(window._saveNow && window._saveNow.__vault)));
  ok('flushP is wrapped', await ev(() => !!(window.flushP && window.flushP.__vault)));
  ok('the wrapper returns the original result', await ev(() => {
    // _saveNow returns undefined in the payload; what matters is that it
    // still runs and still writes, i.e. the wrapper did not swallow it.
    const before = localStorage.getItem('coinbridge.v1');
    S.bal = S.bal || {}; S.bal.__probe = 1;
    window._saveNow();
    const after = localStorage.getItem('coinbridge.v1');
    delete S.bal.__probe; window._saveNow();
    return before !== after && after.indexOf('__probe') > 0;
  }));

  console.log('\n== the archive outlives the caps');
  const cap = await ev(async () => {
    // 300 fills. The app pops S.txns at 80 and _savePayload slices 50, so
    // without an archive 250 of these are gone by construction.
    const t0 = Date.now() - 300000;
    for (let i = 0; i < 300; i++) {
      S.txns.unshift({ type: i % 2 ? 'buy' : 'sell', sym: 'BTC', amt: 0.001 * (i + 1), val: 60 + i, quote: 'USDT', t: t0 + i * 1000 });
      if (S.txns.length > 80) S.txns.pop();
      if (i % 20 === 0) window._saveNow();
    }
    window._saveNow();
    await window.DLVAULT.flush();
    const stored = JSON.parse(localStorage.getItem('coinbridge.v1') || '{}');
    const pg = await window.DLVAULT.page('txns', 0, 5000);
    return { ram: S.txns.length, ls: (stored.txns || []).length, archived: pg.total, first: pg.rows[0], last: pg.rows[pg.rows.length - 1] };
  });
  ok('RAM still capped at 80 — the app is unchanged', cap.ram <= 80, cap);
  ok('localStorage still capped at 50 — the save path is unchanged', cap.ls <= 50, cap);
  ok('the archive kept all 300 fills', cap.archived >= 300, cap);
  ok('the archive is newest-first', cap.first && cap.last && cap.first.t >= cap.last.t, { first: cap.first && cap.first.t, last: cap.last && cap.last.t });

  ok('a second save adds no duplicates', await ev(async () => {
    const a = (await window.DLVAULT.page('txns', 0, 5000)).total;
    window._saveNow(); window._saveNow();
    await window.DLVAULT.flush();
    const b = (await window.DLVAULT.page('txns', 0, 5000)).total;
    return a === b;
  }));

  console.log('\n== the equity curve outlives its window');
  const eq = await ev(async () => {
    S.equityHist = S.equityHist || [];
    for (let i = 0; i < 400; i++) {
      S.equityHist.push(10000 + i);
      if (S.equityHist.length > 120) S.equityHist = S.equityHist.slice(-120); // what the save does
      if (i % 10 === 0) window._saveNow();
    }
    window._saveNow();
    await window.DLVAULT.flush();
    const pg = await window.DLVAULT.page('equity', 0, 100000);
    const rows = pg.rows;
    // The archive also holds whatever the app itself put there before this
    // test ran, so assert on the 400 points this test is responsible for:
    // they must appear exactly once each, in order, with nothing interleaved.
    const mine = rows.slice(-400);
    let exact = mine.length === 400;
    for (let i = 0; i < mine.length && exact; i++) if (mine[i] !== 10000 + i) exact = false;
    return { total: pg.total, live: S.equityHist.length, exact, head: rows.slice(0, 3), tail: rows.slice(-3) };
  });
  ok('the window is still 120 points', eq.live <= 120, eq);
  ok('the archive holds the whole curve', eq.total >= 400, eq);
  ok('suffix-overlap merged it without duplicating or reordering', eq.exact, eq);

  console.log('\n== round trip');
  const idbPut = () => ev(async () => {
    const bun = await window.DLVAULT.bundle({ sovereign: true });
    await window.DLVAULT.setMeta('gvtest', bun);
    return { keys: Object.keys(bun.keys).length, tx: (await window.DLVAULT.page('txns', 0, 5000)).total };
  });
  // The bundle is parked in IndexedDB, not in a JS variable: if anything in
  // the app navigates while an import is in flight, the reloaded page can
  // still finish the job — which is also exactly what a real import does.
  const snap = await idbPut();
  const wiped = await ev(async () => {
    const ks = [];
    for (let i = 0; i < localStorage.length; i++) ks.push(localStorage.key(i));
    ks.forEach(k => { if (/^(coinbridge\.|cb\.|cb_|dl\.)/.test(k)) localStorage.removeItem(k); });
    await window.DLVAULT.apply({ spec: 'dexladder/sovereign-export/v2', archive: { txns: [], journal: [], alerts: [], equity: [] }, keys: {}, state: {} });
    return (await window.DLVAULT.page('txns', 0, 5000)).total;
  }).catch(() => -1);

  const doRestore = () => ev(async () => {
    const rec = await window.DLVAULT.meta('gvtest');
    const bun = rec && rec.value;
    if (!bun) return { err: 'test bundle vanished' };
    await window.DLVAULT.apply(bun);
    let after = 0;
    for (let i = 0; i < localStorage.length; i++) if (/^(coinbridge\.|cb\.|cb_|dl\.)/.test(localStorage.key(i))) after++;
    const afterTx = (await window.DLVAULT.page('txns', 0, 5000)).total;
    const pr = await window.DLVAULT.meta('preimport');
    const pre = !!(pr && pr.bundle);
    return { after, afterTx, pre };
  });

  let rt, navigated = false;
  try { rt = await doRestore(); }
  catch (e) {
    navigated = true;
    await page.waitForLoadState('load').catch(() => {});
    await page.waitForTimeout(5000);
    rt = await doRestore();
  }
  if (navigated) console.log('  (the app navigated mid-import; the restore was finished by the reloaded page)');
  ok('the test bundle survived', !rt.err, rt);
  rt.beforeKeys = snap.keys; rt.beforeTx = snap.tx; rt.wipedTx = wiped;

  ok('an import really wipes first', rt.wipedTx === 0, rt);
  ok('every desk key comes back', rt.after >= rt.beforeKeys, rt);
  ok('the whole archive comes back', rt.afterTx === rt.beforeTx && rt.afterTx >= 300, rt);
  ok('a pre-import snapshot was written before the overwrite', rt.pre, rt);

  ok('the import is reversible — undo puts the earlier desk back', await ev(async () => {
    const before = (await window.DLVAULT.page('txns', 0, 5000)).total;
    await window.DLVAULT.apply({ spec: 'dexladder/sovereign-export/v2', archive: { txns: [], journal: [], alerts: [], equity: [] }, keys: {}, state: {} });
    const wipedNow = (await window.DLVAULT.page('txns', 0, 5000)).total;
    const u = await window.DLVAULT.undoImport();
    const back = (await window.DLVAULT.page('txns', 0, 5000)).total;
    return u.ok === true && wipedNow === 0 && back === before && before > 0;
  }));

  console.log('\n== bundle v2');
  const b = await ev(async () => {
    const bun = await window.DLVAULT.bundle({ sovereign: false });
    return {
      spec: bun.spec, hasState: !!bun.state, keys: Object.keys(bun.keys || {}).length,
      hasSov: !!(bun.keys && bun.keys['coinbridge.sovkey']),
      counts: bun.counts, sig: !!bun.sig, pub: !!bun.pub,
      checksum: bun.checksum && bun.checksum.value, algo: bun.checksum && bun.checksum.algo,
      genesis: bun.genesisHash, app: bun.app
    };
  });
  ok('spec is v2', b.spec === 'dexladder/sovereign-export/v2', b.spec);
  ok('it carries every desk key, not just one', b.keys > 1, b.keys);
  ok('it carries the capped state too, for v1 readers', b.hasState);
  ok('it carries the archive counts', b.counts && b.counts.txns >= 300 && b.counts.equity >= 400, b.counts);
  ok('it is checksummed with SHA-256', /^[0-9a-f]{64}$/.test(String(b.checksum)) && b.algo === 'SHA-256', b.checksum);
  ok('it is signed', b.sig && b.pub);
  ok('the signing key is NOT in a plain export', b.hasSov === false);
  ok('it names the same genesis as the v1 bundle', b.genesis === '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f', b.genesis);

  ok('the EXISTING SV82 verifier accepts it — one signature scheme', await ev(async () => {
    const bun = await window.DLVAULT.bundle({ sovereign: false });
    return !!(window.SV82 && window.SV82.verifyBundle(bun).ok);
  }));
  ok('DLVAULT.verify accepts it', await ev(async () => {
    const bun = await window.DLVAULT.bundle({ sovereign: false });
    const v = await window.DLVAULT.verify(bun);
    return v.ok === true;
  }));

  console.log('\n== tamper');
  const tamper = await ev(async () => {
    const bun = await window.DLVAULT.bundle({ sovereign: false });
    const edited = JSON.parse(JSON.stringify(bun));
    edited.state = edited.state || {};
    edited.state.bal = { USDT: 999999999 };
    const v = await window.DLVAULT.verify(edited);
    const cut = JSON.parse(JSON.stringify(bun));
    cut.archive.txns = cut.archive.txns.slice(0, 5);
    const v2 = await window.DLVAULT.verify(cut);
    const junk = await window.DLVAULT.verify({ spec: 'something/else' });
    return { edited: v, truncated: v2, junk: junk };
  });
  ok('an edited balance is rejected', tamper.edited.ok === false && /checksum/.test(tamper.edited.why), tamper.edited);
  ok('a truncated archive is rejected', tamper.truncated.ok === false && /checksum/.test(tamper.truncated.why), tamper.truncated);
  ok('an unknown format is rejected', tamper.junk.ok === false, tamper.junk);

  console.log('\n== clone');
  ok('sovereign:true includes the signing key and says so', await ev(async () => {
    const bun = await window.DLVAULT.bundle({ sovereign: true });
    return !!(bun.keys && /^[0-9a-f]{64}$/.test(bun.keys['coinbridge.sovkey'])) && bun.sovereign === true
      && (await window.DLVAULT.verify(bun)).ok === true;
  }));

  console.log('\n== pressure & stats');
  const st = await ev(() => window.DLVAULT.stats());
  ok('stats reports the archive on', st.idb === true, st.idb);
  ok('stats reports localStorage bytes', st.local.bytes > 0, st.local);
  ok('stats counts every series', !!(st.series.txns && st.series.journal && st.series.alerts && st.series.equity), Object.keys(st.series));
  ok('stats reports the browser quota', st.quota && st.quota.quota > 0, st.quota);
  const pr = await ev(() => window.DLVAULT.pressure());
  ok('headroom is MEASURED, not guessed against a fixed budget', typeof pr.headroom === 'boolean' && pr.bytes > 0 && pr.probe === 4096, pr);
  ok('the probe key is cleaned up after measuring', await ev(() => localStorage.getItem('dl.vault.probe') === null));
  // Measured on the live site: a cold DexLadder visit already sits at the
  // browser's localStorage cap while its own saves still land, because a save
  // replaces its key and needs only the delta. A full origin is therefore NOT
  // evidence of a problem, and must raise nothing on its own.
  ok('a full origin alone raises nothing — only the app\'s own failed write does', await ev(async () => {
    const seen = [];
    const orig = window.toast;
    window.toast = function () { seen.push(String(arguments[1])); return typeof orig === 'function' ? orig.apply(this, arguments) : undefined; };
    window._quotaWarned = 0; window._saveFailWarned = 0;
    window.DLVAULT.pressure();          // full or not, this must stay silent
    await new Promise(r => setTimeout(r, 300));
    const quiet = seen.length === 0;
    window.toast = orig;
    return quiet;
  }));

  console.log('\n== it survives a reload — the whole point');
  const beforeReload = await ev(async () => (await window.DLVAULT.page('txns', 0, 5000)).total);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(5000);
  const afterReload = await ev(async () => {
    await window.DLVAULT.ready;
    return { tx: (await window.DLVAULT.page('txns', 0, 5000)).total, eq: (await window.DLVAULT.page('equity', 0, 100000)).total, writable: window.DLVAULT.writable() };
  });
  ok('the archive is still there after a full reload', afterReload.tx === beforeReload && afterReload.tx > 0, { beforeReload, afterReload });
  ok('and the equity curve with it', afterReload.eq >= 400, afterReload);
  ok('and it is still writable on the fresh page', afterReload.writable === true, afterReload);

  console.log('\n== the app is untouched');
  ok('still no page errors', h.errors.length === 0, h.errors.slice(0, 3));
  ok('restoreState still exists and is not wrapped', await ev(() => typeof window.restoreState === 'function' && !window.restoreState.__vault));
  ok('SV82 still exports its own v1 path', await ev(() => typeof window.SV82.exportBundle === 'function' && window.SV82.exportBundle().spec === 'dexladder/sovereign-export/v1'));
  ok('no new eval-family call site in the layer', await ev(() => {
    const src = Array.from(document.scripts).map(s => s.textContent).join('\n');
    return src.indexOf('DLVAULT') > 0 && !/new Function\s*\(/.test(src.slice(src.indexOf('DLVAULT · v163') < 0 ? 0 : src.indexOf('DLVAULT · v163')));
  }));

  await h.close();
  const bad = results.filter(r => !r.ok);
  console.log('\n' + results.filter(r => r.ok).length + ' passed · ' + bad.length + ' failed');
  process.exit(bad.length);
})().catch(e => { console.error(e); process.exit(99); });
