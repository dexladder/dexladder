/**
 * The on-chain path through the presenter: timeouts, pending swaps meeting a moved price,
 * reverts that still pay gas, fills that pay gas — and Beginner untouched by any of it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usePaperEngine, type PaperDeps, type PaperEvent } from '../src/hooks/usePaperEngine';
import { createBookEngine, applyFill, signal, gasCost, FATE_TABLE, type Account, type Realism, type Ticket } from '../src/lib/paper-engine';

const SOL = { vol24: 2.1e9, mcap: 6.6e10, chg24: 4.1, price: 142.37 };
function world(realism: Realism, randoms: number[], gwei = 9, hist = [2, 2, 2], usdt = 100_000) {
  let acct: Account = { bal: { USDT: usdt }, basis: {}, stats: { wins: 0, losses: 0, feesUSD: 0, realizedUSD: 0, trades: 0 }, journal: [] };
  const engine = createBookEngine({ priceOf: (b, q) => (b === 'SOL' && q === 'USDT' ? 142.37 : b === 'ETH' ? 2500 : 0), statsOf: () => SOL, now: () => 7e6, random: () => 0.5, realism: () => realism });
  const events: PaperEvent[] = [], charged: number[] = [];
  let i = 0;
  const cost = (units: number, g: number) => gasCost(units, g, 2500, 1);
  const deps: PaperDeps = {
    engine, price: () => 142.37, held: s => acct.bal[s] || 0,
    afford: (side, sym, quote, qty, px, rate, net) => applyFill(acct, { side, sym, quote, amt: qty, px, feeRate: rate, quoteUSD: 1, now: 1, networkQuote: net }).ok,
    fill: (side, sym, quote, qty, px, rate, _l, net) => { const r = applyFill(acct, { side, sym, quote, amt: qty, px, feeRate: rate, quoteUSD: 1, now: 1, networkQuote: net }); if (r.ok) acct = r.account; return r.ok; },
    charge: (quote, amount) => { const r = applyFill(acct, { side: 'buy', sym: quote, quote, amt: 0, px: 0, feeRate: 0, quoteUSD: 1, now: 1, networkQuote: amount }); if (r.ok) { acct = r.account; charged.push(r.networkQuote); return r.networkQuote; } return 0; },
    place: () => 'id1',
    network: () => (realism.mode === 'advanced' && realism.venue === 'dexamm' ? { signal: signal(gwei, hist, 1, 'live'), tier: 'low', chg24: SOL.chg24, cost } : null),
    random: () => randoms[i++ % randoms.length]!,
    emit: e => events.push(e),
  };
  return { pe: usePaperEngine(deps), events, charged, acct: () => acct, engine };
}
const T = (over: Partial<Ticket> = {}): Ticket => ({ type: 'market', side: 'buy', sym: 'SOL', quote: 'USDT', amt: 10, limit: 0, stop: 0, tif: 'GTC', postOnly: false, reduceOnly: false, tolerancePct: 1, ...over });
const ADV: Realism = { mode: 'advanced', venue: 'dexamm', tolerancePct: 1, rangePct: null };

test('timeout: nothing trades, the cancellation gas is paid, the pool is untouched', () => {
  const w = world(ADV, [0.9999]);
  const p0 = w.engine.preview('SOL', 'USDT', 'buy', 10)!.avg;
  const o = w.pe.submit(T());
  assert.equal(o.status, 'dropped');
  const expect = gasCost(21_000, 9 * 1.3, 2500, 1);
  assert.ok(Math.abs(w.charged[0]! - expect) < 1e-12);
  assert.ok(Math.abs(w.acct().bal.USDT! - (100_000 - expect)) < 1e-9 && !w.acct().bal.SOL);
  assert.equal(w.engine.preview('SOL', 'USDT', 'buy', 10)!.avg, p0);
  assert.equal(w.acct().stats.trades, 0);
});

test('pending + tight tolerance: the price moved while it waited, the swap REVERTS and still pays gas', () => {
  // u=pending, v=long wait, then a -3σ normal draw (u1 tiny → large |z|, u2=0 → cos=1 → big positive move)
  const w = world({ ...ADV, tolerancePct: 0.1 }, [FATE_TABLE.congested.low[0] + 0.01, 0.99, 1e-9, 0]);
  const o = w.pe.submit(T({ tolerancePct: 0.1 }));
  assert.equal(o.status, 'reverted');
  assert.ok(o.status === 'reverted' && /exceeds your 0\.100% slippage tolerance/.test(o.reason));
  const expect = gasCost(90_000, 9 * 0.9, 2500, 1);
  assert.ok(Math.abs(w.charged[0]! - expect) < 1e-12, 'revert gas at the price it was sent at');
  assert.ok(!w.acct().bal.SOL, 'nothing traded');
});

test('included: the swap fills and pays swap gas through the one fill transition', () => {
  const w = world(ADV, [0, 0.5, 0.5, 0.25]);
  const o = w.pe.submit(T());
  assert.equal(o.status, 'done');
  const gas = gasCost(150_000, 9 * 0.9, 2500, 1);
  assert.ok(o.status === 'done' && o.network && Math.abs(o.network.gasPaid - gas) < 1e-12);
  assert.equal(w.acct().bal.SOL, 10);
  const x = (o as any).exec;
  assert.ok(Math.abs(w.acct().bal.USDT! - (100_000 - x.filled * x.avg * (1 + x.feeRate) - gas)) < 1e-6);
  assert.equal(x.feeRate, 0.003, 'the DEX venue fee (0.30%) — not the flat default');
  assert.deepEqual(w.events.map(e => e.type), ['network', 'filled']);
});

test('a resting limit sends no swap (no gas, no dice); Beginner and order-book venues never touch the network', () => {
  const w = world(ADV, [0.9999]);
  const o = w.pe.submit(T({ type: 'limit', limit: 130 }));
  assert.equal(o.status, 'done'); assert.equal(w.charged.length, 0);
  for (const r of [{ ...ADV, mode: 'beginner' as const }, { ...ADV, venue: 'binance' }]) {
    const b = world(r, [0.9999]);
    const ob = b.pe.submit(T());
    assert.equal(ob.status, 'done'); assert.equal(b.charged.length, 0);
    assert.ok(ob.status === 'done' && ob.network === null);
  }
});

test('gas is part of affordability: a buy that can pay the swap but not its gas is refused before touching the pool', () => {
  const probe = world(ADV, [0, 0.5, 0.5, 0.25], 400, [400]);            // 400 gwei: gas ≈ $135 at Low
  const pv = probe.engine.preview('SOL', 'USDT', 'buy', 10)!;
  const need = pv.filled * pv.avg * (1 + pv.feeRate);
  const w = world(ADV, [0, 0.5, 0.5, 0.25], 400, [400], need + 1);       // the trade money, not the gas money
  const p0 = w.engine.preview('SOL', 'USDT', 'buy', 1)!.avg;
  const o = w.pe.submit(T());
  assert.equal(o.status, 'unfunded');
  assert.equal(w.charged.length, 0, 'the wallet never signed — no gas');
  assert.ok(Math.abs(w.acct().bal.USDT! - (need + 1)) < 1e-9);
  assert.equal(w.engine.preview('SOL', 'USDT', 'buy', 1)!.avg, p0, 'the pool is not dented');
});

test('front-end refusals send nothing and pay nothing: beyond tolerance at the quote, or a FOK that cannot complete', () => {
  const w = world(ADV, [0, 0.5, 0.5, 0.25]);
  const p0 = w.engine.preview('SOL', 'USDT', 'buy', 1)!.avg;
  const huge = w.pe.submit(T({ amt: 1e6 }));
  assert.equal(huge.status, 'rejected');
  assert.ok(huge.status === 'rejected' && /exceeds your 1\.00% slippage tolerance/.test(huge.reason));
  const fok = w.pe.submit(T({ type: 'limit', limit: 142.5, amt: 5000, tif: 'FOK', tolerancePct: 50 }));
  assert.equal(fok.status, 'rejected');
  assert.equal(w.charged.length, 0, 'no transaction was signed');
  assert.equal(w.acct().bal.USDT, 100_000);
  assert.equal(w.engine.preview('SOL', 'USDT', 'buy', 1)!.avg, p0);
});

test('included next block fills at exactly the previewed price; only a pending swap meets drift', () => {
  const a = world(ADV, [0, 0.5, 1e-9, 0]);        // included — even with an extreme normal draw queued
  const pv = a.engine.preview('SOL', 'USDT', 'buy', 10, { tolerancePct: 1 })!;
  const o = a.pe.submit(T());
  assert.ok(o.status === 'done' && o.exec && o.exec.avg === pv.avg && o.exec.filled === pv.filled);
  const b = world(ADV, [FATE_TABLE.congested.low[0] + 0.01, 0.5, 0.2, 0.1], 9, [2, 2, 2]);
  const pb = b.engine.preview('SOL', 'USDT', 'buy', 10, { tolerancePct: 1 })!;
  const ob = b.pe.submit(T());
  assert.ok(ob.status === 'done' && ob.exec && ob.exec.avg !== pb.avg && ob.network && ob.network.fate.fate === 'pending');
});

// ---------------------------------------------------------------- the legacy fill adapter in Advanced
import * as P from '../src/legacy/paper';
import { bind } from '../src/legacy/globals';

test('every non-ticket fill in Advanced pays its venue rate (maker for resting limits) and on-chain gas; perps and Beginner untouched', () => {
  const S: any = { bal: { USDT: 10_000 }, basis: {}, stats: { wins: 0, losses: 0, feesUSD: 0, realizedUSD: 0, trades: 0 }, dlsim: { mode: 'pro', venue: 'kraken', gasMode: 'calm', gasHist: [4, 4, 4] } };
  bind({ state: () => S, coin: () => ({ sym: 'SOL', price: 100, vol: 1e9, mcap: 1e10, c24: 2 }) });
  const g = globalThis as any;
  Object.assign(g, { pUSD: (s: string) => (s === 'USDT' ? 1 : 100), pairPrice: (b: string) => (b === 'ETH' ? 2500 : 100), ensureEng() {}, logTxn() {}, toast() {}, saveP() {} });
  const spent = (label: string) => { const u0 = S.bal.USDT; P.execFill(S, 0.001, 'buy', 'SOL', 'USDT', 1, 100, label, true, false); return u0 - S.bal.USDT; };
  assert.ok(Math.abs(spent('limit') - 100 * 1.0016) < 1e-9, 'Kraken maker 0.16% on a resting limit');
  assert.ok(Math.abs(spent('stop') - 100 * 1.0026) < 1e-9, 'Kraken taker 0.26% on a stop');
  assert.ok(Math.abs(spent('perp') - 100 * 1.001) < 1e-9, 'perps keep their own fee model');
  S.dlsim.venue = 'dexamm';
  const gas = gasCost(150_000, 4 * 1.0, 2500, 1);            // practice "calm" = the history median, Medium priority
  assert.ok(Math.abs(spent('dca') - (100 * 1.003 + gas)) < 1e-9, 'DEX: 0.30% + live gas at Medium');
  assert.ok(Math.abs(P.gasEstimate('USDT') - gas) < 1e-12, 'the ticket fee line shows the same gas');
  const paid = P.chargeNetwork(S, 'USDT', 5);
  assert.equal(paid, 5);
  S.dlsim.mode = 'beginner';
  assert.ok(Math.abs(spent('limit') - 100 * 1.001) < 1e-9, 'Beginner: exactly the rate it was given, no gas');
  assert.equal(P.gasEstimate('USDT'), 0);
});
