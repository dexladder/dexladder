# -*- coding: utf-8 -*-
"""
The display currency.

The payload already had a currency toggle, and it moved exactly one table: the
markets rows read priceStr()/moneyStr(), and every other money figure in the app
— coin pages, the terminal, the screener, the portfolio, tickets, desks, labs,
charts — was a literal "$" concatenated onto a USD number. Picking INR changed
seven hundred numbers on one screen and nothing anywhere else.

This pass makes the choice global. It runs LAST, against the assembled payload
(v153 + every patch + every layer), so a money site introduced by a layer is
transformed with the same rules as one in the base file.

Three steps, all count-asserted:

  1. the formatters — the dozen functions every money string in the app goes
     through. Each converts at the leaf and asks DLCUR for the symbol, the
     locale and the decimal count. A formatter that DELEGATES to another
     formatter is left alone, so a value is never converted twice.
  2. the direct sites — every remaining `"$"+expr` and `$${expr}`. Each is
     classified; the numeric expression is wrapped in DLCUR.c() and the literal
     symbol becomes DLCUR.s(). Nothing is transformed on a guess: a site that
     does not match a known shape fails the build.
  3. the wiring — qRate/qSym/MX.rate/setCur delegate to DLCUR, and the five
     button segment becomes the full list.

DENIED, deliberately:
  cashtags      "$"+c.sym / $${sym} — a ticker, not a price
  taxReport     DLTAX figures are stated in the jurisdiction's own currency
  renderTax     idem
  p2pMine       the P2P bazaar prices every offer in its own fiat (P2FX)
  x402Run       an x402 invoice is denominated in USDC by the protocol
  marketView    a raw input string, not a number
  exportReport  the report's fields arrive pre-formatted as strings
"""

import os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _fail(msg):
    raise SystemExit('cur: ' + msg)


def _sub(out, find, repl, n, tag):
    got = out.count(find)
    if got != n:
        _fail('%s: expected %d of %r, found %d' % (tag, n, find[:70], got))
    return out.replace(find, repl)


# --------------------------------------------------------------- 1 · formatters
# (tag, exact source, replacement, count). Every one of these is a LEAF: it
# formats a USD number itself. Wrappers (cU, usd, txt, priceTxt's first branch)
# are not here — they hand the number to a leaf, which converts it once.
S = 'DLCUR.s()'
C = 'DLCUR.c'

