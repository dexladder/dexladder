# Security notes — the honest list

Everything below is true of the shipped `dist/index.html` as of this commit and
is checked against the bytes, not against intent. If you find something here
that is out of date, that is a bug — open an issue.

## Content Security Policy

`dist/_headers` ships a CSP in **`Content-Security-Policy-Report-Only`** mode.
It is therefore a measurement, not an enforcement. It is deliberately
report-only while the violation set is still being collected; moving it to
enforcing is tracked as an open task.

The policy allows `script-src 'self' 'unsafe-inline' https://s3.tradingview.com`.
`'unsafe-inline'` is required because the application ships as one file with
inline script. That is a real, understood cost of the single-file design.

## `new Function()`

Two call sites remain. Both execute the contents of a `data-go` attribute on a
button, and every such attribute is authored inside the build — none is derived
from user input, URL parameters, market data or anything that crosses the
network. They are still `new Function()`, they are still listed here, and
replacing them with a dispatch table is tracked.

## Third-party code at runtime

| origin | when it loads | what happens without it |
| --- | --- | --- |
| `s3.tradingview.com` | only when the user opens the TradingView chart | the native canvas engine renders instead; the app shows why it failed |
| `youtube-nocookie.com` | only when a video lesson is opened | the lesson text is unaffected |

Nothing else executes third-party code. There is no analytics script, no tag
manager, no A/B tool, no error reporter and no font CDN.

## Network egress

Market data is read directly from public APIs — CoinGecko, Binance, OKX,
CryptoCompare, Coinpaprika, alternative.me, Blockstream, open.er-api.com and
similar. There is no DexLadder proxy in front of them, which means:

- **Good:** no DexLadder server sees your requests, because there is no DexLadder server.
- **Honest:** those providers see your IP address, exactly as they would if you
  opened their site in a tab.

No request carries an identifier, a cookie, an account, or any portfolio
content. Turn off the network and the simulator, academy and portfolio all
continue to work from the service-worker cache.

## Storage

State is a `localStorage` working set plus an append-only `IndexedDB`
archive (`dexladder-vault`). Neither is ever transmitted. The export path
produces one bundle that you move yourself: it carries every DexLadder
localStorage key and the whole archive, a SHA-256 checksum over the
canonical JSON of the payload, and a secp256k1 signature from the key held
on that device.

The checksum is verified **before** the signature, so a truncated or edited
file is refused even on a browser where signature verification is
unavailable. The signing key itself is excluded from an export unless the
operator explicitly asks for it — that option exists to clone a desk onto
another device you own, and a bundle you send to someone else should not
carry it. An import writes the desk it replaced into the archive first, so
it is reversible.

## Reporting

Please report vulnerabilities privately — see [`../SECURITY.md`](../SECURITY.md).
