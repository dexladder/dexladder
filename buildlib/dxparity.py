# -*- coding: utf-8 -*-
"""The parity pass, asserted against the built payload rather than the source tree.

Four layers turned the native chart from a good chart into a charting terminal:

  51-dxstudies.js   +68 indicators  (65 -> 133)
  52-dxtools.js     +46 drawing tools (75 -> 121 registered)
  53-dexscript.js   the DexScript language: lexer, parser, resolver, bar-by-bar
                    interpreter, 204 stdlib entries, a no-lookahead strategy engine
  54-dxscriptui.js  the editor, 41 shipped scripts, import/export, the Pine converter

They register themselves through the extension surface opened by dxc_open.py, so
build154.py needs no wiring for them - layers/*.js is globbed in filename order. What
build154.py DOES need is a check that they are actually in the bytes that ship, because
a layer that silently failed to concatenate would leave a chart that still works,
still passes every runtime gate, and is quietly missing two thirds of itself.

So this file asserts presence and shape in the payload, plus the four ratchets. It runs
after the layers are appended. It changes nothing.
"""
import re

MARKERS = [
    # (layer, a string only that layer can produce, minimum occurrences)
    ('51-dxstudies', 'DXC.registerStudy', 1),
    ('52-dxtools',   'DXC.registerTool', 1),
    ('53-dexscript', 'window.DXS', 1),
    ('54-dxscriptui', 'DXSPINE', 1),
]

def apply(out):
    for name, needle, n in MARKERS:
        c = out.count(needle)
        assert c >= n, 'the parity pass: layers/%s.js is not in the payload (%r x%d)' % (name, needle, c)

    # the extension surface itself - if this went, every registration above is a no-op
    for needle, why in (
        ('function registerStudy(', 'the study registry is closed again'),
        ('function unregisterStudy(', 'a script can be added but never removed'),
        ('function registerTool(', 'the tool registry is closed again'),
        ('function indexTools(', 'the tool groups are a load-time snapshot again'),
        ('function drawShapeRow(', 'plotshape has nothing to draw with'),
        ('function drawBgRow(', 'bgcolor has nothing to draw with'),
        ('function drawColsRow(', 'per-bar plot colours have nothing to draw with'),
        ('function drawLabelRow(', 'script labels have nothing to draw with'),
        ('function drawAreaRow(', 'area plots have nothing to draw with'),
        ('kit: {', 'the extension layers have no helpers and will have reimplemented them'),
    ):
        assert needle in out, 'the parity pass: ' + why

    # The four gate-arch ratchets, measured here with gate-arch's own regexes so the
    # build fails at build time rather than at gate time. Ceilings are its ceilings.
    #
    # inlineStyleAttrs deserves a note. The gate counts the byte sequence style=" across
    # the whole payload; it cannot tell an HTML attribute from those five characters
    # inside a string. DexScript's plot() has a style argument, so a shipped script that
    # spells it out would charge this ratchet for something that is not an inline style
    # at all. The language therefore accepts draw= and dash= as well, and the whole
    # shipped library is written with those. style= and linestyle= remain valid, because
    # that is what a converted Pine script arrives spelling - they simply never appear in
    # the bytes we ship. If this assert fires after a library edit, that is the reason.
    R = (
        ('inlineStyleAttrs', r'style=\\?["\']', 1125),
        ('styleAssignments', r'\.style\.[a-zA-Z]+\s*=(?!=)', 230),
        ('cssText',          r'cssText', 17),
    )
    got = {}
    for nm, rx, ceiling in R:
        n = len(re.findall(rx, out))
        got[nm] = n
        assert n <= ceiling, (
            'the parity pass: %s is %d, ceiling %d. These ratchets only go down. '
            'If a shipped DexScript source now spells style= or linestyle=, rewrite it as '
            'draw= / dash= (both are accepted) rather than raising the ceiling.' % (nm, n, ceiling))
    ev = (len(re.findall(r'(?<![\w.$])(?:eval|Function)\s*\(', out))
          + len(re.findall(r'setTimeout\(\s*["\'`]', out))
          + len(re.findall(r'setInterval\(\s*["\'`]', out)))
    got['evalFamily'] = ev
    assert ev <= 2, (
        'the parity pass: the eval family is %d, ceiling 2. DexScript is a tree-walking '
        'interpreter precisely so that running user code needs none of them.' % ev)
    print('  parity ratchets: inlineStyleAttrs=%d styleAssignments=%d cssText=%d evalFamily=%d'
          % (got['inlineStyleAttrs'], got['styleAssignments'], got['cssText'], got['evalFamily']))
    return out
