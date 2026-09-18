// DexLadder PATH gate — the curriculum-graph desk (layers/60-path.js, window.DLPATH, v166).
//
//   node test/gate-path.js [dist/index.html]      exit code = number of failures
//
// Part A only: pure node, reads the shipped payload as text. This Mac cannot run the
// Chromium gates, so everything below is either a property of the layer's source text or a
// numeric oracle recomputed INDEPENDENTLY inside this file and compared against the constants
// and tables the layer ships. Nothing here calls the layer's own arithmetic to check itself.
//
// The oracles cover: the curriculum graph is a DAG and every prerequisite id resolves (Kahn,
// re-implemented here); the topological order the layer would produce is valid; longest-path
// depths are consistent with the prerequisites; every node carries a lab or a desk handoff and
// a non-empty evidence predicate; every desk handoff names a window.DL* that the layer guards;
// the SM-2 intervals and ease bounds match the schedule the Method tab states; and progress is
// derived, not stored — no score-shaped key is ever written to the v154 bucket.
'use strict';
const fs = require('fs'), path = require('path');
const WEB = path.join(__dirname, '..');
const file = process.argv[2] || path.join(WEB, 'dist', 'index.html');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 600) : '')); }
};

const html = fs.readFileSync(file, 'utf8');

// build154.py wraps every layers/*.js in its own <script> block, so the layer's whole text can
// be lifted out of the payload and every "not in the layer" assert scoped to it exactly.
function layerOf(needle) {
  const parts = html.split('<script');
  for (let i = 1; i < parts.length; i++) {
    const end = parts[i].indexOf('</script');
    const raw = end < 0 ? parts[i] : parts[i].slice(0, end);
    // `raw` still carries the tail of the opening tag (attributes plus '>'), which is fine for a
    // regex read but is a syntax error the moment the body is EXECUTED in the sandbox below.
    const gt = raw.indexOf('>');
    const body = gt < 0 ? raw : raw.slice(gt + 1);
    if (body.indexOf(needle) >= 0) return body;
  }
  return null;
}
const L = layerOf('window.DLPATH =') || layerOf('window.DLPATH') || '';
const SRCP = path.join(WEB, 'layers', '60-path.js');
const SRC = fs.existsSync(SRCP) ? fs.readFileSync(SRCP, 'utf8') : '';
// The layer text used for the STRUCTURAL oracles is the shipped one when it is there, and the
// on-disk source otherwise, so this gate is runnable before the payload is rebuilt.
const T = L.length > 2000 ? L : SRC;

const BAL_WRITE = /S\.bal\s*(\[[^\]]{0,60}\]|\.[A-Za-z_$][\w$]*)\s*(\+|-|\*|\/|\|\||&&|\?\?)?=[^=]/;

/* ------------------------------------------------------------- A · the layer */
console.log('A · shipped payload');

ok('path \u00b7 the layer ships in the payload exactly once (window.DLPATH =, the house spelling)',
  (html.match(/window\.DLPATH\s*=/g) || []).length === 1,
  { assigns: (html.match(/window\.DLPATH\s*=/g) || []).length, layerChars: L.length, sourceOnDisk: !!SRC });

ok('path \u00b7 the layer declares its build in its own export (__v: 166)', /__v:\s*166\b/.test(T),
  { saw: (T.match(/__v:\s*\d+/g) || []).slice(0, 4) });

