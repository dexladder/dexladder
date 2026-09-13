/* ============================================================
   DLNEWSX · v157 — the News desk's transport ladder
   Owner report (12 Sep 2026): "In News section the latest news on
   top categorised is not loading."

   REPRODUCED on https://dexladder.com/#/news (v156, Chrome):
     newsCache.length 0 · #frontPkg 0 children · #newsSections 0
   Cause — every transport the desk had was dead at once:
     /api/news            200 text/html (the API tier is not
                          deployed, so the SPA shell answers);
                          DLRX correctly refuses a non-JSON body
     corsproxy.io         401, an API key is required now
                          (DLRX already shifts this rung off)
     api.allorigins.win   500 from its nginx, then TCP timeouts
     api.codetabs.com     522
   fetchFeed therefore returned [] for all six FEEDS, loadNews took
   its !all.length branch, and renderNewsFallback BLANKS #frontPkg
   and #newsSections outright — which is exactly the symptom: the
   categorised front page never arrives.
   The gates never saw it because test/harness.js mocked
   allorigins/codetabs ALIVE. They are mocked dead now, and
   gate154's "== 11-newsfeed" block fails if the categorised bands
   are empty on a payload whose bridges answer.

   FIX — a four-rung ladder with health memory, tried only AFTER
   the server-first path (DLRX /api/news) comes back empty, so the
   API tier still wins the moment it ships:
     1 test.cors.workers.dev     raw XML → the payload's own parseRSS
     2 api.rss2json.com          RSS→JSON, ACAO *, carries thumbnails
     3 api.allorigins.win        raw XML → parseRSS  (benched while dead)
     4 api.codetabs.com          raw XML → parseRSS  (benched while dead)
   Rungs 1 and 2 were verified live from the dexladder.com origin on
   12 Sep 2026; 3 and 4 stay on the ladder because they recover, and
   a rung that throws or answers empty is benched for 10 minutes. A
   rung that answers is remembered in localStorage and promoted to
   the front, so the steady state is one request per feed. The
   legacy PROXIES array is EMPTIED (mutated, never rebound) so the
   old path cannot burn 2 x 6s per feed on hosts this ladder already
   owns and times honestly.
   Every bridge is named on screen: the news note says which one
   served, and the privacy page lists all four (buildlib/v156.py).

   v158 (12 Sep 2026, evening) — REPORTED AGAIN, and reproduced in
   the owner's own Chrome on the live v157 payload: newsCache 0,
   #frontPkg 0, every rung 8/8 failed. Measured from that browser:
     test.cors.workers.dev   429 with no CORS header (the free demo
                             Worker's quota) → the browser sees a
                             TypeError, not a status
     api.rss2json.com        422 — the free tier REJECTS `count=30`
                             (only an api_key may raise the 10-item
                             cap); the same request without `count`
                             answers 200 · 10 items in 18 ms
     api.allorigins.win/raw  408 in 18 ms   (dead)
     api.allorigins.win/get  200 · full feed · 3.0 s (JSON wrapper)
     api.codetabs.com        TCP timeout    (dead)
     api.cors.lol            200 · full feed · 0.9 s
     corsproxy.io 401 · thingproxy dead · cors-anywhere 403
   So rung 2 had been dead-on-arrival by its own query string, and
   the one live rung died of quota within hours. The ladder now has
   SIX rungs (two of them new) and rss2json asks for nothing it is
   not allowed to have. The harness mocks every one of these with
   the status it really returned tonight, so the suite can no longer
   pass on a transport the open web refuses.
   Rung order is the measured order: cors.lol (full feed, fastest),
   allorigins /get (full feed), rss2json (10 items, instant), then
   the three that only recover sometimes. Health memory re-orders.

   Layer contract: wraps window functions only, mutates (never
   rebinds) top-level lets/consts, idempotent, no persistent timers.
   ============================================================ */
