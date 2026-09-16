/* ============================================================
   DLRUNGS · v154 — Rungs: named lenses over the 500-coin ladder
   A Rung = { id, name, syms[], note } — replaces "multiple watchlists",
   the filter drawer and the tab strip with one object. Curated rungs
   are computed live (Climbers, Sliders, Oversold, Overbought, Clean
   Ladder). The Home rung is the existing ☆ watchlist. Rungs persist in
   S.v154.rungs (inside the coinbridge.v1 blob → backups round-trip).
   Sharing is a secp256k1-signed link (the sovereign key that already
   signs certificates) — no accounts, no followers.
   MX integration: build patch adds a "rung" filter branch to
   compute() that calls DLRUNGS.activeSet().
   ============================================================ */
window.DLRUNGS = (function () {
  "use strict";
  if (window.DLRUNGS && window.DLRUNGS.__v) return window.DLRUNGS;
  var C = window.DLCORE, $ = C.$, esc = C.esc;
  var WRAPPED = { WBTC: 1, WETH: 1, STETH: 1, WSTETH: 1, CBBTC: 1, WEETH: 1, EETH: 1, RETH: 1, EZETH: 1, RSETH: 1, METH: 1, SFRXETH: 1, FRXETH: 1, WBETH: 1, BNSOL: 1, JITOSOL: 1, MSOL: 1, TBTC: 1, HBTC: 1, LBTC: 1, SOLVBTC: 1, CWBTC: 1, RENBTC: 1, WBNB: 1, WAVAX: 1, WMATIC: 1, WPOL: 1, WSOL: 1, WFTM: 1, WTRX: 1, WHBAR: 1, OSETH: 1, ANKRETH: 1, SWETH: 1, STMATIC: 1, MATICX: 1, STSOL: 1, BSOL: 1, SUSDE: 0, WEETHS: 1, UNIBTC: 1, FBTC: 1, PUMPBTC: 1, CBETH: 1, STBTC: 1, LSETH: 1, ETHX: 1, RSWETH: 1, STONE: 1, XSOLVBTC: 1 };
  var CURATED = [
    { id: "cur.climb", name: "Climbers", ic: "🧗", note: "Top 40 by 7-day change", fn: function (all) { return all.filter(function (c) { return c.c7 != null; }).sort(function (a, b) { return b.c7 - a.c7; }).slice(0, 40); } },
    { id: "cur.slide", name: "Sliders", ic: "🎿", note: "Bottom 40 by 7-day change", fn: function (all) { return all.filter(function (c) { return c.c7 != null; }).sort(function (a, b) { return a.c7 - b.c7; }).slice(0, 40); } },
    { id: "cur.oversold", name: "Oversold", ic: "🧊", note: "RSI-14 on the 7-day sparkline below " + DLAPP.indicators.RSI_OVERSOLD, fn: function (all) { return all.filter(function (c) { return DLAPP.indicators.isOversold(c.spark || []); }).sort(function (a, b) { return b.mcap - a.mcap; }).slice(0, 60); } },
    { id: "cur.overbought", name: "Overbought", ic: "🔥", note: "RSI-14 on the 7-day sparkline above " + DLAPP.indicators.RSI_OVERBOUGHT, fn: function (all) { return all.filter(function (c) { return DLAPP.indicators.isOverbought(c.spark || []); }).sort(function (a, b) { return b.mcap - a.mcap; }).slice(0, 60); } },
    { id: "cur.clean", name: "Clean Ladder", ic: "🧹", note: "Hides wrapped, liquid-staked and bridged duplicates", fn: function (all) { return all.filter(function (c) { return !WRAPPED[c.sym]; }); } },
    { id: "cur.volume", name: "Heavy tape", ic: "🌊", note: "Volume above 15% of market cap — something is moving it", fn: function (all) { return all.filter(function (c) { return c.mcap > 0 && c.vol / c.mcap > 0.15; }).sort(function (a, b) { return b.vol / b.mcap - a.vol / a.mcap; }).slice(0, 60); } }
  ];
  function X() { var x = C.X(); if (!x) return null; x.rungs || (x.rungs = []); return x; }
  function all() { return C.coinsAll(); }
  function uid() { return "r" + Math.random().toString(36).slice(2, 8); }
  function list() { var x = X(); return x ? x.rungs : []; }
  var EXTRA = {}; /* session-only rungs registered by other layers (sectors, pools) */
  function register(r) { if (r && r.id) { EXTRA[r.id] = r; paint(); } return r; }
  function get(id) { if (!id) return null; for (var i = 0, L = list(); i < L.length; i++) if (L[i].id === id) return L[i]; for (var j = 0; j < CURATED.length; j++) if (CURATED[j].id === id) return CURATED[j]; return EXTRA[id] || null; }
  function active() { var x = X(); return x ? x.rung || null : null; }
  function activeSet() {
    var r = get(active()); if (!r) return new Set();
    if (r.fn) return new Set(r.fn(all()).map(function (c) { return c.sym; }));
    return new Set(r.syms || []);
  }
  function apply(id) {
    var x = X(); if (!x) return;
    x.rung = id || null;
    try {
      var MX = window.MXP && MXP.state;
      if (MX) { MX.filter = id ? "rung" : "all"; MX.page = 1; MXP.render(); }
    } catch (e) {}
    C.save(); paint();
    var r = get(id);
    if (r) C.toast("good", "Rung · " + r.name, r.note || (r.syms ? r.syms.length + " coins" : ""));
  }
  function create(name, syms, note) {
    var x = X(); if (!x) return null;
    var r = { id: uid(), name: String(name || "Untitled").slice(0, 32), syms: (syms || []).map(function (s) { return String(s).toUpperCase(); }).filter(function (s, i, a) { return a.indexOf(s) === i; }).slice(0, 120), note: String(note || "").slice(0, 120), t: Date.now() };
    x.rungs.push(r); if (x.rungs.length > 24) x.rungs.shift();
    C.save(); C.xp("rung.first", 10, "First Rung built — a lens is worth a hundred columns");
    return r;
  }
  function remove(id) { var x = X(); if (!x) return; x.rungs = x.rungs.filter(function (r) { return r.id !== id; }); if (x.rung === id) apply(null); else { C.save(); paint(); } }
  function toggleSym(id, sym) { var r = get(id); if (!r || r.fn) return; sym = String(sym).toUpperCase(); var i = r.syms.indexOf(sym); if (i > -1) r.syms.splice(i, 1); else r.syms.push(sym); C.save(); if (active() === id) apply(id); else paint(); }
  function rename(id, name) { var r = get(id); if (r && !r.fn) { r.name = String(name || r.name).slice(0, 32); C.save(); paint(); } }

  /* ---------------------------------------------------------- signed share */
  function keyPair() {
    var kh = null; try { kh = localStorage.getItem("coinbridge.sovkey"); } catch (e) {}
    if (!kh || !/^[0-9a-f]{64}$/i.test(kh)) { kh = spRandScalar().toString(16).padStart(64, "0"); try { localStorage.setItem("coinbridge.sovkey", kh); } catch (e) {} }
    var d = BigInt("0x" + kh); return { d: d, Q: spMul(d, [SECP.Gx, SECP.Gy]) };
  }
  function b64u(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function unb64u(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return decodeURIComponent(escape(atob(s))); }
  function canon(p) { return [p.v, p.name, (p.syms || []).join(","), p.note || "", p.t].join("|"); }
  async function shareLink(id) {
    var r = get(id); if (!r) throw new Error("no rung");
    var p = { v: 1, name: r.name, syms: r.fn ? r.fn(all()).map(function (c) { return c.sym; }).slice(0, 120) : r.syms, note: r.note || "", t: Date.now() };
    var h = await sha256(canon(p));
    var kp = keyPair(), sig = spSign(BigInt("0x" + h), kp.d);
    var pack = { p: p, s: [sig[0].toString(16), sig[1].toString(16)], q: [kp.Q[0].toString(16), kp.Q[1].toString(16)] };
    var base = (location.origin && /^https?:/.test(location.origin) ? location.origin + location.pathname : "https://dexladder.com/");
    return base + "#/rung/" + b64u(JSON.stringify(pack));
  }
  async function verifyPack(pack) {
    if (!pack || !pack.p || !pack.s || !pack.q) return { ok: false, why: "malformed" };
    var h = await sha256(canon(pack.p));
    var ok = false; try { ok = spVerify(BigInt("0x" + h), [BigInt("0x" + pack.q[0]), BigInt("0x" + pack.q[1])], [BigInt("0x" + pack.s[0]), BigInt("0x" + pack.s[1])]); } catch (e) {}
    return { ok: ok, hash: h, signer: (pack.q[0] || "").slice(0, 8) + "…" + (pack.q[0] || "").slice(-4) };
  }
  function importFromHash() {
    var m = (location.hash || "").match(/^#\/rung\/([A-Za-z0-9_-]+)/); if (!m) return;
    var pack = null; try { pack = JSON.parse(unb64u(m[1])); } catch (e) {}
    try { history.replaceState(null, "", "#/markets"); } catch (e) {}
    if (!pack) return;
    verifyPack(pack).then(function (v) {
      var p = pack.p, syms = (p.syms || []).slice(0, 120);
      var html = '<button class="mx" onclick="closeModal()">✕</button><h2>📎 A shared Rung</h2><p class="sub">' + (v.ok ? "Signature verified · signed by key " + esc(v.signer) : "⚠ Signature did NOT verify — treat as untrusted") + "</p>" +
        '<div class="dl154"><div class="h">' + esc(p.name) + '<span class="sp"></span><span class="dl-prov ' + (v.ok ? "live" : "stale") + '">secp256k1 · ' + (v.ok ? "valid" : "invalid") + "</span></div><div>" + esc(syms.join(" · ")) + "</div>" + (p.note ? '<div class="n">' + esc(p.note) + "</div>" : "") + "</div>" +
        '<div style="display:flex;gap:8px;margin-top:12px"><button class="btn sm" id="dlRungImp">Add to my Rungs</button><button class="btn sm" onclick="closeModal()">Ignore</button></div>';
      modal(html);
      var b = $("dlRungImp"); if (b) b.onclick = function () { var r = create(p.name, syms, p.note ? p.note + " · shared" : "shared rung"); closeModal(); if (r) apply(r.id); };
    });
  }

  /* ---------------------------------------------------------- UI */
  function paint() {
    var host = $("dlRungRail"); if (!host) return;
    var a = active(), L = list();
    var chips = '<button class="dl-chip' + (a ? "" : " on") + '" data-rung="">All 500</button>' +
      '<button class="dl-chip" data-rung="watch">★ Home</button>' +
      CURATED.map(function (r) { return '<button class="dl-chip' + (a === r.id ? " on" : "") + '" data-rung="' + r.id + '" title="' + esc(r.note) + '">' + r.ic + " " + esc(r.name) + "</button>"; }).join("") +
      L.map(function (r) { return '<button class="dl-chip' + (a === r.id ? " on" : "") + '" data-rung="' + esc(r.id) + '" title="' + esc(r.note || "") + '">🪜 ' + esc(r.name) + ' <span style="opacity:.6">' + r.syms.length + "</span></button>"; }).join("") +
      Object.keys(EXTRA).map(function (k) { var r = EXTRA[k]; return '<button class="dl-chip' + (a === r.id ? " on" : "") + '" data-rung="' + esc(r.id) + '" title="' + esc(r.note || "") + '">' + (r.ic || "◈") + " " + esc(r.name) + "</button>"; }).join("") +
      '<button class="dl-chip" data-rung="+">＋ New rung</button>';
    host.querySelector(".dl-chips").innerHTML = chips;
    var act = get(a), tools = host.querySelector(".rg-tools");
    if (act && !act.fn && !EXTRA[act.id]) tools.innerHTML = '<button class="dl-b" data-act="edit">✎ Edit</button><button class="dl-b" data-act="share">📎 Signed link</button><button class="dl-b warn" data-act="del">Delete</button>';
    else if (act) tools.innerHTML = '<span class="dl-formula" style="margin:0;padding:6px 10px">' + esc(act.note) + '</span><button class="dl-b" data-act="share">📎 Signed link</button><button class="dl-b" data-act="save">💾 Save as my rung</button>';
    else tools.innerHTML = "";
  }
  function editor(r) {
    var syms = r ? r.syms.slice() : [];
    var html = '<button class="mx" onclick="closeModal()">✕</button><h2>🪜 ' + (r ? "Edit rung" : "New rung") + '</h2><p class="sub">A lens over the ladder: name it, pick coins. Comma-separated symbols, or ☆ any coin later.</p>' +
      '<input class="dl-inp" id="dlRgName" placeholder="Name (e.g. AI infra, Weekend movers)" value="' + esc(r ? r.name : "") + '" maxlength="32" style="margin-bottom:8px">' +
      '<input class="dl-inp" id="dlRgSyms" placeholder="BTC, ETH, SOL…" value="' + esc(syms.join(", ")) + '" style="margin-bottom:8px">' +
      '<input class="dl-inp" id="dlRgNote" placeholder="Note (optional)" value="' + esc(r ? r.note || "" : "") + '" maxlength="120">' +
      '<div style="display:flex;gap:8px;margin-top:12px"><button class="btn sm" id="dlRgSave">' + (r ? "Save" : "Create") + '</button><button class="btn sm" onclick="closeModal()">Cancel</button></div>';
    modal(html);
    $("dlRgSave").onclick = function () {
      var name = $("dlRgName").value.trim(), ss = $("dlRgSyms").value.split(/[,\s]+/).filter(Boolean).map(function (s) { return s.toUpperCase(); }), note = $("dlRgNote").value.trim();
      if (!name) { $("dlRgName").focus(); return; }
      var known = new Set(all().map(function (c) { return c.sym; })), unknown = ss.filter(function (s) { return !known.has(s); });
      if (r) { r.name = name.slice(0, 32); r.syms = ss.filter(function (s, i, a) { return a.indexOf(s) === i; }); r.note = note.slice(0, 120); C.save(); closeModal(); apply(r.id); }
      else { var nr = create(name, ss, note); closeModal(); if (nr) apply(nr.id); }
      if (unknown.length) C.toast("warn", "Some symbols aren't on the ladder", unknown.slice(0, 6).join(", ") + " — kept, but they won't show until they load");
    };
  }
  function mount() {
    var ctl = $("mxCtlHost"); if (!ctl || $("dlRungRail")) { paint(); return; }
    var box = document.createElement("div"); box.id = "dlRungRail"; box.className = "dl154";
    box.innerHTML = '<div class="h">🪜 Rungs <span style="font:500 11px var(--ui-sans,sans-serif);color:var(--muted)">· lenses over the ladder, yours and curated</span><span class="sp"></span><span class="rg-tools" style="display:flex;gap:6px;flex-wrap:wrap"></span></div><div class="dl-chips" style="margin:0"></div>';
    ctl.parentNode.insertBefore(box, ctl);
    box.addEventListener("click", function (e) {
      var b = e.target.closest("[data-rung]");
      if (b) {
        var id = b.getAttribute("data-rung");
        if (id === "+") return editor(null);
        if (id === "watch") { try { var MX = MXP.state; MX.filter = "watch"; MX.page = 1; MXP.render(); X().rung = null; C.save(); paint(); } catch (er) {} return; }
        return apply(id || null);
      }
      var t = e.target.closest("[data-act]");
      if (t) {
        var act = t.getAttribute("data-act"), r = get(active());
        if (act === "edit" && r) editor(r);
        else if (act === "del" && r) { if (confirm("Delete rung “" + r.name + "”?")) remove(r.id); }
        else if (act === "save" && r && r.fn) { var nr = create(r.name + " · snapshot", r.fn(all()).map(function (c) { return c.sym; }), "Snapshot of the curated rung on " + new Date().toLocaleDateString()); if (nr) apply(nr.id); }
        else if (act === "share" && r) shareLink(r.id).then(function (u) {
          modal('<button class="mx" onclick="closeModal()">✕</button><h2>📎 Signed link</h2><p class="sub">Anyone who opens this sees the coins and a verified signature from your sovereign key — no account, no follower count, no server.</p><textarea class="dl-inp" style="height:110px;font:500 11px var(--mono,monospace)" readonly>' + esc(u) + '</textarea><div style="display:flex;gap:8px;margin-top:10px"><button class="btn sm" id="dlRgCopy">Copy</button><button class="btn sm" onclick="closeModal()">Done</button></div>');
          $("dlRgCopy").onclick = function () { try { navigator.clipboard.writeText(u); C.toast("good", "Copied", "Signed rung link is on your clipboard"); } catch (e) {} };
          C.xp("rung.share", 10, "Shared a signed Rung — authorship without an account");
        }).catch(function (e) { C.toast("bad", "Couldn’t sign", String(e.message || e)); });
      }
    });
    paint();
  }
  /* star on a coin page → "add to rung" affordance via command palette */
  C.cmd("rung", "Rungs — build or open a lens over the ladder", "🪜", function () { nav("markets"); setTimeout(function () { var el = $("dlRungRail"); el && el.scrollIntoView({ block: "center" }); }, 400); });
  C.cmd("clean ladder", "Clean Ladder — hide wrapped & liquid-staked duplicates", "🧹", function () { nav("markets"); setTimeout(function () { apply("cur.clean"); }, 400); });
  C.onPage("markets", mount);
  setTimeout(importFromHash, 900);
  return { __v: 154, list: list, get: get, active: active, activeSet: activeSet, apply: apply, create: create, remove: remove, toggleSym: toggleSym, rename: rename, share: shareLink, verify: verifyPack, curated: CURATED, wrapped: WRAPPED, paint: paint, register: register };
})();
