A bot is the fastest way to find out whether a rule you believe in survives contact with a market. DexLadder gives you two ways to run one — build it from blocks, or bring your own code — and both trade paper money in a wallet that is walled off from your own account.

## Two ways in

**Build.** A rule is three parts: an indicator, a comparison, a value. Stack a few of them and you have a strategy — *RSI below 30 and price above the 50-period moving average, buy; RSI above 70, sell.* The builder validates the rule as you assemble it, so a strategy that cannot fire is refused at build time rather than sitting there quietly doing nothing.

**Bring.** Your own bot, in one of two shapes:

- **JavaScript in a sandbox.** Your source becomes the Worker's own script — a blob of shield, your code, and a bridge. Nothing is evaluated: the payload stays eval-free.
- **Your own process, any language.** It answers one plain `GET` with one JSON object. A signal endpoint means the strategy can live in Python on your laptop and still trade the same paper book.

## The sandbox, exactly

The shield strips `fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`, `indexedDB` and `caches` from the Worker's global scope before your first line runs. A Worker has no DOM and no storage to begin with, so what is left is arithmetic on the bar it was handed.

One answer per closed bar, with a deadline. A bot that hangs is terminated — not asked to stop, because code in an infinite loop cannot answer a request to stand down. Five consecutive failures stop it for good.

## Every bot has its own wallet

A bot never reaches your paper account. It gets an isolated wallet, and its fills are tagged with its `bot_id`, so a strategy's record is separable from yours forever. That is what makes the Arena honest: you can race a bot against buy-and-hold over the same bars and the comparison means something, because neither side is quietly borrowing from the other.

## The kill switch

The one control that has to work when nothing else does. It is a pure planner: one fixed sequence, and the confirmation on screen prints the planner's own steps, so what you approve is literally what runs.

| Step | What happens |
| --- | --- |
| freeze | The endpoint stops being called; a sandbox Worker is terminated outright |
| cancel | Every working order, by id |
| flatten | Into the bot's own wallet, at the slipped mark — an emergency flatten is a market order and is priced like one |
| seal | One entry in the proof ledger: bot, name, reason, what was cancelled, what was flattened, the price, the equity |
| status | `halted` |

**One entry per kill, never one per step.** The chain keeps 300 entries and then truncates to 120; a chatty bot would push your own trading history out of your own ledger. The entry is seven flat scalars under 400 bytes, and a gate asserts that size.

`halted` is its own status, distinct from `stopped`. A bot you stopped still holds what it held. A bot the kill switch caught does not.

If the ledger is unavailable, the halt still completes and the desk says it was not sealed — rather than implying that it was.

## The log and the telemetry

The **logbook** is bounded and paged, built for a viewer that can hold thousands of lines without holding them all in the DOM.

The **telemetry** is a rolling ring of the last hundred polls. Percentiles are taken by nearest rank, so every latency shown is one the endpoint really printed — not an interpolation between two it never did. The worst failure streak lives on the ring rather than being derived from the visible window, because a bot that was dead for twenty minutes should not read healthy the moment those samples fall out of view. The payload inspector truncates visibly.

## The backtest runs off the main thread

A strategy is tested on real history before it is trusted with anything. That runs in a dedicated Worker, built like the sandbox, with a main-thread fallback that tells you when it fell back. Both paths were proven byte-identical over the same deterministic tape at 600, 400 and 900 bars.

What it reports: win rate, profit factor, expectancy, max drawdown, exposure, fee drag, Sharpe and Sortino — annualised off the real bar size, not a magic constant — plus an underwater series drawn from the wallet's own marks. The wallet marks at open, low, high and close, so a trough taken from bar closes is systematically shallower than the drawdown of record; the desk prints the recorded figure and never labels the drawn trough as the maximum.

**Slippage is set once, in basis points, for the whole desk — and it applies to the backtest and to live fills alike.** Otherwise the promise the backtester is built on, that a backtest and a live run are the same numbers measured on different bars, stops being true.

@figure bot-loop · A bar closes, the bot answers, the wallet fills — and the kill switch can cut the loop at any point in it.

## What a bot cannot do

It cannot reach your account, the network, your storage, or the outside world from inside the sandbox. It cannot trade real money — nothing here can. And it cannot run past a bar it failed to answer.

Open it from Academy, or read [Rewind: Trading History Bar by Bar](#/blog/rewind-and-backtesting) for the desk that replays history by hand instead.
