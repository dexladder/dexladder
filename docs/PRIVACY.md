# Privacy Policy — DexLadder

Effective: 29 July 2026 · Contact: [dexladder@gmail.com](mailto:dexladder@gmail.com) · [← back to the app](/)

**The short version:** DexLadder has no server, no accounts and no analytics. We do not collect, store, sell or share any personal data — we have no infrastructure that could. Everything you do stays in your browser's local storage on your device.

## What we collect

**Nothing.** DexLadder is a single self-contained HTML file that runs entirely on your device. There are no analytics scripts, no cookies, no tracking pixels, no crash reporters and no fingerprinting. There is no DexLadder server to receive data.

## About the "Google / Apple" sign-in buttons

The in-app account feature creates a **local identity that never leaves your device**. The "Continue with Google" and "Continue with Apple" buttons are **simulated** — pressing them does not open a real Google or Apple sign-in, sends no request to Google or Apple, and never asks for a password. They exist so the academy can teach account flows safely. Your profile (a display name and a locally generated key) is stored only on your device, in your browser's localStorage.

## Optional Google Wallet pass

If — and only if — you choose to add your course certificate to Google Wallet and paste in **your own** Google issuer credentials, the app calls Google's Wallet API directly from your device using those credentials. We never see them; they are stored locally and you can delete them at any time.

## Third-party data sources

To show live markets, the app requests public data directly from: CoinGecko, Coinpaprika, CryptoCompare, Binance, Coinbase (prices); alternative.me (Fear & Greed index); open.er-api.com (fiat rates); GeckoTerminal (DEX pools); GoPlus (token security); DefiLlama (TVL); Blockstream, Blockchair and public Ethereum/Avalanche RPC nodes (on-chain lookups); RSS proxies allorigins.win / codetabs.com (news headlines); api.qrserver.com (QR images). These are ordinary web requests: the provider sees your IP address and standard request headers, governed by **their** privacy policies. No identifier, account or personal field is ever attached, because none exists.

## What is stored on your device

Two stores, both on your device and nowhere else.

**Browser localStorage** holds the working desk: your paper portfolio and open trades, journal, alerts, academy progress and XP, certificate name (if you set one), display preferences (theme, mode, contrast), cached prices, and a locally generated signing key.

**IndexedDB**, in a database named `dexladder-vault`, holds the archive: the full history of fills, journal entries, alerts and the equity curve — kept past the limits the working desk has to prune to in order to fit a single browser key.

**To erase everything:** clear this site's data in your browser, or uninstall the app. That clears both. Nothing survives, because nothing was ever anywhere else.

**To check this rather than believe it,** open your browser console on dexladder.com:

```js
await DLVAULT.ready; DLVAULT.writable()  // true when the archive is on
DLVAULT.stats()                          // rows archived, bytes held, quota reported
DLVAULT.panel()                          // the same figures, with export and import
```

None of those calls reach a network. There is no server to reach.

## Children

DexLadder is an educational tool appropriate for students. Since no data is collected from anyone, no data is collected from children.

## Changes

Changes to this policy are listed in the public changelog inside the app, and the effective date above is updated.

## Contact

[dexladder@gmail.com](mailto:dexladder@gmail.com) · [@dexladder](https://x.com/dexladder) · [github.com/dexladder](https://github.com/dexladder)
DexLadder is an independent educational project. Built anonymously and gifted to the community. No company, no VC, no real money — ever.
