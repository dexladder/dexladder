# -*- coding: utf-8 -*-
"""
v162 · the audit pass.

Applied LAST, against the near-final payload, so every anchor here is matched
against the bytes that actually ship. Every replacement is count-checked and
raises SystemExit on a miss: a silent no-op patch is a shipped bug.

Findings closed here (base payload only; layer-level findings are fixed in
layers/*.js, build-level ones in build154.py / buildlib / seo):

  SEC-1  new Function() removed entirely - the two data-go sinks are replaced by
         a bounded function registry. Untrusted CoinGecko symbols no longer reach
         a code string. The payload's shipped "eval-free" claim becomes true.
  RUN-1  boot() was one comma expression: any throw in phase 1 skipped route(),
         leaving the page dead on its loading skeleton. Now phase-isolated.
  RUN-2  no window.onerror / unhandledrejection handler existed anywhere.
  RUN-3  two open tabs silently clobbered each other's portfolio (last write wins).
  RUN-4  a total localStorage write failure was swallowed by an empty catch -
         the user lost a trade with no indication at all.
  PERF-1 tick() ran the engine in hidden tabs, and replayed up to 240 missed
         ticks synchronously on refocus (a visible freeze).
  A11Y-1 prefers-reduced-motion rule shipped `animation-duration:NaNs` - not a
         valid <time>, so the whole declaration was dropped by the parser.
  A11Y-2 43 modal close buttons had no accessible name.
  A11Y-3 dialogs had role+aria-modal but no accessible name.
  A11Y-4 live portfolio total was never announced.
  DOM-1  duplicate market rows were hidden, not removed, leaving duplicate
         gradient ids in the DOM.
  NUM-1  cNum()/pct() rendered "InfinityB" / "+Infinity%".
  UI-1   the retry countdown showed "0s" before the retry fired.
  COPY-1 lead copy sold a simulator; the product is the gateway to Web3.
         (Legally required simulated/educational wording is untouched.)
  COPY-2 "Search 500+ coins" - the fetch is hard-capped at exactly 500.
"""

import re, sys


def _fail(msg):
    raise SystemExit('v162 FAILED: ' + msg)


def rep(out, tag, old, new, n=1):
    c = out.count(old)
    if c != n:
        _fail('%s - expected %d occurrence(s), found %d' % (tag, n, c))
    return out.replace(old, new)


HEAD_GUARD = """<script>
/* v162 - resilience layer. Runs before every other script in the document. */
(function () {
  "use strict";
  try {
    /* --- safe jump registry: no code string is ever compiled from data-go --- */
    var GO = { n: 0, m: Object.create(null) };
    window.__dlGoPut = function (f) {
      if (typeof f !== "function") return -1;
      var k = ++GO.n; GO.m[k] = f;
      if (GO.n > 300) delete GO.m[GO.n - 300];
      return k;
    };
    window.__dlGoRun = function (k) {
      var f = GO.m[+k];
      if (typeof f === "function") { try { f(); } catch (e) { try { console.error("jump", e); } catch (_) {} } }
    };

    /* --- global error net -------------------------------------------------- */
    var LOG = [], last = 0, shown = 0;
    window.__DLERR = LOG;
    function note(x) {
      try {
        LOG.push({ t: Date.now(), m: String((x && x.message) || x) });
        if (LOG.length > 20) LOG.shift();
      } catch (_) {}
    }
    function flag(x) {
      note(x);
      var n = Date.now();
      if (shown < 3 && n - last > 60000) {
        last = n; shown++;
        try { window.toast && window.toast("bad", "Something broke", "A part of the page failed. Reload if it stays wrong."); } catch (_) {}
      }
    }
    window.addEventListener("error", function (e) { flag((e && e.error) || (e && e.message)); });
    window.addEventListener("unhandledrejection", function (e) { flag(e && e.reason); });

    /* --- single-writer guard: two tabs must not overwrite one ledger ------- */
    window.addEventListener("storage", function (e) {
      try {
        if (!e || e.key !== "coinbridge.v1") return;
        window.__DL_FOREIGN = 1;
        if (window.__DL_FOREIGN_SAID) return;
        window.__DL_FOREIGN_SAID = 1;
        try {
          window.toast && window.toast("bad", "Open in another tab",
            "Your ledger is being changed in another tab. This tab has stopped saving so it cannot overwrite that one - reload here to carry on in this tab.");
        } catch (_) {}
      } catch (_) {}
    });
  } catch (_) {}
})();
</script>
"""

