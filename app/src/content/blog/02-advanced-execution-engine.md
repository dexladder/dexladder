Before v156, a paper market order in DexLadder filled at the price on the screen. That is fine for learning what a market order *is*, and it is still how Beginner mode behaves. But it hides everything that makes a real on-chain trade surprising: the price moving because of your own size, the network fee, the transaction that sits pending, and the bot that trades in front of you.

v156 — *execution* — adds those frictions to the ticket's **Advanced** mode. This article explains each one, the numbers behind it, and why Beginner deliberately leaves them out.

> Everything here is simulated with paper money. The engine is a teacher, not a venue: nothing is ever sent to a real chain.

## Beginner and Advanced

The ticket has two modes, and the difference is intentional.

| Setting | Beginner | Advanced |
|---|---|---|
| Venue | An order-book exchange | Your choice: four order-book venues or the DEX (AMM) venue |
| Price impact | Order-book depth only | Priced on a liquidity pool curve |
| Slippage tolerance | Not shown | 0.1%, 0.5%, 1% or 3% |
| Gas and priority fee | None | DEX venue only: Low, Medium or High |
| MEV bots | None | DEX venue only, off unless you turn them on |
| A stop-loss in a gap | Fills at your stop price | Becomes a market order and fills at the market |

Beginner is forgiving on purpose. Someone placing their first order should learn what a limit and a stop are before they learn what a sandwich is. Advanced is where the market stops being polite.

## Price impact: your size moves the price

On a decentralised exchange there is no order book. There is a pool holding two assets, and a formula that prices every trade against it. DexLadder uses the constant-product rule most DEXs started with:

```
x · y = k
```

Buy the base asset and you take it out of the pool while adding the quote asset; the ratio shifts and every next unit costs more. The average price you pay is worse than the price you were quoted, and the gap grows with your size relative to the pool. That gap is **price impact**.

@figure amm-curve · The pool prices every unit worse than the last: your average fill sits below the price you were quoted, and the gap is the price impact.

How deep is the pool? The engine derives it from the coin's own market data, so a thin coin behaves thinly:

- On the **DEX venue**, the pool holds **2% of the coin's 24-hour volume, and never less than $25,000**. On-chain pools are far thinner than exchange books — that is the lesson.
- On the **order-book venues**, the engine builds a *virtual* pool exactly as deep as the synthetic order book near the mid price, so impact there matches book depth.

The preview and the fill call the same function at the same instant, so the impact you see before you press the button is the impact you get. Your own fill also leaves a small dent in the pool price that arbitrage heals over about six seconds — trade twice in a row and the second trade starts from where the first one left the price.

## Slippage tolerance: the worst price you accept

Real DEX interfaces ask you for a **slippage tolerance**: the most the price may move against you before the swap should fail instead of fill. DexLadder offers four steps — **0.1%, 0.5%, 1% and 3%** — with 0.5% as the common default.

The engine measures tolerance against the price you were **quoted**, because that is the price you agreed to. If the preview already shows impact beyond your tolerance, the order is refused before anything is sent, with the reason in words. A wide tolerance fills more often; as the MEV section shows, it also tells a bot how much room it has.

## Gas and priority fees

Order-book exchanges match trades off-chain and charge no gas. A swap on the DEX venue settles on-chain, so it pays for the block space it uses. DexLadder models Ethereum mainnet, priced from the live gas signal the app already reads:

| Transaction | Units of gas |
|---|---|
| A swap | 150,000 |
| A swap that reverts | 90,000 (a failed transaction still burns what it used) |
| Cancelling a stuck swap | 21,000 |

The price per unit is the live gas price times the **priority tier** you choose: **Low 0.9×, Medium 1.0×, High 1.3×**. The fee is converted into the quote asset of your trade and charged to your paper balance, so the ledger shows it as a real cost.

### What your tier buys you

@figure gas-lanes · A tip does not only cost more — it decides whether your swap lands in the next block, waits, or is never picked up.

A tip does not just cost more — it changes what happens to your transaction. DexLadder reads congestion *relative* to the recent gas history kept on your device, so "busy" means busy compared with what this chain has been doing lately. Then it looks up a small published table:

| Congestion | Low | Medium | High |
|---|---|---|---|
| Calm | 88% next block · 11% pending · 1% dropped | 97% · 3% · 0% | 99.5% · 0.5% · 0% |
| Busy | 50% · 35% · 15% | 84% · 15% · 1% | 96% · 4% · 0% |
| Congested | 20% · 40% · 40% | 62% · 32% · 6% | 93% · 7% · 0% |

- **Included** — the swap lands in the next block (about 12 seconds).
- **Pending** — it waits three to seven blocks. The price keeps moving while it waits; if it lands after the price has moved beyond your tolerance, it **reverts** on-chain and you still pay the revert gas.
- **Dropped** — it is never picked up and is cancelled by a replacement at High. Nothing trades, but the cancellation gas is paid.

The table *is* the documentation. The only chance involved is the draw that picks an outcome from its row, how long a pending swap waits, and how far the price drifts meanwhile — scaled by the coin's own 24-hour move, and larger when the chain is busy.

## MEV: the sandwich

A market swap sent through a public mempool announces two things before it lands: its size and its slippage tolerance. A searcher bot that sees it can **front-run** — buy first, pushing the price toward the worst price you will still accept — let your swap execute at that worse price, and then **back-run** by selling straight back. You "filled within tolerance". Your tolerance was the bot's budget.

