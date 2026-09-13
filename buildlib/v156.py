# -*- coding: utf-8 -*-
"""v156 owner-report fixes (2026-09-11), applied to the assembled payload.

B · BRAND MARK — every DexLadder mark in the product is the canonical mark, never a redraw.
    Source of truth: the brand-mark doc (extracted verbatim from the shipped v153 payload, 3 Sep
    2026): 512 tile rx112 #050811, the 34px bezier rail, three 48x70 r10 candle rungs with 10px
    wicks #00E5FF/#00F2D0/#00FFA3, two r16 end nodes, fg gradient #00FFA3 -> #00E5FF.
    Nine places drew a simplified guess (rail + one or three wicks, no rungs, no nodes, fatter
    strokes): the welcome eyebrows, the DeXaI chat orb and chat header, the Sovereign chip and
    panel heading, the audit header. Each becomes the canonical mark as an <img> data URI — an
    isolated document, so its gradient id can never collide with another inline SVG. The
    certificate's engraved seal keeps its engraving but now engraves the canonical geometry.
C · CHART READING — the Terminal chart's price gutter is sized from the widest price it prints
    (it was a fixed 58px, so 78,975.00 and every price tag were cut off), and the area chart
    labels use the app's mono face (it asked for Inter, which is not loaded, so it fell back to
    Times) with the last-price dot kept inside the canvas.
H · HISTORY — both charts ask DLAPP.legacy.history to replace fabricated history (a constant
    run padded by a no-history price source) with real candles from public market data.
"""
import base64, re

CANON = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#050811"/>'
         '<g transform="translate(15,0)"><path d="M 260 70 C 500 70, 500 420, 140 420" stroke="url(#fg)" stroke-width="34" stroke-linecap="round" fill="none"/>'
         '<line x1="260" y1="70" x2="260" y2="180" stroke="#00E5FF" stroke-width="10" stroke-linecap="round"/>'
         '<rect x="236" y="90" width="48" height="70" rx="10" fill="url(#fg)"/>'
         '<line x1="200" y1="190" x2="200" y2="300" stroke="#00F2D0" stroke-width="10" stroke-linecap="round"/>'
         '<rect x="176" y="210" width="48" height="70" rx="10" fill="url(#fg)"/>'
         '<line x1="140" y1="310" x2="140" y2="420" stroke="#00FFA3" stroke-width="10" stroke-linecap="round"/>'
         '<rect x="116" y="330" width="48" height="70" rx="10" fill="url(#fg)"/>'
         '<circle cx="260" cy="70" r="16" fill="#050811" stroke="#00E5FF" stroke-width="8"/>'
         '<circle cx="140" cy="420" r="16" fill="#050811" stroke="#00FFA3" stroke-width="8"/></g>'
         '<defs><linearGradient id="fg" x1="0" y1="512" x2="512" y2="0" gradientUnits="userSpaceOnUse">'
         '<stop stop-color="#00FFA3"/><stop offset="1" stop-color="#00E5FF"/></linearGradient></defs></svg>')
CANON_URI = 'data:image/svg+xml;base64,' + base64.b64encode(CANON.encode('utf-8')).decode('ascii')
RAIL = '260 70 C 500 70'
SVG512 = re.compile(r'<svg\b[^>]*viewBox="0 0 512 512"[^>]*>(?:(?!</svg>).)*?</svg>', re.S)
ATTR = lambda name, tag: (re.search(r'\b%s="([^"]*)"' % name, tag) or [None, None])[1]


def _brand(out):
    swapped = []

    def swap(m):
        svg = m.group(0)
        if RAIL not in svg or 'x="236"' in svg:
            return svg                                   # not a mark, or already the canonical one
        head = svg[:svg.index('>') + 1]
        w, h, style, cls = ATTR('width', head), ATTR('height', head), ATTR('style', head), ATTR('class', head)
        attrs = ' src="%s" alt="" aria-hidden="true"' % CANON_URI
        if w: attrs += ' width="%s"' % w
        if h: attrs += ' height="%s"' % h
        attrs += ' class="%s"' % (((cls + ' ') if cls else '') + 'dl-mark')
        if style: attrs += ' style="%s"' % style          # keep the original's own placement, add none
        swapped.append(w or '?')
        return '<img' + attrs + '>'
    out = SVG512.sub(swap, out)
    assert len(swapped) == 7, 'brand: expected 7 simplified inline marks, replaced %d' % len(swapped)

    # the certificate seal: an engraving, so keep the tone and the placement, engrave the canonical geometry
    old_g = ('<path d="M 260 70 C 500 70, 500 420, 140 420"/><path d="M260 70V180"/><path d="M200 190V300"/>'
             '<path d="M140 310V420"/></g>')
    n = out.count(old_g)
    assert n == 2, 'brand: seal engraving groups, expected 2, found %d' % n

    def engrave(fill):
        return ('<g transform="translate(15,0)"><path d="M 260 70 C 500 70, 500 420, 140 420" stroke-width="34"/>'
                '<path d="M260 70V180" stroke-width="10"/><rect x="236" y="90" width="48" height="70" rx="10" fill="%s" stroke="none"/>'
                '<path d="M200 190V300" stroke-width="10"/><rect x="176" y="210" width="48" height="70" rx="10" fill="%s" stroke="none"/>'
                '<path d="M140 310V420" stroke-width="10"/><rect x="116" y="330" width="48" height="70" rx="10" fill="%s" stroke="none"/>'
                '<circle cx="260" cy="70" r="16" fill="#B8933A" stroke-width="8"/><circle cx="140" cy="420" r="16" fill="#B8933A" stroke-width="8"/>'
                '</g></g>') % (fill, fill, fill)
    for tone in ('#2E240D', '#F7E9B8'):
        k = out.find('stroke="%s"' % tone, out.find('dlc-sealbtc'))
        j = out.find(old_g, k)
        assert 0 < k < j, 'brand: seal group for %s not found' % tone
        out = out[:j] + engrave(tone) + out[j + len(old_g):]

    # post-condition: every inline 512 mark and every engraved group now carries the rungs
    for m in SVG512.finditer(out):
        assert RAIL not in m.group(0) or 'x="236"' in m.group(0), 'brand: a simplified mark survived: %r' % m.group(0)[:120]
    assert out.count(CANON_URI) == 7
    return out, len(swapped)


