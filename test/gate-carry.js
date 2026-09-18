// DexLadder Carry gate — the continuity + proof-card desk (layers/62-carry.js, window.DLCARRY, v166).
//
//   node test/gate-carry.js [dist/index.html]        exit code = number of failures
//
// Pure node. There is no Part B: this Mac cannot run the Chromium gates, so every functional
// assert here works on the layer's PURE KERNEL — the region the layer marks with
// /* <carry-kernel> ... </carry-kernel> */, which by construction touches no window, no document,
// no DLCORE and no WebCrypto. The gate lifts that region out of the shipped payload, evaluates it
// in node, and argues with it using an INDEPENDENT re-implementation of the same arithmetic
// (node's own crypto for SHA-256, node's Buffer for base64url, a second CRC-32 written from the
// polynomial, a second canonical serialiser) or against published reference values, cited inline.
//
// The first thing it checks is the one that matters most: that this layer contains no network
// primitive of any kind. Nothing in Carry may reach the outside world.
'use strict';
const fs = require('fs'), path = require('path'), nodeCrypto = require('crypto');
const WEB = path.join(__dirname, '..');
const file = process.argv[2] || path.join(WEB, 'dist', 'index.html');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 500) : '')); }
};

/* ------------------------------------------------------------ the layer text */
let html = '';
try { html = fs.readFileSync(file, 'utf8'); } catch (e) { html = ''; }

// build154.py wraps every layers/*.js in its own <script> block, so the layer's whole text can be
// lifted out of the payload and every "not in the layer" assert scoped to it exactly.
// The opening tag's remainder is stripped as well as the closing one, so what comes back is
// JavaScript and nothing else — Part C evaluates this text, and a leading `>` from `<script>`
// would make the whole layer a syntax error that has nothing to do with the layer.
function layerOf(needle) {
  const parts = html.split('<script');
  for (let i = 1; i < parts.length; i++) {
    const gt = parts[i].indexOf('>');
    if (gt < 0) continue;
    const after = parts[i].slice(gt + 1);
    const end = after.indexOf('</script');
    const body = end < 0 ? after : after.slice(0, end);
    if (body.indexOf(needle) >= 0) return body;
  }
  return null;
}
const SRC_PATH = path.join(WEB, 'layers', '62-carry.js');
let L = layerOf('window.DLCARRY');
let FROM = 'dist/index.html';
if (!L) {
  // The release owner builds the payload after every layer lands. Before that build the layer is
  // only on disk, and every assert below still has to be true of it.
  L = fs.existsSync(SRC_PATH) ? fs.readFileSync(SRC_PATH, 'utf8') : '';
  FROM = 'layers/62-carry.js (the payload does not carry this layer yet)';
}
console.log('A · the layer, read from ' + FROM + ' (' + L.length + ' chars)\n');

/* ============================================================ A · the shipped layer */

ok('carry · the layer ships exactly once (window.DLCARRY =, the house spelling)',
  (L.match(/window\.DLCARRY\s*=/g) || []).length === 1,
  { assigns: (L.match(/window\.DLCARRY\s*=/g) || []).length });

ok('carry · the layer declares its build in its own export (__v: 166)', /__v:\s*166\b/.test(L),
  { sawV: (L.match(/__v:\s*\d+/g) || []).slice(0, 4) });

