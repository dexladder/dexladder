/* ============================================================================
   DexLadder — DLCARRY · layer 62 · v166 "⇄ Carry"
   CONTINUITY + PROOF CARDS — two gaps, one layer, zero network

   The question this desk exists to answer: how do I move this account to
   another device, and how do I show someone what I did here, without either
   of those things becoming an account, a server, or a leak?

   The app has no login by design, which is why it has never had continuity:
   a desk lives in one browser profile and dies with it. It also has no way to
   show a track record, because every honest way to do that seems to need a
   server to vouch for it. This layer does both on the device: a canonical,
   digested, optionally encrypted bundle of the account that you carry
   yourself, and an opt-in anonymised proof card signed by a key that never
   leaves this browser.

   THE ONE HARD LAW OF THIS LAYER
     This layer makes NO network call of any kind. No request helper, no
     XHR, no socket, no beacon, no pixel ping, and it never asks DLCORE for a
     feed. Nothing here reaches the outside world. A bundle or a card leaves
     this device only when a person selects the text and copies it out.
     The gate asserts this against the shipped payload, by name, per primitive.

   WHAT A PROOF CARD PROVES, EXACTLY
     It proves the card has not been edited since it was signed. That is all.
     It does NOT prove the trades happened, because the same device wrote the
     record AND holds the signing key — anyone who can edit the record can
     re-sign it. The desk says this on the card, in the tab, and in METHOD.

   LAWS OBSERVED
     · ES5 only, nothing compiled at runtime, no timers left running
     · no storage key of its own — state is the v154 bucket via DLCORE.X()
     · this layer never trades and never assigns to a balance. The account's
       balances are carried in the bundle FOR THE RECORD and are deliberately
       NOT applied on import: money moves only through the engine
     · deterministic — the layer draws no pseudo-random number at all. Every
       seed-derived choice is an FNV-1a hash of its inputs. Randomness appears
       exactly once, in crypto.getRandomValues, for a salt and an IV, where a
       repeat would be a security bug rather than a determinism one
     · a missing figure stays missing — null with a named reason, never 0
     · Day + Night — every rule lives in _v166css/62-carry.css, paired
   ============================================================================ */
