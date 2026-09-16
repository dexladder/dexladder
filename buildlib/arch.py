# -*- coding: utf-8 -*-
"""Phase-1 architecture patches (2026-09-10).

The legacy payload keeps its own copies of formulas that now live, typed and tested, in
web/app/src (bundled into layers/01-app.js and injected into <head> before any legacy script).
Each patch below replaces a legacy BODY with a one-line delegation, so there is exactly one
implementation of each formula in the shipped file. Every find string is count-asserted, like
every other patch in this build, and each group asserts its own post-condition.
"""
import re


def _apply(out, patches, group):
    for pid, find, rep, n in patches:
        c = out.count(find)
        assert c == n, f'{group}/{pid}: expected {n} occurrence(s), found {c}'
        out = out.replace(find, rep)
    return out


# ---------------------------------------------------------------- A1 · chart indicators
CHART = [
    ('emaArr',
     'function emaArr(vals,p){const k=2/((p=Math.max(1,Math.min(p,vals.length)))+1);let e=vals[0];const o=[e];for(let i=1;i<vals.length;i++)e=vals[i]*k+e*(1-k),o.push(e);return o}',
     'function emaArr(vals,p){return DLAPP.legacy.chart.emaArr(vals,p)}', 1),
    ('smaArr',
     'function smaArr(vals,p){p=Math.max(1,Math.min(p,vals.length));const o=[];let s=0;for(let i=0;i<vals.length;i++)s+=vals[i],i>=p&&(s-=vals[i-p]),o.push(i>=p-1?s/p:vals[i]);return o}',
     'function smaArr(vals,p){return DLAPP.legacy.chart.smaArr(vals,p)}', 1),
    ('rsiArr',
     'function rsiArr(vals,p){p=Math.max(1,Math.min(p,Math.max(1,vals.length-1)));const o=new Array(vals.length).fill(50);if(vals.length<2)return o;let g=0,l=0;for(let i=1;i<=p&&i<vals.length;i++){const d=vals[i]-vals[i-1];d>=0?g+=d:l-=d}g/=p,l/=p,p<vals.length&&(o[p]=100-100/(1+(0===l?100:g/l)));for(let i=p+1;i<vals.length;i++){const d=vals[i]-vals[i-1],up=void 0,dn=void 0;g=(g*(p-1)+(d>0?d:0))/p,l=(l*(p-1)+(d<0?-d:0))/p,o[i]=100-100/(1+(0===l?100:g/l))}for(let i=0;i<p&&i<o.length;i++)o[i]=o[Math.min(p,o.length-1)];return o}',
     'function rsiArr(vals,p){return DLAPP.legacy.chart.rsiArr(vals,p)}', 1),
    ('macdArr',
     'function macdArr(vals){const f=emaArr(vals,12),s=emaArr(vals,26),line=vals.map((_,i)=>f[i]-s[i]),sig=emaArr(line,9);return{line:line,sig:sig,hist:line.map((v,i)=>v-sig[i])}}',
     'function macdArr(vals){return DLAPP.legacy.chart.macdArr(vals)}', 1),
]


def apply(out):
    out = _apply(out, CHART, 'arch-A1')
    for name in ('emaArr', 'smaArr', 'rsiArr', 'macdArr'):
        assert out.count('function %s(' % name) == 1, f'{name} must be defined exactly once'
    print('arch A1: chart indicators delegate to DLAPP (ema/sma/rsi/macd — one implementation each)')
    return apply_engine(out)


# ---------------------------------------------------------------- A2 · the paper engine
# Whole legacy functions are cut by brace matching and their sha256 is pinned, so this build
# refuses to run if the legacy text ever differs from what the parity tests were proven against.
import hashlib, os

PATCH_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'patches')


