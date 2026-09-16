/* ============================================================
   DLFOOT · v162 — the footer, rebuilt to the shape a footer is
   supposed to have (owner report, 13 Sep 2026, two screenshots).

   What was wrong, measured in the harness at 1440px:
     .foot>div:first-child   320px   ← eighteen SEO links wrapped
                                       inside a 320px column, 105px tall
     .foot .src              884px   ← a lone sentence stretched across
     .netline                820px
     .dlt-id                 860px   centred at x=290
     .dlt-links              920px   centred at x=260
     .disc                   860px
   Six blocks, six different widths, four different left edges, and the
   whole site map delivered as one ragged run-on line of middots. That is
   the "unorganised and unnecessarily wide" the owner saw.

   What this layer does: it does NOT invent a single link. It harvests the
   nodes that are already in the footer — the SEO row, the blog row, the
   DLTRUST buttons, the brand, the source line, the stat strip and the
   disclaimer — and re-lays them on ONE grid: a brand column plus four
   labelled link columns, a provenance/stat band, a legal bar, and the
   disclaimer. Every band shares the same left and right edge.

   Rules it keeps: no inline style attributes and no .style assignments
   (gate-arch ratchets), no invented labels, no link dropped — an
   unrecognised label lands in the last column rather than vanishing —
   idempotent, and a no-op on any payload where the footer never mounted.
   ============================================================ */
