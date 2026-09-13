# Architecture

DexLadder is a **single-file application**. `dist/index.html` is 3,241,037 bytes of
self-contained HTML, CSS and JavaScript with no runtime dependency, no module
loader, no bundler output and no network origin it must reach to start.

## The build

```
build154.py
  ├─ src/            page shell, CSS, the static academy prose
  ├─ layers/*.js     feature layers, concatenated in filename order
  └─ dist/index.html one file, byte-for-byte reproducible
```

Layers are ordinary scripts, sorted by their numeric prefix, so `00-` boots and
`45-` lands last. Adding a feature means adding a file; the build script globs.
There is no dependency graph to reason about and no import resolution to break.

## Runtime shape

| concern | how |
| --- | --- |
| State | one `localStorage` blob, exportable as a signed bundle |
| Identity | none — there is no user record anywhere |
| Backend | none — the browser reads public market APIs directly, so there is no DexLadder server and no DexLadder log |
| Offline | service worker (`dist/sw.js`) pins the payload by content hash |
| Charts | hand-written canvas (23 2D contexts), no charting dependency; TradingView is an optional second engine, lazy-loaded from `s3.tradingview.com` only when the user switches to it |
| Execution | order book, depth, slippage, funding and liquidation modelled locally |
| Security | CSP shipped in `dist/_headers`, currently **Report-Only** while violations are collected; two `new Function()` call sites remain, both executing `data-go` attribute strings authored inside the build (see `docs/SECURITY-NOTES.md`) |

## Why one file

Because it is auditable. A learner can read the whole program, a reviewer can
hash it, and a teacher can put it on a USB stick for a classroom with no
internet. Every architectural decision downstream of that is a consequence of
it.

## Testing

`test/` holds Playwright gates that assert on the shipped bytes, not on a dev
server: layer presence, contrast in both themes across thousands of rendered
text nodes, layout rhythm at five widths, and the execution-engine oracles.
