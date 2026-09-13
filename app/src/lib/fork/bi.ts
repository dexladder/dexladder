/** Small bigint constants. The payload targets ES2019, where `1n` is a syntax error. */
export const ZERO = BigInt(0);
export const ONE = BigInt(1);
export const EIGHT = BigInt(8);
export const BYTE = BigInt(255);
export const TEN = BigInt(10);
export const pow2 = (bits: number): bigint => ONE << BigInt(bits);
export const pow10 = (n: number): bigint => TEN ** BigInt(n);
