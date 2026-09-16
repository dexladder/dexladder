DexLadder is a full trading desk, an academy and a blockchain explorer — and it ships as one HTML file with no backend and no accounts. This article is for the curious and the technical: how that is possible, what the parts are, where the data comes from, and the checks every release has to pass before it reaches you.

## One file, installable, offline-capable

The whole app is a single `index.html` of roughly 2.8 MB: markup, styles, scripts, icons and the brand mark, all inline. Around it sit a handful of static files — a web manifest so it installs like an app, icons, a service worker, and the privacy, support and terms pages.

The **service worker** makes it work offline without trapping you on an old version:

- the app shell loads **network-first with a deadline**, falling back to the cached copy only when the network is slow or absent;
- market data is cached briefly and size-bounded, and when the app falls back to it the interface says *cached* instead of *live*;
- nothing reaches a cache unless it is a genuine success of the right content type, so an error page can never become the app.

Because it is static, it is hosted on ordinary static hosting. There is no application server to scale, patch or breach.

## No backend, on purpose

There is no DexLadder database and no DexLadder login. Everything that belongs to you — the paper book, journal, lesson progress, the proof ledger, your signing key — lives in your browser's storage. [Sovereignty, the Proof Ledger & On-Device Design](#/blog/sovereignty-proof-ledger) covers what that means for you. For the engineering it means three things:

1. **Every feature must work from public data plus local state.** If a feature would need a server to remember something about you, it is redesigned or it does not ship.
2. **The cryptography runs in the page.** SHA-256 for the proof ledger, secp256k1 for certificates and signed backups, Pedersen commitments in the zero-knowledge lab — implemented in JavaScript, on your device.
3. **Paper money only.** There is no code path that moves real value, so there is nothing to secure on that front.

## Where the data comes from

Prices and market data are public, and DexLadder reads them directly from the sources that publish them, with fallbacks so no single outage blanks a screen.

| What | Public sources |
|---|---|
| Prices, market caps, sparklines | CoinGecko, Coinpaprika, Coinlore |
| Candles and chart history | Binance market data, Kraken, Coinbase |
| Sentiment | alternative.me Fear & Greed |
| Gas and chain state | public Ethereum RPC endpoints, mempool.space, Blockstream |
| Explorer look-ups | public block explorers and RPC endpoints |
| Background reading | Wikipedia and major crypto publications |

When a source returns a series that is obviously padded — a flat line that ends in a cliff — the app replaces it with real candles instead of drawing something false. That rule, *never show a fabricated line*, is tested like any other.

## The layers

The file is assembled by a build script from three kinds of input:

- **A pinned base** — the long-lived application, identified by its SHA-256 so the build refuses to run against anything else.
- **Layers** — self-contained scripts and stylesheets that each add one capability and mount themselves.
- **Patches** — small, precise text changes to the base. Every patch declares how many times its target must appear; if the base ever drifts and a patch would land zero times or twice, the build stops.

@figure layer-stack · A pinned base, the typed core, self-mounting layers and count-asserted patches — assembled into one file.

### The typed core

Newer work lives in a strict TypeScript core, bundled into the file and exposed as one frozen namespace so nothing downstream can rebind it at runtime. It follows a few hard rules:

- **Pure functions first.** The indicators, the paper engine (pool curves, price impact, gas, MEV, order handling), the market-history repair and this blog's markdown parser are pure: no page, no storage, no network, no clock, no randomness. Randomness and time are passed in, so every behaviour is reproducible in a test.
- **Small components.** Every interface component is at most 150 lines and no source file reaches 300.
- **One design system.** Colours, spacing and type come from tokens; components use registered class names and never write styles or raw colours of their own. Day and Night are the only two appearances.
- **No network in the core.** Data arrives through the app's one shared fetch layer; the typed core itself never calls the network.

The engine behind v156 is a good example: the preview and the fill call the same pure function at the same instant, so what the ticket shows is exactly what the fill does. See [The Advanced Execution Engine](#/blog/advanced-execution-engine).

### The blog itself

These articles are markdown files bundled as text. A small, strict parser turns them into data — headings, paragraphs, lists, tables, callouts — and the view builds the page from that data. A post can contain no markup, script or style, and a link can only point inside the app or to an `https` address. Posts are append-only: a published address never changes, so a link to one keeps working in every later version.

## The gates

A build is not a release until it passes every gate. Among them:

- **Type checking** of the whole core in strict mode.
- **Unit tests** for every pure module, including parity tests that pin legacy behaviour byte-for-byte where it was deliberately kept.
- **Architecture laws**: component size, purity, no network, no inline styles, bundle freshness, and a ratchet that only lets legacy debt go down.
- **Browser gates** that load the real file in a headless browser at phone, tablet and desktop widths, in Day and in Night, and check hundreds of behaviours — the chart panel's size, the navigation, the ticket, the brand mark.
- **Contrast**: every text colour must meet WCAG AA in both appearances, measured on the rendered page.
- **The service worker**: the shipped worker must match the payload it was built for, so a visitor can never be served a mismatched pair.

When someone reports a bug, the fix lands together with a permanent check that would have caught it.

## Why build it this way

A trading app that holds nobody's money and nobody's data has an unusual freedom: it can be private without a privacy policy doing the work. Keeping it to one file, public data and pure, tested code is how we keep that freedom as it grows.

New to DexLadder? Start with [What is DexLadder?](#/blog/what-is-dexladder) — or open the [Terminal](#/terminal) and place a paper trade.
