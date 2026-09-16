# DexLadder — verification log

All commands, checks and raw results behind the audit tracker. Nothing is marked
`verified` in `audit-tracker.md` without a line here.

## Environments

| Name | What | Where |
|---|---|---|
| DEV | `~/Downloads/Projects/dexladder-v154` (Mac). `build154.py` → `dist/index.html`. Not a git repo. | user's Mac |
| GATE | Playwright + mocked hosts (`test/harness.js`), run in the Claude cloud container (`/opt/pw-browsers/chromium`). The Mac VM has node 22 but no Playwright browsers. | cloud |
| LIVE-WWW | `https://www.dexladder.com` — Cloudflare Pages | public |
| LIVE-APEX | `https://dexladder.com` — Netlify | public |

## 2026-09-07 · Baseline (before any change)

### B1 — deployed vs development version

```
curl -sS -o /dev/null -w '%{http_code} %{content_type} %{size_download}' <url>   (+ sha256 of body)
```

| URL | Status | Content-Type | Bytes | sha256 (16) |
|---|---|---|---|---|
| `https://www.dexladder.com/` | 200 | text/html; charset=utf-8 | 2,594,439 | `2f8d40375bcc69ea` |
| `https://dexladder.com/` | 200 | text/html; charset=UTF-8 | 2,594,118 | `b6ada7b928f859c9` |
| `https://www.dexladder.com/robots.txt` | 200 | **text/plain** | 71 | `be3fe9108e5adbbb` |
| `https://www.dexladder.com/sitemap.xml` | 200 | **application/xml** | 556 | `43a56ed66294660c` |
| `https://www.dexladder.com/og.png` | 200 | **text/html** (SPA fallback) | 2,594,439 | `2f8d40375bcc69ea` |
| `https://dexladder.com/robots.txt` | 200 | **text/html** (SPA fallback) | 2,594,118 | `b6ada7b928f859c9` |
| `https://dexladder.com/og.png` | 200 | **text/html** (SPA fallback) | 2,594,118 | `b6ada7b928f859c9` |

`www` `sw.js` → `const V = 'cb-v154'`; `<meta name="cb:build" content="v154">`.

**Conclusion.** Two different payloads are live on the two hosts, both v154-generation.
`2f8d4037…` on www is the v154 build recorded in the project map. The audit's measured
2,594,118 bytes matches **LIVE-APEX**, so the audit was performed against Netlify/apex.
Development is far ahead: `dist/index.html` is v154m (`sw.js` = `cb-v154m`).

### B2 — live response headers

```
curl -sS -o /dev/null -D - <url>
```

| Header | LIVE-WWW (Cloudflare) | LIVE-APEX (Netlify) |
|---|---|---|
| `content-security-policy` | **absent** | **absent** |
| `strict-transport-security` | **absent** | `max-age=31536000` |
| `x-content-type-options` | nosniff | nosniff |
| `x-frame-options` | SAMEORIGIN | SAMEORIGIN |
| `referrer-policy` | strict-origin-when-cross-origin | strict-origin-when-cross-origin |
| `permissions-policy` | **absent** | **absent** |

`site/_headers` in the kit *does* contain a full CSP + HSTS + Permissions-Policy, but the file
that ships inside the deploy bundles is `dist/_headers`, which contains neither. This is the
root cause of finding 20 (and of the missing HSTS on Cloudflare), not an unwritten policy.

### B3 — existing gate, unmodified build

```
cd test && PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node gate154.js ../dist/index.html
→ 89 passed · 2 failed
```

Pre-existing failures (**not caused by this work**):

1. `Day: data-mode=day, color-scheme light, its own theme-color` — the gate expects
   `theme-color` `#FBF7F1` (warm ivory). The build emits `#F5F7FB`. Cause: the v154g
   "warm Day purge" deliberately re-cast every warm Day colour to a cool hue; the engine's
   `THEMES.day.meta` moved with it and the gate assertion was never updated. **Stale
   assertion, not a product defect.**
2. `first visit on a light OS opens in Day, before first paint` — the head boot script no
   longer consults `prefers-color-scheme`; a later session replaced OS seeding with a forced
   Night default plus a one-time `dl.darkdefault.v1` migration. **Stale assertion against a
   deliberate later decision** (see `decisions.md` D-09).

Both assertions are rewritten to describe shipped behaviour in the same commit that adds the
new gates; the behaviour itself is unchanged.

### B4 — source-level confirmations in `dist/index.html` (DEV)

| Finding | Grep | Result |
|---|---|---|
| 2 | `circulating_supply\|\|0` | 6 occurrences across the CoinGecko, Coinpaprika and mirror adapters |
| 2 | `ath:1.6*pr,ath_change_percentage:-37.5` | 1 — the Coinpaprika→CoinGecko shim **fabricates** an all-time high and its distance |
| 4 | `file://` news note | 1 occurrence, rendered into `#newsNote` regardless of `location.protocol` |
| 8 | `dl.wallet.cfg`, `private_key`, `client_email` | present — public client accepts and stores issuer service-account JSON |
| 11 | `block_id>0` | 1 occurrence |
| 20 | `Content-Security-Policy` in payload | 0 (no meta CSP either) |
| 31 | `v150` | 3 occurrences in shipped copy |

