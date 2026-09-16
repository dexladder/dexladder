Paper trading has a reputation problem. Serious traders call it a toy; beginners assume it is a perfect rehearsal. Both are wrong in useful ways. This article is about what a simulator like DexLadder can honestly teach, where it must admit its limits, and which habits carry over when you eventually use a real wallet — if you ever do.

## What is the same

A great deal of what makes trading hard is not about money at all. It is about prices, mechanics and decisions, and those are real in DexLadder.

- **Prices are live.** Tickers come from public market data, and the Terminal chart draws real history — seven days of 30-minute candles from public exchange data when the primary feed has none.
- **Order types behave like order types.** A limit rests until its price, a stop triggers, IOC and FOK mean what they mean on an exchange.
- **Costs are charged.** Venue fees come out of your paper balance. In Advanced mode on the DEX venue, gas does too — including gas for a swap that reverted.
- **The mechanics of a swap are real mathematics.** The pool curve, the price impact, the slippage check and the sandwich are computed from the same formulas that govern real pools. See [The Advanced Execution Engine](#/blog/advanced-execution-engine).
- **Your record is real.** Every fill lands in your journal and your proof ledger. You cannot quietly forget a bad trade.

That last point matters more than it sounds. The most valuable output of paper trading is not profit; it is an honest record of your decisions that you can study.

## What is different — and always will be

@figure sim-vs-real · Beginner forgives; Advanced puts the pool, the tolerance, the gas and the bots back in.

A simulator that hides its limits teaches overconfidence. So here are DexLadder's, plainly.

### Your trade does not move the real market

In a real pool your swap changes the price for everyone after you. In DexLadder, your fill dents a simulated copy of the pool, and arbitrage heals the dent in about six seconds. The size lesson is real; the consequence for other traders is not.

### The pool is a model, not a specific pool

The DEX venue sizes one full-range pool per coin from the coin's own 24-hour volume. A real token may trade across several pools, fee tiers and chains, some far thinner than the model — and a few far deeper. Always check the actual pool you are about to use.

### One bot, not a dark forest

The simulated MEV bot is rational and alone. The real public mempool has many searchers competing, and some strategies — liquidations, back-running oracle updates, just-in-time liquidity — are not modelled at all.

### No wallet, no approvals, no signatures

A real DEX trade starts before the swap: connecting a wallet, approving a token allowance, checking that the contract is the one you meant. DexLadder never asks for a wallet, because it never touches real funds. That also means it cannot rehearse the most common real-world loss: signing something you did not read. The Academy's wallet lesson and the key labs are where that habit is taught.

### Fear is missing

The largest difference is the one no engine can simulate. Watching 10,000 paper dollars fall does not feel like watching your savings fall. People who trade well on paper often hesitate, chase or freeze with real money. Treat a good paper record as evidence of understanding, not of temperament.

## The habits that carry over

If you practise these in DexLadder, you will keep them.

1. **Preview before you press.** The ticket shows impact, fees and, on-chain, gas before anything is sent. Read the preview every time; real interfaces show the same numbers in smaller type.
2. **Keep tolerance tight.** 0.5% is a sensible default. Widen it only when you know why, and never past the point where a bot could profit from the room you gave it.
3. **Size to the pool, not to your balance.** If your order is a meaningful fraction of the pool, split it or use a limit.
4. **Pay for priority when it matters.** A Low tip on a congested chain can leave a swap pending while the price walks away — and a revert still costs gas.
5. **Know what your stop will do in a gap.** In Advanced mode a stop-loss becomes a market order. A stop-limit protects the price but may not fill.
6. **Write it down.** The journal takes a note on every trade. Your future self will want to know why you did it, not just what happened.

## When to leave paper behind

DexLadder will never make that decision for you, and it will never offer a path to real money. If you do move on, consider moving only when your paper record shows you follow your own rules — sizing, stops, tolerance — over weeks rather than days, and start with an amount you could lose entirely without it changing your life.

> DexLadder is an educational simulator. Nothing in it is financial advice, and paper results do not predict real ones.

## Keep going

The mechanics behind the frictions are in [The Advanced Execution Engine](#/blog/advanced-execution-engine). The lessons that make the habits stick are in the [Academy](#/learn) — start with [Academy & Interactive Labs](#/blog/academy-and-labs) for a map.
