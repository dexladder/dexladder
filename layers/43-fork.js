/* ============================================================================
   DLFORK · v157 — LOCAL NETWORK FORKING: the advanced sandbox.
   ---------------------------------------------------------------------------
   Everything a learner sees in this app is someone else's market. This layer
   lets an advanced user point the terminal at a chain they own — `anvil
   --fork-url …`, or a Hardhat node — and trade their OWN contracts inside the
   same ticket, with the same order types, the same price-impact model and the
   same ledger.

   WHAT THIS LAYER IS RESPONSIBLE FOR: exactly one thing the typed core is not
   allowed to do — the HTTP. `web/app/src/lib/fork` builds every JSON-RPC
   request and decodes every answer, `hooks/useForkNode` sequences them, and
   `legacy/fork-view` draws the panel; none of them may contain a network call,
   because "all data stays on device" is a law the architecture gate enforces
   against the whole typed core. So the transport lives here, is installed once
   (DLAPP.fork.install), and talks to ONE host: the URL the user typed.

   THREE FACTS THAT SHAPE IT
   1 · A browser cannot be told WHY a cross-origin request failed. Refused
       connection, a missing CORS header, mixed content and Chrome's private-
       network preflight all arrive as the same empty TypeError. So this layer
       reports what it saw and lib/fork/doctor.ts ranks the candidates with the
       command that fixes each. It never guesses out loud.
   2 · No key ever enters DexLadder. Writes go out as eth_sendTransaction from
       an account the node has already unlocked — which is also why a real
       public RPC degrades to read-only by itself: it has no unlocked accounts,
       and the write policy additionally refuses any chain that never
       identified itself as a fork or a dev node.
   3 · Every write is dry-run with eth_call first, so a revert costs nothing and
       arrives as the contract's own message.

   Layer contract: self-mounting, idempotent, no persistent timer, no rebinding
   of any top-level binding, no inline style, no innerHTML, and it edits no
   other layer.
   ============================================================================ */
window.DLFORK = (function () {
  "use strict";
  if (window.DLFORK && window.DLFORK.__v) return window.DLFORK;
  var doc = document;
  var TIMEOUT_MS = 8000;

  function $(q, r) { return (r || doc).querySelector(q); }

  /* ------------------------------------------------------------ the transport
     One POST per JSON-RPC call or batch. No cache (a block number must never be
     served from one), no credentials (a node is not an account), an explicit
     timeout (a dead host would otherwise hang the panel), and the response text
     is handed back verbatim for the typed parser to read. */
  function post(url, body) {
    return new Promise(function (resolve, reject) {
      var ctl = typeof AbortController === "function" ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (ctl) ctl.abort();
        reject(new Error("no answer within " + (TIMEOUT_MS / 1000) + "s from " + url));
      }, TIMEOUT_MS);
      var init = {
        method: "POST", headers: { "content-type": "application/json" }, body: body,
        mode: "cors", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer"
      };
      if (ctl) init.signal = ctl.signal;
      var send = window.fetch;
      if (typeof send !== "function") { clearTimeout(timer); reject(new Error("this browser has no fetch")); return; }
      send(url, init).then(function (res) {
        if (!res.ok) throw new Error("the node answered HTTP " + res.status + " " + (res.statusText || ""));
        return res.text();
      }).then(function (text) { clearTimeout(timer); resolve(text); })
        .catch(function (e) {
          clearTimeout(timer);
          var msg = (e && e.message) || String(e);
          // a bare "Failed to fetch" is the browser refusing to say which wall was hit
          reject(new Error(/failed to fetch|load failed|networkerror/i.test(msg)
            ? "the browser blocked or could not open the connection (it does not say which)"
            : msg));
        });
    });
  }

  /* ------------------------------------------------------------------- mount */
  function card() {
    var el = doc.createElement("div");
    el.className = "card dlx-fk-card";
    el.id = "dlFork";
    var head = doc.createElement("div");
    head.className = "ph";
    var title = doc.createElement("b");
    title.textContent = "🧪 Local fork sandbox";
    var tag = doc.createElement("span");
    tag.className = "tag";
    tag.textContent = "YOUR NODE";
    head.appendChild(title);
    head.appendChild(tag);
    var body = doc.createElement("div");
    body.id = "dlForkBody";
    el.appendChild(head);
    el.appendChild(body);
    return { el: el, body: body };
  }

  function mount() {
    try {
      if (!window.DLAPP || !DLAPP.fork) return false;
      var side = $("#page-coin .side");
      if (!side || $("#dlFork")) return false;
      var c = card();
      side.appendChild(c.el);
      DLAPP.fork.install(post);
      DLAPP.fork.mount(c.body);
      return true;
    } catch (e) { return false; }
  }

  /* The terminal's side column is static markup, so one mount is enough; the
     delay keeps it behind the first paint and the legacy mounts (3.4s). */
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", function () { setTimeout(mount, 3600); });
  else setTimeout(mount, 3600);

  return { __v: 157, mount: mount, post: post, TIMEOUT_MS: TIMEOUT_MS };
})();
