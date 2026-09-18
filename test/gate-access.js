// DexLadder Access gate — layers/63-access.js, window.DLACCESS, v166.
//
//   node test/gate-access.js [dist/index.html]      exit code = number of failures
//
// Part A only. This Mac cannot run the Chromium gates, so everything here is done against the
// shipped payload AS TEXT plus the layer's own stylesheet on disk. That constrains what can be
// asserted, and the constraint is respected honestly: where a runtime behaviour is claimed, the
// gate re-implements the arithmetic INDEPENDENTLY from the published definition and checks the
// CONSTANTS the layer ships against its own result. It never calls the layer's code.
//
// The numeric oracles below are computed from the WCAG definition of relative luminance
// (https://www.w3.org/TR/WCAG22/#dfn-relative-luminance) and contrast ratio
// (https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio), re-implemented here from the formula:
//     lin(c) = c/255 <= 0.03928 ? (c/255)/12.92 : ((c/255+0.055)/1.055)^2.4
//     L      = 0.2126*lin(R) + 0.7152*lin(G) + 0.0722*lin(B)
//     ratio  = (Llighter + 0.05) / (Ldarker + 0.05)
// Worked by hand for the reference pairs:
//     #000000 on #ffffff -> L=0 and L=1          -> (1.05)/(0.05)              = 21 exactly
//     #767676 on #ffffff -> L(118,118,118)=0.181164244249860 -> 1.05/0.231164  = 4.542224959605
//     #595959 on #ffffff -> L(89,89,89)=0.099872 -> 1.05/0.149872              = 7.004729208036
//     #949494 on #000000 -> L(148,148,148)=0.296138270798 -> 0.346138/0.05     = 6.922765415966
'use strict';
const fs = require('fs'), path = require('path');
const WEB = path.join(__dirname, '..');
const file = process.argv[2] || path.join(WEB, 'dist', 'index.html');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 600) : '')); }
};
const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);

