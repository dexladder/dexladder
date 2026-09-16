A market order is the one every beginner uses and the one that costs them the most. The paper desk carries the full order book of a real venue, so you can learn what each type is *for* before the difference matters.

## The types

| Type | What it does | When it earns its keep |
| --- | --- | --- |
| **Market** | Fills now, at whatever the book gives | You need out, and the price matters less than the certainty |
| **Limit** | Fills at your price or better, or waits | Almost always — it is the default of a patient trader |
| **Stop** | Becomes a market order when the trigger trades | Getting out of a position that has gone wrong |
| **Stop-limit** | Becomes a *limit* order at the trigger | A stop that refuses to be filled in a crash gap — and may therefore not fill at all |
| **Trailing stop** | Follows the high-water mark by a fixed distance | Letting a winner run without giving all of it back |
| **OCO** | Two legs; one filling cancels the other | Bracketing a position with a target and a stop |
| **DCA** | A standing spend, repeated | Building a position on a schedule, not on a feeling |
| **Grid** | Ladders of bids and offers around a range | A market that is going sideways |
| **TWAP** | One parent order worked in slices over time | A size too big to send at once |

## Time in force, and the two flags

**GTC** rests until you cancel it. **IOC** takes whatever is available immediately and cancels the rest. **FOK** fills completely or not at all.

**Post-only** refuses to cross the spread — if the order would take liquidity, it is rejected instead of filled, which is how a maker stays a maker. **Reduce-only** can shrink a position but never open or flip one, the single most useful guard rail on a leveraged book.

## OCO — one cancels the other

The two legs share a group. When one fills, the desk computes exactly what happens to the other:

- A **full fill** cancels the partner.
- A **partial fill** shrinks the partner by exactly the quantity that filled — so a bracket never ends up protecting more than you still hold.
- A leg reduced to dust is cancelled outright.
- Orders outside the group are never touched.
- Cancelling either leg by hand cancels both.

Placement is validated against the live price before anything is placed: take-profit above, stop-loss below, size actually held. A bad bracket is refused in words, and nothing rests in the book.

That rule — *refuse in words, place nothing* — is worth more than it sounds. The most common bracket bug on real venues is a stop that outlives the position it was protecting, and then fires into an empty account.

## TWAP — a parent order worked in slices

TWAP takes one order, cuts it into 2 to 24 slices over 1 to 240 minutes, and sends them on a clock. The slices are even, with the remainder on the last one.

The parent rests among your working orders, so it persists across a reload and cancels like anything else. It sends its first slice immediately and the rest on schedule, and **every slice goes through the same execution path as a hand-placed ticket** — which means in Advanced mode each slice gets the pool curve, your slippage tolerance and, on-chain, its own gas.

@figure twap-slices · One parent, cut into slices, each one priced on the market it actually meets.

That last detail is the trade-off the desk makes visible: slicing reduces price impact and multiplies gas. Twelve slices on a chain with a busy fee market can cost more in gas than the impact they saved. The row shows slices sent, size remaining and your average so far, so you can watch the two costs cross.

A slice that cannot be sent stops the parent and says why. It does not skip ahead and quietly keep going.

## What the preview tells you before you commit

Every ticket previews before it is placed: the expected fill, the fee, the price impact where the venue has a curve, and the gas where the trade is on-chain. For a TWAP, the preview shows **one slice** — the honest unit, since that is the order the market will actually meet.

## Practising with them

The habits that carry into a real venue are small and specific: place limits by default; know whether your stop is a stop or a stop-limit before you need it; use reduce-only on anything leveraged; and never send a size the book cannot absorb without slicing it.

The mechanics of what happens after you press the button are in [The Advanced Execution Engine](#/blog/advanced-execution-engine). Leverage-specific behaviour — where a stop sits relative to a liquidation price — is in [Perpetuals, Funding and Liquidation](#/blog/perpetuals-funding-liquidation).

Open the [Terminal](#/terminal) and place one.