@figure sandwich · The bot buys ahead of you, lets your swap fill at the worst price your tolerance allows, and sells straight back.

With **MEV bots** switched on (DEX venue, Advanced only), DexLadder simulates a rational bot, not a random one. It attacks only when both are true:

1. your tolerance is wider than **2%**, so there is room to squeeze, and
2. the attack pays: the back-run's proceeds minus the front-run's cost, the pool fee on both legs and the bot's own gas for two High-priority swaps, is positive.

So "large enough to attack" is not a magic number. It is the size at which your tolerance is worth more than the bot's gas. When it attacks, it takes the largest front-run that keeps you inside tolerance, and the result tells you what happened:

> You were sandwiched by a simulated MEV bot. In real trading this is why low slippage + private RPC matters.

The fastest defences are the ones the simulator lets you practise: a tighter tolerance, smaller clips, or a limit order that caps the price.

## Partial fills and remainders

Not every order fills completely, and the engine says why:

- A **limit** order on the pool fills only up to the point where the marginal price reaches your limit; the rest is the order's remainder.
- **IOC** (immediate-or-cancel) takes what is available now and cancels the rest.
- **FOK** (fill-or-kill) refuses the whole order if it cannot complete.
- On the order-book venues the book itself can run out.

When a pool is so thin it is barely a market — under **$5,000** of liquidity, or able to supply less than **1%** of a market order — the order is refused outright and nothing is sent. Real tokens like that are where traders get stuck; the simulator would rather you learn it here.

## Conditional and algorithmic orders

A ticket with only market and limit on it teaches half the job. The desk carries eight order types, and the last two are the ones a real trader reaches for when the order is bigger than the moment.

| Type | What it does |
|---|---|
| Market | Takes the best price available now |
| Limit | Rests until its price, then fills at it (never worse) |
| Stop | Becomes a market order at its trigger |
| Stop-limit | Becomes a limit order at its trigger — protects the price, may not fill |
| Trailing stop | Follows the high-water mark down by a percentage you set |
| **OCO** | Take-profit and stop-loss as **one** decision: whichever fills first cancels the other |
| **TWAP** | One parent order cut into equal slices, sent on the clock |
| DCA and Grid | Standing plans that keep buying, or work a range |

### OCO — one cancels the other

Two protective legs on a position is the normal way to leave a trade: a take-profit above and a stop-loss below. Left as two separate orders they can both fire in a whipsaw, or leave an orphan working against a position you no longer hold. An **OCO** binds them: the moment one leg fills, the other is cancelled — and if the fill was partial, the surviving leg shrinks by exactly what filled, so the pair never covers more than you hold. Cancel either leg by hand and both go: an OCO is one order, not two.

The ticket asks for both prices and checks them against the market before anything is placed: the take-profit has to be above the price and the stop below it, and you have to hold the size you are protecting.

### TWAP — working an order over time

A size that is large for a pool pays for it all at once: the price impact section above is the arithmetic. A **TWAP** (time-weighted average price) answers it by refusing to be one trade. You give the desk a total, a number of slices and a period; it sends an equal slice at a fixed interval, so the price you end up with is the market's average across the period rather than whatever the book looked like at one instant.

@figure twap-slices · A parent order cut into equal slices and sent on the clock — the price you get is the average of the period, not of one instant.

The parent rests among your working orders and reports itself as it goes: slices sent, size left, average so far. Cancel it and the unsent slices are simply never sent.

It is not free, and the simulator is explicit about the bill:

- **Each slice meets the pool on its own.** The ticket previews a single slice, so you can see the impact one slice pays instead of the impact the whole order would have paid.
- **On-chain, each slice is its own swap** — and pays its own gas at your priority tier. Twelve slices on a busy chain can cost more in gas than the impact they saved. That trade-off is the lesson.
- **A slice can fill short, and the plan says so.** If a slice cannot be funded or the venue refuses it, the rest of the parent is cancelled rather than silently retried.

## Stops in a gap

A price can jump straight through your stop level. What you get then depends on the order type, and v156 writes the rule down:

- **Beginner:** a stop-loss fills at its stop price. It is a stated simplification of the forgiving mode.
- **Advanced:** a stop-loss becomes a market order when it triggers, so in a gap you get the market price plus impact — no tolerance cap, because the point of a stop is to get out. A **stop-limit** becomes a limit order instead, and if the market has already gapped past the limit it does not fill at all.

When a stop fills away from its trigger, the result explains the difference in plain English.

## From the ticket to the Academy

Whenever the preview prices your order on a pool, it offers a link to the lab that shows the curve: **DeFi Playground**. When a swap is pending, dropped, reverted or sandwiched, the link points to **The MEV Auction**, where you bid for block space yourself. Surprise first, explanation one tap away. More in [Academy & Interactive Labs](#/blog/academy-and-labs).

## What the engine does not model

Being honest about the edges is part of the design.

- One chain's fee market (Ethereum mainnet); layer-2 networks are not modelled separately.
- A full-range pool per coin, not the real pool of a specific DEX.
- One rational bot, not a crowd of competing searchers — and no private-RPC route yet.
- Your paper trade never moves the real market; the dent it leaves heals in seconds.

For the bigger picture of what a simulator can and cannot teach, read [Paper Trading vs Real DEX Trading](#/blog/paper-vs-real-dex-trading). To try it now, open the [Terminal](#/terminal), switch the ticket to Advanced and pick the DEX venue.
