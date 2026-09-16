The trading ticket gets most of the attention, but it is one screen out of many. DexLadder is laid out as a desk with six destinations, and each of them teaches something the ticket cannot. This is a tour of the rest: the P2P Bazaar, the On-Chain Explorer, Markets, Portfolio and the community corners.

## The P2P Bazaar

A large share of the world first buys crypto not on an exchange but from another person — paying in local currency, by bank transfer or a payment app, with the platform holding the crypto in escrow until the seller confirms the money arrived. It is also where many of the ugliest scams happen. The Bazaar lets you learn that market with paper money.

### How a trade works

1. **Browse offers.** Pick an asset and one of 20 fiat currencies, then sort offers by best price, most trades, completion rate, fastest release or newest traders. Filter for traders online now or ID-verified.
2. **Take an offer.** The maker's crypto locks instantly into a **2-of-3 escrow**: buyer, seller and arbiter each hold one key, and any two can release it. Neither side can touch it alone, and the price is fixed from that moment.
3. **Pay and confirm.** You mark the payment as sent; the seller confirms and releases.
4. **If it goes wrong, open a dispute.** The arbiter's key is the tiebreaker. The Bazaar walks you through what evidence decides a dispute, and why you should never release before the money has actually arrived.

Trader cards show reputation — trade count, completion rate, release time — because in person-to-person trading, the track record matters more than the price. An offer far better than the rest is a warning, not a bargain.

### The Local Mesh

The Bazaar's **Local Mesh** is a real WebRTC link between two devices with no server in between. Instead of a signalling service, the two of you exchange short beacon codes — paste them over any messenger, or read them across the room. Once linked, you can send each other a message or a proof, such as a solvency proof from the Zero-Knowledge Vault lab, and the peer can verify it without seeing your balance.

## The On-Chain Explorer

The Explorer is a read-only window onto public blockchains, live on 15 chains. Search an address, a transaction, a block or a name such as `vitalik.eth`, and it reads the public record directly from public endpoints.

It is also a history lesson. Trace the first block's coinbase transaction, the famous pizza payment or a well-known wallet, and see that the record is exactly what the Academy said it would be: public, permanent and checkable by anyone. The blockchain lesson's *try it live* link lands here on purpose.

The Explorer never needs your address and never connects a wallet. If you look yourself up, that lookup is a public request like any other — which is itself a lesson about how public a public ledger is.

## Markets

Markets is where you find what to look at.

- **The screener** ranks coins by market cap, volume and performance, with sector views and heat lenses.
- **Desks** such as the Pool Radar, Leverage Weather and the Chain Clock read the market's structure: where liquidity sits, how crowded leverage is, how the chains are ticking.
- **News & pulse** gathers headlines from major crypto publications next to the Fear & Greed reading, so you can see what the market is reacting to.
- **Sentinel** turns alerts into words — "this moved more than usual" rather than a bare number.

Pick a coin anywhere in Markets and it opens in the Terminal with its chart, dossier and venues.

## Portfolio

Portfolio is your paper book: balances, open positions, realised and unrealised profit and loss, fees paid — including gas, since v156 — and the journal.

The journal records every fill and takes a note on each one. Export it as CSV whenever you want to study it elsewhere. Portfolio is also where you verify the proof ledger and take backups, covered in [Sovereignty, the Proof Ledger & On-Device Design](#/blog/sovereignty-proof-ledger).

## The community corners

Inside the Academy sit **Discover**, shorter editorial pieces about the wider crypto world, and the **Town Square**, the community corner. The **Journey** tracks your levels, XP and streaks; the **daily challenge** gives you one 60-second decision a day; and the **Monument** is a 3D tribute to the network's pseudonymous founder, sculpted from the network itself.

## DeXaI, the on-device guide

Across the desk, DeXaI answers questions about what you are looking at — reading a chart, a coin, a desk or a lesson in plain language. Its numbers come from the data on screen, never invented, and by default it runs on your device.

## How it fits together

@figure desk-map · Every destination shares one paper account, and every one of them points at the others.

Every destination shares one paper account and one design, and each one points at the others: a lesson links to the screen it describes, a coin in Markets opens the Terminal, the ticket links back to the lab that explains what just happened. The execution side of that story is in [The Advanced Execution Engine](#/blog/advanced-execution-engine); the engineering that holds it together is in [How DexLadder Is Built](#/blog/how-dexladder-is-built).

Start exploring: the [P2P Bazaar](#/p2p), the [Explorer](#/explorer), [Markets](#/markets) or your [Portfolio](#/portfolio).
