/* ============================================================
   DLMXC · v164 — the market cache leaves localStorage.

   WHY
   ---
   `cb_mx_cache_v1` is the 500-coin CoinGecko/Coinpaprika snapshot the
   Markets screener writes after every successful load. Measured on a
   cold visit to dexladder.com it is the single largest thing in the
   origin's localStorage — most of the ~10.4 MB of UTF-16 code units
   that v163 found there. It is also, entirely, a CACHE: every field in
   it is re-fetched on the next load, and losing it costs one network
   round trip and nothing else.

   Two things were paying for that:

     1. The desk. `coinbridge.v1` — the state that actually matters —
        shares the same origin budget, and _saveNow()'s quota catch
        prunes REAL history (txns to 25, journal to 20, eq to 40) the
        first time a write throws. A disposable snapshot was crowding
        out fills.

     2. Every export. DLVAULT.readLocal() walks the `cb_` prefix, so
        the sovereign bundle carried the market cache — signed,
        checksummed, and mailed to another machine. A bundle whose bulk
        is a stale CoinGecko page is not a record of a desk.

   WHAT THIS DOES
   --------------
   The pack moves to the vault's own IndexedDB, under meta key
   `mxcache`. bundle() exports `archive` and `keys`, not the meta
   store, so the cache stops travelling with exports; 48-vault.js also
   drops the key from deskKeys() outright, which protects a user whose
   migration has not run yet.

   SYNCHRONY. cacheLoad() is called from load()'s first paint path and
   must answer synchronously. It still does: get() reads an in-memory
   pack this layer hydrates from IndexedDB at DOMContentLoaded, before
   __MXPRO's own boot() (also DOMContentLoaded) reaches the markets
   route. If hydration has not finished — private mode, blocked
   storage, a slow disk — get() returns null, the screener falls back
   to useStatic() exactly as it does on a first visit, and paint()
   re-renders the moment the pack lands. No ordering changes, and no
   await is introduced into a render path.

   FAILURE MODEL. No DLVAULT, no IndexedDB, or a rejected read: the
   legacy localStorage key is still honoured on read, so an existing
   visitor keeps their cache. Nothing here throws into MXPRO's stack.
   ============================================================ */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.DLMXC) return;

  var KEY = 'cb_mx_cache_v1';   /* the retired localStorage key */
  var MKEY = 'mxcache';         /* meta key inside dexladder-vault */
  var _mem = null, _hydrated = false, _t = null, _wroteAt = 0, _from = 'none';

  function vault() { try { return window.DLVAULT || null; } catch (e) { return null; } }

  function readLegacy() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (o && o.coins && o.coins.length) return o;
    } catch (e) {}
    return null;
  }
  function dropLegacy() { try { localStorage.removeItem(KEY); } catch (e) {} }

  /* Synchronous by contract — cacheLoad() calls this inside a render path. */
  function get(maxAge) {
    var o = _mem || readLegacy();
    if (!o || !o.coins || !o.coins.length) return null;
    if (maxAge && Date.now() - (o.t || 0) > maxAge) return null;
    return o;
  }

  /* One write in flight. The screener calls cacheSave() after every
     successful load and the pack is ~10 MB of structured clone; a
     debounce keeps that off the critical path. */
  function put(coins) {
    if (!coins || !coins.length) return;
    _mem = { t: Date.now(), coins: coins };
    dropLegacy();
    var v = vault();
    if (!v || !v.setMeta || _t) return;
    _t = setTimeout(function () {
      _t = null;
      try {
        v.setMeta(MKEY, _mem).then(function () { _wroteAt = Date.now(); }, function () {});
      } catch (e) {}
    }, 1500);
  }

  /* If the pack lands after the screener has already painted static
     rows, promote it — but never over live data. */
  function paint() {
    try {
      var M = window.MXP;
      if (!M || !M.state || !_mem || !_mem.coins || !_mem.coins.length) return;
      if (M.state.src === 'live') return;
      if (M.state.coins && M.state.coins.length && M.state.src === 'cache') return;
      M.state.coins = _mem.coins;
      M.state.src = 'cache';
      if (typeof M.render === 'function') M.render();
    } catch (e) {}
  }

  function hydrate() {
    if (_hydrated) return Promise.resolve(_mem);
    _hydrated = true;
    var legacy = readLegacy();
    var v = vault();
    if (!v || !v.ready || !v.meta) { _mem = legacy; _from = legacy ? 'localStorage' : 'none'; return Promise.resolve(_mem); }
    return v.ready.then(function () { return v.meta(MKEY); }).then(function (r) {
      var pack = (r && r.value) ? r.value : null;
      _from = pack ? 'vault' : 'none';
      /* A legacy key newer than the archived pack wins once, then migrates. */
      if (legacy && (!pack || (legacy.t || 0) > (pack.t || 0))) { pack = legacy; _from = 'localStorage'; }
      _mem = pack || null;
      if (legacy) {
        if (_mem) { try { v.setMeta(MKEY, _mem); } catch (e) {} }
        dropLegacy();
      }
      paint();
      return _mem;
    })['catch'](function () { _mem = legacy; _from = legacy ? 'localStorage' : 'none'; return _mem; });
  }

  function stats() {
    var n = 0;
    try { n = _mem ? JSON.stringify(_mem).length * 2 : 0; } catch (e) { n = 0; }
    return {
      coins: (_mem && _mem.coins) ? _mem.coins.length : 0,
      at: _mem ? (_mem.t || 0) : 0,
      bytes: n,
      from: _from,
      wroteAt: _wroteAt,
      legacyPresent: !!readLegacy()
    };
  }

  window.DLMXC = { KEY: KEY, MKEY: MKEY, get: get, put: put, hydrate: hydrate, stats: stats };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { hydrate(); }, { once: true });
  } else { hydrate(); }
})();