def cut(s, start, suffix=''):
    """Return s[i:k] for the unique `start`, through its balanced closing brace (+ `suffix`)."""
    # v162 · a backtick used to be treated as an opaque quote like " or ', so a
    # NESTED template literal — `a ${`b`} c` — closed the outer string early and
    # every following brace was counted structurally. cut() then returned a
    # silently truncated body instead of raising. The scanner now carries a
    # context stack: quotes, template literals, and the ${ } interpolations
    # inside them, which are code and may contain braces and further templates.
    # Every cut in this build is sha-pinned, so if this ever returns a different
    # slice than before, the pin fails loudly rather than shipping the change.
    assert s.count(start) == 1, f'anchor must be unique: {start!r} x{s.count(start)}'
    i = s.index(start); k = s.index('{', i) + 1
    stack = ['{']
    while k < len(s) and stack:
        ch = s[k]; top = stack[-1]
        if top in ('"', "'", '`'):
            if ch == '\\':
                k += 2; continue
            if ch == top:
                stack.pop()
            elif top == '`' and ch == '$' and s[k + 1:k + 2] == '{':
                stack.append('${'); k += 2; continue
        else:                       # code context: the body, or a ${ } hole
            if ch in '"\'`':
                stack.append(ch)
            elif ch == '{':
                stack.append('{')
            elif ch == '}':
                stack.pop()
        k += 1
    if stack:
        raise AssertionError('unbalanced: ' + start)
    end = k
    if suffix:
        assert s[end:end + len(suffix)] == suffix, f'expected {suffix!r} after {start!r}'
        end += len(suffix)
    return s[i:end]


def body(name):
    return open(os.path.join(PATCH_DIR, name), encoding='utf-8').read()


# (id, start anchor, suffix, unused, replacement file)
ENGINE = [
    ('cbx', 'window.CBX=function(){"use strict";var LEVELS=40', '()',
     None, 'cbx.js'),
    ('execFill-base', 'function execFill(side,sym,quote,amt,px,label,silent){if(ensureEng()', '',
     None, 'execFill.base.js'),
    ('execFill-cbx', 'window.__cbxFee=null,window.execFill=function(', '',
     None, 'execFill.cbx.js'),
    ('basisBuy', 'function basisBuy(sym,amt,pxUSD){', '', None, 'basisBuy.js'),
    ('basisSell', 'function basisSell(sym,amt,pxUSD){', '', None, 'basisSell.js'),
    ('evalOrders-base', 'function evalOrders(){if(ensureEng(),!S.orders.length)return;const done=[]', '',
     None, 'evalOrders.base.js'),
    ('evalOrders-cbx', 'window.evalOrders=function(){try{ensureEng()}catch(e){}if(S.orders&&S.orders.length){var dt=', '',
     None, 'evalOrders.cbx.js'),
    ('placeOrder-cbx', 'window.placeOrder=function(){var t=S.ordType;if("dca"===t||"grid"===t)return _place.apply(this,arguments)', '',
     None, 'placeOrder.cbx.js'),
    # Phase 2.1 — the ticket preview asks the engine the same question the fill will (tolerance included)
    ('cbxPreview', 'window.CBXpreview=function(){var host=$("cbxPrev")', '', None, 'cbxPreview.js'),
    # Phase 2.2 — venue fee + gas are charged inside the one fill transition (applyFill); the DLSIM
    # after-the-fact delta that wrote the balance a second time is retired
    ('feeDelta', 'function feeDelta(side,quote,val,label,base){', '', None, 'feeDelta.js'),
]
# sha256 of each original, cut from the sha-pinned v153 input. The parity tests prove the
# replacements against exactly these texts.
ENGINE_PINS = {
    'cbx': 'c74124791015872fb4e7a3b175e971159b972dea2163c1d893e760db0fd71917',
    'execFill-base': 'a29b330ed5aad73c5f1ec638c724797bc834460fa094d3f8775d87fb1fad088d',
    'execFill-cbx': '7c076b23cfc46eca01ed8db64d2ad63667d3e85134396f954ea113be155ed590',
    'basisBuy': 'a962cdd4fc5dbdfc3bcb5dcc4a47a249966ba1d22c41264c9c6b4af22232705c',
    'basisSell': '580cfcc4bf8916dd59826e2934c70a3e3ecb4f71d2fa1190e388f7db96c7fa6b',
    'evalOrders-base': 'f47ba77588156f1153c0cc411c7648aa870eb9d4cd9fa6ee2c349f09714abc36',
    'evalOrders-cbx': '6233a47ad0fd6a12c70b52c10d68266a83a02e79ea2761855ae27c6fc239c8fa',
    'placeOrder-cbx': '8d44e8c6f4ab1ca0c78cf766a6281e4f93f0a52866f7ee558202efde6fc61d55',
    'cbxPreview': '8025bf35cecac23c93deb51f3fbffb68e02ded3daa3b053399fd59a4776457bd',
    'feeDelta': 'b2b122902493df623655bfac45944688684c6cbaf006c3aad5315d227ecea2c2',
}


