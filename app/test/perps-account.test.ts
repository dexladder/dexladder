import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPerp, fundingTxn, perpEquityUSD, triggerAt, postMortem, migrate, specFor, tierFor, liqPrice, equity, quoteOpen, type PerpPosition } from '../src/lib/perps';
import { EMPTY_STATS, type Account } from '../src/lib/paper-engine/account';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);
const BTC = specFor('BTC', 1.2e12, 'advanced', 'binance');
const acct = (usdt = 10_000): Account => ({ bal: { USDT: usdt }, basis: {}, stats: EMPTY_STATS, journal: [] });
const open = (o: { side?: 'long' | 'short'; margin?: number; lev?: number; sl?: number; tp?: number } = {}): PerpPosition => {
  const r = quoteOpen({ sym: 'BTC', side: o.side || 'long', margin: o.margin ?? 100, lev: o.lev ?? 10, mark: 60000, fill: 60000, sl: o.sl ?? null, tp: o.tp ?? null },
    { spec: BTC, venue: 'binance', mode: 'advanced', rate8h: 1e-4, now: 0, id: 'p', open: 0, maxPositions: 6 });
  assert.ok(r.ok); return r.quote.position;
};

test('open · the wallet pays margin + open fee; nothing is realised yet', () => {
  const p = open(), r = applyPerp(acct(), { kind: 'open', position: p });
  assert.ok(r.ok);
  near(r.account.bal.USDT!, 10_000 - 100.5); near(r.account.stats.feesUSD, 0.5);
  assert.equal(r.account.stats.trades, 0); assert.equal(r.txn.type, 'Perp Long'); near(r.txn.val, 1000);
  const poor = applyPerp(acct(50), { kind: 'open', position: p });
  assert.deepEqual(poor.ok ? null : [poor.reason, poor.need, poor.have], ['insufficient-usdt', 100.5, 50]);
});

test('close · realised P&L = cash back − cash in (fees and funding included); the journal says it was a perp', () => {
  const p = open(), a = (applyPerp(acct(), { kind: 'open', position: p }) as any).account as Account;
  const c = applyPerp(a, { kind: 'close', position: p, exit: 66000, fraction: 1, reason: 'manual', now: 3_600_000 });
  assert.ok(c.ok && c.close);
  near(c.close.fee, (1000 / 60000) * 66000 * 5e-4);                      // 0.55
  near(c.close.cashOut, 100 + 100 - 0.55); near(c.realizedUSD, 200 - 0.55 - 100.5);
  near(c.account.bal.USDT!, 10_000 - 100.5 + 199.45);
  assert.equal(c.position, null); assert.equal(c.account.stats.wins, 1); assert.equal(c.account.stats.trades, 1);
  const j = c.account.journal[0]!;
  assert.deepEqual(j.perp, { side: 'long', lev: 10, reason: 'manual', funding: 0 }); assert.equal(j.hold, 3_600_000);
  near(j.pl, c.realizedUSD);
});

test('close · two half-closes realise exactly what one full close does', () => {
  const p = open({ lev: 20, margin: 500 }), a0 = (applyPerp(acct(), { kind: 'open', position: p }) as any).account as Account;
  const full = applyPerp(a0, { kind: 'close', position: p, exit: 61234, fraction: 1, reason: 'manual', now: 1 });
  const h1 = applyPerp(a0, { kind: 'close', position: p, exit: 61234, fraction: 0.5, reason: 'manual', now: 1 });
  assert.ok(full.ok && h1.ok && h1.position);
  const h2 = applyPerp(h1.account, { kind: 'close', position: h1.position, exit: 61234, fraction: 1, reason: 'manual', now: 1 });
  assert.ok(h2.ok);
  near(h2.account.bal.USDT!, full.account.bal.USDT!); near(h2.account.stats.realizedUSD, full.account.stats.realizedUSD);
  assert.equal(h1.txn.note, '50% closed');
});

test('liquidation · the trader loses exactly cash in; the remaining margin is the insurance fee; a gap is capped', () => {
  const p = open(), L = liqPrice(p), a0 = (applyPerp(acct(), { kind: 'open', position: p }) as any).account as Account;
  const r = applyPerp(a0, { kind: 'close', position: p, exit: L, fraction: 1, reason: 'liquidation', now: 5 });
  assert.ok(r.ok && r.close);
  near(r.realizedUSD, -100.5); near(r.account.bal.USDT!, a0.bal.USDT!); near(r.close.insuranceFee, equity(p, L)); assert.equal(r.close.shortfall, 0);
  assert.equal(r.txn.type, 'Liquidated'); assert.equal(r.account.stats.losses, 1);
  const g = applyPerp(a0, { kind: 'close', position: p, exit: 50000, fraction: 1, reason: 'liquidation', now: 5 });
  assert.ok(g.ok && g.close); near(g.realizedUSD, -100.5, 1e-9); assert.ok(g.close.shortfall > 0 && g.close.insuranceFee === 0);
});

