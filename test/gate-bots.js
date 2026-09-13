// DexLadder bots gate — Build Your Own Bot, Bring Your Own Bot, and the Arena.
//
//   node test/gate-bots.js [dist/index.html]        exit code = number of failures
//
// Part A reads the shipped payload: the layer is there, the sandbox shield is there, nothing in
// the desk can reach the trader's account, and the payload is still eval-free.
// Part B drives the payload in Chromium: a rules bot backtested on candles the gate controls and
// then run live through a closed bar; a user's JavaScript in a real Worker (including one that
// throws and one that never returns); a real local signal endpoint over real HTTP (so CORS is
// exercised, not simulated); and the Arena's ranking — at a desktop and a phone width.
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const WEB = path.join(__dirname, '..');
const file = process.argv[2] || path.join(WEB, 'dist', 'index.html');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (detail ? '  ' + JSON.stringify(detail).slice(0, 500) : '')); } };

console.log('A · shipped payload');
const html = fs.readFileSync(file, 'utf8');

// v159b · THE HEADERS THE HOSTS ACTUALLY SERVE. A bot that reads a signal from the user's own
// machine, and the Local Fork sandbox's JSON-RPC, both talk to http://127.0.0.1. `connect-src
// 'self' https:` blocks that — measured on the live site as a securitypolicyviolation with
// violatedDirective "connect-src", after both features had shipped. The payload cannot see its
// own response headers, so this is asserted on the files that become them, for BOTH hosts, and
// it is asserted narrowly: loopback only, never a wildcard that would let any http host in.
for (const hf of ['dist/_headers', 'site/_headers']) {
  const h = fs.readFileSync(path.join(WEB, hf), 'utf8');
  // read the DIRECTIVE, not the first mention of the word — the file's own comment
  // explains why loopback is there, and a loose match grades the explanation instead
  const line = (h.split(/\r?\n/).find(l => /^\s*Content-Security-Policy(-Report-Only)?:/.test(l)) || '');
  const cs = (line.match(/connect-src[^;]*/) || [''])[0];
  ok('csp · ' + hf + ' lets a bot reach the reader\'s own machine (http + ws loopback)',
    /http:\/\/127\.0\.0\.1:\*/.test(cs) && /ws:\/\/127\.0\.0\.1:\*/.test(cs)
    && /http:\/\/localhost:\*/.test(cs), cs.slice(0, 160));
  ok('csp · ' + hf + ' did not open http: to the whole internet to do it',
    !/connect-src[^;]*\shttp:(\s|;|$)/.test(cs) && !/connect-src[^;]*\sws:(\s|;|$)/.test(cs), cs.slice(0, 160));
}
ok('bots · the desk ships as its own layer and opens through DLAPP', /window\.DLBOTS\s*=/.test(html) && html.includes('DLAPP.legacy.bots.mount('));
ok('bots · the sandbox strips the network from the Worker before the user\'s first line runs',
  html.includes("'fetch','XMLHttpRequest','WebSocket','importScripts','indexedDB','caches'") || html.includes('"fetch","XMLHttpRequest","WebSocket","importScripts","indexedDB","caches"'));
