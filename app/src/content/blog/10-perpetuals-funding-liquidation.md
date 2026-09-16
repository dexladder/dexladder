Perpetual futures are how most crypto leverage is actually taken, and they are where most beginners are liquidated. DexLadder's perps desk exists so that the first liquidation you see costs you nothing but the lesson.

## What a perpetual is

A futures contract with no expiry. Because it never settles, something has to keep its price tied to spot — and that something is **funding**: a payment, made at fixed times, from whichever side the market is crowded into, to the other.

Every perp on the desk is **USDT-margined, linear and isolated**. Isolated is the sentence a beginner has to be able to trust: **a position can never lose more than the margin put into it.**

## The arithmetic, printed

One sign convention throughout — `dir` is +1 for a long, −1 for a short.

```
uPnL         = (mark − entry) × qty × dir
equity       = margin + uPnL
maintenance  = mark × qty × mmr − cum
margin ratio = maintenance ÷ equity      (100% → liquidation)
```

Maintenance margin comes from a **ladder**: the maintenance rate steps up as the position gets bigger, with a maintenance amount that keeps the requirement continuous at each step, and a maximum leverage of roughly 1 ÷ (2 × mmr). That is the published shape the large venues use, rounded so it is teachable.

## Funding, and why it moves your liquidation price

Settlements sit on a fixed UTC clock — 00:00, 08:00 and 16:00, or hourly on venues that run it that way. Only a position **open at a settlement** pays or receives. Positive rate: longs pay shorts.

Because margin is isolated, the payment comes out of — or goes into — the position's own margin. So funding really does move the liquidation price. A leveraged position that sleeps through a week of settlements in a crowded market can be liquidated by funding alone, without the price ever going against it. The desk shows this as it happens rather than explaining it afterwards.

The funding rates are **real**: Hyperliquid first (one request covers every perp), then OKX public, then Binance futures public. The Leverage Weather desk shows the same numbers as market structure — open interest, long/short, and a live liquidation tape over a public WebSocket.

## The order of events at one mark

A price that jumped since the last tick is treated as having travelled continuously — no teleporting past a stop. Then, in order:

1. A **stop-loss** that sits before the liquidation price fires first.
2. A **take-profit** fires when reached.
3. Otherwise, once the mark crosses the **liquidation price**, the position is closed.

Stops and liquidations fill **at the mark**. In a gap, that is not the price you hoped for — which is exactly the point.

@figure liq-ladder · Margin, maintenance and the mark: where the position stops being yours.

## The post-mortem

A liquidation on this desk ends in an explanation, not a red toast. It names what happened in words you can act on next time: the leverage you chose, the distance to liquidation it bought you, what funding took out of the margin along the way, whether a stop would have caught it and where that stop would have had to sit.

This is the whole reason the feature exists. A liquidation you paid for teaches you that leverage is dangerous. A liquidation you can read teaches you *at what leverage, at what distance, over what horizon*.

## Learn before leverage

The perps desk opens behind a one-time primer. Not a legal disclaimer — a short explanation of funding, maintenance margin and the liquidation price, because a desk that hands a beginner 50× without a word is not a teaching tool.

Positions opened on the older desk were carried forward rather than dropped: funding moved inside the margin, what the wallet paid was recorded, and the maintenance step now comes from the specification ladder.

## What it will not do

No real money, no exchange account, no wallet connection, ever. And no promise that a paper liquidation feels like a real one — it does not. What transfers is the arithmetic and the reflex: check the funding, check the distance, size the position so the maintenance ladder is never the thing that decides.

Spot execution is a different animal, covered in [The Advanced Execution Engine](#/blog/advanced-execution-engine); the order types that bracket a position are in [Every Order Type on the Desk](#/blog/order-types-and-algos).
