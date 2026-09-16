# DexLadder — engineering decisions (stabilisation programme, Sep 2026)

Short, dated, and binding on later sessions. Each decision says what it changes and why.

## D-01 · The source of truth is the v154 kit, not the deployed file
`~/Downloads/Projects/dexladder-v154` is the development tree: `src/index.v153.html` (sha
asserted) + count-asserted text patches in `build154.py` + self-mounting `layers/*.js`
→ `dist/index.html`. Fixes are made **in the patch list or a layer**, never by hand-editing
`dist/index.html`, which is generated. The public GitHub repository is documentation and is not
the app source.

## D-02 · Missing is not zero
A market fact is a number **or `null` with a reason**. `x || 0` is forbidden in adapters for
supply, market cap, volume, ATH and any derived metric. Legitimate zeros are preserved,
including block height 0. Reasons are a closed set: `unavailable`, `unsupported`,
`insufficient-history`, `loading`, `stale`.

## D-03 · Never fabricate observations
No synthetic candle, intraday high/low or all-time high may be presented as observed market
data. Where a shim previously invented values (`ath: 1.6 * price`,
`ath_change_percentage: -37.5`, `synthSpark`), the field becomes `null` with reason
`unsupported` and the surface says so. Simulated series may exist only where the label says
"simulated".

## D-04 · Three clocks, never merged
`observedAt` (the provider's own timestamp for the value), `fetchedAt` (when we requested it)
and `servedAt` (when a cache handed it back). A re-render never resets `observedAt`; an unknown
`observedAt` stays unknown and is never back-filled from `fetchedAt`.

## D-05 · Universes are named
`global` (whole-market aggregate from the provider) and `tracked` (the assets DexLadder has
loaded) are different metrics with different labels. Dominance is computed from a numerator and
denominator drawn from the **same** universe, provider and currency, or it is `null`.

## D-06 · Accounting precision
Paper accounting is carried in decimal-string / integer-scaled arithmetic at 8 significant
decimals for base quantities and 8 for USDT cash; presentation rounding happens only in
formatters. Formatting is never the accounting source of truth. Gross price P&L, entry fee,
exit fee, funding, net realised P&L, cost basis and external paper cash flows are stored as
separate fields. `-0.00` is never displayed.

Reference fixture (from the audit, adopted verbatim as the regression case):
buy 0.001 BTC @ 79,389.21, sell @ 79,384.45, 0.100 % taker fee both sides →
gross −0.00476000, entry fee 0.07938921, exit fee 0.07938445, **net −0.16353366**,
ending cash **9,999.83646634** USDT.

## D-07 · Tax output is illustrative
The tax panel states its assumptions and its jurisdiction-agnostic nature on the panel itself.
No universal jurisdictional rule is asserted.

## D-08 · History is append-only
Ledger bytes and hashes already written are never rewritten. If a calculation's semantics
change, derived reports are versioned or an explicit adjustment record is appended. A fee that
was never recorded is reported as unavailable, never inferred.

## D-09 · Night is the default; the OS is not consulted (inherited, 2026-09-05/07)
A prior session replaced OS seeding with a forced Night default plus a one-time
`dl.darkdefault.v1` migration, and the v154g "warm Day purge" re-cast Day's palette to a cool
hue (so Day `theme-color` is `#F5F7FB`, not `#FBF7F1`). Two gate assertions still describe the
older behaviour; **the assertions are corrected, the behaviour is not**. Recorded so this is not
re-litigated as a bug.

## D-10 · Security headers ship from `dist/_headers`
`site/_headers` is documentation until its policy is in `dist/_headers`, which is the file the
deploy bundles carry. CSP is introduced report-only first and only called enforced once it is
enforced.

## D-11 · No new global override layers
A fix consolidates the existing implementation. No additional global `fetch` wrapper, timer,
DOM-rewrite or override layer is added without first naming the implementation it replaces.

## D-12 · Deployment is not authorised by the engineering brief
Builds, bundles and rollback notes are prepared. Nothing is published to Netlify, Cloudflare
Pages, the App Store or Play until Durga says so in conversation.

## D-13 · The Local Fork sandbox talks to exactly one host, and never holds a key (2026-09-12)
The advanced sandbox lets a user point the terminal at their own node (`anvil --fork-url …`, a
Hardhat node) and trade their own contracts. Three rules make that safe and keep the existing laws
intact:

1. **The typed core performs no I/O.** `web/app/src/lib/fork/*` builds every JSON-RPC request and
   decodes every answer; `hooks/useForkNode` sequences them; the ONE network function is installed
   by `layers/43-fork.js` through `DLAPP.fork.install()`. The architecture gate's "no network code
   anywhere in the typed core" stays true, and the only host ever contacted is the URL the user
   typed.
2. **Writes need an unlocked account AND proof the chain is not a public one.** A transaction goes
   out as `eth_sendTransaction` from an account the node already holds; DexLadder never sees a
   private key, signs nothing, and stores no credential. `writePolicy()` additionally refuses any
   node that did not identify itself as a fork (`anvil_nodeInfo` / `hardhat_metadata`) or a dev
   chain, so a public RPC pasted by mistake is read-only by policy, not by accident.
3. **Every write is dry-run with `eth_call` first**, and a revert is decoded — `require` reason,
   Solidity panic code, or the contract's own custom error from the pasted ABI — so a failure is a
   sentence before anything is signed.

A routed pool REPLACES the modelled pool for the ticket: the curve, the price and the fee are the
contract's own (`Realism.fork`), the gas price is the node's, and fills stay paper — the pool moves
only when the user sends a real swap from the panel. Pool depth for a forked pool is denominated in
that pool's own quote token, never converted to dollars, because a node has no price feed: the
absolute-dollar "near-zero liquidity" floor therefore does not apply to it (the share-of-your-size
refusal still does). v3 quotes use the current tick's liquidity bounded by what the pool actually
holds; crossing ticks is not modelled and the panel says so.
