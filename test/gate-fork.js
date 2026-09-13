// DexLadder LOCAL FORK gate — the advanced sandbox, driven end to end in Chromium against a real
// JSON-RPC server (test/fake-node.js) on 127.0.0.1, which the page reaches over real HTTP.
//
//   node test/gate-fork.js [dist/index.html]      exit code = number of failures
//
// What it proves, in the order a user meets it:
//   A  the panel mounts in the terminal and nothing about the rest of the product changes
//   B  a dev fork is recognised, and a real public RPC is refused for writes — by policy, not luck
//   C  a pool is read from the contract: symbols, decimals, reserves, fee, price
//   D  routing the ticket prices EVERY order type on that pool: the preview is the pool's own curve,
//      the fee is the pool's fee, the gas is the node's gas — and turning it off restores the model
//   E  a real swap is signed by the node, mined, read back from its receipt, and moves the pool
//   F  the contract console reads, writes and REFUSES a revert before sending, in the contract's words
//   G  a contract deploys and its address comes back
'use strict';
const path = require('path');
const { launch } = require('./harness');
const { createNode, PAIR, TKA, USER } = require('./fake-node');

const file = process.argv[2] || path.join(__dirname, '..', 'dist', 'index.html');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 500) : '')); } };

const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const node = createNode();
  const mainnet = createNode({ mainnet: true });
  const url = await node.listen();
  const mainnetUrl = await mainnet.listen();
  const hh = await launch(file, { viewport: { width: 1440, height: 1000 } });
  const { page, errors } = hh;
  await page.waitForTimeout(6500);

  // ---------------------------------------------------------------- A · it is there
  const mounted = await page.evaluate(async () => {
    location.hash = '#/terminal';
    await new Promise(r => setTimeout(r, 800));
    if (window.DLFORK) DLFORK.mount();
    await new Promise(r => setTimeout(r, 300));
    return {
      card: !!document.getElementById('dlFork'),
      inTerminal: !!document.querySelector('#page-coin .side #dlFork'),
      url: (document.getElementById('dlfkUrl') || {}).value,
      installed: !!(window.DLAPP && DLAPP.fork && DLAPP.fork.installed()),
      frozen: !!(window.DLAPP && Object.isFrozen(DLAPP.fork)),
      keccak: window.DLAPP && DLAPP.fork.lib.selectorOf('transfer(address,uint256)'),
      noRoute: !!(window.DLAPP && DLAPP.fork.routed() === null),
      styles: document.querySelectorAll('#dlFork [style]').length,
    };
  });
  console.log('A · the panel');
  ok('the sandbox mounts in the Terminal side column', mounted.card && mounted.inTerminal, mounted);
  ok('the transport is installed by the layer, and DLAPP.fork is frozen', mounted.installed && mounted.frozen, mounted);
  ok('the URL field starts on the address Anvil prints', mounted.url === 'http://127.0.0.1:8545', mounted.url);
  ok('the payload\'s own keccak names the real selector', mounted.keccak === '0xa9059cbb', mounted.keccak);
  ok('nothing is routed until the trader says so', mounted.noRoute);
  ok('the panel adds no inline style (the ratchet stays where it is)', mounted.styles === 0, mounted.styles);

  const set = (id, v) => page.evaluate(([id, v]) => {
    const el = document.getElementById(id);
    el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [id, v]);
  const click = (label) => page.evaluate((label) => {
    const b = [...document.querySelectorAll('#dlFork button')].find(x => x.textContent.trim().toLowerCase().startsWith(label.toLowerCase()));
    if (!b) throw new Error('no button starting with ' + label + ' — buttons: ' + [...document.querySelectorAll('#dlFork button')].map(x => x.textContent).join(' | '));
    b.click();
  }, label);
  const text = () => page.evaluate(() => document.getElementById('dlFork').innerText);
  const facts = () => page.evaluate(() => {
    const out = {};
    const grid = document.querySelectorAll('#dlFork .dlx-fk-k');
    grid.forEach(k => { const v = k.nextElementSibling; if (v) out[k.textContent] = v.textContent; });
    return out;
  });

  // ---------------------------------------------------------------- B · who the node is
  console.log('B · the node, and the write policy');
  await set('dlfkUrl', url);
  await click('connect');
  await wait(1200);
  const dev = await facts();
  const devText = await text();
  ok('a forked dev node is recognised: client, chain, block, signer, fork origin', /anvil/.test(dev.client || '') && /31337/.test(dev.chain || '') && /reth\.example/.test(dev['forked from'] || ''), dev);
  ok('it reports the node\'s own gas price, not Ethereum\'s', /2\.5(00)? gwei/.test(dev['gas price'] || ''), dev['gas price']);
  ok('transactions are enabled because the NODE signs (no key in DexLadder)', /Transactions enabled/.test(devText) && /never holds a key/.test(devText), devText.slice(0, 400));
  await set('dlfkUrl', mainnetUrl);
  await click('reconnect');
  await wait(1200);
  const pub = await text();
  ok('a real public chain is read-only, and says why', /Read-only/.test(pub) && /public chain/.test(pub) && /no unlocked accounts/.test(pub), pub.slice(0, 500));
  await set('dlfkUrl', 'http://127.0.0.1:1/');
  await click('reconnect');
  await wait(2000);
  const dead = await text();
  ok('a dead endpoint produces the three candidates and the anvil command', /No answer/.test(dead) && /anvil --host 127\.0\.0\.1 --port 8545 --allow-origin/.test(dead), dead.slice(0, 500));
  await set('dlfkUrl', url);
  await click('reconnect');
  await wait(1200);

  // ---------------------------------------------------------------- C · the pool
  console.log('C · the pool, read from the contract');
  await set('dlfkPool', PAIR);
  await click('load pool');
  await wait(1500);
  const pool = await facts();
  ok('the pair reads as itself: symbols, kind and fee', /TKA \/ USDC · v2 · 0\.30% fee/.test(pool.pair || ''), pool.pair);
  ok('its price comes from its reserves (200000 USDC / 100 TKA = 2000)', /^1 TKA = 2000\.0000/.test(pool.price || ''), pool.price);
  ok('its reserves are the contract\'s, at the block they were read', /100\.00000 TKA/.test(pool.reserves || '') && /200000\.00 USDC/.test(pool.reserves || '') && /block \d+/.test(pool['read at'] || ''), pool);
  ok('the trader\'s own token balances are shown from the node', /10 TKA/.test(pool['your balance'] || '') && /50000 USDC/.test(pool['your balance'] || ''), pool['your balance']);

  // ---------------------------------------------------------------- D · the ticket, routed
  console.log('D · the ticket routed to that pool');
  const before = await page.evaluate(() => {
    S.coin = 'SOL'; S.quote = 'USDT'; S.ordType = 'market'; S.side = 'buy';
    S.dlsim = Object.assign(S.dlsim || {}, { mode: 'pro', venue: 'dexamm', slipTol: 3, gasMode: 'calm', tier: 'medium' });
    CBX.reset();
    const p = CBX.preview('SOL', 'USDT', 'buy', 0.01, {});
    return { mid: p.mid, fee: p.feeRate, fork: !!(p.amm && p.amm.fork) };
  });
  await page.evaluate(() => {
    const on = [...document.querySelectorAll('#dlfkRoute [role=radio]')].find(b => b.textContent === 'On');
    on.click();
  });
  await wait(600);
  const routed = await page.evaluate(async () => {
    CBX.reset();
    const p = CBX.preview('SOL', 'USDT', 'buy', 0.01, { tolerancePct: 3 });
    const big = CBX.preview('SOL', 'USDT', 'buy', 40, { tolerancePct: 3 });
    document.getElementById('amt').value = '0.01';
    CBXpreview();
    await new Promise(r => setTimeout(r, 200));
    const prev = document.getElementById('cbxPrev').innerText;
    return {
      mid: p.mid, fee: p.feeRate, fork: p.amm && p.amm.fork, impact: p.amm && p.amm.impactPct,
      bigImpact: big.amm && big.amm.impactPct, mode: S.dlsim.mode,
      badge: (document.querySelector('#cbxPrev .dlx-badge') || {}).textContent,
      previewText: prev, gas: /gwei · calm · your node/.test(prev),
      routedVenue: !!DLAPP.fork.routed(),
    };
  });
  ok('before routing, the ticket is on the modelled pool', before.mid !== 2000 && !before.fork, before);
  ok('routed: the mid IS the pool\'s price and the fee IS the pool\'s fee', routed.mid === 2000 && routed.fee === 0.003, routed);
  ok('routed: the preview names the pool on the trader\'s node', /Your node · TKA \/ USDC/.test(routed.badge || '') && /Your pool holds ≈ 400,000 USDC/.test(routed.previewText || ''), { badge: routed.badge, text: (routed.previewText || '').slice(0, 300) });
  ok('routed: gas is quoted from the node\'s own gas price', routed.gas, (routed.previewText || '').slice(0, 400));
  ok('routed: impact grows with size on the real curve (0.01 ≪ 40 TKA)', routed.impact > 0 && routed.impact < 0.02 && routed.bigImpact > 20, routed);
  ok('routing switches the ticket to Advanced by itself', routed.mode === 'pro' && routed.routedVenue);
  const off = await page.evaluate(async () => {
    [...document.querySelectorAll('#dlfkRoute [role=radio]')].find(b => b.textContent === 'Off').click();
    await new Promise(r => setTimeout(r, 300));
    CBX.reset();
    const p = CBX.preview('SOL', 'USDT', 'buy', 0.01, {});
    return { mid: p.mid, fork: !!(p.amm && p.amm.fork), routed: DLAPP.fork.routed() };
  });
  ok('switching it off restores the modelled pool exactly', off.mid === before.mid && !off.fork && off.routed === null, off);

  // ---------------------------------------------------------------- E · a real swap
  console.log('E · a real, node-signed swap');
  const r0 = node.state.r0, r1 = node.state.r1;
  await page.evaluate(() => {
    [...document.querySelectorAll('#dlfkSide [role=radio]')].find(b => /Sell TKA/.test(b.textContent)).click();
  });
  await wait(300);
  await set('dlfkAmt', '1');
  await click('send swap');
  await wait(3000);
  const swapped = await text();
  const moved = { r0: node.state.r0, r1: node.state.r1 };
  ok('the swap was planned router-free (transfer in, then pair.swap) and both transactions were sent', /transfer TKA to the pair · 0x/.test(swapped) && /pair\.swap · 0x/.test(swapped), swapped.slice(-900));
  ok('the receipt is read back: what arrived, and the gas actually paid', /swapped 1 → 19\d\d\./.test(swapped) && /gas 240000 units/.test(swapped), (swapped.match(/swapped[^\n]*/) || [''])[0]);
  ok('the pool really moved on the node (its reserves changed by the amounts swapped)', moved.r0 === r0 + 10n ** 18n && moved.r1 < r1, { r0: String(moved.r0), was: String(r0), r1: String(moved.r1) });
  const reread = await facts();
  ok('the panel re-read the pool after the swap, so its price is the new one', parseFloat((reread.price || '0').replace(/^1 TKA = /, '')) < 2000, reread.price);

  // ---------------------------------------------------------------- F · the console
  console.log('F · the contract console');
  await set('dlfkAddr', TKA);
  await set('dlfkAbi', 'function balanceOf(address who) view returns (uint256 bal)\nfunction transfer(address to, uint256 amount) returns (bool)\nfunction approve(address spender, uint256 amount) returns (bool)\nevent Approval(address indexed owner, address indexed spender, uint256 value)');
  await click('read abi');
  await wait(400);
  await set('dlfkArg0', USER);
  await click('read (eth_call)');
  await wait(900);
  const readOut = await page.evaluate(() => (document.querySelector('#dlFork .dlx-fk-out') || {}).textContent || '');
  ok('a view function is read and decoded by name and type', /bal \(uint256\) = 9000000000000000000/.test(readOut), readOut);
  await page.evaluate(() => {
    const sel = document.getElementById('dlfkFn');
    sel.value = [...sel.options].find(o => /approve/.test(o.value)).value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await wait(300);
  await set('dlfkArg0', USER);
  await set('dlfkArg1', '12345');
  await click('send transaction');
  await wait(2500);
  const sentOut = await page.evaluate(() => (document.querySelector('#dlFork .dlx-fk-out') || {}).textContent || '');
  ok('a write is signed by the node, mined, and its event decoded by name', /approve · 0x/.test(sentOut) && /mined in block/.test(sentOut) && /Approval\(owner: 0xf39f/.test(sentOut), sentOut);
  await page.evaluate(() => {
    const sel = document.getElementById('dlfkFn');
    sel.value = [...sel.options].find(o => /transfer\(/.test(o.value)).value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await wait(300);
  await set('dlfkArg0', USER);
  await set('dlfkArg1', '999999999999999999999999');
  const callsBefore = node.state.calls.filter(m => m === 'eth_sendTransaction').length;
  await click('send transaction');
  await wait(1500);
  const revertOut = await page.evaluate(() => (document.querySelector('#dlFork .dlx-fk-out') || {}).textContent || '');
  const callsAfter = node.state.calls.filter(m => m === 'eth_sendTransaction').length;
  ok('a revert is refused BEFORE sending, in the contract\'s own words', /ERC20: transfer amount exceeds balance/.test(revertOut) && callsAfter === callsBefore, { revertOut, callsBefore, callsAfter });

  // ---------------------------------------------------------------- G · deploy
  console.log('G · deploying their own contract');
  await set('dlfkCode', '0x60806040523480156100');
  await click('deploy');
  await wait(2000);
  const deployed = await page.evaluate(() => ({
    out: (document.querySelector('#dlFork .dlx-fk-out') || {}).textContent || '',
    addr: (document.getElementById('dlfkAddr') || {}).value,
  }));
  ok('creation bytecode is sent and the new address comes back from the receipt', /deployed at 0x9{40}/.test(deployed.out) && /^0x9{40}$/.test(deployed.addr), deployed);
  ok('no page error anywhere in the run', errors.length === 0, errors.slice(0, 3));

  await hh.close();
  await node.close();
  await mainnet.close();
  console.log(`\n${pass} passed · ${fail} failed`);
  process.exit(fail);
})().catch(e => { console.error(e); process.exit(99); });