def apply_engine(out):
    for pid, start, suffix, _, fname in ENGINE:
        orig = cut(out, start, suffix)
        sha = hashlib.sha256(orig.encode('utf-8')).hexdigest()
        pin = ENGINE_PINS.get(pid)
        assert pin == sha, f'arch-A2/{pid}: legacy text changed (sha {sha[:16]}…, pinned {str(pin)[:16]}…) — re-prove parity before re-pinning'
        out = out.replace(orig, body(fname), 1)
    # the venue fee table and the thin-liquidity penalty (DLSIM, v151) read the one typed table
    out = _apply(out, [
        ('venues', 'var VEN={binance:{n:"Binance",t:.001,m:.001,pt:5e-4,gas:0,d:"Spot 0.10% taker · 0.10% maker · perps 0.05% taker"},coinbase:{n:"Coinbase Adv.",t:.006,m:.004,pt:6e-4,gas:0,d:"Spot 0.60% taker · 0.40% maker (retail tier) · perps 0.06%"},kraken:{n:"Kraken",t:.0026,m:.0016,pt:5e-4,gas:0,d:"Spot 0.26% taker · 0.16% maker · perps 0.05%"},hyperliquid:{n:"Hyperliquid",t:45e-5,m:15e-5,pt:45e-5,gas:0,d:"Perp DEX 0.045% taker · 0.015% maker — funding every hour"},dexamm:{n:"DEX (AMM)",t:.003,m:.003,pt:.003,gas:2.2,d:"AMM swap 0.30% + ~$2.20 simulated network gas per fill"}};',
         'var VEN=DLAPP.paper.VENUES;', 1),
        ('thin-liquidity', 'function extraBp(sym){try{var c="undefined"!=typeof bySym&&bySym[sym];if(!c||!c.mcap||!c.vol)return 2;var liq=c.vol/c.mcap,bp;return liq<.01?16:liq<.03?8:liq<.08?3.5:1.4}catch(e){return 2}}',
         # Phase 2.1: the flat Pro-mode penalty is folded into the pool depth (lib/paper-engine/impact.ts
         # tierFactor) — added here too it would count twice, and only in the preview
         'function extraBp(){return 0}', 1),
        # Phase 2.2: the Pro fee line on the ticket shows the live gas estimate, not a flat $2.20
        ('fee-line-gas', 'gas=v.gas?v.gas/qU:0', 'gas=DLAPP.legacy.paper.gasEstimate(S.quote)', 1),
        # Phase 2.4: the transaction ledger labels gas rows and partial / gas / sandwich notes
        ('txn-label', 'lab="Deposit"===t.type||"Withdraw"===t.type?`${t.type} · ${fmt(t.val,2)} USDT`:`${t.type} ${fmt(t.amt)} ${t.sym} @ ${fmt(t.val/t.amt)} ${t.quote}`;',
         'lab=DLAPP.legacy.paper.txnLabel(t,fmt)||("Deposit"===t.type||"Withdraw"===t.type?`${t.type} · ${fmt(t.val,2)} USDT`:`${t.type} ${fmt(t.amt)} ${t.sym} @ ${fmt(t.val/t.amt)} ${t.quote}`);', 1),
        ('journal-partial', 'held ${fmtHold(j.hold)}</span>', 'held ${fmtHold(j.hold)}${j.of?` · partial fill of ${fmt(j.of)}`:""}</span>', 1),
        # Phase 2.5: the execution modes are named Beginner / Advanced and describe what is now simulated
        # (storage keeps its legacy value: S.dlsim.mode === 'pro' is Advanced — never renamed)
        ('mode-chip', '"Pro · "+v.n', '"Advanced · "+v.n', 1),
        ('mode-chip-b', '"Beginner · forgiving fills"', '"Beginner · order-book fills"', 1),
        ('mode-chip-t', '"Forgiving fills: flat 0.10% fee, instant full fills"', '"Order-book fills: flat 0.10% fee, gentle slippage, no gas, no bots"', 1),
        ('mode-card-adv', '<h4>🎯 Pro</h4><p>Real venue fees (maker/taker), liquidity-scaled spread & slippage, routing latency, partial fills. Train like it costs money.</p>',
         '<h4>🎯 Advanced</h4><p>Every order priced on a liquidity pool: price impact against your slippage tolerance, real venue fees, partial fills. On the DEX, gas and a priority fee — swaps can wait, be dropped or revert — and optional MEV bots. Train like it costs money.</p>', 1),
        ('mode-card-beg', '<h4>🌱 Beginner</h4><p>Forgiving fills: flat 0.10% fee, instant full execution, gentle slippage. Learn the flow first',
         '<h4>🌱 Beginner</h4><p>Forgiving fills: flat 0.10% fee on a deep order book, gentle slippage, no gas, no bots. Learn the flow first', 1),
        ('mode-venue-note', '" — applies in Pro"', '" — applies in Advanced"', 1),
        ('mode-behaviours', 'Pro behaviors', 'Advanced behaviors', 1),
        ('mode-toast', '"Execution: "+("pro"===d.mode?"Pro":"Beginner")', '"Execution: "+("pro"===d.mode?"Advanced":"Beginner")', 1),
        ('mode-toast-b', 'ven().n+" fees, spread, latency & partial fills are live"', 'ven().n+" fees, price impact, slippage tolerance & partial fills are live"+("dexamm"===d.venue?" — plus gas and priority fees":"")', 1),
        ('mode-xp', '"Switched to Pro execution — realistic fills"', '"Switched to Advanced execution — realistic fills"', 1),
        ('mode-quest', '"⚙ Feel real venue fees (Pro mode)"', '"⚙ Feel real venue fees (Advanced mode)"', 1),
        ('mode-note', 'Fills walk a deterministic synthetic order book seeded per coin — same engine in both modes; Pro widens it with venue spread and thin-liquidity penalties, then charges that venue’s published fee tiers.',
         'Beginner fills walk a deterministic synthetic order book seeded per coin. Advanced prices every order on a liquidity pool (x·y=k) as deep as the venue — on the DEX a real-sized, far thinner pool — and charges that venue’s published fee tiers; DEX swaps also pay gas.', 1),
        ('mode-mev-row', '["funding","Perp funding accrual","Perp positions pay / earn funding every ~8h by market momentum"]]',
         '["funding","Perp funding accrual","Perp positions pay / earn funding every ~8h by market momentum"],["mev","Simulated MEV bots","DEX swaps only — bots sandwich swaps whose slippage tolerance leaves them room. Off by default"]]', 1),
    ], 'arch-A2')
    assert 'DLAPP.legacy.paper.cbx()' in out and out.count('DLAPP.legacy.paper.execFill(') == 2
    out = apply_nav(out)
    print('arch A2: paper engine — CBX book/match, both execFill bodies, basis, both order loops, the ticket → DLAPP.paper (pure) + usePaperEngine')
    return out