FORMATTERS = [
 ('fmt$-2dp',
  'function fmt$(v){if(!isFinite(v))return"—";var a=Math.abs(v);return a>=1e12?"$"+(v/1e12).toFixed(2)+"T":a>=1e9?"$"+(v/1e9).toFixed(2)+"B":a>=1e6?"$"+(v/1e6).toFixed(2)+"M":a>=1e3?"$"+(v/1e3).toFixed(1)+"K":"$"+v.toFixed(2)}',
  'function fmt$(v){if(!isFinite(v))return"—";v=DLCUR.c(v);var a=Math.abs(v);return a>=1e12?DLCUR.s()+(v/1e12).toFixed(2)+"T":a>=1e9?DLCUR.s()+(v/1e9).toFixed(2)+"B":a>=1e6?DLCUR.s()+(v/1e6).toFixed(2)+"M":a>=1e3?DLCUR.s()+(v/1e3).toFixed(1)+"K":DLCUR.s()+v.toFixed(DLCUR.dp(2))}',
  2),
 ('fmt$-6dp',
  'function fmt$(v){if(!isFinite(v))return"—";var a=Math.abs(v);return a>=1e12?"$"+(v/1e12).toFixed(2)+"T":a>=1e9?"$"+(v/1e9).toFixed(2)+"B":a>=1e6?"$"+(v/1e6).toFixed(2)+"M":a>=1e3?"$"+(v/1e3).toFixed(1)+"K":"$"+(a>=1?v.toFixed(2):v.toFixed(6))}',
  'function fmt$(v){if(!isFinite(v))return"—";v=DLCUR.c(v);var a=Math.abs(v);return a>=1e12?DLCUR.s()+(v/1e12).toFixed(2)+"T":a>=1e9?DLCUR.s()+(v/1e9).toFixed(2)+"B":a>=1e6?DLCUR.s()+(v/1e6).toFixed(2)+"M":a>=1e3?DLCUR.s()+(v/1e3).toFixed(1)+"K":DLCUR.s()+(a>=1?v.toFixed(DLCUR.dp(2)):v.toFixed(DLCUR.dp(6)))}',
  1),
 # big() buckets by magnitude, so it must convert BEFORE it picks the suffix —
 # otherwise $900B in rupees prints as ₹74,880B instead of ₹74.88T. money() is
 # inlined here rather than called, because money() converts too.
 ('big-money',
  'function big(v){return isFinite(v)?v>=1e12?"$"+(v/1e12).toFixed(2)+"T":v>=1e9?"$"+(v/1e9).toFixed(2)+"B":v>=1e6?"$"+(v/1e6).toFixed(2)+"M":v>=1e3?"$"+(v/1e3).toFixed(1)+"K":money(v):"—"}',
  'function big(v){return isFinite(v)?(v=DLCUR.c(v),v>=1e12?DLCUR.s()+(v/1e12).toFixed(2)+"T":v>=1e9?DLCUR.s()+(v/1e9).toFixed(2)+"B":v>=1e6?DLCUR.s()+(v/1e6).toFixed(2)+"M":v>=1e3?DLCUR.s()+(v/1e3).toFixed(1)+"K":DLCUR.s()+Number(v).toLocaleString(DLCUR.loc(),{maximumFractionDigits:DLCUR.dp(2)})):"—"}',
  2),
 ('big-money-coerce',
  'function big(v){return v=+v,isFinite(v)?v>=1e12?"$"+(v/1e12).toFixed(2)+"T":v>=1e9?"$"+(v/1e9).toFixed(2)+"B":v>=1e6?"$"+(v/1e6).toFixed(2)+"M":v>=1e3?"$"+(v/1e3).toFixed(1)+"K":money(v):"—"}',
  'function big(v){return v=+v,isFinite(v)?(v=DLCUR.c(v),v>=1e12?DLCUR.s()+(v/1e12).toFixed(2)+"T":v>=1e9?DLCUR.s()+(v/1e9).toFixed(2)+"B":v>=1e6?DLCUR.s()+(v/1e6).toFixed(2)+"M":v>=1e3?DLCUR.s()+(v/1e3).toFixed(1)+"K":DLCUR.s()+Number(v).toLocaleString(DLCUR.loc(),{maximumFractionDigits:DLCUR.dp(2)})):"—"}',
  1),
 ('money-min',
  'function money(v,d){try{return"$"+Number(v).toLocaleString(void 0,{maximumFractionDigits:null==d?2:d})}catch(e){return"$"+v}}',
  'function money(v,d){try{return DLCUR.s()+Number(DLCUR.c(v)).toLocaleString(DLCUR.loc(),{maximumFractionDigits:DLCUR.dp(null==d?2:d)})}catch(e){return DLCUR.s()+v}}',
  3),
 ('money-pretty',
  'function money(v, d) { v = +v || 0; if (d == null) d = v >= 1000 ? 0 : v >= 1 ? 2 : v >= 0.01 ? 4 : 6; return "$" + v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }); }',
  'function money(v, d) { v = DLCUR.c(+v || 0); if (d == null) d = v >= 1000 ? 0 : v >= 1 ? 2 : v >= 0.01 ? 4 : 6; d = DLCUR.dp(d); return DLCUR.s() + v.toLocaleString(DLCUR.loc(), { minimumFractionDigits: d, maximumFractionDigits: d }); }',
  1),
 ('cUSD',
  'function cUSD(n){if(!n)return"$0";const a=Math.abs(n);return a>=1e12?"$"+(n/1e12).toFixed(2)+"T":a>=1e9?"$"+(n/1e9).toFixed(2)+"B":a>=1e6?"$"+(n/1e6).toFixed(2)+"M":a>=1e3?"$"+(n/1e3).toFixed(1)+"K":"$"+n.toFixed(0)}',
  'function cUSD(n){if(!n)return DLCUR.s()+"0";n=DLCUR.c(n);const a=Math.abs(n);return a>=1e12?DLCUR.s()+(n/1e12).toFixed(2)+"T":a>=1e9?DLCUR.s()+(n/1e9).toFixed(2)+"B":a>=1e6?DLCUR.s()+(n/1e6).toFixed(2)+"M":a>=1e3?DLCUR.s()+(n/1e3).toFixed(1)+"K":DLCUR.s()+n.toFixed(DLCUR.dp(0))}',
  1),
 # txt() prefers cUSD; only its own fallback formats, so only that converts.
 ('txt-fallback',
  'var a=Math.abs(n);return a>=1e12?"$"+(n/1e12).toFixed(2)+"T":a>=1e9?"$"+(n/1e9).toFixed(2)+"B":a>=1e6?"$"+(n/1e6).toFixed(2)+"M":"$"+Math.round(n)}',
  'n=DLCUR.c(n);var a=Math.abs(n);return a>=1e12?DLCUR.s()+(n/1e12).toFixed(2)+"T":a>=1e9?DLCUR.s()+(n/1e9).toFixed(2)+"B":a>=1e6?DLCUR.s()+(n/1e6).toFixed(2)+"M":DLCUR.s()+Math.round(n)}',
  1),
 ('px-pretty',
  'function px(v) { v = +v || 0; return v >= 1000 ? "$" + v.toFixed(0) : v >= 1 ? "$" + v.toFixed(2) : v >= 0.01 ? "$" + v.toFixed(4) : v >= 1e-6 ? "$" + v.toFixed(7) : "$" + v.toExponential(2); }',
  'function px(v) { v = DLCUR.c(+v || 0); return v >= 1000 ? DLCUR.s() + v.toFixed(DLCUR.dp(0)) : v >= 1 ? DLCUR.s() + v.toFixed(DLCUR.dp(2)) : v >= 0.01 ? DLCUR.s() + v.toFixed(4) : v >= 1e-6 ? DLCUR.s() + v.toFixed(7) : DLCUR.s() + v.toExponential(2); }',
  1),
 ('fmtPx-pretty',
  'function fmtPx(v) { v = +v || 0; return v >= 1000 ? "$" + v.toFixed(0) : v >= 1 ? "$" + v.toFixed(2) : v >= 0.01 ? "$" + v.toFixed(4) : v >= 1e-6 ? "$" + v.toFixed(7) : "$" + v.toExponential(2); }',
  'function fmtPx(v) { v = DLCUR.c(+v || 0); return v >= 1000 ? DLCUR.s() + v.toFixed(DLCUR.dp(0)) : v >= 1 ? DLCUR.s() + v.toFixed(DLCUR.dp(2)) : v >= 0.01 ? DLCUR.s() + v.toFixed(4) : v >= 1e-6 ? DLCUR.s() + v.toFixed(7) : DLCUR.s() + v.toExponential(2); }',
  1),
 ('fmtUSD',
  'function fmtUSD(v){if(null==v||isNaN(v))return"—";var d=v>=1e3?0:v>=1?2:6;return"$"+Number(v).toLocaleString("en-US",{minimumFractionDigits:Math.min(d,2),maximumFractionDigits:d})}',
  'function fmtUSD(v){if(null==v||isNaN(v))return"—";v=DLCUR.c(v);var d=DLCUR.dp(v>=1e3?0:v>=1?2:6);return DLCUR.s()+Number(v).toLocaleString(DLCUR.loc(),{minimumFractionDigits:Math.min(d,2),maximumFractionDigits:d})}',
  1),
 ('priceTxt-fallback',
  'return"$"+Number(c.price).toLocaleString(void 0,{maximumFractionDigits:c.price<1?6:2})}',
  'return DLCUR.s()+Number(DLCUR.c(c.price)).toLocaleString(DLCUR.loc(),{maximumFractionDigits:DLCUR.dp(c.price<1?6:2)})}',
  1),
 ('fmtQ',
  'function fmtQ(v,q){const cr="BTC"===q||"ETH"===q;return qSym(q)+fmt(v,cr?v<1?8:6:dp(v))+(cr?" "+q:"")}',
  'function fmtQ(v,q){const cr="BTC"===q||"ETH"===q;if(!cr&&("USD"===q||"USDT"===q)){const w=DLCUR.c(v);return DLCUR.s()+fmt(w,DLCUR.dp(dp(w)))}return qSym(q)+fmt(v,cr?v<1?8:6:dp(v))+(cr?" "+q:"")}',
  1),
 ('fmtP',
  'function fmtP(v){if(null==v||isNaN(v))return"—";var d=v>=1e3?0:v>=1?2:4;return"$"+Number(v).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d})}',
  'function fmtP(v){if(null==v||isNaN(v))return"—";v=DLCUR.c(v);var d=DLCUR.dp(v>=1e3?0:v>=1?2:4);return DLCUR.s()+Number(v).toLocaleString(DLCUR.loc(),{minimumFractionDigits:d,maximumFractionDigits:d})}',
  1),
]