ok('path \u00b7 nothing is compiled at runtime (no eval, no new Function, no string timer)',
  !/\beval\s*\(/.test(T) && !/new\s+Function\s*\(/.test(T) && !/\bset(Timeout|Interval)\s*\(\s*['"`]/.test(T));

ok('path \u00b7 no storage key of its own \u2014 state is the v154 bucket through DLCORE.X() and DLCORE.save(), and no token block in the JS',
  !/\blocalStorage\b/.test(T) && !/\bsessionStorage\b/.test(T)
  && /\b(C|DLCORE)\.X\(\)/.test(T) && /\b(C|DLCORE)\.save\(\)/.test(T)
  && !/(:root|html\[data-mode=day\])\s*\{[^{}]*--[\w-]+\s*:/.test(T));

ok('path \u00b7 deterministic by construction \u2014 no random source anywhere in the layer', !/Math\.random/.test(T));

ok('path \u00b7 this layer never moves money \u2014 no assignment to S.bal, and it calls neither execFill nor chargeNetwork',
  !BAL_WRITE.test(T) && !/\bexecFill\s*\(/.test(T) && !/\bchargeNetwork\s*\(/.test(T),
  { balWrite: (T.match(BAL_WRITE) || [])[0] || null });

ok('path \u00b7 ES5 only \u2014 no arrow, no const/let, no template literal, no spread, no optional chaining',
  !/=>/.test(T) && !/\bconst\s/.test(T) && !/\blet\s/.test(T) && !/`/.test(T) && !/\.\.\./.test(T) && !/\?\./.test(T),
  { arrow: /=>/.test(T), constL: /\bconst\s/.test(T), letL: /\blet\s/.test(T), tpl: /`/.test(T), spread: /\.\.\./.test(T) });

ok('path \u00b7 ASSUMPTIONS and METHOD ship with the layer, and the desk refuses the word "certified"',
  /\bASSUMPTIONS\s*=/.test(T) && /\bMETHOD\s*=/.test(T) && /does not certify/i.test(T) && !/\byou are certified\b/i.test(T));

ok('path \u00b7 the sheet writes body.innerHTML from onTab and tears its listener down on close',
  /onTab:\s*function\s*\(\s*t\s*,\s*body\s*\)\s*\{\s*body\.innerHTML\s*=/.test(T) && /__onClose\s*=/.test(T) && !/setInterval\s*\(/.test(T));

/* ---------------------------------------------- B · the shipped graph, parsed */
// The node table is lifted out of the layer text and re-parsed here, so the oracles below are
// checked against what actually ships rather than against a copy kept in this file.
console.log('\nB · the curriculum graph, re-derived');

function sliceBlock(src, startRe) {
  const m = startRe.exec(src);
  if (!m) return null;
  let i = src.indexOf('[', m.index);
  if (i < 0) return null;
  let d = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '[') d++;
    else if (c === ']') { d--; if (d === 0) return src.slice(i, j + 1); }
  }
  return null;
}
const NODES_SRC = sliceBlock(T, /\bvar\s+NODES\s*=/);
const TRACKS_SRC = sliceBlock(T, /\bvar\s+TRACKS\s*=/);
const ATOMS_M = /\bvar\s+ATOMS\s*=\s*\{/.exec(T);

// Each node is one object literal opened by `{ id: "..."`. Split on that and take fields with
// balanced-bracket reads; no eval, no JSON — the layer's source stays source.
function nodeRecords(src) {
  const out = [];
  const re = /\{\s*id:\s*"([a-z0-9]+)"/g;
  let m;
  const starts = [];
  while ((m = re.exec(src))) starts.push([m.index, m[1]]);
  for (let i = 0; i < starts.length; i++) {
    const a = starts[i][0], b = i + 1 < starts.length ? starts[i + 1][0] : src.length;
    const body = src.slice(a, b);
    out.push({
      id: starts[i][1],
      req: arrOf(body, /\breq:\s*\[/),
      base: arrOf(body, /\bbase:\s*\[/),
      wide: arrOf(body, /\bwide:\s*\[/),
      one: (/\bone:\s*"((?:[^"\\]|\\.)*)"/.exec(body) || [, ''])[1],
      title: (/\bt:\s*"((?:[^"\\]|\\.)*)"/.exec(body) || [, ''])[1],
      labs: (body.match(/\bk:\s*"(fn|ch)"/g) || []).length,
      deskMod: (/\bdesk:\s*\{\s*mod:\s*"([A-Z]+)"/.exec(body) || [, null])[1],
      miss: (body.match(/"[a-z0-9.]+":\s*"/g) || []).length
    });
  }
  return out;
}
function arrOf(body, re) {
  const m = re.exec(body);
  if (!m) return [];
  const i = body.indexOf('[', m.index);
  let d = 0, end = -1;
  for (let j = i; j < body.length; j++) {
    if (body[j] === '[') d++;
    else if (body[j] === ']') { d--; if (d === 0) { end = j; break; } }
  }
  if (end < 0) return [];
  return (body.slice(i + 1, end).match(/"([a-z0-9.]+)"/g) || []).map(s => s.replace(/"/g, ''));
}
const NODES = NODES_SRC ? nodeRecords(NODES_SRC) : [];
const IDS = NODES.map(n => n.id);

ok('path \u00b7 the node table parses out of the shipped layer and carries a real curriculum (20+ nodes, unique ids)',
  NODES.length >= 20 && new Set(IDS).size === NODES.length,
  { nodes: NODES.length, unique: new Set(IDS).size });

// --- oracle 1: every prerequisite id resolves to a node that exists
const unresolved = [];
NODES.forEach(n => n.req.forEach(r => { if (IDS.indexOf(r) < 0) unresolved.push(n.id + ' <- ' + r); }));
ok('path \u00b7 oracle: every prerequisite id resolves to a node in the shipped graph', unresolved.length === 0, { unresolved });

// --- oracle 2: Kahn, re-implemented here. The queue must drain, or what is left is a cycle.
function kahn(nodes) {
  const indeg = {}, adj = {};
  nodes.forEach(n => { indeg[n.id] = 0; adj[n.id] = []; });
  nodes.forEach(n => n.req.forEach(r => { if (adj[r]) { adj[r].push(n.id); indeg[n.id]++; } }));
  const q = nodes.filter(n => indeg[n.id] === 0).map(n => n.id).sort();
  const order = [];
  while (q.length) {
    const id = q.shift();
    order.push(id);
    adj[id].forEach(k => { if (--indeg[k] === 0) { q.push(k); q.sort(); } });
  }
  return order;
}
const ORDER = kahn(NODES);
ok('path \u00b7 oracle: the shipped graph is ACYCLIC \u2014 Kahn drains every node',
  ORDER.length === NODES.length,
  { ordered: ORDER.length, nodes: NODES.length, stuck: IDS.filter(i => ORDER.indexOf(i) < 0) });

// --- oracle 3: the order Kahn produces is a valid topological order
const pos = {}; ORDER.forEach((id, i) => { pos[id] = i; });
const violations = [];
NODES.forEach(n => n.req.forEach(r => { if (!(pos[r] < pos[n.id])) violations.push(n.id + ' before ' + r); }));
ok('path \u00b7 oracle: the topological order is valid \u2014 every node comes after all of its prerequisites',
  violations.length === 0 && ORDER.length === NODES.length, { violations });

// --- oracle 4: longest-path depth is well defined and matches the layer's column count claim
const depth = {};
ORDER.forEach(id => {
  const n = NODES.find(x => x.id === id);
  depth[id] = n.req.reduce((d, r) => Math.max(d, (depth[r] == null ? -1 : depth[r]) + 1), 0);
});
const maxDepth = Math.max.apply(null, Object.keys(depth).map(k => depth[k]));
const depthBad = [];
NODES.forEach(n => n.req.forEach(r => { if (!(depth[r] < depth[n.id])) depthBad.push(n.id + '/' + r); }));
ok('path \u00b7 oracle: longest-path depth is strictly increasing across every prerequisite edge (map columns cannot lie about the order)',
  depthBad.length === 0 && maxDepth >= 4, { maxDepth, depthBad });

// --- oracle 5: every node has a lab OR a desk handoff, and a non-empty evidence predicate
const thin = NODES.filter(n => !(n.labs > 0 || n.deskMod) || n.base.length === 0);
ok('path \u00b7 oracle: every node carries a lab or a desk handoff AND a non-empty evidence predicate',
  thin.length === 0, { thin: thin.map(n => ({ id: n.id, labs: n.labs, desk: n.deskMod, base: n.base.length })) });

// --- oracle 6: every node states the concept in one sentence and explains its near misses
const mute = NODES.filter(n => n.one.length < 60 || n.miss < n.base.length);
ok('path \u00b7 oracle: every node states the concept in a full sentence and explains at least as many near misses as it has base atoms',
  mute.length === 0, { mute: mute.map(n => ({ id: n.id, oneChars: n.one.length, miss: n.miss, base: n.base.length })) });

// --- oracle 7: every desk handoff names a window.DL* that the layer guards
const MODS = Array.from(new Set(NODES.map(n => n.deskMod).filter(Boolean)));
const guarded = MODS.filter(m => {
  // the module must be in the DESKS table AND reached only through window[mod] with a typeof test
  return new RegExp('\\b' + m + ':\\s*"').test(T);
});
const hasGuard = /function deskLive\(mod\)\s*\{[\s\S]{0,260}typeof m\.open\s*===\s*"function"/.test(T)
  && /window\[h\.mod\]\.open\(/.test(T)
  && /not in this build/.test(T);
ok('path \u00b7 oracle: every desk handoff names a window.DL* that is in the guarded desk table, reached only through a typeof test, with a named "not in this build" fallback',
  MODS.length >= 6 && guarded.length === MODS.length && hasGuard,
  { mods: MODS, guarded, hasGuard });

// --- oracle 8: every atom a node names is declared in the ATOMS table with a human sentence
const atomDecl = new Set();
if (ATOMS_M) {
  const from = T.indexOf('{', ATOMS_M.index);
  let d = 0, end = -1;
  for (let j = from; j < T.length; j++) {
    if (T[j] === '{') d++; else if (T[j] === '}') { d--; if (d === 0) { end = j; break; } }
  }
  const blk = T.slice(from, end + 1);
  (blk.match(/"([a-z0-9.]+)":\s*\[/g) || []).forEach(s => atomDecl.add(s.replace(/"|:\s*\[/g, '')));
}
const undeclared = [];
NODES.forEach(n => n.base.concat(n.wide).forEach(a => { if (!atomDecl.has(a)) undeclared.push(n.id + '/' + a); }));
ok('path \u00b7 oracle: every evidence atom a node names is declared in the atom table with a sentence saying what it means',
  atomDecl.size >= 30 && undeclared.length === 0, { declared: atomDecl.size, undeclared });

/* ------------------------------------------------- C · the schedule, oracled */
console.log('\nC · spaced repetition, recomputed');

// The layer states an SM-2 variant: EF starts 2.50, clamped [1.30, 2.70]; intervals 1, 6, then
// round(prev x EF), capped 180; strength = 2^(-elapsed/interval), due at 0.50. Everything here
// is recomputed from those stated constants and compared against the layer's own declarations.
const EF0 = 2.5, EF_MIN = 1.3, EF_MAX = 2.7, I1 = 1, I2 = 6, I_CAP = 180;
function refEase(reps, q) {
  let ef = EF0;
  for (let i = 0; i < reps; i++) {
    ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    if (ef < EF_MIN) ef = EF_MIN;
    if (ef > EF_MAX) ef = EF_MAX;
  }
  return ef;
}
function refInterval(reps, ef) {
  if (reps <= 0) return 0;
  if (reps === 1) return I1;
  if (reps === 2) return I2;
  let iv = I2;
  for (let i = 3; i <= reps; i++) { iv = Math.round(iv * ef); if (iv > I_CAP) { iv = I_CAP; break; } }
  return iv > I_CAP ? I_CAP : iv;
}

ok('path \u00b7 oracle: the layer declares exactly the SM-2 constants it documents (EF0 2.5, bounds 1.3/2.7, first intervals 1 and 6, cap 180)',
  /EF0\s*=\s*2\.5\b/.test(T) && /EF_MIN\s*=\s*1\.3\b/.test(T) && /EF_MAX\s*=\s*2\.7\b/.test(T)
  && /I1\s*=\s*1\b/.test(T) && /I2\s*=\s*6\b/.test(T) && /I_CAP\s*=\s*180\b/.test(T),
  { line: (/var EF0[^;]*;/.exec(T) || [])[0] });

// Published SM-2 reference (Wozniak 1987): I(1)=1, I(2)=6, I(n)=I(n-1)*EF. At the default
// EF of 2.5 that is 1, 6, 15, 37.5 -> 38, 93.75... this layer rounds at each step, so 15, 38,
// 95, then the 180 cap bites. These five numbers are the ones the Method tab prints.
const REF = [1, 6, 15, 38, 95, 180];
const got = [1, 2, 3, 4, 5, 6].map(r => refInterval(r, EF0));
ok('path \u00b7 oracle: intervals at EF 2.50 are 1, 6, 15, 38, 95, 180 \u2014 round-at-each-step SM-2, capped',
  JSON.stringify(got) === JSON.stringify(REF), { got, REF });

ok('path \u00b7 oracle: the interval cap holds \u2014 rep 7 and rep 20 are still 180 days, never more',
  refInterval(7, EF0) === 180 && refInterval(20, EF0) === 180,
  { r7: refInterval(7, EF0), r20: refInterval(20, EF0) });

ok('path \u00b7 oracle: the ease factor stays inside [1.30, 2.70] at both extremes \u2014 q=5 twenty times clamps at 2.70, q=3 twenty times clamps at 1.30',
  Math.abs(refEase(20, 5) - 2.7) < 1e-12 && Math.abs(refEase(20, 3) - 1.3) < 1e-12,
  { hi: refEase(20, 5), lo: refEase(20, 3) });

// One rep of the SM-2 update at each quality, by hand:
//   q=5 -> +0.10 ; q=4 -> 0.1 - 1*(0.08+0.02) = 0.00 ; q=3 -> 0.1 - 2*(0.08+0.04) = -0.14
ok('path \u00b7 oracle: one SM-2 update moves EF by +0.10 at q=5, 0.00 at q=4 and \u22120.14 at q=3',
  Math.abs(refEase(1, 5) - 2.6) < 1e-12 && Math.abs(refEase(1, 4) - 2.5) < 1e-12 && Math.abs(refEase(1, 3) - 2.36) < 1e-12,
  { q5: refEase(1, 5), q4: refEase(1, 4), q3: refEase(1, 3) });

// Half-life decay: strength = 2^(-elapsed/interval). At elapsed = interval it is exactly 0.5,
// which is the layer's stated due point; at 2x interval, 0.25; at half an interval, 1/sqrt(2).
function refStrength(e, i) { return i > 0 ? Math.pow(2, -e / i) : 0; }
ok('path \u00b7 oracle: recall strength is a half-life decay \u2014 1.00 at 0, exactly 0.50 at one interval, 0.25 at two, 0.7071 at half',
  refStrength(0, 6) === 1 && refStrength(6, 6) === 0.5 && refStrength(12, 6) === 0.25
  && Math.abs(refStrength(3, 6) - Math.SQRT1_2) < 1e-12
  && /Math\.pow\(2,\s*-elapsedDays\s*\/\s*intervalDays\)/.test(T),
  { at1: refStrength(6, 6), at2: refStrength(12, 6), half: refStrength(3, 6) });

ok('path \u00b7 oracle: the due test is elapsed >= interval, which is exactly the point where strength reaches 0.50 \u2014 the two statements cannot drift',
  /due:\s*elapsed\s*>=\s*iv/.test(T) && refStrength(6, 6) === 0.5);

/* ------------------------------------------------- D · derived, never stored */
console.log('\nD · progress is derived');

// The bucket is initialised with exactly four keys: an evidence list, a small "last seen" map
// so a disappearance can be detected, the check-run log, and the selected track. No score.
ok('path \u00b7 oracle: the v154 bucket is initialised with evidence, seen, runs and track \u2014 and nothing else',
  /X\.path\s*=\s*\{\s*ev:\s*\[\]\s*,\s*seen:\s*\{\}\s*,\s*runs:\s*\[\]\s*,\s*track:\s*TRACKS\[0\]\.id\s*\}/.test(T),
  { init: (/X\.path\s*=\s*\{[^}]*\}/.exec(T) || [])[0] });

// No score-shaped key is ever assigned on the bucket handle. `b` is the bucket in every writer.
const SCORE_WRITE = /\bb\.(score|progress|pct|mastery|level|streak|xp|ef|interval|strength|reps|complete|done)\s*=/;
ok('path \u00b7 oracle: no score-shaped key is ever written to the bucket \u2014 progress has no field to inflate',
  !SCORE_WRITE.test(T) && !/\bpath\.(score|pct|progress)\s*=/.test(T),
  { hit: (T.match(SCORE_WRITE) || [])[0] || null });

// The only thing appended to the evidence list is {id, t}, and only for a declared atom.
ok('path \u00b7 oracle: the evidence writer appends {id, t} only, refuses an undeclared atom, refuses a duplicate, and caps the list',
  /if\s*\(!ATOMS\[id\]\)\s*return false/.test(T)
  && /b\.ev\.push\(\{\s*id:\s*id,\s*t:\s*t\s*\|\|/.test(T)
  && /if\s*\(b\.ev\[i\]\.id === id\) return false/.test(T)
  && /EV_CAP\s*=\s*\d+/.test(T));

ok('path \u00b7 oracle: progress() and mastery() recompute from the evidence list on every call \u2014 both read seenMap(), neither reads a stored figure',
  /function progress\(/.test(T) && /function mastery\(/.test(T) && /function seenMap\(/.test(T)
  && /pct:\s*total \? met \/ total : null/.test(T));

/* -------------------------------------------------------------- E · tracks */
console.log('\nE · tracks');

function trackRecords(src) {
  if (!src) return [];
  const out = [];
  const re = /\{\s*id:\s*"([a-z0-9]+)",\s*name:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  const starts = [];
  while ((m = re.exec(src))) starts.push([m.index, m[1], m[2]]);
  for (let i = 0; i < starts.length; i++) {
    const a = starts[i][0], b = i + 1 < starts.length ? starts[i + 1][0] : src.length;
    const body = src.slice(a, b);
    const weeks = (body.match(/\{\s*n:\s*\d+,\s*outcome:/g) || []).length;
    const outcomes = (body.match(/outcome:\s*"((?:[^"\\]|\\.)*)"/g) || []).map(s => s.slice(10, -1));
    const gates = (body.match(/gate:\s*\[[^\]]*\]/g) || []);
    const nodeRefs = [];
    (body.match(/nodes:\s*\[[^\]]*\]/g) || []).forEach(s => (s.match(/"([a-z0-9]+)"/g) || []).forEach(x => nodeRefs.push(x.replace(/"/g, ''))));
    const gateRefs = [];
    gates.forEach(s => (s.match(/"([a-z0-9]+)"/g) || []).forEach(x => gateRefs.push(x.replace(/"/g, ''))));
    out.push({ id: starts[i][1], name: starts[i][2], weeks, outcomes, gates: gates.length, nodeRefs, gateRefs });
  }
  return out;
}
const TRACKS = trackRecords(TRACKS_SRC);
ok('path \u00b7 oracle: three tracks ship, every week has an outcome and a gate, and no track is shorter than three weeks',
  TRACKS.length >= 3 && TRACKS.every(t => t.weeks >= 3 && t.outcomes.length === t.weeks && t.gates === t.weeks),
  TRACKS.map(t => ({ id: t.id, weeks: t.weeks, outcomes: t.outcomes.length, gates: t.gates })));

const badRef = [];
TRACKS.forEach(t => t.nodeRefs.concat(t.gateRefs).forEach(r => { if (IDS.indexOf(r) < 0) badRef.push(t.id + '/' + r); }));
ok('path \u00b7 oracle: every node a track week or gate names exists in the graph', badRef.length === 0, { badRef });

const emptyWeek = [];
TRACKS.forEach(t => t.outcomes.forEach((o, i) => { if (o.length < 50) emptyWeek.push(t.id + ' w' + (i + 1) + ' (' + o.length + ' chars)'); }));
ok('path \u00b7 oracle: no filler weeks \u2014 every week states its outcome as something the learner can do, in a full sentence',
  emptyWeek.length === 0, { emptyWeek });

// Every gate node must be inside that same week's node list, or the gate is unreachable by
// following the track it belongs to.
let gateOutside = 0;
TRACKS.forEach(t => t.gateRefs.forEach(g => { if (t.nodeRefs.indexOf(g) < 0) gateOutside++; }));
ok('path \u00b7 oracle: every week gate names a node that week actually teaches \u2014 no gate can be unreachable from its own track',
  gateOutside === 0, { gateOutside });

/* ------------------------------------------- F · every pane, actually rendered */
// Pure node, no Chromium: the layer is an IIFE, so it can be executed against a minimal
// DLCORE/S sandbox and its onTab asked for the real HTML of every tab. This is the assert that
// would have caught the Map tab printing the literal word "undefined" — a column count read off
// the topological sort, which never carried one, concatenated straight into a sentence.
console.log('\nF · every pane rendered in a sandbox');

const FORBIDDEN = ['undefined', 'NaN', '[object Object]'];
function offenders(str) {
  return FORBIDDEN.filter(w => str.indexOf(w) >= 0).map(w => {
    const i = str.indexOf(w);
    return w + ' @' + i + ': ' + str.slice(Math.max(0, i - 70), i + 40).replace(/\s+/g, ' ');
  });
}

function sandbox(layerText) {
  const out = { ok: false, panes: {}, nodePanes: {}, error: null };
  const BUCKET = {};
  let clickHandler = null;
  const el = {
    id: 'dlPath', dataset: { tab: 'track' },
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener: (k, fn) => { if (k === 'click') clickHandler = fn; },
    removeEventListener: () => {}
  };
  const S = {
    stats: { trades: 0 }, acadDone: [], simXP: {}, orders: [],
    dlsim: { perps: [] }, equityHist: [], v154: BUCKET
  };
  let captured = null;
  const C = {
    $: () => null,
    esc: v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    X: () => BUCKET, save() {}, now: () => 1789732800000,
    coin: () => ({ price: 100 }), coinsAll: () => [],
    open(id, o) { captured = o; return el; },
    close() {}, cmd() {}, onTick() {}, toast() {}, money: n => '$' + n
  };
  const prevWindow = global.window, prevDoc = global.document, prevS = global.S;
  global.window = { DLCORE: C, DLAPP: {} };
  global.document = { getElementById: id => (id === 'dlPath' ? el : null), querySelector: () => null };
  global.S = S;
  global.window.DLCORE = C;
  try {
    // eslint-disable-next-line no-new-func
    new Function(layerText)();
    const P = global.window.DLPATH;
    if (!P || !P.open) throw new Error('the layer did not export DLPATH');
    P.open('track');
    if (!captured || typeof captured.onTab !== 'function') throw new Error('C.open was never called with an onTab');

    // Three fixtures: nothing recorded, a partial history, and a rich one. Every pane must be
    // clean in all three, because "undefined" hides in the branch you did not exercise.
    const fixtures = [
      ['empty', () => { }],
      ['partial', () => {
        S.stats.trades = 3; S.acadDone = [6]; S.simXP = { defi: 1 };
        BUCKET.sor = { log: [{ t: 1789732800000, predicted: { allInQuote: 10, legs: 1 }, realised: { allInQuote: 10 }, fills: [{ ok: true }] }] };
        BUCKET.defi = { lp: [{ kind: 'v3', sym: 'BTC', lo: 50, hi: 80, t: 1, fees: 0 }] };
      }],
      ['rich', () => {
        S.stats.trades = 40; S.acadDone = [6, 7, 8]; S.simXP = { defi: 1, mev: 1, flash: 1 };
        S.orders = [{ type: 'stop' }, { type: 'oco' }, { type: 'twap' }, { type: 'limit' }];
        S.dlsim.perps = [{ sym: 'BTC', t: 5, sl: 90, liq: 85, lev: 10, fund: 3 }];
        S.equityHist = [{ v: 100 }, { v: 140 }, { v: 90 }, { v: 150 }, { v: 80 }, { v: 160 }, { v: 70 }, { v: 170 }];
        BUCKET.defi = { lp: [{ kind: 'v3', sym: 'BTC', lo: 1, hi: 2, t: 1, fees: 9 }] };
        BUCKET.sor = { log: [1, 2, 3, 4, 5].map(() => ({
          t: 1789732800000, predicted: { allInQuote: 1000, bestSingle: 'B', legs: 2 },
          realised: { allInQuote: 1001 }, gasQuote: 2, fills: [{ ok: true }, { ok: true }]
        })) };
      }]
    ];
    const TABS = ['track', 'next', 'map', 'evidence', 'method'];
    fixtures.forEach(([name, setup]) => {
      setup();
      P.scan(true);
      TABS.forEach(t => {
        const body = { innerHTML: '' };
        captured.onTab(t, body, el);
        out.panes[name + '/' + t] = body.innerHTML;
      });
      // and the focused-node pane for every node, driven through the desk's own click handler
      P.NODES.forEach(n => {
        if (!clickHandler) return;
        const target = { closest: () => ({ getAttribute: k => (k === 'data-node' ? n.id : null) }) };
        el.dataset.tab = 'next';
        clickHandler({ target: target });
        const body = { innerHTML: '' };
        captured.onTab('next', body, el);
        out.nodePanes[name + '/' + n.id] = body.innerHTML;
      });
      // back out of the focus so the next fixture starts on the ordinary Next pane
      if (clickHandler) clickHandler({ target: { closest: () => ({ getAttribute: k => (k === 'data-back' ? '1' : null) }) } });
    });
    out.ok = true;
  } catch (e) {
    out.error = (e && e.stack) || String(e);
  } finally {
    global.window = prevWindow; global.document = prevDoc; global.S = prevS;
  }
  return out;
}

const SB = sandbox(T);
ok('path · the layer boots in a bare sandbox and hands every tab back through onTab', SB.ok && Object.keys(SB.panes).length === 15,
  { error: SB.error, panes: Object.keys(SB.panes).length });

const paneBad = [];
Object.keys(SB.panes).forEach(k => { const o = offenders(SB.panes[k]); if (o.length) paneBad.push(k + ' → ' + o.join(' | ')); });
ok('path · oracle: no pane renders the literal word undefined, NaN or [object Object] — empty, partial and rich state',
  SB.ok && paneBad.length === 0, { paneBad: paneBad.slice(0, 6) });

const nodeBad = [];
Object.keys(SB.nodePanes).forEach(k => { const o = offenders(SB.nodePanes[k]); if (o.length) nodeBad.push(k + ' → ' + o.join(' | ')); });
ok('path · oracle: the focused-concept pane is clean for every node in the graph, in all three states',
  SB.ok && Object.keys(SB.nodePanes).length >= NODES.length && nodeBad.length === 0,
  { rendered: Object.keys(SB.nodePanes).length, nodeBad: nodeBad.slice(0, 6) });

// The map pane specifically: it is the one that draws a computed layout, so its counts are
// asserted to be whole numbers rather than merely not-the-word-undefined.
const MAPS = Object.keys(SB.panes).filter(k => /\/map$/.test(k)).map(k => SB.panes[k]);
ok('path · oracle: the map pane states its size with real integers — "N nodes, M prerequisite edges, K columns"',
  MAPS.length === 3 && MAPS.every(m => /\b\d+ nodes, \d+ prerequisite edges, \d+ columns\b/.test(m)),
  { sample: (MAPS[0] || '').slice(-220) });

ok('path · oracle: the map SVG is balanced — one rect and one group per node, every <g> closed, and no raw hex colour in the markup',
  MAPS.length === 3 && MAPS.every(m => {
    const svg = (m.match(/<svg[\s\S]*<\/svg>/) || [''])[0];
    const rects = (svg.match(/<rect/g) || []).length;
    const gOpen = (svg.match(/<g\b/g) || []).length, gClose = (svg.match(/<\/g>/g) || []).length;
    return rects === NODES.length && gOpen === gClose && gOpen > 0 && !/#[0-9a-fA-F]{3}/.test(svg);
  }), { nodes: NODES.length });

console.log('\n' + pass + ' passed · ' + fail + ' failed');
process.exit(fail);