(function () {
  "use strict";
  if (window.DLCARRY && window.DLCARRY.__v) return;

  var C = window.DLCORE;
  if (!C) return;

  function P() { try { return window.DLAPP && window.DLAPP.paper; } catch (e) { return null; } }

  /* --------------------------------------------------------------- crypto parameters

     PBKDF2 iteration count: 600,000 for PBKDF2-HMAC-SHA256. That is the floor
     published in the OWASP Password Storage Cheat Sheet, 2023 revision, and it
     is still the figure OWASP carries. It is a FLOOR, not a ceiling: the gate
     asserts the shipped number is at or above it, so raising it later passes
     and quietly lowering it fails.

     AES-GCM-256 with a 12-byte IV: 12 bytes is the size NIST SP 800-38D §8.2
     calls for, because it is the only length GCM uses directly rather than
     re-hashing through GHASH. A fresh IV is drawn per export from
     crypto.getRandomValues — an IV reused under one key destroys GCM, which is
     why the export refuses rather than falling back when randomness is absent.

     ECDSA P-256 with SHA-256: NIST FIPS 186-4 curve, the one WebCrypto is
     required to implement, so a card signed here verifies in any browser.
     ---------------------------------------------------------------------- */
  var CIPHER = { name: "AES-GCM", bits: 256, ivBytes: 12, tagBits: 128 };
  var SIG = { name: "ECDSA", curve: "P-256", hash: "SHA-256" };
  var DIGEST = { algo: "SHA-256", of: "canonical-json(body)" };

  /* <carry-kernel>
     Everything between these two markers is PURE: no window, no document, no
     DLCORE, no clock beyond an explicit argument, no crypto. The gate lifts
     this region out of the shipped payload and runs it in node against an
     independent re-implementation of the same arithmetic. Keep it that way. */

  var MAGIC = "DLCARRY1";                 /* chunk line prefix */
  var SPEC_BUNDLE = "dexladder/carry-bundle/v1";
  var SPEC_CARD = "dexladder/proof-card/v1";
  var SPEC_CHAL = "dexladder/challenge/v1";
  var BUNDLE_V = 1;                       /* the only bundle version this build reads */
  var BUILD = 166;
  var KDF_ITERATIONS = 600000;            /* OWASP Password Storage Cheat Sheet, 2023 */
  var KDF_FLOOR = 600000;                 /* the gate asserts iterations >= this */
  var KDF_SALT_BYTES = 16;
  var CHUNK_CHARS = 1600;                 /* payload characters per transfer chunk */

  /* every field the proof-card UI prints. The card hash covers the whole card
     body, so this list exists to be checked against it rather than trusted. */
  var CARD_FIELDS = [
    "spec", "build", "window.fromDay", "window.toDay", "window.days",
    "trades", "universe",
    "equity.points", "equity.digest", "equity.normStart", "equity.normEnd",
    "returnPct", "sharpePerSample", "maxDrawdownPct",
    "holdPct", "edgeVsHoldPct", "benchmark", "source"
  ];
  var CHALLENGE_FIELDS = ["challenge.code", "challenge.specDigest", "challenge.scoredDays"];

  /* ------------------------------------------------------ canonical JSON */
  /* Keys sorted at every depth, numbers normalised, undefined and functions
     dropped. The same state must always produce the same bytes, because the
     digest is over these bytes and an import that cannot reproduce them has to
     refuse rather than guess. This is byte-identical in shape to the stable()
     that 48-vault and SV82 already use, so the two never disagree about what
     "the same state" means. */
  function canonNum(n) {
    if (!isFinite(n)) return "null";          /* NaN and both infinities */
    if (n === 0) return "0";                  /* collapses -0, which stringifies as 0 anyway but not everywhere */
    return JSON.stringify(n);
  }
  function canon(v) {
    if (v === null || v === undefined) return "null";
    var t = typeof v;
    if (t === "number") return canonNum(v);
    if (t === "boolean") return v ? "true" : "false";
    if (t === "string") return JSON.stringify(v);
    if (t === "function") return "null";
    if (Object.prototype.toString.call(v) === "[object Array]") {
      var a = [], i;
      for (i = 0; i < v.length; i++) a.push(canon(v[i]));
      return "[" + a.join(",") + "]";
    }
    var keys = [], k;
    for (k in v) if (Object.prototype.hasOwnProperty.call(v, k)) {
      if (typeof v[k] === "undefined" || typeof v[k] === "function") continue;
      keys.push(k);
    }
    keys.sort();
    var out = [], j;
    for (j = 0; j < keys.length; j++) out.push(JSON.stringify(keys[j]) + ":" + canon(v[keys[j]]));
    return "{" + out.join(",") + "}";
  }

  /* ------------------------------------------------------------ bytes */
  /* Written out rather than handed to TextEncoder so the kernel runs
     unchanged in node, in a worker, and in a browser old enough to lack it. */
  function utf8Bytes(str) {
    var s = String(str), out = [], i, c, c2;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xc0 | (c >> 6)); out.push(0x80 | (c & 0x3f)); }
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        c2 = s.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          out.push(0xf0 | (cp >> 18));
          out.push(0x80 | ((cp >> 12) & 0x3f));
          out.push(0x80 | ((cp >> 6) & 0x3f));
          out.push(0x80 | (cp & 0x3f));
          i++;
        } else { out.push(0xe0 | (c >> 12)); out.push(0x80 | ((c >> 6) & 0x3f)); out.push(0x80 | (c & 0x3f)); }
      } else { out.push(0xe0 | (c >> 12)); out.push(0x80 | ((c >> 6) & 0x3f)); out.push(0x80 | (c & 0x3f)); }
    }
    return out;
  }
  function utf8FromBytes(b) {
    var out = "", i = 0, c, c2, c3, c4, cp;
    while (i < b.length) {
      c = b[i++];
      if (c < 0x80) out += String.fromCharCode(c);
      else if (c < 0xe0) { c2 = b[i++]; out += String.fromCharCode(((c & 0x1f) << 6) | (c2 & 0x3f)); }
      else if (c < 0xf0) { c2 = b[i++]; c3 = b[i++]; out += String.fromCharCode(((c & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f)); }
      else {
        c2 = b[i++]; c3 = b[i++]; c4 = b[i++];
        cp = ((c & 0x07) << 18) | ((c2 & 0x3f) << 12) | ((c3 & 0x3f) << 6) | (c4 & 0x3f);
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      }
    }
    return out;
  }
  function hexOf(bytes) {
    var out = "", i;
    for (i = 0; i < bytes.length; i++) out += ("0" + (bytes[i] & 0xff).toString(16)).slice(-2);
    return out;
  }

  /* base64url, RFC 4648 §5: the URL and filename safe alphabet, padding
     stripped. Written by hand rather than through btoa so a chunk can be
     reassembled by the gate, by node, and by a browser with the same code. */
  var B64U = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  function b64uEnc(bytes) {
    var out = "", i = 0, n = bytes.length, a, b, c;
    while (i < n) {
      a = bytes[i++] & 0xff;
      b = i < n ? bytes[i++] & 0xff : -1;
      c = i < n ? bytes[i++] & 0xff : -1;
      out += B64U.charAt(a >> 2);
      out += B64U.charAt(((a & 3) << 4) | (b < 0 ? 0 : b >> 4));
      if (b < 0) break;
      out += B64U.charAt(((b & 15) << 2) | (c < 0 ? 0 : c >> 6));
      if (c < 0) break;
      out += B64U.charAt(c & 63);
    }
    return out;
  }
  function b64uDec(str) {
    var s = String(str).replace(/[\r\n\t ]/g, ""), out = [], i, acc = 0, bits = 0, v;
    for (i = 0; i < s.length; i++) {
      if (s.charAt(i) === "=") continue;
      v = B64U.indexOf(s.charAt(i));
      if (v < 0) return null;                 /* an alien character is a refusal, not a guess */
      acc = (acc << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); }
    }
    return out;
  }

  /* CRC-32, the IEEE 802.3 / zlib polynomial 0xEDB88320 reflected, initial and
     final XOR 0xFFFFFFFF. Check value for "123456789" is 0xCBF43926, which the
     gate asserts against this implementation. */
  var CRCT = null;
  function crcTable() {
    if (CRCT) return CRCT;
    var t = [], n, c, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    CRCT = t;
    return t;
  }
  function crc32(str) {
    var t = crcTable(), b = utf8Bytes(str), c = 0xFFFFFFFF, i;
    for (i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return ((c ^ 0xFFFFFFFF) >>> 0);
  }
  function crc32Hex(str) { return ("0000000" + crc32(str).toString(16)).slice(-8); }

  /* FNV-1a 32-bit. The only source of "randomness" in any deterministic path
     here: a seed picks the scored days through this, never through a
     pseudo-random generator. FNV-1a of "a" is 0xe40c292c, which the gate
     checks against its own implementation. */
  function hash32(str) {
    var h = 0x811c9dc5, s = utf8Bytes(str), i;
    for (i = 0; i < s.length; i++) {
      h ^= s[i];
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  /* ------------------------------------------------- transfer without a file */
  /* A bundle as a stack of short lines a phone can take off a desktop screen
     by retyping or by copying one line at a time. Each line carries:

       DLCARRY1|i/N|<tag>|<crc32>|<payload>

     tag  first 16 hex of the whole-bundle digest — every chunk of one bundle
          carries the same tag, so two bundles cannot be spliced together
     crc  CRC-32 of that chunk's payload, which catches a flipped character
     i/N  1-based index and total, which catches a dropped or duplicated chunk
          and lets a reordered stack be put back in order — and SAID SO, rather
          than silently repaired.

     The payload is base64url of the UTF-8 bundle text, so nothing in a chunk
     can be mistaken for a line break, a quote or a shell character. */
  function chunkText(text, tag, per) {
    var n = Math.max(120, per || CHUNK_CHARS);
    var body = b64uEnc(utf8Bytes(String(text)));
    var total = Math.max(1, Math.ceil(body.length / n));
    var lines = [], i, part;
    for (i = 0; i < total; i++) {
      part = body.slice(i * n, (i + 1) * n);
      lines.push(MAGIC + "|" + (i + 1) + "/" + total + "|" + String(tag).slice(0, 16) + "|" + crc32Hex(part) + "|" + part);
    }
    return lines;
  }

  function joinChunks(input) {
    var raw = (typeof input === "string") ? String(input).split(/[\r\n]+/) : (input || []);
    var lines = [], i;
    for (i = 0; i < raw.length; i++) if (String(raw[i]).replace(/^\s+|\s+$/g, "").length) lines.push(String(raw[i]).replace(/^\s+|\s+$/g, ""));
    if (!lines.length) return { ok: false, reason: "empty", note: "nothing pasted" };

    var seen = {}, total = null, tag = null, badCrc = [], alien = [], order = [], p, m;
    for (i = 0; i < lines.length; i++) {
      m = lines[i].split("|");
      if (m.length < 5 || m[0] !== MAGIC) { alien.push(i + 1); continue; }
      p = m[1].split("/");
      var idx = +p[0], tot = +p[1];
      if (!(idx > 0) || !(tot > 0) || idx > tot) { alien.push(i + 1); continue; }
      if (total === null) total = tot; else if (total !== tot) return { ok: false, reason: "mixed-totals", note: "these lines came from two different bundles — one says " + total + " chunks, another says " + tot };
      if (tag === null) tag = m[2]; else if (tag !== m[2]) return { ok: false, reason: "mixed-bundles", note: "these lines carry two different bundle tags, so they are not chunks of one bundle" };
      var payload = m.slice(4).join("|");
      if (crc32Hex(payload) !== m[3]) { badCrc.push(idx); continue; }
      if (Object.prototype.hasOwnProperty.call(seen, idx)) {
        if (seen[idx] !== payload) return { ok: false, reason: "conflicting-duplicate", note: "chunk " + idx + " appears twice with different contents" };
      } else seen[idx] = payload;
      order.push(idx);
    }
    if (total === null) return { ok: false, reason: "no-chunks", note: "no line here looks like a " + MAGIC + " chunk" };

    var missing = [];
    for (i = 1; i <= total; i++) if (!Object.prototype.hasOwnProperty.call(seen, i)) missing.push(i);
    var reordered = false;
    for (i = 1; i < order.length; i++) if (order[i] < order[i - 1]) { reordered = true; break; }

    if (badCrc.length) return { ok: false, reason: "bad-crc", badCrc: badCrc, missing: missing, reordered: reordered, total: total, tag: tag, note: "chunk " + badCrc.join(", ") + " failed its CRC — a character is wrong. Retype that line." };
    if (missing.length) return { ok: false, reason: "missing-chunk", missing: missing, reordered: reordered, total: total, tag: tag, note: "chunk " + missing.join(", ") + " of " + total + " is not here." };

    var joined = "";
    for (i = 1; i <= total; i++) joined += seen[i];
    var bytes = b64uDec(joined);
    if (!bytes) return { ok: false, reason: "bad-base64", total: total, tag: tag, note: "a chunk payload is not base64url." };
    return {
      ok: true, text: utf8FromBytes(bytes), total: total, tag: tag,
      reordered: reordered, alien: alien, missing: [], badCrc: [],
      note: reordered ? "the chunks arrived out of order and were put back in index order — check you did not skip one" : "all " + total + " chunks present, every CRC matched"
    };
  }

  var DIGEST_ALGO = "SHA-256";

  /* ------------------------------------------------------- envelope checks */
  /* Cheap, synchronous refusals, before a password is asked for and long
     before anything is applied. Every refusal carries a name, because "import
     failed" is not a reason. */
  function envelopeCheck(env) {
    if (!env || typeof env !== "object") return { ok: false, reason: "not-an-object", note: "this is not a bundle." };
    var h = env.header;
    if (!h || typeof h !== "object") return { ok: false, reason: "no-header", note: "no header — a bundle without a header cannot be checked before it is opened." };
    if (h.spec !== SPEC_BUNDLE) return { ok: false, reason: "spec-mismatch", note: "this says it is '" + String(h.spec) + "'. This desk reads '" + SPEC_BUNDLE + "'." };
    var v = +h.bundleVersion;
    if (!(v >= 1)) return { ok: false, reason: "no-version", note: "the header carries no bundle version." };
    if (v > BUNDLE_V) return { ok: false, reason: "version-ahead", note: "this bundle is format v" + v + "; this build reads v" + BUNDLE_V + ". A newer format is refused rather than half-read." };
    if (v < BUNDLE_V) return { ok: false, reason: "version-behind", note: "this bundle is format v" + v + "; this build reads v" + BUNDLE_V + "." };
    if (!h.digest || h.digest.algo !== DIGEST_ALGO || !h.digest.value) return { ok: false, reason: "no-digest", note: "the header carries no " + DIGEST_ALGO + " digest, so nothing can be checked." };
    var enc = h.enc || null;
    if (enc) {
      if (!enc.kdf || enc.kdf.name !== "PBKDF2" || enc.kdf.hash !== "SHA-256") return { ok: false, reason: "unknown-kdf", note: "the header does not describe a PBKDF2-SHA-256 derivation." };
      if (!(+enc.kdf.iterations >= 1)) return { ok: false, reason: "no-iterations", note: "the header carries no PBKDF2 iteration count." };
      if (!enc.kdf.salt) return { ok: false, reason: "no-salt", note: "the header carries no salt." };
      if (enc.cipher !== "AES-GCM" || +enc.bits !== 256) return { ok: false, reason: "unknown-cipher", note: "the header does not describe AES-GCM-256." };
      if (!enc.iv) return { ok: false, reason: "no-iv", note: "the header carries no IV." };
      if (typeof env.ct !== "string" || !env.ct.length) return { ok: false, reason: "no-ciphertext", note: "the header says encrypted but there is no ciphertext." };
      return { ok: true, encrypted: true, reason: null };
    }
    if (!env.body || typeof env.body !== "object") return { ok: false, reason: "no-body", note: "no body, and no ciphertext either." };
    return { ok: true, encrypted: false, reason: null };
  }

  /* ------------------------------------------------------------- diffing */
  /* Three shapes, because the account has three shapes and pretending
     otherwise is how an import quietly eats something.

       list  records with a stable key and a timestamp (fills, journal…)
       set   a bag of symbols with no order and no time (the watchlist)
       map   named values with no timestamp at all (preferences, desk state)

     Only a list can be merged by recency. A set merges by union. A map
     has no honest merge rule, so merge-newer LEAVES IT ALONE and says so —
     silently preferring one side of an unstamped map is a coin flip wearing
     a policy's clothes. */
  function indexBy(arr, keyOf) {
    var m = {}, i, k;
    for (i = 0; i < (arr || []).length; i++) {
      k = String(keyOf(arr[i], i));
      if (!Object.prototype.hasOwnProperty.call(m, k)) m[k] = arr[i];
    }
    return m;
  }
  function listDiff(cur, inc, keyOf, stampOf) {
    var a = indexBy(cur || [], keyOf), b = indexBy(inc || [], keyOf);
    var added = [], changed = [], removed = [], same = 0, k;
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) {
      if (!Object.prototype.hasOwnProperty.call(a, k)) { added.push({ key: k, after: b[k], stamp: stampOf ? stampOf(b[k]) : null }); continue; }
      if (canon(a[k]) === canon(b[k])) { same++; continue; }
      changed.push({ key: k, before: a[k], after: b[k], beforeStamp: stampOf ? stampOf(a[k]) : null, afterStamp: stampOf ? stampOf(b[k]) : null });
    }
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) removed.push({ key: k, before: a[k], stamp: stampOf ? stampOf(a[k]) : null });
    }
    return { kind: "list", added: added, changed: changed, removed: removed, same: same };
  }
  function setDiff(cur, inc) {
    var a = {}, b = {}, i, added = [], removed = [], same = 0;
    for (i = 0; i < (cur || []).length; i++) a[String(cur[i])] = 1;
    for (i = 0; i < (inc || []).length; i++) b[String(inc[i])] = 1;
    var k;
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) { if (a[k]) same++; else added.push({ key: k, after: k }); }
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) { if (!b[k]) removed.push({ key: k, before: k }); }
    return { kind: "set", added: added, changed: [], removed: removed, same: same };
  }
  function mapDiff(cur, inc) {
    var a = cur || {}, b = inc || {}, added = [], changed = [], removed = [], same = 0, k;
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) {
      if (!Object.prototype.hasOwnProperty.call(a, k)) { added.push({ key: k, after: b[k] }); continue; }
      if (canon(a[k]) === canon(b[k])) { same++; continue; }
      changed.push({ key: k, before: a[k], after: b[k] });
    }
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) removed.push({ key: k, before: a[k] });
    }
    return { kind: "map", added: added, changed: changed, removed: removed, same: same };
  }

  /* ------------------------------------------------------------- merging */
  function mergeNewer(cur, inc, keyOf, stampOf, cap) {
    var out = [], m = {}, i, k, s, rec;
    function put(r) {
      k = String(keyOf(r));
      s = +(stampOf ? stampOf(r) : 0) || 0;
      if (!Object.prototype.hasOwnProperty.call(m, k)) { m[k] = { rec: r, stamp: s }; return; }
      if (s > m[k].stamp) m[k] = { rec: r, stamp: s };
    }
    for (i = 0; i < (cur || []).length; i++) put(cur[i]);
    for (i = 0; i < (inc || []).length; i++) put(inc[i]);
    for (k in m) if (Object.prototype.hasOwnProperty.call(m, k)) out.push(m[k]);
    out.sort(function (x, y) { return y.stamp - x.stamp; });
    rec = [];
    for (i = 0; i < out.length; i++) rec.push(out[i].rec);
    if (cap > 0 && rec.length > cap) rec.length = cap;
    return rec;
  }
  function mergeSet(cur, inc) {
    var seen = {}, out = [], i, v;
    for (i = 0; i < (cur || []).length; i++) { v = String(cur[i]); if (!seen[v]) { seen[v] = 1; out.push(cur[i]); } }
    for (i = 0; i < (inc || []).length; i++) { v = String(inc[i]); if (!seen[v]) { seen[v] = 1; out.push(inc[i]); } }
    out.sort();
    return out;
  }
  /* The equity curve is a bare series of numbers with no clock on it, so the
     only honest merge is the one 48-vault uses on the same array: find the
     longest overlap between the tail of one and the head of the other and
     stitch there. No overlap means the two devices recorded disjoint stretches
     and we cannot know which came first — so we keep the longer one and say so. */
  function overlapJoin(a, b) {
    var A = a || [], B = b || [], k, i, ok, max = Math.min(A.length, B.length);
    for (k = max; k > 0; k--) {
      ok = true;
      for (i = 0; i < k; i++) if (A[A.length - k + i] !== B[i]) { ok = false; break; }
      if (ok) return { series: A.concat(B.slice(k)), overlap: k, joined: true };
    }
    for (k = max; k > 0; k--) {
      ok = true;
      for (i = 0; i < k; i++) if (B[B.length - k + i] !== A[i]) { ok = false; break; }
      if (ok) return { series: B.concat(A.slice(k)), overlap: k, joined: true };
    }
    return { series: A.length >= B.length ? A.slice() : B.slice(), overlap: 0, joined: false };
  }

  /* ------------------------------------------------------------ the card */
  /* Normalising the equity series to its first point does two things: it makes
     the shape comparable between two people with very different account sizes,
     and it means the digest over the series does not leak how much money is in
     the account. Six decimal places, so two devices that recorded the same
     curve in different float order still agree on the bytes. */
  function normEquity(series) {
    var s = series || [], i, base = null, out = [];
    for (i = 0; i < s.length; i++) if (isFinite(s[i]) && s[i] > 0) { base = s[i]; break; }
    if (base === null) return [];
    for (i = 0; i < s.length; i++) {
      if (!isFinite(s[i])) continue;
      out.push(+(s[i] / base).toFixed(6));
    }
    return out;
  }
  function dayOf(ms) {
    if (!(ms > 0)) return null;
    try { return new Date(ms).toISOString().slice(0, 10); } catch (e) { return null; }
  }
  function daysBetween(fromDay, toDay) {
    if (!fromDay || !toDay) return null;
    var a = Date.parse(fromDay + "T00:00:00Z"), b = Date.parse(toDay + "T00:00:00Z");
    if (!(a >= 0) || !(b >= 0)) return null;
    return Math.round((b - a) / 86400000) + 1;
  }

  /* cardFrom is pure and takes every figure it prints as an argument, so the
     gate can build a card from a fixture and check, field by field, that the
     hash covers what the desk shows. Nothing is computed here that the engine
     already owns: sharpe and maxDD arrive already computed by DLAPP.paper. */
  function cardFrom(inp) {
    var eq = inp.equityNorm || [];
    var start = eq.length ? eq[0] : null;
    var end = eq.length ? eq[eq.length - 1] : null;
    var ret = (start > 0 && end != null) ? (end / start - 1) * 100 : null;
    var hold = (inp.holdPct == null || !isFinite(inp.holdPct)) ? null : +inp.holdPct;
    var card = {
      spec: SPEC_CARD,
      build: BUILD,
      window: { fromDay: inp.fromDay || null, toDay: inp.toDay || null, days: daysBetween(inp.fromDay, inp.toDay) },
      trades: +inp.trades || 0,
      universe: (inp.universe || []).slice().sort(),
      equity: {
        points: eq.length,
        digest: inp.equityDigest || null,
        normStart: start == null ? null : +start,
        normEnd: end == null ? null : +end
      },
      returnPct: ret == null ? null : +ret.toFixed(4),
      sharpePerSample: (inp.sharpe == null || !isFinite(inp.sharpe)) ? null : +(+inp.sharpe).toFixed(6),
      maxDrawdownPct: (inp.maxDD == null || !isFinite(inp.maxDD)) ? null : +(+inp.maxDD * 100).toFixed(4),
      holdPct: hold == null ? null : +hold.toFixed(4),
      edgeVsHoldPct: (ret == null || hold == null) ? null : +(ret - hold).toFixed(4),
      benchmark: inp.benchmark || null,
      source: inp.source || null
    };
    if (inp.challenge) {
      card.challenge = {
        code: inp.challenge.code || null,
        specDigest: inp.challenge.specDigest || null,
        scoredDays: (inp.challenge.scoredDays || []).slice()
      };
    }
    return card;
  }
  /* What gets hashed and signed: the whole card except the hash and the
     signature themselves. Anything added to a card in a later build is
     therefore covered without touching this function. */
  function cardBody(card) {
    var out = {}, k;
    for (k in card) if (Object.prototype.hasOwnProperty.call(card, k)) {
      if (k === "hash" || k === "sig") continue;
      out[k] = card[k];
    }
    return out;
  }
  /* Resolve a dotted path against a card body — the gate walks CARD_FIELDS
     through this to prove every displayed field is inside the hashed object. */
  function fieldAt(obj, path) {
    var parts = String(path).split("."), cur = obj, i;
    for (i = 0; i < parts.length; i++) {
      if (cur === null || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, parts[i])) return { has: false, value: undefined };
      cur = cur[parts[i]];
    }
    return { has: true, value: cur };
  }

  /* --------------------------------------------------------- challenges */
  /* A challenge is a scoring contract, not a backtest engine. Two people agree
     on the seed, the window, the universe and the rule, each runs it against
     their own device's record, and the two result cards are comparable because
     the inputs were byte-identical — the code carries the digest that proves
     it. The seed picks WHICH days inside the window are scored, so neither
     side can choose a flattering stretch after the fact. */
  var RULES = {
    "score.all": "score every day in the window",
    "score.seedsample": "score only the days the seed picks, so the window cannot be trimmed after the fact"
  };
  function challengeSpec(inp) {
    var rule = (inp && RULES[inp.rule]) ? inp.rule : "score.seedsample";
    var uni = (inp && inp.universe || []).slice().sort();
    var sample = Math.max(1, Math.min(365, +(inp && inp.sampleDays) || 30));
    return {
      spec: SPEC_CHAL,
      build: BUILD,
      seed: String((inp && inp.seed) || "").slice(0, 64),
      fromDay: (inp && inp.fromDay) || null,
      toDay: (inp && inp.toDay) || null,
      universe: uni,
      rule: rule,
      sampleDays: rule === "score.seedsample" ? sample : null
    };
  }
  function challengeCode(spec) {
    var payload = b64uEnc(utf8Bytes(canon(spec)));
    return "DLXC1." + payload + "." + crc32Hex(payload);
  }
  function parseChallenge(code) {
    var s = String(code || "").replace(/\s+/g, "");
    var parts = s.split(".");
    if (parts.length !== 3 || parts[0] !== "DLXC1") return { ok: false, reason: "not-a-challenge", note: "a challenge code looks like DLXC1.<payload>.<crc>" };
    if (crc32Hex(parts[1]) !== parts[2]) return { ok: false, reason: "bad-crc", note: "the code's checksum does not match — a character is wrong." };
    var bytes = b64uDec(parts[1]);
    if (!bytes) return { ok: false, reason: "bad-base64", note: "the payload is not base64url." };
    var obj = null;
    try { obj = JSON.parse(utf8FromBytes(bytes)); } catch (e) { obj = null; }
    if (!obj || obj.spec !== SPEC_CHAL) return { ok: false, reason: "spec-mismatch", note: "this is not a DexLadder challenge." };
    if (!RULES[obj.rule]) return { ok: false, reason: "unknown-rule", note: "this challenge names a rule this build does not have: " + String(obj.rule) };
    return { ok: true, spec: obj, reason: null };
  }
  /* Deterministic, order-stable day selection: each day is ranked by the FNV-1a
     hash of seed + the day, and the lowest k are scored. Same seed and same
     window on two devices pick the same days, every time, with no shared state. */
  function pickDays(seed, days, k) {
    var list = (days || []).slice(), scored = [], i;
    for (i = 0; i < list.length; i++) scored.push({ d: list[i], h: hash32(String(seed) + "|" + list[i]) });
    scored.sort(function (a, b) { return a.h === b.h ? (a.d < b.d ? -1 : 1) : (a.h - b.h); });
    var take = Math.max(0, Math.min(scored.length, k || 0)), out = [];
    for (i = 0; i < take; i++) out.push(scored[i].d);
    out.sort();
    return out;
  }
  /* </carry-kernel> */

  /* ==========================================================================
     Everything below touches the browser: WebCrypto, the account, the DOM.
     ========================================================================== */

  /* ------------------------------------------------------------- WebCrypto */
  /* One place decides whether cryptography is available, and it names the
     reason it is not. An export NEVER degrades to plaintext because a digest
     or a cipher was missing — a bundle you believed was encrypted and was not
     is worse than no bundle at all. */
  function cryptoState() {
    var secure = true, subtle = null, rnd = null;
    try { if (typeof window.isSecureContext === "boolean") secure = window.isSecureContext; } catch (e) { secure = true; }
    try { subtle = window.crypto && window.crypto.subtle ? window.crypto.subtle : null; } catch (e) { subtle = null; }
    try { rnd = window.crypto && window.crypto.getRandomValues ? 1 : null; } catch (e) { rnd = null; }
    if (!secure) return { ok: false, reason: "insecure-context", note: "this page is not in a secure context, so the browser withholds WebCrypto. Nothing can be digested, encrypted or signed here, and this desk will not pretend otherwise." };
    if (!subtle) return { ok: false, reason: "webcrypto-missing", note: "this browser exposes no crypto.subtle. Nothing can be digested, encrypted or signed here." };
    if (!rnd) return { ok: false, reason: "randomness-missing", note: "this browser exposes no crypto.getRandomValues. An AES-GCM IV drawn any other way is a security bug, so the export refuses." };
    return { ok: true, reason: null, note: null };
  }
  function subtle() { return window.crypto.subtle; }
  function randomBytes(n) {
    var a = new Uint8Array(n);
    window.crypto.getRandomValues(a);
    return a;
  }
  function u8(arr) {
    var a = new Uint8Array(arr.length), i;
    for (i = 0; i < arr.length; i++) a[i] = arr[i] & 0xff;
    return a;
  }
  function arr(buf) {
    var b = new Uint8Array(buf), o = [], i;
    for (i = 0; i < b.length; i++) o.push(b[i]);
    return o;
  }

  function sha256Hex(str) {
    var st = cryptoState();
    if (!st.ok) return Promise.resolve(null);
    return subtle().digest("SHA-256", u8(utf8Bytes(str)))
      .then(function (d) { return hexOf(arr(d)); })["catch"](function () { return null; });
  }

  function deriveAesKey(password, saltBytes, iterations) {
    return subtle().importKey("raw", u8(utf8Bytes(String(password))), { name: "PBKDF2" }, false, ["deriveKey"])
      .then(function (base) {
        return subtle().deriveKey(
          { name: "PBKDF2", salt: u8(saltBytes), iterations: iterations, hash: "SHA-256" },
          base,
          { name: CIPHER.name, length: CIPHER.bits },
          false,
          ["encrypt", "decrypt"]
        );
      });
  }

  /* ------------------------------------------------------------ the account */
  function Sref() { try { return (typeof S === "undefined") ? null : S; } catch (e) { return null; } }
  function bucket() {
    var X = null;
    try { X = C.X(); } catch (e) { X = null; }
    if (!X) return null;
    if (!X.carry) X.carry = {};
    var b = X.carry;
    if (!b.prefs) b.prefs = { policy: "preview", chunk: CHUNK_CHARS, windowDays: 365, includeKey: false };
    if (!b.cards) b.cards = [];
    return b;
  }
  function saveBucket() { try { C.save(); } catch (e) {} }

  function liveArr(prop) {
    var s = Sref();
    try { return (s && Object.prototype.toString.call(s[prop]) === "[object Array]") ? s[prop] : []; } catch (e) { return []; }
  }
  function setArr(prop, v) { var s = Sref(); if (s) s[prop] = v; }

  function watchArr() {
    var s = Sref();
    try {
      if (!s || !s.watch) return [];
      if (Object.prototype.toString.call(s.watch) === "[object Array]") return s.watch.slice();
      if (typeof s.watch.forEach === "function") { var o = []; s.watch.forEach(function (v) { o.push(v); }); return o.sort(); }
      return [];
    } catch (e) { return []; }
  }
  function setWatch(list) {
    var s = Sref();
    if (!s) return false;
    try {
      if (s.watch && typeof s.watch.add === "function" && typeof s.watch.clear === "function") {
        s.watch.clear();
        for (var i = 0; i < list.length; i++) s.watch.add(list[i]);
        return true;
      }
      s.watch = list.slice();
      return true;
    } catch (e) { return false; }
  }

  /* desk state is the whole v154 bucket minus this layer's signing key — an
     export you hand someone should not carry the key that signs your cards.
     48-vault learned this the same way and excludes its own key by default. */
  function desksMap(includeKey) {
    var X = null;
    try { X = C.X(); } catch (e) { X = null; }
    if (!X) return {};
    var out = {}, k;
    for (k in X) if (Object.prototype.hasOwnProperty.call(X, k)) {
      if (k === "carry") {
        var c = {}, kk;
        for (kk in X.carry) if (Object.prototype.hasOwnProperty.call(X.carry, kk)) {
          if (!includeKey && (kk === "key" || kk === "pub")) continue;
          c[kk] = X.carry[kk];
        }
        out.carry = c;
        continue;
      }
      out[k] = X[k];
    }
    return out;
  }
  function setDeskKey(k, v) {
    var X = null;
    try { X = C.X(); } catch (e) { X = null; }
    if (!X) return false;
    if (k === "carry") {
      var keep = X.carry || {}, merged = {}, kk;
      for (kk in v) if (Object.prototype.hasOwnProperty.call(v, kk)) merged[kk] = v[kk];
      /* never lose the local signing key to a bundle that simply did not carry one */
      if (keep.key && !merged.key) merged.key = keep.key;
      if (keep.pub && !merged.pub) merged.pub = keep.pub;
      X.carry = merged;
      return true;
    }
    X[k] = v;
    return true;
  }
  function delDeskKey(k) {
    var X = null;
    try { X = C.X(); } catch (e) { X = null; }
    if (!X || k === "carry") return false;
    try { delete X[k]; return true; } catch (e) { return false; }
  }

  var PREF_KEYS = ["ws", "dispQ", "cat", "chartEngine", "bookMode", "memes", "dcaEvery", "tradeW"];
  function prefsMap() {
    var s = Sref(), o = {}, i;
    if (!s) return o;
    for (i = 0; i < PREF_KEYS.length; i++) if (typeof s[PREF_KEYS[i]] !== "undefined") o[PREF_KEYS[i]] = s[PREF_KEYS[i]];
    return o;
  }
  function setPref(k, v) { var s = Sref(); if (s && PREF_KEYS.indexOf(k) >= 0) { s[k] = v; return true; } return false; }

  /* ------------------------------------------------------------- sections */
  /* applies:false is not a shrug. The balances section is carried so the
     bundle is a complete record and the digest covers it, and it is never
     written back, because law 6 of this codebase says money moves only through
     the engine. The import report says this on the row, every time. */
  var SECTIONS = [
    {
      id: "account", label: "Balances, basis and stats", kind: "map", applies: false,
      why: "money moves only through the engine — this desk carries your balances for the record and never writes one back. Re-fund the new device from the trading ticket.",
      get: function () {
        var s = Sref();
        if (!s) return {};
        return { bal: s.bal || {}, deposited: +s.deposited || 0, basis: s.basis || {}, stats: s.stats || null };
      }
    },
    {
      id: "fills", label: "Fills", kind: "list", applies: true, cap: 240,
      get: function () { return liveArr("txns"); },
      set: function (v) { setArr("txns", v); },
      keyOf: function (r) { return [r && r.t, r && r.type, r && r.sym, r && r.amt].join("|"); },
      stampOf: function (r) { return (r && +r.t) || 0; }
    },
    {
      id: "journal", label: "Journal", kind: "list", applies: true, cap: 200,
      get: function () { return liveArr("journal"); },
      set: function (v) { setArr("journal", v); },
      keyOf: function (r) { return r && r.id != null ? "id:" + r.id : (r && r.t != null ? "t:" + r.t : "j:" + canon(r)); },
      stampOf: function (r) { return (r && (+r.t || +r.created)) || 0; }
    },
    {
      id: "alerts", label: "Alerts", kind: "list", applies: true, cap: 120,
      get: function () { return liveArr("alerts"); },
      set: function (v) { setArr("alerts", v); },
      keyOf: function (r) { return r && r.id != null ? "id:" + r.id : "a:" + canon(r); },
      stampOf: function (r) { return (r && (+r.created || +r.t)) || 0; }
    },
    {
      id: "orders", label: "Resting orders", kind: "list", applies: true, cap: 80,
      get: function () { return liveArr("orders"); },
      set: function (v) { setArr("orders", v); },
      keyOf: function (r) { return r && r.id != null ? "id:" + r.id : "o:" + canon(r); },
      stampOf: function (r) { return (r && (+r.t || +r.created)) || 0; }
    },
    {
      id: "equity", label: "Equity curve", kind: "series", applies: true,
      get: function () { return liveArr("equityHist"); },
      set: function (v) { setArr("equityHist", v.length > 240 ? v.slice(v.length - 240) : v); }
    },
    {
      id: "watch", label: "Watchlist", kind: "set", applies: true,
      get: watchArr, set: setWatch
    },
    {
      id: "desks", label: "Desk state (the v154 bucket)", kind: "map", applies: true,
      get: function () { return desksMap(!!(bucket() && bucket().prefs.includeKey)); },
      setKey: setDeskKey, delKey: delDeskKey
    },
    {
      id: "prefs", label: "Preferences", kind: "map", applies: true,
      get: prefsMap, setKey: setPref, delKey: function () { return false; }
    }
  ];
  function sectionById(id) { var i; for (i = 0; i < SECTIONS.length; i++) if (SECTIONS[i].id === id) return SECTIONS[i]; return null; }
  function countOf(sec, v) {
    if (sec.kind === "list" || sec.kind === "set" || sec.kind === "series") return (v || []).length;
    var n = 0, k;
    for (k in (v || {})) if (Object.prototype.hasOwnProperty.call(v, k)) n++;
    return n;
  }

  /* ------------------------------------------------------ continuity export */
  function collect(includeKey) {
    var sections = {}, index = [], i, sec, v;
    for (i = 0; i < SECTIONS.length; i++) {
      sec = SECTIONS[i];
      v = null;
      try { v = sec.id === "desks" ? desksMap(includeKey) : sec.get(); } catch (e) { v = null; }
      if (v === null || typeof v === "undefined") v = (sec.kind === "map") ? {} : [];
      sections[sec.id] = v;
      index.push({ id: sec.id, label: sec.label, kind: sec.kind, count: countOf(sec, v), applies: !!sec.applies });
    }
    return { sections: sections, index: index };
  }

  /* The body is the thing the digest is over, and it carries NO clock: the same
     state exported twice produces the same bytes and the same digest, which is
     what makes a digest worth checking. The wall time lives in the header,
     outside the digest, where it cannot make two identical desks disagree. */
  function bodyOf(includeKey) {
    var c = collect(includeKey);
    return { body: { spec: SPEC_BUNDLE, bundleVersion: BUNDLE_V, build: BUILD, sections: c.sections }, index: c.index };
  }

  function build(opts) {
    opts = opts || {};
    var st = cryptoState();
    if (!st.ok) return Promise.resolve({ ok: false, reason: st.reason, note: st.note });

    var includeKey = !!opts.includeKey;
    var pw = typeof opts.password === "string" ? opts.password : "";
    var made = bodyOf(includeKey);
    var body = made.body;
    var text = canon(body);

    return sha256Hex(text).then(function (digest) {
      if (!digest) return { ok: false, reason: "digest-failed", note: "the browser refused to compute a SHA-256 digest, so there is nothing to sign the bundle's integrity with. Nothing was exported." };
      var header = {
        spec: SPEC_BUNDLE, bundleVersion: BUNDLE_V, build: BUILD,
        createdAt: C.now ? C.now() : 0,
        keyIncluded: includeKey,
        plaintext: !pw.length,
        sections: made.index,
        digest: { algo: DIGEST.algo, of: DIGEST.of, value: digest },
        enc: null
      };
      if (!pw.length) {
        var envP = { header: header, body: body };
        return finish(envP, digest, true, made.index);
      }
      var salt = randomBytes(KDF_SALT_BYTES), iv = randomBytes(CIPHER.ivBytes);
      return deriveAesKey(pw, arr(salt), KDF_ITERATIONS).then(function (key) {
        return subtle().encrypt({ name: CIPHER.name, iv: iv, tagLength: CIPHER.tagBits }, key, u8(utf8Bytes(text)));
      }).then(function (ct) {
        header.enc = {
          cipher: CIPHER.name, bits: CIPHER.bits, tagBits: CIPHER.tagBits,
          iv: b64uEnc(arr(iv)),
          kdf: { name: "PBKDF2", hash: "SHA-256", iterations: KDF_ITERATIONS, salt: b64uEnc(arr(salt)), source: "OWASP Password Storage Cheat Sheet, 2023" }
        };
        var envC = { header: header, ct: b64uEnc(arr(ct)) };
        return finish(envC, digest, false, made.index);
      })["catch"](function (e) {
        return { ok: false, reason: "encrypt-failed", note: "the browser refused to derive a key or encrypt: " + String((e && e.message) || e) + ". Nothing was exported, and nothing was written out in the clear." };
      });
    });
  }
  function finish(env, digest, plaintext, index) {
    var out = JSON.stringify(env, null, 2);
    return {
      ok: true, reason: null, envelope: env, text: out, digest: digest,
      plaintext: plaintext, bytes: utf8Bytes(out).length, index: index,
      tag: digest.slice(0, 16)
    };
  }

  /* ------------------------------------------------------ continuity import */
  function readText(raw) {
    var s = String(raw || "").replace(/^\s+|\s+$/g, "");
    if (!s.length) return { ok: false, reason: "empty", note: "nothing pasted." };
    if (s.indexOf(MAGIC) === 0 || s.indexOf("\n" + MAGIC) > 0) {
      var j = joinChunks(s);
      if (!j.ok) return { ok: false, reason: j.reason, note: j.note, chunks: j };
      return { ok: true, text: j.text, chunks: j };
    }
    return { ok: true, text: s, chunks: null };
  }

  function inspect(raw, password) {
    var r = readText(raw);
    if (!r.ok) return Promise.resolve(r);
    var env = null;
    try { env = JSON.parse(r.text); } catch (e) { env = null; }
    if (!env) return Promise.resolve({ ok: false, reason: "not-json", note: "this is not a bundle — it does not parse as JSON." });

    var chk = envelopeCheck(env);
    if (!chk.ok) return Promise.resolve({ ok: false, reason: chk.reason, note: chk.note, header: env.header || null });

    var st = cryptoState();
    if (!st.ok) return Promise.resolve({ ok: false, reason: st.reason, note: st.note + " An import cannot verify a digest without it, and this desk will not apply a bundle it has not verified.", header: env.header });

    var step;
    if (chk.encrypted) {
      if (typeof password !== "string" || !password.length) {
        return Promise.resolve({ ok: false, reason: "password-required", note: "this bundle is encrypted with AES-GCM-256 under a PBKDF2-SHA-256 key at " + env.header.enc.kdf.iterations + " iterations. It needs its password.", header: env.header, chunks: r.chunks });
      }
      var salt = b64uDec(env.header.enc.kdf.salt), iv = b64uDec(env.header.enc.iv), ct = b64uDec(env.ct);
      if (!salt || !iv || !ct) return Promise.resolve({ ok: false, reason: "bad-header-bytes", note: "the salt, the IV or the ciphertext is not base64url.", header: env.header });
      if (iv.length !== CIPHER.ivBytes) return Promise.resolve({ ok: false, reason: "bad-iv-length", note: "the IV is " + iv.length + " bytes; AES-GCM here uses " + CIPHER.ivBytes + ".", header: env.header });
      step = deriveAesKey(password, salt, +env.header.enc.kdf.iterations)
        .then(function (key) { return subtle().decrypt({ name: CIPHER.name, iv: u8(iv), tagLength: +env.header.enc.tagBits || CIPHER.tagBits }, key, u8(ct)); })
        .then(function (pt) { return utf8FromBytes(arr(pt)); })
        ["catch"](function () { return null; });
    } else {
      step = Promise.resolve(canon(env.body));
    }

    return step.then(function (bodyText) {
      if (bodyText === null) return { ok: false, reason: "bad-password", note: "AES-GCM refused this ciphertext: either the password is wrong or the bundle has been altered. GCM cannot tell the two apart, and neither can this desk.", header: env.header };
      var body = null;
      try { body = JSON.parse(bodyText); } catch (e) { body = null; }
      if (!body || typeof body !== "object") return { ok: false, reason: "bad-body", note: "the body did not parse.", header: env.header };

      /* THE DIGEST COMES FIRST. Nothing below this line runs — no diff, no
         apply, not even a count on screen — until the bytes have been proved
         to be the bytes that were digested at export. */
      return sha256Hex(canon(body)).then(function (digest) {
        if (!digest) return { ok: false, reason: "digest-failed", note: "the browser could not compute a digest, so this bundle cannot be verified. It will not be applied.", header: env.header };
        if (digest !== env.header.digest.value) {
          return {
            ok: false, reason: "digest-mismatch", header: env.header, digest: digest,
            note: "the digest does not match. The header claims " + String(env.header.digest.value).slice(0, 16) + "…, the body is " + digest.slice(0, 16) + "…. Something changed between export and here. Nothing was applied."
          };
        }
        if (body.spec !== SPEC_BUNDLE || +body.bundleVersion !== BUNDLE_V) {
          return { ok: false, reason: "header-body-mismatch", header: env.header, note: "the header and the body disagree about what this bundle is." };
        }
        return dryRun(body, env.header, digest, r.chunks);
      });
    });
  }

  /* ------------------------------------------------------------- the dry run */
  /* What WOULD change, per section, added / changed / removed, before and
     after — computed for all three policies at once so switching the policy
     does not need a second pass over the bundle. */
  function dryRun(body, header, digest, chunks) {
    var rows = [], i, sec, inc, cur, d;
    var incoming = body.sections || {};
    for (i = 0; i < SECTIONS.length; i++) {
      sec = SECTIONS[i];
      cur = null;
      try { cur = sec.id === "desks" ? desksMap(true) : sec.get(); } catch (e) { cur = null; }
      if (!Object.prototype.hasOwnProperty.call(incoming, sec.id)) {
        rows.push({ id: sec.id, label: sec.label, kind: sec.kind, applies: sec.applies, why: sec.why || null, present: false, note: "this bundle does not carry this section — nothing here is touched under any policy." });
        continue;
      }
      inc = incoming[sec.id];
      if (sec.kind === "list") d = listDiff(cur || [], inc || [], sec.keyOf, sec.stampOf);
      else if (sec.kind === "set") d = setDiff(cur || [], inc || []);
      else if (sec.kind === "series") {
        var oj = overlapJoin(cur || [], inc || []);
        d = {
          kind: "series", added: [], changed: [], removed: [], same: 0,
          series: { curPoints: (cur || []).length, incPoints: (inc || []).length, mergedPoints: oj.series.length, overlap: oj.overlap, joined: oj.joined }
        };
      } else d = mapDiff(cur || {}, inc || {});
      rows.push({
        id: sec.id, label: sec.label, kind: sec.kind, applies: sec.applies, why: sec.why || null,
        present: true, curCount: countOf(sec, cur), incCount: countOf(sec, inc), diff: d,
        stamped: sec.kind === "list",
        mergeNote: sec.kind === "list"
          ? "merge-newer compares per-record timestamps and keeps the newer of each."
          : (sec.kind === "set" ? "merge-newer takes the union — a watchlist has no timestamps, so nothing is dropped."
            : (sec.kind === "series" ? "merge-newer stitches the two curves at their longest overlap; with no overlap it keeps the longer one and says so."
              : "merge-newer LEAVES THIS ALONE — it carries no per-record timestamp, and preferring one side of an unstamped map is a coin flip, not a policy."))
      });
    }

    /* A section this build has never heard of is NOT dropped. It is named, it
       is counted, and on apply it is parked in the bucket so a later build can
       pick it up. Silently discarding it would make an import lossy in exactly
       the way a continuity tool must never be. */
    var unknown = [], k;
    for (k in incoming) if (Object.prototype.hasOwnProperty.call(incoming, k)) {
      if (!sectionById(k)) unknown.push({ id: k, canonBytes: canon(incoming[k]).length, preview: canon(incoming[k]).slice(0, 160) });
    }

    return {
      ok: true, reason: null, header: header, body: body, digest: digest, chunks: chunks || null,
      rows: rows, unknown: unknown,
      note: "digest verified — " + digest.slice(0, 16) + "…. Nothing has been applied yet."
    };
  }

  /* ---------------------------------------------------------------- apply */
  function apply(report, policy) {
    if (!report || !report.ok || !report.body) return { ok: false, reason: "nothing-verified", note: "there is no verified bundle to apply." };
    policy = policy === "replace" ? "replace" : (policy === "merge-newer" ? "merge-newer" : "preview");
    if (policy === "preview") return { ok: false, reason: "preview-only", note: "preview-only: nothing was written. Pick replace or merge-newer to apply." };

    var incoming = report.body.sections || {}, applied = [], skipped = [], i, sec, inc, cur;
    for (i = 0; i < SECTIONS.length; i++) {
      sec = SECTIONS[i];
      if (!Object.prototype.hasOwnProperty.call(incoming, sec.id)) { skipped.push({ id: sec.id, why: "not in this bundle" }); continue; }
      if (!sec.applies) { skipped.push({ id: sec.id, why: sec.why }); continue; }
      inc = incoming[sec.id];
      try { cur = sec.id === "desks" ? desksMap(true) : sec.get(); } catch (e) { cur = null; }

      if (sec.kind === "list") {
        if (policy === "replace") { sec.set((inc || []).slice(0, sec.cap || 240)); applied.push({ id: sec.id, how: "replaced", n: (inc || []).length }); }
        else { var m = mergeNewer(cur || [], inc || [], sec.keyOf, sec.stampOf, sec.cap || 240); sec.set(m); applied.push({ id: sec.id, how: "merged by timestamp", n: m.length }); }
      } else if (sec.kind === "set") {
        var s2 = policy === "replace" ? (inc || []).slice() : mergeSet(cur || [], inc || []);
        var okSet = sec.set(s2);
        if (okSet) applied.push({ id: sec.id, how: policy === "replace" ? "replaced" : "union", n: s2.length });
        else skipped.push({ id: sec.id, why: "the watchlist could not be written on this build" });
      } else if (sec.kind === "series") {
        if (policy === "replace") { sec.set((inc || []).slice()); applied.push({ id: sec.id, how: "replaced", n: (inc || []).length }); }
        else { var oj = overlapJoin(cur || [], inc || []); sec.set(oj.series); applied.push({ id: sec.id, how: oj.joined ? "stitched at an overlap of " + oj.overlap : "kept the longer curve — the two did not overlap", n: oj.series.length }); }
      } else {
        if (policy === "merge-newer") { skipped.push({ id: sec.id, why: "unstamped map — merge-newer leaves it alone" }); continue; }
        var k, n = 0;
        for (k in (inc || {})) if (Object.prototype.hasOwnProperty.call(inc, k)) { if (sec.setKey(k, inc[k])) n++; }
        if (sec.delKey) {
          for (k in (cur || {})) if (Object.prototype.hasOwnProperty.call(cur, k)) { if (!Object.prototype.hasOwnProperty.call(inc || {}, k)) sec.delKey(k); }
        }
        applied.push({ id: sec.id, how: "replaced key by key", n: n });
      }
    }

    /* park anything this build does not understand, rather than dropping it */
    if (report.unknown && report.unknown.length) {
      var b = bucket();
      if (b) {
        b.carried = { at: C.now ? C.now() : 0, from: report.header ? report.header.build : null, sections: {} };
        for (i = 0; i < report.unknown.length; i++) b.carried.sections[report.unknown[i].id] = incoming[report.unknown[i].id];
      }
    }

    saveBucket();
    try { if (typeof updateNavBal === "function") updateNavBal(); } catch (e) {}
    try { C.toast && C.toast("good", "Bundle applied", applied.length + " sections written · " + skipped.length + " left alone"); } catch (e) {}
    return { ok: true, policy: policy, applied: applied, skipped: skipped, carried: (report.unknown || []).length };
  }

  /* ============================================================== proof cards */

  /* ------------------------------------------------------------ the key */
  /* Generated here, kept here, exported never. It lives in the v154 bucket
     beside the rest of the desk, which means it is exactly as private as this
     browser profile is — no more. That is stated on the card tab, because a
     key that is "on-device" is not the same as a key that is safe. */
  var KEYS = null;
  function ensureKey() {
    var st = cryptoState();
    if (!st.ok) return Promise.resolve({ ok: false, reason: st.reason, note: st.note });
    if (KEYS) return Promise.resolve({ ok: true, keys: KEYS });
    var b = bucket();
    if (!b) return Promise.resolve({ ok: false, reason: "no-bucket", note: "the account is not ready yet." });

    if (b.key && b.pub) {
      var pk = b64uDec(b.key), pub = b64uDec(b.pub);
      if (pk && pub) {
        return Promise.all([
          subtle().importKey("pkcs8", u8(pk), { name: SIG.name, namedCurve: SIG.curve }, false, ["sign"]),
          subtle().importKey("raw", u8(pub), { name: SIG.name, namedCurve: SIG.curve }, true, ["verify"])
        ]).then(function (pair) {
          KEYS = { priv: pair[0], pub: pair[1], pubB64: b.pub };
          return { ok: true, keys: KEYS };
        })["catch"](function () { return generateKey(); });
      }
    }
    return generateKey();
  }
  function generateKey() {
    return subtle().generateKey({ name: SIG.name, namedCurve: SIG.curve }, true, ["sign", "verify"])
      .then(function (kp) {
        return Promise.all([
          subtle().exportKey("pkcs8", kp.privateKey),
          subtle().exportKey("raw", kp.publicKey)
        ]).then(function (raw) {
          var b = bucket();
          if (b) { b.key = b64uEnc(arr(raw[0])); b.pub = b64uEnc(arr(raw[1])); saveBucket(); }
          KEYS = { priv: kp.privateKey, pub: kp.publicKey, pubB64: b ? b.pub : b64uEnc(arr(raw[1])) };
          return { ok: true, keys: KEYS, fresh: true };
        });
      })["catch"](function (e) {
        return { ok: false, reason: "keygen-failed", note: "the browser refused to generate an ECDSA P-256 key: " + String((e && e.message) || e) };
      });
  }
  function forgetKey() {
    var b = bucket();
    if (!b) return false;
    delete b.key; delete b.pub;
    KEYS = null;
    saveBucket();
    return true;
  }

  /* -------------------------------------------------------- the benchmark */
  /* The only local price history this app keeps is the Era Ledger: one
     top-100 snapshot a week, recorded on this device from the day it was first
     opened. That is the buy-and-hold series. No history on the device means no
     benchmark and a null edge — not a zero, and not a number from elsewhere,
     because there is no elsewhere: this layer makes no request. */
  function eraWeeks() {
    var st = null;
    try { if (window.DLLEDG && typeof window.DLLEDG.eraStore === "function") st = window.DLLEDG.eraStore(); } catch (e) { st = null; }
    if (!st) { try { st = C.lsGet("dl.era.v1"); } catch (e) { st = null; } }
    return (st && st.weeks) ? st.weeks : {};
  }
  function btcAt(week) {
    var rows = week || [], i;
    for (i = 0; i < rows.length; i++) if (rows[i] && rows[i][0] === "BTC" && +rows[i][2] > 0) return +rows[i][2];
    return null;
  }
  function holdReturn(fromDay, toDay) {
    var weeks = eraWeeks(), keys = [], k;
    for (k in weeks) if (Object.prototype.hasOwnProperty.call(weeks, k)) keys.push(k);
    keys.sort();
    var inRange = [], i;
    for (i = 0; i < keys.length; i++) if ((!fromDay || keys[i] >= fromDay) && (!toDay || keys[i] <= toDay)) inRange.push(keys[i]);
    if (inRange.length < 2) return { pct: null, reason: "the Era Ledger on this device has fewer than two weekly snapshots inside this window, so there is no buy-and-hold series to measure against. The edge stays missing rather than becoming a zero.", from: null, to: null, weeks: inRange.length };
    var p0 = btcAt(weeks[inRange[0]]), p1 = btcAt(weeks[inRange[inRange.length - 1]]);
    if (!(p0 > 0) || !(p1 > 0)) return { pct: null, reason: "the Era Ledger weeks in this window carry no BTC price.", from: inRange[0], to: inRange[inRange.length - 1], weeks: inRange.length };
    return { pct: (p1 / p0 - 1) * 100, reason: null, from: inRange[0], to: inRange[inRange.length - 1], weeks: inRange.length };
  }

  /* ------------------------------------------------------- the metrics */
  function fillsIn(fromMs, universe) {
    var all = liveArr("txns"), out = [], i, r, uni = null, j;
    if (universe && universe.length) { uni = {}; for (j = 0; j < universe.length; j++) uni[String(universe[j]).toUpperCase()] = 1; }
    for (i = 0; i < all.length; i++) {
      r = all[i];
      if (!r || !(+r.t > 0)) continue;
      if (fromMs > 0 && +r.t < fromMs) continue;
      if (uni && !uni[String(r.sym || "").toUpperCase()]) continue;
      out.push(r);
    }
    return out;
  }
  function universeOf(fills) {
    var seen = {}, out = [], i, s;
    for (i = 0; i < fills.length; i++) {
      s = String(fills[i].sym || "").toUpperCase();
      if (!s || seen[s]) continue;
      seen[s] = 1; out.push(s);
    }
    out.sort();
    return out;
  }
  /* sharpe and maxDrawdown are the engine's, not this layer's. periodsPerYear
     is 1 ON PURPOSE: the equity series is sampled on a render tick, deduped
     when nothing moved, and carries no timestamps at all, so there is no
     honest periods-per-year to annualise by. The card prints it as a
     PER-SAMPLE ratio and says so. */
  function metricsOf(series) {
    var p = P();
    var eq = (series || []).slice();
    if (eq.length < 3) return { sharpe: null, maxDD: null, why: "fewer than three equity samples on this device — nothing to measure." };
    var sharpe = null, maxDD = null;
    try { sharpe = p && p.sharpe ? p.sharpe(p.returns(eq), 1, 0) : null; } catch (e) { sharpe = null; }
    try { var d = p && p.maxDrawdown ? p.maxDrawdown(eq) : null; maxDD = d ? d.maxDD : null; } catch (e) { maxDD = null; }
    return { sharpe: sharpe, maxDD: maxDD, why: (p ? null : "the paper engine is not loaded, so the ratios are missing rather than invented.") };
  }

  /* --------------------------------------------------------- build a card */
  function buildCard(opts) {
    opts = opts || {};
    var st = cryptoState();
    if (!st.ok) return Promise.resolve({ ok: false, reason: st.reason, note: st.note });

    var days = +opts.windowDays > 0 ? +opts.windowDays : 365;
    var now = C.now ? C.now() : 0;
    var fromMs = days >= 36500 ? 0 : (now - days * 86400000);
    var fills = fillsIn(fromMs, opts.universe || null);
    var uni = (opts.universe && opts.universe.length) ? opts.universe.slice() : universeOf(fills);
    var firstT = null, lastT = null, i;
    for (i = 0; i < fills.length; i++) {
      if (firstT === null || fills[i].t < firstT) firstT = fills[i].t;
      if (lastT === null || fills[i].t > lastT) lastT = fills[i].t;
    }
    var fromDay = dayOf(firstT) || dayOf(fromMs > 0 ? fromMs : now);
    var toDay = dayOf(lastT) || dayOf(now);

    var eq = normEquity(liveArr("equityHist"));
    var m = metricsOf(liveArr("equityHist"));
    var hold = holdReturn(fromDay, toDay);

    return sha256Hex(canon(eq)).then(function (eqDigest) {
      var card = cardFrom({
        fromDay: fromDay, toDay: toDay,
        trades: fills.length,
        universe: uni,
        equityNorm: eq,
        equityDigest: eqDigest,
        sharpe: m.sharpe, maxDD: m.maxDD,
        holdPct: hold.pct,
        benchmark: hold.pct == null ? null : ("buy and hold BTC, priced from the Era Ledger weeks this device recorded between " + hold.from + " and " + hold.to),
        source: "DexLadder paper account, this device",
        challenge: opts.challenge || null
      });
      return signCard(card).then(function (signed) {
        signed.notes = [];
        if (m.why) signed.notes.push(m.why);
        if (hold.reason) signed.notes.push(hold.reason);
        if (!eq.length) signed.notes.push("no equity samples on this device, so the curve figures are missing.");
        return signed;
      });
    });
  }

  function signCard(card) {
    var body = cardBody(card), text = canon(body);
    return sha256Hex(text).then(function (hash) {
      if (!hash) return { ok: false, reason: "digest-failed", note: "the browser could not digest the card." };
      return ensureKey().then(function (kr) {
        if (!kr.ok) return { ok: false, reason: kr.reason, note: kr.note, card: card, hash: hash };
        return subtle().sign({ name: SIG.name, hash: { name: SIG.hash } }, kr.keys.priv, u8(utf8Bytes(text)))
          .then(function (sig) {
            card.hash = { algo: DIGEST.algo, of: "canonical-json(card minus hash and sig)", value: hash };
            card.sig = { alg: "ECDSA-P256-SHA256", curve: SIG.curve, pub: kr.keys.pubB64, value: b64uEnc(arr(sig)) };
            return { ok: true, card: card, hash: hash, text: JSON.stringify(card, null, 2), fresh: !!kr.fresh };
          })["catch"](function (e) {
            return { ok: false, reason: "sign-failed", note: "the browser refused to sign: " + String((e && e.message) || e), card: card, hash: hash };
          });
      });
    });
  }

  /* --------------------------------------------------------- verify a card */
  /* Two separate questions, answered separately, because they mean different
     things: does the hash still cover the card as written (was it edited), and
     does the signature check out under the public key the card itself carries
     (was it re-signed by that key). Both can pass on a card whose numbers were
     invented, and the desk says so next to the tick. */
  function verifyCard(raw) {
    var st = cryptoState();
    if (!st.ok) return Promise.resolve({ ok: false, reason: st.reason, note: st.note });
    var card = null;
    if (raw && typeof raw === "object") card = raw;
    else { try { card = JSON.parse(String(raw)); } catch (e) { card = null; } }
    if (!card) return Promise.resolve({ ok: false, reason: "not-json", note: "that is not a card — it does not parse as JSON." });
    if (card.spec !== SPEC_CARD) return Promise.resolve({ ok: false, reason: "spec-mismatch", note: "this says it is '" + String(card.spec) + "'. A DexLadder proof card says '" + SPEC_CARD + "'." });
    if (!card.hash || !card.hash.value) return Promise.resolve({ ok: false, reason: "no-hash", note: "this card carries no hash." });
    if (!card.sig || !card.sig.pub || !card.sig.value) return Promise.resolve({ ok: false, reason: "no-signature", note: "this card carries no signature." });

    var body = cardBody(card), text = canon(body);
    return sha256Hex(text).then(function (hash) {
      var hashOk = (hash === card.hash.value);
      var missing = [], i, f;
      for (i = 0; i < CARD_FIELDS.length; i++) { f = fieldAt(body, CARD_FIELDS[i]); if (!f.has) missing.push(CARD_FIELDS[i]); }
      var pub = b64uDec(card.sig.pub), sig = b64uDec(card.sig.value);
      if (!pub || !sig) return { ok: false, reason: "bad-signature-bytes", note: "the public key or the signature is not base64url.", hashOk: hashOk, computed: hash, missing: missing };
      return subtle().importKey("raw", u8(pub), { name: SIG.name, namedCurve: SIG.curve }, false, ["verify"])
        .then(function (k) { return subtle().verify({ name: SIG.name, hash: { name: SIG.hash } }, k, u8(sig), u8(utf8Bytes(text))); })
        .then(function (sigOk) {
          return {
            ok: !!(hashOk && sigOk), hashOk: hashOk, sigOk: !!sigOk, computed: hash, card: card, missing: missing,
            mine: !!(bucket() && bucket().pub === card.sig.pub),
            reason: hashOk ? (sigOk ? null : "signature-mismatch") : "hash-mismatch",
            note: hashOk
              ? (sigOk
                ? "the hash covers this card and the signature checks out under the key the card carries. That proves the card has not been edited since it was signed. It does NOT prove the trades happened — the same device wrote the record and holds the key."
                : "the hash matches but the signature does not verify under the public key in the card. The card was re-hashed without being re-signed.")
              : "the hash does not match the card as written. Something in it was edited after signing."
          };
        })["catch"](function (e) {
          return { ok: false, reason: "verify-failed", note: "the browser refused to verify: " + String((e && e.message) || e), hashOk: hashOk, computed: hash, missing: missing };
        });
    });
  }

  /* ============================================================== challenges */
  function makeChallenge(inp) {
    var spec = challengeSpec(inp);
    var code = challengeCode(spec);
    return sha256Hex(canon(spec)).then(function (d) {
      return { ok: true, spec: spec, code: code, specDigest: d, rule: RULES[spec.rule] };
    });
  }
  /* Running one is deterministic by construction: the scored days come out of
     the seed through FNV-1a, the universe and the window come out of the code,
     and the result is a proof card carrying the code and the digest of the
     inputs. Two people who ran the same code produce cards that are comparable
     because the cards prove the inputs were the same bytes. */
  function runChallenge(code) {
    var p = parseChallenge(code);
    if (!p.ok) return Promise.resolve(p);
    var spec = p.spec;
    var fromMs = spec.fromDay ? Date.parse(spec.fromDay + "T00:00:00Z") : 0;
    var toMs = spec.toDay ? Date.parse(spec.toDay + "T23:59:59Z") : (C.now ? C.now() : 0);
    var fills = fillsIn(fromMs, spec.universe && spec.universe.length ? spec.universe : null), kept = [], i, d;
    var dayKeys = {}, dl = [];
    for (i = 0; i < fills.length; i++) {
      if (toMs > 0 && +fills[i].t > toMs) continue;
      d = dayOf(fills[i].t);
      if (!d) continue;
      if (!dayKeys[d]) { dayKeys[d] = 1; dl.push(d); }
      kept.push(fills[i]);
    }
    dl.sort();
    var scored = spec.rule === "score.seedsample" ? pickDays(spec.seed, dl, Math.min(spec.sampleDays || 30, dl.length)) : dl.slice();
    var keep = {}, out = [];
    for (i = 0; i < scored.length; i++) keep[scored[i]] = 1;
    for (i = 0; i < kept.length; i++) if (keep[dayOf(kept[i].t)]) out.push(kept[i]);

    return sha256Hex(canon(spec)).then(function (specDigest) {
      return buildCard({
        windowDays: 36500,
        universe: spec.universe && spec.universe.length ? spec.universe : universeOf(out),
        challenge: { code: challengeCode(spec), specDigest: specDigest, scoredDays: scored }
      }).then(function (res) {
        if (res && res.ok) { res.spec = spec; res.scoredDays = scored; res.tradesScored = out.length; res.daysAvailable = dl.length; }
        return res;
      });
    });
  }

  /* ============================================================== the honesty block */

  var ASSUMPTIONS = [
    "THIS LAYER MAKES NO NETWORK CALL. Not one, of any kind — no request helper, no XHR, no socket, no beacon, no pixel. Everything here happens in this browser tab. A bundle, a card or a challenge code leaves this device only when you select the text and copy it somewhere yourself. The gate asserts this against the shipped payload by naming every primitive it must not find.",
    "AN EXPORT WITHOUT A PASSWORD IS PLAINTEXT. It is your fills, your journal, your alerts, your watchlist and every desk setting, readable by anyone who can read the text — a chat log, a clipboard manager, a screenshot in a photo roll. The desk labels a password-less bundle PLAINTEXT on the button, on the output, in the header and in the file itself. It is the right choice for moving a desk between two machines you hold; it is the wrong choice for anything that travels.",
    "PBKDF2-HMAC-SHA-256 at 600,000 iterations is the FLOOR from the OWASP Password Storage Cheat Sheet, 2023 revision. It is a cost parameter, not a guarantee: a five-character password is weak at any iteration count, because the attacker is guessing the password, not the key. The strength of an encrypted bundle is the strength of what you typed.",
    "A PROOF CARD PROVES ONE THING: that the card has not been edited since it was signed. It does NOT prove the trades happened. The same device wrote the record and holds the signing key, so anyone who can edit the record can re-sign it and the signature will still verify. Treat a card as a claim someone has committed to, not as evidence. There is no third party in this app, by design, and a signature cannot invent one.",
    "The equity curve this app records carries NO TIMESTAMPS. It is sampled on a render tick, skipped when the value has not moved, and capped at 240 points — so there is no honest periods-per-year to annualise a Sharpe ratio by. The card prints sharpePerSample, which is mean over standard deviation of the per-sample returns with periodsPerYear = 1, and it is NOT comparable to an annualised Sharpe from anywhere else.",
    "BALANCES ARE CARRIED BUT NEVER APPLIED. The bundle contains your balances, cost basis and stats so the record is complete and the digest covers it, and the import refuses to write them back: money in this app moves only through the paper engine. Your fills, journal, alerts, watchlist, orders, equity curve and desk settings do move across; the money does not. Re-fund the new device from the trading ticket.",
    "Buy-and-hold is priced from the ERA LEDGER — one top-100 snapshot a week, recorded on this device from the day you first opened v154, capped at 52 weeks. Fewer than two snapshots inside the window means edgeVsHoldPct is null, not zero. The equity curve and the buy-and-hold window are aligned by ASSUMPTION rather than by measurement, because the curve has no clock on it; the card names both windows so you can see the join.",
    "The signing key is an ECDSA P-256 key generated in this browser and stored in the same v154 bucket as the rest of the desk. It never goes into a bundle unless you tick include-key for a device clone. It is as private as this browser profile is, and no more: anything that can read your desk state can read the key.",
    "The per-chunk CRC-32 in the transfer format catches a typo, a dropped line or a reordered stack. It is NOT a tamper check — CRC-32 is trivially forgeable. Integrity is the whole-bundle SHA-256 in the header, checked before anything is read, and, on an encrypted bundle, the AES-GCM tag, checked by the cipher itself.",
    "The equity digest on a card is taken over the curve NORMALISED to its first point and rounded to six decimal places. That is deliberate: it pins the shape of the curve without leaking the size of the account, and it survives the float noise of two devices recording the same series in a different order."
  ];

  var METHOD = [
    ["Canonical bytes", "Every digest here is over a canonical serialisation: object keys sorted at every depth, non-finite numbers written as null, negative zero collapsed, and any key whose value is unset or a function dropped. The point is that the same state always produces the same bytes — so the same desk exported twice gives the same digest, and an import that cannot reproduce the bytes has to refuse rather than guess. It is the same shape 48-vault already uses, so the two layers never disagree about what 'the same state' means."],
    ["What is digested, and what is not", "The digest is over the BODY only: spec, bundle version, build and sections. The wall clock lives in the header, outside the digest, because a timestamp inside it would make two identical desks disagree. The header is a label on the outside of the box — it carries the version, the KDF parameters, the IV and the digest in the clear so an import can fail honestly instead of producing garbage — and nothing in it is trusted. Every count you see after verification is re-derived from the body."],
    ["Encryption, or nothing", "With a password: PBKDF2-HMAC-SHA-256, 600,000 iterations, a fresh 16-byte salt, deriving an AES-GCM-256 key, encrypted under a fresh 12-byte IV from crypto.getRandomValues with a 128-bit tag. Without a password: plaintext, labelled as such in four places. If WebCrypto is missing or the page is not in a secure context, the export REFUSES with the reason named — insecure-context, webcrypto-missing or randomness-missing — and writes nothing. A bundle you believed was encrypted and was not is worse than no bundle."],
    ["The import order", "Parse, then check the envelope (spec, version, digest present, KDF described), then decrypt if encrypted, then VERIFY THE DIGEST, and only then look at the contents. No count, no diff and no write happens before the digest matches. A version this build does not read is refused by name rather than half-applied; a digest mismatch prints both digests and stops."],
    ["The dry run", "Before anything is written, the desk shows what WOULD change, section by section: added, changed and removed, with the before and the after. Lists are diffed on a stable key — a fill on its timestamp, type, symbol and size; a journal entry on its id. The watchlist is diffed as a set. The equity curve is diffed as a series. Everything else is diffed key by key."],
    ["The three policies", "REPLACE: the bundle wins, section by section, and anything not in the bundle is removed from the sections it does carry. MERGE-NEWER: lists are merged per record, keeping whichever copy has the newer timestamp; the watchlist takes the union; the equity curve is stitched at the longest overlap between the tail of one and the head of the other. PREVIEW-ONLY writes nothing at all. An unstamped map — desk settings, preferences — is LEFT ALONE under merge-newer, because preferring one side of something with no timestamp is a coin flip wearing a policy's clothes, and the desk will not do that quietly."],
    ["A section this build does not know", "It is not dropped. It is named in the dry run, counted in bytes, and on apply it is parked in the bucket under carried, where a later build can pick it up. A continuity tool that quietly discards what it does not recognise is a continuity tool that loses your data the first time you upgrade."],
    ["Transfer without a file", "The bundle text is base64url-encoded and cut into indexed lines: DLCARRY1 | i/N | the first 16 hex of the bundle digest | a CRC-32 of that line's payload | the payload. The index catches a dropped or duplicated chunk; the shared digest tag catches two bundles spliced together; the CRC catches a flipped character; a stack pasted out of order is put back by index and SAID SO rather than silently repaired. A phone can take a desk off a laptop screen with nothing but a camera and patience."],
    ["The proof card", "An opt-in, anonymised summary: the window in whole days, the trade count, the symbols traded, the number of equity samples, a digest of the normalised curve, the return, a per-sample Sharpe, the maximum drawdown, and the edge over buy-and-hold. No balances, no dollar amounts, no timestamps finer than a day. Sharpe and drawdown come from the paper engine, not from a second implementation here. Everything on the card is inside the hash, and the hash is inside the signature."],
    ["What the signature proves", "The card body — everything except the hash and the signature — is canonicalised, digested with SHA-256, and signed with an ECDSA P-256 key generated in this browser. Verifying a card someone gave you answers two separate questions: does the hash still cover the card as written, and does the signature verify under the public key the card itself carries. Both can pass on a card whose numbers were invented. The signature proves the card has not been edited since signing. It does not, and cannot, prove that the trades happened."],
    ["Challenges", "A challenge code is a seed, a window, a universe and a rule, canonicalised, base64url-encoded and CRC-tagged. Two people run the same code against their own device's record and compare result cards. The seed picks WHICH days inside the window are scored, through an FNV-1a hash of the seed and the day, so neither side can trim the window to a flattering stretch after the fact — and the selection is deterministic, so both devices score exactly the same days without ever talking to each other. The result card carries the code and the digest of the inputs, which is what makes the two cards comparable at all."]
  ];

  /* ================================================================== the UI */

  function esc(s) { try { return C.esc ? C.esc(String(s)) : String(s).replace(/[&<>"]/g, ""); } catch (e) { return ""; } }
  function bytesFmt(n) {
    if (!(n > 0)) return "0 B";
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " kB";
    return (n / 1048576).toFixed(2) + " MB";
  }
  function shortHex(h) { return h ? String(h).slice(0, 16) + "…" : "—"; }
  /* Any constant the Method table reads is printed through here. These are all
     compile-time constants today, so this guard should never fire — which is
     exactly why it exists: the one thing the Method tab must never render is a
     bare undefined, and a renamed PARAMS key would do that silently. */
  function figure(v, unit) {
    if (v === null || typeof v === "undefined") return "not known in this build";
    if (typeof v === "number") {
      if (!isFinite(v)) return "not known in this build";
      return v.toLocaleString() + (unit || "");
    }
    return String(v) + (unit || "");
  }
  function numOr(v, dp, suffix) { return (v == null || !isFinite(v)) ? "—" : (+v).toFixed(dp == null ? 2 : dp) + (suffix || ""); }
  function when(t) { if (!(t > 0)) return "—"; try { return new Date(t).toISOString().slice(0, 16).replace("T", " ") + "Z"; } catch (e) { return "—"; } }
  function clip(s, n) { var t = String(s == null ? "—" : canon(s)); return t.length > (n || 90) ? t.slice(0, n || 90) + "…" : t; }

  var GEN = 0;
  var LAST = { bundle: null, report: null, card: null, chal: null };

  function put(id, html) { var el = null; try { el = document.getElementById(id); } catch (e) { el = null; } if (el) el.innerHTML = html; }
  function val(id) { var el = null; try { el = document.getElementById(id); } catch (e) { el = null; } return el ? String(el.value == null ? "" : el.value) : ""; }
  function checked(id) { var el = null; try { el = document.getElementById(id); } catch (e) { el = null; } return !!(el && el.checked); }

  function noNetStrip() {
    return '<div class="carry-strip">This desk makes <b>no network call of any kind</b>. Nothing here leaves the device unless you copy it out yourself.</div>';
  }
  function cryptoStrip() {
    var st = cryptoState();
    if (st.ok) return "";
    return '<div class="carry-warn"><b>' + esc(st.reason) + '</b> — ' + esc(st.note) + '</div>';
  }

  /* ---------------------------------------------------------------- export */
  function paneExport() {
    var b = bucket(), pr = (b && b.prefs) || { chunk: CHUNK_CHARS, includeKey: false };
    var h = noNetStrip() + cryptoStrip();
    h += '<div class="carry-note">One versioned bundle of this desk: fills, journal, alerts, resting orders, the equity curve, the watchlist, every desk setting — and your balances, carried for the record and never written back on the other side. The same state always produces the same bytes, so the digest below is a fingerprint of the desk, not of the moment you pressed the button.</div>';
    h += '<div class="dl-2 carry-form">';
    h += '<label class="carry-f"><span class="carry-fl">Password (optional)</span><input id="carryPw" class="dl-inp" type="password" autocomplete="new-password" spellcheck="false" aria-label="Bundle password"></label>';
    h += '<label class="carry-f"><span class="carry-fl">Chunk size (characters)</span><select id="carryChunk" class="dl-inp" aria-label="Chunk size">' + opts([800, 1200, 1600, 2400, 4000], pr.chunk) + '</select></label>';
    h += '</div>';
    h += '<label class="carry-ck"><input type="checkbox" id="carryKey"' + (pr.includeKey ? " checked" : "") + '> <span>Include this device’s signing key (for a clone of this device, not for a bundle you hand to anyone)</span></label>';
    h += '<div class="carry-plainrow"><span class="carry-tag carry-plain">PLAINTEXT</span> <span>with no password, the bundle is readable by anyone who can read the text. With one, it is AES-GCM-256 under a PBKDF2-SHA-256 key at ' + esc(figure(KDF_ITERATIONS, " iterations")) + '.</span></div>';
    h += '<div class="carry-actions"><button class="go" id="carryBuild">Build the bundle</button></div>';
    h += '<div id="carryOut" class="carry-out"></div>';
    return h;
  }
  function opts(list, cur) {
    var h = "", i;
    for (i = 0; i < list.length; i++) h += '<option value="' + list[i] + '"' + (+cur === list[i] ? " selected" : "") + '>' + list[i] + '</option>';
    return h;
  }

  function renderBundle(res) {
    if (!res || !res.ok) {
      put("carryOut", '<div class="carry-warn"><b>' + esc((res && res.reason) || "failed") + '</b> — ' + esc((res && res.note) || "nothing was exported.") + '</div>');
      return;
    }
    LAST.bundle = res;
    var h = '<div class="carry-badges">';
    h += '<span class="carry-tag ' + (res.plaintext ? "carry-plain" : "carry-enc") + '">' + (res.plaintext ? "PLAINTEXT" : "AES-GCM-256") + '</span>';
    h += '<span class="carry-tag">' + esc(bytesFmt(res.bytes)) + '</span>';
    h += '<span class="carry-tag">SHA-256 ' + esc(shortHex(res.digest)) + '</span>';
    h += '<span class="carry-tag">tag ' + esc(res.tag) + '</span>';
    if (res.envelope.header.keyIncluded) h += '<span class="carry-tag carry-plain">SIGNING KEY INSIDE</span>';
    h += '</div>';
    if (res.plaintext) h += '<div class="carry-warn">This bundle has no password. Everything in it is readable as written — treat it like a screenshot of your whole desk.</div>';
    h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Section</th><th>Shape</th><th class="r">Records</th><th>On import</th></tr></thead><tbody>';
    var i, r;
    for (i = 0; i < res.index.length; i++) {
      r = res.index[i];
      h += '<tr><td>' + esc(r.label) + '</td><td>' + esc(r.kind) + '</td><td class="r">' + r.count + '</td><td>' + (r.applies ? "applied" : '<span class="carry-no">carried, never written back</span>') + '</td></tr>';
    }
    h += '</tbody></table></div>';
    h += '<div class="carry-sub">The bundle</div>';
    h += '<textarea id="carryBundleText" class="carry-ta" readonly rows="10" spellcheck="false" aria-label="Bundle text">' + esc(res.text) + '</textarea>';
    h += '<div class="carry-actions"><button class="go" id="carryCopy">Copy the bundle</button><button class="go" id="carryCut">Cut into chunks a phone can take off this screen</button></div>';
    h += '<div id="carryChunks"></div>';
    put("carryOut", h);
  }

  function renderChunks() {
    if (!LAST.bundle) return;
    var per = +val("carryChunk") || CHUNK_CHARS;
    var lines = chunkText(LAST.bundle.text, LAST.bundle.tag, per);
    var b = bucket(); if (b) { b.prefs.chunk = per; saveBucket(); }
    var h = '<div class="carry-sub">' + lines.length + ' chunks · ' + per + ' characters each · every line carries the bundle tag ' + esc(LAST.bundle.tag) + ' and its own CRC-32</div>';
    h += '<textarea id="carryChunkText" class="carry-ta carry-mono" readonly rows="8" spellcheck="false" aria-label="Bundle chunks">' + esc(lines.join("\n")) + '</textarea>';
    h += '<div class="carry-note">Paste these back into Import in any order. A missing chunk, a duplicated one, a reordered stack or a single wrong character is caught before anything is read — the index finds the first three, the CRC finds the last, and the whole-bundle SHA-256 has the final say.</div>';
    put("carryChunks", h);
  }

  /* ---------------------------------------------------------------- import */
  function paneImport() {
    var b = bucket(), pol = (b && b.prefs && b.prefs.policy) || "preview";
    var h = noNetStrip() + cryptoStrip();
    h += '<div class="carry-note">Paste a bundle, or the chunks of one. The digest is checked first; then you see exactly what would change, section by section, before anything is written.</div>';
    h += '<textarea id="carryIn" class="carry-ta" rows="7" spellcheck="false" placeholder="paste the bundle JSON, or the DLCARRY1 chunk lines" aria-label="Bundle to import"></textarea>';
    h += '<div class="dl-2 carry-form">';
    h += '<label class="carry-f"><span class="carry-fl">Password (if it has one)</span><input id="carryInPw" class="dl-inp" type="password" autocomplete="off" spellcheck="false" aria-label="Import password"></label>';
    h += '<label class="carry-f"><span class="carry-fl">Merge policy</span><select id="carryPol" class="dl-inp" aria-label="Merge policy">' +
      '<option value="preview"' + (pol === "preview" ? " selected" : "") + '>Preview only — write nothing</option>' +
      '<option value="merge-newer"' + (pol === "merge-newer" ? " selected" : "") + '>Merge newer — keep the newer of each record</option>' +
      '<option value="replace"' + (pol === "replace" ? " selected" : "") + '>Replace — the bundle wins</option></select></label>';
    h += '</div>';
    h += '<div class="carry-actions"><button class="go" id="carryInspect">Verify and show what would change</button></div>';
    h += '<div id="carryDiff" class="carry-out"></div>';
    return h;
  }

  function renderReport(rep) {
    if (!rep || !rep.ok) {
      var extra = "";
      if (rep && rep.chunks) extra = '<div class="carry-note">' + esc(rep.chunks.note || "") + '</div>';
      put("carryDiff", '<div class="carry-warn"><b>Refused: ' + esc((rep && rep.reason) || "unknown") + '</b> — ' + esc((rep && rep.note) || "") + '</div>' + extra);
      return;
    }
    LAST.report = rep;
    var pol = val("carryPol") || "preview";
    var h = '<div class="carry-badges"><span class="carry-tag carry-ok">digest verified</span><span class="carry-tag">' + esc(shortHex(rep.digest)) + '</span><span class="carry-tag">format v' + esc(rep.header.bundleVersion) + ' · build ' + esc(rep.header.build) + '</span><span class="carry-tag">' + (rep.header.enc ? "AES-GCM-256" : "PLAINTEXT") + '</span><span class="carry-tag">exported ' + esc(when(rep.header.createdAt)) + '</span></div>';
    if (rep.chunks) h += '<div class="carry-note">Reassembled from ' + rep.chunks.total + ' chunks — ' + esc(rep.chunks.note) + '</div>';
    if (rep.header.enc) h += '<div class="carry-note">Opened with PBKDF2-SHA-256 at ' + esc(rep.header.enc.kdf.iterations) + ' iterations (' + esc(rep.header.enc.kdf.source || "source not stated") + '), AES-GCM-256, ' + esc(CIPHER.ivBytes) + '-byte IV.</div>';
    if (rep.header.keyIncluded) h += '<div class="carry-warn">This bundle carries a signing key. Applying it makes this device sign proof cards as that device.</div>';

    h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Section</th><th class="r">Here</th><th class="r">In bundle</th><th class="r">Added</th><th class="r">Changed</th><th class="r">Removed</th><th>Under this policy</th></tr></thead><tbody>';
    var i, r, d;
    for (i = 0; i < rep.rows.length; i++) {
      r = rep.rows[i];
      if (!r.present) { h += '<tr class="carry-dim"><td>' + esc(r.label) + '</td><td class="r">—</td><td class="r">—</td><td class="r">—</td><td class="r">—</td><td class="r">—</td><td>not in this bundle</td></tr>'; continue; }
      d = r.diff;
      var verdict = !r.applies ? '<span class="carry-no">never written back — ' + esc(r.why) + '</span>'
        : (pol === "preview" ? "nothing is written in preview"
          : (pol === "replace" ? "the bundle wins"
            : esc(r.mergeNote)));
      h += '<tr><td>' + esc(r.label) + '</td><td class="r">' + r.curCount + '</td><td class="r">' + r.incCount + '</td>' +
        '<td class="r">' + (d.added ? d.added.length : 0) + '</td><td class="r">' + (d.changed ? d.changed.length : 0) + '</td><td class="r">' + (d.removed ? d.removed.length : 0) + '</td><td>' + verdict + '</td></tr>';
      if (d.kind === "series" && d.series) {
        h += '<tr class="carry-dim"><td colspan="7">equity: ' + d.series.curPoints + ' points here, ' + d.series.incPoints + ' in the bundle, ' + (d.series.joined ? "overlapping by " + d.series.overlap + " → " + d.series.mergedPoints + " stitched" : "no overlap — merge-newer would keep the longer curve") + '</td></tr>';
      }
      h += detailRows(r);
    }
    h += '</tbody></table></div>';

    if (rep.unknown.length) {
      h += '<div class="carry-sub">Sections this build does not know</div><ul class="carry-list">';
      for (i = 0; i < rep.unknown.length; i++) h += '<li><b>' + esc(rep.unknown[i].id) + '</b> — ' + rep.unknown[i].canonBytes + ' bytes, parked under <code>carry.carried</code> on apply so a later build can pick it up. Nothing is dropped. <span class="carry-dimtxt">' + esc(rep.unknown[i].preview) + '</span></li>';
      h += '</ul>';
    }

    h += '<div class="carry-actions">' +
      '<button class="go" id="carryApply"' + (pol === "preview" ? " disabled" : "") + '>' + (pol === "preview" ? "Preview only — nothing will be written" : "Apply as " + esc(pol)) + '</button>' +
      '<span class="carry-sendnote">Nothing has been written yet. Changing the policy above and pressing verify again re-renders this without touching the desk.</span></div>';
    h += '<div id="carryApplied"></div>';
    put("carryDiff", h);
  }

  /* the before and the after, capped so a 200-fill bundle does not render a
     wall — the counts above are exact, these rows are the first few of each */
  function detailRows(r) {
    var d = r.diff, h = "", i, n = 4, x;
    if (!d) return "";
    for (i = 0; i < Math.min(n, (d.changed || []).length); i++) {
      x = d.changed[i];
      h += '<tr class="carry-detail"><td colspan="7"><b>changed</b> <code>' + esc(x.key) + '</code><div class="carry-ba"><span class="carry-before">before ' + esc(clip(x.before)) + '</span><span class="carry-after">after ' + esc(clip(x.after)) + '</span></div></td></tr>';
    }
    for (i = 0; i < Math.min(n, (d.added || []).length); i++) {
      x = d.added[i];
      h += '<tr class="carry-detail"><td colspan="7"><b>added</b> <code>' + esc(x.key) + '</code> <span class="carry-after">' + esc(clip(x.after)) + '</span></td></tr>';
    }
    for (i = 0; i < Math.min(n, (d.removed || []).length); i++) {
      x = d.removed[i];
      h += '<tr class="carry-detail"><td colspan="7"><b>removed</b> <code>' + esc(x.key) + '</code> <span class="carry-before">' + esc(clip(x.before)) + '</span></td></tr>';
    }
    var more = (d.changed || []).length + (d.added || []).length + (d.removed || []).length - Math.min(n, (d.changed || []).length) - Math.min(n, (d.added || []).length) - Math.min(n, (d.removed || []).length);
    if (more > 0) h += '<tr class="carry-detail carry-dim"><td colspan="7">' + more + ' more changes in this section, counted above.</td></tr>';
    return h;
  }

  /* ------------------------------------------------------------ proof card */
  function paneCard() {
    var b = bucket(), pr = (b && b.prefs) || { windowDays: 365 };
    var h = noNetStrip() + cryptoStrip();
    h += '<div class="carry-claim"><b>What a card proves:</b> that it has not been edited since it was signed. <b>What it does not prove:</b> that the trades happened. The same device wrote the record and holds the signing key, so whoever can edit one can re-sign the other. A card is a claim somebody has committed to, not evidence.</div>';
    h += '<div class="carry-note">Opt-in and anonymised: the window in whole days, how many trades, which symbols, the shape of the equity curve as a digest, the return, a per-sample Sharpe, the maximum drawdown and the edge over buy-and-hold. No balances, no amounts, no times finer than a day.</div>';
    h += '<div class="dl-2 carry-form">';
    h += '<label class="carry-f"><span class="carry-fl">Window</span><select id="carryWin" class="dl-inp" aria-label="Card window">' +
      '<option value="30"' + (+pr.windowDays === 30 ? " selected" : "") + '>last 30 days</option>' +
      '<option value="90"' + (+pr.windowDays === 90 ? " selected" : "") + '>last 90 days</option>' +
      '<option value="365"' + (+pr.windowDays === 365 ? " selected" : "") + '>last year</option>' +
      '<option value="36500"' + (+pr.windowDays === 36500 ? " selected" : "") + '>everything on this device</option></select></label>';
    h += '</div>';
    h += '<div class="carry-actions"><button class="go" id="carryMake">Build and sign a card</button><button class="go" id="carryForget">Forget this device’s signing key</button></div>';
    h += '<div id="carryCardOut" class="carry-out"></div>';
    h += '<div class="carry-sub">Check a card someone gave you</div>';
    h += '<textarea id="carryCardIn" class="carry-ta" rows="6" spellcheck="false" placeholder="paste their card JSON" aria-label="Card to verify"></textarea>';
    h += '<div class="carry-actions"><button class="go" id="carryVerify">Check it</button></div>';
    h += '<div id="carryVerifyOut" class="carry-out"></div>';
    return h;
  }

  function cardTable(card) {
    var h = '<div class="dl-tblw"><table class="dl-tbl"><tbody>';
    function row(k, v) { h += '<tr><td>' + esc(k) + '</td><td class="r">' + v + '</td></tr>'; }
    row("window", esc(card.window.fromDay || "—") + " → " + esc(card.window.toDay || "—") + " (" + (card.window.days == null ? "—" : card.window.days + " days") + ")");
    row("trades", card.trades);
    row("universe", card.universe.length ? esc(card.universe.join(" ")) : "—");
    row("equity samples", card.equity.points);
    row("equity digest", '<code>' + esc(shortHex(card.equity.digest)) + '</code>');
    row("return", numOr(card.returnPct, 2, "%"));
    row("Sharpe (per sample, NOT annualised)", numOr(card.sharpePerSample, 3));
    row("max drawdown", numOr(card.maxDrawdownPct, 2, "%"));
    row("buy and hold", numOr(card.holdPct, 2, "%"));
    row("edge over hold", numOr(card.edgeVsHoldPct, 2, " pp"));
    row("benchmark", card.benchmark ? esc(card.benchmark) : '<span class="carry-no">none on this device</span>');
    if (card.challenge) {
      row("challenge", '<code>' + esc(String(card.challenge.code).slice(0, 28)) + '…</code>');
      row("scored days", card.challenge.scoredDays.length);
    }
    row("card hash", '<code>' + esc(shortHex(card.hash && card.hash.value)) + '</code>');
    row("signed by", '<code>' + esc(String((card.sig && card.sig.pub) || "—").slice(0, 16)) + '…</code>');
    h += '</tbody></table></div>';
    return h;
  }

  function renderCard(res) {
    if (!res || !res.ok) {
      put("carryCardOut", '<div class="carry-warn"><b>' + esc((res && res.reason) || "failed") + '</b> — ' + esc((res && res.note) || "no card was built.") + '</div>');
      return;
    }
    LAST.card = res;
    var h = '<div class="carry-badges"><span class="carry-tag carry-ok">signed</span><span class="carry-tag">ECDSA P-256 · SHA-256</span><span class="carry-tag">hash ' + esc(shortHex(res.hash)) + '</span>' + (res.fresh ? '<span class="carry-tag">new key generated on this device</span>' : "") + '</div>';
    h += cardTable(res.card);
    if (res.notes && res.notes.length) {
      h += '<ul class="carry-list">';
      for (var i = 0; i < res.notes.length; i++) h += '<li>' + esc(res.notes[i]) + '</li>';
      h += '</ul>';
    }
    h += '<div class="carry-claim">The signature covers every field in the table above. It proves the card has not been edited since it was signed. It does not prove the trades happened.</div>';
    h += '<textarea id="carryCardText" class="carry-ta carry-mono" readonly rows="8" spellcheck="false" aria-label="Card JSON">' + esc(res.text) + '</textarea>';
    h += '<div class="carry-actions"><button class="go" id="carryCardCopy">Copy the card</button></div>';
    put("carryCardOut", h);
  }

  function renderVerify(v) {
    if (!v) { put("carryVerifyOut", ""); return; }
    if (v.reason && !v.hashOk && v.computed == null) {
      put("carryVerifyOut", '<div class="carry-warn"><b>' + esc(v.reason) + '</b> — ' + esc(v.note || "") + '</div>');
      return;
    }
    var h = '<div class="carry-badges">';
    h += '<span class="carry-tag ' + (v.hashOk ? "carry-ok" : "carry-bad") + '">hash ' + (v.hashOk ? "covers the card" : "does NOT match") + '</span>';
    h += '<span class="carry-tag ' + (v.sigOk ? "carry-ok" : "carry-bad") + '">signature ' + (v.sigOk ? "verifies" : "does NOT verify") + '</span>';
    if (v.mine) h += '<span class="carry-tag">signed by THIS device</span>';
    h += '</div>';
    h += '<div class="carry-note">' + esc(v.note || "") + '</div>';
    if (v.missing && v.missing.length) h += '<div class="carry-warn">This card is missing fields a v166 card carries: ' + esc(v.missing.join(", ")) + '. It may come from a different build.</div>';
    if (v.card && v.hashOk) h += cardTable(v.card);
    put("carryVerifyOut", h);
  }

  /* ------------------------------------------------------------ challenges */
  function paneChallenge() {
    var h = noNetStrip() + cryptoStrip();
    h += '<div class="carry-note">A challenge is a seed, a window, a universe and a rule — nothing else. Two people run the same code against their own desk and compare the result cards. Because the seed picks which days are scored, neither of you can trim the window afterwards to the part that went well.</div>';
    h += '<div class="dl-2 carry-form">';
    h += '<label class="carry-f"><span class="carry-fl">Seed</span><input id="carrySeed" class="dl-inp" type="text" value="" placeholder="any word you both agree on" spellcheck="false" aria-label="Challenge seed"></label>';
    h += '<label class="carry-f"><span class="carry-fl">From (UTC day)</span><input id="carryFrom" class="dl-inp" type="text" value="" placeholder="YYYY-MM-DD" spellcheck="false" aria-label="From day"></label>';
    h += '<label class="carry-f"><span class="carry-fl">To (UTC day)</span><input id="carryTo" class="dl-inp" type="text" value="" placeholder="YYYY-MM-DD" spellcheck="false" aria-label="To day"></label>';
    h += '<label class="carry-f"><span class="carry-fl">Universe</span><input id="carryUni" class="dl-inp" type="text" value="" placeholder="BTC ETH SOL" spellcheck="false" aria-label="Universe"></label>';
    h += '<label class="carry-f"><span class="carry-fl">Rule</span><select id="carryRule" class="dl-inp" aria-label="Rule"><option value="score.seedsample">seed picks the scored days</option><option value="score.all">score every day in the window</option></select></label>';
    h += '<label class="carry-f"><span class="carry-fl">Days the seed picks</span><input id="carrySample" class="dl-inp" type="number" min="1" max="365" value="30" aria-label="Sample days"></label>';
    h += '</div>';
    h += '<div class="carry-actions"><button class="go" id="carryChalMake">Make a challenge code</button></div>';
    h += '<div id="carryChalOut" class="carry-out"></div>';
    h += '<div class="carry-sub">Run a code someone sent you</div>';
    h += '<textarea id="carryChalIn" class="carry-ta carry-mono" rows="3" spellcheck="false" placeholder="DLXC1.…" aria-label="Challenge code"></textarea>';
    h += '<div class="carry-actions"><button class="go" id="carryChalRun">Run it against this desk</button></div>';
    h += '<div id="carryChalRunOut" class="carry-out"></div>';
    return h;
  }

  function renderChallenge(res) {
    if (!res || !res.ok) {
      put("carryChalOut", '<div class="carry-warn"><b>' + esc((res && res.reason) || "failed") + '</b> — ' + esc((res && res.note) || "") + '</div>');
      return;
    }
    LAST.chal = res;
    var s = res.spec;
    var h = '<div class="carry-badges"><span class="carry-tag">' + esc(s.rule) + '</span><span class="carry-tag">inputs ' + esc(shortHex(res.specDigest)) + '</span></div>';
    h += '<div class="carry-note">' + esc(res.rule) + ' · window ' + esc(s.fromDay || "open") + " → " + esc(s.toDay || "open") + ' · universe ' + esc(s.universe.length ? s.universe.join(" ") : "anything") + (s.sampleDays ? " · " + s.sampleDays + " scored days" : "") + '</div>';
    h += '<textarea id="carryChalText" class="carry-ta carry-mono" readonly rows="4" spellcheck="false" aria-label="Challenge code">' + esc(res.code) + '</textarea>';
    h += '<div class="carry-actions"><button class="go" id="carryChalCopy">Copy the code</button></div>';
    put("carryChalOut", h);
  }

  function renderChallengeRun(res) {
    if (!res || !res.ok) {
      put("carryChalRunOut", '<div class="carry-warn"><b>' + esc((res && res.reason) || "failed") + '</b> — ' + esc((res && res.note) || "") + '</div>');
      return;
    }
    var h = '<div class="carry-badges"><span class="carry-tag carry-ok">result card signed</span><span class="carry-tag">' + res.scoredDays.length + ' of ' + res.daysAvailable + ' days scored</span><span class="carry-tag">' + res.tradesScored + ' trades on those days</span></div>';
    h += '<div class="carry-note">The scored days came out of the seed, not out of this desk: ' + esc(res.scoredDays.slice(0, 12).join(" ")) + (res.scoredDays.length > 12 ? " …" : "") + '. Anyone running this code picks the same ones.</div>';
    h += cardTable(res.card);
    h += '<textarea id="carryChalCardText" class="carry-ta carry-mono" readonly rows="8" spellcheck="false" aria-label="Result card">' + esc(res.text) + '</textarea>';
    h += '<div class="carry-actions"><button class="go" id="carryChalCardCopy">Copy the result card</button></div>';
    put("carryChalRunOut", h);
  }

  /* ---------------------------------------------------------------- method */
  function paneMethod() {
    var h = noNetStrip();
    h += '<div class="carry-claim"><b>The security statement, in one place.</b> This layer makes no network call of any kind — no request helper, no XHR, no socket, no beacon, no pixel ping. A password-less export is PLAINTEXT and is labelled as such wherever it appears. A proof card proves only that it has not been edited since it was signed; it does not prove the trades happened, because the same device wrote the record and holds the key. Balances are carried in a bundle for the record and are never written back, because money moves only through the paper engine.</div>';
    h += '<div class="carry-method">';
    var i;
    for (i = 0; i < METHOD.length; i++) h += '<div class="carry-mrow"><b>' + esc(METHOD[i][0]) + '</b><span>' + esc(METHOD[i][1]) + '</span></div>';
    h += '</div>';
    h += '<div class="carry-sub">Parameters, and where they come from</div>';
    h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>Parameter</th><th>Value</th><th>Source</th></tr></thead><tbody>' +
      '<tr><td>KDF</td><td>PBKDF2-HMAC-SHA-256, ' + esc(figure(KDF_ITERATIONS, " iterations")) + ', ' + esc(figure(KDF_SALT_BYTES, "-byte salt")) + '</td><td>OWASP Password Storage Cheat Sheet, 2023 revision</td></tr>' +
      '<tr><td>Cipher</td><td>AES-GCM-' + esc(figure(CIPHER.bits)) + ', ' + esc(figure(CIPHER.ivBytes, "-byte IV")) + ', ' + esc(figure(CIPHER.tagBits, "-bit tag")) + '</td><td>NIST SP 800-38D §8.2 (12-byte IV is the size GCM uses directly)</td></tr>' +
      '<tr><td>Digest</td><td>SHA-256 over canonical JSON of the body</td><td>FIPS 180-4</td></tr>' +
      '<tr><td>Signature</td><td>ECDSA P-256 with SHA-256</td><td>FIPS 186-4; the curve WebCrypto is required to implement</td></tr>' +
      '<tr><td>Chunk CRC</td><td>CRC-32, polynomial 0xEDB88320 reflected</td><td>IEEE 802.3 / zlib. A typo check, not a tamper check</td></tr>' +
      '<tr><td>Seed hash</td><td>FNV-1a 32-bit</td><td>Fowler–Noll–Vo. Deterministic, which is the whole point</td></tr>' +
      '</tbody></table></div>';
    h += '<div class="carry-sub">What is assumed, and what is measured</div><ul class="carry-list">';
    for (i = 0; i < ASSUMPTIONS.length; i++) h += '<li>' + esc(ASSUMPTIONS[i]) + '</li>';
    h += '</ul>';
    return h;
  }

  /* ---------------------------------------------------------------- wiring */

  function bodyFor(tab) {
    if (tab === "import") return paneImport();
    if (tab === "card") return paneCard();
    if (tab === "chal") return paneChallenge();
    if (tab === "method") return paneMethod();
    return paneExport();
  }

  function copyFrom(id) {
    var el = null;
    try { el = document.getElementById(id); } catch (e) { el = null; }
    if (!el) return;
    try { el.focus(); el.select(); } catch (e) {}
    try {
      if (window.navigator && window.navigator.clipboard && window.navigator.clipboard.writeText) {
        window.navigator.clipboard.writeText(el.value).then(function () {
          try { C.toast && C.toast("good", "Copied", "it is on your clipboard and nowhere else"); } catch (e2) {}
        })["catch"](function () {});
        return;
      }
    } catch (e) {}
    try { C.toast && C.toast("good", "Selected", "press copy — this desk cannot reach your clipboard on this browser"); } catch (e) {}
  }

  function busy(id, label) { put(id, '<div class="carry-busy">' + esc(label) + '</div>'); }

  function onClick(ev) {
    var tgt = ev.target, id = tgt && tgt.id;
    if (!id) return;
    var g = GEN, b = bucket();

    if (id === "carryBuild") {
      if (b) { b.prefs.includeKey = checked("carryKey"); b.prefs.chunk = +val("carryChunk") || CHUNK_CHARS; saveBucket(); }
      busy("carryOut", "deriving, digesting" + (val("carryPw").length ? " and encrypting" : "") + " — 600,000 PBKDF2 iterations take a second or two on purpose");
      build({ password: val("carryPw"), includeKey: checked("carryKey") }).then(function (res) { if (g === GEN) renderBundle(res); });
      return;
    }
    if (id === "carryCopy") { copyFrom("carryBundleText"); return; }
    if (id === "carryCut") { renderChunks(); return; }

    if (id === "carryInspect") {
      if (b) { b.prefs.policy = val("carryPol") || "preview"; saveBucket(); }
      busy("carryDiff", "checking the digest before reading anything");
      inspect(val("carryIn"), val("carryInPw")).then(function (rep) { if (g === GEN) renderReport(rep); });
      return;
    }
    if (id === "carryApply") {
      var res2 = apply(LAST.report, val("carryPol"));
      if (!res2.ok) { put("carryApplied", '<div class="carry-warn"><b>' + esc(res2.reason) + '</b> — ' + esc(res2.note) + '</div>'); return; }
      var h = '<div class="carry-ok-box"><b>Applied as ' + esc(res2.policy) + '.</b><ul class="carry-list">';
      var i;
      for (i = 0; i < res2.applied.length; i++) h += '<li>' + esc(res2.applied[i].id) + ' — ' + esc(res2.applied[i].how) + ', ' + res2.applied[i].n + ' records</li>';
      for (i = 0; i < res2.skipped.length; i++) h += '<li class="carry-dimtxt">' + esc(res2.skipped[i].id) + ' — left alone: ' + esc(res2.skipped[i].why) + '</li>';
      h += '</ul>' + (res2.carried ? '<div>' + res2.carried + ' unknown section(s) parked under carry.carried rather than dropped.</div>' : "") + '</div>';
      put("carryApplied", h);
      return;
    }

    if (id === "carryMake") {
      if (b) { b.prefs.windowDays = +val("carryWin") || 365; saveBucket(); }
      busy("carryCardOut", "measuring, hashing and signing");
      buildCard({ windowDays: +val("carryWin") || 365 }).then(function (res) { if (g === GEN) renderCard(res); });
      return;
    }
    if (id === "carryCardCopy") { copyFrom("carryCardText"); return; }
    if (id === "carryForget") {
      forgetKey();
      put("carryCardOut", '<div class="carry-note">The signing key is gone from this device. The next card generates a new one, and cards signed by the old key can no longer be traced to this desk — nor can you re-sign as it.</div>');
      return;
    }
    if (id === "carryVerify") {
      busy("carryVerifyOut", "re-hashing the card and checking the signature");
      verifyCard(val("carryCardIn")).then(function (v) { if (g === GEN) renderVerify(v); });
      return;
    }

    if (id === "carryChalMake") {
      var uni = val("carryUni").toUpperCase().split(/[\s,]+/), clean = [], j;
      for (j = 0; j < uni.length; j++) if (uni[j].length) clean.push(uni[j]);
      busy("carryChalOut", "canonicalising the inputs");
      makeChallenge({
        seed: val("carrySeed"), fromDay: val("carryFrom") || null, toDay: val("carryTo") || null,
        universe: clean, rule: val("carryRule"), sampleDays: +val("carrySample") || 30
      }).then(function (res) { if (g === GEN) renderChallenge(res); });
      return;
    }
    if (id === "carryChalCopy") { copyFrom("carryChalText"); return; }
    if (id === "carryChalRun") {
      busy("carryChalRunOut", "scoring the days the seed picked");
      runChallenge(val("carryChalIn")).then(function (res) { if (g === GEN) renderChallengeRun(res); });
      return;
    }
    if (id === "carryChalCardCopy") { copyFrom("carryChalCardText"); return; }
  }

  var wired = null;
  function wire(el) {
    if (!el || wired === el) return;
    el.addEventListener("click", onClick);
    wired = el;
    el.__onClose = function () {
      GEN++;                                   /* every promise still in flight becomes a no-op */
      try { el.removeEventListener("click", onClick); } catch (e) {}
      wired = null;
      LAST = { bundle: null, report: null, card: null, chal: null };
    };
  }

  function open(tab) {
    GEN++;
    var el = null;
    try {
      el = C.open("dlCarry", {
        title: "⇄ Carry",
        sub: "move this desk to another device, and show a track record — with no server anywhere and no request made",
        tabs: [["export", "Export"], ["import", "Import"], ["card", "Proof card"], ["chal", "Challenge"], ["method", "Method"]],
        onTab: function (t, body) { if (body) body.innerHTML = bodyFor(t); }
      }, tab || "export");
    } catch (e) { el = null; }
    try { wire(el || document.getElementById("dlCarry")); } catch (e) {}
    return el;
  }

  try { if (window.DLDESKS && window.DLDESKS.register) window.DLDESKS.register("carry", "⇄", "Carry", "move this desk to another device, and sign a track record — nothing leaves unless you copy it", function () { open("export"); }); } catch (e) {}
  /* DLCORE.cmd is cmd(name, desc, icon, fn) — the four-argument form 39b-ledgers
     and 42-rewind use. Calling it with two arguments lands the handler in the
     description slot and the palette entry runs nothing. */
  try { C.cmd && C.cmd("carry", "Carry — continuity bundle, proof cards, challenges. No network.", "⇄", function () { open("export"); }); } catch (e) {}

  window.DLCARRY = {
    __v: 166,
    open: open,

    /* continuity */
    build: build, inspect: inspect, apply: apply, collect: collect,
    sections: function () { var o = [], i; for (i = 0; i < SECTIONS.length; i++) o.push({ id: SECTIONS[i].id, label: SECTIONS[i].label, kind: SECTIONS[i].kind, applies: !!SECTIONS[i].applies }); return o; },

    /* proof cards + challenges */
    buildCard: buildCard, verifyCard: verifyCard, signCard: signCard,
    makeChallenge: makeChallenge, runChallenge: runChallenge, forgetKey: forgetKey,

    /* pure, and gated as such */
    canon: canon, crc32: crc32, crc32Hex: crc32Hex, hash32: hash32,
    utf8Bytes: utf8Bytes, utf8FromBytes: utf8FromBytes, b64uEnc: b64uEnc, b64uDec: b64uDec, hexOf: hexOf,
    chunkText: chunkText, joinChunks: joinChunks, envelopeCheck: envelopeCheck,
    listDiff: listDiff, setDiff: setDiff, mapDiff: mapDiff,
    mergeNewer: mergeNewer, mergeSet: mergeSet, overlapJoin: overlapJoin,
    normEquity: normEquity, cardFrom: cardFrom, cardBody: cardBody, fieldAt: fieldAt,
    challengeSpec: challengeSpec, challengeCode: challengeCode, parseChallenge: parseChallenge, pickDays: pickDays,
    cryptoState: cryptoState,

    /* parameters, so the gate reads the shipped numbers rather than a copy */
    PARAMS: {
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: KDF_ITERATIONS, floor: KDF_FLOOR, saltBytes: KDF_SALT_BYTES, source: "OWASP Password Storage Cheat Sheet, 2023" },
      cipher: CIPHER, sig: SIG, digest: DIGEST,
      spec: SPEC_BUNDLE, cardSpec: SPEC_CARD, challengeSpec: SPEC_CHAL,
      bundleVersion: BUNDLE_V, magic: MAGIC, chunkChars: CHUNK_CHARS
    },
    CARD_FIELDS: CARD_FIELDS,
    CHALLENGE_FIELDS: CHALLENGE_FIELDS,
    METHOD: METHOD,
    ASSUMPTIONS: ASSUMPTIONS
  };
})();
