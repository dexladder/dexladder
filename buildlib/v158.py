# -*- coding: utf-8 -*-
"""v158 · tidy — owner report of 12 Sep 2026 (seven screenshots), payload-side patches.

Every patch here is count-asserted; the layer halves live in layers/23-sevenday.js (the
7-day series), layers/20-core.js + layers/21-snapshot.js (the quiet marks), layers/v154.css
(the chrome) and layers/zzz-columns.js (the board's bottom edge). test/gate154.js pins each
of the seven defects at runtime.

1 · SPOTLIGHT "7-DAY" CHART — drew c.hist.slice(-84): after 126 s of session every one of
    those 84 samples is a 1.5-second live tick, so the "7-day" card was a two-minute
    staircase. It now draws DLH7.series(c): the seeded/backfilled week, ending at the live
    price, and the caption says "· live" instead of "· 7-day" when no observed week exists.
2 · PROOF LEDGER — the five action buttons sat in an inline-flex span with margin-left:auto
    that could not wrap, so "Independent auditor" ran past the card's right edge in a 442px
    column and the group clipped. The span becomes a full-width, wrapping action row
    (.chainacts, styled in layers/v154.css).
"""

PATCHES = [
    ('spot-series',
     'drawArea(document.getElementById("spotChart"),c.hist.slice(-84),c.c7>=0?"#14BED0":"#F0455E",0)',
     'drawArea(document.getElementById("spotChart"),window.DLH7&&DLH7.series(c)||c.hist.slice(-84),c.c7>=0?"#14BED0":"#F0455E",0)', 1),
    ('spot-caption',
     'document.getElementById("sl-sym").textContent=c.sym+" · 7-day"',
     'document.getElementById("sl-sym").textContent=window.DLH7?DLH7.label(c):c.sym+" · 7-day"', 1),
    ('chain-actions',
     '<span style="margin-left:auto;display:inline-flex;gap:8px">\\n        <button class="btn sm" onclick="verifyChainUI()">',
     '<span class="chainacts">\\n        <button class="btn sm" onclick="verifyChainUI()">', 1),
]


def apply(out):
    for pid, find, rep, k in PATCHES:
        c = out.count(find)
        assert c == k, 'v158/%s: expected %d occurrence(s), found %d' % (pid, k, c)
        out = out.replace(find, rep)
    assert out.count('DLH7.series(c)') == 1 and out.count('DLH7.label(c)') == 1, 'v158: the spotlight is not reading the 7-day series'
    assert out.count('class="chainacts"') == 1 and 'margin-left:auto;display:inline-flex;gap:8px' not in out, 'v158: the proof-ledger action row is still the unwrappable span'
    print('v158: spotlight draws the observed week ending at the live price (caption says so); proof-ledger actions wrap inside their card')
    return out