# ------------------------------------------------------------- 2 · direct sites
DENY_FN = {'taxReport', 'renderTax', 'p2pMine', 'x402Run', 'marketView', 'exportReport'}
# a cashtag is a ticker with a dollar sign in front of it, never a price
CASHTAG = re.compile(r'^([A-Za-z0-9_$]+\.)?sym$|^sym$')

NUMFMT = {'fmt', 'fmtN', 'cNum', 'cNumX', 'compact', 'Number', 'num',
          'Math.abs', 'Math.round', 'Math.floor', 'Math.max', 'Math.min', 'C.big'}
METHODS = ('.toFixed(', '.toLocaleString(', '.toExponential(', '.toPrecision(')
CALL = re.compile(r'([A-Za-z_$][A-Za-z0-9_$.]*)\s*\(')
FN = re.compile(r'function\s+([A-Za-z0-9_$]+)\s*\(')


def _balanced(s, i, open_c='(', close_c=')'):
    d = 0
    while i < len(s):
        c = s[i]
        if c == open_c:
            d += 1
        elif c == close_c:
            d -= 1
            if d == 0:
                return i + 1
        elif c in '"\'':
            q = c; i += 1
            while i < len(s) and s[i] != q:
                if s[i] == '\\':
                    i += 1
                i += 1
        i += 1
    return -1


