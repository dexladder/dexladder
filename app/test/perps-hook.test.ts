import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usePerps, type PerpDeps, type PerpEvent } from '../src/hooks/usePerps';
import { specFor, liqPrice, type PerpPosition, type PerpTxn } from '../src/lib/perps';
import { EMPTY_STATS, type Account } from '../src/lib/paper-engine/account';

const H = 3_600_000;
function rig(o: { mode?: 'beginner' | 'advanced'; slip?: number; rate?: number } = {}) {
  const st = { now: 7 * H, mark: 60000, acct: { bal: { USDT: 10_000 }, basis: {}, stats: EMPTY_STATS, journal: [] } as Account, pos: [] as PerpPosition[], txns: [] as PerpTxn[], ev: [] as PerpEvent[], n: 0 };
  const mode = o.mode || 'advanced', slip = o.slip || 0;
  const d: PerpDeps = {
    now: () => st.now, id: () => 'p' + ++st.n, mode: () => mode, venue: () => 'binance', mark: () => st.mark,
    spec: s => specFor(s, 1.2e12, mode, 'binance'), rate: () => ({ rate8h: o.rate ?? 1e-4, source: 'estimate' }),
    fill: (_s, side) => st.mark * (1 + (side === 'buy' ? slip : -slip)),
    account: () => st.acct, positions: () => st.pos,
    commit: (a, p) => { st.acct = a; st.pos = p.slice(); }, ledger: t => st.txns.push(t), emit: e => st.ev.push(e),
  };
  return { st, P: usePerps(d) };
}

test('hook · open commits once, logs one ledger row, and reports the liquidation distance', () => {
  const { st, P } = rig();
  const c = P.open({ sym: 'BTC', side: 'long', margin: 100, lev: 10 });
  assert.ok(c.ok); assert.equal(st.pos.length, 1); assert.equal(st.txns[0]!.type, 'Perp Long');
  assert.ok(Math.abs(st.acct.bal.USDT! - 9899.5) < 1e-9);
  const e = st.ev[0]!; assert.equal(e.kind, 'opened'); assert.equal(e.kind === 'opened' && e.distPct.toFixed(2), '9.64');
});

test('hook · a refusal changes nothing and says why (Beginner leverage cap, empty wallet)', () => {
  const { st, P } = rig({ mode: 'beginner' });
  assert.equal(P.open({ sym: 'BTC', side: 'long', margin: 100, lev: 20 }).ok, false);
  st.acct = { ...st.acct, bal: { USDT: 20 } };
  const r = P.open({ sym: 'BTC', side: 'short', margin: 100, lev: 5 });
  assert.equal(r.ok, false); assert.match(r.ok ? '' : r.why, /^Not enough USDT: this needs 100\.25/);
  assert.deepEqual(st.ev.map(e => e.kind), ['refused', 'refused']); assert.equal(st.pos.length, 0); assert.equal(st.txns.length, 0);
});

test('hook · Advanced fills walk the book: the entry carries the slippage, and the preview equals the fill', () => {
  const { st, P } = rig({ slip: 0.001 });
  const pv = P.preview({ sym: 'BTC', side: 'long', margin: 100, lev: 10 });
  const c = P.open({ sym: 'BTC', side: 'long', margin: 100, lev: 10 });
  assert.ok(pv.ok && c.ok); assert.equal(pv.quote.position.entry, c.quote.position.entry); assert.ok(Math.abs(st.pos[0]!.entry - 60060) < 1e-6);
});

test('hook · tick settles funding at the 08:00 UTC settlement, once, from the margin', () => {
  const { st, P } = rig({ rate: 3e-4 });
  P.open({ sym: 'BTC', side: 'long', margin: 100, lev: 10 });
  st.now = 8 * H - 1; assert.equal(P.tick(), 0);
  st.now = 8 * H + 5; assert.equal(P.tick(), 1);
  assert.ok(Math.abs(st.pos[0]!.margin - 99.7) < 1e-9); assert.equal(st.txns.at(-1)!.type, 'Funding');
  assert.equal(P.tick(), 0, 'no second charge for the same settlement');
});

test('hook · the mark through the liquidation price force-closes, realises −cash in, and explains itself', () => {
  const { st, P } = rig();
  P.open({ sym: 'BTC', side: 'long', margin: 100, lev: 10 });
  const L = liqPrice(st.pos[0]!), wallet = st.acct.bal.USDT!;
  st.mark = L + 1; assert.equal(P.tick(), 0);
  st.mark = L - 1; assert.equal(P.tick(), 1);
  assert.equal(st.pos.length, 0); assert.equal(st.acct.bal.USDT, wallet, 'nothing comes back');
  assert.ok(Math.abs(st.acct.stats.realizedUSD + 100.5) < 1e-9);
  const e = st.ev.at(-1)!; assert.equal(e.kind, 'liquidated');
  assert.ok(e.kind === 'liquidated' && e.postMortem.alternatives.length === 3 && e.close.insuranceFee > 0);
  assert.equal(st.txns.at(-1)!.type, 'Liquidated'); assert.equal(st.acct.journal[0]!.perp!.reason, 'liquidation');
});

test('hook · a stop-loss exits before liquidation and loses less', () => {
  const { st, P } = rig();
  P.open({ sym: 'BTC', side: 'short', margin: 100, lev: 10, sl: 63000 });
  st.mark = 63100; P.tick();
  assert.equal(st.pos.length, 0); const e = st.ev.at(-1)!;
  assert.ok(e.kind === 'closed' && e.reason === 'stop-loss');
  assert.ok(st.acct.stats.realizedUSD > -100.5 && st.acct.stats.realizedUSD < -50);
});

test('hook · partial close, add margin, and protection rules', () => {
  const { st, P } = rig();
  P.open({ sym: 'BTC', side: 'long', margin: 200, lev: 5 });
  const id = st.pos[0]!.id;
  assert.ok(P.close(id, 0.5)); assert.ok(Math.abs(st.pos[0]!.qty - (1000 / 60000) / 2) < 1e-12);
  assert.ok(P.margin(id, 50)); assert.ok(Math.abs(st.pos[0]!.margin - 150) < 1e-9);
  assert.equal(P.margin(id, 1e9), false);
  assert.match(P.protect(id, 1000, null)!, /past the liquidation price/);
  assert.equal(P.protect(id, 55000, 70000), null); assert.equal(st.pos[0]!.sl, 55000);
  assert.equal(P.protect(id, null, null), null); assert.equal(st.pos[0]!.sl, undefined);
  assert.ok(P.close(id)); assert.equal(st.pos.length, 0);
});