# ---------------------------------------------------------------- A3 · one token table
# Runs LATE (after the layers' CSS is appended), so it sees every stylesheet the payload ships.
GEN_CSS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'generated', 'dlapp.css')
ROOT_RULE = re.compile(r'(:root|html\[data-mode=day\])\s*\{([^{}]*)\}')
STYLE = re.compile(r'(<style[^>]*>)(.*?)(</style>)', re.S)
DECL = re.compile(r'\s*(--[\w-]+)\s*:\s*([^;]+?)\s*$')
# 11 rules across the payload carried 97 (:root) + 42 (Day) token declarations for 68 + 38 tokens.
EXPECT_REMOVED = 139


def _effective(text):
    """Last-declaration-wins map per selector, exactly as the cascade resolves it (no !important,
    no @media-conditional root rules — both asserted)."""
    night, day = {}, {}
    for m in ROOT_RULE.finditer(text):
        tgt = night if m.group(1) == ':root' else day
        for part in m.group(2).split(';'):
            d = DECL.match(part)
            if d:
                assert '!important' not in d.group(2), 'an !important token would defeat the single table'
                tgt[d.group(1)] = d.group(2)
    return night, day


ROOTISH = re.compile(r':root|html\s*\[\s*data-mode')


def _rules(css):
    """(selector, declarations, depth) for every rule, with comments removed and at-rule nesting
    tracked — so a token rule inside @media/@supports, or in a grouped selector, is SEEN."""
    css = re.sub(r'/\*[\s\S]*?\*/', '', css)
    out, depth, sel_start, stack = [], 0, 0, []
    i = 0
    while i < len(css):
        ch = css[i]
        if ch in '"\'':
            j = css.index(ch, i + 1); i = j + 1; continue
        if ch == '{':
            sel = css[sel_start:i].strip()
            stack.append((sel, i + 1)); depth += 1; sel_start = i + 1
        elif ch == '}':
            sel, start = stack.pop(); depth -= 1
            body = css[start:i]
            if not sel.startswith('@') and '{' not in body:
                out.append((sel, body, depth))
            sel_start = i + 1
        elif ch == ';' and depth == 0:
            sel_start = i + 1
        i += 1
    return out