/* ---- THE ONE THAT MATTERS: no network primitive, named one by one ---- */
const NET = [
  ['fetch(', /\bfetch\s*\(/],
  ['XMLHttpRequest', /XMLHttpRequest/],
  ['WebSocket', /\bWebSocket\b/],
  ['sendBeacon', /sendBeacon/],
  ['EventSource', /\bEventSource\b/],
  ['new Image (a pixel ping)', /new\s+Image\s*\(/],
  ['an <img> tag in rendered HTML', /<img/i],
  ['an element src= attribute', /\ssrc\s*=/],
  ['importScripts', /importScripts/],
  ['navigator.connection', /navigator\.connection/],
  ['the app request helper DLCORE.jget', /\bjget\s*\(/],
  ['RTCPeerConnection', /RTCPeerConnection/],
  ['a form action', /<form/i],
  ['URL.createObjectURL', /createObjectURL/]
];
NET.forEach(([label, re]) => {
  ok('carry · NO NETWORK — the layer contains no ' + label, !re.test(L),
    { hit: (L.match(re) || [])[0] || null });
});
ok('carry · the layer says in its own words that it makes no network call, in ASSUMPTIONS and in METHOD',
  /NO NETWORK CALL/.test(L) && /no network call of any kind/i.test(L),
  { assumption: /NO NETWORK CALL/.test(L), method: /no network call of any kind/i.test(L) });

ok('carry · the desk compiles nothing at runtime (no eval, no new Function, no string timer)',
  !/\beval\s*\(/.test(L) && !/new\s+Function\s*\(/.test(L) && !/\bset(Timeout|Interval)\s*\(\s*['"]/.test(L),
  { eval: /\beval\s*\(/.test(L), fn: /new\s+Function\s*\(/.test(L) });

ok('carry · no storage key of its own — state is the v154 bucket through DLCORE.X() and DLCORE.save()',
  !/\blocalStorage\b/.test(L) && !/\bsessionStorage\b/.test(L) && !/\bindexedDB\b/.test(L)
  && /\bC\.X\(\)/.test(L) && /\bC\.save\(\)/.test(L),
  { localStorage: /\blocalStorage\b/.test(L), bucket: /\bC\.X\(\)/.test(L) });

// A write to the paper account, and nothing else (gate-sor.js's shape): reads of S.bal are fine.
const BAL_WRITE = /S\.bal\s*(\[[^\]]{0,60}\]|\.[A-Za-z_$][\w$]*)\s*(\+|-|\*|\/|\|\||&&|\?\?)?=[^=]/;
ok('carry · the desk never writes the paper account — no assignment to S.bal anywhere in the layer',
  !BAL_WRITE.test(L), { hit: (L.match(BAL_WRITE) || [])[0] || null });
ok('carry · and it says why: balances are carried in the bundle and deliberately not applied on import',
  /money moves only through the engine/.test(L) && /applies:\s*false/.test(L),
  { law: /money moves only through the engine/.test(L), flag: /applies:\s*false/.test(L) });

ok('carry · deterministic by construction — no pseudo-random generator in the layer; randomness is only the GCM salt and IV',
  !/Math\.random/.test(L) && /getRandomValues/.test(L),
  { random: (L.match(/.{0,40}Math\.random.{0,30}/g) || []).slice(0, 2) });

ok('carry · ES5 only (no arrow, no const/let, no template literal, no spread)',
  !/=>/.test(L) && !/\bconst\s/.test(L) && !/\blet\s/.test(L) && !/`/.test(L) && !/\.\.\./.test(L),
  { arrow: /=>/.test(L), constLet: /\b(const|let)\s/.test(L), tick: /`/.test(L), spread: /\.\.\./.test(L) });

ok('carry · no CSS token block in the JS — the rules live in _v166css/62-carry.css',
  !/(:root|html\[data-mode=day\])\s*\{[^{}]*--[\w-]+\s*:/.test(L) && fs.existsSync(path.join(WEB, '_v166css', '62-carry.css')),
  { tokensInJs: /(:root)\s*\{[^{}]*--[\w-]+\s*:/.test(L), css: fs.existsSync(path.join(WEB, '_v166css', '62-carry.css')) });

ok('carry · everything it opens is torn down — __onClose is set and it starts no interval',
  /__onClose/.test(L) && !/setInterval\s*\(/.test(L),
  { onClose: /__onClose/.test(L), interval: (L.match(/setInterval\s*\(/g) || []).length });

ok('carry · the honesty block ships (ASSUMPTIONS and METHOD), and onTab writes body.innerHTML rather than returning a string',
  /\bASSUMPTIONS\s*=/.test(L) && /\bMETHOD\s*=/.test(L) && /body\.innerHTML\s*=\s*bodyFor\(/.test(L),
  { a: /\bASSUMPTIONS\s*=/.test(L), m: /\bMETHOD\s*=/.test(L), onTab: /body\.innerHTML\s*=\s*bodyFor\(/.test(L) });

ok('carry · a password-less export is labelled PLAINTEXT everywhere it appears — the button row, the output badge, the header field and the honesty block',
  (L.match(/PLAINTEXT/g) || []).length >= 4 && /plaintext:\s*!pw\.length/.test(L),
  { mentions: (L.match(/PLAINTEXT/g) || []).length, headerField: /plaintext:\s*!pw\.length/.test(L) });

ok('carry · the desk states exactly what a proof card proves and what it does not',
  /does NOT prove the trades happened/.test(L) && /has not been edited since it was signed/.test(L),
  { notProve: /does NOT prove the trades happened/.test(L) });

ok('carry · a missing WebCrypto or an insecure context is refused by name, never silently downgraded to plaintext',
  /insecure-context/.test(L) && /webcrypto-missing/.test(L) && /randomness-missing/.test(L),
  { names: ['insecure-context', 'webcrypto-missing', 'randomness-missing'].filter(n => L.indexOf(n) >= 0) });

ok('carry · the digest is verified BEFORE the dry run and before any write',
  /THE DIGEST COMES FIRST/.test(L) && L.indexOf('digest-mismatch') < L.indexOf('function apply('),
  { marker: /THE DIGEST COMES FIRST/.test(L) });

ok('carry · the card hash is taken over the canonical card body with the hash and signature removed',
  /function cardBody\(card\)/.test(L) && /k === "hash" \|\| k === "sig"/.test(L)
  && /var body = cardBody\(card\), text = canon\(body\);/.test(L),
  { cardBody: /function cardBody\(card\)/.test(L) });

/* ============================================================ B · the pure kernel */
console.log('\nB · the pure kernel, lifted out and argued with');

const OPEN = '/* <carry-kernel>', CLOSE = '/* </carry-kernel> */';
const ki = L.indexOf(OPEN), kj = L.indexOf(CLOSE);
let K = null, kerr = null;
if (ki >= 0 && kj > ki) {
  const body = L.slice(ki, kj);
  try {
    K = new Function(body + '\nreturn {canon:canon,utf8Bytes:utf8Bytes,utf8FromBytes:utf8FromBytes,' +
      'b64uEnc:b64uEnc,b64uDec:b64uDec,hexOf:hexOf,crc32:crc32,crc32Hex:crc32Hex,hash32:hash32,' +
      'chunkText:chunkText,joinChunks:joinChunks,envelopeCheck:envelopeCheck,' +
      'listDiff:listDiff,setDiff:setDiff,mapDiff:mapDiff,mergeNewer:mergeNewer,mergeSet:mergeSet,' +
      'overlapJoin:overlapJoin,normEquity:normEquity,daysBetween:daysBetween,dayOf:dayOf,' +
      'cardFrom:cardFrom,cardBody:cardBody,fieldAt:fieldAt,CARD_FIELDS:CARD_FIELDS,' +
      'challengeSpec:challengeSpec,challengeCode:challengeCode,parseChallenge:parseChallenge,pickDays:pickDays,' +
      'KDF_ITERATIONS:KDF_ITERATIONS,KDF_FLOOR:KDF_FLOOR,MAGIC:MAGIC,BUNDLE_V:BUNDLE_V,SPEC_BUNDLE:SPEC_BUNDLE};')();
  } catch (e) { kerr = String(e && e.message || e); }
}
ok('carry · the pure kernel lifts out of the layer and runs with no browser at all (no window, no document, no WebCrypto)',
  !!K, { marker: ki >= 0, err: kerr });

/* ---- the independent implementations this gate argues with ---- */
// A second canonical serialiser, written from the rule rather than from the layer.
function refCanon(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return isFinite(v) ? (v === 0 ? '0' : JSON.stringify(v)) : 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(refCanon).join(',') + ']';
  const ks = Object.keys(v).filter(k => typeof v[k] !== 'undefined' && typeof v[k] !== 'function').sort();
  return '{' + ks.map(k => JSON.stringify(k) + ':' + refCanon(v[k])).join(',') + '}';
}
// A second CRC-32, built from the reflected polynomial 0xEDB88320 (IEEE 802.3 / zlib).
function refCrc32(buf) {
  let c, t = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  let r = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) r = t[(r ^ buf[i]) & 0xff] ^ (r >>> 8);
  return (r ^ 0xFFFFFFFF) >>> 0;
}
const sha = s => nodeCrypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

if (K) {
  /* 1 · canonical serialisation is stable under key reordering */
  const A = { b: 1, a: [3, { z: 1, y: 2 }], c: 'x', n: 1.5 };
  const B = { n: 1.5, c: 'x', a: [3, { y: 2, z: 1 }], b: 1 };
  ok('oracle 1 · canonical JSON is stable under key reordering, at every depth, and matches an independent serialiser',
    K.canon(A) === K.canon(B) && K.canon(A) === refCanon(A),
    { mine: K.canon(A), ref: refCanon(A) });

  /* 2 · numbers are normalised */
  ok('oracle 2 · numbers are normalised — NaN and both infinities serialise as null, negative zero as 0',
    K.canon({ a: NaN, b: Infinity, c: -Infinity, d: -0 }) === '{"a":null,"b":null,"c":null,"d":0}',
    K.canon({ a: NaN, b: Infinity, c: -Infinity, d: -0 }));

  /* 3 · the same object always digests to the same bytes */
  const bodyFix = { spec: 'x', sections: { fills: [{ t: 2, sym: 'BTC' }, { sym: 'ETH', t: 1 }] } };
  const shuffled = { sections: { fills: [{ sym: 'BTC', t: 2 }, { t: 1, sym: 'ETH' }] }, spec: 'x' };
  ok('oracle 3 · the same state digests to the same SHA-256 however its keys were ordered (node crypto over the layer\'s own canonical bytes)',
    sha(K.canon(bodyFix)) === sha(K.canon(shuffled)) && sha(K.canon(bodyFix)) === sha(refCanon(bodyFix)),
    { a: sha(K.canon(bodyFix)).slice(0, 16), b: sha(K.canon(shuffled)).slice(0, 16) });

  /* 4 · CRC-32 against the published check value */
  // CRC-32/ISO-HDLC check value for the ASCII string "123456789" is 0xCBF43926 (the standard
  // "check" field published for this algorithm; also what zlib's crc32 returns).
  ok('oracle 4 · CRC-32("123456789") === 0xCBF43926, the published check value, and matches a second implementation built from the polynomial',
    K.crc32('123456789') === 0xCBF43926 && K.crc32('hello carry') === refCrc32(Buffer.from('hello carry', 'utf8')),
    { mine: K.crc32('123456789').toString(16), ref: refCrc32(Buffer.from('123456789', 'utf8')).toString(16) });

  /* 5 · FNV-1a against published vectors */
  // FNV-1a 32-bit reference values: "" → 0x811c9dc5, "a" → 0xe40c292c, "foobar" → 0xbf9cf968.
  ok('oracle 5 · FNV-1a 32-bit matches the published vectors for "", "a" and "foobar"',
    K.hash32('') === 0x811c9dc5 && K.hash32('a') === 0xe40c292c && K.hash32('foobar') === 0xbf9cf968,
    { empty: K.hash32('').toString(16), a: K.hash32('a').toString(16), foobar: K.hash32('foobar').toString(16) });

  /* 6 · base64url and UTF-8 against node */
  const rnd = [...nodeCrypto.randomBytes(131)];
  const s6 = 'a—é🜲z ok';
  ok('oracle 6 · base64url matches node\'s Buffer base64url and round-trips; UTF-8 encoding matches Buffer too',
    K.b64uEnc(rnd) === Buffer.from(rnd).toString('base64url')
    && JSON.stringify(K.b64uDec(K.b64uEnc(rnd))) === JSON.stringify(rnd)
    && Buffer.from(K.utf8Bytes(s6)).toString('utf8') === s6
    && K.utf8FromBytes([...Buffer.from(s6, 'utf8')]) === s6,
    { mine: K.b64uEnc(rnd).slice(0, 24), node: Buffer.from(rnd).toString('base64url').slice(0, 24) });

  /* 7 · the chunker round-trips, and the count is arithmetic not luck */
  const payload = JSON.stringify({ header: { spec: 'x' }, body: { big: 'y'.repeat(4000) } });
  const tag = sha(payload).slice(0, 16);
  const lines = K.chunkText(payload, tag, 800);
  const expected = Math.ceil(Buffer.from(payload, 'utf8').toString('base64url').length / 800);
  const rt = K.joinChunks(lines.join('\n'));
  ok('oracle 7 · the chunker cuts ceil(base64url length / size) chunks and reassembles to the original bytes',
    lines.length === expected && rt.ok && rt.text === payload,
    { got: lines.length, expected: expected, ok: rt.ok, reason: rt.reason });

  /* 8 · a dropped chunk */
  const dropped = K.joinChunks(lines.slice(0, lines.length - 1).join('\n'));
  const droppedMid = K.joinChunks(lines.filter((_, i) => i !== 1).join('\n'));
  ok('oracle 8 · a dropped chunk is caught by name and the missing index is named — at the end of the stack and in the middle of it',
    !dropped.ok && dropped.reason === 'missing-chunk' && dropped.missing[0] === lines.length
    && !droppedMid.ok && droppedMid.missing[0] === 2,
    { end: dropped.reason, mid: droppedMid.missing });

  /* 9 · a reordered stack */
  const rev = K.joinChunks(lines.slice().reverse().join('\n'));
  ok('oracle 9 · a reordered stack is detected, reported as reordered, and put back by index rather than silently accepted',
    rev.ok === true && rev.reordered === true && rev.text === payload && /out of order/.test(rev.note),
    { reordered: rev.reordered, note: rev.note });

  /* 10 · a flipped bit */
  const flip = lines.slice();
  const last = flip[1].slice(-1);
  flip[1] = flip[1].slice(0, -1) + (last === 'A' ? 'B' : 'A');
  const bit = K.joinChunks(flip.join('\n'));
  ok('oracle 10 · a single flipped character inside a chunk is caught by that chunk\'s CRC-32 and named',
    !bit.ok && bit.reason === 'bad-crc' && bit.badCrc.indexOf(2) >= 0,
    { reason: bit.reason, badCrc: bit.badCrc });

  /* 11 · two bundles spliced */
  const other = K.chunkText('a different bundle', 'deadbeefdeadbeef', 800);
  const mix = K.joinChunks([lines[0]].concat(other).join('\n'));
  ok('oracle 11 · chunks of two different bundles cannot be spliced — the shared digest tag or the total catches it',
    !mix.ok && (mix.reason === 'mixed-bundles' || mix.reason === 'mixed-totals'),
    { reason: mix.reason });

  /* 12 · the PBKDF2 floor, read from the shipped source */
  const iterSrc = (L.match(/KDF_ITERATIONS\s*=\s*(\d+)/) || [])[1];
  const floorSrc = (L.match(/KDF_FLOOR\s*=\s*(\d+)/) || [])[1];
  ok('oracle 12 · the shipped PBKDF2-SHA-256 iteration count is at or above the stated floor of 600,000 (OWASP Password Storage Cheat Sheet, 2023), and the layer cites that source',
    +iterSrc >= 600000 && +floorSrc === 600000 && +K.KDF_ITERATIONS >= +K.KDF_FLOOR
    && /OWASP Password Storage Cheat Sheet, 2023/.test(L),
    { iterations: iterSrc, floor: floorSrc, cited: /OWASP Password Storage Cheat Sheet, 2023/.test(L) });

  /* 13 · the header must carry the KDF parameters, the IV and the digest in the clear */
  const goodHeader = {
    spec: K.SPEC_BUNDLE, bundleVersion: K.BUNDLE_V, build: 166, createdAt: 1,
    digest: { algo: 'SHA-256', of: 'canonical-json(body)', value: 'ab'.repeat(32) },
    enc: { cipher: 'AES-GCM', bits: 256, tagBits: 128, iv: 'AAAAAAAAAAAAAAAA', kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: 'AAAAAAAAAAAAAAAAAAAAAA' } }
  };
  const clone = o => JSON.parse(JSON.stringify(o));
  const noKdf = clone(goodHeader); delete noKdf.enc.kdf;
  const noIv = clone(goodHeader); delete noIv.enc.iv;
  const noDigest = clone(goodHeader); delete noDigest.digest;
  const noIter = clone(goodHeader); delete noIter.enc.kdf.iterations;
  ok('oracle 13 · the header must carry the KDF parameters, the iteration count, the IV and the digest in the clear, or the import refuses by name',
    K.envelopeCheck({ header: goodHeader, ct: 'AA' }).ok === true
    && K.envelopeCheck({ header: noKdf, ct: 'AA' }).reason === 'unknown-kdf'
    && K.envelopeCheck({ header: noIv, ct: 'AA' }).reason === 'no-iv'
    && K.envelopeCheck({ header: noDigest, ct: 'AA' }).reason === 'no-digest'
    && K.envelopeCheck({ header: noIter, ct: 'AA' }).reason === 'no-iterations',
    {
      good: K.envelopeCheck({ header: goodHeader, ct: 'AA' }),
      kdf: K.envelopeCheck({ header: noKdf, ct: 'AA' }).reason,
      iv: K.envelopeCheck({ header: noIv, ct: 'AA' }).reason,
      dig: K.envelopeCheck({ header: noDigest, ct: 'AA' }).reason
    });

  /* 14 · version mismatch */
  const ahead = clone(goodHeader); ahead.bundleVersion = K.BUNDLE_V + 1;
  const behind = clone(goodHeader); behind.bundleVersion = 0;
  const alien = clone(goodHeader); alien.spec = 'someone-elses/format/v1';
  ok('oracle 14 · a bundle format this build does not read is refused by name — ahead, behind, and a foreign spec',
    K.envelopeCheck({ header: ahead, ct: 'AA' }).reason === 'version-ahead'
    && K.envelopeCheck({ header: behind, ct: 'AA' }).reason === 'no-version'
    && K.envelopeCheck({ header: alien, ct: 'AA' }).reason === 'spec-mismatch',
    { ahead: K.envelopeCheck({ header: ahead, ct: 'AA' }).reason, behind: K.envelopeCheck({ header: behind, ct: 'AA' }).reason });

  /* 15 · the proof card's hash covers every field it displays */
  const card = K.cardFrom({
    fromDay: '2025-06-02', toDay: '2025-08-20', trades: 17, universe: ['ETH', 'BTC'],
    equityNorm: [1, 1.1, 1.21], equityDigest: sha('[1,1.1,1.21]'),
    sharpe: 0.5, maxDD: 0.125, holdPct: 10, benchmark: 'buy and hold BTC', source: 'this device'
  });
  const cbody = K.cardBody(card);
  const missing = K.CARD_FIELDS.filter(f => !K.fieldAt(cbody, f).has);
  const canonText = K.canon(cbody);
  const leavesCovered = K.CARD_FIELDS.every(f => canonText.indexOf(JSON.stringify(f.split('.').pop())) >= 0);
  const withSig = JSON.parse(JSON.stringify(card));
  withSig.hash = { value: sha(canonText) }; withSig.sig = { value: 'zz' };
  ok('oracle 15 · every field the card displays is inside the object that gets hashed, and stripping the hash and the signature leaves those bytes unchanged',
    missing.length === 0 && leavesCovered && K.canon(K.cardBody(withSig)) === canonText,
    { missing: missing, stable: K.canon(K.cardBody(withSig)) === canonText });

  /* 16 · the card's arithmetic */
  ok('oracle 16 · the card\'s own arithmetic: return is end/start − 1, drawdown is a percentage, edge is return minus hold, and the window is inclusive of both days',
    card.returnPct === 21 && card.maxDrawdownPct === 12.5 && card.edgeVsHoldPct === 11 && card.window.days === 80
    && K.daysBetween('2025-01-01', '2025-01-01') === 1 && K.daysBetween('2025-02-28', '2025-03-01') === 2,
    { ret: card.returnPct, dd: card.maxDrawdownPct, edge: card.edgeVsHoldPct, days: card.window.days });

  /* 17 · a missing benchmark stays missing */
  const noHold = K.cardFrom({ fromDay: '2025-01-01', toDay: '2025-01-10', trades: 0, universe: [], equityNorm: [1, 1.5], equityDigest: 'x', sharpe: null, maxDD: null, holdPct: null });
  ok('oracle 17 · a missing figure stays missing — no benchmark gives a null edge, not a zero, and a missing Sharpe stays null',
    noHold.edgeVsHoldPct === null && noHold.holdPct === null && noHold.sharpePerSample === null && noHold.maxDrawdownPct === null && noHold.returnPct === 50,
    noHold);

  /* 18 · the equity digest does not leak the size of the account */
  const small = K.normEquity([100, 110, 121]), large = K.normEquity([1000000, 1100000, 1210000]);
  ok('oracle 18 · the card\'s equity digest is taken over the curve normalised to its first point, so two accounts with the same shape and different sizes digest identically',
    JSON.stringify(small) === JSON.stringify([1, 1.1, 1.21]) && sha(K.canon(small)) === sha(K.canon(large)),
    { small: small, large: large });

  /* 19 · the seed picks the scored days, deterministically and independently of input order */
  const days = [];
  for (let i = 1; i <= 30; i++) days.push('2025-06-' + ('0' + i).slice(-2));
  const p1 = K.pickDays('october', days, 8);
  const p2 = K.pickDays('october', days.slice().reverse(), 8);
  // independent re-implementation of the same rule: rank each day by FNV-1a(seed|day), take the lowest k
  const refPick = days.map(d => ({ d, h: K.hash32('october|' + d) })).sort((a, b) => a.h - b.h).slice(0, 8).map(x => x.d).sort();
  const seedsDiffer = ['november', 'december', 'a', 'b'].every(s2 => JSON.stringify(K.pickDays(s2, days, 8)) !== JSON.stringify(p1));
  ok('oracle 19 · the seed picks the same scored days on any device and in any input order, matches an independent ranking by FNV-1a(seed|day), and a different seed picks a different set',
    JSON.stringify(p1) === JSON.stringify(p2) && JSON.stringify(p1) === JSON.stringify(refPick)
    && p1.length === 8 && seedsDiffer,
    { picked: p1, ref: refPick, seedsDiffer: seedsDiffer });

  /* 20 · a challenge code round-trips and refuses a typo */
  const spec = K.challengeSpec({ seed: 'october', fromDay: '2025-06-01', toDay: '2025-09-01', universe: ['eth', 'BTC'], rule: 'score.seedsample', sampleDays: 5 });
  const code = K.challengeCode(spec);
  const back = K.parseChallenge(code);
  const typo = code.slice(0, -1) + (code.slice(-1) === 'a' ? 'b' : 'a');
  ok('oracle 20 · a challenge code carries the inputs byte for byte and refuses a single mistyped character',
    back.ok && K.canon(back.spec) === K.canon(spec) && K.parseChallenge(typo).ok === false
    && K.parseChallenge('DLXC1.zzz.00000000').ok === false,
    { round: back.ok, reason: K.parseChallenge(typo).reason });

  /* 21 · merge-newer keeps the newer record, per record */
  const keyOf = r => r.id, stampOf = r => r.t;
  const cur = [{ id: 'a', t: 10, v: 'old' }, { id: 'b', t: 5, v: 'mine' }];
  const inc = [{ id: 'a', t: 20, v: 'new' }, { id: 'c', t: 1, v: 'theirs' }];
  const merged = K.mergeNewer(cur, inc, keyOf, stampOf, 10);
  const byId = {}; merged.forEach(r => { byId[r.id] = r; });
  const d = K.listDiff(cur, inc, keyOf, stampOf);
  ok('oracle 21 · merge-newer keeps the newer of each record and loses nothing that was only on one side; the dry run counts the same additions, changes and removals',
    merged.length === 3 && byId.a.v === 'new' && byId.b.v === 'mine' && byId.c.v === 'theirs'
    && d.added.length === 1 && d.changed.length === 1 && d.removed.length === 1,
    { merged: merged.map(r => r.id + ':' + r.v), diff: [d.added.length, d.changed.length, d.removed.length] });

  /* 22 · the equity curve stitches at its overlap */
  const oj = K.overlapJoin([1, 2, 3, 4], [3, 4, 5, 6]);
  const oj2 = K.overlapJoin([1, 2], [9, 9, 9]);
  const oj3 = K.overlapJoin([3, 4, 5, 6], [1, 2, 3, 4]);
  ok('oracle 22 · the equity curve merges at its longest overlap, in either direction, and with no overlap it keeps the longer curve and says so',
    JSON.stringify(oj.series) === JSON.stringify([1, 2, 3, 4, 5, 6]) && oj.overlap === 2
    && oj2.joined === false && oj2.series.length === 3
    && JSON.stringify(oj3.series) === JSON.stringify([1, 2, 3, 4, 5, 6]),
    { a: oj, b: oj2, c: oj3.series });

  /* 23 · the watchlist merges as a set */
  const sd = K.setDiff(['BTC', 'ETH'], ['ETH', 'SOL']);
  ok('oracle 23 · the watchlist is diffed and merged as a set — union on merge, and the dry run names what replace would remove',
    sd.added.length === 1 && sd.added[0].key === 'SOL' && sd.removed.length === 1 && sd.removed[0].key === 'BTC'
    && JSON.stringify(K.mergeSet(['BTC', 'ETH'], ['ETH', 'SOL'])) === JSON.stringify(['BTC', 'ETH', 'SOL']),
    { added: sd.added, removed: sd.removed });

  /* 24 · an unstamped map is never merged by recency */
  const md = K.mapDiff({ ws: 'terminal', cat: 'all' }, { ws: 'classic', dispQ: 'EUR' });
  ok('oracle 24 · an unstamped map is diffed key by key with the before and the after, which is what makes it safe to refuse to merge it',
    md.changed.length === 1 && md.changed[0].key === 'ws' && md.changed[0].before === 'terminal' && md.changed[0].after === 'classic'
    && md.added.length === 1 && md.removed.length === 1
    && /LEAVES THIS ALONE/.test(L),
    { changed: md.changed, refusal: /LEAVES THIS ALONE/.test(L) });
} else {
  fail += 24;
  console.log('  ✗ the kernel could not be lifted, so all 24 numeric oracles were skipped');
}

/* ============================================================ C · every pane, rendered */
// A runtime gate that walked the built payload in Chromium caught the literal word "undefined" in
// the Method tab's textContent. That is exactly the class of bug a pure-node gate can still catch:
// the panes are synchronous string builders over module constants, so they render in a `vm`
// sandbox with nothing but a stubbed window and document. Every pane is rendered TWICE — once with
// WebCrypto present and once with it missing, which is the cold state where an unresolved probe
// would leak — and asserted to contain no "undefined", no "NaN" and no "[object Object]".
console.log('\nC · every pane rendered cold, in a vm sandbox');

const vm = require('vm');
function renderPanes(withCrypto) {
  let captured = null;
  const St = {
    bal: {}, deposited: 0, basis: {}, stats: null, txns: [], journal: [], alerts: [],
    orders: [], equityHist: [], watch: [], v154: { xp: {} }
  };
  const Cs = {
    esc: x => String(x == null ? '' : x).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])),
    X: () => St.v154, save: () => {}, now: () => 1760000000000, lsGet: () => null,
    toast: () => {}, cmd: () => {}, coin: () => null, money: n => '$' + n,
    open: (id, o) => { captured = o; return null; }
  };
  const win = { isSecureContext: !!withCrypto, DLCORE: Cs, navigator: {} };
  if (withCrypto) win.crypto = nodeCrypto.webcrypto;
  const sb = {
    window: win, document: { getElementById: () => null }, S: St, DLCORE: Cs,
    console: { log: () => {} }, Promise, Uint8Array, Date, Math, JSON, Object, Array,
    String, Number, isFinite, parseInt, setTimeout
  };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(L, sb, { filename: '62-carry.js' });
  sb.window.DLCARRY.open('export');
  const out = {};
  (captured.tabs || []).forEach(t => {
    const el = { innerHTML: '' };
    captured.onTab(t[0], el, null);
    out[t[0]] = el.innerHTML;
  });
  return { panes: out, tabs: (captured.tabs || []).map(t => t[0]) };
}

const FORBIDDEN = ['undefined', 'NaN', '[object Object]'];
[true, false].forEach(withCrypto => {
  const label = withCrypto ? 'WebCrypto present' : 'WebCrypto absent (the cold, unprobed state)';
  let r = null, err = null;
  try { r = renderPanes(withCrypto); } catch (e) { err = String(e && e.message || e); }
  ok('pane · all five tabs render with ' + label + ', and nothing throws',
    !!r && r.tabs.length === 5 && r.tabs.every(t => (r.panes[t] || '').length > 200),
    { err: err, tabs: r && r.tabs, sizes: r && r.tabs.map(t => (r.panes[t] || '').length) });
  if (!r) { fail += 5; console.log('  ✗ the panes could not be rendered, so the five text asserts were skipped'); return; }
  r.tabs.forEach(t => {
    const text = r.panes[t].replace(/<[^>]*>/g, ' ');
    const bad = FORBIDDEN.filter(w => text.indexOf(w) >= 0);
    // context for whichever word leaked, so a failure names the sentence rather than the tab
    const where = bad.map(w => { const i = text.indexOf(w); return w + ': …' + text.slice(Math.max(0, i - 70), i + 30).replace(/\s+/g, ' ') + '…'; });
    ok('pane · the ' + t + ' tab renders no undefined, no NaN and no [object Object] (' + label + ')',
      bad.length === 0, where);
  });
});

// The prose itself is covered by the same assert: the Method tab's copy IS rendered text, so a
// sentence that says "undefined" fails the pane check above exactly as a rendering bug would.

console.log('\n' + pass + ' passed · ' + fail + ' failed');
process.exit(fail);
