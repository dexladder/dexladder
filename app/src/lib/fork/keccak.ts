/**
 * Keccak-256 — the hash Ethereum names functions and events with.
 *
 * Pure, dependency-free, and here for ONE reason: a function selector is the first four bytes of
 * keccak256("transfer(address,uint256)"). Without it the fork sandbox could not build a single
 * call, and no library may be pulled in (the payload is one file, audited by hand).
 *
 * Original Keccak padding (0x01 … 0x80), rate 136 bytes — NOT SHA3-256's 0x06. The two differ
 * only in that pad byte, and getting it wrong produces a plausible-looking wrong hash, so
 * test/fork-keccak.test.ts pins the empty string, "abc" and four real selectors.
 *
 * Lanes live in a BigUint64Array, so every store truncates to 64 bits for free and the round
 * function reads like the specification. The payload targets ES2019, so bigints are written
 * BigInt(x) rather than as literals.
 */
const B0 = BigInt(0), B64 = BigInt(64), B8 = BigInt(8), BFF = BigInt(255);
const RATE = 136;

const RC: readonly bigint[] = [
  '0x0000000000000001', '0x0000000000008082', '0x800000000000808a', '0x8000000080008000',
  '0x000000000000808b', '0x0000000080000001', '0x8000000080008081', '0x8000000000008009',
  '0x000000000000008a', '0x0000000000000088', '0x0000000080008009', '0x000000008000000a',
  '0x000000008000808b', '0x800000000000008b', '0x8000000000008089', '0x8000000000008003',
  '0x8000000000008002', '0x8000000000000080', '0x000000000000800a', '0x800000008000000a',
  '0x8000000080008081', '0x8000000000008080', '0x0000000080000001', '0x8000000080008008',
].map(h => BigInt(h));

/** rho rotation offsets, indexed x + 5y. */
const RHO: readonly number[] = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];

const at = (a: BigUint64Array, i: number): bigint => a[i] as bigint;
const rot = (a: BigUint64Array, i: number, n: number): bigint =>
  n === 0 ? at(a, i) : (at(a, i) << BigInt(n)) | (at(a, i) >> (B64 - BigInt(n)));

function permute(A: BigUint64Array): void {
  const B = new BigUint64Array(25), C = new BigUint64Array(5), D = new BigUint64Array(5);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) C[x] = at(A, x) ^ at(A, x + 5) ^ at(A, x + 10) ^ at(A, x + 15) ^ at(A, x + 20);
    for (let x = 0; x < 5; x++) D[x] = at(C, (x + 4) % 5) ^ rot(C, (x + 1) % 5, 1);
    for (let i = 0; i < 25; i++) A[i] = at(A, i) ^ at(D, i % 5);
    // rho (rotate each lane) and pi (move it to y, 2x+3y) in one pass
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rot(A, x + 5 * y, RHO[x + 5 * y] as number);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) A[x + 5 * y] = at(B, x + 5 * y) ^ (~at(B, ((x + 1) % 5) + 5 * y) & at(B, ((x + 2) % 5) + 5 * y));
    A[0] = at(A, 0) ^ (RC[round] as bigint);
  }
}

/** keccak256 of `data`, as 32 bytes. */
export function keccak256(data: Uint8Array): Uint8Array {
  const A = new BigUint64Array(25);
  // pad: 0x01 after the message, 0x80 on the last byte of the block (they coincide when one byte is left)
  const padded = new Uint8Array(Math.floor(data.length / RATE) * RATE + RATE);
  padded.set(data);
  padded[data.length] = 0x01;
  padded[padded.length - 1] = (padded[padded.length - 1] as number) | 0x80;
  for (let off = 0; off < padded.length; off += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      let lane = B0;
      for (let b = 7; b >= 0; b--) lane = (lane << B8) | BigInt(padded[off + i * 8 + b] as number);
      A[i] = at(A, i) ^ lane;
    }
    permute(A);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let lane = at(A, i);
    for (let b = 0; b < 8; b++) { out[i * 8 + b] = Number(lane & BFF); lane >>= B8; }
  }
  return out;
}
