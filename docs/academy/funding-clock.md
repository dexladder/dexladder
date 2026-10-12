# Funding rates, explained with a clock

A perpetual contract has no expiry date. Funding is a periodic transfer between long and short positions designed to encourage its price toward the underlying spot market. It is separate from your trading fee, and the payment direction depends on the sign of the rate.

Picture a UTC clock with marks at 00:00, 08:00 and 16:00. Those are common eight-hour settlement times, not a universal rule. Venues and individual contracts can use other intervals, change them, or publish estimated rates before settlement. Check the contract's actual schedule and rate; an eight-hour-normalised comparison is not a countdown to its next payment.

At a positive rate, longs generally pay shorts. At a negative rate, shorts generally pay longs. At zero, the rate contributes no payment. In a simplified example, $1000 of eligible notional at +0.01% produces a $0.10 payment from the long to the short for that interval. At −0.01%, the direction reverses. Your venue's position valuation, eligibility rules and settlement method determine the actual amount. Holding for only part of an interval does not necessarily prorate a payment.

Three settlements per day at an unchanged +0.01% would cost a qualifying long $0.30 per $1000 of constant notional. That is an illustration of accumulated cost, not a forecast: rates, notional and eligibility can change. Funding debits may reduce available margin and bring liquidation closer even when the price hardly moves. Funding credits do not remove price risk.

A sustained positive rate can suggest demand to hold leveraged longs or a perpetual premium that the mechanism is trying to correct. A sustained negative rate can suggest pressure in the opposite direction. Neither sign predicts the next price move. Hedge demand, venue structure and liquidity can also affect rates. Receiving funding is not a guaranteed profit after price changes and fees.

Open Leverage Weather and read the existing **Funding skew** panel and **Funding 8h** column. Pick one symbol, check the named venue, the timestamp and whether the data is stale, then read the sign before deciding who pays whom. The panel uses live inputs, so either direction can be present. Compare another symbol instead of treating one rate as the whole market. If the panel is unavailable, use the signed examples above; never substitute them for a live rate.

Use this clock as a checklist: before the next settlement, what interval does this contract use, what is the latest published rate, what notional is eligible, which side pays, and how would the debit affect margin? Repeat after settlement using the recorded payment. The useful habit is matching a published schedule and signed rate to a receipt.
