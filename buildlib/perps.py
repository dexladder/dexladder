# -*- coding: utf-8 -*-
"""Perpetual futures (2026-09-11): the DLSIM "Perps practice" desk → DLAPP (web/app/src/lib/perps,
hooks/usePerps, legacy/perps*.ts).

The old desk wrote S.bal directly, liquidated at a flat 94% margin burn and kept funding outside
the margin (so funding never moved the liquidation price). Each legacy body below is cut by brace matching,
its sha256 pinned (the text the replacement was written against), and replaced by a delegation —
so there is one perps implementation in the shipped file. (Open perps were already in net worth,
through a DLSIM wrapper of portfolioUSD — that wrapper now delegates too.) Runs right after arch.apply (the DLSIM
text it cuts already carries build154's sim-funding patch).
"""
import hashlib
from buildlib.arch import cut, _apply

CUTS = [
    # (id, unique start anchor, replacement)
    ('fundRate', 'function fundRate(sym){try{if(window.DLWEATHER)', 'function fundRate(sym){return DLAPP.legacy.perps.fundRate(sym)}'),
    ('tickPerps', 'function tickPerps(){var d=st();', 'function tickPerps(){DLAPP.legacy.perps.tick()}'),
    ('liquidate', 'function liquidate(p,mk){', 'function liquidate(){}'),
    ('openPerp', 'function openPerp(side){', 'function openPerp(side){DLAPP.legacy.perps.open(side)}'),
    ('closePerp', 'function closePerp(id){', 'function closePerp(id){DLAPP.legacy.perps.close(id)}'),
    ('renderPerps', 'function renderPerps(){var host=$("#dlpList")', 'function renderPerps(){DLAPP.legacy.perps.render()}'),
    ('mountPerp', 'function mountPerp(){', 'function mountPerp(){DLAPP.legacy.perps.mount()}'),
    ('setLev', 'function setLev(v){', 'function setLev(v){DLAPP.legacy.perps.setLeverage(v)}'),
    # DLDESK v152 decorated the old card (presets, funding bar); the new desk has both built in
    ('mountPerpExtras', 'function mountPerpExtras(){', 'function mountPerpExtras(){}'),
    # DLSIM already wrapped portfolioUSD with its own copy of the equity arithmetic (funding outside
    # the margin): the wrapper stays, its arithmetic is the typed one
    ('netWorth', 'try{if("function"==typeof portfolioUSD&&!window.__simPfu)',
     'try{if("function"==typeof portfolioUSD&&!window.__simPfu){var _pf=portfolioUSD;portfolioUSD=function(){return _pf.apply(this,arguments)+DLAPP.legacy.perps.equityUSD()},window.__simPfu=1}}'),
]
PINS = {
    'fundRate': '93e5c1b6e5b0a095cfeba99e6de8d09ee7f21c706e781da6a5d783bc72d401d1', 'tickPerps': 'a74e102ab62900250c0f37d2dd090c6251bc59c33c73821a75573bf3213f5925', 'liquidate': 'c4beea4214e01e375413eafda7a4a44c7d1d1f28c6dec2aed3780722650926e5', 'openPerp': '7eb187b8bf8eeef89f9338f7e8551db4d2a2b607b4bb38f2d8ff10b70d7fb35b', 'closePerp': '044b3b85ce12c9bc054a77b53339c7c0c613b83580c626ed1166e4f854b19129',
    'renderPerps': 'b0f2619876cbf3678e4f793d5ce2bd4e8f822f2ad46a52153260f11da270cc69', 'mountPerp': 'ae5b240cd88be27a057908ef91b22d868d5996ef504e6a91ea99409f8745a447', 'setLev': '82dcb528594d86e192ab699cdd597375ea280a20e6edf3b92448818f429113d9', 'mountPerpExtras': '0201e01941eec09b3b4ae16806e48257491f0fbb3781eccb45f52e3b63494c14',
    'netWorth': '8fb88e3c474b4eac317d3ac3a69cfa64e9b423ff5e0179c6f6eb9baf329ebceb',
}

def apply(out):
    shas = {}
    for pid, start, rep in CUTS:
        orig = cut(out, start)
        sha = hashlib.sha256(orig.encode('utf-8')).hexdigest()
        shas[pid] = sha
        pin = PINS.get(pid)
        assert pin is None or pin == sha, f'perps/{pid}: legacy text changed (sha {sha[:16]}…, pinned {pin[:16]}…) — re-check the delegation before re-pinning'
        out = out.replace(orig, rep, 1)
    unpinned = [k for k, v in PINS.items() if v is None]
    assert not unpinned, 'perps: pin these cuts: ' + ', '.join(f"'{k}': '{shas[k]}'" for k in unpinned)
    out = _apply(out, [
        # the trade journal says when a close was a perp, and how it ended
        ('journal-perp', '${j.of?` · partial fill of ${fmt(j.of)}`:""}</span>', '${j.of?` · partial fill of ${fmt(j.of)}`:""}${DLAPP.legacy.perps.journalNote(j)}</span>', 1),
        # funding is not optional on any venue: the realism sheet no longer offers to switch it off
        ('funding-row', ',["funding","Perp funding accrual","Perp positions pay / earn funding every ~8h by market momentum"]', '', 1),
    ], 'perps')
    for name in ('openPerp', 'closePerp', 'tickPerps', 'renderPerps', 'mountPerp', 'fundRate'):
        assert out.count('function %s(' % name) == 1, f'{name} must be defined exactly once'
    assert 'S.bal.USDT-=need' not in out and 'mk*(1-.94/L)' not in out, 'the old perps arithmetic survived'
    print('perps: DLSIM desk → DLAPP.legacy.perps (isolated margin, tiered maintenance, UTC funding settlements, '
          'liquidation engine + post-mortem); net worth counts open perps at typed equity; journal + ledger label them')
    return out
