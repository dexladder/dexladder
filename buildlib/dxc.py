# -*- coding: utf-8 -*-
"""DexChart Pro — the payload half of layers/46-dexchart.js.

The native Terminal chart was one canvas with five indicator toggles (EMA, SMA, RSI, MACD,
VP), two chart types (candles, area), five bar sizes built by aggregating a 30-minute close
series, and no drawing layer at all. Layer 46 replaces the engine behind it: real OHLCV
klines, 16 chart types, 65 studies on resizable panes, 71 drawing tools with anchors,
magnet, undo and a per-market store, log / percent / indexed / inverted scales, bar replay,
symbol comparison, layout templates and a PNG snapshot.

This file is only the handover. Four patches, each count-asserted:

1 · drawCoinChart hands the canvas to DXC when DXC owns it. The hook sits AFTER the two
    early returns the payload already has, so the TradingView engine and the Time-machine
    replay desk keep the canvas exactly as before. `chartGeo=null` on the way through is
    what stops the legacy crosshair from reading a geometry that is no longer on screen.
2 · setupCrosshair and 3 · setupChartGestures return early while DXC owns the panel: the
    engine draws its own crosshair on the canvas and owns wheel, drag and pinch itself, and
    two listeners fighting over one host is how a chart ends up jittering.
4 · The native tool row becomes the engine's own bar host (#dxcBar) and the engine chip is
    renamed, so one row is not describing two different charts. The legacy toggles are
    removed from the markup, not hidden — toggleInd, setIndP and syncIndUI stay in the
    payload and are all null-safe, so nothing throws when their nodes are gone.
    openReplay / rpExit / the engine chips also tell the engine to sync, which is what folds
    the rail, legend and HUD away while another engine has the panel.

No inline style attribute and no .style assignment is added anywhere by this patch (both are
gate-arch ratchets that may only go down); the row loses none and gains none.
"""

BAR = '<span class="dxc-bar" id="dxcBar"></span>'

OLD_TOOLS = (
    '<div class="ctype" id="cvType"><button data-t="candles" class="on">Candles</button>'
    '<button data-t="area">Area</button></div>\n'
    '            <div class="ctype" id="cvInd"><button data-ind="ema" class="on" onclick="toggleInd(\'ema\')">EMA</button>'
    '<input id="emaP" class="indp" value="20" inputmode="numeric" onchange="setIndP(\'emaP\',this.value)">'
    '<button data-ind="sma" onclick="toggleInd(\'sma\')">SMA</button>'
    '<input id="smaP" class="indp" value="50" inputmode="numeric" onchange="setIndP(\'smaP\',this.value)">'
    '<button data-ind="rsi" class="on" onclick="toggleInd(\'rsi\')">RSI</button>'
    '<button data-ind="macd" onclick="toggleInd(\'macd\')">MACD</button>'
    '<button data-ind="vp" class="on" onclick="toggleInd(\'vp\')">VP</button></div>\n'
    '            <div class="range" id="cvRange"><button data-tf="1M">1M</button><button data-tf="15M">15M</button>'
    '<button data-tf="1H">1H</button><button data-tf="1D" class="on">1D</button><button data-tf="7D">7D</button></div>'
)

