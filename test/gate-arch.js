// DexLadder architecture gate — the Phase-1 laws, machine-checked.
//
//   node test/gate-arch.js [dist/index.html]        exit code = number of failures
//
// Part A reads the typed source (web/app/src) and enforces the structure: size limits, pure
// libraries, components with no inline styles / raw colours / spelled class names, no network or
// money code, no eval. Part B reads the shipped payload: one token table, the legacy formulas
// actually gone, six destinations, and ratchets that stop the legacy debt from growing. Part C
// drives the payload in Chromium: the tokens the browser resolves ARE the table, the navigation
// works end to end, and a paper order goes through the new engine with no page error.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const WEB = path.join(__dirname, '..');
const APP = path.join(WEB, 'app', 'src');
const file = process.argv[2] || path.join(WEB, 'dist', 'index.html');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (detail ? '  ' + JSON.stringify(detail).slice(0, 400) : '')); } };

const walk = (d, re = /\.ts$/) => fs.readdirSync(d).flatMap(n => { const p = path.join(d, n); return fs.statSync(p).isDirectory() ? walk(p, re) : re.test(p) ? [p] : []; }).sort();
const rel = p => path.relative(APP, p).split(path.sep).join('/');
const SRC = walk(APP).map(p => ({ p: rel(p), text: fs.readFileSync(p, 'utf8') }));
const lines = t => t.split('\n').length - (t.endsWith('\n') ? 1 : 0);
const code = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');   // comments are not code
const inDir = (f, d) => f.p.startsWith(d + '/');

console.log('A · source structure (web/app/src, ' + SRC.length + ' files)');
ok('every UI component is at most 150 lines', SRC.filter(f => inDir(f, 'components')).every(f => lines(f.text) <= 150),
  SRC.filter(f => inDir(f, 'components') && lines(f.text) > 150).map(f => f.p + ':' + lines(f.text)));
ok('no source file reaches 300 lines (the split rule)', SRC.every(f => lines(f.text) < 300), SRC.filter(f => lines(f.text) >= 300).map(f => f.p));
const impure = /\b(document|window|localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|WebSocket|setTimeout|setInterval|requestAnimationFrame)\b|Date\.now|Math\.random/;
ok('lib/ is pure: no DOM, storage, network, timers, clock or randomness', SRC.filter(f => inDir(f, 'lib')).every(f => !impure.test(code(f.text))),
  SRC.filter(f => inDir(f, 'lib') && impure.test(code(f.text))).map(f => f.p + ' → ' + code(f.text).match(impure)[0]));