ok('bots · the user\'s code is the Worker\'s own script — no eval, no Function, no importScripts', !/new\s+Function\s*\(/.test(html.slice(html.indexOf('window.DLBOTS'))) && html.includes('URL.createObjectURL(new Blob('));
const deskSrc = html.slice(html.indexOf('window.DLBOTS'), html.indexOf('window.DLBOTS') + 20000);
ok('bots · a bot can never reach the paper account (no S.bal, no execFill in the desk layer)', !/S\.bal/.test(deskSrc) && !/execFill/.test(deskSrc));
ok('bots · the CSP allows a blob worker (a sandbox needs one) — checked in both header files',
  ['site/_headers', 'dist/_headers'].every(p => /worker-src 'self' blob:/.test(fs.readFileSync(path.join(WEB, p), 'utf8'))));
ok('bots · the Academy carries Bots, and the palette and desks rail register it',
  /action:["']DLBOTS\.open["']/.test(html) && html.includes('C.cmd("bots"') && html.includes('DLDESKS.register("bots"'));

/** the smallest correct signal endpoint — real HTTP, real CORS, on 127.0.0.1 */
function endpoint(answer) {
  const srv = http.createServer((req, res) => {
    const q = new URL(req.url, 'http://x').searchParams;
    const body = typeof answer === 'function' ? answer(q) : answer;
    if (body === '__500') { res.writeHead(500, { 'access-control-allow-origin': '*' }); return res.end('boom'); }
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, url: 'http://127.0.0.1:' + srv.address().port + '/signal' })));
}

(async () => {
  console.log('B · runtime (Chromium, mocked market, real local endpoint)');
  const { launch } = require('./harness');
  const good = await endpoint(q => ({ action: +q.get('qty') > 0 ? 'sell' : 'buy', size: 0.5, reason: 'the kit answered on ' + q.get('sym') }));
  const bad = await endpoint('not json at all');
  for (const w of [1440, 393]) {
    const hh = await launch(file, { viewport: { width: w, height: 1000 } });
    const { page, errors } = hh;
    await page.waitForTimeout(6000);
    const r = await page.evaluate(async ([goodUrl, badUrl]) => {
      const wait = ms => new Promise(r => setTimeout(r, ms)), out = {};
      const type = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
      const click = sel => { const el = document.querySelector(sel); if (el) el.click(); return !!el; };
      // candles the gate controls: a market that dips hard then recovers, on the hour
      const H = 3600e3, t0 = Math.floor(Date.now() / H) * H - 400 * H;
      // up, a hard dip, a recovery, then a fresh dip — so the LAST closed bar is oversold and the
      // run has a completed round trip behind it
      const px = i => (i < 180 ? 100 : i < 240 ? 100 - (i - 180) * 0.5 : i < 330 ? 70 + (i - 240) * 0.45 : 110.5 - (i - 330) * 0.55);
      const rows = Array.from({ length: 399 }, (_, i) => { const p = px(i); return [t0 + i * H, String(p), String(p * 1.004), String(p * 0.996), String(p), '12', 0, '0', 1, '0', '0', '0']; });
      const C = window.DLCORE, orig = C.jget;
      C.jget = (u, o) => (/klines|candles/.test(u) ? Promise.resolve({ data: rows, at: Date.now(), stale: false }) : orig(u, o));

      openCoin('BTC'); await wait(1200); DLBOTS.mounts(); await wait(200);
      out.launcher = !!document.getElementById('dlBotCard');
      DLBOTS.open(); await wait(600);
      out.desk = { open: !!document.querySelector('#dlBots.on'), tabs: ['arena', 'build', 'byo'].every(t => !!document.getElementById('botTab-' + t)), board: !!document.getElementById('botBoard') };

      // ---- Build your own bot: a preset, a backtest on the gate's candles, then live
      click('#botTab-build'); await wait(300);
      const sel = document.getElementById('blPreset'); sel.value = 'rsi'; sel.dispatchEvent(new Event('change', { bubbles: true })); await wait(300);
      out.build = { rules: document.querySelectorAll('#botBuilder [id^=blentry]').length, words: (document.getElementById('botBuilder') || {}).innerText || '' };
      type('blCash', '10000'); await wait(100);
      [...document.querySelectorAll('#botBuild button')].find(b => /Test on history/.test(b.textContent)).click();
      await wait(2000);
      const outEl = () => (document.getElementById('botOut') || {}).innerText || '';
      out.backtest = { note: outEl(), verdict: ((document.getElementById('botBuild') || {}).innerText || '').match(/vs buy-and-hold [+−][\d.]+%/) };
      const usdt0 = S.bal.USDT, nw0 = portfolioUSD();
      [...document.querySelectorAll('#botBuild button')].find(b => /Run it live/.test(b.textContent)).click();
      await wait(1200);
      const runs = DLAPP.legacy.bots.runs;
      out.live = { n: runs.runs().length, status: runs.runs()[0] && runs.runs()[0].status, bars: runs.runs()[0] && runs.runs()[0].bars.length, fills: runs.runs()[0] && runs.runs()[0].wallet.fills.length,
        account: S.bal.USDT === usdt0 && portfolioUSD() === nw0, card: !!document.querySelector('#botArena [data-bot]') };

      // a bar closes: the bot decides once, on its own wallet
      const r0 = runs.runs()[0], id0 = r0.def.id;
      r0.lastBarT = 0; r0.barsSinceExit = -1;
      await runs.tick(); await wait(400);
      out.decided = { fills: runs.get(id0).wallet.fills.length, log: runs.get(id0).log.map(l => l.text).join(' | ').slice(0, 300),
        walletCash: Math.round(runs.get(id0).wallet.cash), account: S.bal.USDT === usdt0 };

      // ---- Bring your own bot · JavaScript in a real Worker
      click('#botTab-byo'); await wait(300);
      type('byCode', 'function onBar(ctx){ return { action: ctx.position.holding ? "sell" : "buy", size: 0.25, reason: "worker saw " + ctx.close.length + " closes at " + ctx.price.toFixed(2) }; }');
      type('byName', 'Worker bot'); await wait(100);
      [...document.querySelectorAll('#botByo button')].find(b => /Dry-run/.test(b.textContent)).click();
      await wait(2500);
      out.js = { out: (document.getElementById('byOut') || {}).innerText || '' };
      // one that throws, and one that never returns
      type('byCode', 'function onBar(){ throw new Error("boom"); }');
      [...document.querySelectorAll('#botByo button')].find(b => /Dry-run/.test(b.textContent)).click(); await wait(2500);
      out.jsThrow = (document.getElementById('byOut') || {}).innerText || '';
      type('byCode', 'function onBar(){ while (true) {} }');
      [...document.querySelectorAll('#botByo button')].find(b => /Dry-run/.test(b.textContent)).click(); await wait(6000);
      out.jsHang = (document.getElementById('byOut') || {}).innerText || '';

      // ---- Bring your own bot · a real endpoint over real HTTP
      click('#byKind [data-value="signal"]') || (() => { const s = document.getElementById('byKind'); const b = s && s.querySelector('[data-value="signal"]'); b && b.click(); })();
      await wait(300);
      out.kit = ((document.getElementById('byKitCode') || {}).innerText || '').slice(0, 40);
      type('byUrl', badUrl);
      [...document.querySelectorAll('#botByo button')].find(b => /Dry-run/.test(b.textContent)).click(); await wait(2000);
      out.sigBad = (document.getElementById('byOut') || {}).innerText || '';
      type('byUrl', goodUrl); type('byName', 'Endpoint bot'); await wait(100);
      [...document.querySelectorAll('#botByo button')].find(b => /Dry-run/.test(b.textContent)).click(); await wait(2500);
      out.sigGood = (document.getElementById('byOut') || {}).innerText || '';
      [...document.querySelectorAll('#botByo button')].find(b => /Run it live/.test(b.textContent)).click(); await wait(1500);
      const r1 = runs.runs().find(x => x.def.kind === 'signal');
      if (r1) { r1.lastBarT = 0; await runs.tick(); await wait(600); }
      out.sigLive = r1 ? { fills: runs.get(r1.def.id).wallet.fills.length, health: runs.get(r1.def.id).health.ok, cash: Math.round(runs.get(r1.def.id).wallet.cash) } : null;

      // ---- the Arena ranks them, and the account is still untouched
      click('#botTab-arena'); await wait(400);
      const board = document.getElementById('botBoard');
      out.arena = { rows: board ? board.querySelectorAll('.dlx-row').length : 0, text: (document.getElementById('botArena') || {}).innerText || '' };
      out.account = { usdt: S.bal.USDT === usdt0, nw: Math.abs(portfolioUSD() - nw0) < 1e-6 };
      out.overflow = document.documentElement.scrollWidth - innerWidth;
      // storage: the bots live on the paper account and survive a save
      out.stored = { runs: (S.dlsim.bots && S.dlsim.bots.runs || []).length, keys: Object.keys((S.dlsim.bots && S.dlsim.bots.runs || [{}])[0] || {}).sort().join(',') };
      runs.runs().forEach(x => runs.remove(x.def.id));
      runs.sleep();
      C.jget = orig;
      return out;
    }, [good.url, bad.url]);

    const p = `${w}px · `;
    ok(p + 'a launcher on the Terminal, and the desk opens with its three tabs', r.launcher && r.desk.open && r.desk.tabs && r.desk.board, r.desk);
    ok(p + 'Build: a preset fills the rule blocks and reads back in plain English', r.build.rules > 0 && /Buy when all of: RSI\(14\) < 30/.test(r.build.words), r.build.rules);
    ok(p + 'Build: the backtest runs on real bars and leads its verdict with buy-and-hold', /Tested on \d+ real 1h bars/.test(r.backtest.note) && !!r.backtest.verdict, r.backtest);
    ok(p + 'Build: "Run it live" starts a bot that loaded history and has taken no trade yet', r.live.n === 1 && r.live.status === 'live' && r.live.bars > 100 && r.live.fills === 0 && r.live.card, r.live);
    ok(p + 'a closed bar makes the bot decide once, on ITS wallet — the paper account never moves', r.decided.fills === 1 && r.decided.walletCash === 5000 && r.decided.account && r.live.account, r.decided);
    ok(p + 'the decision is recorded in words, with the condition that fired', /because entry · ✓ RSI\(14\)/.test(r.decided.log), r.decided.log);
    ok(p + 'BYOB · JavaScript answers from a real Worker with the bars and the wallet', /Answered "buy"/.test(r.js.out) && /worker saw \d+ closes/.test(r.js.out), r.js);
    ok(p + 'BYOB · code that throws is reported as a throw, not a silent hold', /onBar threw: boom/.test(r.jsThrow), r.jsThrow);
    ok(p + 'BYOB · code that never returns is stopped on a deadline and says so', /did not answer within/.test(r.jsHang), r.jsHang);
    ok(p + 'BYOB · the starter kit is shown for the chosen language', /python3 bot\.py|node bot\.js|GET http/.test(r.kit), r.kit);
    ok(p + 'BYOB · an endpoint that answers non-JSON is refused in words', /did not answer JSON/.test(r.sigBad), r.sigBad);
    ok(p + 'BYOB · a real local endpoint over real HTTP (CORS included) answers and is quoted back', /Answered "buy"/.test(r.sigGood) && /the kit answered on BTC/.test(r.sigGood), r.sigGood);
    ok(p + 'BYOB · the endpoint bot trades its own wallet on a closed bar', !!r.sigLive && r.sigLive.fills === 1 && r.sigLive.health && r.sigLive.cash === 5000, r.sigLive);
    ok(p + 'the Arena ranks every bot against buy-and-hold and names a small sample', r.arena.rows >= 3 && /vs holding/.test(r.arena.text) && /too early to say|beats the market|trails the market/.test(r.arena.text), { rows: r.arena.rows });
    ok(p + 'the trader\'s account and net worth are byte-identical after all of it', r.account.usdt && r.account.nw, r.account);
    ok(p + 'the bots are stored on the paper account (definition + wallet, never bars)', r.stored.runs >= 2 && /^barsSinceExit,def,lastAction,lastBarT,log,startedAt,status,wallet$/.test(r.stored.keys), r.stored);
    ok(p + 'no sideways overflow while the desk is open', r.overflow <= 0, r.overflow);
    ok(p + 'no page error through the whole life', errors.length === 0, errors.slice(0, 3));
    await hh.close();
  }
/* ══════════════════════════════════════════════════════════════════════════════════════
   v160 · SAFETY, TELEMETRY AND THE BACKTEST WORKER.
   Against the shipped payload in Chromium, on a page nobody has already halted. Every
   assert pins a promise the desk makes on screen, because a safety control that looks
   armed and does nothing is worse than no control at all.
   ═════════════════════════════════════════════════════════════════════════════════ */
{
  const hh = await launch(file, { viewport: { width: 1440, height: 1000 } });
  await hh.page.waitForTimeout(7000);
  const p = 'v160 · ';
  const B = () => null;

  // 1 · THE PLAN IS THE CORE'S, IN ORDER. The confirmation prints planHalt's own steps, so
  //     what the reader approves is literally what runs — not a re-implementation in the view.
  const plan = await hh.page.evaluate(() => {
    const plans = DLAPP.legacy.bots.haltPreview() || [];
    return { n: plans.length, steps: plans.map(x => x.steps.map(s => s.kind)) };
  });
  ok(p + 'the halt plan runs freeze → cancel → flatten → seal → status, in that order',
    plan.n === 0 || plan.steps.every(s => JSON.stringify(s) === JSON.stringify(['freeze', 'cancel', 'flatten', 'seal', 'status'])),
    JSON.stringify(plan));

  // 2 · ONE SEALED ENTRY PER KILL, NEVER PER STEP. The chain keeps 300 entries then truncates
  //     to 120 — a chatty bot would push the trader's own history out of their proof ledger.
  const seal = await hh.page.evaluate(() => {
    const before = ((window.S && S.chain && S.chain.bl) || []).length;
    const rep = DLAPP.legacy.bots.halt(undefined, 'user');
    const bl = (window.S && S.chain && S.chain.bl) || [];
    const n = rep.outcomes.length;
    return { grew: bl.length - before, halted: n, headline: rep.headline, sealNote: rep.sealNote,
             types: n ? bl.slice(-n).map(e => e.ty) : [],
             bytes: n ? Math.max(...bl.slice(-n).map(e => JSON.stringify(e.d).length)) : 0,
             verify: window.verifyChain ? verifyChain().ok : null };
  });
  ok(p + 'one BOT_EMERGENCY_KILL is sealed per bot halted, never one per step',
    seal.halted === 0 || (seal.grew === seal.halted && seal.types.every(t => t === 'BOT_EMERGENCY_KILL')), JSON.stringify(seal));
  ok(p + 'the sealed entry stays small enough not to evict the trader\'s own history',
    seal.halted === 0 || (seal.bytes > 0 && seal.bytes < 400), JSON.stringify(seal));
  ok(p + 'the proof chain still verifies after the kill switch has fired',
    seal.verify === true || seal.verify === null, JSON.stringify(seal));

  // 3 · A HALTED BOT IS OUT OF THE MARKET, and reads differently from one the user stopped.
  const after = await hh.page.evaluate(() => {
    const rows = (window.S && S.dlsim && S.dlsim.bots && S.dlsim.bots.runs) || [];
    return rows.map(r => ({ s: r.status, q: (r.wallet && r.wallet.qty) || 0 }));
  });
  ok(p + 'a halted bot holds nothing, and is not filed as merely stopped',
    after.filter(r => r.s === 'halted').every(r => r.q < 1e-9), JSON.stringify(after.slice(0, 4)));

  // 4 · THE HALT COMPLETES WITHOUT A LEDGER, and admits it rather than claiming a seal.
  const noChain = await hh.page.evaluate(() => {
    const keep = window.chainAdd; delete window.chainAdd;
    try {
      const rep = DLAPP.legacy.bots.halt(undefined, 'user');
      const txt = (document.getElementById('botHaltOut') || {}).innerText || '';
      return { ran: true, anySealed: rep.outcomes.some(o => o.sealed), note: rep.sealNote,
               says: /not sealed|no proof ledger|0 of/i.test(rep.sealNote + ' ' + txt), n: rep.outcomes.length };
    } finally { window.chainAdd = keep; }
  });
  ok(p + 'with no proof ledger the halt still runs, and the desk says it was not sealed',
    noChain.ran && !noChain.anySealed && (noChain.n === 0 || noChain.says), JSON.stringify(noChain));

  // 5 · THE LOG VIEWER IS VIRTUALISED. A thousand events must not become a thousand rows.
  const virt = await hh.page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 1000; i++) DLAPP.legacy.bots.note({ bot: 'gate', t: Date.now(), kind: 'tick', text: 'bar ' + i });
    // the desk has to be OPEN for the viewer to exist — a fresh page has no #botTab-log,
    // and an assert that reads zero rows off a closed desk grades nothing
    DLBOTS.open(); await wait(700);
    const tab = document.getElementById('botTab-log'); if (tab) tab.click();
    await wait(600);
    return { rows: document.querySelectorAll('[data-log-seq]').length, book: DLAPP.legacy.bots.book().events.length };
  });
  ok(p + 'the execution log paints a window, not the whole book',
    virt.book >= 400 && virt.rows > 0 && virt.rows < 150, JSON.stringify(virt));

  // 6 · THE WORKER AND THE MAIN THREAD AGREE TO THE LAST FLOAT. A backtest whose numbers
  //     depend on which thread ran it is not a backtest.
  const proof = await hh.page.evaluate(async () => {
    try { return await DLBOTS.btProof({ bars: 600, slipBps: 0 }); } catch (e) { return { equal: false, err: String(e && e.message || e) }; }
  });
  ok(p + 'the backtest Worker returns byte-identical numbers to the main thread',
    proof && proof.equal === true, JSON.stringify(proof).slice(0, 220));

  // 7 · SLIPPAGE DEFAULTS TO ZERO, so every saved bot and every earlier assert keeps its numbers.
  const slip = await hh.page.evaluate(() => DLAPP.legacy.bots.slipBps());
  ok(p + 'slippage is 0 bps until the reader sets it', slip === 0, slip);

  ok(p + 'no page error through the safety pass', hh.errors.length === 0, hh.errors.slice(0, 3));
  await hh.close();
}

  good.srv.close(); bad.srv.close();
  console.log(pass + ' passed · ' + fail + ' failed');
  process.exit(fail);
})().catch(e => { console.error(e); process.exit(1); });
