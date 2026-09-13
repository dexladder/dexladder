// v155-E red/green runner — ONLY the five live-run guards, so they can be watched failing
// against the pre-fix payload and passing against the fixed one. Same harness, same fixtures.
'use strict';
const { launch } = require('./harness');
const fs = require('fs'), path = require('path');
const file = process.argv[2] || 'dist/index.html';
const results = [];
function ok(name, cond, detail) { results.push({ name, ok: !!cond, detail }); if (!cond) console.log('  \u2717', name, detail === undefined ? '' : String(detail).slice(0, 260)); else console.log('  \u2713', name); }
(async () => {
  const h = await launch(file);
  const { page } = h;
  await page.waitForTimeout(6000);
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const evq = async (fn, ...a) => { try { return await ev(fn, ...a); } catch (e) { return null; } };
  const SRC = fs.readFileSync(file, 'utf8');
  try { await ev(() => quorumCheck(true)); } catch (e) {}

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

  const fails = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - fails} passed \u00b7 ${fails} failed`);
  await h.close();
  process.exit(fails);
})().catch(e => { console.error(e); process.exit(99); });
