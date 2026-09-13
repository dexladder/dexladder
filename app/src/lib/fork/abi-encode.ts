/**
 * ABI encoding, by the specification's own shape: a head of 32-byte slots (a static value, or the
 * offset of a dynamic one) followed by the tails. Arrays recurse through the same function, which
 * is why a `uint256[][]` needs no special case.
 *
 * Values arrive as the UI has them — decimal or 0x strings — and every range is checked here, so a
 * typo becomes a named error before a transaction is built, never a silently wrong 32 bytes.
 */
import { AbiError } from './abi-sig';
import { concatBytes, hexToBytes, strip, utf8ToBytes } from './hex';
import { BYTE, EIGHT, ONE, ZERO, pow2 } from './bi';

export type AbiValue = string | number | bigint | boolean | Uint8Array | readonly AbiValue[];

interface Enc { readonly dynamic: boolean; readonly bytes: Uint8Array }

const arrayOf = (type: string): { inner: string; len: number | null } | null => {
  const m = type.match(/^(.*)\[(\d*)\]$/);
  return m ? { inner: m[1] || '', len: m[2] ? parseInt(m[2], 10) : null } : null;
};

export function isDynamicType(type: string): boolean {
  if (type === 'bytes' || type === 'string') return true;
  const a = arrayOf(type);
  return a ? a.len === null || isDynamicType(a.inner) : false;
}

function word(v: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let x = v < ZERO ? pow2(256) + v : v;
  for (let i = 31; i >= 0; i--) { out[i] = Number(x & BYTE); x >>= EIGHT; }
  return out;
}

function toBigInt(type: string, v: AbiValue): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'boolean') return v ? ONE : ZERO;
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new AbiError(type + ' needs a whole number, got ' + v);
    return BigInt(v);
  }
  const s = String(v == null ? '' : v).trim().replace(/[_,\s]/g, '');
  if (!s) throw new AbiError(type + ' is empty');
  if (/^-?0[xX][0-9a-fA-F]+$/.test(s)) return (s.startsWith('-') ? -ONE : ONE) * BigInt(s.replace('-', ''));
  if (!/^-?\d+$/.test(s)) throw new AbiError(type + ': "' + v + '" is not a whole number (use the token amount in base units, or 0x hex)');
  return BigInt(s);
}

function padRight(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(b.length / 32) * 32);
  out.set(b);
  return out;
}

function encodeValue(type: string, v: AbiValue): Enc {
  const arr = arrayOf(type);
  if (arr) {
    if (!Array.isArray(v)) throw new AbiError(type + ' needs a JSON array, e.g. [1,2]');
    const items = v as readonly AbiValue[];
    if (arr.len !== null && items.length !== arr.len) throw new AbiError(type + ' needs exactly ' + arr.len + ' items, got ' + items.length);
    const body = encodeTuple(items.map(() => arr.inner), items);
    return arr.len === null ? { dynamic: true, bytes: concatBytes([word(BigInt(items.length)), body]) } : { dynamic: isDynamicType(arr.inner), bytes: body };
  }
  if (type === 'bytes') {
    const b = typeof v === 'string' ? hexToBytes(v) : (v as Uint8Array);
    return { dynamic: true, bytes: concatBytes([word(BigInt(b.length)), padRight(b)]) };
  }
  if (type === 'string') {
    const b = utf8ToBytes(String(v));
    return { dynamic: true, bytes: concatBytes([word(BigInt(b.length)), padRight(b)]) };
  }
  if (type === 'address') {
    const s = strip(String(v));
    if (s.length !== 40) throw new AbiError('address must be 20 bytes (0x + 40 hex digits): ' + v);
    return { dynamic: false, bytes: word(BigInt('0x' + s)) };
  }
  if (type === 'bool') {
    const s = typeof v === 'boolean' ? v : /^(true|1|yes)$/i.test(String(v).trim());
    return { dynamic: false, bytes: word(s ? ONE : ZERO) };
  }
  const fixed = type.match(/^bytes(\d+)$/);
  if (fixed) {
    const n = parseInt(fixed[1] || '0', 10), b = typeof v === 'string' ? hexToBytes(v) : (v as Uint8Array);
    if (b.length !== n) throw new AbiError(type + ' needs exactly ' + n + ' bytes, got ' + b.length);
    return { dynamic: false, bytes: padRight(b) };
  }
  const num = type.match(/^(u?)int(\d+)$/);
  if (num) {
    const bits = parseInt(num[2] || '256', 10), x = toBigInt(type, v);
    if (num[1] === 'u') {
      if (x < ZERO) throw new AbiError(type + ' cannot be negative: ' + x);
      if (x >= pow2(bits)) throw new AbiError(type + ' is too large for ' + bits + ' bits');
    } else {
      const lim = pow2(bits - 1);
      if (x < -lim || x >= lim) throw new AbiError(type + ' is out of range for ' + bits + ' bits');
    }
    return { dynamic: false, bytes: word(x) };
  }
  throw new AbiError('cannot encode type ' + type);
}

/** The head/tail layout for one parameter list (also one array's body). */
export function encodeTuple(types: readonly string[], values: readonly AbiValue[]): Uint8Array {
  if (types.length !== values.length) throw new AbiError('expected ' + types.length + ' argument(s), got ' + values.length);
  const encs = types.map((t, i) => encodeValue(t, values[i] as AbiValue));
  const headLen = encs.reduce((n, e) => n + (e.dynamic ? 32 : e.bytes.length), 0);
  const heads: Uint8Array[] = [], tails: Uint8Array[] = [];
  let tailLen = 0;
  for (const e of encs) {
    if (e.dynamic) { heads.push(word(BigInt(headLen + tailLen))); tails.push(e.bytes); tailLen += e.bytes.length; }
    else heads.push(e.bytes);
  }
  return concatBytes([...heads, ...tails]);
}

/** `0x` + selector + arguments — the `data` field of a call or transaction. */
export function encodeCall(selector: string, types: readonly string[], values: readonly AbiValue[]): string {
  const sel = strip(selector);
  if (sel.length !== 8) throw new AbiError('a selector is 4 bytes: ' + selector);
  return '0x' + sel + Array.from(encodeTuple(types, values)).map(b => b.toString(16).padStart(2, '0')).join('');
}