def _fail_closed(styles):
    """The strip below handles exactly one shape: a top-level, ungrouped `:root{}` or
    `html[data-mode=day]{}` whose token values carry no url()/';'. Anything else refuses the build."""
    for sel, body, depth in _rules(styles):
        if not ROOTISH.search(sel) or not re.search(r'--[\w-]+\s*:', body):
            continue
        assert depth == 0, f'arch-A3: a root/Day token rule sits inside an at-rule ({sel!r}) — the single table cannot express it'
        assert sel in (':root', 'html[data-mode=day]'), f'arch-A3: unsupported root/Day selector form {sel!r} (grouped, quoted or qualified)'
        assert 'url(' not in body, f'arch-A3: a token value contains url() ({sel!r}) — the declaration splitter would cut it'


def apply_late(out):
    css = open(GEN_CSS, encoding='utf-8').read()
    body = css.split('*/', 1)[1].strip()
    for planted in ('body,:root{--a:1}', '@media(x){.a{b:c}:root{--a:1}}', ':root{--a:url(data:x;y)}', 'html[data-mode="day"]{--a:1}'):
        try:
            _fail_closed(planted)
        except AssertionError:
            continue
        raise AssertionError('arch-A3 canary: the fail-closed scanner no longer sees %r' % planted)
    _fail_closed(''.join(m.group(2) for m in STYLE.finditer(out)))
    # 1 — prove the table IS what the payload resolved to before we touch anything
    styles = ''.join(m.group(2) for m in STYLE.finditer(out))
    assert not re.search(r'@media[^{]*\{\s*(:root|html\[data-mode=day\])\s*\{', styles), 'conditional root token rule found'
    before = _effective(styles)
    table = _effective(body)
    assert table == before, 'web/app/src/design/tokens.ts no longer matches what the payload resolved: %r' % (
        sorted(set(before[0].items()) ^ set(table[0].items()))[:6] + sorted(set(before[1].items()) ^ set(table[1].items()))[:6])
    # 2 — delete every root/day token declaration, keep any non-token declaration, drop emptied rules
    removed = [0]

    def strip_rule(m):
        keep = []
        for part in m.group(2).split(';'):
            if DECL.match(part):
                removed[0] += 1
            elif part.strip():
                keep.append(part.strip())
        return (m.group(1) + '{' + ';'.join(keep) + '}') if keep else ''

    out = STYLE.sub(lambda m: m.group(1) + ROOT_RULE.sub(strip_rule, m.group(2)) + m.group(3), out)
    assert removed[0] == EXPECT_REMOVED, f'arch-A3: removed {removed[0]} token declarations, expected {EXPECT_REMOVED}'
    left = ''.join(m.group(2) for m in STYLE.finditer(out))
    assert not re.search(r'(:root|html\[data-mode=day\])\s*\{[^{}]*--[\w-]+\s*:', left), 'a root token declaration survived'
    # 3 — the one table, first in <head>, so any later state rule (body.sat …) still wins as before
    i = out.find('<style')
    assert 0 < i < out.find('</head>'), 'no stylesheet in <head>'
    out = out[:i] + '<style id="dlapp">' + body + '</style>\n' + out[i:]
    assert out.count('<style id="dlapp">') == 1
    print(f'arch A3: one token table — {removed[0]} scattered declarations removed, '
          f'{len(table[0])} Night + {len(table[1])} Day tokens emitted once from web/app/src/design/tokens.ts')
    return out