BOOT_NEW = (
    'function boot(){let rt;const _P=function(n,f){try{f()}catch(e){try{console.error("boot:"+n,e)}catch(_){}}};'
    '_P("motion",function(){MOTION.raf=(window.requestAnimationFrame||function(f){return setTimeout(()=>f(Date.now()),16)})(conduct)}),'
    '_P("chips",function(){updateCalmChip(),updateSfxChip()}),'
    '_P("state",function(){adopt(makeSim()),restoreState()}),'
    '_P("ticker",function(){renderTicker()}),'
    '_P("route",function(){route()}),'
    '_P("bands",function(){renderXband(),renderNetline()}),'
    '_P("globals",function(){window.DLSNAP?DLSNAP.start():fetchGlobals()}),'
    'setInterval(()=>{document.hidden||renderNetline()},15e3),'
    'setInterval(tick,1500),'
    'setInterval(()=>{document.hidden||LIVE.inflight||Date.now()>=LIVE.next&&loadLive()},6e4),'
    'setInterval(()=>{document.hidden||quorumCheck()},9e4),'
    'setTimeout(()=>{document.hidden||quorumCheck()},12e3),'
    'window.addEventListener("resize",()=>{clearTimeout(rt),rt=setTimeout(()=>{'
    '"markets"===S.view?updateSpotlight():"coin"===S.view?drawCoinChart():"learn"===S.view?'
    'void 0!==academyLoaded&&academyLoaded&&renderCourse():renderPortfolio()},150)}),'
    '_P("tour",function(){S.tourDone||setTimeout(()=>{S.tourDone||document.hidden||window.DLXW||startTour()},1600)})}'
)

TICK_NEW = (
    'function tick(){if(document.hidden)return;'
    'const now=Date.now(),missed=Math.min(240,Math.max(0,Math.round((now-_lastTick)/1500)-1));'
    'if(_lastTick=now,missed>0){const fills0=S.stats&&S.stats.trades||0;let left=missed;'
    'const _chunk=function(){let n=Math.min(24,left);for(let i=0;i<n;i++)tickEngine();'
    'if(left-=n,left>0)return void setTimeout(_chunk,0);'
    'const fills=S.stats&&S.stats.trades||0;'
    'if(fills>fills0||missed>=3){'
    'try{a11ySay(`Welcome back — ${missed} market ticks caught up while you were away${fills>fills0?`, ${fills-fills0} order${fills-fills0===1?"":"s"} filled`:""}.`)}catch(_e){}'
    'try{toast("good","Caught up ⏱",`${missed} ticks replayed${fills>fills0?` · ${fills-fills0} order${fills-fills0===1?"":"s"} executed while away`:""}.`)}catch(_e){}}};'
    '_chunk()}'
    'tickEngine(),updateNavBal(),'
    '"markets"===S.view?(updateMarketRows(),updateSpotlight(),telem.ticks%4==0&&(renderMovers(),renderHQ()),telem.ticks%8==0&&renderInsights()):'
    '"coin"===S.view?updateCoinLive():'
    '"portfolio"===S.view?updatePortfolioLive():'
    '"news"===S.view&&telem.ticks%8==0&&(rdSample(),renderResearch()),'
    'telem.ticks%2==0&&updateTelem(),telem.ticks%8==0&&renderTicker(),'
    'function(){try{if("portfolio"!==S.view||telem.ticks%20!=0)return;'
    'var t=document.getElementById("pf-total");'
    't&&t.textContent&&t.textContent!==window.__pfSaid&&(window.__pfSaid=t.textContent,a11ySay("Portfolio total "+t.textContent))}catch(_e){}}()}'
)