window.DLNEWSX = (function () {
  "use strict";
  if (window.DLNEWSX && window.DLNEWSX.__v) return window.DLNEWSX;

  var HKEY = "dl.newsx.health.v1", BENCH = 600000, CAP = 30;
  var ST = { served: {}, fails: {}, last: null, legacyRetired: 0 };

  function hGet() { try { return JSON.parse(localStorage.getItem(HKEY) || "{}") || {}; } catch (e) { return {}; } }
  function hSet(h) { try { localStorage.setItem(HKEY, JSON.stringify(h)); } catch (e) {} }
  function tmo(ms) { try { if (window.AbortSignal && AbortSignal.timeout) return AbortSignal.timeout(ms); } catch (e) {} return undefined; }
  function strip(s) { return String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }
  function firstImg(h) { var m = String(h || "").match(/<img[^>]+src=["']([^"']+)["']/i); return m ? m[1] : ""; }

  /* rss2json prints UTC with no zone ("2026-09-11 21:30:00"); Date.parse would
     read that as LOCAL time and every headline's "Xh ago" would be wrong by the
     viewer's offset. Only trust the string's own parse when it carries a zone. */
  function when(v) {
    if (!v) return Date.now();
    var s = String(v).trim(), t;
    if (/[zZ]$|[+-]\d{2}:?\d{2}$|GMT|UTC|,/.test(s)) { t = Date.parse(s); if (!isNaN(t)) return t; }
    t = Date.parse(s.replace(" ", "T") + "Z");
    if (!isNaN(t)) return t;
    t = Date.parse(s);
    return isNaN(t) ? Date.now() : t;
  }

  function shape(feed, o) {
    return {
      title: o.title, link: o.link, img: o.img || "",
      source: feed.name, ic: feed.ic, color: feed.color, srcImg: "",
      domain: feed.domain || "", t: o.t, excerpt: String(o.excerpt || "").slice(0, 160)
    };
  }

  /* ---------------------------------------------------------- rung 1 · rss2json (JSON) */
  function viaRss2Json(feed) {
    /* NO `count=` — the free tier answers 422 to any count above its 10-item cap,
       and 422 to `count=30` was the whole reason this rung failed 8/8 in production. */
    var u = "https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(feed.url);
    return window.fetch(u, { signal: tmo(9000) }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || j.status !== "ok" || !j.items || !j.items.length) throw new Error("empty");
      var out = [];
      for (var i = 0; i < j.items.length && out.length < CAP; i++) {
        var it = j.items[i];
        if (!it || !it.title || !it.link) continue;
        out.push(shape(feed, {
          title: it.title, link: it.link,
          img: it.thumbnail || (it.enclosure && it.enclosure.link) || firstImg(it.content || it.description),
          t: when(it.pubDate),
          excerpt: strip(it.description || it.content)
        }));
      }
      if (!out.length) throw new Error("empty");
      return out;
    });
  }

  /* ---------------------------------------------------------- allorigins /get · JSON wrapper → parseRSS
     /raw answers 408 in 18 ms; /get (the JSON envelope, `contents` = the feed's own XML)
     answers 200 with the full feed. Same host, different door. */
  function viaAllOriginsGet(feed) {
    var u = "https://api.allorigins.win/get?url=" + encodeURIComponent(feed.url);
    return window.fetch(u, { signal: tmo(9000) }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (j) {
      var x = j && j.contents;
      if (!x || typeof x !== "string" || x.length < 200) throw new Error("empty");
      var items = (typeof parseRSS === "function") ? parseRSS(x, feed) : [];
      if (!items || !items.length) throw new Error("empty");
      return items.slice(0, CAP);
    });
  }

  /* ---------------------------------------------------------- raw XML → parseRSS */
  function viaXml(mk, ms) {
    return function (feed) {
      return window.fetch(mk(feed.url), { signal: tmo(ms) }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      }).then(function (x) {
        var items = (typeof parseRSS === "function") ? parseRSS(x, feed) : [];
        if (!items || !items.length) throw new Error("empty");
        return items.slice(0, CAP);
      });
    };
  }

  /* Measured order, 12 Sep 2026 evening, from the owner's browser (see the header):
     the two full-feed bridges lead, rss2json (10 items, instant) is the first fallback,
     and the three that only recover sometimes trail. The health store re-orders either
     way: a rung that answers is promoted, one that fails is benched for ten minutes. */
  var RUNGS = [
    { k: "corslol", host: "api.cors.lol", get: viaXml(function (u) { return "https://api.cors.lol/?url=" + encodeURIComponent(u); }, 8000) },
    { k: "allorigins", host: "allorigins.win", get: viaAllOriginsGet },
    { k: "rss2json", host: "rss2json.com", get: viaRss2Json },
    { k: "corsworkers", host: "test.cors.workers.dev", get: viaXml(function (u) { return "https://test.cors.workers.dev/?" + u; }, 8000) },
    { k: "alloriginsraw", host: "allorigins.win/raw", get: viaXml(function (u) { return "https://api.allorigins.win/raw?url=" + encodeURIComponent(u); }, 6000) },
    { k: "codetabs", host: "codetabs.com", get: viaXml(function (u) { return "https://api.codetabs.com/v1/proxy/?quest=" + encodeURIComponent(u); }, 6000) }
  ];

  function order() {
    var h = hGet(), now = Date.now();
    return RUNGS.map(function (r, i) {
      var s = h[r.k] || {};
      return { r: r, b: (s.fail && now - s.fail < BENCH) ? 1 : 0, ok: s.ok || 0, i: i };
    }).sort(function (a, b) {
      return (a.b - b.b) || (b.ok - a.ok) || (a.i - b.i);
    }).map(function (x) { return x.r; });
  }

  function mark(k, good) {
    var h = hGet();
    h[k] = h[k] || {};
    if (good) { h[k].ok = Date.now(); delete h[k].fail; ST.served[k] = (ST.served[k] || 0) + 1; ST.last = k; }
    else { h[k].fail = Date.now(); ST.fails[k] = (ST.fails[k] || 0) + 1; }
    hSet(h);
  }

  function ladder(feed) {
    var rs = order(), i = 0;
    function step() {
      if (i >= rs.length) return [];
      var r = rs[i++];
      var p;
      try { p = r.get(feed); } catch (e) { mark(r.k, false); return step(); }
      return p.then(function (items) { mark(r.k, true); return items; })
        .catch(function () { mark(r.k, false); return step(); });
    }
    return Promise.resolve().then(step);
  }

  function bridgeLabel() {
    for (var i = 0; i < RUNGS.length; i++) if (RUNGS[i].k === ST.last) return RUNGS[i].host;
    return null;
  }

  /* ---------------------------------------------------------- retire the legacy proxy path */
  /* Those hosts are rungs 3 and 4 here, with a deadline and a bench. Leaving them in
     PROXIES too means every feed waits 12s on them twice over before this ladder runs. */
  try {
    if (typeof PROXIES !== "undefined" && PROXIES && PROXIES.length) {
      ST.legacyRetired = PROXIES.length;
      PROXIES.length = 0;
    }
  } catch (e) {}

  /* ---------------------------------------------------------- wrap fetchFeed (outermost) */
  try {
    if (typeof window.fetchFeed === "function" && !window.fetchFeed.__dlNewsx) {
      var inner = window.fetchFeed;
      var w = function (feed) {
        if (!feed || !feed.url) return Promise.resolve([]);
        return Promise.resolve().then(function () { return inner(feed); })
          .catch(function () { return []; })
          .then(function (items) {
            if (items && items.length) return items;
            return ladder(feed);
          })
          .catch(function () { return []; });
      };
      w.__dlNewsx = 1;
      window.fetchFeed = w;
    }
  } catch (e) {}

  /* ---------------------------------------------------------- name the bridge on screen */
  try {
    if (typeof window.loadNews === "function" && !window.loadNews.__dlNewsx) {
      var ln = window.loadNews;
      var w2 = async function (force) {
        var r = await ln(force);
        try {
          var note = document.getElementById("newsNote"), b = bridgeLabel();
          if (note && b && typeof newsCache !== "undefined" && newsCache.length &&
              note.innerHTML.indexOf("live headlines") >= 0 && note.innerHTML.indexOf("via ") < 0) {
            note.innerHTML += ' <span class="dot"></span> via ' + b;
          }
        } catch (e) {}
        return r;
      };
      w2.__dlNewsx = 1;
      window.loadNews = w2;
    }
  } catch (e) {}

  return {
    __v: 158,
    status: function () { return JSON.parse(JSON.stringify(ST)); },
    bridge: bridgeLabel,
    rungs: function () { return order().map(function (r) { return r.k; }); },
    health: hGet,
    parseWhen: when,
    reset: function () { try { localStorage.removeItem(HKEY); } catch (e) {} },
    fetch: ladder
  };
})();