CHART = [
    # the price gutter fits the widest price it prints (a fixed 58px cut 78,975.00 off)
    ('gutter', 'const innerW=w-58,n=view.length',
     'const innerW=w-(x.font=MONO,Math.max(58,Math.ceil(x.measureText(fmt(mx)).width)+14)),n=view.length', 1),
    ('tag-order', 'x.fillRect(innerW+1,py-7,57,14)', 'x.fillRect(innerW+1,py-7,w-innerW-1,14)', 1),
    ('tag-grid', 'x.fillRect(innerW+1,ym-7,57,14)', 'x.fillRect(innerW+1,ym-7,w-innerW-1,14)', 1),
    ('tag-last', 'x.fillRect(innerW+1,ly-8,57,16)', 'x.fillRect(innerW+1,ly-8,w-innerW-1,16)', 1),
    # the area chart: last point kept inside the canvas, labels in the app's mono face
    ('area-x', 'X=i=>i/(data.length-1)*w,', 'X=i=>i/(data.length-1)*(w-9),', 1),
    ("area-font", "x.fillStyle=\"#98A1BC\",x.font=\"11px Inter\"", "x.fillStyle=\"#98A1BC\",x.font=\"11px ui-monospace,Menlo,Consolas,monospace\"", 2),
    # history: real candles replace fabricated runs
    ('hist-terminal', 'function drawCoinChart(){if("tv"===S.chartEngine)return;',
     'function drawCoinChart(){DLAPP.legacy.history.ensure(S.coin);if("tv"===S.chartEngine)return;', 1),
    ('hist-spotlight', 'function updateSpotlight(){const c=bySym.BTC||coins.find(x=>"USDT"!==x.sym);if(!c)return;',
     'function updateSpotlight(){const c=bySym.BTC||coins.find(x=>"USDT"!==x.sym);if(!c)return;DLAPP.legacy.history.ensure(c.sym);', 1),
]


INTER = re.compile(r'(\d+px) Inter"')


COPY = [
    # The privacy page has to name every host the app talks to. The news desk's transport
    # ladder changed (layers/11-newsfeed.js): rss2json.com and test.cors.workers.dev carry
    # the headlines now, with allorigins/codetabs kept as recovering rungs behind them.
    ('privacy-bridges',
     'RSS proxies allorigins.win / codetabs.com (news headlines)',
     'RSS bridges rss2json.com, test.cors.workers.dev, allorigins.win and codetabs.com '
     '(news headlines \u2014 the desk tries them in that order and names on screen the one that answered)',
     1),
]


def apply(out):
    out, n = _brand(out)
    for pid, find, rep, k in COPY:
        c = out.count(find)
        assert c == k, 'v156/%s: expected %d occurrence(s), found %d' % (pid, k, c)
        out = out.replace(find, rep)
    for pid, find, rep, k in CHART:
        c = out.count(find)
        assert c == k, 'v156/%s: expected %d occurrence(s), found %d' % (pid, k, c)
        out = out.replace(find, rep)
    # every canvas label asked for "Inter" alone — a face the payload never loads — so the browser
    # drew them in its default serif (Times on a Mac). Give each one the real fallback stack.
    out, k = INTER.subn(r'\1 Inter,system-ui,-apple-system,Segoe UI,sans-serif"', out)
    assert k >= 10 and not INTER.search(out), 'v156: canvas Inter fonts, fixed %d' % k
    print('v156: %d simplified brand marks -> the canonical mark, seal engraves the canonical geometry; '
          'chart gutter sized from its widest price; area labels in mono; charts backfill real history' % n)
    return out