/* ------------------------------------------------------------ the gate's own arithmetic */
function lin(c) { c = c / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(hex) {
  const h = String(hex).replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function ratio(a, b) { const x = lum(a), y = lum(b); const hi = Math.max(x, y), lo = Math.min(x, y); return (hi + 0.05) / (lo + 0.05); }
function over(fgHex, alpha, bgHex) {          // source-over, opaque backdrop
  const p = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
  const f = p(fgHex), b = p(bgHex);
  const m = i => f[i] * alpha + b[i] * (1 - alpha);
  const hx = n => { const v = Math.round(Math.max(0, Math.min(255, n))).toString(16); return v.length < 2 ? '0' + v : v; };
  return '#' + hx(m(0)) + hx(m(1)) + hx(m(2));
}

/* ------------------------------------------------------------------- the payload */
console.log('A \u00b7 shipped payload');
const html = fs.readFileSync(file, 'utf8');

// build154.py wraps every layers/*.js in its own <script> block, so the layer's whole text can be
// lifted out of the payload and every "not in the layer" assert scoped to it exactly.
function layerOf(needle) {
  const parts = html.split('<script');
  for (let i = 1; i < parts.length; i++) {
    const end = parts[i].indexOf('</script');
    const body = end < 0 ? parts[i] : parts[i].slice(0, end);
    if (body.indexOf(needle) >= 0) return body;
  }
  return null;
}
const L = layerOf('window.DLACCESS') || layerOf('DLACCESS =') || '';
const CSSFILE = path.join(WEB, '_v166css', '63-access.css');
const CSS = fs.existsSync(CSSFILE) ? fs.readFileSync(CSSFILE, 'utf8') : '';

// A write to the paper account and nothing else (gate-desks.js:27's shape, tightened so that
// `S.bal.USDT ==`, `!=`, `<=` and `>=` are not read as assignments).
const BAL_WRITE = /S\.bal\s*(\[[^\]]{0,60}\]|\.[A-Za-z_$][\w$]*)\s*(\+|-|\*|\/|\|\||&&|\?\?)?=[^=]/;

/* ---------------------------------------------------------------- 1. house laws */

ok('access \u00b7 the layer ships in the payload exactly once (window.DLACCESS =, the house spelling)',
  (html.match(/window\.DLACCESS\s*=/g) || []).length === 1 && L.length > 4000,
  { assigns: (html.match(/window\.DLACCESS\s*=/g) || []).length, layerChars: L.length });

ok('access \u00b7 the layer declares its build in its own export (__v: 166) and exposes i18n on the same object, so the gate counts ONE global',
  /__v:\s*166\b/.test(L) && /\bi18n:\s*\{/.test(L) && (html.match(/window\.DL[A-Z0-9]+\s*=/g) || []).filter(s => /DLACCESS|DLI18N/.test(s)).length === 1,
  { v: (L.match(/__v:\s*\d+/g) || []).slice(0, 3), i18n: /\bi18n:\s*\{/.test(L) });

ok('access \u00b7 ES5 only \u2014 no arrow, no const/let, no template literal, no spread, anywhere in the layer',
  !/=>/.test(L) && !/\bconst\s/.test(L) && !/\blet\s/.test(L) && !/`/.test(L) && !/\.\.\./.test(L),
  { arrow: /=>/.test(L), constLet: /\b(const|let)\s/.test(L), tick: /`/.test(L), spread: /\.\.\./.test(L) });

ok('access \u00b7 nothing is compiled at runtime, no storage key of its own, no random source, and the paper account is never written',
  !/\beval\s*\(/.test(L) && !/new\s+Function\s*\(/.test(L) && !/\bset(Timeout|Interval)\s*\(\s*['"]/.test(L)
  && !/\blocalStorage\b/.test(L) && !/\bsessionStorage\b/.test(L)
  && !/Math\.random/.test(L) && !BAL_WRITE.test(L)
  && /\b(C|DLCORE)\.X\(\)/.test(L) && /\b(C|DLCORE)\.save\(\)/.test(L),
  { eval: /\beval\s*\(/.test(L), fn: /new\s+Function\s*\(/.test(L), ls: /\blocalStorage\b/.test(L), rand: /Math\.random/.test(L), bal: (L.match(BAL_WRITE) || [])[0] || null });

ok('access \u00b7 NO NETWORK PRIMITIVE \u2014 this layer reads the document it is already in and asks nothing of the wire',
  !/\bfetch\s*\(/.test(L) && !/XMLHttpRequest/.test(L) && !/\bWebSocket\b/.test(L) && !/EventSource/.test(L)
  && !/sendBeacon/.test(L) && !/\bjget\s*\(/.test(L) && !/\bimport\s*\(/.test(L) && !/navigator\.connection/.test(L),
  { fetch: /\bfetch\s*\(/.test(L), xhr: /XMLHttpRequest/.test(L), ws: /\bWebSocket\b/.test(L), jget: /\bjget\s*\(/.test(L) });

ok('access \u00b7 the honesty block ships, it names the automated-coverage limit, and it refuses the word certificate',
  /\bASSUMPTIONS\s*=/.test(L) && /\bMETHOD\s*=/.test(L)
  && /third of WCAG failures/i.test(L) && /floor/i.test(L) && /certificate/i.test(L)
  && /\bfloor, not a certificate\b/i.test(L),
  { a: /\bASSUMPTIONS\s*=/.test(L), m: /\bMETHOD\s*=/.test(L), third: /third of WCAG failures/i.test(L) });

ok('access \u00b7 everything the desk opens is torn down \u2014 __onClose removes the delegated listener, clears the timers and drops the highlight',
  /__onClose\s*=\s*function/.test(L) && /removeEventListener\s*\(\s*["']click["']/.test(L) && /clearTimeout/.test(L) && /clearHilite/.test(L),
  { onClose: /__onClose\s*=\s*function/.test(L), rm: /removeEventListener/.test(L), ct: /clearTimeout/.test(L) });

/* ------------------------------------------------- 2. the contrast maths, as oracles */

console.log('\nB \u00b7 numeric oracles \u2014 the formula, re-implemented here, against the constants the layer ships');

// O1 \u2014 the specification's own maximum.
ok('O1 \u00b7 contrast(#000000, #ffffff) is exactly 21 \u2014 (1+0.05)/(0+0.05), the largest ratio the formula can produce',
  ratio('#000000', '#ffffff') === 21, { got: ratio('#000000', '#ffffff') });

// O2/O3/O4 \u2014 hand-computed above from the relative-luminance definition.
ok('O2 \u00b7 contrast(#767676, #ffffff) = 4.542224959605 \u2014 the lightest neutral grey that still clears 4.5:1 on white',
  near(ratio('#767676', '#ffffff'), 4.542224959605253, 1e-9), { got: ratio('#767676', '#ffffff') });
ok('O3 \u00b7 contrast(#595959, #ffffff) = 7.004729208036 \u2014 the AAA pair, computed by hand from L(89,89,89) = 0.09987204',
  near(ratio('#595959', '#ffffff'), 7.004729208035935, 1e-9), { got: ratio('#595959', '#ffffff') });
ok('O4 \u00b7 contrast(#949494, #000000) = 6.922765415966 \u2014 computed by hand from L(148,148,148) = 0.29613827',
  near(ratio('#949494', '#000000'), 6.922765415966421, 1e-9), { got: ratio('#949494', '#000000') });

// O5 \u2014 tie the gate's arithmetic to the constants the layer actually ships.
const oracleRows = [];
{
  const m = L.match(/var ORACLE\s*=\s*\[([\s\S]{20,1400}?)\];/);
  const body = m ? m[1] : '';
  const re = /\[\s*"(#[0-9a-fA-F]{6})"\s*,\s*"(#[0-9a-fA-F]{6})"\s*,\s*([\d.]+)\s*,/g;
  let r;
  while ((r = re.exec(body)) !== null) oracleRows.push({ fg: r[1], bg: r[2], expected: parseFloat(r[3]) });
}
ok('O5 \u00b7 every pair in the layer\u2019s own ORACLE table reproduces this gate\u2019s independently computed ratio to 4 decimal places',
  oracleRows.length === 4 && oracleRows.every(r => near(ratio(r.fg, r.bg), r.expected, 5e-5)),
  oracleRows.map(r => ({ pair: r.fg + '/' + r.bg, shipped: r.expected, gate: +ratio(r.fg, r.bg).toFixed(6) })));

// O6 \u2014 the endpoints of relative luminance.
ok('O6 \u00b7 relative luminance is 1 for #ffffff and 0 for #000000, and the layer carries the specification\u2019s exact constants',
  lum('#ffffff') === 1 && lum('#000000') === 0
  && /0\.2126/.test(L) && /0\.7152/.test(L) && /0\.0722/.test(L) && /0\.03928/.test(L) && /12\.92/.test(L) && /1\.055/.test(L) && /2\.4/.test(L) && /\+\s*0\.05/.test(L),
  { white: lum('#ffffff'), black: lum('#000000'), consts: ['0.2126', '0.7152', '0.0722', '0.03928', '12.92', '1.055'].map(c => L.indexOf(c) >= 0) });

// O7 \u2014 invariants over a deterministic sweep (no random: a fixed 8x8 grey grid).
{
  let bad = null, n = 0;
  for (let i = 0; i < 256; i += 36) {
    for (let j = 0; j < 256; j += 36) {
      const hx = v => (v.toString(16).length < 2 ? '0' : '') + v.toString(16);
      const A = '#' + hx(i) + hx(i) + hx(i), B = '#' + hx(j) + hx(j) + hx(j);
      const r1 = ratio(A, B), r2 = ratio(B, A);
      n++;
      if (!(r1 >= 1 - 1e-12 && r1 <= 21 + 1e-12 && Math.abs(r1 - r2) < 1e-12)) bad = { A, B, r1, r2 };
    }
  }
  ok('O7 \u00b7 the ratio is symmetric and bounded to [1, 21] across a 64-pair deterministic grey sweep',
    bad === null && n === 64, { pairs: n, bad });
}

// O8 \u2014 source-over compositing, which is what makes a token wash measurable at all.
{
  const half = over('#ffffff', 0.5, '#000000');      // 127.5 -> #808080
  const wash = over('#ffffff', 0.035, '#0b1426');    // the shape of the app's own card wash
  ok('O8 \u00b7 source-over compositing: white at 50% over black resolves to #808080 and gives 3.9494396480:1 against white, and the layer composites with the same expression',
    half === '#808080' && near(ratio(half, '#ffffff'), 3.9494396480491156, 1e-9)
    && /f\s*\*\s*fg\.a\s*\+\s*b\s*\*\s*\(1\s*-\s*fg\.a\)/.test(L),
    { half, ratio: ratio(half, '#ffffff'), wash, expr: /f\s*\*\s*fg\.a\s*\+\s*b\s*\*\s*\(1\s*-\s*fg\.a\)/.test(L) });
}

// O9 \u2014 the large-text boundary the layer uses to pick 3:1 instead of 4.5:1.
{
  const large = (px, wt) => px >= 24 || (px >= 18.66 && wt >= 700);
  ok('O9 \u00b7 the large-text boundary is 24px, or 18.66px at weight 700 \u2014 18.5px bold is NOT large, and the layer ships those exact numbers',
    large(24, 400) === true && large(23.9, 400) === false && large(18.66, 700) === true
    && large(18.5, 700) === false && large(19, 600) === false
    && /px\s*>=\s*24\s*\|\|\s*\(px\s*>=\s*18\.66\s*&&\s*wt\s*>=\s*700\)/.test(L) && /large\s*\?\s*3\s*:\s*4\.5/.test(L),
    { shipped: /px\s*>=\s*24\s*\|\|\s*\(px\s*>=\s*18\.66\s*&&\s*wt\s*>=\s*700\)/.test(L), thr: /large\s*\?\s*3\s*:\s*4\.5/.test(L) });
}

/* ------------------------------------------------ 3. the success criteria are real ones */

console.log('\nC \u00b7 the criteria');

// Every success criterion in WCAG 2.2 (86 of them: WCAG 2.1's 78, plus the nine added in 2.2,
// minus 4.1.1 Parsing, which 2.2 removed). https://www.w3.org/TR/WCAG22/
const WCAG22 = new Set(('1.1.1 1.2.1 1.2.2 1.2.3 1.2.4 1.2.5 1.2.6 1.2.7 1.2.8 1.2.9 ' +
  '1.3.1 1.3.2 1.3.3 1.3.4 1.3.5 1.3.6 ' +
  '1.4.1 1.4.2 1.4.3 1.4.4 1.4.5 1.4.6 1.4.7 1.4.8 1.4.9 1.4.10 1.4.11 1.4.12 1.4.13 ' +
  '2.1.1 2.1.2 2.1.3 2.1.4 2.2.1 2.2.2 2.2.3 2.2.4 2.2.5 2.2.6 2.3.1 2.3.2 2.3.3 ' +
  '2.4.1 2.4.2 2.4.3 2.4.4 2.4.5 2.4.6 2.4.7 2.4.8 2.4.9 2.4.10 2.4.11 2.4.12 2.4.13 ' +
  '2.5.1 2.5.2 2.5.3 2.5.4 2.5.5 2.5.6 2.5.7 2.5.8 ' +
  '3.1.1 3.1.2 3.1.3 3.1.4 3.1.5 3.1.6 3.2.1 3.2.2 3.2.3 3.2.4 3.2.5 3.2.6 ' +
  '3.3.1 3.3.2 3.3.3 3.3.4 3.3.5 3.3.6 3.3.7 3.3.8 3.3.9 4.1.2 4.1.3').split(' '));

const scRows = [];
{
  const m = L.match(/var SC\s*=\s*\[([\s\S]{200,6000}?)\n\s*\];/);
  const body = m ? m[1] : '';
  const re = /\{\s*id:\s*"([\d.]+)"\s*,\s*name:\s*"([^"]+)"\s*,\s*level:\s*"([A]{1,3})"\s*,\s*since:\s*"([\d.]+)"/g;
  let r;
  while ((r = re.exec(body)) !== null) scRows.push({ id: r[1], name: r[2], level: r[3], since: r[4] });
}

ok('O10 \u00b7 WCAG22 reference set is the 86 criteria of WCAG 2.2, and the removed 4.1.1 Parsing is not in it',
  WCAG22.size === 86 && !WCAG22.has('4.1.1') && WCAG22.has('2.4.11') && WCAG22.has('2.5.8') && WCAG22.has('4.1.2'),
  { size: WCAG22.size });

ok('O11 \u00b7 every success criterion the panel reports is a real WCAG 2.2 identifier, and it reports at least nine of them',
  scRows.length >= 9 && scRows.every(r => WCAG22.has(r.id)),
  { n: scRows.length, ids: scRows.map(r => r.id), unknown: scRows.filter(r => !WCAG22.has(r.id)).map(r => r.id) });

ok('O12 \u00b7 2.4.11 Focus Not Obscured (Minimum) and 2.5.8 Target Size (Minimum) are both reported and both LABELLED as additions in WCAG 2.2',
  ['2.4.11', '2.5.8'].every(id => {
    const r = scRows.filter(x => x.id === id)[0];
    return r && r.since === '2.2' && r.level === 'AA';
  }) && /isNew22/.test(L) && /new in WCAG 2\.2/.test(L),
  { rows: scRows.filter(r => r.since === '2.2'), flag: /isNew22/.test(L) });

ok('O13 \u00b7 the panel does not report 4.1.1 Parsing, which WCAG 2.2 removed, and it labels 2.3.3 as the AAA criterion it is rather than counting it towards AA',
  !scRows.some(r => r.id === '4.1.1')
  && (scRows.filter(r => r.id === '2.3.3')[0] || {}).level === 'AAA'
  && /excluded from the AA tally/i.test(L) && /r\.level === "A" \|\| r\.level === "AA"/.test(L),
  { has411: scRows.some(r => r.id === '4.1.1'), lvl233: (scRows.filter(r => r.id === '2.3.3')[0] || {}).level });

ok('O14 \u00b7 every criterion comes back pass / fail / not-applicable with the count it was measured over, and the desk never claims the page is accessible',
  /status:\s*status/.test(L) && /"not-applicable"/.test(L) && /checked:\s*checked/.test(L)
  && /count:\s*\(fails \|\| \[\]\)\.length/.test(L)
  && /is not the same sentence/.test(L) && !/\bthis page is accessible\b(?![^\n]*not)/.test(L.replace(/\\u201c[^\\]*?\\u201d/g, '')),
  { shape: /status:\s*status/.test(L), na: /"not-applicable"/.test(L) });

ok('O15 \u00b7 2.5.8 is measured at 24 by 24 CSS pixels and its spacing exception uses a 24 pixel circle, not a guess',
  /w >= 24 - 1e-6 && h >= 24 - 1e-6/.test(L) && /Math\.sqrt\(dx \* dx \+ dy \* dy\) < 24/.test(L)
  && /min-block-size:\s*24px/.test(CSS) && /min-inline-size:\s*24px/.test(CSS),
  { js24: /w >= 24 - 1e-6/.test(L), circle: /< 24/.test(L), css: /min-block-size:\s*24px/.test(CSS) });

/* ------------------------------------------------------------------ 4. i18n */

console.log('\nD \u00b7 i18n');

function tableKeys(tag) {
  const start = L.indexOf('STR.' + tag + ' = {');
  if (start < 0) return null;
  const end = L.indexOf('\n  };', start);
  if (end < 0) return null;
  const body = L.slice(start, end);
  const out = [];
  const re = /^\s{4}"([\w.\-]+)":\s*"/gm;
  let m;
  while ((m = re.exec(body)) !== null) out.push(m[1]);
  return out;
}
const EN = tableKeys('en') || [], HI = tableKeys('hi') || [], ES = tableKeys('es') || [], AR = tableKeys('ar') || [];
const declared = {};
{
  const m = L.match(/var COVERAGE\s*=\s*\{([^}]*)\}/);
  if (m) m[1].split(',').forEach(bit => {
    const p = bit.split(':');
    if (p.length === 2) declared[p[0].trim()] = parseFloat(p[1]);
  });
}
const pctOf = list => EN.length ? (list.filter(k => EN.indexOf(k) >= 0).length / EN.length * 100) : null;

ok('O16 \u00b7 the English table is complete and is the base every other language is counted against',
  EN.length >= 50 && new Set(EN).size === EN.length && declared.en === 100,
  { en: EN.length, unique: new Set(EN).size, declaredEn: declared.en });

ok('O17 \u00b7 the coverage percentage the layer declares matches the one recomputed from the tables, for every language, to 0.1 of a point',
  ['hi', 'es', 'ar'].every(tag => {
    const list = tag === 'hi' ? HI : tag === 'es' ? ES : AR;
    const p = pctOf(list);
    return p != null && declared[tag] != null && Math.abs(p - declared[tag]) <= 0.06;
  }),
  { hi: { n: HI.length, pct: +pctOf(HI).toFixed(2), declared: declared.hi },
    es: { n: ES.length, pct: +pctOf(ES).toFixed(2), declared: declared.es },
    ar: { n: AR.length, pct: +pctOf(AR).toFixed(2), declared: declared.ar } });

ok('O18 \u00b7 no language table carries a key English does not have \u2014 an orphan key is coverage that counts nothing',
  [HI, ES, AR].every(list => list.every(k => EN.indexOf(k) >= 0)),
  { hiOrphans: HI.filter(k => EN.indexOf(k) < 0), esOrphans: ES.filter(k => EN.indexOf(k) < 0), arOrphans: AR.filter(k => EN.indexOf(k) < 0) });

ok('O19 \u00b7 Spanish is complete, Hindi and Arabic are honestly incomplete, and the incompleteness is SHOWN rather than padded with filler',
  Math.abs(pctOf(ES) - 100) < 1e-9 && pctOf(HI) > 50 && pctOf(HI) < 100 && pctOf(AR) > 20 && pctOf(AR) < 100
  && /missingKeys/.test(L) && /lang\.mark/.test(L),
  { es: +pctOf(ES).toFixed(1), hi: +pctOf(HI).toFixed(1), ar: +pctOf(AR).toFixed(1) });

// The fallback chain: re-implemented here from the documented rule, then checked against the
// expression the layer ships. A key that exists nowhere must come back as the KEY, not undefined.
{
  const chain = tag => {
    const t0 = String(tag || 'en'), b = t0.split('-')[0].toLowerCase(), out = [];
    if (t0) out.push(t0);
    if (b && b !== t0) out.push(b);
    if (out.indexOf('en') < 0) out.push('en');
    out.push('\u27E6key\u27E7');
    return out;
  };
  const tables = { en: EN, hi: HI, es: ES, ar: AR };
  const resolve = (key, tag) => {
    const ch = chain(tag);
    for (let i = 0; i < ch.length - 1; i++) if ((tables[ch[i]] || []).indexOf(key) >= 0) return { from: ch[i], value: key };
    return { from: null, value: '\u27E6' + key + '\u27E7' };
  };
  const cMX = chain('es-MX');
  const missing = resolve('no.such.key.anywhere', 'hi');
  const hiFall = resolve(HI.length ? EN.filter(k => HI.indexOf(k) < 0)[0] : 'x', 'hi');
  ok('O20 \u00b7 the fallback chain is requested \u2192 base language \u2192 English \u2192 the key itself: es-MX resolves through es then en, a Hindi hole lands on English, and a key that exists nowhere comes back AS THE KEY, never undefined',
    cMX.length === 4 && cMX[0] === 'es-MX' && cMX[1] === 'es' && cMX[2] === 'en'
    && missing.from === null && missing.value === '\u27E6no.such.key.anywhere\u27E7' && missing.value !== undefined
    && hiFall.from === 'en'
    && /\("\u27E6" \+ key \+ "\u27E7"\)/.test(L) && /if \(indexOf\(out, "en"\) < 0\) out\.push\("en"\)/.test(L),
    { chain: cMX, missing, hiFall, shipped: /\("\u27E6" \+ key \+ "\u27E7"\)/.test(L) });
}

ok('O21 \u00b7 number, date, relative time and currency all go through Intl in the chosen locale \u2014 there is no separator table, month list or currency-symbol map in the layer',
  /new Intl\.NumberFormat/.test(L) && /new Intl\.DateTimeFormat/.test(L) && /new Intl\.RelativeTimeFormat/.test(L)
  && /style:\s*"currency"/.test(L)
  && !/Jan(uary)?["'],\s*["']Feb/.test(L) && !/thousandsSeparator/.test(L),
  { num: /new Intl\.NumberFormat/.test(L), date: /new Intl\.DateTimeFormat/.test(L), rel: /new Intl\.RelativeTimeFormat/.test(L) });

ok('O22 \u00b7 right to left is real \u2014 Arabic declares dir rtl, the desk sets dir on itself, and the stylesheet names NO physical side and defines NO token',
  /native:\s*"[^"]+",\s*dir:\s*"rtl"/.test(L) && /setAttribute\("dir"/.test(L)
  && CSS.length > 2000
  && !/\b(left|right)\b/.test(CSS)
  && !/(^|[\s;{])(?:margin|padding|border|inset|scroll-margin|scroll-padding)-(?:left|right)\s*:/.test(CSS)
  && !/:root/.test(CSS)
  && /border-inline-start/.test(CSS) && /padding-inline-start/.test(CSS) && /text-align:\s*start/.test(CSS),
  { rtlLang: /dir:\s*"rtl"/.test(L), cssChars: CSS.length, physical: (CSS.match(/\b(left|right)\b/g) || []).slice(0, 5), root: /:root/.test(CSS) });

/* ---------------------------------------------------------------- 5. measurement, not assertion */

console.log('\nE \u00b7 measurement');

ok('O23 \u00b7 the audit MEASURES the rendered DOM \u2014 computed style, bounding boxes and hit testing \u2014 rather than reading the stylesheet and guessing which selector won',
  /getComputedStyle/.test(L) && /getBoundingClientRect/.test(L) && /elementFromPoint/.test(L) && /scrollHeight/.test(L),
  { cs: /getComputedStyle/.test(L), rect: /getBoundingClientRect/.test(L), efp: /elementFromPoint/.test(L) });

ok('O24 \u00b7 a colour that cannot be resolved is reported UNRESOLVED, never given a number \u2014 and a token wash IS resolved, by compositing the stack down to the first opaque layer',
  /unresolved:\s*true/.test(L) && /gradient or image/i.test(L) && /unresolved\+\+|unresolved\s*\+\+/.test(L)
  && /composite\(stack\[i\], out\)/.test(L),
  { unresolved: /unresolved:\s*true/.test(L), composite: /composite\(stack\[i\], out\)/.test(L) });

ok('O25 \u00b7 the keyboard map is SCANNED out of the payload\u2019s own script text, not typed \u2014 and the layer carries no hand-written shortcut list',
  /getElementsByTagName\("script"\)/.test(L) && /scanShortcuts/.test(L) && /KEY_RE/.test(L)
  && !/"Cmd\+K"/.test(L) && !/\u2318K/.test(L),
  { scan: /scanShortcuts/.test(L), scripts: /getElementsByTagName\("script"\)/.test(L) });

ok('O26 \u00b7 the desk stops painting while it measures, so the pass measures the page rather than the dialog covering it',
  /dla-auditing/.test(L) && /html\.dla-auditing \.dls\.on\s*\{\s*visibility:\s*hidden/.test(CSS) && /inDesk/.test(L),
  { cls: /dla-auditing/.test(L), css: /dla-auditing/.test(CSS) });

console.log('\n' + pass + ' passed \u00b7 ' + fail + ' failed');
process.exit(fail);
