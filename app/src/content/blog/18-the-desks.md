A screener answers "what is this asset worth". Most of the questions that actually decide a trade are structural: where is the liquidity, how crowded is the leverage, what is due this week, which corner of the market is rotating. The desks are pages named after those questions.

## The rail

Every desk is one tap from Markets. They share one account, one design and one data ladder; each is a lens, not a separate app.

## Reading the market's structure

**Pool Radar** — the on-chain screener: trending, fresh and moving pools across networks, with liquidity, buys and sells, fully diluted value, age to the second, and contract security. *Practise this pool* opens a constant-product sandbox against the pool you are looking at.

**Leverage Weather** — real funding, open interest, long/short and a live liquidation tape streamed over a public WebSocket, opened only while the desk is on screen. A 0–100 composite summarises it, with the formula printed on the card. The same funding feeds the perps simulation, so the desk and the ticket cannot disagree.

**Cycle dials** — Pi-Cycle, the Mayer Multiple and Puell, computed from 365 daily closes. Long-horizon context, not signals.

**Chain Ladder** — total value locked, DEX volume, fees and stablecoin capitalisation per chain, with each native token one tap from its coin page.

**Venue Board** — where a coin actually trades: centralised venues with trust score, volume, country and year, decentralised venues by volume, and *fill quality for your size* from the execution model. The number that turns "listed on 40 exchanges" into "tradeable on three".

## Time, expectation and odds

**Chain Clock** — events that cannot go stale, because the chain or a published rule is the source: the halving from the chain tip, the difficulty retarget, monthly options and futures expiries from calendar rules, public prediction-market resolutions, and your own deadlines. No editorial calendar, so it is never empty and never wrong.

**Forecast Journal** — log a price range and a confidence for 7 or 30 days. When it lands, it is scored with a Brier score, and the journal shows your calibration by confidence bucket. **XP is awarded for calibration, not for being right** — the only version of forecasting that improves anyone. Beside it, a scenario cone at one and two standard deviations of realised volatility: the honest answer to "where will price go", which is statistics rather than a target.

**Odds Desk** — live public prediction-market odds you can paper-trade, with a separate 1,000-USDT book, a printed spread and slippage model, settlement to $1 or $0 on resolution, and a Brier score on the probability you paid.

## Yield, conversion and composition

**Yield Sandbox** — real pools you can paper-stake. Yield accrues daily on paper; impermanent loss and smart-contract risk are **named, not modelled**, which is the honest position for a simulator. The full arithmetic bench is [the Liquidity Desk](#/blog/liquidity-desk-amms-and-il).

**Convert** — 30+ fiat currencies, plus time-travel conversion: what that amount was worth on a date.

**Baskets** — build an index, equal- or cap-weighted, track it against the market's benchmark, and paper-trade the whole basket as one unit through the real fill engine.

## Measured on your device, because no one publishes it

**Supply Drift** — the sovereign answer to token unlocks. No free unlock feed exists, so the app records circulating supply daily on your device and shows measured 7- and 30-day dilution per coin, with a movers sheet. It starts the day you start.

**Era Ledger** — weekly top-100 snapshots, recorded from today, with a scrub to replay the ladder as it was. It is honest about its start date rather than pretending to a history it did not observe.

Both are worth understanding as a design position: rather than claim data the app cannot get, it measures what it can see and tells you when the measurement began.

## Lenses

**Heat lenses** redraw the market heatmap by rung, by sector, or coloured by RSI. **Rungs** and **Sectors** are covered in [Markets and the Data Ladder](#/blog/markets-and-the-data-ladder); **Sentinel**, which turns any of these into an alert in plain words, is in [The News Desk](#/blog/news-sentiment-and-attention).

@figure desk-map · Every destination shares one paper account, and every one of them points at the others.

Open [Markets](#/markets) and work along the rail.
