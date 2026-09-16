/* ============================================================
   DLVAULT · v163 — the durable state layer.

   THE CEILING THIS REMOVES
   ------------------------
   Every desk state the app keeps lives in ONE localStorage blob,
   "coinbridge.v1", written whole by _saveNow() on a 1200ms debounce.
   A browser gives that blob ~5MB shared with every other key, so
   _savePayload() hard-caps what it may carry:

       txns    .slice(0,50)      journal .slice(0,60)
       alerts  .slice(0,40)      eq      .slice(-120)
       grids   .slice(0,6)       p2p     .slice(0,20)

   and _saveNow()'s quota catch prunes further (txns 25, journal 20,
   eq 40, alerts 15, chain tail 60) the first time a write throws.
   RAM is capped too: S.txns.unshift() pops at length 80.

   So the desk forgets. Trade for three months and you keep the last
   fifty fills; the equity curve is a 120-point window, not a record.
   That is the single largest limit on DexLadder being a tool someone
   keeps for years.

   The sovereign bundle (SV82) inherits the same ceiling: it signs
   `state` = that one capped blob, so a restore drops every other desk
   key (theme, watchlist, wallet cfg, oracle history, certificate) and
   every fill older than the window.

   WHAT THIS LAYER DOES
   --------------------
   1. ARCHIVE. An IndexedDB store beside localStorage. localStorage
      stays exactly as it is — the hot, synchronous, capped working set
      the whole app already reads, unchanged. The archive is
      append-only and uncapped, and no existing code path reads it, so
      nothing existing changes behaviour:

        capture   every _saveNow() mirrors txns / journal / alerts into
                  the archive, merged by stable key, never pruned; the
                  equity curve is appended by suffix-overlap so the
                  full series outlives the 120-point window.
        read      DLVAULT.page(id, offset, n) pages it. RAM arrays are
                  deliberately NOT inflated — that would fight the
                  app's own 80-entry pop and push thousands of rows
                  through renderers written for fifty.

   2. BUNDLE v2. Not a second file format — the SAME sovereign bundle,
      same secp256k1 key, same signature scheme, so the existing
      SV82.verifyBundle() verifies it untouched (it stables over every
      non-sig key). v2 adds:
        keys      every DexLadder localStorage key, not just one
        archive   the uncapped history
        counts    what is inside, before you open it
        checksum  SHA-256 over canonical JSON, checked before the
                  signature, so a truncated file is caught even where
                  WebCrypto or the secp substrate is missing
      v1 bundles still import. The signing key is excluded by default
      and opt-in for a device clone — an export you email should not
      carry your private key.

   3. PRESSURE. Real numbers — localStorage bytes, StorageManager
      usage/quota, archive row counts — surfaced before a write fails
      rather than discovered when it does.

   FAILURE MODEL
   -------------
   No IndexedDB (private mode, blocked storage, old WebView) is not an
   error: open() resolves null, capture becomes a no-op, and the app
   behaves exactly as before this layer existed. Export still works
   from localStorage alone. Nothing here throws into the app's stack —
   _saveNow is wrapped, and the wrapper calls the original first.

   window.__DL_FOREIGN is honoured: a foreign payload never captures.
   ============================================================ */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.DLVAULT) return;

  /* NOT "dexladder": the payload already owns indexedDB.open("dexladder",1)
     with a single "kv" store for the last-known-good market snapshot. A
     same-name open at the same version attaches to THAT database, finds no
     series/meta stores, and every write fails silently — the archive then
     lives only in RAM and is gone on reload, which is the exact failure
     this layer exists to prevent. Separate database, and open() below
     verifies its stores rather than assuming an upgrade ran. */
  var DB_NAME = 'dexladder-vault', DB_VER = 1;
  var APP_DB = 'dexladder'; /* left strictly alone */
  var STORE_SERIES = 'series', STORE_META = 'meta';
  var SPEC2 = 'dexladder/sovereign-export/v2';
  var SPEC1 = 'dexladder/sovereign-export/v1';
  var GEN = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
  var MAIN_KEY = 'coinbridge.v1';
  var SOV_KEY = 'coinbridge.sovkey';
  var KEY_PREFIXES = ['coinbridge.', 'cb.', 'cb_', 'dl.'];

  /* ---------------------------------------------------------- series */
  var SERIES = [
    { id: 'txns', label: 'Fills', order: 'desc',
      get: function () { return liveArr('txns'); },
      key: function (r) { return [r && r.t, r && r.type, r && r.sym, r && r.amt].join('|'); },
      stamp: function (r) { return (r && +r.t) || 0; } },
    { id: 'journal', label: 'Journal', order: 'desc',
      get: function () { return liveArr('journal'); },
      key: function (r) { return r && r.id != null ? 'id:' + r.id : (r && r.t != null ? 't:' + r.t : 'j:' + stable(r)); },
      stamp: function (r) { return (r && (+r.t || +r.created)) || 0; } },
    { id: 'alerts', label: 'Alerts', order: 'desc',
      get: function () { return liveArr('alerts'); },
      key: function (r) { return r && r.id != null ? 'id:' + r.id : 'a:' + stable(r); },
      stamp: function (r) { return (r && (+r.created || +r.t)) || 0; } }
  ];
  var EQ_ID = 'equity';

  /* S is a top-level `let` in the payload script: same global lexical
     environment, reachable from this appended script, absent from
     window. typeof guards the boot race and any foreign host. */
  function liveArr(prop) {
    try {
      if (typeof S === 'undefined' || !S) return null;
      return Array.isArray(S[prop]) ? S[prop] : null;
    } catch (e) { return null; }
  }
  function liveEq() {
    try {
      if (typeof S === 'undefined' || !S) return null;
      return Array.isArray(S.equityHist) ? S.equityHist : null;
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------ canonical */
  /* Byte-identical to SV82's stable(): keys sorted at every depth. Two
     serialisations of one state must not differ or the checksum and the
     signature disagree. */
  function stable(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    return '{' + Object.keys(v).sort().map(function (k) {
      return JSON.stringify(k) + ':' + stable(v[k]);
    }).join(',') + '}';
  }

  function sha256Hex(str) {
    try {
      if (!(window.crypto && window.crypto.subtle)) return Promise.resolve(null);
      return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
        .then(function (d) {
          var b = new Uint8Array(d), out = '';
          for (var i = 0; i < b.length; i++) out += ('0' + b[i].toString(16)).slice(-2);
          return out;
        })['catch'](function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  /* ------------------------------------------------------------ idb */
  var _db = null, _dbTried = false, _dbP = null;

  function hasStores(db) {
    try {
      return !!db && db.objectStoreNames.contains(STORE_SERIES) && db.objectStoreNames.contains(STORE_META);
    } catch (e) { return false; }
  }

  /* One attempt at `version`, creating the stores if the upgrade runs.
     Resolves the db only when the stores it needs are actually there. */
  function tryOpen(version) {
    return new Promise(function (res) {
      var req;
      try { req = version ? window.indexedDB.open(DB_NAME, version) : window.indexedDB.open(DB_NAME); }
      catch (e) { return res(null); }
      var settled = false;
      var done = function (v) { if (settled) return; settled = true; res(v); };
      /* some private-mode builds fire neither event */
      setTimeout(function () { done(null); }, 4000);
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        try {
          if (!db.objectStoreNames.contains(STORE_SERIES)) db.createObjectStore(STORE_SERIES, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'k' });
        } catch (e) {}
      };
      req.onsuccess = function () { done(req.result || null); };
      req.onerror = function () { done(null); };
      req.onblocked = function () { done(null); };
    });
  }

  function open() {
    if (_dbP) return _dbP;
    _dbP = (function () {
      if (_dbTried) return Promise.resolve(_db);
      _dbTried = true;
      if (!window.indexedDB) return Promise.resolve(null);
      return tryOpen(DB_VER).then(function (db) {
        /* An existing database at a higher version, or one whose upgrade
           never ran, leaves the stores missing. Reopen at version+1 and
           create them rather than writing into a void. */
        if (db && hasStores(db)) return db;
        var v = db ? db.version + 1 : 0;
        if (db) { try { db.close(); } catch (e) {} }
        if (!v) return tryOpen(0).then(function (d2) {
          if (d2 && hasStores(d2)) return d2;
          var vv = d2 ? d2.version + 1 : 1;
          if (d2) { try { d2.close(); } catch (e) {} }
          return tryOpen(vv);
        });
        return tryOpen(v);
      }).then(function (db) {
        if (!db) return null;
        if (!hasStores(db)) { try { db.close(); } catch (e) {} return null; }
        db.onversionchange = function () { try { db.close(); } catch (e) {} _db = null; };
        _db = db;
        return db;
      })['catch'](function () { return null; });
    })();
    return _dbP;
  }

  function tx(store, mode, fn) {
    return open().then(function (db) {
      if (!db) return null;
      return new Promise(function (res) {
        var t, s, out = null;
        try { t = db.transaction(store, mode); s = t.objectStore(store); }
        catch (e) { return res(null); }
        try { fn(s, function (v) { out = v; }); } catch (e) {}
        t.oncomplete = function () { res(out); };
        t.onerror = function () { res(null); };
        t.onabort = function () { res(null); };
      });
    })['catch'](function () { return null; });
  }
  function getRec(store, key) {
    return tx(store, 'readonly', function (s, set) {
      var r = s.get(key); r.onsuccess = function () { set(r.result || null); };
    });
  }
  function putRec(store, rec) {
    return tx(store, 'readwrite', function (s, set) {
      var r = s.put(rec); r.onsuccess = function () { set(true); };
    });
  }

  /* ------------------------------------------------- archive memory */
  /* One record per series {id, rows[], keys{}, at}, read once at boot
     and written back whole. At realistic volumes (tens of thousands of
     rows) that is cheaper than a per-row store and keeps ordering
     trivially correct. */
  var _cache = Object.create(null), _loaded = false, _dirty = Object.create(null);

  function defOf(id) {
    for (var i = 0; i < SERIES.length; i++) if (SERIES[i].id === id) return SERIES[i];
    return null;
  }
  function rebuildKeys(id, rows) {
    var def = defOf(id), m = Object.create(null);
    if (!def) return m;
    for (var i = 0; i < rows.length; i++) m[def.key(rows[i])] = 1;
    return m;
  }
  function blank(id) { return { id: id, rows: [], keys: Object.create(null), at: 0 }; }

  /* page() answers from RAM, so a database that accepts a connection but
     rejects every write would look healthy while persisting nothing. One
     probe write at boot settles it, and everything user-facing reports
     THIS rather than "a connection opened". */
  var _writable = false;
  function probeWrite() {
    return putRec(STORE_META, { k: '__probe', at: Date.now() }).then(function (r) {
      _writable = !!r;
      return _writable;
    })['catch'](function () { _writable = false; return false; });
  }

  function loadAll() {
    return open().then(function (db) {
      var ids = SERIES.map(function (d) { return d.id; }).concat([EQ_ID]);
      if (!db) { ids.forEach(function (id) { _cache[id] = blank(id); }); _loaded = true; return false; }
      return Promise.all(ids.map(function (id) {
        return getRec(STORE_SERIES, id).then(function (rec) {
          _cache[id] = rec && Array.isArray(rec.rows)
            ? { id: id, rows: rec.rows, keys: rec.keys || rebuildKeys(id, rec.rows), at: rec.at || 0 }
            : blank(id);
        });
      })).then(function () { _loaded = true; return true; });
    });
  }

  function mergeSeries(def) {
    var live = def.get(), rec = _cache[def.id];
    if (!live || !live.length || !rec) return 0;
    var added = 0;
    for (var i = 0; i < live.length; i++) {
      var row = live[i]; if (row == null) continue;
      var k; try { k = def.key(row); } catch (e) { continue; }
      if (rec.keys[k]) continue;
      rec.keys[k] = 1; rec.rows.push(row); added++;
    }
    if (added) {
      rec.rows.sort(function (a, b) {
        var da = def.stamp(a), db2 = def.stamp(b);
        return def.order === 'desc' ? db2 - da : da - db2;
      });
      rec.at = Date.now(); _dirty[def.id] = 1;
    }
    return added;
  }

  /* Equity is a plain number series the app truncates to the last 120.
     Merge by the longest suffix of the archive that is a prefix of the
     live window: that stretch is the same history, everything after it
     is new. No overlap means a reset or a clone — keep both stretches
     rather than silently dropping either. */
  function mergeEquity() {
    var live = liveEq(), rec = _cache[EQ_ID];
    if (!live || !live.length || !rec) return 0;
    var arc = rec.rows;
    if (!arc.length) {
      rec.rows = live.slice(); rec.at = Date.now(); _dirty[EQ_ID] = 1;
      return rec.rows.length;
    }
    var max = Math.min(arc.length, live.length), ov = 0, n, j, ok;
    for (n = max; n > 0; n--) {
      ok = true;
      for (j = 0; j < n; j++) if (arc[arc.length - n + j] !== live[j]) { ok = false; break; }
      if (ok) { ov = n; break; }
    }
    var tail = live.slice(ov);
    if (!tail.length) return 0;
    for (j = 0; j < tail.length; j++) arc.push(tail[j]);
    rec.at = Date.now(); _dirty[EQ_ID] = 1;
    return tail.length;
  }

  function flush() {
    var ids = Object.keys(_dirty);
    if (!ids.length) return Promise.resolve(false);
    _dirty = Object.create(null);
    return Promise.all(ids.map(function (id) {
      var rec = _cache[id];
      return rec ? putRec(STORE_SERIES, { id: id, rows: rec.rows, keys: rec.keys, at: rec.at }) : null;
    })).then(function () { return true; })['catch'](function () { return false; });
  }

  var _flushT = 0;
  function capture() {
    if (window.__DL_FOREIGN || !_loaded || !_db || !_writable) return 0;
    var n = 0;
    for (var i = 0; i < SERIES.length; i++) n += mergeSeries(SERIES[i]);
    n += mergeEquity();
    if (n && !_flushT) _flushT = setTimeout(function () { _flushT = 0; flush(); }, 900);
    return n;
  }

  /* ------------------------------------------------------- hot wire */
  /* _saveNow and flushP are top-level function declarations in the
     payload, so both are window properties and wrappable. The original
     runs first and its return value passes through untouched. */
  function wrap(name, after) {
    var fn = window[name];
    if (typeof fn !== 'function' || fn.__vault) return;
    var w = function () {
      var r;
      try { r = fn.apply(this, arguments); } finally { try { after(); } catch (e) {} }
      return r;
    };
    w.__vault = 1;
    window[name] = w;
  }
  function wire() {
    wrap('_saveNow', function () { capture(); });
    wrap('flushP', function () { capture(); flush(); });
  }

  /* ----------------------------------------------------- local keys */
  function deskKeys() {
    var out = [], i, k, p;
    try {
      for (i = 0; i < localStorage.length; i++) {
        k = localStorage.key(i); if (!k) continue;
        for (p = 0; p < KEY_PREFIXES.length; p++) {
          if (k.indexOf(KEY_PREFIXES[p]) === 0) { out.push(k); break; }
        }
      }
    } catch (e) {}
    return out.sort();
  }
  function readLocal(includeSov) {
    var o = {}, ks = deskKeys();
    for (var i = 0; i < ks.length; i++) {
      if (!includeSov && ks[i] === SOV_KEY) continue;
      try { o[ks[i]] = localStorage.getItem(ks[i]); } catch (e) {}
    }
    return o;
  }
  function lsBytes() {
    var n = 0, ks = deskKeys(), v;
    for (var i = 0; i < ks.length; i++) {
      try { v = localStorage.getItem(ks[i]) || ''; } catch (e) { v = ''; }
      n += (ks[i].length + v.length) * 2; /* UTF-16 code units */
    }
    return n;
  }
  function mainState() {
    try { return JSON.parse(localStorage.getItem(MAIN_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }

  /* ------------------------------------------------- secp substrate */
  /* The same globals SV82 checks for. Reused, not reimplemented, so a
     v2 bundle carries a signature the existing verifier accepts. */
  function haveCrypto() {
    try {
      return typeof spSign === 'function' && typeof spVerify === 'function' &&
             typeof spMul === 'function' && typeof spRandScalar === 'function' &&
             typeof spBig === 'function' && typeof dsha === 'function' &&
             typeof SECP !== 'undefined';
    } catch (e) { return false; }
  }
  function G() { return [SECP.Gx, SECP.Gy]; }
  function hx(n) { var h = n.toString(16); return h.length < 64 ? '0'.repeat(64 - h.length) + h : h; }
  function unhx(h) { return BigInt('0x' + h); }
  function zOf(s) { return spBig(dsha(Array.from(new TextEncoder().encode(s)))); }
  function sovKey() {
    try {
      var h = localStorage.getItem(SOV_KEY);
      if (h && /^[0-9a-f]{64}$/.test(h)) return unhx(h);
    } catch (e) {}
    var d = spRandScalar();
    try { localStorage.setItem(SOV_KEY, hx(d)); } catch (e) {}
    return d;
  }
  function appBuild() {
    try {
      var m = document.querySelector('meta[name="cb:build"]');
      return 'DexLadder ' + ((m && m.getAttribute('content')) || 'unknown');
    } catch (e) { return 'DexLadder'; }
  }

  /* --------------------------------------------------------- bundle */
  function archiveOut() {
    var a = {}, c = {}, i, id;
    for (i = 0; i < SERIES.length; i++) {
      id = SERIES[i].id;
      a[id] = (_cache[id] && _cache[id].rows) || [];
      c[id] = a[id].length;
    }
    a[EQ_ID] = (_cache[EQ_ID] && _cache[EQ_ID].rows) || [];
    c[EQ_ID] = a[EQ_ID].length;
    return { archive: a, counts: c };
  }

  function bundle(opts) {
    opts = opts || {};
    var withSov = !!opts.sovereign; /* off unless a device clone asks */
    try { if (typeof window.flushP === 'function') window.flushP(); } catch (e) {}
    return Promise.resolve(flush()).then(function () {
      var st = mainState();
      var bl = (st.chain || {}).bl || [];
      var ac = archiveOut();
      var p = {
        spec: SPEC2,
        app: appBuild(),
        issuedAt: new Date().toISOString(),
        genesisHash: GEN,
        ledger: {
          blocks: bl.length,
          height: bl.length ? bl[bl.length - 1].i : 0,
          tip: bl.length ? bl[bl.length - 1].h : null
        },
        summary: {
          balances: st.bal || {},
          xp: st.xp || 0,
          lessonsDone: (st.acadDone || []).length,
          badges: st.badges || st.achievements || []
        },
        state: st,
        keys: readLocal(withSov),
        archive: ac.archive,
        counts: ac.counts,
        sovereign: withSov
      };
      /* Order matters. The public key goes in BEFORE the checksum is
         taken, so the checksum covers the key the signature is made
         with; the signature is then taken over the payload including
         its checksum. Verification therefore digests everything except
         `sig` and `checksum` — the exact pair this builder adds last. */
      var d = null, signing = haveCrypto();
      if (signing) {
        try {
          d = sovKey();
          var Q = spMul(d, G());
          p.pub = { x: hx(Q[0]), y: hx(Q[1]) };
        } catch (e) { signing = false; }
      }
      return sha256Hex(stable(p)).then(function (hex) {
        p.checksum = { algo: 'SHA-256', of: 'canonical-json(payload minus sig+checksum)', value: hex };
        if (!signing) return p; /* unsigned but checksummed */
        try {
          var sig = spSign(zOf(stable(p)), d);
          p.sig = { r: hx(sig[0]), s: hx(sig[1]) };
        } catch (e) {}
        return p;
      });
    });
  }

  /* Checksum is verified first: it needs no secp substrate, so a
     truncated or edited file is rejected even where signing is not
     available. The signature is then delegated to SV82's verifier —
     one implementation, not two. */
  function verify(b) {
    if (!b || typeof b !== 'object') return Promise.resolve({ ok: false, why: 'not a DexLadder bundle' });
    if (b.spec !== SPEC2 && b.spec !== SPEC1) {
      return Promise.resolve({ ok: false, why: 'unknown format: ' + String(b.spec) });
    }
    var v2 = b.spec === SPEC2;
    var step = Promise.resolve({ ok: true });
    if (v2 && b.checksum && b.checksum.value) {
      var body = {}, k;
      for (k in b) if (k !== 'sig' && k !== 'checksum') body[k] = b[k];
      step = sha256Hex(stable(body)).then(function (hex) {
        if (!hex) return { ok: true, weak: 'checksum not verified (no WebCrypto here)' };
        if (hex !== b.checksum.value) return { ok: false, why: 'checksum mismatch — the file was modified or truncated' };
        return { ok: true };
      });
    } else if (v2) {
      step = Promise.resolve({ ok: true, weak: 'bundle carries no checksum' });
    }
    return step.then(function (r) {
      if (!r.ok) return r;
      var sv = window.SV82;
      if (sv && typeof sv.verifyBundle === 'function' && b.sig && b.pub) {
        var s = sv.verifyBundle(b);
        if (!s.ok) return { ok: false, why: s.why || 'signature does not match payload' };
        return { ok: true, weak: r.weak, fp: s.fp, issuedAt: s.issuedAt, height: s.height, xp: s.xp, v2: v2 };
      }
      return { ok: true, weak: r.weak || 'signature not verified here', v2: v2 };
    });
  }

  /* Snapshot before write. If anything below fails the user still has a
     complete pre-import copy in the archive's meta store. */
  function apply(b) {
    return bundle({ sovereign: true })
      .then(function (before) { return putRec(STORE_META, { k: 'preimport', at: Date.now(), bundle: before }); })
      ['catch'](function () { return null; })
      .then(function () {
        var wrote = 0, k;
        if (b.keys && typeof b.keys === 'object') {
          var ks = deskKeys();
          for (var i = 0; i < ks.length; i++) {
            /* never wipe the signing key unless the bundle brings one */
            if (ks[i] === SOV_KEY && !b.keys[SOV_KEY]) continue;
            try { localStorage.removeItem(ks[i]); } catch (e) {}
          }
          for (k in b.keys) {
            if (!Object.prototype.hasOwnProperty.call(b.keys, k)) continue;
            try { localStorage.setItem(k, b.keys[k]); wrote++; } catch (e) {}
          }
        }
        if (b.state && typeof b.state === 'object') {
          try { localStorage.setItem(MAIN_KEY, JSON.stringify(b.state)); wrote++; } catch (e) {}
        }
        var arc = b.archive || {}, jobs = [];
        for (var j = 0; j < SERIES.length; j++) {
          (function (def) {
            var rows = Array.isArray(arc[def.id]) ? arc[def.id] : [];
            _cache[def.id] = { id: def.id, rows: rows, keys: rebuildKeys(def.id, rows), at: Date.now() };
            jobs.push(putRec(STORE_SERIES, _cache[def.id]));
          })(SERIES[j]);
        }
        var eq = Array.isArray(arc[EQ_ID]) ? arc[EQ_ID] : [];
        _cache[EQ_ID] = { id: EQ_ID, rows: eq, keys: Object.create(null), at: Date.now() };
        jobs.push(putRec(STORE_SERIES, _cache[EQ_ID]));
        return Promise.all(jobs).then(function () { return wrote; });
      });
  }

  function fname(b) {
    var h = (b.checksum && b.checksum.value) || '';
    return 'dexladder-desk-' + String(b.issuedAt || '').replace(/[:T]/g, '-').slice(0, 16)
      + (h ? '-' + h.slice(0, 8) : '') + '.cbundle';
  }
  function download(opts) {
    return bundle(opts).then(function (b) {
      var txt = JSON.stringify(b, null, 1);
      var blob = new Blob([txt], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = fname(b);
      document.body.appendChild(a); a.click();
      setTimeout(function () { try { a.remove(); URL.revokeObjectURL(url); } catch (e) {} }, 400);
      return { name: a.download, bytes: txt.length, bundle: b };
    });
  }
  function readFile(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () {
        try { res(JSON.parse(String(fr.result))); }
        catch (e) { rej(new Error('that file is not valid JSON')); }
      };
      fr.onerror = function () { rej(new Error('could not read that file')); };
      fr.readAsText(file);
    });
  }

  /* ---------------------------------------------------------- stats */
  function stats() {
    var out = { idb: !!_db && _writable, connected: !!_db, writable: _writable, signed: haveCrypto(), local: { bytes: lsBytes(), keys: deskKeys().length, headroom: headroom() }, series: {}, quota: null };
    for (var i = 0; i < SERIES.length; i++) {
      var d = SERIES[i], id = d.id;
      out.series[id] = { label: d.label, rows: (_cache[id] && _cache[id].rows.length) || 0, live: (d.get() || []).length };
    }
    out.series[EQ_ID] = { label: 'Equity points', rows: (_cache[EQ_ID] && _cache[EQ_ID].rows.length) || 0, live: (liveEq() || []).length };
    var p = Promise.resolve(null);
    try {
      if (navigator.storage && navigator.storage.estimate) {
        p = navigator.storage.estimate()
          .then(function (e) { return { usage: e.usage || 0, quota: e.quota || 0 }; })
          ['catch'](function () { return null; });
      }
    } catch (e) {}
    return p.then(function (q) { out.quota = q; return out; });
  }

  /* There is no API for a localStorage quota, and a fixed budget is a guess:
     measured on the live site, a cold DexLadder visit already holds ~10.4 MB
     of UTF-16 code units (the 500-coin market cache is most of it) and the
     browser accepts every write. A "5 MB" yardstick would have shown every
     visitor 100% full on their first load. So headroom is MEASURED, not
     assumed: write a 64 KB probe and see whether this browser takes it. */
  var PROBE_KEY = 'dl.vault.probe', PROBE_LEN = 4096, _warned = false;

  /* There is no API for a localStorage quota, and a fixed budget is a guess.
     MEASURED on the live site, 16 Sep 2026: a cold DexLadder visit already
     holds ~10.4 MB of UTF-16 code units — the 500-coin market cache is most
     of it — and a 64 KB probe is REFUSED while the app's own saves still
     land, because a save replaces its key and needs only the delta. So the
     origin sits at the browser's cap by design, and neither a percentage nor
     a big probe can tell a working desk from a broken one.

     Therefore: the probe reports headroom for a realistic incremental write,
     for the panel to state as a fact. It does NOT raise anything. The only
     thing that raises a toast is the app's OWN failure — _saveNow sets
     _quotaWarned when its write throws and it had to prune, _saveFailWarned
     when even the pruned write was refused. Those mean data was actually at
     risk; a full origin on a first visit does not. */
  function headroom() {
    var blob;
    try { blob = new Array(PROBE_LEN + 1).join('x'); } catch (e) { return null; }
    try {
      localStorage.setItem(PROBE_KEY, blob);
      localStorage.removeItem(PROBE_KEY);
      return true;
    } catch (e) {
      try { localStorage.removeItem(PROBE_KEY); } catch (e2) {}
      return false;
    }
  }
  function pressure() {
    return { bytes: lsBytes(), headroom: headroom(), probe: PROBE_LEN };
  }
  function pressureCheck() {
    if (_warned) return;
    if (!(window._quotaWarned || window._saveFailWarned)) return;
    _warned = true;
    try {
      if (typeof toast === 'function') {
        toast(_db && _writable ? 'ok' : 'bad',
          _db && _writable ? 'History kept' : 'Storage is full',
          _db && _writable
            ? 'This browser pruned its saved history to make room, but the vault archive still holds all of it. Export your desk to keep a copy off-device.'
            : 'This browser refused the write and the archive is unavailable here, so the newest changes may be lost on reload. Export your desk now.');
      }
    } catch (e) {}
  }
  /* The app's flags can be set at any point, so watch rather than sample once. */
  var _pressT = 0;
  function watchPressure() {
    if (_pressT) return;
    _pressT = setInterval(function () {
      if (_warned) { clearInterval(_pressT); _pressT = 0; return; }
      pressureCheck();
    }, 15000);
  }

  /* One connection, shared. A second indexedDB.open() against a database
     this page already holds open is the kind of thing that works on a
     desktop and wedges in a sandboxed or memory-tight renderer, so the
     meta store is reached through these rather than reopened. */
  function meta(k) {
    return getRec(STORE_META, k).then(function (r) { return r || null; });
  }
  function setMeta(k, v) {
    return putRec(STORE_META, { k: k, at: Date.now(), value: v });
  }

  /* The pre-import snapshot is taken on every apply(), so the import that
     replaced a desk is reversible for as long as the archive survives. */
  function undoImport() {
    return meta('preimport').then(function (r) {
      if (!r || !r.bundle) return { ok: false, why: 'no pre-import snapshot on this device' };
      return apply(r.bundle).then(function () { return { ok: true, at: r.at }; });
    });
  }

  function page(id, offset, n) {
    offset = Math.max(0, offset | 0); n = Math.max(1, (n | 0) || 200);
    var rec = _cache[id];
    if (!rec) return Promise.resolve({ rows: [], total: 0 });
    return Promise.resolve({ rows: rec.rows.slice(offset, offset + n), total: rec.rows.length });
  }

  /* ------------------------------------------------------------- ui */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  }
  function kb(n) {
    if (!n) return '0 KB';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }

  function panelHTML(st) {
    var rows = '', id;
    for (id in st.series) {
      var s = st.series[id];
      rows += '<tr><td>' + esc(s.label) + '</td><td class="vnum">' + s.live + '</td><td class="vnum">' + s.rows + '</td></tr>';
    }
    var p = pressure();
    var q = st.quota ? kb(st.quota.usage) + ' of ' + kb(st.quota.quota) + ' granted to this site'
                     : 'not reported by this browser';
    var room = p.headroom === true ? 'room for more' : (p.headroom === false ? 'at this browser\'s limit' : 'headroom unknown');
    return '<div class="vault">' +
      '<h3>Vault</h3>' +
      '<p class="vsub">' + (st.idb
        ? '<span class="vok">archive on</span> — history is kept in full, past the 50-fill save window'
        : '<span class="vbad">archive off</span> — ' + (st.connected
            ? 'this browser accepted the database but refuses to write to it, so only the capped window survives a reload'
            : 'this browser blocks IndexedDB, so only the capped window survives a reload')) +
      '</p>' +
      '<table class="vtab"><thead><tr><th>Series</th><th class="vnum">In the app</th><th class="vnum">Archived</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="vgrid">' +
        '<div><b>' + kb(p.bytes) + '</b><span>localStorage · ' + esc(room) + '</span></div>' +
        '<div><b>' + st.local.keys + '</b><span>desk keys</span></div>' +
        '<div style="grid-column:1/-1"><b>Browser storage</b><span>' + esc(q) + '</span></div>' +
      '</div>' +
      '<label class="vchk"><input type="checkbox" id="vSov"> include my signing key — makes the other device <i>this</i> desk. Leave off for a backup you might send.</label>' +
      '<div class="vbtns">' +
        '<button type="button" id="vExp" class="vprim">Export desk</button>' +
        '<button type="button" id="vImp">Import desk</button>' +
        '<input type="file" id="vFile" accept=".cbundle,.json,application/json" hidden>' +
      '</div>' +
      '<p class="vfoot">One signed file: every DexLadder setting on this browser, the full archive, and a SHA-256 checksum over the lot. ' +
        (st.signed ? 'Signed with your own secp256k1 key — anyone can re-verify it, no server, no account. ' : '') +
        'Nothing leaves your device unless you send it.</p>' +
      '<div id="vUndo"></div>' +
      '<div id="vOut" class="vout" hidden></div>' +
    '</div>';
  }

  function wirePanel(root) {
    var $ = function (id) { var e = (root || document).querySelector('#' + id); return e; };
    var out = function (cls, msg) {
      var o = $('vOut'); if (!o) return;
      o.hidden = false; o.className = 'vout ' + cls; o.innerHTML = msg;
    };
    /* An import is reversible while the pre-import snapshot is on the
       device — offer that where the import happened, not in a FAQ. */
    meta('preimport').then(function (r) {
      var host = $('vUndo');
      if (!host || !r || !r.bundle) return;
      var when = new Date(r.at || Date.now()).toISOString().replace('T', ' ').slice(0, 16);
      host.innerHTML = '<p class="vundo">A desk from before your last import (' + esc(when) +
        ') is still on this device. <button type="button" id="vUndoGo">Put it back</button></p>';
      var u = $('vUndoGo');
      if (u) u.addEventListener('click', function () {
        u.disabled = true; out('', 'Restoring the earlier desk…');
        undoImport().then(function (res) {
          if (!res.ok) { out('vbad', esc(res.why)); return; }
          out('vok', 'Restored. Reloading…');
          setTimeout(function () { try { location.reload(); } catch (e) {} }, 900);
        });
      });
    });

    var exp = $('vExp'), imp = $('vImp'), f = $('vFile');
    if (exp) exp.addEventListener('click', function () {
      exp.disabled = true; out('', 'Building…');
      download({ sovereign: !!($('vSov') && $('vSov').checked) }).then(function (r) {
        exp.disabled = false;
        var b = r.bundle, c = b.counts || {};
        out('vok', 'Saved <b>' + esc(r.name) + '</b> · ' + kb(r.bytes) +
          '<br>' + (c.txns || 0) + ' fills · ' + (c.journal || 0) + ' journal · ' +
          (c.alerts || 0) + ' alerts · ' + (c.equity || 0) + ' equity points' +
          '<br>SHA-256 <code>' + esc(String((b.checksum && b.checksum.value) || '—').slice(0, 16)) + '…</code>' +
          (b.sig ? ' · signed <code>' + esc(String(b.pub.x).slice(0, 12)) + '…</code>' : ''));
      })['catch'](function (e) {
        exp.disabled = false; out('vbad', esc((e && e.message) || 'export failed'));
      });
    });
    if (imp && f) {
      imp.addEventListener('click', function () { f.click(); });
      f.addEventListener('change', function () {
        var file = f.files && f.files[0];
        if (!file) return;
        out('', 'Checking ' + esc(file.name) + '…');
        readFile(file).then(function (b) {
          return verify(b).then(function (v) {
            if (!v.ok) { out('vbad', 'Rejected: ' + esc(v.why)); return; }
            var c = b.counts || {};
            var when = esc(String(b.issuedAt || '').replace('T', ' ').slice(0, 16));
            out('', '<b>Verified.</b>' + (v.weak ? ' <i>' + esc(v.weak) + '</i>' : '') +
              '<br>Desk from ' + when + ' · ' + esc(b.app || '') +
              (v.v2
                ? '<br>' + (c.txns || 0) + ' fills · ' + (c.journal || 0) + ' journal · ' +
                  (c.alerts || 0) + ' alerts · ' + (c.equity || 0) + ' equity points' +
                  '<br>' + Object.keys(b.keys || {}).length + ' desk keys' +
                  (b.keys && b.keys[SOV_KEY] ? ' <b>including a signing key</b> — this device becomes that desk.' : '')
                : '<br>Older v1 bundle — carries the capped state only, no archive.') +
              '<br><br>This replaces everything on this browser. ' +
              '<button type="button" id="vGo" class="vprim">Replace my desk</button>');
            var go = (root || document).querySelector('#vGo');
            if (go) go.addEventListener('click', function () {
              go.disabled = true; out('', 'Writing…');
              apply(b).then(function () {
                out('vok', 'Imported. Reloading…');
                setTimeout(function () { try { location.reload(); } catch (e) {} }, 900);
              })['catch'](function (e) {
                out('vbad', 'Import failed: ' + esc((e && e.message) || 'unknown'));
              });
            });
          });
        })['catch'](function (e) {
          out('vbad', esc((e && e.message) || 'could not read that file'));
        });
        f.value = '';
      });
    }
  }

  function panel() {
    if (typeof modal !== 'function') return;
    stats().then(function (st) {
      modal(panelHTML(st));
      wirePanel(document);
    });
  }

  /* SV82's own export button is wired to the v1 builder by an internal
     reference, so the public prop cannot be wrapped. Replacing the node
     with a clone drops that listener; if the panel ever changes shape
     the query finds nothing and the v1 button keeps working untouched. */
  function hookSovereign() {
    var sv = window.SV82;
    if (!sv || typeof sv.open !== 'function' || sv.__vaultHook) return;
    sv.__vaultHook = 1;
    var orig = sv.open;
    sv.open = function () {
      var r = orig.apply(this, arguments);
      setTimeout(function () {
        try {
          var btn = document.getElementById('sv82-export');
          if (!btn || btn.__vault) return;
          var clone = btn.cloneNode(true);
          clone.__vault = 1;
          clone.textContent = btn.textContent.replace(/export/i, 'Export') || 'Export desk';
          btn.parentNode.replaceChild(clone, btn);
          clone.addEventListener('click', function () {
            var res = document.getElementById('sv82-exres');
            if (res) res.innerHTML = 'Building…';
            download({ sovereign: false }).then(function (out) {
              if (!res) return;
              var b = out.bundle, c = b.counts || {};
              res.innerHTML = '<span class="ok">✓ exported ' + esc(out.name) + '</span>' +
                '<div class="hash">' + (c.txns || 0) + ' fills · ' + (c.journal || 0) + ' journal · ' +
                (c.alerts || 0) + ' alerts · ' + (c.equity || 0) + ' equity points — the full archive, not the 50-fill window</div>' +
                (b.sig ? '<div class="hash">sovereign key ' + esc(String(b.pub.x).slice(0, 22)) + '… · sig ' + esc(String(b.sig.r).slice(0, 16)) + '…</div>' : '') +
                '<div class="hash" style="color:var(--faint,#66707E)">SHA-256 ' + esc(String((b.checksum && b.checksum.value) || '').slice(0, 16)) + '… — checked before the signature on import. Your signing key is not in this file.</div>';
            })['catch'](function () {
              if (res) res.innerHTML = '<span class="bad">export failed</span>';
            });
          });
        } catch (e) {}
      }, 60);
      return r;
    };
    /* v2 bundles restore keys + archive; v1 still goes to the original. */
    if (typeof sv.restore === 'function' && !sv.restore.__vault) {
      var origR = sv.restore;
      var wrapped = function (b) {
        if (b && b.spec === SPEC2) {
          apply(b).then(function () {
            try { if (typeof toast === 'function') toast('ok', 'Desk restored', 'Reloading with your full archive…'); } catch (e) {}
            setTimeout(function () { try { location.reload(); } catch (e) {} }, 550);
          });
          return true;
        }
        return origR.apply(this, arguments);
      };
      wrapped.__vault = 1;
      sv.restore = wrapped;
    }
  }

  /* ---------------------------------------------------------- style */
  function style() {
    if (document.getElementById('vaultcss')) return;
    var el = document.createElement('style');
    el.id = 'vaultcss';
    el.textContent = [
      '.vault h3{margin:0 0 4px;font:600 15px/1.2 inherit}',
      '.vault .vsub{margin:0 0 14px;font-size:12px;color:var(--txt-3,#8b95a5)}',
      '.vault .vok{color:#00E676}.vault .vbad{color:#FF5252}',
      '.vtab{width:100%;border-collapse:collapse;font-size:12px;margin:0 0 14px}',
      '.vtab th{text-align:left;font-weight:500;color:var(--txt-3,#8b95a5);padding:4px 0;border-bottom:1px solid rgba(255,255,255,.08)}',
      '.vtab td{padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04)}',
      '.vtab .vnum{text-align:right;font-variant-numeric:tabular-nums}',
      '.vgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 14px}',
      '.vgrid>div{background:rgba(255,255,255,.04);border-radius:8px;padding:8px 10px}',
      '.vgrid b{display:block;font:600 14px/1.3 inherit}',
      '.vgrid span{display:block;font-size:11px;color:var(--txt-3,#8b95a5);margin-top:2px}',
      '.vchk{display:flex;gap:8px;align-items:flex-start;font-size:11.5px;color:var(--txt-3,#8b95a5);margin:0 0 12px;cursor:pointer;line-height:1.45}',
      '.vchk input{margin-top:2px;flex:0 0 auto}',
      '.vbtns{display:flex;gap:8px}',
      '.vbtns button{flex:1;padding:9px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:transparent;color:inherit;font:600 12.5px/1 inherit;cursor:pointer}',
      '.vbtns button.vprim{background:var(--acc,#00E676);border-color:transparent;color:#03110a}',
      '.vbtns button:disabled{opacity:.5;cursor:default}',
      '.vundo{margin:12px 0 0;font-size:11.5px;color:var(--txt-3,#8b95a5);line-height:1.5}',
      '.vundo button{margin-left:4px;padding:4px 9px;border-radius:7px;border:1px solid rgba(255,255,255,.18);background:transparent;color:inherit;font:600 11px/1 inherit;cursor:pointer}',
      '.vault .vfoot{margin:12px 0 0;font-size:11px;color:var(--txt-3,#8b95a5);line-height:1.5}',
      '.vout{margin-top:12px;padding:10px;border-radius:8px;background:rgba(255,255,255,.05);font-size:12px;line-height:1.55}',
      '.vout.vok{background:rgba(0,230,118,.10)}.vout.vbad{background:rgba(255,82,82,.12)}',
      '.vout code{font-size:11px;opacity:.8}',
      '.vout button{margin-top:8px;padding:8px 12px;border-radius:8px;border:0;background:var(--acc,#00E676);color:#03110a;font:600 12px/1 inherit;cursor:pointer}',
      '@media(max-width:520px){.vgrid{grid-template-columns:1fr}}'
    ].join('');
    document.head.appendChild(el);
  }

  /* ----------------------------------------------------------- boot */
  function boot() {
    style();
    wire();
    hookSovereign();
    loadAll().then(probeWrite).then(function () { capture(); flush(); pressureCheck(); });
    /* later layers may replace _saveNow or mount SV82 after us */
    setTimeout(function () { wire(); hookSovereign(); }, 3000);
    watchPressure();
    try { window.addEventListener('pagehide', function () { try { capture(); flush(); } catch (e) {} }); } catch (e) {}
  }

  window.DLVAULT = {
    SPEC: SPEC2, DB: DB_NAME,
    open: open, ready: open(),
    stats: stats, pressure: pressure, page: page,
    meta: meta, setMeta: setMeta, undoImport: undoImport,
    APP_DB: APP_DB, writable: function () { return _writable; },
    capture: capture, flush: flush,
    bundle: bundle, verify: verify, apply: apply, download: download,
    panel: panel,
    _stable: stable, _sha256: sha256Hex
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
