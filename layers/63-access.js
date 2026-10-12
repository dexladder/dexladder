// owns: accessibility audit and display preferences
// reads: DLCORE, DLDESKS, browser DOM
// emits: DLACCESS
/* ============================================================================
   DexLadder — DLACCESS · layer 63 · v166 "◔ Access"
   A LIVE WCAG 2.2 AA AUDIT OF THE RENDERED DOM, DISPLAY CONTROLS, AND i18n

   The question this desk exists to answer: is what is ON THE SCREEN RIGHT NOW
   reachable — and if not, which element, which success criterion, and what is
   the measured number?

   Until this layer the app had no formal accessibility surface and no language
   but English. The build already enforced a 4.5:1 token floor (test/gate-
   contrast.js) and 20-core.js already trapped focus in a sheet and handed it
   back on close. That is a design-time floor. This desk is the run-time one:
   it walks the painted DOM, resolves the colours a browser actually computed,
   and names the criterion for every finding.

   It also refuses the usual lie. An automated pass reaches roughly a third of
   WCAG failures (Vigo/Brown/Conway 2013 measured coverage of 50%; the widely
   cited industry figure for a full-page automated scan is 20-30%). So this
   panel never says a page "is accessible". It says what it measured, on what,
   and what it cannot see.

   LAWS OBSERVED
     · measurement, not assertion — every ratio, every rectangle, every name
       is read off the live computed style or the live bounding box. Nothing
       here is a constant standing in for a measurement
     · a missing figure stays missing — a colour sitting on a gradient is
       reported UNRESOLVED, never given a made-up ratio
     · this layer never trades. It never touches a balance, an order or a fill.
       There is no money path in this file at all
     · no network primitive of any kind — no request is made, no byte is
       fetched. Everything read comes from the document already in memory
     · deterministic — no random source anywhere in the file; the shortcut map is SCANNED out
       of the payload's own script text rather than typed out by hand
     · state is the v154 bucket via DLCORE.X(), namespaced under the access key
     · tears down — timers, the highlight class and the delegated listener all
       come off in __onClose
     · Day and Night both; every rule lives in _v166css/63-access.css and uses
       the existing tokens. The high-contrast mode REPOINTS elements at tokens
       that already exist rather than redefining a single token
   ============================================================================ */