def _split_args(inner):
    """top-level comma split"""
    out, d, cur, i = [], 0, '', 0
    while i < len(inner):
        c = inner[i]
        if c in '([{':
            d += 1
        elif c in ')]}':
            d -= 1
        elif c in '"\'`':
            q = c; cur += c; i += 1
            while i < len(inner) and inner[i] != q:
                if inner[i] == '\\':
                    cur += inner[i]; i += 1
                cur += inner[i]; i += 1
            cur += inner[i] if i < len(inner) else ''
            i += 1
            continue
        if c == ',' and d == 0:
            out.append(cur); cur = ''
        else:
            cur += c
        i += 1
    out.append(cur)
    return out


def _ternary(e):
    """(cond ? <a number> : "—") — convert the arms that are numbers."""
    if not (e.startswith('(') and e.endswith(')')):
        return None
    inner = e[1:-1]
    d = 0
    qm = -1
    i = 0
    while i < len(inner):
        ch = inner[i]
        if ch in '([{':
            d += 1
        elif ch in ')]}':
            d -= 1
        elif ch in '"\'`':
            q = ch; i += 1
            while i < len(inner) and inner[i] != q:
                if inner[i] == '\\':
                    i += 1
                i += 1
        elif ch == '?' and d == 0:
            qm = i; break
        i += 1
    if qm < 0:
        return None
    d = 0
    j = qm + 1
    colon = -1
    while j < len(inner):
        ch = inner[j]
        if ch in '([{':
            d += 1
        elif ch in ')]}':
            d -= 1
        elif ch in '"\'`':
            q = ch; j += 1
            while j < len(inner) and inner[j] != q:
                if inner[j] == '\\':
                    j += 1
                j += 1
        elif ch == ':' and d == 0:
            colon = j; break
        j += 1
    if colon < 0:
        return None
    cond, a, b = inner[:qm], inner[qm + 1:colon], inner[colon + 1:]

    def arm(x):
        x = x.strip()
        if re.match(r'^["\'].*["\']$', x):     # a dash or a label, left alone
            return x
        c = _conv(x)
        return c if c else None
    ca, cb = arm(a), arm(b)
    if ca is None or cb is None:
        return None
    return '(' + cond + '?' + ca + ':' + cb + ')'


def _conv(expr):
    """Wrap the numeric value inside a formatting expression in DLCUR.c().
    Returns None when the shape is not one this pass understands."""
    e = expr.strip()
    if not e:
        return None
    if e.startswith('(') and '?' in e:
        t = _ternary(e)
        if t:
            return t
    m = CALL.match(e)
    if m and _balanced(e, m.end() - 1) == len(e):
        name = m.group(1)
        inner = e[m.end():len(e) - 1]
        if name in NUMFMT:
            args = _split_args(inner)
            args[0] = 'DLCUR.c(' + args[0].strip() + ')'
            # a decimal count computed from the same value must see the converted one
            if len(args) > 1 and re.search(r'\bdp\(', args[1]):
                args[1] = re.sub(r'\bdp\(([^()]*)\)', lambda mm: 'dp(DLCUR.c(' + mm.group(1) + '))', args[1])
            return name + '(' + ','.join(args) + ')'
        for meth in METHODS:
            k = name.rfind(meth[:-1])
            if k > 0 and name.endswith(meth[:-1]):
                recv = name[:k]
                return 'DLCUR.c(' + recv + ')' + meth[:-1] + '(' + inner + ')'
        return None
    for meth in METHODS:
        k = e.find(meth)
        if k > 0 and _balanced(e, k + len(meth) - 1) == len(e):
            return 'DLCUR.c(' + e[:k] + ')' + e[k:]
    # a plain value or an arithmetic expression over plain values
    if re.match(r'^[-+]?[A-Za-z0-9_$.\[\]\s*/%+()-]+$', e) and '=>' not in e and '?' not in e:
        return 'DLCUR.c(' + e + ')'
    return None


def _enclosing(src, pos):
    back = src[max(0, pos - 4000):pos]
    ms = FN.findall(back)
    return ms[-1] if ms else '?'


def _strlit_start(out, close_q):
    """Walk back from a closing quote to its opening quote. JS string literals do
    not span lines, so a newline means this was not a literal at all."""
    q = out[close_q]
    i = close_q - 1
    while i >= 0 and close_q - i < 400:
        ch = out[i]
        if ch == '\n':
            return -1
        if ch == q:
            bs = 0
            k = i - 1
            while k >= 0 and out[k] == '\\':
                bs += 1; k -= 1
            if bs % 2 == 0:
                return i
        i -= 1
    return -1


