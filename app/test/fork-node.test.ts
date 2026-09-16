/**
 * The fork sandbox against a scripted node: what the doctor concludes, what a pool reads as, that
 * the float curve agrees with the pair's integer arithmetic, that the paper engine prices on the
 * contract's own liquidity, and that a write is dry-run, sent, and read back from its receipt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeNode, PAIR, ROUTER, USER, pairOut } from './fork-fake';
import { useForkNode } from '../src/hooks/useForkNode';
import { loadPool, poolBalances, quoteIsToken1 } from '../src/hooks/useForkPool';
import { planSwap, runSwap } from '../src/hooks/useForkSwap';
import { forkVenue } from '../src/lib/fork/market';
import { swap as ammSwap } from '../src/lib/paper-engine/amm';
import { createBookEngine } from '../src/lib/paper-engine/engine';
import { writePolicy } from '../src/lib/fork/doctor';
import { formatUnits, parseUnits } from '../src/lib/fork/units';
import { selectorOf } from '../src/lib/fork/abi-sig';

const node = (f = fakeNode()) => ({ f, n: useForkNode({ send: f.send, now: () => 1_700_000_000_000, wait: async () => undefined }) });

test('probe · a forked dev node is recognised, and writing is allowed because IT signs', async () => {
  const { n } = node();
  const s = await n.probe('http://127.0.0.1:8545', false);
  assert.equal(s.facts.chainId, 31337);
  assert.equal(s.facts.devNode, true);
  assert.equal(s.facts.isFork, true);
  assert.equal(s.facts.forkUrl, 'https://rpc.example/mainnet');
  assert.equal(s.facts.forkBlock, 20000000);
  assert.equal(s.facts.accounts.length, 2);
  assert.equal(s.writes.ok, true);
  assert.match(s.findings.map(x => x.title).join(' | '), /Connected/);
  assert.match(s.findings.map(x => x.title).join(' | '), /This node is a fork/);
  assert.equal(s.gwei, 2.5);
});

test('probe · a real public RPC is read-only, and says why in one sentence', async () => {
  const { n } = node(fakeNode({ mainnet: true }));
  const s = await n.probe('https://cloudflare-eth.com', true);
  assert.equal(s.facts.chainId, 1);
  assert.equal(s.facts.devNode, false);
  assert.equal(s.writes.ok, false);
  assert.match(s.writes.why, /no unlocked accounts/);
  assert.match(s.findings.map(x => x.title).join(' | '), /real public chain/);
});

test('probe · nothing answering produces the three candidates and the command that fixes each', async () => {
  const { n } = node(fakeNode({ offline: true }));
  const s = await n.probe('http://127.0.0.1:8545', true);
  assert.equal(s.facts.reachable, false);
  const text = s.findings.map(x => x.title + ' ' + x.detail + ' ' + (x.fix || '')).join(' | ');
  assert.match(text, /No answer/);
  assert.match(text, /anvil --host 127\.0\.0\.1 --port 8545 --allow-origin/);
  assert.match(text, /https and your node is on http/);
  assert.match(text, /Safari/);
  assert.equal(writePolicy(s.facts).ok, false);
});

test('pool · a v2 pair reads as its own reserves, with the stable side as the quote', async () => {
  const { n } = node();
  const r = await loadPool(n, PAIR);
  assert.equal(r.kind, 'v2');
  const p = r.pool;
  assert.equal(p.base.symbol, 'TKA');
  assert.equal(p.quote.symbol, 'USDC');
  assert.equal(p.base.decimals, 18);
  assert.equal(p.quote.decimals, 6);
  assert.equal(p.baseIsToken0, true);
  assert.equal(p.feeBps, 30);
  assert.equal(p.price, 2000);
  assert.equal(p.baseHeld, 100);
  assert.equal(p.quoteHeld, 200000);
  assert.equal(p.tvlQuote, 400000);
  assert.equal(quoteIsToken1(p.base, p.quote), true);
  const bal = await poolBalances(n, p, USER);
  assert.equal(formatUnits(bal.base, 18), '10');
  assert.equal(formatUnits(bal.quote, 6), '50000');
});

test('pool · the curve DexLadder quotes on agrees with the pair\'s integer arithmetic', async () => {
  const { n } = node();
  const { pool } = await loadPool(n, PAIR);
  // sell 1 TKA into the pair: the contract's answer, in USDC base units
  const contract = pairOut(parseUnits('1', 18), parseUnits('100', 18), parseUnits('200000', 6));
  const contractHuman = Number(formatUnits(contract, 6));
  // the same swap on the curve the engine uses (fee charged by the account transition, so add it back)
  const curve = ammSwap(pool.pool, 'sell', 1);
  const curveNet = curve.quote * (1 - pool.feeBps / 10000);
  assert.ok(curveNet > 0 && contractHuman > 0);
  assert.ok(Math.abs(curveNet / contractHuman - 1) < 5e-4, 'curve ' + curveNet + ' vs contract ' + contractHuman);
});

test('engine · Advanced mode prices on the forked pool: its price, its depth, its fee', async () => {
  const { n } = node();
  const { pool } = await loadPool(n, PAIR);
  const venue = forkVenue(pool);
  const eng = createBookEngine({
    priceOf: () => 12345,                       // the data feed is deliberately wrong here…
    statsOf: () => ({ vol24: 1e9, mcap: 1e10, chg24: 0, price: 12345 }),
    now: () => 1_700_000_000_000, random: () => 0.5,
    realism: () => ({ mode: 'advanced', venue: 'dexamm', tolerancePct: 5, rangePct: null, fork: venue }),
  });
  const pv = eng.preview('TKA', 'USDC', 'buy', 1, {});
  assert.ok(pv);
  assert.equal(pv!.mid, 2000);                  // …and the POOL is what priced the order
  assert.equal(pv!.feeRate, 0.003);
  assert.ok(pv!.amm);
  assert.deepEqual(pv!.amm!.fork, { label: 'TKA / USDC · v2 0.30% fee', quote: 'USDC' });
  assert.equal(pv!.amm!.venue, 'localfork');
  assert.ok(pv!.amm!.impactPct > 0.9 && pv!.amm!.impactPct < 1.1, String(pv!.amm!.impactPct));
  assert.equal(pv!.amm!.poolUSD, 400000);   // in USDC, the pool's own quote token — not converted by any price feed
  // a size the pool cannot supply at that tolerance is refused, with the educational sentence
  const big = eng.execute('TKA', 'USDC', 'buy', 60, { tolerancePct: 0.5 });
  assert.ok('rejected' in big && big.rejected);
});

test('swap · the plan is router-free when no router is given: transfer in, then pair.swap', async () => {
  const { n } = node();
  const { pool } = await loadPool(n, PAIR);
  const plan = planSwap({ pool, side: 'sell', amount: '1', slippagePct: 0.5, from: USER, router: '', allowance: BigInt(0), deadline: 1_700_000_600 });
  assert.equal(plan.route, 'pair-v2');
  assert.equal(plan.steps.length, 2);
  assert.match(plan.steps[0]!.label, /transfer TKA to the pair/);
  assert.equal(plan.steps[1]!.label, 'pair.swap');
  assert.equal(plan.expectedOut, pairOut(parseUnits('1', 18), parseUnits('100', 18), parseUnits('200000', 6)));
  assert.ok(plan.minOut < plan.expectedOut && plan.minOut > (plan.expectedOut * BigInt(99)) / BigInt(100));
  // with a router: one approval (allowance is short) and one router call
  const viaRouter = planSwap({ pool, side: 'sell', amount: '1', slippagePct: 0.5, from: USER, router: ROUTER, allowance: BigInt(0), deadline: 1_700_000_600 });
  assert.equal(viaRouter.route, 'router-v2');
  assert.deepEqual(viaRouter.steps.map(s => s.label), ['approve TKA', 'swapExactTokensForTokens']);
  // …and no approval when the allowance already covers it
  const approved = planSwap({ pool, side: 'sell', amount: '1', slippagePct: 0.5, from: USER, router: ROUTER, allowance: parseUnits('100', 18), deadline: 1_700_000_600 });
  assert.deepEqual(approved.steps.map(s => s.label), ['swapExactTokensForTokens']);
  assert.throws(() => planSwap({ pool, side: 'sell', amount: '0', slippagePct: 0.5, from: USER, router: '', allowance: BigInt(0), deadline: 1 }), /enter an amount/);
});

test('swap · run it: the node signs, the receipt is read, and the Transfer logs say what arrived', async () => {
  const { f, n } = node();
  const { pool } = await loadPool(n, PAIR);
  const plan = planSwap({ pool, side: 'sell', amount: '1', slippagePct: 0.5, from: USER, router: '', allowance: BigInt(0), deadline: 1_700_000_600 });
  const out = await runSwap(n, plan, USER);
  assert.equal(out.failed, '');
  assert.equal(out.done.length, 2);
  assert.equal(out.sent, parseUnits('1', 18));
  assert.equal(out.received, plan.minOut);
  assert.equal(out.gasUsed, BigInt(240000));
  assert.equal(out.gasWei, BigInt(240000) * BigInt('2500000000'));
  // every write was dry-run with eth_call before it was sent
  const order = f.sent.filter(x => x.method === 'eth_call' || x.method === 'eth_sendTransaction').map(x => x.method);
  assert.equal(order.filter(m => m === 'eth_sendTransaction').length, 2);
  assert.equal(order[order.indexOf('eth_sendTransaction') - 1], 'eth_call');
  // the pair really moved on the fake chain, so a re-read shows a new price
  const after = await loadPool(n, PAIR);
  assert.ok(after.pool.price < 2000);
});

test('swap · a revert is refused before anything is sent, in the contract\'s own words', async () => {
  const { f, n } = node(fakeNode({ revertOn: selectorOf('transfer(address,uint256)'), revertText: 'ERC20: transfer amount exceeds balance' }));
  const { pool } = await loadPool(n, PAIR);
  const plan = planSwap({ pool, side: 'sell', amount: '1', slippagePct: 0.5, from: USER, router: '', allowance: BigInt(0), deadline: 1_700_000_600 });
  const out = await runSwap(n, plan, USER);
  assert.match(out.failed, /transfer TKA to the pair: ERC20: transfer amount exceeds balance/);
  assert.equal(out.done.length, 0);
  assert.equal(f.sent.filter(x => x.method === 'eth_sendTransaction').length, 0);
});
