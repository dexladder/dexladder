# DexLadder — audit tracker (source: `dexladder-audit-2026-09-07.md`)

Statuses: `unverified` · `reproduced` · `already fixed` · `in progress` · `verified` ·
`blocked` · `not applicable (with evidence)`.
A recommendation that has not been validated is **not** a confirmed defect; those rows stay
`unverified` until reproduced against the correct build.

**Build under change:** `~/Downloads/Projects/dexladder-v155` — an isolated copy of the v154 kit,
taken 2026-09-07 12:00 UTC because a second session was building in `dexladder-v154` concurrently
(it wrote `layers/zzz-columns.js` and the v154n bundles while this work was in flight). That tree was
restored to the other session's state; changes here come back as a reviewable `build154.py` diff.
**Build the audit observed:** LIVE-APEX `https://dexladder.com`, 2,594,118 B (see `verification.md` B1).

| ID | P | Evidence type | Status | Reproduced against | Code location | Fix | Acceptance evidence |
|---|---|---|---|---|---|---|---|
| 1 | P0 | Observed | unverified (audit screenshotted one view; needs re-reproduction on DEV) | — | global-stats producers in v153 payload + `layers/20-core.js` | one canonical snapshot; named universes; compatible dominance denominator | pending |
| 2 | P0 | Observed + Source | **verified** | v155 build, `test/gate155.js` 22/22 | `build154.py` v155-A block (5 adapters + mirror + Coinpaprika shim + 5 renderers); `layers/39b-ledgers.js` | `DLF.n()` nullable contract; the shim stops inventing ATH / 24h range / FDV; renderers print `Unavailable` | gate155 §DLF (3), §renderers (3), §provider fixtures (4: explicit null, absent key, malformed string, legitimate zero), §fallback (2) |
| 3 | P0 | Observed | unverified | — | feed labels/timestamps in v153 payload, `layers/10-feeds.js` | per-field provenance carried through fallback | pending |
| 4 | P1 | Observed | **partly verified** — the false `file://` diagnosis is gone; the wider feed-coordinator work (last success, per-source retry, empty-vs-failed) is Phase 1c | v155 build, gate155 | `build154.py` v155-B `news-note-honest` | the note is protocol-aware, dates the curated snapshot (July 2026), says plainly that a browser cannot tell blocked from rate-limited from down, and offers a retry | gate155 §news: fallback driven for real by aborting every transport; 3 asserts |
| 5 | P1 | Observed | unverified (arithmetic in the audit is independently correct; the app's own reporting must be re-measured) | — | DLSIM close/realised-P&L, journal, tax panel | separate gross / fees / funding / net; documented precision | pending |
| 6 | P1 | Observed + Source | **verified** | v155 build, gate155 | `build154.py` v155-B `stop-honesty` | "planned" loss, the 1%-gap figure computed from the user's own inputs, stop-limit may not fill, fees on top | gate155 §stop: no "all you lose" anywhere; 4 phrases present |
| 7 | P1 | Observed | unverified | — | account dialog | local-profile flow, prominent export/import | pending |
| 8 | P1 | Source | **reproduced (source)** — `dl.wallet.cfg`, `client_email`, `private_key` in the public client | DEV | `DL_WALLET` | remove issuer-key intake; keep offline certificate | pending |
| 9 | P1 | Observed | **verified in the build** — deployment to the apex is a separate, unauthorised step | v155 build, gate155 | `dist/og.png` (new, 1200×630), `dist/_headers`, `build154.py` v155-B canonical patches | og.png generated from the shipped brand mark; canonical/og/twitter all name `www.dexladder.com`; `_headers` declares text/plain, application/xml and image/png for the three files | gate155 §assets: PNG chunk walk to IEND, robots parsed, sitemap `<loc>` hosts checked, `_headers` content types |
| 10 | P1 | Observed | unverified | — | router | addressable content URLs + server metadata | pending |
| 11 | P1 | Observed + Source | **verified** | v155 build | `build154.py` v155-A `block-zero` | `null!=block_id&&block_id>=0` — height 0 is a confirmed block, Blockchair's `-1` is mempool | gate155 source invariant; `fixtures155.blockchairTx(0\|-1)` |
| 12 | P1 | Observed | unverified | — | Explorer | one results area, shared loading/error state | pending |
| 13 | P1 | Observed | unverified | — | coin dossier/tickers/treasury | provider failure ≠ user offline | pending |
| 14 | P1 | Observed | unverified | — | `layers/40-dexai.js` | consume the canonical snapshot | pending |
| 15 | P1 | Observed | unverified | — | `layers/40-dexai.js` intent router | entity-specific + multi-part answers, fixed eval set | pending |
| 16 | P1 | Observed | **verified** | v155 build | `layers/39b-ledgers.js` `covDays`/`supDrift`/`driftText` | a window is measured only with real elapsed coverage; otherwise typed `insufficient-history` and the UI says `Collecting history · N of 7 days` | gate155 §supply drift, 4 asserts over 1 / 10 / 40-day stores |
| 17 | P1 | Observed | unverified | — | `layers/36-odds.js` | bind price to exact market/outcome/threshold/resolution | pending |
| 18 | P1 | Source | **reproduced (source)** — `dist/sw.js` caches every API response without checking `res.ok` | DEV `dist/sw.js` | service worker fetch handler | cache only validated 2xx; TTL + size bound; preserve last-good age | pending |
| 19 | P1 | Source | unverified | — | `dist/sw.js` + update flow | notified, explicit activation point | pending |
| 20 | P1 | Source | **partly verified** — the policy now ships, **report-only**; sink inventory and enforcement are Phase 3 | v155 build, gate155 | `dist/_headers` | HSTS + Permissions-Policy enforced; CSP shipped as `Content-Security-Policy-Report-Only` with no reporting endpoint (violations read from the console, nothing sent to a third party) | gate155 asserts the report-only header is present and that no enforcing CSP is claimed |
| 21 | P2 | Observed | unverified | — | home at 390px | first screen = mission + balance + one action | pending |
| 22 | P2 | Observed | unverified | — | mobile bottom nav | 4–5 primary + More; safe areas; keyboard | pending |
| 23 | P2 | Observed | unverified | — | desktop home | one hierarchy; Tools directory | pending |
| 24 | P2 | Observed | unverified | — | onboarding quest | recognise the $10,000 starting balance | pending |
| 25 | P1 | Observed | unverified | — | markets table, search results, modals | real headers, labels, focus return, hide decorative clones | pending |
| 26 | P2 | Observed | unverified | — | money formatters, quant panel | keep cents; no negative zero; sample size | pending |
| 27 | P2 | Observed | unverified | — | Community bot content | asset-aware scenarios; debrief for deliberate misinformation | pending |
| 28 | P2 | Observed | unverified | — | P2P article | per-rail scope, source + date | pending |
| 29 | P2 | Observed | unverified | — | academy consensus lesson | node count ≠ consensus weight; review dates | pending |
| 30 | P2 | Observed | unverified | — | certificate copy | what a local signature proves and does not | pending |
| 31 | P2 | Observed | **verified** | v155 build, gate155 | `build154.py` v155-B `RELEASE` dict + `ver-*` patches | `BUILDV`/`UPDATED` read `<meta cb:build>` / new `<meta cb:updated>`, both generated from one release dict; the three hard-coded `v150` strings are gone | gate155 §version: meta is v154, About/Paper text contains v154 and no v150 |
| 32 | P2 | Observed | unverified | — | `layers/41-trust.js` feeds panel | last success / failures / next retry, raw behind a details view | pending |
| 33 | P2 | Source + snapshot | **reproduced (measured)** — DEV payload 2,626,128 B single file | DEV | build + layers | modularise where it removes duplicated ownership; keep the single-file edition generated | pending |
| 34 | P1 | Recommendation | unverified | — | backup/restore | validate → preview → recoverable prior state → versioned schema | pending |
| 35 | P2 | Recommendation | unverified | — | schedulers | state when each runs; documented resume model | pending |
| 36 | P2 | Observed + Recommendation | unverified | — | release docs | build hashes, reproducible instructions, security route | pending |
| 37 | P2 | Observed | unverified | — | Yield Sandbox risk column | name the risks the labels omit | pending |
| 38 | P2 | Observed | unverified | — | order preview | validate before quote; no mutation on invalid input | pending |
| 39 | P2 | Recommendation | unverified | — | — | consented usability study design; no tracking added | pending |
| 40 | P2 | Recommendation | unverified | — | — | capability registry: stable / experimental / degraded / retired | pending |

## Notes on evidence discipline

- The audit measured **LIVE-APEX**. Several findings may already be fixed in DEV; each is
  re-checked against `dist/index.html` before any edit.
- Finding 9 splits: `robots.txt` / `sitemap.xml` are **already fixed in DEV and on www** but
  **not deployed to the apex**; `og.png` is a **real, unfixed defect on every host** — the file
  does not exist in `dist/`.
- Finding 20 is not "no policy was written". The policy exists in `site/_headers` and is simply
  not in the file the deploy bundles ship. That distinction changes the fix.