def _direct(out, guard_lo, guard_hi):
    """Transform every money string the payload builds by hand: a literal that
    ends in a dollar sign concatenated onto a number (`"$"+v`, `" · $"+fmt(v)`),
    and the same inside a template (`$${v}`). Applied right to left, so earlier
    offsets stay valid."""
    sites = []

    def expr_at(j):
        if out[j] == '(':
            k = _balanced(out, j)
            if k < 0:
                return None
            while True:                       # (x).toFixed(2) and friends
                mm = re.match(r'\.[A-Za-z0-9_$]+\(', out[k:k + 40])
                if not mm:
                    break
                k2 = _balanced(out, k + mm.end() - 1)
                if k2 < 0:
                    break
                k = k2
            return out[j:k]
        cm = CALL.match(out, j)
        if cm:
            k = _balanced(out, cm.end() - 1)
            return out[j:k] if k > 0 else None
        km = re.match(r'[A-Za-z0-9_$.\[\]]+', out[j:j + 120])
        if not km:
            return None
        k = j + km.end()
        while k < len(out) and out[k] == '(':      # 10..toFixed(0) is ONE expression
            k2 = _balanced(out, k)
            if k2 < 0:
                break
            k = k2
            mm = re.match(r'\.[A-Za-z0-9_$]+', out[k:k + 40])
            if not mm:
                break
            k += mm.end()
        return out[j:k]

    for m in re.finditer(r'\$(["\'])\s*\+\s*', out):
        close_q = m.start() + 1
        open_q = _strlit_start(out, close_q)
        if open_q < 0:
            continue
        j = m.end()
        expr = expr_at(j)
        if expr is None:
            continue
        head = out[open_q:m.start()]          # the literal, minus its trailing $
        sites.append(('A', open_q, j + len(expr), expr, head + out[close_q]))

    for m in re.finditer(r'\$\$\{', out):
        j = m.end()
        k = _balanced(out, j - 1, '{', '}')
        if k < 0:
            continue
        sites.append(('B', m.start(), k, out[j:k - 1], None))

    kept, denied = [], []
    for shape, a, b, expr, head in sites:
        if guard_lo <= a < guard_hi:      # the DLCUR core itself
            continue
        fn = _enclosing(out, a)
        if fn in DENY_FN or CASHTAG.match(expr.strip()):
            denied.append((fn, expr.strip()[:40]))
            continue
        kept.append((shape, a, b, expr, head, fn))

    bad = [(f, e) for (s, a, b, e, h, f) in kept if _conv(e) is None]
    if bad:
        _fail('%d money sites have a shape this pass does not understand: %s'
              % (len(bad), bad[:6]))

    # right to left
    for shape, a, b, expr, head, fn in sorted(kept, key=lambda x: -x[1]):
        conv = _conv(expr)
        if shape == 'A':
            lit = '' if len(head) == 2 else head          # '""' / "''" carry nothing
            new = (lit + '+' if lit else '') + 'DLCUR.s()+' + conv
            # `return"$"+v` is legal; `returnDLCUR.s()+v` is one identifier. Keep the
            # keyword and the replacement apart.
            if a > 0 and re.match(r'[A-Za-z0-9_$]', out[a - 1]) and re.match(r'[A-Za-z_$]', new[0]):
                new = ' ' + new
        else:
            new = '${DLCUR.s()}${' + conv + '}'
        out = out[:a] + new + out[b:]
    return out, len(kept), len(denied)


