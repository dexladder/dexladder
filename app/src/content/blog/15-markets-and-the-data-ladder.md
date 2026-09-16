An app that shows you a price has made a promise. This is how DexLadder keeps it: no API keys, no single source of truth, and a rule that a missing number is never allowed to become a zero.

## The screener

Markets ranks around 500 coins by market cap, volume and performance, with sector views and heat lenses. Pick any coin and it opens in the Terminal with its chart, dossier and venues.

**Rungs** replace watchlists, the filter drawer and the tab strip with one idea: a named lens over the ladder. Some are curated and computed live — Climbers, Sliders, Oversold, Overbought, Clean Ladder — and the rest are yours. A rung is shareable as a signed link, using the same key that signs your certificates. No accounts, no followers.

**Sectors** turns 500+ categories into a browsable sheet, each one a tap away from becoming a rung, with a narrative-rotation ribbon that ranks sectors by 24-hour move relative to the whole market and by volume heat — with the formula printed on the card.

## One canonical snapshot

The market's headline figures — total cap, 24-hour volume, dominance — used to be answered by seven different producers over different universes at different instants. They now come from one snapshot, built on four rules:

1. **A figure is a number, or it is null with a reason** from a closed set. There is no path on which a missing number becomes 0.
2. **Several witnesses resolve to their median.**
3. **A spread past tolerance is recorded as a disagreement**, not hidden.
4. **Ratios are taken inside one universe from one source**, and a subset can never silently out-measure its superset.

That is a boring set of rules that removes an entire class of quietly wrong dashboards.

## The price ladder

Prices come off a ladder of keyless public sources with per-host health: probe, cool down when a host misbehaves, serve stale with its age rather than serving a guess.

The ladder has had to be maintained in public. CoinDesk Data ended free API access in May 2026; Reddit's unauthenticated endpoint closed; Binance's main host is hostile to browsers. So requests are rewritten to the market-data host, spot answers come from Coinlore with OHLC from Kraken and Coinbase, and the social signal was rebuilt as an **Attention pulse** from Wikipedia page-view velocity.

**No fetch-once-per-session surfaces.** Anything sourced from outside must keep itself current — a law the app is gated against, because a stale number that looks live is worse than no number.

@figure data-ladder · Rung by rung: probe, health, median, and a reason when there is no answer.

## Honest history

A coin's 7-day series is 336 samples. Sources without a sparkline used to pad that array with a constant — and then every chart drew a flat line and a cliff that never happened, while RSI, correlation and the volatility cones all read a fiction. The app now recognises that padding and rebuilds the series from public candles at the same length.

The Spotlight's 7-day card had the mirror-image bug: it drew the last 84 points of an array that holds seeded history followed by one live tick every 1.5 seconds, so two minutes into any session the "7-day" card was showing the last two minutes. Both are fixed, and both are worth knowing about, because they are the failure mode of every chart that is not checked: it does not go blank, it goes plausible.

## Two witnesses for one pool

Pool Radar reads GeckoTerminal. A second layer reads CoinMarketCap's keyless on-chain tier for the same pools — and then does the thing neither screener will do for you: it puts the two prices for **one pool** side by side and says out loud when they disagree.

A DEX price is an observation, not a fact. Two indexers watching one contract can differ by a block, by a reserve read, by an aggregation rule. A learner who has only ever seen one number believes it.

## Pool Radar

The on-chain screener: Trending, Fresh, Movers and search across GeckoTerminal networks, with 5-minute, 1-hour, 6-hour and 24-hour columns, buys and sells, liquidity, fully diluted value and age to the second. Contract security comes from a keyless scanner for EVM and Solana chains. Pool candles are drawn by the app's own canvas, and *Practise this pool* opens a constant-product sandbox against it.

Where liquidity, leverage and time are read as structure rather than price is [The Desks](#/blog/the-desks); the headlines next to them are in [The News Desk](#/blog/news-sentiment-and-attention). Start at [Markets](#/markets).