PATCHES = [
    # 1 · the handover, after the TradingView and replay early returns
    ('handover',
     'if("tv"===S.chartEngine)return;if(RP.on)return;const cv=document.getElementById("coinChart");',
     'if("tv"===S.chartEngine)return;if(RP.on)return;'
     'if(window.DXC&&DXC.owns())return chartGeo=null,void DXC.draw();'
     'const cv=document.getElementById("coinChart");', 1),

    # 2 · the legacy crosshair overlay stands down
    ('crosshair',
     'function setupCrosshair(){if(crossReady)return;',
     'function setupCrosshair(){if(window.DXC&&DXC.owns())return;if(crossReady)return;', 1),

    # 3 · the legacy wheel / drag / pinch gestures stand down
    ('gestures',
     'function setupChartGestures(){if(gestReady)return;',
     'function setupChartGestures(){if(window.DXC&&DXC.owns())return;if(gestReady)return;', 1),

    # 4a · the tool row belongs to the engine
    ('toolrow', OLD_TOOLS, BAR, 1),

    # 4b · the engine chip says which engine it is
    ('chip', '<button data-e="native" class="on" onclick="setChartEngine(\'native\')">⚡ DexLadder</button>',
     '<button data-e="native" class="on" onclick="setChartEngine(\'native\');window.DXC&&DXC.sync()">⚡ DexChart Pro</button>', 1),
    ('chip-tv', '<button data-e="tv" onclick="setChartEngine(\'tv\')">\U0001f4ca TradingView</button>',
     '<button data-e="tv" onclick="setChartEngine(\'tv\');window.DXC&&DXC.sync()">\U0001f4ca TradingView</button>', 1),

    # 4c · the replay desk tells the engine when it takes and gives back the panel
    ('rp-open', 'id="rpOpen" onclick="openReplay()"', 'id="rpOpen" onclick="openReplay();window.DXC&&DXC.sync()"', 1),
    ('rp-exit', '<button class="rp-x" onclick="rpExit()">', '<button class="rp-x" onclick="rpExit();window.DXC&&DXC.sync()">', 1),

    # the TradingView panel's note claimed the toolkit only the embed had; the native engine
    # has its own now, so the note states what is actually different between the two.
    ('tv-note',
     'The full TradingView toolkit — 100+ indicators, every drawing tool, all chart types, intervals down to seconds, compare &amp; fullscreen — on live exchange data.',
     'TradingView’s own panel, on live exchange data — useful for a second opinion and for intervals below a minute.', 1),
]


def apply(out):
    for pid, find, rep, k in PATCHES:
        c = out.count(find)
        assert c == k, 'dxc/%s: expected %d occurrence(s), found %d' % (pid, k, c)
        out = out.replace(find, rep)

    # the handover is reachable and is the only one
    assert out.count('if(window.DXC&&DXC.owns())return chartGeo=null,void DXC.draw();') == 1, \
        'dxc: drawCoinChart does not hand the canvas to the engine exactly once'
    assert out.index('if("tv"===S.chartEngine)return;if(RP.on)return;if(window.DXC&&DXC.owns())') > 0, \
        'dxc: the handover moved ahead of the TradingView / replay early returns'
    # the layer itself is in the payload, and it is the engine the chip names
    assert 'window.DXC = (function ()' in out, 'dxc: layers/46-dexchart.js is not in the payload'
    assert out.count('id="dxcBar"') == 1, 'dxc: the engine has no bar host, or more than one'
    assert out.count('DexChart Pro') >= 1, 'dxc: the engine chip was not renamed'
    # the retired controls are gone from the markup, and their handlers are still null-safe
    for dead in ('id="cvType"', 'id="cvInd"', 'id="cvRange"', 'id="emaP"', 'id="smaP"'):
        assert dead not in out, 'dxc: %s survived the tool-row replacement' % dead
    assert 'function syncIndUI(){' in out and 'e1&&(e1.value=S.emaP||20)' in out, \
        'dxc: syncIndUI is gone — renderCoin calls it on every open'
    assert out.count('function toggleInd(k){') == 1 and out.count('function setIndP(k,v){') == 1, \
        'dxc: the legacy indicator handlers were removed; they are still called from saved state'
    # the engine's CSS is in the payload's one stylesheet, not injected at runtime
    assert '#coinHost .dxc-rail{' in out and 'body.dxc-fs #page-coin #coinHost{' in out, \
        'dxc: the engine chrome has no CSS — layers/v154.css is missing the DexChart block'
    # the panel contract gate-arch measures is untouched
    assert '#page-coin #coinHost{flex:0 0 auto;height:560px' in out and '@media(max-width:760px){#page-coin #coinHost{height:430px}}' in out, \
        'dxc: the 560/430px chart panel was disturbed'
    # no network path of its own
    assert 'DXC' in out and out.count('fetch(u, init)') >= 1, 'dxc: the core fetch path is missing'
    for bad in ('fetch("https://data-api', "fetch('https://data-api"):
        assert bad not in out, 'dxc: the engine opened its own network call instead of DLCORE.jget'
    print('dxc: DexChart Pro owns the native panel — 16 chart types, 65 studies, 71 drawing tools, '
          '14 bar sizes on real klines; TradingView and the replay desk keep the canvas when theirs')
    return out
