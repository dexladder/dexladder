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
    # Keep the floating brand mark bounded and avoid a costly blur filter at boot.
    # Reserve the command toolbar while its legacy initializer runs.
    assert html.count('</head>\n<body>') == 1
    html = html.replace('</head>\n<body>', '</head>\n<body class="cbbar">')
    assert html.count('</header>') == 1
    html = html.replace('</header>', '</header><div id="dlCommandPending" aria-hidden="true"></div>')
    boot = 'function boot(){if(mount()){if(updFeed()'
    assert html.count(boot) == 1
    html = html.replace(boot, 'function boot(){if(mount()){var slot=document.getElementById("dlCommandPending");if(slot)slot.remove();if(updFeed()')
    css = '<style id="dl-mobile-startup">#page-markets .hero-copy>*{animation:none!important;opacity:1!important;transform:none!important}#dlCommandPending{height:34px}@media(max-width:640px){#dlCommandPending{height:32px}}body #sv82-chip{filter:none!important;box-shadow:0 6px 16px rgba(0,229,255,.22)}#sv82-chip .sv82-b{width:22px;height:22px}#sv82-chip .sv82-b img{display:block;width:100%;height:100%;object-fit:contain}@media(max-width:760px){#sv82-chip .sv82-b{width:18px;height:18px}}</style>'
    html = html.replace('</head>', css + '\n</head>', 1)
    return html