# ------------------------------------------------------------------ 3 · wiring
WIRING = [
 # NOT a currency change — a defect the currency gate run turned up, fixed here
 # because this pass is what found it. renderTicker() rewrites the whole tape with
 # innerHTML every 8th tick, which throws away the `contested` class provRefresh()
 # puts on a chip standing over a figure the witnesses disagree on; the class only
 # comes back on the command bar's own 5-tick cycle. For ~8% of wall-clock time the
 # tape showed a contested market cap in the plain `live` state — a disagreement
 # rendered as agreement, which is the one thing this payload promises never to do.
 # The tape now re-derives its chips from the same shared clock reading, in place.
 ('tape-prov-race',
  'tr.innerHTML=s+s',
  'tr.innerHTML=s+s;try{window.DLCORE&&DLCORE.provRefresh()}catch(e){}',
  1),
 ('qRate',
  'function qRate(q){return"USD"===q||"USDT"===q?1:"EUR"===q?S.fx.EUR:"INR"===q?S.fx.INR:"BTC"===q?S.fx.BTC||(bySym.BTC?1/bySym.BTC.price:0):"ETH"===q?S.fx.ETH||(bySym.ETH?1/bySym.ETH.price:0):1}',
  'function qRate(q){return DLCUR.rate(q)||1}',
  1),
 ('qSym',
  'function qSym(q){return{USD:"$",EUR:"€",INR:"₹"}[q]||""}',
  'function qSym(q){return DLCUR.sym(q)}',
  1),
 ('mx-rate',
  'function fxEUR(){return"undefined"!=typeof S&&S.fx&&S.fx.EUR?S.fx.EUR:MX.fx.EUR}function fxINR(){return"undefined"!=typeof S&&S.fx&&S.fx.INR?S.fx.INR:MX.fx.INR}function rate(q){if("USD"===q)return 1;if("EUR"===q)return fxEUR()||.92;if("INR"===q)return fxINR()||83;if("BTC"===q){var b=byId("bitcoin")||bySymX("BTC");return b&&b.price?1/b.price:0}if("ETH"===q){var e=byId("ethereum")||bySymX("ETH");return e&&e.price?1/e.price:0}return 1}',
  'function fxEUR(){return DLCUR.rate("EUR")}function fxINR(){return DLCUR.rate("INR")}function rate(q){if("USD"===q)return 1;if("BTC"===q){var b=byId("bitcoin")||bySymX("BTC");return b&&b.price?1/b.price:0}if("ETH"===q){var e=byId("ethereum")||bySymX("ETH");return e&&e.price?1/e.price:0}return DLCUR.rate(q)}',
  1),
 ('mx-sy',
  'function sy(q){return{USD:"$",EUR:"€",INR:"₹"}[q]||""}',
  'function sy(q){return DLCUR.sym(q)}',
  1),
 # the markets state seeds itself from the app-wide choice, not from a literal
 ('mx-seed',
  'sortDir:-1,cur:"USD",page:1,fx:{EUR:.92,INR:83}',
  'sortDir:-1,cur:DLCUR.q(),page:1,fx:{}',
  1),
 ('mx-setcur',
  'function setCur(q){MX.cur=q;try{localStorage.setItem(LS_CUR,q)}catch(e){}',
  'function setCur(q){MX.cur=q;try{DLCUR.set(q)}catch(e){}try{localStorage.setItem(LS_CUR,q)}catch(e){}',
  1),
 # the picker: five hard-coded buttons become every currency DLCUR carries
 ('mx-picker',
  '<div class="mx-seg" id="mxCur">\'+["USD","EUR","INR","BTC","ETH"].map(function(q){return\'<button data-mxq="\'+q+\'" class="\'+(MX.cur===q?"on":"")+\'">\'+q+"</button>"}).join("")+\'</div>',
  '<label class="mx-cursel"><span class="mx-curlbl">Currency</span><select id="mxCurSel" aria-label="Display currency">\'+DLCUR.list().map(function(q){return\'<option value="\'+q.code+\'"\'+(DLCUR.want()===q.code?" selected":"")+\'>\'+q.code+" \\u00b7 "+q.sym.trim()+"</option>"}).join("")+\'</select></label>',
  1),
 # the hard-coded 83 / .92 in the converter desks: live rate first, the old
 # constant only where it was already the last resort
 ('desk-cur-rate',
  'if("INR"===cur)return S.fx.INR||83;if("EUR"===cur)return S.fx.EUR||.92;',
  'if("INR"===cur)return DLCUR.rate("INR")||S.fx.INR||83;if("EUR"===cur)return DLCUR.rate("EUR")||S.fx.EUR||.92;var _dl=DLCUR.rate(cur);if(_dl>0)return _dl;',
  1),
 ('desk-cur-inv',
  'if("INR"===sym)return 1/(S.fx.INR||83);if("EUR"===sym)return 1/(S.fx.EUR||.92);',
  'if("INR"===sym)return 1/(DLCUR.rate("INR")||S.fx.INR||83);if("EUR"===sym)return 1/(DLCUR.rate("EUR")||S.fx.EUR||.92);var _dl=DLCUR.rate(sym);if(_dl>0)return 1/_dl;',
  1),
 ('desk-cur-inv2',
  'if("INR"===s)return 1/(S&&S.fx&&S.fx.INR||83);if("EUR"===s)return 1/(S&&S.fx&&S.fx.EUR||.92);',
  'if("INR"===s)return 1/(DLCUR.rate("INR")||S&&S.fx&&S.fx.INR||83);if("EUR"===s)return 1/(DLCUR.rate("EUR")||S&&S.fx&&S.fx.EUR||.92);var _dl=DLCUR.rate(s);if(_dl>0)return 1/_dl;',
  1),
 # a paper balance is a USDT balance. It reads in the chosen currency and says
 # so, with the USDT quantity beside it — the value converts, the holding does not.
 ('conv-select',
  '<select id="convCur" onchange="setConvCur()"><option>USD</option><option>EUR</option><option>INR</option><option>USDT</option><option>BTC</option><option>ETH</option></select>',
  '<select id="convCur" onchange="setConvCur()" data-dlcur-fill="1"><option>USD</option></select>',
  1),
 # the stablecoin row printed a hard "$1.00" — a peg is a dollar peg, but the
 # price column is a price column and reads in the chosen currency like the rest
 ('usdt-row-price',
  'isU?"$1.00":',
  'isU?DLCUR.money(1,2):',
  1),
 ('pf-total-markup',
  '<span id="pf-total" style="position:relative;z-index:1">0.00</span> <small>USD</small>',
  '<span id="pf-total" style="position:relative;z-index:1">0.00</span> <small id="pf-totalQ">USD</small><div id="pf-totalSub" class="dlcur-usdt"></div>',
  1),
 ('pf-total-live',
  'const tot=portfolioUSD(),pfv=fmt(tot,2);pft.dataset.v!==pfv&&(pft.dataset.v=pfv,scrambleTo(pft,pfv));',
  'const tot=portfolioUSD(),pfv=fmt(DLCUR.c(tot),DLCUR.dp(2));pft.dataset.v!==pfv&&(pft.dataset.v=pfv,scrambleTo(pft,pfv));try{var _q=document.getElementById("pf-totalQ");_q&&(_q.textContent=DLCUR.q());var _sb=document.getElementById("pf-totalSub");_sb&&(_sb.textContent="USD"===DLCUR.q()?"":"\u2248 "+fmt(tot,2)+" USDT")}catch(_e){}',
  1),
 ('navbal',
  'function updateNavBal(){document.getElementById("navBal").textContent=cUSD(portfolioUSD())}',
  'function updateNavBal(){var t=portfolioUSD(),e=document.getElementById("navBal");e.textContent=cUSD(t);try{e.title="USD"===DLCUR.q()?"Your paper portfolio":"Your paper portfolio \u00b7 \u2248 "+fmt(t,2)+" USDT"}catch(_e){}}',
  1),
]

