"""Remove the CSS fallback for the retired Nova launch screen."""
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
    return html
