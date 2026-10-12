// owns: DexScript parser, interpreter and study runtime
// reads: S paper state
// emits: DXS
/* ============================================================================
   DXS · DexScript — layer 53 · the scripting engine for the native chart
   ----------------------------------------------------------------------------
   The engine draws 133 indicators — 65 from layer 46, 68 from layer 51. Every one of them is a JavaScript function
   somebody at this end wrote. The terminal most traders arrive from lets them
   write their own, and that — not another oscillator — is the gap. This file
   closes it: a lexer, a parser and a bar-by-bar tree-walking interpreter for a
   Pine-shaped language of our own, in plain JS, with no eval and no Function
   constructor anywhere near it.

   WHAT THIS FILE HOLDS
     1  limits + small utilities   the budgets a runaway script stops against
     2  lexer                      indentation to INDENT/DEDENT, no regex soup
     3  parser                     recursive descent + precedence climbing
     4  resolver                   scopes, slots, arity, call-site state ids
     5  standard library           ta · math · str · array · color · request
     6  outputs                    plot/hline/fill/shape, collected not drawn
     7  strategy                   the order book, drained at the NEXT bar open
     8  interpreter                one pass per bar, bar 0 to the last bar
     9  rows                       what was collected, in the engine's row kinds
    10  public API                 DXS.compile / run / register / lint / docs

   WHY A TREE WALKER AND NOT A COMPILER
     The obvious way to make a script fast is to emit JavaScript and hand it to
     the Function constructor. That is exactly the door this codebase keeps
     shut: gate-arch, gate-vault, gate-mxcache and gate-defi all ratchet the
     eval-family count, and the two call sites the payload is allowed are spent
     elsewhere. So the program never becomes code. It stays a tree, and the
     tree is walked. The cost is a constant factor; the benefit is that a
     script reaches nothing but the table in section 5 — there is no host
     object to reach, because nothing in the interpreter ever hands one out.

   THE EXECUTION MODEL, WHICH IS THE WHOLE DESIGN
     The program body runs ONCE PER BAR, in order, bar 0 to the last. It is not
     a function over an array. Two things follow, and both are load-bearing:
       · every value that carries history owns a slot. The resolver gives a
         stable integer to each top-level name and to each expression that is
         indexed with [n]; at run time one array per slot holds the value the
         program had at every bar, so x[1] is a read of slot(x)[i-1] and never
         a recomputation.
       · a stateful ta.* builtin is incremental PER CALL SITE. ta.ema(x, 9)
         carries its running average against its own site id, so the same
         formula written twice is two independent averages, one inside an if
         advances only on the bars the if ran, and the whole run stays O(n)
         however deeply the calls nest.
     A window that has not filled yet is na. Never 0, never carried forward,
     never guessed — the same rule section 4 of the engine keeps.

   HOUSE RULES OBSERVED
     · one IIFE, ES5 only (var/function), idempotent, no dependencies
     · no eval, no Function constructor, no string timer, no innerHTML, no DOM
       write of any kind — this layer draws through the engine or not at all
     · no inline style attribute, no .style assignment
     · errors are values: nothing thrown escapes compile(), run() or register()
     · internal faults are routed through DXC.kit.fault so they are findable

   REGISTRATION IS A TWO-CALL CONTRACT WITH THE ENGINE
     DXC.registerStudy(key, def) puts a script on the chart and
     DXC.unregisterStudy(key) takes it off. Both halves live in 46-dexchart.js
     because both have to touch ST_KEYS, and ST_KEYS is private. Do not try to
     remove a study from this side by deleting it out of DXC.studyDefs(): the
     key list is rebuilt inside registerStudy and nowhere else, the indicator
     dialog reads a def for every key it lists without a null guard, and a
     CFG.studies row left pointing at a def that has gone asks the pane layout
     and the legend to describe something that cannot be computed. An earlier
     version of this file worked around the missing half by re-registering
     another script to force the rebuild, and by parking a named placeholder
     when there was no other script to use. All of that is deleted. If the
     removal ever looks impossible again, add the missing call to the engine
     rather than rebuilding the workaround.
   ============================================================================ */
