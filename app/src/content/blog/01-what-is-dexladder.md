DexLadder is a place to learn how crypto markets work and to practise trading them — with paper money, on your own device, without an account. Open it and you are already in: there is no sign-up form, no email to confirm and no wallet to connect. You start with 10,000 paper USDT, live prices from public market data, and a desk full of tools that a real trader would recognise.

That is the whole idea in one sentence: **a real trading desk, with pretend money, that keeps nothing of yours anywhere but on your device.**

## Who it is for

DexLadder is built for three kinds of people.

- **The curious beginner** who has heard the words — wallet, gas, slippage, DEX — and wants to understand them by doing, not by reading a glossary.
- **The self-taught trader** who wants to test an idea against live prices without risking savings on the first attempt.
- **The careful sceptic** who wants to see what actually happens to a swap on-chain before trusting any app with real funds.

None of them should have to hand over an email address to find out whether crypto is for them.

## What you can do in it

The app has six destinations, always in the same place: the bottom bar on a phone, the rail on a desktop.

| Destination | What it is |
|---|---|
| Terminal | The trading desk: a live chart, the order ticket, the order book and your open orders |
| Markets | The screener, sector views and the news pulse |
| Portfolio | Your paper book: balances, positions, realised and unrealised profit, the journal |
| Academy | Lessons, interactive labs, this blog, the Town Square, your journey and the daily challenge |
| Explorer | A read-only window onto public blockchains |
| P2P | The Bazaar — a simulated person-to-person marketplace with escrow |

@figure desk-map · Six destinations, one paper account — and nothing of yours leaves the device.

Every one of them works with the paper account. Nothing on any screen moves real money, and nothing ever will.

## Paper money, on purpose

It is tempting to think of paper trading as a toy version of the real thing. We think of it the other way round: it is the only honest place to make your first hundred mistakes.

A paper trade in DexLadder is priced from the live market. Since v156, when you switch the ticket to **Advanced**, it also meets the frictions of a real on-chain swap: the pool's depth, your slippage tolerance, the network's gas price, the chance that your transaction sits pending, and — if you turn them on — simulated MEV bots reading the public mempool. The article [The Advanced Execution Engine](#/blog/advanced-execution-engine) walks through each of them.

What paper trading cannot give you is the feeling of your own money on the line. We say so plainly in [Paper Trading vs Real DEX Trading](#/blog/paper-vs-real-dex-trading), because a simulator that pretends otherwise teaches the wrong lesson.

## Private by design

DexLadder has no backend of its own that knows who you are. Your balances, orders, journal, lesson progress and certificates live in your browser's storage on your device. When the app needs a price, it asks a public market-data source directly; when it needs to prove something about your history, it seals it with SHA-256 on your device.

That has consequences we accept on purpose:

- There is nothing to log into, so there is nothing to lose if a server is breached — there is no server holding your data.
- There is no password reset either. If you clear your browser's storage, your paper account goes with it — unless you kept a backup. The backup file is yours, signed on your device, and it can be verified by anyone. [Sovereignty, the Proof Ledger & On-Device Design](#/blog/sovereignty-proof-ledger) explains how.

## Learning is first-class, not a side menu

The Academy is not a help page. It is a path of twelve lessons, from *What even is crypto?* to wallets, exchanges, smart contracts and DeFi, alongside hands-on labs where you sign with real keys, bid for block space, watch a re-entrancy bug drain a contract, or push a trade along an AMM curve. Finish the path and you earn a certificate signed with a real secp256k1 key — a certificate you can verify offline.

The trading desk and the Academy talk to each other. When an Advanced order is priced on a pool, the ticket offers the lab that explains the curve; when your swap is sandwiched by a simulated bot, the result points you to the lab about MEV. The goal is that the moment something surprises you is the moment you learn why. [Academy & Interactive Labs](#/blog/academy-and-labs) covers the whole path.

## What DexLadder will never do

Some promises are easier to keep when they are written down.

- **It will never take real money.** No deposits, no withdrawals, no card forms, no swaps of real assets. Paper only.
- **It will never require an account** for trading or learning.
- **It will never send your paper book, journal or progress to a server.** They live on your device.
- **It will never ask for a private key or a seed phrase.** The labs generate their own throwaway keys, on your device, for teaching.

## Where to go next

If you are new, start at the first lesson in the [Academy](#/learn) and place your first paper trade in the [Terminal](#/terminal) — Beginner mode keeps the ticket simple. If you already trade, flip the ticket to Advanced, pick the DEX venue and read how the [execution engine](#/blog/advanced-execution-engine) prices what you see. And if you want to know how a whole trading desk fits in one file with no backend, [How DexLadder Is Built](#/blog/how-dexladder-is-built) is for you.