## 2026-09-07 · Batch 1 — v155-A data honesty (findings 2, 11, 16)

### Working copy
A second session was building in `dexladder-v154` at the same time (`layers/zzz-columns.js`
11:53:40Z, `dexladder-{cf,netlify}-v154n.zip` 11:55Z). That tree's `build154.py` and
`dist/index.html` were restored to its state (`4a002a60…`, sw `cb-v154n`) and this work moved to
`~/Downloads/Projects/dexladder-v155`.

### Build
```
cd ~/Downloads/Projects/dexladder-v155 && python3 build154.py
→ data honesty: 5 adapters + 1 mirror nullable, 5 renderers guarded,
  paprika shim de-fabricated, block 0 valid
→ v154 built: dist/index.html  bytes=2626382  layers=20
  sha256=02a5de173c8290788b094f33775d2e3838d870aaf1c42c4bc7aee0f30b9b4976
```

### Deterministic gate — `test/gate155.js` (fixtures in `test/fixtures155.js`)
```
cd test && PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node gate155.js ../dist/index.html
→ 22 passed · 0 failed
```
Covered: `DLF.n` over null / undefined / `""` / `"abc"` / `NaN` / `Infinity` / `0` / `"12.5"` / `-3`;
markets-table and coin-detail renderers with an unknown vs a legitimate-zero supply; CoinGecko
markets fixtures with an explicit `null`, an absent key, a malformed `"n/a"` and a genuine `0`
(a second asset, `ZRO0`, holds the legitimate zero so the two cases are distinguished in the same
payload); a Coinpaprika fallback reached by 429-ing CoinGecko; and `supDrift` over seeded 1-, 10-
and 40-day snapshot stores.

### Regression — `test/gate154.js`
```
node gate154.js ../dist/index.html   → 89 passed · 2 failed
```
Identical to the pre-change baseline (B3): the same two stale assertions, no new failure.

### Limitations of this batch
- The gates run against **mocked providers**. They prove the normalisation and rendering
  contract; they prove nothing about whether CoinGecko, Coinpaprika or Blockchair are up.
- Finding 11's fix is asserted at source and by fixture shape. The Explorer's Blockchair path was
  not driven end-to-end in the browser (the harness has no Blockchair mock yet), so the row reads
  *verified at the code path*, not *exercised through the UI*.
- The coin-detail assertion mutates the `DLCORE` coin record rather than reloading it from a
  fixture, because **the coin page and the markets table read from two different stores** with
  different prices (`DLCORE.coin('BTC').price` 67,850 vs `MXP.state.coins` 79,389 under the same
  fixtures). That divergence is finding 1 and is the Phase 1b work; it is recorded here rather
  than papered over.

## 2026-09-07 · Batch 2 — v155-B honest copy, versions, share assets (findings 4, 6, 9, 20, 31)

### Build
```
python3 build154.py
→ honest copy: version copy from release metadata (v154 / September 7, 2026),
  stop-loss planned-loss wording, protocol-aware news note, canonical host = www
→ dist/index.html 2,627,509 B  sha256 966731d634a99077eadc6c48b54960e3da4ff1ec320d45521dda8354c16e01e3
```

### New static assets
- `dist/og.png` — 1200×630, generated from the shipped `icon.svg` brand mark plus the Night
  palette. Verified by walking the PNG chunk list to `IEND` (`IHDR` → `caBX` → `IDAT` → `IEND`,
  53,083 B). The `caBX` chunk is C2PA content credentials added by the desktop bridge when the
  file was written; the image decodes normally with it.
- `dist/_headers` — rewritten. The previous file (kept at `_bak/_headers.v154`) carried no CSP,
  no HSTS and no Permissions-Policy, which is why neither live host served them.

### Gates
```
node gate155.js ../dist/index.html   → 35 passed · 0 failed
node gate154.js ../dist/index.html   → 91 passed · 0 failed
```
`gate154.js` reached 91/0 because the two stale assertions were rewritten to describe shipped
behaviour (Day `theme-color` `#F5F7FB` after the v154g cool re-cast; first visit opens in Night
whatever the OS prefers). **No product behaviour was changed to make them pass** — see
`decisions.md` D-09 and baseline B3.

The news assertion drives the real failure path: every news transport (`corsproxy`, `allorigins`,
`codetabs`, The Block RSS, `/api/news`) is aborted or 500'd and the app's own `loadNews()` runs,
so the note under test is the one the app actually renders, not a string match on source.

### What batch 2 does **not** establish
- Nothing is deployed. The apex (`dexladder.com`) still serves the SPA for `robots.txt`,
  `sitemap.xml` and `og.png`; that is a deploy step, not a build step, and is not authorised here.
- The CSP is **report-only**. It blocks nothing and is not evidence that the app is CSP-clean.
  The sink inventory and the switch to an enforcing policy are Phase 3.
- `og.png` was validated by decoding its chunk structure, not by a social-network preview render.
