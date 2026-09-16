/**
 * The fork sandbox's cryptography and codecs, against values that exist outside this codebase:
 * published Keccak vectors, the four selectors the panel actually sends, EIP-55 addresses, and a
 * hand-written Error(string) revert payload (built byte by byte, NOT by our own encoder, so the
 * decoder is tested against the specification rather than against itself).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256 } from '../src/lib/fork/keccak';
import { bytesToHex, checksumAddress, hexToBytes, shortHex, toQuantity, utf8ToBytes } from '../src/lib/fork/hex';
import { formatUnits, parseUnits } from '../src/lib/fork/units';
import { parseFunction, parseEvent, selectorOf } from '../src/lib/fork/abi-sig';
import { parseAbi } from '../src/lib/fork/abi-json';
import { encodeCall, encodeTuple, isDynamicType } from '../src/lib/fork/abi-encode';
import { decodeParams, decodeRevert, decodeLog, formatDecoded } from '../src/lib/fork/abi-decode';

const hash = (s: string): string => bytesToHex(keccak256(utf8ToBytes(s)), false);

test('keccak-256 matches the published vectors (and the pad byte is Keccak, not SHA-3)', () => {
  assert.equal(hash(''), 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  assert.equal(hash('abc'), '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
  // longer than the 136-byte rate: exercises a second absorb block
  assert.equal(hash('x'.repeat(200)).length, 64);
});

test('the selectors and topics the sandbox sends are the real ones', () => {
  assert.equal(selectorOf('transfer(address,uint256)'), '0xa9059cbb');
  assert.equal(selectorOf('balanceOf(address)'), '0x70a08231');
  assert.equal(selectorOf('approve(address,uint256)'), '0x095ea7b3');
  assert.equal(selectorOf('getReserves()'), '0x0902f1ac');
  assert.equal(selectorOf('slot0()'), '0x3850c7bd');
  assert.equal(parseEvent('event Transfer(address indexed from, address indexed to, uint256 value)').topic,
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
});

test('EIP-55 checksums (the mixed case a pasted address is checked against)', () => {
  assert.equal(checksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'), '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
  assert.equal(checksumAddress('0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359'), '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359');
  assert.equal(shortHex('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'), '0x5aAeb6…eAed');
  assert.equal(toQuantity(BigInt(0)), '0x0');
  assert.equal(toQuantity(BigInt(255)), '0xff');
});

test('token amounts are exact at 18 decimals (no float round trip)', () => {
  assert.equal(parseUnits('1', 18), BigInt('1000000000000000000'));
  assert.equal(parseUnits('0.000000000000000001', 18), BigInt(1));
  assert.equal(parseUnits('1234.5', 6), BigInt('1234500000'));
  assert.equal(formatUnits(BigInt('1000000000000000001'), 18), '1.000000000000000001');
  assert.equal(formatUnits(BigInt('1234500000'), 6), '1234.5');
  assert.throws(() => parseUnits('1.0000001', 6), /decimal places/);
  assert.throws(() => parseUnits('abc', 18), /not an amount/);
});

test('a transfer call encodes to the calldata every wallet sends', () => {
  const f = parseFunction('function transfer(address to, uint256 amount) returns (bool)');
  assert.equal(f.signature, 'transfer(address,uint256)');
  assert.equal(encodeCall(f.selector, ['address', 'uint256'], ['0x5B38Da6a701c568545dCfcB03FcB875f56beddC4', BigInt('1000000000000000000')]),
    '0xa9059cbb0000000000000000000000005b38da6a701c568545dcfcb03fcb875f56beddc40000000000000000000000000000000000000000000000000de0b6b3a7640000');
});

test('dynamic arguments round-trip through the head/tail layout', () => {
  assert.equal(isDynamicType('address[]'), true);
  assert.equal(isDynamicType('uint256[2]'), false);
  const types = ['uint256', 'address[]', 'string', 'bool'];
  const values = [BigInt(42), ['0x0000000000000000000000000000000000000001', '0x0000000000000000000000000000000000000002'], 'héllo', true];
  const back = decodeParams(types, bytesToHex(encodeTuple(types, values)));
  assert.equal(back[0], BigInt(42));
  assert.deepEqual(back[1], ['0x0000000000000000000000000000000000000001', '0x0000000000000000000000000000000000000002']);
  assert.equal(back[2], 'héllo');
  assert.equal(back[3], true);
});

test('range and type errors are refused before a transaction exists', () => {
  assert.throws(() => encodeTuple(['uint8'], [256]), /too large/);
  assert.throws(() => encodeTuple(['uint256'], [-1]), /cannot be negative/);
  assert.throws(() => encodeTuple(['address'], ['0x1234']), /20 bytes/);
  assert.throws(() => encodeTuple(['bytes32'], ['0x00']), /exactly 32 bytes/);
  assert.throws(() => encodeTuple(['uint256', 'uint256'], [1]), /expected 2 argument/);
});

test('a revert is a sentence: require, panic, and the contract\'s own error', () => {
  // hand-built Error("no"): selector · offset 0x20 · length 2 · "no" padded
  const payload = '0x08c379a0'
    + '0000000000000000000000000000000000000000000000000000000000000020'
    + '0000000000000000000000000000000000000000000000000000000000000002'
    + '6e6f000000000000000000000000000000000000000000000000000000000000';
  const r = decodeRevert(payload);
  assert.equal(r.kind, 'reason');
  assert.equal(r.kind === 'reason' && r.text, 'no');
  const panic = decodeRevert('0x4e487b71' + '0000000000000000000000000000000000000000000000000000000000000011');
  assert.equal(panic.kind, 'panic');
  assert.match(panic.text, /overflow or underflow/);
  const set = parseAbi('error Slippage(uint256 wanted, uint256 got)');
  const custom = decodeRevert(set.errors[0]!.selector
    + '0000000000000000000000000000000000000000000000000000000000000064'
    + '000000000000000000000000000000000000000000000000000000000000000a', set.errors);
  assert.equal(custom.kind, 'custom');
  assert.equal(custom.text, 'Slippage(100, 10)');
  assert.equal(decodeRevert('0x').kind, 'none');
  assert.equal(decodeRevert('0xdeadbeef').kind, 'raw');
});

test('an ABI can be pasted as JSON, as a build artifact, or as lines — and tuples are refused by name', () => {
  const json = parseAbi('[{"type":"function","name":"mint","stateMutability":"nonpayable","inputs":[{"name":"to","type":"address"},{"name":"amt","type":"uint256"}],"outputs":[]}]');
  assert.equal(json.source, 'json');
  assert.equal(json.functions[0]!.signature, 'mint(address,uint256)');
  const artifact = parseAbi('{"contractName":"T","abi":[{"type":"function","name":"paused","stateMutability":"view","inputs":[],"outputs":[{"type":"bool"}]}]}');
  assert.equal(artifact.functions[0]!.mutability, 'view');
  const lines = parseAbi('function totalSupply() view returns (uint256)\nevent Mint(address indexed to, uint256 amt)');
  assert.equal(lines.functions.length, 1);
  assert.equal(lines.events[0]!.indexed[0], true);
  const withTuple = parseAbi('[{"type":"function","name":"ok","inputs":[]},{"type":"function","name":"bad","inputs":[{"name":"p","type":"tuple","components":[{"type":"uint256"}]}]}]');
  assert.equal(withTuple.functions.length, 1);
  assert.match(withTuple.skipped[0]!, /tuple and struct/);
  assert.throws(() => parseAbi('{"no":"abi"}'), /no ABI array/);
});

test('an event log decodes indexed topics and data together', () => {
  const ev = parseEvent('event Transfer(address indexed from, address indexed to, uint256 value)');
  const v = decodeLog(ev, [ev.topic,
    '0x0000000000000000000000005b38da6a701c568545dcfcb03fcb875f56beddc4',
    '0x000000000000000000000000ab8483f64d9c6d1ecf9b849ae677dd3315835cb2'],
    '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000');
  assert.equal(v.from, '0x5b38da6a701c568545dcfcb03fcb875f56beddc4');
  assert.equal(v.to, '0xab8483f64d9c6d1ecf9b849ae677dd3315835cb2');
  assert.equal(v.value, '1000000000000000000');
  assert.equal(formatDecoded([BigInt(1), hexToBytes('0xff'), true]), '[1, 0xff, true]');
});
