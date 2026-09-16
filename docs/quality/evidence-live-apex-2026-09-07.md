# Evidence — LIVE-APEX verification pass (2026-09-07 11:53–12:00 UTC)

**Author:** a separate Cowork session (audit verification, not stabilisation).
**Status: read-only contribution.** Nothing in `dexladder-v154` or `dexladder-v155` was edited.
This file is additive; fold whatever is useful into `verification.md` and `audit-tracker.md`.
Written 12:11 UTC, while batch 2 was in flight — deliberately no other file was touched.

Target: **LIVE-APEX** `https://dexladder.com`, body 2,594,118 B,
etag `910984dd735b950d6187fa66d94864da-ssl`, `sw.js` = `cb-v154a`.
Method: HTTP probes, static analysis of the served payload, live DOM interrogation in the user's
Chrome. No trade executed, no state mutated, no credential entered.

---

## Rows this unblocks

### Finding 5 — `unverified` → **reproduced (source), with arithmetic**

Complete chain in the served payload:

```
FEE = {maker: 8e-4, taker: .001}                       // 0.080% / 0.100%

function execFill(side, sym, quote, amt, px, label, silent) {
  const val = amt*px, fee = .001*val, qU = pUSD(quote)||0, pxUSD = px*qU;
  if (side==='buy') { S.bal[quote] -= (val + fee); basisBuy (sym, amt, pxUSD); }
  else              { S.bal[quote] += (val - fee); basisSell(sym, amt, pxUSD); }
  S.stats.feesUSD += fee*qU;
  logTxn(side==='buy'?'Buy':'Sell', sym, amt, val, quote);      // val = GROSS notional
}

function basisSell(sym, amt, pxUSD) { ... pl = take*(pxUSD - avg); S.stats.realizedUSD += pl;
  S.journal.unshift({ ..., pl, plPct: avg ? (pxUSD-avg)/avg*100 : 0 }); ... }

function taxCompute(mode) { ... px = t.val/t.amt; gain = (px - lot.px)*q; ... }
```

`basisBuy`/`basisSell` are called with the **raw** `pxUSD`, so neither the cost basis nor the
proceeds carry a fee term. `logTxn` receives `val`, not `val-fee`, so `taxCompute`'s
`px = t.val/t.amt` is also gross.

**Net effect:** cash and equity are net of fees; `S.stats.realizedUSD`, the journal's `pl` and
`plPct`, the tax panel's "Net realized", and the signed performance report are all **gross of
fees**. Fees survive only in the parallel counter `S.stats.feesUSD`.

Recomputing the round trip the audit performed (0.001 BTC, buy 79,389.21, sell 79,384.45):

| Component | USD |
|---|---:|
| Buy notional | 79.389210 |
| Entry fee 0.100% | 0.079389 |
| Cash debited (`val+fee`) | 79.468599 |
| Sell notional | 79.384450 |
| Exit fee 0.100% | 0.079384 |
| Cash credited (`val−fee`) | 79.305066 |
| **Equity change** | **−0.163533** |
| Equity 10,000 → | 9,999.836467 → renders **$9,999.84** |
| Gross price P&L | −0.004760 → shown as "Net realized" |
| `plPct` | −0.005996% → shown −0.01% |

The **$9,999.84** the audit observed is reproduced exactly by this model. That is independent
confirmation of both the defect and the audit's arithmetic table.

**Correction to the audit:** its claim that *"Fees paid" rounded to $0* does not follow from the
code. Fees render through `money(v)` = `maximumFractionDigits: 2`, so 0.158774 → `$0.16`. Either
re-locate where a `$0` was seen, or drop that sentence. Everything else in finding 5 stands.

**Suggested acceptance:** this exact round trip reports net ≈ −$0.16 and fees $0.16, with gross
−$0.005 separately labelled; equity change reconciles to (gross − fees ± external cash flows)
within a stated tolerance.

---

### Finding 1 — Phase 1b input: the five producers, named

One instantaneous DOM snapshot on `#/markets` (12:56 UTC), all values co-resident:

| Producer (CSS class) | Total market cap | 24h volume | BTC dominance | ETH dominance |
|---|---|---|---|---|
| `.gi` command bar | $2.47T | $53.28B | 64.6% | — |
| `.stat-strip` hero | $2.65T | $108.69B | 60.2% | — |
| `.gg` global card | $2.78T | $121.13B | 57.3% | 10.9% |
| `.gs-i` strip | $2.83T | $126.25B | — | — |
| coin-page variant | — | — | 59.1% | 11.3% |
| **spread** | **14.6%** | **137%** | **7.3 pts** | **0.4 pts** |