window.DXS = (function () {
  "use strict";
  if (window.DXS && window.DXS.__v) return window.DXS;

  var W = window;
  var DXC = W.DXC || null;
  var KIT = DXC && DXC.kit ? DXC.kit : null;

  /* =====================================================================
     1 · LIMITS + SMALL UTILITIES
     A script that runs away must stop with a line number, not with a frozen
     tab. Every budget below is checked from inside the interpreter loop, so
     there is no path through the language that skips them.
     ===================================================================== */

  var LIM = {
    steps: 4000000,   /* interpreter steps for one full run over every bar   */
    ms: 250,          /* wall clock, a soft budget checked every 4096 steps  */
    depth: 64,        /* user-function call depth                            */
    loop: 10000,      /* iterations of one for/while, per bar                */
    array: 100000,    /* elements in one script array                        */
    plots: 32,        /* plot/plotshape/plotchar/label outputs               */
    slots: 4096,      /* history slots                                       */
    source: 65536     /* source bytes                                        */
  };
  var STEP_MASK = 4095;

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function nul(n) { var a = new Array(n), i; for (i = 0; i < n; i++) a[i] = null; return a; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function fault(where, e) { try { if (KIT && KIT.fault) KIT.fault("dxscript:" + where, e); } catch (x) { } }

  /* An error is a value everywhere in this file. Err() builds one; the two
     public entry points catch it and hand it back in an array. */
  function Err(line, col, msg) { return { __dxs: 1, line: line || 0, col: col || 0, msg: msg }; }
  function isErr(e) { return !!(e && e.__dxs); }

  /* ---------------------------------------------------------------- colour
     A script colour is a hex plus a transparency, because that is what Pine
     users type and what plot() needs. It stays an object until the moment a
     row is built, so color.new(c, 0.9) can re-tint one that was passed in. */
  function mkCol(hex, transp) {
    return { __c: 1, h: normHex(hex), t: transp == null ? 0 : Math.max(0, Math.min(1, transp)) };
  }
  function isCol(v) { return !!(v && v.__c); }
  function normHex(h) {
    var s = String(h == null ? "" : h).trim();
    if (s.charAt(0) !== "#") s = "#" + s;
    if (s.length === 4) s = "#" + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2) + s.charAt(3) + s.charAt(3);
    if (!/^#[0-9a-fA-F]{6}$/.test(s)) return null;
    return s.toUpperCase();
  }
  function hex2(n) { var s = Math.round(Math.max(0, Math.min(255, n))).toString(16); return s.length < 2 ? "0" + s : s; }
  /* A colour becomes canvas-ready only here. Fully opaque stays six digits so
     nothing downstream has to know about the eight-digit form. */
  function cssOf(v, dflt) {
    if (isCol(v)) {
      if (!v.h) return dflt || null;
      if (v.t <= 0.001) return v.h;
      return v.h + hex2((1 - v.t) * 255).toUpperCase();
    }
    if (typeof v === "string") { var h = normHex(v); return h || dflt || null; }
    return dflt || null;
  }

  /* the engine's own series palette, so a script that names no colour still
     looks like the rest of the chart */
  var PAL = (KIT && KIT.colors) ? KIT.colors : ["#5B8CFF", "#F5A623", "#22D39A", "#FF5A78", "#B36BFF", "#00E5FF",
    "#FFD166", "#7BE38A", "#FF8A5B", "#6FA8FF", "#E26BFF", "#3DD6D0"];
  function paletteAt(i) { return PAL[i % PAL.length]; }

  /* =====================================================================
     2 · LEXER
     Blocks are indentation, so the scanner — not the parser — is where a
     line's shape is decided. It emits NL / INDENT / DEDENT, swallows both
     inside an open bracket (a call may wrap over as many lines as it likes),
     and refuses a file that indents with tabs in one place and spaces in
     another, because the two look identical and disagree.
     ===================================================================== */

  var KW = {
    "if": 1, "else": 1, "for": 1, "to": 1, "by": 1, "while": 1, "break": 1, "continue": 1,
    "var": 1, "and": 1, "or": 1, "not": 1, "true": 1, "false": 1, "na": 1,
    "float": 1, "int": 1, "bool": 1, "string": 1, "color": 1
  };
  var TYPEWORD = { "float": 1, "int": 1, "bool": 1, "string": 1, "color": 1 };
  var OPS3 = [];
  var OPS2 = [":=", "==", "!=", "<=", ">=", "=>"];
  var OPS1 = ["+", "-", "*", "/", "%", "<", ">", "=", "?", ":"];
  var PUNC1 = ["(", ")", "[", "]", ",", "."];

  function isDigit(c) { return c >= "0" && c <= "9"; }
  function isAlpha(c) { return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_"; }
  function isAlnum(c) { return isAlpha(c) || isDigit(c); }

  /* toks: {k, v, line, col, s, e}.  k ∈ num str id op punc nl ind ded eof
     coms: the comment spans, kept aside for the editor's highlighter only. */
  function lex(src) {
    var T = [], coms = [], i = 0, n = src.length, line = 1, lineStart = 0;
    var stack = [0], depth = 0, indentChar = null, indentLine = 0;
    var atStart = true, lastWasNL = true;

    function col(at) { return at - lineStart + 1; }
    function push(k, v, s, e, ln, cl) { T.push({ k: k, v: v, line: ln, col: cl, s: s, e: e }); }

    while (i < n) {
      if (atStart && depth === 0) {
        /* measure the indent run, then decide what the line is before judging it */
        var j = i, sp = 0, tb = 0;
        while (j < n && (src.charAt(j) === " " || src.charAt(j) === "\t")) {
          if (src.charAt(j) === "\t") tb++; else sp++;
          j++;
        }
        var ch = j < n ? src.charAt(j) : "";
        var blank = (ch === "" || ch === "\n" || ch === "\r" || (ch === "/" && src.charAt(j + 1) === "/"));
        if (!blank) {
          if (sp && tb) return { toks: T, coms: coms, err: Err(line, 1, "this line indents with both tabs and spaces; pick one and use it everywhere") };
          if (sp || tb) {
            var mine = tb ? "tab" : "space";
            if (indentChar === null) { indentChar = mine; indentLine = line; }
            else if (indentChar !== mine) {
              return { toks: T, coms: coms, err: Err(line, 1, "this file indents with " + indentChar + "s (first seen on line " + indentLine + ") but line " + line + " indents with " + mine + "s") };
            }
          }
          var width = sp + tb;
          var top = stack[stack.length - 1];
          if (width > top) { stack.push(width); push("ind", null, i, j, line, 1); }
          else if (width < top) {
            while (stack.length > 1 && stack[stack.length - 1] > width) { stack.pop(); push("ded", null, i, j, line, 1); }
            if (stack[stack.length - 1] !== width) return { toks: T, coms: coms, err: Err(line, 1, "this line is indented to a level no open block uses") };
          }
        }
        i = j;
        atStart = false;
        if (blank) {
          /* a blank or comment-only line closes nothing and starts nothing */
          if (ch === "/" ) { var ce = i; while (ce < n && src.charAt(ce) !== "\n") ce++; coms.push({ s: i, e: ce }); i = ce; }
          while (i < n && src.charAt(i) !== "\n") i++;
          if (i < n) { i++; line++; lineStart = i; atStart = true; }
          continue;
        }
      }

      var c = src.charAt(i);
      if (c === " " || c === "\t" || c === "\r") { i++; continue; }

      if (c === "\n") {
        i++;
        if (depth === 0) { if (!lastWasNL) { push("nl", null, i - 1, i, line, col(i - 1)); lastWasNL = true; } atStart = true; }
        line++; lineStart = i;
        continue;
      }

      if (c === "/" && src.charAt(i + 1) === "/") {
        var k2 = i; while (k2 < n && src.charAt(k2) !== "\n") k2++;
        coms.push({ s: i, e: k2 });
        i = k2;
        continue;
      }

      lastWasNL = false;
      var s0 = i, c0 = col(i), l0 = line;

      if (isDigit(c) || (c === "." && isDigit(src.charAt(i + 1)))) {
        var seenDot = false, seenE = false;
        while (i < n) {
          var d = src.charAt(i);
          if (isDigit(d)) { i++; continue; }
          if (d === "." && !seenDot && !seenE) { seenDot = true; i++; continue; }
          if ((d === "e" || d === "E") && !seenE && i > s0) {
            var nx = src.charAt(i + 1);
            if (isDigit(nx) || ((nx === "+" || nx === "-") && isDigit(src.charAt(i + 2)))) { seenE = true; i += (nx === "+" || nx === "-") ? 2 : 1; continue; }
          }
          break;
        }
        push("num", parseFloat(src.slice(s0, i)), s0, i, l0, c0);
        continue;
      }

      if (isAlpha(c)) {
        while (i < n && isAlnum(src.charAt(i))) i++;
        push("id", src.slice(s0, i), s0, i, l0, c0);
        continue;
      }

      if (c === '"' || c === "'") {
        var q = c, out = "";
        i++;
        var closed = false;
        while (i < n) {
          var e1 = src.charAt(i);
          if (e1 === "\n") break;
          if (e1 === "\\") {
            var e2 = src.charAt(i + 1);
            out += e2 === "n" ? "\n" : e2 === "t" ? "\t" : e2 === "r" ? "\r" : e2 === "\\" ? "\\" : e2;
            i += 2; continue;
          }
          if (e1 === q) { i++; closed = true; break; }
          out += e1; i++;
        }
        if (!closed) return { toks: T, coms: coms, err: Err(l0, c0, "this string is never closed") };
        push("str", out, s0, i, l0, c0);
        continue;
      }

      var two = src.substr(i, 2), m, hit = null;
      for (m = 0; m < OPS2.length; m++) if (OPS2[m] === two) { hit = two; break; }
      if (hit) { i += 2; push("op", hit, s0, i, l0, c0); continue; }
      for (m = 0; m < OPS1.length; m++) if (OPS1[m] === c) { hit = c; break; }
      if (hit) { i += 1; push("op", hit, s0, i, l0, c0); continue; }
      for (m = 0; m < PUNC1.length; m++) if (PUNC1[m] === c) { hit = c; break; }
      if (hit) {
        if (c === "(" || c === "[") depth++;
        if (c === ")" || c === "]") depth--;
        if (depth < 0) return { toks: T, coms: coms, err: Err(l0, c0, "there is no opening bracket for this " + c) };
        i += 1; push("punc", hit, s0, i, l0, c0);
        continue;
      }
      if (c === "!") return { toks: T, coms: coms, err: Err(l0, c0, "'!' on its own is not an operator here — write not, or !=") };
      return { toks: T, coms: coms, err: Err(l0, c0, "this character has no meaning in DexScript: " + c) };
    }

    if (depth > 0) return { toks: T, coms: coms, err: Err(line, 1, "a bracket opened earlier is never closed") };
    if (!lastWasNL) push("nl", null, n, n, line, 1);
    while (stack.length > 1) { stack.pop(); push("ded", null, n, n, line, 1); }
    push("eof", null, n, n, line, 1);
    return { toks: T, coms: coms };
  }

  /* =====================================================================
     3 · PARSER
     Recursive descent for statements, precedence climbing for expressions.
     It throws an Err the moment something does not fit and compile() turns
     that into the one entry of the errors array — one clear message with the
     right line beats six guesses about what the author meant.
     ===================================================================== */

  function Parser(toks, src) {
    this.T = toks; this.p = 0; this.src = src;
  }
  Parser.prototype.cur = function () { return this.T[this.p]; };
  Parser.prototype.at = function (k, v) { var t = this.T[this.p]; return t.k === k && (v === undefined || t.v === v); };
  Parser.prototype.nth = function (d) { return this.T[this.p + d] || this.T[this.T.length - 1]; };
  Parser.prototype.next = function () { return this.T[this.p++]; };
  Parser.prototype.die = function (msg, t) { t = t || this.cur(); throw Err(t.line, t.col, msg); };
  Parser.prototype.eat = function (k, v, what) {
    if (!this.at(k, v)) {
      var t = this.cur();
      var got = t.k === "eof" ? "the end of the script" : t.k === "nl" ? "the end of the line" :
        t.k === "ind" ? "an indented block" : t.k === "ded" ? "the end of a block" : "'" + t.v + "'";
      this.die("expected " + (what || ("'" + v + "'")) + " but found " + got);
    }
    return this.next();
  };
  Parser.prototype.skipNL = function () { while (this.at("nl")) this.next(); };

  /* A block is either an indented run of statements or a single statement
     written on the same line, which is how an if and a for both read
     naturally when the body is a single statement. */
  Parser.prototype.block = function () {
    var out = [];
    if (this.at("nl")) {
      this.skipNL();
      if (!this.at("ind")) this.die("this line opens a block, so the next line must be indented");
      this.next();
      while (!this.at("ded") && !this.at("eof")) {
        this.skipNL();
        if (this.at("ded") || this.at("eof")) break;
        out.push(this.stmt());
      }
      if (this.at("ded")) this.next();
      if (!out.length) this.die("this block is empty");
      return out;
    }
    out.push(this.stmt());
    return out;
  };

  /* true when the identifier at p opens a function declaration rather than a
     call: the scan walks to the matching bracket and looks for the fat arrow
     past it. */
  Parser.prototype.isFnDecl = function () {
    if (!this.at("id") || !(this.nth(1).k === "punc" && this.nth(1).v === "(")) return false;
    var d = 0, k = this.p + 1;
    while (k < this.T.length) {
      var t = this.T[k];
      if (t.k === "eof") return false;
      if (t.k === "punc" && (t.v === "(" || t.v === "[")) d++;
      else if (t.k === "punc" && (t.v === ")" || t.v === "]")) { d--; if (!d) { var nx = this.T[k + 1]; return !!(nx && nx.k === "op" && nx.v === "=>"); } }
      k++;
    }
    return false;
  };

  Parser.prototype.program = function () {
    var out = [];
    while (!this.at("eof")) {
      this.skipNL();
      if (this.at("eof")) break;
      if (this.at("ind")) this.die("this line is indented but nothing above it opens a block");
      if (this.at("ded")) { this.next(); continue; }
      out.push(this.stmt());
    }
    return out;
  };

  Parser.prototype.stmt = function () {
    var t = this.cur(), ln = t.line, cl = t.col;

    if (t.k === "id") {
      if (t.v === "if") return this.ifStmt();
      if (t.v === "for") return this.forStmt();
      if (t.v === "while") { this.next(); var wc = this.expr(); var wb = this.block(); return { t: "while", cond: wc, body: wb, line: ln }; }
      if (t.v === "break") { this.next(); this.endLine(); return { t: "break", line: ln }; }
      if (t.v === "continue") { this.next(); this.endLine(); return { t: "continue", line: ln }; }
      if (t.v === "else") this.die("'else' has no 'if' above it at this indentation");
      if (t.v === "var") {
        this.next();
        var dt = null;
        if (this.at("id") && TYPEWORD[this.cur().v] && this.nth(1).k === "id") dt = this.next().v;
        if (!this.at("id")) this.die("'var' must be followed by a name");
        var vn = this.next();
        if (this.at("op", ":=")) this.die("a 'var' declaration uses '=', not ':='");
        this.eat("op", "=", "'=' after the name");
        var vi = this.expr();
        this.endLine();
        return { t: "decl", name: vn.v, isVar: true, dtype: dt, init: vi, line: ln, col: vn.col };
      }
      if (TYPEWORD[t.v] && this.nth(1).k === "id" && this.nth(2).k === "op" && this.nth(2).v === "=") {
        var ty = this.next().v, tn = this.next();
        this.next();
        var ti = this.expr();
        this.endLine();
        return { t: "decl", name: tn.v, isVar: false, dtype: ty, init: ti, line: ln, col: tn.col };
      }
      if (this.isFnDecl()) return this.fnStmt();
      if (this.nth(1).k === "op" && this.nth(1).v === ":=") {
        var an = this.next(); this.next();
        var ae = this.expr();
        this.endLine();
        return { t: "assign", name: an.v, expr: ae, line: ln, col: an.col };
      }
      if (this.nth(1).k === "op" && this.nth(1).v === "=") {
        var dn = this.next(); this.next();
        var di = this.expr();
        this.endLine();
        return { t: "decl", name: dn.v, isVar: false, dtype: null, init: di, line: ln, col: dn.col };
      }
    }

    /* a destructuring statement: [a, b, c] = ta.macd(close, 12, 26, 9) is the
       only way a multi-value builtin is read */
    if (t.k === "punc" && t.v === "[") {
      var save = this.p;
      var names = [], okTuple = true;
      this.next();
      while (!this.at("punc", "]")) {
        if (!this.at("id")) { okTuple = false; break; }
        names.push(this.next().v);
        if (this.at("punc", ",")) { this.next(); continue; }
        break;
      }
      if (okTuple && this.at("punc", "]") && this.nth(1).k === "op" && this.nth(1).v === "=" && names.length > 1) {
        this.next(); this.next();
        var tie = this.expr();
        this.endLine();
        return { t: "tuple", names: names, init: tie, line: ln, col: cl };
      }
      this.p = save;
    }

    var ex = this.expr();
    this.endLine();
    return { t: "expr", expr: ex, line: ln, col: cl };
  };

  Parser.prototype.endLine = function () {
    if (this.at("nl")) { this.next(); return; }
    if (this.at("eof") || this.at("ded")) return;
    this.die("this line does not end here — '" + String(this.cur().v) + "' was not expected");
  };

  Parser.prototype.ifStmt = function () {
    var ln = this.cur().line;
    this.next();
    var cond = this.expr();
    var body = this.block();
    var node = { t: "if", cond: cond, body: body, elifs: [], els: null, line: ln };
    for (; ;) {
      var save = this.p;
      this.skipNL();
      if (this.at("id", "else")) {
        this.next();
        if (this.at("id", "if")) {
          this.next();
          var c2 = this.expr(), b2 = this.block();
          node.elifs.push({ cond: c2, body: b2 });
          continue;
        }
        node.els = this.block();
        break;
      }
      this.p = save;
      break;
    }
    return node;
  };

  Parser.prototype.forStmt = function () {
    var ln = this.cur().line;
    this.next();
    if (!this.at("id")) this.die("'for' needs a counter name, as in: for i = 0 to 9");
    var name = this.next().v;
    this.eat("op", "=", "'=' after the counter name");
    var from = this.expr();
    if (!this.at("id", "to")) this.die("'for' needs 'to', as in: for i = 0 to 9");
    this.next();
    var to = this.expr();
    var by = null;
    if (this.at("id", "by")) { this.next(); by = this.expr(); }
    var body = this.block();
    return { t: "for", name: name, from: from, to: to, by: by, body: body, line: ln };
  };

  Parser.prototype.fnStmt = function () {
    var ln = this.cur().line;
    var name = this.next().v;
    this.eat("punc", "(");
    var params = [];
    while (!this.at("punc", ")")) {
      if (!this.at("id")) this.die("a parameter must be a plain name");
      params.push(this.next().v);
      if (this.at("punc", ",")) { this.next(); continue; }
      break;
    }
    this.eat("punc", ")");
    this.eat("op", "=>", "'=>' after the parameter list");
    var body;
    if (this.at("nl")) body = this.block();
    else { var e = this.expr(); this.endLine(); body = [{ t: "expr", expr: e, line: ln }]; }
    return { t: "fn", name: name, params: params, body: body, line: ln };
  };

  /* ------------------------------------------------------------ expressions */

  Parser.prototype.expr = function () { return this.ternary(); };

  Parser.prototype.ternary = function () {
    var c = this.orExpr();
    if (this.at("op", "?")) {
      var ln = this.cur().line;
      this.next();
      var a = this.ternary();
      this.eat("op", ":", "':' to close the '?'");
      var b = this.ternary();
      return { t: "tern", c: c, a: a, b: b, line: ln };
    }
    return c;
  };
  Parser.prototype.orExpr = function () {
    var a = this.andExpr();
    while (this.at("id", "or")) { var ln = this.next().line; a = { t: "bin", op: "or", a: a, b: this.andExpr(), line: ln }; }
    return a;
  };
  Parser.prototype.andExpr = function () {
    var a = this.eqExpr();
    while (this.at("id", "and")) { var ln = this.next().line; a = { t: "bin", op: "and", a: a, b: this.eqExpr(), line: ln }; }
    return a;
  };
  Parser.prototype.eqExpr = function () {
    var a = this.relExpr();
    while (this.at("op", "==") || this.at("op", "!=")) { var t = this.next(); a = { t: "bin", op: t.v, a: a, b: this.relExpr(), line: t.line }; }
    return a;
  };
  Parser.prototype.relExpr = function () {
    var a = this.addExpr();
    while (this.at("op", "<") || this.at("op", "<=") || this.at("op", ">") || this.at("op", ">=")) {
      var t = this.next(); a = { t: "bin", op: t.v, a: a, b: this.addExpr(), line: t.line };
    }
    return a;
  };
  Parser.prototype.addExpr = function () {
    var a = this.mulExpr();
    while (this.at("op", "+") || this.at("op", "-")) { var t = this.next(); a = { t: "bin", op: t.v, a: a, b: this.mulExpr(), line: t.line }; }
    return a;
  };
  Parser.prototype.mulExpr = function () {
    var a = this.unary();
    while (this.at("op", "*") || this.at("op", "/") || this.at("op", "%")) { var t = this.next(); a = { t: "bin", op: t.v, a: a, b: this.unary(), line: t.line }; }
    return a;
  };
  Parser.prototype.unary = function () {
    if (this.at("op", "-")) { var t = this.next(); return { t: "un", op: "-", a: this.unary(), line: t.line }; }
    if (this.at("op", "+")) { this.next(); return this.unary(); }
    if (this.at("id", "not")) { var t2 = this.next(); return { t: "un", op: "not", a: this.unary(), line: t2.line }; }
    return this.postfix();
  };

  Parser.prototype.postfix = function () {
    var a = this.primary();
    for (; ;) {
      if (this.at("punc", ".")) {
        var dt = this.next();
        if (!this.at("id")) this.die("'.' must be followed by a name");
        var pn = this.next();
        if (a.t !== "id" && a.t !== "member") this.die("'.' only reads a namespace such as ta, math, str, array or color", dt);
        a = { t: "member", base: a, prop: pn.v, line: pn.line, col: pn.col };
        continue;
      }
      if (this.at("punc", "(")) {
        var lp = this.next();
        var args = [], names = [];
        while (!this.at("punc", ")")) {
          if (this.at("eof")) this.die("this call is never closed", lp);
          var nm = null;
          if (this.at("id") && this.nth(1).k === "op" && this.nth(1).v === "=") { nm = this.next().v; this.next(); }
          names.push(nm);
          args.push(this.expr());
          if (this.at("punc", ",")) { this.next(); continue; }
          break;
        }
        this.eat("punc", ")", "')' to close the call");
        a = { t: "call", callee: a, args: args, names: names, line: lp.line, col: lp.col };
        continue;
      }
      if (this.at("punc", "[")) {
        var lb = this.next();
        var idx = this.expr();
        this.eat("punc", "]", "']' to close the history index");
        a = { t: "hist", base: a, n: idx, line: lb.line, col: lb.col };
        continue;
      }
      break;
    }
    return a;
  };

  Parser.prototype.primary = function () {
    var t = this.cur();
    if (t.k === "num") { this.next(); return { t: "num", v: t.v, line: t.line }; }
    if (t.k === "str") { this.next(); return { t: "str", v: t.v, line: t.line }; }
    if (t.k === "punc" && t.v === "(") {
      this.next();
      var e = this.expr();
      this.eat("punc", ")", "')' to close the group");
      return e;
    }
    if (t.k === "punc" && t.v === "[") {
      this.next();
      var items = [];
      while (!this.at("punc", "]")) {
        if (this.at("eof")) this.die("this list is never closed", t);
        items.push(this.expr());
        if (this.at("punc", ",")) { this.next(); continue; }
        break;
      }
      this.eat("punc", "]", "']' to close the list");
      return { t: "list", items: items, line: t.line };
    }
    if (t.k === "id") {
      if (t.v === "true" || t.v === "false") { this.next(); return { t: "bool", v: t.v === "true", line: t.line }; }
      this.next();
      return { t: "id", name: t.v, line: t.line, col: t.col };
    }
    if (t.k === "nl" || t.k === "eof") this.die("something was expected here but the line ends");
    this.die("'" + String(t.v) + "' cannot start an expression");
  };

  /* =====================================================================
     4 · RESOLVER
     One walk over the tree that does five jobs at once, because all five
     want the same traversal: it binds every name to a scope, hands a slot to
     everything that can be asked for history, gives each stateful call site
     its own state id, numbers the outputs so fill() can name two plots, and
     reads study()/strategy()/input.* off the tree so compile() can describe
     the script without running it.
     ===================================================================== */

  /* the series the host hands us, by the name a script types */
  var SERIES = {
    open: "o", high: "h", low: "l", close: "c", volume: "v",
    hl2: "hl2", hlc3: "hlc3", ohlc4: "ohlc4", hlcc4: "hlcc4", time: "t", bar_index: "i"
  };
  var CONSTS = {
    "na": 1, "true": 1, "false": 1, "last_bar_index": 1,
    "barstate.isfirst": 1, "barstate.islast": 1, "barstate.isrealtime": 1,
    "syminfo.ticker": 1, "syminfo.currency": 1, "syminfo.mintick": 1,
    "timeframe.period": 1, "timeframe.isintraday": 1, "timeframe.multiplier": 1,
    "math.pi": 1, "math.e": 1, "math.phi": 1,
    "strategy.position_size": 1, "strategy.equity": 1, "strategy.opentrades": 1
  };
  var NAMESPACE = { ta: 1, math: 1, str: 1, array: 1, color: 1, input: 1, request: 1, strategy: 1, barstate: 1, syminfo: 1, timeframe: 1 };
  /* Accepted spellings of two argument names. See the fold in the resolver for why
     the shipped library uses the aliases and imported Pine keeps the originals. */
  var ARG_ALIAS = { draw: "style", dash: "linestyle" };

  var OUTFN = {
    plot: 1, plotshape: 1, plotchar: 1, hline: 1, fill: 1, bgcolor: 1, barcolor: 1,
    label: 1, alertcondition: 1
  };

  function Scope(parent, fn) { this.v = {}; this.parent = parent; this.fn = fn || (parent ? parent.fn : null); }
  Scope.prototype.find = function (n) {
    var s = this;
    while (s) { if (has(s.v, n)) return s.v[n]; s = s.parent; }
    return null;
  };
  Scope.prototype.own = function (n) { return has(this.v, n) ? this.v[n] : null; };

  function Resolver(src) {
    this.slots = 0;        /* every history slot handed out                  */
    this.gslots = [];      /* the ones carried forward at the end of a bar   */
    this.states = 0;       /* stateful builtin call sites                    */
    this.outs = [];        /* output descriptors, in source order            */
    this.plots = 0;
    this.fns = {};         /* user functions by name                         */
    this.inputs = [];
    this.inputKeys = {};
    this.meta = { title: "DexScript", short: "", overlay: true, kind: "study", precision: 2, strat: null };
    this.sawDecl = false;
    this.warnings = [];
    this.security = [];    /* one precompute per request.security call site  */
    this.src = src;
  }
  Resolver.prototype.slot = function (carry) {
    if (this.slots >= LIM.slots) throw Err(0, 0, "this script asks for more than " + LIM.slots + " history slots");
    var s = this.slots++;
    if (carry) this.gslots.push(s);
    return s;
  };

  /* a member chain becomes one dotted name, which is how the tables are keyed */
  function dotted(node) {
    if (node.t === "id") return node.name;
    if (node.t === "member") { var b = dotted(node.base); return b === null ? null : b + "." + node.prop; }
    return null;
  }

  Resolver.prototype.run = function (prog) {
    var sc = new Scope(null, null), i;
    /* function names first, so a helper may be written below its first use */
    for (i = 0; i < prog.length; i++) if (prog[i].t === "fn") {
      if (this.fns[prog[i].name]) throw Err(prog[i].line, 1, "'" + prog[i].name + "' is declared twice as a function");
      if (SERIES[prog[i].name] || CONSTS[prog[i].name] || BI[prog[i].name] || NAMESPACE[prog[i].name]) {
        throw Err(prog[i].line, 1, "'" + prog[i].name + "' is a built-in name and cannot be redeclared");
      }
      this.fns[prog[i].name] = { params: prog[i].params, body: prog[i].body, node: prog[i] };
    }
    for (i = 0; i < prog.length; i++) this.stmt(prog[i], sc, true);
    if (this.plots > LIM.plots) throw Err(0, 0, "a script may draw at most " + LIM.plots + " plots");
    return this;
  };

  Resolver.prototype.guardName = function (n, line) {
    if (SERIES[n] || CONSTS[n]) throw Err(line, 1, "'" + n + "' is a built-in series or constant and cannot be assigned");
    if (BI[n] || NAMESPACE[n] || OUTFN[n]) throw Err(line, 1, "'" + n + "' is a built-in function and cannot be assigned");
    if (this.fns[n]) throw Err(line, 1, "'" + n + "' is a function in this script and cannot be assigned");
  };

  Resolver.prototype.stmt = function (s, sc, top) {
    var i;
    if (s.t === "fn") {
      var fsc = new Scope(null, s.name);
      for (i = 0; i < s.params.length; i++) fsc.v[s.params[i]] = { k: "l", name: s.params[i] };
      for (i = 0; i < s.body.length; i++) this.stmt(s.body[i], fsc, false);
      return;
    }
    if (s.t === "decl") {
      this.guardName(s.name, s.line);
      if (sc.own(s.name)) throw Err(s.line, s.col, "'" + s.name + "' is already declared on this level — use ':=' to give it a new value");
      var isInput = s.init && s.init.t === "call" && dotted(s.init.callee) && dotted(s.init.callee).indexOf("input") === 0;
      this.expr(s.init, sc, isInput ? s.name : null);
      if (s.isVar || top) {
        s.slot = this.slot(true);
        sc.v[s.name] = { k: "g", slot: s.slot, isVar: !!s.isVar };
      } else {
        sc.v[s.name] = { k: "l", name: s.name };
      }
      if (s.init && s.init.input) sc.v[s.name].input = s.init.input;
      s.ref = sc.v[s.name];
      if (s.isVar) s.vflag = this.states++;   /* one flag per var, reusing the state table */
      return;
    }
    if (s.t === "tuple") {
      if (s.init && s.init.t === "call") s.init.tupleOK = true;
      this.expr(s.init, sc, null);
      if (!(s.init.t === "call" && s.init.bi && s.init.bi.tup)) {
        throw Err(s.line, s.col, "only a multi-value builtin such as ta.macd can be read into [a, b, c]");
      }
      if (s.init.bi.tup !== s.names.length) {
        throw Err(s.line, s.col, s.init.bi.n + " returns " + s.init.bi.tup + " values but " + s.names.length + " names are listed");
      }
      s.refs = [];
      for (i = 0; i < s.names.length; i++) {
        this.guardName(s.names[i], s.line);
        if (sc.own(s.names[i])) throw Err(s.line, s.col, "'" + s.names[i] + "' is already declared on this level");
        if (top) { sc.v[s.names[i]] = { k: "g", slot: this.slot(true) }; }
        else sc.v[s.names[i]] = { k: "l", name: s.names[i] };
        s.refs.push(sc.v[s.names[i]]);
      }
      return;
    }
    if (s.t === "assign") {
      this.guardName(s.name, s.line);
      var r = sc.find(s.name);
      if (!r) throw Err(s.line, s.col, "'" + s.name + "' has no declaration above it — write '" + s.name + " = …' first");
      s.ref = r;
      this.expr(s.expr, sc, null);
      return;
    }
    if (s.t === "if") {
      this.expr(s.cond, sc, null);
      this.body(s.body, sc);
      for (i = 0; i < s.elifs.length; i++) { this.expr(s.elifs[i].cond, sc, null); this.body(s.elifs[i].body, sc); }
      if (s.els) this.body(s.els, sc);
      return;
    }
    if (s.t === "for") {
      this.expr(s.from, sc, null); this.expr(s.to, sc, null);
      if (s.by) this.expr(s.by, sc, null);
      this.guardName(s.name, s.line);
      var lsc = new Scope(sc);
      lsc.v[s.name] = { k: "l", name: s.name };
      this.body(s.body, lsc, true);
      return;
    }
    if (s.t === "while") { this.expr(s.cond, sc, null); this.body(s.body, sc); return; }
    if (s.t === "break" || s.t === "continue") return;
    if (s.t === "expr") { this.expr(s.expr, sc, null, true); return; }
  };

  Resolver.prototype.body = function (list, sc, reuse) {
    var inner = reuse ? sc : new Scope(sc), i;
    for (i = 0; i < list.length; i++) this.stmt(list[i], inner, false);
  };

  /* topCall marks an expression statement, which is the only place an output
     call or study()/strategy() is allowed to sit. */
  Resolver.prototype.expr = function (e, sc, inputKey, topCall) {
    if (!e) return;
    var i;
    if (e.t === "num" || e.t === "str" || e.t === "bool" || e.t === "const") return;
    if (e.t === "list") { for (i = 0; i < e.items.length; i++) this.expr(e.items[i], sc, null); return; }
    if (e.t === "un") { this.expr(e.a, sc, null); return; }
    if (e.t === "bin") { this.expr(e.a, sc, null); this.expr(e.b, sc, null); return; }
    if (e.t === "tern") { this.expr(e.c, sc, null); this.expr(e.a, sc, null); this.expr(e.b, sc, null); return; }
    if (e.t === "id") {
      var r = sc.find(e.name);
      if (r) { e.ref = r; return; }
      if (SERIES[e.name]) { e.ref = { k: "s", f: SERIES[e.name] }; return; }
      if (CONSTS[e.name]) { e.ref = { k: "c", name: e.name }; return; }
      if (this.fns[e.name]) { e.ref = { k: "fn", name: e.name }; return; }
      if (NAMESPACE[e.name] || BI[e.name] || OUTFN[e.name]) { e.ref = { k: "bi", name: e.name }; return; }
      throw Err(e.line, e.col, "there is nothing here called '" + e.name + "'");
    }
    if (e.t === "member") {
      var d = dotted(e);
      if (d === null) throw Err(e.line, e.col, "'.' only reads a namespace");
      if (CONSTS[d]) { e.t = "const"; e.name = d; return; }
      if (BI[d]) { e.ref = { k: "bi", name: d }; return; }
      var root = d.split(".")[0];
      if (!NAMESPACE[root]) throw Err(e.line, e.col, "there is no namespace called '" + root + "'");
      throw Err(e.line, e.col, "'" + d + "' is not part of the " + root + " library");
    }
    if (e.t === "hist") {
      this.expr(e.n, sc, null);
      var b = e.base;
      if (b.t === "id") {
        var br = sc.find(b.name);
        if (br) {
          if (br.k === "l") throw Err(e.line, e.col, "'" + b.name + "' is declared inside a block, so it keeps no history — declare it at the top level or with 'var'");
          b.ref = br; e.mode = "slot"; e.slot = br.slot; return;
        }
        if (SERIES[b.name]) { b.ref = { k: "s", f: SERIES[b.name] }; e.mode = "series"; e.f = SERIES[b.name]; return; }
      }
      this.expr(b, sc, null);
      e.mode = "expr";
      e.slot = this.slot(false);
      return;
    }
    if (e.t === "call") return this.call(e, sc, inputKey, topCall);
    throw Err(e.line || 0, 0, "this expression cannot be read");
  };

  Resolver.prototype.call = function (e, sc, inputKey, topCall) {
    var i, name = dotted(e.callee);
    /* a user function */
    if (name && this.fns[name] && !BI[name]) {
      var f = this.fns[name];
      if (e.args.length !== f.params.length) {
        throw Err(e.line, e.col, name + "() takes " + f.params.length + " argument" + (f.params.length === 1 ? "" : "s") + ", not " + e.args.length);
      }
      for (i = 0; i < e.names.length; i++) if (e.names[i]) throw Err(e.line, e.col, "a function written in this script takes positional arguments only");
      e.user = name;
      for (i = 0; i < e.args.length; i++) this.expr(e.args[i], sc, null);
      return;
    }
    if (name === "na" && e.args.length === 1) {   /* na(x) asks whether x is na */
      e.isna = true;
      this.expr(e.args[0], sc, null);
      return;
    }
    if (!name || !BI[name]) {
      if (name && NAMESPACE[name]) throw Err(e.line, e.col, "'" + name + "' is a namespace, not a function");
      throw Err(e.line, e.col, "there is no function called '" + (name || "that") + "'");
    }
    var bi = BI[name];
    e.bi = bi;
    e.fname = name;

    /* A variadic entry — math.max, str.format — takes its arguments as they
       were written and nothing below applies to it. */
    if (bi.vararg) {
      for (i = 0; i < e.names.length; i++) if (e.names[i]) throw Err(e.line, e.col, name + "() takes positional arguments only");
      if (e.args.length < bi.mn) throw Err(e.line, e.col, name + "() needs at least " + bi.mn + " argument" + (bi.mn === 1 ? "" : "s"));
      e.a = e.args.slice(); e.an = e.args.length;
      for (i = 0; i < e.a.length; i++) this.expr(e.a[i], sc, null);
      if (bi.st) e.sid = this.states++;
      return;
    }

    /* named arguments are folded into their positional home right here, so
       the interpreter never has to think about them again */
    var slotted = [], used = {};
    for (i = 0; i < e.args.length; i++) {
      var nm = e.names[i];
      if (nm === null) {
        if (i >= bi.p.length) throw Err(e.line, e.col, name + "() takes at most " + bi.p.length + " arguments");
        if (used[i]) throw Err(e.line, e.col, name + "() was given '" + bi.p[i] + "' twice");
        used[i] = 1; slotted[i] = e.args[i];
      } else {
        var at = -1, q;
        /* `draw=` and `dash=` are accepted spellings of `style=` and `linestyle=`.
           They exist for a reason that has nothing to do with the language: the build
           counts the byte sequence draw=" across the whole payload as an inline style
           attribute, and it cannot tell an HTML attribute from those five characters
           inside a script's source string. The shipped library is written with the
           aliases so it costs that ratchet nothing; style= and linestyle= keep working,
           because that is what a converted Pine script arrives spelling. */
        if (ARG_ALIAS[nm]) {
          var tgt = ARG_ALIAS[nm], hasOwn = false;
          for (q = 0; q < bi.p.length; q++) { if (bi.p[q] === nm) hasOwn = true; }
          if (!hasOwn) for (q = 0; q < bi.p.length; q++) if (bi.p[q] === tgt) { nm = tgt; break; }
        }
        for (q = 0; q < bi.p.length; q++) if (bi.p[q] === nm) { at = q; break; }
        if (at < 0) throw Err(e.line, e.col, name + "() has no argument called '" + nm + "'");
        if (used[at]) throw Err(e.line, e.col, name + "() was given '" + nm + "' twice");
        used[at] = 1; slotted[at] = e.args[i];
      }
    }
    var count = 0;
    for (i = 0; i < bi.p.length; i++) if (slotted[i]) count = i + 1;
    for (i = 0; i < bi.mn; i++) if (!slotted[i]) throw Err(e.line, e.col, name + "() needs '" + bi.p[i] + "'");
    e.a = slotted; e.an = count;

    if (bi.tup && !e.tupleOK) {
      throw Err(e.line, e.col, name + "() returns " + bi.tup + " values — read it into names, as in [a, b" + (bi.tup > 2 ? ", c" : "") + "] = " + name + "(…)");
    }

    /* study(), strategy() and the input.* family are read at compile time */
    if (name === "study" || name === "strategy") {
      if (!topCall) throw Err(e.line, e.col, name + "() must stand on its own line");
      this.declare(name, e);
      for (i = 0; i < slotted.length; i++) if (slotted[i]) this.expr(slotted[i], sc, null);
      return;
    }
    if (name.indexOf("input") === 0) { this.input(name, e, inputKey, sc); return; }
    if (name === "request.security") { this.secure(e, sc); return; }

    for (i = 0; i < slotted.length; i++) if (slotted[i]) this.expr(slotted[i], sc, null);

    if (OUTFN[name]) {
      if (!topCall) throw Err(e.line, e.col, name + "() draws, so it must stand on its own line");
      /* style, location and linestyle are nearly always written out, and a
         typo in one should be a red squiggle rather than a study that quietly
         stops drawing halfway through a run. */
      if (name === "plot") enumArg(e, slotted[4], PSTYLE, "plot style");
      if (name === "plotshape") { enumArg(e, slotted[2], SHAPES, "plotshape style"); enumArg(e, slotted[3], LOCS, "plotshape location"); }
      if (name === "plotchar") enumArg(e, slotted[3], LOCS, "plotchar location");
      if (name === "hline") enumArg(e, slotted[3], DASHES, "hline linestyle");
      e.oid = this.outs.length;
      var desc = { fn: name, line: e.line, node: e };
      if (name === "plot") { desc.pidx = this.plots++; }
      if (name === "plot" || name === "plotshape" || name === "plotchar" || name === "label") {
        if (this.outs.length >= LIM.plots) throw Err(e.line, e.col, "a script may draw at most " + LIM.plots + " plots");
      }
      if (name === "fill") {
        var A = slotted[0], Bx = slotted[1];
        if (!A || !Bx || A.t !== "num" || Bx.t !== "num") throw Err(e.line, e.col, "fill() names two plots by their number, as in fill(0, 1, …)");
        desc.a = A.v; desc.b = Bx.v;
      }
      this.outs.push(desc);
      return;
    }
    if (name.indexOf("strategy.") === 0) {
      if (this.meta.kind !== "strategy") throw Err(e.line, e.col, "strategy.* needs a strategy() declaration at the top of the script");
    }
    if (bi.st) e.sid = this.states++;
  };

  /* --- study() / strategy(), read statically so compile() can describe it -- */
  Resolver.prototype.lit = function (node, what, line) {
    if (!node) return undefined;
    if (node.t === "num") return node.v;
    if (node.t === "str") return node.v;
    if (node.t === "bool") return node.v;
    if (node.t === "id" && node.name === "true") return true;
    if (node.t === "id" && node.name === "false") return false;
    if (node.t === "un" && node.op === "-" && node.a.t === "num") return -node.a.v;
    if (node.t === "list") {
      var out = [], i;
      for (i = 0; i < node.items.length; i++) out.push(this.lit(node.items[i], what, line));
      return out;
    }
    throw Err(line, 1, what + " must be written out, not computed");
  };
  Resolver.prototype.declare = function (name, e) {
    if (this.sawDecl) throw Err(e.line, 1, "a script declares itself once — there is already a study() or strategy() above this");
    this.sawDecl = true;
    var a = e.a, L = e.line;
    this.meta.kind = name === "strategy" ? "strategy" : "study";
    var title = this.lit(a[0], "the title", L);
    if (typeof title !== "string" || !title) throw Err(L, 1, name + "() needs a title in quotes");
    this.meta.title = title;
    var sh = this.lit(a[1], "shorttitle", L);
    this.meta.short = typeof sh === "string" && sh ? sh : title.length > 14 ? title.slice(0, 14) : title;
    var ov = this.lit(a[2], "overlay", L);
    this.meta.overlay = ov === undefined ? (name === "strategy") : !!ov;
    var pr = this.lit(a[3], "precision", L);
    this.meta.precision = isNum(pr) ? Math.max(0, Math.min(8, Math.round(pr))) : 2;
    /* The engine reads a study result's range for a fixed pane scale
       (section 7 of 46-dexchart.js). Nothing in Pine spells that, so it is
       spelled here rather than inferred from the data. */
    var rlo = this.lit(a[name === "strategy" ? 9 : 4], "range_lo", L);
    var rhi = this.lit(a[name === "strategy" ? 10 : 5], "range_hi", L);
    if (isNum(rlo) && isNum(rhi) && rhi > rlo) this.meta.range = [rlo, rhi];
    if (name === "strategy") {
      this.meta.strat = {
        capital: num(this.lit(a[4], "initial_capital", L), 10000),
        commission: num(this.lit(a[5], "commission", L), 0),
        slippage: num(this.lit(a[6], "slippage", L), 0),
        pyramiding: Math.max(1, Math.round(num(this.lit(a[7], "pyramiding", L), 1))),
        qty: num(this.lit(a[8], "default_qty", L), 1)
      };
    }
  };
  function num(v, d) { return isNum(v) ? v : d; }

  /* --- input.*, likewise: the dialog is built from the tree, not from a run */
  Resolver.prototype.input = function (name, e, key, sc) {
    var L = e.line, a = e.a, kind = name === "input" ? "float" : name.slice(6);
    var title = this.lit(a[1], "the input title", L);
    var k = key || (typeof title === "string" && title ? title.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 16) : "in" + this.inputs.length);
    if (this.inputKeys[k]) k = k + "_" + this.inputs.length;
    this.inputKeys[k] = 1;
    var rec = { k: k, l: (typeof title === "string" && title) ? title : k, type: kind, d: null, opts: null, min: null, max: null, step: null };
    if (kind === "source") {
      var d0 = a[0];
      if (!d0 || d0.t !== "id" || !SERIES[d0.name]) throw Err(L, 1, "input.source() needs a built-in series such as close as its default");
      rec.d = d0.name; rec.opts = (KIT && KIT.SRC) ? KIT.SRC.slice() : ["close", "open", "high", "low", "hl2", "hlc3", "ohlc4"];
      if (rec.opts.indexOf(rec.d) < 0) rec.opts.unshift(rec.d);
    } else {
      var dv = this.lit(a[0], "the input default", L);
      if (kind === "bool") rec.d = !!dv;
      else if (kind === "string") { rec.d = String(dv); rec.opts = this.lit(a[2], "options", L) || null; }
      else if (kind === "color") {
        var hx = normHex(dv);
        if (!hx) throw Err(L, 1, "input.color() needs a colour written as \"#RRGGBB\"");
        rec.d = hx;
        rec.opts = PAL.concat(["#E7EDF8", "#7E8AB8"]);
        if (rec.opts.indexOf(hx) < 0) rec.opts = [hx].concat(rec.opts);
      } else {
        if (!isNum(dv)) throw Err(L, 1, name + "() needs a number as its default");
        rec.d = kind === "int" ? Math.round(dv) : dv;
        var mn = this.lit(a[2], "minval", L), mx = this.lit(a[3], "maxval", L), sp = this.lit(a[4], "step", L);
        if (isNum(mn)) rec.min = mn;
        if (isNum(mx)) rec.max = mx;
        rec.step = isNum(sp) ? sp : (kind === "int" ? 1 : 0.1);
      }
    }
    if (kind === "string" && rec.opts && rec.opts.length && rec.opts.indexOf(rec.d) < 0) {
      throw Err(L, 1, "the default \"" + rec.d + "\" is not one of the options listed");
    }
    e.input = rec;
    this.inputs.push(rec);
    var i;
    for (i = 0; i < e.a.length; i++) if (e.a[i] && !(kind === "source" && i === 0)) this.expr(e.a[i], sc, null);
    if (kind === "source") e.a[0].ref = { k: "s", f: SERIES[e.a[0].name] };
  };

  /* --- request.security: honest higher-timeframe aggregation, nothing more */
  Resolver.prototype.secure = function (e, sc) {
    var L = e.line, a = e.a;
    var sym = a[0], tf = a[1], ex = a[2];
    var symName = sym ? dotted(sym) : null;
    if (!sym || (sym.t !== "str" && symName !== "syminfo.ticker")) {
      throw Err(L, e.col, "request.security() can only read THIS symbol: pass syminfo.ticker or \"\". There is one series loaded and nothing here fetches a second one.");
    }
    if (sym.t === "str" && sym.v !== "") {
      throw Err(L, e.col, "request.security() can only read THIS symbol: pass syminfo.ticker or \"\", not \"" + sym.v + "\".");
    }
    if (!tf || tf.t !== "str") throw Err(L, e.col, "request.security() needs the timeframe written out, as in \"4h\"");
    if (!tfMs(tf.v)) throw Err(L, e.col, "\"" + tf.v + "\" is not a timeframe this engine knows — use 1m 3m 5m 15m 30m 1h 2h 4h 6h 12h 1d 3d 1w 1M");
    /* the expression is re-run over the aggregated bars, so it may only read
       what those bars carry: built-in series, constants, inputs and ta/math. */
    var binds = {};
    (function check(n) {
      if (!n) return;
      var q;
      if (n.t === "id") {
        if (SERIES[n.name]) return;
        var r = sc.find(n.name);
        if (r && r.input) { binds[n.name] = r.input; return; }
        throw Err(n.line, n.col, "request.security() re-runs its expression on the higher-timeframe bars, so it cannot read '" + n.name + "' — use built-in series, inputs and ta/math calls only");
      }
      if (n.t === "const") return;
      if (n.t === "member") {
        var dm = dotted(n);
        if (dm && CONSTS[dm]) return;
        throw Err(n.line, n.col, "'" + (dm || "that") + "' cannot be read inside request.security()");
      }
      if (n.t === "hist") { check(n.base); check(n.n); return; }
      if (n.t === "call") {
        var d = dotted(n.callee);
        if (!d || !BI[d] || (d.indexOf("ta.") !== 0 && d.indexOf("math.") !== 0)) {
          throw Err(n.line, n.col, "inside request.security() only ta.* and math.* calls are allowed");
        }
        for (q = 0; q < n.args.length; q++) check(n.args[q]);
        return;
      }
      if (n.t === "bin") { check(n.a); check(n.b); return; }
      if (n.t === "un") { check(n.a); return; }
      if (n.t === "tern") { check(n.c); check(n.a); check(n.b); return; }
      if (n.t === "num" || n.t === "str" || n.t === "bool") return;
      throw Err(n.line || L, 0, "this is more than request.security() can re-run on higher-timeframe bars");
    })(ex);
    /* resolve the sub-expression in a scope of its own so its call sites get
       state ids that belong to the aggregated pass, not to the chart pass */
    var subR = new Resolver(this.src);
    var ssc = new Scope(null, null), bn;
    for (bn in binds) if (has(binds, bn)) ssc.v[bn] = { k: "inp", rec: binds[bn] };
    subR.expr(ex, ssc, null);
    e.sec = { tf: tf.v, expr: ex, slots: subR.slots, states: subR.states };
    e.secid = this.security.length;
    this.security.push(e.sec);
  };

  function enumArg(e, node, table, what) {
    if (!node || node.t !== "str") return;
    if (!has(table, node.v)) {
      var keys = [], k;
      for (k in table) if (has(table, k)) keys.push(k);
      throw Err(node.line || e.line, e.col, what + " must be one of " + keys.join(" ") + " — \"" + node.v + "\" is not");
    }
  }

  var TFMS = { "1m": 60000, "3m": 180000, "5m": 300000, "15m": 900000, "30m": 1800000, "1h": 3600000, "2h": 7200000, "4h": 14400000, "6h": 21600000, "12h": 43200000, "1d": 86400000, "3d": 259200000, "1w": 604800000, "1M": 2592000000 };
  function tfMs(s) { return TFMS[s] || 0; }

  /* =====================================================================
     5 · THE STANDARD LIBRARY
     Every entry lives in one table. That table is the whole surface a script
     can reach: the interpreter never resolves a name against a host object,
     so there is nothing here to escape from.

     Everything in ta.* that carries state is written INCREMENTALLY and keyed
     to its own call site. None of it wraps DXC.kit.M, and the reason is the
     execution model rather than taste: M takes a finished array, and the
     source of a ta.* call inside a script is usually not finished — it is
     being produced one bar at a time by the same pass that is asking for the
     average. Rebuilding an array per bar to call M would turn every study
     into O(n²). The null-head convention is M's, so ta.ema in a script and
     the engine's own EMA agree bar for bar.
     ===================================================================== */

  var BI = {};
  function B(name, params, mn, fn, o) {
    o = o || {};
    BI[name] = {
      n: name, p: params, mn: mn, f: fn, st: !!o.st, tup: o.tup || 0, vararg: !!o.va,
      sig: o.sig || "", about: o.about || "", ns: name.indexOf(".") > 0 ? name.split(".")[0] : "global"
    };
  }

  function N(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  function L(v, d) { var n = N(v); return n == null ? d : Math.max(1, Math.round(n)); }
  function D(v, d) { var n = N(v); return n == null ? d : n; }
  function truthy(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return isFinite(v) && v !== 0;
    if (typeof v === "string") return v.length > 0;
    return true;
  }

  /* ------------------------------------------------- incremental primitives
     Each takes the call site's own state object, so two of the same formula
     in one script never share a window. */
  function ring(s, len) {
    if (s.rn !== len) { s.r = new Array(len); s.rn = len; s.ri = 0; s.rc = 0; s.sum = 0; }
  }
  function rpush(s, v) {
    if (s.rc === s.rn) s.sum -= s.r[s.ri];
    s.r[s.ri] = v; s.sum += v;
    s.ri = (s.ri + 1) % s.rn;
    if (s.rc < s.rn) s.rc++;
    return s.rc === s.rn;
  }
  function rget(s, k) { return s.r[((s.ri - 1 - k) % s.rn + s.rn) % s.rn]; }
  function sub(s, k) { return s[k] || (s[k] = {}); }

  function iSum(s, v, len) { ring(s, len); if (v == null) return null; return rpush(s, v) ? s.sum : null; }
  function iSma(s, v, len) { var t = iSum(s, v, len); return t == null ? null : t / len; }
  function iEma(s, v, len) {
    if (s.p !== len) { s.p = len; s.n = 0; s.acc = 0; s.e = null; }
    if (v == null) return null;
    if (s.n < len) {
      s.acc += v; s.n++;
      if (s.n === len) { s.e = s.acc / len; return s.e; }
      return null;
    }
    var k = 2 / (len + 1);
    s.e = v * k + s.e * (1 - k);
    return s.e;
  }
  function iRma(s, v, len) {
    if (s.p !== len) { s.p = len; s.n = 0; s.acc = 0; s.e = null; }
    if (v == null) return null;
    if (s.n < len) {
      s.acc += v; s.n++;
      if (s.n === len) { s.e = s.acc / len; return s.e; }
      return null;
    }
    s.e = (s.e * (len - 1) + v) / len;
    return s.e;
  }
  function iWma(s, v, len) {
    ring(s, len);
    if (v == null) return null;
    if (!rpush(s, v)) return null;
    var num = 0, den = len * (len + 1) / 2, k;
    for (k = 0; k < len; k++) num += rget(s, k) * (len - k);
    return num / den;
  }
  function iHighest(s, v, len) {
    ring(s, len);
    if (v == null) return null;
    if (!rpush(s, v)) return null;
    var m = -Infinity, k;
    for (k = 0; k < len; k++) if (rget(s, k) > m) m = rget(s, k);
    return m;
  }
  function iLowest(s, v, len) {
    ring(s, len);
    if (v == null) return null;
    if (!rpush(s, v)) return null;
    var m = Infinity, k;
    for (k = 0; k < len; k++) if (rget(s, k) < m) m = rget(s, k);
    return m;
  }
  /* population standard deviation, computed in two passes over the window so
     it lands on the same float the engine's own M.stdev does */
  function iStdev(s, v, len) {
    ring(s, len);
    if (v == null) return null;
    if (!rpush(s, v)) return null;
    var m = 0, q = 0, k;
    for (k = 0; k < len; k++) m += rget(s, k);
    m /= len;
    for (k = 0; k < len; k++) { var dd = rget(s, k) - m; q += dd * dd; }
    return Math.sqrt(q / len);
  }
  function sorted(s, len) {
    var a = [], k;
    for (k = 0; k < len; k++) a.push(rget(s, k));
    a.sort(function (x, y) { return x - y; });
    return a;
  }

  /* the bar the interpreter is standing on */
  function bar(R) { return R.bars[R.i]; }
  function srcOf(R, key) {
    var b = R.bars[R.i];
    if (!b) return null;
    return key === "o" ? b.o : key === "h" ? b.h : key === "l" ? b.l : key === "v" ? b.v :
      key === "t" ? b.t : key === "i" ? R.i :
        key === "hl2" ? (b.h + b.l) / 2 : key === "hlc3" ? (b.h + b.l + b.c) / 3 :
          key === "ohlc4" ? (b.o + b.h + b.l + b.c) / 4 : key === "hlcc4" ? (b.h + b.l + b.c + b.c) / 4 : b.c;
  }
  function srcAt(R, key, i) {
    var b = R.bars[i];
    if (!b) return null;
    return key === "o" ? b.o : key === "h" ? b.h : key === "l" ? b.l : key === "v" ? b.v :
      key === "t" ? b.t : key === "i" ? i :
        key === "hl2" ? (b.h + b.l) / 2 : key === "hlc3" ? (b.h + b.l + b.c) / 3 :
          key === "ohlc4" ? (b.o + b.h + b.l + b.c) / 4 : key === "hlcc4" ? (b.h + b.l + b.c + b.c) / 4 : b.c;
  }
  function trueRange(R) {
    var b = R.bars[R.i], p = R.i ? R.bars[R.i - 1] : null;
    if (!b) return null;
    if (!p) return b.h - b.l;
    return Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c));
  }

  /* ------------------------------------------------------------------ ta.* */

  B("ta.sma", ["source", "length"], 2, function (a, R, s) { return iSma(s, N(a[0]), L(a[1], 14)); },
    { st: 1, sig: "ta.sma(source, length) → series", about: "Simple moving average. na until the window has length real values." });
  B("ta.ema", ["source", "length"], 2, function (a, R, s) { return iEma(s, N(a[0]), L(a[1], 14)); },
    { st: 1, sig: "ta.ema(source, length) → series", about: "Exponential moving average, seeded with the simple average of the first length values." });
  B("ta.rma", ["source", "length"], 2, function (a, R, s) { return iRma(s, N(a[0]), L(a[1], 14)); },
    { st: 1, sig: "ta.rma(source, length) → series", about: "Wilder's smoothing — the average RSI, ATR and DMI are built on." });
  B("ta.smma", ["source", "length"], 2, function (a, R, s) { return iRma(s, N(a[0]), L(a[1], 14)); },
    { st: 1, sig: "ta.smma(source, length) → series", about: "Smoothed moving average; the same formula as ta.rma." });
  B("ta.wma", ["source", "length"], 2, function (a, R, s) { return iWma(s, N(a[0]), L(a[1], 14)); },
    { st: 1, sig: "ta.wma(source, length) → series", about: "Linearly weighted moving average — the newest bar weighs length, the oldest weighs one." });
  B("ta.hma", ["source", "length"], 2, function (a, R, s) {
    var len = L(a[1], 9), v = N(a[0]);
    var h = Math.max(1, Math.round(len / 2)), q = Math.max(1, Math.round(Math.sqrt(len)));
    var w1 = iWma(sub(s, "a"), v, h), w2 = iWma(sub(s, "b"), v, len);
    var raw = (w1 == null || w2 == null) ? null : 2 * w1 - w2;
    return iWma(sub(s, "c"), raw, q);
  }, { st: 1, sig: "ta.hma(source, length) → series", about: "Hull moving average: 2·WMA(length/2) − WMA(length), smoothed by WMA(√length)." });
  B("ta.swma", ["source"], 1, function (a, R, s) {
    ring(s, 4);
    var v = N(a[0]);
    if (v == null) return null;
    if (!rpush(s, v)) return null;
    return rget(s, 0) / 6 + rget(s, 1) * 2 / 6 + rget(s, 2) * 2 / 6 + rget(s, 3) / 6;
  }, { st: 1, sig: "ta.swma(source) → series", about: "Symmetrically weighted moving average over four bars, weights 1/2/2/1." });
  B("ta.vwma", ["source", "length"], 2, function (a, R, s) {
    var v = N(a[0]), len = L(a[1], 20), b = bar(R);
    if (v == null || !b) return null;
    var pv = sub(s, "pv"), vv = sub(s, "vv");
    var n1 = iSum(pv, v * b.v, len), d1 = iSum(vv, b.v, len);
    return (n1 == null || d1 == null || !d1) ? null : n1 / d1;
  }, { st: 1, sig: "ta.vwma(source, length) → series", about: "Volume-weighted moving average over length bars." });
  B("ta.vwap", ["source"], 0, function (a, R, s) {
    var b = bar(R);
    if (!b) return null;
    var v = a[0] === undefined ? (b.h + b.l + b.c) / 3 : N(a[0]);
    if (v == null) return null;
    var day = Math.floor(b.t / 86400000);
    if (s.day !== day) { s.day = day; s.pv = 0; s.vv = 0; }
    s.pv += v * b.v; s.vv += b.v;
    return s.vv ? s.pv / s.vv : null;
  }, { st: 1, sig: "ta.vwap(source) → series", about: "Volume-weighted average price, reset at each UTC day boundary. Defaults to hlc3." });
  B("ta.sum", ["source", "length"], 2, function (a, R, s) { return iSum(s, N(a[0]), L(a[1], 14)); },
    { st: 1, sig: "ta.sum(source, length) → series", about: "Rolling sum of the last length values." });
  B("ta.cum", ["source"], 1, function (a, R, s) {
    var v = N(a[0]);
    if (v == null) return s.c == null ? null : s.c;
    s.c = (s.c || 0) + v;
    return s.c;
  }, { st: 1, sig: "ta.cum(source) → series", about: "Running total of every value so far." });
  function shifted(s, v, len) {   /* newest and the value len bars back */
    ring(s, len + 1);
    if (v == null) return null;
    if (!rpush(s, v)) return null;
    return [rget(s, 0), rget(s, len)];
  }
  B("ta.change", ["source", "length"], 1, function (a, R, s) {
    var p = shifted(s, N(a[0]), L(a[1], 1));
    return p ? p[0] - p[1] : null;
  }, { st: 1, sig: "ta.change(source, length = 1) → series", about: "Difference between the source now and length bars ago." });
  B("ta.mom", ["source", "length"], 2, function (a, R, s) {
    var p = shifted(s, N(a[0]), L(a[1], 10));
    return p ? p[0] - p[1] : null;
  }, { st: 1, sig: "ta.mom(source, length) → series", about: "Momentum: source − source[length]." });
  B("ta.roc", ["source", "length"], 2, function (a, R, s) {
    var p = shifted(s, N(a[0]), L(a[1], 9));
    return (p && p[1]) ? (p[0] - p[1]) / p[1] * 100 : null;
  }, { st: 1, sig: "ta.roc(source, length) → series", about: "Rate of change, in percent." });
  B("ta.stdev", ["source", "length"], 2, function (a, R, s) { return iStdev(s, N(a[0]), L(a[1], 20)); },
    { st: 1, sig: "ta.stdev(source, length) → series", about: "Population standard deviation over the window." });
  B("ta.variance", ["source", "length"], 2, function (a, R, s) {
    var d = iStdev(s, N(a[0]), L(a[1], 20));
    return d == null ? null : d * d;
  }, { st: 1, sig: "ta.variance(source, length) → series", about: "Population variance over the window." });
  B("ta.dev", ["source", "length"], 2, function (a, R, s) {
    var len = L(a[1], 20), v = N(a[0]);
    ring(s, len);
    if (v == null || !rpush(s, v)) return null;
    var m = s.sum / len, q = 0, k;
    for (k = 0; k < len; k++) q += Math.abs(rget(s, k) - m);
    return q / len;
  }, { st: 1, sig: "ta.dev(source, length) → series", about: "Mean absolute deviation from the simple average — the denominator CCI uses." });
  B("ta.median", ["source", "length"], 2, function (a, R, s) {
    var len = L(a[1], 20), v = N(a[0]);
    ring(s, len);
    if (v == null || !rpush(s, v)) return null;
    var q = sorted(s, len), h = len >> 1;
    return len % 2 ? q[h] : (q[h - 1] + q[h]) / 2;
  }, { st: 1, sig: "ta.median(source, length) → series", about: "Median of the window; an even window averages the two middle values." });
  B("ta.mode", ["source", "length"], 2, function (a, R, s) {
    var len = L(a[1], 20), v = N(a[0]);
    ring(s, len);
    if (v == null || !rpush(s, v)) return null;
    var q = sorted(s, len), best = q[0], bn = 0, cur = q[0], cn = 0, k;
    for (k = 0; k < len; k++) {
      if (q[k] === cur) cn++; else { cur = q[k]; cn = 1; }
      if (cn > bn) { bn = cn; best = cur; }
    }
    return best;
  }, { st: 1, sig: "ta.mode(source, length) → series", about: "Most frequent value in the window; ties go to the smallest." });
  B("ta.percentile_linear_interpolation", ["source", "length", "percentage"], 3, function (a, R, s) {
    var len = L(a[1], 20), v = N(a[0]), p = D(a[2], 50);
    ring(s, len);
    if (v == null || !rpush(s, v)) return null;
    var q = sorted(s, len), r = Math.max(0, Math.min(1, p / 100)) * (len - 1);
    var lo = Math.floor(r), hi = Math.ceil(r);
    return lo === hi ? q[lo] : q[lo] + (q[hi] - q[lo]) * (r - lo);
  }, { st: 1, sig: "ta.percentile_linear_interpolation(source, length, percentage) → series", about: "Percentile of the window, interpolating between the two neighbouring ranks." });
  B("ta.percentrank", ["source", "length"], 2, function (a, R, s) {
    var len = L(a[1], 20), v = N(a[0]);
    ring(s, len + 1);
    if (v == null || !rpush(s, v)) return null;
    var now = rget(s, 0), c = 0, k;
    for (k = 1; k <= len; k++) if (rget(s, k) <= now) c++;
    return c / len * 100;
  }, { st: 1, sig: "ta.percentrank(source, length) → series", about: "Percent of the previous length values at or below the current one." });
  B("ta.highest", ["source", "length"], 1, function (a, R, s) {
    var v, len;
    if (a[1] === undefined) { len = L(a[0], 14); v = srcOf(R, "h"); } else { v = N(a[0]); len = L(a[1], 14); }
    return iHighest(s, v, len);
  }, { st: 1, sig: "ta.highest(source, length) → series", about: "Highest value of the window. With one argument it reads high." });
  B("ta.lowest", ["source", "length"], 1, function (a, R, s) {
    var v, len;
    if (a[1] === undefined) { len = L(a[0], 14); v = srcOf(R, "l"); } else { v = N(a[0]); len = L(a[1], 14); }
    return iLowest(s, v, len);
  }, { st: 1, sig: "ta.lowest(source, length) → series", about: "Lowest value of the window. With one argument it reads low." });
  B("ta.highestbars", ["source", "length"], 1, function (a, R, s) {
    var v, len;
    if (a[1] === undefined) { len = L(a[0], 14); v = srcOf(R, "h"); } else { v = N(a[0]); len = L(a[1], 14); }
    ring(s, len);
    if (v == null || !rpush(s, v)) return null;
    var m = -Infinity, at = 0, k;
    for (k = 0; k < len; k++) if (rget(s, k) > m) { m = rget(s, k); at = k; }
    return -at;
  }, { st: 1, sig: "ta.highestbars(source, length) → series", about: "How many bars back the highest value sits, as a number ≤ 0." });
  B("ta.lowestbars", ["source", "length"], 1, function (a, R, s) {
    var v, len;
    if (a[1] === undefined) { len = L(a[0], 14); v = srcOf(R, "l"); } else { v = N(a[0]); len = L(a[1], 14); }
    ring(s, len);
    if (v == null || !rpush(s, v)) return null;
    var m = Infinity, at = 0, k;
    for (k = 0; k < len; k++) if (rget(s, k) < m) { m = rget(s, k); at = k; }
    return -at;
  }, { st: 1, sig: "ta.lowestbars(source, length) → series", about: "How many bars back the lowest value sits, as a number ≤ 0." });
  B("ta.rising", ["source", "length"], 2, function (a, R, s) {
    var len = L(a[1], 3), v = N(a[0]);
    ring(s, len + 1);
    if (v == null || !rpush(s, v)) return false;
    var k;
    for (k = 0; k < len; k++) if (!(rget(s, k) > rget(s, k + 1))) return false;
    return true;
  }, { st: 1, sig: "ta.rising(source, length) → series", about: "True when the source rose on each of the last length bars." });
  B("ta.falling", ["source", "length"], 2, function (a, R, s) {
    var len = L(a[1], 3), v = N(a[0]);
    ring(s, len + 1);
    if (v == null || !rpush(s, v)) return false;
    var k;
    for (k = 0; k < len; k++) if (!(rget(s, k) < rget(s, k + 1))) return false;
    return true;
  }, { st: 1, sig: "ta.falling(source, length) → series", about: "True when the source fell on each of the last length bars." });
  function crossState(s, x, y) {
    var pa = s.pa, pb = s.pb;
    s.pa = x; s.pb = y;
    if (pa == null || pb == null || x == null || y == null) return 0;
    if (pa <= pb && x > y) return 1;
    if (pa >= pb && x < y) return -1;
    return 0;
  }
  B("ta.crossover", ["source1", "source2"], 2, function (a, R, s) { return crossState(s, N(a[0]), N(a[1])) === 1; },
    { st: 1, sig: "ta.crossover(source1, source2) → series", about: "True on the bar the first series crosses above the second." });
  B("ta.crossunder", ["source1", "source2"], 2, function (a, R, s) { return crossState(s, N(a[0]), N(a[1])) === -1; },
    { st: 1, sig: "ta.crossunder(source1, source2) → series", about: "True on the bar the first series crosses below the second." });
  B("ta.cross", ["source1", "source2"], 2, function (a, R, s) { return crossState(s, N(a[0]), N(a[1])) !== 0; },
    { st: 1, sig: "ta.cross(source1, source2) → series", about: "True on the bar the two series cross, either way." });
  B("ta.barssince", ["condition"], 1, function (a, R, s) {
    if (truthy(a[0])) { s.n = 0; return 0; }
    if (s.n == null) return null;
    s.n++;
    return s.n;
  }, { st: 1, sig: "ta.barssince(condition) → series", about: "Bars since the condition was last true; na until it has been true once." });
  B("ta.valuewhen", ["condition", "source", "occurrence"], 2, function (a, R, s) {
    if (!s.b) s.b = [];
    if (truthy(a[0])) { s.b.unshift(a[1] === undefined ? null : a[1]); if (s.b.length > 256) s.b.pop(); }
    var o = Math.max(0, Math.round(D(a[2], 0)));
    return o < s.b.length ? s.b[o] : null;
  }, { st: 1, sig: "ta.valuewhen(condition, source, occurrence = 0) → series", about: "The source as it stood the nth most recent time the condition was true." });
  /* A turn is strict on the right and permissive on the left: a candidate has
     to beat every bar that came after it, but only match the ones before. A
     double top of two equal highs is a real pivot on a real chart, and the
     later of the two is the bar the turn actually happened on; demanding a
     strict inequality on both sides throws all of those away. */
  function pivot(s, v, left, right, hi) {
    var w = left + right + 1;
    ring(s, w);
    if (v == null || !rpush(s, v)) return null;
    var c = rget(s, right), k;
    for (k = 0; k < w; k++) {
      if (k === right) continue;
      var x = rget(s, k), strict = k < right;
      if (hi ? (strict ? !(c > x) : !(c >= x)) : (strict ? !(c < x) : !(c <= x))) return null;
    }
    return c;
  }
  B("ta.pivothigh", ["source", "leftbars", "rightbars"], 2, function (a, R, s) {
    if (a[2] === undefined) return pivot(s, srcOf(R, "h"), L(a[0], 3), L(a[1], 3), true);
    return pivot(s, N(a[0]), L(a[1], 3), L(a[2], 3), true);
  }, { st: 1, sig: "ta.pivothigh(source, leftbars, rightbars) → series", about: "The pivot high, returned rightbars later when it is confirmed. Two arguments read high." });
  B("ta.pivotlow", ["source", "leftbars", "rightbars"], 2, function (a, R, s) {
    if (a[2] === undefined) return pivot(s, srcOf(R, "l"), L(a[0], 3), L(a[1], 3), false);
    return pivot(s, N(a[0]), L(a[1], 3), L(a[2], 3), false);
  }, { st: 1, sig: "ta.pivotlow(source, leftbars, rightbars) → series", about: "The pivot low, returned rightbars later when it is confirmed. Two arguments read low." });

  function rsiOf(s, v, len) {
    if (v == null) return null;
    var d = s.prev == null ? 0 : v - s.prev;
    s.prev = v;
    var g = iRma(sub(s, "g"), d > 0 ? d : 0, len);
    var l = iRma(sub(s, "l"), d < 0 ? -d : 0, len);
    if (g == null || l == null) return null;
    return l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  B("ta.rsi", ["source", "length"], 2, function (a, R, s) { return rsiOf(s, N(a[0]), L(a[1], 14)); },
    { st: 1, sig: "ta.rsi(source, length) → series", about: "Relative Strength Index on Wilder's smoothing, seeded exactly as the engine's own RSI is." });
  B("ta.stoch", ["source", "high", "low", "length"], 4, function (a, R, s) {
    var v = N(a[0]), len = L(a[3], 14);
    var hi = iHighest(sub(s, "h"), N(a[1]), len), lo = iLowest(sub(s, "l"), N(a[2]), len);
    if (v == null || hi == null || lo == null || hi === lo) return null;
    return 100 * (v - lo) / (hi - lo);
  }, { st: 1, sig: "ta.stoch(source, high, low, length) → series", about: "Raw stochastic %K of the source inside the high/low range." });
  B("ta.stochrsi", ["source", "rsilength", "stochlength"], 2, function (a, R, s) {
    var r = rsiOf(sub(s, "r"), N(a[0]), L(a[1], 14)), len = L(a[2], 14);
    var hi = iHighest(sub(s, "h"), r, len), lo = iLowest(sub(s, "l"), r, len);
    if (r == null || hi == null || lo == null || hi === lo) return null;
    return 100 * (r - lo) / (hi - lo);
  }, { st: 1, sig: "ta.stochrsi(source, rsilength, stochlength) → series", about: "Stochastic of the RSI — where the RSI sits inside its own recent range." });
  B("ta.macd", ["source", "fastlen", "slowlen", "siglen"], 4, function (a, R, s) {
    var v = N(a[0]);
    var f = iEma(sub(s, "f"), v, L(a[1], 12)), q = iEma(sub(s, "s"), v, L(a[2], 26));
    var m = (f == null || q == null) ? null : f - q;
    var sg = iEma(sub(s, "g"), m, L(a[3], 9));
    return [m, sg, (m == null || sg == null) ? null : m - sg];
  }, { st: 1, tup: 3, sig: "[macd, signal, hist] = ta.macd(source, fastlen, slowlen, siglen)", about: "Moving Average Convergence Divergence. Read into three names." });
  B("ta.tr", ["handle_na"], 0, function (a, R) { return trueRange(R); },
    { sig: "ta.tr() → series", about: "True range of this bar: the widest of high−low, |high−previous close| and |low−previous close|." });
  B("ta.atr", ["length"], 1, function (a, R, s) { return iRma(s, trueRange(R), L(a[0], 14)); },
    { st: 1, sig: "ta.atr(length) → series", about: "Average True Range on Wilder's smoothing." });
  B("ta.atr_percent", ["length"], 1, function (a, R, s) {
    var v = iRma(s, trueRange(R), L(a[0], 14)), b = bar(R);
    return (v == null || !b || !b.c) ? null : v / b.c * 100;
  }, { st: 1, sig: "ta.atr_percent(length) → series", about: "ATR as a percentage of the close — volatility you can compare across symbols." });
  B("ta.range", ["length"], 1, function (a, R, s) {
    var len = L(a[0], 14);
    var hi = iHighest(sub(s, "h"), srcOf(R, "h"), len), lo = iLowest(sub(s, "l"), srcOf(R, "l"), len);
    return (hi == null || lo == null) ? null : hi - lo;
  }, { st: 1, sig: "ta.range(length) → series", about: "Highest high minus lowest low over the window." });
  B("ta.bb", ["source", "length", "mult"], 3, function (a, R, s) {
    var v = N(a[0]), len = L(a[1], 20), m = D(a[2], 2);
    var mid = iSma(sub(s, "m"), v, len), sd = iStdev(sub(s, "d"), v, len);
    if (mid == null || sd == null) return [null, null, null];
    return [mid, mid + m * sd, mid - m * sd];
  }, { st: 1, tup: 3, sig: "[basis, upper, lower] = ta.bb(source, length, mult)", about: "Bollinger Bands around a simple average." });
  B("ta.bbw", ["source", "length", "mult"], 3, function (a, R, s) {
    var v = N(a[0]), len = L(a[1], 20), m = D(a[2], 2);
    var mid = iSma(sub(s, "m"), v, len), sd = iStdev(sub(s, "d"), v, len);
    return (mid == null || sd == null || !mid) ? null : 2 * m * sd / mid;
  }, { st: 1, sig: "ta.bbw(source, length, mult) → series", about: "Bollinger band width as a fraction of the basis." });
  function kcParts(s, R, v, len, m, useTR) {
    var mid = iEma(sub(s, "m"), v, len);
    var rng = useTR ? trueRange(R) : (bar(R) ? bar(R).h - bar(R).l : null);
    var rv = iEma(sub(s, "r"), rng, len);
    return (mid == null || rv == null) ? null : [mid, mid + m * rv, mid - m * rv];
  }
  B("ta.kc", ["source", "length", "mult", "useTrueRange"], 3, function (a, R, s) {
    var p = kcParts(s, R, N(a[0]), L(a[1], 20), D(a[2], 2), a[3] === undefined ? true : truthy(a[3]));
    return p || [null, null, null];
  }, { st: 1, tup: 3, sig: "[basis, upper, lower] = ta.kc(source, length, mult, useTrueRange = true)", about: "Keltner Channels around an exponential average." });
  B("ta.kcw", ["source", "length", "mult", "useTrueRange"], 3, function (a, R, s) {
    var p = kcParts(s, R, N(a[0]), L(a[1], 20), D(a[2], 2), a[3] === undefined ? true : truthy(a[3]));
    return (!p || !p[0]) ? null : (p[1] - p[2]) / p[0];
  }, { st: 1, sig: "ta.kcw(source, length, mult, useTrueRange = true) → series", about: "Keltner channel width as a fraction of the basis." });
  function dmiParts(s, R, len, alen) {
    var b = bar(R), p = R.i ? R.bars[R.i - 1] : null;
    if (!b) return null;
    var up = p ? b.h - p.h : 0, dn = p ? p.l - b.l : 0;
    var pdm = (up > dn && up > 0) ? up : 0, ndm = (dn > up && dn > 0) ? dn : 0;
    var tr = iRma(sub(s, "t"), trueRange(R), len);
    var sp = iRma(sub(s, "p"), pdm, len), sn = iRma(sub(s, "n"), ndm, len);
    if (tr == null || sp == null || sn == null || !tr) return null;
    var pdi = 100 * sp / tr, ndi = 100 * sn / tr, sum = pdi + ndi;
    var dx = sum ? 100 * Math.abs(pdi - ndi) / sum : 0;
    var adx = iRma(sub(s, "a"), dx, alen);
    return [pdi, ndi, adx];
  }
  B("ta.dmi", ["diLength", "adxSmoothing"], 2, function (a, R, s) {
    return dmiParts(s, R, L(a[0], 14), L(a[1], 14)) || [null, null, null];
  }, { st: 1, tup: 3, sig: "[plusDI, minusDI, adx] = ta.dmi(diLength, adxSmoothing)", about: "Directional Movement: the two directional indicators and the trend strength built from them." });
  B("ta.adx", ["diLength", "adxSmoothing"], 1, function (a, R, s) {
    var p = dmiParts(s, R, L(a[0], 14), L(a[1], L(a[0], 14)));
    return p ? p[2] : null;
  }, { st: 1, sig: "ta.adx(diLength, adxSmoothing) → series", about: "Average Directional Index on its own." });
  B("ta.cci", ["source", "length"], 2, function (a, R, s) {
    var v = N(a[0]), len = L(a[1], 20);
    ring(s, len);
    if (v == null || !rpush(s, v)) return null;
    var m = s.sum / len, q = 0, k;
    for (k = 0; k < len; k++) q += Math.abs(rget(s, k) - m);
    q /= len;
    return q ? (v - m) / (0.015 * q) : 0;
  }, { st: 1, sig: "ta.cci(source, length) → series", about: "Commodity Channel Index: distance from the average in mean-deviation units." });
  B("ta.mfi", ["source", "length"], 2, function (a, R, s) {
    var v = N(a[0]), len = L(a[1], 14), b = bar(R);
    if (v == null || !b) return null;
    var pos = 0, neg = 0;
    if (s.prev != null) { if (v > s.prev) pos = v * b.v; else if (v < s.prev) neg = v * b.v; }
    s.prev = v;
    var P = iSum(sub(s, "p"), pos, len), Ng = iSum(sub(s, "n"), neg, len);
    if (P == null || Ng == null) return null;
    if (Ng === 0) return 100;
    return 100 - 100 / (1 + P / Ng);
  }, { st: 1, sig: "ta.mfi(source, length) → series", about: "Money Flow Index — an RSI weighted by volume." });
  B("ta.obv", [], 0, function (a, R, s) {
    var b = bar(R);
    if (!b) return null;
    if (s.c == null) { s.c = 0; s.prev = b.c; return 0; }
    s.c += b.c > s.prev ? b.v : b.c < s.prev ? -b.v : 0;
    s.prev = b.c;
    return s.c;
  }, { st: 1, sig: "ta.obv() → series", about: "On-Balance Volume: volume added on an up close and taken off on a down close." });
  B("ta.accdist", [], 0, function (a, R, s) {
    var b = bar(R);
    if (!b) return null;
    var rg = b.h - b.l;
    var mfm = rg ? ((b.c - b.l) - (b.h - b.c)) / rg : 0;
    s.c = (s.c || 0) + mfm * b.v;
    return s.c;
  }, { st: 1, sig: "ta.accdist() → series", about: "Accumulation/Distribution line from where each bar closed inside its range." });
  B("ta.cmo", ["source", "length"], 2, function (a, R, s) {
    var v = N(a[0]), len = L(a[1], 9);
    if (v == null) return null;
    var d = s.prev == null ? 0 : v - s.prev;
    s.prev = v;
    var u = iSum(sub(s, "u"), d > 0 ? d : 0, len), dw = iSum(sub(s, "d"), d < 0 ? -d : 0, len);
    if (u == null || dw == null) return null;
    return (u + dw) ? 100 * (u - dw) / (u + dw) : 0;
  }, { st: 1, sig: "ta.cmo(source, length) → series", about: "Chande Momentum Oscillator: up moves against down moves over the window." });
  B("ta.tsi", ["source", "short_length", "long_length"], 3, function (a, R, s) {
    var v = N(a[0]), sl = L(a[1], 13), ll = L(a[2], 25);
    if (v == null) return null;
    var d = s.prev == null ? 0 : v - s.prev;
    s.prev = v;
    var n1 = iEma(sub(s, "a"), d, ll), n2 = iEma(sub(s, "b"), n1, sl);
    var d1 = iEma(sub(s, "c"), Math.abs(d), ll), d2 = iEma(sub(s, "d"), d1, sl);
    return (n2 == null || d2 == null || !d2) ? null : 100 * n2 / d2;
  }, { st: 1, sig: "ta.tsi(source, short_length, long_length) → series", about: "True Strength Index: doubly smoothed momentum over doubly smoothed absolute momentum." });
  B("ta.wpr", ["length"], 1, function (a, R, s) {
    var len = L(a[0], 14), b = bar(R);
    var hi = iHighest(sub(s, "h"), srcOf(R, "h"), len), lo = iLowest(sub(s, "l"), srcOf(R, "l"), len);
    if (!b || hi == null || lo == null || hi === lo) return null;
    return -100 * (hi - b.c) / (hi - lo);
  }, { st: 1, sig: "ta.wpr(length) → series", about: "Williams %R: where the close sits in the window's range, on a −100…0 scale." });
  B("ta.sar", ["start", "inc", "max"], 0, function (a, R, s) {
    var st0 = D(a[0], 0.02), inc = D(a[1], 0.02), mx = D(a[2], 0.2), b = bar(R);
    if (!b) return null;
    if (s.sar == null) { s.sar = b.l; s.ep = b.h; s.af = st0; s.long = true; s.ph = b.h; s.pl = b.l; return null; }
    var sar = s.sar + s.af * (s.ep - s.sar);
    if (s.long) {
      sar = Math.min(sar, s.pl, b.l);
      if (b.l < sar) { s.long = false; sar = s.ep; s.ep = b.l; s.af = st0; }
      else if (b.h > s.ep) { s.ep = b.h; s.af = Math.min(mx, s.af + inc); }
    } else {
      sar = Math.max(sar, s.ph, b.h);
      if (b.h > sar) { s.long = true; sar = s.ep; s.ep = b.h; s.af = st0; }
      else if (b.l < s.ep) { s.ep = b.l; s.af = Math.min(mx, s.af + inc); }
    }
    s.sar = sar; s.ph = b.h; s.pl = b.l;
    return sar;
  }, { st: 1, sig: "ta.sar(start, inc, max) → series", about: "Parabolic SAR. na on the first bar, where there is no prior extreme to accelerate from." });
  B("ta.supertrend", ["factor", "atrPeriod"], 2, function (a, R, s) {
    var f = D(a[0], 3), len = L(a[1], 10), b = bar(R);
    var atr = iRma(sub(s, "a"), trueRange(R), len);
    if (!b || atr == null) return [null, null];
    var mid = (b.h + b.l) / 2, up = mid + f * atr, dn = mid - f * atr;
    var pc = s.pc;
    var lower = (s.lower == null || pc == null) ? dn : (dn > s.lower || pc < s.lower ? dn : s.lower);
    var upper = (s.upper == null || pc == null) ? up : (up < s.upper || pc > s.upper ? up : s.upper);
    var dir;
    if (s.dir == null) dir = 1;
    else if (s.st === s.upper) dir = b.c > upper ? -1 : 1;
    else dir = b.c < lower ? 1 : -1;
    var st = dir === -1 ? lower : upper;
    s.lower = lower; s.upper = upper; s.dir = dir; s.st = st; s.pc = b.c;
    return [st, dir];
  }, { st: 1, tup: 2, sig: "[supertrend, direction] = ta.supertrend(factor, atrPeriod)", about: "SuperTrend line and its direction: −1 while the trend is up, 1 while it is down." });
  B("ta.linreg", ["source", "length", "offset"], 2, function (a, R, s) {
    var v = N(a[0]), len = L(a[1], 14), off = D(a[2], 0);
    ring(s, len);
    if (v == null || !rpush(s, v)) return null;
    var sx = 0, sy = 0, sxy = 0, sxx = 0, k;
    for (k = 0; k < len; k++) {
      var xx = len - 1 - k, yy = rget(s, k);
      sx += xx; sy += yy; sxy += xx * yy; sxx += xx * xx;
    }
    var den = len * sxx - sx * sx;
    var m = den ? (len * sxy - sx * sy) / den : 0;
    var c = (sy - m * sx) / len;
    return m * (len - 1 - off) + c;
  }, { st: 1, sig: "ta.linreg(source, length, offset = 0) → series", about: "Value of the least-squares line fitted to the window, at the offset given." });
  B("ta.correlation", ["source1", "source2", "length"], 3, function (a, R, s) {
    var x = N(a[0]), y = N(a[1]), len = L(a[2], 20);
    var sx = sub(s, "x"), sy = sub(s, "y");
    ring(sx, len); ring(sy, len);
    if (x == null || y == null) return null;
    var f1 = rpush(sx, x), f2 = rpush(sy, y);
    if (!f1 || !f2) return null;
    var mx = sx.sum / len, my = sy.sum / len, num = 0, dx = 0, dy = 0, k;
    for (k = 0; k < len; k++) {
      var ax = rget(sx, k) - mx, ay = rget(sy, k) - my;
      num += ax * ay; dx += ax * ax; dy += ay * ay;
    }
    return (dx && dy) ? num / Math.sqrt(dx * dy) : null;
  }, { st: 1, sig: "ta.correlation(source1, source2, length) → series", about: "Pearson correlation of two series over the window." });
  B("ta.alma", ["source", "length", "offset", "sigma"], 2, function (a, R, s) {
    var v = N(a[0]), len = L(a[1], 21), off = D(a[2], 0.85), sg = D(a[3], 6);
    ring(s, len);
    if (v == null || !rpush(s, v)) return null;
    var m = off * (len - 1), q = len / sg, num = 0, den = 0, k;
    for (k = 0; k < len; k++) {
      var j = len - 1 - k, w = Math.exp(-((j - m) * (j - m)) / (2 * q * q));
      num += rget(s, k) * w; den += w;
    }
    return den ? num / den : null;
  }, { st: 1, sig: "ta.alma(source, length, offset = 0.85, sigma = 6) → series", about: "Arnaud Legoux moving average — a Gaussian window shifted towards the newest bars." });
  B("ta.kama", ["source", "length", "fastLength", "slowLength"], 2, function (a, R, s) {
    var v = N(a[0]), len = L(a[1], 10), f = L(a[2], 2), sl = L(a[3], 30);
    ring(s, len + 1);
    if (v == null) return null;
    var prev = s.rc ? rget(s, 0) : null;
    if (!rpush(s, v)) return null;
    var chg = Math.abs(rget(s, 0) - rget(s, len)), vol = 0, k;
    for (k = 0; k < len; k++) vol += Math.abs(rget(s, k) - rget(s, k + 1));
    var er = vol ? chg / vol : 0;
    var fsc = 2 / (f + 1), ssc = 2 / (sl + 1);
    var sc = Math.pow(er * (fsc - ssc) + ssc, 2);
    s.e = s.e == null ? v : s.e + sc * (v - s.e);
    return s.e;
  }, { st: 1, sig: "ta.kama(source, length, fastLength = 2, slowLength = 30) → series", about: "Kaufman's adaptive moving average: fast in a trend, slow in noise." });
  B("ta.dema", ["source", "length"], 2, function (a, R, s) {
    var v = N(a[0]), len = L(a[1], 20);
    var e1 = iEma(sub(s, "a"), v, len), e2 = iEma(sub(s, "b"), e1, len);
    return (e1 == null || e2 == null) ? null : 2 * e1 - e2;
  }, { st: 1, sig: "ta.dema(source, length) → series", about: "Double exponential moving average." });
  B("ta.tema", ["source", "length"], 2, function (a, R, s) {
    var v = N(a[0]), len = L(a[1], 20);
    var e1 = iEma(sub(s, "a"), v, len), e2 = iEma(sub(s, "b"), e1, len), e3 = iEma(sub(s, "c"), e2, len);
    return (e1 == null || e2 == null || e3 == null) ? null : 3 * e1 - 3 * e2 + e3;
  }, { st: 1, sig: "ta.tema(source, length) → series", about: "Triple exponential moving average." });
  B("ta.zlema", ["source", "length"], 2, function (a, R, s) {
    var v = N(a[0]), len = L(a[1], 20), lag = Math.floor((len - 1) / 2);
    var p = shifted(sub(s, "s"), v, lag || 1);
    var adj = p ? p[0] + (p[0] - p[1]) : null;
    return iEma(sub(s, "e"), adj, len);
  }, { st: 1, sig: "ta.zlema(source, length) → series", about: "Zero-lag EMA: the source pushed forward by half its window before smoothing." });
  B("ta.trix", ["source", "length"], 2, function (a, R, s) {
    var v = N(a[0]), len = L(a[1], 18);
    var e1 = iEma(sub(s, "a"), v == null ? null : Math.log(Math.max(1e-12, v)), len);
    var e2 = iEma(sub(s, "b"), e1, len), e3 = iEma(sub(s, "c"), e2, len);
    var p = shifted(sub(s, "s"), e3, 1);
    return p ? (p[0] - p[1]) * 10000 : null;
  }, { st: 1, sig: "ta.trix(source, length) → series", about: "Rate of change of a triple-smoothed log price, in basis points." });

  /* ---------------------------------------------------------------- math.* */

  function m1(name, fn, about) {
    B("math." + name, ["number"], 1, function (a) { var v = N(a[0]); return v == null ? null : fn(v); },
      { sig: "math." + name + "(number) → number", about: about });
  }
  m1("abs", Math.abs, "Absolute value.");
  m1("acos", function (v) { return v < -1 || v > 1 ? null : Math.acos(v); }, "Arc cosine, in radians; na outside −1…1.");
  m1("asin", function (v) { return v < -1 || v > 1 ? null : Math.asin(v); }, "Arc sine, in radians; na outside −1…1.");
  m1("atan", Math.atan, "Arc tangent, in radians.");
  m1("ceil", Math.ceil, "Rounds up to the next whole number.");
  m1("cos", Math.cos, "Cosine of an angle in radians.");
  m1("exp", Math.exp, "e raised to this power.");
  m1("floor", Math.floor, "Rounds down to the previous whole number.");
  m1("log", function (v) { return v <= 0 ? null : Math.log(v); }, "Natural logarithm; na at or below zero.");
  m1("log10", function (v) { return v <= 0 ? null : Math.log(v) / Math.LN10; }, "Base-10 logarithm; na at or below zero.");
  m1("sign", function (v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }, "1, −1 or 0.");
  m1("sin", Math.sin, "Sine of an angle in radians.");
  m1("sqrt", function (v) { return v < 0 ? null : Math.sqrt(v); }, "Square root; na below zero.");
  m1("tan", Math.tan, "Tangent of an angle in radians.");
  m1("todegrees", function (v) { return v * 180 / Math.PI; }, "Radians to degrees.");
  m1("toradians", function (v) { return v * Math.PI / 180; }, "Degrees to radians.");
  B("math.round", ["number", "precision"], 1, function (a) {
    var v = N(a[0]);
    if (v == null) return null;
    var p = N(a[1]);
    if (p == null) return Math.round(v);
    var f = Math.pow(10, Math.max(0, Math.round(p)));
    return Math.round(v * f) / f;
  }, { sig: "math.round(number, precision) → number", about: "Rounds to the nearest whole number, or to that many decimals." });
  B("math.pow", ["base", "exponent"], 2, function (a) {
    var x = N(a[0]), y = N(a[1]);
    if (x == null || y == null) return null;
    var r = Math.pow(x, y);
    return isFinite(r) ? r : null;
  }, { sig: "math.pow(base, exponent) → number", about: "Raises the base to the exponent." });
  B("math.max", ["number"], 1, function (a) {
    var m = null, i;
    for (i = 0; i < a.length; i++) { var v = N(a[i]); if (v != null && (m == null || v > m)) m = v; }
    return m;
  }, { va: 1, sig: "math.max(a, b, …) → number", about: "Largest of the arguments, ignoring na." });
  B("math.min", ["number"], 1, function (a) {
    var m = null, i;
    for (i = 0; i < a.length; i++) { var v = N(a[i]); if (v != null && (m == null || v < m)) m = v; }
    return m;
  }, { va: 1, sig: "math.min(a, b, …) → number", about: "Smallest of the arguments, ignoring na." });
  B("math.avg", ["number"], 1, function (a) {
    var t = 0, c = 0, i;
    for (i = 0; i < a.length; i++) { var v = N(a[i]); if (v != null) { t += v; c++; } }
    return c ? t / c : null;
  }, { va: 1, sig: "math.avg(a, b, …) → number", about: "Mean of the arguments, ignoring na." });
  B("math.sum", ["source", "length"], 2, function (a, R, s) { return iSum(s, N(a[0]), L(a[1], 14)); },
    { st: 1, sig: "math.sum(source, length) → series", about: "Rolling sum over the last length bars." });
  B("math.random", ["min", "max", "seed"], 0, function (a, R) {
    /* Deterministic on purpose: run() has to give the same answer twice for
       the same program and the same bars, so this is a seeded generator that
       is reset at the start of every run rather than Math.random. */
    var sd = N(a[2]);
    if (sd != null && R.rseed !== sd) { R.rseed = sd; R.rstate = (sd >>> 0) || 1; }
    R.rstate = (R.rstate * 1664525 + 1013904223) >>> 0;
    var u = R.rstate / 4294967296;
    var lo = D(a[0], 0), hi = D(a[1], 1);
    return lo + u * (hi - lo);
  }, { sig: "math.random(min = 0, max = 1, seed) → number", about: "A seeded pseudo-random number. The seed is reset at the start of each run so two runs agree." });
  B("math.round_to_mintick", ["number"], 1, function (a, R) {
    var v = N(a[0]);
    if (v == null) return null;
    var t = R.mintick || 1e-8;
    return Math.round(v / t) * t;
  }, { sig: "math.round_to_mintick(number) → number", about: "Rounds to the symbol's tick. The tick is inferred from the price's own magnitude, because this rail carries OHLCV and not a contract spec." });

  /* ----------------------------------------------------------------- str.* */

  function S(v) {
    if (v === null || v === undefined) return "NaN";
    if (typeof v === "number") return String(v);
    if (typeof v === "boolean") return v ? "true" : "false";
    if (isCol(v)) return v.h || "na";
    if (isArr(v)) return "[" + v.v.join(", ") + "]";
    return String(v);
  }
  B("str.tostring", ["value", "precision"], 1, function (a) {
    var p = N(a[1]);
    if (p != null && typeof a[0] === "number") return a[0].toFixed(Math.max(0, Math.min(10, Math.round(p))));
    return S(a[0]);
  }, { sig: "str.tostring(value, precision) → string", about: "Text for any value; a precision fixes the number of decimals." });
  B("str.tonumber", ["text"], 1, function (a) {
    var v = parseFloat(String(a[0]));
    return isFinite(v) ? v : null;
  }, { sig: "str.tonumber(text) → number", about: "Reads a number out of text; na when there is none." });
  B("str.length", ["text"], 1, function (a) { return String(a[0] == null ? "" : a[0]).length; },
    { sig: "str.length(text) → int", about: "How many characters the text has." });
  B("str.substring", ["text", "begin", "end"], 2, function (a) {
    var t = String(a[0] == null ? "" : a[0]), b = Math.max(0, Math.round(D(a[1], 0)));
    var e = a[2] === undefined ? t.length : Math.max(0, Math.round(D(a[2], t.length)));
    return t.slice(b, e);
  }, { sig: "str.substring(text, begin, end) → string", about: "The slice between two positions; the end defaults to the end of the text." });
  B("str.replace", ["text", "target", "replacement"], 3, function (a) {
    var t = String(a[0] == null ? "" : a[0]), f = String(a[1]);
    var at = t.indexOf(f);
    return at < 0 ? t : t.slice(0, at) + String(a[2]) + t.slice(at + f.length);
  }, { sig: "str.replace(text, target, replacement) → string", about: "Replaces the first occurrence." });
  B("str.replace_all", ["text", "target", "replacement"], 3, function (a) {
    return String(a[0] == null ? "" : a[0]).split(String(a[1])).join(String(a[2]));
  }, { sig: "str.replace_all(text, target, replacement) → string", about: "Replaces every occurrence." });
  B("str.split", ["text", "separator"], 2, function (a) {
    return mkArr(String(a[0] == null ? "" : a[0]).split(String(a[1])), "string");
  }, { sig: "str.split(text, separator) → array", about: "Splits the text into an array." });
  B("str.contains", ["text", "substring"], 2, function (a) { return String(a[0] == null ? "" : a[0]).indexOf(String(a[1])) >= 0; },
    { sig: "str.contains(text, substring) → bool", about: "True when the text holds that substring." });
  B("str.startswith", ["text", "prefix"], 2, function (a) {
    var t = String(a[0] == null ? "" : a[0]), p = String(a[1]);
    return t.slice(0, p.length) === p;
  }, { sig: "str.startswith(text, prefix) → bool", about: "True when the text begins with that prefix." });
  B("str.endswith", ["text", "suffix"], 2, function (a) {
    var t = String(a[0] == null ? "" : a[0]), p = String(a[1]);
    return p === "" || t.slice(-p.length) === p;
  }, { sig: "str.endswith(text, suffix) → bool", about: "True when the text ends with that suffix." });
  B("str.upper", ["text"], 1, function (a) { return String(a[0] == null ? "" : a[0]).toUpperCase(); },
    { sig: "str.upper(text) → string", about: "Upper case." });
  B("str.lower", ["text"], 1, function (a) { return String(a[0] == null ? "" : a[0]).toLowerCase(); },
    { sig: "str.lower(text) → string", about: "Lower case." });
  B("str.format", ["formatString"], 1, function (a) {
    var t = String(a[0] == null ? "" : a[0]), out = "", i = 0;
    while (i < t.length) {
      if (t.charAt(i) === "{") {
        var close = t.indexOf("}", i);
        if (close > i) {
          var idx = t.slice(i + 1, close);
          if (/^\d+$/.test(idx)) { out += S(a[parseInt(idx, 10) + 1]); i = close + 1; continue; }
        }
      }
      out += t.charAt(i); i++;
    }
    return out;
  }, { va: 1, sig: "str.format(formatString, a, b, …) → string", about: "Positional formatting: {0} takes the first value after the format string. Not printf — there are no format specifiers." });

  /* --------------------------------------------------------------- array.* */

  function mkArr(v, ty) { return { __a: 1, v: v, ty: ty || "float" }; }
  function isArr(v) { return !!(v && v.__a); }
  function needArr(v, where) {
    if (!isArr(v)) throw Err(0, 0, where + "() was given something that is not an array");
    return v;
  }
  function grow(arr, by) {
    if (arr.v.length + by > LIM.array) throw Err(0, 0, "an array may hold at most " + LIM.array + " elements");
  }
  function newArr(ty, zero) {
    B("array.new_" + ty, ["size", "initial_value"], 0, function (a) {
      var n = Math.max(0, Math.round(D(a[0], 0)));
      if (n > LIM.array) throw Err(0, 0, "an array may hold at most " + LIM.array + " elements");
      var out = new Array(n), i, iv = a[1] === undefined ? zero : a[1];
      for (i = 0; i < n; i++) out[i] = iv;
      return mkArr(out, ty);
    }, { sig: "array.new_" + ty + "(size = 0, initial_value) → array", about: "A new " + ty + " array, optionally filled." });
  }
  newArr("float", null); newArr("int", null); newArr("bool", false); newArr("string", "");
  B("array.push", ["id", "value"], 2, function (a) { var x = needArr(a[0], "array.push"); grow(x, 1); x.v.push(a[1]); return null; },
    { sig: "array.push(id, value)", about: "Adds a value to the end." });
  B("array.pop", ["id"], 1, function (a) { var x = needArr(a[0], "array.pop"); return x.v.length ? x.v.pop() : null; },
    { sig: "array.pop(id) → value", about: "Removes and returns the last element." });
  B("array.shift", ["id"], 1, function (a) { var x = needArr(a[0], "array.shift"); return x.v.length ? x.v.shift() : null; },
    { sig: "array.shift(id) → value", about: "Removes and returns the first element." });
  B("array.unshift", ["id", "value"], 2, function (a) { var x = needArr(a[0], "array.unshift"); grow(x, 1); x.v.unshift(a[1]); return null; },
    { sig: "array.unshift(id, value)", about: "Adds a value at the front." });
  B("array.get", ["id", "index"], 2, function (a) {
    var x = needArr(a[0], "array.get"), i = Math.round(D(a[1], -1));
    return (i >= 0 && i < x.v.length) ? x.v[i] : null;
  }, { sig: "array.get(id, index) → value", about: "Reads one element; out of range is na rather than an error." });
  B("array.set", ["id", "index", "value"], 3, function (a) {
    var x = needArr(a[0], "array.set"), i = Math.round(D(a[1], -1));
    if (i >= 0 && i < x.v.length) x.v[i] = a[2];
    return null;
  }, { sig: "array.set(id, index, value)", about: "Writes one element; out of range does nothing." });
  B("array.size", ["id"], 1, function (a) { return needArr(a[0], "array.size").v.length; },
    { sig: "array.size(id) → int", about: "How many elements the array holds." });
  B("array.clear", ["id"], 1, function (a) { needArr(a[0], "array.clear").v.length = 0; return null; },
    { sig: "array.clear(id)", about: "Empties the array in place." });
  B("array.insert", ["id", "index", "value"], 3, function (a) {
    var x = needArr(a[0], "array.insert"), i = Math.max(0, Math.min(x.v.length, Math.round(D(a[1], 0))));
    grow(x, 1); x.v.splice(i, 0, a[2]); return null;
  }, { sig: "array.insert(id, index, value)", about: "Inserts a value at that position." });
  B("array.remove", ["id", "index"], 2, function (a) {
    var x = needArr(a[0], "array.remove"), i = Math.round(D(a[1], -1));
    if (i < 0 || i >= x.v.length) return null;
    return x.v.splice(i, 1)[0];
  }, { sig: "array.remove(id, index) → value", about: "Removes and returns the element at that position." });
  B("array.slice", ["id", "index_from", "index_to"], 2, function (a) {
    var x = needArr(a[0], "array.slice");
    var f = Math.round(D(a[1], 0)), t = a[2] === undefined ? x.v.length : Math.round(D(a[2], x.v.length));
    return mkArr(x.v.slice(f, t), x.ty);
  }, { sig: "array.slice(id, index_from, index_to) → array", about: "A copy of part of the array." });
  B("array.concat", ["id1", "id2"], 2, function (a) {
    var x = needArr(a[0], "array.concat"), y = needArr(a[1], "array.concat");
    grow(x, y.v.length);
    x.v = x.v.concat(y.v);
    return x;
  }, { sig: "array.concat(id1, id2) → array", about: "Appends the second array to the first and returns the first." });
  B("array.sort", ["id", "order"], 1, function (a) {
    var x = needArr(a[0], "array.sort"), desc = String(a[1] === undefined ? "ascending" : a[1]) === "descending";
    x.v.sort(function (p, q) {
      if (typeof p === "string" || typeof q === "string") return String(p) < String(q) ? -1 : String(p) > String(q) ? 1 : 0;
      var pp = N(p), qq = N(q);
      if (pp == null) return 1;
      if (qq == null) return -1;
      return pp - qq;
    });
    if (desc) x.v.reverse();
    return null;
  }, { sig: "array.sort(id, order = \"ascending\")", about: "Sorts in place. na sinks to the end." });
  B("array.reverse", ["id"], 1, function (a) { needArr(a[0], "array.reverse").v.reverse(); return null; },
    { sig: "array.reverse(id)", about: "Reverses in place." });
  function nums(x) {
    var out = [], i;
    for (i = 0; i < x.v.length; i++) { var v = N(x.v[i]); if (v != null) out.push(v); }
    return out;
  }
  B("array.sum", ["id"], 1, function (a) {
    var q = nums(needArr(a[0], "array.sum")), t = 0, i;
    if (!q.length) return null;
    for (i = 0; i < q.length; i++) t += q[i];
    return t;
  }, { sig: "array.sum(id) → float", about: "Total of the numeric elements." });
  B("array.avg", ["id"], 1, function (a) {
    var q = nums(needArr(a[0], "array.avg")), t = 0, i;
    if (!q.length) return null;
    for (i = 0; i < q.length; i++) t += q[i];
    return t / q.length;
  }, { sig: "array.avg(id) → float", about: "Mean of the numeric elements." });
  B("array.min", ["id"], 1, function (a) {
    var q = nums(needArr(a[0], "array.min")), i, m = null;
    for (i = 0; i < q.length; i++) if (m == null || q[i] < m) m = q[i];
    return m;
  }, { sig: "array.min(id) → float", about: "Smallest numeric element." });
  B("array.max", ["id"], 1, function (a) {
    var q = nums(needArr(a[0], "array.max")), i, m = null;
    for (i = 0; i < q.length; i++) if (m == null || q[i] > m) m = q[i];
    return m;
  }, { sig: "array.max(id) → float", about: "Largest numeric element." });
  B("array.stdev", ["id"], 1, function (a) {
    var q = nums(needArr(a[0], "array.stdev")), i, m = 0, s = 0;
    if (q.length < 2) return null;
    for (i = 0; i < q.length; i++) m += q[i];
    m /= q.length;
    for (i = 0; i < q.length; i++) s += (q[i] - m) * (q[i] - m);
    return Math.sqrt(s / q.length);
  }, { sig: "array.stdev(id) → float", about: "Population standard deviation of the numeric elements." });
  B("array.median", ["id"], 1, function (a) {
    var q = nums(needArr(a[0], "array.median"));
    if (!q.length) return null;
    q.sort(function (x, y) { return x - y; });
    var h = q.length >> 1;
    return q.length % 2 ? q[h] : (q[h - 1] + q[h]) / 2;
  }, { sig: "array.median(id) → float", about: "Median of the numeric elements." });
  B("array.indexof", ["id", "value"], 2, function (a) {
    var x = needArr(a[0], "array.indexof"), i;
    for (i = 0; i < x.v.length; i++) if (x.v[i] === a[1]) return i;
    return -1;
  }, { sig: "array.indexof(id, value) → int", about: "Position of the first match, or −1." });
  B("array.includes", ["id", "value"], 2, function (a) {
    var x = needArr(a[0], "array.includes"), i;
    for (i = 0; i < x.v.length; i++) if (x.v[i] === a[1]) return true;
    return false;
  }, { sig: "array.includes(id, value) → bool", about: "True when the value is somewhere in the array." });
  B("array.join", ["id", "separator"], 1, function (a) {
    var x = needArr(a[0], "array.join"), sep = a[1] === undefined ? "," : String(a[1]), out = [], i;
    for (i = 0; i < x.v.length; i++) out.push(S(x.v[i]));
    return out.join(sep);
  }, { sig: "array.join(id, separator = \",\") → string", about: "Joins every element into one string." });

  /* --------------------------------------------------------------- color.* */

  B("color.new", ["color", "transp"], 1, function (a) {
    var base = isCol(a[0]) ? a[0].h : normHex(a[0]);
    if (!base) return null;
    return mkCol(base, D(a[1], 0));
  }, { sig: "color.new(color, transp = 0) → color", about: "The same colour at a new transparency, where 0 is solid and 1 is invisible." });
  B("color.rgb", ["red", "green", "blue", "transp"], 3, function (a) {
    var r = D(a[0], 0), g = D(a[1], 0), b = D(a[2], 0);
    return mkCol("#" + hex2(r) + hex2(g) + hex2(b), D(a[3], 0));
  }, { sig: "color.rgb(red, green, blue, transp = 0) → color", about: "A colour from three 0…255 channels." });

  /* The named colours are the engine's own series palette wherever one
     matches, so a script that writes color.blue draws the blue the rest of
     the chart already uses. The six with no equivalent on the chart keep
     their CSS values. */
  var NAMED = {
    blue: PAL[0], orange: PAL[1], green: PAL[2], red: PAL[3], purple: PAL[4], aqua: PAL[5],
    yellow: PAL[6], lime: PAL[7], fuchsia: PAL[10], teal: PAL[11],
    white: "#FFFFFF", gray: "#7E8AB8", black: "#000000",
    navy: "#000080", olive: "#808000", silver: "#C0C0C0", maroon: "#800000"
  };
  (function () {
    var k;
    for (k in NAMED) if (has(NAMED, k)) CONSTS["color." + k] = 1;
  })();

  /* ------------------------------------------------------------- request.* */

  B("request.security", ["symbol", "timeframe", "expression"], 3, function () { return null; },
    {
      sig: "request.security(symbol, timeframe, expression) → series",
      about: "Re-runs the expression on THIS symbol's bars aggregated to a higher timeframe. It fetches nothing: the only series in memory is the one on screen, so the symbol must be syminfo.ticker and the timeframe must be a whole multiple of the chart's. A higher-timeframe value only appears on the chart bar where that higher-timeframe bar closes, so nothing is read before it existed."
    });

  /* --------------------------------------------------------------- globals */

  B("nz", ["source", "replacement"], 1, function (a) {
    var v = a[0];
    if (v === null || v === undefined) return a[1] === undefined ? 0 : a[1];
    if (typeof v === "number" && !isFinite(v)) return a[1] === undefined ? 0 : a[1];
    return v;
  }, { sig: "nz(source, replacement = 0) → value", about: "The source, or the replacement wherever the source is na." });
  B("na", ["value"], 1, function (a) { return a[0] === null || a[0] === undefined; },
    { sig: "na(value) → bool", about: "True when the value is na. Written on its own, na IS the missing value." });

  /* =====================================================================
     6 · OUTPUTS
     A drawing call does not draw. It writes into the slot the resolver gave
     it, and section 8 turns those slots into the engine's row kinds once the
     last bar has been walked. Keeping it in two halves is what makes run()
     pure: nothing here touches a canvas, the DOM or the chart's state.
     ===================================================================== */

  B("study", ["title", "shorttitle", "overlay", "precision", "range_lo", "range_hi"], 1, function () { return null; },
    { sig: "study(title, shorttitle, overlay, precision, range_lo, range_hi)", about: "Declares an indicator. Read at compile time, so every argument must be written out rather than computed. range_lo and range_hi pin the pane's scale, which is how an oscillator gets a fixed 0-100." });
  B("strategy", ["title", "shorttitle", "overlay", "precision", "initial_capital", "commission", "slippage", "pyramiding", "default_qty", "range_lo", "range_hi"], 1,
    function () { return null; },
    { sig: "strategy(title, shorttitle, overlay, precision, initial_capital, commission, slippage, pyramiding, default_qty, range_lo, range_hi)", about: "Declares a backtest. commission is a percent of notional charged on both sides; slippage is in ticks." });

  function inputFn(kind, params, mn) {
    B("input" + (kind ? "." + kind : ""), params, mn, function (a, R, s, node) {
      return inputValue(node.input, R, a);
    }, { sig: "input" + (kind ? "." + kind : "") + "(" + params.join(", ") + ")", about: "An input the chart's settings dialog can edit. Read at compile time to build the dialog; read again on every bar to get the value." });
  }
  inputFn("", ["defval", "title"], 1);
  inputFn("int", ["defval", "title", "minval", "maxval", "step"], 1);
  inputFn("float", ["defval", "title", "minval", "maxval", "step"], 1);
  inputFn("bool", ["defval", "title"], 1);
  inputFn("string", ["defval", "title", "options"], 1);
  inputFn("source", ["defval", "title"], 1);
  inputFn("color", ["defval", "title"], 1);

  /* The engine's dialog hands back a string from a SELECT and a number from a
     number field, so everything a user can type has to come home through
     here rather than being trusted as it stands. */
  function inputValue(rec, R, a) {
    var p = R.params, raw = (p && has(p, rec.k)) ? p[rec.k] : undefined;
    if (rec.type === "source") {
      var key = SERIES[typeof raw === "string" ? raw : rec.d] ? (typeof raw === "string" ? raw : rec.d) : rec.d;
      return srcOf(R, SERIES[key]);
    }
    if (rec.type === "bool") {
      if (raw === undefined) return !!rec.d;
      if (typeof raw === "boolean") return raw;
      var t = String(raw).toLowerCase();
      return t === "on" || t === "true" || t === "1" || t === "yes";
    }
    if (rec.type === "color") {
      var hx = normHex(raw === undefined ? rec.d : raw) || rec.d;
      return mkCol(hx, 0);
    }
    if (rec.type === "string") {
      var sv = raw === undefined ? rec.d : String(raw);
      if (rec.opts && rec.opts.length && rec.opts.indexOf(sv) < 0) sv = rec.d;
      return sv;
    }
    var v = raw === undefined ? rec.d : N(raw);
    if (v == null) v = rec.d;
    if (rec.min != null && v < rec.min) v = rec.min;
    if (rec.max != null && v > rec.max) v = rec.max;
    return rec.type === "int" ? Math.round(v) : v;
  }

  var SHAPES = { triangleup: "up", triangledown: "down", arrowup: "up", arrowdown: "down", circle: "circle", square: "square", diamond: "diamond", cross: "cross", xcross: "cross", flag: "flag", labelup: "up", labeldown: "down" };
  var LOCS = { abovebar: 1, belowbar: 1, top: 1, bottom: 1, absolute: 1 };
  var PSTYLE = { line: 1, stepline: 1, histogram: 1, area: 1, columns: 1, circles: 1, cross: 1 };
  var DASHES = { solid: 0, dashed: 4, dotted: 2 };

  function outRec(R, node) { return R.out[node.oid]; }

  B("plot", ["series", "title", "color", "linewidth", "style"], 1, function (a, R, s, node) {
    var o = outRec(R, node), v = N(a[0]);
    o.vals[R.i] = v;
    var c = cssOf(a[2], null);
    if (c) { o.cols[R.i] = c; o.last = c; }
    if (a[3] !== undefined && o.w == null) o.w = Math.max(0.5, Math.min(6, D(a[3], 1.4)));
    if (a[4] !== undefined && o.style == null) {
      var st = String(a[4]);
      if (!PSTYLE[st]) throw Err(node.line, node.col, "plot style must be one of line stepline histogram area columns circles cross");
      o.style = st;
    }
    if (a[1] !== undefined && !o.titled) { o.title = String(a[1]); o.titled = true; }
    return null;
  }, { sig: "plot(series, title, color, linewidth, style)", about: "Draws a series. style ∈ line stepline histogram area columns circles cross." });

  B("plotshape", ["series", "title", "style", "location", "color", "text", "size"], 1, function (a, R, s, node) {
    var o = outRec(R, node);
    if (a[2] !== undefined && !o.shape) {
      var sh = SHAPES[String(a[2])];
      if (!sh) throw Err(node.line, node.col, "plotshape style must be one of triangleup triangledown arrowup arrowdown circle square diamond cross xcross flag labelup labeldown");
      o.shape = sh;
    }
    if (a[3] !== undefined && !o.loc) {
      if (!LOCS[String(a[3])]) throw Err(node.line, node.col, "plotshape location must be one of abovebar belowbar top bottom absolute");
      o.loc = String(a[3]);
    }
    if (a[1] !== undefined && !o.titled) { o.title = String(a[1]); o.titled = true; }
    if (a[6] !== undefined && !o.size) o.size = String(a[6]);
    if (!truthy(a[0])) return null;
    var num0 = N(a[0]);
    o.vals[R.i] = {
      s: o.shape || "circle",
      c: cssOf(a[4], null),
      txt: a[5] === undefined ? null : S(a[5]),
      loc: o.loc || "abovebar",
      abs: num0
    };
    return null;
  }, { sig: "plotshape(series, title, style, location, color, text, size)", about: "Marks the bars where the series is true. location ∈ abovebar belowbar top bottom absolute." });

  B("plotchar", ["series", "title", "char", "location", "color"], 1, function (a, R, s, node) {
    var o = outRec(R, node);
    if (a[1] !== undefined && !o.titled) { o.title = String(a[1]); o.titled = true; }
    if (a[2] !== undefined && !o.ch) o.ch = String(a[2]);
    if (a[3] !== undefined && !o.loc) {
      if (!LOCS[String(a[3])]) throw Err(node.line, node.col, "plotchar location must be one of abovebar belowbar top bottom absolute");
      o.loc = String(a[3]);
    }
    if (!truthy(a[0])) return null;
    o.vals[R.i] = { txt: o.ch || "•", c: cssOf(a[4], null), loc: o.loc || "abovebar", abs: N(a[0]) };
    return null;
  }, { sig: "plotchar(series, title, char, location, color)", about: "Writes a character on the bars where the series is true." });

  B("hline", ["price", "title", "color", "linestyle", "linewidth"], 1, function (a, R, s, node) {
    var o = outRec(R, node), v = N(a[0]);
    if (v != null) o.v = v;
    if (a[1] !== undefined) o.title = String(a[1]);
    var c = cssOf(a[2], null);
    if (c) o.c = c;
    if (a[3] !== undefined) {
      var d = String(a[3]);
      if (!has(DASHES, d)) throw Err(node.line, node.col, "hline linestyle must be solid, dashed or dotted");
      o.dash = DASHES[d];
    }
    if (a[4] !== undefined) o.w = D(a[4], 1);
    return null;
  }, { sig: "hline(price, title, color, linestyle, linewidth)", about: "A horizontal level on the pane. linestyle ∈ solid dashed dotted." });

  B("fill", ["plot1", "plot2", "color", "transp"], 2, function (a, R, s, node) {
    var o = outRec(R, node);
    var c = cssOf(a[2], null);
    if (c) o.c = c;
    if (a[3] !== undefined) o.transp = D(a[3], 0.85);
    return null;
  }, { sig: "fill(plot1, plot2, color, transp)", about: "Shades between two plots, named by their order in the script: the first plot() is 0." });

  B("bgcolor", ["color", "transp"], 1, function (a, R, s, node) {
    var o = outRec(R, node), c = a[0];
    if (c == null) return null;
    var t = a[1] === undefined ? null : D(a[1], 0);
    if (t != null && isCol(c)) c = mkCol(c.h, t);
    o.vals[R.i] = cssOf(c, null);
    return null;
  }, { sig: "bgcolor(color, transp)", about: "Tints the background of the bars where the colour is not na." });

  B("barcolor", ["color"], 1, function (a, R, s, node) {
    var o = outRec(R, node);
    if (a[0] == null) return null;
    o.vals[R.i] = cssOf(a[0], null);
    return null;
  }, { sig: "barcolor(color)", about: "Colours the bar. The engine draws candles from the chart's own settings and has no per-bar override, so this paints a tighter background band behind the bar instead — it is an approximation, and it is named as one in the legend." });

  B("label", ["series", "text", "color", "below"], 2, function (a, R, s, node) {
    var o = outRec(R, node), v = N(a[0]);
    if (v == null) return null;
    var txt = a[1] === undefined ? null : S(a[1]);
    if (txt == null || txt === "") return null;
    o.vals[R.i] = { v: v, txt: txt, c: cssOf(a[2], null), below: truthy(a[3]) };
    return null;
  }, { sig: "label(series, text, color, below)", about: "Writes text at a price on this bar — our simplification of label.new." });

  B("alertcondition", ["condition", "title", "message"], 1, function (a, R, s, node) {
    var o = outRec(R, node);
    if (a[1] !== undefined) o.title = String(a[1]);
    if (a[2] !== undefined) o.message = String(a[2]);
    if (truthy(a[0])) o.bars.push(R.i);
    return null;
  }, { sig: "alertcondition(condition, title, message)", about: "Records the bars where the condition fired. The message is kept exactly as written — placeholders are not filled in here." });

  /* =====================================================================
     7 · THE STRATEGY ENGINE
     One rule shapes everything below: an order placed while bar i is being
     processed cannot be filled by anything bar i knows. The queue a script
     writes into during bar i is only ever read by drain(), and drain() is
     called at the TOP of bar i+1, before a single statement of the script
     runs. There is no other path from the queue to a fill, so a strategy
     cannot flatter itself with the close it had just seen — not by mistake,
     and not on purpose.
     ===================================================================== */

  function mkStrat(cfg, n, tick) {
    return {
      cfg: cfg, cash: cfg.capital, pos: 0, tick: tick,
      open: [],        /* the entries currently on                          */
      queue: [],       /* placed this bar, drained at the top of the next   */
      resting: [],     /* limit and stop orders waiting for their price     */
      trades: [], equity: new Array(n), fees: 0, seq: 0
    };
  }
  function slipped(S, px, buy) { return px + (buy ? 1 : -1) * S.cfg.slippage * S.tick; }
  function feeOn(S, px, qty) { return Math.abs(px * qty) * S.cfg.commission / 100; }

  function doFill(S, R, i, o, px) {
    var b = R.bars[i];
    /* A close is a sell when the book is long and a buy when it is short, so
       the raw price goes through and settle() slips it per entry. */
    if (o.kind === "close") { closeById(S, R, i, px, o.id); return; }
    if (o.kind === "closeall") { closeAll(S, R, i, px, "close_all"); return; }
    var buy = o.side === "long";
    /* an entry against the standing position closes it first — that is what
       makes a long signal on a short book a reversal and not a hedge */
    if (o.kind === "entry" && S.open.length && S.open[0].side !== o.side) closeAll(S, R, i, px, "reverse");
    var price = slipped(S, px, buy);
    if (!isFinite(price) || price <= 0) return;
    if (o.kind === "entry") {
      var same = 0, k;
      for (k = 0; k < S.open.length; k++) if (S.open[k].side === o.side) same++;
      if (same >= S.cfg.pyramiding) return;
    }
    var qty = Math.abs(D(o.qty, S.cfg.qty)) || S.cfg.qty;
    var fee = feeOn(S, price, qty);
    S.cash += (buy ? -1 : 1) * price * qty - fee;
    S.fees += fee;
    S.pos += buy ? qty : -qty;
    S.open.push({
      id: o.id, side: o.side, qty: qty, price: price, time: b.t, bar: i, fee: fee,
      mae: 0, mfe: 0, stop: null, profit: null, trail: null, peak: price
    });
  }
  function settle(S, R, i, e, raw, why) {
    var b = R.bars[i], buy = e.side !== "long";
    var px = slipped(S, raw, buy);
    var fee = feeOn(S, px, e.qty);
    S.cash += (buy ? -1 : 1) * px * e.qty - fee;
    S.fees += fee;
    S.pos += buy ? e.qty : -e.qty;
    var gross = (e.side === "long" ? px - e.price : e.price - px) * e.qty;
    var pnl = gross - e.fee - fee;
    S.trades.push({
      id: e.id, side: e.side, qty: e.qty,
      entryTime: e.time, entryPrice: e.price, entryBar: e.bar,
      exitTime: b.t, exitPrice: px, exitBar: i, why: why,
      pnl: pnl, pnlPct: e.price * e.qty ? pnl / (e.price * e.qty) * 100 : 0,
      bars: i - e.bar, mae: e.mae, mfe: e.mfe, fees: e.fee + fee
    });
  }
  function closeAll(S, R, i, px, why) {
    while (S.open.length) settle(S, R, i, S.open.shift(), px, why);
  }
  function closeById(S, R, i, px, id) {
    var k = 0;
    while (k < S.open.length) {
      if (S.open[k].id === id) { settle(S, R, i, S.open.splice(k, 1)[0], px, "close"); continue; }
      k++;
    }
  }

  /* The top of every bar: yesterday's orders meet today's prices. */
  function drain(S, R, i) {
    var b = R.bars[i], k, o;
    if (!b) return;
    for (k = 0; k < S.queue.length; k++) {
      o = S.queue[k];
      if (o.kind === "exit") { bracket(S, o); continue; }
      if (o.px == null) doFill(S, R, i, o, b.o);
      else S.resting.push(o);
    }
    S.queue.length = 0;

    /* resting limits and stops: a bar that trades through the price fills it
       there. The path inside a bar is unknown, so the fill is the order's own
       price and never something better. */
    k = 0;
    while (k < S.resting.length) {
      o = S.resting[k];
      var hit = false, px = o.px;
      if (o.stopOrd) {
        if (o.side === "long" && b.h >= o.px) hit = true;
        if (o.side === "short" && b.l <= o.px) hit = true;
        if (hit && ((o.side === "long" && b.o > o.px) || (o.side === "short" && b.o < o.px))) px = b.o;
      } else {
        if (o.side === "long" && b.l <= o.px) hit = true;
        if (o.side === "short" && b.h >= o.px) hit = true;
        if (hit && ((o.side === "long" && b.o < o.px) || (o.side === "short" && b.o > o.px))) px = b.o;
      }
      if (hit) { S.resting.splice(k, 1); doFill(S, R, i, o, px); continue; }
      k++;
    }

    /* brackets. A bar that touches both the stop and the target is scored as
       the loss: the tick order inside the bar is not in the data, and the
       honest reading of an unknown path is the worse one. */
    k = 0;
    while (k < S.open.length) {
      var e = S.open[k], out = null, why = "";
      if (e.trail != null) {
        e.peak = e.side === "long" ? Math.max(e.peak, b.h) : Math.min(e.peak, b.l);
        var tp = e.side === "long" ? e.peak - e.trail : e.peak + e.trail;
        if (e.side === "long" ? b.l <= tp : b.h >= tp) { out = tp; why = "trail"; }
      }
      if (out == null && e.stop != null && (e.side === "long" ? b.l <= e.stop : b.h >= e.stop)) { out = e.stop; why = "stop"; }
      if (out == null && e.profit != null && (e.side === "long" ? b.h >= e.profit : b.l <= e.profit)) { out = e.profit; why = "target"; }
      if (out != null) { S.open.splice(k, 1); settle(S, R, i, e, out, why); continue; }
      k++;
    }
  }
  function bracket(S, o) {
    var k;
    for (k = 0; k < S.open.length; k++) {
      var e = S.open[k];
      if (o.from && e.id !== o.from) continue;
      if (o.loss != null) e.stop = e.side === "long" ? e.price - o.loss : e.price + o.loss;
      if (o.profit != null) e.profit = e.side === "long" ? e.price + o.profit : e.price - o.profit;
      if (o.trail != null) { e.trail = o.trail; e.peak = e.side === "long" ? Math.max(e.peak, e.price) : Math.min(e.peak, e.price); }
    }
  }
  /* the end of every bar: mark the book and record the curve */
  function mark(S, R, i) {
    var b = R.bars[i], k;
    for (k = 0; k < S.open.length; k++) {
      var e = S.open[k];
      var adv = e.side === "long" ? (b.l - e.price) : (e.price - b.h);
      var fav = e.side === "long" ? (b.h - e.price) : (e.price - b.l);
      if (adv * e.qty < e.mae) e.mae = adv * e.qty;
      if (fav * e.qty > e.mfe) e.mfe = fav * e.qty;
    }
    S.equity[i] = S.cash + S.pos * b.c;
  }

  function stratStats(S, R) {
    var t = S.trades, i, wins = 0, gp = 0, gl = 0, lw = 0, ll = 0, sw = 0, sl = 0, net = 0;
    for (i = 0; i < t.length; i++) {
      var p = t[i].pnl;
      net += p;
      if (p > 0) { wins++; gp += p; sw += p; if (p > lw) lw = p; }
      else if (p < 0) { gl += -p; sl += -p; if (-p > ll) ll = -p; }
    }
    var losses = t.length - wins;
    var eq = S.equity, peak = -Infinity, dd = 0, ddp = 0;
    for (i = 0; i < eq.length; i++) {
      var v = eq[i];
      if (v == null || !isFinite(v)) continue;
      if (v > peak) peak = v;
      var d = peak - v;
      if (d > dd) dd = d;
      if (peak > 0 && d / peak > ddp) ddp = d / peak;
    }
    /* Sharpe from the per-bar equity returns, annualised by how many bars of
       this size fit in a year — the same convention the Rewind desk uses. */
    var r = [], m = 0, q = 0;
    for (i = 1; i < eq.length; i++) {
      var a0 = eq[i - 1], b0 = eq[i];
      if (a0 == null || b0 == null || !(a0 > 0)) continue;
      r.push(b0 / a0 - 1);
    }
    var sharpe = 0;
    if (r.length > 2) {
      for (i = 0; i < r.length; i++) m += r[i];
      m /= r.length;
      for (i = 0; i < r.length; i++) q += (r[i] - m) * (r[i] - m);
      var sd = Math.sqrt(q / r.length);
      var bpy = R.barMs ? 31557600000 / R.barMs : 8760;
      sharpe = sd ? m / sd * Math.sqrt(bpy) : 0;
    }
    var last = null;
    for (i = eq.length - 1; i >= 0; i--) if (eq[i] != null) { last = eq[i]; break; }
    return {
      trades: t.length, wins: wins, losses: losses,
      netProfit: net, grossProfit: gp, grossLoss: gl,
      profitFactor: gl > 0 ? gp / gl : null,
      winRate: t.length ? wins / t.length * 100 : 0,
      avgWin: wins ? sw / wins : 0, avgLoss: losses ? sl / losses : 0,
      largestWin: lw, largestLoss: ll,
      maxDrawdown: dd, maxDrawdownPct: ddp * 100,
      sharpe: sharpe, fees: S.fees,
      initialCapital: S.cfg.capital,
      finalEquity: last == null ? S.cfg.capital : last,
      returnPct: S.cfg.capital ? ((last == null ? S.cfg.capital : last) - S.cfg.capital) / S.cfg.capital * 100 : 0,
      openAtEnd: S.open.length
    };
  }

  function sideOf(v, node) {
    var s = String(v === undefined ? "long" : v).toLowerCase();
    if (s === "long" || s === "buy") return "long";
    if (s === "short" || s === "sell") return "short";
    throw Err(node.line, node.col, "direction must be \"long\" or \"short\"");
  }
  function needStrat(R, node) {
    if (!R.strat) throw Err(node.line, node.col, "this script has no strategy() declaration, so it cannot place orders");
    return R.strat;
  }

  B("strategy.entry", ["id", "direction", "qty", "limit", "stop"], 2, function (a, R, s, node) {
    var S = needStrat(R, node);
    var lim = N(a[3]), stp = N(a[4]);
    S.queue.push({
      kind: "entry", id: String(a[0]), side: sideOf(a[1], node), qty: N(a[2]),
      px: stp != null ? stp : lim, stopOrd: stp != null
    });
    return null;
  }, { sig: "strategy.entry(id, direction, qty, limit, stop)", about: "Places an entry. Without a limit or stop it is a market order and fills at the NEXT bar's open; an entry against the standing position reverses it." });
  B("strategy.order", ["id", "direction", "qty", "limit", "stop"], 2, function (a, R, s, node) {
    var S = needStrat(R, node);
    var lim = N(a[3]), stp = N(a[4]);
    S.queue.push({
      kind: "order", id: String(a[0]), side: sideOf(a[1], node), qty: N(a[2]),
      px: stp != null ? stp : lim, stopOrd: stp != null
    });
    return null;
  }, { sig: "strategy.order(id, direction, qty, limit, stop)", about: "The same as strategy.entry but with no reversal and no pyramiding limit — it simply adds the order." });
  B("strategy.close", ["id"], 1, function (a, R, s, node) {
    needStrat(R, node).queue.push({ kind: "close", id: String(a[0]), side: "long", px: null });
    return null;
  }, { sig: "strategy.close(id)", about: "Closes every open entry carrying that id, at the next bar's open." });
  B("strategy.close_all", [], 0, function (a, R, s, node) {
    needStrat(R, node).queue.push({ kind: "closeall", id: "*", side: "long", px: null });
    return null;
  }, { sig: "strategy.close_all()", about: "Closes the whole book at the next bar's open." });
  B("strategy.exit", ["id", "from_entry", "profit", "loss", "trail_points"], 1, function (a, R, s, node) {
    var S = needStrat(R, node);
    S.queue.push({
      kind: "exit", id: String(a[0]), from: a[1] === undefined ? null : String(a[1]),
      profit: N(a[2]), loss: N(a[3]), trail: N(a[4])
    });
    return null;
  }, { sig: "strategy.exit(id, from_entry, profit, loss, trail_points)", about: "Attaches a target, a stop and/or a trailing stop to open entries, in price points. A bar that touches both the stop and the target is scored as the loss." });

  /* =====================================================================
     8 · THE INTERPRETER
     One walk of the tree per bar. Nothing is compiled, nothing is generated,
     nothing is resolved by name against anything outside the tables above.
     ===================================================================== */

  function halt(R, msg) { throw { __h: 1, e: Err(R.line || 0, 0, msg) }; }
  function tick(R) {
    R.steps++;
    if (R.steps > LIM.steps) halt(R, "this script ran past its budget of " + LIM.steps + " interpreter steps");
    if ((R.steps & STEP_MASK) === 0 && Date.now() - R.t0 > LIM.ms) {
      halt(R, "this script ran longer than its " + LIM.ms + " ms budget");
    }
  }
  function frame(up) { return { v: {}, up: up }; }
  function lookup(env, n) {
    var e = env;
    while (e) { if (has(e.v, n)) return e.v[n]; e = e.up; }
    return null;
  }
  function setLocal(env, n, v) {
    var e = env;
    while (e) { if (has(e.v, n)) { e.v[n] = v; return; } e = e.up; }
    env.v[n] = v;
  }

  function constVal(name, R) {
    if (name === "na") return null;
    if (name === "true") return true;
    if (name === "false") return false;
    if (name === "last_bar_index") return R.n - 1;
    if (name === "barstate.isfirst") return R.i === 0;
    if (name === "barstate.islast") return R.i === R.n - 1;
    /* Nothing here is live. run() walks a finished array of bars, so the
       honest answer is that no bar is a realtime bar. */
    if (name === "barstate.isrealtime") return false;
    if (name === "syminfo.ticker") return R.symbol;
    if (name === "syminfo.currency") return R.currency;
    if (name === "syminfo.mintick") return R.mintick;
    if (name === "timeframe.period") return R.tf;
    if (name === "timeframe.isintraday") return R.barMs < 86400000;
    if (name === "timeframe.multiplier") return R.tfMul;
    if (name === "math.pi") return Math.PI;
    if (name === "math.e") return Math.E;
    if (name === "math.phi") return (1 + Math.sqrt(5)) / 2;
    if (name === "strategy.position_size") return R.strat ? R.strat.pos : null;
    if (name === "strategy.equity") return R.strat ? R.strat.cash + R.strat.pos * R.bars[R.i].c : null;
    if (name === "strategy.opentrades") return R.strat ? R.strat.open.length : null;
    if (name.indexOf("color.") === 0) { var h = NAMED[name.slice(6)]; return h ? mkCol(h, 0) : null; }
    return null;
  }

  function arith(op, x, y) {
    if (x == null || y == null) return null;
    if (op === "+") {
      if (typeof x === "string" || typeof y === "string") return S(x) + S(y);
      return N(x) == null || N(y) == null ? null : x + y;
    }
    var a = N(x), b = N(y);
    if (a == null || b == null) return null;
    if (op === "-") return a - b;
    if (op === "*") return a * b;
    if (op === "/") return b === 0 ? null : a / b;
    if (op === "%") return b === 0 ? null : a % b;
    return null;
  }
  function compare(op, x, y) {
    if (x === null || x === undefined || y === null || y === undefined) return null;
    if (op === "==") return isCol(x) && isCol(y) ? (x.h === y.h && x.t === y.t) : x === y;
    if (op === "!=") return isCol(x) && isCol(y) ? !(x.h === y.h && x.t === y.t) : x !== y;
    var a = typeof x === "string" ? x : N(x), b = typeof y === "string" ? y : N(y);
    if (a == null || b == null) return null;
    if (op === "<") return a < b;
    if (op === "<=") return a <= b;
    if (op === ">") return a > b;
    if (op === ">=") return a >= b;
    return null;
  }

  function evalNode(e, env, R) {
    tick(R);
    var t = e.t, i;
    if (t === "num") return e.v;
    if (t === "str") return e.v;
    if (t === "bool") return e.v;
    if (t === "const") return constVal(e.name, R);
    if (t === "id") {
      var r = e.ref;
      if (r.k === "g") { var v = R.vals[r.slot]; return v === undefined ? null : v; }
      if (r.k === "l") return lookup(env, e.name);
      if (r.k === "s") return srcOf(R, r.f);
      if (r.k === "c") return constVal(r.name, R);
      if (r.k === "inp") return inputValue(r.rec, R, null);
      throw Err(e.line, e.col, "'" + e.name + "' is a function and has no value of its own");
    }
    if (t === "bin") {
      var op = e.op;
      if (op === "and") { if (!truthy(evalNode(e.a, env, R))) return false; return truthy(evalNode(e.b, env, R)); }
      if (op === "or") { if (truthy(evalNode(e.a, env, R))) return true; return truthy(evalNode(e.b, env, R)); }
      var x = evalNode(e.a, env, R), y = evalNode(e.b, env, R);
      if (op === "==" || op === "!=" || op === "<" || op === "<=" || op === ">" || op === ">=") return compare(op, x, y);
      return arith(op, x, y);
    }
    if (t === "un") {
      var u = evalNode(e.a, env, R);
      if (e.op === "not") return !truthy(u);
      var n = N(u);
      return n == null ? null : -n;
    }
    if (t === "tern") return truthy(evalNode(e.c, env, R)) ? evalNode(e.a, env, R) : evalNode(e.b, env, R);
    if (t === "list") {
      var out = [];
      for (i = 0; i < e.items.length; i++) out.push(evalNode(e.items[i], env, R));
      return mkArr(out, "float");
    }
    if (t === "hist") {
      var k = N(evalNode(e.n, env, R));
      var back = k == null ? 0 : Math.round(k);
      if (back < 0) return null;
      if (e.mode === "series") return srcAt(R, e.f, R.i - back);
      if (e.mode === "slot") {
        if (!back) { var cv = R.vals[e.slot]; return cv === undefined ? null : cv; }
        var h = R.hist[e.slot];
        if (!h || R.i - back < 0) return null;
        var hv = h[R.i - back];
        return hv === undefined ? null : hv;
      }
      var nowv = evalNode(e.base, env, R);
      var arr = R.hist[e.slot] || (R.hist[e.slot] = new Array(R.n));
      arr[R.i] = nowv;
      if (!back) return nowv;
      if (R.i - back < 0) return null;
      var pv = arr[R.i - back];
      return pv === undefined ? null : pv;
    }
    if (t === "call") return evalCall(e, env, R);
    throw Err(e.line || 0, 0, "this expression cannot be read");
  }

  function evalCall(e, env, R) {
    var i, a;
    if (e.isna) { var q = evalNode(e.args[0], env, R); return q === null || q === undefined; }
    if (e.user) {
      var f = R.fns[e.user];
      a = [];
      for (i = 0; i < e.args.length; i++) a.push(evalNode(e.args[i], env, R));
      if (R.depth >= LIM.depth) halt(R, "calls are nested more than " + LIM.depth + " deep — " + e.user + "() recurses without an end");
      R.depth++;
      var fe = frame(null);
      for (i = 0; i < f.params.length; i++) fe.v[f.params[i]] = a[i] === undefined ? null : a[i];
      R.last = null;
      execList(f.body, fe, R);
      R.depth--;
      return R.last;
    }
    if (e.sec) {
      var sv = R.sec[e.secid];
      if (!sv) return null;
      var vv = sv[R.i];
      return vv === undefined ? null : vv;
    }
    a = [];
    for (i = 0; i < e.a.length; i++) a[i] = e.a[i] === undefined ? undefined : evalNode(e.a[i], env, R);
    var st = e.sid == null ? null : (R.st[e.sid] || (R.st[e.sid] = {}));
    /* A library entry raises its complaint without knowing where it was
       called from; the call site is the only thing that does, so it is
       stamped on here rather than left as line 0. */
    try { return e.bi.f(a, R, st, e); }
    catch (x) {
      if (x && x.__h) throw x;
      if (isErr(x) && !x.line) { x.line = e.line; x.col = e.col; }
      throw x;
    }
  }

  /* 0 carry on · 1 break · 2 continue */
  function execStmt(s, env, R) {
    tick(R);
    R.line = s.line;
    var t = s.t, i, c;
    if (t === "expr") { R.last = evalNode(s.expr, env, R); return 0; }
    if (t === "decl") {
      if (s.isVar) {
        var flag = R.st[s.vflag] || (R.st[s.vflag] = {});
        if (flag.done) return 0;
        flag.done = 1;
      }
      store(s.ref, s.name, evalNode(s.init, env, R), env, R);
      return 0;
    }
    if (t === "assign") { store(s.ref, s.name, evalNode(s.expr, env, R), env, R); return 0; }
    if (t === "tuple") {
      var tv = evalNode(s.init, env, R);
      for (i = 0; i < s.names.length; i++) {
        store(s.refs[i], s.names[i], (tv && tv.length > i && tv[i] !== undefined) ? tv[i] : null, env, R);
      }
      return 0;
    }
    if (t === "if") {
      if (truthy(evalNode(s.cond, env, R))) return execList(s.body, frame(env), R);
      for (i = 0; i < s.elifs.length; i++) {
        if (truthy(evalNode(s.elifs[i].cond, env, R))) return execList(s.elifs[i].body, frame(env), R);
      }
      if (s.els) return execList(s.els, frame(env), R);
      return 0;
    }
    if (t === "for") {
      var from = N(evalNode(s.from, env, R)), to = N(evalNode(s.to, env, R));
      if (from == null || to == null) return 0;
      var by = s.by ? N(evalNode(s.by, env, R)) : null;
      var step = by == null || by === 0 ? (to < from ? -1 : 1) : by;
      var fe = frame(env), guard = 0, x = from;
      for (; step > 0 ? x <= to : x >= to; x += step) {
        R.line = s.line;
        if (++guard > LIM.loop) halt(R, "this loop ran more than " + LIM.loop + " times on one bar");
        fe.v[s.name] = x;
        c = execList(s.body, fe, R);
        if (c === 1) break;
      }
      return 0;
    }
    if (t === "while") {
      var g2 = 0;
      while (R.line = s.line, truthy(evalNode(s.cond, env, R))) {
        R.line = s.line;
        if (++g2 > LIM.loop) halt(R, "this loop ran more than " + LIM.loop + " times on one bar");
        c = execList(s.body, frame(env), R);
        if (c === 1) break;
      }
      return 0;
    }
    if (t === "break") return 1;
    if (t === "continue") return 2;
    if (t === "fn") return 0;
    return 0;
  }
  function execList(list, env, R) {
    var i, c;
    for (i = 0; i < list.length; i++) {
      c = execStmt(list[i], env, R);
      if (c === 1) return 1;
      if (c === 2) return 2;
    }
    return 0;
  }
  function store(ref, name, v, env, R) {
    if (ref && ref.k === "g") { R.vals[ref.slot] = v; return; }
    setLocal(env, name, v);
  }

  /* --------------------------------------------------- request.security
     The only honest higher-timeframe read available here: this symbol's own
     bars, bucketed up. The expression is re-run over the aggregate with its
     own slots and its own call-site state, and a bucket's answer is published
     on the chart bar where that bucket CLOSES — never before. */
  function buildSecurity(e, R) {
    var ms = tfMs(e.sec.tf), i;
    if (!ms || !R.barMs) return null;
    if (ms < R.barMs) {
      R.errors.push(Err(e.line, e.col, "request.security() can only go UP: this chart is on " + R.tf + " and \"" + e.sec.tf + "\" is shorter"));
      return null;
    }
    var agg = [], pos = new Array(R.n), cur = null, key = null;
    for (i = 0; i < R.n; i++) {
      var b = R.bars[i], k = Math.floor(b.t / ms);
      if (k !== key) {
        key = k;
        cur = { t: k * ms, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
        agg.push(cur);
      } else {
        if (b.h > cur.h) cur.h = b.h;
        if (b.l < cur.l) cur.l = b.l;
        cur.c = b.c; cur.v += b.v;
      }
      pos[i] = agg.length - 1;
    }
    var R2 = {
      bars: agg, n: agg.length, i: 0, params: R.params, vals: [], hist: [], st: [], fns: R.fns,
      out: [], strat: null, steps: R.steps, t0: R.t0, line: e.line, depth: 0, last: null,
      mintick: R.mintick, symbol: R.symbol, currency: R.currency, tf: e.sec.tf,
      tfMul: R.tfMul, barMs: ms, errors: R.errors, sec: [], rstate: R.rstate, rseed: R.rseed
    };
    var vals = new Array(agg.length), env = frame(null);
    for (i = 0; i < agg.length; i++) {
      R2.i = i;
      vals[i] = evalNode(e.sec.expr, env, R2);
    }
    R.steps = R2.steps;
    var out = new Array(R.n);
    for (i = 0; i < R.n; i++) {
      var p = pos[i];
      var closes = (i === R.n - 1) || pos[i + 1] !== p;
      var v = closes ? vals[p] : (p > 0 ? vals[p - 1] : null);
      out[i] = v === undefined ? null : v;
    }
    return out;
  }
  function walkSecurity(prog, R) {
    var seen = [];
    (function walk(n) {
      if (!n || typeof n !== "object") return;
      var k;
      if (n.t === "call" && n.sec && seen.indexOf(n) < 0) { seen.push(n); R.sec[n.secid] = buildSecurity(n, R); }
      for (k in n) {
        if (!has(n, k) || k === "ref" || k === "bi" || k === "sec") continue;
        var v = n[k];
        if (v && typeof v === "object") {
          if (Array.isArray(v)) { var q; for (q = 0; q < v.length; q++) walk(v[q]); }
          else walk(v);
        }
      }
    })({ t: "root", body: prog });
  }

  /* =====================================================================
     9 · ROWS — what the script drew, in the shapes the renderer knows
     ===================================================================== */

  function medianStep(bars) {
    var d = [], i, m = Math.min(bars.length - 1, 50);
    for (i = 1; i <= m; i++) { var q = bars[i].t - bars[i - 1].t; if (q > 0) d.push(q); }
    if (!d.length) return 3600000;
    d.sort(function (a, b) { return a - b; });
    return d[d.length >> 1];
  }
  function tfName(ms) {
    var k;
    for (k in TFMS) if (has(TFMS, k) && TFMS[k] === ms) return k;
    return ms >= 86400000 ? Math.round(ms / 86400000) + "D" : Math.round(ms / 60000) + "m";
  }
  function tickOf(px) {
    var a = Math.abs(px);
    var dec = a >= 1000 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 5 : 8;
    return Math.pow(10, -dec);
  }

  function buildRows(R, meta, style, res) {
    var rows = [], levels = [], plots = [], alerts = [], i, j, o, d;
    var lo = Infinity, hi = -Infinity, zero = false;
    var dflt = (style && style.c) || null;

    /* first pass: the numeric plots, because everything else is placed
       against the range they occupy */
    for (i = 0; i < res.outs.length; i++) {
      d = res.outs[i]; o = R.out[i];
      if (d.fn !== "plot") continue;
      var c = o.last || (d.pidx === 0 ? dflt : null) || paletteAt(d.pidx);
      var w = o.w == null ? ((style && style.w) || 1.4) : o.w;
      var dash = (style && style.dash) || 0;
      var nm = o.title || ("Plot " + (d.pidx + 1));
      var st = o.style || "line";
      var varied = false;
      for (j = 0; j < R.n; j++) if (o.cols[j] && o.cols[j] !== c) { varied = true; break; }
      if (st === "line") rows.push({ kind: "line", data: o.vals, c: c, w: w, dash: dash, name: nm });
      else if (st === "stepline") rows.push({ kind: "step", data: o.vals, c: c, w: w, dash: dash, name: nm });
      else if (st === "area") rows.push({ kind: "area", data: o.vals, c: c, w: w, fill: 0.16, name: nm });
      else if (st === "histogram") { rows.push({ kind: "hist", data: o.vals, up: c, dn: o.last ? c : paletteAt(3), name: nm }); zero = true; }
      else if (st === "columns") { rows.push({ kind: "cols", data: o.vals, cols: varied ? o.cols : null, c: c, base: 0, name: nm }); zero = true; }
      else if (st === "circles") rows.push({ kind: "dots", data: o.vals, c: c, name: nm });
      else if (st === "cross") {
        var mk = new Array(R.n);
        for (j = 0; j < R.n; j++) mk[j] = o.vals[j] == null ? null : { v: o.vals[j], s: "cross", c: o.cols[j] || c };
        rows.push({ kind: "shapes", data: mk, c: c, name: nm });
      }
      plots.push({ title: nm, values: o.vals });
      for (j = 0; j < R.n; j++) {
        var v = o.vals[j];
        if (v == null || !isFinite(v)) continue;
        if (v > hi) hi = v;
        if (v < lo) lo = v;
      }
    }

    /* hlines are levels, and they widen the range a shape can be placed in */
    for (i = 0; i < res.outs.length; i++) {
      d = res.outs[i]; o = R.out[i];
      if (d.fn !== "hline" || o.v == null) continue;
      levels.push({ v: o.v, c: o.c || null, dash: o.dash == null ? 2 : o.dash, label: o.title || null });
      if (o.v > hi) hi = o.v;
      if (o.v < lo) lo = o.v;
    }

    if (!isFinite(hi) || !isFinite(lo)) {
      lo = Infinity; hi = -Infinity;
      for (j = 0; j < R.n; j++) { if (R.bars[j].h > hi) hi = R.bars[j].h; if (R.bars[j].l < lo) lo = R.bars[j].l; }
    }
    var span = (hi - lo) || Math.abs(hi) * 0.02 || 1;
    var topPx = hi - span * 0.02, botPx = lo + span * 0.02;

    function priceAt(m, k) {
      var b = R.bars[k];
      if (m.loc === "abovebar") return b.h;
      if (m.loc === "belowbar") return b.l;
      if (m.loc === "top") return topPx;
      if (m.loc === "bottom") return botPx;
      return m.abs == null ? b.c : m.abs;
    }

    for (i = 0; i < res.outs.length; i++) {
      d = res.outs[i]; o = R.out[i];
      if (d.fn === "plotshape") {
        var sh = new Array(R.n);
        for (j = 0; j < R.n; j++) {
          var m = o.vals[j];
          sh[j] = m ? { v: priceAt(m, j), s: m.s, c: m.c || dflt || paletteAt(i), txt: m.txt } : null;
        }
        rows.push({ kind: "shapes", data: sh, c: dflt || paletteAt(i), name: o.title || "Shape", below: (o.loc === "belowbar" || o.loc === "bottom") });
      } else if (d.fn === "plotchar") {
        var ch = new Array(R.n);
        for (j = 0; j < R.n; j++) {
          var m2 = o.vals[j];
          ch[j] = m2 ? { v: priceAt(m2, j), txt: m2.txt, c: m2.c || dflt || paletteAt(i), below: (m2.loc === "belowbar" || m2.loc === "bottom") } : null;
        }
        rows.push({ kind: "labels", data: ch, c: dflt || paletteAt(i), name: o.title || "Char" });
      } else if (d.fn === "label") {
        rows.push({ kind: "labels", data: o.vals, c: dflt || paletteAt(i), name: o.title || "Label" });
      } else if (d.fn === "bgcolor") {
        rows.push({ kind: "bg", data: o.vals, alpha: 1, name: "Background" });
      } else if (d.fn === "barcolor") {
        rows.push({ kind: "bg", data: o.vals, alpha: 0.5, name: "Bar colour (approximate)" });
      } else if (d.fn === "fill") {
        var A = null, Bv = null;
        for (j = 0; j < res.outs.length; j++) {
          if (res.outs[j].fn !== "plot") continue;
          if (res.outs[j].pidx === d.a) A = R.out[j].vals;
          if (res.outs[j].pidx === d.b) Bv = R.out[j].vals;
        }
        if (A && Bv) rows.push({ kind: "band", a: A, b: Bv, c: o.c || dflt || paletteAt(i), fill: 1 - (o.transp == null ? 0.85 : o.transp), name: "Fill" });
      } else if (d.fn === "alertcondition") {
        alerts.push({ title: o.title || "Alert", message: o.message || "", bars: o.bars.slice() });
      }
    }

    if (zero && (lo >= 0 || hi <= 0)) zero = false;
    return { rows: rows, levels: levels, plots: plots, alerts: alerts, zero: !meta.overlay && zero };
  }

  /* =====================================================================
     10 · THE PUBLIC API
     ===================================================================== */

  function compile(source) {
    try {
      if (typeof source !== "string") throw Err(0, 0, "a script is text; this is not");
      if (source.length > LIM.source) throw Err(0, 0, "a script may be at most " + Math.round(LIM.source / 1024) + " KB — this one is " + Math.round(source.length / 1024) + " KB");
      var lr = lex(source);
      if (lr.err) throw lr.err;
      var P = new Parser(lr.toks, source);
      var body = P.program();
      var res = new Resolver(source).run(body);
      var warn = res.warnings.slice();
      if (!res.sawDecl) warn.push({ line: 1, col: 1, msg: "there is no study() or strategy() line, so this script is listed as \"" + res.meta.title + "\"" });
      if (!res.outs.length) warn.push({ line: 1, col: 1, msg: "nothing in this script draws — add a plot()" });
      if (res.meta.kind === "strategy" && !res.meta.overlay) warn.push({ line: 1, col: 1, msg: "a strategy usually wants overlay = true so its entries sit on the price" });
      var meta = {
        title: res.meta.title, short: res.meta.short, overlay: res.meta.overlay,
        kind: res.meta.kind, precision: res.meta.precision, inputs: res.inputs.slice(),
        range: res.meta.range || null
      };
      return { ok: true, errors: [], warnings: warn, meta: meta, prog: { __p: 1, body: body, res: res, meta: meta, src: source } };
    } catch (e) {
      if (isErr(e)) return { ok: false, errors: [{ line: e.line, col: e.col, msg: e.msg }], warnings: [], meta: null, prog: null };
      fault("compile", e);
      return { ok: false, errors: [{ line: 0, col: 0, msg: "the compiler tripped over this script: " + ((e && e.message) || e) }], warnings: [], meta: null, prog: null };
    }
  }

  function run(prog, bars, params, style) {
    var t0 = Date.now();
    var empty = { rows: [], levels: [], zero: false, range: null, alerts: [], strategy: null, plots: [], errors: [], steps: 0, ms: 0 };
    if (!prog || !prog.__p) { empty.errors = [{ line: 0, msg: "run() was handed something compile() did not make" }]; return empty; }
    if (!bars || !bars.length) { empty.errors = [{ line: 0, msg: "there are no bars to run over" }]; return empty; }
    var res = prog.res, meta = prog.meta, n = bars.length, i, k;
    var barMs = medianStep(bars);
    var R = {
      bars: bars, n: n, i: 0, params: params || {}, vals: [], hist: [], st: [], fns: res.fns,
      out: [], strat: null, steps: 0, t0: t0, line: 0, depth: 0, last: null, sec: [],
      errors: [], rstate: 22695477, rseed: null,
      mintick: tickOf(bars[bars.length - 1].c),
      symbol: (style && style.symbol) || symbolNow(),
      currency: (style && style.currency) || currencyNow(),
      tf: (style && style.tf) || tfName(barMs),
      barMs: barMs
    };
    R.tfMul = parseInt(R.tf, 10) || 1;
    for (i = 0; i < res.gslots.length; i++) R.hist[res.gslots[i]] = new Array(n);

    /* one record per output call, allocated once so the per-bar pass only writes */
    for (i = 0; i < res.outs.length; i++) {
      var d = res.outs[i];
      var rec = { title: null, titled: false, bars: [], vals: null, cols: null, w: null, style: null, last: null };
      if (d.fn === "plot" || d.fn === "plotshape" || d.fn === "plotchar" || d.fn === "label" || d.fn === "bgcolor" || d.fn === "barcolor") {
        rec.vals = nul(n); rec.cols = nul(n);
      }
      R.out.push(rec);
    }
    if (meta.kind === "strategy") R.strat = mkStrat(res.meta.strat || { capital: 10000, commission: 0, slippage: 0, pyramiding: 1, qty: 1 }, n, R.mintick);

    try {
      walkSecurity(prog.body, R);
      for (i = 0; i < n; i++) {
        R.i = i;
        if (R.strat) drain(R.strat, R, i);
        execList(prog.body, frame(null), R);
        if (R.strat) mark(R.strat, R, i);
        for (k = 0; k < res.gslots.length; k++) R.hist[res.gslots[k]][i] = R.vals[res.gslots[k]];
      }
    } catch (e) {
      if (e && e.__h) R.errors.push({ line: e.e.line, msg: e.e.msg });
      else if (isErr(e)) R.errors.push({ line: e.line, msg: e.msg });
      else { fault("run", e); R.errors.push({ line: R.line, msg: "this script stopped: " + ((e && e.message) || e) }); }
    }

    var built;
    try { built = buildRows(R, meta, style, res); }
    catch (e2) { fault("rows", e2); built = { rows: [], levels: [], plots: [], alerts: [], zero: false }; }

    var strat = null;
    if (R.strat) strat = { trades: R.strat.trades, equity: R.strat.equity, stats: stratStats(R.strat, R) };

    return {
      rows: built.rows, levels: built.levels, zero: built.zero,
      range: meta.range || null, alerts: built.alerts, strategy: strat,
      plots: built.plots, errors: R.errors, steps: R.steps, ms: Date.now() - t0
    };
  }

  function symbolNow() {
    try { return KIT && KIT.symKey ? String(KIT.symKey()).split("-")[0] : ""; } catch (e) { return ""; }
  }
  function currencyNow() {
    try { var p = KIT && KIT.symKey ? String(KIT.symKey()).split("-") : []; return p[1] || "USD"; } catch (e) { return "USD"; }
  }

  /* ------------------------------------------------------------ the editor */

  function tokensOf(source) {
    var out = [], r, i, t;
    try { r = lex(String(source == null ? "" : source)); } catch (e) { return out; }
    var toks = r.toks || [], coms = r.coms || [];
    for (i = 0; i < toks.length; i++) {
      t = toks[i];
      if (t.k === "nl" || t.k === "ind" || t.k === "ded" || t.k === "eof") continue;
      var kind;
      if (t.k === "num") kind = "num";
      else if (t.k === "str") kind = "str";
      else if (t.k === "op") kind = "op";
      else if (t.k === "punc") kind = "punc";
      else {
        var nx = toks[i + 1];
        if (nx && nx.k === "punc" && nx.v === "(") kind = "fn";
        else if (KW[t.v] || SERIES[t.v] || CONSTS[t.v] || NAMESPACE[t.v]) kind = "kw";
        else kind = "id";
      }
      out.push({ k: kind, s: t.s, e: t.e });
    }
    for (i = 0; i < coms.length; i++) out.push({ k: "com", s: coms[i].s, e: coms[i].e });
    out.sort(function (a, b) { return a.s - b.s; });
    return out;
  }

  function lint(source) {
    var c = compile(source), out = [], i;
    for (i = 0; i < c.errors.length; i++) out.push({ line: c.errors[i].line, col: c.errors[i].col, msg: c.errors[i].msg, severity: "error" });
    for (i = 0; i < c.warnings.length; i++) out.push({ line: c.warnings[i].line, col: c.warnings[i].col || 1, msg: c.warnings[i].msg, severity: "warning" });
    return out;
  }

  function docs() {
    var out = [], k;
    for (k in BI) {
      if (!has(BI, k)) continue;
      var b = BI[k], dot = k.indexOf(".");
      out.push({ ns: dot > 0 ? k.slice(0, dot) : "global", name: dot > 0 ? k.slice(dot + 1) : k, sig: b.sig || k, about: b.about || "" });
    }
    for (k in SERIES) if (has(SERIES, k)) out.push({ ns: "series", name: k, sig: k + " → series", about: "The bar's " + k + "." });
    for (k in CONSTS) {
      if (!has(CONSTS, k)) continue;
      var d2 = k.indexOf(".");
      out.push({ ns: d2 > 0 ? k.slice(0, d2) : "const", name: d2 > 0 ? k.slice(d2 + 1) : k, sig: k, about: "A constant." });
    }
    out.sort(function (a, b) { return a.ns === b.ns ? (a.name < b.name ? -1 : 1) : (a.ns < b.ns ? -1 : 1); });
    return out;
  }

  /* ------------------------------------------------- registering with DXC */

  var REG = {};
  function defsOf() { try { return DXC && DXC.studyDefs ? DXC.studyDefs() : null; } catch (e) { return null; } }

  function engineInputs(meta) {
    var out = [], i;
    for (i = 0; i < meta.inputs.length; i++) {
      var r = meta.inputs[i];
      if (r.type === "bool") out.push({ k: r.k, l: r.l, d: r.d ? "on" : "off", opts: ["on", "off"] });
      else if (r.type === "string") out.push({ k: r.k, l: r.l, d: r.d, opts: (r.opts && r.opts.length) ? r.opts.slice() : [r.d] });
      else if (r.type === "source" || r.type === "color") out.push({ k: r.k, l: r.l, d: r.d, opts: (r.opts || []).slice() });
      else out.push({ k: r.k, l: r.l, d: r.d, step: r.step == null ? 1 : r.step });
    }
    return out;
  }

  function register(id, source) {
    if (!DXC || typeof DXC.registerStudy !== "function") return { ok: false, errors: [{ line: 0, col: 0, msg: "the chart engine is not on this page" }], key: null, meta: null };
    if (!id || !/^[A-Za-z0-9_-]{1,40}$/.test(String(id))) return { ok: false, errors: [{ line: 0, col: 0, msg: "a script id is 1–40 letters, digits, dashes or underscores" }], key: null, meta: null };
    var c = compile(source);
    if (!c.ok) return { ok: false, errors: c.errors, key: null, meta: null };
    var key = "dxs:" + id, D = defsOf();
    if (!D) return { ok: false, errors: [{ line: 0, col: 0, msg: "the chart engine did not open its study registry" }], key: null, meta: null };
    /* Re-registering the same id is an edit, not a removal: the def is swapped
       under the key and registerStudy rebuilds the key list, so an instance
       already on the chart keeps its place and simply recomputes. */
    if (D[key]) delete D[key];
    var meta = c.meta, prog = c.prog;
    var def = {
      name: meta.title, g: "Scripts", over: meta.overlay, in: engineInputs(meta),
      calc: function (bs, p, s) {
        var r = run(prog, bs, p || {}, s || {});
        var out = { rows: r.rows, levels: r.levels, zero: r.zero };
        if (r.range) out.range = r.range;
        if (r.errors.length) out.note = "line " + r.errors[0].line + ": " + r.errors[0].msg;
        return out;
      }
    };
    if (!DXC.registerStudy(key, def)) {
      return { ok: false, errors: [{ line: 0, col: 0, msg: "the engine refused this definition" }], key: null, meta: null };
    }
    REG[id] = { id: id, key: key, meta: meta, prog: prog, source: source };
    return { ok: true, errors: [], key: key, meta: meta };
  }

  /* The engine's half of the contract. unregisterStudy drops the def, rebuilds
     the key list, takes any instance of it off the chart, saves, clears the
     computed-study cache and repaints — all of which this layer used to have no
     way to ask for. There is nothing left to do here but ask. */
  function unregister(id) {
    if (!REG[id] || !DXC) return false;
    var key = REG[id].key, i;
    if (typeof DXC.unregisterStudy === "function") {
      var gone = DXC.unregisterStudy(key);
      if (gone) delete REG[id];
      return !!gone;
    }
    /* An engine older than the removal half. Its key list is recomputed only
       inside registerStudy, and its indicator dialog reads a def per key with
       no null guard, so deleting the def here would leave the dialog reaching
       into a hole. The instances come off the chart, the def stays, and the
       answer is an honest false rather than a workaround that leaves an inert
       entry behind. */
    try {
      var live = DXC.studies().slice();
      for (i = 0; i < live.length; i++) if (live[i].k === key) DXC.removeStudy(live[i].id);
    } catch (e) { fault("unregister", e); }
    return false;
  }

  function registered() {
    var out = [], id;
    for (id in REG) if (has(REG, id)) out.push({ id: id, key: REG[id].key, meta: REG[id].meta });
    return out;
  }

  /* =====================================================================
     THE STARTING TEMPLATES
     Six scripts, one per feature area, kept short enough to read in one
     screen. Layer 54 uses them as the editor's opening documents, so each
     one has to compile and draw exactly as written.
     ===================================================================== */

  var PRELUDE = [
    {
      name: "Two moving averages",
      about: "The smallest complete script: two averages and two plots.",
      src: "//@version=1\n" +
        "study(\"Two moving averages\", overlay=true, precision=2)\n" +
        "\n" +
        "fast = ta.ema(close, 12)\n" +
        "slow = ta.ema(close, 26)\n" +
        "\n" +
        "plot(fast, \"Fast\", color=\"#5B8CFF\", linewidth=2)\n" +
        "plot(slow, \"Slow\", color=\"#F5A623\")\n"
    },
    {
      name: "RSI with inputs",
      about: "Every input type the settings dialog can render, and a fixed 0–100 pane.",
      src: "//@version=1\n" +
        "study(\"RSI with inputs\", overlay=false, precision=2, range_lo=0, range_hi=100)\n" +
        "\n" +
        "len   = input.int(14, \"Length\", minval=2, maxval=500)\n" +
        "src   = input.source(close, \"Source\")\n" +
        "ob    = input.float(70, \"Overbought\", step=0.5)\n" +
        "smooth = input.bool(true, \"Show signal\")\n" +
        "mode  = input.string(\"EMA\", \"Signal type\", options=[\"EMA\", \"SMA\", \"WMA\"])\n" +
        "lc    = input.color(\"#00E5FF\", \"Line\")\n" +
        "\n" +
        "r = ta.rsi(src, len)\n" +
        "m = mode == \"EMA\" ? ta.ema(r, 14) : mode == \"SMA\" ? ta.sma(r, 14) : ta.wma(r, 14)\n" +
        "\n" +
        "plot(r, \"RSI\", color=lc, linewidth=2)\n" +
        "plot(smooth ? m : na, \"Signal\", color=\"#FFD166\")\n" +
        "hline(ob, \"Overbought\", color=\"#FF5A78\", dash=\"dashed\")\n" +
        "hline(30, \"Oversold\", color=\"#22D39A\", dash=\"dashed\")\n"
    },
    {
      name: "Crossover markers",
      about: "plotshape, an if block and a var counter that survives the bar.",
      src: "//@version=1\n" +
        "study(\"Crossover markers\", overlay=true)\n" +
        "\n" +
        "fast = ta.ema(close, 9)\n" +
        "slow = ta.ema(close, 21)\n" +
        "up   = ta.crossover(fast, slow)\n" +
        "dn   = ta.crossunder(fast, slow)\n" +
        "\n" +
        "var int flips = 0\n" +
        "if up or dn\n" +
        "    flips := flips + 1\n" +
        "\n" +
        "plot(fast, \"Fast\", color=\"#5B8CFF\")\n" +
        "plot(slow, \"Slow\", color=\"#7E8AB8\")\n" +
        "plotshape(up, \"Long\", draw=\"triangleup\", location=\"belowbar\", color=\"#22D39A\", text=\"L\")\n" +
        "plotshape(dn, \"Short\", draw=\"triangledown\", location=\"abovebar\", color=\"#FF5A78\", text=\"S\")\n" +
        "alertcondition(up, \"EMA cross up\", \"The fast EMA crossed above the slow one\")\n"
    },
    {
      name: "Bollinger channel",
      about: "A multi-value builtin read into three names, a fill between two plots and a background tint.",
      src: "//@version=1\n" +
        "study(\"Bollinger channel\", overlay=true, precision=2)\n" +
        "\n" +
        "len  = input.int(20, \"Length\", minval=2, maxval=400)\n" +
        "mult = input.float(2, \"Deviations\", step=0.1)\n" +
        "\n" +
        "[mid, up, dn] = ta.bb(close, len, mult)\n" +
        "\n" +
        "plot(up, \"Upper\", color=\"#5B8CFF\")\n" +
        "plot(dn, \"Lower\", color=\"#5B8CFF\")\n" +
        "plot(mid, \"Basis\", color=\"#F5A623\")\n" +
        "fill(0, 1, color=\"#5B8CFF\", transp=0.9)\n" +
        "bgcolor(close > up ? color.new(\"#FF5A78\", 0.88) : na)\n"
    },
    {
      name: "Loop and function",
      about: "A for loop, a function of your own and the history operator working together.",
      src: "//@version=1\n" +
        "study(\"Loop and function\", overlay=true, precision=2)\n" +
        "\n" +
        "len = input.int(20, \"Length\", minval=1, maxval=200)\n" +
        "\n" +
        "weight(k, n) => (n - k) / n\n" +
        "\n" +
        "total = 0.0\n" +
        "wsum  = 0.0\n" +
        "for i = 0 to len - 1\n" +
        "    w = weight(i, len)\n" +
        "    total := total + close[i] * w\n" +
        "    wsum  := wsum + w\n" +
        "\n" +
        "avg = wsum > 0 ? total / wsum : na\n" +
        "\n" +
        "plot(avg, \"Weighted mean\", color=\"#B36BFF\", linewidth=2)\n"
    },
    {
      name: "EMA cross backtest",
      about: "A strategy. Every order is filled at the next bar's open, never at the close that triggered it.",
      src: "//@version=1\n" +
        "strategy(\"EMA cross backtest\", overlay=true, initial_capital=10000, commission=0.04, slippage=1, default_qty=1)\n" +
        "\n" +
        "fastLen = input.int(10, \"Fast\", minval=1, maxval=200)\n" +
        "slowLen = input.int(30, \"Slow\", minval=2, maxval=400)\n" +
        "\n" +
        "fast = ta.ema(close, fastLen)\n" +
        "slow = ta.ema(close, slowLen)\n" +
        "\n" +
        "if ta.crossover(fast, slow)\n" +
        "    strategy.entry(\"long\", \"long\")\n" +
        "\n" +
        "if ta.crossunder(fast, slow)\n" +
        "    strategy.close(\"long\")\n" +
        "\n" +
        "plot(fast, \"Fast\", color=\"#22D39A\")\n" +
        "plot(slow, \"Slow\", color=\"#FF5A78\")\n"
    }
  ];

  return {
    __v: 1,
    compile: compile,
    run: run,
    register: register,
    unregister: unregister,
    registered: registered,
    lint: lint,
    tokens: tokensOf,
    limits: function () {
      return {
        steps: LIM.steps, ms: LIM.ms, depth: LIM.depth, loop: LIM.loop,
        array: LIM.array, plots: LIM.plots, slots: LIM.slots, source: LIM.source
      };
    },
    docs: docs,
    PRELUDE: PRELUDE
  };
})();
