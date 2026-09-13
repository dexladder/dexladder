// DexLadder contrast gate — self-contained, dependency-free WCAG 2.1 checker.
//
// Why this file exists
// -------------------
// gate154.js measured contrast by writing a token's value into a live element's
// `style.color` and reading it back. That is fail-open in three separate ways
// (see docs: contrast-truth.md):
//   1. an unknown / misspelled / non-colour token silently inherits the page's
//      text colour, so `--inkk` reports 16.41 and PASSES;
//   2. an rgba() token's alpha is dropped, so a 10% wash reports the contrast of
//      the solid pigment (--up-soft: true 1.34, reported 9.19);
//   3. the ratio is rounded to 2dp *before* the >= 4.5 comparison, so 4.4999996
//      passes.
// It also only ever measured 4 of the 48 token/surface pairs, and never the
// market-direction pair (--up / --down) at all.
//
// This checker reads the shipped artifact off disk, resolves the CSS cascade
// itself, and recomputes every ratio from the hex. Nothing is trusted:
//   * CANARIES — every run injects one known-PASSING and one known-FAILING case
//     through the exact same code path. Not exactly 1 pass + 1 fail => the whole
//     run aborts. A gate that cannot see a planted failure is not evidence.
//   * RECOMPUTE FROM ARTIFACT — the artifact is read and parsed twice, by two
//     independent passes, and every reported number must be reproduced bit-for-
//     bit by the second pass. No assertion may quote a remembered value.
//
// Usage:  node gate-contrast.js [path/to/index.html]
// Exit code = number of failures (0 = clean), 99 = harness/canary fault.
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

/* ------------------------------------------------------------------ colour */

function srgbToLinear(c) {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(col) {
  if (col.a !== 1) throw new Error('luminance() needs an opaque colour; composite it first');
  return 0.2126 * srgbToLinear(col.r) + 0.7152 * srgbToLinear(col.g) + 0.0722 * srgbToLinear(col.b);
}

// WCAG 2.1 / 2.2 contrast ratio. Full precision — never rounded before comparison.
function contrast(fg, bg) {
  const a = luminance(fg), b = luminance(bg);
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

// Simple alpha compositing of `fg` over an opaque `bg` (source-over).
function composite(fg, bg) {
  if (bg.a !== 1) throw new Error('cannot composite over a translucent backdrop');
  if (fg.a === 1) return fg;
  const m = (f, b) => Math.round(f * fg.a + b * (1 - fg.a));
  return { r: m(fg.r, bg.r), g: m(fg.g, bg.g), b: m(fg.b, bg.b), a: 1 };
}

const NAMED = { white: '#FFFFFF', black: '#000000' };

// Parse a CSS colour. THROWS on anything it does not understand — this is the
// single most important behavioural difference from the old gate, which silently
// substituted the inherited text colour and reported a great ratio for a token
// that did not exist.
function parseColor(raw, resolveVar, depth) {
  depth = depth || 0;
  if (depth > 8) throw new Error('var() nesting too deep');
  if (raw == null) throw new Error('colour is null');
  let v = String(raw).trim();
  if (!v) throw new Error('empty value (token undefined in this mode?)');

  const varm = v.match(/^var\(\s*(--[\w-]+)\s*(?:,([\s\S]+))?\)$/);
  if (varm) {
    const target = resolveVar ? resolveVar(varm[1]) : null;
    if (target != null && String(target).trim()) return parseColor(target, resolveVar, depth + 1);
    if (varm[2] != null) return parseColor(varm[2], resolveVar, depth + 1);
    throw new Error('var(' + varm[1] + ') does not resolve');
  }

  if (Object.prototype.hasOwnProperty.call(NAMED, v.toLowerCase())) v = NAMED[v.toLowerCase()];

  let m = v.match(/^#([0-9a-fA-F]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
    if (h.length !== 6 && h.length !== 8) throw new Error('bad hex length: ' + v);
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    };
  }

  // color(srgb r g b [/ a]) — what Chromium resolves color-mix() to. Channels are 0..1.
  // Without this the parser threw on every mixed colour; a caller that treats a throw as
  // "keep looking" then walks past an opaque backdrop and measures against the wrong thing.
  m = v.match(/^color\(\s*srgb\s+([^)]*)\)$/i);
  if (m) {
    const parts = m[1].split(/[\/\s]+/).map(s => s.trim()).filter(Boolean);
    if (parts.length < 3) throw new Error('color(srgb) needs 3 channels: ' + v);
    const num = s => s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s);
    const col = {
      r: Math.round(num(parts[0]) * 255), g: Math.round(num(parts[1]) * 255),
      b: Math.round(num(parts[2]) * 255), a: parts.length > 3 ? num(parts[3]) : 1
    };
    for (const k of ['r', 'g', 'b', 'a']) {
      if (!Number.isFinite(col[k])) throw new Error('non-numeric channel in ' + v);
    }
    return col;
  }

  m = v.match(/^rgba?\(([^)]*)\)$/i);
  if (m) {
    const parts = m[1].split(/[,\/\s]+/).map(s => s.trim()).filter(Boolean);
    if (parts.length < 3) throw new Error('rgb() needs 3 channels: ' + v);
    const chan = s => s.endsWith('%') ? Math.round(parseFloat(s) * 2.55) : parseFloat(s);
    const alpha = parts.length > 3
      ? (parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]))
      : 1;
    const col = { r: chan(parts[0]), g: chan(parts[1]), b: chan(parts[2]), a: alpha };
    for (const k of ['r', 'g', 'b', 'a']) {
      if (!Number.isFinite(col[k])) throw new Error('non-numeric channel in ' + v);
    }
    return col;
  }

  // gradients, keywords, currentColor, calc(), anything else
  throw new Error('not a flat colour: ' + v.slice(0, 60));
}