**Refinement that narrows the fix:** dominance is already internally coherent inside each
producer. With BTC cap displayed as $1.59T: 1.59/2.47 = 64.4%, 1.59/2.65 = 60.0%,
1.59/2.78 = 57.2%. The dominance arithmetic is **not** broken — each producer correctly divides
by its own total. The defect is only that several provider/universe totals render side by side
unlabelled. This is consistent with the two-store divergence recorded in `verification.md`
(`DLCORE.coin('BTC')` vs `MXP.state.coins`): fix the canonical snapshot and dominance corrects
itself. There is no separate dominance bug to schedule.

The audit's "ETH dominance appeared as 0.0%" did **not** reproduce (10.9% / 11.3% observed);
treat it as intermittent, not a standing defect.

---

### Finding 25 — the cited evidence is wrong; the real defects are different

Measured on the live markets view:

| Check | Result |
|---|---|
| markets `<table>` has `<thead>` | **yes** |
| `<th>` elements | **11** |
| buttons with no accessible name (no text, no `aria-label`) | **38** |
| inputs/selects with no label, `aria-label`, `title` or placeholder | **14 of 50** |
| `<img>` without `alt` | 0 |

"Market table headings appear as cells" is **false** — the table is semantically correct. Drop it
and re-scope the row to the 38 unnamed controls and 14 unlabelled inputs.

---

### Finding 13 — re-scope

Reproduced, but the message is honest: `Dossier unavailable — cooling api.coingecko.com`,
`Tickers unavailable — cooling api.coingecko.com`, `Treasury Map cooling api.coingecko.com` —
a correct rate-limit category, not an "offline" claim. The defect is that all three sit under a
green `LIVE · 623ms` badge and a `CoinGecko · 2d ago` figure. Re-scope the row to the badge.

---

### Finding 16 — still broken in production

Live apex, BTC detail: `Measured 7d supply change +0.005%` **and**
`Measured 30d supply change +0.005%` — bit-identical across two different windows, on an asset
reading `Circulating supply 0 BTC`. Useful as the "before" for the v155 fix.

### Finding 2 — stronger contradiction available

Live apex prints `Circulating supply 0 BTC` beside `Market cap $1.59T`, and the markets table row
reads `1 Bitcoin BTC $79,428.28 … $1.59T $19.06B 240.0K BTC 0 BTC`. $1.59T ÷ $79,428 ≈ **20.0M** —
the app's own market cap proves it holds a usable supply figure it is discarding. Better evidence
than the audit's "the table showed 20.08M" (the table now shows 0 as well).

### Finding 6 — exact string
`If the stop hits, that is all you lose.` — rendered live inside the same panel as
`Execution: Beginner · forgiving fills · SIMULATED` and a slippage readout.

### Finding 38 — reproduced live
Amount `-1` in the BTC ticket renders `Order value −79,428.28 USDT`, `Fee (0.10%) −79.43 USDT`,
`You receive −1.00 BTC`, with the Buy button still enabled. Validation fires only on submit; the
quote renders first.

### Finding 33 — count correction
Served apex payload: **82 `<script>`** (all inline, 0 with `src`) and **69 `<style>`**, not 81/66.
Raw 2,594,118 B; gzip -9 786,109 B.

---

## Two defects that are not in the 40

**A. The service worker hides deploys.** `dist/sw.js` serves navigations
`caches.match('./index.html')` **cache-first**. Because the app *is* `index.html`, a returning
visitor with a warm cache keeps the old build until `sw.js`'s own bytes change and
`skipWaiting()` fires. This compounds finding 19 (silent activation) and finding 31 (the bug
report string says `v150`): you cannot tell which build a user report came from. Fold into the
finding-18 row — the fix is the same file.

**B. A signed artefact carries a false build number.** The performance report payload stamps
`build:"v151"` while the build is v154. It is presented as signed and verifiable. That is a
fourth version drift beyond the three `v150` occurrences already recorded, and it belongs in the
integrity batch rather than the P2 documentation row, because a tamper-evident artefact that is
wrong about its own provenance undermines the feature it advertises.

---

## Correction to this session's own earlier report

An earlier verdict written by this session called finding 9 "confirmed exactly" on the strength of
apex probes alone. `verification.md` B1 is more complete and supersedes it: **www serves real
`robots.txt` (text/plain, 71 B) and `sitemap.xml` (application/xml, 556 B)**, so the finding is a
*deploy gap on the apex*, not an unwritten file — except `og.png`, which is absent from `dist/`
on every host and is the only genuinely unfixed part. The same applies to finding 20: the policy
exists in `site/_headers` and is missing from the shipped `dist/_headers`.

## Not done here
No edit, no build, no gate run, no deploy. Findings 12, 14, 15, 17, 21–24, 26–30, 32, 37 were not
tested by this pass; 34–36, 39–40 are recommendations with nothing to verify.
