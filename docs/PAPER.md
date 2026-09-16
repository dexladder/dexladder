# The DexLadder Paper

*A short, plain-language technical paper · v149 · July 29, 2026 · [dexladder.com](https://dexladder.com)*

## 1 · What DexLadder is

DexLadder is a **client-side crypto market simulator and academy**. Live market data flows in; no real money ever flows anywhere. The entire application — markets, trading terminal, portfolio, P2P desk, block explorer, 12-lesson academy, certificate — is **one self-contained HTML file** that runs in your browser or as an installed app, online or offline.

## 2 · Architecture: one file, no server

There is no backend. The file carries its own design system, its own charting, its own routing, and a service worker for offline use. Because nothing executes server-side, the app cannot collect your data even in principle: there is nowhere to send it. State — paper balances, trades, journal, XP, watchlists — persists in the browser's `localStorage` under keys you can inspect and delete at any time. That working set is capped so it fits a browser key, so the full history of fills, journal entries, alerts and the equity curve is kept beside it in an append-only `IndexedDB` archive named `dexladder-vault`. Both are on your disk, both are yours to read or delete, and both leave together in one signed export.

## 3 · Market data: the five-source ladder

Prices come from a fallback ladder of **keyless public APIs**: CoinGecko → Coinpaprika → CryptoCompare → Binance → Coinbase. If one source fails or rate-limits, the next takes over; if all fail, the app declares it is showing **cached or simulated** prices in a banner — it never silently pretends. On-chain data comes from Blockstream, Blockchair and public EVM RPC nodes; sentiment from alternative.me's Fear & Greed index; DEX pools from GeckoTerminal; token-security checks from GoPlus; chain TVL from DefiLlama.

## 4 · The simulation model

Orders fill against the **live price** with a modeled spread, slippage and fee, so fills feel like a real venue — but the fill happens in JavaScript on your device, updates a paper balance, and touches no market. Order books visualize realistic depth around live mid-price; P2P offers, traders and escrow are scripted bots walking you through the real lifecycle; the community feed is generated locally. Every one of these surfaces carries a **Simulated** badge in the app.

## 5 · Real cryptography

The academy certificate is signed with a real **secp256k1** key generated on your device, hashed with real **SHA-256** — the same primitives Bitcoin uses — and is verifiable offline forever. The point is pedagogical: you finish the course holding a credential that demonstrates the exact cryptography you just learned.

## 6 · Privacy by architecture

No analytics, no cookies, no fingerprinting, no accounts. Third-party APIs are called directly from your device the same way any website loads data; they see an IP address and nothing else about you. Full inventory: [PRIVACY.md](PRIVACY.md).

## 7 · Why free and why anonymous

DexLadder is a gift to the community. No company, no VC, no token. The builder stays pseudonymous so the project has to earn trust the only way that scales: by being **inspectable**.

## 8 · Verify it yourself

- View Source — the whole app is right there.
- DevTools → Network — only public market/data APIs, no telemetry.
- Go offline — the app keeps running on cached data and says so.
- Application → Local Storage — your data, all of it, deletable.
