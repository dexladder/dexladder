import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labFor, LABS, type AmmFacts } from '../src/lib/paper-engine';

const amm: AmmFacts = { venue: 'dexamm', model: 'cpmm', poolUSD: 1e6, p0: 100, p1: 101, impactPct: 0.5, movePct: 1, tolerancePct: 3, withinTolerance: true, rangeExhausted: false, driftPct: 0 };

test('the Academy lab follows the most surprising thing that happened', () => {
  assert.equal(labFor(undefined), null, 'Beginner (order book): no detour');
  assert.equal(labFor(amm), LABS.amm, 'price impact → the AMM curve');
  assert.equal(labFor(amm, 'reverted'), LABS.mev, 'a failed swap → block space and priority');
  assert.equal(labFor(amm, 'timeout'), LABS.mev);
  assert.equal(labFor(amm, 'included'), LABS.amm);
  assert.equal(labFor({ ...amm, sandwich: { extraQuote: 1, botProfitQuote: 1, frontBase: 1, cleanAvg: 100, avg: 102 } }), LABS.mev, 'a sandwich → the MEV Auction');
});
