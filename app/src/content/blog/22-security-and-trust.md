DexLadder holds no accounts, no keys and no money, which removes most of the ways an app can hurt you. What remains is worth stating precisely — and checking, rather than asserting.

## There is nothing to steal

No sign-up, no email, no password, no wallet connection, no seed phrase, no exchange API key. The app never asks for a credential of any kind, so there is no credential to phish, leak or breach.

Your paper account lives in your browser's storage on your device. The proof ledger that seals your history is computed there too. Nothing is uploaded, because there is nowhere to upload it to.

## No eval, anywhere

The payload contains no `eval` and nothing else in that family — no dynamic function constructor, no string handed to the parser at runtime. This was not always true: an audit found live call sites in an earlier release and they were removed and replaced with a dispatcher, then pinned by a gate so they cannot come back.

That single property is what lets the content-security policy be strict rather than decorative. It is also why running your own bot is safe to offer: your code becomes a Worker's own script — a blob of shield, your source and a bridge — rather than being evaluated inside the page. The shield strips `fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`, `indexedDB` and `caches` before your first line runs. See [Bots: Build One, or Bring Your Own](#/blog/bots-build-and-bring).

## The policy, and the one hole in it that is deliberate

The site ships a strict content-security policy, transport security and a permissions policy in its headers. Scripts have no external origins to load from — the app is one file.

One exception was added on purpose, and it is worth explaining because it looks like a weakening and is the opposite. From one release onward, the policy's `connect-src` blocked loopback — which silently killed two shipped features that talk to *your own machine*: the bring-your-own-bot signal endpoint and the local fork sandbox's JSON-RPC. This was measured in a live browser as a policy violation, not guessed at.

The fix allows **loopback only** — `127.0.0.1` over http and websockets — and four gate assertions pin it, **including the negative**: if anyone ever widens it to open http or websockets to the whole internet, the build fails. An exception that is asserted in both directions is a boundary. One that is only asserted in one direction is a slope.

@figure trust-boundary · Nothing to steal inside the boundary, and one deliberate door to your own machine.

## Errors are caught and told to you

A guard ring records errors and shows a rate-limited recovery message rather than either failing silently or drowning you in toasts. Silent failure is the worse of the two: an app that quietly stops updating a price looks exactly like an app whose price has not changed.

## What the app tells the outside world

It reads public data from public endpoints — prices, candles, categories, on-chain pools, protocol statistics, headlines, page-view velocity. Those requests carry nothing about you beyond the fact that a browser asked. There is no account attached, no identifier to correlate, and nothing sent back.

The **Trust Center** lists every host the app talks to, with its live health, cooldown and the state of the price ladder, so the claim above is inspectable rather than promised. Beside it sit the assistant's model card and DexLadder's laws in plain language.

## The assistant's boundary

The on-device copilot's default runs on your machine. If you point it at a gateway for a larger model, that URL is pasted **by you** in the Trust Center, and the model card states what leaves the device in that configuration. The app never holds a key — the same rule as everywhere else. See [DeXaI, the On-Device Copilot](#/blog/dexai-on-device-copilot).

## What we do not claim

- Not audited by a third party. The gates are ours, they run on every build, and their results are published in the release notes.
- Not a wallet, and never able to move real funds — there is no key material in the app to move them with.
- Not private from your own network. Public endpoints see requests, as they do for any website.

## If you find something

The bug reporter is in the app, and the contact address is in the Trust Center and the privacy page. A reproducible security report gets a gate assertion added along with the fix, which is the only kind of fix that stays fixed.

The architecture that enforces these boundaries in code is in [How DexLadder Is Built](#/blog/how-dexladder-is-built), and where your data lives is in [Sovereignty, the Proof Ledger & On-Device Design](#/blog/sovereignty-proof-ledger).