window.DLFOOT = (function () {
  "use strict";
  if (window.DLFOOT && window.DLFOOT.__v) return window.DLFOOT;
  var d = document;

  /* label (lower-cased, punctuation-stripped) → where it belongs.
     Labels, not hrefs: the DLTRUST entries are buttons with no href, and a
     renamed static page must not silently fall out of its column. */
  var COLS = [
    { id: "trade", t: "Trade", keys: ["paper trading", "perps", "order types", "bots", "backtesting", "fork sandbox"] },
    { id: "chain", t: "On-chain", keys: ["web3 gateway", "defi mechanics", "pool radar", "explorer", "proof ledger"] },
    { id: "learn", t: "Learn", keys: ["blog", "what is dexladder", "the execution engine", "how it is built", "guides", "glossary", "calculators", "crypto tax"] },
    { id: "project", t: "Project", keys: ["about", "whats different", "the paper", "methodology", "sources", "changelog", "roadmap", "my stats"] }
  ];
  var LEGAL = ["privacy", "terms", "disclaimer", "contact"];
  var SOCIAL = ["x", "github", "instagram", "medium", "contact email"];

  function key(el) {
    var t = (el.textContent || "").replace(/[\u{1F300}-\u{1FAFF}☀-➿️\u{1D400}-\u{1D7FF}⌘⌥]/gu, " ");
    t = t.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
    if (el.tagName === "A") {
      var h = el.getAttribute("href") || "";
      if (/^mailto:/.test(h)) return "contact email";
      if (/github\.com/.test(h)) return "github";
      if (/instagram\.com/.test(h)) return "instagram";
      if (/medium\.com/.test(h)) return "medium";
      if (/(^|\/\/)(x|twitter)\.com/.test(h)) return "x";
    }
    return t;
  }
  function place(k) {
    for (var i = 0; i < COLS.length; i++) if (COLS[i].keys.indexOf(k) > -1) return COLS[i].id;
    if (LEGAL.indexOf(k) > -1) return "legal";
    if (SOCIAL.indexOf(k) > -1) return "social";
    return "project";                      /* nothing is ever dropped */
  }

  function el(tag, cls, parent) {
    var n = d.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }

  var CSS = [
    ".dlf{display:block}",
    ".dlf-top{display:grid;grid-template-columns:minmax(230px,1.35fr) repeat(4,minmax(0,1fr));gap:30px 26px;align-items:start}",
    ".dlf-brand{min-width:0}",
    ".dlf-brand .brand{font-size:17px;margin-bottom:10px}",
    ".dlf-blurb{margin:0;max-width:32ch;color:var(--muted);font-size:13px;line-height:1.65}",
    ".dlf-social{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}",
    ".dlf-social a,.dlf-social button{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:rgba(255,255,255,.045);color:var(--ink-2);border-radius:999px;padding:6px 12px;font:700 11.5px var(--body);text-decoration:none;cursor:pointer}",
    ".dlf-social a:hover,.dlf-social button:hover{border-color:var(--cyan);color:var(--ink)}",
    ".dlf-col{min-width:0}",
    ".dlf-h{font:800 10.5px var(--body);letter-spacing:.13em;text-transform:uppercase;color:var(--faint);margin:2px 0 12px}",
    ".dlf-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}",
    ".dlf-list li{margin:0}",
    ".dlf-list a,.dlf-list button{display:block;width:100%;text-align:left;border:0;background:none;padding:5px 0;margin:0;font:500 13px/1.45 var(--body);color:var(--muted);text-decoration:none;cursor:pointer}",
    ".dlf-list a:hover,.dlf-list button:hover{color:var(--ink);text-decoration:underline;text-underline-offset:3px}",
    ".dlf-rule{height:1px;background:var(--line);margin:28px 0 18px;border:0}",
    ".dlf-mid{display:flex;flex-wrap:wrap;gap:14px 34px;align-items:flex-start;justify-content:space-between}",
    ".dlf-src{flex:1 1 420px;min-width:0;max-width:640px}",
    ".dlf-src .dlf-h{margin-bottom:7px}",
    ".dlf-src .src{font-size:12px;line-height:1.65;color:var(--muted);max-width:none}",
    ".dlf-src .src a{color:var(--indigo);font-weight:600}",
    ".dlf-stats{flex:0 1 auto;min-width:0;max-width:100%}",
    ".dlf-stats .netline{margin:0;max-width:none;justify-content:flex-end}",
    ".dlf-bot{display:flex;flex-wrap:wrap;gap:10px 24px;align-items:center;justify-content:space-between;margin-top:6px}",
    ".dlf-bot .dlt-id{margin:0;max-width:none;text-align:left;font-size:12px}",
    ".dlf-legal{display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center;margin:0;max-width:none;justify-content:flex-end}",
    ".dlf-legal button,.dlf-legal a{border:0;background:none;color:var(--muted);font:600 12px var(--body);padding:4px 6px;cursor:pointer;text-decoration:none}",
    ".dlf-legal button:hover,.dlf-legal a:hover{color:var(--ink);text-decoration:underline;text-underline-offset:3px}",
    /* the Find DexLadder row on About/Contact is a row of equals; .dlt-hbtn's margin-left:auto
       exists for the single header button. Declared here so a new entry needs no inline style
       (gate-arch ratchets inline style attributes, and they may only go down). */
    ".dlt-badge-row .dlt-hbtn{margin-left:0}",
    ".dlf .disc{margin-top:18px;padding-top:16px;max-width:104ch;font-size:11.5px;line-height:1.7;color:var(--faint)}",
    "@media(max-width:1080px){.dlf-top{grid-template-columns:repeat(4,minmax(0,1fr))}.dlf-brand{grid-column:1/-1}.dlf-blurb{max-width:46ch}}",
    "@media(max-width:760px){.dlf-top{grid-template-columns:repeat(2,minmax(0,1fr));gap:26px 20px}.dlf-mid{flex-direction:column;gap:18px}.dlf-src{max-width:none;flex:1 1 auto}.dlf-stats .netline{justify-content:flex-start}.dlf-bot{flex-direction:column;align-items:flex-start;gap:12px}.dlf-legal{justify-content:flex-start;margin-left:-6px}}",
    "@media(max-width:420px){.dlf-top{gap:22px 14px}.dlf-list a,.dlf-list button{font-size:12.5px}}"
  ].join("");

  function style() {
    if (d.getElementById("dlf-css")) return;
    var s = d.createElement("style");
    s.id = "dlf-css";
    s.textContent = CSS;
    (d.head || d.documentElement).appendChild(s);
  }

  function mount() {
    var wrap = d.querySelector("footer .wrap");
    if (!wrap || wrap.querySelector(".dlf")) return !!wrap && !!wrap.querySelector(".dlf");
    var foot = wrap.querySelector(".foot"), links = wrap.querySelector(".dlt-links");
    if (!foot || !links) return false;              /* DLTRUST has not mounted yet */

    var brand = foot.querySelector(".brand"),
        blurb = foot.querySelector("p"),
        srcEl = foot.querySelector(".src"),
        net = wrap.querySelector(".netline"),
        idLine = wrap.querySelector(".dlt-id"),
        disc = wrap.querySelector(".disc");
    if (!brand || !srcEl) return false;

    /* --- harvest every existing control, first spelling of a label wins, and
           an <a> (crawlable) beats a duplicate <button> for the same label --- */
    var seen = {}, buckets = { trade: [], chain: [], learn: [], project: [], legal: [], social: [] };
    var sets = [wrap.querySelector("#dl-seo-links"), wrap.querySelector(".dl-foot-blog:not(#dl-seo-links)"), links];
    var raw = [];
    sets.forEach(function (set) {
      if (!set) return;
      Array.prototype.forEach.call(set.querySelectorAll("a,button"), function (n) { raw.push(n); });
    });
    raw.sort(function (a, b) { return (a.tagName === "A" ? 0 : 1) - (b.tagName === "A" ? 0 : 1); });
    raw.forEach(function (n) {
      var k = key(n);
      /* a label spelled twice (About is both a static page and a trust tab) keeps the
         crawlable <a>; the duplicate control is removed rather than left orphaned. */
      if (!k || seen[k]) { if (n.parentNode) n.parentNode.removeChild(n); return; }
      seen[k] = 1;
      buckets[place(k)].push({ k: k, n: n });
    });
    /* restore the authored order inside each column */
    COLS.forEach(function (c) {
      buckets[c.id].sort(function (a, b) {
        var ia = c.keys.indexOf(a.k), ib = c.keys.indexOf(b.k);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
    });
    buckets.legal.sort(function (a, b) { return LEGAL.indexOf(a.k) - LEGAL.indexOf(b.k); });
    buckets.social.sort(function (a, b) { return SOCIAL.indexOf(a.k) - SOCIAL.indexOf(b.k); });

    style();

    /* --- build --- */
    var root = el("div", "dlf");
    var top = el("nav", "dlf-top", root);
    top.setAttribute("aria-label", "Footer");

    var bcol = el("div", "dlf-brand", top);
    bcol.appendChild(brand);
    if (blurb) { blurb.className = (blurb.className ? blurb.className + " " : "") + "dlf-blurb"; bcol.appendChild(blurb); }
    if (buckets.social.length) {
      var soc = el("div", "dlf-social", bcol);
      buckets.social.forEach(function (o) { soc.appendChild(o.n); });
    }

    COLS.forEach(function (c) {
      if (!buckets[c.id].length) return;
      var col = el("div", "dlf-col", top);
      el("div", "dlf-h", col).textContent = c.t;
      var ul = el("ul", "dlf-list", col);
      buckets[c.id].forEach(function (o) { el("li", "", ul).appendChild(o.n); });
    });

    el("hr", "dlf-rule", root);

    var mid = el("div", "dlf-mid", root);
    var sbox = el("div", "dlf-src", mid);
    el("div", "dlf-h", sbox).textContent = "Data sources";
    sbox.appendChild(srcEl);
    if (net) el("div", "dlf-stats", mid).appendChild(net);

    var bot = el("div", "dlf-bot", root);
    if (idLine) bot.appendChild(idLine);
    if (buckets.legal.length) {
      var lg = el("div", "dlf-legal", bot);
      buckets.legal.forEach(function (o) { lg.appendChild(o.n); });
    }
    if (disc) root.appendChild(disc);

    wrap.insertBefore(root, foot);
    if (foot.parentNode) foot.parentNode.removeChild(foot);
    /* the shells DLTRUST and the SEO builder leave behind once their contents moved */
    Array.prototype.slice.call(wrap.children).forEach(function (n) {
      if (n === root) return;
      if (!n.children.length && !(n.textContent || "").trim() && n.parentNode) n.parentNode.removeChild(n);
    });
    return true;
  }

  /* DLTRUST mounts the identity line and the trust buttons a beat after boot,
     and the SEO builder's row is in the served HTML, so one bounded poll in the
     house style covers every order those can arrive in. */
  (function arm() {
    if (mount()) return;
    var n = 0, iv = setInterval(function () {
      if (mount() || ++n > 200) clearInterval(iv);
    }, 250);
  })();

  return { __v: 162, mount: mount, columns: COLS };
})();
