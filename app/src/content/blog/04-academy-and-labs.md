The Academy is the part of DexLadder that exists to make itself unnecessary. Its job is to take someone who has never held a crypto asset to the point where the rest of the app — the Terminal, the Explorer, the Bazaar — makes sense on sight. It does that with a short lesson path, a set of hands-on labs, a daily challenge, and a certificate you can verify without asking anyone.

Everything in it runs on your device. Progress is saved in your browser's storage, the labs generate their own throwaway keys, and nothing about how you learn leaves the device.

## The lesson path

Twelve lessons, in order, each short enough to finish over a coffee:

1. What even is crypto?
2. The shared notebook
3. Fingerprints (hashing)
4. The blockchain
5. Mining & consensus
6. Wallets & keys
7. Exchanges & on/off-chain
8. Smart contracts
9. DeFi: staking, farming, yield
10. Tokens & ICOs
11. Ways to earn + trading
12. Bitcoin's journey

Every lesson starts with the plain version — the one you could explain to a child — before it adds the precise one. Many end with a *try it live* link that drops you on the right screen of the app with the idea still fresh: the Explorer after the blockchain lesson, the ticket after the trading lesson.

The path is drawn as a constellation on the Academy page. Finished lessons light up, and your Journey tracks the streak.

@figure lesson-path · Twelve lessons in order, with the labs hanging off the ideas they teach.

## The labs

Lessons explain; labs let you break things. Each lab is a small, self-contained simulation you can run as often as you like.

| Lab | What you do |
|---|---|
| DeFi Playground | Provide liquidity, meet impermanent loss, borrow against collateral and dodge liquidation |
| The MEV Auction | Outbid rival searchers for block space without catching the winner's curse |
| Multi-Sig Vault | A 2-of-3 vault with three real secp256k1 keys: one signature is rejected, the threshold clears it |
| The Re-Entrancy Heist | Step through the bug that drained a vault, watch it empty itself, then patch it |
| Flash Loan Workbench | Assemble a four-step atomic arbitrage — and watch the whole thing revert if you overreach |
| Lightning Router | Route payments through hidden channel liquidity: fail, learn, reroute |
| Zero-Knowledge Vault | Prove you are solvent without revealing your balance, with real Pedersen commitments |
| Staking Lab | See what restaking really does to a yield over the years |
| NFT Mint Lab | Mint, list and price — gas, floor price and royalties |
| Sim Lab | Play with the physics: the halving timeline and a 51% attack |

Alongside them sit story-driven pieces — The Genesis, The Whitepaper, Proof of Absence, The Meme Exam — and the Monument, a 3D tribute to the network's pseudonymous founder.

The keys the labs create are real in the mathematical sense: real secp256k1 signatures, real SHA-256 hashes. They are generated on your device for the lesson and hold nothing.

## The desk sends you back to the right lab

Since v156, the trading ticket and the Academy are wired together. When an Advanced-mode order is priced on a pool, the preview offers **See the curve in the Academy: DeFi Playground**. When a swap is left pending, dropped, reverted or sandwiched by a simulated bot, it offers **Practise it in the Academy: The MEV Auction** instead.

The rule behind it is simple: the most surprising thing that just happened decides which lab you are offered. A sandwich beats a revert; a revert beats ordinary impact. Beginner mode offers no detour at all — a first order should just be a first order. The full story of those frictions is in [The Advanced Execution Engine](#/blog/advanced-execution-engine).

## The daily challenge and your Journey

The **daily challenge** is a 60-second scenario — a macro headline, a portfolio, a decision — that changes every day. It is small on purpose: one decision, made quickly, explained afterwards.

The **Journey** collects everything else: levels and XP, streaks, and the first-flight quest that walks a new visitor through a first lesson, a first paper trade and a first look at the Explorer. It is a map of what you have done, not a leaderboard; it lives on your device and nobody else sees it.

## The certificate

Finish all twelve lessons and you earn a certificate. It carries your chosen name, the date and a digital signature made with a secp256k1 key that belongs to your device. Anyone can check that signature offline — no server has to vouch for it, because none issued it.

The certificate is part of your proof ledger, so it travels with your backup. How the ledger and the backups work is covered in [Sovereignty, the Proof Ledger & On-Device Design](#/blog/sovereignty-proof-ledger).

## The Blog, Discover and the Town Square

The Academy is also home to three reading rooms:

- **Blog** — the long-form knowledge base you are reading: how DexLadder works and why, versioned so every link stays valid.
- **Discover** — shorter editorial pieces about the wider crypto world.
- **Town Square** — the community corner.

## Where to start

Open the [Academy](#/learn) and begin with lesson one. If you already know the basics, go straight to the DeFi Playground and The MEV Auction, then place an Advanced swap in the [Terminal](#/terminal) and see whether the engine agrees with what you learned.
