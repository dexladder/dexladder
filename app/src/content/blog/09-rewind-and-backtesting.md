The hardest thing to practise in a market is patience, because a market gives you one bar every four hours and no way to skip ahead. Rewind hands you the fast-forward button: real candles, replayed one bar at a time, with a ticket that fills the way it would have.

## What Rewind is

Pick a market, a bar size and a stretch of history. The desk pulls real candles — Binance market data first, then Coinbase, then Kraken — and starts you at the left edge of the chart with the rest of the series hidden.

Then you trade it. Step a bar, step ten, or let it run. The chart draws as the bars arrive, your orders rest in the book, and the equity curve builds underneath.

## The one law that makes it worth anything

**Orders fill on the bars that come next.** A market order fills at the next bar's open. A limit or a stop fills only when a bar actually trades through the level — checked against that bar's own high and low, not its close.

This is the whole difference between a backtest that teaches you something and a backtest that flatters you. A run that is allowed to fill at a price the trader had not yet seen will always look brilliant, and the moment you take that strategy to a live market the edge disappears, because the edge was hindsight.

@figure next-bar-fill · A signal on the bar that closed; the fill on the bar that opens next.

## Hypothetical by construction

Rewind never touches your paper account. Not the balance, not the journal, not the ledger. It is a laboratory, and the Terminal is the desk — keeping them separate means a bad afternoon in 2021 cannot contaminate the record of how you actually trade.

## What the verdict says

At the end of a run the desk reports the numbers a strategy should be judged on, and then leads with the one that matters most:

- **Buy-and-hold over the same bars.** If your strategy made 14% while simply holding made 31%, the strategy lost. The verdict says so first, before any of the flattering statistics.
- **Profit factor** — gross profit over gross loss.
- **Sharpe**, annualised from the real bar size.
- **Maximum drawdown** — the deepest peak-to-trough the account actually saw.
- **Exposure** — what fraction of the time you were in the market at all. A strategy that is flat 95% of the time and beat the market is a different animal from one that was long the whole way.
- **Fees**, including gas when the run is on-chain.

And a **sample-size warning**. Fourteen trades is not evidence. The desk names a small sample rather than letting a headline number stand alone, because the most expensive mistake in backtesting is believing a result that a coin flip could have produced.

## Where it fits between the other tools

| Tool | Bars | Touches your account | Best for |
| --- | --- | --- | --- |
| Terminal | Live, as they happen | Yes | How you actually trade |
| Rewind | Real history, by hand | No | Judgement, patience, reading a chart |
| Bots backtest | Real history, automatically | No | Whether a rule has an edge |
| Bots live | Live, as they happen | No — its own wallet | Whether the rule survives now |

Rewind is the one you sit at. The [bots desk](#/blog/bots-build-and-bring) is the one you point at a thousand bars and walk away from.

## Reading a run afterwards

The equity curve and the drawdown band are the two lines to read together. A curve that climbed steadily and a band that never went past a few percent describes a strategy you could actually have held. The same final number with a 40% trough describes one you would have abandoned in the middle — which means, for practical purposes, you would not have had that final number at all.

## Honest limits

A replay cannot reproduce what your order would have done to the market, and it cannot reproduce the feed outages, the exchange halts or the panic. It reproduces price, volume and time, which is enough to learn structure and nowhere near enough to prove an edge.

It is also, deliberately, on paper. Everything in DexLadder is: see [Paper Trading vs Real DEX Trading](#/blog/paper-vs-real-dex-trading) for where the simulation stops.

Open Rewind from Academy, or start in the [Terminal](#/terminal).
