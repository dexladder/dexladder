/**
 * DLSNAP's pure core, typed (lib/snapshot) vs the shipped layer at 42c3c7c: every constructor,
 * the median/quorum resolution, dominance's universe rule and the subset-containment verdicts
 * produce identical records.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import * as SN from '../src/lib/snapshot';

const J = (v: unknown) => JSON.stringify(v);
const provClass = (at: number, stale: boolean) => (stale ? 'stale' : at > 1000 ? 'live' : at > 0 ? 'recent' : 'stale');
const usd = (v: number) => '$' + v.toFixed(2);
const DLF = { n: (v: unknown) => (v == null || v === '' || v === 'NaN' ? null : Number.isFinite(+(v as number)) ? +(v as number) : null) };
const legacyFactory = createRequire(import.meta.url)(join(process.cwd(), 'test', 'fixtures', 'legacy-snapshot-42c3c7c.cjs'));
(globalThis as any).DLF = DLF;   // the legacy code reads DLF as a bare global
const L = legacyFactory({ provClass }, usd, { DLF });
const ENV: SN.FieldEnv = { freshness: provClass, num: DLF.n };

const VALUES: unknown[] = [0, 1, -3.5, 2.79e12, '12.5', '', null, undefined, 'abc', NaN, Infinity];
const OPTS: SN.FieldOpts[] = [{}, { universe: 'tracked' }, { unit: '%', precision: 1, source: 'coingecko', servedAt: 5000, cycleAt: 9000 }, { stale: true, servedAt: 20, quorum: 'agree', dev: 0.4 }, { universe: 'global', universeLabel: 'X', observedAt: 0, fetchedAt: 7 }];

test('field(): identical records for every value × reason × option set', () => {
  for (const v of VALUES) for (const r of [null, 'loading', 'stale', 'unsupported'] as const) for (const o of OPTS)
    assert.equal(J(SN.field(ENV, v, r, o)), J(L.field(v, r, o)), J([v, r, o]));
  assert.throws(() => SN.field(ENV, null, 'bogus' as SN.Reason)); assert.throws(() => L.field(null, 'bogus'));
});

test('wit() and resolve(): witnesses, median, deviation and quorum identical', () => {
  for (const [v, pos] of [[1, true], [0, true], [0, false], ['7', false], [null, false], ['x', false], [-2, true]] as const)
    assert.equal(J(SN.wit('cg', v, 42, pos)), J(L.wit('cg', v, 42, pos)));
  const sets = [[], [null], [{ source: 'a', value: 10, at: 1 }], [{ source: 'a', value: 10 }, { source: 'b', value: 10.1 }], [{ source: 'a', value: 10 }, { source: 'b', value: 12 }],
    [{ source: 'a', value: 88.52e9 }, { source: 'b', value: 176.07e9 }, { source: 'c', value: 90e9 }], [{ source: 'a', value: 0 }, { source: 'b', value: 0 }], [{ source: 'a', value: 5 }, { source: 'b', value: NaN }]];
  for (const s of sets) assert.equal(J(SN.resolve(s as SN.Witness[])), J(L.resolve(s)), J(s));
  assert.equal(SN.resolve([{ source: 'a', value: 10, at: 0 }, { source: 'b', value: 12, at: 0 }]).quorum, 'disagree');
});

test('dominance(): same-universe-same-source rule, reasons and derived field identical', () => {
  const f = (v: unknown, o: SN.FieldOpts) => SN.field(ENV, v, null, o);
  const cases: [SN.Field | null, SN.Field | null][] = [
    [f(1.6e12, { source: 'cg', servedAt: 3000 }), f(2.7e12, { source: 'cg', servedAt: 3000 })],
    [f(1.6e12, { source: 'cg' }), f(2.7e12, { source: 'pp' })],
    [f(1.6e12, { universe: 'tracked', source: 'cg' }), f(2.7e12, { source: 'cg' })],
    [f(null, { source: 'cg' }), f(2.7e12, { source: 'cg' })],
    [f(5, { source: 'cg' }), f(0, { source: 'cg' })],
    [null, f(1, {})],
  ];
  for (const [a, b] of cases) for (const o of [{}, { cycleAt: 9000 }, { universe: 'tracked' }])
    assert.equal(J(SN.dominance(ENV, a, b, o)), J(L.dominance(a, b, o)), J([a && a.value, b && b.value, o]));
});

test('subsetCheck() and contested(): identical verdicts and notes', () => {
  const f = (v: number | null, ws?: SN.Witness[]) => SN.field(ENV, v, null, ws ? { witnesses: ws, quorum: 'disagree' } : {});
  const pairs: [SN.Field | null, SN.Field | null][] = [
    [f(1), f(2)], [f(3), f(2)], [f(133.03e9), f(132.29e9, [{ source: 'CoinGecko', value: 88.52e9, at: 0 }, { source: 'Coinpaprika', value: 176.07e9, at: 0 }])],
    [f(300e9), f(132.29e9, [{ source: 'CoinGecko', value: 88.52e9, at: 0 }, { source: 'Coinpaprika', value: 176.07e9, at: 0 }])], [f(null), f(2)], [null, f(1)],
  ];
  for (const [a, b] of pairs) {
    assert.equal(J(SN.subsetCheck(a, b, '24h volume', usd)), J(L.subsetCheck(a, b, '24h volume')));
    assert.equal(SN.contested(b), L.contested(b));
  }
});
