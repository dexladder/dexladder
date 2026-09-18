# -*- coding: utf-8 -*-
"""Open the DexChart engine so the depth layers can extend it without editing it again.

layers/46-dexchart.js shipped as a closed IIFE: ST_DEF and TOOL were private, TOOL_GROUPS was
computed once at load, and the renderer knew five row kinds. Three things follow from that —
a new indicator meant editing a 4,800-line file, a new drawing tool meant the same file, and a
user script had no way to draw anything the engine had not already been taught.

This patch changes exactly four things and adds no behaviour of its own:

1 · registerStudy(k, def) — the study registry stops being private. ST_KEYS is recomputed, so
    the indicator dialog, the cache, the pane layout and the legend pick a registered study up
    unchanged; a def that is missing calc, name, group or inputs is refused rather than half
    added.
2 · indexTools() + registerTool(id, def) — TOOL_GROUPS becomes a function of TOOL rather than a
    snapshot of it, so the rail and the flyouts list what is actually registered.
3 · five row kinds the renderer did not have — shapes, bg, cols, labels, area. These are what a
    script's plotshape / bgcolor / plot(style=columns) / label.new / plot(style=area) compile to.
    Nothing in the existing 65 studies emits them, so the existing chart is byte-for-byte the
    same picture.
4 · DXC.kit — the internal helpers (math, palette, hit tests, canvas label, dialog widgets) as a
    named export, so an extension layer draws with the engine's own primitives instead of
    reimplementing them and drifting from the house look.

Every edit is count-asserted. No inline style attribute, no .style assignment, no innerHTML and
no eval-family call is added — all four are gate-arch ratchets that may only go down.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'layers', '46-dexchart.js')

EDITS = []

def E(name, old, new, n=1):
    EDITS.append((name, old, new, n))

# ---------------------------------------------------------------- 1 · study registry
E('registerStudy',
  '  var ST_KEYS = Object.keys(ST_DEF);\n  function stDef(k) { return ST_DEF[k] || null; }',
  '  var ST_KEYS = Object.keys(ST_DEF);\n'
  '  /* Extension point. A later layer adds studies through DXC.registerStudy; the registry is the\n'
  '     only thing it touches, so the cache, the pane layout, the legend and the dialog pick them\n'
  '     up with no knowledge of what was added. A def missing calc, name, group or inputs is\n'
  '     refused outright rather than registered half-formed and thrown from at paint time. */\n'
  '  function registerStudy(k, def) {\n'
  '    if (!k || !def || ST_DEF[k]) return false;\n'
  '    if (typeof def.calc !== "function" || !def.name || !def.g || !Array.isArray(def.in)) return false;\n'
  '    ST_DEF[k] = def; ST_KEYS = Object.keys(ST_DEF);\n'
  '    return true;\n'
  '  }\n'
  '  function stDef(k) { return ST_DEF[k] || null; }')

# ---------------------------------------------------------------- 2 · tool registry
E('indexTools',
  '  var TOOL_KEYS = Object.keys(TOOL);\n'
  '  var TOOL_GROUPS = (function () {\n'
  '    var seen = {}, out = [], i;\n'
  '    for (i = 0; i < TOOL_KEYS.length; i++) {\n'
  '      var t = TOOL[TOOL_KEYS[i]];\n'
  '      if (!seen[t.g]) { seen[t.g] = { g: t.g, tools: [] }; out.push(seen[t.g]); }\n'
  '      seen[t.g].tools.push(t);\n'
  '    }\n'
  '    return out;\n'
  '  })();',
  '  var TOOL_KEYS = [], TOOL_GROUPS = [];\n'
  '  /* TOOL_GROUPS used to be a snapshot taken at load. It is now a function of TOOL, so a tool\n'
  '     registered by a later layer appears in the rail and its flyout instead of existing only\n'
  '     to the hit test. */\n'
  '  function indexTools() {\n'
  '    TOOL_KEYS = Object.keys(TOOL);\n'
  '    var seen = {}, out = [], i;\n'
  '    for (i = 0; i < TOOL_KEYS.length; i++) {\n'
  '      var t = TOOL[TOOL_KEYS[i]];\n'
  '      if (!seen[t.g]) { seen[t.g] = { g: t.g, tools: [] }; out.push(seen[t.g]); }\n'
  '      seen[t.g].tools.push(t);\n'
  '    }\n'
  '    TOOL_GROUPS = out;\n'
  '  }\n'
  '  indexTools();\n'
  '  /* Extension point. A tool registered here is stored, hit-tested, styled, undone and\n'
  '     persisted by exactly the same paths as one declared above — the registry is the contract. */\n'
  '  function registerTool(id, def) {\n'
  '    if (!id || !def || TOOL[id]) return false;\n'
  '    if (typeof def.render !== "function" || !def.l || !def.g) return false;\n'
  '    T(id, def); indexTools();\n'
  '    return true;\n'
  '  }')

# ---------------------------------------------------------------- 3 · the five new row kinds
NEWROWS = '''  /* ---------------------------------------------------------------------
     The row kinds a script emits. Nothing in the 65 built-in studies returns
     any of these, so the chart that shipped draws exactly as it did.
     --------------------------------------------------------------------- */
  function markSize(g) { return Math.max(2, Math.min(5.5, g.sp * 0.3)); }
  function drawShapeRow(x, g, sc, row, from, to) {
    var a = row.data, i, pal = P(), r = markSize(g);
    if (!a) return;
    x.save();
    for (i = from; i < Math.min(to, a.length); i++) {
      var m = a[i];
      if (!m || m.v == null || !isFinite(m.v)) continue;
      var px = g.x(i), py = sc.y(m.v), c = m.c || row.c || pal.text, sh = m.s || row.shape || "circle", dn;
      x.fillStyle = c; x.strokeStyle = c; x.lineWidth = 1.2;
      if (sh === "square") x.fillRect(px - r, py - r, r * 2, r * 2);
      else if (sh === "diamond") { x.beginPath(); x.moveTo(px, py - r); x.lineTo(px + r, py); x.lineTo(px, py + r); x.lineTo(px - r, py); x.closePath(); x.fill(); }
      else if (sh === "cross" || sh === "xcross") { x.beginPath(); x.moveTo(px - r, py - r); x.lineTo(px + r, py + r); x.moveTo(px + r, py - r); x.lineTo(px - r, py + r); x.stroke(); }
      else if (sh === "flag") { x.fillRect(px - 0.7, py - r * 2.2, 1.4, r * 2.8); x.beginPath(); x.moveTo(px + 0.7, py - r * 2.2); x.lineTo(px + r * 2, py - r * 1.5); x.lineTo(px + 0.7, py - r * 0.8); x.closePath(); x.fill(); }
      else if (sh === "up" || sh === "down" || sh === "triangleup" || sh === "triangledown" || sh === "arrowup" || sh === "arrowdown") {
        dn = (sh === "down" || sh === "triangledown" || sh === "arrowdown") ? 1 : -1;
        x.beginPath(); x.moveTo(px, py); x.lineTo(px - r, py + dn * r * 1.7); x.lineTo(px + r, py + dn * r * 1.7); x.closePath(); x.fill();
      } else { x.beginPath(); x.arc(px, py, r, 0, TAU); x.fill(); }
      if (m.txt) {
        dn = (m.s === "down" || m.s === "triangledown" || m.s === "arrowdown" || row.below) ? 1 : -1;
        label(x, px, py + dn * (r * 2.2 + 7), String(m.txt), c, null, "center", 9);
      }
    }
    x.restore();
  }
  function drawBgRow(x, g, sc, row, from, to) {
    var a = row.data, i, bw = Math.max(1, g.sp), h = Math.max(1, sc.bot - sc.top);
    if (!a) return;
    x.save(); x.globalAlpha = row.alpha == null ? 0.13 : row.alpha;
    for (i = from; i < Math.min(to, a.length); i++) {
      if (!a[i]) continue;
      x.fillStyle = a[i];
      x.fillRect(g.x(i) - bw / 2, sc.top, bw, h);
    }
    x.restore();
  }
  function drawColsRow(x, g, sc, row, from, to) {
    var a = row.data, cs = row.cols, i, bw = Math.max(1, g.sp * 0.66), base = row.base == null ? 0 : row.base, dflt = row.c || P().text;
    if (!a) return;
    x.save(); x.globalAlpha = row.alpha == null ? 0.85 : row.alpha;
    for (i = from; i < Math.min(to, a.length); i++) {
      var v = a[i];
      if (v == null || !isFinite(v)) continue;
      var y0 = sc.y(base), y1 = sc.y(v);
      x.fillStyle = (cs && cs[i]) || dflt;
      x.fillRect(g.x(i) - bw / 2, Math.min(y0, y1), bw, Math.max(1, Math.abs(y1 - y0)));
    }
    x.restore();
  }
  function drawLabelRow(x, g, sc, row, from, to) {
    var a = row.data, i, pal = P();
    if (!a) return;
    for (i = from; i < Math.min(to, a.length); i++) {
      var m = a[i];
      if (!m || m.v == null || !isFinite(m.v) || m.txt == null || m.txt === "") continue;
      label(x, g.x(i), sc.y(m.v) + (m.below ? 12 : -8), String(m.txt), m.c || row.c || pal.text, m.bg || null, m.align || "center", m.fs || 9);
    }
  }
  function drawAreaRow(x, g, sc, row, from, to) {
    var a = row.data, i, on = false, firstX = 0, lastX = 0;
    if (!a) return;
    var base = row.base == null ? sc.bot : sc.y(row.base);
    x.save(); x.beginPath();
    for (i = from; i < Math.min(to, a.length); i++) {
      var v = a[i];
      if (v == null || !isFinite(v)) continue;
      var px = g.x(i), py = sc.y(v);
      if (!on) { x.moveTo(px, py); firstX = px; on = true; } else x.lineTo(px, py);
      lastX = px;
    }
    if (on) {
      x.lineTo(lastX, base); x.lineTo(firstX, base); x.closePath();
      x.globalAlpha = row.fill == null ? 0.16 : row.fill;
      x.fillStyle = row.c || P().text; x.fill(); x.globalAlpha = 1;
    }
    x.restore();
    drawLineRow(x, g, sc, { data: a, c: row.c, w: row.w || 1.4, dash: row.dash || 0, name: row.name }, from, to, 0);
  }

'''
E('newrows', '  function drawRows(x, g, pane, list, extend) {', NEWROWS + '  function drawRows(x, g, pane, list, extend) {')

E('dispatch',
  '        else if (row.kind === "step") drawStepRow(x, g, sc, row, g.from, g.to);\n'
  '        else drawLineRow(',
  '        else if (row.kind === "step") drawStepRow(x, g, sc, row, g.from, g.to);\n'
  '        else if (row.kind === "shapes") drawShapeRow(x, g, sc, row, g.from, g.to);\n'
  '        else if (row.kind === "bg") drawBgRow(x, g, sc, row, g.from, g.to);\n'
  '        else if (row.kind === "cols") drawColsRow(x, g, sc, row, g.from, g.to);\n'
  '        else if (row.kind === "labels") drawLabelRow(x, g, sc, row, g.from, g.to);\n'
  '        else if (row.kind === "area") drawAreaRow(x, g, sc, row, g.from, g.to);\n'
  '        else drawLineRow(')

# the auto-scale sweep must not read a shapes/labels row's marker objects as numbers
E('autoscale',
  '          var rw = r2.rows[j2], dat = rw.data || rw.a;\n          if (!dat) continue;',
  '          var rw = r2.rows[j2], dat = rw.data || rw.a;\n'
  '          if (!dat) continue;\n'
  '          if (rw.kind === "bg") continue;\n'
  '          if (rw.kind === "shapes" || rw.kind === "labels") {\n'
  '            for (var z3 = from; z3 < Math.min(to, dat.length); z3++) {\n'
  '              var mk = dat[z3];\n'
  '              if (!mk || mk.v == null || !isFinite(mk.v)) continue;\n'
  '              if (mk.v > phi) phi = mk.v; if (mk.v < plo) plo = mk.v;\n'
  '            }\n'
  '            continue;\n'
  '          }')

# the legend must not print [object Object] for a marker row
E('legend',
  '          if (!dat || rw.kind === "vbars") continue;',
  '          if (!dat || rw.kind === "vbars" || rw.kind === "shapes" || rw.kind === "labels" || rw.kind === "bg") continue;')

# ---------------------------------------------------------------- 4 · the public surface
E('api',
  '  return {\n    __v: 160,\n    owns: owns, draw: draw, sync: sync, mount: mount, paint: paint,',
  '  return {\n    __v: 165,\n    owns: owns, draw: draw, sync: sync, mount: mount, paint: paint,\n'
  '    /* the extension surface — see buildlib/dxc_open.py */\n'
  '    registerStudy: registerStudy, registerTool: registerTool, reindex: indexTools,\n'
  '    studyDefs: function () { return ST_DEF; }, toolDefs: function () { return TOOL; },\n'
  '    kit: {\n'
  '      M: M, line: line, num: num, SRC: SRC_OPTS, colors: SERIES_COLORS, pal: P, isDay: day,\n'
  '      fmt: fmt, sig: sig, volFmt: vol, pct: pctS, stamp: stamp, clamp: clamp, isNum: isNum, last: last,\n'
  '      uid: uid, LS: LS, TAU: TAU, dash: dash,\n'
  '      sxy: sxy, lineTo: lineTo, extendLine: extend, dist2seg: dist2seg, label: label, arrowHead: arrowHead,\n'
  '      polyPath: polyPath, fillPoly: fillPoly, hitPoly: hitPoly, bbox: bbox, hitBox: hitBox,\n'
  '      el: el, btn: btn, modal: modal, closeModal: closeModal2, fieldRow: fieldRow, inputNum: inputNum,\n'
  '      select: select, checkbox: checkbox, askText: askText, clear: clear,\n'
  '      mark: mark, barsOf: bars, host: host, canvas: cv, fault: fault, jget: jget,\n'
  '      cfg: function () { return CFG; }, mkey: mkey, symKey: symKey,\n'
  '      drawStyle: drawStyle, commit: commit, newObj: newObj, pushUndo: pushUndo, saveDraws: saveDraws,\n'
  '      drawings: drawings, geo: function () { return V.geo; }\n'
  '    },')

def apply():
    s = open(SRC, encoding='utf-8').read()
    before = len(s)
    for name, old, new, n in EDITS:
        c = s.count(old)
        assert c == n, 'dxc_open %s: expected %d anchor(s), found %d' % (name, n, c)
        s = s.replace(old, new, n)
    # post-conditions, on the patched text
    post = [
        ('registerStudy is exported', 'registerStudy: registerStudy'),
        ('registerTool is exported', 'registerTool: registerTool'),
        ('the kit is exported', '    kit: {'),
        ('the tool index is a function', 'function indexTools()'),
        ('shapes render', 'function drawShapeRow('),
        ('bg render', 'function drawBgRow('),
        ('cols render', 'function drawColsRow('),
        ('labels render', 'function drawLabelRow('),
        ('area render', 'function drawAreaRow('),
        ('version moved', '__v: 165'),
    ]
    for label_, needle in post:
        assert needle in s, 'dxc_open post-condition failed: ' + label_
    # ratchets: this patch adds none of the four
    assert 'new Function' not in s, 'dxc_open: eval family'
    assert '.innerHTML' not in s, 'dxc_open: innerHTML'
    assert s.count('.style.') == open(SRC, encoding='utf-8').read().count('.style.'), 'dxc_open: style assignment added'
    open(SRC, 'w', encoding='utf-8').write(s)
    return before, len(s)

if __name__ == '__main__':
    a, b = apply()
    print('46-dexchart.js opened: %d -> %d chars (+%d)' % (a, b, b - a))
