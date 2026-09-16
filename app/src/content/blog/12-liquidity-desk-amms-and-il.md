Providing liquidity looks like a savings account and behaves like a short options position. The Liquidity Desk is the bench where you can find that out for free — a simulated but protocol-faithful DeFi lab where nothing is a metaphor and every number comes out of the arithmetic the real contracts run.

## Three market makers, implemented properly

**Constant product (Uniswap V2).** `x·y = k`, with the fee taken off the *input*: `out = dx(1−f)·y / (x + dx(1−f))`. LP shares are minted as `min(dx·T/x, dy·T/y)`, the first mint being `√(xy)` less the locked minimum liquidity, and the protocol fee is the one-sixth-of-growth term in its `√k` form.

**Concentrated liquidity (Uniswap V3).** Ticks are `1.0001^t`; liquidity is held between `√Pa` and `√Pb`; a swap walks `√P` by `Δ√P = dy/L` (or `L / (L/√P + dx)`) exactly as the contract's swap step does. A position earns fees **only while the price is inside its range** — the fact that turns V3 from "more capital efficient" into "a job".

*A precision note, stated because it matters:* this desk does the V3 algebra in double precision rather than the chain's fixed point. The two agree to about 1e-12 relative. That is right for a simulator, and we do not claim wei-exactness.

**StableSwap (Curve).** The invariant `A·n^n·S + D = A·D·n^n + D^(n+1)/(n^n·Πx)`, solved by the same Newton iteration the contract uses, with the imbalance fee `f·n / (4(n−1))` and a virtual price of `D / supply`.

@figure amm-curve · The constant-product curve: the further along it your trade walks, the worse each unit costs.

## Impermanent loss, in closed form

For a 50/50 pool, divergence loss is `2√r/(1+r) − 1`. For a weighted pool, `Πr^w / Σw·r − 1`. For a V3 range there is no closed form that survives the boundary, so it is computed from the position value function directly.

Next to it sit the two numbers that decide whether providing liquidity was ever a good idea:

- **Break-even fee APR** — the fee income the pool must produce for you to have matched simply holding.
- **LVR** (loss-versus-rebalancing) — `σ²/8` for a constant-product pool: the structural cost of being the counterparty that arbitrageurs trade against.

And because a single answer to "what will happen" is a lie, the desk runs a **seeded Monte Carlo over geometric Brownian motion**, so what you get is a distribution rather than a point. Seeded, so the same lab gives the same answer twice — a lab whose result changes every time you open it is not a lab.

## Staking, from the consensus spec

The staking bench uses Ethereum's own reward function: base reward per increment is `1 ETH · 64 / √(total active balance)`, so the APR falls with the square root of the total stake, exactly as it does on mainnet. That single curve explains most of what people find confusing about staking yields over time.

- **Slashing** is the real two-part penalty: the initial `EB/32`, plus the correlation penalty at three times the fraction slashed. Being slashed alone is survivable; being slashed alongside everyone else is not.
- **Reward accrual** uses the Synthetix `rewardPerToken` / `userRewardPerTokenPaid` accumulator, so every claim is auditable rather than approximated.
- **veToken boost** is Curve's `min(0.4b + 0.6·S·ve/veTotal, b)`, capped at 2.5×.
- **Liquid staking** tracks an exchange rate and a secondary-market discount; **restaking** stacks correlated slashing on top.

## What the desk says it does not model

Named out loud, on the desk itself: gas, MEV against your own add, contract bugs, oracle failure, bridge risk and depeg tails. Those are not rounding errors — they are where most real DeFi losses come from. A simulator that quietly omitted them would be teaching you that yield is free.

Positions are funded from your main paper book, so the opportunity cost of the capital is visible in the same account.

## The pool sandbox next door

Pool Radar carries a smaller version of the same idea: pick a live pool from the screener and press *Practise this pool* to get a constant-product sandbox with a 1,000-USDT paper book, real liquidity-based slippage, LP fee and gas, marked to the live pool price. It is the fastest way to feel what a thin pool does to a normal-sized trade.

The same curve is what prices your swaps in the Terminal — see [The Advanced Execution Engine](#/blog/advanced-execution-engine) — and the desks that show you where liquidity actually sits are in [The Desks](#/blog/the-desks).
