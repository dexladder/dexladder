A news desk in a trading app is easy to build and hard to keep alive. This one has been rebuilt twice in public, and the story of why is more useful than a feature list.

## What the desk shows

Headlines from the major crypto publications, categorised and newest first, next to the market's sentiment reading and an attention signal. Every coin page carries the same feed filtered to that coin — the **Coin Wire** — with each item sentiment-tagged, so you can see what was being said around a move instead of guessing at it afterwards.

## The transport ladder

In September 2026 the desk went blank. Reproduced on the live site: zero cached items, zero sections rendered. The cause was not one broken feed — it was **every transport being dead at once**.

- The same-origin API answered `200 text/html`, because the function tier was not deployed and the app shell was answering instead. The client correctly refused a non-JSON body.
- One public CORS proxy started returning `401`; it now requires a key.
- Another was timing out on half its requests.
- A third was hanging some twenty seconds past the budget.

The fix was a **ladder with health**, not a better proxy: try the same-origin API first, fall through the remaining transports in order, remember the one that worked, and **forget a host that dies so it is probed again** rather than being written off for the session. Feeds are parsed as both RSS and Atom, entities and CDATA are decoded, images are pulled from media or enclosure tags, items are deduplicated by title and sorted newest-first.

## Why "newest first" is a feature

When only one source survives an outage, a naive sort pins that source above everything else and the desk looks full while being a single publication's front page from this morning. The re-sort, and the per-source reporting, exist so that a partial outage is **visible**: a dead feed shows as dead rather than being silently dropped from the mix.

That is the same principle the price ladder uses — see [Markets and the Data Ladder](#/blog/markets-and-the-data-ladder). A missing thing must look missing.

## Sentiment, and what it is worth

The Fear & Greed reading sits next to the headlines. It is a crowd thermometer, not a signal: useful for noticing that you are reading a euphoric tape, useless as a trigger. The app shows it as context and never as a recommendation.

The **Attention pulse** is a different measure and a more honest one. It is built from Wikipedia page-view velocity — how fast people are looking a thing up — which is a real behavioural signal from a public dataset, and it replaced the social feed the app lost when Reddit's open endpoint closed.

## Sentinel — alerts in words

The desk's companion is Sentinel, which turns "tell me when something unusual happens" into a rule you can read:

- A move larger than usual in a window
- A volume spike
- A funding flip, or funding past a level
- A stablecoin losing its peg
- An RSI cross
- A weather level
- A breadth reading across one of your rungs

They live in the same alert list and the same alert centre as everything else, and they are evaluated on the app's single engine tick. The compiler is deterministic: the assistant can front it, but never has to.

@figure sentinel-rule · Plain sentence in, readable rule out — and you can edit it before it arms.

## Reading news without being traded by it

Three habits the desk is arranged to teach:

1. **Check the timestamp before the headline.** An hour-old story about a move that happened yesterday is a story about yesterday.
2. **Check the source count.** One publication saying something is not the market saying it.
3. **Look at the Coin Wire after the chart, not before it.** Deciding what happened and then reading the news is how you learn; reading the news and then finding a chart that agrees is how you get confirmation bias.

The desks that read structure rather than narrative are in [The Desks](#/blog/the-desks). Open [News & pulse](#/news) from Markets.