PICKER_CSS = ('<style id="dlcurcss">.mx-cursel{display:inline-flex;align-items:center;gap:7px;'
              'padding:0 4px 0 10px;height:32px;border:1px solid var(--line-2,#2A3A54);border-radius:9px;'
              'background:var(--surface-2,rgba(255,255,255,.03))}'
              '.mx-curlbl{font:600 11px/1 var(--ui-sans,system-ui);letter-spacing:.04em;text-transform:uppercase;'
              'color:var(--ink-2,#AEB9CF)}'
              '#mxCurSel{appearance:none;-webkit-appearance:none;border:0;background:transparent;cursor:pointer;'
              'color:var(--ink,#E7EDF8);font:700 12px/1 var(--ui-sans,system-ui);padding:6px 22px 6px 6px;'
              'background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),'
              'linear-gradient(135deg,currentColor 50%,transparent 50%);'
              'background-position:calc(100% - 12px) 13px,calc(100% - 7px) 13px;'
              'background-size:5px 5px,5px 5px;background-repeat:no-repeat}'
              '#mxCurSel option{background:var(--surface,#101726);color:var(--ink,#E7EDF8)}'
              '.dlcur-usdt{display:block;margin-top:2px;font:500 11px/1.3 var(--ui-sans,system-ui);color:var(--faint,#7C8AA5);letter-spacing:.01em}</style>')

# the select is wired where the old segment was, and any surface may host one
PICKER_JS = ('<script>!function(){function fill(){try{var s=document.querySelector(\'select[data-dlcur-fill]\');'
             'if(!s||!window.DLCUR)return;var want=DLCUR.q(),cur=s.value||want;'
             'if(s.options.length>1&&s.getAttribute("data-dlcur-done"))return;'
             's.innerHTML=DLCUR.list().map(function(q){return\'<option value="\'+q.code+\'">\'+q.code+"</option>"}).join("")'
             '+\'<option value="USDT">USDT</option>\';s.setAttribute("data-dlcur-done","1");'
             's.value=want;try{"function"==typeof setConvCur&&setConvCur()}catch(_e){}}catch(e){}}'
             'function follow(q){try{var s=document.querySelector(\'select[data-dlcur-fill]\');'
             'if(s&&s.value!==q){s.value=q;try{"function"==typeof setConvCur&&setConvCur()}catch(_e){}}}catch(e){}}'
             'if("loading"===document.readyState)document.addEventListener("DOMContentLoaded",fill);else fill();'
             'setTimeout(fill,1500);'
             'function h(e){var t=e.target;'
             'if(t&&"mxCurSel"===t.id&&window.DLCUR){DLCUR.set(t.value);'
             'try{"function"==typeof setCur&&setCur(t.value)}catch(_e){}}}'
             'document.addEventListener("change",h,!0);'
             'try{window.DLCUR&&DLCUR.on(function(){var w=DLCUR.want(),s=document.getElementById("mxCurSel");'
             's&&s.value!==w&&(s.value=w);follow(DLCUR.q())})}catch(e){}}();</script>')