(function () {
  "use strict";
  if (window.DLACCESS && window.DLACCESS.__v) return;

  var C = window.DLCORE;
  if (!C) return;

  var D = document;
  var W = window;
  var SHEET_ID = "dlAccess";
  var EPS = 1e-9;

  /* ======================================================== colour, measured */
  /* WCAG 2.x relative luminance and contrast ratio, verbatim from the
     definitions in the specification. Nothing is rounded before a comparison —
     that is the exact fail-open the payload's own contrast gate was written to
     kill, and repeating it here would undo that work. */

  function chan(c) {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function luminance(col) {
    if (!col || col.a == null || col.a < 0.999) return null;   /* composite first */
    return 0.2126 * chan(col.r) + 0.7152 * chan(col.g) + 0.0722 * chan(col.b);
  }

  function contrastRatio(fg, bg) {
    var a = luminance(fg), b = luminance(bg);
    if (a == null || b == null) return null;
    var hi = a > b ? a : b, lo = a > b ? b : a;
    return (hi + 0.05) / (lo + 0.05);
  }

  function composite(fg, bg) {
    if (!fg || !bg) return null;
    if (bg.a < 0.999) return null;
    if (fg.a >= 0.999) return { r: fg.r, g: fg.g, b: fg.b, a: 1 };
    var m = function (f, b) { return f * fg.a + b * (1 - fg.a); };
    return { r: m(fg.r, bg.r), g: m(fg.g, bg.g), b: m(fg.b, bg.b), a: 1 };
  }

  var NAMED = { white: [255, 255, 255], black: [0, 0, 0], transparent: [0, 0, 0] };

  /* Parses exactly the shapes a browser hands back from getComputedStyle plus
     the hex an author writes. Anything else returns null — an unparsed colour
     must not silently become the inherited one. */
  function parseColor(raw) {
    if (raw == null) return null;
    var v = String(raw).trim().toLowerCase();
    if (!v) return null;
    if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
    if (Object.prototype.hasOwnProperty.call(NAMED, v)) {
      var n = NAMED[v];
      return { r: n[0], g: n[1], b: n[2], a: 1 };
    }
    var m = v.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
      var h = m[1], i, e;
      if (h.length === 3 || h.length === 4) { e = ""; for (i = 0; i < h.length; i++) e += h.charAt(i) + h.charAt(i); h = e; }
      if (h.length !== 6 && h.length !== 8) return null;
      return {
        r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
      };
    }
    m = v.match(/^rgba?\(([^)]*)\)$/);
    if (m) {
      var p = m[1].replace(/\//g, " ").split(/[\s,]+/), out = [], j;
      for (j = 0; j < p.length; j++) if (p[j] !== "") out.push(p[j]);
      if (out.length < 3) return null;
      var num = function (s, max) {
        var t = String(s);
        if (t.charAt(t.length - 1) === "%") return parseFloat(t) / 100 * max;
        return parseFloat(t);
      };
      var a = out.length > 3 ? num(out[3], 1) : 1;
      if (!isFinite(a)) a = 1;
      return { r: num(out[0], 255), g: num(out[1], 255), b: num(out[2], 255), a: a };
    }
    /* color(srgb r g b / a) — what Chromium resolves color-mix() to. 0..1 channels. */
    m = v.match(/^color\(\s*srgb\s+([^)]*)\)$/);
    if (m) {
      var q = m[1].replace(/\//g, " ").split(/\s+/), k = [], z;
      for (z = 0; z < q.length; z++) if (q[z] !== "") k.push(parseFloat(q[z]));
      if (k.length < 3) return null;
      return { r: k[0] * 255, g: k[1] * 255, b: k[2] * 255, a: k.length > 3 && isFinite(k[3]) ? k[3] : 1 };
    }
    return null;
  }

  /* The best-effort resolution the brief asks for: a token background is very
     often a wash — rgba(255,255,255,.035) over a card over a page. Walk up,
     collect every translucent layer, stop at the first OPAQUE one, then
     composite back down. If a gradient or an image is in the stack, stop and
     say the ratio is unresolved. A guess here is worse than a gap. */
  function resolveBg(el) {
    var stack = [], node = el, guard = 0, cs, c;
    while (node && node.nodeType === 1 && guard++ < 64) {
      cs = styleOf(node);
      if (!cs) break;
      if (cs.backgroundImage && cs.backgroundImage !== "none") {
        return { color: null, unresolved: true, why: "a gradient or image is painted behind this text, so the backdrop is not a single colour and the ratio cannot be resolved from computed values" };
      }
      c = parseColor(cs.backgroundColor);
      if (c && c.a > 0.001) {
        if (c.a >= 0.999) {
          var out = c, i;
          for (i = stack.length - 1; i >= 0; i--) out = composite(stack[i], out) || out;
          return { color: out, unresolved: false, why: null };
        }
        stack.push(c);
      }
      node = node.parentElement;
    }
    return { color: null, unresolved: true, why: "no opaque background was found anywhere up the tree from this element" };
  }

  function styleOf(el) { try { return W.getComputedStyle(el); } catch (e) { return null; } }

  /* ================================================================ selectors */

  function selFor(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) return "#" + el.id;
    var parts = [], node = el, guard = 0;
    while (node && node.nodeType === 1 && guard++ < 6) {
      if (node.id) { parts.unshift("#" + node.id); break; }
      var s = String(node.tagName || "").toLowerCase(), cls = "";
      try {
        if (node.className && typeof node.className === "string") {
          var bits = node.className.trim().split(/\s+/);
          if (bits[0]) cls = bits[0];
        }
      } catch (e) { cls = ""; }
      if (cls) s += "." + cls.replace(/[^\w-]/g, "");
      var p = node.parentElement;
      if (p) {
        var same = [], k;
        for (k = 0; k < p.children.length; k++) if (p.children[k].tagName === node.tagName) same.push(p.children[k]);
        if (same.length > 1) s += ":nth-of-type(" + (indexOf(same, node) + 1) + ")";
      }
      parts.unshift(s);
      node = p;
    }
    return parts.join(" > ");
  }

  function indexOf(list, x) { var i; for (i = 0; i < list.length; i++) if (list[i] === x) return i; return -1; }

  /* ============================================================ DOM predicates */

  function inDesk(el) {
    var n = el, guard = 0;
    while (n && guard++ < 200) { if (n.id === SHEET_ID) return true; n = n.parentElement; }
    return false;
  }

  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    var cs = styleOf(el);
    if (!cs) return false;
    if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return false;
    if (parseFloat(cs.opacity) === 0) return false;
    var r = rectOf(el);
    if (!r || r.width < 0.5 || r.height < 0.5) return false;
    var n = el, guard = 0;
    while (n && n.nodeType === 1 && guard++ < 200) {
      if (n.getAttribute && n.getAttribute("aria-hidden") === "true") return false;
      if (n.hasAttribute && n.hasAttribute("inert")) return false;
      n = n.parentElement;
    }
    return true;
  }

  function rectOf(el) { try { return el.getBoundingClientRect(); } catch (e) { return null; } }

  var FOCUS_SEL = 'a[href],button,input,select,textarea,summary,[tabindex],[contenteditable="true"],[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="switch"],[role="menuitem"],[role="option"]';

  function focusables(root) {
    var out = [], all, i, el;
    try { all = root.querySelectorAll(FOCUS_SEL); } catch (e) { return out; }
    for (i = 0; i < all.length; i++) {
      el = all[i];
      if (inDesk(el)) continue;
      if (el.disabled) continue;
      if (el.getAttribute("tabindex") === "-1") continue;
      if (!visible(el)) continue;
      out.push(el);
      if (out.length >= 400) break;
    }
    return out;
  }

  /* Pointer targets for 2.5.8: everything a finger can land on. */
  function targets(root) {
    var out = [], all, i, el;
    try { all = root.querySelectorAll('a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="switch"],[onclick]'); } catch (e) { return out; }
    for (i = 0; i < all.length; i++) {
      el = all[i];
      if (inDesk(el)) continue;
      if (el.disabled) continue;
      if (!visible(el)) continue;
      if (el.tagName === "INPUT" && (el.type === "hidden")) continue;
      out.push(el);
      if (out.length >= 400) break;
    }
    return out;
  }

  /* Accessible name, computed the way the accname spec orders it, as far as a
     script without the accessibility tree can go: labelledby, label, native
     label, alt, value, title, own text. This is a NAME PRESENT check, not a
     name-quality check — see ASSUMPTIONS. */
  function accName(el) {
    if (!el) return "";
    var txt = "";
    var lb = el.getAttribute && el.getAttribute("aria-labelledby");
    if (lb) {
      var ids = lb.split(/\s+/), i, t;
      for (i = 0; i < ids.length; i++) {
        t = null;
        try { t = D.getElementById(ids[i]); } catch (e) { t = null; }
        if (t) txt += " " + (t.textContent || "");
      }
      if (txt.trim()) return txt.trim();
    }
    var al = el.getAttribute && el.getAttribute("aria-label");
    if (al && al.trim()) return al.trim();
    if (el.id) {
      var lab = null;
      try { lab = D.querySelector('label[for="' + cssEscape(el.id) + '"]'); } catch (e) { lab = null; }
      if (lab && (lab.textContent || "").trim()) return lab.textContent.trim();
    }
    var wrap = el.closest ? el.closest("label") : null;
    if (wrap && (wrap.textContent || "").trim()) return wrap.textContent.trim();
    if (el.tagName === "IMG" || el.tagName === "AREA") {
      var alt = el.getAttribute("alt");
      if (alt != null) return alt.trim();
    }
    if (el.tagName === "INPUT" && (el.type === "button" || el.type === "submit" || el.type === "reset") && el.value) return String(el.value).trim();
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      var ph = el.getAttribute("placeholder");
      if (ph && ph.trim()) return ph.trim();   /* counted, and flagged as weak */
    }
    var ti = el.getAttribute && el.getAttribute("title");
    if (ti && ti.trim()) return ti.trim();
    var own = (el.textContent || "").replace(/\s+/g, " ").trim();
    return own;
  }

  function cssEscape(s) { return String(s).replace(/["\\]/g, "\\$&"); }

  function textish(el) {
    /* an element that paints its own text, not just its children's */
    var i, n;
    if (!el.childNodes) return false;
    for (i = 0; i < el.childNodes.length; i++) {
      n = el.childNodes[i];
      if (n.nodeType === 3 && String(n.nodeValue || "").replace(/\s+/g, "") !== "") return true;
    }
    return false;
  }

  /* =========================================================== the criteria */
  /* Every id below is a real WCAG 2.2 success criterion number, with the level
     and the version that introduced it. 2.4.11 and 2.5.8 are NEW IN WCAG 2.2 —
     they did not exist in 2.1, which is why most older audits never mention
     them. 2.3.3 is a AAA criterion and is labelled as such rather than being
     quietly counted towards an AA score. (WCAG 2.2 also REMOVED 4.1.1 Parsing;
     this desk does not report it, and that is deliberate.) */

  var SC = [
    { id: "1.3.1", name: "Info and Relationships", level: "A", since: "2.0", what: window.DLI18N.t("63-access.9f5985538242") },
    { id: "1.4.3", name: "Contrast (Minimum)", level: "AA", since: "2.0", what: window.DLI18N.t("63-access.800913cd5940") },
    { id: "1.4.11", name: "Non-text Contrast", level: "AA", since: "2.1", what: window.DLI18N.t("63-access.6be4a20d3ee0") },
    { id: "1.4.12", name: "Text Spacing", level: "AA", since: "2.1", what: window.DLI18N.t("63-access.182458f4a583") },
    { id: "2.3.3", name: "Animation from Interactions", level: "AAA", since: "2.1", what: window.DLI18N.t("63-access.34d95e4b7752") },
    { id: "2.4.7", name: "Focus Visible", level: "AA", since: "2.0", what: window.DLI18N.t("63-access.9fadcb8cf0a9") },
    { id: "2.4.11", name: "Focus Not Obscured (Minimum)", level: "AA", since: "2.2", what: window.DLI18N.t("63-access.8fc6b772f364") },
    { id: "2.5.8", name: "Target Size (Minimum)", level: "AA", since: "2.2", what: window.DLI18N.t("63-access.c9b15f6bced1") },
    { id: "4.1.2", name: "Name, Role, Value", level: "A", since: "2.0", what: window.DLI18N.t("63-access.cb19498d221d") }
  ];

  function scMeta(id) { var i; for (i = 0; i < SC.length; i++) if (SC[i].id === id) return SC[i]; return null; }

  function finding(el, why, detail) {
    return { sel: selFor(el), tag: el && el.tagName ? String(el.tagName).toLowerCase() : "?", why: why, detail: detail == null ? null : detail };
  }

  function result(id, status, checked, fails, note, extra) {
    var m = scMeta(id) || {};
    return {
      id: id, name: m.name || id, level: m.level || "?", since: m.since || "?",
      what: m.what || "", isNew22: m.since === "2.2",
      status: status, checked: checked, failures: fails || [], count: (fails || []).length,
      note: note || null, extra: extra || null
    };
  }

  /* ------------------------------------------------------- 1.4.3 contrast */

  function scContrast(root) {
    var all, i, el, cs, fg, bg, ratio, need, px, wt, large, fails = [], checked = 0, unresolved = 0;
    try { all = root.querySelectorAll("*"); } catch (e) { all = []; }
    for (i = 0; i < all.length && i < 4000; i++) {
      el = all[i];
      if (inDesk(el) || !textish(el) || !visible(el)) continue;
      cs = styleOf(el);
      if (!cs) continue;
      fg = parseColor(cs.color);
      if (!fg) continue;
      px = parseFloat(cs.fontSize) || 16;
      wt = parseInt(cs.fontWeight, 10) || 400;
      large = px >= 24 || (px >= 18.66 && wt >= 700);
      need = large ? 3 : 4.5;
      bg = resolveBg(el);
      if (bg.unresolved || !bg.color) { unresolved++; continue; }
      if (fg.a < 0.999) fg = composite(fg, bg.color) || fg;
      ratio = contrastRatio(fg, bg.color);
      if (ratio == null) { unresolved++; continue; }
      checked++;
      if (ratio + 1e-9 < need) {
        fails.push(finding(el,
          "text measures " + ratio.toFixed(2) + ":1 against its resolved backdrop and " + (large ? "large text" : "normal text") + " at " + px.toFixed(1) + "px needs " + need.toFixed(1) + ":1",
          { ratio: ratio, need: need, fg: hex(fg), bg: hex(bg.color), px: px, weight: wt }));
      }
    }
    return result("1.4.3", fails.length ? "fail" : (checked ? "pass" : "not-applicable"), checked, fails,
      unresolved ? (unresolved + " text elements could not be resolved to a single backdrop colour — a gradient or image sits behind them. They are counted as UNMEASURED, not as passes.") : null,
      { unresolved: unresolved });
  }

  function hex(c) {
    if (!c) return null;
    var f = function (n) { var v = Math.round(Math.max(0, Math.min(255, n))).toString(16); return v.length < 2 ? "0" + v : v; };
    return "#" + f(c.r) + f(c.g) + f(c.b);
  }

  /* -------------------------------------------------- 1.4.11 non-text contrast */

  function scNonText(root) {
    var list = targets(root), i, el, cs, fails = [], checked = 0, unresolved = 0;
    for (i = 0; i < list.length; i++) {
      el = list[i];
      cs = styleOf(el);
      if (!cs) continue;
      var behind = el.parentElement ? resolveBg(el.parentElement) : { unresolved: true };
      if (behind.unresolved || !behind.color) { unresolved++; continue; }
      /* the visible boundary: a painted border if there is one, otherwise the
         control's own fill against what is behind it */
      var bw = parseFloat(cs.borderTopWidth) || 0;
      var edge = bw > 0 ? parseColor(cs.borderTopColor) : null;
      var kind = "border";
      if (!edge || edge.a < 0.02) { edge = parseColor(cs.backgroundColor); kind = "fill"; }
      if (!edge || edge.a < 0.02) {
        fails.push(finding(el, "this control paints no boundary at all — no border and no fill — so there is nothing for 3:1 to be measured against", { kind: "none" }));
        checked++;
        continue;
      }
      var solid = composite(edge, behind.color);
      var r = contrastRatio(solid, behind.color);
      if (r == null) { unresolved++; continue; }
      checked++;
      if (r + 1e-9 < 3) {
        fails.push(finding(el, "the control's " + kind + " measures " + r.toFixed(2) + ":1 against the surface behind it, and a user interface component boundary needs 3:1",
          { ratio: r, need: 3, kind: kind, edge: hex(solid), behind: hex(behind.color) }));
      }
    }
    return result("1.4.11", fails.length ? "fail" : (checked ? "pass" : "not-applicable"), checked, fails,
      unresolved ? (unresolved + " controls sit on a backdrop that is not a single colour and were not measured.") : null, { unresolved: unresolved });
  }

  /* --------------------------------------------------------- 2.4.7 focus visible */
  /* Measured by actually focusing each candidate and diffing the computed
     style against its resting state, then handing focus back where it was.
     There is no way to read a :focus rule without focus; a static scan of the
     stylesheet would be a guess about which selector wins the cascade. */

  function focusSig(cs) {
    if (!cs) return "";
    return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.outlineOffset, cs.boxShadow,
      cs.borderTopColor, cs.borderTopWidth, cs.backgroundColor, cs.color, cs.textDecorationLine, cs.filter].join("|");
  }

  function scFocusVisible(root) {
    var list = focusables(root), i, el, before, after, fails = [], checked = 0;
    var prev = null;
    try { prev = D.activeElement; } catch (e) { prev = null; }
    for (i = 0; i < list.length && i < 160; i++) {
      el = list[i];
      before = focusSig(styleOf(el));
      try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) { continue; } }
      if (D.activeElement !== el) continue;           /* the browser refused it — not a finding */
      after = focusSig(styleOf(el));
      checked++;
      var cs2 = styleOf(el);
      var painted = false;
      if (cs2) {
        var ow = parseFloat(cs2.outlineWidth) || 0;
        if (cs2.outlineStyle && cs2.outlineStyle !== "none" && ow > 0) painted = true;
      }
      if (!painted && after !== before) painted = true;
      if (!painted) fails.push(finding(el, "focusing this control changed nothing a sighted keyboard user can see — no outline, no shadow, no colour change", { sig: before.slice(0, 120) }));
    }
    try { if (prev && prev.focus) prev.focus({ preventScroll: true }); else if (D.activeElement && D.activeElement.blur) D.activeElement.blur(); } catch (e) {}
    return result("2.4.7", fails.length ? "fail" : (checked ? "pass" : "not-applicable"), checked, fails,
      list.length > 160 ? ("only the first 160 of " + list.length + " focusable elements were measured, to keep the pass under a second") : null);
  }

  /* ------------------------------------- 2.4.11 focus not obscured (minimum) */
  /* NEW IN WCAG 2.2. The minimum level fails only when the focused control is
     ENTIRELY hidden. Measured with elementFromPoint at five points of the
     control's box: if every one of them lands on something that is neither the
     control nor inside it nor an ancestor of it, the control is covered. An
     element scrolled out of the viewport cannot be probed this way and is
     reported as unmeasured rather than as a pass. */

  function related(hit, el) {
    if (!hit || !el) return false;
    if (hit === el) return true;
    var n = hit, guard = 0;
    while (n && guard++ < 200) { if (n === el) return true; n = n.parentElement; }
    n = el; guard = 0;
    while (n && guard++ < 200) { if (n === hit) return true; n = n.parentElement; }
    return false;
  }

  function scFocusObscured(root) {
    var list = focusables(root), i, el, r, fails = [], checked = 0, offscreen = 0;
    var vw = W.innerWidth || D.documentElement.clientWidth;
    var vh = W.innerHeight || D.documentElement.clientHeight;
    for (i = 0; i < list.length; i++) {
      el = list[i];
      r = rectOf(el);
      if (!r) continue;
      if (r.bottom < 1 || r.top > vh - 1 || r.right < 1 || r.left > vw - 1) { offscreen++; continue; }
      var pts = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + 2, r.top + 2],
        [r.right - 2, r.top + 2],
        [r.left + 2, r.bottom - 2],
        [r.right - 2, r.bottom - 2]
      ];
      var probed = 0, covered = 0, blocker = null, k, hit;
      for (k = 0; k < pts.length; k++) {
        var x = pts[k][0], y = pts[k][1];
        if (x < 0 || y < 0 || x > vw - 1 || y > vh - 1) continue;
        hit = null;
        try { hit = D.elementFromPoint(x, y); } catch (e) { hit = null; }
        if (!hit) continue;
        probed++;
        if (!related(hit, el)) { covered++; if (!blocker) blocker = hit; }
      }
      if (!probed) { offscreen++; continue; }
      checked++;
      if (covered === probed) {
        var bs = styleOf(blocker);
        fails.push(finding(el, "every point of this control lands on " + (blocker ? selFor(blocker) : "something else") + " instead, so a keyboard user who tabs here sees nothing move",
          { blocker: blocker ? selFor(blocker) : null, position: bs ? bs.position : null }));
      }
    }
    return result("2.4.11", fails.length ? "fail" : (checked ? "pass" : "not-applicable"), checked, fails,
      offscreen ? (offscreen + " focusable elements were outside the viewport when the pass ran and could not be probed. They are UNMEASURED — scroll and measure again to cover them.") : null,
      { offscreen: offscreen });
  }

  /* ----------------------------------------- 2.5.8 target size (minimum) 24x24 */
  /* NEW IN WCAG 2.2. 24 by 24 CSS pixels, with the spec's exceptions:
     spacing (a 24px circle centred on the target touches no other target's
     circle), inline (the target is in a sentence), and essential. The spacing
     exception is approximated by centre-to-centre distance, which is what the
     understanding document's own diagram reduces to for same-size targets. */

  function scTargetSize(root) {
    var list = targets(root), i, el, r, fails = [], checked = 0, exempt = 0;
    var boxes = [], j;
    for (i = 0; i < list.length; i++) { r = rectOf(list[i]); boxes.push(r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null); }
    for (i = 0; i < list.length; i++) {
      el = list[i]; r = rectOf(el);
      if (!r) continue;
      checked++;
      var w = r.width, h = r.height;
      if (w >= 24 - 1e-6 && h >= 24 - 1e-6) continue;
      /* inline exception: the target sits in a run of text */
      var cs = styleOf(el);
      var inline = cs && cs.display.indexOf("inline") === 0 && el.parentElement && textish(el.parentElement);
      if (inline) { exempt++; continue; }
      /* spacing exception: no other target's 24px circle overlaps this one */
      var clash = false, c1 = boxes[i];
      if (c1) {
        for (j = 0; j < boxes.length; j++) {
          if (j === i || !boxes[j]) continue;
          var dx = boxes[j].x - c1.x, dy = boxes[j].y - c1.y;
          if (Math.sqrt(dx * dx + dy * dy) < 24) { clash = true; break; }
        }
        if (!clash) { exempt++; continue; }
      }
      fails.push(finding(el, "this target renders " + w.toFixed(1) + " by " + h.toFixed(1) + " CSS pixels, under the 24 by 24 minimum, and it is neither inline in a sentence nor spaced far enough from its neighbours to earn the spacing exception",
        { w: w, h: h, need: 24 }));
    }
    return result("2.5.8", fails.length ? "fail" : (checked ? "pass" : "not-applicable"), checked, fails,
      exempt ? (exempt + " undersized targets earned one of the specification's exceptions — inline in a sentence, or far enough apart that a 24 pixel circle around each one touches nothing else.") : null,
      { exempt: exempt });
  }

  /* ----------------------------------------------- 1.3.1 info and relationships */

  var LANDMARKS = "main,nav,header,footer,aside,form,section,[role=main],[role=navigation],[role=banner],[role=contentinfo],[role=complementary],[role=search],[role=region]";

  function scInfoRel(root) {
    var fails = [], checked = 0, i, el;

    /* (a) every control carries an accessible name */
    var ctrls = focusables(root);
    for (i = 0; i < ctrls.length; i++) {
      el = ctrls[i];
      checked++;
      var nm = accName(el);
      if (!nm) fails.push(finding(el, "this control has no accessible name — no label, no aria-label, no text of its own, so it is announced as bare " + String(el.tagName).toLowerCase(), { name: null }));
    }

    /* (b) headings step one level at a time */
    var hs = [], all, lvl, prev = 0;
    try { all = root.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]'); } catch (e) { all = []; }
    for (i = 0; i < all.length; i++) {
      el = all[i];
      if (inDesk(el) || !visible(el)) continue;
      lvl = /^H[1-6]$/.test(el.tagName) ? parseInt(el.tagName.charAt(1), 10) : parseInt(el.getAttribute("aria-level") || "0", 10);
      if (!lvl) { fails.push(finding(el, 'role="heading" with no aria-level, so the heading has no place in the outline', null)); continue; }
      hs.push({ el: el, lvl: lvl });
    }
    for (i = 0; i < hs.length; i++) {
      checked++;
      if (prev && hs[i].lvl > prev + 1) {
        fails.push(finding(hs[i].el, "the outline jumps from h" + prev + " to h" + hs[i].lvl + ", so a reader moving by heading level falls through a gap", { from: prev, to: hs[i].lvl }));
      }
      prev = hs[i].lvl;
    }

    /* (c) landmarks exist, and there is exactly one main */
    var lm = [], mains = 0;
    try { lm = root.querySelectorAll(LANDMARKS); } catch (e) { lm = []; }
    var seen = 0;
    for (i = 0; i < lm.length; i++) {
      if (inDesk(lm[i])) continue;
      seen++;
      if (lm[i].tagName === "MAIN" || lm[i].getAttribute("role") === "main") mains++;
    }
    checked++;
    if (!seen) fails.push(finding(D.body, "this page declares no landmarks at all, so there is no way to skip to a region", { landmarks: 0 }));
    else if (!mains) fails.push(finding(D.body, "there are " + seen + " landmarks but no main, so the primary content has no name to jump to", { landmarks: seen, main: 0 }));
    else if (mains > 1) fails.push(finding(D.body, "there are " + mains + " main landmarks and there may only be one", { main: mains }));

    return result("1.3.1", fails.length ? "fail" : (checked ? "pass" : "not-applicable"), checked, fails, null,
      { headings: hs.length, landmarks: seen, mains: mains });
  }

  /* ------------------------------------------------------ 4.1.2 name role value */

  var ROLES = ("alert alertdialog application article banner blockquote button caption cell checkbox code columnheader combobox " +
    "complementary contentinfo definition deletion dialog directory document emphasis feed figure form generic grid gridcell group " +
    "heading img insertion link list listbox listitem log main mark marquee math menu menubar menuitem menuitemcheckbox menuitemradio " +
    "meter navigation none note option paragraph presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar " +
    "search searchbox separator slider spinbutton status strong subscript superscript switch tab table tablist tabpanel term textbox " +
    "time timer toolbar tooltip tree treegrid treeitem").split(" ");

  function knownRole(r) { return indexOf(ROLES, String(r || "").toLowerCase()) >= 0; }

  var IDREFS = ["aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "aria-details", "aria-errormessage", "aria-flowto"];

  function scNameRoleValue(root) {
    var fails = [], checked = 0, i, j, el, all;

    try { all = root.querySelectorAll('[role]'); } catch (e) { all = []; }
    for (i = 0; i < all.length; i++) {
      el = all[i];
      if (inDesk(el)) continue;
      checked++;
      var roles = String(el.getAttribute("role") || "").trim().split(/\s+/), bad = [];
      for (j = 0; j < roles.length; j++) if (roles[j] && !knownRole(roles[j])) bad.push(roles[j]);
      if (bad.length) fails.push(finding(el, 'role="' + bad.join(" ") + '" is not a role in the ARIA specification, so the element falls back to whatever its tag was and the author intent is lost', { bad: bad }));
    }

    try { all = root.querySelectorAll("[" + IDREFS.join("],[") + "]"); } catch (e) { all = []; }
    for (i = 0; i < all.length; i++) {
      el = all[i];
      if (inDesk(el)) continue;
      for (j = 0; j < IDREFS.length; j++) {
        var v = el.getAttribute(IDREFS[j]);
        if (!v) continue;
        checked++;
        var ids = v.split(/\s+/), missing = [], k, t;
        for (k = 0; k < ids.length; k++) {
          if (!ids[k]) continue;
          t = null;
          try { t = D.getElementById(ids[k]); } catch (e) { t = null; }
          if (!t) missing.push(ids[k]);
        }
        if (missing.length) fails.push(finding(el, IDREFS[j] + ' points at "' + missing.join(" ") + '", and no element with that id exists in the document — the reference resolves to nothing', { attr: IDREFS[j], missing: missing }));
      }
    }

    /* something you can click that the tree cannot see */
    try { all = root.querySelectorAll("[onclick]"); } catch (e) { all = []; }
    for (i = 0; i < all.length; i++) {
      el = all[i];
      if (inDesk(el) || !visible(el)) continue;
      var tag = String(el.tagName).toLowerCase();
      if (tag === "button" || tag === "a" || tag === "input" || tag === "select" || tag === "textarea" || tag === "summary") continue;
      if (el.getAttribute("role")) continue;
      checked++;
      fails.push(finding(el, "this element handles a click but carries no role and no tabindex, so it is a button to a mouse and nothing at all to a keyboard or a screen reader", { tag: tag }));
    }

    /* focusable, but hidden from the tree */
    var f = focusables(root);
    for (i = 0; i < f.length; i++) {
      var n = f[i], guard = 0, hidden = false;
      while (n && guard++ < 200) { if (n.getAttribute && n.getAttribute("aria-hidden") === "true") { hidden = true; break; } n = n.parentElement; }
      checked++;
      if (hidden) fails.push(finding(f[i], 'this control is reachable by Tab but sits under aria-hidden="true", so focus lands somewhere a screen reader says nothing about', null));
    }

    return result("4.1.2", fails.length ? "fail" : (checked ? "pass" : "not-applicable"), checked, fails, null);
  }

  /* ----------------------------------------------------------- 1.4.12 text spacing */
  /* The spec's own override, applied for real: line height 1.5x the font size,
     paragraph spacing 2x, letter spacing 0.12x, word spacing 0.16x. The rules
     live in _v166css/63-access.css under html.dla-space, which is the same
     class the Display tab's control sets — there is one implementation, not a
     probe copy that could drift from the control. Elements that were ALREADY
     clipped before the override are excluded, because that is a different bug. */

  function clipped(el) {
    var cs = styleOf(el);
    if (!cs) return false;
    var ox = cs.overflowX, oy = cs.overflowY;
    var hid = (ox === "hidden" || ox === "clip" || oy === "hidden" || oy === "clip");
    if (!hid) return false;
    return (el.scrollHeight > el.clientHeight + 1) || (el.scrollWidth > el.clientWidth + 1);
  }

  function scTextSpacing(root) {
    var all, i, el, cands = [], base = [], fails = [], checked = 0;
    try { all = root.querySelectorAll("*"); } catch (e) { all = []; }
    for (i = 0; i < all.length && i < 4000; i++) {
      el = all[i];
      if (inDesk(el) || !textish(el) || !visible(el)) continue;
      cands.push(el);
      base.push(clipped(el));
      if (cands.length >= 900) break;
    }
    var had = D.documentElement.classList.contains("dla-space");
    try {
      if (!had) D.documentElement.classList.add("dla-space");
      /* force a layout read so the measurements below are post-override */
      var _ = D.body.offsetHeight;
      for (i = 0; i < cands.length; i++) {
        checked++;
        if (base[i]) continue;                       /* already clipped without us */
        if (clipped(cands[i])) {
          var r = rectOf(cands[i]);
          fails.push(finding(cands[i], "applying the 1.4.12 text spacing override clips this element — its content is " + (cands[i].scrollHeight - cands[i].clientHeight) + " pixels taller than the box it is allowed to paint in",
            { over: cands[i].scrollHeight - cands[i].clientHeight, w: r ? Math.round(r.width) : null }));
        }
      }
    } catch (e) {
      /* fall through — the class is removed in the finally below */
    }
    if (!had) { try { D.documentElement.classList.remove("dla-space"); } catch (e2) {} }
    return result("1.4.12", fails.length ? "fail" : (checked ? "pass" : "not-applicable"), checked, fails,
      "Measured by applying the specification's own override (line height 1.5, paragraph spacing 2em, letter spacing 0.12em, word spacing 0.16em) and looking for content that no longer fits its own box. Elements already clipped before the override are excluded.");
  }

  /* -------------------------------------------- 2.3.3 animation from interactions */

  function motionReduced() {
    var os = false;
    try { os = !!(W.matchMedia && W.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { os = false; }
    var ours = false;
    try { ours = D.documentElement.classList.contains("dla-motion"); } catch (e) { ours = false; }
    return { os: os, ours: ours, on: os || ours };
  }

  function scAnimation(root) {
    var m = motionReduced();
    if (!m.on) {
      return result("2.3.3", "not-applicable", 0, [],
        "Motion is not reduced right now — neither the operating system nor this desk's own override is asking for it — so there is nothing to verify. Switch reduced motion on in the Display tab and measure again, and this check reports every element that keeps animating anyway. Note the level: 2.3.3 is AAA, so it is reported here but is NOT counted towards an AA result.");
    }
    var all, i, el, cs, fails = [], checked = 0;
    try { all = root.querySelectorAll("*"); } catch (e) { all = []; }
    for (i = 0; i < all.length && i < 4000; i++) {
      el = all[i];
      if (inDesk(el) || !visible(el)) continue;
      cs = styleOf(el);
      if (!cs) continue;
      checked++;
      var ad = maxSec(cs.animationDuration), td = maxSec(cs.transitionDuration);
      var props = String(cs.transitionProperty || "");
      var moving = /transform|all|top|bottom|inset|scale|rotate|translate|margin/.test(props);
      if (ad > 0.05 && cs.animationName && cs.animationName !== "none") {
        fails.push(finding(el, "a reduced-motion request is active and this element still runs the animation " + cs.animationName + " for " + ad.toFixed(2) + "s", { animation: cs.animationName, sec: ad }));
      } else if (td > 0.2 && moving) {
        fails.push(finding(el, "a reduced-motion request is active and this element still transitions " + props + " over " + td.toFixed(2) + "s", { property: props, sec: td }));
      }
    }
    return result("2.3.3", fails.length ? "fail" : (checked ? "pass" : "not-applicable"), checked, fails,
      "2.3.3 is a LEVEL AAA criterion. It is measured and reported here, and it is excluded from the AA tally.");
  }

  function maxSec(v) {
    if (!v) return 0;
    var parts = String(v).split(","), i, best = 0, n;
    for (i = 0; i < parts.length; i++) {
      var s = parts[i].trim();
      n = parseFloat(s);
      if (!isFinite(n)) continue;
      if (s.indexOf("ms") >= 0) n = n / 1000;
      if (n > best) best = n;
    }
    return best;
  }

  /* ================================================================ audit() */

  var CHECKS = [
    ["1.3.1", scInfoRel],
    ["1.4.3", scContrast],
    ["1.4.11", scNonText],
    ["1.4.12", scTextSpacing],
    ["2.3.3", scAnimation],
    ["2.4.7", scFocusVisible],
    ["2.4.11", scFocusObscured],
    ["2.5.8", scTargetSize],
    ["4.1.2", scNameRoleValue]
  ];

  /* The desk is a full-screen dialog. Auditing with it painted would measure
     the desk, and every control behind it would come back "entirely obscured"
     by the desk itself — a true statement about a false situation. So the
     sheet is made invisible for the duration of the pass (html.dla-auditing),
     the pass runs against the page, and the sheet comes back. Elements inside
     the desk are skipped by inDesk() as a second guard. */

  function audit(opts) {
    opts = opts || {};
    var root = opts.root || D.body;
    var t0 = 0, t1 = 0;
    try { t0 = W.performance && W.performance.now ? W.performance.now() : (C.now ? C.now() : 0); } catch (e) { t0 = 0; }
    var hid = false;
    try { D.documentElement.classList.add("dla-auditing"); hid = true; } catch (e) { hid = false; }
    var out = [], i, r;
    for (i = 0; i < CHECKS.length; i++) {
      try {
        r = CHECKS[i][1](root);
      } catch (e) {
        r = result(CHECKS[i][0], "error", 0, [], "the check threw: " + (e && e.message ? e.message : String(e)));
      }
      out.push(r);
    }
    if (hid) { try { D.documentElement.classList.remove("dla-auditing"); } catch (e) {} }
    try { t1 = W.performance && W.performance.now ? W.performance.now() : (C.now ? C.now() : 0); } catch (e) { t1 = t0; }

    var tot = { pass: 0, fail: 0, na: 0, error: 0, findings: 0, checked: 0, aaPass: 0, aaFail: 0 };
    for (i = 0; i < out.length; i++) {
      r = out[i];
      tot.findings += r.count;
      tot.checked += r.checked;
      if (r.status === "pass") tot.pass++;
      else if (r.status === "fail") tot.fail++;
      else if (r.status === "error") tot.error++;
      else tot.na++;
      if (r.level === "A" || r.level === "AA") {
        if (r.status === "pass") tot.aaPass++;
        else if (r.status === "fail") tot.aaFail++;
      }
    }
    return {
      at: C.now ? C.now() : 0,
      ms: t1 > t0 ? t1 - t0 : null,
      url: location && location.hash ? String(location.hash) : "",
      sc: out,
      totals: tot,
      /* the sentence this desk is allowed to say, and the one it is not */
      verdict: tot.aaFail === 0
        ? ("Nothing failed the checks this desk can run. That is not the same sentence as “this page is accessible”, and this desk will not print that one.")
        : (tot.aaFail + " of the A and AA criteria measured here failed, across " + tot.findings + " elements.")
    };
  }

  /* ==================================================== keyboard, as it is bound */
  /* NOT a typed list. The payload's own inline script text is read out of the
     document and scanned for key comparisons, so what is printed is what is
     actually wired. A binding dispatched from a lookup table rather than from a
     comparison is invisible to this scan, and the panel says so. */

  function payloadText() {
    var s = [], tags, i, t;
    try { tags = D.getElementsByTagName("script"); } catch (e) { return ""; }
    for (i = 0; i < tags.length; i++) {
      t = tags[i];
      if (t.src) continue;                          /* only what is inline in the payload */
      s.push(t.textContent || "");
      if (s.join("").length > 4000000) break;
    }
    return s.join("\n");
  }

  var KEY_RE = /(?:(?:e|ev|evt|event)\.key\s*===?\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*===?\s*(?:e|ev|evt|event)\.key)/g;
  var NAMED_KEY = /^(Arrow(Up|Down|Left|Right)|Enter|Escape|Esc|Tab|Backspace|Delete|Home|End|PageUp|PageDown|Space|Spacebar|Insert|F\d{1,2})$/;
  var MOD_RE = /(!)?\s*[\w.$]*\b(metaKey|ctrlKey|altKey|shiftKey)/g;

  function scanShortcuts(text) {
    text = String(text || "");
    var found = {}, m, lit, mods, before, mm, order = [];
    KEY_RE.lastIndex = 0;
    while ((m = KEY_RE.exec(text)) !== null) {
      lit = m[1] || m[2] || "";
      lit = lit.slice(1, lit.length - 1);
      if (!lit || lit.length > 12) continue;
      /* A StorageEvent also carries a key property, and its value is a storage
         key, not a keystroke. Only values a KeyboardEvent can actually produce
         are kept, which is what stops a cross-tab state listener from being
         printed as a shortcut. */
      if (!(lit.length === 1 || NAMED_KEY.test(lit))) continue;
      /* Only the CURRENT statement counts. Widening the window past the last
         statement boundary is how a modifier from an earlier binding gets
         stapled onto the next one, which is exactly the wrong answer. */
      before = text.slice(Math.max(0, m.index - 150), m.index);
      var cut = before.lastIndexOf(";");
      if (before.lastIndexOf("{") > cut) cut = before.lastIndexOf("{");
      if (before.lastIndexOf("}") > cut) cut = before.lastIndexOf("}");
      if (cut >= 0) before = before.slice(cut + 1);
      mods = [];
      var lastMod = -1;
      MOD_RE.lastIndex = 0;
      while ((mm = MOD_RE.exec(before)) !== null) {
        /* a guard that bails out WHEN a modifier is held is the opposite of a
           binding that REQUIRES one; the negation is what tells them apart */
        if (mm[1]) continue;
        if (indexOf(mods, mm[2]) < 0) mods.push(mm[2]);
        lastMod = mm.index;
      }
      /* the modifier group has to be ANDed with the key test to be a modifier */
      var requires = mods.length > 0 && lastMod >= 0 && before.slice(lastMod).indexOf("&&") >= 0;
      var label = (requires ? modLabel(mods) : "") + pretty(lit);
      var key = label;
      if (!found[key]) { found[key] = { key: label, raw: lit, mods: mods.slice(0, 4), sites: 0, context: null }; order.push(key); }
      found[key].sites++;
      if (!found[key].context) found[key].context = squeeze(text.slice(Math.max(0, m.index - 46), m.index + 46));
    }
    var list = [], i;
    for (i = 0; i < order.length; i++) list.push(found[order[i]]);
    list.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });

    /* chorded bindings: the payload's leader-key handler holds a flat map of
       letter to destination. It is extracted only when it parses as exactly
       that; otherwise the chord is named and its letters are not claimed. */
    var chords = [], ci = text.indexOf("vimChord");
    if (ci >= 0) {
      var win2 = text.slice(ci, ci + 1400);
      var mapm = win2.match(/map\s*=\s*\{([^{}]{4,400})\}/);
      if (mapm) {
        var pairs = mapm[1].match(/["']?([A-Za-z])["']?\s*:\s*["']([\w-]{1,24})["']/g) || [];
        for (i = 0; i < pairs.length; i++) {
          var pm = pairs[i].match(/["']?([A-Za-z])["']?\s*:\s*["']([\w-]{1,24})["']/);
          if (pm) chords.push({ key: "g then " + pm[1], to: pm[2] });
        }
      }
    }
    return { keys: list, chords: chords, chars: text.length };
  }

  function modLabel(mods) {
    var out = [];
    if (indexOf(mods, "metaKey") >= 0 && indexOf(mods, "ctrlKey") >= 0) out.push("Cmd or Ctrl");
    else if (indexOf(mods, "metaKey") >= 0) out.push("Cmd");
    else if (indexOf(mods, "ctrlKey") >= 0) out.push("Ctrl");
    if (indexOf(mods, "altKey") >= 0) out.push("Alt");
    if (indexOf(mods, "shiftKey") >= 0) out.push("Shift");
    return out.length ? out.join(" + ") + " + " : "";
  }

  function pretty(k) {
    if (k === " ") return "Space";
    if (k.length === 1) return k.toUpperCase();
    return k;
  }
  function squeeze(s) { return String(s).replace(/\s+/g, " ").trim(); }

  function shortcuts() {
    var s = scanShortcuts(payloadText());
    var ak = [], all, i;
    try { all = D.querySelectorAll("[accesskey]"); } catch (e) { all = []; }
    for (i = 0; i < all.length; i++) ak.push({ key: "Access key " + all[i].getAttribute("accesskey"), to: accName(all[i]) || selFor(all[i]) });
    s.accesskeys = ak;
    return s;
  }

  /* ==================================================================== i18n */
  /* English is the base and is complete. Hindi and Spanish cover the chrome of
     this desk. Arabic is here because a writing direction that is never
     exercised is a writing direction that does not work — it carries the terms
     that are unambiguous and leaves the rest untranslated ON PURPOSE. A key
     with no confident translation is left out so the fallback shows, rather
     than filled with something that reads like a machine wrote it. */

  var STR = {};

  STR.en = {
    "ui.name": window.DLI18N.t("63-access.ec5ba0abb717"),
    "ui.sub": window.DLI18N.t("63-access.0bc5b0f3ff8e"),
    "tab.audit": window.DLI18N.t("63-access.bb6aea287396"),
    "tab.display": window.DLI18N.t("63-access.34e108c0896d"),
    "tab.language": window.DLI18N.t("63-access.a4fe65264ef7"),
    "tab.method": window.DLI18N.t("63-access.52a0f9b65b27"),
    "audit.run": window.DLI18N.t("63-access.3c8189a95f3e"),
    "audit.again": window.DLI18N.t("63-access.7bc3ba075c44"),
    "audit.idle": window.DLI18N.t("63-access.a0aa76076835"),
    "audit.took": window.DLI18N.t("63-access.bf36e553e10a"),
    "audit.floor": window.DLI18N.t("63-access.879120641f33"),
    "sc.criterion": window.DLI18N.t("63-access.4a5f72b82c0c"),
    "sc.level": window.DLI18N.t("63-access.1709305c9fa9"),
    "sc.added": window.DLI18N.t("63-access.275989f5e28e"),
    "sc.checked": window.DLI18N.t("63-access.0efd92a33590"),
    "sc.findings": window.DLI18N.t("63-access.e171c2ff25b5"),
    "sc.new22": window.DLI18N.t("63-access.9de12726549e"),
    "st.pass": window.DLI18N.t("63-access.d74ff0ee8da3"),
    "st.fail": window.DLI18N.t("63-access.51280dabfbc8"),
    "st.na": window.DLI18N.t("63-access.1bd86e06d963"),
    "st.error": window.DLI18N.t("63-access.6d9973b2ef09"),
    "find.selector": window.DLI18N.t("63-access.f02a172a3535"),
    "find.show": window.DLI18N.t("63-access.b76c42cb4bf3"),
    "find.more": window.DLI18N.t("63-access.827ab9506d94"),
    "disp.head": window.DLI18N.t("63-access.0c64f3016797"),
    "disp.spacing": window.DLI18N.t("63-access.48992b4025e6"),
    "disp.motion": window.DLI18N.t("63-access.1fd516a54881"),
    "disp.targets": window.DLI18N.t("63-access.0d034f6e2d25"),
    "disp.contrast": window.DLI18N.t("63-access.9d69da969398"),
    "disp.on": window.DLI18N.t("63-access.b8d31e852725"),
    "disp.off": window.DLI18N.t("63-access.b4dc66dde806"),
    "disp.keyboard": window.DLI18N.t("63-access.2316810a5de3"),
    "keys.key": window.DLI18N.t("63-access.99a52df3ff3d"),
    "keys.where": window.DLI18N.t("63-access.01c56e71f6df"),
    "keys.sites": window.DLI18N.t("63-access.9d7690937436"),
    "keys.none": window.DLI18N.t("63-access.d504e35573b9"),
    "lang.pick": window.DLI18N.t("63-access.a4fe65264ef7"),
    "lang.coverage": window.DLI18N.t("63-access.523487a5de21"),
    "lang.declared": window.DLI18N.t("63-access.dc56dd2687a3"),
    "lang.measured": window.DLI18N.t("63-access.9298c8f4b3ff"),
    "lang.strings": window.DLI18N.t("63-access.31058086b35a"),
    "lang.translated": window.DLI18N.t("63-access.abbc13c13e35"),
    "lang.chain": window.DLI18N.t("63-access.a0a6ecf56058"),
    "lang.mark": window.DLI18N.t("63-access.883ed6d693e7"),
    "lang.dir": window.DLI18N.t("63-access.0935fd222194"),
    "lang.ltr": window.DLI18N.t("63-access.7d852e658818"),
    "lang.rtl": window.DLI18N.t("63-access.752fa095e782"),
    "intl.number": window.DLI18N.t("63-access.bd82cf16699b"),
    "intl.date": window.DLI18N.t("63-access.99c40ab40592"),
    "intl.rel": window.DLI18N.t("63-access.e5fe302dbf75"),
    "intl.currency": window.DLI18N.t("63-access.3ac1a9ec4fa7"),
    "method.head": window.DLI18N.t("63-access.52a0f9b65b27"),
    "method.assume": window.DLI18N.t("63-access.2d3d2a04ac44"),
    "oracle.head": window.DLI18N.t("63-access.4b326511ce7f"),
    "oracle.pair": window.DLI18N.t("63-access.989da04b0aaa"),
    "oracle.expected": window.DLI18N.t("63-access.ca99b7f1b14e"),
    "oracle.measured": window.DLI18N.t("63-access.9298c8f4b3ff"),
    "common.close": window.DLI18N.t("63-access.7d9eb7acb13e"),
    "common.elements": window.DLI18N.t("63-access.b0b17893a513"),
    "common.unknown": window.DLI18N.t("63-access.b23a6a8439c0"),
    "common.none": window.DLI18N.t("63-access.140bedbf9c3f"),
    "common.yes": window.DLI18N.t("63-access.8a798890fe93"),
    "common.no": window.DLI18N.t("63-access.9390298f3fb0")
  };

  STR.hi = {
    "ui.name": "सुलभता",
    "ui.sub": "यह स्क्रीन इस समय WCAG 2.2 AA पर कैसी मापी जाती है",
    "tab.audit": "जाँच",
    "tab.display": "प्रदर्शन",
    "tab.language": "भाषा",
    "tab.method": "विधि",
    "audit.run": "इस स्क्रीन को मापें",
    "audit.again": "फिर से मापें",
    "audit.floor": "यह एक न्यूनतम स्तर है, प्रमाणपत्र नहीं।",
    "sc.criterion": "सफलता मानदंड",
    "sc.level": "स्तर",
    "sc.added": "जोड़ा गया",
    "sc.checked": "जाँचे गए",
    "sc.findings": "निष्कर्ष",
    "sc.new22": "WCAG 2.2 में नया",
    "st.pass": "उत्तीर्ण",
    "st.fail": "विफल",
    "st.na": "लागू नहीं",
    "st.error": "चल नहीं सका",
    "find.show": "दिखाएँ",
    "disp.head": "यह ऐप आपके लिए कैसे दिखे",
    "disp.spacing": "पाठ अंतराल",
    "disp.motion": "कम गति",
    "disp.targets": "बड़े लक्ष्य",
    "disp.on": "चालू",
    "disp.off": "बंद",
    "disp.keyboard": "कीबोर्ड",
    "keys.key": "कुंजी",
    "lang.pick": "भाषा",
    "lang.declared": "घोषित",
    "lang.measured": "मापा गया",
    "lang.translated": "अनुवादित",
    "lang.dir": "लेखन दिशा",
    "lang.ltr": "बाएँ से दाएँ",
    "lang.rtl": "दाएँ से बाएँ",
    "intl.number": "संख्या",
    "intl.date": "दिनांक",
    "intl.rel": "सापेक्ष समय",
    "intl.currency": "मुद्रा",
    "method.head": "विधि",
    "method.assume": "क्या मान लिया गया है",
    "oracle.expected": "अपेक्षित",
    "oracle.measured": "मापा गया",
    "common.close": "बंद करें",
    "common.elements": "तत्व",
    "common.unknown": "अज्ञात",
    "common.none": "कोई नहीं",
    "common.yes": "हाँ",
    "common.no": "नहीं"
  };

  STR.es = {
    "ui.name": "Accesibilidad",
    "ui.sub": "lo que esta pantalla mide frente a WCAG 2.2 AA, ahora mismo",
    "tab.audit": "Auditoría",
    "tab.display": "Pantalla",
    "tab.language": "Idioma",
    "tab.method": "Método",
    "audit.run": "Medir esta pantalla",
    "audit.again": "Medirla otra vez",
    "audit.idle": "Aún no se ha medido nada. El botón recorre el DOM pintado detrás de este panel y comunica lo que encuentra, criterio por criterio.",
    "audit.took": "{n} comprobaciones de elementos en {ms} ms",
    "audit.floor": "Esto es un mínimo, no un certificado.",
    "sc.criterion": "Criterio de conformidad",
    "sc.level": "Nivel",
    "sc.added": "Añadido en",
    "sc.checked": "Comprobados",
    "sc.findings": "Hallazgos",
    "sc.new22": "nuevo en WCAG 2.2",
    "st.pass": "cumple",
    "st.fail": "no cumple",
    "st.na": "no aplicable",
    "st.error": "no se pudo ejecutar",
    "find.selector": "Selector",
    "find.show": "Muéstramelo",
    "find.more": "y {n} más",
    "disp.head": "Cómo se muestra esta aplicación para ti",
    "disp.spacing": "Espaciado del texto",
    "disp.motion": "Movimiento reducido",
    "disp.targets": "Objetivos más grandes",
    "disp.contrast": "Mayor contraste",
    "disp.on": "activado",
    "disp.off": "desactivado",
    "disp.keyboard": "Teclado",
    "keys.key": "Tecla",
    "keys.where": "Dónde está definida",
    "keys.sites": "Lugares",
    "keys.none": "No se encontró ninguna comparación de teclas en el texto del payload.",
    "lang.pick": "Idioma",
    "lang.coverage": "Cobertura",
    "lang.declared": "Declarada",
    "lang.measured": "Medida",
    "lang.strings": "Cadenas",
    "lang.translated": "Traducidas",
    "lang.chain": "Cadena de respaldo",
    "lang.mark": "Marcar cada clave que recurrió al respaldo",
    "lang.dir": "Dirección de escritura",
    "lang.ltr": "de izquierda a derecha",
    "lang.rtl": "de derecha a izquierda",
    "intl.number": "Número",
    "intl.date": "Fecha",
    "intl.rel": "Tiempo relativo",
    "intl.currency": "Moneda",
    "method.head": "Método",
    "method.assume": "Qué se supone",
    "oracle.head": "Las matemáticas del contraste, frente a valores conocidos",
    "oracle.pair": "Par",
    "oracle.expected": "Esperado",
    "oracle.measured": "Medido",
    "common.close": "Cerrar",
    "common.elements": "elementos",
    "common.unknown": "desconocido",
    "common.none": "ninguno",
    "common.yes": "sí",
    "common.no": "no"
  };

  STR.ar = {
    "ui.name": "إمكانية الوصول",
    "tab.audit": "تدقيق",
    "tab.display": "العرض",
    "tab.language": "اللغة",
    "tab.method": "الطريقة",
    "sc.level": "المستوى",
    "sc.checked": "المفحوصة",
    "sc.findings": "النتائج",
    "st.pass": "ناجح",
    "st.fail": "فاشل",
    "st.na": "لا ينطبق",
    "disp.on": "مفعّل",
    "disp.off": "معطّل",
    "disp.keyboard": "لوحة المفاتيح",
    "keys.key": "مفتاح",
    "lang.pick": "اللغة",
    "lang.coverage": "التغطية",
    "lang.translated": "مُترجَمة",
    "lang.dir": "اتجاه الكتابة",
    "lang.ltr": "من اليسار إلى اليمين",
    "lang.rtl": "من اليمين إلى اليسار",
    "intl.number": "رقم",
    "intl.date": "التاريخ",
    "intl.currency": "العملة",
    "common.close": "إغلاق",
    "common.elements": "عناصر",
    "common.unknown": "غير معروف",
    "common.yes": "نعم",
    "common.no": "لا"
  };

  var LANGS = [
    { tag: "en", name: "English", native: "English", dir: "ltr" },
    { tag: "hi", name: "Hindi", native: "हिन्दी", dir: "ltr" },
    { tag: "es", name: "Spanish", native: "Español", dir: "ltr" },
    { tag: "ar", name: "Arabic", native: "العربية", dir: "rtl" }
  ];

  /* Declared coverage, per language, as a percentage of the English table.
     The Language tab prints this NEXT TO the figure it measures from the table
     at run time, and shouts if the two disagree — a declared number that is
     never checked against the thing it describes is how documentation rots. */
  var COVERAGE = { en: 100, hi: 77.8, es: 100, ar: 46 };

  function baseOf(tag) { return String(tag || "").split("-")[0].toLowerCase(); }

  /* requested → base language → English → the key itself, marked. Every step
     is visible in the Language tab so nobody has to guess which one answered. */
  function chainFor(tag) {
    var t0 = String(tag || "en"), b = baseOf(t0), out = [];
    if (t0) out.push(t0);
    if (b && b !== t0) out.push(b);
    if (indexOf(out, "en") < 0) out.push("en");
    out.push("⟦key⟧");
    return out;
  }

  function lookup(key, tag) {
    var ch = chainFor(tag), i, tbl;
    for (i = 0; i < ch.length - 1; i++) {
      tbl = STR[ch[i]];
      if (tbl && typeof tbl[key] === "string" && tbl[key] !== "") return { s: tbl[key], from: ch[i], chain: ch, step: i };
    }
    return { s: null, from: null, chain: ch, step: ch.length - 1 };
  }

  function fill(s, vars) {
    if (!vars) return s;
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(vars, k) && vars[k] != null ? String(vars[k]) : m;
    });
  }

  function t(key, vars, tag) {
    var want = tag || curLang();
    var r = lookup(key, want);
    var s = r.s == null ? ("⟦" + key + "⟧") : fill(r.s, vars);
    if (marking() && r.from !== want) s = "‹" + (r.from || "key") + "› " + s;
    return s;
  }

  function coverage(tag) {
    var b = baseOf(tag), base = STR.en, tbl = STR[b] || {}, i, have = 0;
    var ks = Object.keys(base);
    for (i = 0; i < ks.length; i++) if (typeof tbl[ks[i]] === "string" && tbl[ks[i]] !== "") have++;
    return { tag: b, keys: ks.length, translated: have, pct: ks.length ? (have / ks.length * 100) : null, declared: COVERAGE[b] == null ? null : COVERAGE[b] };
  }

  function missingKeys(tag) {
    var b = baseOf(tag), tbl = STR[b] || {}, ks = Object.keys(STR.en), out = [], i;
    for (i = 0; i < ks.length; i++) if (!(typeof tbl[ks[i]] === "string" && tbl[ks[i]] !== "")) out.push(ks[i]);
    return out;
  }

  function langMeta(tag) {
    var b = baseOf(tag), i;
    for (i = 0; i < LANGS.length; i++) if (LANGS[i].tag === b) return LANGS[i];
    return { tag: b, name: b, native: b, dir: "ltr" };
  }

  /* ------------------------------------------------------------------ Intl */
  /* Every figure below is formatted by the platform, not by a hand-rolled
     separator table. If Intl is missing (very old Safari) the raw value is
     printed rather than a wrong-looking guess. */

  function fmtNum(n, tag, opt) {
    if (n == null || !isFinite(n)) return "—";
    try { return new Intl.NumberFormat(tag || curLang(), opt || undefined).format(n); } catch (e) { return String(n); }
  }
  function fmtCur(n, code, tag) {
    if (n == null || !isFinite(n)) return "—";
    try { return new Intl.NumberFormat(tag || curLang(), { style: "currency", currency: code || "USD" }).format(n); } catch (e) { return String(n) + " " + (code || ""); }
  }
  function fmtDate(ms, tag) {
    if (!(ms > 0)) return "—";
    try { return new Intl.DateTimeFormat(tag || curLang(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms)); } catch (e) {
      try { return new Date(ms).toISOString().slice(0, 16).replace("T", " "); } catch (e2) { return "—"; }
    }
  }
  function fmtRel(deltaMs, tag) {
    if (deltaMs == null || !isFinite(deltaMs)) return "—";
    var units = [["year", 31536000000], ["month", 2592000000], ["day", 86400000], ["hour", 3600000], ["minute", 60000], ["second", 1000]];
    var i, u, v;
    for (i = 0; i < units.length; i++) {
      u = units[i];
      if (Math.abs(deltaMs) >= u[1] || u[0] === "second") {
        v = Math.round(deltaMs / u[1]);
        try { return new Intl.RelativeTimeFormat(tag || curLang(), { numeric: "auto" }).format(v, u[0]); }
        catch (e) { try { return C.ago ? C.ago(Math.abs(deltaMs)) : (v + " " + u[0]); } catch (e2) { return v + " " + u[0]; } }
      }
    }
    return "—";
  }

  /* ============================================================ preferences */
  /* The v154 bucket, namespaced. No storage key of this layer's own. */

  function bucket() {
    var X = null;
    try { X = C.X(); } catch (e) { X = null; }
    if (!X) return null;
    if (!X.access) X.access = {};
    var a = X.access;
    if (a.lang == null) a.lang = "en";
    if (a.space == null) a.space = 0;
    if (a.motion == null) a.motion = 0;
    if (a.targets == null) a.targets = 0;
    if (a.contrast == null) a.contrast = 0;
    if (a.mark == null) a.mark = 0;
    return a;
  }
  var FALLBACK_PREFS = { lang: "en", space: 0, motion: 0, targets: 0, contrast: 0, mark: 0 };
  function prefs() { return bucket() || FALLBACK_PREFS; }
  function curLang() { return prefs().lang || "en"; }
  function marking() { return !!prefs().mark; }

  function setPref(k, v) {
    var a = bucket();
    if (a) { a[k] = v; try { C.save(); } catch (e) {} }
    else FALLBACK_PREFS[k] = v;
    applyPrefs();
    return v;
  }

  var MODE_CLASS = { colourblind: "dla-colourblind", space: "dla-space", motion: "dla-motion", targets: "dla-targets", contrast: "dla-contrast" };

  function applyPrefs() {
    var p = prefs(), k, cl;
    try { cl = D.documentElement.classList; } catch (e) { return; }
    for (k in MODE_CLASS) {
      if (!Object.prototype.hasOwnProperty.call(MODE_CLASS, k)) continue;
      if (p[k]) cl.add(MODE_CLASS[k]); else cl.remove(MODE_CLASS[k]);
    }
    /* Language and direction are set on THIS DESK, not on the document. The
       app's own content is English; telling the whole document it is Hindi
       because the desk chrome is would be a lie a screen reader acts on. */
    var el = C.$ ? C.$(SHEET_ID) : D.getElementById(SHEET_ID);
    if (el) {
      var m = langMeta(curLang());
      el.setAttribute("lang", m.tag);
      el.setAttribute("dir", m.dir);
    }
  }

  /* ==================================================== the contrast oracle */
  /* Four pairs whose ratios are fixed by the specification's own arithmetic.
     They are recomputed by this layer's contrastRatio() every time the Method
     tab renders, so a change to the colour maths shows up on screen. The gate
     recomputes the same four independently from the relative-luminance formula
     and refuses the build if these expected values drift. */
  var ORACLE = [
    ["#000000", "#ffffff", 21, "the maximum the formula can produce"],
    ["#767676", "#ffffff", 4.5422, "the lightest grey that still passes 4.5:1 on white"],
    ["#595959", "#ffffff", 7.0047, "the AAA threshold pair on white"],
    ["#949494", "#000000", 6.9228, "a mid grey on black, computed the same way"]
  ];

  function oracleRun() {
    var out = [], i, fg, bg, got;
    for (i = 0; i < ORACLE.length; i++) {
      fg = parseColor(ORACLE[i][0]); bg = parseColor(ORACLE[i][1]);
      got = contrastRatio(fg, bg);
      out.push({
        fg: ORACLE[i][0], bg: ORACLE[i][1], expected: ORACLE[i][2], measured: got,
        note: ORACLE[i][3],
        ok: got != null && Math.abs(got - ORACLE[i][2]) <= 0.0001 + Math.abs(ORACLE[i][2]) * 1e-4
      });
    }
    return out;
  }

  /* ===================================================== honesty block */

  var ASSUMPTIONS = [
    "AN AUTOMATED PASS FINDS ROUGHLY A THIRD OF WCAG FAILURES. That is the whole reason this panel is described as a floor and never as a certificate. Published measurements of automated coverage cluster between 20% and 30% of the failures a manual audit finds on the same page (Vigo, Brown and Conway, W4A 2013, measured 50% coverage for the best tool on a narrow criterion set; commercial vendors put a full-page scan nearer 30%). Everything a machine cannot judge — whether alt text is TRUE, whether a heading describes what follows it, whether an error message is comprehensible, whether the reading order makes sense, whether a control is operable with a screen reader rather than merely named — is outside this panel by construction.",
    "A NAME IS CHECKED FOR PRESENCE, NOT FOR QUALITY. 1.3.1 here asks whether a control has an accessible name at all. A button named “click here” passes this desk and fails a person. A placeholder counts as a name in this pass because the accname algorithm allows it, and it is a weak one — it disappears the moment the field has content.",
    "THE ACCESSIBLE NAME IS COMPUTED BY THIS LAYER, NOT READ FROM THE ACCESSIBILITY TREE. No browser exposes the computed accname to page script. This layer walks aria-labelledby, aria-label, a label element, alt, value, title and own text, in that order. It does not implement the full accname specification — no shadow DOM traversal, no CSS generated content, no aria-hidden pruning inside a label — so a name that a real screen reader computes differently is possible.",
    "2.4.11 IS MEASURED BY HIT TESTING, NOT BY WATCHING FOCUS. Five points of each control's box are probed with elementFromPoint; the control is reported obscured only when EVERY probed point lands on something unrelated, which is the MINIMUM level's own threshold of “entirely hidden”. Anything scrolled out of the viewport cannot be probed and is counted as UNMEASURED, never as a pass. The Enhanced variant (2.4.12, partial obscuring) is not measured at all.",
    "2.5.8's SPACING EXCEPTION IS APPROXIMATED BY CENTRE-TO-CENTRE DISTANCE. The specification draws a 24 pixel diameter circle centred on each target and asks whether the circles intersect. For equal-size targets that reduces exactly to centre distance under 24 pixels, which is what is computed here. For targets of very different sizes it is an approximation, and it errs towards REPORTING a failure rather than excusing one.",
    "1.4.3 REFUSES TO GUESS. A colour sitting on a gradient or a background image has no single backdrop, so the ratio is not computed and the element is counted as UNRESOLVED in a separate column — not as a pass. Translucent token washes ARE resolved: the layer walks up the tree, collects every translucent layer, stops at the first opaque one, and composites back down, which is how a 3.5% white wash over a card over the page gets a true ratio instead of the pigment's.",
    "2.3.3 IS LEVEL AAA AND IS EXCLUDED FROM THE AA TALLY. It is reported because motion is the accessibility failure this app is most likely to ship, but counting a AAA result inside an AA score would flatter the number. It also only has anything to say once a reduced-motion request is active — otherwise there is no promise to check.",
    "THE AUDIT MEASURES ONE SCREEN AT ONE MOMENT. It walks the DOM that is painted behind this desk, with this viewport width, this appearance and this data. A different route, a different breakpoint, Day instead of Night, or an empty state instead of a loaded one is a different measurement. Nothing here is cached or claimed for the app as a whole.",
    "FOCUS IS ACTUALLY MOVED TO MEASURE 2.4.7. There is no way to read a :focus rule without focus. The pass focuses up to 160 controls with preventScroll and hands focus back to where it started. If a control's own handler reacts to focus, that handler runs — which is a real side effect of a real measurement, and it is named here rather than hidden.",
    "TRANSLATION COVERAGE IS COUNTED, NOT ESTIMATED. Each language's percentage is the count of non-empty keys in its table over the count of keys in the English table, computed at run time from the tables themselves. Hindi and Spanish translate the chrome of this desk. Arabic carries the terms that are unambiguous and deliberately leaves the rest to the fallback, because the point of shipping it is to exercise a right-to-left layout honestly, not to claim a translation nobody checked. A key with no confident translation is LEFT OUT so the fallback marker shows it."
  ];

  var METHOD = [
    ["What is measured", "Nine success criteria, each named by its real WCAG 2.2 number, level and the version that introduced it. Two of them — 2.4.11 Focus Not Obscured (Minimum) and 2.5.8 Target Size (Minimum) — are NEW IN WCAG 2.2 and appear in almost no older audit. WCAG 2.2 also removed 4.1.1 Parsing, so this desk does not report it. Each criterion comes back pass, fail or not applicable, with the number of elements it actually looked at."],
    ["Contrast", "The specification's own arithmetic, nothing borrowed. Each channel is converted from 8-bit sRGB to linear light — divide by 12.92 below 0.03928, otherwise raise ((c+0.055)/1.055) to the 2.4 — weighted 0.2126 red, 0.7152 green, 0.0722 blue, and the ratio is (lighter+0.05)/(darker+0.05). Nothing is rounded before the comparison, because rounding 4.4999 to 4.50 is exactly how a contrast check silently passes a failure. The Method tab recomputes four known pairs on every render so the maths is visible, not asserted."],
    ["Backdrops", "The colour behind a piece of text is resolved, not assumed. The layer walks up the ancestors collecting every translucent background, stops at the first fully opaque one, then composites the stack back down with source-over. That is what makes a ratio against a token wash correct. If a gradient or an image is anywhere in that stack, the element is reported UNRESOLVED instead of being given a number."],
    ["Target size", "Every pointer target's real bounding box is measured against 24 by 24 CSS pixels, then the specification's exceptions are applied: inline targets in a run of text are exempt, and so are targets whose 24 pixel circles touch nothing else. Undersized targets that earn an exception are counted separately, so the exempt figure is visible rather than folded into the pass."],
    ["Focus", "2.4.7 is measured by focusing each control and diffing its computed style against its resting state — outline, shadow, border, background, colour, decoration and filter. 2.4.11 is measured by hit testing five points of the focused control's box: entirely covered is a failure at the minimum level, partly covered is not, and off-screen is unmeasured."],
    ["Text spacing", "1.4.12 is checked by APPLYING the override the criterion describes — line height 1.5, paragraph spacing 2em, letter spacing 0.12em, word spacing 0.16em — and then looking for elements whose content no longer fits inside a box that clips. The same class powers the reader-facing control on the Display tab, so the thing that is tested and the thing that ships are one implementation."],
    ["Display controls", "Four switches, all page-wide, all persisted in the v154 bucket: the 1.4.12 spacing override, a reduced-motion override that works whether or not the operating system asks for one, a larger-target mode that brings every control up to the 24 pixel minimum, and a higher-contrast mode. The contrast mode REPOINTS elements at tokens that already exist — muted text is promoted to ink, hairlines to the stronger line token — rather than redefining a single token value, so the payload's contrast gate still governs every colour on screen."],
    ["Keyboard", "The shortcut table is SCANNED out of the payload's own inline script text at render time, by finding every comparison against a key property and reading the modifiers that guard it. Nothing is typed by hand, so a binding that is removed disappears from the table by itself. A value that a keystroke cannot produce is dropped, which is what keeps a cross-tab storage listener (whose event also carries a key) out of the table. A binding dispatched from a lookup table rather than a comparison is invisible to that scan; the leader-key chords are extracted separately when they parse as a flat map, and when they do not, they are named without their letters being claimed."],
    ["Language", "One string table, one lookup. A key resolves down a chain: the requested tag, then its base language, then English, then the key itself printed in brackets so a hole is loud instead of blank. Coverage is counted from the tables at run time and printed next to the figure this layer declares, so the two cannot drift apart quietly. Numbers, dates, relative times and currency all go through Intl in the chosen locale. Arabic sets dir=\"rtl\" on the desk, and every rule in this layer's stylesheet uses logical properties, so nothing in the layout depends on a physical side."],
    ["What this is not", "A certificate. An automated pass reaches roughly a third of WCAG failures; the rest needs a person, a screen reader and a keyboard. Read this panel as the floor the build refuses to go below, and read the Assumptions for the list of things it cannot see."]
  ];

  /* ==================================================================== UI */

  function esc(s) {
    try { return C.esc ? C.esc(String(s)) : String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
    catch (e) { return ""; }
  }

  var LAST = null;             /* the last audit, this session only */
  var TIMERS = [];
  var HILITE = null;

  function statusWord(s) {
    if (s === "pass") return t("st.pass");
    if (s === "fail") return t("st.fail");
    if (s === "error") return t("st.error");
    return t("st.na");
  }

  function paneAudit() {
    var h = "";
    h += '<div class="dla-note">' + esc(t("audit.idle")) + "</div>";
    h += '<div class="dla-actions"><button class="dl-b pri" data-act="run">' + esc(LAST ? t("audit.again") : t("audit.run")) + "</button>";
    h += '<span class="dla-floor">' + esc(t("audit.floor")) + "</span></div>";

    if (!LAST) {
      h += '<div class="dla-sub">' + esc(t("sc.criterion")) + "</div>";
      h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + esc(t("sc.criterion")) + "</th><th>" + esc(t("sc.level")) + "</th><th>" + esc(t("sc.added")) + ("</th><th>" + window.DLI18N.t("63-access.8f24e465d1ca") + "</th></tr></thead><tbody>");
      var i;
      for (i = 0; i < SC.length; i++) {
        h += "<tr><td><b>" + esc(SC[i].id) + "</b> " + esc(SC[i].name) + (SC[i].since === "2.2" ? ' <span class="dla-new">' + esc(t("sc.new22")) + "</span>" : "") + "</td><td>" + esc(SC[i].level) + ("</td><td>" + window.DLI18N.t("63-access.3469085062d6")) + esc(SC[i].since) + "</td><td>" + esc(SC[i].what) + "</td></tr>";
      }
      h += "</tbody></table></div>";
      return h;
    }

    var A = LAST;
    h += '<div class="dla-verdict">' + esc(A.verdict) + "</div>";
    h += '<div class="dla-kpis">' +
      kpi(String(A.totals.aaPass), "A and AA clean") +
      kpi(String(A.totals.aaFail), "A and AA failing") +
      kpi(String(A.totals.findings), "elements named") +
      kpi(A.ms == null ? "—" : Math.round(A.ms) + " ms", "to walk the DOM") +
      "</div>";
    h += '<div class="dla-note">' + esc(t("audit.took", { n: fmtNum(A.totals.checked), ms: fmtNum(A.ms == null ? 0 : Math.round(A.ms)) })) + " · " + esc(fmtDate(A.at)) + "</div>";

    var j;
    for (j = 0; j < A.sc.length; j++) h += scCard(A.sc[j]);
    return h;
  }

  function kpi(v, label) { return '<div class="dla-kpi"><b>' + esc(v) + "</b><span>" + esc(label) + "</span></div>"; }

  function scCard(r) {
    var h = '<div class="dla-sc" data-status="' + esc(r.status) + '">';
    h += '<div class="dla-schead"><span class="dla-scid">' + esc(r.id) + '</span><span class="dla-scname">' + esc(r.name) + "</span>";
    h += '<span class="dla-lvl">' + esc(r.level) + "</span>";
    if (r.isNew22) h += '<span class="dla-new">' + esc(t("sc.new22")) + "</span>";
    h += '<span class="dla-status">' + esc(statusWord(r.status)) + "</span></div>";
    h += '<div class="dla-scwhat">' + esc(r.what) + "</div>";
    h += '<div class="dla-scmeta">' + esc(t("sc.checked")) + ": <b>" + esc(fmtNum(r.checked)) + "</b> · " + esc(t("sc.findings")) + ": <b>" + esc(fmtNum(r.count)) + "</b>";
    if (r.extra && r.extra.unresolved) h += (window.DLI18N.t("63-access.bbd71063c932") + "<b>") + esc(fmtNum(r.extra.unresolved)) + "</b>";
    if (r.extra && r.extra.exempt) h += (window.DLI18N.t("63-access.4eb8f1670e86") + "<b>") + esc(fmtNum(r.extra.exempt)) + "</b>";
    if (r.extra && r.extra.offscreen) h += (window.DLI18N.t("63-access.e6193b849272") + "<b>") + esc(fmtNum(r.extra.offscreen)) + "</b>";
    h += "</div>";
    if (r.note) h += '<div class="dla-scnote">' + esc(r.note) + "</div>";
    if (r.count) {
      h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + esc(t("find.selector")) + ("</th><th>" + window.DLI18N.t("63-access.89e72e95e670") + "</th><th></th></tr></thead><tbody>");
      var i, f, n = r.failures.length > 14 ? 14 : r.failures.length;
      for (i = 0; i < n; i++) {
        f = r.failures[i];
        h += '<tr><td><code class="dla-sel">' + esc(f.sel) + "</code></td><td>" + esc(f.why) + '</td><td><button class="dl-b" data-act="show" data-sel="' + esc(f.sel) + '">' + esc(t("find.show")) + "</button></td></tr>";
      }
      h += "</tbody></table></div>";
      if (r.failures.length > n) h += '<div class="dla-more">' + esc(t("find.more", { n: r.failures.length - n })) + "</div>";
    }
    h += "</div>";
    return h;
  }

  function paneDisplay() {
    var p = prefs(), h = "";
    h += '<div class="dla-note">' + esc(t("disp.head")) + (window.DLI18N.t("63-access.d07716a4d6eb") + "</div>");
    h += '<div class="dla-togs">';
    h += tog("space", t("disp.spacing"), "SC 1.4.12 · line height 1.5, paragraph spacing 2em, letter spacing 0.12em, word spacing 0.16em — the specification's own override, applied to the whole app", p.space);
    h += tog("motion", t("disp.motion"), "Independent of the operating system. Animations and transitions collapse to a millisecond, and smooth scrolling goes away, whether or not your machine asks for it", p.motion);
    h += tog("targets", t("disp.targets"), "SC 2.5.8 · every button, chip, link-button and field is brought up to the 24 by 24 pixel minimum. The AAA 44 pixel target of 2.5.5 is NOT claimed", p.targets);
    h += tog("colourblind", "Colour-blind-safe direction colours", "Blue means up; orange means down. Up and down labels also use arrows, and chart legend swatches use solid versus dashed outlines.", p.colourblind);
    h += tog("contrast", t("disp.contrast"), "Muted text is promoted to the ink token, hairlines to the stronger line token, links get an underline, focus rings thicken. No token value is redefined, so the build's contrast gate still governs every colour", p.contrast);
    h += "</div>";

    var m = motionReduced();
    h += ('<div class="dla-note">' + window.DLI18N.t("63-access.070d09dea806") + '<b>') + esc(m.os ? t("common.yes") : t("common.no")) + ("</b>" + window.DLI18N.t("63-access.db4100cfcb91") + "<b>") + esc(m.ours ? t("disp.on") : t("disp.off")) + "</b>.</div>";

    h += '<div class="dla-sub">' + esc(t("disp.keyboard")) + "</div>";
    var s = shortcuts();
    h += ('<div class="dla-note">' + window.DLI18N.t("63-access.6cb7b72378b5") + '') + esc(fmtNum(s.chars)) + (window.DLI18N.t("63-access.0a30a631dac9") + "</div>");
    if (!s.keys.length && !s.chords.length) h += '<div class="dl-empty">' + esc(t("keys.none")) + "</div>";
    else {
      h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + esc(t("keys.key")) + "</th><th>" + esc(t("keys.where")) + '</th><th class="r">' + esc(t("keys.sites")) + "</th></tr></thead><tbody>";
      var i;
      for (i = 0; i < s.keys.length; i++) {
        h += "<tr><td><kbd>" + esc(s.keys[i].key) + "</kbd></td><td><code class=\"dla-sel\">" + esc(s.keys[i].context || "") + '</code></td><td class="r">' + esc(String(s.keys[i].sites)) + "</td></tr>";
      }
      for (i = 0; i < s.chords.length; i++) {
        h += "<tr><td><kbd>" + esc(s.chords[i].key) + ("</kbd></td><td>" + window.DLI18N.t("63-access.cdfc10ddfafc") + "<b>") + esc(s.chords[i].to) + ("</b>" + window.DLI18N.t("63-access.d06c10a88cdc") + "</td><td class=\"r\">1</td></tr>");
      }
      for (i = 0; i < s.accesskeys.length; i++) {
        h += "<tr><td><kbd>" + esc(s.accesskeys[i].key) + "</kbd></td><td>" + esc(s.accesskeys[i].to) + "</td><td class=\"r\">1</td></tr>";
      }
      h += "</tbody></table></div>";
    }
    h += ('<div class="dla-note">' + window.DLI18N.t("63-access.8491ed7de439") + '</div>');
    return h;
  }

  function tog(key, label, note, on) {
    return '<button class="dla-tog" data-act="tog" data-k="' + esc(key) + '" aria-pressed="' + (on ? "true" : "false") + '">' +
      '<span class="dla-togl">' + esc(label) + "</span>" +
      '<span class="dla-togs2">' + esc(on ? t("disp.on") : t("disp.off")) + "</span>" +
      '<span class="dla-togn">' + esc(note) + "</span></button>";
  }

  function paneLang() {
    var cur = curLang(), h = "", i, L, cv;
    h += ('<div class="dla-note">' + window.DLI18N.t("63-access.f24aa53fdce2") + '</div>');
    h += '<div class="dla-langs">';
    for (i = 0; i < LANGS.length; i++) {
      L = LANGS[i];
      cv = coverage(L.tag);
      h += '<button class="dl-chip' + (baseOf(cur) === L.tag ? " on" : "") + '" data-act="lang" data-t="' + esc(L.tag) + '" lang="' + esc(L.tag) + '" dir="' + esc(L.dir) + '">' + esc(L.native) + " · " + esc(cv.pct == null ? "—" : cv.pct.toFixed(1) + "%") + "</button>";
    }
    h += "</div>";

    h += '<div class="dla-sub">' + esc(t("lang.coverage")) + "</div>";
    h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + esc(t("lang.pick")) + "</th><th>" + esc(t("lang.dir")) + '</th><th class="r">' + esc(t("lang.strings")) + '</th><th class="r">' + esc(t("lang.translated")) + '</th><th class="r">' + esc(t("lang.measured")) + '</th><th class="r">' + esc(t("lang.declared")) + "</th></tr></thead><tbody>";
    for (i = 0; i < LANGS.length; i++) {
      L = LANGS[i]; cv = coverage(L.tag);
      var drift = cv.declared != null && cv.pct != null && Math.abs(cv.pct - cv.declared) > 0.06;
      h += "<tr><td>" + esc(L.name) + ' <span lang="' + esc(L.tag) + '" dir="' + esc(L.dir) + '">' + esc(L.native) + "</span></td>" +
        "<td>" + esc(L.dir === "rtl" ? t("lang.rtl") : t("lang.ltr")) + "</td>" +
        '<td class="r">' + esc(fmtNum(cv.keys)) + "</td>" +
        '<td class="r">' + esc(fmtNum(cv.translated)) + "</td>" +
        '<td class="r"><b>' + esc(cv.pct == null ? "—" : cv.pct.toFixed(1) + "%") + "</b></td>" +
        '<td class="r' + (drift ? " dla-drift" : "") + '">' + esc(cv.declared == null ? "—" : cv.declared.toFixed(1) + "%") + (drift ? " ≠" : "") + "</td></tr>";
    }
    h += "</tbody></table></div>";
    h += ('<div class="dla-note">' + window.DLI18N.t("63-access.dca2eaf3b96e") + '</div>');

    h += '<div class="dla-sub">' + esc(t("lang.chain")) + "</div>";
    var ch = chainFor(cur);
    h += '<div class="dla-chain">';
    for (i = 0; i < ch.length; i++) h += '<span class="dla-hop">' + esc(ch[i]) + "</span>" + (i < ch.length - 1 ? '<span class="dla-arrow">→</span>' : "");
    h += "</div>";
    h += ('<div class="dla-note">' + window.DLI18N.t("63-access.538cbc966ce4") + '<code class="dla-sel">' + window.DLI18N.t("63-access.d8f9f1d71114") + '</code>' + window.DLI18N.t("63-access.4b0e73d1ea3c") + '<code class="dla-sel">' + window.DLI18N.t("63-access.c0bc1e08f974") + '</code>' + window.DLI18N.t("63-access.b08f674aebda") + '</div>');

    var miss = missingKeys(cur);
    h += '<div class="dla-row"><button class="dla-tog small" data-act="mark" aria-pressed="' + (marking() ? "true" : "false") + '"><span class="dla-togl">' + esc(t("lang.mark")) + '</span><span class="dla-togs2">' + esc(marking() ? t("disp.on") : t("disp.off")) + "</span></button></div>";
    if (miss.length) {
      h += '<div class="dla-note">' + esc(fmtNum(miss.length)) + " of " + esc(fmtNum(Object.keys(STR.en).length)) + (window.DLI18N.t("63-access.6f94852d2a6d") + "<b>") + esc(langMeta(cur).name) + ("</b>" + window.DLI18N.t("63-access.2049c2e26ef9") + "</div>");
      h += '<div class="dla-keys">';
      for (i = 0; i < miss.length && i < 80; i++) h += '<code class="dla-sel">' + esc(miss[i]) + "</code>";
      h += "</div>";
    }

    h += ('<div class="dla-sub">' + window.DLI18N.t("63-access.61827df47443") + '') + esc(langMeta(cur).name) + "</div>";
    var now = C.now ? C.now() : 0;
    h += '<div class="dl-tblw"><table class="dl-tbl"><tbody>';
    h += "<tr><td>" + esc(t("intl.number")) + '</td><td class="r">' + esc(fmtNum(1234567.891, cur, { maximumFractionDigits: 2 })) + "</td></tr>";
    h += "<tr><td>" + esc(t("intl.currency")) + '</td><td class="r">' + esc(fmtCur(1234.5, "USD", cur)) + " · " + esc(fmtCur(1234.5, "INR", cur)) + " · " + esc(fmtCur(1234.5, "EUR", cur)) + "</td></tr>";
    h += "<tr><td>" + esc(t("intl.date")) + '</td><td class="r">' + esc(fmtDate(now, cur)) + "</td></tr>";
    h += "<tr><td>" + esc(t("intl.rel")) + '</td><td class="r">' + esc(fmtRel(-3600000, cur)) + " · " + esc(fmtRel(172800000, cur)) + "</td></tr>";
    h += "</tbody></table></div>";
    h += ('<div class="dla-note">' + window.DLI18N.t("63-access.72b186f4a6e1") + '</div>');
    return h;
  }

  function paneMethod() {
    var h = ('<div class="dla-note">' + window.DLI18N.t("63-access.5ec794f201cf") + '</div>');
    var i;
    h += '<div class="dla-method">';
    for (i = 0; i < METHOD.length; i++) h += '<div class="dla-mrow"><b>' + esc(METHOD[i][0]) + "</b><span>" + esc(METHOD[i][1]) + "</span></div>";
    h += "</div>";

    h += '<div class="dla-sub">' + esc(t("oracle.head")) + "</div>";
    var o = oracleRun();
    h += '<div class="dl-tblw"><table class="dl-tbl"><thead><tr><th>' + esc(t("oracle.pair")) + '</th><th class="r">' + esc(t("oracle.expected")) + '</th><th class="r">' + esc(t("oracle.measured")) + "</th><th></th></tr></thead><tbody>";
    for (i = 0; i < o.length; i++) {
      h += "<tr><td><code class=\"dla-sel\">" + esc(o[i].fg) + " on " + esc(o[i].bg) + "</code> — " + esc(o[i].note) + '</td><td class="r">' + esc(o[i].expected.toFixed(4)) + '</td><td class="r">' + esc(o[i].measured == null ? "—" : o[i].measured.toFixed(4)) + '</td><td class="r">' + (o[i].ok ? "✓" : "✗") + "</td></tr>";
    }
    h += "</tbody></table></div>";
    h += ('<div class="dla-note">' + window.DLI18N.t("63-access.d25dc1a30481") + '</div>');

    h += '<div class="dla-sub">' + esc(t("method.assume")) + '</div><ul class="dla-assume">';
    for (i = 0; i < ASSUMPTIONS.length; i++) h += "<li>" + esc(ASSUMPTIONS[i]) + "</li>";
    h += "</ul>";
    return h;
  }

  function bodyFor(tab, body) {
    var h;
    if (tab === "display") h = paneDisplay();
    else if (tab === "lang") h = paneLang();
    else if (tab === "method") h = paneMethod();
    else h = paneAudit();
    if (body) body.innerHTML = h;      /* onTab's return value is ignored — write it here */
    return h;
  }

  function repaint() {
    var el = C.$ ? C.$(SHEET_ID) : D.getElementById(SHEET_ID);
    if (!el) return;
    var body = el.querySelector(".dls-body");
    if (!body) return;
    bodyFor(el.dataset ? el.dataset.tab : "audit", body);
    applyPrefs();
  }

  /* -------------------------------------------------------------- highlight */

  function clearHilite() {
    var i;
    for (i = 0; i < TIMERS.length; i++) { try { clearTimeout(TIMERS[i]); } catch (e) {} }
    TIMERS = [];
    if (HILITE) { try { HILITE.classList.remove("dla-hl"); } catch (e) {} HILITE = null; }
  }

  function showElement(sel) {
    clearHilite();
    var el = null;
    try { el = D.querySelector(sel); } catch (e) { el = null; }
    if (!el) { try { C.toast && C.toast("bad", "Gone", "Nothing matches " + sel + " any more — the screen changed since the audit ran."); } catch (e) {} return null; }
    try { C.close && C.close(SHEET_ID); } catch (e) {}
    try { el.scrollIntoView({ block: "center", inline: "nearest" }); } catch (e) {}
    try { el.classList.add("dla-hl"); HILITE = el; } catch (e) {}
    TIMERS.push(setTimeout(clearHilite, 6000));
    try { C.toast && C.toast("good", "Highlighted", sel); } catch (e) {}
    return el;
  }

  /* ---------------------------------------------------------------- wiring */

  function onClick(ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest("[data-act]") : null;
    if (!b) return;
    var act = b.getAttribute("data-act");
    if (act === "run") {
      LAST = audit({ root: D.body });
      repaint();
      return;
    }
    if (act === "show") { showElement(b.getAttribute("data-sel") || ""); return; }
    if (act === "tog") {
      var k = b.getAttribute("data-k");
      setPref(k, prefs()[k] ? 0 : 1);
      repaint();
      return;
    }
    if (act === "mark") { setPref("mark", marking() ? 0 : 1); repaint(); return; }
    if (act === "lang") { setPref("lang", b.getAttribute("data-t") || "en"); repaint(); return; }
  }

  var wired = false;
  function wire(el) {
    if (!el || wired) return;
    el.addEventListener("click", onClick);
    wired = true;
    el.__onClose = function () {
      try { el.removeEventListener("click", onClick); } catch (e) {}
      wired = false;
      clearHilite();
    };
  }

  function open(tab) {
    var el = null;
    try {
      el = C.open(SHEET_ID, {
        title: "◔ " + t("ui.name"),
        sub: t("ui.sub"),
        tabs: [["audit", t("tab.audit")], ["display", t("tab.display")], ["lang", t("tab.language")], ["method", t("tab.method")]],
        onTab: bodyFor
      }, tab || "audit");
    } catch (e) { el = null; }
    try { wire(el || D.getElementById(SHEET_ID)); } catch (e) {}
    applyPrefs();
    return el;
  }

  /* Preferences are the reader's, so they apply the moment the payload runs —
     not the first time the desk is opened. */
  try { applyPrefs(); } catch (e) {}

  try { if (window.DLDESKS && window.DLDESKS.register) window.DLDESKS.register("access", "◔", "Access", "Measure this screen against WCAG 2.2 AA, change how it renders, switch language", function () { open("audit"); }); } catch (e) {}
  try { C.cmd && C.cmd("access", "Access — a live WCAG 2.2 AA audit of this screen, display controls, language", "◔", function () { open("audit"); }); } catch (e) {}
  try { C.cmd && C.cmd("audit", "Audit this screen — contrast, focus, target size, names", "◔", function () { open("audit"); }); } catch (e) {}

  window.DLACCESS = {
    __v: 166,
    open: open,
    audit: audit,
    checks: function () { return SC.slice(); },
    contrastRatio: contrastRatio,
    luminance: luminance,
    parseColor: parseColor,
    composite: composite,
    resolveBg: resolveBg,
    selectorFor: selFor,
    accName: accName,
    scanShortcuts: scanShortcuts,
    shortcuts: shortcuts,
    oracle: oracleRun,
    prefs: prefs,
    setPref: setPref,
    languages: function () { return LANGS.slice(); },
    coverage: coverage,
    missingKeys: missingKeys,
    fallbackChain: chainFor,
    i18n: {
      t: t,
      table: STR,
      languages: LANGS,
      coverage: coverage,
      missingKeys: missingKeys,
      chain: chainFor,
      declared: COVERAGE,
      num: fmtNum,
      cur: fmtCur,
      date: fmtDate,
      rel: fmtRel
    },
    METHOD: METHOD,
    ASSUMPTIONS: ASSUMPTIONS
  };
})();