# ---------------------------------------------------------------- A4 · six destinations
NAV_HTML = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'generated', 'nav.html')
OLD_NAVLINKS = """<nav class="navlinks" id="navlinks">
    <a data-nav="markets" class="active" href="#/markets" onclick="nav('markets')">Markets</a>
    <a data-nav="news" href="#/news" onclick="nav('news')">News</a>
    <a data-nav="discover" href="#/discover" onclick="nav('discover')">Discover</a>
    <a data-nav="explorer" href="#/explorer" onclick="nav('explorer')">Explorer</a>
    <a data-nav="learn" href="#/learn" onclick="nav('learn')">Learn</a>
    <a data-nav="portfolio" href="#/portfolio" onclick="nav('portfolio')">Portfolio</a>
    <a data-nav="p2p" href="#/p2p" onclick="nav('p2p')">P2P</a>
    <a data-nav="community" href="#/community" onclick="nav('community')">Community</a>
  </nav>"""
DAILY_CHIP = '<button class="hchip" id="dailyChip" onclick="openDaily()" title="Daily macro scenario \u2014 60-second hedge challenge">\U0001F3B2</button>'


def apply_nav(out):
    nav = open(NAV_HTML, encoding='utf-8').read().strip()
    out = _apply(out, [
        ('header-links', OLD_NAVLINKS, '<nav class="navlinks" id="navlinks" aria-label="Primary">\n    ' + nav + '\n  </nav>', 1),
        # the daily challenge moves into Academy & Hub (a section of its own there)
        ('daily-chip', DAILY_CHIP, '', 1),
        # the bottom bar highlights the destination a route LIVES in (News → Markets, Discover → Academy …)
        ('bottom-sync', 'var m=btn.getAttribute("data-nav")===cur;', 'var m=btn.getAttribute("data-nav")===DLAPP.nav.homeRoute(cur);', 1),
        # #/terminal is the Terminal destination's link
        ('route-terminal', 'function route(){const h=location.hash.replace(/^#\\/?/,"");', 'function route(){const h=location.hash.replace(/^#\\/?/,"");if("terminal"===h)return void nav("coin");', 1),
        # the a11y furniture re-asserts aria-current 220 ms after every nav by data-nav === S.view;
        # a route that lives inside a destination (news → Markets) must mark its destination current
        ('aria-current', 'var v=typeof S!=="undefined"?S.view:null;', 'var v=typeof S!=="undefined"?(window.DLAPP?DLAPP.nav.homeRoute(S.view):S.view):null;', 1),
        # NOTE: the first-flight quest / Journey card stays on Markets for now. Moving it into Academy
        # exposed a latent layout conflict gate154 catches (the record bar and the hero's market-cap
        # tile end up 394 px apart at >=2000 px, under the 400 px no-restatement rule). Which of the
        # two to change is the owner's call — see the Phase-1 report, HUMAN DECISIONS.
    ], 'arch-A4')
    # the bottom bar's item list comes from the same IA table as the header
    start = out.index('NAVITEMS=[["markets","Markets"')
    d, k, q = 0, start + len('NAVITEMS='), None
    while True:
        ch = out[k]
        if q:
            if ch == '\\': k += 2; continue
            if ch == q: q = None
        elif ch in '"\'': q = ch
        elif ch == '[': d += 1
        elif ch == ']':
            d -= 1
            if d == 0: break
        k += 1
    arr = out[start:k + 1]
    assert arr.count('["') == 8 and out.count(arr) == 1, 'legacy NAVITEMS literal moved'
    out = out.replace(arr, 'NAVITEMS=DLAPP.nav.bottomItems()', 1)
    assert out.count('data-nav="') - out.count('data-nav="\'') >= 6
    print('arch A4: six destinations (Terminal · Markets · Portfolio · Academy · Explorer · P2P) from web/app/src/nav/ia.ts; '
          'News under Markets; Discover, Town Square, Journey hub, daily challenge, monument under Academy & Hub')
    return out
