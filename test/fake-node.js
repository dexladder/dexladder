// A scripted EVM node over real HTTP, for the fork-sandbox gate: it answers JSON-RPC the way
// `anvil --fork-url …` does, holds a Uniswap-v2-style pair with real reserves, and can revert.
// Real HTTP on purpose — CORS preflight, batching and the browser's own error shapes are part of
// what the sandbox has to survive, and a mocked fetch would prove none of it.
'use strict';
const http = require('http');

const TKA = '0x1111111111111111111111111111111111111111';
const USDC = '0x2222222222222222222222222222222222222222';
const PAIR = '0x3333333333333333333333333333333333333333';
const USER = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const USER2 = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';

// well-known selectors and topics (the same constants the unit tests pin our keccak against)
const SEL = {
  token0: '0dfe1681', token1: 'd21220a7', getReserves: '0902f1ac', slot0: '3850c7bd', liquidity: '1a686502',
  fee: 'ddca3f43', symbol: '95d89b41', name: '06fdde03', decimals: '313ce567', balanceOf: '70a08231',
  allowance: 'dd62ed3e', approve: '095ea7b3', transfer: 'a9059cbb', swap: '022c0d9f',
};
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const APPROVAL = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';

const word = v => BigInt(v).toString(16).padStart(64, '0');
const strRet = s => {
  const hex = Buffer.from(s, 'utf8').toString('hex');
  return '0x' + word(32) + word(s.length) + hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
};
const argAt = (data, i) => '0x' + data.slice(10 + i * 64, 10 + (i + 1) * 64);
const addrAt = (data, i) => '0x' + data.slice(10 + i * 64 + 24, 10 + (i + 1) * 64);
const revert = reason => ({ code: 3, message: 'execution reverted: ' + reason, data: '0x08c379a0' + strRet(reason).slice(2) });