test('margin · add and remove move wallet ⇄ margin and the liquidation price', () => {
  const p = open(), a0 = (applyPerp(acct(), { kind: 'open', position: p }) as any).account as Account;
  const add = applyPerp(a0, { kind: 'margin', position: p, delta: 100 });
  assert.ok(add.ok && add.position);
  near(add.account.bal.USDT!, a0.bal.USDT! - 100); near(add.position.margin, 200); near(add.position.cashIn, 200.5);
  assert.ok(liqPrice(add.position) < liqPrice(p));
  const tooMuch = applyPerp(a0, { kind: 'margin', position: p, delta: -150 });
  assert.equal(tooMuch.ok, false);
});

test('triggers · a stop before the liquidation price fires first; a stop past it never fires', () => {
  const p = open({ sl: 57000, tp: 66000 }), L = liqPrice(p);
  assert.equal(triggerAt(p, 59000), null);
  assert.equal(triggerAt(p, 56000), 'stop-loss', 'a gap through the stop still exits at the stop, not a liquidation');
  assert.equal(triggerAt(p, L - 1), 'stop-loss');
  assert.equal(triggerAt({ ...p, sl: L - 100 }, L - 1), 'liquidation');
  assert.equal(triggerAt(p, 66000), 'take-profit');
  const s = open({ side: 'short', sl: 63000 });
  assert.equal(triggerAt(s, 63500), 'stop-loss'); assert.equal(triggerAt({ ...s, sl: undefined as any }, liqPrice(s) + 1), 'liquidation');
});

test('post-mortem · names the leverage, the maintenance margin, funding, the insurance fee, and three alternatives', () => {
  const p = { ...open(), margin: 99, funding: 1 }, L = liqPrice(p), m = postMortem(p, L - 5, n => n.toFixed(0));
  assert.equal(m.headline, 'Liquidated — BTC 10× long');
  assert.match(m.facts[1]!, /At 10× a 10\.0% move down erases the margin.*maintenance margin \(0\.40%/);
  assert.match(m.facts[2]!, /Funding cost you 1\.00 USDT.*moved the liquidation price from 54217 to/);
  assert.match(m.facts[3]!, /went to the insurance fund as the liquidation fee/);
  assert.equal(m.alternatives.length, 3);
  assert.equal(m.alternatives[0]!.survives, null);
  assert.equal(m.alternatives[1]!.label, '3× instead of 10×'); assert.equal(m.alternatives[1]!.survives, true);
  assert.equal(m.alternatives[2]!.survives, true);
  const gap = postMortem(open(), 40000, n => n.toFixed(0));
  assert.match(gap.facts[2]!, /gapped to 40000, past your bankruptcy price/);
  assert.equal(gap.alternatives[1]!.survives, false, '3× liquidates at 40,160.6 — a gap to 40,000 takes it too');
  assert.match(gap.alternatives[1]!.text, /even that would not have survived/);
});

test('migrate · an old DLSIM position closes for exactly the cash the old desk would have paid', () => {
  const old = { id: 'ab12cd', sym: 'BTC', side: 'long', lev: 5, qty: 500 / 60000, entry: 60000, margin: 100, fee: 0.25, fund: 0.8, liq: 0, t: 10, lastF: 20 };
  const p = migrate(old, () => BTC, 'beginner', 'binance', 99)!;
  assert.equal(p.v, 2); near(p.margin, 99.2); near(p.cashIn, 100.25); near(p.funding, 0.8); assert.equal(p.lastFundingAt, 20);
  assert.equal(p.mmr, tierFor(BTC.tiers, 500).mmr);
  const exit = 61000, legacyNet = old.margin + (exit - old.entry) * old.qty - old.fund - old.qty * exit * p.takerFee;
  const r = applyPerp(acct(), { kind: 'close', position: p, exit, fraction: 1, reason: 'manual', now: 100 });
  assert.ok(r.ok && r.close); near(r.close.cashOut, legacyNet);
  near(r.realizedUSD, legacyNet - old.margin - old.fee, 1e-9);
  assert.equal(migrate({ sym: 'BTC', side: 'up', qty: 1, entry: 1, margin: 1 }, () => BTC, 'beginner', 'binance', 0), null);
  assert.equal(migrate(p, () => BTC, 'advanced', 'kraken', 0), p, 'v2 passes through untouched');
});

test('ledger · funding rows and perp equity', () => {
  const p = open();
  assert.deepEqual(fundingTxn(p, 0.3, 2), { type: 'Funding', sym: 'BTC', amt: 0, val: -0.3, quote: 'USDT', side: 'long', lev: 10, note: 'paid · 2 settlements' });
  near(perpEquityUSD([p], () => 66000), 200); assert.equal(perpEquityUSD([p], () => 40000), 0, 'isolated: never below zero');
  near(perpEquityUSD([p], () => 0), 100, 1e-12);
});
