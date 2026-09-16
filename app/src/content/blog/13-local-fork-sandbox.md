Everything a learner sees in a trading app is someone else's market. The Local Fork sandbox is the exception: point DexLadder at a chain you own — `anvil --fork-url …`, or a Hardhat node — and trade your own contracts inside the same ticket, with the same order types, the same price-impact model and the same ledger.

## What it is for

Fork mainnet at a block. Now the pools are the real pools with the real reserves, and the account the node unlocked has all the money you told it to have. Trade into a pool and watch what it does to the price. Deploy your own token, seed a pool, and see what a thin market feels like from the inside. Roll the chain back and do it again.

For anyone writing contracts, it is a familiar loop with an unfamiliar front end: a proper trading terminal instead of a test script.

## Connecting

You give it one URL. The panel talks to that host and no other.

The doctor exists because of a browser limitation worth knowing about: **a browser cannot be told why a cross-origin request failed.** A refused connection, a missing CORS header, mixed content and Chrome's private-network preflight all arrive as the same empty `TypeError`. So the layer reports what it actually saw, and the doctor ranks the likely causes with the command that fixes each one. It never guesses out loud.

The most common fix is starting your node with the header it needs, which is exactly the sort of thing the doctor prints rather than making you search for.

## No key ever enters DexLadder

Writes go out as `eth_sendTransaction` from an account the node has **already unlocked**. DexLadder never holds a private key, never asks for a seed phrase, and has no wallet to connect.

This is also why pointing the panel at a real public RPC degrades to read-only all by itself: a public node has no unlocked accounts. On top of that, the write policy refuses any chain that never identified itself as a fork or a dev node. Both guards have to fail before anything could go out to a live chain, and neither of them is the only thing standing in the way.

**Every write is dry-run with `eth_call` first**, so a revert costs nothing and arrives as the contract's own message rather than as a failed transaction you have to decode.

## Where the code lives, and why that matters

"All data stays on your device" is not a slogan here — it is a law the architecture gate enforces against the whole typed core. So the typed core builds every JSON-RPC request and decodes every answer, a hook sequences them, and a view draws the panel; **none of them may contain a network call.** The one place HTTP is allowed to exist is a single legacy layer, installed once, that talks to the one URL you typed.

@figure layer-stack · The typed core builds the request; one layer, and only one, is allowed to send it.

One POST per call or batch. No cache — a block number must never be served from one. No credentials — a node is not an account. An explicit timeout, because a dead host would otherwise hang the panel. The response text is handed back verbatim for the typed parser to read.

The same tree carries what a terminal needs to speak to a chain at all: ABI encoding and decoding, event signatures, keccak, big-integer arithmetic, unit conversion, ERC-20 reads, and V2 and V3 pool maths.

## What you can do with it

- Trade real forked pools with real reserves and watch price impact you caused.
- Deploy a token and a pool of your own and trade against it.
- Reproduce a sandwich against yourself and see the two transactions around your own.
- Test a contract change against a terminal instead of a script.
- Break things, roll back, repeat.

## What it is not

It is not a wallet, not a bridge to mainnet, and not a way to trade real money — no part of DexLadder is. It is an advanced feature and it says so: if you have never run a local node, the rest of the app is where to start.

The paper market's own execution model, which the fork ticket reuses, is in [The Advanced Execution Engine](#/blog/advanced-execution-engine). The architecture that keeps the network out of the typed core is in [How DexLadder Is Built](#/blog/how-dexladder-is-built).