DEDUPE_NEW = (
    'function dedupeRows(){try{var body=document.getElementById("mxBody");if(!body)return;'
    'for(var rows=[].slice.call(body.children),seen={},i=0;i<rows.length;i++){var tr=rows[i];'
    'if("TR"===tr.tagName){var b=tr.querySelector(".c-coin b, .c-coin .nm b"),'
    'k=(tr.getAttribute("data-sym")||b&&b.textContent||"").trim().toUpperCase();'
    'k&&(seen[k]?tr.remove():seen[k]=1)}}}catch(e){}}'
)


def apply(out):
    # ---------------------------------------------------------------- A11Y-1
    out = rep(
        out, 'A11Y-1 reduced-motion NaNs',
        'animation-duration:NaNs!important;animation-iteration-count:1!important;transition-duration:NaNs!important',
        'animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important',
        n=2)

    # ------------------------------------------------------------- guard tag
    out = rep(out, 'RUN-2/RUN-3 head guard', '<head>\n', '<head>\n' + HEAD_GUARD, n=1)

    # ----------------------------------------------------------------- RUN-1
    boot_old_start = 'function boot(){let rt;MOTION.raf='
    i = out.find(boot_old_start)
    if i < 0:
        _fail('RUN-1 boot() - anchor not found')
    if out.count(boot_old_start) != 1:
        _fail('RUN-1 boot() - anchor is not unique')
    depth, k = 1, i + len('function boot(){')
    while depth and k < len(out):
        if out[k] == '{':
            depth += 1
        elif out[k] == '}':
            depth -= 1
        k += 1
    boot_old = out[i:k]
    if 'startTour()' not in boot_old or len(boot_old) > 1400:
        _fail('RUN-1 boot() - body does not look like the known boot (len=%d)' % len(boot_old))
    out = rep(out, 'RUN-1 boot()', boot_old, BOOT_NEW, n=1)

    # ---------------------------------------------------------------- PERF-1
    tick_old_start = 'function tick(){const now=Date.now(),missed='
    i = out.find(tick_old_start)
    if i < 0 or out.count(tick_old_start) != 1:
        _fail('PERF-1 tick() - anchor missing or not unique')
    depth, k = 1, i + len('function tick(){')
    while depth and k < len(out):
        if out[k] == '{':
            depth += 1
        elif out[k] == '}':
            depth -= 1
        k += 1
    tick_old = out[i:k]
    if 'tickEngine()' not in tick_old or len(tick_old) > 1400:
        _fail('PERF-1 tick() - body does not look like the known tick (len=%d)' % len(tick_old))
    out = rep(out, 'PERF-1 tick()', tick_old, TICK_NEW, n=1)

    # ----------------------------------------------------------------- RUN-4
    out = rep(
        out, 'RUN-4 save refuses to clobber a foreign tab',
        'function _saveNow(){try{localStorage.setItem(LSK,',
        'function _saveNow(){if(window.__DL_FOREIGN)return;try{localStorage.setItem(LSK,', n=1)
    out = rep(
        out, 'RUN-4 silent total save failure',
        '}catch(_t){}}}catch(_e2){}}}',
        '}catch(_t){}}}catch(_e2){if(!window._saveFailWarned){window._saveFailWarned=1;'
        'try{toast("bad","Not saved","This browser refused to store your latest change, so it will be lost on reload. '
        'Export your ledger from Portfolio to keep it.")}catch(_t){}}}}}', n=1)

    # ----------------------------------------------------------------- NUM-1
    out = rep(
        out, 'NUM-1 cNum infinity',
        'function cNum(n){if(!n)return"0";const a=Math.abs(n);return a>=1e9?',
        'function cNum(n){if(!n)return"0";const a=Math.abs(n);if(!isFinite(a))return"—";return a>=1e9?', n=1)
    out = rep(
        out, 'NUM-1 pct infinity',
        'function pct(p){return(p>=0?"+":"")+(null==p||isNaN(p)?0:p).toFixed(2)+"%"}',
        'function pct(p){const v=null==p||!isFinite(p)?0:p;return(v>=0?"+":"")+v.toFixed(2)+"%"}', n=1)

    # ----------------------------------------------------------------- UI-1
    out = rep(
        out, 'UI-1 retry countdown floor',
        'Math.max(0,Math.round((H.nextAt-now())/1e3))+"s"',
        'Math.max(1,Math.round((H.nextAt-now())/1e3))+"s"', n=1)

    # ----------------------------------------------------------------- DOM-1
    i = out.find('function dedupeRows(){')
    if i < 0 or out.count('function dedupeRows(){') != 1:
        _fail('DOM-1 dedupeRows - anchor missing or not unique')
    depth, k = 1, i + len('function dedupeRows(){')
    while depth and k < len(out):
        if out[k] == '{':
            depth += 1
        elif out[k] == '}':
            depth -= 1
        k += 1
    out = rep(out, 'DOM-1 dedupeRows', out[i:k], DEDUPE_NEW, n=1)

    # --------------------------------------------------------------- A11Y-2/3
    out = rep(
        out, 'A11Y-2 modal close buttons',
        '<button class="mx" onclick="closeModal()">',
        '<button class="mx" onclick="closeModal()" aria-label="Close">', n=43)
    out = rep(
        out, 'A11Y-3 dialog accessible name',
        'const m=document.querySelector(".modal"),f=m.querySelector("input,select,button:not(.mx)");',
        'const m=document.querySelector(".modal");'
        'try{const _h=m.querySelector("h1,h2,h3,.p2t,.mtitle");'
        '_h&&_h.textContent.trim()&&m.setAttribute("aria-label",_h.textContent.trim().slice(0,120))}catch(_){}'
        'const f=m.querySelector("input,select,button:not(.mx)");', n=1)

    # ----------------------------------------------------------------- SEC-1
    for arrow in ('&rarr;', '→'):
        out = rep(
            out, 'SEC-1 jump renderer (%s)' % arrow,
            '(a.jump?\'<button class="jump" data-go="\'+esc(a.jump[1])+\'">\'+esc(a.jump[0])+" %s</button>":"")' % arrow,
            '(a.jump?\'<button class="jump" data-go="\'+__dlGoPut(a.jump[1])+\'">\'+esc(a.jump[0])+" %s</button>":"")' % arrow,
            n=1)
    out = rep(
        out, 'SEC-1 jump handler (stack)',
        'if(j)try{new Function(j.getAttribute("data-go"))()}catch(err){}',
        'if(j)__dlGoRun(j.getAttribute("data-go"));', n=1)
    out = rep(
        out, 'SEC-1 jump handler (panel)',
        'if(j){try{new Function(j.getAttribute("data-go"))()}catch(err){}close()}',
        'if(j){__dlGoRun(j.getAttribute("data-go")),close()}', n=1)

    # payload-side jump producers: code strings become closures
    for tag, old, new, n in (
        ('desk',      'jump:["Open the "+c.sym+" desk","openCoin(\'"+c.sym+"\')"]',
                      'jump:["Open the "+c.sym+" desk",function(s){return function(){openCoin(s)}}(c.sym)]', 1),
        ('trade',     'jump:["Trade "+c.sym,"openCoin(\'"+c.sym+"\')"]',
                      'jump:["Trade "+c.sym,function(s){return function(){openCoin(s)}}(c.sym)]', 1),
        ('portfolio', 'jump:["Open the portfolio","nav(\'portfolio\')"]',
                      'jump:["Open the portfolio",function(){nav("portfolio")}]', 1),
        ('markets',   'jump:["Open markets","nav(\'markets\')"]',
                      'jump:["Open markets",function(){nav("markets")}]', 5),
        ('desk2',     'jump:["Open the desk","nav(\'markets\')"]',
                      'jump:["Open the desk",function(){nav("markets")}]', 1),
        ('chapter',   'jump:["Open that chapter","nav(\'learn\');setTimeout(function(){try{enterLesson("+ch2.i+")}catch(e){}},250)"]',
                      'jump:["Open that chapter",function(i){return function(){nav("learn");'
                      'setTimeout(function(){try{enterLesson(i)}catch(e){}},250)}}(ch2.i)]', 1),
        ('news',      'jump:["Open the news desk","nav(\'news\')"]',
                      'jump:["Open the news desk",function(){nav("news")}]', 2),
    ):
        out = rep(out, 'SEC-1 producer ' + tag, old, new, n)

    # ---------------------------------------------------------------- COPY-1
    for tag, old, new in (
        ('title',
         '<title>DexLadder — Live crypto markets & paper trading</title>',
         '<title>DexLadder — the gateway to Web3</title>'),
        ('description',
         '<meta name="description" content="Live crypto prices with a full paper-trading desk — bots, alerts, journal, and a hands-on academy. Real market data, zero real money.">',
         '<meta name="description" content="Perpetuals with funding and a visible liquidation price, AMM liquidity and price impact, OCO and TWAP orders, contract-safety scanning, on-chain tracing and no-lookahead backtesting — on live crypto markets, with no account, no wallet and no keys. Everything real except the money.">'),
        ('og:title',
         '<meta property="og:title" content="DexLadder — trade the market, risk nothing">',
         '<meta property="og:title" content="DexLadder — the gateway to Web3">'),
        ('twitter:title',
         '<meta name="twitter:title" content="DexLadder — trade the market, risk nothing">',
         '<meta name="twitter:title" content="DexLadder — the gateway to Web3">'),
        ('og:description',
         '<meta property="og:description" content="Live prices, grid bots, DCA, price alerts and a 12-lesson academy. Paper money that refills.">',
         '<meta property="og:description" content="Perpetuals, AMM liquidity and price impact, an on-chain explorer, contract-safety scanning and strategy bots — on live markets. Everything real except the money.">'),
        ('twitter:description',
         '<meta name="twitter:description" content="Live prices, a full paper-trading desk and a 12-lesson academy. Real market data, zero real money.">',
         '<meta name="twitter:description" content="Perpetuals, AMM liquidity and price impact, an on-chain explorer, contract-safety scanning and strategy bots — on live markets. Everything real except the money.">'),
        ('og:image:alt',
         '<meta property="og:image:alt" content="DexLadder — live crypto markets, paper trading and a free academy">',
         '<meta property="og:image:alt" content="DexLadder — perpetuals, AMM liquidity, an on-chain explorer and strategy bots on live crypto markets">'),
        ('hero eyebrow',
         '<span class="eyebrow">live markets · paper money · zero stakes</span>',
         '<span class="eyebrow">perps · DeFi · on-chain · zero stakes</span>'),
        ('first-run eyebrow',
         '>Sovereign Paper-Trading Simulator</div>',
         '>Sovereign Web3 Terminal</div>'),
    ):
        out = rep(out, 'COPY-1 ' + tag, old, new, n=1)

    # ---------------------------------------------------------------- COPY-2
    out = rep(out, 'COPY-2 coin search placeholder',
              'placeholder="Search 500+ coins…"', 'placeholder="Search up to 500 coins…"', n=1)

    # ------------------------------------------------------------ hard gates
    if 'new Function(' in out:
        ctx = [out[m.start()-160:m.start()+80] for m in re.finditer(r'new Function\(', out)]
        _fail('SEC-1 gate - new Function() still present in the payload:\n' + '\n---\n'.join(ctx))
    if 'NaNs!important' in out:
        _fail('A11Y-1 gate - an invalid NaNs time value survived')
    if out.count('__dlGoPut') != 3 or out.count('__dlGoRun') != 3:
        _fail('SEC-1 gate - jump registry wiring is not 1 definition + 2 uses each')
    return out
