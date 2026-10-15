"""Keep the first-use presentation visible, bounded and user-initiated."""
import re

def apply(html):
    html, count = re.subn(r'<style>html\{background:#04070c\}html::before[\s\S]*?</style>',
        '<style>html{background:#04070c}</style>', html)
    assert count == 1, 'mobile_startup: expected one retired CSS launch veil'
    tour = 'S.tourDone||setTimeout(()=>{S.tourDone||document.hidden||window.DLXW||startTour()},1600)'
    if tour in html:
        assert html.count(tour) == 1
        html = html.replace(tour, '/* Guided tour starts from the existing user controls. */')
    gate = 'setTimeout(function () { showGate(false); sync(); }, 650);'
    if gate in html:
        assert html.count(gate) == 1
        html = html.replace(gate, "try{localStorage.setItem('coinbridge.welcomed','1')}catch(e){}setTimeout(function () { sync(); }, 650);")
    # A real link remains usable while scripts load; the enhanced guide is opt-in.
    anchor = '<div class="wsbar" id="wsbar">'
    assert html.count(anchor) == 1
    html = html.replace(anchor, '<a class="btn primary" href="#/learn" data-dl-guide-start onclick="if(window.DLGUIDE){DLGUIDE.show();return false}">Start a guided lesson</a>\n' + anchor)
    assert html.count('face=c.logo?') == 1
    html = html.replace('face=c.logo?', 'face="BTC"===c.sym?"<b>₿</b>":c.logo?', 1)
    # Select the requested server-rendered pane before CSS can paint the default
    # Markets pane. Core routing then removes the temporary selector naturally.
    entry = """<script id="dl-entry-route">(function(){var h=location.hash.replace(/^#\/?/,''),v=h==='terminal'||h.indexOf('coin/')===0?'coin':h.split('/')[0];if(['coin','markets','portfolio','news','discover','explorer','learn','p2p','community'].indexOf(v)>=0)document.documentElement.dataset.dlEntry=v;})();</script>"""
    route = '_P("route",function(){route()})'
    assert html.count(route)==1
    html=html.replace(route,'_P("route",function(){route();delete document.documentElement.dataset.dlEntry;if(!window.DLHOSTED)document.querySelectorAll(".page[inert]").forEach(function(p){p.inert=false;p.removeAttribute("aria-busy")})})')
    html=re.sub(r'(<(?:main|section|div)\b[^>]*\bclass="(?:[^" ]+ )*page(?: [^"]*)?"[^>]*)(>)',r'\1 inert aria-busy="true"\2',html)
    html=html.replace('</head>',entry+'\n</head>',1)
    catalogue=html.index('// owns: shared English UI string catalogue')
    before=html.rfind('<script',0,catalogue)
    activate="""<script id="dl-entry-activate">(function(){var v=document.documentElement.dataset.dlEntry;if(v)document.querySelectorAll('.page').forEach(function(p){p.classList.toggle('active',p.id==='page-'+v);});})();</script>"""
    html=html[:before]+activate+'\n'+html[before:]
    # The command pill owns the connecting state. Keep actual cached/simulated
    # feed warnings; only the redundant boot banner stops moving the document.
    boot_banner='var s=ST.state;if("live"===s)return el.className="cbnet",void(el.innerHTML="")'
    assert html.count(boot_banner)==1
    html=html.replace(boot_banner,boot_banner.replace('if("live"===s)','if("live"===s||"boot"===s)'))
    # Keep the floating brand mark bounded and avoid a costly blur filter at boot.
    # Reserve the command toolbar while its legacy initializer runs.
    assert html.count('</head>\n<body>') == 1
    html = html.replace('</head>\n<body>', '</head>\n<body class="cbbar">')
    assert html.count('</header>') == 1
    html = html.replace('</header>', '</header><div id="dlCommandPending" aria-hidden="true"></div>')
    boot = 'function boot(){if(mount()){if(updFeed()'
    assert html.count(boot) == 1
    html = html.replace(boot, 'function boot(){if(mount()){var slot=document.getElementById("dlCommandPending");if(slot)slot.remove();if(updFeed()')
    css = '<style id="dl-mobile-startup">#page-markets .hero-copy>*{animation:none!important;opacity:1!important;transform:none!important}#dlCommandPending{height:34px}@media(max-width:640px){#dlCommandPending{height:32px}}body #sv82-chip{filter:none!important;box-shadow:0 6px 16px rgba(0,229,255,.22)}#sv82-chip .sv82-b{width:22px;height:22px}#sv82-chip .sv82-b img{display:block;width:100%;height:100%;object-fit:contain}@media(max-width:760px){#sv82-chip .sv82-b{width:18px;height:18px}}@media(max-width:760px){.c3orbit,.c3coin{animation:none!important}.page.active,.page.active .reveal,.page.active .controls,.page.active .coin-grid{animation:none!important;transition:none!important;opacity:1!important;transform:none!important}.page.active .reveal{will-change:auto}}html[data-dl-entry] .page{display:none!important}html[data-dl-entry="coin"] #page-coin{display:block!important}html[data-dl-entry="markets"] #page-markets{display:block!important}html[data-dl-entry="portfolio"] #page-portfolio{display:block!important}html[data-dl-entry="news"] #page-news{display:block!important}html[data-dl-entry="discover"] #page-discover{display:block!important}html[data-dl-entry="explorer"] #page-explorer{display:block!important}html[data-dl-entry="learn"] #page-learn{display:block!important}html[data-dl-entry="p2p"] #page-p2p{display:block!important}html[data-dl-entry="community"] #page-community{display:block!important}</style>'
    html = html.replace('</head>', css + '\n</head>', 1)
    return html
