# -*- coding: utf-8 -*-
"""Conditional and algorithmic orders (11 Sep 2026) — OCO and TWAP on the paper desk.

The decisions and the arithmetic live in the typed core (lib/paper-engine/algo.ts, orders.ts,
legacy/algo.ts, legacy/algo-ui.ts). These are the five hooks the legacy desk needs, each
count-asserted like every other patch in this build:

  loop      every tick, the TWAP parent sends the slices that have come due
  oco-fill  the instant a leg fills, its OCO partner is cancelled (or shrunk on a partial)
  cancel    cancelling one leg by hand cancels its partner — an OCO is one order
  rows      the working-orders list knows how to draw a TWAP parent and an OCO leg
  laser     a parent order has no price of its own, so it draws no line on the chart
"""

PATCHES = [
    ('loop', 'window.evalOrders=function(){try{ensureEng()}catch(e){}',
     'window.evalOrders=function(){try{ensureEng()}catch(e){}try{DLAPP.legacy.algo.step()}catch(e){}', 1),
    ('oco-fill', 'done.push(o.id),ok?(toast(',
     'done.push(o.id),ok&&(()=>{try{DLAPP.legacy.algo.ocoFilled(o,fq)}catch(_e){}})(),ok?(toast(', 1),
    ('cancel', 'function cancelOrder(id){ensureEng(),S.orders=S.orders.filter(o=>o.id!==id)',
     'function cancelOrder(id){ensureEng();try{DLAPP.legacy.algo.ocoCancel(id)}catch(_e){}S.orders=S.orders.filter(o=>o.id!==id)', 1),
    ('rows', 'mine.length?host.innerHTML=mine.map(o=>{const col=',
     'mine.length?host.innerHTML=mine.map(o=>{const _a=DLAPP.legacy.algo.rowHtml(o,{fmt:fmt,esc:esc,gly:gly});if(_a)return _a;const col=', 1),
    ('laser', '(S.orders||[]).forEach(o=>{if(o.sym!==S.coin||o.quote!==S.quote)return;',
     '(S.orders||[]).forEach(o=>{if(o.sym!==S.coin||o.quote!==S.quote||"twap"===o.type||"void"===o.type)return;', 1),
]


def apply(out):
    for pid, find, rep, n in PATCHES:
        c = out.count(find)
        assert c == n, f'algo/{pid}: expected {n} occurrence(s), found {c}'
        out = out.replace(find, rep)
    assert out.count('DLAPP.legacy.algo.') == 4
    print('algo: OCO (one cancels the other) and TWAP (a parent worked in slices) on the paper desk')
    return out
