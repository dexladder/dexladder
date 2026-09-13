/**
 * Bytes, hex and addresses. Every value that crosses the JSON-RPC wire is a 0x string, and every
 * value the UI shows is derived from one — so the conversions live in one place and are total:
 * a malformed input throws a named error rather than producing a silently wrong word.
 */
import { keccak256 } from './keccak';
import { ZERO } from './bi';

const HEXC = '0123456789abcdef';

export class HexError extends Error {}

export function bytesToHex(b: Uint8Array, prefix = true): string {
  let s = '';
  for (const x of b) s += (HEXC[x >> 4] as string) + (HEXC[x & 15] as string);
  return prefix ? '0x' + s : s;
}

export function hexToBytes(h: string): Uint8Array {
  const s = strip(h);
  if (s.length % 2) throw new HexError('hex has an odd number of digits: ' + h);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isFinite(byte)) throw new HexError('not hex: ' + h);
    out[i] = byte;
  }
  return out;
}

/** `0x…` without the prefix, lower-cased, validated as hex digits only. */
export function strip(h: string): string {
  const s = String(h == null ? '' : h).trim().replace(/^0[xX]/, '').toLowerCase();
  if (s && !/^[0-9a-f]*$/.test(s)) throw new HexError('not hex: ' + h);
  return s;
}

export const utf8ToBytes = (s: string): Uint8Array => new TextEncoder().encode(s);
export const bytesToUtf8 = (b: Uint8Array): string => new TextDecoder().decode(b);

export function hexToBigInt(h: string): bigint {
  const s = strip(h);
  return s ? BigInt('0x' + s) : ZERO;
}

/** A quantity as the JSON-RPC wants it: minimal hex, `0x0` for zero, never negative. */
export function toQuantity(v: bigint | number): string {
  const n = typeof v === 'bigint' ? v : BigInt(Math.trunc(v));
  if (n < ZERO) throw new HexError('a quantity cannot be negative');
  return '0x' + n.toString(16);
}

/** A number small enough to be exact, or null when the reading is out of safe range. */
export function toSafeNumber(v: bigint): number | null {
  return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : null;
}

export const isAddress = (a: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(String(a || '').trim());

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}

/** EIP-55: the mixed-case form, so a typo in a pasted address is visible rather than fatal. */
export function checksumAddress(a: string): string {
  if (!isAddress(a)) throw new HexError('not an address: ' + a);
  const low = strip(a);
  const h = bytesToHex(keccak256(utf8ToBytes(low)), false);
  let out = '0x';
  for (let i = 0; i < 40; i++) { const c = low[i] as string; out += parseInt(h[i] as string, 16) >= 8 ? c.toUpperCase() : c; }
  return out;
}

/** Shortened for a log line: 0x1234…cdef. */
export const shortHex = (h: string, head = 6, tail = 4): string => {
  const s = String(h || '');
  return s.length <= head + tail + 2 ? s : s.slice(0, head + 2) + '…' + s.slice(-tail);
};
