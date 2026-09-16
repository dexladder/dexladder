import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal, congestion, gasCost, fateOf, reverted, timeoutRisk, pendingRisk, pendingDrift, normal, explainFate, median, FATE_TABLE, GAS_UNITS, TIER_MULT, FALLBACK_GWEI } from '../src/lib/paper-engine/gas';

test('no reading → a labelled estimate; congestion is judged against this device\'s own history', () => {
  const e = signal(null, [], 0, 'live');
  assert.deepEqual(e, { gwei: FALLBACK_GWEI, reference: FALLBACK_GWEI, at: 0, source: 'estimate' });
  assert.equal(congestion(signal(2, [2, 2, 2, 2], 1, 'live')), 'calm');
  assert.equal(congestion(signal(3, [2, 2, 2, 2], 1, 'live')), 'busy');
  assert.equal(congestion(signal(5, [2, 2, 2, 2], 1, 'live')), 'congested');
  assert.equal(congestion(signal(40, [40, 42, 38], 1, 'live')), 'calm', '40 gwei is calm on a chain where 40 is normal');
  assert.equal(median([3, 1, 2]), 2); assert.equal(median([]), 0);
});

test('gas cost: units × gwei × ETH price, in the quote asset', () => {
  // 150,000 gas × 10 gwei = 0.0015 ETH; at $2,500 = $3.75
  assert.ok(Math.abs(gasCost(GAS_UNITS.swap, 10, 2500, 1) - 3.75) < 1e-12);
  assert.ok(Math.abs(gasCost(GAS_UNITS.swap, 10, 2500, 2500) - 0.0015) < 1e-15, 'priced in ETH when ETH is the quote');
  assert.equal(gasCost(0, 10, 2500, 1), 0); assert.equal(gasCost(1, 10, 0, 1), 0);
});

test('fate follows the published table exactly at its edges', () => {
  for (const c of ['calm', 'busy', 'congested'] as const) for (const tier of ['low', 'medium', 'high'] as const) {
    const row = FATE_TABLE[c][tier], s = c === 'calm' ? signal(2, [2], 1, 'live') : c === 'busy' ? signal(3, [2, 2, 2], 1, 'live') : signal(9, [2, 2, 2], 1, 'live');
    assert.equal(congestion(s), c);
    assert.ok(Math.abs(row[0] + row[1] + row[2] - 1) < 1e-12, 'row sums to 1');
    assert.equal(fateOf(s, tier, 0, 0).fate, row[0] > 0 ? 'included' : 'pending');
    if (row[0] < 1) assert.equal(fateOf(s, tier, row[0] + 1e-9, 0).fate, row[1] > 0 ? 'pending' : 'timeout');
    if (row[2] > 0) { const f = fateOf(s, tier, 0.999999, 0); assert.equal(f.fate, 'timeout'); assert.equal(f.units, GAS_UNITS.cancel); assert.equal(f.gwei, s.gwei * TIER_MULT.high); }
    assert.equal(timeoutRisk(s, tier), row[2]); assert.equal(pendingRisk(s, tier), row[1]);
  }
  const s = signal(9, [2, 2, 2], 1, 'live');
  assert.ok(timeoutRisk(s, 'low') > timeoutRisk(s, 'medium') && timeoutRisk(s, 'medium') > timeoutRisk(s, 'high'), 'priority buys inclusion');
  const p = fateOf(s, 'low', FATE_TABLE.congested.low[0] + 0.01, 0.5);
  assert.equal(p.fate, 'pending'); assert.ok(p.blocks >= 3 && p.blocks <= 7);
  assert.equal(p.gwei, 9 * TIER_MULT.low);
  const r = reverted(p); assert.equal(r.fate, 'reverted'); assert.equal(r.units, GAS_UNITS.revert); assert.equal(r.gwei, p.gwei);
});

test('pending drift scales with volatility, the wait, and congestion', () => {
  assert.equal(pendingDrift(4, 0, 2), 0);
  const calm = pendingDrift(4, 60, 1, 'calm'), cong = pendingDrift(4, 60, 1, 'congested');
  assert.ok(Math.abs(calm - 0.04 * Math.sqrt(60 / 86400)) < 1e-15); assert.ok(Math.abs(cong / calm - 2.5) < 1e-12);
  assert.ok(pendingDrift(12, 60, 1) > pendingDrift(3, 60, 1));
  assert.ok(Number.isFinite(normal(0, 0.3)) && Math.abs(normal(0.5, 0)) > 1e-6);
});

test('every fate explains itself in plain English', () => {
  const s = signal(9, [2, 2, 2], 1, 'live'), inc = fateOf(s, 'high', 0, 0), to = fateOf(s, 'low', 0.9999, 0);
  assert.match(explainFate(inc, '$1.20'), /congested; your high-priority swap made the next block .* Gas paid: \$1\.20\./);
  assert.match(explainFate(to, '$0.40'), /tip was too low: no validator picked the swap up.* still cost \$0\.40/);
  assert.match(explainFate(reverted(inc), '$0.70'), /REVERTED on-chain .* slippage tolerance.* \$0\.70/);
});
