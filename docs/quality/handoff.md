# DexLadder — stabilisation handoff

**Read this and `audit-tracker.md` before doing anything. Do not restart the audit.**

## Where the work is
`~/Downloads/Projects/dexladder-v155` — an isolated copy of the v154 kit (2026-09-07 12:00 UTC).
`~/Downloads/Projects/dexladder-v154` belongs to another session and was restored to its state;
do not build there. Launcher: `~/Desktop/DEXLADDER-V155.command` (rebuild, gates, package,
status, docs, diff — one file, self-installing).

## Current phase
Phase 1a and the independent copy/static batch complete and verified.
Phase 1b (canonical market snapshot) is next.

## Completed
- **Phase 0** — baseline, implementation map, `docs/quality/*`.
- **Phase 1a / batch v155-A** — findings 2, 11, 16 verified:
  `DLF.n()` nullable contract in the head; 5 CoinGecko/Coinpaprika/mirror adapters and the
  Coinpaprika→CoinGecko shim stop coercing and stop inventing (`ath: 1.6×price`,
  `ath_change_percentage: -37.5`, a 24h range derived from the 24h move, FDV = market cap);
  5 renderers print `Unavailable`; Blockchair height 0 is a confirmed block; supply drift needs
  real elapsed coverage. `test/gate155.js` 22/0, `test/gate154.js` 89/2 (baseline unchanged).

## Unresolved
- `gate154.js`: the 2 stale assertions were rewritten to shipped behaviour (D-09). The product was
  not changed to make them pass.
- **Two market stores disagree.** `DLCORE.coin('BTC')` and `MXP.state.coins` hold different
  prices under the same fixtures. This is the mechanism behind finding 1 and must be resolved by
  the canonical snapshot, not by syncing one to the other.

## Exact next action
Phase 1b. Inventory every producer of a global market statistic (command bar, hero, global card,
markets strip, DeXaI market read) and every coin store; define the canonical snapshot record
(asset id, provider, currency, `observedAt`/`fetchedAt`/`servedAt`, freshness, universe); route
all five surfaces through it; separate `global` from `tracked`; derive dominance from a
compatible denominator or return null. Add gate155 asserts that the same fixture produces the
same number in every surface, including DeXaI.

## Not authorised
Nothing has been deployed. `package` in the launcher builds zips only.
