A paper account is only worth having if it keeps an honest record. Portfolio is where DexLadder keeps yours: what you hold, what it cost, what you paid to get it, and what you thought at the time.

## The book

Balances, open positions, realised and unrealised profit and loss, and **fees paid — including gas**. Gas is in the ledger because a strategy that is profitable before gas and unprofitable after it is a losing strategy, and an app that hides the cost of execution teaches people to build exactly that.

Open perpetual positions carry their own isolated margin and are marked against the live price beside your spot book, so the account's equity is one number rather than two you have to add up.

## The journal

Every fill is recorded, and every fill takes a note.

The note is the feature. A row that says *bought 0.4 ETH at 3,412* tells you nothing in a month's time. A row that says *bought because the sector ribbon flipped and I did not check the funding* tells you everything — and it is the only way a paper account turns into a skill instead of a scorecard.

Export the journal as CSV whenever you want to study it somewhere else. There is a **tax summary** too, bucketing realised results into short- and long-term at a rate you set, printable — an educational exercise on paper trades, not a filing.

## The statistics, and their honest form

The quant reports go past the headline return: profit factor, expectancy, win rate, average win against average loss, exposure, drawdown, and a correlation view of what you actually hold — which is usually less diversified than it looks, because most of a crypto book is one bet expressed several ways.

Two of them deserve attention:

- **The Monte Carlo fan.** Your trade results, resampled many times over, drawn as a distribution of where an account like yours ends up. A single equity curve is one sample from that fan. Seeing the fan is the fastest cure for believing a good month was skill.
- **Maximum drawdown.** Not the number people quote, the number they lived through. A strategy you could not have held is a strategy you did not have.

## Proof, not screenshots

Your history is sealed into a SHA-256 chain on your device — the same ledger the trading desk writes to, described in [Sovereignty, the Proof Ledger & On-Device Design](#/blog/sovereignty-proof-ledger). Portfolio is where you verify it and take backups.

@figure ledger-chain · Each entry seals the one before it, so a changed row breaks every link after it.

Two things follow from that:

1. **A performance certificate** can be signed with your own key, so a claim about your paper record is checkable rather than assertable.
2. **An independent auditor** ships as its own page: hand it an exported ledger and it re-computes the chain and tells you whether the record has been touched. It does not need DexLadder to do it, which is the point — a proof you can only verify inside the app that produced it is not a proof.

## The read-only mirror

If you want to watch a real address without ever connecting a wallet, the mirror reads a public address and shows its holdings as a view. Read-only, keyless, no signature requested, nothing to approve. Your paper book and that address never touch.

## Habits this book is built to produce

- Note the reason at the moment of the trade, not after the outcome is known.
- Read your fee column monthly. It is usually bigger than expected.
- Compare your equity curve against simply holding, the way [Rewind](#/blog/rewind-and-backtesting) does automatically — beating a rising market is the only version of "up" that counts.
- Back up before you experiment, so an afternoon of nonsense costs you nothing.

Open your [Portfolio](#/portfolio).