ok('hooks/ touch no DOM or storage (presenters take effects as arguments)', SRC.filter(f => inDir(f, 'hooks')).every(f => !/\b(document|localStorage|sessionStorage)\b/.test(code(f.text))));
const comp = SRC.filter(f => inDir(f, 'components'));
// Component laws as one function, so a planted violation can prove the gate still sees them.
const LAWS = {
  style: t => /\.style\.(?!setProperty)|cssText|\bstyle\s*:|setAttribute\(\s*['"]style/.test(t),
  html: t => /innerHTML|outerHTML|insertAdjacentHTML/.test(t),
  colour: t => /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(t),
  spelledClass: t => /['"`]dlx-|className\s*=/.test(t),
};
const broken = (f, law) => law === 'spelledClass' && f.p === 'components/ui/h.ts' ? false : LAWS[law](code(f.text));   // h() is the one writer of className
const CANARY = "const x = document.createElement('i'); x.style.color = 'red'; x.innerHTML = '<b>'; x.className = 'dlx-pill'; const c = '#fff';";
const planted = Object.keys(LAWS).filter(k => LAWS[k](CANARY));
if (planted.length !== Object.keys(LAWS).length) { console.log('  ✗ CANARY: the component laws no longer detect a planted violation', planted); process.exit(99); }
ok('canary · a planted component that breaks all four laws is caught by all four', true);
ok('components never write a style (only custom properties, in h())', comp.every(f => !broken(f, 'style')), comp.filter(f => broken(f, 'style')).map(f => f.p));
ok('components never inject HTML', comp.every(f => !broken(f, 'html')), comp.filter(f => broken(f, 'html')).map(f => f.p));
ok('components never name a raw colour', comp.every(f => !broken(f, 'colour')), comp.filter(f => broken(f, 'colour')).map(f => f.p));
ok('components never spell a class — only design/classes.ts constants', comp.every(f => !broken(f, 'spelledClass')), comp.filter(f => broken(f, 'spelledClass')).map(f => f.p));
ok('raw colours live only in design/tokens.ts', SRC.filter(f => f.p !== 'design/tokens.ts' && !inDir(f, 'nav')).every(f => !/#[0-9a-fA-F]{6}\b/.test(code(f.text))));
ok('no network code anywhere in the typed core (all data stays on device)', SRC.every(f => !/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/.test(code(f.text))));
ok('no real-money flow: no payment, checkout or purchase APIs', SRC.every(f => !/stripe|paypal|checkout|StoreKit|PaymentRequest|in-?app purchase|razorpay/i.test(code(f.text))));
ok('no eval-family code in the typed core', SRC.every(f => !/\beval\s*\(|new\s+Function\b/.test(code(f.text))));

const bundle = fs.readFileSync(path.join(WEB, 'layers', '01-app.js'), 'utf8');
const h = crypto.createHash('sha256');
for (const f of walk(APP, /\.(ts|md)$/).map(p => ({ p: rel(p) }))) { h.update(path.posix.join('src', f.p)); h.update('\0'); h.update(fs.readFileSync(path.join(APP, f.p))); h.update('\0'); }
const srcSha = h.digest('hex');
ok('the shipped bundle was built from exactly these sources', bundle.includes('sources sha256 ' + srcSha), 'rebundle: node web/app/tools/bundle.mjs');
ok('generated stylesheet and nav markup come from the same sources', fs.readFileSync(path.join(WEB, 'buildlib', 'generated', 'dlapp.css'), 'utf8').includes('sources ' + srcSha.slice(0, 12)));
ok('the bundle contains no eval-family call and no innerHTML', !/\beval\(|new Function|innerHTML/.test(bundle));

console.log('B · shipped payload');
const html = fs.readFileSync(file, 'utf8');
const styles = [...html.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)];
ok('exactly one design-system stylesheet, first in <head>', styles.length > 0 && / id="dlapp"/.test(styles[0][1]) && html.split('<style id="dlapp">').length === 2);
ok('no other stylesheet declares a root or Day token', styles.slice(1).every(s => !/(:root|html\[data-mode=day\])\s*\{[^{}]*--[\w-]+\s*:/.test(s[2])));
ok('one implementation of each chart indicator (legacy bodies delegate)', ['emaArr', 'smaArr', 'rsiArr', 'macdArr'].every(n => html.split('function ' + n + '(').length === 2 && html.includes('function ' + n + '(vals' + (n === 'macdArr' ? '' : ',p') + '){return DLAPP.legacy.chart.' + n)));
ok('the legacy CBX engine body is gone (book + matching are DLAPP.paper)', !html.includes('var LEVELS=40,RECOVER=6e3') && html.includes('DLAPP.legacy.paper.cbx()'));
ok('both legacy execFill bodies delegate to the pure account transition', html.split('DLAPP.legacy.paper.execFill(S,').length === 3 && !html.includes('fee=.001*val,qU=pUSD(quote)||0'));
ok('the CIRCUIT fee-override arithmetic is gone too', !html.includes('var val=amt*px,fee=val*f,qU='));
ok('the venue fee table is the typed one (no second copy)', html.includes('var VEN=DLAPP.paper.VENUES;') && !html.includes('var VEN={binance:'));
ok('realism · the thin-liquidity penalty lives only in the pool depth (the preview-only add-on is gone)', html.includes('function extraBp(){return 0}') && !html.includes('liq<.01?16:liq<.03?8'));
ok('deploy · _redirects pins /support, /privacy and /terms ahead of the SPA fallback (App Store rejection #2)', (() => {
  const r = fs.readFileSync(path.join(WEB, 'dist', '_redirects'), 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const at = k => r.findIndex(l => l.split(/\s+/)[0] === k), spa = at('/*');
  return spa === r.length - 1 && ['/support', '/support/', '/privacy', '/privacy/', '/terms', '/terms/'].every(k => at(k) >= 0 && at(k) < spa && r[at(k)].includes(k.replace(/\/$/, '') + '/index.html'))
    && ['support', 'privacy', 'terms'].every(k => fs.existsSync(path.join(WEB, 'dist', k, 'index.html')));
})());
ok('brand · every inline DexLadder mark is the canonical mark (rail, three candle rungs, two nodes) — no simplified redraws', (() => {
  const svgs = html.match(/<svg\b[^>]*viewBox="0 0 512 512"[^>]*>[\s\S]*?<\/svg>/g) || [];
  return svgs.filter(v => v.includes('260 70 C 500 70')).every(v => v.includes('x="236"') && v.includes('x="176"') && v.includes('x="116"') && v.includes('r="16"'))
    && (html.match(/data:image\/svg\+xml;base64,/g) || []).length >= 7;
})());
ok('brand · the certificate seal engraves the canonical geometry', (html.match(/<rect x="236" y="90" width="48" height="70" rx="10" fill="#(2E240D|F7E9B8)"/g) || []).length === 2);
ok('chart · the price gutter is sized from the widest price and every tag fills it; no canvas label falls back to a serif', html.includes('Math.max(58,Math.ceil(x.measureText(fmt(mx)).width)+14)') && html.includes('x.fillRect(innerW+1,ly-8,w-innerW-1,16)') && !/\d+px Inter"/.test(html));
ok('chart · both charts ask for real history before drawing', html.includes('function drawCoinChart(){DLAPP.legacy.history.ensure(S.coin);') && html.includes('DLAPP.legacy.history.ensure(c.sym);'));
ok('markets · stranded rail headers are found document-wide (the host can change parent)', html.includes("q=document.querySelectorAll('.mx-rail-h[data-for=\"'+host.id+'\"]')"));
ok('gap · both order loops route triggered stops through the one gap policy', html.includes('P.stopMarket(o,side,qty)') && html.includes('CBX.execute(o.sym,o.quote,o.side,o.qty,P.stopOpts(o))'));
ok('modes · no Pro label left on the execution chip or sheet (legacy storage value untouched)', html.includes('"Advanced · "+v.n') && !html.includes('"Pro · "+v.n') && !html.includes('<h4>🎯 Pro</h4>') && html.includes('d.mode="pro"===m?"pro":"beginner"'));
ok('ledger · the transaction history and trade journal label gas rows and partial fills', html.includes('lab=DLAPP.legacy.paper.txnLabel(t,fmt)||(') && html.includes('${j.of?` · partial fill of ${fmt(j.of)}`:""}'));
ok('gas · the DLSIM after-the-fact fee delta is retired (fees and gas go through the one fill)', html.includes('function feeDelta(){}') && html.includes('gas=DLAPP.legacy.paper.gasEstimate(S.quote)'));
ok('realism · the ticket preview is the engine preview (legacy CBXpreview builder gone)', html.includes('DLAPP.legacy.ticket.preview({TIF:TIF,POST:POST,n:n})') && !html.includes('vs. a naive simulator</b>'));
ok('both order loops and the ticket run on the pure engine', html.includes('P.trigger(o,cur)') && html.includes('P.stepQueue(o,cur,') && html.includes('DLAPP.legacy.ticket.place('));
const links = [...(html.match(/<nav class="navlinks" id="navlinks"[^>]*>([\s\S]*?)<\/nav>/) || ['', ''])[1].matchAll(/<a [^>]*>([^<]*)<\/a>/g)].map(m => m[1]);
ok('primary navigation is exactly the six destinations, in order', JSON.stringify(links) === JSON.stringify(['Terminal', 'Markets', 'Portfolio', 'Academy', 'Explorer', 'P2P']), links);
ok('the bottom bar is built from the same table', html.includes('NAVITEMS=DLAPP.nav.bottomItems()') && !html.includes('NAVITEMS=[["markets"'));
ok('the daily challenge is no longer a header chip (it is an Academy section)', !html.includes('id="dailyChip"'));
ok('orders · the OCO and TWAP hooks are in the payload (loop, fill, cancel, rows) and a parent draws no price line',
  html.includes('try{DLAPP.legacy.algo.step()}catch(e){}') && html.includes('DLAPP.legacy.algo.ocoFilled(o,fq)')
  && html.includes('try{DLAPP.legacy.algo.ocoCancel(id)}catch(_e){}') && html.includes('DLAPP.legacy.algo.rowHtml(o,{fmt:fmt,esc:esc,gly:gly})')
  && html.includes('||"twap"===o.type||"void"===o.type)return;'));
ok('blog · every illustration is drawn by the app (no raster, no external asset) and stops moving for prefers-reduced-motion',
  html.includes('@media (prefers-reduced-motion:reduce){.dlx-fig *,.dlx-cover *{animation:none!important}')
  && !/dlx-(fig|cover)[^{]*\{[^}]*url\(/.test(html) && html.includes('@keyframes dlx-flow'));
ok('blog · #page-blog exists once; the router keeps #/blog/<slug>; the What\u2019s New banner and sheet link the v156 story', html.split('id="page-blog"').length === 2
  && html.includes('if("blog"===h||h.startsWith("blog/"))return void DLAPP.legacy.blog.open(') && html.includes('else if("blog"===view)try{DLAPP.legacy.blog.render()}catch(_e){}')
  && html.includes('<button class="go" onclick="DLAPP.legacy.blog.story()">Read the story</button>') && html.includes('onclick="closeModal();DLAPP.legacy.blog.story()">Read the story on the Blog</button>'));
// ratchets — legacy debt measured when Phase 1 landed; these may only go DOWN
const count = re => (html.match(re) || []).length;
const R = { inlineStyleAttrs: [count(/style=\\?["']/g), 1125], styleAssignments: [count(/\.style\.[a-zA-Z]+\s*=(?!=)/g), 230], cssText: [count(/cssText/g), 17],
  // the legacy data-go bridge still carries two `new Function(` sites (known, DLSEC candidate); none may be added
  evalFamily: [count(/(?<![\w.$])(?:eval|Function)\s*\(/g) + count(/setTimeout\(\s*["'`]/g) + count(/setInterval\(\s*["'`]/g), 2] };
for (const [k, [now, max]] of Object.entries(R)) ok(`ratchet · legacy ${k} ${now} ≤ ${max}`, now <= max);

(async () => {
  console.log('C · runtime (Chromium, mocked network)');
  const { launch } = require('./harness');
  const table = (() => {
    const css = fs.readFileSync(path.join(WEB, 'buildlib', 'generated', 'dlapp.css'), 'utf8');
    const grab = sel => { const m = css.match(new RegExp(sel.replace(/[[\]]/g, '\\$&') + '\\{([^}]*)\\}')); const o = {}; (m ? m[1] : '').split(';').forEach(d => { const i = d.indexOf(':'); if (i > 0) o[d.slice(0, i)] = d.slice(i + 1); }); return o; };
    return { night: grab(':root'), day: grab('html[data-mode=day]') };
  })();
  for (const w of [1440, 393]) {
    const hh = await launch(file, { viewport: { width: w, height: 900 } });
    const { page, errors } = hh;
    await page.waitForTimeout(6000);
    const r = await page.evaluate(async (table) => {
      const out = {};
      const read = () => { const cs = getComputedStyle(document.documentElement); const o = {}; for (const k of Object.keys(table.night).concat(Object.keys(table.day))) o[k] = cs.getPropertyValue(k).trim(); return o; };
      // every CSS rule the document holds — nested in @media/@supports, or injected at runtime — may
      // declare a root/Day token only inside the design-system sheet
      out.strayRoot = [];
      const scan = (rules, sheetId) => { for (const r of rules) { if (r.cssRules && !r.selectorText) scan(r.cssRules, sheetId); else if (r.selectorText && /:root|html\s*\[\s*data-mode/.test(r.selectorText) && [...r.style].some(p => p.startsWith('--')) && sheetId !== 'dlapp') out.strayRoot.push(r.selectorText); } };
      for (const sh of document.styleSheets) { try { scan(sh.cssRules, sh.ownerNode && sh.ownerNode.id); } catch (e) {} }
      DLMODE.set('dark'); await new Promise(r => setTimeout(r, 400)); out.night = read();
      DLMODE.set('day'); await new Promise(r => setTimeout(r, 400)); out.day = read();
      DLMODE.set('dark');
      out.frozen = Object.isFrozen(window.DLAPP) && Object.isFrozen(DLAPP.paper) && DLAPP.version;
      const active = () => [...document.querySelectorAll('#navlinks a.active')].map(a => a.textContent);
      const bottom = () => [...document.querySelectorAll('#nxbn button.on')].map(b => b.textContent.trim());
      const strip = r => { const p = document.getElementById('page-' + r); const s = p && p.querySelector('.dlx-sections'); return s ? [...s.querySelectorAll('.dlx-tab')].map(t => t.textContent + (t.classList.contains('is-on') ? '*' : '')) : null; };
      const cur = () => [...document.querySelectorAll('#navlinks a, #nxbn [data-nav]')].filter(a => a.getAttribute('aria-current') === 'page').map(a => a.textContent.trim());
      nav('news'); await new Promise(r => setTimeout(r, 700)); out.news = { active: active(), bottom: bottom(), strip: strip('news'), strips: document.querySelectorAll('#page-news .dlx-sections').length, current: cur() };
      nav('community'); await new Promise(r => setTimeout(r, 700)); out.community = { active: active(), bottom: bottom(), strip: strip('community') };
      nav('markets'); await new Promise(r => setTimeout(r, 700)); out.markets = { active: active(), strips: document.querySelectorAll('#page-markets .dlx-sections').length, overflow: document.documentElement.scrollWidth - innerWidth };
      nav('learn'); await new Promise(r => setTimeout(r, 900)); out.learn = { hub: strip('learn'), overflow: document.documentElement.scrollWidth - innerWidth };
      const jb = [...document.querySelectorAll('#page-learn .dlx-tab')].find(t => t.textContent === 'Journey & quests'); if (jb) jb.click(); await new Promise(r => setTimeout(r, 900));
      out.hubOpened = !!document.querySelector('.dls.on, #dlHub.on, [id*="Hub"].on, [id*="hub"].on'); try { DLHUB.hide(); } catch (e) {}
      location.hash = '#/terminal'; await new Promise(r => setTimeout(r, 900)); out.terminal = { page: (document.querySelector('.page.active') || {}).id, active: active() };
      // a paper order through the real ticket → presenter → pure engine
      S.coin = 'SOL'; S.quote = 'USDT'; S.ordType = 'market'; S.side = 'buy';
      const usdt0 = S.bal.USDT || 0, sol0 = S.bal.SOL || 0, ask0 = CBX.book('SOL', 'USDT').asks[0].a, fee0 = S.stats.feesUSD, n0 = S.stats.trades;
      document.getElementById('amt').value = '2'; placeOrder();
      const tx = (S.txns && S.txns[0]) || {};
      out.trade = { dUSDT: (S.bal.USDT || 0) - usdt0, dSOL: (S.bal.SOL || 0) - sol0, ate: ask0 - CBX.book('SOL', 'USDT').asks[0].a, lastTxn: tx.type, val: tx.val, dFee: S.stats.feesUSD - fee0, dTrades: S.stats.trades - n0, taker: CBX.FEE.taker };
      return out;
    }, table);
    const want = { night: table.night, day: Object.assign({}, table.night, table.day) };
    // a var() token must resolve to whatever the token it names resolves to in the same mode
    const expect = (m, k) => { const vv = want[m][k].trim(), ref = vv.match(/^var\((--[\w-]+)\)$/); return ref ? r[m][ref[1]] : vv; };
    const diff = m => Object.keys(want[m]).filter(k => r[m][k] !== expect(m, k)).map(k => k + ': ' + r[m][k] + ' ≠ ' + expect(m, k));
    ok(`${w}px · no stylesheet — nested, grouped or injected at runtime — declares a root/Day token outside the table`, r.strayRoot.length === 0, r.strayRoot);
    ok(`${w}px · the browser resolves every Night token to the table`, diff('night').length === 0, diff('night').slice(0, 5));
    ok(`${w}px · the browser resolves every Day token to the table`, diff('day').length === 0, diff('day').slice(0, 5));
    ok(`${w}px · DLAPP is present and frozen`, r.frozen === 'arch-1');
    ok(`${w}px · News lives in Markets: header + bottom bar highlight Markets, strip marks News`, r.news.active.join() === 'Markets' && (w > 900 || r.news.bottom.join() === 'Markets') && JSON.stringify(r.news.strip) === '["Screener","News & pulse*"]' && r.news.strips === 1, r.news);
    ok(`${w}px · the Town Square lives in Academy`, r.community.active.join() === 'Academy' && r.community.strip && r.community.strip.includes('Town Square*'), r.community);
    ok(`${w}px · one section strip per page, no horizontal overflow`, r.markets.strips === 1 && r.markets.overflow <= 1 && r.learn.overflow <= 1, [r.markets, r.learn]);
    ok(`${w}px · Academy & Hub carries Lessons · Blog · Discover · Town Square · Journey · Daily · Rewind · Bots · Monument`, JSON.stringify(r.learn.hub) === JSON.stringify(['Lessons*', 'Blog', 'Discover', 'Town Square', 'Journey & quests', 'Daily challenge', 'Rewind', 'Bots', 'Monument']), r.learn.hub);
    ok(`${w}px · the Journey section opens the Journey hub in place`, r.hubOpened === true);
    ok(`${w}px · #/terminal opens the trading terminal`, r.terminal.page === 'page-coin' && r.terminal.active.join() === 'Terminal', r.terminal);
    const t = r.trade, rel = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
    ok(`${w}px · a market buy goes through the ticket → presenter → pure engine and eats the book`, rel(t.dSOL, 2) && t.ate > 0 && t.lastTxn === 'Buy' && t.dTrades === 1, t);
    ok(`${w}px · it pays exactly notional + the 0.10% taker fee, and the fee is booked`, t.taker === 0.001 && rel(t.dUSDT, -t.val * 1.001) && rel(t.dFee, t.val * 0.001), t);
    ok(`${w}px · aria-current follows the destination (News → Markets current, nothing else)`, r.news.current.length >= 1 && r.news.current.every(x => x === 'Markets'), r.news.current);
    // ---- conditional and algorithmic orders: OCO (one cancels the other) and TWAP (a parent worked in slices)
    const al = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const out = {};
      const coin = bySym.SOL ? 'SOL' : (Object.keys(bySym)[1] || 'ETH');
      nav('coin'); S.coin = coin; S.quote = 'USDT'; await wait(500);
      const px = pairPrice(coin, 'USDT');
      const T = []; const _toast = window.toast; window.toast = function () { T.push([...arguments].slice(1).join(' | ')); return _toast.apply(this, arguments); };
      const lastToast = () => T[T.length - 1] || '';
      S.bal[coin] = 20; S.bal.USDT = 100000; S.orders = []; S.side = 'sell'; saveP();
      setOrdType('oco'); CBXpreview(); await wait(250);
      out.tabs = [...document.querySelectorAll('#ordTabs button')].map(b => b.dataset.o);
      out.ocoRow = !!document.getElementById('dlxOcoRow') && !document.getElementById('dlxOcoRow').hidden;
      out.previewHidden = getComputedStyle(document.getElementById('cbxPrev')).display === 'none';
      // an OCO the market cannot honour is refused with a reason, and nothing is placed
      document.getElementById('amt').value = '5';
      document.getElementById('dlxOcoTp').value = String((px * 0.9).toFixed(6));
      document.getElementById('dlxOcoSl').value = String((px * 0.95).toFixed(6));
      placeOrder(); await wait(250);
      out.refused = { msg: lastToast(), orders: S.orders.length };
      document.getElementById('dlxOcoTp').value = String((px * 1.05).toFixed(6));
      document.getElementById('dlxOcoSl').value = String((px * 0.95).toFixed(6));
      placeOrder(); await wait(300);
      out.placed = S.orders.map(o => ({ type: o.type, grouped: !!o.oco, qty: o.qty }));
      out.group = new Set(S.orders.map(o => o.oco)).size;
      out.rows = [...document.querySelectorAll('#ordersList .orow .otag')].map(e => e.textContent.trim());
      const held0 = S.bal[coin];
      const _pp = window.pairPrice; window.pairPrice = (s, q) => (s === coin ? px * 1.08 : _pp(s, q));
      evalOrders(); await wait(400); window.pairPrice = _pp;
      out.afterFill = { left: S.orders.length, sold: +(held0 - S.bal[coin]).toFixed(6), txn: (S.txns[0] || {}).type };
      // cancelling one leg by hand takes the partner with it
      S.bal[coin] = 20; document.getElementById('amt').value = '4';
      document.getElementById('dlxOcoTp').value = String((px * 1.05).toFixed(6));
      document.getElementById('dlxOcoSl').value = String((px * 0.95).toFixed(6));
      placeOrder(); await wait(300);
      const leg = S.orders.find(o => o.oco);
      out.pair = S.orders.filter(o => o.oco).length;
      cancelOrder(leg.id); await wait(250);
      out.afterCancel = S.orders.filter(o => o.oco).length;
      // ---- TWAP
      S.orders = []; S.side = 'buy'; setOrdType('twap'); CBXpreview(); await wait(250);
      out.twapRow = !document.getElementById('dlxTwapRow').hidden;
      document.getElementById('amt').value = '8'; CBXpreview(); await wait(150);
      out.note = (document.getElementById('dlxTwapNote') || {}).textContent || '';
      [...document.querySelectorAll('#dlxTwapN button')].find(b => b.textContent === '4').click(); await wait(150);
      [...document.querySelectorAll('#dlxTwapW button')].find(b => b.textContent === '5 min').click(); await wait(150);
      document.getElementById('amt').value = '8'; CBXpreview(); await wait(150);
      out.slicePreview = (document.querySelector('#cbxPrev .dlx-prev-r b') || {}).textContent;
      const held1 = S.bal[coin];
      placeOrder(); await wait(400);
      const parent = () => S.orders.find(o => o.type === 'twap');
      out.armed = parent() ? { slices: parent().slices, every: parent().everyMs, sent: parent().sent, qty: parent().qty } : null;
      out.twapTag = (document.querySelector('#ordersList .orow .otag') || {}).textContent.trim();
      out.lasers = 0;
      try { drawCoinChart(); out.lasers = 1; } catch (e) { out.lasers = -1; }        // a parent has no price: it must not break the chart
      for (let i = 0; i < 6 && parent(); i++) { parent().startedAt -= parent().everyMs + 5; evalOrders(); await wait(260); }
      out.finished = !parent();
      out.bought = +(S.bal[coin] - held1).toFixed(4);
      out.buys = S.txns.slice(0, 4).filter(t => t.type === 'Buy').length;
      S.orders = []; saveP(); window.toast = _toast;
      return out;
    });
    ok(`${w}px · orders · the ticket carries eight order types (market · limit · stop · stop-limit · OCO · TWAP · DCA · grid)`,
      JSON.stringify(al.tabs) === JSON.stringify(['market', 'limit', 'stop', 'stopl', 'oco', 'twap', 'dca', 'grid']), al.tabs);
    ok(`${w}px · OCO · one decision places two grouped legs (take-profit + stop-loss); an inverted pair is refused with a reason and places nothing`,
      al.ocoRow && al.previewHidden && al.refused.orders === 0 && /above/.test(al.refused.msg || '') && al.group === 1
      && JSON.stringify(al.placed) === JSON.stringify([{ type: 'tp', grouped: true, qty: 5 }, { type: 'sl', grouped: true, qty: 5 }])
      && al.rows.join('|') === 'OCO TP|OCO SL', [al.refused, al.placed, al.rows]);
    ok(`${w}px · OCO · the take-profit fills and its partner is gone — one cancels the other, and by hand it cancels both`,
      al.afterFill.left === 0 && al.afterFill.sold === 5 && al.afterFill.txn === 'Sell' && al.pair === 2 && al.afterCancel === 0, [al.afterFill, al.pair, al.afterCancel]);
    ok(`${w}px · TWAP · the parent is planned, previewed one slice at a time, and rests in the working orders`,
      al.twapRow && /slices of/.test(al.note) && /^2(\.0+)? \/ 2(\.0+)? /.test(al.slicePreview || '') && al.twapTag === 'TWAP'
      && al.armed && al.armed.slices === 4 && al.armed.qty === 8 && al.armed.every === 100000 && al.lasers === 1, [al.note, al.slicePreview, al.armed, al.lasers]);
    ok(`${w}px · TWAP · every slice is worked through the same engine, then the parent retires itself`,
      al.finished && al.bought === 8 && al.buys >= 2, [al.finished, al.bought, al.buys]);

    // ---- the Blog: a real destination inside Academy, deep links that survive, a proper reading view
    const b = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const out = {};
      const active = () => [...document.querySelectorAll('#navlinks a.active')].map(a => a.textContent);
      const pageOn = () => (document.querySelector('.page.active') || {}).id;
      const overflow = () => document.documentElement.scrollWidth - innerWidth;
      const tabs = () => [...document.querySelectorAll('#page-blog .dlx-sections .dlx-tab')].map(t => t.textContent + (t.classList.contains('is-on') ? '*' : ''));
      location.hash = '#/blog'; await wait(900);
      out.index = { page: pageOn(), hash: location.hash, active: active(), tabs: tabs(), cards: [...document.querySelectorAll('#dlBlog .dlx-blog-c')].map(c => c.dataset.slug),
        feature: !!document.querySelector('#dlBlog .dlx-blog-c.dlx-blog-f'), meta: (document.querySelector('#dlBlog .dlx-blog-m time') || {}).textContent, overflow: overflow(),
        covers: document.querySelectorAll('#dlBlog .dlx-blog-c .dlx-cover > svg').length };
      location.hash = '#/blog/advanced-execution-engine'; await wait(900);
      const art = document.getElementById('dlxBlog') || {};
      const prose = document.querySelector('#dlBlog .dlx-prose');
      const pw = prose ? prose.getBoundingClientRect().width : 0, fs = prose ? parseFloat(getComputedStyle(prose).fontSize) : 0;
      let chW = 0; if (prose) { const pr = document.createElement('span'); pr.textContent = '0'.repeat(74); pr.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap'; prose.appendChild(pr); chW = pr.getBoundingClientRect().width; pr.remove(); }
      out.article = { page: pageOn(), hash: location.hash, active: active(), tabs: tabs(), slug: art.dataset && art.dataset.slug, title: (document.getElementById('dlxArtTitle') || {}).textContent,
        h1: document.querySelectorAll('#dlBlog h1').length, toc: document.querySelectorAll('#dlBlog .dlx-toc-l a').length, tables: document.querySelectorAll('#dlBlog .dlx-prose-tw table').length,
        read: ([...document.querySelectorAll('#dlBlog .dlx-art-h .dlx-blog-m')].pop() || {}).textContent || '', datetime: (document.querySelector('#dlBlog .dlx-art-h time') || { getAttribute: () => null }).getAttribute('datetime'),
        prev: (document.querySelector('#dlBlog a[rel=prev]') || {}).hash, next: (document.querySelector('#dlBlog a[rel=next]') || {}).hash,
        measure: pw > 0 && pw <= chW + 1, pw: Math.round(pw), chW: Math.round(chW), fs, overflow: overflow(),
        unsafe: [...document.querySelectorAll('#dlBlog a')].map(a => a.getAttribute('href')).filter(h => !/^(#\/|https:\/\/)/.test(h)),
        markup: document.querySelectorAll('#dlBlog script, #dlBlog style, #dlBlog iframe, #dlBlog [style], #dlBlog [onclick]').length,
        cover: !!document.querySelector('#dlxBlog > .dlx-cover > svg'), figs: document.querySelectorAll('#dlBlog figure[data-fig] svg').length,
        figCaps: [...document.querySelectorAll('#dlBlog figure[data-fig] figcaption')].length,
        remote: document.querySelectorAll('#dlBlog img, #dlBlog svg image, #dlBlog svg [href], #dlBlog [src]').length,
        drawn: [...document.querySelectorAll('#dlBlog svg')].every(s2 => s2.getAttribute('aria-hidden') === 'true'),
        animated: [...document.querySelectorAll('#dlBlog svg *')].filter(e => getComputedStyle(e).animationName !== 'none').length };
      // a heading link scrolls without touching the router's hash
      const h0 = location.hash, tl = document.querySelectorAll('#dlBlog .dlx-toc-l a')[3];
      if (tl) { const d = tl.closest('details'); if (d) d.open = true; tl.click(); } await wait(900);
      const tgt = tl && document.getElementById(tl.dataset.to);
      out.toc = { hash: location.hash === h0, page: pageOn(), top: tgt ? Math.round(tgt.getBoundingClientRect().top) : null };
      // next → the next post, and the address follows
      const nx = document.querySelector('#dlBlog a[rel=next]'); if (nx) nx.click(); await wait(900);
      out.next = { hash: location.hash, slug: (document.getElementById('dlxBlog') || { dataset: {} }).dataset.slug, scrollY: Math.round(scrollY) };
      // an address that never existed lands on the front page with a note, not on Markets
      location.hash = '#/blog/no-such-post'; await wait(900);
      out.missing = { page: pageOn(), hash: location.hash, note: !!document.querySelector('#dlBlog .dlx-blog-n'), cards: document.querySelectorAll('#dlBlog .dlx-blog-c').length };
      // the section strip gets there too
      nav('learn'); await wait(700);
      const tab = [...document.querySelectorAll('#page-learn .dlx-tab')].find(t => t.textContent === 'Blog'); if (tab) tab.click(); await wait(900);
      out.strip = { page: pageOn(), hash: location.hash };
      // the release story, the footer, the palette
      DLAPP.legacy.blog.story(); await wait(700);
      out.story = { page: pageOn(), hash: location.hash };
      // v162 · the footer is a column grid (layers/47-footer.js); the Blog links live in its
      // Learn column, not in the flat .dl-foot-blog run. What is asserted is reachability FROM
      // THE FOOTER, so the selector is the footer, not one shape of it.
      out.footer = [...document.querySelectorAll('footer a[href]')].map(a => a.getAttribute('href'));
      out.cmdk = typeof cmdkBuild === 'function' ? cmdkBuild('blog').filter(i => i.grp === 'Commands').map(i => i.label) : [];
      // Advanced mode's preview links the engine article; Beginner's does not
      nav('coin'); S.ordType = 'market'; S.side = 'buy';
      const sim0 = JSON.stringify(S.dlsim || {});
      const a = document.getElementById('amt'); a.value = '1'; a.dispatchEvent(new Event('input'));
      S.dlsim = Object.assign(S.dlsim || {}, { mode: 'pro', venue: 'binance' }); CBXpreview(); await wait(60);
      out.guideAdv = (document.querySelector('#cbxPrev a[data-guide]') || { getAttribute: () => null }).getAttribute('href');
      S.dlsim.mode = 'beginner'; CBXpreview(); await wait(60);
      out.guideBeg = !!document.querySelector('#cbxPrev a[data-guide]');
      S.dlsim = JSON.parse(sim0); try { CBXpreview(); } catch (e) {}
      return out;
    });
    const POSTS7 = ['what-is-dexladder', 'advanced-execution-engine', 'paper-vs-real-dex-trading', 'academy-and-labs', 'sovereignty-proof-ledger', 'p2p-explorer-and-the-desk', 'how-dexladder-is-built', 'bots-build-and-bring', 'rewind-and-backtesting', 'perpetuals-funding-liquidation', 'order-types-and-algos', 'liquidity-desk-amms-and-il', 'local-fork-sandbox', 'dexai-on-device-copilot', 'markets-and-the-data-ladder', 'news-sentiment-and-attention', 'portfolio-journal-and-record', 'the-desks', 'journey-quests-and-daily', 'apps-offline-and-install', 'day-night-and-the-design-system', 'security-and-trust'];
    ok(`${w}px · blog · #/blog is the Blog page inside Academy (header Academy, strip marks Blog), all 22 posts listed, the first featured`,
      b.index.page === 'page-blog' && b.index.hash === '#/blog' && b.index.active.join() === 'Academy' && b.index.tabs.includes('Blog*') && JSON.stringify(b.index.cards) === JSON.stringify(POSTS7) && b.index.feature && /\d{4}$/.test(b.index.meta || '') && b.index.overflow <= 1, b.index);
    ok(`${w}px · blog · a deep link opens the post and keeps its address; one h1, contents, tables, read time, last-updated date, previous/next`,
      b.article.page === 'page-blog' && b.article.hash === '#/blog/advanced-execution-engine' && b.article.slug === 'advanced-execution-engine' && b.article.title === 'The Advanced Execution Engine'
      && b.article.active.join() === 'Academy' && b.article.tabs.includes('Blog*') && b.article.h1 === 1 && b.article.toc >= 6 && b.article.tables >= 3 && /\d+ min read/.test(b.article.read) && /Updated/.test(b.article.read)
      && b.article.datetime === '2026-09-11' && b.article.prev === '#/blog/what-is-dexladder' && b.article.next === '#/blog/paper-vs-real-dex-trading', b.article);
    ok(`${w}px · blog · the reading column is measured (≤ 74ch), nothing scrolls the page sideways, every link is in-app or https, no markup from content`,
      b.article.measure && b.article.fs >= 16 && b.article.overflow <= 1 && b.article.unsafe.length === 0 && b.article.markup === 0, { pw: b.article.pw, chW: b.article.chW, fs: b.article.fs, overflow: b.article.overflow, unsafe: b.article.unsafe, markup: b.article.markup });
    ok(`${w}px · blog · every post has a drawn cover; the article's figures are inline SVG with captions, no file, no remote reference, and they animate`,
      b.index.covers === 22 && b.article.cover && b.article.figs === 4 && b.article.figCaps === 4 && b.article.remote === 0 && b.article.drawn && b.article.animated >= 3,
      { covers: b.index.covers, cover: b.article.cover, figs: b.article.figs, caps: b.article.figCaps, remote: b.article.remote, drawn: b.article.drawn, animated: b.article.animated });
    ok(`${w}px · blog · a contents link scrolls to its heading without touching the address`, b.toc.hash && b.toc.page === 'page-blog' && b.toc.top !== null && b.toc.top < 200, b.toc);
    ok(`${w}px · blog · next goes to the next post (address follows, top of page)`, b.next.hash === '#/blog/paper-vs-real-dex-trading' && b.next.slug === 'paper-vs-real-dex-trading' && b.next.scrollY < 50, b.next);
    ok(`${w}px · blog · an unknown post address lands on the Blog front page with a note (never on Markets)`, b.missing.page === 'page-blog' && b.missing.hash === '#/blog' && b.missing.note && b.missing.cards === 22, b.missing);
    ok(`${w}px · blog · reachable from the Academy strip, the v156 story, the footer and the command palette`,
      b.strip.page === 'page-blog' && b.strip.hash === '#/blog' && b.story.hash === '#/blog/advanced-execution-engine'
      && b.footer.includes('#/blog') && b.footer.includes('#/blog/advanced-execution-engine') && b.cmdk.includes('blog') && b.cmdk.some(l => l === 'blog · The Advanced Execution Engine'), [b.strip, b.story, b.footer, b.cmdk]);
    ok(`${w}px · blog · Advanced mode's order preview links the engine article; Beginner's does not`, b.guideAdv === '#/blog/advanced-execution-engine' && b.guideBeg === false, [b.guideAdv, b.guideBeg]);
    if (w === 1440) {
      // ---- Phase 2.1 · price impact, tolerance, preview = fill, no dent from a refused order
      const q = await page.evaluate(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const out = {};
        // the ticket's error line is wiped by the live refresh (legacy recalc); the toast is the durable message
        const T = []; const _t = window.toast; window.toast = function () { T.push([...arguments]); return _t.apply(this, arguments); };
        const lastToast = () => (T[T.length - 1] || []).slice(1).join(' | ');
        const coin = (bySym.DOGE || bySym.ADA || bySym.XRP) ? (bySym.DOGE ? 'DOGE' : bySym.ADA ? 'ADA' : 'XRP') : 'SOL';
        out.coin = coin;
        nav('coin'); S.coin = coin; S.quote = 'USDT'; S.ordType = 'market'; S.side = 'buy';
        try { setSide('buy'); } catch (e) {}
        const setAmt = v => { const a = document.getElementById('amt'); a.value = String(v); a.dispatchEvent(new Event('input')); };
        // Beginner: the order book, no tolerance control
        S.dlsim = Object.assign(S.dlsim || {}, { mode: 'beginner' });
        setAmt(1); CBXpreview(); await wait(50);
        out.beginner = { badge: (document.querySelector('#cbxPrev .dlx-badge') || {}).textContent, tol: !!document.getElementById('dlxTol'), realism: CBX.realism().mode };
        // Advanced on the DEX venue, 0.5% tolerance
        S.dlsim = Object.assign(S.dlsim, { mode: 'pro', venue: 'dexamm', slipTol: 0.5, latency: 0, gasMode: 'calm', gasHist: [8], gasAt: Date.now(), tier: 'medium' });
        CBX.reset();
        // the network's dice, scripted: each placeOrder consumes a queue, then falls back to 0.5
        const _r = Math.random; let dice = [];
        const roll = seq => { dice = seq.slice(); Math.random = () => (dice.length ? dice.shift() : _r()); };
        const unroll = () => { Math.random = _r; };
        const px = pairPrice(coin, 'USDT'), small = 200 / px;
        setAmt(small); CBXpreview(); await wait(50);
        const pv = CBX.preview(coin, 'USDT', 'buy', small, { tolerancePct: 0.5 });
        out.adv = { badge: (document.querySelector('#cbxPrev .dlx-badge') || {}).textContent, tol: !!document.getElementById('dlxTol'),
          checked: (document.querySelector('#dlxTol [aria-checked="true"]') || {}).textContent, previewImpact: pv && pv.amm && pv.amm.impactPct };
        const bal0 = S.bal[coin] || 0, usd0 = S.bal.USDT, gasEst = DLAPP.legacy.paper.gasEstimate('USDT');
        roll([0.01, 0.5]); placeOrder(); unroll(); await wait(600);
        const tx = S.txns[0] || {};
        out.fill = { got: (S.bal[coin] || 0) - bal0, previewFilled: pv.filled, val: tx.val, previewCost: pv.filled * pv.avg,
          dUSDT: S.bal.USDT - usd0, gasEst, feeRate: pv.feeRate, mined: T.some(x => x[1] === 'Swap mined') };
        // far beyond the pool: refused with the sentence, nothing moves, the pool is not dented
        await wait(6500); CBX.reset();
        const huge = 5e7 / px, before = JSON.stringify(S.bal), p0 = CBX.preview(coin, 'USDT', 'buy', 1, {}).avg;
        S.bal.USDT = 1e9; const snap = JSON.stringify(S.bal);
        setAmt(huge); placeOrder(); await wait(600);
        out.reject = { err: lastToast(), unchanged: JSON.stringify(S.bal) === snap, noDent: CBX.preview(coin, 'USDT', 'buy', 1, {}).avg === p0 };
        S.bal = JSON.parse(before);
        // unaffordable: refused before consuming anything
        CBX.reset(); const p1 = CBX.preview(coin, 'USDT', 'buy', 1, {}).avg;
        S.dlsim.slipTol = 50; setAmt(5e5 / px);
        let errNow = ''; const obs = new MutationObserver(() => { const t = document.getElementById('err').textContent; if (t) errNow = t; });
        obs.observe(document.getElementById('err'), { childList: true, characterData: true, subtree: true });
        placeOrder(); await wait(600); obs.disconnect();
        out.unfunded = { err: errNow, noDent: CBX.preview(coin, 'USDT', 'buy', 1, {}).avg === p1 };
        // ---- Phase 2.2 · gas & priority
        S.bal = JSON.parse(before); S.dlsim.slipTol = 0.5;
        setAmt(small); CBXpreview(); await wait(50);
        const prev = document.getElementById('cbxPrev').textContent;
        out.prio = { dex: !!document.getElementById('dlxPrio'), checked: (document.querySelector('#dlxPrio [aria-checked="true"]') || {}).textContent, gasRow: /Gas \(medium priority\)/.test(prev), netRow: /gwei · calm · practice|gwei · calm · estimate/.test(prev) };
        S.dlsim.venue = 'binance'; CBXpreview(); await wait(50);
        out.prio.book = !!document.getElementById('dlxPrio') || /Gas \(/.test(document.getElementById('cbxPrev').textContent);
        S.dlsim.venue = 'dexamm';
        // congested + Low + unlucky dice → never picked up: cancellation gas paid, nothing traded
        S.dlsim.gasMode = 'congested'; S.dlsim.tier = 'low'; CBX.reset();
        let b0 = JSON.stringify(S.bal), c0 = S.bal[coin] || 0, u0 = S.bal.USDT, tr0 = S.stats.trades, n0 = T.length;
        roll([0.999, 0.5]); placeOrder(); unroll(); await wait(600);
        out.dropped = { gasRow: S.txns[0] && S.txns[0].type === 'Gas' && S.txns[0].note === 'cancelled swap (never mined)' && /Gas · .* USDT · cancelled swap/.test((document.getElementById('txns') || {}).textContent || ''), toast: (T.slice(n0).find(x => x[1] === 'Swap never picked up') || [])[1], paid: u0 - S.bal.USDT, coin: (S.bal[coin] || 0) === c0, trades: S.stats.trades === tr0, expect: 21000 * 8 * 3 * 1.3 * 1e-9 * pairPrice('ETH', 'USDT') };
        // congested + Low + pending + a big move against a 0.1% tolerance → mined and REVERTED, gas burned
        S.bal = JSON.parse(b0); S.dlsim.slipTol = 0.1; CBX.reset();
        u0 = S.bal.USDT; n0 = T.length; const p2 = CBX.preview(coin, 'USDT', 'buy', 1, {}).avg;
        roll([0.3, 0.99, 1e-9, 0]); placeOrder(); unroll(); await wait(600);
        out.reverted = { toast: (T.slice(n0).find(x => x[1] === 'Swap reverted on-chain') || []).slice(1).join(' | '), paid: u0 - S.bal.USDT, coin: (S.bal[coin] || 0) === c0, noDent: CBX.preview(coin, 'USDT', 'buy', 1, {}).avg === p2, expect: 90000 * 8 * 3 * 0.9 * 1e-9 * pairPrice('ETH', 'USDT') };
        // High priority is the cure: the same congestion, the same dice → it makes the block
        S.bal = JSON.parse(b0); S.dlsim.tier = 'high'; S.dlsim.slipTol = 0.5; CBX.reset(); n0 = T.length;
        roll([0.3, 0.99]); placeOrder(); unroll(); await wait(600);
        out.high = { mined: T.slice(n0).some(x => x[1] === 'Swap mined'), got: (S.bal[coin] || 0) > c0 };
        // ---- Phase 2.3 · MEV sandwich (Advanced · DEX · opt-in)
        S.bal = JSON.parse(b0); S.dlsim.gasMode = 'calm'; S.dlsim.tier = 'medium'; S.dlsim.slipTol = 3; CBX.reset();
        setAmt(small); CBXpreview(); await wait(50);
        out.mev = { control: !!document.getElementById('dlxMev'), offByDefault: (document.querySelector('#dlxMev [aria-checked="true"]') || {}).textContent === 'Off' };
        // with the bots off, even a wide tolerance is never sandwiched
        let q3 = 0; S.dlsim.mev = true;
        for (let q = 100 / px; q < 5e6 / px && !q3; q *= 1.3) { const v = CBX.preview(coin, 'USDT', 'buy', q, { tolerancePct: 3, mev: DLAPP.legacy.paper.mevOf(S) }); if (v && v.amm && v.amm.sandwich) q3 = q; }
        S.dlsim.mev = false; S.bal.USDT = 1e9; n0 = T.length; CBX.reset();
        if (q3) { setAmt(q3); roll([0.01, 0.5]); placeOrder(); unroll(); await wait(600); }
        out.mev.offClean = q3 > 0 && !T.slice(n0).some(x => x[1] === 'Sandwiched by an MEV bot');
        // bots on: the ticket warns first, then the fill is exactly the predicted sandwich
        S.bal = JSON.parse(b0); S.bal.USDT = 1e9; S.dlsim.mev = true; CBX.reset(); await wait(6500); CBX.reset();
        setAmt(q3); CBXpreview(); await wait(50);
        const pm = CBX.preview(coin, 'USDT', 'buy', q3, { tolerancePct: 3, mev: DLAPP.legacy.paper.mevOf(S) });
        const ptxt = document.getElementById('cbxPrev').textContent;
        out.mev.warned = /If a bot sandwiches you/.test(ptxt) && /MEV · your tolerance pays a bot/.test(ptxt);
        n0 = T.length; const cb = S.bal[coin] || 0;
        roll([0.01, 0.5]); placeOrder(); unroll(); await wait(600);
        const sw = T.slice(n0).find(x => x[1] === 'Sandwiched by an MEV bot');
        const txm = S.txns[0] || {};
        out.mev.toast = sw ? sw[2] : null;
        out.mev.exact = pm && pm.amm && pm.amm.sandwich && Math.abs(txm.val - (S.bal[coin] - cb) * pm.amm.sandwich.avg) < 1e-6 * txm.val;
        out.mev.edge = pm && pm.amm && pm.amm.sandwich && pm.amm.sandwich.avg <= pm.amm.p0 * 1.03 && pm.amm.sandwich.avg > pm.amm.p0 * 1.0299;
        // a tight tolerance leaves the bot no room
        S.dlsim.slipTol = 0.5; CBX.reset(); const pt = CBX.preview(coin, 'USDT', 'buy', small, { tolerancePct: 0.5, mev: DLAPP.legacy.paper.mevOf(S) });
        out.mev.tight = !!pt && !(pt.amm && pt.amm.sandwich);
        out.mev.lab = /The MEV Auction/.test(ptxt) && /The MEV Auction/.test(out.mev.toast || '');
        // ---- Phase 2.5 · modes named Beginner / Advanced; every surprise points at the Academy lab that teaches it
        S.dlsim.mev = false; setAmt(small); CBXpreview(); await wait(50);
        const spy = {}; for (const f of ['openDefiLab', 'openMevGame']) { spy[f] = 0; const o = window[f]; window['_' + f] = o; window[f] = function () { spy[f]++; }; }
        const lk = [...document.querySelectorAll('#cbxPrev a')].find(a => /DeFi Playground/.test(a.textContent));
        if (lk) lk.click();
        for (const f of ['openDefiLab', 'openMevGame']) window[f] = window['_' + f];
        out.edu = { ammLink: !!lk, opened: spy.openDefiLab === 1 };
        DLSIM.mode('pro'); await wait(100);
        out.edu.chip = (document.getElementById('dlSimChip') || {}).textContent || '';
        out.edu.sheet = (document.getElementById('dlSimBody') || {}).textContent || '';
        DLSIM.hide();
        S.dlsim.mev = false;
        // ---- Phase 2.4 · partial fills & liquidity failure
        S.bal = JSON.parse(b0); S.bal.USDT = 1e9; S.dlsim.slipTol = 3; S.dlsim.mev = false; CBX.reset();
        // a concentrated pool (±1%) cannot supply a huge market buy: fill what it has, cancel the rest
        S.dlsim.range = 1; n0 = T.length; const ord0 = (S.orders || []).length, big = 5e7 / px;
        const pp = CBX.preview(coin, 'USDT', 'buy', big, { tolerancePct: 3 });
        const c1 = S.bal[coin] || 0;
        setAmt(big); roll([0.01, 0.5]); placeOrder(); unroll(); await wait(600);
        const tp = T.slice(n0);
        out.partial = {
          previewPartial: pp && pp.exhausted && pp.filled < big, got: (S.bal[coin] || 0) - c1, previewFilled: pp && pp.filled,
          toastFill: (tp.find(x => x[1] === 'Partially filled') || [])[2], toastRest: (tp.find(x => x[1] === 'Remainder cancelled') || [])[2],
          of: S.txns[0] && S.txns[0].of, asked: big, rests: (S.orders || []).length - ord0,
          ledger: /partial \d+% of/.test((document.getElementById('txns') || {}).textContent || ''),
        };
        // …and a huge partial SELL closes part of the position: the trade journal says so
        await wait(6500); CBX.reset(); n0 = T.length;
        S.side = 'sell'; try { setSide('sell'); } catch (e) {}
        S.bal[coin] = (S.bal[coin] || 0) + big; setAmt(big * 0.9); roll([0.01, 0.5]); placeOrder(); unroll(); await wait(600);
        try { renderJournal(); } catch (e) {}
        out.partial.journal = S.journal && S.journal[0] && S.journal[0].of > 0 && /partial fill of/.test((document.getElementById('jrnl') || { textContent: 'no-jrnl' }).textContent);
        out.partial.jrnlHost = !!document.getElementById('jrnl');
        S.side = 'buy'; try { setSide('buy'); } catch (e) {} delete S.dlsim.range;
        // near-zero liquidity: a coin with no real market is refused outright — nothing sent, no gas
        const cc = bySym[coin], keepV = cc.vol, keepM = cc.mcap; cc.vol = 1e3; cc.mcap = 1e9;
        S.bal = JSON.parse(b0); const snapNZ = JSON.stringify(S.bal), tx0 = S.txns.length; n0 = T.length; CBX.reset();
        setAmt(small); CBXpreview(); await wait(50);
        const nzPrev = document.getElementById('cbxPrev').textContent;
        roll([0.01, 0.5]); placeOrder(); unroll(); await wait(600);
        out.nearZero = { preview: /Near-zero liquidity/.test(nzPrev), toast: (T.slice(n0).find(x => x[1] === 'Order rejected') || [])[2], unchanged: JSON.stringify(S.bal) === snapNZ, noRow: S.txns.length === tx0 };
        cc.vol = keepV; cc.mcap = keepM;
        // ---- Phase 2.6 · gap policy: an Advanced stop-loss gapped through fills at the market, Beginner at its price
        const gapRun = async (mode) => {
          S.bal = JSON.parse(b0); S.bal[coin] = 10; S.dlsim.mode = mode; S.dlsim.venue = 'binance'; CBX.reset();
          const cur = pairPrice(coin, 'USDT'); S.orders = S.orders || [];
          S.orders.push({ id: 'gap-' + mode, type: 'sl', side: 'sell', sym: coin, quote: 'USDT', qty: 1, px: cur * 1.05, t: Date.now() });
          n0 = T.length; evalOrders(); await wait(100);
          const tx = S.txns[0] || {}, body = T.slice(n0).map(x => x[2] || '').join(' | ');
          return { cur, stop: cur * 1.05, px: tx.amt ? tx.val / tx.amt : 0, gone: !S.orders.some(o => o.id === 'gap-' + mode), explained: /but the market was already at/.test(body) };
        };
        out.gap = { adv: await gapRun('pro'), beg: await gapRun('beginner') };
        S.dlsim.mode = 'pro'; S.dlsim.venue = 'dexamm';
        // Beginner: never any gas, never any control
        S.bal = JSON.parse(b0); S.dlsim.mode = 'beginner'; setAmt(small); CBXpreview(); await wait(50);
        out.beginnerGas = !!document.getElementById('dlxPrio') || !!document.getElementById('dlxMev') || /Gas \(|gwei/.test(document.getElementById('cbxPrev').textContent) || DLAPP.legacy.paper.gasEstimate('USDT') !== 0;
        S.bal = JSON.parse(before);
        S.dlsim = Object.assign(S.dlsim, { mode: 'beginner', venue: 'binance', slipTol: 0.5, latency: 1, tier: 'medium' }); delete S.dlsim.gasMode;
        window.toast = _t; setAmt(''); return out;
      });
      const rel = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
      ok('realism · Beginner prices on the order book, with no tolerance control', q.beginner.badge === 'Order book' && !q.beginner.tol && q.beginner.realism === 'beginner', q.beginner);
      ok('realism · Advanced prices on the pool and shows the tolerance control (0.5% checked)', /^Pool/.test(q.adv.badge || '') && q.adv.tol && q.adv.checked === '0.5%' && q.adv.previewImpact > 0, q.adv);
      ok('realism · the fill is exactly the preview (same size, same cost)', rel(q.fill.got, q.fill.previewFilled) && rel(q.fill.val, q.fill.previewCost), q.fill);
      ok('gas · a mined DEX swap pays the 0.30% pool fee + exactly the gas the ticket quoted, through the one fill', q.fill.mined && q.fill.feeRate === 0.003 && q.fill.gasEst > 0 && Math.abs(q.fill.dUSDT + q.fill.val * 1.003 + q.fill.gasEst) < 1e-6, q.fill);
      ok('gas · the priority control and gas line appear on the DEX (Medium default), never on a book venue', q.prio.dex && q.prio.checked === 'Medium' && q.prio.gasRow && q.prio.netRow && !q.prio.book, q.prio);
      ok('gas · congested + Low priority can be dropped: nothing trades, the cancellation gas is still paid', q.dropped.toast && q.dropped.coin && q.dropped.trades && Math.abs(q.dropped.paid - q.dropped.expect) < 1e-6, q.dropped);
      ok('gas · a pending swap that meets a moved price REVERTS: nothing trades, no dent, the burned gas is paid', /Swap reverted on-chain \| .*REVERTED on-chain/.test(q.reverted.toast) && q.reverted.coin && q.reverted.noDent && Math.abs(q.reverted.paid - q.reverted.expect) < 1e-6, q.reverted);
      ok('gas · High priority makes the block under the same congestion and dice', q.high.mined && q.high.got, q.high);
      ok('gas · Beginner never shows or pays gas (and never meets an MEV bot)', !q.beginnerGas);
      ok('mev · the bots control sits on the DEX ticket, Off by default; with them off nothing is sandwiched', q.mev.control && q.mev.offByDefault && q.mev.offClean, q.mev);
      ok('mev · bots on + 3% tolerance: the ticket warns before sending', q.mev.warned, q.mev);
      ok('mev · the alert is the brief\'s sentence, verbatim, first', (q.mev.toast || '').startsWith('You were sandwiched by a simulated MEV bot. In real trading this is why low slippage + private RPC matters.'), q.mev.toast);
      ok('mev · the fill is exactly the predicted sandwich, at the worst price still inside tolerance', q.mev.exact && q.mev.edge, q.mev);
      ok('mev · a 0.5% tolerance leaves the bot no room', q.mev.tight);
      ok('edu · a sandwich points at the Academy\'s MEV Auction (ticket and alert)', q.mev.lab, q.mev);
      ok('edu · an Advanced preview links the DeFi Playground, and the link opens it', q.edu.ammLink && q.edu.opened, q.edu);
      ok('modes · the mode is called Advanced (chip + sheet), the sheet describes pools, gas and the MEV bots switch', /Execution: Advanced · /.test(q.edu.chip) && /🎯 Advanced/.test(q.edu.sheet) && /Advanced behaviors/.test(q.edu.sheet) && /Simulated MEV bots/.test(q.edu.sheet) && !/🎯 Pro|Pro behaviors|applies in Pro|Pro ·/.test(q.edu.chip + q.edu.sheet), q.edu);
      ok('ledger · gas paid for a swap that traded nothing is its own row in the transaction history', q.dropped.gasRow, q.dropped);
      ok('partial · a market order larger than the pool\'s range fills what the pool has (preview = fill) and the rest is cancelled, not rested', q.partial.previewPartial && rel(q.partial.got, q.partial.previewFilled) && /% of your size/.test(q.partial.toastFill || '') && /pool's range ran out/.test(q.partial.toastRest || '') && q.partial.rests === 0, q.partial);
      ok('partial · the transaction history records the partial quantity against the order size', rel(q.partial.of, q.partial.asked) && q.partial.ledger, q.partial);
      ok('partial · a partial close is marked in the trade journal', q.partial.journal, q.partial);
      ok('gap · Advanced: a stop-loss the market gapped through fills at the market (not its stop price) and says why', q.gap.adv.gone && q.gap.adv.px <= q.gap.adv.cur && q.gap.adv.px > q.gap.adv.cur * 0.99 && q.gap.adv.explained, q.gap);
      ok('gap · Beginner keeps the forgiving Phase 1 fill at the stop price', q.gap.beg.gone && Math.abs(q.gap.beg.px - q.gap.beg.stop) < 1e-9 * q.gap.beg.stop && !q.gap.beg.explained, q.gap);
      ok('liquidity · near-zero liquidity is refused before sending (preview warns; no fill, no gas, no ledger row)', q.nearZero.preview && /^Near-zero liquidity/.test(q.nearZero.toast || '') && q.nearZero.unchanged && q.nearZero.noRow, q.nearZero);
      ok('realism · an order beyond tolerance is refused with the educational sentence, nothing moves, no dent', /^Order rejected \| Price impact .* exceeds your 0\.500% slippage tolerance\./.test(q.reject.err || '') && q.reject.unchanged && q.reject.noDent, q.reject);
      ok('realism · an unaffordable order is refused before it touches the pool', /^Not enough USDT/.test(q.unfunded.err || '') && q.unfunded.noDent, q.unfunded);
    }
    // ---- the Markets rail header survives its host being moved to another parent (gate154 "x2" race)
    const rail = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      nav('markets'); await wait(1500);
      const host = document.getElementById('mxMoversHost'), mp = document.getElementById('mktpro');
      if (!host || !mp || !host.children.length) return { skipped: true, host: !!host, kids: host ? host.children.length : 0 };
      const box = document.createElement('div'); box.id = 'dlRailMoveProbe'; mp.appendChild(box); box.appendChild(host);
      await wait(900);
      const hs = [...document.querySelectorAll('.mx-rail-h[data-for="mxMoversHost"]')];
      const out = { n: hs.length, beside: hs.length === 1 && hs[0].nextElementSibling === host };
      return out;
    });
    ok(`${w}px · Markets: one rail header per host even after the host moves to another parent`, rail.n === 1 && rail.beside, rail);
    // ---- the Terminal chart is a bounded panel like the TradingView one (owner report 11 Sep 2026: it ran 1,700px+ down the page)
    const chart = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      openCoin('BTC'); await wait(1500);
      const cv = document.getElementById('coinChart'), host = document.getElementById('coinHost');
      const h0 = Math.round(cv.getBoundingClientRect().height);
      try { drawCoinChart(); drawCoinChart(); drawCoinChart(); } catch (e) {}
      await wait(2500);
      const m0 = document.documentElement.getAttribute('data-mode'); DLMODE.set('dark'); await wait(300);
      const cs = getComputedStyle(host), look = { bg: cs.backgroundColor, inset: cs.boxShadow };
      if (m0 === 'day') DLMODE.set('day');
      return { h0, h1: Math.round(cv.getBoundingClientRect().height), host: Math.round(host.getBoundingClientRect().height), frame: cs.borderTopLeftRadius, look };
    });
    const panelH = w <= 760 ? 430 : 560;
    ok(`${w}px · Terminal: the DexLadder chart is a ${panelH}px panel and does not grow when redrawn`, Math.abs(chart.host - panelH) <= 1 && chart.h1 <= panelH && chart.h1 === chart.h0 && chart.frame === '12px', chart);
    if (w === 1440) {
      const hist = await page.evaluate(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const c = bySym.BTC, p = c.price, fake = [];
        for (let i = 0; i < 336; i++) fake.push([i, 0, 0, 0, String(p * (1 + 0.03 * Math.sin(i / 20))), 0]);
        const C = window.DLCORE, orig = C.jget, asked = [];
        C.jget = (u, o) => { asked.push(u); return /binance\.vision/.test(u) ? Promise.resolve({ data: fake }) : orig(u, o); };
        c.hist.length = 0; for (let i = 0; i < 336; i++) c.hist.push(i < 180 ? p * 1.02 : p);    // the owner's flat-then-cliff series
        drawCoinChart(); updateSpotlight(); await wait(800); C.jget = orig;
        return { asked: asked.filter(u => /binance\.vision/.test(u)).length, distinct: new Set(c.hist.map(v => v.toPrecision(6))).size, endsLive: Math.abs(c.hist[c.hist.length - 1] / c.price - 1) < 1e-3 };
      });
      ok(`${w}px · history: a padded flat-then-cliff series is replaced by real candles (one request), ending at the live price`, hist.asked === 1 && hist.distinct > 300 && hist.endsLive, hist);
    }
    ok(`${w}px · Terminal: in Night the DexLadder chart box is the TradingView box (#141619 ground, #2A2E39 inner line)`, chart.look.bg === 'rgb(20, 22, 25)' && /rgb\(42, 46, 57\)/.test(chart.look.inset), chart.look);
    ok(`${w}px · no page error`, errors.length === 0, errors.slice(0, 3));
    await hh.close();
  }
  console.log(`\n${pass} passed · ${fail} failed`);
  process.exit(fail);
})().catch(e => { console.error(e); process.exit(99); });