function createNode(opts) {
  opts = opts || {};
  const state = {
    r0: 100n * 10n ** 18n, r1: 200000n * 10n ** 6n,
    bal: { [TKA]: { [USER]: 10n * 10n ** 18n }, [USDC]: { [USER]: 50000n * 10n ** 6n } },
    allow: {}, block: 1000, nonce: 0, txs: new Map(), calls: [],
  };
  const balOf = (token, who) => (state.bal[token] && state.bal[token][who.toLowerCase()]) || 0n;

  function ethCall(p) {
    const to = String(p.to || '').toLowerCase(), data = String(p.data || '0x').toLowerCase();
    const sel = data.slice(2, 10);
    if (to === PAIR) {
      if (sel === SEL.token0) return { result: '0x' + word(TKA) };
      if (sel === SEL.token1) return { result: '0x' + word(USDC) };
      if (sel === SEL.getReserves) return { result: '0x' + word(state.r0) + word(state.r1) + word(1700000000) };
      if (sel === SEL.swap) return { result: '0x' };
      return { error: { code: 3, message: 'execution reverted' } };
    }
    if (to === TKA || to === USDC) {
      if (sel === SEL.symbol) return { result: strRet(to === TKA ? 'TKA' : 'USDC') };
      if (sel === SEL.name) return { result: strRet(to === TKA ? 'Test Token A' : 'USD Coin') };
      if (sel === SEL.decimals) return { result: '0x' + word(to === TKA ? 18 : 6) };
      if (sel === SEL.balanceOf) {
        const who = addrAt(data, 0);
        if (who === PAIR) return { result: '0x' + word(to === TKA ? state.r0 : state.r1) };
        return { result: '0x' + word(balOf(to, who)) };
      }
      if (sel === SEL.allowance) return { result: '0x' + word(state.allow[to + addrAt(data, 1)] || 0n) };
      if (sel === SEL.approve) return { result: '0x' + word(1) };
      if (sel === SEL.transfer) {
        const amt = BigInt(argAt(data, 1)), from = String(p.from || USER).toLowerCase();   // arg0 is the recipient
        if (amt > balOf(to, from)) return { error: revert('ERC20: transfer amount exceeds balance') };
        return { result: '0x' + word(1) };
      }
    }
    if (!p.to && String(p.data || '').length > 4) return { result: '0x' };   // a deployment dry-run
    return { error: { code: -32000, message: 'no contract code at ' + to } };
  }

  function receiptFor(hash) {
    const tx = state.txs.get(hash);
    if (!tx) return null;
    const data = tx.data.toLowerCase(), sel = data.slice(2, 10), to = tx.to.toLowerCase(), from = tx.from.toLowerCase();
    const logs = [];
    if (sel === SEL.transfer) {
      const dst = addrAt(data, 0), amt = BigInt(argAt(data, 1));
      logs.push({ address: to, topics: [TRANSFER, '0x' + word(from), '0x' + word(dst)], data: '0x' + word(amt), blockNumber: '0x' + state.block.toString(16), logIndex: '0x0' });
      state.bal[to][from] = balOf(to, from) - amt;
      if (dst === PAIR) { if (to === TKA) state.r0 += amt; else state.r1 += amt; }
    } else if (sel === SEL.approve) {
      const spender = addrAt(data, 0), amt = BigInt(argAt(data, 1));
      state.allow[to + spender] = amt;
      logs.push({ address: to, topics: [APPROVAL, '0x' + word(from), '0x' + word(spender)], data: '0x' + word(amt), blockNumber: '0x' + state.block.toString(16), logIndex: '0x0' });
    } else if (sel === SEL.swap) {
      const out0 = BigInt(argAt(data, 0)), out1 = BigInt(argAt(data, 1)), who = addrAt(data, 2);
      const token = out0 > 0n ? TKA : USDC, amt = out0 > 0n ? out0 : out1;
      if (out0 > 0n) state.r0 -= out0; else state.r1 -= out1;
      state.bal[token][who] = balOf(token, who) + amt;
      logs.push({ address: token, topics: [TRANSFER, '0x' + word(PAIR), '0x' + word(who)], data: '0x' + word(amt), blockNumber: '0x' + state.block.toString(16), logIndex: '0x1' });
    }
    return {
      transactionHash: hash, status: '0x1', gasUsed: '0x' + (120000).toString(16),
      effectiveGasPrice: '0x' + (2500000000).toString(16), blockNumber: '0x' + state.block.toString(16),
      contractAddress: tx.to ? null : '0x' + '9'.repeat(40), logs,
    };
  }

  function one(req) {
    const id = req && req.id, method = String((req && req.method) || ''), params = (req && req.params) || [];
    state.calls.push(method);
    const ok = result => ({ jsonrpc: '2.0', id, result });
    const err = (message, code) => ({ jsonrpc: '2.0', id, error: { code: code || -32601, message } });
    switch (method) {
      case 'web3_clientVersion': return ok(opts.mainnet ? 'Geth/v1.14.0/linux' : 'anvil/v1.0.3');
      case 'eth_chainId': return ok(opts.mainnet ? '0x1' : '0x7a69');
      case 'eth_blockNumber': return ok('0x' + state.block.toString(16));
      case 'eth_accounts': return ok(opts.mainnet ? [] : [USER, USER2]);
      case 'eth_gasPrice': return ok('0x' + (2500000000).toString(16));
      case 'anvil_nodeInfo':
        return opts.mainnet ? err('the method anvil_nodeInfo does not exist')
          : ok({ currentBlockNumber: state.block, forkConfig: { forkUrl: 'https://reth.example/mainnet', forkBlockNumber: 20123456 } });
      case 'hardhat_metadata': return err('the method hardhat_metadata does not exist');
      case 'eth_call': {
        const r = ethCall(params[0] || {});
        return r.error ? { jsonrpc: '2.0', id, error: r.error } : ok(r.result);
      }
      case 'eth_sendTransaction': {
        const p = params[0] || {}, dry = ethCall(p);
        if (dry.error) return { jsonrpc: '2.0', id, error: dry.error };
        const hash = '0x' + String(++state.nonce).padStart(64, '0');
        state.txs.set(hash, { data: String(p.data || '0x'), to: String(p.to || ''), from: String(p.from || USER) });
        state.block++;
        return ok(hash);
      }
      case 'eth_getTransactionReceipt': return ok(receiptFor(String(params[0] || '')));
      case 'eth_getLogs': return ok([]);
      default: return err('the method ' + method + ' does not exist');
    }
  }

  const server = http.createServer((req, res) => {
    const cors = {
      'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type', 'access-control-allow-private-network': 'true',
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let out;
      try { const j = JSON.parse(body); out = Array.isArray(j) ? j.map(one) : one(j); }
      catch (e) { out = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }; }
      res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, cors));
      res.end(JSON.stringify(out));
    });
  });

  return {
    state, TKA, USDC, PAIR, USER,
    listen: () => new Promise(r => server.listen(0, '127.0.0.1', () => r('http://127.0.0.1:' + server.address().port))),
    close: () => new Promise(r => server.close(r)),
  };
}

module.exports = { createNode, TKA, USDC, PAIR, USER, TRANSFER, APPROVAL };
