/**
 * The simulated sandwich: a rational bot, the edge of the victim's tolerance, preview = fill,
 * and never outside Advanced · on-chain · bots switched on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandwich, poolFromTVL, swap, atPrice, MEV_MIN_TOLERANCE_PCT, SANDWICH_ALERT, explainMev, createBookEngine, applyFill, signal, gasCost, type Account, type Realism, type Ticket } from '../src/lib/paper-engine';
import { usePaperEngine, type PaperEvent } from '../src/hooks/usePaperEngine';

const pool = poolFromTVL(100, 1_000_000)!;           // x = 5,000 base, y = 500,000 quote
const FEE = 0.003;

test('no attack at or below a 2% tolerance, whatever the size', () => {
  assert.equal(MEV_MIN_TOLERANCE_PCT, 2);
  for (const tol of [0.1, 0.5, 1, 2]) assert.equal(sandwich(pool, 'buy', 25, 100, tol, FEE, 1), null);
});

test('a wide tolerance on a meaningful buy: the victim fills at the edge of it, the bot profits after fees and gas', () => {
  const s = sandwich(pool, 'buy', 25, 100, 3, FEE, 10)!;
  assert.ok(s, 'attacked');
  const bound = 100 * 1.03;
  assert.ok(s.victim.avg <= bound && s.victim.avg > bound * (1 - 1e-5), 'worst price still inside tolerance');
  assert.ok(Math.abs(s.victim.filled - 25) < 1e-9, 'the victim still fills in full');
  assert.ok(s.victim.avg > s.clean.avg);
  assert.ok(Math.abs(s.extraQuote - (s.victim.quote - s.clean.quote)) < 1e-9 && s.extraQuote > 0);
  // the bot's books, recomputed from the three swaps on the curve
  const front = swap(pool, 'buy', s.front.filled), victim = swap(atPrice(pool, front.p1), 'buy', 25), back = swap(atPrice(pool, victim.p1), 'sell', front.filled);
  const profit = back.quote * (1 - FEE) - front.quote * (1 + FEE) - 10;
  assert.ok(Math.abs(s.botProfitQuote - profit) < 1e-6 && profit > 0);
});

test('sells are sandwiched the mirror way (bot sells first, buys back)', () => {
  const s = sandwich(pool, 'sell', 25, 100, 3, FEE, 10)!;
  assert.ok(s && s.victim.avg >= 97 && s.victim.avg < 97 * (1 + 1e-5) && s.clean.avg > s.victim.avg && s.extraQuote > 0);
});

test('"meaningful size" is economic: a small swap is not worth the bot\'s gas; dearer gas raises the bar', () => {
  assert.equal(sandwich(pool, 'buy', 0.01, 100, 3, FEE, 10), null, 'a $1 swap cannot pay for two swaps of gas');
  const smallest = (gas: number) => { let q = 1e-3; while (q < 1e4 && !sandwich(pool, 'buy', q, 100, 3, FEE, gas)) q *= 1.25; return q; };
  assert.ok(smallest(200) > smallest(5));
});

test('the alert copy is the one the brief asked for, verbatim, first', () => {
  const t = explainMev({ extraQuote: 12, botProfitQuote: 7, frontBase: 3, cleanAvg: 100, avg: 102.9 }, x => x.toFixed(2) + ' USDT', '3.00%');
  assert.ok(t.startsWith(SANDWICH_ALERT));
  assert.equal(SANDWICH_ALERT, 'You were sandwiched by a simulated MEV bot. In real trading this is why low slippage + private RPC matters.');
  assert.match(t, /cost you 12\.00 USDT; the bot kept 7\.00 USDT/);
});

// ------------------------------------------------------------------- through the engine and presenter
const SOL = { vol24: 2.1e9, mcap: 6.6e10, chg24: 4.1, price: 142.37 };
function world(realism: Realism, mev: boolean, usdt = 1e7) {
  let acct: Account = { bal: { USDT: usdt }, basis: {}, stats: { wins: 0, losses: 0, feesUSD: 0, realizedUSD: 0, trades: 0 }, journal: [] };
  const engine = createBookEngine({ priceOf: (b, q) => (b === 'SOL' && q === 'USDT' ? 142.37 : b === 'ETH' ? 2500 : 0), statsOf: () => SOL, now: () => 7e6, random: () => 0.5, realism: () => realism });
  const events: PaperEvent[] = [];
  const cost = (units: number, g: number) => gasCost(units, g, 2500, 1);
  const fillArgs = (side: 'buy' | 'sell', sym: string, quote: string, qty: number, px: number, rate: number, net: number) => ({ side, sym, quote, amt: qty, px, feeRate: rate, quoteUSD: 1, now: 1, networkQuote: net });
  const pe = usePaperEngine({
    engine, price: () => 142.37, held: s => acct.bal[s] || 0,
    afford: (side, sym, quote, qty, px, rate, net) => applyFill(acct, fillArgs(side, sym, quote, qty, px, rate, net)).ok,
    fill: (side, sym, quote, qty, px, rate, _l, net) => { const r = applyFill(acct, fillArgs(side, sym, quote, qty, px, rate, net)); if (r.ok) acct = r.account; return r.ok; },
    charge: (_q, amount) => { const r = applyFill(acct, { side: 'buy', sym: 'USDT', quote: 'USDT', amt: 0, px: 0, feeRate: 0, quoteUSD: 1, now: 1, networkQuote: amount }); if (r.ok) acct = r.account; return r.ok ? r.networkQuote : 0; }, place: () => 'id',
    network: () => (realism.mode === 'advanced' && realism.venue === 'dexamm' ? { signal: signal(9, [9], 1, 'live'), tier: 'medium', chg24: 4.1, cost, mev } : null),
    random: () => 0, emit: e => events.push(e),
  });
  return { pe, engine, events, acct: () => acct, botGas: 2 * cost(150_000, 9 * 1.3) };
}
const ADV3: Realism = { mode: 'advanced', venue: 'dexamm', tolerancePct: 3, rangePct: null };
const T = (over: Partial<Ticket> = {}): Ticket => ({ type: 'market', side: 'buy', sym: 'SOL', quote: 'USDT', limit: 0, stop: 0, tif: 'GTC', postOnly: false, reduceOnly: false, tolerancePct: 3, amt: 500, ...over });

test('bots on, 3% tolerance: the preview predicts the sandwich and the fill is exactly it', () => {
  const w = world(ADV3, true);
  const pv = w.engine.preview('SOL', 'USDT', 'buy', 500, { tolerancePct: 3, mev: { botGasQuote: w.botGas } })!;
  assert.ok(pv.amm && pv.amm.sandwich, 'the ticket warns before you send');
  const o = w.pe.submit(T());
  assert.ok(o.status === 'done' && o.exec && o.exec.amm && o.exec.amm.sandwich);
  assert.equal(o.exec!.avg, pv.amm!.sandwich!.avg);
  assert.ok(o.exec!.amm!.impactPct <= 3 && o.exec!.amm!.impactPct > 2.99, 'filled at the edge of the tolerance');
  assert.ok(o.exec!.avg > pv.avg, 'worse than the clean quote');
  assert.deepEqual(w.events.map(e => e.type), ['network', 'sandwiched', 'filled']);
  assert.ok(Math.abs(w.acct().bal.USDT! - (1e7 - 500 * o.exec!.avg * 1.003 - (o.network ? o.network.gasPaid : 0))) < 1e-4, 'the victim paid the sandwiched price through the one fill');
});

test('never sandwiched: bots off, a tight tolerance, a limit order, an order-book venue, Beginner', () => {
  const cases: [Realism, boolean, Partial<Ticket>][] = [
    [ADV3, false, {}], [{ ...ADV3, tolerancePct: 0.5 }, true, { tolerancePct: 0.5, amt: 5 }], [ADV3, true, { type: 'limit', limit: 150 }],
    [{ ...ADV3, venue: 'binance' }, true, {}], [{ ...ADV3, mode: 'beginner' }, true, {}],
  ];
  for (const [r, mev, over] of cases) {
    const w = world(r, mev), o = w.pe.submit(T(over));
    assert.ok(o.status === 'done', JSON.stringify(over));
    assert.ok(!(o.exec && o.exec.amm && o.exec.amm.sandwich), JSON.stringify([r, mev, over]));
    assert.ok(!w.events.some(e => e.type === 'sandwiched'));
  }
});

test('a sandwich that makes the swap unaffordable when it runs: it reverts on-chain and the gas is burned', () => {
  const probe = world(ADV3, true);
  const pv = probe.engine.preview('SOL', 'USDT', 'buy', 500, { tolerancePct: 3 })!;
  const gas = probe.botGas / 2 / 1.3;                                    // our swap at Medium = one bot swap ÷ 1.3
  const enough = pv.filled * pv.avg * (1 + pv.feeRate) + gas + 1;        // the clean price + gas, not the sandwiched one
  const w = world(ADV3, true, enough);
  const o = w.pe.submit(T());
  assert.equal(o.status, 'reverted');
  assert.ok(o.status === 'reverted' && o.network.gasPaid > 0 && !w.acct().bal.SOL);
  assert.ok(Math.abs(w.acct().bal.USDT! - (enough - o.network.gasPaid)) < 1e-9);
});