# ------------------------------------------------- 4 · after the pass, on its output
# Four sites the transform got to but should not have, or did not finish. Matched
# against the POST-transform bytes, so they run after _direct().
POST = [
 # a circulating supply is a COUNT OF COINS. fmt$ became currency-aware, so this
 # site both multiplied the supply by the FX rate and printed a symbol the old
 # .replace("$","") no longer stripped: 19.70M BTC read as ¥3.10B BTC.
 ('supply-is-not-money',
  'fmt$(c.supply).replace("$","")',
  '(function(v){var a=Math.abs(v);return a>=1e12?(v/1e12).toFixed(2)+"T":a>=1e9?(v/1e9).toFixed(2)+"B":a>=1e6?(v/1e6).toFixed(2)+"M":a>=1e3?(v/1e3).toFixed(1)+"K":String(Math.round(v))})(c.supply)',
  1),
 # the risk panel's own toFixed(2) survived conversion: ₿0.00 under a crypto quote,
 # and no grouping under any of them. DLCUR.money() knows the quote's decimals.
 ('risk-planned-loss',
  'DLCUR.s()+DLCUR.c(riskUSD).toFixed(2)',
  'DLCUR.money(riskUSD,2)',
  1),
 ('risk-gap-loss',
  'DLCUR.s()+(stop?DLCUR.c((riskUSD*(stop+1)/stop)).toFixed(2):"\u2014")',
  '(stop?DLCUR.money(riskUSD*(stop+1)/stop,2):"\u2014")',
  1),
 # the markets table asked for two decimals whatever the quote, so ¥ and ₩ printed
 # cents that do not exist, and the grouping ignored the quote's own locale.
 ('markets-price-decimals',
  'return"BTC"===q||"ETH"===q?(v<1?v.toPrecision(3):fmtN(v,4))+" "+q:sy(q)+fmtN(v)}',
  'return"BTC"===q||"ETH"===q?(v<1?v.toPrecision(3):fmtN(v,4))+" "+q:sy(q)+fmtN(v,DLCUR.dp(2))}',
  1),
 ('markets-locale',
  'function fmtN(n,d){try{return Number(n||0).toLocaleString("en-US",',
  'function fmtN(n,d){try{return Number(n||0).toLocaleString(DLCUR.loc(),',
  1),
]


def apply(out):
    # --- the core, ahead of every script that renders money
    core = open(os.path.join(ROOT, 'buildlib', 'dlcur.js'), encoding='utf-8').read()
    assert '</script' not in core, 'the DLCUR core contains </script'
    hd = out.find('</head>')
    if hd <= 0:
        _fail('no </head> to seat the currency core in front of')
    block = '<script id="dlcur">' + core + '</script>' + PICKER_CSS
    out = out[:hd] + block + PICKER_JS + out[hd:]
    lo = hd
    hi = hd + len(block) + len(PICKER_JS)

    n_fmt = 0
    for tag, find, repl, n in FORMATTERS:
        out = _sub(out, find, repl, n, tag)
        n_fmt += n

    for tag, find, repl, n in WIRING:
        out = _sub(out, find, repl, n, tag)

    out, kept, denied = _direct(out, lo, hi)

    for tag, find, repl, n in POST:
        out = _sub(out, find, repl, n, tag)

    # the guarantee this pass exists to make: outside the denied surfaces and the
    # app's own copy, no money string is built from a bare dollar sign any more.
    glued = re.findall(r'(?:return|typeof|case|new|delete|void|throw|instanceof|in|of)DLCUR\.', out)
    if glued:
        _fail('%d replacements are glued to the keyword in front of them: %s' % (len(glued), glued[:4]))
    body = out[:lo] + out[hi:]          # the core's own prose is not a call site
    orphan = re.findall(r'DLCUR\.c\([^()]+\)\(', body)
    if orphan:
        _fail('%d converted expressions left their call behind: %s' % (len(orphan), orphan[:4]))

    left = len(re.findall(r'\$["\']\s*\+\s*[A-Za-z0-9_$(]', out))
    print('cur: %d formatters, %d direct sites, %d denied, %d untouched "$"+ sites'
          % (n_fmt, kept, denied, left))
    if left > 24:
        _fail('%d "$"+ sites were left untouched — the deny list is meant to be small' % left)
    return out