/* -------------------------------------------------------------- CSS source */

// Pull the stylesheet text out of the shipped single-file payload.
// <script> bodies are removed first so CSS-shaped strings inside JS cannot leak in.
function stylesheetText(html) {
  const noScript = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ');
  const out = [];
  const re = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  let m;
  while ((m = re.exec(noScript))) out.push(m[1]);
  return out.join('\n').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

// Walk the CSS and emit every style rule in document order, tagged with the
// at-rule conditions it sits under. Conditional rules are kept (not dropped) so
// that a token hidden inside @media can be reported rather than silently ignored.
function parseRules(css) {
  const rules = [];
  let i = 0, order = 0;

  function block(start, conds) {
    let j = start;
    let head = '';
    while (j < css.length) {
      const c = css[j];
      if (c === '}') return j + 1;
      if (c === '{') {
        const sel = head.trim();
        head = '';
        if (sel.startsWith('@')) {
          const nested = /^@(media|supports|layer|container|scope)\b/i.test(sel);
          if (nested) { j = block(j + 1, conds.concat([sel])); continue; }
          j = skipBlock(j + 1); continue;              // @font-face, @keyframes, ...
        }
        const end = skipBlockCapture(j + 1);
        rules.push({ selector: sel, body: css.slice(j + 1, end.at), conds: conds, order: order++ });
        j = end.next;
        continue;
      }
      head += c;
      j++;
    }
    return j;
  }
  function skipBlock(start) {
    let d = 1, j = start;
    while (j < css.length && d > 0) { if (css[j] === '{') d++; else if (css[j] === '}') d--; j++; }
    return j;
  }
  function skipBlockCapture(start) {
    let d = 1, j = start;
    while (j < css.length && d > 0) { if (css[j] === '{') d++; else if (css[j] === '}') d--; j++; }
    return { at: j - 1, next: j };
  }
  block(i, []);
  return rules;
}

function declarations(body) {
  const out = [];
  // custom properties only; values may contain nested parens but not top-level ';'
  const re = /(--[\w-]+)\s*:\s*([^;]*?)(?:\s*(!important))?\s*(?:;|$)/g;
  let m;
  while ((m = re.exec(body))) out.push({ prop: m[1], value: m[2].trim(), important: !!m[3] });
  return out;
}

/* ------------------------------------------------------------- selectors */

// Which root-scoped selectors apply, and at what specificity.
// Anything root-scoped that this cannot classify is returned as UNKNOWN and
// hard-fails the run rather than being quietly skipped.
function classify(sel) {
  const s = sel.trim();
  if (/[\s>+~]/.test(s.replace(/\([^)]*\)/g, ''))) return null;   // has a combinator: not the root element
  const base = s.replace(/\[[^\]]*\]/g, '').replace(/:not\([^)]*\)/g, '');
  const isRootish = /^(html|:root|html:root|:root:root)?$/.test(base) && (/^(html|:root)/.test(s));
  if (!isRootish) return null;

  const attrs = s.match(/\[[^\]]*\]/g) || [];
  const nots = s.match(/:not\([^)]*\)/g) || [];

  let day = null;    // true => day only, false => night only, null => both
  for (const a of attrs) {
    const mm = a.match(/^\[\s*data-mode\s*=\s*"?'?([\w-]+)"?'?\s*\]$/);
    if (!mm) return 'UNKNOWN:' + s;
    if (mm[1] === 'day') { if (day === false) return 'UNKNOWN:' + s; day = true; }
    else return 'UNKNOWN:' + s;                                    // a retired mode
  }
  for (const n of nots) {
    const mm = n.match(/^:not\(\s*\[\s*data-mode\s*=\s*"?'?([\w-]+)"?'?\s*\]\s*\)$/);
    if (!mm) return 'UNKNOWN:' + s;
    if (mm[1] === 'day') { if (day === true) return 'UNKNOWN:' + s; day = false; }
  }

  // specificity: a=#id, b=class/attr/pseudo-class, c=element
  const a = (s.match(/#/g) || []).length;
  const b = attrs.length + nots.length + (s.match(/:root/g) || []).length +
            (s.match(/\.[\w-]/g) || []).length;
  const c = /(^|[^-\w]):?root/.test(s) ? 0 : 0;
  const el = /^html/.test(s) ? 1 : 0;
  return { day: day, spec: [a, b, el + c] };
}

const MODES = ['night', 'day'];

// Resolve the winning value of every custom property, per mode, by the real
// cascade: !important, then specificity, then document order.
function resolveTokens(rules) {
  const winners = { night: {}, day: {} };
  const problems = [];

  for (const r of rules) {
    const decls = declarations(r.body);
    if (!decls.length) continue;
    const cls = classify(r.selector);
    if (cls === null) continue;                       // not root-scoped: irrelevant to tokens
    if (typeof cls === 'string') { problems.push({ kind: 'selector', detail: cls }); continue; }
    if (r.conds.length) {
      problems.push({ kind: 'conditional', detail: r.conds.join(' / ') + ' { ' + r.selector + ' }' });
      continue;
    }
    for (const mode of MODES) {
      if (cls.day === true && mode !== 'day') continue;
      if (cls.day === false && mode !== 'night') continue;
      for (const d of decls) {
        const prev = winners[mode][d.prop];
        const rank = [d.important ? 1 : 0, cls.spec[0], cls.spec[1], cls.spec[2], r.order];
        if (!prev || cmp(rank, prev.rank) >= 0) {
          winners[mode][d.prop] = { value: d.value, rank: rank, selector: r.selector };
        }
      }
    }
  }
  return { winners, problems };
}

function cmp(a, b) {
  for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; }
  return 0;
}

/* ------------------------------------------------------------- the matrix */

const TEXT_TOKENS = ['--ink', '--ink-2', '--muted', '--faint', '--up', '--down'];
const SURFACES = ['--bg', '--bg-solid', '--surface', '--surface-2'];
const SOFT_TOKENS = ['--up-soft', '--down-soft'];

// The soft fills are translucent washes used as a chip background behind the
// direction colour — the payload ships `.up{background:var(--up-soft);color:var(--up)}`.
// A decorative tint is NOT a 1.4.11 non-text object, so its own contrast against
// the panel is reported for information only. What is actually normative is the
// direction TEXT sitting on the composited chip, and that is asserted at 4.5.
const SOFT_PAIRS = [
  { fg: '--up', fill: '--up-soft' },
  { fg: '--down', fill: '--down-soft' }
];

const AA_TEXT = 4.5;      // WCAG 2.2 SC 1.4.3, normal-size text
const AA_NONTEXT = 3.0;   // WCAG 2.2 SC 1.4.11, non-text / UI boundaries

// One independent pass: read bytes -> parse -> resolve -> compute every ratio.
// Called twice per run, from two separate reads, so nothing can be remembered.
function computePass(file) {
  const bytes = fs.readFileSync(file);
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  const rules = parseRules(stylesheetText(bytes.toString('utf8')));
  const { winners, problems } = resolveTokens(rules);

  const get = mode => name => (winners[mode][name] ? winners[mode][name].value : null);
  const rows = [];

  for (const mode of MODES) {
    const look = get(mode);
    const colOf = name => parseColor(look(name), look);
    const hex = c => '#' + [c.r, c.g, c.b].map(n => n.toString(16).padStart(2, '0').toUpperCase()).join('');

    // (1) plain text tokens on the four base surfaces
    for (const t of TEXT_TOKENS) {
      for (const s of SURFACES) {
        const row = { id: mode + '|' + t + '|' + s, mode, token: t, surface: s,
                      threshold: AA_TEXT, role: 'text', normative: true };
        try {
          const bg = colOf(s);
          if (bg.a !== 1) throw new Error(s + ' is not opaque');
          const fg = composite(colOf(t), bg);
          row.tokenValue = look(t); row.surfaceValue = look(s);
          row.effective = hex(fg);
          row.ratio = contrast(fg, bg);
          row.pass = row.ratio >= row.threshold;      // full precision, never rounded first
        } catch (e) { row.error = e.message; row.pass = false; }   // fail closed
        rows.push(row);
      }
    }

    // (2) direction text on its own composited soft chip — normative at 4.5
    for (const p of SOFT_PAIRS) {
      for (const s of SURFACES) {
        const row = { id: mode + '|' + p.fg + '@' + p.fill + '|' + s, mode,
                      token: p.fg + ' on ' + p.fill, surface: s,
                      threshold: AA_TEXT, role: 'text-on-chip', normative: true };
        try {
          const base = colOf(s);
          if (base.a !== 1) throw new Error(s + ' is not opaque');
          const chip = composite(colOf(p.fill), base);
          const fg = composite(colOf(p.fg), chip);
          row.tokenValue = look(p.fg); row.surfaceValue = hex(chip) + ' (' + p.fill + '/' + s + ')';
          row.effective = hex(fg);
          row.ratio = contrast(fg, chip);
          row.pass = row.ratio >= row.threshold;
        } catch (e) { row.error = e.message; row.pass = false; }
        rows.push(row);
      }
    }

    // (3) the soft wash itself against its panel — INFORMATIONAL ONLY.
    //     A decorative tint is not a 1.4.11 object; recording it stops a future
    //     reader from mistaking "not asserted" for "not measured".
    for (const t of SOFT_TOKENS) {
      for (const s of SURFACES) {
        const row = { id: mode + '|' + t + '|' + s, mode, token: t, surface: s,
                      threshold: AA_NONTEXT, role: 'decorative tint', normative: false };
        try {
          const bg = colOf(s);
          const chip = composite(colOf(t), bg);
          row.tokenValue = look(t); row.surfaceValue = look(s);
          row.effective = hex(chip);
          row.ratio = contrast(chip, bg);
          row.pass = true;                             // not asserted
          row.advisory = row.ratio < AA_NONTEXT;
        } catch (e) { row.error = e.message; row.pass = false; }
        rows.push(row);
      }
    }
  }
  return { sha, rows, problems, winners };
}

/* --------------------------------------------------------------- canaries */

// Two planted cases that travel the exact same parse -> resolve -> compute path
// as the real assertions, injected as a synthetic artifact.
//   PASS: #000000 on #FFFFFF                = 21.0000
//   FAIL: #6C7B67 on #FFFFFF                =  4.49999958
// The failing canary is deliberately parked a hair under the threshold: the old
// gate rounded to 2dp before comparing, which turns 4.49999958 into 4.50 and
// passes it. If this canary ever reports a pass, the rounding fail-open is back.
const CANARY_ARTIFACT =
  '<style>:root{--canary-pass:#000000;--canary-fail:#6C7B67;--canary-surface:#FFFFFF;' +
  '--canary-gradient:linear-gradient(120deg,#00E5FF,#5B7CFF)}</style>';

function runCanaries() {
  const rules = parseRules(stylesheetText(CANARY_ARTIFACT));
  const { winners } = resolveTokens(rules);
  const look = n => (winners.night[n] ? winners.night[n].value : null);
  const results = [];

  for (const t of ['--canary-pass', '--canary-fail']) {
    const r = { token: t };
    try {
      const bg = parseColor(look('--canary-surface'), look);
      const fg = composite(parseColor(look(t), look), bg);
      r.ratio = contrast(fg, bg);
      r.pass = r.ratio >= AA_TEXT;
    } catch (e) { r.error = e.message; r.pass = false; }
    results.push(r);
  }

  // A third, uncounted probe: a non-colour token MUST raise, not silently
  // inherit something and report a flattering number. This is the exact defect
  // that let gate154 report 16.41 for a token that does not exist.
  let raised = false, sawValue = null;
  try { parseColor(look('--canary-gradient'), look); }
  catch (e) { raised = true; sawValue = e.message; }
  let missingRaised = false;
  try { parseColor(look('--canary-absent'), look); }
  catch (e) { missingRaised = true; }

  const passes = results.filter(r => r.pass).length;
  const fails = results.length - passes;
  return { results, passes, fails, gradientRaised: raised, gradientMsg: sawValue, missingRaised };
}

/* ------------------------------------------------------------------- main */

function fmt(n) { return (Math.round(n * 100) / 100).toFixed(2); }

function main(argv) {
  const file = argv[2] || path.join(__dirname, '..', 'dist', 'index.html');
  const failures = [];
  const note = s => console.log(s);

  note('== contrast gate · artifact: ' + file);

  // ---- control (a): canaries -------------------------------------------
  const can = runCanaries();
  for (const r of can.results) {
    note('   canary ' + r.token + ' -> ' + (r.error ? 'ERROR ' + r.error : fmt(r.ratio)) +
         ' (' + (r.pass ? 'pass' : 'fail') + ')');
  }
  if (can.passes !== 1 || can.fails !== 1) {
    console.error('\n  ✗✗ CANARY FAULT: expected exactly 1 pass and 1 failure, got ' +
      can.passes + ' pass / ' + can.fails + ' fail.');
    console.error('     The gate cannot detect a planted failure. Every contrast result in this');
    console.error('     build is unverified. Refusing to report a contrast pass.');
    process.exit(99);
  }
  if (!can.gradientRaised || !can.missingRaised) {
    console.error('\n  ✗✗ CANARY FAULT: a non-colour token (' +
      (can.gradientRaised ? '' : 'gradient ') + (can.missingRaised ? '' : 'undefined ') +
      ') did not raise. The checker is substituting a value instead of failing closed.');
    process.exit(99);
  }
  note('   canaries OK — 1 planted pass, 1 planted failure, non-colour tokens raise');

  // ---- control (b): recompute from artifact, twice, independently -------
  const A = computePass(file);
  const B = computePass(file);
  if (A.sha !== B.sha) {
    console.error('\n  ✗✗ ARTIFACT CHANGED MID-RUN (' + A.sha.slice(0, 12) + ' vs ' + B.sha.slice(0, 12) + ')');
    process.exit(99);
  }
  note('   artifact sha256 ' + A.sha.slice(0, 16) + '… (' + fs.statSync(file).size + ' B)');

  const byId = {};
  for (const r of B.rows) byId[r.id] = r;
  let drift = 0;
  for (const r of A.rows) {
    const b = byId[r.id];
    if (!b) { drift++; failures.push('recompute: row vanished on second pass: ' + r.id); continue; }
    const same = (r.error || null) === (b.error || null) &&
      (r.error ? true : Object.is(r.ratio, b.ratio)) && r.pass === b.pass;
    if (!same) {
      drift++;
      failures.push('recompute divergence ' + r.id + ': ' + (r.ratio) + ' vs ' + (b.ratio));
    }
  }
  if (drift) {
    console.error('\n  ✗✗ RECOMPUTE FAULT: ' + drift + ' assertion(s) did not reproduce from the artifact.');
    failures.slice(0, 5).forEach(f => console.error('     ' + f));
    process.exit(99);
  }
  note('   recompute OK — ' + A.rows.length + ' ratios reproduced from a second independent read');

  // ---- structural problems fail closed ---------------------------------
  for (const p of A.problems) {
    failures.push('unclassifiable token source (' + p.kind + '): ' + p.detail);
    console.log('  ✗ token declared by a source this checker will not silently ignore: ' +
      p.kind + ' — ' + p.detail);
  }

  // ---- the truth table --------------------------------------------------
  note('');
  note('   mode   token              value     surface                          ratio  need  verdict');
  const worst = {};
  let asserted = 0, advisories = 0;
  for (const r of A.rows) {
    const k = r.mode + ' ' + r.token;
    if (r.error) {
      note('  ✗ ' + r.mode.padEnd(6) + ' ' + r.token.padEnd(18) + ' ERROR on ' + r.surface + ': ' + r.error);
      failures.push(r.id + ': ' + r.error);
      worst[k] = { ratio: NaN, surface: r.surface };
      continue;
    }
    const mark = !r.normative ? (r.advisory ? '·!' : '· ') : (r.pass ? '✓ ' : '✗ ');
    const verdict = !r.normative
      ? 'info' + (r.advisory ? ' (below ' + r.threshold.toFixed(1) + ', not asserted — decorative)' : '')
      : (r.pass ? 'PASS' : 'FAIL (' + r.role + ')');
    note(' ' + mark + r.mode.padEnd(6) + ' ' + r.token.padEnd(18) + ' ' +
      String(r.tokenValue).padEnd(9) + ' ' + (r.surface + ' ' + r.surfaceValue).padEnd(32) + ' ' +
      fmt(r.ratio).padStart(6) + '  ' + r.threshold.toFixed(1) + '  ' + verdict);
    if (r.normative) {
      asserted++;
      if (!r.pass) failures.push(r.id + ' = ' + fmt(r.ratio) + ' < ' + r.threshold);
      if (!worst[k] || r.ratio < worst[k].ratio) worst[k] = { ratio: r.ratio, surface: r.surface };
    } else if (r.advisory) advisories++;
  }

  note('');
  note('   worst surface per asserted token');
  for (const k of Object.keys(worst)) {
    const w = worst[k];
    note('     ' + k.padEnd(28) + ' ' + (Number.isNaN(w.ratio) ? ' ERROR' : fmt(w.ratio).padStart(6)) +
      ' on ' + w.surface + '   ' + (w.ratio >= AA_TEXT ? 'PASS' : 'FAIL'));
  }

  note('');
  note('   ' + (asserted - failures.length) + ' passed · ' + failures.length + ' failed · ' +
    advisories + ' advisory (decorative, not asserted)');
  if (failures.length) {
    note('');
    note('   FAILURES');
    failures.forEach(f => note('     · ' + f));
  }
  return failures.length;
}

if (require.main === module) {
  try { process.exit(main(process.argv)); }
  catch (e) { console.error('gate-contrast: ' + (e && e.stack || e)); process.exit(99); }
}

module.exports = {
  parseColor, contrast, composite, luminance,
  stylesheetText, parseRules, resolveTokens, computePass, runCanaries,
  AA_TEXT, AA_NONTEXT, TEXT_TOKENS, SURFACES, SOFT_TOKENS
};
